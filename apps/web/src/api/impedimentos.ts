/** Vínculos entre licitantes, extensão de sanção e declarações dos agentes (F4 e F14). O navegador fala só com /api/v1. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnaliseVinculos,
  EntradaAnaliseVinculos,
  EntradaDeclaracaoAgente,
  EntradaDecisaoExtensao,
  EntradaDefesaExtensao,
  EntradaParecerExtensao,
  EntradaProporExtensao,
  EntradaVinculo,
  ExtensaoSancao,
  MinhaDeclaracao,
  ProcessoComLicitantes,
  QuadroSocietario,
  SinalVinculo,
  UsuarioResumo,
  VinculoRegistrado,
  VinculosFornecedor,
  VinculosProcesso,
} from '@agora/contratos';
import { api } from './cliente';

const CHAVE = 'impedimentos';

function useInvalidar() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: [CHAVE] });
    void cliente.invalidateQueries({ queryKey: ['sancoes'] });
    void cliente.invalidateQueries({ queryKey: ['fornecedores'] });
    void cliente.invalidateQueries({ queryKey: ['processos'] });
  };
}

export function useSucessoes(habilitado = true) {
  return useQuery({
    queryKey: [CHAVE, 'sucessoes'],
    queryFn: ({ signal }) => api.ler<SinalVinculo[]>('/impedimentos/sucessoes', undefined, signal),
    enabled: habilitado,
  });
}

export function useProcessosComLicitantes() {
  return useQuery({
    queryKey: [CHAVE, 'processos'],
    queryFn: ({ signal }) => api.ler<ProcessoComLicitantes[]>('/impedimentos/processos', undefined, signal),
  });
}

export function useVinculosProcesso(id: string) {
  return useQuery({
    queryKey: [CHAVE, 'processo', id],
    queryFn: ({ signal }) => api.ler<VinculosProcesso>(`/impedimentos/processos/${encodeURIComponent(id)}`, undefined, signal),
  });
}

export function useVinculosFornecedor(id: string, habilitado = true) {
  return useQuery({
    queryKey: [CHAVE, 'fornecedor', id],
    queryFn: ({ signal }) => api.ler<VinculosFornecedor>(`/impedimentos/fornecedores/${encodeURIComponent(id)}`, undefined, signal),
    enabled: habilitado && id !== '',
  });
}

export function useVinculos(filtro: { fornecedorId?: string; processoId?: string; situacao?: 'ativo' | 'revogado' } = {}) {
  return useQuery({
    queryKey: [CHAVE, 'vinculos', filtro],
    queryFn: ({ signal }) => api.ler<VinculoRegistrado[]>('/impedimentos/vinculos', { ...filtro }, signal),
  });
}

export function useAgentesPublicos(habilitado: boolean) {
  return useQuery({
    queryKey: [CHAVE, 'agentes'],
    queryFn: ({ signal }) => api.ler<UsuarioResumo[]>('/impedimentos/agentes', undefined, signal),
    enabled: habilitado,
    staleTime: 5 * 60_000,
  });
}

export function useExtensoes() {
  return useQuery({
    queryKey: [CHAVE, 'extensoes'],
    queryFn: ({ signal }) => api.ler<ExtensaoSancao[]>('/impedimentos/extensoes', undefined, signal),
  });
}

export function useExtensao(id: string) {
  return useQuery({
    queryKey: [CHAVE, 'extensao', id],
    queryFn: ({ signal }) => api.ler<ExtensaoSancao>(`/impedimentos/extensoes/${encodeURIComponent(id)}`, undefined, signal),
  });
}

export function useMinhaDeclaracao() {
  return useQuery({
    queryKey: [CHAVE, 'declaracao'],
    queryFn: ({ signal }) => api.ler<MinhaDeclaracao>('/impedimentos/declaracoes/minha', undefined, signal),
  });
}

/** POST /impedimentos/analise — somente leitura. */
export function useAnalisarVinculos() {
  return useMutation({
    mutationFn: (entrada: EntradaAnaliseVinculos) => api.criar<AnaliseVinculos>('/impedimentos/analise', entrada),
  });
}

export function useRegistrarVinculo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (entrada: EntradaVinculo) => api.criar<VinculoRegistrado>('/impedimentos/vinculos', entrada),
    onSuccess: invalidar,
  });
}

export function useRevogarVinculo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => api.criar<VinculoRegistrado>(`/impedimentos/vinculos/${encodeURIComponent(id)}/revogar`, { motivo }),
    onSuccess: invalidar,
  });
}

export function useConsultarQsa(fornecedorId: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: () => api.criar<QuadroSocietario>(`/impedimentos/fornecedores/${encodeURIComponent(fornecedorId)}/qsa`),
    onSuccess: invalidar,
  });
}

export function useProporExtensao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (entrada: EntradaProporExtensao) => api.criar<ExtensaoSancao>('/impedimentos/extensoes', entrada),
    onSuccess: invalidar,
  });
}

type PassoExtensao =
  | { passo: 'defesa'; corpo: EntradaDefesaExtensao }
  | { passo: 'parecer'; corpo: EntradaParecerExtensao }
  | { passo: 'decisao'; corpo: EntradaDecisaoExtensao }
  | { passo: 'arquivar'; corpo: { motivo: string } };

export function usePassoExtensao(id: string) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (p: PassoExtensao) => api.criar<ExtensaoSancao>(`/impedimentos/extensoes/${encodeURIComponent(id)}/${p.passo}`, p.corpo),
    onSuccess: invalidar,
  });
}

export function useAssinarDeclaracao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (entrada: EntradaDeclaracaoAgente) => api.criar<MinhaDeclaracao>('/impedimentos/declaracoes', entrada),
    onSuccess: invalidar,
  });
}
