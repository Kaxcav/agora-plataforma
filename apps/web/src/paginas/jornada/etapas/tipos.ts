import type { ProcessoDetalhe } from '@agora/contratos';

/** Propriedades comuns aos painéis de etapa. */
export interface PropsEtapa {
  processo: ProcessoDetalhe;
  /** A etapa exibida é a etapa atual do processo (e o processo não foi encerrado). */
  atual: boolean;
  /** Etapa atual e perfil com `jornada:editar`. */
  editavel: boolean;
}

/** Mínimo de caracteres das descrições e justificativas exigidas pelas regras de avanço. */
export const MINIMO_TEXTO = 30;

export function textoSuficiente(valor: string | null | undefined, minimo = MINIMO_TEXTO): boolean {
  return (valor ?? '').trim().length >= minimo;
}
