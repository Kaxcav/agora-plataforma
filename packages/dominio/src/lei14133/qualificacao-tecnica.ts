/**
 * Qualificação técnica e econômico-financeira na habilitação (RN-25).
 * - Art. 67, § 1º: a exigência de atestados se restringe às parcelas de maior relevância ou valor significativo,
 *   assim consideradas as de valor individual igual ou superior a 4% do valor total estimado da contratação.
 * - Art. 67, § 2º: admite-se exigir atestados com quantidades mínimas de até 50% dessas parcelas, vedadas
 *   limitações de tempo e de locais específicos.
 * - Art. 69, § 6º: o balanço e as demonstrações contábeis (inciso I) limitam-se ao último exercício quando a
 *   pessoa jurídica foi constituída há menos de 2 anos.
 */
import { ErroDominio } from '../erros.ts';
import { adicionarMeses, arredondar, formatarNumero, lerData } from '../interno.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';
import type { DataISO } from '../datas.ts';

/** Art. 67, § 1º: piso, em % do valor total estimado, da parcela de maior relevância. */
export const PERCENTUAL_PARCELA_MAIOR_RELEVANCIA = 4;
/** Art. 67, § 2º: teto, em % da parcela, do quantitativo mínimo exigido nos atestados. */
export const PERCENTUAL_MAXIMO_QUANTITATIVO_MINIMO = 50;

const FUNDAMENTO_PARCELA = 'Lei 14.133/2021, art. 67, § 1º';
const FUNDAMENTO_QUANTITATIVO = 'Lei 14.133/2021, art. 67, § 2º';
const FUNDAMENTO_BALANCO = 'Lei 14.133/2021, art. 69, I e § 6º';

function exigirCentavosPositivos(valor: number, campo: string): void {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor <= 0) {
    throw new ErroDominio('QUALIFICACAO_TECNICA_INVALIDA', `${campo} deve ser um valor inteiro em centavos maior que zero (recebido: ${String(valor)}).`);
  }
}

function exigirQuantidadePositiva(valor: number, campo: string): void {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new ErroDominio('QUALIFICACAO_TECNICA_INVALIDA', `${campo} deve ser um número maior que zero (recebido: ${String(valor)}).`);
  }
}

/**
 * Classifica uma parcela do objeto pelo art. 67, § 1º: é de maior relevância quando o seu valor individual é igual
 * ou superior a 4% do valor total estimado da contratação. A comparação é feita em centavos inteiros, sem
 * arredondamento (valorParcela × 100 ≥ 4 × valorTotal).
 */
export function classificarParcelaRelevancia(
  valorParcela: Centavos,
  valorTotalEstimado: Centavos,
): { percentualDoTotal: number; maiorRelevancia: boolean; fundamento: string } {
  exigirCentavosPositivos(valorParcela, 'valorParcela');
  exigirCentavosPositivos(valorTotalEstimado, 'valorTotalEstimado');
  return {
    percentualDoTotal: arredondar((valorParcela * 100) / valorTotalEstimado, 2),
    maiorRelevancia: valorParcela * 100 >= PERCENTUAL_PARCELA_MAIOR_RELEVANCIA * valorTotalEstimado,
    fundamento: FUNDAMENTO_PARCELA,
  };
}

/** Art. 67, § 2º: maior quantitativo mínimo que o edital pode exigir nos atestados para a parcela (50% dela). */
export function limiteQuantitativoMinimo(quantidadeParcela: number): number {
  exigirQuantidadePositiva(quantidadeParcela, 'quantidadeParcela');
  return arredondar((quantidadeParcela * PERCENTUAL_MAXIMO_QUANTITATIVO_MINIMO) / 100, 6);
}

export interface ParcelaExigencia {
  descricao: string;
  unidade: string;
  /** Quantidade da parcela no objeto da contratação. */
  quantidadeObjeto: number;
  /** Valor estimado da parcela, em centavos. */
  valorEstimado: Centavos;
  /** Quantidade mínima exigida nos atestados (somados). */
  quantidadeMinima: number;
}

