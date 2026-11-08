/**
 * Pedido de uma operação externa que pode se repetir ao longo do tempo (novo envio ao SEI, nova consulta das
 * assinaturas, nova conferência no DOU). Cada pedido ganha a chave de idempotência `<prefixo>:<n>`:
 *   * se a última tarefa do prefixo ainda está na fila ou em execução, ela é devolvida (nada é duplicado);
 *   * se está na fila de erro, é reaberta (reprocessamento pedido pelo usuário);
 *   * senão, é criada a tarefa seguinte.
 */
import { chaveIdempotencia } from '@agora/dominio';
import type { Transacao } from '../banco/tipos.ts';
import { reabrir } from './registro.ts';
import type { ServicoFila } from './servico.ts';
import type { LinhaTarefa, NovaTarefa } from './tipos.ts';

export interface PedidoRepetivel {
  tarefa: LinhaTarefa;
  /** nova = criada agora; reaberta = saiu da fila de erro; pendente = já estava na fila (nada mudou). */
  situacao: 'nova' | 'reaberta' | 'pendente';
}

/** Última tarefa com o prefixo de chave (ex.: `sei:envio:<processo>`), travada para a transação. */
export async function ultimaTarefaDoPrefixo(tx: Transacao, prefixo: string): Promise<LinhaTarefa | null> {
  const [linha] = await tx.consultar<LinhaTarefa>(
    `SELECT * FROM fila_tarefas
      WHERE left(chave_idempotencia, length($1)) = $1
      ORDER BY criada_em DESC, chave_idempotencia DESC
      LIMIT 1
      FOR UPDATE`,
    [`${prefixo}:`],
  );
  return linha ?? null;
}

export async function pedirTarefaRepetivel(
  tx: Transacao,
  fila: ServicoFila,
  partes: readonly string[],
  nova: Omit<NovaTarefa, 'chave'>,
  agora: Date,
): Promise<PedidoRepetivel> {
  const prefixo = chaveIdempotencia(partes);
  const ultima = await ultimaTarefaDoPrefixo(tx, prefixo);
  if (ultima && (ultima.situacao === 'pendente' || ultima.situacao === 'executando')) return { tarefa: ultima, situacao: 'pendente' };
  if (ultima && ultima.situacao === 'erro') {
    const reaberta = await reabrir(tx, ultima.id, agora);
    if (reaberta) return { tarefa: reaberta, situacao: 'reaberta' };
  }
  const [contagem] = await tx.consultar<{ total: number }>(
    'SELECT count(*)::int AS total FROM fila_tarefas WHERE left(chave_idempotencia, length($1)) = $1',
    [`${prefixo}:`],
  );
  const { tarefa } = await fila.enfileirar(tx, { ...nova, chave: chaveIdempotencia([...partes, String((contagem?.total ?? 0) + 1)]) });
  return { tarefa, situacao: 'nova' };
}
