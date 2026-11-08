/**
 * Prazos de pagamento (art. 92, VI), atualização monetária por atraso imputável à Administração (art. 92, V) e
 * alteração justificada da ordem cronológica de pagamentos (art. 141, § 1º) — frente L.
 *
 * O marco do prazo é o recebimento definitivo (termo da RN-34; nas notas atestadas antes dos termos, a data do
 * atesto) ou a liquidação, conforme o contrato. A alteração da ordem é registrada antes do pagamento fora da ordem,
 * com a autoridade, o ato e as comunicações ao controle interno e ao tribunal de contas; o painel da 2ª linha de
 * defesa passa a mostrá-la como exceção justificada.
 */
import {
  calcularAtualizacaoMonetaria,
  calcularPrazoPagamento,
  formatarData,
  hojeISO,
  HIPOTESES_ALTERACAO_ORDEM_CRONOLOGICA,
  validarAlteracaoOrdemCronologica,
  type VariacaoMensalIndice,
} from '@agora/dominio';
import type { AlteracaoOrdemCronologica, PaginaPrazosPagamento, PrazoPagamento, SituacaoPrazoPagamento } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor } from '../../banco/tipos.ts';
import { opcoesCalendario, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, padraoContem } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, codigoUasg, dataIso, idDaRota, paginarEmMemoria, textoBusca } from '../../http/validacao.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { situacaoExibida } from '../financeiro/repositorio.ts';
import { variacoesIpca } from './repositorio.ts';

const SITUACOES: readonly SituacaoPrazoPagamento[] = ['aguardando_marco', 'no_prazo', 'vence_hoje', 'vencido', 'pago_no_prazo', 'pago_com_atraso'];

const esquemaFiltro = z.object({
  busca: textoBusca,
  situacao: z.enum(SITUACOES as [SituacaoPrazoPagamento, ...SituacaoPrazoPagamento[]]).optional(),
  uasg: codigoUasg.optional(),
  ...camposPaginacao,
});

const esquemaAlteracao = z.object({
  inciso: z.enum(['I', 'II', 'III', 'IV', 'V']),
  justificativa: z.string().trim().min(1).max(5000),
  autoridade: z.string().trim().min(5).max(200),
  ato: z.string().trim().min(3).max(200),
  decididaEm: dataIso,
});

const esquemaComunicacao = z.object({
  orgao: z.enum(['controle_interno', 'tribunal_contas']),
  data: dataIso,
  protocolo: z.string().trim().min(3).max(120),
});

interface LinhaPrazo {
  id: string;
  nota_fiscal: string;
  competencia: string;
  valor: number;
  vencimento: string;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  pago_em: string | null;
  fonte_recurso: string;
  posicao: number | null;
  atestado_instante: string | null;
  liquidado_em: string | null;
  definitivo_em: string | null;
  contrato_id: string;
  contrato_numero: string;
  uasg: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  descontos: number;
  alteracoes: number;
  prazo_liquidacao_dias_uteis: number | null;
  prazo_pagamento_dias: number | null;
  marco_pagamento: 'recebimento_definitivo' | 'liquidacao' | null;
  indice_atualizacao: string | null;
  juros_mora_mensal: number | null;
}

/** Ordem de exibição: vencidos (mais atrasados primeiro), vence hoje, no prazo, aguardando o marco e pagos. */
const PESO: Record<SituacaoPrazoPagamento, number> = { vencido: 0, vence_hoje: 1, no_prazo: 2, aguardando_marco: 3, pago_com_atraso: 4, pago_no_prazo: 5 };

