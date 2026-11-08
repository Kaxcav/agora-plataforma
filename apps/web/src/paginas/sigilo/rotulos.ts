import type { BaseAcessoSigilo, ClassificacaoSigilo, GrauSigilo, NivelAutoridadeClassificadora } from '@agora/contratos';
import { formatarData, HIPOTESES_SIGILO_LAI, PRAZO_MAXIMO_SIGILO_ANOS } from '@agora/dominio';
import type { TomEtiqueta } from '../../componentes';

export const GRAUS: readonly { valor: GrauSigilo; rotulo: string; ajuda: string }[] = [
  { valor: 'reservada', rotulo: 'Reservada', ajuda: `Até ${PRAZO_MAXIMO_SIGILO_ANOS.reservada} anos da produção` },
  { valor: 'secreta', rotulo: 'Secreta', ajuda: `Até ${PRAZO_MAXIMO_SIGILO_ANOS.secreta} anos da produção` },
  { valor: 'ultrassecreta', rotulo: 'Ultrassecreta', ajuda: `Até ${PRAZO_MAXIMO_SIGILO_ANOS.ultrassecreta} anos da produção` },
];

export const ROTULO_GRAU: Record<GrauSigilo, string> = { reservada: 'Reservada', secreta: 'Secreta', ultrassecreta: 'Ultrassecreta' };

export const HIPOTESES = (Object.entries(HIPOTESES_SIGILO_LAI) as [keyof typeof HIPOTESES_SIGILO_LAI, string][]).map(([inciso, texto]) => ({
  valor: inciso,
  rotulo: `Inciso ${inciso} — ${texto.charAt(0).toUpperCase()}${texto.slice(1)}`,
}));

export const NIVEIS: readonly { valor: NivelAutoridadeClassificadora; rotulo: string }[] = [
  { valor: 'ministro_estado', rotulo: 'Ministro de Estado ou autoridade equivalente (art. 27, I)' },
  { valor: 'titular_entidade', rotulo: 'Titular de autarquia, fundação ou empresa pública (art. 27, II)' },
  { valor: 'direcao_das_101_5', rotulo: 'Direção, comando ou chefia de nível DAS 101.5 ou equivalente (art. 27, III)' },
  { valor: 'delegacao', rotulo: 'Agente com competência delegada (art. 27, § 1º)' },
];

export const BASES_ACESSO: Record<BaseAcessoSigilo, { rotulo: string; tom: TomEtiqueta }> = {
  sem_sigilo: { rotulo: 'Sem classificação vigente', tom: 'neutro' },
  controle: { rotulo: 'Órgão de controle', tom: 'info' },
  credencial: { rotulo: 'Credencial no processo', tom: 'sucesso' },
  orcamento_divulgado: { rotulo: 'Orçamento já divulgado', tom: 'neutro' },
  negado_sem_credencial: { rotulo: 'Negado: sem credencial', tom: 'erro' },
  negado_credencial_vencida: { rotulo: 'Negado: credencial vencida', tom: 'erro' },
  negado_grau_insuficiente: { rotulo: 'Negado: grau insuficiente', tom: 'erro' },
};

export const OPERACOES = { consulta: 'Consulta', pdf: 'PDF marcado', download: 'Download do cofre' } as const;

export const SITUACOES: Record<ClassificacaoSigilo['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  vigente: { rotulo: 'Vigente', tom: 'alerta' },
  expirada: { rotulo: 'Prazo encerrado: pública', tom: 'neutro' },
  desclassificada: { rotulo: 'Encerrada', tom: 'neutro' },
};

/** "Reservada até 02/11/2028" ou "Orçamento sigiloso (art. 24)". */
export function rotuloClassificacao(c: ClassificacaoSigilo): string {
  if (c.tipo === 'orcamento') return 'Orçamento sigiloso (art. 24)';
  return `${c.grau ? ROTULO_GRAU[c.grau] : 'Classificada'}${c.prazoFim ? ` até ${formatarData(c.prazoFim)}` : ' até o evento'}`;
}

export function termoFinal(c: ClassificacaoSigilo): string {
  if (c.prazoFim) return formatarData(c.prazoFim);
  return `${c.eventoFim ?? 'Evento'}${c.prazoLimite ? ` (no máximo até ${formatarData(c.prazoLimite)})` : ''}`;
}
