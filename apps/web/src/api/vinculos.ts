import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmpenhoSemContrato,
  EmpenhoSemItem,
  EntradaVinculoContratoAta,
  EntradaVinculoEmpenhoContrato,
  EntradaVinculoEmpenhoItem,
  SugestaoVinculoContratoAta,
} from '@agora/contratos';
import { api } from './cliente';

export function useContratosSemAta(habilitado = true) {
  return useQuery({
    queryKey: ['vinculos', 'contratos-sem-ata'],
    queryFn: ({ signal }) => api.ler<SugestaoVinculoContratoAta[]>('/vinculos/contratos-sem-ata', undefined, signal),
    enabled: habilitado,
  });
}

export function useEmpenhosSemContrato(habilitado = true) {
  return useQuery({
    queryKey: ['vinculos', 'empenhos-sem-contrato'],
    queryFn: ({ signal }) => api.ler<EmpenhoSemContrato[]>('/vinculos/empenhos-sem-contrato', undefined, signal),
    enabled: habilitado,
  });
}

export function useEmpenhosSemItem(habilitado = true) {
  return useQuery({
    queryKey: ['vinculos', 'empenhos-sem-item'],
    queryFn: ({ signal }) => api.ler<EmpenhoSemItem[]>('/vinculos/empenhos-sem-item', undefined, signal),
    enabled: habilitado,
  });
}

function useInvalidarVinculos() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ['vinculos'] });
    void cliente.invalidateQueries({ queryKey: ['contratos'] });
    void cliente.invalidateQueries({ queryKey: ['empenhos'] });
    void cliente.invalidateQueries({ queryKey: ['atas'] });
  };
}

export function useVincularContratoAta() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: (entrada: EntradaVinculoContratoAta) => api.acionar('/vinculos/contrato-ata', entrada),
    onSuccess: invalidar,
  });
}

/** Desfazer: DELETE /vinculos/contrato-ata/:contratoId */
export function useDesvincularContratoAta() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: (contratoId: string) => api.remover(`/vinculos/contrato-ata/${encodeURIComponent(contratoId)}`),
    onSuccess: invalidar,
  });
}

export function useVincularEmpenhoContrato() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: (entrada: EntradaVinculoEmpenhoContrato) => api.acionar('/vinculos/empenho-contrato', entrada),
    onSuccess: invalidar,
  });
}

/** Desfazer: DELETE /vinculos/empenho-contrato/:empenhoId */
export function useDesvincularEmpenhoContrato() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: (empenhoId: string) => api.remover(`/vinculos/empenho-contrato/${encodeURIComponent(empenhoId)}`),
    onSuccess: invalidar,
  });
}

/** Sem desfazer na API: a confirmação deixa isso explícito. */
export function useVincularEmpenhoItem() {
  const invalidar = useInvalidarVinculos();
  return useMutation({
    mutationFn: (entrada: EntradaVinculoEmpenhoItem) => api.acionar('/vinculos/empenho-item', entrada),
    onSuccess: invalidar,
  });
}
