/**
 * Núcleo do serviço trabalhador (RNF-07): reserva a tarefa, executa o manipulador do tipo (conector ou publicação
 * no PNCP), conclui na mesma transação dos efeitos no banco e, em caso de falha, decide entre nova tentativa com
 * espera exponencial e fila de erro (`decidirDestinoFalha`). Cada falha fica na trilha de auditoria.
 * Roda no processo próprio (`src/trabalhador.ts`) ou embutido na API (AGORA_TRABALHADOR=embutido).
 */
import { decidirDestinoFalha, ErroDominio } from '@agora/dominio';
import { registrarEvento } from '../auditoria/trilha.ts';
import type { ContextoApp } from '../http/contexto.ts';
import {
  agendarNovaTentativa,
  avisosPerdidos,
  concluir,
  disponiveis,
  enfileirar,
  enviarParaErro,
  marcarDespachada,
  reservar,
  resumirErro,
} from './registro.ts';
import { FalhaTarefa, type DriverFila, type LinhaTarefa, type Manipuladores } from './tipos.ts';

export type DesfechoProcessamento = 'concluida' | 'nova_tentativa' | 'erro' | 'ignorada';

export type RegistrarLog = (nivel: 'info' | 'warn' | 'error', mensagem: string, dados?: Record<string, unknown>) => void;

export interface OpcoesTrabalhador {
  ctx: ContextoApp;
  driver: DriverFila;
  manipuladores: Manipuladores;
  /** Intervalo da varredura: no PostgreSQL é a entrega; no RabbitMQ reenvia avisos perdidos. 0 desliga o temporizador. */
  intervaloMs?: number;
  /** Validade da reserva de uma tarefa em execução (vencida, outra réplica pode retomá-la). */
  reservaMs?: number;
  /** RabbitMQ: atraso a partir do qual uma tarefa disponível e não executada tem o aviso reenviado. */
  margemAvisoMs?: number;
  registrar?: RegistrarLog;
}

export interface Trabalhador {
  iniciar(): Promise<void>;
  processar(id: string): Promise<DesfechoProcessamento>;
  varrer(): Promise<number>;
  /** Para de aceitar tarefas e espera as que estão em execução terminarem. */
  parar(): Promise<void>;
}

const LOTE_VARREDURA = 20;

