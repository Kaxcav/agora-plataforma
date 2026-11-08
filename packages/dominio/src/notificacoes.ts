/**
 * Central de notificações (RF-26) e avisos automáticos de vencimento (RN-31).
 *
 * Funções puras: "hoje" e "agora" entram como parâmetro. A Ágora gera os avisos e registra os envios; as
 * providências (prorrogar, reajustar, exigir garantia, aplicar sanção) continuam sendo decisão humana.
 */
import { ErroDominio } from './erros.ts';
import { type DataISO, formatarData } from './datas.ts';
import { classificarVigencia } from './vigencia.ts';
import { adicionarMeses, exigirInteiro, lerData } from './interno.ts';

export type TipoNotificacao = 'vencimento' | 'reajuste' | 'garantia' | 'pendencia' | 'ocorrencia';
export type CanalNotificacao = 'email' | 'sei' | 'govbr';
/** gestor, fiscal e responsável são servidores com conta na Ágora; a contratada é a parte externa do contrato. */
export type PapelDestinatario = 'gestor' | 'fiscal' | 'contratada' | 'responsavel';
/** Faixas do semáforo em que a varredura diária gera aviso (RN-31). */
export type FaixaVencimento = 30 | 60 | 90 | 120;

export const TIPOS_NOTIFICACAO: readonly TipoNotificacao[] = ['vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia'];
export const CANAIS_NOTIFICACAO: readonly CanalNotificacao[] = ['email', 'sei', 'govbr'];
/** Da mais distante para a mais próxima do fim da vigência. */
export const FAIXAS_VENCIMENTO: readonly FaixaVencimento[] = [120, 90, 60, 30];

/** Antecedência dos avisos automáticos de reajuste e de garantia. */
export const ANTECEDENCIA_AVISO_DIAS = 30;
/** Intervalo, em minutos, antes de cada nova tentativa de envio (1ª falha → 1 min; 2ª → 5 min...). */
export const INTERVALOS_NOVA_TENTATIVA_MIN: readonly number[] = [1, 5, 15, 60];
/** Total de tentativas de um envio antes de marcá-lo como falho (o reenvio manual cria um novo envio). */
export const MAXIMO_TENTATIVAS_ENVIO = 5;

const LIMITE_COMPLEMENTO = 2000;
const MINIMO_DETALHE_OCORRENCIA = 20;

const FUNDAMENTO_VENCIMENTO: Record<'ata' | 'contrato', string> = {
  ata: 'Lei 14.133/2021, art. 84 (vigência e prorrogação da ata de registro de preços)',
  contrato: 'Lei 14.133/2021, arts. 105 a 107 (duração e prorrogação dos contratos) e art. 117 (fiscalização)',
};

const FUNDAMENTOS: Record<TipoNotificacao, string> = {
  vencimento: 'Lei 14.133/2021, art. 84 (vigência da ata), arts. 105 a 107 (duração e prorrogação dos contratos) e art. 117 (fiscalização)',
  reajuste: 'Lei 14.133/2021, art. 25, § 7º, e art. 92, V e § 3º (reajuste pelo índice e data-base do contrato)',
  garantia: 'Lei 14.133/2021, arts. 96 a 102 (garantias contratuais) e art. 92, XII',
  pendencia: 'Lei 14.133/2021, art. 117 (acompanhamento da execução) e art. 141 (ordem cronológica de pagamentos)',
  ocorrencia: 'Lei 14.133/2021, art. 117, § 1º (registro das ocorrências e determinação de regularização) e art. 119',
};

/**
 * Faixa de aviso para os dias que faltam até o fim da vigência: até 30 → 30; 31 a 60 → 60; 61 a 90 → 90;
 * 91 a 120 → 120. Fora disso (vencido ou mais de 120 dias), null.
 * Fundamento: Lei 14.133/2021, arts. 84 e 105 a 107 (RN-31).
 */
