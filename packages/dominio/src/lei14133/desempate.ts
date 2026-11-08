/**
 * Critérios de desempate (Lei 14.133/2021, art. 60) e registro do empate ficto de ME/EPP (LC 123/2006, arts. 44 e 45).
 */
import { ErroDominio } from '../erros.ts';
import { type Centavos, formatarMoeda } from '../moeda.ts';
import { exigirFinito, exigirInteiro, formatarNumero } from '../interno.ts';

export interface Licitante {
  id: string;
  nome: string;
  valorProposta: Centavos;
  meEpp?: boolean;
  /** art. 60, I — lance apresentado na disputa final entre os empatados. */
  lanceDisputaFinal?: Centavos;
  /** 0–100, art. 60, II (registro cadastral / atesto de cumprimento de obrigações). */
  notaDesempenhoPrevio?: number;
  /** art. 60, III — Decreto 11.430/2023. */
  acoesEquidadeGenero?: boolean;
  /** art. 60, IV. */
  programaIntegridade?: boolean;
  /** art. 60, § 1º, II. */
  empresaBrasileira?: boolean;
  /** art. 60, § 1º, III. */
  investePesquisaDesenvolvimentoNoPais?: boolean;
  /** art. 60, § 1º, IV — Lei 12.187/2009. */
  praticaMitigacaoClimatica?: boolean;
}

interface Criterio {
  criterio: string;
  fundamento: string;
  /** Motivo pelo qual o critério não se aplica à Ágora (órgão federal). */
  naoAplicavel?: string;
  informado: (l: Licitante) => boolean;
  /** Maior é melhor. */
  pontuar: (l: Licitante) => number;
  detalhe: (l: Licitante) => string;
  semDados: string;
}

function criterioBooleano(
  criterio: string,
  fundamento: string,
  ler: (l: Licitante) => boolean | undefined,
  atende: string,
): Criterio {
  return {
    criterio,
    fundamento,
    informado: (l) => ler(l) !== undefined,
    pontuar: (l) => (ler(l) === true ? 1 : 0),
    detalhe: (l) => (ler(l) === true ? atende : `não ${atende}`),
    semDados: 'nenhum dos empatados atende ao critério',
  };
}

/** Ordem de aplicação dos critérios do art. 60, caput e § 1º. */
const CRITERIOS: readonly Criterio[] = [
  {
    criterio: 'Disputa final entre os licitantes empatados',
    fundamento: 'Lei 14.133/2021, art. 60, I',
    informado: (l) => l.lanceDisputaFinal !== undefined,
    pontuar: (l) => -(l.lanceDisputaFinal ?? l.valorProposta),
    detalhe: (l) =>
      l.lanceDisputaFinal !== undefined
        ? `lance final de ${formatarMoeda(l.lanceDisputaFinal)}`
        : `sem novo lance (mantida a proposta de ${formatarMoeda(l.valorProposta)})`,
    semDados: 'nenhum licitante empatado apresentou lance na disputa final',
  },
  {
    criterio: 'Avaliação do desempenho contratual prévio',
    fundamento: 'Lei 14.133/2021, art. 60, II',
    informado: (l) => l.notaDesempenhoPrevio !== undefined,
    pontuar: (l) => l.notaDesempenhoPrevio ?? -1,
    detalhe: (l) => (l.notaDesempenhoPrevio !== undefined ? `nota de desempenho ${formatarNumero(l.notaDesempenhoPrevio)}` : 'sem avaliação registrada'),
    semDados: 'nenhum licitante empatado tem avaliação de desempenho registrada',
  },
  criterioBooleano(
    'Desenvolvimento de ações de equidade entre homens e mulheres no ambiente de trabalho',
    'Lei 14.133/2021, art. 60, III; Decreto 11.430/2023',
    (l) => l.acoesEquidadeGenero,
    'desenvolve ações de equidade entre homens e mulheres',
  ),
  criterioBooleano(
    'Desenvolvimento de programa de integridade',
    'Lei 14.133/2021, art. 60, IV',
    (l) => l.programaIntegridade,
    'desenvolve programa de integridade',
  ),
  {
    criterio: 'Empresas estabelecidas no território do Estado ou do Distrito Federal do órgão licitante',
    fundamento: 'Lei 14.133/2021, art. 60, § 1º, I',
    naoAplicavel:
      'Não aplicável: a preferência territorial alcança licitações de órgãos e entidades estaduais, distritais e municipais, não de órgão federal.',
    informado: () => false,
    pontuar: () => 0,
    detalhe: () => '',
    semDados: '',
  },
  criterioBooleano('Empresas brasileiras', 'Lei 14.133/2021, art. 60, § 1º, II', (l) => l.empresaBrasileira, 'é empresa brasileira'),
  criterioBooleano(
    'Empresas que invistam em pesquisa e no desenvolvimento de tecnologia no País',
    'Lei 14.133/2021, art. 60, § 1º, III',
    (l) => l.investePesquisaDesenvolvimentoNoPais,
    'investe em pesquisa e desenvolvimento de tecnologia no País',
  ),
  criterioBooleano(
    'Empresas que comprovem a prática de mitigação climática',
    'Lei 14.133/2021, art. 60, § 1º, IV; Lei 12.187/2009',
    (l) => l.praticaMitigacaoClimatica,
    'comprova prática de mitigação climática',
  ),
];

