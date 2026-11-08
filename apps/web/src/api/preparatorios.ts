/**
 * Fase preparatória (frente P): dotação orçamentária (RN-39), checklist das peças (RF-32) e PDF dos documentos.
 * As consultas usam a data de atualização do processo na chave: gerar, aprovar ou assinar um documento atualiza o
 * processo e, com ele, a dotação e o checklist exibidos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChecklistDocumentosProcesso, DotacaoProcesso, EntradaDotacao } from '@agora/contratos';
import { api, urlApi } from './cliente';
import { chaveListaProcessos, chaveProcesso } from './jornada';

const caminho = (id: string, sufixo: string) => `/processos/${encodeURIComponent(id)}/${sufixo}`;

/** GET /processos/:id/dotacao */
export function useDotacao(id: string, versaoProcesso: string) {
  return useQuery({
    queryKey: ['processos', 'dotacao', id, versaoProcesso],
    queryFn: ({ signal }) => api.ler<DotacaoProcesso>(caminho(id, 'dotacao'), undefined, signal),
  });
}

/** PUT /processos/:id/dotacao — a dotação muda os bloqueios do processo (RN-39): o detalhe é recarregado. */
export function useSalvarDotacao(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaDotacao) => api.substituir<DotacaoProcesso>(caminho(id, 'dotacao'), entrada),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: chaveProcesso(id) });
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
    },
  });
}

/** GET /processos/:id/checklist-documentos */
export function useChecklistDocumentos(id: string, versaoProcesso: string) {
  return useQuery({
    queryKey: ['processos', 'checklist-documentos', id, versaoProcesso],
    queryFn: ({ signal }) => api.ler<ChecklistDocumentosProcesso>(caminho(id, 'checklist-documentos'), undefined, signal),
  });
}

/** PDF de uma versão de documento, gerado no servidor. */
export function urlPdfDocumento(processoId: string, documentoId: string): string {
  return urlApi(caminho(processoId, `documentos/${encodeURIComponent(documentoId)}/pdf`));
}
