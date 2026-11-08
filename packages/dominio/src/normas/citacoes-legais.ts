/**
 * Conferência de citações legais (RIA-14; IMR-02 "precisão normativa").
 *
 * Encontra as referências à lei num texto ("art. 75, § 3º", "inciso II do art. 6º", "arts. 62 a 70"), confere na
 * base normativa se cada dispositivo existe e está em vigor e se o assunto do trecho corresponde ao dispositivo
 * citado, e aponta a citação inexistente, sem efeito ou suspeita com o trecho. Determinístico, sem modelo de
 * linguagem: o resultado é um sinal que requer revisão humana, nunca uma conclusão jurídica.
 */
import {
  type ArtigoLei,
  type IncisoLei,
  type ReferenciaDispositivo,
  dispositivoSemEfeito,
  formatarReferenciaDispositivo,
  localizarDispositivo,
  numeroParaRomano,
  romanoParaNumero,
  rotuloArtigo,
} from './base-normativa.ts';
import { type IndiceNormativo, pontuarArtigos } from './busca-normativa.ts';
import { termosNormativos } from './termos.ts';

/** Norma das citações sem indicação expressa (os documentos da Ágora seguem a Lei 14.133/2021). */
export const NORMA_PADRAO_CITACOES = 'Lei 14.133/2021';

/** Mínimo de termos de conteúdo no trecho para conferir o assunto da citação. */
export const MINIMO_TERMOS_ASSUNTO = 4;
/** Termos em comum exigidos do artigo sugerido quando a citação não tem nenhum termo em comum com o trecho. */
const MINIMO_TERMOS_SUGESTAO = 2;
/** Distância máxima (caracteres) para herdar a norma da citação anterior na mesma frase. */
const DISTANCIA_HERANCA_NORMA = 120;
/** Limite de dispositivos expandidos de uma faixa ("incisos I a XIII"). */
const MAXIMO_FAIXA = 60;

export type SituacaoCitacao = 'confere' | 'inexistente' | 'sem_efeito' | 'suspeita' | 'outra_norma';

/** Citação encontrada no texto, antes da conferência. `norma` nula = Lei 14.133/2021. */
export interface CitacaoLegal {
  trecho: string;
  inicio: number;
  fim: number;
  norma: string | null;
  dispositivos: ReferenciaDispositivo[];
}

export interface CitacaoConferida {
  trecho: string;
  /** Dispositivos citados, por extenso ("art. 75, § 3º"). */
  referencias: string[];
  norma: string;
  situacao: SituacaoCitacao;
  motivo: string;
  sugestao: string | null;
  /** Frase em que a citação aparece. */
  contexto: string;
  /** Posição da citação no texto (caractere). */
  posicao: number;
}

export interface ConferenciaCitacoes {
  norma: string;
  total: number;
  conferem: number;
  inexistentes: number;
  semEfeito: number;
  suspeitas: number;
  outrasNormas: number;
  /** Inexistentes + sem efeito: impedem a aprovação sem revisão humana registrada. */
  bloqueantes: number;
  /** Bloqueantes + suspeitas. */
  problemas: number;
  /** Nenhuma citação inexistente, sem efeito ou suspeita (IMR-02). */
  fiel: boolean;
  citacoes: CitacaoConferida[];
  premissas: string[];
  aviso: string;
}

export const AVISO_CONFERENCIA_CITACOES =
  'Conferência automática das citações com a base normativa da Ágora: é um sinal para revisão, não uma conclusão jurídica — requer revisão humana.';

// ───────────────────────── leitura do texto ─────────────────────────

interface Cursor {
  texto: string;
  pos: number;
}

function casar(c: Cursor, padrao: RegExp): RegExpExecArray | null {
  padrao.lastIndex = c.pos;
  const m = padrao.exec(c.texto);
  if (m) c.pos = padrao.lastIndex;
  return m;
}

