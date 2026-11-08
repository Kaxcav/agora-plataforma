/**
 * Codificação e leitura de ASN.1 DER, sem dependências: o bastante para o protocolo de carimbo do tempo (RFC 3161) —
 * requisição, resposta, TSTInfo e a assinatura CMS do token. Só a forma definida do DER (comprimento conhecido,
 * tags de um byte); qualquer outra coisa é recusada como dado malformado.
 */

export class ErroDer extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDer';
  }
}

export const TAG = {
  booleano: 0x01,
  inteiro: 0x02,
  bits: 0x03,
  octetos: 0x04,
  nulo: 0x05,
  oid: 0x06,
  utf8: 0x0c,
  printable: 0x13,
  ia5: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  sequencia: 0x30,
  conjunto: 0x31,
} as const;

export interface NoDer {
  /** Byte de identificação (classe, construído e número). */
  tag: number;
  /** Elemento inteiro (identificação + comprimento + conteúdo). */
  bruto: Buffer;
  conteudo: Buffer;
  /** Posição do fim do elemento no buffer de origem. */
  fim: number;
}

/** Lê o elemento DER que começa em `inicio`. */
export function lerDer(buf: Buffer, inicio = 0): NoDer {
  if (inicio + 2 > buf.length) throw new ErroDer('Fim inesperado do DER.');
  const tag = buf[inicio] ?? 0;
  if ((tag & 0x1f) === 0x1f) throw new ErroDer('Tag DER de vários bytes não suportada.');
  let posicao = inicio + 1;
  const primeiro = buf[posicao] ?? 0;
  posicao += 1;
  let comprimento: number;
  if (primeiro < 0x80) comprimento = primeiro;
  else {
    const bytes = primeiro & 0x7f;
    if (bytes === 0) throw new ErroDer('Comprimento indefinido não é DER.');
    if (bytes > 4) throw new ErroDer('Comprimento DER grande demais.');
    if (posicao + bytes > buf.length) throw new ErroDer('Fim inesperado do comprimento DER.');
    comprimento = 0;
    for (let i = 0; i < bytes; i++) comprimento = comprimento * 256 + (buf[posicao + i] ?? 0);
    posicao += bytes;
  }
  const fim = posicao + comprimento;
  if (fim > buf.length) throw new ErroDer('Conteúdo DER passa do fim dos dados.');
  return { tag, bruto: buf.subarray(inicio, fim), conteudo: buf.subarray(posicao, fim), fim };
}

/** Elementos dentro de um elemento construído. */
export function filhosDer(no: NoDer): NoDer[] {
  if ((no.tag & 0x20) === 0) throw new ErroDer('Elemento DER não é construído.');
  const filhos: NoDer[] = [];
  let posicao = 0;
  while (posicao < no.conteudo.length) {
    const filho = lerDer(no.conteudo, posicao);
    filhos.push(filho);
    posicao = filho.fim;
  }
  return filhos;
}

/** Lê exatamente um elemento que ocupa todo o buffer, conferindo a tag. */
export function lerUnico(buf: Buffer, tag?: number): NoDer {
  const no = lerDer(buf, 0);
  if (no.fim !== buf.length) throw new ErroDer('Há dados depois do elemento DER.');
  if (tag !== undefined && no.tag !== tag) throw new ErroDer(`Tag DER inesperada: ${no.tag.toString(16)}.`);
  return no;
}

export function exigirTag(no: NoDer | undefined, tag: number, contexto: string): NoDer {
  if (!no || no.tag !== tag) throw new ErroDer(`Estrutura inesperada em ${contexto}.`);
  return no;
}

export function lerOid(no: NoDer): string {
  const c = exigirTag(no, TAG.oid, 'OID').conteudo;
  if (c.length === 0) throw new ErroDer('OID vazio.');
  const partes: number[] = [];
  let valor = 0;
  for (const byte of c) {
    valor = valor * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      if (partes.length === 0) {
        const primeiro = valor < 40 ? 0 : valor < 80 ? 1 : 2;
        partes.push(primeiro, valor - primeiro * 40);
      } else partes.push(valor);
      valor = 0;
    }
  }
  return partes.join('.');
}

export function lerInteiro(no: NoDer): bigint {
  const c = exigirTag(no, TAG.inteiro, 'INTEGER').conteudo;
  if (c.length === 0) throw new ErroDer('INTEGER vazio.');
  let valor = 0n;
  for (const byte of c) valor = (valor << 8n) | BigInt(byte);
  if ((c[0] ?? 0) & 0x80) valor -= 1n << BigInt(c.length * 8);
  return valor;
}

