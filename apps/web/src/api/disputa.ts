/**
 * Sala de disputa (`/processos/:id/sessoes-disputa`, `/sessoes-disputa/:id`). A sala consulta a sessão periodicamente
 * enquanto houver etapa de lances; toda mutação devolve a `SessaoDisputa` atualizada, que substitui o cache.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AtaSessao,
  EntradaLanceSessao,
  EntradaNegociacaoSessao,
  EntradaRelogioSessao,
  EntradaSessaoDisputa,
  EntradaTranscricaoLances,
  SessaoDisputa,
  SessaoDisputaResumo,
} from '@agora/contratos';
import { api } from './cliente';
import { chaveProcesso } from './jornada';

const segmento = (id: string) => encodeURIComponent(id);

/** Intervalo da consulta periódica durante a etapa de lances. */
export const INTERVALO_SALA_MS = 2_000;

const FASES_AO_VIVO: ReadonlySet<SessaoDisputa['fase']> = new Set(['lances_abertos', 'fechamento_iminente', 'lance_final_fechado']);

export const chaveSessoesDoProcesso = (processoId: string) => ['sessoes-disputa', 'processo', processoId] as const;
export const chaveSessao = (id: string) => ['sessoes-disputa', 'detalhe', id] as const;

/** GET /processos/:id/sessoes-disputa */
export function useSessoesDisputa(processoId: string) {
  return useQuery({
    queryKey: chaveSessoesDoProcesso(processoId),
    queryFn: ({ signal }) => api.ler<SessaoDisputaResumo[]>(`/processos/${segmento(processoId)}/sessoes-disputa`, undefined, signal),
  });
}

/** GET /sessoes-disputa/:id — consulta periódica enquanto a etapa de lances estiver em curso. */
export function useSessaoDisputa(id: string | null) {
  return useQuery({
    queryKey: chaveSessao(id ?? ''),
    queryFn: ({ signal }) => api.ler<SessaoDisputa>(`/sessoes-disputa/${segmento(id ?? '')}`, undefined, signal),
    enabled: id !== null,
    refetchInterval: (consulta) => (consulta.state.data && FASES_AO_VIVO.has(consulta.state.data.fase) ? INTERVALO_SALA_MS : false),
  });
}

/** GET /sessoes-disputa/:id/ata — prévia até a conclusão; definitiva depois. */
export function useAtaSessao(id: string, habilitada: boolean) {
  return useQuery({
    queryKey: [...chaveSessao(id), 'ata'],
    queryFn: ({ signal }) => api.ler<AtaSessao>(`/sessoes-disputa/${segmento(id)}/ata`, undefined, signal),
    enabled: habilitada,
  });
}

/** POST /processos/:id/sessoes-disputa */
export function useCriarSessaoDisputa(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaSessaoDisputa) => api.criar<SessaoDisputa>(`/processos/${segmento(processoId)}/sessoes-disputa`, entrada),
    onSuccess: (sessao) => {
      cliente.setQueryData(chaveSessao(sessao.id), sessao);
      void cliente.invalidateQueries({ queryKey: chaveSessoesDoProcesso(processoId) });
    },
  });
}

/** Mutação da sessão: grava a resposta no cache; o encerramento também atualiza o processo (registro da disputa). */
function useMutacaoSessao<E>(id: string, processoId: string, executar: (entrada: E) => Promise<SessaoDisputa>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (sessao) => {
      cliente.setQueryData(chaveSessao(id), sessao);
      void cliente.invalidateQueries({ queryKey: chaveSessoesDoProcesso(processoId) });
      if (sessao.fase === 'concluida') {
        void cliente.invalidateQueries({ queryKey: chaveProcesso(processoId) });
        void cliente.invalidateQueries({ queryKey: [...chaveSessao(id), 'ata'] });
      }
    },
  });
}

const acao = (id: string, sufixo: string) => `/sessoes-disputa/${segmento(id)}/${sufixo}`;

export function useAbrirSessao(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, () => api.criar<SessaoDisputa>(acao(id, 'abertura')));
}
export function useAdiantarRelogio(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, (entrada: EntradaRelogioSessao) => api.criar<SessaoDisputa>(acao(id, 'relogio'), entrada));
}
export function useRegistrarLance(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, (entrada: EntradaLanceSessao) => api.criar<SessaoDisputa>(acao(id, 'lances'), entrada));
}
export function useTranscreverLances(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, (entrada: EntradaTranscricaoLances) => api.criar<SessaoDisputa>(acao(id, 'lances/transcricao'), entrada));
}
export function useSincronizarSessao(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, () => api.criar<SessaoDisputa>(acao(id, 'sincronizacao')));
}
export function useReiniciarDisputa(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, (justificativa: string) => api.criar<SessaoDisputa>(acao(id, 'reinicio'), { justificativa }));
}
export function useNegociar(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, (entrada: EntradaNegociacaoSessao) => api.criar<SessaoDisputa>(acao(id, 'negociacao'), entrada));
}
export function useEncerrarSessao(id: string, processoId: string) {
  return useMutacaoSessao(id, processoId, () => api.criar<SessaoDisputa>(acao(id, 'encerramento')));
}
