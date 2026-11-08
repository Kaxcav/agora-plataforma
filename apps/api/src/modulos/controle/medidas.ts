/**
 * Medidas de controle externo (Lei 14.133/2021, art. 171): leitura das medidas registradas, com a situação do prazo
 * de resposta, o semáforo e o bloqueio (RN-30) calculados por @agora/dominio. A verificação que a jornada e os
 * contratos chamam antes de avançar, gerar ou assinar fica em `compartilhado/controle-externo.ts`.
 */
import { bloqueioControleExterno, prazoDecisaoMerito, situacaoMedidaControle, type OpcoesCalendario } from '@agora/dominio';
import type { MedidaControle, OrgaoControle, ReferenciaControle, TipoMedidaControle } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, padraoContem } from '../../compartilhado/texto.ts';

interface LinhaMedida {
  id: string;
  orgao: OrgaoControle;
  tipo: TipoMedidaControle;
  numero: string;
  decidida_em: string;
  ciencia_em: string;
  objeto: string;
  efeito_suspensivo: boolean;
  processo_id: string | null;
  processo_numero: string | null;
  contrato_id: string | null;
  contrato_numero: string | null;
  uasg: string;
  prazo_resposta: string;
  dias_uteis_prazo: number;
  fundamento_prazo: string;
  prorrogado_ate: string | null;
  justificativa_prorrogacao: string | null;
  respondida_em: string | null;
  resposta: string | null;
  respondida_por: string | null;
  respondida_por_nome: string | null;
  revogada_em: string | null;
  revogacao: string | null;
  revogada_por: string | null;
  revogada_por_nome: string | null;
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
}

const SELECAO_MEDIDA = `
  SELECT m.id, m.orgao, m.tipo, m.numero, m.decidida_em, m.ciencia_em, m.objeto, m.efeito_suspensivo,
         m.processo_id, p.numero_sei AS processo_numero, m.contrato_id, c.numero AS contrato_numero, m.uasg,
         m.prazo_resposta, m.dias_uteis_prazo, m.fundamento_prazo, m.prorrogado_ate, m.justificativa_prorrogacao,
         m.respondida_em, m.resposta, m.respondida_por, ur.nome AS respondida_por_nome,
         m.revogada_em, m.revogacao, m.revogada_por, uv.nome AS revogada_por_nome,
         m.registrada_por, ug.nome AS registrada_por_nome, m.registrada_em
    FROM medidas_controle m
    LEFT JOIN processos p ON p.id = m.processo_id
    LEFT JOIN contratos c ON c.id = m.contrato_id
    LEFT JOIN usuarios ur ON ur.id = m.respondida_por
    LEFT JOIN usuarios uv ON uv.id = m.revogada_por
    LEFT JOIN usuarios ug ON ug.id = m.registrada_por`;

export interface FiltroMedidasSql {
  escopo: string[] | null;
  uasg?: string | null | undefined;
  id?: string | undefined;
  orgao?: OrgaoControle | undefined;
  alvo?: 'processo' | 'contrato' | undefined;
  alvoId?: string | undefined;
  busca?: string | undefined;
}

/** Processo da jornada ou contrato atingido, com o caminho da tela correspondente. */
export function referenciaProcesso(id: string, numeroSei: string): ReferenciaControle {
  return { tipo: 'processo', id, identificador: `Processo ${numeroSei}`, caminho: `/jornada/${id}` };
}

export function referenciaContrato(id: string, numero: string): ReferenciaControle {
  return { tipo: 'contrato', id, identificador: identificadorInstrumento('contrato', numero), caminho: `/contratos/${id}` };
}

