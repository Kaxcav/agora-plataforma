/**
 * Painel das metas do ETP (RF-39): mede os resultados pretendidos que o Estudo Técnico Preliminar declara no
 * demonstrativo do art. 18, § 1º, IX, da Lei 14.133/2021 — tempo de instrução da fase preparatória, erros formais
 * barrados pelas travas e economia — contra as metas que o próprio órgão configura.
 *
 * Funções puras: a API lê a trilha de auditoria, os processos e as metas configuradas e entrega os fatos já
 * extraídos. Nada aqui atribui resultado à IA: o tempo vem dos avanços registrados, os erros barrados vêm dos
 * bloqueios aplicados e a economia é a diferença entre o estimado e o contratado ou homologado.
 */
import { ErroDominio } from '../erros.ts';
import { MS_POR_DIA, arredondar } from '../interno.ts';
import type { Centavos } from '../moeda.ts';

/** 'atingida' ou 'nao_atingida' quando há meta e medição; 'sem_meta' sem meta configurada; 'sem_dados' sem medição. */
export type SituacaoMeta = 'atingida' | 'nao_atingida' | 'sem_meta' | 'sem_dados';

/**
 * Etapas da jornada que compõem a instrução da fase preparatória: demanda e PCA (DFD), instrução no SEI e equipe,
 * ETP com riscos e pesquisa de preços, e TR com edital e minuta.
 */
export const ETAPAS_INSTRUCAO: readonly number[] = Object.freeze([1, 2, 3, 4]);

const FUNDAMENTO_METAS = 'Lei 14.133/2021, art. 18, § 1º, IX';
const LIMITE_LINHA_BASE_DIAS = 3650;

/**
 * Situação de um indicador diante da meta. `sentido` diz se o melhor é ficar no alvo ou abaixo dele ('ate', como
 * tempo) ou no alvo ou acima dele ('a_partir', como percentual de mitigação e de economia).
 */
export function situacaoMeta(valor: number | null, alvo: number | null, sentido: 'ate' | 'a_partir'): SituacaoMeta {
  if (alvo === null || !Number.isFinite(alvo)) return 'sem_meta';
  if (valor === null || !Number.isFinite(valor)) return 'sem_dados';
  return (sentido === 'ate' ? valor <= alvo : valor >= alvo) ? 'atingida' : 'nao_atingida';
}

// ───────────────────────── configuração das metas ─────────────────────────

export interface MetasEtp {
  tempoInstrucao: {
    /** Redução pretendida do tempo de instrução em relação à linha de base (%), ou null sem meta. */
    reducaoPercentual: number | null;
    /** Linha de base de cada etapa, em dias corridos, medida pelo órgão antes da plataforma. */
    linhaBaseDias: Readonly<Record<string, number | null>>;
  };
  /** Percentual mínimo das ocorrências de erro formal que devem ser barradas pelas travas. */
  errosFormais: { mitigacaoPercentual: number | null };
  /** Economia mínima pretendida sobre o valor estimado (%). */
  economia: { economiaPercentual: number | null };
}

function exigirPercentual(valor: number | null, campo: string): void {
  if (valor === null) return;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || valor > 100) {
    throw new ErroDominio('META_INVALIDA', `${campo} deve ser um percentual maior que 0 e até 100 (recebido: ${String(valor)}).`);
  }
}

/**
 * Valida as metas configuradas pelo órgão: percentuais de 0 (exclusive) a 100 e linhas de base positivas, de até
 * 10 anos, só para as etapas da instrução. Lança `ErroDominio('META_INVALIDA')`.
 */
