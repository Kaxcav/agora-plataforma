/**
 * Utilitários internos do pacote (não reexportados por index.ts).
 * Aritmética de datas em dias desde 1970-01-01 (UTC), validação numérica e formatação auxiliar.
 */
import { ErroDominio } from './erros.ts';

export const MS_POR_DIA = 86_400_000;

const REGEX_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const ESPACOS_ESPECIAIS = /[  ]/g;
const FORMATO_NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/**
 * Arredonda para `casas` decimais, metade para longe do zero, eliminando ruído binário
 * (ex.: 1.005 * 100 = 100.49999999999999 é tratado como 100.5).
 */
export function arredondar(valor: number, casas = 0): number {
  const fator = 10 ** casas;
  const escalado = Number((Math.abs(valor) * fator).toPrecision(15));
  const resultado = Math.round(escalado) / fator;
  if (resultado === 0) return 0;
  return valor < 0 ? -resultado : resultado;
}

export function exigirInteiro(valor: number, campo: string, codigo: string, minimo?: number): void {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) {
    throw new ErroDominio(codigo, `${campo} deve ser um número inteiro (recebido: ${String(valor)}).`);
  }
  if (minimo !== undefined && valor < minimo) {
    throw new ErroDominio(codigo, `${campo} deve ser maior ou igual a ${minimo} (recebido: ${valor}).`);
  }
}

export function exigirFinito(valor: number, campo: string, codigo: string): void {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ErroDominio(codigo, `${campo} deve ser um número finito (recebido: ${String(valor)}).`);
  }
}

/** Formata número em pt-BR com até 2 casas (ex.: 12,5). */
export function formatarNumero(n: number): string {
  return FORMATO_NUMERO.format(n).replace(ESPACOS_ESPECIAIS, ' ');
}

export function formatarPercentualTexto(n: number): string {
  return `${formatarNumero(n)}%`;
}

/** "1 dia útil", "3 dias úteis". */
export function contagem(n: number, singular: string, plural: string): string {
  return `${n} ${Math.abs(n) === 1 ? singular : plural}`;
}

export function normalizarEspacos(s: string): string {
  return s.replace(ESPACOS_ESPECIAIS, ' ');
}

// ───────────────────────── Datas ─────────────────────────

export interface PartesData {
  ano: number;
  mes: number;
  dia: number;
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

/** Decompõe 'AAAA-MM-DD' validando o calendário (anos 0001 a 9999). Retorna null se inválida. */
export function partesData(d: unknown): PartesData | null {
  if (typeof d !== 'string') return null;
  const m = REGEX_DATA_ISO.exec(d);
  if (m === null) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return null;
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return { ano, mes, dia };
}

/** Dias desde 1970-01-01 (UTC). `setUTCFullYear` evita o desvio de Date.UTC para anos < 100. */
export function diasDesdeEpoca(p: PartesData): number {
  const t = new Date(0);
  t.setUTCFullYear(p.ano, p.mes - 1, p.dia);
  return Math.round(t.getTime() / MS_POR_DIA);
}

export const EPOCA_MINIMA = diasDesdeEpoca({ ano: 1, mes: 1, dia: 1 });
export const EPOCA_MAXIMA = diasDesdeEpoca({ ano: 9999, mes: 12, dia: 31 });

export function lerData(d: string, campo = 'data'): number {
  const p = partesData(d);
  if (p === null) {
    throw new ErroDominio('DATA_INVALIDA', `${campo} inválida: esperado AAAA-MM-DD com data existente (recebido: ${String(d)}).`);
  }
  return diasDesdeEpoca(p);
}

export function escreverData(dias: number): string {
  if (!Number.isSafeInteger(dias) || dias < EPOCA_MINIMA || dias > EPOCA_MAXIMA) {
    throw new ErroDominio('DATA_FORA_DO_INTERVALO', 'A data resultante está fora do intervalo suportado (0001-01-01 a 9999-12-31).');
  }
  const t = new Date(dias * MS_POR_DIA);
  const ano = String(t.getUTCFullYear()).padStart(4, '0');
  const mes = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(t.getUTCDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Soma meses a uma data. Sem dia correspondente no mês de destino (ex.: 31/01 + 1 mês),
 * o prazo vence no dia imediato, 1º do mês seguinte (Código Civil, art. 132, § 3º).
 */
export function adicionarMeses(d: string, meses: number): string {
  exigirInteiro(meses, 'meses', 'MESES_INVALIDOS');
  const p = partesData(d);
  if (p === null) {
    throw new ErroDominio('DATA_INVALIDA', `data inválida: esperado AAAA-MM-DD com data existente (recebido: ${String(d)}).`);
  }
  const total = p.ano * 12 + (p.mes - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (((total % 12) + 12) % 12) + 1;
  if (ano < 1 || ano > 9999) {
    throw new ErroDominio('DATA_FORA_DO_INTERVALO', 'A data resultante está fora do intervalo suportado (0001-01-01 a 9999-12-31).');
  }
  const ultimoDia = diasNoMes(ano, mes);
  if (p.dia <= ultimoDia) return escreverData(diasDesdeEpoca({ ano, mes, dia: p.dia }));
  return escreverData(diasDesdeEpoca({ ano, mes, dia: ultimoDia }) + 1);
}
