import type { Tarefa } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado } from '../../http/erros.ts';
import { idDaRota } from '../../http/validacao.ts';
import { SELECAO_TAREFA, mapearTarefa, type LinhaTarefa } from './repositorio.ts';

const esquemaAtualizacao = z.object({ situacao: z.enum(['pendente', 'concluida']) });

export async function rotasTarefas(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.patch('/tarefas/:id', { preHandler: exigir('tarefas:editar') }, async (request): Promise<Tarefa> => {
    const id = idDaRota(request.params);
    const { situacao } = esquemaAtualizacao.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);

    const linha = await ctx.banco.transacao(async (tx) => {
      const [atual] = await tx.consultar<LinhaTarefa>(
        `${SELECAO_TAREFA} WHERE t.id = $1 AND ($2::text[] IS NULL OR t.uasg = ANY($2::text[])) FOR UPDATE OF t`,
        [id, escopo],
      );
      if (!atual) throw naoEncontrado('Tarefa não encontrada.');
      if (atual.situacao === situacao) return atual;
      const agora = ctx.relogio().toISOString();
      await tx.executar(
        `UPDATE tarefas SET situacao = $2, concluida_em = $3, concluida_por = $4 WHERE id = $1`,
        situacao === 'concluida' ? [id, situacao, agora, sessao.usuario.id] : [id, situacao, null, null],
      );
      await auditar(tx, request, {
        acao: situacao === 'concluida' ? 'tarefa.concluir' : 'tarefa.reabrir',
        recurso: 'tarefa',
        recursoId: id,
        resumo: `${situacao === 'concluida' ? 'Concluiu' : 'Reabriu'} a tarefa "${atual.titulo}"`,
        dados: {
          instrumentoTipo: atual.instrumento_tipo,
          instrumentoId: atual.instrumento_id,
          situacao: { de: atual.situacao, para: situacao },
        },
      });
      const [nova] = await tx.consultar<LinhaTarefa>(`${SELECAO_TAREFA} WHERE t.id = $1`, [id]);
      if (!nova) throw naoEncontrado('Tarefa não encontrada.');
      return nova;
    });
    return mapearTarefa(linha, ctx.hoje());
  });
}
