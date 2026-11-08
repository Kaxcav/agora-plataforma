import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, aplicarPercentual, ehCentavos, formatarMoeda, formatarMoedaCompacta, paraCentavos, percentual, somar } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('ehCentavos', () => {
  it('aceita inteiros finitos, inclusive negativos e zero', () => {
    assert.equal(ehCentavos(100), true);
    assert.equal(ehCentavos(0), true);
    assert.equal(ehCentavos(-5), true);
  });

  it('rejeita frações, não finitos, inteiros inseguros e não números', () => {
    assert.equal(ehCentavos(1.5), false);
    assert.equal(ehCentavos(Number.NaN), false);
    assert.equal(ehCentavos(Number.POSITIVE_INFINITY), false);
    assert.equal(ehCentavos(2 ** 53), false);
    assert.equal(ehCentavos('100'), false);
    assert.equal(ehCentavos(null), false);
  });
});

describe('paraCentavos', () => {
  it('converte número em reais', () => {
    assert.equal(paraCentavos(1234.5), 123450);
    assert.equal(paraCentavos(0.1), 10);
    assert.equal(paraCentavos(-2.5), -250);
  });

  it('elimina ruído binário (1.005 → 101 centavos)', () => {
    assert.equal(paraCentavos(1.005), 101);
  });

  it('aceita os formatos textuais brasileiros', () => {
    assert.equal(paraCentavos('1234,50'), 123450);
    assert.equal(paraCentavos('1.234,50'), 123450);
    assert.equal(paraCentavos('R$ 1.234,50'), 123450);
    assert.equal(paraCentavos('R$ 1.234,50'), 123450);
    assert.equal(paraCentavos('1234,5'), 123450);
    assert.equal(paraCentavos('0,5'), 50);
    assert.equal(paraCentavos('1.000.000'), 100000000);
  });

  it('aceita negativos antes ou depois do símbolo', () => {
    assert.equal(paraCentavos('-R$ 1.234,56'), -123456);
    assert.equal(paraCentavos('R$ -10,00'), -1000);
    assert.equal(paraCentavos('-0,00'), 0);
  });

  it('lê ponto como decimal quando não é agrupamento de milhar', () => {
    assert.equal(paraCentavos('1234.5'), 123450);
    assert.equal(paraCentavos('1.50'), 150);
    assert.equal(paraCentavos('1.234'), 123400);
  });

  it('faz ida e volta com formatarMoeda', () => {
    for (const c of [0, 1, 99, 123456, -987654321]) assert.equal(paraCentavos(formatarMoeda(c)), c);
  });

  it('rejeita entradas inválidas com MOEDA_INVALIDA', () => {
    for (const invalido of ['abc', '', 'R$', '12,345', '1.23.4', '1,2,3', '--1,00', ',50']) {
      assert.throws(() => paraCentavos(invalido), comCodigo('MOEDA_INVALIDA'), invalido);
    }
    assert.throws(() => paraCentavos(Number.NaN), comCodigo('MOEDA_INVALIDA'));
    assert.throws(() => paraCentavos(Number.POSITIVE_INFINITY), comCodigo('MOEDA_INVALIDA'));
  });
});

describe('formatarMoeda', () => {
  it('formata em pt-BR com espaço comum', () => {
    assert.equal(formatarMoeda(123456), 'R$ 1.234,56');
    assert.equal(formatarMoeda(0), 'R$ 0,00');
    assert.equal(formatarMoeda(5), 'R$ 0,05');
    assert.equal(formatarMoeda(100000000), 'R$ 1.000.000,00');
  });

  it('formata negativos como "-R$ 1.234,56"', () => {
    assert.equal(formatarMoeda(-123456), '-R$ 1.234,56');
    assert.equal(formatarMoeda(-1), '-R$ 0,01');
  });

  it('não contém espaços especiais (U+00A0, U+202F)', () => {
    assert.doesNotMatch(formatarMoeda(123456789), /[  ]/);
  });

  it('rejeita valor que não é centavos inteiros', () => {
    assert.throws(() => formatarMoeda(1.5), comCodigo('MOEDA_INVALIDA'));
  });
});

describe('formatarMoedaCompacta', () => {
  it('usa mil, mi e bi com uma casa decimal quando necessária', () => {
    assert.equal(formatarMoedaCompacta(35_000_000), 'R$ 350 mil');
    assert.equal(formatarMoedaCompacta(120_000_000), 'R$ 1,2 mi');
    assert.equal(formatarMoedaCompacta(250_000_000_000), 'R$ 2,5 bi');
    assert.equal(formatarMoedaCompacta(100_000), 'R$ 1 mil');
  });

  it('abaixo de R$ 1 mil usa formatarMoeda', () => {
    assert.equal(formatarMoedaCompacta(99_999), 'R$ 999,99');
    assert.equal(formatarMoedaCompacta(0), 'R$ 0,00');
  });

  it('promove para a escala seguinte quando o arredondamento chega a 1.000', () => {
    assert.equal(formatarMoedaCompacta(99_999_999), 'R$ 1 mi');
  });

  it('formata negativos', () => {
    assert.equal(formatarMoedaCompacta(-150_000_000), '-R$ 1,5 mi');
  });
});

describe('somar', () => {
  it('soma centavos', () => {
    assert.equal(somar(100, 200, -50), 250);
    assert.equal(somar(), 0);
  });

  it('rejeita valores não inteiros', () => {
    assert.throws(() => somar(100, 1.5), comCodigo('MOEDA_INVALIDA'));
  });
});

describe('percentual', () => {
  it('calcula com 1 casa por padrão', () => {
    assert.equal(percentual(1, 3), 33.3);
    assert.equal(percentual(1, 8), 12.5);
    assert.equal(percentual(1, 16), 6.3);
    assert.equal(percentual(-1, 3), -33.3);
  });

  it('respeita o número de casas', () => {
    assert.equal(percentual(1, 3, 2), 33.33);
    assert.equal(percentual(2, 3, 0), 67);
  });

  it('total zero resulta em 0', () => {
    assert.equal(percentual(5, 0), 0);
  });

  it('rejeita casas inválidas', () => {
    assert.throws(() => percentual(1, 2, -1), comCodigo('PERCENTUAL_INVALIDO'));
    assert.throws(() => percentual(1, 2, 1.5), comCodigo('PERCENTUAL_INVALIDO'));
  });
});

describe('aplicarPercentual', () => {
  it('aplica Math.round(c × pct / 100)', () => {
    assert.equal(aplicarPercentual(10000, 25), 2500);
    assert.equal(aplicarPercentual(999, 0.5), 5);
    assert.equal(aplicarPercentual(12345, 1.15), 142);
    assert.equal(aplicarPercentual(1_000_000, 30), 300_000);
  });

  it('não devolve zero negativo', () => {
    assert.ok(Object.is(aplicarPercentual(-100, 0.5), 0));
  });

  it('rejeita centavos inválidos', () => {
    assert.throws(() => aplicarPercentual(10.5, 10), comCodigo('MOEDA_INVALIDA'));
  });
});
