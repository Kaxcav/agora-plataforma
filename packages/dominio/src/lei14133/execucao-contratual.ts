/**
 * Execução contratual como ato (F22, parte 2), Lei 14.133/2021:
 *
 * - fiscalização: designação do gestor e dos fiscais técnico, administrativo e requisitante (art. 117, caput, e
 *   art. 7º, § 1º) e registro das ocorrências no livro do contrato (art. 117, § 1º);
 * - recebimento provisório e definitivo (art. 140; RN-34), com ressalva ou rejeição e prazo de correção (art. 119);
 * - prazos de liquidação e de pagamento e atualização monetária por atraso imputável à Administração (art. 92, V
 *   e VI, e § 7º);
 * - alteração justificada da ordem cronológica de pagamentos (art. 141, § 1º).
 *
 * Funções puras e determinísticas: "hoje" e o calendário entram como parâmetro. O domínio valida e calcula; quem
 * recebe, rejeita, decide e paga são os agentes designados.
 */
import { ErroDominio } from '../erros.ts';
import { adicionarDias, adicionarDiasUteis, contarPrazo, diasEntre, formatarData, type DataISO, type OpcoesCalendario } from '../datas.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';
import { adicionarMeses, arredondar, diasNoMes, exigirFinito, exigirInteiro, formatarNumero, lerData, partesData } from '../interno.ts';
import type { PagamentoOrdemCronologica } from './controle.ts';

// ───────────────────────── Fiscalização (art. 117) ─────────────────────────

export type PapelFiscalizacao = 'gestor' | 'fiscal_tecnico' | 'fiscal_administrativo' | 'fiscal_requisitante' | 'comissao_recebimento';

export const PAPEIS_FISCALIZACAO: readonly PapelFiscalizacao[] = [
  'gestor',
  'fiscal_tecnico',
  'fiscal_administrativo',
  'fiscal_requisitante',
  'comissao_recebimento',
];

export const ROTULOS_PAPEL_FISCALIZACAO: Readonly<Record<PapelFiscalizacao, string>> = {
  gestor: 'Gestor do contrato',
  fiscal_tecnico: 'Fiscal técnico',
  fiscal_administrativo: 'Fiscal administrativo',
  fiscal_requisitante: 'Fiscal requisitante',
  comissao_recebimento: 'Comissão de recebimento definitivo',
};

/** Papéis que a equipe de gestão e fiscalização completa tem (Decreto 11.246/2022 e IN SGD/ME 94/2022). */
const PAPEIS_EQUIPE: readonly PapelFiscalizacao[] = ['gestor', 'fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante'];
const PAPEIS_FISCAIS: readonly PapelFiscalizacao[] = ['fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante'];

export interface DesignacaoFiscalizacao {
  papel: PapelFiscalizacao;
  usuarioId: string;
  nome: string;
  substituto?: boolean;
}

export interface ConflitoDesignacao {
  usuarioId: string;
  nome: string;
  papeis: [PapelFiscalizacao, PapelFiscalizacao];
  motivo: string;
  fundamento: string;
}

function ehPapelFiscalizacao(valor: unknown): valor is PapelFiscalizacao {
  return typeof valor === 'string' && (PAPEIS_FISCALIZACAO as readonly string[]).includes(valor);
}

/**
 * Confere a equipe designada para gerir e fiscalizar o contrato (art. 117, caput).
 *
 * - Conflito (bloqueia a designação): a mesma pessoa como gestor e fiscal técnico, funções de controle recíproco
 *   (segregação de funções, art. 7º, § 1º — a mesma regra da RN-03 na equipe do processo).
 * - Faltantes (aviso): papéis da equipe completa sem titular — gestor e fiscais técnico, administrativo e requisitante.
 * - `temFiscal`: o art. 117 exige ao menos um fiscal designado.
 */
export function verificarDesignacoesContrato(designacoes: readonly DesignacaoFiscalizacao[]): {
  conflitos: ConflitoDesignacao[];
  faltantes: PapelFiscalizacao[];
  temFiscal: boolean;
  completa: boolean;
  fundamento: string;
} {
  for (const d of designacoes) {
    if (!ehPapelFiscalizacao(d.papel)) throw new ErroDominio('DESIGNACAO_INVALIDA', `Papel de fiscalização desconhecido: ${String(d.papel)}.`);
    if (typeof d.usuarioId !== 'string' || d.usuarioId.trim() === '') throw new ErroDominio('DESIGNACAO_INVALIDA', 'Informe o servidor designado.');
  }
  const conflitos: ConflitoDesignacao[] = [];
  const porUsuario = new Map<string, DesignacaoFiscalizacao[]>();
  for (const d of designacoes) porUsuario.set(d.usuarioId, [...(porUsuario.get(d.usuarioId) ?? []), d]);
  for (const [usuarioId, lista] of porUsuario) {
    const papeis = new Set(lista.map((d) => d.papel));
    if (papeis.has('gestor') && papeis.has('fiscal_tecnico')) {
      conflitos.push({
        usuarioId,
        nome: lista[0]?.nome ?? '',
        papeis: ['gestor', 'fiscal_tecnico'],
        motivo: 'Gestão e fiscalização técnica do contrato são funções de controle recíproco: quem gere não deve atestar tecnicamente a execução.',
        fundamento: 'Lei 14.133/2021, art. 7º, § 1º',
      });
    }
  }
  const titulares = new Set(designacoes.filter((d) => d.substituto !== true).map((d) => d.papel));
  const faltantes = PAPEIS_EQUIPE.filter((p) => !titulares.has(p));
  const temFiscal = PAPEIS_FISCAIS.some((p) => titulares.has(p));
  return {
    conflitos,
    faltantes,
    temFiscal,
    completa: faltantes.length === 0 && conflitos.length === 0,
    fundamento: 'Lei 14.133/2021, art. 117, caput, e art. 7º, § 1º; Decreto 11.246/2022',
  };
}

