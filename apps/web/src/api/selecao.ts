/**
 * Atos da seleção (etapa 6), critérios de sustentabilidade e política do órgão. Toda mutação de processo devolve o
 * `ProcessoDetalhe` atualizado, que substitui o cache do detalhe; a ordem dos atos e os prazos são decididos no servidor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaAtoAutoridade,
  EntradaDecisaoRecursal,
  EntradaHabilitacao,
  EntradaManifestacaoRecursal,
  EntradaPoliticaSustentabilidade,
  EntradaResultadoProvaConceito,
  EntradaSustentabilidade,
  PoliticaSustentabilidade,
  ProcessoDetalhe,
} from '@agora/contratos';
import { api } from './cliente';
import { chaveListaProcessos, chaveProcesso } from './jornada';

const caminho = (id: string, sufixo: string) => `/processos/${encodeURIComponent(id)}/${sufixo}`;

/** Mutação de processo: grava a resposta no cache do detalhe e invalida a lista e, se indicado, a área pública. */
function useAtoProcesso<E>(id: string, executar: (entrada: E) => Promise<ProcessoDetalhe>, invalidarPublico = false) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(id), processo);
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
      if (invalidarPublico) void cliente.invalidateQueries({ queryKey: ['publico'] });
    },
  });
}

/** POST /processos/:id/selecao/prova-conceito/convocacao (RN-20) */
export function useConvocarProvaConceito(id: string) {
  return useAtoProcesso<void>(id, () => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/prova-conceito/convocacao')));
}

/** POST /processos/:id/selecao/prova-conceito/resultado — reprovado convoca o próximo colocado (RN-20). */
export function useResultadoProvaConceito(id: string) {
  return useAtoProcesso(id, (entrada: EntradaResultadoProvaConceito) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/prova-conceito/resultado'), entrada));
}

/** POST /processos/:id/selecao/habilitacao */
export function useRegistrarHabilitacao(id: string) {
  return useAtoProcesso(id, (entrada: EntradaHabilitacao) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/habilitacao'), entrada));
}

/** POST /processos/:id/selecao/recurso/manifestacao — intenção, razões ou contrarrazões (RN-22). */
export function useManifestacaoRecursal(id: string) {
  return useAtoProcesso(id, (entrada: EntradaManifestacaoRecursal) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/recurso/manifestacao'), entrada));
}

/** POST /processos/:id/selecao/recurso/encerrar-intencao */
export function useEncerrarIntencao(id: string) {
  return useAtoProcesso<void>(id, () => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/recurso/encerrar-intencao')));
}

/** POST /processos/:id/selecao/recurso/reconsideracao (quem praticou o ato) */
export function useReconsideracao(id: string) {
  return useAtoProcesso(id, (entrada: EntradaDecisaoRecursal<'reconsiderada' | 'mantida'>) =>
    api.criar<ProcessoDetalhe>(caminho(id, 'selecao/recurso/reconsideracao'), entrada),
  );
}

/** POST /processos/:id/selecao/recurso/decisao (autoridade superior designada) */
export function useDecisaoRecurso(id: string) {
  return useAtoProcesso(id, (entrada: EntradaDecisaoRecursal<'provido' | 'nao_provido'>) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/recurso/decisao'), entrada));
}

/** POST /processos/:id/selecao/adjudicacao (autoridade competente designada; art. 71) */
export function useAdjudicar(id: string) {
  return useAtoProcesso(id, (entrada: EntradaAtoAutoridade) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/adjudicacao'), entrada));
}

/** POST /processos/:id/selecao/homologacao — divulga os documentos preparatórios (art. 54, § 3º). */
export function useHomologar(id: string) {
  return useAtoProcesso(id, (entrada: EntradaAtoAutoridade) => api.criar<ProcessoDetalhe>(caminho(id, 'selecao/homologacao'), entrada), true);
}

/** PUT /processos/:id/sustentabilidade (RN-21; até a etapa 4) */
export function useSalvarSustentabilidade(id: string) {
  return useAtoProcesso(id, (entrada: EntradaSustentabilidade) => api.substituir<ProcessoDetalhe>(caminho(id, 'sustentabilidade'), entrada));
}

const chavePolitica = ['ajustes', 'politicas', 'sustentabilidade'] as const;

/** GET /politicas-orgao/sustentabilidade */
export function usePoliticaSustentabilidade() {
  return useQuery({
    queryKey: chavePolitica,
    queryFn: ({ signal }) => api.ler<PoliticaSustentabilidade>('/politicas-orgao/sustentabilidade', undefined, signal),
  });
}

/** PUT /politicas-orgao/sustentabilidade (ajustes:editar) — os processos passam a refletir a nova política. */
export function useAlterarPoliticaSustentabilidade() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaPoliticaSustentabilidade) => api.substituir<PoliticaSustentabilidade>('/politicas-orgao/sustentabilidade', entrada),
    onSuccess: (politica) => {
      cliente.setQueryData(chavePolitica, politica);
      void cliente.invalidateQueries({ queryKey: ['processos'] });
    },
  });
}
