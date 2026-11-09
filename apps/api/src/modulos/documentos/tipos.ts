/**
 * Tipos de armazenamento do módulo de documentos, sem dependências: a jornada os usa sem importar o repositório
 * (que depende do edital público e, por ele, da própria jornada).
 */

/** Parcela gravada em processos_qualificacao_tecnica.parcelas. */
export interface ParcelaArmazenada {
  id: string;
  descricao: string;
  unidade: string;
  quantidadeObjeto: number;
  valorEstimado: number;
  quantidadeMinima: number;
  termos: string[];
}
