/**
 * Registro de estado da fila (`fila_tarefas`): enfileirar com idempotência, reservar para execução, concluir,
 * agendar nova tentativa, mandar para a fila de erro e reprocessar. Cada mudança é um único comando SQL
 * condicionado ao estado atual, para que duas réplicas do trabalhador nunca executem a mesma tarefa ao mesmo tempo.
 */
import type { SituacaoTarefaFila, TarefaFila, TipoTarefaFila } from '@agora/contratos';
import type { Executor, Transacao } from '../banco/tipos.ts';
import type { LinhaTarefa, NovaTarefa } from './tipos.ts';

const COLUNAS = `id, tipo, chave_idempotencia, descricao, carga, uasg, recurso_tipo, recurso_id, situacao, tentativas,
  maximo_tentativas, disponivel_em, bloqueada_ate, despachada_em, ultimo_erro, resultado, solicitada_por, criada_em,
  atualizada_em, concluida_em`;

/** Mensagens de erro guardadas e exibidas com no máximo 1.000 caracteres. */
export function resumirErro(mensagem: string): string {
  const limpa = mensagem.replace(/\s+/g, ' ').trim();
  return limpa.length > 1000 ? `${limpa.slice(0, 997)}...` : limpa;
}

export async function obterTarefa(executor: Executor, id: string): Promise<LinhaTarefa | null> {
  const [linha] = await executor.consultar<LinhaTarefa>(`SELECT ${COLUNAS} FROM fila_tarefas WHERE id = $1`, [id]);
  return linha ?? null;
}

/**
 * Enfileira na transação da ação de negócio (caixa de saída transacional). Se a chave de idempotência já existe,
 * devolve a tarefa existente com `criada: false` e nada é gravado.
 */
export async function enfileirar(
  tx: Transacao,
  nova: NovaTarefa,
  maximoTentativas: number,
  agora: Date,
): Promise<{ tarefa: LinhaTarefa; criada: boolean }> {
  const instante = agora.toISOString();
  const [inserida] = await tx.consultar<LinhaTarefa>(
    `INSERT INTO fila_tarefas (tipo, chave_idempotencia, descricao, carga, uasg, recurso_tipo, recurso_id, maximo_tentativas,
                               disponivel_em, solicitada_por, criada_em, atualizada_em)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $9, $9)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING ${COLUNAS}`,
    [
      nova.tipo,
      nova.chave,
      nova.descricao,
      JSON.stringify(nova.carga),
      nova.uasg ?? null,
      nova.recurso?.tipo ?? null,
      nova.recurso?.id ?? null,
      maximoTentativas,
      instante,
      nova.solicitadaPor ?? null,
    ],
  );
  if (inserida) return { tarefa: inserida, criada: true };
  const [existente] = await tx.consultar<LinhaTarefa>(`SELECT ${COLUNAS} FROM fila_tarefas WHERE chave_idempotencia = $1`, [nova.chave]);
  if (!existente) throw new Error(`Tarefa com a chave ${nova.chave} não encontrada após conflito.`);
  return { tarefa: existente, criada: false };
}

/**
 * Reserva a tarefa para execução: só se estiver pendente e disponível, ou em execução com a reserva vencida
 * (trabalhador que caiu no meio). Conta a tentativa. Devolve null se outra réplica já a pegou.
 */
export async function reservar(executor: Executor, id: string, agora: Date, reservaMs: number): Promise<LinhaTarefa | null> {
  const [linha] = await executor.consultar<LinhaTarefa>(
    `UPDATE fila_tarefas
        SET situacao = 'executando', tentativas = tentativas + 1, bloqueada_ate = $3, atualizada_em = $2
      WHERE id = $1
        AND ((situacao = 'pendente' AND disponivel_em <= $2) OR (situacao = 'executando' AND bloqueada_ate < $2))
      RETURNING ${COLUNAS}`,
    [id, agora.toISOString(), new Date(agora.getTime() + reservaMs).toISOString()],
  );
  return linha ?? null;
}

