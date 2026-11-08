/**
 * Busca de recuperação na base normativa (RNF-08): BM25F com três campos ponderados (divisões, caput e demais
 * dispositivos), determinística e local. Serve à consulta da lei na interface, à ancoragem dos rascunhos (RAG) e à
 * conferência de assunto das citações (RIA-14). Não usa serviço externo nem embeddings de terceiros.
 */
import { ErroDominio } from '../erros.ts';
import {
  type ArtigoLei,
  type BaseNormativa,
  type IncisoLei,
  formatarReferenciaDispositivo,
  mapaArtigos,
  rotuloArtigo,
  rotuloParagrafo,
} from './base-normativa.ts';
import { termosNormativos } from './termos.ts';

/** Parâmetros do BM25F: saturação do termo, peso e normalização de tamanho de cada campo. */
const K1 = 1.2;
const CAMPOS = [
  { peso: 4, b: 0.3 }, // divisões do artigo (título, capítulo, seção, subseção)
  { peso: 2, b: 0.75 }, // caput
  { peso: 1, b: 0.75 }, // incisos, alíneas e parágrafos
] as const;
/** Termo presente em mais desta fração dos artigos não serve para conferir assunto (ex.: "contratação"). */
const FRACAO_TERMO_FREQUENTE = 0.3;

interface DocumentoIndice {
  numero: string;
  /** Frequência de cada termo, por campo (mesma ordem de CAMPOS). */
  frequencias: Map<string, number>[];
  tamanhos: number[];
}

export interface IndiceNormativo {
  base: BaseNormativa;
  artigos: Map<string, ArtigoLei>;
  documentos: DocumentoIndice[];
  frequenciaDocumentos: Map<string, number>;
  tamanhosMedios: number[];
  /** Termos frequentes demais para conferir o assunto de um trecho. */
  frequentes: Set<string>;
}

/** Trecho da lei com a sua referência ("art. 75, II"). */
export interface TrechoNormativo {
  referencia: string;
  texto: string;
}

export interface ResultadoBuscaNormativa {
  artigo: string;
  rotulo: string;
  /** Divisão mais específica do artigo (ex.: "Seção III — Da Dispensa de Licitação"). */
  divisao: string | null;
  pontuacao: number;
  /** O artigo foi pedido pelo número (ex.: "art. 75"). */
  exato: boolean;
  trechos: TrechoNormativo[];
}

function frequencias(termos: readonly string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const t of termos) mapa.set(t, (mapa.get(t) ?? 0) + 1);
  return mapa;
}

function textoDispositivos(artigo: ArtigoLei): string {
  const partes: string[] = [];
  const incisos = (lista: readonly IncisoLei[]) => {
    for (const i of lista) {
      partes.push(i.texto);
      for (const a of i.alineas) partes.push(a.texto);
    }
  };
  incisos(artigo.incisos);
  for (const p of artigo.paragrafos) {
    partes.push(p.texto);
    incisos(p.incisos);
  }
  return partes.join(' ');
}

/** Índice BM25F da base: um documento por artigo, com os campos divisões, caput e demais dispositivos. */
export function indexarBaseNormativa(base: BaseNormativa): IndiceNormativo {
  if (base.artigos.length === 0) throw new ErroDominio('BASE_NORMATIVA_VAZIA', 'A base normativa não tem artigos.');
  const documentos: DocumentoIndice[] = [];
  const frequenciaDocumentos = new Map<string, number>();
  for (const artigo of base.artigos) {
    const campos = [termosNormativos(artigo.titulos.join(' ')), termosNormativos(artigo.caput), termosNormativos(textoDispositivos(artigo))];
    documentos.push({ numero: artigo.numero, frequencias: campos.map(frequencias), tamanhos: campos.map((c) => c.length) });
    for (const termo of new Set(campos.flat())) frequenciaDocumentos.set(termo, (frequenciaDocumentos.get(termo) ?? 0) + 1);
  }
  const tamanhosMedios = CAMPOS.map((_, i) => Math.max(1, documentos.reduce((s, d) => s + (d.tamanhos[i] ?? 0), 0) / documentos.length));
  const limite = documentos.length * FRACAO_TERMO_FREQUENTE;
  const frequentes = new Set([...frequenciaDocumentos].filter(([, n]) => n > limite).map(([t]) => t));
  return { base, artigos: mapaArtigos(base), documentos, frequenciaDocumentos, tamanhosMedios, frequentes };
}

/** Pontuação BM25F de cada artigo para os termos da consulta, em ordem decrescente (empate: ordem da lei). */
export function pontuarArtigos(indice: IndiceNormativo, termos: readonly string[]): { artigo: string; pontuacao: number }[] {
  const unicos = [...new Set(termos)];
  const n = indice.documentos.length;
  const resultado: { artigo: string; pontuacao: number; ordem: number }[] = [];
  indice.documentos.forEach((doc, ordem) => {
    let pontuacao = 0;
    for (const termo of unicos) {
      let tf = 0;
      CAMPOS.forEach((campo, i) => {
        const bruto = doc.frequencias[i]?.get(termo) ?? 0;
        if (bruto > 0) tf += (campo.peso * bruto) / (1 - campo.b + (campo.b * (doc.tamanhos[i] ?? 0)) / (indice.tamanhosMedios[i] ?? 1));
      });
      if (tf === 0) continue;
      const df = indice.frequenciaDocumentos.get(termo) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      pontuacao += (idf * tf) / (K1 + tf);
    }
    if (pontuacao > 0) resultado.push({ artigo: doc.numero, pontuacao, ordem });
  });
  resultado.sort((a, b) => b.pontuacao - a.pontuacao || a.ordem - b.ordem);
  return resultado.map(({ artigo, pontuacao }) => ({ artigo, pontuacao: Math.round(pontuacao * 1000) / 1000 }));
}

