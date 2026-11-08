/**
 * Vigência de contratos e atas (semáforo 30/60/90/120) e projeção de queima de saldo.
 */
import { ErroDominio } from './erros.ts';
import { type DataISO, formatarData } from './datas.ts';
import { type Centavos, formatarMoeda, percentual } from './moeda.ts';
import { escreverData, EPOCA_MAXIMA, exigirInteiro, formatarPercentualTexto, lerData } from './interno.ts';

/** vencido: dias < 0; critico: 0..30; atencao: 31..60; alerta: 61..90; planejamento: 91..120 (RN-31); regular: > 120. */
export type Semaforo = 'vencido' | 'critico' | 'atencao' | 'alerta' | 'planejamento' | 'regular';

function semaforoPorDias(dias: number): Semaforo {
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'critico';
  if (dias <= 60) return 'atencao';
  if (dias <= 90) return 'alerta';
  if (dias <= 120) return 'planejamento';
  return 'regular';
}

function rotuloPorDias(dias: number): string {
  if (dias < 0) {
    const atraso = -dias;
    return `Vencido há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`;
  }
  if (dias === 0) return 'Vence hoje';
  return `Vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export function classificarVigencia(fim: DataISO, hoje: DataISO): { diasRestantes: number; semaforo: Semaforo; rotulo: string } {
  const diasRestantes = lerData(fim, 'fim') - lerData(hoje, 'hoje');
  return { diasRestantes, semaforo: semaforoPorDias(diasRestantes), rotulo: rotuloPorDias(diasRestantes) };
}

export interface EntradaQueimaSaldo {
  valorTotal: Centavos;
  valorExecutado: Centavos;
  inicio: DataISO;
  fim: DataISO;
  hoje: DataISO;
}

/**
 * Projeta a data de esgotamento do saldo mantido o ritmo médio de execução.
 * O tempo decorrido é medido de `inicio` até `hoje`, limitado ao período de vigência.
 * Gera sinal para apoio à gestão; não constitui decisão.
 */
export function projetarQueimaSaldo(e: EntradaQueimaSaldo): {
  percentualExecutado: number;
  percentualTempoDecorrido: number;
  ritmoDiario: Centavos;
  dataEsgotamentoProjetada: DataISO | null;
  esgotaAntesDoFim: boolean;
  sinal: 'normal' | 'acelerado' | 'lento';
  explicacao: string;
} {
  exigirInteiro(e.valorTotal, 'valorTotal', 'QUEIMA_SALDO_INVALIDA', 1);
  exigirInteiro(e.valorExecutado, 'valorExecutado', 'QUEIMA_SALDO_INVALIDA', 0);
  const inicio = lerData(e.inicio, 'inicio');
  const fim = lerData(e.fim, 'fim');
  const hoje = lerData(e.hoje, 'hoje');
  if (fim < inicio) throw new ErroDominio('QUEIMA_SALDO_INVALIDA', 'O fim da vigência é anterior ao início.');

  const duracao = fim - inicio;
  const referencia = Math.min(Math.max(hoje, inicio), fim);
  const decorridos = referencia - inicio;
  const percentualExecutado = percentual(e.valorExecutado, e.valorTotal);
  const percentualTempoDecorrido = duracao === 0 ? (hoje >= inicio ? 100 : 0) : percentual(decorridos, duracao);

  const ritmoExato = decorridos > 0 ? e.valorExecutado / decorridos : 0;
  const ritmoDiario = Math.round(ritmoExato);
  let dataEsgotamentoProjetada: DataISO | null = null;
  if (ritmoDiario > 0) {
    const saldo = e.valorTotal - e.valorExecutado;
    const diasAteEsgotar = saldo <= 0 ? 0 : Math.ceil(saldo / ritmoExato);
    const alvo = referencia + diasAteEsgotar;
    // Ritmo ínfimo frente ao saldo pode projetar além do calendário suportado: sem projeção útil.
    dataEsgotamentoProjetada = alvo <= EPOCA_MAXIMA ? escreverData(alvo) : null;
  }
  const esgotaAntesDoFim = dataEsgotamentoProjetada !== null && lerData(dataEsgotamentoProjetada) < fim;

  let sinal: 'normal' | 'acelerado' | 'lento' = 'normal';
  if (percentualExecutado > percentualTempoDecorrido + 15) sinal = 'acelerado';
  else if (percentualExecutado < percentualTempoDecorrido - 30) sinal = 'lento';

  const situacao = `${formatarPercentualTexto(percentualExecutado)} do valor executado com ${formatarPercentualTexto(percentualTempoDecorrido)} da vigência decorrida`;
  const projecao =
    dataEsgotamentoProjetada === null
      ? 'Sem ritmo de execução mensurável, não há projeção de esgotamento.'
      : `Mantido o ritmo médio de ${formatarMoeda(ritmoDiario)} por dia, o saldo se esgota em ${formatarData(dataEsgotamentoProjetada)}${
          esgotaAntesDoFim ? `, antes do fim da vigência (${formatarData(e.fim)})` : ''
        }.`;
  const leitura = {
    acelerado: 'Execução acelerada: avalie a suficiência do saldo e a necessidade de aditivo ou nova contratação.',
    lento: 'Execução lenta: avalie o risco de saldo não utilizado ao fim da vigência.',
    normal: 'Execução compatível com o tempo decorrido.',
  }[sinal];
  const explicacao = `${leitura} ${situacao}. ${projecao} Sinal para apoio à gestão; a decisão cabe ao gestor do contrato.`;

  return { percentualExecutado, percentualTempoDecorrido, ritmoDiario, dataEsgotamentoProjetada, esgotaAntesDoFim, sinal, explicacao };
}
