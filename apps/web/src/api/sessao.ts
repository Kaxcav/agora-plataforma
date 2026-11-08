import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfiguracaoPublica, EntradaLogin, EntradaTrocarSenha, Sessao } from '@agora/contratos';
import { ErroApi, requisitar, requisitarSemCorpo } from './cliente';

export const CHAVE_SESSAO = ['sessao'] as const;
export const CHAVE_CONFIGURACAO = ['configuracao-publica'] as const;

/** GET /configuracao-publica — sem autenticação; muda só com nova implantação. */
export function useConfiguracaoPublica() {
  return useQuery({
    queryKey: CHAVE_CONFIGURACAO,
    queryFn: ({ signal }) => requisitar<ConfiguracaoPublica>('/configuracao-publica', { sinal: signal, tratar401: false }),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** GET /sessao → Sessao, ou null quando não há sessão (401). */
export async function lerSessao(sinal?: AbortSignal): Promise<Sessao | null> {
  try {
    return await requisitar<Sessao>('/sessao', { sinal, tratar401: false });
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 401) return null;
    throw erro;
  }
}

export function useConsultaSessao() {
  return useQuery({
    queryKey: CHAVE_SESSAO,
    queryFn: ({ signal }) => lerSessao(signal),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useEntrar() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaLogin) =>
      requisitar<Sessao>('/sessao', { metodo: 'POST', corpo: entrada, tratar401: false }),
    onSuccess: (sessao) => {
      cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_SESSAO[0] && q.queryKey[0] !== CHAVE_CONFIGURACAO[0] });
      cliente.setQueryData(CHAVE_SESSAO, sessao);
    },
  });
}

export function useSair() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => requisitarSemCorpo('/sessao', { metodo: 'DELETE', tratar401: false }),
    onSettled: () => {
      cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_CONFIGURACAO[0] });
      cliente.setQueryData(CHAVE_SESSAO, null);
    },
  });
}

/**
 * POST /sessao/senha → 204. 401 aqui significa "senha atual incorreta" (não sessão expirada).
 * Em seguida a sessão é relida: `deveTrocarSenha` volta a false e o token CSRF pode ter mudado.
 */
export function useTrocarSenha() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaTrocarSenha) => requisitarSemCorpo('/sessao/senha', { metodo: 'POST', corpo: entrada, tratar401: false }),
    onSuccess: () => cliente.refetchQueries({ queryKey: CHAVE_SESSAO }),
  });
}
