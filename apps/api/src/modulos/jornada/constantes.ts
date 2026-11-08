import type { PapelProcesso } from '@agora/dominio';
import type { EtapaJornada } from '@agora/contratos';
import type { DfdProcesso, DisputaArmazenada, ParametrosEdital, ParecerArmazenado, PublicacaoProcesso, TipoDocumento } from './tipos.ts';

/** Mínimo de caracteres das justificativas e descrições textuais exigidas pelas regras da jornada. */
export const MINIMO_CARACTERES_TEXTO = 30;

/** Limite do patrimônio líquido mínimo exigível: 10% do valor estimado (art. 69, § 4º). */
export const LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL = 10;

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  'dfd',
  'etp',
  'matriz_riscos',
  'nota_tecnica_precos',
  'tr',
  'edital',
  'minuta_contrato',
  'parecer_checklist',
];

export const TITULOS_DOCUMENTO: Record<TipoDocumento, string> = {
  dfd: 'Documento de Formalização da Demanda (DFD)',
  etp: 'Estudo Técnico Preliminar (ETP)',
  matriz_riscos: 'Matriz de Riscos',
  nota_tecnica_precos: 'Nota Técnica de Pesquisa de Preços',
  tr: 'Termo de Referência',
  edital: 'Minuta do Edital',
  minuta_contrato: 'Minuta do Contrato',
  parecer_checklist: 'Lista de Verificação do Controle Prévio de Legalidade (art. 53)',
};

/** Última etapa em que cada documento pode ser (re)gerado. */
export const ETAPA_DOCUMENTO: Record<TipoDocumento, EtapaJornada> = {
  dfd: 2,
  etp: 3,
  matriz_riscos: 3,
  nota_tecnica_precos: 3,
  tr: 4,
  edital: 4,
  minuta_contrato: 4,
  parecer_checklist: 5,
};

/** Documentos que a IA nunca redige: o checklist do parecer orienta uma conclusão jurídica, que é decisão humana. */
export const DOCUMENTOS_SEM_IA: ReadonlySet<TipoDocumento> = new Set<TipoDocumento>(['parecer_checklist']);

export const TITULOS_ETAPA: Record<EtapaJornada, string> = {
  1: 'Demanda e PCA',
  2: 'Instrução no SEI e equipe',
  3: 'ETP, riscos e preços',
  4: 'TR, edital e minuta',
  5: 'Controle jurídico e publicação',
  6: 'Seleção do fornecedor',
  7: 'Contrato e gestão',
};

export const PAPEIS_PROCESSO: readonly PapelProcesso[] = [
  'requisitante',
  'equipe_planejamento',
  'agente_contratacao',
  'pregoeiro',
  'comissao_contratacao',
  'autoridade_competente',
  'gestor_contrato',
  'fiscal_tecnico',
  'fiscal_administrativo',
  'parecerista_juridico',
];

export const ROTULOS_PAPEL: Record<PapelProcesso, string> = {
  requisitante: 'Requisitante',
  equipe_planejamento: 'Equipe de planejamento',
  agente_contratacao: 'Agente de contratação',
  pregoeiro: 'Pregoeiro',
  comissao_contratacao: 'Comissão de contratação',
  autoridade_competente: 'Autoridade competente',
  gestor_contrato: 'Gestor do contrato',
  fiscal_tecnico: 'Fiscal técnico',
  fiscal_administrativo: 'Fiscal administrativo',
  parecerista_juridico: 'Parecerista jurídico',
};

export const ROTULOS_TIPO_OBJETO: Record<DfdProcesso['tipoObjeto'], string> = {
  bens: 'bens (compra)',
  servicos_comuns: 'serviços comuns',
  servicos_especiais: 'serviços especiais',
  obras_servicos_engenharia_comuns: 'obras e serviços comuns de engenharia',
  obras_servicos_engenharia_especiais: 'obras e serviços especiais de engenharia',
};

/** Itens do checklist do controle prévio de legalidade (art. 53, § 1º), na ordem de exame. */
export const ITENS_PARECER: readonly { id: string; texto: string }[] = [
  { id: 'dfd', texto: 'Documento de formalização da demanda (art. 12, VII, e art. 18, I)' },
  { id: 'etp', texto: 'Estudo técnico preliminar com os elementos do art. 18, § 1º e § 2º' },
  { id: 'matriz_riscos', texto: 'Matriz de riscos (art. 18, X, e art. 22)' },
  { id: 'pesquisa_precos', texto: 'Pesquisa de preços e estimativa do valor (art. 23 e IN SEGES/ME 65/2021)' },
  { id: 'tr', texto: 'Termo de referência com o conteúdo do art. 6º, XXIII' },
  { id: 'minuta_edital', texto: 'Minuta do edital (art. 25)' },
  { id: 'minuta_contrato', texto: 'Minuta do contrato com as cláusulas necessárias do art. 92' },
  { id: 'designacoes', texto: 'Designação do agente de contratação e da equipe de apoio (arts. 7º e 8º)' },
  { id: 'segregacao', texto: 'Segregação de funções (art. 7º, § 1º)' },
  { id: 'previsao_orcamentaria', texto: 'Previsão de recursos orçamentários (art. 18, caput, e art. 150)' },
  { id: 'pca', texto: 'Compatibilidade com o plano de contratações anual (art. 12, VII)' },
  { id: 'publicidade_prazos', texto: 'Publicidade e prazos mínimos de divulgação (arts. 54 e 55)' },
];

export const PUBLICACAO_INICIAL: PublicacaoProcesso = {
  pncp: 'nao_publicado',
  dou: 'nao_publicado',
  publicadoEm: null,
  dataMinimaPropostas: null,
  idPncp: null,
};

export const DISPUTA_INICIAL: DisputaArmazenada = { licitantes: [], resultado: null, registradaEm: null };

export function parecerInicial(): ParecerArmazenado {
  return {
    itens: ITENS_PARECER.map((i) => ({ id: i.id, atendido: null, observacao: null })),
    conclusao: null,
    pareceristaId: null,
    emitidoEm: null,
  };
}

export const EDITAL_PADRAO: ParametrosEdital = {
  criterioJulgamento: 'menor_preco',
  regimeExecucao: 'outro',
  exigeFaturamentoMinimo: false,
  patrimonioLiquidoMinimoPercentual: null,
  exigeRegistroCadastralComplementar: false,
};

/**
 * Condições de referência usadas na redação do TR e da minuta e na geração do contrato. São pontos de partida
 * que a equipe ajusta no texto (vigência, entrega e garantia de execução, arts. 96 a 98 e 105).
 */
export const CONDICOES_REFERENCIA = {
  vigenciaMeses: 12,
  prazoEntregaDias: 60,
  garantiaExecucaoPercentual: 5,
} as const;

export const DFD_INICIAL: DfdProcesso = {
  descricaoNecessidade: '',
  justificativa: '',
  itens: [],
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: false,
  tipoObjeto: 'bens',
};

/**
 * Modalidade prevista sugerida pelo tipo de objeto: pregão para bens e serviços comuns (art. 6º, XLI, e art. 29);
 * concorrência nos demais casos (art. 6º, XXXVIII). É sugestão inicial; a escolha é da equipe de planejamento.
 */
export function modalidadeSugerida(tipoObjeto: DfdProcesso['tipoObjeto']): string {
  return tipoObjeto === 'bens' || tipoObjeto === 'servicos_comuns' ? 'Pregão eletrônico' : 'Concorrência eletrônica';
}