/** Dispositivos do artigo com o texto, na ordem da lei. */
export function dispositivosDoArtigo(artigo: ArtigoLei): TrechoNormativo[] {
  const trechos: TrechoNormativo[] = [{ referencia: `${rotuloArtigo(artigo.numero)}, caput`, texto: artigo.caput }];
  const incisos = (lista: readonly IncisoLei[], paragrafo: string | null) => {
    for (const i of lista) {
      trechos.push({ referencia: formatarReferenciaDispositivo({ artigo: artigo.numero, paragrafo, inciso: i.numero, alinea: null }), texto: i.texto });
      for (const a of i.alineas) {
        trechos.push({ referencia: formatarReferenciaDispositivo({ artigo: artigo.numero, paragrafo, inciso: i.numero, alinea: a.letra }), texto: a.texto });
      }
    }
  };
  incisos(artigo.incisos, null);
  for (const p of artigo.paragrafos) {
    trechos.push({ referencia: `${rotuloArtigo(artigo.numero)}, ${rotuloParagrafo(p.numero)}`, texto: p.texto });
    incisos(p.incisos, p.numero);
  }
  return trechos;
}

function resumir(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`;
}

/** Os dispositivos do artigo que mais contêm os termos da consulta (o caput, se nenhum contiver). */
export function trechosRelevantes(artigo: ArtigoLei, termos: readonly string[], limite = 2, tamanho = 320): TrechoNormativo[] {
  const procurados = new Set(termos);
  const pontuados = dispositivosDoArtigo(artigo)
    .map((t, ordem) => ({ t, ordem, acertos: new Set(termosNormativos(t.texto).filter((x) => procurados.has(x))).size }))
    .filter((p) => p.acertos > 0)
    .sort((a, b) => b.acertos - a.acertos || a.ordem - b.ordem)
    .slice(0, limite)
    .sort((a, b) => a.ordem - b.ordem);
  const escolhidos = pontuados.length > 0 ? pontuados.map((p) => p.t) : dispositivosDoArtigo(artigo).slice(0, 1);
  return escolhidos.map((t) => ({ referencia: t.referencia, texto: resumir(t.texto, tamanho) }));
}

const PADRAO_ARTIGO_PEDIDO = /^art(?:igo)?s?\.?\s*(\d{1,3})(?:\s*[º°o])?(?:-([a-z]))?(?![\d])/i;
const PADRAO_SO_NUMERO = /^(\d{1,3})(?:\s*[º°o])?(?:-([a-z]))?$/i;

/** Número de artigo pedido na consulta ("art. 75", "artigo 44-A" ou só "75"), se houver. */
export function artigoDaConsulta(consulta: string): string | null {
  const texto = consulta.trim();
  const m = PADRAO_ARTIGO_PEDIDO.exec(texto) ?? PADRAO_SO_NUMERO.exec(texto);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2].toUpperCase()}` : (m[1] ?? null);
}

/**
 * Busca na base: o artigo pedido pelo número vem primeiro; depois, os artigos por relevância BM25F (termos da lei,
 * das divisões e do caput), com os trechos que contêm os termos procurados.
 */
export function buscarNaBaseNormativa(indice: IndiceNormativo, consulta: string, limite = 10): ResultadoBuscaNormativa[] {
  const texto = consulta.trim();
  if (texto.length === 0) throw new ErroDominio('CONSULTA_VAZIA', 'Informe o que procurar na lei.');
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw new ErroDominio('LIMITE_INVALIDO', 'O limite deve ser de 1 a 50 resultados.');
  const resultados: ResultadoBuscaNormativa[] = [];
  const divisao = (a: ArtigoLei) => a.titulos.at(-1) ?? null;
  const pedido = artigoDaConsulta(texto);
  const exato = pedido !== null ? indice.artigos.get(pedido) : undefined;
  // O número do artigo pedido não entra na busca por relevância: só o que vier depois dele ("art. 75 emergência").
  const termos = termosNormativos(exato ? texto.replace(PADRAO_ARTIGO_PEDIDO, '').replace(PADRAO_SO_NUMERO, '') : texto);
  if (exato) {
    resultados.push({ artigo: exato.numero, rotulo: rotuloArtigo(exato.numero), divisao: divisao(exato), pontuacao: 0, exato: true, trechos: trechosRelevantes(exato, termos) });
  }
  for (const { artigo: numero, pontuacao } of pontuarArtigos(indice, termos)) {
    if (resultados.length >= limite) break;
    if (numero === exato?.numero) continue;
    const artigo = indice.artigos.get(numero);
    if (!artigo) continue;
    resultados.push({ artigo: numero, rotulo: rotuloArtigo(numero), divisao: divisao(artigo), pontuacao, exato: false, trechos: trechosRelevantes(artigo, termos) });
  }
  return resultados;
}
