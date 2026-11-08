/**
 * Atos da fase de seleção do fornecedor (Lei 14.133/2021, art. 17): prova de conceito e amostra (art. 17, § 3º,
 * e art. 41, II), habilitação, fase recursal única (art. 165) e adjudicação e homologação (art. 71).
 *
 * Funções puras e determinísticas: "hoje" entra como parâmetro e os prazos em dias úteis seguem o art. 183
 * (`adicionarDiasUteis`, com o calendário do órgão). As funções ordenam os atos, calculam prazos e apontam o
 * próximo passo. Aprovar ou reprovar a prova, habilitar e decidir recursos são sempre decisões humanas.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, adicionarDiasUteis, formatarData } from '../datas.ts';
import { contagem, exigirInteiro, lerData } from '../interno.ts';

// ───────────────────────── Prova de conceito e amostra (RN-20) ─────────────────────────

export type ExigenciaProvaConceito = 'nenhuma' | 'prova_conceito' | 'amostra';

export interface ParametrosProvaConceito {
  exigencia: ExigenciaProvaConceito;
  /** Roteiro dos testes e critérios objetivos de aprovação, que o edital publica. */
  roteiro: string | null;
  /** Por que a prova ou a amostra é necessária (art. 41, II). */
  justificativa: string | null;
  /** Prazo para a realização, em dias úteis contados da convocação. */
  prazoDiasUteis: number | null;
}

/** Limite operacional do prazo da prova de conceito, para evitar prazo indefinido no edital. */
export const PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS = 30;

const EXIGENCIAS: readonly ExigenciaProvaConceito[] = ['nenhuma', 'prova_conceito', 'amostra'];
const FUNDAMENTO_PROVA_CONCEITO = 'Lei 14.133/2021, art. 17, § 3º, e art. 41, II';

/** "prova de conceito" ou "amostra". */
export function rotuloExigenciaProvaConceito(exigencia: ExigenciaProvaConceito): string {
  if (exigencia === 'amostra') return 'amostra';
  if (exigencia === 'prova_conceito') return 'prova de conceito';
  return 'nenhuma';
}

function tamanho(s: string | null | undefined): number {
  return (s ?? '').trim().length;
}

/**
 * Confere a exigência de prova de conceito ou amostra nos parâmetros do edital. A exigência só vale se prevista no
 * edital, com a necessidade justificada (art. 41, II), o roteiro de testes que comprova a aderência do objeto ao termo
 * de referência (art. 17, § 3º) e o prazo em dias úteis contados da convocação do licitante provisoriamente vencedor.
 */
export function validarProvaConceito(
  p: ParametrosProvaConceito,
  minimoCaracteres = 30,
): { exigida: boolean; completa: boolean; pendencias: { campo: 'roteiro' | 'justificativa' | 'prazoDiasUteis'; mensagem: string }[]; fundamento: string } {
  if (!EXIGENCIAS.includes(p.exigencia)) throw new ErroDominio('PROVA_CONCEITO_INVALIDA', `Exigência inválida: ${String(p.exigencia)}.`);
  const exigida = p.exigencia !== 'nenhuma';
  const pendencias: { campo: 'roteiro' | 'justificativa' | 'prazoDiasUteis'; mensagem: string }[] = [];
  if (exigida) {
    const rotulo = rotuloExigenciaProvaConceito(p.exigencia);
    if (tamanho(p.roteiro) < minimoCaracteres) {
      pendencias.push({ campo: 'roteiro', mensagem: `Descreva o roteiro de testes da ${rotulo} e os critérios objetivos de aprovação (mínimo de ${minimoCaracteres} caracteres).` });
    }
    if (tamanho(p.justificativa) < minimoCaracteres) {
      pendencias.push({ campo: 'justificativa', mensagem: `Justifique a necessidade da ${rotulo} (art. 41, II; mínimo de ${minimoCaracteres} caracteres).` });
    }
    const prazo = p.prazoDiasUteis;
    if (prazo === null || !Number.isInteger(prazo) || prazo < 1 || prazo > PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS) {
      pendencias.push({
        campo: 'prazoDiasUteis',
        mensagem: `Informe o prazo da ${rotulo} em dias úteis contados da convocação (de 1 a ${PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS}).`,
      });
    }
  }
  return { exigida, completa: pendencias.length === 0, pendencias, fundamento: FUNDAMENTO_PROVA_CONCEITO };
}

