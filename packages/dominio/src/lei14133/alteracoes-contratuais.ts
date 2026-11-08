/**
 * Execução contratual como ato (F22, frente K): termo aditivo com as travas do art. 125 (RN-32), prorrogação com os
 * limites dos arts. 105 a 114 (RN-33), reajuste e repactuação por apostila (arts. 25, § 7º, 92, § 3º, 135 e 136),
 * reequilíbrio econômico-financeiro (art. 124, II, "d") e extinção do contrato (arts. 137 a 139).
 *
 * Funções puras e determinísticas: "hoje" entra como parâmetro. As funções avaliam e explicam; quem decide é sempre a
 * autoridade competente, com registro na trilha de auditoria da API.
 */
import { formatarData, type DataISO, type OpcoesCalendario } from '../datas.ts';
import { ErroDominio } from '../erros.ts';
import { adicionarMeses, contagem, escreverData, exigirFinito, exigirInteiro, formatarPercentualTexto, lerData } from '../interno.ts';
import { aplicarPercentual, formatarMoeda, percentual, type Centavos } from '../moeda.ts';
import { avaliarAditivo } from './aditivos.ts';
import { prazoDivulgacaoContratoPncp } from './prazos.ts';

// ───────────────────────── Tipos ─────────────────────────

/** Natureza do contrato quanto à duração (arts. 105 a 114). */
export type NaturezaDuracaoContrato = 'continuo' | 'ti_estruturante' | 'escopo' | 'receita_sem_investimento' | 'receita_com_investimento';

export const NATUREZAS_DURACAO: readonly NaturezaDuracaoContrato[] = [
  'continuo',
  'ti_estruturante',
  'escopo',
  'receita_sem_investimento',
  'receita_com_investimento',
];

/** Tipos de termo aditivo tratados pela RN-32 (o reequilíbrio também é formalizado por termo aditivo). */
export type TipoTermoAditivo = 'acrescimo' | 'supressao' | 'qualitativa' | 'prazo' | 'reequilibrio';

/** Reflexo financeiro da alteração qualitativa (art. 124, I, "a"). */
export type EfeitoFinanceiroQualitativa = 'acrescimo' | 'supressao' | 'nenhum';

/** Enquadramento do pedido de reequilíbrio (art. 124, II, "d"; art. 134; art. 103, § 5º). */
export type EnquadramentoReequilibrio =
  | 'forca_maior'
  | 'caso_fortuito'
  | 'fato_principe'
  | 'fato_imprevisivel'
  | 'previsivel_consequencias_incalculaveis'
  | 'tributo_superveniente'
  | 'alteracao_unilateral';

/** Quem assumiu o risco na matriz de riscos do contrato; `nao_previsto` quando o evento não consta da matriz. */
export type AlocacaoRiscoReequilibrio = 'contratante' | 'contratada' | 'compartilhado' | 'nao_previsto';

/** Formas de extinção (art. 138). */
export type FormaExtincao = 'unilateral' | 'consensual' | 'judicial_arbitral';

/** Motivos de extinção: art. 137, I a IX (pela Administração), e art. 137, § 2º, I a V (direito do contratado). */
export type MotivoExtincao =
  | 'art137_I'
  | 'art137_II'
  | 'art137_III'
  | 'art137_IV'
  | 'art137_V'
  | 'art137_VI'
  | 'art137_VII'
  | 'art137_VIII'
  | 'art137_IX'
  | 'art137_p2_I'
  | 'art137_p2_II'
  | 'art137_p2_III'
  | 'art137_p2_IV'
  | 'art137_p2_V';

export const MOTIVOS_EXTINCAO: Readonly<Record<MotivoExtincao, string>> = Object.freeze({
  art137_I: 'Não cumprimento ou cumprimento irregular de normas editalícias ou de cláusulas contratuais, de especificações, de projetos ou de prazos (art. 137, I)',
  art137_II: 'Desatendimento das determinações regulares emitidas pela autoridade designada para acompanhar e fiscalizar a execução (art. 137, II)',
  art137_III: 'Alteração social ou modificação da finalidade ou da estrutura da empresa que restrinja sua capacidade de concluir o contrato (art. 137, III)',
  art137_IV: 'Decretação de falência ou de insolvência civil, dissolução da sociedade ou falecimento do contratado (art. 137, IV)',
  art137_V: 'Caso fortuito ou força maior, regularmente comprovados, impeditivos da execução do contrato (art. 137, V)',
  art137_VI: 'Atraso na obtenção da licença ambiental, ou impossibilidade de obtê-la, ou alteração substancial do anteprojeto (art. 137, VI)',
  art137_VII: 'Atraso na liberação das áreas sujeitas a desapropriação, a desocupação ou a servidão administrativa (art. 137, VII)',
  art137_VIII: 'Razões de interesse público, justificadas pela autoridade máxima do órgão ou da entidade contratante (art. 137, VIII)',
  art137_IX: 'Não cumprimento das obrigações relativas à reserva de cargos para pessoa com deficiência, reabilitado da Previdência Social ou aprendiz (art. 137, IX)',
  art137_p2_I: 'Supressão, por parte da Administração, de obras, serviços ou compras que acarrete modificação do valor inicial além do limite do art. 125 (art. 137, § 2º, I)',
  art137_p2_II: 'Suspensão da execução, por ordem escrita da Administração, por prazo superior a 3 meses (art. 137, § 2º, II)',
  art137_p2_III: 'Repetidas suspensões que totalizem 90 dias úteis (art. 137, § 2º, III)',
  art137_p2_IV: 'Atraso superior a 2 meses dos pagamentos ou de parcelas de pagamentos devidos pela Administração (art. 137, § 2º, IV)',
  art137_p2_V: 'Não liberação pela Administração, nos prazos contratuais, de área, local ou objeto, ou das fontes de materiais naturais especificadas no projeto (art. 137, § 2º, V)',
});

/** Consequências da extinção unilateral (art. 139) e direitos do contratado na extinção por culpa da Administração (art. 138, § 2º). */
export type EfeitoExtincao =
  | 'assuncao_objeto'
  | 'ocupacao_local'
  | 'execucao_garantia'
  | 'retencao_creditos'
  | 'devolucao_garantia'
  | 'pagamentos_devidos'
  | 'custo_desmobilizacao'
  | 'ressarcimento_prejuizos';

export const EFEITOS_EXTINCAO: Readonly<Record<EfeitoExtincao, string>> = Object.freeze({
  assuncao_objeto: 'Assunção imediata do objeto do contrato, no estado e no local em que se encontrar (art. 139, I)',
  ocupacao_local: 'Ocupação e utilização do local, das instalações, dos equipamentos, do material e do pessoal empregados na execução (art. 139, II)',
  execucao_garantia: 'Execução da garantia contratual, para ressarcimento de prejuízos, verbas trabalhistas, multas devidas ou conclusão do objeto pela seguradora (art. 139, III)',
  retencao_creditos: 'Retenção dos créditos decorrentes do contrato até o limite dos prejuízos causados e das multas aplicadas (art. 139, IV)',
  devolucao_garantia: 'Devolução da garantia ao contratado (art. 138, § 2º, I)',
  pagamentos_devidos: 'Pagamentos devidos pela execução do contrato até a data da extinção (art. 138, § 2º, II)',
  custo_desmobilizacao: 'Pagamento do custo da desmobilização (art. 138, § 2º, III)',
  ressarcimento_prejuizos: 'Ressarcimento dos prejuízos regularmente comprovados sofridos pelo contratado (art. 138, § 2º, caput)',
});

