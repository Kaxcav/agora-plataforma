import type { AssuntoManifestacao, ConclusaoRelatorioFinal, SituacaoManifestacao, SituacaoPrazoResposta } from '@agora/contratos';
import type { TomEtiqueta } from '../../componentes';

export const ASSUNTOS: Record<AssuntoManifestacao, string> = {
  execucao: 'Execução do contrato',
  qualidade: 'Qualidade do que foi entregue',
  prazo: 'Prazo e cronograma',
  atendimento: 'Atendimento ao público',
  outro: 'Outro assunto',
};

export const SITUACOES: Record<SituacaoManifestacao, { rotulo: string; tom: TomEtiqueta }> = {
  em_moderacao: { rotulo: 'Aguardando moderação', tom: 'aviso' },
  publicada: { rotulo: 'Publicada', tom: 'sucesso' },
  recusada: { rotulo: 'Não publicada', tom: 'neutro' },
};

export const PRAZOS: Record<SituacaoPrazoResposta, { rotulo: string; tom: TomEtiqueta }> = {
  aguardando: { rotulo: 'Aguardando resposta', tom: 'info' },
  vence_em_breve: { rotulo: 'Prazo de resposta vence em breve', tom: 'alerta' },
  vencido: { rotulo: 'Prazo de resposta vencido', tom: 'erro' },
  respondida_no_prazo: { rotulo: 'Respondida no prazo', tom: 'sucesso' },
  respondida_fora_do_prazo: { rotulo: 'Respondida fora do prazo', tom: 'aviso' },
};

export const CONCLUSOES: Record<ConclusaoRelatorioFinal, string> = {
  atingidos: 'Objetivos atingidos',
  parcialmente_atingidos: 'Objetivos parcialmente atingidos',
  nao_atingidos: 'Objetivos não atingidos',
};

