/**
 * Roteiro PoC-01 (RN-01, art. 20): DFD com item de luxo → tentar gerar → bloqueado → justificar ou remover → gera.
 * O provedor de IA `openai_compativel` está ligado, com um `fetch` falso injetado: a trava acontece no servidor antes
 * de qualquer chamada à IA. Dados 100% sintéticos.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, ProcessoDetalhe, RespostaErro } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const URL_IA = 'http://ia.orgao.exemplo';

interface ChamadaIa {
  url: string;
  prompt: string;
}

/** Provedor de IA falso no formato chat completions: devolve o rascunho recebido, marcado. */
function provedorIaFalso() {
  const chamadas: ChamadaIa[] = [];
  const fetchFalso = async (entrada: string | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof entrada === 'string' ? entrada : entrada.href;
    if (!url.startsWith(URL_IA)) throw new Error(`O teste não permite acesso à rede: ${url}`);
    const corpo = JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] };
    const prompt = corpo.messages.at(-1)?.content ?? '';
    chamadas.push({ url, prompt });
    const rascunho = prompt.slice(prompt.indexOf('<<<\n') + 4, prompt.lastIndexOf('\n>>>'));
    return new Response(JSON.stringify({ model: 'modelo-falso', choices: [{ message: { role: 'assistant', content: `Redação revisada (IA FALSA).\n\n${rascunho}` } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { chamadas, fetchFalso };
}

const DFD_BASE = {
  descricaoNecessidade: 'Mobiliar a nova sala de monitoramento integrado com estações de trabalho para operação contínua em turnos.',
  justificativa: 'A sala entra em operação no próximo trimestre e hoje não dispõe de mobiliário adequado para os operadores.',
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
};
const ITEM_COMUM = { catmat: '150101', descricao: 'Mesa de trabalho em aço e MDF com regulagem de altura', unidade: 'unidade', quantidade: 12, valorUnitarioEstimado: 180_000 };
const ITEM_LUXO = { catmat: '150102', descricao: 'Cadeira giratória premium revestida em couro legítimo', unidade: 'unidade', quantidade: 12, valorUnitarioEstimado: 420_000 };
const MINUTAS = ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato'] as const;

describe('PoC-01 — trava de minutas com item de luxo, com a IA ligada (provedor falso)', () => {
  const ia = provedorIaFalso();
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let processo: ProcessoDetalhe;
  const base = () => `/api/v1/processos/${processo.id}`;

  before(async () => {
    app = await criarAppTeste({
      env: { AGORA_IA_PROVEDOR: 'openai_compativel', AGORA_IA_URL: URL_IA, AGORA_LIMITE_REQUISICOES_MINUTO: '100000' },
      fetch: ia.fetchFalso,
    });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de mobiliário para sala de monitoramento integrado', orgao: 'MJSP' });
    assert.equal(criado.statusCode, 201);
    processo = criado.json<ProcessoDetalhe>();
  });
  after(async () => {
    await app.close();
  });

  test('DFD com item de luxo sem justificativa: toda minuta é recusada no servidor, sem chamar a IA e sem gravar documento', async () => {
    const dfd = await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, itens: [ITEM_COMUM, ITEM_LUXO], justificativaArtigoLuxo: null });
    assert.equal(dfd.statusCode, 200);
    assert.ok(dfd.json<ProcessoDetalhe>().bloqueiosDetalhe.some((b) => b.regra === 'RN-01'), 'o DFD continua sinalizando e bloqueando o avanço');

    for (const tipo of MINUTAS) {
      const r = await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo });
      assert.equal(r.statusCode, 422, `${tipo} deveria ser bloqueado`);
      const erro = r.json<RespostaErro>().erro;
      assert.equal(erro.codigo, 'REGRA_NEGOCIO');
      assert.match(erro.mensagem, /^Geração de minutas bloqueada: indício de artigo de luxo sem justificativa aceita no item 2/);
      assert.match(erro.mensagem, /"premium", "couro legítimo"/);
      assert.deepEqual(
        erro.detalhes?.map((d) => d.campo),
        ['RN-01'],
      );
    }
    assert.equal(ia.chamadas.length, 0, 'a IA nunca foi chamada');
    const detalhe = await obterJson<ProcessoDetalhe>(app, planejamento, base());
    assert.equal(detalhe.documentos.length, 0, 'nenhuma minuta gravada');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.documento.gerar&tamanhoPagina=100');
    assert.ok(!trilha.itens.some((e) => e.recursoId === processo.id), 'nenhuma geração na trilha');
  });

  test('justificativa curta não é aceita; justificada, a minuta é gerada pela IA (falsa) com os incisos do ETP', async () => {
    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, itens: [ITEM_COMUM, ITEM_LUXO], justificativaArtigoLuxo: 'é comum' });
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'etp' })).statusCode, 422);

    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, {
      ...DFD_BASE,
      itens: [ITEM_COMUM, ITEM_LUXO],
      justificativaArtigoLuxo: 'Cadeira de uso contínuo em turnos de 12 horas; o revestimento exigido é o comum de mercado para uso intensivo.',
    });
    const r = await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'etp' });
    assert.equal(r.statusCode, 200);
    const etp = r.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'etp');
    assert.ok(etp);
    assert.equal(etp.geradoPor, 'ia');
    assert.match(etp.conteudo, /IA FALSA/);
    for (const inciso of ['I', 'IV', 'VI', 'VIII', 'XIII']) assert.match(etp.conteudo, new RegExp(`## ${inciso} — `), `inciso ${inciso}`);
    assert.equal(ia.chamadas.length, 1);
  });

  test('sem justificativa, removido o item de luxo, a minuta volta a ser gerada', async () => {
    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, itens: [ITEM_COMUM, ITEM_LUXO], justificativaArtigoLuxo: null });
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'dfd' })).statusCode, 422);
    const chamadasAntes = ia.chamadas.length;

    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, itens: [ITEM_COMUM], justificativaArtigoLuxo: null });
    const r = await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'dfd' });
    assert.equal(r.statusCode, 200);
    assert.ok(r.json<ProcessoDetalhe>().documentos.some((d) => d.tipo === 'dfd'));
    assert.equal(ia.chamadas.length, chamadasAntes + 1);
  });
});
