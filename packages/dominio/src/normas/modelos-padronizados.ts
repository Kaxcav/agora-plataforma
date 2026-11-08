/**
 * Estrutura dos modelos padronizados de documentos (Lei 14.133/2021, art. 19, IV): as seções e cláusulas
 * obrigatórias de cada documento, com o fundamento legal. Entra só a estrutura — o que a lei manda o documento
 * conter —, sem copiar o texto dos modelos de minutas da Advocacia-Geral da União.
 */

export type TipoModeloPadronizado = 'etp' | 'matriz_riscos' | 'tr' | 'edital' | 'minuta_contrato';

export interface SecaoModeloPadronizado {
  id: string;
  titulo: string;
  fundamento: string;
  /** Expressões (sem acento, minúsculas) que identificam a seção num título do documento; basta uma. */
  expressoes: readonly string[];
}

export interface ModeloPadronizado {
  tipo: TipoModeloPadronizado;
  documento: string;
  fundamento: string;
  secoes: readonly SecaoModeloPadronizado[];
}

function secao(id: string, titulo: string, fundamento: string, ...expressoes: string[]): SecaoModeloPadronizado {
  return { id, titulo, fundamento, expressoes };
}

const INCISOS_ETP_MODELO: readonly [string, string, string[]][] = [
  ['I', 'Descrição da necessidade da contratação', ['necessidade']],
  ['II', 'Previsão no plano de contratações anual', ['plano de contratac', 'planejamento']],
  ['III', 'Requisitos da contratação', ['requisitos']],
  ['IV', 'Estimativas das quantidades e memórias de cálculo', ['quantidade']],
  ['V', 'Levantamento de mercado', ['levantamento de mercado', 'mercado']],
  ['VI', 'Estimativa do valor da contratação', ['valor']],
  ['VII', 'Descrição da solução como um todo', ['solucao']],
  ['VIII', 'Justificativas para o parcelamento ou não', ['parcelamento']],
  ['IX', 'Demonstrativo dos resultados pretendidos', ['resultados']],
  ['X', 'Providências prévias à celebração do contrato', ['providencias']],
  ['XI', 'Contratações correlatas e/ou interdependentes', ['correlatas', 'interdependentes']],
  ['XII', 'Impactos ambientais e medidas mitigadoras', ['ambienta']],
  ['XIII', 'Posicionamento conclusivo sobre a adequação da contratação', ['posicionamento conclusivo', 'conclusivo']],
];

const INCISOS_MINUTA: readonly [string, string, string[]][] = [
  ['I', 'Objeto e seus elementos característicos', ['objeto']],
  ['II', 'Vinculação ao edital e à proposta', ['vinculacao']],
  ['III', 'Legislação aplicável', ['legislacao']],
  ['IV', 'Regime de execução ou forma de fornecimento', ['regime de execucao', 'forma de fornecimento']],
  ['V', 'Preço, condições de pagamento, reajuste e atualização monetária', ['preco', 'reajuste']],
  ['VI', 'Critérios de medição e de pagamento', ['medicao', 'liquidacao']],
  ['VII', 'Prazos de início, execução, conclusão e recebimento', ['prazos de execucao', 'prazo de execucao', 'recebimento']],
  ['VIII', 'Crédito orçamentário', ['credito orcamentario', 'dotacao']],
  ['IX', 'Matriz de riscos', ['matriz de riscos']],
  ['X', 'Prazo de resposta ao pedido de repactuação', ['repactuacao']],
  ['XI', 'Prazo de resposta ao pedido de restabelecimento do equilíbrio', ['equilibrio']],
  ['XII', 'Garantias de execução', ['garantias de execucao', 'garantia de execucao']],
  ['XIII', 'Garantia do objeto e assistência técnica', ['garantia do objeto', 'assistencia tecnica']],
  ['XIV', 'Direitos, responsabilidades, penalidades e multas', ['penalidades', 'responsabilidades']],
  ['XV', 'Condições de importação e câmbio', ['importacao', 'cambio']],
  ['XVI', 'Manutenção das condições de habilitação', ['habilitacao']],
  ['XVII', 'Reserva de cargos', ['reserva de cargos']],
  ['XVIII', 'Modelo de gestão do contrato', ['modelo de gestao', 'gestao do contrato']],
  ['XIX', 'Casos de extinção', ['extincao']],
];

