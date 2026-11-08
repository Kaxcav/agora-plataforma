/**
 * Índice de Desempenho Contratual (IDC) do fornecedor — avaliação de desempenho prevista na
 * Lei 14.133/2021, art. 88, §§ 3º e 4º. Indicador objetivo de apoio; não constitui sanção.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, formatarData } from '../datas.ts';
import type { TipoSancao } from './sancoes.ts';
import { adicionarMeses, arredondar, exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';

export interface IndicadoresDesempenho {
  entregasNoPrazo: number;
  entregasTotal: number;
  /** Termos de recebimento definitivo sem ressalva. */
  recebimentosAprovados: number;
  recebimentosTotal: number;
  ocorrenciasFiscalizacao: number;
  ocorrenciasResolvidasNoPrazo: number;
  sancoes: { tipo: TipoSancao; dataAplicacao: DataISO }[];
}

/** Pesos dos componentes; devem somar 1. */
export interface PesosIdc {
  prazo: number;
  qualidade: number;
  ocorrencias: number;
}

export const PESOS_IDC_PADRAO: PesosIdc = Object.freeze({ prazo: 0.4, qualidade: 0.4, ocorrencias: 0.2 });

const DESCONTOS: Record<TipoSancao, number> = {
  advertencia: -5,
  multa: -10,
  impedimento_licitar: -25,
  declaracao_inidoneidade: -40,
};
const JANELA_SANCOES_MESES = 36;
const AVISO_IDC =
  'Indicador objetivo de apoio (Lei 14.133/2021, art. 88, §§ 3º e 4º). Não constitui sanção nem impede participação em licitações; impedimento decorre exclusivamente de sanção aplicada em processo.';

export type FaixaIdc = 'diamante' | 'ouro' | 'prata' | 'em_observacao' | 'critico' | 'sem_historico';

/** Faixa (selo) de uma nota de 0 a 100: diamante ≥ 90; ouro ≥ 75; prata ≥ 60; em observação ≥ 50; crítico < 50. */
export function faixaDaNota(nota: number): FaixaIdc {
  if (nota >= 90) return 'diamante';
  if (nota >= 75) return 'ouro';
  if (nota >= 60) return 'prata';
  if (nota >= 50) return 'em_observacao';
  return 'critico';
}

function exigirParTotal(parte: number, total: number, nomeParte: string, nomeTotal: string): void {
  exigirInteiro(total, nomeTotal, 'IDC_INVALIDO', 0);
  exigirInteiro(parte, nomeParte, 'IDC_INVALIDO', 0);
  if (parte > total) throw new ErroDominio('IDC_INVALIDO', `${nomeParte} não pode ser maior que ${nomeTotal}.`);
}

/**
 * IDC = Σ (componente × peso) + descontos por sanções aplicadas nos últimos 36 meses, limitado a 0–100 (1 casa).
 * Componentes: pontualidade das entregas, qualidade dos recebimentos e tratamento de ocorrências da fiscalização.
 * Componente sem dados (total 0) vale 100 e é indicado na metodologia. Sem nenhum histórico: nota 0,
 * faixa 'sem_historico' e semHistorico = true (a ausência de dados não é penalizada).
 */
