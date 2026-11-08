/**
 * Frente Q — IA ancorada (F24): base normativa soberana (RNF-08), conferência de citações e IMR-02 (RIA-14),
 * conferência cruzada entre documentos e auditor contínuo da 2ª linha (RIA-15). Dados 100% sintéticos; a IA, quando
 * ligada, é um `fetch` falso injetado (nenhuma chamada de rede).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  FUNDAMENTOS_CONFERENCIA_CRUZADA,
  MODELOS_PADRONIZADOS,
  sinaisAuditorContinuo,
} from '@agora/dominio';
import type {
  ArtigoLeiApi,
  CitacoesDocumento,
  ConferenciaCitacoesApi,
  ConferenciaCruzadaApi,
  EventoAuditoria,
  Pagina,
  PainelAuditorIa,
  PainelQualidadeNormativa,
  ProcessoDetalhe,
  RespostaErro,
  ResultadoBuscaNormas,
  ResumoBaseNormativa,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { conferirCitacoes } from '../src/ia/base-normativa.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const DFD_BASE = {
  justificativa: 'Os rádios atuais estão fora de garantia e não atendem à cobertura exigida nas operações integradas.',
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
};
const NECESSIDADE_COM_CITACAO_INVENTADA =
  'Substituir os rádios portáteis das equipes de campo, com a dispensa prevista no art. 250 da Lei 14.133/2021 para compras de comunicação.';
const NECESSIDADE_CORRETA = 'Substituir os rádios portáteis das equipes de campo, que já não têm peças de reposição nem cobertura adequada.';
const item = (quantidade: number) => ({ catmat: '123456', descricao: 'Rádio portátil digital com bateria reserva', unidade: 'unidade', quantidade, valorUnitarioEstimado: 350_000 });

describe('Frente Q — base normativa, citações, conferência cruzada e auditor contínuo', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let processo: ProcessoDetalhe;
  const base = () => `/api/v1/processos/${processo.id}`;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de rádios portáteis digitais para as equipes de campo', orgao: 'PRF' });
    assert.equal(criado.statusCode, 201);
    processo = criado.json<ProcessoDetalhe>();
  });
  after(async () => {
    await app.close();
  });

  test('RNF-08: base da lei com proveniência; busca BM25 acha o art. 75; artigo estruturado; permissões', async () => {
    const resumo = await obterJson<ResumoBaseNormativa>(app, planejamento, '/api/v1/normas');
    assert.equal(resumo.norma.titulo, 'Lei 14.133/2021');
    assert.equal(resumo.totalArtigos, 196, 'arts. 1º a 194 e os acrescidos 44-A e 184-A');
    assert.match(resumo.proveniencia.sha256Arquivo, /^[0-9a-f]{64}$/);
    assert.match(resumo.proveniencia.sha256Texto, /^[0-9a-f]{64}$/);
    assert.match(resumo.proveniencia.url, /^https:\/\/www2\.camara\.leg\.br\//);
    assert.ok(resumo.divisoes.length > 10);

    const busca = await obterJson<ResultadoBuscaNormas>(app, planejamento, `/api/v1/normas/busca?q=${encodeURIComponent('dispensa de licitação')}`);
    assert.equal(busca.resultados[0]?.artigo, '75');
    assert.match(busca.resultados[0]?.divisao ?? '', /Da Dispensa de Licitação/);
    const exato = await obterJson<ResultadoBuscaNormas>(app, planejamento, `/api/v1/normas/busca?q=${encodeURIComponent('art. 75')}`);
    assert.equal(exato.resultados[0]?.exato, true);
    for (const [consulta, artigo] of [['artigo de luxo', '20'], ['pagamento antecipado', '145'], ['matriz de riscos', '22']] as const) {
      const r = await obterJson<ResultadoBuscaNormas>(app, planejamento, `/api/v1/normas/busca?q=${encodeURIComponent(consulta)}`);
      assert.equal(r.resultados[0]?.artigo, artigo, consulta);
    }

    const art75 = await obterJson<ArtigoLeiApi>(app, planejamento, '/api/v1/normas/artigos/75');
    assert.equal(art75.rotulo, 'art. 75');
    assert.match(art75.caput, /É dispensável a licitação/);
    assert.equal(art75.incisos[1]?.numero, 'II');
    assert.equal(art75.anterior, '74');
    assert.equal((await chamar(app, planejamento, 'GET', '/api/v1/normas/artigos/250')).statusCode, 404);
    assert.equal((await obterJson<ArtigoLeiApi>(app, planejamento, '/api/v1/normas/artigos/184-a')).numero, '184-A');

    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'GET', '/api/v1/normas/busca?q=reajuste')).statusCode, 200);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/normas')).statusCode, 403);
    assert.equal((await chamar(app, planejamento, 'GET', '/api/v1/normas/busca?q=')).statusCode, 400);
  });

  test('os fundamentos dos modelos padronizados, da conferência cruzada e do auditor existem na base', () => {
    const fundamentos = [
      ...Object.values(MODELOS_PADRONIZADOS).flatMap((m) => [m.fundamento, ...m.secoes.map((s) => `Lei 14.133/2021, ${s.fundamento}`)]),
      ...Object.values(FUNDAMENTOS_CONFERENCIA_CRUZADA),
      ...sinaisAuditorContinuo({
        valorInicial: 2_000_000,
        valorGlobal: 300_000,
        dataBaseReajuste: '2025-01-10',
        pagamentos: [
          ...[1, 2, 3, 4].map((n) => ({ notaFiscal: 'NF 1', competencia: `2025-0${n}`, valor: 100_000, situacao: 'pago' as const, atestadoEm: '2025-01-01', pagoEm: '2025-01-02' })),
          { notaFiscal: 'NF 9', competencia: '2025-06', valor: 900_000, situacao: 'pago', atestadoEm: '2025-06-20', pagoEm: '2025-06-10' },
        ],
        aditivos: [{ numero: '1', tipo: 'reajuste', valor: 1, assinadoEm: '2025-03-01' }],
        itens: [{ numero: 1, descricao: 'Item', quantidade: 1, quantidadeRecebida: 2 }],
        valorEstimadoProcesso: 1_000_000,
      }).map((s) => s.fundamento),
    ];
    assert.ok(fundamentos.length > 40);
    for (const f of fundamentos) {
      const c = conferirCitacoes(f);
      assert.ok(c.total > 0, f);
      assert.equal(c.problemas, 0, `${f}: ${c.citacoes.map((x) => x.motivo).join(' | ')}`);
    }
  });

  test('IMR-02: os rascunhos da carga (modelos de texto) têm 100% de citações fiéis e a estrutura completa', async () => {
    const painel = await obterJson<PainelQualidadeNormativa>(app, planejamento, '/api/v1/qualidade-normativa?mes=2026-11');
    assert.equal(painel.meta, 100);
    assert.equal(painel.serie.length, 6);
    const total = painel.serie.reduce((s, m) => s + m.total, 0);
    assert.ok(total >= 20, `rascunhos da carga no semestre: ${total}`);
    for (const m of painel.serie) assert.ok(m.situacao === 'atingida' || m.situacao === 'sem_minutas', `${m.mes}: ${m.situacao}`);
    assert.equal(painel.estrutura.completos, painel.estrutura.conferidos);
    assert.match(painel.aviso, /requer revisão humana/);
    assert.equal(painel.base.norma, 'Lei 14.133/2021');
    assert.equal((await chamar(app, planejamento, 'GET', '/api/v1/qualidade-normativa?mes=2026-13')).statusCode, 400);
    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'GET', '/api/v1/qualidade-normativa')).statusCode, 403);
  });

  test('POST /normas/conferir aponta a citação inventada, sem gravar', async () => {
    const r = await chamar(app, planejamento, 'POST', '/api/v1/normas/conferir', { texto: 'A contratação direta por dispensa de licitação em situação de emergência ou de calamidade pública está no art. 250 da Lei 14.133/2021.' });
    assert.equal(r.statusCode, 200);
    const c = r.json<ConferenciaCitacoesApi>();
    assert.equal(c.inexistentes, 1);
    assert.equal(c.citacoes[0]?.trecho, 'art. 250 da Lei 14.133/2021');
    assert.match(c.citacoes[0]?.sugestao ?? '', /art\. 75/);
    assert.ok(c.conferidoEm);
  });

  test('RIA-14: rascunho com citação inventada é apontado e só é aprovado depois da revisão humana registrada', async () => {
    const dfd = await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, descricaoNecessidade: NECESSIDADE_COM_CITACAO_INVENTADA, itens: [item(10)] });
    assert.equal(dfd.statusCode, 200);
    const gerado = await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'dfd' });
    assert.equal(gerado.statusCode, 200);
    const documento = gerado.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'dfd');
    assert.ok(documento);

    const citacoes = await obterJson<CitacoesDocumento[]>(app, planejamento, `${base()}/citacoes`);
    const doDfd = citacoes.find((c) => c.documentoId === documento.id);
    assert.ok(doDfd);
    assert.equal(doDfd.conferencia.inexistentes, 1);
    assert.equal(doDfd.aprovacaoBloqueada, true);
    const apontada = doDfd.conferencia.citacoes[0];
    assert.equal(apontada?.situacao, 'inexistente');
    assert.match(apontada?.contexto ?? '', /rádios portáteis/);
    assert.equal(doDfd.estrutura.aplicavel, false);

    const negada = await chamar(app, planejamento, 'POST', `${base()}/documentos/${documento.id}/aprovar`);
    assert.equal(negada.statusCode, 422);
    const erro = negada.json<RespostaErro>().erro;
    assert.match(erro.mensagem, /registre a revisão humana das citações antes de aprovar \(RIA-14\)/);
    assert.deepEqual(erro.detalhes?.map((d) => d.campo), ['RIA-14']);

    const juridico = await entrar(app, 'juridico@agora.demo');
    assert.equal((await chamar(app, juridico, 'POST', `${base()}/documentos/${documento.id}/citacoes/revisao`, { justificativa: 'x'.repeat(40) })).statusCode, 403);
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/${documento.id}/citacoes/revisao`, { justificativa: 'curta' })).statusCode, 400);
    const revisada = await chamar(app, planejamento, 'POST', `${base()}/documentos/${documento.id}/citacoes/revisao`, {
      justificativa: 'Citação conferida: o texto será corrigido na próxima versão; mantida só para registro do rascunho.',
    });
    assert.equal(revisada.statusCode, 200);
    const corpo = revisada.json<CitacoesDocumento>();
    assert.equal(corpo.aprovacaoBloqueada, false);
    assert.equal(corpo.revisao?.revisadoPor.nome.length !== 0, true);
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/${documento.id}/citacoes/revisao`, { justificativa: 'y'.repeat(40) })).statusCode, 409);
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/${documento.id}/aprovar`)).statusCode, 200);

    const auditor = await entrar(app, 'auditoria.externa@agora.demo');
    const revisoes = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.documento.citacoes.revisar&tamanhoPagina=100');
    assert.ok(revisoes.itens.some((e) => e.recursoId === processo.id));
    const [geracao] = await app.agora.banco.consultar<{ dados: { citacoes?: { inexistentes: number; fiel: boolean } } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'processo.documento.gerar' AND recurso_id = $1 ORDER BY sequencia",
      [processo.id],
    );
    assert.deepEqual([geracao?.dados.citacoes?.inexistentes, geracao?.dados.citacoes?.fiel], [1, false], 'a conferência da geração fica na trilha');

    const painel = await obterJson<PainelQualidadeNormativa>(app, planejamento, '/api/v1/qualidade-normativa');
    assert.equal(painel.imr02.situacao, 'abaixo');
    assert.ok(painel.apontamentos.some((a) => a.documentoId === documento.id && a.trecho === 'art. 250 da Lei 14.133/2021' && a.revisado));
  });

  test('RIA-15: a divergência de quantidade entre o ETP e o TR é apontada com os trechos', async () => {
    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, descricaoNecessidade: NECESSIDADE_CORRETA, itens: [item(10)] });
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'etp' })).statusCode, 200);
    await chamar(app, planejamento, 'PUT', `${base()}/dfd`, { ...DFD_BASE, descricaoNecessidade: NECESSIDADE_CORRETA, itens: [item(15)] });
    assert.equal((await chamar(app, planejamento, 'POST', `${base()}/documentos/gerar`, { tipo: 'tr' })).statusCode, 200);

    const r = await obterJson<ConferenciaCruzadaApi>(app, planejamento, `${base()}/conferencia-cruzada`);
    assert.equal(r.consistente, false);
    const quantidade = r.divergencias.find((d) => d.chave === 'quantidade:1');
    assert.ok(quantidade, JSON.stringify(r.divergencias.map((d) => d.chave)));
    const porTipo = new Map(quantidade.ocorrencias.map((o) => [o.tipo, o.valor]));
    assert.equal(porTipo.get('etp'), '10 unidade');
    assert.equal(porTipo.get('tr'), '15 unidade');
    assert.match(quantidade.fundamento, /art\. 18, § 1º, IV/);
    assert.match(r.aviso, /requer revisão humana/);
    assert.equal((await chamar(app, planejamento, 'GET', '/api/v1/processos/00000000-0000-4000-8000-000000000000/conferencia-cruzada')).statusCode, 404);
  });

  test('Auditor contínuo (2ª linha): nota duplicada, pagamento antes do atesto e documentos divergentes', async () => {
    const controle = await entrar(app, 'controle@agora.demo');
    const [contrato] = await app.agora.banco.consultar<{ id: string; numero: string }>(
      "SELECT c.id, c.numero FROM contratos c WHERE EXISTS (SELECT 1 FROM pagamentos p WHERE p.contrato_id = c.id AND p.situacao = 'pago') ORDER BY c.numero LIMIT 1",
    );
    assert.ok(contrato);
    await app.agora.banco.executar(
      `INSERT INTO pagamentos (contrato_id, nota_fiscal, competencia, valor, vencimento, pago_em, situacao, atestado_em)
       SELECT contrato_id, nota_fiscal, competencia, valor, vencimento, vencimento - 20, 'pago', vencimento::timestamptz
         FROM pagamentos WHERE contrato_id = $1 AND situacao = 'pago' ORDER BY pagamentos.vencimento LIMIT 1`,
      [contrato.id],
    );
    const painel = await obterJson<PainelAuditorIa>(app, controle, '/api/v1/controle/auditor-ia');
    assert.ok(painel.indicadores.contratosVarridos > 0);
    const doContrato = painel.sinais.filter((s) => s.referencia.id === contrato.id).map((s) => s.tipo);
    assert.ok(doContrato.includes('nota_duplicada'), doContrato.join());
    assert.ok(doContrato.includes('pagamento_antecipado'), doContrato.join());
    const divergencia = painel.sinais.find((s) => s.tipo === 'divergencia_documentos' && s.referencia.id === processo.id);
    assert.ok(divergencia);
    assert.equal(divergencia.referencia.caminho, `/jornada/${processo.id}`);
    assert.ok(painel.sinais.some((s) => s.tipo === 'citacao_documento_aprovado' && s.referencia.id === processo.id), 'DFD aprovado com citação revisada');
    assert.match(painel.aviso, /requerem revisão humana/);
    assert.ok(painel.sinais.every((s) => s.fundamento.length > 0 && s.evidencias.length > 0));

    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'GET', '/api/v1/controle/auditor-ia')).statusCode, 403);
  });
});

describe('Frente Q — com o LLM do órgão: o prompt é ancorado na base e a citação inventada pela IA bloqueia a aprovação', () => {
  const URL_IA = 'http://ia.orgao.exemplo';
  const prompts: string[] = [];
  let app: FastifyInstance;
  let planejamento: Credenciais;

  before(async () => {
    const fetchFalso = async (entrada: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof entrada === 'string' ? entrada : entrada.href;
      if (!url.startsWith(URL_IA)) throw new Error(`O teste não permite acesso à rede: ${url}`);
      const prompt = (JSON.parse(String(init?.body ?? '{}')) as { messages: { content: string }[] }).messages.at(-1)?.content ?? '';
      prompts.push(prompt);
      const rascunho = prompt.slice(prompt.indexOf('<<<\n') + 4, prompt.lastIndexOf('\n>>>'));
      const texto = `${rascunho}\n\nA contratação observa também o art. 999, § 4º, da Lei 14.133/2021.`;
      return new Response(JSON.stringify({ model: 'modelo-local-falso', choices: [{ message: { role: 'assistant', content: texto } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    app = await criarAppTeste({ env: { AGORA_IA_PROVEDOR: 'openai_compativel', AGORA_IA_URL: URL_IA, AGORA_LIMITE_REQUISICOES_MINUTO: '100000' }, fetch: fetchFalso });
    planejamento = await entrar(app, 'planejamento@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('ETP redigido pela IA: prompt com dispositivos e seções do modelo; citação inexistente marcada e aprovação bloqueada', async () => {
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de rádios portáteis digitais para as equipes de campo', orgao: 'PRF' });
    const processo = criado.json<ProcessoDetalhe>();
    await chamar(app, planejamento, 'PUT', `/api/v1/processos/${processo.id}/dfd`, { ...DFD_BASE, descricaoNecessidade: NECESSIDADE_CORRETA, itens: [item(10)] });
    prompts.length = 0;
    const r = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processo.id}/documentos/gerar`, { tipo: 'etp' });
    assert.equal(r.statusCode, 200);
    const etp = r.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'etp');
    assert.ok(etp);
    assert.equal(etp.geradoPor, 'ia');

    const prompt = prompts.at(-1) ?? '';
    assert.match(prompt, /Base normativa para ancoragem — trechos da Lei 14\.133\/2021/);
    assert.match(prompt, /- art\. 18, § 1º, I — descrição da necessidade/);
    assert.match(prompt, /Seções obrigatórias do documento \(modelo padronizado, art\. 19, IV\)/);
    assert.match(prompt, /não crie artigos/);

    const citacoes = await obterJson<CitacoesDocumento[]>(app, planejamento, `/api/v1/processos/${processo.id}/citacoes`);
    const doEtp = citacoes.find((c) => c.documentoId === etp.id);
    assert.ok(doEtp);
    assert.equal(doEtp.geradoPor, 'ia');
    assert.equal(doEtp.aprovacaoBloqueada, true);
    assert.ok(doEtp.conferencia.citacoes.some((c) => c.situacao === 'inexistente' && /art\. 999/.test(c.trecho)));
    assert.equal(doEtp.estrutura.ausentes.length, 0, 'o ETP mantém as 13 seções do art. 18, § 1º');
    const aprovar = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processo.id}/documentos/${etp.id}/aprovar`);
    assert.equal(aprovar.statusCode, 422);
    assert.match(aprovar.json<RespostaErro>().erro.mensagem, /RIA-14/);
  });
});
