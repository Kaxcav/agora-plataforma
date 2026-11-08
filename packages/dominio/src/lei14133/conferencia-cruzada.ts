/**
 * Conferência cruzada entre os documentos da contratação (RIA-15): DFD, ETP, matriz de riscos, nota técnica de
 * preços, termo de referência, edital e minuta do contrato devem tratar do mesmo objeto, com as mesmas quantidades,
 * valor estimado, prazos, dotação, modalidade e critério de julgamento (art. 6º, XXIII; art. 18; art. 25; art. 92).
 *
 * Os fatos são lidos do texto de cada documento (tabelas de itens e frases-padrão), sem modelo de linguagem. Cada
 * divergência traz os trechos de cada documento e é um sinal que requer revisão humana: não corrige nem decide nada.
 */
import { termosNormativos } from '../normas/termos.ts';

export type AspectoConferenciaCruzada = 'objeto' | 'quantidade' | 'valor_estimado' | 'prazo' | 'dotacao' | 'modalidade' | 'criterio_julgamento';

export interface DocumentoConferenciaCruzada {
  tipo: string;
  /** Nome do documento para exibição ("Termo de Referência"). */
  titulo: string;
  versao: number;
  conteudo: string;
}

/** Fato lido de um documento. `chave` identifica o que se compara (ex.: "quantidade:1", "prazo:vigencia"). */
export interface FatoDocumento {
  aspecto: AspectoConferenciaCruzada;
  chave: string;
  rotulo: string;
  /** Valor normalizado, usado na comparação. */
  valor: string;
  /** Valor como aparece no documento. */
  exibicao: string;
  trecho: string;
}

export interface OcorrenciaDivergencia {
  tipo: string;
  documento: string;
  versao: number;
  valor: string;
  trecho: string;
}

export interface DivergenciaDocumentos {
  aspecto: AspectoConferenciaCruzada;
  chave: string;
  titulo: string;
  descricao: string;
  fundamento: string;
  ocorrencias: OcorrenciaDivergencia[];
}

export interface ResumoAspectoConferencia {
  aspecto: AspectoConferenciaCruzada;
  rotulo: string;
  /** Dados comparados (chaves presentes em ao menos dois documentos). */
  comparacoes: number;
  divergencias: number;
}

export interface ConferenciaCruzada {
  documentos: { tipo: string; titulo: string; versao: number; fatos: number }[];
  aspectos: ResumoAspectoConferencia[];
  divergencias: DivergenciaDocumentos[];
  consistente: boolean;
  premissas: string[];
  aviso: string;
}

export const ROTULOS_ASPECTO_CONFERENCIA: Readonly<Record<AspectoConferenciaCruzada, string>> = Object.freeze({
  objeto: 'Objeto',
  quantidade: 'Quantidades',
  valor_estimado: 'Valor estimado',
  prazo: 'Prazos',
  dotacao: 'Dotação orçamentária',
  modalidade: 'Modalidade',
  criterio_julgamento: 'Critério de julgamento',
});

export const FUNDAMENTOS_CONFERENCIA_CRUZADA: Readonly<Record<AspectoConferenciaCruzada, string>> = Object.freeze({
  objeto: 'Lei 14.133/2021, art. 6º, XXIII, "a", e art. 25, caput',
  quantidade: 'Lei 14.133/2021, art. 18, § 1º, IV, e art. 40, III',
  valor_estimado: 'Lei 14.133/2021, art. 18, § 1º, VI, e art. 23',
  prazo: 'Lei 14.133/2021, art. 6º, XXIII, "a", e art. 92, VII',
  dotacao: 'Lei 14.133/2021, art. 6º, XXIII, "j", e art. 92, VIII',
  modalidade: 'Lei 14.133/2021, art. 6º, XXIII, "h", e art. 25, caput',
  criterio_julgamento: 'Lei 14.133/2021, art. 6º, XXIII, "h", e art. 33',
});

export const AVISO_CONFERENCIA_CRUZADA =
  'Conferência automática entre os documentos do processo: aponta divergências para a equipe conferir e corrigir. É um sinal, não uma decisão — requer revisão humana.';

/** Semelhança mínima (termos em comum) para considerar duas descrições do objeto equivalentes. */
const SEMELHANCA_MINIMA_OBJETO = 0.8;

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[*_`"]/g, '')
    .replace(/[^a-z0-9%,./ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:]+$/, '')
    .trim();
}

function limparTrecho(texto: string): string {
  const limpo = texto.replace(/[*#>`]/g, '').replace(/\s+/g, ' ').trim();
  return limpo.length <= 240 ? limpo : `${limpo.slice(0, 239).trimEnd()}…`;
}