export function validarMetasEtp(metas: MetasEtp): MetasEtp {
  exigirPercentual(metas.tempoInstrucao.reducaoPercentual, 'A redução do tempo de instrução');
  exigirPercentual(metas.errosFormais.mitigacaoPercentual, 'A mitigação de erros formais');
  exigirPercentual(metas.economia.economiaPercentual, 'A economia pretendida');
  for (const [etapa, dias] of Object.entries(metas.tempoInstrucao.linhaBaseDias)) {
    if (!ETAPAS_INSTRUCAO.includes(Number(etapa))) {
      throw new ErroDominio('META_INVALIDA', `A etapa ${etapa} não faz parte da instrução da fase preparatória (etapas ${ETAPAS_INSTRUCAO.join(', ')}).`);
    }
    if (dias === null) continue;
    if (typeof dias !== 'number' || !Number.isFinite(dias) || dias <= 0 || dias > LIMITE_LINHA_BASE_DIAS) {
      throw new ErroDominio('META_INVALIDA', `A linha de base da etapa ${etapa} deve ser maior que 0 e até ${LIMITE_LINHA_BASE_DIAS} dias (recebido: ${String(dias)}).`);
    }
  }
  return metas;
}

// ───────────────────────── (a) tempo de instrução ─────────────────────────

/** Entrada de um processo numa etapa: a autuação abre a etapa 1; cada avanço registrado abre a etapa seguinte. */
export interface MarcoEtapa {
  processoId: string;
  etapa: number;
  /** Instante ISO 8601 do evento na trilha de auditoria. */
  ocorridoEm: string;
}

export interface MedicaoTempo {
  /** Permanências concluídas no período (a saída da etapa caiu no período). */
  processosMedidos: number;
  mediaDias: number | null;
  medianaDias: number | null;
  linhaBaseDias: number | null;
  /** Linha de base reduzida pela meta: o tempo que se quer atingir. */
  alvoDias: number | null;
  /** Redução obtida em relação à linha de base (negativa quando o tempo aumentou). */
  reducaoObtidaPercentual: number | null;
  situacao: SituacaoMeta;
}

export interface MedicaoEtapa extends MedicaoTempo {
  etapa: number;
}

export interface ResultadoTempoInstrucao {
  etapas: MedicaoEtapa[];
  /** Da autuação até o fim da última etapa da instrução, para os processos que a concluíram no período. */
  fase: MedicaoTempo;
  metaReducaoPercentual: number | null;
  fundamento: string;
}

function instante(valor: string, campo: string): number {
  const ms = Date.parse(valor);
  if (typeof valor !== 'string' || Number.isNaN(ms)) throw new ErroDominio('INSTANTE_INVALIDO', `${campo}: instante inválido (${String(valor)}).`);
  return ms;
}

