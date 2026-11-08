/**
 * Pesquisa de preços automatizada (RF-25) e projeção do valor estimado (RIA-11) do processo.
 * A cesta de preços refere-se ao item 1 do DFD (item de referência): é ele que se pesquisa.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  AVISO_SUGESTOES_PRECOS,
  selecionarSugestoesPrecos,
  type AmostraPrecoExterna,
  type OrigemPrecoAutomatizada,
  type SugestaoPrecoEnquadrada,
  type TipoObjetoPesquisa,
} from '@agora/dominio';
import type {
  ConsultaPrecos,
  FontePesquisaPrecos,
  ItemReferenciaPesquisa,
  PesquisaPrecosProcesso,
  ProjecaoValorEstimado,
  ResultadoFontePesquisa,
  SugestaoPreco,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { jsonCanonico } from '../../auditoria/trilha.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { coletarPrecos } from '../../integracoes/precos/coleta.ts';
import { opcoesHttpPadrao } from '../../integracoes/precos/http.ts';
import { listarTabelasEngenharia } from '../../integracoes/precos/referencias-engenharia.ts';
import { ehEngenharia, NOME_FONTE, type ColetaFonte, type ContextoColeta, type PedidoPesquisaPrecos } from '../../integracoes/precos/tipos.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';

export const MAXIMO_CONSULTAS_EXIBIDAS = 5;

const FONTE_DA_ORIGEM: Record<OrigemPrecoAutomatizada, FontePesquisaPrecos> = {
  painel_precos: 'PAINEL_PRECOS',
  contratacoes_similares: 'CONTRATACOES_SIMILARES',
  notas_fiscais: 'NOTAS_FISCAIS',
  sinapi: 'SINAPI',
  sicro: 'SICRO',
};

/** Palavras usuais que não ajudam a busca por nome de produto. */
const PALAVRAS_VAZIAS = new Set(['para', 'como', 'com', 'sem', 'tipo', 'modelo', 'unidade', 'item', 'marca', 'cada', 'pelo', 'pela', 'entre', 'sobre']);

export function contextoColeta(ctx: ContextoApp, esperar?: (ms: number) => Promise<void>): ContextoColeta {
  return {
    banco: ctx.banco,
    fetch: ctx.fetch,
    config: ctx.config.precos,
    hoje: ctx.hoje(),
    agora: ctx.relogio(),
    http: opcoesHttpPadrao(ctx.config.precos.timeoutMs, esperar),
  };
}

export function itemReferencia(linha: LinhaProcesso): ItemReferenciaPesquisa | null {
  const item = linha.dfd.itens[0];
  if (!item) return null;
  return { numero: 1, descricao: item.descricao, catmat: item.catmat, unidade: item.unidade };
}

/** Termo de busca sugerido: até 3 palavras significativas da descrição, na ordem em que aparecem. */
export function termoSugerido(descricao: string): string {
  const palavras = descricao
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(normalizarBusca(p)))
    .slice(0, 3);
  return palavras.join(' ').toLowerCase();
}

export function pedidoDoProcesso(linha: LinhaProcesso, item: ItemReferenciaPesquisa, entrada: { termo?: string | undefined; catmat?: string | null | undefined }): PedidoPesquisaPrecos {
  const preliminar = linha.dfd.itens[0]?.valorUnitarioEstimado ?? 0;
  const catmat = entrada.catmat === undefined ? item.catmat : entrada.catmat;
  return {
    termo: entrada.termo?.trim() || termoSugerido(item.descricao) || item.descricao.slice(0, 60),
    catmat: catmat === null || catmat.trim() === '' ? null : catmat.trim(),
    descricaoItem: item.descricao,
    unidade: item.unidade,
    tipoObjeto: linha.dfd.tipoObjeto as TipoObjetoPesquisa,
    uf: linha.uasg_uf,
    valorReferencia: preliminar > 0 ? preliminar : null,
  };
}

