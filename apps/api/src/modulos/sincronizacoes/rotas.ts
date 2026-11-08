import type { Sincronizacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { FONTES_EXECUTAVEIS } from '../../integracoes/conector.ts';
import { executarSincronizacao, listarSincronizacoes } from '../../integracoes/servico.ts';

const esquemaFonte = z.object({ fonte: z.enum(FONTES_EXECUTAVEIS) });

export async function rotasSincronizacoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/sincronizacoes', { preHandler: exigir('painel:ler') }, async (): Promise<Sincronizacao[]> =>
    listarSincronizacoes(ctx.banco, ctx.config.integracoes),
  );

  app.post('/sincronizacoes/:fonte/executar', { preHandler: exigir('integracoes:executar') }, async (request): Promise<Sincronizacao> => {
    const { fonte } = esquemaFonte.parse(request.params);
    return executarSincronizacao(ctx, fonte, { usuarioId: sessaoDe(request).usuario.id, ipHash: request.ipHash });
  });
}
