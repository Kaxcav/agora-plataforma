/**
 * Sonda de disponibilidade (RNF-10, IMR-01): a cada intervalo, a API verifica o banco, a fila de integrações e a
 * última sincronização com o PNCP, e grava o resultado em `operacao_sondagens`. Sondagens seguidas com o mesmo
 * resultado estendem o mesmo intervalo; com várias réplicas, cada uma estende o intervalo das outras.
 *
 * A sondagem é telemetria do servidor, não ato de usuário: não gera evento na trilha (a sondagem manual, pedida
 * pelo administrador, gera). Se o banco cair, as sondagens ficam na memória e são gravadas quando ele voltar.
 */
import { hostname } from 'node:os';
import type { ComponenteOperacao } from '@agora/dominio';
import type { Banco } from '../../banco/tipos.ts';
import type { ServicoFila } from '../../fila/servico.ts';
import type { ContextoApp } from '../../http/contexto.ts';

const CHAVE_LOCK_SONDA = 14_133_310;
const MAXIMO_PENDENTES = 1440;
const VALIDADE_MINIMA_MS = 120_000;

export interface DetalhesSondagem {
  latenciaBancoMs: number | null;
  tarefasAtrasadas: number | null;
  tarefasPncpEmEspera: number | null;
  transporte: 'postgres' | 'rabbitmq';
  sincronizacaoPncp: { situacao: string; ultimoSucessoEm: string | null; ultimaExecucaoEm: string | null } | null;
  replica: string;
}

export interface ResultadoSondagem {
  instante: Date;
  componentes: Record<ComponenteOperacao, boolean>;
  pncpEmManutencao: boolean;
  detalhes: DetalhesSondagem;
}

/** Quanto vale uma sondagem: o dobro do intervalo da sonda, com mínimo de 2 minutos. */
export function validadeSondagemMs(sondaSegundos: number): number {
  return Math.max(2 * sondaSegundos * 1000, VALIDADE_MINIMA_MS);
}

/** Verifica os componentes agora. Não lança: falha de consulta vira componente indisponível. */
export async function sondar(ctx: ContextoApp, fila: ServicoFila): Promise<ResultadoSondagem> {
  const instante = ctx.relogio();
  const partida = performance.now();
  const bancoOk = await ctx.banco.verificar().catch(() => false);
  const latencia = bancoOk ? Math.round(performance.now() - partida) : null;
  let tarefasAtrasadas: number | null = null;
  let tarefasPncpEmEspera: number | null = null;
  let sincronizacao: DetalhesSondagem['sincronizacaoPncp'] = null;
  if (bancoOk) {
    try {
      const limiteFila = new Date(instante.getTime() - ctx.config.operacao.filaAtrasoMaximoMinutos * 60_000).toISOString();
      const [contagem] = await ctx.banco.consultar<{ atrasadas: number; pncp: number }>(
        `SELECT count(*) FILTER (WHERE situacao = 'pendente' AND disponivel_em < $1)::int AS atrasadas,
                count(*) FILTER (WHERE tipo LIKE 'pncp.%' AND situacao = 'pendente' AND tentativas > 0 AND ultimo_erro IS NOT NULL)::int AS pncp
           FROM fila_tarefas`,
        [limiteFila],
      );
      tarefasAtrasadas = contagem?.atrasadas ?? 0;
      tarefasPncpEmEspera = contagem?.pncp ?? 0;
      const [sinc] = await ctx.banco.consultar<{ situacao: string; ultimo_sucesso_em: string | null; ultima_execucao_em: string | null }>(
        `SELECT situacao, ultimo_sucesso_em, ultima_execucao_em FROM sincronizacoes
          WHERE fonte = 'PNCP' ORDER BY ultima_execucao_em DESC NULLS LAST LIMIT 1`,
      );
      sincronizacao = sinc ? { situacao: sinc.situacao, ultimoSucessoEm: sinc.ultimo_sucesso_em, ultimaExecucaoEm: sinc.ultima_execucao_em } : null;
    } catch {
      tarefasAtrasadas = null;
    }
  }
  const limiteHoras = ctx.config.operacao.sincronizacaoAtrasoMaximoHoras;
  const sincronizacaoOk =
    sincronizacao !== null &&
    sincronizacao.situacao !== 'falhou' &&
    sincronizacao.ultimoSucessoEm !== null &&
    (limiteHoras === null || instante.getTime() - Date.parse(sincronizacao.ultimoSucessoEm) <= limiteHoras * 3_600_000);
  return {
    instante,
    componentes: {
      api: true,
      banco: bancoOk,
      fila: bancoOk && tarefasAtrasadas === 0 && fila.driver.pronto(),
      sincronizacao: bancoOk && sincronizacaoOk,
    },
    pncpEmManutencao: (tarefasPncpEmEspera ?? 0) > 0,
    detalhes: {
      latenciaBancoMs: latencia,
      tarefasAtrasadas,
      tarefasPncpEmEspera,
      transporte: fila.driver.transporte,
      sincronizacaoPncp: sincronizacao,
      replica: hostname(),
    },
  };
}

