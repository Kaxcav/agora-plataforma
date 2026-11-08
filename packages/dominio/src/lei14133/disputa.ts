/**
 * Rito da sessão de disputa (RN-26): modos de disputa, lances, prorrogação, encerramento, classificação,
 * reinício da disputa aberta, negociação e técnica e preço.
 *
 * Fundamentos: Lei 14.133/2021, arts. 33, 34, 36, § 2º, 56, 57, 59, 60 e 61; IN SEGES/ME 73/2022, arts. 5º, 21 a 25,
 * 28 e 30 (licitação eletrônica por menor preço ou maior desconto na administração federal direta, autárquica e
 * fundacional). Para a administração federal, a sessão oficial acontece no Compras.gov.br; aqui o rito serve à
 * simulação (treino e prova de conceito) e à conferência da sessão acompanhada.
 *
 * Tudo é puro e determinístico: o estado da sessão é recalculado a partir da definição, dos eventos registrados e do
 * instante informado (`agora`). O que a norma manda sortear (fechamento iminente) usa `sorteioDeterministico`.
 */
import { ErroDominio } from '../erros.ts';
import { arredondar, formatarNumero } from '../interno.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';
import { aplicarDesempate, type Licitante } from './desempate.ts';

export type CriterioJulgamentoDisputa = 'menor_preco' | 'maior_desconto' | 'tecnica_e_preco';
export type ModoDisputa = 'aberto' | 'aberto_fechado' | 'fechado_aberto' | 'fechado';
export type FaseSessaoDisputa = 'aguardando_abertura' | 'lances_abertos' | 'fechamento_iminente' | 'lance_final_fechado' | 'encerrada' | 'concluida';
export type FaseLance = 'lances_abertos' | 'fechamento_iminente' | 'lance_final_fechado';

export const CRITERIOS_JULGAMENTO_DISPUTA: readonly { criterio: CriterioJulgamentoDisputa; rotulo: string; fundamento: string }[] = [
  { criterio: 'menor_preco', rotulo: 'Menor preço', fundamento: 'Lei 14.133/2021, art. 33, I, e art. 34' },
  { criterio: 'maior_desconto', rotulo: 'Maior desconto', fundamento: 'Lei 14.133/2021, art. 33, II, e art. 34, § 2º' },
  { criterio: 'tecnica_e_preco', rotulo: 'Técnica e preço', fundamento: 'Lei 14.133/2021, art. 33, IV, e art. 36, § 2º' },
];

export const MODOS_DISPUTA: readonly { modo: ModoDisputa; rotulo: string; fundamento: string }[] = [
  { modo: 'aberto', rotulo: 'Aberto', fundamento: 'Lei 14.133/2021, art. 56, I; IN SEGES/ME 73/2022, art. 23' },
  { modo: 'aberto_fechado', rotulo: 'Aberto e fechado', fundamento: 'Lei 14.133/2021, art. 56, caput; IN SEGES/ME 73/2022, art. 24' },
  { modo: 'fechado_aberto', rotulo: 'Fechado e aberto', fundamento: 'Lei 14.133/2021, art. 56, caput; IN SEGES/ME 73/2022, art. 25' },
  { modo: 'fechado', rotulo: 'Fechado', fundamento: 'Lei 14.133/2021, art. 56, II' },
];

/** Intervalo mínimo entre lances (art. 57): valor absoluto (centavos ou pontos percentuais) ou percentual da oferta de referência. */
export interface IntervaloMinimoLances {
  tipo: 'absoluto' | 'percentual';
  valor: number;
}

export interface ParametrosDisputa {
  duracaoEtapaAbertaSegundos: number;
  janelaProrrogacaoSegundos: number;
  prorrogacaoSegundos: number;
  fechamentoIminenteMaximoSegundos: number;
  prazoLanceFechadoSegundos: number;
  faixaSelecaoPercentual: number;
  minimoSelecionados: number;
  diferencaReinicioPercentual: number;
  intervaloMinimo: IntervaloMinimoLances | null;
  /** Peso da proposta técnica na técnica e preço (até 70%). Nulo nos demais critérios. */
  pesoTecnicoPercentual: number | null;
}

/** Fundamento de cada parâmetro configurável, exibido ao lado do valor adotado. */
export const FUNDAMENTOS_PARAMETROS_DISPUTA: Readonly<Record<keyof ParametrosDisputa, string>> = Object.freeze({
  duracaoEtapaAbertaSegundos: 'IN SEGES/ME 73/2022, art. 23, caput (10 minutos no modo aberto) e art. 24, caput (15 minutos no modo aberto e fechado)',
  janelaProrrogacaoSegundos: 'IN SEGES/ME 73/2022, art. 23, caput (lance nos últimos 2 minutos prorroga a etapa)',
  prorrogacaoSegundos: 'IN SEGES/ME 73/2022, art. 23, § 1º (prorrogação automática de 2 minutos, sucessiva, inclusive por lance intermediário)',
  fechamentoIminenteMaximoSegundos: 'IN SEGES/ME 73/2022, art. 24, § 1º (encerramento aleatório em até 10 minutos após o aviso de fechamento iminente)',
  prazoLanceFechadoSegundos: 'IN SEGES/ME 73/2022, art. 24, § 2º (lance final e fechado em até 5 minutos)',
  faixaSelecaoPercentual: 'IN SEGES/ME 73/2022, art. 24, § 2º, e art. 25, caput (10%; 20% com margem de preferência)',
  minimoSelecionados: 'IN SEGES/ME 73/2022, art. 24, § 4º, e art. 25, § 1º (até 3 melhores ofertas quando a faixa tiver menos de 3)',
  diferencaReinicioPercentual: 'Lei 14.133/2021, art. 56, § 4º; IN SEGES/ME 73/2022, art. 23, § 3º (diferença de pelo menos 5%)',
  intervaloMinimo: 'Lei 14.133/2021, art. 57; IN SEGES/ME 73/2022, art. 22, § 1º',
  pesoTecnicoPercentual: 'Lei 14.133/2021, art. 36, § 2º (proporção máxima de 70% para a proposta técnica)',
});

export interface ParticipanteDisputa {
  id: string;
  nome: string;
  /** Proposta inicial: centavos (menor preço e técnica e preço) ou percentual de desconto (maior desconto). */
  propostaInicial: number;
  /** Nota da proposta técnica, de 0 a 100 (somente técnica e preço). */
  notaTecnica?: number;
  meEpp?: boolean;
}

export interface DefinicaoSessaoDisputa {
  criterio: CriterioJulgamentoDisputa;
  modo: ModoDisputa;
  parametros: ParametrosDisputa;
  participantes: ParticipanteDisputa[];
  /** Valor estimado (centavos): base do maior desconto (art. 34, § 2º) e da verificação do art. 59, III. */
  valorReferencia: Centavos | null;
  /** Semente dos sorteios da sessão (fechamento iminente) e do simulador. */
  semente: number;
}

export type EventoSessaoDisputa =
  | { tipo: 'abertura'; instante: string }
  | { tipo: 'lance'; instante: string; licitanteId: string; valor: number }
  | { tipo: 'reinicio'; instante: string }
  | { tipo: 'negociacao'; instante: string; licitanteId: string; valor: number }
  | { tipo: 'conclusao'; instante: string };

