import type { CodigoPerfil, Permissao } from '@agora/contratos';
import type { Banco } from '../banco/tipos.ts';
import type { Config } from '../config.ts';

/** Função `fetch` injetável (integrações e gov.br usam a do Node; testes usam uma simulada). */
export type FuncaoFetch = (entrada: string | URL, init?: RequestInit) => Promise<Response>;

/** Dependências compartilhadas por rotas e serviços. */
export interface ContextoApp {
  config: Config;
  banco: Banco;
  /** Segredo efetivo de sessão (configurado ou gerado em demonstração). */
  segredo: string;
  versao: string;
  /** Relógio injetável: toda regra que depende de "hoje" usa este relógio. */
  relogio: () => Date;
  /** Data de hoje (America/Sao_Paulo) no formato 'YYYY-MM-DD'. */
  hoje: () => string;
  fetch: FuncaoFetch;
}

/** Sessão autenticada carregada a cada requisição da API. */
export interface SessaoAtiva {
  id: string;
  csrfToken: string;
  expiraEm: string;
  usuario: { id: string; nome: string; email: string };
  perfis: CodigoPerfil[];
  permissoes: Set<Permissao>;
  todasUasgs: boolean;
  /** UASGs explicitamente autorizadas (vazio quando `todasUasgs`). */
  uasgs: string[];
  /** Senha temporária em uso: só a troca de senha e a própria sessão ficam disponíveis. */
  deveTrocarSenha: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    agora: ContextoApp;
  }
  interface FastifyRequest {
    sessao: SessaoAtiva | null;
    ipHash: string;
  }
}