interface UltimoIntervalo {
  id: string;
  fim: string;
  api: boolean;
  banco: boolean;
  fila: boolean;
  sincronizacao: boolean;
  pncp_em_manutencao: boolean;
}

/** Estende o último intervalo (mesmo resultado e ainda válido) ou abre um novo. Sondagem antiga já coberta é ignorada. */
export async function gravarSondagem(banco: Banco, r: ResultadoSondagem, validadeMs: number): Promise<void> {
  await banco.transacao(async (tx) => {
    await tx.consultar('SELECT pg_advisory_xact_lock($1)', [CHAVE_LOCK_SONDA]);
    const [ultimo] = await tx.consultar<UltimoIntervalo>(
      'SELECT id, fim, api, banco, fila, sincronizacao, pncp_em_manutencao FROM operacao_sondagens ORDER BY fim DESC LIMIT 1',
    );
    const instante = r.instante.getTime();
    const detalhes = JSON.stringify(r.detalhes);
    if (ultimo && instante <= Date.parse(ultimo.fim)) return;
    const mesmoResultado =
      ultimo !== undefined &&
      ultimo.api === r.componentes.api &&
      ultimo.banco === r.componentes.banco &&
      ultimo.fila === r.componentes.fila &&
      ultimo.sincronizacao === r.componentes.sincronizacao &&
      ultimo.pncp_em_manutencao === r.pncpEmManutencao;
    if (ultimo && mesmoResultado && instante - Date.parse(ultimo.fim) <= validadeMs) {
      await tx.executar('UPDATE operacao_sondagens SET fim = $2, amostras = amostras + 1, detalhes = $3::jsonb WHERE id = $1', [ultimo.id, r.instante.toISOString(), detalhes]);
      return;
    }
    await tx.executar(
      `INSERT INTO operacao_sondagens (inicio, fim, api, banco, fila, sincronizacao, pncp_em_manutencao, detalhes)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [r.instante.toISOString(), r.componentes.api, r.componentes.banco, r.componentes.fila, r.componentes.sincronizacao, r.pncpEmManutencao, detalhes],
    );
  });
}

export interface Sonda {
  /** Sonda agora e grava (com as sondagens pendentes, se o banco tinha caído). */
  executarAgora(): Promise<ResultadoSondagem>;
  parar(): void;
}

/** Sonda periódica no processo da API (intervalo `AGORA_OPERACAO_SONDA_SEGUNDOS`; 0 = só sob demanda). */
export function criarSonda(opcoes: { ctx: ContextoApp; fila: ServicoFila; aoFalhar: (erro: unknown) => void }): Sonda {
  const { ctx, fila, aoFalhar } = opcoes;
  const segundos = ctx.config.operacao.sondaSegundos;
  const validade = validadeSondagemMs(segundos);
  const pendentes: ResultadoSondagem[] = [];
  let parada = false;
  let emCurso: Promise<ResultadoSondagem> | null = null;

  async function ciclo(): Promise<ResultadoSondagem> {
    const resultado = await sondar(ctx, fila);
    pendentes.push(resultado);
    if (pendentes.length > MAXIMO_PENDENTES) pendentes.splice(0, pendentes.length - MAXIMO_PENDENTES);
    try {
      while (pendentes.length > 0 && !parada) {
        const proxima = pendentes[0];
        if (!proxima) break;
        await gravarSondagem(ctx.banco, proxima, validade);
        pendentes.shift();
      }
    } catch (erro) {
      aoFalhar(erro);
    }
    return resultado;
  }

  function executarAgora(): Promise<ResultadoSondagem> {
    if (emCurso) return emCurso;
    emCurso = ciclo().finally(() => {
      emCurso = null;
    });
    return emCurso;
  }

  const temporizador = segundos > 0 ? setInterval(() => void executarAgora().catch(aoFalhar), segundos * 1000) : null;
  temporizador?.unref();
  return {
    executarAgora,
    parar() {
      parada = true;
      if (temporizador) clearInterval(temporizador);
    },
  };
}
