/**
 * Painel das metas do ETP (RF-39): leitura no escopo de UASG decidido pelo servidor, exportação em CSV e
 * configuração das metas pelo órgão (metas:configurar).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfiguracaoMetasEtp, EntradaMetasEtp, PainelMetasEtp } from '@agora/contratos';
import { api, urlApi } from './cliente';

export interface FiltroMetas {
  uasg?: string;
  de?: string;
  ate?: string;
}

export function usePainelMetas(filtro: FiltroMetas) {
  return useQuery({
    queryKey: ['metas-etp', 'painel', filtro],
    queryFn: ({ signal }) => api.ler<PainelMetasEtp>('/metas-etp', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useConfiguracaoMetas(habilitado = true) {
  return useQuery({
    queryKey: ['metas-etp', 'configuracao'],
    queryFn: ({ signal }) => api.ler<ConfiguracaoMetasEtp>('/metas-etp/configuracao', undefined, signal),
    enabled: habilitado,
  });
}

export function useConfigurarMetas() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaMetasEtp) => api.substituir<ConfiguracaoMetasEtp>('/metas-etp/configuracao', entrada),
    onSuccess: (configuracao) => {
      cliente.setQueryData(['metas-etp', 'configuracao'], configuracao);
      void cliente.invalidateQueries({ queryKey: ['metas-etp', 'painel'] });
    },
  });
}

/** Link de download do CSV do painel (gerado no servidor; a exportação fica na trilha). */
export function urlCsvMetas(filtro: FiltroMetas): string {
  return urlApi('/metas-etp/exportar.csv', { ...filtro });
}
