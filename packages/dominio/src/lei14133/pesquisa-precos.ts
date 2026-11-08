/**
 * Consulta automatizada de preços e projeção do valor estimado.
 * - RF-25: enquadra as amostras obtidas nas fontes oficiais (painel de preços, contratações similares, notas fiscais
 *   eletrônicas, Sinapi e Sicro) nos parâmetros do art. 23, §§ 1º e 2º, da Lei 14.133/2021, descarta as que não
 *   servem e ordena as que podem virar cotação da cesta. O agente escolhe quais entram.
 * - RIA-11: projeta o valor estimado até a data prevista da contratação com índices oficiais (IPCA e câmbio).
 *   É sinal, com premissas e fontes: não altera o valor estimado.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, diasEntre, formatarData } from '../datas.ts';
import { type Centavos, formatarMoeda } from '../moeda.ts';
import { adicionarMeses, arredondar, exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';
import type { FonteCotacao } from './precos.ts';

export type OrigemPrecoAutomatizada = 'painel_precos' | 'contratacoes_similares' | 'notas_fiscais' | 'sinapi' | 'sicro';

export type TipoObjetoPesquisa =
  | 'bens'
  | 'servicos_comuns'
  | 'servicos_especiais'
  | 'obras_servicos_engenharia_comuns'
  | 'obras_servicos_engenharia_especiais';

/** Preço encontrado numa fonte oficial, antes do enquadramento. Sem dados pessoais (fornecedor PF não entra). */
export interface AmostraPrecoExterna {
  origem: OrigemPrecoAutomatizada;
  /** Identificador do registro na fonte: compra, contratação no PNCP, chave da NF-e, código da tabela. */
  identificador: string;
  /** Descrição do item na fonte. */
  descricao: string;
  valorUnitario: Centavos;
  /** Data da compra, do resultado, da emissão da nota ou data-base da tabela. */
  data: DataISO;
  unidade?: string;
  /** Unidade compradora, órgão ou UF da referência. */
  local?: string;
}

export interface EnquadramentoArt23 {
  /** Parâmetro da cesta de preços em que a amostra entra. */
  fonteCotacao: FonteCotacao;
  /** Ex.: "art. 23, § 1º, I". */
  inciso: string;
  fundamento: string;
  /** Antiguidade máxima da amostra em meses, quando a lei ou o regulamento a fixam. */
  prazoMeses: number | null;
}

export interface SugestaoPrecoEnquadrada extends AmostraPrecoExterna, EnquadramentoArt23 {
  /** Texto da identificação da fonte gravado na cesta: origem, registro, local e inciso. */
  descricaoFonte: string;
}

const ORIGENS: readonly OrigemPrecoAutomatizada[] = ['painel_precos', 'contratacoes_similares', 'notas_fiscais', 'sinapi', 'sicro'];
const TIPOS_OBJETO: readonly TipoObjetoPesquisa[] = [
  'bens',
  'servicos_comuns',
  'servicos_especiais',
  'obras_servicos_engenharia_comuns',
  'obras_servicos_engenharia_especiais',
];

const NOME_ORIGEM: Record<OrigemPrecoAutomatizada, string> = {
  painel_precos: 'Painel de Preços',
  contratacoes_similares: 'Contratação similar (PNCP)',
  notas_fiscais: 'Nota fiscal eletrônica',
  sinapi: 'Sinapi',
  sicro: 'Sicro',
};

/** Ordem de apresentação: § 1º prioriza os incisos I e II (IN 65/2021, art. 5º, § 1º); § 2º segue a ordem legal. */
const ORDEM_BENS_SERVICOS: readonly OrigemPrecoAutomatizada[] = ['painel_precos', 'contratacoes_similares', 'notas_fiscais'];
const ORDEM_ENGENHARIA: readonly OrigemPrecoAutomatizada[] = ['sinapi', 'sicro', 'contratacoes_similares', 'notas_fiscais'];

