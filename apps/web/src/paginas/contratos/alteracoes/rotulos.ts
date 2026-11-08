import type {
  AlteracaoContratual,
  EfeitoExtincaoContrato,
  EnquadramentoReequilibrio,
  MotivoExtincaoContrato,
  NaturezaDuracaoContrato,
  PainelAlteracoesContrato,
} from '@agora/contratos';
import type { TomEtiqueta } from '../../../componentes';

/** Rótulos em pt-BR das alterações do contrato (RN-32, RN-33 e RF-27). */

export const TIPOS_ALTERACAO: Record<AlteracaoContratual['tipo'], string> = {
  acrescimo: 'Acréscimo',
  supressao: 'Supressão',
  qualitativa: 'Alteração qualitativa',
  prazo: 'Prorrogação',
  reequilibrio: 'Reequilíbrio',
  reajuste: 'Reajuste',
  repactuacao: 'Repactuação',
  extincao: 'Extinção',
};

export const ESPECIES_ALTERACAO: Record<AlteracaoContratual['especie'], string> = {
  aditivo: 'Termo aditivo',
  apostila: 'Apostila',
  rescisao: 'Termo de rescisão',
};

export const SITUACOES_ALTERACAO: Record<AlteracaoContratual['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  aguardando_parecer: { rotulo: 'Aguardando parecer jurídico', tom: 'info' },
  pronto_para_assinatura: { rotulo: 'Pronto para assinatura', tom: 'alerta' },
  devolvido: { rotulo: 'Parecer desfavorável', tom: 'aviso' },
  em_contraditorio: { rotulo: 'Prazo de defesa', tom: 'alerta' },
  aguardando_decisao: { rotulo: 'Aguardando decisão', tom: 'alerta' },
  assinado: { rotulo: 'Assinado', tom: 'sucesso' },
  indeferido: { rotulo: 'Indeferido', tom: 'neutro' },
  arquivado: { rotulo: 'Arquivado', tom: 'neutro' },
};

export const DIVULGACAO_ALTERACAO: Record<AlteracaoContratual['divulgacao']['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  nao_solicitada: { rotulo: 'Não se aplica', tom: 'neutro' },
  importado: { rotulo: 'Registro importado', tom: 'neutro' },
  na_fila: { rotulo: 'Na fila', tom: 'info' },
  nova_tentativa: { rotulo: 'Aguardando nova tentativa', tom: 'aviso' },
  enviando: { rotulo: 'Enviando', tom: 'info' },
  publicado: { rotulo: 'Divulgado no PNCP', tom: 'sucesso' },
  erro: { rotulo: 'Na fila de erro', tom: 'erro' },
};

export const NATUREZAS: Record<NaturezaDuracaoContrato, string> = {
  continuo: 'Serviço ou fornecimento contínuo (até 10 anos)',
  ti_estruturante: 'Sistema estruturante de TI (até 15 anos)',
  escopo: 'Escopo predefinido (prorrogação automática)',
  receita_sem_investimento: 'Contrato que gera receita, sem investimento (até 10 anos)',
  receita_com_investimento: 'Contrato que gera receita, com investimento (até 35 anos)',
};

export const PRORROGACAO: Record<PainelAlteracoesContrato['prorrogacao']['tipo'], { rotulo: string; tom: TomEtiqueta }> = {
  planejar_prorrogacao: { rotulo: 'Prorrogação possível', tom: 'sucesso' },
  limite_prorrogacao: { rotulo: 'Perto da vigência máxima', tom: 'aviso' },
  nova_licitacao: { rotulo: 'Sem nova prorrogação', tom: 'erro' },
  prorrogacao_automatica: { rotulo: 'Escopo: prorrogação automática', tom: 'info' },
  natureza_nao_informada: { rotulo: 'Natureza não informada', tom: 'aviso' },
};

export const ENQUADRAMENTOS: Record<EnquadramentoReequilibrio, string> = {
  forca_maior: 'Força maior',
  caso_fortuito: 'Caso fortuito',
  fato_principe: 'Fato do príncipe',
  fato_imprevisivel: 'Fato imprevisível',
  previsivel_consequencias_incalculaveis: 'Fato previsível de consequências incalculáveis',
  tributo_superveniente: 'Tributo ou encargo legal novo ou alterado (art. 134)',
  alteracao_unilateral: 'Alteração unilateral da Administração (art. 124, I)',
};

export const MOTIVOS_EXTINCAO: Record<MotivoExtincaoContrato, string> = {
  art137_I: 'I — Descumprimento de cláusulas, especificações, projetos ou prazos',
  art137_II: 'II — Desatendimento das determinações da fiscalização',
  art137_III: 'III — Alteração social ou da estrutura da empresa que prejudique a execução',
  art137_IV: 'IV — Falência, insolvência, dissolução da sociedade ou falecimento',
  art137_V: 'V — Caso fortuito ou força maior que impeça a execução',
  art137_VI: 'VI — Licença ambiental atrasada ou impossível, ou mudança do anteprojeto',
  art137_VII: 'VII — Atraso na liberação de áreas (desapropriação, desocupação ou servidão)',
  art137_VIII: 'VIII — Razões de interesse público justificadas pela autoridade máxima',
  art137_IX: 'IX — Descumprimento da reserva de cargos (PcD, reabilitado ou aprendiz)',
  art137_p2_I: '§ 2º, I — Supressão além do limite do art. 125 (direito do contratado)',
  art137_p2_II: '§ 2º, II — Suspensão por mais de 3 meses (direito do contratado)',
  art137_p2_III: '§ 2º, III — Suspensões que somam 90 dias úteis (direito do contratado)',
  art137_p2_IV: '§ 2º, IV — Atraso de pagamento acima de 2 meses (direito do contratado)',
  art137_p2_V: '§ 2º, V — Área, local ou objeto não liberados (direito do contratado)',
};

export const EFEITOS_EXTINCAO: Record<EfeitoExtincaoContrato, string> = {
  assuncao_objeto: 'Assunção imediata do objeto (art. 139, I)',
  ocupacao_local: 'Ocupação do local e das instalações (art. 139, II — exige autorização do ministro)',
  execucao_garantia: 'Execução da garantia contratual (art. 139, III)',
  retencao_creditos: 'Retenção dos créditos até o limite dos prejuízos e multas (art. 139, IV)',
  devolucao_garantia: 'Devolução da garantia (art. 138, § 2º, I)',
  pagamentos_devidos: 'Pagamentos devidos até a extinção (art. 138, § 2º, II)',
  custo_desmobilizacao: 'Custo da desmobilização (art. 138, § 2º, III)',
  ressarcimento_prejuizos: 'Ressarcimento de prejuízos comprovados (art. 138, § 2º)',
};

/** Nome do ato no histórico: o número do termo ou, antes da assinatura, a proposta (ou o processo de extinção). */
export function tituloAlteracao(a: Pick<AlteracaoContratual, 'numero' | 'tipo'>): string {
  if (a.numero) return a.numero;
  return a.tipo === 'extincao' ? 'Processo de extinção' : `Proposta de ${TIPOS_ALTERACAO[a.tipo].toLowerCase()}`;
}

/** Data de hoje no fuso do órgão (a regra é conferida no servidor; aqui só para limites de campos de data). */
export function hojeLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