export type TipoOcorrencia = 'falha_execucao' | 'atraso' | 'inconformidade' | 'comunicacao' | 'outra';
export const TIPOS_OCORRENCIA: readonly TipoOcorrencia[] = ['falha_execucao', 'atraso', 'inconformidade', 'comunicacao', 'outra'];
export const MINIMO_RELATO_OCORRENCIA = 30;

/**
 * Valida o registro de ocorrência no livro do contrato (art. 117, § 1º): o fiscal anota as ocorrências e determina
 * o necessário para regularizar faltas e defeitos. Com prazo de regularização, a contratada tem de ser notificada
 * (`exigeNotificacao`); o registro não é sanção — eventual penalidade depende de processo próprio, com defesa.
 */
export function validarOcorrencia(e: {
  tipo: TipoOcorrencia;
  dataFato: DataISO;
  relato: string;
  prazoRegularizacao: DataISO | null;
  hoje: DataISO;
}): { exigeNotificacao: boolean; fundamento: string } {
  if (!TIPOS_OCORRENCIA.includes(e.tipo)) throw new ErroDominio('OCORRENCIA_INVALIDA', `Tipo de ocorrência desconhecido: ${String(e.tipo)}.`);
  const hoje = lerData(e.hoje, 'hoje');
  if (lerData(e.dataFato, 'dataFato') > hoje) throw new ErroDominio('OCORRENCIA_INVALIDA', 'A data do fato não pode ser futura.');
  const relato = typeof e.relato === 'string' ? e.relato.trim() : '';
  if (relato.length < MINIMO_RELATO_OCORRENCIA) {
    throw new ErroDominio('OCORRENCIA_INVALIDA', `Descreva a ocorrência com pelo menos ${MINIMO_RELATO_OCORRENCIA} caracteres.`);
  }
  if (e.prazoRegularizacao !== null && lerData(e.prazoRegularizacao, 'prazoRegularizacao') < hoje) {
    throw new ErroDominio('OCORRENCIA_INVALIDA', 'O prazo para regularização não pode ser anterior a hoje.');
  }
  return {
    exigeNotificacao: e.prazoRegularizacao !== null,
    fundamento: 'Lei 14.133/2021, art. 117, § 1º, e art. 119',
  };
}

// ───────────────────────── Recebimentos (art. 140; RN-34) ─────────────────────────

export type SituacaoRecebimento = 'aguardando_provisorio' | 'aguardando_definitivo' | 'em_correcao' | 'recebido';
export type TipoTermoRecebimento = 'provisorio' | 'definitivo';
export type ResultadoTermoRecebimento = 'aceito' | 'com_ressalva' | 'rejeitado';

export const RESULTADOS_TERMO_RECEBIMENTO: readonly ResultadoTermoRecebimento[] = ['aceito', 'com_ressalva', 'rejeitado'];
export const MINIMO_OBSERVACAO_RESSALVA = 30;

/** Prazos de recebimento definidos no contrato (art. 140, § 3º), em dias úteis (art. 183). */
export interface ParametrosRecebimento {
  prazoProvisorioDiasUteis: number;
  prazoDefinitivoDiasUteis: number;
  prazoCorrecaoDiasUteis: number;
}

function validarParametrosRecebimento(p: ParametrosRecebimento): void {
  exigirInteiro(p.prazoProvisorioDiasUteis, 'prazoProvisorioDiasUteis', 'PARAMETROS_EXECUCAO_INVALIDOS', 1);
  exigirInteiro(p.prazoDefinitivoDiasUteis, 'prazoDefinitivoDiasUteis', 'PARAMETROS_EXECUCAO_INVALIDOS', 1);
  exigirInteiro(p.prazoCorrecaoDiasUteis, 'prazoCorrecaoDiasUteis', 'PARAMETROS_EXECUCAO_INVALIDOS', 1);
}

/**
 * Prazo do recebimento provisório de uma entrega: dias úteis contados da entrega pela contratada, conforme o
 * contrato (art. 140, § 3º; art. 92, VII; contagem do art. 183).
 */
export function prazoRecebimentoProvisorio(entregueEm: DataISO, parametros: ParametrosRecebimento, opcoes?: OpcoesCalendario): { limite: DataISO; fundamento: string } {
  validarParametrosRecebimento(parametros);
  lerData(entregueEm, 'entregueEm');
  return {
    limite: adicionarDiasUteis(entregueEm, parametros.prazoProvisorioDiasUteis, opcoes),
    fundamento: 'Lei 14.133/2021, art. 140, § 3º, e art. 92, VII',
  };
}

