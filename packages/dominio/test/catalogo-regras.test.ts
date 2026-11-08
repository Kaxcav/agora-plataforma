import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as dominio from '../src/index.ts';
import { CATALOGO_REGRAS, ErroDominio, regrasPorEtapa, regrasPorTela, type RegraCatalogo } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const porId = new Map(CATALOGO_REGRAS.map((r) => [r.id, r]));
const regra = (id: string): RegraCatalogo => {
  const r = porId.get(id);
  assert.ok(r, `regra ${id} ausente`);
  return r;
};
const sequencia = (prefixo: string, ate: number) => Array.from({ length: ate }, (_, i) => `${prefixo}-${String(i + 1).padStart(2, '0')}`);

describe('CATALOGO_REGRAS — estrutura', () => {
  it('ids únicos e catálogo imutável', () => {
    assert.equal(porId.size, CATALOGO_REGRAS.length);
    assert.ok(Object.isFrozen(CATALOGO_REGRAS));
  });

  it('contém RN-01…RN-18, RIA-01…RIA-07, RNF-01…RNF-06 e RF-01…RF-11', () => {
    for (const id of [...sequencia('RN', 18), ...sequencia('RIA', 7), ...sequencia('RNF', 6), ...sequencia('RF', 11)]) regra(id);
  });

  it('todo item tem tipo coerente com o id e campos completos em pt-BR', () => {
    for (const r of CATALOGO_REGRAS) {
      assert.equal(r.id.split('-')[0], r.tipo, r.id);
      assert.ok(r.titulo.length >= 5, `${r.id} titulo`);
      assert.ok(r.descricao.length >= 100, `${r.id} descricao curta`);
      assert.ok(r.descricao.trim().endsWith('.'), `${r.id} descricao sem ponto final`);
      assert.ok(r.fundamento.length >= 5, `${r.id} fundamento`);
      assert.ok(r.implementacao.length >= 5, `${r.id} implementacao`);
      assert.ok(r.etapa === null || (Number.isInteger(r.etapa) && r.etapa >= 1 && r.etapa <= 7), `${r.id} etapa`);
      assert.ok(Array.isArray(r.telas), `${r.id} telas`);
    }
  });

  it('símbolos do domínio citados em implementacao existem como funções exportadas', () => {
    const exportados: Record<string, unknown> = { ...dominio };
    const citados = new Set<string>();
    for (const r of CATALOGO_REGRAS) {
      for (const m of r.implementacao.matchAll(/(?<![:\w/])[a-z]+[A-Z][A-Za-z]*\b/g)) citados.add(m[0]);
    }
    assert.ok(citados.size >= 20);
    for (const nome of citados) assert.equal(typeof exportados[nome], 'function', nome);
  });
});

describe('CATALOGO_REGRAS — conteúdo mínimo da especificação', () => {
  const casos: [string, number | null, string[], string, RegExp][] = [
    ['RN-01', 1, ['jornada.dfd'], 'sinalizarArtigoLuxo', /art\. 20/],
    ['RN-02', 1, [], '', /art\. 19, § 2º/],
    ['RN-03', 2, ['jornada.equipe'], 'verificarSegregacao', /art\. 7º, § 1º/],
    ['RN-04', 3, [], 'validarEtp', /art\. 18, §§ 1º e 2º/],
    ['RN-05', 3, [], 'analisarCestaPrecos', /art\. 23, § 1º/],
    ['RN-06', 4, [], '', /art\. 69/],
    ['RN-07', 5, [], '', /art\. 25, § 3º/],
    ['RN-08', 6, [], 'aplicarDesempate', /art\. 60/],
    ['RN-09', 7, [], '', /art\. 91, § 4º/],
    ['RN-10', 7, ['contratos.detalhe'], 'avaliarAditivo', /art\. 125/],
    ['RN-11', 7, ['contratos.detalhe', 'painel'], 'situacaoDivulgacaoPncp', /art\. 94/],
    ['RN-12', 7, ['sancoes'], 'calcularDosimetriaMulta', /art\. 156, §§ 1º e 3º/],
    ['RN-13', null, [], 'prazoDefesa', /arts\. 157, 158 e 161/],
    ['RN-14', 1, [], 'avaliarFracionamento', /art\. 75, I e II, e § 1º/],
    ['RN-15', 5, [], 'dataMinimaAberturaPropostas', /art\. 55/],
    ['RN-16', null, [], 'contarPrazo', /art\. 183/],
    ['RN-17', null, ['painel', 'contratos', 'atas'], 'classificarVigencia', /art\. 84/],
    ['RN-18', null, ['pagamentos'], '', /art\. 141/],
    ['RIA-01', 1, [], 'avaliarFracionamento', /art\. 75, § 1º/],
    ['RIA-02', 2, [], '', /art\. 12, VI/],
    ['RIA-03', 3, [], 'analisarCestaPrecos', /IN SEGES\/ME 65\/2021/],
    ['RIA-04', 4, [], '', /art\. 6º, XXIII/],
    ['RIA-05', 5, [], '', /art\. 13/],
    ['RIA-06', 6, [], 'verificarSegregacao', /art\. 9º, § 1º/],
    ['RIA-07', 7, [], 'projetarQueimaSaldo', /art\. 117/],
    ['RNF-02', null, [], '', /arts\. 6º, 37 e 46/],
    ['RNF-03', null, [], '', /arts\. 169 a 171/],
    ['RNF-04', null, [], '', /WCAG 2\.1/],
  ];

  for (const [id, etapa, telas, implementacao, fundamento] of casos) {
    it(`${id}: etapa ${String(etapa)}, fundamento ${fundamento.source}`, () => {
      const r = regra(id);
      assert.equal(r.etapa, etapa);
      for (const tela of telas) assert.ok(r.telas.includes(tela), `${id} sem tela ${tela}`);
      if (implementacao !== '') assert.ok(r.implementacao.includes(implementacao), `${id} implementacao`);
      assert.match(r.fundamento, fundamento);
    });
  }

  it('RIA-02 é descrito como requisito de integração planejada', () => {
    assert.match(regra('RIA-02').descricao, /integração planejada/);
  });

  it('RNF-06 afirma que IA não decide sanção, habilitação ou fraude', () => {
    assert.match(regra('RNF-06').descricao, /Sanção, habilitação, fraude/);
    assert.match(regra('RNF-06').descricao, /decisão humana/);
  });

  it('um RF por tela de operação', () => {
    const telas = ['painel', 'atas', 'contratos', 'itens', 'empenhos', 'pagamentos', 'vinculos', 'ajustes', 'admin', 'auditoria', 'transparencia'];
    telas.forEach((tela, i) => {
      const rfs = CATALOGO_REGRAS.filter((r) => r.tipo === 'RF' && r.telas.includes(tela));
      assert.equal(rfs.length, 1, tela);
      assert.equal(rfs[0]?.id, `RF-${String(i + 1).padStart(2, '0')}`, tela);
    });
  });
});

