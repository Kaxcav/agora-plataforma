import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaNotificacao,
  EntradaPreferenciasNotificacao,
  EstadoNotificacoes,
  FiltroNotificacoes,
  LinhaTempoVencimentos,
  NotificacaoDetalhe,
  NotificacaoResumo,
  Pagina,
  PreferenciaNotificacao,
  ResultadoVarreduraNotificacoes,
} from '@agora/contratos';
import { api } from './cliente';

/** GET /notificacoes (escopo de UASG decidido no servidor). */
export function useNotificacoes(filtro: FiltroNotificacoes) {
  return useQuery({
    queryKey: ['notificacoes', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<NotificacaoResumo>>('/notificacoes', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useNotificacao(id: string | null) {
  return useQuery({
    queryKey: ['notificacoes', 'detalhe', id],
    queryFn: ({ signal }) => api.ler<NotificacaoDetalhe>(`/notificacoes/${encodeURIComponent(id ?? '')}`, undefined, signal),
    enabled: id !== null && id !== '',
    // Enquanto houver envio na fila, a situação é atualizada a cada 5 s.
    refetchInterval: (consulta) => ((consulta.state.data?.contagem.pendentes ?? 0) > 0 ? 5000 : false),
  });
}

export function useEstadoNotificacoes() {
  return useQuery({
    queryKey: ['notificacoes', 'canais'],
    queryFn: ({ signal }) => api.ler<EstadoNotificacoes>('/notificacoes/canais', undefined, signal),
  });
}

export function usePreferenciasNotificacao() {
  return useQuery({
    queryKey: ['notificacoes', 'preferencias'],
    queryFn: ({ signal }) => api.ler<PreferenciaNotificacao[]>('/notificacoes/preferencias', undefined, signal),
  });
}

/** Linha do tempo do painel: contratos e atas que vencem nos próximos 120 dias. */
export function useLinhaTempoVencimentos(uasg?: string) {
  return useQuery({
    queryKey: ['vencimentos', { uasg }],
    queryFn: ({ signal }) => api.ler<LinhaTempoVencimentos>('/vencimentos', { uasg }, signal),
    placeholderData: keepPreviousData,
  });
}

function useInvalidarNotificacoes() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
  };
}

export function useDispararNotificacao() {
  const invalidar = useInvalidarNotificacoes();
  return useMutation({
    mutationFn: (entrada: EntradaNotificacao) => api.criar<NotificacaoDetalhe>('/notificacoes', entrada),
    onSuccess: invalidar,
  });
}

export function useReenviarEnvio() {
  const invalidar = useInvalidarNotificacoes();
  return useMutation({
    mutationFn: (envioId: string) => api.criar<NotificacaoDetalhe>(`/notificacoes/envios/${encodeURIComponent(envioId)}/reenviar`),
    onSuccess: invalidar,
  });
}

export function useSalvarPreferencias() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaPreferenciasNotificacao) => api.substituir<PreferenciaNotificacao[]>('/notificacoes/preferencias', entrada),
    onSuccess: (dados) => {
      cliente.setQueryData(['notificacoes', 'preferencias'], dados);
    },
  });
}

export function useExecutarVarredura() {
  const invalidar = useInvalidarNotificacoes();
  return useMutation({
    mutationFn: () => api.criar<ResultadoVarreduraNotificacoes>('/notificacoes/varredura'),
    onSuccess: invalidar,
  });
}
