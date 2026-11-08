/**
 * Simulador de licitantes sintéticos da sala de disputa (RF-22, PoC-03): cada empresa segue um perfil de
 * comportamento determinístico (mesma semente, mesmos lances), para treino de agentes de contratação e para
 * demonstrar os sinais de padrão de lances (RIA-09). Os lances simulados passam pelas mesmas validações do rito
 * (`validarLance`) e não existem fora da sessão de simulação.
 */
import { ErroDominio } from '../erros.ts';
import { arredondar } from '../interno.ts';
import type { Centavos } from '../moeda.ts';
import {
  calcularEstadoSessao,
  diferencaMinimaLance,
  ofertaMelhor,
  sorteioDeterministico,
  type AcaoSimulada,
  type CriterioJulgamentoDisputa,
  type DefinicaoSessaoDisputa,
  type EstadoSessaoDisputa,
  type EventoSessaoDisputa,
  type ParticipanteDisputa,
} from './disputa.ts';

export type PerfilLicitanteSimulado = 'competitivo' | 'tardio' | 'robo' | 'combinado' | 'conservador';
export type CenarioSimulacao = 'concorrencia' | 'conluio_e_robo';

export const PERFIS_LICITANTE_SIMULADO: readonly { perfil: PerfilLicitanteSimulado; rotulo: string; descricao: string }[] = [
  { perfil: 'competitivo', rotulo: 'Competitivo', descricao: 'Cobre a melhor oferta com intervalos e reduções variáveis desde o início.' },
  { perfil: 'tardio', rotulo: 'Lance tardio', descricao: 'Espera os minutos finais da etapa para cobrir a melhor oferta.' },
  { perfil: 'robo', rotulo: 'Robô de lances', descricao: 'Reduz o próprio lance em intervalos fixos e no mesmo valor.' },
  { perfil: 'combinado', rotulo: 'Combinado', descricao: 'Alterna lances com o parceiro, com reação e redução fixas.' },
  { perfil: 'conservador', rotulo: 'Conservador', descricao: 'Poucos lances, com redução pequena e limite alto.' },
];

export const CENARIOS_SIMULACAO: readonly { cenario: CenarioSimulacao; rotulo: string; descricao: string }[] = [
  { cenario: 'concorrencia', rotulo: 'Concorrência regular', descricao: 'Empresas competitivas, uma de lance tardio e uma conservadora.' },
  {
    cenario: 'conluio_e_robo',
    rotulo: 'Conluio e robô de lances (PoC-03)',
    descricao: 'Duas empresas alternam lances combinados, uma usa robô e outra dá lance tardio: exercita os sinais de padrão de lances.',
  },
];

interface Comportamento {
  /** Atraso de reação em segundos (mínimo e máximo; iguais = reação fixa). */
  atraso: [number, number];
  /** Redução por lance: fração da base (preço) ou pontos percentuais (desconto). */
  passoPreco: [number, number];
  passoDesconto: [number, number];
  /** Limite: fração da base (preço) ou pontos percentuais acima do desconto inicial. */
  pisoPreco: number;
  tetoDesconto: number;
  /** Segundos de espera após o início da etapa antes do primeiro lance. */
  inicio?: number;
}

const COMPORTAMENTOS: Readonly<Record<PerfilLicitanteSimulado, Comportamento>> = {
  competitivo: { atraso: [8, 30], passoPreco: [0.004, 0.01], passoDesconto: [0.2, 0.6], pisoPreco: 0.9, tetoDesconto: 6 },
  tardio: { atraso: [10, 25], passoPreco: [0.005, 0.008], passoDesconto: [0.3, 0.5], pisoPreco: 0.86, tetoDesconto: 8 },
  robo: { atraso: [10, 10], passoPreco: [0.005, 0.005], passoDesconto: [0.2, 0.2], pisoPreco: 0.92, tetoDesconto: 4, inicio: 45 },
  combinado: { atraso: [6, 6], passoPreco: [0.004, 0.004], passoDesconto: [0.25, 0.25], pisoPreco: 0.88, tetoDesconto: 7 },
  conservador: { atraso: [20, 50], passoPreco: [0.003, 0.003], passoDesconto: [0.15, 0.15], pisoPreco: 0.97, tetoDesconto: 2 },
};

