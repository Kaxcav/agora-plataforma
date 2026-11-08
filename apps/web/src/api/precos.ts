/**
 * Pesquisa de preços automatizada (RF-25) e projeção do valor estimado (RIA-11). O navegador só fala com a API da
 * Ágora: as fontes oficiais (painel de preços, PNCP, notas fiscais, IBGE, Banco Central) são consultadas pelo servidor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConsultaPrecos,
  EntradaConsultaPrecos,
  EntradaImportacaoReferencias,
  EntradaIncluirSugestoes,
  EntradaProjecaoValor,
  PesquisaPrecosProcesso,
  ProcessoDetalhe,
  ProjecaoValorEstimado,
  ResultadoImportacaoReferencias,
} from '@agora/contratos';
import { api } from './cliente';
import { chaveListaProcessos, chaveProcesso } from './jornada';

const segmento = (id: string) => encodeURIComponent(id);
export const chavePesquisaPrecos = (id: string) => ['processos', 'pesquisa-precos', id] as const;

/** GET /processos/:id/pesquisa-precos */
export function usePesquisaPrecos(id: string) {
  return useQuery({
    queryKey: chavePesquisaPrecos(id),
    queryFn: ({ signal }) => api.ler<PesquisaPrecosProcesso>(`/processos/${segmento(id)}/pesquisa-precos`, undefined, signal),
  });
}

/** POST /processos/:id/pesquisa-precos/consultas — o servidor consulta as fontes e devolve as sugestões. */
export function useConsultarPrecos(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaConsultaPrecos) => api.criar<ConsultaPrecos>(`/processos/${segmento(id)}/pesquisa-precos/consultas`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chavePesquisaPrecos(id) }),
  });
}

/** POST /processos/:id/pesquisa-precos/consultas/:consultaId/incluir — as sugestões escolhidas entram na cesta. */
export function useIncluirSugestoes(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ consultaId, ...entrada }: EntradaIncluirSugestoes & { consultaId: string }) =>
      api.criar<ProcessoDetalhe>(`/processos/${segmento(id)}/pesquisa-precos/consultas/${segmento(consultaId)}/incluir`, entrada),
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(id), processo);
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
      void cliente.invalidateQueries({ queryKey: chavePesquisaPrecos(id) });
    },
  });
}

/** POST /processos/:id/pesquisa-precos/projecao — sinal: não altera o valor estimado. */
export function useProjetarValor(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaProjecaoValor) => api.criar<ProjecaoValorEstimado>(`/processos/${segmento(id)}/pesquisa-precos/projecao`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chavePesquisaPrecos(id) }),
  });
}

/** POST /pesquisa-precos/referencias-engenharia/importacao — tabela oficial do Sinapi ou do Sicro (integracoes:executar). */
export function useImportarReferencias(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaImportacaoReferencias) => api.criar<ResultadoImportacaoReferencias>('/pesquisa-precos/referencias-engenharia/importacao', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: chavePesquisaPrecos(processoId) }),
  });
}
