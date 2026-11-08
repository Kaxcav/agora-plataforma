import type { Pagamento, Pagina, PaginaEmpenhos, PrevisaoPagamentos, RespostaAtesto } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { conflito, naoEncontrado } from '../../http/erros.ts';
import { booleanoQuery, camposPaginacao, codigoUasg, deslocamento, idDaRota, pagina, textoBusca } from '../../http/validacao.ts';
import { carregarProveniencias, provenienciaDe } from '../../integracoes/servico.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { verificarRegularidade } from '../regularidade/servico.ts';
import { exigirRecebimentoDefinitivo, pagamentoParaAtesto, registrarAtesto } from './atesto.ts';
import { listarEmpenhos, listarPagamentos, obterPagamento } from './repositorio.ts';

const esquemaEmpenhos = z.object({
  busca: textoBusca,
  saldo: z.enum(['com', 'sem']).optional(),
  restosAPagar: booleanoQuery.optional(),
  ano: z.coerce.number().int().min(2000).max(2100).optional(),
  uasg: codigoUasg.optional(),
  ...camposPaginacao,
});

const esquemaPagamentos = z.object({
  busca: textoBusca,
  situacao: z.enum(['previsto', 'atestado', 'liquidado', 'pago', 'atrasado']).optional(),
  uasg: codigoUasg.optional(),
  ...camposPaginacao,
});

const esquemaPrevisao = z.object({ ano: z.coerce.number().int().min(2000).max(2100).optional() });

interface LinhaMes {
  mes: string;
  valor: number;
}

interface LinhaPorContrato {
  contrato_id: string;
  contrato_numero: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  previsto: number;
  realizado: number;
}

export async function rotasFinanceiro(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/empenhos', { preHandler: exigir('empenhos:ler') }, async (request): Promise<PaginaEmpenhos> => {
    const f = esquemaEmpenhos.parse(request.query);
    const resultado = await listarEmpenhos(
      ctx.banco,
      { escopo: escopoUasgs(sessaoDe(request)), busca: f.busca, saldo: f.saldo, restosAPagar: f.restosAPagar, ano: f.ano, uasg: f.uasg },
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    const agora = ctx.relogio();
    return {
      ...pagina(resultado.itens, resultado.total, f.pagina, f.tamanhoPagina),
      totais: resultado.totais,
      proveniencia: provenienciaDe(await carregarProveniencias(ctx.banco, agora), 'SIAFI', agora),
    };
  });

  app.get('/pagamentos', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<Pagina<Pagamento>> => {
    const f = esquemaPagamentos.parse(request.query);
    const { itens, total } = await listarPagamentos(
      ctx.banco,
      { escopo: escopoUasgs(sessaoDe(request)), busca: f.busca, situacao: f.situacao, uasg: f.uasg },
      ctx.hoje(),
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  /**
   * Atesto da nota fiscal pelo fiscal: só de 'previsto' para 'atestado'. Antes, o recheque de regularidade (RN-23):
   * nova consulta ao CEIS/CNEP e conferência das certidões, registrada. Irregularidade não impede o atesto do que foi
   * executado: abre pendência para notificar o contratado (art. 92, XVI). Nota ligada a entrega ainda sem recebimento
   * definitivo é recusada: o atesto sai com o termo definitivo (RN-34, `./atesto.ts`).
   */
  app.post('/pagamentos/:id/atestar', { preHandler: exigir('pagamentos:atestar') }, async (request): Promise<RespostaAtesto> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const previo = await pagamentoParaAtesto(ctx.banco, id, escopo);
    if (!previo) throw naoEncontrado('Pagamento não encontrado.');
    if (previo.situacao !== 'previsto') throw conflito('Somente pagamentos na situação "previsto" podem ser atestados.');
    await exigirRecebimentoDefinitivo(ctx.banco, id);
    const verificacao = await verificarRegularidade(ctx, request, {
      fornecedorId: previo.fornecedor_id,
      momento: 'atesto',
      instrumento: { tipo: 'pagamento', id },
      contratoId: previo.contrato_id,
    });
    let pendenciaAberta = false;
    await ctx.banco.transacao(async (tx) => {
      const { pendenciaId } = await registrarAtesto(tx, ctx, request, { pagamentoId: id, escopo, verificacao, usuarioId: sessao.usuario.id });
      pendenciaAberta = pendenciaId !== null;
    });
    const pagamento = await obterPagamento(ctx.banco, id, escopo, ctx.hoje());
    if (!pagamento) throw naoEncontrado('Pagamento não encontrado.');
    return { ...pagamento, verificacaoRegularidade: verificacao, pendenciaAberta };
  });

  app.get('/pagamentos/previsao', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<PrevisaoPagamentos> => {
    const { ano: anoInformado } = esquemaPrevisao.parse(request.query);
    const ano = anoInformado ?? Number(ctx.hoje().slice(0, 4));
    const escopo = escopoUasgs(sessaoDe(request));
    const inicio = `${ano}-01-01`;
    const fim = `${ano}-12-31`;

    const previstos = await ctx.banco.consultar<LinhaMes>(
      `SELECT to_char(p.vencimento, 'YYYY-MM') AS mes, SUM(p.valor)::bigint AS valor
         FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id
        WHERE p.vencimento BETWEEN $1::date AND $2::date AND ($3::text[] IS NULL OR c.uasg = ANY($3::text[]))
        GROUP BY 1`,
      [inicio, fim, escopo],
    );
    const realizados = await ctx.banco.consultar<LinhaMes>(
      `SELECT to_char(p.pago_em, 'YYYY-MM') AS mes, SUM(p.valor)::bigint AS valor
         FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id
        WHERE p.situacao = 'pago' AND p.pago_em BETWEEN $1::date AND $2::date AND ($3::text[] IS NULL OR c.uasg = ANY($3::text[]))
        GROUP BY 1`,
      [inicio, fim, escopo],
    );
    const porContrato = await ctx.banco.consultar<LinhaPorContrato>(
      `SELECT c.id AS contrato_id, c.numero AS contrato_numero, f.tipo_pessoa, f.razao_social,
              COALESCE(SUM(p.valor) FILTER (WHERE p.vencimento BETWEEN $1::date AND $2::date), 0)::bigint AS previsto,
              COALESCE(SUM(p.valor) FILTER (WHERE p.situacao = 'pago' AND p.pago_em BETWEEN $1::date AND $2::date), 0)::bigint AS realizado
         FROM pagamentos p
         JOIN contratos c ON c.id = p.contrato_id
         JOIN fornecedores f ON f.id = c.fornecedor_id
        WHERE ($3::text[] IS NULL OR c.uasg = ANY($3::text[]))
          AND (p.vencimento BETWEEN $1::date AND $2::date OR p.pago_em BETWEEN $1::date AND $2::date)
        GROUP BY c.id, c.numero, f.tipo_pessoa, f.razao_social
        ORDER BY previsto DESC, c.numero`,
      [inicio, fim, escopo],
    );

    const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    return {
      ano,
      meses: meses.map((mes) => ({
        mes,
        previsto: previstos.find((p) => p.mes === mes)?.valor ?? 0,
        realizado: realizados.find((r) => r.mes === mes)?.valor ?? 0,
      })),
      porContrato: porContrato.map((l) => ({
        contrato: { id: l.contrato_id, numero: l.contrato_numero },
        fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
        previstoAno: l.previsto,
        realizadoAno: l.realizado,
      })),
    };
  });
}
