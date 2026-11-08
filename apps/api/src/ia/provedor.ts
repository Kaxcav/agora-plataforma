import { z } from 'zod';
import type { Config } from '../config.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

/** Prazo de resposta do endpoint de IA (ARQUITETURA §7). */
export const TIMEOUT_IA_MS = 60_000;

/** Nome registrado quando o texto vem do modelo determinístico (provedor `nenhum`). */
export const MODELO_DETERMINISTICO = 'modelo-deterministico';

export interface RespostaIa {
  texto: string;
  modelo: string;
}

/** Contexto enviado junto com o prompt: o modelo de texto que serve de base e os dados de onde ele saiu. */
export interface ContextoIa {
  /** Texto do modelo determinístico (base da redação). */
  modeloBase: string;
  /** Finalidade do texto, para registro ("Termo de Referência"). */
  finalidade: string;
  /** Fontes normativas citadas pelo modelo. */
  fontes: readonly string[];
}

/**
 * Provedor de IA (ARQUITETURA §7). `nenhum` devolve o modelo de texto determinístico; `openai_compativel`
 * chama um endpoint auto-hospedado (vLLM, Ollama etc.) no formato de chat completions.
 * A IA só redige rascunhos: nunca decide sanção, habilitação, fraude ou multa.
 */
export interface ProvedorIa {
  readonly tipo: Config['ia']['provedor'];
  gerar(prompt: string, contexto: ContextoIa): Promise<RespostaIa>;
}

export class ErroIa extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroIa';
  }
}

/** Instruções fixas do sistema: limites de atuação da IA na Ágora (CLAUDE.md, regra 5). */
export const INSTRUCOES_SISTEMA_IA = [
  'Você é um assistente de redação de documentos de contratações públicas da Administração Pública federal brasileira, regidas pela Lei 14.133/2021.',
  'Escreva em português do Brasil, em linguagem administrativa formal, clara e objetiva.',
  'Use somente os dados do processo e o rascunho fornecidos: não invente fatos, valores, datas, normas, números de processo nem jurisprudência.',
  'Mantenha a estrutura de seções, as tabelas, os valores, as datas e as referências legais do rascunho.',
  'Não altere, não preencha e não remova os trechos delimitados por <!-- protegido:... --> e <!-- /protegido:... -->: eles tratam de conclusões jurídicas, sanções e habilitação, que são decisão humana.',
  'Responda apenas com o corpo do documento em Markdown, sem comentários antes ou depois.',
].join('\n');

const esquemaResposta = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
});

function provedorNenhum(): ProvedorIa {
  return {
    tipo: 'nenhum',
    async gerar(_prompt, contexto) {
      return { texto: contexto.modeloBase, modelo: MODELO_DETERMINISTICO };
    },
  };
}

function provedorOpenAiCompativel(config: Config['ia'], fetch: FuncaoFetch, timeoutMs: number): ProvedorIa {
  const base = (config.url ?? '').replace(/\/+$/, '');
  if (base === '') throw new ErroIa('AGORA_IA_URL é obrigatória com AGORA_IA_PROVEDOR=openai_compativel.');
  const endereco = `${base}/v1/chat/completions`;
  return {
    tipo: 'openai_compativel',
    async gerar(prompt) {
      const resposta = await fetch(endereco, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(config.chave ? { authorization: `Bearer ${config.chave}` } : {}),
        },
        body: JSON.stringify({
          ...(config.modelo ? { model: config.modelo } : {}),
          temperature: 0.2,
          messages: [
            { role: 'system', content: INSTRUCOES_SISTEMA_IA },
            { role: 'user', content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resposta.ok) throw new ErroIa(`O provedor de IA respondeu com HTTP ${resposta.status}.`);
      const corpo = esquemaResposta.safeParse(await resposta.json());
      if (!corpo.success) throw new ErroIa('A resposta do provedor de IA não está no formato de chat completions.');
      const texto = corpo.data.choices[0]?.message.content.trim() ?? '';
      if (texto.length === 0) throw new ErroIa('O provedor de IA devolveu um texto vazio.');
      return { texto, modelo: corpo.data.model ?? config.modelo ?? 'nao-informado' };
    },
  };
}

/** Cria o provedor conforme `AGORA_IA_PROVEDOR`. `timeoutMs` só é reduzido em testes. */
export function criarProvedorIa(config: Config['ia'], fetch: FuncaoFetch, opcoes: { timeoutMs?: number } = {}): ProvedorIa {
  if (config.provedor === 'nenhum') return provedorNenhum();
  return provedorOpenAiCompativel(config, fetch, opcoes.timeoutMs ?? TIMEOUT_IA_MS);
}

const PADRAO_PROTEGIDO = /<!-- protegido:([a-z_]+) -->[\s\S]*?<!-- \/protegido:\1 -->/g;

/** Trechos protegidos do modelo (conclusões jurídicas, sanções, habilitação), por nome. */
export function trechosProtegidos(texto: string): Map<string, string> {
  const trechos = new Map<string, string>();
  for (const encontrado of texto.matchAll(PADRAO_PROTEGIDO)) {
    const nome = encontrado[1];
    if (nome !== undefined) trechos.set(nome, encontrado[0]);
  }
  return trechos;
}

/**
 * Restaura no texto da IA os trechos protegidos do modelo determinístico. Se a IA omitir algum deles,
 * a resposta é recusada (a geração volta ao modelo de texto).
 */
export function restaurarTrechosProtegidos(textoIa: string, modeloBase: string): string {
  const doModelo = trechosProtegidos(modeloBase);
  const daIa = trechosProtegidos(textoIa);
  for (const nome of doModelo.keys()) {
    if (!daIa.has(nome)) throw new ErroIa(`A resposta da IA omitiu a seção protegida "${nome}".`);
  }
  // Trecho "protegido" que não existe no modelo é descartado: só o modelo determinístico redige essas seções.
  return textoIa.replace(PADRAO_PROTEGIDO, (_trecho: string, nome: string) => doModelo.get(nome) ?? '');
}
