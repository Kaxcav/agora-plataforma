import type { PublicacaoPncp } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { reabrir } from '../../fila/registro.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { idDaRota } from '../../http/validacao.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { consultarPublicacaoPncp, solicitarDivulgacaoContrato } from './servico.ts';

/** Publicação no PNCP (RF-19): situação dos envios e divulgação do contrato gerado pela jornada (art. 94). */
export async function rotasPublicacaoPncp(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/processos/:id/publicacao-pncp', { preHandler: exigir('jornada:ler') }, async (request): Promise<PublicacaoPncp> => {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return consultarPublicacaoPncp(ctx.banco, linha);
  });

  app.post('/processos/:id/contrato/publicar-pncp', { preHandler: exigir('jornada:publicar') }, async (request): Promise<PublicacaoPncp> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const tarefa = await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      if (linha.contrato_id === null || linha.contrato_numero === null) {
        throw regraNegocio('Gere o contrato na etapa 7 antes de divulgá-lo no PNCP.', [{ campo: 'RF-19', mensagem: 'Contrato não gerado' }]);
      }
      if (linha.publicacao.pncp !== 'publicado') {
        throw regraNegocio('O edital do processo ainda não foi publicado no PNCP: o contrato é vinculado à contratação publicada.', [
          { campo: 'RF-19', mensagem: 'Contratação não publicada' },
        ]);
      }
      const [contrato] = await tx.consultar<{ id_pncp: string | null }>('SELECT id_pncp FROM contratos WHERE id = $1', [linha.contrato_id]);
      if (contrato?.id_pncp) throw regraNegocio(`O contrato já está divulgado no PNCP sob o nº ${contrato.id_pncp}.`);
      const agora = ctx.relogio();
      const pedido = await solicitarDivulgacaoContrato(
        tx,
        app.fila,
        linha,
        { id: linha.contrato_id, numero: linha.contrato_numero },
        sessao.usuario.id,
        ctx.config.integracoes,
        agora,
      );
      let enviada = pedido.tarefa;
      if (!pedido.nova) {
        const reaberta = pedido.tarefa.situacao === 'erro' ? await reabrir(tx, pedido.tarefa.id, agora) : null;
        if (!reaberta) throw regraNegocio('A divulgação deste contrato já está na fila de integrações.');
        enviada = reaberta;
      }
      await auditar(tx, request, {
        acao: 'processo.contrato.divulgar_pncp',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Enviou o contrato ${linha.contrato_numero} para divulgação no PNCP pela fila de integrações (art. 94)`,
        dados: {
          numeroSei: linha.numero_sei,
          contratoId: linha.contrato_id,
          tarefaId: enviada.id,
          chaveIdempotencia: enviada.chave_idempotencia,
          reprocessada: !pedido.nova,
          modo: ctx.config.integracoes,
        },
      });
      return enviada;
    });
    await app.fila.despachar([tarefa]);
    await app.fila.aguardar(tarefa.id);
    const linha = await obterLinhaProcesso(ctx.banco, id, escopo);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return consultarPublicacaoPncp(ctx.banco, linha);
  });
}
