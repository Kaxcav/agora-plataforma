/**
 * Leitura da camada de texto de PDF, sem dependências (RIA-08). Usada no servidor para atestados que já trazem
 * texto (gerados por editor de texto ou digitalizados com OCR embutido); PDF só com imagem segue para o serviço de
 * OCR. Cobre o que os atestados usam na prática: objetos diretos e em fluxos de objetos (PDF 1.5+), filtros
 * FlateDecode, ASCIIHex e ASCII85, fontes simples (WinAnsi, MacRoman, Standard e /Differences), fontes compostas
 * com /ToUnicode e formulários (XObject /Form). Devolve o texto por página e por linha, na ordem de leitura.
 * PDF criptografado não é decifrado aqui: vai para o OCR, que trabalha sobre a imagem renderizada.
 */
import { constants, inflateRawSync, inflateSync } from 'node:zlib';

export interface PaginaLida {
  numero: number;
  linhas: string[];
}

export interface ResultadoLeituraPdf {
  paginas: PaginaLida[];
  /** Letras e dígitos lidos (para decidir se há camada de texto útil). */
  caracteres: number;
  criptografado: boolean;
}

type Valor =
  | { t: 'num'; v: number }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'nome'; v: string }
  | { t: 'str'; v: Buffer }
  | { t: 'arr'; v: Valor[] }
  | { t: 'dict'; v: Map<string, Valor> }
  | { t: 'ref'; n: number; g: number }
  | { t: 'op'; v: string };

const NULO: Valor = { t: 'null' };

const ESPACO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITADOR = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Analisador léxico e sintático de objetos PDF sobre um Buffer. */
class Leitor {
  readonly b: Buffer;
  pos: number;
  constructor(b: Buffer, inicio = 0) {
    this.b = b;
    this.pos = inicio;
  }

