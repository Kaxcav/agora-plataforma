/**
 * Integração com o SEI (RF-35): regras puras usadas pelo conector do web service do SEI (SeiWS) e pela simulação.
 *
 * - Número Único de Protocolo (NUP) do processo: Portaria Interministerial nº 11/2019, art. 3º e anexo (dígitos
 *   verificadores pelo módulo 11).
 * - Nível de acesso dos documentos enviados ao SEI: Lei 12.527/2011 (LAI), art. 31 (informação pessoal), e
 *   Lei 14.133/2021, art. 24 (orçamento sigiloso).
 * - Assinatura: os atos da contratação são preferencialmente digitais (Lei 14.133/2021, art. 12, VI). A assinatura
 *   acontece no próprio SEI, com o certificado ICP-Brasil ou o login do servidor; a Ágora só reflete o resultado
 *   devolvido pela operação `consultarDocumento`, com as datas no formato do SEI (dd/mm/aaaa hh:mm:ss, Brasília).
 */
import { ErroDominio } from '../erros.ts';

const SO_DIGITOS = /^\d+$/;

/**
 * Dígitos verificadores do NUP (anexo da Portaria Interministerial nº 11/2019). Cada algarismo é multiplicado pelo
 * peso, que cresce da direita para a esquerda a partir de 2; o resto da soma por 11 dá o dígito (11 − resto,
 * desprezada a casa da dezena). O 2º dígito repete a conta com o 1º acrescentado à direita.
 * Ex.: `350410003872000` → `19` (35041.000387/2000-19, exemplo do anexo).
 */
export function digitosVerificadoresNup(base: string): string {
  if (typeof base !== 'string' || base.length !== 15 || !SO_DIGITOS.test(base)) {
    throw new ErroDominio('NUP_INVALIDO', 'A base do NUP tem 15 algarismos: unidade (5), sequencial (6) e ano (4).');
  }
  const calcular = (digitos: string): number => {
    let soma = 0;
    for (let i = 0; i < digitos.length; i += 1) soma += Number(digitos[digitos.length - 1 - i]) * (i + 2);
    return (11 - (soma % 11)) % 10;
  };
  const primeiro = calcular(base);
  const segundo = calcular(`${base}${primeiro}`);
  return `${primeiro}${segundo}`;
}

/**
 * NUP no formato do art. 3º da Portaria Interministerial nº 11/2019: `UUUUU.SSSSSS/AAAA-DD` — código da unidade
 * protocolizadora (5 dígitos), sequencial reiniciado a cada ano (6 dígitos), ano (4 dígitos) e dígitos verificadores.
 */
export function formatarNup(p: { unidade: string; sequencial: number; ano: number }): string {
  if (typeof p.unidade !== 'string' || !/^\d{5}$/.test(p.unidade)) {
    throw new ErroDominio('NUP_INVALIDO', 'O código da unidade protocolizadora tem 5 dígitos.');
  }
  if (!Number.isInteger(p.sequencial) || p.sequencial < 1 || p.sequencial > 999_999) {
    throw new ErroDominio('NUP_INVALIDO', 'O sequencial do NUP é um inteiro de 1 a 999999.');
  }
  if (!Number.isInteger(p.ano) || p.ano < 1900 || p.ano > 9999) throw new ErroDominio('NUP_INVALIDO', 'O ano do NUP tem 4 dígitos.');
  const sequencial = String(p.sequencial).padStart(6, '0');
  const ano = String(p.ano);
  return `${p.unidade}.${sequencial}/${ano}-${digitosVerificadoresNup(`${p.unidade}${sequencial}${ano}`)}`;
}

/** Confere o formato `00000.000000/0000-00` e os dígitos verificadores do NUP (Portaria Interministerial nº 11/2019). */
export function validarNup(numero: string): boolean {
  if (typeof numero !== 'string') return false;
  const partes = /^(\d{5})\.(\d{6})\/(\d{4})-(\d{2})$/.exec(numero.trim());
  if (!partes) return false;
  const [, unidade = '', sequencial = '', ano = '', dv = ''] = partes;
  return digitosVerificadoresNup(`${unidade}${sequencial}${ano}`) === dv;
}

export interface NivelAcessoSei {
  /** 1 = restrito no SEI; `null` = o nível sugerido pelo tipo de processo cadastrado no SEI do órgão. */
  nivel: 1 | null;
  fundamento: string;
}

/**
 * Nível de acesso de um documento enviado ao SEI. Documento com dado pessoal (CPF, e-mail, telefone) entra como
 * restrito (LAI, art. 31; LGPD, art. 6º, III); peça de processo com orçamento sigiloso também (Lei 14.133/2021,
 * art. 24). Os demais seguem o nível sugerido pelo tipo de processo no SEI (público, como regra — LAI, art. 3º, I).
 */
