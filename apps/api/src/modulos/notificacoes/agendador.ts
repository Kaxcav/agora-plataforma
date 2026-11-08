/**
 * Agendador da central de notificações: varredura diária idempotente (RN-31) e processamento periódico da fila.
 * Roda no processo da API (`AGORA_NOTIFICACOES_AGENDADOR=api`, padrão) ou num processo à parte
 * (`npm run notificacoes -w @agora/api`). As duas formas podem coexistir: o advisory lock e o
 * `FOR UPDATE SKIP LOCKED` da fila impedem trabalho em dobro entre réplicas.
 */
import type { DriversCanais } from './canais.ts';
import { executarVarredura, processarFila, type ContextoNotificacoes } from './servico.ts';

/** A fila é conferida a cada minuto (as novas tentativas vencem em 1, 5, 15 e 60 minutos). */
export const INTERVALO_FILA_MS = 60 * 1000;
/** A varredura é conferida a cada hora e só roda uma vez por dia (a primeira conferência do dia). */
export const INTERVALO_VARREDURA_MS = 60 * 60 * 1000;

export interface ResultadoCiclo {
  varredura: { notificacoesCriadas: number; enviosCriados: number } | null;
  enviosProcessados: number;
}

export interface OpcoesAgendador {
  contexto: ContextoNotificacoes;
  drivers?: DriversCanais;
  intervaloFilaMs?: number;
  intervaloVarreduraMs?: number;
  aoConcluir?: (resultado: ResultadoCiclo) => void;
  aoFalhar: (erro: unknown) => void;
}

export interface AgendaNotificacoes {
  /** Varredura do dia (se ainda não feita) e fila. Devolve null se falhou ou se já havia execução em curso. */
  executarAgora(): Promise<ResultadoCiclo | null>;
  /**
   * Inicialização: aguarda a varredura do dia (só banco). Com `aguardarFila`, aguarda também a fila (drivers
   * simulados, sem I/O externo); senão, a fila segue em segundo plano para não atrasar a prontidão do serviço.
   */
  iniciar(aguardarFila: boolean): Promise<void>;
  parar(): void;
}

/** Agenda a varredura diária e a fila. Os timers não impedem o encerramento do processo. */
export function agendarNotificacoes(opcoes: OpcoesAgendador): AgendaNotificacoes {
  let emCurso = false;
  const drivers = opcoes.drivers ? { drivers: opcoes.drivers } : {};

  const ciclo = async (comVarredura: boolean, comFila = true): Promise<ResultadoCiclo | null> => {
    if (emCurso) return null;
    emCurso = true;
    try {
      const varredura = comVarredura ? await executarVarredura(opcoes.contexto, { ...drivers, processar: false }) : null;
      const enviosProcessados = comFila ? await processarFila(opcoes.contexto, drivers) : 0;
      const resultado: ResultadoCiclo = {
        varredura: varredura ? { notificacoesCriadas: varredura.notificacoesCriadas, enviosCriados: varredura.enviosCriados } : null,
        enviosProcessados,
      };
      opcoes.aoConcluir?.(resultado);
      return resultado;
    } catch (erro: unknown) {
      opcoes.aoFalhar(erro);
      return null;
    } finally {
      emCurso = false;
    }
  };

  const timerFila = setInterval(() => {
    void ciclo(false);
  }, opcoes.intervaloFilaMs ?? INTERVALO_FILA_MS);
  const timerVarredura = setInterval(() => {
    void ciclo(true);
  }, opcoes.intervaloVarreduraMs ?? INTERVALO_VARREDURA_MS);
  timerFila.unref();
  timerVarredura.unref();

  return {
    executarAgora: () => ciclo(true),
    iniciar: async (aguardarFila) => {
      if (aguardarFila) {
        await ciclo(true);
        return;
      }
      await ciclo(true, false);
      void ciclo(false);
    },
    parar: () => {
      clearInterval(timerFila);
      clearInterval(timerVarredura);
    },
  };
}
