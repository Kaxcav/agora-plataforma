import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  dataMinimaAberturaPropostas,
  prazoAvisoDispensaEletronica,
  prazoDivulgacaoContratoPncp,
  prazoMinimoPropostas,
  situacaoDivulgacaoPncp,
  type CriterioJulgamento,
  type ObjetoLicitacao,
  type RegimeExecucao,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('prazoMinimoPropostas (art. 55)', () => {
  const casos: [ObjetoLicitacao, CriterioJulgamento, RegimeExecucao | undefined, number, string][] = [
    ['bens', 'menor_preco', undefined, 8, 'I, a'],
    ['bens', 'maior_desconto', undefined, 8, 'I, a'],
    ['bens', 'maior_retorno_economico', undefined, 15, 'I, b'],
    ['bens', 'tecnica_preco', undefined, 35, 'IV'],
    ['bens', 'maior_lance', undefined, 15, 'III'],
    ['servicos_comuns', 'menor_preco', undefined, 10, 'II, a'],
    ['obras_servicos_engenharia_comuns', 'maior_desconto', 'outro', 10, 'II, a'],
    ['servicos_especiais', 'menor_preco', undefined, 25, 'II, b'],
    ['obras_servicos_engenharia_especiais', 'maior_desconto', undefined, 25, 'II, b'],
    ['obras_servicos_engenharia_comuns', 'menor_preco', 'integrada', 60, 'II, c'],
    ['obras_servicos_engenharia_especiais', 'tecnica_preco', 'integrada', 60, 'II, c'],
    ['obras_servicos_engenharia_comuns', 'menor_preco', 'semi_integrada', 35, 'II, d'],
    ['servicos_comuns', 'maior_retorno_economico', undefined, 35, 'II, d'],
    ['servicos_especiais', 'melhor_tecnica', undefined, 35, 'IV'],
    ['servicos_comuns', 'maior_lance', undefined, 15, 'III'],
  ];

  for (const [objeto, criterio, regime, dias, alinea] of casos) {
    it(`${objeto} + ${criterio}${regime ? ` + ${regime}` : ''} → ${dias} dias úteis (art. 55, ${alinea})`, () => {
      const r = prazoMinimoPropostas(regime === undefined ? { objeto, criterio } : { objeto, criterio, regime });
      assert.deepEqual(r, { diasUteis: dias, fundamento: `Lei 14.133/2021, art. 55, ${alinea}` });
    });
  }

  it('rejeita parâmetros inválidos', () => {
    assert.throws(() => prazoMinimoPropostas({ objeto: 'imoveis' as unknown as ObjetoLicitacao, criterio: 'menor_preco' }), comCodigo('PRAZO_INVALIDO'));
    assert.throws(() => prazoMinimoPropostas({ objeto: 'bens', criterio: 'sorteio' as unknown as CriterioJulgamento }), comCodigo('PRAZO_INVALIDO'));
    assert.throws(
      () => prazoMinimoPropostas({ objeto: 'bens', criterio: 'menor_preco', regime: 'empreitada' as unknown as RegimeExecucao }),
      comCodigo('PRAZO_INVALIDO'),
    );
  });
});

describe('dataMinimaAberturaPropostas', () => {
  it('bens por menor preço: 8 dias úteis após a divulgação', () => {
    assert.deepEqual(dataMinimaAberturaPropostas('2026-11-09', { objeto: 'bens', criterio: 'menor_preco' }), {
      data: '2026-11-19',
      diasUteis: 8,
      fundamento: 'Lei 14.133/2021, art. 55, I, a, c/c art. 183',
    });
  });

  it('pula o feriado de 20 de novembro', () => {
    assert.equal(dataMinimaAberturaPropostas('2026-11-09', { objeto: 'servicos_comuns', criterio: 'menor_preco' }).data, '2026-11-24');
  });
});

describe('prazoAvisoDispensaEletronica (art. 75, § 3º)', () => {
  it('3 dias úteis', () => {
    assert.deepEqual(prazoAvisoDispensaEletronica('2026-11-18'), { data: '2026-11-24', fundamento: 'Lei 14.133/2021, art. 75, § 3º' });
    assert.equal(prazoAvisoDispensaEletronica('2026-11-09').data, '2026-11-12');
  });
});

describe('prazoDivulgacaoContratoPncp (art. 94)', () => {
  it('contratação direta: 10 dias úteis', () => {
    assert.deepEqual(prazoDivulgacaoContratoPncp('2026-11-03', 'contratacao_direta'), {
      limite: '2026-11-17',
      diasUteis: 10,
      fundamento: 'Lei 14.133/2021, art. 94, II',
    });
  });

  it('licitação: 20 dias úteis', () => {
    assert.deepEqual(prazoDivulgacaoContratoPncp('2026-11-03', 'licitacao'), {
      limite: '2026-12-02',
      diasUteis: 20,
      fundamento: 'Lei 14.133/2021, art. 94, I',
    });
  });

  it('rejeita origem inválida', () => {
    assert.throws(() => prazoDivulgacaoContratoPncp('2026-11-03', 'adesao' as unknown as 'licitacao'), comCodigo('PRAZO_INVALIDO'));
  });
});

describe('situacaoDivulgacaoPncp', () => {
  const ASSINATURA = '2026-11-03';

  it('divulgado até o limite → divulgado_no_prazo', () => {
    const r = situacaoDivulgacaoPncp(ASSINATURA, 'contratacao_direta', '2026-11-17', '2026-11-30');
    assert.equal(r.situacao, 'divulgado_no_prazo');
    assert.equal(r.limite, '2026-11-17');
    assert.match(r.explicacao, /eficácia do contrato/);
  });

  it('divulgado após o limite → divulgado_fora_do_prazo', () => {
    const r = situacaoDivulgacaoPncp(ASSINATURA, 'contratacao_direta', '2026-11-18', '2026-11-30');
    assert.equal(r.situacao, 'divulgado_fora_do_prazo');
    assert.match(r.explicacao, /1 dia útil após/);
  });

  it('pendente dentro do prazo, inclusive no dia do limite', () => {
    const r = situacaoDivulgacaoPncp(ASSINATURA, 'contratacao_direta', null, '2026-11-08');
    assert.equal(r.situacao, 'pendente_no_prazo');
    assert.match(r.explicacao, /Restam 7 dias úteis/);
    const hoje = situacaoDivulgacaoPncp(ASSINATURA, 'contratacao_direta', null, '2026-11-17');
    assert.equal(hoje.situacao, 'pendente_no_prazo');
    assert.match(hoje.explicacao, /vence hoje/);
  });

  it('pendente após o limite → pendente_vencido', () => {
    const r = situacaoDivulgacaoPncp(ASSINATURA, 'contratacao_direta', null, '2026-11-18');
    assert.equal(r.situacao, 'pendente_vencido');
    assert.match(r.explicacao, /não produz efeitos/);
  });

  it('rejeita divulgação anterior à assinatura', () => {
    assert.throws(() => situacaoDivulgacaoPncp(ASSINATURA, 'licitacao', '2026-11-02', '2026-11-08'), comCodigo('DATA_INVALIDA'));
  });
});
