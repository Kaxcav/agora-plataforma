import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaUsuario,
  FonteDados,
  Pagina,
  ParametrosLista,
  PerfilAcesso,
  RespostaSenhaTemporaria,
  Sincronizacao,
  UsuarioAdmin,
} from '@agora/contratos';
import { api } from './cliente';

export function useUsuarios(parametros: ParametrosLista) {
  return useQuery({
    queryKey: ['admin', 'usuarios', parametros],
    queryFn: ({ signal }) => api.ler<Pagina<UsuarioAdmin>>('/usuarios', { ...parametros }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCriarUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaUsuario) => api.criar<UsuarioAdmin>('/usuarios', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}

export type AlteracaoUsuario = Partial<EntradaUsuario & { ativo: boolean }>;

export function useAtualizarUsuario() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, alteracao }: { id: string; alteracao: AlteracaoUsuario }) =>
      api.alterar<UsuarioAdmin>(`/usuarios/${encodeURIComponent(id)}`, alteracao),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}

/**
 * POST /usuarios/:id/senha-temporaria — a senha volta uma única vez. `gcTime: 0` descarta o resultado da
 * memória do cliente assim que o diálogo é fechado (`reset`); nada é gravado em cache ou storage.
 */
export function useGerarSenhaTemporaria() {
  return useMutation({
    mutationFn: (id: string) => api.criar<RespostaSenhaTemporaria>(`/usuarios/${encodeURIComponent(id)}/senha-temporaria`),
    gcTime: 0,
  });
}

export function usePerfis() {
  return useQuery({
    queryKey: ['admin', 'perfis'],
    queryFn: ({ signal }) => api.ler<PerfilAcesso[]>('/perfis', undefined, signal),
    staleTime: 10 * 60 * 1000,
  });
}

export function useSincronizacoes() {
  return useQuery({
    queryKey: ['admin', 'sincronizacoes'],
    queryFn: ({ signal }) => api.ler<Sincronizacao[]>('/sincronizacoes', undefined, signal),
    refetchInterval: (consulta) => (consulta.state.data?.some((s) => s.situacao === 'executando') ? 5000 : false),
  });
}

export function useExecutarSincronizacao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (fonte: FonteDados) => api.criar<Sincronizacao>(`/sincronizacoes/${encodeURIComponent(fonte)}/executar`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['admin', 'sincronizacoes'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}
