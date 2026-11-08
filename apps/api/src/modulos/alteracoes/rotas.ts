/**
 * Alterações do contrato (F22a): termo aditivo como ato (RN-32), prorrogação com travas (RN-33), reajuste e
 * repactuação por apostila, reequilíbrio e extinção (RF-27). Toda escrita é transacional, com evento na trilha de
 * auditoria; a assinatura confere a regularidade do contratado (frente C) e pede a divulgação no PNCP pela fila
 * (frente B); a abertura da extinção unilateral notifica o contratado pela central de notificações (frente J).
 */
import {
  adicionarDiasUteis,
  avaliarDecisaoExtincao,
  avaliarInstauracaoExtincao,
  avaliarReajuste,
  avaliarReequilibrio,
  avaliarRepactuacao,
  avaliarTermoAditivo,
  EFEITOS_EXTINCAO,
  formatarData,
  formatarMoeda,
  hojeISO,
  MOTIVOS_EXTINCAO,
  type AvaliacaoTermoAditivo,
  type EfeitoExtincao,
  type MotivoExtincao,
} from '@agora/dominio';
import type { AlteracaoContratual, PainelAlteracoesContrato } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { reabrir } from '../../fila/registro.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota } from '../../http/validacao.ts';
import { obterMatrizRiscosContrato } from '../controle/riscos.ts';
import { exigirRegularidade, verificarRegularidade } from '../regularidade/servico.ts';
import { camposTravasProrrogacao, conferirTravasProrrogacao } from './prorrogacao.ts';
import {
  ciclosReajusteAplicados,
  mapearAlteracao,
  montarPainelAlteracoes,
  obterContratoAlteracao,
  obterLinhaAlteracao,
  proximoNumeroTermo,
  ultimaProrrogacao,
  valorInicialAtualizado,
  type DadosAlteracao,
  type LinhaAlteracao,
  type LinhaContratoAlteracao,
} from './repositorio.ts';
import { efetivarProrrogacao, gravarNoLivro, notificarContraditorio, solicitarDivulgacaoTermo, textoTermo, type TipoLivroAditivo } from './servico.ts';

const texto = (max: number) => z.string().trim().max(max);
const justificativa = texto(5000);

const esquemaProposta = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.enum(['acrescimo', 'supressao']), valor: centavos, reformaEdificioOuEquipamento: z.boolean().optional(), justificativa }),
  z.object({
    tipo: z.literal('qualitativa'),
    valor: centavos,
    efeitoFinanceiro: z.enum(['acrescimo', 'supressao', 'nenhum']),
    descricaoAlteracao: z.string().trim().min(10).max(2000),
    justificativa,
  }),
  z.object({ tipo: z.literal('prazo'), novaVigenciaFim: dataIso, valor: centavos.default(0), justificativa, ...camposTravasProrrogacao }),
  z.object({
    tipo: z.literal('reequilibrio'),
    enquadramento: z.enum([
      'forca_maior',
      'caso_fortuito',
      'fato_principe',
      'fato_imprevisivel',
      'previsivel_consequencias_incalculaveis',
      'tributo_superveniente',
      'alteracao_unilateral',
    ]),
    riscoId: z.string().trim().min(1).max(100).nullable().optional(),
    dataEvento: dataIso,
    solicitadoEm: dataIso,
    solicitante: z.enum(['contratada', 'administracao']),
    sentido: z.enum(['aumento', 'reducao']),
    valor: centavos,
    demonstracao: texto(5000),
    justificativa,
  }),
]);
type Proposta = z.infer<typeof esquemaProposta>;

const esquemaParecer = z.object({
  resultado: z.enum(['favoravel', 'favoravel_com_ressalvas', 'desfavoravel']),
  numero: z.string().trim().min(3).max(60),
  texto: z.string().trim().min(20).max(5000),
});
const esquemaAssinatura = z.object({
  confirmacao: z.literal(true, { error: 'Confirme a assinatura do termo.' }),
  valorReconhecido: centavos.optional(),
  fundamentacao: texto(5000).optional(),
});
const esquemaIndeferimento = z.object({ fundamentacao: z.string().trim().min(20).max(5000) });
const esquemaReajuste = z.object({
  percentual: z.number().finite(),
  fonteIndice: z.string().trim().min(5).max(300),
  observacao: texto(2000).nullable().optional(),
});
const esquemaRepactuacao = z.object({
  regimeMaoDeObra: z.enum(['dedicacao_exclusiva', 'predominancia', 'sem_dedicacao']).optional(),
  solicitadaEm: dataIso,
  efeitosDesde: dataIso,
  componentes: z
    .array(
      z.object({
        descricao: texto(300),
        origem: z.enum(['mao_de_obra', 'insumos']),
        dataBase: dataIso,
        valorMensalAnterior: centavos,
        valorMensalNovo: centavos,
        documento: texto(300),
      }),
    )
    .max(30),
  clausulasNaoTrabalhistasExcluidas: z.boolean(),
  justificativa: z.string().trim().min(20).max(5000),
});
const MOTIVOS = Object.keys(MOTIVOS_EXTINCAO) as [MotivoExtincao, ...MotivoExtincao[]];
const EFEITOS = Object.keys(EFEITOS_EXTINCAO) as [EfeitoExtincao, ...EfeitoExtincao[]];
const esquemaExtincao = z.object({
  forma: z.enum(['unilateral', 'consensual', 'judicial_arbitral']),
  motivo: z.enum(MOTIVOS),
  fundamentacao: texto(5000),
  prazoDefesaDiasUteis: z.number().int().nullable().optional(),
  interesseAdministracao: z.boolean().optional(),
  referenciaDecisao: texto(200).nullable().optional(),
});
const esquemaDefesa = z.union([
  z.object({ semManifestacao: z.literal(true) }),
  z.object({ semManifestacao: z.literal(false).optional(), apresentadaEm: dataIso, resumo: z.string().trim().min(20).max(5000) }),
]);
const esquemaDecisaoExtincao = z.object({
  decisao: z.enum(['extinguir', 'arquivar']),
  dataEfeitos: dataIso,
  fundamentacao: texto(5000),
  culpaAdministracao: z.boolean(),
  efeitos: z.array(z.enum(EFEITOS)).max(EFEITOS.length),
  autorizacaoMinistro: z.boolean().optional(),
});

