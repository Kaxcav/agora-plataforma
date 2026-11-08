import type { EventoHistorico } from '@agora/contratos';
import type { Executor } from '../banco/tipos.ts';
import { usuarioResumo } from '../compartilhado/instrumentos.ts';

interface LinhaHistorico {
  id: string;
  ocorrido_em: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  resumo: string;
  detalhes: string | null;
}

/**
 * Histórico de um instrumento, lido da trilha de auditoria: eventos do próprio recurso e eventos
 * de pendências, tarefas e vínculos que o referenciam (`dados.instrumentoTipo` / `dados.instrumentoId`).
 */
export async function listarHistorico(executor: Executor, tipo: 'ata' | 'contrato', id: string): Promise<EventoHistorico[]> {
  const linhas = await executor.consultar<LinhaHistorico>(
    `SELECT e.id, e.ocorrido_em, e.usuario_id, u.nome AS usuario_nome, e.resumo, e.dados ->> 'detalhes' AS detalhes
       FROM auditoria_eventos e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE (e.recurso = $1 AND e.recurso_id = $2)
         OR (e.dados ->> 'instrumentoTipo' = $1 AND e.dados ->> 'instrumentoId' = $2)
      ORDER BY e.sequencia DESC
      LIMIT 200`,
    [tipo, id],
  );
  return linhas.map((l) => ({
    id: l.id,
    ocorridoEm: l.ocorrido_em,
    usuario: usuarioResumo(l.usuario_id, l.usuario_nome),
    acao: l.resumo,
    detalhes: l.detalhes,
  }));
}