const EFEITOS_ART_139: readonly EfeitoExtincao[] = ['assuncao_objeto', 'ocupacao_local', 'execucao_garantia', 'retencao_creditos'];
const EFEITOS_ART_138_P2: readonly EfeitoExtincao[] = ['devolucao_garantia', 'pagamentos_devidos', 'custo_desmobilizacao', 'ressarcimento_prejuizos'];

const MINIMO_JUSTIFICATIVA = 30;
const MINIMO_DEMONSTRACAO = 50;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

function exigirData(valor: unknown, campo: string): number {
  if (typeof valor !== 'string') throw new ErroDominio('DATA_INVALIDA', `${campo} é obrigatória.`);
  return lerData(valor, campo);
}

/** Último dia da vigência máxima contada do início: início + N anos − 1 dia. */
function limiteDecorrente(inicio: DataISO, anos: number): DataISO {
  const fim = adicionarMeses(inicio, 12 * anos);
  return escreverDiaAnterior(fim);
}

function escreverDiaAnterior(d: DataISO): DataISO {
  return escreverData(lerData(d) - 1);
}

// ───────────────────────── Numeração ─────────────────────────

/**
 * Número do termo para o histórico e o PDF: "3º Termo Aditivo", "2º Apostilamento" ou "Termo de Rescisão".
 * Fundamento: Lei 14.133/2021, arts. 124 (termo aditivo), 136 (apostila) e 138, § 1º (extinção reduzida a termo).
 */
export function numeroTermoContratual(especie: 'aditivo' | 'apostila' | 'rescisao', sequencial: number): string {
  if (especie === 'rescisao') return 'Termo de Rescisão';
  exigirInteiro(sequencial, 'sequencial', 'TERMO_INVALIDO', 1);
  return `${sequencial}º ${especie === 'aditivo' ? 'Termo Aditivo' : 'Apostilamento'}`;
}

// ───────────────────────── RN-32: termo aditivo ─────────────────────────

export interface EntradaTermoAditivo {
  tipo: TipoTermoAditivo;
  /** Valor da alteração em centavos (sempre ≥ 0; o sentido vem do tipo ou do efeito). */
  valor: Centavos;
  /** Alteração qualitativa: reflexo no valor do contrato. */
  efeitoFinanceiro?: EfeitoFinanceiroQualitativa;
  /** Reequilíbrio: aumenta ou reduz o valor do contrato. */
  sentido?: 'aumento' | 'reducao';
  reformaEdificioOuEquipamento?: boolean;
  /** Valor inicial do contrato atualizado pelos reajustes (base do art. 125). */
  valorInicialAtualizado: Centavos;
  acrescimosAnteriores: Centavos;
  supressoesAnteriores: Centavos;
  justificativa: string;
  vigenciaFim: DataISO;
  hoje: DataISO;
  contratoExtinto?: boolean;
}

export interface AvaliacaoTermoAditivo {
  permitido: boolean;
  motivos: string[];
  /** Efeito no valor global (centavos, com sinal): acréscimo positivo, supressão negativa. */
  efeitoValor: Centavos;
  /** Como a alteração conta para o art. 125: acréscimo, supressão ou fora do limite (prazo, reequilíbrio, qualitativa sem valor). */
  contaNoLimite: 'acrescimo' | 'supressao' | null;
  limitePercentual: number | null;
  percentualAcumulado: number | null;
  margemRestante: Centavos | null;
  explicacao: string;
  fundamento: string;
}

/**
 * RN-32 — trava do termo aditivo. Acréscimos e supressões (quantitativos ou de alteração qualitativa com reflexo no
 * valor) somam-se separadamente, sem compensação, e não podem passar de 25% do valor inicial atualizado (50% para
 * acréscimos em reforma de edifício ou de equipamento). Acima do limite a alteração é recusada. O aditivo exige
 * justificativa (art. 124, caput) e só é celebrado durante a vigência e com o contrato não extinto. Prorrogação e
 * reequilíbrio não contam para o limite do art. 125: têm travas próprias (`avaliarProrrogacao` e
 * `avaliarReequilibrio`). Fundamento: Lei 14.133/2021, arts. 124, 125 e 53, § 4º (controle prévio de legalidade).
 */
export function avaliarTermoAditivo(e: EntradaTermoAditivo): AvaliacaoTermoAditivo {
  exigirInteiro(e.valor, 'valor', 'ADITIVO_INVALIDO', 0);
  exigirInteiro(e.valorInicialAtualizado, 'valorInicialAtualizado', 'ADITIVO_INVALIDO', 1);
  exigirInteiro(e.acrescimosAnteriores, 'acrescimosAnteriores', 'ADITIVO_INVALIDO', 0);
  exigirInteiro(e.supressoesAnteriores, 'supressoesAnteriores', 'ADITIVO_INVALIDO', 0);
  const hoje = exigirData(e.hoje, 'hoje');
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  if (!['acrescimo', 'supressao', 'qualitativa', 'prazo', 'reequilibrio'].includes(e.tipo)) {
    throw new ErroDominio('ADITIVO_INVALIDO', `Tipo de termo aditivo inválido: ${String(e.tipo)}.`);
  }
  const motivos: string[] = [];
  if (e.contratoExtinto === true) motivos.push('O contrato foi extinto: não cabe termo aditivo (art. 138).');
  if (hoje > fim && e.tipo !== 'prazo') {
    motivos.push(`A vigência terminou em ${formatarData(e.vigenciaFim)}: o termo aditivo só pode ser celebrado durante a vigência do contrato.`);
  }
  if (texto(e.justificativa).length < MINIMO_JUSTIFICATIVA) {
    motivos.push(`Justifique a alteração com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres (art. 124, caput).`);
  }

  let contaNoLimite: 'acrescimo' | 'supressao' | null = null;
  let efeitoValor = 0;
  switch (e.tipo) {
    case 'acrescimo':
    case 'supressao':
      if (e.valor <= 0) motivos.push('Informe o valor do acréscimo ou da supressão.');
      contaNoLimite = e.tipo;
      efeitoValor = e.tipo === 'acrescimo' ? e.valor : -e.valor;
      break;
    case 'qualitativa': {
      const efeito = e.efeitoFinanceiro ?? 'nenhum';
      if (!['acrescimo', 'supressao', 'nenhum'].includes(efeito)) throw new ErroDominio('ADITIVO_INVALIDO', 'Reflexo financeiro inválido.');
      if (efeito === 'nenhum' && e.valor !== 0) motivos.push('Alteração qualitativa sem reflexo financeiro não tem valor: informe zero ou indique o reflexo.');
      if (efeito !== 'nenhum' && e.valor <= 0) motivos.push('Informe o valor do reflexo financeiro da alteração qualitativa.');
      contaNoLimite = efeito === 'nenhum' ? null : efeito;
      efeitoValor = efeito === 'acrescimo' ? e.valor : efeito === 'supressao' ? -e.valor : 0;
      break;
    }
    case 'prazo':
      efeitoValor = e.valor;
      break;
    case 'reequilibrio':
      if (e.valor <= 0) motivos.push('Informe o valor do reequilíbrio.');
      efeitoValor = e.sentido === 'reducao' ? -e.valor : e.valor;
      break;
  }

  let limitePercentual: number | null = null;
  let percentualAcumulado: number | null = null;
  let margemRestante: Centavos | null = null;
  let explicacaoLimite = '';
  if (contaNoLimite !== null && e.valor > 0) {
    const limite = avaliarAditivo({
      valorInicialAtualizado: e.valorInicialAtualizado,
      acrescimosAnteriores: e.acrescimosAnteriores,
      supressoesAnteriores: e.supressoesAnteriores,
      tipo: contaNoLimite,
      valor: e.valor,
      reformaEdificioOuEquipamento: e.reformaEdificioOuEquipamento === true,
    });
    limitePercentual = limite.limitePercentual;
    percentualAcumulado = limite.percentualAcumulado;
    margemRestante = limite.margemRestante;
    explicacaoLimite = limite.explicacao;
    if (!limite.permitido) {
      motivos.push(
        `${contaNoLimite === 'acrescimo' ? 'Acréscimos' : 'Supressões'} acumulados chegariam a ${formatarPercentualTexto(limite.percentualAcumulado)} do valor inicial atualizado, acima do limite de ${limite.limitePercentual}% (art. 125). Trava RN-32: a alteração não pode ser registrada.`,
      );
    }
  }

  const permitido = motivos.length === 0;
  const foraDoLimite =
    e.tipo === 'prazo'
      ? 'A prorrogação não conta para o limite do art. 125; segue as travas dos arts. 105 a 114 (RN-33).'
      : e.tipo === 'reequilibrio'
        ? 'O reequilíbrio econômico-financeiro não conta para o limite do art. 125 (art. 124, II, "d").'
        : contaNoLimite === null
          ? 'Alteração qualitativa sem reflexo financeiro: não altera o percentual do art. 125.'
          : '';
  const explicacao = [explicacaoLimite, foraDoLimite, permitido ? 'A alteração pode seguir para o parecer jurídico e a assinatura.' : 'A alteração foi recusada.']
    .filter((t) => t !== '')
    .join(' ');
  return {
    permitido,
    motivos,
    efeitoValor: efeitoValor + 0,
    contaNoLimite,
    limitePercentual,
    percentualAcumulado,
    margemRestante,
    explicacao,
    fundamento: 'Lei 14.133/2021, arts. 124 e 125',
  };
}

