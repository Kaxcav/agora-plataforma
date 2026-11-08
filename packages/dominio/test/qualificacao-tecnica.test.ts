import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  avaliarBalancosApresentados,
  avaliarExigenciasQualificacaoTecnica,
  classificarParcelaRelevancia,
  exerciciosBalancoExigiveis,
  limiteQuantitativoMinimo,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('classificarParcelaRelevancia (art. 67, § 1º)', () => {
  it('parcela de exatamente 4% do total é de maior relevância', () => {
    const r = classificarParcelaRelevancia(400_000, 10_000_000);
    assert.equal(r.maiorRelevancia, true);
    assert.equal(r.percentualDoTotal, 4);
    assert.match(r.fundamento, /art\. 67, § 1º/);
  });

  it('um centavo abaixo de 4% não é parcela de maior relevância (comparação exata em centavos)', () => {
    const r = classificarParcelaRelevancia(399_999, 10_000_000);
    assert.equal(r.maiorRelevancia, false);
    assert.equal(r.percentualDoTotal, 4);
  });

  it('rejeita valores não positivos ou fracionários', () => {
    assert.throws(() => classificarParcelaRelevancia(0, 10_000_000), comCodigo('QUALIFICACAO_TECNICA_INVALIDA'));
    assert.throws(() => classificarParcelaRelevancia(10.5, 10_000_000), comCodigo('QUALIFICACAO_TECNICA_INVALIDA'));
    assert.throws(() => classificarParcelaRelevancia(100, -1), comCodigo('QUALIFICACAO_TECNICA_INVALIDA'));
  });
});

describe('limiteQuantitativoMinimo (art. 67, § 2º)', () => {
  it('50% da parcela: 1.850 pontos de função → 925; 1.200 unidades → 600; 3 km → 1,5', () => {
    assert.equal(limiteQuantitativoMinimo(1850), 925);
    assert.equal(limiteQuantitativoMinimo(1200), 600);
    assert.equal(limiteQuantitativoMinimo(3), 1.5);
  });
});

describe('avaliarExigenciasQualificacaoTecnica (RN-25)', () => {
  const base = { descricao: 'Desenvolvimento de sistema web transacional', unidade: 'pontos de função', quantidadeObjeto: 1850, valorEstimado: 2_000_000_00 };

  it('parcela relevante com mínimo de 50% é válida', () => {
    const r = avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: 3_000_000_00, parcelas: [{ ...base, quantidadeMinima: 925 }] });
    assert.equal(r.valida, true);
    assert.deepEqual(r.problemas, []);
    const p = r.parcelas[0];
    assert.ok(p);
    assert.equal(p.maiorRelevancia, true);
    assert.equal(p.percentualMinimo, 50);
    assert.equal(p.limiteQuantidadeMinima, 925);
    assert.equal(p.quantidadeMinimaDentroDoLimite, true);
  });

  it('mínimo acima de 50% da parcela é apontado com o máximo admitido', () => {
    const r = avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: 3_000_000_00, parcelas: [{ ...base, quantidadeMinima: 926 }] });
    assert.equal(r.valida, false);
    assert.equal(r.problemas.length, 1);
    assert.match(r.problemas[0]?.mensagem ?? '', /máximo admitido é 925 pontos de função \(art\. 67, § 2º\)/);
  });

  it('parcela abaixo de 4% do total não admite exigência de atestado', () => {
    const r = avaliarExigenciasQualificacaoTecnica({
      valorTotalEstimado: 3_000_000_00,
      parcelas: [{ descricao: 'Treinamento de usuários', unidade: 'horas', quantidadeObjeto: 100, valorEstimado: 100_000_00, quantidadeMinima: 50 }],
    });
    assert.equal(r.valida, false);
    assert.match(r.problemas[0]?.mensagem ?? '', /3,33% do valor total estimado/);
    assert.equal(r.parcelas[0]?.maiorRelevancia, false);
  });

  it('soma das parcelas acima do total é apontada', () => {
    const r = avaliarExigenciasQualificacaoTecnica({
      valorTotalEstimado: 3_000_000_00,
      parcelas: [
        { ...base, quantidadeMinima: 900 },
        { descricao: 'Sustentação do sistema', unidade: 'UST', quantidadeObjeto: 4000, valorEstimado: 1_500_000_00, quantidadeMinima: 1000 },
      ],
    });
    assert.equal(r.valida, false);
    assert.ok(r.problemas.some((p) => p.parcela === -1 && /soma das parcelas/.test(p.mensagem)));
  });

  it('entrada inválida → QUALIFICACAO_TECNICA_INVALIDA', () => {
    assert.throws(
      () => avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: 3_000_000_00, parcelas: [{ ...base, quantidadeMinima: 0 }] }),
      comCodigo('QUALIFICACAO_TECNICA_INVALIDA'),
    );
    assert.throws(
      () => avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: 3_000_000_00, parcelas: [{ ...base, descricao: ' ', quantidadeMinima: 10 }] }),
      comCodigo('QUALIFICACAO_TECNICA_INVALIDA'),
    );
  });
});