export async function concluir(tx: Transacao, id: string, resultado: Record<string, unknown>, agora: Date): Promise<void> {
  await tx.executar(
    `UPDATE fila_tarefas
        SET situacao = 'concluida', resultado = $2::jsonb, ultimo_erro = NULL, bloqueada_ate = NULL, concluida_em = $3, atualizada_em = $3
      WHERE id = $1`,
    [id, JSON.stringify(resultado), agora.toISOString()],
  );
}

export async function agendarNovaTentativa(tx: Transacao, id: string, erro: string, disponivelEm: Date, agora: Date): Promise<void> {
  await tx.executar(
    `UPDATE fila_tarefas
        SET situacao = 'pendente', ultimo_erro = $2, disponivel_em = $3, bloqueada_ate = NULL, despachada_em = $4, atualizada_em = $4
      WHERE id = $1`,
    [id, resumirErro(erro), disponivelEm.toISOString(), agora.toISOString()],
  );
}

export async function enviarParaErro(tx: Transacao, id: string, erro: string, agora: Date): Promise<void> {
  await tx.executar(
    `UPDATE fila_tarefas SET situacao = 'erro', ultimo_erro = $2, bloqueada_ate = NULL, atualizada_em = $3 WHERE id = $1`,
    [id, resumirErro(erro), agora.toISOString()],
  );
}

/** Tira a tarefa da fila de erro: volta a pendente, disponível agora, com as tentativas zeradas. */
export async function reabrir(tx: Transacao, id: string, agora: Date): Promise<LinhaTarefa | null> {
  const [linha] = await tx.consultar<LinhaTarefa>(
    `UPDATE fila_tarefas
        SET situacao = 'pendente', tentativas = 0, disponivel_em = $2, despachada_em = NULL, bloqueada_ate = NULL, atualizada_em = $2
      WHERE id = $1 AND situacao = 'erro'
      RETURNING ${COLUNAS}`,
    [id, agora.toISOString()],
  );
  return linha ?? null;
}

/** Antecipa uma tarefa pendente (ex.: "executar agora" durante a espera de nova tentativa). */
export async function antecipar(tx: Transacao, id: string, agora: Date): Promise<void> {
  await tx.executar(
    `UPDATE fila_tarefas SET disponivel_em = $2, despachada_em = NULL, atualizada_em = $2 WHERE id = $1 AND situacao = 'pendente'`,
    [id, agora.toISOString()],
  );
}

export async function marcarDespachada(executor: Executor, ids: readonly string[], agora: Date): Promise<void> {
  if (ids.length === 0) return;
  await executor.executar('UPDATE fila_tarefas SET despachada_em = $2 WHERE id = ANY($1::uuid[])', [ids, agora.toISOString()]);
}

/** Tarefas disponíveis para o trabalhador (PostgreSQL), em ordem de chegada. */
export async function disponiveis(executor: Executor, agora: Date, limite: number): Promise<string[]> {
  const linhas = await executor.consultar<{ id: string }>(
    `SELECT id FROM fila_tarefas
      WHERE (situacao = 'pendente' AND disponivel_em <= $1) OR (situacao = 'executando' AND bloqueada_ate < $1)
      ORDER BY disponivel_em, criada_em
      LIMIT $2`,
    [agora.toISOString(), limite],
  );
  return linhas.map((l) => l.id);
}

/**
 * Tarefas cujo aviso parece perdido (RabbitMQ): disponíveis há mais de `margemMs` sem terem sido executadas —
 * por exemplo, o RabbitMQ estava fora quando a API confirmou a transação. O trabalhador reenvia o aviso.
 */
export async function avisosPerdidos(executor: Executor, agora: Date, margemMs: number, limite: number): Promise<string[]> {
  const limiteInstante = new Date(agora.getTime() - margemMs).toISOString();
  const linhas = await executor.consultar<{ id: string }>(
    `SELECT id FROM fila_tarefas
      WHERE ((situacao = 'pendente' AND disponivel_em <= $1 AND (despachada_em IS NULL OR despachada_em <= $1))
             OR (situacao = 'executando' AND bloqueada_ate < $2))
      ORDER BY disponivel_em
      LIMIT $3`,
    [limiteInstante, agora.toISOString(), limite],
  );
  return linhas.map((l) => l.id);
}

