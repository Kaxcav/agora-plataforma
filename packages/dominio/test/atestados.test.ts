import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVISO_LEITURA_ASSISTIDA,
  CATALOGO_REGRAS,
  ErroDominio,
  extrairQuantitativosAtestado,
  lerNumeroPtBr,
  numeroPorExtenso,
  reconhecerUnidade,
  somarQuantitativosAtestados,
  type ParcelaLeitura,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const SISTEMA: ParcelaLeitura = { id: 'p-sistema', descricao: 'Desenvolvimento de sistema web transacional integrado via API', unidade: 'pontos de função' };
const COLETES: ParcelaLeitura = { id: 'p-coletes', descricao: 'Colete balístico nível III-A', unidade: 'unidade' };
const SUPORTE: ParcelaLeitura = { id: 'p-suporte', descricao: 'Suporte técnico presencial', unidade: 'horas' };

const pagina = (numero: number, ...linhas: string[]) => ({ numero, linhas });

describe('lerNumeroPtBr e numeroPorExtenso', () => {
  it('lê formatos brasileiros', () => {
    assert.equal(lerNumeroPtBr('1.200'), 1200);
    assert.equal(lerNumeroPtBr('1.200,5'), 1200.5);
    assert.equal(lerNumeroPtBr('925'), 925);
    assert.equal(lerNumeroPtBr('1\u00a0200'), 1200);
    assert.equal(lerNumeroPtBr('abc'), null);
  });

  it('converte números por extenso', () => {
    assert.equal(numeroPorExtenso('novecentos e vinte e cinco'), 925);
    assert.equal(numeroPorExtenso('mil e duzentas'), 1200);
    assert.equal(numeroPorExtenso('um milhão e duzentos mil'), 1_200_000);
    assert.equal(numeroPorExtenso('oitocentos'), 800);
    assert.equal(numeroPorExtenso('conforme anexo'), null);
  });

  it('reconhece unidades comuns, sem confundir com palavras', () => {
    assert.equal(reconhecerUnidade('pontos de função entregues')?.codigo, 'pontos_funcao');
    assert.equal(reconhecerUnidade('PF')?.codigo, 'pontos_funcao');
    assert.equal(reconhecerUnidade('m² de pavimentação')?.codigo, 'metros_quadrados');
    assert.equal(reconhecerUnidade('horas técnicas')?.codigo, 'horas');
    assert.equal(reconhecerUnidade('unidades')?.codigo, 'unidades');
    assert.equal(reconhecerUnidade('testes realizados'), null);
    assert.equal(reconhecerUnidade('meses de vigência')?.codigo, 'meses');
  });
});

