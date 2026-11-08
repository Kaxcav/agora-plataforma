/**
 * Identificação do formato pelo conteúdo (assinatura dos primeiros bytes), nunca pela extensão nem pelo
 * Content-Type declarado pelo navegador (RF-21). Só PDF, PNG e JPEG são aceitos como documento do processo.
 */
import type { FormatoArquivo } from '@agora/contratos';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Formato pelos bytes iniciais; `null` para qualquer outro conteúdo (executável, ZIP, HTML, texto...). */
export function detectarFormato(conteudo: Buffer): FormatoArquivo | null {
  if (conteudo.length >= 8 && conteudo.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (conteudo.length >= 24 && conteudo.subarray(0, 8).equals(PNG) && conteudo.toString('latin1', 12, 16) === 'IHDR') return 'png';
  if (conteudo.length >= 4 && conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff) return 'jpeg';
  return null;
}

export const TIPO_CONTEUDO: Record<FormatoArquivo, string> = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' };
export const EXTENSAO: Record<FormatoArquivo, string> = { pdf: 'pdf', png: 'png', jpeg: 'jpg' };

/**
 * Nome original só para exibição: sem diretórios, sem caracteres de controle e com no máximo 200 caracteres.
 * O arquivo nunca é gravado com este nome (o armazenamento usa o SHA-256).
 */
export function sanitizarNomeArquivo(bruto: string | undefined): string {
  let nome = '';
  try {
    nome = decodeURIComponent(bruto ?? '');
  } catch {
    nome = bruto ?? '';
  }
  const partes = nome.split(/[\\/]/);
  const base = (partes[partes.length - 1] ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base.slice(0, 200) || 'documento';
}

/** Cabeçalho Content-Disposition de anexo, com nome ASCII de reserva e o nome UTF-8 (RFC 6266). */
export function disposicaoAnexo(nome: string, formato: FormatoArquivo): string {
  const comExtensao = new RegExp(`\\.${EXTENSAO[formato]}$|\\.${formato}$`, 'i').test(nome) ? nome : `${nome}.${EXTENSAO[formato]}`;
  const ascii = comExtensao
    .normalize('NFD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\%]/g, '')
    .trim();
  return `attachment; filename="${ascii || `documento.${EXTENSAO[formato]}`}"; filename*=UTF-8''${encodeURIComponent(comExtensao)}`;
}
