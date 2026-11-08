/**
 * Auditor contínuo (RIA-15, "Auditor IA contínuo" da 2ª linha de defesa): varredura determinística das notas
 * fiscais, das medições (recebimentos) e dos termos aditivos de cada contrato em busca de sinais de anomalia
 * financeira, desequilíbrio econômico-financeiro, sobrepreço ou superfaturamento (art. 6º, LVI e LVII; art. 169).
 *
 * Cada sinal traz o fundamento legal e as evidências e requer revisão humana: não acusa, não glosa, não sanciona.
 * Funções puras sobre os registros do contrato; valores em centavos.
 */
import { type DataISO } from '../datas.ts';
import { type Centavos, formatarMoeda } from '../moeda.ts';
import { adicionarMeses, formatarNumero } from '../interno.ts';
import { ErroDominio } from '../erros.ts';

export type TipoSinalAuditor =
  | 'nota_duplicada'
  | 'nota_atipica'
  | 'execucao_acima_valor'
  | 'pagamento_antecipado'
  | 'reajuste_antecipado'
  | 'recebimento_acima_contratado'
  | 'sobrepreco_estimativa';

export interface PagamentoAuditavel {
  notaFiscal: string;
  competencia: string;
  valor: Centavos;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  /** Data do atesto (AAAA-MM-DD), quando houver. */
  atestadoEm: DataISO | null;
  pagoEm: DataISO | null;
}

export interface AditivoAuditavel {
  numero: string;
  tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste';
  valor: Centavos;
  assinadoEm: DataISO;
}

export interface ItemAuditavel {
  numero: number;
  descricao: string;
  quantidade: number;
  quantidadeRecebida: number;
}

export interface ContratoAuditavel {
  valorInicial: Centavos;
  /** Valor inicial + acréscimos − supressões + reajustes + prorrogações. */
  valorGlobal: Centavos;
  dataBaseReajuste: DataISO;
  pagamentos: readonly PagamentoAuditavel[];
  aditivos: readonly AditivoAuditavel[];
  itens: readonly ItemAuditavel[];
  /** Valor estimado na pesquisa de preços do processo que gerou o contrato; `null` sem processo ou com orçamento sigiloso. */
  valorEstimadoProcesso: Centavos | null;
}

export interface SinalAuditor {
  tipo: TipoSinalAuditor;
  nivel: 'risco' | 'atencao';
  titulo: string;
  descricao: string;
  fundamento: string;
  evidencias: string[];
}

/** Nota com valor acima deste múltiplo da mediana das notas do contrato é atípica. */
export const MULTIPLO_NOTA_ATIPICA = 2.5;
/** Mínimo de notas para a mediana servir de referência. */
export const MINIMO_NOTAS_MEDIANA = 4;
/** Interregno mínimo do reajuste, em meses (Lei 10.192/2001, art. 2º, § 1º). */
export const INTERREGNO_REAJUSTE_MESES = 12;

export const AVISO_AUDITOR_CONTINUO =
  'Sinais do auditor contínuo: indícios para conferência pela 2ª linha, com as evidências. Não constituem conclusão de irregularidade, glosa ou sanção — requerem revisão humana.';

function chaveNota(nota: string): string {
  return nota.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/^(NF-?E?|NOTA FISCAL)\s*(N[º°O.]*)?\s*/, '').replace(/[^0-9A-Z]/g, '');
}

function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1 ? (ordenados[meio] ?? 0) : ((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2;
}

function emitidas(c: ContratoAuditavel): PagamentoAuditavel[] {
  return c.pagamentos.filter((p) => p.situacao !== 'previsto');
}

function notasDuplicadas(c: ContratoAuditavel): SinalAuditor[] {
  const grupos = new Map<string, PagamentoAuditavel[]>();
  for (const p of emitidas(c)) {
    const chave = chaveNota(p.notaFiscal);
    if (chave.length === 0) continue;
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      tipo: 'nota_duplicada',
      nivel: 'risco',
      titulo: 'Mesma nota fiscal registrada mais de uma vez',
      descricao: `A nota fiscal ${g[0]?.notaFiscal ?? ''} aparece ${g.length} vezes no contrato. Confira se não há cobrança em duplicidade da mesma entrega ou medição.`,
      fundamento: 'Lei 14.133/2021, art. 6º, LVII, "a", e art. 117, § 1º',
      evidencias: g.map((p) => `${p.notaFiscal} — competência ${p.competencia}, ${formatarMoeda(p.valor)} (${p.situacao})`),
    }));
}