describe('regrasPorTela', () => {
  it('lista as regras da tela por correspondência exata', () => {
    const ids = regrasPorTela('jornada.dfd').map((r) => r.id);
    for (const id of ['RN-01', 'RN-02', 'RN-14', 'RIA-01']) assert.ok(ids.includes(id), id);
    assert.deepEqual(regrasPorTela('sancoes').map((r) => r.id).sort(), ['RF-14', 'RN-12', 'RN-13', 'RN-19']);
    assert.ok(regrasPorTela('contratos.detalhe').some((r) => r.id === 'RN-10'));
  });

  it('tela desconhecida → lista vazia; id vazio → TELA_INVALIDA', () => {
    assert.deepEqual(regrasPorTela('inexistente'), []);
    assert.throws(() => regrasPorTela(''), comCodigo('TELA_INVALIDA'));
  });

  it('devolve cópia: alterar o resultado não altera o catálogo', () => {
    const lista = regrasPorTela('painel');
    lista.length = 0;
    assert.ok(regrasPorTela('painel').length > 0);
  });
});

describe('regrasPorEtapa', () => {
  it('toda etapa de 1 a 7 tem ao menos uma RN e uma RIA', () => {
    for (let etapa = 1; etapa <= 7; etapa += 1) {
      const tipos = new Set(regrasPorEtapa(etapa).map((r) => r.tipo));
      assert.ok(tipos.has('RN'), `etapa ${etapa} sem RN`);
      assert.ok(tipos.has('RIA'), `etapa ${etapa} sem RIA`);
    }
  });

  it('etapa 7 inclui as regras de contrato', () => {
    const ids = regrasPorEtapa(7).map((r) => r.id);
    for (const id of ['RN-09', 'RN-10', 'RN-11', 'RN-12', 'RIA-07']) assert.ok(ids.includes(id), id);
  });

  it('rejeita etapa fora de 1 a 7', () => {
    for (const etapa of [0, 8, 1.5, Number.NaN]) assert.throws(() => regrasPorEtapa(etapa), comCodigo('ETAPA_INVALIDA'), String(etapa));
  });
});

describe('CATALOGO_REGRAS — sala de disputa (RF-22, RN-26 e RIA-09)', () => {
  it('as três regras ficam na etapa 6 e na tela da sala', () => {
    for (const id of ['RF-22', 'RN-26', 'RIA-09']) {
      const r = regra(id);
      assert.equal(r.etapa, 6, id);
      assert.ok(r.telas.includes('jornada.disputa'), id);
    }
    assert.deepEqual(regrasPorTela('jornada.disputa').map((r) => r.id).sort(), ['RF-22', 'RIA-09', 'RN-26']);
  });

  it('RN-26 cita os arts. 56, 57 e 61 e a IN SEGES/ME 73/2022; RIA-09 só sinaliza', () => {
    assert.match(regra('RN-26').fundamento, /56, 57, 59, 60 e 61/);
    assert.match(regra('RN-26').fundamento, /IN SEGES\/ME 73\/2022/);
    assert.ok(regra('RN-26').implementacao.includes('calcularEstadoSessao'));
    assert.match(regra('RIA-09').descricao, /requer revisão humana/);
    assert.match(regra('RIA-09').descricao, /não desclassifica/);
    assert.ok(regra('RIA-09').implementacao.includes('detectarPadroesLances'));
    assert.ok(regra('RF-22').implementacao.includes('redigirAtaSessaoDisputa'));
  });
});
