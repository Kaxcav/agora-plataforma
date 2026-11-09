import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { RespostaErro } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar } from './apoio.ts';
import { lerVersao } from '../src/versao.ts';

const CSP_DEMONSTRACAO =
  "default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';" +
  "frame-ancestors 'none';base-uri 'self';form-action 'self';object-src 'none'";

function normalizarCsp(valor: unknown): string {
  return String(valor)
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .join(';');
}

describe('cabeçalhos de segurança, CSRF, erros e front-end estático', () => {
  let app: FastifyInstance;
  let dirWeb: string;
  before(async () => {
    dirWeb = mkdtempSync(join(tmpdir(), 'agora-web-'));
    mkdirSync(join(dirWeb, 'assets'));
    writeFileSync(join(dirWeb, 'index.html'), '<!doctype html><html lang="pt-BR"><title>Ágora</title><div id="raiz"></div></html>');
    writeFileSync(join(dirWeb, 'assets', 'app-3f9a2b1c.js'), 'export const pronto = true;');
    writeFileSync(join(dirWeb, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    app = await criarAppTeste({ env: { AGORA_WEB_DIR: dirWeb } });
  });
  after(async () => {
    await app.close();
    rmSync(dirWeb, { recursive: true, force: true });
  });

  test('toda resposta da API traz CSP estrita e os demais cabeçalhos (§3.1)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' });
    assert.equal(r.statusCode, 200);
    assert.equal(normalizarCsp(r.headers['content-security-policy']), CSP_DEMONSTRACAO, 'demonstração sem HTTPS omite upgrade-insecure-requests');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'same-origin');
    assert.equal(r.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
    assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'sem CORS');
    assert.equal(r.headers['strict-transport-security'], undefined, 'HSTS só com cookie seguro');
    assert.match(String(r.headers['x-id-requisicao']), /^[0-9a-f-]{36}$/);

    const naoEncontrado = await app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
    assert.equal(naoEncontrado.statusCode, 404);
    assert.equal(naoEncontrado.json<RespostaErro>().erro.codigo, 'NAO_ENCONTRADO');
    assert.ok(naoEncontrado.headers['content-security-policy']);
  });

  test('com cookie seguro: HSTS, upgrade-insecure-requests e cookie Secure', async () => {
    const seguro = await criarAppTeste({ env: { AGORA_COOKIE_SEGURO: 'true' } });
    try {
      const r = await seguro.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'gestor@agora.demo', senha: 'Agora@Demo2026' } });
      assert.equal(r.statusCode, 200);
      assert.equal(r.headers['strict-transport-security'], 'max-age=63072000; includeSubDomains');
      assert.equal(normalizarCsp(r.headers['content-security-policy']), `${CSP_DEMONSTRACAO};upgrade-insecure-requests`);
      assert.match(String(r.headers['set-cookie']), /Secure/);
    } finally {
      await seguro.close();
    }
  });

  test('escrita sem o cabeçalho X-Agora-CSRF (ou com valor errado) → 403', async () => {
    const credenciais = await entrar(app, 'gestor@agora.demo');
    const url = '/api/v1/pendencias/00000000-0000-4000-8000-000000000000/resolver';
    const semCabecalho = await app.inject({ method: 'POST', url, headers: { cookie: credenciais.cookie }, payload: { observacao: 'teste de csrf' } });
    assert.equal(semCabecalho.statusCode, 403);
    assert.equal(semCabecalho.json<RespostaErro>().erro.codigo, 'CSRF_INVALIDO');
    const errado = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: credenciais.cookie, 'x-agora-csrf': 'token-forjado' },
      payload: { observacao: 'teste de csrf' },
    });
    assert.equal(errado.statusCode, 403);
    const correto = await chamar(app, credenciais, 'POST', url, { observacao: 'teste de csrf' });
    assert.equal(correto.statusCode, 404, 'com CSRF válido a requisição segue (e o id inexistente responde 404)');
  });

  test('erros uniformes: validação zod com detalhes, JSON inválido e id malformado', async () => {
    const credenciais = await entrar(app, 'gestor@agora.demo');
    const zod = await chamar(app, credenciais, 'GET', '/api/v1/contratos?tamanhoPagina=500&situacao=qualquer');
    assert.equal(zod.statusCode, 400);
    const corpo = zod.json<RespostaErro>();
    assert.equal(corpo.erro.codigo, 'VALIDACAO');
    assert.ok(corpo.erro.detalhes?.some((d) => d.campo === 'tamanhoPagina'));
    assert.ok(corpo.erro.detalhes?.some((d) => d.campo === 'situacao'));

    const jsonInvalido = await app.inject({
      method: 'POST',
      url: '/api/v1/sancoes/dosimetria/simular',
      headers: { cookie: credenciais.cookie, 'x-agora-csrf': credenciais.csrf, 'content-type': 'application/json' },
      payload: '{"valorContrato": ',
    });
    assert.equal(jsonInvalido.statusCode, 400);
    assert.equal(jsonInvalido.json<RespostaErro>().erro.codigo, 'VALIDACAO');

    const idMalformado = await chamar(app, credenciais, 'GET', '/api/v1/contratos/123');
    assert.equal(idMalformado.statusCode, 404);
  });

  test('front-end: arquivos com hash imutáveis, index.html sem cache e fallback do SPA', async () => {
    const raiz = await app.inject({ method: 'GET', url: '/' });
    assert.equal(raiz.statusCode, 200);
    assert.match(raiz.body, /id="raiz"/);
    assert.equal(raiz.headers['cache-control'], 'no-cache');
    assert.ok(raiz.headers['content-security-policy']);

    const rotaSpa = await app.inject({ method: 'GET', url: '/contratos/algum-id?aba=itens' });
    assert.equal(rotaSpa.statusCode, 200);
    assert.match(rotaSpa.body, /id="raiz"/);
    assert.equal(rotaSpa.headers['cache-control'], 'no-cache');

    const ativo = await app.inject({ method: 'GET', url: '/assets/app-3f9a2b1c.js' });
    assert.equal(ativo.statusCode, 200);
    assert.equal(ativo.headers['cache-control'], 'public, max-age=31536000, immutable');

    const arquivoInexistente = await app.inject({ method: 'GET', url: '/assets/nao-existe.js' });
    assert.equal(arquivoInexistente.statusCode, 404);

    const apiInexistente = await app.inject({ method: 'GET', url: '/api/v1/rota-desconhecida' });
    assert.equal(apiInexistente.statusCode, 404);
    assert.equal(apiInexistente.headers['content-type'], 'application/json; charset=utf-8');
  });

  test('saúde: vivo e pronto (com banco)', async () => {
    const vivo = await app.inject({ method: 'GET', url: '/saude/vivo' });
    assert.deepEqual(vivo.json(), { situacao: 'ok' });
    const pronto = await app.inject({ method: 'GET', url: '/saude/pronto' });
    assert.equal(pronto.statusCode, 200);
    const corpo = pronto.json<{ situacao: string; banco: boolean; versao: string }>();
    assert.equal(corpo.situacao, 'ok');
    assert.equal(corpo.banco, true);
    assert.equal(corpo.versao, lerVersao()); // a do package.json da API
    assert.equal(pronto.headers['cache-control'], 'no-store');
  });
});