export interface LanceSessaoDisputa {
  sequencia: number;
  licitanteId: string;
  valor: number;
  instante: string;
  fase: FaseLance;
  rodada: number;
  /** Lance que não cobre a melhor oferta (art. 56, § 3º; IN SEGES/ME 73/2022, art. 5º, I). */
  intermediario: boolean;
  origem: 'simulador' | 'registrado';
}

export interface OfertaAtual {
  licitanteId: string;
  /** Última oferta pública: proposta inicial ou último lance aberto. */
  valor: number;
  /** Instante do último lance aberto; nulo enquanto vale a proposta inicial. */
  instante: string | null;
  /** Lance final e fechado (IN SEGES/ME 73/2022, art. 24, § 2º), sigiloso até o fim do prazo. */
  lanceFinal: number | null;
  lanceFinalInstante: string | null;
  lances: number;
}

export interface MarcoSessaoDisputa {
  instante: string;
  descricao: string;
  fundamento: string;
}

export interface NegociacaoSessaoDisputa {
  instante: string;
  licitanteId: string;
  valorAnterior: number;
  valor: number;
}

export interface EstadoSessaoDisputa {
  fase: FaseSessaoDisputa;
  /** 0 = disputa original; 1, 2… = reinícios da disputa aberta (art. 56, § 4º). */
  rodada: number;
  abertaEm: string | null;
  faseIniciadaEm: string | null;
  fimPrevisto: string | null;
  /** Fim sorteado do fechamento iminente: não pode ser divulgado (IN SEGES/ME 73/2022, art. 24, § 1º). */
  fimSigiloso: boolean;
  habilitados: string[];
  ofertas: OfertaAtual[];
  melhorValor: number | null;
  liderId: string | null;
  lances: LanceSessaoDisputa[];
  recusados: { instante: string; licitanteId: string; valor: number; motivo: string }[];
  prorrogacoes: number;
  marcos: MarcoSessaoDisputa[];
  negociacoes: NegociacaoSessaoDisputa[];
  encerradaEm: string | null;
  concluidaEm: string | null;
  /** Instante para o qual o estado foi calculado. */
  calculadoAte: string;
  /** Última ocorrência processada (evento, lance ou transição de etapa). */
  ultimoInstante: string | null;
}

export type ValidacaoLance = { valido: true; intermediario: boolean } | { valido: false; motivo: string; fundamento: string };

/** Ação de licitante sintético proposta pelo simulador (instante em milissegundos desde 1970). */
export interface AcaoSimulada {
  instanteMs: number;
  licitanteId: string;
  valor: number;
}

/** Política dos licitantes sintéticos: recebe o estado e os licitantes a ignorar (ação recusada desde a última mudança). */
export type AgenteSimulado = (definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, ignorar: ReadonlySet<string>) => AcaoSimulada | null;

const FASES_DE_LANCE: ReadonlySet<FaseSessaoDisputa> = new Set<FaseSessaoDisputa>(['lances_abertos', 'fechamento_iminente', 'lance_final_fechado']);
const REGEX_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const LIMITE_ITERACOES = 200_000;
const FUNDAMENTO_ETAPA_LANCES = 'IN SEGES/ME 73/2022, art. 21';
const FUNDAMENTO_LANCE_PROPRIO = 'IN SEGES/ME 73/2022, art. 21, § 2º';
const FUNDAMENTO_INTERMEDIARIO = 'Lei 14.133/2021, art. 56, § 3º; IN SEGES/ME 73/2022, art. 5º, I';
const FUNDAMENTO_REINICIO = 'Lei 14.133/2021, art. 56, § 4º; IN SEGES/ME 73/2022, art. 23, §§ 3º e 4º';
const FUNDAMENTO_NEGOCIACAO = 'Lei 14.133/2021, art. 61; IN SEGES/ME 73/2022, art. 30';

// ───────────────────────── utilitários ─────────────────────────

/** Milissegundos de um instante ISO 8601 com fuso (ex.: 2026-11-09T13:00:00.000Z). */
function ms(instante: string, campo = 'instante'): number {
  if (typeof instante !== 'string' || !REGEX_INSTANTE.test(instante)) {
    throw new ErroDominio('INSTANTE_INVALIDO', `${campo} deve ser um instante ISO 8601 com fuso (recebido: ${String(instante)}).`);
  }
  const valor = Date.parse(instante);
  if (!Number.isFinite(valor)) throw new ErroDominio('INSTANTE_INVALIDO', `${campo} inválido: ${instante}.`);
  return valor;
}

function iso(valorMs: number): string {
  return new Date(valorMs).toISOString();
}

/**
 * Número pseudoaleatório reprodutível em [0, 1) a partir da semente e das partes (FNV-1a + mistura mulberry32).
 * Usado no sorteio do fechamento iminente e no simulador: a mesma entrada produz sempre o mesmo resultado.
 */
export function sorteioDeterministico(semente: number, ...partes: readonly (string | number)[]): number {
  let h = 0x811c9dc5;
  const texto = `${semente}|${partes.join('|')}`;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

/** `a` é melhor que `b` pelo critério: menor valor (preço) ou maior percentual (desconto). */
export function ofertaMelhor(criterio: CriterioJulgamentoDisputa, a: number, b: number): boolean {
  return criterio === 'maior_desconto' ? a > b : a < b;
}

/** Valor da oferta formatado: moeda ou percentual de desconto. */
export function formatarOferta(criterio: CriterioJulgamentoDisputa, valor: number): string {
  return criterio === 'maior_desconto' ? `${formatarNumero(valor)}% de desconto` : formatarMoeda(valor);
}

function formatarDiferenca(criterio: CriterioJulgamentoDisputa, valor: number): string {
  return criterio === 'maior_desconto' ? `${formatarNumero(valor)} ponto(s) percentual(is)` : formatarMoeda(valor);
}

function ehPositivoInteiro(v: unknown, minimo = 1): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= minimo;
}

/** Valor da oferta válido para o critério: centavos inteiros positivos ou desconto entre 0 e 100 com até 2 casas. */
export function ofertaValida(criterio: CriterioJulgamentoDisputa, valor: number): boolean {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return false;
  if (criterio === 'maior_desconto') return valor > 0 && valor < 100 && arredondar(valor, 2) === valor;
  return Number.isSafeInteger(valor) && valor > 0;
}

/** Preço equivalente em centavos: o próprio valor, ou a referência com o desconto aplicado (art. 34, § 2º). */
export function precoEquivalente(definicao: Pick<DefinicaoSessaoDisputa, 'criterio' | 'valorReferencia'>, valor: number): Centavos {
  if (definicao.criterio !== 'maior_desconto') return valor;
  const referencia = definicao.valorReferencia ?? 0;
  return Math.round((referencia * (100 - valor)) / 100);
}

// ───────────────────────── modos e parâmetros ─────────────────────────

/**
 * Confere a combinação de critério e modo (Lei 14.133/2021, art. 56): o modo fechado isolado é vedado no menor preço e
 * no maior desconto (§ 1º); o modo aberto, isolado ou combinado, é vedado na técnica e preço (§ 2º).
 */
