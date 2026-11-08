import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  calcularDisponibilidade,
  detectarJanelasPncp,
  dimensionarCarga,
  estatisticasLatencia,
  type IntervaloSondagem,
  type VolumesReferencia,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const MIN = 60_000;
const BASE = Date.parse('2026-03-01T03:00:00.000Z');
const em = (minutos: number) => new Date(BASE + minutos * MIN).toISOString();
const OK = { api: true, banco: true, fila: true, sincronizacao: true } as const;
const VALIDADE = 2 * MIN;

function intervalo(de: number, ate: number, alteracoes: Partial<IntervaloSondagem['componentes']> = {}, pncpEmManutencao = false): IntervaloSondagem {
  return { inicio: em(de), fim: em(ate), componentes: { ...OK, ...alteracoes }, pncpEmManutencao };
}

describe('calcularDisponibilidade (IMR-01)', () => {
  it('sondagens contínuas e saudáveis: 100% e atingida', () => {
    const r = calcularDisponibilidade({ inicio: em(0), fim: em(1000), intervalos: [intervalo(0, 999)], validadeMs: VALIDADE, metaPercentual: 99 });
    assert.equal(r.minutosConsiderados, 1000);
    assert.equal(r.minutosDisponiveis, 1000);
    assert.equal(r.percentual, 100);
    assert.equal(r.situacao, 'atingida');
    assert.deepEqual(r.ocorrencias, []);
  });

  it('falha do banco e lacuna sem sondagem contam como indisponíveis, com as causas e o percentual por componente', () => {
    const r = calcularDisponibilidade({
      inicio: em(0),
      fim: em(1000),
      intervalos: [intervalo(0, 400), intervalo(401, 410, { banco: false }), intervalo(411, 600), intervalo(700, 999)],
      validadeMs: VALIDADE,
      metaPercentual: 99,
    });
    // banco fora de 401 a 411; sem sondagem de 602 a 700 (a de 600 vale até 602).
    assert.equal(r.minutosIndisponiveis, 10);
    assert.equal(r.minutosSemMedicao, 98);
    assert.equal(r.minutosDisponiveis, 892);
    assert.equal(r.percentual, 89.2);
    assert.equal(r.situacao, 'nao_atingida');
    assert.deepEqual(
      r.ocorrencias.map((o) => [o.minutos, o.causas]),
      [
        [10, ['banco']],
        [98, ['sem_medicao']],
      ],
    );
    const banco = r.componentes.find((c) => c.componente === 'banco');
    assert.equal(banco?.minutosIndisponiveis, 10);
    assert.equal(r.componentes.find((c) => c.componente === 'api')?.percentual, 90.2);
  });

  it('o período começa na primeira sondagem; antes dela não havia medição', () => {
    const r = calcularDisponibilidade({ inicio: em(0), fim: em(100), intervalos: [intervalo(40, 99)], validadeMs: VALIDADE, metaPercentual: null });
    assert.equal(r.inicioMedicao, em(40));
    assert.equal(r.minutosConsiderados, 60);
    assert.equal(r.percentual, 100);
    assert.equal(r.situacao, 'sem_meta');
    // Com a medição iniciada antes do período, a lacuna no começo do mês conta como sem medição.
    const comInicio = calcularDisponibilidade({ inicio: em(0), fim: em(100), intervalos: [intervalo(40, 99)], validadeMs: VALIDADE, inicioMedicao: em(-500), metaPercentual: null });
    assert.equal(comInicio.minutosConsiderados, 100);
    assert.equal(comInicio.minutosSemMedicao, 40);
    assert.equal(comInicio.percentual, 60);
  });

  it('falha da sincronização dentro de janela do PNCP (registrada ou detectada pela fila) não conta', () => {
    const intervalos = [intervalo(0, 99), intervalo(100, 159, { sincronizacao: false }, true), intervalo(160, 199, { sincronizacao: false }), intervalo(200, 299)];
    const semJanelaRegistrada = calcularDisponibilidade({ inicio: em(0), fim: em(300), intervalos, validadeMs: VALIDADE, metaPercentual: 99 });
    assert.equal(semJanelaRegistrada.minutosIndisponiveis, 40, 'só a parte fora da janela detectada');
    assert.deepEqual(semJanelaRegistrada.janelasPncp.map((j) => [j.origem, j.minutos]), [['detectada', 60]]);
    const comJanelaRegistrada = calcularDisponibilidade({
      inicio: em(0),
      fim: em(300),
      intervalos,
      validadeMs: VALIDADE,
      janelasRegistradas: [{ inicio: em(150), fim: em(210) }],
      metaPercentual: 99,
    });
    assert.equal(comJanelaRegistrada.minutosIndisponiveis, 0);
    assert.equal(comJanelaRegistrada.percentual, 100);
    assert.deepEqual(comJanelaRegistrada.janelasPncp.map((j) => j.origem), ['detectada', 'registrada']);
  });

  it('sem sondagens: sem dados; percentual truncado nunca arredonda para cima', () => {
    assert.equal(calcularDisponibilidade({ inicio: em(0), fim: em(10), intervalos: [], validadeMs: VALIDADE, metaPercentual: 99 }).situacao, 'sem_dados');
    // 9.999 de 10.000 minutos = 99,99%; 1 de 10.000 fora → 99,99 (não 100).
    const r = calcularDisponibilidade({ inicio: em(0), fim: em(10_000), intervalos: [intervalo(0, 4999), intervalo(5000, 5000, { fila: false }), intervalo(5001, 9999)], validadeMs: MIN, metaPercentual: 99.99 });
    assert.equal(r.percentual, 99.99);
    assert.equal(r.situacao, 'atingida');
  });

  it('recusa período invertido, meta fora de (0, 100] e intervalo invertido', () => {
    assert.throws(() => calcularDisponibilidade({ inicio: em(10), fim: em(0), intervalos: [], validadeMs: VALIDADE, metaPercentual: null }), comCodigo('PERIODO_INVALIDO'));
    assert.throws(() => calcularDisponibilidade({ inicio: em(0), fim: em(10), intervalos: [], validadeMs: VALIDADE, metaPercentual: 120 }), comCodigo('META_INVALIDA'));
    assert.throws(() => calcularDisponibilidade({ inicio: em(0), fim: em(10), intervalos: [intervalo(5, 2)], validadeMs: VALIDADE, metaPercentual: null }), comCodigo('INTERVALO_INVALIDO'));
  });
});