const ROTULO_ENQUADRAMENTO: Record<string, string> = {
  forca_maior: 'Força maior',
  caso_fortuito: 'Caso fortuito',
  fato_principe: 'Fato do príncipe',
  fato_imprevisivel: 'Fato imprevisível',
  previsivel_consequencias_incalculaveis: 'Fato previsível de consequências incalculáveis',
  tributo_superveniente: 'Tributo ou encargo legal superveniente (art. 134)',
  alteracao_unilateral: 'Alteração unilateral pela Administração (art. 124, I)',
};
const ROTULO_NATUREZA: Record<string, string> = {
  continuo: 'Serviço ou fornecimento contínuo (arts. 106 e 107)',
  ti_estruturante: 'Sistema estruturante de TI (art. 114)',
  escopo: 'Escopo predefinido (art. 111)',
  receita_sem_investimento: 'Receita, sem investimento (art. 110, I)',
  receita_com_investimento: 'Receita, com investimento (art. 110, II)',
};
const ROTULO_FORMA: Record<string, string> = {
  unilateral: 'Unilateral, por ato escrito da Administração (art. 138, I)',
  consensual: 'Consensual (art. 138, II)',
  judicial_arbitral: 'Decisão judicial ou arbitral (art. 138, III)',
};
const ROTULO_ALOCACAO: Record<string, string> = {
  contratante: 'contratante',
  contratada: 'contratada',
  compartilhado: 'compartilhado',
  nao_previsto: 'não previsto na matriz',
};

function recusa(mensagem: string, regra: string, motivos: readonly string[]): never {
  throw regraNegocio(mensagem, motivos.map((m) => ({ campo: regra, mensagem: m })));
}

