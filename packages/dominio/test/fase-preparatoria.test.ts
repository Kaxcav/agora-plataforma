import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDotacao,
  ErroDominio,
  gerarQuesitosControleLegalidade,
  montarCasosTesteProvaConceito,
  montarChecklistPecas,
  normalizarNaturezaDespesa,
  normalizarProgramaTrabalho,
  PECAS_PROCESSO,
  validarDotacaoOrcamentaria,
  verificarDotacaoParaEdital,
  type DadosQuesitosControleLegalidade,
  type LinhaDotacao,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const HOJE = '2026-11-09';
const LINHA: LinhaDotacao = {
  unidadeGestora: '910001',
  programaTrabalho: '06.181.5016.2A01.0001',
  naturezaDespesa: '4.4.90.52',
  fonteRecursos: '1001000000',
  exercicio: 2026,
  valor: 50_000_000,
  preEmpenho: '2026PE000321',
};

describe('validarDotacaoOrcamentaria (RN-39)', () => {
  it('linha completa do exercício: válida, com totais e fundamento no art. 150', () => {
    const r = validarDotacaoOrcamentaria([LINHA], { hoje: HOJE, valorEstimado: 40_000_000 });
    assert.equal(r.valida, true);
    assert.deepEqual(r.pendencias, []);
    assert.deepEqual(r.sinais, []);
    assert.equal(r.exercicioReferencia, 2026);
    assert.equal(r.total, 50_000_000);
    assert.equal(r.totalExercicio, 50_000_000);
    assert.match(r.fundamento, /art\. 150/);
    assert.match(r.fundamento, /XXIII, "j"/);
  });

  it('normaliza natureza e programa de trabalho digitados sem pontos', () => {
    assert.equal(normalizarNaturezaDespesa('449052'), '4.4.90.52');
    assert.equal(normalizarNaturezaDespesa(' 44.90.52 '), '4.4.90.52');
    assert.equal(normalizarNaturezaDespesa('4.4.90'), '4.4.90');
    assert.equal(normalizarProgramaTrabalho('061815016 2a01 0001'), '06.181.5016.2A01.0001');
    assert.equal(normalizarProgramaTrabalho('abc'), 'ABC');
    const r = validarDotacaoOrcamentaria([{ ...LINHA, naturezaDespesa: '449052', programaTrabalho: '0618150162A010001' }], { hoje: HOJE });
    assert.equal(r.valida, true);
    assert.equal(r.linhas[0]?.naturezaDespesa, '4.4.90.52');
    assert.equal(r.linhas[0]?.programaTrabalho, '06.181.5016.2A01.0001');
  });

  it('sem linhas: pendência que pede os campos da dotação', () => {
    const r = validarDotacaoOrcamentaria([], { hoje: HOJE });
    assert.equal(r.valida, false);
    assert.equal(r.pendencias[0]?.campo, 'linhas');
    assert.match(r.pendencias[0]?.mensagem ?? '', /unidade gestora, programa de trabalho, natureza da despesa, fonte de recursos, exercício e valor/);
  });

  it('formatos inválidos apontam o campo e a linha', () => {
    const r = validarDotacaoOrcamentaria(
      [{ unidadeGestora: '12345', programaTrabalho: '06.181', naturezaDespesa: '9.9.90.52', fonteRecursos: '12', exercicio: 2026, valor: 0, preEmpenho: 'PE1' }],
      { hoje: HOJE },
    );
    assert.deepEqual(r.pendencias.map((p) => p.campo).sort(), ['fonteRecursos', 'naturezaDespesa', 'preEmpenho', 'programaTrabalho', 'unidadeGestora', 'valor']);
    assert.ok(r.pendencias.every((p) => p.linha === 1 && p.mensagem.startsWith('Linha 1:')));
  });

  it('natureza incoerente (corrente com grupo de capital) e elemento 00', () => {
    const r = validarDotacaoOrcamentaria([{ ...LINHA, naturezaDespesa: '3.4.90.00' }], { hoje: HOJE });
    const mensagens = r.pendencias.map((p) => p.mensagem).join(' ');
    assert.match(mensagens, /grupo 4 não pertence à categoria econômica 3/);
    assert.match(mensagens, /elemento de despesa/);
  });

  it('grupo de pessoal é aceito, mas vira sinal para conferência', () => {
    const r = validarDotacaoOrcamentaria([{ ...LINHA, naturezaDespesa: '3.1.90.11' }], { hoje: HOJE });
    assert.equal(r.valida, true);
    assert.match(r.sinais.join(' '), /pessoal e encargos sociais/);
  });

  it('exercício encerrado, longe demais ou sem crédito do exercício corrente', () => {
    const passado = validarDotacaoOrcamentaria([{ ...LINHA, exercicio: 2025, preEmpenho: null }], { hoje: HOJE });
    assert.match(passado.pendencias.map((p) => p.mensagem).join(' '), /2025 já foi encerrado/);
    assert.match(passado.pendencias.map((p) => p.mensagem).join(' '), /crédito do exercício de 2026/);
    const futuro = validarDotacaoOrcamentaria([LINHA, { ...LINHA, exercicio: 2040, preEmpenho: null }], { hoje: HOJE });
    assert.match(futuro.pendencias.map((p) => p.mensagem).join(' '), /2040 passa de 10 anos/);
    const plurianual = validarDotacaoOrcamentaria([LINHA, { ...LINHA, exercicio: 2027, preEmpenho: null }], { hoje: HOJE });
    assert.equal(plurianual.valida, true);
    assert.equal(plurianual.total, 100_000_000);
    assert.equal(plurianual.totalExercicio, 50_000_000);
  });

  it('pré-empenho de outro exercício e linhas repetidas', () => {
    const r = validarDotacaoOrcamentaria([{ ...LINHA, preEmpenho: '2027PE000001' }, { ...LINHA, preEmpenho: null }], { hoje: HOJE });
    const mensagens = r.pendencias.map((p) => p.mensagem).join(' ');
    assert.match(mensagens, /pré-empenho 2027PE000001 é de outro exercício/);
    assert.match(mensagens, /Linha 2: repete o crédito da linha 1/);
  });

  it('créditos menores que o valor estimado viram sinal (não bloqueiam)', () => {
    const parcial = validarDotacaoOrcamentaria([LINHA, { ...LINHA, exercicio: 2027, preEmpenho: null }], { hoje: HOJE, valorEstimado: 80_000_000 });
    assert.equal(parcial.valida, true);
    assert.match(parcial.sinais.join(' '), /cobrem parte do valor estimado/);
    const insuficiente = validarDotacaoOrcamentaria([LINHA], { hoje: HOJE, valorEstimado: 80_000_000 });
    assert.equal(insuficiente.valida, true);
    assert.match(insuficiente.sinais.join(' '), /não alcançam o valor estimado/);
  });

  it('entrada estrutural inválida → DOTACAO_INVALIDA; data inválida → erro de data', () => {
    assert.throws(() => validarDotacaoOrcamentaria('x' as unknown as LinhaDotacao[], { hoje: HOJE }), comCodigo('DOTACAO_INVALIDA'));
    assert.throws(() => validarDotacaoOrcamentaria(Array.from({ length: 21 }, () => LINHA), { hoje: HOJE }), comCodigo('DOTACAO_INVALIDA'));
    assert.throws(() => validarDotacaoOrcamentaria([LINHA], { hoje: '09/11/2026' }), ErroDominio);
  });
});

