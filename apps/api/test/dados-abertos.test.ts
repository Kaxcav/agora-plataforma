import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { validarCpf } from '@agora/dominio';
import type { CatalogoDadosAbertos, ConjuntoDadosAbertos } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { criarAppTeste } from './apoio.ts';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Procura CPF em qualquer forma: formatado, ou 11 dígitos seguidos com dígitos verificadores válidos. */
function contemCpf(texto: string): boolean {
  if (/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/.test(texto)) return true;
  return [...texto.matchAll(/(?<!\d)\d{11}(?!\d)/g)].some((m) => validarCpf(m[0]));
}

describe('catálogo de dados abertos (RF-38) — sem login e sem dado pessoal', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000', AGORA_DADOS_ABERTOS_LIMITE_MINUTO: '1000' } });
  });
  after(async () => {
    await app.close();
  });

  test('catálogo: conjuntos com dicionário, licença aberta, atualização, periodicidade e hash', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos' });
    assert.equal(r.statusCode, 200);
    const catalogo = r.json<CatalogoDadosAbertos>();
    assert.deepEqual(catalogo.conjuntos.map((c) => c.id), ['editais', 'contratos', 'atas', 'aditivos', 'pagamentos', 'sancoes']);
    assert.ok(catalogo.indisponiveis.some((c) => c.id === 'pca'));
    for (const c of catalogo.conjuntos) {
      assert.equal(c.licenca.identificador, 'CC-BY-4.0', c.id);
      assert.ok(c.dicionario.length >= 5, c.id);
      assert.ok(c.periodicidade.length > 10, c.id);
      assert.ok(c.registros > 0, `${c.id} sem registros no seed`);
      assert.ok(c.atualizadoEm !== null, c.id);
      assert.deepEqual(c.arquivos.map((a) => a.formato), ['csv', 'json']);
      for (const a of c.arquivos) assert.match(a.sha256, /^[0-9a-f]{64}$/);
    }
  });

  test('CSV de contratos: dicionário no cabeçalho, hash conferível e nenhum CPF', async () => {
    const meta = (await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/contratos' })).json<ConjuntoDadosAbertos>();
    const csv = await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/contratos/csv' });
    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers['content-type']), /^text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /attachment; filename="contratos\.csv"/);
    assert.equal(csv.headers['x-agora-sha256'], sha256(csv.rawPayload));
    assert.equal(meta.arquivos.find((a) => a.formato === 'csv')?.sha256, sha256(csv.rawPayload));
    const linhas = csv.body.split('\r\n');
    assert.equal(linhas[0], meta.dicionario.map((c) => c.nome).join(','));
    assert.ok(!contemCpf(csv.body), 'CSV de contratos sem CPF');
    assert.ok(!/@/.test(csv.body), 'sem e-mail');

    // O seed tem fornecedores pessoa física com contrato: o CPF deles não pode aparecer.
    const pf = await app.agora.banco.consultar<{ documento: string; razao_social: string }>(
      "SELECT DISTINCT f.documento, f.razao_social FROM fornecedores f JOIN contratos c ON c.fornecedor_id = f.id WHERE f.tipo_pessoa = 'PF'",
    );
    assert.ok(pf.length > 0, 'o seed deve ter contrato com pessoa física');
    for (const f of pf) {
      assert.ok(!csv.body.includes(f.documento));
      assert.ok(!csv.body.includes(f.razao_social), 'nome completo de pessoa física não sai');
    }
  });

  test('JSON: os mesmos registros, valores em reais como número', async () => {
    const meta = (await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/contratos' })).json<ConjuntoDadosAbertos>();
    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/contratos/json' });
    assert.equal(r.statusCode, 200);
    assert.equal(meta.arquivos.find((a) => a.formato === 'json')?.sha256, sha256(r.rawPayload));
    const corpo = r.json<{ licenca: string; registros: { valor_global: number; fornecedor_tipo: string; fornecedor_cnpj: string | null }[] }>();
    assert.equal(corpo.licenca, 'CC-BY-4.0');
    assert.equal(corpo.registros.length, meta.registros);
    assert.equal(typeof corpo.registros[0]?.valor_global, 'number');
    assert.ok(corpo.registros.filter((x) => x.fornecedor_tipo === 'PF').every((x) => x.fornecedor_cnpj === null));
  });

  test('pagamentos na ordem cronológica por fonte e sanções só aplicadas, sem CPF em nenhum conjunto', async () => {
    const pagamentos = (await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/pagamentos/json' })).json<{
      registros: { fonte_recurso: string; posicao_ordem_cronologica: number | null; data_exigibilidade: string }[];
    }>().registros;
    const porFonte = new Map<string, number[]>();
    for (const p of pagamentos) if (p.posicao_ordem_cronologica !== null) porFonte.set(p.fonte_recurso, [...(porFonte.get(p.fonte_recurso) ?? []), p.posicao_ordem_cronologica]);
    for (const posicoes of porFonte.values()) assert.deepEqual(posicoes, posicoes.map((_, i) => i + 1));

    const [aplicadas] = await app.agora.banco.consultar<{ total: number }>("SELECT COUNT(*)::integer AS total FROM sancoes WHERE situacao = 'aplicada'");
    const sancoes = (await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/sancoes/json' })).json<{ registros: unknown[] }>();
    assert.equal(sancoes.registros.length, aplicadas?.total);

    for (const conjunto of ['editais', 'atas', 'aditivos', 'pagamentos', 'sancoes']) {
      const csv = await app.inject({ method: 'GET', url: `/api/v1/publico/dados-abertos/${conjunto}/csv` });
      assert.equal(csv.statusCode, 200, conjunto);
      assert.ok(!contemCpf(csv.body), `${conjunto} sem CPF`);
    }
  });

  test('conjunto inexistente → 404; formato inválido → 400', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/servidores/csv' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/contratos/xml' })).statusCode, 400);
  });
});

describe('catálogo de dados abertos — limite de requisições por IP', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ env: { AGORA_DADOS_ABERTOS_LIMITE_MINUTO: '2' } });
  });
  after(async () => {
    await app.close();
  });

  test('acima do limite configurado, 429 com código estável', async () => {
    const status: number[] = [];
    for (let i = 0; i < 3; i += 1) status.push((await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/sancoes/csv' })).statusCode);
    assert.deepEqual(status, [200, 200, 429]);
    const bloqueada = await app.inject({ method: 'GET', url: '/api/v1/publico/dados-abertos/sancoes/csv' });
    assert.equal(bloqueada.json<{ erro: { codigo: string } }>().erro.codigo, 'LIMITE_REQUISICOES');
  });
});
