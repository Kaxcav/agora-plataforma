import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  INFRACOES_ART_155,
  PARAMETROS_DOSIMETRIA_PADRAO,
  calcularDosimetriaMulta,
  prazoDefesa,
  prazoRegistroCeisCnep,
  sancoesCabiveis,
  vigenciaSancao,
  type IncisoInfracao,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const AVISO = 'Proposta de dosimetria para apoio à decisão. A sanção é aplicada pela autoridade competente após processo com contraditório e ampla defesa (arts. 157 e 158).';

describe('INFRACOES_ART_155', () => {
  it('lista os 12 incisos em ordem', () => {
    assert.deepEqual(
      INFRACOES_ART_155.map((i) => i.inciso),
      ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
    );
    assert.equal(INFRACOES_ART_155[0]?.descricao, 'Dar causa à inexecução parcial do contrato');
    assert.match(INFRACOES_ART_155[11]?.descricao ?? '', /Lei 12\.846\/2013/);
  });
});

describe('sancoesCabiveis (art. 156)', () => {
  const tipos = (inciso: IncisoInfracao) => sancoesCabiveis(inciso).map((s) => s.tipo);

  it('inciso I: advertência e multa', () => {
    assert.deepEqual(tipos('I'), ['advertencia', 'multa']);
    assert.equal(sancoesCabiveis('I')[0]?.fundamento, 'Lei 14.133/2021, art. 156, § 2º');
  });

  it('incisos II a VII: multa, impedimento e inidoneidade quando se justificar sanção mais grave', () => {
    for (const inciso of ['II', 'III', 'IV', 'V', 'VI', 'VII'] as const) {
      assert.deepEqual(tipos(inciso), ['multa', 'impedimento_licitar', 'declaracao_inidoneidade'], inciso);
    }
    const ii = sancoesCabiveis('II');
    assert.equal(ii.find((s) => s.tipo === 'impedimento_licitar')?.fundamento, 'Lei 14.133/2021, art. 156, § 4º');
    assert.match(ii.find((s) => s.tipo === 'declaracao_inidoneidade')?.condicao ?? '', /mais grave/);
  });

  it('incisos VIII a XII: multa e inidoneidade', () => {
    for (const inciso of ['VIII', 'IX', 'X', 'XI', 'XII'] as const) {
      assert.deepEqual(tipos(inciso), ['multa', 'declaracao_inidoneidade'], inciso);
    }
    assert.equal(sancoesCabiveis('IX')[1]?.fundamento, 'Lei 14.133/2021, art. 156, § 5º');
  });

  it('multa cabe em qualquer inciso com fundamento no § 3º', () => {
    for (const { inciso } of INFRACOES_ART_155) {
      assert.equal(sancoesCabiveis(inciso).find((s) => s.tipo === 'multa')?.fundamento, 'Lei 14.133/2021, art. 156, § 3º');
    }
  });

  it('rejeita inciso inexistente', () => {
    assert.throws(() => sancoesCabiveis('XIII' as unknown as IncisoInfracao), comCodigo('INCISO_INVALIDO'));
  });
});