export function validarModoDisputa(criterio: CriterioJulgamentoDisputa, modo: ModoDisputa): { fundamento: string } {
  if (!CRITERIOS_JULGAMENTO_DISPUTA.some((c) => c.criterio === criterio)) {
    throw new ErroDominio('CRITERIO_JULGAMENTO_INVALIDO', `Critério de julgamento desconhecido: ${String(criterio)}.`);
  }
  const definicao = MODOS_DISPUTA.find((m) => m.modo === modo);
  if (!definicao) throw new ErroDominio('MODO_DISPUTA_INVALIDO', `Modo de disputa desconhecido: ${String(modo)}.`);
  if (modo === 'fechado' && criterio !== 'tecnica_e_preco') {
    throw new ErroDominio('MODO_DISPUTA_VEDADO', 'O modo de disputa fechado isolado é vedado nos critérios de menor preço e de maior desconto (Lei 14.133/2021, art. 56, § 1º).');
  }
  if (modo !== 'fechado' && criterio === 'tecnica_e_preco') {
    throw new ErroDominio('MODO_DISPUTA_VEDADO', 'O modo de disputa aberto é vedado no critério de técnica e preço: use o modo fechado (Lei 14.133/2021, art. 56, § 2º).');
  }
  return { fundamento: definicao.fundamento };
}

/**
 * Parâmetros padrão do rito: 10 minutos de etapa aberta (15 no aberto e fechado), prorrogação automática de 2 minutos
 * por lance nos 2 minutos finais, fechamento iminente aleatório de até 10 minutos, lance final e fechado em 5 minutos,
 * faixa de 10% com no mínimo 3 ofertas (IN SEGES/ME 73/2022, arts. 23 a 25), reinício com 5% de diferença
 * (Lei 14.133/2021, art. 56, § 4º) e peso técnico de 70% na técnica e preço (art. 36, § 2º). Ajustes do edital
 * substituem o padrão e são validados por `validarParametrosDisputa`.
 */
export function parametrosPadraoDisputa(
  modo: ModoDisputa,
  criterio: CriterioJulgamentoDisputa,
  ajustes: Partial<ParametrosDisputa> = {},
): ParametrosDisputa {
  validarModoDisputa(criterio, modo);
  const parametros: ParametrosDisputa = {
    duracaoEtapaAbertaSegundos: modo === 'aberto_fechado' ? 900 : 600,
    janelaProrrogacaoSegundos: 120,
    prorrogacaoSegundos: 120,
    fechamentoIminenteMaximoSegundos: 600,
    prazoLanceFechadoSegundos: 300,
    faixaSelecaoPercentual: 10,
    minimoSelecionados: 3,
    diferencaReinicioPercentual: 5,
    intervaloMinimo: null,
    pesoTecnicoPercentual: criterio === 'tecnica_e_preco' ? 70 : null,
  };
  for (const [chave, valor] of Object.entries(ajustes) as [keyof ParametrosDisputa, ParametrosDisputa[keyof ParametrosDisputa]][]) {
    if (valor !== undefined) (parametros as unknown as Record<string, unknown>)[chave] = valor;
  }
  validarParametrosDisputa(criterio, modo, parametros);
  return parametros;
}

/** Valida os parâmetros configuráveis da sessão; erro `PARAMETRO_DISPUTA_INVALIDO` ou `PESO_TECNICO_INVALIDO` (art. 36, § 2º). */
export function validarParametrosDisputa(criterio: CriterioJulgamentoDisputa, modo: ModoDisputa, p: ParametrosDisputa): void {
  validarModoDisputa(criterio, modo);
  const faixa = (campo: keyof ParametrosDisputa, valor: unknown, min: number, max: number) => {
    if (!ehPositivoInteiro(valor, min) || valor > max) {
      throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', `${campo} deve ser um inteiro entre ${min} e ${max} (recebido: ${String(valor)}).`);
    }
  };
  faixa('duracaoEtapaAbertaSegundos', p.duracaoEtapaAbertaSegundos, 60, 14_400);
  faixa('janelaProrrogacaoSegundos', p.janelaProrrogacaoSegundos, 1, 3_600);
  faixa('prorrogacaoSegundos', p.prorrogacaoSegundos, 1, 3_600);
  faixa('fechamentoIminenteMaximoSegundos', p.fechamentoIminenteMaximoSegundos, 1, 3_600);
  faixa('prazoLanceFechadoSegundos', p.prazoLanceFechadoSegundos, 60, 3_600);
  faixa('minimoSelecionados', p.minimoSelecionados, 1, 20);
  for (const campo of ['faixaSelecaoPercentual', 'diferencaReinicioPercentual'] as const) {
    const v = p[campo];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 50) {
      throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', `${campo} deve ser um percentual maior que 0 e até 50 (recebido: ${String(v)}).`);
    }
  }
  if (p.intervaloMinimo !== null) {
    const { tipo, valor } = p.intervaloMinimo;
    if ((tipo !== 'absoluto' && tipo !== 'percentual') || typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', 'O intervalo mínimo entre lances deve ser positivo, absoluto ou percentual (art. 57).');
    }
    if (tipo === 'percentual' && valor > 20) {
      throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', 'O intervalo mínimo percentual não pode passar de 20% da oferta de referência.');
    }
    if (tipo === 'absoluto' && criterio !== 'maior_desconto' && !Number.isSafeInteger(valor)) {
      throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', 'O intervalo mínimo absoluto é informado em centavos inteiros.');
    }
  }
  if (criterio === 'tecnica_e_preco') {
    const peso = p.pesoTecnicoPercentual;
    if (typeof peso !== 'number' || !Number.isFinite(peso) || peso <= 0 || peso > 70) {
      throw new ErroDominio(
        'PESO_TECNICO_INVALIDO',
        `Na técnica e preço, a proposta técnica pesa mais de 0% e no máximo 70% (Lei 14.133/2021, art. 36, § 2º); recebido: ${String(peso)}.`,
      );
    }
  } else if (p.pesoTecnicoPercentual !== null) {
    throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', 'O peso técnico só se aplica ao critério de técnica e preço.');
  }
}

/** Valida a definição da sessão: modo, parâmetros, participantes únicos e propostas válidas para o critério. */
export function validarDefinicaoSessao(d: DefinicaoSessaoDisputa): void {
  validarParametrosDisputa(d.criterio, d.modo, d.parametros);
  if (!Array.isArray(d.participantes) || d.participantes.length === 0) {
    throw new ErroDominio('PARTICIPANTES_INVALIDOS', 'A sessão precisa de ao menos um participante.');
  }
  const ids = new Set<string>();
  for (const p of d.participantes) {
    if (typeof p.id !== 'string' || p.id === '' || ids.has(p.id)) {
      throw new ErroDominio('PARTICIPANTES_INVALIDOS', `Participante repetido ou sem identificador: ${String(p.id)}.`);
    }
    ids.add(p.id);
    if (!ofertaValida(d.criterio, p.propostaInicial)) {
      throw new ErroDominio('PARTICIPANTES_INVALIDOS', `Proposta inicial inválida de ${p.nome}: ${String(p.propostaInicial)}.`);
    }
    if (d.criterio === 'tecnica_e_preco' && (typeof p.notaTecnica !== 'number' || !Number.isFinite(p.notaTecnica) || p.notaTecnica < 0 || p.notaTecnica > 100)) {
      throw new ErroDominio('PARTICIPANTES_INVALIDOS', `Na técnica e preço, informe a nota técnica de 0 a 100 de ${p.nome}.`);
    }
  }
  if (d.criterio === 'maior_desconto' && (d.valorReferencia === null || !ehPositivoInteiro(d.valorReferencia))) {
    throw new ErroDominio('VALOR_REFERENCIA_OBRIGATORIO', 'No maior desconto, o preço global de referência do edital é obrigatório (Lei 14.133/2021, art. 34, § 2º).');
  }
  if (!Number.isSafeInteger(d.semente)) throw new ErroDominio('PARAMETRO_DISPUTA_INVALIDO', 'A semente da sessão deve ser um inteiro.');
}

