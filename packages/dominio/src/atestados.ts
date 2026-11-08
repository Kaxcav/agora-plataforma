/**
 * Leitura assistida de atestados de capacidade técnica (RIA-08; Lei 14.133/2021, art. 67).
 * Recebe o texto do atestado já separado em páginas e linhas (camada de texto do PDF ou OCR, feitos no servidor) e
 * localiza as menções de quantitativo executado (número + unidade), associando cada uma à parcela de maior relevância
 * do edital pela unidade e pelas palavras do contexto. Depois soma os quantitativos entre os atestados de um licitante
 * e compara com o mínimo exigido. O resultado é um SINAL com o trecho-fonte (página e linha) de cada número: a
 * habilitação técnica é decisão do agente de contratação, depois de conferir os documentos.
 * Determinístico e sem I/O.
 */
import { ErroDominio } from './erros.ts';
import { arredondar, formatarNumero } from './interno.ts';

export interface PaginaTexto {
  /** Número da página no documento (1..n). */
  numero: number;
  linhas: readonly string[];
}

export interface ParcelaLeitura {
  id: string;
  descricao: string;
  unidade: string;
  /** Palavras que identificam a parcela no texto, além das da descrição. */
  termos?: readonly string[];
}

export type ConfiancaMencao = 'alta' | 'media' | 'baixa';

export interface MencaoQuantitativo {
  indice: number;
  /** Parcela associada; `null` quando a unidade não corresponde a nenhuma parcela ou há empate. */
  parcelaId: string | null;
  quantidade: number;
  unidade: string;
  pagina: number;
  linha: number;
  /** Linha do documento em que o número aparece. */
  trecho: string;
  confianca: ConfiancaMencao;
  /** A linha declara um total ("total", "totalizando", "perfazendo"...). */
  linhaDeTotal: boolean;
  /** Valor por extenso entre parênteses logo após o número, quando legível. */
  quantidadePorExtenso: number | null;
  observacao: string | null;
}

export interface QuantitativoAtestado {
  parcelaId: string;
  quantidade: number;
  /** `total_declarado`: maior total declarado no atestado; `soma_mencoes`: soma das menções distintas. */
  criterio: 'total_declarado' | 'soma_mencoes';
  /** Índices das menções consideradas. */
  mencoes: number[];
  observacao: string | null;
}

export interface ExtracaoAtestado {
  mencoes: MencaoQuantitativo[];
  porParcela: QuantitativoAtestado[];
  paginas: number;
  linhas: number;
}

interface DefinicaoUnidade {
  codigo: string;
  rotulo: string;
  padrao: RegExp;
}

// Aplicados ao texto normalizado (minúsculas, sem acentos), logo após o número. Ordem: os mais específicos primeiro.
const FIM = '(?![a-z0-9])';
const UNIDADES: readonly DefinicaoUnidade[] = [
  { codigo: 'pontos_funcao', rotulo: 'pontos de função', padrao: new RegExp(`^(?:pontos?\\s+de\\s+funcao|pontos?\\s+funcao|pfs?)${FIM}`) },
  { codigo: 'ust', rotulo: 'UST', padrao: new RegExp(`^(?:usts?|unidades?\\s+de\\s+servicos?\\s+tecnicos?)${FIM}`) },
  { codigo: 'horas', rotulo: 'horas', padrao: new RegExp(`^(?:horas?(?:\\s+tecnicas?|\\s+de\\s+servicos?)?|hs?)${FIM}`) },
  { codigo: 'metros_quadrados', rotulo: 'm²', padrao: new RegExp(`^(?:m²|m2|metros?\\s+quadrados?)${FIM}`) },
  { codigo: 'metros_cubicos', rotulo: 'm³', padrao: new RegExp(`^(?:m³|m3|metros?\\s+cubicos?)${FIM}`) },
  { codigo: 'quilometros', rotulo: 'km', padrao: new RegExp(`^(?:km|quilometros?)${FIM}`) },
  { codigo: 'metros', rotulo: 'metros', padrao: new RegExp(`^(?:metros?|m)${FIM}`) },
  { codigo: 'toneladas', rotulo: 'toneladas', padrao: new RegExp(`^(?:toneladas?|ton|t)${FIM}`) },
  { codigo: 'quilogramas', rotulo: 'kg', padrao: new RegExp(`^(?:kg|quilos?|quilogramas?)${FIM}`) },
  { codigo: 'litros', rotulo: 'litros', padrao: new RegExp(`^(?:litros?|l)${FIM}`) },
  { codigo: 'licencas', rotulo: 'licenças', padrao: new RegExp(`^licencas?${FIM}`) },
  { codigo: 'usuarios', rotulo: 'usuários', padrao: new RegExp(`^usuarios?${FIM}`) },
  { codigo: 'postos', rotulo: 'postos de trabalho', padrao: new RegExp(`^postos?(?:\\s+de\\s+trabalho)?${FIM}`) },
  { codigo: 'meses', rotulo: 'meses', padrao: new RegExp(`^(?:meses|mes)${FIM}`) },
  { codigo: 'unidades', rotulo: 'unidades', padrao: new RegExp(`^(?:unidades?|unid|und|un|pecas?|itens?)${FIM}`) },
];

