/**
 * Planejamento das contratações (F10, F19 e F5).
 *
 * - **Plano de contratações anual (PCA)** — Lei 14.133/2021, art. 12, VII e § 1º; Decreto 10.947/2022: as unidades
 *   registram as demandas (item, quantidade, valor estimado, data desejada e grau de prioridade, art. 8º); o setor de
 *   contratações agrega as de mesma natureza (art. 11); a autoridade competente aprova (art. 12) e o plano aprovado é
 *   divulgado no PNCP (art. 12, § 2º, e art. 14).
 * - **Conferência do DFD com o PCA** — art. 18, § 1º, II: a fase preparatória demonstra a previsão da contratação no
 *   PCA, "sempre que elaborado"; a demanda fora do plano exige justificativa e a revisão do plano (Decreto, arts. 16 e 17).
 * - **Catálogo CATMAT/CATSER** — art. 19, II e § 2º: sugestão do código por semelhança determinística do texto (RIA-13).
 *   É sinal: quem escolhe o código é o agente.
 * - **Intenção de registro de preços (IRP)** — art. 86 e Decreto 11.462/2023, art. 9º: procedimento público aberto por
 *   pelo menos 8 dias úteis para a adesão de outros órgãos e a estimativa total das quantidades (RN-38).
 *
 * Funções puras: "hoje" e o calendário entram como parâmetros.
 */
import { adicionarDiasUteis, diasUteisEntre, formatarData, validarDataISO, type DataISO, type OpcoesCalendario } from '../datas.ts';
import { ErroDominio } from '../erros.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';

// ───────────────────────── PCA ─────────────────────────

export type PrioridadePca = 'baixa' | 'media' | 'alta';

/** Categorias do item do plano (tabela 5.16 do Manual de Integração PNCP). */
export type CategoriaItemPca =
  | 'material'
  | 'servico'
  | 'obras'
  | 'servicos_engenharia'
  | 'solucoes_tic'
  | 'locacao_imoveis'
  | 'alienacao_concessao_permissao'
  | 'obras_servicos_engenharia';

export const CATEGORIAS_ITEM_PCA: Readonly<Record<CategoriaItemPca, { codigoPncp: number; rotulo: string }>> = Object.freeze({
  material: { codigoPncp: 1, rotulo: 'Material' },
  servico: { codigoPncp: 2, rotulo: 'Serviço' },
  obras: { codigoPncp: 3, rotulo: 'Obras' },
  servicos_engenharia: { codigoPncp: 4, rotulo: 'Serviços de engenharia' },
  solucoes_tic: { codigoPncp: 5, rotulo: 'Soluções de TIC' },
  locacao_imoveis: { codigoPncp: 6, rotulo: 'Locação de imóveis' },
  alienacao_concessao_permissao: { codigoPncp: 7, rotulo: 'Alienação, concessão ou permissão' },
  obras_servicos_engenharia: { codigoPncp: 8, rotulo: 'Obras e serviços de engenharia' },
});

const ORDEM_PRIORIDADE: Readonly<Record<PrioridadePca, number>> = Object.freeze({ alta: 0, media: 1, baixa: 2 });

export type SituacaoPca = 'em_elaboracao' | 'consolidado' | 'aprovado' | 'publicado';
export type AcaoPca = 'consolidar' | 'devolver' | 'aprovar' | 'publicar';
export type TipoCatalogo = 'material' | 'servico';

/** Demanda de uma unidade requisitante para o plano (Decreto 10.947/2022, art. 8º). */
export interface DemandaPca {
  id: string;
  unidadeRequisitante: string;
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: TipoCatalogo | null;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: Centavos;
  dataDesejada: DataISO;
  prioridade: PrioridadePca;
  categoria: CategoriaItemPca;
}

export interface ItemConsolidadoPca {
  numero: number;
  /** Demandas agregadas neste item, na ordem de entrada. */
  demandas: string[];
  unidadesRequisitantes: string[];
  descricao: string;
  codigoCatalogo: string | null;
  tipoCatalogo: TipoCatalogo | null;
  unidadeFornecimento: string;
  categoria: CategoriaItemPca;
  quantidade: number;
  valorUnitario: Centavos;
  valorTotal: Centavos;
  /** A mais cedo entre as demandas agregadas. */
  dataDesejada: DataISO;
  /** A mais alta entre as demandas agregadas. */
  prioridade: PrioridadePca;
}