// ───────────────────────── RN-33: prorrogação ─────────────────────────

/** Vigência máxima, em anos, contada do início do contrato; null quando a lei não fixa teto (escopo, art. 111). */
export function vigenciaMaximaAnos(natureza: NaturezaDuracaoContrato): number | null {
  switch (natureza) {
    case 'continuo':
      return 10;
    case 'ti_estruturante':
      return 15;
    case 'receita_sem_investimento':
      return 10;
    case 'receita_com_investimento':
      return 35;
    case 'escopo':
      return null;
    default:
      throw new ErroDominio('PRORROGACAO_INVALIDA', `Natureza do contrato inválida: ${String(natureza)}.`);
  }
}

const FUNDAMENTO_NATUREZA: Record<NaturezaDuracaoContrato, string> = {
  continuo: 'arts. 106 e 107 (serviços e fornecimentos contínuos: até 5 anos, prorrogáveis até 10)',
  ti_estruturante: 'art. 114 (operação continuada de sistemas estruturantes de TI: até 15 anos)',
  escopo: 'art. 111 (escopo predefinido: prorrogação automática quando o objeto não é concluído no prazo)',
  receita_sem_investimento: 'art. 110, I (contrato que gera receita, sem investimento: até 10 anos)',
  receita_com_investimento: 'art. 110, II (contrato que gera receita, com investimento: até 35 anos)',
};

export interface EntradaProrrogacao {
  natureza: NaturezaDuracaoContrato;
  vigenciaInicio: DataISO;
  vigenciaFimAtual: DataISO;
  novaVigenciaFim: DataISO;
  hoje: DataISO;
  /** Autoridade competente atesta que as condições e os preços permanecem vantajosos (art. 107). */
  vantajosidadeAtestada?: boolean;
  /** Preço compatível com o mercado, conferido por pesquisa de preços (art. 107; art. 23). */
  precoCompativel?: boolean;
  /** Prorrogação prevista no edital (art. 107). */
  previsaoEdital?: boolean;
  /** Créditos orçamentários disponíveis no exercício (art. 105). */
  creditoOrcamentario?: boolean;
  /** Escopo: causa da não conclusão no prazo (art. 111). */
  causaAtraso?: 'sem_culpa_contratado' | 'culpa_contratado';
  /** Escopo com culpa do contratado: mora constituída, com as sanções cabíveis (art. 111, parágrafo único, I). */
  moraConstituida?: boolean;
  contratoExtinto?: boolean;
}

export interface AvaliacaoProrrogacao {
  permitido: boolean;
  motivos: string[];
  /** Último dia admitido pela vigência máxima da natureza; null sem teto legal. */
  limiteVigencia: DataISO | null;
  /** Duração total, em dias, do início do contrato até a nova data de fim. */
  duracaoTotalDias: number;
  prorrogacaoAutomatica: boolean;
  explicacao: string;
  fundamento: string;
}

/**
 * RN-33 — trava da prorrogação. Serviços e fornecimentos contínuos: até 10 anos contados do início (art. 107), com
 * previsão no edital, vantajosidade atestada pela autoridade e preço compatível com o mercado. Sistemas estruturantes
 * de TI: até 15 anos (art. 114). Contratos que geram receita: 10 ou 35 anos (art. 110). Escopo predefinido: a
 * vigência se prorroga automaticamente quando o objeto não é concluído sem culpa do contratado; com culpa, só depois
 * de constituída a mora (art. 111). Em todos os casos, créditos orçamentários (art. 105) — salvo contrato de receita —
 * e formalização durante a vigência (exceto a prorrogação automática do escopo).
 */