export function criarTrabalhador(o: OpcoesTrabalhador): Trabalhador {
  const { ctx, driver } = o;
  const reservaMs = o.reservaMs ?? 5 * 60 * 1000;
  const margemAvisoMs = o.margemAvisoMs ?? 60 * 1000;
  const intervaloMs = o.intervaloMs ?? 2000;
  const registrar: RegistrarLog = o.registrar ?? (() => undefined);
  const emAndamento = new Set<Promise<unknown>>();
  let temporizador: ReturnType<typeof setInterval> | null = null;
  let varredura: Promise<number> | null = null;
  let parado = false;

  function acompanhar<T>(promessa: Promise<T>): Promise<T> {
    emAndamento.add(promessa);
    promessa.then(
      () => emAndamento.delete(promessa),
      () => emAndamento.delete(promessa),
    );
    return promessa;
  }

  async function despacharDerivadas(tarefas: readonly LinhaTarefa[]): Promise<void> {
    for (const tarefa of tarefas) {
      try {
        await driver.despachar({ id: tarefa.id, esperaMs: 0 });
        await marcarDespachada(ctx.banco, [tarefa.id], ctx.relogio());
      } catch (erro) {
        // A tarefa está gravada; a varredura reenvia o aviso.
        registrar('warn', 'aviso de tarefa derivada não entregue ao transporte', { tarefa: tarefa.id, erro: String(erro) });
      }
    }
  }

  async function registrarFalha(tarefa: LinhaTarefa, erro: unknown): Promise<DesfechoProcessamento> {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    // Regra de domínio violada (dados inválidos) não muda com nova tentativa; erro desconhecido (banco, rede) pode mudar.
    const retentavel = erro instanceof FalhaTarefa ? erro.retentavel : !(erro instanceof ErroDominio);
    const destino = decidirDestinoFalha({
      tentativasRealizadas: tarefa.tentativas,
      retentavel,
      politica: { ...ctx.config.fila.politica, maximoTentativas: tarefa.maximo_tentativas },
    });
    const fim = ctx.relogio();
    await ctx.banco.transacao(async (tx) => {
      if (destino.destino === 'nova_tentativa') {
        await agendarNovaTentativa(tx, tarefa.id, mensagem, new Date(fim.getTime() + destino.esperaMs), fim);
      } else {
        await enviarParaErro(tx, tarefa.id, mensagem, fim);
      }
      await registrarEvento(
        tx,
        {
          usuarioId: null,
          acao: destino.destino === 'nova_tentativa' ? 'fila.nova_tentativa' : 'fila.erro',
          recurso: 'fila_tarefa',
          recursoId: tarefa.id,
          resumo:
            destino.destino === 'nova_tentativa'
              ? `Falha transitória em "${tarefa.descricao}" (tentativa ${tarefa.tentativas} de ${tarefa.maximo_tentativas}); nova tentativa agendada`
              : `"${tarefa.descricao}" foi para a fila de erro (${destino.motivo === 'falha_definitiva' ? 'falha definitiva' : 'tentativas esgotadas'})`,
          dados: {
            tipo: tarefa.tipo,
            chaveIdempotencia: tarefa.chave_idempotencia,
            tentativas: tarefa.tentativas,
            maximoTentativas: tarefa.maximo_tentativas,
            erro: resumirErro(mensagem),
            destino: destino.destino,
            ...(destino.destino === 'nova_tentativa' ? { esperaMs: destino.esperaMs } : { motivo: destino.motivo }),
            transporte: driver.transporte,
          },
          ipHash: null,
        },
        fim,
      );
    });
    try {
      if (destino.destino === 'nova_tentativa') await driver.despachar({ id: tarefa.id, esperaMs: destino.esperaMs });
      else await driver.registrarErro({ id: tarefa.id, tipo: tarefa.tipo, motivo: destino.motivo });
    } catch (falhaTransporte) {
      registrar('warn', 'aviso de nova tentativa ou de erro não entregue ao transporte', { tarefa: tarefa.id, erro: String(falhaTransporte) });
    }
    registrar(destino.destino === 'nova_tentativa' ? 'warn' : 'error', destino.explicacao, { tarefa: tarefa.id, tipo: tarefa.tipo, erro: resumirErro(mensagem) });
    return destino.destino === 'nova_tentativa' ? 'nova_tentativa' : 'erro';
  }

  async function processarInterno(id: string): Promise<DesfechoProcessamento> {
    const tarefa = await reservar(ctx.banco, id, ctx.relogio(), reservaMs);
    if (!tarefa) return 'ignorada';
    try {
      const manipulador = o.manipuladores[tarefa.tipo];
      if (!manipulador) throw new FalhaTarefa(`Tipo de tarefa sem manipulador: ${tarefa.tipo}.`, false);
      const conclusao = await manipulador(ctx, tarefa);
      const derivadas: LinhaTarefa[] = [];
      await ctx.banco.transacao(async (tx) => {
        const fim = ctx.relogio();
        await conclusao.aplicar?.(tx, async (nova) => {
          const { tarefa: derivada, criada } = await enfileirar(tx, nova, ctx.config.fila.politica.maximoTentativas, fim);
          if (criada) derivadas.push(derivada);
          return derivada;
        });
        await concluir(tx, tarefa.id, conclusao.resultado, fim);
      });
      registrar('info', 'tarefa concluída', { tarefa: tarefa.id, tipo: tarefa.tipo, tentativa: tarefa.tentativas });
      await despacharDerivadas(derivadas);
      return 'concluida';
    } catch (erro) {
      return registrarFalha(tarefa, erro);
    }
  }

  async function varrerInterno(): Promise<number> {
    const agora = ctx.relogio();
    if (driver.transporte === 'postgres') {
      let executadas = 0;
      for (const id of await disponiveis(ctx.banco, agora, LOTE_VARREDURA)) {
        if (parado) break;
        if ((await processar(id)) !== 'ignorada') executadas++;
      }
      return executadas;
    }
    const perdidas = await avisosPerdidos(ctx.banco, agora, margemAvisoMs, LOTE_VARREDURA);
    for (const id of perdidas) await driver.despachar({ id, esperaMs: 0 });
    await marcarDespachada(ctx.banco, perdidas, agora);
    return perdidas.length;
  }

  function processar(id: string): Promise<DesfechoProcessamento> {
    if (parado) return Promise.resolve('ignorada');
    return acompanhar(processarInterno(id));
  }

  function varrer(): Promise<number> {
    if (parado) return Promise.resolve(0);
    if (!varredura) {
      varredura = acompanhar(varrerInterno()).finally(() => {
        varredura = null;
      });
    }
    return varredura;
  }

  return {
    async iniciar() {
      await driver.consumir(async (id) => {
        await processar(id);
      });
      if (intervaloMs > 0) {
        temporizador = setInterval(() => {
          varrer().catch((erro: unknown) => registrar('error', 'falha na varredura da fila', { erro: String(erro) }));
        }, intervaloMs);
        temporizador.unref();
      }
    },
    processar,
    varrer,
    async parar() {
      parado = true;
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
      await Promise.allSettled([...emAndamento]);
    },
  };
}
