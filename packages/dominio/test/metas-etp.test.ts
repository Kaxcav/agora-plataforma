import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  ETAPAS_INSTRUCAO,
  avaliarMitigacaoTravas,
  efeitoExpurgosCesta,
  medirEconomia,
  medirTempoInstrucao,
  situacaoMeta,
  validarMetasEtp,
  type MarcoEtapa,
  type MetasEtp,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const DIA = 86_400_000;
const BASE = Date.parse('2026-01-05T12:00:00.000Z');
const em = (dias: number) => new Date(BASE + dias * DIA).toISOString();

/** Processo sintético que entra em cada etapa nos dias informados (índice 0 = etapa 1). */
function marcos(processoId: string, dias: number[]): MarcoEtapa[] {
  return dias.map((d, i) => ({ processoId, etapa: i + 1, ocorridoEm: em(d) }));
}

const METAS_TEMPO: MetasEtp['tempoInstrucao'] = { reducaoPercentual: 50, linhaBaseDias: { '1': 10, '2': 6, '3': 20, '4': 8 } };

describe('situacaoMeta', () => {
  it('compara no sentido certo e separa falta de meta de falta de dados', () => {
    assert.equal(situacaoMeta(4, 5, 'ate'), 'atingida');
    assert.equal(situacaoMeta(6, 5, 'ate'), 'nao_atingida');
    assert.equal(situacaoMeta(95, 90, 'a_partir'), 'atingida');
    assert.equal(situacaoMeta(80, 90, 'a_partir'), 'nao_atingida');
    assert.equal(situacaoMeta(80, null, 'a_partir'), 'sem_meta');
    assert.equal(situacaoMeta(null, 90, 'a_partir'), 'sem_dados');
  });
});

describe('validarMetasEtp', () => {
  const metas: MetasEtp = { tempoInstrucao: METAS_TEMPO, errosFormais: { mitigacaoPercentual: 90 }, economia: { economiaPercentual: 5 } };

  it('aceita metas coerentes e metas não configuradas (null)', () => {
    assert.equal(validarMetasEtp(metas), metas);
    validarMetasEtp({ tempoInstrucao: { reducaoPercentual: null, linhaBaseDias: { '1': null } }, errosFormais: { mitigacaoPercentual: null }, economia: { economiaPercentual: null } });
  });

  it('recusa percentual fora de (0, 100], linha de base não positiva e etapa fora da instrução', () => {
    assert.throws(() => validarMetasEtp({ ...metas, economia: { economiaPercentual: 0 } }), comCodigo('META_INVALIDA'));
    assert.throws(() => validarMetasEtp({ ...metas, errosFormais: { mitigacaoPercentual: 101 } }), comCodigo('META_INVALIDA'));
    assert.throws(() => validarMetasEtp({ ...metas, tempoInstrucao: { reducaoPercentual: 10, linhaBaseDias: { '3': -1 } } }), comCodigo('META_INVALIDA'));
    assert.throws(() => validarMetasEtp({ ...metas, tempoInstrucao: { reducaoPercentual: 10, linhaBaseDias: { '6': 5 } } }), comCodigo('META_INVALIDA'));
  });
});

describe('medirTempoInstrucao (art. 18, § 1º, IX)', () => {
  it('mede a permanência em cada etapa pela entrada e pela saída, com linha de base, alvo e situação', () => {
    // A: etapas de 4, 2, 9 e 3 dias; B: 6, 4, 11 e 5 dias. Ambos concluíram a instrução (entraram na etapa 5).
    const todos = [...marcos('A', [0, 4, 6, 15, 18]), ...marcos('B', [1, 7, 11, 22, 27])];
    const r = medirTempoInstrucao({ marcos: todos, inicio: em(0), fim: em(40), metas: METAS_TEMPO });
    assert.deepEqual(
      r.etapas.map((e) => [e.etapa, e.processosMedidos, e.mediaDias, e.alvoDias, e.situacao]),
      [
        [1, 2, 5, 5, 'atingida'],
        [2, 2, 3, 3, 'atingida'],
        [3, 2, 10, 10, 'atingida'],
        [4, 2, 4, 4, 'atingida'],
      ],
    );
    assert.equal(r.etapas[0]?.reducaoObtidaPercentual, 50);
    assert.equal(r.fase.processosMedidos, 2);
    assert.equal(r.fase.mediaDias, 22);
    assert.equal(r.fase.medianaDias, 22);
    assert.equal(r.fase.linhaBaseDias, 44);
    assert.equal(r.fase.alvoDias, 22);
    assert.equal(r.fase.situacao, 'atingida');
  });

  it('só conta a permanência cuja saída caiu no período; a etapa em curso não entra', () => {
    const r = medirTempoInstrucao({ marcos: marcos('C', [0, 10, 30]), inicio: em(5), fim: em(20), metas: METAS_TEMPO });
    assert.equal(r.etapas[0]?.processosMedidos, 1);
    assert.equal(r.etapas[0]?.mediaDias, 10);
    assert.equal(r.etapas[0]?.situacao, 'nao_atingida');
    assert.equal(r.etapas[1]?.processosMedidos, 0, 'saída da etapa 2 fora do período');
    assert.equal(r.etapas[1]?.situacao, 'sem_dados');
    assert.equal(r.etapas[2]?.processosMedidos, 0, 'etapa 3 ainda em curso');
    assert.equal(r.fase.processosMedidos, 0);
  });

  it('sem linha de base ou sem meta de redução: sem_meta; a primeira entrada repetida vale', () => {
    const repetido = [...marcos('D', [0, 3]), { processoId: 'D', etapa: 1, ocorridoEm: em(2) }];
    const r = medirTempoInstrucao({ marcos: repetido, inicio: em(0), fim: em(10), metas: { reducaoPercentual: null, linhaBaseDias: {} } });
    assert.equal(r.etapas[0]?.mediaDias, 3);
    assert.equal(r.etapas[0]?.situacao, 'sem_meta');
    assert.equal(r.fase.linhaBaseDias, null);
    assert.deepEqual(ETAPAS_INSTRUCAO, [1, 2, 3, 4]);
  });

  it('recusa período invertido, instante inválido e etapas fora da jornada', () => {
    assert.throws(() => medirTempoInstrucao({ marcos: [], inicio: em(5), fim: em(1), metas: METAS_TEMPO }), comCodigo('PERIODO_INVALIDO'));
    assert.throws(() => medirTempoInstrucao({ marcos: [{ processoId: 'X', etapa: 1, ocorridoEm: 'ontem' }], inicio: em(0), fim: em(1), metas: METAS_TEMPO }), comCodigo('INSTANTE_INVALIDO'));
    assert.throws(() => medirTempoInstrucao({ marcos: [], inicio: em(0), fim: em(1), metas: METAS_TEMPO, etapas: [0] }), comCodigo('ETAPA_INVALIDA'));
  });
});

