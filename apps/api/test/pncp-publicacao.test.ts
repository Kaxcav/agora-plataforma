import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ContratoDetalhe, EventoAuditoria, Pagina, ProcessoDetalhe, ProcessoResumo, PublicacaoPncp, TarefaFila } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.ts';
import { sha256Hex } from '../src/compartilhado/cripto.ts';
import { carregarConfig } from '../src/config.ts';
import { FalhaTarefa } from '../src/fila/tipos.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { criarClientePncp, textoCabecalho, type ArquivoPncp, type CompraPncp } from '../src/integracoes/pncp-publicacao.ts';
import { gerarCnpj } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { chamar, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';

const prng = new Prng(1919);
const CNPJ_ORGAO = gerarCnpj(prng);
const BASE = 'https://treina.pncp.gov.br/api/pncp';

function json(corpo: unknown, status: number, cabecalhos: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
}

interface ChamadaPncp {
  caminho: string;
  cabecalhos: Headers;
  corpo: unknown;
}

/** PNCP de treinamento simulado: login com token no cabeçalho, inclusões com 201 + location, manutenção e recusa. */
function pncpFalso() {
  const estado = { modo: 'ok' as 'ok' | 'manutencao' | 'recusa', logins: 0, compras: 41, documentos: 1, contratos: 6, chamadas: [] as ChamadaPncp[] };
  const fetch: FuncaoFetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    const cabecalhos = new Headers(init?.headers);
    estado.chamadas.push({ caminho: url.pathname, cabecalhos, corpo: init?.body });
    if (url.pathname === '/api/pncp/v1/usuarios/login') {
      estado.logins++;
      return new Response(null, { status: 200, headers: { authorization: `Bearer token-${estado.logins}`, expires: '3600000' } });
    }
    if (cabecalhos.get('authorization') !== `Bearer token-${estado.logins}`) return new Response('', { status: 401 });
    if (estado.modo === 'manutencao') return new Response('Serviço em manutenção programada', { status: 503 });
    if (estado.modo === 'recusa') return json({ message: 'Unidade compradora não cadastrada para o órgão' }, 422);
    const compra = /^\/api\/pncp\/v1\/orgaos\/(\d{14})\/compras$/.exec(url.pathname);
    if (compra) {
      estado.compras++;
      const local = `${BASE}/v1/orgaos/${compra[1]}/compras/2026/${estado.compras}`;
      return json({ compraUri: local, documentoUri: `${local}/arquivos/1` }, 201, { location: local });
    }
    if (/\/compras\/\d{4}\/\d+\/arquivos$/.test(url.pathname)) {
      estado.documentos++;
      return new Response(null, { status: 201, headers: { location: `${BASE}${url.pathname.replace('/api/pncp', '')}/${estado.documentos}` } });
    }
    if (/\/compras\/\d{4}\/\d+\/atas$/.test(url.pathname)) {
      return new Response(null, { status: 201, headers: { location: `${BASE}${url.pathname.replace('/api/pncp', '')}/1` } });
    }
    const contrato = /^\/api\/pncp\/v1\/orgaos\/(\d{14})\/contratos$/.exec(url.pathname);
    if (contrato) {
      estado.contratos++;
      return new Response(null, { status: 201, headers: { location: `${BASE}/v1/orgaos/${contrato[1]}/contratos/2026/${estado.contratos}` } });
    }
    return new Response('', { status: 404 });
  };
  return { estado, fetch };
}

/** App de teste sem varredura periódica da fila (o teste aciona o trabalhador) e com relógio manual. */
async function appComFila(env: Record<string, string>, relogio: () => Date, fetch?: FuncaoFetch): Promise<FastifyInstance> {
  const config = carregarConfig({
    AGORA_AMBIENTE: 'demonstracao',
    AGORA_DADOS_DIR: 'memory://',
    AGORA_LOG_NIVEL: 'silent',
    AGORA_WEB_DIR: 'memory://sem-front-end',
    AGORA_LIMITE_REQUISICOES_MINUTO: '100000',
    ...env,
  });
  return construirApp(config, { relogio, filaVarreduraMs: 0, ...(fetch ? { fetch } : {}) });
}

async function esperar(condicao: () => Promise<boolean>, descricao: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error(`Tempo esgotado esperando: ${descricao}`);
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
}