function percentualTexto(n: number | null): string {
  return n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** Linhas de resumo da avaliação do art. 125 (percentual acumulado e limite). */
function linhasLimite(a: AvaliacaoTermoAditivo): { rotulo: string; valor: string }[] {
  if (a.contaNoLimite === null || a.percentualAcumulado === null) return [];
  return [
    {
      rotulo: a.contaNoLimite === 'acrescimo' ? 'Acréscimos acumulados' : 'Supressões acumuladas',
      valor: `${percentualTexto(a.percentualAcumulado)} do valor inicial atualizado (limite de ${a.limitePercentual ?? 25}%)`,
    },
  ];
}

export async function rotasAlteracoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function contratoDaRota(request: FastifyRequest, executor: Executor = ctx.banco, bloquear = false): Promise<LinhaContratoAlteracao> {
    const contrato = await obterContratoAlteracao(executor, idDaRota(request.params), escopoUasgs(sessaoDe(request)), bloquear);
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  async function alteracaoDaRota(executor: Executor, contrato: LinhaContratoAlteracao, request: FastifyRequest, bloquear = false): Promise<LinhaAlteracao> {
    const alteracaoId = idDaRota(request.params, 'alteracaoId');
    const linha = await obterLinhaAlteracao(executor, contrato.id, alteracaoId, bloquear);
    if (!linha) throw naoEncontrado('Alteração não encontrada.');
    return linha;
  }

  async function responder(contratoId: string, alteracaoId: string, request: FastifyRequest): Promise<AlteracaoContratual> {
    const contrato = await obterContratoAlteracao(ctx.banco, contratoId, escopoUasgs(sessaoDe(request)));
    const linha = contrato ? await obterLinhaAlteracao(ctx.banco, contratoId, alteracaoId) : null;
    if (!contrato || !linha) throw naoEncontrado('Alteração não encontrada.');
    return mapearAlteracao(linha, contrato, ctx.hoje(), await opcoesCalendario(ctx.banco));
  }

  /** Depois da confirmação: avisa a fila e, com o trabalhador embutido, espera a primeira execução. */
  async function despachar(tarefa: LinhaTarefa | null): Promise<void> {
    if (!tarefa) return;
    await app.fila.despachar([tarefa]);
    await app.fila.aguardar(tarefa.id);
  }

  function usuario(request: FastifyRequest): { id: string; nome: string } {
    const s = sessaoDe(request);
    return { id: s.usuario.id, nome: s.usuario.nome };
  }

  /** Avaliação do termo aditivo de acréscimo, supressão, alteração qualitativa ou reequilíbrio sobre o estado atual do contrato. */
  function avaliarProposta(contrato: LinhaContratoAlteracao, p: Proposta, valor: number): AvaliacaoTermoAditivo {
    return avaliarTermoAditivo({
      tipo: p.tipo,
      valor,
      ...(p.tipo === 'qualitativa' ? { efeitoFinanceiro: p.efeitoFinanceiro } : {}),
      ...(p.tipo === 'reequilibrio' ? { sentido: p.sentido } : {}),
      ...(p.tipo === 'acrescimo' || p.tipo === 'supressao' ? { reformaEdificioOuEquipamento: p.reformaEdificioOuEquipamento === true } : {}),
      valorInicialAtualizado: Math.max(valorInicialAtualizado(contrato), 1),
      acrescimosAnteriores: contrato.acrescimos,
      supressoesAnteriores: contrato.supressoes,
      justificativa: p.justificativa,
      vigenciaFim: contrato.vigencia_fim,
      hoje: ctx.hoje(),
      contratoExtinto: contrato.extinto_em !== null,
    });
  }

  /** Reequilíbrio: alocação do risco na matriz de riscos do contrato (frente H) e preclusão do art. 131. */
  async function avaliarPedidoReequilibrio(executor: Executor, contrato: LinhaContratoAlteracao, p: Extract<Proposta, { tipo: 'reequilibrio' }>) {
    const hoje = ctx.hoje();
    let alocacao: 'contratante' | 'contratada' | 'compartilhado' | 'nao_previsto' = 'nao_previsto';
    let risco: string | null = null;
    if (p.riscoId) {
      const matriz = await obterMatrizRiscosContrato(executor, { id: contrato.id, vigenciaInicio: contrato.vigencia_inicio, vigenciaFim: contrato.vigencia_fim }, hoje);
      const item = matriz.riscos.find((r) => r.id === p.riscoId);
      if (!item) recusa('O risco informado não está na matriz de riscos vigente do contrato.', 'RF-27', ['Escolha um risco da matriz vigente ou indique evento não previsto.']);
      alocacao = item.alocacao;
      risco = item.descricao;
    }
    const avaliacao = avaliarReequilibrio({
      enquadramento: p.enquadramento,
      alocacaoRisco: alocacao,
      dataEvento: p.dataEvento,
      solicitadoEm: p.solicitadoEm,
      vigenciaInicio: contrato.vigencia_inicio,
      vigenciaFim: contrato.vigencia_fim,
      ultimaProrrogacaoEm: await ultimaProrrogacao(executor, contrato.id),
      sentido: p.sentido,
      valorPleiteado: p.valor,
      demonstracao: p.demonstracao,
      hoje,
      contratoExtinto: contrato.extinto_em !== null,
    });
    return { avaliacao, alocacao, risco };
  }

  // ───────── painel e histórico (RF-27) ─────────

  app.get('/contratos/:id/alteracoes', { preHandler: exigir('contratos:ler') }, async (request): Promise<PainelAlteracoesContrato> => {
    const contrato = await contratoDaRota(request);
    return montarPainelAlteracoes(ctx.banco, contrato, ctx.hoje(), await opcoesCalendario(ctx.banco));
  });

  // ───────── proposta de termo aditivo (RN-32, RN-33) ─────────

  app.post('/contratos/:id/alteracoes', { preHandler: exigir('contratos:editar') }, async (request, reply): Promise<AlteracaoContratual> => {
    const p = esquemaProposta.parse(request.body);
    const autor = usuario(request);
    const ids = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const hoje = ctx.hoje();
      let dados: DadosAlteracao;
      let valor: number;
      let novaVigenciaFim: string | null = null;
      if (p.tipo === 'prazo') {
        const termo = avaliarTermoAditivo({
          tipo: 'prazo',
          valor: p.valor,
          valorInicialAtualizado: Math.max(valorInicialAtualizado(contrato), 1),
          acrescimosAnteriores: contrato.acrescimos,
          supressoesAnteriores: contrato.supressoes,
          justificativa: p.justificativa,
          vigenciaFim: contrato.vigencia_fim,
          hoje,
          contratoExtinto: contrato.extinto_em !== null,
        });
        if (!termo.permitido) recusa('O termo aditivo foi recusado (RN-32).', 'RN-32', termo.motivos);
        const { natureza, avaliacao, travas } = conferirTravasProrrogacao(contrato, p, hoje);
        valor = p.valor;
        novaVigenciaFim = p.novaVigenciaFim;
        dados = {
          ...travas,
          natureza,
          detalhes: [
            { rotulo: 'Vigência', valor: `de ${formatarData(contrato.vigencia_fim)} para ${formatarData(p.novaVigenciaFim)}` },
            { rotulo: 'Natureza do contrato', valor: ROTULO_NATUREZA[natureza] ?? natureza },
            { rotulo: 'Vigência máxima', valor: avaliacao.limiteVigencia ? formatarData(avaliacao.limiteVigencia) : 'sem teto legal (escopo)' },
            { rotulo: 'Valor do período prorrogado', valor: formatarMoeda(p.valor) },
          ],
          avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
        };
      } else if (p.tipo === 'reequilibrio') {
        const termo = avaliarProposta(contrato, p, p.valor);
        const { avaliacao, alocacao, risco } = await avaliarPedidoReequilibrio(tx, contrato, p);
        const motivos = [...termo.motivos, ...avaliacao.motivos];
        if (motivos.length > 0) recusa('O pedido de reequilíbrio não foi admitido.', 'RF-27', [...new Set(motivos)]);
        valor = termo.efeitoValor;
        dados = {
          enquadramento: p.enquadramento,
          riscoId: p.riscoId ?? null,
          alocacao,
          dataEvento: p.dataEvento,
          solicitadoEm: p.solicitadoEm,
          solicitante: p.solicitante,
          sentido: p.sentido,
          valorPleiteado: p.valor,
          demonstracao: p.demonstracao,
          detalhes: [
            { rotulo: 'Enquadramento', valor: ROTULO_ENQUADRAMENTO[p.enquadramento] ?? p.enquadramento },
            { rotulo: 'Evento', valor: formatarData(p.dataEvento) },
            { rotulo: 'Pedido', valor: `${formatarData(p.solicitadoEm)}, ${p.solicitante === 'contratada' ? 'pela contratada' : 'pela Administração'}` },
            { rotulo: 'Matriz de riscos', valor: risco ? `${risco} — risco ${ROTULO_ALOCACAO[alocacao]}` : 'evento não previsto na matriz' },
            { rotulo: 'Valor pleiteado', valor: `${p.sentido === 'aumento' ? 'aumento' : 'redução'} de ${formatarMoeda(p.valor)}` },
            { rotulo: 'Demonstração', valor: p.demonstracao },
            ...avaliacao.observacoes.map((o) => ({ rotulo: 'Observação', valor: o })),
          ],
          avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
        };
      } else {
        const termo = avaliarProposta(contrato, p, p.valor);
        if (!termo.permitido) recusa('O termo aditivo foi recusado (RN-32).', 'RN-32', termo.motivos);
        valor = termo.efeitoValor;
        dados = {
          ...(p.tipo === 'qualitativa' ? { efeitoFinanceiro: p.efeitoFinanceiro, descricaoAlteracao: p.descricaoAlteracao } : {}),
          ...(p.tipo !== 'qualitativa' ? { reformaEdificioOuEquipamento: p.reformaEdificioOuEquipamento === true } : {}),
          detalhes: [
            ...(p.tipo === 'qualitativa'
              ? [
                  { rotulo: 'Alteração', valor: p.descricaoAlteracao },
                  {
                    rotulo: 'Reflexo financeiro',
                    valor: p.efeitoFinanceiro === 'nenhum' ? 'sem reflexo no valor' : `${p.efeitoFinanceiro === 'acrescimo' ? 'acréscimo' : 'supressão'} de ${formatarMoeda(p.valor)}`,
                  },
                ]
              : [{ rotulo: p.tipo === 'acrescimo' ? 'Acréscimo' : 'Supressão', valor: formatarMoeda(p.valor) }]),
            ...linhasLimite(termo),
            ...(p.tipo !== 'qualitativa' && p.reformaEdificioOuEquipamento ? [{ rotulo: 'Reforma de edifício ou de equipamento', valor: 'sim (limite de 50% para acréscimos)' }] : []),
          ],
          avaliacao: { explicacao: termo.explicacao, fundamento: termo.fundamento },
        };
      }
      const agora = ctx.relogio().toISOString();
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO alteracoes_contratuais (contrato_id, especie, tipo, situacao, valor, nova_vigencia_fim, justificativa, dados, proposto_por, proposto_em, atualizado_em)
         VALUES ($1, 'aditivo', $2, 'aguardando_parecer', $3, $4, $5, $6::jsonb, $7, $8, $8) RETURNING id`,
        [contrato.id, p.tipo, valor, novaVigenciaFim, p.justificativa, JSON.stringify(dados), autor.id, agora],
      );
      if (!criada) throw new Error('Alteração não registrada');
      await auditar(tx, request, {
        acao: 'contrato.alteracao.propor',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Propôs termo aditivo de ${p.tipo === 'prazo' ? 'prazo' : p.tipo === 'qualitativa' ? 'alteração qualitativa' : p.tipo === 'reequilibrio' ? 'reequilíbrio' : p.tipo === 'acrescimo' ? 'acréscimo' : 'supressão'} ao contrato ${contrato.numero}${valor !== 0 ? ` (${formatarMoeda(Math.abs(valor))})` : ''}; segue para o parecer jurídico`,
        dados: { alteracaoId: criada.id, tipo: p.tipo, valor, novaVigenciaFim, avaliacao: dados.avaliacao ?? null },
      });
      return { contratoId: contrato.id, alteracaoId: criada.id };
    });
    reply.status(201);
    return responder(ids.contratoId, ids.alteracaoId, request);
  });

  // ───────── parecer jurídico (art. 53, § 4º) ─────────

  app.post('/contratos/:id/alteracoes/:alteracaoId/parecer', { preHandler: exigir('alteracoes:parecer') }, async (request): Promise<AlteracaoContratual> => {
    const entrada = esquemaParecer.parse(request.body);
    const autor = usuario(request);
    const ids = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (alteracao.situacao !== 'aguardando_parecer') throw conflito('Esta alteração não está aguardando parecer jurídico.');
      const situacao = entrada.resultado === 'desfavoravel' ? 'devolvido' : 'pronto_para_assinatura';
      const agora = ctx.relogio().toISOString();
      const parecer = { ...entrada, emitidoPor: autor.id, emitidoPorNome: autor.nome, emitidoEm: agora };
      await tx.executar('UPDATE alteracoes_contratuais SET situacao = $2, parecer = $3::jsonb, atualizado_em = $4 WHERE id = $1', [
        alteracao.id,
        situacao,
        JSON.stringify(parecer),
        agora,
      ]);
      await auditar(tx, request, {
        acao: 'contrato.alteracao.parecer',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou o parecer jurídico nº ${entrada.numero} (${entrada.resultado.replace(/_/g, ' ')}) sobre o termo aditivo proposto ao contrato ${contrato.numero}`,
        dados: { alteracaoId: alteracao.id, resultado: entrada.resultado, numero: entrada.numero, situacao },
      });
      return { contratoId: contrato.id, alteracaoId: alteracao.id };
    });
    return responder(ids.contratoId, ids.alteracaoId, request);
  });

  // ───────── assinatura (RN-32, RN-33, RN-09) ─────────

  /** Confere de novo as travas do tipo sobre o estado atual do contrato (sem I/O externo). */
  async function conferirTravasNaAssinatura(executor: Executor, contrato: LinhaContratoAlteracao, a: LinhaAlteracao, valorReconhecido: number | undefined) {
    const hoje = ctx.hoje();
    const d = a.dados;
    if (a.tipo === 'prazo') {
      return conferirTravasProrrogacao(
        contrato,
        {
          novaVigenciaFim: a.nova_vigencia_fim ?? '',
          natureza: d['natureza'] as never,
          vantajosidadeAtestada: d['vantajosidadeAtestada'] === true,
          precoCompativel: d['precoCompativel'] === true,
          previsaoEdital: d['previsaoEdital'] === true,
          creditoOrcamentario: d['creditoOrcamentario'] === true,
          causaAtraso: d['causaAtraso'] as never,
          moraConstituida: d['moraConstituida'] === true,
        },
        hoje,
      );
    }
    if (a.tipo === 'reequilibrio') {
      const pleiteado = Number(d['valorPleiteado'] ?? Math.abs(a.valor));
      if (valorReconhecido !== undefined && (valorReconhecido <= 0 || valorReconhecido > pleiteado)) {
        recusa('O valor reconhecido deve ser positivo e não pode passar do valor pleiteado.', 'RF-27', [`Valor pleiteado: ${formatarMoeda(pleiteado)}.`]);
      }
      const proposta = {
        tipo: 'reequilibrio' as const,
        enquadramento: d['enquadramento'] as never,
        riscoId: (d['riscoId'] as string | null) ?? null,
        dataEvento: String(d['dataEvento']),
        solicitadoEm: String(d['solicitadoEm']),
        solicitante: d['solicitante'] as never,
        sentido: d['sentido'] as 'aumento' | 'reducao',
        valor: valorReconhecido ?? pleiteado,
        demonstracao: String(d['demonstracao'] ?? ''),
        justificativa: a.justificativa,
      };
      const { avaliacao } = await avaliarPedidoReequilibrio(executor, contrato, proposta);
      const termo = avaliarProposta(contrato, proposta, proposta.valor);
      const motivos = [...termo.motivos, ...avaliacao.motivos];
      if (motivos.length > 0) recusa('O reequilíbrio não pode ser deferido.', 'RF-27', [...new Set(motivos)]);
      return { termo };
    }
    const valor = Math.abs(a.valor);
    const proposta =
      a.tipo === 'qualitativa'
        ? {
            tipo: 'qualitativa' as const,
            valor,
            efeitoFinanceiro: (d['efeitoFinanceiro'] as 'acrescimo' | 'supressao' | 'nenhum') ?? 'nenhum',
            descricaoAlteracao: String(d['descricaoAlteracao'] ?? ''),
            justificativa: a.justificativa,
          }
        : { tipo: a.tipo as 'acrescimo' | 'supressao', valor, reformaEdificioOuEquipamento: d['reformaEdificioOuEquipamento'] === true, justificativa: a.justificativa };
    const termo = avaliarProposta(contrato, proposta, valor);
    if (!termo.permitido) recusa('O termo aditivo não pode ser assinado (RN-32).', 'RN-32', termo.motivos);
    return { termo };
  }

  app.post('/contratos/:id/alteracoes/:alteracaoId/assinar', { preHandler: exigir('alteracoes:decidir') }, async (request): Promise<AlteracaoContratual> => {
    const entrada = esquemaAssinatura.parse(request.body);
    const autor = usuario(request);
    const contratoAntes = await contratoDaRota(request);
    const antes = await alteracaoDaRota(ctx.banco, contratoAntes, request);
    if (antes.situacao !== 'pronto_para_assinatura') throw conflito('Esta alteração não está pronta para assinatura (falta o parecer jurídico favorável).');
    if (antes.especie !== 'aditivo') throw conflito('Só termos aditivos passam por esta assinatura.');
    await conferirTravasNaAssinatura(ctx.banco, contratoAntes, antes, entrada.valorReconhecido);
    const verificacao = await verificarRegularidade(ctx, request, {
      fornecedorId: contratoAntes.fornecedor_id,
      momento: antes.tipo === 'prazo' ? 'prorrogacao' : 'assinatura',
      instrumento: { tipo: 'contrato', id: contratoAntes.id },
    });
    exigirRegularidade(verificacao, 'O contratado não atende à verificação de regularidade prévia à assinatura do termo aditivo (RN-09, art. 91, § 4º).');
    const consulta = verificacao.consulta ? { fonte: verificacao.consulta.fonte, consultadoEm: verificacao.consulta.consultadoEm } : null;

    const { tarefa } = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (alteracao.situacao !== 'pronto_para_assinatura') throw conflito('A alteração mudou durante a operação. Recarregue e tente de novo.');
      const travas = await conferirTravasNaAssinatura(tx, contrato, alteracao, entrada.valorReconhecido);
      const hoje = ctx.hoje();
      const agora = ctx.relogio().toISOString();
      if (alteracao.tipo === 'prazo' && 'avaliacao' in travas) {
        const r = await efetivarProrrogacao(tx, ctx, app.fila, request, {
          contratoId: contrato.id,
          novaVigenciaFim: alteracao.nova_vigencia_fim ?? '',
          valor: alteracao.valor,
          justificativa: alteracao.justificativa,
          natureza: travas.natureza,
          avaliacao: travas.avaliacao,
          travas: travas.travas,
          verificacao: { id: verificacao.id, consulta },
          alteracaoId: alteracao.id,
          dadosAto: alteracao.dados,
        });
        return { tarefa: r.tarefa };
      }
      const d = alteracao.dados;
      const efeito = d['efeitoFinanceiro'];
      const reequilibrio = alteracao.tipo === 'reequilibrio';
      const sinal = alteracao.valor < 0 ? -1 : 1;
      const valorFinal = reequilibrio && entrada.valorReconhecido !== undefined ? sinal * entrada.valorReconhecido : alteracao.valor;
      const tipoLivro: TipoLivroAditivo =
        alteracao.tipo === 'qualitativa' ? (efeito === 'acrescimo' ? 'acrescimo' : efeito === 'supressao' ? 'supressao' : 'qualitativa') : (alteracao.tipo as TipoLivroAditivo);
      const valorLivro = reequilibrio ? valorFinal : Math.abs(valorFinal);
      const numero = await proximoNumeroTermo(tx, contrato.id, 'aditivo');
      const aditivoId = await gravarNoLivro(tx, {
        contratoId: contrato.id,
        numero,
        tipo: tipoLivro,
        valor: valorLivro,
        novaVigenciaFim: null,
        assinadoEm: hoje,
        justificativa: alteracao.justificativa,
      });
      const decisao = reequilibrio
        ? {
            resultado: entrada.valorReconhecido !== undefined && entrada.valorReconhecido !== Math.abs(alteracao.valor) ? 'deferido_parcialmente' : 'deferido',
            fundamentacao: entrada.fundamentacao?.trim() || 'Reequilíbrio deferido nos termos do parecer jurídico e da demonstração apresentada.',
            decididoPor: autor.id,
            decididoPorNome: autor.nome,
            decididoEm: agora,
          }
        : null;
      const dados: DadosAlteracao = reequilibrio
        ? { ...d, valorReconhecido: Math.abs(valorFinal), detalhes: [...(d.detalhes ?? []), { rotulo: 'Valor reconhecido', valor: formatarMoeda(Math.abs(valorFinal)) }] }
        : d;
      await tx.executar(
        `UPDATE alteracoes_contratuais
            SET situacao = 'assinado', numero = $2, valor = $3, assinado_por = $4, assinado_em = $5, aditivo_id = $6,
                verificacao_regularidade_id = $7, decisao = $8::jsonb, dados = $9::jsonb, atualizado_em = $10
          WHERE id = $1`,
        [alteracao.id, numero, valorFinal, autor.id, hoje, aditivoId, verificacao.id, decisao ? JSON.stringify(decisao) : null, JSON.stringify(dados), agora],
      );
      const tarefaPncp = await solicitarDivulgacaoTermo(tx, app.fila, {
        alteracaoId: alteracao.id,
        numeroTermo: numero,
        contrato,
        solicitante: autor.id,
        modo: ctx.config.integracoes,
      });
      await auditar(tx, request, {
        acao: 'contrato.alteracao.assinar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Assinou o ${numero} do contrato ${contrato.numero}${valorFinal !== 0 ? ` (${valorFinal < 0 ? 'redução' : 'acréscimo'} de ${formatarMoeda(Math.abs(valorFinal))})` : ''} e enviou para divulgação no PNCP`,
        dados: {
          alteracaoId: alteracao.id,
          aditivoId,
          tipo: alteracao.tipo,
          valor: valorFinal,
          verificacaoId: verificacao.id,
          consultaCeisCnep: consulta,
          tarefaPncpId: tarefaPncp.id,
          percentualAcumulado: 'termo' in travas ? travas.termo.percentualAcumulado : null,
        },
      });
      return { tarefa: tarefaPncp };
    });
    await despachar(tarefa);
    return responder(contratoAntes.id, antes.id, request);
  });

  app.post('/contratos/:id/alteracoes/:alteracaoId/indeferir', { preHandler: exigir('alteracoes:decidir') }, async (request): Promise<AlteracaoContratual> => {
    const entrada = esquemaIndeferimento.parse(request.body);
    const autor = usuario(request);
    const ids = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (!['aguardando_parecer', 'pronto_para_assinatura', 'devolvido'].includes(alteracao.situacao)) throw conflito('Esta alteração não pode mais ser indeferida.');
      const agora = ctx.relogio().toISOString();
      const decisao = { resultado: 'indeferido', fundamentacao: entrada.fundamentacao, decididoPor: autor.id, decididoPorNome: autor.nome, decididoEm: agora };
      await tx.executar(`UPDATE alteracoes_contratuais SET situacao = 'indeferido', decisao = $2::jsonb, atualizado_em = $3 WHERE id = $1`, [
        alteracao.id,
        JSON.stringify(decisao),
        agora,
      ]);
      await auditar(tx, request, {
        acao: 'contrato.alteracao.indeferir',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Indeferiu a alteração proposta ao contrato ${contrato.numero} (${alteracao.tipo})`,
        dados: { alteracaoId: alteracao.id, tipo: alteracao.tipo, fundamentacao: entrada.fundamentacao },
      });
      return { contratoId: contrato.id, alteracaoId: alteracao.id };
    });
    return responder(ids.contratoId, ids.alteracaoId, request);
  });

  // ───────── reajuste e repactuação por apostila (art. 136, I) ─────────

  async function registrarApostila(
    tx: Transacao,
    request: FastifyRequest,
    contrato: LinhaContratoAlteracao,
    e: { tipo: 'reajuste' | 'repactuacao'; valor: number; justificativa: string; dados: DadosAlteracao },
  ): Promise<{ alteracaoId: string; numero: string; tarefa: LinhaTarefa; aditivoId: string }> {
    const autor = usuario(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio().toISOString();
    const numero = await proximoNumeroTermo(tx, contrato.id, 'apostila');
    const aditivoId = await gravarNoLivro(tx, {
      contratoId: contrato.id,
      numero,
      tipo: 'reajuste',
      valor: e.valor,
      novaVigenciaFim: null,
      assinadoEm: hoje,
      justificativa: e.justificativa,
    });
    const [criada] = await tx.consultar<{ id: string }>(
      `INSERT INTO alteracoes_contratuais (contrato_id, especie, tipo, situacao, numero, valor, justificativa, dados, aditivo_id, proposto_por, proposto_em,
                                           assinado_por, assinado_em, atualizado_em)
       VALUES ($1, 'apostila', $2, 'assinado', $3, $4, $5, $6::jsonb, $7, $8, $9, $8, $10, $9) RETURNING id`,
      [contrato.id, e.tipo, numero, e.valor, e.justificativa, JSON.stringify(e.dados), aditivoId, autor.id, agora, hoje],
    );
    if (!criada) throw new Error('Apostila não registrada');
    const tarefa = await solicitarDivulgacaoTermo(tx, app.fila, { alteracaoId: criada.id, numeroTermo: numero, contrato, solicitante: autor.id, modo: ctx.config.integracoes });
    return { alteracaoId: criada.id, numero, tarefa, aditivoId };
  }

  app.post('/contratos/:id/reajustes', { preHandler: exigir('alteracoes:decidir') }, async (request, reply): Promise<AlteracaoContratual> => {
    const entrada = esquemaReajuste.parse(request.body);
    const r = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const ciclos = await ciclosReajusteAplicados(tx, contrato.id);
      const saldo = Math.max(0, contrato.valor_global - contrato.valor_pago);
      const avaliacao = avaliarReajuste({
        dataBase: contrato.data_base_reajuste,
        ciclosAplicados: ciclos,
        hoje: ctx.hoje(),
        percentual: entrada.percentual,
        saldoContratual: saldo,
        indice: contrato.indice_reajuste,
        vigenciaFim: contrato.vigencia_fim,
        contratoExtinto: contrato.extinto_em !== null,
      });
      if (!avaliacao.permitido) recusa('O reajuste foi recusado.', 'RF-27', avaliacao.motivos);
      const apostila = await registrarApostila(tx, request, contrato, {
        tipo: 'reajuste',
        valor: avaliacao.valor,
        justificativa: `Reajuste anual pelo ${contrato.indice_reajuste} (${percentualTexto(entrada.percentual)}), após o interregno de 12 meses contado da data do orçamento estimado.`,
        dados: {
          percentual: entrada.percentual,
          indice: contrato.indice_reajuste,
          fonteIndice: entrada.fonteIndice,
          observacao: entrada.observacao ?? null,
          periodo: avaliacao.periodo,
          saldoContratual: saldo,
          detalhes: [
            { rotulo: 'Índice', valor: contrato.indice_reajuste },
            { rotulo: 'Período', valor: `${formatarData(avaliacao.periodo.inicio)} a ${formatarData(avaliacao.periodo.fim)}` },
            { rotulo: 'Variação do índice', valor: `${percentualTexto(entrada.percentual)} — ${entrada.fonteIndice}` },
            { rotulo: 'Saldo reajustado', valor: formatarMoeda(saldo) },
            { rotulo: 'Data-base (orçamento estimado)', valor: formatarData(contrato.data_base_reajuste) },
          ],
          avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
        },
      });
      await tx.executar(
        `INSERT INTO reajustes_ciclos (instrumento_tipo, instrumento_id, inicio, fim, percentual, aplicado_em) VALUES ('contrato', $1, $2, $3, $4, $5)`,
        [contrato.id, avaliacao.periodo.inicio, avaliacao.periodo.fim, entrada.percentual, ctx.hoje()],
      );
      await auditar(tx, request, {
        acao: 'contrato.reajustar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou o ${apostila.numero} do contrato ${contrato.numero}: reajuste de ${percentualTexto(entrada.percentual)} pelo ${contrato.indice_reajuste} (${formatarMoeda(avaliacao.valor)})`,
        dados: {
          alteracaoId: apostila.alteracaoId,
          aditivoId: apostila.aditivoId,
          percentual: entrada.percentual,
          fonteIndice: entrada.fonteIndice,
          periodo: avaliacao.periodo,
          valor: avaliacao.valor,
          tarefaPncpId: apostila.tarefa.id,
        },
      });
      return { contratoId: contrato.id, ...apostila };
    });
    await despachar(r.tarefa);
    reply.status(201);
    return responder(r.contratoId, r.alteracaoId, request);
  });

  app.post('/contratos/:id/repactuacoes', { preHandler: exigir('alteracoes:decidir') }, async (request, reply): Promise<AlteracaoContratual> => {
    const entrada = esquemaRepactuacao.parse(request.body);
    const r = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const regime = contrato.regime_mao_obra ?? entrada.regimeMaoDeObra ?? null;
      const avaliacao = avaliarRepactuacao({
        regimeMaoDeObra: regime,
        natureza: contrato.natureza_duracao,
        solicitadaEm: entrada.solicitadaEm,
        efeitosDesde: entrada.efeitosDesde,
        vigenciaFim: contrato.vigencia_fim,
        hoje: ctx.hoje(),
        componentes: entrada.componentes,
        clausulasNaoTrabalhistasExcluidas: entrada.clausulasNaoTrabalhistasExcluidas,
        contratoExtinto: contrato.extinto_em !== null,
      });
      if (!avaliacao.permitido) recusa('A repactuação foi recusada.', 'RF-27', avaliacao.motivos);
      if (contrato.regime_mao_obra === null && regime !== null) {
        await tx.executar('UPDATE contratos SET regime_mao_obra = $2 WHERE id = $1', [contrato.id, regime]);
      }
      const apostila = await registrarApostila(tx, request, contrato, {
        tipo: 'repactuacao',
        valor: avaliacao.valor,
        justificativa: entrada.justificativa,
        dados: {
          solicitadaEm: entrada.solicitadaEm,
          efeitosDesde: entrada.efeitosDesde,
          componentes: avaliacao.componentes,
          variacaoMensal: avaliacao.variacaoMensal,
          mesesRemanescentes: avaliacao.mesesRemanescentes,
          detalhes: [
            { rotulo: 'Pedido do contratado', valor: formatarData(entrada.solicitadaEm) },
            ...avaliacao.componentes.map((c) => ({
              rotulo: `${c.origem === 'mao_de_obra' ? 'Mão de obra' : 'Insumos'}: ${c.descricao}`,
              valor: `${formatarMoeda(c.valorMensalAnterior)} → ${formatarMoeda(c.valorMensalNovo)} por mês (${percentualTexto(c.percentual)}); ${c.documento}; anualidade em ${formatarData(c.anualidade)}`,
            })),
            { rotulo: 'Variação mensal', valor: formatarMoeda(avaliacao.variacaoMensal) },
            { rotulo: 'Efeitos', valor: `de ${formatarData(entrada.efeitosDesde)} até o fim da vigência (${avaliacao.mesesRemanescentes} meses)` },
          ],
          avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
        },
      });
      await auditar(tx, request, {
        acao: 'contrato.repactuar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Registrou o ${apostila.numero} do contrato ${contrato.numero}: repactuação de ${formatarMoeda(avaliacao.valor)} (${avaliacao.componentes.length} componente(s))`,
        dados: { alteracaoId: apostila.alteracaoId, aditivoId: apostila.aditivoId, variacaoMensal: avaliacao.variacaoMensal, valor: avaliacao.valor, tarefaPncpId: apostila.tarefa.id },
      });
      return { contratoId: contrato.id, ...apostila };
    });
    await despachar(r.tarefa);
    reply.status(201);
    return responder(r.contratoId, r.alteracaoId, request);
  });

  // ───────── extinção (arts. 137 a 139) ─────────

  app.post('/contratos/:id/extincao', { preHandler: exigir('contratos:editar') }, async (request, reply): Promise<AlteracaoContratual> => {
    const entrada = esquemaExtincao.parse(request.body);
    const autor = usuario(request);
    const ids = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const [aberta] = await tx.consultar<{ id: string }>(
        `SELECT id FROM alteracoes_contratuais WHERE contrato_id = $1 AND tipo = 'extincao' AND situacao IN ('em_contraditorio', 'aguardando_decisao', 'assinado')`,
        [contrato.id],
      );
      if (aberta) throw conflito('Já há um processo de extinção aberto ou concluído para este contrato.');
      const avaliacao = avaliarInstauracaoExtincao({ ...entrada, contratoExtinto: contrato.extinto_em !== null });
      if (!avaliacao.permitido) recusa('A extinção não pode ser aberta.', 'RF-27', avaliacao.motivos);
      const hoje = ctx.hoje();
      const agora = ctx.relogio().toISOString();
      const motivoTexto = MOTIVOS_EXTINCAO[entrada.motivo];
      let contraditorio: Record<string, unknown> | null = null;
      let notificacao: { notificacaoId: string | null; falha: string | null } | null = null;
      if (avaliacao.exigeContraditorio) {
        const prazo = entrada.prazoDefesaDiasUteis ?? 0;
        const prazoFim = adicionarDiasUteis(hoje, prazo, await opcoesCalendario(tx));
        notificacao = await notificarContraditorio(tx, ctx, { contratoId: contrato.id, prazoFim, prazoDiasUteis: prazo, motivo: motivoTexto, usuarioId: autor.id });
        contraditorio = { prazoDiasUteis: prazo, prazoFim, notificadoEm: agora, notificacaoId: notificacao.notificacaoId, defesa: null, semManifestacao: false };
      }
      const dados: DadosAlteracao = {
        forma: entrada.forma,
        motivo: entrada.motivo,
        interesseAdministracao: entrada.interesseAdministracao ?? null,
        referenciaDecisao: entrada.referenciaDecisao ?? null,
        notificacaoFalha: notificacao?.falha ?? null,
        detalhes: [
          { rotulo: 'Forma', valor: ROTULO_FORMA[entrada.forma] ?? entrada.forma },
          { rotulo: 'Motivo', valor: motivoTexto },
          ...(entrada.referenciaDecisao ? [{ rotulo: 'Decisão judicial ou arbitral', valor: entrada.referenciaDecisao }] : []),
          ...(notificacao?.falha ? [{ rotulo: 'Notificação', valor: `não enviada pela central: ${notificacao.falha}` }] : []),
        ],
        avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
      };
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO alteracoes_contratuais (contrato_id, especie, tipo, situacao, justificativa, dados, contraditorio, proposto_por, proposto_em, atualizado_em)
         VALUES ($1, 'rescisao', 'extincao', $2, $3, $4::jsonb, $5::jsonb, $6, $7, $7) RETURNING id`,
        [
          contrato.id,
          avaliacao.exigeContraditorio ? 'em_contraditorio' : 'aguardando_decisao',
          entrada.fundamentacao,
          JSON.stringify(dados),
          contraditorio ? JSON.stringify(contraditorio) : null,
          autor.id,
          agora,
        ],
      );
      if (!criada) throw new Error('Extinção não registrada');
      await auditar(tx, request, {
        acao: 'contrato.extincao.instaurar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Abriu o processo de extinção do contrato ${contrato.numero} (${entrada.forma === 'unilateral' ? `unilateral, defesa até ${formatarData(String(contraditorio?.['prazoFim'] ?? hoje))}` : entrada.forma === 'consensual' ? 'consensual' : 'judicial ou arbitral'})`,
        dados: { alteracaoId: criada.id, forma: entrada.forma, motivo: entrada.motivo, contraditorio, notificacaoId: notificacao?.notificacaoId ?? null },
      });
      return { contratoId: contrato.id, alteracaoId: criada.id };
    });
    reply.status(201);
    return responder(ids.contratoId, ids.alteracaoId, request);
  });

  app.post('/contratos/:id/alteracoes/:alteracaoId/defesa', { preHandler: exigir('contratos:editar') }, async (request): Promise<AlteracaoContratual> => {
    const entrada = esquemaDefesa.parse(request.body);
    const ids = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (alteracao.situacao !== 'em_contraditorio' || !alteracao.contraditorio) throw conflito('A extinção não está na fase de defesa.');
      const hoje = ctx.hoje();
      const c = alteracao.contraditorio;
      if (entrada.semManifestacao === true) {
        if (hoje <= c.prazoFim) recusa('O prazo de defesa ainda não terminou.', 'RF-27', [`O contratado pode apresentar defesa até ${formatarData(c.prazoFim)}.`]);
      } else if ('apresentadaEm' in entrada && entrada.apresentadaEm > hoje) {
        recusa('A data da defesa não pode ser futura.', 'RF-27', ['Informe a data em que a defesa foi protocolada.']);
      }
      const atualizado = {
        ...c,
        defesa: 'apresentadaEm' in entrada ? { apresentadaEm: entrada.apresentadaEm, resumo: entrada.resumo } : null,
        semManifestacao: entrada.semManifestacao === true,
      };
      const agora = ctx.relogio().toISOString();
      await tx.executar(`UPDATE alteracoes_contratuais SET situacao = 'aguardando_decisao', contraditorio = $2::jsonb, atualizado_em = $3 WHERE id = $1`, [
        alteracao.id,
        JSON.stringify(atualizado),
        agora,
      ]);
      await auditar(tx, request, {
        acao: 'contrato.extincao.defesa',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: atualizado.semManifestacao
          ? `Registrou que o contratado não apresentou defesa no prazo da extinção do contrato ${contrato.numero}`
          : `Registrou a defesa do contratado na extinção do contrato ${contrato.numero}`,
        dados: { alteracaoId: alteracao.id, semManifestacao: atualizado.semManifestacao, apresentadaEm: atualizado.defesa?.apresentadaEm ?? null },
      });
      return { contratoId: contrato.id, alteracaoId: alteracao.id };
    });
    return responder(ids.contratoId, ids.alteracaoId, request);
  });

  app.post('/contratos/:id/alteracoes/:alteracaoId/decidir-extincao', { preHandler: exigir('alteracoes:decidir') }, async (request): Promise<AlteracaoContratual> => {
    const entrada = esquemaDecisaoExtincao.parse(request.body);
    const autor = usuario(request);
    const r = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx, true);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (alteracao.tipo !== 'extincao' || !['em_contraditorio', 'aguardando_decisao'].includes(alteracao.situacao)) {
        throw conflito('Este processo de extinção não está aguardando decisão.');
      }
      const hoje = ctx.hoje();
      const forma = String(alteracao.dados['forma']) as 'unilateral' | 'consensual' | 'judicial_arbitral';
      const c = alteracao.contraditorio;
      const avaliacao = avaliarDecisaoExtincao({
        forma,
        decisao: entrada.decisao,
        instauradaEm: hojeISO(new Date(alteracao.proposto_em)),
        hoje,
        vigenciaFim: contrato.vigencia_fim,
        dataEfeitos: entrada.dataEfeitos,
        fundamentacao: entrada.fundamentacao,
        prazoDefesaFim: c?.prazoFim ?? null,
        defesaRegistrada: c !== null && (c.defesa !== null || c.semManifestacao),
        culpaAdministracao: entrada.culpaAdministracao,
        efeitos: entrada.efeitos,
        ...(entrada.autorizacaoMinistro === undefined ? {} : { autorizacaoMinistro: entrada.autorizacaoMinistro }),
      });
      if (!avaliacao.permitido) recusa('A decisão sobre a extinção foi recusada.', 'RF-27', avaliacao.motivos);
      const agora = ctx.relogio().toISOString();
      const decisao = {
        resultado: entrada.decisao === 'extinguir' ? 'extinto' : 'arquivado',
        fundamentacao: entrada.fundamentacao,
        decididoPor: autor.id,
        decididoPorNome: autor.nome,
        decididoEm: agora,
      };
      const dados: DadosAlteracao = {
        ...alteracao.dados,
        dataEfeitos: entrada.dataEfeitos,
        culpaAdministracao: entrada.culpaAdministracao,
        efeitos: avaliacao.efeitos,
        detalhes: [
          ...(alteracao.dados.detalhes ?? []),
          ...(entrada.decisao === 'extinguir'
            ? [
                { rotulo: 'Efeitos a partir de', valor: formatarData(entrada.dataEfeitos) },
                ...(entrada.culpaAdministracao ? [{ rotulo: 'Culpa da Administração', valor: 'sim (art. 138, § 2º)' }] : []),
                ...avaliacao.efeitos.map((e) => ({ rotulo: 'Efeito', valor: e.descricao })),
              ]
            : []),
        ],
        avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
      };
      if (entrada.decisao === 'arquivar') {
        await tx.executar(`UPDATE alteracoes_contratuais SET situacao = 'arquivado', decisao = $2::jsonb, dados = $3::jsonb, atualizado_em = $4 WHERE id = $1`, [
          alteracao.id,
          JSON.stringify(decisao),
          JSON.stringify(dados),
          agora,
        ]);
        await auditar(tx, request, {
          acao: 'contrato.extincao.arquivar',
          recurso: 'contrato',
          recursoId: contrato.id,
          resumo: `Arquivou o processo de extinção do contrato ${contrato.numero}: o contrato segue vigente`,
          dados: { alteracaoId: alteracao.id, fundamentacao: entrada.fundamentacao },
        });
        return { contratoId: contrato.id, alteracaoId: alteracao.id, tarefa: null };
      }
      const numero = await proximoNumeroTermo(tx, contrato.id, 'rescisao');
      await tx.executar(
        `UPDATE contratos
            SET extinto_em = $2,
                vigencia_fim = LEAST(vigencia_fim, GREATEST(vigencia_inicio, $2::date)),
                campos_editados = CASE WHEN 'vigencia_fim' = ANY(campos_editados) THEN campos_editados ELSE array_append(campos_editados, 'vigencia_fim') END,
                atualizado_em = $3
          WHERE id = $1`,
        [contrato.id, entrada.dataEfeitos, agora],
      );
      const arquivadas = await tx.executar(
        `UPDATE alteracoes_contratuais SET situacao = 'arquivado', atualizado_em = $2
          WHERE contrato_id = $1 AND situacao IN ('aguardando_parecer', 'pronto_para_assinatura', 'devolvido')`,
        [contrato.id, agora],
      );
      await tx.executar(
        `UPDATE alteracoes_contratuais
            SET situacao = 'assinado', numero = $2, assinado_por = $3, assinado_em = $4, decisao = $5::jsonb, dados = $6::jsonb, atualizado_em = $7
          WHERE id = $1`,
        [alteracao.id, numero, autor.id, hoje, JSON.stringify(decisao), JSON.stringify(dados), agora],
      );
      const tarefa = await solicitarDivulgacaoTermo(tx, app.fila, { alteracaoId: alteracao.id, numeroTermo: numero, contrato, solicitante: autor.id, modo: ctx.config.integracoes });
      await auditar(tx, request, {
        acao: 'contrato.extinguir',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Decidiu a extinção do contrato ${contrato.numero} com efeitos a partir de ${formatarData(entrada.dataEfeitos)} e registrou o ${numero}`,
        dados: {
          alteracaoId: alteracao.id,
          forma,
          dataEfeitos: entrada.dataEfeitos,
          vigenciaFim: { de: contrato.vigencia_fim, para: entrada.dataEfeitos < contrato.vigencia_fim ? entrada.dataEfeitos : contrato.vigencia_fim },
          culpaAdministracao: entrada.culpaAdministracao,
          efeitos: entrada.efeitos,
          alteracoesArquivadas: arquivadas,
          tarefaPncpId: tarefa.id,
        },
      });
      return { contratoId: contrato.id, alteracaoId: alteracao.id, tarefa };
    });
    await despachar(r.tarefa);
    return responder(r.contratoId, r.alteracaoId, request);
  });

  // ───────── termo em PDF e divulgação no PNCP ─────────

  app.get('/contratos/:id/alteracoes/:alteracaoId/termo.pdf', { preHandler: exigir('contratos:ler') }, async (request, reply) => {
    const contrato = await contratoDaRota(request);
    const linha = await alteracaoDaRota(ctx.banco, contrato, request);
    if (linha.situacao !== 'assinado' || !linha.numero) throw naoEncontrado('O termo só existe depois da assinatura.');
    const alteracao = mapearAlteracao(linha, contrato, ctx.hoje(), await opcoesCalendario(ctx.banco));
    const titulo = `${linha.numero} — contrato ${contrato.numero}`;
    const pdf = gerarPdfTexto({ titulo, rodape: `${titulo} — Lei 14.133/2021`, conteudo: textoTermo(alteracao, contrato) });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="termo-${linha.id.slice(0, 8)}.pdf"`)
      .send(pdf);
  });

  app.post('/contratos/:id/alteracoes/:alteracaoId/divulgar-pncp', { preHandler: exigir('alteracoes:decidir') }, async (request): Promise<AlteracaoContratual> => {
    const r = await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoDaRota(request, tx);
      const alteracao = await alteracaoDaRota(tx, contrato, request, true);
      if (alteracao.situacao !== 'assinado' || !alteracao.numero) throw conflito('Só o termo assinado é divulgado no PNCP.');
      const agora = ctx.relogio();
      let tarefa: LinhaTarefa | null = null;
      if (alteracao.divulgacao_tarefa_id === null) {
        tarefa = await solicitarDivulgacaoTermo(tx, app.fila, {
          alteracaoId: alteracao.id,
          numeroTermo: alteracao.numero,
          contrato,
          solicitante: usuario(request).id,
          modo: ctx.config.integracoes,
        });
      } else {
        tarefa = await reabrir(tx, alteracao.divulgacao_tarefa_id, agora);
        if (!tarefa) throw conflito('A divulgação deste termo não está na fila de erro.');
      }
      await auditar(tx, request, {
        acao: 'contrato.alteracao.divulgar_pncp',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Reenviou o ${alteracao.numero} do contrato ${contrato.numero} para divulgação no PNCP`,
        dados: { alteracaoId: alteracao.id, tarefaId: tarefa.id },
      });
      return { contratoId: contrato.id, alteracaoId: alteracao.id, tarefa };
    });
    await despachar(r.tarefa);
    return responder(r.contratoId, r.alteracaoId, request);
  });
}
