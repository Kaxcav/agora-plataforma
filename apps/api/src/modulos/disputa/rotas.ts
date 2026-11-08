/**
 * Sala de disputa (RF-22, RN-26, RIA-09). Dois usos:
 * - simulação, para treino e para a PoC-03: licitantes sintéticos com lances determinísticos e relógio adiantável;
 * - acompanhamento da sessão oficial, que acontece no Compras.gov.br: o servidor consulta os dados abertos da compra e
 *   do resultado (conector com timeout, novas tentativas e proveniência) e o agente pode transcrever os lances.
 * A sala consulta GET /sessoes-disputa/:id periodicamente. Quem conduz é o agente de contratação (`disputa:conduzir`),
 * com escopo de UASG decidido no servidor; toda escrita é transacional e registrada na trilha de auditoria.
 */
import { randomUUID } from 'node:crypto';
import type { AtaSessao, SessaoDisputa, SessaoDisputaResumo } from '@agora/contratos';
import {
  ofertaValida,
  parametrosPadraoDisputa,
  perfisCenarioSimulacao,
  propostasIniciaisSimuladas,
  somenteDigitos,
  sorteioDeterministico,
  validarDefinicaoSessao,
  validarLance,
  verificarAcaoSessao,
  type EstadoSessaoDisputa,
  type EventoSessaoDisputa,
  type FaseSessaoDisputa,
  type ParametrosDisputa,
} from '@agora/dominio';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { DadosEvento } from '../../auditoria/trilha.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { ErroApi, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { idDaRota, uuid } from '../../http/validacao.ts';
import { consultarSessaoOficial, type ConsultaSessaoOficial } from '../../integracoes/compras-gov-sessao.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import { exigirEtapa } from '../jornada/servico.ts';
import {
  agoraDaSessao,
  carregarSessao,
  definicaoDe,
  estadoDe,
  julgarSessao,
  listarSessoesDoProcesso,
  montarSessao,
  redigirAta,
  registrarResultadoNoProcesso,
  vinculosDaSessao,
  type EventoArmazenado,
  type LinhaSessao,
  type ParticipanteArmazenado,
} from './servico.ts';
import { comDesempenhoRegistrado } from '../desempenho/sala.ts';

const CRITERIOS = ['menor_preco', 'maior_desconto', 'tecnica_e_preco'] as const;
const MODOS = ['aberto', 'aberto_fechado', 'fechado_aberto', 'fechado'] as const;
const FASES_DE_LANCE: ReadonlySet<FaseSessaoDisputa> = new Set<FaseSessaoDisputa>(['lances_abertos', 'fechamento_iminente', 'lance_final_fechado']);

const ROTULOS_FASE: Record<FaseSessaoDisputa, string> = {
  aguardando_abertura: 'aguardando abertura',
  lances_abertos: 'etapa aberta de lances',
  fechamento_iminente: 'fechamento iminente',
  lance_final_fechado: 'lance final e fechado',
  encerrada: 'lances encerrados',
  concluida: 'sessão concluída',
};

const segundos = (min: number, max: number) => z.number().int().min(min).max(max).optional();
const esquemaParametros = z
  .object({
    duracaoEtapaAbertaSegundos: segundos(60, 14_400),
    janelaProrrogacaoSegundos: segundos(1, 3_600),
    prorrogacaoSegundos: segundos(1, 3_600),
    fechamentoIminenteMaximoSegundos: segundos(1, 3_600),
    prazoLanceFechadoSegundos: segundos(60, 3_600),
    faixaSelecaoPercentual: z.number().positive().max(50).optional(),
    minimoSelecionados: z.number().int().min(1).max(20).optional(),
    diferencaReinicioPercentual: z.number().positive().max(50).optional(),
    intervaloMinimo: z.object({ tipo: z.enum(['absoluto', 'percentual']), valor: z.number().positive().max(1_000_000_000) }).nullable().optional(),
    pesoTecnicoPercentual: z.number().positive().max(70, 'A proposta técnica pesa no máximo 70% (art. 36, § 2º)').nullable().optional(),
  })
  .strict();