const FUNDAMENTO_PCA = 'Lei 14.133/2021, art. 12, VII e § 1º; Decreto 10.947/2022, arts. 8º, 11 e 12';
const CODIGO_CATALOGO = /^\d{1,9}$/;

function ehPrioridade(v: unknown): v is PrioridadePca {
  return v === 'baixa' || v === 'media' || v === 'alta';
}

function ehCategoria(v: unknown): v is CategoriaItemPca {
  return typeof v === 'string' && Object.hasOwn(CATEGORIAS_ITEM_PCA, v);
}

/**
 * Pendências de uma demanda para o PCA do exercício `ano` (Decreto 10.947/2022, art. 8º): descrição sucinta do objeto,
 * quantidade, estimativa preliminar do valor, data desejada dentro do exercício, grau de prioridade e área requisitante.
 * Lista vazia = demanda completa.
 */
export function validarDemandaPca(d: DemandaPca, ano: number): string[] {
  if (!Number.isInteger(ano) || ano < 2021 || ano > 2999) throw new ErroDominio('ANO_PCA_INVALIDO', `Ano do PCA inválido: ${String(ano)}.`);
  const pendencias: string[] = [];
  if ((d.descricao ?? '').trim().length < 10) pendencias.push('Descreva o objeto da demanda com pelo menos 10 caracteres.');
  if ((d.unidadeRequisitante ?? '').trim() === '') pendencias.push('Informe a unidade requisitante.');
  if ((d.unidadeFornecimento ?? '').trim() === '') pendencias.push('Informe a unidade de fornecimento.');
  if (!Number.isFinite(d.quantidade) || d.quantidade <= 0) pendencias.push('A quantidade deve ser maior que zero.');
  if (!Number.isInteger(d.valorUnitario) || d.valorUnitario <= 0) pendencias.push('O valor unitário estimado deve ser maior que zero.');
  if (!validarDataISO(d.dataDesejada)) pendencias.push('Informe a data desejada para a contratação.');
  else if (Number(d.dataDesejada.slice(0, 4)) !== ano) pendencias.push(`A data desejada deve estar dentro do exercício de ${ano}.`);
  if (!ehPrioridade(d.prioridade)) pendencias.push('Informe o grau de prioridade: baixo, médio ou alto.');
  if (!ehCategoria(d.categoria)) pendencias.push('Informe a categoria do item do plano.');
  if (d.codigoCatalogo !== null) {
    if (!CODIGO_CATALOGO.test(d.codigoCatalogo)) pendencias.push('O código do catálogo deve ter só dígitos (até 9).');
    if (d.tipoCatalogo !== 'material' && d.tipoCatalogo !== 'servico') pendencias.push('Indique se o código do catálogo é de material (CATMAT) ou de serviço (CATSER).');
  }
  return pendencias;
}

