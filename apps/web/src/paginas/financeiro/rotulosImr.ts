import type { SituacaoConferenciaNota } from '@agora/contratos';
import type { TomEtiqueta } from '../../componentes';

/** Situação da conferência da nota fiscal (RN-36). */
export const SITUACOES_CONFERENCIA: Record<SituacaoConferenciaNota, { rotulo: string; tom: TomEtiqueta }> = {
  conforme: { rotulo: 'Conforme', tom: 'sucesso' },
  divergente: { rotulo: 'Divergente', tom: 'erro' },
  justificada: { rotulo: 'Divergência justificada', tom: 'aviso' },
};
