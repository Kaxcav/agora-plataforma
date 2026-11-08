/**
 * Sicx — comércio eletrônico (RN-42; art. 79, IV, Lei 15.266/2025; Decreto 13.106/2026). No modo offline a vitrine é
 * simulada com ofertas sintéticas do seed; o ranqueamento, a segregação dos agentes, a reserva de limite do ETP
 * abrangente e os prazos de recebimento e pagamento vêm de @agora/dominio.
 */
import {
  avaliarReservaSicx,
  prazosCompraSicx,
  ranquearOfertasSicx,
  validarCompraSicx,
  type FaixaPrecoSicx,
  type OfertaSicx,
} from '@agora/dominio';
import type { CompraSicx, ItemVitrineSicx, OfertaVitrineSicx, ReservaSicx, VitrineSicx } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, exigirAlguma, podeVerUasg, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio, semPermissao } from '../../http/erros.ts';
import { centavos, codigoUasg, dataIso, idDaRota, textoBusca, uuid } from '../../http/validacao.ts';
import { MINIMO_CARACTERES_TEXTO } from '../jornada/constantes.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { montarCompraSicx, SELECAO_COMPRA_SICX, type LinhaCompraSicx } from './repositorio.ts';

interface LinhaOferta {
  id: string;
  item_codigo: string;
  item_descricao: string;
  unidade: string;
  categoria: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo_pessoa: 'PJ' | 'PF';
  preco_unitario: number;
  faixas: FaixaPrecoSicx[];
  localidades: string[];
  prazo_entrega_dias: number;
  prazo_pagamento_dias: number;
  restricao_cadin: boolean;
  credenciada: boolean;
  reputacao: number;
}

const SELECAO_OFERTA = `
  SELECT o.id, o.item_codigo, o.item_descricao, o.unidade, o.categoria, o.fornecedor_id, f.razao_social AS fornecedor_nome, f.tipo_pessoa,
         o.preco_unitario, o.faixas, o.localidades, o.prazo_entrega_dias, o.prazo_pagamento_dias, o.restricao_cadin, o.credenciada, o.reputacao
    FROM sicx_ofertas o JOIN fornecedores f ON f.id = o.fornecedor_id
   WHERE o.ativa`;

function paraDominio(o: LinhaOferta): OfertaSicx {
  return {
    id: o.id,
    fornecedorId: o.fornecedor_id,
    precoUnitario: o.preco_unitario,
    faixas: o.faixas,
    localidades: o.localidades,
    prazoEntregaDias: o.prazo_entrega_dias,
    prazoPagamentoDias: o.prazo_pagamento_dias,
    restricaoCadin: o.restricao_cadin,
    credenciada: o.credenciada,
    reputacao: Number(o.reputacao),
  };
}

/** Ranqueamento de um item da vitrine para a quantidade e a UF do comprador (semente auditável do sorteio). */
export function ranquearItem(ofertas: readonly LinhaOferta[], quantidade: number, uf: string, uasg: string): OfertaVitrineSicx[] {
  const codigo = ofertas[0]?.item_codigo ?? '';
  const r = ranquearOfertasSicx({ ofertas: ofertas.map(paraDominio), quantidade, uf, semente: `${uasg}|${codigo}|${quantidade}` });
  const porId = new Map(ofertas.map((o) => [o.id, o]));
  const montar = (o: LinhaOferta, extra: Pick<OfertaVitrineSicx, 'posicao' | 'precoNaQuantidade' | 'valorTotal' | 'desempate' | 'motivoInaptidao'>): OfertaVitrineSicx => ({
    id: o.id,
    fornecedor: { id: o.fornecedor_id, nome: nomeExibivel(o.tipo_pessoa, o.fornecedor_nome) },
    precoUnitario: o.preco_unitario,
    faixas: o.faixas,
    localidades: o.localidades,
    prazoEntregaDias: o.prazo_entrega_dias,
    prazoPagamentoDias: o.prazo_pagamento_dias,
    reputacao: Number(o.reputacao),
    ...extra,
  });
  return [
    ...r.ranqueadas.map((x) => {
      const o = porId.get(x.oferta.id) as LinhaOferta;
      return montar(o, { posicao: x.posicao, precoNaQuantidade: x.precoUnitario, valorTotal: x.valorTotal, desempate: x.desempate, motivoInaptidao: null });
    }),
    ...r.inaptas.map((x) => {
      const o = porId.get(x.oferta.id) as LinhaOferta;
      return montar(o, { posicao: null, precoNaQuantidade: o.preco_unitario, valorTotal: o.preco_unitario * quantidade, desempate: 'nenhum', motivoInaptidao: x.motivo });
    }),
  ];
}

