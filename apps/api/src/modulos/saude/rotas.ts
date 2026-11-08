import type { FastifyInstance } from 'fastify';

/** GET /saude/vivo e GET /saude/pronto (verifica o banco). Fora de /api/v1, sem autenticação. */
export async function rotasSaude(app: FastifyInstance): Promise<void> {
  app.get('/saude/vivo', async () => ({ situacao: 'ok' as const }));

  app.get('/saude/pronto', async (request, reply) => {
    const { banco, versao } = app.agora;
    const ok = await banco.verificar().catch((erro: unknown) => {
      request.log.warn({ err: erro }, 'banco indisponível na verificação de prontidão');
      return false;
    });
    return reply.status(ok ? 200 : 503).send({ situacao: ok ? 'ok' : 'indisponivel', banco: ok, versao });
  });
}