/** "No prazo", "vence hoje" ou "vencido", com os dias até o limite (negativo quando vencido). */
export function situacaoPrazoExecucao(limite: DataISO, hoje: DataISO): { situacao: 'no_prazo' | 'vence_hoje' | 'vencido'; dias: number } {
  const dias = diasEntre(hoje, limite);
  return { situacao: dias > 0 ? 'no_prazo' : dias === 0 ? 'vence_hoje' : 'vencido', dias };
}

export interface ResultadoAvaliacaoTermo {
  novaSituacao: SituacaoRecebimento;
  etapaCorrecao: TipoTermoRecebimento | null;
  /** Prazo para a contratada corrigir ou substituir o objeto (ressalva ou rejeição). */
  prazoCorrecao: DataISO | null;
  /** Limite do próximo termo (definitivo depois do provisório aceito, ou novo exame depois da correção). */
  proximoPrazo: DataISO | null;
  /** O recebimento definitivo aceito libera a liquidação da despesa (atesto da nota fiscal). */
  liberaLiquidacao: boolean;
  foraDoPrazo: boolean;
  avisos: string[];
  fundamento: string;
}

/**
 * Valida o termo de recebimento e calcula a nova situação (RN-34; art. 140):
 *
 * - provisório: pelo responsável pelo acompanhamento e fiscalização (fiscal designado ou gestor), por termo
 *   detalhado nas obras e serviços e sumário nas compras (art. 140, I, "a", e II, "a");
 * - definitivo: por servidor ou comissão designada pela autoridade competente (aqui, o gestor ou membro da comissão
 *   de recebimento), por termo detalhado, e nunca por quem lavrou o provisório aceito da mesma entrega
 *   (art. 140, I, "b", e II, "b"; segregação de funções, art. 7º, § 1º);
 * - ressalva ou rejeição exigem a descrição do que está em desacordo e abrem prazo de correção ou substituição às
 *   custas da contratada (art. 140, § 1º, e art. 119); vencido o prazo, o mesmo exame é refeito;
 * - só o definitivo aceito libera a liquidação.
 */
export function avaliarTermoRecebimento(e: {
  situacao: SituacaoRecebimento;
  etapaCorrecao: TipoTermoRecebimento | null;
  tipo: TipoTermoRecebimento;
  resultado: ResultadoTermoRecebimento;
  data: DataISO;
  hoje: DataISO;
  entregueEm: DataISO;
  observacoes: string;
  responsavel: { usuarioId: string; papeis: readonly PapelFiscalizacao[] };
  /** Quem lavrou o provisório aceito desta entrega (segregação no definitivo). */
  responsavelProvisorioId: string | null;
  /** Limite do termo que está sendo lavrado (para o aviso de termo fora do prazo). */
  limiteTermo: DataISO | null;
  parametros: ParametrosRecebimento;
  opcoes?: OpcoesCalendario;
}): ResultadoAvaliacaoTermo {
  validarParametrosRecebimento(e.parametros);
  if (e.tipo !== 'provisorio' && e.tipo !== 'definitivo') throw new ErroDominio('RECEBIMENTO_INVALIDO', `Tipo de termo desconhecido: ${String(e.tipo)}.`);
  if (!RESULTADOS_TERMO_RECEBIMENTO.includes(e.resultado)) throw new ErroDominio('RECEBIMENTO_INVALIDO', `Resultado desconhecido: ${String(e.resultado)}.`);
  if (e.situacao === 'recebido') throw new ErroDominio('RECEBIMENTO_CONCLUIDO', 'O objeto desta entrega já foi recebido definitivamente.');
  const esperado: TipoTermoRecebimento =
    e.situacao === 'aguardando_provisorio' ? 'provisorio' : e.situacao === 'aguardando_definitivo' ? 'definitivo' : (e.etapaCorrecao ?? 'provisorio');
  if (e.tipo !== esperado) {
    throw new ErroDominio(
      'RECEBIMENTO_TRANSICAO_INVALIDA',
      esperado === 'provisorio'
        ? 'Esta entrega aguarda o recebimento provisório: o definitivo só vem depois do provisório aceito (art. 140).'
        : 'Esta entrega já tem o recebimento provisório aceito: o próximo termo é o definitivo.',
    );
  }
  const data = lerData(e.data, 'data');
  if (data > lerData(e.hoje, 'hoje')) throw new ErroDominio('RECEBIMENTO_INVALIDO', 'A data do termo não pode ser futura.');
  if (data < lerData(e.entregueEm, 'entregueEm')) throw new ErroDominio('RECEBIMENTO_INVALIDO', 'A data do termo não pode ser anterior à entrega.');

  const papeis = new Set(e.responsavel.papeis);
  if (e.tipo === 'provisorio' && !papeis.has('gestor') && !PAPEIS_FISCAIS.some((p) => papeis.has(p))) {
    throw new ErroDominio(
      'RECEBIMENTO_RESPONSAVEL_INVALIDO',
      'O recebimento provisório é feito pelo responsável pelo acompanhamento e fiscalização: fiscal ou gestor designado no contrato (art. 140, I, "a").',
    );
  }
  if (e.tipo === 'definitivo') {
    if (!papeis.has('gestor') && !papeis.has('comissao_recebimento')) {
      throw new ErroDominio(
        'RECEBIMENTO_RESPONSAVEL_INVALIDO',
        'O recebimento definitivo é feito por servidor ou comissão designada pela autoridade competente: gestor ou membro da comissão de recebimento do contrato (art. 140, I, "b").',
      );
    }
    if (e.responsavelProvisorioId !== null && e.responsavelProvisorioId === e.responsavel.usuarioId) {
      throw new ErroDominio(
        'RECEBIMENTO_SEGREGACAO',
        'Quem lavrou o recebimento provisório desta entrega não pode lavrar o definitivo: a conferência final é de outro servidor ou da comissão (art. 140 e art. 7º, § 1º).',
      );
    }
  }
  const observacoes = typeof e.observacoes === 'string' ? e.observacoes.trim() : '';
  if (e.resultado !== 'aceito' && observacoes.length < MINIMO_OBSERVACAO_RESSALVA) {
    throw new ErroDominio(
      'RECEBIMENTO_SEM_MOTIVO',
      `Descreva com pelo menos ${MINIMO_OBSERVACAO_RESSALVA} caracteres o que está em desacordo com o contrato (art. 140, § 1º).`,
    );
  }

  const avisos: string[] = [];
  const foraDoPrazo = e.limiteTermo !== null && data > lerData(e.limiteTermo, 'limiteTermo');
  if (foraDoPrazo && e.limiteTermo !== null) {
    avisos.push(`Termo lavrado depois do prazo contratual de ${formatarData(e.limiteTermo)}: registre o motivo no processo.`);
  }
  const p = e.parametros;
  if (e.resultado === 'aceito') {
    if (e.tipo === 'provisorio') {
      return {
        novaSituacao: 'aguardando_definitivo',
        etapaCorrecao: null,
        prazoCorrecao: null,
        proximoPrazo: adicionarDiasUteis(e.data, p.prazoDefinitivoDiasUteis, e.opcoes),
        liberaLiquidacao: false,
        foraDoPrazo,
        avisos,
        fundamento: 'Lei 14.133/2021, art. 140, I, "a", e II, "a"',
      };
    }
    return {
      novaSituacao: 'recebido',
      etapaCorrecao: null,
      prazoCorrecao: null,
      proximoPrazo: null,
      liberaLiquidacao: true,
      foraDoPrazo,
      avisos,
      fundamento: 'Lei 14.133/2021, art. 140, I, "b", e II, "b"; Lei 4.320/1964, art. 63',
    };
  }
  const prazoCorrecao = adicionarDiasUteis(e.data, p.prazoCorrecaoDiasUteis, e.opcoes);
  const prazoExame = e.tipo === 'provisorio' ? p.prazoProvisorioDiasUteis : p.prazoDefinitivoDiasUteis;
  avisos.push(
    e.resultado === 'rejeitado'
      ? `Objeto rejeitado: a contratada deve substituí-lo às suas custas até ${formatarData(prazoCorrecao)} (art. 140, § 1º, e art. 119).`
      : `Recebimento com ressalva: a contratada deve corrigir os pontos apontados até ${formatarData(prazoCorrecao)} (art. 119).`,
  );
  return {
    novaSituacao: 'em_correcao',
    etapaCorrecao: e.tipo,
    prazoCorrecao,
    proximoPrazo: adicionarDiasUteis(prazoCorrecao, prazoExame, e.opcoes),
    liberaLiquidacao: false,
    foraDoPrazo,
    avisos,
    fundamento: 'Lei 14.133/2021, art. 140, § 1º, e art. 119',
  };
}

