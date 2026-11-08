import type { Sessao } from '@agora/contratos';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { construirApp } from '../src/app.ts';
import { carregarConfig } from '../src/config.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { SENHA_DEMONSTRACAO } from '../src/seed/usuarios-demonstracao.ts';

/** Data de referência fixa dos testes (segunda-feira); o relógio avança a partir dela. */
export const INICIO_TESTES = Date.parse('2026-11-09T13:00:00.000Z');

export interface OpcoesTeste {
  env?: Record<string, string>;
  fetch?: FuncaoFetch;
  /** Relógio controlado pelo teste (padrão: avança a partir de INICIO_TESTES). */
  relogio?: () => Date;
}

/** Relógio manual para testes que precisam saltar no tempo (prazos de publicação, validade de senha). */
export function relogioManual(inicio = INICIO_TESTES): { relogio: () => Date; avancar(ms: number): void } {
  let atual = inicio;
  return {
    relogio: () => new Date(atual),
    avancar: (ms: number) => {
      atual += ms;
    },
  };
}

/** App completo sobre PGlite em memória, com carga sintética e relógio determinístico. */
export async function criarAppTeste(opcoes: OpcoesTeste = {}): Promise<FastifyInstance> {
  const config = carregarConfig({
    AGORA_AMBIENTE: 'demonstracao',
    AGORA_DADOS_DIR: 'memory://',
    AGORA_LOG_NIVEL: 'silent',
    AGORA_WEB_DIR: 'memory://sem-front-end',
    ...opcoes.env,
  });
  const partida = Date.now();
  return construirApp(config, {
    relogio: opcoes.relogio ?? (() => new Date(INICIO_TESTES + (Date.now() - partida))),
    ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}),
  });
}

export interface Credenciais {
  cookie: string;
  csrf: string;
  sessao: Sessao;
}

export function cookieDe(resposta: LightMyRequestResponse): string {
  const bruto = resposta.headers['set-cookie'];
  const primeiro = Array.isArray(bruto) ? bruto[0] : bruto;
  if (!primeiro) throw new Error('Resposta sem Set-Cookie');
  return primeiro.split(';')[0] ?? '';
}

export async function entrar(app: FastifyInstance, email: string, senha = SENHA_DEMONSTRACAO): Promise<Credenciais> {
  const resposta = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email, senha } });
  if (resposta.statusCode !== 200) throw new Error(`Login de ${email} falhou: ${resposta.statusCode} ${resposta.body}`);
  const sessao = resposta.json<Sessao>();
  return { cookie: cookieDe(resposta), csrf: sessao.csrfToken, sessao };
}

/** Requisição autenticada; escritas levam o cabeçalho CSRF. */
export function chamar(
  app: FastifyInstance,
  credenciais: Credenciais,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: {
      cookie: credenciais.cookie,
      ...(method === 'GET' ? {} : { 'x-agora-csrf': credenciais.csrf }),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

export async function obterJson<T>(app: FastifyInstance, credenciais: Credenciais, url: string): Promise<T> {
  const resposta = await chamar(app, credenciais, 'GET', url);
  if (resposta.statusCode !== 200) throw new Error(`GET ${url} → ${resposta.statusCode} ${resposta.body}`);
  return resposta.json<T>();
}
