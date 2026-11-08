/**
 * Sinapi e Sicro (art. 23, § 2º, I). Nenhum dos dois sistemas tem API pública: a Caixa publica o Sinapi e o DNIT
 * publica o Sicro como planilhas mensais por UF. A Ágora importa no servidor a tabela oficial (CSV extraído da
 * planilha) e consulta essa cópia local, com a data-base e o hash do lote como proveniência.
 */
import { createHash } from 'node:crypto';
import type { AmostraPrecoExterna } from '@agora/dominio';
import type { TabelaReferenciaEngenharia } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { jsonCanonico } from '../../auditoria/trilha.ts';
import { normalizarBusca, palavrasSignificativas } from '../../compartilhado/texto.ts';
import type { ColetaFonte, ContextoColeta, PedidoPesquisaPrecos } from './tipos.ts';

const MAXIMO_AMOSTRAS = 10;

interface LinhaLote {
  sistema: 'SINAPI' | 'SICRO';
  uf: string;
  data_base: string;
  desonerado: boolean;
  itens: number;
  hash_conteudo: string;
  importado_em: string;
}

export function mapearLote(l: LinhaLote): TabelaReferenciaEngenharia {
  return { sistema: l.sistema, uf: l.uf, dataBase: l.data_base, desonerado: l.desonerado, itens: l.itens, importadaEm: l.importado_em, hashConteudo: l.hash_conteudo };
}

export async function listarTabelasEngenharia(executor: Executor, uf?: string): Promise<TabelaReferenciaEngenharia[]> {
  const linhas = await executor.consultar<LinhaLote>(
    `SELECT sistema, uf, data_base, desonerado, itens, hash_conteudo, importado_em
       FROM referencias_engenharia_lotes
      WHERE ($1::text IS NULL OR uf = $1)
      ORDER BY sistema, uf, data_base DESC, desonerado`,
    [uf ?? null],
  );
  return linhas.map(mapearLote);
}

function rotuloDataBase(dataBase: string): string {
  return `${dataBase.slice(5, 7)}/${dataBase.slice(0, 4)}`;
}

/** Consulta a tabela mais recente do sistema para a UF do processo (não desonerada, se houver as duas). */
export async function consultarReferenciaEngenharia(
  ctx: Pick<ContextoColeta, 'banco' | 'agora'>,
  pedido: PedidoPesquisaPrecos,
  sistema: 'SINAPI' | 'SICRO',
): Promise<ColetaFonte> {
  const consultadoEm = ctx.agora.toISOString();
  const base = { fonte: sistema, modo: 'local' as const, endereco: null, consultadoEm };
  const [lote] = await ctx.banco.consultar<LinhaLote>(
    `SELECT sistema, uf, data_base, desonerado, itens, hash_conteudo, importado_em
       FROM referencias_engenharia_lotes
      WHERE sistema = $1 AND uf = $2
      ORDER BY data_base DESC, desonerado ASC
      LIMIT 1`,
    [sistema, pedido.uf],
  );
  if (!lote) {
    return {
      ...base,
      situacao: 'sem_resultado',
      amostras: [],
      registros: 0,
      mensagem: `Nenhuma tabela do ${sistema} da UF ${pedido.uf} foi importada no servidor. Importe a tabela oficial da data-base mais recente.`,
      hashConteudo: null,
    };
  }
  const palavras = [...palavrasSignificativas(pedido.termo)];
  const linhas =
    palavras.length === 0
      ? []
      : await ctx.banco.consultar<{ codigo: string; descricao: string; unidade: string; preco: number; busca_normalizada: string }>(
          `SELECT codigo, descricao, unidade, preco, busca_normalizada
             FROM referencias_engenharia
            WHERE sistema = $1 AND uf = $2 AND data_base = $3 AND desonerado = $4
              AND busca_normalizada LIKE ANY ($5::text[])
            ORDER BY codigo`,
          [lote.sistema, lote.uf, lote.data_base, lote.desonerado, palavras.map((p) => `%${p}%`)],
        );
  // Exige ao menos metade das palavras do termo, para não sugerir composições alheias ao item.
  const minimo = Math.max(1, Math.ceil(palavras.length / 2));
  const ranqueadas = linhas
    .map((l) => ({ ...l, pontos: palavras.filter((p) => l.busca_normalizada.includes(p)).length }))
    .filter((l) => l.pontos >= minimo)
    .sort((a, b) => b.pontos - a.pontos || a.codigo.localeCompare(b.codigo))
    .slice(0, MAXIMO_AMOSTRAS);
  const situacaoTabela = `${lote.desonerado ? 'desonerada' : 'não desonerada'}, data-base ${rotuloDataBase(lote.data_base)}`;
  const amostras: AmostraPrecoExterna[] = ranqueadas.map((l) => ({
    origem: sistema === 'SINAPI' ? 'sinapi' : 'sicro',
    identificador: `${sistema} ${l.codigo} (${situacaoTabela})`,
    descricao: l.descricao,
    valorUnitario: l.preco,
    data: `${lote.data_base}-01`,
    unidade: l.unidade,
    local: `UF ${lote.uf}`,
  }));
  return {
    ...base,
    situacao: amostras.length > 0 ? 'ok' : 'sem_resultado',
    amostras,
    registros: amostras.length,
    mensagem: `${sistema} ${lote.uf} (${situacaoTabela}, lote ${lote.hash_conteudo.slice(0, 12)}): ${amostras.length} composição(ões) compatível(is) com "${pedido.termo}".`,
    hashConteudo: createHash('sha256').update(jsonCanonico(ranqueadas.map(({ codigo, preco }) => ({ codigo, preco })))).digest('hex'),
  };
}

