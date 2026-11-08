import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  calcularAjustePagamento,
  calcularResultadoImr,
  conferirNotaFiscal,
  medicaoImrDevida,
  rotuloCompetencia,
  validarIndicadorImr,
  type IndicadorImr,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

/** Indicador de disponibilidade (meta ≥ 98%): de 95% a menos de 98% glosa 2%; abaixo de 95% glosa 6% e encaminha. */
const DISPONIBILIDADE: IndicadorImr = {
  codigo: 'IND-01',
  nome: 'Disponibilidade do serviço',
  formaCalculo: 'percentual_razao',
  unidade: '%',
  sentidoMeta: 'maior_igual',
  meta: 98,
  periodicidade: 'mensal',
  inicioCompetencia: '2026-08',
  faixas: [
    { limite: 95, percentualGlosa: 6, percentualPorUnidade: 0, encaminharSancionatorio: true },
    { limite: 98, percentualGlosa: 2, percentualPorUnidade: 0, encaminharSancionatorio: false },
  ],
  tetoPercentual: null,
};

/** Tempo de atendimento (meta ≤ 4 h): acima de 4 h, 0,5% por hora adicional, com teto de 3%. */
const TEMPO: IndicadorImr = {
  codigo: 'IND-02',
  nome: 'Tempo de atendimento de chamados críticos',
  formaCalculo: 'valor_medido',
  unidade: 'horas',
  sentidoMeta: 'menor_igual',
  meta: 4,
  periodicidade: 'mensal',
  inicioCompetencia: '2026-08',
  faixas: [{ limite: 4, percentualGlosa: 0, percentualPorUnidade: 0.5, encaminharSancionatorio: false }],
  tetoPercentual: 3,
};

describe('validarIndicadorImr', () => {
  it('ordena as faixas da mais branda à mais severa e fixa "%" na forma percentual', () => {
    const v = validarIndicadorImr({ ...DISPONIBILIDADE, unidade: 'qualquer' });
    assert.deepEqual(
      v.faixas.map((f) => f.limite),
      [98, 95],
    );
    assert.equal(v.unidade, '%');
  });

  it('recusa faixa dentro da meta, limites repetidos, glosa que diminui com a piora e faixa sem efeito', () => {
    const casos: Partial<IndicadorImr>[] = [
      { faixas: [{ limite: 99, percentualGlosa: 2, percentualPorUnidade: 0, encaminharSancionatorio: false }] },
      {
        faixas: [
          { limite: 95, percentualGlosa: 2, percentualPorUnidade: 0, encaminharSancionatorio: false },
          { limite: 95, percentualGlosa: 3, percentualPorUnidade: 0, encaminharSancionatorio: false },
        ],
      },
      {
        faixas: [
          { limite: 95, percentualGlosa: 1, percentualPorUnidade: 0, encaminharSancionatorio: false },
          { limite: 98, percentualGlosa: 2, percentualPorUnidade: 0, encaminharSancionatorio: false },
        ],
      },
      { faixas: [{ limite: 97, percentualGlosa: 0, percentualPorUnidade: 0, encaminharSancionatorio: false }] },
      { faixas: [] },
      { meta: 120 },
      { tetoPercentual: 0 },
      { inicioCompetencia: '2026-13' },
      { periodicidade: 'quinzenal' as IndicadorImr['periodicidade'] },
      { periodicidade: 'toString' as IndicadorImr['periodicidade'] },
      { nome: 'ab' },
    ];
    for (const alteracao of casos) {
      assert.throws(() => validarIndicadorImr({ ...DISPONIBILIDADE, ...alteracao }), comCodigo('IMR_INVALIDO'), JSON.stringify(alteracao));
    }
  });

  it('meta "≤": o limite precisa ficar acima da meta', () => {
    assert.throws(
      () => validarIndicadorImr({ ...TEMPO, faixas: [{ limite: 3, percentualGlosa: 1, percentualPorUnidade: 0, encaminharSancionatorio: false }] }),
      comCodigo('IMR_INVALIDO'),
    );
  });
});

