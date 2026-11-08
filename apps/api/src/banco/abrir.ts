import type { Config } from '../config.ts';
import { abrirPglite } from './pglite.ts';
import { abrirPostgres } from './postgres.ts';
import type { Banco } from './tipos.ts';

/** PostgreSQL quando `AGORA_BANCO_URL` está definido; senão PGlite em `AGORA_DADOS_DIR`. */
export function abrirBanco(config: Pick<Config, 'bancoUrl' | 'dadosDir'>, aoErroDeConexao: (erro: Error) => void): Promise<Banco> {
  if (config.bancoUrl !== null) return abrirPostgres(config.bancoUrl, aoErroDeConexao);
  return abrirPglite(config.dadosDir);
}
