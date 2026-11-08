/**
 * Cofre de anexos sigilosos (RNF-09): o conteúdo fica cifrado em repouso com AES-256-GCM, sobre o armazenamento de
 * documentos do processo (RF-21). A chave é do órgão (`AGORA_COFRE_CHAVE`, 32 bytes); fora de produção, sem a variável,
 * é derivada do segredo do servidor (HKDF), para a demonstração funcionar. Em produção, sem a chave, o cofre fica
 * indisponível e nada é gravado em claro no lugar dele.
 *
 * Formato gravado: "AGC1" | nonce (12 bytes) | etiqueta GCM (16 bytes) | texto cifrado. Os dados autenticados (AAD)
 * ligam o conteúdo ao registro (id do anexo e SHA-256 do original): trocar o arquivo cifrado de registro é detectado.
 * O conteúdo cifrado é endereçado pelo próprio SHA-256 no armazenamento, como os demais documentos.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Config } from '../../config.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';

const MAGICA = Buffer.from('AGC1', 'latin1');
const TAMANHO_NONCE = 12;
const TAMANHO_ETIQUETA = 16;

export interface ChaveCofre {
  chave: Buffer;
  /** Impressão da chave: 8 bytes do SHA-256 em hexadecimal (identifica a chave sem revelá-la). */
  id: string;
  /** Derivada do segredo do servidor (só fora de produção, sem AGORA_COFRE_CHAVE). */
  derivada: boolean;
}

export class ErroCofre extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroCofre';
  }
}

export function idChave(chave: Buffer): string {
  return sha256Hex(chave).slice(0, 16);
}

/** Chave do cofre: a do órgão; fora de produção, derivada do segredo; em produção sem a variável, null. */
export function resolverChaveCofre(config: Config, segredo: string): ChaveCofre | null {
  if (config.sigilo.cofreChave !== null) return { chave: config.sigilo.cofreChave, id: idChave(config.sigilo.cofreChave), derivada: false };
  if (config.ambiente === 'producao') return null;
  const chave = Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from('agora-cofre', 'utf8'), Buffer.from('agora:cofre:aes-256-gcm:v1', 'utf8'), 32));
  return { chave, id: idChave(chave), derivada: true };
}

/** Dados autenticados do anexo: o conteúdo cifrado só abre no registro em que foi selado. */
export function aadAnexo(arquivoId: string, sha256Claro: string): Buffer {
  return Buffer.from(`agora:cofre:v1:${arquivoId.toLowerCase()}:${sha256Claro}`, 'utf8');
}

export function cifrar(chave: ChaveCofre, conteudo: Buffer, aad: Buffer): Buffer {
  const nonce = randomBytes(TAMANHO_NONCE);
  const cifra = createCipheriv('aes-256-gcm', chave.chave, nonce, { authTagLength: TAMANHO_ETIQUETA });
  cifra.setAAD(aad);
  const cifrado = Buffer.concat([cifra.update(conteudo), cifra.final()]);
  return Buffer.concat([MAGICA, nonce, cifra.getAuthTag(), cifrado]);
}

export function decifrar(chave: ChaveCofre, pacote: Buffer, aad: Buffer): Buffer {
  if (pacote.length < MAGICA.length + TAMANHO_NONCE + TAMANHO_ETIQUETA || !pacote.subarray(0, MAGICA.length).equals(MAGICA)) {
    throw new ErroCofre('O conteúdo do cofre não está no formato esperado.');
  }
  const nonce = pacote.subarray(MAGICA.length, MAGICA.length + TAMANHO_NONCE);
  const etiqueta = pacote.subarray(MAGICA.length + TAMANHO_NONCE, MAGICA.length + TAMANHO_NONCE + TAMANHO_ETIQUETA);
  const cifrado = pacote.subarray(MAGICA.length + TAMANHO_NONCE + TAMANHO_ETIQUETA);
  try {
    const decifra = createDecipheriv('aes-256-gcm', chave.chave, nonce, { authTagLength: TAMANHO_ETIQUETA });
    decifra.setAAD(aad);
    decifra.setAuthTag(etiqueta);
    return Buffer.concat([decifra.update(cifrado), decifra.final()]);
  } catch {
    throw new ErroCofre('O conteúdo do cofre não confere: chave diferente ou arquivo adulterado.');
  }
}
