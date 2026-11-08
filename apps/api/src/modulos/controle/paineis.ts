/**
 * Painéis das três linhas de defesa (Lei 14.133/2021, art. 169; RF-23). Cada painel é montado no servidor, no escopo
 * de UASG do usuário, a partir dos dados que já existem: pendências, tarefas, pagamentos, processos da jornada
 * (avaliados pelas mesmas regras do avanço), sanções, contratos, medidas de controle, revisões da matriz de riscos e
 * a trilha de auditoria. Os achados são sinais para conferência humana, nunca conclusão de irregularidade.
 */
import { avaliarLimiteAditivos, pagamentosPreteridos, situacaoDivulgacaoPncp, type OpcoesCalendario } from '@agora/dominio';
import type {
  AchadoPreventivo,
  AtestoAtrasadoControle,
  Bloqueio,
  EventoAuditoria,
  ExcecaoJustificada,
  IndicadoresPrimeiraLinha,
  IndicadoresSegundaLinha,
  PainelPrimeiraLinha,
  PainelSegundaLinha,
  PainelTerceiraLinha,
  ParecerPendenteControle,
  ProcessoBloqueadoControle,
  ReferenciaControle,
  Sancao,
  TarefaAtrasadaControle,
} from '@agora/contratos';
import { verificarCadeia } from '../../auditoria/trilha.ts';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento } from '../../compartilhado/texto.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { avaliarProcesso, carregarProcesso, listarLinhasProcessos } from '../jornada/repositorio.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { listarPendencias } from '../pendencias/repositorio.ts';
import { listarSancoes } from '../sancoes/repositorio.ts';
import { carregarMedidas, referenciaContrato, referenciaProcesso } from './medidas.ts';
import { revisoesRiscosPendentes } from './riscos.ts';

export interface ContextoPainel {
  executor: Executor;
  /** Escopo de UASG da sessão (`null` = todas). */
  escopo: string[] | null;
  /** Filtro opcional de UASG escolhido na tela. */
  uasg: string | null;
  hoje: string;
  agora: Date;
  calendario: OpcoesCalendario;
}

const LIMITE_LISTA = 10;
const DIAS_PROCESSO_PARADO = 15;
const MS_POR_DIA = 86_400_000;

interface ProcessoAvaliado {
  linha: LinhaProcesso;
  bloqueios: Bloqueio[];
  diasSemAtualizacao: number;
}