describe('exerciciosBalancoExigiveis (art. 69, § 6º)', () => {
  it('empresa com mais de 2 anos → 2 exercícios', () => {
    const r = exerciciosBalancoExigiveis('2019-03-15', '2026-11-09');
    assert.equal(r.quantidade, 2);
    assert.equal(r.constituidaHaMenosDeDoisAnos, false);
    assert.match(r.fundamento, /art\. 69, I e § 6º/);
  });

  it('exatamente 2 anos na data de referência → 2 exercícios; um dia a menos → 1', () => {
    assert.equal(exerciciosBalancoExigiveis('2024-11-09', '2026-11-09').quantidade, 2);
    assert.equal(exerciciosBalancoExigiveis('2024-11-10', '2026-11-09').quantidade, 1);
  });

  it('constituída há menos de 2 anos → só o último exercício', () => {
    const r = exerciciosBalancoExigiveis('2025-06-01', '2026-11-09');
    assert.equal(r.quantidade, 1);
    assert.equal(r.constituidaHaMenosDeDoisAnos, true);
    assert.match(r.explicacao, /último exercício/);
  });

  it('constituição posterior à referência ou data inválida → erro', () => {
    assert.throws(() => exerciciosBalancoExigiveis('2027-01-01', '2026-11-09'), comCodigo('DATA_CONSTITUICAO_INVALIDA'));
    assert.throws(() => exerciciosBalancoExigiveis('2026-02-30', '2026-11-09'), comCodigo('DATA_INVALIDA'));
  });
});

describe('avaliarBalancosApresentados (art. 69, I e § 6º)', () => {
  it('sem data de constituição → suficiente null e orientação', () => {
    const r = avaliarBalancosApresentados({ dataConstituicao: null, dataReferencia: '2026-11-09', exerciciosApresentados: [2025] });
    assert.equal(r.suficiente, null);
    assert.equal(r.exigidos, null);
    assert.match(r.mensagem, /data de constituição/);
  });

  it('2 exigidos: um só exercício é insuficiente; exercícios repetidos contam uma vez', () => {
    const r = avaliarBalancosApresentados({ dataConstituicao: '2015-01-10', dataReferencia: '2026-11-09', exerciciosApresentados: [2025, 2025] });
    assert.equal(r.exigidos, 2);
    assert.deepEqual(r.apresentados, [2025]);
    assert.equal(r.suficiente, false);
    const ok = avaliarBalancosApresentados({ dataConstituicao: '2015-01-10', dataReferencia: '2026-11-09', exerciciosApresentados: [2024, 2025] });
    assert.deepEqual(ok.apresentados, [2025, 2024]);
    assert.equal(ok.suficiente, true);
  });

  it('empresa recente: um exercício basta', () => {
    const r = avaliarBalancosApresentados({ dataConstituicao: '2025-08-01', dataReferencia: '2026-11-09', exerciciosApresentados: [2025] });
    assert.equal(r.exigidos, 1);
    assert.equal(r.suficiente, true);
  });

  it('exercício fora do intervalo → EXERCICIO_INVALIDO', () => {
    assert.throws(
      () => avaliarBalancosApresentados({ dataConstituicao: null, dataReferencia: '2026-11-09', exerciciosApresentados: [25] }),
      comCodigo('EXERCICIO_INVALIDO'),
    );
  });
});

describe('catálogo — RN-25', () => {
  it('RN-25 aponta as funções do domínio e o fundamento dos arts. 67 e 69', () => {
    const regra = CATALOGO_REGRAS.find((r) => r.id === 'RN-25');
    assert.ok(regra, 'RN-25 deve existir no catálogo');
    assert.equal(regra.tipo, 'RN');
    assert.equal(regra.etapa, 4);
    assert.ok(regra.telas.includes('jornada.documentos'));
    for (const simbolo of ['avaliarExigenciasQualificacaoTecnica', 'classificarParcelaRelevancia', 'exerciciosBalancoExigiveis']) {
      assert.ok(regra.implementacao.includes(simbolo), simbolo);
    }
    assert.match(regra.fundamento, /art\. 67, §§ 1º e 2º/);
    assert.match(regra.fundamento, /art\. 69, I e § 6º/);
  });
});