export function avaliarProrrogacao(e: EntradaProrrogacao): AvaliacaoProrrogacao {
  const teto = vigenciaMaximaAnos(e.natureza);
  const inicio = exigirData(e.vigenciaInicio, 'vigenciaInicio');
  const fimAtual = exigirData(e.vigenciaFimAtual, 'vigenciaFimAtual');
  const novoFim = exigirData(e.novaVigenciaFim, 'novaVigenciaFim');
  const hoje = exigirData(e.hoje, 'hoje');
  const motivos: string[] = [];
  if (e.contratoExtinto === true) motivos.push('O contrato foi extinto: não cabe prorrogação (art. 138).');
  if (novoFim <= fimAtual) motivos.push(`A nova data de fim deve ser posterior ao fim atual da vigência (${formatarData(e.vigenciaFimAtual)}).`);

  let prorrogacaoAutomatica = false;
  const receita = e.natureza === 'receita_sem_investimento' || e.natureza === 'receita_com_investimento';
  if (e.natureza === 'escopo') {
    if (e.causaAtraso === undefined) {
      motivos.push('Informe se a não conclusão do objeto no prazo decorre ou não de culpa do contratado (art. 111).');
    } else if (e.causaAtraso === 'sem_culpa_contratado') {
      prorrogacaoAutomatica = true;
    } else if (e.moraConstituida !== true) {
      motivos.push(
        'Com culpa do contratado, a vigência não se prorroga automaticamente: constitua o contratado em mora, com as sanções cabíveis (art. 111, parágrafo único, I), ou decida pela extinção do contrato (art. 111, parágrafo único, II).',
      );
    }
  } else {
    if (hoje > fimAtual) {
      motivos.push(`A vigência terminou em ${formatarData(e.vigenciaFimAtual)}: a prorrogação deve ser formalizada antes do fim da vigência.`);
    }
    if (e.previsaoEdital !== true) motivos.push('Confirme que o edital prevê a prorrogação (art. 107).');
    if (!receita) {
      if (e.vantajosidadeAtestada !== true) {
        motivos.push('A autoridade competente deve atestar que as condições e os preços permanecem vantajosos para a Administração (art. 107).');
      }
      if (e.precoCompativel !== true) motivos.push('Confirme, com pesquisa de preços, que o preço contratado continua compatível com o mercado (art. 107).');
    }
  }
  if (!receita && e.creditoOrcamentario !== true) {
    motivos.push('Confirme a disponibilidade de créditos orçamentários para o exercício e, se ultrapassar o exercício, a previsão no plano plurianual (art. 105).');
  }

  const limiteVigencia = teto === null ? null : limiteDecorrente(e.vigenciaInicio, teto);
  if (limiteVigencia !== null && novoFim > lerData(limiteVigencia)) {
    motivos.push(
      `A nova data de fim ultrapassa a vigência máxima de ${teto} anos contada do início em ${formatarData(e.vigenciaInicio)} (limite: ${formatarData(limiteVigencia)}). Trava RN-33: para continuar, é preciso nova licitação.`,
    );
  }
  const duracaoTotalDias = novoFim - inicio + 1;
  const permitido = motivos.length === 0;
  const regra = `Natureza: ${FUNDAMENTO_NATUREZA[e.natureza]}.`;
  const limiteTexto = limiteVigencia === null ? 'Sem teto legal de vigência.' : `Vigência máxima até ${formatarData(limiteVigencia)}.`;
  const resultado = permitido
    ? prorrogacaoAutomatica
      ? `Prorrogação automática registrada até ${formatarData(e.novaVigenciaFim)} (art. 111, caput).`
      : `Prorrogação admitida até ${formatarData(e.novaVigenciaFim)}.`
    : 'Prorrogação recusada.';
  return {
    permitido,
    motivos,
    limiteVigencia,
    duracaoTotalDias,
    prorrogacaoAutomatica,
    explicacao: `${regra} ${limiteTexto} ${resultado}`,
    fundamento: 'Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114',
  };
}

export interface AlertaProrrogacao {
  tipo: 'planejar_prorrogacao' | 'limite_prorrogacao' | 'nova_licitacao' | 'prorrogacao_automatica' | 'natureza_nao_informada';
  diasRestantes: number;
  limiteVigencia: DataISO | null;
  mensagem: string;
  fundamento: string;
}

/**
 * Alerta de prorrogação para os avisos de 120 dias da central de notificações: a partir de 120 dias do fim da
 * vigência, diz se cabe prorrogar (e até quando), se a próxima prorrogação fica limitada pela vigência máxima ou se
 * é preciso nova licitação; no escopo, lembra a prorrogação automática do art. 111. Devolve null fora da janela
 * (mais de 120 dias ou vigência encerrada). Fundamento: Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114.
 */
export function avaliarAlertaProrrogacao(e: {
  natureza: NaturezaDuracaoContrato | null;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  hoje: DataISO;
}): AlertaProrrogacao | null {
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  const hoje = exigirData(e.hoje, 'hoje');
  exigirData(e.vigenciaInicio, 'vigenciaInicio');
  const diasRestantes = fim - hoje;
  if (diasRestantes < 0 || diasRestantes > 120) return null;
  return situacaoProrrogacao({ ...e, diasRestantes });
}

/** Situação da prorrogação do contrato a qualquer tempo (aba Alterações), com a mesma regra do alerta. */
export function situacaoProrrogacao(e: {
  natureza: NaturezaDuracaoContrato | null;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  hoje: DataISO;
  diasRestantes?: number;
}): AlertaProrrogacao {
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  const diasRestantes = e.diasRestantes ?? fim - exigirData(e.hoje, 'hoje');
  const fundamento = 'Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114';
  if (e.natureza === null) {
    return {
      tipo: 'natureza_nao_informada',
      diasRestantes,
      limiteVigencia: null,
      mensagem: 'informe a natureza do contrato quanto à duração (contínuo, escopo, TI estruturante ou receita) para conferir o limite de prorrogação.',
      fundamento,
    };
  }
  const teto = vigenciaMaximaAnos(e.natureza);
  if (teto === null) {
    return {
      tipo: 'prorrogacao_automatica',
      diasRestantes,
      limiteVigencia: null,
      mensagem:
        'contrato por escopo: se o objeto não for concluído no prazo sem culpa do contratado, a vigência se prorroga automaticamente (art. 111) — registre a prorrogação; com culpa, constitua a mora ou avalie a extinção.',
      fundamento,
    };
  }
  const limite = limiteDecorrente(e.vigenciaInicio, teto);
  const folga = lerData(limite) - fim;
  if (folga <= 0) {
    return {
      tipo: 'nova_licitacao',
      diasRestantes,
      limiteVigencia: limite,
      mensagem: `a vigência máxima de ${teto} anos termina em ${formatarData(limite)}: não cabe nova prorrogação — inicie a nova licitação (DFD e ETP) a tempo de evitar a descontinuidade.`,
      fundamento,
    };
  }
  if (folga < 365) {
    return {
      tipo: 'limite_prorrogacao',
      diasRestantes,
      limiteVigencia: limite,
      mensagem: `a próxima prorrogação fica limitada a ${formatarData(limite)} (vigência máxima de ${teto} anos, ${contagem(folga, 'dia', 'dias')} além do fim atual); planeje desde já a nova licitação.`,
      fundamento,
    };
  }
  return {
    tipo: 'planejar_prorrogacao',
    diasRestantes,
    limiteVigencia: limite,
    mensagem: `prorrogação possível até ${formatarData(limite)} (vigência máxima de ${teto} anos), com previsão no edital, vantajosidade atestada, preço compatível, regularidade do contratado (art. 91, § 4º) e crédito orçamentário.`,
    fundamento,
  };
}

// ───────────────────────── Reajuste e repactuação (apostila) ─────────────────────────

export interface EntradaReajuste {
  /** Data do orçamento estimado (data-base do reajuste, art. 25, § 7º, e art. 92, § 3º). */
  dataBase: DataISO;
  /** Reajustes já aplicados ao contrato (cada um cumpre um interregno de 12 meses). */
  ciclosAplicados: number;
  hoje: DataISO;
  /** Variação acumulada do índice contratual no período, em % (pode ser negativa). */
  percentual: number;
  /** Saldo do contrato sobre o qual incide o reajuste (obrigações após a anualidade). */
  saldoContratual: Centavos;
  indice: string;
  vigenciaFim: DataISO;
  contratoExtinto?: boolean;
}

