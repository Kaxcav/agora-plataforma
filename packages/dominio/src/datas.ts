/**
 * Datas de calendário ('AAAA-MM-DD') com aritmética UTC, feriados nacionais e contagem de prazos.
 *
 * Lei 14.133/2021, art. 183: os prazos são contados excluindo o dia do começo e incluindo o do vencimento;
 * dias úteis são os dias com expediente; se o vencimento cair em dia sem expediente, o prazo é prorrogado
 * para o primeiro dia útil seguinte.
 */
import { ErroDominio } from './erros.ts';
import { EPOCA_MAXIMA, MS_POR_DIA, escreverData, exigirInteiro, lerData, partesData } from './interno.ts';

/** Data de calendário 'AAAA-MM-DD'. */
export type DataISO = string;

export interface OpcoesCalendario {
  /** Feriados locais/portarias cadastrados pelo órgão (dias sem expediente). */
  feriadosExtras?: DataISO[];
  /** Padrão true: Carnaval (segunda e terça) e Corpus Christi são dias sem expediente. */
  considerarPontosFacultativos?: boolean;
}

export interface FeriadoNacional {
  data: DataISO;
  nome: string;
  tipo: 'feriado' | 'ponto_facultativo';
}

const FUNDAMENTO_ART_183 = 'Lei 14.133/2021, art. 183';
/** Primeiro ano do Dia Nacional de Zumbi e da Consciência Negra como feriado (Lei 14.759, de 21/12/2023). */
const ANO_INICIAL_CONSCIENCIA_NEGRA = 2024;

export function validarDataISO(d: string): boolean {
  return partesData(d) !== null;
}

/** Data de hoje no fuso America/Sao_Paulo. */
export function hojeISO(agora: Date): DataISO {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new ErroDominio('DATA_INVALIDA', 'Instante inválido para obter a data de hoje.');
  }
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const valor = (tipo: 'year' | 'month' | 'day'): string => partes.find((p) => p.type === tipo)?.value ?? '';
  const data = `${valor('year').padStart(4, '0')}-${valor('month')}-${valor('day')}`;
  lerData(data, 'hoje');
  return data;
}

export function adicionarDias(d: DataISO, n: number): DataISO {
  exigirInteiro(n, 'n', 'DIAS_INVALIDOS');
  return escreverData(lerData(d) + n);
}

/** fim − inicio, em dias (negativo se fim < inicio). */
export function diasEntre(inicio: DataISO, fim: DataISO): number {
  return lerData(fim, 'fim') - lerData(inicio, 'inicio');
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(d: DataISO): number {
  return new Date(lerData(d) * MS_POR_DIA).getUTCDay();
}

/** Domingo de Páscoa (calendário gregoriano) pelo algoritmo de Meeus/Jones/Butcher. */
export function pascoa(ano: number): DataISO {
  exigirInteiro(ano, 'ano', 'ANO_INVALIDO');
  if (ano < 1583 || ano > 9999) {
    throw new ErroDominio('ANO_INVALIDO', 'ano deve estar entre 1583 (calendário gregoriano) e 9999.');
  }
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Feriados nacionais (Leis 662/1949, 6.802/1980 e 14.759/2023) e pontos facultativos com dia sem expediente
 * (Carnaval e Corpus Christi), ordenados por data. O Dia Nacional de Zumbi e da Consciência Negra entra a partir de 2024.
 */
export function feriadosNacionais(ano: number): FeriadoNacional[] {
  const domingoPascoa = lerData(pascoa(ano));
  const a = String(ano).padStart(4, '0');
  const relativoPascoa = (deslocamento: number): DataISO => escreverData(domingoPascoa + deslocamento);
  const lista: FeriadoNacional[] = [
    { data: `${a}-01-01`, nome: 'Confraternização Universal', tipo: 'feriado' },
    { data: relativoPascoa(-48), nome: 'Carnaval (segunda-feira)', tipo: 'ponto_facultativo' },
    { data: relativoPascoa(-47), nome: 'Carnaval (terça-feira)', tipo: 'ponto_facultativo' },
    { data: relativoPascoa(-2), nome: 'Sexta-feira Santa (Paixão de Cristo)', tipo: 'feriado' },
    { data: `${a}-04-21`, nome: 'Tiradentes', tipo: 'feriado' },
    { data: `${a}-05-01`, nome: 'Dia do Trabalho', tipo: 'feriado' },
    { data: relativoPascoa(60), nome: 'Corpus Christi', tipo: 'ponto_facultativo' },
    { data: `${a}-09-07`, nome: 'Independência do Brasil', tipo: 'feriado' },
    { data: `${a}-10-12`, nome: 'Nossa Senhora Aparecida', tipo: 'feriado' },
    { data: `${a}-11-02`, nome: 'Finados', tipo: 'feriado' },
    { data: `${a}-11-15`, nome: 'Proclamação da República', tipo: 'feriado' },
    { data: `${a}-12-25`, nome: 'Natal', tipo: 'feriado' },
  ];
  if (ano >= ANO_INICIAL_CONSCIENCIA_NEGRA) {
    lista.push({ data: `${a}-11-20`, nome: 'Dia Nacional de Zumbi e da Consciência Negra', tipo: 'feriado' });
  }
  return lista.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0));
}