describe('avaliarMitigacaoTravas', () => {
  it('conta bloqueios por regra e por trava, processos afetados e a mitigação contra a meta', () => {
    const r = avaliarMitigacaoTravas({
      bloqueios: [
        { regras: ['RN-04'], trava: 'avanco_etapa', processoId: 'A' },
        { regras: ['RN-04', 'RN-05'], trava: 'avanco_etapa', processoId: 'A' },
        { regras: ['RN-01'], trava: 'documento_gerar', processoId: 'B' },
        { regras: ['RN-09'], trava: 'assinatura', processoId: 'C' },
      ],
      ocorrenciasNaoBarradas: 1,
      metaPercentual: 90,
    });
    assert.equal(r.bloqueios, 4);
    assert.equal(r.processosAfetados, 3);
    assert.equal(r.mitigacaoPercentual, 80);
    assert.equal(r.situacao, 'nao_atingida');
    assert.deepEqual(r.porRegra[0], { regra: 'RN-04', bloqueios: 2 });
    assert.deepEqual(r.porTrava[0], { trava: 'avanco_etapa', bloqueios: 2 });
  });

  it('sem ocorrências: mitigação null (sem dados); contagem negativa é recusada', () => {
    const r = avaliarMitigacaoTravas({ bloqueios: [], ocorrenciasNaoBarradas: 0, metaPercentual: 95 });
    assert.equal(r.mitigacaoPercentual, null);
    assert.equal(r.situacao, 'sem_dados');
    assert.throws(() => avaliarMitigacaoTravas({ bloqueios: [], ocorrenciasNaoBarradas: -1, metaPercentual: null }), comCodigo('CONTAGEM_INVALIDA'));
  });
});

describe('medirEconomia e efeitoExpurgosCesta', () => {
  const cotacoes = [
    { valorUnitario: 10_000, expurgada: false },
    { valorUnitario: 12_000, expurgada: false },
    { valorUnitario: 11_000, expurgada: false },
    { valorUnitario: 31_000, expurgada: true },
  ];

  it('efeito dos expurgos: média com e sem as cotações descartadas, projetada na quantidade', () => {
    const e = efeitoExpurgosCesta(cotacoes, 10);
    assert.equal(e.cotacoes, 4);
    assert.equal(e.descartadas, 1);
    assert.equal(e.mediaComDescartadas, 16_000);
    assert.equal(e.mediaSemDescartadas, 11_000);
    assert.equal(e.diferencaUnitaria, 5_000);
    assert.equal(e.efeitoNoEstimado, 50_000);
    assert.equal(efeitoExpurgosCesta(cotacoes.slice(0, 3), 10).efeitoNoEstimado, 0, 'sem descarte, sem efeito');
    assert.throws(() => efeitoExpurgosCesta(cotacoes, -1), comCodigo('QUANTIDADE_INVALIDA'));
  });

  it('economia ponderada pelo valor, por processo e no total; o efeito dos expurgos fica à parte', () => {
    const r = medirEconomia({
      processos: [
        { processoId: 'A', valorEstimado: 1_000_000, valorContratado: 900_000, cotacoes, quantidadeReferencia: 10 },
        { processoId: 'B', valorEstimado: 3_000_000, valorContratado: 3_060_000, cotacoes: [], quantidadeReferencia: 1 },
      ],
      metaPercentual: 1,
    });
    assert.equal(r.processos[0]?.economia, 100_000);
    assert.equal(r.processos[0]?.economiaPercentual, 10);
    assert.equal(r.processos[1]?.economia, -60_000, 'contratado acima do estimado');
    assert.equal(r.totalEstimado, 4_000_000);
    assert.equal(r.totalContratado, 3_960_000);
    assert.equal(r.economia, 40_000);
    assert.equal(r.economiaPercentual, 1);
    assert.equal(r.situacao, 'atingida');
    assert.deepEqual(r.expurgos, { processosComExpurgo: 1, cotacoesDescartadas: 1, efeitoNoEstimado: 50_000 });
  });

  it('sem processo medido: percentual null; valor negativo é recusado', () => {
    assert.equal(medirEconomia({ processos: [], metaPercentual: 5 }).situacao, 'sem_dados');
    assert.throws(
      () => medirEconomia({ processos: [{ processoId: 'X', valorEstimado: -1, valorContratado: 0, cotacoes: [], quantidadeReferencia: 0 }], metaPercentual: null }),
      comCodigo('VALOR_INVALIDO'),
    );
  });
});