function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? (ordenados[meio] ?? 0) : ((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2;
}

function medir(duracoesMs: readonly number[], linhaBaseDias: number | null, reducaoPercentual: number | null): MedicaoTempo {
  const dias = duracoesMs.map((ms) => ms / MS_POR_DIA);
  const media = dias.length > 0 ? dias.reduce((s, d) => s + d, 0) / dias.length : null;
  const med = mediana(dias);
  const alvo = linhaBaseDias !== null && reducaoPercentual !== null ? arredondar(linhaBaseDias * (1 - reducaoPercentual / 100), 1) : null;
  const mediaArredondada = media === null ? null : arredondar(media, 1);
  return {
    processosMedidos: dias.length,
    mediaDias: mediaArredondada,
    medianaDias: med === null ? null : arredondar(med, 1),
    linhaBaseDias,
    alvoDias: alvo,
    reducaoObtidaPercentual: media !== null && linhaBaseDias !== null ? arredondar((1 - media / linhaBaseDias) * 100, 1) : null,
    situacao: situacaoMeta(mediaArredondada, alvo, 'ate'),
  };
}

/**
 * Tempo de instrução da fase preparatória por etapa (art. 18, § 1º, IX): a permanência numa etapa vai da entrada
 * (autuação ou avanço anterior) até o avanço para a etapa seguinte, em dias corridos. Conta a permanência cuja saída
 * caiu em [inicio, fim]; a etapa ainda em curso não entra (não há saída). A média é comparada ao alvo, que é a linha
 * de base configurada pelo órgão reduzida pela meta de redução. Sem linha de base ou sem meta: 'sem_meta'.
 */
export function medirTempoInstrucao(entrada: {
  marcos: readonly MarcoEtapa[];
  inicio: string;
  fim: string;
  metas: MetasEtp['tempoInstrucao'];
  etapas?: readonly number[];
}): ResultadoTempoInstrucao {
  const inicio = instante(entrada.inicio, 'inicio');
  const fim = instante(entrada.fim, 'fim');
  if (inicio > fim) throw new ErroDominio('PERIODO_INVALIDO', 'O início do período é posterior ao fim.');
  const etapas = [...(entrada.etapas ?? ETAPAS_INSTRUCAO)].sort((a, b) => a - b);
  if (etapas.length === 0 || etapas.some((e) => !Number.isInteger(e) || e < 1 || e > 6)) {
    throw new ErroDominio('ETAPA_INVALIDA', 'As etapas medidas devem ser inteiros de 1 a 6.');
  }
  const reducao = entrada.metas.reducaoPercentual;

  // Primeira entrada de cada processo em cada etapa.
  const entradas = new Map<string, Map<number, number>>();
  for (const marco of entrada.marcos) {
    const ms = instante(marco.ocorridoEm, 'ocorridoEm');
    const doProcesso = entradas.get(marco.processoId) ?? new Map<number, number>();
    const anterior = doProcesso.get(marco.etapa);
    if (anterior === undefined || ms < anterior) doProcesso.set(marco.etapa, ms);
    entradas.set(marco.processoId, doProcesso);
  }

  const noPeriodo = (ms: number) => ms >= inicio && ms <= fim;
  const permanencias = new Map<number, number[]>(etapas.map((e) => [e, []]));
  const fase: number[] = [];
  const primeira = etapas[0] ?? 1;
  const saidaDaFase = (etapas.at(-1) ?? 1) + 1;
  for (const doProcesso of entradas.values()) {
    for (const etapa of etapas) {
      const entrou = doProcesso.get(etapa);
      const saiu = doProcesso.get(etapa + 1);
      if (entrou !== undefined && saiu !== undefined && saiu >= entrou && noPeriodo(saiu)) permanencias.get(etapa)?.push(saiu - entrou);
    }
    const comecou = doProcesso.get(primeira);
    const terminou = doProcesso.get(saidaDaFase);
    if (comecou !== undefined && terminou !== undefined && terminou >= comecou && noPeriodo(terminou)) fase.push(terminou - comecou);
  }

  const linhaBase = (etapa: number): number | null => entrada.metas.linhaBaseDias[String(etapa)] ?? null;
  const basesDaFase = etapas.map(linhaBase);
  const baseFase = basesDaFase.every((b): b is number => b !== null) ? arredondar(basesDaFase.reduce((s, b) => s + b, 0), 1) : null;
  return {
    etapas: etapas.map((etapa) => ({ etapa, ...medir(permanencias.get(etapa) ?? [], linhaBase(etapa), reducao) })),
    fase: medir(fase, baseFase, reducao),
    metaReducaoPercentual: reducao,
    fundamento: FUNDAMENTO_METAS,
  };
}

// ───────────────────────── (b) erros formais barrados ─────────────────────────

/** Bloqueio aplicado por uma trava e registrado na trilha (evento `trava.bloqueio`). */
export interface BloqueioRegistrado {
  /** Regras que barraram o ato (ex.: RN-04, RN-09). */
  regras: readonly string[];
  /** Ponto da jornada em que a trava atuou (ex.: avanço de etapa, assinatura do contrato). */
  trava: string;
  processoId: string | null;
}

export interface ResultadoMitigacao {
  bloqueios: number;
  processosAfetados: number;
  /** Erros formais que passaram pelas travas e foram encontrados depois, na trilha. */
  ocorrenciasNaoBarradas: number;
  /** bloqueios ÷ (bloqueios + não barradas) × 100; null sem nenhuma ocorrência. */
  mitigacaoPercentual: number | null;
  metaPercentual: number | null;
  situacao: SituacaoMeta;
  porRegra: { regra: string; bloqueios: number }[];
  porTrava: { trava: string; bloqueios: number }[];
  fundamento: string;
}

/**
 * Erros formais de instrução barrados pelas travas: cada bloqueio registrado é uma ocorrência barrada; as
 * ocorrências que passaram (encontradas depois, na trilha) entram no denominador. O resultado é a mitigação
 * obtida, comparada ao mínimo configurado pelo órgão. Contagem por regra (um bloqueio pode citar várias regras)
 * e por trava, em ordem decrescente.
 */
export function avaliarMitigacaoTravas(entrada: {
  bloqueios: readonly BloqueioRegistrado[];
  ocorrenciasNaoBarradas: number;
  metaPercentual: number | null;
}): ResultadoMitigacao {
  const naoBarradas = entrada.ocorrenciasNaoBarradas;
  if (!Number.isSafeInteger(naoBarradas) || naoBarradas < 0) {
    throw new ErroDominio('CONTAGEM_INVALIDA', 'As ocorrências não barradas devem ser um inteiro não negativo.');
  }
  const porRegra = new Map<string, number>();
  const porTrava = new Map<string, number>();
  const processos = new Set<string>();
  for (const b of entrada.bloqueios) {
    for (const regra of new Set(b.regras)) porRegra.set(regra, (porRegra.get(regra) ?? 0) + 1);
    porTrava.set(b.trava, (porTrava.get(b.trava) ?? 0) + 1);
    if (b.processoId !== null) processos.add(b.processoId);
  }
  const total = entrada.bloqueios.length;
  const mitigacao = total + naoBarradas > 0 ? arredondar((total * 100) / (total + naoBarradas), 1) : null;
  const ordenar = (mapa: Map<string, number>) => [...mapa.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
  return {
    bloqueios: total,
    processosAfetados: processos.size,
    ocorrenciasNaoBarradas: naoBarradas,
    mitigacaoPercentual: mitigacao,
    metaPercentual: entrada.metaPercentual,
    situacao: situacaoMeta(mitigacao, entrada.metaPercentual, 'a_partir'),
    porRegra: ordenar(porRegra).map(([regra, bloqueios]) => ({ regra, bloqueios })),
    porTrava: ordenar(porTrava).map(([trava, bloqueios]) => ({ trava, bloqueios })),
    fundamento: FUNDAMENTO_METAS,
  };
}

// ───────────────────────── (c) economia ─────────────────────────

export interface CotacaoCesta {
  valorUnitario: Centavos;
  expurgada: boolean;
}

export interface EfeitoExpurgos {
  cotacoes: number;
  descartadas: number;
  /** Média aritmética simples de todas as cotações, inclusive as descartadas. */
  mediaComDescartadas: Centavos | null;
  /** Média aritmética simples só das cotações mantidas na cesta. */
  mediaSemDescartadas: Centavos | null;
  /** mediaComDescartadas − mediaSemDescartadas (positivo: os descartes baixaram a média). */
  diferencaUnitaria: Centavos;
  /** diferencaUnitaria × quantidade do item de referência da cesta. */
  efeitoNoEstimado: Centavos;
}

function exigirCentavosNaoNegativos(valor: number, campo: string): void {
  if (!Number.isSafeInteger(valor) || valor < 0) throw new ErroDominio('VALOR_INVALIDO', `${campo} deve ser um valor em centavos, inteiro e não negativo.`);
}

/**
 * Efeito dos expurgos da cesta de preços (saneamento da IN SEGES/ME 65/2021): compara a média de todas as cotações
 * com a média das que ficaram, e projeta a diferença na quantidade do item de referência. Mostra só quanto o
 * descarte mudou a referência; não é economia e não é atribuído a nenhuma ferramenta.
 */
export function efeitoExpurgosCesta(cotacoes: readonly CotacaoCesta[], quantidadeReferencia: number): EfeitoExpurgos {
  if (!Number.isSafeInteger(quantidadeReferencia) || quantidadeReferencia < 0) {
    throw new ErroDominio('QUANTIDADE_INVALIDA', 'A quantidade do item de referência deve ser um inteiro não negativo.');
  }
  for (const c of cotacoes) exigirCentavosNaoNegativos(c.valorUnitario, 'O valor unitário da cotação');
  const media = (lista: readonly CotacaoCesta[]) => (lista.length === 0 ? null : Math.round(lista.reduce((s, c) => s + c.valorUnitario, 0) / lista.length));
  const mantidas = cotacoes.filter((c) => !c.expurgada);
  const descartadas = cotacoes.length - mantidas.length;
  const com = media(cotacoes);
  const sem = media(mantidas);
  const diferenca = descartadas > 0 && com !== null && sem !== null ? com - sem : 0;
  return {
    cotacoes: cotacoes.length,
    descartadas,
    mediaComDescartadas: com,
    mediaSemDescartadas: sem,
    diferencaUnitaria: diferenca,
    efeitoNoEstimado: diferenca * quantidadeReferencia,
  };
}

export interface ProcessoEconomia {
  processoId: string;
  valorEstimado: Centavos;
  /** Valor do contrato gerado ou, sem contrato, o da proposta homologada. */
  valorContratado: Centavos;
  cotacoes: readonly CotacaoCesta[];
  quantidadeReferencia: number;
}

export interface EconomiaProcesso {
  processoId: string;
  valorEstimado: Centavos;
  valorContratado: Centavos;
  economia: Centavos;
  economiaPercentual: number | null;
  expurgos: EfeitoExpurgos;
}

export interface ResultadoEconomia {
  processos: EconomiaProcesso[];
  totalEstimado: Centavos;
  totalContratado: Centavos;
  economia: Centavos;
  /** economia ÷ total estimado × 100 (média ponderada pelo valor); null sem processo medido. */
  economiaPercentual: number | null;
  metaPercentual: number | null;
  situacao: SituacaoMeta;
  expurgos: { processosComExpurgo: number; cotacoesDescartadas: number; efeitoNoEstimado: Centavos };
  fundamento: string;
}

/**
 * Economia medida (art. 18, § 1º, IX): diferença entre o valor estimado da contratação e o valor contratado (ou
 * homologado, enquanto não há contrato), por processo e no total, ponderada pelo valor. Negativa quando se
 * contratou acima do estimado. O efeito dos expurgos da cesta vem à parte e não se soma à economia.
 */
export function medirEconomia(entrada: { processos: readonly ProcessoEconomia[]; metaPercentual: number | null }): ResultadoEconomia {
  const processos = entrada.processos.map((p): EconomiaProcesso => {
    exigirCentavosNaoNegativos(p.valorEstimado, 'O valor estimado');
    exigirCentavosNaoNegativos(p.valorContratado, 'O valor contratado');
    const economia = p.valorEstimado - p.valorContratado;
    return {
      processoId: p.processoId,
      valorEstimado: p.valorEstimado,
      valorContratado: p.valorContratado,
      economia,
      economiaPercentual: p.valorEstimado > 0 ? arredondar((economia * 100) / p.valorEstimado, 2) : null,
      expurgos: efeitoExpurgosCesta(p.cotacoes, p.quantidadeReferencia),
    };
  });
  const totalEstimado = processos.reduce((s, p) => s + p.valorEstimado, 0);
  const totalContratado = processos.reduce((s, p) => s + p.valorContratado, 0);
  const economia = totalEstimado - totalContratado;
  const percentual = totalEstimado > 0 ? arredondar((economia * 100) / totalEstimado, 2) : null;
  const comExpurgo = processos.filter((p) => p.expurgos.descartadas > 0);
  return {
    processos,
    totalEstimado,
    totalContratado,
    economia,
    economiaPercentual: percentual,
    metaPercentual: entrada.metaPercentual,
    situacao: situacaoMeta(percentual, entrada.metaPercentual, 'a_partir'),
    expurgos: {
      processosComExpurgo: comExpurgo.length,
      cotacoesDescartadas: comExpurgo.reduce((s, p) => s + p.expurgos.descartadas, 0),
      efeitoNoEstimado: comExpurgo.reduce((s, p) => s + p.expurgos.efeitoNoEstimado, 0),
    },
    fundamento: FUNDAMENTO_METAS,
  };
}
