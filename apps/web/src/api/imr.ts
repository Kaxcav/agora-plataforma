/**
 * F7 — IMR do contrato (RF-29) e conferência da nota fiscal (RN-36). O navegador só fala com /api/v1; o servidor
 * calcula resultado, glosa e valor devido e decide se o atesto está liberado.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ContextoConferenciaNota,
  EntradaConferenciaNota,
  EntradaEncerrarIndicadorImr,
  EntradaIndicadorImr,
  EntradaJustificativaConferencia,
  EntradaMedicaoImr,
  ImrContrato,
  RespostaMedicaoImr,
} from '@agora/contratos';
import { api } from './cliente';

const CHAVE_IMR = 'imr';
const CHAVE_CONFERENCIA = 'conferencia-nota';

function invalidarExecucao(cliente: QueryClient): void {
  void cliente.invalidateQueries({ queryKey: [CHAVE_IMR] });
  void cliente.invalidateQueries({ queryKey: [CHAVE_CONFERENCIA] });
  void cliente.invalidateQueries({ queryKey: ['pagamentos'] });
  void cliente.invalidateQueries({ queryKey: ['contratos', 'detalhe'] });
  void cliente.invalidateQueries({ queryKey: ['tarefas'] });
  void cliente.invalidateQueries({ queryKey: ['pendencias'] });
}

/** GET /contratos/:id/imr — indicadores, medições e competências do IMR. */
export function useImrContrato(id: string) {
  return useQuery({
    queryKey: [CHAVE_IMR, id],
    queryFn: ({ signal }) => api.ler<ImrContrato>(`/contratos/${encodeURIComponent(id)}/imr`, undefined, signal),
  });
}

/** POST /contratos/:id/imr/indicadores (imr:configurar). */
export function useIncluirIndicadorImr(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaIndicadorImr) => api.criar<ImrContrato>(`/contratos/${encodeURIComponent(contratoId)}/imr/indicadores`, entrada),
    onSuccess: () => invalidarExecucao(cliente),
  });
}

/** PUT /contratos/:id/imr/indicadores/:indicadorId (imr:configurar; só sem medições). */
export function useAlterarIndicadorImr(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ indicadorId, entrada }: { indicadorId: string; entrada: EntradaIndicadorImr }) =>
      api.substituir<ImrContrato>(`/contratos/${encodeURIComponent(contratoId)}/imr/indicadores/${encodeURIComponent(indicadorId)}`, entrada),
    onSuccess: () => invalidarExecucao(cliente),
  });
}

/** POST /contratos/:id/imr/indicadores/:indicadorId/encerrar (imr:configurar). */
export function useEncerrarIndicadorImr(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ indicadorId, entrada }: { indicadorId: string; entrada: EntradaEncerrarIndicadorImr }) =>
      api.criar<ImrContrato>(`/contratos/${encodeURIComponent(contratoId)}/imr/indicadores/${encodeURIComponent(indicadorId)}/encerrar`, entrada),
    onSuccess: () => invalidarExecucao(cliente),
  });
}

/** POST /contratos/:id/imr/medicoes (imr:medir). */
export function useRegistrarMedicaoImr(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaMedicaoImr) => api.criar<RespostaMedicaoImr>(`/contratos/${encodeURIComponent(contratoId)}/imr/medicoes`, entrada),
    onSuccess: () => invalidarExecucao(cliente),
  });
}

/** GET /pagamentos/:id/conferencia — nota conferida, valor devido e situação do atesto. */
export function useConferenciaNota(pagamentoId: string | null) {
  return useQuery({
    queryKey: [CHAVE_CONFERENCIA, pagamentoId],
    queryFn: ({ signal }) => api.ler<ContextoConferenciaNota>(`/pagamentos/${encodeURIComponent(pagamentoId ?? '')}/conferencia`, undefined, signal),
    enabled: pagamentoId !== null,
  });
}

/** POST /pagamentos/:id/conferencia (pagamentos:conferir) — registra ou corrige a nota. */
export function useRegistrarConferencia(pagamentoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaConferenciaNota) => api.criar<ContextoConferenciaNota>(`/pagamentos/${encodeURIComponent(pagamentoId)}/conferencia`, entrada),
    onSuccess: (dados) => {
      cliente.setQueryData([CHAVE_CONFERENCIA, pagamentoId], dados);
      invalidarExecucao(cliente);
    },
  });
}

/** POST /pagamentos/:id/conferencia/justificativa (pagamentos:conferir). */
export function useJustificarConferencia(pagamentoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaJustificativaConferencia) =>
      api.criar<ContextoConferenciaNota>(`/pagamentos/${encodeURIComponent(pagamentoId)}/conferencia/justificativa`, entrada),
    onSuccess: (dados) => {
      cliente.setQueryData([CHAVE_CONFERENCIA, pagamentoId], dados);
      invalidarExecucao(cliente);
    },
  });
}
