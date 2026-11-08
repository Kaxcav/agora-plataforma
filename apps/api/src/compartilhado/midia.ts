/**
 * Imagens e vídeos da gestão compartilhada com a sociedade (art. 174, § 3º, VI, e art. 19, III): o formato é
 * conferido pelo conteúdo (nunca pela extensão) e os metadados que podem revelar localização, aparelho ou autor
 * são removidos antes de o arquivo ser guardado (LGPD, art. 6º, III). Sem dependências: leitura direta da estrutura
 * de cada formato.
 *
 * - JPEG: segmentos APP1 (EXIF com GPS e XMP), APP3 a APP13 e APP15 e comentários são retirados; ficam APP0 (JFIF),
 *   APP2 (perfil de cor ICC) e APP14 (Adobe), necessários para exibir as cores corretamente.
 * - PNG: blocos eXIf, tEXt, zTXt, iTXt e tIME são retirados.
 * - MP4/MOV (ISO-BMFF): caixas udta, meta e uuid (onde ficam GPS, aparelho e XMP) são zeradas e renomeadas para
 *   `free`, sem mudar tamanhos — os deslocamentos das amostras continuam válidos e o vídeo segue tocável.
 */
import { detectarFormato } from './tipo-arquivo.ts';

export type FormatoMidia = 'jpeg' | 'png' | 'mp4';

export const TIPO_CONTEUDO_MIDIA: Record<FormatoMidia, string> = { jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' };

export class ErroMidia extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroMidia';
  }
}

/** Formato pelo conteúdo: JPEG, PNG ou vídeo ISO-BMFF que começa pela caixa `ftyp` (MP4 e MOV de celulares). */
export function detectarFormatoMidia(conteudo: Buffer): FormatoMidia | null {
  const imagem = detectarFormato(conteudo);
  if (imagem === 'jpeg' || imagem === 'png') return imagem;
  if (conteudo.length >= 16 && conteudo.toString('latin1', 4, 8) === 'ftyp' && conteudo.readUInt32BE(0) >= 8) return 'mp4';
  return null;
}

// ───────── JPEG ─────────

const MARCADORES_SEM_TAMANHO = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const APP_MANTIDOS = new Set([0xe0, 0xe2, 0xee]);

function rotuloSegmentoJpeg(marcador: number, segmento: Buffer): string {
  if (marcador === 0xfe) return 'comentário (COM)';
  if (marcador === 0xe1) {
    const assinatura = segmento.toString('latin1', 4, 10);
    if (assinatura.startsWith('Exif')) return 'EXIF, com localização e aparelho (APP1)';
    return 'XMP (APP1)';
  }
  if (marcador === 0xed) return 'IPTC (APP13)';
  return `APP${marcador - 0xe0}`;
}

function limparJpeg(conteudo: Buffer): { conteudo: Buffer; removidos: string[] } {
  const partes: Buffer[] = [conteudo.subarray(0, 2)];
  const removidos: string[] = [];
  let i = 2;
  while (i < conteudo.length) {
    if (conteudo[i] !== 0xff) throw new ErroMidia('JPEG malformado: marcador esperado.');
    let j = i;
    while (j < conteudo.length && conteudo[j] === 0xff) j += 1;
    if (j >= conteudo.length) throw new ErroMidia('JPEG truncado.');
    const marcador = conteudo[j] ?? 0;
    const inicio = j - 1;
    if (marcador === 0xd9) {
      partes.push(conteudo.subarray(inicio));
      return { conteudo: Buffer.concat(partes), removidos };
    }
    if (marcador === 0xda) {
      // Início dos dados da imagem: o restante (varreduras e marcadores seguintes) é copiado como está.
      partes.push(conteudo.subarray(inicio));
      return { conteudo: Buffer.concat(partes), removidos };
    }
    if (MARCADORES_SEM_TAMANHO.has(marcador)) {
      partes.push(conteudo.subarray(inicio, j + 1));
      i = j + 1;
      continue;
    }
    if (j + 2 >= conteudo.length) throw new ErroMidia('JPEG truncado.');
    const tamanho = conteudo.readUInt16BE(j + 1);
    const fim = j + 1 + tamanho;
    if (tamanho < 2 || fim > conteudo.length) throw new ErroMidia('JPEG malformado: tamanho de segmento inválido.');
    const segmento = conteudo.subarray(inicio, fim);
    const ehApp = marcador >= 0xe0 && marcador <= 0xef;
    if ((ehApp && !APP_MANTIDOS.has(marcador)) || marcador === 0xfe) {
      const rotulo = rotuloSegmentoJpeg(marcador, segmento);
      if (!removidos.includes(rotulo)) removidos.push(rotulo);
    } else {
      partes.push(segmento);
    }
    i = fim;
  }
  throw new ErroMidia('JPEG sem dados de imagem.');
}