/**
 * Fim do prazo de garantia técnica do objeto, contado do recebimento definitivo, quando o contrato o prevê
 * (art. 92, XIII, e art. 40, § 4º). `meses` 0 = sem garantia técnica no contrato.
 */
export function calcularGarantiaObjeto(definitivoEm: DataISO, meses: number): { ate: DataISO | null; fundamento: string } {
  exigirInteiro(meses, 'meses', 'PARAMETROS_EXECUCAO_INVALIDOS', 0);
  lerData(definitivoEm, 'definitivoEm');
  return { ate: meses === 0 ? null : adicionarMeses(definitivoEm, meses), fundamento: 'Lei 14.133/2021, art. 92, XIII, e art. 40, § 4º' };
}

// ───────────────────────── Liquidação, pagamento e atualização monetária (art. 92, V e VI) ─────────────────────────

export type MarcoPagamento = 'recebimento_definitivo' | 'liquidacao';
export type SituacaoPrazoPagamento = 'aguardando_marco' | 'no_prazo' | 'vence_hoje' | 'vencido' | 'pago_no_prazo' | 'pago_com_atraso';

/** Prazos de liquidação (dias úteis) e de pagamento (dias corridos), e o marco de contagem, definidos no contrato. */
export interface ParametrosPagamento {
  prazoLiquidacaoDiasUteis: number;
  prazoPagamentoDias: number;
  marcoPagamento: MarcoPagamento;
}

export interface PrazoPagamentoCalculado {
  marco: MarcoPagamento;
  dataMarco: DataISO | null;
  limiteLiquidacao: DataISO | null;
  liquidacaoAtrasada: boolean;
  limitePagamento: DataISO | null;
  situacao: SituacaoPrazoPagamento;
  /** Dias depois do limite (pagamento feito ou hoje, quando ainda não pago). */
  diasAtraso: number;
  explicacao: string;
  fundamento: string;
}

/**
 * Prazo de pagamento de uma parcela (art. 92, VI): contado do recebimento definitivo ou da liquidação, conforme o
 * contrato, em dias corridos que, vencendo em dia sem expediente, passam ao primeiro dia útil (art. 183). A
 * liquidação tem prazo próprio em dias úteis contado do recebimento definitivo.
 */
