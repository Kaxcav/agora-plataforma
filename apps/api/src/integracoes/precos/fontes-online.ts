/**
 * Conectores online das fontes de preços (art. 23, § 1º, I, II e V), chamados só pelo servidor:
 * - Painel de Preços: API de dados abertos do Compras.gov.br, módulo de pesquisa de preço, por código do catálogo;
 * - contratações similares: itens de contratações da Lei 14.133 divulgadas no PNCP, pela mesma API de dados abertos;
 * - notas fiscais eletrônicas: API do Portal da Transparência (NF-e destinadas a órgãos do Poder Executivo federal),
 *   que exige chave de acesso. A base nacional completa de NF-e depende de convênio com as administrações tributárias.
 * Nenhum nome de fornecedor é guardado: a amostra identifica a compra, a unidade compradora e a data.
 */
import { createHash } from 'node:crypto';
import { adicionarDias, type AmostraPrecoExterna } from '@agora/dominio';
import { z } from 'zod';
import { palavrasSignificativas } from '../../compartilhado/texto.ts';
import { ErroIntegracao } from '../conector.ts';
import { dataDaApi, lerJson, obterTexto, reaisParaCentavos } from './http.ts';
import type { ColetaFonte, ContextoColeta, PedidoPesquisaPrecos } from './tipos.ts';

const TAMANHO_PAGINA = 100;
const MAXIMO_NOTAS_DETALHADAS = 5;

const textoOuNumero = z.union([z.string(), z.number()]).transform(String);
const valorApi = z.union([z.number(), z.string()]);

const envelopeDadosAbertos = z.object({
  resultado: z.array(z.unknown()).nullish(),
  totalRegistros: z.number().nullish(),
});

const itemPainel = z.object({
  idCompra: textoOuNumero,
  numeroItemCompra: textoOuNumero.nullish(),
  descricaoItem: z.string().nullish(),
  precoUnitario: valorApi,
  dataCompra: z.string().nullish(),
  codigoUasg: textoOuNumero.nullish(),
  nomeUasg: z.string().nullish(),
  estado: z.string().nullish(),
  siglaUnidadeFornecimento: z.string().nullish(),
  nomeUnidadeFornecimento: z.string().nullish(),
});

const itemSimilar = z.object({
  numeroControlePNCPCompra: z.string().nullish(),
  idCompra: textoOuNumero.nullish(),
  numeroItemPncp: textoOuNumero.nullish(),
  descricaoResumida: z.string().nullish(),
  valorUnitarioResultado: valorApi.nullish(),
  dataResultado: z.string().nullish(),
  dataInclusaoPncp: z.string().nullish(),
  unidadeOrgaoCodigoUnidade: textoOuNumero.nullish(),
  unidadeOrgaoNomeUnidade: z.string().nullish(),
  unidadeOrgaoUfSigla: z.string().nullish(),
  unidadeMedida: z.string().nullish(),
});

const notaResumo = z.object({
  chaveNotaFiscal: z.string().min(10),
  numero: textoOuNumero.nullish(),
  serie: textoOuNumero.nullish(),
  dataEmissao: z.string().nullish(),
  orgaoDestinatario: z.string().nullish(),
});

const notaDetalhe = z.object({
  notaFiscalDTO: notaResumo.partial().nullish(),
  itensNotaFiscal: z
    .array(
      z.object({
        descricaoProdutoServico: z.string().nullish(),
        valorUnitario: valorApi.nullish(),
        unidade: z.string().nullish(),
      }),
    )
    .nullish(),
});

function hash(partes: readonly string[]): string {
  const h = createHash('sha256');
  for (const parte of partes) h.update(parte);
  return h.digest('hex');
}

function coleta(
  base: Pick<ColetaFonte, 'fonte' | 'endereco' | 'consultadoEm'>,
  amostras: AmostraPrecoExterna[],
  corpos: readonly string[],
  mensagem: string,
): ColetaFonte {
  return {
    ...base,
    situacao: amostras.length > 0 ? 'ok' : 'sem_resultado',
    modo: 'online',
    amostras,
    registros: amostras.length,
    mensagem,
    hashConteudo: corpos.length > 0 ? hash(corpos) : null,
  };
}

function semCatalogo(fonte: ColetaFonte['fonte'], consultadoEm: string): ColetaFonte {
  return {
    fonte,
    situacao: 'sem_resultado',
    modo: 'online',
    amostras: [],
    registros: 0,
    mensagem: 'O item de referência não tem código CATMAT/CATSER: esta fonte é consultada pelo código do catálogo. Informe o código no DFD ou na busca.',
    hashConteudo: null,
    endereco: null,
    consultadoEm,
  };
}

function lerResultado(texto: string, fonte: string): unknown[] {
  const json = lerJson(texto, fonte);
  if (json === null) return [];
  const envelope = envelopeDadosAbertos.safeParse(json);
  if (!envelope.success) throw new ErroIntegracao(`Resposta de ${fonte} em formato inesperado.`);
  return envelope.data.resultado ?? [];
}

