import type { FonteDados } from '@agora/contratos';
import type { Banco } from '../banco/tipos.ts';
import type { Config } from '../config.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

export type FonteExecutavel = Exclude<FonteDados, 'AGORA'>;

export interface ContextoConector {
  banco: Banco;
  config: Config;
  hoje: string;
  agora: Date;
  fetch: FuncaoFetch;
}

export interface ResultadoConector {
  registros: number;
  /** SHA-256 do conteúdo recebido (proveniência). */
  hash: string;
  mensagem: string;
}

/** Conector de integração executado no servidor (ARQUITETURA §6). O navegador nunca chama APIs externas. */
export interface Conector {
  fonte: FonteExecutavel;
  conjunto: string;
  modo: 'offline' | 'online';
  executar(ctx: ContextoConector): Promise<ResultadoConector>;
}

export class ErroIntegracao extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroIntegracao';
  }
}

/** Conjuntos de dados sincronizáveis: um por fonte. */
export const CONJUNTOS: readonly { fonte: FonteExecutavel; conjunto: string; descricao: string }[] = [
  { fonte: 'PNCP', conjunto: 'Contratos', descricao: 'Contratos divulgados no Portal Nacional de Contratações Públicas' },
  { fonte: 'COMPRAS_GOV', conjunto: 'Atas e pregões homologados', descricao: 'Atas de registro de preços e compras homologadas a montar' },
  { fonte: 'CONTRATOS_GOV', conjunto: 'Execução contratual', descricao: 'Itens, aditivos e garantias dos contratos' },
  { fonte: 'SIAFI', conjunto: 'Empenhos', descricao: 'Notas de empenho, liquidações e pagamentos' },
];

export const FONTES_EXECUTAVEIS: readonly FonteExecutavel[] = CONJUNTOS.map((c) => c.fonte);