const NAO_LETRA = '(?![A-Za-zÀ-ÿ0-9])';
const R_NUMERO_ARTIGO = new RegExp(`(\\d{1,3}(?:\\.\\d{3})?)(?:\\s*[º°o]${NAO_LETRA})?(?:-([A-Z])${NAO_LETRA})?`, 'y');
const R_SEPARADOR_NUMERO = /(\s*,\s*|\s+e\s+|\s+a\s+)(?=\d)/y;
const R_SEPARADOR_COMPONENTE = /(\s*,\s*e\s+|\s*,\s*|\s+e\s+|\s+)/y;
const R_CAPUT = /caput(?![A-Za-zÀ-ÿ])/y;
const R_PARAGRAFOS = /§§?\s*/y;
const R_NUMERO_PARAGRAFO = new RegExp(`(\\d{1,2})(?:\\s*[º°o]${NAO_LETRA})?`, 'y');
const R_PARAGRAFO_UNICO = /[Pp]ar[aá]grafo\s+[uú]nico/y;
const R_PALAVRA_INCISOS = /[Ii]ncisos?\s+/y;
const R_ROMANO = new RegExp(`([IVXLC]+)${NAO_LETRA}`, 'y');
const R_SEPARADOR_ROMANO = new RegExp(`(\\s*,\\s*|\\s+e\\s+|\\s+a\\s+)(?=[IVXLC]+${NAO_LETRA})`, 'y');
const R_PALAVRA_ALINEAS = /[Aa]l[ií]neas?\s+/y;
const R_LETRA_ASPAS = /"([a-z])"/y;
const R_LETRA = new RegExp(`"?([a-z])"?${NAO_LETRA}`, 'y');
const R_SEPARADOR_LETRA = new RegExp(`(\\s*,\\s*|\\s+e\\s+|\\s+a\\s+)(?="?[a-z]"?${NAO_LETRA})`, 'y');
const R_SEPARADOR_LETRA_ASPAS = /(\s*,\s*|\s+e\s+|\s+a\s+)(?="[a-z]")/y;

const NORMA =
  '(?:(Lei\\s+Complementar|LC|Lei|Decreto-Lei|Decreto|Medida\\s+Provis[óo]ria|Instru[çc][ãa]o\\s+Normativa|IN|Portaria|Resolu[çc][ãa]o)' +
  '(?:\\s+(?:SEGES|SEGES\\/ME|SEGES\\/MGI|SLTI\\/MP|[A-Z]{2,}(?:\\/[A-Z]{2,})?))?\\s*(?:n[º°o.]*\\s*)?(\\d{1,3}(?:\\.\\d{3})*)' +
  '(?:\\s*\\/\\s*(\\d{2,4})|,\\s*de\\s+\\d{1,2}º?\\s+de\\s+[a-zç]+\\s+de\\s+(\\d{4}))?' +
  '|Constitui[çc][ãa]o(?:\\s+Federal)?|CF(?:\\/88)?(?![A-Za-z])|LGPD(?![A-Za-z])|CLT(?![A-Za-z])' +
  '|C[óo]digo\\s+(?:Civil|Penal|de\\s+Processo\\s+Civil|de\\s+Defesa\\s+do\\s+Consumidor|Tribut[áa]rio\\s+Nacional))';
