/**
 * F7 — instrumento de medição de resultado (IMR) do contrato (RF-29) e conferência da nota fiscal (RN-36).
 * Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A.
 * Perfil e escopo de UASG decididos aqui; toda escrita é transacional e gera evento na trilha de auditoria.
 * A glosa é ajuste do pagamento, não sanção: a faixa com previsão de processo sancionatório só abre pendência para o
 * gestor avaliar o encaminhamento (decisão da autoridade competente).
 */
import { calcularAjustePagamento, calcularResultadoImr, ehCompetencia, formatarMoeda, rotuloCompetencia, validarIndicadorImr } from '@agora/dominio';
import type { ContextoConferenciaNota, ImrContrato, RespostaMedicaoImr } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { obterPagamento } from '../financeiro/repositorio.ts';
import {
  abrirPendenciaEncaminhamento,
  calcularConferencia,
  competenciaDe,
  concluirTarefaMedicao,
  devidoNaCompetencia,
  garantirTarefaMedicao,
  gravarConferencia,
  indicadorDoContrato,
  indicadorDominio,
  indicadoresDoContrato,
  montarContextoConferencia,
  montarImrContrato,
  obterMedicao,
  pagamentoParaConferencia,
  recalcularConferenciasDaCompetencia,
  somarMesesCompetencia,
  type ContratoImr,
  type LinhaIndicador,
  type LinhaPagamentoConferencia,
} from './servico.ts';

const competencia = z.string().refine((c) => ehCompetencia(c), 'Use o formato AAAA-MM');
const textoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

const esquemaFaixa = z.object({
  limite: z.number(),
  percentualGlosa: z.number().min(0).max(100),
  percentualPorUnidade: z.number().min(0).max(100),
  encaminharSancionatorio: z.boolean(),
});

const esquemaIndicador = z
  .object({
    codigo: z.string().trim().min(1).max(20),
    nome: z.string().trim().min(3).max(200),
    formaCalculo: z.enum(['percentual_razao', 'valor_medido']),
    descricaoCalculo: z.string().trim().min(10).max(1000),
    rotuloNumerador: textoOpcional(120),
    rotuloDenominador: textoOpcional(120),
    unidade: z.string().trim().min(1).max(30),
    sentidoMeta: z.enum(['maior_igual', 'menor_igual']),
    meta: z.number(),
    periodicidade: z.enum(['mensal', 'bimestral', 'trimestral', 'semestral']),
    inicioCompetencia: competencia,
    fonteMedicao: z.string().trim().min(5).max(500),
    itensAlcancados: z.array(uuid).max(100),
    faixas: z.array(esquemaFaixa).min(1).max(10),
    tetoPercentual: z.number().gt(0).max(100).nullable(),
  })
  .refine((i) => i.formaCalculo !== 'percentual_razao' || (i.rotuloNumerador !== null && i.rotuloDenominador !== null), {
    message: 'Na forma percentual, informe o que é o numerador e o que é o denominador.',
    path: ['rotuloNumerador'],
  });

const esquemaEncerrar = z.object({ ultimaCompetencia: competencia, justificativa: z.string().trim().min(20).max(2000) });

const esquemaMedicao = z.object({
  indicadorId: uuid,
  competencia,
  numerador: z.number().nullish(),
  denominador: z.number().nullish(),
  valor: z.number().nullish(),
  evidencia: z.string().trim().min(10).max(2000),
  referenciaEvidencia: textoOpcional(200),
  observacao: textoOpcional(2000),
});

const esquemaConferencia = z.object({
  numeroNota: z.string().trim().min(1).max(60),
  emitidaEm: dataIso,
  valorNota: centavos,
  itens: z
    .array(
      z.object({
        itemContratoId: uuid,
        quantidadeRecebida: z.number().int().min(0).max(100_000_000),
        quantidadeFaturada: z.number().int().min(0).max(100_000_000),
        valorUnitarioFaturado: centavos,
      }),
    )
    .min(1)
    .max(200),
});

const esquemaJustificativa = z.object({ justificativa: z.string().trim().min(20).max(2000) });

