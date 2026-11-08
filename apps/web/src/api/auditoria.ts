import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaRevelar,
  EventoAuditoria,
  Pagina,
  ParametrosLista,
  RegistroAcessoDadoPessoal,
  RespostaRevelar,
  VerificacaoAuditoria,
} from '@agora/contratos';
import { api } from './cliente';

/** GET /auditoria?busca&acao&recurso&usuario&de&ate */
export interface FiltroAuditoria extends ParametrosLista {
  acao?: string;
  recurso?: string;
  usuario?: string;
  de?: string;
  ate?: string;
}

export function useAuditoria(filtro: FiltroAuditoria) {
  return useQuery({
    queryKey: ['auditoria', 'trilha', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<EventoAuditoria>>('/auditoria', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** GET /auditoria/verificacao — recalcula a cadeia inteira; só roda quando solicitado. */
export function useVerificacaoAuditoria(solicitada: boolean) {
  return useQuery({
    queryKey: ['auditoria', 'verificacao'],
    queryFn: ({ signal }) => api.ler<VerificacaoAuditoria>('/auditoria/verificacao', undefined, signal),
    enabled: solicitada,
    staleTime: 0,
    gcTime: 60 * 1000,
  });
}

export function useAcessosLgpd(parametros: ParametrosLista) {
  return useQuery({
    queryKey: ['auditoria', 'lgpd', parametros],
    queryFn: ({ signal }) => api.ler<Pagina<RegistroAcessoDadoPessoal>>('/lgpd/acessos', { ...parametros }, signal),
    placeholderData: keepPreviousData,
  });
}

/** POST /lgpd/revelar — o valor revelado fica só no estado do componente, nunca em cache. */
export function useRevelarDadoPessoal() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaRevelar) => api.criar<RespostaRevelar>('/lgpd/revelar', entrada),
    gcTime: 0,
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['auditoria'] }),
  });
}
