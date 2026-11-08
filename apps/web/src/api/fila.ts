/**
 * Fila de integrações (RNF-07) e publicação no PNCP (RF-19). O navegador só fala com a API da Ágora: quem chama o
 * PNCP e as demais fontes é o serviço trabalhador, no servidor.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Pagina, PublicacaoPncp, ResumoFila, SituacaoTarefaFila, TarefaFila } from '@agora/contratos';
import { api } from './cliente';
import { chaveProcesso } from './jornada';

const chaveFila = ['admin', 'fila'] as const;

/** GET /fila/resumo — transporte, modo do trabalhador e contagens por situação. */
export function useResumoFila() {
  return useQuery({
    queryKey: [...chaveFila, 'resumo'],
    queryFn: ({ signal }) => api.ler<ResumoFila>('/fila/resumo', undefined, signal),
    refetchInterval: (consulta) => ((consulta.state.data?.pendentes ?? 0) + (consulta.state.data?.executando ?? 0) > 0 ? 5000 : false),
  });
}

/** GET /fila/tarefas?situacao&pagina — sem situação, todas as tarefas, das mais recentes para as mais antigas. */
export function useTarefasFila(situacao: SituacaoTarefaFila | null, pagina: number, tamanhoPagina = 10) {
  return useQuery({
    queryKey: [...chaveFila, 'tarefas', situacao, pagina, tamanhoPagina],
    queryFn: ({ signal }) => api.ler<Pagina<TarefaFila>>('/fila/tarefas', { situacao, pagina, tamanhoPagina }, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (consulta) => (consulta.state.data?.itens.some((t) => t.situacao === 'pendente' || t.situacao === 'executando') ? 5000 : false),
  });
}

/** POST /fila/tarefas/:id/reprocessar — tira a tarefa da fila de erro (registrado na trilha de auditoria). */
export function useReprocessarTarefa() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.criar<TarefaFila>(`/fila/tarefas/${encodeURIComponent(id)}/reprocessar`),
    onSuccess: (tarefa) => {
      void cliente.invalidateQueries({ queryKey: chaveFila });
      void cliente.invalidateQueries({ queryKey: ['admin', 'sincronizacoes'] });
      if (tarefa.recurso?.tipo === 'processo') void cliente.invalidateQueries({ queryKey: chaveProcesso(tarefa.recurso.id) });
    },
  });
}

const chavePublicacaoPncp = (processoId: string) => [...chaveProcesso(processoId), 'publicacao-pncp'] as const;

function emAndamento(publicacao: PublicacaoPncp | undefined): boolean {
  const envios = [...(publicacao?.envios ?? []), ...(publicacao?.contrato ? [publicacao.contrato] : [])];
  return envios.some((e) => e.situacao === 'na_fila' || e.situacao === 'enviando' || e.situacao === 'nova_tentativa');
}

/** GET /processos/:id/publicacao-pncp — atualizado sozinho enquanto há envio na fila. */
export function usePublicacaoPncp(processoId: string) {
  return useQuery({
    queryKey: chavePublicacaoPncp(processoId),
    queryFn: ({ signal }) => api.ler<PublicacaoPncp>(`/processos/${encodeURIComponent(processoId)}/publicacao-pncp`, undefined, signal),
    refetchInterval: (consulta) => (emAndamento(consulta.state.data) ? 4000 : false),
  });
}

/** POST /processos/:id/contrato/publicar-pncp — divulgação do contrato gerado pela jornada (art. 94). */
export function useDivulgarContratoPncp(processoId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<PublicacaoPncp>(`/processos/${encodeURIComponent(processoId)}/contrato/publicar-pncp`),
    onSuccess: (publicacao) => {
      cliente.setQueryData(chavePublicacaoPncp(processoId), publicacao);
      void cliente.invalidateQueries({ queryKey: ['contratos'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}
