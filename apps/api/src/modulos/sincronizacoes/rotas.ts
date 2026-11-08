import type { Sincronizacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../autorizacao/exigir.ts';
import { FONTES_EXECUTAVEIS } from '../../integracoes/conector.ts';
import { listarSincronizacoes } from '../../integracoes/servico.ts';
import { situacaoAposPedido, solicitarSincronizacao } from '../fila/sincronizacao.ts';

const esquemaFonte = z.object({ fonte: z.enum(FONTES_EXECUTAVEIS) });

export async function rotasSincronizacoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/sincronizacoes', { preHandler: exigir('painel:ler') }, async (): Promise<Sincronizacao[]> =>
    listarSincronizacoes(ctx.banco, ctx.config.integracoes),
  );

  // A API só publica a tarefa na fila (RNF-07); o trabalhador executa o conector. Com o trabalhador embutido, a
  // resposta espera a execução (200); com o trabalhador à parte, volta 202 com a sincronização "executando".
  app.post('/sincronizacoes/:fonte/executar', { preHandler: exigir('integracoes:executar') }, async (request, reply): Promise<Sincronizacao> => {
    const { fonte } = esquemaFonte.parse(request.params);
    const tarefa = await solicitarSincronizacao(ctx, app.fila, fonte, request);
    const { pendente, sincronizacao } = await situacaoAposPedido(ctx, fonte, await app.fila.aguardar(tarefa.id));
    if (pendente) reply.code(202);
    return sincronizacao;
  });
}