function inteiro(texto: string): number | null {
  const digitos = texto.replace(/[.\s]/g, '');
  return /^\d+$/.test(digitos) ? Number(digitos) : null;
}

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** Quantidades das tabelas de itens (colunas "Item", "Descrição", "Unidade" e "Quantidade"). */
function fatosTabelasItens(linhas: readonly string[]): FatoDocumento[] {
  const fatos: FatoDocumento[] = [];
  for (let i = 0; i < linhas.length - 1; i++) {
    const cabecalho = linhas[i] ?? '';
    if (!cabecalho.trim().startsWith('|') || !/^\s*\|\s*-{3}/.test(linhas[i + 1] ?? '')) continue;
    const nomes = celulas(cabecalho).map(normalizar);
    const colItem = nomes.findIndex((n) => n === 'item' || n === 'n' || n === 'no');
    const colQuantidade = nomes.findIndex((n) => n.startsWith('quantidade'));
    const colDescricao = nomes.findIndex((n) => n.startsWith('descricao'));
    const colUnidade = nomes.findIndex((n) => n.startsWith('unidade'));
    if (colItem < 0 || colQuantidade < 0 || colDescricao < 0) continue;
    for (let j = i + 2; j < linhas.length && (linhas[j] ?? '').trim().startsWith('|'); j++) {
      const valores = celulas(linhas[j] ?? '');
      const item = inteiro(valores[colItem] ?? '');
      const quantidade = inteiro(valores[colQuantidade] ?? '');
      if (item === null || quantidade === null) continue;
      const descricao = valores[colDescricao] ?? '';
      const unidade = colUnidade >= 0 ? (valores[colUnidade] ?? '') : '';
      const rotulo = `Item ${item}${descricao ? ` — ${descricao}` : ''}`;
      const exibicao = `${quantidade.toLocaleString('pt-BR')}${unidade ? ` ${unidade}` : ''}`;
      fatos.push({ aspecto: 'quantidade', chave: `quantidade:${item}`, rotulo, valor: String(quantidade), exibicao, trecho: limparTrecho(`Item ${item}: ${descricao}, ${exibicao}`) });
      if (unidade) {
        fatos.push({ aspecto: 'quantidade', chave: `unidade:${item}`, rotulo: `Unidade do item ${item}`, valor: normalizar(unidade), exibicao: unidade, trecho: limparTrecho(`Item ${item}: ${descricao}, unidade ${unidade}`) });
      }
    }
  }
  return fatos;
}

interface PadraoFato {
  aspecto: AspectoConferenciaCruzada;
  chave: string;
  rotulo: string;
  padrao: RegExp;
  /** Valor normalizado a partir do texto capturado. */
  valor?: (capturado: string) => string | null;
}

const MOEDA = 'R\\$\\s*[\\d.]+,\\d{2}';
const valorMonetario = (capturado: string) => capturado.replace(/\s+/g, '');
const valorInteiro = (capturado: string) => {
  const n = inteiro(capturado);
  return n === null ? null : String(n);
};