export function calcularPrazoPagamento(e: {
  parametros: ParametrosPagamento;
  recebimentoDefinitivoEm: DataISO | null;
  liquidadoEm: DataISO | null;
  pagoEm: DataISO | null;
  hoje: DataISO;
  opcoes?: OpcoesCalendario;
}): PrazoPagamentoCalculado {
  const p = e.parametros;
  exigirInteiro(p.prazoLiquidacaoDiasUteis, 'prazoLiquidacaoDiasUteis', 'PARAMETROS_EXECUCAO_INVALIDOS', 1);
  exigirInteiro(p.prazoPagamentoDias, 'prazoPagamentoDias', 'PARAMETROS_EXECUCAO_INVALIDOS', 1);
  if (p.marcoPagamento !== 'recebimento_definitivo' && p.marcoPagamento !== 'liquidacao') {
    throw new ErroDominio('PARAMETROS_EXECUCAO_INVALIDOS', `Marco de pagamento desconhecido: ${String(p.marcoPagamento)}.`);
  }
  const hoje = lerData(e.hoje, 'hoje');
  const fundamento = 'Lei 14.133/2021, art. 92, VI, e art. 141; art. 183 (contagem)';
  const limiteLiquidacao = e.recebimentoDefinitivoEm === null ? null : adicionarDiasUteis(e.recebimentoDefinitivoEm, p.prazoLiquidacaoDiasUteis, e.opcoes);
  const referenciaLiquidacao = e.liquidadoEm === null ? hoje : lerData(e.liquidadoEm, 'liquidadoEm');
  const liquidacaoAtrasada = limiteLiquidacao !== null && referenciaLiquidacao > lerData(limiteLiquidacao);
  const dataMarco = p.marcoPagamento === 'recebimento_definitivo' ? e.recebimentoDefinitivoEm : e.liquidadoEm;
  const rotuloMarco = p.marcoPagamento === 'recebimento_definitivo' ? 'do recebimento definitivo' : 'da liquidação';
  if (dataMarco === null) {
    return {
      marco: p.marcoPagamento,
      dataMarco: null,
      limiteLiquidacao,
      liquidacaoAtrasada,
      limitePagamento: null,
      situacao: 'aguardando_marco',
      diasAtraso: 0,
      explicacao: `O prazo de ${p.prazoPagamentoDias} dias começa a contar a partir ${rotuloMarco}, ainda não registrado.`,
      fundamento,
    };
  }
  const limitePagamento = contarPrazo(dataMarco, p.prazoPagamentoDias, 'corridos', e.opcoes).vencimento;
  const limite = lerData(limitePagamento);
  if (e.pagoEm !== null) {
    const pago = lerData(e.pagoEm, 'pagoEm');
    const atraso = Math.max(0, pago - limite);
    return {
      marco: p.marcoPagamento,
      dataMarco,
      limiteLiquidacao,
      liquidacaoAtrasada,
      limitePagamento,
      situacao: atraso > 0 ? 'pago_com_atraso' : 'pago_no_prazo',
      diasAtraso: atraso,
      explicacao:
        atraso > 0
          ? `Pago em ${formatarData(e.pagoEm)}, ${atraso} dia(s) depois do limite de ${formatarData(limitePagamento)}.`
          : `Pago em ${formatarData(e.pagoEm)}, dentro do limite de ${formatarData(limitePagamento)}.`,
      fundamento,
    };
  }
  const atraso = Math.max(0, hoje - limite);
  const situacao: SituacaoPrazoPagamento = hoje < limite ? 'no_prazo' : hoje === limite ? 'vence_hoje' : 'vencido';
  return {
    marco: p.marcoPagamento,
    dataMarco,
    limiteLiquidacao,
    liquidacaoAtrasada,
    limitePagamento,
    situacao,
    diasAtraso: atraso,
    explicacao:
      situacao === 'vencido'
        ? `O limite de ${formatarData(limitePagamento)} (${p.prazoPagamentoDias} dias a partir ${rotuloMarco}) venceu há ${atraso} dia(s).`
        : `Pagar até ${formatarData(limitePagamento)} (${p.prazoPagamentoDias} dias a partir ${rotuloMarco} em ${formatarData(dataMarco)}).`,
    fundamento,
  };
}

export interface VariacaoMensalIndice {
  /** 'AAAA-MM' */
  competencia: string;
  /** Variação do mês, em %. */
  percentual: number;
}

const REGEX_COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Corrige um valor pelo índice entre duas datas, pro rata die: cada mês do período entra com a fração de dias
 * que o período ocupa nele, de forma composta. Meses sem variação informada são tratados como 0 e listados.
 */
