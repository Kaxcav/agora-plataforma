/**
 * Atesto da nota fiscal: um único fluxo para a tela de Pagamentos e para o recebimento definitivo (RN-34).
 *
 * - Só de 'previsto' para 'atestado', depois do recheque de regularidade do contratado (RN-23): nova consulta ao
 *   CEIS/CNEP e conferência das certidões, registrada. Irregularidade não impede o atesto do que foi executado: abre
 *   pendência para notificar o contratado (art. 92, XVI).
 * - Nota ligada a uma entrega da contratada só é atestada depois do recebimento definitivo da entrega (art. 140):
 *   o definitivo é o ato que libera a liquidação (Lei 4.320/1964, art. 63).
 * - Conferência da nota (RN-36, frente M): divergente sem justificativa, ou ausente em contrato com IMR, bloqueia o
 *   atesto; conferida, a parcela segue para liquidação pelo valor a liquidar.
 */
import type { VerificacaoRegularidade } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { conflito, naoEncontrado } from '../../http/erros.ts';
import { exigirConferenciaLiberada, situacaoAtestoConferencia } from '../imr/servico.ts';
import { abrirPendenciaRegularidade } from '../regularidade/servico.ts';

export interface PagamentoParaAtesto {
  situacao: string;
  contrato_id: string;
  fornecedor_id: string;
  nota_fiscal: string;
  competencia: string;
}

/** Pagamento no escopo de UASG, com o fornecedor do contrato (null = fora do escopo ou inexistente). */
export async function pagamentoParaAtesto(executor: Executor, id: string, escopo: string[] | null): Promise<PagamentoParaAtesto | null> {
  const [linha] = await executor.consultar<PagamentoParaAtesto>(
    `SELECT p.situacao, p.contrato_id, c.fornecedor_id, p.nota_fiscal, p.competencia
       FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id
      WHERE p.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  return linha ?? null;
}

/** 409 enquanto a nota estiver ligada a entrega sem recebimento definitivo (o definitivo libera a liquidação). */
export async function exigirRecebimentoDefinitivo(executor: Executor, pagamentoId: string): Promise<void> {
  const pendentes = await executor.consultar<{ numero: number }>(
    `SELECT numero FROM contratos_recebimentos WHERE pagamento_id = $1 AND situacao <> 'recebido' ORDER BY numero`,
    [pagamentoId],
  );
  if (pendentes.length > 0) {
    throw conflito(
      `Esta nota fiscal está ligada à entrega nº ${pendentes.map((p) => p.numero).join(', ')}, ainda sem recebimento definitivo. O atesto sai com o termo de recebimento definitivo (Lei 14.133/2021, art. 140).`,
    );
  }
}

/**
 * Grava o atesto na transação do chamador, com a pendência de regularidade quando houver restrição e o evento da
 * trilha. `origem` registra se o atesto veio da tela de Pagamentos ou do termo de recebimento definitivo.
 */
export async function registrarAtesto(
  tx: Transacao,
  ctx: ContextoApp,
  request: FastifyRequest,
  e: { pagamentoId: string; escopo: string[] | null; verificacao: VerificacaoRegularidade; usuarioId: string; recebimentoId?: string | null },
): Promise<{ pendenciaId: string | null; notaFiscal: string; contratoId: string }> {
  const [alvo] = await tx.consultar<{ situacao: string; contrato_id: string; nota_fiscal: string; competencia: string; valor: number }>(
    `SELECT p.situacao, p.contrato_id, p.nota_fiscal, p.competencia, p.valor
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
      WHERE p.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))
      FOR UPDATE OF p`,
    [e.pagamentoId, e.escopo],
  );
  if (!alvo) throw naoEncontrado('Pagamento não encontrado.');
  if (alvo.situacao !== 'previsto') throw conflito('Somente pagamentos na situação "previsto" podem ser atestados.');
  await exigirRecebimentoDefinitivo(tx, e.pagamentoId);
  const conferencia = await situacaoAtestoConferencia(tx, { id: e.pagamentoId, contrato_id: alvo.contrato_id, competencia: alvo.competencia });
  exigirConferenciaLiberada(conferencia);
  await tx.executar(`UPDATE pagamentos SET situacao = 'atestado', atestado_por = $2, atestado_em = $3 WHERE id = $1`, [
    e.pagamentoId,
    e.usuarioId,
    ctx.relogio().toISOString(),
  ]);
  // RN-36: com a nota conferida, a parcela segue para liquidação pelo valor a liquidar (o menor entre a nota e o devido).
  const conferenciaNota = conferencia.conferencia
    ? { ...conferencia.conferencia, valor: { de: alvo.valor, para: conferencia.conferencia.valorALiquidar } }
    : null;
  if (conferenciaNota && conferenciaNota.valorALiquidar !== alvo.valor) {
    await tx.executar('UPDATE pagamentos SET valor = $2 WHERE id = $1', [e.pagamentoId, conferenciaNota.valorALiquidar]);
  }
  const v = e.verificacao;
  const pendenciaId = v.regular
    ? null
    : await abrirPendenciaRegularidade(tx, ctx, { contratoId: alvo.contrato_id, notaFiscal: alvo.nota_fiscal, momento: 'atesto', verificacao: v });
  const viaRecebimento = e.recebimentoId ? ' no recebimento definitivo da entrega' : '';
  await auditar(tx, request, {
    acao: 'pagamento.atestar',
    recurso: 'pagamento',
    recursoId: e.pagamentoId,
    resumo: v.regular
      ? `Atestou a nota fiscal ${alvo.nota_fiscal}${viaRecebimento}`
      : `Atestou a nota fiscal ${alvo.nota_fiscal}${viaRecebimento} com ressalva de regularidade do contratado (RN-23)`,
    dados: {
      instrumentoTipo: 'contrato',
      instrumentoId: alvo.contrato_id,
      situacao: { de: 'previsto', para: 'atestado' },
      regularidade: { verificacaoId: v.id, regular: v.regular, motivos: v.motivos, pendenciaId },
      ...(conferenciaNota ? { conferenciaNota } : {}),
      ...(e.recebimentoId ? { recebimentoId: e.recebimentoId } : {}),
    },
  });
  return { pendenciaId, notaFiscal: alvo.nota_fiscal, contratoId: alvo.contrato_id };
}