const R_NORMA_SUFIXO = new RegExp(`\\s*,?\\s*(?:d[aeo]s?|n[ao]s?)\\s+(${NORMA})`, 'y');
const R_DESTA_LEI = /\s*,?\s*(?:desta|da\s+presente)\s+Lei(?![A-Za-z])/y;
const R_NORMA_PREFIXO = new RegExp(`(${NORMA})\\s*(?:\\([^()]{1,40}\\))?\\s*,\\s*$`);
const R_ANCORA = /(?<![A-Za-zÀ-ÿ])(arts?\.|[Aa]rtigos?(?![A-Za-zÀ-ÿ]))\s*(?=\d)/g;
const R_REVERSO = new RegExp(
  '(?:[Aa]l[ií]neas?\\s+("?[a-z]"?(?:(?:\\s*,\\s*|\\s+e\\s+|\\s+a\\s+)"?[a-z]"?)*)\\s+d[oa]\\s+)?' +
    '(?:[Ii]ncisos?\\s+([IVXLC]+(?:(?:\\s*,\\s*|\\s+e\\s+|\\s+a\\s+)[IVXLC]+)*)\\s+d[oa]\\s+)?' +
    '(?:(caput|§§?\\s*\\d{1,2}\\s*[º°o]?(?:(?:\\s*,\\s*|\\s+e\\s+|\\s+a\\s+)\\d{1,2}\\s*[º°o]?)*|[Pp]ar[aá]grafo\\s+[uú]nico)\\s+d[oa]\\s+)?$',
);

/** Identifica a norma (grupo 1: nome; 2: espécie; 3: número): `null` para a Lei 14.133/2021; senão, o nome como escrito. */
function normaDe(m: RegExpExecArray): string | null {
  const nome = (m[1] ?? '').replace(/\s+/g, ' ').trim();
  const tipo = (m[2] ?? '').toLowerCase();
  const numero = (m[3] ?? '').replace(/\./g, '');
  if (tipo === 'lei' && numero === '14133') return null;
  return nome;
}

function expandir<T>(inicio: T, fim: T, valor: (x: T) => number | null, deValor: (n: number) => T): T[] {
  const a = valor(inicio);
  const b = valor(fim);
  if (a === null || b === null || b < a || b - a > MAXIMO_FAIXA) return [inicio, fim];
  return Array.from({ length: b - a + 1 }, (_, i) => deValor(a + i));
}

function numeroArtigo(m: RegExpExecArray): string {
  const n = (m[1] ?? '').replace(/\./g, '');
  return m[2] ? `${n}-${m[2]}` : n;
}

/** Lista "24, 40 e 55" ou faixa "62 a 70" a partir do cursor. */
function lerListaNumeros(c: Cursor, item: RegExp, deItem: (m: RegExpExecArray) => string, separador: RegExp): string[] {
  const primeiro = casar(c, item);
  if (!primeiro) return [];
  const lista = [deItem(primeiro)];
  for (;;) {
    const salvo = c.pos;
    const sep = casar(c, separador);
    if (!sep) break;
    const proximo = casar(c, item);
    if (!proximo) {
      c.pos = salvo;
      break;
    }
    const valor = deItem(proximo);
    if ((sep[1] ?? '').trim() === 'a') {
      const anterior = lista.pop() ?? valor;
      const inteiro = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
      lista.push(...expandir(anterior, valor, inteiro, String));
    } else lista.push(valor);
  }
  return lista;
}

/** Incisos em lista ou faixa ("I, IV e VI", "I a XIII"), só com algarismos romanos válidos. */
function lerRomanosComFaixa(c: Cursor): string[] {
  const primeiro = casar(c, R_ROMANO);
  if (!primeiro || romanoParaNumero(primeiro[1] ?? '') === null) return [];
  const lista = [primeiro[1] ?? ''];
  for (;;) {
    const salvo = c.pos;
    const sep = casar(c, R_SEPARADOR_ROMANO);
    if (!sep) break;
    const proximo = casar(c, R_ROMANO);
    if (!proximo || romanoParaNumero(proximo[1] ?? '') === null) {
      c.pos = salvo;
      break;
    }
    const valor = proximo[1] ?? '';
    if ((sep[1] ?? '').trim() === 'a') {
      const anterior = lista.pop() ?? valor;
      lista.push(...expandir(anterior, valor, romanoParaNumero, numeroParaRomano));
    } else lista.push(valor);
  }
  return lista;
}

