import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Feriado, GrupoUasg, ModeloGestao, UnidadeInterna } from '@agora/contratos';
import { api } from './cliente';

export type EntradaModeloGestao = Omit<ModeloGestao, 'id'>;

export function useModelosGestao(tipo?: ModeloGestao['tipo']) {
  return useQuery({
    queryKey: ['ajustes', 'modelos', tipo ?? 'todos'],
    queryFn: ({ signal }) => api.ler<ModeloGestao[]>('/modelos-gestao', { tipo }, signal),
  });
}

export function useSalvarModeloGestao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string | null; entrada: EntradaModeloGestao }) =>
      id === null
        ? api.criar<ModeloGestao>('/modelos-gestao', entrada)
        : api.substituir<ModeloGestao>(`/modelos-gestao/${encodeURIComponent(id)}`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ajustes', 'modelos'] }),
  });
}

export function useUnidadesInternas(habilitado = true) {
  return useQuery({
    queryKey: ['ajustes', 'unidades'],
    queryFn: ({ signal }) => api.ler<UnidadeInterna[]>('/unidades-internas', undefined, signal),
    enabled: habilitado,
  });
}

export function useCriarUnidadeInterna() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { sigla: string; nome: string }) => api.criar<UnidadeInterna>('/unidades-internas', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ajustes', 'unidades'] }),
  });
}

export function useAtualizarUnidadeInterna() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: { sigla: string; nome: string; ativa: boolean } }) =>
      api.substituir<UnidadeInterna>(`/unidades-internas/${encodeURIComponent(id)}`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ajustes', 'unidades'] }),
  });
}

export function useGruposUasg() {
  return useQuery({
    queryKey: ['ajustes', 'grupos-uasg'],
    queryFn: ({ signal }) => api.ler<GrupoUasg[]>('/grupos-uasg', undefined, signal),
  });
}

export function useConfirmarGrupoUasg() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.criar<GrupoUasg>(`/grupos-uasg/${encodeURIComponent(id)}/confirmar`),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ajustes', 'grupos-uasg'] }),
  });
}

export function useFeriados(ano: number) {
  return useQuery({
    queryKey: ['ajustes', 'feriados', ano],
    queryFn: ({ signal }) => api.ler<Feriado[]>('/feriados', { ano }, signal),
  });
}

export function useCriarFeriado() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { data: string; nome: string }) => api.criar<Feriado>('/feriados', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['ajustes', 'feriados'] }),
  });
}