/** Último dia para a realização da prova de conceito ou da amostra: convocação + prazo em dias úteis (art. 183). */
export function prazoProvaConceito(convocacao: DataISO, prazoDiasUteis: number, opcoes?: OpcoesCalendario): { limite: DataISO; fundamento: string } {
  exigirInteiro(prazoDiasUteis, 'prazoDiasUteis', 'PROVA_CONCEITO_INVALIDA', 1);
  if (prazoDiasUteis > PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS) {
    throw new ErroDominio('PROVA_CONCEITO_INVALIDA', `prazoDiasUteis deve ser no máximo ${PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS}.`);
  }
  return { limite: adicionarDiasUteis(convocacao, prazoDiasUteis, opcoes), fundamento: `${FUNDAMENTO_PROVA_CONCEITO}, c/c art. 183` };
}

/**
 * Inversão de fases (art. 17, § 1º): a habilitação pode anteceder o julgamento mediante ato motivado, com a
 * explicitação dos benefícios. Sem motivação suficiente, a inversão não pode constar do edital.
 */
export function validarInversaoFases(p: { adotada: boolean; motivacao: string | null }, minimoCaracteres = 30): { pendencias: string[]; fundamento: string } {
  const pendencias =
    p.adotada && tamanho(p.motivacao) < minimoCaracteres
      ? [`A inversão de fases exige ato motivado com os benefícios esperados (mínimo de ${minimoCaracteres} caracteres).`]
      : [];
  return { pendencias, fundamento: 'Lei 14.133/2021, art. 17, § 1º' };
}

// ───────────────────────── Fase recursal única (RN-22) ─────────────────────────

/**
 * Prazos da fase recursal em dias úteis: razões (art. 165, I), contrarrazões (§ 4º), reconsideração pela autoridade
 * que praticou o ato (§ 2º) e decisão da autoridade superior (§ 2º).
 */
export const PRAZOS_RECURSAIS_DIAS_UTEIS = Object.freeze({ razoes: 3, contrarrazoes: 3, reconsideracao: 3, decisaoSuperior: 10 });

const FUNDAMENTO_RECURSO = 'Lei 14.133/2021, art. 165, I, §§ 1º, 2º e 4º, c/c art. 183';

/**
 * Vencimentos da fase recursal a partir da data do ato recorrível (ata de habilitação ou, com inversão de fases, de
 * julgamento): razões em 3 dias úteis; contrarrazões em 3 dias úteis contados do fim do prazo das razões, data em que
 * a interposição é divulgada aos demais licitantes; reconsideração em 3 dias úteis contados do fim das contrarrazões;
 * decisão da autoridade superior em até 10 dias úteis do encaminhamento (`null` enquanto não houver encaminhamento).
 */
export function prazosRecursoSelecao(
  dataAto: DataISO,
  encaminhamento: DataISO | null,
  opcoes?: OpcoesCalendario,
): { razoes: DataISO; contrarrazoes: DataISO; reconsideracao: DataISO; decisaoSuperior: DataISO | null; fundamento: string } {
  const razoes = adicionarDiasUteis(dataAto, PRAZOS_RECURSAIS_DIAS_UTEIS.razoes, opcoes);
  const contrarrazoes = adicionarDiasUteis(razoes, PRAZOS_RECURSAIS_DIAS_UTEIS.contrarrazoes, opcoes);
  const reconsideracao = adicionarDiasUteis(contrarrazoes, PRAZOS_RECURSAIS_DIAS_UTEIS.reconsideracao, opcoes);
  const decisaoSuperior = encaminhamento === null ? null : adicionarDiasUteis(encaminhamento, PRAZOS_RECURSAIS_DIAS_UTEIS.decisaoSuperior, opcoes);
  return { razoes, contrarrazoes, reconsideracao, decisaoSuperior, fundamento: FUNDAMENTO_RECURSO };
}

// ───────────────────────── Ordem dos atos da seleção ─────────────────────────

export interface ConvocacaoProvaConceito {
  fornecedorId: string;
  convocadoEm: DataISO;
  resultado: 'aprovado' | 'reprovado' | null;
  realizadaEm: DataISO | null;
}

export interface HabilitacaoLicitante {
  fornecedorId: string;
  resultado: 'habilitado' | 'inabilitado';
  data: DataISO;
}

