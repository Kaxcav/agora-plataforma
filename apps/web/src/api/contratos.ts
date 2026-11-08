import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Aditivo,
  ContratoDetalhe,
  ContratoResumo,
  Empenho,
  EntradaAtualizarTarefa,
  EntradaSimularAditivo,
  EventoHistorico,
  FiltroContratos,
  ItemContrato,
  Pagamento,
  Pagina,
  ResultadoSimulacaoAditivo,
  Tarefa,
} from '@agora/contratos';
import { api } from './cliente';

const segmento = (id: string) => encodeURIComponent(id);

export function useContratos(filtro: FiltroContratos, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<ContratoResumo>>('/contratos', { ...filtro }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

export function useContrato(id: string) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id],
    queryFn: ({ signal }) => api.ler<ContratoDetalhe>(`/contratos/${segmento(id)}`, undefined, signal),
  });
}

export function useItensContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'itens'],
    queryFn: ({ signal }) => api.ler<ItemContrato[]>(`/contratos/${segmento(id)}/itens`, undefined, signal),
    enabled: habilitado,
  });
}

export function useEmpenhosContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'empenhos'],
    queryFn: ({ signal }) => api.ler<Empenho[]>(`/contratos/${segmento(id)}/empenhos`, undefined, signal),
    enabled: habilitado,
  });
}

export function usePagamentosContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'pagamentos'],
    queryFn: ({ signal }) => api.ler<Pagamento[]>(`/contratos/${segmento(id)}/pagamentos`, undefined, signal),
    enabled: habilitado,
  });
}

export function useTarefasContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['tarefas', 'contrato', id],
    queryFn: ({ signal }) => api.ler<Tarefa[]>(`/contratos/${segmento(id)}/tarefas`, undefined, signal),
    enabled: habilitado,
  });
}

export function useHistoricoContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'historico'],
    queryFn: ({ signal }) => api.ler<EventoHistorico[]>(`/contratos/${segmento(id)}/historico`, undefined, signal),
    enabled: habilitado,
  });
}

export function useAditivosContrato(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'aditivos'],
    queryFn: ({ signal }) => api.ler<Aditivo[]>(`/contratos/${segmento(id)}/aditivos`, undefined, signal),
    enabled: habilitado,
  });
}

/** POST /contratos/:id/aditivos/simular — somente leitura (art. 125). */
export function useSimularAditivo(id: string) {
  return useMutation({
    mutationFn: (entrada: EntradaSimularAditivo) =>
      api.criar<ResultadoSimulacaoAditivo>(`/contratos/${segmento(id)}/aditivos/simular`, entrada),
  });
}

/** PATCH /tarefas/:id — concluir ou reabrir tarefa do plano de gestão. */
export function useAtualizarTarefa() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaAtualizarTarefa }) =>
      api.alterar<Tarefa>(`/tarefas/${segmento(id)}`, entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['tarefas'] });
      void cliente.invalidateQueries({ queryKey: ['pendencias'] });
    },
  });
}