export function faixaVencimento(diasRestantes: number): FaixaVencimento | null {
  exigirInteiro(diasRestantes, 'diasRestantes', 'DIAS_INVALIDOS');
  if (diasRestantes < 0) return null;
  if (diasRestantes <= 30) return 30;
  if (diasRestantes <= 60) return 60;
  if (diasRestantes <= 90) return 90;
  if (diasRestantes <= 120) return 120;
  return null;
}

/**
 * Avisos legais obrigatórios, que não podem ser desativados nas preferências:
 * - ocorrência na execução: a fiscalização registra e determina a regularização (art. 117, § 1º), e a
 *   contratada responde pelos vícios e defeitos (art. 119);
 * - vencimento na faixa de 30 dias: última janela para formalizar a prorrogação durante a vigência
 *   (arts. 105 a 107) ou garantir a continuidade do serviço por nova contratação.
 */
export function avisoObrigatorio(tipo: TipoNotificacao, faixa: FaixaVencimento | null): boolean {
  if (!TIPOS_NOTIFICACAO.includes(tipo)) throw new ErroDominio('NOTIFICACAO_INVALIDA', `Tipo de notificação desconhecido: ${String(tipo)}.`);
  if (tipo === 'ocorrencia') return true;
  return tipo === 'vencimento' && faixa === 30;
}

export interface AvisoVencimento {
  diasRestantes: number;
  faixa: FaixaVencimento;
  obrigatorio: boolean;
  rotulo: string;
}

/**
 * Aviso de vencimento devido hoje para um contrato ou ata (RN-31): a faixa atual do semáforo, ou null se o
 * instrumento já venceu ou ainda está a mais de 120 dias do fim. A varredura gera um único aviso por
 * instrumento, faixa e data de fim de vigência; a prorrogação muda a data de fim e reinicia o ciclo.
 * Fundamento: Lei 14.133/2021, art. 84 (atas) e arts. 105 a 107 (contratos).
 */
export function avaliarAvisoVencimento(vigenciaFim: DataISO, hoje: DataISO): AvisoVencimento | null {
  const vigencia = classificarVigencia(vigenciaFim, hoje);
  const faixa = faixaVencimento(vigencia.diasRestantes);
  if (faixa === null) return null;
  return { diasRestantes: vigencia.diasRestantes, faixa, obrigatorio: avisoObrigatorio('vencimento', faixa), rotulo: vigencia.rotulo };
}

/**
 * Próximo aniversário da data-base do reajuste (data-base + 12, 24, 36... meses) e os dias até ele, quando
 * cair dentro da antecedência de aviso (padrão de 30 dias). Antes do 1º aniversário não há reajuste.
 * Fundamento: Lei 14.133/2021, art. 25, § 7º, e art. 92, § 3º (anualidade contada da data do orçamento estimado).
 */
export function avaliarAvisoReajuste(
  dataBase: DataISO,
  hoje: DataISO,
  antecedenciaDias = ANTECEDENCIA_AVISO_DIAS,
): { aniversario: DataISO; diasAte: number } | null {
  exigirInteiro(antecedenciaDias, 'antecedenciaDias', 'DIAS_INVALIDOS', 0);
  const base = lerData(dataBase, 'dataBase');
  const diaHoje = lerData(hoje, 'hoje');
  // Salta direto para perto de hoje e ajusta: aniversário é sempre data-base + 12·k meses (k ≥ 1).
  let anos = Math.max(1, Math.floor((diaHoje - base) / 366));
  let aniversario = adicionarMeses(dataBase, 12 * anos);
  while (lerData(aniversario) < diaHoje) {
    anos += 1;
    aniversario = adicionarMeses(dataBase, 12 * anos);
  }
  while (anos > 1 && lerData(adicionarMeses(dataBase, 12 * (anos - 1))) >= diaHoje) {
    anos -= 1;
    aniversario = adicionarMeses(dataBase, 12 * anos);
  }
  const diasAte = lerData(aniversario) - diaHoje;
  return diasAte <= antecedenciaDias ? { aniversario, diasAte } : null;
}

