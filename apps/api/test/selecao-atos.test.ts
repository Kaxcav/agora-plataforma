/**
 * Atos da seleção (etapa 6) pela API, com relógio controlado: amostra do vencedor provisório com reprovação e
 * convocação automática do próximo colocado (RN-20), habilitação e fase recursal única com os prazos do art. 165
 * (RN-22), decisão da autoridade superior, adjudicação e homologação com divulgação dos documentos preparatórios
 * na página pública do edital (RF-18). Processo sintético "coletes balísticos" da carga de demonstração.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EditalPublico, EventoAuditoria, Pagina, ProcessoDetalhe, ProcessoResumo, RespostaErro } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';
import { LINK_GRAVACAO_TESTE, MOTIVACAO_TESTE } from './apoio-selecao.ts';

const DIA_MS = 24 * 60 * 60 * 1000;

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

describe('atos da seleção: prova de conceito, fase recursal única, adjudicação e homologação', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  let agente: Credenciais;
  let gestor: Credenciais;
  let id: string;
  let fornecedores: Record<'escudo' | 'boreal' | 'guardiao', string>;
  const url = (sufixo: string) => `/api/v1/processos/${id}/selecao/${sufixo}`;
  const detalhe = () => obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`);
  const ok = async (credenciais: Credenciais, sufixo: string, corpo?: unknown): Promise<ProcessoDetalhe> => {
    const r = await chamar(app, credenciais, 'POST', url(sufixo), corpo);
    assert.equal(r.statusCode, 200, `${sufixo} → ${r.statusCode} ${r.body}`);
    return r.json<ProcessoDetalhe>();
  };
  const relogar = async () => {
    agente = await entrar(app, 'agente@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
  };

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' }, relogio: tempo.relogio });
    await relogar();
    const lista = await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100');
    const coletes = lista.itens.find((p) => p.titulo.toLowerCase().includes('coletes'));
    assert.ok(coletes);
    id = coletes.id;
    const linhas = await app.agora.banco.consultar<{ id: string; razao_social: string }>(
      "SELECT id, razao_social FROM fornecedores WHERE razao_social LIKE 'Escudo Forte%' OR razao_social LIKE 'Boreal%' OR razao_social LIKE 'Guardião%'",
    );
    const de = (prefixo: string) => linhas.find((l) => l.razao_social.startsWith(prefixo))?.id ?? '';
    fornecedores = { escudo: de('Escudo'), boreal: de('Boreal'), guardiao: de('Guardião') };
  });
  after(async () => {
    await app.close();
  });

  test('amostra exigida no edital: o vencedor provisório é convocado; avançar ou adjudicar antes disso é bloqueado', async () => {
    const p = await detalhe();
    assert.equal(p.etapaAtual, 6);
    assert.equal(p.parametrosEdital.provaConceito?.exigencia, 'amostra');
    assert.equal(p.selecao.proximoAto, 'convocar_prova_conceito');
    assert.equal(p.selecao.vencedorProvisorio?.id, fornecedores.escudo);
    assert.deepEqual(
      p.bloqueiosDetalhe.map((b) => b.regra),
      ['RN-20'],
    );
    const avanco = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(avanco.statusCode, 422);
    assert.equal(erro(avanco).detalhes?.[0]?.campo, 'RN-20');

    assert.equal((await chamar(app, gestor, 'POST', url('prova-conceito/convocacao'))).statusCode, 403, 'gestor não conduz o certame');
    assert.equal((await chamar(app, agente, 'POST', url('adjudicacao'), { motivacao: null })).statusCode, 403, 'agente não adjudica (art. 71)');
    const cedo = await chamar(app, gestor, 'POST', url('adjudicacao'), { motivacao: null });
    assert.equal(cedo.statusCode, 422);
    assert.equal(erro(cedo).detalhes?.[0]?.campo, 'ATO_SELECAO_FORA_DE_ORDEM');

    const convocado = await ok(agente, 'prova-conceito/convocacao');
    const prova = convocado.selecao.provasConceito[0];
    assert.equal(prova?.licitante.id, fornecedores.escudo);
    assert.equal(prova?.convocadoEm, '2026-11-09');
    assert.equal(prova?.limite, '2026-11-16', '5 dias úteis contados da convocação (art. 183)');
    assert.equal(convocado.selecao.proximoAto, 'registrar_resultado_prova_conceito');
  });

  test('resultado exige motivação e link http(s) da sessão gravada; reprovado convoca automaticamente o próximo colocado', async () => {
    const semLink = await chamar(app, agente, 'POST', url('prova-conceito/resultado'), { resultado: 'aprovado', motivacao: MOTIVACAO_TESTE, linkGravacao: null });
    assert.equal(semLink.statusCode, 400);
    const linkInseguro = await chamar(app, agente, 'POST', url('prova-conceito/resultado'), { resultado: 'reprovado', motivacao: MOTIVACAO_TESTE, linkGravacao: 'javascript:alert(1)' });
    assert.equal(linkInseguro.statusCode, 400);
    const curta = await chamar(app, agente, 'POST', url('prova-conceito/resultado'), { resultado: 'reprovado', motivacao: 'curta', linkGravacao: LINK_GRAVACAO_TESTE });
    assert.equal(curta.statusCode, 400);

    const p = await ok(agente, 'prova-conceito/resultado', {
      resultado: 'reprovado',
      motivacao: 'A amostra não apresentou o certificado de conformidade exigido no roteiro, item 1.',
      linkGravacao: LINK_GRAVACAO_TESTE,
    });
    assert.equal(p.selecao.vencedorProvisorio?.id, fornecedores.boreal);
    assert.deepEqual(
      p.selecao.excluidos.map((x) => [x.licitante.id, x.motivo]),
      [[fornecedores.escudo, 'prova_conceito']],
    );
    const [primeira, segunda] = p.selecao.provasConceito;
    assert.equal(primeira?.resultado, 'reprovado');
    assert.equal(primeira?.linkGravacao, LINK_GRAVACAO_TESTE);
    assert.equal(primeira?.registradoPor?.id, agente.sessao.usuario.id);
    assert.equal(segunda?.licitante.id, fornecedores.boreal);
    assert.equal(segunda?.convocacaoAutomatica, true);
    assert.equal(p.selecao.proximoAto, 'registrar_resultado_prova_conceito');

    // Depois do primeiro ato, o resultado da disputa fica fixo.
    const disputa = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, {
      licitantes: p.disputa.licitantes.map((l) => ({ id: l.id, valorProposta: l.valorProposta })),
    });
    assert.equal(disputa.statusCode, 422);
    assert.equal(erro(disputa).detalhes?.[0]?.campo, 'RN-22');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.selecao.prova_conceito.resultado&tamanhoPagina=10');
    const evento = trilha.itens.find((e) => e.recursoId === id);
    assert.ok(evento);
    assert.match(evento.resumo, /convocou automaticamente Boreal/);
  });

  test('aprovado o próximo, habilitação e fase recursal: intenção, razões e contrarrazões nos prazos do art. 165', async () => {
    await ok(agente, 'prova-conceito/resultado', { resultado: 'aprovado', motivacao: MOTIVACAO_TESTE, linkGravacao: LINK_GRAVACAO_TESTE });
    let p = await ok(agente, 'habilitacao', { resultado: 'habilitado', motivacao: MOTIVACAO_TESTE });
    assert.equal(p.selecao.proximoAto, 'registrar_intencao_recurso');
    assert.equal(p.selecao.faseRecursal?.atoRecorrivel, 'habilitacao');
    assert.deepEqual(p.selecao.faseRecursal?.prazos, { razoes: '2026-11-12', contrarrazoes: '2026-11-17', reconsideracao: '2026-11-23', decisaoSuperior: null });

    const doVencedor = await chamar(app, agente, 'POST', url('recurso/manifestacao'), { tipo: 'intencao', fornecedorId: fornecedores.boreal, texto: 'Intenção do próprio vencedor.' });
    assert.equal(doVencedor.statusCode, 422);
    assert.equal(erro(doVencedor).detalhes?.[0]?.campo, 'ATO_SELECAO_INVALIDO');

    await ok(agente, 'recurso/manifestacao', { tipo: 'intencao', fornecedorId: fornecedores.escudo, texto: 'Recorre da reprovação da amostra.' });
    p = await ok(agente, 'recurso/encerrar-intencao');
    assert.equal(p.selecao.proximoAto, 'aguardar_razoes');
    const semIntencao = await chamar(app, agente, 'POST', url('recurso/manifestacao'), { tipo: 'razoes', fornecedorId: fornecedores.guardiao, texto: 'Razões de quem não manifestou intenção.' });
    assert.equal(semIntencao.statusCode, 422);
    await ok(agente, 'recurso/manifestacao', { tipo: 'razoes', fornecedorId: fornecedores.escudo, texto: 'O certificado foi entregue no prazo, em envelope separado.' });
    p = await ok(agente, 'recurso/manifestacao', { tipo: 'contrarrazoes', fornecedorId: fornecedores.boreal, texto: 'O roteiro exigia o certificado junto da amostra.' });
    assert.equal(p.selecao.faseRecursal?.razoes.length, 1);
    assert.equal(p.selecao.faseRecursal?.contrarrazoes.length, 1);

    const cedo = await chamar(app, agente, 'POST', url('recurso/reconsideracao'), { decisao: 'mantida', motivacao: MOTIVACAO_TESTE, efeito: null });
    assert.equal(cedo.statusCode, 422);
    assert.equal(erro(cedo).detalhes?.[0]?.campo, 'ATO_SELECAO_FORA_DE_ORDEM');
    assert.deepEqual(
      (await detalhe()).bloqueiosDetalhe.map((b) => b.regra),
      ['RN-22'],
    );
  });

  test('vencidos os prazos: ato mantido, a autoridade designada decide em 10 dias úteis, adjudica e homologa', async () => {
    // Quarta-feira, 18/11/2026: encerradas as contrarrazões (17/11).
    tempo.avancar(9 * DIA_MS);
    await relogar();
    const reformaSemEfeito = await chamar(app, agente, 'POST', url('recurso/reconsideracao'), { decisao: 'reconsiderada', motivacao: MOTIVACAO_TESTE, efeito: null });
    assert.equal(reformaSemEfeito.statusCode, 400, 'reforma exige o efeito');
    let p = await ok(agente, 'recurso/reconsideracao', { decisao: 'mantida', motivacao: 'O roteiro do edital é claro: o certificado acompanha a amostra.', efeito: null });
    assert.equal(p.selecao.proximoAto, 'decidir_recurso');
    assert.equal(p.selecao.faseRecursal?.prazos.decisaoSuperior, '2026-12-03', '10 dias úteis do encaminhamento, sem o feriado de 20/11');

    assert.equal((await chamar(app, agente, 'POST', url('recurso/decisao'), { decisao: 'nao_provido', motivacao: MOTIVACAO_TESTE, efeito: null })).statusCode, 403);
    const admin = await entrar(app, 'admin@agora.demo');
    const naoDesignado = await chamar(app, admin, 'POST', url('recurso/decisao'), { decisao: 'nao_provido', motivacao: MOTIVACAO_TESTE, efeito: null });
    assert.equal(naoDesignado.statusCode, 403, 'só a autoridade competente designada no processo decide');

    p = await ok(gestor, 'recurso/decisao', { decisao: 'nao_provido', motivacao: 'Mantida a reprovação da amostra pelos fundamentos do agente de contratação.', efeito: null });
    assert.equal(p.selecao.faseRecursal?.situacao, 'improvida');
    assert.equal(p.selecao.recursosExauridos, true);
    assert.equal(p.selecao.proximoAto, 'adjudicar');
    assert.deepEqual(
      p.bloqueiosDetalhe.map((b) => b.regra),
      ['RF-18'],
    );

    p = await ok(gestor, 'adjudicacao', { motivacao: null });
    assert.equal(p.selecao.adjudicacao?.licitante.id, fornecedores.boreal);
    assert.equal(p.selecao.proximoAto, 'homologar');
    p = await ok(gestor, 'homologacao', { motivacao: 'Homologação após a regularidade de todos os atos.' });
    assert.equal(p.selecao.proximoAto, 'concluida');
    assert.ok(p.selecao.documentosPreparatoriosDivulgadosEm);
    assert.deepEqual(p.bloqueiosDetalhe, []);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?recurso=processo&tamanhoPagina=100');
    const acoes = trilha.itens.filter((e) => e.recursoId === id).map((e) => e.acao);
    for (const acao of [
      'processo.selecao.prova_conceito.convocar',
      'processo.selecao.habilitacao.registrar',
      'processo.selecao.recurso.intencao',
      'processo.selecao.recurso.razoes',
      'processo.selecao.recurso.contrarrazoes',
      'processo.selecao.recurso.reconsideracao',
      'processo.selecao.recurso.decisao',
      'processo.selecao.adjudicar',
      'processo.selecao.homologar',
      'processo.selecao.divulgar_preparatorios',
    ]) {
      assert.ok(acoes.includes(acao), `trilha sem ${acao}`);
    }
  });

  test('após a homologação, os documentos preparatórios aparecem na página pública do edital, sem login, e o contrato vai ao adjudicatário', async () => {
    const edital = (await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}` })).json<EditalPublico>();
    assert.equal(edital.homologadoEm, '2026-11-18');
    assert.deepEqual(
      edital.documentosPreparatorios.map((d) => d.tipo),
      ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'parecer_checklist'],
    );
    const pdf = await app.inject({ method: 'GET', url: edital.documentosPreparatorios[1]?.url ?? '' });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');

    // Edital ainda não homologado: sem documentos preparatórios e PDF 404.
    const lista = (await app.inject({ method: 'GET', url: '/api/v1/publico/editais?tamanhoPagina=100' })).json<Pagina<EditalPublico>>();
    const outro = lista.itens.find((e) => e.id !== id && e.homologadoEm === null);
    assert.ok(outro);
    assert.deepEqual(outro.documentosPreparatorios, []);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${outro.id}/preparatorios/etp` })).statusCode, 404);

    const avanco = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(avanco.statusCode, 200, avanco.body);
    const contratado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contratar`);
    assert.equal(contratado.statusCode, 200, contratado.body);
    const contrato = contratado.json<ProcessoDetalhe>().contratoGerado;
    assert.ok(contrato);
    const [linha] = await app.agora.banco.consultar<{ fornecedor_id: string }>('SELECT fornecedor_id FROM contratos WHERE id = $1', [contrato.id]);
    assert.equal(linha?.fornecedor_id, fornecedores.boreal, 'o contrato é celebrado com o adjudicatário, não com o primeiro classificado');
  });
});