function resultadoFonte(c: ColetaFonte): ResultadoFontePesquisa {
  return {
    fonte: c.fonte,
    nome: NOME_FONTE[c.fonte],
    situacao: c.situacao,
    modo: c.modo,
    registros: c.registros,
    mensagem: c.mensagem,
    hashConteudo: c.hashConteudo,
    consultadoEm: c.consultadoEm,
    endereco: c.endereco,
  };
}

function sugestao(s: SugestaoPrecoEnquadrada): SugestaoPreco {
  return {
    id: randomUUID(),
    fonte: FONTE_DA_ORIGEM[s.origem],
    fonteCotacao: s.fonteCotacao,
    inciso: s.inciso,
    fundamento: s.fundamento,
    identificador: s.identificador,
    descricao: s.descricao,
    descricaoFonte: s.descricaoFonte,
    local: s.local && s.local.trim() !== '' ? s.local : null,
    unidade: s.unidade ?? null,
    valorUnitario: s.valorUnitario,
    data: s.data,
    cotacaoId: null,
    incluidaEm: null,
  };
}

/** Consulta todas as fontes e enquadra as amostras no art. 23 (nada é gravado aqui). */
export async function pesquisarPrecos(
  coletaCtx: ContextoColeta,
  modo: 'offline' | 'online',
  linha: LinhaProcesso,
  item: ItemReferenciaPesquisa,
  pedido: PedidoPesquisaPrecos,
  executadaPor: string | null,
): Promise<{ consulta: ConsultaPrecos; hashConteudo: string }> {
  const coletas = await coletarPrecos(coletaCtx, modo, pedido);
  const amostras: AmostraPrecoExterna[] = coletas.flatMap((c) => c.amostras);
  const selecao = selecionarSugestoesPrecos(amostras, { hoje: coletaCtx.hoje, tipoObjeto: pedido.tipoObjeto });
  const fontes = coletas.map(resultadoFonte);
  const sugestoes = selecao.sugestoes.map(sugestao);
  const hashConteudo = createHash('sha256')
    .update(jsonCanonico({ fontes: fontes.map((f) => [f.fonte, f.situacao, f.registros, f.hashConteudo]), sugestoes: sugestoes.map((s) => [s.identificador, s.valorUnitario, s.data]) }))
    .digest('hex');
  return {
    hashConteudo,
    consulta: {
      id: randomUUID(),
      item,
      termo: pedido.termo,
      uf: linha.uasg_uf,
      modo,
      executadaEm: coletaCtx.agora.toISOString(),
      executadaPor,
      fontes,
      sugestoes,
      descartadas: selecao.descartadas.map((d) => ({ fonte: FONTE_DA_ORIGEM[d.origem], identificador: d.identificador, motivo: d.motivo })),
      excedentes: selecao.excedentes,
      alertas: selecao.alertas,
      aviso: selecao.aviso,
    },
  };
}

interface LinhaConsulta {
  id: string;
  item: ItemReferenciaPesquisa;
  termo: string;
  uf: string;
  modo: 'offline' | 'online';
  fontes: ResultadoFontePesquisa[];
  sugestoes: SugestaoPreco[];
  descartadas: ConsultaPrecos['descartadas'];
  excedentes: number;
  alertas: ConsultaPrecos['alertas'];
  executada_em: string;
  executada_por_nome: string | null;
}

function mapearConsulta(l: LinhaConsulta): ConsultaPrecos {
  return {
    id: l.id,
    item: l.item,
    termo: l.termo,
    uf: l.uf,
    modo: l.modo,
    executadaEm: l.executada_em,
    executadaPor: l.executada_por_nome,
    fontes: l.fontes,
    sugestoes: l.sugestoes,
    descartadas: l.descartadas,
    excedentes: l.excedentes,
    alertas: l.alertas,
    aviso: AVISO_SUGESTOES_PRECOS,
  };
}