function lerLetras(c: Cursor, comPalavra: boolean): string[] {
  const item = comPalavra ? R_LETRA : R_LETRA_ASPAS;
  const separador = comPalavra ? R_SEPARADOR_LETRA : R_SEPARADOR_LETRA_ASPAS;
  const primeiro = casar(c, item);
  if (!primeiro) return [];
  const lista = [primeiro[1] ?? ''];
  for (;;) {
    const salvo = c.pos;
    const sep = casar(c, separador);
    if (!sep) break;
    const proximo = casar(c, item);
    if (!proximo) {
      c.pos = salvo;
      break;
    }
    const valor = proximo[1] ?? '';
    if ((sep[1] ?? '').trim() === 'a') {
      const anterior = lista.pop() ?? valor;
      lista.push(...expandir(anterior, valor, (s) => s.charCodeAt(0), (n) => String.fromCharCode(n)));
    } else lista.push(valor);
  }
  return lista;
}

type Nivel = 0 | 1 | 2 | 3;

function nivel(ref: ReferenciaDispositivo): Nivel {
  if (ref.alinea !== null) return 3;
  if (ref.inciso !== null) return 2;
  if (ref.paragrafo !== null) return 1;
  return 0;
}

/** Componentes depois do número do artigo: caput, parágrafos, incisos e alíneas, com refinamento pela vírgula. */
function lerComponentes(c: Cursor, artigo: string, emitidos: ReferenciaDispositivo[]): void {
  let grupoAnterior: ReferenciaDispositivo[] = emitidos.filter((r) => r.artigo === artigo);
  let paragrafoAtual: string | null = null;
  for (;;) {
    const salvo = c.pos;
    const sep = casar(c, R_SEPARADOR_COMPONENTE);
    if (!sep) break;
    const bruto = sep[1] ?? '';
    const tipoSep = /\be\b/.test(bruto) ? 'e' : bruto.includes(',') ? 'virgula' : 'espaco';
    let grupo: ReferenciaDispositivo[] = [];
    if (casar(c, R_CAPUT)) {
      paragrafoAtual = null;
      grupo = [{ artigo, paragrafo: null, inciso: null, alinea: null }];
    } else if (casar(c, R_PARAGRAFOS)) {
      const numeros = lerListaNumeros(c, R_NUMERO_PARAGRAFO, (m) => m[1] ?? '', R_SEPARADOR_NUMERO);
      if (numeros.length === 0) {
        c.pos = salvo;
        break;
      }
      paragrafoAtual = numeros.at(-1) ?? null;
      grupo = numeros.map((p) => ({ artigo, paragrafo: p, inciso: null, alinea: null }));
    } else if (casar(c, R_PARAGRAFO_UNICO)) {
      paragrafoAtual = 'unico';
      grupo = [{ artigo, paragrafo: 'unico', inciso: null, alinea: null }];
    } else {
      const comPalavraInciso = casar(c, R_PALAVRA_INCISOS) !== null;
      const romanos = tipoSep === 'espaco' && !comPalavraInciso ? [] : lerRomanosComFaixa(c);
      if (romanos.length > 0) {
        grupo = romanos.map((r) => ({ artigo, paragrafo: paragrafoAtual, inciso: r, alinea: null }));
      } else {
        const comPalavraAlinea = !comPalavraInciso && casar(c, R_PALAVRA_ALINEAS) !== null;
        const letras = comPalavraInciso || (tipoSep === 'espaco' && !comPalavraAlinea) ? [] : lerLetras(c, comPalavraAlinea);
        const inciso = grupoAnterior.at(-1);
        if (letras.length > 0 && inciso && inciso.inciso !== null) {
          grupo = letras.map((l) => ({ ...inciso, alinea: l }));
        }
      }
    }
    if (grupo.length === 0) {
      c.pos = salvo;
      break;
    }
    const refina = tipoSep !== 'e' && grupoAnterior.length > 0 && nivel(grupo[0] as ReferenciaDispositivo) > nivel(grupoAnterior[0] as ReferenciaDispositivo);
    const caputSobreArtigo = nivel(grupo[0] as ReferenciaDispositivo) === 0 && grupoAnterior.length > 0 && nivel(grupoAnterior[0] as ReferenciaDispositivo) === 0;
    if (refina || caputSobreArtigo) {
      for (const r of grupoAnterior) {
        const i = emitidos.indexOf(r);
        if (i >= 0) emitidos.splice(i, 1);
      }
    }
    emitidos.push(...grupo);
    grupoAnterior = grupo;
  }
}

