/**
 * Conector de consulta do plano de contratações anual (PCA) publicado no PNCP, pela API pública de consulta, chamado
 * só pelo servidor (F10, RF-31). Tempo máximo, novas tentativas em 429/5xx (`obterTexto`) e paginação com limite.
 *   GET {AGORA_PNCP_CONSULTA_URL}/v1/pca/atualizacao?dataInicio=AAAAMMDD&dataFim=AAAAMMDD&cnpj=&codigoUnidade=&pagina=N
 *       &tamanhoPagina=500
 *   → { data: PlanoContratacaoComItensDoUsuarioDTO[], totalPaginas, ... }, cada plano com `idPcaPncp`, `anoPca`,
 *     `codigoUnidade`, `dataPublicacaoPNCP` e `itens` (PlanoContratacaoItemDTO).
 * A janela de atualização vai de 1º de janeiro do ano anterior ao do plano até hoje; os planos de outros anos são
 * descartados.
 */
import { CATEGORIAS_ITEM_PCA, type CategoriaItemPca } from '@agora/dominio';
import { z } from 'zod';
import { sha256Hex } from '../compartilhado/cripto.ts';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';
import { dataDaApi, lerJson, obterTexto, reaisParaCentavos, type OpcoesHttpPrecos } from './precos/http.ts';

export interface ItemPcaLido {
  numero: number;
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: 'material' | 'servico' | null;
  categoria: CategoriaItemPca;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  dataDesejada: string;
  unidadeRequisitante: string | null;
}

export interface PlanoPcaLido {
  idPcaPncp: string;
  ano: number;
  uasg: string;
  publicadoEm: string | null;
  itens: ItemPcaLido[];
}

const LIMITE_PAGINAS = 10;
const TAMANHO_PAGINA = 500;

const textoOuNumero = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const valor = z.union([z.number(), z.string()]);

const pagina = z.object({ data: z.array(z.unknown()).nullish(), totalPaginas: z.number().int().nullish() });

const itemPncp = z.object({
  numeroItem: z.number().int().positive(),
  descricaoItem: z.string().nullish(),
  codigoItem: textoOuNumero.nullish(),
  classificacaoCatalogoId: z.union([z.number(), z.string()]).nullish(),
  categoriaItemPcaNome: z.string().nullish(),
  quantidadeEstimada: z.number().nullish(),
  valorUnitario: valor.nullish(),
  valorTotal: valor.nullish(),
  dataDesejada: z.string().nullish(),
  unidadeFornecimento: z.string().nullish(),
  unidadeRequisitante: z.string().nullish(),
});

const planoPncp = z.object({
  idPcaPncp: z.string().min(10),
  anoPca: z.number().int(),
  codigoUnidade: textoOuNumero,
  dataPublicacaoPNCP: z.string().nullish(),
  itens: z.array(z.unknown()).nullish(),
});

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Categoria pelo nome devolvido pelo PNCP (tabela 5.16); sem correspondência, material ou serviço pelo catálogo. */
function categoriaDoNome(nome: string | null | undefined, material: boolean): CategoriaItemPca {
  const alvo = semAcento(nome ?? '');
  for (const [chave, c] of Object.entries(CATEGORIAS_ITEM_PCA) as [CategoriaItemPca, { rotulo: string }][]) {
    if (alvo !== '' && semAcento(c.rotulo) === alvo) return chave;
  }
  return material ? 'material' : 'servico';
}

function lerPlanos(texto: string): { planos: unknown[]; totalPaginas: number } {
  const json = lerJson(texto, 'PNCP (consulta do PCA)');
  if (json === null) return { planos: [], totalPaginas: 0 };
  const p = pagina.safeParse(json);
  if (!p.success) throw new ErroIntegracao('Resposta da consulta do PCA no PNCP em formato inesperado.');
  return { planos: p.data.data ?? [], totalPaginas: p.data.totalPaginas ?? 1 };
}

/**
 * Lê do PNCP o PCA da unidade (`uasg`) do órgão (`cnpj`) para o `ano`. Devolve os planos encontrados (normalmente um),
 * o primeiro endereço consultado e o hash de todo o conteúdo recebido.
 */
export async function consultarPcaPublicadoPncp(
  fetch: FuncaoFetch,
  base: string,
  http: OpcoesHttpPrecos,
  pedido: { cnpj: string; uasg: string; ano: number; hoje: string },
): Promise<{ planos: PlanoPcaLido[]; endereco: string; hash: string; registros: number }> {
  const raiz = base.replace(/\/+$/, '');
  const fim = pedido.hoje.replace(/-/g, '');
  const inicio = `${pedido.ano - 1}0101`;
  const corpos: string[] = [];
  const planos: PlanoPcaLido[] = [];
  let primeiro = '';
  for (let numero = 1; numero <= LIMITE_PAGINAS; numero++) {
    const parametros = new URLSearchParams({
      dataInicio: inicio,
      dataFim: fim,
      cnpj: pedido.cnpj,
      codigoUnidade: pedido.uasg,
      pagina: String(numero),
      tamanhoPagina: String(TAMANHO_PAGINA),
    });
    const endereco = `${raiz}/v1/pca/atualizacao?${parametros.toString()}`;
    if (numero === 1) primeiro = endereco;
    const corpo = await obterTexto(fetch, endereco, 'PNCP (consulta do PCA)', http);
    corpos.push(corpo);
    const { planos: brutos, totalPaginas } = lerPlanos(corpo);
    for (const bruto of brutos) {
      const p = planoPncp.safeParse(bruto);
      if (!p.success || p.data.anoPca !== pedido.ano || p.data.codigoUnidade !== pedido.uasg) continue;
      const itens: ItemPcaLido[] = [];
      for (const brutoItem of p.data.itens ?? []) {
        const i = itemPncp.safeParse(brutoItem);
        if (!i.success) continue;
        const unitario = reaisParaCentavos(i.data.valorUnitario) ?? 0;
        const total = reaisParaCentavos(i.data.valorTotal) ?? 0;
        const quantidade = i.data.quantidadeEstimada ?? 0;
        const data = dataDaApi(i.data.dataDesejada);
        if (quantidade <= 0 || data === null) continue;
        const material = String(i.data.classificacaoCatalogoId ?? '1') === '1';
        const codigoItem = i.data.codigoItem && /^\d{1,9}$/.test(i.data.codigoItem) ? i.data.codigoItem : null;
        itens.push({
          numero: i.data.numeroItem,
          descricao: (i.data.descricaoItem ?? '').trim() || `Item ${i.data.numeroItem} do PCA`,
          codigoCatalogo: codigoItem,
          tipoCatalogo: codigoItem === null ? null : material ? 'material' : 'servico',
          categoria: categoriaDoNome(i.data.categoriaItemPcaNome, material),
          unidadeFornecimento: (i.data.unidadeFornecimento ?? '').trim() || 'unidade',
          quantidade,
          valorUnitario: unitario,
          valorTotal: total > 0 ? total : Math.round(unitario * quantidade),
          dataDesejada: data,
          unidadeRequisitante: i.data.unidadeRequisitante?.trim() || null,
        });
      }
      planos.push({ idPcaPncp: p.data.idPcaPncp, ano: p.data.anoPca, uasg: p.data.codigoUnidade, publicadoEm: p.data.dataPublicacaoPNCP ?? null, itens });
    }
    if (numero >= totalPaginas) break;
  }
  return { planos, endereco: primeiro, hash: sha256Hex(corpos.join('\n')), registros: planos.reduce((s, p) => s + p.itens.length, 0) };
}