/** GeneralizedTime em UTC ("AAAAMMDDhhmmss[.fff]Z"). */
export function lerGeneralizedTime(no: NoDer): Date {
  const texto = exigirTag(no, TAG.generalizedTime, 'GeneralizedTime').conteudo.toString('latin1');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?Z$/.exec(texto);
  if (!m) throw new ErroDer('GeneralizedTime fora do formato UTC.');
  const fracao = (m[7] ?? '').padEnd(3, '0').slice(0, 3);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${fracao}Z`);
}

// ───────────────────────── codificação ─────────────────────────

function comprimento(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let resto = n;
  while (resto > 0) {
    bytes.unshift(resto & 0xff);
    resto = Math.floor(resto / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, conteudo: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), comprimento(conteudo.length), conteudo]);
}

function oidBytes(texto: string): Buffer {
  const partes = texto.split('.').map((p) => Number(p));
  if (partes.length < 2 || partes.some((p) => !Number.isSafeInteger(p) || p < 0)) throw new ErroDer(`OID inválido: ${texto}`);
  const valores = [(partes[0] ?? 0) * 40 + (partes[1] ?? 0), ...partes.slice(2)];
  const bytes: number[] = [];
  for (const v of valores) {
    const grupo: number[] = [v & 0x7f];
    let resto = Math.floor(v / 128);
    while (resto > 0) {
      grupo.unshift((resto & 0x7f) | 0x80);
      resto = Math.floor(resto / 128);
    }
    bytes.push(...grupo);
  }
  return Buffer.from(bytes);
}

function inteiroBytes(valor: bigint): Buffer {
  if (valor < 0n) throw new ErroDer('INTEGER negativo não é usado aqui.');
  let hex = valor.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, 'hex');
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if ((bytes[0] ?? 0) & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return bytes;
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

export const der = {
  sequencia: (...itens: Buffer[]) => tlv(TAG.sequencia, Buffer.concat(itens)),
  /** SET OF em DER: elementos em ordem crescente da codificação. */
  conjunto: (...itens: Buffer[]) => tlv(TAG.conjunto, Buffer.concat([...itens].sort(Buffer.compare))),
  inteiro: (valor: bigint | number) => tlv(TAG.inteiro, inteiroBytes(BigInt(valor))),
  oid: (texto: string) => tlv(TAG.oid, oidBytes(texto)),
  nulo: () => tlv(TAG.nulo, Buffer.alloc(0)),
  booleano: (valor: boolean) => tlv(TAG.booleano, Buffer.from([valor ? 0xff : 0x00])),
  octetos: (conteudo: Buffer) => tlv(TAG.octetos, conteudo),
  bits: (conteudo: Buffer) => tlv(TAG.bits, Buffer.concat([Buffer.from([0]), conteudo])),
  utf8: (texto: string) => tlv(TAG.utf8, Buffer.from(texto, 'utf8')),
  generalizedTime: (d: Date) =>
    tlv(
      TAG.generalizedTime,
      Buffer.from(
        `${d.getUTCFullYear()}${doisDigitos(d.getUTCMonth() + 1)}${doisDigitos(d.getUTCDate())}${doisDigitos(d.getUTCHours())}${doisDigitos(d.getUTCMinutes())}${doisDigitos(d.getUTCSeconds())}Z`,
        'latin1',
      ),
    ),
  utcTime: (d: Date) =>
    tlv(
      TAG.utcTime,
      Buffer.from(
        `${doisDigitos(d.getUTCFullYear() % 100)}${doisDigitos(d.getUTCMonth() + 1)}${doisDigitos(d.getUTCDate())}${doisDigitos(d.getUTCHours())}${doisDigitos(d.getUTCMinutes())}${doisDigitos(d.getUTCSeconds())}Z`,
        'latin1',
      ),
    ),
  /** [n] EXPLICIT (construído, classe de contexto). */
  explicito: (n: number, conteudo: Buffer) => tlv(0xa0 | n, conteudo),
  /** [n] IMPLICIT construído: troca a tag do elemento já codificado. */
  implicitoConstruido: (n: number, elemento: Buffer) => tlv(0xa0 | n, lerUnico(elemento).conteudo),
};