export interface LinhaReferencia {
  codigo: string;
  descricao: string;
  unidade: string;
  preco: number;
}

/** Grava (ou substitui) um lote da tabela oficial. Devolve quantas linhas do lote anterior foram substituídas. */
export async function gravarLoteReferencias(
  executor: Executor,
  lote: { sistema: 'SINAPI' | 'SICRO'; uf: string; dataBase: string; desonerado: boolean; hashConteudo: string; importadoPor: string | null; importadoEm: string },
  linhas: readonly LinhaReferencia[],
): Promise<{ tabela: TabelaReferenciaEngenharia; substituidos: number }> {
  const chave = [lote.sistema, lote.uf, lote.dataBase, lote.desonerado] as const;
  const [anterior] = await executor.consultar<{ itens: number }>(
    'SELECT itens FROM referencias_engenharia_lotes WHERE sistema = $1 AND uf = $2 AND data_base = $3 AND desonerado = $4',
    [...chave],
  );
  await executor.executar('DELETE FROM referencias_engenharia_lotes WHERE sistema = $1 AND uf = $2 AND data_base = $3 AND desonerado = $4', [...chave]);
  await executor.executar(
    `INSERT INTO referencias_engenharia_lotes (sistema, uf, data_base, desonerado, itens, hash_conteudo, importado_por, importado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...chave, linhas.length, lote.hashConteudo, lote.importadoPor, lote.importadoEm],
  );
  for (const l of linhas) {
    await executor.executar(
      `INSERT INTO referencias_engenharia (sistema, uf, data_base, desonerado, codigo, descricao, unidade, preco, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [...chave, l.codigo, l.descricao, l.unidade, l.preco, normalizarBusca(l.codigo, l.descricao)],
    );
  }
  return {
    tabela: {
      sistema: lote.sistema,
      uf: lote.uf,
      dataBase: lote.dataBase,
      desonerado: lote.desonerado,
      itens: linhas.length,
      importadaEm: lote.importadoEm,
      hashConteudo: lote.hashConteudo,
    },
    substituidos: anterior?.itens ?? 0,
  };
}
