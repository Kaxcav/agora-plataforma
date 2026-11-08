/**
 * Consulta pública do Diário Oficial da União (Imprensa Nacional), usada pelo servidor para conferir se uma matéria
 * enviada pelo INCom foi publicada (RF-36). É a mesma busca do portal in.gov.br: a página de resultados traz os itens
 * num JSON embutido (`<script id="..._BuscaDouPortlet_params">`, chave `jsonArray`), com título, resumo, data da
 * edição, seção e o endereço da matéria. Só o servidor chama; o navegador fala apenas com a API da Ágora.
 * Falhas de rede, tempo esgotado e HTTP 5xx são transitórias (nova tentativa pela fila); mudança na estrutura da
 * página é falha definitiva, para correção do conector.
 */
import { formatarData, type DataISO, type ResultadoBuscaDou } from '@agora/dominio';
import { FalhaTarefa } from '../fila/tipos.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

export interface OpcoesConsultaDou {
  url: string;
  fetch: FuncaoFetch;
  timeoutMs: number;
}

const ID_RESULTADOS = '_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params';
const ENDERECO_MATERIA = 'https://www.in.gov.br/web/dou/-/';

interface ItemBusca {
  pubName?: unknown;
  title?: unknown;
  content?: unknown;
  pubDate?: unknown;
  urlTitle?: unknown;
  editionNumber?: unknown;
  numberPage?: unknown;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** "10/11/2026" → "2026-11-10"; vazio se fora do formato. */
function dataIso(valor: string): DataISO | '' {
  const p = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  return p ? `${p[3]}-${p[2]}-${p[1]}` : '';
}

/** Extrai os resultados do HTML da página de busca do DOU. */
export function lerResultadosDou(html: string): ResultadoBuscaDou[] {
  const padrao = new RegExp(`<script[^>]*id=["']${ID_RESULTADOS}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  const json = padrao.exec(html)?.[1];
  if (json === undefined) throw new FalhaTarefa('A consulta pública do DOU mudou de formato (resultados não encontrados na página).', false);
  let dados: { jsonArray?: unknown };
  try {
    dados = JSON.parse(json) as { jsonArray?: unknown };
  } catch {
    throw new FalhaTarefa('A consulta pública do DOU devolveu resultados ilegíveis.', false);
  }
  const itens = Array.isArray(dados.jsonArray) ? (dados.jsonArray as ItemBusca[]) : [];
  return itens
    .map((i) => ({
      titulo: texto(i.title),
      resumo: texto(i.content).replace(/<[^>]+>/g, ' '),
      data: dataIso(texto(i.pubDate)),
      secao: texto(i.pubName),
      url: texto(i.urlTitle) === '' ? '' : `${ENDERECO_MATERIA}${texto(i.urlTitle)}`,
      edicao: texto(i.editionNumber) || null,
      pagina: texto(i.numberPage) || null,
    }))
    .filter((r): r is ResultadoBuscaDou => r.data !== '' && r.titulo !== '');
}

/**
 * Busca, na Seção 3 do DOU, as matérias com o termo exato (o número do processo) publicadas no intervalo.
 * Devolve só a primeira página de resultados: com o número do processo entre aspas, são poucos.
 */
export async function consultarDou(o: OpcoesConsultaDou, p: { termo: string; de: DataISO; ate: DataISO }): Promise<ResultadoBuscaDou[]> {
  const parametros = new URLSearchParams({
    q: `"${p.termo}"`,
    s: 'do3',
    exactDate: 'personalizado',
    publishFrom: formatarData(p.de).replace(/\//g, '-'),
    publishTo: formatarData(p.ate).replace(/\//g, '-'),
    sortType: '0',
  });
  let resposta: Response;
  try {
    resposta = await o.fetch(`${o.url}?${parametros.toString()}`, {
      headers: { accept: 'text/html', 'user-agent': 'Agora/1.0 (conferencia de publicacao no DOU)' },
      signal: AbortSignal.timeout(o.timeoutMs),
    });
  } catch (erro) {
    const motivo = erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError') ? `tempo limite de ${o.timeoutMs} ms excedido` : 'falha de rede';
    throw new FalhaTarefa(`Consulta do DOU indisponível: ${motivo}.`, true, { cause: erro });
  }
  if (resposta.status === 408 || resposta.status === 429 || resposta.status >= 500) {
    throw new FalhaTarefa(`Consulta do DOU indisponível (HTTP ${resposta.status}). Nova tentativa automática.`, true);
  }
  if (!resposta.ok) throw new FalhaTarefa(`Consulta do DOU recusada (HTTP ${resposta.status}): confira AGORA_DOU_CONSULTA_URL.`, false);
  return lerResultadosDou(await resposta.text());
}
