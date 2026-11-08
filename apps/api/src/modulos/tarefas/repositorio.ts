import type { Tarefa } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

export interface LinhaTarefa {
  id: string;
  titulo: string;
  macrotarefa: string;
  prazo: string | null;
  situacao: 'pendente' | 'concluida';
  responsavel_id: string | null;
  responsavel_nome: string | null;
  concluida_em: string | null;
  uasg: string;
  instrumento_tipo: 'ata' | 'contrato';
  instrumento_id: string;
}

export const SELECAO_TAREFA = `
  SELECT t.id, t.titulo, t.macrotarefa, t.prazo, t.situacao, t.responsavel_id, u.nome AS responsavel_nome,
         t.concluida_em, t.uasg, t.instrumento_tipo, t.instrumento_id
    FROM tarefas t
    LEFT JOIN usuarios u ON u.id = t.responsavel_id`;

/** Tarefa pendente com prazo vencido aparece como 'atrasada'. */
export function mapearTarefa(l: LinhaTarefa, hoje: string): Tarefa {
  return {
    id: l.id,
    titulo: l.titulo,
    macrotarefa: l.macrotarefa,
    prazo: l.prazo,
    situacao: l.situacao === 'concluida' ? 'concluida' : l.prazo !== null && l.prazo < hoje ? 'atrasada' : 'pendente',
    responsavel: usuarioResumo(l.responsavel_id, l.responsavel_nome),
    concluidaEm: l.concluida_em,
  };
}

export async function tarefasDoInstrumento(
  executor: Executor,
  tipo: 'ata' | 'contrato',
  id: string,
  hoje: string,
): Promise<Tarefa[]> {
  const linhas = await executor.consultar<LinhaTarefa>(
    `${SELECAO_TAREFA}
      WHERE t.instrumento_tipo = $1 AND t.instrumento_id = $2
      ORDER BY t.prazo NULLS LAST, t.macrotarefa, t.titulo`,
    [tipo, id],
  );
  return linhas.map((l) => mapearTarefa(l, hoje));
}