/** Dispositivos da forma invertida ("inciso II do § 1º do art. 18"). */
function dispositivosReversos(m: RegExpExecArray, artigo: string): ReferenciaDispositivo[] {
  const [, letrasTexto, romanosTexto, nivelTexto] = m;
  let paragrafos: (string | null)[] = [null];
  if (nivelTexto && nivelTexto !== 'caput') {
    if (/^[Pp]ar/.test(nivelTexto)) paragrafos = ['unico'];
    else {
      const c: Cursor = { texto: nivelTexto.replace(/^§§?\s*/, ''), pos: 0 };
      const lista = lerListaNumeros(c, R_NUMERO_PARAGRAFO, (x) => x[1] ?? '', R_SEPARADOR_NUMERO);
      if (lista.length > 0) paragrafos = lista;
    }
  }
  const romanos = romanosTexto ? lerRomanosComFaixa({ texto: romanosTexto, pos: 0 }) : [];
  const letras = letrasTexto ? lerLetras({ texto: letrasTexto, pos: 0 }, true) : [];
  const resultado: ReferenciaDispositivo[] = [];
  for (const paragrafo of paragrafos) {
    if (romanos.length === 0) {
      resultado.push({ artigo, paragrafo, inciso: null, alinea: null });
      continue;
    }
    for (const inciso of romanos) {
      if (letras.length === 0) resultado.push({ artigo, paragrafo, inciso, alinea: null });
      else for (const alinea of letras) resultado.push({ artigo, paragrafo, inciso, alinea });
    }
  }
  return resultado;
}

/** Texto com aspas curvas, espaços rígidos e "°" uniformizados, sem mudar o tamanho (as posições continuam valendo). */
function uniformizar(texto: string): string {
  return texto.replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/°/g, 'º');
}

/**
 * Encontra as citações de artigos no texto, com parágrafos, incisos e alíneas, listas e faixas ("arts. 62 a 70",
 * "incisos I a XIII"), a forma invertida ("inciso II do art. 6º") e a norma citada ("do Decreto 10.947/2022",
 * "LC 123/2006, art. 48"). Sem norma expressa, vale a Lei 14.133/2021, salvo quando a citação anterior da mesma
 * frase, logo antes, indicou outra norma ("LC 123/2006, art. 48, I, ressalvadas as hipóteses do art. 49").
 */
