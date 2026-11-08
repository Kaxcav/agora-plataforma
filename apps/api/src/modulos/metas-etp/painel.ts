/**
 * Painel das metas do ETP (RF-39; Lei 14.133/2021, art. 18, § 1º, IX): lê os fatos — avanços de etapa e bloqueios
 * das travas na trilha de auditoria, valores estimados e contratados dos processos — no escopo de UASG do usuário e
 * entrega ao domínio, que mede contra as metas configuradas pelo órgão.
 */
import {
  avaliarMitigacaoTravas,
  CATALOGO_REGRAS,
  ETAPAS_INSTRUCAO,
  medirEconomia,
  medirTempoInstrucao,
  type MarcoEtapa,
  type ProcessoEconomia,
} from '@agora/dominio';
import type { ConfiguracaoMetasEtp, EconomiaProcessoPainel, PainelMetasEtp } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { ROTULOS_TRAVA, type TipoTrava } from '../../compartilhado/travas.ts';
import { referenciaProcesso } from '../controle/medidas.ts';
import { TITULOS_ETAPA } from '../jornada/constantes.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import { vencedorDoProcesso } from '../jornada/selecao.ts';
import type { CestaArmazenada, DfdProcesso, DisputaArmazenada, SelecaoArmazenada } from '../jornada/tipos.ts';
import { metasConfiguradas } from './configuracao.ts';

export interface FiltroPainelMetas {
  escopo: string[] | null;
  uasg: string | null;
  de: string;
  ate: string;
}

/** Instantes do período em Brasília (sem horário de verão desde 2019). */
export function instantesDoPeriodo(de: string, ate: string): { inicio: string; fim: string } {
  return { inicio: new Date(`${de}T00:00:00.000-03:00`).toISOString(), fim: new Date(`${ate}T23:59:59.999-03:00`).toISOString() };
}

const ESCOPO_PROCESSO = '($1::text[] IS NULL OR p.uasg = ANY($1::text[])) AND ($2::text IS NULL OR p.uasg = $2)';

async function carregarMarcos(executor: Executor, f: FiltroPainelMetas, inicio: string, fim: string): Promise<MarcoEtapa[]> {
  const linhas = await executor.consultar<{ recurso_id: string; acao: string; para: number | null; ocorrido_em: string }>(
    `SELECT e.recurso_id, e.acao, (e.dados ->> 'para')::int AS para, e.ocorrido_em
       FROM auditoria_eventos e JOIN processos p ON p.id::text = e.recurso_id
      WHERE e.acao IN ('processo.criar', 'processo.avancar') AND e.recurso = 'processo' AND e.ocorrido_em <= $4
        AND ${ESCOPO_PROCESSO}
        AND e.recurso_id IN (SELECT recurso_id FROM auditoria_eventos WHERE acao = 'processo.avancar' AND ocorrido_em BETWEEN $3 AND $4)`,
    [f.escopo, f.uasg, inicio, fim],
  );
  return linhas.flatMap((l) => {
    const etapa = l.acao === 'processo.criar' ? 1 : l.para;
    return etapa === null ? [] : [{ processoId: l.recurso_id, etapa, ocorridoEm: l.ocorrido_em }];
  });
}

async function carregarBloqueios(executor: Executor, f: FiltroPainelMetas, inicio: string, fim: string) {
  return executor.consultar<{ recurso: string; recurso_id: string | null; trava: string; regras: string[] | null }>(
    `SELECT recurso, recurso_id, dados ->> 'trava' AS trava, COALESCE(dados -> 'regras', '[]'::jsonb) AS regras
       FROM auditoria_eventos
      WHERE acao = 'trava.bloqueio' AND ocorrido_em BETWEEN $3 AND $4
        AND ($1::text[] IS NULL OR dados ->> 'uasg' = ANY($1::text[])) AND ($2::text IS NULL OR dados ->> 'uasg' = $2)`,
    [f.escopo, f.uasg, inicio, fim],
  );
}

