import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, analisarCestaPrecos, type Cotacao, type FonteCotacao } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const REF = '2026-11-08';
const AVISO = 'Expurgos são sugestões estatísticas; a exclusão de preços deve ser confirmada e justificada pelo agente responsável.';

function cot(id: string, valorUnitario: number, fonte: FonteCotacao = 'painel_precos', dataCotacao = '2026-10-01', extra: Partial<Cotacao> = {}): Cotacao {
  return { id, fonte, descricaoFonte: `Fonte ${id}`, valorUnitario, dataCotacao, ...extra };
}
const codigos = (r: ReturnType<typeof analisarCestaPrecos>) => r.alertas.map((a) => a.codigo);

describe('analisarCestaPrecos — Tukey (IQR)', () => {
  const cesta = [cot('1', 1000), cot('2', 9800), cot('3', 9900), cot('4', 10000), cot('5', 10100), cot('6', 10200), cot('7', 50000)];

  it('sugere expurgo abaixo de Q1 − 1,5·IQR (inexequível) e acima de Q3 + 1,5·IQR (excessivamente elevado)', () => {
    const r = analisarCestaPrecos(cesta, { dataReferencia: REF });
    assert.deepEqual(
      r.sugeridasExpurgo.map((s) => [s.id, s.motivo]),
      [
        ['1', 'inexequivel'],
        ['7', 'excessivamente_elevado'],
      ],
    );
    assert.match(r.sugeridasExpurgo[0]?.explicacao ?? '', /R\$ 94,00/);
    assert.match(r.sugeridasExpurgo[1]?.explicacao ?? '', /R\$ 106,00/);
  });

  it('calcula estatísticas brutas e saneadas', () => {
    const r = analisarCestaPrecos(cesta, { dataReferencia: REF });
    assert.deepEqual(r.estatisticas, { n: 7, media: 14429, mediana: 10000, menor: 1000, maior: 50000, desvioPadrao: 16041, coeficienteVariacao: 111.17 });
    assert.deepEqual(r.estatisticasSaneadas, { n: 5, media: 10000, mediana: 10000, menor: 9800, coeficienteVariacao: 1.58 });
    assert.equal(r.metodologiaRecomendada, 'media');
    assert.equal(r.valorEstimado, 10000);
    assert.equal(r.aviso, AVISO);
    assert.deepEqual(r.alertas, []);
  });

  it('valores dentro das cercas não são expurgados', () => {
    const r = analisarCestaPrecos([cot('a', 10), cot('b', 20), cot('c', 30), cot('d', 40)], { dataReferencia: REF });
    assert.deepEqual(r.sugeridasExpurgo, []);
  });

  it('CV saneado acima de 25% recomenda a mediana', () => {
    const r = analisarCestaPrecos([cot('a', 100), cot('b', 150), cot('c', 300), cot('d', 400)], { dataReferencia: REF });
    assert.deepEqual(r.sugeridasExpurgo, []);
    assert.ok(r.estatisticasSaneadas.coeficienteVariacao > 25);
    assert.equal(r.metodologiaRecomendada, 'mediana');
    assert.equal(r.valorEstimado, 225);
  });
});

describe('analisarCestaPrecos — percentual da mediana', () => {
  it('é o padrão com menos de 4 preços', () => {
    const r = analisarCestaPrecos([cot('a', 10000), cot('b', 10500), cot('c', 30000)], { dataReferencia: REF });
    assert.deepEqual(r.sugeridasExpurgo.map((s) => [s.id, s.motivo]), [['c', 'excessivamente_elevado']]);
    assert.equal(r.estatisticasSaneadas.n, 2);
    assert.equal(r.valorEstimado, 10250);
    assert.ok(codigos(r).includes('MENOS_DE_3_PRECOS'));
    assert.equal(r.alertas.find((a) => a.codigo === 'MENOS_DE_3_PRECOS')?.fundamento, 'IN SEGES/ME 65/2021, art. 6º, § 5º');
  });

  it('pode ser escolhido explicitamente com percentual próprio', () => {
    const r = analisarCestaPrecos([cot('a', 900), cot('b', 1000), cot('c', 1000), cot('d', 1200)], {
      dataReferencia: REF,
      metodo: 'percentual_mediana',
      percentualMediana: 15,
    });
    assert.deepEqual(r.sugeridasExpurgo.map((s) => [s.id, s.motivo]), [['d', 'excessivamente_elevado']]);
  });

  it('se o critério excluísse todos os preços, não sugere expurgo e alerta', () => {
    const r = analisarCestaPrecos([cot('a', 100), cot('b', 1000)], { dataReferencia: REF });
    assert.deepEqual(r.sugeridasExpurgo, []);
    assert.ok(codigos(r).includes('EXPURGO_NAO_SUGERIDO'));
    assert.equal(r.estatisticasSaneadas.n, 2);
  });

  it('um único preço', () => {
    const r = analisarCestaPrecos([cot('a', 5000)], { dataReferencia: REF });
    assert.equal(r.estatisticas.desvioPadrao, 0);
    assert.equal(r.valorEstimado, 5000);
    assert.deepEqual(codigos(r), ['MENOS_DE_3_PRECOS']);
  });
});