export interface AvaliacaoReajuste {
  permitido: boolean;
  motivos: string[];
  /** Data em que se completa o interregno de 12 meses do ciclo pedido. */
  aniversario: DataISO;
  periodo: { inicio: DataISO; fim: DataISO };
  valor: Centavos;
  explicacao: string;
  fundamento: string;
}

/**
 * Reajuste em sentido estrito por apostila: só depois de 12 meses contados da data do orçamento estimado (e de 12 em
 * 12 meses a partir daí), pelo índice do contrato, sobre o saldo das obrigações a executar. Antes do aniversário o
 * pedido é recusado. Fundamento: Lei 14.133/2021, art. 25, § 7º, art. 92, V e § 3º, e art. 136, I.
 */
export function avaliarReajuste(e: EntradaReajuste): AvaliacaoReajuste {
  exigirData(e.dataBase, 'dataBase');
  const hoje = exigirData(e.hoje, 'hoje');
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  exigirInteiro(e.ciclosAplicados, 'ciclosAplicados', 'REAJUSTE_INVALIDO', 0);
  exigirInteiro(e.saldoContratual, 'saldoContratual', 'REAJUSTE_INVALIDO', 0);
  exigirFinito(e.percentual, 'percentual', 'REAJUSTE_INVALIDO');
  const indice = texto(e.indice) || 'índice do contrato';
  const inicioCiclo = adicionarMeses(e.dataBase, 12 * e.ciclosAplicados);
  const aniversario = adicionarMeses(e.dataBase, 12 * (e.ciclosAplicados + 1));
  const periodo = { inicio: inicioCiclo, fim: escreverDiaAnterior(aniversario) };
  const motivos: string[] = [];
  if (e.contratoExtinto === true) motivos.push('O contrato foi extinto: não cabe reajuste por apostila.');
  if (hoje < lerData(aniversario)) {
    motivos.push(
      `O interregno mínimo de 12 meses contado da data-base (${formatarData(e.dataBase)}) só se completa em ${formatarData(aniversario)}: o reajuste antes disso é vedado (art. 25, § 7º, e art. 92, § 3º).`,
    );
  }
  if (lerData(aniversario) > fim) motivos.push(`O aniversário de ${formatarData(aniversario)} cai depois do fim da vigência (${formatarData(e.vigenciaFim)}).`);
  if (e.percentual === 0) motivos.push('Informe a variação do índice no período (diferente de zero).');
  if (e.percentual <= -100 || e.percentual > 100) motivos.push('A variação do índice deve estar entre −100% e 100%.');
  const valor = motivos.length === 0 ? aplicarPercentual(e.saldoContratual, e.percentual) : 0;
  const permitido = motivos.length === 0;
  const explicacao = permitido
    ? `Reajuste pelo ${indice} de ${formatarPercentualTexto(e.percentual)} no período de ${formatarData(periodo.inicio)} a ${formatarData(periodo.fim)}, sobre o saldo de ${formatarMoeda(e.saldoContratual)}: ${formatarMoeda(valor)}. Registro por apostila (art. 136, I).`
    : 'Reajuste recusado.';
  return { permitido, motivos, aniversario, periodo, valor, explicacao, fundamento: 'Lei 14.133/2021, art. 25, § 7º, art. 92, § 3º, e art. 136, I' };
}

export interface ComponenteRepactuacao {
  descricao: string;
  origem: 'mao_de_obra' | 'insumos';
  /** Data a que o componente está vinculado: acordo, convenção ou dissídio anterior (mão de obra) ou proposta/última repactuação (insumos). */
  dataBase: DataISO;
  valorMensalAnterior: Centavos;
  valorMensalNovo: Centavos;
  /** Acordo, convenção, dissídio ou planilha que fundamenta a variação. */
  documento: string;
}

export interface EntradaRepactuacao {
  regimeMaoDeObra: 'dedicacao_exclusiva' | 'predominancia' | 'sem_dedicacao' | null;
  natureza: NaturezaDuracaoContrato | null;
  solicitadaEm: DataISO;
  efeitosDesde: DataISO;
  vigenciaFim: DataISO;
  hoje: DataISO;
  componentes: readonly ComponenteRepactuacao[];
  /** Confirmação de que cláusulas coletivas de matéria não trabalhista foram desconsideradas (art. 135, §§ 1º e 2º). */
  clausulasNaoTrabalhistasExcluidas: boolean;
  contratoExtinto?: boolean;
}

export interface AvaliacaoRepactuacao {
  permitido: boolean;
  motivos: string[];
  componentes: (ComponenteRepactuacao & { variacaoMensal: Centavos; percentual: number; anualidade: DataISO; anualidadeCumprida: boolean })[];
  variacaoMensal: Centavos;
  mesesRemanescentes: number;
  valor: Centavos;
  explicacao: string;
  fundamento: string;
}

/** Meses (arredondando para cima o mês parcial) entre `desde` e `ate`, inclusive. */
function mesesAte(desde: DataISO, ate: DataISO): number {
  const inicio = lerData(desde);
  const fim = lerData(ate);
  if (fim < inicio) return 0;
  let meses = 0;
  while (lerData(adicionarMeses(desde, meses)) <= fim) meses++;
  return meses;
}

/**
 * Repactuação de serviço contínuo com dedicação exclusiva ou predominância de mão de obra, com demonstração analítica
 * da variação dos custos: cada componente cumpre o interregno de 1 ano contado da sua data-base (proposta, última
 * repactuação ou acordo/convenção coletiva). O impacto é a variação mensal vezes os meses de vigência a partir do
 * início dos efeitos. Registro por apostila. Fundamento: Lei 14.133/2021, art. 135 e art. 136, I.
 */
