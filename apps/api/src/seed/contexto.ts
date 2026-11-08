import type { OpcoesCalendario } from '@agora/dominio';
import type { CodigoPerfil } from '@agora/contratos';
import type { Transacao } from '../banco/tipos.ts';
import type { EntradaEvento } from '../auditoria/trilha.ts';
import type { Prng } from './prng.ts';

export interface EventoSeed extends EntradaEvento {
  ocorridoEm: Date;
}

export interface UsuarioSeed {
  id: string;
  email: string;
  nome: string;
  perfis: CodigoPerfil[];
  uasgs: string[] | 'todas';
}

export interface FornecedorSeed {
  id: string;
  chave: string;
  documento: string;
  tipo: 'PJ' | 'PF';
  nome: string;
  porte: 'ME' | 'EPP' | 'DEMAIS' | null;
}

export interface ItemAtaSeed {
  id: string;
  numero: number;
  descricao: string;
  catmat: string | null;
  unidade: string;
  fornecedorId: string;
  valorUnitario: number;
  quantidadeRegistrada: number;
  restante: number;
}

export interface AtaSeed {
  id: string;
  numero: string;
  uasg: string;
  objetoIndice: number;
  objeto: string;
  natureza: string;
  assinatura: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  dataBase: string;
  gestorId: string;
  itens: ItemAtaSeed[];
}

export interface ItemContratoSeed {
  id: string;
  numero: number;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  itemAtaId: string | null;
}

export interface ContratoSeed {
  id: string;
  numero: string;
  uasg: string;
  fornecedorId: string;
  ataId: string | null;
  objeto: string;
  natureza: string;
  servico: boolean;
  origem: 'licitacao' | 'contratacao_direta';
  assinatura: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  valorInicial: number;
  valorGlobal: number;
  gestorId: string;
  fiscalId: string;
  divulgacao: string | null;
  garantiaValidaAte: string | null;
  dataBase: string;
  reajusteAplicado: boolean;
  acelerado: boolean;
  fonteRecurso: string;
  itens: ItemContratoSeed[];
}

export interface PagamentoSeed {
  id: string;
  contratoId: string;
  notaFiscal: string;
  competencia: string;
  valor: number;
  vencimento: string;
  pagoEm: string | null;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
}

/** Dados criados pelas etapas, disponíveis para as etapas seguintes (ex.: a futura carga da Jornada). */
export interface DadosSeed {
  cnpjOrgao: string;
  uasgs: string[];
  unidades: Map<string, string>;
  usuarios: Map<string, UsuarioSeed>;
  gestores: string[];
  fiscais: string[];
  fornecedores: FornecedorSeed[];
  atas: AtaSeed[];
  contratos: ContratoSeed[];
  pagamentos: PagamentoSeed[];
  contagens: Record<string, number>;
}

export interface ContextoSeed {
  tx: Transacao;
  prng: Prng;
  hoje: string;
  agora: Date;
  calendario: OpcoesCalendario;
  senhaHashDemonstracao: string;
  dados: DadosSeed;
  eventos: EventoSeed[];
}

/** Etapa da carga sintética. Novos módulos (ex.: Jornada/processos) acrescentam etapas em `ETAPAS_SEED`. */
export interface EtapaSeed {
  nome: string;
  executar(ctx: ContextoSeed): Promise<void>;
}

/** Instante (UTC) num dia de calendário, em horário de expediente, nunca depois de `agora`. */
export function instanteEm(data: string, prng: Prng, agora: Date): Date {
  const base = Date.parse(`${data}T12:00:00.000Z`) + prng.inteiro(0, 6 * 60) * 60_000;
  return new Date(Math.min(base, agora.getTime() - prng.inteiro(1, 120) * 60_000));
}

export function centavosEntre(prng: Prng, faixa: readonly [number, number]): number {
  return prng.inteiro(Math.round(faixa[0] * 100), Math.round(faixa[1] * 100));
}