async function ufDaUasg(executor: Executor, uasg: string): Promise<string> {
  const [linha] = await executor.consultar<{ uf: string }>('SELECT uf FROM uasgs WHERE codigo = $1', [uasg]);
  if (!linha) throw regraNegocio('UASG não encontrada.', [{ campo: 'uasg', mensagem: 'UASG inexistente' }]);
  return linha.uf;
}

async function reservasDaUasg(executor: Executor, escopo: string[] | null, uasg: string | null): Promise<ReservaSicx[]> {
  const linhas = await executor.consultar<{ id: string; uasg: string; descricao: string; etp_referencia: string; limite: number; autorizacao_previa: boolean; vigencia_fim: string; utilizado: number }>(
    `SELECT r.id, r.uasg, r.descricao, r.etp_referencia, r.limite, r.autorizacao_previa, r.vigencia_fim,
            COALESCE((SELECT SUM(c.valor_total) FROM sicx_compras c WHERE c.reserva_id = r.id AND c.situacao <> 'cancelada'), 0)::bigint AS utilizado
       FROM sicx_reservas r
      WHERE ($1::text[] IS NULL OR r.uasg = ANY($1::text[])) AND ($2::text IS NULL OR r.uasg = $2)
      ORDER BY r.uasg, r.criada_em`,
    [escopo, uasg],
  );
  return linhas.map((l) => ({
    id: l.id,
    uasg: l.uasg,
    descricao: l.descricao,
    etpReferencia: l.etp_referencia,
    limite: l.limite,
    utilizado: l.utilizado,
    saldo: Math.max(0, l.limite - l.utilizado),
    autorizacaoPrevia: l.autorizacao_previa,
    vigenciaFim: l.vigencia_fim,
  }));
}

const esquemaVitrine = z.object({
  uasg: codigoUasg,
  busca: textoBusca,
  quantidade: z.coerce.number().int().min(1).max(1_000_000).default(1),
});

const esquemaReserva = z.object({
  uasg: codigoUasg,
  descricao: z.string().trim().min(10).max(300),
  etpReferencia: z.string().trim().min(5).max(120),
  limite: centavos.positive(),
  autorizacaoPrevia: z.boolean(),
  vigenciaFim: dataIso,
});

const esquemaCompra = z
  .object({
    ofertaId: uuid,
    quantidade: z.number().int().min(1).max(1_000_000),
    uasg: codigoUasg,
    processoId: uuid.nullable().optional().transform((v) => v ?? null),
    reservaId: uuid.nullable().optional().transform((v) => v ?? null),
    justificativaSelecao: z.string().trim().max(2_000).nullable().optional().transform((v) => (v ? v : null)),
  })
  .refine((e) => (e.processoId === null) !== (e.reservaId === null), { message: 'Informe o processo (ETP específico) ou a reserva do ETP abrangente', path: ['processoId'] });

const esquemaData = z.object({ data: dataIso });
const esquemaRecebimento = z.object({ tipo: z.enum(['provisorio', 'definitivo']), data: dataIso });

