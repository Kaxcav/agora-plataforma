/**
 * Execução contratual como ato, parte 2 (F22, frente L): fiscalização (art. 117), recebimento provisório e definitivo
 * (art. 140; RN-34), garantias (arts. 96 a 102; RN-35) e desconto de multa (art. 156, § 8º).
 *
 * Toda escrita valida a entrada com zod, exige a permissão, aplica o escopo de UASG e grava na mesma transação o ato e
 * o evento da trilha de auditoria. Além da permissão, o servidor confere a designação no contrato: só fiscal ou gestor
 * lavram o provisório, só gestor ou comissão o definitivo (RN-34). As decisões (aceitar, rejeitar, liberar, executar,
 * descontar) são humanas; o domínio valida e calcula.
 */
import {
  adicionarDias,
  atualizarCaucaoDinheiro,
  avaliarExecucaoGarantia,
  avaliarLiberacaoGarantia,
  avaliarOrdemServico,
  avaliarPercentualGarantia,
  avaliarReservasCargos,
  avaliarTermoRecebimento,
  baseCalculoGarantia,
  calcularPrazoPagamento,
  formatarData,
  formatarMoeda,
  planejarDescontoMulta,
  prazoRecebimentoProvisorio,
  ROTULOS_MODALIDADE_GARANTIA,
  ROTULOS_PAPEL_FISCALIZACAO,
  validarApresentacaoGarantia,
  validarDecisaoAutoridade,
  validarOcorrencia,
  verificarDesignacoesContrato,
  type PapelFiscalizacao,
} from '@agora/dominio';
import type {
  DesignacaoContrato,
  ExecucaoContrato,
  OcorrenciaContrato,
  OrdemServicoContrato,
  ParametrosExecucaoContrato,
  RecebimentoContrato,
  RespostaDescontoMulta,
  RespostaGarantia,
  RespostaTermoRecebimento,
  ServidorDesignavel,
  VerificacaoRegularidade,
  VerificacaoReservasCargos,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { permissoesDosPerfis, ehCodigoPerfil } from '../../autorizacao/perfis.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, normalizarBusca } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { registrarAtesto } from '../financeiro/atesto.ts';
import { situacaoAtestoConferencia } from '../imr/servico.ts';
import { processarFila } from '../notificacoes/servico.ts';
import { verificarRegularidade } from '../regularidade/servico.ts';
import { avisarVencimentoGarantia, espelharDesignacoesNoContrato, espelharGarantiaNoContrato, notificarContratada, registrarDesempenho } from './avisos.ts';
import {
  carregarDescontos,
  carregarDesignacoes,
  carregarGarantias,
  carregarMultas,
  carregarOcorrencias,
  carregarOrdensServico,
  carregarParametros,
  carregarReservasCargos,
  carregarRecebimentos,
  contratoExecucao,
  designacoesAtivas,
  montarExecucao,
  pagamentosDevidos,
  papeisDoUsuario,
  termoParaPdf,
  variacoesIpca,
  type ContratoExecucao,
} from './repositorio.ts';
import { rotasPrazosPagamento } from './pagamentos.ts';
import { gerarTermoPdf, tituloTermo } from './termos.ts';

const PAPEIS = ['gestor', 'fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante', 'comissao_recebimento'] as const;
const MODALIDADES = ['caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria', 'titulo_capitalizacao'] as const;
const texto = (minimo: number, maximo: number) => z.string().trim().min(minimo).max(maximo);
const textoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const esquemaParametros = z.object({
  prazoProvisorioDiasUteis: z.number().int().min(1).max(90),
  prazoDefinitivoDiasUteis: z.number().int().min(1).max(180),
  prazoCorrecaoDiasUteis: z.number().int().min(1).max(180),
  prazoLiquidacaoDiasUteis: z.number().int().min(1).max(60),
  prazoPagamentoDias: z.number().int().min(1).max(120),
  marcoPagamento: z.enum(['recebimento_definitivo', 'liquidacao']),
  indiceAtualizacao: texto(2, 40),
  jurosMoraMensal: z.number().min(0).max(2),
  garantiaObjetoMeses: z.number().int().min(0).max(120),
  periodoAntecedenteDiasUteis: z.number().int().min(0).max(60).default(0),
  reservaMulheresPercentual: z.number().min(0).max(100).default(0),
  reservaEgressos: z.boolean().default(false),
});

const esquemaOrdemServico = z.object({ numero: texto(1, 60), expedidaEm: dataIso, descricao: texto(5, 2000) });

const esquemaReservas = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM'),
  empregados: z.number().int().min(0).max(1_000_000),
  mulheres: z.number().int().min(0).max(1_000_000),
  egressos: z.number().int().min(0).max(1_000_000),
  pcdComprovada: z.boolean(),
  aprendizesComprovada: z.boolean(),
  observacao: textoOpcional(2000),
});

const esquemaDesignacao = z.object({
  papel: z.enum(PAPEIS),
  usuarioId: uuid,
  substituto: z.boolean().optional().default(false),
  ato: texto(3, 200),
  inicio: dataIso,
});

const esquemaEncerrar = z.object({ fim: dataIso, motivo: texto(10, 1000) });

const esquemaOcorrencia = z.object({
  tipo: z.enum(['falha_execucao', 'atraso', 'inconformidade', 'comunicacao', 'outra']),
  dataFato: dataIso,
  relato: texto(1, 5000),
  providencia: textoOpcional(2000),
  prazoRegularizacao: dataIso.nullable(),
  notificarContratada: z.boolean(),
});

const esquemaRegularizar = z.object({ data: dataIso, observacao: texto(10, 2000) });

const esquemaRecebimento = z.object({
  descricao: texto(5, 500),
  valor: centavos,
  entregueEm: dataIso,
  pagamentoId: uuid.nullable(),
});

const esquemaTermo = z.object({
  tipo: z.enum(['provisorio', 'definitivo']),
  resultado: z.enum(['aceito', 'com_ressalva', 'rejeitado']),
  data: dataIso,
  observacoes: textoOpcional(5000),
});

const esquemaExigencia = z.object({
  finalidade: z.enum(['execucao', 'antecipacao']),
  percentual: z.number().positive().max(100),
  valorBase: centavos.positive().nullable().optional(),
  justificativa: textoOpcional(3000),
  grandeVultoEngenharia: z.boolean(),
  clausulaRetomada: z.boolean(),
  modalidadeExigida: z.enum(MODALIDADES).nullable(),
  prazoApresentacao: dataIso,
});

const esquemaApresentacao = z.object({
  modalidade: z.enum(MODALIDADES),
  valor: centavos.positive(),
  apresentadaEm: dataIso,
  validaAte: dataIso,
  emissor: textoOpcional(200),
  documento: textoOpcional(120),
});

const esquemaRenovacao = z.object({
  data: dataIso,
  validaAte: dataIso,
  documento: textoOpcional(120),
  valor: centavos.positive().nullable(),
});

const esquemaLiberacao = z.object({ data: dataIso, extincaoCulpaAdministracao: z.boolean(), observacao: texto(10, 2000) });

const esquemaDecisao = {
  autoridade: texto(5, 200),
  ato: texto(3, 200),
  decididaEm: dataIso,
  justificativa: texto(1, 5000),
};
const esquemaExecucao = z.object({ ...esquemaDecisao, motivo: z.enum(['ressarcimento_prejuizos', 'verbas_trabalhistas', 'retomada_seguradora']), valor: centavos.positive() });
const esquemaDesconto = z.object({ ...esquemaDecisao, valor: centavos.positive() });

/** Ordem de preferência do papel com que o termo é lavrado. */
const PAPEL_PROVISORIO: readonly PapelFiscalizacao[] = ['fiscal_tecnico', 'fiscal_requisitante', 'fiscal_administrativo', 'gestor'];
const PAPEL_DEFINITIVO: readonly PapelFiscalizacao[] = ['comissao_recebimento', 'gestor'];

/** Número sequencial por contrato (a linha do contrato é travada pelo chamador). */
async function proximoNumero(tx: Transacao, tabela: 'contratos_ocorrencias' | 'contratos_recebimentos', contratoId: string): Promise<number> {
  const [linha] = await tx.consultar<{ proximo: number }>(`SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM ${tabela} WHERE contrato_id = $1`, [contratoId]);
  return linha?.proximo ?? 1;
}

/** Contrato sem designação registrada ainda: importa o gestor e o fiscal do cadastro antes da primeira mudança. */
async function garantirDesignacoesIniciais(tx: Transacao, c: ContratoExecucao, agora: Date): Promise<void> {
  const [existe] = await tx.consultar<{ total: number }>('SELECT COUNT(*)::integer AS total FROM contratos_designacoes WHERE contrato_id = $1', [c.id]);
  if ((existe?.total ?? 0) > 0) return;
  for (const [papel, usuarioId] of [
    ['gestor', c.gestor_id],
    ['fiscal_tecnico', c.fiscal_id],
  ] as const) {
    if (!usuarioId) continue;
    await tx.executar(
      `INSERT INTO contratos_designacoes (contrato_id, papel, usuario_id, ato, inicio, designado_em)
       VALUES ($1, $2, $3, 'Designação registrada no cadastro do contrato', $4, $5)`,
      [c.id, papel, usuarioId, c.assinatura_em, agora.toISOString()],
    );
  }
}

