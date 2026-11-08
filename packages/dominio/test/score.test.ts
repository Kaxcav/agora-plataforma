import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, PESOS_IDC_PADRAO, calcularIdc, type IndicadoresDesempenho } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-08';
const AVISO = 'Indicador objetivo de apoio. Não constitui sanção nem impede participação em licitações.';
const base: IndicadoresDesempenho = {
  entregasNoPrazo: 9,
  entregasTotal: 10,
  recebimentosAprovados: 8,
  recebimentosTotal: 10,
  ocorrenciasFiscalizacao: 5,
  ocorrenciasResolvidasNoPrazo: 4,
  sancoes: [],
};

describe('calcularIdc (art. 88, §§ 3º e 4º)', () => {
  it('pondera os componentes com os pesos padrão 0,4 / 0,4 / 0,2', () => {
    const r = calcularIdc(base, HOJE);
    assert.equal(r.nota, 84);
    assert.equal(r.faixa, 'bom');
    assert.deepEqual(
      r.componentes.map((c) => [c.valor, c.peso, c.contribuicao]),
      [
        [90, 0.4, 36],
        [80, 0.4, 32],
        [80, 0.2, 16],
      ],
    );
    assert.equal(r.semHistorico, false);
    assert.deepEqual(r.penalidades, []);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 88, §§ 3º e 4º');
    assert.equal(r.aviso, AVISO);
  });

  it('desconta sanções dos últimos 36 meses', () => {
    const r = calcularIdc({ ...base, sancoes: [{ tipo: 'multa', dataAplicacao: '2025-01-10' }] }, HOJE);
    assert.equal(r.nota, 74);
    assert.equal(r.faixa, 'regular');
    assert.deepEqual(r.penalidades, [{ tipo: 'multa', dataAplicacao: '2025-01-10', desconto: -10 }]);
  });

  it('janela de 36 meses: sanção de exatamente 36 meses atrás já não conta', () => {
    assert.equal(calcularIdc({ ...base, sancoes: [{ tipo: 'advertencia', dataAplicacao: '2023-11-08' }] }, HOJE).penalidades.length, 0);
    assert.equal(calcularIdc({ ...base, sancoes: [{ tipo: 'advertencia', dataAplicacao: '2023-11-09' }] }, HOJE).nota, 79);
  });

  it('sanção com data futura é ignorada', () => {
    assert.equal(calcularIdc({ ...base, sancoes: [{ tipo: 'multa', dataAplicacao: '2026-11-09' }] }, HOJE).penalidades.length, 0);
  });

  it('descontos por tipo e limite inferior 0', () => {
    const r = calcularIdc(
      {
        ...base,
        sancoes: [
          { tipo: 'impedimento_licitar', dataAplicacao: '2026-01-01' },
          { tipo: 'declaracao_inidoneidade', dataAplicacao: '2026-02-01' },
        ],
      },
      HOJE,
    );
    assert.deepEqual(r.penalidades.map((p) => p.desconto), [-25, -40]);
    assert.equal(r.nota, 19);
    assert.equal(r.faixa, 'critico');
    const zero = calcularIdc({ ...base, sancoes: [...r.penalidades, { tipo: 'declaracao_inidoneidade', dataAplicacao: '2026-03-01' }] }, HOJE);
    assert.equal(zero.nota, 0);
  });

  it('faixas: excelente, bom, regular, insuficiente e crítico', () => {
    const tudo = (n: number, total: number): IndicadoresDesempenho => ({
      entregasNoPrazo: n, entregasTotal: total, recebimentosAprovados: n, recebimentosTotal: total,
      ocorrenciasFiscalizacao: total, ocorrenciasResolvidasNoPrazo: n, sancoes: [],
    });
    assert.equal(calcularIdc(tudo(9, 10), HOJE).faixa, 'excelente');
    assert.equal(calcularIdc(tudo(3, 4), HOJE).faixa, 'bom');
    assert.equal(calcularIdc(tudo(6, 10), HOJE).faixa, 'regular');
    assert.equal(calcularIdc(tudo(4, 10), HOJE).faixa, 'insuficiente');
    assert.equal(calcularIdc(tudo(39, 100), HOJE).faixa, 'critico');
  });

  it('componente sem dados vale 100 e é indicado na metodologia', () => {
    const r = calcularIdc({ ...base, ocorrenciasFiscalizacao: 0, ocorrenciasResolvidasNoPrazo: 0 }, HOJE);
    assert.equal(r.nota, 88);
    assert.equal(r.componentes[2]?.valor, 100);
    assert.match(r.metodologia, /sem dados \(considerados 100\): Tratamento de ocorrências/i);
  });

  it('sem histórico: nota 0, faixa regular, sem penalizar a ausência de dados', () => {
    const r = calcularIdc(
      { entregasNoPrazo: 0, entregasTotal: 0, recebimentosAprovados: 0, recebimentosTotal: 0, ocorrenciasFiscalizacao: 0, ocorrenciasResolvidasNoPrazo: 0, sancoes: [] },
      HOJE,
    );
    assert.equal(r.nota, 0);
    assert.equal(r.faixa, 'regular');
    assert.equal(r.semHistorico, true);
    assert.match(r.metodologia, /Sem histórico/);
  });

  it('nota com 1 casa decimal', () => {
    const r = calcularIdc({ ...base, entregasNoPrazo: 2, entregasTotal: 3, recebimentosAprovados: 1, recebimentosTotal: 1, ocorrenciasFiscalizacao: 0, ocorrenciasResolvidasNoPrazo: 0 }, HOJE);
    assert.equal(r.nota, 86.7);
  });

  it('aceita pesos próprios que somam 1', () => {
    assert.ok(Object.isFrozen(PESOS_IDC_PADRAO));
    const r = calcularIdc(base, HOJE, { prazo: 1, qualidade: 0, ocorrencias: 0 });
    assert.equal(r.nota, 90);
    assert.match(r.metodologia, /100% × pontualidade/);
  });

  it('rejeita entradas inválidas', () => {
    assert.throws(() => calcularIdc(base, HOJE, { prazo: 0.5, qualidade: 0.5, ocorrencias: 0.5 }), comCodigo('IDC_INVALIDO'));
    assert.throws(() => calcularIdc(base, HOJE, { prazo: 1.2, qualidade: -0.2, ocorrencias: 0 }), comCodigo('IDC_INVALIDO'));
    assert.throws(() => calcularIdc({ ...base, entregasNoPrazo: 11 }, HOJE), comCodigo('IDC_INVALIDO'));
    assert.throws(() => calcularIdc({ ...base, entregasTotal: -1 }, HOJE), comCodigo('IDC_INVALIDO'));
    assert.throws(() => calcularIdc({ ...base, sancoes: [{ tipo: 'suspensao' as unknown as 'multa', dataAplicacao: HOJE }] }, HOJE), comCodigo('IDC_INVALIDO'));
    assert.throws(() => calcularIdc(base, '2026-02-30'), comCodigo('DATA_INVALIDA'));
  });
});