describe('extrairQuantitativosAtestado (RIA-08)', () => {
  it('extrai o quantitativo com unidade, página, linha e trecho-fonte, conferindo o valor por extenso', () => {
    const r = extrairQuantitativosAtestado(
      [
        pagina(1, 'ATESTADO DE CAPACIDADE TÉCNICA', 'Atestamos que a empresa executou o desenvolvimento de sistema web transacional,'),
        pagina(2, 'integrado via API RESTful, totalizando 925 (novecentos e vinte e cinco) pontos de função.'),
      ],
      [SISTEMA],
    );
    assert.equal(r.mencoes.length, 1);
    const m = r.mencoes[0];
    assert.ok(m);
    assert.equal(m.quantidade, 925);
    assert.equal(m.quantidadePorExtenso, 925);
    assert.equal(m.unidade, 'pontos de função');
    assert.equal(m.parcelaId, 'p-sistema');
    assert.equal(m.pagina, 2);
    assert.equal(m.linha, 1);
    assert.match(m.trecho, /totalizando 925/);
    assert.equal(m.linhaDeTotal, true);
    assert.equal(m.confianca, 'alta');
    assert.deepEqual(r.porParcela, [{ parcelaId: 'p-sistema', quantidade: 925, criterio: 'total_declarado', mencoes: [0], observacao: null }]);
    assert.equal(r.paginas, 2);
    assert.equal(r.linhas, 3);
  });

  it('reconhece o núcleo da parcela como unidade ("800 coletes") e o milhar com ponto', () => {
    const r = extrairQuantitativosAtestado(
      [pagina(1, 'Fornecimento de 1.200 (mil e duzentos) coletes balísticos nível III-A, entregues em dois lotes.')],
      [COLETES, SISTEMA],
    );
    assert.equal(r.mencoes.length, 1);
    assert.equal(r.mencoes[0]?.quantidade, 1200);
    assert.equal(r.mencoes[0]?.parcelaId, 'p-coletes');
    assert.equal(r.mencoes[0]?.unidade, 'unidades');
    assert.equal(r.porParcela[0]?.quantidade, 1200);
  });

  it('ignora datas, CNPJ, CPF, valores em reais, anos, percentuais e números de item ou lote', () => {
    const r = extrairQuantitativosAtestado(
      [
        pagina(
          1,
          'Contratante: órgão fictício, CNPJ 12.345.678/0001-90, contrato nº 45/2025, de 01/02/2025.',
          'Responsável: CPF 123.456.789-09. Valor global R$ 3.468.000,00, reajuste de 5%.',
          'Item 1 Colete balístico — lote 2 — exercício 2025.',
        ),
      ],
      [COLETES],
    );
    assert.deepEqual(r.mencoes, []);
    assert.deepEqual(r.porParcela, []);
  });

  it('com linha de total, usa o maior total declarado e não soma os módulos', () => {
    const r = extrairQuantitativosAtestado(
      [pagina(1, 'Módulo de cadastro do sistema web: 400 PF;', 'Módulo de integração via API do sistema: 525 PF;', 'Total do sistema: 925 pontos de função.')],
      [SISTEMA],
    );
    assert.equal(r.mencoes.length, 3);
    assert.equal(r.porParcela[0]?.criterio, 'total_declarado');
    assert.equal(r.porParcela[0]?.quantidade, 925);
    assert.deepEqual(r.porParcela[0]?.mencoes, [2]);
  });

  it('sem total, soma as menções distintas e avisa quando há valores repetidos', () => {
    const r = extrairQuantitativosAtestado(
      [pagina(1, 'Sistema web — módulo A: 400 PF.', 'Sistema web — módulo B: 525 PF.', 'Resumo: módulo B do sistema com 525 PF.')],
      [SISTEMA],
    );
    assert.equal(r.porParcela[0]?.criterio, 'soma_mencoes');
    assert.equal(r.porParcela[0]?.quantidade, 925);
    assert.match(r.porParcela[0]?.observacao ?? '', /valores repetidos contados uma vez/);
  });

  it('separa parcelas pela unidade e associa "quantidade executada" pelo contexto', () => {
    const r = extrairQuantitativosAtestado(
      [
        pagina(
          1,
          'Suporte técnico presencial de 2.400 horas ao longo do contrato.',
          'Coletes balísticos — quantidade executada: 350',
          'Sistema web transacional com 600 pontos de função.',
        ),
      ],
      [SISTEMA, COLETES, SUPORTE],
    );
    const porId = new Map(r.porParcela.map((q) => [q.parcelaId, q.quantidade]));
    assert.equal(porId.get('p-suporte'), 2400);
    assert.equal(porId.get('p-coletes'), 350);
    assert.equal(porId.get('p-sistema'), 600);
  });

  it('quantidade no fim da linha, com o extenso e a unidade quebrados na linha seguinte (como sai do OCR)', () => {
    const r = extrairQuantitativosAtestado(
      [pagina(1, 'Atestamos também o desenvolvimento de sistema web transacional com 925 (novecentos e vinte e', 'cinco) pontos de função.')],
      [SISTEMA],
    );
    assert.equal(r.mencoes.length, 1);
    assert.equal(r.mencoes[0]?.quantidade, 925);
    assert.equal(r.mencoes[0]?.quantidadePorExtenso, 925);
    assert.equal(r.mencoes[0]?.linha, 1);
    assert.equal(r.mencoes[0]?.parcelaId, 'p-sistema');
  });

  it('valor por extenso divergente rebaixa a confiança e explica', () => {
    const r = extrairQuantitativosAtestado([pagina(1, 'Sistema web com 325 (novecentos e vinte e cinco) pontos de função.')], [SISTEMA]);
    assert.equal(r.mencoes[0]?.confianca, 'baixa');
    assert.match(r.mencoes[0]?.observacao ?? '', /diverge/);
  });

  it('unidade sem parcela correspondente fica sem associação', () => {
    const r = extrairQuantitativosAtestado([pagina(1, 'Pavimentação de 3.000 m² de pátio.')], [SISTEMA]);
    assert.equal(r.mencoes.length, 1);
    assert.equal(r.mencoes[0]?.parcelaId, null);
    assert.deepEqual(r.porParcela, []);
  });

  it('entrada malformada → TEXTO_INVALIDO / PARCELA_INVALIDA', () => {
    assert.throws(() => extrairQuantitativosAtestado([{ numero: 0, linhas: [] }], [SISTEMA]), comCodigo('TEXTO_INVALIDO'));
    assert.throws(() => extrairQuantitativosAtestado([], [{ id: '', descricao: 'x', unidade: 'y' }]), comCodigo('PARCELA_INVALIDA'));
  });
});

