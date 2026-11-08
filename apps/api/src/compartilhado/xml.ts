/**
 * XML mínimo, sem dependências, para as integrações SOAP (SEI). Lê elementos, atributos, texto e CDATA; não expande
 * entidades declaradas nem aceita DOCTYPE (evita XXE e "billion laughs"). Escreve texto com escape e, para envio em
 * ISO-8859-1, troca os caracteres fora do Latin-1 por referências numéricas.
 */

export interface NoXml {
  /** Nome com prefixo, ex.: "SOAP-ENV:Body". */
  nome: string;
  /** Nome sem prefixo de namespace, ex.: "Body". */
  local: string;
  atributos: Record<string, string>;
  filhos: NoXml[];
  /** Texto direto do elemento (sem o dos filhos), já sem as entidades. */
  texto: string;
}

export class ErroXml extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroXml';
  }
}

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (bruto, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    return ENTIDADES[ref] ?? bruto;
  });
}

const ATRIBUTO = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function localDe(nome: string): string {
  const doisPontos = nome.indexOf(':');
  return doisPontos === -1 ? nome : nome.slice(doisPontos + 1);
}

/** Lê o documento e devolve o elemento raiz. Lança `ErroXml` se estiver malformado. */
export function lerXml(documento: string): NoXml {
  const pilha: NoXml[] = [];
  let raiz: NoXml | null = null;
  let i = 0;
  const n = documento.length;
  while (i < n) {
    const abre = documento.indexOf('<', i);
    const fimTexto = abre === -1 ? n : abre;
    if (fimTexto > i) {
      const trecho = documento.slice(i, fimTexto);
      const atual = pilha[pilha.length - 1];
      if (atual) atual.texto += decodificar(trecho);
      else if (trecho.trim() !== '') throw new ErroXml('Texto fora do elemento raiz.');
    }
    if (abre === -1) break;
    if (documento.startsWith('<?', abre)) {
      const fim = documento.indexOf('?>', abre);
      if (fim === -1) throw new ErroXml('Instrução de processamento sem fim.');
      i = fim + 2;
    } else if (documento.startsWith('<!--', abre)) {
      const fim = documento.indexOf('-->', abre);
      if (fim === -1) throw new ErroXml('Comentário sem fim.');
      i = fim + 3;
    } else if (documento.startsWith('<![CDATA[', abre)) {
      const fim = documento.indexOf(']]>', abre);
      if (fim === -1) throw new ErroXml('CDATA sem fim.');
      const atual = pilha[pilha.length - 1];
      if (!atual) throw new ErroXml('CDATA fora do elemento raiz.');
      atual.texto += documento.slice(abre + 9, fim);
      i = fim + 3;
    } else if (documento.startsWith('<!', abre)) {
      throw new ErroXml('DOCTYPE e declarações não são aceitos.');
    } else if (documento.startsWith('</', abre)) {
      const fim = documento.indexOf('>', abre);
      if (fim === -1) throw new ErroXml('Marca de fechamento sem fim.');
      const nome = documento.slice(abre + 2, fim).trim();
      const atual = pilha.pop();
      if (!atual || atual.nome !== nome) throw new ErroXml(`Fechamento inesperado: </${nome}>.`);
      i = fim + 1;
    } else {
      const fim = documento.indexOf('>', abre);
      if (fim === -1) throw new ErroXml('Marca de abertura sem fim.');
      let conteudo = documento.slice(abre + 1, fim);
      const autoFechado = conteudo.endsWith('/');
      if (autoFechado) conteudo = conteudo.slice(0, -1);
      const nome = /^[^\s/>]+/.exec(conteudo)?.[0];
      if (!nome) throw new ErroXml('Elemento sem nome.');
      const atributos: Record<string, string> = {};
      for (const m of conteudo.slice(nome.length).matchAll(ATRIBUTO)) atributos[m[1] ?? ''] = decodificar(m[2] ?? m[3] ?? '');
      const no: NoXml = { nome, local: localDe(nome), atributos, filhos: [], texto: '' };
      const pai = pilha[pilha.length - 1];
      if (pai) pai.filhos.push(no);
      else if (raiz) throw new ErroXml('Mais de um elemento raiz.');
      else raiz = no;
      if (!autoFechado) pilha.push(no);
      i = fim + 1;
    }
  }
  if (pilha.length > 0) throw new ErroXml(`Elemento sem fechamento: <${pilha[pilha.length - 1]?.nome ?? ''}>.`);
  if (!raiz) throw new ErroXml('Documento sem elemento raiz.');
  return raiz;
}

/** Primeiro filho direto com o nome local indicado. */
export function filhoXml(no: NoXml | undefined, local: string): NoXml | undefined {
  return no?.filhos.find((f) => f.local === local);
}

/** Primeiro descendente (em profundidade) com o nome local indicado. */
export function buscarXml(no: NoXml | undefined, local: string): NoXml | undefined {
  if (!no) return undefined;
  for (const f of no.filhos) {
    if (f.local === local) return f;
    const achado = buscarXml(f, local);
    if (achado) return achado;
  }
  return undefined;
}

/** Texto de um filho direto; `null` se ausente ou marcado com xsi:nil. */
export function textoXml(no: NoXml | undefined, local: string): string | null {
  const f = filhoXml(no, local);
  if (!f) return null;
  const nulo = Object.entries(f.atributos).some(([k, v]) => localDe(k) === 'nil' && v === 'true');
  if (nulo) return null;
  return f.texto.trim();
}

/** Escapa texto para conteúdo e atributos XML. */
export function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Documento XML em bytes ISO-8859-1: caracteres fora do Latin-1 viram referências numéricas (&#x...;). */
export function bytesLatin1(documento: string): Buffer {
  const seguro = documento.replace(/[^\u0000-ÿ]/gu, (c) => `&#x${(c.codePointAt(0) ?? 63).toString(16)};`);
  return Buffer.from(seguro, 'latin1');
}
