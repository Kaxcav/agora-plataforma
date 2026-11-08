/**
 * Catálogo CATMAT/CATSER (F19, RIA-13): cache local em `catalogo_itens`, consulta ao catálogo oficial pelo conector do
 * servidor (modo online) e sugestão do código para a descrição do item do DFD (`sugerirItensCatalogo`).
 *
 * Modo offline (padrão): a consulta é respondida pela cópia local (carga sintética e itens já trazidos do catálogo
 * oficial), de forma determinística, com a proveniência gravada. Modo online: consulta o catálogo oficial quando não há
 * consulta igual dentro da validade do cache (AGORA_CATALOGO_CACHE_HORAS); se o serviço estiver fora do ar, responde
 * pelo cache com aviso. Cada consulta que sai do cache fica em `catalogo_consultas` e na trilha de auditoria.
 */
import { randomUUID } from 'node:crypto';
import { sugerirItensCatalogo, termosCatalogo, type TipoCatalogo } from '@agora/dominio';
import type { ConsultaCatalogo, ItemCatalogoCompras, ProvenienciaConsulta, SugestoesCatalogo } from '@agora/contratos';
import { jsonCanonico, registrarEvento } from '../../auditoria/trilha.ts';
import type { Executor } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { consultarCatalogoCompras, type ItemCatalogoLido } from '../../integracoes/catalogo-compras.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { opcoesHttpPadrao } from '../../integracoes/precos/http.ts';

export const FONTE_CATALOGO = 'Catálogo de materiais e serviços do governo federal (CATMAT/CATSER) — API de dados abertos de compras';
const LIMITE_RESULTADOS = 50;
const LIMITE_CANDIDATOS = 400;

export interface LinhaCatalogo {
  tipo: TipoCatalogo;
  codigo: string;
  descricao: string;
  classe_codigo: string | null;
  classe_nome: string | null;
  pdm_codigo: string | null;
  pdm_nome: string | null;
  sustentavel: boolean;
  ativo: boolean;
  origem: 'seed' | 'api';
  atualizado_em: string;
}

const COLUNAS = 'tipo, codigo, descricao, classe_codigo, classe_nome, pdm_codigo, pdm_nome, sustentavel, ativo, origem, atualizado_em';

export function paraItemCatalogo(l: LinhaCatalogo): ItemCatalogoCompras {
  return {
    codigo: l.codigo,
    tipo: l.tipo,
    descricao: l.descricao,
    classeCodigo: l.classe_codigo,
    classeNome: l.classe_nome,
    pdmCodigo: l.pdm_codigo,
    pdmNome: l.pdm_nome,
    sustentavel: l.sustentavel,
    ativo: l.ativo,
    origem: l.origem,
    atualizadoEm: l.atualizado_em,
  };
}

/** Item do catálogo no cache local (null se o código não é conhecido). */
export async function itemDoCatalogo(executor: Executor, tipo: TipoCatalogo, codigo: string): Promise<LinhaCatalogo | null> {
  const [linha] = await executor.consultar<LinhaCatalogo>(`SELECT ${COLUNAS} FROM catalogo_itens WHERE tipo = $1 AND codigo = $2`, [tipo, codigo]);
  return linha ?? null;
}

/** Classe (material) ou grupo (serviço) de cada código, para o envio do PCA ao PNCP. */
export async function classesDoCatalogo(executor: Executor, codigos: readonly { tipo: TipoCatalogo; codigo: string }[]): Promise<Map<string, { codigo: string; nome: string }>> {
  const mapa = new Map<string, { codigo: string; nome: string }>();
  if (codigos.length === 0) return mapa;
  const linhas = await executor.consultar<{ tipo: string; codigo: string; classe_codigo: string | null; classe_nome: string | null }>(
    'SELECT tipo, codigo, classe_codigo, classe_nome FROM catalogo_itens WHERE codigo = ANY($1::text[])',
    [codigos.map((c) => c.codigo)],
  );
  for (const l of linhas) {
    if (l.classe_codigo && l.classe_nome) mapa.set(`${l.tipo}|${l.codigo}`, { codigo: l.classe_codigo, nome: l.classe_nome });
  }
  return mapa;
}

