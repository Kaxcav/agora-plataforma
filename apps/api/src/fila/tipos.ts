import type { SituacaoTarefaFila, TipoTarefaFila } from '@agora/contratos';
import type { Transacao } from '../banco/tipos.ts';
import type { ContextoApp } from '../http/contexto.ts';

/** Linha de `fila_tarefas` (migração 012): o estado de cada tarefa, nos dois transportes. */
export interface LinhaTarefa {
  id: string;
  tipo: TipoTarefaFila;
  chave_idempotencia: string;
  descricao: string;
  carga: Record<string, unknown>;
  uasg: string | null;
  recurso_tipo: 'processo' | 'contrato' | 'sincronizacao' | null;
  recurso_id: string | null;
  situacao: SituacaoTarefaFila;
  tentativas: number;
  maximo_tentativas: number;
  disponivel_em: string;
  bloqueada_ate: string | null;
  despachada_em: string | null;
  ultimo_erro: string | null;
  resultado: Record<string, unknown> | null;
  solicitada_por: string | null;
  criada_em: string;
  atualizada_em: string;
  concluida_em: string | null;
}

export interface NovaTarefa {
  tipo: TipoTarefaFila;
  /** Chave de idempotência (`chaveIdempotencia` do domínio): a mesma operação nunca entra duas vezes. */
  chave: string;
  descricao: string;
  carga: Record<string, unknown>;
  uasg?: string | null;
  recurso?: { tipo: 'processo' | 'contrato' | 'sincronizacao'; id: string } | null;
  solicitadaPor?: string | null;
}

/** Falha na execução de uma tarefa: `retentavel` separa a nova tentativa da fila de erro (`decidirDestinoFalha`). */
export class FalhaTarefa extends Error {
  readonly retentavel: boolean;

  constructor(mensagem: string, retentavel: boolean, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'FalhaTarefa';
    this.retentavel = retentavel;
  }
}

/** Enfileira uma tarefa derivada na mesma transação que conclui a atual (ex.: os anexos depois da compra). */
export type EnfileirarDerivada = (nova: NovaTarefa) => Promise<LinhaTarefa>;

export interface ConclusaoTarefa {
  /** Resultado gravado em `fila_tarefas.resultado` (proveniência: protocolo, hash, registros). */
  resultado: Record<string, unknown>;
  /**
   * Efeitos no banco aplicados na mesma transação que marca a tarefa como concluída — a chamada externa já foi
   * feita; aqui se grava o que ela devolveu, com o evento de auditoria.
   */
  aplicar?: (tx: Transacao, enfileirar: EnfileirarDerivada) => Promise<void>;
}

export type Manipulador = (ctx: ContextoApp, tarefa: LinhaTarefa) => Promise<ConclusaoTarefa>;

export type Manipuladores = Record<TipoTarefaFila, Manipulador>;

/**
 * Transporte da fila. O estado fica sempre em `fila_tarefas`; o transporte só entrega os avisos ao trabalhador.
 * PostgreSQL: a varredura do trabalhador é a própria entrega. RabbitMQ: filas duráveis, espera por TTL e fila de erro.
 */
export interface DriverFila {
  readonly transporte: 'postgres' | 'rabbitmq';
  /** Avisa que a tarefa está pronta (`esperaMs` = 0) ou que deve voltar depois da espera de nova tentativa. */
  despachar(aviso: { id: string; esperaMs: number }): Promise<void>;
  /** Copia a tarefa para a fila de erro do transporte (no PostgreSQL a própria tabela já é a fila de erro). */
  registrarErro(aviso: { id: string; tipo: string; motivo: string }): Promise<void>;
  /** Começa a entregar avisos ao trabalhador. */
  consumir(processar: (id: string) => Promise<void>): Promise<void>;
  /** Transporte conectado (sonda de prontidão do trabalhador). */
  pronto(): boolean;
  fechar(): Promise<void>;
}
