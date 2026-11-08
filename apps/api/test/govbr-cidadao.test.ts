import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { Sessao } from '@agora/contratos';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { criarAppTeste } from './apoio.ts';

const EMISSOR = 'https://sso.exemplo-govbr.test';
const CLIENT_ID = 'agora-demonstracao';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'chave-1', use: 'sig', alg: 'RS256' };

function base64url(valor: unknown): string {
  return Buffer.from(JSON.stringify(valor)).toString('base64url');
}

/** Provedor gov.br simulado: o id_token traz CPF (sub), nome e e-mail, como o Login Único. */
function provedor(estado: { nonce: string; sub: string; relogio: () => Date }): FuncaoFetch {
  return async (entrada) => {
    const url = String(entrada);
    if (url === `${EMISSOR}/.well-known/openid-configuration`) {
      return Response.json({ issuer: EMISSOR, authorization_endpoint: `${EMISSOR}/authorize`, token_endpoint: `${EMISSOR}/token`, jwks_uri: `${EMISSOR}/jwk` });
    }
    if (url === `${EMISSOR}/jwk`) return Response.json({ keys: [JWK] });
    if (url === `${EMISSOR}/token`) {
      const agora = Math.floor(estado.relogio().getTime() / 1000);
      const claims = { iss: EMISSOR, sub: estado.sub, aud: CLIENT_ID, exp: agora + 600, iat: agora, nonce: estado.nonce, name: 'Joana Sintética Prado', email: 'joana.sintetica@exemplo.test' };
      const cabecalho = base64url({ alg: 'RS256', kid: 'chave-1', typ: 'JWT' });
      const carga = base64url(claims);
      const assinatura = createSign('RSA-SHA256').update(`${cabecalho}.${carga}`).sign(privateKey).toString('base64url');
      return Response.json({ token_type: 'Bearer', id_token: `${cabecalho}.${carga}.${assinatura}` });
    }
    return new Response('não encontrado', { status: 404 });
  };
}

function cookies(resposta: LightMyRequestResponse): string[] {
  return ([] as string[]).concat(resposta.headers['set-cookie'] ?? []).map((c) => c.split(';')[0] ?? '');
}

describe('Login Único gov.br do cidadão (perfil sem acesso interno; art. 174, § 3º, VI, "a")', () => {
  let app: FastifyInstance;
  const estado = { nonce: '', sub: gerarCpf(new Prng(777)), relogio: () => new Date() };

  before(async () => {
    app = await criarAppTeste({
      env: {
        AGORA_GOVBR_CLIENT_ID: CLIENT_ID,
        // O provedor simulado não confere o segredo do cliente: um valor aleatório por execução basta.
        AGORA_GOVBR_CLIENT_SECRET: randomBytes(24).toString('hex'),
        AGORA_GOVBR_EMISSOR: EMISSOR,
        AGORA_GOVBR_REDIRECT: 'http://localhost:3000/api/v1/sessao/govbr/retorno',
      },
      fetch: provedor(estado),
    });
    estado.relogio = app.agora.relogio;
  });
  after(async () => {
    await app.close();
  });

  async function fluxo(retorno: string | null): Promise<LightMyRequestResponse> {
    const cookiesIda: string[] = [];
    if (retorno !== null) {
      const cidadao = await app.inject({ method: 'GET', url: `/api/v1/sessao/govbr/cidadao?retorno=${encodeURIComponent(retorno)}` });
      assert.equal(cidadao.statusCode, 302);
      assert.equal(cidadao.headers.location, '/api/v1/sessao/govbr/iniciar');
      assert.match(String(cidadao.headers['set-cookie']), /agora_govbr_cidadao=.*HttpOnly/);
      cookiesIda.push(...cookies(cidadao));
    }
    const inicio = await app.inject({ method: 'GET', url: '/api/v1/sessao/govbr/iniciar' });
    const destino = new URL(String(inicio.headers.location));
    estado.nonce = destino.searchParams.get('nonce') ?? '';
    cookiesIda.push(...cookies(inicio));
    return app.inject({
      method: 'GET',
      url: `/api/v1/sessao/govbr/retorno?code=codigo&state=${encodeURIComponent(destino.searchParams.get('state') ?? '')}`,
      headers: { cookie: cookiesIda.join('; ') },
    });
  }

  test('sem a marcação de cidadão, CPF desconhecido continua recusado', async () => {
    const r = await fluxo(null);
    assert.equal(r.headers.location, '/entrar?erro=govbr');
    const [conta] = await app.agora.banco.consultar('SELECT id FROM usuarios WHERE cpf = $1', [estado.sub]);
    assert.equal(conta, undefined);
  });

  test('com a marcação, o CPF vira conta no perfil cidadão e volta para a página do contrato', async () => {
    const [contrato] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM contratos ORDER BY numero LIMIT 1');
    assert.ok(contrato);
    const r = await fluxo(`/transparencia/contratos/${contrato.id}`);
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, `/transparencia/contratos/${contrato.id}`);
    const sessaoCookie = cookies(r).find((c) => c.startsWith('agora_sessao='));
    assert.ok(sessaoCookie);
    const sessao = (await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie: sessaoCookie } })).json<Sessao>();
    assert.deepEqual(sessao.usuario.perfis, ['cidadao']);
    assert.deepEqual(sessao.usuario.permissoes, ['sociedade:manifestar']);
    assert.equal(sessao.usuario.nome, 'Joana Sintética Prado');
    assert.equal(sessao.usuario.uasgs.length, 0);
    const [evento] = await app.agora.banco.consultar<{ dados: { cpf: string } }>("SELECT dados FROM auditoria_eventos WHERE acao = 'sociedade.cidadao.cadastrar'");
    assert.ok(evento);
    assert.ok(!JSON.stringify(evento.dados).includes(estado.sub), 'CPF mascarado na trilha');

    // Segundo login: a mesma conta, sem duplicar.
    const segundo = await fluxo('https://site-externo.exemplo.test/');
    assert.equal(segundo.headers.location, '/sociedade/minhas-manifestacoes', 'retorno externo é ignorado');
    const [contagem] = await app.agora.banco.consultar<{ total: number }>('SELECT COUNT(*)::integer AS total FROM usuarios WHERE cpf = $1', [estado.sub]);
    assert.equal(contagem?.total, 1);
  });
});