function notasAtipicas(c: ContratoAuditavel): SinalAuditor[] {
  const notas = emitidas(c);
  if (notas.length < MINIMO_NOTAS_MEDIANA) return [];
  const referencia = mediana(notas.map((p) => p.valor));
  if (referencia <= 0) return [];
  const atipicas = notas.filter((p) => p.valor > referencia * MULTIPLO_NOTA_ATIPICA);
  if (atipicas.length === 0) return [];
  return [
    {
      tipo: 'nota_atipica',
      nivel: 'atencao',
      titulo: 'Nota fiscal com valor fora do padrão do contrato',
      descricao: `${atipicas.length === 1 ? 'Uma nota fiscal tem' : `${atipicas.length} notas fiscais têm`} valor acima de ${formatarNumero(MULTIPLO_NOTA_ATIPICA)} vezes a mediana das notas do contrato (${formatarMoeda(Math.round(referencia))}). Confira a medição e o cronograma físico-financeiro.`,
      fundamento: 'Lei 14.133/2021, art. 6º, LVII, "a" e "d"',
      evidencias: atipicas.map((p) => `${p.notaFiscal} — competência ${p.competencia}: ${formatarMoeda(p.valor)} (${formatarNumero(p.valor / referencia)} vezes a mediana)`),
    },
  ];
}

function execucaoAcimaDoValor(c: ContratoAuditavel): SinalAuditor[] {
  const total = emitidas(c).reduce((s, p) => s + p.valor, 0);
  if (c.valorGlobal <= 0 || total <= c.valorGlobal) return [];
  return [
    {
      tipo: 'execucao_acima_valor',
      nivel: 'risco',
      titulo: 'Notas fiscais acima do valor do contrato',
      descricao: `As notas fiscais atestadas, liquidadas ou pagas somam ${formatarMoeda(total)}, acima do valor global do contrato (${formatarMoeda(c.valorGlobal)}). Acréscimo de valor só se faz por termo aditivo, dentro dos limites legais.`,
      fundamento: 'Lei 14.133/2021, art. 6º, LVII, "a", e art. 124, I, "b"',
      evidencias: [`Soma das notas: ${formatarMoeda(total)}`, `Valor global (com aditivos e reajustes): ${formatarMoeda(c.valorGlobal)}`, `Excedente: ${formatarMoeda(total - c.valorGlobal)}`],
    },
  ];
}

function pagamentosAntecipados(c: ContratoAuditavel): SinalAuditor[] {
  const antecipados = c.pagamentos.filter((p) => p.pagoEm !== null && (p.atestadoEm === null || p.pagoEm < p.atestadoEm));
  if (antecipados.length === 0) return [];
  return [
    {
      tipo: 'pagamento_antecipado',
      nivel: 'risco',
      titulo: 'Pagamento antes do atesto da nota fiscal',
      descricao: `${antecipados.length === 1 ? 'Um pagamento foi feito' : `${antecipados.length} pagamentos foram feitos`} antes do atesto (ou sem atesto). O pagamento antecipado só é admitido nas hipóteses do art. 145, § 1º, com previsão no edital.`,
      fundamento: 'Lei 14.133/2021, art. 145, caput e § 1º, e art. 6º, LVII, "d"',
      evidencias: antecipados.map((p) => `${p.notaFiscal} — pago em ${p.pagoEm}${p.atestadoEm ? `, atestado em ${p.atestadoEm}` : ', sem atesto'}`),
    },
  ];
}

