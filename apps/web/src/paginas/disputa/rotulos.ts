import type { ClassificadoSessao, FaseSessaoDisputa, LanceSessao, PerfilLicitanteSimulado, SessaoDisputa, UsoSessaoDisputa } from '@agora/contratos';
import { CRITERIOS_JULGAMENTO_DISPUTA, MODOS_DISPUTA, PERFIS_LICITANTE_SIMULADO, formatarOferta } from '@agora/dominio';
import type { TomEtiqueta } from '../../componentes';

export const ROTULOS_USO: Record<UsoSessaoDisputa, string> = {
  simulacao: 'Simulação (treino)',
  acompanhamento: 'Acompanhamento da sessão oficial',
};

export const ROTULOS_FASE: Record<FaseSessaoDisputa, string> = {
  aguardando_abertura: 'Aguardando abertura',
  lances_abertos: 'Etapa aberta de lances',
  fechamento_iminente: 'Fechamento iminente',
  lance_final_fechado: 'Lance final e fechado',
  encerrada: 'Lances encerrados',
  concluida: 'Sessão concluída',
};

export const TOM_FASE: Record<FaseSessaoDisputa, TomEtiqueta> = {
  aguardando_abertura: 'neutro',
  lances_abertos: 'info',
  fechamento_iminente: 'alerta',
  lance_final_fechado: 'aviso',
  encerrada: 'sucesso',
  concluida: 'neutro',
};

export const ROTULOS_CRITERIO: Record<string, string> = Object.fromEntries(CRITERIOS_JULGAMENTO_DISPUTA.map((c) => [c.criterio, c.rotulo]));
export const ROTULOS_MODO: Record<string, string> = Object.fromEntries(MODOS_DISPUTA.map((m) => [m.modo, m.rotulo]));
export const ROTULOS_PERFIL: Record<PerfilLicitanteSimulado, string> = Object.fromEntries(
  PERFIS_LICITANTE_SIMULADO.map((p) => [p.perfil, p.rotulo]),
) as Record<PerfilLicitanteSimulado, string>;

export const ROTULOS_ORIGEM: Record<ClassificadoSessao['origem'], string> = {
  proposta: 'Proposta',
  lance: 'Último lance',
  lance_final: 'Lance final e fechado',
  negociacao: 'Negociação (art. 61)',
  resultado_oficial: 'Resultado oficial (Compras.gov.br)',
};

export const ROTULOS_ETAPA_LANCE: Record<LanceSessao['fase'], string> = {
  lances_abertos: 'Aberta',
  fechamento_iminente: 'Fechamento iminente',
  lance_final_fechado: 'Lance final',
};

/** Oferta no formato do critério: moeda ou percentual de desconto. */
export function oferta(sessao: Pick<SessaoDisputa, 'criterio'>, valor: number | null): string {
  return valor === null ? '—' : formatarOferta(sessao.criterio, valor);
}

/** "09:58" (minutos e segundos), sem negativo. */
export function formatarCronometro(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

/** "14:03:27" no horário de Brasília. */
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function formatarHora(instante: string): string {
  return HORA.format(new Date(instante));
}
