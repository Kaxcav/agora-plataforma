import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(conteudo: string | Buffer): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Comparação em tempo constante, inclusive para comprimentos diferentes. */
export function iguaisTempoConstante(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** `ip_hash` = sha256(ip + segredo): o IP nunca é guardado em claro (ARQUITETURA §3.5). */
export function hashIp(ip: string, segredo: string): string {
  return sha256Hex(`${ip}${segredo}`);
}

/** HMAC-SHA256 em base64url, para valores assinados de vida curta. */
export function assinar(valor: string, segredo: string): string {
  return createHmac('sha256', segredo).update(valor).digest('base64url');
}
