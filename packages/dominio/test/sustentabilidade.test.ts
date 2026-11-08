import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarBloqueioLuxoMinutas, ErroDominio, verificarSustentabilidade } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const AMBIENTAIS = 'Equipamentos com selo de eficiência energética e embalagens recicláveis, sem substâncias perigosas.';
const REVERSA = 'Recolhimento pelo fornecedor dos bens substituídos e dos refugos, com destinação ambientalmente adequada.';

describe('verificarSustentabilidade (RN-21)', () => {
  it('política ligada e critérios ausentes: duas pendências que impedem concluir o ETP', () => {
    const r = verificarSustentabilidade({ politicaAtiva: true, criterios: { criteriosAmbientais: null, logisticaReversa: '  ' }, documento: 'etp' });
    assert.equal(r.exigida, true);
    assert.equal(r.completa, false);
    assert.deepEqual(
      r.pendencias.map((p) => p.campo),
      ['criteriosAmbientais', 'logisticaReversa'],
    );
    assert.match(r.pendencias[0]?.mensagem ?? '', /Estudo Técnico Preliminar/);
    assert.match(r.fundamento, /art\. 18, § 1º, XII/);
  });

  it('política ligada e critérios preenchidos: completa, sem pendências (TR)', () => {
    const r = verificarSustentabilidade({ politicaAtiva: true, criterios: { criteriosAmbientais: AMBIENTAIS, logisticaReversa: REVERSA }, documento: 'tr' });
    assert.equal(r.completa, true);
    assert.deepEqual(r.pendencias, []);
    assert.match(r.orientacao, /ligada/);
  });

  it('política desligada: critérios recomendados, sem bloquear', () => {
    const r = verificarSustentabilidade({ politicaAtiva: false, criterios: { criteriosAmbientais: null, logisticaReversa: null }, documento: 'tr' });
    assert.equal(r.exigida, false);
    assert.equal(r.completa, false);
    assert.deepEqual(r.pendencias, []);
    assert.match(r.orientacao, /desligada/);
  });

  it('texto abaixo do mínimo conta como não preenchido', () => {
    const r = verificarSustentabilidade({ politicaAtiva: true, criterios: { criteriosAmbientais: 'curto', logisticaReversa: REVERSA }, documento: 'etp' }, 30);
    assert.deepEqual(
      r.pendencias.map((p) => p.campo),
      ['criteriosAmbientais'],
    );
  });

  it('documento desconhecido → DOCUMENTO_INVALIDO', () => {
    assert.throws(
      () => verificarSustentabilidade({ politicaAtiva: true, criterios: { criteriosAmbientais: null, logisticaReversa: null }, documento: 'edital' as never }),
      comCodigo('DOCUMENTO_INVALIDO'),
    );
  });
});

describe('avaliarBloqueioLuxoMinutas (PoC-01, art. 20)', () => {
  const itens = [{ descricao: 'Luva tática de couro bovino' }, { descricao: 'Relógio de parede banhado a ouro' }];

  it('item com indício e sem justificativa: bloqueia a geração de minutas e aponta o item', () => {
    const r = avaliarBloqueioLuxoMinutas(itens, null);
    assert.equal(r.bloqueado, true);
    assert.deepEqual(r.itens, [{ item: 2, termos: ['ouro', 'banhado a ouro'] }]);
    assert.match(r.mensagem, /^Geração de minutas bloqueada/);
    assert.match(r.mensagem, /item 2/);
    assert.match(r.fundamento, /art\. 20/);
  });

  it('justificativa curta não é aceita; com o mínimo, a geração é liberada', () => {
    assert.equal(avaliarBloqueioLuxoMinutas(itens, 'é comum').bloqueado, true);
    const liberado = avaliarBloqueioLuxoMinutas(itens, 'Relógio comum de uso institucional, sem valor superior ao de mercado para a finalidade.');
    assert.equal(liberado.bloqueado, false);
    assert.match(liberado.mensagem, /liberada/);
  });

  it('sem indício: não bloqueia; removido o item, também não', () => {
    assert.equal(avaliarBloqueioLuxoMinutas([itens[0] ?? { descricao: '' }], null).bloqueado, false);
    assert.equal(avaliarBloqueioLuxoMinutas([], null).bloqueado, false);
  });

  it('lista inválida → ITENS_INVALIDOS', () => {
    assert.throws(() => avaliarBloqueioLuxoMinutas(null as never, null), comCodigo('ITENS_INVALIDOS'));
  });
});
