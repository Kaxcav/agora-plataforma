/**
 * Serviço das alterações contratuais (F22a): grava os atos assinados no livro de aditivos, efetiva a prorrogação
 * (compartilhado com a rota de prorrogação da frente C), pede a divulgação dos termos no PNCP pela fila de
 * integrações (frente B), notifica o contratado pela central de notificações (frente J) e monta o texto do termo em PDF.
 */
import {
  adicionarDias,
  chaveIdempotencia,
  formatarData,
  formatarMoeda,
  mascararDocumento,
  mascararNome,
  type AvaliacaoProrrogacao,
} from '@agora/dominio';
import type { AlteracaoContratual } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import type { Transacao } from '../../banco/tipos.ts';
import type { ServicoFila } from '../../fila/servico.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { conflito, ErroApi, naoEncontrado } from '../../http/erros.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { notificarContratada } from '../execucao/avisos.ts';
import { carregarInstrumento, criarNotificacaoManual, ErroDisparo } from '../notificacoes/servico.ts';
import { proximoNumeroTermo, type DadosAlteracao, type LinhaContratoAlteracao } from './repositorio.ts';

export type TipoLivroAditivo = 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste' | 'qualitativa' | 'reequilibrio';

/** Grava o termo assinado no livro de aditivos (base de vw_contratos_valores). O valor do livro é sempre positivo, salvo reequilíbrio e reajuste. */
export async function gravarNoLivro(
  tx: Transacao,
  e: { contratoId: string; numero: string; tipo: TipoLivroAditivo; valor: number; novaVigenciaFim: string | null; assinadoEm: string; justificativa: string },
): Promise<string> {
  const [criado] = await tx.consultar<{ id: string }>(
    `INSERT INTO aditivos (contrato_id, numero, tipo, valor, nova_vigencia_fim, assinado_em, justificativa)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [e.contratoId, e.numero, e.tipo, e.valor, e.novaVigenciaFim, e.assinadoEm, e.justificativa],
  );
  if (!criado) throw new Error('Termo não registrado no livro de aditivos');
  return criado.id;
}

/**
 * Pede a divulgação do termo no PNCP (art. 94 para o aditivo; art. 174 para apostila e rescisão), pela fila de
 * integrações, na transação da assinatura. Idempotente pela chave `pncp:termo:<alteração>`.
 */
export async function solicitarDivulgacaoTermo(
  tx: Transacao,
  fila: ServicoFila,
  e: { alteracaoId: string; numeroTermo: string; contrato: Pick<LinhaContratoAlteracao, 'id' | 'numero' | 'uasg'>; solicitante: string | null; modo: 'offline' | 'online' },
): Promise<LinhaTarefa> {
  const { tarefa } = await fila.enfileirar(tx, {
    tipo: 'pncp.termo',
    chave: chaveIdempotencia(['pncp', 'termo', e.alteracaoId]),
    descricao: `Divulgar no PNCP o ${e.numeroTermo} do contrato ${e.contrato.numero}`,
    carga: { alteracaoId: e.alteracaoId },
    uasg: e.contrato.uasg,
    recurso: { tipo: 'contrato', id: e.contrato.id },
    solicitadaPor: e.solicitante,
  });
  await tx.executar('UPDATE alteracoes_contratuais SET divulgacao_tarefa_id = $2, divulgacao_modo = $3 WHERE id = $1', [e.alteracaoId, tarefa.id, e.modo]);
  return tarefa;
}

export interface EntradaEfetivarProrrogacao {
  contratoId: string;
  novaVigenciaFim: string;
  valor: number;
  justificativa: string;
  natureza: string;
  avaliacao: AvaliacaoProrrogacao;
  /** Respostas das travas da RN-33 (vantajosidade, preço, edital, crédito, causa do atraso). */
  travas: Record<string, unknown>;
  verificacao: { id: string; consulta: { fonte: string; consultadoEm: string } | null };
  /** Ato já proposto na aba Alterações (fluxo com parecer); sem ele, a prorrogação é registrada diretamente. */
  alteracaoId?: string;
  dadosAto?: DadosAlteracao;
}

/**
 * Efetiva a prorrogação na transação: grava o termo aditivo de prazo no livro, atualiza a vigência (e a natureza do
 * contrato), registra o ato na aba Alterações e pede a divulgação no PNCP. Usada pela rota de prorrogação (frente C)
 * e pela assinatura do termo aditivo de prazo. As travas (RN-33 e RN-09) são conferidas antes pelo chamador.
 */
export async function efetivarProrrogacao(
  tx: Transacao,
  ctx: ContextoApp,
  fila: ServicoFila,
  request: FastifyRequest,
  e: EntradaEfetivarProrrogacao,
): Promise<{ aditivoId: string; numero: string; alteracaoId: string; tarefa: LinhaTarefa; vigenciaAnterior: string }> {
  const [atual] = await tx.consultar<{ id: string; numero: string; uasg: string; vigencia_fim: string }>(
    'SELECT id, numero, uasg, vigencia_fim FROM contratos WHERE id = $1 FOR UPDATE',
    [e.contratoId],
  );
  if (!atual) throw naoEncontrado('Contrato não encontrado.');
  if (e.novaVigenciaFim <= atual.vigencia_fim) throw conflito('A vigência do contrato mudou durante a operação. Recarregue e tente de novo.');
  const hoje = ctx.hoje();
  const agora = ctx.relogio().toISOString();
  const usuarioId = request.sessao?.usuario.id ?? null;
  const numero = await proximoNumeroTermo(tx, atual.id, 'aditivo');
  const aditivoId = await gravarNoLivro(tx, {
    contratoId: atual.id,
    numero,
    tipo: 'prorrogacao',
    valor: e.valor,
    novaVigenciaFim: e.novaVigenciaFim,
    assinadoEm: hoje,
    justificativa: e.justificativa,
  });
  await tx.executar(
    `UPDATE contratos
        SET vigencia_fim = $2,
            natureza_duracao = COALESCE(natureza_duracao, $4),
            campos_editados = CASE WHEN 'vigencia_fim' = ANY(campos_editados) THEN campos_editados ELSE array_append(campos_editados, 'vigencia_fim') END,
            atualizado_em = $3
      WHERE id = $1`,
    [atual.id, e.novaVigenciaFim, agora, e.natureza],
  );
  const detalhes = [
    { rotulo: 'Vigência', valor: `de ${formatarData(atual.vigencia_fim)} para ${formatarData(e.novaVigenciaFim)}` },
    { rotulo: 'Vigência máxima', valor: e.avaliacao.limiteVigencia ? formatarData(e.avaliacao.limiteVigencia) : 'sem teto legal (escopo)' },
    ...(e.avaliacao.prorrogacaoAutomatica ? [{ rotulo: 'Prorrogação', valor: 'automática, sem culpa do contratado (art. 111)' }] : []),
  ];
  const dados: DadosAlteracao = {
    ...(e.dadosAto ?? {}),
    ...e.travas,
    natureza: e.natureza,
    vigenciaAnterior: atual.vigencia_fim,
    detalhes: e.dadosAto?.detalhes ?? detalhes,
    avaliacao: { explicacao: e.avaliacao.explicacao, fundamento: e.avaliacao.fundamento },
  };
  let alteracaoId = e.alteracaoId;
  if (alteracaoId) {
    await tx.executar(
      `UPDATE alteracoes_contratuais
          SET situacao = 'assinado', numero = $2, assinado_por = $3, assinado_em = $4, aditivo_id = $5, verificacao_regularidade_id = $6,
              dados = $7::jsonb, atualizado_em = $8
        WHERE id = $1`,
      [alteracaoId, numero, usuarioId, hoje, aditivoId, e.verificacao.id, JSON.stringify(dados), agora],
    );
  } else {
    const [criada] = await tx.consultar<{ id: string }>(
      `INSERT INTO alteracoes_contratuais (contrato_id, especie, tipo, situacao, numero, valor, nova_vigencia_fim, justificativa, dados,
                                           aditivo_id, verificacao_regularidade_id, proposto_por, proposto_em, assinado_por, assinado_em, atualizado_em)
       VALUES ($1, 'aditivo', 'prazo', 'assinado', $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $9, $11, $10) RETURNING id`,
      [atual.id, numero, e.valor, e.novaVigenciaFim, e.justificativa, JSON.stringify(dados), aditivoId, e.verificacao.id, usuarioId, agora, hoje],
    );
    if (!criada) throw new Error('Prorrogação não registrada');
    alteracaoId = criada.id;
  }
  const tarefa = await solicitarDivulgacaoTermo(tx, fila, {
    alteracaoId,
    numeroTermo: numero,
    contrato: atual,
    solicitante: usuarioId,
    modo: ctx.config.integracoes,
  });
  // Prorrogação assinada (frente K): exige ou abre a renovação da garantia (frente L)
  // com prazo, pendência e aviso pela central de notificações.
  const garantiasAtivas = await tx.consultar<{
    id: string;
    valida_ate: string | null;
  }>(
    // Só a garantia já apresentada e sem renovação em aberto: a que ainda será apresentada já nasce com a nova vigência.
    `SELECT g.id, g.valida_ate
       FROM contratos_garantias g
      WHERE g.contrato_id = $1 AND g.finalidade = 'execucao' AND g.situacao = 'vigente'
        AND NOT EXISTS (SELECT 1 FROM pendencias p WHERE p.id = g.pendencia_id AND p.situacao = 'aberta')
      ORDER BY g.registrada_em DESC`,
    [atual.id],
  );

  for (const g of garantiasAtivas) {
    if (!g.valida_ate || g.valida_ate < e.novaVigenciaFim) {
      const prazoRenovacao = adicionarDias(hoje, 15) > e.novaVigenciaFim ? e.novaVigenciaFim : adicionarDias(hoje, 15);
      await tx.executar(
        `INSERT INTO garantias_movimentos (garantia_id, tipo, data, valor, descricao, registrado_por, registrado_em)
         VALUES ($1, 'exigencia', $2, NULL, $3, $4, $5)`,
        [
          g.id,
          hoje,
          `Renovação exigida pela prorrogação da vigência (${numero}) até ${formatarData(e.novaVigenciaFim)} (art. 96). Prazo: ${formatarData(prazoRenovacao)}.`,
          usuarioId,
          agora,
        ],
      );
      const motivoPendencia = `Renovação da garantia de execução do contrato ${atual.numero}: vigência prorrogada até ${formatarData(e.novaVigenciaFim)}. Prazo para renovação: ${formatarData(prazoRenovacao)}.`;
      const [pendencia] = await tx.consultar<{ id: string }>(
        `INSERT INTO pendencias (tipo, prioridade, instrumento_tipo, instrumento_id, uasg, motivo, prazo, responsavel_id, busca_normalizada)
         VALUES ('garantia', 'alta', 'contrato', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [atual.id, atual.uasg, motivoPendencia, prazoRenovacao, usuarioId, normalizarBusca(motivoPendencia, atual.numero)],
      );
      if (pendencia) {
        await tx.executar('UPDATE contratos_garantias SET pendencia_id = $2 WHERE id = $1', [g.id, pendencia.id]);
      }
      try {
        await notificarContratada(tx, ctx, request, {
          contratoId: atual.id,
          tipo: 'pendencia',
          detalhe: motivoPendencia,
          dataReferencia: prazoRenovacao,
          complemento: 'Providencie a renovação da garantia junto à instituição garantidora para cobrir a nova vigência prorrogada.',
        });
      } catch (erro) {
        // Sem destinatário válido, a prorrogação segue e a pendência continua registrada; outro erro não é engolido.
        if (!(erro instanceof ErroApi)) throw erro;
      }
    }
  }

  await auditar(tx, request, {
    acao: 'contrato.prorrogar',
    recurso: 'contrato',
    recursoId: atual.id,
    resumo: `Registrou o ${numero} (prorrogação) do contrato ${atual.numero}: vigência até ${formatarData(e.novaVigenciaFim)}${e.valor > 0 ? `, ${formatarMoeda(e.valor)}` : ''}`,
    dados: {
      aditivoId,
      alteracaoId,
      vigenciaFim: { de: atual.vigencia_fim, para: e.novaVigenciaFim },
      valor: e.valor,
      natureza: e.natureza,
      limiteVigencia: e.avaliacao.limiteVigencia,
      prorrogacaoAutomatica: e.avaliacao.prorrogacaoAutomatica,
      travas: e.travas,
      verificacaoId: e.verificacao.id,
      consultaCeisCnep: e.verificacao.consulta,
      tarefaPncpId: tarefa.id,
    },
  });
  return { aditivoId, numero, alteracaoId, tarefa, vigenciaAnterior: atual.vigencia_fim };
}

