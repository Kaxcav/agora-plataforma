import pg from 'pg';
import type { CustomTypesConfig, PoolClient } from 'pg';
import { OID, type Banco, type Executor, type ParametroSql, type Transacao } from './tipos.ts';

const parserInstantePadrao: (v: string) => Date = pg.types.getTypeParser(OID.TIMESTAMPTZ, 'text');
const parserTimestampPadrao: (v: string) => Date = pg.types.getTypeParser(OID.TIMESTAMP, 'text');

const tipos: CustomTypesConfig = {
  getTypeParser: ((oid: number, formato?: 'text' | 'binary') => {
    switch (oid) {
      case OID.INT8:
      case OID.NUMERIC:
        return (v: string) => Number(v);
      case OID.DATE:
        return (v: string) => v;
      case OID.TIMESTAMPTZ:
        return (v: string) => parserInstantePadrao(v).toISOString();
      case OID.TIMESTAMP:
        return (v: string) => parserTimestampPadrao(v).toISOString();
      default:
        return pg.types.getTypeParser(oid, formato);
    }
  }) as CustomTypesConfig['getTypeParser'],
};

function executor(cliente: pg.Pool | PoolClient): Executor {
  return {
    async consultar<T>(sql: string, parametros: readonly ParametroSql[] = []): Promise<T[]> {
      const resultado = await cliente.query(sql, [...parametros]);
      return resultado.rows as T[];
    },
    async executar(sql: string, parametros: readonly ParametroSql[] = []): Promise<number> {
      const resultado = await cliente.query(sql, [...parametros]);
      return resultado.rowCount ?? 0;
    },
    async executarScript(sql: string): Promise<void> {
      await cliente.query(sql);
    },
  };
}

/** Abre um pool de conexões com o PostgreSQL (produção). */
export async function abrirPostgres(url: string, aoErroDeConexao: (erro: Error) => void): Promise<Banco> {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    application_name: 'agora',
    types: tipos,
  });
  pool.on('error', aoErroDeConexao);
  const base = executor(pool);
  let fechado = false;

  return {
    tipo: 'postgres',
    ...base,
    async transacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
      const cliente = await pool.connect();
      let erroLiberacao: Error | undefined;
      try {
        await cliente.query('BEGIN');
        const resultado = await fn({ ...executor(cliente), emTransacao: true });
        await cliente.query('COMMIT');
        return resultado;
      } catch (erro) {
        await cliente.query('ROLLBACK').catch((erroRollback: unknown) => {
          erroLiberacao = erroRollback instanceof Error ? erroRollback : new Error(String(erroRollback));
          aoErroDeConexao(erroLiberacao);
        });
        throw erro;
      } finally {
        cliente.release(erroLiberacao);
      }
    },
    async verificar(): Promise<boolean> {
      if (fechado) return false;
      const linhas = await base.consultar<{ ok: number }>('SELECT 1 AS ok');
      return linhas[0]?.ok === 1;
    },
    async fechar(): Promise<void> {
      if (fechado) return;
      fechado = true;
      await pool.end();
    },
  };
}
