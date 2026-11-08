/**
 * Peças complementares da fase preparatória (frente P — RF-32): títulos, etapas e quem aprova. Este arquivo não importa
 * nada da jornada, porque `jornada/constantes.ts` o importa para acrescentar as peças às listas de documentos.
 */
import type { EtapaJornada, Permissao, TipoDocumentoComplementar } from '@agora/contratos';

export const TIPOS_DOCUMENTO_COMPLEMENTARES: readonly TipoDocumentoComplementar[] = [
  'portaria_designacao',
  'declaracao_orcamentaria',
  'despacho_autorizacao',
  'nota_tecnica_conjur',
  'modelo_proposta',
  'ordem_servico',
  'termo_sigilo',
  'termo_recebimento_provisorio',
  'termo_recebimento_definitivo',
  'caderno_prova_conceito',
  'checklist_documentos',
];

export const TITULOS_DOCUMENTO_COMPLEMENTARES: Record<TipoDocumentoComplementar, string> = {
  portaria_designacao: 'Portaria de Designação da Equipe e dos Agentes da Contratação',
  declaracao_orcamentaria: 'Declaração de Adequação Orçamentária',
  despacho_autorizacao: 'Despacho de Autorização da Contratação',
  nota_tecnica_conjur: 'Nota Técnica de Encaminhamento à Assessoria Jurídica',
  modelo_proposta: 'Modelo de Proposta Comercial',
  ordem_servico: 'Modelo de Ordem de Serviço ou de Fornecimento',
  termo_sigilo: 'Modelo de Termo de Compromisso e de Sigilo',
  termo_recebimento_provisorio: 'Modelo de Termo de Recebimento Provisório',
  termo_recebimento_definitivo: 'Modelo de Termo de Recebimento Definitivo',
  caderno_prova_conceito: 'Caderno de Casos de Teste da Prova de Conceito e Planilha de Julgamento',
  checklist_documentos: 'Checklist de Documentos do Processo',
};

/** Última etapa em que cada peça pode ser (re)gerada (a portaria acompanha as designações até o contrato). */
export const ETAPA_DOCUMENTO_COMPLEMENTARES: Record<TipoDocumentoComplementar, EtapaJornada> = {
  portaria_designacao: 7,
  declaracao_orcamentaria: 4,
  despacho_autorizacao: 5,
  nota_tecnica_conjur: 5,
  modelo_proposta: 4,
  ordem_servico: 4,
  termo_sigilo: 4,
  termo_recebimento_provisorio: 4,
  termo_recebimento_definitivo: 4,
  caderno_prova_conceito: 6,
  checklist_documentos: 7,
};

/** Atos da autoridade competente: só ela, designada no processo, aprova e assina (arts. 7º, 8º, 53, § 3º, e 150). */
export const DOCUMENTOS_DA_AUTORIDADE: ReadonlySet<string> = new Set<TipoDocumentoComplementar>(['portaria_designacao', 'declaracao_orcamentaria', 'despacho_autorizacao']);

/**
 * Peças que a IA nunca redige: atos da autoridade (portaria, declaração e despacho), a planilha de julgamento da
 * comissão e o checklist, que só reúne dados do processo.
 */
export const DOCUMENTOS_COMPLEMENTARES_SEM_IA: readonly TipoDocumentoComplementar[] = [
  'portaria_designacao',
  'declaracao_orcamentaria',
  'despacho_autorizacao',
  'caderno_prova_conceito',
  'checklist_documentos',
];

/** Permissão para aprovar e assinar a peça, quando não é a da edição (`jornada:editar`). */
export function permissaoAprovacaoDocumento(tipo: string | null): Permissao | null {
  return tipo !== null && DOCUMENTOS_DA_AUTORIDADE.has(tipo) ? 'jornada:autorizar' : null;
}