/** Segundos antes do fim conhecido da etapa em que o perfil "tardio" começa a cobrir a melhor oferta. */
const JANELA_TARDIO_SEGUNDOS = 100;

function ms(instante: string): number {
  return Date.parse(instante);
}

function entre(semente: number, faixa: [number, number], ...partes: (string | number)[]): number {
  const [min, max] = faixa;
  return min === max ? min : min + sorteioDeterministico(semente, ...partes) * (max - min);
}

function base(definicao: DefinicaoSessaoDisputa, p: ParticipanteDisputa): number {
  if (definicao.criterio === 'maior_desconto') return p.propostaInicial;
  return definicao.valorReferencia ?? p.propostaInicial;
}

function limite(definicao: DefinicaoSessaoDisputa, p: ParticipanteDisputa, c: Comportamento): number {
  if (definicao.criterio === 'maior_desconto') return arredondar(Math.min(95, p.propostaInicial + c.tetoDesconto), 2);
  return Math.round(base(definicao, p) * c.pisoPreco);
}

function passo(definicao: DefinicaoSessaoDisputa, p: ParticipanteDisputa, c: Comportamento, indice: number, n: number): number {
  if (definicao.criterio === 'maior_desconto') return Math.max(0.01, arredondar(entre(definicao.semente, c.passoDesconto, 'passo', indice, n), 2));
  // A redução parte da proposta do próprio licitante: valores de licitantes diferentes não coincidem por acaso.
  return Math.max(1, Math.round(p.propostaInicial * entre(definicao.semente, c.passoPreco, 'passo', indice, n)));
}

function melhorar(criterio: CriterioJulgamentoDisputa, valor: number, quanto: number): number {
  return criterio === 'maior_desconto' ? arredondar(valor + quanto, 2) : Math.round(valor - quanto);
}

/** Não ultrapassa o limite do licitante (piso de preço ou teto de desconto). */
function respeitarLimite(criterio: CriterioJulgamentoDisputa, valor: number, lim: number): number {
  return criterio === 'maior_desconto' ? Math.min(valor, lim) : Math.max(valor, lim);
}