export interface ManifestacaoRecursal {
  fornecedorId: string;
  data: DataISO;
}

/**
 * Efeito da reforma do ato recorrido: desclassificar o licitante declarado vencedor ou reintegrar um licitante
 * reprovado na prova de conceito ou inabilitado. Definido por quem decide (agente ou autoridade superior).
 */
export type EfeitoReforma = { tipo: 'desclassificar_vencedor' } | { tipo: 'reintegrar_licitante'; fornecedorId: string };

export interface FaseRecursalRegistrada {
  /** Licitante declarado vencedor quando a fase foi aberta. */
  vencedorId: string;
  dataAto: DataISO;
  intencoes: readonly ManifestacaoRecursal[];
  intencaoEncerradaEm: DataISO | null;
  razoes: readonly ManifestacaoRecursal[];
  contrarrazoes: readonly ManifestacaoRecursal[];
  reconsideracao: { decisao: 'reconsiderada' | 'mantida'; data: DataISO; efeito: EfeitoReforma | null } | null;
  decisaoSuperior: { decisao: 'provido' | 'nao_provido'; data: DataISO; efeito: EfeitoReforma | null } | null;
}

export interface EstadoSelecao {
  /** Ids dos licitantes na ordem da classificação (aplicarDesempate). */
  classificacao: readonly string[];
  /** Data do registro do resultado da disputa (julgamento). */
  dataJulgamento: DataISO | null;
  sorteioPendente: boolean;
  provaConceito: { exigida: boolean; prazoDiasUteis: number | null };
  inversaoFases: boolean;
  convocacoes: readonly ConvocacaoProvaConceito[];
  habilitacoes: readonly HabilitacaoLicitante[];
  recursos: readonly FaseRecursalRegistrada[];
  adjudicacao: { data: DataISO; fornecedorId: string } | null;
  homologacao: { data: DataISO } | null;
}

export type ProximoAtoSelecao =
  | 'registrar_disputa'
  | 'convocar_prova_conceito'
  | 'registrar_resultado_prova_conceito'
  | 'registrar_habilitacao'
  | 'registrar_intencao_recurso'
  | 'aguardar_razoes'
  | 'aguardar_contrarrazoes'
  | 'decidir_reconsideracao'
  | 'decidir_recurso'
  | 'adjudicar'
  | 'homologar'
  | 'concluida'
  | 'fracassada';

export type SituacaoFaseRecursal =
  | 'intencao'
  | 'razoes'
  | 'contrarrazoes'
  | 'reconsideracao'
  | 'decisao_superior'
  | 'preclusa'
  | 'deserta'
  | 'improvida'
  | 'decidida_em_recurso';

export interface PendenciaSelecao {
  regra: 'RN-08' | 'RN-20' | 'RN-22' | 'RF-18';
  mensagem: string;
  fundamento: string;
}

export interface AvaliacaoSelecao {
  proximoAto: ProximoAtoSelecao;
  /** Primeiro classificado que não foi reprovado, inabilitado ou desclassificado em recurso. */
  vencedorProvisorio: string | null;
  excluidos: { fornecedorId: string; motivo: 'prova_conceito' | 'habilitacao' | 'recurso' }[];
  /** Licitantes reintegrados por decisão recursal (a reprovação ou a inabilitação foi reformada). */
  reintegrados: string[];
  /** Convocação em aberto ou concluída do vencedor provisório, com o último dia do prazo. */
  convocacaoAtual: (ConvocacaoProvaConceito & { limite: DataISO; vencida: boolean }) | null;
  /** O vencedor provisório deve ser convocado automaticamente (a prova anterior reprovou outro licitante). */
  convocacaoAutomatica: boolean;
  faseRecursal: {
    atoRecorrivel: 'habilitacao' | 'julgamento';
    dataAto: DataISO;
    situacao: SituacaoFaseRecursal;
    intencaoAberta: boolean;
    prazos: ReturnType<typeof prazosRecursoSelecao>;
  } | null;
  recursosExauridos: boolean;
  /** O que impede o avanço para a etapa seguinte (próximo ato pendente). */
  pendencia: PendenciaSelecao | null;
  alertas: PendenciaSelecao[];
}

type MotivoExclusao = AvaliacaoSelecao['excluidos'][number]['motivo'];