/** Palavras genéricas que não identificam a parcela (aparecem em quase todo atestado). */
const PALAVRAS_GENERICAS = new Set([
  'para', 'pelo', 'pela', 'pelos', 'pelas', 'sobre', 'entre', 'como', 'mais', 'menos', 'este', 'esta', 'esse', 'essa', 'cujo', 'cuja',
  'quantidade', 'quantidades', 'quantitativo', 'total', 'totais', 'unidade', 'unidades', 'objeto', 'item', 'itens', 'lote', 'fornecimento',
  'aquisicao', 'prestacao', 'servico', 'servicos', 'execucao', 'executado', 'executados', 'executada', 'contrato', 'empresa', 'atestamos',
  'atestado', 'atesta', 'realizou', 'executou', 'forneceu', 'referente', 'conforme', 'periodo', 'tipo', 'modelo', 'nivel', 'satisfatoria',
]);

const PREFIXO_IGNORADO = /(?:\bitem|\blote|\bgrupo|\bn[º°]|\bn\.|\bno\.|\bnumero|\bart\.?|\binciso|\bclausula|\bparagrafo|§|r\$|\bcnpj|\bcpf|\bcep|\bfls?\.?|\bpagina|\bpag\.?)\s*[:.]?\s*$/;
const LINHA_DE_TOTAL = /\b(?:total|totais|totaliza\w*|perfaz\w*|somando|somaram|soma de|montante)\b/;
const PALAVRA_QUANTIDADE = /\b(?:quantidades?|quantitativos?|qtde?\.?)(?:\s+(?:executad[ao]s?|fornecid[ao]s?|entregues?|realizad[ao]s?|total))?\s*(?:de|:|=|-)?\s*$/;
const NUMERO = /(?<![\d.,/])(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:[\u00a0\u202f]\d{3})+|\d+)(?:,(\d+))?(?![\d/]|[.,]\d|-\d)/g;

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Singular aproximado para comparar palavras do português ("coletes" → "colete", "cartoes" → "cartao"). */
function singular(palavra: string): string {
  if (palavra.length <= 4) return palavra;
  if (palavra.endsWith('oes') || palavra.endsWith('aes')) return `${palavra.slice(0, -3)}ao`;
  if (palavra.endsWith('eis')) return `${palavra.slice(0, -3)}el`;
  if (/(?:r|z|s)es$/.test(palavra)) return palavra.slice(0, -2);
  if (palavra.endsWith('s')) return palavra.slice(0, -1);
  return palavra;
}

function palavras(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4 && !PALAVRAS_GENERICAS.has(p) && !/^\d+$/.test(p))
    .map(singular);
}

