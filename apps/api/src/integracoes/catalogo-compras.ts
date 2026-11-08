/**
 * Conector do catálogo de materiais e serviços do governo federal (CATMAT/CATSER), pela API de dados abertos de compras
 * (Compras.gov.br), chamado só pelo servidor (F19, RIA-13). Tempo máximo por requisição e novas tentativas em 429/5xx
 * (`obterTexto`); a proveniência (endereço, quantidade e hash do conteúdo) volta para quem chamou gravar.
 *   * Material: GET {base}/modulo-material/4_consultarItemMaterial?pagina=1&tamanhoPagina=50&statusItem=true
 *     &descricaoItem=<texto> (ou &codigoItem=<código>) → { resultado: DmMaterialItemDTO[], totalRegistros, ... }
 *   * Serviço: GET {base}/modulo-servico/6_consultarItemServico?pagina=1&tamanhoPagina=50&codigoServico=<código>
 *     → { resultado: DmServicoItemDTO[], ... }. A API não filtra serviços por texto: a busca textual de serviços usa
 *     só o cache local.
 */
import { z } from 'zod';
import { sha256Hex } from '../compartilhado/cripto.ts';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';
import { lerJson, obterTexto, type OpcoesHttpPrecos } from './precos/http.ts';

export interface ItemCatalogoLido {
  codigo: string;
  tipo: 'material' | 'servico';
  descricao: string;
  classeCodigo: string | null;
  classeNome: string | null;
  pdmCodigo: string | null;
  pdmNome: string | null;
  sustentavel: boolean;
  ativo: boolean;
}

export interface RespostaCatalogo {
  itens: ItemCatalogoLido[];
  endereco: string | null;
  hash: string;
  /** Busca textual de serviço: a API não oferece o filtro, nada foi consultado. */
  semConsulta: boolean;
}

const TAMANHO_PAGINA = 50;
const codigo = z.union([z.number(), z.string()]).transform((v) => String(v).trim());
const textoOpcional = z.string().nullish().transform((v) => (v && v.trim() !== '' ? v.trim() : null));
const codigoOpcional = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()));

const envelope = z.object({ resultado: z.array(z.unknown()).nullish() });

const itemMaterial = z.object({
  codigoItem: codigo,
  descricaoItem: z.string().min(1),
  codigoClasse: codigoOpcional,
  nomeClasse: textoOpcional,
  codigoPdm: codigoOpcional,
  nomePdm: textoOpcional,
  statusItem: z.boolean().nullish(),
  itemSustentavel: z.boolean().nullish(),
});

const itemServico = z.object({
  codigoServico: codigo,
  nomeServico: z.string().min(1),
  codigoGrupo: codigoOpcional,
  nomeGrupo: textoOpcional,
  codigoClasse: codigoOpcional,
  nomeClasse: textoOpcional,
  statusServico: z.boolean().nullish(),
});

function lerItens(texto: string): unknown[] {
  const json = lerJson(texto, 'Catálogo de compras');
  if (json === null) return [];
  const e = envelope.safeParse(json);
  if (!e.success) throw new ErroIntegracao('Resposta do catálogo de compras em formato inesperado.');
  return e.data.resultado ?? [];
}

/**
 * Consulta o catálogo oficial. `busca` só com dígitos procura pelo código; texto procura na descrição (só materiais).
 * Itens fora do formato esperado são ignorados (não derrubam a consulta).
 */
export async function consultarCatalogoCompras(
  fetch: FuncaoFetch,
  base: string,
  http: OpcoesHttpPrecos,
  pedido: { tipo: 'material' | 'servico'; busca: string },
): Promise<RespostaCatalogo> {
  const busca = pedido.busca.trim();
  const porCodigo = /^\d{1,9}$/.test(busca);
  if (pedido.tipo === 'servico' && !porCodigo) return { itens: [], endereco: null, hash: sha256Hex(''), semConsulta: true };
  const parametros = new URLSearchParams({ pagina: '1', tamanhoPagina: String(TAMANHO_PAGINA) });
  let caminho: string;
  if (pedido.tipo === 'material') {
    caminho = '/modulo-material/4_consultarItemMaterial';
    parametros.set('statusItem', 'true');
    parametros.set(porCodigo ? 'codigoItem' : 'descricaoItem', busca);
  } else {
    caminho = '/modulo-servico/6_consultarItemServico';
    parametros.set('codigoServico', busca);
  }
  const endereco = `${base.replace(/\/+$/, '')}${caminho}?${parametros.toString()}`;
  const corpo = await obterTexto(fetch, endereco, 'Catálogo de compras (dados abertos)', http);
  const itens: ItemCatalogoLido[] = [];
  for (const bruto of lerItens(corpo)) {
    if (pedido.tipo === 'material') {
      const m = itemMaterial.safeParse(bruto);
      if (!m.success || !/^\d{1,9}$/.test(m.data.codigoItem)) continue;
      itens.push({
        codigo: m.data.codigoItem,
        tipo: 'material',
        descricao: m.data.descricaoItem.trim(),
        classeCodigo: m.data.codigoClasse,
        classeNome: m.data.nomeClasse,
        pdmCodigo: m.data.codigoPdm,
        pdmNome: m.data.nomePdm,
        sustentavel: m.data.itemSustentavel ?? false,
        ativo: m.data.statusItem ?? true,
      });
    } else {
      const s = itemServico.safeParse(bruto);
      if (!s.success || !/^\d{1,9}$/.test(s.data.codigoServico)) continue;
      itens.push({
        codigo: s.data.codigoServico,
        tipo: 'servico',
        descricao: s.data.nomeServico.trim(),
        // No PNCP, a classificação superior do serviço é o grupo.
        classeCodigo: s.data.codigoGrupo ?? s.data.codigoClasse,
        classeNome: s.data.nomeGrupo ?? s.data.nomeClasse,
        pdmCodigo: null,
        pdmNome: null,
        sustentavel: false,
        ativo: s.data.statusServico ?? true,
      });
    }
  }
  return { itens, endereco, hash: sha256Hex(corpo), semConsulta: false };
}
