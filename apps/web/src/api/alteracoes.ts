import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlteracaoContratual,
  EntradaAssinarAlteracao,
  EntradaDecidirExtincao,
  EntradaDefesaExtincao,
  EntradaIndeferirAlteracao,
  EntradaInstaurarExtincao,
  EntradaParecerAlteracao,
  EntradaProporAlteracao,
  EntradaReajusteContrato,
  EntradaRepactuacaoContrato,
  PainelAlteracoesContrato,
} from '@agora/contratos';
import { api } from './cliente';

/**
 * Alterações do contrato (RN-32, RN-33 e RF-27): termos aditivos, apostilas, reequilíbrio e extinção. O navegador só
 * fala com a API da Ágora; a divulgação no PNCP e a consulta ao CEIS/CNEP são feitas pelo servidor.
 */

const segmento = (id: string) => encodeURIComponent(id);
const chave = (id: string) => ['contratos', 'detalhe', id, 'alteracoes'] as const;

/** GET /contratos/:id/alteracoes — limites do art. 125, prorrogação, reajuste e histórico. */
export function useAlteracoesContrato(id: string) {
  return useQuery({
    queryKey: chave(id),
    queryFn: ({ signal }) => api.ler<PainelAlteracoesContrato>(`/contratos/${segmento(id)}/alteracoes`, undefined, signal),
  });
}

/** Mutação que, ao terminar, atualiza o contrato, o histórico, a regularidade e o painel. */
function useEscritaAlteracao<E>(id: string, montar: (entrada: E) => Promise<AlteracaoContratual>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: montar,
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: ['contratos'] });
      void cliente.invalidateQueries({ queryKey: ['regularidade'] });
      void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}

export function useProporAlteracao(id: string) {
  return useEscritaAlteracao(id, (entrada: EntradaProporAlteracao) => api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes`, entrada));
}

export function useParecerAlteracao(id: string) {
  return useEscritaAlteracao(id, ({ alteracaoId, entrada }: { alteracaoId: string; entrada: EntradaParecerAlteracao }) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/parecer`, entrada),
  );
}

export function useAssinarAlteracao(id: string) {
  return useEscritaAlteracao(id, ({ alteracaoId, entrada }: { alteracaoId: string; entrada: EntradaAssinarAlteracao }) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/assinar`, entrada),
  );
}

export function useIndeferirAlteracao(id: string) {
  return useEscritaAlteracao(id, ({ alteracaoId, entrada }: { alteracaoId: string; entrada: EntradaIndeferirAlteracao }) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/indeferir`, entrada),
  );
}

export function useReajustarContrato(id: string) {
  return useEscritaAlteracao(id, (entrada: EntradaReajusteContrato) => api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/reajustes`, entrada));
}

export function useRepactuarContrato(id: string) {
  return useEscritaAlteracao(id, (entrada: EntradaRepactuacaoContrato) => api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/repactuacoes`, entrada));
}

export function useInstaurarExtincao(id: string) {
  return useEscritaAlteracao(id, (entrada: EntradaInstaurarExtincao) => api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/extincao`, entrada));
}

export function useDefesaExtincao(id: string) {
  return useEscritaAlteracao(id, ({ alteracaoId, entrada }: { alteracaoId: string; entrada: EntradaDefesaExtincao }) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/defesa`, entrada),
  );
}

export function useDecidirExtincao(id: string) {
  return useEscritaAlteracao(id, ({ alteracaoId, entrada }: { alteracaoId: string; entrada: EntradaDecidirExtincao }) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/decidir-extincao`, entrada),
  );
}

export function useDivulgarTermo(id: string) {
  return useEscritaAlteracao(id, (alteracaoId: string) =>
    api.criar<AlteracaoContratual>(`/contratos/${segmento(id)}/alteracoes/${segmento(alteracaoId)}/divulgar-pncp`),
  );
}