/** Lê número em formato brasileiro ("1.200", "1.200,5", "925", "1 200" com espaço fino). */
export function lerNumeroPtBr(texto: string): number | null {
  const limpo = texto.trim().replace(/[\u00a0\u202f]/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(limpo)) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

const EXTENSO: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/** Converte um número inteiro escrito por extenso em português ("mil e duzentos" → 1200). `null` se não reconhecer. */
export function numeroPorExtenso(texto: string): number | null {
  const tokens = normalizar(texto)
    .split(/[\s-]+/)
    .filter((t) => t !== '' && t !== 'e');
  if (tokens.length === 0) return null;
  let total = 0;
  let grupo = 0;
  for (const token of tokens) {
    const valor = EXTENSO[token];
    if (valor !== undefined) {
      grupo += valor;
    } else if (token === 'mil') {
      total += (grupo === 0 ? 1 : grupo) * 1000;
      grupo = 0;
    } else if (token === 'milhao' || token === 'milhoes') {
      total += (grupo === 0 ? 1 : grupo) * 1_000_000;
      grupo = 0;
    } else {
      return null;
    }
  }
  return total + grupo;
}

/** Unidade reconhecida no início do texto normalizado, ou `null`. */
export function reconhecerUnidade(texto: string): { codigo: string; rotulo: string } | null {
  const alvo = normalizar(texto).trimStart();
  for (const u of UNIDADES) if (u.padrao.test(alvo)) return { codigo: u.codigo, rotulo: u.rotulo };
  return null;
}

interface ParcelaNormalizada {
  id: string;
  codigoUnidade: string;
  rotuloUnidade: string;
  /** Núcleos que, logo após o número, valem como unidade ("800 coletes"). */
  nucleos: Set<string>;
  palavras: Set<string>;
}

function prepararParcela(p: ParcelaLeitura): ParcelaNormalizada {
  if (typeof p.id !== 'string' || p.id === '' || typeof p.descricao !== 'string' || typeof p.unidade !== 'string') {
    throw new ErroDominio('PARCELA_INVALIDA', 'Cada parcela precisa de id, descrição e unidade.');
  }
  const unidade = reconhecerUnidade(p.unidade);
  const termos = (p.termos ?? []).flatMap((t) => palavras(t));
  const descricao = palavras(p.descricao);
  const nucleos = new Set<string>(termos);
  if (descricao[0] !== undefined) nucleos.add(descricao[0]);
  if (unidade === null) for (const u of palavras(p.unidade)) nucleos.add(u);
  return {
    id: p.id,
    codigoUnidade: unidade?.codigo ?? `livre:${palavras(p.unidade).join(' ') || normalizar(p.unidade).trim()}`,
    rotuloUnidade: unidade?.rotulo ?? p.unidade.trim(),
    nucleos,
    palavras: new Set([...descricao, ...termos]),
  };
}

/** Texto logo após o número: pula espaços e um valor por extenso entre parênteses. */
function textoSeguinte(normalizada: string, fim: number): { texto: string; extenso: number | null } {
  const resto = normalizada.slice(fim);
  const parenteses = /^\s*\(([^)]{2,120})\)/.exec(resto);
  if (parenteses) return { texto: resto.slice(parenteses[0].length).trimStart(), extenso: numeroPorExtenso(parenteses[1] ?? '') };
  return { texto: resto.trimStart(), extenso: null };
}

function ehAno(valor: number, inteiro: string): boolean {
  return /^\d{4}$/.test(inteiro) && valor >= 1900 && valor <= 2100;
}

interface Candidata {
  quantidade: number;
  unidade: { codigo: string; rotulo: string } | null;
  porNucleo: ParcelaNormalizada[];
  extenso: number | null;
}

/**
 * Localiza os quantitativos executados num atestado (RIA-08). Para cada linha, reconhece os números (formato
 * brasileiro, ignorando datas, CNPJ/CPF, valores em reais, anos e números de item/artigo) seguidos de unidade
 * ("925 pontos de função", "1.200 (mil e duzentas) unidades") ou do núcleo da parcela ("800 coletes"), ou
 * precedidos de "quantidade executada". Associa a menção à parcela pela unidade e pelas palavras da própria linha e
 * da anterior; confere o valor por extenso, quando houver. Por parcela, usa o maior total declarado no atestado ou,
 * sem total, a soma das menções distintas (valores repetidos contam uma vez).
 */
