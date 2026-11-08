import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Parâmetros do scrypt (ARQUITETURA §3.2): N=16384, r=8, p=1, 64 bytes, sal de 16 bytes. */
const N = 16_384;
const R = 8;
const P = 1;
const TAMANHO_CHAVE = 64;
const TAMANHO_SAL = 16;
export const TAMANHO_MINIMO_SENHA = 12;

function derivar(senha: string, sal: Buffer, opcoes: ScryptOptions, tamanho: number): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scrypt(senha.normalize('NFKC'), sal, tamanho, { ...opcoes, maxmem: 64 * 1024 * 1024 }, (erro, chave) => {
      if (erro) rejeitar(erro);
      else resolver(chave);
    });
  });
}

/** Gera o hash no formato `scrypt$N$r$p$sal$hash` (sal e hash em base64). */
export async function gerarHashSenha(senha: string): Promise<string> {
  const sal = randomBytes(TAMANHO_SAL);
  const chave = await derivar(senha, sal, { N, r: R, p: P }, TAMANHO_CHAVE);
  return ['scrypt', N, R, P, sal.toString('base64'), chave.toString('base64')].join('$');
}

let hashFicticio: Promise<string> | null = null;

/**
 * Compara a senha com o hash em tempo constante. Com `hash` nulo (usuário inexistente ou sem senha),
 * executa a mesma derivação contra um hash fictício para não revelar, pelo tempo, se o e-mail existe.
 */
export async function verificarSenha(senha: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    hashFicticio ??= gerarHashSenha(randomBytes(18).toString('base64'));
    await verificarSenha(senha, await hashFicticio);
    return false;
  }
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, nTexto, rTexto, pTexto, salTexto, chaveTexto] = partes;
  const n = Number(nTexto);
  const r = Number(rTexto);
  const p = Number(pTexto);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || !salTexto || !chaveTexto) return false;
  const esperado = Buffer.from(chaveTexto, 'base64');
  const obtido = await derivar(senha, Buffer.from(salTexto, 'base64'), { N: n, r, p }, esperado.length);
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/** Política mínima: 12 caracteres, com letras e números ou símbolos. */
export function avaliarPoliticaSenha(senha: string): string | null {
  if (senha.length < TAMANHO_MINIMO_SENHA) return `A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/[^A-Za-zÀ-ÿ]/.test(senha)) {
    return 'A senha deve combinar letras com números ou símbolos.';
  }
  return null;
}

/** Senha temporária forte (para `criar-admin`). */
export function gerarSenhaTemporaria(): string {
  const base = randomBytes(15).toString('base64url');
  return `${base.slice(0, 10)}-${base.slice(10)}#9`;
}
