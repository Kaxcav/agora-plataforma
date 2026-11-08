import { percentual } from '@agora/dominio';
import type { ItemCarteira, Pagina } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor } from '../../banco/tipos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { camposPaginacao, codigoUasg, deslocamento, ordemQuery, pagina, textoBusca } from '../../http/validacao.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { gerarCsv } from './csv.ts';

const ORDENACOES = {
  ata: 'a.numero',
  numero: 'ia.numero',
  descricao: 'ia.descricao',
  uasg: 'a.uasg',
  valorUnitario: 'ia.valor_unitario',
  quantidadeRegistrada: 'ia.quantidade_registrada',
} as const;

const esquemaFiltro = z.object({
  busca: textoBusca,
  uasg: codigoUasg.optional(),
  alocacao: z.enum(['alocado', 'nao_alocado']).optional(),
  empenho: z.enum(['empenhado', 'nao_empenhado']).optional(),
  ordenarPor: z.enum(['ata', 'numero', 'descricao', 'uasg', 'valorUnitario', 'quantidadeRegistrada']).optional(),
  ordem: ordemQuery,
  ...camposPaginacao,
});
type FiltroItens = z.infer<typeof esquemaFiltro>;

interface LinhaItem {
  id: string;
  ata_id: string;
  ata_numero: string;
  numero: number;
  descricao: string;
  uasg: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  valor_unitario: number;
  quantidade_registrada: number;
  quantidade_contratada: number;
  quantidade_empenhada: number;
}

const CONDICOES = `
    FROM itens_ata ia
    JOIN atas a ON a.id = ia.ata_id
    JOIN fornecedores f ON f.id = ia.fornecedor_id
    JOIN vw_itens_ata_saldos s ON s.item_ata_id = ia.id
   WHERE ($1::text[] IS NULL OR a.uasg = ANY($1::text[]))
     AND ($2::text IS NULL OR ia.busca_normalizada LIKE $2 ESCAPE '\\')
     AND ($3::text IS NULL OR a.uasg = $3)
     AND ($4::text IS NULL OR ($4 = 'alocado' AND s.quantidade_contratada > 0) OR ($4 = 'nao_alocado' AND s.quantidade_contratada = 0))
     AND ($5::text IS NULL OR ($5 = 'empenhado' AND s.quantidade_empenhada > 0) OR ($5 = 'nao_empenhado' AND s.quantidade_empenhada = 0))`;

function mapear(l: LinhaItem): ItemCarteira {
  return {
    id: l.id,
    ata: { id: l.ata_id, numero: l.ata_numero },
    numero: l.numero,
    descricao: l.descricao,
    uasg: l.uasg,
    fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
    valorUnitario: l.valor_unitario,
    quantidadeRegistrada: l.quantidade_registrada,
    quantidadeContratada: l.quantidade_contratada,
    quantidadeEmpenhada: l.quantidade_empenhada,
    percentualConsumido: percentual(l.quantidade_contratada, l.quantidade_registrada),
    alocado: l.quantidade_contratada > 0,
    empenhado: l.quantidade_empenhada > 0,
  };
}

async function consultarItens(
  executor: Executor,
  escopo: string[] | null,
  f: FiltroItens,
  limite: number,
  inicio: number,
): Promise<{ itens: ItemCarteira[]; total: number }> {
  const parametros = [escopo, f.busca ? padraoContem(f.busca) : null, f.uasg ?? null, f.alocacao ?? null, f.empenho ?? null] as const;
  const direcao = f.ordem === 'desc' ? 'DESC' : 'ASC';
  const linhas = await executor.consultar<LinhaItem>(
    `SELECT ia.id, ia.ata_id, a.numero AS ata_numero, ia.numero, ia.descricao, a.uasg, f.tipo_pessoa, f.razao_social,
            ia.valor_unitario, ia.quantidade_registrada, s.quantidade_contratada, s.quantidade_empenhada
     ${CONDICOES}
      ORDER BY ${ORDENACOES[f.ordenarPor ?? 'ata']} ${direcao}, a.numero, ia.numero
      LIMIT $6 OFFSET $7`,
    [...parametros, limite, inicio],
  );
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total ${CONDICOES}`, [...parametros]);
  return { itens: linhas.map(mapear), total: contagem?.total ?? 0 };
}

/** Limite de linhas do CSV exportado (proteção contra exportações gigantes). */
const LIMITE_EXPORTACAO = 20_000;

export async function rotasItens(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('itens:ler') };

  app.get('/itens', leitura, async (request): Promise<Pagina<ItemCarteira>> => {
    const f = esquemaFiltro.parse(request.query);
    const { itens, total } = await consultarItens(
      ctx.banco,
      escopoUasgs(sessaoDe(request)),
      f,
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  /** CSV UTF-8 com BOM e separador ';' (abre direto no Excel/LibreOffice em pt-BR). */
  app.get('/itens/exportar.csv', leitura, async (request, reply) => {
    const f = esquemaFiltro.parse(request.query);
    const { itens } = await consultarItens(ctx.banco, escopoUasgs(sessaoDe(request)), f, LIMITE_EXPORTACAO, 0);
    const csv = gerarCsv(
      ['Ata', 'Item', 'Descrição', 'UASG', 'Fornecedor', 'Valor unitário (R$)', 'Qtd. registrada', 'Qtd. contratada', 'Qtd. empenhada', '% consumido', 'Alocado', 'Empenhado'],
      itens.map((i) => [
        i.ata.numero,
        i.numero,
        i.descricao,
        i.uasg,
        i.fornecedor,
        { centavos: i.valorUnitario },
        i.quantidadeRegistrada,
        i.quantidadeContratada,
        i.quantidadeEmpenhada,
        { decimal: i.percentualConsumido },
        i.alocado ? 'Sim' : 'Não',
        i.empenhado ? 'Sim' : 'Não',
      ]),
    );
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="itens-agora-${ctx.hoje()}.csv"`)
      .send(csv);
  });
}
