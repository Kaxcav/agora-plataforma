/**
 * Base normativa soberana (RNF-08): o texto da Lei 14.133/2021 estruturado por artigo, parágrafo, inciso e alínea.
 *
 * O texto de lei não tem proteção autoral (Lei 9.610/1998, art. 8º, IV) e fica no repositório como dado público,
 * com fonte, data de obtenção e hash. Este módulo só estrutura e consulta o texto: funções puras, sem I/O.
 */
import { ErroDominio } from '../erros.ts';

export interface AlineaLei {
  letra: string;
  texto: string;
}

export interface IncisoLei {
  /** Algarismo romano ("I", "XXIII"). */
  numero: string;
  texto: string;
  alineas: AlineaLei[];
}

export interface ParagrafoLei {
  /** "1", "2"… ou "unico" (parágrafo único). */
  numero: string;
  texto: string;
  incisos: IncisoLei[];
}

export interface ArtigoLei {
  /** "1", "75", "184-A". */
  numero: string;
  caput: string;
  incisos: IncisoLei[];
  paragrafos: ParagrafoLei[];
  /** Divisões em que o artigo está, da maior para a menor ("TÍTULO II — DAS LICITAÇÕES" …). */
  titulos: string[];
  /** Texto que o artigo insere em outra lei (entre aspas no original): não é dispositivo desta lei. */
  textoAlterador: string[];
}

export interface ProvenienciaNorma {
  /** Órgão que publica o texto. */
  fonte: string;
  url: string;
  /** Instante da obtenção (ISO). */
  obtidoEm: string;
  /** Formato do arquivo obtido ("docx", "html"). */
  formato: string;
  /** SHA-256 do arquivo obtido, tal como baixado. */
  sha256Arquivo: string;
  /** SHA-256 do texto extraído, uma linha por dispositivo, que deu origem à estrutura. */
  sha256Texto: string;
  observacao: string;
}

export interface BaseNormativa {
  norma: { id: string; titulo: string; ementa: string; numero: string; ano: number };
  proveniencia: ProvenienciaNorma;
  artigos: ArtigoLei[];
}

/** Dispositivo citado: artigo e, quando houver, parágrafo, inciso e alínea. `paragrafo` nulo = caput. */
export interface ReferenciaDispositivo {
  artigo: string;
  paragrafo: string | null;
  inciso: string | null;
  alinea: string | null;
}

// ───────────────────────── algarismos romanos ─────────────────────────

const VALORES_ROMANOS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const SIMBOLOS_ROMANOS: [number, string][] = [
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** Valor de um algarismo romano válido (I a CXC); `null` se a grafia não for canônica. */
export function romanoParaNumero(romano: string): number | null {
  if (!/^[IVXLC]+$/.test(romano)) return null;
  let total = 0;
  for (let i = 0; i < romano.length; i++) {
    const atual = VALORES_ROMANOS[romano[i] ?? ''] ?? 0;
    const proximo = VALORES_ROMANOS[romano[i + 1] ?? ''] ?? 0;
    total += atual < proximo ? -atual : atual;
  }
  return numeroParaRomano(total) === romano ? total : null;
}

/** Algarismo romano de 1 a 199. */
export function numeroParaRomano(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 199) throw new ErroDominio('ROMANO_INVALIDO', 'O número deve ser inteiro de 1 a 199.');
  let resto = n;
  let romano = '';
  for (const [valor, simbolo] of SIMBOLOS_ROMANOS) {
    while (resto >= valor) {
      romano += simbolo;
      resto -= valor;
    }
  }
  return romano;
}

// ───────────────────────── rótulos ─────────────────────────

function ordinal(numero: string): string {
  return /^[1-9]$/.test(numero) ? `${numero}º` : numero;
}

/** "art. 6º", "art. 75", "art. 184-A". */
export function rotuloArtigo(numero: string): string {
  const [base, sufixo] = numero.split('-');
  return `art. ${ordinal(base ?? numero)}${sufixo ? `-${sufixo}` : ''}`;
}

/** "§ 1º", "§ 10", "parágrafo único". */
export function rotuloParagrafo(numero: string): string {
  return numero === 'unico' ? 'parágrafo único' : `§ ${ordinal(numero)}`;
}

/** Referência legível: art. 75, § 3º, II, "a". */
export function formatarReferenciaDispositivo(ref: ReferenciaDispositivo): string {
  const partes = [rotuloArtigo(ref.artigo)];
  if (ref.paragrafo !== null) partes.push(rotuloParagrafo(ref.paragrafo));
  if (ref.inciso !== null) partes.push(ref.inciso);
  if (ref.alinea !== null) partes.push(`"${ref.alinea}"`);
  return partes.join(', ');
}

