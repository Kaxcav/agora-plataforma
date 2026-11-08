/**
 * Relatório mensal de disponibilidade (IMR-01) e janelas de manutenção do PNCP: lê os intervalos de sondagem e as
 * janelas registradas e entrega ao domínio (`calcularDisponibilidade`), que faz a conta.
 */
import { calcularDisponibilidade, COMPONENTES_OPERACAO, type ComponenteOperacao, type IntervaloSondagem } from '@agora/dominio';
import type { JanelaManutencaoPncp, RelatorioDisponibilidade, SituacaoComponenteOperacao, SituacaoOperacao } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import type { ServicoFila } from '../../fila/servico.ts';
import { validadeSondagemMs, type DetalhesSondagem } from './sonda.ts';

export const NOMES_COMPONENTES: Readonly<Record<ComponenteOperacao, string>> = Object.freeze({
  api: 'API da plataforma',
  banco: 'Banco de dados',
  fila: 'Fila de integrações',
  sincronizacao: 'Sincronização com o PNCP',
});

/** Fuso de Brasília sem horário de verão (desde 2019): o mês vai da 0h do dia 1 à 0h do dia 1 seguinte. */
const FUSO = '-03:00';
const HORA_BRASILIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

interface LinhaSondagem {
  inicio: string;
  fim: string;
  api: boolean;
  banco: boolean;
  fila: boolean;
  sincronizacao: boolean;
  pncp_em_manutencao: boolean;
  detalhes: DetalhesSondagem | Record<string, never>;
}

interface LinhaJanela {
  id: string;
  inicio: string;
  fim: string;
  descricao: string;
}

