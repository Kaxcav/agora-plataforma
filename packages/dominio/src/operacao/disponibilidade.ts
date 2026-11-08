/**
 * Medição de disponibilidade da plataforma (RNF-10; IMR-01 do termo de referência do cliente): a sonda do servidor
 * registra, a cada intervalo, se a API, o banco, a fila de integrações e a sincronização com o PNCP estão de pé. As
 * sondagens com o mesmo resultado viram um intervalo contínuo; aqui se calcula, para um período, a disponibilidade
 * = (minutos considerados − minutos indisponíveis) ÷ minutos considerados × 100.
 *
 * Premissas (registradas no relatório): minuto sem sondagem válida conta como indisponível; o período começa na
 * primeira sondagem já registrada (antes dela não havia medição); a falha da sincronização durante uma janela de
 * manutenção do PNCP — informada pelo órgão ou detectada pela fila — não conta contra a plataforma, porque a fila
 * guarda as transações e as reenvia depois. A glosa, se houver, é decisão do fiscal do contrato.
 */
import { ErroDominio } from '../erros.ts';
import type { SituacaoMeta } from '../lei14133/metas-etp.ts';

export type ComponenteOperacao = 'api' | 'banco' | 'fila' | 'sincronizacao';

export const COMPONENTES_OPERACAO: readonly ComponenteOperacao[] = Object.freeze(['api', 'banco', 'fila', 'sincronizacao']);

/** Sondagens consecutivas com o mesmo resultado: de `inicio` (primeira) a `fim` (última). */
export interface IntervaloSondagem {
  inicio: string;
  fim: string;
  componentes: Readonly<Record<ComponenteOperacao, boolean>>;
  /** O PNCP recusava as tarefas por indisponibilidade (tarefas da fila aguardando nova tentativa). */
  pncpEmManutencao: boolean;
}

export interface JanelaManutencao {
  inicio: string;
  fim: string;
}

export interface OcorrenciaIndisponibilidade {
  inicio: string;
  fim: string;
  minutos: number;
  /** Componentes que falharam, ou 'sem_medicao' quando não havia sondagem válida. */
  causas: (ComponenteOperacao | 'sem_medicao')[];
}

export interface JanelaPncpMedida extends JanelaManutencao {
  minutos: number;
  origem: 'registrada' | 'detectada';
}

export interface ResultadoDisponibilidade {
  /** Início efetivo: o do período ou a primeira sondagem, o que vier depois; null sem medição no período. */
  inicioMedicao: string | null;
  fimMedicao: string | null;
  minutosConsiderados: number;
  minutosDisponiveis: number;
  minutosIndisponiveis: number;
  minutosSemMedicao: number;
  /** Truncado em duas casas (nunca arredonda para cima); null sem minutos considerados. */
  percentual: number | null;
  metaPercentual: number | null;
  situacao: SituacaoMeta;
  componentes: { componente: ComponenteOperacao; minutosIndisponiveis: number; percentual: number | null }[];
  ocorrencias: OcorrenciaIndisponibilidade[];
  janelasPncp: JanelaPncpMedida[];
}

const MS_POR_MINUTO = 60_000;

function instante(valor: string, campo: string): number {
  const ms = typeof valor === 'string' ? Date.parse(valor) : Number.NaN;
  if (Number.isNaN(ms)) throw new ErroDominio('INSTANTE_INVALIDO', `${campo}: instante inválido (${String(valor)}).`);
  return ms;
}

function minutos(ms: number): number {
  return Math.round(ms / MS_POR_MINUTO);
}

function truncar2(valor: number): number {
  return Math.floor(Number((valor * 100).toPrecision(15))) / 100;
}

/** Une janelas que se sobrepõem ou se tocam. */
function unir(janelas: readonly { inicio: number; fim: number }[]): { inicio: number; fim: number }[] {
  const ordenadas = [...janelas].filter((j) => j.fim > j.inicio).sort((a, b) => a.inicio - b.inicio);
  const unidas: { inicio: number; fim: number }[] = [];
  for (const j of ordenadas) {
    const ultima = unidas.at(-1);
    if (ultima && j.inicio <= ultima.fim) ultima.fim = Math.max(ultima.fim, j.fim);
    else unidas.push({ ...j });
  }
  return unidas;
}

interface Trecho {
  inicio: number;
  fim: number;
  intervalo: IntervaloSondagem | null;
}