const SELECAO_CONSULTA = `
  SELECT c.id, c.item, c.termo, c.uf, c.modo, c.fontes, c.sugestoes, c.descartadas, c.excedentes, c.alertas, c.executada_em,
         u.nome AS executada_por_nome
    FROM consultas_precos c
    LEFT JOIN usuarios u ON u.id = c.executada_por`;

export async function gravarConsulta(executor: Executor, processoId: string, consulta: ConsultaPrecos, hashConteudo: string, usuarioId: string | null): Promise<void> {
  await executor.executar(
    `INSERT INTO consultas_precos (id, processo_id, item, termo, uf, modo, fontes, sugestoes, descartadas, excedentes, alertas, hash_conteudo, executada_por, executada_em)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb, $12, $13, $14)`,
    [
      consulta.id,
      processoId,
      JSON.stringify(consulta.item),
      consulta.termo,
      consulta.uf,
      consulta.modo,
      JSON.stringify(consulta.fontes),
      JSON.stringify(consulta.sugestoes),
      JSON.stringify(consulta.descartadas),
      consulta.excedentes,
      JSON.stringify(consulta.alertas),
      hashConteudo,
      usuarioId,
      consulta.executadaEm,
    ],
  );
}

export async function obterConsulta(executor: Executor, processoId: string, consultaId: string, bloquear = false): Promise<ConsultaPrecos | null> {
  const [linha] = await executor.consultar<LinhaConsulta>(
    `${SELECAO_CONSULTA} WHERE c.id = $1 AND c.processo_id = $2${bloquear ? ' FOR UPDATE OF c' : ''}`,
    [consultaId, processoId],
  );
  return linha ? mapearConsulta(linha) : null;
}

export async function marcarSugestoesIncluidas(executor: Executor, consultaId: string, sugestoes: readonly SugestaoPreco[]): Promise<void> {
  await executor.executar('UPDATE consultas_precos SET sugestoes = $2::jsonb WHERE id = $1', [consultaId, JSON.stringify(sugestoes)]);
}

export async function gravarProjecao(executor: Executor, processoId: string, projecao: ProjecaoValorEstimado, usuarioId: string | null): Promise<void> {
  await executor.executar(
    `INSERT INTO projecoes_valor_estimado (id, processo_id, data_prevista, percentual_cambial, resultado, gerada_por, gerada_em)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [projecao.id, processoId, projecao.dataPrevista, projecao.percentualCambial, JSON.stringify(projecao), usuarioId, projecao.geradaEm],
  );
}

async function ultimaProjecao(executor: Executor, processoId: string): Promise<ProjecaoValorEstimado | null> {
  const [linha] = await executor.consultar<{ resultado: ProjecaoValorEstimado }>(
    'SELECT resultado FROM projecoes_valor_estimado WHERE processo_id = $1 ORDER BY gerada_em DESC, id LIMIT 1',
    [processoId],
  );
  return linha?.resultado ?? null;
}

/** Painel da pesquisa automatizada do processo: últimas consultas, última projeção e tabelas de obras da UF. */
export async function montarPesquisa(executor: Executor, linha: LinhaProcesso, modo: 'offline' | 'online'): Promise<PesquisaPrecosProcesso> {
  const item = itemReferencia(linha);
  const consultas = await executor.consultar<LinhaConsulta>(`${SELECAO_CONSULTA} WHERE c.processo_id = $1 ORDER BY c.executada_em DESC, c.id LIMIT $2`, [
    linha.id,
    MAXIMO_CONSULTAS_EXIBIDAS,
  ]);
  const engenharia = ehEngenharia(linha.dfd.tipoObjeto as TipoObjetoPesquisa);
  return {
    modo,
    itemReferencia: item,
    termoSugerido: item ? termoSugerido(item.descricao) : '',
    uf: linha.uasg_uf,
    engenharia,
    consultas: consultas.map(mapearConsulta),
    projecao: await ultimaProjecao(executor, linha.id),
    tabelasEngenharia: engenharia ? await listarTabelasEngenharia(executor, linha.uasg_uf) : [],
  };
}