/**
 * Seleção para a etapa seguinte: a melhor oferta e as que estejam até `faixaPercentual` piores; se forem menos que
 * `minimo`, as `minimo` melhores, considerados os empatados (IN SEGES/ME 73/2022, art. 24, §§ 2º e 4º; art. 25, § 1º).
 */
export function selecionarLicitantesFaixa(
  criterio: CriterioJulgamentoDisputa,
  ofertas: readonly { licitanteId: string; valor: number }[],
  faixaPercentual: number,
  minimo: number,
): string[] {
  if (ofertas.length === 0) return [];
  const ordenadas = [...ofertas].sort((a, b) => (ofertaMelhor(criterio, a.valor, b.valor) ? -1 : ofertaMelhor(criterio, b.valor, a.valor) ? 1 : 0));
  const melhor = ordenadas[0]?.valor ?? 0;
  const dentro = ordenadas.filter((o) =>
    criterio === 'maior_desconto' ? o.valor >= melhor * (1 - faixaPercentual / 100) : o.valor <= melhor * (1 + faixaPercentual / 100),
  );
  if (dentro.length >= minimo) return dentro.map((o) => o.licitanteId);
  const corte = ordenadas[Math.min(minimo, ordenadas.length) - 1]?.valor ?? melhor;
  return ordenadas.filter((o) => !ofertaMelhor(criterio, corte, o.valor)).map((o) => o.licitanteId);
}

/** Diferença mínima exigida em relação à oferta de referência (art. 57). */
export function diferencaMinimaLance(criterio: CriterioJulgamentoDisputa, intervalo: IntervaloMinimoLances | null, referencia: number): number {
  if (intervalo === null) return 0;
  if (intervalo.tipo === 'absoluto') return intervalo.valor;
  const bruto = (Math.abs(referencia) * intervalo.valor) / 100;
  return criterio === 'maior_desconto' ? arredondar(bruto, 2) : Math.ceil(bruto);
}

// ───────────────────────── estado da sessão ─────────────────────────

function oferta(estado: EstadoSessaoDisputa, id: string): OfertaAtual | undefined {
  return estado.ofertas.find((o) => o.licitanteId === id);
}

/** Melhor oferta pública e quem a detém: empatados, prevalece quem a registrou primeiro (o igual é intermediário). */
function atualizarLider(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa): void {
  let lider: OfertaAtual | null = null;
  for (const o of estado.ofertas) {
    if (lider === null || ofertaMelhor(definicao.criterio, o.valor, lider.valor)) {
      lider = o;
      continue;
    }
    if (o.valor === lider.valor && o.instante !== null && lider.instante !== null && ms(o.instante) < ms(lider.instante)) lider = o;
  }
  estado.melhorValor = lider?.valor ?? null;
  estado.liderId = lider?.licitanteId ?? null;
}

function marco(estado: EstadoSessaoDisputa, instanteMs: number, descricao: string, fundamento: string): void {
  estado.marcos.push({ instante: iso(instanteMs), descricao, fundamento });
}

function prorrogavel(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa): boolean {
  return estado.fase === 'lances_abertos' && (definicao.modo !== 'aberto_fechado' || estado.rodada > 0);
}

function iniciarEtapaAberta(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  t: number,
  habilitados: string[],
  descricao: string,
  fundamento: string,
): void {
  estado.fase = 'lances_abertos';
  estado.faseIniciadaEm = iso(t);
  estado.fimPrevisto = iso(t + definicao.parametros.duracaoEtapaAbertaSegundos * 1000);
  estado.fimSigiloso = false;
  estado.habilitados = habilitados;
  marco(estado, t, descricao, fundamento);
}

function encerrarLances(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, t: number, descricao: string, fundamento: string): void {
  for (const o of estado.ofertas) {
    if (o.lanceFinal !== null) {
      o.valor = o.lanceFinal;
      o.instante = o.lanceFinalInstante;
    }
  }
  atualizarLider(definicao, estado);
  estado.fase = 'encerrada';
  estado.encerradaEm = iso(t);
  estado.fimPrevisto = null;
  estado.fimSigiloso = false;
  estado.habilitados = [];
  marco(estado, t, descricao, fundamento);
}

function abrir(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, t: number): void {
  estado.abertaEm = iso(t);
  atualizarLider(definicao, estado);
  const todos = definicao.participantes.map((p) => p.id);
  const { modo, criterio, parametros } = definicao;
  if (modo === 'fechado') {
    marco(estado, t, 'Sessão aberta: propostas fechadas divulgadas na data e hora designadas', 'Lei 14.133/2021, art. 56, II');
    encerrarLances(definicao, estado, t, 'Propostas classificadas para julgamento (modo fechado)', 'Lei 14.133/2021, arts. 56, II, e 59');
    return;
  }
  if (modo === 'fechado_aberto') {
    const selecionados = selecionarLicitantesFaixa(criterio, estado.ofertas, parametros.faixaSelecaoPercentual, parametros.minimoSelecionados);
    marco(
      estado,
      t,
      `Sessão aberta: propostas fechadas divulgadas; ${selecionados.length} de ${todos.length} licitante(s) na faixa de ${formatarNumero(parametros.faixaSelecaoPercentual)}% seguem para a etapa aberta`,
      'IN SEGES/ME 73/2022, art. 25, caput e § 1º',
    );
    iniciarEtapaAberta(definicao, estado, t, selecionados, 'Início da etapa aberta de lances', 'IN SEGES/ME 73/2022, arts. 23 e 25');
    return;
  }
  marco(estado, t, 'Sessão pública aberta', 'IN SEGES/ME 73/2022, art. 20');
  iniciarEtapaAberta(
    definicao,
    estado,
    t,
    todos,
    modo === 'aberto_fechado' ? 'Início da etapa aberta de lances (modo aberto e fechado)' : 'Início da etapa de lances (modo aberto)',
    modo === 'aberto_fechado' ? 'IN SEGES/ME 73/2022, art. 24, caput' : 'IN SEGES/ME 73/2022, art. 23, caput',
  );
}

