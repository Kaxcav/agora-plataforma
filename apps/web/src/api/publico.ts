import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ContratoPublico, Pagina, ParametrosLista } from '@agora/contratos';
import { requisitar } from './cliente';

/** Transparência: rotas públicas, sem sessão (401 aqui não redireciona). */
export function useContratosPublicos(parametros: ParametrosLista) {
  return useQuery({
    queryKey: ['publico', 'contratos', parametros],
    queryFn: ({ signal }) =>
      requisitar<Pagina<ContratoPublico>>('/publico/contratos', { parametros: { ...parametros }, sinal: signal, tratar401: false }),
    placeholderData: keepPreviousData,
  });
}

export function useContratoPublico(id: string) {
  return useQuery({
    queryKey: ['publico', 'contratos', 'detalhe', id],
    queryFn: ({ signal }) =>
      requisitar<ContratoPublico>(`/publico/contratos/${encodeURIComponent(id)}`, { sinal: signal, tratar401: false }),
  });
}
