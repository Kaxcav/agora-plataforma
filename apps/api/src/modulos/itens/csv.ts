export type CelulaCsv = string | number | { centavos: number } | { decimal: number };

const BOM = '﻿';
const SEPARADOR = ';';

function formatarDecimal(valor: number, casas: number): string {
  return valor.toFixed(casas).replace('.', ',');
}

/** Texto seguro para planilhas: aspas quando necessário e neutralização de fórmulas (=, +, -, @). */
function escapar(texto: string): string {
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

function celula(valor: CelulaCsv): string {
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'string') return escapar(valor);
  if ('centavos' in valor) return formatarDecimal(valor.centavos / 100, 2);
  return formatarDecimal(valor.decimal, 1);
}

/** CSV pt-BR: BOM UTF-8, separador ';', decimal com vírgula, linhas CRLF. */
export function gerarCsv(cabecalho: readonly string[], linhas: readonly (readonly CelulaCsv[])[]): string {
  const todas = [cabecalho.map(escapar).join(SEPARADOR), ...linhas.map((l) => l.map(celula).join(SEPARADOR))];
  return `${BOM}${todas.join('\r\n')}\r\n`;
}