function reajustesAntecipados(c: ContratoAuditavel): SinalAuditor[] {
  const reajustes = c.aditivos.filter((a) => a.tipo === 'reajuste').sort((a, b) => a.assinadoEm.localeCompare(b.assinadoEm));
  const evidencias: string[] = [];
  let referencia = c.dataBaseReajuste;
  for (const r of reajustes) {
    const minimo = adicionarMeses(referencia, INTERREGNO_REAJUSTE_MESES);
    if (r.assinadoEm < minimo) evidencias.push(`${r.numero} — assinado em ${r.assinadoEm}, antes de ${minimo} (1 ano de ${referencia}); ${formatarMoeda(r.valor)}`);
    referencia = r.assinadoEm;
  }
  if (evidencias.length === 0) return [];
  return [
    {
      tipo: 'reajuste_antecipado',
      nivel: 'atencao',
      titulo: 'Reajuste antes do interregno de 1 ano',
      descricao: 'Há reajuste concedido antes de 1 ano da data-base ou do reajuste anterior. Confira o índice, a data-base e o equilíbrio econômico-financeiro do contrato.',
      fundamento: 'Lei 14.133/2021, art. 25, § 7º, e art. 92, § 3º; Lei 10.192/2001, art. 2º, § 1º',
      evidencias,
    },
  ];
}

function recebimentosAcimaDoContratado(c: ContratoAuditavel): SinalAuditor[] {
  const acima = c.itens.filter((i) => i.quantidadeRecebida > i.quantidade);
  if (acima.length === 0) return [];
  return [
    {
      tipo: 'recebimento_acima_contratado',
      nivel: 'risco',
      titulo: 'Quantidade recebida acima da contratada',
      descricao: 'A medição registra quantidade recebida maior que a contratada. Confira se houve termo aditivo de acréscimo ou erro de medição.',
      fundamento: 'Lei 14.133/2021, art. 6º, LVII, "a", e art. 124, I, "b"',
      evidencias: acima.map((i) => `Item ${i.numero} (${i.descricao}): recebidas ${i.quantidadeRecebida.toLocaleString('pt-BR')}, contratadas ${i.quantidade.toLocaleString('pt-BR')}`),
    },
  ];
}

function sobreprecoEstimativa(c: ContratoAuditavel): SinalAuditor[] {
  if (c.valorEstimadoProcesso === null || c.valorEstimadoProcesso <= 0 || c.valorInicial <= c.valorEstimadoProcesso) return [];
  const excesso = (c.valorInicial / c.valorEstimadoProcesso - 1) * 100;
  return [
    {
      tipo: 'sobrepreco_estimativa',
      nivel: 'atencao',
      titulo: 'Valor contratado acima do estimado na pesquisa de preços',
      descricao: `O valor inicial do contrato (${formatarMoeda(c.valorInicial)}) supera em ${formatarNumero(Math.round(excesso * 10) / 10)}% o valor estimado na pesquisa de preços do processo (${formatarMoeda(c.valorEstimadoProcesso)}). Confira a aceitabilidade da proposta e a justificativa.`,
      fundamento: 'Lei 14.133/2021, art. 6º, LVI, e art. 59, III',
      evidencias: [`Valor estimado do processo: ${formatarMoeda(c.valorEstimadoProcesso)}`, `Valor inicial do contrato: ${formatarMoeda(c.valorInicial)}`],
    },
  ];
}

/**
 * Sinais do auditor contínuo para um contrato: nota fiscal duplicada ou atípica, notas acima do valor global,
 * pagamento antes do atesto, reajuste antes de 1 ano, recebimento acima do contratado e valor contratado acima da
 * estimativa do processo. Os riscos vêm antes da atenção.
 */
export function sinaisAuditorContinuo(contrato: ContratoAuditavel): SinalAuditor[] {
  if (!Number.isSafeInteger(contrato.valorInicial) || !Number.isSafeInteger(contrato.valorGlobal)) {
    throw new ErroDominio('VALOR_INVALIDO', 'Os valores do contrato devem ser inteiros em centavos.');
  }
  const sinais = [
    ...notasDuplicadas(contrato),
    ...execucaoAcimaDoValor(contrato),
    ...pagamentosAntecipados(contrato),
    ...recebimentosAcimaDoContratado(contrato),
    ...notasAtipicas(contrato),
    ...reajustesAntecipados(contrato),
    ...sobreprecoEstimativa(contrato),
  ];
  return sinais.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'risco' ? -1 : 1));
}