export async function calcularPrazos(
  executor: Executor,
  filtro: { escopo: string[] | null; busca?: string | undefined; uasg?: string | undefined; pagamentoId?: string | undefined },
  hoje: string,
  variacoes: readonly VariacaoMensalIndice[],
): Promise<PrazoPagamento[]> {
  const calendario = await opcoesCalendario(executor);
  const linhas = await executor.consultar<LinhaPrazo>(
    `WITH ordem AS (
       SELECT op.id, ROW_NUMBER() OVER (PARTITION BY op.fonte_recurso ORDER BY op.vencimento, op.criado_em, op.nota_fiscal) AS posicao
         FROM pagamentos op WHERE op.situacao <> 'pago'
     )
     SELECT p.id, p.nota_fiscal, p.competencia, p.valor, p.vencimento, p.situacao, p.pago_em, p.fonte_recurso, o.posicao,
            p.atestado_em AS atestado_instante, p.liquidado_em,
            (SELECT MAX(r.definitivo_em) FROM contratos_recebimentos r WHERE r.pagamento_id = p.id) AS definitivo_em,
            c.id AS contrato_id, c.numero AS contrato_numero, c.uasg, f.tipo_pessoa, f.razao_social,
            COALESCE((SELECT SUM(d.valor) FROM multas_descontos d WHERE d.pagamento_id = p.id), 0)::bigint AS descontos,
            (SELECT COUNT(*) FROM alteracoes_ordem_cronologica a WHERE a.pagamento_id = p.id)::integer AS alteracoes,
            pe.prazo_liquidacao_dias_uteis, pe.prazo_pagamento_dias, pe.marco_pagamento, pe.indice_atualizacao, pe.juros_mora_mensal
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
       JOIN fornecedores f ON f.id = c.fornecedor_id
       LEFT JOIN ordem o ON o.id = p.id
       LEFT JOIN contratos_parametros_execucao pe ON pe.contrato_id = c.id
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR p.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR c.uasg = $3)
        AND ($4::uuid IS NULL OR p.id = $4)`,
    [filtro.escopo, filtro.busca ? padraoContem(filtro.busca) : null, filtro.uasg ?? null, filtro.pagamentoId ?? null],
  );
  const itens = linhas.map((l): PrazoPagamento => {
    const base = {
      pagamento: {
        id: l.id,
        notaFiscal: l.nota_fiscal,
        competencia: l.competencia,
        valor: l.valor,
        situacao: situacaoExibida(l.situacao, l.vencimento, hoje),
        pagoEm: l.pago_em,
        fonteRecurso: l.fonte_recurso,
        posicaoOrdemCronologica: l.situacao === 'pago' ? null : l.posicao,
        exigivel: l.situacao === 'atestado' || l.situacao === 'liquidado',
      },
      contrato: { id: l.contrato_id, numero: l.contrato_numero, uasg: l.uasg },
      fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
      descontosMulta: l.descontos,
      alteracoesOrdem: l.alteracoes,
    };
    if (l.prazo_pagamento_dias === null || l.prazo_liquidacao_dias_uteis === null || l.marco_pagamento === null) {
      return {
        ...base,
        parametrosDefinidos: false,
        marco: null,
        dataMarco: null,
        origemMarco: null,
        limiteLiquidacao: null,
        liquidacaoAtrasada: false,
        limitePagamento: null,
        situacao: l.situacao === 'pago' ? 'pago_no_prazo' : 'aguardando_marco',
        diasAtraso: 0,
        explicacao: 'O contrato ainda não tem os prazos de liquidação e de pagamento definidos na Ágora.',
        atualizacao: null,
      };
    }
    const recebimentoDefinitivoEm = l.definitivo_em ?? (l.situacao === 'previsto' || !l.atestado_instante ? null : hojeISO(new Date(l.atestado_instante)));
    const parametros = { prazoLiquidacaoDiasUteis: l.prazo_liquidacao_dias_uteis, prazoPagamentoDias: l.prazo_pagamento_dias, marcoPagamento: l.marco_pagamento };
    const prazo = calcularPrazoPagamento({ parametros, recebimentoDefinitivoEm, liquidadoEm: l.liquidado_em, pagoEm: l.pago_em, hoje, opcoes: calendario });
    const origemMarco: PrazoPagamento['origemMarco'] =
      prazo.dataMarco === null ? null : l.marco_pagamento === 'liquidacao' ? 'liquidacao' : l.definitivo_em ? 'recebimento_definitivo' : 'atesto';
    let atualizacao: PrazoPagamento['atualizacao'] = null;
    if ((prazo.situacao === 'vencido' || prazo.situacao === 'pago_com_atraso') && prazo.dataMarco && prazo.limitePagamento) {
      const indice = l.indice_atualizacao ?? 'IPCA';
      const a = calcularAtualizacaoMonetaria({
        valor: l.valor - l.descontos,
        adimplementoEm: recebimentoDefinitivoEm ?? prazo.dataMarco,
        limitePagamento: prazo.limitePagamento,
        pagamentoEm: l.pago_em ?? hoje,
        indice,
        variacoes: indice.toUpperCase() === 'IPCA' ? variacoes : [],
        jurosMensalPercentual: Number(l.juros_mora_mensal ?? 0),
      });
      if (a.devida) {
        atualizacao = {
          indice,
          percentualIndice: a.percentualIndice,
          valorCorrecao: a.valorCorrecao,
          valorJuros: a.valorJuros,
          valorTotal: a.valorTotal,
          competenciasSemIndice: a.competenciasSemIndice,
          memoriaCalculo: a.memoriaCalculo,
          aviso: indice.toUpperCase() === 'IPCA' ? a.aviso : `${a.aviso} A série do índice ${indice} não está disponível no servidor: só os juros foram calculados.`,
        };
      }
    }
    return {
      ...base,
      parametrosDefinidos: true,
      marco: prazo.marco,
      dataMarco: prazo.dataMarco,
      origemMarco,
      limiteLiquidacao: prazo.limiteLiquidacao,
      liquidacaoAtrasada: prazo.liquidacaoAtrasada,
      limitePagamento: prazo.limitePagamento,
      situacao: prazo.situacao,
      diasAtraso: prazo.diasAtraso,
      explicacao: origemMarco === 'atesto' ? `${prazo.explicacao} Marco: data do atesto da nota, anterior ao registro dos termos.` : prazo.explicacao,
      atualizacao,
    };
  });
  return itens.sort(
    (a, b) =>
      PESO[a.situacao] - PESO[b.situacao] ||
      b.diasAtraso - a.diasAtraso ||
      (a.limitePagamento ?? '9999').localeCompare(b.limitePagamento ?? '9999') ||
      a.pagamento.notaFiscal.localeCompare(b.pagamento.notaFiscal),
  );
}

