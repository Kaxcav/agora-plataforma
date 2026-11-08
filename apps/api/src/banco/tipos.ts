/**
 * Adaptador de banco de dados: a mesma interface sobre PGlite (demonstração/desenvolvimento/testes)
 * e PostgreSQL via `pg` (produção). Os tipos são normalizados nos dois modos:
 * - `bigint` e `numeric` → number (centavos cabem com folga em 2^53);
 * - `date` → 'YYYY-MM-DD' (string, nunca Date, para não sofrer com fuso);
 * - `timestamptz` → instante ISO 8601 UTC (string).
 */
export type ParametroSql = string | number | boolean | null | readonly string[] | readonly number[];

export interface Executor {
  /** Consulta parametrizada; devolve as linhas tipadas pelo chamador. */
  consultar<T>(sql: string, parametros?: readonly ParametroSql[]): Promise<T[]>;
  /** Comando parametrizado; devolve a quantidade de linhas afetadas. */
  executar(sql: string, parametros?: readonly ParametroSql[]): Promise<number>;
  /** Script com vários comandos, sem parâmetros (migrações). */
  executarScript(sql: string): Promise<void>;
}

/** Executor dentro de uma transação aberta (exigido por operações que precisam de atomicidade, como a auditoria). */
export interface Transacao extends Executor {
  readonly emTransacao: true;
}

export interface Banco extends Executor {
  readonly tipo: 'pglite' | 'postgres';
  /** Executa `fn` em uma transação; confirma ao final ou desfaz se `fn` lançar. */
  transacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
  /** Verifica se o banco responde (usado em /saude/pronto). */
  verificar(): Promise<boolean>;
  fechar(): Promise<void>;
}

export const OID = {
  INT8: 20,
  NUMERIC: 1700,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
} as const;
