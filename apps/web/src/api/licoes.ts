/**
 * Lições aprendidas da execução (RIA-12): ocorrências registradas pela fiscalização e sugestões de cláusula no DFD,
 * no ETP e no TR. A sugestão é sinal; a decisão do agente vai ao servidor, que registra na trilha.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BaseConhecimentoContrato,
  DocumentoLicao,
  EntradaDecisaoLicao,
  EntradaOcorrenciaExecucao,
  EntradaSolucaoOcorrencia,
  LicoesAprendidasProcesso,
  OcorrenciaExecucao,
} from '@agora/contratos';
import { api } from './cliente';

const CHAVE_OCORRENCIAS = (id: string) => ['contratos', 'detalhe', id, 'ocorrencias-execucao'] as const;

export function useOcorrenciasContrato(id: string) {
  return useQuery({
    queryKey: CHAVE_OCORRENCIAS(id),
    queryFn: ({ signal }) => api.ler<BaseConhecimentoContrato>(`/contratos/${encodeURIComponent(id)}/ocorrencias-execucao`, undefined, signal),
  });
}

export function useRegistrarOcorrencia(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaOcorrenciaExecucao) => api.criar<OcorrenciaExecucao>(`/contratos/${encodeURIComponent(contratoId)}/ocorrencias-execucao`, entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: CHAVE_OCORRENCIAS(contratoId) });
      void cliente.invalidateQueries({ queryKey: ['contratos', 'detalhe', contratoId, 'avaliacoes-desempenho'] });
    },
  });
}

export function useSolucionarOcorrencia(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaSolucaoOcorrencia }) => api.criar<OcorrenciaExecucao>(`/ocorrencias-execucao/${encodeURIComponent(id)}/solucao`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: CHAVE_OCORRENCIAS(contratoId) }),
  });
}

const CHAVE_LICOES = (processoId: string, documento: DocumentoLicao) => ['jornada', 'processo', processoId, 'licoes', documento] as const;

/**
 * Sugestões para o documento. `assinaturaObjeto` (título e itens salvos do DFD) entra na chave: ao salvar o DFD com
 * outro objeto, a consulta é refeita.
 */
export function useLicoesAprendidas(processoId: string, documento: DocumentoLicao, assinaturaObjeto: string) {
  return useQuery({
    queryKey: [...CHAVE_LICOES(processoId, documento), assinaturaObjeto],
    queryFn: ({ signal }) => api.ler<LicoesAprendidasProcesso>(`/processos/${encodeURIComponent(processoId)}/licoes-aprendidas`, { documento }, signal),
  });
}

export function useDecidirLicao(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaDecisaoLicao) => api.criar<LicoesAprendidasProcesso>(`/processos/${encodeURIComponent(processoId)}/licoes-aprendidas/decisoes`, entrada),
    onSuccess: (resposta) => {
      cliente.setQueriesData({ queryKey: CHAVE_LICOES(processoId, resposta.documento) }, resposta);
      void cliente.invalidateQueries({ queryKey: ['processos', 'detalhe', processoId, 'historico'] });
    },
  });
}