/** Cobertura das sondagens: cada intervalo vale do início até o fim + validade, sem invadir o intervalo seguinte. */
function cobertura(intervalos: readonly IntervaloSondagem[], validadeMs: number): Trecho[] {
  const ordenados = [...intervalos].sort((a, b) => instante(a.inicio, 'inicio') - instante(b.inicio, 'inicio'));
  const trechos: Trecho[] = [];
  ordenados.forEach((intervalo, i) => {
    const inicio = instante(intervalo.inicio, 'inicio');
    const fim = instante(intervalo.fim, 'fim');
    if (fim < inicio) throw new ErroDominio('INTERVALO_INVALIDO', 'O fim de um intervalo de sondagens é anterior ao início.');
    const proximo = ordenados[i + 1];
    const limite = proximo ? instante(proximo.inicio, 'inicio') : Number.POSITIVE_INFINITY;
    const ate = Math.min(fim + validadeMs, limite);
    if (ate > inicio) trechos.push({ inicio, fim: ate, intervalo });
  });
  return trechos;
}

/**
 * Janelas de manutenção do PNCP detectadas pela fila: trechos contínuos em que a sonda viu tarefas do PNCP
 * aguardando nova tentativa por indisponibilidade do portal.
 */
export function detectarJanelasPncp(intervalos: readonly IntervaloSondagem[], validadeMs: number): JanelaManutencao[] {
  if (!Number.isSafeInteger(validadeMs) || validadeMs < 0) throw new ErroDominio('VALIDADE_INVALIDA', 'A validade da sondagem deve ser um inteiro não negativo, em ms.');
  const emManutencao = cobertura(intervalos, validadeMs).filter((t) => t.intervalo?.pncpEmManutencao);
  return unir(emManutencao).map((j) => ({ inicio: new Date(j.inicio).toISOString(), fim: new Date(j.fim).toISOString() }));
}

/**
 * Disponibilidade da plataforma num período [inicio, fim) (IMR-01): minutos considerados, disponíveis,
 * indisponíveis (algum componente falhou) e sem medição (sem sondagem válida, que contam como indisponíveis), com
 * o percentual por componente, as ocorrências de indisponibilidade e as janelas de manutenção do PNCP.
 */
