/**
 * Termos para a busca na base normativa e para a conferência de assunto das citações (RNF-08, RIA-14).
 *
 * Normalização determinística, sem serviço externo nem modelo de linguagem: minúsculas sem acento, descarte de
 * palavras vazias e de números, plural regular reduzido ao singular e truncamento do radical em 7 letras
 * ("dispensa", "dispensável" e "dispensada" viram "dispens").
 */

/** Palavras sem conteúdo, ignoradas na busca e na conferência. */
const PALAVRAS_VAZIAS: ReadonlySet<string> = new Set([
  'a', 'o', 'as', 'os', 'ao', 'aos', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas',
  'para', 'por', 'pela', 'pelo', 'pelas', 'pelos', 'com', 'sem', 'que', 'se', 'ou', 'como', 'mais', 'menos', 'seu', 'sua', 'seus',
  'suas', 'este', 'esta', 'estes', 'estas', 'isto', 'esse', 'essa', 'esses', 'essas', 'isso', 'aquele', 'aquela', 'quando', 'qual',
  'quais', 'ser', 'sera', 'serao', 'sao', 'foi', 'era', 'ter', 'tem', 'tera', 'sobre', 'entre', 'ate', 'apos', 'desde', 'nao', 'sim',
  'cada', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'outros', 'outras', 'mesmo', 'mesma', 'deste', 'desta', 'destes',
  'destas', 'neste', 'nesta', 'nestes', 'nestas', 'dele', 'dela', 'deles', 'delas', 'lhe', 'lhes', 'ja', 'tambem', 'assim', 'pois',
  'onde', 'nem', 'muito', 'pode', 'podera', 'poderao', 'deve', 'devera', 'deverao', 'sido', 'sendo', 'seja', 'sejam', 'caso', 'dois',
  'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'vinte', 'trinta', 'cem', 'mil', 'cento',
]);

/**
 * Palavras de remissão ("nos termos do art. ...") que nada dizem sobre o assunto do trecho: ignoradas só na
 * conferência de assunto, porque na busca "artigo de luxo" é conteúdo.
 */
const PALAVRAS_REMISSIVAS: ReadonlySet<string> = new Set([
  'lei', 'leis', 'art', 'arts', 'artigo', 'artigos', 'inciso', 'incisos', 'alinea', 'alineas', 'paragrafo', 'paragrafos', 'caput',
  'unico', 'conforme', 'disposto', 'disposta', 'previsto', 'prevista', 'previstos', 'previstas', 'termos', 'termo', 'forma', 'presente',
  'observado', 'observada', 'observados', 'observadas', 'federal', 'decreto', 'complementar', 'normativa', 'instrucao', 'seges',
  'codigo', 'constituicao', 'redacao', 'dada', 'vide', 'rascunho', 'documento', 'fundamento', 'nos', 'acordo',
]);

/** Minúsculas e sem acento (comparação de termos). */
export function normalizarTextoNormativo(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Radical simples de uma palavra já normalizada: plural regular → singular e truncamento em 7 letras. */
export function radicalNormativo(palavra: string): string {
  let p = palavra;
  if (p.length > 4) {
    if (p.endsWith('oes') || p.endsWith('aes')) p = `${p.slice(0, -3)}ao`;
    else if (p.endsWith('ais')) p = `${p.slice(0, -3)}al`;
    else if (p.endsWith('eis')) p = `${p.slice(0, -3)}el`;
    else if (p.endsWith('ns')) p = `${p.slice(0, -2)}m`;
    else if (p.endsWith('res') || p.endsWith('zes') || p.endsWith('ses')) p = p.slice(0, -2);
    else if (p.endsWith('s')) p = p.slice(0, -1);
  }
  return p.length > 7 ? p.slice(0, 7) : p;
}

/** Termos (radicais) de um texto, na ordem, sem palavras vazias nem números. */
export function termosNormativos(texto: string, opcoes: { ignorarRemissivas?: boolean } = {}): string[] {
  const palavras = normalizarTextoNormativo(texto).match(/[a-z0-9]+/g) ?? [];
  const termos: string[] = [];
  for (const palavra of palavras) {
    if (palavra.length < 3 || /^\d/.test(palavra) || PALAVRAS_VAZIAS.has(palavra)) continue;
    if (opcoes.ignorarRemissivas && PALAVRAS_REMISSIVAS.has(palavra)) continue;
    termos.push(radicalNormativo(palavra));
  }
  return termos;
}