const PADROES: readonly PadraoFato[] = [
  { aspecto: 'objeto', chave: 'objeto', rotulo: 'Descrição do objeto', padrao: /^\*\*Objeto:\*\*\s*(.+)$/gm },
  { aspecto: 'objeto', chave: 'objeto', rotulo: 'Descrição do objeto', padrao: /Constitui objeto desta contratação:\s*\**(.+?)\**,\s*de natureza/g },
  { aspecto: 'objeto', chave: 'objeto', rotulo: 'Descrição do objeto', padrao: /O objeto d(?:a|o|est[ae]) (?:licitação|contrato) é\s+(.+?),\s*(?:conforme|nas condições)/g },
  { aspecto: 'objeto', chave: 'natureza', rotulo: 'Natureza do objeto', padrao: /Natureza do objeto:\s*([^.\n]+)/g },
  { aspecto: 'objeto', chave: 'natureza', rotulo: 'Natureza do objeto', padrao: /Constitui objeto desta contratação:.+?, de natureza ([^,\n]+?), nos quantitativos/g },
  { aspecto: 'quantidade', chave: 'quantidade:1', rotulo: 'Item 1 (item de referência da pesquisa)', padrao: /item 1 do DFD\):.+?quantidade de ([\d.]+)/g, valor: valorInteiro },
  { aspecto: 'valor_estimado', chave: 'valor_global', rotulo: 'Valor global estimado', padrao: new RegExp(`Valor global estimado(?: da contratação)?\\s*[:|]\\s*\\**\\s*(${MOEDA})`, 'g'), valor: valorMonetario },
  { aspecto: 'valor_estimado', chave: 'valor_global', rotulo: 'Valor global estimado', padrao: new RegExp(`valor estimado de (${MOEDA}), apurado na pesquisa de preços`, 'g'), valor: valorMonetario },
  { aspecto: 'prazo', chave: 'prazo:vigencia', rotulo: 'Vigência do contrato (meses)', padrao: /vigência(?: do contrato)? é de (\d+) meses/gi, valor: valorInteiro },
  { aspecto: 'prazo', chave: 'prazo:entrega', rotulo: 'Prazo de entrega (dias)', padrao: /entrega em até (\d+) dias/gi, valor: valorInteiro },
  { aspecto: 'prazo', chave: 'prazo:propostas', rotulo: 'Prazo mínimo de propostas (dias úteis)', padrao: /prazo mínimo(?: para apresentação de propostas:| de) (\d+) dias úteis/gi, valor: valorInteiro },
  { aspecto: 'prazo', chave: 'prazo:prova_conceito', rotulo: 'Prazo da prova de conceito (dias úteis)', padrao: /a realizar em até (\d+) dias úteis contados da convocação/gi, valor: valorInteiro },
  { aspecto: 'dotacao', chave: 'dotacao:exercicio', rotulo: 'Exercício orçamentário', padrao: /Orçamento Geral da União para o exercício de (\d{4})/g },
  { aspecto: 'dotacao', chave: 'dotacao:natureza', rotulo: 'Natureza da despesa', padrao: /natureza (?:da )?despesa:?\s*(\d{6}|\d\.\d\.\d{2}\.\d{2}(?:\.\d{2})?)/gi, valor: (c) => c.replace(/\D/g, '') },
  { aspecto: 'dotacao', chave: 'dotacao:fonte', rotulo: 'Fonte de recursos', padrao: /fonte(?: de recursos)?:?\s*(\d{3,10})(?!\d)/gi },
  { aspecto: 'dotacao', chave: 'dotacao:programa', rotulo: 'Programa de trabalho', padrao: /programa de trabalho:?\s*([\d.]{8,})/gi, valor: (c) => c.replace(/\D/g, '') },
  { aspecto: 'dotacao', chave: 'dotacao:ptres', rotulo: 'PTRES', padrao: /PTRES:?\s*(\d{4,6})/g },
  { aspecto: 'modalidade', chave: 'modalidade', rotulo: 'Modalidade', padrao: /Modalidade prevista:\s*\**([^*,.\n]+?)\**,/g },
  { aspecto: 'modalidade', chave: 'modalidade', rotulo: 'Modalidade', padrao: /na modalidade ([a-zçãõéêíóúâ ]+?), na forma/gi },
  { aspecto: 'criterio_julgamento', chave: 'criterio', rotulo: 'Critério de julgamento', padrao: /critério de julgamento de \**([a-zçãõéêíóúâ ]+?)\**(?= e modo|[,.;(])/gi },
  { aspecto: 'criterio_julgamento', chave: 'criterio', rotulo: 'Critério de julgamento', padrao: /julgadas pelo critério de ([a-zçãõéêíóúâ ]+?) \(art\. 33\)/gi },
];

/** Linha (ou frase curta) do documento em que o fato aparece. */
function trechoEm(texto: string, indice: number): string {
  const inicio = texto.lastIndexOf('\n', indice) + 1;
  const fimLinha = texto.indexOf('\n', indice);
  return limparTrecho(texto.slice(inicio, fimLinha < 0 ? texto.length : fimLinha));
}

/** Fatos comparáveis de um documento: objeto, quantidades, valor estimado, prazos, dotação, modalidade e critério. */
export function extrairFatosDocumento(conteudo: string): FatoDocumento[] {
  const fatos = fatosTabelasItens(conteudo.split(/\r?\n/));
  for (const p of PADROES) {
    for (const m of conteudo.matchAll(p.padrao)) {
      const capturado = (m[1] ?? '').trim();
      if (capturado.length === 0 || /A definir/i.test(capturado)) continue;
      const valor = p.valor ? p.valor(capturado) : normalizar(capturado);
      if (valor === null || valor.length === 0) continue;
      fatos.push({ aspecto: p.aspecto, chave: p.chave, rotulo: p.rotulo, valor, exibicao: capturado.replace(/\*+/g, ''), trecho: trechoEm(conteudo, m.index ?? 0) });
    }
  }
  return fatos;
}

