import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { IntegracaoSeiProcesso, MateriaDou, Pagina, ProcessoDetalhe, ProcessoResumo, ResumoPublicacoesDou } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.ts';
import { lerXml, buscarXml, textoXml, type NoXml } from '../src/compartilhado/xml.ts';
import { carregarConfig, ErroConfiguracao } from '../src/config.ts';
import { FalhaTarefa } from '../src/fila/tipos.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { lerResultadosDou } from '../src/integracoes/dou-consulta.ts';
import { criarClienteSei, envelopeSei } from '../src/integracoes/sei.ts';
import { driverSeiWebservice, ErroEnvio } from '../src/modulos/notificacoes/canais.ts';
import { chamar, entrar, INICIO_TESTES, obterJson, relogioManual, type Credenciais } from './apoio.ts';

// ───────────────────────── SEI falso (SeiWS, SOAP RPC/encoded) ─────────────────────────

const ENV_SEI = {
  AGORA_SEI_URL: 'https://sei.exemplo.gov.br/sei/ws/SeiWS.php',
  AGORA_SEI_SIGLA_SISTEMA: 'AGORA',
  AGORA_SEI_IDENTIFICACAO_SERVICO: 'chave-sintetica-de-teste',
  AGORA_SEI_ID_UNIDADE: '110000001',
  AGORA_SEI_ID_TIPO_PROCEDIMENTO: '100000350',
  AGORA_SEI_ID_SERIE: '12',
};

interface ChamadaSei {
  operacao: string;
  corpo: NoXml;
  soapAction: string | null;
}

function respostaSoap(operacao: string, parametros: string): Response {
  const xml =
    '<?xml version="1.0" encoding="ISO-8859-1"?>' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="Sei" xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<SOAP-ENV:Body><ns1:${operacao}Response><parametros>${parametros}</parametros></ns1:${operacao}Response></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  return new Response(Buffer.from(xml, 'latin1'), { status: 200, headers: { 'content-type': 'text/xml; charset=ISO-8859-1' } });
}

function faultSoap(mensagem: string): Response {
  const xml =
    '<?xml version="1.0" encoding="ISO-8859-1"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>' +
    `<SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>${mensagem}</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  return new Response(Buffer.from(xml, 'latin1'), { status: 500, headers: { 'content-type': 'text/xml; charset=ISO-8859-1' } });
}

/** SEI do órgão simulado: confere as credenciais e responde cada operação como o SeiWS v4. */
function seiFalso() {
  const estado = {
    modo: 'ok' as 'ok' | 'indisponivel' | 'recusa_documento',
    documentos: 0,
    chamadas: [] as ChamadaSei[],
    assinaturas: new Map<string, string>(),
  };
  const fetch: FuncaoFetch = async (entrada, init) => {
    assert.equal(String(entrada), ENV_SEI.AGORA_SEI_URL);
    const corpo = lerXml(Buffer.from(init?.body as Uint8Array).toString('latin1'));
    const operacaoNo = buscarXml(corpo, 'Body')?.filhos[0];
    const operacao = operacaoNo?.local ?? '';
    estado.chamadas.push({ operacao, corpo, soapAction: new Headers(init?.headers).get('soapaction') });
    if (estado.modo === 'indisponivel') return new Response('Service Unavailable', { status: 503 });
    if (textoXml(operacaoNo, 'SiglaSistema') !== 'AGORA' || textoXml(operacaoNo, 'IdentificacaoServico') !== 'chave-sintetica-de-teste') {
      return faultSoap('Acesso negado ao sistema');
    }
    switch (operacao) {
      case 'gerarProcedimento':
        return respostaSoap(
          operacao,
          '<IdProcedimento>1210000000774</IdProcedimento><ProcedimentoFormatado>08000.777001/2026-41</ProcedimentoFormatado><LinkAcesso>https://sei.exemplo.gov.br/sei/processo?id=774</LinkAcesso><RetornoInclusaoDocumentos/>',
        );
      case 'incluirDocumento': {
        if (estado.modo === 'recusa_documento') return faultSoap('Tipo de documento não liberado para o serviço');
        estado.documentos++;
        const numero = String(3_934_000 + estado.documentos);
        return respostaSoap(operacao, `<IdDocumento>11400000${numero}</IdDocumento><DocumentoFormatado>${numero}</DocumentoFormatado><LinkAcesso>https://sei.exemplo.gov.br/sei/documento?id=${numero}</LinkAcesso>`);
      }
      case 'consultarDocumento': {
        const numero = textoXml(operacaoNo, 'ProtocoloDocumento') ?? '';
        const assinatura = estado.assinaturas.get(numero);
        const itens = assinatura
          ? `<item><Nome>${assinatura}</Nome><CargoFuncao>Coordenadora de Licitações</CargoFuncao><DataHora>10/11/2026 09:30:00</DataHora><IdUsuario>100</IdUsuario><Sigla>sigla.teste</Sigla></item>`
          : '';
        return respostaSoap(operacao, `<IdDocumento>11400000${numero}</IdDocumento><DocumentoFormatado>${numero}</DocumentoFormatado><Assinaturas>${itens}</Assinaturas>`);
      }
      case 'gerarBloco':
        return respostaSoap(operacao, '4521');
      case 'enviarProcesso':
        return respostaSoap(operacao, 'true');
      default:
        return faultSoap(`Operação desconhecida: ${operacao}`);
    }
  };
  return { estado, fetch };
}