const LIMITE_DESCRICAO_FONTE = 500;
/** Aviso exibido com toda lista de sugestões da consulta automática. */
export const AVISO_SUGESTOES_PRECOS =
  'Sugestões obtidas por consulta automática às fontes oficiais. Nenhum preço entra na cesta sem a escolha do agente, que deve analisar criticamente cada amostra (IN SEGES/ME 65/2021, art. 6º, § 4º).';

function ehEngenharia(tipoObjeto: TipoObjetoPesquisa): boolean {
  return tipoObjeto === 'obras_servicos_engenharia_comuns' || tipoObjeto === 'obras_servicos_engenharia_especiais';
}

function exigirTipoObjeto(tipoObjeto: TipoObjetoPesquisa): void {
  if (!TIPOS_OBJETO.includes(tipoObjeto)) throw new ErroDominio('AMOSTRA_PRECO_INVALIDA', `Tipo de objeto inválido: ${String(tipoObjeto)}.`);
}

/**
 * Enquadra uma origem de preço no art. 23 da Lei 14.133/2021 conforme o tipo de objeto.
 * - Bens e serviços (§ 1º, parâmetros combinados ou não): painel de preços → I; contratações similares do último ano → II;
 *   notas fiscais eletrônicas → V (até 1 ano, IN SEGES/ME 65/2021, art. 5º, V).
 * - Obras e serviços de engenharia (§ 2º, parâmetros na ordem legal): Sicro (infraestrutura de transportes) ou Sinapi
 *   (demais obras) → I, como tabela de referência oficial; contratações similares do último ano → III; notas fiscais → IV.
 * Devolve `null` quando a origem não é parâmetro previsto para o tipo de objeto (painel em obras; Sinapi/Sicro em bens e serviços).
 */
export function enquadrarAmostraArt23(origem: OrigemPrecoAutomatizada, tipoObjeto: TipoObjetoPesquisa): EnquadramentoArt23 | null {
  if (!ORIGENS.includes(origem)) throw new ErroDominio('AMOSTRA_PRECO_INVALIDA', `Origem de preço inválida: ${String(origem)}.`);
  exigirTipoObjeto(tipoObjeto);
  if (ehEngenharia(tipoObjeto)) {
    switch (origem) {
      case 'sinapi':
      case 'sicro':
        return {
          fonteCotacao: 'midia_especializada',
          inciso: 'art. 23, § 2º, I',
          fundamento: 'Lei 14.133/2021, art. 23, § 2º, I (Sicro para infraestrutura de transportes; Sinapi para as demais obras)',
          prazoMeses: null,
        };
      case 'contratacoes_similares':
        return { fonteCotacao: 'contratacao_similar', inciso: 'art. 23, § 2º, III', fundamento: 'Lei 14.133/2021, art. 23, § 2º, III', prazoMeses: 12 };
      case 'notas_fiscais':
        return { fonteCotacao: 'nota_fiscal', inciso: 'art. 23, § 2º, IV', fundamento: 'Lei 14.133/2021, art. 23, § 2º, IV', prazoMeses: null };
      default:
        return null;
    }
  }
  switch (origem) {
    case 'painel_precos':
      return { fonteCotacao: 'painel_precos', inciso: 'art. 23, § 1º, I', fundamento: 'Lei 14.133/2021, art. 23, § 1º, I; IN SEGES/ME 65/2021, art. 5º, I', prazoMeses: null };
    case 'contratacoes_similares':
      return {
        fonteCotacao: 'contratacao_similar',
        inciso: 'art. 23, § 1º, II',
        fundamento: 'Lei 14.133/2021, art. 23, § 1º, II; IN SEGES/ME 65/2021, art. 5º, II',
        prazoMeses: 12,
      };
    case 'notas_fiscais':
      return { fonteCotacao: 'nota_fiscal', inciso: 'art. 23, § 1º, V', fundamento: 'Lei 14.133/2021, art. 23, § 1º, V; IN SEGES/ME 65/2021, art. 5º, V', prazoMeses: 12 };
    default:
      return null;
  }
}

function limitar(texto: string, maximo: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= maximo ? limpo : `${limpo.slice(0, maximo - 1).trimEnd()}…`;
}