async function processoPorBusca(app: FastifyInstance, credenciais: Credenciais, busca: string): Promise<string> {
  const lista = await obterJson<Pagina<ProcessoResumo>>(app, credenciais, `/api/v1/processos?busca=${encodeURIComponent(busca)}`);
  const id = lista.itens[0]?.id;
  assert.ok(id, `processo "${busca}" não encontrado`);
  return id;
}

async function parecerFavoravel(app: FastifyInstance, juridico: Credenciais, id: string): Promise<void> {
  const p = await obterJson<ProcessoDetalhe>(app, juridico, `/api/v1/processos/${id}`);
  if (p.parecer.conclusao === 'favoravel' || p.parecer.conclusao === 'favoravel_com_ressalvas') return;
  const r = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, {
    itens: p.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })),
    conclusao: 'favoravel',
  });
  assert.equal(r.statusCode, 200, r.body);
}

const ARQUIVO: ArquivoPncp = { nome: 'edital.pdf', conteudo: Buffer.from('%PDF-1.4 teste'), titulo: 'Edital nº 1/2026 — pregão', tipoDocumentoId: 2 };
const COMPRA = { codigoUnidadeCompradora: '990001', itensCompra: [] } as unknown as CompraPncp;

describe('cliente da API de manutenção do PNCP (fetch simulado)', () => {
  test('login devolve o JWT no cabeçalho; a inclusão é multipart com Titulo-Documento e Tipo-Documento-Id; 201 → location', async () => {
    const { estado, fetch } = pncpFalso();
    const cliente = criarClientePncp({ urlBase: BASE, usuario: 'sistema-agora', senha: 'senha-de-teste-sintetica', fetch });
    const resposta = await cliente.incluirCompra(CNPJ_ORGAO, COMPRA, ARQUIVO);
    assert.equal(resposta.registro.numeroControle, `${CNPJ_ORGAO}-1-000042/2026`);
    assert.equal(resposta.localizacao, `${BASE}/v1/orgaos/${CNPJ_ORGAO}/compras/2026/42`);

    const [login, inclusao] = estado.chamadas;
    assert.equal(login?.caminho, '/api/pncp/v1/usuarios/login');
    assert.deepEqual(JSON.parse(String(login?.corpo)), { login: 'sistema-agora', senha: 'senha-de-teste-sintetica' });
    assert.equal(inclusao?.cabecalhos.get('authorization'), 'Bearer token-1');
    assert.equal(inclusao?.cabecalhos.get('tipo-documento-id'), '2');
    assert.equal(inclusao?.cabecalhos.get('titulo-documento'), 'Edital no 1/2026 - pregao');
    const formulario = inclusao?.corpo as FormData;
    assert.ok(formulario instanceof FormData);
    const parteCompra = formulario.get('compra') as Blob;
    assert.equal(parteCompra.type, 'application/json');
    assert.deepEqual(JSON.parse(await parteCompra.text()), COMPRA);
    assert.equal(await (formulario.get('documento') as Blob).text(), '%PDF-1.4 teste');

    await cliente.incluirArquivoCompra(CNPJ_ORGAO, 2026, 42, { ...ARQUIVO, tipoDocumentoId: 4 });
    assert.equal(estado.logins, 1, 'o token vale por 1 hora: não refaz o login');
    assert.ok((estado.chamadas.at(-1)?.corpo as FormData).get('arquivo'));
  });

  test('401 com token vencido refaz o login uma vez; 4xx é definitivo; 5xx e falha de rede são transitórios', async () => {
    const { estado, fetch } = pncpFalso();
    const cliente = criarClientePncp({ urlBase: BASE, usuario: 'sistema-agora', senha: 'senha-de-teste-sintetica', fetch });
    const contrato = await cliente.incluirContrato(CNPJ_ORGAO, {} as never);
    assert.equal(contrato.registro.numeroControle, `${CNPJ_ORGAO}-2-000007/2026`);
    estado.logins++; // o PNCP invalidou o token anterior
    const ata = await cliente.incluirAta(CNPJ_ORGAO, 2026, 42, {
      numeroAtaRegistroPreco: '1/2026',
      anoAta: 2026,
      dataAssinatura: '2026-11-09',
      dataVigenciaInicio: '2026-11-09',
      dataVigenciaFim: '2027-11-08',
    });
    assert.equal(ata.registro.numeroControle, `${CNPJ_ORGAO}-1-000042/2026-000001`);
    assert.equal(estado.logins, 3, 'um 401 renova o token e repete a inclusão uma vez');
    assert.equal(estado.chamadas.filter((c) => c.caminho.endsWith('/atas')).length, 2);
  });

  test('classificação das respostas: 422 sem nova tentativa, 503 e rede com nova tentativa, login recusado definitivo', async () => {
    const { estado, fetch } = pncpFalso();
    const cliente = criarClientePncp({ urlBase: BASE, usuario: 'sistema-agora', senha: 'senha-de-teste-sintetica', fetch });
    estado.modo = 'recusa';
    await assert.rejects(cliente.incluirCompra(CNPJ_ORGAO, COMPRA, ARQUIVO), (e: unknown) => e instanceof FalhaTarefa && !e.retentavel && /HTTP 422/.test(e.message) && /Unidade compradora/.test(e.message));
    estado.modo = 'manutencao';
    await assert.rejects(cliente.incluirCompra(CNPJ_ORGAO, COMPRA, ARQUIVO), (e: unknown) => e instanceof FalhaTarefa && e.retentavel && /HTTP 503/.test(e.message));

    const semRede = criarClientePncp({ urlBase: BASE, usuario: 'u', senha: 's', fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(semRede.incluirCompra(CNPJ_ORGAO, COMPRA, ARQUIVO), (e: unknown) => e instanceof FalhaTarefa && e.retentavel && /fetch failed/.test(e.message));
    const recusado = criarClientePncp({ urlBase: BASE, usuario: 'u', senha: 's', fetch: async () => new Response('', { status: 401 }) });
    await assert.rejects(recusado.incluirCompra(CNPJ_ORGAO, COMPRA, ARQUIVO), (e: unknown) => e instanceof FalhaTarefa && !e.retentavel && /AGORA_PNCP_USUARIO/.test(e.message));
    assert.equal(textoCabecalho('Termo de referência — edição'), 'Termo de referencia - edicao');
  });
});

describe('publicação no PNCP de treinamento pela fila (AGORA_INTEGRACOES=online)', () => {
  const tempo = relogioManual();
  const pncp = pncpFalso();
  let app: FastifyInstance;
  let agente: Credenciais;
  let juridico: Credenciais;

  before(async () => {
    app = await appComFila(
      {
        AGORA_INTEGRACOES: 'online',
        AGORA_ORGAO_CNPJ: CNPJ_ORGAO,
        AGORA_PNCP_PUBLICACAO_URL: BASE,
        AGORA_PNCP_USUARIO: 'sistema-agora',
        AGORA_PNCP_SENHA: 'senha-de-teste-sintetica',
        AGORA_FILA_ESPERA_MS: '1000',
        AGORA_FILA_ESPERA_MAXIMA_MS: '8000',
      },
      tempo.relogio,
      pncp.fetch,
    );
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('recusa (422) vai para a fila de erro sem nova tentativa; reenviada, a manutenção (503) gera nova tentativa; de volta, compra + edital, anexos, protocolo e número de controle', async () => {
    const id = await processoPorBusca(app, agente, 'software');
    await parecerFavoravel(app, juridico, id);

    // 1) Recusa do PNCP: definitiva, sem nova tentativa; aparece na fila de erro.
    pncp.estado.modo = 'recusa';
    const antes = pncp.estado.chamadas.length;
    const recusado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(recusado.statusCode, 200, recusado.body);
    assert.equal(recusado.json<ProcessoDetalhe>().publicacao.pncp, 'na_fila');
    let situacao = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
    assert.equal(situacao.envios[0]?.situacao, 'erro');
    assert.match(situacao.envios[0]?.ultimoErro ?? '', /HTTP 422.*Unidade compradora/);
    tempo.avancar(60_000);
    await app.fila.trabalhador?.varrer();
    assert.equal(pncp.estado.chamadas.slice(antes).filter((c) => c.caminho.endsWith('/compras')).length, 1, 'recusa não é repetida');
    const admin = await entrar(app, 'admin@agora.demo');
    const naFilaDeErro = await obterJson<Pagina<TarefaFila>>(app, admin, '/api/v1/fila/tarefas?situacao=erro&tamanhoPagina=100');
    assert.ok(naFilaDeErro.itens.some((t) => t.tipo === 'pncp.compra' && t.recurso?.id === id));

    // 2) Corrigido o cadastro, "Publicar" reenvia a mesma tarefa; agora o PNCP está em manutenção (503).
    pncp.estado.modo = 'manutencao';
    const pedido = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(pedido.statusCode, 200, pedido.body);
    assert.equal(pedido.json<ProcessoDetalhe>().publicacao.pncp, 'na_fila');
    situacao = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
    assert.equal(situacao.envios.length, 1, 'mesma tarefa (chave de idempotência)');
    assert.equal(situacao.envios[0]?.situacao, 'nova_tentativa');
    assert.match(situacao.envios[0]?.ultimoErro ?? '', /HTTP 503/);
    assert.ok(situacao.envios[0]?.proximaTentativaEm);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`)).statusCode, 422, 'sem duplicar o pedido');

    pncp.estado.modo = 'ok';
    tempo.avancar(1000);
    await app.fila.trabalhador?.varrer();
    await esperar(async () => {
      const s = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
      return s.envios.length === 3 && s.envios.every((e) => e.situacao === 'publicado');
    }, 'compra e anexos publicados');

    situacao = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
    assert.equal(situacao.numeroControle, `${CNPJ_ORGAO}-1-000042/2026`);
    assert.equal(situacao.linkPncp, `https://pncp.gov.br/app/editais/${CNPJ_ORGAO}/2026/42`);
    assert.equal(situacao.linkPublico, `/transparencia/editais/${id}`);
    assert.deepEqual(situacao.envios.map((e) => [e.objeto, e.tipoDocumentoPncp, e.modo]), [
      ['compra', 2, 'online'],
      ['arquivo', 4, 'online'],
      ['arquivo', 3, 'online'],
    ]);
    assert.equal(situacao.envios[0]?.protocolo, `${BASE}/v1/orgaos/${CNPJ_ORGAO}/compras/2026/42`);
    assert.ok(situacao.envios.every((e) => /^[0-9a-f]{64}$/.test(e.hashArquivo ?? '')));
    assert.equal(situacao.envios[0]?.tentativas, 2, 'o reprocessamento zerou as tentativas: 503 e depois 201');

    const detalhe = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`);
    assert.equal(detalhe.publicacao.pncp, 'publicado');
    assert.equal(detalhe.publicacao.idPncp, `${CNPJ_ORGAO}-1-000042/2026`);
    assert.ok(detalhe.publicacao.dataMinimaPropostas && detalhe.publicacao.dataMinimaPropostas > tempo.relogio().toISOString().slice(0, 10));

    const inclusao = pncp.estado.chamadas.filter((c) => c.caminho === `/api/pncp/v1/orgaos/${CNPJ_ORGAO}/compras`).at(-1);
    assert.ok(inclusao);
    assert.equal(inclusao.cabecalhos.get('tipo-documento-id'), '2');
    const compra = JSON.parse(await ((inclusao.corpo as FormData).get('compra') as Blob).text()) as CompraPncp;
    assert.equal(compra.numeroProcesso, detalhe.numeroSei);
    const [processoUasg] = await app.agora.banco.consultar<{ uasg: string }>('SELECT uasg FROM processos WHERE id = $1', [id]);
    assert.equal(compra.codigoUnidadeCompradora, processoUasg?.uasg);
    assert.deepEqual([compra.tipoInstrumentoConvocatorioId, compra.modalidadeId, compra.amparoLegalId, compra.modoDisputaId], [1, 6, 1, 1]);
    assert.equal(compra.itensCompra.length, detalhe.dfd.itens.length);
    assert.equal(compra.dataEncerramentoProposta, `${detalhe.publicacao.dataMinimaPropostas}T09:00:00`);
    const pdf = await ((inclusao.corpo as FormData).get('documento') as Blob).text();
    assert.ok(pdf.startsWith('%PDF'));
    const anexos = pncp.estado.chamadas.filter((c) => c.caminho.endsWith('/compras/2026/42/arquivos'));
    assert.deepEqual(anexos.map((c) => c.cabecalhos.get('tipo-documento-id')).sort(), ['3', '4']);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?recurso=processo&tamanhoPagina=100`);
    const doProcesso = trilha.itens.filter((e) => e.recursoId === id);
    assert.ok(doProcesso.some((e) => e.acao === 'processo.publicar' && e.usuario?.id === agente.sessao.usuario.id));
    assert.ok(doProcesso.some((e) => e.acao === 'pncp.publicar' && e.usuario?.id === agente.sessao.usuario.id));
    assert.equal(doProcesso.filter((e) => e.acao === 'pncp.anexar').length, 2);
    const proveniencia = await app.agora.banco.consultar<{ acao: string; dados: Record<string, unknown> }>(
      "SELECT acao, dados FROM auditoria_eventos WHERE acao IN ('pncp.publicar', 'fila.nova_tentativa', 'fila.erro') ORDER BY sequencia",
    );
    const publicacao = proveniencia.find((e) => e.acao === 'pncp.publicar')?.dados;
    assert.equal(publicacao?.['protocolo'], `${BASE}/v1/orgaos/${CNPJ_ORGAO}/compras/2026/42`);
    assert.match(String(publicacao?.['hashArquivo']), /^[0-9a-f]{64}$/);
    assert.ok(proveniencia.some((e) => e.acao === 'fila.nova_tentativa' && /HTTP 503/.test(String(e.dados['erro']))));
    assert.ok(proveniencia.some((e) => e.acao === 'fila.erro' && e.dados['motivo'] === 'falha_definitiva'));
  });

  test('divulgação do contrato (art. 94): JSON do contrato, número de controle e pendência resolvida', async () => {
    const id = await processoPorBusca(app, agente, 'viaturas');
    const contratado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contratar`);
    assert.equal(contratado.statusCode, 200, contratado.body);
    const contratoId = contratado.json<ProcessoDetalhe>().contratoGerado?.id;
    assert.ok(contratoId);
    const resposta = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contrato/publicar-pncp`);
    assert.equal(resposta.statusCode, 200, resposta.body);
    const situacao = resposta.json<PublicacaoPncp>();
    assert.equal(situacao.contrato?.situacao, 'publicado', situacao.contrato?.ultimoErro ?? '');
    assert.equal(situacao.contrato?.numeroControle, `${CNPJ_ORGAO}-2-000007/2026`);
    const envio = pncp.estado.chamadas.at(-1);
    assert.equal(envio?.caminho, `/api/pncp/v1/orgaos/${CNPJ_ORGAO}/contratos`);
    const corpo = JSON.parse(String(envio?.corpo)) as Record<string, unknown>;
    assert.equal(corpo['tipoContratoId'], 1);
    assert.equal(corpo['receita'], false);
    assert.match(String(corpo['niFornecedor']), /^\d{14}$/);

    const gestor = await entrar(app, 'gestor@agora.demo');
    const contrato = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${contratoId}`);
    assert.equal(contrato.divulgacaoPncp.situacao, 'divulgado_no_prazo');
    const [pendencia] = await app.agora.banco.consultar<{ situacao: string }>(
      "SELECT situacao FROM pendencias WHERE instrumento_id = $1 AND tipo = 'divulgacao_pncp'",
      [contratoId],
    );
    assert.equal(pendencia?.situacao, 'resolvida');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contrato/publicar-pncp`)).statusCode, 422, 'divulgação única');
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/processos/${id}/contrato/publicar-pncp`)).statusCode, 403);
  });
});

describe('publicação simulada (modo offline, padrão)', () => {
  test('protocolo determinístico, mesmo número de controle da simulação anterior e nenhuma chamada externa', async () => {
    let chamadasExternas = 0;
    const app = await appComFila({}, relogioManual().relogio, async () => {
      chamadasExternas++;
      return new Response('', { status: 500 });
    });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const juridico = await entrar(app, 'juridico@agora.demo');
      const id = await processoPorBusca(app, agente, 'software');
      await parecerFavoravel(app, juridico, id);
      const publicado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
      assert.equal(publicado.statusCode, 200, publicado.body);
      const pub = publicado.json<ProcessoDetalhe>().publicacao;
      assert.equal(pub.pncp, 'publicado');
      assert.match(pub.idPncp ?? '', /^\d{14}-1-\d{6}\/2026$/);
      await esperar(async () => {
        const s = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
        return s.envios.length === 3 && s.envios.every((e) => e.situacao === 'publicado');
      }, 'anexos simulados');
      const situacao = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
      const compra = situacao.envios[0];
      assert.ok(compra);
      assert.equal(compra.modo, 'offline');
      assert.equal(compra.protocolo, `SIMULADO-${sha256Hex(`pncp:compra:${id}|${compra.hashArquivo ?? ''}`).slice(0, 20).toUpperCase()}`);
      assert.equal(situacao.linkPncp, null, 'sem link para o portal do PNCP em simulação');
      assert.equal(chamadasExternas, 0);
    } finally {
      await app.close();
    }
  });
});