function intencao(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  p: ParticipanteDisputa,
  indice: number,
  perfil: PerfilLicitanteSimulado,
): AcaoSimulada | null {
  const { criterio, semente } = definicao;
  const propria = estado.ofertas.find((o) => o.licitanteId === p.id);
  if (!propria || estado.faseIniciadaEm === null) return null;
  const c = COMPORTAMENTOS[perfil];
  const inicioFase = ms(estado.faseIniciadaEm);
  const n = estado.lances.filter((l) => l.licitanteId === p.id).length;
  const lim = limite(definicao, p, c);
  const reduzir = passo(definicao, p, c, indice, n);
  const fimConhecido = estado.fimPrevisto !== null && !estado.fimSigiloso ? ms(estado.fimPrevisto) : null;

  if (estado.fase === 'lance_final_fechado') {
    if (propria.lanceFinal !== null || perfil === 'conservador') return null;
    const valor = respeitarLimite(criterio, melhorar(criterio, propria.valor, perfil === 'combinado' ? reduzir : reduzir * 2), lim);
    if (!ofertaMelhor(criterio, valor, propria.valor)) return null;
    const instanteMs = inicioFase + Math.round(entre(semente, [30, 240], 'lance-final', indice) * 1000);
    return fimConhecido !== null && instanteMs >= fimConhecido ? null : { instanteMs, licitanteId: p.id, valor };
  }

  const lancesDaFase = estado.lances.filter((l) => ms(l.instante) >= inicioFase);
  const ultimoDaFase = lancesDaFase.at(-1);
  const referenciaTempo = ultimoDaFase ? ms(ultimoDaFase.instante) : inicioFase;
  const melhor = estado.melhorValor ?? propria.valor;
  const souLider = estado.liderId === p.id;
  const atraso = Math.round(entre(semente, c.atraso, 'atraso', indice, n) * 1000);

  let instanteMs: number;
  let valor: number;
  if (perfil === 'robo') {
    const ultimoProprio = propria.instante !== null && ms(propria.instante) >= inicioFase ? ms(propria.instante) : null;
    instanteMs = ultimoProprio === null ? inicioFase + (c.inicio ?? 0) * 1000 : ultimoProprio + atraso;
    valor = melhorar(criterio, propria.valor, reduzir);
  } else {
    if (souLider) return null;
    instanteMs = referenciaTempo + atraso;
    if (perfil === 'combinado') {
      // Reage à mudança da melhor oferta (e não a lances intermediários de terceiros).
      const doLider = estado.ofertas.find((o) => o.licitanteId === estado.liderId)?.instante ?? null;
      instanteMs = (doLider !== null && ms(doLider) >= inicioFase ? ms(doLider) : inicioFase) + atraso;
    }
    if (perfil === 'tardio' && fimConhecido !== null && estado.fase === 'lances_abertos') {
      instanteMs = Math.max(referenciaTempo, fimConhecido - JANELA_TARDIO_SEGUNDOS * 1000) + atraso;
    }
    valor = melhorar(criterio, melhor, reduzir);
  }
  valor = respeitarLimite(criterio, valor, lim);

  const { intervaloMinimo } = definicao.parametros;
  if (estado.rodada > 0) {
    // Reinício: só lances intermediários, que não cobrem a melhor oferta (art. 56, § 4º).
    const folga = Math.max(criterio === 'maior_desconto' ? 0.01 : 1, diferencaMinimaLance(criterio, intervaloMinimo, melhor));
    const piorQueMelhor = criterio === 'maior_desconto' ? arredondar(melhor - folga, 2) : melhor + folga;
    valor = criterio === 'maior_desconto' ? Math.min(valor, piorQueMelhor) : Math.max(valor, piorQueMelhor);
  } else if (ofertaMelhor(criterio, valor, melhor)) {
    const exigida = diferencaMinimaLance(criterio, intervaloMinimo, melhor);
    const diferenca = Math.abs(melhor - valor);
    if (exigida > 0 && diferenca < exigida) valor = respeitarLimite(criterio, melhorar(criterio, melhor, exigida), lim);
  }
  if (!ofertaMelhor(criterio, valor, propria.valor)) return null;
  const exigidaPropria = ofertaMelhor(criterio, valor, melhor) ? 0 : diferencaMinimaLance(criterio, intervaloMinimo, propria.valor);
  if (exigidaPropria > 0 && Math.abs(propria.valor - valor) < exigidaPropria) return null;
  if (fimConhecido !== null && instanteMs >= fimConhecido) return null;
  return { instanteMs, licitanteId: p.id, valor };
}

/**
 * Próximo lance dos licitantes sintéticos: a ação mais próxima no tempo entre os participantes com perfil, convocados
 * para a etapa e não ignorados. Perfis: competitivo, lance tardio, robô (intervalo e redução fixos), combinado (alterna
 * com o parceiro) e conservador. Determinístico pela semente da sessão.
 */
export function proximoLanceSimulado(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  perfis: Readonly<Record<string, PerfilLicitanteSimulado>>,
  ignorar: ReadonlySet<string> = new Set(),
): AcaoSimulada | null {
  let escolhida: AcaoSimulada | null = null;
  for (const [indice, p] of definicao.participantes.entries()) {
    const perfil = perfis[p.id];
    if (!perfil || ignorar.has(p.id) || !estado.habilitados.includes(p.id)) continue;
    const acao = intencao(definicao, estado, p, indice, perfil);
    if (acao && (escolhida === null || acao.instanteMs < escolhida.instanteMs)) escolhida = acao;
  }
  return escolhida;
}

