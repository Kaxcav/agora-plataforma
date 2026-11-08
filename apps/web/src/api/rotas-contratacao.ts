/**
 * Rotas de contratação (F9): rota do processo, dispensa eletrônica, inexigibilidade, adesão a ata, Sicx e cartão de
 * pagamento. As mutações do processo devolvem a `RotaProcesso`; o detalhe do processo é recarregado porque os
 * bloqueios da etapa dependem da rota (a decisão é sempre do servidor).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdesaoProcesso,
  AtaDisponivelAdesao,
  CompraCartaoPagamento,
  CompraSicx,
  ComprovacaoInexigibilidadeProcesso,
  EntradaAdesao,
  EntradaAutorizacaoContratacao,
  EntradaCompraCartao,
  EntradaCompraSicx,
  EntradaRotaContratacao,
  ExtratoCartaoPagamento,
  ReservaSicx,
  RespostaCompraCartao,
  RotaProcesso,
  VitrineSicx,
} from '@agora/contratos';
import { api } from './cliente';
import { chaveListaProcessos, chaveProcesso } from './jornada';

const segmento = (id: string) => encodeURIComponent(id);
const caminho = (id: string, sufixo: string) => `/processos/${segmento(id)}/${sufixo}`;

export const chaveRota = (id: string) => ['processos', 'rota', id] as const;

/** GET /processos/:id/rota */
export function useRotaProcesso(id: string, habilitado = true) {
  return useQuery({
    queryKey: chaveRota(id),
    queryFn: ({ signal }) => api.ler<RotaProcesso>(caminho(id, 'rota'), undefined, signal),
    enabled: habilitado && id !== '',
  });
}

function useMutacaoRota<E>(id: string, executar: (entrada: E) => Promise<RotaProcesso>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (rota) => {
      cliente.setQueryData(chaveRota(id), rota);
      void cliente.invalidateQueries({ queryKey: chaveProcesso(id) });
      void cliente.invalidateQueries({ queryKey: chaveListaProcessos });
      void cliente.invalidateQueries({ queryKey: ['processos', 'adesao', id] });
    },
  });
}

/** PUT /processos/:id/rota (etapa 1) */
export function useEscolherRota(id: string) {
  return useMutacaoRota(id, (entrada: EntradaRotaContratacao) => api.substituir<RotaProcesso>(caminho(id, 'rota'), entrada));
}

/** POST /processos/:id/dispensa/aviso — publicação no PNCP pela fila (RN-41) */
export function usePublicarAvisoDispensa(id: string) {
  return useMutacaoRota<void>(id, () => api.criar<RotaProcesso>(caminho(id, 'dispensa/aviso')));
}

/** POST /processos/:id/dispensa/propostas */
export function useRegistrarPropostaDispensa(id: string) {
  return useMutacaoRota(id, (entrada: { fornecedorId: string; valor: number }) => api.criar<RotaProcesso>(caminho(id, 'dispensa/propostas'), entrada));
}

/** POST /processos/:id/dispensa/julgamento */
export function useJulgarDispensa(id: string) {
  return useMutacaoRota<void>(id, () => api.criar<RotaProcesso>(caminho(id, 'dispensa/julgamento')));
}

/** PUT /processos/:id/inexigibilidade */
export function useSalvarInexigibilidade(id: string) {
  return useMutacaoRota(id, (entrada: Omit<ComprovacaoInexigibilidadeProcesso, 'hipotese'>) => api.substituir<RotaProcesso>(caminho(id, 'inexigibilidade'), entrada));
}

/** GET /processos/:id/adesao/atas-disponiveis */
export function useAtasDisponiveisAdesao(id: string, busca: string, habilitado = true) {
  return useQuery({
    queryKey: ['processos', 'adesao', id, busca],
    queryFn: ({ signal }) => api.ler<AtaDisponivelAdesao[]>(caminho(id, 'adesao/atas-disponiveis'), { busca: busca || undefined }, signal),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });
}

/** POST /processos/:id/adesao — acima dos limites do art. 86 o servidor recusa (422) */
export function useSolicitarAdesao(id: string) {
  return useMutacaoRota(id, (entrada: EntradaAdesao) => api.criar<RotaProcesso>(caminho(id, 'adesao'), entrada));
}

/** POST /processos/:id/adesao/aceite-fornecedor */
export function useAceiteFornecedorAdesao(id: string) {
  return useMutacaoRota(id, (entrada: { data: string }) => api.criar<RotaProcesso>(caminho(id, 'adesao/aceite-fornecedor'), entrada));
}

