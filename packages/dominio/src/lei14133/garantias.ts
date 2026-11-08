/**
 * Garantias contratuais (Lei 14.133/2021, arts. 96 a 102; RN-35) e desconto de multa (art. 156, § 8º).
 *
 * - modalidades à escolha da contratada (art. 96, § 1º): caução em dinheiro ou em títulos da dívida pública,
 *   seguro-garantia, fiança bancária e título de capitalização de pagamento único (incluído pela Lei 14.770/2023);
 * - percentual de até 5% do valor inicial, até 10% com justificativa da complexidade técnica e dos riscos (art. 98)
 *   e até 30% nas obras e serviços de engenharia de grande vulto, em seguro-garantia com cláusula de retomada
 *   (arts. 99 e 102); nos contínuos com vigência acima de um ano, sobre o valor anual (art. 98, parágrafo único);
 * - garantia adicional para pagamento antecipado (art. 145, § 2º);
 * - validade, renovação, liberação depois da fiel execução — atualizada a caução em dinheiro — (art. 100) e
 *   execução (art. 139, III);
 * - multa: descontada primeiro dos pagamentos devidos à contratada, depois da garantia, e o restante cobrado
 *   judicialmente (art. 156, § 8º).
 *
 * Funções puras: quem exige, aceita, libera e executa a garantia é a Administração, por decisão registrada.
 */