const esquemaNova = z
  .object({
    uso: z.enum(['simulacao', 'acompanhamento']),
    criterio: z.enum(CRITERIOS),
    modo: z.enum(MODOS),
    participantes: z
      .array(
        z.object({
          fornecedorId: uuid,
          propostaInicial: z.number().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
          notaTecnica: z.number().min(0).max(100).nullable().optional(),
        }),
      )
      .max(50),
    cenario: z.enum(['concorrencia', 'conluio_e_robo']).nullable().optional(),
    idCompra: z.string().trim().regex(/^\d{8,30}$/, 'Informe só os dígitos do identificador da compra no Compras.gov.br').nullable().optional(),
    parametros: esquemaParametros.optional(),
    semente: z.number().int().min(1).max(2_147_483_647).optional(),
  })
  .superRefine((v, c) => {
    if (v.uso === 'simulacao' && (v.participantes.length < 2 || v.participantes.length > 20)) {
      c.addIssue({ code: 'custom', path: ['participantes'], message: 'A simulação precisa de 2 a 20 participantes' });
    }
    if (v.uso === 'acompanhamento' && !v.idCompra) c.addIssue({ code: 'custom', path: ['idCompra'], message: 'Informe o identificador da compra no Compras.gov.br' });
  });

const esquemaLance = z.object({ participante: z.string().regex(/^L\d{1,2}$/), valor: z.number().positive().max(Number.MAX_SAFE_INTEGER) });
const instante = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)), 'Use data e hora ISO 8601 com fuso')
  .transform((v) => new Date(Date.parse(v)).toISOString());
const esquemaTranscricao = z.object({
  lances: z.array(z.object({ documento: z.string().trim().min(11).max(18), valor: z.number().positive().max(Number.MAX_SAFE_INTEGER), instante })).min(1).max(500),
});
const esquemaRelogio = z.object({ avancar: z.enum(['minuto', 'fim_da_etapa']) });
const esquemaJustificativa = z.object({ justificativa: z.string().trim().min(20, 'Justifique com ao menos 20 caracteres').max(2000) });
const esquemaNegociacao = z.object({
  valor: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  justificativa: z.string().trim().min(10, 'Descreva a negociação com ao menos 10 caracteres').max(2000),
});
const esquemaEncerramento = z.object({ justificativa: z.string().trim().max(2000).optional() });

interface EventoAuditoria {
  acao: string;
  recurso: 'sessao_disputa' | 'processo';
  recursoId: string;
  resumo: string;
  dados: DadosEvento;
}

function semNulos<T extends object>(objeto: T | undefined): Partial<ParametrosDisputa> {
  const limpo: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(objeto ?? {})) if (valor !== undefined) limpo[chave] = valor;
  return limpo as Partial<ParametrosDisputa>;
}

async function gravar(tx: Transacao, id: string, campos: Record<string, unknown>, agora: Date): Promise<void> {
  const colunas = Object.keys(campos);
  const atribuicoes = colunas.map((c, i) => `${c} = $${i + 2}${['eventos', 'participantes', 'oficial', 'ata', 'resultado'].includes(c) ? '::jsonb' : ''}`);
  const valores = colunas.map((c) => {
    const v = campos[c];
    return ['eventos', 'participantes', 'oficial', 'ata', 'resultado'].includes(c) ? JSON.stringify(v) : (v as string | number | null);
  });
  await tx.executar(`UPDATE sessoes_disputa SET ${[...atribuicoes, `atualizada_em = $${colunas.length + 2}`].join(', ')} WHERE id = $1`, [id, ...valores, agora.toISOString()]);
}

function emLances(estado: EstadoSessaoDisputa): boolean {
  return FASES_DE_LANCE.has(estado.fase);
}

