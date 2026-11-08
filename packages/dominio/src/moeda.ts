/**
 * Dinheiro em centavos inteiros. Nunca use ponto flutuante para valores monetários;
 * arredondamento só no fim do cálculo.
 */
import { ErroDominio } from './erros.ts';
import { arredondar, exigirFinito, exigirInteiro, normalizarEspacos } from './interno.ts';

/** Valor monetário em centavos inteiros (R$ 1,00 = 100). */
export type Centavos = number;

const FORMATO_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMATO_COMPACTO = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** Formato brasileiro: milhar com ponto opcional e até 2 decimais após vírgula ("1.234,50", "1234,5", "1.234"). */
const PADRAO_BRASILEIRO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
/** Ponto como separador decimal, só quando não é agrupamento de milhar ("1234.5", "1.50"). */
const PADRAO_PONTO_DECIMAL = /^(\d+)\.(\d{1,2})$/;

const ESCALAS_COMPACTAS: readonly { fator: number; sufixo: string }[] = [
  { fator: 1_000_000_000, sufixo: 'bi' },
  { fator: 1_000_000, sufixo: 'mi' },
  { fator: 1_000, sufixo: 'mil' },
];

/** Inteiro finito (seguro), positivo, zero ou negativo. */
export function ehCentavos(v: unknown): v is Centavos {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function exigirCentavos(v: Centavos, campo = 'valor'): void {
  exigirInteiro(v, `${campo} (centavos)`, 'MOEDA_INVALIDA');
}

function erroMoeda(entrada: unknown): ErroDominio {
  return new ErroDominio('MOEDA_INVALIDA', `Valor monetário inválido: ${String(entrada)}.`);
}

function interpretarTexto(texto: string): Centavos {
  let s = texto.replace(/\s/g, '');
  let negativo = false;
  if (s.startsWith('-')) {
    negativo = true;
    s = s.slice(1);
  }
  if (s.startsWith('R$')) s = s.slice(2);
  if (!negativo && s.startsWith('-')) {
    negativo = true;
    s = s.slice(1);
  }
  const brasileiro = PADRAO_BRASILEIRO.exec(s);
  const pontoDecimal = brasileiro === null ? PADRAO_PONTO_DECIMAL.exec(s) : null;
  const inteiros = brasileiro?.[1] ?? pontoDecimal?.[1];
  const fracao = (brasileiro !== null ? brasileiro[2] : pontoDecimal?.[2]) ?? '';
  if (inteiros === undefined) throw erroMoeda(texto);
  const centavos = Number(inteiros.replace(/\./g, '')) * 100 + Number(fracao.padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos)) throw erroMoeda(texto);
  if (centavos === 0) return 0;
  return negativo ? -centavos : centavos;
}

/**
 * Converte reais para centavos. Aceita número (1234.5) ou texto em formato brasileiro
 * ("1234,50", "1.234,50", "R$ 1.234,50", "-R$ 1,00"). Texto com ponto e até 2 decimais sem vírgula
 * ("1234.5") é lido como ponto decimal; "1.234" é lido como milhar. Mais de 2 decimais em texto é inválido.
 */
export function paraCentavos(reais: number | string): Centavos {
  if (typeof reais === 'number') {
    if (!Number.isFinite(reais)) throw erroMoeda(reais);
    const centavos = arredondar(reais * 100);
    if (!Number.isSafeInteger(centavos)) throw erroMoeda(reais);
    return centavos;
  }
  if (typeof reais === 'string') return interpretarTexto(reais);
  throw erroMoeda(reais);
}

/** "R$ 1.234,56"; negativo "-R$ 1.234,56". Espaços especiais do Intl viram espaço comum. */
export function formatarMoeda(c: Centavos): string {
  exigirCentavos(c);
  const reais = c / 100 + 0;
  return normalizarEspacos(FORMATO_MOEDA.format(reais));
}

/** "R$ 350 mil", "R$ 1,2 mi", "R$ 2,5 bi". Abaixo de R$ 1 mil usa formatarMoeda. */
export function formatarMoedaCompacta(c: Centavos): string {
  exigirCentavos(c);
  const reais = Math.abs(c) / 100;
  if (reais < 1_000) return formatarMoeda(c);
  const indice = ESCALAS_COMPACTAS.findIndex((e) => reais >= e.fator);
  let escala = ESCALAS_COMPACTAS[indice];
  if (escala === undefined) return formatarMoeda(c);
  let valor = arredondar(reais / escala.fator, 1);
  // 999.950 reais arredonda para "1.000 mil": promove para a escala seguinte ("1 mi").
  const superior = ESCALAS_COMPACTAS[indice - 1];
  if (valor >= 1_000 && superior !== undefined) {
    escala = superior;
    valor = arredondar(reais / escala.fator, 1);
  }
  const sinal = c < 0 ? '-' : '';
  return `${sinal}R$ ${normalizarEspacos(FORMATO_COMPACTO.format(valor))} ${escala.sufixo}`;
}

export function somar(...valores: Centavos[]): Centavos {
  let total = 0;
  for (const v of valores) {
    exigirCentavos(v);
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new ErroDominio('MOEDA_INVALIDA', 'A soma excede o maior valor representável com segurança.');
  return total;
}

/** parte / total × 100, com `casas` decimais (padrão 1). total 0 → 0. */
export function percentual(parte: number, total: number, casas = 1): number {
  exigirFinito(parte, 'parte', 'PERCENTUAL_INVALIDO');
  exigirFinito(total, 'total', 'PERCENTUAL_INVALIDO');
  exigirInteiro(casas, 'casas', 'PERCENTUAL_INVALIDO', 0);
  if (casas > 10) throw new ErroDominio('PERCENTUAL_INVALIDO', 'casas deve estar entre 0 e 10.');
  if (total === 0) return 0;
  return arredondar((parte * 100) / total, casas);
}

/** Math.round(c × pct / 100), descartando ruído binário e o zero negativo. */
export function aplicarPercentual(c: Centavos, pct: number): Centavos {
  exigirCentavos(c);
  exigirFinito(pct, 'pct', 'PERCENTUAL_INVALIDO');
  const bruto = Number(((c * pct) / 100).toPrecision(15));
  return Math.round(bruto) + 0;
}