describe('calcularResultadoImr', () => {
  it('percentual: numerador ÷ denominador × 100, arredondado a 2 casas', () => {
    assert.equal(calcularResultadoImr(DISPONIBILIDADE, { numerador: 43_000, denominador: 43_200 }).resultado, 99.54);
    assert.equal(calcularResultadoImr(DISPONIBILIDADE, { numerador: 1, denominador: 3 }).resultado, 33.33);
  });

  it('valor medido: o próprio valor, não negativo', () => {
    assert.equal(calcularResultadoImr(TEMPO, { valor: 5.256 }).resultado, 5.26);
    assert.throws(() => calcularResultadoImr(TEMPO, { valor: -1 }), comCodigo('MEDICAO_IMR_INVALIDA'));
  });

  it('recusa denominador zero, numerador maior que o denominador e campos ausentes', () => {
    assert.throws(() => calcularResultadoImr(DISPONIBILIDADE, { numerador: 1, denominador: 0 }), comCodigo('MEDICAO_IMR_INVALIDA'));
    assert.throws(() => calcularResultadoImr(DISPONIBILIDADE, { numerador: 5, denominador: 4 }), comCodigo('MEDICAO_IMR_INVALIDA'));
    assert.throws(() => calcularResultadoImr(DISPONIBILIDADE, { valor: 99 }), comCodigo('MEDICAO_IMR_INVALIDA'));
    assert.throws(() => calcularResultadoImr(TEMPO, {}), comCodigo('MEDICAO_IMR_INVALIDA'));
  });
});

describe('calcularAjustePagamento', () => {
  it('meta atingida (98%) → sem glosa, sem faixa', () => {
    const r = calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 98, base: 1_000_000 });
    assert.equal(r.atingiuMeta, true);
    assert.equal(r.faixa, null);
    assert.equal(r.percentualGlosa, 0);
    assert.equal(r.valorGlosa, 0);
    assert.match(r.fundamento, /art\. 6º, XXIII, "g"/);
    assert.match(r.aviso, /não é sanção/);
  });

  it('97,9% → faixa 1, glosa de 2% sobre R$ 10.000,00 = R$ 200,00, sem encaminhamento', () => {
    const r = calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 97.9, base: 1_000_000 });
    assert.equal(r.atingiuMeta, false);
    assert.equal(r.faixa, 1);
    assert.equal(r.percentualGlosa, 2);
    assert.equal(r.valorGlosa, 20_000);
    assert.equal(r.encaminharSancionatorio, false);
    assert.ok(r.memoriaCalculo.some((l) => l.includes('Faixa 1')));
  });

  it('94,99% → faixa 2 (a mais severa alcançada), glosa de 6% e encaminhamento sancionatório', () => {
    const r = calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 94.99, base: 1_000_000 });
    assert.equal(r.faixa, 2);
    assert.equal(r.percentualGlosa, 6);
    assert.equal(r.valorGlosa, 60_000);
    assert.equal(r.encaminharSancionatorio, true);
  });

  it('95% exatos ainda é faixa 1 (a faixa 2 vale abaixo de 95%)', () => {
    assert.equal(calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 95 }).faixa, 1);
  });

  it('tolerância: abaixo da meta e antes do primeiro limite → sem glosa', () => {
    const comTolerancia: IndicadorImr = { ...DISPONIBILIDADE, faixas: [{ limite: 96, percentualGlosa: 2, percentualPorUnidade: 0, encaminharSancionatorio: false }] };
    const r = calcularAjustePagamento({ indicador: comTolerancia, resultado: 97 });
    assert.equal(r.atingiuMeta, false);
    assert.equal(r.faixa, null);
    assert.equal(r.percentualGlosa, 0);
    assert.equal(r.valorGlosa, null);
  });

  it('por unidade: 6,2 h com meta de 4 h → 3 horas adicionais (fração conta) × 0,5% = 1,5%', () => {
    const r = calcularAjustePagamento({ indicador: TEMPO, resultado: 6.2, base: 333_333 });
    assert.equal(r.unidadesExcedentes, 3);
    assert.equal(r.percentualGlosa, 1.5);
    assert.equal(r.valorGlosa, 5_000);
    assert.equal(r.limitadoAoTeto, false);
  });

  it('teto: 20 h → 16 horas × 0,5% = 8%, limitado ao teto de 3%', () => {
    const r = calcularAjustePagamento({ indicador: TEMPO, resultado: 20, base: 100_000 });
    assert.equal(r.percentualGlosa, 3);
    assert.equal(r.limitadoAoTeto, true);
    assert.equal(r.valorGlosa, 3_000);
  });

  it('determinístico: a mesma entrada gera a mesma memória de cálculo', () => {
    const a = calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 96.5, base: 123_456 });
    const b = calcularAjustePagamento({ indicador: DISPONIBILIDADE, resultado: 96.5, base: 123_456 });
    assert.deepEqual(a, b);
  });
});

