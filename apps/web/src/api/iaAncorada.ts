/**
 * IA ancorada (F24): base normativa da Ágora (RNF-08), conferência das citações e IMR-02 (RIA-14), conferência cruzada
 * entre documentos e auditor contínuo da 2ª linha (RIA-15). Tudo é calculado no servidor; o navegador só exibe.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArtigoLeiApi,
  CitacoesDocumento,
  ConferenciaCitacoesApi,
  ConferenciaCruzadaApi,
  ModeloPadronizadoApi,
  PainelAuditorIa,
  PainelQualidadeNormativa,
  ResultadoBuscaNormas,
  ResumoBaseNormativa,
} from '@agora/contratos';
import { api } from './cliente';

export function useResumoBaseNormativa() {
  return useQuery({
    queryKey: ['normas', 'resumo'],
    queryFn: ({ signal }) => api.ler<ResumoBaseNormativa>('/normas', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useModelosPadronizados() {
  return useQuery({
    queryKey: ['normas', 'modelos'],
    queryFn: ({ signal }) => api.ler<ModeloPadronizadoApi[]>('/normas/modelos', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useBuscaNormas(consulta: string) {
  const q = consulta.trim();
  return useQuery({
    queryKey: ['normas', 'busca', q],
    queryFn: ({ signal }) => api.ler<ResultadoBuscaNormas>('/normas/busca', { q }, signal),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useArtigoLei(numero: string | null) {
  return useQuery({
    queryKey: ['normas', 'artigo', numero],
    queryFn: ({ signal }) => api.ler<ArtigoLeiApi>(`/normas/artigos/${encodeURIComponent(numero ?? '')}`, undefined, signal),
    enabled: numero !== null,
  });
}

/** Conferência de um texto colado: leitura, sem gravação (POST pelo tamanho do texto). */
export function useConferirTexto() {
  return useMutation({ mutationFn: (texto: string) => api.criar<ConferenciaCitacoesApi>('/normas/conferir', { texto }) });
}

export function usePainelQualidade(filtro: { mes?: string; uasg?: string }) {
  return useQuery({
    queryKey: ['qualidade-normativa', filtro],
    queryFn: ({ signal }) => api.ler<PainelQualidadeNormativa>('/qualidade-normativa', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** Citações de todos os documentos do processo; `marca` muda quando um documento é gerado ou aprovado. */
export function useCitacoesProcesso(processoId: string, marca = '') {
  return useQuery({
    queryKey: ['ia-ancorada', 'citacoes', processoId, marca],
    queryFn: ({ signal }) => api.ler<CitacoesDocumento[]>(`/processos/${encodeURIComponent(processoId)}/citacoes`, undefined, signal),
  });
}

export function useRevisarCitacoes(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ documentoId, justificativa }: { documentoId: string; justificativa: string }) =>
      api.criar<CitacoesDocumento>(`/processos/${encodeURIComponent(processoId)}/documentos/${encodeURIComponent(documentoId)}/citacoes/revisao`, { justificativa }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['ia-ancorada', 'citacoes', processoId] });
      void cliente.invalidateQueries({ queryKey: ['qualidade-normativa'] });
    },
  });
}

export function useConferenciaCruzada(processoId: string) {
  return useQuery({
    queryKey: ['ia-ancorada', 'cruzada', processoId],
    queryFn: ({ signal }) => api.ler<ConferenciaCruzadaApi>(`/processos/${encodeURIComponent(processoId)}/conferencia-cruzada`, undefined, signal),
  });
}

export function usePainelAuditorIa(uasg: string | undefined) {
  return useQuery({
    queryKey: ['controle', 'auditor-ia', { uasg }],
    queryFn: ({ signal }) => api.ler<PainelAuditorIa>('/controle/auditor-ia', { uasg }, signal),
    placeholderData: keepPreviousData,
  });
}
