/**
 * Filtros, ordenação e página ficam na URL (`useSearchParams`) para que todo link seja compartilhável.
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type ValorUrl = string | number | boolean | undefined | null;

export const TAMANHOS_PAGINA = [10, 25, 50, 100] as const;
export const TAMANHO_PAGINA_PADRAO = 25;

export interface OrdenacaoUrl {
  por: string;
  ordem: 'asc' | 'desc';
}

/**
 * @param prefixo Separa conjuntos de filtros na mesma URL (ex.: duas abas com listas diferentes):
 *   com prefixo 'm', a busca vira `mbusca` e a página `mpagina`.
 */
export function useParametrosUrl(prefixo = '') {
  const [params, definirParams] = useSearchParams();
  const k = useCallback((chave: string) => `${prefixo}${chave}`, [prefixo]);

  const texto = useCallback(
    (chave: string): string | undefined => {
      const v = params.get(k(chave));
      return v === null || v.trim() === '' ? undefined : v;
    },
    [params, k],
  );

  const opcao = useCallback(
    <T extends string>(chave: string, opcoes: readonly T[]): T | undefined => {
      const v = params.get(k(chave));
      return opcoes.find((o) => o === v);
    },
    [params, k],
  );

  const numero = useCallback(
    (chave: string): number | undefined => {
      const v = params.get(k(chave));
      if (v === null || v === '') return undefined;
      const n = Number(v);
      return Number.isInteger(n) && n > 0 ? n : undefined;
    },
    [params, k],
  );

  const booleano = useCallback(
    (chave: string): boolean | undefined => {
      const v = params.get(k(chave));
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    },
    [params, k],
  );

  const atualizar = useCallback(
    (mudancas: Record<string, ValorUrl>, opcoes?: { manterPagina?: boolean }) => {
      definirParams(
        (anterior) => {
          const novo = new URLSearchParams(anterior);
          for (const [chave, valor] of Object.entries(mudancas)) {
            if (valor === undefined || valor === null || valor === '' || valor === false) novo.delete(k(chave));
            else novo.set(k(chave), String(valor));
          }
          if (!opcoes?.manterPagina && !('pagina' in mudancas)) novo.delete(k('pagina'));
          return novo;
        },
        { replace: true },
      );
    },
    [definirParams, k],
  );

  const limpar = useCallback(
    (chaves: readonly string[]) => {
      definirParams(
        (anterior) => {
          const novo = new URLSearchParams(anterior);
          for (const chave of chaves) novo.delete(k(chave));
          novo.delete(k('pagina'));
          return novo;
        },
        { replace: true },
      );
    },
    [definirParams, k],
  );

  const algumAtivo = useCallback((chaves: readonly string[]) => chaves.some((c) => params.has(k(c))), [params, k]);

  const pagina = numero('pagina') ?? 1;
  const tamanhoBruto = numero('tamanhoPagina');
  const tamanhoPagina = TAMANHOS_PAGINA.find((t) => t === tamanhoBruto) ?? TAMANHO_PAGINA_PADRAO;

  const ordenacao = useMemo((): OrdenacaoUrl | undefined => {
    const por = params.get(k('ordenarPor'));
    if (!por) return undefined;
    return { por, ordem: params.get(k('ordem')) === 'desc' ? 'desc' : 'asc' };
  }, [params, k]);

  const definirOrdenacao = useCallback(
    (o: OrdenacaoUrl) => atualizar({ ordenarPor: o.por, ordem: o.ordem }),
    [atualizar],
  );

  const definirPagina = useCallback((p: number) => atualizar({ pagina: p > 1 ? p : undefined }, { manterPagina: true }), [atualizar]);

  const definirTamanhoPagina = useCallback(
    (t: number) => atualizar({ tamanhoPagina: t === TAMANHO_PAGINA_PADRAO ? undefined : t, pagina: undefined }),
    [atualizar],
  );

  return {
    params,
    texto,
    opcao,
    numero,
    booleano,
    atualizar,
    limpar,
    algumAtivo,
    pagina,
    tamanhoPagina,
    ordenacao,
    definirOrdenacao,
    definirPagina,
    definirTamanhoPagina,
  };
}