describe('chaveDotacao', () => {
  it('não depende da ordem das linhas nem da pontuação; muda com qualquer campo', () => {
    const outra = { ...LINHA, naturezaDespesa: '3.3.90.30', valor: 1_000 };
    const base = chaveDotacao([LINHA, outra]);
    assert.equal(chaveDotacao([outra, { ...LINHA, naturezaDespesa: '449052' }]), base);
    for (const alterada of [
      { ...LINHA, unidadeGestora: '910002' },
      { ...LINHA, fonteRecursos: '1001000001' },
      { ...LINHA, valor: LINHA.valor + 1 },
      { ...LINHA, preEmpenho: null },
    ]) {
      assert.notEqual(chaveDotacao([alterada, outra]), base);
    }
  });
});

describe('verificarDotacaoParaEdital (RN-39)', () => {
  const valida = validarDotacaoOrcamentaria([LINHA], { hoje: HOJE });
  const tr = { titulo: 'Termo de Referência', versao: 2, situacao: 'com_dotacao' as const };
  const minuta = { titulo: 'Minuta do Contrato', versao: 1, situacao: 'com_dotacao' as const };

  it('dotação válida, declaração aprovada e documentos com a dotação: liberado', () => {
    const r = verificarDotacaoParaEdital({ validacao: valida, declaracao: 'aprovada', documentos: [tr, minuta] });
    assert.equal(r.liberado, true);
    assert.deepEqual(r.pendencias, []);
  });

  it('cada situação da declaração tem a sua pendência', () => {
    const casos: [Parameters<typeof verificarDotacaoParaEdital>[0]['declaracao'], RegExp][] = [
      ['nao_gerada', /Gere a declaração de adequação orçamentária/],
      ['rascunho', /aguarda a aprovação da autoridade competente/],
      ['desatualizada', /A dotação mudou depois da declaração/],
    ];
    for (const [declaracao, esperado] of casos) {
      const r = verificarDotacaoParaEdital({ validacao: valida, declaracao, documentos: [tr, minuta] });
      assert.equal(r.liberado, false, declaracao);
      assert.match(r.pendencias.join(' '), esperado);
    }
    assert.throws(() => verificarDotacaoParaEdital({ validacao: valida, declaracao: 'outra' as 'aprovada', documentos: [] }), comCodigo('DOTACAO_INVALIDA'));
  });

  it('TR ou minuta gerados sem a dotação declarada pedem nova versão; documento não gerado fica com a RIA-04', () => {
    const r = verificarDotacaoParaEdital({
      validacao: valida,
      declaracao: 'aprovada',
      documentos: [{ ...tr, situacao: 'sem_dotacao' }, { ...minuta, situacao: 'nao_gerado', versao: null }],
    });
    assert.deepEqual(r.pendencias, ['"Termo de Referência" (versão 2) não traz a dotação declarada: gere nova versão e aprove.']);
  });

  it('sem dotação informada: pede a dotação e a declaração, sem acusar os documentos', () => {
    const r = verificarDotacaoParaEdital({
      validacao: validarDotacaoOrcamentaria([], { hoje: HOJE }),
      declaracao: 'nao_gerada',
      documentos: [{ ...tr, situacao: 'sem_dotacao' }],
    });
    assert.equal(r.pendencias.length, 2);
    assert.doesNotMatch(r.pendencias.join(' '), /não traz a dotação/);
  });
});

