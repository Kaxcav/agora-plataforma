/**
 * RN-30 — verificação de controle externo (Lei 14.133/2021, art. 171, §§ 1º e 2º) para a jornada e os contratos.
 * Chame antes de avançar a etapa, gerar ou assinar o contrato e assinar termos do contrato: medida cautelar com efeito
 * suspensivo não revogada sobre o processo, sobre o contrato ou sobre o processo que gerou o contrato bloqueia a ação.
 * O bloqueio e a mensagem vêm de `bloqueioControleExterno` (@agora/dominio).
 */
import { bloqueioControleExterno, type OrgaoControle, type TipoMedidaControle } from '@agora/dominio';
import type { Bloqueio, EtapaJornada } from '@agora/contratos';
import type { Executor } from '../banco/tipos.ts';
import { regraNegocio } from '../http/erros.ts';

export interface AlvoControle {
  processoId?: string | null;
  contratoId?: string | null;
}

export interface VerificacaoControleExterno {
  bloqueado: boolean;
  mensagem: string | null;
  fundamento: string;
  /** Ids das medidas suspensivas em vigor. */
  medidas: string[];
}

/** Não aplica escopo de UASG: a trava vale para qualquer usuário que tente avançar, gerar ou assinar. */
export async function verificarControleExterno(executor: Executor, alvo: AlvoControle, hoje: string): Promise<VerificacaoControleExterno> {
  const linhas = await executor.consultar<{
    id: string;
    orgao: OrgaoControle;
    tipo: TipoMedidaControle;
    numero: string;
    ciencia_em: string;
    revogada_em: string | null;
  }>(
    `SELECT m.id, m.orgao, m.tipo, m.numero, m.ciencia_em, m.revogada_em
       FROM medidas_controle m
      WHERE m.efeito_suspensivo
        AND (($1::uuid IS NOT NULL AND m.processo_id = $1)
             OR ($2::uuid IS NOT NULL AND m.contrato_id = $2)
             OR ($2::uuid IS NOT NULL AND m.processo_id IN (SELECT p.id FROM processos p WHERE p.contrato_id = $2)))
      ORDER BY m.ciencia_em, m.numero`,
    [alvo.processoId ?? null, alvo.contratoId ?? null],
  );
  const r = bloqueioControleExterno(
    linhas.map((l) => ({ id: l.id, orgao: l.orgao, tipo: l.tipo, numero: l.numero, efeitoSuspensivo: true, cienciaEm: l.ciencia_em, revogadaEm: l.revogada_em })),
    hoje,
  );
  return { bloqueado: r.bloqueado, mensagem: r.mensagem, fundamento: r.fundamento, medidas: r.ativas.map((m) => m.id) };
}

/** Lança 422 `REGRA_NEGOCIO` (detalhe com campo `RN-30`) quando há cautelar suspensiva em vigor sobre o alvo. */
export async function exigirSemCautelarSuspensiva(executor: Executor, alvo: AlvoControle, hoje: string): Promise<void> {
  const r = await verificarControleExterno(executor, alvo, hoje);
  if (r.bloqueado && r.mensagem !== null) throw regraNegocio(r.mensagem, [{ campo: 'RN-30', mensagem: `${r.mensagem} (${r.fundamento})` }]);
}

/** Bloqueio da jornada (RN-30) para `avaliarProcesso`: aparece junto dos demais bloqueios da etapa atual. */
export async function bloqueiosControleExterno(executor: Executor, processoId: string, etapa: EtapaJornada, hoje: string): Promise<Bloqueio[]> {
  const r = await verificarControleExterno(executor, { processoId }, hoje);
  return r.bloqueado && r.mensagem !== null ? [{ regra: 'RN-30', mensagem: r.mensagem, fundamento: r.fundamento, etapa }] : [];
}
