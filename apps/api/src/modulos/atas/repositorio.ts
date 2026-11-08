import { formatarData, percentual } from '@agora/dominio';
import type { AtaDetalhe, AtaResumo, EventoLinhaDoTempo, FonteDados, InfoReajuste, ItemAta, Prioridade } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import {
  adicionarMeses,
  classificar,
  linkPncpAta,
  uasgDe,
  usuarioResumo,
  type VigenciaClassificada,
} from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

export interface FiltroAtasSql {
  escopo: string[] | null;
  busca?: string | undefined;
  uasg?: string | undefined;
  gestorId?: string | undefined;
  ids?: readonly string[] | undefined;
}

interface LinhaAta {
  id: string;
  numero: string;
  uasg: string;
  uasg_nome: string;
  uasg_sigla: string;
  uasg_uf: string;
  objeto: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_registrado: number;
  valor_contratado: number;
  quantidade_itens: number;
  itens_em_risco: number;
  gestor_id: string | null;
  gestor_nome: string | null;
}

/**
 * Criticidade da ata para priorização da gestão (regra da Ágora, documentada no Caderno de Regras, tela 'atas'):
 * alta — vigência crítica (até 30 dias), consumo ≥ 90% ou metade ou mais dos itens em risco;
 * média — vigência em atenção/alerta, consumo ≥ 70% ou algum item em risco; baixa — demais e encerradas.
 */
export function criticidadeAta(
  vigencia: VigenciaClassificada,
  percentualConsumido: number,
  itensEmRisco: number,
  quantidadeItens: number,
): Prioridade {
  if (vigencia.situacao === 'encerrado') return 'baixa';
  if (vigencia.semaforo === 'critico' || percentualConsumido >= 90 || (quantidadeItens > 0 && itensEmRisco * 2 >= quantidadeItens)) {
    return 'alta';
  }
  if (vigencia.semaforo === 'atencao' || vigencia.semaforo === 'alerta' || percentualConsumido >= 70 || itensEmRisco > 0) {
    return 'media';
  }
  return 'baixa';
}

export async function listarAtas(executor: Executor, filtro: FiltroAtasSql, hoje: string): Promise<AtaResumo[]> {
  const linhas = await executor.consultar<LinhaAta>(
    `SELECT a.id, a.numero, a.uasg, u.nome AS uasg_nome, u.sigla AS uasg_sigla, u.uf AS uasg_uf, a.objeto,
            a.vigencia_inicio, a.vigencia_fim, v.valor_registrado, v.valor_contratado, v.quantidade_itens, v.itens_em_risco,
            a.gestor_id, g.nome AS gestor_nome
       FROM atas a
       JOIN uasgs u ON u.codigo = a.uasg
       JOIN vw_atas_valores v ON v.ata_id = a.id
       LEFT JOIN usuarios g ON g.id = a.gestor_id
      WHERE ($1::text[] IS NULL OR a.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR a.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR a.uasg = $3)
        AND ($4::uuid IS NULL OR a.gestor_id = $4)
        AND ($5::uuid[] IS NULL OR a.id = ANY($5::uuid[]))
      ORDER BY a.vigencia_fim, a.numero`,
    [
      filtro.escopo,
      filtro.busca ? padraoContem(filtro.busca) : null,
      filtro.uasg ?? null,
      filtro.gestorId ?? null,
      filtro.ids ? [...filtro.ids] : null,
    ],
  );
  if (linhas.length === 0) return [];
  const fornecedores = await executor.consultar<{ ata_id: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string }>(
    `SELECT DISTINCT ia.ata_id, f.tipo_pessoa, f.razao_social
       FROM itens_ata ia
       JOIN fornecedores f ON f.id = ia.fornecedor_id
      WHERE ia.ata_id = ANY($1::uuid[])
      ORDER BY f.razao_social`,
    [linhas.map((l) => l.id)],
  );
  return linhas.map((l) => {
    const vigencia = classificar(l.vigencia_fim, hoje);
    const consumido = percentual(l.valor_contratado, l.valor_registrado);
    return {
      id: l.id,
      numero: l.numero,
      uasgGerenciadora: uasgDe(l.uasg, l.uasg_nome, l.uasg_sigla, l.uasg_uf),
      objeto: l.objeto,
      fornecedores: fornecedores.filter((f) => f.ata_id === l.id).map((f) => nomeExibivel(f.tipo_pessoa, f.razao_social)),
      vigenciaInicio: l.vigencia_inicio,
      vigenciaFim: l.vigencia_fim,
      diasRestantes: vigencia.diasRestantes,
      semaforo: vigencia.semaforo,
      situacao: vigencia.situacao,
      valorRegistrado: l.valor_registrado,
      valorContratado: l.valor_contratado,
      percentualConsumido: consumido,
      quantidadeItens: l.quantidade_itens,
      itensEmRisco: l.itens_em_risco,
      criticidade: criticidadeAta(vigencia, consumido, l.itens_em_risco, l.quantidade_itens),
      gestor: usuarioResumo(l.gestor_id, l.gestor_nome),
    };
  });
}