export function avaliarRepactuacao(e: EntradaRepactuacao): AvaliacaoRepactuacao {
  const solicitada = exigirData(e.solicitadaEm, 'solicitadaEm');
  const hoje = exigirData(e.hoje, 'hoje');
  exigirData(e.efeitosDesde, 'efeitosDesde');
  exigirData(e.vigenciaFim, 'vigenciaFim');
  const motivos: string[] = [];
  if (e.contratoExtinto === true) motivos.push('O contrato foi extinto: não cabe repactuação por apostila.');
  if (e.regimeMaoDeObra !== 'dedicacao_exclusiva' && e.regimeMaoDeObra !== 'predominancia') {
    motivos.push('A repactuação só se aplica a serviço contínuo com regime de dedicação exclusiva ou predominância de mão de obra (art. 135, caput).');
  }
  if (e.natureza !== null && e.natureza !== 'continuo' && e.natureza !== 'ti_estruturante') {
    motivos.push('A repactuação é própria dos serviços contínuos (art. 25, § 8º, II, e art. 135).');
  }
  if (solicitada > hoje) motivos.push('A data do pedido não pode ser futura.');
  if (e.componentes.length === 0) motivos.push('Apresente a demonstração analítica: ao menos um componente de custo (art. 135, § 6º).');
  if (e.clausulasNaoTrabalhistasExcluidas !== true) {
    motivos.push('Confirme que foram desconsideradas as cláusulas coletivas de matéria não trabalhista ou que só obriguem a Administração (art. 135, §§ 1º e 2º).');
  }
  const componentes = e.componentes.map((c, i) => {
    exigirInteiro(c.valorMensalAnterior, `componentes[${i}].valorMensalAnterior`, 'REPACTUACAO_INVALIDA', 0);
    exigirInteiro(c.valorMensalNovo, `componentes[${i}].valorMensalNovo`, 'REPACTUACAO_INVALIDA', 0);
    exigirData(c.dataBase, `componentes[${i}].dataBase`);
    const anualidade = adicionarMeses(c.dataBase, 12);
    const anualidadeCumprida = solicitada >= lerData(anualidade);
    const rotulo = texto(c.descricao) || `componente ${i + 1}`;
    if (texto(c.descricao).length < 3) motivos.push(`Descreva o componente ${i + 1} da planilha de custos.`);
    if (texto(c.documento).length < 3) {
      motivos.push(`Informe o documento que fundamenta "${rotulo}" (acordo, convenção, dissídio ou planilha de custos — art. 135, § 6º).`);
    }
    if (!anualidadeCumprida) {
      motivos.push(
        `"${rotulo}": o interregno de 1 ano contado de ${formatarData(c.dataBase)} só se completa em ${formatarData(anualidade)} (art. 135, § 3º).`,
      );
    }
    const variacaoMensal = c.valorMensalNovo - c.valorMensalAnterior;
    return {
      ...c,
      variacaoMensal,
      percentual: percentual(variacaoMensal, c.valorMensalAnterior, 2),
      anualidade,
      anualidadeCumprida,
    };
  });
  const variacaoMensal = componentes.reduce((s, c) => s + c.variacaoMensal, 0);
  if (componentes.length > 0 && variacaoMensal === 0) motivos.push('A demonstração analítica não mostra variação de custos.');
  const mesesRemanescentes = mesesAte(e.efeitosDesde, e.vigenciaFim);
  if (mesesRemanescentes === 0) motivos.push('O início dos efeitos é posterior ao fim da vigência.');
  const permitido = motivos.length === 0;
  const valor = permitido ? variacaoMensal * mesesRemanescentes : 0;
  const explicacao = permitido
    ? `Variação mensal de ${formatarMoeda(variacaoMensal)} em ${contagem(componentes.length, 'componente', 'componentes')}, com efeitos de ${formatarData(e.efeitosDesde)} até o fim da vigência (${contagem(mesesRemanescentes, 'mês', 'meses')}): ${formatarMoeda(valor)}. Registro por apostila (art. 136, I).`
    : 'Repactuação recusada.';
  return { permitido, motivos, componentes, variacaoMensal, mesesRemanescentes, valor, explicacao, fundamento: 'Lei 14.133/2021, art. 135 e art. 136, I' };
}

// ───────────────────────── Reequilíbrio econômico-financeiro ─────────────────────────

export interface EntradaReequilibrio {
  enquadramento: EnquadramentoReequilibrio;
  alocacaoRisco: AlocacaoRiscoReequilibrio;
  dataEvento: DataISO;
  solicitadoEm: DataISO;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  /** Assinatura da prorrogação mais recente (art. 107), para a preclusão do art. 131, parágrafo único. */
  ultimaProrrogacaoEm: DataISO | null;
  sentido: 'aumento' | 'reducao';
  valorPleiteado: Centavos;
  demonstracao: string;
  hoje: DataISO;
  contratoExtinto?: boolean;
}

export interface AvaliacaoReequilibrio {
  permitido: boolean;
  motivos: string[];
  observacoes: string[];
  explicacao: string;
  fundamento: string;
}

const ROTULO_ENQUADRAMENTO: Record<EnquadramentoReequilibrio, string> = {
  forca_maior: 'força maior',
  caso_fortuito: 'caso fortuito',
  fato_principe: 'fato do príncipe',
  fato_imprevisivel: 'fato imprevisível',
  previsivel_consequencias_incalculaveis: 'fato previsível de consequências incalculáveis',
  tributo_superveniente: 'criação, alteração ou extinção de tributo ou encargo legal (art. 134)',
  alteracao_unilateral: 'alteração unilateral determinada pela Administração (art. 124, I)',
};

/**
 * Instrução do pedido de reequilíbrio econômico-financeiro: o evento deve ser enquadrado (força maior, caso fortuito,
 * fato do príncipe, fato imprevisível ou previsível de consequências incalculáveis), respeitada a matriz de riscos —
 * risco alocado à contratada não gera reequilíbrio, salvo alteração unilateral e tributos supervenientes (art. 103,
 * § 5º). O pedido deve ser feito durante a vigência e antes da prorrogação seguinte ao evento (art. 131, parágrafo
 * único), com demonstração do desequilíbrio. A decisão é da autoridade competente, por termo aditivo.
 * Fundamento: Lei 14.133/2021, art. 124, II, "d", arts. 103, § 5º, 131 e 134.
 */
export function avaliarReequilibrio(e: EntradaReequilibrio): AvaliacaoReequilibrio {
  if (!(e.enquadramento in ROTULO_ENQUADRAMENTO)) throw new ErroDominio('REEQUILIBRIO_INVALIDO', `Enquadramento inválido: ${String(e.enquadramento)}.`);
  if (!['contratante', 'contratada', 'compartilhado', 'nao_previsto'].includes(e.alocacaoRisco)) {
    throw new ErroDominio('REEQUILIBRIO_INVALIDO', `Alocação de risco inválida: ${String(e.alocacaoRisco)}.`);
  }
  exigirInteiro(e.valorPleiteado, 'valorPleiteado', 'REEQUILIBRIO_INVALIDO', 0);
  const evento = exigirData(e.dataEvento, 'dataEvento');
  const pedido = exigirData(e.solicitadoEm, 'solicitadoEm');
  const inicio = exigirData(e.vigenciaInicio, 'vigenciaInicio');
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  const hoje = exigirData(e.hoje, 'hoje');
  const motivos: string[] = [];
  const observacoes: string[] = [];
  if (e.contratoExtinto === true) {
    motivos.push('O contrato foi extinto: o desequilíbrio reconhecido depois da extinção é indenizado por termo indenizatório (art. 131, caput), fora do termo aditivo.');
  }
  if (pedido > hoje) motivos.push('A data do pedido não pode ser futura.');
  if (evento > pedido) motivos.push('O evento não pode ser posterior ao pedido.');
  if (pedido < inicio || pedido > fim) motivos.push('O pedido de reequilíbrio deve ser formulado durante a vigência do contrato (art. 131, parágrafo único).');
  if (e.ultimaProrrogacaoEm !== null) {
    const prorrogacao = exigirData(e.ultimaProrrogacaoEm, 'ultimaProrrogacaoEm');
    if (evento < prorrogacao && pedido > prorrogacao) {
      motivos.push(
        `O evento é anterior à prorrogação de ${formatarData(e.ultimaProrrogacaoEm)} e o pedido veio depois dela: o pedido deveria ter sido feito antes da prorrogação (art. 131, parágrafo único).`,
      );
    }
  }
  const excecao = e.enquadramento === 'tributo_superveniente' || e.enquadramento === 'alteracao_unilateral';
  if (e.alocacaoRisco === 'contratada' && !excecao) {
    motivos.push(
      'O risco do evento foi alocado à contratada na matriz de riscos: o equilíbrio se considera mantido e o reequilíbrio é vedado (art. 103, § 5º, e cláusula da matriz de riscos).',
    );
  }
  if (e.alocacaoRisco === 'compartilhado') observacoes.push('Risco compartilhado na matriz: o reequilíbrio deve observar a proporção de cada parte.');
  if (e.alocacaoRisco === 'nao_previsto') observacoes.push('Evento não previsto na matriz de riscos: confirme que é imprevisível ou de consequências incalculáveis.');
  if (e.valorPleiteado <= 0) motivos.push('Informe o valor do desequilíbrio demonstrado.');
  if (texto(e.demonstracao).length < MINIMO_DEMONSTRACAO) {
    motivos.push(`Descreva a demonstração do desequilíbrio (memória de cálculo e documentos) com pelo menos ${MINIMO_DEMONSTRACAO} caracteres.`);
  }
  const permitido = motivos.length === 0;
  const explicacao = `${permitido ? 'Pedido apto à decisão' : 'Pedido não admitido'}: ${ROTULO_ENQUADRAMENTO[e.enquadramento]}, ${e.sentido === 'aumento' ? 'aumento' : 'redução'} de ${formatarMoeda(e.valorPleiteado)}. A decisão é da autoridade competente, por termo aditivo (art. 124, II, "d").`;
  return { permitido, motivos, observacoes, explicacao, fundamento: 'Lei 14.133/2021, art. 124, II, "d", art. 103, § 5º, art. 131 e art. 134' };
}

