/**
 * Controle das contratações: painéis das linhas de defesa (RF-23), medidas de controle externo (RF-24, RN-30) e
 * revisão trimestral da matriz de riscos dos contratos (RN-29). O servidor decide perfil e escopo de UASG.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaMedidaControle,
  EntradaProrrogacaoMedida,
  EntradaRespostaMedida,
  EntradaRevisaoRiscos,
  EntradaRevogacaoMedida,
  FiltroMedidasControle,
  MatrizRiscosContrato,
  MedidaControle,
  Pagina,
  PainelPrimeiraLinha,
  PainelSegundaLinha,
  PainelTerceiraLinha,
} from '@agora/contratos';
import { api, urlApi } from './cliente';

export interface FiltroPeriodo {
  uasg?: string;
  de?: string;
  ate?: string;
}

export function usePainelPrimeiraLinha(uasg: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: ['controle', 'primeira-linha', { uasg }],
    queryFn: ({ signal }) => api.ler<PainelPrimeiraLinha>('/controle/primeira-linha', { uasg }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

export function usePainelSegundaLinha(uasg: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: ['controle', 'segunda-linha', { uasg }],
    queryFn: ({ signal }) => api.ler<PainelSegundaLinha>('/controle/segunda-linha', { uasg }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

export function usePainelTerceiraLinha(filtro: FiltroPeriodo, habilitado = true) {
  return useQuery({
    queryKey: ['controle', 'terceira-linha', filtro],
    queryFn: ({ signal }) => api.ler<PainelTerceiraLinha>('/controle/terceira-linha', { ...filtro }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

/** Link de download do relatório executivo de auditoria (PDF gerado no servidor; a emissão fica na trilha). */
export function urlRelatorioAuditoria(filtro: FiltroPeriodo): string {
  return urlApi('/controle/relatorio.pdf', { ...filtro });
}

export function useMedidasControle(filtro: FiltroMedidasControle, habilitado = true) {
  return useQuery({
    queryKey: ['medidas-controle', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<MedidaControle>>('/medidas-controle', { ...filtro }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

/** Depois de qualquer escrita: medidas, painéis e processos (o bloqueio RN-30 aparece na jornada). */
function useInvalidarControle() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ['medidas-controle'] });
    void cliente.invalidateQueries({ queryKey: ['controle'] });
    void cliente.invalidateQueries({ queryKey: ['processos'] });
  };
}

export function useRegistrarMedida() {
  const invalidar = useInvalidarControle();
  return useMutation({
    mutationFn: (entrada: EntradaMedidaControle) => api.criar<MedidaControle>('/medidas-controle', entrada),
    onSuccess: invalidar,
  });
}

export function useProrrogarMedida() {
  const invalidar = useInvalidarControle();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaProrrogacaoMedida }) =>
      api.criar<MedidaControle>(`/medidas-controle/${encodeURIComponent(id)}/prorrogacao`, entrada),
    onSuccess: invalidar,
  });
}

export function useResponderMedida() {
  const invalidar = useInvalidarControle();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaRespostaMedida }) =>
      api.criar<MedidaControle>(`/medidas-controle/${encodeURIComponent(id)}/resposta`, entrada),
    onSuccess: invalidar,
  });
}

export function useRevogarMedida() {
  const invalidar = useInvalidarControle();
  return useMutation({
    mutationFn: ({ id, entrada }: { id: string; entrada: EntradaRevogacaoMedida }) =>
      api.criar<MedidaControle>(`/medidas-controle/${encodeURIComponent(id)}/revogacao`, entrada),
    onSuccess: invalidar,
  });
}

export function useMatrizRiscosContrato(id: string) {
  return useQuery({
    queryKey: ['contratos', 'detalhe', id, 'riscos'],
    queryFn: ({ signal }) => api.ler<MatrizRiscosContrato>(`/contratos/${encodeURIComponent(id)}/riscos`, undefined, signal),
  });
}

export function useRevisarRiscosContrato(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaRevisaoRiscos) => api.criar<MatrizRiscosContrato>(`/contratos/${encodeURIComponent(id)}/riscos/revisoes`, entrada),
    onSuccess: (matriz) => {
      cliente.setQueryData(['contratos', 'detalhe', id, 'riscos'], matriz);
      void cliente.invalidateQueries({ queryKey: ['controle'] });
      void cliente.invalidateQueries({ queryKey: ['contratos', 'detalhe', id, 'historico'] });
    },
  });
}
