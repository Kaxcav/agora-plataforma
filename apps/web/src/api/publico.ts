import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ContratoPublico, EditalPublico, OrdemCronologicaPublicaResposta, Pagina, ParametrosLista } from '@agora/contratos';
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

/** Editais publicados: inteiro teor sem cadastro nem login (art. 25, § 3º). */
export function useEditaisPublicos(parametros: ParametrosLista) {
  return useQuery({
    queryKey: ['publico', 'editais', parametros],
    queryFn: ({ signal }) => requisitar<Pagina<EditalPublico>>('/publico/editais', { parametros: { ...parametros }, sinal: signal, tratar401: false }),
    placeholderData: keepPreviousData,
  });
}

export function useEditalPublico(id: string) {
  return useQuery({
    queryKey: ['publico', 'editais', 'detalhe', id],
    queryFn: ({ signal }) => requisitar<EditalPublico>(`/publico/editais/${encodeURIComponent(id)}`, { sinal: signal, tratar401: false }),
  });
}

export function useContratoPublico(id: string) {
  return useQuery({
    queryKey: ['publico', 'contratos', 'detalhe', id],
    queryFn: ({ signal }) =>
      requisitar<ContratoPublico>(`/publico/contratos/${encodeURIComponent(id)}`, { sinal: signal, tratar401: false }),
  });
}

/** Ordem cronológica dos pagamentos (art. 141, § 3º). */
export function useOrdemCronologicaPublica(mes?: string) {
  return useQuery({
    queryKey: ['publico', 'ordem-cronologica', mes],
    queryFn: ({ signal }) =>
      requisitar<OrdemCronologicaPublicaResposta>('/publico/ordem-cronologica', {
        parametros: mes ? { mes } : {},
        sinal: signal,
        tratar401: false,
      }),
  });
}