function processarFimDeEtapa(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, t: number): void {
  const { parametros, criterio } = definicao;
  if (estado.fase === 'lances_abertos') {
    if (definicao.modo === 'aberto_fechado' && estado.rodada === 0) {
      const sorteio = 1 + Math.floor(sorteioDeterministico(definicao.semente, 'fechamento-iminente', estado.rodada) * parametros.fechamentoIminenteMaximoSegundos);
      estado.fase = 'fechamento_iminente';
      estado.faseIniciadaEm = iso(t);
      estado.fimPrevisto = iso(t + Math.min(sorteio, parametros.fechamentoIminenteMaximoSegundos) * 1000);
      estado.fimSigiloso = true;
      marco(
        estado,
        t,
        `Aviso de fechamento iminente: a recepção de lances termina em até ${formatarNumero(parametros.fechamentoIminenteMaximoSegundos / 60)} minuto(s), em momento sorteado`,
        'IN SEGES/ME 73/2022, art. 24, § 1º',
      );
      return;
    }
    encerrarLances(
      definicao,
      estado,
      t,
      estado.rodada > 0 ? 'Reinício da disputa aberta encerrado sem novos lances no período de prorrogação' : 'Etapa de lances encerrada sem novos lances no período de prorrogação',
      'IN SEGES/ME 73/2022, art. 23, § 2º',
    );
    return;
  }
  if (estado.fase === 'fechamento_iminente') {
    const selecionados = selecionarLicitantesFaixa(criterio, estado.ofertas, parametros.faixaSelecaoPercentual, parametros.minimoSelecionados);
    estado.fase = 'lance_final_fechado';
    estado.faseIniciadaEm = iso(t);
    estado.fimPrevisto = iso(t + parametros.prazoLanceFechadoSegundos * 1000);
    estado.fimSigiloso = false;
    estado.habilitados = selecionados;
    marco(
      estado,
      t,
      `Etapa aberta encerrada; ${selecionados.length} licitante(s) convocado(s) para o lance final e fechado, sigiloso até o fim do prazo`,
      'IN SEGES/ME 73/2022, art. 24, §§ 2º a 4º',
    );
    return;
  }
  if (estado.fase === 'lance_final_fechado') {
    encerrarLances(definicao, estado, t, 'Prazo do lance final e fechado encerrado; lances ordenados e divulgados', 'IN SEGES/ME 73/2022, art. 24, § 5º');
  }
}

function recusa(motivo: string, fundamento: string): ValidacaoLance {
  return { valido: false, motivo, fundamento };
}

/**
 * Confere um lance contra o estado da sessão no instante do lance: etapa de lances em curso e dentro do prazo,
 * licitante convocado para a etapa, valor melhor que o último do próprio licitante (IN SEGES/ME 73/2022, art. 21, § 2º),
 * intervalo mínimo em relação à melhor oferta ou ao último lance próprio (Lei 14.133/2021, art. 57), só lances
 * intermediários no reinício (art. 56, § 4º) e lance final único e sigiloso (IN 73/2022, art. 24, §§ 2º e 3º).
 */
export function validarLance(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  lance: { licitanteId: string; valor: number; instante: string },
): ValidacaoLance {
  const t = ms(lance.instante);
  if (!FASES_DE_LANCE.has(estado.fase)) return recusa('A sessão não está em etapa de lances.', FUNDAMENTO_ETAPA_LANCES);
  if (estado.faseIniciadaEm !== null && t < ms(estado.faseIniciadaEm)) return recusa('O lance é anterior ao início da etapa.', FUNDAMENTO_ETAPA_LANCES);
  if (estado.fimPrevisto !== null && t >= ms(estado.fimPrevisto)) return recusa('O prazo da etapa de lances já terminou.', FUNDAMENTO_ETAPA_LANCES);
  if (!estado.habilitados.includes(lance.licitanteId)) {
    return recusa('O licitante não está convocado para esta etapa de lances.', 'IN SEGES/ME 73/2022, arts. 24, § 2º, e 25; Lei 14.133/2021, art. 56, § 4º');
  }
  if (!ofertaValida(definicao.criterio, lance.valor)) {
    return recusa(
      definicao.criterio === 'maior_desconto' ? 'Informe um desconto maior que 0% e menor que 100%, com até 2 casas decimais.' : 'Informe um valor positivo em centavos.',
      FUNDAMENTO_ETAPA_LANCES,
    );
  }
  const propria = oferta(estado, lance.licitanteId);
  if (!propria) return recusa('Licitante desconhecido nesta sessão.', FUNDAMENTO_ETAPA_LANCES);
  const { criterio } = definicao;
  if (estado.fase === 'lance_final_fechado') {
    if (propria.lanceFinal !== null) return recusa('O lance final e fechado é único.', 'IN SEGES/ME 73/2022, art. 24, § 2º');
    if (!ofertaMelhor(criterio, lance.valor, propria.valor)) {
      return recusa('O lance final deve ser melhor que o último lance do licitante; para mantê-lo, basta não enviar novo lance.', 'IN SEGES/ME 73/2022, art. 24, § 3º');
    }
    return { valido: true, intermediario: false };
  }
  if (!ofertaMelhor(criterio, lance.valor, propria.valor)) {
    return recusa(`O lance deve ser melhor que o último lance do próprio licitante (${formatarOferta(criterio, propria.valor)}).`, FUNDAMENTO_LANCE_PROPRIO);
  }
  const melhor = estado.melhorValor;
  const cobre = melhor !== null && ofertaMelhor(criterio, lance.valor, melhor);
  if (estado.rodada > 0 && cobre) {
    return recusa('No reinício da disputa aberta só são admitidos lances intermediários, que não cobrem a melhor oferta.', FUNDAMENTO_REINICIO);
  }
  const referencia = cobre && melhor !== null ? melhor : propria.valor;
  const exigida = diferencaMinimaLance(criterio, definicao.parametros.intervaloMinimo, referencia);
  const diferenca = arredondar(Math.abs(referencia - lance.valor), 2);
  if (exigida > 0 && diferenca < exigida) {
    return recusa(
      `A diferença mínima entre lances é de ${formatarDiferenca(criterio, exigida)} em relação ${cobre ? 'à melhor oferta' : 'ao último lance do próprio licitante'}.`,
      'Lei 14.133/2021, art. 57',
    );
  }
  return { valido: true, intermediario: !cobre };
}

function aplicarLance(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  lance: { licitanteId: string; valor: number },
  t: number,
  intermediario: boolean,
  origem: LanceSessaoDisputa['origem'],
): void {
  const propria = oferta(estado, lance.licitanteId);
  if (!propria || !FASES_DE_LANCE.has(estado.fase)) return;
  const fase = estado.fase as FaseLance;
  estado.lances.push({
    sequencia: estado.lances.length + 1,
    licitanteId: lance.licitanteId,
    valor: lance.valor,
    instante: iso(t),
    fase,
    rodada: estado.rodada,
    intermediario,
    origem,
  });
  if (fase === 'lance_final_fechado') {
    propria.lanceFinal = lance.valor;
    propria.lanceFinalInstante = iso(t);
    return;
  }
  propria.valor = lance.valor;
  propria.instante = iso(t);
  propria.lances += 1;
  atualizarLider(definicao, estado);
  if (prorrogavel(definicao, estado) && estado.fimPrevisto !== null) {
    const fim = ms(estado.fimPrevisto);
    const { janelaProrrogacaoSegundos, prorrogacaoSegundos } = definicao.parametros;
    const novoFim = t + prorrogacaoSegundos * 1000;
    if (fim - t <= janelaProrrogacaoSegundos * 1000 && novoFim > fim) {
      estado.fimPrevisto = iso(novoFim);
      estado.prorrogacoes += 1;
      if (estado.prorrogacoes === 1) {
        marco(estado, t, 'Lance nos minutos finais: prorrogação automática da etapa de lances', 'IN SEGES/ME 73/2022, art. 23, caput e § 1º');
      }
    }
  }
}