describe('analisarCestaPrecos — alertas de conformidade (art. 23, § 1º)', () => {
  const justificada = { justificativaEscolhaFornecedor: 'Fornecedores com atuação no ramo e atendimento ao órgão.' };

  it('pesquisa direta com 3 fornecedores recentes e justificados não gera alerta', () => {
    const r = analisarCestaPrecos(
      [cot('a', 1000, 'fornecedor_direto', '2026-10-01', justificada), cot('b', 1010, 'fornecedor_direto', '2026-10-02', justificada), cot('c', 990, 'fornecedor_direto', '2026-10-03', justificada)],
      { dataReferencia: REF },
    );
    assert.deepEqual(r.alertas, []);
  });

  it('menos de 3 cotações diretas → FORNECEDOR_DIRETO_INSUFICIENTE', () => {
    const r = analisarCestaPrecos([cot('a', 1000, 'fornecedor_direto', '2026-10-01', justificada), cot('b', 1000), cot('c', 1000)], { dataReferencia: REF });
    assert.deepEqual(codigos(r), ['FORNECEDOR_DIRETO_INSUFICIENTE']);
    assert.equal(r.alertas[0]?.fundamento, 'Lei 14.133/2021, art. 23, § 1º, IV');
  });

  it('cotação direta com mais de 6 meses → COTACAO_DIRETA_ANTIGA (borda)', () => {
    const antiga = analisarCestaPrecos([cot('a', 1000, 'fornecedor_direto', '2026-05-07', justificada), cot('b', 1000), cot('c', 1000)], { dataReferencia: REF });
    assert.ok(codigos(antiga).includes('COTACAO_DIRETA_ANTIGA'));
    const limite = analisarCestaPrecos([cot('a', 1000, 'fornecedor_direto', '2026-05-08', justificada), cot('b', 1000), cot('c', 1000)], { dataReferencia: REF });
    assert.ok(!codigos(limite).includes('COTACAO_DIRETA_ANTIGA'));
  });

  it('cotação direta sem justificativa → SEM_JUSTIFICATIVA_FORNECEDOR', () => {
    const r = analisarCestaPrecos(
      [cot('a', 1000, 'fornecedor_direto'), cot('b', 1000, 'fornecedor_direto', '2026-10-01', { justificativaEscolhaFornecedor: '   ' }), cot('c', 1000, 'fornecedor_direto', '2026-10-01', justificada)],
      { dataReferencia: REF },
    );
    assert.deepEqual(codigos(r), ['SEM_JUSTIFICATIVA_FORNECEDOR', 'SEM_JUSTIFICATIVA_FORNECEDOR']);
  });

  it('contratação similar com mais de 1 ano → SIMILAR_ANTIGA (art. 23, § 1º, II)', () => {
    const r = analisarCestaPrecos([cot('a', 1000, 'contratacao_similar', '2025-11-07'), cot('b', 1000, 'contratacao_similar', '2025-11-08'), cot('c', 1000)], { dataReferencia: REF });
    assert.deepEqual(codigos(r), ['SIMILAR_ANTIGA']);
    assert.match(r.alertas[0]?.mensagem ?? '', /^Contratação similar a /);
    assert.equal(r.alertas[0]?.fundamento, 'Lei 14.133/2021, art. 23, § 1º, II');
  });

  it('mídia especializada com mais de 6 meses → MIDIA_ANTIGA (art. 23, § 1º, III)', () => {
    const r = analisarCestaPrecos([cot('a', 1000, 'midia_especializada', '2026-05-01'), cot('b', 1000), cot('c', 1000)], { dataReferencia: REF });
    assert.deepEqual(codigos(r), ['MIDIA_ANTIGA']);
    assert.equal(r.alertas[0]?.fundamento, 'Lei 14.133/2021, art. 23, § 1º, III');
  });
});

describe('analisarCestaPrecos — validação', () => {
  it('cesta vazia → CESTA_VAZIA', () => {
    assert.throws(() => analisarCestaPrecos([], { dataReferencia: REF }), comCodigo('CESTA_VAZIA'));
  });

  it('rejeita cotações inválidas', () => {
    assert.throws(() => analisarCestaPrecos([cot('a', 0)], { dataReferencia: REF }), comCodigo('COTACAO_INVALIDA'));
    assert.throws(() => analisarCestaPrecos([cot('a', 10), cot('a', 20)], { dataReferencia: REF }), comCodigo('COTACAO_INVALIDA'));
    assert.throws(() => analisarCestaPrecos([cot('a', 10, 'outra' as unknown as FonteCotacao)], { dataReferencia: REF }), comCodigo('COTACAO_INVALIDA'));
    assert.throws(() => analisarCestaPrecos([cot('a', 10, 'painel_precos', '2026-02-30')], { dataReferencia: REF }), comCodigo('DATA_INVALIDA'));
  });

  it('rejeita método e percentual inválidos', () => {
    assert.throws(() => analisarCestaPrecos([cot('a', 10)], { dataReferencia: REF, percentualMediana: 0 }), comCodigo('METODO_INVALIDO'));
    assert.throws(
      () => analisarCestaPrecos([cot('a', 10)], { dataReferencia: REF, metodo: 'zscore' as unknown as 'iqr' }),
      comCodigo('METODO_INVALIDO'),
    );
  });
});