/** Contratos gerados pela jornada sem a consulta ao CEIS/CNEP registrada antes da assinatura (erro formal que passou). */
async function contarNaoBarradas(executor: Executor, f: FiltroPainelMetas, inicio: string, fim: string): Promise<number> {
  const [linha] = await executor.consultar<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM auditoria_eventos e JOIN processos p ON p.id::text = e.recurso_id
      WHERE e.acao = 'processo.contratar' AND e.ocorrido_em BETWEEN $3 AND $4
        AND (e.dados -> 'regularidade' ->> 'verificacaoId') IS NULL
        AND ${ESCOPO_PROCESSO}`,
    [f.escopo, f.uasg, inicio, fim],
  );
  return linha?.total ?? 0;
}

interface LinhaEconomia {
  id: string;
  numero_sei: string;
  titulo: string;
  uasg: string;
  dfd: DfdProcesso;
  cesta: CestaArmazenada;
  disputa: DisputaArmazenada;
  selecao: SelecaoArmazenada;
  contrato_valor: number | null;
  contrato_assinatura: string | null;
}

async function carregarEconomia(executor: Executor, f: FiltroPainelMetas) {
  const linhas = await executor.consultar<LinhaEconomia>(
    `SELECT p.id, p.numero_sei, p.titulo, p.uasg, p.dfd, p.cesta, p.disputa, p.selecao,
            c.valor_inicial AS contrato_valor, c.assinatura_em AS contrato_assinatura
       FROM processos p LEFT JOIN contratos c ON c.id = p.contrato_id
      WHERE p.etapa_atual >= 6 AND ${ESCOPO_PROCESSO}
      ORDER BY p.numero_sei`,
    [f.escopo, f.uasg],
  );
  const medidos: { linha: LinhaEconomia; origem: 'contrato' | 'homologacao'; data: string; entrada: ProcessoEconomia }[] = [];
  for (const linha of linhas) {
    const vencedor = vencedorDoProcesso(linha);
    if (!vencedor) continue;
    const homologacao = linha.selecao.homologacao?.data?.slice(0, 10) ?? null;
    const origem = linha.contrato_valor !== null ? 'contrato' : 'homologacao';
    const data = origem === 'contrato' ? linha.contrato_assinatura : homologacao;
    if (data === null || data < f.de || data > f.ate) continue;
    const proposta = linha.disputa.licitantes.find((l) => l.fornecedorId === vencedor)?.valorProposta;
    const contratado = linha.contrato_valor ?? proposta;
    const estimado = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, data));
    if (contratado === undefined || estimado === null) continue;
    medidos.push({
      linha,
      origem,
      data,
      entrada: {
        processoId: linha.id,
        valorEstimado: estimado,
        valorContratado: contratado,
        cotacoes: linha.cesta.cotacoes.map((c) => ({ valorUnitario: c.valorUnitario, expurgada: c.expurgada })),
        quantidadeReferencia: linha.dfd.itens[0]?.quantidade ?? 0,
      },
    });
  }
  return medidos;
}

const TITULO_REGRA = new Map(CATALOGO_REGRAS.map((r) => [r.id, r.titulo]));

const EXPLICACOES = {
  tempo: {
    mede: 'Dias corridos que cada processo passou em cada etapa da instrução (do DFD ao TR, etapas 1 a 4), da entrada até o avanço registrado na trilha de auditoria, para as etapas concluídas no período. A linha de base é a medida pelo órgão antes da plataforma.',
    naoMede: 'Não mede o esforço das pessoas nem separa o efeito de cada ferramenta (modelos, IA, equipe). Etapas em curso não entram, e processos que voltam a ser instruídos fora da plataforma não aparecem.',
  },
  erros: {
    mede: 'Quantas vezes uma trava barrou um ato com erro formal (ETP sem os elementos obrigatórios, artigo de luxo sem justificativa, assinatura sem a consulta ao CEIS e ao CNEP, cautelar em vigor e as demais travas de avanço), e se algum contrato foi gerado sem a consulta prévia registrada.',
    naoMede: 'Não mede erros de mérito nem erros que as travas não conhecem. Tentativas repetidas no mesmo processo contam como bloqueios distintos.',
  },
  economia: {
    mede: 'Diferença entre o valor estimado da contratação e o valor do contrato (ou da proposta homologada, enquanto não há contrato), por processo e no total. À parte, quanto os expurgos da cesta mudaram a média das cotações.',
    naoMede: 'Não atribui a economia à IA nem a nenhuma ferramenta: a diferença pode vir do mercado, da competição ou da qualidade da estimativa. O efeito dos expurgos não é economia e não se soma a ela.',
  },
} as const;

export async function montarPainelMetas(executor: Executor, f: FiltroPainelMetas, metas: ConfiguracaoMetasEtp, agora: Date): Promise<PainelMetasEtp> {
  const { inicio, fim } = instantesDoPeriodo(f.de, f.ate);
  const marcos = await carregarMarcos(executor, f, inicio, fim);
  const tempo = medirTempoInstrucao({ marcos, inicio, fim, metas: metas.tempoInstrucao, etapas: ETAPAS_INSTRUCAO });

  const bloqueios = await carregarBloqueios(executor, f, inicio, fim);
  const mitigacao = avaliarMitigacaoTravas({
    bloqueios: bloqueios.map((b) => ({ regras: b.regras ?? [], trava: b.trava, processoId: b.recurso === 'processo' ? b.recurso_id : null })),
    ocorrenciasNaoBarradas: await contarNaoBarradas(executor, f, inicio, fim),
    metaPercentual: metas.errosFormais.mitigacaoPercentual,
  });

  const medidos = await carregarEconomia(executor, f);
  const economia = medirEconomia({ processos: medidos.map((m) => m.entrada), metaPercentual: metas.economia.economiaPercentual });
  const processosEconomia: EconomiaProcessoPainel[] = economia.processos.map((p, i) => {
    const m = medidos[i];
    if (!m) throw new Error('Processo de economia sem origem');
    return {
      processo: referenciaProcesso(m.linha.id, m.linha.numero_sei),
      titulo: m.linha.titulo,
      uasg: m.linha.uasg,
      origem: m.origem,
      data: m.data,
      valorEstimado: p.valorEstimado,
      valorContratado: p.valorContratado,
      economia: p.economia,
      economiaPercentual: p.economiaPercentual,
      expurgos: {
        cotacoes: p.expurgos.cotacoes,
        descartadas: p.expurgos.descartadas,
        mediaComDescartadas: p.expurgos.mediaComDescartadas,
        mediaSemDescartadas: p.expurgos.mediaSemDescartadas,
        efeitoNoEstimado: p.expurgos.efeitoNoEstimado,
      },
    };
  });

  return {
    filtro: { uasg: f.uasg, de: f.de, ate: f.ate },
    tempoInstrucao: {
      metaReducaoPercentual: tempo.metaReducaoPercentual,
      etapas: tempo.etapas.map((e) => ({ ...e, titulo: TITULOS_ETAPA[e.etapa as 1 | 2 | 3 | 4] })),
      fase: tempo.fase,
      explicacao: EXPLICACOES.tempo,
    },
    errosFormais: {
      bloqueios: mitigacao.bloqueios,
      processosAfetados: mitigacao.processosAfetados,
      ocorrenciasNaoBarradas: mitigacao.ocorrenciasNaoBarradas,
      mitigacaoPercentual: mitigacao.mitigacaoPercentual,
      metaPercentual: mitigacao.metaPercentual,
      situacao: mitigacao.situacao,
      porRegra: mitigacao.porRegra.map((r) => ({ ...r, titulo: TITULO_REGRA.get(r.regra) ?? r.regra })),
      porTrava: mitigacao.porTrava.map((t) => ({ ...t, rotulo: ROTULOS_TRAVA[t.trava as TipoTrava] ?? t.trava })),
      explicacao: EXPLICACOES.erros,
    },
    economia: {
      processos: processosEconomia,
      totalEstimado: economia.totalEstimado,
      totalContratado: economia.totalContratado,
      economia: economia.economia,
      economiaPercentual: economia.economiaPercentual,
      metaPercentual: economia.metaPercentual,
      situacao: economia.situacao,
      expurgos: economia.expurgos,
      explicacao: EXPLICACOES.economia,
    },
    metasConfiguradas: metasConfiguradas(metas),
    premissas: [
      'As metas são as configuradas pelo órgão nesta tela; sem meta, o indicador aparece como "sem meta".',
      'Tempo em dias corridos, com uma casa decimal; o alvo é a linha de base reduzida pela meta de redução.',
      'Mitigação = bloqueios ÷ (bloqueios + erros formais que passaram) × 100.',
      'Economia = (estimado − contratado) ÷ estimado × 100, ponderada pelo valor; negativa quando se contratou acima do estimado.',
      'Indicadores para acompanhamento da gestão; não são avaliação de pessoas. Requer revisão humana.',
    ],
    fontes: [
      'Trilha de auditoria: autuações, avanços de etapa, bloqueios das travas (trava.bloqueio) e gerações de contrato',
      'Processos da jornada: DFD, cesta de preços (com os expurgos), disputa e atos de adjudicação e homologação',
      'Contratos gerados pela jornada (valor inicial e data de assinatura)',
      metas.atualizadaEm ? `Metas configuradas pelo órgão (última alteração em ${metas.atualizadaEm.slice(0, 10).split('-').reverse().join('/')})` : 'Metas ainda não configuradas pelo órgão',
    ],
    geradoEm: agora.toISOString(),
  };
}
