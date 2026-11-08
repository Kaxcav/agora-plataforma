import { validarDataISO } from '@agora/dominio';
import type { Pagina } from '@agora/contratos';
import { z } from 'zod';
import { naoEncontrado } from './erros.ts';

/** `pagina` (1..n) e `tamanhoPagina` (1..100, padrão 25; a interface usa 10, 25, 50 ou 100). */
export const camposPaginacao = {
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  tamanhoPagina: z.coerce.number().int().min(1).max(100).default(25),
};

export const textoBusca = z.string().trim().max(200).optional();
export const ordemQuery = z.enum(['asc', 'desc']).optional();
export const booleanoQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
export const codigoUasg = z.string().regex(/^\d{6}$/, 'UASG deve ter 6 dígitos');
export const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((d) => validarDataISO(d), 'Data inválida');
export const centavos = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const uuid = z.uuid();

/** Id de rota: um identificador malformado também responde 404 (não revela existência nem formato). */
export function idDaRota(params: unknown, campo = 'id'): string {
  const valor = typeof params === 'object' && params !== null ? (params as Record<string, unknown>)[campo] : undefined;
  const resultado = uuid.safeParse(valor);
  if (!resultado.success) throw naoEncontrado();
  return resultado.data.toLowerCase();
}

export function pagina<T>(itens: T[], total: number, numero: number, tamanho: number): Pagina<T> {
  return { itens, total, pagina: numero, tamanhoPagina: tamanho };
}

export function paginarEmMemoria<T>(todos: readonly T[], numero: number, tamanho: number): Pagina<T> {
  const inicio = (numero - 1) * tamanho;
  return pagina(todos.slice(inicio, inicio + tamanho), todos.length, numero, tamanho);
}

export function deslocamento(numero: number, tamanho: number): number {
  return (numero - 1) * tamanho;
}

/** Ordenação estável por uma chave, com direção. */
export function ordenarPor<T>(itens: T[], chave: (item: T) => string | number, direcao: 'asc' | 'desc'): T[] {
  const fator = direcao === 'asc' ? 1 : -1;
  return itens
    .map((item, indice) => ({ item, indice, valor: chave(item) }))
    .sort((a, b) => {
      if (a.valor < b.valor) return -1 * fator;
      if (a.valor > b.valor) return 1 * fator;
      return a.indice - b.indice;
    })
    .map((x) => x.item);
}