interface LinhaAtaDetalhe {
  processo_sei: string;
  modalidade: string;
  numero_compra: string;
  assinatura_em: string;
  divulgacao_pncp_em: string | null;
  aceita_adesao: boolean;
  id_pncp: string;
  indice_reajuste: string;
  data_base_reajuste: string;
  fonte_dados: FonteDados;
}

export interface DadosAtaDetalhe extends LinhaAtaDetalhe {
  resumo: AtaResumo;
}

export async function obterAtaBase(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  hoje: string,
): Promise<DadosAtaDetalhe | null> {
  const [resumo] = await listarAtas(executor, { escopo, ids: [id] }, hoje);
  if (!resumo) return null;
  const linhas = await executor.consultar<LinhaAtaDetalhe>(
    `SELECT processo_sei, modalidade, numero_compra, assinatura_em, divulgacao_pncp_em, aceita_adesao, id_pncp,
            indice_reajuste, data_base_reajuste, fonte_dados
       FROM atas WHERE id = $1`,
    [id],
  );
  const linha = linhas[0];
  return linha ? { ...linha, resumo } : null;
}

interface LinhaCiclo {
  inicio: string;
  fim: string;
  percentual: number;
  aplicado_em: string | null;
}

async function ciclosReajuste(executor: Executor, tipo: 'ata' | 'contrato', id: string): Promise<LinhaCiclo[]> {
  return executor.consultar<LinhaCiclo>(
    `SELECT inicio, fim, percentual, aplicado_em FROM reajustes_ciclos
      WHERE instrumento_tipo = $1 AND instrumento_id = $2 ORDER BY inicio`,
    [tipo, id],
  );
}

/** Próximo reajuste possível: aniversário da data-base após os ciclos já aplicados (interregno de 12 meses). */
function proximoReajuste(dataBase: string, ciclos: readonly LinhaCiclo[]): string {
  const aplicados = ciclos.filter((c) => c.aplicado_em !== null).length;
  return adicionarMeses(dataBase, 12 * (aplicados + 1));
}

