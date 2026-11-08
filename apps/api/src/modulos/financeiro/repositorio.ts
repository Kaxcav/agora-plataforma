import { mascararDocumento, mascararNome } from '@agora/dominio';
import type { Empenho, Pagamento, SituacaoPagamento } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

// ───────────────────────── Empenhos ─────────────────────────

export interface LinhaEmpenho {
  id: string;
  numero: string;
  uasg: string;
  credor_documento: string;
  credor_nome: string;
  fornecedor_id: string | null;
  contrato_id: string | null;
  contrato_numero: string | null;
  emissao_em: string;
  ano: number;
  natureza_despesa: string;
  valor_empenhado: number;
  valor_liquidado: number;
  valor_pago: number;
  restos_a_pagar: boolean;
}

export const SELECAO_EMPENHO = `
  SELECT e.id, e.numero, e.uasg, e.credor_documento, e.credor_nome, e.fornecedor_id, e.contrato_id, c.numero AS contrato_numero,
         e.emissao_em, e.ano, e.natureza_despesa, e.valor_empenhado, e.valor_liquidado, e.valor_pago, e.restos_a_pagar
    FROM empenhos e
    LEFT JOIN contratos c ON c.id = e.contrato_id`;

/** Credor PF tem documento e nome mascarados (LGPD); CNPJ não é dado pessoal. */
export function mapearEmpenho(l: LinhaEmpenho): Empenho {
  const pessoaFisica = l.credor_documento.length === 11;
  return {
    id: l.id,
    numero: l.numero,
    uasg: l.uasg,
    credor: {
      documento: mascararDocumento(l.credor_documento),
      nome: pessoaFisica ? mascararNome(l.credor_nome) : l.credor_nome,
    },
    contrato: l.contrato_id !== null && l.contrato_numero !== null ? { id: l.contrato_id, numero: l.contrato_numero } : null,
    emissaoEm: l.emissao_em,
    ano: l.ano,
    naturezaDespesa: l.natureza_despesa,
    valorEmpenhado: l.valor_empenhado,
    valorLiquidado: l.valor_liquidado,
    valorPago: l.valor_pago,
    saldo: l.valor_empenhado - l.valor_liquidado,
    restosAPagar: l.restos_a_pagar,
  };
}

export interface FiltroEmpenhosSql {
  escopo: string[] | null;
  busca?: string | undefined;
  saldo?: 'com' | 'sem' | undefined;
  restosAPagar?: boolean | undefined;
  ano?: number | undefined;
  uasg?: string | undefined;
}

const CONDICOES_EMPENHO = `
      WHERE ($1::text[] IS NULL OR e.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR e.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR ($3 = 'com' AND e.valor_empenhado > e.valor_liquidado) OR ($3 = 'sem' AND e.valor_empenhado <= e.valor_liquidado))
        AND ($4::boolean IS NULL OR e.restos_a_pagar = $4)
        AND ($5::integer IS NULL OR e.ano = $5)
        AND ($6::text IS NULL OR e.uasg = $6)`;

function parametrosEmpenho(f: FiltroEmpenhosSql) {
  return [
    f.escopo,
    f.busca ? padraoContem(f.busca) : null,
    f.saldo ?? null,
    f.restosAPagar ?? null,
    f.ano ?? null,
    f.uasg ?? null,
  ] as const;
}

export async function listarEmpenhos(
  executor: Executor,
  filtro: FiltroEmpenhosSql,
  limite: number,
  deslocamento: number,
): Promise<{ itens: Empenho[]; total: number; totais: { empenhado: number; liquidado: number; pago: number; saldo: number } }> {
  const parametros = parametrosEmpenho(filtro);
  const linhas = await executor.consultar<LinhaEmpenho>(
    `${SELECAO_EMPENHO}
     ${CONDICOES_EMPENHO}
      ORDER BY e.emissao_em DESC, e.numero DESC
      LIMIT $7 OFFSET $8`,
    [...parametros, limite, deslocamento],
  );
  const agregados = await executor.consultar<{ total: number; empenhado: number; liquidado: number; pago: number }>(
    `SELECT COUNT(*)::integer AS total,
            COALESCE(SUM(e.valor_empenhado), 0)::bigint AS empenhado,
            COALESCE(SUM(e.valor_liquidado), 0)::bigint AS liquidado,
            COALESCE(SUM(e.valor_pago), 0)::bigint AS pago
       FROM empenhos e
     ${CONDICOES_EMPENHO}`,
    [...parametros],
  );
  const a = agregados[0] ?? { total: 0, empenhado: 0, liquidado: 0, pago: 0 };
  return {
    itens: linhas.map(mapearEmpenho),
    total: a.total,
    totais: { empenhado: a.empenhado, liquidado: a.liquidado, pago: a.pago, saldo: a.empenhado - a.liquidado },
  };
}

