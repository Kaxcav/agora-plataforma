import { mascararDocumento } from '@agora/dominio';
import type { Sancao, TipoSancao } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

interface LinhaSancao {
  id: string;
  fornecedor_id: string;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  contrato_id: string | null;
  contrato_numero: string | null;
  inciso_infracao: string;
  tipo: TipoSancao;
  situacao: Sancao['situacao'];
  valor_multa: number | null;
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
  prazo_defesa: string | null;
  prazo_registro_ceis_cnep: string | null;
  registrada_ceis_cnep: boolean;
  instaurada_em: string;
}

export interface FiltroSancoesSql {
  escopo: string[] | null;
  situacao?: Sancao['situacao'] | undefined;
  tipo?: TipoSancao | undefined;
  fornecedorId?: string | undefined;
  id?: string | undefined;
}

/** Sanções sem contrato são visíveis a todos com `sancoes:ler`; as vinculadas a contrato seguem o escopo de UASG. */
const CONDICOES = `
    FROM sancoes s
    JOIN fornecedores f ON f.id = s.fornecedor_id
    LEFT JOIN contratos c ON c.id = s.contrato_id
   WHERE ($1::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($1::text[]))
     AND ($2::text IS NULL OR s.situacao = $2)
     AND ($3::text IS NULL OR s.tipo = $3)
     AND ($4::uuid IS NULL OR s.fornecedor_id = $4)
     AND ($5::uuid IS NULL OR s.id = $5)`;

function mapear(l: LinhaSancao): Sancao {
  return {
    id: l.id,
    fornecedor: { id: l.fornecedor_id, razaoSocial: nomeExibivel(l.tipo_pessoa, l.razao_social), documento: mascararDocumento(l.documento) },
    contrato: l.contrato_id !== null && l.contrato_numero !== null ? { id: l.contrato_id, numero: l.contrato_numero } : null,
    incisoInfracao: l.inciso_infracao,
    tipo: l.tipo,
    situacao: l.situacao,
    valorMulta: l.valor_multa,
    inicioVigencia: l.inicio_vigencia,
    fimVigencia: l.fim_vigencia,
    prazoDefesa: l.prazo_defesa,
    prazoRegistroCeisCnep: l.prazo_registro_ceis_cnep,
    registradaCeisCnep: l.registrada_ceis_cnep,
    instauradaEm: l.instaurada_em,
  };
}

export async function listarSancoes(
  executor: Executor,
  filtro: FiltroSancoesSql,
  limite: number,
  deslocamento: number,
): Promise<{ itens: Sancao[]; total: number }> {
  const parametros = [filtro.escopo, filtro.situacao ?? null, filtro.tipo ?? null, filtro.fornecedorId ?? null, filtro.id ?? null] as const;
  const linhas = await executor.consultar<LinhaSancao>(
    `SELECT s.id, s.fornecedor_id, f.documento, f.tipo_pessoa, f.razao_social, s.contrato_id, c.numero AS contrato_numero,
            s.inciso_infracao, s.tipo, s.situacao, s.valor_multa, s.inicio_vigencia, s.fim_vigencia, s.prazo_defesa,
            s.prazo_registro_ceis_cnep, s.registrada_ceis_cnep, s.instaurada_em
     ${CONDICOES}
      ORDER BY s.instaurada_em DESC, s.id
      LIMIT $6 OFFSET $7`,
    [...parametros, limite, deslocamento],
  );
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total ${CONDICOES}`, [...parametros]);
  return { itens: linhas.map(mapear), total: contagem?.total ?? 0 };
}
