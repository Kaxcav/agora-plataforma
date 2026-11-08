/**
 * Formatações complementares às de `@agora/dominio` (moeda e datas de calendário vêm do domínio).
 * Instantes (`InstanteISO`) são exibidos no fuso de Brasília.
 */
import type { InstanteISO } from '@agora/contratos';

const FUSO = 'America/Sao_Paulo';

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const formatoNumero = new Intl.NumberFormat('pt-BR');
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** "08/11/2026 às 02:10" */
export function formatarInstante(instante: InstanteISO): string {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return instante;
  const partes = formatoDataHora.formatToParts(data);
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('day')}/${parte('month')}/${parte('year')} às ${parte('hour')}:${parte('minute')}`;
}

export function formatarNumero(valor: number): string {
  return formatoNumero.format(valor);
}

/** 45.25 → "45,3%" */
export function formatarPercentual(valor: number, casas = 1): string {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

function partesMes(mes: string): { ano: string; indice: number } | null {
  const correspondencia = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!correspondencia) return null;
  const indice = Number(correspondencia[2]) - 1;
  if (indice < 0 || indice > 11) return null;
  return { ano: correspondencia[1] ?? '', indice };
}

/** "2026-10" → "out/2026" */
export function formatarCompetencia(mes: string): string {
  const p = partesMes(mes);
  return p ? `${MESES_CURTOS[p.indice]}/${p.ano}` : mes;
}

/** "2026-10" → "out" */
export function formatarMesCurto(mes: string): string {
  const p = partesMes(mes);
  return p ? (MESES_CURTOS[p.indice] ?? mes) : mes;
}

/** "2026-10" → "outubro de 2026" */
export function formatarMesLongo(mes: string): string {
  const p = partesMes(mes);
  return p ? `${MESES_LONGOS[p.indice]} de ${p.ano}` : mes;
}

/** Pluralização simples: (1, 'contrato', 'contratos') → "1 contrato". */
export function contar(quantidade: number, singular: string, plural: string): string {
  return `${formatarNumero(quantidade)} ${quantidade === 1 ? singular : plural}`;
}

/** Abrevia hashes longos para exibição: "a1b2c3…f9e8". */
export function abreviarHash(hash: string, inicio = 8, fim = 6): string {
  return hash.length <= inicio + fim + 1 ? hash : `${hash.slice(0, inicio)}…${hash.slice(-fim)}`;
}
