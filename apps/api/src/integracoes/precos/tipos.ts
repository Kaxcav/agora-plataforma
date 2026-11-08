import type { AmostraPrecoExterna, Centavos, DataISO, TipoObjetoPesquisa } from '@agora/dominio';
import type { FontePesquisaPrecos, SituacaoFontePesquisa } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import type { Config } from '../../config.ts';
import type { FuncaoFetch } from '../../http/contexto.ts';
import type { OpcoesHttpPrecos } from './http.ts';

/** O que se procura: item de referência da cesta (item 1 do DFD). */
export interface PedidoPesquisaPrecos {
  termo: string;
  catmat: string | null;
  descricaoItem: string;
  unidade: string;
  tipoObjeto: TipoObjetoPesquisa;
  uf: string;
  /** Centro da simulação offline (estimativa preliminar do DFD); não é usado nas consultas online. */
  valorReferencia: Centavos | null;
}

/** Resultado de uma fonte, com a proveniência da consulta. */
export interface ColetaFonte {
  fonte: FontePesquisaPrecos;
  situacao: SituacaoFontePesquisa;
  modo: 'offline' | 'online' | 'local';
  amostras: AmostraPrecoExterna[];
  registros: number;
  mensagem: string;
  hashConteudo: string | null;
  endereco: string | null;
  consultadoEm: string;
}

export interface ContextoColeta {
  banco: Executor;
  fetch: FuncaoFetch;
  config: Config['precos'];
  hoje: DataISO;
  agora: Date;
  http: OpcoesHttpPrecos;
}

export const NOME_FONTE: Record<FontePesquisaPrecos, string> = {
  PAINEL_PRECOS: 'Painel de Preços (Compras.gov.br — dados abertos)',
  CONTRATACOES_SIMILARES: 'Contratações similares (PNCP — dados abertos de compras)',
  NOTAS_FISCAIS: 'Notas fiscais eletrônicas',
  SINAPI: 'Sinapi (tabela oficial importada)',
  SICRO: 'Sicro (tabela oficial importada)',
};

export function ehEngenharia(tipoObjeto: TipoObjetoPesquisa): boolean {
  return tipoObjeto === 'obras_servicos_engenharia_comuns' || tipoObjeto === 'obras_servicos_engenharia_especiais';
}
