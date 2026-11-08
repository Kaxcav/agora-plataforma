/**
 * Operação da plataforma (RNF-10; IMR-01): situação atual dos componentes, relatório mensal de disponibilidade com
 * as janelas de manutenção do PNCP, exportação em CSV, sondagem manual e registro das janelas programadas.
 * A sonda periódica nasce aqui, no processo da API, e para quando a aplicação fecha.
 */
import type { JanelaManutencaoPncp, RelatorioDisponibilidade, SituacaoOperacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { validacao } from '../../http/erros.ts';
import { gerarCsv, type CelulaCsv } from '../itens/csv.ts';
import { disponibilidadePorDia, mesCorrente, montarRelatorioDisponibilidade, situacaoAtual } from './relatorio.ts';
import { criarSonda } from './sonda.ts';

const MAXIMO_JANELA_MS = 7 * 86_400_000;
const esquemaMes = z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o formato AAAA-MM').optional() });
const instanteIso = z.iso.datetime({ offset: true, message: 'Informe data e hora completas (ISO 8601)' });
const esquemaJanela = z
  .object({
    inicio: instanteIso,
    fim: instanteIso,
    descricao: z.string().trim().min(10).max(500),
  })
  .refine((j) => Date.parse(j.fim) > Date.parse(j.inicio), { message: 'O fim da janela deve ser posterior ao início.', path: ['fim'] })
  .refine((j) => Date.parse(j.fim) - Date.parse(j.inicio) <= MAXIMO_JANELA_MS, { message: 'Uma janela de manutenção tem no máximo 7 dias.', path: ['fim'] });

function percentualCsv(valor: number | null): CelulaCsv {
  return valor === null ? '' : valor.toFixed(2).replace('.', ',');
}

export async function rotasOperacao(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('operacao:ler') };
  const administracao = { preHandler: exigir('operacao:administrar') };

  const sonda = criarSonda({ ctx, fila: app.fila, aoFalhar: (erro) => app.log.warn({ err: erro }, 'sonda de disponibilidade: falha ao gravar a sondagem') });
  app.addHook('onClose', async () => {
    sonda.parar();
  });
  await sonda.executarAgora().catch((erro: unknown) => app.log.warn({ err: erro }, 'sonda de disponibilidade: falha na primeira sondagem'));

  function mesDaConsulta(query: unknown): string {
    const { mes } = esquemaMes.parse(query);
    const atual = mesCorrente(ctx.hoje());
    if (mes !== undefined && mes > atual) throw validacao('O mês ainda não começou.', [{ campo: 'mes', mensagem: 'Escolha o mês atual ou um anterior.' }]);
    return mes ?? atual;
  }

  app.get('/operacao/situacao', leitura, async (): Promise<SituacaoOperacao> => situacaoAtual(ctx, app.fila));

  app.post('/operacao/sondar', administracao, async (request): Promise<SituacaoOperacao> => {
    const resultado = await sonda.executarAgora();
    await ctx.banco.transacao(async (tx) => {
      await auditar(tx, request, {
        acao: 'operacao.sondar',
        recurso: 'sistema',
        recursoId: null,
        resumo: 'Pediu uma sondagem de disponibilidade da plataforma',
        dados: { componentes: resultado.componentes, pncpEmManutencao: resultado.pncpEmManutencao, latenciaBancoMs: resultado.detalhes.latenciaBancoMs },
      });
    });
    return situacaoAtual(ctx, app.fila);
  });

  app.get('/operacao/disponibilidade', leitura, async (request): Promise<RelatorioDisponibilidade> => montarRelatorioDisponibilidade(ctx, mesDaConsulta(request.query)));

  app.get('/operacao/disponibilidade.csv', leitura, async (request, reply) => {
    const mes = mesDaConsulta(request.query);
    const relatorio = await montarRelatorioDisponibilidade(ctx, mes);
    const dias = await disponibilidadePorDia(ctx, mes);
    const linhas: CelulaCsv[][] = [
      ...dias.map(({ dia, r }) => [
        'Dia',
        dia,
        r.minutosConsiderados,
        r.minutosDisponiveis,
        r.minutosIndisponiveis,
        r.minutosSemMedicao,
        percentualCsv(r.percentual),
        '',
      ]),
      [
        'Mês',
        mes,
        relatorio.minutosConsiderados,
        relatorio.minutosDisponiveis,
        relatorio.minutosIndisponiveis,
        relatorio.minutosSemMedicao,
        percentualCsv(relatorio.percentual),
        relatorio.metaPercentual === null ? 'Meta não configurada' : `Meta ${relatorio.metaPercentual}%`,
      ],
      ...relatorio.janelasPncp.map((j) => [
        `Janela do PNCP (${j.origem === 'registrada' ? 'registrada' : 'detectada'})`,
        `${j.inicio} a ${j.fim}`,
        j.minutos,
        '',
        '',
        '',
        '',
        `${j.tarefasAbsorvidas} tarefa(s) absorvida(s) pela fila; ${j.tarefasNaFilaDeErro} na fila de erro. ${j.descricao ?? ''}`.trim(),
      ]),
    ];
    const csv = gerarCsv(
      ['Registro', 'Data ou período', 'Minutos considerados', 'Minutos disponíveis', 'Minutos indisponíveis', 'Minutos sem medição', 'Disponibilidade (%)', 'Observação'],
      linhas,
    );
    await ctx.banco.transacao(async (tx) => {
      await auditar(tx, request, {
        acao: 'operacao.relatorio.exportar',
        recurso: 'sistema',
        recursoId: null,
        resumo: `Exportou o relatório de disponibilidade de ${mes} (CSV)`,
        dados: { mes, percentual: relatorio.percentual, janelasPncp: relatorio.janelasPncp.length },
      });
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="disponibilidade-agora-${mes}.csv"`)
      .header('cache-control', 'no-store')
      .send(csv);
  });

  app.post('/operacao/janelas', administracao, async (request): Promise<JanelaManutencaoPncp> => {
    const entrada = esquemaJanela.parse(request.body);
    const sessao = sessaoDe(request);
    const inicio = new Date(entrada.inicio).toISOString();
    const fim = new Date(entrada.fim).toISOString();
    const agora = ctx.relogio();
    const id = await ctx.banco.transacao(async (tx) => {
      const [linha] = await tx.consultar<{ id: string }>(
        `INSERT INTO operacao_janelas_manutencao (sistema, inicio, fim, descricao, registrada_por, registrada_em)
         VALUES ('pncp', $1, $2, $3, $4, $5) RETURNING id`,
        [inicio, fim, entrada.descricao, sessao.usuario.id, agora.toISOString()],
      );
      if (!linha) throw new Error('Falha ao registrar a janela de manutenção');
      await auditar(tx, request, {
        acao: 'operacao.janela.registrar',
        recurso: 'janela_manutencao',
        recursoId: linha.id,
        resumo: 'Registrou uma janela de manutenção do PNCP',
        dados: { sistema: 'pncp', inicio, fim, descricao: entrada.descricao },
      });
      return linha.id;
    });
    return {
      id,
      origem: 'registrada',
      inicio,
      fim,
      minutos: Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000),
      descricao: entrada.descricao,
      tarefasAbsorvidas: 0,
      tarefasNaFilaDeErro: 0,
    };
  });
}