/** Dispositivo vetado ou revogado: a citação aponta para texto sem efeito. */
export function dispositivoSemEfeito(texto: string): boolean {
  return /^\(?\s*\(?(vetado|revogad[oa])/i.test(texto.trim());
}

// ───────────────────────── estruturação do texto ─────────────────────────

const PADRAO_ARTIGO = /^Art\.\s*(\d+)(?:\s*[º°o])?(?:-([A-Z]))?\.?\s+(.*)$/;
const PADRAO_PARAGRAFO = /^§\s*(\d+)(?:\s*[º°o])?\.?\s+(.*)$/;
const PADRAO_PARAGRAFO_UNICO = /^Parágrafo único\.?\s*(.*)$/i;
const PADRAO_INCISO = /^([IVXLC]+)\s*[-–—]\s*(.*)$/;
const PADRAO_ALINEA = /^([a-z])\)\s*(.*)$/;
const PADRAO_DIVISAO = /^(TÍTULO|CAPÍTULO|Seção|Subseção)\s+([IVXLC]+(?:-[A-Z])?|ÚNIC[AO]|Única|Único)$/;
const NIVEIS_DIVISAO = ['TÍTULO', 'CAPÍTULO', 'Seção', 'Subseção'] as const;

function abreCitacao(linha: string): boolean {
  return linha.startsWith('"') || linha.startsWith('“');
}

function fechaCitacao(linha: string): boolean {
  return /["”]\s*(\(NR\))?\s*$/.test(linha);
}

/**
 * Estrutura o texto da lei (uma linha por dispositivo, como no texto compilado oficial) em artigos, parágrafos,
 * incisos e alíneas, com as divisões (título, capítulo, seção e subseção) de cada artigo. O texto entre aspas que um
 * artigo insere em outra lei fica em `textoAlterador` e não vira dispositivo. O preâmbulo e o fecho são ignorados.
 */
export function estruturarTextoLei(texto: string): ArtigoLei[] {
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' ').trim())
    .filter((l) => l.length > 0);
  const artigos: ArtigoLei[] = [];
  const divisoes: (string | null)[] = [null, null, null, null];
  let divisaoPendente: { nivel: number; rotulo: string } | null = null;
  let artigo: ArtigoLei | null = null;
  let paragrafo: ParagrafoLei | null = null;
  let inciso: IncisoLei | null = null;
  let emCitacao = false;

  const anexar = (trecho: string) => {
    if (!artigo) return;
    const alinea = inciso?.alineas.at(-1);
    if (alinea) alinea.texto = `${alinea.texto} ${trecho}`;
    else if (inciso) inciso.texto = `${inciso.texto} ${trecho}`;
    else if (paragrafo) paragrafo.texto = `${paragrafo.texto} ${trecho}`;
    else artigo.caput = `${artigo.caput} ${trecho}`;
  };

  for (const linha of linhas) {
    if (/^Brasília,/.test(linha)) break;
    if (emCitacao) {
      artigo?.textoAlterador.push(linha);
      if (fechaCitacao(linha)) emCitacao = false;
      continue;
    }
    if (artigo && abreCitacao(linha)) {
      artigo.textoAlterador.push(linha);
      emCitacao = !fechaCitacao(linha.slice(1));
      continue;
    }
    if (divisaoPendente) {
      divisoes[divisaoPendente.nivel] = `${divisaoPendente.rotulo} — ${linha}`;
      divisaoPendente = null;
      continue;
    }
    const divisao = PADRAO_DIVISAO.exec(linha);
    if (divisao) {
      const nivel = NIVEIS_DIVISAO.indexOf(divisao[1] as (typeof NIVEIS_DIVISAO)[number]);
      for (let i = nivel; i < divisoes.length; i++) divisoes[i] = null;
      divisaoPendente = { nivel, rotulo: linha };
      continue;
    }
    const art = PADRAO_ARTIGO.exec(linha);
    if (art) {
      artigo = {
        numero: art[2] ? `${art[1]}-${art[2]}` : (art[1] ?? ''),
        caput: art[3] ?? '',
        incisos: [],
        paragrafos: [],
        titulos: divisoes.filter((d): d is string => d !== null),
        textoAlterador: [],
      };
      artigos.push(artigo);
      paragrafo = null;
      inciso = null;
      continue;
    }
    if (!artigo) continue;
    const par = PADRAO_PARAGRAFO.exec(linha);
    const unico = par ? null : PADRAO_PARAGRAFO_UNICO.exec(linha);
    if (par || unico) {
      paragrafo = { numero: par ? (par[1] ?? '') : 'unico', texto: (par ? par[2] : unico?.[1]) ?? '', incisos: [] };
      artigo.paragrafos.push(paragrafo);
      inciso = null;
      continue;
    }
    const inc = PADRAO_INCISO.exec(linha);
    if (inc && romanoParaNumero(inc[1] ?? '') !== null) {
      inciso = { numero: inc[1] ?? '', texto: inc[2] ?? '', alineas: [] };
      (paragrafo ? paragrafo.incisos : artigo.incisos).push(inciso);
      continue;
    }
    const ali = PADRAO_ALINEA.exec(linha);
    if (ali && inciso) {
      inciso.alineas.push({ letra: ali[1] ?? '', texto: ali[2] ?? '' });
      continue;
    }
    anexar(linha);
  }
  return artigos;
}

// ───────────────────────── consulta ─────────────────────────

