import type { aplicarDesempate, analisarCestaPrecos, FonteCotacao, PapelProcesso } from '@agora/dominio';
import type { DocumentoGerado, EtapaJornada, OrgaoRequisitante, ParametrosEdital, ProcessoDetalhe } from '@agora/contratos';

export type { ParametrosEdital };

/** Dados da etapa 1 (Documento de Formalização da Demanda), como no contrato HTTP. */
export type DfdProcesso = ProcessoDetalhe['dfd'];
export type ItemDfd = DfdProcesso['itens'][number];
export type EtpProcesso = ProcessoDetalhe['etp'];
export type RiscoProcesso = ProcessoDetalhe['riscos'][number];
export type PublicacaoProcesso = ProcessoDetalhe['publicacao'];
export type ConclusaoParecer = NonNullable<ProcessoDetalhe['parecer']['conclusao']>;
export type TipoDocumento = DocumentoGerado['tipo'];

export interface CotacaoArmazenada {
  id: string;
  fonte: FonteCotacao;
  descricaoFonte: string;
  valorUnitario: number;
  dataCotacao: string;
  justificativaEscolhaFornecedor?: string;
  expurgada: boolean;
  motivoExpurgo: string | null;
}

/** Cesta de preços gravada (a análise é recalculada por @agora/dominio a cada leitura, com a data de hoje). */
export interface CestaArmazenada {
  cotacoes: CotacaoArmazenada[];
  orcamentoSigiloso: boolean;
  motivoSigilo: string | null;
}

export type AnaliseCesta = ReturnType<typeof analisarCestaPrecos>;

export interface ItemParecerArmazenado {
  id: string;
  atendido: boolean | null;
  observacao: string | null;
}

export interface ParecerArmazenado {
  itens: ItemParecerArmazenado[];
  conclusao: ConclusaoParecer | null;
  pareceristaId: string | null;
  emitidoEm: string | null;
}

/** Licitante da disputa: `fornecedorId` aponta para o cadastro; nome e porte são registrados no momento da disputa. */
export interface LicitanteArmazenado {
  fornecedorId: string;
  nome: string;
  meEpp: boolean;
  valorProposta: number;
  lanceDisputaFinal?: number;
  notaDesempenhoPrevio?: number;
  acoesEquidadeGenero?: boolean;
  programaIntegridade?: boolean;
  empresaBrasileira?: boolean;
  investePesquisaDesenvolvimentoNoPais?: boolean;
  praticaMitigacaoClimatica?: boolean;
}

export type ResultadoDesempate = ReturnType<typeof aplicarDesempate>;

export interface DisputaArmazenada {
  licitantes: LicitanteArmazenado[];
  resultado: ResultadoDesempate | null;
  registradaEm: string | null;
}

export interface LinhaProcesso {
  id: string;
  numero_sei: string;
  titulo: string;
  orgao: OrgaoRequisitante;
  uasg: string;
  uasg_nome: string;
  uasg_orgao: string;
  uasg_uf: string;
  etapa_atual: EtapaJornada;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  modalidade_prevista: string | null;
  dfd: DfdProcesso;
  etp: EtpProcesso;
  riscos: RiscoProcesso[];
  cesta: CestaArmazenada;
  edital: ParametrosEdital;
  parecer: ParecerArmazenado;
  publicacao: PublicacaoProcesso;
  disputa: DisputaArmazenada;
  contrato_id: string | null;
  contrato_numero: string | null;
  contrato_assinatura_em: string | null;
  contrato_divulgacao_em: string | null;
  parecerista_nome: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface MembroEquipe {
  papel: PapelProcesso;
  usuarioId: string;
  nome: string;
  cpf: string;
}

export interface EntradaArvore {
  numero: string;
  titulo: string;
  documentoId: string | null;
  incluidoEm: string;
  assinadoEm: string | null;
  assinadoPor: string | null;
}

/** Documento gerado (versão mais recente de cada tipo), com o registro de falha da IA quando houve retorno ao modelo. */
export interface DocumentoCarregado extends DocumentoGerado {
  falhaIa: string | null;
  modeloIa: string | null;
}

/** Tudo o que se lê de um processo para montar o detalhe e avaliar as regras. */
export interface CargaProcesso {
  linha: LinhaProcesso;
  equipe: MembroEquipe[];
  arvore: EntradaArvore[];
  documentos: DocumentoCarregado[];
}
