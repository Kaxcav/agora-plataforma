import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Banco } from './tipos.ts';

/** Diretório `apps/api/migracoes` (o mesmo a partir de `src/` e de `dist/`). */
export const DIRETORIO_MIGRACOES = fileURLToPath(new URL('../../migracoes/', import.meta.url));

/** Chave do advisory lock que serializa a aplicação de migrações entre réplicas. */
const CHAVE_LOCK_MIGRACOES = 14_133_001;

export interface Migracao {
  nome: string;
  sql: string;
  hash: string;
}

export class ErroMigracao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroMigracao';
  }
}

/** Lista as migrações `NNN_nome.sql` em ordem. */
export function listarMigracoes(diretorio: string = DIRETORIO_MIGRACOES): Migracao[] {
  return readdirSync(diretorio)
    .filter((arquivo) => /^\d{3}_[a-z0-9_]+\.sql$/.test(arquivo))
    .sort()
    .map((arquivo) => {
      const sql = readFileSync(join(diretorio, arquivo), 'utf8');
      return { nome: arquivo, sql, hash: createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Aplica, em ordem, as migrações ainda não aplicadas — cada uma em sua própria transação,
 * registrada em `migracoes_aplicadas`. Uma migração já aplicada e depois alterada interrompe a inicialização.
 */
export async function aplicarMigracoes(banco: Banco, diretorio: string = DIRETORIO_MIGRACOES): Promise<string[]> {
  await banco.executarScript(`
    CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
      nome text PRIMARY KEY,
      hash text NOT NULL,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    );
  `);
  const aplicadas: string[] = [];
  for (const migracao of listarMigracoes(diretorio)) {
    const aplicou = await banco.transacao(async (tx) => {
      await tx.consultar('SELECT pg_advisory_xact_lock($1)', [CHAVE_LOCK_MIGRACOES]);
      const existentes = await tx.consultar<{ hash: string }>(
        'SELECT hash FROM migracoes_aplicadas WHERE nome = $1',
        [migracao.nome],
      );
      const existente = existentes[0];
      if (existente) {
        if (existente.hash !== migracao.hash) {
          throw new ErroMigracao(
            `A migração ${migracao.nome} foi alterada depois de aplicada. Crie uma nova migração em vez de editar a existente.`,
          );
        }
        return false;
      }
      await tx.executarScript(migracao.sql);
      await tx.executar('INSERT INTO migracoes_aplicadas (nome, hash) VALUES ($1, $2)', [migracao.nome, migracao.hash]);
      return true;
    });
    if (aplicou) aplicadas.push(migracao.nome);
  }
  return aplicadas;
}

/** Remove o esquema público inteiro (usado só por `seed --reset` em demonstração). */
export async function apagarEsquema(banco: Banco): Promise<void> {
  await banco.executarScript('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
