import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, aplicarDesempate, type Licitante } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const lic = (id: string, valorProposta: number, extra: Partial<Licitante> = {}): Licitante => ({ id, nome: `Empresa ${id}`, valorProposta, ...extra });
const ids = (r: ReturnType<typeof aplicarDesempate>) => r.classificacao.map((c) => c.id);

describe('aplicarDesempate — sem empate', () => {
  it('classifica pelo menor valor e não registra passos', () => {
    const r = aplicarDesempate([lic('A', 3000), lic('B', 1000), lic('C', 2000)]);
    assert.deepEqual(ids(r), ['B', 'C', 'A']);
    assert.deepEqual(r.classificacao.map((c) => c.posicao), [1, 2, 3]);
    assert.equal(r.empateDetectado, false);
    assert.equal(r.criterioDecisivo, null);
    assert.deepEqual(r.passos, []);
    assert.equal(r.sorteioNecessario, false);
  });
});

describe('aplicarDesempate — cascata do art. 60', () => {
  it('I: disputa final — menor lance vence e é o valor considerado', () => {
    const r = aplicarDesempate([lic('A', 1000, { lanceDisputaFinal: 950 }), lic('B', 1000, { lanceDisputaFinal: 900 }), lic('C', 1200)]);
    assert.deepEqual(ids(r), ['B', 'A', 'C']);
    assert.equal(r.empateDetectado, true);
    assert.match(r.criterioDecisivo ?? '', /art\. 60, I\)/);
    assert.equal(r.classificacao[0]?.valorConsiderado, 900);
    assert.equal(r.classificacao[2]?.valorConsiderado, 1200);
    assert.equal(r.passos.length, 1);
  });

  it('II antes de III: desempenho prévio prevalece sobre equidade de gênero', () => {
    const r = aplicarDesempate([
      lic('A', 1000, { notaDesempenhoPrevio: 90, acoesEquidadeGenero: false }),
      lic('B', 1000, { notaDesempenhoPrevio: 80, acoesEquidadeGenero: true }),
    ]);
    assert.equal(ids(r)[0], 'A');
    assert.match(r.criterioDecisivo ?? '', /art\. 60, II\)/);
  });

  it('III antes de IV: equidade de gênero prevalece sobre programa de integridade', () => {
    const r = aplicarDesempate([
      lic('A', 1000, { notaDesempenhoPrevio: 85, programaIntegridade: true }),
      lic('B', 1000, { notaDesempenhoPrevio: 85, acoesEquidadeGenero: true }),
    ]);
    assert.equal(ids(r)[0], 'B');
    assert.match(r.criterioDecisivo ?? '', /art\. 60, III/);
  });

  it('IV antes do § 1º: programa de integridade prevalece sobre empresa brasileira', () => {
    const r = aplicarDesempate([lic('A', 1000, { empresaBrasileira: true }), lic('B', 1000, { programaIntegridade: true })]);
    assert.equal(ids(r)[0], 'B');
    assert.match(r.criterioDecisivo ?? '', /art\. 60, IV\)/);
  });

  it('§ 1º na ordem II → III → IV, com o inciso I registrado como não aplicável', () => {
    const r = aplicarDesempate([
      lic('A', 1000, { investePesquisaDesenvolvimentoNoPais: true }),
      lic('B', 1000, { praticaMitigacaoClimatica: true }),
      lic('C', 1000, { empresaBrasileira: true, praticaMitigacaoClimatica: true }),
    ]);
    assert.equal(ids(r)[0], 'C');
    assert.match(r.criterioDecisivo ?? '', /§ 1º, II\)/);
    const naoAplicavel = r.passos.find((p) => p.fundamento === 'Lei 14.133/2021, art. 60, § 1º, I');
    assert.match(naoAplicavel?.resultado ?? '', /^Não aplicável/);
  });

  it('percorre todos os critérios na ordem legal e, persistindo o empate, indica sorteio', () => {
    const r = aplicarDesempate([lic('A', 1000), lic('B', 1000), lic('C', 2000)]);
    assert.deepEqual(
      r.passos.map((p) => p.fundamento),
      [
        'Lei 14.133/2021, art. 60, I',
        'Lei 14.133/2021, art. 60, II',
        'Lei 14.133/2021, art. 60, III; Decreto 11.430/2023',
        'Lei 14.133/2021, art. 60, IV',
        'Lei 14.133/2021, art. 60, § 1º, I',
        'Lei 14.133/2021, art. 60, § 1º, II',
        'Lei 14.133/2021, art. 60, § 1º, III',
        'Lei 14.133/2021, art. 60, § 1º, IV; Lei 12.187/2009',
      ],
    );
    assert.deepEqual(r.passos.map((p) => p.ordem), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(r.sorteioNecessario, true);
    assert.equal(r.criterioDecisivo, null);
    assert.deepEqual(r.classificacao.map((c) => c.posicao), [1, 1, 3]);
  });

  it('o último critério (mitigação climática) ainda pode desempatar', () => {
    const r = aplicarDesempate([lic('A', 1000), lic('B', 1000, { praticaMitigacaoClimatica: true })]);
    assert.equal(ids(r)[0], 'B');
    assert.equal(r.passos.at(-1)?.ordem, 8);
    assert.equal(r.sorteioNecessario, false);
  });

  it('desempate parcial reduz o grupo e o critério seguinte decide', () => {
    const r = aplicarDesempate([
      lic('A', 1000, { acoesEquidadeGenero: true }),
      lic('B', 1000, { acoesEquidadeGenero: true, programaIntegridade: true }),
      lic('C', 1000, { programaIntegridade: true }),
    ]);
    assert.deepEqual(ids(r), ['B', 'A', 'C']);
    assert.match(r.passos[2]?.resultado ?? '', /^Desempate parcial/);
    assert.match(r.criterioDecisivo ?? '', /art\. 60, IV\)/);
  });

  it('licitante sem nota de desempenho perde para quem tem avaliação', () => {
    const r = aplicarDesempate([lic('A', 1000), lic('B', 1000, { notaDesempenhoPrevio: 0 })]);
    assert.equal(ids(r)[0], 'B');
  });

  it('empates abaixo do 1º lugar também são ordenados pelos critérios, sem passos', () => {
    const r = aplicarDesempate([lic('A', 500), lic('B', 1000), lic('C', 1000, { programaIntegridade: true })]);
    assert.deepEqual(ids(r), ['A', 'C', 'B']);
    assert.equal(r.empateDetectado, false);
    assert.deepEqual(r.passos, []);
  });
});

