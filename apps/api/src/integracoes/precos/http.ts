/**
 * Acesso HTTP das fontes de preços e índices (ARQUITETURA §6): só o servidor chama as APIs oficiais, com tempo
 * máximo por requisição, novas tentativas com espera exponencial em 429/5xx e erro claro para o usuário.
 */
import type { Centavos } from '@agora/dominio';
import type { FuncaoFetch } from '../../http/contexto.ts';
import { ErroIntegracao } from '../conector.ts';

export interface OpcoesHttpPrecos {
  timeoutMs: number;
  /** Novas tentativas após a primeira falha retentável. */
  novasTentativas: number;
  /** Espera inicial da retentativa; dobra a cada tentativa. */
  esperaBaseMs: number;
  esperar: (ms: number) => Promise<void>;
}

export function opcoesHttpPadrao(timeoutMs: number, esperar?: (ms: number) => Promise<void>): OpcoesHttpPrecos {
  return {
    timeoutMs,
    novasTentativas: 2,
    esperaBaseMs: 1_000,
    esperar: esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))),
  };
}

class RespostaRetentavel extends Error {
  constructor(fonte: string, status: number) {
    super(`${fonte} respondeu ${status}`);
    this.name = 'RespostaRetentavel';
  }
}

/** GET com retentativa. 204 ou corpo vazio → ''. Outros 4xx → ErroIntegracao sem nova tentativa. */
export async function obterTexto(
  fetch: FuncaoFetch,
  url: string,
  fonte: string,
  opcoes: OpcoesHttpPrecos,
  cabecalhos: Record<string, string> = {},
): Promise<string> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa <= opcoes.novasTentativas; tentativa++) {
    if (tentativa > 0) await opcoes.esperar(opcoes.esperaBaseMs * 2 ** (tentativa - 1));
    try {
      const resposta = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Agora/1.0 (pesquisa de precos)', ...cabecalhos },
        signal: AbortSignal.timeout(opcoes.timeoutMs),
      });
      if (resposta.status === 429 || resposta.status >= 500) throw new RespostaRetentavel(fonte, resposta.status);
      if (resposta.status === 204) return '';
      if (resposta.status === 401 || resposta.status === 403) throw new ErroIntegracao(`${fonte} recusou o acesso (HTTP ${resposta.status}): confira a chave de acesso.`);
      if (!resposta.ok) throw new ErroIntegracao(`${fonte} recusou a consulta (HTTP ${resposta.status}).`);
      return await resposta.text();
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimoErro = erro;
    }
  }
  const motivo =
    ultimoErro instanceof Error && (ultimoErro.name === 'TimeoutError' || ultimoErro.name === 'AbortError')
      ? `tempo limite de ${opcoes.timeoutMs} ms excedido`
      : ultimoErro instanceof Error
        ? ultimoErro.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`${fonte} indisponível após ${opcoes.novasTentativas + 1} tentativas: ${motivo}.`, { cause: ultimoErro });
}

export function lerJson(texto: string, fonte: string): unknown {
  if (texto.trim() === '') return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch (erro) {
    throw new ErroIntegracao(`Resposta de ${fonte} não é JSON válido.`, { cause: erro });
  }
}

/**
 * Valor em reais vindo de uma API → centavos. Aceita número (1234.56) ou texto ("1234.56", "1.234,56").
 * Devolve null para valores ausentes, negativos ou ilegíveis.
 */
export function reaisParaCentavos(valor: unknown): Centavos | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : null;
  if (typeof valor !== 'string') return null;
  const s = valor.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const normalizado = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? Math.round(numero * 100) : null;
}

/** Data de API ("2026-10-05", "2026-10-05T10:00:00", "05/10/2026") → AAAA-MM-DD, ou null. */
export function dataDaApi(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(valor.trim());
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}
