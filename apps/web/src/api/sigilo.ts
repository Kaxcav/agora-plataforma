/**
 * Sigilo de segurança pública (RN-40, RF-33, RNF-09): classificação, credenciamento, registro de acessos, cofre de
 * anexos e ancoragem da trilha. Toda decisão de acesso é do servidor; o navegador só mostra o que ele liberou.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcessoSigiloRegistrado,
  AncoragemTrilha,
  DocumentoGerado,
  EntradaClassificacaoSigilo,
  EntradaCredencialSigilo,
  Pagina,
  SigiloProcesso,
  SituacaoAncoragens,
  VerificacaoAncoragens,
} from '@agora/contratos';
import { api, baixarArquivoApi, enviarArquivo } from './cliente';
import { chaveProcesso } from './jornada';

const segmento = (id: string) => encodeURIComponent(id);

export const chaveSigilo = (processoId: string) => ['processos', 'sigilo', processoId] as const;
const chaveAcessos = (processoId: string) => ['processos', 'sigilo', processoId, 'acessos'] as const;

/** GET /processos/:id/sigilo */
export function useSigiloProcesso(processoId: string) {
  return useQuery({
    queryKey: chaveSigilo(processoId),
    queryFn: ({ signal }) => api.ler<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo`, undefined, signal),
  });
}

/** GET /processos/:id/sigilo/acessos */
export function useAcessosSigilo(processoId: string, pagina: number, tamanhoPagina = 10) {
  return useQuery({
    queryKey: [...chaveAcessos(processoId), pagina, tamanhoPagina],
    queryFn: ({ signal }) => api.ler<Pagina<AcessoSigiloRegistrado>>(`/processos/${segmento(processoId)}/sigilo/acessos`, { pagina, tamanhoPagina }, signal),
    placeholderData: keepPreviousData,
  });
}

function useAtualizarSigilo(processoId: string) {
  const cliente = useQueryClient();
  return (dados: SigiloProcesso) => {
    cliente.setQueryData(chaveSigilo(processoId), dados);
    void cliente.invalidateQueries({ queryKey: chaveAcessos(processoId) });
    void cliente.invalidateQueries({ queryKey: chaveProcesso(processoId) });
    void cliente.invalidateQueries({ queryKey: ['processos', 'arquivos', processoId] });
  };
}

/** POST /processos/:id/sigilo/classificacoes (classifica ou reclassifica) */
export function useClassificarSigilo(processoId: string) {
  const atualizar = useAtualizarSigilo(processoId);
  return useMutation({
    mutationFn: (entrada: EntradaClassificacaoSigilo) => api.criar<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo/classificacoes`, entrada),
    onSuccess: atualizar,
  });
}

/** POST /processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar */
export function useDesclassificarSigilo(processoId: string) {
  const atualizar = useAtualizarSigilo(processoId);
  return useMutation({
    mutationFn: ({ classificacaoId, motivo }: { classificacaoId: string; motivo: string }) =>
      api.criar<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo/classificacoes/${segmento(classificacaoId)}/desclassificar`, { motivo }),
    onSuccess: atualizar,
  });
}

/** POST /processos/:id/sigilo/credenciais */
export function useCredenciarSigilo(processoId: string) {
  const atualizar = useAtualizarSigilo(processoId);
  return useMutation({
    mutationFn: (entrada: EntradaCredencialSigilo) => api.criar<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo/credenciais`, entrada),
    onSuccess: atualizar,
  });
}

