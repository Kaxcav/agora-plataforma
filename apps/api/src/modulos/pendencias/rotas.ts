import type { Pagina, Pendencia, TipoPendencia } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado } from '../../http/erros.ts';
import { camposPaginacao, codigoUasg, deslocamento, idDaRota, ordemQuery, pagina, textoBusca } from '../../http/validacao.ts';
import { listarPendencias, obterPendencia } from './repositorio.ts';

const TIPOS: readonly TipoPendencia[] = ['saldo', 'vigencia', 'reajuste', 'pagamento', 'tarefa', 'divulgacao_pncp', 'garantia', 'lembrete'];

const ROTULO_TIPO: Record<TipoPendencia, string> = {
  saldo: 'saldo',
  vigencia: 'vigência',
  reajuste: 'reajuste',
  pagamento: 'pagamento',
  tarefa: 'tarefa',
  divulgacao_pncp: 'divulgação no PNCP',
  garantia: 'garantia',
  lembrete: 'lembrete',
};

const esquemaFiltro = z.object({
  busca: textoBusca,
  tipo: z.enum(TIPOS).optional(),
  prioridade: z.enum(['alta', 'media', 'baixa']).optional(),
  situacao: z.enum(['aberta', 'resolvida']).optional(),
  uasg: codigoUasg.optional(),
  responsavel: z.enum(['eu', 'todos']).optional(),
  ordenarPor: z.enum(['prioridade', 'prazo', 'uasg']).optional(),
  ordem: ordemQuery,
  ...camposPaginacao,
});

const esquemaResolver = z.object({ observacao: z.string().trim().min(5).max(500) });

interface LinhaAlvo {
  tipo: TipoPendencia;
  situacao: 'aberta' | 'resolvida';
  instrumento_tipo: 'ata' | 'contrato';
  instrumento_id: string;
}

export async function rotasPendencias(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/pendencias', { preHandler: exigir('painel:ler') }, async (request): Promise<Pagina<Pendencia>> => {
    const f = esquemaFiltro.parse(request.query);
    const sessao = sessaoDe(request);
    const { itens, total } = await listarPendencias(
      ctx.banco,
      {
        escopo: escopoUasgs(sessao),
        busca: f.busca,
        tipo: f.tipo,
        prioridade: f.prioridade,
        situacao: f.situacao,
        uasg: f.uasg,
        responsavelId: f.responsavel === 'eu' ? sessao.usuario.id : undefined,
      },
      { campo: f.ordenarPor ?? 'prioridade', ordem: f.ordem ?? 'asc' },
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  async function alterarSituacao(
    request: Parameters<typeof sessaoDe>[0],
    id: string,
    para: 'aberta' | 'resolvida',
    observacao: string | null,
  ): Promise<Pendencia> {
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    await ctx.banco.transacao(async (tx) => {
      const [alvo] = await tx.consultar<LinhaAlvo>(
        `SELECT tipo, situacao, instrumento_tipo, instrumento_id FROM pendencias
          WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))
          FOR UPDATE`,
        [id, escopo],
      );
      if (!alvo) throw naoEncontrado('Pendência não encontrada.');
      if (alvo.situacao === para) {
        throw conflito(para === 'resolvida' ? 'Esta pendência já foi resolvida.' : 'Esta pendência já está aberta.');
      }
      if (para === 'resolvida') {
        await tx.executar(
          `UPDATE pendencias SET situacao = 'resolvida', resolvida_em = $2, resolvida_por = $3, observacao_resolucao = $4 WHERE id = $1`,
          [id, ctx.relogio().toISOString(), sessao.usuario.id, observacao],
        );
      } else {
        await tx.executar(
          `UPDATE pendencias SET situacao = 'aberta', resolvida_em = NULL, resolvida_por = NULL, observacao_resolucao = NULL WHERE id = $1`,
          [id],
        );
      }
      await auditar(tx, request, {
        acao: para === 'resolvida' ? 'pendencia.resolver' : 'pendencia.reabrir',
        recurso: 'pendencia',
        recursoId: id,
        resumo: `${para === 'resolvida' ? 'Resolveu' : 'Reabriu'} pendência de ${ROTULO_TIPO[alvo.tipo]}`,
        dados: {
          instrumentoTipo: alvo.instrumento_tipo,
          instrumentoId: alvo.instrumento_id,
          tipo: alvo.tipo,
          situacao: { de: alvo.situacao, para },
          ...(observacao !== null ? { detalhes: `Observação registrada (${observacao.length} caracteres)` } : {}),
        },
      });
    });
    const pendencia = await obterPendencia(ctx.banco, id, escopo);
    if (!pendencia) throw naoEncontrado('Pendência não encontrada.');
    return pendencia;
  }

  app.post('/pendencias/:id/resolver', { preHandler: exigir('pendencias:resolver') }, async (request) => {
    const id = idDaRota(request.params);
    const corpo = esquemaResolver.parse(request.body);
    return alterarSituacao(request, id, 'resolvida', corpo.observacao);
  });

  app.post('/pendencias/:id/reabrir', { preHandler: exigir('pendencias:resolver') }, async (request) => {
    const id = idDaRota(request.params);
    return alterarSituacao(request, id, 'aberta', null);
  });
}