/** Painel de Preços (art. 23, § 1º, I): compras dos últimos 12 meses do item do catálogo. */
export async function consultarPainelPrecos(ctx: ContextoColeta, pedido: PedidoPesquisaPrecos): Promise<ColetaFonte> {
  const consultadoEm = ctx.agora.toISOString();
  if (pedido.catmat === null) return semCatalogo('PAINEL_PRECOS', consultadoEm);
  const servico = pedido.tipoObjeto !== 'bens';
  const parametros = new URLSearchParams(
    servico ? { codigoItemCatalogo: pedido.catmat } : { tipo: 'codigoItemCatalogo', codigo: pedido.catmat },
  );
  parametros.set('pagina', '1');
  parametros.set('tamanhoPagina', String(TAMANHO_PAGINA));
  parametros.set('dataCompraInicio', adicionarDias(ctx.hoje, -365));
  parametros.set('dataCompraFim', ctx.hoje);
  const endereco = `${ctx.config.comprasDadosUrl}/modulo-pesquisa-preco/${servico ? '3_consultarServico' : '1_consultarMaterial'}?${parametros.toString()}`;
  const corpo = await obterTexto(ctx.fetch, endereco, 'Painel de Preços', ctx.http);
  const amostras: AmostraPrecoExterna[] = [];
  let ignorados = 0;
  for (const bruto of lerResultado(corpo, 'Painel de Preços')) {
    const item = itemPainel.safeParse(bruto);
    const valor = item.success ? reaisParaCentavos(item.data.precoUnitario) : null;
    const data = item.success ? dataDaApi(item.data.dataCompra) : null;
    if (!item.success || valor === null || data === null) {
      ignorados++;
      continue;
    }
    const i = item.data;
    amostras.push({
      origem: 'painel_precos',
      identificador: `Compra ${i.idCompra}${i.numeroItemCompra ? ` item ${i.numeroItemCompra}` : ''}`,
      descricao: i.descricaoItem ?? pedido.descricaoItem,
      valorUnitario: valor,
      data,
      unidade: i.siglaUnidadeFornecimento ?? i.nomeUnidadeFornecimento ?? pedido.unidade,
      local: [i.codigoUasg ? `UASG ${i.codigoUasg}` : null, i.nomeUasg, i.estado].filter(Boolean).join(' — '),
    });
  }
  return coleta(
    { fonte: 'PAINEL_PRECOS', endereco, consultadoEm },
    amostras,
    [corpo],
    `Painel de Preços: ${amostras.length} compra(s) do item ${pedido.catmat} nos últimos 12 meses${ignorados > 0 ? `; ${ignorados} registro(s) sem preço ou data ignorado(s)` : ''}.`,
  );
}

/** Contratações similares (art. 23, § 1º, II, e § 2º, III): itens com resultado divulgados no PNCP no último ano. */
export async function consultarContratacoesSimilares(ctx: ContextoColeta, pedido: PedidoPesquisaPrecos): Promise<ColetaFonte> {
  const consultadoEm = ctx.agora.toISOString();
  if (pedido.catmat === null) return semCatalogo('CONTRATACOES_SIMILARES', consultadoEm);
  const parametros = new URLSearchParams({
    dataInclusaoPncpInicial: adicionarDias(ctx.hoje, -365),
    dataInclusaoPncpFinal: ctx.hoje,
    codItemCatalogo: pedido.catmat,
    temResultado: 'true',
    pagina: '1',
    tamanhoPagina: String(TAMANHO_PAGINA),
  });
  const endereco = `${ctx.config.comprasDadosUrl}/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?${parametros.toString()}`;
  const corpo = await obterTexto(ctx.fetch, endereco, 'Contratações similares (PNCP)', ctx.http);
  const amostras: AmostraPrecoExterna[] = [];
  let ignorados = 0;
  for (const bruto of lerResultado(corpo, 'Contratações similares (PNCP)')) {
    const item = itemSimilar.safeParse(bruto);
    const valor = item.success ? reaisParaCentavos(item.data.valorUnitarioResultado) : null;
    const data = item.success ? (dataDaApi(item.data.dataResultado) ?? dataDaApi(item.data.dataInclusaoPncp)) : null;
    const controle = item.success ? (item.data.numeroControlePNCPCompra ?? item.data.idCompra ?? null) : null;
    if (!item.success || valor === null || valor === 0 || data === null || controle === null) {
      ignorados++;
      continue;
    }
    const i = item.data;
    amostras.push({
      origem: 'contratacoes_similares',
      identificador: `PNCP ${controle}${i.numeroItemPncp ? ` item ${i.numeroItemPncp}` : ''}`,
      descricao: i.descricaoResumida ?? pedido.descricaoItem,
      valorUnitario: valor,
      data,
      unidade: i.unidadeMedida ?? pedido.unidade,
      local: [i.unidadeOrgaoCodigoUnidade ? `UASG ${i.unidadeOrgaoCodigoUnidade}` : null, i.unidadeOrgaoNomeUnidade, i.unidadeOrgaoUfSigla].filter(Boolean).join(' — '),
    });
  }
  return coleta(
    { fonte: 'CONTRATACOES_SIMILARES', endereco, consultadoEm },
    amostras,
    [corpo],
    `Contratações similares: ${amostras.length} item(ns) com resultado divulgado(s) no PNCP nos últimos 12 meses${ignorados > 0 ? `; ${ignorados} registro(s) incompleto(s) ignorado(s)` : ''}.`,
  );
}

