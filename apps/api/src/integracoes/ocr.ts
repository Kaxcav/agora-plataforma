/**
 * Cliente do serviço de OCR auto-hospedado (apps/ocr), chamado só pelo servidor da Ágora (RIA-08).
 * O serviço recebe o PDF digitalizado ou a imagem, converte as páginas em imagem e aplica o Tesseract em português,
 * devolvendo o texto por página e linha com a confiança média. Timeout por chamada e uma nova tentativa em falha
 * de rede ou 5xx; a resposta é validada e o hash do texto entra na proveniência da leitura.
 */
import { z } from 'zod';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';

export interface PaginaOcr {
  numero: number;
  linhas: string[];
}

export interface ResultadoOcr {
  paginas: PaginaOcr[];
  /** Confiança média de 0 a 100. */
  confianca: number | null;
  motor: string;
}

const esquemaResposta = z.object({
  paginas: z
    .array(
      z.object({
        numero: z.number().int().min(1).max(10_000),
        linhas: z.array(z.object({ texto: z.string().max(5000), confianca: z.number().min(-1).max(100).nullable().optional() })).max(5000),
      }),
    )
    .max(500),
  motor: z.string().max(200),
  confianca: z.number().min(-1).max(100).nullable().optional(),
});

const TIPOS: Record<'pdf' | 'png' | 'jpeg', string> = { pdf: 'application/pdf', png: 'image/png', jpeg: 'image/jpeg' };

export interface OpcoesOcr {
  url: string;
  timeoutMs: number;
  novasTentativas?: number;
  esperar?: (ms: number) => Promise<void>;
}

class FalhaRetentavel extends Error {}

/** Envia o arquivo ao serviço de OCR (`POST {url}/v1/ocr`) e devolve as páginas lidas. */
export async function reconhecerTexto(fetch: FuncaoFetch, opcoes: OpcoesOcr, conteudo: Buffer, formato: 'pdf' | 'png' | 'jpeg'): Promise<ResultadoOcr> {
  const tentativas = (opcoes.novasTentativas ?? 1) + 1;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    if (tentativa > 0) await esperar(1000 * tentativa);
    try {
      const resposta = await fetch(`${opcoes.url}/v1/ocr`, {
        method: 'POST',
        headers: { 'content-type': TIPOS[formato], accept: 'application/json', 'x-agora-idioma': 'por' },
        body: new Uint8Array(conteudo),
        signal: AbortSignal.timeout(opcoes.timeoutMs),
      });
      if (resposta.status >= 500 || resposta.status === 429) throw new FalhaRetentavel(`HTTP ${resposta.status}`);
      if (!resposta.ok) throw new ErroIntegracao(`O serviço de OCR recusou o arquivo (HTTP ${resposta.status}).`);
      const corpo = esquemaResposta.safeParse(await resposta.json());
      if (!corpo.success) throw new ErroIntegracao('Resposta do serviço de OCR fora do formato esperado.');
      const notas = corpo.data.paginas.flatMap((p) => p.linhas.map((l) => l.confianca ?? null)).filter((c): c is number => c !== null && c >= 0);
      const confianca = corpo.data.confianca ?? (notas.length > 0 ? notas.reduce((a, b) => a + b, 0) / notas.length : null);
      return {
        paginas: corpo.data.paginas.map((p) => ({ numero: p.numero, linhas: p.linhas.map((l) => l.texto.replace(/\s+/g, ' ').trim()).filter((t) => t !== '') })),
        confianca: confianca === null || confianca < 0 ? null : Math.round(confianca * 100) / 100,
        motor: corpo.data.motor,
      };
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimo = erro;
    }
  }
  const motivo =
    ultimo instanceof Error && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError')
      ? `tempo limite de ${Math.round(opcoes.timeoutMs / 1000)} s excedido`
      : ultimo instanceof Error
        ? ultimo.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`Serviço de OCR indisponível após ${tentativas} tentativa(s): ${motivo}.`, { cause: ultimo });
}