function efeitoDa(r: FaseRecursalRegistrada): { efeito: EfeitoReforma; data: DataISO } | null {
  if (r.reconsideracao?.decisao === 'reconsiderada') {
    return { efeito: r.reconsideracao.efeito ?? { tipo: 'desclassificar_vencedor' }, data: r.reconsideracao.data };
  }
  if (r.decisaoSuperior?.decisao === 'provido') {
    return { efeito: r.decisaoSuperior.efeito ?? { tipo: 'desclassificar_vencedor' }, data: r.decisaoSuperior.data };
  }
  return null;
}

const FUNDAMENTO_DISPUTA = 'Lei 14.133/2021, arts. 33, 59 e 60';
const FUNDAMENTO_HABILITACAO = 'Lei 14.133/2021, arts. 62 a 70 e art. 17, V';
const FUNDAMENTO_INTENCAO = 'Lei 14.133/2021, art. 165, § 1º, I';
const FUNDAMENTO_ATOS_AUTORIDADE = 'Lei 14.133/2021, art. 71, IV';

/**
 * Situação dos atos da seleção e próximo ato exigido, na ordem do art. 17: julgamento (com a prova de conceito ou a
 * amostra do licitante provisoriamente vencedor, art. 17, § 3º), habilitação, fase recursal única (art. 165, § 1º, II)
 * e, exauridos os recursos, adjudicação e homologação pela autoridade superior (art. 71, IV). Com inversão de fases
 * (art. 17, § 1º), a habilitação antecede o julgamento e a fase recursal ocorre depois do julgamento.
 *
 * A prova reprovada, a inabilitação ou o recurso que desclassifica o vencedor convocam o próximo colocado. A intenção
 * de recorrer é manifestada imediatamente após o ato (no dia da ata), sob pena de preclusão; as razões têm 3 dias úteis.
 */