export interface AvaliacaoParcelaExigencia extends ParcelaExigencia {
  percentualDoTotal: number;
  maiorRelevancia: boolean;
  /** Quantidade mínima em % da parcela. */
  percentualMinimo: number;
  /** Maior quantidade mínima admitida (50% da parcela). */
  limiteQuantidadeMinima: number;
  quantidadeMinimaDentroDoLimite: boolean;
  problemas: string[];
}

/**
 * Confere as exigências de qualificação técnica do edital contra o art. 67, §§ 1º e 2º: cada parcela com exigência
 * de atestado deve ter valor de ao menos 4% do valor total estimado, e o quantitativo mínimo exigido não pode passar
 * de 50% da parcela. Também aponta parcela com valor maior que o total e soma das parcelas acima do total.
 * Devolve a avaliação por parcela e a lista de problemas; `valida` é falso quando há qualquer problema.
 */
export function avaliarExigenciasQualificacaoTecnica(e: { valorTotalEstimado: Centavos; parcelas: readonly ParcelaExigencia[] }): {
  valida: boolean;
  parcelas: AvaliacaoParcelaExigencia[];
  problemas: { parcela: number; mensagem: string }[];
  fundamento: string;
} {
  exigirCentavosPositivos(e.valorTotalEstimado, 'valorTotalEstimado');
  if (!Array.isArray(e.parcelas)) throw new ErroDominio('QUALIFICACAO_TECNICA_INVALIDA', 'Informe a lista de parcelas.');
  const problemas: { parcela: number; mensagem: string }[] = [];
  const parcelas = e.parcelas.map((p, indice): AvaliacaoParcelaExigencia => {
    if (typeof p.descricao !== 'string' || p.descricao.trim().length < 3) {
      throw new ErroDominio('QUALIFICACAO_TECNICA_INVALIDA', `Parcela ${indice + 1}: descreva a parcela (mínimo de 3 caracteres).`);
    }
    exigirCentavosPositivos(p.valorEstimado, `Parcela ${indice + 1}: valorEstimado`);
    exigirQuantidadePositiva(p.quantidadeObjeto, `Parcela ${indice + 1}: quantidadeObjeto`);
    exigirQuantidadePositiva(p.quantidadeMinima, `Parcela ${indice + 1}: quantidadeMinima`);
    const relevancia = classificarParcelaRelevancia(p.valorEstimado, e.valorTotalEstimado);
    const limite = limiteQuantitativoMinimo(p.quantidadeObjeto);
    const dentro = arredondar(p.quantidadeMinima, 6) <= limite;
    const mensagens: string[] = [];
    if (p.valorEstimado > e.valorTotalEstimado) {
      mensagens.push(`O valor da parcela (${formatarMoeda(p.valorEstimado)}) é maior que o valor total estimado da contratação (${formatarMoeda(e.valorTotalEstimado)}).`);
    }
    if (!relevancia.maiorRelevancia) {
      mensagens.push(
        `A parcela representa ${formatarNumero(relevancia.percentualDoTotal)}% do valor total estimado: só se exige atestado de parcela com valor igual ou superior a ${PERCENTUAL_PARCELA_MAIOR_RELEVANCIA}% (art. 67, § 1º).`,
      );
    }
    if (!dentro) {
      mensagens.push(
        `O quantitativo mínimo (${formatarNumero(p.quantidadeMinima)} ${p.unidade}) passa de ${PERCENTUAL_MAXIMO_QUANTITATIVO_MINIMO}% da parcela; o máximo admitido é ${formatarNumero(limite)} ${p.unidade} (art. 67, § 2º).`,
      );
    }
    for (const mensagem of mensagens) problemas.push({ parcela: indice, mensagem });
    return {
      descricao: p.descricao,
      unidade: p.unidade,
      quantidadeObjeto: p.quantidadeObjeto,
      valorEstimado: p.valorEstimado,
      quantidadeMinima: p.quantidadeMinima,
      percentualDoTotal: relevancia.percentualDoTotal,
      maiorRelevancia: relevancia.maiorRelevancia,
      percentualMinimo: arredondar((p.quantidadeMinima * 100) / p.quantidadeObjeto, 2),
      limiteQuantidadeMinima: limite,
      quantidadeMinimaDentroDoLimite: dentro,
      problemas: mensagens,
    };
  });
  const soma = e.parcelas.reduce((total, p) => total + p.valorEstimado, 0);
  if (soma > e.valorTotalEstimado) {
    problemas.push({
      parcela: -1,
      mensagem: `A soma das parcelas (${formatarMoeda(soma)}) passa do valor total estimado da contratação (${formatarMoeda(e.valorTotalEstimado)}).`,
    });
  }
  return { valida: problemas.length === 0, parcelas, problemas, fundamento: `${FUNDAMENTO_PARCELA}; ${FUNDAMENTO_QUANTITATIVO}` };
}

