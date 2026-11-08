import type { Pagina, ResumoFila, TarefaFila } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, exigirAlguma, sessaoDe } from '../../autorizacao/exigir.ts';
import { contarPorSituacao, listarTarefas, mapearTarefa, obterTarefa, reabrir } from '../../fila/registro.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, deslocamento, idDaRota, pagina } from '../../http/validacao.ts';

const esquemaFiltro = z.object({
  situacao: z.enum(['pendente', 'executando', 'concluida', 'erro']).optional(),
  ...camposPaginacao,
});

/** Fila de integrações (RNF-07): situação, fila de erro e reprocessamento auditado. */
export async function rotasFila(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigirAlguma(['integracoes:executar', 'admin:usuarios']) };

  app.get('/fila/resumo', leitura, async (request): Promise<ResumoFila> => {
    const contagem = await contarPorSituacao(ctx.banco, escopoUasgs(sessaoDe(request)), ctx.relogio());
    return {
      transporte: app.fila.driver.transporte,
      trabalhador: ctx.config.fila.trabalhador,
      ...contagem,
      politica: { ...ctx.config.fila.politica },
    };
  });

  app.get('/fila/tarefas', leitura, async (request): Promise<Pagina<TarefaFila>> => {
    const f = esquemaFiltro.parse(request.query);
    const { itens, total } = await listarTarefas(ctx.banco, {
      situacao: f.situacao ?? null,
      escopo: escopoUasgs(sessaoDe(request)),
      limite: f.tamanhoPagina,
      inicio: deslocamento(f.pagina, f.tamanhoPagina),
    });
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  app.post('/fila/tarefas/:id/reprocessar', { preHandler: exigir('integracoes:executar') }, async (request): Promise<TarefaFila> => {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const tarefa = await ctx.banco.transacao(async (tx) => {
      const atual = await obterTarefa(tx, id);
      if (!atual || (escopo !== null && atual.uasg !== null && !escopo.includes(atual.uasg))) throw naoEncontrado('Tarefa não encontrada.');
      const reaberta = atual.situacao === 'erro' ? await reabrir(tx, id, ctx.relogio()) : null;
      if (!reaberta) throw regraNegocio('Só tarefas na fila de erro podem ser reprocessadas.', [{ campo: 'RNF-07', mensagem: `Situação atual: ${atual.situacao}` }]);
      await auditar(tx, request, {
        acao: 'fila.reprocessar',
        recurso: 'fila_tarefa',
        recursoId: id,
        resumo: `Reprocessou "${atual.descricao}", que estava na fila de erro`,
        dados: {
          tipo: atual.tipo,
          chaveIdempotencia: atual.chave_idempotencia,
          tentativasAnteriores: atual.tentativas,
          ultimoErro: atual.ultimo_erro,
          recurso: atual.recurso_tipo ? { tipo: atual.recurso_tipo, id: atual.recurso_id } : null,
        },
      });
      return reaberta;
    });
    await app.fila.despachar([tarefa]);
    return mapearTarefa((await app.fila.aguardar(tarefa.id)) ?? tarefa);
  });
}