/** Tarefa ativa (pendente ou em execução) de um recurso, para não enfileirar a mesma ação em paralelo. */
export async function tarefaAtiva(tx: Transacao, tipo: TipoTarefaFila, recursoId: string): Promise<LinhaTarefa | null> {
  const [linha] = await tx.consultar<LinhaTarefa>(
    `SELECT ${COLUNAS} FROM fila_tarefas
      WHERE tipo = $1 AND recurso_id = $2 AND situacao IN ('pendente', 'executando')
      ORDER BY criada_em DESC LIMIT 1
      FOR UPDATE`,
    [tipo, recursoId],
  );
  return linha ?? null;
}

export function mapearTarefa(l: LinhaTarefa): TarefaFila {
  const aguardando = l.situacao === 'pendente' && l.tentativas > 0;
  return {
    id: l.id,
    tipo: l.tipo,
    descricao: l.descricao,
    situacao: l.situacao,
    tentativas: l.tentativas,
    maximoTentativas: l.maximo_tentativas,
    proximaTentativaEm: aguardando ? l.disponivel_em : null,
    ultimoErro: l.ultimo_erro,
    chaveIdempotencia: l.chave_idempotencia,
    recurso: l.recurso_tipo && l.recurso_id ? { tipo: l.recurso_tipo, id: l.recurso_id } : null,
    uasg: l.uasg,
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
    concluidaEm: l.concluida_em,
  };
}

/** Listagem paginada no escopo de UASG do usuário (tarefas sem UASG, como as sincronizações, são do órgão todo). */
export async function listarTarefas(
  executor: Executor,
  filtro: { situacao: SituacaoTarefaFila | null; escopo: string[] | null; limite: number; inicio: number },
): Promise<{ itens: TarefaFila[]; total: number }> {
  const condicoes = `($1::text IS NULL OR situacao = $1)
     AND ($2::text[] IS NULL OR uasg IS NULL OR uasg = ANY($2::text[]))`;
  const parametros = [filtro.situacao, filtro.escopo] as const;
  const linhas = await executor.consultar<LinhaTarefa>(
    `SELECT ${COLUNAS} FROM fila_tarefas WHERE ${condicoes} ORDER BY atualizada_em DESC, id LIMIT $3 OFFSET $4`,
    [...parametros, filtro.limite, filtro.inicio],
  );
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total FROM fila_tarefas WHERE ${condicoes}`, [...parametros]);
  return { itens: linhas.map(mapearTarefa), total: contagem?.total ?? 0 };
}

export async function contarPorSituacao(
  executor: Executor,
  escopo: string[] | null,
  agora: Date,
): Promise<{ pendentes: number; executando: number; comErro: number; concluidasUltimas24h: number }> {
  const [linha] = await executor.consultar<{ pendentes: number; executando: number; com_erro: number; concluidas: number }>(
    `SELECT COUNT(*) FILTER (WHERE situacao = 'pendente')::integer AS pendentes,
            COUNT(*) FILTER (WHERE situacao = 'executando')::integer AS executando,
            COUNT(*) FILTER (WHERE situacao = 'erro')::integer AS com_erro,
            COUNT(*) FILTER (WHERE situacao = 'concluida' AND concluida_em >= $2)::integer AS concluidas
       FROM fila_tarefas
      WHERE ($1::text[] IS NULL OR uasg IS NULL OR uasg = ANY($1::text[]))`,
    [escopo, new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString()],
  );
  return {
    pendentes: linha?.pendentes ?? 0,
    executando: linha?.executando ?? 0,
    comErro: linha?.com_erro ?? 0,
    concluidasUltimas24h: linha?.concluidas ?? 0,
  };
}
