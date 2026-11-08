import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, LIMITES_DISPENSA, avaliarFracionamento, limiteDispensaVigente, type LimiteDispensa } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('LIMITES_DISPENSA', () => {
  it('contém a série de decretos de atualização e é imutável', () => {
    assert.equal(LIMITES_DISPENSA.length, 5);
    assert.ok(Object.isFrozen(LIMITES_DISPENSA));
    assert.deepEqual(
      LIMITES_DISPENSA.map((l) => l.norma),
      [
        'Lei 14.133/2021, art. 75, I e II (valores originais)',
        'Decreto 10.922/2021',
        'Decreto 11.317/2022',
        'Decreto 11.871/2023',
        'Decreto 12.343/2024',
      ],
    );
  });
});

describe('limiteDispensaVigente', () => {
  it("'demais' em 2025-06-01 = 6.272.559 centavos (Decreto 12.343/2024)", () => {
    const r = limiteDispensaVigente('2025-06-01', 'demais');
    assert.equal(r.valor, 6_272_559);
    assert.equal(r.norma, 'Decreto 12.343/2024');
    assert.equal(r.vigenteDesde, '2025-01-01');
    assert.match(r.fundamento, /art\. 75, II/);
    assert.match(r.fundamento, /art\. 182/);
  });

  it('obras e serviços de engenharia usam o inciso I', () => {
    const r = limiteDispensaVigente('2025-06-01', 'obras_servicos_engenharia');
    assert.equal(r.valor, 12_545_115);
    assert.match(r.fundamento, /art\. 75, I,/);
  });

  it('a vigência muda exatamente no primeiro dia do ano', () => {
    assert.equal(limiteDispensaVigente('2024-12-31', 'demais').valor, 5_990_602);
    assert.equal(limiteDispensaVigente('2025-01-01', 'demais').valor, 6_272_559);
    assert.equal(limiteDispensaVigente('2022-01-01', 'obras_servicos_engenharia').valor, 10_804_082);
    assert.equal(limiteDispensaVigente('2023-07-15', 'demais').valor, 5_720_833);
  });

  it('valores originais a partir de 2021-04-01', () => {
    assert.equal(limiteDispensaVigente('2021-04-01', 'demais').valor, 5_000_000);
    assert.equal(limiteDispensaVigente('2021-12-31', 'obras_servicos_engenharia').valor, 10_000_000);
  });

  it('usa a vigência mais recente da tabela para datas futuras', () => {
    assert.equal(limiteDispensaVigente('2026-11-08', 'demais').norma, 'Decreto 12.343/2024');
  });

  it('aceita tabela própria fora de ordem', () => {
    const tabela: LimiteDispensa[] = [
      { norma: 'Decreto B', vigenteDesde: '2030-01-01', obrasServicosEngenharia: 300, demais: 200 },
      { norma: 'Decreto A', vigenteDesde: '2029-01-01', obrasServicosEngenharia: 150, demais: 100 },
    ];
    assert.equal(limiteDispensaVigente('2030-06-01', 'demais', tabela).norma, 'Decreto B');
    assert.equal(limiteDispensaVigente('2029-06-01', 'demais', tabela).valor, 100);
  });

  it('data anterior à primeira vigência → LIMITE_INEXISTENTE', () => {
    assert.throws(() => limiteDispensaVigente('2021-03-31', 'demais'), comCodigo('LIMITE_INEXISTENTE'));
  });

  it('rejeita tipo e data inválidos', () => {
    assert.throws(() => limiteDispensaVigente('2025-06-01', 'outro' as unknown as 'demais'), comCodigo('TIPO_DISPENSA_INVALIDO'));
    assert.throws(() => limiteDispensaVigente('2025-02-30', 'demais'), comCodigo('DATA_INVALIDA'));
  });
});

describe('avaliarFracionamento (art. 75, § 1º)', () => {
  const base = { data: '2025-06-01', tipo: 'demais' as const };

  it('sem risco abaixo de 80% do limite', () => {
    const r = avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [2_000_000, 2_000_000], novaContratacao: 500_000 });
    assert.equal(r.somaComNova, 4_500_000);
    assert.equal(r.limite, 6_272_559);
    assert.equal(r.percentualDoLimite, 71.7);
    assert.equal(r.sinal, 'sem_risco');
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 75, § 1º');
  });

  it('atenção a partir de 80% do limite (borda exata)', () => {
    assert.equal(avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [5_018_047], novaContratacao: 0 }).sinal, 'sem_risco');
    assert.equal(avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [5_018_048], novaContratacao: 0 }).sinal, 'atencao');
  });

  it('igual ao limite ainda é atenção; acima é risco', () => {
    assert.equal(avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [6_000_000], novaContratacao: 272_559 }).sinal, 'atencao');
    const r = avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [6_000_000], novaContratacao: 272_560 });
    assert.equal(r.sinal, 'risco');
    assert.match(r.explicacao, /fracionamento/);
    assert.match(r.explicacao, /decisão é do agente responsável/);
  });

  it('sem contratações anteriores considera só a nova', () => {
    const r = avaliarFracionamento({ ...base, tipo: 'obras_servicos_engenharia', contratacoesMesmaNaturezaNoExercicio: [], novaContratacao: 12_545_116 });
    assert.equal(r.sinal, 'risco');
    assert.equal(r.limite, 12_545_115);
  });

  it('rejeita valores negativos ou não inteiros', () => {
    assert.throws(() => avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [-1], novaContratacao: 0 }), comCodigo('FRACIONAMENTO_INVALIDO'));
    assert.throws(() => avaliarFracionamento({ ...base, contratacoesMesmaNaturezaNoExercicio: [], novaContratacao: 10.5 }), comCodigo('FRACIONAMENTO_INVALIDO'));
  });
});
