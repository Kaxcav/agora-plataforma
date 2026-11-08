import { readFileSync } from 'node:fs';

/** Versão do pacote `@agora/api` (mesma profundidade a partir de `src/` e de `dist/`). */
export function lerVersao(): string {
  const conteudo: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof conteudo === 'object' && conteudo !== null && 'version' in conteudo && typeof conteudo.version === 'string') {
    return conteudo.version;
  }
  return '0.0.0';
}
