/**
 * Efeito da extinção do contrato sobre a garantia (costura das frentes K e L; Lei 14.133/2021, art. 139, art. 156,
 * § 8º, e art. 100). Só encadeia as regras que o domínio já tem, sem criar regra nova:
 *
 * - multa aplicada e ainda não descontada segue `planejarDescontoMulta`: primeiro os pagamentos devidos, depois a
 *   garantia, e cada retenção vira linha de `multas_descontos`, para a multa não ser cobrada duas vezes;
 * - a liberação passa por `avaliarLiberacaoGarantia` (multa por descontar, entrega sem recebimento definitivo e
 *   ocorrência aberta impedem, salvo extinção por culpa da Administração) e a caução em dinheiro volta atualizada
 *   (`atualizarCaucaoDinheiro`);
 * - o efeito "execução da garantia" (prejuízo a ressarcir) não tem valor apurado na decisão: a garantia fica
 *   retida e a execução do valor segue por `/garantias/:id/execucao`, com a decisão da autoridade e o motivo.
 *
 * O aviso ao emitente sai pela central de notificações, na mesma transação.
 */
import {
  atualizarCaucaoDinheiro,
  avaliarLiberacaoGarantia,
  formatarData,
  formatarMoeda,
  planejarDescontoMulta,
  type ModalidadeGarantia,
} from '@agora/dominio';
import type { FastifyRequest } from 'fastify';
import type { Transacao } from '../../banco/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { carregarInstrumento, criarNotificacaoManual, ErroDisparo } from '../notificacoes/servico.ts';
import { espelharGarantiaNoContrato } from './avisos.ts';
import { carregarMultas, pagamentosDevidos, variacoesIpca } from './repositorio.ts';

export type EfeitoExtincaoGarantia = 'sem_garantia' | 'liberacao' | 'desconto_multa' | 'retida';

export interface ResultadoEfeitoGarantia {
  efeito: EfeitoExtincaoGarantia;
  linhas: string[];
  notificacaoId: string | null;
}

interface LinhaGarantia {
  id: string;
  finalidade: 'execucao' | 'antecipacao';
  modalidade: ModalidadeGarantia;
  saldo: number;
  apresentada_em: string | null;
}

