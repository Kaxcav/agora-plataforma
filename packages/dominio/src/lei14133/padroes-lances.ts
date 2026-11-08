/**
 * Sinal de padrão de lances (RIA-09): intervalos regulares, reduções idênticas, alternância combinada entre dois
 * licitantes e lances de mesmo valor de licitantes diferentes. Cruza com o sinal de sócio em comum (RIA-06).
 *
 * São sinais para análise humana, com as evidências que os geraram. Não desclassificam, não impedem e não constituem
 * acusação: o lance automático parametrizado no próprio sistema é permitido (IN SEGES/ME 73/2022, art. 19) e
 * coincidências acontecem. A apuração de conluio é do agente de contratação, com contraditório (Lei 14.133/2021,
 * arts. 155 a 158).
 */
import { arredondar, formatarNumero } from '../interno.ts';
import { formatarOferta, type CriterioJulgamentoDisputa } from './disputa.ts';

export type TipoPadraoLances = 'intervalos_regulares' | 'decrementos_identicos' | 'alternancia_combinada' | 'lances_iguais';

export interface LanceAnalisado {
  sequencia: number;
  licitanteId: string;
  valor: number;
  instante: string;
  /** Lance que não assumiu a melhor oferta; a alternância considera só os lances que assumiram a liderança. */
  intermediario?: boolean;
}

export interface SinalPadraoLances {
  regra: 'RIA-09';
  tipo: TipoPadraoLances;
  titulo: string;
  licitantes: string[];
  evidencias: string[];
  fundamento: string;
  aviso: string;
  /** Os licitantes do padrão também têm vínculo societário entre si (RIA-06). */
  reforcadoPorVinculo: boolean;
  vinculos: string[];
}

/** Limiares dos sinais: quantidade mínima de ocorrências seguidas para que o padrão seja apontado. */
export const LIMIARES_PADROES_LANCES = Object.freeze({
  /** Lances do mesmo licitante com intervalos quase iguais (4 intervalos). */
  minimoLancesIntervalo: 5,
  /** Variação máxima entre os intervalos, em segundos. */
  toleranciaIntervaloSegundos: 1,
  /** Reduções seguidas do mesmo licitante exatamente iguais. */
  minimoReducoesIdenticas: 3,
  /** Lances seguidos alternados só entre os mesmos dois licitantes. */
  minimoAlternancia: 6,
});

export const AVISO_SINAL_DISPUTA =
  'Sinal para análise: requer revisão humana. Não desclassifica, não impede e não constitui acusação; a apuração cabe ao agente de contratação, com contraditório.';

const FUNDAMENTO_ROBO = 'Lei 14.133/2021, art. 5º (competitividade); IN SEGES/ME 73/2022, art. 19 (o lance automático parametrizado no sistema é permitido)';
const FUNDAMENTO_CONLUIO = 'Lei 14.133/2021, art. 5º e art. 155, IX e XI; Lei 12.846/2013, art. 5º, IV, "a"';

function ms(instante: string): number {
  return Date.parse(instante);
}

function faixaLances(lances: readonly LanceAnalisado[]): string {
  const primeiro = lances[0]?.sequencia;
  const ultimo = lances.at(-1)?.sequencia;
  return primeiro === ultimo ? `lance nº ${primeiro ?? '—'}` : `lances nº ${primeiro ?? '—'} a ${ultimo ?? '—'}`;
}

/** Maior trecho contíguo de `itens` em que `cabe(trecho)` vale; devolve índices [inicio, fim] (inclusivos). */
function maiorTrecho<T>(itens: readonly T[], cabe: (inicio: number, fim: number) => boolean): [number, number] | null {
  let melhor: [number, number] | null = null;
  let inicio = 0;
  for (let fim = 0; fim < itens.length; fim++) {
    while (inicio < fim && !cabe(inicio, fim)) inicio++;
    if (cabe(inicio, fim) && (melhor === null || fim - inicio > melhor[1] - melhor[0])) melhor = [inicio, fim];
  }
  return melhor;
}

/**
 * Detecta padrões na sequência de lances (RIA-09). `nomes` traduz os identificadores para o texto das evidências
 * (na etapa de lances, a sala passa rótulos anônimos). Cada sinal traz as evidências, o fundamento e o aviso de que
 * requer revisão humana.
 */
