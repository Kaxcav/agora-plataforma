/**
 * IMR do contrato e conferência da nota fiscal (F7: RF-29 e RN-36; Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117,
 * 140 e 141). Carrega indicadores, medições e conferências; calcula a conferência com `conferirNotaFiscal` e decide se
 * o atesto está liberado. Os cálculos ficam no domínio (@agora/dominio); aqui só há leitura, montagem e gravação.
 */
import {
  adicionarDiasUteis,
  conferirNotaFiscal,
  medicaoImrDevida,
  rotuloCompetencia,
  type GlosaImrConferencia,
  type IndicadorImr,
  type ResultadoConferenciaNota,
} from '@agora/dominio';
import type {
  CompetenciaImr,
  ConferenciaNotaFiscal,
  ContextoConferenciaNota,
  EntradaConferenciaNota,
  FaixaAjusteImr,
  ImrContrato,
  IndicadorImrContrato,
  MedicaoImr,
  Pagamento,
  RecebimentoDefinitivoConferencia,
  SituacaoConferenciaNota,
} from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, normalizarBusca } from '../../compartilhado/texto.ts';
import { regraNegocio } from '../../http/erros.ts';

export const FUNDAMENTO_IMR = 'Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A';
const AVISO_IMR =
  'A glosa ajusta o pagamento ao resultado medido e não é sanção. Quando a faixa prevê processo sancionatório, a Ágora só abre a pendência para o gestor avaliar o encaminhamento: a decisão é da autoridade competente.';
const MAXIMO_COMPETENCIAS = 24;
/** Dias úteis para o gestor avaliar o encaminhamento sancionatório e para a fiscalização registrar a medição. */
const DIAS_UTEIS_ENCAMINHAMENTO = 10;
const DIAS_UTEIS_MEDICAO = 5;

// ───────────────────────── competências ─────────────────────────

export function competenciaDe(data: string): string {
  return data.slice(0, 7);
}

export function somarMesesCompetencia(competencia: string, n: number): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const total = ano * 12 + (mes - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Último dia do mês da competência (AAAA-MM-DD). */
function fimDaCompetencia(competencia: string): string {
  const proxima = somarMesesCompetencia(competencia, 1);
  const data = new Date(`${proxima}-01T12:00:00.000Z`);
  data.setUTCDate(0);
  return data.toISOString().slice(0, 10);
}

// ───────────────────────── indicadores ─────────────────────────

export interface LinhaIndicador {
  id: string;
  contrato_id: string;
  codigo: string;
  nome: string;
  forma_calculo: IndicadorImr['formaCalculo'];
  descricao_calculo: string;
  rotulo_numerador: string | null;
  rotulo_denominador: string | null;
  unidade: string;
  sentido_meta: IndicadorImr['sentidoMeta'];
  meta: number;
  periodicidade: IndicadorImr['periodicidade'];
  inicio_competencia: string;
  fonte_medicao: string;
  itens_alcancados: string[];
  faixas: FaixaAjusteImr[];
  teto_percentual: number | null;
  situacao: 'ativo' | 'encerrado';
  encerrado_apos: string | null;
  justificativa_encerramento: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  medicoes: number;
}

const SELECAO_INDICADOR = `
  SELECT i.id, i.contrato_id, i.codigo, i.nome, i.forma_calculo, i.descricao_calculo, i.rotulo_numerador, i.rotulo_denominador,
         i.unidade, i.sentido_meta, i.meta, i.periodicidade, i.inicio_competencia, i.fonte_medicao,
         to_jsonb(i.itens_alcancados::text[]) AS itens_alcancados, i.faixas, i.teto_percentual, i.situacao, i.encerrado_apos,
         i.justificativa_encerramento, i.criado_por, u.nome AS criado_por_nome, i.criado_em,
         (SELECT COUNT(*)::integer FROM imr_medicoes m WHERE m.indicador_id = i.id) AS medicoes
    FROM imr_indicadores i
    LEFT JOIN usuarios u ON u.id = i.criado_por`;

export async function indicadoresDoContrato(executor: Executor, contratoId: string): Promise<LinhaIndicador[]> {
  return executor.consultar<LinhaIndicador>(`${SELECAO_INDICADOR} WHERE i.contrato_id = $1 ORDER BY i.codigo`, [contratoId]);
}

export async function indicadorDoContrato(executor: Executor, contratoId: string, indicadorId: string): Promise<LinhaIndicador | null> {
  const [linha] = await executor.consultar<LinhaIndicador>(`${SELECAO_INDICADOR} WHERE i.contrato_id = $1 AND i.id = $2`, [contratoId, indicadorId]);
  return linha ?? null;
}

/** Indicador no formato do domínio. */
export function indicadorDominio(l: LinhaIndicador): IndicadorImr {
  return {
    codigo: l.codigo,
    nome: l.nome,
    formaCalculo: l.forma_calculo,
    unidade: l.unidade,
    sentidoMeta: l.sentido_meta,
    meta: Number(l.meta),
    periodicidade: l.periodicidade,
    inicioCompetencia: l.inicio_competencia,
    faixas: l.faixas,
    tetoPercentual: l.teto_percentual === null ? null : Number(l.teto_percentual),
  };
}

/** O indicador vale nesta competência (já começou e não foi encerrado antes dela) e a medição é devida. */
export function devidoNaCompetencia(l: LinhaIndicador, competencia: string): boolean {
  if (l.encerrado_apos !== null && competencia > l.encerrado_apos) return false;
  return medicaoImrDevida({ inicioCompetencia: l.inicio_competencia, periodicidade: l.periodicidade }, competencia);
}

function mapearIndicador(l: LinhaIndicador, itens: Map<string, { id: string; numero: number; descricao: string }>): IndicadorImrContrato {
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    formaCalculo: l.forma_calculo,
    descricaoCalculo: l.descricao_calculo,
    rotuloNumerador: l.rotulo_numerador,
    rotuloDenominador: l.rotulo_denominador,
    unidade: l.unidade,
    sentidoMeta: l.sentido_meta,
    meta: Number(l.meta),
    periodicidade: l.periodicidade,
    inicioCompetencia: l.inicio_competencia,
    fonteMedicao: l.fonte_medicao,
    itensAlcancados: l.itens_alcancados.map((id) => itens.get(id)).filter((i): i is { id: string; numero: number; descricao: string } => i !== undefined),
    faixas: l.faixas,
    tetoPercentual: l.teto_percentual === null ? null : Number(l.teto_percentual),
    situacao: l.situacao,
    encerradoApos: l.encerrado_apos,
    justificativaEncerramento: l.justificativa_encerramento,
    temMedicoes: l.medicoes > 0,
    criadoPor: usuarioResumo(l.criado_por, l.criado_por_nome),
    criadoEm: l.criado_em,
  };
}

