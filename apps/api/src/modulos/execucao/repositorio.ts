/**
 * Leitura da execução contratual (frente L): parâmetros do contrato, designações, livro de ocorrências, entregas e
 * termos de recebimento, garantias, multas descontáveis e notas fiscais do contrato. Só leitura; as escritas ficam
 * nas rotas, cada uma na transação do seu evento de auditoria.
 */
import {
  baseCalculoGarantia,
  calcularGarantiaObjeto,
  situacaoGarantia,
  situacaoPrazoExecucao,
  verificarDesignacoesContrato,
  type PapelFiscalizacao,
  type VariacaoMensalIndice,
} from '@agora/dominio';
import type {
  DesignacaoContrato,
  DescontoMulta,
  ExecucaoContrato,
  GarantiaContrato,
  MovimentoGarantia,
  MultaContrato,
  OcorrenciaContrato,
  OrdemServicoContrato,
  ParametrosExecucaoContrato,
  RecebimentoContrato,
  TermoRecebimento,
  VerificacaoReservasCargos,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { situacaoExibida } from '../financeiro/repositorio.ts';

/** Contrato no escopo de UASG (null = fora do escopo ou inexistente). */
export interface ContratoExecucao {
  id: string;
  numero: string;
  uasg: string;
  objeto: string;
  processo_sei: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo_pessoa: 'PJ' | 'PF';
  assinatura_em: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_inicial: number;
  gestor_id: string | null;
  fiscal_id: string | null;
}

export async function contratoExecucao(executor: Executor, id: string, escopo: string[] | null, bloquear = false): Promise<ContratoExecucao | null> {
  const [linha] = await executor.consultar<ContratoExecucao>(
    `SELECT c.id, c.numero, c.uasg, c.objeto, c.processo_sei, c.fornecedor_id, f.razao_social AS fornecedor_nome, f.tipo_pessoa,
            c.assinatura_em, c.vigencia_inicio, c.vigencia_fim, c.valor_inicial, c.gestor_id, c.fiscal_id
       FROM contratos c JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))
      ${bloquear ? 'FOR UPDATE OF c' : ''}`,
    [id, escopo],
  );
  return linha ?? null;
}

// ───────── parâmetros ─────────

interface LinhaParametros {
  prazo_provisorio_dias_uteis: number;
  prazo_definitivo_dias_uteis: number;
  prazo_correcao_dias_uteis: number;
  prazo_liquidacao_dias_uteis: number;
  prazo_pagamento_dias: number;
  marco_pagamento: 'recebimento_definitivo' | 'liquidacao';
  indice_atualizacao: string;
  juros_mora_mensal: string | number;
  garantia_objeto_meses: number;
  periodo_antecedente_dias_uteis: number;
  reserva_mulheres_percentual: string | number;
  reserva_egressos: boolean;
  atualizado_em: string | null;
  atualizado_por: string | null;
  atualizado_por_nome: string | null;
}

export async function carregarParametros(executor: Executor, contratoId: string): Promise<ParametrosExecucaoContrato | null> {
  const [l] = await executor.consultar<LinhaParametros>(
    `SELECT p.*, u.nome AS atualizado_por_nome
       FROM contratos_parametros_execucao p LEFT JOIN usuarios u ON u.id = p.atualizado_por
      WHERE p.contrato_id = $1`,
    [contratoId],
  );
  if (!l) return null;
  return {
    prazoProvisorioDiasUteis: l.prazo_provisorio_dias_uteis,
    prazoDefinitivoDiasUteis: l.prazo_definitivo_dias_uteis,
    prazoCorrecaoDiasUteis: l.prazo_correcao_dias_uteis,
    prazoLiquidacaoDiasUteis: l.prazo_liquidacao_dias_uteis,
    prazoPagamentoDias: l.prazo_pagamento_dias,
    marcoPagamento: l.marco_pagamento,
    indiceAtualizacao: l.indice_atualizacao,
    jurosMoraMensal: Number(l.juros_mora_mensal),
    garantiaObjetoMeses: l.garantia_objeto_meses,
    periodoAntecedenteDiasUteis: l.periodo_antecedente_dias_uteis,
    reservaMulheresPercentual: Number(l.reserva_mulheres_percentual),
    reservaEgressos: l.reserva_egressos,
    atualizadoEm: l.atualizado_em,
    atualizadoPor: usuarioResumo(l.atualizado_por, l.atualizado_por_nome),
  };
}

// ───────── ordens de serviço e reservas de cargos ─────────

export async function carregarOrdensServico(executor: Executor, contratoId: string): Promise<OrdemServicoContrato[]> {
  const linhas = await executor.consultar<{ id: string; numero: string; expedida_em: string; descricao: string; antes_do_periodo: boolean; registrado_por: string | null; registrado_por_nome: string | null; registrado_em: string }>(
    `SELECT o.id, o.numero, o.expedida_em, o.descricao, o.antes_do_periodo, o.registrado_por, u.nome AS registrado_por_nome, o.registrado_em
       FROM contratos_ordens_servico o LEFT JOIN usuarios u ON u.id = o.registrado_por
      WHERE o.contrato_id = $1 ORDER BY o.expedida_em DESC, o.registrado_em DESC`,
    [contratoId],
  );
  return linhas.map((l) => ({
    id: l.id,
    numero: l.numero,
    expedidaEm: l.expedida_em,
    descricao: l.descricao,
    antesDoPeriodo: l.antes_do_periodo,
    registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
    registradoEm: l.registrado_em,
  }));
}

export async function carregarReservasCargos(executor: Executor, contratoId: string): Promise<VerificacaoReservasCargos[]> {
  const linhas = await executor.consultar<{ id: string; competencia: string; empregados: number; atende: boolean; resultado: { itens: VerificacaoReservasCargos['itens']; pendencias: string[] }; observacao: string | null; ocorrencia_id: string | null; registrado_por: string | null; registrado_por_nome: string | null; registrado_em: string }>(
    `SELECT r.id, r.competencia, r.empregados, r.atende, r.resultado, r.observacao, r.ocorrencia_id, r.registrado_por, u.nome AS registrado_por_nome, r.registrado_em
       FROM contratos_reservas_cargos r LEFT JOIN usuarios u ON u.id = r.registrado_por
      WHERE r.contrato_id = $1 ORDER BY r.competencia DESC`,
    [contratoId],
  );
  return linhas.map((l) => ({
    id: l.id,
    competencia: l.competencia,
    empregados: l.empregados,
    atende: l.atende,
    itens: l.resultado.itens,
    pendencias: l.resultado.pendencias,
    observacao: l.observacao,
    ocorrenciaId: l.ocorrencia_id,
    registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
    registradoEm: l.registrado_em,
  }));
}

// ───────── designações ─────────

interface LinhaDesignacao {
  id: string;
  papel: PapelFiscalizacao;
  usuario_id: string;
  usuario_nome: string;
  substituto: boolean;
  ato: string;
  inicio: string;
  fim: string | null;
  motivo_encerramento: string | null;
  designado_por: string | null;
  designado_por_nome: string | null;
  designado_em: string;
}

export async function carregarDesignacoes(executor: Executor, contratoId: string): Promise<DesignacaoContrato[]> {
  const linhas = await executor.consultar<LinhaDesignacao>(
    `SELECT d.id, d.papel, d.usuario_id, u.nome AS usuario_nome, d.substituto, d.ato, d.inicio, d.fim, d.motivo_encerramento,
            d.designado_por, dp.nome AS designado_por_nome, d.designado_em
       FROM contratos_designacoes d
       JOIN usuarios u ON u.id = d.usuario_id
       LEFT JOIN usuarios dp ON dp.id = d.designado_por
      WHERE d.contrato_id = $1
      ORDER BY (d.fim IS NOT NULL), d.papel, d.substituto, d.inicio DESC`,
    [contratoId],
  );
  return linhas.map((l) => ({
    id: l.id,
    papel: l.papel,
    usuario: { id: l.usuario_id, nome: l.usuario_nome },
    substituto: l.substituto,
    ato: l.ato,
    inicio: l.inicio,
    fim: l.fim,
    motivoEncerramento: l.motivo_encerramento,
    designadoPor: usuarioResumo(l.designado_por, l.designado_por_nome),
    designadoEm: l.designado_em,
  }));
}

/** Designações ativas hoje (início já alcançado e sem fim). */
export function designacoesAtivas(designacoes: readonly DesignacaoContrato[], hoje: string): DesignacaoContrato[] {
  return designacoes.filter((d) => d.fim === null && d.inicio <= hoje);
}

export async function papeisDoUsuario(executor: Executor, contratoId: string, usuarioId: string, hoje: string): Promise<PapelFiscalizacao[]> {
  const linhas = await executor.consultar<{ papel: PapelFiscalizacao }>(
    `SELECT DISTINCT papel FROM contratos_designacoes
      WHERE contrato_id = $1 AND usuario_id = $2 AND fim IS NULL AND inicio <= $3::date`,
    [contratoId, usuarioId, hoje],
  );
  return linhas.map((l) => l.papel);
}

// ───────── ocorrências ─────────

interface LinhaOcorrencia {
  id: string;
  numero: number;
  tipo: OcorrenciaContrato['tipo'];
  data_fato: string;
  relato: string;
  providencia: string | null;
  prazo_regularizacao: string | null;
  situacao: 'aberta' | 'regularizada';
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
  notificacao_id: string | null;
  recebimento_id: string | null;
  regularizada_em: string | null;
  observacao_regularizacao: string | null;
}

export async function carregarOcorrencias(executor: Executor, contratoId: string, id?: string): Promise<OcorrenciaContrato[]> {
  const linhas = await executor.consultar<LinhaOcorrencia>(
    `SELECT o.*, u.nome AS registrada_por_nome
       FROM contratos_ocorrencias o LEFT JOIN usuarios u ON u.id = o.registrada_por
      WHERE o.contrato_id = $1 AND ($2::uuid IS NULL OR o.id = $2)
      ORDER BY o.numero DESC`,
    [contratoId, id ?? null],
  );
  return linhas.map((l) => ({
    id: l.id,
    numero: l.numero,
    tipo: l.tipo,
    dataFato: l.data_fato,
    relato: l.relato,
    providencia: l.providencia,
    prazoRegularizacao: l.prazo_regularizacao,
    situacao: l.situacao,
    registradaPor: usuarioResumo(l.registrada_por, l.registrada_por_nome),
    registradaEm: l.registrada_em,
    notificacaoId: l.notificacao_id,
    recebimentoId: l.recebimento_id,
    regularizadaEm: l.regularizada_em,
    observacaoRegularizacao: l.observacao_regularizacao,
  }));
}

// ───────── recebimentos ─────────

interface LinhaRecebimento {
  id: string;
  numero: number;
  descricao: string;
  valor: number;
  entregue_em: string;
  pagamento_id: string | null;
  nota_fiscal: string | null;
  pagamento_situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago' | null;
  pagamento_vencimento: string | null;
  situacao: RecebimentoContrato['situacao'];
  etapa_correcao: 'provisorio' | 'definitivo' | null;
  prazo_atual: string | null;
  prazo_correcao: string | null;
  definitivo_em: string | null;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

interface LinhaTermo {
  id: string;
  recebimento_id: string;
  tipo: 'provisorio' | 'definitivo';
  resultado: TermoRecebimento['resultado'];
  data: string;
  observacoes: string | null;
  prazo_correcao: string | null;
  responsavel_id: string;
  responsavel_nome: string;
  papel_responsavel: PapelFiscalizacao;
  fora_do_prazo: boolean;
  hash_pdf: string;
  registrado_em: string;
}

function mapearTermo(l: LinhaTermo): TermoRecebimento {
  return {
    id: l.id,
    tipo: l.tipo,
    resultado: l.resultado,
    data: l.data,
    observacoes: l.observacoes,
    prazoCorrecao: l.prazo_correcao,
    responsavel: { id: l.responsavel_id, nome: l.responsavel_nome },
    papelResponsavel: l.papel_responsavel,
    foraDoPrazo: l.fora_do_prazo,
    hashPdf: l.hash_pdf,
    registradoEm: l.registrado_em,
  };
}

export async function carregarRecebimentos(
  executor: Executor,
  contratoId: string,
  hoje: string,
  garantiaObjetoMeses: number,
  id?: string,
): Promise<RecebimentoContrato[]> {
  const linhas = await executor.consultar<LinhaRecebimento>(
    `SELECT r.id, r.numero, r.descricao, r.valor, r.entregue_em, r.pagamento_id, p.nota_fiscal, p.situacao AS pagamento_situacao,
            p.vencimento AS pagamento_vencimento, r.situacao, r.etapa_correcao, r.prazo_atual, r.prazo_correcao, r.definitivo_em,
            r.registrado_por, u.nome AS registrado_por_nome, r.registrado_em
       FROM contratos_recebimentos r
       LEFT JOIN pagamentos p ON p.id = r.pagamento_id
       LEFT JOIN usuarios u ON u.id = r.registrado_por
      WHERE r.contrato_id = $1 AND ($2::uuid IS NULL OR r.id = $2)
      ORDER BY r.numero DESC`,
    [contratoId, id ?? null],
  );
  if (linhas.length === 0) return [];
  const termos = await executor.consultar<LinhaTermo>(
    `SELECT t.id, t.recebimento_id, t.tipo, t.resultado, t.data, t.observacoes, t.prazo_correcao, t.responsavel_id, u.nome AS responsavel_nome,
            t.papel_responsavel, t.fora_do_prazo, t.hash_pdf, t.registrado_em
       FROM recebimentos_termos t JOIN usuarios u ON u.id = t.responsavel_id
      WHERE t.recebimento_id = ANY($1::uuid[])
      ORDER BY t.registrado_em, t.id`,
    [linhas.map((l) => l.id)],
  );
  return linhas.map((l) => ({
    id: l.id,
    numero: l.numero,
    descricao: l.descricao,
    valor: l.valor,
    entregueEm: l.entregue_em,
    notaFiscal:
      l.pagamento_id && l.nota_fiscal && l.pagamento_situacao && l.pagamento_vencimento
        ? { pagamentoId: l.pagamento_id, numero: l.nota_fiscal, situacao: situacaoExibida(l.pagamento_situacao, l.pagamento_vencimento, hoje) }
        : null,
    situacao: l.situacao,
    etapaCorrecao: l.etapa_correcao,
    prazoAtual: l.prazo_atual,
    situacaoPrazo: l.prazo_atual && l.situacao !== 'recebido' ? situacaoPrazoExecucao(l.prazo_atual, hoje).situacao : null,
    prazoCorrecao: l.prazo_correcao,
    definitivoEm: l.definitivo_em,
    garantiaObjetoAte: l.definitivo_em ? calcularGarantiaObjeto(l.definitivo_em, garantiaObjetoMeses).ate : null,
    termos: termos.filter((t) => t.recebimento_id === l.id).map(mapearTermo),
    registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
    registradoEm: l.registrado_em,
  }));
}

/** Termo com o contrato e a entrega, para o PDF (escopo de UASG aplicado). */
export interface TermoParaPdf {
  termo: TermoRecebimento;
  recebimento: { numero: number; descricao: string; valor: number; entregueEm: string; notaFiscal: string | null };
  contrato: ContratoExecucao;
}

export async function termoParaPdf(executor: Executor, termoId: string, escopo: string[] | null): Promise<TermoParaPdf | null> {
  const [l] = await executor.consultar<LinhaTermo & { contrato_id: string; numero: number; descricao: string; valor: number; entregue_em: string; nota_fiscal: string | null }>(
    `SELECT t.id, t.recebimento_id, t.tipo, t.resultado, t.data, t.observacoes, t.prazo_correcao, t.responsavel_id, u.nome AS responsavel_nome,
            t.papel_responsavel, t.fora_do_prazo, t.hash_pdf, t.registrado_em,
            r.contrato_id, r.numero, r.descricao, r.valor, r.entregue_em, p.nota_fiscal
       FROM recebimentos_termos t
       JOIN usuarios u ON u.id = t.responsavel_id
       JOIN contratos_recebimentos r ON r.id = t.recebimento_id
       LEFT JOIN pagamentos p ON p.id = r.pagamento_id
      WHERE t.id = $1`,
    [termoId],
  );
  if (!l) return null;
  const contrato = await contratoExecucao(executor, l.contrato_id, escopo);
  if (!contrato) return null;
  return {
    termo: mapearTermo(l),
    recebimento: { numero: l.numero, descricao: l.descricao, valor: l.valor, entregueEm: l.entregue_em, notaFiscal: l.nota_fiscal },
    contrato,
  };
}

// ───────── garantias ─────────

interface LinhaGarantia {
  id: string;
  finalidade: GarantiaContrato['finalidade'];
  percentual: string | number;
  valor_base: number;
  base_anual: boolean;
  valor_exigido: number;
  justificativa_percentual: string | null;
  grande_vulto_engenharia: boolean;
  clausula_retomada: boolean;
  modalidade_exigida: GarantiaContrato['modalidade'];
  prazo_apresentacao: string | null;
  modalidade: GarantiaContrato['modalidade'];
  valor: number | null;
  saldo: number;
  emissor: string | null;
  documento: string | null;
  apresentada_em: string | null;
  valida_ate: string | null;
  situacao: 'aguardando_apresentacao' | 'vigente' | 'liberada' | 'executada';
  liberada_em: string | null;
  valor_restituido: number | null;
}

interface LinhaMovimento {
  id: string;
  garantia_id: string;
  tipo: MovimentoGarantia['tipo'];
  data: string;
  valor: number | null;
  descricao: string;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

export async function carregarGarantias(executor: Executor, contratoId: string, vigenciaFim: string, hoje: string, id?: string): Promise<GarantiaContrato[]> {
  const linhas = await executor.consultar<LinhaGarantia>(
    `SELECT id, finalidade, percentual, valor_base, base_anual, valor_exigido, justificativa_percentual, grande_vulto_engenharia,
            clausula_retomada, modalidade_exigida, prazo_apresentacao, modalidade, valor, saldo, emissor, documento, apresentada_em,
            valida_ate, situacao, liberada_em, valor_restituido
       FROM contratos_garantias
      WHERE contrato_id = $1 AND ($2::uuid IS NULL OR id = $2)
      ORDER BY registrada_em DESC, id`,
    [contratoId, id ?? null],
  );
  if (linhas.length === 0) return [];
  const movimentos = await executor.consultar<LinhaMovimento>(
    `SELECT m.id, m.garantia_id, m.tipo, m.data, m.valor, m.descricao, m.registrado_por, u.nome AS registrado_por_nome, m.registrado_em
       FROM garantias_movimentos m LEFT JOIN usuarios u ON u.id = m.registrado_por
      WHERE m.garantia_id = ANY($1::uuid[])
      ORDER BY m.registrado_em, m.id`,
    [linhas.map((l) => l.id)],
  );
  return linhas.map((l) => {
    const s = situacaoGarantia({
      situacaoRegistro: l.situacao,
      prazoApresentacao: l.prazo_apresentacao,
      validaAte: l.valida_ate,
      vigenciaFimContrato: vigenciaFim,
      saldo: l.saldo,
      valorExigido: l.valor_exigido,
      hoje,
    });
    return {
      id: l.id,
      finalidade: l.finalidade,
      percentual: Number(l.percentual),
      valorBase: l.valor_base,
      baseAnual: l.base_anual,
      valorExigido: l.valor_exigido,
      justificativaPercentual: l.justificativa_percentual,
      grandeVultoEngenharia: l.grande_vulto_engenharia,
      clausulaRetomada: l.clausula_retomada,
      modalidadeExigida: l.modalidade_exigida,
      prazoApresentacao: l.prazo_apresentacao,
      modalidade: l.modalidade,
      valor: l.valor,
      saldo: l.saldo,
      emissor: l.emissor,
      documento: l.documento,
      apresentadaEm: l.apresentada_em,
      validaAte: l.valida_ate,
      situacao: s.situacao,
      rotuloSituacao: s.rotulo,
      diasParaVencer: s.diasParaVencer,
      alertas: s.alertas,
      liberadaEm: l.liberada_em,
      valorRestituido: l.valor_restituido,
      movimentos: movimentos
        .filter((m) => m.garantia_id === l.id)
        .map((m) => ({
          id: m.id,
          tipo: m.tipo,
          data: m.data,
          valor: m.valor,
          descricao: m.descricao,
          registradoPor: usuarioResumo(m.registrado_por, m.registrado_por_nome),
          registradoEm: m.registrado_em,
        })),
    };
  });
}

// ───────── multas e descontos ─────────

interface LinhaDesconto {
  id: string;
  sancao_id: string;
  origem: 'pagamento' | 'garantia';
  valor: number;
  pagamento_id: string | null;
  nota_fiscal: string | null;
  garantia_id: string | null;
  autoridade: string;
  ato: string;
  decidida_em: string;
  justificativa: string;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

function mapearDesconto(l: LinhaDesconto): DescontoMulta {
  return {
    id: l.id,
    origem: l.origem,
    valor: l.valor,
    pagamento: l.pagamento_id && l.nota_fiscal ? { id: l.pagamento_id, notaFiscal: l.nota_fiscal } : null,
    garantiaId: l.garantia_id,
    autoridade: l.autoridade,
    ato: l.ato,
    decididaEm: l.decidida_em,
    justificativa: l.justificativa,
    registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
    registradoEm: l.registrado_em,
  };
}

export async function carregarDescontos(executor: Executor, filtro: { contratoId?: string; ids?: string[] }): Promise<DescontoMulta[]> {
  const linhas = await executor.consultar<LinhaDesconto>(
    `SELECT d.id, d.sancao_id, d.origem, d.valor, d.pagamento_id, p.nota_fiscal, d.garantia_id, d.autoridade, d.ato, d.decidida_em,
            d.justificativa, d.registrado_por, u.nome AS registrado_por_nome, d.registrado_em
       FROM multas_descontos d
       LEFT JOIN pagamentos p ON p.id = d.pagamento_id
       LEFT JOIN usuarios u ON u.id = d.registrado_por
      WHERE ($1::uuid IS NULL OR d.contrato_id = $1) AND ($2::uuid[] IS NULL OR d.id = ANY($2::uuid[]))
      ORDER BY d.registrado_em, d.id`,
    [filtro.contratoId ?? null, filtro.ids ?? null],
  );
  return linhas.map(mapearDesconto);
}

export async function carregarMultas(executor: Executor, contratoId: string): Promise<MultaContrato[]> {
  const sancoes = await executor.consultar<{ id: string; inciso_infracao: string; aplicada_em: string | null; valor_multa: number }>(
    `SELECT id, inciso_infracao, aplicada_em, valor_multa
       FROM sancoes
      WHERE contrato_id = $1 AND tipo = 'multa' AND situacao = 'aplicada' AND valor_multa IS NOT NULL AND valor_multa > 0
      ORDER BY aplicada_em NULLS LAST, id`,
    [contratoId],
  );
  if (sancoes.length === 0) return [];
  const linhas = await executor.consultar<LinhaDesconto>(
    `SELECT d.id, d.sancao_id, d.origem, d.valor, d.pagamento_id, p.nota_fiscal, d.garantia_id, d.autoridade, d.ato, d.decidida_em,
            d.justificativa, d.registrado_por, u.nome AS registrado_por_nome, d.registrado_em
       FROM multas_descontos d
       LEFT JOIN pagamentos p ON p.id = d.pagamento_id
       LEFT JOIN usuarios u ON u.id = d.registrado_por
      WHERE d.sancao_id = ANY($1::uuid[])
      ORDER BY d.registrado_em, d.id`,
    [sancoes.map((s) => s.id)],
  );
  return sancoes.map((s) => {
    const descontos = linhas.filter((d) => d.sancao_id === s.id).map(mapearDesconto);
    const descontado = descontos.reduce((t, d) => t + d.valor, 0);
    return {
      sancaoId: s.id,
      incisoInfracao: s.inciso_infracao,
      aplicadaEm: s.aplicada_em,
      valorMulta: s.valor_multa,
      descontado,
      saldo: Math.max(0, s.valor_multa - descontado),
      descontos,
    };
  });
}

// ───────── notas fiscais ─────────

/** Pagamentos devidos à contratada (atestados ou liquidados e não pagos), com o valor ainda livre de retenção. */
export async function pagamentosDevidos(executor: Executor, contratoId: string): Promise<{ pagamentoId: string; notaFiscal: string; disponivel: number }[]> {
  const linhas = await executor.consultar<{ id: string; nota_fiscal: string; disponivel: number }>(
    `SELECT p.id, p.nota_fiscal, (p.valor - COALESCE(SUM(d.valor), 0))::bigint AS disponivel
       FROM pagamentos p
       LEFT JOIN multas_descontos d ON d.pagamento_id = p.id
      WHERE p.contrato_id = $1 AND p.situacao IN ('atestado', 'liquidado')
      GROUP BY p.id, p.nota_fiscal, p.valor, p.vencimento, p.criado_em
      HAVING p.valor - COALESCE(SUM(d.valor), 0) > 0
      ORDER BY p.vencimento, p.criado_em, p.nota_fiscal`,
    [contratoId],
  );
  return linhas.map((l) => ({ pagamentoId: l.id, notaFiscal: l.nota_fiscal, disponivel: l.disponivel }));
}

async function notasDisponiveis(executor: Executor, contratoId: string, hoje: string): Promise<ExecucaoContrato['notasDisponiveis']> {
  const linhas = await executor.consultar<{ id: string; nota_fiscal: string; competencia: string; valor: number; vencimento: string }>(
    `SELECT p.id, p.nota_fiscal, p.competencia, p.valor, p.vencimento
       FROM pagamentos p
      WHERE p.contrato_id = $1 AND p.situacao = 'previsto'
        AND NOT EXISTS (SELECT 1 FROM contratos_recebimentos r WHERE r.pagamento_id = p.id)
      ORDER BY p.vencimento, p.nota_fiscal`,
    [contratoId],
  );
  return linhas.map((l) => ({
    pagamentoId: l.id,
    notaFiscal: l.nota_fiscal,
    competencia: l.competencia,
    valor: l.valor,
    situacao: situacaoExibida('previsto', l.vencimento, hoje),
  }));
}

/** Monta o que as abas Fiscalização, Recebimentos e Garantias do contrato exibem. */
export async function montarExecucao(executor: Executor, contrato: ContratoExecucao, usuarioId: string, hoje: string): Promise<ExecucaoContrato> {
  const parametros = await carregarParametros(executor, contrato.id);
  const designacoes = await carregarDesignacoes(executor, contrato.id);
  const ativas = designacoesAtivas(designacoes, hoje);
  const equipe = verificarDesignacoesContrato(ativas.map((d) => ({ papel: d.papel, usuarioId: d.usuario.id, nome: d.usuario.nome, substituto: d.substituto })));
  const continuo = contrato.vigencia_fim > contrato.vigencia_inicio && Date.parse(contrato.vigencia_fim) - Date.parse(contrato.vigencia_inicio) > 366 * 86_400_000;
  return {
    contratoId: contrato.id,
    parametros,
    ordensServico: await carregarOrdensServico(executor, contrato.id),
    reservasCargos: await carregarReservasCargos(executor, contrato.id),
    designacoes,
    equipe: { completa: equipe.completa, temFiscal: equipe.temFiscal, faltantes: equipe.faltantes },
    ocorrencias: await carregarOcorrencias(executor, contrato.id),
    recebimentos: await carregarRecebimentos(executor, contrato.id, hoje, parametros?.garantiaObjetoMeses ?? 0),
    garantias: await carregarGarantias(executor, contrato.id, contrato.vigencia_fim, hoje),
    multas: await carregarMultas(executor, contrato.id),
    notasDisponiveis: await notasDisponiveis(executor, contrato.id, hoje),
    pagamentosDevidos: await pagamentosDevidos(executor, contrato.id),
    meusPapeis: [...new Set(ativas.filter((d) => d.usuario.id === usuarioId).map((d) => d.papel))],
    baseGarantia: baseCalculoGarantia({
      valorInicial: contrato.valor_inicial,
      vigenciaInicio: contrato.vigencia_inicio,
      vigenciaFim: contrato.vigencia_fim,
      continuo,
    }),
  };
}

export function fornecedorDoContrato(c: ContratoExecucao): string {
  return nomeExibivel(c.tipo_pessoa, c.fornecedor_nome);
}

/** IPCA mensal gravado no servidor (integração de índices, frente I), para a caução em dinheiro. */
export async function variacoesIpca(executor: Executor): Promise<VariacaoMensalIndice[]> {
  const linhas = await executor.consultar<{ competencia: string; valor: number }>(
    `SELECT competencia, valor FROM indices_economicos WHERE serie = 'IPCA' ORDER BY competencia`,
  );
  return linhas.map((l) => ({ competencia: l.competencia, percentual: Number(l.valor) }));
}
