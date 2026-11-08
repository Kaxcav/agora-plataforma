/**
 * Controle das contratações (Lei 14.133/2021, arts. 169 a 171): painéis das três linhas de defesa (RF-23), relatório
 * executivo de auditoria em PDF, medidas de controle externo (RF-24, RN-30) e revisão trimestral da matriz de riscos
 * dos contratos (RN-29). Perfil e escopo de UASG decididos aqui; toda escrita é transacional e auditada.
 */
import { randomUUID } from 'node:crypto';
import { adicionarDias, diasEntre, prazoRespostaMedida } from '@agora/dominio';
import type { MatrizRiscosContrato, MedidaControle, Pagina, PainelPrimeiraLinha, PainelSegundaLinha, PainelTerceiraLinha } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { camposPaginacao, codigoUasg, dataIso, idDaRota, paginarEmMemoria, textoBusca, uuid } from '../../http/validacao.ts';
import { carregarMedidas, referenciaContrato, referenciaProcesso } from './medidas.ts';
import { montarPrimeiraLinha, montarSegundaLinha, montarTerceiraLinha, avaliarProcessosDoEscopo, type ContextoPainel } from './paineis.ts';
import { gerarRelatorioPdf } from './relatorio.ts';
import { obterMatrizRiscosContrato } from './riscos.ts';

const ORGAOS = ['TCU', 'CGU'] as const;
const TIPOS = ['cautelar', 'determinacao', 'diligencia', 'recomendacao'] as const;
const SITUACOES = ['abertas', 'aguardando_resposta', 'resposta_vencida', 'respondida', 'revogada'] as const;
const PERIODO_PADRAO_DIAS = 90;
const PERIODO_MAXIMO_DIAS = 731;

const esquemaUasg = z.object({ uasg: codigoUasg.optional() });
const esquemaPeriodo = z.object({ uasg: codigoUasg.optional(), de: dataIso.optional(), ate: dataIso.optional() });

const esquemaFiltroMedidas = z.object({
  situacao: z.enum(SITUACOES).optional(),
  orgao: z.enum(ORGAOS).optional(),
  alvo: z.enum(['processo', 'contrato']).optional(),
  alvoId: uuid.optional(),
  uasg: codigoUasg.optional(),
  busca: textoBusca,
  ...camposPaginacao,
});

const esquemaMedida = z
  .object({
    orgao: z.enum(ORGAOS),
    tipo: z.enum(TIPOS),
    numero: z.string().trim().min(1).max(60),
    decididaEm: dataIso,
    cienciaEm: dataIso,
    objeto: z.string().trim().min(20).max(2000),
    efeitoSuspensivo: z.boolean(),
    processoId: uuid.nullable(),
    contratoId: uuid.nullable(),
    prazoDiasUteis: z.number().int().min(1).max(120).nullable(),
  })
  .refine((m) => (m.processoId === null) !== (m.contratoId === null), { message: 'Informe o processo ou o contrato atingido (apenas um).', path: ['processoId'] })
  .refine((m) => !m.efeitoSuspensivo || m.tipo === 'cautelar', { message: 'Só a medida cautelar tem efeito suspensivo.', path: ['efeitoSuspensivo'] })
  .refine((m) => !m.efeitoSuspensivo || m.prazoDiasUteis === null, {
    message: 'A suspensão cautelar tem o prazo legal de 10 dias úteis (art. 171, § 2º); não informe outro prazo.',
    path: ['prazoDiasUteis'],
  })
  .refine((m) => m.cienciaEm >= m.decididaEm, { message: 'A ciência não pode ser anterior à decisão.', path: ['cienciaEm'] });

const esquemaProrrogacao = z.object({ prorrogadoAte: dataIso, justificativa: z.string().trim().min(10).max(1000) });
const esquemaResposta = z.object({ respondidaEm: dataIso, texto: z.string().trim().min(20).max(5000) });
const esquemaRevogacao = z.object({ revogadaEm: dataIso, texto: z.string().trim().min(10).max(2000) });

const esquemaRevisao = z.object({
  riscos: z
    .array(
      z.object({
        id: uuid.optional(),
        descricao: z.string().trim().min(5).max(1000),
        probabilidade: z.literal([1, 2, 3, 4, 5]),
        impacto: z.literal([1, 2, 3, 4, 5]),
        alocacao: z.enum(['contratante', 'contratada', 'compartilhado']),
        mitigacao: z.string().trim().min(5).max(2000),
      }),
    )
    .min(1)
    .max(100),
  observacao: z.string().trim().min(20).max(2000),
});