// ───────────────────────── medições ─────────────────────────

interface LinhaMedicao {
  id: string;
  indicador_id: string;
  codigo: string;
  nome: string;
  unidade: string;
  competencia: string;
  numerador: number | null;
  denominador: number | null;
  valor_informado: number | null;
  resultado: number;
  atingiu_meta: boolean;
  faixa: number | null;
  percentual_glosa: number;
  encaminhar_sancionatorio: boolean;
  memoria_calculo: string[];
  evidencia: string;
  referencia_evidencia: string | null;
  observacao: string | null;
  pendencia_id: string | null;
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
}

const SELECAO_MEDICAO = `
  SELECT m.id, m.indicador_id, i.codigo, i.nome, i.unidade, m.competencia, m.numerador, m.denominador, m.valor_informado, m.resultado,
         m.atingiu_meta, m.faixa, m.percentual_glosa, m.encaminhar_sancionatorio, m.memoria_calculo, m.evidencia, m.referencia_evidencia,
         m.observacao, m.pendencia_id, m.registrada_por, u.nome AS registrada_por_nome, m.registrada_em
    FROM imr_medicoes m
    JOIN imr_indicadores i ON i.id = m.indicador_id
    LEFT JOIN usuarios u ON u.id = m.registrada_por`;

const numeroOuNulo = (v: number | null): number | null => (v === null ? null : Number(v));

function mapearMedicao(l: LinhaMedicao): MedicaoImr {
  return {
    id: l.id,
    indicador: { id: l.indicador_id, codigo: l.codigo, nome: l.nome, unidade: l.unidade },
    competencia: l.competencia,
    numerador: numeroOuNulo(l.numerador),
    denominador: numeroOuNulo(l.denominador),
    valorInformado: numeroOuNulo(l.valor_informado),
    resultado: Number(l.resultado),
    atingiuMeta: l.atingiu_meta,
    faixa: l.faixa,
    percentualGlosa: Number(l.percentual_glosa),
    encaminharSancionatorio: l.encaminhar_sancionatorio,
    memoriaCalculo: l.memoria_calculo,
    evidencia: l.evidencia,
    referenciaEvidencia: l.referencia_evidencia,
    observacao: l.observacao,
    pendenciaId: l.pendencia_id,
    registradaPor: usuarioResumo(l.registrada_por, l.registrada_por_nome),
    registradaEm: l.registrada_em,
  };
}

export async function obterMedicao(executor: Executor, id: string): Promise<MedicaoImr | null> {
  const [linha] = await executor.consultar<LinhaMedicao>(`${SELECAO_MEDICAO} WHERE m.id = $1`, [id]);
  return linha ? mapearMedicao(linha) : null;
}