describe('medicaoImrDevida e rotuloCompetencia', () => {
  it('mensal: todo mês a partir do início; trimestral: a cada 3 meses', () => {
    assert.equal(medicaoImrDevida(DISPONIBILIDADE, '2026-07'), false);
    assert.equal(medicaoImrDevida(DISPONIBILIDADE, '2026-08'), true);
    assert.equal(medicaoImrDevida(DISPONIBILIDADE, '2027-01'), true);
    const trimestral = { inicioCompetencia: '2026-08', periodicidade: 'trimestral' as const };
    assert.deepEqual(
      ['2026-08', '2026-09', '2026-10', '2026-11', '2027-01'].map((c) => medicaoImrDevida(trimestral, c)),
      [false, false, true, false, true],
    );
  });

  it('competência inválida → IMR_INVALIDO; rótulo MM/AAAA', () => {
    assert.throws(() => medicaoImrDevida(DISPONIBILIDADE, '2026-00'), comCodigo('IMR_INVALIDO'));
    assert.equal(rotuloCompetencia('2026-10'), '10/2026');
  });
});

describe('conferirNotaFiscal (RN-36)', () => {
  const itensContrato = [
    { id: 'a', numero: 1, descricao: 'Serviço mensal', valorUnitario: 1_000_000, saldoQuantidade: 10 },
    { id: 'b', numero: 2, descricao: 'Atendimento extraordinário', valorUnitario: 50_000, saldoQuantidade: 20 },
  ];
  const nota = [
    { itemContratoId: 'a', quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 1_000_000 },
    { itemContratoId: 'b', quantidadeRecebida: 2, quantidadeFaturada: 2, valorUnitarioFaturado: 50_000 },
  ];

  it('nota igual ao devido, sem IMR → conforme; valor a liquidar = valor da nota', () => {
    const r = conferirNotaFiscal({ valorNota: 1_100_000, itensContrato, itensNota: nota, glosasImr: [], medicoesPendentes: [] });
    assert.equal(r.valorBruto, 1_100_000);
    assert.equal(r.valorDevido, 1_100_000);
    assert.equal(r.diferenca, 0);
    assert.equal(r.conforme, true);
    assert.equal(r.valorALiquidar, 1_100_000);
    assert.match(r.fundamento, /arts\. 117, 140 e 141/);
  });

  it('glosa do IMR só sobre o item alcançado: 2% de R$ 10.000,00 → devido R$ 10.800,00; nota cheia diverge em R$ 200,00', () => {
    const r = conferirNotaFiscal({
      valorNota: 1_100_000,
      itensContrato,
      itensNota: nota,
      glosasImr: [{ codigo: 'IND-01', nome: 'Disponibilidade', percentual: 2, itensAlcancados: ['a'] }],
      medicoesPendentes: [],
    });
    assert.equal(r.glosas[0]?.base, 1_000_000);
    assert.equal(r.glosaImr, 20_000);
    assert.equal(r.valorDevido, 1_080_000);
    assert.equal(r.diferenca, 20_000);
    assert.equal(r.valorALiquidar, 1_080_000);
    assert.equal(r.conforme, false);
    assert.deepEqual(
      r.divergencias.map((d) => d.tipo),
      ['valor_nota_diferente_do_devido'],
    );
  });

  it('nota já com a glosa descontada → conforme', () => {
    const r = conferirNotaFiscal({
      valorNota: 1_080_000,
      itensContrato,
      itensNota: [
        { itemContratoId: 'a', quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 980_000 },
        { itemContratoId: 'b', quantidadeRecebida: 2, quantidadeFaturada: 2, valorUnitarioFaturado: 50_000 },
      ],
      glosasImr: [{ codigo: 'IND-01', nome: 'Disponibilidade', percentual: 2, itensAlcancados: ['a'] }],
      medicoesPendentes: [],
    });
    assert.equal(r.conforme, true, JSON.stringify(r.divergencias));
  });

  it('aponta preço acima do contratado, quantidade cobrada maior que a recebida, saldo, soma dos itens e medição pendente', () => {
    const r = conferirNotaFiscal({
      valorNota: 999,
      itensContrato,
      itensNota: [{ itemContratoId: 'a', quantidadeRecebida: 11, quantidadeFaturada: 12, valorUnitarioFaturado: 1_000_001 }],
      glosasImr: [],
      medicoesPendentes: [{ codigo: 'IND-02', nome: 'Tempo' }],
    });
    assert.deepEqual(r.divergencias.map((d) => d.tipo).sort(), [
      'medicao_imr_pendente',
      'preco_acima_contratado',
      'quantidade_acima_do_saldo',
      'quantidade_faturada_maior_que_recebida',
      'soma_itens_diferente_do_total',
      'valor_nota_diferente_do_devido',
    ]);
    assert.equal(r.valorALiquidar, 999);
  });

  it('soma das glosas limitada ao valor bruto', () => {
    const r = conferirNotaFiscal({
      valorNota: 0,
      itensContrato,
      itensNota: [{ itemContratoId: 'b', quantidadeRecebida: 1, quantidadeFaturada: 0, valorUnitarioFaturado: 0 }],
      glosasImr: [
        { codigo: 'X', nome: 'X', percentual: 80, itensAlcancados: [] },
        { codigo: 'Y', nome: 'Y', percentual: 60, itensAlcancados: [] },
      ],
      medicoesPendentes: [],
    });
    assert.equal(r.glosaImr, 50_000);
    assert.equal(r.valorDevido, 0);
    assert.equal(r.conforme, true);
  });

  it('recusa item fora do contrato, item repetido, nota sem itens e quantidade fracionada', () => {
    const base = { valorNota: 0, itensContrato, glosasImr: [], medicoesPendentes: [] };
    const item = { itemContratoId: 'a', quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 1 };
    assert.throws(() => conferirNotaFiscal({ ...base, itensNota: [{ ...item, itemContratoId: 'z' }] }), comCodigo('NOTA_FISCAL_INVALIDA'));
    assert.throws(() => conferirNotaFiscal({ ...base, itensNota: [item, item] }), comCodigo('NOTA_FISCAL_INVALIDA'));
    assert.throws(() => conferirNotaFiscal({ ...base, itensNota: [] }), comCodigo('NOTA_FISCAL_INVALIDA'));
    assert.throws(() => conferirNotaFiscal({ ...base, itensNota: [{ ...item, quantidadeRecebida: 1.5 }] }), comCodigo('NOTA_FISCAL_INVALIDA'));
  });
});
