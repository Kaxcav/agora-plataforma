import { classificarVigencia, type OpcoesCalendario } from '@agora/dominio';
import type { Semaforo, SituacaoInstrumento, Uasg, UsuarioResumo } from '@agora/contratos';
import type { Executor } from '../banco/tipos.ts';

/**
 * Situação do instrumento a partir do semáforo de vigência do domínio (RN-17):
 * vencido → encerrado; crítico/atenção/alerta (até 90 dias) → a vencer; planejamento (91 a 120 dias, RN-31) e regular → vigente.
 */
export function situacaoPorSemaforo(semaforo: Semaforo): SituacaoInstrumento {
  if (semaforo === 'vencido') return 'encerrado';
  if (semaforo === 'regular' || semaforo === 'planejamento') return 'vigente';
  return 'a_vencer';
}

export interface VigenciaClassificada {
  diasRestantes: number;
  semaforo: Semaforo;
  situacao: SituacaoInstrumento;
}

export function classificar(vigenciaFim: string, hoje: string): VigenciaClassificada {
  const c = classificarVigencia(vigenciaFim, hoje);
  return { diasRestantes: c.diasRestantes, semaforo: c.semaforo, situacao: situacaoPorSemaforo(c.semaforo) };
}

export function usuarioResumo(id: string | null, nome: string | null): UsuarioResumo | null {
  return id !== null && nome !== null ? { id, nome } : null;
}

export function uasgDe(codigo: string, nome: string, sigla: string, uf: string): Uasg {
  return { codigo, nome, sigla, uf };
}

/** Feriados locais cadastrados (somados aos nacionais calculados pelo domínio). */
export async function opcoesCalendario(executor: Executor): Promise<OpcoesCalendario> {
  const linhas = await executor.consultar<{ data: string }>('SELECT data FROM feriados_locais ORDER BY data');
  return { feriadosExtras: linhas.map((l) => l.data), considerarPontosFacultativos: true };
}

/** Links de navegação para o portal do PNCP (o navegador nunca chama a API do PNCP). */
export function linkPncpContrato(idPncp: string | null): string | null {
  if (!idPncp) return null;
  const partes = /^(\d{14})-2-(\d{6})\/(\d{4})$/.exec(idPncp);
  if (!partes) return `https://pncp.gov.br/app/contratos?q=${encodeURIComponent(idPncp)}`;
  const [, cnpj, sequencial, ano] = partes;
  return `https://pncp.gov.br/app/contratos/${cnpj}/${ano}/${Number(sequencial)}`;
}

/** Edital (contratação) no portal do PNCP: identificador "{cnpj}-1-{sequencial}/{ano}". */
export function linkPncpCompra(idPncp: string | null): string | null {
  if (!idPncp) return null;
  const partes = /^(\d{14})-1-(\d{6})\/(\d{4})$/.exec(idPncp);
  if (!partes) return `https://pncp.gov.br/app/editais?q=${encodeURIComponent(idPncp)}`;
  const [, cnpj, sequencial, ano] = partes;
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(sequencial)}`;
}

export function linkPncpAta(idPncp: string): string {
  const partes = /^(\d{14})-1-(\d{6})\/(\d{4})-(\d{6})$/.exec(idPncp);
  if (!partes) return `https://pncp.gov.br/app/atas?q=${encodeURIComponent(idPncp)}`;
  const [, cnpj, sequencialCompra, ano, sequencialAta] = partes;
  return `https://pncp.gov.br/app/atas/${cnpj}/${ano}/${Number(sequencialCompra)}/${Number(sequencialAta)}`;
}

/** Soma `meses` a uma data ISO, ajustando o dia ao fim do mês quando necessário (aniversário da data-base). */
export function adicionarMeses(data: string, meses: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  if (ano === undefined || mes === undefined || dia === undefined) throw new RangeError(`Data inválida: ${data}`);
  const totalMeses = ano * 12 + (mes - 1) + meses;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = (totalMeses % 12) + 1;
  const ultimoDia = new Date(Date.UTC(novoAno, novoMes, 0)).getUTCDate();
  const novoDia = Math.min(dia, ultimoDia);
  return `${String(novoAno).padStart(4, '0')}-${String(novoMes).padStart(2, '0')}-${String(novoDia).padStart(2, '0')}`;
}