describe('gerarQuesitosControleLegalidade (art. 53)', () => {
  const BASE: DadosQuesitosControleLegalidade = {
    criterioJulgamento: 'menor_preco',
    orcamentoSigiloso: false,
    exigenciaProvaConceito: 'nenhuma',
    inversaoFases: false,
    previstoNoPca: true,
    usaCatalogoPadronizado: true,
    justificativaArtigoLuxo: false,
    patrimonioLiquidoMinimoPercentual: null,
    envolveSoftware: false,
    cotacoesExpurgadas: 0,
    cotacoesFornecedorDireto: 0,
    itensAteLimiteMeEpp: 0,
    dotacaoDeclarada: true,
    creditosCobremValorEstimado: true,
    agentesSemVinculoEfetivo: 0,
    sustentabilidadeExigida: false,
    riscosRegistrados: 3,
  };

  it('processo simples: quatro quesitos de sempre, numerados, com fundamento e motivo', () => {
    const q = gerarQuesitosControleLegalidade(BASE);
    assert.deepEqual(
      q.map((x) => x.numero),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      q.map((x) => x.fundamento),
      ['Lei 14.133/2021, art. 18, I a XI', 'Lei 14.133/2021, art. 6º, XXIII, "j", e art. 150', 'Lei 14.133/2021, art. 25, § 3º, e art. 92', 'Lei 14.133/2021, art. 22 e art. 103'],
    );
    assert.ok(q.every((x) => x.pergunta.endsWith('?') && x.motivo.length > 0));
    assert.match(q[3]?.motivo ?? '', /3 risco\(s\)/);
  });

  it('cada dado do processo acrescenta o seu quesito', () => {
    const q = gerarQuesitosControleLegalidade({
      ...BASE,
      criterioJulgamento: 'tecnica_preco',
      orcamentoSigiloso: true,
      exigenciaProvaConceito: 'amostra',
      inversaoFases: true,
      previstoNoPca: false,
      usaCatalogoPadronizado: false,
      justificativaArtigoLuxo: true,
      patrimonioLiquidoMinimoPercentual: 10,
      envolveSoftware: true,
      cotacoesExpurgadas: 1,
      cotacoesFornecedorDireto: 3,
      itensAteLimiteMeEpp: 2,
      creditosCobremValorEstimado: false,
      agentesSemVinculoEfetivo: 1,
      sustentabilidadeExigida: true,
      riscosRegistrados: 0,
    });
    const fundamentos = q.map((x) => x.fundamento).join(' | ');
    for (const esperado of [/art\. 12, VII/, /art\. 19, § 2º/, /art\. 20/, /art\. 23 \|/, /art\. 23, § 1º, IV/, /art\. 24/, /arts\. 36 e 37/, /art\. 41, II/, /art\. 17, § 1º/, /art\. 69, § 4º/, /art\. 93/, /arts\. 48 e 49/, /art\. 7º, I/, /art\. 18, § 1º, XII/]) {
      assert.match(fundamentos, esperado);
    }
    assert.equal(q.length, 18);
    assert.deepEqual(
      q.map((x) => x.numero),
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    assert.match(q.find((x) => x.fundamento.includes('art. 41, II'))?.pergunta ?? '', /exigência de amostra/);
    assert.match(q.find((x) => x.fundamento.includes('art. 150'))?.motivo ?? '', /cobrem só parte/);
    assert.match(q.at(-1)?.motivo ?? '', /Nenhum risco/);
  });

  it('dotação ainda não declarada aparece no motivo; nenhuma pergunta traz conclusão', () => {
    const q = gerarQuesitosControleLegalidade({ ...BASE, dotacaoDeclarada: false });
    assert.match(q.find((x) => x.fundamento.includes('art. 150'))?.motivo ?? '', /ainda não foi aprovada/);
    assert.ok(q.every((x) => !/é legal|é ilegal|aprova-se|reprova-se/i.test(x.pergunta)));
  });
});

describe('montarCasosTesteProvaConceito', () => {
  it('uma linha por caso, sem a numeração original', () => {
    const casos = montarCasosTesteProvaConceito('1. Voo noturno de 30 minutos\n2) Detecção térmica a 300 m\n\n- Transmissão ao centro de comando.');
    assert.deepEqual(casos, [
      { codigo: 'CT-01', descricao: 'Voo noturno de 30 minutos' },
      { codigo: 'CT-02', descricao: 'Detecção térmica a 300 m' },
      { codigo: 'CT-03', descricao: 'Transmissão ao centro de comando' },
    ]);
  });

  it('texto de linha única é dividido por ponto e vírgula; sem roteiro, lista vazia', () => {
    assert.deepEqual(
      montarCasosTesteProvaConceito('Login com certificado; emissão do relatório; ok').map((c) => c.descricao),
      ['Login com certificado', 'emissão do relatório'],
    );
    assert.deepEqual(montarCasosTesteProvaConceito('Teste único de desempenho'), [{ codigo: 'CT-01', descricao: 'Teste único de desempenho' }]);
    assert.deepEqual(montarCasosTesteProvaConceito(null), []);
    assert.deepEqual(montarCasosTesteProvaConceito('   '), []);
  });

  it('no máximo 25 casos', () => {
    const roteiro = Array.from({ length: 30 }, (_, i) => `Caso de teste número ${i + 1}`).join('\n');
    const casos = montarCasosTesteProvaConceito(roteiro);
    assert.equal(casos.length, 25);
    assert.equal(casos.at(-1)?.codigo, 'CT-25');
  });
});

describe('montarChecklistPecas (RF-32)', () => {
  const doc = (tipo: string, extra: Partial<{ versao: number; situacao: 'rascunho' | 'aprovado'; assinado: boolean; desatualizado: boolean }> = {}) => ({
    tipo,
    versao: 1,
    situacao: 'aprovado' as const,
    assinado: true,
    desatualizado: false,
    ...extra,
  });

  it('agrupa as peças por etapa (1 a 5), cada uma com fundamento', () => {
    const r = montarChecklistPecas({ etapaAtual: 1, documentos: [], provaConceitoExigida: false });
    assert.deepEqual(
      r.etapas.map((e) => e.etapa),
      [1, 2, 3, 4, 5],
    );
    assert.equal(r.etapas.flatMap((e) => e.itens).length, PECAS_PROCESSO.length);
    assert.ok(PECAS_PROCESSO.every((p) => p.fundamento.startsWith('Lei')));
    assert.equal(r.prontas, 0);
    // Obrigatórias (11) contam como falta; recomendadas (6) à parte; o caderno da prova de conceito não se aplica.
    assert.equal(r.faltantes, 11);
    assert.equal(r.recomendadasPendentes, 6);
    const caderno = r.etapas.flatMap((e) => e.itens).find((i) => i.tipo === 'caderno_prova_conceito');
    assert.equal(caderno?.situacao, 'nao_aplicavel');
    assert.equal(caderno?.falta, false);
  });

  it('situações: pronta, rascunho, desatualizada e falta; a versão mais recente é a que vale', () => {
    const r = montarChecklistPecas({
      etapaAtual: 4,
      provaConceitoExigida: true,
      documentos: [
        doc('dfd'),
        doc('etp', { situacao: 'rascunho' }),
        doc('tr', { desatualizado: true }),
        doc('declaracao_orcamentaria', { versao: 1 }),
        doc('declaracao_orcamentaria', { versao: 2, situacao: 'rascunho' }),
        doc('modelo_proposta', { assinado: false }),
      ],
    });
    const item = (tipo: string) => r.etapas.flatMap((e) => e.itens).find((i) => i.tipo === tipo);
    assert.equal(item('dfd')?.situacao, 'pronta');
    assert.equal(item('dfd')?.assinado, true);
    assert.equal(item('etp')?.situacao, 'rascunho');
    assert.equal(item('etp')?.assinado, null);
    assert.equal(item('tr')?.situacao, 'desatualizada');
    assert.equal(item('declaracao_orcamentaria')?.situacao, 'rascunho');
    assert.equal(item('declaracao_orcamentaria')?.versao, 2);
    assert.equal(item('modelo_proposta')?.situacao, 'pronta');
    assert.equal(item('modelo_proposta')?.falta, false);
    assert.equal(item('caderno_prova_conceito')?.situacao, 'falta');
    assert.equal(item('caderno_prova_conceito')?.falta, true);
    assert.equal(r.prontas, 2);
    assert.equal(r.faltantes, 11);
    assert.equal(r.etapas.find((e) => e.etapa === 1)?.faltantes, 0);
  });

  it('rejeita etapa fora de 1 a 7', () => {
    for (const etapaAtual of [0, 8, 2.5]) assert.throws(() => montarChecklistPecas({ etapaAtual, documentos: [], provaConceitoExigida: false }), comCodigo('ETAPA_INVALIDA'));
  });
});
