/**
 * Publicação no Diário Oficial da União (RF-36): matérias no padrão da Seção 3 do DOU (avisos e extratos), previsão
 * da edição e conferência da publicação na consulta pública do DOU.
 *
 * - Aviso de licitação: o extrato do edital é publicado no DOU e em jornal diário de grande circulação, sem prejuízo
 *   da divulgação no PNCP (Lei 14.133/2021, art. 54, § 1º). É obrigatório.
 * - Extrato de contrato e de termo aditivo: a condição de eficácia é a divulgação no PNCP (art. 94); o extrato no DOU
 *   é publicidade complementar, conforme a norma interna do órgão.
 * - A Imprensa Nacional recebe as matérias pelo sistema INCom, operado por usuário credenciado com certificado
 *   digital; não há API pública de envio. Por isso a Ágora gera a matéria, registra o envio com o protocolo do INCom
 *   e confere a publicação na consulta pública do DOU.
 */
import { formatarCnpj, mascararCpf, somenteDigitos, validarCnpj, validarCpf } from '../documentos.ts';
import { ErroDominio } from '../erros.ts';
import { adicionarDiasUteis, formatarData, proximoDiaUtil, validarDataISO, type DataISO, type OpcoesCalendario } from '../datas.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';

export type TipoMateriaDou = 'aviso_licitacao' | 'extrato_contrato' | 'extrato_aditivo';

export interface OrgaoMateriaDou {
  /** Ex.: "Ministério da Justiça e Segurança Pública". */
  nome: string;
  /** Unidade responsável, ex.: "Secretaria Nacional de Segurança Pública". */
  unidade: string;
}

interface BaseMateria {
  orgao: OrgaoMateriaDou;
  uasg: { codigo: string; nome: string };
  /** Número do processo administrativo (NUP no SEI). */
  processo: string;
  objeto: string;
}

export interface DadosAvisoLicitacao extends BaseMateria {
  tipo: 'aviso_licitacao';
  /** Ex.: "Pregão eletrônico". */
  modalidade: string;
  /** Ex.: "12/2026". */
  numero: string;
  totalItens: number;
  /** Divulgação do edital no PNCP (art. 54, caput). */
  dataEdital: DataISO;
  /** Data mínima para a abertura das propostas (art. 55). */
  dataPropostas: DataISO;
  /** Endereço do inteiro teor do edital, sem cadastro (art. 25, § 3º). */
  enderecoEdital: string;
  responsavel: { nome: string; cargo: string };
}

export interface ContratadoMateriaDou {
  nome: string;
  /** CPF ou CNPJ, só dígitos ou formatado. */
  documento: string;
}

export interface DadosExtratoContrato extends BaseMateria {
  tipo: 'extrato_contrato';
  numeroContrato: string;
  /** Ex.: "Pregão eletrônico nº 12/2026" ou "Dispensa de licitação". */
  origem: string;
  contratado: ContratadoMateriaDou;
  vigenciaInicio: DataISO;
  vigenciaFim: DataISO;
  valor: Centavos;
  dataAssinatura: DataISO;
}

export interface DadosExtratoAditivo extends BaseMateria {
  tipo: 'extrato_aditivo';
  numeroContrato: string;
  numeroAditivo: string;
  natureza: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste';
  contratado: ContratadoMateriaDou;
  valor: Centavos;
  novaVigenciaFim: DataISO | null;
  dataAssinatura: DataISO;
}

export type DadosMateriaDou = DadosAvisoLicitacao | DadosExtratoContrato | DadosExtratoAditivo;

export interface MateriaDouMontada {
  tipo: TipoMateriaDou;
  /** Seção 3 do DOU: contratos, editais e avisos. */
  secao: 3;
  /** Título da matéria, ex.: "AVISO DE LICITAÇÃO". */
  titulo: string;
  /** Identificação do ato, ex.: "PREGÃO ELETRÔNICO Nº 12/2026" ou "EXTRATO DE CONTRATO Nº 7/2026". */
  identificacao: string;
  /** Texto completo, já no padrão de publicação (cabeçalho do órgão, título, corpo e assinatura). */
  texto: string;
  obrigatoria: boolean;
  fundamento: string;
}

const NATUREZA_ADITIVO: Record<DadosExtratoAditivo['natureza'], string> = {
  acrescimo: 'Acréscimo quantitativo do objeto (art. 125)',
  supressao: 'Supressão quantitativa do objeto (art. 125)',
  prorrogacao: 'Prorrogação da vigência (arts. 106 e 107)',
  reajuste: 'Reajuste de preços (art. 92, § 3º)',
};

function exigirTexto(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ErroDominio('MATERIA_DOU_INVALIDA', `Informe ${campo}.`);
  return valor.replace(/\s+/g, ' ').trim();
}

function exigirData(valor: unknown, campo: string): DataISO {
  if (typeof valor !== 'string' || !validarDataISO(valor)) throw new ErroDominio('MATERIA_DOU_INVALIDA', `Data inválida em ${campo}.`);
  return valor;
}