export function extrairCitacoesLegais(textoOriginal: string): CitacaoLegal[] {
  const texto = uniformizar(textoOriginal);
  const citacoes: CitacaoLegal[] = [];
  let anterior: { fim: number; norma: string | null; expressa: boolean } | null = null;
  for (const ancora of texto.matchAll(R_ANCORA)) {
    const inicioAncora = ancora.index ?? 0;
    if (citacoes.length > 0 && inicioAncora < (citacoes.at(-1)?.fim ?? 0)) continue;
    const c: Cursor = { texto, pos: inicioAncora + ancora[0].length };
    const artigos = lerListaNumeros(c, R_NUMERO_ARTIGO, numeroArtigo, R_SEPARADOR_NUMERO);
    if (artigos.length === 0) continue;
    const emitidos: ReferenciaDispositivo[] = artigos.map((a) => ({ artigo: a, paragrafo: null, inciso: null, alinea: null }));
    let inicio = inicioAncora;
    const antes = texto.slice(Math.max(0, inicioAncora - 200), inicioAncora);
    const reverso = artigos.length === 1 ? R_REVERSO.exec(antes) : null;
    if (reverso && reverso[0].length > 0) {
      emitidos.splice(0, emitidos.length, ...dispositivosReversos(reverso, artigos[0] ?? ''));
      inicio = inicioAncora - reverso[0].length;
    } else {
      lerComponentes(c, artigos.at(-1) ?? '', emitidos);
    }
    let norma: string | null = null;
    let expressa = false;
    const sufixo = casar(c, R_NORMA_SUFIXO);
    if (sufixo) {
      norma = normaDe(sufixo);
      expressa = true;
    } else if (casar(c, R_DESTA_LEI)) {
      expressa = true;
    } else {
      const prefixo = R_NORMA_PREFIXO.exec(texto.slice(Math.max(0, inicio - 100), inicio));
      if (prefixo) {
        norma = normaDe(prefixo);
        expressa = true;
      }
    }
    if (!expressa && anterior && anterior.norma !== null && anterior.expressa && inicio - anterior.fim <= DISTANCIA_HERANCA_NORMA) {
      const entre = texto.slice(anterior.fim, inicio);
      if (!/[.;!?]\s|\n|\|/.test(entre)) norma = anterior.norma;
    }
    const fim = c.pos;
    citacoes.push({ trecho: textoOriginal.slice(inicio, fim).trim(), inicio, fim, norma, dispositivos: emitidos });
    anterior = { fim, norma, expressa: expressa || norma !== null };
  }
  return citacoes;
}

// ───────────────────────── frase e assunto ─────────────────────────

