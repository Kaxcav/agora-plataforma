import { createHash, createPublicKey, verify as verificarAssinatura, type JsonWebKey } from 'node:crypto';
import { somenteDigitos, validarCpf } from '@agora/dominio';
import { z } from 'zod';
import { iguaisTempoConstante, tokenAleatorio } from '../compartilhado/cripto.ts';
import type { Config } from '../config.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

/** Estado temporário do fluxo (vai em cookie assinado de vida curta). */
export interface EstadoGovbr {
  state: string;
  nonce: string;
  verificador: string;
  criadoEm: number;
}

export const COOKIE_GOVBR = 'agora_govbr';
export const CAMINHO_COOKIE_GOVBR = '/api/v1/sessao/govbr';
export const VALIDADE_ESTADO_MS = 10 * 60 * 1000;
const TOLERANCIA_RELOGIO_S = 60;
const TIMEOUT_MS = 10_000;

export class ErroGovbr extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroGovbr';
  }
}

const esquemaDescoberta = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
type Descoberta = z.infer<typeof esquemaDescoberta>;

const esquemaToken = z.object({ id_token: z.string().min(10), token_type: z.string().optional() });
const esquemaCabecalho = z.object({ alg: z.string(), kid: z.string().optional() });
const esquemaClaims = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number().optional(),
  nonce: z.string().optional(),
});
const esquemaJwks = z.object({
  keys: z.array(
    z
      .object({ kty: z.string(), kid: z.string().optional(), use: z.string().optional(), alg: z.string().optional() })
      .catchall(z.unknown()),
  ),
});

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function decodificarJson(parte: string): unknown {
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

export function serializarEstado(estado: EstadoGovbr): string {
  return Buffer.from(JSON.stringify(estado), 'utf8').toString('base64url');
}

const esquemaEstado = z.object({ state: z.string(), nonce: z.string(), verificador: z.string(), criadoEm: z.number() });

export function lerEstado(valor: string): EstadoGovbr | null {
  const resultado = esquemaEstado.safeParse(decodificarJsonSeguro(valor));
  return resultado.success ? resultado.data : null;
}

function decodificarJsonSeguro(valor: string): unknown {
  const texto = Buffer.from(valor, 'base64url').toString('utf8');
  return texto.startsWith('{') && texto.endsWith('}') ? (JSON.parse(texto) as unknown) : null;
}

/**
 * Cliente do Login Único gov.br: OpenID Connect Authorization Code com PKCE (S256), descoberta
 * em `{emissor}/.well-known/openid-configuration` e validação local do id_token (assinatura via JWKS,
 * emissor, audiência, expiração e nonce). O `sub` é o CPF do cidadão.
 */
export class ClienteGovbr {
  readonly #config: NonNullable<Config['govbr']>;
  readonly #fetch: FuncaoFetch;
  readonly #relogio: () => Date;
  #descoberta: { valor: Descoberta; expiraEm: number } | null = null;

  constructor(config: NonNullable<Config['govbr']>, fetch: FuncaoFetch, relogio: () => Date) {
    this.#config = config;
    this.#fetch = fetch;
    this.#relogio = relogio;
  }

  async #buscarJson(url: string, init?: RequestInit): Promise<unknown> {
    const resposta = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!resposta.ok) throw new ErroGovbr(`gov.br respondeu HTTP ${resposta.status} em ${new URL(url).pathname}`);
    return (await resposta.json()) as unknown;
  }

  async descobrir(): Promise<Descoberta> {
    const agora = this.#relogio().getTime();
    if (this.#descoberta && this.#descoberta.expiraEm > agora) return this.#descoberta.valor;
    const bruto = await this.#buscarJson(`${this.#config.emissor}/.well-known/openid-configuration`);
    const valor = esquemaDescoberta.parse(bruto);
    this.#descoberta = { valor, expiraEm: agora + 60 * 60 * 1000 };
    return valor;
  }

  /** Monta a URL de autorização e o estado (state, nonce e verificador PKCE) a guardar no cookie temporário. */
  async iniciar(): Promise<{ url: string; estado: EstadoGovbr }> {
    const descoberta = await this.descobrir();
    const estado: EstadoGovbr = {
      state: tokenAleatorio(24),
      nonce: tokenAleatorio(24),
      verificador: tokenAleatorio(48),
      criadoEm: this.#relogio().getTime(),
    };
    const desafio = base64url(createHash('sha256').update(estado.verificador).digest());
    const url = new URL(descoberta.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.#config.clientId,
      scope: 'openid email profile',
      redirect_uri: this.#config.redirect,
      state: estado.state,
      nonce: estado.nonce,
      code_challenge: desafio,
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), estado };
  }

  /** Troca o código pelo id_token, valida-o e devolve o CPF (somente dígitos) do usuário autenticado. */
  async concluir(parametros: { code: string; state: string }, estado: EstadoGovbr): Promise<{ cpf: string }> {
    if (this.#relogio().getTime() - estado.criadoEm > VALIDADE_ESTADO_MS) throw new ErroGovbr('Estado do login expirado');
    if (!iguaisTempoConstante(parametros.state, estado.state)) throw new ErroGovbr('Parâmetro state não confere');

    const descoberta = await this.descobrir();
    const credenciais = Buffer.from(
      `${encodeURIComponent(this.#config.clientId)}:${encodeURIComponent(this.#config.clientSecret)}`,
    ).toString('base64');
    const token = esquemaToken.parse(
      await this.#buscarJson(descoberta.token_endpoint, {
        method: 'POST',
        headers: {
          authorization: `Basic ${credenciais}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: parametros.code,
          redirect_uri: this.#config.redirect,
          code_verifier: estado.verificador,
        }).toString(),
      }),
    );
    const claims = await this.#validarIdToken(token.id_token, descoberta, estado.nonce);
    const cpf = somenteDigitos(claims.sub);
    if (!validarCpf(cpf)) throw new ErroGovbr('O identificador retornado pelo gov.br não é um CPF válido');
    return { cpf };
  }

  async #validarIdToken(idToken: string, descoberta: Descoberta, nonce: string): Promise<z.infer<typeof esquemaClaims>> {
    const partes = idToken.split('.');
    if (partes.length !== 3) throw new ErroGovbr('id_token malformado');
    const [cabecalhoTexto, cargaTexto, assinaturaTexto] = partes as [string, string, string];
    const cabecalho = esquemaCabecalho.parse(decodificarJson(cabecalhoTexto));
    if (cabecalho.alg !== 'RS256' && cabecalho.alg !== 'ES256') throw new ErroGovbr(`Algoritmo não aceito: ${cabecalho.alg}`);

    const jwks = esquemaJwks.parse(await this.#buscarJson(descoberta.jwks_uri));
    const tipoChave = cabecalho.alg === 'RS256' ? 'RSA' : 'EC';
    const chave = jwks.keys.find(
      (k) => k.kty === tipoChave && (cabecalho.kid === undefined || k.kid === cabecalho.kid) && (k.use === undefined || k.use === 'sig'),
    );
    if (!chave) throw new ErroGovbr('Chave de assinatura do id_token não encontrada no JWKS');
    const chavePublica = createPublicKey({ key: chave as JsonWebKey, format: 'jwk' });
    const valida = verificarAssinatura(
      'sha256',
      Buffer.from(`${cabecalhoTexto}.${cargaTexto}`),
      cabecalho.alg === 'ES256' ? { key: chavePublica, dsaEncoding: 'ieee-p1363' } : chavePublica,
      Buffer.from(assinaturaTexto, 'base64url'),
    );
    if (!valida) throw new ErroGovbr('Assinatura do id_token inválida');

    const claims = esquemaClaims.parse(decodificarJson(cargaTexto));
    const agoraS = Math.floor(this.#relogio().getTime() / 1000);
    const audiencias = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== descoberta.issuer) throw new ErroGovbr('Emissor do id_token não confere');
    if (!audiencias.includes(this.#config.clientId)) throw new ErroGovbr('Audiência do id_token não confere');
    if (claims.exp + TOLERANCIA_RELOGIO_S < agoraS) throw new ErroGovbr('id_token expirado');
    if (claims.iat !== undefined && claims.iat - TOLERANCIA_RELOGIO_S > agoraS) throw new ErroGovbr('id_token emitido no futuro');
    if (claims.nonce === undefined || !iguaisTempoConstante(claims.nonce, nonce)) throw new ErroGovbr('nonce do id_token não confere');
    return claims;
  }
}