export async function montarAtaDetalhe(
  executor: Executor,
  base: DadosAtaDetalhe,
  hoje: string,
  proveniencia: AtaDetalhe['proveniencia'],
): Promise<AtaDetalhe> {
  const { resumo } = base;
  const ciclos = await ciclosReajuste(executor, 'ata', resumo.id);
  const eventos: EventoLinhaDoTempo[] = [
    { data: base.assinatura_em, titulo: 'Assinatura da ata', descricao: null, tipo: 'assinatura', futuro: base.assinatura_em > hoje },
    { data: resumo.vigenciaInicio, titulo: 'Início da vigência', descricao: null, tipo: 'inicio_vigencia', futuro: resumo.vigenciaInicio > hoje },
    { data: resumo.vigenciaFim, titulo: 'Fim da vigência', descricao: 'Vigência de até 1 ano, prorrogável por igual período (art. 84)', tipo: 'fim_vigencia', futuro: resumo.vigenciaFim > hoje },
  ];
  if (base.divulgacao_pncp_em) {
    eventos.push({ data: base.divulgacao_pncp_em, titulo: 'Divulgação no PNCP', descricao: null, tipo: 'divulgacao', futuro: false });
  }
  for (const ciclo of ciclos) {
    if (ciclo.aplicado_em) {
      eventos.push({
        data: ciclo.aplicado_em,
        titulo: `Reajuste de ${ciclo.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${base.indice_reajuste})`,
        descricao: `Ciclo de ${formatarData(ciclo.inicio)} a ${formatarData(ciclo.fim)}`,
        tipo: 'reajuste',
        futuro: false,
      });
    }
  }
  const proximo = proximoReajuste(base.data_base_reajuste, ciclos);
  if (proximo <= resumo.vigenciaFim) {
    eventos.push({
      data: proximo,
      titulo: 'Reajuste possível (interregno de 12 meses)',
      descricao: 'Art. 25, § 7º, e art. 92, § 3º, da Lei 14.133/2021',
      tipo: 'marco',
      futuro: proximo > hoje,
    });
  }
  eventos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return {
    ...resumo,
    processoSei: base.processo_sei,
    modalidade: base.modalidade,
    numeroCompra: base.numero_compra,
    assinaturaEm: base.assinatura_em,
    divulgacaoPncpEm: base.divulgacao_pncp_em,
    aceitaAdesao: base.aceita_adesao,
    idPncp: base.id_pncp,
    linkPncp: linkPncpAta(base.id_pncp),
    saldoContratavel: Math.max(0, resumo.valorRegistrado - resumo.valorContratado),
    linhaDoTempo: eventos,
    proveniencia,
  };
}

export async function montarInfoReajuste(executor: Executor, base: DadosAtaDetalhe): Promise<InfoReajuste> {
  const ciclos = await ciclosReajuste(executor, 'ata', base.resumo.id);
  return {
    indice: base.indice_reajuste,
    dataBase: base.data_base_reajuste,
    proximoReajustePossivelEm: proximoReajuste(base.data_base_reajuste, ciclos),
    ciclos: ciclos.map((c) => ({ inicio: c.inicio, fim: c.fim, percentual: c.percentual, aplicadoEm: c.aplicado_em })),
    observacao:
      `Reajuste em sentido estrito pelo índice ${base.indice_reajuste}, com interregno mínimo de 12 meses contado da data-base ` +
      `(art. 25, § 7º, e art. 92, § 3º, da Lei 14.133/2021), formalizado por apostilamento (art. 136, I). ` +
      `Os preços registrados reajustados valem para as contratações futuras decorrentes da ata.`,
  };
}

interface LinhaItemAta {
  id: string;
  numero: number;
  descricao: string;
  catmat: string | null;
  unidade_fornecimento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  valor_unitario: number;
  quantidade_registrada: number;
  quantidade_contratada: number;
  quantidade_empenhada: number;
}

export async function itensDaAta(executor: Executor, ataId: string): Promise<ItemAta[]> {
  const linhas = await executor.consultar<LinhaItemAta>(
    `SELECT ia.id, ia.numero, ia.descricao, ia.catmat, ia.unidade_fornecimento, f.tipo_pessoa, f.razao_social,
            ia.valor_unitario, ia.quantidade_registrada, s.quantidade_contratada, s.quantidade_empenhada
       FROM itens_ata ia
       JOIN fornecedores f ON f.id = ia.fornecedor_id
       JOIN vw_itens_ata_saldos s ON s.item_ata_id = ia.id
      WHERE ia.ata_id = $1
      ORDER BY ia.numero`,
    [ataId],
  );
  return linhas.map((l) => {
    const consumido = percentual(l.quantidade_contratada, l.quantidade_registrada);
    return {
      id: l.id,
      numero: l.numero,
      descricao: l.descricao,
      catmat: l.catmat,
      unidadeFornecimento: l.unidade_fornecimento,
      fornecedor: nomeExibivel(l.tipo_pessoa, l.razao_social),
      valorUnitario: l.valor_unitario,
      quantidadeRegistrada: l.quantidade_registrada,
      quantidadeContratada: l.quantidade_contratada,
      quantidadeEmpenhada: l.quantidade_empenhada,
      percentualConsumido: consumido,
      emRisco: l.quantidade_registrada === 0 || l.quantidade_contratada * 10 >= l.quantidade_registrada * 9,
    };
  });
}