export async function rotasSicx(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('jornada:ler') };
  const edicao = { preHandler: exigir('jornada:editar') };

  async function obterCompra(executor: Executor, request: FastifyRequest, id: string, bloquear = false): Promise<LinhaCompraSicx & { reserva_autorizacao_previa: boolean | null }> {
    const [linha] = await executor.consultar<LinhaCompraSicx & { reserva_autorizacao_previa: boolean | null }>(
      `SELECT x.*, r.autorizacao_previa AS reserva_autorizacao_previa FROM (${SELECAO_COMPRA_SICX} WHERE c.id = $1) x
         LEFT JOIN sicx_reservas r ON r.id = x.reserva_id`,
      [id],
    );
    if (!linha || !podeVerUasg(sessaoDe(request), linha.uasg)) throw naoEncontrado('Compra não encontrada.');
    if (bloquear) await executor.consultar('SELECT id FROM sicx_compras WHERE id = $1 FOR UPDATE', [id]);
    return linha;
  }

  async function responderCompra(id: string): Promise<CompraSicx> {
    const [linha] = await ctx.banco.consultar<LinhaCompraSicx>(`${SELECAO_COMPRA_SICX} WHERE c.id = $1`, [id]);
    if (!linha) throw naoEncontrado('Compra não encontrada.');
    return montarCompraSicx(linha, ctx.hoje(), await opcoesCalendario(ctx.banco));
  }

  async function alterarCompra(
    request: FastifyRequest,
    acao: (tx: Transacao, compra: LinhaCompraSicx & { reserva_autorizacao_previa: boolean | null }, hoje: string) => Promise<{ acao: string; resumo: string; dados?: Record<string, unknown> }>,
  ): Promise<CompraSicx> {
    const id = idDaRota(request.params);
    await ctx.banco.transacao(async (tx) => {
      const compra = await obterCompra(tx, request, id, true);
      const evento = await acao(tx, compra, ctx.hoje());
      await auditar(tx, request, {
        acao: `sicx.${evento.acao}`,
        recurso: 'sicx_compra',
        recursoId: id,
        resumo: evento.resumo,
        dados: { numero: compra.numero, uasg: compra.uasg, processoId: compra.processo_id, ...(evento.dados ?? {}) },
      });
    });
    return responderCompra(id);
  }

  app.get('/sicx/ofertas', leitura, async (request): Promise<VitrineSicx> => {
    const f = esquemaVitrine.parse(request.query);
    if (!podeVerUasg(sessaoDe(request), f.uasg)) throw naoEncontrado('UASG fora do seu escopo.');
    const uf = await ufDaUasg(ctx.banco, f.uasg);
    const ofertas = await ctx.banco.consultar<LinhaOferta>(
      `${SELECAO_OFERTA} AND ($1::text IS NULL OR o.busca_normalizada LIKE $1 ESCAPE '\\') ORDER BY o.item_codigo, o.id`,
      [f.busca ? padraoContem(f.busca) : null],
    );
    const porItem = new Map<string, LinhaOferta[]>();
    for (const o of ofertas) porItem.set(o.item_codigo, [...(porItem.get(o.item_codigo) ?? []), o]);
    const itens: ItemVitrineSicx[] = [...porItem.values()].map((lista) => ({
      codigo: lista[0]?.item_codigo ?? '',
      descricao: lista[0]?.item_descricao ?? '',
      unidade: lista[0]?.unidade ?? '',
      categoria: lista[0]?.categoria ?? '',
      ofertas: ranquearItem(lista, f.quantidade, uf, f.uasg),
    }));
    return { uf, uasg: f.uasg, quantidade: f.quantidade, modo: ctx.config.integracoes, itens, fundamento: 'Lei 14.133/2021, art. 79, IV; Decreto 13.106/2026, arts. 11 e 17' };
  });

  app.get('/sicx/reservas', leitura, async (request): Promise<ReservaSicx[]> => {
    const q = z.object({ uasg: codigoUasg.optional() }).parse(request.query);
    return reservasDaUasg(ctx.banco, escopoUasgs(sessaoDe(request)), q.uasg ?? null);
  });

  app.post('/sicx/reservas', edicao, async (request, reply): Promise<ReservaSicx> => {
    const e = esquemaReserva.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, e.uasg)) throw naoEncontrado('UASG fora do seu escopo.');
    if (e.vigenciaFim < ctx.hoje()) throw regraNegocio('A vigência da reserva não pode terminar no passado.');
    const agora = ctx.relogio();
    const [criada] = await ctx.banco.transacao(async (tx) => {
      const linhas = await tx.consultar<{ id: string }>(
        `INSERT INTO sicx_reservas (uasg, descricao, etp_referencia, limite, autorizacao_previa, vigencia_fim, criada_por, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [e.uasg, e.descricao, e.etpReferencia, e.limite, e.autorizacaoPrevia, e.vigenciaFim, sessao.usuario.id, agora.toISOString()],
      );
      await auditar(tx, request, {
        acao: 'sicx.reserva.criar',
        recurso: 'sicx_reserva',
        recursoId: linhas[0]?.id ?? null,
        resumo: `Reservou limite no ETP abrangente para compras no Sicx (${e.etpReferencia})`,
        dados: { uasg: e.uasg, limite: e.limite, autorizacaoPrevia: e.autorizacaoPrevia },
      });
      return linhas;
    });
    reply.status(201);
    const reservas = await reservasDaUasg(ctx.banco, null, e.uasg);
    const reserva = reservas.find((r) => r.id === criada?.id);
    if (!reserva) throw naoEncontrado();
    return reserva;
  });

  app.get('/sicx/compras', leitura, async (request): Promise<CompraSicx[]> => {
    const q = z.object({ uasg: codigoUasg.optional() }).parse(request.query);
    const linhas = await ctx.banco.consultar<LinhaCompraSicx>(
      `${SELECAO_COMPRA_SICX} WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[])) AND ($2::text IS NULL OR c.uasg = $2) ORDER BY c.ordem_em DESC LIMIT 200`,
      [escopoUasgs(sessaoDe(request)), q.uasg ?? null],
    );
    const hoje = ctx.hoje();
    const calendario = await opcoesCalendario(ctx.banco);
    return linhas.map((l) => montarCompraSicx(l, hoje, calendario));
  });

  /** Ordem de compra (Decreto 13.106/2026, arts. 19 e 20, I): o agente seleciona a oferta ranqueada e emite a ordem. */
  app.post('/sicx/compras', edicao, async (request, reply): Promise<CompraSicx> => {
    const e = esquemaCompra.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, e.uasg)) throw naoEncontrado('UASG fora do seu escopo.');
    const agora = ctx.relogio();
    const hoje = ctx.hoje();
    const id = await ctx.banco.transacao(async (tx) => {
      const [escolhida] = await tx.consultar<LinhaOferta>(`${SELECAO_OFERTA} AND o.id = $1`, [e.ofertaId]);
      if (!escolhida) throw regraNegocio('Oferta não encontrada ou inativa na vitrine.', [{ campo: 'ofertaId', mensagem: 'Oferta inexistente' }]);
      if (e.processoId) {
        const [processo] = await tx.consultar<{ uasg: string; etapa_atual: number; rota: string | null }>(
          `SELECT p.uasg, p.etapa_atual, r.rota FROM processos p LEFT JOIN processos_rotas r ON r.processo_id = p.id WHERE p.id = $1`,
          [e.processoId],
        );
        if (!processo || !podeVerUasg(sessao, processo.uasg)) throw naoEncontrado('Processo não encontrado.');
        if (processo.rota !== 'sicx') throw regraNegocio('O processo não está na rota de comércio eletrônico (Sicx).');
        if (processo.etapa_atual !== 6) throw regraNegocio('A compra pelo Sicx é feita na etapa 6 (seleção do fornecedor) do processo.');
        if (processo.uasg !== e.uasg) throw regraNegocio('A compra deve ser da mesma UASG do processo.');
      }
      let reservaAutorizacaoPrevia = false;
      if (e.reservaId) {
        const [reserva] = (await reservasDaUasg(tx, null, e.uasg)).filter((r) => r.id === e.reservaId);
        if (!reserva) throw regraNegocio('A reserva de limite não é desta UASG.', [{ campo: 'reservaId', mensagem: 'Reserva inexistente' }]);
        if (reserva.vigenciaFim < hoje) throw regraNegocio('A reserva de limite do ETP abrangente não está mais vigente.');
        reservaAutorizacaoPrevia = reserva.autorizacaoPrevia;
        const valorPrevio = ranquearItem([escolhida], e.quantidade, await ufDaUasg(tx, e.uasg), e.uasg)[0]?.valorTotal ?? 0;
        const r = avaliarReservaSicx({ limite: reserva.limite, utilizado: reserva.utilizado, novaCompra: Math.max(1, valorPrevio) });
        if (!r.permitida) throw regraNegocio(r.mensagem, [{ campo: 'RN-42', mensagem: r.fundamento }]);
      }
      const doItem = await tx.consultar<LinhaOferta>(`${SELECAO_OFERTA} AND o.item_codigo = $1`, [escolhida.item_codigo]);
      const ranking = ranquearItem(doItem, e.quantidade, await ufDaUasg(tx, e.uasg), e.uasg);
      const selecionada = ranking.find((o) => o.id === e.ofertaId);
      if (!selecionada || selecionada.posicao === null) {
        throw regraNegocio(`A oferta não está apta: ${selecionada?.motivoInaptidao ?? 'fora do ranqueamento'}`, [{ campo: 'RN-42', mensagem: 'Decreto 13.106/2026, art. 17' }]);
      }
      const v = validarCompraSicx({
        posicaoSelecionada: selecionada.posicao,
        justificativaSelecao: e.justificativaSelecao,
        agenteOrdemId: sessao.usuario.id,
        agenteConclusaoId: null,
        autorizacaoPrevia: reservaAutorizacaoPrevia,
        minimoCaracteres: MINIMO_CARACTERES_TEXTO,
      });
      if (v.pendencias.length > 0) throw regraNegocio(v.pendencias[0]?.mensagem ?? 'Compra inválida.', v.pendencias.map((p) => ({ campo: p.campo, mensagem: p.mensagem })));
      const [seq] = await tx.consultar<{ n: number }>("SELECT nextval('sicx_compras_numero_seq') AS n");
      const numero = `SICX-${hoje.slice(0, 4)}-${String(seq?.n ?? 1).padStart(6, '0')}`;
      const [linha] = await tx.consultar<{ id: string }>(
        `INSERT INTO sicx_compras (numero, uasg, processo_id, reserva_id, oferta_id, fornecedor_id, quantidade, preco_unitario, valor_total, posicao,
                                   ranking, justificativa_selecao, situacao, ordem_por, ordem_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, 'ordem_emitida', $13, $14) RETURNING id`,
        [
          numero,
          e.uasg,
          e.processoId,
          e.reservaId,
          e.ofertaId,
          escolhida.fornecedor_id,
          e.quantidade,
          selecionada.precoNaQuantidade,
          selecionada.valorTotal,
          selecionada.posicao,
          JSON.stringify(ranking.map((o) => ({ ofertaId: o.id, posicao: o.posicao, valorTotal: o.valorTotal, desempate: o.desempate, motivo: o.motivoInaptidao }))),
          e.justificativaSelecao,
          sessao.usuario.id,
          agora.toISOString(),
        ],
      );
      const compraId = linha?.id ?? '';
      await auditar(tx, request, {
        acao: 'sicx.ordem_compra',
        recurso: 'sicx_compra',
        recursoId: compraId,
        resumo: `Emitiu a ordem de compra ${numero} no Sicx (${selecionada.posicao}ª oferta ranqueada)`,
        dados: { numero, uasg: e.uasg, processoId: e.processoId, reservaId: e.reservaId, ofertaId: e.ofertaId, quantidade: e.quantidade, valorTotal: selecionada.valorTotal, posicao: selecionada.posicao },
      });
      return compraId;
    });
    reply.status(201);
    return responderCompra(id);
  });

  /** Confirmação e conclusão da compra (art. 20, II, e art. 21): a conclusão é a contratação perante o fornecedor. */
  app.post('/sicx/compras/:id/conclusao', edicao, async (request) => {
    const sessao = sessaoDe(request);
    return alterarCompra(request, async (tx, compra) => {
      if (compra.situacao !== 'ordem_emitida') throw regraNegocio('A compra não está aguardando conclusão.');
      const v = validarCompraSicx({
        posicaoSelecionada: compra.posicao,
        justificativaSelecao: compra.justificativa_selecao,
        agenteOrdemId: compra.ordem_por,
        agenteConclusaoId: sessao.usuario.id,
        autorizacaoPrevia: compra.reserva_autorizacao_previa === true,
        minimoCaracteres: MINIMO_CARACTERES_TEXTO,
      });
      if (v.pendencias.length > 0) throw semPermissao(v.pendencias[0]?.mensagem);
      await tx.executar(`UPDATE sicx_compras SET situacao = 'concluida', conclusao_por = $2, conclusao_em = $3 WHERE id = $1`, [compra.id, sessao.usuario.id, ctx.relogio().toISOString()]);
      return { acao: 'concluir', resumo: `Concluiu a compra ${compra.numero} no Sicx: a conclusão vale como contratação (Decreto 13.106/2026, art. 21)`, dados: { valorTotal: compra.valor_total } };
    });
  });

  app.post('/sicx/compras/:id/entrega', edicao, async (request) => {
    const e = esquemaData.parse(request.body);
    return alterarCompra(request, async (tx, compra, hoje) => {
      if (compra.situacao !== 'concluida') throw regraNegocio('Só a compra concluída tem entrega.');
      if (compra.entrega_registrada_em) throw regraNegocio('A entrega já foi registrada.');
      if (e.data > hoje) throw regraNegocio('A data da entrega não pode ser futura.');
      await tx.executar('UPDATE sicx_compras SET entrega_registrada_em = $2 WHERE id = $1', [compra.id, e.data]);
      return { acao: 'entrega', resumo: `Registrou a entrega da compra ${compra.numero} informada pelo fornecedor`, dados: { data: e.data } };
    });
  });

  app.post('/sicx/compras/:id/recebimento', { preHandler: exigirAlguma(['pagamentos:atestar', 'jornada:editar']) }, async (request) => {
    const e = esquemaRecebimento.parse(request.body);
    return alterarCompra(request, async (tx, compra, hoje) => {
      if (!compra.entrega_registrada_em) throw regraNegocio('Registre a entrega antes do recebimento.');
      if (e.data > hoje || e.data < compra.entrega_registrada_em) throw regraNegocio('A data do recebimento deve estar entre a entrega e hoje.');
      if (e.tipo === 'provisorio') {
        if (compra.recebimento_provisorio_em) throw regraNegocio('O recebimento provisório já foi registrado.');
        await tx.executar('UPDATE sicx_compras SET recebimento_provisorio_em = $2 WHERE id = $1', [compra.id, e.data]);
      } else {
        if (compra.recebimento_definitivo_em) throw regraNegocio('O recebimento definitivo já foi registrado.');
        if (!compra.recebimento_provisorio_em || e.data < compra.recebimento_provisorio_em) throw regraNegocio('O recebimento definitivo vem depois do provisório (Decreto 13.106/2026, art. 22).');
        await tx.executar('UPDATE sicx_compras SET recebimento_definitivo_em = $2 WHERE id = $1', [compra.id, e.data]);
      }
      return { acao: `recebimento.${e.tipo}`, resumo: `Registrou o recebimento ${e.tipo} da compra ${compra.numero}`, dados: { data: e.data } };
    });
  });

  app.post('/sicx/compras/:id/pagamento', { preHandler: exigir('pagamentos:registrar') }, async (request) => {
    const e = esquemaData.parse(request.body);
    return alterarCompra(request, async (tx, compra, hoje) => {
      if (compra.pago_em) throw regraNegocio('A compra já foi paga.');
      const calendario = await opcoesCalendario(tx);
      const prazos = prazosCompraSicx({
        entregaRegistradaEm: compra.entrega_registrada_em,
        recebimentoProvisorioEm: compra.recebimento_provisorio_em,
        recebimentoDefinitivoEm: compra.recebimento_definitivo_em,
        pagoEm: null,
        hoje,
        opcoes: calendario,
      });
      if (prazos.situacao !== 'aguardando_pagamento') throw regraNegocio('O pagamento é liberado com o recebimento definitivo, expresso ou tácito (Decreto 13.106/2026, art. 23).');
      if (e.data > hoje) throw regraNegocio('A data do pagamento não pode ser futura.');
      await tx.executar('UPDATE sicx_compras SET pago_em = $2 WHERE id = $1', [compra.id, e.data]);
      return {
        acao: 'pagamento',
        resumo: `Registrou o pagamento da compra ${compra.numero}${prazos.limitePagamento && e.data > prazos.limitePagamento ? ' depois do prazo de 30 dias' : ''}`,
        dados: { data: e.data, limitePagamento: prazos.limitePagamento, recebimentoTacito: prazos.recebimentoTacito },
      };
    });
  });
}
