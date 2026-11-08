import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  ConsultaPrecos,
  Pagina,
  PesquisaPrecosProcesso,
  ProcessoDetalhe,
  ProcessoResumo,
  ProjecaoValorEstimado,
  RespostaErro,
  RespostaSenhaTemporaria,
  ResultadoImportacaoReferencias,
  UsuarioAdmin,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { carregarConfig, ErroConfiguracao } from '../src/config.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { dataDaApi, obterTexto, reaisParaCentavos } from '../src/integracoes/precos/http.ts';
import { lerTabelaReferencia } from '../src/modulos/precos/importacao-referencias.ts';
import { termoSugerido } from '../src/modulos/precos/servico.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

async function processoPorTitulo(app: FastifyInstance, credenciais: Credenciais, fragmento: string): Promise<ProcessoResumo> {
  const lista = await obterJson<Pagina<ProcessoResumo>>(app, credenciais, '/api/v1/processos?tamanhoPagina=100');
  const processo = lista.itens.find((p) => p.titulo.toLowerCase().includes(fragmento));
  assert.ok(processo, `processo "${fragmento}" presente no seed`);
  return processo;
}

describe('pesquisa de preços — leitura de dados das fontes', () => {
  test('valores e datas das APIs; termo sugerido; tabela do Sinapi/Sicro', () => {
    assert.equal(reaisParaCentavos(1190000.5), 119_000_050);
    assert.equal(reaisParaCentavos('1.188.500,00'), 118_850_000);
    assert.equal(reaisParaCentavos('35.10'), 3510);
    assert.equal(reaisParaCentavos(-1), null);
    assert.equal(reaisParaCentavos('abc'), null);
    assert.equal(dataDaApi('2026-08-20T00:00:00'), '2026-08-20');
    assert.equal(dataDaApi('15/09/2026'), '2026-09-15');
    assert.equal(dataDaApi(null), null);
    assert.equal(termoSugerido('Scanner corporal de inspeção por transmissão de raios X'), 'scanner corporal inspeção');

    const ok = lerTabelaReferencia('codigo;descricao;unidade;preco\nDEMO-1;Calçada em concreto (exemplo);m2;150,00\n"DEMO-2";"Meio-fio; pré-moldado";m;"42,50"');
    assert.deepEqual(ok.erros, []);
    assert.deepEqual(ok.linhas.map((l) => [l.codigo, l.descricao, l.preco]), [
      ['DEMO-1', 'Calçada em concreto (exemplo)', 15000],
      ['DEMO-2', 'Meio-fio; pré-moldado', 4250],
    ]);
    const ruim = lerTabelaReferencia('DEMO-1;Calçada;m2;abc\nDEMO-1;Outra composição;m2;10,00\nDEMO-1;Repetida;m2;10,00');
    assert.deepEqual(ruim.erros.map((e) => e.campo), ['linha 1', 'linha 3']);
  });

  test('configuração: padrões das fontes oficiais, barra final removida e URL inválida recusada', () => {
    const padrao = carregarConfig({}).precos;
    assert.deepEqual(padrao, {
      comprasDadosUrl: 'https://dadosabertos.compras.gov.br',
      transparenciaUrl: 'https://api.portaldatransparencia.gov.br/api-de-dados',
      transparenciaChave: null,
      ibgeSidraUrl: 'https://apisidra.ibge.gov.br',
      bcbSgsUrl: 'https://api.bcb.gov.br/dados/serie',
      timeoutMs: 15_000,
    });
    assert.equal(carregarConfig({ AGORA_COMPRAS_DADOS_URL: 'https://espelho.orgao.gov.br/dados/' }).precos.comprasDadosUrl, 'https://espelho.orgao.gov.br/dados');
    assert.throws(() => carregarConfig({ AGORA_BCB_SGS_URL: 'ftp://bcb' }), (e: unknown) => e instanceof ErroConfiguracao && e.problemas.includes('AGORA_BCB_SGS_URL: URL inválida'));
    assert.throws(() => carregarConfig({ AGORA_PRECOS_TIMEOUT_MS: '10' }), ErroConfiguracao);
  });

  test('retentativa em 503 com espera exponencial; 4xx não é repetido', async () => {
    const esperas: number[] = [];
    let chamadas = 0;
    const fetch: FuncaoFetch = async () => {
      chamadas++;
      return chamadas === 1 ? new Response('', { status: 503 }) : new Response('{"ok":true}', { status: 200 });
    };
    const opcoes = { timeoutMs: 1000, novasTentativas: 2, esperaBaseMs: 10, esperar: async (ms: number) => void esperas.push(ms) };
    assert.equal(await obterTexto(fetch, 'https://exemplo.gov.br/x', 'Fonte', opcoes), '{"ok":true}');
    assert.deepEqual(esperas, [10]);
    const proibido: FuncaoFetch = async () => new Response('', { status: 403 });
    await assert.rejects(obterTexto(proibido, 'https://exemplo.gov.br/x', 'Fonte', opcoes), /recusou o acesso \(HTTP 403\)/);
  });
});

