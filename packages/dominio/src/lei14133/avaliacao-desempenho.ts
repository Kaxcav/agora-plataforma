/**
 * Avaliação de desempenho do contratado e registro cadastral de atestos (RN-37, RF-30).
 *
 * - Documento de avaliação (Lei 14.133/2021, art. 88, § 3º): o contratante avalia a atuação do contratado com
 *   indicadores objetivamente definidos e aferidos e menciona as penalidades aplicadas; o documento passa a constar do
 *   registro cadastral (art. 87). O contratado pode se manifestar antes de a avaliação ficar definitiva.
 * - Registro (art. 88, §§ 3º e 4º): a nota do registro consolida as avaliações definitivas; é ela que entra no
 *   desempate (art. 60, II) e, quando o edital adota e há regulamento, na pontuação técnica (art. 36, § 3º; art. 37, III).
 * - Incentivo (art. 88, § 4º): certificado e declaração emitidos por critério objetivo.
 * Funções puras e determinísticas: "hoje" entra como parâmetro.
 */
import { ErroDominio } from '../erros.ts';
import { adicionarDiasUteis, formatarData, type DataISO, type OpcoesCalendario } from '../datas.ts';
import { adicionarMeses, arredondar, exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';
import { type Centavos, formatarMoeda } from '../moeda.ts';
import { aplicarDesempate, type Licitante } from './desempate.ts';
import { pontuarTecnicaEPreco } from './disputa.ts';
import type { TipoSancao } from './sancoes.ts';
import { calcularIdc, faixaDaNota, type FaixaIdc } from './score.ts';

/** Mínimo de caracteres da avaliação motivada e da análise da manifestação. */
export const MINIMO_MOTIVACAO_AVALIACAO = 50;
/** Prazo para o contratado se manifestar sobre a avaliação (dias úteis a partir da emissão). */
export const PRAZO_MANIFESTACAO_DIAS_UTEIS = 5;
/** Janela do registro: avaliações com período encerrado nos últimos 36 meses (a mesma janela das sanções no IDC). */
export const JANELA_REGISTRO_DESEMPENHO_MESES = 36;
/** Certificado de desempenho: nota do registro igual ou superior a 90 (faixa diamante, "ótimo desempenho"). */
export const NOTA_MINIMA_CERTIFICADO_DESEMPENHO = 90;
/** Validade do certificado e da declaração, se o registro não mudar antes. */
export const VALIDADE_CERTIFICADO_DESEMPENHO_MESES = 12;

const CODIGO = 'AVALIACAO_DESEMPENHO_INVALIDA';
const FUNDAMENTO_AVALIACAO = 'Lei 14.133/2021, art. 88, § 3º (avaliação com indicadores objetivos e penalidades) e art. 87 (registro cadastral)';
const FUNDAMENTO_MANIFESTACAO = 'Lei 9.784/1999, arts. 2º, X, 3º, III, e 24 (direito de manifestação; prazo de 5 dias, contado em dias úteis em favor do contratado)';
const AVISO_AVALIACAO =
  'A avaliação de desempenho não é sanção e não impede a participação em licitações. A nota resulta só dos indicadores aferidos e das penalidades aplicadas no período; a motivação do avaliador explica os fatos, sem alterar a nota.';

export type TipoAvaliacaoDesempenho = 'parcial' | 'final';
export type PapelAvaliador = 'gestor' | 'fiscal';

/** Contagens aferidas no período: entregas e recebimentos (termos de recebimento) e ocorrências da fiscalização. */
export interface IndicadoresAvaliacao {
  entregasNoPrazo: number;
  entregasTotal: number;
  recebimentosAprovados: number;
  recebimentosTotal: number;
  ocorrenciasFiscalizacao: number;
  ocorrenciasResolvidasNoPrazo: number;
}

export interface EntradaAvaliacaoDesempenho {
  tipo: TipoAvaliacaoDesempenho;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  indicadores: IndicadoresAvaliacao;
  /** Sanções aplicadas ao contratado neste contrato (as do período entram na nota). */
  sancoes: readonly { tipo: TipoSancao; dataAplicacao: DataISO }[];
  motivacao: string;
}

export interface ResultadoAvaliacaoDesempenho {
  nota: number;
  faixa: FaixaIdc;
  componentes: { nome: string; valor: number; peso: number; contribuicao: number }[];
  penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[];
  metodologia: string;
  fundamento: string;
  aviso: string;
  prazoManifestacao: DataISO;
  fundamentoManifestacao: string;
}

function exigirParTotal(parte: number, total: number, nomeParte: string, nomeTotal: string): void {
  exigirInteiro(total, nomeTotal, CODIGO, 0);
  exigirInteiro(parte, nomeParte, CODIGO, 0);
  if (parte > total) throw new ErroDominio(CODIGO, `${nomeParte} não pode ser maior que ${nomeTotal}.`);
}

function exigirTexto(texto: unknown, minimo: number, descricao: string, codigo = CODIGO): string {
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (limpo.length < minimo) throw new ErroDominio(codigo, `${descricao} com pelo menos ${minimo} caracteres.`);
  return limpo;
}

/**
 * Calcula a avaliação de desempenho do contratado num período do contrato (etapa ou conclusão), com os mesmos
 * componentes e pesos do IDC (`calcularIdc`): pontualidade das entregas, qualidade dos recebimentos e tratamento das
 * ocorrências, com desconto das sanções aplicadas no período. A nota não é digitada: vem só dos indicadores.
 * Exige período dentro da vigência e não futuro, motivação de ao menos 50 caracteres e ao menos uma entrega ou um
 * recebimento aferido. Devolve também o prazo de manifestação do contratado (5 dias úteis).
 * Fundamento: Lei 14.133/2021, art. 88, § 3º; Lei 9.784/1999, art. 24.
 */
export function avaliarDesempenhoContratado(
  e: EntradaAvaliacaoDesempenho,
  hoje: DataISO,
  calendario?: OpcoesCalendario,
): ResultadoAvaliacaoDesempenho {
  if (e.tipo !== 'parcial' && e.tipo !== 'final') throw new ErroDominio(CODIGO, `Tipo de avaliação inválido: ${String(e.tipo)}.`);
  const dHoje = lerData(hoje, 'hoje');
  const inicio = lerData(e.periodoInicio, 'periodoInicio');
  const fim = lerData(e.periodoFim, 'periodoFim');
  const vigInicio = lerData(e.vigenciaInicio, 'vigenciaInicio');
  const vigFim = lerData(e.vigenciaFim, 'vigenciaFim');
  if (fim < inicio) throw new ErroDominio(CODIGO, 'O fim do período avaliado não pode ser anterior ao início.');
  if (inicio < vigInicio || fim > vigFim) {
    throw new ErroDominio(CODIGO, `O período avaliado deve estar dentro da vigência do contrato (${formatarData(e.vigenciaInicio)} a ${formatarData(e.vigenciaFim)}).`);
  }
  if (fim > dHoje) throw new ErroDominio(CODIGO, 'O período avaliado não pode terminar depois de hoje: só se avalia o que já foi executado.');
  const i = e.indicadores;
  exigirParTotal(i.entregasNoPrazo, i.entregasTotal, 'entregasNoPrazo', 'entregasTotal');
  exigirParTotal(i.recebimentosAprovados, i.recebimentosTotal, 'recebimentosAprovados', 'recebimentosTotal');
  exigirParTotal(i.ocorrenciasResolvidasNoPrazo, i.ocorrenciasFiscalizacao, 'ocorrenciasResolvidasNoPrazo', 'ocorrenciasFiscalizacao');
  if (i.entregasTotal + i.recebimentosTotal === 0) {
    throw new ErroDominio(
      'AVALIACAO_SEM_INDICADORES',
      'Sem entrega nem recebimento aferido no período não há indicador objetivo para avaliar (art. 88, § 3º). Escolha um período com execução.',
    );
  }
  exigirTexto(e.motivacao, MINIMO_MOTIVACAO_AVALIACAO, 'Registre a avaliação motivada');
  if (!Array.isArray(e.sancoes)) throw new ErroDominio(CODIGO, 'sancoes deve ser uma lista.');
  const sancoesNoPeriodo = e.sancoes.filter((s) => {
    const d = lerData(s.dataAplicacao, 'dataAplicacao');
    return d >= inicio && d <= fim;
  });

  const idc = calcularIdc({ ...i, sancoes: sancoesNoPeriodo }, e.periodoFim);
  const periodo = `${formatarData(e.periodoInicio)} a ${formatarData(e.periodoFim)}`;
  const metodologia = [
    `Avaliação ${e.tipo === 'final' ? 'final (conclusão do contrato)' : 'parcial (etapa da execução)'} do período de ${periodo}.`,
    idc.metodologia,
    'Só entram as sanções aplicadas neste contrato dentro do período avaliado.',
  ].join(' ');
  return {
    nota: idc.nota,
    faixa: idc.faixa,
    componentes: idc.componentes,
    penalidades: idc.penalidades,
    metodologia,
    fundamento: FUNDAMENTO_AVALIACAO,
    aviso: AVISO_AVALIACAO,
    prazoManifestacao: adicionarDiasUteis(hoje, PRAZO_MANIFESTACAO_DIAS_UTEIS, calendario),
    fundamentoManifestacao: FUNDAMENTO_MANIFESTACAO,
  };
}

export type SituacaoAvaliacaoDesempenho = 'em_manifestacao' | 'manifestada' | 'definitiva';

/**
 * Situação da avaliação: em prazo de manifestação, manifestada (o contratado discordou e o avaliador ainda não
 * analisou) ou definitiva (análise registrada, concordância do contratado ou prazo decorrido sem manifestação).
 * Só a avaliação definitiva entra na nota do registro. Fundamento: art. 88, § 3º; Lei 9.784/1999, art. 24.
 */
export function situacaoAvaliacaoDesempenho(
  a: { prazoManifestacao: DataISO; manifestacao: { concorda: boolean } | null; analise: { decisao: 'mantida' | 'revista' } | null },
  hoje: DataISO,
): { situacao: SituacaoAvaliacaoDesempenho; definitiva: boolean; explicacao: string } {
  const prazo = lerData(a.prazoManifestacao, 'prazoManifestacao');
  const dHoje = lerData(hoje, 'hoje');
  if (a.analise) {
    return {
      situacao: 'definitiva',
      definitiva: true,
      explicacao: `Definitiva: o avaliador analisou a manifestação do contratado e ${a.analise.decisao === 'revista' ? 'revisou a avaliação' : 'manteve a avaliação'}.`,
    };
  }
  if (a.manifestacao?.concorda === true) {
    return { situacao: 'definitiva', definitiva: true, explicacao: 'Definitiva: o contratado declarou ciência e concordou com a avaliação.' };
  }
  if (a.manifestacao) {
    return { situacao: 'manifestada', definitiva: false, explicacao: 'O contratado discordou da avaliação: o avaliador deve analisar a manifestação, mantendo ou revisando a avaliação com motivação.' };
  }
  if (dHoje > prazo) {
    return { situacao: 'definitiva', definitiva: true, explicacao: `Definitiva: o prazo de manifestação terminou em ${formatarData(a.prazoManifestacao)} sem manifestação do contratado.` };
  }
  return {
    situacao: 'em_manifestacao',
    definitiva: false,
    explicacao: `Aguardando a manifestação do contratado até ${formatarData(a.prazoManifestacao)}. Até lá a avaliação não entra na nota do registro.`,
  };
}

/**
 * Confere a manifestação do contratado (recebida por SEI, e-mail ou ofício e registrada pelo gestor ou fiscal):
 * data de recebimento entre a emissão e hoje e dentro do prazo, e texto com ao menos 10 caracteres.
 * Fundamento: Lei 9.784/1999, arts. 3º, III, e 24.
 */
export function validarManifestacaoContratado(
  m: { texto: string; recebidaEm: DataISO; concorda: boolean },
  a: { dataEmissao: DataISO; prazoManifestacao: DataISO },
  hoje: DataISO,
): { texto: string; tempestiva: true } {
  const recebida = lerData(m.recebidaEm, 'recebidaEm');
  if (recebida < lerData(a.dataEmissao, 'dataEmissao')) throw new ErroDominio('MANIFESTACAO_INVALIDA', 'A manifestação não pode ser anterior à emissão da avaliação.');
  if (recebida > lerData(hoje, 'hoje')) throw new ErroDominio('MANIFESTACAO_INVALIDA', 'A data de recebimento da manifestação não pode ser futura.');
  if (recebida > lerData(a.prazoManifestacao, 'prazoManifestacao')) {
    throw new ErroDominio(
      'MANIFESTACAO_FORA_DO_PRAZO',
      `A manifestação foi recebida depois do prazo (${formatarData(a.prazoManifestacao)}): a avaliação já é definitiva. Junte a manifestação ao processo no SEI.`,
    );
  }
  if (typeof m.concorda !== 'boolean') throw new ErroDominio('MANIFESTACAO_INVALIDA', 'Informe se o contratado concorda com a avaliação.');
  return { texto: exigirTexto(m.texto, 10, 'Transcreva a manifestação do contratado', 'MANIFESTACAO_INVALIDA'), tempestiva: true };
}

/** Análise da manifestação pelo avaliador: decisão (mantida ou revista) e motivação de ao menos 50 caracteres. */
export function validarAnaliseManifestacao(a: { decisao: string; motivacao: string }): { decisao: 'mantida' | 'revista'; motivacao: string } {
  if (a.decisao !== 'mantida' && a.decisao !== 'revista') throw new ErroDominio(CODIGO, 'A análise deve manter ou revisar a avaliação.');
  return { decisao: a.decisao, motivacao: exigirTexto(a.motivacao, MINIMO_MOTIVACAO_AVALIACAO, 'Motive a análise da manifestação') };
}

// ───────────────────────── registro cadastral ─────────────────────────

export interface AvaliacaoNoRegistro {
  id: string;
  contratoId: string;
  tipo: TipoAvaliacaoDesempenho;
  periodoFim: DataISO;
  nota: number;
  definitiva: boolean;
  /** Instante de emissão (ISO), para desempate entre avaliações do mesmo período. */
  emitidaEm: string;
}

export interface RegistroDesempenho {
  nota: number | null;
  faixa: FaixaIdc;
  avaliacoesConsideradas: string[];
  contratosConsiderados: number;
  /** Código da versão do registro: muda quando entra, sai ou muda uma avaliação considerada. */
  versaoRegistro: string;
  metodologia: string;
  fundamento: string;
}

/** FNV-1a de 32 bits em hexadecimal: código curto e determinístico da versão do registro. */
function codigoVersao(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Nota do registro cadastral de desempenho do fornecedor: só avaliações definitivas com período encerrado nos últimos
 * 36 meses; por contrato vale a avaliação final ou, sem ela, a parcial mais recente; a nota é a média simples das notas
 * por contrato (1 casa). Sem avaliação considerada: nota nula e faixa "sem histórico" (a ausência não penaliza).
 * Fundamento: Lei 14.133/2021, art. 87 e art. 88, §§ 3º e 4º; art. 60, II.
 */
export function consolidarRegistroDesempenho(avaliacoes: readonly AvaliacaoNoRegistro[], hoje: DataISO): RegistroDesempenho {
  const dHoje = lerData(hoje, 'hoje');
  const corte = lerData(adicionarMeses(hoje, -JANELA_REGISTRO_DESEMPENHO_MESES));
  const porContrato = new Map<string, AvaliacaoNoRegistro>();
  for (const a of avaliacoes) {
    exigirFinito(a.nota, `nota de ${a.id}`, CODIGO);
    if (a.nota < 0 || a.nota > 100) throw new ErroDominio(CODIGO, `nota de ${a.id} fora de 0 a 100.`);
    const fim = lerData(a.periodoFim, 'periodoFim');
    if (!a.definitiva || fim <= corte || fim > dHoje) continue;
    const atual = porContrato.get(a.contratoId);
    const prevalece =
      atual === undefined ||
      (a.tipo === 'final' && atual.tipo !== 'final') ||
      (a.tipo === atual.tipo && (a.periodoFim > atual.periodoFim || (a.periodoFim === atual.periodoFim && a.emitidaEm > atual.emitidaEm)));
    if (prevalece) porContrato.set(a.contratoId, a);
  }
  const consideradas = [...porContrato.values()].sort((x, y) => (x.contratoId < y.contratoId ? -1 : x.contratoId > y.contratoId ? 1 : 0));
  const nota = consideradas.length === 0 ? null : arredondar(consideradas.reduce((s, a) => s + a.nota, 0) / consideradas.length, 1);
  const metodologia = [
    `Avaliações definitivas com período encerrado nos últimos ${JANELA_REGISTRO_DESEMPENHO_MESES} meses até ${formatarData(hoje)}.`,
    'Por contrato vale a avaliação final ou, sem ela, a parcial mais recente; a nota do registro é a média simples das notas por contrato.',
    'Avaliações em prazo de manifestação ou com manifestação pendente de análise ainda não entram.',
  ].join(' ');
  return {
    nota,
    faixa: nota === null ? 'sem_historico' : faixaDaNota(nota),
    avaliacoesConsideradas: consideradas.map((a) => a.id),
    contratosConsiderados: consideradas.length,
    versaoRegistro: codigoVersao(consideradas.map((a) => `${a.id}:${a.nota}`).join('|')),
    metodologia,
    fundamento: 'Lei 14.133/2021, art. 87 e art. 88, §§ 3º e 4º',
  };
}

export type TipoDocumentoIncentivo = 'certificado' | 'declaracao';

/**
 * Critério objetivo do incentivo ao bom desempenho (art. 88, § 4º):
 * - certificado de desempenho: nota do registro de ao menos 90 (faixa diamante), com avaliação definitiva, e sem
 *   impedimento ou inidoneidade vigente;
 * - declaração de desempenho registrado (para uso em licitações): ao menos uma avaliação definitiva no registro.
 * Ambos valem 12 meses, ou até o registro mudar (art. 88, § 2º: renovável sempre que o registro for atualizado).
 */
export function avaliarIncentivoDesempenho(
  registro: Pick<RegistroDesempenho, 'nota' | 'avaliacoesConsideradas'>,
  opcoes: { impedido: boolean },
  tipo: TipoDocumentoIncentivo,
  hoje: DataISO,
): { elegivel: boolean; motivos: string[]; validoAte: DataISO; criterio: string; fundamento: string } {
  if (tipo !== 'certificado' && tipo !== 'declaracao') throw new ErroDominio(CODIGO, `Documento de incentivo inválido: ${String(tipo)}.`);
  lerData(hoje, 'hoje');
  const motivos: string[] = [];
  if (registro.avaliacoesConsideradas.length === 0 || registro.nota === null) {
    motivos.push('O registro não tem avaliação de desempenho definitiva nos últimos 36 meses.');
  }
  if (tipo === 'certificado') {
    if (registro.nota !== null && registro.nota < NOTA_MINIMA_CERTIFICADO_DESEMPENHO) {
      motivos.push(`A nota do registro (${formatarNumero(registro.nota)}) é inferior a ${NOTA_MINIMA_CERTIFICADO_DESEMPENHO}, mínimo do certificado de ótimo desempenho.`);
    }
    if (opcoes.impedido) motivos.push('O fornecedor tem sanção de impedimento ou de inidoneidade vigente.');
  }
  return {
    elegivel: motivos.length === 0,
    motivos,
    validoAte: adicionarMeses(hoje, VALIDADE_CERTIFICADO_DESEMPENHO_MESES),
    criterio:
      tipo === 'certificado'
        ? `Nota do registro igual ou superior a ${NOTA_MINIMA_CERTIFICADO_DESEMPENHO}, com avaliação definitiva, e sem impedimento ou inidoneidade vigente.`
        : 'Ao menos uma avaliação definitiva no registro cadastral de desempenho.',
    fundamento: 'Lei 14.133/2021, art. 88, §§ 2º e 4º',
  };
}

// ───────────────────────── pontuação técnica (art. 36, § 3º; art. 37, III) ─────────────────────────

/** Fórmula do edital para o desempenho anterior na nota técnica. */
export interface CriterioDesempenhoTecnica {
  /** Parte da nota técnica que vem do desempenho registrado (1 a 100%). */
  pesoDesempenhoPercentual: number;
  /** Nota usada para licitante sem avaliação no registro (0 a 100), fixada no edital. */
  notaSemHistorico: number;
  /** Ato que regulamenta o uso do desempenho pretérito (exigido pelo art. 36, § 3º). */
  regulamento: string;
}

/**
 * Confere a fórmula do edital: só na técnica e preço ou na melhor técnica (art. 37, caput), peso de 1% a 100% da nota
 * técnica, nota para quem não tem histórico de 0 a 100 e indicação do regulamento. O desempenho pretérito na pontuação
 * técnica depende de regulamento (art. 36, § 3º); sem ele o TCU considerou irregular o uso (Acórdão 7695/2024-2ª Câmara).
 */
export function validarCriterioDesempenhoTecnica(c: CriterioDesempenhoTecnica, criterioJulgamento: string): void {
  if (criterioJulgamento !== 'tecnica_preco' && criterioJulgamento !== 'melhor_tecnica') {
    throw new ErroDominio(
      'CRITERIO_DESEMPENHO_INVALIDO',
      'O desempenho anterior só pontua na técnica e preço ou na melhor técnica (Lei 14.133/2021, art. 37, caput e III). Ajuste o critério de julgamento do edital.',
    );
  }
  exigirFinito(c.pesoDesempenhoPercentual, 'pesoDesempenhoPercentual', 'CRITERIO_DESEMPENHO_INVALIDO');
  if (c.pesoDesempenhoPercentual <= 0 || c.pesoDesempenhoPercentual > 100) {
    throw new ErroDominio('CRITERIO_DESEMPENHO_INVALIDO', 'O peso do desempenho na nota técnica deve ser maior que 0% e no máximo 100%.');
  }
  exigirFinito(c.notaSemHistorico, 'notaSemHistorico', 'CRITERIO_DESEMPENHO_INVALIDO');
  if (c.notaSemHistorico < 0 || c.notaSemHistorico > 100) throw new ErroDominio('CRITERIO_DESEMPENHO_INVALIDO', 'A nota para quem não tem histórico deve estar entre 0 e 100.');
  exigirTexto(
    c.regulamento,
    10,
    'Indique o regulamento que disciplina o desempenho pretérito na pontuação técnica (art. 36, § 3º; TCU, Acórdão 7695/2024-2ª Câmara)',
    'CRITERIO_DESEMPENHO_SEM_REGULAMENTO',
  );
}

/**
 * Nota técnica com o desempenho anterior (art. 37, III): (100% − peso) × nota da proposta técnica + peso × nota do
 * registro de desempenho (ou a nota fixada no edital para quem não tem histórico), com 2 casas. A nota de desempenho
 * vem do registro, nunca digitada. Fundamento: Lei 14.133/2021, art. 36, § 3º, e art. 37, III.
 */
export function comporNotaTecnicaComDesempenho(
  notaProposta: number,
  notaDesempenho: number | null,
  c: CriterioDesempenhoTecnica,
): { notaTecnica: number; notaProposta: number; notaDesempenho: number; origem: 'registro' | 'sem_historico'; memoria: string; fundamento: string } {
  exigirFinito(notaProposta, 'notaProposta', 'CRITERIO_DESEMPENHO_INVALIDO');
  if (notaProposta < 0 || notaProposta > 100) throw new ErroDominio('CRITERIO_DESEMPENHO_INVALIDO', 'A nota da proposta técnica deve estar entre 0 e 100.');
  if (notaDesempenho !== null) {
    exigirFinito(notaDesempenho, 'notaDesempenho', 'CRITERIO_DESEMPENHO_INVALIDO');
    if (notaDesempenho < 0 || notaDesempenho > 100) throw new ErroDominio('CRITERIO_DESEMPENHO_INVALIDO', 'A nota de desempenho deve estar entre 0 e 100.');
  }
  const p = c.pesoDesempenhoPercentual;
  if (!Number.isFinite(p) || p <= 0 || p > 100) throw new ErroDominio('CRITERIO_DESEMPENHO_INVALIDO', 'O peso do desempenho na nota técnica deve ser maior que 0% e no máximo 100%.');
  const origem = notaDesempenho === null ? 'sem_historico' : 'registro';
  const usada = notaDesempenho ?? c.notaSemHistorico;
  const notaTecnica = arredondar(((100 - p) * notaProposta + p * usada) / 100, 2);
  const memoria = `${formatarNumero(100 - p)}% × ${formatarNumero(notaProposta)} (proposta técnica) + ${formatarNumero(p)}% × ${formatarNumero(usada)} (${
    origem === 'registro' ? 'nota do registro de desempenho' : 'sem avaliação no registro: nota fixada no edital'
  }) = ${formatarNumero(notaTecnica)}.`;
  return { notaTecnica, notaProposta, notaDesempenho: usada, origem, memoria, fundamento: 'Lei 14.133/2021, art. 36, § 3º, e art. 37, III' };
}

/**
 * Cláusula do edital e do TR com a fórmula do desempenho anterior na pontuação técnica, com o regulamento citado.
 * Devolve o texto (Markdown) e a premissa do documento. Fundamento: art. 36, § 3º, e art. 37, III.
 */
export function clausulaCriterioDesempenhoEdital(c: CriterioDesempenhoTecnica): { corpo: string; premissa: string; fundamento: string } {
  const peso = formatarNumero(c.pesoDesempenhoPercentual);
  return {
    corpo: [
      '## Desempenho anterior na pontuação técnica',
      '',
      `A nota técnica de cada licitante considera o desempenho pretérito na execução de contratos com a Administração: ${formatarNumero(100 - c.pesoDesempenhoPercentual)}% da nota técnica vêm da proposta técnica e ${peso}% vêm da nota do registro cadastral de desempenho do licitante, apurada só com as avaliações definitivas emitidas com indicadores objetivos (art. 88, § 3º). Licitante sem avaliação no registro recebe, nessa parcela, a nota ${formatarNumero(c.notaSemHistorico)}. A nota do registro não é informada pelo licitante nem digitada pelo agente.`,
      '',
      `Regulamento aplicado: ${c.regulamento.trim()} (Lei 14.133/2021, art. 36, § 3º, e art. 37, III).`,
    ].join('\n'),
    premissa: `Desempenho anterior com ${peso}% da nota técnica, conforme ${c.regulamento.trim()}.`,
    fundamento: 'Lei 14.133/2021, art. 36, § 3º, e art. 37, III',
  };
}

// ───────────────────────── simulador de impacto em editais futuros ─────────────────────────

export interface LicitanteSimulado {
  id: string;
  nome: string;
  valorProposta: Centavos;
  /** Nota do registro de desempenho (null = sem avaliação). */
  notaDesempenho: number | null;
  /** Nota da proposta técnica (só para a simulação de técnica e preço). */
  notaProposta?: number;
  meEpp?: boolean;
}

/**
 * Simulador de impacto do desempenho registrado em licitações futuras: (1) empate no pregão desfeito pelo art. 60, II,
 * com as notas do registro (`aplicarDesempate`); (2) com a fórmula do edital, conversão da nota do registro em parte da
 * nota técnica e classificação por técnica e preço (`pontuarTecnicaEPreco`). Somente leitura; não registra resultado.
 */
export function simularImpactoDesempenho(entrada: {
  licitantes: readonly LicitanteSimulado[];
  criterio?: (CriterioDesempenhoTecnica & { pesoTecnicoPercentual: number }) | null;
}): {
  desempate: ReturnType<typeof aplicarDesempate>;
  tecnicaEPreco: { id: string; nome: string; posicao: number; notaProposta: number; notaDesempenho: number; origem: 'registro' | 'sem_historico'; notaTecnica: number; notaPreco: number; notaFinal: number }[] | null;
  aviso: string;
} {
  if (!Array.isArray(entrada.licitantes) || entrada.licitantes.length < 2) {
    throw new ErroDominio('SIMULACAO_INVALIDA', 'Informe ao menos dois licitantes para simular.');
  }
  const paraDesempate: Licitante[] = entrada.licitantes.map((l) => ({
    id: l.id,
    nome: l.nome,
    valorProposta: l.valorProposta,
    ...(l.meEpp !== undefined ? { meEpp: l.meEpp } : {}),
    ...(l.notaDesempenho !== null ? { notaDesempenhoPrevio: l.notaDesempenho } : {}),
  }));
  const desempate = aplicarDesempate(paraDesempate);
  let tecnicaEPreco = null;
  const c = entrada.criterio;
  if (c) {
    validarCriterioDesempenhoTecnica(c, 'tecnica_preco');
    const compostas = entrada.licitantes.map((l) => {
      if (l.notaProposta === undefined) throw new ErroDominio('SIMULACAO_INVALIDA', `Informe a nota da proposta técnica de ${l.nome}.`);
      return { l, composicao: comporNotaTecnicaComDesempenho(l.notaProposta, l.notaDesempenho, c) };
    });
    const notas = new Map(pontuarTecnicaEPreco(compostas.map(({ l, composicao }) => ({ id: l.id, preco: l.valorProposta, notaTecnica: composicao.notaTecnica })), c.pesoTecnicoPercentual).map((n) => [n.id, n]));
    const linhas = compostas.map(({ l, composicao }) => {
      const n = notas.get(l.id);
      return {
        id: l.id,
        nome: l.nome,
        posicao: 0,
        notaProposta: composicao.notaProposta,
        notaDesempenho: composicao.notaDesempenho,
        origem: composicao.origem,
        notaTecnica: composicao.notaTecnica,
        notaPreco: n?.notaPreco ?? 0,
        notaFinal: n?.notaFinal ?? 0,
      };
    });
    linhas.sort((a, b) => b.notaFinal - a.notaFinal || (a.id < b.id ? -1 : 1));
    linhas.forEach((linha, i) => {
      const anterior = linhas[i - 1];
      linha.posicao = anterior && anterior.notaFinal === linha.notaFinal ? anterior.posicao : i + 1;
    });
    tecnicaEPreco = linhas;
  }
  return {
    desempate,
    tecnicaEPreco,
    aviso: 'Simulação com as notas atuais do registro de desempenho: não registra resultado nem substitui o julgamento do agente de contratação.',
  };
}

// ───────────────────────── documentos ─────────────────────────

const ROTULO_SANCAO: Record<TipoSancao, string> = {
  advertencia: 'Advertência',
  multa: 'Multa',
  impedimento_licitar: 'Impedimento de licitar e contratar',
  declaracao_inidoneidade: 'Declaração de inidoneidade',
};
const ROTULO_FAIXA: Record<FaixaIdc, string> = {
  diamante: 'Diamante',
  ouro: 'Ouro',
  prata: 'Prata',
  em_observacao: 'Em observação',
  critico: 'Crítico',
  sem_historico: 'Sem histórico',
};

/** Rótulo do selo de desempenho (faixa). */
export function rotuloFaixaDesempenho(faixa: FaixaIdc): string {
  return ROTULO_FAIXA[faixa];
}

export interface DadosDocumentoAvaliacao {
  protocolo: string;
  versao: number;
  orgao: string;
  uasg: string;
  contrato: { numero: string; objeto: string; vigenciaInicio: DataISO; vigenciaFim: DataISO; valorInicial: Centavos };
  fornecedor: { nome: string; documento: string };
  tipo: TipoAvaliacaoDesempenho;
  periodoInicio: DataISO;
  periodoFim: DataISO;
  avaliador: { nome: string; papel: PapelAvaliador };
  dataEmissao: DataISO;
  indicadores: IndicadoresAvaliacao;
  evidencias: string;
  motivacao: string;
  resultado: Pick<ResultadoAvaliacaoDesempenho, 'nota' | 'faixa' | 'componentes' | 'penalidades' | 'metodologia' | 'aviso' | 'prazoManifestacao'>;
  manifestacao: { texto: string; recebidaEm: DataISO; concorda: boolean } | null;
  analise: { decisao: 'mantida' | 'revista'; motivacao: string; data: DataISO; por: string } | null;
}

function celula(texto: string): string {
  return texto.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

/**
 * Documento comprobatório da avaliação (art. 88, § 3º), em Markdown: contrato, período, avaliador, indicadores
 * aferidos e evidências, componentes e penalidades, nota e faixa, motivação, manifestação do contratado e análise,
 * protocolo do registro e fundamentos.
 */
export function redigirDocumentoAvaliacaoDesempenho(d: DadosDocumentoAvaliacao): string {
  const r = d.resultado;
  const i = d.indicadores;
  const linhas = [
    `# Documento de avaliação de desempenho do contratado`,
    '',
    `**Protocolo do registro:** ${d.protocolo} · versão ${d.versao}`,
    '',
    `**Órgão:** ${d.orgao} · UASG ${d.uasg}`,
    '',
    `**Contrato:** ${d.contrato.numero} — ${celula(d.contrato.objeto)}`,
    '',
    `**Vigência:** ${formatarData(d.contrato.vigenciaInicio)} a ${formatarData(d.contrato.vigenciaFim)} · valor inicial ${formatarMoeda(d.contrato.valorInicial)}`,
    '',
    `**Contratado:** ${d.fornecedor.nome} (${d.fornecedor.documento})`,
    '',
    `**Avaliação:** ${d.tipo === 'final' ? 'final, na conclusão do contrato' : 'parcial, ao final de etapa da execução'} · período de ${formatarData(d.periodoInicio)} a ${formatarData(d.periodoFim)}`,
    '',
    `**Avaliador:** ${d.avaliador.nome} (${d.avaliador.papel === 'gestor' ? 'gestor do contrato' : 'fiscal do contrato'}) · emitida em ${formatarData(d.dataEmissao)}`,
    '',
    '## 1. Indicadores aferidos',
    '',
    '| Indicador | Aferido | Total |',
    '|---|---:|---:|',
    `| Entregas no prazo | ${i.entregasNoPrazo} | ${i.entregasTotal} |`,
    `| Recebimentos definitivos sem ressalva | ${i.recebimentosAprovados} | ${i.recebimentosTotal} |`,
    `| Ocorrências da fiscalização resolvidas no prazo | ${i.ocorrenciasResolvidasNoPrazo} | ${i.ocorrenciasFiscalizacao} |`,
    '',
    `**Evidências:** ${celula(d.evidencias)}`,
    '',
    '## 2. Cálculo da nota',
    '',
    '| Componente | Valor | Peso | Contribuição |',
    '|---|---:|---:|---:|',
    ...r.componentes.map((c) => `| ${c.nome} | ${formatarNumero(c.valor)} | ${formatarNumero(arredondar(c.peso * 100, 2))}% | ${formatarNumero(c.contribuicao)} |`),
    '',
    r.penalidades.length === 0
      ? 'Penalidades aplicadas no período: nenhuma.'
      : `Penalidades aplicadas no período: ${r.penalidades.map((p) => `${ROTULO_SANCAO[p.tipo]} em ${formatarData(p.dataAplicacao)} (${formatarNumero(p.desconto)} pontos)`).join('; ')}.`,
    '',
    `**Nota: ${formatarNumero(r.nota)} de 100 — faixa ${ROTULO_FAIXA[r.faixa]}.**`,
    '',
    r.metodologia,
    '',
    '## 3. Avaliação motivada',
    '',
    d.motivacao.trim(),
    '',
    '## 4. Manifestação do contratado',
    '',
    d.manifestacao
      ? `Recebida em ${formatarData(d.manifestacao.recebidaEm)} (${d.manifestacao.concorda ? 'concorda com a avaliação' : 'discorda da avaliação'}): ${d.manifestacao.texto.trim()}`
      : `O contratado pode se manifestar até ${formatarData(r.prazoManifestacao)}. Sem manifestação no prazo, a avaliação fica definitiva.`,
    '',
  ];
  if (d.analise) {
    linhas.push(
      '## 5. Análise da manifestação',
      '',
      `${d.analise.decisao === 'revista' ? 'Avaliação revista' : 'Avaliação mantida'} por ${d.analise.por} em ${formatarData(d.analise.data)}: ${d.analise.motivacao.trim()}`,
      '',
    );
  }
  linhas.push(
    '---',
    '',
    `> ${r.aviso}`,
    '',
    '### Registro cadastral',
    '',
    `Esta avaliação passa a constar do registro cadastral de desempenho do fornecedor na Ágora (protocolo ${d.protocolo}). O envio ao cadastro de atesto de cumprimento de obrigações do PNCP depende da implantação e da regulamentação desse cadastro (art. 88, § 4º).`,
    '',
    '### Fundamentos',
    '',
    `- ${FUNDAMENTO_AVALIACAO}`,
    '- Lei 14.133/2021, art. 88, § 4º (anotação objetiva, impessoal, isonômica, pública e transparente)',
    `- ${FUNDAMENTO_MANIFESTACAO}`,
  );
  return linhas.join('\n');
}

export interface DadosCertificadoDesempenho {
  tipo: TipoDocumentoIncentivo;
  codigo: string;
  orgao: string;
  fornecedor: { nome: string; documento: string };
  registro: Pick<RegistroDesempenho, 'nota' | 'faixa' | 'contratosConsiderados' | 'versaoRegistro' | 'metodologia'>;
  avaliacoes: { contrato: string; periodoFim: DataISO; nota: number; tipo: TipoAvaliacaoDesempenho }[];
  dataEmissao: DataISO;
  validoAte: DataISO;
  emitidoPor: string;
  criterio: string;
}

/**
 * Certificado de desempenho (incentivo ao ótimo desempenho) ou declaração de desempenho registrado, em Markdown:
 * nota e faixa do registro, avaliações consideradas, critério objetivo, validade e código de verificação.
 * Fundamento: Lei 14.133/2021, art. 88, §§ 2º e 4º.
 */
export function redigirCertificadoDesempenho(d: DadosCertificadoDesempenho): string {
  const titulo = d.tipo === 'certificado' ? 'Certificado de desempenho do fornecedor' : 'Declaração de desempenho registrado';
  const nota = d.registro.nota === null ? 'sem nota' : `${formatarNumero(d.registro.nota)} de 100`;
  const abertura =
    d.tipo === 'certificado'
      ? `Certificamos que **${d.fornecedor.nome}** (${d.fornecedor.documento}) tem ótimo desempenho anotado no registro cadastral de desempenho do órgão: nota ${nota}, faixa ${ROTULO_FAIXA[d.registro.faixa]}, apurada em ${d.registro.contratosConsiderados} contrato(s).`
      : `Declaramos, para uso em licitações, que o registro cadastral de desempenho de **${d.fornecedor.nome}** (${d.fornecedor.documento}) apresenta nota ${nota}, faixa ${ROTULO_FAIXA[d.registro.faixa]}, apurada em ${d.registro.contratosConsiderados} contrato(s).`;
  return [
    `# ${titulo}`,
    '',
    `**Código de verificação:** ${d.codigo} · versão do registro ${d.registro.versaoRegistro}`,
    '',
    `**Órgão emissor:** ${d.orgao}`,
    '',
    abertura,
    '',
    '## Avaliações consideradas',
    '',
    '| Contrato | Tipo | Fim do período | Nota |',
    '|---|---|---|---:|',
    ...d.avaliacoes.map((a) => `| ${celula(a.contrato)} | ${a.tipo === 'final' ? 'Final' : 'Parcial'} | ${formatarData(a.periodoFim)} | ${formatarNumero(a.nota)} |`),
    '',
    '## Critério objetivo',
    '',
    d.criterio,
    '',
    d.registro.metodologia,
    '',
    `Emitido em ${formatarData(d.dataEmissao)} por ${d.emitidoPor}. Válido até ${formatarData(d.validoAte)} ou até a próxima atualização do registro, o que ocorrer primeiro (art. 88, § 2º).`,
    '',
    '---',
    '',
    '> Documento de incentivo ao bom desempenho (Lei 14.133/2021, art. 88, § 4º). Não substitui a habilitação nem dispensa a verificação de sanções e da regularidade na data da licitação.',
  ].join('\n');
}
