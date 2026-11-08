import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { Sessao } from '@agora/contratos';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { cookieDe, criarAppTeste } from './apoio.ts';

const EMISSOR = 'https://sso.exemplo-govbr.test';
const CLIENT_ID = 'agora-demonstracao';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'chave-1', use: 'sig', alg: 'RS256' };

function base64url(valor: unknown): string {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

function assinarIdToken(claims: Record<string, unknown>): string {
  const cabecalho = base64url({ alg: 'RS256', kid: 'chave-1', typ: 'JWT' });
  const carga = base64url(claims);
  const assinatura = createSign('RSA-SHA256').update(`${cabecalho}.${carga}`).sign(privateKey).toString('base64url');
  return `${cabecalho}.${carga}.${assinatura}`;
}

interface EstadoProvedor {
  nonce: string;
  desafio: string;
  sub: string;
  verificadorRecebido: string | null;
  autorizacao: string | null;
  relogio: () => Date;
}

function provedorSimulado(estado: EstadoProvedor): FuncaoFetch {
  return async (entrada, init) => {
    const url = String(entrada);
    if (url === `${EMISSOR}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: EMISSOR,
        authorization_endpoint: `${EMISSOR}/authorize`,
        token_endpoint: `${EMISSOR}/token`,
        jwks_uri: `${EMISSOR}/jwk`,
      });
    }
    if (url === `${EMISSOR}/jwk`) return Response.json({ keys: [JWK] });
    if (url === `${EMISSOR}/token`) {
      const corpo = new URLSearchParams(String(init?.body ?? ''));
      estado.verificadorRecebido = corpo.get('code_verifier');
      estado.autorizacao = new Headers(init?.headers).get('authorization');
      if (corpo.get('grant_type') !== 'authorization_code' || corpo.get('code') !== 'codigo-valido') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const agora = Math.floor(estado.relogio().getTime() / 1000);
      return Response.json({
        token_type: 'Bearer',
        access_token: 'opaco',
        id_token: assinarIdToken({ iss: EMISSOR, sub: estado.sub, aud: CLIENT_ID, exp: agora + 600, iat: agora, nonce: estado.nonce }),
      });
    }
    return new Response('não encontrado', { status: 404 });
  };
}

describe('Login Único gov.br (OIDC Authorization Code + PKCE)', () => {
  let app: FastifyInstance;
  const estado: EstadoProvedor = { nonce: '', desafio: '', sub: '', verificadorRecebido: null, autorizacao: null, relogio: () => new Date() };

  before(async () => {
    app = await criarAppTeste({
      env: {
        AGORA_GOVBR_CLIENT_ID: CLIENT_ID,
        AGORA_GOVBR_CLIENT_SECRET: 'segredo-do-cliente',
        AGORA_GOVBR_EMISSOR: EMISSOR,
        AGORA_GOVBR_REDIRECT: 'http://localhost:3000/api/v1/sessao/govbr/retorno',
      },
      fetch: provedorSimulado(estado),
    });
    const [gestor] = await app.agora.banco.consultar<{ cpf: string }>("SELECT cpf FROM usuarios WHERE email = 'gestor@agora.demo'");
    assert.ok(gestor);
    estado.sub = gestor.cpf;
    estado.relogio = app.agora.relogio;
  });
  after(async () => {
    await app.close();
  });

  async function iniciar(): Promise<{ resposta: LightMyRequestResponse; destino: URL }> {
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/sessao/govbr/iniciar' });
    assert.equal(resposta.statusCode, 302);
    const destino = new URL(String(resposta.headers.location));
    estado.nonce = destino.searchParams.get('nonce') ?? '';
    estado.desafio = destino.searchParams.get('code_challenge') ?? '';
    return { resposta, destino };
  }

  test('configuração pública indica o gov.br habilitado', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' });
    assert.equal(r.json<{ govbrHabilitado: boolean }>().govbrHabilitado, true);
  });

  test('fluxo completo: autorização com PKCE S256, troca do código, id_token validado e sessão criada', async () => {
    const { resposta, destino } = await iniciar();
    assert.equal(destino.origin + destino.pathname, `${EMISSOR}/authorize`);
    assert.equal(destino.searchParams.get('response_type'), 'code');
    assert.equal(destino.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(destino.searchParams.get('state'));
    const cookieEstado = String(resposta.headers['set-cookie']);
    assert.match(cookieEstado, /^agora_govbr=/);
    assert.match(cookieEstado, /HttpOnly/);
    assert.match(cookieEstado, /SameSite=Lax/);
    assert.match(cookieEstado, /Path=\/api\/v1\/sessao\/govbr/);

    const retorno = await app.inject({
      method: 'GET',
      url: `/api/v1/sessao/govbr/retorno?code=codigo-valido&state=${encodeURIComponent(destino.searchParams.get('state') ?? '')}`,
      headers: { cookie: cookieDe(resposta) },
    });
    assert.equal(retorno.statusCode, 302);
    assert.equal(retorno.headers.location, '/');
    const verificador = estado.verificadorRecebido ?? '';
    assert.equal(createHash('sha256').update(verificador).digest('base64url'), estado.desafio, 'code_verifier confere com o code_challenge');
    assert.match(estado.autorizacao ?? '', /^Basic /);

    const cookies = ([] as string[]).concat(retorno.headers['set-cookie'] ?? []);
    const sessaoCookie = cookies.find((c) => c.startsWith('agora_sessao='));
    assert.ok(sessaoCookie);
    const sessao = await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie: sessaoCookie.split(';')[0] ?? '' } });
    assert.equal(sessao.statusCode, 200);
    assert.equal(sessao.json<Sessao>().usuario.email, 'gestor@agora.demo');
  });

  test('state adulterado, cookie ausente ou CPF sem usuário ativo → /entrar?erro=govbr', async () => {
    const { resposta } = await iniciar();
    const stateErrado = await app.inject({
      method: 'GET',
      url: '/api/v1/sessao/govbr/retorno?code=codigo-valido&state=outro',
      headers: { cookie: cookieDe(resposta) },
    });
    assert.equal(stateErrado.headers.location, '/entrar?erro=govbr');

    const { destino } = await iniciar();
    const semCookie = await app.inject({ method: 'GET', url: `/api/v1/sessao/govbr/retorno?code=codigo-valido&state=${destino.searchParams.get('state')}` });
    assert.equal(semCookie.headers.location, '/entrar?erro=govbr');

    const original = estado.sub;
    estado.sub = gerarCpf(new Prng(5));
    try {
      const inicio = await iniciar();
      const semUsuario = await app.inject({
        method: 'GET',
        url: `/api/v1/sessao/govbr/retorno?code=codigo-valido&state=${inicio.destino.searchParams.get('state')}`,
        headers: { cookie: cookieDe(inicio.resposta) },
      });
      assert.equal(semUsuario.headers.location, '/entrar?erro=govbr', 'nunca cria usuário automaticamente');
    } finally {
      estado.sub = original;
    }
    const [{ total } = { total: 0 }] = await app.agora.banco.consultar<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM auditoria_eventos WHERE acao = 'sessao.falhar' AND dados ->> 'metodo' = 'govbr'",
    );
    assert.ok(total >= 3);
  });
});