describe('aplicarDesempate — empate ficto ME/EPP (LC 123/2006)', () => {
  it('registra passo informativo quando ME/EPP está até 5% acima da melhor proposta', () => {
    const r = aplicarDesempate([lic('A', 1000), lic('B', 1050, { meEpp: true }), lic('C', 1200, { meEpp: true })], { empateFictoMeEpp: true });
    assert.equal(r.passos.length, 1);
    assert.equal(r.passos[0]?.ordem, 0);
    assert.equal(r.passos[0]?.fundamento, 'LC 123/2006, arts. 44 e 45');
    assert.match(r.passos[0]?.resultado ?? '', /Empresa B/);
    assert.doesNotMatch(r.passos[0]?.resultado ?? '', /Empresa C/);
    assert.deepEqual(ids(r), ['A', 'B', 'C']);
    assert.equal(r.empateDetectado, false);
  });

  it('fora da margem não há passo; margem configurável', () => {
    const licitantes = [lic('A', 1000), lic('B', 1051, { meEpp: true })];
    assert.equal(aplicarDesempate(licitantes, { empateFictoMeEpp: true }).passos.length, 0);
    assert.equal(aplicarDesempate(licitantes, { empateFictoMeEpp: true, margemEmpateFictoPercentual: 10 }).passos.length, 1);
  });

  it('não se aplica quando a melhor proposta já é de ME/EPP ou a opção está desligada', () => {
    assert.equal(aplicarDesempate([lic('A', 1000, { meEpp: true }), lic('B', 1020)], { empateFictoMeEpp: true }).passos.length, 0);
    assert.equal(aplicarDesempate([lic('A', 1000), lic('B', 1020, { meEpp: true })]).passos.length, 0);
  });

  it('precede a cascata do art. 60 quando também há empate real', () => {
    const r = aplicarDesempate([lic('A', 1000), lic('B', 1000, { meEpp: true, notaDesempenhoPrevio: 70 })], { empateFictoMeEpp: true });
    assert.deepEqual(r.passos.slice(0, 3).map((p) => p.ordem), [0, 1, 2]);
    assert.equal(ids(r)[0], 'B');
  });
});

describe('aplicarDesempate — validação', () => {
  it('rejeita lista vazia, ids repetidos, valores e notas inválidos', () => {
    assert.throws(() => aplicarDesempate([]), comCodigo('DESEMPATE_INVALIDO'));
    assert.throws(() => aplicarDesempate([lic('A', 1), lic('A', 2)]), comCodigo('DESEMPATE_INVALIDO'));
    assert.throws(() => aplicarDesempate([lic('A', -1)]), comCodigo('DESEMPATE_INVALIDO'));
    assert.throws(() => aplicarDesempate([lic('A', 1, { notaDesempenhoPrevio: 101 })]), comCodigo('DESEMPATE_INVALIDO'));
    assert.throws(() => aplicarDesempate([lic('A', 1)], { margemEmpateFictoPercentual: -1 }), comCodigo('DESEMPATE_INVALIDO'));
  });
});
