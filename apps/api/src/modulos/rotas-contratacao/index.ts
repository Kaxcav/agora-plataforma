import type { FastifyInstance } from 'fastify';
import { rotasCartaoPagamento } from './cartao.ts';
import { rotasProcessoContratacao } from './rotas.ts';
import { rotasSicx } from './sicx.ts';

/** Rotas de contratação (F9): escolha da rota, dispensa eletrônica, inexigibilidade, adesão, Sicx e cartão de pagamento. */
export async function rotasRotasContratacao(app: FastifyInstance): Promise<void> {
  await rotasProcessoContratacao(app);
  await rotasSicx(app);
  await rotasCartaoPagamento(app);
}