export function corrigirPorIndice(e: { valor: Centavos; de: DataISO; ate: DataISO; variacoes: readonly VariacaoMensalIndice[] }): {
  percentual: number;
  valorCorrigido: Centavos;
  competenciasSemIndice: string[];
  memoria: string[];
} {
  exigirInteiro(e.valor, 'valor', 'ATUALIZACAO_INVALIDA', 0);
  const inicio = lerData(e.de, 'de');
  const fim = lerData(e.ate, 'ate');
  if (fim < inicio) throw new ErroDominio('ATUALIZACAO_INVALIDA', 'A data final da correção não pode ser anterior à inicial.');
  const porCompetencia = new Map<string, number>();
  for (const v of e.variacoes) {
    if (typeof v.competencia !== 'string' || !REGEX_COMPETENCIA.test(v.competencia)) {
      throw new ErroDominio('ATUALIZACAO_INVALIDA', `Competência inválida: ${String(v.competencia)} (use AAAA-MM).`);
    }
    exigirFinito(v.percentual, 'percentual', 'ATUALIZACAO_INVALIDA');
    porCompetencia.set(v.competencia, v.percentual);
  }
  let fator = 1;
  const semIndice: string[] = [];
  const memoria: string[] = [];
  let cursor = e.de;
  while (lerData(cursor) < fim) {
    const partes = partesData(cursor);
    if (partes === null) break;
    const competencia = cursor.slice(0, 7);
    const totalMes = diasNoMes(partes.ano, partes.mes);
    const primeiroDoSeguinte = adicionarDias(cursor, totalMes - partes.dia + 1);
    const fimTrecho = Math.min(lerData(primeiroDoSeguinte), fim);
    const dias = fimTrecho - lerData(cursor);
    const variacao = porCompetencia.get(competencia);
    if (variacao === undefined) semIndice.push(competencia);
    else {
      const fracao = dias / totalMes;
      fator *= (1 + variacao / 100) ** fracao;
      memoria.push(`${competencia}: ${formatarNumero(variacao)}% no mês × ${dias}/${totalMes} dias.`);
    }
    cursor = primeiroDoSeguinte;
  }
  const percentual = arredondar((fator - 1) * 100, 4);
  return { percentual, valorCorrigido: Math.round(e.valor * fator), competenciasSemIndice: semIndice, memoria };
}

export interface ResultadoAtualizacaoMonetaria {
  devida: boolean;
  diasAtraso: number;
  diasAtualizacao: number;
  percentualIndice: number;
  valorCorrecao: Centavos;
  valorJuros: Centavos;
  valorTotal: Centavos;
  competenciasSemIndice: string[];
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
}

/**
 * Atualização monetária por atraso de pagamento imputável à Administração (art. 92, V): quando o pagamento passa do
 * limite contratual, o valor é corrigido pelo índice do contrato entre o adimplemento (art. 92, § 7º) e o pagamento
 * efetivo — ou hoje, como estimativa —, com juros de mora simples pro rata die sobre o valor da parcela, se o
 * contrato os previr. É cálculo de apoio: a imputação do atraso à Administração e o pagamento dependem de decisão.
 */
export function calcularAtualizacaoMonetaria(e: {
  valor: Centavos;
  adimplementoEm: DataISO;
  limitePagamento: DataISO;
  pagamentoEm: DataISO;
  indice: string;
  variacoes: readonly VariacaoMensalIndice[];
  jurosMensalPercentual: number;
}): ResultadoAtualizacaoMonetaria {
  exigirInteiro(e.valor, 'valor', 'ATUALIZACAO_INVALIDA', 0);
  exigirFinito(e.jurosMensalPercentual, 'jurosMensalPercentual', 'ATUALIZACAO_INVALIDA');
  if (e.jurosMensalPercentual < 0 || e.jurosMensalPercentual > 2) {
    throw new ErroDominio('ATUALIZACAO_INVALIDA', 'Os juros de mora devem ficar entre 0% e 2% ao mês.');
  }
  const adimplemento = lerData(e.adimplementoEm, 'adimplementoEm');
  const limite = lerData(e.limitePagamento, 'limitePagamento');
  const pagamento = lerData(e.pagamentoEm, 'pagamentoEm');
  if (limite < adimplemento) throw new ErroDominio('ATUALIZACAO_INVALIDA', 'O limite de pagamento não pode ser anterior ao adimplemento.');
  const fundamento = 'Lei 14.133/2021, art. 92, V e § 7º; cláusula de atualização monetária do contrato';
  const aviso =
    'Cálculo de apoio: a atualização só é devida quando o atraso for imputável à Administração. Confirme a causa do atraso antes de incluir o valor no pagamento; requer revisão humana.';
  const indice = e.indice.trim() || 'índice do contrato';
  if (pagamento <= limite) {
    return {
      devida: false,
      diasAtraso: 0,
      diasAtualizacao: 0,
      percentualIndice: 0,
      valorCorrecao: 0,
      valorJuros: 0,
      valorTotal: e.valor,
      competenciasSemIndice: [],
      memoriaCalculo: [`Pagamento dentro do limite de ${formatarData(e.limitePagamento)}: sem atualização.`],
      fundamento,
      aviso,
    };
  }
  const correcao = corrigirPorIndice({ valor: e.valor, de: e.adimplementoEm, ate: e.pagamentoEm, variacoes: e.variacoes });
  const diasAtualizacao = pagamento - adimplemento;
  const valorCorrecao = correcao.valorCorrigido - e.valor;
  const valorJuros = Math.round((e.valor * (e.jurosMensalPercentual / 100) * diasAtualizacao) / 30);
  const memoriaCalculo = [
    `Valor da parcela: ${formatarMoeda(e.valor)}.`,
    `Adimplemento em ${formatarData(e.adimplementoEm)}; limite de pagamento em ${formatarData(e.limitePagamento)}; pagamento em ${formatarData(e.pagamentoEm)} (${pagamento - limite} dia(s) de atraso).`,
    `Correção pelo ${indice}, pro rata die, de ${formatarData(e.adimplementoEm)} a ${formatarData(e.pagamentoEm)}: ${formatarNumero(correcao.percentual)}% = ${formatarMoeda(valorCorrecao)}.`,
    ...correcao.memoria,
    ...(correcao.competenciasSemIndice.length > 0
      ? [`Sem variação disponível em ${correcao.competenciasSemIndice.join(', ')}: considerado 0% até a divulgação do índice.`]
      : []),
    e.jurosMensalPercentual > 0
      ? `Juros de mora de ${formatarNumero(e.jurosMensalPercentual)}% ao mês, simples, pro rata die, por ${diasAtualizacao} dia(s): ${formatarMoeda(valorJuros)}.`
      : 'O contrato não prevê juros de mora.',
    `Total atualizado: ${formatarMoeda(e.valor + valorCorrecao + valorJuros)}.`,
  ];
  return {
    devida: true,
    diasAtraso: pagamento - limite,
    diasAtualizacao,
    percentualIndice: correcao.percentual,
    valorCorrecao,
    valorJuros,
    valorTotal: e.valor + valorCorrecao + valorJuros,
    competenciasSemIndice: correcao.competenciasSemIndice,
    memoriaCalculo,
    fundamento,
    aviso,
  };
}