/** CNPJ completo (pessoa jurídica); CPF no padrão de anonimização do governo federal ("***.456.789-**"). */
function documentoPublicavel(documento: string): string {
  const digitos = somenteDigitos(documento);
  if (validarCnpj(digitos)) return `CNPJ ${formatarCnpj(digitos)}`;
  if (validarCpf(digitos)) return `CPF ${mascararCpf(digitos)}`;
  throw new ErroDominio('MATERIA_DOU_INVALIDA', 'Documento do contratado inválido: informe CPF ou CNPJ.');
}

function cabecalho(b: BaseMateria): string[] {
  return [exigirTexto(b.orgao.nome, 'o órgão').toUpperCase(), exigirTexto(b.orgao.unidade, 'a unidade').toUpperCase()];
}

/**
 * Monta a matéria no padrão de publicação da Seção 3 do DOU. O texto não leva CPF completo, e-mail nem telefone: o
 * CPF de contratado pessoa física sai mascarado (LGPD, art. 6º, III). A matéria é um rascunho para conferência do
 * servidor antes do envio pelo INCom.
 */
export function montarMateriaDou(d: DadosMateriaDou): MateriaDouMontada {
  const objeto = exigirTexto(d.objeto, 'o objeto');
  const processo = exigirTexto(d.processo, 'o número do processo');
  const uasg = `${exigirTexto(d.uasg.codigo, 'a UASG')} - ${exigirTexto(d.uasg.nome, 'o nome da UASG').toUpperCase()}`;
  const orgao = exigirTexto(d.orgao.nome, 'o órgão');

  if (d.tipo === 'aviso_licitacao') {
    const modalidade = exigirTexto(d.modalidade, 'a modalidade');
    const numero = exigirTexto(d.numero, 'o número da licitação');
    const dataEdital = exigirData(d.dataEdital, 'dataEdital');
    const dataPropostas = exigirData(d.dataPropostas, 'dataPropostas');
    if (dataPropostas < dataEdital) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'A abertura das propostas não pode ser anterior ao edital.');
    if (!Number.isInteger(d.totalItens) || d.totalItens < 1) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'A licitação precisa de ao menos um item.');
    const identificacao = `${modalidade.toUpperCase()} Nº ${numero}`;
    const corpo = [
      `UASG ${uasg}. Processo nº ${processo}.`,
      `Objeto: ${objeto}. Total de itens licitados: ${d.totalItens}.`,
      `Edital: a partir de ${formatarData(dataEdital)}, no Portal Nacional de Contratações Públicas (PNCP) e em ${exigirTexto(d.enderecoEdital, 'o endereço do edital')}, com acesso livre, sem cadastro (art. 25, § 3º).`,
      `Entrega das propostas: a partir de ${formatarData(dataEdital)}. Abertura das propostas: ${formatarData(dataPropostas)}, no sistema de compras indicado no edital.`,
    ];
    return {
      tipo: d.tipo,
      secao: 3,
      titulo: 'AVISO DE LICITAÇÃO',
      identificacao,
      texto: [...cabecalho(d), '', 'AVISO DE LICITAÇÃO', identificacao, '', ...corpo, '', exigirTexto(d.responsavel.nome, 'o responsável').toUpperCase(), exigirTexto(d.responsavel.cargo, 'o cargo do responsável')].join('\n'),
      obrigatoria: true,
      fundamento: 'Lei 14.133/2021, art. 54, § 1º (extrato do edital no DOU e em jornal diário de grande circulação)',
    };
  }

  const contratado = `${documentoPublicavel(d.contratado.documento)} - ${exigirTexto(d.contratado.nome, 'o contratado').toUpperCase()}`;
  const numeroContrato = exigirTexto(d.numeroContrato, 'o número do contrato');
  const dataAssinatura = exigirData(d.dataAssinatura, 'dataAssinatura');
  if (!Number.isInteger(d.valor) || d.valor < 0) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'Valor inválido.');

  if (d.tipo === 'extrato_contrato') {
    const inicio = exigirData(d.vigenciaInicio, 'vigenciaInicio');
    const fim = exigirData(d.vigenciaFim, 'vigenciaFim');
    if (fim < inicio) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'O fim da vigência é anterior ao início.');
    const identificacao = `EXTRATO DE CONTRATO Nº ${numeroContrato}`;
    const corpo = [
      `UASG ${uasg}. Processo nº ${processo}. ${exigirTexto(d.origem, 'a origem da contratação')}.`,
      `Contratante: ${orgao.toUpperCase()}. Contratado: ${contratado}.`,
      `Objeto: ${objeto}.`,
      `Fundamento legal: Lei nº 14.133/2021. Vigência: ${formatarData(inicio)} a ${formatarData(fim)}. Valor total: ${formatarMoeda(d.valor)}. Data de assinatura: ${formatarData(dataAssinatura)}.`,
    ];
    return {
      tipo: d.tipo,
      secao: 3,
      titulo: 'EXTRATO DE CONTRATO',
      identificacao,
      texto: [...cabecalho(d), '', identificacao, '', ...corpo].join('\n'),
      obrigatoria: false,
      fundamento: 'Lei 14.133/2021, art. 94 (eficácia pela divulgação no PNCP); extrato no DOU como publicidade complementar',
    };
  }

  const numeroAditivo = exigirTexto(d.numeroAditivo, 'o número do termo aditivo');
  const novaVigencia = d.novaVigenciaFim === null ? null : exigirData(d.novaVigenciaFim, 'novaVigenciaFim');
  const natureza = NATUREZA_ADITIVO[d.natureza];
  if (!natureza) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'Natureza do aditivo inválida.');
  const identificacao = `EXTRATO DO TERMO ADITIVO Nº ${numeroAditivo} AO CONTRATO Nº ${numeroContrato}`;
  const corpo = [
    `UASG ${uasg}. Processo nº ${processo}.`,
    `Contratante: ${orgao.toUpperCase()}. Contratado: ${contratado}.`,
    `Objeto do contrato: ${objeto}. Objeto do aditivo: ${natureza}.`,
    `Fundamento legal: Lei nº 14.133/2021.${novaVigencia ? ` Nova vigência até ${formatarData(novaVigencia)}.` : ''} Valor do aditivo: ${formatarMoeda(d.valor)}. Data de assinatura: ${formatarData(dataAssinatura)}.`,
  ];
  return {
    tipo: d.tipo,
    secao: 3,
    titulo: 'EXTRATO DE TERMO ADITIVO',
    identificacao,
    texto: [...cabecalho(d), '', identificacao, '', ...corpo].join('\n'),
    obrigatoria: false,
    fundamento: 'Lei 14.133/2021, arts. 94 e 174 (divulgação no PNCP); extrato no DOU como publicidade complementar',
  };
}