describe('detectarJanelasPncp', () => {
  it('une trechos contínuos com o PNCP indisponível', () => {
    const janelas = detectarJanelasPncp([intervalo(0, 9), intervalo(10, 19, {}, true), intervalo(20, 29, {}, true), intervalo(30, 39)], VALIDADE);
    assert.deepEqual(janelas, [{ inicio: em(10), fim: em(30) }]);
  });
});

describe('dimensionarCarga e estatisticasLatencia', () => {
  const volumes: VolumesReferencia = {
    processosAno: 2000,
    documentosAno: 8000,
    usuariosSimultaneos: 120,
    consultasPorUsuarioMinuto: 2,
    escritasPorProcesso: 40,
    diasUteisAno: 250,
    horasExpediente: 8,
    fatorPico: 10,
  };

  it('converte os volumes anuais em vazão de pico por cenário', () => {
    const d = Object.fromEntries(dimensionarCarga(volumes).map((c) => [c.cenario, c.vazaoExigidaPorSegundo]));
    assert.equal(d.listagens, 4);
    assert.equal(d.jornada, 0.1111);
    assert.equal(d.publicacao, 0.0028);
    assert.equal(d.documentos, 0.0111);
    assert.throws(() => dimensionarCarga({ ...volumes, processosAno: 0 }), comCodigo('VOLUME_INVALIDO'));
    assert.throws(() => dimensionarCarga({ ...volumes, horasExpediente: 30 }), comCodigo('VOLUME_INVALIDO'));
  });

  it('percentis pelo posto mais próximo', () => {
    const amostras = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.deepEqual(estatisticasLatencia(amostras), { quantidade: 100, mediaMs: 50.5, p50Ms: 50, p95Ms: 95, p99Ms: 99, maximoMs: 100 });
    assert.throws(() => estatisticasLatencia([]), comCodigo('AMOSTRAS_VAZIAS'));
    assert.throws(() => estatisticasLatencia([1, -2]), comCodigo('AMOSTRA_INVALIDA'));
  });
});