// ───────────────────────── Extinção (arts. 137 a 139) ─────────────────────────

export interface EntradaInstauracaoExtincao {
  forma: FormaExtincao;
  motivo: MotivoExtincao;
  fundamentacao: string;
  /** Unilateral: prazo de defesa, em dias úteis, fixado na notificação (contraditório, art. 137, caput). */
  prazoDefesaDiasUteis?: number | null;
  /** Consensual: interesse da Administração (art. 138, II). */
  interesseAdministracao?: boolean;
  /** Judicial ou arbitral: número do processo ou da decisão. */
  referenciaDecisao?: string | null;
  contratoExtinto?: boolean;
}

export interface AvaliacaoInstauracaoExtincao {
  permitido: boolean;
  motivos: string[];
  exigeContraditorio: boolean;
  explicacao: string;
  fundamento: string;
}

/**
 * Abertura do processo de extinção: a extinção é motivada nos autos, com contraditório e ampla defesa (art. 137,
 * caput). Unilateral: só pelos motivos do art. 137, I a IX, nunca por falta da própria Administração (art. 138, I),
 * e com prazo de defesa. Consensual: depende do interesse da Administração (art. 138, II). Judicial ou arbitral:
 * registra a decisão (art. 138, III). Fundamento: Lei 14.133/2021, arts. 137 e 138.
 */
export function avaliarInstauracaoExtincao(e: EntradaInstauracaoExtincao): AvaliacaoInstauracaoExtincao {
  if (!['unilateral', 'consensual', 'judicial_arbitral'].includes(e.forma)) throw new ErroDominio('EXTINCAO_INVALIDA', `Forma de extinção inválida: ${String(e.forma)}.`);
  if (!(e.motivo in MOTIVOS_EXTINCAO)) throw new ErroDominio('EXTINCAO_INVALIDA', `Motivo de extinção inválido: ${String(e.motivo)}.`);
  const motivos: string[] = [];
  if (e.contratoExtinto === true) motivos.push('O contrato já foi extinto.');
  if (texto(e.fundamentacao).length < MINIMO_DEMONSTRACAO) {
    motivos.push(`Motive a extinção nos autos com pelo menos ${MINIMO_DEMONSTRACAO} caracteres (art. 137, caput).`);
  }
  const direitoContratado = e.motivo.startsWith('art137_p2_');
  if (e.forma === 'unilateral') {
    if (direitoContratado) {
      motivos.push('Os motivos do art. 137, § 2º, são direito do contratado: a extinção por falta da própria Administração não é unilateral (art. 138, I) — use a forma consensual, arbitral ou judicial.');
    }
    const prazo = e.prazoDefesaDiasUteis;
    if (prazo === undefined || prazo === null || !Number.isInteger(prazo) || prazo < 1 || prazo > 60) {
      motivos.push('Fixe o prazo de defesa do contratado, de 1 a 60 dias úteis (contraditório e ampla defesa, art. 137, caput).');
    }
  }
  if (e.forma === 'consensual' && e.interesseAdministracao !== true) {
    motivos.push('A extinção consensual exige interesse da Administração, declarado pela autoridade (art. 138, II).');
  }
  if (e.forma === 'judicial_arbitral' && texto(e.referenciaDecisao).length < 3) {
    motivos.push('Informe o número do processo ou da decisão judicial ou arbitral (art. 138, III).');
  }
  const exigeContraditorio = e.forma === 'unilateral';
  const permitido = motivos.length === 0;
  return {
    permitido,
    motivos,
    exigeContraditorio,
    explicacao: `${MOTIVOS_EXTINCAO[e.motivo]}. ${exigeContraditorio ? 'O contratado será notificado para apresentar defesa antes da decisão.' : 'Sem fase de defesa: segue para a decisão da autoridade competente.'}`,
    fundamento: 'Lei 14.133/2021, arts. 137 e 138',
  };
}

export interface EntradaDecisaoExtincao {
  forma: FormaExtincao;
  decisao: 'extinguir' | 'arquivar';
  instauradaEm: DataISO;
  hoje: DataISO;
  vigenciaFim: DataISO;
  dataEfeitos: DataISO;
  fundamentacao: string;
  /** Unilateral: fim do prazo de defesa e se a defesa foi apresentada (ou registrada a ausência de manifestação). */
  prazoDefesaFim: DataISO | null;
  defesaRegistrada: boolean;
  culpaAdministracao: boolean;
  efeitos: readonly EfeitoExtincao[];
  /** Ocupação do local (art. 139, II): autorização expressa do ministro de Estado (art. 139, § 2º). */
  autorizacaoMinistro?: boolean;
}

export interface AvaliacaoDecisaoExtincao {
  permitido: boolean;
  motivos: string[];
  efeitos: { codigo: EfeitoExtincao; descricao: string }[];
  explicacao: string;
  fundamento: string;
}

/**
 * Decisão da autoridade competente sobre a extinção: na unilateral, só depois da defesa ou do fim do prazo de defesa;
 * efeitos do art. 139 (assunção do objeto, ocupação, execução da garantia, retenção de créditos) só na extinção
 * unilateral sem culpa da Administração; com culpa da Administração, os direitos do contratado do art. 138, § 2º.
 * A data dos efeitos não antecede a instauração nem ultrapassa a vigência. Fundamento: arts. 137 a 139.
 */
