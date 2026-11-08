/**
 * Rótulos pt-BR da central de notificações (RF-26).
 */
import type { CanalNotificacao, FaixaVencimento, ModoCanalNotificacao, PapelDestinatario, SituacaoEnvio, TipoNotificacao } from '@agora/contratos';
import type { RotuloTom } from '../compartilhado/rotulos';

export const TIPOS_NOTIFICACAO: Record<TipoNotificacao, RotuloTom> = {
  vencimento: { rotulo: 'Vencimento', tom: 'aviso' },
  reajuste: { rotulo: 'Reajuste', tom: 'info' },
  garantia: { rotulo: 'Garantia', tom: 'alerta' },
  pendencia: { rotulo: 'Pendência', tom: 'neutro' },
  ocorrencia: { rotulo: 'Ocorrência', tom: 'critico' },
};

export const CANAIS_NOTIFICACAO: Record<CanalNotificacao, string> = {
  email: 'E-mail institucional',
  sei: 'Registro no processo SEI',
  govbr: 'gov.br',
};

export const CANAIS_CURTOS: Record<CanalNotificacao, string> = {
  email: 'E-mail',
  sei: 'SEI',
  govbr: 'gov.br',
};

export const PAPEIS_DESTINATARIO: Record<PapelDestinatario, string> = {
  gestor: 'Gestor',
  fiscal: 'Fiscal',
  contratada: 'Contratada',
  responsavel: 'Responsável pela pendência',
};

export const SITUACOES_ENVIO: Record<SituacaoEnvio, RotuloTom> = {
  pendente: { rotulo: 'Na fila', tom: 'info' },
  enviando: { rotulo: 'Enviando', tom: 'info' },
  enviado: { rotulo: 'Enviado', tom: 'sucesso' },
  falhou: { rotulo: 'Falhou', tom: 'erro' },
  suprimido: { rotulo: 'Não enviado', tom: 'neutro' },
};

export const ORIGENS_NOTIFICACAO: Record<'automatica' | 'manual', string> = {
  automatica: 'Automática',
  manual: 'Manual',
};

export const FAIXAS_VENCIMENTO: Record<`${FaixaVencimento}`, string> = {
  '30': 'Até 30 dias',
  '60': '31 a 60 dias',
  '90': '61 a 90 dias',
  '120': '91 a 120 dias',
};

export const MODOS_CANAL: Record<ModoCanalNotificacao, RotuloTom> = {
  simulado: { rotulo: 'Simulado', tom: 'aviso' },
  smtp: { rotulo: 'Servidor do órgão', tom: 'sucesso' },
  desligado: { rotulo: 'Desligado', tom: 'neutro' },
};
