/**
 * Sincronizações pela fila (RNF-07): a rota só publica a tarefa; o trabalhador executa o conector
 * (`executarSincronizacao`, com proveniência e auditoria). Falha da fonte externa gera nova tentativa automática.
 */
import { randomUUID } from 'node:crypto';
import { chaveIdempotencia } from '@agora/dominio';
import type { Sincronizacao } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicoFila } from '../../fila/servico.ts';
import { antecipar, tarefaAtiva } from '../../fila/registro.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { conflito } from '../../http/erros.ts';
import { CONJUNTOS, FONTES_EXECUTAVEIS, type FonteExecutavel } from '../../integracoes/conector.ts';
import { executarSincronizacao, listarSincronizacoes } from '../../integracoes/servico.ts';

const cargaSincronizacao = z.object({
  fonte: z.enum(FONTES_EXECUTAVEIS),
  usuarioId: z.uuid().nullable(),
  ipHash: z.string().nullable(),
});

/** Executa a sincronização pedida na fila; falha da fonte vira nova tentativa com espera exponencial. */
export async function executarTarefaSincronizacao(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const carga = cargaSincronizacao.safeParse(tarefa.carga);
  if (!carga.success) throw new FalhaTarefa('Tarefa de sincronização com dados inválidos.', false);
  const { fonte, usuarioId, ipHash } = carga.data;
  const resultado = await executarSincronizacao(ctx, fonte, { usuarioId, ipHash });
  if (resultado.situacao === 'falhou') throw new FalhaTarefa(resultado.mensagem ?? `Falha na sincronização com ${fonte}.`, true);
  return { resultado: { registros: resultado.registrosProcessados, hashConteudo: resultado.hashConteudo, mensagem: resultado.mensagem } };
}

/**
 * Publica a sincronização de uma fonte. Se já houver uma pendente (inclusive aguardando nova tentativa), ela é
 * antecipada em vez de duplicada; se houver uma em execução, a nova é recusada (409).
 */
export async function solicitarSincronizacao(
  ctx: ContextoApp,
  fila: ServicoFila,
  fonte: FonteExecutavel,
  request: FastifyRequest,
): Promise<LinhaTarefa> {
  const usuarioId = request.sessao?.usuario.id ?? null;
  const conjunto = CONJUNTOS.find((c) => c.fonte === fonte)?.conjunto ?? fonte;
  const tarefa = await ctx.banco.transacao(async (tx) => {
    const agora = ctx.relogio();
    const ativa = await tarefaAtiva(tx, 'sincronizacao', fonte);
    if (ativa?.situacao === 'executando' && ativa.bloqueada_ate !== null && Date.parse(ativa.bloqueada_ate) > agora.getTime()) {
      throw conflito('Já existe uma sincronização desta fonte em andamento.');
    }
    if (ativa) {
      await antecipar(tx, ativa.id, agora);
      await auditar(tx, request, {
        acao: 'fila.antecipar',
        recurso: 'fila_tarefa',
        recursoId: ativa.id,
        resumo: `Antecipou a sincronização de ${conjunto} (${fonte}) que aguardava na fila de integrações`,
        dados: { fonte, tentativas: ativa.tentativas },
      });
      return ativa;
    }
    const { tarefa: nova } = await fila.enfileirar(tx, {
      tipo: 'sincronizacao',
      chave: chaveIdempotencia(['sincronizacao', fonte, randomUUID()]),
      descricao: `Sincronizar ${conjunto} (${fonte})`,
      carga: { fonte, usuarioId, ipHash: request.ipHash || null },
      recurso: { tipo: 'sincronizacao', id: fonte },
      solicitadaPor: usuarioId,
    });
    await auditar(tx, request, {
      acao: 'fila.enfileirar',
      recurso: 'fila_tarefa',
      recursoId: nova.id,
      resumo: `Pediu a sincronização de ${conjunto} (${fonte}) pela fila de integrações`,
      dados: { fonte, tipo: nova.tipo, chaveIdempotencia: nova.chave_idempotencia, transporte: fila.driver.transporte },
    });
    return nova;
  });
  await fila.despachar([tarefa]);
  return tarefa;
}

/**
 * Situação devolvida à tela: o resultado da execução, quando o trabalhador já rodou; senão a sincronização aparece
 * "executando", com a explicação de que está na fila.
 */
export async function situacaoAposPedido(ctx: ContextoApp, fonte: FonteExecutavel, tarefa: LinhaTarefa | null): Promise<{ pendente: boolean; sincronizacao: Sincronizacao }> {
  const lista = await listarSincronizacoes(ctx.banco, ctx.config.integracoes);
  const atual = lista.find((s) => s.fonte === fonte);
  if (!atual) throw new Error(`Fonte sem conjunto definido: ${fonte}`);
  const naoExecutou = tarefa !== null && (tarefa.situacao === 'executando' || (tarefa.situacao === 'pendente' && tarefa.tentativas === 0));
  if (!naoExecutou) return { pendente: false, sincronizacao: atual };
  return {
    pendente: true,
    sincronizacao: { ...atual, situacao: 'executando', mensagem: 'Na fila de integrações: o serviço trabalhador executa a sincronização em seguida.' },
  };
}