export function periodoDoMes(mes: string, agora: Date): { inicio: string; fim: string } {
  const [ano, numero] = mes.split('-').map(Number) as [number, number];
  const inicio = new Date(`${mes}-01T00:00:00.000${FUSO}`);
  const seguinte = numero === 12 ? `${ano + 1}-01` : `${ano}-${String(numero + 1).padStart(2, '0')}`;
  const fimDoMes = new Date(`${seguinte}-01T00:00:00.000${FUSO}`);
  const fim = new Date(Math.max(inicio.getTime(), Math.min(fimDoMes.getTime(), agora.getTime())));
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

/** Mês corrente 'AAAA-MM' no fuso de Brasília. */
export function mesCorrente(hoje: string): string {
  return hoje.slice(0, 7);
}

function paraIntervalo(l: LinhaSondagem): IntervaloSondagem {
  return {
    inicio: l.inicio,
    fim: l.fim,
    componentes: { api: l.api, banco: l.banco, fila: l.fila, sincronizacao: l.sincronizacao },
    pncpEmManutencao: l.pncp_em_manutencao,
  };
}

export async function carregarIntervalos(executor: Executor, inicio: string, fim: string, validadeMs: number): Promise<IntervaloSondagem[]> {
  const desde = new Date(Date.parse(inicio) - validadeMs).toISOString();
  const linhas = await executor.consultar<LinhaSondagem>(
    `SELECT inicio, fim, api, banco, fila, sincronizacao, pncp_em_manutencao, '{}'::jsonb AS detalhes
       FROM operacao_sondagens WHERE fim >= $1 AND inicio < $2 ORDER BY inicio`,
    [desde, fim],
  );
  return linhas.map(paraIntervalo);
}

async function inicioDaMedicao(executor: Executor): Promise<string | null> {
  const [linha] = await executor.consultar<{ inicio: string | null }>('SELECT min(inicio) AS inicio FROM operacao_sondagens');
  return linha?.inicio ?? null;
}

async function janelasRegistradas(executor: Executor, inicio: string, fim: string): Promise<LinhaJanela[]> {
  return executor.consultar<LinhaJanela>(
    `SELECT id, inicio, fim, descricao FROM operacao_janelas_manutencao
      WHERE sistema = 'pncp' AND fim > $1 AND inicio < $2 ORDER BY inicio`,
    [inicio, fim],
  );
}

/** Tarefas do PNCP pendentes durante a janela: concluídas depois de novas tentativas (absorvidas) ou na fila de erro. */
async function tarefasDaJanela(executor: Executor, inicio: string, fim: string): Promise<{ absorvidas: number; naFilaDeErro: number }> {
  const [linha] = await executor.consultar<{ absorvidas: number; erro: number }>(
    `SELECT count(*) FILTER (WHERE situacao = 'concluida' AND tentativas > 1 AND concluida_em > $1)::int AS absorvidas,
            count(*) FILTER (WHERE situacao = 'erro' AND atualizada_em > $1)::int AS erro
       FROM fila_tarefas WHERE tipo LIKE 'pncp.%' AND criada_em < $2`,
    [inicio, fim],
  );
  return { absorvidas: linha?.absorvidas ?? 0, naFilaDeErro: linha?.erro ?? 0 };
}

const PREMISSAS = [
  'Disponibilidade = (minutos considerados − minutos indisponíveis − minutos sem medição) ÷ minutos considerados × 100, truncada em duas casas.',
  'Um minuto é indisponível quando a API, o banco, a fila de integrações ou a sincronização com o PNCP falhou na sondagem; minuto sem sondagem válida também conta como indisponível.',
  'A medição começa na primeira sondagem registrada; antes dela não havia sonda.',
  'Falha da sincronização durante janela de manutenção do PNCP (informada pelo órgão ou detectada pela fila) não conta: a fila guarda as transações e as reenvia depois.',
  'O relatório mede; a glosa, se houver, é decisão do fiscal do contrato. Requer revisão humana.',
];

export async function montarRelatorioDisponibilidade(ctx: ContextoApp, mes: string): Promise<RelatorioDisponibilidade> {
  const agora = ctx.relogio();
  const periodo = periodoDoMes(mes, agora);
  const validade = validadeSondagemMs(ctx.config.operacao.sondaSegundos);
  const intervalos = await carregarIntervalos(ctx.banco, periodo.inicio, periodo.fim, validade);
  const registradas = await janelasRegistradas(ctx.banco, periodo.inicio, periodo.fim);
  const inicioMedicao = await inicioDaMedicao(ctx.banco);
  const r = calcularDisponibilidade({
    inicio: periodo.inicio,
    fim: periodo.fim,
    intervalos,
    validadeMs: validade,
    janelasRegistradas: registradas,
    inicioMedicao,
    metaPercentual: ctx.config.operacao.metaDisponibilidade,
  });
  const janelasPncp: JanelaManutencaoPncp[] = [];
  for (const j of r.janelasPncp) {
    const registrada = j.origem === 'registrada' ? registradas.find((x) => Date.parse(x.inicio) <= Date.parse(j.inicio) && Date.parse(x.fim) >= Date.parse(j.fim)) : undefined;
    const tarefas = await tarefasDaJanela(ctx.banco, j.inicio, j.fim);
    janelasPncp.push({
      id: registrada?.id ?? null,
      origem: j.origem,
      inicio: j.inicio,
      fim: j.fim,
      minutos: j.minutos,
      descricao: registrada?.descricao ?? (j.origem === 'detectada' ? 'Detectada pela fila: tarefas do PNCP aguardando nova tentativa por indisponibilidade do portal.' : null),
      tarefasAbsorvidas: tarefas.absorvidas,
      tarefasNaFilaDeErro: tarefas.naFilaDeErro,
    });
  }
  return {
    mes,
    periodo,
    inicioMedicao: r.inicioMedicao,
    minutosConsiderados: r.minutosConsiderados,
    minutosDisponiveis: r.minutosDisponiveis,
    minutosIndisponiveis: r.minutosIndisponiveis,
    minutosSemMedicao: r.minutosSemMedicao,
    percentual: r.percentual,
    metaPercentual: r.metaPercentual,
    situacao: r.situacao,
    componentes: r.componentes.map((c) => ({ ...c, nome: NOMES_COMPONENTES[c.componente] })),
    ocorrencias: r.ocorrencias,
    janelasPncp,
    premissas: PREMISSAS,
    fontes: [
      `Sonda de disponibilidade do servidor (a cada ${ctx.config.operacao.sondaSegundos > 0 ? `${ctx.config.operacao.sondaSegundos} s` : 'pedido do administrador'}; validade de ${Math.round(validade / 1000)} s por sondagem)`,
      'Janelas de manutenção do PNCP registradas pelo órgão e tarefas da fila de integrações',
      `Meta: ${ctx.config.operacao.metaDisponibilidade === null ? 'não configurada (AGORA_OPERACAO_META_DISPONIBILIDADE)' : `${ctx.config.operacao.metaDisponibilidade}% (AGORA_OPERACAO_META_DISPONIBILIDADE)`}`,
    ],
    geradoEm: agora.toISOString(),
  };
}

/** Disponibilidade dia a dia do mês (linhas do CSV). */
export async function disponibilidadePorDia(ctx: ContextoApp, mes: string): Promise<{ dia: string; r: ReturnType<typeof calcularDisponibilidade> }[]> {
  const agora = ctx.relogio();
  const periodo = periodoDoMes(mes, agora);
  const validade = validadeSondagemMs(ctx.config.operacao.sondaSegundos);
  const intervalos = await carregarIntervalos(ctx.banco, periodo.inicio, periodo.fim, validade);
  const registradas = await janelasRegistradas(ctx.banco, periodo.inicio, periodo.fim);
  const inicioMedicao = await inicioDaMedicao(ctx.banco);
  const dias: { dia: string; r: ReturnType<typeof calcularDisponibilidade> }[] = [];
  for (let inicio = Date.parse(periodo.inicio); inicio < Date.parse(periodo.fim); inicio += 86_400_000) {
    const fim = Math.min(inicio + 86_400_000, Date.parse(periodo.fim));
    const dia = new Date(inicio - 3 * 3_600_000).toISOString().slice(0, 10);
    dias.push({
      dia,
      r: calcularDisponibilidade({
        inicio: new Date(inicio).toISOString(),
        fim: new Date(fim).toISOString(),
        intervalos,
        validadeMs: validade,
        janelasRegistradas: registradas,
        inicioMedicao,
        metaPercentual: ctx.config.operacao.metaDisponibilidade,
      }),
    });
  }
  return dias;
}

function detalheComponente(componente: ComponenteOperacao, disponivel: boolean, d: Partial<DetalhesSondagem>): string {
  switch (componente) {
    case 'api':
      return disponivel ? `Respondendo (réplica ${d.replica ?? '—'})` : 'Sem resposta';
    case 'banco':
      return disponivel ? `Respondendo em ${d.latenciaBancoMs ?? '—'} ms` : 'Sem resposta do banco';
    case 'fila':
      if (d.tarefasAtrasadas === null || d.tarefasAtrasadas === undefined) return 'Não foi possível consultar a fila';
      return d.tarefasAtrasadas > 0
        ? `${d.tarefasAtrasadas} tarefa(s) prontas e sem trabalhador que as execute (transporte ${d.transporte ?? '—'})`
        : `Sem tarefas atrasadas (transporte ${d.transporte ?? '—'})`;
    case 'sincronizacao': {
      const s = d.sincronizacaoPncp;
      if (!s) return 'O PNCP nunca foi sincronizado';
      const quando = s.ultimoSucessoEm ? `última com sucesso em ${HORA_BRASILIA.format(new Date(s.ultimoSucessoEm))}` : 'nenhuma com sucesso';
      return s.situacao === 'falhou' ? `Última sincronização falhou (${quando})` : disponivel ? `Em dia (${quando})` : `Atrasada (${quando})`;
    }
  }
}

/** Situação atual: a última sondagem registrada (de qualquer réplica). */
export async function situacaoAtual(ctx: ContextoApp, fila: ServicoFila): Promise<SituacaoOperacao> {
  const [ultima] = await ctx.banco.consultar<LinhaSondagem>(
    'SELECT inicio, fim, api, banco, fila, sincronizacao, pncp_em_manutencao, detalhes FROM operacao_sondagens ORDER BY fim DESC LIMIT 1',
  );
  const validade = validadeSondagemMs(ctx.config.operacao.sondaSegundos);
  const detalhes: Partial<DetalhesSondagem> = ultima?.detalhes ?? {};
  const componentes: SituacaoComponenteOperacao[] = COMPONENTES_OPERACAO.map((componente) => {
    const disponivel = ultima ? ultima[componente] : false;
    return { componente, nome: NOMES_COMPONENTES[componente], disponivel, detalhe: ultima ? detalheComponente(componente, disponivel, detalhes) : 'Sem sondagem registrada' };
  });
  return {
    verificadaEm: ultima?.fim ?? null,
    atual: ultima !== undefined && ctx.relogio().getTime() - Date.parse(ultima.fim) <= validade,
    componentes,
    pncpEmManutencao: ultima?.pncp_em_manutencao ?? false,
    sonda: { ligada: ctx.config.operacao.sondaSegundos > 0, intervaloSegundos: ctx.config.operacao.sondaSegundos, validadeSegundos: Math.round(validade / 1000) },
    ambiente: ctx.config.ambiente,
    versao: ctx.versao,
    integracoes: ctx.config.integracoes,
    fila: { transporte: fila.driver.transporte, trabalhador: ctx.config.fila.trabalhador },
    metaDisponibilidade: ctx.config.operacao.metaDisponibilidade,
  };
}