async function appTeste(env: Record<string, string>, relogio: () => Date, fetch?: FuncaoFetch): Promise<FastifyInstance> {
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

/** Processo com documentos aprovados que ainda não foi enviado ao SEI. */
async function processoSemSei(app: FastifyInstance): Promise<string> {
  const [linha] = await app.agora.banco.consultar<{ id: string }>(
    `SELECT p.id FROM processos p
      WHERE NOT EXISTS (SELECT 1 FROM sei_processos s WHERE s.processo_id = p.id)
        AND (SELECT count(*) FROM processos_arvore_sei a WHERE a.processo_id = p.id AND a.documento_id IS NOT NULL) >= 2
      ORDER BY p.numero_sei LIMIT 1`,
  );
  assert.ok(linha, 'nenhum processo com documentos aprovados fora do SEI na carga sintética');
  return linha.id;
}

async function acoesAuditadas(app: FastifyInstance, recursoId: string): Promise<string[]> {
  const linhas = await app.agora.banco.consultar<{ acao: string }>('SELECT acao FROM auditoria_eventos WHERE recurso_id = $1 ORDER BY sequencia', [recursoId]);
  return linhas.map((l) => l.acao);
}

async function esperar(condicao: () => Promise<boolean>, descricao: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error(`Tempo esgotado esperando: ${descricao}`);
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
}

// ───────────────────────── cliente SOAP ─────────────────────────

describe('cliente do SeiWS (SOAP falso)', () => {
  test('envelope RPC/encoded com namespace Sei, SOAPAction e credenciais; documento externo em base64; texto fora do Latin-1 escapado', async () => {
    const sei = seiFalso();
    const cliente = criarClienteSei({ url: ENV_SEI.AGORA_SEI_URL, siglaSistema: 'AGORA', identificacaoServico: 'chave-sintetica-de-teste', idUnidade: '110000001', fetch: sei.fetch });
    const r = await cliente.incluirDocumento({
      protocoloProcedimento: '08000.777001/2026-41',
      idSerie: '12',
      numero: '41730001',
      nomeArvore: 'Edital — versão 1',
      data: '09/11/2026',
      remetente: { sigla: 'ORG', nome: 'Órgão de exemplo' },
      nomeArquivo: 'edital.pdf',
      conteudo: Buffer.from('%PDF-1.4 teste'),
      nivelAcesso: 1,
      idHipoteseLegal: null,
      observacao: null,
    });
    assert.deepEqual(r, { idDocumento: '114000003934001', documentoFormatado: '3934001', linkAcesso: 'https://sei.exemplo.gov.br/sei/documento?id=3934001' });
    const [chamada] = sei.estado.chamadas;
    assert.equal(chamada?.soapAction, '"SeiAction"');
    const documento = buscarXml(chamada?.corpo, 'Documento');
    assert.equal(textoXml(documento, 'Tipo'), 'R');
    assert.equal(textoXml(documento, 'NivelAcesso'), '1');
    assert.equal(Buffer.from(textoXml(documento, 'Conteudo') ?? '', 'base64').toString(), '%PDF-1.4 teste');
    assert.equal(textoXml(documento, 'NomeArvore'), 'Edital — versão 1', 'o travessão vai como referência numérica e volta igual');
    const bruto = envelopeSei('incluirDocumento', [['NomeArvore', 'Edital — versão 1']]);
    assert.match(bruto, /<sei:incluirDocumento soapenv:encodingStyle="http:\/\/schemas\.xmlsoap\.org\/soap\/encoding\/">/);
    assert.match(bruto, /xmlns:sei="Sei"/);
  });

  test('assinaturas com data do SEI (Brasília) e acentos em ISO-8859-1; Fault é recusa definitiva; 503 e rede são transitórios', async () => {
    const sei = seiFalso();
    sei.estado.assinaturas.set('3934001', 'Ana Lúcia Exemplo');
    const cliente = criarClienteSei({ url: ENV_SEI.AGORA_SEI_URL, siglaSistema: 'AGORA', identificacaoServico: 'chave-sintetica-de-teste', idUnidade: '110000001', fetch: sei.fetch });
    const consulta = await cliente.consultarDocumento('3934001');
    assert.deepEqual(consulta.assinaturas, [{ nome: 'Ana Lúcia Exemplo', cargoFuncao: 'Coordenadora de Licitações', assinadoEm: '2026-11-10T12:30:00.000Z', sigla: 'sigla.teste' }]);
    assert.equal((await cliente.consultarDocumento('9999999')).assinaturas.length, 0);
    assert.equal(await cliente.gerarBloco({ descricao: 'x', documentos: ['3934001'], unidadesDisponibilizacao: [] }), '4521');

    const negado = criarClienteSei({ url: ENV_SEI.AGORA_SEI_URL, siglaSistema: 'OUTRO', identificacaoServico: 'x', idUnidade: '1', fetch: sei.fetch });
    await assert.rejects(negado.consultarDocumento('1'), (e: unknown) => e instanceof FalhaTarefa && !e.retentavel && /SEI recusou consultarDocumento: Acesso negado/.test(e.message));
    sei.estado.modo = 'indisponivel';
    await assert.rejects(cliente.consultarDocumento('1'), (e: unknown) => e instanceof FalhaTarefa && e.retentavel && /HTTP 503/.test(e.message));
    const semRede = criarClienteSei({ url: ENV_SEI.AGORA_SEI_URL, siglaSistema: 'AGORA', identificacaoServico: 'x', idUnidade: '1', fetch: () => Promise.reject(new TypeError('fetch failed')) });
    await assert.rejects(semRede.consultarDocumento('1'), (e: unknown) => e instanceof FalhaTarefa && e.retentavel && /fetch failed/.test(e.message));
  });

  test('configuração: AGORA_SEI_* juntos; ids numéricos; o canal SEI das notificações exige o web service configurado', () => {
    const base = { AGORA_DADOS_DIR: 'memory://' };
    assert.equal(carregarConfig({ ...base, ...ENV_SEI }).sei.configurado, true);
    assert.equal(carregarConfig(base).sei.configurado, false);
    assert.throws(() => carregarConfig({ ...base, AGORA_SEI_URL: ENV_SEI.AGORA_SEI_URL }), (e: unknown) => e instanceof ErroConfiguracao && e.problemas.some((p) => p.startsWith('AGORA_SEI_*')));
    assert.throws(() => carregarConfig({ ...base, ...ENV_SEI, AGORA_SEI_ID_UNIDADE: 'abc' }), ErroConfiguracao);
    assert.throws(() => carregarConfig({ ...base, AGORA_NOTIFICACOES_SEI: 'webservice' }), ErroConfiguracao);
    assert.equal(carregarConfig({ ...base, ...ENV_SEI, AGORA_NOTIFICACOES_SEI: 'webservice' }).notificacoes.sei, 'webservice');
  });
});

describe('canal SEI das notificações ligado ao web service', () => {
  test('o aviso entra como documento no processo SEI do instrumento; recusa é permanente, indisponibilidade não', async () => {
    const sei = seiFalso();
    const config = carregarConfig({ AGORA_DADOS_DIR: 'memory://', ...ENV_SEI, AGORA_NOTIFICACOES_SEI: 'webservice' });
    const driver = driverSeiWebservice(config, sei.fetch);
    assert.equal(driver.modo, 'webservice');
    const mensagem = {
      envioId: '5f0c1d2e-0000-4000-8000-000000000001',
      canal: 'sei' as const,
      papel: 'fiscal' as const,
      destinatario: 'Fiscal do contrato',
      endereco: '08000.777001/2026-41',
      cpf: null,
      assunto: 'Vencimento do contrato 12/2026',
      corpo: 'O contrato vence em 30 dias.',
      agora: new Date(INICIO_TESTES),
    };
    const r = await driver.enviar(mensagem);
    assert.equal(r.modo, 'webservice');
    assert.match(r.protocolo, /^Documento SEI nº 3934001 \(processo 08000\.777001\/2026-41\)$/);
    const documento = buscarXml(sei.estado.chamadas[0]?.corpo, 'Documento');
    assert.equal(textoXml(documento, 'ProtocoloProcedimento'), '08000.777001/2026-41');
    assert.ok((textoXml(documento, 'Conteudo') ?? '').startsWith('JVBER'), 'PDF em base64');

    sei.estado.modo = 'recusa_documento';
    await assert.rejects(driver.enviar(mensagem), (e: unknown) => e instanceof ErroEnvio && e.permanente);
    sei.estado.modo = 'indisponivel';
    await assert.rejects(driver.enviar(mensagem), (e: unknown) => e instanceof ErroEnvio && !e.permanente);
    await assert.rejects(driver.enviar({ ...mensagem, endereco: null }), (e: unknown) => e instanceof ErroEnvio && e.permanente);
  });
});

// ───────────────────────── SEI simulado (offline) ─────────────────────────

describe('integração com o SEI em modo offline (simulação determinística)', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  let agente: Credenciais;
  let juridico: Credenciais;
  let consulta: Credenciais;
  let chamadasExternas = 0;

  before(async () => {
    app = await appTeste({}, tempo.relogio, async () => {
      chamadasExternas++;
      return new Response('', { status: 500 });
    });
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('carga: o processo mais adiantado já está no SEI, com bloco de assinatura', async () => {
    const [linha] = await app.agora.banco.consultar<{ processo_id: string }>('SELECT processo_id FROM sei_processos LIMIT 1');
    assert.ok(linha);
    const sei = await obterJson<IntegracaoSeiProcesso>(app, agente, `/api/v1/processos/${linha.processo_id}/sei`);
    assert.equal(sei.modo, 'offline');
    assert.ok(sei.processo);
    assert.ok(sei.documentos.length >= 2 && sei.documentos.every((d) => d.enviado && d.blocoAssinatura !== null));
  });

  test('enviar: gera o processo, inclui os documentos com o número da árvore, monta o bloco; consulta reflete a assinatura', async () => {
    const id = await processoSemSei(app);
    const detalhe = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`);
    const antes = await obterJson<IntegracaoSeiProcesso>(app, agente, `/api/v1/processos/${id}/sei`);
    assert.equal(antes.processo, null);
    assert.ok(antes.pendentesEnvio >= 2);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/consultar-assinaturas`)).statusCode, 422, 'nada no SEI ainda');

    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/sei/enviar`)).statusCode, 403, 'jurídico não envia');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${id}/sei`)).statusCode, 403);

    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/enviar`);
    assert.equal(r.statusCode, 200, r.body);
    const sei = r.json<IntegracaoSeiProcesso>();
    assert.equal(sei.envio?.situacao, 'concluida');
    assert.equal(sei.processo?.numero, detalhe.numeroSei, 'na simulação, o número do processo SEI é o da Ágora');
    assert.equal(sei.pendentesEnvio, 0);
    const comDocumento = sei.documentos.filter((d) => d.enviado);
    assert.equal(comDocumento.length, antes.pendentesEnvio);
    assert.ok(comDocumento.every((d) => d.numeroSei === d.numeroArvore && d.blocoAssinatura !== null && d.nivelAcesso !== null));
    assert.equal(new Set(comDocumento.map((d) => d.blocoAssinatura)).size, 1, 'um bloco de assinatura para os documentos do envio');

    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/enviar`)).statusCode, 422, 'nada novo a enviar');

    const consultado = await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/sei/consultar-assinaturas`);
    assert.equal(consultado.statusCode, 200, consultado.body);
    const apos = consultado.json<IntegracaoSeiProcesso>();
    assert.equal(apos.consulta?.situacao, 'concluida');
    assert.ok(apos.documentos.filter((d) => d.enviado).every((d) => d.assinado && d.resumoAssinatura !== '' && d.consultadoEm !== null));
    const arvore = (await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`)).arvoreSei;
    assert.ok(arvore.filter((a) => comDocumento.some((d) => d.numeroArvore === a.numero)).every((a) => a.assinado && a.assinadoPor));

    const acoes = await acoesAuditadas(app, id);
    for (const acao of ['processo.sei.enviar', 'sei.enviar', 'processo.sei.consultar_assinaturas', 'sei.assinaturas.consultar']) assert.ok(acoes.includes(acao), acao);
    assert.equal(chamadasExternas, 0, 'a simulação não sai do servidor');
  });
});