export function avaliarSelecao(e: EstadoSelecao, hoje: DataISO, opcoes?: OpcoesCalendario): AvaliacaoSelecao {
  lerData(hoje, 'hoje');
  const alertas: PendenciaSelecao[] = [];
  const reintegrados = new Map<string, DataISO>();
  const excluidosPorRecurso = new Set<string>();
  for (const r of e.recursos) {
    const reforma = efeitoDa(r);
    if (!reforma) continue;
    if (reforma.efeito.tipo === 'reintegrar_licitante') reintegrados.set(reforma.efeito.fornecedorId, reforma.data);
    else excluidosPorRecurso.add(r.vencedorId);
  }
  const excluidos = new Map<string, MotivoExclusao>();
  for (const c of e.convocacoes) if (c.resultado === 'reprovado' && !reintegrados.has(c.fornecedorId)) excluidos.set(c.fornecedorId, 'prova_conceito');
  for (const h of e.habilitacoes) {
    if (h.resultado === 'inabilitado' && !reintegrados.has(h.fornecedorId) && !excluidos.has(h.fornecedorId)) excluidos.set(h.fornecedorId, 'habilitacao');
  }
  for (const id of excluidosPorRecurso) if (!excluidos.has(id)) excluidos.set(id, 'recurso');

  const base = {
    excluidos: [...excluidos].map(([fornecedorId, motivo]) => ({ fornecedorId, motivo })),
    reintegrados: [...reintegrados.keys()],
    convocacaoAtual: null,
    convocacaoAutomatica: false,
    faseRecursal: null,
    recursosExauridos: false,
    alertas,
  };

  if (e.classificacao.length === 0 || e.dataJulgamento === null) {
    return {
      ...base,
      proximoAto: 'registrar_disputa',
      vencedorProvisorio: null,
      pendencia: { regra: 'RN-08', mensagem: 'Registre as propostas da disputa para classificar os licitantes.', fundamento: FUNDAMENTO_DISPUTA },
    };
  }
  if (e.sorteioPendente) {
    return {
      ...base,
      proximoAto: 'registrar_disputa',
      vencedorProvisorio: null,
      pendencia: {
        regra: 'RN-08',
        mensagem: 'O empate persiste após todos os critérios do art. 60: realize o sorteio em ato público e registre o resultado.',
        fundamento: 'Lei 14.133/2021, art. 60',
      },
    };
  }

  const vencedor = e.classificacao.find((id) => !excluidos.has(id)) ?? null;
  if (vencedor === null) {
    return {
      ...base,
      proximoAto: 'fracassada',
      vencedorProvisorio: null,
      pendencia: {
        regra: 'RF-18',
        mensagem:
          'Todos os licitantes classificados foram reprovados, inabilitados ou desclassificados: a licitação está fracassada. Submeta o processo à autoridade superior (art. 71) para decidir sobre a repetição do certame ou a contratação direta (art. 75, III).',
        fundamento: 'Lei 14.133/2021, arts. 71 e 75, III',
      },
    };
  }

  // Prova de conceito ou amostra do vencedor provisório.
  const convocacoes = e.convocacoes.filter((c) => c.fornecedorId === vencedor);
  const convocacao = convocacoes.at(-1) ?? null;
  let convocacaoAtual: AvaliacaoSelecao['convocacaoAtual'] = null;
  if (e.provaConceito.exigida && convocacao) {
    const limite = prazoProvaConceito(convocacao.convocadoEm, e.provaConceito.prazoDiasUteis ?? 1, opcoes).limite;
    convocacaoAtual = { ...convocacao, limite, vencida: convocacao.resultado === null && hoje > limite };
  }
  const reintegrado = reintegrados.has(vencedor);
  const provaOk = !e.provaConceito.exigida || convocacao?.resultado === 'aprovado' || (convocacao?.resultado === 'reprovado' && reintegrado);
  const habilitacao = e.habilitacoes.filter((h) => h.fornecedorId === vencedor).at(-1) ?? null;
  const habilitacaoPorRecurso = habilitacao?.resultado === 'inabilitado' && reintegrado;
  const habilitado = habilitacao?.resultado === 'habilitado' || habilitacaoPorRecurso;

  const pendenteProva = (): AvaliacaoSelecao | null => {
    if (provaOk) return null;
    if (!convocacao) {
      return {
        ...base,
        convocacaoAtual,
        convocacaoAutomatica: e.convocacoes.length > 0,
        proximoAto: 'convocar_prova_conceito',
        vencedorProvisorio: vencedor,
        pendencia: {
          regra: 'RN-20',
          mensagem: `Convoque o licitante provisoriamente vencedor para a prova de conceito ou a amostra prevista no edital (prazo de ${contagem(e.provaConceito.prazoDiasUteis ?? 0, 'dia útil', 'dias úteis')} da convocação).`,
          fundamento: FUNDAMENTO_PROVA_CONCEITO,
        },
      };
    }
    if (convocacaoAtual?.vencida) {
      alertas.push({
        regra: 'RN-20',
        mensagem: `O prazo da prova de conceito ou da amostra venceu em ${formatarData(convocacaoAtual.limite)}: registre o resultado (a ausência no prazo é motivo de reprovação).`,
        fundamento: FUNDAMENTO_PROVA_CONCEITO,
      });
    }
    return {
      ...base,
      convocacaoAtual,
      proximoAto: 'registrar_resultado_prova_conceito',
      vencedorProvisorio: vencedor,
      pendencia: {
        regra: 'RN-20',
        mensagem: `Registre o resultado da prova de conceito ou da amostra (aprovado ou reprovado, com motivação e o link da sessão pública gravada). Prazo do licitante: até ${formatarData(convocacaoAtual?.limite ?? convocacao.convocadoEm)}.`,
        fundamento: FUNDAMENTO_PROVA_CONCEITO,
      },
    };
  };
  const pendenteHabilitacao = (): AvaliacaoSelecao | null => {
    if (habilitado) return null;
    return {
      ...base,
      convocacaoAtual,
      proximoAto: 'registrar_habilitacao',
      vencedorProvisorio: vencedor,
      pendencia: {
        regra: 'RN-22',
        mensagem: 'Registre o resultado da habilitação do licitante provisoriamente vencedor (habilitado ou inabilitado, com motivação).',
        fundamento: FUNDAMENTO_HABILITACAO,
      },
    };
  };
  const primeira = e.inversaoFases ? pendenteHabilitacao() : pendenteProva();
  if (primeira) return primeira;
  const segunda = e.inversaoFases ? pendenteProva() : pendenteHabilitacao();
  if (segunda) return segunda;

  // Fase recursal única, aberta pela ata de habilitação (ou de julgamento, com inversão de fases).
  const datas = [habilitacao?.data, convocacao?.realizadaEm, e.dataJulgamento].filter((d): d is DataISO => typeof d === 'string');
  const dataAto = habilitacaoPorRecurso ? (reintegrados.get(vencedor) ?? hoje) : datas.reduce((a, b) => (a > b ? a : b));
  const recurso = e.recursos.filter((r) => r.vencedorId === vencedor).at(-1) ?? null;
  const encaminhamento = recurso?.reconsideracao?.decisao === 'mantida' ? recurso.reconsideracao.data : null;
  const prazos = prazosRecursoSelecao(dataAto, encaminhamento, opcoes);
  const intencaoAberta = !habilitacaoPorRecurso && (recurso?.intencaoEncerradaEm ?? null) === null && hoje <= dataAto;
  const atoRecorrivel = e.inversaoFases ? 'julgamento' : 'habilitacao';
  const fase = (situacao: SituacaoFaseRecursal): NonNullable<AvaliacaoSelecao['faseRecursal']> => ({ atoRecorrivel, dataAto, situacao, intencaoAberta, prazos });
  const comFase = (situacao: SituacaoFaseRecursal, proximoAto: ProximoAtoSelecao, pendencia: PendenciaSelecao): AvaliacaoSelecao => ({
    ...base,
    convocacaoAtual,
    faseRecursal: fase(situacao),
    proximoAto,
    vencedorProvisorio: vencedor,
    pendencia,
  });

  let situacao: SituacaoFaseRecursal;
  const intencoes = recurso?.intencoes ?? [];
  if (habilitacaoPorRecurso) {
    situacao = 'decidida_em_recurso';
  } else if (intencaoAberta) {
    return comFase('intencao', 'registrar_intencao_recurso', {
      regra: 'RN-22',
      mensagem: `Registre as intenções de recurso manifestadas logo após o ato de ${formatarData(dataAto)} ou encerre o registro sem manifestação (sob pena de preclusão).`,
      fundamento: FUNDAMENTO_INTENCAO,
    });
  } else if (intencoes.length === 0) {
    situacao = 'preclusa';
  } else if (hoje <= prazos.razoes) {
    return comFase('razoes', 'aguardar_razoes', {
      regra: 'RN-22',
      mensagem: `Prazo das razões recursais em curso: até ${formatarData(prazos.razoes)} (3 dias úteis da ata). Depois correm 3 dias úteis de contrarrazões.`,
      fundamento: 'Lei 14.133/2021, art. 165, I, c/c art. 183',
    });
  } else if ((recurso?.razoes.length ?? 0) === 0) {
    situacao = 'deserta';
  } else if (hoje <= prazos.contrarrazoes) {
    return comFase('contrarrazoes', 'aguardar_contrarrazoes', {
      regra: 'RN-22',
      mensagem: `Prazo das contrarrazões em curso: até ${formatarData(prazos.contrarrazoes)} (3 dias úteis contados da divulgação das razões).`,
      fundamento: 'Lei 14.133/2021, art. 165, § 4º, c/c art. 183',
    });
  } else if (!recurso?.reconsideracao) {
    if (hoje > prazos.reconsideracao) {
      alertas.push({
        regra: 'RN-22',
        mensagem: `O prazo de reconsideração venceu em ${formatarData(prazos.reconsideracao)}: decida e, se mantiver o ato, encaminhe à autoridade superior.`,
        fundamento: 'Lei 14.133/2021, art. 165, § 2º',
      });
    }
    return comFase('reconsideracao', 'decidir_reconsideracao', {
      regra: 'RN-22',
      mensagem: `Quem praticou o ato decide se o reconsidera até ${formatarData(prazos.reconsideracao)} (3 dias úteis); mantido o ato, o recurso sobe à autoridade superior.`,
      fundamento: 'Lei 14.133/2021, art. 165, § 2º',
    });
  } else if (!recurso.decisaoSuperior) {
    if (prazos.decisaoSuperior !== null && hoje > prazos.decisaoSuperior) {
      alertas.push({
        regra: 'RN-22',
        mensagem: `O prazo de decisão da autoridade superior venceu em ${formatarData(prazos.decisaoSuperior)}.`,
        fundamento: 'Lei 14.133/2021, art. 165, § 2º',
      });
    }
    return comFase('decisao_superior', 'decidir_recurso', {
      regra: 'RN-22',
      mensagem: `A autoridade superior decide o recurso até ${formatarData(prazos.decisaoSuperior ?? hoje)} (10 dias úteis do recebimento dos autos).`,
      fundamento: 'Lei 14.133/2021, art. 165, § 2º',
    });
  } else {
    situacao = 'improvida';
  }

  // Recursos exauridos: atos da autoridade superior (art. 71, IV).
  const exaurida = { ...base, convocacaoAtual, faseRecursal: fase(situacao), recursosExauridos: true, vencedorProvisorio: vencedor };
  if (e.adjudicacao === null || e.adjudicacao.fornecedorId !== vencedor) {
    return {
      ...exaurida,
      proximoAto: 'adjudicar',
      pendencia: {
        regra: 'RF-18',
        mensagem: 'Recursos exauridos: a autoridade competente deve adjudicar o objeto ao licitante vencedor.',
        fundamento: FUNDAMENTO_ATOS_AUTORIDADE,
      },
    };
  }
  if (e.homologacao === null) {
    return {
      ...exaurida,
      proximoAto: 'homologar',
      pendencia: {
        regra: 'RF-18',
        mensagem: 'Objeto adjudicado: a autoridade competente deve homologar a licitação para que os documentos preparatórios sejam divulgados e o contrato possa ser formalizado.',
        fundamento: `${FUNDAMENTO_ATOS_AUTORIDADE}, e art. 54, § 3º`,
      },
    };
  }
  return { ...exaurida, proximoAto: 'concluida', pendencia: null };
}

