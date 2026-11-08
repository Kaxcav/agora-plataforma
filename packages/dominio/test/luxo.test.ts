import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, TERMOS_INDICATIVOS_LUXO, sinalizarArtigoLuxo } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('TERMOS_INDICATIVOS_LUXO', () => {
  it('contém os termos da especificação e é imutável', () => {
    for (const termo of [
      'luxo', 'premium', 'gourmet', 'grife', 'cristal', 'ouro', 'banhado a ouro', 'seda pura', 'couro legítimo',
      'champanhe', 'caviar', 'importado de luxo', 'edição limitada', 'alto padrão', 'design exclusivo',
    ]) {
      assert.ok(TERMOS_INDICATIVOS_LUXO.includes(termo), termo);
    }
    assert.ok(Object.isFrozen(TERMOS_INDICATIVOS_LUXO));
  });
});

describe('sinalizarArtigoLuxo (art. 20)', () => {
  it('descrição comum não tem indício', () => {
    const r = sinalizarArtigoLuxo('Caneta esferográfica azul, corpo plástico');
    assert.equal(r.sinal, 'sem_indicio');
    assert.deepEqual(r.termosEncontrados, []);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 20; Decreto 10.818/2021');
  });

  it('ignora caixa e acentos', () => {
    assert.deepEqual(sinalizarArtigoLuxo('Cafeteira PREMIUM em aço').termosEncontrados, ['premium']);
    assert.deepEqual(sinalizarArtigoLuxo('Bolsa de COURO LEGITIMO').termosEncontrados, ['couro legítimo']);
    assert.deepEqual(sinalizarArtigoLuxo('Agenda edicao limitada').termosEncontrados, ['edição limitada']);
    assert.deepEqual(sinalizarArtigoLuxo('Apartamento de alto padrao').termosEncontrados, ['alto padrão']);
  });

  it('compara por palavra ou expressão inteira', () => {
    assert.equal(sinalizarArtigoLuxo('Copo de vidro cristalino').sinal, 'sem_indicio');
    assert.equal(sinalizarArtigoLuxo('Kit de ferramentas Ourofino').sinal, 'sem_indicio');
    assert.equal(sinalizarArtigoLuxo('Lâmpada luxômetro').sinal, 'sem_indicio');
    assert.deepEqual(sinalizarArtigoLuxo('Taça de cristal').termosEncontrados, ['cristal']);
  });

  it('pontuação não impede a correspondência e várias expressões são listadas na ordem dos termos', () => {
    const r = sinalizarArtigoLuxo('Relógio banhado a ouro; kit gourmet, champanhe.');
    assert.equal(r.sinal, 'possivel_artigo_luxo');
    assert.deepEqual(r.termosEncontrados, ['gourmet', 'ouro', 'banhado a ouro', 'champanhe']);
    assert.match(r.orientacao, /qualidade comum/);
    assert.match(r.orientacao, /Decreto 10\.818\/2021/);
  });

  it('aceita lista de termos própria', () => {
    assert.deepEqual(sinalizarArtigoLuxo('Cadeira executiva com massageador', ['massageador', 'executiva']).termosEncontrados, ['massageador', 'executiva']);
  });

  it('descrição vazia não tem indício; não texto é rejeitado', () => {
    assert.equal(sinalizarArtigoLuxo('').sinal, 'sem_indicio');
    assert.throws(() => sinalizarArtigoLuxo(42 as unknown as string), comCodigo('DESCRICAO_INVALIDA'));
  });
});