export function avaliarDecisaoExtincao(e: EntradaDecisaoExtincao): AvaliacaoDecisaoExtincao {
  const instaurada = exigirData(e.instauradaEm, 'instauradaEm');
  const hoje = exigirData(e.hoje, 'hoje');
  const fim = exigirData(e.vigenciaFim, 'vigenciaFim');
  const efeitosData = exigirData(e.dataEfeitos, 'dataEfeitos');
  const motivos: string[] = [];
  if (texto(e.fundamentacao).length < MINIMO_JUSTIFICATIVA) {
    motivos.push(`Fundamente a decisão com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres (autorização escrita e fundamentada, art. 138, § 1º).`);
  }
  if (e.forma === 'unilateral') {
    const prazo = e.prazoDefesaFim === null ? null : exigirData(e.prazoDefesaFim, 'prazoDefesaFim');
    if (!e.defesaRegistrada && (prazo === null || hoje <= prazo)) {
      motivos.push(
        `Aguarde a defesa do contratado ou o fim do prazo de defesa${e.prazoDefesaFim ? ` (${formatarData(e.prazoDefesaFim)})` : ''} antes de decidir (art. 137, caput).`,
      );
    }
  }
  const efeitos = [...new Set(e.efeitos)];
  for (const efeito of efeitos) if (!(efeito in EFEITOS_EXTINCAO)) throw new ErroDominio('EXTINCAO_INVALIDA', `Efeito inválido: ${String(efeito)}.`);
  if (e.decisao === 'extinguir') {
    if (efeitosData < instaurada) motivos.push('A data dos efeitos não pode ser anterior à abertura do processo de extinção.');
    if (efeitosData > fim) motivos.push(`A data dos efeitos é posterior ao fim da vigência (${formatarData(e.vigenciaFim)}): o contrato já terá terminado pelo prazo.`);
    if (e.culpaAdministracao && e.forma === 'unilateral') {
      motivos.push('A extinção por culpa da Administração não é feita por ato unilateral (art. 138, I).');
    }
    const do139 = efeitos.filter((x) => EFEITOS_ART_139.includes(x));
    const do138 = efeitos.filter((x) => EFEITOS_ART_138_P2.includes(x));
    if (do139.length > 0 && (e.forma !== 'unilateral' || e.culpaAdministracao)) {
      motivos.push('Assunção do objeto, ocupação do local, execução da garantia e retenção de créditos só cabem na extinção unilateral sem culpa da Administração (art. 139).');
    }
    if (do138.length > 0 && !e.culpaAdministracao) {
      motivos.push('Devolução da garantia, pagamentos devidos, desmobilização e ressarcimento do art. 138, § 2º, cabem quando a extinção decorre de culpa exclusiva da Administração.');
    }
    if (efeitos.includes('ocupacao_local') && e.autorizacaoMinistro !== true) {
      motivos.push('A ocupação do local e das instalações exige autorização expressa do ministro de Estado (art. 139, § 2º).');
    }
  } else if (efeitos.length > 0) {
    motivos.push('O arquivamento não produz efeitos de extinção.');
  }
  const permitido = motivos.length === 0;
  return {
    permitido,
    motivos,
    efeitos: efeitos.map((codigo) => ({ codigo, descricao: EFEITOS_EXTINCAO[codigo] })),
    explicacao:
      e.decisao === 'extinguir'
        ? `Extinção ${e.forma === 'unilateral' ? 'unilateral' : e.forma === 'consensual' ? 'consensual' : 'por decisão judicial ou arbitral'} com efeitos a partir de ${formatarData(e.dataEfeitos)}${efeitos.length > 0 ? `, com ${contagem(efeitos.length, 'efeito', 'efeitos')} registrado(s)` : ''}.`
        : 'Processo de extinção arquivado: o contrato segue vigente.',
    fundamento: 'Lei 14.133/2021, arts. 137 a 139',
  };
}

// ───────────────────────── Divulgação dos termos no PNCP ─────────────────────────

export interface SituacaoDivulgacaoTermo {
  situacao: 'divulgado_no_prazo' | 'divulgado_fora_do_prazo' | 'pendente_no_prazo' | 'pendente_vencido' | 'sem_prazo_de_eficacia';
  limite: DataISO | null;
  explicacao: string;
}

/**
 * Prazo de divulgação do termo no PNCP. O termo aditivo segue o prazo do contrato, como condição de eficácia: 20 dias
 * úteis (licitação) ou 10 (contratação direta) contados da assinatura (art. 94). Apostila e termo de rescisão são
 * divulgados para transparência (art. 174), sem prazo de eficácia.
 */
export function situacaoDivulgacaoTermoPncp(
  e: { especie: 'aditivo' | 'apostila' | 'rescisao'; assinadoEm: DataISO; origem: 'licitacao' | 'contratacao_direta'; divulgadoEm: DataISO | null; hoje: DataISO },
  calendario?: OpcoesCalendario,
): SituacaoDivulgacaoTermo {
  const hoje = exigirData(e.hoje, 'hoje');
  if (e.especie !== 'aditivo') {
    return {
      situacao: 'sem_prazo_de_eficacia',
      limite: null,
      explicacao: e.divulgadoEm
        ? `Divulgado no PNCP em ${formatarData(e.divulgadoEm)} para transparência (art. 174).`
        : 'Divulgação no PNCP para transparência (art. 174), sem prazo de eficácia.',
    };
  }
  const { limite, diasUteis } = prazoDivulgacaoContratoPncp(e.assinadoEm, e.origem, calendario);
  const regra = `prazo de ${diasUteis} dias úteis contados da assinatura em ${formatarData(e.assinadoEm)} (limite: ${formatarData(limite)})`;
  const eficacia = 'A divulgação no PNCP é condição de eficácia do aditivo (art. 94).';
  if (e.divulgadoEm !== null) {
    const noPrazo = exigirData(e.divulgadoEm, 'divulgadoEm') <= lerData(limite);
    return {
      situacao: noPrazo ? 'divulgado_no_prazo' : 'divulgado_fora_do_prazo',
      limite,
      explicacao: `Termo aditivo divulgado no PNCP em ${formatarData(e.divulgadoEm)}, ${noPrazo ? 'dentro do' : 'fora do'} ${regra}. ${eficacia}`,
    };
  }
  const vencido = hoje > lerData(limite);
  return {
    situacao: vencido ? 'pendente_vencido' : 'pendente_no_prazo',
    limite,
    explicacao: `Divulgação pendente; ${regra}${vencido ? ' — prazo vencido' : ''}. ${eficacia}`,
  };
}

export interface LocalizacaoTermoPncp {
  cnpj: string;
  anoContrato: number;
  sequencialContrato: number;
  sequencialTermo: number;
}

const PADRAO_TERMO = /\/v1\/orgaos\/(\d{14})\/contratos\/(\d{4})\/(\d{1,6})\/termos\/(\d{1,6})\/?$/;

/**
 * Interpreta o `location` devolvido pelo PNCP na inclusão de um termo de contrato
 * (`POST /v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos` → `.../termos/{sequencialTermoContrato}`).
 */
export function interpretarLocalizacaoTermoPncp(localizacao: string): LocalizacaoTermoPncp {
  const bruto = typeof localizacao === 'string' ? localizacao.trim() : '';
  const caminho = bruto.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const partes = PADRAO_TERMO.exec(caminho);
  if (!partes) throw new ErroDominio('PNCP_LOCALIZACAO_INVALIDA', `Endereço de termo de contrato do PNCP não reconhecido: "${bruto.slice(0, 200)}".`);
  return { cnpj: partes[1] ?? '', anoContrato: Number(partes[2]), sequencialContrato: Number(partes[3]), sequencialTermo: Number(partes[4]) };
}

/** Código da tabela "Tipo de termo de contrato" do PNCP: 1 = rescisão, 2 = aditivo, 3 = apostilamento. */
export function tipoTermoContratoPncp(especie: 'aditivo' | 'apostila' | 'rescisao'): 1 | 2 | 3 {
  return especie === 'rescisao' ? 1 : especie === 'aditivo' ? 2 : 3;
}