function semelhanca(a: string, b: string): number {
  const ta = new Set(termosNormativos(a));
  const tb = new Set(termosNormativos(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  const comuns = [...ta].filter((t) => tb.has(t)).length;
  return comuns / Math.max(ta.size, tb.size);
}

/** Os valores divergem? A descrição do objeto admite pequenas diferenças de redação. */
function divergem(chave: string, valores: readonly string[]): boolean {
  const distintos = [...new Set(valores)];
  if (distintos.length < 2) return false;
  if (chave !== 'objeto') return true;
  return distintos.some((a, i) => distintos.slice(i + 1).some((b) => semelhanca(a, b) < SEMELHANCA_MINIMA_OBJETO));
}

/**
 * Compara os fatos de todos os documentos: há divergência quando o mesmo dado (ex.: quantidade do item 1, vigência,
 * critério de julgamento) aparece com valores diferentes em documentos — ou dentro do mesmo documento. Recebe a
 * versão de cada documento que se quer conferir (em geral, a mais recente de cada tipo).
 */
export function conferirDocumentosCruzados(documentos: readonly DocumentoConferenciaCruzada[]): ConferenciaCruzada {
  const porChave = new Map<string, { fato: FatoDocumento; doc: DocumentoConferenciaCruzada }[]>();
  const resumoDocs = documentos.map((doc) => {
    const fatos = extrairFatosDocumento(doc.conteudo);
    for (const fato of fatos) {
      const lista = porChave.get(fato.chave) ?? [];
      lista.push({ fato, doc });
      porChave.set(fato.chave, lista);
    }
    return { tipo: doc.tipo, titulo: doc.titulo, versao: doc.versao, fatos: fatos.length };
  });
  const divergencias: DivergenciaDocumentos[] = [];
  const contagem = new Map<AspectoConferenciaCruzada, { comparacoes: number; divergencias: number }>();
  for (const [chave, ocorrencias] of porChave) {
    const primeiro = ocorrencias[0];
    if (!primeiro) continue;
    const aspecto = primeiro.fato.aspecto;
    const documentosDistintos = new Set(ocorrencias.map((o) => `${o.doc.tipo}:${o.doc.versao}`)).size;
    const valores = ocorrencias.map((o) => o.fato.valor);
    const internas = documentosDistintos === 1 && new Set(valores).size > 1;
    if (documentosDistintos < 2 && !internas) continue;
    const c = contagem.get(aspecto) ?? { comparacoes: 0, divergencias: 0 };
    c.comparacoes += 1;
    if (divergem(chave, valores)) {
      c.divergencias += 1;
      const unicas = new Map<string, OcorrenciaDivergencia>();
      for (const o of ocorrencias) {
        const id = `${o.doc.tipo}:${o.doc.versao}:${o.fato.valor}`;
        if (!unicas.has(id)) unicas.set(id, { tipo: o.doc.tipo, documento: o.doc.titulo, versao: o.doc.versao, valor: o.fato.exibicao, trecho: o.fato.trecho });
      }
      const lista = [...unicas.values()];
      divergencias.push({
        aspecto,
        chave,
        titulo: `${primeiro.fato.rotulo}: valores diferentes entre os documentos`,
        descricao: lista.map((o) => `${o.documento} (versão ${o.versao}): ${o.valor}`).join('; ') + '.',
        fundamento: FUNDAMENTOS_CONFERENCIA_CRUZADA[aspecto],
        ocorrencias: lista,
      });
    }
    contagem.set(aspecto, c);
  }
  const ordem = Object.keys(ROTULOS_ASPECTO_CONFERENCIA) as AspectoConferenciaCruzada[];
  divergencias.sort((a, b) => ordem.indexOf(a.aspecto) - ordem.indexOf(b.aspecto) || a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true }));
  return {
    documentos: resumoDocs,
    aspectos: ordem.map((aspecto) => ({ aspecto, rotulo: ROTULOS_ASPECTO_CONFERENCIA[aspecto], ...(contagem.get(aspecto) ?? { comparacoes: 0, divergencias: 0 }) })),
    divergencias,
    consistente: divergencias.length === 0,
    premissas: [
      `Documentos conferidos: ${resumoDocs.map((d) => `${d.titulo} (versão ${d.versao})`).join('; ') || 'nenhum'}.`,
      'Quantidades lidas das tabelas de itens; demais dados lidos das frases-padrão dos modelos da Ágora. Dado ausente ou "a definir" não é comparado.',
      'O valor preliminar do DFD não é comparado: ele é substituído pelo valor apurado na pesquisa de preços.',
    ],
    aviso: AVISO_CONFERENCIA_CRUZADA,
  };
}
