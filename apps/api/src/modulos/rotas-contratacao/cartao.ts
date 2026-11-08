/**
 * Cartão de pagamento (art. 75, § 4º): registro das compras por dispensa de valor pagas com o cartão, que entram no
 * controle de fracionamento (art. 75, § 1º), e extrato mensal divulgado no PNCP pela fila de integrações.
 * O documento de pessoa física aparece mascarado (LGPD); o CNPJ de pessoa jurídica é público.
 */
import { randomUUID } from 'node:crypto';
import { chaveIdempotencia, mascararDocumento, montarExtratoCartao, validarCompraCartao } from '@agora/dominio';
import type { CompraCartaoPagamento, ExtratoCartaoPagamento, RespostaCompraCartao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, podeVerUasg, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, codigoUasg, dataIso } from '../../http/validacao.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { reabrir } from '../../fila/registro.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { fracionamentoDaUasg } from './repositorio.ts';

interface LinhaCompraCartao {
  id: string;
  uasg: string;
  data_compra: string;
  fornecedor_id: string;
  razao_social: string;
  tipo_pessoa: 'PJ' | 'PF';
  documento: string;
  valor: number;
  objeto: string;
  natureza: string;
  tipo_objeto: 'obras_servicos_engenharia' | 'demais';
  registrada_por: string;
  registrada_por_nome: string;
  extrato_id: string | null;
}

const SELECAO_COMPRA = `
  SELECT c.id, c.uasg, c.data_compra, c.fornecedor_id, f.razao_social, f.tipo_pessoa, f.documento, c.valor, c.objeto, c.natureza, c.tipo_objeto,
         c.registrada_por, u.nome AS registrada_por_nome, c.extrato_id
    FROM cartao_pagamento_compras c JOIN fornecedores f ON f.id = c.fornecedor_id LEFT JOIN usuarios u ON u.id = c.registrada_por`;