/**
 * Garantia contratual que perde a validade dentro da antecedência de aviso (padrão de 30 dias), ou null.
 * Fundamento: Lei 14.133/2021, arts. 96 a 102 (a garantia acompanha a execução do contrato).
 */
export function avaliarAvisoGarantia(validaAte: DataISO, hoje: DataISO, antecedenciaDias = ANTECEDENCIA_AVISO_DIAS): { diasRestantes: number } | null {
  exigirInteiro(antecedenciaDias, 'antecedenciaDias', 'DIAS_INVALIDOS', 0);
  const diasRestantes = lerData(validaAte, 'validaAte') - lerData(hoje, 'hoje');
  return diasRestantes >= 0 && diasRestantes <= antecedenciaDias ? { diasRestantes } : null;
}

/**
 * Base legal do tratamento do contato do destinatário, registrada em cada envio (LGPD, art. 37).
 * Servidores: obrigação legal e execução de política pública pela Administração (gestão e fiscalização do
 * contrato). Contratada: obrigação legal e execução do contrato de que é parte.
 */
export function baseLegalEnvio(papel: PapelDestinatario): string {
  if (papel === 'contratada') {
    return 'Lei 13.709/2018 (LGPD), art. 7º, II e V: cumprimento de obrigação legal e execução do contrato de que a contratada é parte (Lei 14.133/2021, arts. 92 e 117, § 1º).';
  }
  if (papel === 'gestor' || papel === 'fiscal' || papel === 'responsavel') {
    return 'Lei 13.709/2018 (LGPD), art. 7º, II e III, e art. 23: cumprimento de obrigação legal e execução de política pública pela Administração (gestão e fiscalização do contrato, Lei 14.133/2021, art. 117).';
  }
  throw new ErroDominio('NOTIFICACAO_INVALIDA', `Papel de destinatário desconhecido: ${String(papel)}.`);
}

/** Preferência padrão de quem nunca alterou as preferências: e-mail ligado; gov.br desligado (adesão do usuário). */
export function preferenciaPadrao(canal: CanalNotificacao): boolean {
  return canal === 'email' || canal === 'sei';
}

export interface EntradaEntrega {
  canal: CanalNotificacao;
  papel: PapelDestinatario;
  obrigatoria: boolean;
  /** Preferência gravada pelo servidor para o tipo e o canal (null = nunca alterou). Ignorada para a contratada. */
  preferencia: boolean | null;
  /** O gov.br entrega mensagens a pessoas físicas (CPF). */
  destinatarioPessoaFisica: boolean;
}

/**
 * Decide se um envio sai ou é suprimido, e por quê:
 * - SEI é registro no processo (não é preferência pessoal) e sempre sai;
 * - gov.br só atende pessoa física e, para servidores, depende de adesão (preferência ligada), mesmo nos avisos
 *   obrigatórios, que seguem pelo e-mail institucional;
 * - aviso obrigatório sai por e-mail mesmo com a preferência desligada;
 * - a contratada não tem preferências na Ágora (o aviso decorre do contrato);
 * - para servidores, vale a preferência gravada ou o padrão (e-mail ligado, gov.br desligado).
 */
export function decidirEntregaNotificacao(e: EntradaEntrega): { enviar: boolean; motivo: string | null } {
  if (!CANAIS_NOTIFICACAO.includes(e.canal)) throw new ErroDominio('NOTIFICACAO_INVALIDA', `Canal desconhecido: ${String(e.canal)}.`);
  baseLegalEnvio(e.papel);
  if (e.canal === 'sei') return { enviar: true, motivo: null };
  if (e.canal === 'govbr' && !e.destinatarioPessoaFisica) {
    return { enviar: false, motivo: 'O gov.br entrega mensagens apenas a pessoas físicas (CPF). Use o e-mail ou o SEI para a contratada.' };
  }
  if (e.papel === 'contratada') return { enviar: true, motivo: null };
  if (e.canal === 'govbr' && e.preferencia !== true) {
    return { enviar: false, motivo: 'O destinatário não aderiu ao recebimento de avisos pelo gov.br (preferências de notificação).' };
  }
  if (e.obrigatoria) return { enviar: true, motivo: null };
  const ativo = e.preferencia ?? preferenciaPadrao(e.canal);
  if (ativo) return { enviar: true, motivo: null };
  return {
    enviar: false,
    motivo: `O destinatário optou por não receber este tipo de aviso por ${e.canal === 'email' ? 'e-mail' : 'gov.br'}.`,
  };
}