/** Item da nota com mais palavras em comum com o termo pesquisado (nenhuma em comum → não serve). */
function itemCorrespondente<T extends { descricaoProdutoServico?: string | null | undefined }>(itens: readonly T[], termo: string): T | null {
  const procuradas = palavrasSignificativas(termo);
  let melhor: T | null = null;
  let pontos = 0;
  for (const item of itens) {
    const palavras = palavrasSignificativas(item.descricaoProdutoServico ?? '');
    const comuns = [...procuradas].filter((p) => palavras.has(p)).length;
    if (comuns > pontos) {
      melhor = item;
      pontos = comuns;
    }
  }
  return melhor;
}

/**
 * Notas fiscais eletrônicas (art. 23, § 1º, V): API do Portal da Transparência, com chave de acesso
 * (`AGORA_TRANSPARENCIA_CHAVE`). Lista as notas pelo nome do produto e detalha as mais recentes do último ano.
 */
export async function consultarNotasFiscais(ctx: ContextoColeta, pedido: PedidoPesquisaPrecos): Promise<ColetaFonte> {
  const consultadoEm = ctx.agora.toISOString();
  const chave = ctx.config.transparenciaChave;
  if (chave === null) {
    return {
      fonte: 'NOTAS_FISCAIS',
      situacao: 'dependente_de_acesso',
      modo: 'online',
      amostras: [],
      registros: 0,
      mensagem:
        'Depende de acesso: a API de notas fiscais do Portal da Transparência exige chave (AGORA_TRANSPARENCIA_CHAVE) e cobre as NF-e destinadas ao Poder Executivo federal. A base nacional completa depende de convênio com a Receita Federal e as Secretarias de Fazenda.',
      hashConteudo: null,
      endereco: null,
      consultadoEm,
    };
  }
  const cabecalhos = { 'chave-api-dados': chave };
  const endereco = `${ctx.config.transparenciaUrl}/notas-fiscais?${new URLSearchParams({ pagina: '1', nomeProduto: pedido.termo }).toString()}`;
  const corpoLista = await obterTexto(ctx.fetch, endereco, 'Portal da Transparência', ctx.http, cabecalhos);
  const lista = lerJson(corpoLista, 'Portal da Transparência');
  if (lista !== null && !Array.isArray(lista)) throw new ErroIntegracao('Resposta do Portal da Transparência em formato inesperado.');
  const limite = adicionarDias(ctx.hoje, -365);
  const recentes = (lista ?? [])
    .map((n) => notaResumo.safeParse(n))
    .flatMap((r) => (r.success ? [{ ...r.data, emissao: dataDaApi(r.data.dataEmissao) }] : []))
    .filter((n): n is typeof n & { emissao: string } => n.emissao !== null && n.emissao >= limite && n.emissao <= ctx.hoje)
    .sort((a, b) => (a.emissao < b.emissao ? 1 : -1))
    .slice(0, MAXIMO_NOTAS_DETALHADAS);

  const corpos = [corpoLista];
  const amostras: AmostraPrecoExterna[] = [];
  for (const nota of recentes) {
    const url = `${ctx.config.transparenciaUrl}/notas-fiscais-por-chave?${new URLSearchParams({ chaveUnicaNotaFiscal: nota.chaveNotaFiscal }).toString()}`;
    const corpo = await obterTexto(ctx.fetch, url, 'Portal da Transparência', ctx.http, cabecalhos);
    corpos.push(corpo);
    const detalhe = notaDetalhe.safeParse(lerJson(corpo, 'Portal da Transparência'));
    if (!detalhe.success) continue;
    const item = itemCorrespondente(detalhe.data.itensNotaFiscal ?? [], pedido.termo);
    const valor = item ? reaisParaCentavos(item.valorUnitario) : null;
    if (!item || valor === null || valor === 0) continue;
    amostras.push({
      origem: 'notas_fiscais',
      identificador: `NF-e ${nota.numero ?? '?'}${nota.serie ? `, série ${nota.serie}` : ''}`,
      descricao: item.descricaoProdutoServico ?? pedido.descricaoItem,
      valorUnitario: valor,
      data: nota.emissao,
      unidade: item.unidade ?? pedido.unidade,
      local: nota.orgaoDestinatario ?? '',
    });
  }
  return coleta(
    { fonte: 'NOTAS_FISCAIS', endereco, consultadoEm },
    amostras,
    corpos,
    `Notas fiscais (Portal da Transparência): ${recentes.length} nota(s) do último ano detalhada(s), ${amostras.length} com item correspondente ao termo "${pedido.termo}".`,
  );
}
