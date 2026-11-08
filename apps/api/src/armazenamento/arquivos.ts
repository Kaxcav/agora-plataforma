/**
 * Armazenamento dos documentos enviados ao processo (RF-21). O banco guarda os metadados e o SHA-256; o conteúdo
 * fica aqui, endereçado pelo próprio hash (`sha256/ab/cd/<hash>`): o mesmo arquivo é gravado uma vez e qualquer
 * alteração no disco é detectada na leitura. A interface permite trocar o disco local por um armazenamento de
 * objetos auto-hospedado no órgão (compatível com S3, por exemplo) sem mudar as rotas.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Hex } from '../compartilhado/cripto.ts';

export interface ArmazenamentoArquivos {
  readonly tipo: 'disco' | 'memoria';
  /** Grava o conteúdo sob o seu SHA-256 (idempotente). */
  gravar(sha256: string, conteudo: Buffer): Promise<void>;
  /** Lê e confere a integridade; lança `ErroArmazenamento` se faltar ou se o conteúdo não bater com o hash. */
  ler(sha256: string): Promise<Buffer>;
}

export class ErroArmazenamento extends Error {
  readonly motivo: 'ausente' | 'corrompido';
  constructor(motivo: 'ausente' | 'corrompido', mensagem: string) {
    super(mensagem);
    this.name = 'ErroArmazenamento';
    this.motivo = motivo;
  }
}

const HASH = /^[0-9a-f]{64}$/;

function exigirHash(sha256: string): void {
  if (!HASH.test(sha256)) throw new Error('Chave de armazenamento inválida: esperado SHA-256 em hexadecimal.');
}

function conferir(sha256: string, conteudo: Buffer): Buffer {
  if (sha256Hex(conteudo) !== sha256) throw new ErroArmazenamento('corrompido', 'O arquivo armazenado não confere com o SHA-256 registrado.');
  return conteudo;
}

class ArmazenamentoDisco implements ArmazenamentoArquivos {
  readonly tipo = 'disco' as const;
  private readonly raiz: string;

  constructor(diretorio: string) {
    this.raiz = resolve(diretorio);
  }

  private caminho(sha256: string): string {
    exigirHash(sha256);
    return join(this.raiz, 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async gravar(sha256: string, conteudo: Buffer): Promise<void> {
    if (sha256Hex(conteudo) !== sha256) throw new Error('O conteúdo não confere com o SHA-256 informado.');
    const destino = this.caminho(sha256);
    try {
      await stat(destino);
      return;
    } catch {
      // ainda não existe
    }
    await mkdir(dirname(destino), { recursive: true, mode: 0o750 });
    // Escrita atômica: arquivo temporário no mesmo diretório e renomeação.
    const temporario = `${destino}.${randomUUID()}.tmp`;
    await writeFile(temporario, conteudo, { mode: 0o640, flag: 'wx' });
    await rename(temporario, destino);
  }

  async ler(sha256: string): Promise<Buffer> {
    let conteudo: Buffer;
    try {
      conteudo = await readFile(this.caminho(sha256));
    } catch {
      throw new ErroArmazenamento('ausente', 'O arquivo não foi encontrado no armazenamento.');
    }
    return conferir(sha256, conteudo);
  }
}

class ArmazenamentoMemoria implements ArmazenamentoArquivos {
  readonly tipo = 'memoria' as const;
  private readonly arquivos = new Map<string, Buffer>();

  async gravar(sha256: string, conteudo: Buffer): Promise<void> {
    exigirHash(sha256);
    if (sha256Hex(conteudo) !== sha256) throw new Error('O conteúdo não confere com o SHA-256 informado.');
    if (!this.arquivos.has(sha256)) this.arquivos.set(sha256, Buffer.from(conteudo));
  }

  async ler(sha256: string): Promise<Buffer> {
    exigirHash(sha256);
    const conteudo = this.arquivos.get(sha256);
    if (!conteudo) throw new ErroArmazenamento('ausente', 'O arquivo não foi encontrado no armazenamento.');
    return conferir(sha256, Buffer.from(conteudo));
  }
}

/** `memory://` (testes) ou diretório local; `null` = envio de documentos desligado. */
export function criarArmazenamento(diretorio: string | null): ArmazenamentoArquivos | null {
  if (diretorio === null) return null;
  if (diretorio.startsWith('memory://')) return new ArmazenamentoMemoria();
  return new ArmazenamentoDisco(diretorio);
}