function resumir(texto: string, limite = 300): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`;
}

function referenciaAta(id: string, numero: string): ReferenciaControle {
  return { tipo: 'ata', id, identificador: identificadorInstrumento('ata', numero), caminho: `/atas/${id}` };
}

/** Processos da jornada no escopo, com os bloqueios calculados pelas mesmas regras do avanço (inclusive RN-30). */
export async function avaliarProcessosDoEscopo(ctx: ContextoPainel): Promise<ProcessoAvaliado[]> {
  const { linhas } = await listarLinhasProcessos(ctx.executor, { escopo: ctx.escopo }, 500, 0);
  const avaliados: ProcessoAvaliado[] = [];
  for (const linha of linhas) {
    if (ctx.uasg !== null && linha.uasg !== ctx.uasg) continue;
    const avaliacao = await avaliarProcesso(ctx.executor, await carregarProcesso(ctx.executor, linha), ctx.hoje, ctx.calendario, ctx.agora);
    avaliados.push({
      linha,
      bloqueios: avaliacao.bloqueios,
      diasSemAtualizacao: Math.max(0, Math.floor((ctx.agora.getTime() - Date.parse(linha.atualizado_em)) / MS_POR_DIA)),
    });
  }
  return avaliados;
}

function processosBloqueados(processos: readonly ProcessoAvaliado[]): ProcessoBloqueadoControle[] {
  return processos
    .filter((p) => p.bloqueios.length > 0)
    .map((p) => ({
      processo: referenciaProcesso(p.linha.id, p.linha.numero_sei),
      titulo: p.linha.titulo,
      etapaAtual: p.linha.etapa_atual,
      uasg: p.linha.uasg,
      bloqueios: p.bloqueios,
      diasSemAtualizacao: p.diasSemAtualizacao,
    }))
    .sort((a, b) => b.diasSemAtualizacao - a.diasSemAtualizacao || a.processo.identificador.localeCompare(b.processo.identificador));
}

// ───────────────────────── 1ª linha ─────────────────────────

export async function montarPrimeiraLinha(ctx: ContextoPainel, processos: readonly ProcessoAvaliado[]): Promise<PainelPrimeiraLinha> {
  const { executor, escopo, uasg, hoje } = ctx;
  const [pendencias] = await executor.consultar<{ abertas: number; vencidas: number }>(
    `SELECT COUNT(*)::integer AS abertas, (COUNT(*) FILTER (WHERE prazo < $3::date))::integer AS vencidas
       FROM pendencias
      WHERE situacao = 'aberta'
        AND ($1::text[] IS NULL OR uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR uasg = $2)`,
    [escopo, uasg, hoje],
  );
  const { itens: proximas } = await listarPendencias(
    executor,
    { escopo, situacao: 'aberta', uasg: uasg ?? undefined },
    { campo: 'prazo', ordem: 'asc' },
    LIMITE_LISTA,
    0,
  );

  const tarefas = await executor.consultar<{
    id: string;
    titulo: string;
    prazo: string;
    instrumento_tipo: 'ata' | 'contrato';
    instrumento_id: string;
    numero: string | null;
    responsavel_id: string | null;
    responsavel_nome: string | null;
    total: number;
  }>(
    `SELECT t.id, t.titulo, t.prazo, t.instrumento_tipo, t.instrumento_id, COALESCE(a.numero, c.numero) AS numero,
            t.responsavel_id, u.nome AS responsavel_nome, COUNT(*) OVER ()::integer AS total
       FROM tarefas t
       LEFT JOIN atas a ON t.instrumento_tipo = 'ata' AND a.id = t.instrumento_id
       LEFT JOIN contratos c ON t.instrumento_tipo = 'contrato' AND c.id = t.instrumento_id
       LEFT JOIN usuarios u ON u.id = t.responsavel_id
      WHERE t.situacao = 'pendente' AND t.prazo < $3::date
        AND ($1::text[] IS NULL OR t.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR t.uasg = $2)
      ORDER BY t.prazo, t.id
      LIMIT ${LIMITE_LISTA}`,
    [escopo, uasg, hoje],
  );
  const tarefasAtrasadas: TarefaAtrasadaControle[] = tarefas.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    prazo: t.prazo,
    instrumento: t.instrumento_tipo === 'ata' ? referenciaAta(t.instrumento_id, t.numero ?? '') : referenciaContrato(t.instrumento_id, t.numero ?? ''),
    responsavel: usuarioResumo(t.responsavel_id, t.responsavel_nome),
  }));

  const atestos = await executor.consultar<{
    id: string;
    contrato_id: string;
    numero: string;
    nota_fiscal: string;
    valor: number;
    vencimento: string;
    total: number;
  }>(
    `SELECT p.id, p.contrato_id, c.numero, p.nota_fiscal, p.valor, p.vencimento, COUNT(*) OVER ()::integer AS total
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
      WHERE p.situacao = 'previsto' AND p.vencimento < $3::date
        AND ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
      ORDER BY p.vencimento, p.nota_fiscal
      LIMIT ${LIMITE_LISTA}`,
    [escopo, uasg, hoje],
  );
  const atestosAtrasados: AtestoAtrasadoControle[] = atestos.map((a) => ({
    id: a.id,
    contrato: referenciaContrato(a.contrato_id, a.numero),
    notaFiscal: a.nota_fiscal,
    valor: a.valor,
    vencimento: a.vencimento,
  }));

  const bloqueados = processosBloqueados(processos);
  const revisoesRiscos = await revisoesRiscosPendentes(executor, escopo, uasg, hoje);
  const medidas = (await carregarMedidas(executor, { escopo, uasg }, hoje, ctx.calendario)).filter(
    (m) => m.bloqueia || m.situacao === 'aguardando_resposta' || m.situacao === 'resposta_vencida',
  );

  const indicadores: IndicadoresPrimeiraLinha = {
    pendenciasAbertas: pendencias?.abertas ?? 0,
    pendenciasVencidas: pendencias?.vencidas ?? 0,
    tarefasAtrasadas: tarefas[0]?.total ?? 0,
    atestosAtrasados: atestos[0]?.total ?? 0,
    processosBloqueados: bloqueados.length,
    revisoesRiscosPendentes: revisoesRiscos.length,
    cautelaresSuspensivas: medidas.filter((m) => m.bloqueia).length,
  };
  return {
    geradoEm: ctx.agora.toISOString(),
    uasg,
    indicadores,
    pendenciasVencidas: proximas.filter((p) => p.prazo !== null && p.prazo < hoje),
    tarefasAtrasadas,
    atestosAtrasados,
    processosBloqueados: bloqueados,
    revisoesRiscos,
    medidas,
    fontes: [
      'Pendências e tarefas do plano de gestão registradas na Ágora',
      'Pagamentos e notas fiscais (SIAFI, sincronização da Ágora)',
      'Processos da jornada da contratação, avaliados pelas regras de @agora/dominio',
      'Revisões da matriz de riscos dos contratos (RN-29)',
      'Medidas de controle externo registradas (RF-24)',
    ],
  };
}

// ───────────────────────── 2ª linha ─────────────────────────

async function achadosAditivos(ctx: ContextoPainel): Promise<AchadoPreventivo[]> {
  const linhas = await ctx.executor.consultar<{
    id: string;
    numero: string;
    valor_inicial: number;
    acrescimos: number;
    supressoes: number;
    reajustes: number;
  }>(
    `SELECT c.id, c.numero, c.valor_inicial, v.acrescimos, v.supressoes, v.reajustes
       FROM contratos c
       JOIN vw_contratos_valores v ON v.contrato_id = c.id
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
        AND c.vigencia_fim >= $3::date
        AND c.valor_inicial > 0
        AND (v.acrescimos > 0 OR v.supressoes > 0)
      ORDER BY c.numero`,
    [ctx.escopo, ctx.uasg, ctx.hoje],
  );
  return linhas.flatMap((l): AchadoPreventivo[] => {
    const r = avaliarLimiteAditivos({ valorInicialAtualizado: l.valor_inicial + l.reajustes, acrescimos: l.acrescimos, supressoes: l.supressoes });
    if (r.nivel === 'regular') return [];
    return [
      {
        tipo: 'aditivo_limite',
        nivel: r.nivel === 'excedido' ? 'risco' : 'atencao',
        titulo: r.nivel === 'excedido' ? 'Alterações acima do limite legal' : 'Alterações perto do limite legal',
        descricao: r.explicacao,
        fundamento: r.fundamento,
        referencia: referenciaContrato(l.id, l.numero),
      },
    ];
  });
}

async function achadosDesignacaoEDivulgacao(ctx: ContextoPainel): Promise<AchadoPreventivo[]> {
  const linhas = await ctx.executor.consultar<{
    id: string;
    numero: string;
    gestor_id: string | null;
    fiscal_id: string | null;
    assinatura_em: string;
    origem: 'licitacao' | 'contratacao_direta';
    divulgacao_pncp_em: string | null;
  }>(
    `SELECT c.id, c.numero, c.gestor_id, c.fiscal_id, c.assinatura_em, c.origem, c.divulgacao_pncp_em
       FROM contratos c
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
        AND c.vigencia_fim >= $3::date
        AND (c.gestor_id IS NULL OR c.fiscal_id IS NULL OR c.divulgacao_pncp_em IS NULL)
      ORDER BY c.numero`,
    [ctx.escopo, ctx.uasg, ctx.hoje],
  );
  const achados: AchadoPreventivo[] = [];
  for (const l of linhas) {
    const referencia = referenciaContrato(l.id, l.numero);
    if (l.fiscal_id === null) {
      achados.push({
        tipo: 'sem_fiscal',
        nivel: 'risco',
        titulo: 'Contrato sem fiscal designado',
        descricao: 'A execução do contrato deve ser acompanhada e fiscalizada por fiscal designado pela Administração.',
        fundamento: 'Lei 14.133/2021, art. 117',
        referencia,
      });
    }
    if (l.gestor_id === null) {
      achados.push({
        tipo: 'sem_gestor',
        nivel: 'atencao',
        titulo: 'Contrato sem gestor designado',
        descricao: 'Não há gestor do contrato designado para conduzir a gestão e as providências da execução.',
        fundamento: 'Lei 14.133/2021, arts. 7º e 117',
        referencia,
      });
    }
    if (l.divulgacao_pncp_em === null) {
      const d = situacaoDivulgacaoPncp(l.assinatura_em, l.origem, null, ctx.hoje, ctx.calendario);
      if (d.situacao === 'pendente_vencido') {
        achados.push({ tipo: 'divulgacao_pncp', nivel: 'risco', titulo: 'Divulgação no PNCP vencida', descricao: d.explicacao, fundamento: 'Lei 14.133/2021, art. 94', referencia });
      }
    }
  }
  return achados;
}

async function achadosCeisCnep(ctx: ContextoPainel): Promise<AchadoPreventivo[]> {
  const linhas = await ctx.executor.consultar<{ id: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string; prazo: string }>(
    `SELECT s.id, f.tipo_pessoa, f.razao_social, s.prazo_registro_ceis_cnep AS prazo
       FROM sancoes s
       JOIN fornecedores f ON f.id = s.fornecedor_id
       LEFT JOIN contratos c ON c.id = s.contrato_id
      WHERE s.situacao = 'aplicada' AND NOT s.registrada_ceis_cnep AND s.prazo_registro_ceis_cnep < $3::date
        AND ($1::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
      ORDER BY s.prazo_registro_ceis_cnep`,
    [ctx.escopo, ctx.uasg, ctx.hoje],
  );
  return linhas.map((l) => ({
    tipo: 'ceis_cnep',
    nivel: 'risco',
    titulo: 'Sanção aplicada sem registro no CEIS/CNEP',
    descricao: `O prazo de 15 dias úteis para informar a sanção no cadastro nacional venceu em ${l.prazo.split('-').reverse().join('/')}.`,
    fundamento: 'Lei 14.133/2021, art. 161',
    referencia: { tipo: 'sancao', id: l.id, identificador: `Sanção — ${nomeExibivel(l.tipo_pessoa, l.razao_social)}`, caminho: '/sancoes' },
  }));
}

/** Art. 141: a ordem cronológica é por fonte de recurso no órgão inteiro; o resultado é filtrado pelo escopo. */
async function achadosOrdemCronologica(ctx: ContextoPainel): Promise<AchadoPreventivo[]> {
  const linhas = await ctx.executor.consultar<{
    id: string;
    contrato_id: string;
    numero: string;
    uasg: string;
    nota_fiscal: string;
    fonte_recurso: string;
    vencimento: string;
    pago_em: string | null;
    situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  }>(
    `SELECT p.id, p.contrato_id, c.numero, c.uasg, p.nota_fiscal, p.fonte_recurso, p.vencimento, p.pago_em, p.situacao
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id`,
  );
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const preteridos = pagamentosPreteridos(
    linhas.map((l) => ({ id: l.id, fonteRecurso: l.fonte_recurso, vencimento: l.vencimento, pagoEm: l.pago_em, exigivel: l.situacao !== 'previsto' })),
    ctx.hoje,
  );
  return preteridos.flatMap((p): AchadoPreventivo[] => {
    const l = porId.get(p.id);
    if (!l) return [];
    if (ctx.escopo !== null && !ctx.escopo.includes(l.uasg)) return [];
    if (ctx.uasg !== null && l.uasg !== ctx.uasg) return [];
    const vencimento = p.vencimento.split('-').reverse().join('/');
    return [
      {
        tipo: 'ordem_cronologica',
        nivel: 'risco',
        titulo: 'Pagamento preterido na ordem cronológica',
        descricao: `Nota fiscal ${l.nota_fiscal}, exigível desde ${vencimento} na fonte ${l.fonte_recurso}: ${p.posterioresPagos} nota(s) de vencimento posterior foram pagas antes${p.pagoEm === null ? ' e ela segue sem pagamento' : ''}. A alteração da ordem exige justificativa prévia da autoridade competente e comunicação ao controle interno e ao tribunal de contas; confira se ela existe.`,
        fundamento: p.fundamento,
        referencia: {
          tipo: 'pagamento',
          id: l.id,
          identificador: `Nota fiscal ${l.nota_fiscal} — ${identificadorInstrumento('contrato', l.numero)}`,
          caminho: `/contratos/${l.contrato_id}?aba=pagamentos`,
        },
      },
    ];
  });
}

function excecoesDosProcessos(processos: readonly ProcessoAvaliado[]): ExcecaoJustificada[] {
  const excecoes: ExcecaoJustificada[] = [];
  for (const { linha } of processos) {
    const referencia = referenciaProcesso(linha.id, linha.numero_sei);
    if (!linha.dfd.usaCatalogoPadronizado && linha.dfd.justificativaNaoPadronizacao) {
      excecoes.push({
        tipo: 'nao_padronizacao',
        titulo: 'Contratação fora do catálogo de padronização',
        justificativa: resumir(linha.dfd.justificativaNaoPadronizacao),
        fundamento: 'Lei 14.133/2021, art. 19, § 2º',
        referencia,
      });
    }
    if (linha.dfd.justificativaArtigoLuxo) {
      excecoes.push({
        tipo: 'artigo_luxo',
        titulo: 'Item com indício de artigo de luxo justificado',
        justificativa: resumir(linha.dfd.justificativaArtigoLuxo),
        fundamento: 'Lei 14.133/2021, art. 20; Decreto 10.818/2021',
        referencia,
      });
    }
    for (const [inciso, conteudo] of Object.entries(linha.etp)) {
      if (conteudo?.justificativaAusencia && !(conteudo.texto ?? '').trim()) {
        excecoes.push({
          tipo: 'etp_ausencia',
          titulo: `ETP sem o elemento do inciso ${inciso}`,
          justificativa: resumir(conteudo.justificativaAusencia),
          fundamento: 'Lei 14.133/2021, art. 18, §§ 1º e 2º',
          referencia,
        });
      }
    }
    for (const cotacao of linha.cesta.cotacoes) {
      if (cotacao.expurgada && cotacao.motivoExpurgo) {
        excecoes.push({
          tipo: 'expurgo_cotacao',
          titulo: 'Cotação expurgada da pesquisa de preços',
          justificativa: resumir(`${cotacao.descricaoFonte}: ${cotacao.motivoExpurgo}`),
          fundamento: 'Lei 14.133/2021, art. 23; IN SEGES/ME 65/2021',
          referencia,
        });
      }
    }
  }
  return excecoes;
}

async function sancoesEmAndamento(ctx: ContextoPainel): Promise<Sancao[]> {
  const { itens } = await listarSancoes(ctx.executor, { escopo: ctx.escopo }, 200, 0);
  const emAndamento = itens.filter(
    (s) =>
      s.situacao === 'em_instrucao' ||
      s.situacao === 'defesa' ||
      s.situacao === 'decisao' ||
      (s.situacao === 'aplicada' && !s.registradaCeisCnep && s.prazoRegistroCeisCnep !== null),
  );
  if (ctx.uasg === null) return emAndamento;
  const ids = emAndamento.flatMap((s) => (s.contrato ? [s.contrato.id] : []));
  const uasgs = new Map(
    (await ctx.executor.consultar<{ id: string; uasg: string }>('SELECT id, uasg FROM contratos WHERE id = ANY($1::uuid[])', [ids])).map((c) => [c.id, c.uasg]),
  );
  return emAndamento.filter((s) => s.contrato === null || uasgs.get(s.contrato.id) === ctx.uasg);
}

export async function montarSegundaLinha(ctx: ContextoPainel, processos: readonly ProcessoAvaliado[]): Promise<PainelSegundaLinha> {
  const pareceresPendentes: ParecerPendenteControle[] = processos
    .filter((p) => p.linha.etapa_atual === 5 && p.linha.parecer.conclusao === null)
    .map((p) => ({ processo: referenciaProcesso(p.linha.id, p.linha.numero_sei), titulo: p.linha.titulo, uasg: p.linha.uasg, desde: p.linha.atualizado_em }));

  const parados: AchadoPreventivo[] = processosBloqueados(processos)
    .filter((p) => p.diasSemAtualizacao > DIAS_PROCESSO_PARADO)
    .map((p) => ({
      tipo: 'processo_parado',
      nivel: 'atencao',
      titulo: `Processo bloqueado há mais de ${DIAS_PROCESSO_PARADO} dias`,
      descricao: `${p.bloqueios.length} bloqueio(s) na etapa ${p.etapaAtual} e ${p.diasSemAtualizacao} dias sem atualização: ${resumir(p.bloqueios.map((b) => b.mensagem).join(' '), 240)}`,
      fundamento: 'Lei 14.133/2021, art. 169, caput (controle preventivo)',
      referencia: p.processo,
    }));
  const revisoes: AchadoPreventivo[] = (await revisoesRiscosPendentes(ctx.executor, ctx.escopo, ctx.uasg, ctx.hoje))
    .filter((r) => r.revisao.situacao === 'vencida')
    .map((r) => ({
      tipo: 'revisao_riscos',
      nivel: 'atencao',
      titulo: 'Revisão trimestral da matriz de riscos vencida',
      descricao: r.revisao.explicacao,
      fundamento: r.revisao.fundamento,
      referencia: r.contrato,
    }));
  const achados = [
    ...(await achadosAditivos(ctx)),
    ...(await achadosDesignacaoEDivulgacao(ctx)),
    ...(await achadosCeisCnep(ctx)),
    ...(await achadosOrdemCronologica(ctx)),
    ...parados,
    ...revisoes,
  ].sort((a, b) => Number(a.nivel === 'atencao') - Number(b.nivel === 'atencao'));

  const excecoes = excecoesDosProcessos(processos);
  const sancoes = await sancoesEmAndamento(ctx);
  const medidas = (await carregarMedidas(ctx.executor, { escopo: ctx.escopo, uasg: ctx.uasg }, ctx.hoje, ctx.calendario)).filter(
    (m) => m.situacao !== 'revogada',
  );
  const indicadores: IndicadoresSegundaLinha = {
    pareceresPendentes: pareceresPendentes.length,
    achadosRisco: achados.filter((a) => a.nivel === 'risco').length,
    achadosAtencao: achados.filter((a) => a.nivel === 'atencao').length,
    excecoesJustificadas: excecoes.length,
    sancoesEmAndamento: sancoes.length,
    medidasAbertas: medidas.filter((m) => m.situacao === 'aguardando_resposta' || m.situacao === 'resposta_vencida').length,
  };
  return {
    geradoEm: ctx.agora.toISOString(),
    uasg: ctx.uasg,
    indicadores,
    pareceresPendentes,
    achados,
    excecoes,
    sancoes,
    medidas,
    fontes: [
      'Processos da jornada da contratação (DFD, ETP, cesta de preços e parecer)',
      'Contratos, aditivos e designações (Contratos.gov.br e Ágora)',
      'Pagamentos por fonte de recurso (SIAFI, sincronização da Ágora)',
      'Processos sancionatórios registrados na Ágora',
      'Medidas de controle externo e revisões da matriz de riscos registradas na Ágora',
    ],
  };
}

// ───────────────────────── 3ª linha ─────────────────────────

/** Brasil sem horário de verão desde 2019: o dia civil de Brasília começa às 03:00 UTC. */
function inicioDoDia(data: string): string {
  return new Date(`${data}T00:00:00-03:00`).toISOString();
}

export async function montarTerceiraLinha(ctx: ContextoPainel, periodo: { de: string; ate: string }): Promise<PainelTerceiraLinha> {
  const processos = await avaliarProcessosDoEscopo(ctx);
  const primeira = await montarPrimeiraLinha(ctx, processos);
  const segunda = await montarSegundaLinha(ctx, processos);
  const medidas = await carregarMedidas(ctx.executor, { escopo: ctx.escopo, uasg: ctx.uasg }, ctx.hoje, ctx.calendario);
  const integridade = await verificarCadeia(ctx.executor, ctx.agora);

  const de = inicioDoDia(periodo.de);
  const ateExclusivo = new Date(Date.parse(inicioDoDia(periodo.ate)) + MS_POR_DIA).toISOString();
  const porRecurso = await ctx.executor.consultar<{ recurso: string; total: number }>(
    `SELECT recurso, COUNT(*)::integer AS total
       FROM auditoria_eventos
      WHERE ocorrido_em >= $1::timestamptz AND ocorrido_em < $2::timestamptz
      GROUP BY recurso
      ORDER BY total DESC, recurso`,
    [de, ateExclusivo],
  );
  const ultimos = await ctx.executor.consultar<{
    id: string;
    sequencia: number;
    ocorrido_em: string;
    usuario_id: string | null;
    usuario_nome: string | null;
    acao: string;
    recurso: string;
    recurso_id: string | null;
    resumo: string;
    hash: string;
    hash_anterior: string;
  }>(
    `SELECT e.id, e.sequencia, e.ocorrido_em, e.usuario_id, u.nome AS usuario_nome, e.acao, e.recurso, e.recurso_id, e.resumo, e.hash, e.hash_anterior
       FROM auditoria_eventos e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.ocorrido_em >= $1::timestamptz AND e.ocorrido_em < $2::timestamptz
      ORDER BY e.sequencia DESC
      LIMIT ${LIMITE_LISTA}`,
    [de, ateExclusivo],
  );
  const ultimosEventos: EventoAuditoria[] = ultimos.map((l) => ({
    id: l.id,
    sequencia: l.sequencia,
    ocorridoEm: l.ocorrido_em,
    usuario: usuarioResumo(l.usuario_id, l.usuario_nome),
    acao: l.acao,
    recurso: l.recurso,
    recursoId: l.recurso_id,
    resumo: l.resumo,
    hash: l.hash,
    hashAnterior: l.hash_anterior,
  }));
  const [acessos] = await ctx.executor.consultar<{ total: number }>(
    'SELECT COUNT(*)::integer AS total FROM lgpd_acessos WHERE ocorrido_em >= $1::timestamptz AND ocorrido_em < $2::timestamptz',
    [de, ateExclusivo],
  );

  return {
    geradoEm: ctx.agora.toISOString(),
    uasg: ctx.uasg,
    periodo,
    indicadores: {
      medidasAbertas: medidas.filter((m) => m.situacao === 'aguardando_resposta' || m.situacao === 'resposta_vencida').length,
      respostasVencidas: medidas.filter((m) => m.situacao === 'resposta_vencida').length,
      cautelaresSuspensivas: medidas.filter((m) => m.bloqueia).length,
      eventosNoPeriodo: porRecurso.reduce((s, r) => s + r.total, 0),
      acessosDadosPessoais: acessos?.total ?? 0,
      achadosRisco: segunda.indicadores.achadosRisco,
    },
    medidas,
    integridade,
    eventosPorRecurso: porRecurso,
    ultimosEventos,
    primeiraLinha: primeira.indicadores,
    segundaLinha: segunda.indicadores,
    achados: segunda.achados,
    fontes: [
      'Trilha de auditoria da Ágora, encadeada por hash SHA-256 e verificada nesta emissão',
      'Registros de acesso a dados pessoais (LGPD, art. 37)',
      'Medidas de controle externo registradas (RF-24)',
      ...primeira.fontes.filter((f) => !f.startsWith('Medidas')),
      ...segunda.fontes.filter((f) => !f.startsWith('Medidas') && !f.startsWith('Processos da jornada')),
    ],
  };
}