const CRITERIOS_APLICAVEIS = CRITERIOS.filter((c) => c.naoAplicavel === undefined);

function comparar(a: Licitante, b: Licitante): number {
  if (a.valorProposta !== b.valorProposta) return a.valorProposta - b.valorProposta;
  for (const c of CRITERIOS_APLICAVEIS) {
    const diferenca = c.pontuar(b) - c.pontuar(a);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

function validar(licitantes: Licitante[], margem: number): void {
  if (!Array.isArray(licitantes) || licitantes.length === 0) {
    throw new ErroDominio('DESEMPATE_INVALIDO', 'Informe ao menos um licitante.');
  }
  const ids = new Set<string>();
  for (const l of licitantes) {
    if (typeof l.id !== 'string' || l.id.length === 0) throw new ErroDominio('DESEMPATE_INVALIDO', 'Licitante sem id.');
    if (ids.has(l.id)) throw new ErroDominio('DESEMPATE_INVALIDO', `id de licitante repetido: ${l.id}.`);
    ids.add(l.id);
    exigirInteiro(l.valorProposta, `valorProposta de ${l.id}`, 'DESEMPATE_INVALIDO', 0);
    if (l.lanceDisputaFinal !== undefined) exigirInteiro(l.lanceDisputaFinal, `lanceDisputaFinal de ${l.id}`, 'DESEMPATE_INVALIDO', 0);
    if (l.notaDesempenhoPrevio !== undefined) {
      exigirFinito(l.notaDesempenhoPrevio, `notaDesempenhoPrevio de ${l.id}`, 'DESEMPATE_INVALIDO');
      if (l.notaDesempenhoPrevio < 0 || l.notaDesempenhoPrevio > 100) {
        throw new ErroDominio('DESEMPATE_INVALIDO', `notaDesempenhoPrevio de ${l.id} deve estar entre 0 e 100.`);
      }
    }
  }
  exigirFinito(margem, 'margemEmpateFictoPercentual', 'DESEMPATE_INVALIDO');
  if (margem < 0) throw new ErroDominio('DESEMPATE_INVALIDO', 'margemEmpateFictoPercentual não pode ser negativa.');
}

function nomes(ls: readonly Licitante[]): string {
  return ls.map((l) => l.nome).join(', ');
}

/**
 * Classifica por menor valor e, se o 1º lugar estiver empatado, aplica os critérios do art. 60 em ordem,
 * apenas entre os empatados. Persistindo o empate, sorteioNecessario = true.
 * Com `empateFictoMeEpp`, registra passo informativo (ordem 0) quando há ME/EPP com proposta até a margem
 * (padrão 5%, pregão) acima da melhor proposta de licitante que não é ME/EPP — sem alterar a classificação.
 */
export function aplicarDesempate(
  licitantes: Licitante[],
  opcoes?: { empateFictoMeEpp?: boolean; margemEmpateFictoPercentual?: number },
): {
  classificacao: { id: string; nome: string; posicao: number; valorConsiderado: Centavos }[];
  empateDetectado: boolean;
  criterioDecisivo: string | null;
  passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[];
  sorteioNecessario: boolean;
} {
  const margem = opcoes?.margemEmpateFictoPercentual ?? 5;
  validar(licitantes, margem);

  const porValor = [...licitantes].sort((a, b) => a.valorProposta - b.valorProposta);
  const ordenados = [...licitantes].sort(comparar);
  const melhorValor = porValor[0]?.valorProposta ?? 0;
  const passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[] = [];

  if (opcoes?.empateFictoMeEpp === true) {
    const naoMeEppNoTopo = porValor.find((l) => l.meEpp !== true && l.valorProposta === melhorValor);
    if (naoMeEppNoTopo !== undefined) {
      const naMargem = porValor.filter((l) => l.meEpp === true && l.valorProposta * 100 <= melhorValor * (100 + margem));
      const primeiraMeEpp = naMargem[0];
      if (primeiraMeEpp !== undefined) {
        passos.push({
          ordem: 0,
          criterio: 'Empate ficto — preferência de microempresa e empresa de pequeno porte',
          fundamento: 'LC 123/2006, arts. 44 e 45',
          resultado: `${nomes(naMargem)} com proposta igual ou até ${formatarNumero(margem)}% superior à melhor proposta (${naoMeEppNoTopo.nome}, ${formatarMoeda(melhorValor)}). A ME/EPP mais bem classificada (${primeiraMeEpp.nome}) deve ser convocada para apresentar proposta inferior à melhor proposta (LC 123/2006, art. 45, I). Passo informativo: a classificação abaixo não foi alterada.`,
        });
      }
    }
  }

  const empatadosNoTopo = porValor.filter((l) => l.valorProposta === melhorValor);
  const empateDetectado = empatadosNoTopo.length > 1;
  let criterioDecisivo: string | null = null;
  let sorteioNecessario = false;

  if (empateDetectado) {
    let grupo = empatadosNoTopo;
    let ordem = 1;
    for (const c of CRITERIOS) {
      if (c.naoAplicavel !== undefined) {
        passos.push({ ordem, criterio: c.criterio, fundamento: c.fundamento, resultado: c.naoAplicavel });
        ordem += 1;
        continue;
      }
      if (!grupo.some(c.informado)) {
        passos.push({ ordem, criterio: c.criterio, fundamento: c.fundamento, resultado: `Sem efeito: ${c.semDados}.` });
        ordem += 1;
        continue;
      }
      const melhorPontuacao = Math.max(...grupo.map(c.pontuar));
      const restantes = grupo.filter((l) => c.pontuar(l) === melhorPontuacao);
      const detalhes = grupo.map((l) => `${l.nome}: ${c.detalhe(l)}`).join('; ');
      if (restantes.length === grupo.length) {
        passos.push({ ordem, criterio: c.criterio, fundamento: c.fundamento, resultado: `Sem efeito: os empatados permanecem em igualdade (${detalhes}).` });
      } else if (restantes.length === 1) {
        passos.push({ ordem, criterio: c.criterio, fundamento: c.fundamento, resultado: `Desempate: ${nomes(restantes)} fica em 1º lugar (${detalhes}).` });
        criterioDecisivo = `${c.criterio} (${c.fundamento})`;
        grupo = restantes;
        break;
      } else {
        passos.push({ ordem, criterio: c.criterio, fundamento: c.fundamento, resultado: `Desempate parcial: permanecem empatados ${nomes(restantes)} (${detalhes}).` });
      }
      grupo = restantes;
      ordem += 1;
    }
    sorteioNecessario = grupo.length > 1;
  }

  const empatados = new Set<string>();
  for (const l of licitantes) {
    if (licitantes.some((o) => o !== l && o.valorProposta === l.valorProposta)) empatados.add(l.id);
  }
  const classificacao: { id: string; nome: string; posicao: number; valorConsiderado: Centavos }[] = [];
  ordenados.forEach((l, i) => {
    const anterior = ordenados[i - 1];
    const posicaoAnterior = classificacao[i - 1]?.posicao;
    const posicao = anterior !== undefined && posicaoAnterior !== undefined && comparar(anterior, l) === 0 ? posicaoAnterior : i + 1;
    const valorConsiderado = empatados.has(l.id) && l.lanceDisputaFinal !== undefined ? l.lanceDisputaFinal : l.valorProposta;
    classificacao.push({ id: l.id, nome: l.nome, posicao, valorConsiderado });
  });

  return { classificacao, empateDetectado, criterioDecisivo, passos, sorteioNecessario };
}
