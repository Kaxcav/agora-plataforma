import {
  buscarNaBaseNormativa,
  extrairCitacoesLegais,
  formatarReferenciaDispositivo,
  localizarDispositivo,
  roteiroModeloPadronizado,
  rotuloArtigo,
} from '@agora/dominio';
import { indiceNormativo } from './base-normativa.ts';

/** Limites do bloco de ancoragem enviado ao modelo de linguagem auto-hospedado. */
const MAXIMO_DISPOSITIVOS = 40;
const MAXIMO_CARACTERES = 12_000;
const ARTIGOS_RECUPERADOS = 3;

function resumir(texto: string, limite = 400): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`;
}

/**
 * Ancoragem da redação por IA (RAG, RIA-14): acrescenta ao prompt o texto dos dispositivos da Lei 14.133/2021 que o
 * modelo de texto cita, os artigos recuperados pela busca BM25 para o objeto e a estrutura obrigatória do modelo
 * padronizado do documento. Tudo vem da base normativa local; o prompt vai só ao provedor auto-hospedado do órgão.
 */
export function ancorarPromptIa(prompt: string, contexto: { tipo: string; corpo: string; fontes: readonly string[]; objeto: string }): string {
  const indice = indiceNormativo();
  const { proveniencia } = indice.base;
  const linhas: string[] = [];
  const vistos = new Set<string>();
  let tamanho = 0;
  const incluir = (referencia: string, texto: string) => {
    if (vistos.has(referencia) || vistos.size >= MAXIMO_DISPOSITIVOS || tamanho > MAXIMO_CARACTERES) return;
    vistos.add(referencia);
    const linha = `- ${referencia} — ${resumir(texto)}`;
    tamanho += linha.length;
    linhas.push(linha);
  };
  const citadas = extrairCitacoesLegais([contexto.corpo, ...contexto.fontes].join('\n')).filter((c) => c.norma === null);
  for (const citacao of citadas) {
    for (const ref of citacao.dispositivos) {
      const local = localizarDispositivo(indice.artigos, ref);
      if (local.encontrado) incluir(formatarReferenciaDispositivo(ref), local.texto);
    }
  }
  for (const r of buscarNaBaseNormativa(indice, contexto.objeto.trim() || contexto.tipo, ARTIGOS_RECUPERADOS)) {
    const artigo = indice.artigos.get(r.artigo);
    if (artigo) incluir(rotuloArtigo(artigo.numero), artigo.caput);
  }
  const roteiro = roteiroModeloPadronizado(contexto.tipo);
  return [
    prompt,
    '',
    `Base normativa para ancoragem — trechos da ${indice.base.norma.titulo} recuperados da base da Ágora (${proveniencia.fonte}, obtida em ${proveniencia.obtidoEm.slice(0, 10)}, SHA-256 do texto ${proveniencia.sha256Texto.slice(0, 16)}):`,
    ...linhas,
    ...(roteiro.length > 0 ? ['', 'Seções obrigatórias do documento (modelo padronizado, art. 19, IV):', ...roteiro.map((s) => `- ${s}`)] : []),
    '',
    'Regras de citação: cite apenas dispositivos que aparecem nos trechos acima ou no rascunho; não crie artigos, parágrafos, incisos nem alíneas. Toda citação do texto será conferida automaticamente com a base normativa, e o rascunho com citação inexistente não é aprovado sem revisão humana.',
  ].join('\n');
}
