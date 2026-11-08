/**
 * Lições aprendidas da execução (RIA-12): base de conhecimento com ocorrências, glosas, atrasos, aditivos, rescisões,
 * sanções e avaliações de desempenho dos contratos, agrupada por objeto ou catálogo, e sugestão de cláusulas mais
 * rigorosas no DFD, no ETP e no TR de objeto semelhante.
 *
 * É sinal, não decisão: cada sugestão traz as fontes (quais contratos e fatos), as premissas, a data e
 * "requer revisão humana". O agente aceita ou recusa, e só o que ele aceita entra no rascunho do documento.
 * Fundamento: Lei 14.133/2021, art. 11 (objetivos do processo), art. 18 (planejamento), art. 117 (registro das
 * ocorrências pela fiscalização) e art. 169 (gestão de riscos e controle preventivo).
 */
import { ErroDominio } from '../erros.ts';
import { formatarData, type DataISO } from '../datas.ts';
import { arredondar, formatarNumero, lerData } from '../interno.ts';
import type { IncisoInfracao, TipoSancao } from './sancoes.ts';

export type TipoFatoExecucao = 'ocorrencia' | 'glosa' | 'atraso' | 'rescisao' | 'aditivo' | 'sancao' | 'avaliacao';
export type CategoriaLicao = 'prazo' | 'qualidade' | 'nivel_servico' | 'garantia' | 'quantitativo' | 'fiscalizacao';
export type DocumentoLicao = 'dfd' | 'etp' | 'tr';

/** Percentual de acréscimo, sobre o valor inicial, a partir do qual o aditivo vira lição de quantitativo. */
export const PERCENTUAL_ADITIVO_LICAO = 15;
/** Nota de avaliação de desempenho abaixo da qual a avaliação vira lição de fiscalização. */
export const NOTA_AVALIACAO_LICAO = 60;
/** Índice mínimo de semelhança textual entre o objeto pretendido e o objeto do contrato. */
export const SEMELHANCA_MINIMA_OBJETO = 0.5;

const AVISO_LICAO =
  'Sinal gerado a partir do histórico de execução — requer revisão humana. A sugestão não altera o documento sozinha: o agente decide se a considera, e a decisão fica registrada.';

export interface ItemObjeto {
  catmat: string | null;
  descricao: string;
}

/** Contrato da base de conhecimento, com o objeto e os itens (com o código do catálogo, quando houver). */
export interface ContratoBaseConhecimento {
  id: string;
  numero: string;
  objeto: string;
  itens: readonly ItemObjeto[];
}

/** Fato da execução que pode virar lição. */
export interface FatoExecucao {
  id: string;
  contratoId: string;
  tipo: TipoFatoExecucao;
  categoria: CategoriaLicao;
  data: DataISO;
  descricao: string;
}

// ───────────────────────── fatos derivados ─────────────────────────

/** Categoria padrão de cada tipo de fato registrado pela fiscalização. */
export function categoriaPadraoFato(tipo: TipoFatoExecucao): CategoriaLicao {
  switch (tipo) {
    case 'atraso':
      return 'prazo';
    case 'glosa':
      return 'nivel_servico';
    case 'rescisao':
      return 'garantia';
    case 'aditivo':
      return 'quantitativo';
    case 'ocorrencia':
      return 'qualidade';
    case 'sancao':
    case 'avaliacao':
      return 'fiscalizacao';
    default:
      throw new ErroDominio('FATO_EXECUCAO_INVALIDO', `Tipo de fato inválido: ${String(tipo)}.`);
  }
}

const CATEGORIA_INCISO: Partial<Record<IncisoInfracao, CategoriaLicao>> = { I: 'garantia', II: 'garantia', III: 'garantia', VII: 'prazo' };

/**
 * Fatos derivados do que já está registrado na Ágora, sem digitação nova: aditivo de acréscimo acima de 15% do valor
 * inicial (quantitativo mal estimado), sanção aplicada no contrato (inexecução → garantia; retardamento → prazo; demais →
 * fiscalização; art. 155), avaliação definitiva com nota abaixo de 60 (fiscalização) e rescisão assinada (extinção do
 * contrato, arts. 137 a 139 → garantia).
 */