const ROTULO_TIPO: Record<(typeof TIPOS)[number], string> = {
  cautelar: 'medida cautelar',
  determinacao: 'determinação',
  diligencia: 'diligência',
  recomendacao: 'recomendação',
};

interface LinhaMedidaTravada {
  id: string;
  orgao: string;
  tipo: (typeof TIPOS)[number];
  numero: string;
  ciencia_em: string;
  efeito_suspensivo: boolean;
  processo_id: string | null;
  contrato_id: string | null;
  prazo_resposta: string;
  prorrogado_ate: string | null;
  respondida_em: string | null;
  revogada_em: string | null;
}

/** Dados de auditoria que ligam o evento ao processo ou ao contrato (histórico do contrato lê `instrumentoTipo/Id`). */
function vinculoAuditoria(m: { processo_id: string | null; contrato_id: string | null }): Record<string, unknown> {
  return m.contrato_id !== null ? { instrumentoTipo: 'contrato', instrumentoId: m.contrato_id } : { processoId: m.processo_id };
}

export async function rotasControle(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function contextoPainel(request: FastifyRequest, uasg: string | undefined): Promise<ContextoPainel> {
    return {
      executor: ctx.banco,
      escopo: escopoUasgs(sessaoDe(request)),
      uasg: uasg ?? null,
      hoje: ctx.hoje(),
      agora: ctx.relogio(),
      calendario: await opcoesCalendario(ctx.banco),
    };
  }

  function periodoDe(de: string | undefined, ate: string | undefined): { de: string; ate: string } {
    const hoje = ctx.hoje();
    const fim = ate ?? hoje;
    const inicio = de ?? adicionarDias(fim, -PERIODO_PADRAO_DIAS);
    if (inicio > fim) throw validacao('O início do período é posterior ao fim.', [{ campo: 'de', mensagem: 'Início posterior ao fim' }]);
    if (diasEntre(inicio, fim) > PERIODO_MAXIMO_DIAS) throw validacao('O período máximo do relatório é de 2 anos.', [{ campo: 'de', mensagem: 'Período acima de 2 anos' }]);
    return { de: inicio, ate: fim };
  }

  async function medidaVisivel(request: FastifyRequest, executor: Executor, id: string): Promise<MedidaControle> {
    const [medida] = await carregarMedidas(executor, { escopo: escopoUasgs(sessaoDe(request)), id }, ctx.hoje(), await opcoesCalendario(executor));
    if (!medida) throw naoEncontrado('Medida de controle não encontrada.');
    return medida;
  }

  /** Escrita numa medida: trava a linha no escopo (fora dele → 404), aplica a ação e audita na mesma transação. */
  async function alterarMedida(
    request: FastifyRequest,
    acao: (tx: Transacao, m: LinhaMedidaTravada) => Promise<{ acao: string; resumo: string; dados: Record<string, unknown> }>,
  ): Promise<MedidaControle> {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const [linha] = await tx.consultar<LinhaMedidaTravada>(
        `SELECT id, orgao, tipo, numero, ciencia_em, efeito_suspensivo, processo_id, contrato_id, prazo_resposta, prorrogado_ate,
                respondida_em, revogada_em
           FROM medidas_controle
          WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))
          FOR UPDATE`,
        [id, escopo],
      );
      if (!linha) throw naoEncontrado('Medida de controle não encontrada.');
      const evento = await acao(tx, linha);
      await auditar(tx, request, {
        acao: `medida_controle.${evento.acao}`,
        recurso: 'medida_controle',
        recursoId: id,
        resumo: evento.resumo,
        dados: { orgao: linha.orgao, numero: linha.numero, ...vinculoAuditoria(linha), ...evento.dados },
      });
    });
    return medidaVisivel(request, ctx.banco, id);
  }

  // ───────── painéis das linhas de defesa (RF-23) ─────────

  app.get('/controle/primeira-linha', { preHandler: exigir('controle:primeira_linha') }, async (request): Promise<PainelPrimeiraLinha> => {
    const { uasg } = esquemaUasg.parse(request.query);
    const c = await contextoPainel(request, uasg);
    return montarPrimeiraLinha(c, await avaliarProcessosDoEscopo(c));
  });

  app.get('/controle/segunda-linha', { preHandler: exigir('controle:segunda_linha') }, async (request): Promise<PainelSegundaLinha> => {
    const { uasg } = esquemaUasg.parse(request.query);
    const c = await contextoPainel(request, uasg);
    return montarSegundaLinha(c, await avaliarProcessosDoEscopo(c));
  });

  app.get('/controle/terceira-linha', { preHandler: exigir('controle:terceira_linha') }, async (request): Promise<PainelTerceiraLinha> => {
    const f = esquemaPeriodo.parse(request.query);
    return montarTerceiraLinha(await contextoPainel(request, f.uasg), periodoDe(f.de, f.ate));
  });

  /** Relatório executivo de auditoria em PDF. A emissão fica na trilha, com o hash do arquivo entregue. */
  app.get('/controle/relatorio.pdf', { preHandler: exigir('controle:terceira_linha') }, async (request, reply) => {
    const f = esquemaPeriodo.parse(request.query);
    const sessao = sessaoDe(request);
    const periodo = periodoDe(f.de, f.ate);
    const painel = await montarTerceiraLinha(await contextoPainel(request, f.uasg), periodo);
    const relatorio = gerarRelatorioPdf({ orgao: ctx.config.orgao, emitidoPor: sessao.usuario.nome, painel });
    await ctx.banco.transacao(async (tx) => {
      await auditar(tx, request, {
        acao: 'controle.relatorio.emitir',
        recurso: 'relatorio_auditoria',
        recursoId: null,
        resumo: `Emitiu o relatório executivo de auditoria de ${periodo.de.split('-').reverse().join('/')} a ${periodo.ate.split('-').reverse().join('/')}`,
        dados: { ...periodo, uasg: f.uasg ?? null, hashPdf: relatorio.hash, medidas: painel.medidas.length, achados: painel.achados.length },
      });
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${relatorio.nomeArquivo}"`)
      .header('cache-control', 'no-store')
      .send(relatorio.pdf);
  });

  // ───────── medidas de controle externo (RF-24, RN-30) ─────────

  app.get('/medidas-controle', { preHandler: exigir('controle_externo:ler') }, async (request): Promise<Pagina<MedidaControle>> => {
    const f = esquemaFiltroMedidas.parse(request.query);
    const medidas = await carregarMedidas(
      ctx.banco,
      { escopo: escopoUasgs(sessaoDe(request)), uasg: f.uasg, orgao: f.orgao, alvo: f.alvo, alvoId: f.alvoId, busca: f.busca },
      ctx.hoje(),
      await opcoesCalendario(ctx.banco),
    );
    const filtradas =
      f.situacao === undefined
        ? medidas
        : f.situacao === 'abertas'
          ? medidas.filter((m) => m.bloqueia || m.situacao === 'aguardando_resposta' || m.situacao === 'resposta_vencida')
          : medidas.filter((m) => m.situacao === f.situacao);
    return paginarEmMemoria(filtradas, f.pagina, f.tamanhoPagina);
  });

  app.get('/medidas-controle/:id', { preHandler: exigir('controle_externo:ler') }, async (request): Promise<MedidaControle> =>
    medidaVisivel(request, ctx.banco, idDaRota(request.params)),
  );

  app.post('/medidas-controle', { preHandler: exigir('controle_externo:registrar') }, async (request, reply): Promise<MedidaControle> => {
    const entrada = esquemaMedida.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const hoje = ctx.hoje();
    if (entrada.cienciaEm > hoje) throw validacao('A data da ciência não pode ser futura.', [{ campo: 'cienciaEm', mensagem: 'Data futura' }]);
    const calendario = await opcoesCalendario(ctx.banco);
    const prazo = prazoRespostaMedida({ ciencia: entrada.cienciaEm, efeitoSuspensivo: entrada.efeitoSuspensivo, diasUteisFixados: entrada.prazoDiasUteis }, calendario);
    const id = randomUUID();

    await ctx.banco.transacao(async (tx) => {
      let uasg: string;
      let identificador: string;
      let alvoAuditoria: Record<string, unknown>;
      if (entrada.processoId !== null) {
        const [processo] = await tx.consultar<{ id: string; uasg: string; numero_sei: string }>(
          'SELECT id, uasg, numero_sei FROM processos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))',
          [entrada.processoId.toLowerCase(), escopo],
        );
        if (!processo) throw naoEncontrado('Processo não encontrado.');
        uasg = processo.uasg;
        identificador = referenciaProcesso(processo.id, processo.numero_sei).identificador;
        alvoAuditoria = { processoId: processo.id, numeroSei: processo.numero_sei };
      } else {
        const [contrato] = await tx.consultar<{ id: string; uasg: string; numero: string }>(
          'SELECT id, uasg, numero FROM contratos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))',
          [(entrada.contratoId ?? '').toLowerCase(), escopo],
        );
        if (!contrato) throw naoEncontrado('Contrato não encontrado.');
        uasg = contrato.uasg;
        identificador = referenciaContrato(contrato.id, contrato.numero).identificador;
        alvoAuditoria = { instrumentoTipo: 'contrato', instrumentoId: contrato.id, contratoNumero: contrato.numero };
      }
      await tx.executar(
        `INSERT INTO medidas_controle (id, orgao, tipo, numero, decidida_em, ciencia_em, objeto, efeito_suspensivo, processo_id, contrato_id,
                                       uasg, prazo_resposta, dias_uteis_prazo, fundamento_prazo, registrada_por, registrada_em, busca_normalizada)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          id,
          entrada.orgao,
          entrada.tipo,
          entrada.numero,
          entrada.decididaEm,
          entrada.cienciaEm,
          entrada.objeto,
          entrada.efeitoSuspensivo,
          entrada.processoId?.toLowerCase() ?? null,
          entrada.contratoId?.toLowerCase() ?? null,
          uasg,
          prazo.vencimento,
          prazo.diasUteis,
          prazo.fundamento,
          sessao.usuario.id,
          ctx.relogio().toISOString(),
          normalizarBusca(entrada.orgao, entrada.numero, entrada.objeto, identificador),
        ],
      );
      await auditar(tx, request, {
        acao: 'medida_controle.registrar',
        recurso: 'medida_controle',
        recursoId: id,
        resumo: `Registrou ${ROTULO_TIPO[entrada.tipo]} do ${entrada.orgao} nº ${entrada.numero} sobre ${identificador}${entrada.efeitoSuspensivo ? ' com efeito suspensivo' : ''}; resposta até ${prazo.vencimento.split('-').reverse().join('/')}`,
        dados: {
          orgao: entrada.orgao,
          tipo: entrada.tipo,
          numero: entrada.numero,
          efeitoSuspensivo: entrada.efeitoSuspensivo,
          cienciaEm: entrada.cienciaEm,
          prazoResposta: prazo.vencimento,
          fundamentoPrazo: prazo.fundamento,
          ...alvoAuditoria,
        },
      });
    });
    reply.status(201);
    return medidaVisivel(request, ctx.banco, id);
  });

  app.post('/medidas-controle/:id/prorrogacao', { preHandler: exigir('controle_externo:registrar') }, async (request) => {
    const entrada = esquemaProrrogacao.parse(request.body);
    return alterarMedida(request, async (tx, m) => {
      if (m.revogada_em !== null) throw conflito('A medida já foi revogada.');
      if (m.respondida_em !== null) throw conflito('A resposta já foi registrada; não há prazo a prorrogar.');
      const atual = m.prorrogado_ate ?? m.prazo_resposta;
      if (entrada.prorrogadoAte <= atual) {
        throw regraNegocio(`A prorrogação deve terminar depois do prazo atual (${atual.split('-').reverse().join('/')}).`, [
          { campo: 'prorrogadoAte', mensagem: 'Data anterior ou igual ao prazo atual' },
        ]);
      }
      await tx.executar('UPDATE medidas_controle SET prorrogado_ate = $2, justificativa_prorrogacao = $3 WHERE id = $1', [m.id, entrada.prorrogadoAte, entrada.justificativa]);
      return {
        acao: 'prorrogar',
        resumo: `Registrou a prorrogação do prazo de resposta da medida nº ${m.numero} até ${entrada.prorrogadoAte.split('-').reverse().join('/')}`,
        dados: { de: atual, ate: entrada.prorrogadoAte, fundamento: 'Lei 14.133/2021, art. 171, § 2º (admitida a prorrogação)' },
      };
    });
  });

  app.post('/medidas-controle/:id/resposta', { preHandler: exigir('controle_externo:registrar') }, async (request) => {
    const entrada = esquemaResposta.parse(request.body);
    const sessao = sessaoDe(request);
    return alterarMedida(request, async (tx, m) => {
      if (m.revogada_em !== null) throw conflito('A medida já foi revogada.');
      if (m.respondida_em !== null) throw conflito('A resposta desta medida já foi registrada.');
      if (entrada.respondidaEm < m.ciencia_em || entrada.respondidaEm > ctx.hoje()) {
        throw regraNegocio('A data da resposta deve estar entre a ciência e hoje.', [{ campo: 'respondidaEm', mensagem: 'Data fora do intervalo' }]);
      }
      await tx.executar('UPDATE medidas_controle SET respondida_em = $2, resposta = $3, respondida_por = $4 WHERE id = $1', [
        m.id,
        entrada.respondidaEm,
        entrada.texto,
        sessao.usuario.id,
      ]);
      const prazo = m.prorrogado_ate ?? m.prazo_resposta;
      return {
        acao: 'responder',
        resumo: `Registrou a resposta do órgão à medida nº ${m.numero} em ${entrada.respondidaEm.split('-').reverse().join('/')} (${entrada.respondidaEm <= prazo ? 'no prazo' : 'fora do prazo'})`,
        dados: { respondidaEm: entrada.respondidaEm, prazo, noPrazo: entrada.respondidaEm <= prazo },
      };
    });
  });

  app.post('/medidas-controle/:id/revogacao', { preHandler: exigir('controle_externo:registrar') }, async (request) => {
    const entrada = esquemaRevogacao.parse(request.body);
    const sessao = sessaoDe(request);
    return alterarMedida(request, async (tx, m) => {
      if (m.revogada_em !== null) throw conflito('A revogação desta medida já foi registrada.');
      if (entrada.revogadaEm < m.ciencia_em || entrada.revogadaEm > ctx.hoje()) {
        throw regraNegocio('A data da revogação deve estar entre a ciência e hoje.', [{ campo: 'revogadaEm', mensagem: 'Data fora do intervalo' }]);
      }
      await tx.executar('UPDATE medidas_controle SET revogada_em = $2, revogacao = $3, revogada_por = $4 WHERE id = $1', [
        m.id,
        entrada.revogadaEm,
        entrada.texto,
        sessao.usuario.id,
      ]);
      return {
        acao: 'revogar',
        resumo: `Registrou a revogação da medida nº ${m.numero} em ${entrada.revogadaEm.split('-').reverse().join('/')}${m.efeito_suspensivo ? '; a suspensão deixa de bloquear o processo' : ''}`,
        dados: { revogadaEm: entrada.revogadaEm, efeitoSuspensivo: m.efeito_suspensivo },
      };
    });
  });

  // ───────── matriz de riscos do contrato (RN-29) ─────────

  async function contratoParaRiscos(executor: Executor, request: FastifyRequest, travar = false) {
    const id = idDaRota(request.params);
    const [contrato] = await executor.consultar<{ id: string; numero: string; vigencia_inicio: string; vigencia_fim: string }>(
      `SELECT id, numero, vigencia_inicio, vigencia_fim FROM contratos
        WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))${travar ? ' FOR UPDATE' : ''}`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return { id: contrato.id, numero: contrato.numero, vigenciaInicio: contrato.vigencia_inicio, vigenciaFim: contrato.vigencia_fim };
  }

  app.get('/contratos/:id/riscos', { preHandler: exigir('contratos:ler') }, async (request): Promise<MatrizRiscosContrato> => {
    const contrato = await contratoParaRiscos(ctx.banco, request);
    return obterMatrizRiscosContrato(ctx.banco, contrato, ctx.hoje());
  });

  app.post('/contratos/:id/riscos/revisoes', { preHandler: exigir('riscos:revisar') }, async (request, reply): Promise<MatrizRiscosContrato> => {
    const entrada = esquemaRevisao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    // 2ª linha: unidade de controle interno; demais perfis com a permissão (gestão e fiscalização): 1ª linha.
    const linha = sessao.perfis.includes('controle_interno') ? 'segunda' : 'primeira';
    const contrato = await ctx.banco.transacao(async (tx) => {
      const c = await contratoParaRiscos(tx, request, true);
      const riscos = entrada.riscos.map((r) => ({ ...r, id: r.id?.toLowerCase() ?? randomUUID() }));
      await tx.executar(
        `INSERT INTO revisoes_matriz_riscos (id, contrato_id, revisada_em, linha, riscos, observacao, revisada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [randomUUID(), c.id, hoje, linha, JSON.stringify(riscos), entrada.observacao, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      const matriz = await obterMatrizRiscosContrato(tx, c, hoje);
      await auditar(tx, request, {
        acao: 'contrato.riscos.revisar',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: `Registrou a revisão trimestral da matriz de riscos do contrato ${c.numero} (${linha === 'segunda' ? '2ª' : '1ª'} linha de defesa), com ${riscos.length} risco(s)`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: c.id,
          revisadaEm: hoje,
          linha,
          riscos: riscos.length,
          proximaRevisao: matriz.revisao.proximaRevisao,
          fundamento: matriz.revisao.fundamento,
        },
      });
      return c;
    });
    reply.status(201);
    return obterMatrizRiscosContrato(ctx.banco, contrato, hoje);
  });
}
