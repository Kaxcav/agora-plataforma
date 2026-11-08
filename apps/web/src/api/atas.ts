import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  AtaAMontar,
  AtaDetalhe,
  AtaResumo,
  ContratoResumo,
  EventoHistorico,
  FiltroAtas,
  InfoReajuste,
  ItemAta,
  Pagina,
  ParametrosLista,
  Tarefa,
} from '@agora/contratos';
import { api } from './cliente';

const segmento = (id: string) => encodeURIComponent(id);

export function useAtas(filtro: FiltroAtas) {
  return useQuery({
    queryKey: ['atas', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<AtaResumo>>('/atas', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAtasAMontar(parametros: ParametrosLista, habilitado = true) {
  return useQuery({
    queryKey: ['atas', 'a-montar', parametros],
    queryFn: ({ signal }) => api.ler<Pagina<AtaAMontar>>('/atas/a-montar', { ...parametros }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

export function useAta(id: string) {
  return useQuery({
    queryKey: ['atas', 'detalhe', id],
    queryFn: ({ signal }) => api.ler<AtaDetalhe>(`/atas/${segmento(id)}`, undefined, signal),
  });
}

export function useItensAta(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['atas', 'detalhe', id, 'itens'],
    queryFn: ({ signal }) => api.ler<ItemAta[]>(`/atas/${segmento(id)}/itens`, undefined, signal),
    enabled: habilitado,
  });
}

export function useContratosDaAta(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['atas', 'detalhe', id, 'contratos'],
    queryFn: ({ signal }) => api.ler<ContratoResumo[]>(`/atas/${segmento(id)}/contratos`, undefined, signal),
    enabled: habilitado,
  });
}

export function useTarefasAta(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['tarefas', 'ata', id],
    queryFn: ({ signal }) => api.ler<Tarefa[]>(`/atas/${segmento(id)}/tarefas`, undefined, signal),
    enabled: habilitado,
  });
}

export function useHistoricoAta(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['atas', 'detalhe', id, 'historico'],
    queryFn: ({ signal }) => api.ler<EventoHistorico[]>(`/atas/${segmento(id)}/historico`, undefined, signal),
    enabled: habilitado,
  });
}

export function useReajusteAta(id: string, habilitado = true) {
  return useQuery({
    queryKey: ['atas', 'detalhe', id, 'reajuste'],
    queryFn: ({ signal }) => api.ler<InfoReajuste>(`/atas/${segmento(id)}/reajuste`, undefined, signal),
    enabled: habilitado,
  });
}