// ───────────────────────── SEI real (SOAP falso) ─────────────────────────

describe('integração com o SEI em modo online (SeiWS falso)', () => {
  const tempo = relogioManual();
  const sei = seiFalso();
  let app: FastifyInstance;
  let agente: Credenciais;

  before(async () => {
    app = await appTeste({ AGORA_INTEGRACOES: 'online', ...ENV_SEI, AGORA_SEI_ID_UNIDADE_DESTINO: '110000099' }, tempo.relogio, sei.fetch);
    agente = await entrar(app, 'agente@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('recusa do SEI vai para a fila de erro; o reenvio continua de onde parou, sem gerar outro processo; indisponibilidade gera nova tentativa', async () => {
    const id = await processoSemSei(app);

    // 1) O SEI recusa a inclusão do documento: a tarefa vai para a fila de erro, com o motivo.
    sei.estado.modo = 'recusa_documento';
    const recusado = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/enviar`)).json<IntegracaoSeiProcesso>();
    assert.equal(recusado.envio?.situacao, 'erro');
    assert.match(recusado.envio?.ultimoErro ?? '', /SEI recusou incluirDocumento: Tipo de documento não liberado/);
    assert.equal(recusado.processo?.numero, '08000.777001/2026-41', 'o processo gerado fica gravado (prova do envio)');
    assert.equal(recusado.processo?.link, 'https://sei.exemplo.gov.br/sei/processo?id=774');

    // 2) O SEI fica fora do ar: o reenvio reabre a tarefa e ela aguarda nova tentativa.
    sei.estado.modo = 'indisponivel';
    const fora = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/enviar`)).json<IntegracaoSeiProcesso>();
    assert.equal(fora.envio?.situacao, 'nova_tentativa');
    assert.match(fora.envio?.ultimoErro ?? '', /HTTP 503/);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/enviar`)).statusCode, 422, 'não duplica o pedido na fila');

    // 3) De volta: inclui os documentos, monta o bloco e envia o processo à unidade de destino.
    sei.estado.modo = 'ok';
    tempo.avancar(60_000);
    await app.fila.trabalhador?.varrer();
    await esperar(async () => (await obterJson<IntegracaoSeiProcesso>(app, agente, `/api/v1/processos/${id}/sei`)).envio?.situacao === 'concluida', 'envio concluído');
    const enviado = await obterJson<IntegracaoSeiProcesso>(app, agente, `/api/v1/processos/${id}/sei`);
    assert.equal(sei.estado.chamadas.filter((c) => c.operacao === 'gerarProcedimento').length, 1, 'o processo não é gerado de novo');
    assert.equal(enviado.processo?.unidadeDestino, '110000099');
    assert.ok(enviado.processo?.enviadoUnidadeEm);
    assert.ok(enviado.documentos.filter((d) => d.enviado).every((d) => /^39340\d\d$/.test(d.numeroSei ?? '') && d.blocoAssinatura === '4521' && d.linkSei?.startsWith('https://sei.exemplo.gov.br/')));
    assert.equal(enviado.pendentesEnvio, 0);
    const ordem = sei.estado.chamadas.map((c) => c.operacao).filter((o) => o !== 'incluirDocumento');
    assert.deepEqual(ordem, ['gerarProcedimento', 'gerarBloco', 'enviarProcesso']);
    const gerar = buscarXml(sei.estado.chamadas[0]?.corpo, 'Procedimento');
    assert.equal(textoXml(gerar, 'IdTipoProcedimento'), '100000350');
    const bloco = buscarXml(sei.estado.chamadas.find((c) => c.operacao === 'gerarBloco')?.corpo, 'Documentos');
    assert.equal(bloco?.filhos.length, enviado.documentos.filter((d) => d.enviado).length);

    // 4) Assinatura feita no SEI com certificado: a consulta reflete quem assinou e quando.
    const primeiro = enviado.documentos.find((d) => d.enviado);
    assert.ok(primeiro?.numeroSei);
    // Na carga sintética os documentos já têm a assinatura simulada da Ágora: este fica pendente, como no SEI real.
    await app.agora.banco.executar(
      `UPDATE processos_arvore_sei SET assinado_em = NULL, assinado_por = NULL, assinado_por_nome = NULL WHERE processo_id = $1 AND numero = $2`,
      [id, primeiro.numeroArvore],
    );
    sei.estado.assinaturas.set(primeiro.numeroSei, 'Ana Lúcia Exemplo');
    const consultado = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/consultar-assinaturas`)).json<IntegracaoSeiProcesso>();
    const refletido = consultado.documentos.find((d) => d.numeroArvore === primeiro.numeroArvore);
    assert.equal(refletido?.assinado, true);
    assert.equal(refletido?.resumoAssinatura, 'Ana Lúcia Exemplo (Coordenadora de Licitações)');
    assert.deepEqual(refletido?.assinaturas, [{ nome: 'Ana Lúcia Exemplo', cargoFuncao: 'Coordenadora de Licitações', assinadoEm: '2026-11-10T12:30:00.000Z' }]);
    const arvore = (await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`)).arvoreSei.find((a) => a.numero === primeiro.numeroArvore);
    assert.equal(arvore?.assinado, true);
    assert.equal(arvore?.assinadoEm, '2026-11-10T12:30:00.000Z');
    assert.match(arvore?.assinadoPor ?? '', /Ana Lúcia Exemplo/);

    // 5) Com o SEI real, a assinatura simulada na Ágora deixa de existir.
    const outro = consultado.documentos.find((d) => d.enviado && !d.assinado);
    if (outro) {
      const simulada = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/assinar`, { documentoNumero: outro.numeroArvore });
      assert.equal(simulada.statusCode, 422);
    }
  });
});