export type AtoSelecao =
  | { tipo: 'convocar_prova_conceito' }
  | { tipo: 'registrar_resultado_prova_conceito' }
  | { tipo: 'registrar_habilitacao'; resultado: 'habilitado' | 'inabilitado' }
  | { tipo: 'registrar_intencao_recurso'; fornecedorId: string }
  | { tipo: 'encerrar_intencao_recurso' }
  | { tipo: 'registrar_razoes'; fornecedorId: string }
  | { tipo: 'registrar_contrarrazoes'; fornecedorId: string }
  | { tipo: 'decidir_reconsideracao'; efeito: EfeitoReforma | null }
  | { tipo: 'decidir_recurso'; efeito: EfeitoReforma | null }
  | { tipo: 'adjudicar' }
  | { tipo: 'homologar' };

function foraDeOrdem(mensagem: string): ErroDominio {
  return new ErroDominio('ATO_SELECAO_FORA_DE_ORDEM', mensagem);
}

function validarEfeito(efeito: EfeitoReforma | null, a: AvaliacaoSelecao): void {
  if (efeito?.tipo !== 'reintegrar_licitante') return;
  const excluido = a.excluidos.find((x) => x.fornecedorId === efeito.fornecedorId);
  if (!excluido || excluido.motivo === 'recurso') {
    throw new ErroDominio('ATO_SELECAO_INVALIDO', 'Só pode ser reintegrado licitante reprovado na prova de conceito ou inabilitado.');
  }
}

