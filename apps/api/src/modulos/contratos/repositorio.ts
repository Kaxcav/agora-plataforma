import { formatarData, percentual, projetarQueimaSaldo, situacaoDivulgacaoPncp, type OpcoesCalendario } from '@agora/dominio';
import type { ContratoDetalhe, ContratoResumo, EventoLinhaDoTempo, FonteDados } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { adicionarMeses, classificar, linkPncpContrato, uasgDe, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { carregarFornecedores } from '../fornecedores/repositorio.ts';

export interface FiltroContratosSql {
  escopo: string[] | null;
  busca?: string | undefined;
  uasg?: string | undefined;
  gestorId?: string | undefined;
  semAta?: boolean | undefined;
  ids?: readonly string[] | undefined;
  ataId?: string | undefined;
  fornecedorId?: string | undefined;
}

interface LinhaContrato {
  id: string;
  numero: string;
  uasg: string;
  uasg_nome: string;
  uasg_sigla: string;
  uasg_uf: string;
  fornecedor_id: string;
  objeto: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_global: number;
  valor_empenhado: number;
  valor_pago: number;
  pendencias_abertas: number;
  gestor_id: string | null;
  gestor_nome: string | null;
  ata_id: string | null;
  ata_numero: string | null;
}

const SELECAO_CONTRATO = `
  SELECT c.id, c.numero, c.uasg, u.nome AS uasg_nome, u.sigla AS uasg_sigla, u.uf AS uasg_uf,
         c.fornecedor_id, c.objeto, c.vigencia_inicio, c.vigencia_fim,
         v.valor_global, v.valor_empenhado, v.valor_pago, v.pendencias_abertas,
         c.gestor_id, g.nome AS gestor_nome, c.ata_id, a.numero AS ata_numero
    FROM contratos c
    JOIN uasgs u ON u.codigo = c.uasg
    JOIN vw_contratos_valores v ON v.contrato_id = c.id
    LEFT JOIN usuarios g ON g.id = c.gestor_id
    LEFT JOIN atas a ON a.id = c.ata_id`;

/** Contratos visíveis (escopo de UASG no SQL) já com fornecedor (IDC), semáforo e valores consolidados. */
export async function listarContratos(executor: Executor, filtro: FiltroContratosSql, hoje: string): Promise<ContratoResumo[]> {
  const linhas = await executor.consultar<LinhaContrato>(
    `${SELECAO_CONTRATO}
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR c.uasg = $3)
        AND ($4::uuid IS NULL OR c.gestor_id = $4)
        AND ($5::boolean IS NULL OR ($5 AND c.ata_id IS NULL) OR (NOT $5 AND c.ata_id IS NOT NULL))
        AND ($6::uuid[] IS NULL OR c.id = ANY($6::uuid[]))
        AND ($7::uuid IS NULL OR c.ata_id = $7)
        AND ($8::uuid IS NULL OR c.fornecedor_id = $8)
      ORDER BY c.vigencia_fim, c.numero`,
    [
      filtro.escopo,
      filtro.busca ? padraoContem(filtro.busca) : null,
      filtro.uasg ?? null,
      filtro.gestorId ?? null,
      filtro.semAta ?? null,
      filtro.ids ? [...filtro.ids] : null,
      filtro.ataId ?? null,
      filtro.fornecedorId ?? null,
    ],
  );
  const fornecedores = await carregarFornecedores(
    executor,
    linhas.map((l) => l.fornecedor_id),
    hoje,
  );
  return linhas.flatMap((l) => {
    const fornecedor = fornecedores.get(l.fornecedor_id);
    if (!fornecedor) return [];
    const vigencia = classificar(l.vigencia_fim, hoje);
    const resumo: ContratoResumo = {
      id: l.id,
      numero: l.numero,
      uasg: uasgDe(l.uasg, l.uasg_nome, l.uasg_sigla, l.uasg_uf),
      fornecedor: fornecedor.resumo,
      objeto: l.objeto,
      vigenciaInicio: l.vigencia_inicio,
      vigenciaFim: l.vigencia_fim,
      diasRestantes: vigencia.diasRestantes,
      semaforo: vigencia.semaforo,
      situacao: vigencia.situacao,
      valorGlobal: l.valor_global,
      valorEmpenhado: l.valor_empenhado,
      valorPago: l.valor_pago,
      percentualExecutado: percentual(l.valor_pago, l.valor_global),
      pendenciasAbertas: l.pendencias_abertas,
      gestor: usuarioResumo(l.gestor_id, l.gestor_nome),
      ataOrigem: l.ata_id !== null && l.ata_numero !== null ? { id: l.ata_id, numero: l.ata_numero } : null,
    };
    return [resumo];
  });
}

export async function obterContratoResumo(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  hoje: string,
): Promise<ContratoResumo | null> {
  const [contrato] = await listarContratos(executor, { escopo, ids: [id] }, hoje);
  return contrato ?? null;
}

interface LinhaDetalhe {
  processo_sei: string;
  origem: 'licitacao' | 'contratacao_direta';
  modalidade: string;
  assinatura_em: string;
  divulgacao_pncp_em: string | null;
  valor_inicial: number;
  acrescimos: number;
  supressoes: number;
  reajustes: number;
  fiscal_id: string | null;
  fiscal_nome: string | null;
  id_pncp: string | null;
  garantia_tipo: string | null;
  garantia_valor: number | null;
  garantia_valida_ate: string | null;
  data_base_reajuste: string;
  fonte_dados: FonteDados;
  fornecedor_id: string;
}

export interface DadosContratoDetalhe extends LinhaDetalhe {
  resumo: ContratoResumo;
}

export async function obterContratoDetalheBase(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  hoje: string,
): Promise<DadosContratoDetalhe | null> {
  const resumo = await obterContratoResumo(executor, id, escopo, hoje);
  if (!resumo) return null;
  const linhas = await executor.consultar<LinhaDetalhe>(
    `SELECT c.processo_sei, c.origem, c.modalidade, c.assinatura_em, c.divulgacao_pncp_em, c.valor_inicial,
            v.acrescimos, v.supressoes, v.reajustes, c.fiscal_id, f.nome AS fiscal_nome, c.id_pncp,
            c.garantia_tipo, c.garantia_valor, c.garantia_valida_ate, c.data_base_reajuste, c.fonte_dados, c.fornecedor_id
       FROM contratos c
       JOIN vw_contratos_valores v ON v.contrato_id = c.id
       LEFT JOIN usuarios f ON f.id = c.fiscal_id
      WHERE c.id = $1`,
    [id],
  );
  const linha = linhas[0];
  return linha ? { ...linha, resumo } : null;
}

interface LinhaAditivoLinha {
  numero: string;
  tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste';
  valor: number;
  assinado_em: string;
  justificativa: string;
  nova_vigencia_fim: string | null;
}

interface LinhaCicloReajuste {
  inicio: string;
  fim: string;
  percentual: number;
  aplicado_em: string | null;
}

const ROTULO_ADITIVO: Record<LinhaAditivoLinha['tipo'], string> = {
  acrescimo: 'acréscimo',
  supressao: 'supressão',
  prorrogacao: 'prorrogação',
  reajuste: 'reajuste',
};

/** Detalhe completo do contrato: divulgação (art. 94) e queima de saldo calculadas por @agora/dominio. */
export async function montarContratoDetalhe(
  executor: Executor,
  base: DadosContratoDetalhe,
  hoje: string,
  calendario: OpcoesCalendario,
  proveniencia: ContratoDetalhe['proveniencia'],
): Promise<ContratoDetalhe> {
  const { resumo } = base;
  const divulgacao = situacaoDivulgacaoPncp(base.assinatura_em, base.origem, base.divulgacao_pncp_em, hoje, calendario);
  const queima =
    resumo.valorGlobal > 0
      ? projetarQueimaSaldo({
          valorTotal: resumo.valorGlobal,
          valorExecutado: resumo.valorPago,
          inicio: resumo.vigenciaInicio,
          fim: resumo.vigenciaFim,
          hoje,
        })
      : null;

  const aditivos = await executor.consultar<LinhaAditivoLinha>(
    `SELECT numero, tipo, valor, assinado_em, justificativa, nova_vigencia_fim
       FROM aditivos WHERE contrato_id = $1 ORDER BY assinado_em, numero`,
    [resumo.id],
  );
  const ciclos = await executor.consultar<LinhaCicloReajuste>(
    `SELECT inicio, fim, percentual, aplicado_em FROM reajustes_ciclos
      WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 ORDER BY inicio`,
    [resumo.id],
  );

  const eventos: EventoLinhaDoTempo[] = [
    { data: base.assinatura_em, titulo: 'Assinatura do contrato', descricao: null, tipo: 'assinatura', futuro: false },
    base.divulgacao_pncp_em
      ? {
          data: base.divulgacao_pncp_em,
          titulo: 'Divulgação no PNCP',
          descricao: divulgacao.explicacao,
          tipo: 'divulgacao',
          futuro: false,
        }
      : {
          data: divulgacao.limite,
          titulo: 'Prazo-limite para divulgação no PNCP (art. 94)',
          descricao: divulgacao.explicacao,
          tipo: 'marco',
          futuro: divulgacao.limite > hoje,
        },
    { data: resumo.vigenciaInicio, titulo: 'Início da vigência', descricao: null, tipo: 'inicio_vigencia', futuro: resumo.vigenciaInicio > hoje },
    { data: resumo.vigenciaFim, titulo: 'Fim da vigência', descricao: null, tipo: 'fim_vigencia', futuro: resumo.vigenciaFim > hoje },
    ...aditivos.map(
      (a): EventoLinhaDoTempo => ({
        data: a.assinado_em,
        titulo: `${a.numero} (${ROTULO_ADITIVO[a.tipo]})`,
        descricao: a.justificativa,
        tipo: 'aditivo',
        futuro: a.assinado_em > hoje,
      }),
    ),
    ...ciclos
      .filter((c): c is LinhaCicloReajuste & { aplicado_em: string } => c.aplicado_em !== null)
      .map(
        (c): EventoLinhaDoTempo => ({
          data: c.aplicado_em,
          titulo: `Reajuste de ${c.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (apostilamento)`,
          descricao: `Ciclo de ${formatarData(c.inicio)} a ${formatarData(c.fim)} (art. 136, I)`,
          tipo: 'apostilamento',
          futuro: false,
        }),
      ),
  ];
  const aplicados = ciclos.filter((c) => c.aplicado_em !== null).length;
  const proximoReajuste = adicionarMeses(base.data_base_reajuste, 12 * (aplicados + 1));
  if (proximoReajuste <= resumo.vigenciaFim) {
    eventos.push({
      data: proximoReajuste,
      titulo: 'Reajuste possível (interregno de 12 meses)',
      descricao: 'Art. 25, § 7º, e art. 92, § 3º, da Lei 14.133/2021',
      tipo: 'marco',
      futuro: proximoReajuste > hoje,
    });
  }
  eventos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return {
    ...resumo,
    processoSei: base.processo_sei,
    origem: base.origem,
    modalidade: base.modalidade,
    assinaturaEm: base.assinatura_em,
    divulgacaoPncpEm: base.divulgacao_pncp_em,
    divulgacaoPncp: { situacao: divulgacao.situacao, limite: divulgacao.limite, explicacao: divulgacao.explicacao },
    valorInicial: base.valor_inicial,
    acrescimos: base.acrescimos,
    supressoes: base.supressoes,
    fiscal: usuarioResumo(base.fiscal_id, base.fiscal_nome),
    idPncp: base.id_pncp,
    linkPncp: linkPncpContrato(base.id_pncp),
    garantia:
      base.garantia_tipo !== null && base.garantia_valor !== null && base.garantia_valida_ate !== null
        ? { tipo: base.garantia_tipo, valor: base.garantia_valor, validaAte: base.garantia_valida_ate }
        : null,
    queimaSaldo: queima
      ? {
          percentualExecutado: queima.percentualExecutado,
          percentualTempoDecorrido: queima.percentualTempoDecorrido,
          dataEsgotamentoProjetada: queima.dataEsgotamentoProjetada,
          esgotaAntesDoFim: queima.esgotaAntesDoFim,
          sinal: queima.sinal,
          explicacao: queima.explicacao,
        }
      : {
          percentualExecutado: 0,
          percentualTempoDecorrido: 0,
          dataEsgotamentoProjetada: null,
          esgotaAntesDoFim: false,
          sinal: 'normal',
          explicacao: 'Contrato sem valor global registrado: não há saldo a projetar.',
        },
    linhaDoTempo: eventos,
    proveniencia,
  };
}
