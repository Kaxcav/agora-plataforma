import { validarCnpj, validarCpf } from '@agora/dominio';
import type { Prng } from './prng.ts';

function digitoModulo11(base: string, pesos: readonly number[]): number {
  const soma = [...base].reduce((acc, d, i) => acc + Number(d) * (pesos[i] ?? 0), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF sintético com dígitos verificadores válidos (conferido por @agora/dominio). */
export function gerarCpf(prng: Prng): string {
  for (;;) {
    const base = prng.digitos(9);
    if (/^(\d)\1+$/.test(base)) continue;
    const d1 = digitoModulo11(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digitoModulo11(`${base}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const cpf = `${base}${d1}${d2}`;
    if (validarCpf(cpf)) return cpf;
  }
}

/** CNPJ sintético (matriz 0001) com dígitos verificadores válidos (conferido por @agora/dominio). */
export function gerarCnpj(prng: Prng): string {
  for (;;) {
    const base = `${prng.digitos(8)}0001`;
    if (/^(\d)\1+$/.test(base.slice(0, 8))) continue;
    const d1 = digitoModulo11(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const d2 = digitoModulo11(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const cnpj = `${base}${d1}${d2}`;
    if (validarCnpj(cnpj)) return cnpj;
  }
}