/**
 * Instante da próxima tentativa depois de `tentativasRealizadas` falhas, ou null quando o envio esgotou as
 * tentativas e deve ser marcado como falho. Intervalos crescentes: 1, 5, 15 e 60 minutos.
 */
export function proximaTentativa(tentativasRealizadas: number, agora: string, maximo = MAXIMO_TENTATIVAS_ENVIO): string | null {
  exigirInteiro(tentativasRealizadas, 'tentativasRealizadas', 'TENTATIVA_INVALIDA', 1);
  exigirInteiro(maximo, 'maximo', 'TENTATIVA_INVALIDA', 1);
  const instante = typeof agora === 'string' ? Date.parse(agora) : Number.NaN;
  if (Number.isNaN(instante)) throw new ErroDominio('TENTATIVA_INVALIDA', `agora deve ser um instante ISO 8601 (recebido: ${String(agora)}).`);
  if (tentativasRealizadas >= maximo) return null;
  const intervalo = INTERVALOS_NOVA_TENTATIVA_MIN[Math.min(tentativasRealizadas, INTERVALOS_NOVA_TENTATIVA_MIN.length) - 1] ?? 60;
  return new Date(instante + intervalo * 60_000).toISOString();
}

export interface InstrumentoMensagem {
  tipo: 'ata' | 'contrato';
  /** "Contrato 12/2025", "Ata 7/2026". */
  identificador: string;
  objeto: string;
  uasg: string;
  processoSei?: string | null;
  vigenciaFim: DataISO;
  /** Razão social da contratada (contratos). */
  fornecedor?: string | null;
  /** IPCA, ICTI... (reajuste). */
  indiceReajuste?: string | null;
}

export interface EntradaMensagemNotificacao {
  tipo: TipoNotificacao;
  origem: 'automatica' | 'manual';
  hoje: DataISO;
  instrumento: InstrumentoMensagem;
  /** Aniversário da data-base (reajuste), validade da garantia (garantia) ou prazo (pendência e ocorrência). */
  dataReferencia?: DataISO | null;
  /** Motivo da pendência ou relato da ocorrência (obrigatório nesses tipos). */
  detalhe?: string | null;
  /** Texto livre de quem dispara o aviso manual. */
  complemento?: string | null;
}

export interface MensagemNotificacao {
  assunto: string;
  corpo: string;
  fundamento: string;
  obrigatoria: boolean;
  faixa: FaixaVencimento | null;
}

const PROVIDENCIA_VENCIMENTO: Record<FaixaVencimento, string> = {
  120: 'avaliar se a prorrogação é vantajosa ou se é preciso iniciar o planejamento de nova contratação (DFD e ETP).',
  90: 'instruir o processo de prorrogação ou de nova contratação e consultar a contratada sobre o interesse em prorrogar.',
  60: 'concluir a instrução: vantajosidade, regularidade da contratada (art. 91, § 4º) e disponibilidade orçamentária.',
  30: 'formalizar eventual termo aditivo de prorrogação ainda durante a vigência ou assegurar a continuidade por nova contratação.',
};

function linhaUnica(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

function textoObrigatorio(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || linhaUnica(valor) === '') {
    throw new ErroDominio('NOTIFICACAO_INVALIDA', `${campo} é obrigatório.`);
  }
  return valor.trim();
}