/** Documento para exibição e publicação: CNPJ por extenso, CPF mascarado. */
function documentoPublico(tipo: 'PJ' | 'PF', documento: string): string {
  return tipo === 'PF' ? mascararDocumento(documento) : documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function montarCompra(l: LinhaCompraCartao): CompraCartaoPagamento {
  return {
    id: l.id,
    uasg: l.uasg,
    data: l.data_compra,
    fornecedor: { id: l.fornecedor_id, nome: nomeExibivel(l.tipo_pessoa, l.razao_social), documento: documentoPublico(l.tipo_pessoa, l.documento) },
    valor: l.valor,
    objeto: l.objeto,
    natureza: l.natureza,
    tipoObjeto: l.tipo_objeto,
    registradaPor: { id: l.registrada_por, nome: l.registrada_por_nome },
    extratoId: l.extrato_id,
  };
}

interface LinhaExtrato {
  id: string;
  uasg: string;
  competencia: string;
  quantidade: number;
  total: number;
  hash: string;
  texto: string;
  situacao: 'na_fila' | 'publicado' | 'erro';
  situacao_tarefa: string;
  protocolo: string | null;
  modo: 'offline' | 'online' | null;
  publicado_em: string | null;
  ultimo_erro: string | null;
  tarefa_id: string;
}

async function listarExtratos(executor: Executor, escopo: string[] | null, id: string | null): Promise<ExtratoCartaoPagamento[]> {
  const linhas = await executor.consultar<LinhaExtrato>(
    `SELECT e.id, e.uasg, e.competencia, e.quantidade, e.total, e.hash, e.texto, e.situacao, t.situacao AS situacao_tarefa, e.protocolo, e.modo,
            e.publicado_em, t.ultimo_erro, e.tarefa_id
       FROM cartao_pagamento_extratos e JOIN fila_tarefas t ON t.id = e.tarefa_id
      WHERE ($1::text[] IS NULL OR e.uasg = ANY($1::text[])) AND ($2::uuid IS NULL OR e.id = $2::uuid)
      ORDER BY e.competencia DESC, e.uasg`,
    [escopo, id],
  );
  return linhas.map((l) => ({
    id: l.id,
    uasg: l.uasg,
    competencia: l.competencia,
    quantidade: l.quantidade,
    total: l.total,
    hash: l.hash,
    texto: l.texto,
    situacao: l.situacao === 'na_fila' && l.situacao_tarefa === 'erro' ? 'erro' : l.situacao,
    protocolo: l.protocolo,
    modo: l.modo,
    publicadoEm: l.publicado_em,
    ultimoErro: l.situacao === 'publicado' ? null : l.ultimo_erro,
  }));
}

const esquemaFiltro = z.object({ uasg: codigoUasg.optional(), competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

const esquemaCompra = z.object({
  uasg: codigoUasg,
  data: dataIso,
  fornecedorId: z.uuid(),
  valor: centavos.positive(),
  objeto: z.string().trim().min(5).max(500),
  natureza: z.string().trim().min(2).max(120),
  tipoObjeto: z.enum(['obras_servicos_engenharia', 'demais']),
});

const esquemaExtrato = z.object({ uasg: codigoUasg, competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use AAAA-MM') });

export async function rotasCartaoPagamento(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('pagamentos:ler') };
  const registro = { preHandler: exigir('pagamentos:registrar') };

  app.get('/cartao-pagamento/compras', leitura, async (request): Promise<CompraCartaoPagamento[]> => {
    const f = esquemaFiltro.parse(request.query);
    const linhas = await ctx.banco.consultar<LinhaCompraCartao>(
      `${SELECAO_COMPRA}
        WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[])) AND ($2::text IS NULL OR c.uasg = $2)
          AND ($3::text IS NULL OR to_char(c.data_compra, 'YYYY-MM') = $3)
        ORDER BY c.data_compra DESC, c.registrada_em DESC LIMIT 500`,
      [escopoUasgs(sessaoDe(request)), f.uasg ?? null, f.competencia ?? null],
    );
    return linhas.map(montarCompra);
  });

  app.post('/cartao-pagamento/compras', registro, async (request, reply): Promise<RespostaCompraCartao> => {
    const e = esquemaCompra.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, e.uasg)) throw naoEncontrado('UASG fora do seu escopo.');
    const hoje = ctx.hoje();
    if (e.data > hoje) throw regraNegocio('A data da compra não pode ser futura.');
    const v = validarCompraCartao({ data: e.data, tipo: e.tipoObjeto, valor: e.valor, natureza: e.natureza });
    if (v.pendencias.length > 0) throw regraNegocio('A compra não pode ser paga com cartão de pagamento.', v.pendencias.map((p) => ({ campo: p.campo, mensagem: p.mensagem })));
    const id = await ctx.banco.transacao(async (tx) => {
      const [fornecedor] = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE id = $1', [e.fornecedorId]);
      if (!fornecedor) throw regraNegocio('O fornecedor não consta do cadastro.', [{ campo: 'fornecedorId', mensagem: 'Fornecedor não cadastrado' }]);
      const [fechado] = await tx.consultar<{ id: string }>(
        `SELECT id FROM cartao_pagamento_extratos WHERE uasg = $1 AND competencia = $2 AND situacao = 'publicado'`,
        [e.uasg, e.data.slice(0, 7)],
      );
      if (fechado) throw conflito('O extrato desta competência já foi divulgado no PNCP: registre a compra na competência seguinte ou retifique o extrato.');
      const [linha] = await tx.consultar<{ id: string }>(
        `INSERT INTO cartao_pagamento_compras (uasg, data_compra, fornecedor_id, valor, objeto, natureza, tipo_objeto, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [e.uasg, e.data, e.fornecedorId, e.valor, e.objeto, e.natureza, e.tipoObjeto, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'cartao_pagamento.registrar',
        recurso: 'cartao_pagamento',
        recursoId: linha?.id ?? null,
        resumo: `Registrou compra paga com cartão de pagamento (art. 75, § 4º) na UASG ${e.uasg}`,
        dados: { uasg: e.uasg, data: e.data, fornecedorId: e.fornecedorId, valor: e.valor, natureza: e.natureza },
      });
      return linha?.id ?? '';
    });
    // O sinal de fracionamento considera a compra já registrada (soma do exercício no mesmo ramo).
    const fracionamento = await fracionamentoDaUasg(ctx.banco, { uasg: e.uasg, natureza: e.natureza, tipo: e.tipoObjeto, novaContratacao: 0, hoje: e.data, excetoProcesso: null });
    const [linha] = await ctx.banco.consultar<LinhaCompraCartao>(`${SELECAO_COMPRA} WHERE c.id = $1`, [id]);
    if (!linha) throw naoEncontrado();
    reply.status(201);
    return { compra: montarCompra(linha), fracionamento };
  });

  app.get('/cartao-pagamento/extratos', leitura, async (request): Promise<ExtratoCartaoPagamento[]> => listarExtratos(ctx.banco, escopoUasgs(sessaoDe(request)), null));

  app.post('/cartao-pagamento/extratos', registro, async (request): Promise<ExtratoCartaoPagamento> => {
    const e = esquemaExtrato.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, e.uasg)) throw naoEncontrado('UASG fora do seu escopo.');
    if (e.competencia > ctx.hoje().slice(0, 7)) throw regraNegocio('A competência do extrato não pode ser futura.');
    const enviadas: LinhaTarefa[] = [];
    const agora = ctx.relogio();
    const extratoId = await ctx.banco.transacao(async (tx) => {
      const [existente] = await tx.consultar<{ id: string; tarefa_id: string; situacao: string }>(
        'SELECT id, tarefa_id, situacao FROM cartao_pagamento_extratos WHERE uasg = $1 AND competencia = $2 FOR UPDATE',
        [e.uasg, e.competencia],
      );
      if (existente) {
        const reaberta = await reabrir(tx, existente.tarefa_id, agora);
        if (!reaberta) throw conflito(existente.situacao === 'publicado' ? 'O extrato desta competência já foi divulgado no PNCP.' : 'O extrato já está na fila de divulgação.');
        enviadas.push(reaberta);
        await auditar(tx, request, { acao: 'cartao_pagamento.extrato.reenviar', recurso: 'cartao_pagamento', recursoId: existente.id, resumo: 'Reenviou o extrato do cartão ao PNCP (estava na fila de erro)', dados: { uasg: e.uasg, competencia: e.competencia } });
        return existente.id;
      }
      const compras = await tx.consultar<LinhaCompraCartao>(
        `${SELECAO_COMPRA} WHERE c.uasg = $1 AND to_char(c.data_compra, 'YYYY-MM') = $2 ORDER BY c.data_compra`,
        [e.uasg, e.competencia],
      );
      if (compras.length === 0) throw regraNegocio('Não há compras com cartão de pagamento nesta competência.');
      const extrato = montarExtratoCartao({
        competencia: e.competencia,
        compras: compras.map((c) => ({
          data: c.data_compra,
          valor: c.valor,
          objeto: c.objeto,
          favorecido: nomeExibivel(c.tipo_pessoa, c.razao_social),
          documentoFavorecido: documentoPublico(c.tipo_pessoa, c.documento),
        })),
      });
      const hash = sha256Hex(extrato.texto);
      const id = randomUUID();
      const { tarefa } = await app.fila.enfileirar(tx, {
        tipo: 'pncp.extrato_cartao',
        chave: chaveIdempotencia(['pncp', 'extrato_cartao', e.uasg, e.competencia]),
        descricao: `Divulgar no PNCP o extrato do cartão de pagamento da UASG ${e.uasg}, competência ${e.competencia}`,
        carga: { extratoId: id },
        uasg: e.uasg,
        solicitadaPor: sessao.usuario.id,
      });
      await tx.executar(
        `INSERT INTO cartao_pagamento_extratos (id, uasg, competencia, quantidade, total, texto, hash, tarefa_id, situacao, solicitado_por, solicitado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'na_fila', $9, $10)`,
        [id, e.uasg, e.competencia, extrato.quantidade, extrato.total, extrato.texto, hash, tarefa.id, sessao.usuario.id, agora.toISOString()],
      );
      await tx.executar(`UPDATE cartao_pagamento_compras SET extrato_id = $3 WHERE uasg = $1 AND to_char(data_compra, 'YYYY-MM') = $2`, [e.uasg, e.competencia, id]);
      enviadas.push(tarefa);
      await auditar(tx, request, {
        acao: 'cartao_pagamento.extrato.publicar',
        recurso: 'cartao_pagamento',
        recursoId: id,
        resumo: `Enviou ao PNCP pela fila o extrato do cartão de pagamento da UASG ${e.uasg}, competência ${e.competencia} (art. 75, § 4º)`,
        dados: { uasg: e.uasg, competencia: e.competencia, quantidade: extrato.quantidade, total: extrato.total, hash, tarefaId: tarefa.id },
      });
      return id;
    });
    await app.fila.despachar(enviadas);
    const [tarefa] = enviadas;
    if (tarefa) await app.fila.aguardar(tarefa.id);
    const [extrato] = await listarExtratos(ctx.banco, null, extratoId);
    if (!extrato) throw naoEncontrado();
    return extrato;
  });
}
