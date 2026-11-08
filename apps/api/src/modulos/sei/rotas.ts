/**
 * Integração com o SEI (RF-35): situação do processo no SEI, envio pela fila e consulta das assinaturas feitas no SEI.
 * O navegador só fala com a Ágora; quem chama o SEI é o trabalhador da fila, no servidor.
 */
import type { IntegracaoSeiProcesso } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { escopoUasgs, exigir, exigirAlguma, sessaoDe } from '../../autorizacao/exigir.ts';
import { pedirTarefaRepetivel } from '../../fila/pedido-repetivel.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { idDaRota } from '../../http/validacao.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { listarEntradasSei, montarIntegracaoSei, obterProcessoSei } from './repositorio.ts';

export async function rotasSei(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  const naoConfigurado = () =>
    regraNegocio('O web service do SEI do órgão não está configurado (AGORA_SEI_*): peça ao administrador o cadastro do sistema no SEI.', [
      { campo: 'RF-35', mensagem: 'SEI não configurado' },
    ]);

  app.get('/processos/:id/sei', { preHandler: exigir('jornada:ler') }, async (request): Promise<IntegracaoSeiProcesso> => {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return montarIntegracaoSei(ctx.banco, linha.id, ctx.config);
  });

  app.post('/processos/:id/sei/enviar', { preHandler: exigir('jornada:editar') }, async (request): Promise<IntegracaoSeiProcesso> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    if (ctx.config.integracoes === 'online' && !ctx.config.sei.configurado) throw naoConfigurado();
    const tarefa = await ctx.banco.transacao(async (tx): Promise<LinhaTarefa> => {
      const linha = await obterLinhaProcesso(tx, id, escopoUasgs(sessao), true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      const processoSei = await obterProcessoSei(tx, linha.id);
      const pendentes = (await listarEntradasSei(tx, linha.id, false)).filter((e) => e.documento_id !== null && e.documento_formatado === null);
      const tramitacaoPendente = ctx.config.sei.idUnidadeDestino !== null && processoSei !== null && processoSei.enviado_unidade_em === null;
      if (processoSei && pendentes.length === 0 && !tramitacaoPendente) {
        throw regraNegocio('Não há documento aprovado pendente de envio ao SEI: aprove o documento na Ágora antes de enviá-lo.', [
          { campo: 'RF-35', mensagem: 'Nada a enviar' },
        ]);
      }
      const agora = ctx.relogio();
      const pedido = await pedirTarefaRepetivel(
        tx,
        app.fila,
        ['sei', 'envio', linha.id],
        {
          tipo: 'sei.envio',
          descricao: `Enviar ao SEI o processo ${linha.numero_sei} (${pendentes.length} documento(s))`,
          carga: { processoId: linha.id },
          uasg: linha.uasg,
          recurso: { tipo: 'processo', id: linha.id },
          solicitadaPor: sessao.usuario.id,
        },
        agora,
      );
      if (pedido.situacao === 'pendente') throw regraNegocio('O envio deste processo ao SEI já está na fila de integrações.');
      await auditar(tx, request, {
        acao: 'processo.sei.enviar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Pediu o envio ao SEI do processo ${linha.numero_sei}: ${processoSei ? 'processo já gerado no SEI' : 'gerar o processo no SEI'} e ${pendentes.length} documento(s) aprovado(s)`,
        dados: {
          numeroSei: linha.numero_sei,
          tarefaId: pedido.tarefa.id,
          chaveIdempotencia: pedido.tarefa.chave_idempotencia,
          reprocessada: pedido.situacao === 'reaberta',
          documentos: pendentes.map((p) => p.numero),
          modo: ctx.config.integracoes,
        },
      });
      return pedido.tarefa;
    });
    await app.fila.despachar([tarefa]);
    await app.fila.aguardar(tarefa.id);
    return montarIntegracaoSei(ctx.banco, id, ctx.config);
  });

  app.post(
    '/processos/:id/sei/consultar-assinaturas',
    { preHandler: exigirAlguma(['jornada:editar', 'jornada:aprovar_juridico']) },
    async (request): Promise<IntegracaoSeiProcesso> => {
      const id = idDaRota(request.params);
      const sessao = sessaoDe(request);
      if (ctx.config.integracoes === 'online' && !ctx.config.sei.configurado) throw naoConfigurado();
      const tarefa = await ctx.banco.transacao(async (tx): Promise<LinhaTarefa> => {
        const linha = await obterLinhaProcesso(tx, id, escopoUasgs(sessao), true);
        if (!linha) throw naoEncontrado('Processo não encontrado.');
        const enviados = (await listarEntradasSei(tx, linha.id, false)).filter((e) => e.documento_formatado !== null);
        if (enviados.length === 0) {
          throw regraNegocio('Nenhum documento deste processo foi enviado ao SEI: use "Enviar ao SEI" primeiro.', [{ campo: 'RF-35', mensagem: 'Sem documento no SEI' }]);
        }
        const pedido = await pedirTarefaRepetivel(
          tx,
          app.fila,
          ['sei', 'assinaturas', linha.id],
          {
            tipo: 'sei.assinaturas',
            descricao: `Consultar no SEI as assinaturas do processo ${linha.numero_sei}`,
            carga: { processoId: linha.id },
            uasg: linha.uasg,
            recurso: { tipo: 'processo', id: linha.id },
            solicitadaPor: sessao.usuario.id,
          },
          ctx.relogio(),
        );
        if (pedido.situacao !== 'pendente') {
          await auditar(tx, request, {
            acao: 'processo.sei.consultar_assinaturas',
            recurso: 'processo',
            recursoId: linha.id,
            resumo: `Pediu a consulta das assinaturas no SEI de ${enviados.length} documento(s) do processo ${linha.numero_sei}`,
            dados: { numeroSei: linha.numero_sei, tarefaId: pedido.tarefa.id, reprocessada: pedido.situacao === 'reaberta', modo: ctx.config.integracoes },
          });
        }
        return pedido.tarefa;
      });
      await app.fila.despachar([tarefa]);
      await app.fila.aguardar(tarefa.id);
      return montarIntegracaoSei(ctx.banco, id, ctx.config);
    },
  );
}
