import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGO_REGRAS, ErroDominio, calcularMultaMoratoria } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('calcularMultaMoratoria (art. 162)', () => {
  it('parcela de R$ 100.000,00 (10000000 centavos), 15 dias, 0,5% ao dia, limite 30 → diasConsiderados 15, percentualAplicado 7.5, valorMulta 750000, limitado false', () => {
    const r = calcularMultaMoratoria({
      valorParcela: 10_000_000,
      diasAtraso: 15,
      percentualDia: 0.5,
      limiteDias: 30,
    });
    assert.equal(r.diasConsiderados, 15);
    assert.equal(r.percentualAplicado, 7.5);
    assert.equal(r.valorMulta, 750_000);
    assert.equal(r.limitado, false);
    assert.ok(Array.isArray(r.memoriaCalculo));
    assert.ok(r.memoriaCalculo.length >= 3);
  });

  it('45 dias com limite 30 → diasConsiderados 30, percentualAplicado 15, limitado true', () => {
    const r = calcularMultaMoratoria({
      valorParcela: 10_000_000,
      diasAtraso: 45,
      percentualDia: 0.5,
      limiteDias: 30,
    });
    assert.equal(r.diasConsiderados, 30);
    assert.equal(r.percentualAplicado, 15);
    assert.equal(r.valorMulta, 1_500_000);
    assert.equal(r.limitado, true);
  });

  it('0 dias → valorMulta 0', () => {
    const r = calcularMultaMoratoria({
      valorParcela: 10_000_000,
      diasAtraso: 0,
      percentualDia: 0.5,
      limiteDias: 30,
    });
    assert.equal(r.diasConsiderados, 0);
    assert.equal(r.percentualAplicado, 0);
    assert.equal(r.valorMulta, 0);
    assert.equal(r.limitado, false);
  });

  it('arredondamento: parcela 333 centavos, 1 dia, 0,5% → valorMulta 2', () => {
    const r = calcularMultaMoratoria({
      valorParcela: 333,
      diasAtraso: 1,
      percentualDia: 0.5,
      limiteDias: 30,
    });
    assert.equal(r.diasConsiderados, 1);
    assert.equal(r.percentualAplicado, 0.5);
    assert.equal(r.valorMulta, 2);
    assert.equal(r.limitado, false);
  });

  it('cada entrada inválida lança ErroDominio com código MULTA_MORATORIA_INVALIDA', () => {
    const base = {
      valorParcela: 10_000_000,
      diasAtraso: 10,
      percentualDia: 0.5,
      limiteDias: 30,
    };

    // dias negativo
    assert.throws(() => calcularMultaMoratoria({ ...base, diasAtraso: -1 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
    // dias fracionário
    assert.throws(() => calcularMultaMoratoria({ ...base, diasAtraso: 2.5 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
    // percentual 0
    assert.throws(() => calcularMultaMoratoria({ ...base, percentualDia: 0 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
    // percentual 11
    assert.throws(() => calcularMultaMoratoria({ ...base, percentualDia: 11 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
    // limite 0
    assert.throws(() => calcularMultaMoratoria({ ...base, limiteDias: 0 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
    // parcela fracionária
    assert.throws(() => calcularMultaMoratoria({ ...base, valorParcela: 1000.5 }), comCodigo('MULTA_MORATORIA_INVALIDA'));
  });

  it('fundamento contém "art. 162" e aviso contém "autoridade competente"', () => {
    const r = calcularMultaMoratoria({
      valorParcela: 10_000_000,
      diasAtraso: 5,
      percentualDia: 0.5,
      limiteDias: 30,
    });
    assert.match(r.fundamento, /art\. 162/);
    assert.match(r.aviso, /autoridade competente/);
  });

  it('o catálogo tem a regra RN-19 com implementacao "calcularMultaMoratoria"', () => {
    const regra = CATALOGO_REGRAS.find((item) => item.id === 'RN-19');
    assert.ok(regra, 'regra RN-19 deve existir no catálogo');
    assert.equal(regra.tipo, 'RN');
    assert.equal(regra.etapa, 7);
    assert.equal(regra.implementacao, 'calcularMultaMoratoria');
    assert.match(regra.fundamento, /art\. 162/);
  });
});
