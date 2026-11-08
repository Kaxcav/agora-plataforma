/**
 * Ligações da execução contratual com a central de notificações (frente J) e com o cadastro do contrato:
 *
 * - notificação à contratada (ocorrência, ressalva, exigência e recomposição de garantia) pelo disparo manual da
 *   central, gravado na transação do ato (outbox) e enviado depois por `processarFila`;
 * - aviso de vencimento da garantia com a mesma chave de idempotência da varredura diária, para não duplicar;
 * - espelho da garantia de execução vigente e das designações de gestor e fiscal técnico nas colunas do contrato
 *   que o resto da Ágora já usa (cartão de garantia, varredura de avisos, achados de contrato sem fiscal).
 */
import { avaliarAvisoGarantia, montarMensagemNotificacao, ROTULOS_MODALIDADE_GARANTIA, type ModalidadeGarantia } from '@agora/dominio';
import type { FastifyRequest } from 'fastify';
import type { Transacao } from '../../banco/tipos.ts';
import { identificadorInstrumento } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { regraNegocio } from '../../http/erros.ts';
import {
  carregarInstrumento,
  criarNotificacaoManual,
  ErroDisparo,
  gravarNotificacao,
  instrumentoDaMensagem,
  resolverDestinatarios,
} from '../notificacoes/servico.ts';

/**
 * Notifica a contratada (e-mail e registro no processo SEI) pela central. Devolve o id da notificação; o envio
 * acontece depois do commit (`processarFila`).
 */
export async function notificarContratada(
  tx: Transacao,
  ctx: ContextoApp,
  request: FastifyRequest,
  e: { contratoId: string; tipo: 'ocorrencia' | 'pendencia'; detalhe: string; dataReferencia: string | null; complemento?: string | null },
): Promise<string> {
  const instrumento = await carregarInstrumento(tx, 'contrato', e.contratoId, null);
  if (!instrumento) throw regraNegocio('Contrato não encontrado para a notificação.');
  const usuarioId = request.sessao?.usuario.id ?? '';
  let gravada: Awaited<ReturnType<typeof criarNotificacaoManual>>;
  try {
    gravada = await criarNotificacaoManual(
      tx,
      ctx.config,
      ctx.relogio(),
      ctx.hoje(),
      instrumento,
      { tipo: e.tipo, destinatarios: ['contratada'], canais: ['email', 'sei'], dataReferencia: e.dataReferencia, detalhe: e.detalhe, complemento: e.complemento ?? null },
      usuarioId,
    );
  } catch (erro) {
    if (erro instanceof ErroDisparo) throw regraNegocio(erro.message);
    throw erro;
  }
  await auditar(tx, request, {
    acao: 'notificacao.disparar',
    recurso: 'notificacao',
    recursoId: gravada.id,
    resumo: `Disparou aviso de ${e.tipo === 'ocorrencia' ? 'ocorrência' : 'pendência'} — ${identificadorInstrumento('contrato', instrumento.numero)}, para contratada por e-mail, SEI`,
    dados: {
      instrumentoTipo: 'contrato',
      instrumentoId: e.contratoId,
      tipo: e.tipo,
      destinatarios: ['contratada'],
      canais: ['email', 'sei'],
      obrigatoria: gravada.mensagem.obrigatoria,
      envios: gravada.envios,
      suprimidos: gravada.suprimidos,
    },
  });
  return gravada.id;
}

/**
 * Aviso de vencimento da garantia ao gestor e ao fiscal quando a validade cai nos próximos 30 dias. Usa a chave da
 * varredura diária (`garantia:contrato:<id>:<validade>`): se a varredura já gerou o aviso, nada é duplicado.
 */
export async function avisarVencimentoGarantia(
  tx: Transacao,
  ctx: ContextoApp,
  request: FastifyRequest,
  contratoId: string,
  validaAte: string,
): Promise<string | null> {
  const hoje = ctx.hoje();
  if (!avaliarAvisoGarantia(validaAte, hoje)) return null;
  const instrumento = await carregarInstrumento(tx, 'contrato', contratoId, null);
  if (!instrumento) return null;
  const mensagem = montarMensagemNotificacao({ tipo: 'garantia', origem: 'automatica', hoje, instrumento: instrumentoDaMensagem(instrumento), dataReferencia: validaAte });
  const destinatarios = await resolverDestinatarios(tx, instrumento, ['gestor', 'fiscal']);
  const gravada = await gravarNotificacao(
    tx,
    ctx.config,
    ctx.relogio(),
    { tipo: 'garantia', origem: 'automatica', instrumento, mensagem, chave: `garantia:contrato:${contratoId}:${validaAte}`, criadaPor: null },
    destinatarios,
    ['email', 'govbr'],
    true,
  );
  if (!gravada) return null;
  await auditar(tx, request, {
    usuarioId: null,
    acao: 'notificacao.gerar',
    recurso: 'notificacao',
    recursoId: gravada.id,
    resumo: `Gerou aviso automático de garantia — ${identificadorInstrumento('contrato', instrumento.numero)}`,
    dados: {
      instrumentoTipo: 'contrato',
      instrumentoId: contratoId,
      tipo: 'garantia',
      faixa: null,
      obrigatoria: mensagem.obrigatoria,
      envios: gravada.envios,
      suprimidos: gravada.suprimidos,
      dataReferencia: validaAte,
    },
  });
  return gravada.id;
}

/** Espelha a garantia de execução vigente mais recente nas colunas do contrato (ou limpa, se não houver). */
export async function espelharGarantiaNoContrato(tx: Transacao, contratoId: string): Promise<void> {
  const [vigente] = await tx.consultar<{ modalidade: ModalidadeGarantia; saldo: number; valida_ate: string | null }>(
    `SELECT modalidade, saldo, valida_ate FROM contratos_garantias
      WHERE contrato_id = $1 AND finalidade = 'execucao' AND situacao = 'vigente'
      ORDER BY apresentada_em DESC NULLS LAST, registrada_em DESC LIMIT 1`,
    [contratoId],
  );
  await tx.executar(
    `UPDATE contratos SET garantia_tipo = $2, garantia_valor = $3, garantia_valida_ate = $4, atualizado_em = now() WHERE id = $1`,
    [contratoId, vigente ? ROTULOS_MODALIDADE_GARANTIA[vigente.modalidade] : null, vigente?.saldo ?? null, vigente?.valida_ate ?? null],
  );
}

/** Espelha o gestor e o fiscal técnico titulares ativos nas colunas do contrato (notificações, painel, achados). */
export async function espelharDesignacoesNoContrato(tx: Transacao, contratoId: string, hoje: string): Promise<void> {
  const ativos = await tx.consultar<{ papel: string; usuario_id: string }>(
    `SELECT papel, usuario_id FROM contratos_designacoes
      WHERE contrato_id = $1 AND fim IS NULL AND inicio <= $2::date AND NOT substituto AND papel IN ('gestor', 'fiscal_tecnico')`,
    [contratoId, hoje],
  );
  const gestor = ativos.find((a) => a.papel === 'gestor')?.usuario_id ?? null;
  const fiscal = ativos.find((a) => a.papel === 'fiscal_tecnico')?.usuario_id ?? null;
  await tx.executar('UPDATE contratos SET gestor_id = $2, fiscal_id = $3, atualizado_em = now() WHERE id = $1', [contratoId, gestor, fiscal]);
}