export async function rotasExecucaoContrato(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function contratoDaRota(request: FastifyRequest, executor: Executor = ctx.banco, bloquear = false, campo = 'id'): Promise<ContratoExecucao> {
    const id = idDaRota(request.params, campo);
    const contrato = await contratoExecucao(executor, id, escopoUasgs(sessaoDe(request)), bloquear);
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  /** Contrato de um registro filho (designação, ocorrência, entrega ou garantia), no escopo e travado. */
  async function contratoDoRegistro(tx: Transacao, request: FastifyRequest, tabela: string, id: string): Promise<ContratoExecucao> {
    const [linha] = await tx.consultar<{ contrato_id: string }>(`SELECT contrato_id FROM ${tabela} WHERE id = $1`, [id]);
    if (!linha) throw naoEncontrado();
    const contrato = await contratoExecucao(tx, linha.contrato_id, escopoUasgs(sessaoDe(request)), true);
    if (!contrato) throw naoEncontrado();
    return contrato;
  }

  async function exigirDesignado(executor: Executor, contratoId: string, usuarioId: string, mensagem: string): Promise<PapelFiscalizacao[]> {
    const papeis = await papeisDoUsuario(executor, contratoId, usuarioId, ctx.hoje());
    if (papeis.length === 0) throw regraNegocio(mensagem);
    return papeis;
  }

  // ───────── leitura das abas ─────────

  app.get('/contratos/:id/execucao', { preHandler: exigir('contratos:ler') }, async (request): Promise<ExecucaoContrato> => {
    const contrato = await contratoDaRota(request);
    return montarExecucao(ctx.banco, contrato, sessaoDe(request).usuario.id, ctx.hoje());
  });

  // ───────── prazos do contrato (art. 140, § 3º; art. 92, V a VII) ─────────

  app.put('/contratos/:id/parametros-execucao', { preHandler: exigir('fiscalizacao:designar') }, async (request): Promise<ParametrosExecucaoContrato> => {
    const entrada = esquemaParametros.parse(request.body);
    const sessao = sessaoDe(request);
    const id = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const anterior = await carregarParametros(tx, contrato.id);
      await tx.executar(
        `INSERT INTO contratos_parametros_execucao (contrato_id, prazo_provisorio_dias_uteis, prazo_definitivo_dias_uteis, prazo_correcao_dias_uteis,
                                                    prazo_liquidacao_dias_uteis, prazo_pagamento_dias, marco_pagamento, indice_atualizacao,
                                                    juros_mora_mensal, garantia_objeto_meses, periodo_antecedente_dias_uteis,
                                                    reserva_mulheres_percentual, reserva_egressos, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (contrato_id) DO UPDATE SET
           prazo_provisorio_dias_uteis = EXCLUDED.prazo_provisorio_dias_uteis, prazo_definitivo_dias_uteis = EXCLUDED.prazo_definitivo_dias_uteis,
           prazo_correcao_dias_uteis = EXCLUDED.prazo_correcao_dias_uteis, prazo_liquidacao_dias_uteis = EXCLUDED.prazo_liquidacao_dias_uteis,
           prazo_pagamento_dias = EXCLUDED.prazo_pagamento_dias, marco_pagamento = EXCLUDED.marco_pagamento,
           indice_atualizacao = EXCLUDED.indice_atualizacao, juros_mora_mensal = EXCLUDED.juros_mora_mensal,
           garantia_objeto_meses = EXCLUDED.garantia_objeto_meses, periodo_antecedente_dias_uteis = EXCLUDED.periodo_antecedente_dias_uteis,
           reserva_mulheres_percentual = EXCLUDED.reserva_mulheres_percentual, reserva_egressos = EXCLUDED.reserva_egressos,
           atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em`,
        [
          contrato.id,
          entrada.prazoProvisorioDiasUteis,
          entrada.prazoDefinitivoDiasUteis,
          entrada.prazoCorrecaoDiasUteis,
          entrada.prazoLiquidacaoDiasUteis,
          entrada.prazoPagamentoDias,
          entrada.marcoPagamento,
          entrada.indiceAtualizacao,
          entrada.jurosMoraMensal,
          entrada.garantiaObjetoMeses,
          entrada.periodoAntecedenteDiasUteis,
          entrada.reservaMulheresPercentual,
          entrada.reservaEgressos,
          sessao.usuario.id,
          ctx.relogio().toISOString(),
        ],
      );
      await auditar(tx, request, {
        acao: 'contrato.parametros_execucao',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Definiu os prazos de recebimento e pagamento do ${identificadorInstrumento('contrato', contrato.numero)}`,
        dados: {
          antes: anterior ? { ...anterior, atualizadoPor: undefined, atualizadoEm: undefined } : null,
          depois: entrada,
          fundamento: 'Lei 14.133/2021, art. 92, V a VII, e art. 140, § 3º',
        },
      });
      return contrato.id;
    });
    const parametros = await carregarParametros(ctx.banco, id);
    if (!parametros) throw naoEncontrado();
    return parametros;
  });

  // ───────── ordem de serviço (art. 92, § 2º) ─────────

  app.post('/contratos/:id/ordens-servico', { preHandler: exigir('fiscalizacao:designar') }, async (request, reply): Promise<OrdemServicoContrato> => {
    const entrada = esquemaOrdemServico.parse(request.body);
    const sessao = sessaoDe(request);
    const calendario = await opcoesCalendario(ctx.banco);
    const { contratoId, ordemId } = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const parametros = await carregarParametros(tx, contrato.id);
      const avaliacao = avaliarOrdemServico({
        assinaturaEm: contrato.assinatura_em,
        periodoAntecedenteDiasUteis: parametros?.periodoAntecedenteDiasUteis ?? 0,
        expedidaEm: entrada.expedidaEm,
        hoje: ctx.hoje(),
        opcoes: calendario,
      });
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO contratos_ordens_servico (contrato_id, numero, expedida_em, descricao, antes_do_periodo, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [contrato.id, entrada.numero, entrada.expedidaEm, entrada.descricao, avaliacao.antesDoPeriodo, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Falha ao registrar a ordem de serviço');
      await auditar(tx, request, {
        acao: 'contrato.ordem_servico',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a ordem de serviço ${entrada.numero}, expedida em ${formatarData(entrada.expedidaEm)}`,
        dados: { ordemId: criada.id, numero: entrada.numero, expedidaEm: entrada.expedidaEm, fimPeriodoAntecedente: avaliacao.fimPeriodoAntecedente, avisos: avaliacao.avisos, fundamento: avaliacao.fundamento },
      });
      return { contratoId: contrato.id, ordemId: criada.id };
    });
    const ordem = (await carregarOrdensServico(ctx.banco, contratoId)).find((o) => o.id === ordemId);
    if (!ordem) throw naoEncontrado();
    reply.status(201);
    return ordem;
  });

  // ───────── reservas legais de cargos (art. 92, XVII) ─────────

  /**
   * Verificação mensal das reservas de cargos pela fiscalização. Com pendência, a Ágora registra a ocorrência no livro
   * (o fiscal decide a providência e a notificação).
   */
  app.post('/contratos/:id/reservas-cargos', { preHandler: exigir('fiscalizacao:registrar') }, async (request, reply): Promise<VerificacaoReservasCargos> => {
    const entrada = esquemaReservas.parse(request.body);
    const sessao = sessaoDe(request);
    const contratoId = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      await exigirDesignado(tx, contrato.id, sessao.usuario.id, 'Só o gestor ou um fiscal designado no contrato registra a verificação das reservas de cargos.');
      const parametros = await carregarParametros(tx, contrato.id);
      const r = avaliarReservasCargos({
        empregados: entrada.empregados,
        percentualMulheres: parametros?.reservaMulheresPercentual ?? 0,
        reservaEgressos: parametros?.reservaEgressos ?? false,
        mulheres: entrada.mulheres,
        egressos: entrada.egressos,
        pcdComprovada: entrada.pcdComprovada,
        aprendizesComprovada: entrada.aprendizesComprovada,
      });
      const instante = ctx.relogio().toISOString();
      let ocorrenciaId: string | null = null;
      if (!r.atende) {
        const numero = await proximoNumero(tx, 'contratos_ocorrencias', contrato.id);
        const [ocorrencia] = await tx.consultar<{ id: string }>(
          `INSERT INTO contratos_ocorrencias (contrato_id, numero, tipo, data_fato, relato, registrada_por, registrada_em)
           VALUES ($1, $2, 'inconformidade', $3, $4, $5, $6) RETURNING id`,
          [contrato.id, numero, ctx.hoje(), `Reservas legais de cargos na competência ${entrada.competencia}: ${r.pendencias.join(' ')}`, sessao.usuario.id, instante],
        );
        ocorrenciaId = ocorrencia?.id ?? null;
        await registrarDesempenho(tx, contrato.fornecedor_id, { ocorrencias: 1 });
      }
      await tx.executar(
        `INSERT INTO contratos_reservas_cargos (contrato_id, competencia, empregados, mulheres, egressos, pcd_comprovada, aprendizes_comprovada, atende,
                                                resultado, observacao, ocorrencia_id, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
        [
          contrato.id,
          entrada.competencia,
          entrada.empregados,
          entrada.mulheres,
          entrada.egressos,
          entrada.pcdComprovada,
          entrada.aprendizesComprovada,
          r.atende,
          JSON.stringify({ itens: r.itens, pendencias: r.pendencias }),
          entrada.observacao,
          ocorrenciaId,
          sessao.usuario.id,
          instante,
        ],
      );
      await auditar(tx, request, {
        acao: 'contrato.reservas_cargos',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Verificou as reservas legais de cargos da competência ${entrada.competencia}: ${r.atende ? 'atendidas' : `${r.pendencias.length} pendência(s), registrada no livro`}`,
        dados: { competencia: entrada.competencia, empregados: entrada.empregados, atende: r.atende, pendencias: r.pendencias, ocorrenciaId, fundamento: r.fundamento },
      });
      return contrato.id;
    });
    const verificacao = (await carregarReservasCargos(ctx.banco, contratoId)).find((v) => v.competencia === entrada.competencia);
    if (!verificacao) throw naoEncontrado();
    reply.status(201);
    return verificacao;
  });

  // ───────── designações (art. 117) ─────────

  /** Servidores que podem ser designados no contrato: ativos, com a UASG no escopo e perfil de gestão ou fiscalização. */
  app.get('/contratos/:id/designaveis', { preHandler: exigir('fiscalizacao:designar') }, async (request): Promise<ServidorDesignavel[]> => {
    const contrato = await contratoDaRota(request);
    const linhas = await ctx.banco.consultar<{ id: string; nome: string; perfis: string[] }>(
      `SELECT u.id, u.nome, ARRAY(SELECT perfil FROM usuarios_perfis WHERE usuario_id = u.id ORDER BY perfil) AS perfis
         FROM usuarios u
        WHERE u.ativo AND (u.todas_uasgs OR EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = $1))
        ORDER BY u.nome`,
      [contrato.uasg],
    );
    return linhas
      .map((l) => ({ id: l.id, nome: l.nome, perfis: l.perfis.filter(ehCodigoPerfil) }))
      .filter((u) => permissoesDosPerfis(u.perfis).includes('recebimentos:registrar'));
  });

  app.post('/contratos/:id/designacoes', { preHandler: exigir('fiscalizacao:designar') }, async (request, reply): Promise<DesignacaoContrato> => {
    const entrada = esquemaDesignacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    if (entrada.inicio > hoje) throw regraNegocio('O início da designação não pode ser futuro: registre a designação quando o ato produzir efeitos.');
    const novoId = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const usuarioId = entrada.usuarioId.toLowerCase();
      const [usuario] = await tx.consultar<{ id: string; nome: string; ativo: boolean; todas_uasgs: boolean; perfis: string[]; uasgs: string[] }>(
        `SELECT u.id, u.nome, u.ativo, u.todas_uasgs,
                COALESCE(ARRAY(SELECT perfil FROM usuarios_perfis WHERE usuario_id = u.id), '{}') AS perfis,
                COALESCE(ARRAY(SELECT uasg FROM usuarios_uasgs WHERE usuario_id = u.id), '{}') AS uasgs
           FROM usuarios u WHERE u.id = $1`,
        [usuarioId],
      );
      if (!usuario) throw naoEncontrado('Servidor não encontrado.');
      if (!usuario.ativo) throw regraNegocio('O servidor está inativo na Ágora.');
      if (!usuario.todas_uasgs && !usuario.uasgs.includes(contrato.uasg)) {
        throw regraNegocio(`O servidor não tem a UASG ${contrato.uasg} no escopo de acesso: ajuste o escopo antes de designá-lo.`);
      }
      const permissoes = permissoesDosPerfis(usuario.perfis.filter(ehCodigoPerfil));
      if (!permissoes.includes('recebimentos:registrar')) {
        throw regraNegocio('O perfil do servidor não permite fiscalizar nem receber o objeto: designe gestor de contratos ou fiscal de contrato.');
      }
      await garantirDesignacoesIniciais(tx, contrato, ctx.relogio());
      const antes = designacoesAtivas(await carregarDesignacoes(tx, contrato.id), hoje);
      // O titular (ou substituto) anterior do mesmo papel é substituído; a comissão admite vários membros.
      const substituidos =
        entrada.papel === 'comissao_recebimento' ? [] : antes.filter((d) => d.papel === entrada.papel && d.substituto === entrada.substituto);
      const restantes = antes.filter((d) => !substituidos.includes(d));
      const verificacao = verificarDesignacoesContrato([
        ...restantes.map((d) => ({ papel: d.papel, usuarioId: d.usuario.id, nome: d.usuario.nome, substituto: d.substituto })),
        { papel: entrada.papel, usuarioId, nome: usuario.nome, substituto: entrada.substituto },
      ]);
      if (verificacao.conflitos.length > 0) {
        throw regraNegocio(
          'A designação viola a segregação de funções.',
          verificacao.conflitos.map((c) => ({ campo: 'usuarioId', mensagem: `${c.nome}: ${c.motivo} (${c.fundamento})` })),
        );
      }
      for (const anterior of substituidos) {
        const fim = adicionarDias(entrada.inicio, -1) < anterior.inicio ? anterior.inicio : adicionarDias(entrada.inicio, -1);
        await tx.executar('UPDATE contratos_designacoes SET fim = $2, motivo_encerramento = $3 WHERE id = $1', [
          anterior.id,
          fim,
          `Substituída pela designação de ${usuario.nome} (${entrada.ato}).`,
        ]);
      }
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO contratos_designacoes (contrato_id, papel, usuario_id, substituto, ato, inicio, designado_por, designado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [contrato.id, entrada.papel, usuarioId, entrada.substituto, entrada.ato, entrada.inicio, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Falha ao registrar a designação');
      await espelharDesignacoesNoContrato(tx, contrato.id, hoje);
      await auditar(tx, request, {
        acao: 'contrato.designar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Designou ${usuario.nome} como ${ROTULOS_PAPEL_FISCALIZACAO[entrada.papel].toLowerCase()}${entrada.substituto ? ' substituto' : ''} (${entrada.ato})`,
        dados: {
          designacaoId: criada.id,
          papel: entrada.papel,
          usuarioId,
          substituto: entrada.substituto,
          ato: entrada.ato,
          inicio: entrada.inicio,
          substituidas: substituidos.map((d) => d.id),
          faltantes: verificacao.faltantes,
          fundamento: 'Lei 14.133/2021, art. 117 e art. 7º',
        },
      });
      return criada.id;
    });
    const contrato = await contratoDaRota(request);
    const designacao = (await carregarDesignacoes(ctx.banco, contrato.id)).find((d) => d.id === novoId);
    if (!designacao) throw naoEncontrado();
    reply.status(201);
    return designacao;
  });

  app.post('/designacoes/:id/encerrar', { preHandler: exigir('fiscalizacao:designar') }, async (request): Promise<DesignacaoContrato> => {
    const id = idDaRota(request.params);
    const entrada = esquemaEncerrar.parse(request.body);
    const contratoId = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDoRegistro(tx, request, 'contratos_designacoes', id);
      const designacao = (await carregarDesignacoes(tx, contrato.id)).find((d) => d.id === id);
      if (!designacao) throw naoEncontrado();
      if (designacao.fim !== null) throw conflito('A designação já está encerrada.');
      if (entrada.fim < designacao.inicio) throw regraNegocio('O fim da designação não pode ser anterior ao início.');
      if (entrada.fim > ctx.hoje()) throw regraNegocio('O fim da designação não pode ser futuro.');
      await tx.executar('UPDATE contratos_designacoes SET fim = $2, motivo_encerramento = $3 WHERE id = $1', [id, entrada.fim, entrada.motivo]);
      await espelharDesignacoesNoContrato(tx, contrato.id, ctx.hoje());
      await auditar(tx, request, {
        acao: 'contrato.designacao_encerrar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Encerrou a designação de ${designacao.usuario.nome} como ${ROTULOS_PAPEL_FISCALIZACAO[designacao.papel].toLowerCase()}`,
        dados: { designacaoId: id, papel: designacao.papel, fim: entrada.fim, motivo: entrada.motivo },
      });
      return contrato.id;
    });
    const designacao = (await carregarDesignacoes(ctx.banco, contratoId)).find((d) => d.id === id);
    if (!designacao) throw naoEncontrado();
    return designacao;
  });

  // ───────── livro de ocorrências (art. 117, § 1º) ─────────

  app.post('/contratos/:id/ocorrencias', { preHandler: exigir('fiscalizacao:registrar') }, async (request, reply): Promise<OcorrenciaContrato> => {
    const entrada = esquemaOcorrencia.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const validacao = validarOcorrencia({ tipo: entrada.tipo, dataFato: entrada.dataFato, relato: entrada.relato, prazoRegularizacao: entrada.prazoRegularizacao, hoje });
    const notificar = entrada.notificarContratada || validacao.exigeNotificacao;
    let notificacaoId: string | null = null;
    const { contratoId, ocorrenciaId } = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      await exigirDesignado(tx, contrato.id, sessao.usuario.id, 'Só o gestor ou um fiscal designado no contrato registra ocorrências no livro (art. 117, § 1º).');
      const numero = await proximoNumero(tx, 'contratos_ocorrencias', contrato.id);
      if (notificar) {
        notificacaoId = await notificarContratada(tx, ctx, request, {
          contratoId: contrato.id,
          tipo: 'ocorrencia',
          detalhe: `Ocorrência nº ${numero} registrada no livro do contrato: ${entrada.relato}`,
          dataReferencia: entrada.prazoRegularizacao,
          complemento: entrada.providencia ? `Providência determinada pela fiscalização: ${entrada.providencia}` : null,
        });
      }
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO contratos_ocorrencias (contrato_id, numero, tipo, data_fato, relato, providencia, prazo_regularizacao, notificacao_id,
                                            registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [contrato.id, numero, entrada.tipo, entrada.dataFato, entrada.relato, entrada.providencia, entrada.prazoRegularizacao, notificacaoId, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Falha ao registrar a ocorrência');
      await registrarDesempenho(tx, contrato.fornecedor_id, { ocorrencias: 1 });
      await auditar(tx, request, {
        acao: 'contrato.ocorrencia',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a ocorrência nº ${numero} no livro do ${identificadorInstrumento('contrato', contrato.numero)}${notificacaoId ? ' e notificou a contratada' : ''}`,
        dados: {
          ocorrenciaId: criada.id,
          numero,
          tipo: entrada.tipo,
          dataFato: entrada.dataFato,
          prazoRegularizacao: entrada.prazoRegularizacao,
          notificacaoId,
          fundamento: validacao.fundamento,
        },
      });
      return { contratoId: contrato.id, ocorrenciaId: criada.id };
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    const [ocorrencia] = await carregarOcorrencias(ctx.banco, contratoId, ocorrenciaId);
    if (!ocorrencia) throw naoEncontrado();
    reply.status(201);
    return ocorrencia;
  });

  app.post('/ocorrencias/:id/regularizar', { preHandler: exigir('fiscalizacao:registrar') }, async (request): Promise<OcorrenciaContrato> => {
    const id = idDaRota(request.params);
    const entrada = esquemaRegularizar.parse(request.body);
    const sessao = sessaoDe(request);
    if (entrada.data > ctx.hoje()) throw regraNegocio('A data da regularização não pode ser futura.');
    const contratoId = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDoRegistro(tx, request, 'contratos_ocorrencias', id);
      await exigirDesignado(tx, contrato.id, sessao.usuario.id, 'Só o gestor ou um fiscal designado no contrato registra a regularização.');
      const [ocorrencia] = await carregarOcorrencias(tx, contrato.id, id);
      if (!ocorrencia) throw naoEncontrado();
      if (ocorrencia.situacao !== 'aberta') throw conflito('A ocorrência já foi regularizada.');
      await tx.executar(
        `UPDATE contratos_ocorrencias SET situacao = 'regularizada', regularizada_em = $2, observacao_regularizacao = $3, regularizada_por = $4 WHERE id = $1`,
        [id, entrada.data, entrada.observacao, sessao.usuario.id],
      );
      const noPrazo = ocorrencia.prazoRegularizacao === null || entrada.data <= ocorrencia.prazoRegularizacao;
      if (noPrazo) await registrarDesempenho(tx, contrato.fornecedor_id, { ocorrenciasNoPrazo: 1 });
      await auditar(tx, request, {
        acao: 'contrato.ocorrencia_regularizar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a regularização da ocorrência nº ${ocorrencia.numero}`,
        dados: { ocorrenciaId: id, data: entrada.data, noPrazo },
      });
      return contrato.id;
    });
    const [ocorrencia] = await carregarOcorrencias(ctx.banco, contratoId, id);
    if (!ocorrencia) throw naoEncontrado();
    return ocorrencia;
  });

  // ───────── entregas e termos de recebimento (art. 140; RN-34) ─────────

  app.post('/contratos/:id/recebimentos', { preHandler: exigir('recebimentos:registrar') }, async (request, reply): Promise<RecebimentoContrato> => {
    const entrada = esquemaRecebimento.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    if (entrada.entregueEm > hoje) throw regraNegocio('A data da entrega não pode ser futura.');
    const calendario = await opcoesCalendario(ctx.banco);
    const { contratoId, recebimentoId, garantiaObjetoMeses } = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      if (entrada.entregueEm < contrato.assinatura_em) throw regraNegocio('A entrega não pode ser anterior à assinatura do contrato.');
      const parametros = await carregarParametros(tx, contrato.id);
      if (!parametros) {
        throw regraNegocio('Defina antes os prazos de recebimento e de pagamento do contrato (art. 92, VI e VII, e art. 140, § 3º).');
      }
      await exigirDesignado(tx, contrato.id, sessao.usuario.id, 'Só o gestor ou um fiscal designado no contrato registra as entregas da contratada.');
      let notaFiscal: string | null = null;
      if (entrada.pagamentoId !== null) {
        const [pagamento] = await tx.consultar<{ situacao: string; nota_fiscal: string; ligado: boolean }>(
          `SELECT p.situacao, p.nota_fiscal, EXISTS (SELECT 1 FROM contratos_recebimentos r WHERE r.pagamento_id = p.id) AS ligado
             FROM pagamentos p WHERE p.id = $1 AND p.contrato_id = $2 FOR UPDATE OF p`,
          [entrada.pagamentoId.toLowerCase(), contrato.id],
        );
        if (!pagamento) throw regraNegocio('A nota fiscal informada não é deste contrato.');
        if (pagamento.situacao !== 'previsto') throw regraNegocio('Só nota fiscal ainda não atestada pode ser ligada a uma entrega.');
        if (pagamento.ligado) throw conflito('Esta nota fiscal já está ligada a outra entrega.');
        notaFiscal = pagamento.nota_fiscal;
      }
      const numero = await proximoNumero(tx, 'contratos_recebimentos', contrato.id);
      const prazo = prazoRecebimentoProvisorio(entrada.entregueEm, parametros, calendario);
      const [criado] = await tx.consultar<{ id: string }>(
        `INSERT INTO contratos_recebimentos (contrato_id, numero, descricao, valor, entregue_em, pagamento_id, situacao, prazo_atual,
                                             registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'aguardando_provisorio', $7, $8, $9) RETURNING id`,
        [contrato.id, numero, entrada.descricao, entrada.valor, entrada.entregueEm, entrada.pagamentoId?.toLowerCase() ?? null, prazo.limite, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criado) throw new Error('Falha ao registrar a entrega');
      await auditar(tx, request, {
        acao: 'recebimento.registrar_entrega',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a entrega nº ${numero} (${formatarMoeda(entrada.valor)})${notaFiscal ? `, ligada à nota fiscal ${notaFiscal}` : ''}`,
        dados: {
          recebimentoId: criado.id,
          numero,
          valor: entrada.valor,
          entregueEm: entrada.entregueEm,
          pagamentoId: entrada.pagamentoId,
          prazoProvisorio: prazo.limite,
          fundamento: prazo.fundamento,
        },
      });
      return { contratoId: contrato.id, recebimentoId: criado.id, garantiaObjetoMeses: parametros.garantiaObjetoMeses };
    });
    const [recebimento] = await carregarRecebimentos(ctx.banco, contratoId, hoje, garantiaObjetoMeses, recebimentoId);
    if (!recebimento) throw naoEncontrado();
    reply.status(201);
    return recebimento;
  });

  app.post('/recebimentos/:id/termos', { preHandler: exigir('recebimentos:registrar') }, async (request, reply): Promise<RespostaTermoRecebimento> => {
    const id = idDaRota(request.params);
    const entrada = esquemaTermo.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const hoje = ctx.hoje();
    const calendario = await opcoesCalendario(ctx.banco);

    // Validação completa antes de qualquer consulta externa (o recheque de regularidade consulta o CEIS/CNEP).
    const [previo] = await ctx.banco.consultar<{ contrato_id: string }>('SELECT contrato_id FROM contratos_recebimentos WHERE id = $1', [id]);
    if (!previo) throw naoEncontrado('Entrega não encontrada.');
    const contratoPrevio = await contratoExecucao(ctx.banco, previo.contrato_id, escopo);
    if (!contratoPrevio) throw naoEncontrado('Entrega não encontrada.');
    const parametros = await carregarParametros(ctx.banco, contratoPrevio.id);
    if (!parametros) throw regraNegocio('Defina antes os prazos de recebimento do contrato (art. 140, § 3º).');
    const papeis = await papeisDoUsuario(ctx.banco, contratoPrevio.id, sessao.usuario.id, hoje);

    const avaliar = async (executor: Executor, bloquear: boolean) => {
      const [r] = await executor.consultar<{
        situacao: RecebimentoContrato['situacao'];
        etapa_correcao: 'provisorio' | 'definitivo' | null;
        entregue_em: string;
        prazo_atual: string | null;
        provisorio_aceito_por: string | null;
        pagamento_id: string | null;
        pagamento_situacao: string | null;
        pagamento_competencia: string | null;
      }>(
        `SELECT r.situacao, r.etapa_correcao, r.entregue_em, r.prazo_atual, r.provisorio_aceito_por, r.pagamento_id, p.situacao AS pagamento_situacao, p.competencia AS pagamento_competencia
           FROM contratos_recebimentos r LEFT JOIN pagamentos p ON p.id = r.pagamento_id
          WHERE r.id = $1 ${bloquear ? 'FOR UPDATE OF r' : ''}`,
        [id],
      );
      if (!r) throw naoEncontrado('Entrega não encontrada.');
      const resultado = avaliarTermoRecebimento({
        situacao: r.situacao,
        etapaCorrecao: r.etapa_correcao,
        tipo: entrada.tipo,
        resultado: entrada.resultado,
        data: entrada.data,
        hoje,
        entregueEm: r.entregue_em,
        observacoes: entrada.observacoes ?? '',
        responsavel: { usuarioId: sessao.usuario.id, papeis },
        responsavelProvisorioId: r.provisorio_aceito_por,
        limiteTermo: r.prazo_atual,
        parametros,
        opcoes: calendario,
      });
      return { r, resultado };
    };
    if (papeis.length === 0) {
      throw regraNegocio('Só servidores designados no contrato lavram termos de recebimento (art. 140): peça a designação ao gestor.');
    }
    const previa = await avaliar(ctx.banco, false);
    let atestar = previa.resultado.liberaLiquidacao && previa.r.pagamento_id !== null && previa.r.pagamento_situacao === 'previsto';
    // RN-36 (frente M): sem a conferência da nota liberada, o definitivo é registrado e a nota fica para atesto depois.
    const avisosAtesto: string[] = [];
    if (atestar && previa.r.pagamento_id && previa.r.pagamento_competencia) {
      const conferencia = await situacaoAtestoConferencia(ctx.banco, { id: previa.r.pagamento_id, contrato_id: contratoPrevio.id, competencia: previa.r.pagamento_competencia });
      if (!conferencia.liberado) {
        atestar = false;
        avisosAtesto.push(`${conferencia.motivo ?? 'A conferência da nota fiscal não libera o atesto (RN-36).'} Depois da conferência, atesta-se a nota na tela Pagamentos.`);
      }
    }
    let verificacao: VerificacaoRegularidade | null = null;
    if (atestar && previa.r.pagamento_id) {
      const [outras] = await ctx.banco.consultar<{ total: number }>(
        `SELECT COUNT(*)::integer AS total FROM contratos_recebimentos WHERE pagamento_id = $1 AND id <> $2 AND situacao <> 'recebido'`,
        [previa.r.pagamento_id, id],
      );
      if ((outras?.total ?? 0) === 0) {
        verificacao = await verificarRegularidade(ctx, request, {
          fornecedorId: contratoPrevio.fornecedor_id,
          momento: 'atesto',
          instrumento: { tipo: 'pagamento', id: previa.r.pagamento_id },
          contratoId: contratoPrevio.id,
        });
      }
    }

    let notificacaoId: string | null = null;
    const resposta = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoExecucao(tx, contratoPrevio.id, escopo, true);
      if (!contrato) throw naoEncontrado('Entrega não encontrada.');
      const { r, resultado } = await avaliar(tx, true);
      const preferencia = entrada.tipo === 'provisorio' ? PAPEL_PROVISORIO : PAPEL_DEFINITIVO;
      const papelResponsavel = preferencia.find((p) => papeis.includes(p));
      if (!papelResponsavel) throw regraNegocio('Seu papel no contrato não permite lavrar este termo.');
      const [recebimentoLinha] = await tx.consultar<{ numero: number; descricao: string; valor: number; entregue_em: string; nota_fiscal: string | null }>(
        `SELECT r.numero, r.descricao, r.valor, r.entregue_em, p.nota_fiscal
           FROM contratos_recebimentos r LEFT JOIN pagamentos p ON p.id = r.pagamento_id WHERE r.id = $1`,
        [id],
      );
      if (!recebimentoLinha) throw naoEncontrado('Entrega não encontrada.');
      const dadosRecebimento = {
        numero: recebimentoLinha.numero,
        descricao: recebimentoLinha.descricao,
        valor: recebimentoLinha.valor,
        entregueEm: recebimentoLinha.entregue_em,
        notaFiscal: recebimentoLinha.nota_fiscal,
      };
      const pdf = gerarTermoPdf({
        orgao: ctx.config.orgao,
        contrato,
        recebimento: dadosRecebimento,
        termo: {
          tipo: entrada.tipo,
          resultado: entrada.resultado,
          data: entrada.data,
          observacoes: entrada.observacoes,
          prazoCorrecao: resultado.prazoCorrecao,
          responsavel: { id: sessao.usuario.id, nome: sessao.usuario.nome },
          papelResponsavel,
          foraDoPrazo: resultado.foraDoPrazo,
        },
      });
      const instante = ctx.relogio().toISOString();
      const [termo] = await tx.consultar<{ id: string }>(
        `INSERT INTO recebimentos_termos (recebimento_id, tipo, resultado, data, observacoes, prazo_correcao, responsavel_id, papel_responsavel,
                                          fora_do_prazo, hash_pdf, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [id, entrada.tipo, entrada.resultado, entrada.data, entrada.observacoes, resultado.prazoCorrecao, sessao.usuario.id, papelResponsavel, resultado.foraDoPrazo, pdf.hash, instante],
      );
      if (!termo) throw new Error('Falha ao registrar o termo');
      const provisorioAceito = entrada.tipo === 'provisorio' && entrada.resultado === 'aceito';
      await tx.executar(
        `UPDATE contratos_recebimentos
            SET situacao = $2, etapa_correcao = $3, prazo_atual = $4, prazo_correcao = $5,
                provisorio_aceito_por = CASE WHEN $6::boolean THEN $7::uuid ELSE provisorio_aceito_por END,
                definitivo_em = $8
          WHERE id = $1`,
        [id, resultado.novaSituacao, resultado.etapaCorrecao, resultado.proximoPrazo, resultado.prazoCorrecao, provisorioAceito, sessao.usuario.id, resultado.liberaLiquidacao ? entrada.data : null],
      );

      // Ressalva ou rejeição: ocorrência no livro do contrato e notificação à contratada com o prazo de correção.
      if (entrada.resultado !== 'aceito') {
        const numero = await proximoNumero(tx, 'contratos_ocorrencias', contrato.id);
        const relato = `${tituloTermo(entrada.tipo)} da entrega nº ${dadosRecebimento.numero} ${entrada.resultado === 'rejeitado' ? 'rejeitou o objeto' : 'registrou ressalva'}: ${entrada.observacoes ?? ''}`;
        notificacaoId = await notificarContratada(tx, ctx, request, {
          contratoId: contrato.id,
          tipo: 'ocorrencia',
          detalhe: relato,
          dataReferencia: resultado.prazoCorrecao,
          complemento:
            entrada.resultado === 'rejeitado'
              ? 'Substitua o objeto rejeitado, às suas custas, até o prazo indicado (Lei 14.133/2021, art. 140, § 1º, e art. 119).'
              : 'Corrija os pontos apontados, às suas custas, até o prazo indicado (Lei 14.133/2021, art. 119).',
        });
        await tx.executar(
          `INSERT INTO contratos_ocorrencias (contrato_id, numero, tipo, data_fato, relato, prazo_regularizacao, recebimento_id, notificacao_id,
                                              registrada_por, registrada_em)
           VALUES ($1, $2, 'inconformidade', $3, $4, $5, $6, $7, $8, $9)`,
          [contrato.id, numero, entrada.data, relato, resultado.prazoCorrecao, id, notificacaoId, sessao.usuario.id, instante],
        );
        await registrarDesempenho(tx, contrato.fornecedor_id, { ocorrencias: 1 });
      }
      if (resultado.liberaLiquidacao) {
        const [ressalvas] = await tx.consultar<{ total: number }>(
          `SELECT COUNT(*)::integer AS total FROM recebimentos_termos WHERE recebimento_id = $1 AND resultado <> 'aceito'`,
          [id],
        );
        await registrarDesempenho(tx, contrato.fornecedor_id, { recebimentos: 1, recebimentosAprovados: (ressalvas?.total ?? 0) === 0 ? 1 : 0 });
      }

      let atesto: RespostaTermoRecebimento['atesto'] = null;
      if (atestar && verificacao && r.pagamento_id && r.pagamento_situacao === 'previsto') {
        const feito = await registrarAtesto(tx, ctx, request, { pagamentoId: r.pagamento_id, escopo, verificacao, usuarioId: sessao.usuario.id, recebimentoId: id });
        atesto = { pagamentoId: r.pagamento_id, notaFiscal: feito.notaFiscal, regular: verificacao.regular, pendenciaAberta: feito.pendenciaId !== null };
      }
      const limitePagamento =
        resultado.liberaLiquidacao && parametros.marcoPagamento === 'recebimento_definitivo'
          ? calcularPrazoPagamento({ parametros, recebimentoDefinitivoEm: entrada.data, liquidadoEm: null, pagoEm: null, hoje, opcoes: calendario }).limitePagamento
          : null;
      await auditar(tx, request, {
        acao: 'recebimento.termo',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Lavrou o ${tituloTermo(entrada.tipo).toLowerCase()} da entrega nº ${dadosRecebimento.numero}: ${
          entrada.resultado === 'aceito' ? 'objeto recebido' : entrada.resultado === 'com_ressalva' ? 'com ressalva' : 'objeto rejeitado'
        }`,
        dados: {
          recebimentoId: id,
          termoId: termo.id,
          tipo: entrada.tipo,
          resultado: entrada.resultado,
          data: entrada.data,
          papel: papelResponsavel,
          situacao: { de: r.situacao, para: resultado.novaSituacao },
          prazoCorrecao: resultado.prazoCorrecao,
          proximoPrazo: resultado.proximoPrazo,
          foraDoPrazo: resultado.foraDoPrazo,
          hashPdf: pdf.hash,
          atestoPagamentoId: atesto?.pagamentoId ?? null,
          limitePagamento,
          notificacaoId,
          fundamento: resultado.fundamento,
        },
      });
      return { termoId: termo.id, avisos: [...resultado.avisos, ...avisosAtesto], atesto, limitePagamento, contratoId: contrato.id };
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    const [recebimento] = await carregarRecebimentos(ctx.banco, resposta.contratoId, hoje, parametros.garantiaObjetoMeses, id);
    const termo = recebimento?.termos.find((t) => t.id === resposta.termoId);
    if (!recebimento || !termo) throw naoEncontrado();
    reply.status(201);
    return { recebimento, termo, avisos: resposta.avisos, atesto: resposta.atesto, limitePagamento: resposta.limitePagamento, notificacaoId };
  });

  /** PDF do termo, gerado de novo a partir do registro (o hash confere com o gravado no ato). */
  app.get('/recebimentos/termos/:id/termo.pdf', { preHandler: exigir('contratos:ler') }, async (request, reply) => {
    const id = idDaRota(request.params);
    const dados = await termoParaPdf(ctx.banco, id, escopoUasgs(sessaoDe(request)));
    if (!dados) throw naoEncontrado('Termo não encontrado.');
    const { termo } = dados;
    const pdf = gerarTermoPdf({
      orgao: ctx.config.orgao,
      contrato: dados.contrato,
      recebimento: dados.recebimento,
      termo: {
        tipo: termo.tipo,
        resultado: termo.resultado,
        data: termo.data,
        observacoes: termo.observacoes,
        prazoCorrecao: termo.prazoCorrecao,
        responsavel: termo.responsavel,
        papelResponsavel: termo.papelResponsavel,
        foraDoPrazo: termo.foraDoPrazo,
      },
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${pdf.nomeArquivo}"`)
      .header('x-agora-hash-registrado', termo.hashPdf)
      .header('cache-control', 'no-store')
      .send(pdf.pdf);
  });

  // ───────── garantias (arts. 96 a 102; RN-35) ─────────

  async function respostaGarantia(contrato: ContratoExecucao, garantiaId: string, avisos: string[], notificacaoId: string | null): Promise<RespostaGarantia> {
    const [garantia] = await carregarGarantias(ctx.banco, contrato.id, contrato.vigencia_fim, ctx.hoje(), garantiaId);
    if (!garantia) throw naoEncontrado();
    return { garantia, avisos, notificacaoId };
  }

  async function movimento(tx: Transacao, garantiaId: string, tipo: string, data: string, valor: number | null, descricao: string, usuarioId: string): Promise<void> {
    await tx.executar(
      `INSERT INTO garantias_movimentos (garantia_id, tipo, data, valor, descricao, registrado_por, registrado_em) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [garantiaId, tipo, data, valor, descricao, usuarioId, ctx.relogio().toISOString()],
    );
  }

  interface LinhaGarantiaEscrita {
    id: string;
    contrato_id: string;
    finalidade: 'execucao' | 'antecipacao';
    situacao: 'aguardando_apresentacao' | 'vigente' | 'liberada' | 'executada';
    valor_exigido: number;
    modalidade_exigida: (typeof MODALIDADES)[number] | null;
    modalidade: (typeof MODALIDADES)[number] | null;
    prazo_apresentacao: string | null;
    valor: number | null;
    saldo: number;
    valida_ate: string | null;
    apresentada_em: string | null;
    clausula_retomada: boolean;
    pendencia_id: string | null;
  }

  async function garantiaParaEscrita(tx: Transacao, request: FastifyRequest): Promise<{ contrato: ContratoExecucao; g: LinhaGarantiaEscrita }> {
    const id = idDaRota(request.params);
    const contrato = await contratoDoRegistro(tx, request, 'contratos_garantias', id);
    const [g] = await tx.consultar<LinhaGarantiaEscrita>(
      `SELECT id, contrato_id, finalidade, situacao, valor_exigido, modalidade_exigida, modalidade, prazo_apresentacao, valor, saldo, valida_ate,
              apresentada_em, clausula_retomada, pendencia_id
         FROM contratos_garantias WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!g) throw naoEncontrado('Garantia não encontrada.');
    return { contrato, g };
  }

  app.post('/contratos/:id/garantias', { preHandler: exigir('garantias:registrar') }, async (request, reply): Promise<RespostaGarantia> => {
    const entrada = esquemaExigencia.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    let notificacaoId: string | null = null;
    const { contrato, garantiaId } = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      if (entrada.finalidade === 'execucao') {
        const [ativa] = await tx.consultar<{ id: string }>(
          `SELECT id FROM contratos_garantias WHERE contrato_id = $1 AND finalidade = 'execucao' AND situacao IN ('aguardando_apresentacao', 'vigente')`,
          [contrato.id],
        );
        if (ativa) throw conflito('O contrato já tem garantia de execução exigida ou vigente: registre a renovação ou a complementação.');
      } else if (!entrada.valorBase) {
        throw regraNegocio('Informe o valor do pagamento antecipado, base da garantia adicional (art. 145, § 2º).');
      }
      const continuo = Date.parse(contrato.vigencia_fim) - Date.parse(contrato.vigencia_inicio) > 366 * 86_400_000;
      const base =
        entrada.finalidade === 'execucao'
          ? baseCalculoGarantia({ valorInicial: contrato.valor_inicial, vigenciaInicio: contrato.vigencia_inicio, vigenciaFim: contrato.vigencia_fim, continuo })
          : { valorBase: entrada.valorBase ?? 0, anual: false, fundamento: 'Lei 14.133/2021, art. 145, § 2º (valor antecipado)' };
      const avaliacao = avaliarPercentualGarantia({
        finalidade: entrada.finalidade,
        valorBase: base.valorBase,
        percentual: entrada.percentual,
        justificativa: entrada.justificativa,
        grandeVultoEngenharia: entrada.grandeVultoEngenharia,
        clausulaRetomada: entrada.clausulaRetomada,
        modalidadeExigida: entrada.modalidadeExigida,
      });
      if (!avaliacao.permitido) {
        throw regraNegocio('O percentual da garantia não atende à lei.', avaliacao.motivos.map((m) => ({ campo: 'percentual', mensagem: m })));
      }
      const instante = ctx.relogio().toISOString();
      const motivo = `Apresentação da garantia ${entrada.finalidade === 'execucao' ? 'de execução' : 'adicional da antecipação'} de ${formatarMoeda(avaliacao.valorExigido)} até ${formatarData(entrada.prazoApresentacao)} (art. 96).`;
      const [pendencia] = await tx.consultar<{ id: string }>(
        `INSERT INTO pendencias (tipo, prioridade, instrumento_tipo, instrumento_id, uasg, motivo, prazo, responsavel_id, busca_normalizada)
         VALUES ('garantia', 'alta', 'contrato', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [contrato.id, contrato.uasg, motivo, entrada.prazoApresentacao, contrato.gestor_id, normalizarBusca(motivo, contrato.objeto, identificadorInstrumento('contrato', contrato.numero))],
      );
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO contratos_garantias (contrato_id, finalidade, percentual, valor_base, base_anual, valor_exigido, justificativa_percentual,
                                          grande_vulto_engenharia, clausula_retomada, modalidade_exigida, prazo_apresentacao, situacao,
                                          pendencia_id, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'aguardando_apresentacao', $12, $13, $14) RETURNING id`,
        [
          contrato.id,
          entrada.finalidade,
          entrada.percentual,
          base.valorBase,
          base.anual,
          avaliacao.valorExigido,
          entrada.justificativa,
          entrada.grandeVultoEngenharia,
          entrada.clausulaRetomada,
          entrada.modalidadeExigida,
          entrada.prazoApresentacao,
          pendencia?.id ?? null,
          sessao.usuario.id,
          instante,
        ],
      );
      if (!criada) throw new Error('Falha ao registrar a garantia');
      await movimento(tx, criada.id, 'exigencia', hoje, avaliacao.valorExigido, `Exigida em ${entrada.percentual}% (${avaliacao.fundamento}); ${base.fundamento}.`, sessao.usuario.id);
      notificacaoId = await notificarContratada(tx, ctx, request, {
        contratoId: contrato.id,
        tipo: 'pendencia',
        detalhe: `${motivo} Modalidades à escolha da contratada: caução em dinheiro ou em títulos da dívida pública, seguro-garantia, fiança bancária ou título de capitalização (art. 96, § 1º)${entrada.modalidadeExigida === 'seguro_garantia' ? '; nesta contratação, seguro-garantia com cláusula de retomada (art. 99)' : ''}.`,
        dataReferencia: entrada.prazoApresentacao,
      });
      await auditar(tx, request, {
        acao: 'garantia.exigir',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Exigiu garantia ${entrada.finalidade === 'execucao' ? 'de execução' : 'adicional da antecipação'} de ${formatarMoeda(avaliacao.valorExigido)} (${entrada.percentual}%)`,
        dados: {
          garantiaId: criada.id,
          finalidade: entrada.finalidade,
          percentual: entrada.percentual,
          valorBase: base.valorBase,
          baseAnual: base.anual,
          valorExigido: avaliacao.valorExigido,
          prazoApresentacao: entrada.prazoApresentacao,
          pendenciaId: pendencia?.id ?? null,
          notificacaoId,
          fundamento: avaliacao.fundamento,
        },
      });
      return { contrato, garantiaId: criada.id };
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    reply.status(201);
    return respostaGarantia(contrato, garantiaId, [], notificacaoId);
  });

  app.post('/garantias/:id/apresentacao', { preHandler: exigir('garantias:registrar') }, async (request): Promise<RespostaGarantia> => {
    const entrada = esquemaApresentacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    let avisoId: string | null = null;
    const { contrato, garantiaId, avisos } = await ctx.banco.transacao(async (tx) => {
      const { contrato, g } = await garantiaParaEscrita(tx, request);
      if (g.situacao !== 'aguardando_apresentacao') throw conflito('A garantia já foi apresentada: registre a renovação ou a complementação.');
      if (g.modalidade_exigida !== null && entrada.modalidade !== g.modalidade_exigida) {
        throw regraNegocio(`Nesta contratação a garantia exigida é ${ROTULOS_MODALIDADE_GARANTIA[g.modalidade_exigida].toLowerCase()} (art. 99).`);
      }
      const validacao = validarApresentacaoGarantia({
        modalidade: entrada.modalidade,
        valor: entrada.valor,
        valorExigido: g.valor_exigido,
        apresentadaEm: entrada.apresentadaEm,
        prazoApresentacao: g.prazo_apresentacao,
        validaAte: entrada.validaAte,
        vigenciaFimContrato: contrato.vigencia_fim,
        emissor: entrada.emissor,
        documento: entrada.documento,
        hoje,
      });
      await tx.executar(
        `UPDATE contratos_garantias SET modalidade = $2, valor = $3, saldo = $3, emissor = $4, documento = $5, apresentada_em = $6, valida_ate = $7,
                situacao = 'vigente' WHERE id = $1`,
        [g.id, entrada.modalidade, entrada.valor, entrada.emissor, entrada.documento, entrada.apresentadaEm, entrada.validaAte],
      );
      if (g.pendencia_id) {
        await tx.executar(
          `UPDATE pendencias SET situacao = 'resolvida', resolvida_em = $2, resolvida_por = $3, observacao_resolucao = $4 WHERE id = $1 AND situacao = 'aberta'`,
          [g.pendencia_id, ctx.relogio().toISOString(), sessao.usuario.id, `Garantia apresentada em ${formatarData(entrada.apresentadaEm)}.`],
        );
      }
      await movimento(
        tx,
        g.id,
        'apresentacao',
        entrada.apresentadaEm,
        entrada.valor,
        `${ROTULOS_MODALIDADE_GARANTIA[entrada.modalidade]}${entrada.emissor ? ` — ${entrada.emissor}` : ''}${entrada.documento ? `, ${entrada.documento}` : ''}, válida até ${formatarData(entrada.validaAte)}.`,
        sessao.usuario.id,
      );
      if (g.finalidade === 'execucao') {
        await espelharGarantiaNoContrato(tx, contrato.id);
        avisoId = await avisarVencimentoGarantia(tx, ctx, request, contrato.id, entrada.validaAte);
      }
      await auditar(tx, request, {
        acao: 'garantia.apresentar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a apresentação da garantia: ${ROTULOS_MODALIDADE_GARANTIA[entrada.modalidade].toLowerCase()} de ${formatarMoeda(entrada.valor)}, válida até ${formatarData(entrada.validaAte)}`,
        dados: { garantiaId: g.id, modalidade: entrada.modalidade, valor: entrada.valor, validaAte: entrada.validaAte, avisos: validacao.avisos, avisoVencimentoId: avisoId },
      });
      return { contrato, garantiaId: g.id, avisos: validacao.avisos };
    });
    if (avisoId) await processarFila(ctx, { notificacaoId: avisoId });
    return respostaGarantia(contrato, garantiaId, avisos, avisoId);
  });

  app.post('/garantias/:id/renovacao', { preHandler: exigir('garantias:registrar') }, async (request): Promise<RespostaGarantia> => {
    const entrada = esquemaRenovacao.parse(request.body);
    const sessao = sessaoDe(request);
    if (entrada.data > ctx.hoje()) throw regraNegocio('A data da renovação não pode ser futura.');
    let avisoId: string | null = null;
    const { contrato, garantiaId, avisos } = await ctx.banco.transacao(async (tx) => {
      const { contrato, g } = await garantiaParaEscrita(tx, request);
      if (g.situacao !== 'vigente' || !g.valida_ate) throw conflito('Só a garantia apresentada e vigente pode ser renovada.');
      if (entrada.validaAte <= g.valida_ate) throw regraNegocio(`A nova validade deve ser posterior a ${formatarData(g.valida_ate)}.`);
      const avisos: string[] = [];
      if (entrada.validaAte < contrato.vigencia_fim) avisos.push('A nova validade ainda termina antes do fim da vigência do contrato.');
      const complemento = entrada.valor ?? 0;
      await tx.executar(
        `UPDATE contratos_garantias SET valida_ate = $2, documento = COALESCE($3, documento), valor = valor + $4, saldo = saldo + $4 WHERE id = $1`,
        [g.id, entrada.validaAte, entrada.documento, complemento],
      );
      await movimento(
        tx,
        g.id,
        'renovacao',
        entrada.data,
        complemento > 0 ? complemento : null,
        `Validade prorrogada para ${formatarData(entrada.validaAte)}${entrada.documento ? ` (${entrada.documento})` : ''}${complemento > 0 ? `; complementação de ${formatarMoeda(complemento)}` : ''}.`,
        sessao.usuario.id,
      );
      if (g.finalidade === 'execucao') {
        await espelharGarantiaNoContrato(tx, contrato.id);
        avisoId = await avisarVencimentoGarantia(tx, ctx, request, contrato.id, entrada.validaAte);
      }
      await auditar(tx, request, {
        acao: 'garantia.renovar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a renovação da garantia até ${formatarData(entrada.validaAte)}${complemento > 0 ? ` com complementação de ${formatarMoeda(complemento)}` : ''}`,
        dados: { garantiaId: g.id, validadeAnterior: g.valida_ate, validaAte: entrada.validaAte, complemento, fundamento: 'Lei 14.133/2021, arts. 96 e 97' },
      });
      return { contrato, garantiaId: g.id, avisos };
    });
    if (avisoId) await processarFila(ctx, { notificacaoId: avisoId });
    return respostaGarantia(contrato, garantiaId, avisos, avisoId);
  });

  app.post('/garantias/:id/liberacao', { preHandler: exigir('garantias:registrar') }, async (request): Promise<RespostaGarantia> => {
    const entrada = esquemaLiberacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    if (entrada.data > hoje) throw regraNegocio('A data da liberação não pode ser futura.');
    const variacoes = await variacoesIpca(ctx.banco);
    const { contrato, garantiaId } = await ctx.banco.transacao(async (tx) => {
      const { contrato, g } = await garantiaParaEscrita(tx, request);
      const [contagens] = await tx.consultar<{ pendentes: number; abertas: number }>(
        `SELECT (SELECT COUNT(*) FROM contratos_recebimentos WHERE contrato_id = $1 AND situacao <> 'recebido')::integer AS pendentes,
                (SELECT COUNT(*) FROM contratos_ocorrencias WHERE contrato_id = $1 AND situacao = 'aberta')::integer AS abertas`,
        [contrato.id],
      );
      const multas = await carregarMultas(tx, contrato.id);
      const avaliacao = avaliarLiberacaoGarantia({
        situacaoRegistro: g.situacao,
        vigenciaEncerrada: contrato.vigencia_fim < hoje,
        recebimentosPendentes: contagens?.pendentes ?? 0,
        ocorrenciasAbertas: contagens?.abertas ?? 0,
        saldoMultasPendentes: multas.reduce((t, m) => t + m.saldo, 0),
        extincaoCulpaAdministracao: entrada.extincaoCulpaAdministracao,
      });
      if (!avaliacao.permitido) throw regraNegocio('A garantia ainda não pode ser liberada (art. 100).', avaliacao.motivos.map((m) => ({ campo: 'garantia', mensagem: m })));
      const restituicao =
        g.modalidade === 'caucao_dinheiro' && g.apresentada_em
          ? atualizarCaucaoDinheiro({ saldo: g.saldo, depositadaEm: g.apresentada_em, restituidaEm: entrada.data, variacoes })
          : null;
      await tx.executar(`UPDATE contratos_garantias SET situacao = 'liberada', liberada_em = $2, valor_restituido = $3 WHERE id = $1`, [
        g.id,
        entrada.data,
        restituicao?.valorRestituido ?? null,
      ]);
      await movimento(
        tx,
        g.id,
        'liberacao',
        entrada.data,
        restituicao?.valorRestituido ?? g.saldo,
        restituicao
          ? `Caução restituída com atualização monetária de ${restituicao.percentual}% (art. 100): ${formatarMoeda(restituicao.valorRestituido)}. ${entrada.observacao}`
          : `Garantia liberada (art. 100). ${entrada.observacao}`,
        sessao.usuario.id,
      );
      if (g.finalidade === 'execucao') await espelharGarantiaNoContrato(tx, contrato.id);
      await auditar(tx, request, {
        acao: 'garantia.liberar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Liberou a garantia${restituicao ? ` com restituição atualizada de ${formatarMoeda(restituicao.valorRestituido)}` : ''}`,
        dados: {
          garantiaId: g.id,
          data: entrada.data,
          extincaoCulpaAdministracao: entrada.extincaoCulpaAdministracao,
          saldo: g.saldo,
          valorRestituido: restituicao?.valorRestituido ?? null,
          competenciasSemIndice: restituicao?.competenciasSemIndice ?? [],
          fundamento: avaliacao.fundamento,
        },
      });
      return { contrato, garantiaId: g.id };
    });
    return respostaGarantia(contrato, garantiaId, [], null);
  });

  app.post('/garantias/:id/execucao', { preHandler: exigir('garantias:executar') }, async (request): Promise<RespostaGarantia> => {
    const entrada = esquemaExecucao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    validarDecisaoAutoridade({ autoridade: entrada.autoridade, ato: entrada.ato, justificativa: entrada.justificativa, decididaEm: entrada.decididaEm, hoje });
    let notificacaoId: string | null = null;
    const { contrato, garantiaId } = await ctx.banco.transacao(async (tx) => {
      const { contrato, g } = await garantiaParaEscrita(tx, request);
      const r = avaliarExecucaoGarantia({
        situacaoRegistro: g.situacao,
        modalidade: g.modalidade,
        clausulaRetomada: g.clausula_retomada,
        saldo: g.saldo,
        valor: entrada.valor,
        motivo: entrada.motivo,
      });
      await tx.executar(`UPDATE contratos_garantias SET saldo = $2::bigint, situacao = CASE WHEN $2::bigint = 0 THEN 'executada' ELSE situacao END WHERE id = $1`, [g.id, r.saldoFinal]);
      await movimento(tx, g.id, 'execucao', entrada.decididaEm, entrada.valor, `Execução por decisão de ${entrada.autoridade} (${entrada.ato}) — ${r.fundamento}.`, sessao.usuario.id);
      if (g.finalidade === 'execucao') await espelharGarantiaNoContrato(tx, contrato.id);
      if (r.saldoFinal > 0 || g.finalidade === 'execucao') {
        notificacaoId = await notificarContratada(tx, ctx, request, {
          contratoId: contrato.id,
          tipo: 'pendencia',
          detalhe: `Recompor a garantia contratual: ${formatarMoeda(entrada.valor)} executados por decisão da autoridade competente (${entrada.ato}). Saldo atual: ${formatarMoeda(r.saldoFinal)}.`,
          dataReferencia: null,
        });
      }
      await auditar(tx, request, {
        acao: 'garantia.executar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou a execução de ${formatarMoeda(entrada.valor)} da garantia por decisão da autoridade competente`,
        dados: { garantiaId: g.id, motivo: entrada.motivo, valor: entrada.valor, saldoFinal: r.saldoFinal, autoridade: entrada.autoridade, ato: entrada.ato, decididaEm: entrada.decididaEm, notificacaoId, fundamento: r.fundamento },
      });
      return { contrato, garantiaId: g.id };
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    return respostaGarantia(contrato, garantiaId, [], notificacaoId);
  });

  // ───────── desconto de multa (art. 156, § 8º) ─────────

  app.post('/sancoes/:id/descontos', { preHandler: exigir('garantias:executar') }, async (request, reply): Promise<RespostaDescontoMulta> => {
    const id = idDaRota(request.params);
    const entrada = esquemaDesconto.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    validarDecisaoAutoridade({ autoridade: entrada.autoridade, ato: entrada.ato, justificativa: entrada.justificativa, decididaEm: entrada.decididaEm, hoje });
    let notificacaoId: string | null = null;
    const resultado = await ctx.banco.transacao(async (tx) => {
      const [sancao] = await tx.consultar<{ contrato_id: string | null; tipo: string; situacao: string }>(
        'SELECT contrato_id, tipo, situacao FROM sancoes WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!sancao || !sancao.contrato_id) throw naoEncontrado('Sanção não encontrada.');
      const contrato = await contratoExecucao(tx, sancao.contrato_id, escopoUasgs(sessao), true);
      if (!contrato) throw naoEncontrado('Sanção não encontrada.');
      if (sancao.tipo !== 'multa' || sancao.situacao !== 'aplicada') throw regraNegocio('Só multa aplicada por decisão definitiva pode ser descontada (art. 156, § 8º).');
      const multa = (await carregarMultas(tx, contrato.id)).find((m) => m.sancaoId === id);
      if (!multa) throw regraNegocio('A multa não tem valor registrado.');
      const devidos = await pagamentosDevidos(tx, contrato.id);
      const [garantia] = await tx.consultar<{ id: string; saldo: number }>(
        `SELECT id, saldo FROM contratos_garantias
          WHERE contrato_id = $1 AND finalidade = 'execucao' AND situacao = 'vigente' AND saldo > 0
          ORDER BY apresentada_em DESC NULLS LAST LIMIT 1 FOR UPDATE`,
        [contrato.id],
      );
      const plano = planejarDescontoMulta({
        saldoMulta: multa.saldo,
        pagamentosDevidos: devidos.map((d) => ({ id: d.pagamentoId, disponivel: d.disponivel })),
        saldoGarantia: garantia?.saldo ?? 0,
        valorDecidido: entrada.valor,
      });
      if (plano.pagamentos.length === 0 && plano.garantia === 0) {
        throw regraNegocio(
          `Não há pagamento devido à contratada nem saldo de garantia: ${formatarMoeda(plano.remanescente)} seguem para cobrança judicial (art. 156, § 8º).`,
        );
      }
      const instante = ctx.relogio().toISOString();
      const ids: string[] = [];
      const notas = new Map(devidos.map((d) => [d.pagamentoId, d.notaFiscal]));
      for (const p of plano.pagamentos) {
        const [d] = await tx.consultar<{ id: string }>(
          `INSERT INTO multas_descontos (sancao_id, contrato_id, origem, pagamento_id, valor, autoridade, ato, decidida_em, justificativa, registrado_por, registrado_em)
           VALUES ($1, $2, 'pagamento', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [id, contrato.id, p.id, p.valor, entrada.autoridade, entrada.ato, entrada.decididaEm, entrada.justificativa, sessao.usuario.id, instante],
        );
        if (d) ids.push(d.id);
      }
      if (plano.garantia > 0 && garantia) {
        const [d] = await tx.consultar<{ id: string }>(
          `INSERT INTO multas_descontos (sancao_id, contrato_id, origem, garantia_id, valor, autoridade, ato, decidida_em, justificativa, registrado_por, registrado_em)
           VALUES ($1, $2, 'garantia', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [id, contrato.id, garantia.id, plano.garantia, entrada.autoridade, entrada.ato, entrada.decididaEm, entrada.justificativa, sessao.usuario.id, instante],
        );
        if (d) ids.push(d.id);
        const saldoFinal = garantia.saldo - plano.garantia;
        await tx.executar(`UPDATE contratos_garantias SET saldo = $2::bigint, situacao = CASE WHEN $2::bigint = 0 THEN 'executada' ELSE situacao END WHERE id = $1`, [garantia.id, saldoFinal]);
        await movimento(tx, garantia.id, 'desconto_multa', entrada.decididaEm, plano.garantia, `Desconto de multa por decisão de ${entrada.autoridade} (${entrada.ato}) — art. 156, § 8º.`, sessao.usuario.id);
        await espelharGarantiaNoContrato(tx, contrato.id);
      }
      const totalPagamentos = plano.pagamentos.reduce((t, p) => t + p.valor, 0);
      notificacaoId = await notificarContratada(tx, ctx, request, {
        contratoId: contrato.id,
        tipo: 'pendencia',
        detalhe: `Multa aplicada descontada por decisão da autoridade competente (${entrada.ato}): ${formatarMoeda(totalPagamentos)} retidos dos pagamentos devidos e ${formatarMoeda(plano.garantia)} da garantia${plano.garantia > 0 ? ', que deve ser recomposta' : ''}${plano.remanescente > 0 ? `; ${formatarMoeda(plano.remanescente)} seguem para cobrança` : ''} (art. 156, § 8º).`,
        dataReferencia: null,
      });
      await auditar(tx, request, {
        acao: 'multa.descontar',
        recurso: 'sancao',
        recursoId: id,
        resumo: `Registrou o desconto de multa de ${formatarMoeda(plano.valor)}: ${formatarMoeda(totalPagamentos)} dos pagamentos e ${formatarMoeda(plano.garantia)} da garantia`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: contrato.id,
          descontos: ids,
          pagamentos: plano.pagamentos,
          garantia: plano.garantia,
          remanescente: plano.remanescente,
          autoridade: entrada.autoridade,
          ato: entrada.ato,
          decididaEm: entrada.decididaEm,
          notificacaoId,
          fundamento: plano.fundamento,
        },
      });
      return { plano, ids, notas };
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    reply.status(201);
    return {
      plano: {
        pagamentos: resultado.plano.pagamentos.map((p) => ({ pagamentoId: p.id, notaFiscal: resultado.notas.get(p.id) ?? '', valor: p.valor })),
        garantia: resultado.plano.garantia,
        remanescente: resultado.plano.remanescente,
        memoria: resultado.plano.memoria,
      },
      descontos: await carregarDescontos(ctx.banco, { ids: resultado.ids }),
      notificacaoId,
    };
  });

}

/** Módulo da frente L sob /api/v1: abas Fiscalização, Recebimentos e Garantias do contrato e prazos de pagamento. */
export async function rotasExecucao(app: FastifyInstance): Promise<void> {
  await rotasExecucaoContrato(app);
  await rotasPrazosPagamento(app);
}
