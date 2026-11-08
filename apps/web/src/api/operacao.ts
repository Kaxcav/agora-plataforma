/**
 * Operação da plataforma (RNF-10, IMR-01): situação dos componentes, relatório mensal de disponibilidade, janelas
 * de manutenção do PNCP e sondagem manual. O servidor decide quem vê (operacao:ler) e quem registra.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntradaJanelaManutencao, JanelaManutencaoPncp, RelatorioDisponibilidade, SituacaoOperacao } from '@agora/contratos';
import { api, urlApi } from './cliente';

export function useSituacaoOperacao() {
  return useQuery({
    queryKey: ['operacao', 'situacao'],
    queryFn: ({ signal }) => api.ler<SituacaoOperacao>('/operacao/situacao', undefined, signal),
    refetchInterval: 60_000,
  });
}

export function useRelatorioDisponibilidade(mes: string | undefined) {
  return useQuery({
    queryKey: ['operacao', 'disponibilidade', mes ?? 'atual'],
    queryFn: ({ signal }) => api.ler<RelatorioDisponibilidade>('/operacao/disponibilidade', { mes }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useSondarAgora() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<SituacaoOperacao>('/operacao/sondar'),
    onSuccess: (situacao) => {
      cliente.setQueryData(['operacao', 'situacao'], situacao);
      void cliente.invalidateQueries({ queryKey: ['operacao', 'disponibilidade'] });
    },
  });
}

export function useRegistrarJanela() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaJanelaManutencao) => api.criar<JanelaManutencaoPncp>('/operacao/janelas', entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['operacao', 'disponibilidade'] });
    },
  });
}

/** Link de download do relatório mensal em CSV (a exportação fica na trilha). */
export function urlCsvDisponibilidade(mes: string | undefined): string {
  return urlApi('/operacao/disponibilidade.csv', { mes });
}