/**
 * Edição prevista do DOU para uma matéria enviada pelo INCom: a matéria recebida até o horário de fechamento de um dia
 * útil sai na edição do dia útil seguinte; depois do fechamento (ou em dia sem expediente), na do dia útil
 * subsequente. O horário de fechamento é o informado pela Imprensa Nacional ao órgão (padrão: 19h de Brasília).
 * É uma previsão: quem confirma a publicação é a consulta ao DOU.
 */
export function dataPrevistaPublicacaoDou(envio: Date, opcoes: OpcoesCalendario & { horaFechamento?: number } = {}): DataISO {
  if (!(envio instanceof Date) || Number.isNaN(envio.getTime())) throw new ErroDominio('DATA_INVALIDA', 'Instante de envio inválido.');
  const fechamento = opcoes.horaFechamento ?? 19;
  if (!Number.isInteger(fechamento) || fechamento < 0 || fechamento > 23) throw new ErroDominio('DATA_INVALIDA', 'Hora de fechamento inválida.');
  const brasilia = new Date(envio.getTime() - 3 * 60 * 60 * 1000);
  const dia = brasilia.toISOString().slice(0, 10);
  const recebidoNoDia = proximoDiaUtil(dia, opcoes) === dia && brasilia.getUTCHours() < fechamento;
  // Fora do expediente, a matéria conta como recebida no primeiro dia útil seguinte.
  const recebimento = recebidoNoDia ? dia : adicionarDiasUteis(dia, 1, opcoes);
  return adicionarDiasUteis(recebimento, 1, opcoes);
}

export interface ResultadoBuscaDou {
  titulo: string;
  resumo: string;
  /** Data da edição (ISO). */
  data: DataISO;
  secao: string;
  url: string;
  edicao: string | null;
  pagina: string | null;
}

const PALAVRAS_TIPO: Record<TipoMateriaDou, RegExp> = {
  aviso_licitacao: /AVISO DE LICITACAO/,
  extrato_contrato: /EXTRATO DE CONTRATO/,
  extrato_aditivo: /EXTRATO D[OE] (\d+\S* )?TERMO ADITIVO|EXTRATO DE TERMO ADITIVO/,
};

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[º°]/g, 'O').toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Confere, entre os resultados da consulta pública do DOU, a publicação de uma matéria: mesmo tipo de ato (pelo
 * título), o número do processo no texto e a data da edição a partir do envio. Devolve a primeira edição que atende
 * ou `null` (ainda não publicada). Só sinaliza: a confirmação fica registrada com o endereço da publicação.
 */
export function localizarMateriaDou(
  materia: { tipo: TipoMateriaDou; processo: string; enviadaEm: DataISO },
  resultados: readonly ResultadoBuscaDou[],
): ResultadoBuscaDou | null {
  if (!validarDataISO(materia.enviadaEm)) throw new ErroDominio('DATA_INVALIDA', 'Data de envio inválida.');
  const processo = normalizar(exigirTexto(materia.processo, 'o processo'));
  const padrao = PALAVRAS_TIPO[materia.tipo];
  if (!padrao) throw new ErroDominio('MATERIA_DOU_INVALIDA', 'Tipo de matéria inválido.');
  const candidatos = resultados
    .filter((r) => validarDataISO(r.data) && r.data >= materia.enviadaEm)
    .filter((r) => padrao.test(normalizar(`${r.titulo} ${r.resumo}`)))
    .filter((r) => normalizar(`${r.titulo} ${r.resumo}`).includes(processo))
    .sort((a, b) => a.data.localeCompare(b.data));
  return candidatos[0] ?? null;
}