function normalizarUnidade(u: string): string {
  return u.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Consolidação do PCA (Decreto 10.947/2022, art. 11): agrega as demandas de mesma natureza — mesmo código do catálogo,
 * mesma unidade de fornecimento e mesma categoria — somando quantidades e valores, com a data desejada mais cedo e a
 * prioridade mais alta; demandas sem código do catálogo ficam como itens próprios. Os itens são numerados pelo
 * calendário de contratação: prioridade (alta → baixa) e data desejada.
 */
export function consolidarPca(
  demandas: readonly DemandaPca[],
  ano: number,
): { itens: ItemConsolidadoPca[]; totalDemandas: number; demandasAgregadas: number; valorTotal: Centavos; fundamento: string } {
  if (demandas.length === 0) throw new ErroDominio('PCA_SEM_DEMANDAS', 'O plano não tem demandas para consolidar.');
  for (const d of demandas) {
    const pendencias = validarDemandaPca(d, ano);
    if (pendencias.length > 0) throw new ErroDominio('DEMANDA_PCA_INVALIDA', `Demanda "${(d.descricao ?? '').trim().slice(0, 60)}": ${pendencias.join(' ')}`);
  }
  const grupos = new Map<string, DemandaPca[]>();
  for (const d of demandas) {
    const chave =
      d.codigoCatalogo !== null && d.tipoCatalogo !== null
        ? `${d.tipoCatalogo}|${d.codigoCatalogo}|${normalizarUnidade(d.unidadeFornecimento)}|${d.categoria}`
        : `avulsa|${d.id}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), d]);
  }
  const itens = [...grupos.values()].map((grupo): Omit<ItemConsolidadoPca, 'numero'> => {
    const primeira = grupo[0] as DemandaPca;
    const quantidade = grupo.reduce((s, d) => s + d.quantidade, 0);
    const valorTotal = grupo.reduce((s, d) => s + Math.round(d.quantidade * d.valorUnitario), 0);
    const unidades: string[] = [];
    for (const d of grupo) if (!unidades.includes(d.unidadeRequisitante.trim())) unidades.push(d.unidadeRequisitante.trim());
    return {
      demandas: grupo.map((d) => d.id),
      unidadesRequisitantes: unidades,
      descricao: primeira.descricao.trim(),
      codigoCatalogo: primeira.codigoCatalogo,
      tipoCatalogo: primeira.tipoCatalogo,
      unidadeFornecimento: primeira.unidadeFornecimento.trim(),
      categoria: primeira.categoria,
      quantidade,
      valorUnitario: Math.round(valorTotal / quantidade),
      valorTotal,
      dataDesejada: grupo.map((d) => d.dataDesejada).sort()[0] as DataISO,
      prioridade: grupo.map((d) => d.prioridade).sort((a, b) => ORDEM_PRIORIDADE[a] - ORDEM_PRIORIDADE[b])[0] as PrioridadePca,
    };
  });
  itens.sort(
    (a, b) =>
      ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade] ||
      a.dataDesejada.localeCompare(b.dataDesejada) ||
      a.descricao.localeCompare(b.descricao, 'pt-BR') ||
      (a.codigoCatalogo ?? '').localeCompare(b.codigoCatalogo ?? '') ||
      (a.demandas[0] ?? '').localeCompare(b.demandas[0] ?? ''),
  );
  return {
    itens: itens.map((item, i) => ({ numero: i + 1, ...item })),
    totalDemandas: demandas.length,
    demandasAgregadas: demandas.length - itens.length,
    valorTotal: itens.reduce((s, i) => s + i.valorTotal, 0),
    fundamento: FUNDAMENTO_PCA,
  };
}

const TRANSICOES_PCA: Readonly<Record<AcaoPca, { de: SituacaoPca; para: SituacaoPca; mensagem: string }>> = Object.freeze({
  consolidar: { de: 'em_elaboracao', para: 'consolidado', mensagem: 'Só o plano em elaboração pode ser consolidado.' },
  devolver: { de: 'consolidado', para: 'em_elaboracao', mensagem: 'Só o plano consolidado, ainda não aprovado, pode ser devolvido para ajustes.' },
  aprovar: { de: 'consolidado', para: 'aprovado', mensagem: 'Só o plano consolidado pode ser aprovado.' },
  publicar: { de: 'aprovado', para: 'publicado', mensagem: 'Só o plano aprovado pode ser publicado no PNCP.' },
});

/**
 * Ciclo do PCA (Decreto 10.947/2022, arts. 11 e 12): em elaboração → consolidado (setor de contratações) → aprovado
 * (autoridade competente, que pode devolver para ajustes, art. 12, § 1º) → publicado no PNCP (art. 12, § 2º).
 * Devolve a nova situação ou lança `TRANSICAO_PCA_INVALIDA`.
 */
export function validarTransicaoPca(situacao: SituacaoPca, acao: AcaoPca): SituacaoPca {
  const transicao = TRANSICOES_PCA[acao];
  if (!transicao) throw new ErroDominio('TRANSICAO_PCA_INVALIDA', `Ação inválida no PCA: ${String(acao)}.`);
  if (situacao !== transicao.de) throw new ErroDominio('TRANSICAO_PCA_INVALIDA', transicao.mensagem);
  return transicao.para;
}

/** Identificador legível do item do PCA: `UASG/ANO-NNNN` (ex.: 950002/2026-0003). */
export function identificadorItemPca(p: { uasg: string; ano: number; numero: number }): string {
  if (!/^\d{6}$/.test(p.uasg)) throw new ErroDominio('PCA_INVALIDO', 'A UASG deve ter 6 dígitos.');
  if (!Number.isInteger(p.ano) || p.ano < 2021 || p.ano > 2999) throw new ErroDominio('PCA_INVALIDO', `Ano do PCA inválido: ${String(p.ano)}.`);
  if (!Number.isInteger(p.numero) || p.numero < 1 || p.numero > 9999) throw new ErroDominio('PCA_INVALIDO', 'O número do item deve ser de 1 a 9999.');
  return `${p.uasg}/${p.ano}-${String(p.numero).padStart(4, '0')}`;
}

/** Item do plano no formato da API de manutenção do PNCP (`POST /v1/orgaos/{cnpj}/pca`, Manual 6.7.1). */
export interface ItemPlanoPncp {
  numeroItem: number;
  categoriaItemPca: number;
  /** 1 = CNBS (catálogo do governo federal, CATMAT/CATSER); 2 = outros. */
  catalogo: number;
  /** 1 = material; 2 = serviço. */
  classificacaoCatalogo: '1' | '2';
  classificacaoSuperiorCodigo: string;
  classificacaoSuperiorNome: string;
  codigoItem?: string;
  descricao: string;
  unidadeFornecimento: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorOrcamentoExercicio: number;
  dataDesejada: DataISO;
  unidadeRequisitante: string;
}

/**
 * Converte um item consolidado no item do PNCP: valores em reais, código e classe do catálogo (classe do material ou
 * grupo do serviço) e a categoria da tabela 5.16. Sem código do catálogo, o item vai como "outros" (catálogo 2).
 */
export function itemPlanoContratacoesPncp(
  item: ItemConsolidadoPca,
  classe: { codigo: string; nome: string } | null,
): ItemPlanoPncp {
  const categoria = CATEGORIAS_ITEM_PCA[item.categoria];
  if (!categoria) throw new ErroDominio('PCA_INVALIDO', `Categoria inválida: ${String(item.categoria)}.`);
  const material = item.tipoCatalogo ? item.tipoCatalogo === 'material' : item.categoria === 'material';
  const comCatalogo = item.codigoCatalogo !== null && classe !== null;
  const reais = (c: Centavos) => Math.round(c) / 100;
  return {
    numeroItem: item.numero,
    categoriaItemPca: categoria.codigoPncp,
    catalogo: comCatalogo ? 1 : 2,
    classificacaoCatalogo: material ? '1' : '2',
    classificacaoSuperiorCodigo: (classe?.codigo ?? '').slice(0, 100),
    classificacaoSuperiorNome: (classe?.nome ?? categoria.rotulo).slice(0, 255),
    ...(item.codigoCatalogo !== null ? { codigoItem: item.codigoCatalogo } : {}),
    descricao: item.descricao.slice(0, 2048),
    unidadeFornecimento: item.unidadeFornecimento.slice(0, 255),
    quantidade: item.quantidade,
    valorUnitario: reais(item.valorUnitario),
    valorTotal: reais(item.valorTotal),
    valorOrcamentoExercicio: reais(item.valorTotal),
    dataDesejada: item.dataDesejada,
    unidadeRequisitante: item.unidadesRequisitantes.join('; ').slice(0, 255),
  };
}

// ───────────────────────── Conferência do DFD com o PCA ─────────────────────────

export interface ItemPcaConferido {
  identificador: string;
  descricao: string;
  uasg: string;
  ano: number;
  valorTotal: Centavos;
  publicado: boolean;
}

export type VinculoDfdPca = { tipo: 'item'; item: ItemPcaConferido | null } | { tipo: 'fora_do_pca'; justificativa: string };

export interface ConferenciaDfdPca {
  situacao: 'vinculado' | 'fora_do_pca' | 'pendente' | 'sem_pca_publicado';
  /** Impedem o avanço da etapa 1. */
  pendencias: string[];
  /** Sinais para o agente, sem bloquear. */
  alertas: { nivel: 'informativo' | 'atencao'; mensagem: string }[];
  fundamento: string;
}

const FUNDAMENTO_CONFERENCIA = 'Lei 14.133/2021, art. 12, VII e § 1º, e art. 18, § 1º, II; Decreto 10.947/2022, arts. 16 e 17';

/**
 * Conferência do DFD com o PCA publicado (art. 18, § 1º, II). Quando a UASG tem PCA publicado para o exercício, o DFD
 * aponta o item do plano em que a demanda está prevista ou, se ela não consta do plano, traz a justificativa da
 * contratação não planejada (que leva à revisão do plano, Decreto 10.947/2022, arts. 16 e 17). Sem PCA publicado, a
 * demonstração não é exigida ("sempre que elaborado"). O item apontado deve ser de PCA publicado da mesma UASG, e a
 * marcação "prevista no PCA" do DFD deve conferir com o vínculo. Valor do DFD acima do planejado é sinal de atenção.
 */
export function conferirDfdComPca(
  e: { uasgProcesso: string; previstoNoPca: boolean; valorTotalDfd: Centavos; exigePca: boolean; vinculo: VinculoDfdPca | null },
  minimoCaracteres = 30,
): ConferenciaDfdPca {
  const pendencias: string[] = [];
  const alertas: ConferenciaDfdPca['alertas'] = [];
  const resultado = (situacao: ConferenciaDfdPca['situacao']): ConferenciaDfdPca => ({ situacao, pendencias, alertas, fundamento: FUNDAMENTO_CONFERENCIA });
  const v = e.vinculo;
  if (v === null) {
    if (e.exigePca) {
      pendencias.push(
        'Aponte o item do plano de contratações anual (PCA) publicado em que a demanda está prevista ou, se ela não consta do plano, registre a justificativa da contratação não planejada.',
      );
      return resultado('pendente');
    }
    alertas.push({
      nivel: 'informativo',
      mensagem: 'A UASG não tem plano de contratações anual publicado para o exercício: a demonstração da previsão no PCA só é exigida quando o plano foi elaborado.',
    });
    return resultado('sem_pca_publicado');
  }
  if (v.tipo === 'fora_do_pca') {
    if ((v.justificativa ?? '').trim().length < minimoCaracteres) {
      pendencias.push(`Registre a justificativa da contratação não prevista no PCA, com pelo menos ${minimoCaracteres} caracteres.`);
    }
    if (e.previstoNoPca) {
      pendencias.push('O DFD está marcado como "prevista no PCA", mas a demanda foi registrada como fora do plano: corrija a marcação do DFD ou aponte o item do PCA.');
    }
    alertas.push({
      nivel: 'informativo',
      mensagem: 'Contratação não prevista no PCA: o plano deve ser revisado para incluí-la, com justificativa aprovada pela autoridade competente.',
    });
    return resultado('fora_do_pca');
  }
  const item = v.item;
  if (item === null) {
    pendencias.push('O item do PCA apontado no DFD não foi encontrado: aponte de novo o item do plano publicado.');
    return resultado('pendente');
  }
  if (!item.publicado) pendencias.push(`O item ${item.identificador} pertence a um PCA ainda não publicado: aponte um item do plano publicado.`);
  if (item.uasg !== e.uasgProcesso) pendencias.push(`O item ${item.identificador} é do PCA de outra UASG (${item.uasg}): aponte um item do plano da UASG do processo.`);
  if (!e.previstoNoPca) {
    pendencias.push(`O DFD está marcado como fora do PCA, mas aponta o item ${item.identificador}: corrija a marcação "prevista no PCA" do DFD ou retire o vínculo.`);
  }
  if (e.valorTotalDfd > item.valorTotal) {
    alertas.push({
      nivel: 'atencao',
      mensagem: `O valor estimado do DFD (${formatarMoeda(e.valorTotalDfd)}) supera o planejado no item ${item.identificador} do PCA (${formatarMoeda(item.valorTotal)}): avalie a alteração do plano, que exige justificativa e aprovação.`,
    });
  }
  return resultado('vinculado');
}

// ───────────────────────── Catálogo CATMAT/CATSER (RIA-13) ─────────────────────────

const PALAVRAS_VAZIAS: ReadonlySet<string> = new Set([
  'a', 'o', 'as', 'os', 'ao', 'aos', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'com', 'sem',
  'para', 'por', 'pela', 'pelo', 'um', 'uma', 'ou', 'que', 'tipo', 'modelo', 'conforme', 'aquisicao', 'contratacao',
]);

/** Radical simples para plurais do português (determinístico, sem dicionário). */
function radical(palavra: string): string {
  if (palavra.length <= 3 || /^\d+$/.test(palavra)) return palavra;
  if (palavra.endsWith('oes') || palavra.endsWith('aes')) return `${palavra.slice(0, -3)}ao`;
  if (palavra.endsWith('ais')) return `${palavra.slice(0, -3)}al`;
  if (palavra.endsWith('eis')) return `${palavra.slice(0, -3)}el`;
  if (/(r|z|l)es$/.test(palavra)) return palavra.slice(0, -2);
  if (palavra.endsWith('s')) return palavra.slice(0, -1);
  return palavra;
}

/** Termos significativos do texto, na ordem em que aparecem: sem acentos, sem palavras vazias, plurais reduzidos. */
export function termosCatalogo(texto: string): string[] {
  const termos: string[] = [];
  for (const bruto of String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)) {
    if (bruto.length < 2 || PALAVRAS_VAZIAS.has(bruto)) continue;
    const termo = radical(bruto);
    if (!termos.includes(termo)) termos.push(termo);
  }
  return termos;
}

export interface CandidatoCatalogo {
  codigo: string;
  tipo: TipoCatalogo;
  descricao: string;
  classe: string | null;
  ativo: boolean;
}

export interface SugestaoCatalogo {
  codigo: string;
  tipo: TipoCatalogo;
  descricao: string;
  classe: string | null;
  /** 0 a 100: coeficiente de Dice entre os termos, com bônus quando o primeiro termo (o núcleo) coincide. */
  pontuacao: number;
  termosComuns: string[];
}

/**
 * Sugestão do código do catálogo para a descrição do item (RIA-13): compara os termos da descrição com os de cada item
 * ativo do catálogo (coeficiente de Dice, 0 a 100, com bônus de 15 pontos quando o primeiro termo coincide) e devolve os
 * mais semelhantes acima de `minimo`, em ordem de pontuação e de código. É sinal para a escolha do agente, que confere o
 * item e decide; a não utilização do catálogo continua exigindo justificativa (art. 19, § 2º; RN-02).
 */
export function sugerirItensCatalogo(
  descricao: string,
  candidatos: readonly CandidatoCatalogo[],
  opcoes: { limite?: number; minimo?: number; tipo?: TipoCatalogo | null } = {},
): { sugestoes: SugestaoCatalogo[]; termos: string[]; aviso: string; fundamento: string } {
  const limite = opcoes.limite ?? 5;
  const minimo = opcoes.minimo ?? 25;
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) throw new ErroDominio('SUGESTAO_INVALIDA', 'O limite de sugestões deve ser de 1 a 50.');
  const termos = termosCatalogo(descricao);
  const aviso = 'Sugestão por semelhança de texto, sem decisão automática: confira a descrição do item no catálogo antes de usar o código. Requer revisão humana.';
  const fundamento = 'Lei 14.133/2021, art. 19, II e § 2º';
  if (termos.length === 0) return { sugestoes: [], termos, aviso, fundamento };
  const consulta = new Set(termos);
  const vistos = new Set<string>();
  const sugestoes: SugestaoCatalogo[] = [];
  for (const c of candidatos) {
    const chave = `${c.tipo}|${c.codigo}`;
    if (!c.ativo || vistos.has(chave) || (opcoes.tipo && c.tipo !== opcoes.tipo)) continue;
    vistos.add(chave);
    const termosCandidato = termosCatalogo(c.descricao);
    if (termosCandidato.length === 0) continue;
    const comuns = termosCandidato.filter((t) => consulta.has(t));
    if (comuns.length === 0) continue;
    const dice = (2 * comuns.length) / (consulta.size + termosCandidato.length);
    const bonus = termos[0] === termosCandidato[0] ? 0.15 : 0;
    const pontuacao = Math.min(100, Math.round((dice + bonus) * 100));
    if (pontuacao < minimo) continue;
    sugestoes.push({ codigo: c.codigo, tipo: c.tipo, descricao: c.descricao, classe: c.classe, pontuacao, termosComuns: comuns });
  }
  sugestoes.sort((a, b) => b.pontuacao - a.pontuacao || a.codigo.localeCompare(b.codigo) || a.tipo.localeCompare(b.tipo));
  return { sugestoes: sugestoes.slice(0, limite), termos, aviso, fundamento };
}

// ───────────────────────── Demandas semelhantes e registro de preços compartilhado (RIA-01) ─────────────────────────

export interface DemandaUnidade {
  uasg: string;
  /** DFD de processo ou item de PCA. */
  origem: 'dfd' | 'pca';
  referencia: string;
  codigoCatalogo: string;
  descricao: string;
  quantidade: number;
  unidadeFornecimento: string;
}

export interface GrupoDemandas {
  codigoCatalogo: string;
  descricao: string;
  quantidadeTotal: number;
  unidades: { uasg: string; quantidade: number; referencias: string[] }[];
}

/**
 * Agrupa as demandas de mesmo código do catálogo pedidas por unidades (UASGs) diferentes (RIA-01, art. 19, I, e
 * art. 40, II): cada grupo com duas ou mais UASGs é candidato a registro de preços compartilhado, com a soma das
 * quantidades por unidade. Ordem: mais unidades primeiro, depois o código.
 */
export function consolidarDemandas(demandas: readonly DemandaUnidade[]): GrupoDemandas[] {
  const porCodigo = new Map<string, DemandaUnidade[]>();
  for (const d of demandas) {
    if (!d.codigoCatalogo || !Number.isFinite(d.quantidade) || d.quantidade <= 0) continue;
    porCodigo.set(d.codigoCatalogo, [...(porCodigo.get(d.codigoCatalogo) ?? []), d]);
  }
  const grupos: GrupoDemandas[] = [];
  for (const [codigo, lista] of porCodigo) {
    const unidades = new Map<string, { uasg: string; quantidade: number; referencias: string[] }>();
    for (const d of lista) {
      const u = unidades.get(d.uasg) ?? { uasg: d.uasg, quantidade: 0, referencias: [] };
      u.quantidade += d.quantidade;
      if (!u.referencias.includes(d.referencia)) u.referencias.push(d.referencia);
      unidades.set(d.uasg, u);
    }
    if (unidades.size < 2) continue;
    grupos.push({
      codigoCatalogo: codigo,
      descricao: (lista[0] as DemandaUnidade).descricao,
      quantidadeTotal: lista.reduce((s, d) => s + d.quantidade, 0),
      unidades: [...unidades.values()].sort((a, b) => a.uasg.localeCompare(b.uasg)),
    });
  }
  return grupos.sort((a, b) => b.unidades.length - a.unidades.length || a.codigoCatalogo.localeCompare(b.codigoCatalogo));
}

/**
 * Sugestão de registro de preços compartilhado para os itens de um processo (RIA-01): os grupos de `consolidarDemandas`
 * que contêm um código do processo e ao menos outra UASG. Sinal para o agente avaliar a intenção de registro de preços
 * (art. 86); a decisão de propor a IRP é humana.
 */
export function sugerirRegistroPrecosCompartilhado(
  processo: { uasg: string; codigos: readonly string[] },
  demandas: readonly DemandaUnidade[],
): { codigoCatalogo: string; descricao: string; quantidadeTotal: number; outrasUnidades: { uasg: string; quantidade: number }[]; mensagem: string; fundamento: string }[] {
  const codigos = new Set(processo.codigos);
  return consolidarDemandas(demandas)
    .filter((g) => codigos.has(g.codigoCatalogo) && g.unidades.some((u) => u.uasg === processo.uasg))
    .map((g) => {
      const outras = g.unidades.filter((u) => u.uasg !== processo.uasg).map((u) => ({ uasg: u.uasg, quantidade: u.quantidade }));
      const lista = outras.map((u) => `UASG ${u.uasg} (${u.quantidade.toLocaleString('pt-BR')})`).join(', ');
      return {
        codigoCatalogo: g.codigoCatalogo,
        descricao: g.descricao,
        quantidadeTotal: g.quantidadeTotal,
        outrasUnidades: outras,
        mensagem: `Demanda semelhante em outras unidades para o código ${g.codigoCatalogo}: ${lista}. Avalie propor intenção de registro de preços para contratar em conjunto, com ganho de escala e sem fragmentar a despesa.`,
        fundamento: 'Lei 14.133/2021, art. 19, I, art. 40, II, e art. 86; Decreto 11.462/2023, art. 9º',
      };
    });
}

// ───────────────────────── Intenção de registro de preços (RN-38) ─────────────────────────

export const DIAS_UTEIS_MINIMOS_IRP = 8;
const FUNDAMENTO_IRP = 'Lei 14.133/2021, art. 86; Decreto 11.462/2023, art. 9º; contagem do art. 183';

/** Encerramento mais cedo admitido para a IRP aberta em `abertura`: 8 dias úteis, excluído o dia do começo (RN-38). */
export function prazoMinimoIrp(abertura: DataISO, opcoes?: OpcoesCalendario): { encerramentoMinimo: DataISO; diasUteis: number; fundamento: string } {
  if (!validarDataISO(abertura)) throw new ErroDominio('DATA_INVALIDA', `Data de abertura inválida: ${String(abertura)}.`);
  return { encerramentoMinimo: adicionarDiasUteis(abertura, DIAS_UTEIS_MINIMOS_IRP, opcoes), diasUteis: DIAS_UTEIS_MINIMOS_IRP, fundamento: FUNDAMENTO_IRP };
}

/**
 * RN-38: a intenção de registro de preços fica aberta por pelo menos 8 dias úteis, para que outros órgãos e unidades
 * manifestem interesse e informem as quantidades (art. 86; Decreto 11.462/2023, art. 9º). A abertura não pode ser
 * anterior a hoje. `valido` falso traz as pendências e o encerramento mínimo.
 */
export function verificarPrazoIrp(
  e: { abertura: DataISO; encerramento: DataISO; hoje: DataISO },
  opcoes?: OpcoesCalendario,
): { valido: boolean; diasUteis: number; encerramentoMinimo: DataISO | null; pendencias: string[]; fundamento: string } {
  const pendencias: string[] = [];
  if (!validarDataISO(e.hoje)) throw new ErroDominio('DATA_INVALIDA', `Data de referência inválida: ${String(e.hoje)}.`);
  if (!validarDataISO(e.abertura) || !validarDataISO(e.encerramento)) {
    return { valido: false, diasUteis: 0, encerramentoMinimo: null, pendencias: ['Informe as datas de abertura e de encerramento da intenção de registro de preços.'], fundamento: FUNDAMENTO_IRP };
  }
  const { encerramentoMinimo } = prazoMinimoIrp(e.abertura, opcoes);
  const diasUteis = e.encerramento > e.abertura ? diasUteisEntre(e.abertura, e.encerramento, opcoes) : 0;
  if (e.abertura < e.hoje) pendencias.push(`A abertura não pode ser anterior a hoje (${formatarData(e.hoje)}).`);
  if (diasUteis < DIAS_UTEIS_MINIMOS_IRP) {
    pendencias.push(
      `A intenção de registro de preços deve ficar aberta por pelo menos ${DIAS_UTEIS_MINIMOS_IRP} dias úteis: com abertura em ${formatarData(e.abertura)}, o encerramento deve ser a partir de ${formatarData(encerramentoMinimo)} (o período informado tem ${diasUteis} ${diasUteis === 1 ? 'dia útil' : 'dias úteis'}).`,
    );
  }
  return { valido: pendencias.length === 0, diasUteis, encerramentoMinimo, pendencias, fundamento: FUNDAMENTO_IRP };
}

export type SituacaoIrp = 'agendada' | 'aberta' | 'encerrada' | 'consolidada';

/** Situação da IRP em `hoje`: aberta entre a abertura e o encerramento (inclusive); consolidada depois do ato do gerenciador. */
export function situacaoIrp(irp: { abertura: DataISO; encerramento: DataISO; consolidada: boolean }, hoje: DataISO): SituacaoIrp {
  if (irp.consolidada) return 'consolidada';
  if (hoje < irp.abertura) return 'agendada';
  if (hoje <= irp.encerramento) return 'aberta';
  return 'encerrada';
}

/**
 * Consolidação das quantidades da IRP pelo órgão gerenciador (art. 86, caput: "determinar a estimativa total de
 * quantidades"): a quantidade do gerenciador mais as adesões dos participantes, com a participação de cada um.
 */
export function consolidarQuantidadesIrp(
  gerenciador: { uasg: string; quantidade: number },
  adesoes: readonly { uasg: string; quantidade: number }[],
): { quantidadeTotal: number; participantes: { uasg: string; papel: 'gerenciador' | 'participante'; quantidade: number; percentual: number }[]; fundamento: string } {
  const todos = [{ ...gerenciador, papel: 'gerenciador' as const }, ...adesoes.map((a) => ({ ...a, papel: 'participante' as const }))];
  const vistos = new Set<string>();
  for (const p of todos) {
    if (!Number.isFinite(p.quantidade) || p.quantidade <= 0) throw new ErroDominio('QUANTIDADE_INVALIDA', `Quantidade inválida para a UASG ${p.uasg}.`);
    if (vistos.has(p.uasg)) throw new ErroDominio('ADESAO_DUPLICADA', `A UASG ${p.uasg} aparece mais de uma vez na intenção de registro de preços.`);
    vistos.add(p.uasg);
  }
  const total = todos.reduce((s, p) => s + p.quantidade, 0);
  return {
    quantidadeTotal: total,
    participantes: todos.map((p) => ({ uasg: p.uasg, papel: p.papel, quantidade: p.quantidade, percentual: Math.round((p.quantidade / total) * 1000) / 10 })),
    fundamento: 'Lei 14.133/2021, art. 86, caput; Decreto 11.462/2023',
  };
}