/**
 * Notifica o contratado da abertura do processo de extinção, com o prazo de defesa, pela central de notificações
 * (e-mail e registro no processo SEI). Sem destinatário válido, o processo segue e a falta fica registrada.
 */
export async function notificarContraditorio(
  tx: Transacao,
  ctx: ContextoApp,
  e: { contratoId: string; prazoFim: string; prazoDiasUteis: number; motivo: string; usuarioId: string },
): Promise<{ notificacaoId: string | null; falha: string | null }> {
  const instrumento = await carregarInstrumento(tx, 'contrato', e.contratoId, null);
  if (!instrumento) return { notificacaoId: null, falha: 'Contrato não encontrado para a notificação.' };
  try {
    const gravada = await criarNotificacaoManual(
      tx,
      ctx.config,
      ctx.relogio(),
      ctx.hoje(),
      instrumento,
      {
        tipo: 'ocorrencia',
        destinatarios: ['contratada'],
        canais: ['email', 'sei'],
        dataReferencia: e.prazoFim,
        detalhe: `Abertura de processo de extinção do contrato (arts. 137 e 138 da Lei 14.133/2021). Motivo: ${e.motivo}. Apresente defesa escrita em até ${e.prazoDiasUteis} dias úteis, até ${formatarData(e.prazoFim)} (contraditório e ampla defesa).`,
        complemento: null,
      },
      e.usuarioId,
    );
    return { notificacaoId: gravada.id, falha: null };
  } catch (erro) {
    if (erro instanceof ErroDisparo) return { notificacaoId: null, falha: erro.message };
    throw erro;
  }
}