describe('pesquisa de preços (RF-25) e projeção (RIA-11) — modo offline', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let gestor: Credenciais;
  let admin: Credenciais;
  let scanners: ProcessoResumo;

  before(async () => {
    app = await criarAppTeste({ env: LIMITE });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
    scanners = await processoPorTitulo(app, planejamento, 'scanners');
    assert.equal(scanners.etapaAtual, 3);
  });
  after(async () => {
    await app.close();
  });

  test('o painel traz o item de referência, o termo sugerido e nenhuma consulta', async () => {
    const pesquisa = await obterJson<PesquisaPrecosProcesso>(app, gestor, `/api/v1/processos/${scanners.id}/pesquisa-precos`);
    assert.equal(pesquisa.modo, 'offline');
    assert.equal(pesquisa.itemReferencia?.catmat, '470830');
    assert.equal(pesquisa.termoSugerido, 'scanner corporal inspeção');
    assert.equal(pesquisa.engenharia, false);
    assert.deepEqual(pesquisa.consultas, []);
    assert.equal(pesquisa.projecao, null);
  });

  test('consulta simulada e determinística: fontes com proveniência, sugestões enquadradas e descarte por prazo', async () => {
    const url = `/api/v1/processos/${scanners.id}/pesquisa-precos/consultas`;
    const resposta = await chamar(app, planejamento, 'POST', url, {});
    assert.equal(resposta.statusCode, 201);
    const consulta = resposta.json<ConsultaPrecos>();
    assert.deepEqual(
      consulta.fontes.map((f) => [f.fonte, f.situacao, f.modo, f.registros]),
      [
        ['PAINEL_PRECOS', 'ok', 'offline', 4],
        ['CONTRATACOES_SIMILARES', 'ok', 'offline', 4],
        ['NOTAS_FISCAIS', 'ok', 'offline', 3],
        ['SINAPI', 'nao_aplicavel', 'local', 0],
        ['SICRO', 'nao_aplicavel', 'local', 0],
      ],
    );
    assert.ok(consulta.fontes.slice(0, 3).every((f) => /^[0-9a-f]{64}$/.test(f.hashConteudo ?? '')));
    assert.equal(consulta.sugestoes.length, 10);
    assert.deepEqual([...new Set(consulta.sugestoes.map((s) => s.inciso))], ['art. 23, § 1º, I', 'art. 23, § 1º, II', 'art. 23, § 1º, V']);
    assert.deepEqual(consulta.descartadas.map((d) => d.fonte), ['CONTRATACOES_SIMILARES']);
    assert.match(consulta.descartadas[0]?.motivo ?? '', /Fora do período de 12 meses/);
    assert.ok(consulta.sugestoes.every((s) => s.identificador.includes('DEMO') && s.cotacaoId === null));
    assert.equal(consulta.executadaPor, 'Beatriz Lacerda Fontes');
    assert.match(consulta.aviso, /escolha do agente/);

    const repetida = (await chamar(app, planejamento, 'POST', url, {})).json<ConsultaPrecos>();
    assert.deepEqual(
      repetida.sugestoes.map((s) => [s.identificador, s.valorUnitario, s.data]),
      consulta.sugestoes.map((s) => [s.identificador, s.valorUnitario, s.data]),
      'a mesma pesquisa devolve as mesmas amostras',
    );
    const outroTermo = (await chamar(app, planejamento, 'POST', url, { termo: 'scanner raio x', catmat: null })).json<ConsultaPrecos>();
    assert.equal(outroTermo.termo, 'scanner raio x');
    assert.notDeepEqual(outroTermo.sugestoes.map((s) => s.valorUnitario), consulta.sugestoes.map((s) => s.valorUnitario));

    const [evento] = await app.agora.banco.consultar<{ dados: { consultaId: string; fontes: { fonte: string; hashConteudo: string | null }[]; sugestoes: number } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'processo.precos.consultar' ORDER BY sequencia LIMIT 1",
    );
    assert.equal(evento?.dados.consultaId, consulta.id);
    assert.equal(evento?.dados.sugestoes, 10);
    assert.equal(evento?.dados.fontes[0]?.hashConteudo, consulta.fontes[0]?.hashConteudo);

    const painel = await obterJson<PesquisaPrecosProcesso>(app, planejamento, `/api/v1/processos/${scanners.id}/pesquisa-precos`);
    assert.deepEqual(painel.consultas.map((c) => c.id), [outroTermo.id, repetida.id, consulta.id]);
  });

  test('o agente inclui duas sugestões na cesta, com fonte, data e inciso; repetir é recusado', async () => {
    const consulta = (await chamar(app, planejamento, 'POST', `/api/v1/processos/${scanners.id}/pesquisa-precos/consultas`, {})).json<ConsultaPrecos>();
    const antes = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${scanners.id}`);
    const escolhidas = [consulta.sugestoes[0], consulta.sugestoes[5]].filter((s) => s !== undefined);
    const url = `/api/v1/processos/${scanners.id}/pesquisa-precos/consultas/${consulta.id}/incluir`;
    assert.equal((await chamar(app, gestor, 'POST', url, { sugestoes: escolhidas.map((s) => s.id) })).statusCode, 403);

    const resposta = await chamar(app, planejamento, 'POST', url, { sugestoes: escolhidas.map((s) => s.id) });
    assert.equal(resposta.statusCode, 200);
    const depois = resposta.json<ProcessoDetalhe>();
    assert.equal(depois.cestaPrecos.cotacoes.length, antes.cestaPrecos.cotacoes.length + 2);
    const novas = depois.cestaPrecos.cotacoes.slice(-2);
    assert.deepEqual(
      novas.map((c) => [c.fonte, c.valorUnitario, c.dataCotacao, c.descricaoFonte, c.expurgada]),
      escolhidas.map((s) => [s.fonteCotacao, s.valorUnitario, s.data, s.descricaoFonte, false]),
    );
    assert.match(novas[0]?.descricaoFonte ?? '', /art\. 23, § 1º, I\)$/);
    assert.ok(depois.cestaPrecos.analise, 'a análise estatística da cesta é recalculada');

    const repetir = await chamar(app, planejamento, 'POST', url, { sugestoes: [escolhidas[0]?.id] });
    assert.equal(repetir.statusCode, 422);
    assert.match(repetir.json<RespostaErro>().erro.mensagem, /já incluídas/);
    const marcada = (await obterJson<PesquisaPrecosProcesso>(app, planejamento, `/api/v1/processos/${scanners.id}/pesquisa-precos`)).consultas.find((c) => c.id === consulta.id);
    assert.deepEqual(
      marcada?.sugestoes.filter((s) => s.cotacaoId !== null).map((s) => s.cotacaoId),
      novas.map((c) => c.id),
    );
    const [evento] = await app.agora.banco.consultar<{ dados: { incluidas: { identificador: string; inciso: string }[] } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'processo.cesta.incluir_sugestoes' ORDER BY sequencia DESC LIMIT 1",
    );
    assert.deepEqual(evento?.dados.incluidas.map((i) => i.identificador), escolhidas.map((s) => s.identificador));

    const outro = (await obterJson<Pagina<ProcessoResumo>>(app, planejamento, '/api/v1/processos?etapa=1')).itens[0];
    assert.ok(outro);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${outro.id}/pesquisa-precos/consultas/${consulta.id}/incluir`, { sugestoes: [escolhidas[0]?.id] })).statusCode, 404);
    assert.equal((await chamar(app, planejamento, 'POST', url, { sugestoes: [] })).statusCode, 400);
  });

  test('projeção do valor estimado: sinal com premissas e fontes; não altera a cesta nem o valor', async () => {
    const antes = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${scanners.id}`);
    const url = `/api/v1/processos/${scanners.id}/pesquisa-precos/projecao`;
    const resposta = await chamar(app, planejamento, 'POST', url, { dataPrevista: '2027-05-10', percentualCambial: 0 });
    assert.equal(resposta.statusCode, 201);
    const p = resposta.json<ProjecaoValorEstimado>();
    assert.equal(p.valorBase, antes.valorEstimado);
    assert.equal(p.dataBase, '2026-11-09');
    assert.equal(p.cambio, null);
    assert.equal(p.inflacao.competencias, 12);
    assert.equal(p.inflacao.periodo, '11/2025 a 10/2026');
    assert.ok(p.valorUnitarioBase !== null && p.valorUnitarioProjetado !== null);
    assert.ok(Math.abs((p.valorUnitarioProjetado ?? 0) / (p.valorUnitarioBase ?? 1) - p.valorProjetado / p.valorBase) < 1e-6, 'o valor unitário segue o mesmo fator');
    assert.ok(p.faixa.minimo <= p.valorProjetado && p.valorProjetado <= p.faixa.maximo);
    assert.deepEqual(p.fontes.map((f) => [f.serie, f.modo, f.competencias.length]), [['IPCA', 'offline', 12]]);
    assert.match(p.aviso, /Requer revisão humana/);
    assert.ok(p.premissas.some((x) => /série sintética de demonstração/.test(x)));
    assert.equal(p.geradaPor, 'Beatriz Lacerda Fontes');

    const comCambio = (await chamar(app, planejamento, 'POST', url, { dataPrevista: '2027-11-09', percentualCambial: 40 })).json<ProjecaoValorEstimado>();
    assert.equal(comCambio.cambio?.participacao, 40);
    assert.equal(comCambio.cambio?.competencias, 13);
    assert.deepEqual(comCambio.fontes.map((f) => f.serie), ['IPCA', 'CAMBIO_USD']);

    const depois = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${scanners.id}`);
    assert.equal(depois.valorEstimado, antes.valorEstimado, 'a projeção não altera o valor estimado');
    assert.deepEqual(depois.cestaPrecos.cotacoes, antes.cestaPrecos.cotacoes);
    const painel = await obterJson<PesquisaPrecosProcesso>(app, gestor, `/api/v1/processos/${scanners.id}/pesquisa-precos`);
    assert.equal(painel.projecao?.id, comCambio.id);

    const passado = await chamar(app, planejamento, 'POST', url, { dataPrevista: '2026-01-01', percentualCambial: 0 });
    assert.equal(passado.statusCode, 422);
    assert.equal((await chamar(app, planejamento, 'POST', url, { dataPrevista: '2027-05-10', percentualCambial: 150 })).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'POST', url, { dataPrevista: '2027-05-10', percentualCambial: 0 })).statusCode, 403);
    const [evento] = await app.agora.banco.consultar<{ dados: { projecaoId: string; sinal: string } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'processo.precos.projetar' ORDER BY sequencia DESC LIMIT 1",
    );
    assert.equal(evento?.dados.projecaoId, comCambio.id);
  });

  test('etapa já concluída: a pesquisa e a projeção são recusadas', async () => {
    const etapa4 = (await obterJson<Pagina<ProcessoResumo>>(app, planejamento, '/api/v1/processos?etapa=4')).itens[0];
    assert.ok(etapa4);
    const consulta = await chamar(app, planejamento, 'POST', `/api/v1/processos/${etapa4.id}/pesquisa-precos/consultas`, {});
    assert.equal(consulta.statusCode, 422);
    assert.match(consulta.json<RespostaErro>().erro.mensagem, /etapa 3/);
  });

  test('obras: Sinapi e Sicro da tabela importada no servidor (§ 2º, I); a importação de nova data-base exige integracoes:executar', async () => {
    const criado = (await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Recuperação do pátio de estacionamento da unidade regional', orgao: 'PRF' })).json<ProcessoDetalhe>();
    const dfd = {
      descricaoNecessidade: 'Recuperar o pavimento do pátio de estacionamento de viaturas, com trincas e buracos que danificam os veículos.',
      justificativa: 'O pátio é usado diariamente pelas viaturas e o pavimento atual compromete a segurança e a conservação da frota.',
      itens: [{ catmat: null, descricao: 'Pavimentação com concreto asfáltico usinado a quente', unidade: 't', quantidade: 120, valorUnitarioEstimado: 60_000 }],
      usaCatalogoPadronizado: true,
      justificativaNaoPadronizacao: null,
      justificativaArtigoLuxo: null,
      previstoNoPca: true,
      tipoObjeto: 'obras_servicos_engenharia_comuns',
    };
    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${criado.id}/dfd`, dfd)).statusCode, 200);
    const url = `/api/v1/processos/${criado.id}/pesquisa-precos/consultas`;
    const consulta = (await chamar(app, planejamento, 'POST', url, {})).json<ConsultaPrecos>();
    const situacao = Object.fromEntries(consulta.fontes.map((f) => [f.fonte, f.situacao]));
    assert.deepEqual(situacao, { PAINEL_PRECOS: 'nao_aplicavel', CONTRATACOES_SIMILARES: 'ok', NOTAS_FISCAIS: 'ok', SINAPI: 'sem_resultado', SICRO: 'ok' });
    assert.equal(consulta.sugestoes[0]?.fonte, 'SICRO', 'Sicro (infraestrutura de transportes) vem antes das contratações similares');
    assert.deepEqual(consulta.alertas.map((a) => a.codigo), []);
    const sicro = consulta.sugestoes.find((s) => s.fonte === 'SICRO');
    assert.match(sicro?.identificador ?? '', /^SICRO DEMO-2001 \(não desonerada, data-base 10\/2026\)$/);
    assert.equal(sicro?.inciso, 'art. 23, § 2º, I');
    assert.equal(sicro?.fonteCotacao, 'midia_especializada');
    assert.equal(sicro?.data, '2026-10-01');
    assert.ok(consulta.sugestoes.every((s) => s.fonte !== 'PAINEL_PRECOS'));

    const tabela = 'codigo;descricao;unidade;preco\nDEMO-9001;Pavimentação de pátio com concreto asfáltico (exemplo);t;640,00';
    const importacao = { sistema: 'SICRO', uf: consulta.uf, dataBase: '2026-11', desonerado: false, conteudo: tabela };
    const rotaImportacao = '/api/v1/pesquisa-precos/referencias-engenharia/importacao';
    assert.equal((await chamar(app, planejamento, 'POST', rotaImportacao, importacao)).statusCode, 403);
    const comErro = await chamar(app, admin, 'POST', rotaImportacao, { ...importacao, conteudo: 'DEMO-9;Pátio;t;zero' });
    assert.equal(comErro.statusCode, 422);
    assert.equal(comErro.json<RespostaErro>().erro.detalhes?.[0]?.campo, 'linha 1');
    const importada = await chamar(app, admin, 'POST', rotaImportacao, importacao);
    assert.equal(importada.statusCode, 200);
    const resultado = importada.json<ResultadoImportacaoReferencias>();
    assert.equal(resultado.tabela.itens, 1);
    assert.equal(resultado.substituidos, 0);
    assert.equal((await chamar(app, admin, 'POST', rotaImportacao, importacao)).json<ResultadoImportacaoReferencias>().substituidos, 1);

    const nova = (await chamar(app, planejamento, 'POST', url, {})).json<ConsultaPrecos>();
    assert.deepEqual(
      nova.sugestoes.filter((s) => s.fonte === 'SICRO').map((s) => s.identificador),
      ['SICRO DEMO-9001 (não desonerada, data-base 11/2026)'],
    );
    const painel = await obterJson<PesquisaPrecosProcesso>(app, planejamento, `/api/v1/processos/${criado.id}/pesquisa-precos`);
    assert.equal(painel.engenharia, true);
    assert.ok(painel.tabelasEngenharia.some((t) => t.sistema === 'SICRO' && t.dataBase === '2026-11' && t.itens === 1));
    const [evento] = await app.agora.banco.consultar<{ recurso_id: string }>(
      "SELECT recurso_id FROM auditoria_eventos WHERE acao = 'precos.referencias.importar' ORDER BY sequencia DESC LIMIT 1",
    );
    assert.equal(evento?.recurso_id, `SICRO-${consulta.uf}-2026-11`);
  });

  test('escopo de UASG: usuário de outra UASG não vê nem pesquisa o processo (404)', async () => {
    const criado = await chamar(app, admin, 'POST', '/api/v1/usuarios', {
      nome: 'Vânia Escopo Restrito',
      email: 'precos.restrito@agora.demo',
      cpf: gerarCpf(new Prng(2_325)),
      perfis: ['planejamento'],
      uasgs: ['910001'],
      unidadeInternaId: null,
    });
    assert.equal(criado.statusCode, 201);
    const id = criado.json<UsuarioAdmin>().id;
    const temporaria = (await chamar(app, admin, 'POST', `/api/v1/usuarios/${id}/senha-temporaria`)).json<RespostaSenhaTemporaria>();
    let restrito = await entrar(app, 'precos.restrito@agora.demo', temporaria.senhaTemporaria);
    await chamar(app, restrito, 'POST', '/api/v1/sessao/senha', { senhaAtual: temporaria.senhaTemporaria, novaSenha: 'Precos-Restrito-2026' });
    restrito = await entrar(app, 'precos.restrito@agora.demo', 'Precos-Restrito-2026');
    const base = `/api/v1/processos/${scanners.id}/pesquisa-precos`;
    assert.equal((await chamar(app, restrito, 'GET', base)).statusCode, 404);
    assert.equal((await chamar(app, restrito, 'POST', `${base}/consultas`, {})).statusCode, 404);
    assert.equal((await chamar(app, restrito, 'POST', `${base}/projecao`, { dataPrevista: '2027-05-10', percentualCambial: 0 })).statusCode, 404);
  });
});

/** `fetch` falso: responde por trecho do endereço e registra as chamadas (endereço e cabeçalhos). */
function fetchFalso(rotas: Record<string, () => Response>) {
  const chamadas: { url: string; cabecalhos: Record<string, string> }[] = [];
  const fetch: FuncaoFetch = async (entrada, init) => {
    const url = String(entrada);
    chamadas.push({ url, cabecalhos: { ...((init?.headers as Record<string, string> | undefined) ?? {}) } });
    const chave = Object.keys(rotas).find((k) => url.includes(k));
    return chave ? (rotas[chave]?.() ?? new Response('', { status: 404 })) : new Response('', { status: 404 });
  };
  return { fetch, chamadas };
}

const json = (corpo: unknown, status = 200) => () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const SIDRA = [
  { NC: 'Nível Territorial (Código)', V: 'Valor', D3C: 'Mês (Código)' },
  ...Array.from({ length: 12 }, (_, i) => {
    const total = 2025 * 12 + 10 + i; // 2025-11 … 2026-10
    return { NC: '1', V: '0.40', D3C: `${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, '0')}` };
  }),
];
const SGS = Array.from({ length: 13 }, (_, i) => {
  const total = 2025 * 12 + 9 + i; // 2025-10 … 2026-10
  return { data: `01/${String((total % 12) + 1).padStart(2, '0')}/${Math.floor(total / 12)}`, valor: (5 * 1.005 ** i).toFixed(4) };
});

describe('pesquisa de preços — modo online com fetch falso', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let scanners: ProcessoResumo;
  const respostas: Record<string, () => Response> = {
    '/modulo-pesquisa-preco/1_consultarMaterial': json({
      resultado: [
        { idCompra: '99000105900012026', numeroItemCompra: 1, descricaoItem: 'SCANNER CORPORAL', precoUnitario: 1175000.5, dataCompra: '2026-09-10', codigoUasg: '999001', nomeUasg: 'UNIDADE FICTICIA', estado: 'DF', siglaUnidadeFornecimento: 'UN', nomeFornecedor: 'EMPRESA FICTICIA' },
        { idCompra: '99000105900022026', descricaoItem: 'SCANNER CORPORAL', precoUnitario: 1190000, dataCompra: '2026-06-01', codigoUasg: '999003' },
        { idCompra: '99000105900032026', descricaoItem: 'SEM PRECO', precoUnitario: null, dataCompra: '2026-06-01' },
      ],
      totalRegistros: 3,
    }),
    '/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133': json({
      resultado: [
        { numeroControlePNCPCompra: '00000000000191-1-000001/2026', numeroItemPncp: 1, descricaoResumida: 'Scanner corporal', valorUnitarioResultado: 1201000, dataResultado: '2026-08-20T00:00:00', unidadeOrgaoCodigoUnidade: '999002', unidadeOrgaoUfSigla: 'SP' },
      ],
    }),
    '/notas-fiscais?': json([
      { chaveNotaFiscal: '53261099999999000199550010000012341000012345', numero: '1234', serie: '1', dataEmissao: '15/09/2026', orgaoDestinatario: 'ORGAO FICTICIO' },
      { chaveNotaFiscal: '53250199999999000199550010000000011000000011', numero: '11', serie: '1', dataEmissao: '10/01/2025', orgaoDestinatario: 'ORGAO FICTICIO' },
    ]),
    '/notas-fiscais-por-chave?': json({
      notaFiscalDTO: { numero: '1234' },
      itensNotaFiscal: [
        { descricaoProdutoServico: 'CABO DE REDE', valorUnitario: '35,00', unidade: 'UN' },
        { descricaoProdutoServico: 'SCANNER CORPORAL DE INSPECAO', valorUnitario: '1.188.500,00', unidade: 'UN' },
      ],
    }),
    '/values/t/1737/': json(SIDRA),
    '/bcdata.sgs.3698/': json(SGS),
  };
  const falso = fetchFalso(respostas);

  before(async () => {
    app = await criarAppTeste({ env: { ...LIMITE, AGORA_INTEGRACOES: 'online', AGORA_TRANSPARENCIA_CHAVE: 'chave-teste-transparencia' }, fetch: falso.fetch });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    scanners = await processoPorTitulo(app, planejamento, 'scanners');
  });
  after(async () => {
    await app.close();
  });

  test('consulta as APIs oficiais pelo servidor, com a chave no cabeçalho e fora do endereço registrado', async () => {
    const consulta = (await chamar(app, planejamento, 'POST', `/api/v1/processos/${scanners.id}/pesquisa-precos/consultas`, {})).json<ConsultaPrecos>();
    assert.equal(consulta.modo, 'online');
    assert.deepEqual(
      consulta.fontes.map((f) => [f.fonte, f.situacao, f.modo, f.registros]),
      [
        ['PAINEL_PRECOS', 'ok', 'online', 2],
        ['CONTRATACOES_SIMILARES', 'ok', 'online', 1],
        ['NOTAS_FISCAIS', 'ok', 'online', 1],
        ['SINAPI', 'nao_aplicavel', 'local', 0],
        ['SICRO', 'nao_aplicavel', 'local', 0],
      ],
    );
    const painel = consulta.fontes[0];
    assert.match(painel?.endereco ?? '', /^https:\/\/dadosabertos\.compras\.gov\.br\/modulo-pesquisa-preco\/1_consultarMaterial\?tipo=codigoItemCatalogo&codigo=470830&/);
    assert.match(painel?.endereco ?? '', /dataCompraInicio=2025-11-09&dataCompraFim=2026-11-09/);
    assert.match(painel?.mensagem ?? '', /1 registro\(s\) sem preço ou data ignorado/);
    assert.deepEqual(
      consulta.sugestoes.map((s) => [s.fonte, s.valorUnitario, s.data, s.inciso]),
      [
        ['PAINEL_PRECOS', 117_500_050, '2026-09-10', 'art. 23, § 1º, I'],
        ['PAINEL_PRECOS', 119_000_000, '2026-06-01', 'art. 23, § 1º, I'],
        ['CONTRATACOES_SIMILARES', 120_100_000, '2026-08-20', 'art. 23, § 1º, II'],
        ['NOTAS_FISCAIS', 118_850_000, '2026-09-15', 'art. 23, § 1º, V'],
      ],
    );
    assert.equal(consulta.sugestoes[0]?.local, 'UASG 999001 — UNIDADE FICTICIA — DF');
    assert.ok(!JSON.stringify(consulta).includes('EMPRESA FICTICIA'), 'nome de fornecedor não é guardado');
    const transparencia = falso.chamadas.filter((c) => c.url.includes('/notas-fiscais'));
    assert.equal(transparencia.length, 2, 'lista e só a nota do último ano detalhada');
    assert.ok(transparencia.every((c) => c.cabecalhos['chave-api-dados'] === 'chave-teste-transparencia'));
    assert.ok(consulta.fontes.every((f) => !(f.endereco ?? '').includes('chave-teste')));
  });

  test('falha de uma fonte não derruba as outras; sem chave do Portal da Transparência, NF-e depende de acesso', async () => {
    const original = respostas['/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133'];
    respostas['/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133'] = json({ erro: 'requisição inválida' }, 400);
    respostas['/notas-fiscais?'] = json({}, 401);
    try {
      const consulta = (await chamar(app, planejamento, 'POST', `/api/v1/processos/${scanners.id}/pesquisa-precos/consultas`, {})).json<ConsultaPrecos>();
      const porFonte = Object.fromEntries(consulta.fontes.map((f) => [f.fonte, f]));
      assert.equal(porFonte.PAINEL_PRECOS?.situacao, 'ok');
      assert.equal(porFonte.CONTRATACOES_SIMILARES?.situacao, 'falhou');
      assert.match(porFonte.CONTRATACOES_SIMILARES?.mensagem ?? '', /recusou a consulta \(HTTP 400\)/);
      assert.equal(porFonte.NOTAS_FISCAIS?.situacao, 'falhou');
      assert.match(porFonte.NOTAS_FISCAIS?.mensagem ?? '', /confira a chave de acesso/);
    } finally {
      if (original) respostas['/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133'] = original;
    }

    const semChave = await criarAppTeste({ env: { ...LIMITE, AGORA_INTEGRACOES: 'online' }, fetch: falso.fetch });
    try {
      const credenciais = await entrar(semChave, 'planejamento@agora.demo');
      const processo = await processoPorTitulo(semChave, credenciais, 'scanners');
      const consulta = (await chamar(semChave, credenciais, 'POST', `/api/v1/processos/${processo.id}/pesquisa-precos/consultas`, {})).json<ConsultaPrecos>();
      const nf = consulta.fontes.find((f) => f.fonte === 'NOTAS_FISCAIS');
      assert.equal(nf?.situacao, 'dependente_de_acesso');
      assert.match(nf?.mensagem ?? '', /AGORA_TRANSPARENCIA_CHAVE/);
    } finally {
      await semChave.close();
    }
  });

  test('projeção com IPCA do IBGE e câmbio do Banco Central consultados online; falha usa a série gravada com aviso', async () => {
    const url = `/api/v1/processos/${scanners.id}/pesquisa-precos/projecao`;
    const p = (await chamar(app, planejamento, 'POST', url, { dataPrevista: '2027-05-09', percentualCambial: 25 })).json<ProjecaoValorEstimado>();
    assert.deepEqual(p.fontes.map((f) => [f.serie, f.modo, f.competencias.length]), [
      ['IPCA', 'online', 12],
      ['CAMBIO_USD', 'online', 13],
    ]);
    assert.equal(p.inflacao.taxaMensalMedia, 0.4);
    assert.equal(p.cambio?.taxaMensalMedia, 0.5);
    assert.match(p.fontes[0]?.fonte ?? '', /IBGE — SIDRA, tabela 1737/);
    const m = 181 / 30.4375;
    const esperado = p.valorBase * (0.75 * 1.004 ** m + 0.25 * 1.005 ** m);
    assert.ok(Math.abs(p.valorProjetado - esperado) / esperado < 1e-5, 'câmbio com 4 casas decimais: diferença desprezível');
    assert.ok(falso.chamadas.some((c) => c.url === 'https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/last%2012'));
    assert.ok(falso.chamadas.some((c) => c.url === 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.3698/dados/ultimos/13?formato=json'));

    const original = respostas['/values/t/1737/'];
    respostas['/values/t/1737/'] = json({}, 404);
    try {
      const comFalha = (await chamar(app, planejamento, 'POST', url, { dataPrevista: '2027-05-09', percentualCambial: 0 })).json<ProjecaoValorEstimado>();
      assert.ok(comFalha.premissas.some((x) => /IBGE \(SIDRA\) recusou a consulta \(HTTP 404\).*última série gravada/.test(x)));
      assert.equal(comFalha.fontes[0]?.modo, 'online', 'a série gravada na consulta anterior continua valendo');
    } finally {
      if (original) respostas['/values/t/1737/'] = original;
    }
  });
});