function descricaoFonte(a: AmostraPrecoExterna, e: EnquadramentoArt23): string {
  const local = a.local && a.local.trim() !== '' ? `, ${limitar(a.local, 120)}` : '';
  const sufixo = ` (${limitar(a.identificador, 80)}${local}; ${e.inciso})`;
  const espaco = Math.max(40, LIMITE_DESCRICAO_FONTE - NOME_ORIGEM[a.origem].length - sufixo.length - 3);
  return `${NOME_ORIGEM[a.origem]} — ${limitar(a.descricao, espaco)}${sufixo}`;
}

/**
 * Seleciona, entre as amostras das fontes oficiais, as que podem ser sugeridas como cotação da cesta (RF-25).
 * Descarta, com o motivo: origem não prevista para o tipo de objeto; valor não positivo; data inválida ou futura;
 * amostra fora do prazo do inciso (contratações similares e notas fiscais com mais de 1 ano); registro repetido.
 * Ordena pela ordem legal das fontes e, em cada fonte, da amostra mais recente para a mais antiga (empate mantém a
 * ordem recebida da fonte), até
 * `limitePorOrigem` (padrão 5). Alertas: falta de parâmetro prioritário (IN 65/2021, art. 5º, § 1º), falta de
 * Sinapi/Sicro em obras (art. 23, § 2º) e menos de três sugestões (IN 65/2021, art. 6º, § 5º).
 */