/** POST /processos/:id/contratacao-direta/autorizacao (autoridade competente designada) */
export function useAutorizarContratacao(id: string) {
  return useMutacaoRota(id, (entrada: EntradaAutorizacaoContratacao) => api.criar<RotaProcesso>(caminho(id, 'contratacao-direta/autorizacao'), entrada));
}

// ── adesões (órgão gerenciador) ──

/** GET /atas/adesoes */
export function useAdesoesAtas() {
  return useQuery({
    queryKey: ['atas', 'adesoes'],
    queryFn: ({ signal }) => api.ler<(AdesaoProcesso & { processo: { id: string; numeroSei: string; titulo: string } })[]>('/atas/adesoes', undefined, signal),
  });
}

/** POST /atas/adesoes/:id/anuencia (atas:editar) */
export function useAnuenciaAdesao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (e: { id: string; decisao: 'autorizada' | 'recusada'; motivo: string | null }) =>
      api.criar<AdesaoProcesso>(`/atas/adesoes/${segmento(e.id)}/anuencia`, { decisao: e.decisao, motivo: e.motivo }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['atas', 'adesoes'] });
      void cliente.invalidateQueries({ queryKey: ['processos'] });
    },
  });
}

// ── Sicx (RN-42) ──

/** GET /sicx/ofertas?uasg&busca&quantidade */
export function useVitrineSicx(uasg: string, busca: string, quantidade: number) {
  return useQuery({
    queryKey: ['sicx', 'vitrine', uasg, busca, quantidade],
    queryFn: ({ signal }) => api.ler<VitrineSicx>('/sicx/ofertas', { uasg, busca: busca || undefined, quantidade }, signal),
    enabled: /^\d{6}$/.test(uasg) && quantidade > 0,
    placeholderData: keepPreviousData,
  });
}

/** GET /sicx/reservas?uasg */
export function useReservasSicx(uasg: string) {
  return useQuery({
    queryKey: ['sicx', 'reservas', uasg],
    queryFn: ({ signal }) => api.ler<ReservaSicx[]>('/sicx/reservas', { uasg }, signal),
    enabled: /^\d{6}$/.test(uasg),
  });
}

/** GET /sicx/compras?uasg */
export function useComprasSicx(uasg: string) {
  return useQuery({
    queryKey: ['sicx', 'compras', uasg],
    queryFn: ({ signal }) => api.ler<CompraSicx[]>('/sicx/compras', { uasg: uasg || undefined }, signal),
  });
}

function useMutacaoSicx<E>(executar: (entrada: E) => Promise<CompraSicx>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (compra) => {
      void cliente.invalidateQueries({ queryKey: ['sicx'] });
      if (compra.processoId) {
        void cliente.invalidateQueries({ queryKey: chaveRota(compra.processoId) });
        void cliente.invalidateQueries({ queryKey: chaveProcesso(compra.processoId) });
      }
    },
  });
}

/** POST /sicx/compras — ordem de compra */
export function useEmitirOrdemSicx() {
  return useMutacaoSicx((entrada: EntradaCompraSicx) => api.criar<CompraSicx>('/sicx/compras', entrada));
}

/** POST /sicx/compras/:id/conclusao | entrega | recebimento | pagamento */
export function useAcaoCompraSicx() {
  return useMutacaoSicx((e: { id: string; acao: 'conclusao' | 'entrega' | 'recebimento' | 'pagamento'; corpo?: unknown }) =>
    api.criar<CompraSicx>(`/sicx/compras/${segmento(e.id)}/${e.acao}`, e.corpo ?? {}),
  );
}

// ── cartão de pagamento (art. 75, § 4º) ──

/** GET /cartao-pagamento/compras?uasg&competencia */
export function useComprasCartao(filtro: { uasg?: string | undefined; competencia?: string | undefined }) {
  return useQuery({
    queryKey: ['cartao', 'compras', filtro],
    queryFn: ({ signal }) => api.ler<CompraCartaoPagamento[]>('/cartao-pagamento/compras', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

/** POST /cartao-pagamento/compras */
export function useRegistrarCompraCartao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaCompraCartao) => api.criar<RespostaCompraCartao>('/cartao-pagamento/compras', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['cartao'] }),
  });
}

/** GET /cartao-pagamento/extratos */
export function useExtratosCartao() {
  return useQuery({
    queryKey: ['cartao', 'extratos'],
    queryFn: ({ signal }) => api.ler<ExtratoCartaoPagamento[]>('/cartao-pagamento/extratos', undefined, signal),
  });
}

/** POST /cartao-pagamento/extratos — divulgação no PNCP pela fila */
export function usePublicarExtratoCartao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: { uasg: string; competencia: string }) => api.criar<ExtratoCartaoPagamento>('/cartao-pagamento/extratos', entrada),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['cartao'] }),
  });
}
