/**
 * CPF, CNPJ (numérico) e mascaramento de dados pessoais (LGPD).
 */
import { ErroDominio } from './erros.ts';

/** Documento só pode conter dígitos e a pontuação usual (ponto, hífen, barra, espaços). */
const CARACTERES_DOCUMENTO = /^[\d.\-/\s]*$/;
const SEQUENCIA_REPETIDA = /^(\d)\1+$/;
const PARTICULAS_NOME = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

export function somenteDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

function digitosDocumento(doc: string): string | null {
  if (typeof doc !== 'string' || !CARACTERES_DOCUMENTO.test(doc)) return null;
  return somenteDigitos(doc);
}

/** Módulo 11: resto < 2 → 0; senão 11 − resto. */
function digitoModulo11(numeros: readonly number[], peso: (indice: number) => number): number {
  const soma = numeros.reduce((acc, n, i) => acc + n * peso(i), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function dvCpf(base: readonly number[]): number {
  return digitoModulo11(base, (i) => base.length + 1 - i);
}

function dvCnpj(base: readonly number[]): number {
  // Pesos 5,4,3,2,9,8,7,6,5,4,3,2 (12 dígitos) e 6,5,4,3,2,9,...,2 (13 dígitos).
  return digitoModulo11(base, (i) => ((base.length - 1 - i) % 8) + 2);
}

/** Valida dígitos verificadores; rejeita sequências repetidas (111.111.111-11). */
export function validarCpf(cpf: string): boolean {
  const d = digitosDocumento(cpf);
  if (d === null || d.length !== 11 || SEQUENCIA_REPETIDA.test(d)) return false;
  const n = Array.from(d, Number);
  const dv1 = dvCpf(n.slice(0, 9));
  const dv2 = dvCpf([...n.slice(0, 9), dv1]);
  return n[9] === dv1 && n[10] === dv2;
}

/** CNPJ numérico de 14 dígitos com dígitos verificadores (o CNPJ alfanumérico não é tratado). */
export function validarCnpj(cnpj: string): boolean {
  const d = digitosDocumento(cnpj);
  if (d === null || d.length !== 14 || SEQUENCIA_REPETIDA.test(d)) return false;
  const n = Array.from(d, Number);
  const dv1 = dvCnpj(n.slice(0, 12));
  const dv2 = dvCnpj([...n.slice(0, 12), dv1]);
  return n[12] === dv1 && n[13] === dv2;
}

function exigirDigitos(doc: string, tamanho: number, codigo: string, rotulo: string): string {
  const d = digitosDocumento(doc);
  if (d === null || d.length !== tamanho) {
    throw new ErroDominio(codigo, `${rotulo} deve ter ${tamanho} dígitos.`);
  }
  return d;
}

/** "123.456.789-09". Exige 11 dígitos (não verifica os dígitos verificadores). */
export function formatarCpf(cpf: string): string {
  const d = exigirDigitos(cpf, 11, 'CPF_INVALIDO', 'CPF');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** "12.345.678/0001-95". Exige 14 dígitos (não verifica os dígitos verificadores). */
export function formatarCnpj(cnpj: string): string {
  const d = exigirDigitos(cnpj, 14, 'CNPJ_INVALIDO', 'CNPJ');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function tipoDocumento(doc: string): 'cpf' | 'cnpj' | 'invalido' {
  if (validarCpf(doc)) return 'cpf';
  if (validarCnpj(doc)) return 'cnpj';
  return 'invalido';
}

/** Padrão de anonimização do governo federal: "***.456.789-**". Exige 11 dígitos. */
export function mascararCpf(cpf: string): string {
  const d = exigirDigitos(cpf, 11, 'CPF_INVALIDO', 'CPF');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** CNPJ é exibido completo (não é dado pessoal); CPF é mascarado; inválido → "Documento inválido". */
export function mascararDocumento(doc: string): string {
  const tipo = tipoDocumento(doc);
  if (tipo === 'cnpj') return formatarCnpj(doc);
  if (tipo === 'cpf') return mascararCpf(doc);
  return 'Documento inválido';
}

/** "joao.silva@mj.gov.br" → "j*********@mj.gov.br": mantém o 1º caractere e o domínio. */
export function mascararEmail(email: string): string {
  const e = typeof email === 'string' ? email.trim() : '';
  const arroba = e.lastIndexOf('@');
  if (arroba <= 0 || arroba === e.length - 1 || /\s/.test(e)) {
    throw new ErroDominio('EMAIL_INVALIDO', 'E-mail inválido.');
  }
  const local = Array.from(e.slice(0, arroba));
  const dominio = e.slice(arroba + 1);
  return `${local[0] ?? ''}${'*'.repeat(local.length - 1)}@${dominio}`;
}

/**
 * "(61) 99876-1234" → "(61) *****-1234". Aceita 10 ou 11 dígitos (com DDD), 12 ou 13 com o código 55,
 * ou 8 ou 9 dígitos sem DDD ("*****-1234").
 */
export function mascararTelefone(tel: string): string {
  let d = typeof tel === 'string' ? somenteDigitos(tel) : '';
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) {
    return `(${d.slice(0, 2)}) ${'*'.repeat(d.length - 6)}-${d.slice(-4)}`;
  }
  if (d.length === 8 || d.length === 9) {
    return `${'*'.repeat(d.length - 4)}-${d.slice(-4)}`;
  }
  throw new ErroDominio('TELEFONE_INVALIDO', 'Telefone inválido.');
}

/** "Maria das Graças Souza" → "Maria G. S.": primeiro nome e iniciais, ignorando da/das/de/do/dos/e. */
export function mascararNome(nome: string): string {
  const palavras = (typeof nome === 'string' ? nome.trim() : '').split(/\s+/).filter((p) => p.length > 0);
  const [primeiro, ...demais] = palavras;
  if (primeiro === undefined) throw new ErroDominio('NOME_INVALIDO', 'Nome vazio.');
  const iniciais = demais
    .filter((p) => !PARTICULAS_NOME.has(p.toLocaleLowerCase('pt-BR')))
    .map((p) => `${(Array.from(p)[0] ?? '').toLocaleUpperCase('pt-BR')}.`);
  return [primeiro, ...iniciais].join(' ');
}
