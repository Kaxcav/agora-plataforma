/**
 * Instrumento de medição de resultado (IMR) e conferência da nota fiscal (Lei 14.133/2021, art. 6º, XXIII, "g", e
 * arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A, aplicada às contratações da Lei 14.133 pela IN SEGES/ME 98/2022).
 *
 * O IMR é configurado por contrato: cada indicador tem meta, forma de cálculo, periodicidade, fonte da medição e faixas de
 * ajuste do pagamento (glosa). A glosa é o ajuste do pagamento ao resultado efetivamente entregue, não é sanção: a faixa
 * que prevê processo sancionatório só encaminha o caso para a decisão da autoridade competente (arts. 155 a 163).
 * Tudo aqui é puro e determinístico; "hoje" não é usado.
 */
import { ErroDominio } from '../erros.ts';
import { type Centavos, aplicarPercentual, formatarMoeda } from '../moeda.ts';
import { arredondar, exigirInteiro, formatarNumero } from '../interno.ts';

/** `percentual_razao`: resultado = numerador ÷ denominador × 100. `valor_medido`: resultado = valor aferido (horas, ocorrências...). */
export type FormaCalculoImr = 'percentual_razao' | 'valor_medido';
/** `maior_igual`: a meta é atingida com resultado ≥ meta (ex.: disponibilidade). `menor_igual`: resultado ≤ meta (ex.: tempo de resposta). */
export type SentidoMetaImr = 'maior_igual' | 'menor_igual';
export type PeriodicidadeImr = 'mensal' | 'bimestral' | 'trimestral' | 'semestral';

export const MESES_PERIODICIDADE_IMR: Readonly<Record<PeriodicidadeImr, number>> = Object.freeze({
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
});

/**
 * Faixa de ajuste do pagamento. Vale quando o resultado ultrapassa o `limite` no sentido contrário ao da meta: abaixo
 * dele, se a meta é "≥"; acima dele, se a meta é "≤". Entre a meta e o primeiro limite, o resultado fica fora da meta
 * sem glosa (tolerância). Entre várias faixas, vale a mais severa alcançada.
 */
export interface FaixaAjusteImr {
  limite: number;
  /** Glosa fixa da faixa, em % da base de cálculo do indicador. */
  percentualGlosa: number;
  /** Glosa adicional por unidade além do limite (ex.: 1% por hora a mais), em % da base; 0 quando não há. Fração de unidade conta como unidade inteira. */
  percentualPorUnidade: number;
  /** A faixa prevê o encaminhamento para avaliar a abertura de processo sancionatório (decisão humana). */
  encaminharSancionatorio: boolean;
}

export interface IndicadorImr {
  codigo: string;
  nome: string;
  formaCalculo: FormaCalculoImr;
  /** Unidade do resultado: '%' na forma percentual; na forma de valor medido, a unidade aferida (ex.: 'horas'). */
  unidade: string;
  sentidoMeta: SentidoMetaImr;
  meta: number;
  periodicidade: PeriodicidadeImr;
  /** Primeira competência medida (AAAA-MM). As medições seguintes acompanham a periodicidade a partir dela. */
  inicioCompetencia: string;
  faixas: readonly FaixaAjusteImr[];
  /** Teto da glosa do indicador no período, em % da base; null = só o limite natural de 100%. */
  tetoPercentual: number | null;
}

const FUNDAMENTO_IMR = 'Lei 14.133/2021, art. 6º, XXIII, "g", e art. 117; IN SEGES/MP 5/2017, anexo VIII-A';
const AVISO_IMR =
  'A glosa ajusta o pagamento ao resultado medido e não é sanção. A abertura de processo sancionatório, quando a faixa a prevê, é decisão da autoridade competente, assegurados o contraditório e a ampla defesa (arts. 157 e 158).';
const REGEX_COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAXIMO_FAIXAS = 10;

function erroImr(mensagem: string): ErroDominio {
  return new ErroDominio('IMR_INVALIDO', mensagem);
}