/** Glosas medidas e medições pendentes de uma competência do contrato (base da conferência da nota). */
export async function imrDaCompetencia(
  executor: Executor,
  contratoId: string,
  competencia: string,
): Promise<{ temImr: boolean; glosas: GlosaImrConferencia[]; pendentes: { codigo: string; nome: string }[] }> {
  const indicadores = await indicadoresDoContrato(executor, contratoId);
  const medicoes = await executor.consultar<{ indicador_id: string; percentual_glosa: number }>(
    'SELECT indicador_id, percentual_glosa FROM imr_medicoes WHERE contrato_id = $1 AND competencia = $2',
    [contratoId, competencia],
  );
  const porIndicador = new Map(medicoes.map((m) => [m.indicador_id, Number(m.percentual_glosa)]));
  const vigentes = indicadores.filter((i) => i.inicio_competencia <= competencia && (i.encerrado_apos === null || competencia <= i.encerrado_apos));
  const glosas: GlosaImrConferencia[] = [];
  const pendentes: { codigo: string; nome: string }[] = [];
  for (const i of indicadores) {
    const percentual = porIndicador.get(i.id);
    if (percentual !== undefined) {
      if (percentual > 0) glosas.push({ codigo: i.codigo, nome: i.nome, percentual, itensAlcancados: i.itens_alcancados });
    } else if (devidoNaCompetencia(i, competencia)) {
      pendentes.push({ codigo: i.codigo, nome: i.nome });
    }
  }
  return { temImr: vigentes.length > 0, glosas, pendentes };
}

// ───────────────────────── plano de gestão e pendências ─────────────────────────

export function tituloTarefaMedicao(competencia: string): string {
  return `Registrar as medições do IMR — competência ${rotuloCompetencia(competencia)}`;
}

/** Cria, se ainda não existir, a tarefa do plano de gestão para a medição da competência (responsável: o fiscal). */
export async function garantirTarefaMedicao(tx: Transacao, contrato: { id: string; uasg: string; fiscal_id: string | null }, competencia: string): Promise<boolean> {
  const titulo = tituloTarefaMedicao(competencia);
  const [existe] = await tx.consultar<{ id: string }>(
    "SELECT id FROM tarefas WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND titulo = $2 LIMIT 1",
    [contrato.id, titulo],
  );
  if (existe) return false;
  const prazo = adicionarDiasUteis(fimDaCompetencia(competencia), DIAS_UTEIS_MEDICAO, await opcoesCalendario(tx));
  await tx.executar(
    `INSERT INTO tarefas (instrumento_tipo, instrumento_id, uasg, modelo_id, titulo, macrotarefa, prazo, situacao, responsavel_id)
     VALUES ('contrato', $1, $2, NULL, $3, 'Fiscalização mensal', $4, 'pendente', $5)`,
    [contrato.id, contrato.uasg, titulo, prazo, contrato.fiscal_id],
  );
  return true;
}

/** Conclui a tarefa de medição da competência quando todas as medições devidas foram registradas. */
export async function concluirTarefaMedicao(tx: Transacao, contratoId: string, competencia: string, usuarioId: string, agora: string): Promise<string | null> {
  const { pendentes } = await imrDaCompetencia(tx, contratoId, competencia);
  if (pendentes.length > 0) return null;
  const [tarefa] = await tx.consultar<{ id: string }>(
    `UPDATE tarefas SET situacao = 'concluida', concluida_em = $3, concluida_por = $4
      WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND titulo = $2 AND situacao = 'pendente'
      RETURNING id`,
    [contratoId, tituloTarefaMedicao(competencia), agora, usuarioId],
  );
  return tarefa?.id ?? null;
}

/**
 * Faixa com previsão de processo sancionatório: pendência de alta prioridade para o gestor avaliar o encaminhamento.
 * Não instaura processo nem aplica sanção (decisão da autoridade competente, arts. 157 e 158).
 */