// ───────── PNG ─────────

const BLOCOS_PNG_REMOVIDOS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function limparPng(conteudo: Buffer): { conteudo: Buffer; removidos: string[] } {
  const partes: Buffer[] = [conteudo.subarray(0, 8)];
  const removidos: string[] = [];
  let i = 8;
  let fimEncontrado = false;
  while (i + 12 <= conteudo.length) {
    const tamanho = conteudo.readUInt32BE(i);
    const tipo = conteudo.toString('latin1', i + 4, i + 8);
    const fim = i + 12 + tamanho;
    if (fim > conteudo.length) throw new ErroMidia('PNG malformado: bloco além do fim do arquivo.');
    if (BLOCOS_PNG_REMOVIDOS.has(tipo)) {
      const rotulo = tipo === 'eXIf' ? 'EXIF, com localização e aparelho (eXIf)' : `texto e data (${tipo})`;
      if (!removidos.includes(rotulo)) removidos.push(rotulo);
    } else {
      partes.push(conteudo.subarray(i, fim));
    }
    i = fim;
    if (tipo === 'IEND') {
      fimEncontrado = true;
      break;
    }
  }
  if (!fimEncontrado) throw new ErroMidia('PNG truncado: bloco IEND ausente.');
  return { conteudo: Buffer.concat(partes), removidos };
}

// ───────── MP4 / MOV ─────────

const CAIXAS_CONTEINER = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
const CAIXAS_METADADOS = new Set(['udta', 'meta', 'uuid']);

function percorrerCaixas(buffer: Buffer, inicio: number, fim: number, removidos: string[], profundidade: number): void {
  if (profundidade > 8) throw new ErroMidia('Vídeo malformado: caixas aninhadas demais.');
  let i = inicio;
  while (i + 8 <= fim) {
    let tamanho = buffer.readUInt32BE(i);
    const tipo = buffer.toString('latin1', i + 4, i + 8);
    let cabecalho = 8;
    if (tamanho === 1) {
      if (i + 16 > fim) throw new ErroMidia('Vídeo malformado: tamanho estendido truncado.');
      const grande = buffer.readBigUInt64BE(i + 8);
      if (grande > BigInt(fim - i)) throw new ErroMidia('Vídeo malformado: caixa além do fim do arquivo.');
      tamanho = Number(grande);
      cabecalho = 16;
    } else if (tamanho === 0) {
      tamanho = fim - i;
    }
    if (tamanho < cabecalho || i + tamanho > fim) throw new ErroMidia('Vídeo malformado: tamanho de caixa inválido.');
    if (CAIXAS_METADADOS.has(tipo)) {
      buffer.write('free', i + 4, 'latin1');
      buffer.fill(0, i + cabecalho, i + tamanho);
      const rotulo = tipo === 'uuid' ? 'XMP e extensões (uuid)' : `metadados, com localização e aparelho (${tipo})`;
      if (!removidos.includes(rotulo)) removidos.push(rotulo);
    } else if (CAIXAS_CONTEINER.has(tipo)) {
      percorrerCaixas(buffer, i + cabecalho, i + tamanho, removidos, profundidade + 1);
    }
    i += tamanho;
  }
}

function limparMp4(conteudo: Buffer): { conteudo: Buffer; removidos: string[] } {
  const copia = Buffer.from(conteudo);
  const removidos: string[] = [];
  percorrerCaixas(copia, 0, copia.length, removidos, 0);
  return { conteudo: copia, removidos };
}

/** Remove os metadados conforme o formato. Lança `ErroMidia` se a estrutura do arquivo estiver corrompida. */
export function removerMetadados(conteudo: Buffer, formato: FormatoMidia): { conteudo: Buffer; removidos: string[] } {
  if (formato === 'jpeg') return limparJpeg(conteudo);
  if (formato === 'png') return limparPng(conteudo);
  return limparMp4(conteudo);
}