  pularEspacos(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos] ?? 0;
      if (ESPACO.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  private palavra(): string {
    const inicio = this.pos;
    while (this.pos < this.b.length) {
      const c = this.b[this.pos] ?? 0;
      if (ESPACO.has(c) || DELIMITADOR.has(c)) break;
      this.pos++;
    }
    return this.b.toString('latin1', inicio, this.pos);
  }

  private textoLiteral(): Buffer {
    const b = this.b;
    const saida: number[] = [];
    let nivel = 1;
    this.pos++; // (
    while (this.pos < b.length) {
      const c = b[this.pos++] ?? 0;
      if (c === 0x5c) {
        const e = b[this.pos++] ?? 0;
        if (e === 0x6e) saida.push(0x0a);
        else if (e === 0x72) saida.push(0x0d);
        else if (e === 0x74) saida.push(0x09);
        else if (e === 0x62) saida.push(0x08);
        else if (e === 0x66) saida.push(0x0c);
        else if (e === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (e === 0x0a) {
          // continuação de linha
        } else if (e >= 0x30 && e <= 0x37) {
          let octal = e - 0x30;
          for (let k = 0; k < 2; k++) {
            const d = b[this.pos] ?? 0;
            if (d < 0x30 || d > 0x37) break;
            octal = octal * 8 + (d - 0x30);
            this.pos++;
          }
          saida.push(octal & 0xff);
        } else saida.push(e);
      } else if (c === 0x28) {
        nivel++;
        saida.push(c);
      } else if (c === 0x29) {
        nivel--;
        if (nivel === 0) break;
        saida.push(c);
      } else saida.push(c);
    }
    return Buffer.from(saida);
  }

  private textoHex(): Buffer {
    this.pos++; // <
    const fim = this.b.indexOf(0x3e, this.pos);
    const bruto = this.b.toString('latin1', this.pos, fim < 0 ? this.b.length : fim).replace(/[^0-9a-fA-F]/g, '');
    this.pos = fim < 0 ? this.b.length : fim + 1;
    return Buffer.from(bruto.length % 2 === 1 ? `${bruto}0` : bruto, 'hex');
  }

  private nome(): string {
    this.pos++; // /
    return this.palavra().replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
  }

  /** Próximo valor; números seguidos de "g R" viram referência. `null` no fim do buffer. */
  valor(): Valor | null {
    this.pularEspacos();
    if (this.pos >= this.b.length) return null;
    const c = this.b[this.pos] ?? 0;
    if (c === 0x2f) return { t: 'nome', v: this.nome() };
    if (c === 0x28) return { t: 'str', v: this.textoLiteral() };
    if (c === 0x3c) {
      if (this.b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        const dict = new Map<string, Valor>();
        for (;;) {
          this.pularEspacos();
          if (this.pos >= this.b.length) break;
          if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
            this.pos += 2;
            break;
          }
          const chave = this.valor();
          if (chave === null) break;
          if (chave.t !== 'nome') continue;
          const v = this.valor();
          if (v === null) break;
          dict.set(chave.v, v);
        }
        return { t: 'dict', v: dict };
      }
      return { t: 'str', v: this.textoHex() };
    }
    if (c === 0x5b) {
      this.pos++;
      const lista: Valor[] = [];
      for (;;) {
        this.pularEspacos();
        if (this.pos >= this.b.length) break;
        if (this.b[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const v = this.valor();
        if (v === null) break;
        lista.push(v);
      }
      return { t: 'arr', v: lista };
    }
    if (c === 0x5d || c === 0x29 || c === 0x7b || c === 0x7d || c === 0x3e) {
      this.pos++;
      return { t: 'op', v: String.fromCharCode(c) };
    }
    const p = this.palavra();
    if (p === '') {
      this.pos++;
      return { t: 'op', v: '' };
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(p)) {
      const numero = Number(p);
      if (/^\d+$/.test(p)) {
        // Referência indireta "n g R"?
        const salvo = this.pos;
        this.pularEspacos();
        const g = this.palavra();
        if (/^\d+$/.test(g)) {
          this.pularEspacos();
          if (this.b[this.pos] === 0x52 && (this.pos + 1 >= this.b.length || ESPACO.has(this.b[this.pos + 1] ?? 0) || DELIMITADOR.has(this.b[this.pos + 1] ?? 0))) {
            this.pos++;
            return { t: 'ref', n: numero, g: Number(g) };
          }
        }
        this.pos = salvo;
      }
      return { t: 'num', v: numero };
    }
    if (p === 'true' || p === 'false') return { t: 'bool', v: p === 'true' };
    if (p === 'null') return NULO;
    return { t: 'op', v: p };
  }
}

interface ObjetoPdf {
  valor: Valor;
  fluxo: Buffer | null;
}

const LIMITE_OBJETOS = 200_000;

/** Varre o arquivo atrás de "n g obj" (sem depender da tabela xref, que costuma estar danificada). */
function lerObjetos(pdf: Buffer): Map<number, ObjetoPdf> {
  const objetos = new Map<number, ObjetoPdf>();
  const texto = pdf.toString('latin1');
  const padrao = /(?:^|[\r\n\s])(\d{1,7})\s+(\d{1,5})\s+obj\b/g;
  let m: RegExpExecArray | null;
  let contagem = 0;
  while ((m = padrao.exec(texto)) !== null) {
    if (++contagem > LIMITE_OBJETOS) break;
    const numero = Number(m[1]);
    const leitor = new Leitor(pdf, m.index + m[0].length);
    const valor = leitor.valor();
    if (valor === null) continue;
    let fluxo: Buffer | null = null;
    leitor.pularEspacos();
    if (valor.t === 'dict' && texto.startsWith('stream', leitor.pos)) {
      let inicio = leitor.pos + 6;
      if (pdf[inicio] === 0x0d) inicio++;
      if (pdf[inicio] === 0x0a) inicio++;
      const comprimento = valor.v.get('Length');
      let fim = -1;
      if (comprimento?.t === 'num' && comprimento.v >= 0 && inicio + comprimento.v <= pdf.length) {
        const depois = texto.slice(inicio + comprimento.v, inicio + comprimento.v + 12);
        if (/^\s*endstream/.test(depois)) fim = inicio + comprimento.v;
      }
      if (fim < 0) {
        const marca = pdf.indexOf('endstream', inicio, 'latin1');
        fim = marca < 0 ? pdf.length : marca;
        while (fim > inicio && (pdf[fim - 1] === 0x0a || pdf[fim - 1] === 0x0d)) fim--;
      }
      fluxo = pdf.subarray(inicio, fim);
      padrao.lastIndex = Math.max(padrao.lastIndex, fim);
    }
    objetos.set(numero, { valor, fluxo });
  }
  return objetos;
}

function nomeDe(v: Valor | undefined): string | null {
  return v?.t === 'nome' ? v.v : null;
}

function numeroDe(v: Valor | undefined, padrao = 0): number {
  return v?.t === 'num' ? v.v : padrao;
}

class Documento {
  readonly objetos: Map<number, ObjetoPdf>;
  constructor(objetos: Map<number, ObjetoPdf>) {
    this.objetos = objetos;
  }

  resolver(v: Valor | undefined, profundidade = 0): Valor {
    if (v === undefined) return NULO;
    if (v.t !== 'ref') return v;
    if (profundidade > 16) return NULO;
    const alvo = this.objetos.get(v.n);
    return alvo ? this.resolver(alvo.valor, profundidade + 1) : NULO;
  }

  dict(v: Valor | undefined): Map<string, Valor> | null {
    const r = this.resolver(v);
    return r.t === 'dict' ? r.v : null;
  }

  /** Fluxo decodificado do objeto referenciado (ou `null` se ausente/filtro não suportado). */
  fluxo(v: Valor | undefined): { dict: Map<string, Valor>; dados: Buffer } | null {
    if (v?.t !== 'ref') return null;
    const alvo = this.objetos.get(v.n);
    if (!alvo || alvo.fluxo === null || alvo.valor.t !== 'dict') return null;
    const dados = decodificarFluxo(this, alvo.valor.v, alvo.fluxo);
    return dados === null ? null : { dict: alvo.valor.v, dados };
  }
}

const LIMITE_DESCOMPRIMIDO = 64 * 1024 * 1024;

function inflar(dados: Buffer): Buffer | null {
  const opcoes = { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength: LIMITE_DESCOMPRIMIDO };
  try {
    return inflateSync(dados, opcoes);
  } catch {
    try {
      return inflateRawSync(dados, opcoes);
    } catch {
      return null;
    }
  }
}

function asciiHex(dados: Buffer): Buffer {
  const texto = dados.toString('latin1').split('>')[0]?.replace(/[^0-9a-fA-F]/g, '') ?? '';
  return Buffer.from(texto.length % 2 === 1 ? `${texto}0` : texto, 'hex');
}

function ascii85(dados: Buffer): Buffer {
  const texto = dados.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').split('~>')[0] ?? '';
  const saida: number[] = [];
  let grupo: number[] = [];
  for (const ch of texto) {
    if (ch === 'z' && grupo.length === 0) {
      saida.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    grupo.push(c);
    if (grupo.length === 5) {
      let v = 0;
      for (const d of grupo) v = v * 85 + d;
      saida.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      grupo = [];
    }
  }
  if (grupo.length > 1) {
    const faltam = 5 - grupo.length;
    for (let k = 0; k < faltam; k++) grupo.push(84);
    let v = 0;
    for (const d of grupo) v = v * 85 + d;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    saida.push(...bytes.slice(0, 4 - faltam));
  }
  return Buffer.from(saida);
}

function decodificarFluxo(doc: Documento, dict: Map<string, Valor>, bruto: Buffer): Buffer | null {
  const filtro = doc.resolver(dict.get('Filter'));
  const filtros = filtro.t === 'nome' ? [filtro.v] : filtro.t === 'arr' ? filtro.v.map((f) => nomeDe(doc.resolver(f)) ?? '') : [];
  let dados: Buffer | null = bruto;
  for (const f of filtros) {
    if (dados === null) return null;
    if (f === 'FlateDecode' || f === 'Fl') dados = inflar(dados);
    else if (f === 'ASCIIHexDecode' || f === 'AHx') dados = asciiHex(dados);
    else if (f === 'ASCII85Decode' || f === 'A85') dados = ascii85(dados);
    else return null; // DCT, JBIG2, CCITT... são imagem, não texto
  }
  return dados;
}

/** Objetos guardados em fluxos de objetos (/Type /ObjStm, PDF 1.5+). Não substituem objetos diretos. */
function expandirFluxosDeObjetos(doc: Documento): void {
  const fluxos = [...doc.objetos.entries()].filter(([, o]) => o.valor.t === 'dict' && nomeDe(o.valor.v.get('Type')) === 'ObjStm');
  for (const [numero, obj] of fluxos) {
    if (obj.valor.t !== 'dict') continue;
    const decodificado = doc.fluxo({ t: 'ref', n: numero, g: 0 });
    if (!decodificado) continue;
    const n = numeroDe(doc.resolver(obj.valor.v.get('N')));
    const primeiro = numeroDe(doc.resolver(obj.valor.v.get('First')));
    const cabecalho = new Leitor(decodificado.dados);
    const pares: [number, number][] = [];
    for (let i = 0; i < n && i < 100_000; i++) {
      const a = cabecalho.valor();
      const b = cabecalho.valor();
      if (a?.t !== 'num' || b?.t !== 'num') break;
      pares.push([a.v, b.v]);
    }
    for (const [numeroObjeto, deslocamento] of pares) {
      if (doc.objetos.has(numeroObjeto)) continue;
      const valor = new Leitor(decodificado.dados, primeiro + deslocamento).valor();
      if (valor !== null) doc.objetos.set(numeroObjeto, { valor, fluxo: null });
    }
  }
}

// ───────────────────────── codificações de fonte ─────────────────────────

const WIN_ANSI_80: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ',
  0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

const MAC_ROMAN_80 = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function winAnsi(codigo: number): string {
  if (codigo >= 0x20 && codigo <= 0x7e) return String.fromCharCode(codigo);
  if (codigo >= 0xa0) return String.fromCharCode(codigo);
  return WIN_ANSI_80[codigo] ?? '';
}

function macRoman(codigo: number): string {
  if (codigo < 0x80) return codigo >= 0x20 ? String.fromCharCode(codigo) : '';
  return MAC_ROMAN_80[codigo - 0x80] ?? '';
}

const ACENTOS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', tilde: '\u0303', dieresis: '\u0308', cedilla: '\u0327', ring: '\u030a' };
const DIGITOS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const GLIFOS: Record<string, string> = {
  space: ' ', nbspace: ' ', period: '.', comma: ',', colon: ':', semicolon: ';', hyphen: '-', minus: '-', endash: '–', emdash: '—',
  parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', braceleft: '{', braceright: '}', slash: '/', backslash: '\\',
  bar: '|', quotesingle: "'", quotedbl: '"', quoteright: '’', quoteleft: '‘', quotedblleft: '“', quotedblright: '”', percent: '%',
  ampersand: '&', at: '@', numbersign: '#', dollar: '$', asterisk: '*', plus: '+', equal: '=', less: '<', greater: '>', question: '?',
  exclam: '!', underscore: '_', bullet: '•', degree: '°', ordmasculine: 'º', ordfeminine: 'ª', section: '§', periodcentered: '·',
  ellipsis: '…', copyright: '©', registered: '®', asciitilde: '~', asciicircum: '^', grave: '`', germandbls: 'ß', AE: 'Æ', ae: 'æ',
  oslash: 'ø', Oslash: 'Ø', OE: 'Œ', oe: 'œ', fi: 'fi', fl: 'fl', multiply: '×', sterling: '£', Euro: '€', twosuperior: '²',
  threesuperior: '³', quotesinglbase: '‚', quotedblbase: '„', guillemotleft: '«', guillemotright: '»', dotlessi: 'ı', trademark: '™',
};

/** Nome de glifo (Adobe Glyph List, subconjunto do português) → texto. */
function textoDoGlifo(nome: string): string {
  const base = nome.split('.')[0] ?? nome;
  if (/^[A-Za-z]$/.test(base)) return base;
  const digito = DIGITOS.indexOf(base);
  if (digito >= 0) return String(digito);
  if (GLIFOS[base] !== undefined) return GLIFOS[base];
  const uni = /^uni([0-9A-Fa-f]{4})/.exec(base) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(base);
  if (uni?.[1]) return String.fromCodePoint(Number.parseInt(uni[1], 16));
  for (const [acento, combinante] of Object.entries(ACENTOS)) {
    if (base.endsWith(acento) && base.length === acento.length + 1) return `${base[0] ?? ''}${combinante}`.normalize('NFC');
  }
  return '';
}

interface Fonte {
  bytes: 1 | 2;
  decodificar(codigo: number): string;
  /** Largura do glifo em milésimos de em. */
  largura(codigo: number): number;
}

function utf16be(bytes: Buffer): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  return s;
}

/** CMap /ToUnicode: bfchar e bfrange (incluindo a forma com lista). */
function lerToUnicode(dados: Buffer): { mapa: Map<number, string>; doisBytes: boolean } {
  const texto = dados.toString('latin1');
  const mapa = new Map<number, string>();
  let doisBytes = false;
  for (const bloco of texto.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const h of (bloco[1] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)) if ((h[1]?.length ?? 0) >= 4) doisBytes = true;
  }
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of (bloco[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      if ((par[1]?.length ?? 0) >= 4) doisBytes = true;
      mapa.set(Number.parseInt(par[1] ?? '0', 16), utf16be(Buffer.from(par[2] ?? '', 'hex')));
    }
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of (bloco[1] ?? '').matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const inicio = Number.parseInt(r[1] ?? '0', 16);
      const fim = Math.min(Number.parseInt(r[2] ?? '0', 16), inicio + 65_535);
      if ((r[1]?.length ?? 0) >= 4) doisBytes = true;
      const destino = r[3] ?? '';
      if (destino.startsWith('[')) {
        const itens = [...destino.matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => utf16be(Buffer.from(x[1] ?? '', 'hex')));
        itens.forEach((s, k) => {
          if (inicio + k <= fim) mapa.set(inicio + k, s);
        });
      } else {
        const base = Buffer.from(destino.slice(1, -1), 'hex');
        for (let codigo = inicio; codigo <= fim; codigo++) {
          const copia = Buffer.from(base);
          const ultimo = copia.length - 1;
          if (ultimo >= 0) {
            const soma = (copia[ultimo] ?? 0) + (codigo - inicio);
            copia[ultimo] = soma & 0xff;
            if (ultimo >= 1) copia[ultimo - 1] = ((copia[ultimo - 1] ?? 0) + (soma >> 8)) & 0xff;
          }
          mapa.set(codigo, utf16be(copia));
        }
      }
    }
  }
  return { mapa, doisBytes };
}

function criarFonte(doc: Documento, dict: Map<string, Valor> | null): Fonte {
  if (dict === null) return { bytes: 1, decodificar: winAnsi, largura: () => 500 };
  const subtipo = nomeDe(doc.resolver(dict.get('Subtype')));
  const toUnicode = doc.fluxo(dict.get('ToUnicode'));
  const cmap = toUnicode ? lerToUnicode(toUnicode.dados) : null;

  if (subtipo === 'Type0') {
    const descendente = doc.resolver(dict.get('DescendantFonts'));
    const cid = descendente.t === 'arr' ? doc.dict(descendente.v[0]) : null;
    const larguraPadrao = numeroDe(doc.resolver(cid?.get('DW')), 1000);
    const larguras = new Map<number, number>();
    const w = doc.resolver(cid?.get('W'));
    if (w.t === 'arr') {
      for (let i = 0; i < w.v.length && i < 20_000; ) {
        const primeiro = doc.resolver(w.v[i]);
        const segundo = doc.resolver(w.v[i + 1]);
        if (primeiro.t !== 'num') break;
        if (segundo.t === 'arr') {
          segundo.v.forEach((x, k) => larguras.set(primeiro.v + k, numeroDe(doc.resolver(x), larguraPadrao)));
          i += 2;
        } else {
          const terceiro = doc.resolver(w.v[i + 2]);
          for (let c = primeiro.v; c <= numeroDe(segundo) && c - primeiro.v < 65_536; c++) larguras.set(c, numeroDe(terceiro, larguraPadrao));
          i += 3;
        }
      }
    }
    return {
      bytes: cmap && !cmap.doisBytes ? 1 : 2,
      decodificar: (c) => cmap?.mapa.get(c) ?? '',
      largura: (c) => larguras.get(c) ?? larguraPadrao,
    };
  }

  const tabela: (string | undefined)[] = new Array(256);
  const codificacao = doc.resolver(dict.get('Encoding'));
  const nomeBase = codificacao.t === 'nome' ? codificacao.v : codificacao.t === 'dict' ? nomeDe(doc.resolver(codificacao.v.get('BaseEncoding'))) : null;
  const base = nomeBase === 'MacRomanEncoding' ? macRoman : winAnsi;
  if (codificacao.t === 'dict') {
    const diferencas = doc.resolver(codificacao.v.get('Differences'));
    if (diferencas.t === 'arr') {
      let codigo = 0;
      for (const item of diferencas.v) {
        const r = doc.resolver(item);
        if (r.t === 'num') codigo = r.v;
        else if (r.t === 'nome') {
          if (codigo >= 0 && codigo < 256) tabela[codigo] = textoDoGlifo(r.v);
          codigo++;
        }
      }
    }
  }
  const primeiro = numeroDe(doc.resolver(dict.get('FirstChar')));
  const listaLarguras = doc.resolver(dict.get('Widths'));
  return {
    bytes: 1,
    decodificar: (c) => cmap?.mapa.get(c) ?? tabela[c] ?? base(c),
    largura: (c) => (listaLarguras.t === 'arr' ? numeroDe(doc.resolver(listaLarguras.v[c - primeiro]), 500) : 500),
  };
}

// ───────────────────────── interpretação do conteúdo ─────────────────────────

type Matriz = [number, number, number, number, number, number];
const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

function multiplicar(m: Matriz, n: Matriz): Matriz {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

interface Trecho {
  x: number;
  y: number;
  xFim: number;
  tamanho: number;
  texto: string;
}

interface EstadoTexto {
  fonte: Fonte;
  tamanho: number;
  espacoCaractere: number;
  espacoPalavra: number;
  escala: number;
  entrelinha: number;
  elevacao: number;
  tm: Matriz;
  tlm: Matriz;
}

const LIMITE_OPERACOES = 2_000_000;

function interpretar(doc: Documento, conteudo: Buffer, recursos: Map<string, Valor> | null, ctmInicial: Matriz, trechos: Trecho[], profundidade: number, cacheFontes: Map<string, Fonte>): void {
  const leitor = new Leitor(conteudo);
  const operandos: Valor[] = [];
  const pilha: Matriz[] = [];
  let ctm = ctmInicial;
  const fontes = doc.dict(recursos?.get('Font'));
  const xobjetos = doc.dict(recursos?.get('XObject'));
  const estado: EstadoTexto = {
    fonte: criarFonte(doc, null),
    tamanho: 10,
    espacoCaractere: 0,
    espacoPalavra: 0,
    escala: 1,
    entrelinha: 0,
    elevacao: 0,
    tm: IDENTIDADE,
    tlm: IDENTIDADE,
  };

  const num = (i: number) => {
    const v = operandos[operandos.length - i];
    return v?.t === 'num' ? v.v : 0;
  };
  const deslocarLinha = (tx: number, ty: number) => {
    estado.tlm = multiplicar([1, 0, 0, 1, tx, ty], estado.tlm);
    estado.tm = estado.tlm;
  };
  const mostrar = (bytes: Buffer) => {
    const m = multiplicar(estado.tm, ctm);
    const x = m[4] + estado.elevacao * m[2];
    const y = m[5] + estado.elevacao * m[3];
    let texto = '';
    let avanco = 0;
    const passo = estado.fonte.bytes;
    for (let i = 0; i + passo - 1 < bytes.length; i += passo) {
      const codigo = passo === 2 ? ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0) : (bytes[i] ?? 0);
      const ch = estado.fonte.decodificar(codigo);
      texto += ch;
      avanco += ((estado.fonte.largura(codigo) / 1000) * estado.tamanho + estado.espacoCaractere + (passo === 1 && codigo === 32 ? estado.espacoPalavra : 0)) * estado.escala;
    }
    const tamanho = Math.abs(estado.tamanho * Math.hypot(m[2], m[3])) || Math.abs(estado.tamanho);
    if (texto !== '') trechos.push({ x, y, xFim: x + avanco * m[0], tamanho, texto });
    estado.tm = multiplicar([1, 0, 0, 1, avanco, 0], estado.tm);
  };

  for (let operacoes = 0; operacoes < LIMITE_OPERACOES; operacoes++) {
    const v = leitor.valor();
    if (v === null) break;
    if (v.t !== 'op') {
      operandos.push(v);
      if (operandos.length > 64) operandos.shift();
      continue;
    }
    switch (v.v) {
      case 'q':
        if (pilha.length < 64) pilha.push(ctm);
        break;
      case 'Q':
        ctm = pilha.pop() ?? ctm;
        break;
      case 'cm':
        ctm = multiplicar([num(6), num(5), num(4), num(3), num(2), num(1)], ctm);
        break;
      case 'BT':
        estado.tm = IDENTIDADE;
        estado.tlm = IDENTIDADE;
        break;
      case 'Tf': {
        const nome = operandos[operandos.length - 2];
        estado.tamanho = num(1);
        if (nome?.t === 'nome') {
          let fonte = cacheFontes.get(nome.v);
          if (!fonte) {
            fonte = criarFonte(doc, doc.dict(fontes?.get(nome.v)));
            cacheFontes.set(nome.v, fonte);
          }
          estado.fonte = fonte;
        }
        break;
      }
      case 'Tc':
        estado.espacoCaractere = num(1);
        break;
      case 'Tw':
        estado.espacoPalavra = num(1);
        break;
      case 'Tz':
        estado.escala = num(1) / 100;
        break;
      case 'TL':
        estado.entrelinha = num(1);
        break;
      case 'Ts':
        estado.elevacao = num(1);
        break;
      case 'Td':
        deslocarLinha(num(2), num(1));
        break;
      case 'TD':
        estado.entrelinha = -num(1);
        deslocarLinha(num(2), num(1));
        break;
      case 'Tm':
        estado.tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
        estado.tm = estado.tlm;
        break;
      case 'T*':
        deslocarLinha(0, -estado.entrelinha);
        break;
      case 'Tj': {
        const s = operandos[operandos.length - 1];
        if (s?.t === 'str') mostrar(s.v);
        break;
      }
      case "'": {
        deslocarLinha(0, -estado.entrelinha);
        const s = operandos[operandos.length - 1];
        if (s?.t === 'str') mostrar(s.v);
        break;
      }
      case '"': {
        estado.espacoPalavra = num(3);
        estado.espacoCaractere = num(2);
        deslocarLinha(0, -estado.entrelinha);
        const s = operandos[operandos.length - 1];
        if (s?.t === 'str') mostrar(s.v);
        break;
      }
      case 'TJ': {
        const lista = operandos[operandos.length - 1];
        if (lista?.t === 'arr') {
          for (const item of lista.v) {
            if (item.t === 'str') mostrar(item.v);
            else if (item.t === 'num') {
              const ajuste = (-item.v / 1000) * estado.tamanho * estado.escala;
              estado.tm = multiplicar([1, 0, 0, 1, ajuste, 0], estado.tm);
            }
          }
        }
        break;
      }
      case 'Do': {
        const nome = operandos[operandos.length - 1];
        if (nome?.t !== 'nome' || profundidade >= 6) break;
        const ref = xobjetos?.get(nome.v);
        const formulario = doc.fluxo(ref);
        if (!formulario || nomeDe(doc.resolver(formulario.dict.get('Subtype'))) !== 'Form') break;
        const matriz = doc.resolver(formulario.dict.get('Matrix'));
        const m: Matriz = matriz.t === 'arr' && matriz.v.length === 6 ? (matriz.v.map((x) => numeroDe(doc.resolver(x))) as Matriz) : IDENTIDADE;
        const recursosFormulario = doc.dict(formulario.dict.get('Resources')) ?? recursos;
        interpretar(doc, formulario.dados, recursosFormulario, multiplicar(m, ctm), trechos, profundidade + 1, new Map());
        break;
      }
      case 'ID': {
        // Imagem embutida: pula os dados binários até "EI".
        const fim = /\sEI(?=[\s]|$)/.exec(conteudo.toString('latin1', leitor.pos));
        leitor.pos = fim ? leitor.pos + fim.index + fim[0].length : conteudo.length;
        break;
      }
      default:
        break;
    }
    operandos.length = 0;
  }
}

/** Agrupa os trechos em linhas (mesma altura) e ordena por posição: de cima para baixo, da esquerda para a direita. */
function montarLinhas(trechos: Trecho[]): string[] {
  const ordenados = [...trechos].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: Trecho[][] = [];
  for (const t of ordenados) {
    const atual = linhas[linhas.length - 1];
    const referencia = atual?.[0];
    if (atual && referencia && Math.abs(referencia.y - t.y) <= Math.max(2, 0.45 * Math.min(referencia.tamanho, t.tamanho))) atual.push(t);
    else linhas.push([t]);
  }
  return linhas
    .map((grupo) => {
      grupo.sort((a, b) => a.x - b.x);
      let texto = '';
      let anterior: Trecho | null = null;
      for (const t of grupo) {
        if (anterior !== null) {
          const lacuna = t.x - anterior.xFim;
          const separa = lacuna > 0.2 * Math.min(anterior.tamanho, t.tamanho) || t.x < anterior.x;
          if (separa && !texto.endsWith(' ') && !t.texto.startsWith(' ')) texto += ' ';
        }
        texto += t.texto;
        anterior = t;
      }
      return texto.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    })
    .filter((l) => l !== '');
}

/** Páginas na ordem da árvore /Pages, com os recursos herdados. */
function listarPaginas(doc: Documento): { dict: Map<string, Valor>; recursos: Map<string, Valor> | null }[] {
  const paginas: { dict: Map<string, Valor>; recursos: Map<string, Valor> | null }[] = [];
  const visitados = new Set<Map<string, Valor>>();
  const percorrer = (no: Map<string, Valor> | null, recursos: Map<string, Valor> | null, profundidade: number) => {
    if (no === null || visitados.has(no) || profundidade > 32 || paginas.length >= 2000) return;
    visitados.add(no);
    const proprios = doc.dict(no.get('Resources')) ?? recursos;
    const tipo = nomeDe(doc.resolver(no.get('Type')));
    const filhos = doc.resolver(no.get('Kids'));
    if (tipo === 'Pages' || filhos.t === 'arr') {
      if (filhos.t === 'arr') for (const f of filhos.v) percorrer(doc.dict(f), proprios, profundidade + 1);
    } else {
      paginas.push({ dict: no, recursos: proprios });
    }
  };
  const catalogo = [...doc.objetos.values()].find((o) => o.valor.t === 'dict' && nomeDe(o.valor.v.get('Type')) === 'Catalog');
  if (catalogo?.valor.t === 'dict') percorrer(doc.dict(catalogo.valor.v.get('Pages')), null, 0);
  if (paginas.length === 0) {
    for (const [, o] of [...doc.objetos.entries()].sort((a, b) => a[0] - b[0])) {
      if (o.valor.t === 'dict' && nomeDe(o.valor.v.get('Type')) === 'Page') paginas.push({ dict: o.valor.v, recursos: doc.dict(o.valor.v.get('Resources')) });
    }
  }
  return paginas;
}

/**
 * Extrai o texto de um PDF por página e linha. Não lança por PDF malformado: devolve o que conseguir ler (o que
 * não tiver texto segue para o OCR).
 */
export function lerTextoPdf(pdf: Buffer): ResultadoLeituraPdf {
  const objetos = lerObjetos(pdf);
  const doc = new Documento(objetos);
  const criptografado = /\/Encrypt\s/.test(pdf.toString('latin1', Math.max(0, pdf.length - 4096))) || [...objetos.values()].some((o) => o.valor.t === 'dict' && o.valor.v.has('Encrypt') && nomeDe(o.valor.v.get('Type')) === 'XRef');
  if (criptografado) return { paginas: [], caracteres: 0, criptografado: true };
  expandirFluxosDeObjetos(doc);

  const paginas: PaginaLida[] = [];
  let caracteres = 0;
  listarPaginas(doc).forEach((pagina, indice) => {
    const conteudos = doc.resolver(pagina.dict.get('Contents'));
    const refs = conteudos.t === 'arr' ? conteudos.v : [pagina.dict.get('Contents')];
    const partes: Buffer[] = [];
    for (const ref of refs) {
      const f = ref === undefined ? null : doc.fluxo(ref);
      if (f) partes.push(f.dados, Buffer.from('\n'));
    }
    const trechos: Trecho[] = [];
    try {
      interpretar(doc, Buffer.concat(partes), pagina.recursos, IDENTIDADE, trechos, 0, new Map());
    } catch {
      // conteúdo malformado: fica com o que foi lido até aqui
    }
    const linhas = montarLinhas(trechos);
    for (const l of linhas) caracteres += (l.match(/[\p{L}\p{N}]/gu) ?? []).length;
    paginas.push({ numero: indice + 1, linhas });
  });
  return { paginas, caracteres, criptografado: false };
}

/** Há texto útil? Média de ao menos 20 letras/dígitos por página (abaixo disso, trata como digitalizado). */
export function temCamadaDeTexto(r: ResultadoLeituraPdf): boolean {
  return !r.criptografado && r.paginas.length > 0 && r.caracteres >= 20 * r.paginas.length;
}

/** Nomes que indicam conteúdo ativo ou arquivo embutido: um atestado ou certidão não precisa de nenhum deles. */
const NOMES_ATIVOS = new Set(['JavaScript', 'JS', 'Launch', 'EmbeddedFile', 'EmbeddedFiles', 'RichMedia', 'XFA', 'SubmitForm', 'ImportData', 'GoToE']);

function coletarAtivos(v: Valor, achados: Set<string>, profundidade: number): void {
  if (profundidade > 32) return;
  if (v.t === 'nome' && NOMES_ATIVOS.has(v.v)) achados.add(v.v);
  else if (v.t === 'arr') for (const x of v.v) coletarAtivos(x, achados, profundidade + 1);
  else if (v.t === 'dict') {
    for (const [chave, x] of v.v) {
      if (NOMES_ATIVOS.has(chave)) achados.add(chave);
      coletarAtivos(x, achados, profundidade + 1);
    }
  }
}

/**
 * Inspeção de segurança do PDF enviado (RF-21): conta as páginas e procura ação JavaScript, abertura de programa,
 * arquivo embutido, formulário XFA e envio de formulário, inclusive dentro de fluxos de objetos.
 */
export function inspecionarPdf(pdf: Buffer): { paginas: number; ativos: string[]; criptografado: boolean } {
  const doc = new Documento(lerObjetos(pdf));
  expandirFluxosDeObjetos(doc);
  const achados = new Set<string>();
  for (const o of doc.objetos.values()) coletarAtivos(o.valor, achados, 0);
  const criptografado = [...doc.objetos.values()].some((o) => o.valor.t === 'dict' && o.valor.v.has('Encrypt')) || /\/Encrypt\s/.test(pdf.toString('latin1', Math.max(0, pdf.length - 4096)));
  return { paginas: listarPaginas(doc).length, ativos: [...achados].sort(), criptografado };
}
