/**
 * Gestão compartilhada com a sociedade (RF-37): consulta pública, envio do cidadão identificado, moderação,
 * respostas, registros da execução e relatório final. Toda decisão de acesso é do servidor.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaManifestacao,
  EntradaModeracao,
  EntradaRelatorioFinal,
  EntradaRespostaManifestacao,
  GestaoCompartilhadaContrato,
  GestaoCompartilhadaPublica,
  ManifestacaoModeracao,
  MinhaManifestacao,
  Pagina,
  RegistroExecucaoInterno,
  RelatorioFinalPublico,
  SituacaoManifestacao,
} from '@agora/contratos';
import { api, enviarArquivo, requisitar } from './cliente';

const segmento = (id: string) => encodeURIComponent(id);

/** GET /publico/contratos/:id/gestao-compartilhada (sem login) */
export function useGestaoPublica(contratoId: string) {
  return useQuery({
    queryKey: ['publico', 'gestao-compartilhada', contratoId],
    queryFn: ({ signal }) =>
      requisitar<GestaoCompartilhadaPublica>(`/publico/contratos/${segmento(contratoId)}/gestao-compartilhada`, { sinal: signal, tratar401: false }),
  });
}

/** GET /sociedade/minhas-manifestacoes */
export function useMinhasManifestacoes(habilitado = true) {
  return useQuery({
    queryKey: ['sociedade', 'minhas'],
    queryFn: ({ signal }) => api.ler<MinhaManifestacao[]>('/sociedade/minhas-manifestacoes', undefined, signal),
    enabled: habilitado,
  });
}

/** POST /sociedade/contratos/:id/manifestacoes e, com imagem, POST /sociedade/manifestacoes/:id/imagem */
export function useEnviarManifestacao(contratoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (e: EntradaManifestacao & { imagem: File | null }): Promise<MinhaManifestacao> => {
      const criada = await api.criar<MinhaManifestacao>(`/sociedade/contratos/${segmento(contratoId)}/manifestacoes`, { assunto: e.assunto, texto: e.texto });
      if (!e.imagem) return criada;
      return enviarArquivo<MinhaManifestacao>(`/sociedade/manifestacoes/${segmento(criada.id)}/imagem`, e.imagem, e.imagem.name);
    },
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: ['sociedade', 'minhas'] });
    },
  });
}

export interface FiltroModeracao {
  situacao: SituacaoManifestacao | undefined;
  pagina: number;
  tamanhoPagina: number;
}

/** GET /sociedade/manifestacoes */
export function useManifestacoesModeracao(filtro: FiltroModeracao) {
  return useQuery({
    queryKey: ['sociedade', 'manifestacoes', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<ManifestacaoModeracao>>('/sociedade/manifestacoes', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** GET /sociedade/contratos/:id */
export function useGestaoContrato(contratoId: string) {
  return useQuery({
    queryKey: ['sociedade', 'contrato', contratoId],
    queryFn: ({ signal }) => api.ler<GestaoCompartilhadaContrato>(`/sociedade/contratos/${segmento(contratoId)}`, undefined, signal),
  });
}

function useInvalidarSociedade() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ['sociedade'] });
    void cliente.invalidateQueries({ queryKey: ['publico', 'gestao-compartilhada'] });
  };
}

/** POST /sociedade/manifestacoes/:id/moderacao */
export function useModerarManifestacao() {
  const invalidar = useInvalidarSociedade();
  return useMutation({
    mutationFn: ({ id, ...entrada }: EntradaModeracao & { id: string }) => api.criar<ManifestacaoModeracao>(`/sociedade/manifestacoes/${segmento(id)}/moderacao`, entrada),
    onSuccess: invalidar,
  });
}

/** POST /sociedade/manifestacoes/:id/respostas */
export function useResponderManifestacao() {
  const invalidar = useInvalidarSociedade();
  return useMutation({
    mutationFn: ({ id, ...entrada }: EntradaRespostaManifestacao & { id: string }) =>
      api.criar<ManifestacaoModeracao>(`/sociedade/manifestacoes/${segmento(id)}/respostas`, entrada),
    onSuccess: invalidar,
  });
}

export interface EntradaRegistroExecucao {
  arquivo: File;
  titulo: string;
  descricao: string;
  registradoEm: string;
  sigiloso: boolean;
}

/** POST /sociedade/contratos/:id/registros (corpo binário) */
export function useEnviarRegistroExecucao(contratoId: string) {
  const invalidar = useInvalidarSociedade();
  return useMutation({
    mutationFn: (e: EntradaRegistroExecucao) =>
      enviarArquivo<RegistroExecucaoInterno>(`/sociedade/contratos/${segmento(contratoId)}/registros`, e.arquivo, e.arquivo.name, {
        titulo: e.titulo,
        descricao: e.descricao,
        registradoEm: e.registradoEm,
        sigiloso: e.sigiloso,
      }),
    onSuccess: invalidar,
  });
}

/** POST /sociedade/contratos/:id/relatorio-final */
export function usePublicarRelatorioFinal(contratoId: string) {
  const invalidar = useInvalidarSociedade();
  return useMutation({
    mutationFn: (e: EntradaRelatorioFinal) => api.criar<RelatorioFinalPublico>(`/sociedade/contratos/${segmento(contratoId)}/relatorio-final`, e),
    onSuccess: invalidar,
  });
}
