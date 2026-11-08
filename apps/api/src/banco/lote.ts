import type { Executor, ParametroSql } from './tipos.ts';

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

/**
 * Insere várias linhas com um único comando parametrizado por lote.
 * `tabela` e `colunas` são constantes do código (validadas como identificadores); os valores vão sempre como parâmetros.
 */
export async function inserirEmLote(
  tx: Executor,
  tabela: string,
  colunas: readonly string[],
  linhas: readonly (readonly ParametroSql[])[],
  tamanhoLote = 400,
): Promise<void> {
  if (!IDENTIFICADOR.test(tabela) || colunas.some((c) => !IDENTIFICADOR.test(c))) {
    throw new Error(`Identificador inválido em inserção em lote: ${tabela}`);
  }
  for (let inicio = 0; inicio < linhas.length; inicio += tamanhoLote) {
    const lote = linhas.slice(inicio, inicio + tamanhoLote);
    const parametros: ParametroSql[] = [];
    const tuplas = lote.map((linha) => {
      if (linha.length !== colunas.length) {
        throw new Error(`Linha com ${linha.length} valores para ${colunas.length} colunas em ${tabela}`);
      }
      const marcadores = linha.map((valor) => {
        parametros.push(valor);
        return `$${parametros.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });
    await tx.executar(`INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${tuplas.join(', ')}`, parametros);
  }
}