export function extrairQuantitativosAtestado(paginas: readonly PaginaTexto[], parcelas: readonly ParcelaLeitura[]): ExtracaoAtestado {
  if (!Array.isArray(paginas)) throw new ErroDominio('TEXTO_INVALIDO', 'Informe as páginas do atestado.');
  const preparadas = parcelas.map(prepararParcela);
  const mencoes: MencaoQuantitativo[] = [];
  let totalLinhas = 0;

  for (const pagina of paginas) {
    if (!Number.isInteger(pagina.numero) || pagina.numero < 1 || !Array.isArray(pagina.linhas)) {
      throw new ErroDominio('TEXTO_INVALIDO', 'Cada página precisa de número (1..n) e da lista de linhas.');
    }
    let anterior = '';
    const linhas: readonly string[] = pagina.linhas;
    linhas.forEach((original: string, indiceLinha: number) => {
      totalLinhas += 1;
      const linha = original.replace(/\s+/g, ' ').trim();
      const normalizada = normalizar(linha);
      // A unidade (ou o extenso) pode continuar na linha seguinte: "com 925 (novecentos e vinte e" / "cinco) pontos de função".
      const estendida = `${normalizada} ${normalizar((linhas[indiceLinha + 1] ?? '').replace(/\s+/g, ' ').trim())}`;
      const total = LINHA_DE_TOTAL.test(normalizada);
      const contexto: Contexto = { linha: new Set(palavras(linha)), anterior: new Set(palavras(anterior)) };
      let usouPalavraQuantidade = false;

      for (const m of normalizada.matchAll(NUMERO)) {
        const inteiro = m[1] ?? '';
        const quantidade = lerNumeroPtBr(`${inteiro}${m[2] !== undefined ? `,${m[2]}` : ''}`);
        if (quantidade === null || quantidade <= 0) continue;
        const inicio = m.index ?? 0;
        const antes = normalizada.slice(Math.max(0, inicio - 30), inicio);
        if (PREFIXO_IGNORADO.test(antes)) continue;
        const seguinte = textoSeguinte(estendida, inicio + m[0].length);
        const unidade = reconhecerUnidade(seguinte.texto);
        const primeira = singular(/^[a-z0-9]+/.exec(seguinte.texto)?.[0] ?? '');
        const porNucleo = primeira.length >= 4 ? preparadas.filter((p) => p.nucleos.has(primeira)) : [];
        let candidata: Candidata | null = null;
        if (unidade !== null || porNucleo.length > 0) {
          candidata = { quantidade, unidade, porNucleo, extenso: seguinte.extenso };
        } else if (!usouPalavraQuantidade && !ehAno(quantidade, inteiro.replace(/\D/g, '')) && PALAVRA_QUANTIDADE.test(antes)) {
          // "Quantidade executada: 400" — unidade da parcela, se o contexto indicar qual.
          usouPalavraQuantidade = true;
          candidata = { quantidade, unidade: null, porNucleo: [], extenso: seguinte.extenso };
        }
        if (candidata === null) continue;
        mencoes.push(associar(candidata, preparadas, contexto, { pagina: pagina.numero, linha: indiceLinha + 1, trecho: linha.slice(0, 300), total, indice: mencoes.length }));
      }
      anterior = linha;
    });
  }

  return { mencoes, porParcela: consolidarPorParcela(mencoes, preparadas), paginas: paginas.length, linhas: totalLinhas };
}

/** Palavras significativas da linha da menção e da linha anterior (mesma página). */
interface Contexto {
  linha: Set<string>;
  anterior: Set<string>;
}