export function derivarFatosExecucao(e: {
  contratoId: string;
  valorInicial: number;
  aditivos: readonly { id: string; tipo: string; valor: number; assinadoEm: DataISO; justificativa: string }[];
  sancoes: readonly { id: string; tipo: TipoSancao; incisoInfracao: IncisoInfracao; aplicadaEm: DataISO; relato: string }[];
  avaliacoes: readonly { id: string; nota: number; periodoFim: DataISO; definitiva: boolean }[];
  rescisoes?: readonly { id: string; assinadaEm: DataISO; justificativa: string }[];
}): FatoExecucao[] {
  const fatos: FatoExecucao[] = [];
  for (const r of e.rescisoes ?? []) {
    fatos.push({
      id: `rescisao:${r.id}`,
      contratoId: e.contratoId,
      tipo: 'rescisao',
      categoria: 'garantia',
      data: r.assinadaEm,
      descricao: `Contrato extinto por rescisão: ${r.justificativa.trim().slice(0, 160)}`,
    });
  }
  for (const a of e.aditivos) {
    if (a.tipo !== 'acrescimo' || e.valorInicial <= 0) continue;
    const percentual = (100 * a.valor) / e.valorInicial;
    if (percentual <= PERCENTUAL_ADITIVO_LICAO) continue;
    fatos.push({
      id: `aditivo:${a.id}`,
      contratoId: e.contratoId,
      tipo: 'aditivo',
      categoria: 'quantitativo',
      data: a.assinadoEm,
      descricao: `Acréscimo de ${formatarNumero(arredondar(percentual, 1))}% do valor inicial por termo aditivo: a quantidade estimada não bastou.`,
    });
  }
  for (const s of e.sancoes) {
    fatos.push({
      id: `sancao:${s.id}`,
      contratoId: e.contratoId,
      tipo: 'sancao',
      categoria: CATEGORIA_INCISO[s.incisoInfracao] ?? 'fiscalizacao',
      data: s.aplicadaEm,
      descricao: `Sanção aplicada (art. 155, ${s.incisoInfracao}): ${s.relato.trim().slice(0, 160)}`,
    });
  }
  for (const a of e.avaliacoes) {
    if (!a.definitiva || a.nota >= NOTA_AVALIACAO_LICAO) continue;
    fatos.push({
      id: `avaliacao:${a.id}`,
      contratoId: e.contratoId,
      tipo: 'avaliacao',
      categoria: 'fiscalizacao',
      data: a.periodoFim,
      descricao: `Avaliação de desempenho com nota ${formatarNumero(a.nota)}, abaixo de ${NOTA_AVALIACAO_LICAO}.`,
    });
  }
  return fatos;
}

// ───────────────────────── semelhança de objeto ─────────────────────────

const PALAVRAS_VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'por', 'pela', 'pelo', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'ao', 'aos',
  'que', 'sua', 'seu', 'tipo', 'modelo', 'unidade', 'aquisicao', 'contratacao', 'prestacao', 'servico', 'fornecimento', 'material', 'lote',
  'regional', 'cota', 'principal', 'reservada', 'item', 'iten', 'conjunto', 'kit', 'uso', 'operacao', 'operacional', 'apoio', 'demais',
  'norte', 'sul', 'leste', 'oeste', 'centro', 'nordeste', 'sudeste', 'tamanho', 'cor', 'preta', 'preto', 'branco', 'branca',
]);

