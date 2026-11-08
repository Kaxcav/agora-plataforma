/**
 * Central de notificações (RF-26) e linha do tempo de vencimentos 30/60/90/120 (RN-31).
 * Toda escrita é transacional e auditada; o escopo de UASG é aplicado no SQL; o e-mail sai mascarado.
 */
import type {
  EstadoNotificacoes,
  LinhaTempoVencimentos,
  NotificacaoDetalhe,
  NotificacaoResumo,
  Pagina,
  PreferenciaNotificacao,
  ResultadoVarreduraNotificacoes,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { identificadorInstrumento } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { booleanoQuery, camposPaginacao, codigoUasg, dataIso, deslocamento, idDaRota, pagina, textoBusca, uuid } from '../../http/validacao.ts';
import { criarDrivers } from './canais.ts';
import {
  estadoNotificacoes,
  linhaTempoVencimentos,
  listarNotificacoes,
  listarPreferencias,
  obterEnvio,
  obterNotificacao,
} from './repositorio.ts';
import {
  carregarInstrumento,
  criarNotificacaoManual,
  criarReenvio,
  ErroDisparo,
  executarVarredura,
  processarFila,
  ROTULO_CANAL,
  ROTULO_PAPEL,
  ROTULO_TIPO,
} from './servico.ts';

const TIPOS = ['vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia'] as const;
const CANAIS = ['email', 'sei', 'govbr'] as const;
const DESTINOS = ['gestor', 'fiscal', 'contratada'] as const;

const semRepeticao = <T>(lista: readonly T[]) => new Set(lista).size === lista.length;

const esquemaFiltro = z.object({
  tipo: z.enum(TIPOS).optional(),
  origem: z.enum(['automatica', 'manual']).optional(),
  situacao: z.enum(['pendente', 'enviando', 'enviado', 'falhou', 'suprimido']).optional(),
  faixa: z.coerce
    .number()
    .int()
    .refine((v) => v === 30 || v === 60 || v === 90 || v === 120, 'Use 30, 60, 90 ou 120')
    .optional(),
  minhas: booleanoQuery.optional(),
  instrumentoTipo: z.enum(['ata', 'contrato']).optional(),
  instrumentoId: uuid.optional(),
  busca: textoBusca,
  ...camposPaginacao,
});

const textoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

const esquemaDisparo = z.object({
  instrumentoTipo: z.enum(['ata', 'contrato']),
  instrumentoId: uuid,
  tipo: z.enum(TIPOS),
  destinatarios: z.array(z.enum(DESTINOS)).min(1).max(3).refine(semRepeticao, 'Destinatário repetido'),
  canais: z.array(z.enum(CANAIS)).min(1).max(3).refine(semRepeticao, 'Canal repetido'),
  dataReferencia: dataIso.nullable().optional(),
  detalhe: textoOpcional(4000),
  complemento: textoOpcional(2000),
});

const esquemaPreferencias = z.object({
  preferencias: z
    .array(z.object({ tipo: z.enum(TIPOS), canal: z.enum(['email', 'govbr']), ativo: z.boolean() }))
    .min(1)
    .max(10)
    .refine((l) => semRepeticao(l.map((p) => `${p.tipo}:${p.canal}`)), 'Preferência repetida'),
});

export async function rotasNotificacoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/notificacoes', { preHandler: exigir('notificacoes:ler') }, async (request): Promise<Pagina<NotificacaoResumo>> => {
    const f = esquemaFiltro.parse(request.query);
    const sessao = sessaoDe(request);
    const { itens, total } = await listarNotificacoes(
      ctx.banco,
      {
        escopo: escopoUasgs(sessao),
        tipo: f.tipo,
        origem: f.origem,
        situacao: f.situacao,
        faixa: f.faixa,
        destinatarioId: f.minhas ? sessao.usuario.id : undefined,
        instrumentoTipo: f.instrumentoTipo,
        instrumentoId: f.instrumentoId?.toLowerCase(),
        busca: f.busca,
      },
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  /** Canais configurados (e-mail SMTP ou simulado, SEI e gov.br), situação da fila e última varredura. */
  app.get('/notificacoes/canais', { preHandler: exigir('notificacoes:ler') }, async (): Promise<EstadoNotificacoes> => {
    return estadoNotificacoes(ctx.banco, ctx.config, criarDrivers(ctx.config), ctx.hoje());
  });

  /** Preferências do próprio usuário (cada um só vê e altera as suas). */
  app.get('/notificacoes/preferencias', { preHandler: exigir('notificacoes:ler') }, async (request): Promise<PreferenciaNotificacao[]> => {
    return listarPreferencias(ctx.banco, sessaoDe(request).usuario.id);
  });

  app.put('/notificacoes/preferencias', { preHandler: exigir('notificacoes:ler') }, async (request): Promise<PreferenciaNotificacao[]> => {
    const entrada = esquemaPreferencias.parse(request.body);
    const usuarioId = sessaoDe(request).usuario.id;
    const agora = ctx.relogio().toISOString();
    await ctx.banco.transacao(async (tx) => {
      const antes = await tx.consultar<{ tipo: string; canal: string; ativo: boolean }>(
        'SELECT tipo, canal, ativo FROM notificacoes_preferencias WHERE usuario_id = $1',
        [usuarioId],
      );
      for (const p of entrada.preferencias) {
        await tx.executar(
          `INSERT INTO notificacoes_preferencias (usuario_id, tipo, canal, ativo, atualizado_em) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (usuario_id, tipo, canal) DO UPDATE SET ativo = EXCLUDED.ativo, atualizado_em = EXCLUDED.atualizado_em`,
          [usuarioId, p.tipo, p.canal, p.ativo, agora],
        );
      }
      await auditar(tx, request, {
        acao: 'notificacao.preferencias',
        recurso: 'usuario',
        recursoId: usuarioId,
        resumo: 'Alterou as próprias preferências de notificação',
        dados: {
          antes: antes.map((a) => ({ tipo: a.tipo, canal: a.canal, ativo: a.ativo })),
          depois: entrada.preferencias,
        },
      });
    });
    return listarPreferencias(ctx.banco, usuarioId);
  });

  app.get('/notificacoes/:id', { preHandler: exigir('notificacoes:ler') }, async (request): Promise<NotificacaoDetalhe> => {
    const id = idDaRota(request.params);
    const detalhe = await obterNotificacao(ctx.banco, id, escopoUasgs(sessaoDe(request)));
    if (!detalhe) throw naoEncontrado('Notificação não encontrada.');
    return detalhe;
  });

  /**
   * Disparo manual em um clique: grava a notificação e os envios (outbox) com a trilha e já processa a fila
   * desta notificação. Falha no envio não desfaz o registro: o envio fica pendente para nova tentativa.
   */
  app.post('/notificacoes', { preHandler: exigir('notificacoes:enviar') }, async (request, reply): Promise<NotificacaoDetalhe> => {
    const entrada = esquemaDisparo.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const instrumentoId = entrada.instrumentoId.toLowerCase();
    const id = await ctx.banco.transacao(async (tx) => {
      const instrumento = await carregarInstrumento(tx, entrada.instrumentoTipo, instrumentoId, escopo);
      if (!instrumento) throw naoEncontrado(entrada.instrumentoTipo === 'ata' ? 'Ata não encontrada.' : 'Contrato não encontrado.');
      let gravada;
      try {
        gravada = await criarNotificacaoManual(
          tx,
          ctx.config,
          ctx.relogio(),
          ctx.hoje(),
          instrumento,
          {
            tipo: entrada.tipo,
            destinatarios: entrada.destinatarios,
            canais: entrada.canais,
            dataReferencia: entrada.dataReferencia ?? null,
            detalhe: entrada.detalhe,
            complemento: entrada.complemento,
          },
          sessao.usuario.id,
        );
      } catch (erro) {
        if (erro instanceof ErroDisparo) throw regraNegocio(erro.message);
        throw erro;
      }
      const identificador = identificadorInstrumento(instrumento.tipo, instrumento.numero);
      await auditar(tx, request, {
        acao: 'notificacao.disparar',
        recurso: 'notificacao',
        recursoId: gravada.id,
        resumo: `Disparou aviso de ${ROTULO_TIPO[entrada.tipo]} — ${identificador}, para ${entrada.destinatarios
          .map((d) => ROTULO_PAPEL[d])
          .join(', ')} por ${entrada.canais.map((c) => ROTULO_CANAL[c]).join(', ')}`,
        dados: {
          instrumentoTipo: instrumento.tipo,
          instrumentoId: instrumento.id,
          tipo: entrada.tipo,
          destinatarios: entrada.destinatarios,
          canais: entrada.canais,
          obrigatoria: gravada.mensagem.obrigatoria,
          envios: gravada.envios,
          suprimidos: gravada.suprimidos,
        },
      });
      return gravada.id;
    });
    await processarFila(ctx, { notificacaoId: id });
    const detalhe = await obterNotificacao(ctx.banco, id, escopo);
    if (!detalhe) throw naoEncontrado();
    reply.status(201);
    return detalhe;
  });

  /** Reenvio de um envio falho ou já entregue: cria um novo envio ligado ao original e o processa. */
  app.post('/notificacoes/envios/:id/reenviar', { preHandler: exigir('notificacoes:enviar') }, async (request, reply): Promise<NotificacaoDetalhe> => {
    const envioId = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const novo = await ctx.banco.transacao(async (tx) => {
      const [trava] = await tx.consultar<{ id: string }>('SELECT id FROM notificacoes_envios WHERE id = $1 FOR UPDATE', [envioId]);
      if (!trava) throw naoEncontrado('Envio não encontrado.');
      const envio = await obterEnvio(tx, envioId, escopo);
      if (!envio) throw naoEncontrado('Envio não encontrado.');
      if (envio.reenviado) throw conflito('Este envio já foi reenviado. Acompanhe o envio mais recente.');
      if (envio.situacao === 'suprimido') {
        throw regraNegocio('Envio suprimido não pode ser reenviado: o destinatário optou por não receber ou o canal não se aplica.');
      }
      if (envio.situacao !== 'falhou' && envio.situacao !== 'enviado') {
        throw conflito('O envio ainda está na fila. Aguarde a conclusão da tentativa em andamento.');
      }
      const criado = await criarReenvio(tx, ctx.relogio(), envio.id);
      await auditar(tx, request, {
        acao: 'notificacao.reenviar',
        recurso: 'notificacao_envio',
        recursoId: criado.id,
        resumo: `Reenviou aviso por ${ROTULO_CANAL[envio.canal]} (${ROTULO_PAPEL[envio.papel]})`,
        dados: {
          instrumentoTipo: envio.instrumentoTipo,
          instrumentoId: envio.instrumentoId,
          notificacaoId: envio.notificacaoId,
          envioOriginal: envio.id,
          situacaoOriginal: envio.situacao,
          canal: envio.canal,
          papel: envio.papel,
        },
      });
      return criado;
    });
    await processarFila(ctx, { envioIds: [novo.id] });
    const detalhe = await obterNotificacao(ctx.banco, novo.notificacaoId, escopo);
    if (!detalhe) throw naoEncontrado();
    reply.status(201);
    return detalhe;
  });

  /** Executa agora a varredura do dia (idempotente) e processa a fila. */
  app.post('/notificacoes/varredura', { preHandler: exigir('notificacoes:administrar') }, async (request): Promise<ResultadoVarreduraNotificacoes> => {
    const resultado = await executarVarredura(ctx, { forcar: true, usuarioId: sessaoDe(request).usuario.id, ipHash: request.ipHash || null });
    if (!resultado) throw conflito('Outra varredura está em andamento. Tente novamente em instantes.');
    return resultado;
  });

  /** Linha do tempo do painel: contratos e atas que vencem nos próximos 120 dias, por faixa (RN-31). */
  app.get('/vencimentos', { preHandler: exigir('painel:ler') }, async (request): Promise<LinhaTempoVencimentos> => {
    const consulta = z.object({ uasg: codigoUasg.optional() }).parse(request.query);
    const hoje = ctx.hoje();
    return {
      hoje,
      instrumentos: await linhaTempoVencimentos(ctx.banco, escopoUasgs(sessaoDe(request)), consulta.uasg ?? null, hoje),
    };
  });
}
