import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntradaResolverPendencia, FiltroPendencias, Pagina, Painel, Pendencia } from '@agora/contratos';
import { api } from './cliente';

export function usePainel(uasg?: string) {
  return useQuery({
    queryKey: ['painel', { uasg }],
    queryFn: ({ signal }) => api.ler<Painel>('/painel', { uasg }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePendencias(filtro: FiltroPendencias) {
  return useQuery({
    queryKey: ['pendencias', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<Pendencia>>('/pendencias', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

function useInvalidarPendencias() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ['pendencias'] });
    void cliente.invalidateQueries({ queryKey: ['painel'] });
  };
}

export function useResolverPendencia() {
  const invalidar = useInvalidarPendencias();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaResolverPendencia }) =>
      api.criar<Pendencia>(`/pendencias/${encodeURIComponent(id)}/resolver`, entrada),
    onSuccess: invalidar,
  });
}

/** Desfaz a resolução (POST /pendencias/:id/reabrir). */
export function useReabrirPendencia() {
  const invalidar = useInvalidarPendencias();
  return useMutation({
    mutationFn: (id: string) => api.criar<Pendencia>(`/pendencias/${encodeURIComponent(id)}/reabrir`),
    onSuccess: invalidar,
  });
}
