/**
 * Índices oficiais da projeção do valor estimado (RIA-11), consultados só pelo servidor:
 * - IPCA, variação mensal (%): IBGE, API do SIDRA, tabela 1737, variável 63;
 * - câmbio, dólar americano (venda), média mensal (R$): Banco Central, SGS, série 3698.
 * Online, a consulta atualiza a tabela `indices_economicos` (proveniência: horário e hash da resposta). Se a fonte
 * falhar, usa-se a última série gravada, com aviso. Offline (padrão), usa-se a série gravada pela carga sintética.
 */
import { createHash } from 'node:crypto';
import type { SerieIndiceProjecao } from '@agora/contratos';
import { z } from 'zod';
import type { Executor } from '../../banco/tipos.ts';
import { jsonCanonico } from '../../auditoria/trilha.ts';
import { ErroIntegracao } from '../conector.ts';
import { lerJson, obterTexto } from './http.ts';
import type { ContextoColeta } from './tipos.ts';

export type SerieIndice = SerieIndiceProjecao['serie'];

export const SERIES_INDICES: Record<SerieIndice, { nome: string; fonte: string; quantidade: number }> = {
  IPCA: { nome: 'IPCA — variação mensal (%)', fonte: 'IBGE — SIDRA, tabela 1737, variável 63 (IPCA, variação mensal)', quantidade: 12 },
  CAMBIO_USD: { nome: 'Dólar americano (venda) — média mensal (R$)', fonte: 'Banco Central do Brasil — SGS, série 3698 (dólar, venda, média do período)', quantidade: 13 },
};

const linhaSidra = z.object({ V: z.string(), D3C: z.string() });
const linhaSgs = z.object({ data: z.string(), valor: z.string() });

interface PontoSerie {
  competencia: string;
  valor: number;
}

function urlSerie(ctx: Pick<ContextoColeta, 'config'>, serie: SerieIndice): string {
  return serie === 'IPCA'
    ? `${ctx.config.ibgeSidraUrl}/values/t/1737/n1/all/v/63/p/last%20${SERIES_INDICES.IPCA.quantidade}`
    : `${ctx.config.bcbSgsUrl}/bcdata.sgs.3698/dados/ultimos/${SERIES_INDICES.CAMBIO_USD.quantidade}?formato=json`;
}

function interpretar(serie: SerieIndice, corpo: string): PontoSerie[] {
  const json = lerJson(corpo, serie === 'IPCA' ? 'IBGE (SIDRA)' : 'Banco Central (SGS)');
  if (!Array.isArray(json)) throw new ErroIntegracao(`Resposta da série ${serie} em formato inesperado.`);
  const pontos: PontoSerie[] = [];
  for (const bruto of json) {
    if (serie === 'IPCA') {
      const l = linhaSidra.safeParse(bruto);
      if (!l.success || !/^\d{6}$/.test(l.data.D3C)) continue; // a primeira linha do SIDRA é o cabeçalho
      const valor = Number(l.data.V);
      if (!Number.isFinite(valor)) continue; // "..." ou "-" = sem dado
      pontos.push({ competencia: `${l.data.D3C.slice(0, 4)}-${l.data.D3C.slice(4, 6)}`, valor });
    } else {
      const l = linhaSgs.safeParse(bruto);
      const data = l.success ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(l.data.data) : null;
      const valor = l.success ? Number(l.data.valor) : Number.NaN;
      if (!data || !Number.isFinite(valor) || valor <= 0) continue;
      pontos.push({ competencia: `${data[3]}-${data[2]}`, valor });
    }
  }
  if (pontos.length === 0) throw new ErroIntegracao(`A série ${serie} veio sem valores.`);
  return pontos;
}