export function selecionarSugestoesPrecos(
  amostras: AmostraPrecoExterna[],
  opcoes: { hoje: DataISO; tipoObjeto: TipoObjetoPesquisa; limitePorOrigem?: number },
): {
  sugestoes: SugestaoPrecoEnquadrada[];
  descartadas: { origem: OrigemPrecoAutomatizada; identificador: string; motivo: string }[];
  excedentes: number;
  alertas: { codigo: string; mensagem: string; fundamento: string }[];
  aviso: string;
} {
  if (!Array.isArray(amostras)) throw new ErroDominio('AMOSTRA_PRECO_INVALIDA', 'Informe a lista de amostras.');
  const hoje = lerData(opcoes?.hoje, 'hoje');
  exigirTipoObjeto(opcoes.tipoObjeto);
  const limite = opcoes.limitePorOrigem ?? 5;
  exigirInteiro(limite, 'limitePorOrigem', 'AMOSTRA_PRECO_INVALIDA', 1);
  if (limite > 50) throw new ErroDominio('AMOSTRA_PRECO_INVALIDA', 'limitePorOrigem deve ser no máximo 50.');

  const engenharia = ehEngenharia(opcoes.tipoObjeto);
  const descartadas: { origem: OrigemPrecoAutomatizada; identificador: string; motivo: string }[] = [];
  const aceitas: SugestaoPrecoEnquadrada[] = [];
  const vistos = new Set<string>();

  for (const a of amostras) {
    const enquadramento = enquadrarAmostraArt23(a.origem, opcoes.tipoObjeto);
    const identificador = typeof a.identificador === 'string' ? a.identificador.trim() : '';
    const descartar = (motivo: string) => descartadas.push({ origem: a.origem, identificador: identificador || '(sem identificador)', motivo });
    if (enquadramento === null) {
      descartar(
        engenharia
          ? 'O art. 23, § 2º, não prevê esta fonte para obras e serviços de engenharia.'
          : 'Sinapi e Sicro são parâmetros de obras e serviços de engenharia (art. 23, § 2º).',
      );
      continue;
    }
    if (identificador === '') {
      descartar('Amostra sem identificação do registro na fonte.');
      continue;
    }
    if (!Number.isSafeInteger(a.valorUnitario) || a.valorUnitario <= 0) {
      descartar('Valor unitário ausente ou não positivo.');
      continue;
    }
    let data: number;
    try {
      data = lerData(a.data, 'data');
    } catch {
      descartar('Data inválida na fonte.');
      continue;
    }
    if (data > hoje) {
      descartar('Data posterior à data da pesquisa.');
      continue;
    }
    if (enquadramento.prazoMeses !== null && lerData(adicionarMeses(a.data, enquadramento.prazoMeses)) < hoje) {
      descartar(`Fora do período de ${enquadramento.prazoMeses} meses anterior à pesquisa (${enquadramento.inciso}).`);
      continue;
    }
    const chave = `${a.origem}|${identificador.toLowerCase()}`;
    if (vistos.has(chave)) {
      descartar('Registro repetido na mesma fonte.');
      continue;
    }
    vistos.add(chave);
    const amostra: AmostraPrecoExterna = { ...a, identificador, descricao: limitar(a.descricao ?? '', 300) };
    aceitas.push({ ...amostra, ...enquadramento, descricaoFonte: descricaoFonte(amostra, enquadramento) });
  }

  const ordem = engenharia ? ORDEM_ENGENHARIA : ORDEM_BENS_SERVICOS;
  const sugestoes: SugestaoPrecoEnquadrada[] = [];
  let excedentes = 0;
  for (const origem of ordem) {
    // Ordenação estável: na mesma data, mantém a ordem da fonte (ex.: relevância da busca no Sinapi/Sicro).
    const daOrigem = aceitas.filter((s) => s.origem === origem).sort((x, y) => (x.data === y.data ? 0 : x.data < y.data ? 1 : -1));
    sugestoes.push(...daOrigem.slice(0, limite));
    excedentes += Math.max(0, daOrigem.length - limite);
  }

  const alertas: { codigo: string; mensagem: string; fundamento: string }[] = [];
  if (engenharia) {
    if (!sugestoes.some((s) => s.origem === 'sinapi' || s.origem === 'sicro')) {
      alertas.push({
        codigo: 'SEM_REFERENCIA_SINAPI_SICRO',
        mensagem: 'Nenhum preço do Sinapi ou do Sicro foi encontrado. Em obras e serviços de engenharia os parâmetros seguem a ordem legal: registre nos autos por que se passou aos parâmetros seguintes.',
        fundamento: 'Lei 14.133/2021, art. 23, § 2º',
      });
    }
  } else if (!sugestoes.some((s) => s.origem === 'painel_precos' || s.origem === 'contratacoes_similares')) {
    alertas.push({
      codigo: 'SEM_PARAMETRO_PRIORITARIO',
      mensagem: 'Nenhum preço do painel de preços nem de contratações similares foi encontrado. Esses parâmetros têm prioridade; se não for possível usá-los, justifique nos autos.',
      fundamento: 'IN SEGES/ME 65/2021, art. 5º, § 1º',
    });
  }
  if (sugestoes.length < 3) {
    alertas.push({
      codigo: 'POUCAS_SUGESTOES',
      mensagem: `A consulta automática trouxe ${sugestoes.length === 1 ? '1 preço' : `${sugestoes.length} preços`}. Amplie a pesquisa com outros parâmetros: com menos de três preços, a estimativa exige justificativa e aprovação da autoridade competente.`,
      fundamento: 'IN SEGES/ME 65/2021, art. 6º, § 5º',
    });
  }

  return { sugestoes, descartadas, excedentes, alertas, aviso: AVISO_SUGESTOES_PRECOS };
}

// ───────────────────────── RIA-11: projeção cambial e inflacionária ─────────────────────────

/** Valor mensal de uma série oficial: `competencia` no formato AAAA-MM. */
export interface IndiceMensal {
  competencia: string;
  valor: number;
}

const MESES_JANELA = 12;
const MINIMO_MESES_SERIE = 6;
const DIAS_POR_MES = 30.4375;
const HORIZONTE_MAXIMO_DIAS = 1096;
const LIMITE_SINAL_ATENCAO = 5;
const REGEX_COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;
const AVISO_PROJECAO =
  'Projeção estatística (sinal), não decisão: não altera o valor estimado da contratação nem a cesta de preços. Requer revisão humana.';