/**
 * Confere se o ato pode ser praticado agora, na ordem do art. 17 e nos prazos do art. 165. Lança `ErroDominio`
 * (`ATO_SELECAO_FORA_DE_ORDEM` ou `ATO_SELECAO_INVALIDO`) e devolve a avaliação vigente antes do ato.
 */
export function validarAtoSelecao(e: EstadoSelecao, ato: AtoSelecao, hoje: DataISO, opcoes?: OpcoesCalendario): AvaliacaoSelecao {
  const a = avaliarSelecao(e, hoje, opcoes);
  const vencedor = a.vencedorProvisorio;
  const recurso = vencedor === null ? null : (e.recursos.filter((r) => r.vencedorId === vencedor).at(-1) ?? null);
  const naClassificacao = (id: string) => e.classificacao.includes(id);
  switch (ato.tipo) {
    case 'convocar_prova_conceito':
      if (a.proximoAto !== 'convocar_prova_conceito') throw foraDeOrdem('Não há licitante aguardando convocação para a prova de conceito ou a amostra.');
      return a;
    case 'registrar_resultado_prova_conceito':
      if (a.proximoAto !== 'registrar_resultado_prova_conceito') throw foraDeOrdem('Não há prova de conceito ou amostra aguardando resultado.');
      return a;
    case 'registrar_habilitacao': {
      const permitidos: ProximoAtoSelecao[] =
        ato.resultado === 'inabilitado' ? ['convocar_prova_conceito', 'registrar_resultado_prova_conceito', 'registrar_habilitacao'] : ['registrar_habilitacao'];
      if (!permitidos.includes(a.proximoAto)) {
        throw foraDeOrdem(
          ato.resultado === 'habilitado'
            ? 'A habilitação só é registrada depois do julgamento da proposta (e da prova de conceito, quando exigida), salvo inversão de fases.'
            : 'Não há licitante provisoriamente vencedor com habilitação a decidir.',
        );
      }
      return a;
    }
    case 'registrar_intencao_recurso':
      if (a.proximoAto !== 'registrar_intencao_recurso') throw foraDeOrdem('O momento de manifestar intenção de recurso já passou (preclusão) ou ainda não chegou.');
      if (!naClassificacao(ato.fornecedorId) || ato.fornecedorId === vencedor) {
        throw new ErroDominio('ATO_SELECAO_INVALIDO', 'A intenção de recurso é de licitante da disputa diferente do vencedor.');
      }
      if (recurso?.intencoes.some((i) => i.fornecedorId === ato.fornecedorId)) throw new ErroDominio('ATO_SELECAO_INVALIDO', 'Este licitante já manifestou intenção de recurso.');
      return a;
    case 'encerrar_intencao_recurso':
      if (a.proximoAto !== 'registrar_intencao_recurso') throw foraDeOrdem('Não há registro de intenções de recurso em aberto.');
      return a;
    case 'registrar_razoes':
      if (a.faseRecursal === null || (a.faseRecursal.situacao !== 'razoes' && a.faseRecursal.situacao !== 'intencao') || hoje > a.faseRecursal.prazos.razoes) {
        throw foraDeOrdem('O prazo das razões recursais não está em curso.');
      }
      if (!recurso?.intencoes.some((i) => i.fornecedorId === ato.fornecedorId)) {
        throw new ErroDominio('ATO_SELECAO_INVALIDO', 'Só apresenta razões o licitante que manifestou a intenção de recorrer logo após o ato.');
      }
      if (recurso.razoes.some((r) => r.fornecedorId === ato.fornecedorId)) throw new ErroDominio('ATO_SELECAO_INVALIDO', 'As razões deste licitante já foram registradas.');
      return a;
    case 'registrar_contrarrazoes':
      if (!recurso || recurso.razoes.length === 0 || a.faseRecursal === null || hoje > a.faseRecursal.prazos.contrarrazoes) {
        throw foraDeOrdem('Não há razões recursais a contra-arrazoar no prazo.');
      }
      if (!naClassificacao(ato.fornecedorId) || recurso.razoes.some((r) => r.fornecedorId === ato.fornecedorId)) {
        throw new ErroDominio('ATO_SELECAO_INVALIDO', 'As contrarrazões são de licitante da disputa que não recorreu.');
      }
      if (recurso.contrarrazoes.some((c) => c.fornecedorId === ato.fornecedorId)) {
        throw new ErroDominio('ATO_SELECAO_INVALIDO', 'As contrarrazões deste licitante já foram registradas.');
      }
      return a;
    case 'decidir_reconsideracao':
      if (a.proximoAto !== 'decidir_reconsideracao') throw foraDeOrdem('A reconsideração só é decidida depois de encerrados os prazos de razões e contrarrazões.');
      validarEfeito(ato.efeito, a);
      return a;
    case 'decidir_recurso':
      if (a.proximoAto !== 'decidir_recurso') throw foraDeOrdem('O recurso só sobe à autoridade superior quando o ato recorrido é mantido.');
      validarEfeito(ato.efeito, a);
      return a;
    case 'adjudicar':
      if (a.proximoAto !== 'adjudicar') throw foraDeOrdem('A adjudicação exige o julgamento, a habilitação e os recursos exauridos (art. 71).');
      return a;
    case 'homologar':
      if (a.proximoAto !== 'homologar') throw foraDeOrdem('A homologação exige o objeto adjudicado (art. 71, IV).');
      return a;
    default: {
      const desconhecido: never = ato;
      throw new ErroDominio('ATO_SELECAO_INVALIDO', `Ato desconhecido: ${String((desconhecido as { tipo?: string }).tipo)}.`);
    }
  }
}