export function nivelAcessoSei(p: { contemDadoPessoal: boolean; orcamentoSigiloso: boolean }): NivelAcessoSei {
  if (p.orcamentoSigiloso) {
    return { nivel: 1, fundamento: 'Restrito: orçamento estimado sigiloso até a adjudicação (Lei 14.133/2021, art. 24).' };
  }
  if (p.contemDadoPessoal) {
    return { nivel: 1, fundamento: 'Restrito: contém dado pessoal (Lei 12.527/2011, art. 31; Lei 13.709/2018, art. 6º, III).' };
  }
  return { nivel: null, fundamento: 'Nível sugerido pelo tipo de processo no SEI (publicidade como regra — Lei 12.527/2011, art. 3º, I).' };
}

const DATA_HORA_SEI = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Converte a data e hora devolvidas pelo SEI (`dd/mm/aaaa hh:mm:ss`, `dd/mm/aaaa hh:mm` ou `dd/mm/aaaa`, horário de
 * Brasília, UTC−3 desde o fim do horário de verão em 2019) para o instante ISO 8601 em UTC.
 */
export function dataHoraSeiParaIso(texto: string): string {
  const partes = typeof texto === 'string' ? DATA_HORA_SEI.exec(texto.trim()) : null;
  if (!partes) throw new ErroDominio('DATA_SEI_INVALIDA', `Data do SEI fora do formato dd/mm/aaaa hh:mm:ss: "${String(texto).slice(0, 40)}".`);
  const [, dia = '', mes = '', ano = '', hora = '00', minuto = '00', segundo = '00'] = partes;
  const instante = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}.000-03:00`);
  const valido =
    !Number.isNaN(instante.getTime()) &&
    Number(mes) >= 1 &&
    Number(mes) <= 12 &&
    new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia))).getUTCDate() === Number(dia) &&
    Number(hora) < 24 &&
    Number(minuto) < 60 &&
    Number(segundo) < 60;
  if (!valido) throw new ErroDominio('DATA_SEI_INVALIDA', `Data do SEI inexistente: "${texto.trim()}".`);
  return instante.toISOString();
}

/** Instante → `dd/mm/aaaa hh:mm:ss` no horário de Brasília (formato das datas trocadas com o SEI). */
export function dataHoraSei(instante: Date): string {
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) throw new ErroDominio('DATA_SEI_INVALIDA', 'Instante inválido.');
  const brasilia = new Date(instante.getTime() - 3 * 60 * 60 * 1000);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(brasilia.getUTCDate())}/${dois(brasilia.getUTCMonth() + 1)}/${brasilia.getUTCFullYear()} ${dois(brasilia.getUTCHours())}:${dois(brasilia.getUTCMinutes())}:${dois(brasilia.getUTCSeconds())}`;
}

export interface AssinaturaSei {
  nome: string;
  cargoFuncao: string | null;
  /** Instante ISO (UTC) da assinatura. */
  assinadoEm: string;
}

export interface SituacaoAssinaturaSei {
  assinado: boolean;
  /** Primeira assinatura (a que torna o documento assinado). */
  primeiraEm: string | null;
  /** Signatários em ordem cronológica, sem repetição. */
  signatarios: string[];
  /** Texto para a árvore do processo: "Ana Ribeiro (Requisitante) e Caio Lima". */
  resumo: string;
}

/**
 * Consolida as assinaturas devolvidas pelo SEI para um documento: assinado quando há ao menos uma assinatura
 * (com certificado ICP-Brasil ou login do servidor, conforme o SEI do órgão — Lei 14.133/2021, art. 12, VI).
 */
export function situacaoAssinaturaSei(assinaturas: readonly AssinaturaSei[]): SituacaoAssinaturaSei {
  const ordenadas = [...assinaturas]
    .filter((a) => typeof a.nome === 'string' && a.nome.trim() !== '' && !Number.isNaN(Date.parse(a.assinadoEm)))
    .sort((a, b) => Date.parse(a.assinadoEm) - Date.parse(b.assinadoEm));
  const signatarios: string[] = [];
  const rotulos: string[] = [];
  for (const a of ordenadas) {
    const nome = a.nome.trim();
    if (signatarios.includes(nome)) continue;
    signatarios.push(nome);
    rotulos.push(a.cargoFuncao && a.cargoFuncao.trim() !== '' ? `${nome} (${a.cargoFuncao.trim()})` : nome);
  }
  const resumo = rotulos.length <= 1 ? (rotulos[0] ?? '') : `${rotulos.slice(0, -1).join(', ')} e ${rotulos[rotulos.length - 1] ?? ''}`;
  return { assinado: ordenadas.length > 0, primeiraEm: ordenadas[0]?.assinadoEm ?? null, signatarios, resumo };
}