function mapear(l: LinhaMedida, hoje: string, calendario: OpcoesCalendario): MedidaControle {
  const situacao = situacaoMedidaControle(
    { prazoResposta: l.prazo_resposta, prorrogadoAte: l.prorrogado_ate, respondidaEm: l.respondida_em, revogadaEm: l.revogada_em },
    hoje,
    calendario,
  );
  const bloqueia = bloqueioControleExterno(
    [{ orgao: l.orgao, tipo: l.tipo, numero: l.numero, efeitoSuspensivo: l.efeito_suspensivo, cienciaEm: l.ciencia_em, revogadaEm: l.revogada_em }],
    hoje,
  ).bloqueado;
  const merito = bloqueia && l.respondida_em !== null ? prazoDecisaoMerito(l.respondida_em, false, calendario) : null;
  const alvo =
    l.processo_id !== null
      ? referenciaProcesso(l.processo_id, l.processo_numero ?? '')
      : referenciaContrato(l.contrato_id ?? '', l.contrato_numero ?? '');
  return {
    id: l.id,
    orgao: l.orgao,
    tipo: l.tipo,
    numero: l.numero,
    decididaEm: l.decidida_em,
    cienciaEm: l.ciencia_em,
    objeto: l.objeto,
    efeitoSuspensivo: l.efeito_suspensivo,
    alvo,
    uasg: l.uasg,
    prazoResposta: l.prazo_resposta,
    diasUteisPrazo: l.dias_uteis_prazo,
    fundamentoPrazo: l.fundamento_prazo,
    prorrogacao: l.prorrogado_ate !== null ? { ate: l.prorrogado_ate, justificativa: l.justificativa_prorrogacao ?? '' } : null,
    situacao: situacao.situacao,
    semaforo: situacao.semaforo,
    diasUteisRestantes: situacao.diasUteisRestantes,
    explicacao: situacao.explicacao,
    resposta: l.respondida_em !== null ? { em: l.respondida_em, texto: l.resposta ?? '', por: usuarioResumo(l.respondida_por, l.respondida_por_nome) } : null,
    revogacao: l.revogada_em !== null ? { em: l.revogada_em, texto: l.revogacao ?? '', por: usuarioResumo(l.revogada_por, l.revogada_por_nome) } : null,
    prazoDecisaoMerito: merito ? { limite: merito.vencimento, fundamento: `${merito.fundamento}; prazo do órgão de controle, informativo` } : null,
    bloqueia,
    registradaPor: usuarioResumo(l.registrada_por, l.registrada_por_nome),
    registradaEm: l.registrada_em,
  };
}

const ORDEM_SITUACAO: Record<MedidaControle['situacao'], number> = { resposta_vencida: 0, aguardando_resposta: 1, respondida: 2, revogada: 3 };

/** Ordem de exibição: cautelares que bloqueiam, prazos vencidos, prazos em curso (o mais próximo primeiro), respondidas e revogadas. */
export function ordenarMedidas(medidas: MedidaControle[]): MedidaControle[] {
  return [...medidas].sort(
    (a, b) =>
      Number(b.bloqueia) - Number(a.bloqueia) ||
      ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] ||
      (a.prorrogacao?.ate ?? a.prazoResposta).localeCompare(b.prorrogacao?.ate ?? b.prazoResposta) ||
      b.registradaEm.localeCompare(a.registradaEm),
  );
}

/** Medidas no escopo de UASG do usuário, já com situação, semáforo e bloqueio calculados para `hoje`. */
export async function carregarMedidas(
  executor: Executor,
  filtro: FiltroMedidasSql,
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<MedidaControle[]> {
  const linhas = await executor.consultar<LinhaMedida>(
    `${SELECAO_MEDIDA}
      WHERE ($1::text[] IS NULL OR m.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR m.uasg = $2)
        AND ($3::uuid IS NULL OR m.id = $3)
        AND ($4::text IS NULL OR m.orgao = $4)
        AND ($5::text IS NULL OR ($5 = 'processo' AND m.processo_id IS NOT NULL) OR ($5 = 'contrato' AND m.contrato_id IS NOT NULL))
        AND ($6::uuid IS NULL OR m.processo_id = $6 OR m.contrato_id = $6)
        AND ($7::text IS NULL OR m.busca_normalizada LIKE $7 ESCAPE '\\')
      ORDER BY m.registrada_em DESC, m.id`,
    [
      filtro.escopo,
      filtro.uasg ?? null,
      filtro.id ?? null,
      filtro.orgao ?? null,
      filtro.alvo ?? null,
      filtro.alvoId ?? null,
      filtro.busca ? padraoContem(filtro.busca) : null,
    ],
  );
  return ordenarMedidas(linhas.map((l) => mapear(l, hoje, calendario)));
}
