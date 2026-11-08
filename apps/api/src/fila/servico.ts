/**
 * Serviço de fila usado pela API (RNF-07): a API só publica tarefas — grava na transação da ação de negócio e avisa
 * o transporte depois da confirmação. O trabalhador executa (no processo próprio ou embutido, AGORA_TRABALHADOR).
 * Transporte: RabbitMQ quando AGORA_FILA_URL existe; senão a fila durável em PostgreSQL.
 */
import type { Transacao } from '../banco/tipos.ts';
import type { ContextoApp } from '../http/contexto.ts';
import { criarDriverPostgres } from './postgres.ts';
import { criarDriverRabbitmq } from './rabbitmq.ts';
import { enfileirar, marcarDespachada, obterTarefa } from './registro.ts';
import type { DriverFila, LinhaTarefa, Manipuladores, NovaTarefa } from './tipos.ts';
import { criarTrabalhador, type RegistrarLog, type Trabalhador } from './trabalhador.ts';

export interface ServicoFila {
  readonly driver: DriverFila;
  /** Trabalhador deste processo (API com AGORA_TRABALHADOR=embutido, ou o serviço trabalhador). */
  readonly trabalhador: Trabalhador | null;
  /** Grava a tarefa na transação da ação de negócio (caixa de saída transacional), com idempotência. */
  enfileirar(tx: Transacao, nova: NovaTarefa): Promise<{ tarefa: LinhaTarefa; criada: boolean }>;
  /** Depois da confirmação da transação: avisa o transporte. Falha no aviso não perde a tarefa (a varredura reenvia). */
  despachar(tarefas: readonly LinhaTarefa[]): Promise<void>;
  /**
   * Com trabalhador neste processo, espera a primeira execução terminar (até `limiteMs`) para responder com o
   * resultado; sem ele, devolve o estado atual (a tarefa segue na fila).
   */
  aguardar(id: string, limiteMs?: number): Promise<LinhaTarefa | null>;
  fechar(): Promise<void>;
}

export interface OpcoesServicoFila {
  manipuladores: Manipuladores;
  /** Executa as tarefas neste processo. */
  executarTarefas: boolean;
  intervaloMs?: number;
  /** RabbitMQ desconectado depois da inicialização (o serviço trabalhador encerra para ser reiniciado). */
  aoDesconectar?: () => void;
  registrar?: RegistrarLog;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Fila de integrações (decorada em app.ts). */
    fila: ServicoFila;
  }
}

const PAUSA_ESPERA_MS = 20;

function terminouPrimeiraExecucao(tarefa: LinhaTarefa, tentativasIniciais: number): boolean {
  if (tarefa.situacao === 'concluida' || tarefa.situacao === 'erro') return true;
  return tarefa.situacao === 'pendente' && tarefa.tentativas > tentativasIniciais;
}

export async function criarServicoFila(ctx: ContextoApp, opcoes: OpcoesServicoFila): Promise<ServicoFila> {
  const registrar: RegistrarLog = opcoes.registrar ?? (() => undefined);
  const aoFalhar = (erro: unknown) => registrar('error', 'falha no transporte da fila', { erro: String(erro) });
  const driver: DriverFila = ctx.config.fila.url
    ? await criarDriverRabbitmq({ url: ctx.config.fila.url, aoFalhar })
    : criarDriverPostgres(aoFalhar);

  const trabalhador = opcoes.executarTarefas
    ? criarTrabalhador({
        ctx,
        driver,
        manipuladores: opcoes.manipuladores,
        ...(opcoes.intervaloMs === undefined ? {} : { intervaloMs: opcoes.intervaloMs }),
        registrar,
      })
    : null;
  if (trabalhador) await trabalhador.iniciar();

  let monitorConexao: ReturnType<typeof setInterval> | null = null;
  if (opcoes.aoDesconectar && driver.transporte === 'rabbitmq') {
    const aviso = opcoes.aoDesconectar;
    monitorConexao = setInterval(() => {
      if (!driver.pronto()) aviso();
    }, 1000);
    monitorConexao.unref();
  }

  return {
    driver,
    trabalhador,
    enfileirar: (tx, nova) => enfileirar(tx, nova, ctx.config.fila.politica.maximoTentativas, ctx.relogio()),
    async despachar(tarefas) {
      const avisadas: string[] = [];
      for (const tarefa of tarefas) {
        try {
          await driver.despachar({ id: tarefa.id, esperaMs: 0 });
          avisadas.push(tarefa.id);
        } catch (erro) {
          registrar('warn', 'aviso de tarefa não entregue ao transporte; a varredura do trabalhador reenvia', { tarefa: tarefa.id, erro: String(erro) });
        }
      }
      if (driver.transporte === 'rabbitmq') await marcarDespachada(ctx.banco, avisadas, ctx.relogio());
    },
    async aguardar(id, limiteMs = 20_000) {
      const inicial = await obterTarefa(ctx.banco, id);
      if (!inicial || !trabalhador || inicial.situacao === 'concluida' || inicial.situacao === 'erro') return inicial;
      const tentativasIniciais = inicial.situacao === 'executando' ? inicial.tentativas - 1 : inicial.tentativas;
      const prazo = Date.now() + limiteMs;
      let atual: LinhaTarefa | null = inicial;
      while (atual && !terminouPrimeiraExecucao(atual, tentativasIniciais) && Date.now() < prazo) {
        await new Promise((resolver) => setTimeout(resolver, PAUSA_ESPERA_MS));
        atual = await obterTarefa(ctx.banco, id);
      }
      return atual;
    },
    async fechar() {
      if (monitorConexao) clearInterval(monitorConexao);
      await trabalhador?.parar();
      await driver.fechar();
    },
  };
}