export async function abrirPendenciaEncaminhamento(
  tx: Transacao,
  hoje: string,
  contrato: { id: string; numero: string; uasg: string; objeto: string; gestor_id: string | null },
  medicao: { codigo: string; nome: string; competencia: string; faixa: number; resultado: string },
): Promise<string | null> {
  const motivo = `IMR do contrato ${contrato.numero}: a medição do indicador ${medicao.codigo} (${medicao.nome}) da competência ${rotuloCompetencia(medicao.competencia)} ficou em ${medicao.resultado}, na faixa ${medicao.faixa}, que prevê avaliar a abertura de processo sancionatório. A decisão é da autoridade competente, com contraditório e ampla defesa (arts. 157 e 158).`;
  const prazo = adicionarDiasUteis(hoje, DIAS_UTEIS_ENCAMINHAMENTO, await opcoesCalendario(tx));
  const [criada] = await tx.consultar<{ id: string }>(
    `INSERT INTO pendencias (tipo, prioridade, instrumento_tipo, instrumento_id, uasg, motivo, prazo, responsavel_id, busca_normalizada)
     VALUES ('lembrete', 'alta', 'contrato', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [contrato.id, contrato.uasg, motivo, prazo, contrato.gestor_id, normalizarBusca(motivo, contrato.objeto, identificadorInstrumento('contrato', contrato.numero), contrato.uasg)],
  );
  return criada?.id ?? null;
}

// ───────────────────────── conferência da nota fiscal ─────────────────────────

export interface LinhaPagamentoConferencia {
  id: string;
  contrato_id: string;
  contrato_numero: string;
  contrato_objeto: string;
  uasg: string;
  competencia: string;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  nota_fiscal: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
}

/** Pagamento no escopo de UASG da sessão (null fora do escopo). */
export async function pagamentoParaConferencia(executor: Executor, id: string, escopo: string[] | null, travar = false): Promise<LinhaPagamentoConferencia | null> {
  const [linha] = await executor.consultar<LinhaPagamentoConferencia>(
    `SELECT p.id, p.contrato_id, c.numero AS contrato_numero, c.objeto AS contrato_objeto, c.uasg, p.competencia, p.situacao, p.nota_fiscal,
            f.tipo_pessoa, f.razao_social
       FROM pagamentos p
       JOIN contratos c ON c.id = p.contrato_id
       JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE p.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))${travar ? ' FOR UPDATE OF p' : ''}`,
    [id, escopo],
  );
  return linha ?? null;
}

interface ItemNotaArmazenado {
  itemContratoId: string;
  quantidadeRecebida: number;
  quantidadeFaturada: number;
  valorUnitarioFaturado: number;
}

interface LinhaConferencia {
  id: string;
  pagamento_id: string;
  contrato_id: string;
  competencia: string;
  numero_nota: string;
  emitida_em: string;
  valor_nota: number;
  itens: ItemNotaArmazenado[];
  valor_bruto: number;
  glosas: ConferenciaNotaFiscal['glosas'];
  glosa_imr: number;
  valor_devido: number;
  diferenca: number;
  valor_a_liquidar: number;
  divergencias: ConferenciaNotaFiscal['divergencias'];
  memoria_calculo: string[];
  situacao: SituacaoConferenciaNota;
  justificativa: string | null;
  justificada_por: string | null;
  justificada_por_nome: string | null;
  justificada_em: string | null;
  versao: number;
  conferida_por: string | null;
  conferida_por_nome: string | null;
  conferida_em: string;
}

const SELECAO_CONFERENCIA = `
  SELECT cf.id, cf.pagamento_id, cf.contrato_id, cf.competencia, cf.numero_nota, cf.emitida_em, cf.valor_nota, cf.itens, cf.valor_bruto,
         cf.glosas, cf.glosa_imr, cf.valor_devido, cf.diferenca, cf.valor_a_liquidar, cf.divergencias, cf.memoria_calculo, cf.situacao,
         cf.justificativa, cf.justificada_por, uj.nome AS justificada_por_nome, cf.justificada_em, cf.versao, cf.conferida_por,
         uc.nome AS conferida_por_nome, cf.conferida_em
    FROM conferencias_nota_fiscal cf
    LEFT JOIN usuarios uj ON uj.id = cf.justificada_por
    LEFT JOIN usuarios uc ON uc.id = cf.conferida_por`;

async function conferenciaDoPagamento(executor: Executor, pagamentoId: string): Promise<LinhaConferencia | null> {
  const [linha] = await executor.consultar<LinhaConferencia>(`${SELECAO_CONFERENCIA} WHERE cf.pagamento_id = $1`, [pagamentoId]);
  return linha ?? null;
}

const AVISO_CONFORME =
  'Nota conforme: o valor cobrado é igual ao valor devido. O atesto continua sendo ato do fiscal, com a verificação da regularidade do contratado.';
const AVISO_DIVERGENTE = 'Há divergência: corrija a nota ou registre a justificativa antes do atesto. A justificativa e a glosa ficam na trilha de auditoria.';
const AVISO_JUSTIFICADA = 'Divergência justificada: o atesto está liberado e o pagamento será liquidado pelo valor a liquidar (o menor entre a nota e o devido).';

function mapearConferencia(l: LinhaConferencia, itensContrato: Map<string, { numero: number; descricao: string; valorUnitario: number }>): ConferenciaNotaFiscal {
  return {
    id: l.id,
    pagamentoId: l.pagamento_id,
    competencia: l.competencia,
    numeroNota: l.numero_nota,
    emitidaEm: l.emitida_em,
    valorNota: l.valor_nota,
    itens: l.itens.map((i) => {
      const item = itensContrato.get(i.itemContratoId);
      const valorUnitarioContratado = item?.valorUnitario ?? 0;
      return {
        itemContratoId: i.itemContratoId,
        numero: item?.numero ?? 0,
        descricao: item?.descricao ?? 'Item do contrato',
        quantidadeRecebida: i.quantidadeRecebida,
        quantidadeFaturada: i.quantidadeFaturada,
        valorUnitarioContratado,
        valorUnitarioFaturado: i.valorUnitarioFaturado,
        valorDevido: valorUnitarioContratado * i.quantidadeRecebida,
        valorFaturado: i.valorUnitarioFaturado * i.quantidadeFaturada,
      };
    }),
    valorBruto: l.valor_bruto,
    glosas: l.glosas,
    glosaImr: l.glosa_imr,
    valorDevido: l.valor_devido,
    diferenca: l.diferenca,
    valorALiquidar: l.valor_a_liquidar,
    divergencias: l.divergencias,
    situacao: l.situacao,
    justificativa: l.justificativa,
    justificadaPor: usuarioResumo(l.justificada_por, l.justificada_por_nome),
    justificadaEm: l.justificada_em,
    memoriaCalculo: l.memoria_calculo,
    fundamento: FUNDAMENTO_IMR,
    aviso: l.situacao === 'conforme' ? AVISO_CONFORME : l.situacao === 'justificada' ? AVISO_JUSTIFICADA : AVISO_DIVERGENTE,
    versao: l.versao,
    conferidaPor: usuarioResumo(l.conferida_por, l.conferida_por_nome),
    conferidaEm: l.conferida_em,
  };
}

interface LinhaItemContrato {
  id: string;
  numero: number;
  descricao: string;
  unidade_fornecimento: string;
  quantidade: number;
  valor_unitario: number;
}

async function itensDoContrato(executor: Executor, contratoId: string): Promise<LinhaItemContrato[]> {
  return executor.consultar<LinhaItemContrato>(
    'SELECT id, numero, descricao, unidade_fornecimento, quantidade, valor_unitario FROM itens_contrato WHERE contrato_id = $1 ORDER BY numero',
    [contratoId],
  );
}

/** Saldo de cada item: quantidade contratada menos a recebida nas notas conferidas de outros pagamentos do contrato. */
async function saldosDosItens(executor: Executor, contratoId: string, pagamentoId: string, itens: readonly LinhaItemContrato[]): Promise<Map<string, number>> {
  const outras = await executor.consultar<{ itens: ItemNotaArmazenado[] }>(
    'SELECT itens FROM conferencias_nota_fiscal WHERE contrato_id = $1 AND pagamento_id <> $2',
    [contratoId, pagamentoId],
  );
  const recebido = new Map<string, number>();
  for (const c of outras) for (const i of c.itens) recebido.set(i.itemContratoId, (recebido.get(i.itemContratoId) ?? 0) + i.quantidadeRecebida);
  return new Map(itens.map((i) => [i.id, Math.max(0, i.quantidade - (recebido.get(i.id) ?? 0))]));
}

/** Calcula a conferência (RN-36) de uma nota para o pagamento, sem gravar. */
export async function calcularConferencia(
  executor: Executor,
  pagamento: Pick<LinhaPagamentoConferencia, 'id' | 'contrato_id' | 'competencia'>,
  nota: Pick<EntradaConferenciaNota, 'valorNota' | 'itens'>,
): Promise<ResultadoConferenciaNota> {
  const itens = await itensDoContrato(executor, pagamento.contrato_id);
  const saldos = await saldosDosItens(executor, pagamento.contrato_id, pagamento.id, itens);
  const imr = await imrDaCompetencia(executor, pagamento.contrato_id, pagamento.competencia);
  return conferirNotaFiscal({
    valorNota: nota.valorNota,
    itensContrato: itens.map((i) => ({ id: i.id, numero: i.numero, descricao: i.descricao, valorUnitario: i.valor_unitario, saldoQuantidade: saldos.get(i.id) ?? 0 })),
    itensNota: nota.itens.map((i) => ({ ...i, itemContratoId: i.itemContratoId.toLowerCase() })),
    glosasImr: imr.glosas,
    medicoesPendentes: imr.pendentes,
  });
}

/** Grava (ou corrige) a conferência do pagamento, com a versão incrementada na correção. Devolve a situação gravada. */
export async function gravarConferencia(
  tx: Transacao,
  e: {
    pagamento: LinhaPagamentoConferencia;
    nota: EntradaConferenciaNota;
    resultado: ResultadoConferenciaNota;
    usuarioId: string | null;
    agora: string;
  },
): Promise<{ id: string; situacao: SituacaoConferenciaNota; versao: number; anterior: { valorNota: number; valorDevido: number; situacao: SituacaoConferenciaNota } | null }> {
  const { pagamento, nota, resultado } = e;
  const anterior = await conferenciaDoPagamento(tx, pagamento.id);
  const situacao: SituacaoConferenciaNota = resultado.conforme ? 'conforme' : 'divergente';
  const itens: ItemNotaArmazenado[] = resultado.itens.map((i) => ({
    itemContratoId: i.itemContratoId,
    quantidadeRecebida: i.quantidadeRecebida,
    quantidadeFaturada: i.quantidadeFaturada,
    valorUnitarioFaturado: i.valorUnitarioFaturado,
  }));
  const valores = [
    pagamento.competencia,
    nota.numeroNota,
    nota.emitidaEm,
    nota.valorNota,
    JSON.stringify(itens),
    resultado.valorBruto,
    JSON.stringify(resultado.glosas),
    resultado.glosaImr,
    resultado.valorDevido,
    resultado.diferenca,
    resultado.valorALiquidar,
    JSON.stringify(resultado.divergencias),
    JSON.stringify(resultado.memoriaCalculo),
    situacao,
    e.usuarioId,
    e.agora,
  ] as const;
  let id: string;
  let versao: number;
  if (anterior) {
    const [linha] = await tx.consultar<{ id: string; versao: number }>(
      `UPDATE conferencias_nota_fiscal
          SET competencia = $2, numero_nota = $3, emitida_em = $4, valor_nota = $5, itens = $6::jsonb, valor_bruto = $7, glosas = $8::jsonb,
              glosa_imr = $9, valor_devido = $10, diferenca = $11, valor_a_liquidar = $12, divergencias = $13::jsonb, memoria_calculo = $14::jsonb,
              situacao = $15, justificativa = NULL, justificada_por = NULL, justificada_em = NULL, conferida_por = $16, conferida_em = $17,
              versao = versao + 1
        WHERE id = $1
        RETURNING id, versao`,
      [anterior.id, ...valores],
    );
    id = linha?.id ?? anterior.id;
    versao = linha?.versao ?? anterior.versao + 1;
  } else {
    const [linha] = await tx.consultar<{ id: string; versao: number }>(
      `INSERT INTO conferencias_nota_fiscal (pagamento_id, contrato_id, competencia, numero_nota, emitida_em, valor_nota, itens, valor_bruto, glosas,
                                             glosa_imr, valor_devido, diferenca, valor_a_liquidar, divergencias, memoria_calculo, situacao,
                                             conferida_por, conferida_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18)
       RETURNING id, versao`,
      [pagamento.id, pagamento.contrato_id, ...valores],
    );
    if (!linha) throw new Error('Falha ao gravar a conferência da nota fiscal.');
    id = linha.id;
    versao = linha.versao;
  }
  // A nota conferida passa a identificar a parcela na fila de pagamentos e na busca.
  await tx.executar('UPDATE pagamentos SET nota_fiscal = $2, busca_normalizada = $3 WHERE id = $1', [
    pagamento.id,
    nota.numeroNota,
    normalizarBusca(nota.numeroNota, pagamento.contrato_numero, pagamento.competencia, pagamento.tipo_pessoa === 'PJ' ? pagamento.razao_social : ''),
  ]);
  return {
    id,
    situacao,
    versao,
    anterior: anterior ? { valorNota: anterior.valor_nota, valorDevido: anterior.valor_devido, situacao: anterior.situacao } : null,
  };
}

/**
 * Nova medição na competência: recalcula as conferências de notas ainda não atestadas dessa competência. Se o valor
 * devido ou as divergências mudaram, a justificativa anterior deixa de valer e a nota volta a ser conferida.
 */
export async function recalcularConferenciasDaCompetencia(
  tx: Transacao,
  contratoId: string,
  competencia: string,
): Promise<{ pagamentoId: string; situacao: SituacaoConferenciaNota; valorDevido: number; anterior: number }[]> {
  const linhas = await tx.consultar<LinhaConferencia & { situacao_pagamento: string }>(
    `${SELECAO_CONFERENCIA.replace('FROM conferencias_nota_fiscal cf', 'FROM conferencias_nota_fiscal cf JOIN pagamentos p ON p.id = cf.pagamento_id')}
      WHERE cf.contrato_id = $1 AND cf.competencia = $2 AND p.situacao = 'previsto'`,
    [contratoId, competencia],
  );
  const alteradas: { pagamentoId: string; situacao: SituacaoConferenciaNota; valorDevido: number; anterior: number }[] = [];
  for (const c of linhas) {
    const resultado = await calcularConferencia(tx, { id: c.pagamento_id, contrato_id: c.contrato_id, competencia: c.competencia }, { valorNota: c.valor_nota, itens: c.itens });
    const mesmasDivergencias = JSON.stringify(resultado.divergencias) === JSON.stringify(c.divergencias);
    if (resultado.valorDevido === c.valor_devido && resultado.glosaImr === c.glosa_imr && mesmasDivergencias) continue;
    const situacao: SituacaoConferenciaNota = resultado.conforme ? 'conforme' : 'divergente';
    await tx.executar(
      `UPDATE conferencias_nota_fiscal
          SET valor_bruto = $2, glosas = $3::jsonb, glosa_imr = $4, valor_devido = $5, diferenca = $6, valor_a_liquidar = $7, divergencias = $8::jsonb,
              memoria_calculo = $9::jsonb, situacao = $10, justificativa = NULL, justificada_por = NULL, justificada_em = NULL, versao = versao + 1
        WHERE id = $1`,
      [
        c.id,
        resultado.valorBruto,
        JSON.stringify(resultado.glosas),
        resultado.glosaImr,
        resultado.valorDevido,
        resultado.diferenca,
        resultado.valorALiquidar,
        JSON.stringify(resultado.divergencias),
        JSON.stringify(resultado.memoriaCalculo),
        situacao,
      ],
    );
    alteradas.push({ pagamentoId: c.pagamento_id, situacao, valorDevido: resultado.valorDevido, anterior: c.valor_devido });
  }
  return alteradas;
}

/**
 * O atesto está liberado quanto à conferência da nota (RN-36)? Bloqueia a conferência divergente sem justificativa e,
 * em contrato com IMR vigente na competência, o atesto sem conferência registrada.
 */
export async function situacaoAtestoConferencia(
  executor: Executor,
  pagamento: Pick<LinhaPagamentoConferencia, 'id' | 'contrato_id' | 'competencia'>,
): Promise<{ liberado: boolean; motivo: string | null; temImr: boolean; conferencia: { id: string; situacao: SituacaoConferenciaNota; valorNota: number; valorDevido: number; glosaImr: number; valorALiquidar: number; versao: number; justificativa: string | null } | null }> {
  const imr = await imrDaCompetencia(executor, pagamento.contrato_id, pagamento.competencia);
  const c = await conferenciaDoPagamento(executor, pagamento.id);
  const conferencia = c
    ? { id: c.id, situacao: c.situacao, valorNota: c.valor_nota, valorDevido: c.valor_devido, glosaImr: c.glosa_imr, valorALiquidar: c.valor_a_liquidar, versao: c.versao, justificativa: c.justificativa }
    : null;
  if (c?.situacao === 'divergente') {
    return {
      liberado: false,
      motivo: `A conferência da nota fiscal ${c.numero_nota} tem ${c.divergencias.length} divergência(s) sem justificativa. Corrija a nota ou registre a justificativa antes do atesto (RN-36).`,
      temImr: imr.temImr,
      conferencia,
    };
  }
  if (!c && imr.temImr) {
    return {
      liberado: false,
      motivo: 'O contrato tem instrumento de medição de resultado (IMR): registre a conferência da nota fiscal, com o valor devido e a glosa da competência, antes do atesto (RN-36).',
      temImr: true,
      conferencia,
    };
  }
  return { liberado: true, motivo: null, temImr: imr.temImr, conferencia };
}

/** Trava do atesto (RN-36): 422 com o motivo enquanto a conferência não libera. */
export function exigirConferenciaLiberada(situacao: { liberado: boolean; motivo: string | null }): void {
  if (situacao.liberado) return;
  const motivo = situacao.motivo ?? 'A conferência da nota fiscal não libera o atesto (RN-36).';
  throw regraNegocio(motivo, [{ campo: 'RN-36', mensagem: motivo }]);
}

/** Contexto completo da tela de conferência. */
export async function montarContextoConferencia(
  executor: Executor,
  pagamento: LinhaPagamentoConferencia,
  pagamentoExibido: Pagamento,
): Promise<ContextoConferenciaNota> {
  const itens = await itensDoContrato(executor, pagamento.contrato_id);
  const saldos = await saldosDosItens(executor, pagamento.contrato_id, pagamento.id, itens);
  const imr = await imrDaCompetencia(executor, pagamento.contrato_id, pagamento.competencia);
  const linha = await conferenciaDoPagamento(executor, pagamento.id);
  const atesto = await situacaoAtestoConferencia(executor, pagamento);
  const porId = new Map(itens.map((i) => [i.id, { numero: i.numero, descricao: i.descricao, valorUnitario: i.valor_unitario }]));

  // Só o recebimento ligado a esta parcela pelo agente: aproximar por competência poderia atribuir a entrega errada.
  const [recebimentoDef] = await executor.consultar<{
    id: string;
    numero: number;
    quantidade: number | null;
    itens: Array<{ itemContratoId?: string; quantidade?: number }> | null;
    termo_id: string;
    termo_data: string;
  }>(
    `SELECT r.id, r.numero, r.quantidade, r.itens, t.id AS termo_id, t.data AS termo_data
       FROM contratos_recebimentos r
       JOIN recebimentos_termos t ON t.recebimento_id = r.id AND t.tipo = 'definitivo' AND t.resultado = 'aceito'
      WHERE r.pagamento_id = $1
      ORDER BY t.data DESC, r.numero DESC
      LIMIT 1`,
    [pagamento.id],
  );

  const recebimentoDefinitivo: RecebimentoDefinitivoConferencia | null = recebimentoDef
    ? {
        id: recebimentoDef.id,
        numero: recebimentoDef.numero,
        data: recebimentoDef.termo_data,
        termoId: recebimentoDef.termo_id,
        quantidadeRecebida: recebimentoDef.quantidade ?? 1,
        itens: Array.isArray(recebimentoDef.itens)
          ? recebimentoDef.itens.map((it) => ({ itemContratoId: String(it.itemContratoId ?? ''), quantidadeRecebida: Number(it.quantidade ?? 0) }))
          : undefined,
      }
    : null;

  return {
    pagamento: pagamentoExibido,
    contrato: { id: pagamento.contrato_id, numero: pagamento.contrato_numero, objeto: pagamento.contrato_objeto, temImr: imr.temImr },
    itensContrato: itens.map((i) => ({
      id: i.id,
      numero: i.numero,
      descricao: i.descricao,
      unidade: i.unidade_fornecimento,
      quantidade: i.quantidade,
      valorUnitario: i.valor_unitario,
      saldoQuantidade: saldos.get(i.id) ?? 0,
    })),
    imr: { competencia: pagamento.competencia, glosas: imr.glosas.map((g) => ({ ...g, itensAlcancados: [...g.itensAlcancados] })), pendentes: imr.pendentes },
    conferencia: linha ? mapearConferencia(linha, porId) : null,
    atesto:
      pagamento.situacao === 'previsto'
        ? { liberado: atesto.liberado, motivo: atesto.motivo, parcelaEmAberto: true }
        : { liberado: false, motivo: 'A parcela já foi atestada.', parcelaEmAberto: false },
    recebimentoDefinitivo,
  };
}

// ───────────────────────── IMR do contrato (aba) ─────────────────────────

export interface ContratoImr {
  id: string;
  numero: string;
  uasg: string;
  objeto: string;
  gestor_id: string | null;
  fiscal_id: string | null;
}

export async function montarImrContrato(executor: Executor, contrato: ContratoImr, hoje: string): Promise<ImrContrato> {
  const itens = await itensDoContrato(executor, contrato.id);
  const porId = new Map(itens.map((i) => [i.id, { id: i.id, numero: i.numero, descricao: i.descricao }]));
  const indicadores = await indicadoresDoContrato(executor, contrato.id);
  const medicoes = (await executor.consultar<LinhaMedicao>(`${SELECAO_MEDICAO} WHERE m.contrato_id = $1 ORDER BY m.competencia DESC, i.codigo`, [contrato.id])).map(mapearMedicao);
  const pagamentos = await executor.consultar<{ id: string; competencia: string; nota_fiscal: string; situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago'; valor: number; vencimento: string }>(
    'SELECT id, competencia, nota_fiscal, situacao, valor, vencimento FROM pagamentos WHERE contrato_id = $1 ORDER BY competencia, vencimento',
    [contrato.id],
  );
  const conferencias = await executor.consultar<{ pagamento_id: string; situacao: SituacaoConferenciaNota; valor_devido: number; glosa_imr: number }>(
    'SELECT pagamento_id, situacao, valor_devido, glosa_imr FROM conferencias_nota_fiscal WHERE contrato_id = $1',
    [contrato.id],
  );
  const conferenciaPorPagamento = new Map(conferencias.map((c) => [c.pagamento_id, c]));

  const competencias: CompetenciaImr[] = [];
  if (indicadores.length > 0) {
    const ultimaEncerrada = somarMesesCompetencia(competenciaDe(hoje), -1);
    const inicio = indicadores.map((i) => i.inicio_competencia).sort()[0] ?? ultimaEncerrada;
    for (let c = ultimaEncerrada; c >= inicio && competencias.length < MAXIMO_COMPETENCIAS; c = somarMesesCompetencia(c, -1)) {
      const devidos = indicadores.filter((i) => devidoNaCompetencia(i, c));
      const daCompetencia = medicoes.filter((m) => m.competencia === c);
      if (devidos.length === 0 && daCompetencia.length === 0) continue;
      const medidos = new Set(daCompetencia.map((m) => m.indicador.id));
      const pagamento = pagamentos.find((p) => p.competencia === c) ?? null;
      const conferencia = pagamento ? (conferenciaPorPagamento.get(pagamento.id) ?? null) : null;
      competencias.push({
        competencia: c,
        pendentes: devidos.filter((i) => !medidos.has(i.id)).map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome })),
        medicoes: daCompetencia.length,
        percentualGlosaSomado: Math.round(daCompetencia.reduce((s, m) => s + m.percentualGlosa, 0) * 10_000) / 10_000,
        pagamento: pagamento
          ? {
              id: pagamento.id,
              notaFiscal: pagamento.nota_fiscal,
              situacao: pagamento.situacao !== 'pago' && pagamento.vencimento < hoje ? 'atrasado' : pagamento.situacao,
              valor: pagamento.valor,
            }
          : null,
        conferencia: conferencia ? { situacao: conferencia.situacao, valorDevido: conferencia.valor_devido, glosaImr: conferencia.glosa_imr } : null,
      });
    }
  }
  const naMeta = medicoes.filter((m) => m.atingiuMeta).length;
  return {
    contrato: { id: contrato.id, numero: contrato.numero },
    indicadores: indicadores.map((i) => mapearIndicador(i, porId)),
    medicoes,
    competencias,
    itensContrato: itens.map((i) => ({ id: i.id, numero: i.numero, descricao: i.descricao, unidade: i.unidade_fornecimento })),
    resumo: {
      medicoes: medicoes.length,
      naMeta,
      comGlosa: medicoes.filter((m) => m.percentualGlosa > 0).length,
      percentualNaMeta: medicoes.length === 0 ? null : Math.round((naMeta / medicoes.length) * 1000) / 10,
    },
    fundamento: FUNDAMENTO_IMR,
    aviso: AVISO_IMR,
  };
}