/** Consulta a fonte oficial e grava a série (substitui as competências já gravadas). */
export async function atualizarSerieOnline(ctx: Pick<ContextoColeta, 'banco' | 'fetch' | 'config' | 'agora' | 'http'>, serie: SerieIndice): Promise<number> {
  const corpo = await obterTexto(ctx.fetch, urlSerie(ctx, serie), serie === 'IPCA' ? 'IBGE (SIDRA)' : 'Banco Central (SGS)', ctx.http);
  const pontos = interpretar(serie, corpo);
  const hash = createHash('sha256').update(corpo).digest('hex');
  for (const p of pontos) {
    await ctx.banco.executar(
      `INSERT INTO indices_economicos (serie, competencia, valor, modo, fonte, consultado_em, hash_conteudo)
       VALUES ($1, $2, $3, 'online', $4, $5, $6)
       ON CONFLICT (serie, competencia) DO UPDATE
         SET valor = EXCLUDED.valor, modo = 'online', fonte = EXCLUDED.fonte, consultado_em = EXCLUDED.consultado_em, hash_conteudo = EXCLUDED.hash_conteudo`,
      [serie, p.competencia, p.valor, SERIES_INDICES[serie].fonte, ctx.agora.toISOString(), hash],
    );
  }
  return pontos.length;
}

/** Últimas competências gravadas da série, com a proveniência do conjunto usado. */
export async function lerSerieGravada(executor: Executor, serie: SerieIndice): Promise<SerieIndiceProjecao | null> {
  const linhas = await executor.consultar<{ competencia: string; valor: number; modo: 'offline' | 'online'; fonte: string; consultado_em: string }>(
    `SELECT competencia, valor, modo, fonte, consultado_em FROM indices_economicos
      WHERE serie = $1 ORDER BY competencia DESC LIMIT $2`,
    [serie, SERIES_INDICES[serie].quantidade],
  );
  if (linhas.length === 0) return null;
  const ordenadas = [...linhas].reverse();
  const competencias = ordenadas.map((l) => ({ competencia: l.competencia, valor: Number(l.valor) }));
  return {
    serie,
    nome: SERIES_INDICES[serie].nome,
    fonte: ordenadas[ordenadas.length - 1]?.fonte ?? SERIES_INDICES[serie].fonte,
    modo: ordenadas.some((l) => l.modo === 'offline') ? 'offline' : 'online',
    competencias,
    consultadoEm: ordenadas.reduce((maior, l) => (l.consultado_em > maior ? l.consultado_em : maior), ordenadas[0]?.consultado_em ?? ''),
    hashConteudo: createHash('sha256').update(jsonCanonico(competencias)).digest('hex'),
  };
}

/**
 * Séries para a projeção. Online, tenta atualizar cada série na fonte oficial; em falha, segue com a série gravada
 * e devolve o aviso. Sem série gravada suficiente, a projeção não é possível (o chamador responde 422).
 */
export async function obterSeriesProjecao(
  ctx: Pick<ContextoColeta, 'banco' | 'fetch' | 'config' | 'agora' | 'http'>,
  modo: 'offline' | 'online',
  incluirCambio: boolean,
): Promise<{ ipca: SerieIndiceProjecao | null; cambio: SerieIndiceProjecao | null; avisos: string[] }> {
  const avisos: string[] = [];
  const series: SerieIndice[] = incluirCambio ? ['IPCA', 'CAMBIO_USD'] : ['IPCA'];
  if (modo === 'online') {
    for (const serie of series) {
      try {
        await atualizarSerieOnline(ctx, serie);
      } catch (erro) {
        const motivo = erro instanceof ErroIntegracao ? erro.message : 'falha inesperada';
        avisos.push(`${SERIES_INDICES[serie].nome}: ${motivo} Foi usada a última série gravada no servidor.`);
      }
    }
  }
  return {
    ipca: await lerSerieGravada(ctx.banco, 'IPCA'),
    cambio: incluirCambio ? await lerSerieGravada(ctx.banco, 'CAMBIO_USD') : null,
    avisos,
  };
}
