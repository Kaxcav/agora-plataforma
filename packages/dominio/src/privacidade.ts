/**
 * Tarja de dados pessoais em texto livre (LGPD, art. 6º, III, e art. 46): CPF, e-mail e telefone escritos por
 * qualquer pessoa — o cidadão que se manifesta, o servidor que responde ou a justificativa de um aditivo publicada
 * como dado aberto. Mais ampla que a tarja dos documentos gerados, que só encontra os formatos usuais:
 * aqui também entram CPF sem pontuação (só quando os dígitos verificadores conferem) e telefone sem parênteses.
 */
import { mascararCpf, mascararEmail, mascararTelefone, validarCpf } from './documentos.ts';

const CPF_FORMATADO = /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d-])/g;
const SEQUENCIA_ONZE_DIGITOS = /(?<![\d./-])\d{11}(?![\d/-])/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** (61) 99876-1234, (61)3333-4444, +55 61 99876-1234, 61 99876-1234 e 99876-1234 (celular sem DDD). */
const TELEFONE = /(?:\+55\s?)?(?:\(\d{2}\)\s?|\b\d{2}\s)\d{4,5}-?\d{4}\b|\b9\d{4}-\d{4}\b/g;
/** Celular com DDD escrito só com dígitos (11 dígitos, nono dígito 9) que não é CPF válido. */
const CELULAR_SEM_PONTUACAO = /^[1-9]{2}9\d{8}$/;

function tarjarTelefone(trecho: string): string {
  try {
    return mascararTelefone(trecho);
  } catch {
    return trecho;
  }
}

/**
 * Substitui CPF por "***.456.789-**", e-mail por "j*****@dominio" e telefone por "(61) *****-1234".
 * Idempotente: o texto já tarjado não é alterado de novo.
 */
export function tarjarDadosPessoaisLivres(texto: string): string {
  if (typeof texto !== 'string' || texto.length === 0) return '';
  return texto
    .replace(EMAIL, (email) => mascararEmail(email))
    .replace(CPF_FORMATADO, (cpf) => mascararCpf(cpf))
    .replace(SEQUENCIA_ONZE_DIGITOS, (digitos) => {
      if (validarCpf(digitos)) return mascararCpf(digitos);
      return CELULAR_SEM_PONTUACAO.test(digitos) ? tarjarTelefone(digitos) : digitos;
    })
    .replace(TELEFONE, (telefone) => tarjarTelefone(telefone));
}

/** true quando o texto traz CPF, e-mail ou telefone ainda não tarjados. */
export function contemDadoPessoal(texto: string): boolean {
  if (typeof texto !== 'string' || texto.length === 0) return false;
  return tarjarDadosPessoaisLivres(texto) !== texto;
}