interface LinhaAlteracao {
  id: string;
  pagamento_id: string;
  nota_fiscal: string;
  valor: number;
  fonte_recurso: string;
  pago_em: string | null;
  contrato_id: string;
  contrato_numero: string;
  uasg: string;
  inciso: AlteracaoOrdemCronologica['inciso'];
  justificativa: string;
  autoridade: string;
  ato: string;
  decidida_em: string;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

export async function listarAlteracoesOrdem(executor: Executor, filtro: { escopo: string[] | null; id?: string; uasg?: string | null }): Promise<AlteracaoOrdemCronologica[]> {
  const linhas = await executor.consultar<LinhaAlteracao>(
    `SELECT a.id, a.pagamento_id, p.nota_fiscal, p.valor, p.fonte_recurso, p.pago_em, c.id AS contrato_id, c.numero AS contrato_numero, c.uasg,
            a.inciso, a.justificativa, a.autoridade, a.ato, a.decidida_em, a.registrado_por, u.nome AS registrado_por_nome, a.registrado_em
       FROM alteracoes_ordem_cronologica a
       JOIN pagamentos p ON p.id = a.pagamento_id
       JOIN contratos c ON c.id = p.contrato_id
       LEFT JOIN usuarios u ON u.id = a.registrado_por
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[])) AND ($2::uuid IS NULL OR a.id = $2) AND ($3::text IS NULL OR c.uasg = $3)
      ORDER BY a.decidida_em DESC, a.registrado_em DESC`,
    [filtro.escopo, filtro.id ?? null, filtro.uasg ?? null],
  );
  if (linhas.length === 0) return [];
  const comunicacoes = await executor.consultar<{
    alteracao_id: string;
    orgao: 'controle_interno' | 'tribunal_contas';
    data: string;
    protocolo: string;
    registrado_por: string | null;
    registrado_por_nome: string | null;
    registrado_em: string;
  }>(
    `SELECT m.alteracao_id, m.orgao, m.data, m.protocolo, m.registrado_por, u.nome AS registrado_por_nome, m.registrado_em
       FROM alteracoes_ordem_comunicacoes m LEFT JOIN usuarios u ON u.id = m.registrado_por
      WHERE m.alteracao_id = ANY($1::uuid[]) ORDER BY m.data, m.orgao`,
    [linhas.map((l) => l.id)],
  );
  return linhas.map((l) => {
    const proprias = comunicacoes
      .filter((m) => m.alteracao_id === l.id)
      .map((m) => ({ orgao: m.orgao, data: m.data, protocolo: m.protocolo, registradoPor: usuarioResumo(m.registrado_por, m.registrado_por_nome), registradoEm: m.registrado_em }));
    return {
      id: l.id,
      pagamento: { id: l.pagamento_id, notaFiscal: l.nota_fiscal, valor: l.valor, fonteRecurso: l.fonte_recurso, pagoEm: l.pago_em },
      contrato: { id: l.contrato_id, numero: l.contrato_numero, uasg: l.uasg },
      inciso: l.inciso,
      hipotese: HIPOTESES_ALTERACAO_ORDEM_CRONOLOGICA.find((h) => h.inciso === l.inciso)?.descricao ?? '',
      justificativa: l.justificativa,
      autoridade: l.autoridade,
      ato: l.ato,
      decididaEm: l.decidida_em,
      registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
      registradoEm: l.registrado_em,
      comunicacoes: proprias,
      comunicacaoPendente: !(proprias.some((m) => m.orgao === 'controle_interno') && proprias.some((m) => m.orgao === 'tribunal_contas')),
    };
  });
}

export async function rotasPrazosPagamento(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/pagamentos/prazos', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<PaginaPrazosPagamento> => {
    const f = esquemaFiltro.parse(request.query);
    const hoje = ctx.hoje();
    const todos = await calcularPrazos(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)), busca: f.busca, uasg: f.uasg }, hoje, await variacoesIpca(ctx.banco));
    const filtrados = f.situacao ? todos.filter((p) => p.situacao === f.situacao) : todos;
    const contar = (s: SituacaoPrazoPagamento) => todos.filter((p) => p.situacao === s).length;
    return {
      ...paginarEmMemoria(filtrados, f.pagina, f.tamanhoPagina),
      resumo: {
        vencidos: contar('vencido'),
        venceHoje: contar('vence_hoje'),
        noPrazo: contar('no_prazo'),
        aguardandoMarco: contar('aguardando_marco'),
        atualizacaoEstimada: todos
          .filter((p) => p.situacao === 'vencido' && p.atualizacao)
          .reduce((t, p) => t + (p.atualizacao ? p.atualizacao.valorCorrecao + p.atualizacao.valorJuros : 0), 0),
      },
    };
  });

  app.get('/alteracoes-ordem', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<AlteracaoOrdemCronologica[]> => {
    const { uasg } = z.object({ uasg: codigoUasg.optional() }).parse(request.query);
    return listarAlteracoesOrdem(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)), uasg: uasg ?? null });
  });

  /** Registro da alteração justificada da ordem cronológica, prévio ao pagamento fora da ordem (art. 141, § 1º). */
  app.post('/pagamentos/:id/alteracoes-ordem', { preHandler: exigir('pagamentos:ordem_cronologica') }, async (request, reply): Promise<AlteracaoOrdemCronologica> => {
    const id = idDaRota(request.params);
    const entrada = esquemaAlteracao.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const alteracaoId = await ctx.banco.transacao(async (tx) => {
      const [pagamento] = await tx.consultar<{ situacao: string; pago_em: string | null; nota_fiscal: string; fonte_recurso: string; contrato_id: string; numero: string; posicao: number | null }>(
        `SELECT p.situacao, p.pago_em, p.nota_fiscal, p.fonte_recurso, p.contrato_id, c.numero,
                (SELECT COUNT(*) FROM pagamentos q
                  WHERE q.fonte_recurso = p.fonte_recurso AND q.situacao <> 'pago' AND (q.vencimento, q.criado_em, q.nota_fiscal) < (p.vencimento, p.criado_em, p.nota_fiscal))::integer + 1 AS posicao
           FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id
          WHERE p.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))
          FOR UPDATE OF p`,
        [id, escopo],
      );
      if (!pagamento) throw naoEncontrado('Pagamento não encontrado.');
      const validacao = validarAlteracaoOrdemCronologica({
        inciso: entrada.inciso,
        justificativa: entrada.justificativa,
        autoridade: entrada.autoridade,
        ato: entrada.ato,
        decididaEm: entrada.decididaEm,
        hoje: ctx.hoje(),
        pagoEm: pagamento.pago_em,
        exigivel: pagamento.situacao === 'atestado' || pagamento.situacao === 'liquidado',
      });
      if (pagamento.situacao !== 'pago' && pagamento.posicao === 1) {
        throw regraNegocio('Esta nota já é a primeira da fila da sua fonte de recurso: pagá-la agora não altera a ordem cronológica.');
      }
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO alteracoes_ordem_cronologica (pagamento_id, inciso, justificativa, autoridade, ato, decidida_em, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [id, validacao.inciso, entrada.justificativa, entrada.autoridade, entrada.ato, entrada.decididaEm, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Falha ao registrar a alteração da ordem');
      await auditar(tx, request, {
        acao: 'pagamento.alterar_ordem',
        recurso: 'pagamento',
        recursoId: id,
        resumo: `Registrou a alteração justificada da ordem cronológica para a nota fiscal ${pagamento.nota_fiscal} (art. 141, § 1º, ${validacao.inciso})`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: pagamento.contrato_id,
          alteracaoId: criada.id,
          inciso: validacao.inciso,
          fonteRecurso: pagamento.fonte_recurso,
          posicaoNaFila: pagamento.posicao,
          autoridade: entrada.autoridade,
          ato: entrada.ato,
          decididaEm: entrada.decididaEm,
          avisos: validacao.avisos,
          fundamento: validacao.fundamento,
        },
      });
      return criada.id;
    });
    const [alteracao] = await listarAlteracoesOrdem(ctx.banco, { escopo, id: alteracaoId });
    if (!alteracao) throw naoEncontrado();
    reply.status(201);
    return alteracao;
  });

  /** Comunicação posterior ao controle interno e ao tribunal de contas (art. 141, § 1º). */
  app.post('/alteracoes-ordem/:id/comunicacoes', { preHandler: exigir('pagamentos:ordem_cronologica') }, async (request): Promise<AlteracaoOrdemCronologica> => {
    const id = idDaRota(request.params);
    const entrada = esquemaComunicacao.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    await ctx.banco.transacao(async (tx) => {
      const [alteracao] = await listarAlteracoesOrdem(tx, { escopo, id });
      if (!alteracao) throw naoEncontrado('Alteração não encontrada.');
      if (entrada.data < alteracao.decididaEm) throw regraNegocio('A comunicação é posterior à decisão: a data não pode ser anterior a ela.');
      if (entrada.data > ctx.hoje()) throw regraNegocio('A data da comunicação não pode ser futura.');
      if (alteracao.comunicacoes.some((m) => m.orgao === entrada.orgao)) throw conflito('A comunicação a este órgão já foi registrada.');
      await tx.executar(
        `INSERT INTO alteracoes_ordem_comunicacoes (alteracao_id, orgao, data, protocolo, registrado_por, registrado_em) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, entrada.orgao, entrada.data, entrada.protocolo, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      const orgao = entrada.orgao === 'controle_interno' ? 'ao controle interno' : 'ao tribunal de contas';
      await auditar(tx, request, {
        acao: 'pagamento.alterar_ordem_comunicar',
        recurso: 'pagamento',
        recursoId: alteracao.pagamento.id,
        resumo: `Registrou a comunicação ${orgao} da alteração da ordem cronológica (${identificadorInstrumento('contrato', alteracao.contrato.numero)}, NF ${alteracao.pagamento.notaFiscal}) em ${formatarData(entrada.data)}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: alteracao.contrato.id, alteracaoId: id, orgao: entrada.orgao, data: entrada.data, protocolo: entrada.protocolo },
      });
    });
    const [alteracao] = await listarAlteracoesOrdem(ctx.banco, { escopo, id });
    if (!alteracao) throw naoEncontrado();
    return alteracao;
  });
}