function novoEstado(definicao: DefinicaoSessaoDisputa, agora: string): EstadoSessaoDisputa {
  return {
    fase: 'aguardando_abertura',
    rodada: 0,
    abertaEm: null,
    faseIniciadaEm: null,
    fimPrevisto: null,
    fimSigiloso: false,
    habilitados: [],
    ofertas: definicao.participantes.map((p) => ({
      licitanteId: p.id,
      valor: p.propostaInicial,
      instante: null,
      lanceFinal: null,
      lanceFinalInstante: null,
      lances: 0,
    })),
    melhorValor: null,
    liderId: null,
    lances: [],
    recusados: [],
    prorrogacoes: 0,
    marcos: [],
    negociacoes: [],
    encerradaEm: null,
    concluidaEm: null,
    calculadoAte: agora,
    ultimoInstante: null,
  };
}

/** Confere uma ação de controle (abertura, reinício, negociação, conclusão) ou um lance; erro `ACAO_SESSAO_INVALIDA` ou `LANCE_RECUSADO`. */
export function verificarAcaoSessao(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, evento: EventoSessaoDisputa): void {
  switch (evento.tipo) {
    case 'abertura':
      if (estado.fase !== 'aguardando_abertura') throw new ErroDominio('ACAO_SESSAO_INVALIDA', 'A sessão já foi aberta.');
      return;
    case 'lance': {
      const v = validarLance(definicao, estado, evento);
      if (!v.valido) throw new ErroDominio('LANCE_RECUSADO', `${v.motivo} (${v.fundamento})`);
      return;
    }
    case 'reinicio': {
      const r = avaliarReinicioDisputa(definicao, estado);
      if (!r.cabivel) throw new ErroDominio('ACAO_SESSAO_INVALIDA', `${r.motivo} (${r.fundamento})`);
      return;
    }
    case 'negociacao': {
      if (estado.fase !== 'encerrada') throw new ErroDominio('ACAO_SESSAO_INVALIDA', `A negociação ocorre depois do encerramento dos lances e antes da conclusão da sessão (${FUNDAMENTO_NEGOCIACAO}).`);
      const c = classificarSessaoDisputa(definicao, estado);
      const primeiro = c.classificacao[0];
      if (!primeiro || primeiro.id !== evento.licitanteId) {
        throw new ErroDominio('ACAO_SESSAO_INVALIDA', `A negociação é feita com o primeiro colocado (${FUNDAMENTO_NEGOCIACAO}).`);
      }
      if (!ofertaValida(definicao.criterio, evento.valor) || !ofertaMelhor(definicao.criterio, evento.valor, primeiro.valorOfertado)) {
        throw new ErroDominio(
          'ACAO_SESSAO_INVALIDA',
          `A proposta negociada deve ser mais vantajosa que ${formatarOferta(definicao.criterio, primeiro.valorOfertado)} (${FUNDAMENTO_NEGOCIACAO}).`,
        );
      }
      return;
    }
    case 'conclusao':
      if (estado.fase !== 'encerrada') throw new ErroDominio('ACAO_SESSAO_INVALIDA', 'A sessão só é concluída depois do encerramento da etapa de lances.');
      return;
    default:
      throw new ErroDominio('ACAO_SESSAO_INVALIDA', 'Ação desconhecida.');
  }
}

function aplicarEvento(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa, evento: EventoSessaoDisputa, t: number): void {
  if (evento.tipo === 'lance') {
    const v = validarLance(definicao, estado, evento);
    if (v.valido) aplicarLance(definicao, estado, evento, t, v.intermediario, 'registrado');
    else estado.recusados.push({ instante: iso(t), licitanteId: evento.licitanteId, valor: evento.valor, motivo: `${v.motivo} (${v.fundamento})` });
    return;
  }
  try {
    verificarAcaoSessao(definicao, estado, evento);
  } catch (erro) {
    if (erro instanceof ErroDominio) return;
    throw erro;
  }
  switch (evento.tipo) {
    case 'abertura':
      abrir(definicao, estado, t);
      return;
    case 'reinicio': {
      const primeiro = classificarSessaoDisputa(definicao, estado).classificacao[0]?.id;
      estado.rodada += 1;
      estado.encerradaEm = null;
      iniciarEtapaAberta(
        definicao,
        estado,
        t,
        definicao.participantes.map((p) => p.id).filter((id) => id !== primeiro),
        `Reinício da disputa aberta para definir as demais colocações (rodada ${estado.rodada}); só lances intermediários`,
        FUNDAMENTO_REINICIO,
      );
      return;
    }
    case 'negociacao': {
      const anterior = classificarSessaoDisputa(definicao, estado).classificacao[0];
      estado.negociacoes.push({ instante: iso(t), licitanteId: evento.licitanteId, valorAnterior: anterior?.valorOfertado ?? evento.valor, valor: evento.valor });
      marco(estado, t, `Negociação com o primeiro colocado: ${formatarOferta(definicao.criterio, evento.valor)}`, FUNDAMENTO_NEGOCIACAO);
      return;
    }
    case 'conclusao':
      estado.fase = 'concluida';
      estado.concluidaEm = iso(t);
      marco(estado, t, 'Sessão concluída pelo agente de contratação; resultado registrado no processo', 'Lei 14.133/2021, arts. 59 a 61');
      return;
  }
}

/**
 * Estado da sessão no instante `agora`, recalculado a partir dos eventos (abertura, lances, reinício, negociação,
 * conclusão) e, na simulação, das ações dos licitantes sintéticos (`opcoes.simulador`). As transições por tempo —
 * prorrogação automática, fechamento iminente sorteado, lance final e fechado e encerramento — seguem a
 * IN SEGES/ME 73/2022, arts. 23 a 25. No mesmo instante, o fim da etapa vem antes dos eventos (lance no último
 * instante não é aceito) e os eventos registrados vêm antes das ações simuladas.
 */
export function calcularEstadoSessao(
  definicao: DefinicaoSessaoDisputa,
  eventos: readonly EventoSessaoDisputa[],
  agora: string,
  opcoes: { simulador?: AgenteSimulado } = {},
): EstadoSessaoDisputa {
  validarDefinicaoSessao(definicao);
  const limite = ms(agora, 'agora');
  const estado = novoEstado(definicao, agora);
  const ordenados = eventos.map((e, i) => ({ e, i, t: ms(e.instante) })).sort((a, b) => a.t - b.t || a.i - b.i);
  let proximo = 0;
  let ignorar = new Set<string>();
  let ultimo = Number.NEGATIVE_INFINITY;

  for (let iteracao = 0; ; iteracao++) {
    if (iteracao > LIMITE_ITERACOES) throw new ErroDominio('SESSAO_SEM_CONVERGENCIA', 'A sessão não convergiu: revise os eventos e os parâmetros.');
    const evento = ordenados[proximo];
    const tEvento = evento ? evento.t : Number.POSITIVE_INFINITY;
    const temporizada = estado.fimPrevisto !== null && FASES_DE_LANCE.has(estado.fase);
    const tFim = temporizada && estado.fimPrevisto !== null ? ms(estado.fimPrevisto) : Number.POSITIVE_INFINITY;
    const acao = opcoes.simulador && FASES_DE_LANCE.has(estado.fase) ? opcoes.simulador(definicao, estado, ignorar) : null;
    const tAcao = acao ? Math.max(acao.instanteMs, ultimo) : Number.POSITIVE_INFINITY;
    const t = Math.min(tEvento, tFim, tAcao);
    if (!Number.isFinite(t) || t > limite) break;

    if (tFim <= tEvento && tFim <= tAcao) {
      processarFimDeEtapa(definicao, estado, tFim);
    } else if (evento && tEvento <= tAcao) {
      aplicarEvento(definicao, estado, evento.e, tEvento);
      proximo += 1;
    } else if (acao) {
      const lance = { licitanteId: acao.licitanteId, valor: acao.valor, instante: iso(tAcao) };
      const v = validarLance(definicao, estado, lance);
      if (!v.valido) {
        ignorar.add(acao.licitanteId);
        continue;
      }
      aplicarLance(definicao, estado, lance, tAcao, v.intermediario, 'simulador');
    }
    ignorar = new Set();
    ultimo = t;
    estado.ultimoInstante = iso(t);
  }
  estado.calculadoAte = agora;
  return estado;
}