export function calcularIdc(
  ind: IndicadoresDesempenho,
  hoje: DataISO,
  pesos: PesosIdc = PESOS_IDC_PADRAO,
): {
  nota: number;
  faixa: FaixaIdc;
  componentes: { nome: string; valor: number; peso: number; contribuicao: number }[];
  penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[];
  semHistorico: boolean;
  metodologia: string;
  fundamento: string;
  aviso: string;
} {
  const referencia = lerData(hoje, 'hoje');
  exigirParTotal(ind.entregasNoPrazo, ind.entregasTotal, 'entregasNoPrazo', 'entregasTotal');
  exigirParTotal(ind.recebimentosAprovados, ind.recebimentosTotal, 'recebimentosAprovados', 'recebimentosTotal');
  exigirParTotal(ind.ocorrenciasResolvidasNoPrazo, ind.ocorrenciasFiscalizacao, 'ocorrenciasResolvidasNoPrazo', 'ocorrenciasFiscalizacao');
  if (!Array.isArray(ind.sancoes)) throw new ErroDominio('IDC_INVALIDO', 'sancoes deve ser uma lista.');
  for (const nome of ['prazo', 'qualidade', 'ocorrencias'] as const) {
    exigirFinito(pesos[nome], `pesos.${nome}`, 'IDC_INVALIDO');
    if (pesos[nome] < 0) throw new ErroDominio('IDC_INVALIDO', `pesos.${nome} não pode ser negativo.`);
  }
  if (Math.abs(pesos.prazo + pesos.qualidade + pesos.ocorrencias - 1) > 1e-9) {
    throw new ErroDominio('IDC_INVALIDO', 'Os pesos do IDC devem somar 1.');
  }

  const definicoes = [
    { nome: 'Pontualidade das entregas', parte: ind.entregasNoPrazo, total: ind.entregasTotal, peso: pesos.prazo },
    { nome: 'Qualidade dos recebimentos', parte: ind.recebimentosAprovados, total: ind.recebimentosTotal, peso: pesos.qualidade },
    { nome: 'Tratamento de ocorrências da fiscalização', parte: ind.ocorrenciasResolvidasNoPrazo, total: ind.ocorrenciasFiscalizacao, peso: pesos.ocorrencias },
  ];
  const semDados = definicoes.filter((d) => d.total === 0).map((d) => d.nome);
  const semHistorico = semDados.length === definicoes.length;

  let base = 0;
  const componentes = definicoes.map((d) => {
    const valorExato = d.total === 0 ? 100 : (d.parte / d.total) * 100;
    base += valorExato * d.peso;
    return { nome: d.nome, valor: arredondar(valorExato, 1), peso: d.peso, contribuicao: arredondar(valorExato * d.peso, 2) };
  });

  const penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[] = [];
  for (const s of ind.sancoes) {
    if (!Object.hasOwn(DESCONTOS, s.tipo)) throw new ErroDominio('IDC_INVALIDO', `Tipo de sanção inválido: ${String(s.tipo)}.`);
    const desconto = DESCONTOS[s.tipo];
    const aplicacao = lerData(s.dataAplicacao, 'dataAplicacao');
    // Conta enquanto hoje < aplicação + 36 meses (e a aplicação não é futura).
    if (aplicacao <= referencia && referencia < lerData(adicionarMeses(s.dataAplicacao, JANELA_SANCOES_MESES))) {
      penalidades.push({ tipo: s.tipo, dataAplicacao: s.dataAplicacao, desconto });
    }
  }
  const totalDescontos = penalidades.reduce((acc, p) => acc + p.desconto, 0);
  const nota = semHistorico ? 0 : arredondar(Math.min(100, Math.max(0, base + totalDescontos)), 1);
  const faixa: FaixaIdc = semHistorico ? 'sem_historico' : faixaDaNota(nota);

  const pct = (peso: number): string => `${formatarNumero(arredondar(peso * 100, 2))}%`;
  const partes = [
    `IDC = ${pct(pesos.prazo)} × pontualidade das entregas (entregas no prazo ÷ entregas) + ${pct(pesos.qualidade)} × qualidade dos recebimentos (recebimentos definitivos sem ressalva ÷ recebimentos) + ${pct(pesos.ocorrencias)} × tratamento de ocorrências (ocorrências resolvidas no prazo ÷ ocorrências), cada componente de 0 a 100.`,
    `Descontos por sanção aplicada nos últimos ${JANELA_SANCOES_MESES} meses até ${formatarData(hoje)}: advertência −5, multa −10, impedimento de licitar e contratar −25, declaração de inidoneidade −40. Resultado limitado entre 0 e 100.`,
    'Faixas: diamante ≥ 90; ouro ≥ 75; prata ≥ 60; em observação ≥ 50; crítico < 50.',
  ];
  if (semHistorico) {
    partes.push('Sem histórico de entregas, recebimentos ou ocorrências: nota 0 e faixa sem histórico, sem penalizar a ausência de dados.');
  } else if (semDados.length > 0) {
    partes.push(`Componentes sem dados (considerados 100): ${semDados.join('; ')}.`);
  }

  return {
    nota,
    faixa,
    componentes,
    penalidades,
    semHistorico,
    metodologia: partes.join(' '),
    fundamento: 'Lei 14.133/2021, art. 88, §§ 3º e 4º',
    aviso: AVISO_IDC,
  };
}