export type ResultadoLocalizacao =
  | { encontrado: true; artigo: ArtigoLei; paragrafo: ParagrafoLei | null; inciso: IncisoLei | null; alinea: AlineaLei | null; texto: string }
  | { encontrado: false; motivo: string };

function faixa(itens: readonly string[], rotulo: (s: string) => string): string {
  if (itens.length === 0) return 'nenhum';
  if (itens.length === 1) return rotulo(itens[0] ?? '');
  return `${rotulo(itens[0] ?? '')} a ${rotulo(itens.at(-1) ?? '')}`;
}

/** Localiza o dispositivo citado na lista de artigos; se não existir, explica o que existe. */
export function localizarDispositivo(artigos: ReadonlyMap<string, ArtigoLei>, ref: ReferenciaDispositivo): ResultadoLocalizacao {
  const artigo = artigos.get(ref.artigo);
  const nomeArtigo = rotuloArtigo(ref.artigo);
  if (!artigo) {
    const numeros = [...artigos.keys()];
    return { encontrado: false, motivo: `O ${nomeArtigo} não existe na lei, que vai do ${rotuloArtigo(numeros[0] ?? '1')} ao ${rotuloArtigo(numeros.at(-1) ?? '1')}.` };
  }
  let paragrafo: ParagrafoLei | null = null;
  if (ref.paragrafo !== null) {
    paragrafo = artigo.paragrafos.find((p) => p.numero === ref.paragrafo) ?? null;
    if (!paragrafo) {
      const existentes = artigo.paragrafos.map((p) => p.numero);
      const descricao =
        existentes.length === 0
          ? 'não tem parágrafos'
          : existentes.includes('unico')
            ? 'tem só parágrafo único'
            : `tem ${existentes.length === 1 ? rotuloParagrafo(existentes[0] ?? '') : `§§ ${faixa(existentes, ordinal)}`}`;
      return { encontrado: false, motivo: `O ${nomeArtigo} não tem ${rotuloParagrafo(ref.paragrafo)}: ${descricao}.` };
    }
  }
  const nomeNivel = paragrafo ? `${nomeArtigo}, ${rotuloParagrafo(paragrafo.numero)}` : nomeArtigo;
  let inciso: IncisoLei | null = null;
  if (ref.inciso !== null) {
    const lista = paragrafo ? paragrafo.incisos : artigo.incisos;
    inciso = lista.find((i) => i.numero === ref.inciso) ?? null;
    if (!inciso) {
      const onde = paragrafo ? `O ${nomeNivel}` : `O caput do ${nomeArtigo}`;
      const tem = lista.length === 0 ? 'não tem incisos' : `tem incisos ${faixa(lista.map((i) => i.numero), (s) => s)}`;
      const emParagrafo = paragrafo ? [] : artigo.paragrafos.filter((p) => p.incisos.some((i) => i.numero === ref.inciso));
      const dica = emParagrafo.length > 0 ? ` O inciso ${ref.inciso} existe no ${emParagrafo.map((p) => rotuloParagrafo(p.numero)).join(' e no ')}.` : '';
      return { encontrado: false, motivo: `${onde} não tem inciso ${ref.inciso}: ${tem}.${dica}` };
    }
  }
  let alinea: AlineaLei | null = null;
  if (ref.alinea !== null) {
    if (!inciso) return { encontrado: false, motivo: `Alínea "${ref.alinea}" citada sem o inciso a que pertence no ${nomeNivel}.` };
    alinea = inciso.alineas.find((a) => a.letra === ref.alinea) ?? null;
    if (!alinea) {
      const tem = inciso.alineas.length === 0 ? 'não tem alíneas' : `tem alíneas "${inciso.alineas[0]?.letra}" a "${inciso.alineas.at(-1)?.letra}"`;
      return { encontrado: false, motivo: `O inciso ${inciso.numero} do ${nomeNivel} não tem alínea "${ref.alinea}": ${tem}.` };
    }
  }
  const texto = alinea?.texto ?? inciso?.texto ?? paragrafo?.texto ?? artigo.caput;
  return { encontrado: true, artigo, paragrafo, inciso, alinea, texto };
}

/** Mapa número → artigo, na ordem da lei. */
export function mapaArtigos(base: Pick<BaseNormativa, 'artigos'>): Map<string, ArtigoLei> {
  return new Map(base.artigos.map((a) => [a.numero, a]));
}

/** Texto integral do artigo, um dispositivo por linha, com os rótulos oficiais. */
export function textoIntegralArtigo(artigo: ArtigoLei): string {
  const linhas = [`${rotuloArtigo(artigo.numero).replace(/^art/, 'Art')} ${artigo.caput}`];
  const incisos = (lista: readonly IncisoLei[]) => {
    for (const i of lista) {
      linhas.push(`${i.numero} - ${i.texto}`);
      for (const a of i.alineas) linhas.push(`${a.letra}) ${a.texto}`);
    }
  };
  incisos(artigo.incisos);
  for (const p of artigo.paragrafos) {
    linhas.push(`${p.numero === 'unico' ? 'Parágrafo único.' : rotuloParagrafo(p.numero)} ${p.texto}`);
    incisos(p.incisos);
  }
  return linhas.join('\n');
}
