import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, avaliarAditivo } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const base = { valorInicialAtualizado: 1_000_000, acrescimosAnteriores: 0, supressoesAnteriores: 0 };

describe('avaliarAditivo (art. 125)', () => {
  it('acréscimo de até 25% é permitido (borda exata)', () => {
    const r = avaliarAditivo({ ...base, acrescimosAnteriores: 200_000, tipo: 'acrescimo', valor: 50_000 });
    assert.equal(r.percentualAcumulado, 25);
    assert.equal(r.limitePercentual, 25);
    assert.equal(r.permitido, true);
    assert.equal(r.margemRestante, 0);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 125');
  });

  it('acréscimo acima de 25% não é permitido', () => {
    const r = avaliarAditivo({ ...base, acrescimosAnteriores: 200_000, tipo: 'acrescimo', valor: 50_001 });
    assert.equal(r.permitido, false);
    assert.equal(r.margemRestante, 0);
    assert.match(r.explicacao, /Excede o limite em R\$ 0,01/);
  });

  it('reforma de edifício ou de equipamento: acréscimos até 50%', () => {
    const r = avaliarAditivo({ ...base, acrescimosAnteriores: 450_000, tipo: 'acrescimo', valor: 50_000, reformaEdificioOuEquipamento: true });
    assert.equal(r.limitePercentual, 50);
    assert.equal(r.percentualAcumulado, 50);
    assert.equal(r.permitido, true);
    const acima = avaliarAditivo({ ...base, acrescimosAnteriores: 450_000, tipo: 'acrescimo', valor: 50_001, reformaEdificioOuEquipamento: true });
    assert.equal(acima.permitido, false);
  });

  it('em reforma, supressões continuam limitadas a 25%', () => {
    const r = avaliarAditivo({ ...base, tipo: 'supressao', valor: 300_000, reformaEdificioOuEquipamento: true });
    assert.equal(r.limitePercentual, 25);
    assert.equal(r.permitido, false);
  });

  it('acréscimos e supressões são computados separadamente, sem compensação', () => {
    const r = avaliarAditivo({ ...base, acrescimosAnteriores: 200_000, supressoesAnteriores: 100_000, tipo: 'acrescimo', valor: 100_000 });
    assert.equal(r.percentualAcumulado, 30);
    assert.equal(r.permitido, false);
    const s = avaliarAditivo({ ...base, acrescimosAnteriores: 250_000, tipo: 'supressao', valor: 100_000 });
    assert.equal(s.percentualAcumulado, 10);
    assert.equal(s.permitido, true);
    assert.equal(s.margemRestante, 150_000);
  });

  it('margem restante nunca ultrapassa o limite em centavos', () => {
    const r = avaliarAditivo({ ...base, valorInicialAtualizado: 1_000_001, tipo: 'acrescimo', valor: 0 });
    assert.equal(r.margemRestante, 250_000);
  });

  it('percentual acumulado com 2 casas', () => {
    const r = avaliarAditivo({ ...base, valorInicialAtualizado: 300_000, tipo: 'acrescimo', valor: 10_000 });
    assert.equal(r.percentualAcumulado, 3.33);
  });

  it('rejeita valores negativos e valor inicial ≤ 0 com ADITIVO_INVALIDO', () => {
    assert.throws(() => avaliarAditivo({ ...base, valorInicialAtualizado: 0, tipo: 'acrescimo', valor: 1 }), comCodigo('ADITIVO_INVALIDO'));
    assert.throws(() => avaliarAditivo({ ...base, tipo: 'acrescimo', valor: -1 }), comCodigo('ADITIVO_INVALIDO'));
    assert.throws(() => avaliarAditivo({ ...base, acrescimosAnteriores: -5, tipo: 'acrescimo', valor: 1 }), comCodigo('ADITIVO_INVALIDO'));
    assert.throws(() => avaliarAditivo({ ...base, supressoesAnteriores: -5, tipo: 'supressao', valor: 1 }), comCodigo('ADITIVO_INVALIDO'));
    assert.throws(() => avaliarAditivo({ ...base, tipo: 'outro' as unknown as 'acrescimo', valor: 1 }), comCodigo('ADITIVO_INVALIDO'));
  });
});