// ───────────────────────── julgamento ─────────────────────────

export interface OfertaParaClassificar {
  licitanteId: string;
  valor: number;
  /** Instante do lance que fixou o valor; nulo para proposta sem lance. */
  instante: string | null;
  origem: 'proposta' | 'lance' | 'lance_final' | 'negociacao';
}

export interface ClassificadoSessao {
  id: string;
  nome: string;
  posicao: number;
  /** Centavos: valor ofertado (preço), preço com desconto (art. 34, § 2º) ou preço na técnica e preço. */
  valorConsiderado: Centavos;
  valorOfertado: number;
  origem: OfertaParaClassificar['origem'];
  notaTecnica: number | null;
  notaPreco: number | null;
  notaFinal: number | null;
}

export interface ClassificacaoSessaoDisputa {
  classificacao: ClassificadoSessao[];
  empateDetectado: boolean;
  criterioDecisivo: string | null;
  passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[];
  sorteioNecessario: boolean;
  /** Art. 59, III: melhor oferta acima do orçamento estimado (sinal para o agente; desclassificar é decisão humana). */
  acimaDoEstimado: boolean | null;
  memoria: string[];
  fundamento: string;
}

/**
 * Técnica e preço (Lei 14.133/2021, art. 36, § 2º): nota de preço = 100 × menor preço ÷ preço; nota final =
 * peso técnico × nota técnica + (100 − peso técnico) × nota de preço, com peso técnico de até 70%.
 */
export function pontuarTecnicaEPreco(
  propostas: readonly { id: string; notaTecnica: number; preco: Centavos }[],
  pesoTecnicoPercentual: number,
): { id: string; notaTecnica: number; notaPreco: number; notaFinal: number }[] {
  if (typeof pesoTecnicoPercentual !== 'number' || !Number.isFinite(pesoTecnicoPercentual) || pesoTecnicoPercentual <= 0 || pesoTecnicoPercentual > 70) {
    throw new ErroDominio(
      'PESO_TECNICO_INVALIDO',
      `A proposta técnica pesa mais de 0% e no máximo 70% (Lei 14.133/2021, art. 36, § 2º); recebido: ${String(pesoTecnicoPercentual)}.`,
    );
  }
  if (propostas.length === 0) return [];
  for (const p of propostas) {
    if (!ehPositivoInteiro(p.preco) || typeof p.notaTecnica !== 'number' || p.notaTecnica < 0 || p.notaTecnica > 100) {
      throw new ErroDominio('PROPOSTA_TECNICA_PRECO_INVALIDA', `Proposta inválida de ${p.id}: preço positivo em centavos e nota técnica de 0 a 100.`);
    }
  }
  const menor = Math.min(...propostas.map((p) => p.preco));
  return propostas.map((p) => {
    const notaPreco = arredondar((100 * menor) / p.preco, 2);
    const notaFinal = arredondar((pesoTecnicoPercentual * p.notaTecnica + (100 - pesoTecnicoPercentual) * notaPreco) / 100, 2);
    return { id: p.id, notaTecnica: p.notaTecnica, notaPreco, notaFinal };
  });
}

function paraLicitante(definicao: DefinicaoSessaoDisputa, id: string, valor: Centavos): Licitante {
  const p = definicao.participantes.find((x) => x.id === id);
  return { id, nome: p?.nome ?? id, valorProposta: valor, meEpp: p?.meEpp ?? false };
}

/**
 * Classifica as ofertas finais pelo critério de julgamento. Empate de valores alcançados por lance: prevalece o lance
 * registrado primeiro, porque o igual é intermediário (IN SEGES/ME 73/2022, art. 5º, I). Empate sem lance (propostas
 * iguais, inclusive na técnica e preço): critérios do art. 60 por `aplicarDesempate` (IN 73/2022, art. 28). A última
 * negociação com o primeiro colocado (art. 61) substitui o valor dele. Devolve também o sinal do art. 59, III.
 */