// ───────────────────────── Decisão da autoridade e ordem cronológica (art. 141, § 1º) ─────────────────────────

/**
 * Confere os elementos mínimos do registro de uma decisão da autoridade competente: quem decidiu (nome e cargo),
 * o ato (número do despacho ou do documento no SEI), a data — nunca futura — e a justificativa por escrito.
 */
export function validarDecisaoAutoridade(e: {
  autoridade: string;
  ato: string;
  justificativa: string;
  decididaEm: DataISO;
  hoje: DataISO;
  minimoJustificativa?: number;
}): void {
  const minimo = e.minimoJustificativa ?? 50;
  if (typeof e.autoridade !== 'string' || e.autoridade.trim().length < 5) {
    throw new ErroDominio('DECISAO_INVALIDA', 'Informe o nome e o cargo da autoridade competente que decidiu.');
  }
  if (typeof e.ato !== 'string' || e.ato.trim().length < 3) {
    throw new ErroDominio('DECISAO_INVALIDA', 'Informe o ato da decisão (despacho ou documento no processo SEI).');
  }
  if (lerData(e.decididaEm, 'decididaEm') > lerData(e.hoje, 'hoje')) throw new ErroDominio('DECISAO_INVALIDA', 'A data da decisão não pode ser futura.');
  if (typeof e.justificativa !== 'string' || e.justificativa.trim().length < minimo) {
    throw new ErroDominio('DECISAO_INVALIDA', `Registre a justificativa da decisão com pelo menos ${minimo} caracteres.`);
  }
}

export type IncisoAlteracaoOrdem = 'I' | 'II' | 'III' | 'IV' | 'V';

/** Hipóteses taxativas do art. 141, § 1º, para alterar a ordem cronológica de pagamentos. */
export const HIPOTESES_ALTERACAO_ORDEM_CRONOLOGICA: readonly { inciso: IncisoAlteracaoOrdem; descricao: string; exigeRiscoDescontinuidade: boolean }[] = [
  { inciso: 'I', descricao: 'Grave perturbação da ordem, situação de emergência ou calamidade pública', exigeRiscoDescontinuidade: false },
  {
    inciso: 'II',
    descricao: 'Pagamento a microempresa, empresa de pequeno porte, agricultor familiar, produtor rural pessoa física, microempreendedor individual ou cooperativa',
    exigeRiscoDescontinuidade: true,
  },
  { inciso: 'III', descricao: 'Pagamento de serviços necessários ao funcionamento dos sistemas estruturantes', exigeRiscoDescontinuidade: true },
  { inciso: 'IV', descricao: 'Pagamento de direitos oriundos de contratos em caso de falência, recuperação judicial ou dissolução da contratada', exigeRiscoDescontinuidade: false },
  {
    inciso: 'V',
    descricao: 'Pagamento de contrato cujo objeto é imprescindível à integridade do patrimônio público ou ao funcionamento das atividades finalísticas',
    exigeRiscoDescontinuidade: true,
  },
];

/**
 * Valida o registro da alteração justificada da ordem cronológica (art. 141, § 1º): só nas cinco hipóteses do
 * parágrafo, com justificativa prévia da autoridade competente — a decisão não pode ser posterior ao pagamento
 * feito fora da ordem — e comunicação posterior ao controle interno e ao tribunal de contas, que ficam pendentes
 * até registradas. A inobservância imotivada gera apuração de responsabilidade (art. 141, § 2º).
 */