const R_FIM_FRASE = /[;!?]|\.(?=\s+["*(]?[A-ZÁÉÍÓÚÂÊÔÃÕÀÇ]|\s*$)/g;

/** Frase da citação: entre quebras de linha, células de tabela e fins de frase. */
function fraseDe(texto: string, inicio: number, fim: number): { inicio: number; fim: number } {
  const linha = Math.max(texto.lastIndexOf('\n', inicio - 1), texto.lastIndexOf('|', inicio - 1)) + 1;
  let esquerda = linha;
  for (const m of texto.slice(linha, inicio).matchAll(R_FIM_FRASE)) esquerda = Math.max(esquerda, linha + (m.index ?? 0) + 1);
  const limites = [texto.indexOf('\n', fim), texto.indexOf('|', fim)].filter((i) => i >= 0);
  let direita = limites.length > 0 ? Math.min(...limites) : texto.length;
  const resto = texto.slice(fim, direita);
  const fimFrase = new RegExp(R_FIM_FRASE.source).exec(resto);
  if (fimFrase) direita = fim + fimFrase.index + 1;
  return { inicio: esquerda, fim: direita };
}

function resumirContexto(texto: string): string {
  const limpo = texto.replace(/[*#>`]/g, '').replace(/\s+/g, ' ').trim();
  return limpo.length <= 280 ? limpo : `${limpo.slice(0, 279).trimEnd()}…`;
}

function textoIncisos(lista: readonly IncisoLei[]): string {
  return lista.map((i) => [i.texto, ...i.alineas.map((a) => a.texto)].join(' ')).join(' ');
}

/** Texto do dispositivo citado com o que está abaixo e acima dele e as divisões do artigo. */
function textoDoAssunto(artigo: ArtigoLei, ref: ReferenciaDispositivo): string {
  const partes = [artigo.titulos.join(' '), artigo.caput];
  if (ref.paragrafo === null && ref.inciso === null) {
    partes.push(textoIncisos(artigo.incisos), ...artigo.paragrafos.map((p) => `${p.texto} ${textoIncisos(p.incisos)}`));
    return partes.join(' ');
  }
  const paragrafo = ref.paragrafo === null ? null : artigo.paragrafos.find((p) => p.numero === ref.paragrafo);
  if (paragrafo) partes.push(paragrafo.texto);
  const lista = paragrafo ? paragrafo.incisos : artigo.incisos;
  if (ref.inciso === null) {
    partes.push(textoIncisos(lista));
    return partes.join(' ');
  }
  const inciso = lista.find((i) => i.numero === ref.inciso);
  if (inciso) {
    partes.push(inciso.texto);
    const alinea = ref.alinea === null ? null : inciso.alineas.find((a) => a.letra === ref.alinea);
    partes.push(alinea ? alinea.texto : inciso.alineas.map((a) => a.texto).join(' '));
  }
  return partes.join(' ');
}

const GRAVIDADE: Record<SituacaoCitacao, number> = { inexistente: 4, sem_efeito: 3, suspeita: 2, outra_norma: 1, confere: 0 };

/**
 * Confere as citações do texto com a base normativa: existência de cada artigo, parágrafo, inciso e alínea;
 * dispositivo vetado ou revogado; e correspondência do assunto. A citação é "suspeita" quando o trecho tem ao menos
 * {@link MINIMO_TERMOS_ASSUNTO} termos de conteúdo, nenhum deles aparece no dispositivo citado (nem no caput nem nas
 * divisões do artigo) e outro artigo da lei trata claramente do mesmo assunto — que vira a sugestão.
 */
export function conferirCitacoesLegais(textoOriginal: string, indice: IndiceNormativo): ConferenciaCitacoes {
  const texto = uniformizar(textoOriginal);
  const encontradas = extrairCitacoesLegais(textoOriginal);
  const titulo = indice.base.norma.titulo;
  const conferidas: CitacaoConferida[] = encontradas.map((citacao) => {
    const frase = fraseDe(texto, citacao.inicio, citacao.fim);
    const contextoBruto = texto.slice(frase.inicio, frase.fim);
    const referencias = citacao.dispositivos.map(formatarReferenciaDispositivo);
    const base = { trecho: citacao.trecho, referencias, contexto: resumirContexto(contextoBruto), posicao: citacao.inicio };
    if (citacao.norma !== null) {
      return { ...base, norma: citacao.norma, situacao: 'outra_norma', motivo: `Citação de outra norma (${citacao.norma}): fora da base normativa, não conferida.`, sugestao: null };
    }
    let pior: { situacao: SituacaoCitacao; motivo: string } = { situacao: 'confere', motivo: '' };
    const artigosCitados: ArtigoLei[] = [];
    const termosCitados = new Set<string>();
    for (const ref of citacao.dispositivos) {
      const local = localizarDispositivo(indice.artigos, ref);
      if (!local.encontrado) {
        if (GRAVIDADE[pior.situacao] < GRAVIDADE.inexistente) pior = { situacao: 'inexistente', motivo: local.motivo };
        continue;
      }
      if (dispositivoSemEfeito(local.texto)) {
        if (GRAVIDADE[pior.situacao] < GRAVIDADE.sem_efeito) {
          pior = { situacao: 'sem_efeito', motivo: `O ${formatarReferenciaDispositivo(ref)} está sem efeito: ${local.texto.replace(/[().]/g, '').trim().toLowerCase()}.` };
        }
        continue;
      }
      artigosCitados.push(local.artigo);
      for (const t of termosNormativos(textoDoAssunto(local.artigo, ref))) termosCitados.add(t);
    }
    // Termos do assunto: a frase sem as citações, sem palavras de remissão e sem os termos frequentes da lei.
    let semCitacoes = contextoBruto;
    for (const outra of encontradas) {
      if (outra.fim <= frase.inicio || outra.inicio >= frase.fim) continue;
      const a = Math.max(0, outra.inicio - frase.inicio);
      const b = Math.min(contextoBruto.length, outra.fim - frase.inicio);
      semCitacoes = `${semCitacoes.slice(0, a)}${' '.repeat(b - a)}${semCitacoes.slice(b)}`;
    }
    // Para sugerir o artigo, valem todos os termos (o BM25 já pesa pouco os frequentes); para conferir, só os distintivos.
    const termosFrase = [...new Set(termosNormativos(semCitacoes, { ignorarRemissivas: true }))];
    const assunto = termosFrase.filter((t) => !indice.frequentes.has(t));
    const sugestaoInexistente = (): string | null => {
      if (assunto.length < MINIMO_TERMOS_ASSUNTO) return null;
      const melhor = pontuarArtigos(indice, termosFrase)[0];
      const artigo = melhor ? indice.artigos.get(melhor.artigo) : undefined;
      return artigo ? `O trecho parece tratar do ${rotuloArtigo(artigo.numero)}${artigo.titulos.at(-1) ? ` (${artigo.titulos.at(-1)})` : ''}.` : null;
    };
    if (pior.situacao !== 'confere') return { ...base, norma: titulo, situacao: pior.situacao, motivo: pior.motivo, sugestao: pior.situacao === 'inexistente' ? sugestaoInexistente() : null };
    if (assunto.length >= MINIMO_TERMOS_ASSUNTO && !assunto.some((t) => termosCitados.has(t))) {
      const citados = new Set(artigosCitados.map((a) => a.numero));
      for (const { artigo: numero } of pontuarArtigos(indice, termosFrase).slice(0, 5)) {
        if (citados.has(numero)) continue;
        const artigo = indice.artigos.get(numero);
        if (!artigo) continue;
        const termosArtigo = new Set(termosNormativos(textoDoAssunto(artigo, { artigo: numero, paragrafo: null, inciso: null, alinea: null })));
        const comuns = assunto.filter((t) => termosArtigo.has(t)).length;
        if (comuns < MINIMO_TERMOS_SUGESTAO) continue;
        return {
          ...base,
          norma: titulo,
          situacao: 'suspeita',
          motivo: `O assunto do trecho não aparece no ${referencias.join('; ')}.`,
          sugestao: `O trecho parece tratar do ${rotuloArtigo(numero)}${artigo.titulos.at(-1) ? ` (${artigo.titulos.at(-1)})` : ''}.`,
        };
      }
    }
    return { ...base, norma: titulo, situacao: 'confere', motivo: 'Dispositivo encontrado na base normativa.', sugestao: null };
  });
  const contar = (s: SituacaoCitacao) => conferidas.filter((c) => c.situacao === s).length;
  const inexistentes = contar('inexistente');
  const semEfeito = contar('sem_efeito');
  const suspeitas = contar('suspeita');
  const bloqueantes = inexistentes + semEfeito;
  return {
    norma: titulo,
    total: conferidas.length,
    conferem: contar('confere'),
    inexistentes,
    semEfeito,
    suspeitas,
    outrasNormas: contar('outra_norma'),
    bloqueantes,
    problemas: bloqueantes + suspeitas,
    fiel: bloqueantes + suspeitas === 0,
    citacoes: [...conferidas].sort((a, b) => GRAVIDADE[b.situacao] - GRAVIDADE[a.situacao] || a.posicao - b.posicao),
    premissas: [
      `Base normativa: ${titulo}, texto compilado obtido de ${indice.base.proveniencia.fonte} em ${indice.base.proveniencia.obtidoEm.slice(0, 10)} (SHA-256 ${indice.base.proveniencia.sha256Texto.slice(0, 12)}…).`,
      `Citações sem norma expressa foram lidas como da ${titulo}; as de outras normas não são conferidas.`,
      `Assunto conferido pelos termos da frase (mínimo de ${MINIMO_TERMOS_ASSUNTO}) contra o texto do dispositivo, do caput e das divisões do artigo.`,
    ],
    aviso: AVISO_CONFERENCIA_CITACOES,
  };
}
