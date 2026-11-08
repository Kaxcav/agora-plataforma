import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { COOKIE_SESSAO, carregarSessao } from '../autenticacao/sessoes.ts';
import { hashIp, iguaisTempoConstante } from '../compartilhado/cripto.ts';
import type { ContextoApp } from './contexto.ts';
import { ErroApi } from './erros.ts';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CABECALHO_CSRF = 'x-agora-csrf';
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()';

/** Rotas da API isentas de CSRF: apenas o login (POST /sessao), que ainda não tem sessão. */
function isentoCsrf(request: FastifyRequest): boolean {
  return request.method === 'POST' && request.routeOptions.url === '/api/v1/sessao';
}

export function ehRotaApi(url: string): boolean {
  return url === '/api' || url.startsWith('/api/');
}

function ehRotaSemCache(url: string): boolean {
  return ehRotaApi(url) || url.startsWith('/saude/');
}

/**
 * Cabeçalhos de segurança (ARQUITETURA §3.1), cookies assinados, limite global de requisições,
 * carga da sessão e verificação de CSRF em toda escrita da API.
 */
export async function registrarSeguranca(app: FastifyInstance, ctx: ContextoApp): Promise<void> {
  const { config } = ctx;
  const incluirUpgrade = !(config.ambiente === 'demonstracao' && !config.cookieSeguro);

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        ...(incluirUpgrade ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.cookieSeguro ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('permissions-policy', PERMISSIONS_POLICY);
    reply.header('x-id-requisicao', request.id);
    if (ehRotaSemCache(request.url)) reply.header('cache-control', 'no-store');
  });

  await app.register(cookie, { secret: ctx.segredo, hook: 'onRequest' });

  await app.register(rateLimit, {
    global: true,
    max: config.limiteRequisicoesPorMinuto,
    timeWindow: 60_000,
    keyGenerator: (request) => request.ip,
    allowList: (request) => !ehRotaApi(request.url),
    errorResponseBuilder: (_request, contexto) =>
      new ErroApi(429, 'LIMITE_REQUISICOES', `Muitas requisições. Tente novamente em ${contexto.after}.`),
  });

  app.decorateRequest('sessao', null);
  app.decorateRequest('ipHash', '');

  app.addHook('onRequest', async (request) => {
    request.ipHash = hashIp(request.ip, ctx.segredo);
    if (!ehRotaApi(request.url)) return;

    const bruto = request.cookies[COOKIE_SESSAO];
    if (bruto) {
      const desassinado = request.unsignCookie(bruto);
      if (desassinado.valid && desassinado.value) {
        request.sessao = await carregarSessao(ctx.banco, desassinado.value, ctx.relogio());
      }
    }

    if (!METODOS_SEGUROS.has(request.method) && request.sessao && !isentoCsrf(request)) {
      const enviado = request.headers[CABECALHO_CSRF];
      if (typeof enviado !== 'string' || !iguaisTempoConstante(enviado, request.sessao.csrfToken)) {
        throw new ErroApi(403, 'CSRF_INVALIDO', 'Token CSRF ausente ou inválido. Recarregue a página e tente novamente.');
      }
    }
  });
}
