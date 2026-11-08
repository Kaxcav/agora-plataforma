import type { FastifyRequest } from 'fastify';
import type { Transacao } from '../banco/tipos.ts';
import { registrarEvento, type EntradaEvento, type EventoGravado } from '../auditoria/trilha.ts';

/** Registra o evento da requisição atual (usuário da sessão, IP em hash) na mesma transação da escrita. */
export function auditar(
  tx: Transacao,
  request: FastifyRequest,
  evento: Omit<EntradaEvento, 'usuarioId' | 'ipHash'> & { usuarioId?: string | null },
): Promise<EventoGravado> {
  return registrarEvento(
    tx,
    {
      ...evento,
      usuarioId: evento.usuarioId === undefined ? (request.sessao?.usuario.id ?? null) : evento.usuarioId,
      ipHash: request.ipHash || null,
    },
    request.server.agora.relogio(),
  );
}