function associar(
  c: Candidata,
  parcelas: readonly ParcelaNormalizada[],
  contexto: Contexto,
  local: { pagina: number; linha: number; trecho: string; total: boolean; indice: number },
): MencaoQuantitativo {
  const porUnidade = c.unidade === null ? [] : parcelas.filter((p) => p.codigoUnidade === c.unidade?.codigo);
  const semUnidade = c.unidade === null && c.porNucleo.length === 0 ? [...parcelas] : [];
  const candidatas = [...new Set([...porUnidade, ...c.porNucleo, ...semUnidade])];
  const pontuadas = candidatas
    .map((p) => {
      // Núcleo logo após o número vale 3; palavra da parcela na mesma linha, 2; na linha anterior, 1.
      let pontos = c.porNucleo.includes(p) ? 3 : 0;
      for (const palavra of p.palavras) pontos += contexto.linha.has(palavra) ? 2 : contexto.anterior.has(palavra) ? 1 : 0;
      return { p, pontos };
    })
    .sort((a, b) => b.pontos - a.pontos);
  const melhor = pontuadas[0];
  const segunda = pontuadas[1];
  let parcela: ParcelaNormalizada | null = null;
  let confianca: ConfiancaMencao = 'baixa';
  let observacao: string | null = null;
  if (melhor === undefined) {
    observacao = 'Unidade sem parcela correspondente nas exigências do edital.';
  } else if (segunda !== undefined && segunda.pontos === melhor.pontos) {
    observacao = 'Mais de uma parcela possível: associe manualmente ao conferir.';
  } else if (c.unidade === null && c.porNucleo.length === 0 && melhor.pontos === 0) {
    observacao = 'Quantidade sem unidade e sem palavras da parcela na linha.';
  } else {
    parcela = melhor.p;
    const comUnidade = c.unidade !== null || c.porNucleo.length > 0;
    confianca = melhor.pontos >= (comUnidade ? 1 : 3) ? 'alta' : 'media';
  }
  if (c.extenso !== null && c.extenso !== c.quantidade) {
    confianca = 'baixa';
    observacao = `O valor por extenso (${formatarNumero(c.extenso)}) diverge do valor em algarismos; confira o documento.`;
  }
  return {
    indice: local.indice,
    parcelaId: parcela?.id ?? null,
    quantidade: c.quantidade,
    unidade: c.unidade?.rotulo ?? parcela?.rotuloUnidade ?? c.porNucleo[0]?.rotuloUnidade ?? '',
    pagina: local.pagina,
    linha: local.linha,
    trecho: local.trecho,
    confianca,
    linhaDeTotal: local.total,
    quantidadePorExtenso: c.extenso,
    observacao,
  };
}

function consolidarPorParcela(mencoes: readonly MencaoQuantitativo[], parcelas: readonly ParcelaNormalizada[]): QuantitativoAtestado[] {
  const resultado: QuantitativoAtestado[] = [];
  for (const p of parcelas) {
    const daParcela = mencoes.filter((m) => m.parcelaId === p.id);
    if (daParcela.length === 0) continue;
    const totais = daParcela.filter((m) => m.linhaDeTotal);
    if (totais.length > 0) {
      const maior = totais.reduce((a, b) => (b.quantidade > a.quantidade ? b : a));
      resultado.push({
        parcelaId: p.id,
        quantidade: maior.quantidade,
        criterio: 'total_declarado',
        mencoes: [maior.indice],
        observacao: daParcela.length > 1 ? `Usado o total declarado na página ${maior.pagina}, linha ${maior.linha}; as demais menções não foram somadas.` : null,
      });
      continue;
    }
    const vistos = new Set<number>();
    const distintas = daParcela.filter((m) => {
      if (vistos.has(m.quantidade)) return false;
      vistos.add(m.quantidade);
      return true;
    });
    resultado.push({
      parcelaId: p.id,
      quantidade: arredondar(
        distintas.reduce((s, m) => s + m.quantidade, 0),
        6,
      ),
      criterio: 'soma_mencoes',
      mencoes: distintas.map((m) => m.indice),
      observacao:
        daParcela.length > 1
          ? `${daParcela.length} menções nesta parcela${distintas.length < daParcela.length ? '; valores repetidos contados uma vez' : ''}. Confira se não há repetição.`
          : null,
    });
  }
  return resultado;
}

export interface ParcelaExigida {
  id: string;
  descricao: string;
  unidade: string;
  quantidadeMinima: number;
}

export interface AtestadoLido {
  id: string;
  titulo: string;
  extracao: ExtracaoAtestado;
}

export type SinalHabilitacaoTecnica = 'indica_atendimento' | 'indica_insuficiencia' | 'inconclusivo';

export interface SomaParcela {
  parcelaId: string;
  descricao: string;
  unidade: string;
  exigido: number;
  somado: number;
  /** `null` sem atestado lido. */
  atende: boolean | null;
  contribuicoes: { atestadoId: string; titulo: string; quantidade: number; criterio: QuantitativoAtestado['criterio']; evidencias: MencaoQuantitativo[]; observacao: string | null }[];
}