export async function empenhosDoContrato(executor: Executor, contratoId: string): Promise<Empenho[]> {
  const linhas = await executor.consultar<LinhaEmpenho>(
    `${SELECAO_EMPENHO} WHERE e.contrato_id = $1 ORDER BY e.emissao_em DESC, e.numero DESC`,
    [contratoId],
  );
  return linhas.map(mapearEmpenho);
}

// ───────────────────────── Pagamentos ─────────────────────────

interface LinhaPagamento {
  id: string;
  contrato_id: string;
  contrato_numero: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  nota_fiscal: string;
  competencia: string;
  valor: number;
  vencimento: string;
  pago_em: string | null;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  posicao: number | null;
  atestado_por: string | null;
  atestado_por_nome: string | null;
}

/**
 * Ordem cronológica de pagamentos por fonte de recurso (art. 141): posição entre os não pagos,
 * pela data de exigibilidade (vencimento).
 */
const SELECAO_PAGAMENTO = `
  WITH ordem AS (
    SELECT op.id,
           ROW_NUMBER() OVER (PARTITION BY op.fonte_recurso ORDER BY op.vencimento, op.criado_em, op.nota_fiscal) AS posicao
      FROM pagamentos op
     WHERE op.situacao <> 'pago'
  )
  SELECT p.id, p.contrato_id, c.numero AS contrato_numero, f.tipo_pessoa, f.razao_social, p.nota_fiscal, p.competencia,
         p.valor, p.vencimento, p.pago_em, p.situacao, o.posicao, p.atestado_por, ua.nome AS atestado_por_nome
    FROM pagamentos p
    JOIN contratos c ON c.id = p.contrato_id
    JOIN fornecedores f ON f.id = c.fornecedor_id
    LEFT JOIN ordem o ON o.id = p.id
    LEFT JOIN usuarios ua ON ua.id = p.atestado_por`;

/** Situação exibida: 'atrasado' quando não pago e vencido. */
export function situacaoExibida(situacao: LinhaPagamento['situacao'], vencimento: string, hoje: string): SituacaoPagamento {
  if (situacao === 'pago') return 'pago';
  return vencimento < hoje ? 'atrasado' : situacao;
}

function mapearPagamento(l: LinhaPagamento, hoje: string): Pagamento {
  return {
    id: l.id,
    contrato: { id: l.contrato_id, numero: l.contrato_numero },
    fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
    notaFiscal: l.nota_fiscal,
    competencia: l.competencia,
    valor: l.valor,
    vencimento: l.vencimento,
    pagoEm: l.pago_em,
    situacao: situacaoExibida(l.situacao, l.vencimento, hoje),
    posicaoOrdemCronologica: l.situacao === 'pago' ? null : l.posicao,
    atestadoPor: usuarioResumo(l.atestado_por, l.atestado_por_nome),
  };
}

export interface FiltroPagamentosSql {
  escopo: string[] | null;
  busca?: string | undefined;
  situacao?: SituacaoPagamento | undefined;
  uasg?: string | undefined;
  contratoId?: string | undefined;
  id?: string | undefined;
}

const CONDICOES_PAGAMENTO = `
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR p.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL
             OR ($3 = 'pago' AND p.situacao = 'pago')
             OR ($3 = 'atrasado' AND p.situacao <> 'pago' AND p.vencimento < $4::date)
             OR ($3 NOT IN ('pago', 'atrasado') AND p.situacao = $3 AND p.vencimento >= $4::date))
        AND ($5::text IS NULL OR c.uasg = $5)
        AND ($6::uuid IS NULL OR p.contrato_id = $6)
        AND ($7::uuid IS NULL OR p.id = $7)`;

export async function listarPagamentos(
  executor: Executor,
  filtro: FiltroPagamentosSql,
  hoje: string,
  limite: number,
  deslocamento: number,
): Promise<{ itens: Pagamento[]; total: number }> {
  const parametros = [
    filtro.escopo,
    filtro.busca ? padraoContem(filtro.busca) : null,
    filtro.situacao ?? null,
    hoje,
    filtro.uasg ?? null,
    filtro.contratoId ?? null,
    filtro.id ?? null,
  ] as const;
  const linhas = await executor.consultar<LinhaPagamento>(
    `${SELECAO_PAGAMENTO}
     ${CONDICOES_PAGAMENTO}
      ORDER BY (p.situacao = 'pago'), CASE WHEN p.situacao <> 'pago' THEN p.vencimento END, p.pago_em DESC, p.nota_fiscal
      LIMIT $8 OFFSET $9`,
    [...parametros, limite, deslocamento],
  );
  const contagem = await executor.consultar<{ total: number }>(
    `SELECT COUNT(*)::integer AS total
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
     ${CONDICOES_PAGAMENTO}`,
    [...parametros],
  );
  return { itens: linhas.map((l) => mapearPagamento(l, hoje)), total: contagem[0]?.total ?? 0 };
}

export async function obterPagamento(executor: Executor, id: string, escopo: string[] | null, hoje: string): Promise<Pagamento | null> {
  const { itens } = await listarPagamentos(executor, { escopo, id }, hoje, 1, 0);
  return itens[0] ?? null;
}
