/**
 * RN-29 — matriz de riscos do contrato e revisões trimestrais (Lei 14.133/2021, arts. 22 e 169). A matriz vigente é a
 * da revisão mais recente; sem revisão, a do processo da jornada que gerou o contrato. A situação da revisão vem de
 * `situacaoRevisaoRiscos` (@agora/dominio).
 */
import { situacaoRevisaoRiscos } from '@agora/dominio';
import type { ContratoRevisaoRiscos, MatrizRiscosContrato, RevisaoMatrizRiscos, RiscoMatriz } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { referenciaContrato } from './medidas.ts';

interface LinhaRevisao {
  id: string;
  revisada_em: string;
  linha: 'primeira' | 'segunda';
  observacao: string;
  riscos: RiscoMatriz[];
  revisada_por: string | null;
  revisada_por_nome: string | null;
  registrada_em: string;
}

export interface ContratoParaRiscos {
  id: string;
  vigenciaInicio: string;
  vigenciaFim: string;
}

export async function obterMatrizRiscosContrato(executor: Executor, contrato: ContratoParaRiscos, hoje: string): Promise<MatrizRiscosContrato> {
  const linhas = await executor.consultar<LinhaRevisao>(
    `SELECT r.id, r.revisada_em, r.linha, r.observacao, r.riscos, r.revisada_por, u.nome AS revisada_por_nome, r.registrada_em
       FROM revisoes_matriz_riscos r
       LEFT JOIN usuarios u ON u.id = r.revisada_por
      WHERE r.contrato_id = $1
      ORDER BY r.revisada_em DESC, r.registrada_em DESC`,
    [contrato.id],
  );
  const [processo] = await executor.consultar<{ id: string; numero_sei: string; riscos: RiscoMatriz[] }>(
    'SELECT id, numero_sei, riscos FROM processos WHERE contrato_id = $1',
    [contrato.id],
  );
  const revisoes: RevisaoMatrizRiscos[] = linhas.map((l) => ({
    id: l.id,
    revisadaEm: l.revisada_em,
    linha: l.linha,
    observacao: l.observacao,
    riscos: l.riscos,
    revisadaPor: usuarioResumo(l.revisada_por, l.revisada_por_nome),
    registradaEm: l.registrada_em,
  }));
  const ultima = revisoes[0];
  return {
    origem: ultima ? 'revisao' : processo && processo.riscos.length > 0 ? 'processo' : 'sem_matriz',
    processo: processo ? { id: processo.id, numeroSei: processo.numero_sei } : null,
    riscos: ultima?.riscos ?? processo?.riscos ?? [],
    revisao: situacaoRevisaoRiscos({
      inicioVigencia: contrato.vigenciaInicio,
      vigenciaFim: contrato.vigenciaFim,
      ultimaRevisao: ultima?.revisadaEm ?? null,
      hoje,
    }),
    revisoes,
  };
}

/** Contratos do escopo com a revisão trimestral vencida ou a vencer (alerta das linhas de defesa). */
export async function revisoesRiscosPendentes(executor: Executor, escopo: string[] | null, uasg: string | null, hoje: string): Promise<ContratoRevisaoRiscos[]> {
  const linhas = await executor.consultar<{
    id: string;
    numero: string;
    uasg: string;
    objeto: string;
    vigencia_inicio: string;
    vigencia_fim: string;
    ultima: string | null;
  }>(
    `SELECT c.id, c.numero, c.uasg, c.objeto, c.vigencia_inicio, c.vigencia_fim, MAX(r.revisada_em) AS ultima
       FROM contratos c
       LEFT JOIN revisoes_matriz_riscos r ON r.contrato_id = c.id
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
        AND c.vigencia_fim >= $3::date
      GROUP BY c.id, c.numero, c.uasg, c.objeto, c.vigencia_inicio, c.vigencia_fim`,
    [escopo, uasg, hoje],
  );
  return linhas
    .map((l) => ({
      contrato: referenciaContrato(l.id, l.numero),
      uasg: l.uasg,
      objeto: l.objeto,
      revisao: situacaoRevisaoRiscos({ inicioVigencia: l.vigencia_inicio, vigenciaFim: l.vigencia_fim, ultimaRevisao: l.ultima, hoje }),
    }))
    .filter((c) => c.revisao.situacao === 'vencida' || c.revisao.situacao === 'a_vencer')
    .sort((a, b) => (a.revisao.diasRestantes ?? 0) - (b.revisao.diasRestantes ?? 0) || a.contrato.identificador.localeCompare(b.contrato.identificador, 'pt-BR'));
}
