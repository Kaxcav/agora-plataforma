import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AvaliacaoDesempenho,
  AvaliacoesContrato,
  BaseConhecimentoContrato,
  CertificadoDesempenho,
  CriterioDesempenhoEdital,
  LicoesAprendidasProcesso,
  NotaRegistroDesempenho,
  OcorrenciaExecucao,
  PreviaAvaliacaoDesempenho,
  ProcessoDetalhe,
  RegistroDesempenhoFornecedor,
  ResultadoSimulacaoDesempenho,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const MOTIVACAO = 'Entregas conferidas nos termos de recebimento do período; duas entregas fora do prazo, já regularizadas pelo contratado.';

describe('avaliação de desempenho do contratado e lições aprendidas (RN-37, RF-30, RIA-12)', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let admin: Credenciais;
  let consulta: Credenciais;
  let planejamento: Credenciais;
  let agente: Credenciais;
  let fiscal: Credenciais;
  let contrato: { id: string; numero: string; vigencia_inicio: string; fornecedor_id: string; uasg: string };
  const fornecedorPorNome = async (prefixo: string): Promise<string> => {
    const [f] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE razao_social LIKE $1', [`${prefixo}%`]);
    assert.ok(f, prefixo);
    return f.id;
  };
  const processoPorTitulo = async (trecho: string): Promise<{ id: string; etapa_atual: number }> => {
    const [p] = await app.agora.banco.consultar<{ id: string; etapa_atual: number }>('SELECT id, etapa_atual FROM processos WHERE titulo ILIKE $1', [`%${trecho}%`]);
    assert.ok(p, trecho);
    return p;
  };
  const eventos = async (acao: string): Promise<number> => {
    const [r] = await app.agora.banco.consultar<{ n: number }>('SELECT count(*)::int AS n FROM auditoria_eventos WHERE acao = $1', [acao]);
    return r?.n ?? 0;
  };

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    fiscal = await entrar(app, 'fiscal@agora.demo');
    // Contrato de fornecedor sem avaliação na carga, com o gestor de demonstração designado.
    const [c] = await app.agora.banco.consultar<{ id: string; numero: string; vigencia_inicio: string; fornecedor_id: string; uasg: string }>(
      `SELECT c.id, c.numero, c.vigencia_inicio, c.fornecedor_id, c.uasg FROM contratos c JOIN fornecedores f ON f.id = c.fornecedor_id
        WHERE c.gestor_id = $1 AND f.razao_social LIKE 'Planalto%' ORDER BY c.vigencia_inicio LIMIT 1`,
      [gestor.sessao.usuario.id],
    );
    assert.ok(c);
    contrato = c;
  });

  after(async () => {
    await app.close();
  });

  const corpoAvaliacao = (extra: Record<string, unknown> = {}) => ({
    tipo: 'parcial',
    periodoInicio: contrato.vigencia_inicio,
    periodoFim: '2026-10-31',
    entregasNoPrazo: 8,
    entregasTotal: 10,
    recebimentosAprovados: 9,
    recebimentosTotal: 10,
    evidencias: 'Termos de recebimento provisório e definitivo do período.',
    motivacao: MOTIVACAO,
    ...extra,
  });

  test('carga: registro com as notas usadas nas disputas sintéticas e ranking da maior para a menor', async () => {
    const ranking = await obterJson<NotaRegistroDesempenho[]>(app, consulta, '/api/v1/desempenho/ranking');
    const nota = (prefixo: string) => ranking.find((r) => r.razaoSocial.startsWith(prefixo))?.nota;
    assert.equal(nota('Escudo Forte'), 92);
    assert.equal(nota('Boreal'), 85);
    assert.equal(nota('Guardião'), 88);
    assert.equal(nota('Horizonte'), 71);
    assert.ok(ranking.every((r, i) => i === 0 || (ranking[i - 1]?.nota ?? -1) >= (r.nota ?? -1)));
    const [escudo, boreal] = [await fornecedorPorNome('Escudo Forte'), await fornecedorPorNome('Boreal')];
    const notas = await obterJson<NotaRegistroDesempenho[]>(app, consulta, `/api/v1/desempenho/notas?fornecedores=${escudo},${boreal}`);
    assert.deepEqual(notas.map((n) => n.nota).sort(), [85, 92]);
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/desempenho/notas?fornecedores=abc')).statusCode, 400);
  });

  test('avaliação: só o gestor ou o fiscal designado emite; prévia com os dados derivados; validações', async () => {
    const base = `/api/v1/contratos/${contrato.id}/avaliacoes-desempenho`;
    assert.equal((await chamar(app, consulta, 'POST', base, corpoAvaliacao())).statusCode, 403);
    const naoDesignado = await chamar(app, admin, 'POST', base, corpoAvaliacao());
    assert.equal(naoDesignado.statusCode, 422);
    assert.match(naoDesignado.body, /gestor ou o fiscal designado/);

    const lista = await obterJson<AvaliacoesContrato>(app, gestor, base);
    assert.deepEqual(lista.avaliador, { podeAvaliar: true, papel: 'gestor', motivo: null });
    assert.equal((await obterJson<AvaliacoesContrato>(app, admin, base)).avaliador.podeAvaliar, false);
    const previa = await obterJson<PreviaAvaliacaoDesempenho>(app, gestor, `${base}/previa?periodoInicio=${contrato.vigencia_inicio}&periodoFim=2026-10-31`);
    assert.equal(previa.vigenciaInicio, contrato.vigencia_inicio);
    assert.equal(typeof previa.ocorrencias.total, 'number');

    assert.equal((await chamar(app, gestor, 'POST', base, corpoAvaliacao({ motivacao: 'Curta demais.' }))).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', base, corpoAvaliacao({ periodoFim: '2030-01-01' }))).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', base, corpoAvaliacao({ entregasNoPrazo: 11 }))).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', base, corpoAvaliacao({ tipo: 'mensal' }))).statusCode, 400);
  });

  test('emissão → em prazo de manifestação; concordância → definitiva e a nota entra no registro do fornecedor; PDF', async () => {
    const base = `/api/v1/contratos/${contrato.id}/avaliacoes-desempenho`;
    const antes = await obterJson<RegistroDesempenhoFornecedor>(app, consulta, `/api/v1/fornecedores/${contrato.fornecedor_id}/desempenho`);
    assert.equal(antes.nota, null);
    const r = await chamar(app, gestor, 'POST', base, corpoAvaliacao());
    assert.equal(r.statusCode, 201, r.body);
    const avaliacao = r.json<AvaliacaoDesempenho>();
    assert.match(avaliacao.protocolo, /^RCD-2026-\d{6}$/);
    assert.equal(avaliacao.situacao, 'em_manifestacao');
    assert.equal(avaliacao.avaliador.papel, 'gestor');
    assert.equal(avaliacao.envioCadastro.situacao, 'aguardando_cadastro_pncp');
    assert.equal(avaliacao.prazoManifestacao, '2026-11-16');
    assert.ok(avaliacao.nota > 0 && avaliacao.nota <= 100);
    assert.equal(await eventos('desempenho.avaliacao.emitir') >= 1, true);
    const pendente = await obterJson<RegistroDesempenhoFornecedor>(app, consulta, `/api/v1/fornecedores/${contrato.fornecedor_id}/desempenho`);
    assert.equal(pendente.nota, null, 'em prazo de manifestação não entra no registro');
    assert.equal(pendente.avaliacoes[0]?.consideradaNoRegistro, false);

    const fora = await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${avaliacao.id}/manifestacao`, { texto: 'Ciente e de acordo.', recebidaEm: '2026-11-30', concorda: true });
    assert.equal(fora.statusCode, 422);
    const m = await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${avaliacao.id}/manifestacao`, { texto: 'Ciente e de acordo com a avaliação.', recebidaEm: '2026-11-09', concorda: true });
    assert.equal(m.statusCode, 200, m.body);
    assert.equal(m.json<AvaliacaoDesempenho>().situacao, 'definitiva');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${avaliacao.id}/manifestacao`, { texto: 'Outra.', recebidaEm: '2026-11-09', concorda: true })).statusCode, 422);

    const depois = await obterJson<RegistroDesempenhoFornecedor>(app, consulta, `/api/v1/fornecedores/${contrato.fornecedor_id}/desempenho`);
    assert.equal(depois.nota, avaliacao.nota);
    assert.equal(depois.avaliacoes[0]?.consideradaNoRegistro, true);
    assert.equal(depois.incentivo.declaracao.elegivel, true);

    const pdf = await chamar(app, consulta, 'GET', `/api/v1/avaliacoes-desempenho/${avaliacao.id}/documento.pdf`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.ok(pdf.rawPayload.subarray(0, 5).toString() === '%PDF-');
  });

  test('discordância → análise revista recalcula a nota e cria nova versão', async () => {
    const base = `/api/v1/contratos/${contrato.id}/avaliacoes-desempenho`;
    const r = await chamar(app, gestor, 'POST', base, corpoAvaliacao({ tipo: 'final', periodoFim: '2026-11-01', entregasNoPrazo: 5 }));
    assert.equal(r.statusCode, 201, r.body);
    const a = r.json<AvaliacaoDesempenho>();
    const m = await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${a.id}/manifestacao`, {
      texto: 'Duas entregas foram feitas no prazo e constam como atrasadas por erro de registro.',
      recebidaEm: '2026-11-09',
      concorda: false,
    });
    assert.equal(m.json<AvaliacaoDesempenho>().situacao, 'manifestada');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${a.id}/analise`, { decisao: 'revista', motivacao: 'curta' })).statusCode, 422);
    const analise = await chamar(app, gestor, 'POST', `/api/v1/avaliacoes-desempenho/${a.id}/analise`, {
      decisao: 'revista',
      motivacao: 'Conferidos os termos de recebimento, duas entregas ocorreram no prazo; a contagem foi corrigida e a nota recalculada.',
      entregasNoPrazo: 7,
    });
    assert.equal(analise.statusCode, 200, analise.body);
    const revista = analise.json<AvaliacaoDesempenho>();
    assert.equal(revista.versao, 2);
    assert.equal(revista.situacao, 'definitiva');
    assert.equal(revista.indicadores.entregasNoPrazo, 7);
    assert.equal(revista.nota, a.nota + 8);
    assert.equal(await eventos('desempenho.avaliacao.analisar'), 1);
  });

  test('certificado de desempenho: critério objetivo (nota ≥ 90), declaração para quem tem avaliação, PDF com código', async () => {
    const [escudo, horizonte] = [await fornecedorPorNome('Escudo Forte'), await fornecedorPorNome('Horizonte')];
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/fornecedores/${escudo}/certificados-desempenho`, { tipo: 'certificado' })).statusCode, 403);
    const negado = await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${horizonte}/certificados-desempenho`, { tipo: 'certificado' });
    assert.equal(negado.statusCode, 422);
    assert.match(negado.body, /inferior a 90/);
    const declaracao = await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${horizonte}/certificados-desempenho`, { tipo: 'declaracao' });
    assert.equal(declaracao.statusCode, 201);
    const r = await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${escudo}/certificados-desempenho`, { tipo: 'certificado' });
    assert.equal(r.statusCode, 201, r.body);
    const certificado = r.json<CertificadoDesempenho>();
    assert.match(certificado.codigo, /^CDF-2026-[0-9A-F]{8}$/);
    assert.equal(certificado.nota, 92);
    assert.equal(certificado.situacao, 'valido');
    assert.equal(certificado.validoAte, '2027-11-09');
    const registro = await obterJson<RegistroDesempenhoFornecedor>(app, consulta, `/api/v1/fornecedores/${escudo}/desempenho`);
    assert.equal(registro.certificados[0]?.codigo, certificado.codigo);
    const pdf = await chamar(app, consulta, 'GET', `/api/v1/certificados-desempenho/${certificado.id}/documento.pdf`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(await eventos('desempenho.certificado.emitir'), 1);
  });

  test('desempate (art. 60, II): a nota vem do registro, não do que o navegador envia', async () => {
    const coletes = await processoPorTitulo('coletes balísticos');
    const url = `/api/v1/processos/${coletes.id}/disputa`;
    const original = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${coletes.id}`);
    const [escudo, boreal] = [await fornecedorPorNome('Escudo Forte'), await fornecedorPorNome('Boreal')];
    const r = await chamar(app, agente, 'PUT', url, {
      licitantes: [
        { id: escudo, valorProposta: 1_000_000, notaDesempenhoPrevio: 0 },
        { id: boreal, valorProposta: 1_000_000, notaDesempenhoPrevio: 100 },
      ],
    });
    assert.equal(r.statusCode, 200, r.body);
    const p = r.json<ProcessoDetalhe>();
    assert.deepEqual(p.disputa.licitantes.map((l) => l.notaDesempenhoPrevio), [92, 85]);
    const resultado = p.disputa.resultado as { classificacao: { id: string; posicao: number }[]; criterioDecisivo: string | null };
    assert.equal(resultado.classificacao[0]?.id, escudo);
    assert.match(resultado.criterioDecisivo ?? '', /art\. 60, II/);
    // Restaura a disputa sintética.
    const restaurado = await chamar(app, agente, 'PUT', url, { licitantes: original.disputa.licitantes });
    assert.deepEqual(restaurado.json<ProcessoDetalhe>().disputa.resultado, original.disputa.resultado);
  });

  test('simulador de impacto em editais futuros: desempate e técnica e preço com a nota do registro', async () => {
    const [escudo, boreal, ipe] = [await fornecedorPorNome('Escudo Forte'), await fornecedorPorNome('Boreal'), await fornecedorPorNome('Ipê')];
    const r = await chamar(app, consulta, 'POST', '/api/v1/desempenho/simulacao', {
      licitantes: [
        { fornecedorId: boreal, valorProposta: 500_000, notaProposta: 80 },
        { fornecedorId: escudo, valorProposta: 500_000, notaProposta: 80 },
        { fornecedorId: ipe, valorProposta: 500_000, notaProposta: 80 },
      ],
      criterio: { pesoDesempenhoPercentual: 20, notaSemHistorico: 50, regulamento: 'Portaria sintética nº 1/2026, art. 5º', pesoTecnicoPercentual: 70 },
    });
    assert.equal(r.statusCode, 200, r.body);
    const s = r.json<ResultadoSimulacaoDesempenho>();
    assert.equal(s.desempate.classificacao[0]?.id, escudo);
    assert.match(s.desempate.criterioDecisivo ?? '', /art\. 60, II/);
    assert.equal(s.tecnicaEPreco?.[0]?.id, escudo);
    assert.equal(s.tecnicaEPreco?.find((t) => t.id === ipe)?.origem, 'sem_historico');
    assert.equal((await chamar(app, consulta, 'POST', '/api/v1/desempenho/simulacao', { licitantes: [{ fornecedorId: escudo, valorProposta: 1 }, { fornecedorId: escudo, valorProposta: 1 }] })).statusCode, 422);
  });

  test('fórmula do edital (art. 36, § 3º): só com técnica, com regulamento, até a etapa 4; entra no TR e na sala de disputa', async () => {
    const drones = await processoPorTitulo('drones');
    assert.equal(drones.etapa_atual, 4);
    const url = `/api/v1/processos/${drones.id}/criterio-desempenho`;
    const corpo = { adotado: true, pesoDesempenhoPercentual: 20, notaSemHistorico: 50, regulamento: 'Portaria sintética nº 1/2026, art. 5º' };
    assert.equal((await chamar(app, consulta, 'PUT', url, corpo)).statusCode, 403);
    const menorPreco = await chamar(app, agente, 'PUT', url, corpo);
    assert.equal(menorPreco.statusCode, 422);
    assert.match(menorPreco.body, /técnica e preço ou na melhor técnica/);
    await app.agora.banco.executar(`UPDATE processos SET edital = jsonb_set(edital, '{criterioJulgamento}', '"tecnica_preco"') WHERE id = $1`, [drones.id]);
    assert.equal((await chamar(app, agente, 'PUT', url, { ...corpo, regulamento: '' })).statusCode, 422);
    const ok = await chamar(app, agente, 'PUT', url, corpo);
    assert.equal(ok.statusCode, 200, ok.body);
    const criterio = ok.json<CriterioDesempenhoEdital>();
    assert.equal(criterio.adotado, true);
    assert.equal(criterio.aplicavel, true);
    const tr = await chamar(app, agente, 'POST', `/api/v1/processos/${drones.id}/documentos/gerar`, { tipo: 'tr' });
    assert.equal(tr.statusCode, 200, tr.body);
    const conteudo = tr.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'tr')?.conteudo ?? '';
    assert.match(conteudo, /Desempenho anterior na pontuação técnica/);
    assert.match(conteudo, /Portaria sintética nº 1\/2026/);

    const coletes = await processoPorTitulo('coletes balísticos');
    assert.equal((await chamar(app, agente, 'PUT', `/api/v1/processos/${coletes.id}/criterio-desempenho`, corpo)).statusCode, 422);
    await app.agora.banco.executar(
      `INSERT INTO criterios_desempenho_edital (processo_id, adotado, peso_desempenho, nota_sem_historico, regulamento, atualizado_em) VALUES ($1, true, 20, 50, 'Portaria sintética nº 1/2026', now())`,
      [coletes.id],
    );
    const [escudo, boreal] = [await fornecedorPorNome('Escudo Forte'), await fornecedorPorNome('Boreal')];
    const sessao = await chamar(app, agente, 'POST', `/api/v1/processos/${coletes.id}/sessoes-disputa`, {
      uso: 'simulacao',
      criterio: 'tecnica_e_preco',
      modo: 'fechado',
      participantes: [
        { fornecedorId: escudo, propostaInicial: 1_000_000, notaTecnica: 80 },
        { fornecedorId: boreal, propostaInicial: 1_000_000, notaTecnica: 80 },
      ],
    });
    assert.equal(sessao.statusCode, 201, sessao.body);
    const [linha] = await app.agora.banco.consultar<{ participantes: { fornecedorId: string; notaTecnica: number; notaDesempenhoPrevio: number; composicaoNotaTecnica: { origem: string } }[] }>(
      'SELECT participantes FROM sessoes_disputa WHERE id = $1',
      [sessao.json<{ id: string }>().id],
    );
    const pE = linha?.participantes.find((p) => p.fornecedorId === escudo);
    const pB = linha?.participantes.find((p) => p.fornecedorId === boreal);
    assert.equal(pE?.notaDesempenhoPrevio, 92);
    assert.equal(pE?.notaTecnica, 82.4);
    assert.equal(pB?.notaTecnica, 81);
    assert.equal(pE?.composicaoNotaTecnica.origem, 'registro');
  });

  test('ocorrências da execução: registro pela fiscalização, solução e base de conhecimento do contrato', async () => {
    const url = `/api/v1/contratos/${contrato.id}/ocorrencias-execucao`;
    assert.equal((await chamar(app, consulta, 'POST', url, { tipo: 'ocorrencia', data: '2026-11-02', descricao: 'Ocorrência sintética de teste.' })).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', url, { tipo: 'atraso', data: '2026-11-02', descricao: 'Entrega atrasada sem justificativa.' })).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', url, { tipo: 'ocorrencia', data: '2030-01-01', descricao: 'Ocorrência com data futura.' })).statusCode, 422);
    const r = await chamar(app, gestor, 'POST', url, { tipo: 'atraso', data: '2026-11-02', descricao: 'Entrega de luvas táticas atrasada sem justificativa.', diasAtraso: 9 });
    assert.equal(r.statusCode, 201, r.body);
    const ocorrencia = r.json<OcorrenciaExecucao>();
    assert.equal(ocorrencia.categoria, 'prazo');
    assert.equal(ocorrencia.situacao, 'aberta');
    const s = await chamar(app, gestor, 'POST', `/api/v1/ocorrencias-execucao/${ocorrencia.id}/solucao`, { situacao: 'resolvida_no_prazo', resolvidaEm: '2026-11-05' });
    assert.equal(s.json<OcorrenciaExecucao>().situacao, 'resolvida_no_prazo');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/ocorrencias-execucao/${ocorrencia.id}/solucao`, { situacao: 'resolvida_no_prazo', resolvidaEm: '2026-11-05' })).statusCode, 422);
    const base = await obterJson<BaseConhecimentoContrato>(app, gestor, url);
    assert.ok(base.ocorrencias.some((o) => o.id === ocorrencia.id));
    assert.equal(await eventos('execucao.ocorrencia.registrar') >= 1, true);
    const previa = await obterJson<PreviaAvaliacaoDesempenho>(
      app,
      gestor,
      `/api/v1/contratos/${contrato.id}/avaliacoes-desempenho/previa?periodoInicio=2026-11-01&periodoFim=2026-11-08`,
    );
    assert.equal(previa.ocorrencias.total, 1);
    assert.equal(previa.ocorrencias.resolvidasNoPrazo, 1);
    // Escopo de UASG: contrato fora das UASGs do usuário não aparece (404), nem as ocorrências nem a avaliação.
    const [fora] = await app.agora.banco.consultar<{ id: string }>(
      'SELECT c.id FROM contratos c WHERE c.uasg <> ALL(SELECT uasg FROM usuarios_uasgs WHERE usuario_id = $1) ORDER BY c.id LIMIT 1',
      [fiscal.sessao.usuario.id],
    );
    assert.ok(fora);
    assert.equal((await chamar(app, fiscal, 'GET', `/api/v1/contratos/${fora.id}/avaliacoes-desempenho`)).statusCode, 404);
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/contratos/${fora.id}/ocorrencias-execucao`, { tipo: 'ocorrencia', data: '2026-11-02', descricao: 'Ocorrência fora do escopo de UASG.' })).statusCode, 404);
  });

  test('lições aprendidas no DFD de objeto semelhante: sinal com fontes, decisão registrada e cláusula aceita no rascunho', async () => {
    const coletes = await processoPorTitulo('coletes balísticos');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${coletes.id}/licoes-aprendidas?documento=tr`)).statusCode, 403);
    const tr = await obterJson<LicoesAprendidasProcesso>(app, planejamento, `/api/v1/processos/${coletes.id}/licoes-aprendidas?documento=tr`);
    assert.ok(tr.sugestoes.some((s) => s.chave === 'tr:prazo'));
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${coletes.id}/licoes-aprendidas/decisoes`, { documento: 'tr', chave: 'tr:prazo', decisao: 'aceita' })).statusCode, 422);

    const novo = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de coletes balísticos para a Força Nacional', orgao: 'SENASP' });
    assert.ok(novo.statusCode === 200 || novo.statusCode === 201, novo.body);
    const p = novo.json<ProcessoDetalhe>();
    const dfd = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${p.id}/dfd`, {
      descricaoNecessidade: 'Repor os coletes balísticos vencidos das equipes de pronta resposta da Força Nacional.',
      justificativa: 'Os coletes em uso estão com a validade da proteção balística vencida e precisam ser substituídos.',
      itens: [{ catmat: null, descricao: 'Colete balístico nível III-A, masculino', unidade: 'unidade', quantidade: 300, valorUnitarioEstimado: 350_000 }],
      usaCatalogoPadronizado: false,
      justificativaNaoPadronizacao: 'O item com o nível de proteção exigido ainda não consta do catálogo padronizado.',
      justificativaArtigoLuxo: null,
      previstoNoPca: true,
      tipoObjeto: 'bens',
    });
    assert.equal(dfd.statusCode, 200, dfd.body);
    const licoes = await obterJson<LicoesAprendidasProcesso>(app, planejamento, `/api/v1/processos/${p.id}/licoes-aprendidas?documento=dfd`);
    const prazo = licoes.sugestoes.find((s) => s.chave === 'dfd:prazo');
    assert.ok(prazo, JSON.stringify(licoes.sugestoes.map((s) => s.chave)));
    assert.equal(prazo.regra, 'RIA-12');
    assert.match(prazo.aviso, /requer revisão humana/);
    assert.ok(prazo.fontes.length > 0 && prazo.fontes.every((f) => f.fatos.length > 0));
    assert.equal(prazo.decisao, null);

    const url = `/api/v1/processos/${p.id}/licoes-aprendidas/decisoes`;
    assert.equal((await chamar(app, consulta, 'POST', url, { documento: 'dfd', chave: 'dfd:prazo', decisao: 'aceita' })).statusCode, 403);
    assert.equal((await chamar(app, planejamento, 'POST', url, { documento: 'dfd', chave: 'dfd:qualidade', decisao: 'recusada' })).statusCode, 422);
    assert.equal((await chamar(app, planejamento, 'POST', url, { documento: 'dfd', chave: 'dfd:inexistente', decisao: 'aceita' })).statusCode, 422);
    const aceita = await chamar(app, planejamento, 'POST', url, { documento: 'dfd', chave: 'dfd:prazo', decisao: 'aceita' });
    assert.equal(aceita.statusCode, 200, aceita.body);
    assert.equal(aceita.json<LicoesAprendidasProcesso>().sugestoes.find((s) => s.chave === 'dfd:prazo')?.decisao?.decisao, 'aceita');
    const recusada = await chamar(app, planejamento, 'POST', url, { documento: 'dfd', chave: 'dfd:qualidade', decisao: 'recusada', motivo: 'A especificação já exige o ensaio de proteção.' });
    assert.equal(recusada.json<LicoesAprendidasProcesso>().sugestoes.find((s) => s.chave === 'dfd:qualidade')?.decisao?.decisao, 'recusada');
    assert.equal(await eventos('processo.licao.decidir'), 2);

    const gerado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${p.id}/documentos/gerar`, { tipo: 'dfd' });
    assert.equal(gerado.statusCode, 200, gerado.body);
    const texto = gerado.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'dfd')?.conteudo ?? '';
    assert.match(texto, /Lições aprendidas consideradas \(RIA-12\)/);
    assert.match(texto, new RegExp(prazo.titulo));
    assert.doesNotMatch(texto, /Especificar a qualidade/, 'a recusada não entra no rascunho');
  });
});