function dataObrigatoria(valor: DataISO | null | undefined, campo: string): DataISO {
  if (typeof valor !== 'string') throw new ErroDominio('NOTIFICACAO_INVALIDA', `${campo} é obrigatória para este tipo de aviso.`);
  lerData(valor, campo);
  return valor;
}

function plural(n: number, singular: string, varios: string): string {
  return `${n} ${Math.abs(n) === 1 ? singular : varios}`;
}

/**
 * Monta o assunto e o corpo do aviso em pt-BR a partir de modelos fixos (sem IA): identificação do
 * instrumento, fato, providência sugerida, fundamento legal e data de geração. O texto informa quando o
 * aviso é obrigatório. Não contém dados pessoais do destinatário (a saudação é genérica).
 * Fundamento: Lei 14.133/2021, arts. 91, 92, 106, 117 e 141 (RF-26).
 */
export function montarMensagemNotificacao(e: EntradaMensagemNotificacao): MensagemNotificacao {
  if (!TIPOS_NOTIFICACAO.includes(e.tipo)) throw new ErroDominio('NOTIFICACAO_INVALIDA', `Tipo de notificação desconhecido: ${String(e.tipo)}.`);
  lerData(e.hoje, 'hoje');
  const i = e.instrumento;
  const identificador = linhaUnica(textoObrigatorio(i.identificador, 'O identificador do instrumento'));
  const objeto = linhaUnica(textoObrigatorio(i.objeto, 'O objeto do instrumento'));
  const uasg = linhaUnica(textoObrigatorio(i.uasg, 'A UASG'));
  lerData(i.vigenciaFim, 'vigenciaFim');
  const complemento = typeof e.complemento === 'string' ? e.complemento.trim() : '';
  if (complemento.length > LIMITE_COMPLEMENTO) {
    throw new ErroDominio('NOTIFICACAO_INVALIDA', `A mensagem complementar tem ${complemento.length} caracteres; o limite é ${LIMITE_COMPLEMENTO}.`);
  }
  const detalhe = typeof e.detalhe === 'string' ? e.detalhe.trim() : '';

  let faixa: FaixaVencimento | null = null;
  let resumo: string;
  let titulo: string;
  let fatos: string[];
  let providencia: string;

  switch (e.tipo) {
    case 'vencimento': {
      const vigencia = classificarVigencia(i.vigenciaFim, e.hoje);
      faixa = faixaVencimento(vigencia.diasRestantes);
      titulo = 'Aviso de vencimento da vigência';
      if (vigencia.diasRestantes < 0) {
        resumo = `vigência encerrada em ${formatarData(i.vigenciaFim)}`;
        providencia = 'verificar o encerramento do instrumento: recebimento definitivo, pagamentos pendentes e liberação da garantia.';
      } else {
        resumo =
          vigencia.diasRestantes === 0
            ? 'vigência termina hoje'
            : `vigência termina em ${plural(vigencia.diasRestantes, 'dia', 'dias')}${faixa === null ? '' : ` (faixa de ${faixa} dias)`}`;
        providencia =
          faixa === null
            ? 'acompanhar o prazo de vigência e planejar a prorrogação ou a nova contratação com antecedência.'
            : PROVIDENCIA_VENCIMENTO[faixa];
      }
      fatos = [`Fim da vigência: ${formatarData(i.vigenciaFim)} (${vigencia.rotulo.toLowerCase()}).`];
      if (i.tipo === 'ata') fatos.push('A ata de registro de preços vale por 1 ano, prorrogável por igual período se comprovada a vantajosidade (art. 84).');
      // RN-33 (frente K): situação da prorrogação do contrato (limite de vigência ou nova licitação).
      if (detalhe) fatos.push(`Prorrogação: ${linhaUnica(detalhe)}`);
      break;
    }
    case 'reajuste': {
      const aniversario = dataObrigatoria(e.dataReferencia, 'A data do aniversário da data-base');
      const indice = linhaUnica(i.indiceReajuste ?? '') || 'previsto no contrato';
      titulo = 'Aviso de reajuste';
      resumo = `data-base do reajuste completa 12 meses em ${formatarData(aniversario)}`;
      fatos = [`Aniversário da data-base: ${formatarData(aniversario)}.`, `Índice de reajuste: ${indice}.`];
      providencia = 'verificar o pedido ou o cálculo do reajuste pelo índice contratual e registrar o apostilamento, se cabível.';
      break;
    }
    case 'garantia': {
      const validade = dataObrigatoria(e.dataReferencia, 'A validade da garantia');
      titulo = 'Aviso de validade da garantia contratual';
      resumo = `garantia contratual vence em ${formatarData(validade)}`;
      fatos = [`Validade da garantia: ${formatarData(validade)}.`, `Fim da vigência do contrato: ${formatarData(i.vigenciaFim)}.`];
      providencia = 'exigir da contratada a renovação ou a complementação da garantia antes do vencimento.';
      break;
    }
    case 'pendencia': {
      const motivo = linhaUnica(textoObrigatorio(detalhe, 'O motivo da pendência'));
      titulo = 'Aviso de pendência';
      resumo = e.dataReferencia ? `pendência com prazo em ${formatarData(dataObrigatoria(e.dataReferencia, 'O prazo'))}` : 'pendência aberta';
      fatos = [`Pendência: ${motivo}`];
      if (e.dataReferencia) fatos.push(`Prazo: ${formatarData(e.dataReferencia)}.`);
      providencia = 'tratar a pendência e registrar a solução na Ágora.';
      break;
    }
    case 'ocorrencia': {
      const relato = textoObrigatorio(detalhe, 'O relato da ocorrência');
      if (relato.length < MINIMO_DETALHE_OCORRENCIA) {
        throw new ErroDominio('NOTIFICACAO_INVALIDA', `Descreva a ocorrência com pelo menos ${MINIMO_DETALHE_OCORRENCIA} caracteres.`);
      }
      titulo = 'Notificação de ocorrência na execução do contrato';
      resumo = 'notificação de ocorrência na execução';
      fatos = [`Ocorrência registrada pela fiscalização: ${linhaUnica(relato)}`];
      if (e.dataReferencia) fatos.push(`Prazo para regularização: ${formatarData(dataObrigatoria(e.dataReferencia, 'O prazo'))}.`);
      providencia =
        'a contratada deve regularizar as faltas ou os defeitos apontados no prazo indicado. Esta notificação não aplica penalidade; eventual sanção depende de processo próprio, com defesa.';
      break;
    }
  }

  const obrigatoria = avisoObrigatorio(e.tipo, faixa);
  const fundamento = e.tipo === 'vencimento' ? FUNDAMENTO_VENCIMENTO[i.tipo] : FUNDAMENTOS[e.tipo];
  const linhas = [
    `${titulo} — ${identificador}`,
    '',
    `Objeto: ${objeto}`,
    `UASG: ${uasg}${i.processoSei ? ` · Processo SEI: ${linhaUnica(i.processoSei)}` : ''}`,
    ...(i.fornecedor ? [`Contratada: ${linhaUnica(i.fornecedor)}`] : []),
    ...fatos,
    `Providência sugerida: ${providencia}`,
    ...(complemento ? ['', `Mensagem de quem enviou: ${complemento}`] : []),
    '',
    `Fundamento: ${fundamento}.`,
    ...(obrigatoria ? ['Aviso obrigatório: decorre de dever legal e não pode ser desativado nas preferências de notificação.'] : []),
    `${e.origem === 'automatica' ? 'Aviso automático gerado' : 'Aviso enviado pela equipe de gestão'} pela Ágora em ${formatarData(e.hoje)}. Não responda a esta mensagem.`,
  ];
  return { assunto: `${identificador}: ${resumo}`, corpo: linhas.join('\n'), fundamento, obrigatoria, faixa };
}