const ROTULO_ESPECIE: Record<AlteracaoContratual['especie'], string> = {
  aditivo: 'Termo aditivo',
  apostila: 'Termo de apostilamento',
  rescisao: 'Termo de rescisão',
};

const ROTULO_TIPO: Record<AlteracaoContratual['tipo'], string> = {
  acrescimo: 'acréscimo quantitativo (art. 124, I, "b", e art. 125)',
  supressao: 'supressão quantitativa (art. 124, I, "b", e art. 125)',
  qualitativa: 'alteração qualitativa (art. 124, I, "a")',
  prazo: 'prorrogação da vigência (arts. 105 a 107 e 111)',
  reequilibrio: 'restabelecimento do equilíbrio econômico-financeiro (art. 124, II, "d")',
  reajuste: 'reajuste em sentido estrito (art. 25, § 7º, e art. 136, I)',
  repactuacao: 'repactuação (art. 135 e art. 136, I)',
  extincao: 'extinção do contrato (arts. 137 a 139)',
};

/** Texto (Markdown simples) do termo assinado, para o PDF juntado ao processo. Dados pessoais do contratado PF mascarados. */
export function textoTermo(a: AlteracaoContratual, c: LinhaContratoAlteracao): string {
  const contratada = c.tipo_pessoa === 'PF' ? mascararNome(c.razao_social) : c.razao_social;
  const linhas = [
    `# ${a.numero ?? ROTULO_ESPECIE[a.especie]} ao contrato ${c.numero}`,
    '',
    `**Espécie:** ${ROTULO_ESPECIE[a.especie]} — ${ROTULO_TIPO[a.tipo]}`,
    `**Contratante:** ${c.uasg_nome} (UASG ${c.uasg})`,
    `**Contratada:** ${contratada} (${mascararDocumento(c.documento)})`,
    `**Processo SEI:** ${c.processo_sei}`,
    `**Objeto do contrato:** ${c.objeto}`,
    '',
    '## Cláusula primeira — do objeto do termo',
    a.justificativa,
  ];
  if (a.detalhes.length > 0) {
    linhas.push('', '## Cláusula segunda — das condições');
    for (const d of a.detalhes) linhas.push(`- **${d.rotulo}:** ${d.valor}`);
  }
  if (a.valor !== 0) linhas.push('', `**Reflexo no valor do contrato:** ${a.valor < 0 ? '− ' : ''}${formatarMoeda(Math.abs(a.valor))}`);
  if (a.novaVigenciaFim) linhas.push(`**Nova data de fim da vigência:** ${formatarData(a.novaVigenciaFim)}`);
  if (a.avaliacao) linhas.push('', '## Conferência das travas legais', a.avaliacao.explicacao, `Fundamento: ${a.avaliacao.fundamento}.`);
  if (a.parecer) {
    linhas.push('', '## Parecer jurídico (art. 53, § 4º)', `Parecer nº ${a.parecer.numero} — ${a.parecer.resultado.replace(/_/g, ' ')}${a.parecer.emitidoPor ? `, por ${a.parecer.emitidoPor.nome}` : ''}.`);
  }
  if (a.contraditorio) {
    linhas.push(
      '',
      '## Contraditório (art. 137, caput)',
      `Prazo de defesa de ${a.contraditorio.prazoDiasUteis} dias úteis, até ${formatarData(a.contraditorio.prazoFim)}. ${
        a.contraditorio.defesa
          ? `Defesa apresentada em ${formatarData(a.contraditorio.defesa.apresentadaEm)}: ${a.contraditorio.defesa.resumo}`
          : a.contraditorio.semManifestacao
            ? 'O contratado não se manifestou no prazo.'
            : ''
      }`,
    );
  }
  if (a.decisao) linhas.push('', '## Decisão da autoridade competente', a.decisao.fundamentacao);
  if (a.verificacaoRegularidadeId) {
    linhas.push('', `Verificação de regularidade do contratado (art. 91, § 4º) nº ${a.verificacaoRegularidadeId}, registrada antes da assinatura.`);
  }
  linhas.push(
    '',
    `Assinado em ${a.assinadoEm ? formatarData(a.assinadoEm) : '—'}${a.assinadoPor ? ` por ${a.assinadoPor.nome}` : ''}, autoridade competente, com registro na trilha de auditoria da Ágora.`,
    a.especie === 'aditivo'
      ? 'A divulgação deste termo no Portal Nacional de Contratações Públicas é condição de eficácia (art. 94 da Lei 14.133/2021).'
      : 'Termo divulgado no Portal Nacional de Contratações Públicas para transparência (art. 174 da Lei 14.133/2021).',
  );
  return linhas.join('\n');
}