/** Estrutura obrigatória dos documentos com conteúdo mínimo definido na lei. */
export const MODELOS_PADRONIZADOS: Readonly<Record<TipoModeloPadronizado, ModeloPadronizado>> = Object.freeze({
  etp: {
    tipo: 'etp',
    documento: 'Estudo Técnico Preliminar',
    fundamento: 'Lei 14.133/2021, art. 18, § 1º, I a XIII',
    secoes: INCISOS_ETP_MODELO.map(([inciso, titulo, expressoes]) => secao(inciso, titulo, `art. 18, § 1º, ${inciso}`, ...expressoes)),
  },
  matriz_riscos: {
    tipo: 'matriz_riscos',
    documento: 'Matriz de Riscos',
    fundamento: 'Lei 14.133/2021, art. 6º, XXVII, art. 22 e art. 103',
    secoes: [
      secao('eventos', 'Riscos identificados (eventos supervenientes)', 'art. 6º, XXVII, "a"', 'riscos identificados', 'eventos', 'listagem'),
      secao('alocacao', 'Alocação dos riscos entre as partes', 'art. 103, § 1º', 'alocacao'),
    ],
  },
  tr: {
    tipo: 'tr',
    documento: 'Termo de Referência',
    fundamento: 'Lei 14.133/2021, art. 6º, XXIII, alíneas a a j',
    secoes: [
      secao('a', 'Definição do objeto, quantitativos e prazo', 'art. 6º, XXIII, "a"', 'objeto'),
      secao('b', 'Fundamentação da contratação', 'art. 6º, XXIII, "b"', 'fundamentacao'),
      secao('c', 'Descrição da solução como um todo', 'art. 6º, XXIII, "c"', 'solucao'),
      secao('d', 'Requisitos da contratação', 'art. 6º, XXIII, "d"', 'requisitos'),
      secao('e', 'Modelo de execução do objeto', 'art. 6º, XXIII, "e"', 'modelo de execucao', 'execucao do objeto'),
      secao('f', 'Modelo de gestão do contrato', 'art. 6º, XXIII, "f"', 'modelo de gestao', 'gestao do contrato'),
      secao('g', 'Critérios de medição e de pagamento', 'art. 6º, XXIII, "g"', 'medicao', 'pagamento'),
      secao('h', 'Forma e critérios de seleção do fornecedor', 'art. 6º, XXIII, "h"', 'selecao'),
      secao('i', 'Estimativas do valor da contratação', 'art. 6º, XXIII, "i"', 'estimativa', 'valor'),
      secao('j', 'Adequação orçamentária', 'art. 6º, XXIII, "j"', 'orcamentari'),
    ],
  },
  edital: {
    tipo: 'edital',
    documento: 'Edital',
    fundamento: 'Lei 14.133/2021, art. 25, caput',
    secoes: [
      secao('objeto', 'Objeto da licitação', 'art. 25, caput', 'objeto'),
      secao('convocacao', 'Regras de convocação e participação', 'art. 25, caput', 'participacao', 'convocacao', 'acesso ao edital'),
      secao('julgamento', 'Julgamento', 'art. 25, caput', 'julgamento'),
      secao('habilitacao', 'Habilitação', 'art. 25, caput', 'habilitacao'),
      secao('recursos', 'Recursos', 'art. 25, caput', 'recurso'),
      secao('penalidades', 'Penalidades', 'art. 25, caput', 'sancoes', 'penalidades', 'infracoes'),
      secao('fiscalizacao', 'Fiscalização e gestão do contrato', 'art. 25, caput', 'fiscalizacao', 'gestao do contrato'),
      secao('pagamento', 'Entrega do objeto e condições de pagamento', 'art. 25, caput', 'pagamento', 'entrega'),
    ],
  },
  minuta_contrato: {
    tipo: 'minuta_contrato',
    documento: 'Minuta do Contrato',
    fundamento: 'Lei 14.133/2021, art. 92, I a XIX',
    secoes: INCISOS_MINUTA.map(([inciso, titulo, expressoes]) => secao(inciso, titulo, `art. 92, ${inciso}`, ...expressoes)),
  },
});

export interface ConferenciaEstruturaModelo {
  aplicavel: boolean;
  documento: string | null;
  fundamento: string | null;
  presentes: number;
  total: number;
  percentual: number;
  ausentes: { id: string; titulo: string; fundamento: string }[];
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

/** O tipo de documento tem estrutura obrigatória na lei. */
export function ehTipoModeloPadronizado(tipo: string): tipo is TipoModeloPadronizado {
  return Object.prototype.hasOwnProperty.call(MODELOS_PADRONIZADOS, tipo);
}

/**
 * Confere se o documento traz cada seção obrigatória do modelo padronizado, pelos títulos de seção (linhas que
 * começam com "#"). No ETP, a seção também é reconhecida pelo inciso no início do título ("## IV — …").
 */
export function conferirEstruturaModelo(tipo: string, texto: string): ConferenciaEstruturaModelo {
  if (!ehTipoModeloPadronizado(tipo)) return { aplicavel: false, documento: null, fundamento: null, presentes: 0, total: 0, percentual: 100, ausentes: [] };
  const modelo = MODELOS_PADRONIZADOS[tipo];
  const titulos = texto
    .split(/\r?\n/)
    .filter((l) => /^\s*#{1,6}\s/.test(l))
    .map((l) => normalizar(l.replace(/^\s*#+\s*/, '')));
  const presente = (s: SecaoModeloPadronizado) =>
    titulos.some((t) => (tipo === 'etp' && new RegExp(`^(inciso\\s+)?${s.id}\\s*[-—–.)]`, 'i').test(t)) || s.expressoes.some((e) => t.includes(e)));
  const ausentes = modelo.secoes.filter((s) => !presente(s)).map((s) => ({ id: s.id, titulo: s.titulo, fundamento: s.fundamento }));
  const total = modelo.secoes.length;
  const presentes = total - ausentes.length;
  return { aplicavel: true, documento: modelo.documento, fundamento: modelo.fundamento, presentes, total, percentual: Math.round((presentes / total) * 1000) / 10, ausentes };
}

/** Lista das seções obrigatórias do documento, para a ancoragem da redação por IA. */
export function roteiroModeloPadronizado(tipo: string): string[] {
  if (!ehTipoModeloPadronizado(tipo)) return [];
  return MODELOS_PADRONIZADOS[tipo].secoes.map((s) => `${s.titulo} (${s.fundamento})`);
}