function rotuloCompetencia(competencia: string): string {
  return `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;
}

/** Ordena, confere formato e duplicidade e devolve as últimas `quantidade` competências. */
function prepararSerie(serie: IndiceMensal[] | undefined, campo: string, minimo: number, quantidade: number): IndiceMensal[] {
  if (!Array.isArray(serie)) throw new ErroDominio('PROJECAO_INVALIDA', `Informe a série ${campo}.`);
  const vistas = new Set<string>();
  for (const item of serie) {
    if (typeof item?.competencia !== 'string' || !REGEX_COMPETENCIA.test(item.competencia)) {
      throw new ErroDominio('PROJECAO_INVALIDA', `Competência inválida na série ${campo}: ${String(item?.competencia)} (use AAAA-MM).`);
    }
    if (vistas.has(item.competencia)) throw new ErroDominio('PROJECAO_INVALIDA', `Competência repetida na série ${campo}: ${item.competencia}.`);
    vistas.add(item.competencia);
    exigirFinito(item.valor, `valor de ${item.competencia} na série ${campo}`, 'PROJECAO_INVALIDA');
  }
  const ordenada = [...serie].sort((a, b) => a.competencia.localeCompare(b.competencia)).slice(-quantidade);
  if (ordenada.length < minimo) {
    throw new ErroDominio('PROJECAO_INVALIDA', `A série ${campo} tem ${ordenada.length} meses; são necessários pelo menos ${minimo}.`);
  }
  return ordenada;
}

/** Média geométrica das taxas mensais e desvio-padrão amostral (n − 1). */
function resumirTaxas(taxas: readonly number[]): { media: number; desvio: number } {
  const produto = taxas.reduce((acc, t) => acc * (1 + t), 1);
  const media = produto ** (1 / taxas.length) - 1;
  const aritmetica = taxas.reduce((acc, t) => acc + t, 0) / taxas.length;
  const variancia = taxas.length > 1 ? taxas.reduce((acc, t) => acc + (t - aritmetica) ** 2, 0) / (taxas.length - 1) : 0;
  return { media, desvio: Math.sqrt(variancia) };
}

function fator(taxaMensal: number, meses: number): number {
  return Math.max(0, 1 + taxaMensal) ** meses;
}

function percentualTexto(taxa: number, casas = 2): string {
  return `${formatarNumero(arredondar(taxa * 100, casas))}%`;
}

/**
 * Projeta o valor estimado da contratação até a data prevista (RIA-11), com índices oficiais.
 * - Inflação: variação mensal do IPCA (IBGE), em %; usa os 12 últimos meses informados (mínimo 6) e mantém a média
 *   geométrica mensal até a data prevista.
 * - Câmbio: cotação média mensal (R$ por unidade de moeda estrangeira, Banco Central); aplicada só à parcela do valor
 *   indicada como sujeita à variação cambial (`percentualCambial`, 0 a 100), pela variação média mensal das 12 últimas
 *   mudanças (mínimo 6).
 * - Horizonte em meses de 30,4375 dias, de `dataBase` (exclusive) até `dataPrevista`, no máximo 36 meses.
 * - Faixa: taxas médias ± 1 desvio-padrão amostral das variações mensais.
 * Fundamento: art. 23 (valor compatível com o mercado na data da contratação) e art. 25, § 7º (índice de reajuste com
 * data-base vinculada à do orçamento); IN SEGES/ME 65/2021, art. 5º, I e II (índice de atualização de preços).
 * É sinal para o agente: não altera o valor estimado.
 */
export function projetarValorEstimado(e: {
  valorBase: Centavos;
  dataBase: DataISO;
  dataPrevista: DataISO;
  ipca: IndiceMensal[];
  cambio?: IndiceMensal[];
  percentualCambial?: number;
}): {
  meses: number;
  fatorCentral: number;
  fatorMinimo: number;
  fatorMaximo: number;
  valorBase: Centavos;
  valorProjetado: Centavos;
  faixa: { minimo: Centavos; maximo: Centavos };
  variacaoPercentual: number;
  inflacao: { taxaMensalMedia: number; desvioMensal: number; competencias: number; periodo: string; acumuladoPeriodo: number };
  cambio: { participacao: number; taxaMensalMedia: number; desvioMensal: number; competencias: number; periodo: string; ultimaCotacao: number } | null;
  sinal: { nivel: 'informativo' | 'atencao'; mensagem: string };
  premissas: string[];
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
} {
  exigirInteiro(e.valorBase, 'valorBase', 'PROJECAO_INVALIDA', 1);
  const base = lerData(e.dataBase, 'dataBase');
  const prevista = lerData(e.dataPrevista, 'dataPrevista');
  if (prevista <= base) throw new ErroDominio('PROJECAO_INVALIDA', 'A data prevista da contratação deve ser posterior à data-base da estimativa.');
  const dias = diasEntre(e.dataBase, e.dataPrevista);
  if (dias > HORIZONTE_MAXIMO_DIAS) throw new ErroDominio('PROJECAO_INVALIDA', 'A projeção alcança no máximo 36 meses a partir da data-base da estimativa.');
  const percentualCambial = e.percentualCambial ?? 0;
  exigirFinito(percentualCambial, 'percentualCambial', 'PROJECAO_INVALIDA');
  if (percentualCambial < 0 || percentualCambial > 100) throw new ErroDominio('PROJECAO_INVALIDA', 'A parcela sujeita ao câmbio deve estar entre 0% e 100%.');

  const ipca = prepararSerie(e.ipca, 'IPCA', MINIMO_MESES_SERIE, MESES_JANELA);
  if (ipca.some((i) => i.valor <= -100)) throw new ErroDominio('PROJECAO_INVALIDA', 'Variação mensal do IPCA deve ser maior que −100%.');
  const taxasIpca = ipca.map((i) => i.valor / 100);
  const inflacao = resumirTaxas(taxasIpca);
  const acumuladoIpca = taxasIpca.reduce((acc, t) => acc * (1 + t), 1) - 1;
  const periodoIpca = `${rotuloCompetencia(ipca[0]?.competencia ?? '')} a ${rotuloCompetencia(ipca[ipca.length - 1]?.competencia ?? '')}`;

  const p = percentualCambial / 100;
  let cambio: { media: number; desvio: number; competencias: number; periodo: string; ultima: number } | null = null;
  if (p > 0) {
    const serie = prepararSerie(e.cambio, 'de câmbio', MINIMO_MESES_SERIE + 1, MESES_JANELA + 1);
    if (serie.some((c) => c.valor <= 0)) throw new ErroDominio('PROJECAO_INVALIDA', 'A cotação da moeda estrangeira deve ser positiva.');
    const variacoes = serie.slice(1).map((c, i) => c.valor / (serie[i]?.valor ?? c.valor) - 1);
    const resumo = resumirTaxas(variacoes);
    cambio = {
      ...resumo,
      competencias: serie.length,
      periodo: `${rotuloCompetencia(serie[0]?.competencia ?? '')} a ${rotuloCompetencia(serie[serie.length - 1]?.competencia ?? '')}`,
      ultima: serie[serie.length - 1]?.valor ?? 0,
    };
  }

  const meses = arredondar(dias / DIAS_POR_MES, 2);
  const mesesExatos = dias / DIAS_POR_MES;
  const combinar = (ti: number, tc: number) => (1 - p) * fator(ti, mesesExatos) + p * fator(tc, mesesExatos);
  const tc = cambio?.media ?? 0;
  const dc = cambio?.desvio ?? 0;
  const fatorCentral = combinar(inflacao.media, tc);
  const fatorMinimo = combinar(inflacao.media - inflacao.desvio, tc - dc);
  const fatorMaximo = combinar(inflacao.media + inflacao.desvio, tc + dc);
  const valorProjetado = Math.round(e.valorBase * fatorCentral);
  const faixa = { minimo: Math.round(e.valorBase * Math.min(fatorMinimo, fatorMaximo)), maximo: Math.round(e.valorBase * Math.max(fatorMinimo, fatorMaximo)) };
  const variacaoPercentual = arredondar((fatorCentral - 1) * 100, 2);

  const premissas = [
    `Inflação: mantém-se até a data prevista a variação média mensal do IPCA dos ${ipca.length} últimos meses divulgados (${periodoIpca}), de ${percentualTexto(inflacao.media, 3)} ao mês (média geométrica).`,
    cambio
      ? `Câmbio: ${formatarNumero(percentualCambial)}% do valor está sujeito à variação cambial, projetada pela variação média mensal da cotação (${cambio.periodo}), de ${percentualTexto(cambio.media, 3)} ao mês; o restante segue o IPCA.`
      : 'Câmbio: nenhuma parcela do valor foi indicada como sujeita à variação cambial.',
    `Horizonte: ${dias} dias entre ${formatarData(e.dataBase)} e ${formatarData(e.dataPrevista)} (${formatarNumero(meses)} meses de 30,4375 dias).`,
    'Faixa: taxas médias mais ou menos um desvio-padrão amostral das variações mensais do período.',
    'A projeção não altera o valor estimado nem a cesta de preços: serve de sinal para a decisão do agente.',
  ];
  const memoriaCalculo = [
    `Valor estimado na data-base: ${formatarMoeda(e.valorBase)}.`,
    `IPCA acumulado em ${periodoIpca}: ${percentualTexto(acumuladoIpca)}; média mensal ${percentualTexto(inflacao.media, 3)}; desvio mensal ${percentualTexto(inflacao.desvio, 3)}.`,
    ...(cambio
      ? [`Câmbio em ${cambio.periodo}: última cotação ${formatarNumero(arredondar(cambio.ultima, 4))}; variação média mensal ${percentualTexto(cambio.media, 3)}; desvio mensal ${percentualTexto(cambio.desvio, 3)}.`]
      : []),
    `Fator central: ${formatarNumero(arredondar(fatorCentral, 4))} = ${formatarNumero(100 - percentualCambial)}% × (1 + IPCA médio)^${formatarNumero(meses)}${cambio ? ` + ${formatarNumero(percentualCambial)}% × (1 + câmbio médio)^${formatarNumero(meses)}` : ''}.`,
    `Valor projetado: ${formatarMoeda(valorProjetado)} (variação de ${formatarNumero(variacaoPercentual)}%); faixa de ${formatarMoeda(faixa.minimo)} a ${formatarMoeda(faixa.maximo)}.`,
  ];
  const atencao = Math.abs(variacaoPercentual) >= LIMITE_SINAL_ATENCAO;
  const sinal = {
    nivel: atencao ? ('atencao' as const) : ('informativo' as const),
    mensagem: atencao
      ? `Variação projetada de ${formatarNumero(variacaoPercentual)}% até ${formatarData(e.dataPrevista)}: avalie atualizar a pesquisa de preços perto da divulgação do edital e confira o índice e a data-base do reajuste.`
      : `Variação projetada de ${formatarNumero(variacaoPercentual)}% até ${formatarData(e.dataPrevista)}, abaixo de ${LIMITE_SINAL_ATENCAO}%.`,
  };

  return {
    meses,
    fatorCentral: arredondar(fatorCentral, 6),
    fatorMinimo: arredondar(Math.min(fatorMinimo, fatorMaximo), 6),
    fatorMaximo: arredondar(Math.max(fatorMinimo, fatorMaximo), 6),
    valorBase: e.valorBase,
    valorProjetado,
    faixa,
    variacaoPercentual,
    inflacao: {
      taxaMensalMedia: arredondar(inflacao.media * 100, 4),
      desvioMensal: arredondar(inflacao.desvio * 100, 4),
      competencias: ipca.length,
      periodo: periodoIpca,
      acumuladoPeriodo: arredondar(acumuladoIpca * 100, 2),
    },
    cambio: cambio
      ? {
          participacao: percentualCambial,
          taxaMensalMedia: arredondar(cambio.media * 100, 4),
          desvioMensal: arredondar(cambio.desvio * 100, 4),
          competencias: cambio.competencias,
          periodo: cambio.periodo,
          ultimaCotacao: arredondar(cambio.ultima, 4),
        }
      : null,
    sinal,
    premissas,
    memoriaCalculo,
    fundamento: 'Lei 14.133/2021, art. 23 e art. 25, § 7º; IN SEGES/ME 65/2021, art. 5º, I e II',
    aviso: AVISO_PROJECAO,
  };
}
