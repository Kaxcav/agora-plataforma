import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.ts';

/** `apps/web/dist` (mesma profundidade a partir de `src/` e de `dist/`), ou `AGORA_WEB_DIR`. */
export function diretorioWeb(config: Pick<Config, 'webDir'>): string {
  return config.webDir ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
}

const IMUTAVEL = 'public, max-age=31536000, immutable';

function cacheParaArquivo(caminho: string): string {
  if (caminho.endsWith(`${sep}index.html`) || caminho.endsWith('/index.html')) return 'no-cache';
  if (caminho.includes(`${sep}assets${sep}`) || caminho.includes('/assets/')) return IMUTAVEL;
  return 'public, max-age=3600';
}

/**
 * Serve o front-end compilado (ARQUITETURA §8): arquivos com hash imutáveis, `index.html` sem cache.
 * Devolve `false` (e registra aviso) se a pasta não existir — a API continua funcionando sozinha.
 */
export async function registrarEstatico(app: FastifyInstance, diretorio: string): Promise<boolean> {
  if (!existsSync(join(diretorio, 'index.html'))) {
    app.log.warn({ diretorio }, 'front-end compilado não encontrado; servindo somente a API');
    return false;
  }
  await app.register(fastifyStatic, {
    root: diretorio,
    prefix: '/',
    wildcard: true,
    index: false,
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders(res, caminho) {
      res.setHeader('cache-control', cacheParaArquivo(caminho));
    },
  });
  app.get('/', (_request, reply) => enviarIndex(reply));
  return true;
}

export function enviarIndex(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').sendFile('index.html');
}

/** Rotas de navegação do SPA: GET/HEAD fora da API, sem extensão de arquivo no último segmento. */
export function ehNavegacaoSpa(metodo: string, url: string): boolean {
  if (metodo !== 'GET' && metodo !== 'HEAD') return false;
  const caminho = url.split('?')[0] ?? '';
  if (caminho.startsWith('/api/') || caminho === '/api' || caminho.startsWith('/saude/')) return false;
  const ultimo = caminho.split('/').pop() ?? '';
  return !ultimo.includes('.');
}