describe('somarQuantitativosAtestados (RIA-08)', () => {
  const parcelas = [{ id: 'p-coletes', descricao: 'Colete balístico nível III-A', unidade: 'unidades', quantidadeMinima: 600 }];
  const atestado = (id: string, linha: string) => ({ id, titulo: `Atestado ${id}`, extracao: extrairQuantitativosAtestado([pagina(1, linha)], [COLETES]) });

  it('soma atestados do mesmo licitante e indica atendimento, com evidências e aviso de revisão humana', () => {
    const r = somarQuantitativosAtestados({
      parcelas,
      atestados: [atestado('a1', 'Fornecimento de 400 (quatrocentos) coletes balísticos.'), atestado('a2', 'Entrega de 350 coletes balísticos nível III-A.')],
    });
    assert.equal(r.sinal, 'indica_atendimento');
    const p = r.parcelas[0];
    assert.ok(p);
    assert.equal(p.somado, 750);
    assert.equal(p.atende, true);
    assert.deepEqual(
      p.contribuicoes.map((c) => [c.atestadoId, c.quantidade, c.evidencias[0]?.pagina, c.evidencias[0]?.linha]),
      [
        ['a1', 400, 1, 1],
        ['a2', 350, 1, 1],
      ],
    );
    assert.equal(r.aviso, AVISO_LEITURA_ASSISTIDA);
    assert.match(r.aviso, /requer revisão humana/);
    assert.match(r.aviso, /decisão do agente de contratação/);
    assert.ok(r.premissas.length >= 3);
  });

  it('abaixo do mínimo → indica_insuficiencia com a falta explicada', () => {
    const r = somarQuantitativosAtestados({ parcelas, atestados: [atestado('a1', 'Fornecimento de 400 coletes balísticos.')] });
    assert.equal(r.sinal, 'indica_insuficiencia');
    assert.equal(r.parcelas[0]?.atende, false);
    assert.match(r.mensagem, /400 de 600 unidades/);
  });

  it('sem atestado lido → inconclusivo (atende null)', () => {
    const r = somarQuantitativosAtestados({ parcelas, atestados: [] });
    assert.equal(r.sinal, 'inconclusivo');
    assert.equal(r.parcelas[0]?.atende, null);
  });
});

describe('catálogo — RIA-08', () => {
  it('RIA-08 é sinal com revisão humana e aponta as funções do domínio', () => {
    const regra = CATALOGO_REGRAS.find((r) => r.id === 'RIA-08');
    assert.ok(regra, 'RIA-08 deve existir no catálogo');
    assert.equal(regra.tipo, 'RIA');
    assert.equal(regra.etapa, 6);
    assert.ok(regra.implementacao.includes('extrairQuantitativosAtestado'));
    assert.ok(regra.implementacao.includes('somarQuantitativosAtestados'));
    assert.match(regra.descricao, /revisão humana/);
    assert.match(regra.fundamento, /art\. 67/);
  });
});