/** Estado da sessão simulada no instante `agora`: eventos registrados mais os lances dos licitantes sintéticos. */
export function calcularEstadoSessaoSimulada(
  definicao: DefinicaoSessaoDisputa,
  eventos: readonly EventoSessaoDisputa[],
  agora: string,
  perfis: Readonly<Record<string, PerfilLicitanteSimulado>>,
): EstadoSessaoDisputa {
  return calcularEstadoSessao(definicao, eventos, agora, { simulador: (d, e, ignorar) => proximoLanceSimulado(d, e, perfis, ignorar) });
}

/**
 * Propostas iniciais sintéticas: preço entre 98% e 108% da referência, arredondado ao real, ou desconto entre 1% e 6%;
 * na técnica e preço, nota técnica entre 60 e 95.
 */
export function propostasIniciaisSimuladas(
  semente: number,
  quantidade: number,
  criterio: CriterioJulgamentoDisputa,
  valorReferencia: Centavos | null,
): { propostaInicial: number; notaTecnica: number | null }[] {
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > 50) {
    throw new ErroDominio('SIMULACAO_INVALIDA', 'Informe de 1 a 50 participantes para a simulação.');
  }
  if (criterio !== 'maior_desconto' && (valorReferencia === null || !Number.isSafeInteger(valorReferencia) || valorReferencia <= 0)) {
    throw new ErroDominio('VALOR_REFERENCIA_OBRIGATORIO', 'A simulação precisa do valor estimado da contratação para gerar as propostas iniciais.');
  }
  return Array.from({ length: quantidade }, (_, i) => {
    const sorteio = sorteioDeterministico(semente, 'proposta', i);
    const propostaInicial =
      criterio === 'maior_desconto'
        ? arredondar(1 + sorteio * 5, 2)
        : Math.max(100, Math.round(((valorReferencia ?? 0) * (0.98 + sorteio * 0.1)) / 100) * 100);
    const notaTecnica = criterio === 'tecnica_e_preco' ? 60 + Math.floor(sorteioDeterministico(semente, 'nota-tecnica', i) * 36) : null;
    return { propostaInicial, notaTecnica };
  });
}

/**
 * Perfis do cenário: "concorrência" alterna competitivo, lance tardio e conservador; "conluio e robô" põe o par
 * informado (ou o 2º e o 3º participantes) como combinado, e os demais como lance tardio, robô e competitivo.
 */
export function perfisCenarioSimulacao(
  cenario: CenarioSimulacao,
  ids: readonly string[],
  parVinculado: readonly [string, string] | null = null,
): Record<string, PerfilLicitanteSimulado> {
  const perfis: Record<string, PerfilLicitanteSimulado> = {};
  if (cenario === 'concorrencia') {
    const ciclo: PerfilLicitanteSimulado[] = ['competitivo', 'competitivo', 'tardio', 'conservador'];
    ids.forEach((id, i) => {
      perfis[id] = ciclo[i % ciclo.length] ?? 'competitivo';
    });
    return perfis;
  }
  if (cenario !== 'conluio_e_robo') throw new ErroDominio('SIMULACAO_INVALIDA', `Cenário de simulação desconhecido: ${String(cenario)}.`);
  const par = parVinculado && ids.includes(parVinculado[0]) && ids.includes(parVinculado[1]) ? parVinculado : ids.length >= 3 ? [ids[1], ids[2]] : ids.slice(0, 2);
  for (const id of par) if (id !== undefined) perfis[id] = 'combinado';
  const demais: PerfilLicitanteSimulado[] = ['tardio', 'robo'];
  let k = 0;
  for (const id of ids) {
    if (perfis[id]) continue;
    perfis[id] = demais[k] ?? 'competitivo';
    k += 1;
  }
  return perfis;
}