describe('calcularDosimetriaMulta', () => {
  const base = { valorContrato: 1_000_000, agravantes: [] as string[], atenuantes: [] as string[], programaIntegridade: false, danoAdministracao: false };

  it('aplica a fórmula da proposta de dosimetria', () => {
    const r = calcularDosimetriaMulta({ ...base, gravidade: 'grave', agravantes: ['reincidência'], programaIntegridade: true, danoAdministracao: true });
    assert.equal(r.percentualCalculado, 13);
    assert.equal(r.percentualAplicado, 13);
    assert.equal(r.valorMulta, 130_000);
    assert.equal(r.limitado, null);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 156, §§ 1º e 3º');
    assert.equal(r.aviso, AVISO);
  });

  it('eleva ao mínimo legal de 0,5%', () => {
    const r = calcularDosimetriaMulta({ ...base, gravidade: 'leve', atenuantes: ['confissão', 'reparação do dano'] });
    assert.equal(r.percentualCalculado, -1);
    assert.equal(r.percentualAplicado, 0.5);
    assert.equal(r.limitado, 'minimo');
    assert.equal(r.valorMulta, 5_000);
  });

  it('reduz ao máximo legal de 30%', () => {
    const r = calcularDosimetriaMulta({ ...base, gravidade: 'gravissima', agravantes: ['a', 'b', 'c', 'd', 'e'], danoAdministracao: true });
    assert.equal(r.percentualCalculado, 33);
    assert.equal(r.percentualAplicado, 30);
    assert.equal(r.limitado, 'maximo');
    assert.equal(r.valorMulta, 300_000);
  });

  it('exatamente nas bordas 30% e 0,5% não é limitado', () => {
    assert.equal(calcularDosimetriaMulta({ ...base, gravidade: 'gravissima', agravantes: ['a', 'b', 'c', 'd', 'e'] }).limitado, null);
    const parametros = { ...PARAMETROS_DOSIMETRIA_PADRAO, base: { leve: 0.5, media: 5, grave: 10, gravissima: 20 } };
    const r = calcularDosimetriaMulta({ ...base, gravidade: 'leve', parametros });
    assert.equal(r.limitado, null);
    assert.equal(r.percentualAplicado, 0.5);
  });

  it('memória de cálculo cita as considerações do art. 156, § 1º e lista as circunstâncias', () => {
    const r = calcularDosimetriaMulta({ ...base, gravidade: 'media', agravantes: ['reincidência'], atenuantes: ['colaboração'] });
    assert.match(r.memoriaCalculo[0] ?? '', /art\. 156, § 1º/);
    assert.ok(r.memoriaCalculo.some((l) => l.includes('reincidência')));
    assert.ok(r.memoriaCalculo.some((l) => l.includes('colaboração')));
    assert.ok(r.memoriaCalculo.some((l) => l.includes('R$ 600,00')));
    assert.equal(r.percentualCalculado, 6);
  });

  it('aceita parâmetros próprios do órgão', () => {
    const r = calcularDosimetriaMulta({
      ...base,
      gravidade: 'media',
      agravantes: ['x'],
      parametros: { base: { leve: 2, media: 4, grave: 8, gravissima: 16 }, porAgravante: 1.5, porAtenuante: 1, programaIntegridade: 1, danoAdministracao: 2 },
    });
    assert.equal(r.percentualCalculado, 5.5);
    assert.equal(r.valorMulta, 55_000);
  });

  it('parâmetros padrão são imutáveis', () => {
    assert.ok(Object.isFrozen(PARAMETROS_DOSIMETRIA_PADRAO));
    assert.ok(Object.isFrozen(PARAMETROS_DOSIMETRIA_PADRAO.base));
  });

  it('rejeita entradas inválidas', () => {
    assert.throws(() => calcularDosimetriaMulta({ ...base, valorContrato: 0, gravidade: 'leve' }), comCodigo('DOSIMETRIA_INVALIDA'));
    assert.throws(() => calcularDosimetriaMulta({ ...base, gravidade: 'extrema' as unknown as 'leve' }), comCodigo('DOSIMETRIA_INVALIDA'));
  });
});

describe('prazoDefesa e prazoRegistroCeisCnep', () => {
  it('defesa: 15 dias úteis da intimação (arts. 157 e 158)', () => {
    assert.deepEqual(prazoDefesa('2026-11-09'), { vencimento: '2026-12-01', fundamento: 'Lei 14.133/2021, arts. 157 e 158' });
  });

  it('registro no CEIS/CNEP: 15 dias úteis da aplicação (art. 161)', () => {
    assert.deepEqual(prazoRegistroCeisCnep('2026-11-09'), { vencimento: '2026-12-01', fundamento: 'Lei 14.133/2021, art. 161' });
  });

  it('considera feriados do órgão', () => {
    assert.equal(prazoDefesa('2026-11-09', { feriadosExtras: ['2026-11-10'] }).vencimento, '2026-12-02');
  });
});

describe('vigenciaSancao', () => {
  it('impedimento de 1 a 3 anos (art. 156, § 4º)', () => {
    assert.deepEqual(vigenciaSancao('impedimento_licitar', '2026-11-08', 3), { fim: '2029-11-08', fundamento: 'Lei 14.133/2021, art. 156, § 4º' });
    assert.equal(vigenciaSancao('impedimento_licitar', '2026-11-08', 1).fim, '2027-11-08');
  });

  it('inidoneidade de 3 a 6 anos (art. 156, § 5º)', () => {
    assert.deepEqual(vigenciaSancao('declaracao_inidoneidade', '2026-11-08', 6), { fim: '2032-11-08', fundamento: 'Lei 14.133/2021, art. 156, § 5º' });
  });

  it('início em 29/02 sem correspondência termina no dia imediato', () => {
    assert.equal(vigenciaSancao('declaracao_inidoneidade', '2024-02-29', 3).fim, '2027-03-01');
    assert.equal(vigenciaSancao('declaracao_inidoneidade', '2024-02-29', 4).fim, '2028-02-29');
  });

  it('fora da faixa legal → PRAZO_SANCAO_INVALIDO', () => {
    assert.throws(() => vigenciaSancao('impedimento_licitar', '2026-11-08', 4), comCodigo('PRAZO_SANCAO_INVALIDO'));
    assert.throws(() => vigenciaSancao('impedimento_licitar', '2026-11-08', 0), comCodigo('PRAZO_SANCAO_INVALIDO'));
    assert.throws(() => vigenciaSancao('declaracao_inidoneidade', '2026-11-08', 2), comCodigo('PRAZO_SANCAO_INVALIDO'));
    assert.throws(() => vigenciaSancao('declaracao_inidoneidade', '2026-11-08', 7), comCodigo('PRAZO_SANCAO_INVALIDO'));
    assert.throws(() => vigenciaSancao('impedimento_licitar', '2026-11-08', 1.5), comCodigo('PRAZO_SANCAO_INVALIDO'));
  });
});
