/**
 * Documentos do processo e de habilitação (RF-21), leitura assistida de atestados (RIA-08) e exigências de
 * qualificação técnica (RN-25). O arquivo vai do navegador direto para a API da Ágora; a leitura, o OCR e o
 * antivírus acontecem no servidor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArquivoProcesso,
  ArquivosProcesso,
  CategoriaArquivoProcesso,
  EntradaQualificacaoTecnica,
  QualificacaoTecnica,
  TipoArquivoProcesso,
} from '@agora/contratos';
import { api, baixarArquivoApi, enviarArquivo } from './cliente';

const segmento = (id: string) => encodeURIComponent(id);

export const chaveArquivos = (processoId: string) => ['processos', 'arquivos', processoId] as const;
export const chaveQualificacao = (processoId: string) => ['processos', 'qualificacao-tecnica', processoId] as const;

/** GET /processos/:id/arquivos */
export function useArquivosProcesso(processoId: string) {
  return useQuery({
    queryKey: chaveArquivos(processoId),
    queryFn: ({ signal }) => api.ler<ArquivosProcesso>(`/processos/${segmento(processoId)}/arquivos`, undefined, signal),
  });
}

/** GET /processos/:id/qualificacao-tecnica */
export function useQualificacaoTecnica(processoId: string) {
  return useQuery({
    queryKey: chaveQualificacao(processoId),
    queryFn: ({ signal }) => api.ler<QualificacaoTecnica>(`/processos/${segmento(processoId)}/qualificacao-tecnica`, undefined, signal),
  });
}

function useInvalidarDocumentos(processoId: string) {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: chaveArquivos(processoId) });
    void cliente.invalidateQueries({ queryKey: chaveQualificacao(processoId) });
  };
}

export interface EntradaEnvioArquivo {
  arquivo: File;
  categoria: CategoriaArquivoProcesso;
  tipo: TipoArquivoProcesso;
  titulo: string;
  fornecedorId: string | null;
  contemDadoPessoal: boolean;
  exercicio: number | null;
  dataConstituicao: string | null;
}

/** POST /processos/:id/arquivos (corpo binário) */
export function useEnviarArquivo(processoId: string) {
  const invalidar = useInvalidarDocumentos(processoId);
  return useMutation({
    mutationFn: (e: EntradaEnvioArquivo) =>
      enviarArquivo<ArquivoProcesso>(`/processos/${segmento(processoId)}/arquivos`, e.arquivo, e.arquivo.name, {
        categoria: e.categoria,
        tipo: e.tipo,
        titulo: e.titulo,
        fornecedorId: e.fornecedorId,
        contemDadoPessoal: e.contemDadoPessoal,
        exercicio: e.exercicio,
        dataConstituicao: e.dataConstituicao,
      }),
    onSuccess: invalidar,
  });
}

/** POST /processos/:id/arquivos/:arquivoId/leitura */
export function useLerAtestado(processoId: string) {
  const invalidar = useInvalidarDocumentos(processoId);
  return useMutation({
    mutationFn: (arquivoId: string) => api.criar<ArquivoProcesso>(`/processos/${segmento(processoId)}/arquivos/${segmento(arquivoId)}/leitura`),
    onSuccess: invalidar,
  });
}

/** POST /processos/:id/arquivos/:arquivoId/baixar — salva o arquivo recebido (sem abrir no navegador). */
export function useBaixarArquivo(processoId: string) {
  return useMutation({
    mutationFn: async ({ arquivo, finalidade }: { arquivo: ArquivoProcesso; finalidade: string | null }) => {
      const { conteudo, nome } = await baixarArquivoApi(
        `/processos/${segmento(processoId)}/arquivos/${segmento(arquivo.id)}/baixar`,
        finalidade === null ? {} : { finalidade },
      );
      const url = URL.createObjectURL(conteudo);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = nome ?? arquivo.nomeOriginal;
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      return nome ?? arquivo.nomeOriginal;
    },
  });
}

/** PUT /processos/:id/qualificacao-tecnica */
export function useDefinirQualificacao(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaQualificacaoTecnica) => api.substituir<QualificacaoTecnica>(`/processos/${segmento(processoId)}/qualificacao-tecnica`, entrada),
    onSuccess: (q) => {
      cliente.setQueryData(chaveQualificacao(processoId), q);
      void cliente.invalidateQueries({ queryKey: chaveArquivos(processoId) });
    },
  });
}