export async function rotasDisputa(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('jornada:ler') };
  const conducao = { preHandler: exigir('disputa:conduzir') };

  async function responder(request: FastifyRequest, id: string): Promise<SessaoDisputa> {
    const sessao = sessaoDe(request);
    const linha = await carregarSessao(ctx.banco, id, escopoUasgs(sessao));
    if (!linha) throw naoEncontrado('Sessão de disputa não encontrada.');
    return montarSessao(ctx.banco, linha, ctx.relogio(), sessao.permissoes.has('disputa:conduzir'));
  }

  /** Escrita na sessão: trava a linha (escopo de UASG → 404), exige a etapa 6 e registra os eventos na trilha. */
  async function alterarSessao(
    request: FastifyRequest,
    executar: (tx: Transacao, linha: LinhaSessao, agora: string, estado: EstadoSessaoDisputa) => Promise<EventoAuditoria | EventoAuditoria[]>,
  ): Promise<SessaoDisputa> {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      const linha = await carregarSessao(tx, id, escopoUasgs(sessao), true);
      if (!linha) throw naoEncontrado('Sessão de disputa não encontrada.');
      if (linha.concluida_em !== null) throw regraNegocio('A sessão de disputa já foi concluída.');
      if (linha.etapa_atual !== 6) throw regraNegocio(`A sala de disputa só é conduzida na etapa 6 (Seleção do fornecedor); o processo está na etapa ${linha.etapa_atual}.`);
      const agora = agoraDaSessao(linha, ctx.relogio());
      const eventos = await executar(tx, linha, agora, estadoDe(linha, agora));
      for (const e of [eventos].flat()) {
        await auditar(tx, request, { ...e, dados: { numeroSei: linha.numero_sei, processoId: linha.processo_id, uso: linha.uso, relogioSessao: agora, ...e.dados } });
      }
    });
    return responder(request, id);
  }

  const novoEvento = (request: FastifyRequest, evento: EventoSessaoDisputa, extra: Partial<EventoArmazenado> = {}): EventoArmazenado =>
    ({ ...evento, ...extra, usuarioId: sessaoDe(request).usuario.id, registradoEm: ctx.relogio().toISOString() }) as EventoArmazenado;

  function exigirSimulacao(linha: LinhaSessao, oQue: string): void {
    if (linha.uso !== 'simulacao') throw regraNegocio(`${oQue} é exclusivo da simulação; a sessão oficial acontece no Compras.gov.br.`);
  }

  // ───────── leitura ─────────

  app.get('/processos/:id/sessoes-disputa', leitura, async (request): Promise<SessaoDisputaResumo[]> => {
    const processo = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!processo) throw naoEncontrado('Processo não encontrado.');
    return listarSessoesDoProcesso(ctx.banco, processo.id, ctx.relogio());
  });

  app.get('/sessoes-disputa/:id', leitura, async (request): Promise<SessaoDisputa> => responder(request, idDaRota(request.params)));

  /** Ata da sessão: a definitiva, depois da conclusão; antes, prévia para revisão (nunca durante a etapa de lances, por sigilo). */
  app.get('/sessoes-disputa/:id/ata', leitura, async (request): Promise<AtaSessao> => {
    const linha = await carregarSessao(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Sessão de disputa não encontrada.');
    if (linha.ata) return linha.ata;
    const agora = agoraDaSessao(linha, ctx.relogio());
    const estado = estadoDe(linha, agora);
    if (estado.fase !== 'encerrada') throw regraNegocio('A ata fica disponível depois do encerramento da etapa de lances.');
    return redigirAta(ctx.banco, linha, estado, ctx.relogio().toISOString(), false);
  });

  // ───────── criação ─────────

  app.post('/processos/:id/sessoes-disputa', conducao, async (request, reply): Promise<SessaoDisputa> => {
    const entrada = esquemaNova.parse(request.body);
    const sessao = sessaoDe(request);
    const processoId = idDaRota(request.params);
    const agora = ctx.relogio();
    const id = randomUUID();
    await ctx.banco.transacao(async (tx) => {
      const processo = await obterLinhaProcesso(tx, processoId, escopoUasgs(sessao), true);
      if (!processo) throw naoEncontrado('Processo não encontrado.');
      exigirEtapa(processo, 6, 'A sala de disputa');
      const ids = entrada.participantes.map((p) => p.fornecedorId.toLowerCase());
      if (new Set(ids).size !== ids.length) throw regraNegocio('Cada fornecedor pode constar uma única vez na sessão.');
      const fornecedores = await tx.consultar<{ id: string; documento: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string; porte: string | null }>(
        'SELECT id, documento, tipo_pessoa, razao_social, porte FROM fornecedores WHERE id = ANY($1::uuid[])',
        [ids],
      );
      const porId = new Map(fornecedores.map((f) => [f.id, f]));
      const faltantes = ids.filter((f) => !porId.has(f));
      if (faltantes.length > 0) {
        throw regraNegocio('Há participantes que não constam do cadastro de fornecedores.', faltantes.map((f) => ({ campo: 'participantes', mensagem: `Fornecedor ${f} não cadastrado` })));
      }
      const [contagem] = await tx.consultar<{ total: number }>('SELECT count(*)::int AS total FROM sessoes_disputa WHERE processo_id = $1', [processo.id]);
      const semente = entrada.semente ?? 1 + Math.floor(sorteioDeterministico(14_133, processo.id, contagem?.total ?? 0) * 2_147_483_646);
      const parametros = parametrosPadraoDisputa(entrada.modo, entrada.criterio, semNulos(entrada.parametros));
      const valorReferencia = valorEstimadoProcesso(processo.dfd, analisarCesta(processo.cesta, ctx.hoje()));

      // Chaves anônimas em ordem sorteada: a ordem de inclusão não revela quem é quem durante os lances.
      const ordenados = [...entrada.participantes].sort(
        (a, b) => sorteioDeterministico(semente, 'chave', a.fornecedorId.toLowerCase()) - sorteioDeterministico(semente, 'chave', b.fornecedorId.toLowerCase()),
      );
      const simulacao = entrada.uso === 'simulacao';
      const faltaProposta = ordenados.some((p) => p.propostaInicial == null || (entrada.criterio === 'tecnica_e_preco' && p.notaTecnica == null));
      const sinteticas = simulacao && faltaProposta ? propostasIniciaisSimuladas(semente, ordenados.length, entrada.criterio, valorReferencia) : null;
      let participantes: ParticipanteArmazenado[] = ordenados.map((p, i) => {
        const f = porId.get(p.fornecedorId.toLowerCase());
        if (!f) throw regraNegocio('Fornecedor não cadastrado.');
        const propostaInicial = p.propostaInicial ?? sinteticas?.[i]?.propostaInicial ?? null;
        if (propostaInicial !== null && !ofertaValida(entrada.criterio, propostaInicial)) {
          throw regraNegocio(
            `Proposta inicial inválida para ${f.razao_social}.`,
            [{ campo: 'participantes', mensagem: entrada.criterio === 'maior_desconto' ? 'Desconto entre 0% e 100%, com até 2 casas' : 'Valor em centavos inteiros' }],
          );
        }
        return {
          chave: `L${i + 1}`,
          fornecedorId: f.id,
          nome: f.razao_social,
          tipoPessoa: f.tipo_pessoa,
          documento: f.documento,
          meEpp: f.porte === 'ME' || f.porte === 'EPP',
          propostaInicial,
          notaTecnica: p.notaTecnica ?? (entrada.criterio === 'tecnica_e_preco' ? (sinteticas?.[i]?.notaTecnica ?? null) : null),
          perfil: null,
        };
      });
      // RN-37: nota do registro de desempenho (desempate do art. 60, II) e, com a fórmula do edital, nota técnica composta (art. 37, III).
      participantes = await comDesempenhoRegistrado(tx, processo.id, entrada.criterio, participantes, ctx.hoje());
      const cenario = simulacao ? (entrada.cenario ?? 'concorrencia') : null;
      if (simulacao && cenario) {
        const vinculos = await vinculosDaSessao(tx, participantes);
        const par = vinculos[0] ? ([vinculos[0].a, vinculos[0].b] as const) : null;
        const perfis = perfisCenarioSimulacao(
          cenario,
          participantes.map((p) => p.fornecedorId),
          par,
        );
        participantes = participantes.map((p) => ({ ...p, perfil: entrada.modo === 'fechado' ? null : (perfis[p.fornecedorId] ?? null) }));
        validarDefinicaoSessao({
          criterio: entrada.criterio,
          modo: entrada.modo,
          parametros,
          participantes: participantes.map((p) => ({ id: p.fornecedorId, nome: p.nome, propostaInicial: p.propostaInicial ?? 0, ...(p.notaTecnica !== null ? { notaTecnica: p.notaTecnica } : {}) })),
          valorReferencia,
          semente,
        });
      }
      await tx.executar(
        `INSERT INTO sessoes_disputa (id, processo_id, uso, criterio, modo, parametros, participantes, eventos, cenario, semente, valor_referencia,
                                      id_compra, conduzida_por, criada_em, atualizada_em)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, '[]'::jsonb, $8, $9, $10, $11, $12, $13, $13)`,
        [
          id,
          processo.id,
          entrada.uso,
          entrada.criterio,
          entrada.modo,
          JSON.stringify(parametros),
          JSON.stringify(participantes),
          cenario,
          semente,
          valorReferencia,
          entrada.idCompra ?? null,
          sessao.usuario.id,
          agora.toISOString(),
        ],
      );
      await auditar(tx, request, {
        acao: 'disputa.sessao.criar',
        recurso: 'sessao_disputa',
        recursoId: id,
        resumo: `Criou sessão de disputa (${simulacao ? 'simulação' : 'acompanhamento da sessão oficial'}) com ${participantes.length} participante(s)`,
        dados: {
          numeroSei: processo.numero_sei,
          processoId: processo.id,
          uso: entrada.uso,
          criterio: entrada.criterio,
          modo: entrada.modo,
          cenario,
          semente,
          idCompra: entrada.idCompra ?? null,
          participantes: participantes.map((p) => ({ chave: p.chave, fornecedorId: p.fornecedorId, perfil: p.perfil })),
          parametros,
        },
      });
    });
    reply.status(201);
    return responder(request, id);
  });

  // ───────── simulação: abertura, relógio, lances, reinício e negociação ─────────

  app.post('/sessoes-disputa/:id/abertura', conducao, async (request) =>
    alterarSessao(request, async (tx, linha, agora, estado) => {
      exigirSimulacao(linha, 'A abertura pela Ágora');
      const definicao = definicaoDe(linha);
      const evento: EventoSessaoDisputa = { tipo: 'abertura', instante: agora };
      if (!definicao) throw regraNegocio('A sessão não tem participantes.');
      verificarAcaoSessao(definicao, estado, evento);
      await gravar(tx, linha.id, { eventos: [...linha.eventos, novoEvento(request, evento)] }, ctx.relogio());
      return {
        acao: 'disputa.sessao.abrir',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: `Abriu a sessão simulada (modo ${linha.modo.replace('_', ' e ')})`,
        dados: { modo: linha.modo, criterio: linha.criterio },
      };
    }),
  );

  app.post('/sessoes-disputa/:id/relogio', conducao, async (request) => {
    const { avancar } = esquemaRelogio.parse(request.body);
    return alterarSessao(request, async (tx, linha, agora, estado) => {
      exigirSimulacao(linha, 'Adiantar o relógio');
      if (!emLances(estado)) throw regraNegocio('O relógio da simulação só avança durante a etapa de lances.');
      const inicio = Date.parse(agora);
      let alvo = inicio + 60_000;
      if (avancar === 'fim_da_etapa') {
        alvo = inicio;
        for (let i = 0; i < 1_000; i++) {
          const e = estadoDe(linha, new Date(alvo).toISOString());
          if (e.fase !== estado.fase || e.rodada !== estado.rodada || e.fimPrevisto === null) break;
          alvo = Math.max(alvo + 1, Date.parse(e.fimPrevisto));
        }
      }
      const delta = alvo - inicio;
      await gravar(tx, linha.id, { deslocamento_ms: linha.deslocamento_ms + delta }, ctx.relogio());
      const depois = estadoDe(linha, new Date(alvo).toISOString());
      return {
        acao: 'disputa.sessao.relogio',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: `Adiantou o relógio da simulação em ${Math.round(delta / 1000)} s (${ROTULOS_FASE[estado.fase]} → ${ROTULOS_FASE[depois.fase]})`,
        dados: { segundos: Math.round(delta / 1000), faseAntes: estado.fase, faseDepois: depois.fase, lances: depois.lances.length, prorrogacoes: depois.prorrogacoes },
      };
    });
  });

  app.post('/sessoes-disputa/:id/lances', conducao, async (request) => {
    const entrada = esquemaLance.parse(request.body);
    return alterarSessao(request, async (tx, linha, agora, estado) => {
      exigirSimulacao(linha, 'O lance de treino');
      const participante = linha.participantes.find((p) => p.chave === entrada.participante);
      const definicao = definicaoDe(linha);
      if (!participante || !definicao) throw regraNegocio('Participante desconhecido nesta sessão.');
      const evento: EventoSessaoDisputa = { tipo: 'lance', instante: agora, licitanteId: participante.fornecedorId, valor: entrada.valor };
      const v = validarLance(definicao, estado, evento);
      if (!v.valido) throw regraNegocio(`Lance recusado: ${v.motivo}`, [{ campo: 'LANCE_RECUSADO', mensagem: `${v.motivo} (${v.fundamento})` }]);
      await gravar(tx, linha.id, { eventos: [...linha.eventos, novoEvento(request, evento)] }, ctx.relogio());
      return {
        acao: 'disputa.lance.registrar',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: `Registrou lance de treino em nome do participante ${participante.chave} na simulação`,
        dados: { participante: participante.chave, valor: entrada.valor, intermediario: v.intermediario, fase: estado.fase, rodada: estado.rodada },
      };
    });
  });

  app.post('/sessoes-disputa/:id/reinicio', conducao, async (request) => {
    const { justificativa } = esquemaJustificativa.parse(request.body);
    return alterarSessao(request, async (tx, linha, agora, estado) => {
      exigirSimulacao(linha, 'O reinício pela Ágora');
      const definicao = definicaoDe(linha);
      if (!definicao) throw regraNegocio('A sessão não tem participantes.');
      const evento: EventoSessaoDisputa = { tipo: 'reinicio', instante: agora };
      verificarAcaoSessao(definicao, estado, evento);
      await gravar(tx, linha.id, { eventos: [...linha.eventos, novoEvento(request, evento, { justificativa })] }, ctx.relogio());
      return {
        acao: 'disputa.sessao.reiniciar',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: 'Admitiu o reinício da disputa aberta para definir as demais colocações (art. 56, § 4º)',
        dados: { justificativa, rodada: estado.rodada + 1 },
      };
    });
  });

  app.post('/sessoes-disputa/:id/negociacao', conducao, async (request) => {
    const entrada = esquemaNegociacao.parse(request.body);
    return alterarSessao(request, async (tx, linha, agora, estado) => {
      exigirSimulacao(linha, 'A negociação pela Ágora');
      const definicao = definicaoDe(linha);
      const primeiro = julgarSessao(linha, estado)?.classificacao[0];
      if (!definicao || !primeiro) throw regraNegocio('Não há primeiro colocado para negociar.');
      const evento: EventoSessaoDisputa = { tipo: 'negociacao', instante: agora, licitanteId: primeiro.id, valor: entrada.valor };
      verificarAcaoSessao(definicao, estado, evento);
      await gravar(tx, linha.id, { eventos: [...linha.eventos, novoEvento(request, evento, { justificativa: entrada.justificativa })] }, ctx.relogio());
      const chave = linha.participantes.find((p) => p.fornecedorId === primeiro.id)?.chave ?? null;
      return {
        acao: 'disputa.sessao.negociar',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: 'Registrou negociação com o primeiro colocado (art. 61)',
        dados: { participante: chave, valorAnterior: primeiro.valorOfertado, valor: entrada.valor, justificativa: entrada.justificativa },
      };
    });
  });

  // ───────── acompanhamento da sessão oficial ─────────

  app.post('/sessoes-disputa/:id/sincronizacao', conducao, async (request) => {
    const previa = await carregarSessao(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!previa) throw naoEncontrado('Sessão de disputa não encontrada.');
    if (previa.uso !== 'acompanhamento' || previa.id_compra === null) throw regraNegocio('A consulta ao Compras.gov.br é do acompanhamento da sessão oficial.');
    const estadoPrevio = estadoDe(previa, agoraDaSessao(previa, ctx.relogio()));
    let consulta: ConsultaSessaoOficial;
    try {
      consulta = await consultarSessaoOficial({
        modo: ctx.config.integracoes,
        urlBase: ctx.config.comprasGov.url,
        idCompra: previa.id_compra,
        fetch: ctx.fetch,
        agora: ctx.relogio(),
        semente: previa.semente,
        participantes: previa.participantes.map((p) => ({
          documento: p.documento,
          nome: p.nome,
          tipoPessoa: p.tipoPessoa,
          valor: estadoPrevio.ofertas.find((o) => o.licitanteId === p.fornecedorId)?.valor ?? null,
        })),
        valorReferencia: previa.valor_referencia,
      });
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw new ErroApi(503, 'INDISPONIVEL', erro.message);
      throw erro;
    }
    return alterarSessao(request, async (tx, linha) => {
      const participantes = [...linha.participantes];
      let incluidosNoCadastro = 0;
      for (const r of consulta.resultados) {
        if (participantes.some((p) => p.documento === r.documento)) continue;
        let [f] = await tx.consultar<{ id: string; razao_social: string; porte: string | null }>('SELECT id, razao_social, porte FROM fornecedores WHERE documento = $1', [
          r.documento,
        ]);
        if (!f) {
          [f] = await tx.consultar<{ id: string; razao_social: string; porte: string | null }>(
            `INSERT INTO fornecedores (documento, tipo_pessoa, razao_social, busca_normalizada, fonte_dados)
             VALUES ($1, $2, $3, $4, 'COMPRAS_GOV') RETURNING id, razao_social, porte`,
            [r.documento, r.tipoPessoa, r.nome, r.tipoPessoa === 'PJ' ? normalizarBusca(r.nome, r.documento) : ''],
          );
          incluidosNoCadastro++;
        }
        if (!f) continue;
        participantes.push({
          chave: `L${participantes.length + 1}`,
          fornecedorId: f.id,
          nome: f.razao_social,
          tipoPessoa: r.tipoPessoa,
          documento: r.documento,
          meEpp: f.porte === 'ME' || f.porte === 'EPP',
          propostaInicial: null,
          notaTecnica: null,
          perfil: null,
        });
      }
      await gravar(tx, linha.id, { oficial: consulta, participantes }, ctx.relogio());
      return {
        acao: 'disputa.sessao.sincronizar',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: `Consultou a compra ${linha.id_compra ?? ''} no Compras.gov.br (${consulta.modo === 'online' ? 'online' : 'offline'}): ${consulta.resultados.length} fornecedor(es) no resultado`,
        dados: {
          fonte: consulta.fonte,
          modo: consulta.modo,
          idCompra: linha.id_compra,
          consultadoEm: consulta.consultadoEm,
          hash: consulta.hash,
          registros: consulta.registros,
          endereco: consulta.endereco,
          situacao: consulta.compra.situacao,
          participantesIncluidos: participantes.length - linha.participantes.length,
          fornecedoresIncluidosNoCadastro: incluidosNoCadastro,
        },
      };
    });
  });

  app.post('/sessoes-disputa/:id/lances/transcricao', conducao, async (request) => {
    const entrada = esquemaTranscricao.parse(request.body);
    return alterarSessao(request, async (tx, linha) => {
      if (linha.uso !== 'acompanhamento') throw regraNegocio('A transcrição é do acompanhamento da sessão oficial; na simulação, registre o lance de treino.');
      const participantes = [...linha.participantes];
      const erros: { campo: string; mensagem: string }[] = [];
      const novos: EventoArmazenado[] = [];
      for (const [indice, l] of entrada.lances.entries()) {
        const documento = somenteDigitos(l.documento);
        if (!ofertaValida(linha.criterio, l.valor)) {
          erros.push({ campo: `lances.${indice}.valor`, mensagem: linha.criterio === 'maior_desconto' ? 'Desconto entre 0% e 100%, com até 2 casas' : 'Valor em centavos inteiros e positivos' });
          continue;
        }
        let participante = participantes.find((p) => p.documento === documento);
        if (!participante) {
          const [f] = await tx.consultar<{ id: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string; porte: string | null }>(
            'SELECT id, tipo_pessoa, razao_social, porte FROM fornecedores WHERE documento = $1',
            [documento],
          );
          if (!f) {
            erros.push({ campo: `lances.${indice}.documento`, mensagem: 'Fornecedor não consta do cadastro: sincronize com o Compras.gov.br ou cadastre-o' });
            continue;
          }
          participante = {
            chave: `L${participantes.length + 1}`,
            fornecedorId: f.id,
            nome: f.razao_social,
            tipoPessoa: f.tipo_pessoa,
            documento,
            meEpp: f.porte === 'ME' || f.porte === 'EPP',
            propostaInicial: null,
            notaTecnica: null,
            perfil: null,
          };
          participantes.push(participante);
        }
        novos.push(novoEvento(request, { tipo: 'lance', instante: l.instante, licitanteId: participante.fornecedorId, valor: l.valor }, { origem: 'transcrito' }));
      }
      if (erros.length > 0) throw regraNegocio(`${erros.length} linha(s) da transcrição com problema; nada foi gravado.`, erros);
      await gravar(tx, linha.id, { eventos: [...linha.eventos, ...novos], participantes }, ctx.relogio());
      return {
        acao: 'disputa.lances.transcrever',
        recurso: 'sessao_disputa',
        recursoId: linha.id,
        resumo: `Transcreveu ${novos.length} lance(s) da sessão oficial para os sinais de padrão de lances`,
        dados: { quantidade: novos.length, participantesIncluidos: participantes.length - linha.participantes.length },
      };
    });
  });

  // ───────── encerramento: ata e registro da disputa no processo ─────────

  app.post('/sessoes-disputa/:id/encerramento', conducao, async (request) => {
    const { justificativa } = esquemaEncerramento.parse(request.body ?? {});
    return alterarSessao(request, async (tx, linha, agora, estado) => {
      if (estado.fase !== 'encerrada') {
        throw regraNegocio(
          linha.uso === 'simulacao'
            ? 'A sessão só é concluída depois do encerramento da etapa de lances.'
            : 'Traga o resultado do Compras.gov.br ou transcreva os lances antes de encerrar o acompanhamento.',
        );
      }
      const processo = await obterLinhaProcesso(tx, linha.processo_id, null, true);
      if (!processo) throw naoEncontrado('Processo não encontrado.');
      exigirEtapa(processo, 6, 'O registro do resultado da sessão');
      const relogio = ctx.relogio();
      let eventos = linha.eventos;
      if (linha.uso === 'simulacao') {
        const definicao = definicaoDe(linha);
        const conclusao: EventoSessaoDisputa = { tipo: 'conclusao', instante: agora };
        if (!definicao) throw regraNegocio('A sessão não tem participantes.');
        verificarAcaoSessao(definicao, estado, conclusao);
        eventos = [...linha.eventos, novoEvento(request, conclusao, justificativa ? { justificativa } : {})];
      }
      const final: LinhaSessao = { ...linha, eventos, concluida_em: relogio.toISOString() };
      const estadoFinal = estadoDe(final, agora);
      const classificacao = julgarSessao(final, estadoFinal);
      if (!classificacao || classificacao.classificacao.length === 0) throw regraNegocio('Não há ofertas para classificar.');
      const disputa = await registrarResultadoNoProcesso(tx, final, classificacao, relogio);
      const ata = await redigirAta(tx, final, estadoFinal, relogio.toISOString(), true);
      const resultado = disputa.resultado;
      await gravar(tx, linha.id, { eventos, concluida_em: relogio.toISOString(), ata, resultado }, relogio);
      const vencedor = classificacao.classificacao[0]?.id ?? null;
      return [
        {
          acao: 'disputa.sessao.encerrar',
          recurso: 'sessao_disputa',
          recursoId: linha.id,
          resumo: `Encerrou a sessão de disputa (${linha.uso === 'simulacao' ? 'simulação' : 'acompanhamento'}) e emitiu a ata para revisão humana`,
          dados: { vencedor, lances: estadoFinal.lances.length, prorrogacoes: estadoFinal.prorrogacoes, hashAta: sha256Hex(ata.texto), justificativa: justificativa ?? null },
        },
        {
          acao: 'processo.disputa.registrar',
          recurso: 'processo',
          recursoId: linha.processo_id,
          resumo: `Registrou a disputa com ${disputa.licitantes.length} licitante(s) a partir da sala de disputa${resultado?.empateDetectado ? ' e aplicou os critérios de desempate do art. 60' : ''}`,
          dados: {
            origem: 'sala_de_disputa',
            sessaoId: linha.id,
            etapa: processo.etapa_atual,
            licitantes: disputa.licitantes.map((l) => ({ fornecedorId: l.fornecedorId, valorProposta: l.valorProposta })),
            vencedor,
            empateDetectado: resultado?.empateDetectado ?? false,
            criterioDecisivo: resultado?.criterioDecisivo ?? null,
            sorteioNecessario: resultado?.sorteioNecessario ?? false,
          },
        },
      ];
    });
  });
}