export function classificarOfertas(
  definicao: DefinicaoSessaoDisputa,
  ofertas: readonly OfertaParaClassificar[],
  negociacoes: readonly NegociacaoSessaoDisputa[] = [],
): ClassificacaoSessaoDisputa {
  const { criterio } = definicao;
  const nome = (id: string) => definicao.participantes.find((p) => p.id === id)?.nome ?? id;
  const memoria: string[] = [];
  const tp =
    criterio === 'tecnica_e_preco'
      ? new Map(
          pontuarTecnicaEPreco(
            ofertas.map((o) => ({ id: o.licitanteId, preco: o.valor, notaTecnica: definicao.participantes.find((p) => p.id === o.licitanteId)?.notaTecnica ?? 0 })),
            definicao.parametros.pesoTecnicoPercentual ?? 70,
          ).map((n) => [n.id, n]),
        )
      : null;
  const chave = (o: OfertaParaClassificar) => (tp ? -(tp.get(o.licitanteId)?.notaFinal ?? 0) : criterio === 'maior_desconto' ? -o.valor : o.valor);
  const ordenadas = [...ofertas].sort((a, b) => chave(a) - chave(b));

  const grupos: OfertaParaClassificar[][] = [];
  for (const o of ordenadas) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo[0] && chave(ultimo[0]) === chave(o)) ultimo.push(o);
    else grupos.push([o]);
  }

  let passos: ClassificacaoSessaoDisputa['passos'] = [];
  let criterioDecisivo: string | null = null;
  let sorteioNecessario = false;
  let empateDetectado = false;
  const posicionados: { oferta: OfertaParaClassificar; posicao: number }[] = [];
  grupos.forEach((grupo, indiceGrupo) => {
    const base = posicionados.length;
    if (grupo.length === 1 && grupo[0]) {
      posicionados.push({ oferta: grupo[0], posicao: base + 1 });
      return;
    }
    // Com lance no grupo e no máximo uma proposta sem lance (que vale desde a abertura), decide a ordem de registro.
    const semLance = grupo.filter((o) => o.instante === null).length;
    const cronologico = !tp && semLance <= 1 && semLance < grupo.length;
    if (cronologico) {
      const momento = (o: OfertaParaClassificar) => (o.instante === null ? Number.NEGATIVE_INFINITY : ms(o.instante));
      [...grupo].sort((a, b) => momento(a) - momento(b)).forEach((o, i) => posicionados.push({ oferta: o, posicao: base + i + 1 }));
      memoria.push(
        `Valores iguais alcançados por lance (${grupo.map((o) => nome(o.licitanteId)).join(', ')}): prevalece o lance registrado primeiro (IN SEGES/ME 73/2022, art. 5º, I).`,
      );
      return;
    }
    const constante = precoEquivalente(definicao, grupo[0]?.valor ?? 0);
    const desempate = aplicarDesempate(grupo.map((o) => paraLicitante(definicao, o.licitanteId, tp ? 1 : constante)));
    for (const c of desempate.classificacao) {
      const o = grupo.find((x) => x.licitanteId === c.id);
      if (o) posicionados.push({ oferta: o, posicao: base + c.posicao });
    }
    if (indiceGrupo === 0) {
      empateDetectado = desempate.empateDetectado;
      passos = desempate.passos;
      criterioDecisivo = desempate.criterioDecisivo;
      sorteioNecessario = desempate.sorteioNecessario;
    }
    memoria.push(`Empate entre ${grupo.map((o) => nome(o.licitanteId)).join(', ')} sem lances que o desfaçam: critérios do art. 60 (IN SEGES/ME 73/2022, art. 28).`);
  });

  const negociada = negociacoes.at(-1);
  const classificacao: ClassificadoSessao[] = posicionados.map(({ oferta: o, posicao }) => {
    const negociou = posicao === 1 && negociada !== undefined && negociada.licitanteId === o.licitanteId;
    const valorOfertado = negociou ? negociada.valor : o.valor;
    const notas = tp?.get(o.licitanteId);
    return {
      id: o.licitanteId,
      nome: nome(o.licitanteId),
      posicao,
      valorConsiderado: precoEquivalente(definicao, valorOfertado),
      valorOfertado,
      origem: negociou ? 'negociacao' : o.origem,
      notaTecnica: notas?.notaTecnica ?? null,
      notaPreco: notas?.notaPreco ?? null,
      notaFinal: notas?.notaFinal ?? null,
    };
  });
  if (negociada) memoria.push(`Negociação com o primeiro colocado: ${formatarOferta(criterio, negociada.valorAnterior)} → ${formatarOferta(criterio, negociada.valor)} (${FUNDAMENTO_NEGOCIACAO}).`);
  if (tp) {
    memoria.push(
      `Técnica e preço: nota final = ${formatarNumero(definicao.parametros.pesoTecnicoPercentual ?? 70)}% da nota técnica + ${formatarNumero(100 - (definicao.parametros.pesoTecnicoPercentual ?? 70))}% da nota de preço (100 × menor preço ÷ preço) (Lei 14.133/2021, art. 36, § 2º).`,
    );
  }

  // Empate ficto de ME/EPP (LC 123/2006, arts. 44 e 45): passo informativo, como no registro da disputa.
  if (!tp && classificacao.length > 1) {
    const ficto = aplicarDesempate(
      classificacao.map((c) => paraLicitante(definicao, c.id, c.valorConsiderado)),
      { empateFictoMeEpp: true },
    ).passos.find((p) => p.ordem === 0);
    if (ficto && !passos.some((p) => p.ordem === 0)) passos = [ficto, ...passos];
  }

  const primeiro = classificacao[0];
  const referencia = definicao.valorReferencia;
  const acimaDoEstimado = primeiro && referencia !== null && criterio !== 'maior_desconto' ? primeiro.valorConsiderado > referencia : null;
  if (acimaDoEstimado) {
    memoria.push(
      `A melhor oferta (${formatarMoeda(primeiro?.valorConsiderado ?? 0)}) está acima do valor estimado (${formatarMoeda(referencia ?? 0)}): cabe negociar (art. 61) ou avaliar a desclassificação (art. 59, III), por decisão do agente de contratação.`,
    );
  }
  return {
    classificacao,
    empateDetectado,
    criterioDecisivo,
    passos,
    sorteioNecessario,
    acimaDoEstimado,
    memoria,
    fundamento: CRITERIOS_JULGAMENTO_DISPUTA.find((c) => c.criterio === criterio)?.fundamento ?? 'Lei 14.133/2021, art. 33',
  };
}

/** Ofertas que a classificação considera: os lances finais e fechados só depois de encerrada a etapa (sigilo). */
export function ofertasDaSessao(estado: EstadoSessaoDisputa): OfertaParaClassificar[] {
  const revelar = estado.fase === 'encerrada' || estado.fase === 'concluida';
  return estado.ofertas.map((o) => {
    if (revelar && o.lanceFinal !== null) return { licitanteId: o.licitanteId, valor: o.lanceFinal, instante: o.lanceFinalInstante, origem: 'lance_final' };
    return { licitanteId: o.licitanteId, valor: o.valor, instante: o.instante, origem: o.instante === null ? 'proposta' : 'lance' };
  });
}

/** Classificação da sessão no estado atual (com os lances finais só após o encerramento e a última negociação). */
export function classificarSessaoDisputa(definicao: DefinicaoSessaoDisputa, estado: EstadoSessaoDisputa): ClassificacaoSessaoDisputa {
  return classificarOfertas(definicao, ofertasDaSessao(estado), estado.negociacoes);
}

/**
 * Reinício da disputa aberta (Lei 14.133/2021, art. 56, § 4º; IN SEGES/ME 73/2022, art. 23, §§ 3º e 4º): cabe, por
 * decisão do agente de contratação, depois de encerrados os lances, quando a melhor oferta for pelo menos 5% melhor que a
 * segunda, para definir as demais colocações com lances intermediários. Não cabe no modo fechado nem na técnica e preço.
 */
export function avaliarReinicioDisputa(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
): { cabivel: boolean; diferencaPercentual: number | null; motivo: string; fundamento: string } {
  const sem = (motivo: string, diferencaPercentual: number | null = null) => ({ cabivel: false, diferencaPercentual, motivo, fundamento: FUNDAMENTO_REINICIO });
  if (definicao.modo === 'fechado' || definicao.criterio === 'tecnica_e_preco') return sem('O reinício só cabe nos modos com etapa aberta de lances.');
  if (estado.fase !== 'encerrada') return sem('O reinício só cabe depois de encerrada a etapa de lances e antes da conclusão da sessão.');
  if (estado.negociacoes.length > 0) return sem('Já houve negociação com o primeiro colocado: o reinício não cabe mais.');
  const { classificacao } = classificarSessaoDisputa(definicao, estado);
  const [primeiro, segundo] = classificacao;
  if (!primeiro || !segundo) return sem('O reinício exige ao menos duas ofertas classificadas.');
  const diferenca = arredondar(((segundo.valorConsiderado - primeiro.valorConsiderado) / primeiro.valorConsiderado) * 100, 2);
  const minimo = definicao.parametros.diferencaReinicioPercentual;
  if (diferenca < minimo) {
    return sem(`A diferença entre a melhor oferta e a segunda é de ${formatarNumero(diferenca)}%, abaixo de ${formatarNumero(minimo)}%.`, diferenca);
  }
  return {
    cabivel: true,
    diferencaPercentual: diferenca,
    motivo: `A melhor oferta é ${formatarNumero(diferenca)}% melhor que a segunda (mínimo de ${formatarNumero(minimo)}%): o agente pode admitir o reinício para definir as demais colocações.`,
    fundamento: FUNDAMENTO_REINICIO,
  };
}