/** Busca no cache: código exato, ou todas as palavras do texto na descrição. */
async function buscarNoCache(executor: Executor, tipo: TipoCatalogo, busca: string): Promise<LinhaCatalogo[]> {
  if (/^\d{1,9}$/.test(busca)) {
    return executor.consultar<LinhaCatalogo>(`SELECT ${COLUNAS} FROM catalogo_itens WHERE tipo = $1 AND codigo = $2`, [tipo, busca]);
  }
  const palavras = normalizarBusca(busca)
    .split(' ')
    .filter((p) => p.length >= 2)
    .slice(0, 6)
    .map((p) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (palavras.length === 0) return [];
  const condicoes = palavras.map((_, i) => `descricao_normalizada LIKE $${i + 2} ESCAPE '\\'`).join(' AND ');
  return executor.consultar<LinhaCatalogo>(
    `SELECT ${COLUNAS} FROM catalogo_itens WHERE tipo = $1 AND ${condicoes} ORDER BY ativo DESC, codigo LIMIT ${LIMITE_RESULTADOS}`,
    [tipo, ...palavras],
  );
}

/** Candidatos para a sugestão: itens do tipo com ao menos um termo significativo da descrição. */
async function candidatosNoCache(executor: Executor, tipo: TipoCatalogo, termos: readonly string[]): Promise<LinhaCatalogo[]> {
  const padroes = termos.slice(0, 8).map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (padroes.length === 0) return [];
  const condicoes = padroes.map((_, i) => `descricao_normalizada LIKE $${i + 2} ESCAPE '\\'`).join(' OR ');
  return executor.consultar<LinhaCatalogo>(
    `SELECT ${COLUNAS} FROM catalogo_itens WHERE tipo = $1 AND ativo AND (${condicoes}) ORDER BY codigo LIMIT ${LIMITE_CANDIDATOS}`,
    [tipo, ...padroes],
  );
}

/** Grava ou atualiza os itens recebidos do catálogo oficial no cache local. */
export async function guardarNoCache(executor: Executor, itens: readonly ItemCatalogoLido[], origem: 'seed' | 'api', agora: Date): Promise<void> {
  for (const i of itens) {
    await executor.executar(
      `INSERT INTO catalogo_itens (tipo, codigo, descricao, descricao_normalizada, classe_codigo, classe_nome, pdm_codigo, pdm_nome,
                                   sustentavel, ativo, origem, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tipo, codigo) DO UPDATE
          SET descricao = EXCLUDED.descricao, descricao_normalizada = EXCLUDED.descricao_normalizada,
              classe_codigo = EXCLUDED.classe_codigo, classe_nome = EXCLUDED.classe_nome, pdm_codigo = EXCLUDED.pdm_codigo,
              pdm_nome = EXCLUDED.pdm_nome, sustentavel = EXCLUDED.sustentavel, ativo = EXCLUDED.ativo,
              origem = EXCLUDED.origem, atualizado_em = EXCLUDED.atualizado_em`,
      [
        i.tipo,
        i.codigo,
        i.descricao,
        normalizarBusca(i.descricao, i.pdmNome, i.classeNome),
        i.classeCodigo,
        i.classeNome,
        i.pdmCodigo,
        i.pdmNome,
        i.sustentavel,
        i.ativo,
        origem,
        agora.toISOString(),
      ],
    );
  }
}

interface LinhaConsulta {
  modo: 'offline' | 'online';
  endereco: string | null;
  registros: number;
  hash_conteudo: string;
  consultado_em: string;
}

/**
 * Consulta ao catálogo (cache, cópia local offline ou catálogo oficial online), com proveniência. Registra a consulta
 * e o evento de auditoria quando ela não vem do cache.
 */
export async function consultarCatalogo(
  ctx: ContextoApp,
  pedido: { tipo: TipoCatalogo; busca: string; usuarioId: string | null; ipHash: string | null },
): Promise<ConsultaCatalogo> {
  const agora = ctx.relogio();
  const busca = pedido.busca.trim();
  const termo = /^\d{1,9}$/.test(busca) ? busca : normalizarBusca(busca);
  const validadeMs = ctx.config.planejamento.catalogoCacheHoras * 3_600_000;
  const online = ctx.config.integracoes === 'online';
  if (online && validadeMs > 0) {
    const [anterior] = await ctx.banco.consultar<LinhaConsulta>(
      `SELECT modo, endereco, registros, hash_conteudo, consultado_em FROM catalogo_consultas
        WHERE tipo = $1 AND termo = $2 AND modo = 'online' AND consultado_em >= $3
        ORDER BY consultado_em DESC LIMIT 1`,
      [pedido.tipo, termo, new Date(agora.getTime() - validadeMs).toISOString()],
    );
    if (anterior) {
      return {
        itens: (await buscarNoCache(ctx.banco, pedido.tipo, busca)).map(paraItemCatalogo),
        proveniencia: provenienciaDe(anterior, true),
        aviso: null,
      };
    }
  }

  let aviso: string | null = null;
  let endereco: string | null = null;
  let hashRecebido: string | null = null;
  let modo: 'offline' | 'online' = 'offline';
  if (online) {
    try {
      const resposta = await consultarCatalogoCompras(ctx.fetch, ctx.config.precos.comprasDadosUrl, opcoesHttpPadrao(ctx.config.precos.timeoutMs), {
        tipo: pedido.tipo,
        busca,
      });
      if (resposta.semConsulta) {
        aviso = 'O catálogo oficial de serviços não aceita busca por texto: o resultado vem da cópia local. Para consultar o catálogo oficial, informe o código CATSER.';
      } else {
        modo = 'online';
        endereco = resposta.endereco;
        hashRecebido = resposta.hash;
        await guardarNoCache(ctx.banco, resposta.itens, 'api', agora);
      }
    } catch (erro) {
      if (!(erro instanceof ErroIntegracao)) throw erro;
      aviso = `${erro.message} O resultado vem da cópia local do catálogo.`;
    }
  }
  const linhas = await buscarNoCache(ctx.banco, pedido.tipo, busca);
  const hash = hashRecebido ?? sha256Hex(jsonCanonico(linhas.map((l) => [l.tipo, l.codigo, l.descricao, l.ativo])));
  const consultadoEm = agora.toISOString();
  await ctx.banco.transacao(async (tx) => {
    await tx.executar(
      `INSERT INTO catalogo_consultas (id, tipo, termo, modo, endereco, registros, hash_conteudo, consultado_por, consultado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), pedido.tipo, termo, modo, endereco, linhas.length, hash, pedido.usuarioId, consultadoEm],
    );
    await registrarEvento(
      tx,
      {
        usuarioId: pedido.usuarioId,
        acao: 'catalogo.consultar',
        recurso: 'catalogo',
        recursoId: null,
        resumo: `Consultou o catálogo de ${pedido.tipo === 'material' ? 'materiais (CATMAT)' : 'serviços (CATSER)'}${modo === 'online' ? ' no Compras.gov.br' : ' (cópia local)'}`,
        dados: { tipo: pedido.tipo, termo, modo, endereco, registros: linhas.length, hash },
        ipHash: pedido.ipHash,
      },
      agora,
    );
  });
  return {
    itens: linhas.map(paraItemCatalogo),
    proveniencia: { fonte: FONTE_CATALOGO, modo, endereco, consultadoEm, registros: linhas.length, hash, deCache: false },
    aviso,
  };
}

function provenienciaDe(l: LinhaConsulta, deCache: boolean): ProvenienciaConsulta {
  return { fonte: FONTE_CATALOGO, modo: l.modo, endereco: l.endereco, consultadoEm: l.consultado_em, registros: l.registros, hash: l.hash_conteudo, deCache };
}

/**
 * Sugestão do código do catálogo para a descrição (RIA-13). No modo online, traz antes do catálogo oficial os itens com
 * o termo principal da descrição; a pontuação é sempre calculada sobre o cache local, de forma determinística.
 */
export async function sugerirCodigos(
  ctx: ContextoApp,
  pedido: { tipo: TipoCatalogo; descricao: string; usuarioId: string | null; ipHash: string | null },
): Promise<SugestoesCatalogo> {
  const termos = termosCatalogo(pedido.descricao);
  const principal = termos.find((t) => !/^\d+$/.test(t)) ?? termos[0] ?? '';
  const consulta = await consultarCatalogo(ctx, { tipo: pedido.tipo, busca: principal || pedido.descricao, usuarioId: pedido.usuarioId, ipHash: pedido.ipHash });
  const candidatos = await candidatosNoCache(ctx.banco, pedido.tipo, termos);
  const resultado = sugerirItensCatalogo(
    pedido.descricao,
    candidatos.map((c) => ({ codigo: c.codigo, tipo: c.tipo, descricao: c.descricao, classe: c.classe_nome, ativo: c.ativo })),
    { tipo: pedido.tipo },
  );
  return {
    regra: 'RIA-13',
    termos: resultado.termos,
    sugestoes: resultado.sugestoes,
    aviso: resultado.aviso,
    fundamento: resultado.fundamento,
    fontes: [
      consulta.proveniencia.modo === 'online' ? `${FONTE_CATALOGO}, consultado em ${consulta.proveniencia.consultadoEm}` : `${FONTE_CATALOGO} — cópia local`,
    ],
    premissas: [
      'Semelhança por termos do texto (sem acentos, sem palavras vazias e com plurais reduzidos), pelo coeficiente de Dice, com bônus quando o termo principal coincide.',
      'Só itens ativos do catálogo entram na comparação.',
      'Não há modelo de linguagem nem decisão automática: o agente confere o item no catálogo e escolhe o código.',
    ],
    geradoEm: ctx.relogio().toISOString(),
    proveniencia: consulta.proveniencia,
  };
}