export function calcularDisponibilidade(entrada: {
  inicio: string;
  fim: string;
  intervalos: readonly IntervaloSondagem[];
  /** Quanto tempo depois da última sondagem de um intervalo ela ainda vale (tipicamente 2× o intervalo da sonda). */
  validadeMs: number;
  janelasRegistradas?: readonly JanelaManutencao[];
  /**
   * Primeira sondagem já registrada (de todos os tempos). Sem ela, vale o primeiro intervalo informado — o que só é
   * correto quando os intervalos começam antes do período ou junto com a medição.
   */
  inicioMedicao?: string | null;
  metaPercentual: number | null;
}): ResultadoDisponibilidade {
  const inicioPeriodo = instante(entrada.inicio, 'inicio');
  const fimPeriodo = instante(entrada.fim, 'fim');
  if (inicioPeriodo > fimPeriodo) throw new ErroDominio('PERIODO_INVALIDO', 'O início do período é posterior ao fim.');
  if (entrada.metaPercentual !== null && (!Number.isFinite(entrada.metaPercentual) || entrada.metaPercentual <= 0 || entrada.metaPercentual > 100)) {
    throw new ErroDominio('META_INVALIDA', 'A meta de disponibilidade deve ser um percentual maior que 0 e até 100.');
  }
  const trechos = cobertura(entrada.intervalos, entrada.validadeMs);
  const detectadas = detectarJanelasPncp(entrada.intervalos, entrada.validadeMs);
  const registradas = (entrada.janelasRegistradas ?? []).map((j) => ({ inicio: instante(j.inicio, 'inicio'), fim: instante(j.fim, 'fim') }));
  const janelas = unir([...registradas, ...detectadas.map((j) => ({ inicio: Date.parse(j.inicio), fim: Date.parse(j.fim) }))]);

  const recortar = (j: { inicio: number; fim: number }) => ({ inicio: Math.max(j.inicio, inicioPeriodo), fim: Math.min(j.fim, fimPeriodo) });
  const janelasPncp: JanelaPncpMedida[] = [
    ...registradas.map((j) => ({ ...recortar(j), origem: 'registrada' as const })),
    ...detectadas.map((j) => ({ ...recortar({ inicio: Date.parse(j.inicio), fim: Date.parse(j.fim) }), origem: 'detectada' as const })),
  ]
    .filter((j) => j.fim > j.inicio)
    .sort((a, b) => a.inicio - b.inicio)
    .map((j) => ({ inicio: new Date(j.inicio).toISOString(), fim: new Date(j.fim).toISOString(), minutos: minutos(j.fim - j.inicio), origem: j.origem }));

  const primeira = entrada.inicioMedicao ? instante(entrada.inicioMedicao, 'inicioMedicao') : trechos[0]?.inicio;
  const inicioMedicao = primeira === undefined ? fimPeriodo : Math.max(inicioPeriodo, primeira);
  const semPeriodo = inicioMedicao >= fimPeriodo;
  const vazio = (situacao: SituacaoMeta): ResultadoDisponibilidade => ({
    inicioMedicao: null,
    fimMedicao: null,
    minutosConsiderados: 0,
    minutosDisponiveis: 0,
    minutosIndisponiveis: 0,
    minutosSemMedicao: 0,
    percentual: null,
    metaPercentual: entrada.metaPercentual,
    situacao,
    componentes: COMPONENTES_OPERACAO.map((componente) => ({ componente, minutosIndisponiveis: 0, percentual: null })),
    ocorrencias: [],
    janelasPncp,
  });
  if (semPeriodo) return vazio(entrada.metaPercentual === null ? 'sem_meta' : 'sem_dados');

  // Pontos de corte: limites do período, dos trechos de sondagem e das janelas do PNCP.
  const cortes = new Set<number>([inicioMedicao, fimPeriodo]);
  for (const t of trechos) for (const p of [t.inicio, t.fim]) if (p > inicioMedicao && p < fimPeriodo) cortes.add(p);
  for (const j of janelas) for (const p of [j.inicio, j.fim]) if (p > inicioMedicao && p < fimPeriodo) cortes.add(p);
  const pontos = [...cortes].sort((a, b) => a - b);

  let disponivel = 0;
  let indisponivel = 0;
  let semMedicao = 0;
  const porComponente = new Map<ComponenteOperacao, number>(COMPONENTES_OPERACAO.map((c) => [c, 0]));
  const ocorrencias: { inicio: number; fim: number; causas: Set<ComponenteOperacao | 'sem_medicao'> }[] = [];
  let indiceTrecho = 0;
  for (let i = 0; i < pontos.length - 1; i++) {
    const a = pontos[i] ?? 0;
    const b = pontos[i + 1] ?? 0;
    const duracao = b - a;
    while (indiceTrecho < trechos.length && (trechos[indiceTrecho]?.fim ?? 0) <= a) indiceTrecho++;
    const trecho = trechos[indiceTrecho];
    const coberto = trecho !== undefined && trecho.inicio <= a && trecho.fim >= b ? trecho.intervalo : null;
    const emJanela = janelas.some((j) => j.inicio <= a && j.fim >= b);
    let causas: (ComponenteOperacao | 'sem_medicao')[];
    if (coberto === null) {
      causas = ['sem_medicao'];
      semMedicao += duracao;
    } else {
      causas = COMPONENTES_OPERACAO.filter((c) => !coberto.componentes[c] && !(c === 'sincronizacao' && emJanela));
      for (const c of causas) porComponente.set(c as ComponenteOperacao, (porComponente.get(c as ComponenteOperacao) ?? 0) + duracao);
      if (causas.length === 0) disponivel += duracao;
      else indisponivel += duracao;
    }
    if (causas.length > 0) {
      const ultima = ocorrencias.at(-1);
      if (ultima && ultima.fim === a) {
        ultima.fim = b;
        for (const c of causas) ultima.causas.add(c);
      } else {
        ocorrencias.push({ inicio: a, fim: b, causas: new Set(causas) });
      }
    }
  }

  const considerados = fimPeriodo - inicioMedicao;
  const percentual = considerados > 0 ? truncar2((disponivel * 100) / considerados) : null;
  return {
    inicioMedicao: new Date(inicioMedicao).toISOString(),
    fimMedicao: new Date(fimPeriodo).toISOString(),
    minutosConsiderados: minutos(considerados),
    minutosDisponiveis: minutos(disponivel),
    minutosIndisponiveis: minutos(indisponivel),
    minutosSemMedicao: minutos(semMedicao),
    percentual,
    metaPercentual: entrada.metaPercentual,
    situacao: entrada.metaPercentual === null ? 'sem_meta' : percentual === null ? 'sem_dados' : percentual >= entrada.metaPercentual ? 'atingida' : 'nao_atingida',
    componentes: COMPONENTES_OPERACAO.map((componente) => {
      const fora = porComponente.get(componente) ?? 0;
      return {
        componente,
        minutosIndisponiveis: minutos(fora),
        percentual: considerados > 0 ? truncar2(((considerados - fora - semMedicao) * 100) / considerados) : null,
      };
    }),
    ocorrencias: ocorrencias.map((o) => ({
      inicio: new Date(o.inicio).toISOString(),
      fim: new Date(o.fim).toISOString(),
      minutos: minutos(o.fim - o.inicio),
      causas: [...o.causas],
    })),
    janelasPncp,
  };
}