const ROTULO_SITUACAO = { conforme: 'conforme', divergente: 'divergente', justificada: 'justificada' } as const;

function descreverResultado(valor: number, unidade: string): string {
  const texto = valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return unidade === '%' ? `${texto}%` : `${texto} ${unidade}`;
}

export async function rotasImr(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function contratoNoEscopo(executor: Executor, request: FastifyRequest, travar = false): Promise<ContratoImr & { vigencia_inicio: string; vigencia_fim: string }> {
    const id = idDaRota(request.params);
    const [contrato] = await executor.consultar<ContratoImr & { vigencia_inicio: string; vigencia_fim: string }>(
      `SELECT id, numero, uasg, objeto, gestor_id, fiscal_id, vigencia_inicio, vigencia_fim FROM contratos
        WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))${travar ? ' FOR UPDATE' : ''}`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  /** Itens alcançados precisam ser do próprio contrato; o início da medição, dentro da vigência. */
  async function validarConfiguracao(executor: Executor, contrato: { id: string; vigencia_inicio: string; vigencia_fim: string }, entrada: z.infer<typeof esquemaIndicador>) {
    const indicador = validarIndicadorImr({
      codigo: entrada.codigo,
      nome: entrada.nome,
      formaCalculo: entrada.formaCalculo,
      unidade: entrada.unidade,
      sentidoMeta: entrada.sentidoMeta,
      meta: entrada.meta,
      periodicidade: entrada.periodicidade,
      inicioCompetencia: entrada.inicioCompetencia,
      faixas: entrada.faixas,
      tetoPercentual: entrada.tetoPercentual,
    });
    const itens = [...new Set(entrada.itensAlcancados.map((i) => i.toLowerCase()))];
    if (itens.length > 0) {
      const [contagem] = await executor.consultar<{ total: number }>(
        'SELECT COUNT(*)::integer AS total FROM itens_contrato WHERE contrato_id = $1 AND id = ANY($2::uuid[])',
        [contrato.id, itens],
      );
      if ((contagem?.total ?? 0) !== itens.length) throw validacao('Os itens alcançados devem ser itens deste contrato.', [{ campo: 'itensAlcancados', mensagem: 'Item fora do contrato' }]);
    }
    if (entrada.inicioCompetencia < competenciaDe(contrato.vigencia_inicio) || entrada.inicioCompetencia > competenciaDe(contrato.vigencia_fim)) {
      throw regraNegocio('A primeira competência medida deve estar dentro da vigência do contrato.', [{ campo: 'inicioCompetencia', mensagem: 'Fora da vigência' }]);
    }
    return { indicador, itens };
  }

  /** Próxima competência com medição devida e não registrada, até 12 meses à frente (base da tarefa do plano de gestão). */
  async function proximaCompetenciaPendente(executor: Executor, contratoId: string, hoje: string): Promise<string | null> {
    const indicadores = await indicadoresDoContrato(executor, contratoId);
    if (indicadores.length === 0) return null;
    const medidas = new Set(
      (await executor.consultar<{ indicador_id: string; competencia: string }>('SELECT indicador_id, competencia FROM imr_medicoes WHERE contrato_id = $1', [contratoId])).map(
        (m) => `${m.indicador_id}:${m.competencia}`,
      ),
    );
    const limite = somarMesesCompetencia(competenciaDe(hoje), 12);
    let c = indicadores.map((i) => i.inicio_competencia).sort()[0] ?? limite;
    for (; c <= limite; c = somarMesesCompetencia(c, 1)) {
      const atual = c;
      if (indicadores.some((i) => devidoNaCompetencia(i, atual) && !medidas.has(`${i.id}:${atual}`))) return c;
    }
    return null;
  }

  // ───────── IMR do contrato ─────────

  app.get('/contratos/:id/imr', { preHandler: exigir('contratos:ler') }, async (request): Promise<ImrContrato> => {
    const contrato = await contratoNoEscopo(ctx.banco, request);
    return montarImrContrato(ctx.banco, contrato, ctx.hoje());
  });

  app.post('/contratos/:id/imr/indicadores', { preHandler: exigir('imr:configurar') }, async (request, reply): Promise<ImrContrato> => {
    const entrada = esquemaIndicador.parse(request.body);
    const sessao = sessaoDe(request);
    const agora = ctx.relogio().toISOString();
    const contrato = await ctx.banco.transacao(async (tx) => {
      const c = await contratoNoEscopo(tx, request, true);
      const { indicador, itens } = await validarConfiguracao(tx, c, entrada);
      const [repetido] = await tx.consultar<{ id: string }>('SELECT id FROM imr_indicadores WHERE contrato_id = $1 AND codigo = $2', [c.id, indicador.codigo]);
      if (repetido) throw conflito(`O contrato já tem um indicador com o código ${indicador.codigo}.`);
      const [criado] = await tx.consultar<{ id: string }>(
        `INSERT INTO imr_indicadores (contrato_id, codigo, nome, forma_calculo, descricao_calculo, rotulo_numerador, rotulo_denominador, unidade,
                                      sentido_meta, meta, periodicidade, inicio_competencia, fonte_medicao, itens_alcancados, faixas,
                                      teto_percentual, criado_por, criado_em, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid[], $15::jsonb, $16, $17, $18, $18)
         RETURNING id`,
        [
          c.id,
          indicador.codigo,
          indicador.nome,
          indicador.formaCalculo,
          entrada.descricaoCalculo,
          indicador.formaCalculo === 'percentual_razao' ? entrada.rotuloNumerador : null,
          indicador.formaCalculo === 'percentual_razao' ? entrada.rotuloDenominador : null,
          indicador.unidade,
          indicador.sentidoMeta,
          indicador.meta,
          indicador.periodicidade,
          indicador.inicioCompetencia,
          entrada.fonteMedicao,
          itens,
          JSON.stringify(indicador.faixas),
          indicador.tetoPercentual,
          sessao.usuario.id,
          agora,
        ],
      );
      const proxima = await proximaCompetenciaPendente(tx, c.id, ctx.hoje());
      const tarefaCriada = proxima ? await garantirTarefaMedicao(tx, c, proxima) : false;
      await auditar(tx, request, {
        acao: 'contrato.imr.indicador.criar',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: `Incluiu o indicador ${indicador.codigo} (${indicador.nome}) no IMR do contrato ${c.numero}`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: c.id,
          indicadorId: criado?.id ?? null,
          meta: { sentido: indicador.sentidoMeta, valor: indicador.meta, unidade: indicador.unidade },
          periodicidade: indicador.periodicidade,
          inicioCompetencia: indicador.inicioCompetencia,
          faixas: indicador.faixas.length,
          tarefaMedicao: tarefaCriada && proxima ? proxima : null,
        },
      });
      return c;
    });
    reply.status(201);
    return montarImrContrato(ctx.banco, contrato, ctx.hoje());
  });

  app.put('/contratos/:id/imr/indicadores/:indicadorId', { preHandler: exigir('imr:configurar') }, async (request): Promise<ImrContrato> => {
    const entrada = esquemaIndicador.parse(request.body);
    const indicadorId = idDaRota(request.params, 'indicadorId');
    const contrato = await ctx.banco.transacao(async (tx) => {
      const c = await contratoNoEscopo(tx, request, true);
      const atual = await indicadorDoContrato(tx, c.id, indicadorId);
      if (!atual) throw naoEncontrado('Indicador não encontrado.');
      if (atual.medicoes > 0) throw conflito('O indicador já tem medições registradas e não pode ser alterado. Encerre-o e inclua um novo indicador, se a alteração estiver prevista no contrato ou em termo aditivo.');
      const { indicador, itens } = await validarConfiguracao(tx, c, entrada);
      const [repetido] = await tx.consultar<{ id: string }>('SELECT id FROM imr_indicadores WHERE contrato_id = $1 AND codigo = $2 AND id <> $3', [c.id, indicador.codigo, indicadorId]);
      if (repetido) throw conflito(`O contrato já tem um indicador com o código ${indicador.codigo}.`);
      await tx.executar(
        `UPDATE imr_indicadores
            SET codigo = $2, nome = $3, forma_calculo = $4, descricao_calculo = $5, rotulo_numerador = $6, rotulo_denominador = $7, unidade = $8,
                sentido_meta = $9, meta = $10, periodicidade = $11, inicio_competencia = $12, fonte_medicao = $13, itens_alcancados = $14::uuid[],
                faixas = $15::jsonb, teto_percentual = $16, atualizado_em = $17
          WHERE id = $1`,
        [
          indicadorId,
          indicador.codigo,
          indicador.nome,
          indicador.formaCalculo,
          entrada.descricaoCalculo,
          indicador.formaCalculo === 'percentual_razao' ? entrada.rotuloNumerador : null,
          indicador.formaCalculo === 'percentual_razao' ? entrada.rotuloDenominador : null,
          indicador.unidade,
          indicador.sentidoMeta,
          indicador.meta,
          indicador.periodicidade,
          indicador.inicioCompetencia,
          entrada.fonteMedicao,
          itens,
          JSON.stringify(indicador.faixas),
          indicador.tetoPercentual,
          ctx.relogio().toISOString(),
        ],
      );
      await auditar(tx, request, {
        acao: 'contrato.imr.indicador.alterar',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: `Alterou o indicador ${indicador.codigo} (${indicador.nome}) do IMR do contrato ${c.numero}`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: c.id,
          indicadorId,
          antes: { codigo: atual.codigo, meta: Number(atual.meta), sentido: atual.sentido_meta, faixas: atual.faixas.length },
          depois: { codigo: indicador.codigo, meta: indicador.meta, sentido: indicador.sentidoMeta, faixas: indicador.faixas.length },
        },
      });
      return c;
    });
    return montarImrContrato(ctx.banco, contrato, ctx.hoje());
  });

  app.post('/contratos/:id/imr/indicadores/:indicadorId/encerrar', { preHandler: exigir('imr:configurar') }, async (request): Promise<ImrContrato> => {
    const entrada = esquemaEncerrar.parse(request.body);
    const indicadorId = idDaRota(request.params, 'indicadorId');
    const contrato = await ctx.banco.transacao(async (tx) => {
      const c = await contratoNoEscopo(tx, request, true);
      const atual = await indicadorDoContrato(tx, c.id, indicadorId);
      if (!atual) throw naoEncontrado('Indicador não encontrado.');
      if (atual.situacao === 'encerrado') throw conflito('O indicador já está encerrado.');
      if (entrada.ultimaCompetencia < somarMesesCompetencia(atual.inicio_competencia, -1)) {
        throw regraNegocio('A última competência não pode ser anterior ao início da medição do indicador.');
      }
      const [posterior] = await tx.consultar<{ competencia: string }>(
        'SELECT competencia FROM imr_medicoes WHERE indicador_id = $1 AND competencia > $2 ORDER BY competencia LIMIT 1',
        [indicadorId, entrada.ultimaCompetencia],
      );
      if (posterior) throw regraNegocio(`Há medição registrada depois da última competência informada (${rotuloCompetencia(posterior.competencia)}).`);
      await tx.executar(
        "UPDATE imr_indicadores SET situacao = 'encerrado', encerrado_apos = $2, justificativa_encerramento = $3, atualizado_em = $4 WHERE id = $1",
        [indicadorId, entrada.ultimaCompetencia, entrada.justificativa, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'contrato.imr.indicador.encerrar',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: `Encerrou o indicador ${atual.codigo} do IMR do contrato ${c.numero} após a competência ${rotuloCompetencia(entrada.ultimaCompetencia)}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: c.id, indicadorId, ultimaCompetencia: entrada.ultimaCompetencia },
      });
      return c;
    });
    return montarImrContrato(ctx.banco, contrato, ctx.hoje());
  });

  app.post('/contratos/:id/imr/medicoes', { preHandler: exigir('imr:medir') }, async (request, reply): Promise<RespostaMedicaoImr> => {
    const entrada = esquemaMedicao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio().toISOString();
    const resposta = await ctx.banco.transacao(async (tx) => {
      const c = await contratoNoEscopo(tx, request, true);
      const linha: LinhaIndicador | null = await indicadorDoContrato(tx, c.id, entrada.indicadorId.toLowerCase());
      if (!linha) throw naoEncontrado('Indicador não encontrado neste contrato.');
      if (entrada.competencia >= competenciaDe(hoje)) {
        throw regraNegocio('Só é possível medir competência já encerrada: aguarde o fim do mês para registrar a medição.', [{ campo: 'competencia', mensagem: 'Competência em curso ou futura' }]);
      }
      if (!devidoNaCompetencia(linha, entrada.competencia)) {
        throw regraNegocio(
          `O indicador ${linha.codigo} não tem medição prevista na competência ${rotuloCompetencia(entrada.competencia)} (início em ${rotuloCompetencia(linha.inicio_competencia)}, periodicidade ${linha.periodicidade}${linha.encerrado_apos ? `, encerrado após ${rotuloCompetencia(linha.encerrado_apos)}` : ''}).`,
          [{ campo: 'competencia', mensagem: 'Sem medição prevista' }],
        );
      }
      const [repetida] = await tx.consultar<{ id: string }>('SELECT id FROM imr_medicoes WHERE indicador_id = $1 AND competencia = $2', [linha.id, entrada.competencia]);
      if (repetida) throw conflito(`A medição do indicador ${linha.codigo} na competência ${rotuloCompetencia(entrada.competencia)} já foi registrada.`);

      const indicador = indicadorDominio(linha);
      const calculo = calcularResultadoImr(indicador, { numerador: entrada.numerador ?? null, denominador: entrada.denominador ?? null, valor: entrada.valor ?? null });
      const ajuste = calcularAjustePagamento({ indicador, resultado: calculo.resultado });
      const memoria = [...calculo.memoriaCalculo, ...ajuste.memoriaCalculo];
      const percentual = linha.forma_calculo === 'percentual_razao';

      let pendenciaId: string | null = null;
      if (ajuste.encaminharSancionatorio && ajuste.faixa !== null) {
        pendenciaId = await abrirPendenciaEncaminhamento(tx, hoje, c, {
          codigo: linha.codigo,
          nome: linha.nome,
          competencia: entrada.competencia,
          faixa: ajuste.faixa,
          resultado: descreverResultado(calculo.resultado, linha.unidade),
        });
      }
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO imr_medicoes (indicador_id, contrato_id, competencia, numerador, denominador, valor_informado, resultado, atingiu_meta, faixa,
                                   percentual_glosa, encaminhar_sancionatorio, memoria_calculo, evidencia, referencia_evidencia, observacao,
                                   pendencia_id, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [
          linha.id,
          c.id,
          entrada.competencia,
          percentual ? (entrada.numerador ?? null) : null,
          percentual ? (entrada.denominador ?? null) : null,
          percentual ? null : (entrada.valor ?? null),
          calculo.resultado,
          ajuste.atingiuMeta,
          ajuste.faixa,
          ajuste.percentualGlosa,
          ajuste.encaminharSancionatorio,
          JSON.stringify(memoria),
          entrada.evidencia,
          entrada.referenciaEvidencia,
          entrada.observacao,
          pendenciaId,
          sessao.usuario.id,
          agora,
        ],
      );
      if (!criada) throw new Error('Falha ao gravar a medição.');

      const recalculadas = await recalcularConferenciasDaCompetencia(tx, c.id, entrada.competencia);
      for (const r of recalculadas) {
        await auditar(tx, request, {
          acao: 'pagamento.conferencia.recalcular',
          recurso: 'pagamento',
          recursoId: r.pagamentoId,
          resumo: `Recalculou a conferência da nota fiscal após a medição do indicador ${linha.codigo}: valor devido de ${formatarMoeda(r.anterior)} para ${formatarMoeda(r.valorDevido)} (${ROTULO_SITUACAO[r.situacao]})`,
          dados: { instrumentoTipo: 'contrato', instrumentoId: c.id, competencia: entrada.competencia, valorDevido: { de: r.anterior, para: r.valorDevido }, situacao: r.situacao },
        });
      }
      const tarefaConcluida = await concluirTarefaMedicao(tx, c.id, entrada.competencia, sessao.usuario.id, agora);
      const proxima = await proximaCompetenciaPendente(tx, c.id, hoje);
      if (proxima) await garantirTarefaMedicao(tx, c, proxima);

      await auditar(tx, request, {
        acao: 'contrato.imr.medicao.registrar',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: ajuste.atingiuMeta
          ? `Registrou a medição do indicador ${linha.codigo} da competência ${rotuloCompetencia(entrada.competencia)}: ${descreverResultado(calculo.resultado, linha.unidade)}, meta atingida`
          : `Registrou a medição do indicador ${linha.codigo} da competência ${rotuloCompetencia(entrada.competencia)}: ${descreverResultado(calculo.resultado, linha.unidade)}, glosa de ${ajuste.percentualGlosa.toLocaleString('pt-BR')}%${pendenciaId ? ' e encaminhamento para avaliação sancionatória' : ''}`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: c.id,
          medicaoId: criada.id,
          indicadorId: linha.id,
          competencia: entrada.competencia,
          resultado: calculo.resultado,
          atingiuMeta: ajuste.atingiuMeta,
          faixa: ajuste.faixa,
          percentualGlosa: ajuste.percentualGlosa,
          pendenciaId,
          tarefaConcluida,
          conferenciasRecalculadas: recalculadas.length,
          fundamento: ajuste.fundamento,
        },
      });
      return { id: criada.id, pendenciaAberta: pendenciaId !== null, conferenciasRecalculadas: recalculadas.length };
    });
    const medicao = await obterMedicao(ctx.banco, resposta.id);
    if (!medicao) throw naoEncontrado('Medição não encontrada.');
    reply.status(201);
    return { medicao, pendenciaAberta: resposta.pendenciaAberta, conferenciasRecalculadas: resposta.conferenciasRecalculadas };
  });

  // ───────── conferência da nota fiscal ─────────

  async function pagamentoDaRota(executor: Executor, request: FastifyRequest, travar = false): Promise<LinhaPagamentoConferencia> {
    const pagamento = await pagamentoParaConferencia(executor, idDaRota(request.params), escopoUasgs(sessaoDe(request)), travar);
    if (!pagamento) throw naoEncontrado('Pagamento não encontrado.');
    return pagamento;
  }

  async function responderContexto(request: FastifyRequest, id: string): Promise<ContextoConferenciaNota> {
    const escopo = escopoUasgs(sessaoDe(request));
    const linha = await pagamentoParaConferencia(ctx.banco, id, escopo);
    const exibido = await obterPagamento(ctx.banco, id, escopo, ctx.hoje());
    if (!linha || !exibido) throw naoEncontrado('Pagamento não encontrado.');
    return montarContextoConferencia(ctx.banco, linha, exibido);
  }

  app.get('/pagamentos/:id/conferencia', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<ContextoConferenciaNota> => {
    const pagamento = await pagamentoDaRota(ctx.banco, request);
    return responderContexto(request, pagamento.id);
  });

  app.post('/pagamentos/:id/conferencia', { preHandler: exigir('pagamentos:conferir') }, async (request): Promise<ContextoConferenciaNota> => {
    const entrada = esquemaConferencia.parse(request.body);
    if (entrada.emitidaEm > ctx.hoje()) throw validacao('A data de emissão da nota não pode ser futura.', [{ campo: 'emitidaEm', mensagem: 'Data futura' }]);
    const sessao = sessaoDe(request);
    const id = await ctx.banco.transacao(async (tx: Transacao) => {
      const pagamento = await pagamentoDaRota(tx, request, true);
      if (pagamento.situacao !== 'previsto') throw conflito('A nota desta parcela já foi atestada: a conferência não pode mais ser alterada.');
      const resultado = await calcularConferencia(tx, pagamento, entrada);
      const gravada = await gravarConferencia(tx, { pagamento, nota: entrada, resultado, usuarioId: sessao.usuario.id, agora: ctx.relogio().toISOString() });
      await auditar(tx, request, {
        acao: 'pagamento.conferencia.registrar',
        recurso: 'pagamento',
        recursoId: pagamento.id,
        resumo: `${gravada.anterior ? 'Corrigiu' : 'Registrou'} a conferência da nota fiscal ${entrada.numeroNota} do contrato ${pagamento.contrato_numero}: nota de ${formatarMoeda(entrada.valorNota)} × devido de ${formatarMoeda(resultado.valorDevido)} (${ROTULO_SITUACAO[gravada.situacao]})`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: pagamento.contrato_id,
          conferenciaId: gravada.id,
          versao: gravada.versao,
          competencia: pagamento.competencia,
          notaFiscal: { de: pagamento.nota_fiscal, para: entrada.numeroNota },
          valorNota: entrada.valorNota,
          valorBruto: resultado.valorBruto,
          glosaImr: resultado.glosaImr,
          valorDevido: resultado.valorDevido,
          diferenca: resultado.diferenca,
          situacao: gravada.situacao,
          divergencias: resultado.divergencias.map((d) => d.tipo),
          anterior: gravada.anterior,
          fundamento: resultado.fundamento,
        },
      });
      return pagamento.id;
    });
    return responderContexto(request, id);
  });

  app.post('/pagamentos/:id/conferencia/justificativa', { preHandler: exigir('pagamentos:conferir') }, async (request): Promise<ContextoConferenciaNota> => {
    const { justificativa } = esquemaJustificativa.parse(request.body);
    const sessao = sessaoDe(request);
    const id = await ctx.banco.transacao(async (tx) => {
      const pagamento = await pagamentoDaRota(tx, request, true);
      if (pagamento.situacao !== 'previsto') throw conflito('A nota desta parcela já foi atestada.');
      const [conferencia] = await tx.consultar<{ id: string; situacao: string; numero_nota: string; valor_nota: number; valor_devido: number; glosa_imr: number; valor_a_liquidar: number; divergencias: { tipo: string }[]; versao: number }>(
        'SELECT id, situacao, numero_nota, valor_nota, valor_devido, glosa_imr, valor_a_liquidar, divergencias, versao FROM conferencias_nota_fiscal WHERE pagamento_id = $1 FOR UPDATE',
        [pagamento.id],
      );
      if (!conferencia) throw conflito('Registre a conferência da nota fiscal antes de justificar.');
      if (conferencia.situacao !== 'divergente') throw conflito(conferencia.situacao === 'conforme' ? 'A nota está conforme: não há divergência a justificar.' : 'A divergência já foi justificada.');
      const agora = ctx.relogio().toISOString();
      await tx.executar("UPDATE conferencias_nota_fiscal SET situacao = 'justificada', justificativa = $2, justificada_por = $3, justificada_em = $4 WHERE id = $1", [
        conferencia.id,
        justificativa,
        sessao.usuario.id,
        agora,
      ]);
      await auditar(tx, request, {
        acao: 'pagamento.conferencia.justificar',
        recurso: 'pagamento',
        recursoId: pagamento.id,
        resumo: `Justificou a divergência da nota fiscal ${conferencia.numero_nota}: nota de ${formatarMoeda(conferencia.valor_nota)} × devido de ${formatarMoeda(conferencia.valor_devido)}; a liquidar ${formatarMoeda(conferencia.valor_a_liquidar)}`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: pagamento.contrato_id,
          conferenciaId: conferencia.id,
          versao: conferencia.versao,
          divergencias: conferencia.divergencias.map((d) => d.tipo),
          glosaImr: conferencia.glosa_imr,
          valorALiquidar: conferencia.valor_a_liquidar,
          justificativa,
        },
      });
      return pagamento.id;
    });
    return responderContexto(request, id);
  });
}
