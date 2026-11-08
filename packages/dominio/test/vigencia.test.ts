import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, adicionarDias, classificarVigencia, projetarQueimaSaldo } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-08';
const fimEm = (dias: number) => adicionarDias(HOJE, dias);

describe('classificarVigencia', () => {
  it('vencido quando os dias restantes são negativos', () => {
    assert.deepEqual(classificarVigencia(fimEm(-3), HOJE), { diasRestantes: -3, semaforo: 'vencido', rotulo: 'Vencido há 3 dias' });
    assert.equal(classificarVigencia(fimEm(-1), HOJE).rotulo, 'Vencido há 1 dia');
  });

  it('vence hoje é crítico', () => {
    assert.deepEqual(classificarVigencia(HOJE, HOJE), { diasRestantes: 0, semaforo: 'critico', rotulo: 'Vence hoje' });
  });

  it('respeita as faixas 30/60/90/120 nas bordas', () => {
    const casos: [number, string][] = [
      [1, 'critico'],
      [30, 'critico'],
      [31, 'atencao'],
      [60, 'atencao'],
      [61, 'alerta'],
      [90, 'alerta'],
      [91, 'planejamento'],
      [120, 'planejamento'],
      [121, 'regular'],
      [400, 'regular'],
    ];
    for (const [dias, semaforo] of casos) assert.equal(classificarVigencia(fimEm(dias), HOJE).semaforo, semaforo, String(dias));
  });

  it('rótulos no singular e no plural', () => {
    assert.equal(classificarVigencia(fimEm(1), HOJE).rotulo, 'Vence em 1 dia');
    assert.equal(classificarVigencia(fimEm(45), HOJE).rotulo, 'Vence em 45 dias');
  });

  it('rejeita data inválida', () => {
    assert.throws(() => classificarVigencia('2026-02-30', HOJE), comCodigo('DATA_INVALIDA'));
  });
});

describe('projetarQueimaSaldo', () => {
  const base = { valorTotal: 1_200_000, inicio: '2026-01-01', fim: '2026-12-31', hoje: '2026-06-30' };

  it('execução acelerada esgota o saldo antes do fim', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 900_000 });
    assert.equal(r.percentualExecutado, 75);
    assert.equal(r.percentualTempoDecorrido, 49.5);
    assert.equal(r.ritmoDiario, 5_000);
    assert.equal(r.dataEsgotamentoProjetada, '2026-08-29');
    assert.equal(r.esgotaAntesDoFim, true);
    assert.equal(r.sinal, 'acelerado');
    assert.match(r.explicacao, /29\/08\/2026/);
  });

  it('execução compatível com o tempo é normal', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 600_000 });
    assert.equal(r.sinal, 'normal');
    assert.equal(r.ritmoDiario, 3_333);
    assert.equal(r.dataEsgotamentoProjetada, '2026-12-27');
  });

  it('execução lenta não esgota antes do fim', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 100_000 });
    assert.equal(r.percentualExecutado, 8.3);
    assert.equal(r.sinal, 'lento');
    assert.equal(r.esgotaAntesDoFim, false);
    assert.equal(r.ritmoDiario, 556);
  });

  it('bordas dos limiares de sinal (+15 e −30 pontos)', () => {
    const meio = { valorTotal: 1_000_000, inicio: '2026-01-01', fim: '2026-01-11', hoje: '2026-01-06' };
    assert.equal(projetarQueimaSaldo({ ...meio, valorExecutado: 650_000 }).sinal, 'normal');
    assert.equal(projetarQueimaSaldo({ ...meio, valorExecutado: 651_000 }).sinal, 'acelerado');
    assert.equal(projetarQueimaSaldo({ ...meio, valorExecutado: 200_000 }).sinal, 'normal');
    assert.equal(projetarQueimaSaldo({ ...meio, valorExecutado: 199_000 }).sinal, 'lento');
  });

  it('sem dias decorridos: ritmo 0 e sem projeção', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 0, hoje: '2025-12-15' });
    assert.equal(r.ritmoDiario, 0);
    assert.equal(r.dataEsgotamentoProjetada, null);
    assert.equal(r.esgotaAntesDoFim, false);
    assert.equal(r.percentualTempoDecorrido, 0);
  });

  it('saldo já esgotado projeta a data de referência', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 1_200_000 });
    assert.equal(r.dataEsgotamentoProjetada, '2026-06-30');
    assert.equal(r.esgotaAntesDoFim, true);
  });

  it('após o fim da vigência o tempo decorrido é limitado a 100%', () => {
    const r = projetarQueimaSaldo({ ...base, valorExecutado: 1_000_000, hoje: '2027-03-01' });
    assert.equal(r.percentualTempoDecorrido, 100);
  });

  it('rejeita entradas inválidas', () => {
    assert.throws(() => projetarQueimaSaldo({ ...base, valorTotal: 0, valorExecutado: 0 }), comCodigo('QUEIMA_SALDO_INVALIDA'));
    assert.throws(() => projetarQueimaSaldo({ ...base, valorExecutado: -1 }), comCodigo('QUEIMA_SALDO_INVALIDA'));
    assert.throws(() => projetarQueimaSaldo({ ...base, valorExecutado: 0, fim: '2025-12-31' }), comCodigo('QUEIMA_SALDO_INVALIDA'));
  });
});
