import { registrarEvento } from '../auditoria/trilha.ts';
import type { Banco } from '../banco/tipos.ts';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Retenção (docs/LGPD.md §5): sessões removidas 30 dias após expirar; tentativas de login guardadas por 90 dias. */
export const RETENCAO_SESSOES_MS = 30 * DIA_MS;
export const RETENCAO_TENTATIVAS_MS = 90 * DIA_MS;
export const INTERVALO_LIMPEZA_MS = 60 * 60 * 1000;

/** Advisory lock que impede duas réplicas de executarem a limpeza ao mesmo tempo. */
export const CHAVE_LOCK_LIMPEZA = 14_133_005;

export interface ResultadoLimpeza {
  /** false quando outra réplica detinha o lock (nada foi feito). */
  executada: boolean;
  sessoesRemovidas: number;
  tentativasRemovidas: number;
}

/**
 * Remove sessões expiradas há mais de 30 dias e tentativas de login com mais de 90 dias. Roda numa transação com
 * `pg_try_advisory_xact_lock`: se outra réplica estiver limpando, esta desiste sem esperar. Registra na trilha
 * de auditoria quando remove algo.
 */
export async function executarLimpeza(banco: Banco, agora: Date): Promise<ResultadoLimpeza> {
  return banco.transacao(async (tx) => {
    const [trava] = await tx.consultar<{ obtida: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS obtida', [CHAVE_LOCK_LIMPEZA]);
    if (!trava?.obtida) return { executada: false, sessoesRemovidas: 0, tentativasRemovidas: 0 };
    const limiteSessoes = new Date(agora.getTime() - RETENCAO_SESSOES_MS).toISOString();
    const limiteTentativas = new Date(agora.getTime() - RETENCAO_TENTATIVAS_MS).toISOString();
    const sessoesRemovidas = await tx.executar('DELETE FROM sessoes WHERE LEAST(expira_em, absoluta_ate) < $1', [limiteSessoes]);
    const tentativasRemovidas = await tx.executar('DELETE FROM tentativas_login WHERE ocorrida_em < $1', [limiteTentativas]);
    if (sessoesRemovidas + tentativasRemovidas > 0) {
      await registrarEvento(
        tx,
        {
          usuarioId: null,
          acao: 'manutencao.limpeza',
          recurso: 'sistema',
          recursoId: null,
          resumo: 'Removeu registros de sessão e de tentativas de entrada fora do prazo de retenção',
          dados: { sessoesRemovidas, tentativasRemovidas, retencaoSessoesDias: 30, retencaoTentativasDias: 90 },
        },
        agora,
      );
    }
    return { executada: true, sessoesRemovidas, tentativasRemovidas };
  });
}

export interface OpcoesLimpeza {
  banco: Banco;
  /** Relógio injetável (testes). */
  relogio: () => Date;
  intervaloMs?: number;
  aoConcluir?: (resultado: ResultadoLimpeza) => void;
  aoFalhar: (erro: unknown) => void;
}

export interface AgendaLimpeza {
  /** Executa já (usado na inicialização); falhas vão para `aoFalhar`. Devolve null se falhou ou se já havia execução em curso. */
  executarAgora(): Promise<ResultadoLimpeza | null>;
  parar(): void;
}

/** Agenda a limpeza periódica (a cada hora por padrão). O timer não impede o encerramento do processo. */
export function agendarLimpeza(opcoes: OpcoesLimpeza): AgendaLimpeza {
  let emCurso = false;
  const executarAgora = async (): Promise<ResultadoLimpeza | null> => {
    if (emCurso) return null;
    emCurso = true;
    try {
      const resultado = await executarLimpeza(opcoes.banco, opcoes.relogio());
      opcoes.aoConcluir?.(resultado);
      return resultado;
    } catch (erro: unknown) {
      opcoes.aoFalhar(erro);
      return null;
    } finally {
      emCurso = false;
    }
  };
  const timer = setInterval(() => {
    void executarAgora();
  }, opcoes.intervaloMs ?? INTERVALO_LIMPEZA_MS);
  timer.unref();
  return {
    executarAgora,
    parar: () => clearInterval(timer),
  };
}
