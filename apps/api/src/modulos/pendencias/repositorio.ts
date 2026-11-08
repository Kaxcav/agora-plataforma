import type { Pendencia, Prioridade, TipoPendencia } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, padraoContem } from '../../compartilhado/texto.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

interface LinhaPendencia {
  id: string;
  tipo: TipoPendencia;
  prioridade: Prioridade;
  instrumento_tipo: 'ata' | 'contrato';
  instrumento_id: string;
  instrumento_numero: string | null;
  objeto: string | null;
  tipo_pessoa: 'PJ' | 'PF' | null;
  razao_social: string | null;
  uasg: string;
  motivo: string;
  prazo: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  situacao: 'aberta' | 'resolvida';
  resolvida_em: string | null;
  resolvida_por: string | null;
  resolvida_por_nome: string | null;
  observacao_resolucao: string | null;
}

export interface FiltroPendenciasSql {
  escopo: string[] | null;
  busca?: string | undefined;
  tipo?: TipoPendencia | undefined;
  prioridade?: Prioridade | undefined;
  situacao?: 'aberta' | 'resolvida' | undefined;
  uasg?: string | undefined;
  responsavelId?: string | undefined;
  id?: string | undefined;
}

export type OrdenacaoPendencias = 'prioridade' | 'prazo' | 'uasg';

/** Expressões de ordenação fixas (nunca texto do usuário no SQL). */
const ORDENACOES: Record<OrdenacaoPendencias, { asc: string; desc: string }> = {
  prioridade: {
    asc: "CASE p.prioridade WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END ASC, p.prazo ASC NULLS LAST, p.id",
    desc: "CASE p.prioridade WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END DESC, p.prazo ASC NULLS LAST, p.id",
  },
  prazo: { asc: 'p.prazo ASC NULLS LAST, p.id', desc: 'p.prazo DESC NULLS LAST, p.id' },
  uasg: { asc: 'p.uasg ASC, p.prazo ASC NULLS LAST, p.id', desc: 'p.uasg DESC, p.prazo ASC NULLS LAST, p.id' },
};

const DE_PENDENCIAS = `
    FROM pendencias p
    LEFT JOIN atas a ON p.instrumento_tipo = 'ata' AND a.id = p.instrumento_id
    LEFT JOIN contratos c ON p.instrumento_tipo = 'contrato' AND c.id = p.instrumento_id
    LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    LEFT JOIN usuarios ur ON ur.id = p.responsavel_id
    LEFT JOIN usuarios urp ON urp.id = p.resolvida_por
   WHERE ($1::text[] IS NULL OR p.uasg = ANY($1::text[]))
     AND ($2::text IS NULL OR p.busca_normalizada LIKE $2 ESCAPE '\\')
     AND ($3::text IS NULL OR p.tipo = $3)
     AND ($4::text IS NULL OR p.prioridade = $4)
     AND ($5::text IS NULL OR p.situacao = $5)
     AND ($6::text IS NULL OR p.uasg = $6)
     AND ($7::uuid IS NULL OR p.responsavel_id = $7)
     AND ($8::uuid IS NULL OR p.id = $8)`;

function mapear(l: LinhaPendencia): Pendencia {
  const numero = l.instrumento_numero ?? '—';
  return {
    id: l.id,
    tipo: l.tipo,
    prioridade: l.prioridade,
    instrumento: { tipo: l.instrumento_tipo, id: l.instrumento_id, identificador: identificadorInstrumento(l.instrumento_tipo, numero) },
    uasg: l.uasg,
    objeto: l.objeto ?? '',
    fornecedor: l.tipo_pessoa !== null && l.razao_social !== null ? nomeExibivel(l.tipo_pessoa, l.razao_social) : null,
    motivo: l.motivo,
    prazo: l.prazo,
    responsavel: usuarioResumo(l.responsavel_id, l.responsavel_nome),
    situacao: l.situacao,
    resolvidaEm: l.resolvida_em,
    resolvidaPor: usuarioResumo(l.resolvida_por, l.resolvida_por_nome),
    observacaoResolucao: l.observacao_resolucao,
  };
}

export async function listarPendencias(
  executor: Executor,
  filtro: FiltroPendenciasSql,
  ordenacao: { campo: OrdenacaoPendencias; ordem: 'asc' | 'desc' },
  limite: number,
  deslocamento: number,
): Promise<{ itens: Pendencia[]; total: number }> {
  const parametros = [
    filtro.escopo,
    filtro.busca ? padraoContem(filtro.busca) : null,
    filtro.tipo ?? null,
    filtro.prioridade ?? null,
    filtro.situacao ?? null,
    filtro.uasg ?? null,
    filtro.responsavelId ?? null,
    filtro.id ?? null,
  ] as const;
  const linhas = await executor.consultar<LinhaPendencia>(
    `SELECT p.id, p.tipo, p.prioridade, p.instrumento_tipo, p.instrumento_id,
            COALESCE(a.numero, c.numero) AS instrumento_numero, COALESCE(a.objeto, c.objeto) AS objeto,
            f.tipo_pessoa, f.razao_social, p.uasg, p.motivo, p.prazo, p.responsavel_id, ur.nome AS responsavel_nome,
            p.situacao, p.resolvida_em, p.resolvida_por, urp.nome AS resolvida_por_nome, p.observacao_resolucao
     ${DE_PENDENCIAS}
      ORDER BY ${ORDENACOES[ordenacao.campo][ordenacao.ordem]}
      LIMIT $9 OFFSET $10`,
    [...parametros, limite, deslocamento],
  );
  const contagem = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total ${DE_PENDENCIAS}`, [...parametros]);
  return { itens: linhas.map(mapear), total: contagem[0]?.total ?? 0 };
}

export async function obterPendencia(executor: Executor, id: string, escopo: string[] | null): Promise<Pendencia | null> {
  const { itens } = await listarPendencias(executor, { escopo, id }, { campo: 'prioridade', ordem: 'asc' }, 1, 0);
  return itens[0] ?? null;
}
