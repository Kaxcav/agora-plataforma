/**
 * Transporte em RabbitMQ (AGORA_FILA_URL), com amqplib e canal de confirmação (publisher confirms):
 *   * `agora.tarefas`: fila principal, durável; mensagens persistentes com o id da tarefa;
 *   * `agora.tarefas.espera.<ms>ms`: uma fila por tempo de espera de nova tentativa, com TTL e dead-letter de volta
 *     para a principal — a espera exponencial é cumprida pelo próprio RabbitMQ, sem temporizador no trabalhador;
 *   * `agora.tarefas.erro`: fila de erro (dead letter), com uma cópia de cada tarefa que esgotou as tentativas.
 * O estado continua em `fila_tarefas`; a mensagem só carrega o id. Entrega repetida é inofensiva: o trabalhador só
 * executa tarefas que consegue reservar.
 */
import type { DriverFila } from './tipos.ts';

export const FILA_PRINCIPAL = 'agora.tarefas';
export const FILA_ERRO = 'agora.tarefas.erro';
export const filaEspera = (esperaMs: number): string => `agora.tarefas.espera.${esperaMs}ms`;

export interface MensagemAmqp {
  content: Buffer;
}

/** Subconjunto do canal de confirmação do amqplib usado aqui (permite um RabbitMQ simulado nos testes). */
export interface CanalAmqp {
  assertQueue(fila: string, opcoes?: { durable?: boolean; arguments?: Record<string, unknown> }): Promise<unknown>;
  sendToQueue(fila: string, conteudo: Buffer, opcoes?: { persistent?: boolean; contentType?: string; messageId?: string; type?: string }): boolean;
  waitForConfirms(): Promise<void>;
  prefetch(quantidade: number): Promise<unknown>;
  consume(fila: string, aoReceber: (mensagem: MensagemAmqp | null) => void, opcoes?: { noAck?: boolean }): Promise<unknown>;
  ack(mensagem: MensagemAmqp): void;
  nack(mensagem: MensagemAmqp, todasAte?: boolean, recolocar?: boolean): void;
  close(): Promise<void>;
}

export interface ConexaoAmqp {
  createConfirmChannel(): Promise<CanalAmqp>;
  close(): Promise<void>;
  on(evento: 'close' | 'error', ouvinte: (erro?: unknown) => void): unknown;
}

export interface OpcoesRabbitmq {
  url: string;
  /** Conexão injetável (testes); padrão: `amqplib.connect`. */
  conectar?: (url: string) => Promise<ConexaoAmqp>;
  /** Mensagens em processamento simultâneo por trabalhador. */
  prefetch?: number;
  aoFalhar?: (erro: unknown) => void;
}

async function conectarAmqplib(url: string): Promise<ConexaoAmqp> {
  const amqp = await import('amqplib');
  return amqp.connect(url);
}

export async function criarDriverRabbitmq(opcoes: OpcoesRabbitmq): Promise<DriverFila> {
  const conexao = await (opcoes.conectar ?? conectarAmqplib)(opcoes.url);
  let conectado = true;
  conexao.on('close', () => {
    conectado = false;
  });
  conexao.on('error', (erro) => {
    conectado = false;
    opcoes.aoFalhar?.(erro);
  });
  const canal = await conexao.createConfirmChannel();
  await canal.assertQueue(FILA_PRINCIPAL, { durable: true });
  await canal.assertQueue(FILA_ERRO, { durable: true });
  const esperasDeclaradas = new Set<number>();

  async function publicar(fila: string, corpo: Record<string, unknown>, id: string): Promise<void> {
    canal.sendToQueue(fila, Buffer.from(JSON.stringify(corpo)), { persistent: true, contentType: 'application/json', messageId: id });
    await canal.waitForConfirms();
  }

  async function declararEspera(esperaMs: number): Promise<string> {
    const nome = filaEspera(esperaMs);
    if (!esperasDeclaradas.has(esperaMs)) {
      await canal.assertQueue(nome, {
        durable: true,
        arguments: { 'x-message-ttl': esperaMs, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': FILA_PRINCIPAL },
      });
      esperasDeclaradas.add(esperaMs);
    }
    return nome;
  }

  return {
    transporte: 'rabbitmq',
    async despachar({ id, esperaMs }) {
      const fila = esperaMs > 0 ? await declararEspera(esperaMs) : FILA_PRINCIPAL;
      await publicar(fila, { id }, id);
    },
    async registrarErro({ id, tipo, motivo }) {
      await publicar(FILA_ERRO, { id, tipo, motivo }, id);
    },
    async consumir(processar) {
      await canal.prefetch(opcoes.prefetch ?? 4);
      await canal.consume(
        FILA_PRINCIPAL,
        (mensagem) => {
          if (!mensagem) return;
          let id: unknown = null;
          try {
            id = (JSON.parse(mensagem.content.toString('utf8')) as { id?: unknown }).id;
          } catch {
            id = null;
          }
          if (typeof id !== 'string') {
            // Mensagem fora do formato da Ágora: descartada, porque não corresponde a nenhuma tarefa registrada.
            canal.ack(mensagem);
            return;
          }
          processar(id).then(
            () => canal.ack(mensagem),
            (erro: unknown) => {
              opcoes.aoFalhar?.(erro);
              canal.nack(mensagem, false, true);
            },
          );
        },
        { noAck: false },
      );
    },
    pronto: () => conectado,
    async fechar() {
      if (!conectado) return;
      conectado = false;
      await canal.close().catch(() => undefined);
      await conexao.close().catch(() => undefined);
    },
  };
}
