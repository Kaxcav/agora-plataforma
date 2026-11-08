import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  POLITICA_PADRAO_FILA,
  TIPOS_DOCUMENTO_PNCP,
  chaveIdempotencia,
  classificarRespostaHttp,
  codigosContratacaoPncp,
  decidirDestinoFalha,
  esperaNovaTentativa,
  interpretarLocalizacaoPncp,
  numeroControlePncp,
  tituloDocumentoPncp,
  validarPoliticaNovasTentativas,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const politica = { maximoTentativas: 4, esperaBaseMs: 1_000, esperaMaximaMs: 5_000 };
const CNPJ = '11222333000181';

describe('esperaNovaTentativa (RNF-07)', () => {
  it('dobra a cada falha a partir da espera base e respeita o teto', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((t) => esperaNovaTentativa(t, politica)), [1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('política padrão: 30 s, 1 min, 2 min… até 1 h, cobrindo cerca de 3 horas em 10 execuções', () => {
    const esperas = Array.from({ length: POLITICA_PADRAO_FILA.maximoTentativas - 1 }, (_, i) => esperaNovaTentativa(i + 1, POLITICA_PADRAO_FILA));
    assert.equal(esperas[0], 30_000);
    assert.equal(esperas.at(-1), 3_600_000);
    const total = esperas.reduce((s, e) => s + e, 0);
    assert.ok(total > 2.5 * 3_600_000 && total < 3.5 * 3_600_000, `total ${total}`);
  });

  it('recusa tentativa e política inválidas', () => {
    assert.throws(() => esperaNovaTentativa(0, politica), comCodigo('TENTATIVA_INVALIDA'));
    assert.throws(() => esperaNovaTentativa(1.5, politica), comCodigo('TENTATIVA_INVALIDA'));
    assert.throws(() => validarPoliticaNovasTentativas({ ...politica, maximoTentativas: 0 }), comCodigo('POLITICA_FILA_INVALIDA'));
    assert.throws(() => validarPoliticaNovasTentativas({ ...politica, esperaMaximaMs: 10 }), comCodigo('POLITICA_FILA_INVALIDA'));
    assert.throws(() => validarPoliticaNovasTentativas({ ...politica, esperaBaseMs: -1 }), comCodigo('POLITICA_FILA_INVALIDA'));
  });
});

describe('decidirDestinoFalha (RNF-07)', () => {
  it('falha transitória abaixo do limite → nova tentativa com a espera exponencial', () => {
    const d = decidirDestinoFalha({ tentativasRealizadas: 2, retentavel: true, politica });
    assert.equal(d.destino, 'nova_tentativa');
    assert.ok(d.destino === 'nova_tentativa' && d.esperaMs === 2_000 && d.proximaTentativa === 3);
  });

  it('limite atingido → fila de erro por limite de tentativas', () => {
    const d = decidirDestinoFalha({ tentativasRealizadas: 4, retentavel: true, politica });
    assert.deepEqual([d.destino, d.destino === 'fila_erro' ? d.motivo : null], ['fila_erro', 'limite_tentativas']);
  });

  it('falha definitiva → fila de erro já na primeira execução, sem nova tentativa', () => {
    const d = decidirDestinoFalha({ tentativasRealizadas: 1, retentavel: false, politica });
    assert.deepEqual([d.destino, d.destino === 'fila_erro' ? d.motivo : null], ['fila_erro', 'falha_definitiva']);
    assert.match(d.explicacao, /reprocessamento/);
  });
});

describe('classificarRespostaHttp', () => {
  it('2xx sucesso, 401 novo login, 408/425/429/5xx nova tentativa, demais 4xx definitivos', () => {
    assert.equal(classificarRespostaHttp(201), 'sucesso');
    assert.equal(classificarRespostaHttp(401), 'reautenticar');
    for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(classificarRespostaHttp(s), 'nova_tentativa', String(s));
    for (const s of [301, 400, 403, 404, 409, 422]) assert.equal(classificarRespostaHttp(s), 'definitiva', String(s));
    assert.throws(() => classificarRespostaHttp(99), comCodigo('STATUS_HTTP_INVALIDO'));
  });
});

describe('chaveIdempotencia', () => {
  it('mesmas partes, mesma chave; partes vazias ou com separador são recusadas', () => {
    assert.equal(chaveIdempotencia(['pncp', 'compra', 'ABC-1']), 'pncp:compra:abc-1');
    assert.equal(chaveIdempotencia(['pncp', 'compra', 'abc-1']), chaveIdempotencia(['PNCP', 'compra', 'ABC-1']));
    assert.throws(() => chaveIdempotencia(['pncp']), comCodigo('CHAVE_INVALIDA'));
    assert.throws(() => chaveIdempotencia(['pncp', '']), comCodigo('CHAVE_INVALIDA'));
    assert.throws(() => chaveIdempotencia(['pncp', 'a:b']), comCodigo('CHAVE_INVALIDA'));
  });
});

describe('numeroControlePncp e interpretarLocalizacaoPncp (RF-19)', () => {
  it('monta os números de controle de compra, contrato e ata conforme a seção 4.3 do manual', () => {
    assert.equal(numeroControlePncp({ registro: 'compra', cnpj: CNPJ, ano: 2026, sequencial: 7 }), `${CNPJ}-1-000007/2026`);
    assert.equal(numeroControlePncp({ registro: 'contrato', cnpj: CNPJ, ano: 2026, sequencial: 12 }), `${CNPJ}-2-000012/2026`);
    assert.equal(numeroControlePncp({ registro: 'ata', cnpj: CNPJ, ano: 2026, sequencial: 7, sequencialAta: 1 }), `${CNPJ}-1-000007/2026-000001`);
    assert.throws(() => numeroControlePncp({ registro: 'compra', cnpj: '123', ano: 2026, sequencial: 1 }), comCodigo('PNCP_INVALIDO'));
    assert.throws(() => numeroControlePncp({ registro: 'ata', cnpj: CNPJ, ano: 2026, sequencial: 1 }), comCodigo('PNCP_INVALIDO'));
  });

  it('lê o location do 201 (compra, arquivo, contrato e ata)', () => {
    const base = 'https://treina.pncp.gov.br/api/pncp/v1/orgaos';
    const compra = interpretarLocalizacaoPncp(`${base}/${CNPJ}/compras/2026/7`);
    assert.deepEqual(
      [compra.registro, compra.ano, compra.sequencial, compra.sequencialDocumento, compra.numeroControle],
      ['compra', 2026, 7, null, `${CNPJ}-1-000007/2026`],
    );
    const arquivo = interpretarLocalizacaoPncp(`${base}/${CNPJ}/compras/2026/7/arquivos/3`);
    assert.deepEqual([arquivo.registro, arquivo.sequencialDocumento], ['compra', 3]);
    const contrato = interpretarLocalizacaoPncp(`${base}/${CNPJ}/contratos/2026/12`);
    assert.equal(contrato.numeroControle, `${CNPJ}-2-000012/2026`);
    const ata = interpretarLocalizacaoPncp(`/v1/orgaos/${CNPJ}/compras/2026/7/atas/1`);
    assert.deepEqual([ata.registro, ata.numeroControle], ['ata', `${CNPJ}-1-000007/2026-000001`]);
    assert.throws(() => interpretarLocalizacaoPncp('https://exemplo.gov.br/qualquer'), comCodigo('PNCP_LOCALIZACAO_INVALIDA'));
  });
});

describe('tituloDocumentoPncp e codigosContratacaoPncp (RF-19)', () => {
  it('título com no máximo 50 caracteres, cortado em palavra', () => {
    assert.equal(tituloDocumentoPncp('  Edital   do pregão  '), 'Edital do pregão');
    const longo = tituloDocumentoPncp('Termo de referência da aquisição de equipamentos de proteção individual');
    assert.ok(longo.length <= 50 && !longo.endsWith(' '), longo);
    assert.throws(() => tituloDocumentoPncp('   '), comCodigo('PNCP_INVALIDO'));
  });

  it('pregão eletrônico com menor preço → modalidade 6, amparo 1 (art. 28, I), modo aberto, critério 1', () => {
    const c = codigosContratacaoPncp({ modalidade: 'Pregão eletrônico', criterio: 'menor_preco', objeto: 'bens' });
    assert.deepEqual(c, {
      tipoInstrumentoConvocatorioId: 1,
      modalidadeId: 6,
      modoDisputaId: 1,
      amparoLegalId: 1,
      criterioJulgamentoId: 1,
      materialOuServico: 'M',
      categoriaProcessoId: 2,
    });
  });

  it('concorrência eletrônica com técnica e preço → modalidade 4, amparo 2, modo fechado (art. 56, § 1º)', () => {
    const c = codigosContratacaoPncp({ modalidade: 'Concorrência eletrônica', criterio: 'tecnica_preco', objeto: 'servicos_especiais' });
    assert.deepEqual([c.modalidadeId, c.amparoLegalId, c.modoDisputaId, c.criterioJulgamentoId, c.materialOuServico], [4, 2, 2, 4, 'S']);
    assert.throws(() => codigosContratacaoPncp({ modalidade: 'Dispensa', criterio: 'menor_preco', objeto: 'bens' }), comCodigo('PNCP_MODALIDADE'));
  });

  it('tabela de tipos de documento da seção 5.12', () => {
    assert.equal(TIPOS_DOCUMENTO_PNCP.edital, 2);
    assert.equal(TIPOS_DOCUMENTO_PNCP.termoReferencia, 4);
    assert.equal(TIPOS_DOCUMENTO_PNCP.minutaContrato, 3);
    assert.ok(Object.isFrozen(TIPOS_DOCUMENTO_PNCP));
  });
});

describe('catálogo — RNF-07 e RF-19', () => {
  it('RNF-07 descreve a fila resiliente e RF-19 a publicação no PNCP, com fundamento e implementação', () => {
    const rnf = CATALOGO_REGRAS.find((r) => r.id === 'RNF-07');
    const rf = CATALOGO_REGRAS.find((r) => r.id === 'RF-19');
    assert.ok(rnf && rf);
    assert.match(rnf.implementacao, /decidirDestinoFalha/);
    assert.match(rnf.descricao, /fila de erro/);
    assert.match(rf.fundamento, /art\. 54/);
    assert.match(rf.fundamento, /art\. 94/);
    assert.match(rf.fundamento, /art\. 174/);
    assert.match(rf.implementacao, /interpretarLocalizacaoPncp/);
    assert.equal(rf.etapa, 5);
  });
});
