import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FiltroEmpenhos,
  FiltroItens,
  FiltroPagamentos,
  ItemCarteira,
  Pagamento,
  Pagina,
  PaginaEmpenhos,
  PrevisaoPagamentos,
} from '@agora/contratos';
import { api, urlApi } from './cliente';

export function useItens(filtro: FiltroItens) {
  return useQuery({
    queryKey: ['itens', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<ItemCarteira>>('/itens', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** Link de download do CSV (gerado no servidor; o navegador não monta planilhas). */
export function urlExportarItens(filtro: FiltroItens): string {
  const { pagina: _pagina, tamanhoPagina: _tamanho, ...demais } = filtro;
  return urlApi('/itens/exportar.csv', { ...demais });
}

export function useEmpenhos(filtro: FiltroEmpenhos) {
  return useQuery({
    queryKey: ['empenhos', filtro],
    queryFn: ({ signal }) => api.ler<PaginaEmpenhos>('/empenhos', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function usePagamentos(filtro: FiltroPagamentos) {
  return useQuery({
    queryKey: ['pagamentos', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<Pagamento>>('/pagamentos', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** POST /pagamentos/:id/atestar — de 'previsto' para 'atestado' (pagamentos:atestar). */
export function useAtestarPagamento() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.criar<Pagamento>(`/pagamentos/${encodeURIComponent(id)}/atestar`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['pagamentos'] });
      void cliente.invalidateQueries({ queryKey: ['contratos', 'detalhe'] });
      void cliente.invalidateQueries({ queryKey: ['pendencias'] });
    },
  });
}

export function usePrevisaoPagamentos(ano: number) {
  return useQuery({
    queryKey: ['pagamentos', 'previsao', ano],
    queryFn: ({ signal }) => api.ler<PrevisaoPagamentos>('/pagamentos/previsao', { ano }, signal),
    placeholderData: keepPreviousData,
  });
}
