/**
 * Arquivos sintéticos para os testes da gestão compartilhada: PNG válido de 2×2 pixels, JPEG estrutural e MP4
 * mínimo, todos com metadados de localização falsos (marca `LOCALIZACAO-SINTETICA`) que a Ágora deve remover.
 */
import { crc32, deflateSync } from 'node:zlib';

export const MARCA_LOCALIZACAO = 'LOCALIZACAO-SINTETICA -15.7939,-47.8828';

function blocoPng(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** PNG RGB de 2×2 pixels (cor parametrizável) com blocos tEXt e eXIf contendo a marca de localização. */
export function pngComLocalizacao(cor: readonly [number, number, number] = [19, 81, 180]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 2; // RGB
  const linha = Buffer.from([0, ...cor, ...cor]);
  const pixels = deflateSync(Buffer.concat([linha, linha]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocoPng('IHDR', ihdr),
    blocoPng('tEXt', Buffer.from(`Comment\0${MARCA_LOCALIZACAO}`, 'latin1')),
    blocoPng('eXIf', Buffer.from(`MM\0*${MARCA_LOCALIZACAO}`, 'latin1')),
    blocoPng('IDAT', pixels),
    blocoPng('IEND', Buffer.alloc(0)),
  ]);
}

function segmentoJpeg(marcador: number, dados: Buffer): Buffer {
  const cabecalho = Buffer.from([0xff, marcador, 0, 0]);
  cabecalho.writeUInt16BE(dados.length + 2, 2);
  return Buffer.concat([cabecalho, dados]);
}

/** JPEG com APP0 (JFIF), APP1 (EXIF com a marca), comentário, tabela de quantização e dados da varredura. */
export function jpegComLocalizacao(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segmentoJpeg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segmentoJpeg(0xe1, Buffer.from(`Exif\0\0${MARCA_LOCALIZACAO}`, 'latin1')),
    segmentoJpeg(0xfe, Buffer.from(`Comentario ${MARCA_LOCALIZACAO}`, 'latin1')),
    segmentoJpeg(0xdb, Buffer.alloc(65, 1)),
    segmentoJpeg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function caixa(tipo: string, dados: Buffer): Buffer {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(dados.length + 8);
  cabecalho.write(tipo, 4, 'latin1');
  return Buffer.concat([cabecalho, dados]);
}

/** MP4 mínimo: ftyp, moov (mvhd e udta com ©xyz) e mdat. */
export function mp4ComLocalizacao(): Buffer {
  const ftyp = caixa('ftyp', Buffer.concat([Buffer.from('isom', 'latin1'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41', 'latin1')]));
  const udta = caixa('udta', caixa('©xyz', Buffer.from(MARCA_LOCALIZACAO, 'latin1')));
  const moov = caixa('moov', Buffer.concat([caixa('mvhd', Buffer.alloc(100)), udta]));
  const mdat = caixa('mdat', Buffer.alloc(64, 7));
  return Buffer.concat([ftyp, moov, mdat]);
}
