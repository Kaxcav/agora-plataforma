/**
 * Planejamento das contratações: plano de contratações anual (RF-31), conferência do DFD com o PCA, catálogo
 * CATMAT/CATSER (RIA-13) e intenções de registro de preços (RN-38). O navegador fala só com a API da Ágora: as
 * consultas ao PNCP e ao catálogo oficial são feitas pelo servidor, que decide perfil e escopo de UASG.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConsultaCatalogo,
  EntradaAdesaoIrp,
  EntradaDemandaPca,
  EntradaDevolucaoPca,
  EntradaEscolhaCatalogo,
  EntradaIrp,
  EntradaPlanoContratacoes,
  EntradaVinculoPca,
  IntencaoRegistroPrecos,
  PlanejamentoDfd,
  PlanoContratacoesDetalhe,
  ProcessoDetalhe,
  ResumoPlanoContratacoes,
  SugestoesCatalogo,
  TipoItemCatalogo,
} from '@agora/contratos';
import { api, requisitar } from './cliente';
import { chaveListaProcessos, chaveProcesso } from './jornada';

const segmento = (id: string) => encodeURIComponent(id);

// ───────────────────────── PCA ─────────────────────────

export function usePlanosContratacoes(filtro: { ano?: number; uasg?: string }) {
  return useQuery({
    queryKey: ['pca', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<ResumoPlanoContratacoes[]>('/pca', { ...filtro }, signal),
  });
}

export function usePlanoContratacoes(id: string | null) {
  return useQuery({
    queryKey: ['pca', 'detalhe', id],
    queryFn: ({ signal }) => api.ler<PlanoContratacoesDetalhe>(`/pca/${segmento(id ?? '')}`, undefined, signal),
    enabled: id !== null,
  });
}

function useMutacaoPlano<E>(executar: (entrada: E) => Promise<PlanoContratacoesDetalhe>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (plano) => {
      cliente.setQueryData(['pca', 'detalhe', plano.id], plano);
      void cliente.invalidateQueries({ queryKey: ['pca', 'lista'] });
      // Itens publicados e sinais do DFD mudam com a publicação.
      void cliente.invalidateQueries({ queryKey: ['processos'] });
    },
  });
}

export function useCriarPlano() {
  return useMutacaoPlano((entrada: EntradaPlanoContratacoes) => api.criar<PlanoContratacoesDetalhe>('/pca', entrada));
}

export function useRegistrarDemanda(planoId: string) {
  return useMutacaoPlano((entrada: EntradaDemandaPca) => api.criar<PlanoContratacoesDetalhe>(`/pca/${segmento(planoId)}/demandas`, entrada));
}

export function useRemoverDemanda(planoId: string) {
  return useMutacaoPlano((demandaId: string) =>
    requisitar<PlanoContratacoesDetalhe>(`/pca/${segmento(planoId)}/demandas/${segmento(demandaId)}`, { metodo: 'DELETE' }),
  );
}

export function useAcaoPlano(planoId: string, acao: 'consolidar' | 'aprovar' | 'publicar') {
  return useMutacaoPlano(() => api.criar<PlanoContratacoesDetalhe>(`/pca/${segmento(planoId)}/${acao}`));
}

export function useDevolverPlano(planoId: string) {
  return useMutacaoPlano((entrada: EntradaDevolucaoPca) => api.criar<PlanoContratacoesDetalhe>(`/pca/${segmento(planoId)}/devolver`, entrada));
}

// ───────────────────────── DFD: PCA e catálogo ─────────────────────────

const chavePlanejamentoDfd = (processoId: string) => ['processos', 'planejamento', processoId] as const;

/** `versao` (o `atualizadoEm` do processo) refaz a consulta quando o DFD é salvo. */
export function usePlanejamentoDfd(processoId: string, versao: string) {
  return useQuery({
    queryKey: [...chavePlanejamentoDfd(processoId), versao],
    queryFn: ({ signal }) => api.ler<PlanejamentoDfd>(`/processos/${segmento(processoId)}/pca`, undefined, signal),
  });
}

function useMutacaoProcessoPlanejamento<E>(processoId: string, executar: (entrada: E) => Promise<ProcessoDetalhe>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (processo) => {
      cliente.setQueryData(chaveProcesso(processoId), processo);
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
      void cliente.invalidateQueries({ queryKey: chavePlanejamentoDfd(processoId) });
    },
  });
}

export function useVincularPca(processoId: string) {
  return useMutacaoProcessoPlanejamento(processoId, (entrada: EntradaVinculoPca) => api.substituir<ProcessoDetalhe>(`/processos/${segmento(processoId)}/pca`, entrada));
}

export function useEscolherCodigoCatalogo(processoId: string) {
  return useMutacaoProcessoPlanejamento(processoId, ({ indice, entrada }: { indice: number; entrada: EntradaEscolhaCatalogo }) =>
    api.substituir<ProcessoDetalhe>(`/processos/${segmento(processoId)}/dfd/itens/${indice}/catalogo`, entrada),
  );
}

export function useConsultarPcaPncp(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<PlanejamentoDfd>(`/processos/${segmento(processoId)}/pca/consultar`),
    onSuccess: (painel) => {
      cliente.setQueryData(chavePlanejamentoDfd(processoId), painel);
      void cliente.invalidateQueries({ queryKey: chaveProcesso(processoId) });
    },
  });
}

/** Sugestão do código do catálogo (RIA-13): consulta sob demanda, sem cache entre descrições diferentes. */
export function useSugestoesCatalogo() {
  return useMutation({
    mutationFn: ({ descricao, tipo }: { descricao: string; tipo: TipoItemCatalogo }) =>
      api.ler<SugestoesCatalogo>('/catalogo/sugestoes', { descricao, tipo }),
  });
}

export function useBuscaCatalogo() {
  return useMutation({
    mutationFn: ({ busca, tipo }: { busca: string; tipo: TipoItemCatalogo }) => api.ler<ConsultaCatalogo>('/catalogo/itens', { busca, tipo }),
  });
}

// ───────────────────────── IRP ─────────────────────────

export function useIntencoesRegistroPrecos() {
  return useQuery({
    queryKey: ['irps'],
    queryFn: ({ signal }) => api.ler<IntencaoRegistroPrecos[]>('/irps', undefined, signal),
  });
}

function useMutacaoIrp<E>(executar: (entrada: E) => Promise<IntencaoRegistroPrecos>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['irps'] });
      void cliente.invalidateQueries({ queryKey: ['processos', 'planejamento'] });
    },
  });
}

export function useAbrirIrp() {
  return useMutacaoIrp((entrada: EntradaIrp) => api.criar<IntencaoRegistroPrecos>('/irps', entrada));
}

export function useAderirIrp(irpId: string) {
  return useMutacaoIrp((entrada: EntradaAdesaoIrp) => api.criar<IntencaoRegistroPrecos>(`/irps/${segmento(irpId)}/adesoes`, entrada));
}

export function useConsolidarIrp(irpId: string) {
  return useMutacaoIrp(() => api.criar<IntencaoRegistroPrecos>(`/irps/${segmento(irpId)}/consolidar`));
}