/**
 * Quantos exercícios sociais de balanço patrimonial e demonstrações contábeis podem ser exigidos (art. 69, I):
 * 2 (dois), ou só o último quando a pessoa jurídica foi constituída há menos de 2 anos na data de referência
 * (art. 69, § 6º). A data de referência é a da apresentação dos documentos de habilitação.
 */
export function exerciciosBalancoExigiveis(
  dataConstituicao: DataISO,
  dataReferencia: DataISO,
): { quantidade: 1 | 2; constituidaHaMenosDeDoisAnos: boolean; fundamento: string; explicacao: string } {
  const constituicao = lerData(dataConstituicao, 'dataConstituicao');
  const referencia = lerData(dataReferencia, 'dataReferencia');
  if (constituicao > referencia) {
    throw new ErroDominio('DATA_CONSTITUICAO_INVALIDA', 'A data de constituição da empresa não pode ser posterior à data de referência.');
  }
  const doisAnos = lerData(adicionarMeses(dataConstituicao, 24), 'dataConstituicao');
  const recente = referencia < doisAnos;
  return {
    quantidade: recente ? 1 : 2,
    constituidaHaMenosDeDoisAnos: recente,
    fundamento: FUNDAMENTO_BALANCO,
    explicacao: recente
      ? 'Empresa constituída há menos de 2 anos: exige-se o balanço e as demonstrações contábeis apenas do último exercício (art. 69, § 6º).'
      : 'Exigem-se o balanço patrimonial e as demonstrações contábeis dos 2 últimos exercícios sociais (art. 69, I).',
  };
}

/**
 * Confere os balanços apresentados por um licitante contra o art. 69, I e § 6º: com a data de constituição, calcula
 * quantos exercícios são exigíveis e se os exercícios distintos apresentados bastam. Sem a data de constituição,
 * devolve `suficiente: null` (a regra do § 6º não pode ser aplicada). É sinal para a análise humana da habilitação.
 */
export function avaliarBalancosApresentados(e: {
  dataConstituicao: DataISO | null;
  dataReferencia: DataISO;
  exerciciosApresentados: readonly number[];
}): { exigidos: 1 | 2 | null; apresentados: number[]; suficiente: boolean | null; mensagem: string; fundamento: string } {
  for (const ano of e.exerciciosApresentados) {
    if (!Number.isInteger(ano) || ano < 1900 || ano > 2200) {
      throw new ErroDominio('EXERCICIO_INVALIDO', `Exercício social inválido: ${String(ano)}.`);
    }
  }
  const apresentados = [...new Set(e.exerciciosApresentados)].sort((a, b) => b - a);
  if (e.dataConstituicao === null) {
    return {
      exigidos: null,
      apresentados,
      suficiente: null,
      mensagem: 'Informe a data de constituição da empresa para conferir quantos exercícios são exigíveis (art. 69, § 6º).',
      fundamento: FUNDAMENTO_BALANCO,
    };
  }
  const regra = exerciciosBalancoExigiveis(e.dataConstituicao, e.dataReferencia);
  const suficiente = apresentados.length >= regra.quantidade;
  const lista = apresentados.length === 0 ? 'nenhum exercício' : apresentados.join(', ');
  return {
    exigidos: regra.quantidade,
    apresentados,
    suficiente,
    mensagem: `${regra.explicacao} Apresentado(s): ${lista}.`,
    fundamento: regra.fundamento,
  };
}
