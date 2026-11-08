/**
 * Avaliação de desempenho do contratado, registro cadastral de desempenho, certificado e simulador (RN-37, RF-30).
 * O servidor decide quem avalia (gestor ou fiscal designado) e calcula a nota; o navegador só exibe.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvaliacaoDesempenho,
  AvaliacoesContrato,
  CertificadoDesempenho,
  CriterioDesempenhoEdital,
  EntradaAnaliseAvaliacao,
  EntradaAvaliacaoDesempenho,
  EntradaCertificadoDesempenho,
  EntradaCriterioDesempenhoEdital,
  EntradaManifestacaoAvaliacao,
  EntradaSimulacaoDesempenho,
  NotaRegistroDesempenho,
  PreviaAvaliacaoDesempenho,
  RegistroDesempenhoFornecedor,
  ResultadoSimulacaoDesempenho,
} from '@agora/contratos';
import { api, urlApi } from './cliente';

const CHAVE_CONTRATO = (id: string) => ['contratos', 'detalhe', id, 'avaliacoes-desempenho'] as const;

export function useAvaliacoesContrato(id: string) {
  return useQuery({
    queryKey: CHAVE_CONTRATO(id),
    queryFn: ({ signal }) => api.ler<AvaliacoesContrato>(`/contratos/${encodeURIComponent(id)}/avaliacoes-desempenho`, undefined, signal),
  });
}

export function usePreviaAvaliacao(id: string, periodo: { periodoInicio: string; periodoFim: string } | null) {
  return useQuery({
    queryKey: [...CHAVE_CONTRATO(id), 'previa', periodo],
    queryFn: ({ signal }) => api.ler<PreviaAvaliacaoDesempenho>(`/contratos/${encodeURIComponent(id)}/avaliacoes-desempenho/previa`, { ...periodo }, signal),
    enabled: periodo !== null,
  });
}

function useInvalidarDesempenho(contratoId: string) {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: CHAVE_CONTRATO(contratoId) });
    void cliente.invalidateQueries({ queryKey: ['desempenho'] });
    void cliente.invalidateQueries({ queryKey: ['fornecedores'] });
    void cliente.invalidateQueries({ queryKey: ['contratos', 'detalhe', contratoId, 'historico'] });
  };
}

export function useEmitirAvaliacao(contratoId: string) {
  const invalidar = useInvalidarDesempenho(contratoId);
  return useMutation({
    mutationFn: (entrada: EntradaAvaliacaoDesempenho) => api.criar<AvaliacaoDesempenho>(`/contratos/${encodeURIComponent(contratoId)}/avaliacoes-desempenho`, entrada),
    onSuccess: invalidar,
  });
}

export function useRegistrarManifestacao(contratoId: string) {
  const invalidar = useInvalidarDesempenho(contratoId);
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaManifestacaoAvaliacao }) =>
      api.criar<AvaliacaoDesempenho>(`/avaliacoes-desempenho/${encodeURIComponent(id)}/manifestacao`, entrada),
    onSuccess: invalidar,
  });
}

export function useAnalisarManifestacao(contratoId: string) {
  const invalidar = useInvalidarDesempenho(contratoId);
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaAnaliseAvaliacao }) => api.criar<AvaliacaoDesempenho>(`/avaliacoes-desempenho/${encodeURIComponent(id)}/analise`, entrada),
    onSuccess: invalidar,
  });
}

export function urlDocumentoAvaliacao(id: string): string {
  return urlApi(`/avaliacoes-desempenho/${encodeURIComponent(id)}/documento.pdf`);
}

export function useRegistroDesempenho(fornecedorId: string) {
  return useQuery({
    queryKey: ['desempenho', 'fornecedor', fornecedorId],
    queryFn: ({ signal }) => api.ler<RegistroDesempenhoFornecedor>(`/fornecedores/${encodeURIComponent(fornecedorId)}/desempenho`, undefined, signal),
  });
}

export function useEmitirCertificado(fornecedorId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCertificadoDesempenho) => api.criar<CertificadoDesempenho>(`/fornecedores/${encodeURIComponent(fornecedorId)}/certificados-desempenho`, entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['desempenho', 'fornecedor', fornecedorId] }),
  });
}

export function urlDocumentoCertificado(id: string): string {
  return urlApi(`/certificados-desempenho/${encodeURIComponent(id)}/documento.pdf`);
}

/** Notas do registro dos fornecedores informados (desempate do art. 60, II). */
export function useNotasRegistro(fornecedorIds: readonly string[]) {
  const ids = [...new Set(fornecedorIds)].sort();
  return useQuery({
    queryKey: ['desempenho', 'notas', ids],
    queryFn: ({ signal }) => api.ler<NotaRegistroDesempenho[]>('/desempenho/notas', { fornecedores: ids.join(',') }, signal),
    enabled: ids.length > 0,
  });
}

export function useRankingDesempenho() {
  return useQuery({
    queryKey: ['desempenho', 'ranking'],
    queryFn: ({ signal }) => api.ler<NotaRegistroDesempenho[]>('/desempenho/ranking', undefined, signal),
  });
}

export function useSimularDesempenho() {
  return useMutation({
    mutationFn: (entrada: EntradaSimulacaoDesempenho) => api.criar<ResultadoSimulacaoDesempenho>('/desempenho/simulacao', entrada),
  });
}

export function useCriterioDesempenho(processoId: string) {
  return useQuery({
    queryKey: ['jornada', 'processo', processoId, 'criterio-desempenho'],
    queryFn: ({ signal }) => api.ler<CriterioDesempenhoEdital>(`/processos/${encodeURIComponent(processoId)}/criterio-desempenho`, undefined, signal),
  });
}

export function useSalvarCriterioDesempenho(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCriterioDesempenhoEdital) => api.substituir<CriterioDesempenhoEdital>(`/processos/${encodeURIComponent(processoId)}/criterio-desempenho`, entrada),
    onSuccess: (criterio) => cliente.setQueryData(['jornada', 'processo', processoId, 'criterio-desempenho'], criterio),
  });
}