export const AVISO_LEITURA_ASSISTIDA =
  'Sinal da leitura assistida (RIA-08) — requer revisão humana. Confira cada número no trecho-fonte do atestado: a habilitação técnica é decisão do agente de contratação (Lei 14.133/2021, art. 67).';

/**
 * Soma, por parcela, os quantitativos lidos nos atestados de um mesmo licitante e compara com o mínimo exigido no
 * edital (art. 67, §§ 1º e 2º). Os atestados podem ser somados entre si; cada contribuição traz as evidências
 * (página, linha e trecho). Devolve um sinal — `indica_atendimento`, `indica_insuficiencia` ou `inconclusivo` (sem
 * atestado lido) — com premissas e aviso de revisão humana; nunca uma decisão de habilitação.
 */
export function somarQuantitativosAtestados(e: { parcelas: readonly ParcelaExigida[]; atestados: readonly AtestadoLido[] }): {
  parcelas: SomaParcela[];
  sinal: SinalHabilitacaoTecnica;
  mensagem: string;
  premissas: string[];
  fundamento: string;
  aviso: string;
} {
  const parcelas = e.parcelas.map((p): SomaParcela => {
    if (typeof p.quantidadeMinima !== 'number' || !Number.isFinite(p.quantidadeMinima) || p.quantidadeMinima <= 0) {
      throw new ErroDominio('PARCELA_INVALIDA', `Quantidade mínima inválida na parcela "${p.descricao}".`);
    }
    const contribuicoes = e.atestados.flatMap((a) => {
      const q = a.extracao.porParcela.find((x) => x.parcelaId === p.id);
      if (!q) return [];
      return [
        {
          atestadoId: a.id,
          titulo: a.titulo,
          quantidade: q.quantidade,
          criterio: q.criterio,
          evidencias: q.mencoes.map((i) => a.extracao.mencoes[i]).filter((m): m is MencaoQuantitativo => m !== undefined),
          observacao: q.observacao,
        },
      ];
    });
    const somado = arredondar(
      contribuicoes.reduce((s, c) => s + c.quantidade, 0),
      6,
    );
    return {
      parcelaId: p.id,
      descricao: p.descricao,
      unidade: p.unidade,
      exigido: p.quantidadeMinima,
      somado,
      atende: e.atestados.length === 0 ? null : somado >= p.quantidadeMinima,
      contribuicoes,
    };
  });

  let sinal: SinalHabilitacaoTecnica;
  let mensagem: string;
  if (e.atestados.length === 0 || parcelas.length === 0) {
    sinal = 'inconclusivo';
    mensagem = parcelas.length === 0 ? 'O edital não tem parcelas de maior relevância definidas para comparar.' : 'Nenhum atestado lido para este licitante.';
  } else if (parcelas.every((p) => p.atende === true)) {
    sinal = 'indica_atendimento';
    mensagem = `Os quantitativos lidos em ${e.atestados.length} atestado(s) alcançam o mínimo exigido em todas as parcelas.`;
  } else {
    sinal = 'indica_insuficiencia';
    const faltam = parcelas.filter((p) => p.atende === false);
    mensagem = `Quantitativo lido abaixo do mínimo em ${faltam.length} parcela(s): ${faltam
      .map((p) => `${p.descricao} (${formatarNumero(p.somado)} de ${formatarNumero(p.exigido)} ${p.unidade})`)
      .join('; ')}.`;
  }

  return {
    parcelas,
    sinal,
    mensagem,
    premissas: [
      'Os quantitativos de atestados diferentes do mesmo licitante são somados (o edital não veda o somatório).',
      'Em cada atestado vale o maior total declarado; sem total, somam-se as menções distintas da parcela.',
      'A associação à parcela usa a unidade e as palavras da linha e da linha anterior; menções sem parcela não entram na soma.',
      'O texto vem da camada de texto do PDF ou do reconhecimento óptico (OCR), que pode errar dígitos: confira cada trecho-fonte.',
    ],
    fundamento: 'Lei 14.133/2021, art. 67, caput, II, e §§ 1º e 2º',
    aviso: AVISO_LEITURA_ASSISTIDA,
  };
}