import { ErroDominio } from '../erros.ts';
import { diasEntre, formatarData, type DataISO } from '../datas.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';
import { exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';
import { corrigirPorIndice, type VariacaoMensalIndice } from './execucao-contratual.ts';

export type ModalidadeGarantia = 'caucao_dinheiro' | 'caucao_titulos' | 'seguro_garantia' | 'fianca_bancaria' | 'titulo_capitalizacao';

export const MODALIDADES_GARANTIA: readonly ModalidadeGarantia[] = ['caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria', 'titulo_capitalizacao'];

export const ROTULOS_MODALIDADE_GARANTIA: Readonly<Record<ModalidadeGarantia, string>> = {
  caucao_dinheiro: 'Caução em dinheiro',
  caucao_titulos: 'Caução em títulos da dívida pública',
  seguro_garantia: 'Seguro-garantia',
  fianca_bancaria: 'Fiança bancária',
  titulo_capitalizacao: 'Título de capitalização',
};

export type FinalidadeGarantia = 'execucao' | 'antecipacao';

/** Antecedência, em dias, do alerta de vencimento da garantia (a mesma da central de notificações). */
export const ANTECEDENCIA_ALERTA_GARANTIA_DIAS = 30;

/**
 * Base de cálculo da garantia de execução (art. 98): o valor inicial do contrato ou, nos serviços e fornecimentos
 * contínuos com vigência superior a um ano, o valor anual (parágrafo único), proporcional aos dias de vigência.
 */
export function baseCalculoGarantia(e: { valorInicial: Centavos; vigenciaInicio: DataISO; vigenciaFim: DataISO; continuo: boolean }): {
  valorBase: Centavos;
  anual: boolean;
  fundamento: string;
} {
  exigirInteiro(e.valorInicial, 'valorInicial', 'GARANTIA_INVALIDA', 0);
  const dias = diasEntre(e.vigenciaInicio, e.vigenciaFim) + 1;
  if (dias <= 0) throw new ErroDominio('GARANTIA_INVALIDA', 'A vigência do contrato é inválida.');
  if (e.continuo && dias > 366) {
    return {
      valorBase: Math.round((e.valorInicial * 365) / dias),
      anual: true,
      fundamento: 'Lei 14.133/2021, art. 98, parágrafo único (valor anual do contrato contínuo)',
    };
  }
  return { valorBase: e.valorInicial, anual: false, fundamento: 'Lei 14.133/2021, art. 98, caput (valor inicial do contrato)' };
}

export interface AvaliacaoPercentualGarantia {
  valorExigido: Centavos;
  limitePercentual: number;
  permitido: boolean;
  motivos: string[];
  fundamento: string;
}

/**
 * Confere o percentual exigido (RN-35):
 * - execução: até 5% sem condição; acima de 5% e até 10%, justificativa da complexidade técnica e dos riscos
 *   (art. 98); acima de 10% e até 30%, só em obra ou serviço de engenharia de grande vulto, em seguro-garantia com
 *   cláusula de retomada (arts. 99 e 102) e com justificativa; acima de 30%, vedado;
 * - antecipação de pagamento: garantia adicional de até 100% do valor antecipado (art. 145, § 2º).
 */
export function avaliarPercentualGarantia(e: {
  finalidade: FinalidadeGarantia;
  valorBase: Centavos;
  percentual: number;
  justificativa: string | null;
  grandeVultoEngenharia: boolean;
  clausulaRetomada: boolean;
  modalidadeExigida: ModalidadeGarantia | null;
}): AvaliacaoPercentualGarantia {
  exigirInteiro(e.valorBase, 'valorBase', 'GARANTIA_INVALIDA', 1);
  exigirFinito(e.percentual, 'percentual', 'GARANTIA_PERCENTUAL_INVALIDO');
  if (e.percentual <= 0) throw new ErroDominio('GARANTIA_PERCENTUAL_INVALIDO', 'O percentual da garantia deve ser maior que zero.');
  const valorExigido = Math.round((e.valorBase * e.percentual) / 100);
  const justificativa = (e.justificativa ?? '').trim();
  const motivos: string[] = [];
  if (e.finalidade === 'antecipacao') {
    if (e.percentual > 100) motivos.push('A garantia adicional da antecipação vai até 100% do valor antecipado.');
    return { valorExigido, limitePercentual: 100, permitido: motivos.length === 0, motivos, fundamento: 'Lei 14.133/2021, art. 145, § 2º' };
  }
  if (e.percentual <= 5) return { valorExigido, limitePercentual: 5, permitido: true, motivos, fundamento: 'Lei 14.133/2021, art. 98, caput' };
  if (e.percentual <= 10) {
    if (justificativa.length < 30) motivos.push('Acima de 5%, a majoração até 10% exige justificativa da complexidade técnica e dos riscos (art. 98).');
    return { valorExigido, limitePercentual: 10, permitido: motivos.length === 0, motivos, fundamento: 'Lei 14.133/2021, art. 98, caput' };
  }
  if (e.percentual > 30) motivos.push('A garantia de execução não pode passar de 30% do valor inicial (art. 99).');
  if (!e.grandeVultoEngenharia) motivos.push('Acima de 10%, só em obra ou serviço de engenharia de grande vulto (art. 99).');
  if (!e.clausulaRetomada) motivos.push('Acima de 10%, a garantia exige a cláusula de retomada pela seguradora (arts. 99 e 102).');
  if (e.modalidadeExigida !== 'seguro_garantia') motivos.push('Acima de 10%, a modalidade é o seguro-garantia (art. 99).');
  if (justificativa.length < 30) motivos.push('Justifique a exigência acima de 10% com pelo menos 30 caracteres.');
  return { valorExigido, limitePercentual: 30, permitido: motivos.length === 0, motivos, fundamento: 'Lei 14.133/2021, arts. 99 e 102' };
}

/**
 * Confere a apresentação da garantia pela contratada (art. 96): valor igual ou maior que o exigido, emissor e número
 * do documento nas modalidades que os têm, validade posterior à apresentação. Avisa quando a apresentação passou do
 * prazo e quando a validade não cobre a vigência do contrato (no seguro-garantia, a apólice acompanha o contrato
 * principal, art. 97).
 */
export function validarApresentacaoGarantia(e: {
  modalidade: ModalidadeGarantia;
  valor: Centavos;
  valorExigido: Centavos;
  apresentadaEm: DataISO;
  prazoApresentacao: DataISO | null;
  validaAte: DataISO;
  vigenciaFimContrato: DataISO;
  emissor: string | null;
  documento: string | null;
  hoje: DataISO;
}): { avisos: string[]; fundamento: string } {
  if (!MODALIDADES_GARANTIA.includes(e.modalidade)) throw new ErroDominio('GARANTIA_INVALIDA', `Modalidade desconhecida: ${String(e.modalidade)}.`);
  exigirInteiro(e.valor, 'valor', 'GARANTIA_INVALIDA', 1);
  exigirInteiro(e.valorExigido, 'valorExigido', 'GARANTIA_INVALIDA', 0);
  if (e.valor < e.valorExigido) {
    throw new ErroDominio('GARANTIA_INSUFICIENTE', `A garantia apresentada (${formatarMoeda(e.valor)}) é menor que a exigida (${formatarMoeda(e.valorExigido)}).`);
  }
  const apresentada = lerData(e.apresentadaEm, 'apresentadaEm');
  if (apresentada > lerData(e.hoje, 'hoje')) throw new ErroDominio('GARANTIA_INVALIDA', 'A data de apresentação não pode ser futura.');
  if (lerData(e.validaAte, 'validaAte') <= apresentada) throw new ErroDominio('GARANTIA_INVALIDA', 'A validade da garantia deve ser posterior à apresentação.');
  const exigeEmissor = e.modalidade === 'seguro_garantia' || e.modalidade === 'fianca_bancaria' || e.modalidade === 'titulo_capitalizacao';
  if (exigeEmissor && (e.emissor ?? '').trim().length < 3) {
    throw new ErroDominio('GARANTIA_INVALIDA', 'Informe a seguradora, o banco ou a sociedade de capitalização emissora.');
  }
  if (e.modalidade !== 'caucao_dinheiro' && (e.documento ?? '').trim().length < 3) {
    throw new ErroDominio('GARANTIA_INVALIDA', 'Informe o número da apólice, da carta de fiança, do título ou da custódia.');
  }
  const avisos: string[] = [];
  if (e.prazoApresentacao !== null && apresentada > lerData(e.prazoApresentacao, 'prazoApresentacao')) {
    avisos.push(`Garantia apresentada depois do prazo de ${formatarData(e.prazoApresentacao)}: registre a providência adotada no processo.`);
  }
  if (lerData(e.validaAte) < lerData(e.vigenciaFimContrato, 'vigenciaFimContrato')) {
    avisos.push(
      `A validade (${formatarData(e.validaAte)}) termina antes do fim da vigência do contrato (${formatarData(e.vigenciaFimContrato)}): exija a renovação antes do vencimento${e.modalidade === 'seguro_garantia' ? ' — a apólice deve acompanhar a vigência do contrato (art. 97)' : ''}.`,
    );
  }
  return { avisos, fundamento: 'Lei 14.133/2021, arts. 96 e 97' };
}

export type SituacaoRegistroGarantia = 'aguardando_apresentacao' | 'vigente' | 'liberada' | 'executada';
export type SituacaoGarantia = 'aguardando_apresentacao' | 'apresentacao_vencida' | 'vigente' | 'vence_em_breve' | 'vencida' | 'liberada' | 'executada';

const ROTULOS_SITUACAO_GARANTIA: Record<SituacaoGarantia, string> = {
  aguardando_apresentacao: 'Aguardando apresentação',
  apresentacao_vencida: 'Apresentação vencida',
  vigente: 'Vigente',
  vence_em_breve: 'Vence em breve',
  vencida: 'Vencida',
  liberada: 'Liberada',
  executada: 'Executada',
};

/**
 * Situação exibida da garantia: aguardando ou com a apresentação vencida, vigente, vencendo nos próximos 30 dias,
 * vencida, liberada ou executada. Alerta quando a validade não cobre a vigência do contrato ou quando o saldo
 * ficou abaixo do valor exigido (recomposição depois de desconto ou execução).
 */
export function situacaoGarantia(e: {
  situacaoRegistro: SituacaoRegistroGarantia;
  prazoApresentacao: DataISO | null;
  validaAte: DataISO | null;
  vigenciaFimContrato: DataISO;
  saldo: Centavos;
  valorExigido: Centavos;
  hoje: DataISO;
  antecedenciaDias?: number;
}): { situacao: SituacaoGarantia; rotulo: string; diasParaVencer: number | null; alertas: string[] } {
  const antecedencia = e.antecedenciaDias ?? ANTECEDENCIA_ALERTA_GARANTIA_DIAS;
  const alertas: string[] = [];
  const montar = (situacao: SituacaoGarantia, dias: number | null) => ({ situacao, rotulo: ROTULOS_SITUACAO_GARANTIA[situacao], diasParaVencer: dias, alertas });
  if (e.situacaoRegistro === 'liberada') return montar('liberada', null);
  if (e.situacaoRegistro === 'executada') return montar('executada', null);
  if (e.situacaoRegistro === 'aguardando_apresentacao') {
    if (e.prazoApresentacao !== null && diasEntre(e.hoje, e.prazoApresentacao) < 0) {
      alertas.push(`O prazo de apresentação venceu em ${formatarData(e.prazoApresentacao)}: notifique a contratada.`);
      return montar('apresentacao_vencida', null);
    }
    return montar('aguardando_apresentacao', null);
  }
  if (e.validaAte === null) return montar('vigente', null);
  const dias = diasEntre(e.hoje, e.validaAte);
  if (e.validaAte < e.vigenciaFimContrato && e.hoje <= e.vigenciaFimContrato) alertas.push('A validade termina antes do fim da vigência do contrato: exija a renovação.');
  if (e.saldo < e.valorExigido) alertas.push(`Saldo de ${formatarMoeda(e.saldo)} abaixo do exigido (${formatarMoeda(e.valorExigido)}): exija a recomposição da garantia.`);
  if (dias < 0) return montar('vencida', dias);
  if (dias <= antecedencia) return montar('vence_em_breve', dias);
  return montar('vigente', dias);
}

/**
 * Liberação ou restituição da garantia (art. 100): depois da fiel execução do contrato — vigência encerrada, todas
 * as entregas recebidas definitivamente e sem ocorrência aberta — ou da extinção por culpa exclusiva da
 * Administração. Multas aplicadas e ainda não quitadas impedem a liberação: antes, são descontadas (art. 156, § 8º).
 * A caução em dinheiro é restituída com atualização monetária.
 */
export function avaliarLiberacaoGarantia(e: {
  situacaoRegistro: SituacaoRegistroGarantia;
  vigenciaEncerrada: boolean;
  recebimentosPendentes: number;
  ocorrenciasAbertas: number;
  saldoMultasPendentes: Centavos;
  extincaoCulpaAdministracao: boolean;
}): { permitido: boolean; motivos: string[]; fundamento: string } {
  const motivos: string[] = [];
  if (e.situacaoRegistro !== 'vigente') motivos.push('Só a garantia apresentada e vigente pode ser liberada.');
  if (!e.extincaoCulpaAdministracao) {
    if (!e.vigenciaEncerrada) motivos.push('A execução do contrato ainda não terminou: a garantia acompanha a vigência.');
    if (e.recebimentosPendentes > 0) motivos.push(`Há ${e.recebimentosPendentes} entrega(s) sem recebimento definitivo.`);
    if (e.ocorrenciasAbertas > 0) motivos.push(`Há ${e.ocorrenciasAbertas} ocorrência(s) abertas no livro do contrato.`);
  }
  if (e.saldoMultasPendentes > 0) motivos.push(`Há ${formatarMoeda(e.saldoMultasPendentes)} de multa aplicada ainda não descontada (art. 156, § 8º).`);
  return { permitido: motivos.length === 0, motivos, fundamento: 'Lei 14.133/2021, art. 100' };
}

/** Restituição da caução em dinheiro atualizada monetariamente desde o depósito (art. 100). */
export function atualizarCaucaoDinheiro(e: { saldo: Centavos; depositadaEm: DataISO; restituidaEm: DataISO; variacoes: readonly VariacaoMensalIndice[] }): {
  valorRestituido: Centavos;
  percentual: number;
  competenciasSemIndice: string[];
  fundamento: string;
} {
  const r = corrigirPorIndice({ valor: e.saldo, de: e.depositadaEm, ate: e.restituidaEm, variacoes: e.variacoes });
  return { valorRestituido: r.valorCorrigido, percentual: r.percentual, competenciasSemIndice: r.competenciasSemIndice, fundamento: 'Lei 14.133/2021, art. 100' };
}

export type MotivoExecucaoGarantia = 'ressarcimento_prejuizos' | 'verbas_trabalhistas' | 'retomada_seguradora';

/**
 * Execução da garantia (art. 139, III): ressarcimento de prejuízos, verbas trabalhistas, fundiárias e
 * previdenciárias, ou a retomada da execução pela seguradora (cláusula do art. 102). As multas seguem o fluxo de
 * desconto (art. 156, § 8º). O valor não passa do saldo; a retomada só cabe no seguro-garantia com a cláusula.
 */
export function avaliarExecucaoGarantia(e: {
  situacaoRegistro: SituacaoRegistroGarantia;
  modalidade: ModalidadeGarantia | null;
  clausulaRetomada: boolean;
  saldo: Centavos;
  valor: Centavos;
  motivo: MotivoExecucaoGarantia;
}): { saldoFinal: Centavos; fundamento: string } {
  if (e.situacaoRegistro !== 'vigente') throw new ErroDominio('GARANTIA_INDISPONIVEL', 'Só a garantia apresentada e vigente pode ser executada.');
  exigirInteiro(e.valor, 'valor', 'GARANTIA_INVALIDA', 1);
  if (e.valor > e.saldo) throw new ErroDominio('GARANTIA_INSUFICIENTE', `O valor (${formatarMoeda(e.valor)}) passa do saldo da garantia (${formatarMoeda(e.saldo)}).`);
  if (e.motivo === 'retomada_seguradora' && (e.modalidade !== 'seguro_garantia' || !e.clausulaRetomada)) {
    throw new ErroDominio('GARANTIA_INVALIDA', 'A retomada pela seguradora só cabe no seguro-garantia com cláusula de retomada (art. 102).');
  }
  const alinea = e.motivo === 'ressarcimento_prejuizos' ? 'a' : e.motivo === 'verbas_trabalhistas' ? 'b' : 'd';
  return { saldoFinal: e.saldo - e.valor, fundamento: `Lei 14.133/2021, art. 139, III, "${alinea}"` };
}

export interface PlanoDescontoMulta {
  valor: Centavos;
  pagamentos: { id: string; valor: Centavos }[];
  garantia: Centavos;
  /** Parte que nem os pagamentos devidos nem a garantia cobrem: cobrança judicial (ou desconto futuro). */
  remanescente: Centavos;
  memoria: string[];
  fundamento: string;
}

/**
 * Plano de desconto de multa aplicada (art. 156, § 8º): o valor decidido pela autoridade é retido primeiro dos
 * pagamentos devidos à contratada (na ordem informada, das parcelas mais antigas para as mais novas), depois do saldo
 * da garantia; o que sobrar é cobrado judicialmente. Só calcula: a retenção é decisão da autoridade competente.
 */
export function planejarDescontoMulta(e: {
  saldoMulta: Centavos;
  pagamentosDevidos: readonly { id: string; disponivel: Centavos }[];
  saldoGarantia: Centavos;
  valorDecidido?: Centavos;
}): PlanoDescontoMulta {
  exigirInteiro(e.saldoMulta, 'saldoMulta', 'DESCONTO_MULTA_INVALIDO', 0);
  exigirInteiro(e.saldoGarantia, 'saldoGarantia', 'DESCONTO_MULTA_INVALIDO', 0);
  if (e.saldoMulta === 0) throw new ErroDominio('DESCONTO_MULTA_INVALIDO', 'A multa já foi integralmente descontada.');
  const valor = e.valorDecidido ?? e.saldoMulta;
  exigirInteiro(valor, 'valorDecidido', 'DESCONTO_MULTA_INVALIDO', 1);
  if (valor > e.saldoMulta) {
    throw new ErroDominio('DESCONTO_MULTA_INVALIDO', `O valor decidido (${formatarMoeda(valor)}) passa do saldo da multa (${formatarMoeda(e.saldoMulta)}).`);
  }
  let restante = valor;
  const pagamentos: { id: string; valor: Centavos }[] = [];
  for (const p of e.pagamentosDevidos) {
    exigirInteiro(p.disponivel, 'disponivel', 'DESCONTO_MULTA_INVALIDO', 0);
    if (restante === 0) break;
    const parte = Math.min(restante, p.disponivel);
    if (parte > 0) {
      pagamentos.push({ id: p.id, valor: parte });
      restante -= parte;
    }
  }
  const garantia = Math.min(restante, e.saldoGarantia);
  restante -= garantia;
  const totalPagamentos = pagamentos.reduce((s, p) => s + p.valor, 0);
  const memoria = [
    `Valor a descontar por decisão da autoridade: ${formatarMoeda(valor)} (saldo da multa: ${formatarMoeda(e.saldoMulta)}).`,
    `1º — pagamentos devidos à contratada: ${formatarMoeda(totalPagamentos)} em ${pagamentos.length} parcela(s).`,
    `2º — garantia contratual (saldo de ${formatarMoeda(e.saldoGarantia)}): ${formatarMoeda(garantia)}.`,
    restante > 0
      ? `3º — sem pagamento devido nem saldo de garantia: ${formatarMoeda(restante)} para cobrança judicial.`
      : '3º — nada a cobrar judicialmente.',
  ];
  return { valor, pagamentos, garantia, remanescente: restante, memoria, fundamento: 'Lei 14.133/2021, art. 156, § 8º' };
}

/** Percentual da garantia em texto (ex.: "5%"), para termos e telas. */
export function descreverPercentualGarantia(percentual: number, valorBase: Centavos): string {
  exigirFinito(percentual, 'percentual', 'GARANTIA_PERCENTUAL_INVALIDO');
  return `${formatarNumero(percentual)}% de ${formatarMoeda(valorBase)}`;
}