/** POST /processos/:id/sigilo/credenciais/:credencialId/revogar */
export function useRevogarCredencialSigilo(processoId: string) {
  const atualizar = useAtualizarSigilo(processoId);
  return useMutation({
    mutationFn: ({ credencialId, motivo }: { credencialId: string; motivo: string }) =>
      api.criar<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo/credenciais/${segmento(credencialId)}/revogar`, { motivo }),
    onSuccess: atualizar,
  });
}

export interface EntradaAnexoSigiloso {
  arquivo: File;
  titulo: string;
  contemDadoPessoal: boolean;
  classificacao: Omit<EntradaClassificacaoSigilo, 'alvo' | 'documentoTipo' | 'arquivoId' | 'motivoReclassificacao'>;
}

/** POST /processos/:id/sigilo/anexos (corpo binário): o anexo vai direto ao cofre, já classificado. */
export function useEnviarAnexoSigiloso(processoId: string) {
  const atualizar = useAtualizarSigilo(processoId);
  return useMutation({
    mutationFn: (e: EntradaAnexoSigiloso) =>
      enviarArquivo<SigiloProcesso>(`/processos/${segmento(processoId)}/sigilo/anexos`, e.arquivo, e.arquivo.name, {
        titulo: e.titulo,
        contemDadoPessoal: e.contemDadoPessoal,
        tipoSigilo: e.classificacao.tipo,
        grau: e.classificacao.grau,
        hipotese: e.classificacao.hipotese,
        razoes: e.classificacao.razoes,
        dataProducao: e.classificacao.dataProducao,
        prazoFim: e.classificacao.prazoFim,
        eventoFim: e.classificacao.eventoFim,
        autoridadeNome: e.classificacao.autoridade?.nome,
        autoridadeCargo: e.classificacao.autoridade?.cargo,
        autoridadeNivel: e.classificacao.autoridade?.nivel,
        atoDelegacao: e.classificacao.autoridade?.atoDelegacao,
      }),
    onSuccess: atualizar,
  });
}

function salvar(conteudo: Blob, nome: string): void {
  const url = URL.createObjectURL(conteudo);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** POST /processos/:id/sigilo/documentos/:tipo/pdf — PDF com a marcação, registrado com o motivo. */
export function useBaixarPdfMarcado(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async ({ tipo, motivo }: { tipo: DocumentoGerado['tipo']; motivo: string }) => {
      const { conteudo, nome } = await baixarArquivoApi(`/processos/${segmento(processoId)}/sigilo/documentos/${segmento(tipo)}/pdf`, { motivo });
      const final = nome ?? `${tipo}-sigiloso.pdf`;
      salvar(conteudo, final);
      return final;
    },
    onSettled: () => void cliente.invalidateQueries({ queryKey: chaveAcessos(processoId) }),
  });
}

/** POST /processos/:id/sigilo/anexos/:arquivoId/baixar — anexo decifrado do cofre, registrado com o motivo. */
export function useBaixarAnexoCofre(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async ({ arquivoId, motivo }: { arquivoId: string; motivo: string }) => {
      const { conteudo, nome } = await baixarArquivoApi(`/processos/${segmento(processoId)}/sigilo/anexos/${segmento(arquivoId)}/baixar`, { motivo });
      const final = nome ?? 'anexo-sigiloso';
      salvar(conteudo, final);
      return final;
    },
    onSettled: () => void cliente.invalidateQueries({ queryKey: chaveAcessos(processoId) }),
  });
}

// ───────── carimbo de tempo da trilha ─────────

/** GET /auditoria/ancoragens */
export function useAncoragens() {
  return useQuery({
    queryKey: ['auditoria', 'ancoragens'],
    queryFn: ({ signal }) => api.ler<SituacaoAncoragens>('/auditoria/ancoragens', undefined, signal),
  });
}

/** GET /auditoria/ancoragens/verificacao — só roda quando solicitada. */
export function useVerificacaoAncoragens(solicitada: number) {
  return useQuery({
    queryKey: ['auditoria', 'ancoragens', 'verificacao', solicitada],
    queryFn: ({ signal }) => api.ler<VerificacaoAncoragens>('/auditoria/ancoragens/verificacao', undefined, signal),
    enabled: solicitada > 0,
    staleTime: 0,
    gcTime: 60 * 1000,
  });
}

/** POST /auditoria/ancoragens */
export function useAncorarTrilha() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<AncoragemTrilha>('/auditoria/ancoragens'),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['auditoria'] });
    },
  });
}