export function detectarPadroesLances(
  lances: readonly LanceAnalisado[],
  opcoes: { criterio: CriterioJulgamentoDisputa; nomes?: Readonly<Record<string, string>> },
): SinalPadraoLances[] {
  const nome = (id: string) => opcoes.nomes?.[id] ?? id;
  const ordenados = [...lances].sort((a, b) => a.sequencia - b.sequencia);
  const sinais: SinalPadraoLances[] = [];
  const sinal = (tipo: TipoPadraoLances, titulo: string, licitantes: string[], evidencias: string[], fundamento: string) =>
    sinais.push({ regra: 'RIA-09', tipo, titulo, licitantes, evidencias, fundamento, aviso: AVISO_SINAL_DISPUTA, reforcadoPorVinculo: false, vinculos: [] });

  const porLicitante = new Map<string, LanceAnalisado[]>();
  for (const l of ordenados) porLicitante.set(l.licitanteId, [...(porLicitante.get(l.licitanteId) ?? []), l]);

  for (const [id, proprios] of porLicitante) {
    // Intervalos regulares entre lances do mesmo licitante.
    const intervalos = proprios.slice(1).map((l, i) => ms(l.instante) - ms(proprios[i]?.instante ?? l.instante));
    const tolerancia = LIMIARES_PADROES_LANCES.toleranciaIntervaloSegundos * 1000;
    const regular = maiorTrecho(intervalos, (a, b) => {
      const trecho = intervalos.slice(a, b + 1);
      return Math.max(...trecho) - Math.min(...trecho) <= tolerancia;
    });
    if (regular && regular[1] - regular[0] + 1 >= LIMIARES_PADROES_LANCES.minimoLancesIntervalo - 1) {
      const trecho = intervalos.slice(regular[0], regular[1] + 1);
      const envolvidos = proprios.slice(regular[0], regular[1] + 2);
      sinal(
        'intervalos_regulares',
        `Lances em intervalos regulares — ${nome(id)}`,
        [id],
        [
          `${envolvidos.length} lances seguidos de ${nome(id)} ${Math.min(...trecho) === Math.max(...trecho) ? `a cada ${formatarNumero(Math.min(...trecho) / 1000)} s` : `com intervalos entre ${formatarNumero(Math.min(...trecho) / 1000)} s e ${formatarNumero(Math.max(...trecho) / 1000)} s`} (${faixaLances(envolvidos)}).`,
          'Regularidade assim é típica de envio automatizado; o lance automático parametrizado no próprio sistema é permitido.',
        ],
        FUNDAMENTO_ROBO,
      );
    }

    // Reduções idênticas e seguidas do próprio lance.
    const reducoes = proprios.slice(1).map((l, i) => arredondar(Math.abs(l.valor - (proprios[i]?.valor ?? l.valor)), 2));
    const identicas = maiorTrecho(reducoes, (a, b) => reducoes.slice(a, b + 1).every((r) => r === reducoes[a] && r > 0));
    if (identicas && identicas[1] - identicas[0] + 1 >= LIMIARES_PADROES_LANCES.minimoReducoesIdenticas) {
      const quantidade = identicas[1] - identicas[0] + 1;
      const reducao = reducoes[identicas[0]] ?? 0;
      const envolvidos = proprios.slice(identicas[0], identicas[1] + 2);
      sinal(
        'decrementos_identicos',
        `Reduções idênticas de lance — ${nome(id)}`,
        [id],
        [
          `${quantidade} reduções seguidas de exatamente ${opcoes.criterio === 'maior_desconto' ? `${formatarNumero(reducao)} ponto(s) percentual(is)` : formatarOferta(opcoes.criterio, reducao)} nos lances de ${nome(id)} (${faixaLances(envolvidos)}).`,
        ],
        FUNDAMENTO_ROBO,
      );
    }
  }

  // Alternância da melhor oferta só entre os mesmos dois licitantes (lances intermediários de terceiros não a quebram).
  const lideranca = ordenados.filter((l) => l.intermediario !== true);
  const pares = new Map<string, [number, number]>();
  const alternancia = (a: number, b: number) => {
    const trecho = lideranca.slice(a, b + 1);
    const ids = new Set(trecho.map((l) => l.licitanteId));
    return ids.size <= 2 && trecho.every((l, i) => i === 0 || l.licitanteId !== trecho[i - 1]?.licitanteId);
  };
  let inicio = 0;
  for (let fim = 0; fim < lideranca.length; fim++) {
    while (inicio < fim && !alternancia(inicio, fim)) inicio++;
    const trecho = lideranca.slice(inicio, fim + 1);
    const ids = [...new Set(trecho.map((l) => l.licitanteId))].sort();
    if (ids.length !== 2 || trecho.length < LIMIARES_PADROES_LANCES.minimoAlternancia) continue;
    const chave = ids.join('|');
    const atual = pares.get(chave);
    if (!atual || fim - inicio > atual[1] - atual[0]) pares.set(chave, [inicio, fim]);
  }
  for (const [chave, [a, b]] of pares) {
    const ids = chave.split('|');
    const trecho = lideranca.slice(a, b + 1);
    const duracao = (ms(trecho.at(-1)?.instante ?? '') - ms(trecho[0]?.instante ?? '')) / 1000;
    sinal(
      'alternancia_combinada',
      `Alternância de lances entre ${ids.map(nome).join(' e ')}`,
      ids,
      [
        `${trecho.length} lances seguidos que assumiram a melhor oferta alternaram apenas entre ${ids.map(nome).join(' e ')} (${faixaLances(trecho)}, em ${formatarNumero(arredondar(duracao, 1))} s).`,
        'Alternância assim pode indicar cobertura combinada para simular competição.',
      ],
      FUNDAMENTO_CONLUIO,
    );
  }

  // Mesmo valor ofertado por licitantes diferentes.
  const porValor = new Map<number, LanceAnalisado[]>();
  for (const l of ordenados) porValor.set(l.valor, [...(porValor.get(l.valor) ?? []), l]);
  const iguaisPorPar = new Map<string, LanceAnalisado[]>();
  for (const grupo of porValor.values()) {
    const ids = [...new Set(grupo.map((l) => l.licitanteId))].sort();
    if (ids.length < 2) continue;
    const chave = ids.join('|');
    iguaisPorPar.set(chave, [...(iguaisPorPar.get(chave) ?? []), ...grupo]);
  }
  for (const [chave, grupo] of iguaisPorPar) {
    const ids = chave.split('|');
    const valores = [...new Set(grupo.map((l) => l.valor))];
    sinal(
      'lances_iguais',
      `Lances de mesmo valor — ${ids.map(nome).join(' e ')}`,
      ids,
      valores.map((v) => {
        const doValor = grupo.filter((l) => l.valor === v);
        return `${ids.map(nome).join(' e ')} ofertaram o mesmo valor, ${formatarOferta(opcoes.criterio, v)} (lances nº ${doValor.map((l) => l.sequencia).join(', ')}).`;
      }),
      FUNDAMENTO_CONLUIO,
    );
  }
  return sinais;
}

/**
 * Cruza os padrões de lances (RIA-09) com os vínculos societários entre licitantes (RIA-06): o padrão que envolve os
 * dois licitantes de um vínculo fica marcado como reforçado, com a descrição do vínculo. Continua sendo sinal para
 * análise humana.
 */
export function cruzarPadroesComVinculos(
  sinais: readonly SinalPadraoLances[],
  vinculos: readonly { licitantes: readonly [string, string]; descricao: string }[],
): SinalPadraoLances[] {
  return sinais.map((s) => {
    const relacionados = vinculos.filter((v) => s.licitantes.includes(v.licitantes[0]) && s.licitantes.includes(v.licitantes[1]));
    if (relacionados.length === 0) return { ...s, vinculos: [] };
    return {
      ...s,
      reforcadoPorVinculo: true,
      vinculos: relacionados.map((v) => v.descricao),
      evidencias: [...s.evidencias, 'Os mesmos licitantes têm vínculo societário entre si (RIA-06): indício reforçado, ainda para análise humana.'],
    };
  });
}