function exigirNumero(valor: number, campo: string, codigo = 'IMR_INVALIDO'): void {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new ErroDominio(codigo, `${campo} deve ser um número finito (recebido: ${String(valor)}).`);
}

function exigirPercentual(valor: number, campo: string, minimo = 0): void {
  exigirNumero(valor, campo);
  if (valor < minimo || valor > 100) throw erroImr(`${campo} deve estar entre ${minimo} e 100 (recebido: ${valor}).`);
}

/** Índice absoluto do mês de uma competência AAAA-MM (ano × 12 + mês − 1). */
function indiceCompetencia(competencia: string, campo: string): number {
  const m = typeof competencia === 'string' ? REGEX_COMPETENCIA.exec(competencia) : null;
  if (m === null) throw erroImr(`${campo} deve estar no formato AAAA-MM (recebido: ${String(competencia)}).`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/** Competência AAAA-MM válida (mês de 01 a 12). */
export function ehCompetencia(valor: unknown): valor is string {
  return typeof valor === 'string' && REGEX_COMPETENCIA.test(valor);
}

/** Rótulo "MM/AAAA" de uma competência AAAA-MM. */
export function rotuloCompetencia(competencia: string): string {
  indiceCompetencia(competencia, 'competencia');
  return `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
}

function descreverMeta(i: Pick<IndicadorImr, 'sentidoMeta' | 'meta' | 'unidade'>): string {
  return `${i.sentidoMeta === 'maior_igual' ? '≥' : '≤'} ${formatarNumero(i.meta)}${i.unidade === '%' ? '%' : ` ${i.unidade}`}`;
}

function descreverValor(valor: number, unidade: string): string {
  return unidade === '%' ? `${formatarNumero(valor)}%` : `${formatarNumero(valor)} ${unidade}`;
}

/**
 * Valida a configuração de um indicador do IMR e devolve-o normalizado, com as faixas em ordem de severidade (da mais
 * branda à mais severa). Regras: faixas do lado de fora da meta, limites distintos, glosa fixa que não diminui com a
 * severidade, percentuais entre 0 e 100 e toda faixa com efeito (glosa ou encaminhamento). Erro: IMR_INVALIDO.
 * Fundamento: Lei 14.133/2021, art. 6º, XXIII, "g"; IN SEGES/MP 5/2017, anexo VIII-A.
 */
export function validarIndicadorImr(indicador: IndicadorImr): IndicadorImr {
  if (typeof indicador !== 'object' || indicador === null) throw erroImr('Informe o indicador.');
  const codigo = typeof indicador.codigo === 'string' ? indicador.codigo.trim() : '';
  if (codigo.length < 1 || codigo.length > 20) throw erroImr('O código do indicador deve ter de 1 a 20 caracteres.');
  const nome = typeof indicador.nome === 'string' ? indicador.nome.trim() : '';
  if (nome.length < 3) throw erroImr('O nome do indicador deve ter ao menos 3 caracteres.');
  if (indicador.formaCalculo !== 'percentual_razao' && indicador.formaCalculo !== 'valor_medido') throw erroImr('Forma de cálculo inválida.');
  if (indicador.sentidoMeta !== 'maior_igual' && indicador.sentidoMeta !== 'menor_igual') throw erroImr('Sentido da meta inválido.');
  if (typeof indicador.periodicidade !== 'string' || !Object.hasOwn(MESES_PERIODICIDADE_IMR, indicador.periodicidade)) throw erroImr('Periodicidade inválida.');
  indiceCompetencia(indicador.inicioCompetencia, 'inicioCompetencia');
  exigirNumero(indicador.meta, 'meta');
  const unidade = indicador.formaCalculo === 'percentual_razao' ? '%' : typeof indicador.unidade === 'string' ? indicador.unidade.trim() : '';
  if (unidade.length < 1 || unidade.length > 30) throw erroImr('Informe a unidade do resultado (até 30 caracteres).');
  if (indicador.formaCalculo === 'percentual_razao' && (indicador.meta < 0 || indicador.meta > 100)) {
    throw erroImr('Na forma percentual, a meta deve estar entre 0 e 100.');
  }
  if (indicador.formaCalculo === 'valor_medido' && indicador.meta < 0) throw erroImr('A meta não pode ser negativa.');
  if (indicador.tetoPercentual !== null) {
    exigirPercentual(indicador.tetoPercentual, 'tetoPercentual');
    if (indicador.tetoPercentual === 0) throw erroImr('O teto da glosa deve ser maior que zero (deixe em branco para não haver teto).');
  }
  if (!Array.isArray(indicador.faixas) || indicador.faixas.length === 0) throw erroImr('Informe ao menos uma faixa de ajuste do pagamento.');
  if (indicador.faixas.length > MAXIMO_FAIXAS) throw erroImr(`Informe no máximo ${MAXIMO_FAIXAS} faixas de ajuste.`);

  const ascendente = indicador.sentidoMeta === 'menor_igual';
  const faixas = indicador.faixas.map((f, n) => {
    const rotulo = `faixa ${n + 1}`;
    if (typeof f !== 'object' || f === null) throw erroImr(`Informe a ${rotulo}.`);
    exigirNumero(f.limite, `${rotulo}: limite`);
    exigirPercentual(f.percentualGlosa, `${rotulo}: percentualGlosa`);
    exigirPercentual(f.percentualPorUnidade, `${rotulo}: percentualPorUnidade`);
    if (typeof f.encaminharSancionatorio !== 'boolean') throw erroImr(`${rotulo}: informe se a faixa prevê encaminhamento sancionatório.`);
    if (ascendente ? f.limite < indicador.meta : f.limite > indicador.meta) {
      throw erroImr(`${rotulo}: o limite ${formatarNumero(f.limite)} fica dentro da meta (${descreverMeta({ ...indicador, unidade })}); a faixa precisa ficar do lado de fora da meta.`);
    }
    if (indicador.formaCalculo === 'percentual_razao' && (f.limite < 0 || f.limite > 100)) throw erroImr(`${rotulo}: na forma percentual, o limite deve estar entre 0 e 100.`);
    if (f.percentualGlosa === 0 && f.percentualPorUnidade === 0 && !f.encaminharSancionatorio) {
      throw erroImr(`${rotulo}: a faixa precisa ter glosa ou encaminhamento sancionatório.`);
    }
    return { limite: f.limite, percentualGlosa: f.percentualGlosa, percentualPorUnidade: f.percentualPorUnidade, encaminharSancionatorio: f.encaminharSancionatorio };
  });
  faixas.sort((a, b) => (ascendente ? a.limite - b.limite : b.limite - a.limite));
  for (let n = 1; n < faixas.length; n++) {
    const anterior = faixas[n - 1];
    const atual = faixas[n];
    if (!anterior || !atual) continue;
    if (anterior.limite === atual.limite) throw erroImr(`Duas faixas com o mesmo limite (${formatarNumero(atual.limite)}).`);
    if (atual.percentualGlosa < anterior.percentualGlosa) {
      throw erroImr('A glosa fixa não pode diminuir quando o resultado piora: revise os percentuais das faixas.');
    }
  }
  return { ...indicador, codigo, nome, unidade, faixas };
}

/**
 * A medição do indicador é devida nesta competência? Sim a partir de `inicioCompetencia`, no último mês de cada
 * período da periodicidade (mensal: todo mês; trimestral: o 3º, o 6º... mês a partir do início).
 */
export function medicaoImrDevida(indicador: Pick<IndicadorImr, 'inicioCompetencia' | 'periodicidade'>, competencia: string): boolean {
  const inicio = indiceCompetencia(indicador.inicioCompetencia, 'inicioCompetencia');
  const alvo = indiceCompetencia(competencia, 'competencia');
  if (typeof indicador.periodicidade !== 'string' || !Object.hasOwn(MESES_PERIODICIDADE_IMR, indicador.periodicidade)) throw erroImr('Periodicidade inválida.');
  const meses = MESES_PERIODICIDADE_IMR[indicador.periodicidade];
  return alvo >= inicio && (alvo - inicio + 1) % meses === 0;
}

export interface EntradaMedicaoImr {
  numerador?: number | null;
  denominador?: number | null;
  valor?: number | null;
}

/**
 * Resultado da medição, arredondado a duas casas decimais (o valor arredondado é o comparado com a meta e as faixas).
 * Percentual: numerador ÷ denominador × 100, com 0 ≤ numerador ≤ denominador e denominador > 0. Valor medido: o valor
 * aferido, não negativo. Erro: MEDICAO_IMR_INVALIDA.
 */
export function calcularResultadoImr(
  indicador: Pick<IndicadorImr, 'formaCalculo' | 'unidade'>,
  entrada: EntradaMedicaoImr,
): { resultado: number; memoriaCalculo: string[] } {
  if (indicador.formaCalculo === 'percentual_razao') {
    const { numerador, denominador } = entrada;
    if (typeof numerador !== 'number' || typeof denominador !== 'number') throw new ErroDominio('MEDICAO_IMR_INVALIDA', 'Informe o numerador e o denominador da medição.');
    exigirNumero(numerador, 'numerador', 'MEDICAO_IMR_INVALIDA');
    exigirNumero(denominador, 'denominador', 'MEDICAO_IMR_INVALIDA');
    if (denominador <= 0) throw new ErroDominio('MEDICAO_IMR_INVALIDA', 'O denominador da medição deve ser maior que zero.');
    if (numerador < 0 || numerador > denominador) throw new ErroDominio('MEDICAO_IMR_INVALIDA', 'O numerador deve estar entre zero e o denominador.');
    const resultado = arredondar((numerador / denominador) * 100, 2);
    return {
      resultado,
      memoriaCalculo: [`Resultado: ${formatarNumero(numerador)} ÷ ${formatarNumero(denominador)} × 100 = ${formatarNumero(resultado)}% (arredondado a duas casas decimais).`],
    };
  }
  const { valor } = entrada;
  if (typeof valor !== 'number') throw new ErroDominio('MEDICAO_IMR_INVALIDA', 'Informe o valor medido.');
  exigirNumero(valor, 'valor', 'MEDICAO_IMR_INVALIDA');
  if (valor < 0) throw new ErroDominio('MEDICAO_IMR_INVALIDA', 'O valor medido não pode ser negativo.');
  const resultado = arredondar(valor, 2);
  return { resultado, memoriaCalculo: [`Resultado medido: ${descreverValor(resultado, indicador.unidade)}.`] };
}

export interface AjustePagamentoImr {
  resultado: number;
  atingiuMeta: boolean;
  /** Posição (1 = mais branda) da faixa aplicada, na ordem de severidade; null sem faixa. */
  faixa: number | null;
  unidadesExcedentes: number;
  percentualGlosa: number;
  limitadoAoTeto: boolean;
  encaminharSancionatorio: boolean;
  /** Valor da glosa sobre a base informada; null quando a base não foi informada. */
  valorGlosa: Centavos | null;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
}

/**
 * Ajuste do pagamento (glosa) de um indicador do IMR para o resultado medido: identifica a faixa mais severa alcançada,
 * soma a glosa fixa e a glosa por unidade além do limite, aplica o teto do indicador (e o de 100%) e, com a base de
 * cálculo, devolve o valor da glosa em centavos. Determinístico e com memória de cálculo.
 * Fundamento: Lei 14.133/2021, art. 6º, XXIII, "g"; IN SEGES/MP 5/2017, anexo VIII-A.
 */
export function calcularAjustePagamento(e: { indicador: IndicadorImr; resultado: number; base?: Centavos | null }): AjustePagamentoImr {
  const indicador = validarIndicadorImr(e.indicador);
  exigirNumero(e.resultado, 'resultado', 'MEDICAO_IMR_INVALIDA');
  if (e.base !== undefined && e.base !== null) exigirInteiro(e.base, 'base (centavos)', 'MOEDA_INVALIDA', 0);
  const resultado = arredondar(e.resultado, 2);
  const ascendente = indicador.sentidoMeta === 'menor_igual';
  const atingiuMeta = ascendente ? resultado <= indicador.meta : resultado >= indicador.meta;
  const memoriaCalculo = [
    `Indicador ${indicador.codigo} — ${indicador.nome}: meta ${descreverMeta(indicador)}.`,
    `Resultado considerado: ${descreverValor(resultado, indicador.unidade)}.`,
  ];

  let posicao: number | null = null;
  if (!atingiuMeta) {
    for (let n = 0; n < indicador.faixas.length; n++) {
      const f = indicador.faixas[n];
      if (f && (ascendente ? resultado > f.limite : resultado < f.limite)) posicao = n;
    }
  }
  const faixa = posicao === null ? null : (indicador.faixas[posicao] ?? null);
  let unidadesExcedentes = 0;
  let percentualGlosa = 0;
  let limitadoAoTeto = false;

  if (atingiuMeta) {
    memoriaCalculo.push('Meta atingida: sem ajuste no pagamento.');
  } else if (faixa === null) {
    memoriaCalculo.push('Resultado fora da meta, mas ainda dentro da tolerância (antes do limite da primeira faixa): sem glosa.');
  } else {
    const n = (posicao ?? 0) + 1;
    memoriaCalculo.push(
      `Faixa ${n} aplicada: resultado ${ascendente ? 'acima' : 'abaixo'} de ${descreverValor(faixa.limite, indicador.unidade)}.`,
    );
    percentualGlosa = faixa.percentualGlosa;
    if (faixa.percentualGlosa > 0) memoriaCalculo.push(`Glosa fixa da faixa: ${formatarNumero(faixa.percentualGlosa)}%.`);
    if (faixa.percentualPorUnidade > 0) {
      const excesso = arredondar(Math.abs(resultado - faixa.limite), 6);
      unidadesExcedentes = Math.ceil(excesso);
      const adicional = arredondar(faixa.percentualPorUnidade * unidadesExcedentes, 4);
      percentualGlosa = arredondar(percentualGlosa + adicional, 4);
      memoriaCalculo.push(
        `Glosa por unidade: ${formatarNumero(faixa.percentualPorUnidade)}% × ${unidadesExcedentes} unidade(s) além do limite (${formatarNumero(excesso)}, fração conta como unidade inteira) = ${formatarNumero(adicional)}%.`,
      );
    }
    const teto = Math.min(100, indicador.tetoPercentual ?? 100);
    if (percentualGlosa > teto) {
      limitadoAoTeto = true;
      memoriaCalculo.push(`Glosa limitada ao teto de ${formatarNumero(teto)}% (calculada: ${formatarNumero(percentualGlosa)}%).`);
      percentualGlosa = teto;
    }
    memoriaCalculo.push(`Percentual de glosa do indicador: ${formatarNumero(percentualGlosa)}%.`);
    if (faixa.encaminharSancionatorio) {
      memoriaCalculo.push('A faixa prevê o encaminhamento para avaliar a abertura de processo sancionatório (decisão da autoridade competente).');
    }
  }

  let valorGlosa: Centavos | null = null;
  if (e.base !== undefined && e.base !== null) {
    valorGlosa = aplicarPercentual(e.base, percentualGlosa);
    memoriaCalculo.push(`Valor da glosa: ${formatarNumero(percentualGlosa)}% de ${formatarMoeda(e.base)} = ${formatarMoeda(valorGlosa)}.`);
  }

  return {
    resultado,
    atingiuMeta,
    faixa: posicao === null ? null : posicao + 1,
    unidadesExcedentes,
    percentualGlosa,
    limitadoAoTeto,
    encaminharSancionatorio: faixa?.encaminharSancionatorio ?? false,
    valorGlosa,
    memoriaCalculo,
    fundamento: FUNDAMENTO_IMR,
    aviso: AVISO_IMR,
  };
}

// ───────────────────────── Conferência da nota fiscal ─────────────────────────

export interface ItemContratoConferencia {
  id: string;
  numero: number;
  descricao: string;
  /** Preço unitário contratado, em centavos. */
  valorUnitario: Centavos;
  /** Quantidade ainda disponível do item (contratada menos a já recebida em outras notas). */
  saldoQuantidade: number;
}

export interface ItemNotaConferencia {
  itemContratoId: string;
  /** Quantidade recebida e aceita no período (termo de recebimento). */
  quantidadeRecebida: number;
  /** Quantidade cobrada na nota fiscal. */
  quantidadeFaturada: number;
  /** Preço unitário cobrado na nota, em centavos. */
  valorUnitarioFaturado: Centavos;
}

/** Glosa do IMR na competência da nota: percentual de cada indicador medido e itens alcançados (vazio = todos). */
export interface GlosaImrConferencia {
  codigo: string;
  nome: string;
  percentual: number;
  itensAlcancados: readonly string[];
}

export type TipoDivergenciaNota =
  | 'preco_acima_contratado'
  | 'quantidade_faturada_maior_que_recebida'
  | 'quantidade_acima_do_saldo'
  | 'soma_itens_diferente_do_total'
  | 'medicao_imr_pendente'
  | 'valor_nota_diferente_do_devido';

export interface DivergenciaNota {
  tipo: TipoDivergenciaNota;
  mensagem: string;
  itemContratoId: string | null;
}

export interface ResultadoConferenciaNota {
  itens: {
    itemContratoId: string;
    numero: number;
    descricao: string;
    quantidadeRecebida: number;
    quantidadeFaturada: number;
    valorUnitarioContratado: Centavos;
    valorUnitarioFaturado: Centavos;
    /** Preço contratado × quantidade recebida. */
    valorDevido: Centavos;
    /** Preço cobrado × quantidade cobrada. */
    valorFaturado: Centavos;
  }[];
  /** Soma do preço contratado × quantidade recebida, antes do IMR. */
  valorBruto: Centavos;
  glosas: { codigo: string; nome: string; percentual: number; base: Centavos; valor: Centavos }[];
  glosaImr: Centavos;
  /** Valor bruto menos a glosa do IMR. */
  valorDevido: Centavos;
  valorNota: Centavos;
  somaItensNota: Centavos;
  /** Valor da nota menos o valor devido (positivo: a nota cobra a mais). */
  diferenca: Centavos;
  /** O menor entre o valor da nota e o valor devido: nunca se paga acima do devido nem acima do cobrado. */
  valorALiquidar: Centavos;
  divergencias: DivergenciaNota[];
  conforme: boolean;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
}

function erroNota(mensagem: string): ErroDominio {
  return new ErroDominio('NOTA_FISCAL_INVALIDA', mensagem);
}

/**
 * Conferência da nota fiscal (RN-36): valor devido = Σ preço contratado × quantidade recebida, menos a glosa do IMR da
 * competência (cada glosa sobre os itens que o indicador alcança; o total nunca passa do valor bruto). Aponta preço
 * acima do contratado, quantidade cobrada maior que a recebida, quantidade acima do saldo do item, soma dos itens
 * diferente do total da nota, medição do IMR pendente e diferença entre a nota e o valor devido. Divergência exige
 * justificativa ou correção antes do atesto. Fundamento: Lei 14.133/2021, arts. 117, 140 e 141, e art. 6º, XXIII, "g".
 */
export function conferirNotaFiscal(e: {
  valorNota: Centavos;
  itensContrato: readonly ItemContratoConferencia[];
  itensNota: readonly ItemNotaConferencia[];
  glosasImr: readonly GlosaImrConferencia[];
  medicoesPendentes: readonly { codigo: string; nome: string }[];
}): ResultadoConferenciaNota {
  exigirInteiro(e.valorNota, 'valorNota (centavos)', 'NOTA_FISCAL_INVALIDA', 0);
  if (!Array.isArray(e.itensNota) || e.itensNota.length === 0) throw erroNota('Informe ao menos um item da nota fiscal.');
  const porId = new Map(e.itensContrato.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  const divergencias: DivergenciaNota[] = [];
  const memoriaCalculo: string[] = [];

  const itens = e.itensNota.map((n) => {
    const item = porId.get(n.itemContratoId);
    if (!item) throw erroNota('A nota cita um item que não pertence ao contrato.');
    if (vistos.has(item.id)) throw erroNota(`O item ${item.numero} aparece mais de uma vez na nota.`);
    vistos.add(item.id);
    exigirInteiro(n.quantidadeRecebida, `item ${item.numero}: quantidadeRecebida`, 'NOTA_FISCAL_INVALIDA', 0);
    exigirInteiro(n.quantidadeFaturada, `item ${item.numero}: quantidadeFaturada`, 'NOTA_FISCAL_INVALIDA', 0);
    exigirInteiro(n.valorUnitarioFaturado, `item ${item.numero}: valorUnitarioFaturado (centavos)`, 'NOTA_FISCAL_INVALIDA', 0);
    exigirInteiro(item.valorUnitario, `item ${item.numero}: valorUnitario (centavos)`, 'NOTA_FISCAL_INVALIDA', 0);
    const valorDevido = item.valorUnitario * n.quantidadeRecebida;
    const valorFaturado = n.valorUnitarioFaturado * n.quantidadeFaturada;
    if (!Number.isSafeInteger(valorDevido) || !Number.isSafeInteger(valorFaturado)) throw erroNota(`item ${item.numero}: valor fora do limite.`);
    memoriaCalculo.push(
      `Item ${item.numero}: ${formatarMoeda(item.valorUnitario)} (preço contratado) × ${formatarNumero(n.quantidadeRecebida)} (recebida) = ${formatarMoeda(valorDevido)}.`,
    );
    if (n.valorUnitarioFaturado > item.valorUnitario) {
      divergencias.push({
        tipo: 'preco_acima_contratado',
        itemContratoId: item.id,
        mensagem: `Item ${item.numero}: a nota cobra ${formatarMoeda(n.valorUnitarioFaturado)} por unidade, acima do preço contratado de ${formatarMoeda(item.valorUnitario)}.`,
      });
    }
    if (n.quantidadeFaturada > n.quantidadeRecebida) {
      divergencias.push({
        tipo: 'quantidade_faturada_maior_que_recebida',
        itemContratoId: item.id,
        mensagem: `Item ${item.numero}: a nota cobra ${formatarNumero(n.quantidadeFaturada)}, mas foram recebidos ${formatarNumero(n.quantidadeRecebida)}.`,
      });
    }
    if (n.quantidadeRecebida > item.saldoQuantidade) {
      divergencias.push({
        tipo: 'quantidade_acima_do_saldo',
        itemContratoId: item.id,
        mensagem: `Item ${item.numero}: a quantidade recebida (${formatarNumero(n.quantidadeRecebida)}) passa do saldo do item no contrato (${formatarNumero(item.saldoQuantidade)}).`,
      });
    }
    return {
      itemContratoId: item.id,
      numero: item.numero,
      descricao: item.descricao,
      quantidadeRecebida: n.quantidadeRecebida,
      quantidadeFaturada: n.quantidadeFaturada,
      valorUnitarioContratado: item.valorUnitario,
      valorUnitarioFaturado: n.valorUnitarioFaturado,
      valorDevido,
      valorFaturado,
    };
  });

  const valorBruto = itens.reduce((s, i) => s + i.valorDevido, 0);
  memoriaCalculo.push(`Valor bruto (preço contratado × quantidade recebida): ${formatarMoeda(valorBruto)}.`);

  const glosas = e.glosasImr.map((g) => {
    exigirPercentual(g.percentual, `glosa ${g.codigo}: percentual`);
    const alcance = new Set(g.itensAlcancados);
    const base = itens.filter((i) => alcance.size === 0 || alcance.has(i.itemContratoId)).reduce((s, i) => s + i.valorDevido, 0);
    const valor = aplicarPercentual(base, g.percentual);
    memoriaCalculo.push(
      `Glosa do IMR ${g.codigo} (${g.nome}): ${formatarNumero(g.percentual)}% de ${formatarMoeda(base)}${alcance.size === 0 ? '' : ' (itens alcançados pelo indicador)'} = ${formatarMoeda(valor)}.`,
    );
    return { codigo: g.codigo, nome: g.nome, percentual: g.percentual, base, valor };
  });
  const somaGlosas = glosas.reduce((s, g) => s + g.valor, 0);
  const glosaImr = Math.min(somaGlosas, valorBruto);
  if (glosaImr < somaGlosas) memoriaCalculo.push(`A soma das glosas (${formatarMoeda(somaGlosas)}) foi limitada ao valor bruto.`);
  const valorDevido = valorBruto - glosaImr;
  memoriaCalculo.push(`Valor devido: ${formatarMoeda(valorBruto)} − ${formatarMoeda(glosaImr)} (glosa do IMR) = ${formatarMoeda(valorDevido)}.`);

  for (const p of e.medicoesPendentes) {
    divergencias.push({
      tipo: 'medicao_imr_pendente',
      itemContratoId: null,
      mensagem: `A medição do indicador ${p.codigo} (${p.nome}) desta competência ainda não foi registrada: o valor devido pode mudar.`,
    });
  }

  const somaItensNota = itens.reduce((s, i) => s + i.valorFaturado, 0);
  if (somaItensNota !== e.valorNota) {
    divergencias.push({
      tipo: 'soma_itens_diferente_do_total',
      itemContratoId: null,
      mensagem: `A soma dos itens da nota (${formatarMoeda(somaItensNota)}) é diferente do valor total informado (${formatarMoeda(e.valorNota)}).`,
    });
  }
  const diferenca = e.valorNota - valorDevido;
  if (diferenca !== 0) {
    divergencias.push({
      tipo: 'valor_nota_diferente_do_devido',
      itemContratoId: null,
      mensagem:
        diferenca > 0
          ? `A nota cobra ${formatarMoeda(diferenca)} a mais que o valor devido (${formatarMoeda(e.valorNota)} × ${formatarMoeda(valorDevido)}).`
          : `A nota cobra ${formatarMoeda(-diferenca)} a menos que o valor devido (${formatarMoeda(e.valorNota)} × ${formatarMoeda(valorDevido)}).`,
    });
  }
  const valorALiquidar = Math.min(e.valorNota, valorDevido);
  memoriaCalculo.push(`Valor da nota: ${formatarMoeda(e.valorNota)}. Valor a liquidar (o menor entre a nota e o devido): ${formatarMoeda(valorALiquidar)}.`);

  return {
    itens,
    valorBruto,
    glosas,
    glosaImr,
    valorDevido,
    valorNota: e.valorNota,
    somaItensNota,
    diferenca,
    valorALiquidar,
    divergencias,
    conforme: divergencias.length === 0,
    memoriaCalculo,
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A',
    aviso:
      divergencias.length === 0
        ? 'Nota conforme: o valor cobrado é igual ao valor devido. O atesto continua sendo ato do fiscal, com a verificação da regularidade do contratado.'
        : 'Há divergência: corrija a nota ou registre a justificativa antes do atesto. A justificativa e a glosa ficam na trilha de auditoria.',
  };
}