/** Cria um verificador de dia útil (em dias desde a época) com os feriados do ano em cache local. */
function criarVerificadorDiaUtil(opcoes?: OpcoesCalendario): (dias: number) => boolean {
  const considerarPontos = opcoes?.considerarPontosFacultativos ?? true;
  const extras = new Set<number>();
  for (const f of opcoes?.feriadosExtras ?? []) extras.add(lerData(f, 'feriadosExtras'));
  const semExpedientePorAno = new Map<number, Set<number>>();
  return (dias) => {
    const instante = new Date(dias * MS_POR_DIA);
    const semana = instante.getUTCDay();
    if (semana === 0 || semana === 6 || extras.has(dias)) return false;
    const ano = instante.getUTCFullYear();
    let semExpediente = semExpedientePorAno.get(ano);
    if (semExpediente === undefined) {
      semExpediente = new Set(
        feriadosNacionais(ano)
          .filter((f) => considerarPontos || f.tipo === 'feriado')
          .map((f) => lerData(f.data)),
      );
      semExpedientePorAno.set(ano, semExpediente);
    }
    return !semExpediente.has(dias);
  };
}

function diaSeguinte(dias: number): number {
  if (dias >= EPOCA_MAXIMA) {
    throw new ErroDominio('DATA_FORA_DO_INTERVALO', 'A contagem ultrapassou a última data suportada (9999-12-31).');
  }
  return dias + 1;
}

export function ehDiaUtil(d: DataISO, opcoes?: OpcoesCalendario): boolean {
  return criarVerificadorDiaUtil(opcoes)(lerData(d));
}

/** d, se for dia útil; senão o primeiro dia útil seguinte. */
export function proximoDiaUtil(d: DataISO, opcoes?: OpcoesCalendario): DataISO {
  const util = criarVerificadorDiaUtil(opcoes);
  let atual = lerData(d);
  while (!util(atual)) atual = diaSeguinte(atual);
  return escreverData(atual);
}

/** n ≥ 0 dias úteis após d (d excluído). n = 0 retorna d se útil, senão o próximo dia útil. */
export function adicionarDiasUteis(d: DataISO, n: number, opcoes?: OpcoesCalendario): DataISO {
  exigirInteiro(n, 'n', 'DIAS_INVALIDOS', 0);
  if (n === 0) return proximoDiaUtil(d, opcoes);
  const util = criarVerificadorDiaUtil(opcoes);
  let atual = lerData(d);
  let contados = 0;
  while (contados < n) {
    atual = diaSeguinte(atual);
    if (util(atual)) contados += 1;
  }
  return escreverData(atual);
}

/** Dias úteis no intervalo (inicio, fim]: exclui o início, inclui o fim. fim < inicio → negativo simétrico. */
export function diasUteisEntre(inicio: DataISO, fim: DataISO, opcoes?: OpcoesCalendario): number {
  const a = lerData(inicio, 'inicio');
  const b = lerData(fim, 'fim');
  const util = criarVerificadorDiaUtil(opcoes);
  const contar = (de: number, ate: number): number => {
    let total = 0;
    for (let dia = de + 1; dia <= ate; dia += 1) if (util(dia)) total += 1;
    return total;
  };
  return b < a ? -contar(b, a) : contar(a, b);
}

/**
 * Vencimento de prazo (art. 183). Corridos: soma os dias e, se cair em dia sem expediente, prorroga para o
 * primeiro dia útil seguinte. Úteis: conta apenas dias com expediente, excluindo o dia do começo.
 */
export function contarPrazo(
  inicio: DataISO,
  dias: number,
  tipo: 'uteis' | 'corridos',
  opcoes?: OpcoesCalendario,
): { vencimento: DataISO; fundamento: string } {
  exigirInteiro(dias, 'dias', 'DIAS_INVALIDOS', 0);
  if (tipo === 'uteis') {
    return { vencimento: adicionarDiasUteis(inicio, dias, opcoes), fundamento: FUNDAMENTO_ART_183 };
  }
  if (tipo === 'corridos') {
    return { vencimento: proximoDiaUtil(adicionarDias(inicio, dias), opcoes), fundamento: FUNDAMENTO_ART_183 };
  }
  throw new ErroDominio('TIPO_PRAZO_INVALIDO', `Tipo de prazo inválido: ${String(tipo)}. Use 'uteis' ou 'corridos'.`);
}

/** "08/11/2026". */
export function formatarData(d: DataISO): string {
  const p = partesData(d);
  if (p === null) throw new ErroDominio('DATA_INVALIDA', `data inválida: ${String(d)}.`);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${String(p.ano).padStart(4, '0')}`;
}
