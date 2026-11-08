/** Metas do ETP configuradas pelo órgão (RF-39): tabela `metas_etp`, uma linha por indicador. */
import type { ConfiguracaoMetasEtp, EntradaMetasEtp } from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';

type Indicador = 'tempo_instrucao' | 'erros_formais' | 'economia';

export const METAS_VAZIAS: EntradaMetasEtp = Object.freeze({
  tempoInstrucao: { reducaoPercentual: null, linhaBaseDias: { '1': null, '2': null, '3': null, '4': null } },
  errosFormais: { mitigacaoPercentual: null },
  economia: { economiaPercentual: null },
});

interface LinhaMeta {
  indicador: Indicador;
  configuracao: Record<string, unknown>;
  atualizada_em: string;
  usuario_id: string | null;
  usuario_nome: string | null;
}

function numeroOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function lerMetas(executor: Executor): Promise<ConfiguracaoMetasEtp> {
  const linhas = await executor.consultar<LinhaMeta>(
    `SELECT m.indicador, m.configuracao, m.atualizada_em, u.id AS usuario_id, u.nome AS usuario_nome
       FROM metas_etp m LEFT JOIN usuarios u ON u.id = m.atualizada_por
      ORDER BY m.atualizada_em DESC`,
  );
  const por = (indicador: Indicador) => linhas.find((l) => l.indicador === indicador)?.configuracao ?? {};
  const tempo = por('tempo_instrucao');
  const bases = (tempo.linhaBaseDias ?? {}) as Record<string, unknown>;
  const recente = linhas[0];
  return {
    tempoInstrucao: {
      reducaoPercentual: numeroOuNulo(tempo.reducaoPercentual),
      linhaBaseDias: { '1': numeroOuNulo(bases['1']), '2': numeroOuNulo(bases['2']), '3': numeroOuNulo(bases['3']), '4': numeroOuNulo(bases['4']) },
    },
    errosFormais: { mitigacaoPercentual: numeroOuNulo(por('erros_formais').mitigacaoPercentual) },
    economia: { economiaPercentual: numeroOuNulo(por('economia').economiaPercentual) },
    atualizadaEm: recente?.atualizada_em ?? null,
    atualizadaPor: recente?.usuario_id && recente.usuario_nome ? { id: recente.usuario_id, nome: recente.usuario_nome } : null,
  };
}

/** Grava as três metas (upsert), na transação da ação auditada. */
export async function gravarMetas(tx: Transacao, metas: EntradaMetasEtp, usuarioId: string | null, agora: Date): Promise<void> {
  const linhas: [Indicador, unknown][] = [
    ['tempo_instrucao', metas.tempoInstrucao],
    ['erros_formais', metas.errosFormais],
    ['economia', metas.economia],
  ];
  for (const [indicador, configuracao] of linhas) {
    await tx.executar(
      `INSERT INTO metas_etp (indicador, configuracao, atualizada_por, atualizada_em) VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (indicador) DO UPDATE SET configuracao = EXCLUDED.configuracao, atualizada_por = EXCLUDED.atualizada_por, atualizada_em = EXCLUDED.atualizada_em`,
      [indicador, JSON.stringify(configuracao), usuarioId, agora.toISOString()],
    );
  }
}

export function metasConfiguradas(m: EntradaMetasEtp): boolean {
  return (
    m.tempoInstrucao.reducaoPercentual !== null ||
    Object.values(m.tempoInstrucao.linhaBaseDias).some((v) => v !== null) ||
    m.errosFormais.mitigacaoPercentual !== null ||
    m.economia.economiaPercentual !== null
  );
}