// ───────────────────────── DOU ─────────────────────────

const HTML_DOU = (itens: unknown[]) =>
  `<html><body><script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">${JSON.stringify({ jsonArray: itens })}</script></body></html>`;

describe('consulta pública do DOU', () => {
  test('lê os resultados do JSON embutido na página de busca; página sem os resultados é falha definitiva', () => {
    const r = lerResultadosDou(
      HTML_DOU([{ pubName: 'DO3', title: 'AVISO DE LICITAÇÃO', content: '<p>Processo nº 08000.000001/2026-00</p>', pubDate: '10/11/2026', urlTitle: 'aviso-de-licitacao-1', editionNumber: '214', numberPage: '88' }]),
    );
    assert.deepEqual(r, [
      { titulo: 'AVISO DE LICITAÇÃO', resumo: ' Processo nº 08000.000001/2026-00 ', data: '2026-11-10', secao: 'DO3', url: 'https://www.in.gov.br/web/dou/-/aviso-de-licitacao-1', edicao: '214', pagina: '88' },
    ]);
    assert.throws(() => lerResultadosDou('<html></html>'), (e: unknown) => e instanceof FalhaTarefa && !e.retentavel);
  });
});

describe('publicação no DOU (offline)', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  let agente: Credenciais;
  let gestor: Credenciais;
  let juridico: Credenciais;
  let consulta: Credenciais;

  before(async () => {
    app = await appTeste({}, tempo.relogio);
    agente = await entrar(app, 'agente@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('carga: avisos dos editais publicados já conferidos; extrato enviado; aditivo em rascunho', async () => {
    const resumo = await obterJson<ResumoPublicacoesDou>(app, gestor, '/api/v1/publicacoes-dou/resumo');
    assert.equal(resumo.modo, 'offline');
    assert.ok(resumo.publicada >= 1 && resumo.enviada >= 1 && resumo.rascunho >= 1, JSON.stringify(resumo));
    const avisos = await obterJson<Pagina<MateriaDou>>(app, agente, '/api/v1/publicacoes-dou?tipo=aviso_licitacao&situacao=publicada');
    assert.ok(avisos.itens.every((m) => m.publicacao?.forma === 'consulta' && m.jornal !== null && m.automatica));
  });

  test('edital aceito no PNCP gera o aviso; envio pelo INCom; conferência antes e depois da edição; jornal; etapa 5 publicada', async () => {
    const lista = await obterJson<Pagina<ProcessoResumo>>(app, agente, `/api/v1/processos?busca=${encodeURIComponent('software')}`);
    const id = lista.itens[0]?.id;
    assert.ok(id);
    const p = await obterJson<ProcessoDetalhe>(app, juridico, `/api/v1/processos/${id}`);
    if (p.parecer.conclusao !== 'favoravel') {
      const r = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, { itens: p.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })), conclusao: 'favoravel' });
      assert.equal(r.statusCode, 200, r.body);
    }
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/publicacoes-dou', { tipo: 'aviso_licitacao', processoId: id })).statusCode, 422, 'antes do PNCP, não há aviso');
    const publicado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(publicado.statusCode, 200, publicado.body);
    assert.equal(publicado.json<ProcessoDetalhe>().publicacao.dou, 'na_fila');

    const doProcesso = await obterJson<Pagina<MateriaDou>>(app, agente, `/api/v1/publicacoes-dou?processoId=${id}`);
    const aviso = doProcesso.itens[0];
    assert.ok(aviso);
    assert.equal(aviso.tipo, 'aviso_licitacao');
    assert.equal(aviso.situacao, 'rascunho');
    assert.equal(aviso.automatica, true);
    assert.equal(aviso.obrigatoria, true);
    assert.match(aviso.texto, new RegExp(`Processo nº ${p.numeroSei.replace(/[./-]/g, '\\$&')}`));
    assert.doesNotMatch(aviso.texto, /\d{3}\.\d{3}\.\d{3}-\d{2}/, 'sem CPF');

    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/envio`, { protocolo: 'INCOM-2026-0001' })).statusCode, 403, 'aviso é do agente');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/conferir`)).statusCode, 422, 'só confere o que foi enviado');
    const envio = await chamar(app, agente, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/envio`, { protocolo: 'INCOM-2026-0001' });
    assert.equal(envio.statusCode, 200, envio.body);
    const enviado = envio.json<MateriaDou>();
    assert.equal(enviado.situacao, 'enviada');
    assert.equal(enviado.envio?.dataPrevista, '2026-11-10', 'enviada na segunda antes das 19h: edição de terça');
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/publicacoes-dou', { tipo: 'aviso_licitacao', processoId: id })).statusCode, 422, 'texto enviado não muda');

    const cedo = (await chamar(app, agente, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/conferir`)).json<MateriaDou>();
    assert.equal(cedo.situacao, 'enviada');
    assert.match(cedo.conferencia.resultado ?? '', /Ainda não localizada/);
    assert.equal(cedo.conferencia.vezes, 1);

    tempo.avancar(24 * 60 * 60 * 1000);
    agente = await entrar(app, 'agente@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
    const conferido = (await chamar(app, agente, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/conferir`)).json<MateriaDou>();
    assert.equal(conferido.situacao, 'publicada');
    assert.equal(conferido.publicacao?.data, '2026-11-10');
    assert.equal(conferido.publicacao?.forma, 'consulta');
    assert.equal(conferido.publicacao?.modo, 'offline');
    assert.equal(conferido.conferencia.vezes, 2);
    assert.equal((await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`)).publicacao.dou, 'publicado');

    const jornal = await chamar(app, agente, 'POST', `/api/v1/publicacoes-dou/${aviso.id}/jornal`, { nome: 'Jornal Exemplo de Circulação', data: '2026-11-10' });
    assert.equal(jornal.statusCode, 200, jornal.body);
    assert.deepEqual(jornal.json<MateriaDou>().jornal?.nome, 'Jornal Exemplo de Circulação');
    const acoes = await acoesAuditadas(app, aviso.id);
    for (const acao of ['dou.materia.enviar', 'dou.materia.conferir', 'dou.conferir', 'dou.materia.jornal']) assert.ok(acoes.includes(acao), acao);
  });

  test('extrato de contrato: gestor gera e registra a edição manualmente; permissões e escopo de UASG', async () => {
    const candidatos = await obterJson<{ contratoId: string; materiaId: string | null; uasg: string }[]>(app, gestor, '/api/v1/publicacoes-dou/candidatos?tipo=extrato_contrato');
    const alvo = candidatos.find((c) => c.materiaId === null);
    assert.ok(alvo);
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/publicacoes-dou', { tipo: 'extrato_contrato', contratoId: alvo.contratoId })).statusCode, 403);
    const gerado = await chamar(app, gestor, 'POST', '/api/v1/publicacoes-dou', { tipo: 'extrato_contrato', contratoId: alvo.contratoId });
    assert.equal(gerado.statusCode, 200, gerado.body);
    const extrato = gerado.json<MateriaDou>();
    assert.equal(extrato.obrigatoria, false);
    assert.match(extrato.identificacao, /^EXTRATO DE CONTRATO Nº /);
    assert.doesNotMatch(extrato.texto, /CPF \d/, 'CPF de pessoa física só mascarado');
    const refeito = (await chamar(app, gestor, 'POST', '/api/v1/publicacoes-dou', { tipo: 'extrato_contrato', contratoId: alvo.contratoId })).json<MateriaDou>();
    assert.equal(refeito.id, extrato.id, 'o rascunho é refeito, não duplicado');

    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${extrato.id}/publicacao`, { data: '2026-11-09', edicao: '213', pagina: '90' })).statusCode, 422, 'antes do envio');
    await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${extrato.id}/envio`, { protocolo: 'INCOM-2026-0002' });
    const invalida = await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${extrato.id}/publicacao`, { data: '2026-11-10', edicao: '214', pagina: '91', url: 'https://exemplo.com/x' });
    assert.equal(invalida.statusCode, 400, 'só o endereço do portal da Imprensa Nacional');
    const manual = await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${extrato.id}/publicacao`, {
      data: '2026-11-10',
      edicao: '214',
      pagina: '91',
      url: 'https://www.in.gov.br/web/dou/-/extrato-de-contrato-exemplo',
    });
    assert.equal(manual.statusCode, 200, manual.body);
    assert.equal(manual.json<MateriaDou>().publicacao?.forma, 'manual');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${extrato.id}/jornal`, { nome: 'Jornal Exemplo', data: '2026-11-10' })).statusCode, 403, 'jornal só para o aviso (agente)');

    // Consulta: só extratos (contratos:ler) e só das UASGs do seu escopo.
    const vistos = await obterJson<Pagina<MateriaDou>>(app, consulta, '/api/v1/publicacoes-dou?tamanhoPagina=100');
    const escopo = consulta.sessao.usuario.uasgs;
    assert.ok(vistos.itens.every((m) => m.tipo !== 'aviso_licitacao' && escopo.includes(m.uasg)));
    if (!escopo.includes(extrato.uasg)) assert.equal((await chamar(app, consulta, 'GET', `/api/v1/publicacoes-dou/${extrato.id}`)).statusCode, 404);
    assert.equal((await chamar(app, consulta, 'POST', '/api/v1/publicacoes-dou', { tipo: 'extrato_contrato', contratoId: alvo.contratoId })).statusCode, 403);
  });
});

describe('publicação no DOU (online: consulta pública falsa)', () => {
  test('a conferência busca pelo número do processo na Seção 3 e grava edição, página e endereço', async () => {
    const tempo = relogioManual(INICIO_TESTES + 2 * 24 * 60 * 60 * 1000);
    const pedidos: URL[] = [];
    let processoNumero = '';
    const fetch: FuncaoFetch = async (entrada) => {
      const url = new URL(String(entrada));
      pedidos.push(url);
      return new Response(
        HTML_DOU([
          { pubName: 'DO3', title: 'EXTRATO DE CONTRATO Nº 9/2026', content: `Processo nº ${processoNumero}. Objeto: ...`, pubDate: '11/11/2026', urlTitle: 'extrato-de-contrato-9', editionNumber: '216', numberPage: '77' },
        ]),
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    };
    const app = await appTeste({ AGORA_INTEGRACOES: 'online' }, tempo.relogio, fetch);
    try {
      const gestor = await entrar(app, 'gestor@agora.demo');
      const [enviada] = await app.agora.banco.consultar<{ id: string; processo_numero: string }>(
        "SELECT id, processo_numero FROM dou_materias WHERE situacao = 'enviada' AND tipo = 'extrato_contrato' LIMIT 1",
      );
      assert.ok(enviada, 'extrato enviado na carga sintética');
      processoNumero = enviada.processo_numero;
      const r = await chamar(app, gestor, 'POST', `/api/v1/publicacoes-dou/${enviada.id}/conferir`);
      assert.equal(r.statusCode, 200, r.body);
      const m = r.json<MateriaDou>();
      assert.equal(m.situacao, 'publicada');
      assert.deepEqual(
        { data: m.publicacao?.data, edicao: m.publicacao?.edicao, pagina: m.publicacao?.pagina, url: m.publicacao?.url, modo: m.publicacao?.modo },
        { data: '2026-11-11', edicao: '216', pagina: '77', url: 'https://www.in.gov.br/web/dou/-/extrato-de-contrato-9', modo: 'online' },
      );
      const pedido = pedidos[0];
      assert.equal(pedido?.origin + (pedido?.pathname ?? ''), 'https://www.in.gov.br/consulta/-/buscar/dou');
      assert.equal(pedido?.searchParams.get('q'), `"${processoNumero}"`);
      assert.equal(pedido?.searchParams.get('s'), 'do3');
    } finally {
      await app.close();
    }
  });
});
