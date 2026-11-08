/**
 * Ligação do registro de desempenho (RN-37) com a sala de disputa (frente E): cada participante recebe a nota do
 * registro, usada no desempate do art. 60, II; na técnica e preço, se o edital adotou a fórmula do desempenho
 * anterior, a nota técnica passa a ser a composta (art. 36, § 3º; art. 37, III), guardando a composição.
 */
import { comporNotaTecnicaComDesempenho, type CriterioJulgamentoDisputa } from '@agora/dominio';
import type { Executor } from '../../banco/tipos.ts';
import type { ParticipanteArmazenado } from '../disputa/servico.ts';
import { criterioDesempenhoDoProcesso, notasDoRegistro } from './repositorio.ts';

export async function comDesempenhoRegistrado(
  executor: Executor,
  processoId: string,
  criterio: CriterioJulgamentoDisputa,
  participantes: readonly ParticipanteArmazenado[],
  hoje: string,
): Promise<ParticipanteArmazenado[]> {
  const notas = await notasDoRegistro(executor, participantes.map((p) => p.fornecedorId), hoje);
  const formula = criterio === 'tecnica_e_preco' ? await criterioDesempenhoDoProcesso(executor, processoId) : null;
  return participantes.map((p) => {
    const notaDesempenhoPrevio = notas.get(p.fornecedorId) ?? null;
    if (!formula || p.notaTecnica === null) return { ...p, notaDesempenhoPrevio };
    const c = comporNotaTecnicaComDesempenho(p.notaTecnica, notaDesempenhoPrevio, formula);
    return {
      ...p,
      notaDesempenhoPrevio,
      notaTecnica: c.notaTecnica,
      composicaoNotaTecnica: { notaProposta: c.notaProposta, notaDesempenho: c.notaDesempenho, origem: c.origem, memoria: c.memoria },
    };
  });
}