export function validarAlteracaoOrdemCronologica(e: {
  inciso: string;
  justificativa: string;
  autoridade: string;
  ato: string;
  decididaEm: DataISO;
  hoje: DataISO;
  /** Data em que a parcela foi paga, se já foi. */
  pagoEm: DataISO | null;
  /** A parcela é exigível (atestada ou liquidada) e ainda está na fila. */
  exigivel: boolean;
}): { inciso: IncisoAlteracaoOrdem; descricao: string; comunicacoesExigidas: ('controle_interno' | 'tribunal_contas')[]; avisos: string[]; fundamento: string } {
  const hipotese = HIPOTESES_ALTERACAO_ORDEM_CRONOLOGICA.find((h) => h.inciso === e.inciso);
  if (!hipotese) {
    throw new ErroDominio(
      'ALTERACAO_ORDEM_HIPOTESE_INVALIDA',
      'A ordem cronológica só pode ser alterada nas hipóteses dos incisos I a V do art. 141, § 1º.',
    );
  }
  validarDecisaoAutoridade({ autoridade: e.autoridade, ato: e.ato, justificativa: e.justificativa, decididaEm: e.decididaEm, hoje: e.hoje });
  if (!e.exigivel && e.pagoEm === null) {
    throw new ErroDominio(
      'ALTERACAO_ORDEM_NAO_EXIGIVEL',
      'A parcela ainda não é exigível (sem atesto): ela não entrou na fila da ordem cronológica.',
    );
  }
  if (e.pagoEm !== null && lerData(e.pagoEm, 'pagoEm') < lerData(e.decididaEm, 'decididaEm')) {
    throw new ErroDominio(
      'ALTERACAO_ORDEM_NAO_PREVIA',
      'A justificativa da autoridade tem de ser prévia ao pagamento fora da ordem (art. 141, § 1º): a decisão é posterior ao pagamento.',
    );
  }
  const avisos = hipotese.exigeRiscoDescontinuidade
    ? [`O inciso ${hipotese.inciso} exige demonstrar, na justificativa, o risco de descontinuidade do objeto ou do serviço.`]
    : [];
  avisos.push('Comunique a alteração ao controle interno e ao tribunal de contas e registre as comunicações; a justificativa é publicada com a ordem cronológica do mês (art. 141, § 3º).');
  return {
    inciso: hipotese.inciso,
    descricao: hipotese.descricao,
    comunicacoesExigidas: ['controle_interno', 'tribunal_contas'],
    avisos,
    fundamento: `Lei 14.133/2021, art. 141, § 1º, ${hipotese.inciso}`,
  };
}

export interface AlteracaoOrdemRegistrada {
  id: string;
  /** Parcela paga (ou a pagar) fora da ordem. */
  pagamentoId: string;
  comunicadaControleInterno: boolean;
  comunicadaTribunal: boolean;
}

export interface PreteridoClassificado {
  id: string;
  vencimento: DataISO;
  pagoEm: DataISO | null;
  posterioresPagos: number;
  posterioresJustificados: number;
  situacao: 'sem_justificativa' | 'comunicacao_pendente' | 'justificado';
  alteracoes: string[];
  fundamento: string;
}

/**
 * Cruza os pagamentos preteridos na ordem cronológica (mesma regra do achado preventivo do art. 141) com as
 * alterações justificadas registradas: a nota preterida só deixa de ser achado de risco quando todas as notas
 * posteriores pagas antes dela têm alteração registrada; sem as comunicações ao controle, fica "comunicação
 * pendente".
 */
export function classificarPreteridosComAlteracoes(
  pagamentos: readonly PagamentoOrdemCronologica[],
  alteracoes: readonly AlteracaoOrdemRegistrada[],
  hoje: DataISO,
): PreteridoClassificado[] {
  const dia = lerData(hoje, 'hoje');
  const porPagamento = new Map<string, AlteracaoOrdemRegistrada[]>();
  for (const a of alteracoes) porPagamento.set(a.pagamentoId, [...(porPagamento.get(a.pagamentoId) ?? []), a]);
  const porFonte = new Map<string, PagamentoOrdemCronologica[]>();
  for (const p of pagamentos) {
    lerData(p.vencimento, 'vencimento');
    if (p.pagoEm !== null) lerData(p.pagoEm, 'pagoEm');
    porFonte.set(p.fonteRecurso, [...(porFonte.get(p.fonteRecurso) ?? []), p]);
  }
  const resultado: PreteridoClassificado[] = [];
  for (const lista of porFonte.values()) {
    const pagos = lista.filter((p) => p.pagoEm !== null && lerData(p.pagoEm) <= dia);
    for (const q of lista) {
      if (!q.exigivel) continue;
      const posteriores = pagos.filter((p) => {
        const pagoEm = p.pagoEm as DataISO;
        return p.id !== q.id && p.vencimento > q.vencimento && q.vencimento <= pagoEm && (q.pagoEm === null || q.pagoEm > pagoEm);
      });
      if (posteriores.length === 0) continue;
      const cobertos = posteriores.filter((p) => porPagamento.has(p.id));
      const alteracoesUsadas = cobertos.flatMap((p) => porPagamento.get(p.id) ?? []);
      const comunicacaoPendente = alteracoesUsadas.some((a) => !a.comunicadaControleInterno || !a.comunicadaTribunal);
      resultado.push({
        id: q.id,
        vencimento: q.vencimento,
        pagoEm: q.pagoEm,
        posterioresPagos: posteriores.length,
        posterioresJustificados: cobertos.length,
        situacao: cobertos.length < posteriores.length ? 'sem_justificativa' : comunicacaoPendente ? 'comunicacao_pendente' : 'justificado',
        alteracoes: [...new Set(alteracoesUsadas.map((a) => a.id))],
        fundamento: 'Lei 14.133/2021, art. 141, caput e §§ 1º e 2º',
      });
    }
  }
  return resultado.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.id.localeCompare(b.id)));
}