export async function aplicarEfeitoDaExtincaoNaGarantia(
  tx: Transacao,
  ctx: ContextoApp,
  request: FastifyRequest,
  e: {
    contrato: { id: string; numero: string };
    autor: { id: string; nome: string };
    numeroTermo: string;
    dataEfeitos: string;
    culpaAdministracao: boolean;
    execucaoGarantia: boolean;
    fundamentacao: string;
  },
): Promise<ResultadoEfeitoGarantia> {
  const hoje = ctx.hoje();
  const agora = ctx.relogio().toISOString();
  const garantias = await tx.consultar<LinhaGarantia>(
    `SELECT id, finalidade, modalidade, saldo, apresentada_em FROM contratos_garantias
      WHERE contrato_id = $1 AND situacao = 'vigente'
      ORDER BY apresentada_em DESC NULLS LAST, registrada_em DESC FOR UPDATE`,
    [e.contrato.id],
  );
  if (garantias.length === 0) return { efeito: 'sem_garantia', linhas: [], notificacaoId: null };

  const movimento = (garantiaId: string, tipo: string, data: string, valor: number | null, descricao: string) =>
    tx.executar(
      `INSERT INTO garantias_movimentos (garantia_id, tipo, data, valor, descricao, registrado_por, registrado_em) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [garantiaId, tipo, data, valor, descricao, e.autor.id, agora],
    );
  const atoDecisao = `${e.numeroTermo} (extinção do contrato ${e.contrato.numero})`;
  const linhas: string[] = [];
  let descontou = false;

  // 1. Multa aplicada e ainda não descontada: pagamentos devidos primeiro, depois a garantia (art. 156, § 8º).
  for (const multa of await carregarMultas(tx, e.contrato.id)) {
    if (multa.saldo <= 0) continue;
    const alvo = garantias.find((g) => g.finalidade === 'execucao' && g.saldo > 0);
    const devidos = await pagamentosDevidos(tx, e.contrato.id);
    const plano = planejarDescontoMulta({
      saldoMulta: multa.saldo,
      pagamentosDevidos: devidos.map((d) => ({ id: d.pagamentoId, disponivel: d.disponivel })),
      saldoGarantia: alvo?.saldo ?? 0,
    });
    const gravarDesconto = (origem: 'pagamento' | 'garantia', refId: string, valor: number) =>
      tx.executar(
        `INSERT INTO multas_descontos (sancao_id, contrato_id, origem, ${origem === 'pagamento' ? 'pagamento_id' : 'garantia_id'}, valor, autoridade, ato, decidida_em, justificativa, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [multa.sancaoId, e.contrato.id, origem, refId, valor, e.autor.nome, atoDecisao, hoje, e.fundamentacao, e.autor.id, agora],
      );
    for (const p of plano.pagamentos) await gravarDesconto('pagamento', p.id, p.valor);
    if (plano.garantia > 0 && alvo) {
      await gravarDesconto('garantia', alvo.id, plano.garantia);
      alvo.saldo -= plano.garantia;
      await tx.executar(`UPDATE contratos_garantias SET saldo = $2::bigint, situacao = CASE WHEN $2::bigint = 0 THEN 'executada' ELSE situacao END WHERE id = $1`, [
        alvo.id,
        alvo.saldo,
      ]);
      await movimento(alvo.id, 'desconto_multa', hoje, plano.garantia, `Desconto de multa na extinção do contrato, por decisão de ${e.autor.nome} (${atoDecisao}), art. 156, § 8º.`);
    }
    descontou = true;
    const retido = plano.pagamentos.reduce((t, p) => t + p.valor, 0);
    linhas.push(
      `Multa de ${formatarMoeda(plano.valor)}: ${formatarMoeda(retido)} retidos dos pagamentos devidos e ${formatarMoeda(plano.garantia)} da garantia${plano.remanescente > 0 ? `; ${formatarMoeda(plano.remanescente)} seguem para cobrança` : ''}.`,
    );
  }

  // 2. O que sobra da garantia: liberada (art. 100) ou retida, conforme a trava do domínio.
  const restantes = await carregarMultas(tx, e.contrato.id);
  const saldoMultas = restantes.reduce((t, m) => t + m.saldo, 0);
  const [contagens] = await tx.consultar<{ pendentes: number; abertas: number }>(
    `SELECT (SELECT COUNT(*) FROM contratos_recebimentos WHERE contrato_id = $1 AND situacao <> 'recebido')::integer AS pendentes,
            (SELECT COUNT(*) FROM contratos_ocorrencias WHERE contrato_id = $1 AND situacao = 'aberta')::integer AS abertas`,
    [e.contrato.id],
  );
  const variacoes = await variacoesIpca(tx);
  let liberou = false;
  let reteve = false;
  for (const g of garantias) {
    if (g.saldo <= 0) continue;
    if (e.execucaoGarantia) {
      reteve = true;
      linhas.push(`Garantia retida (saldo de ${formatarMoeda(g.saldo)}): a execução do prejuízo apurado depende de decisão da autoridade e de valor definido.`);
      continue;
    }
    const avaliacao = avaliarLiberacaoGarantia({
      situacaoRegistro: 'vigente',
      vigenciaEncerrada: true,
      recebimentosPendentes: contagens?.pendentes ?? 0,
      ocorrenciasAbertas: contagens?.abertas ?? 0,
      saldoMultasPendentes: saldoMultas,
      extincaoCulpaAdministracao: e.culpaAdministracao,
    });
    if (!avaliacao.permitido) {
      reteve = true;
      linhas.push(`Garantia retida (saldo de ${formatarMoeda(g.saldo)}): ${avaliacao.motivos.join(' ')}`);
      continue;
    }
    const restituicao =
      g.modalidade === 'caucao_dinheiro' && g.apresentada_em
        ? atualizarCaucaoDinheiro({ saldo: g.saldo, depositadaEm: g.apresentada_em, restituidaEm: e.dataEfeitos, variacoes })
        : null;
    const restituido = restituicao?.valorRestituido ?? g.saldo;
    await tx.executar(`UPDATE contratos_garantias SET situacao = 'liberada', liberada_em = $2, valor_restituido = $3 WHERE id = $1`, [g.id, e.dataEfeitos, restituido]);
    await movimento(
      g.id,
      'liberacao',
      e.dataEfeitos,
      restituido,
      `Garantia liberada pela extinção do contrato (art. 100), por decisão de ${e.autor.nome} (${atoDecisao})${restituicao ? `; caução atualizada em ${restituicao.percentual}%` : ''}.`,
    );
    liberou = true;
    linhas.push(`Garantia liberada: ${formatarMoeda(restituido)} restituídos.`);
  }
  if (garantias.some((g) => g.finalidade === 'execucao')) await espelharGarantiaNoContrato(tx, e.contrato.id);

  const efeito: EfeitoExtincaoGarantia = reteve ? 'retida' : liberou ? 'liberacao' : descontou ? 'desconto_multa' : 'retida';

  // 3. Aviso ao emitente da garantia pela central (a falha de envio não desfaz a decisão da autoridade).
  let notificacaoId: string | null = null;
  const instrumento = await carregarInstrumento(tx, 'contrato', e.contrato.id, null);
  if (instrumento) {
    try {
      const gravada = await criarNotificacaoManual(
        tx,
        ctx.config,
        ctx.relogio(),
        hoje,
        instrumento,
        {
          tipo: 'garantia',
          destinatarios: ['emitente_garantia'],
          canais: ['sei'],
          dataReferencia: e.dataEfeitos,
          detalhe: `Extinção do contrato ${e.contrato.numero} a partir de ${formatarData(e.dataEfeitos)} (art. 139 da Lei 14.133/2021). ${linhas.join(' ')}`,
          complemento: `Fundamentação da autoridade: ${e.fundamentacao}`,
        },
        e.autor.id,
      );
      notificacaoId = gravada.id;
      await auditar(tx, request, {
        acao: 'notificacao.disparar',
        recurso: 'notificacao',
        recursoId: gravada.id,
        resumo: `Avisou o emitente da garantia da extinção do contrato ${e.contrato.numero}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: e.contrato.id, tipo: 'garantia', destinatarios: ['emitente_garantia'], canais: ['sei'], envios: gravada.envios, suprimidos: gravada.suprimidos },
      });
    } catch (erro) {
      if (!(erro instanceof ErroDisparo)) throw erro;
      linhas.push(`Aviso ao emitente não gerado: ${erro.message}`);
    }
  }
  return { efeito, linhas, notificacaoId };
}