/** Radical simples do português (plurais comuns), para comparar "coletes balísticos" com "colete balístico". */
function radical(t: string): string {
  if (t.length > 4 && t.endsWith('oes')) return `${t.slice(0, -3)}ao`;
  if (t.length > 4 && t.endsWith('aes')) return `${t.slice(0, -3)}ao`;
  if (t.length > 4 && t.endsWith('ais')) return `${t.slice(0, -3)}al`;
  if (t.length > 4 && t.endsWith('eis')) return `${t.slice(0, -3)}el`;
  if (t.length > 4 && /(res|zes|ses)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/** Termos distintivos de um texto: minúsculas, sem acentos, sem palavras vazias, no radical. */
export function termosObjeto(texto: string): string[] {
  const limpo = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const termos = new Set<string>();
  for (const bruto of limpo.split(/[^a-z0-9]+/)) {
    if (bruto.length < 3 || /^\d+$/.test(bruto)) continue;
    const r = radical(bruto);
    if (!PALAVRAS_VAZIAS.has(r) && !PALAVRAS_VAZIAS.has(bruto)) termos.add(r);
  }
  return [...termos].sort();
}

/**
 * Semelhança entre o objeto pretendido (título e itens do DFD) e o de um contrato: 1 quando algum item tem o mesmo
 * código do catálogo (CATMAT/CATSER); senão, a fração dos termos em comum sobre o menor conjunto, exigidos ao menos
 * dois termos em comum. Determinística e explicável: devolve o motivo e os termos.
 */
export function semelhancaObjeto(
  pretendido: { descricao: string; itens: readonly ItemObjeto[] },
  contrato: Pick<ContratoBaseConhecimento, 'objeto' | 'itens'>,
): { indice: number; motivo: 'catalogo' | 'texto' | null; termos: string[] } {
  const codigos = new Set(pretendido.itens.map((i) => i.catmat?.trim()).filter((c): c is string => typeof c === 'string' && c.length > 0));
  const mesmoCodigo = contrato.itens.find((i) => i.catmat && codigos.has(i.catmat.trim()));
  if (mesmoCodigo?.catmat) return { indice: 1, motivo: 'catalogo', termos: [`código ${mesmoCodigo.catmat.trim()}`] };
  const a = new Set(termosObjeto([pretendido.descricao, ...pretendido.itens.map((i) => i.descricao)].join(' ')));
  const b = new Set(termosObjeto([contrato.objeto, ...contrato.itens.map((i) => i.descricao)].join(' ')));
  if (a.size === 0 || b.size === 0) return { indice: 0, motivo: null, termos: [] };
  const comuns = [...a].filter((t) => b.has(t)).sort();
  if (comuns.length < 2) return { indice: 0, motivo: null, termos: comuns };
  const indice = arredondar(comuns.length / Math.min(a.size, b.size), 2);
  return { indice, motivo: indice >= SEMELHANCA_MINIMA_OBJETO ? 'texto' : null, termos: comuns };
}

// ───────────────────────── sugestões ─────────────────────────

interface ModeloClausula {
  titulo: string;
  clausula: string;
  fundamento: string;
}

const ROTULO_CATEGORIA: Record<CategoriaLicao, string> = {
  prazo: 'Prazos de entrega',
  qualidade: 'Qualidade do objeto',
  nivel_servico: 'Níveis de serviço',
  garantia: 'Garantia e inexecução',
  quantitativo: 'Quantidades estimadas',
  fiscalizacao: 'Gestão e fiscalização',
};

/** Rótulo da categoria de lição. */
export function rotuloCategoriaLicao(c: CategoriaLicao): string {
  return ROTULO_CATEGORIA[c];
}

const CLAUSULAS: Record<CategoriaLicao, Partial<Record<DocumentoLicao, ModeloClausula>>> = {
  prazo: {
    dfd: {
      titulo: 'Antecipar a demanda: houve atrasos de entrega',
      clausula: 'Considerar na data pretendida da contratação os atrasos de entrega registrados em contratos anteriores do mesmo objeto, com margem para o recebimento provisório e o definitivo.',
      fundamento: 'Lei 14.133/2021, art. 18, caput (planejamento) e art. 117 (registro das ocorrências)',
    },
    etp: {
      titulo: 'Prazo de entrega compatível com o praticado',
      clausula: 'Definir nos requisitos da contratação um prazo de entrega compatível com o efetivamente cumprido nos contratos anteriores, com cronograma de entregas parciais quando o volume justificar.',
      fundamento: 'Lei 14.133/2021, art. 18, § 1º, III',
    },
    tr: {
      titulo: 'Cronograma com marcos e multa moratória expressa',
      clausula: 'Fixar cronograma de entrega com marcos parciais e prazo de recebimento provisório, e prever multa moratória diária com teto, para atraso injustificado.',
      fundamento: 'Lei 14.133/2021, art. 92, VII, e art. 162',
    },
  },
  qualidade: {
    dfd: {
      titulo: 'Especificar a qualidade: houve falhas no objeto',
      clausula: 'Descrever na demanda os requisitos mínimos de qualidade, considerando as falhas registradas em contratos anteriores do mesmo objeto.',
      fundamento: 'Lei 14.133/2021, art. 18, caput, e art. 40, § 1º, I',
    },
    etp: {
      titulo: 'Requisitos de qualidade e normas técnicas',
      clausula: 'Detalhar os requisitos de qualidade e as normas técnicas aplicáveis ao objeto, à luz das falhas registradas nos contratos anteriores.',
      fundamento: 'Lei 14.133/2021, art. 18, § 1º, III',
    },
    tr: {
      titulo: 'Amostra ou prova de conceito e critérios de aceitação',
      clausula: 'Exigir amostra ou prova de conceito do item ofertado, com critérios objetivos de aceitação, e detalhar os ensaios e a conferência do recebimento definitivo.',
      fundamento: 'Lei 14.133/2021, art. 17, § 3º, art. 41, II, e art. 140',
    },
  },
  nivel_servico: {
    etp: {
      titulo: 'Medição por resultado',
      clausula: 'Avaliar no ETP a medição do serviço por níveis mínimos de serviço, dadas as glosas aplicadas nos contratos anteriores.',
      fundamento: 'Lei 14.133/2021, art. 18, § 1º, III, e art. 144',
    },
    tr: {
      titulo: 'Instrumento de medição de resultado (níveis de serviço)',
      clausula: 'Prever instrumento de medição de resultado com indicadores, metas mínimas e faixas de ajuste do pagamento, com a forma de registro das glosas.',
      fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "g", e art. 144',
    },
  },
  garantia: {
    etp: {
      titulo: 'Risco de inexecução na matriz de riscos',
      clausula: 'Registrar na matriz de riscos o risco de inexecução observado nos contratos anteriores, com a alocação e as medidas de mitigação.',
      fundamento: 'Lei 14.133/2021, art. 18, X, e art. 22',
    },
    tr: {
      titulo: 'Garantia de execução proporcional ao risco',
      clausula: 'Exigir garantia de execução de até 5% do valor inicial, majorável até 10% com justificativa da complexidade técnica e dos riscos, dado o histórico de inexecução.',
      fundamento: 'Lei 14.133/2021, arts. 96 e 98',
    },
  },
  quantitativo: {
    dfd: {
      titulo: 'Rever as quantidades: houve acréscimos',
      clausula: 'Rever a quantidade pedida com o consumo real dos contratos anteriores do mesmo objeto, que precisaram de acréscimo por termo aditivo.',
      fundamento: 'Lei 14.133/2021, art. 18, caput, e art. 40, III',
    },
    etp: {
      titulo: 'Memória de cálculo com o consumo real',
      clausula: 'Estimar as quantidades com memória de cálculo baseada no consumo efetivo dos contratos anteriores, incluídos os acréscimos por termo aditivo.',
      fundamento: 'Lei 14.133/2021, art. 18, § 1º, IV',
    },
  },
  fiscalizacao: {
    etp: {
      titulo: 'Modelo de gestão com fiscalização reforçada',
      clausula: 'Prever no ETP fiscal técnico e administrativo e a rotina de registro das ocorrências, dado o histórico de sanções ou de desempenho baixo.',
      fundamento: 'Lei 14.133/2021, art. 18, § 1º, e art. 117',
    },
    tr: {
      titulo: 'Modelo de gestão do contrato',
      clausula: 'Detalhar o modelo de gestão: designação de fiscais técnico e administrativo, registro das ocorrências, prazos de correção e avaliação de desempenho ao final de cada etapa.',
      fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "f", art. 88, § 3º, e art. 117',
    },
  },
};

export interface FonteLicao {
  contratoId: string;
  numero: string;
  objeto: string;
  motivo: string;
  fatos: { tipo: TipoFatoExecucao; data: DataISO; descricao: string }[];
}

export interface SugestaoLicao {
  chave: string;
  regra: 'RIA-12';
  documento: DocumentoLicao;
  categoria: CategoriaLicao;
  rotuloCategoria: string;
  titulo: string;
  clausula: string;
  fundamento: string;
  ocorrencias: number;
  fontes: FonteLicao[];
  premissas: string[];
  geradoEm: DataISO;
  aviso: string;
}

const ORDEM_CATEGORIAS: readonly CategoriaLicao[] = ['prazo', 'qualidade', 'nivel_servico', 'garantia', 'quantitativo', 'fiscalizacao'];
const MAXIMO_FONTES = 5;

/**
 * Sugestões de cláusula para o DFD, o ETP ou o TR de objeto semelhante (RIA-12): reúne os fatos da execução dos
 * contratos semelhantes (mesmo código do catálogo ou objeto parecido), por categoria, e devolve uma sugestão por
 * categoria com cláusula prevista para o documento, com as fontes (contratos e fatos), as premissas e o aviso
 * "requer revisão humana". Determinística: a ordem segue a categoria e, nas fontes, o número de fatos e o contrato.
 */
export function sugerirClausulasLicoes(
  pretendido: { descricao: string; itens: readonly ItemObjeto[] },
  contratos: readonly ContratoBaseConhecimento[],
  fatos: readonly FatoExecucao[],
  documento: DocumentoLicao,
  hoje: DataISO,
): SugestaoLicao[] {
  if (documento !== 'dfd' && documento !== 'etp' && documento !== 'tr') throw new ErroDominio('LICAO_INVALIDA', `Documento inválido: ${String(documento)}.`);
  lerData(hoje, 'hoje');
  const semelhantes = new Map<string, { contrato: ContratoBaseConhecimento; motivo: string }>();
  for (const c of contratos) {
    const s = semelhancaObjeto(pretendido, c);
    if (s.motivo === null) continue;
    const motivo =
      s.motivo === 'catalogo'
        ? `mesmo código do catálogo (${s.termos.join(', ').replace('código ', '')})`
        : `objeto semelhante (${formatarNumero(arredondar(s.indice * 100, 0))}% dos termos em comum: ${s.termos.slice(0, 5).join(', ')})`;
    semelhantes.set(c.id, { contrato: c, motivo });
  }
  const sugestoes: SugestaoLicao[] = [];
  for (const categoria of ORDEM_CATEGORIAS) {
    const modelo = CLAUSULAS[categoria][documento];
    if (!modelo) continue;
    const doCategoria = fatos.filter((f) => f.categoria === categoria && semelhantes.has(f.contratoId) && lerData(f.data, 'data') <= lerData(hoje, 'hoje'));
    if (doCategoria.length === 0) continue;
    const porContrato = new Map<string, FatoExecucao[]>();
    for (const f of doCategoria) porContrato.set(f.contratoId, [...(porContrato.get(f.contratoId) ?? []), f]);
    const fontes: FonteLicao[] = [...porContrato.entries()]
      .map(([contratoId, lista]) => {
        const ref = semelhantes.get(contratoId);
        return {
          contratoId,
          numero: ref?.contrato.numero ?? contratoId,
          objeto: ref?.contrato.objeto ?? '',
          motivo: ref?.motivo ?? '',
          fatos: [...lista]
            .sort((x, y) => (x.data < y.data ? 1 : x.data > y.data ? -1 : x.id < y.id ? -1 : 1))
            .map((f) => ({ tipo: f.tipo, data: f.data, descricao: f.descricao })),
        };
      })
      .sort((x, y) => y.fatos.length - x.fatos.length || (x.numero < y.numero ? -1 : x.numero > y.numero ? 1 : 0))
      .slice(0, MAXIMO_FONTES);
    sugestoes.push({
      chave: `${documento}:${categoria}`,
      regra: 'RIA-12',
      documento,
      categoria,
      rotuloCategoria: ROTULO_CATEGORIA[categoria],
      titulo: modelo.titulo,
      clausula: modelo.clausula,
      fundamento: modelo.fundamento,
      ocorrencias: doCategoria.length,
      fontes,
      premissas: [
        `${doCategoria.length} fato(s) de "${ROTULO_CATEGORIA[categoria].toLowerCase()}" em ${porContrato.size} contrato(s) semelhante(s) ao objeto pretendido.`,
        'Semelhança pelo código do catálogo ou pelos termos do objeto e dos itens; confira se os contratos de origem são de fato comparáveis.',
        `Base de conhecimento consultada em ${formatarData(hoje)}.`,
      ],
      geradoEm: hoje,
      aviso: AVISO_LICAO,
    });
  }
  return sugestoes;
}

export interface LicaoAceita {
  titulo: string;
  clausula: string;
  fundamento: string;
  contratos: readonly string[];
  decididaPor: string;
  decididaEm: DataISO;
}

/**
 * Seção do rascunho com as lições aceitas pelo agente (só as aceitas entram), com a cláusula, o fundamento, os
 * contratos de origem e quem decidiu. Devolve também premissas e fontes para o documento.
 */
export function secaoLicoesAceitas(aceitas: readonly LicaoAceita[]): { corpo: string; premissas: string[]; fontes: string[] } | null {
  if (aceitas.length === 0) return null;
  const corpo = [
    '## Lições aprendidas consideradas (RIA-12)',
    '',
    'Cláusulas sugeridas pela base de conhecimento da execução e aceitas pelo agente responsável:',
    '',
    ...aceitas.map(
      (l, i) =>
        `${i + 1}. **${l.titulo}.** ${l.clausula} (${l.fundamento}). Origem: contrato(s) ${l.contratos.join(', ')}. Aceita por ${l.decididaPor} em ${formatarData(l.decididaEm)}.`,
    ),
  ].join('\n');
  return {
    corpo,
    premissas: [`${aceitas.length} lição(ões) aprendida(s) da execução de contratos anteriores aceita(s) pelo agente (RIA-12).`],
    fontes: ['Lei 14.133/2021, art. 18 e art. 117 (lições aprendidas da execução)'],
  };
}
