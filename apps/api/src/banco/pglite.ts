import { mkdirSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { OID, type Banco, type Executor, type ParametroSql, type Transacao } from './tipos.ts';

const parsers = {
  [OID.INT8]: (v: string) => Number(v),
  [OID.NUMERIC]: (v: string) => Number(v),
  [OID.DATE]: (v: string) => v,
  [OID.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
  [OID.TIMESTAMP]: (v: string) => new Date(`${v.replace(' ', 'T')}Z`).toISOString(),
};

type Consultavel = Pick<PGlite, 'query' | 'exec'> | Transaction;

function executor(alvo: Consultavel): Executor {
  return {
    async consultar<T>(sql: string, parametros: readonly ParametroSql[] = []): Promise<T[]> {
      const resultado = await alvo.query<T>(sql, [...parametros]);
      return resultado.rows;
    },
    async executar(sql: string, parametros: readonly ParametroSql[] = []): Promise<number> {
      const resultado = await alvo.query(sql, [...parametros]);
      return resultado.affectedRows ?? 0;
    },
    async executarScript(sql: string): Promise<void> {
      await alvo.exec(sql);
    },
  };
}

/** Abre o PGlite em `dadosDir` (diretório) ou em memória quando `dadosDir` começa com `memory://`. */
export async function abrirPglite(dadosDir: string): Promise<Banco> {
  const emMemoria = dadosDir.startsWith('memory://');
  if (!emMemoria) mkdirSync(dadosDir, { recursive: true });
  const db = await PGlite.create(emMemoria ? 'memory://' : dadosDir, { parsers });
  const base = executor(db);
  return {
    tipo: 'pglite',
    ...base,
    transacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
      return db.transaction((tx) => fn({ ...executor(tx), emTransacao: true }));
    },
    async verificar(): Promise<boolean> {
      if (db.closed) return false;
      const linhas = await base.consultar<{ ok: number }>('SELECT 1 AS ok');
      return linhas[0]?.ok === 1;
    },
    async fechar(): Promise<void> {
      if (!db.closed) await db.close();
    },
  };
}
