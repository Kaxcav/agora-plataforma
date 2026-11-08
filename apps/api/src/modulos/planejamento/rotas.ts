/**
 * Planejamento das contratações (frente O): plano de contratações anual (F10, RF-31), catálogo CATMAT/CATSER (F19,
 * RIA-13) e intenção de registro de preços (F5, RN-38).
 *
 * Autorização no servidor: permissão por rota (`exigir`) e escopo de UASG em toda leitura e escrita de plano, processo
 * e IRP. Toda escrita é transacional e gera evento na trilha de auditoria. As consultas a sistemas externos (PNCP e
 * dados abertos de compras) são feitas só pelo servidor, com proveniência; a publicação do PCA segue pela fila.
 */
import { randomUUID } from 'node:crypto';
import { consolidarQuantidadesIrp, formatarData, validarDemandaPca, verificarPrazoIrp } from '@agora/dominio';
import type {
  ConsultaCatalogo,
  IntencaoRegistroPrecos,
  PlanejamentoDfd,
  PlanoContratacoesDetalhe,
  ProcessoDetalhe,
  ResumoPlanoContratacoes,
  SugestoesCatalogo,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DadosEvento } from '../../auditoria/trilha.ts';
import { escopoUasgs, exigir, exigirAlguma, podeVerUasg, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio, semPermissao } from '../../http/erros.ts';
import { centavos, codigoUasg, dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { obterLinhaProcesso, obterProcessoDetalhe } from '../jornada/repositorio.ts';
import { exigirEtapa, gravarJson } from '../jornada/servico.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { consultarCatalogo, itemDoCatalogo, sugerirCodigos } from './catalogo.ts';
import { itemPcaPorId, montarPlanejamentoDfd } from './dfd.ts';
import { adesoesDaIrp, listarIrps, obterIrp, obterLinhaIrp, proximoNumeroIrp } from './irp.ts';
import { detalharPlano, gravarConsolidacao, inserirDemanda, inserirPlano, listarPlanos, obterLinhaPlano, registrarTransicao, type LinhaPlano } from './pca.ts';
import { consultarPcaDaUasg } from './pca-pncp.ts';
import { solicitarPublicacaoPca } from './publicacao.ts';

// ───────────────────────── esquemas ─────────────────────────

const ano = z.number().int().min(2021).max(2999);
const codigoCatalogo = z.string().trim().regex(/^\d{1,9}$/, 'O código do catálogo tem só dígitos (até 9).');
const tipoCatalogo = z.enum(['material', 'servico']);
const CATEGORIAS = [
  'material',
  'servico',
  'obras',
  'servicos_engenharia',
  'solucoes_tic',
  'locacao_imoveis',
  'alienacao_concessao_permissao',
  'obras_servicos_engenharia',
] as const;

const esquemaFiltroPca = z.object({ ano: z.coerce.number().int().min(2021).max(2999).optional(), uasg: codigoUasg.optional() });
const esquemaPlano = z.object({ uasg: codigoUasg, ano });
const esquemaDemanda = z.object({
  unidadeRequisitante: z.string().trim().min(2, 'Informe a unidade requisitante.').max(200),
  descricao: z.string().trim().min(10, 'Descreva o objeto com pelo menos 10 caracteres.').max(2048),
  codigoCatalogo: codigoCatalogo.nullable(),
  tipoCatalogo: tipoCatalogo.nullable(),
  unidadeFornecimento: z.string().trim().min(1, 'Informe a unidade de fornecimento.').max(100),
  quantidade: z.number().positive('A quantidade deve ser maior que zero.').max(1_000_000_000),
  valorUnitario: centavos.positive('O valor unitário deve ser maior que zero.'),
  dataDesejada: dataIso,
  prioridade: z.enum(['baixa', 'media', 'alta']),
  categoria: z.enum(CATEGORIAS),
});
const esquemaDevolucao = z.object({ motivo: z.string().trim().min(20, 'Explique o ajuste pedido com pelo menos 20 caracteres.').max(2000) });
const esquemaVinculo = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('item'), itemId: uuid.transform((v) => v.toLowerCase()) }),
  z.object({
    tipo: z.literal('fora_do_pca'),
    justificativa: z.string().trim().min(30, 'A justificativa da contratação não prevista no PCA precisa de pelo menos 30 caracteres.').max(4000),
  }),
]);
const esquemaEscolha = z.object({
  codigo: codigoCatalogo,
  tipo: tipoCatalogo,
  origem: z.enum(['sugestao', 'busca']),
  pontuacao: z.number().int().min(0).max(100).nullable(),
});
const esquemaIndice = z.object({ id: uuid, indice: z.coerce.number().int().min(1).max(500) });
const esquemaBusca = z.object({ busca: z.string().trim().min(2, 'Digite ao menos 2 caracteres.').max(200), tipo: tipoCatalogo.default('material') });
const esquemaSugestao = z.object({ descricao: z.string().trim().min(3, 'Descreva o item para receber sugestões.').max(2048), tipo: tipoCatalogo.default('material') });
const esquemaIrp = z.object({
  uasgGerenciadora: codigoUasg,
  processoId: uuid.transform((v) => v.toLowerCase()).nullable(),
  objeto: z.string().trim().min(10, 'Descreva o objeto com pelo menos 10 caracteres.').max(2000),
  codigoCatalogo: codigoCatalogo.nullable(),
  unidadeFornecimento: z.string().trim().min(1, 'Informe a unidade de fornecimento.').max(100),
  quantidadeGerenciador: z.number().positive('A quantidade do gerenciador deve ser maior que zero.').max(1_000_000_000),
  abertura: dataIso,
  encerramento: dataIso,
});
const esquemaAdesao = z.object({
  uasg: codigoUasg,
  quantidade: z.number().positive('A quantidade deve ser maior que zero.').max(1_000_000_000),
  manifestacao: z.string().trim().min(10, 'Registre a manifestação de interesse com pelo menos 10 caracteres.').max(2000),
});

interface EventoProcesso {
  acao: string;
  resumo: string;
  dados: DadosEvento;
}

export async function rotasPlanejamento(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leituraPca = { preHandler: exigir('pca:ler') };
  const leituraCatalogo = { preHandler: exigirAlguma(['jornada:ler', 'pca:ler']) };

  async function responderProcesso(request: FastifyRequest, id: string): Promise<ProcessoDetalhe> {
    const detalhe = await obterProcessoDetalhe(ctx.banco, id, escopoUasgs(sessaoDe(request)), ctx.hoje(), await opcoesCalendario(ctx.banco), ctx.relogio());
    if (!detalhe) throw naoEncontrado('Processo não encontrado.');
    return detalhe;
  }

  /** Escrita no processo: trava a linha (escopo de UASG → 404), executa a ação e registra na trilha, numa transação. */
  async function alterarProcesso(request: FastifyRequest, id: string, acao: (tx: Transacao, linha: LinhaProcesso, agora: Date) => Promise<EventoProcesso>): Promise<ProcessoDetalhe> {
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      const evento = await acao(tx, linha, ctx.relogio());
      await auditar(tx, request, {
        acao: `processo.${evento.acao}`,
        recurso: 'processo',
        recursoId: id,
        resumo: evento.resumo,
        dados: { numeroSei: linha.numero_sei, etapa: linha.etapa_atual, ...evento.dados },
      });
    });
    return responderProcesso(request, id);
  }

  async function planoDetalhado(request: FastifyRequest, id: string): Promise<PlanoContratacoesDetalhe> {
    const linha = await obterLinhaPlano(ctx.banco, id, escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Plano de contratações não encontrado.');
    return detalharPlano(ctx.banco, linha);
  }

  /** Escrita no plano: trava a linha no escopo de UASG, executa a ação e registra na trilha. */
  async function alterarPlano(
    request: FastifyRequest,
    acao: (tx: Transacao, plano: LinhaPlano, agora: Date) => Promise<{ acao: string; resumo: string; dados: DadosEvento }>,
  ): Promise<string> {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const plano = await obterLinhaPlano(tx, id, escopo, true);
      if (!plano) throw naoEncontrado('Plano de contratações não encontrado.');
      if (plano.origem === 'pncp') throw regraNegocio('Este plano foi lido do PNCP e não é editado na Ágora.');
      const evento = await acao(tx, plano, ctx.relogio());
      await auditar(tx, request, {
        acao: `pca.${evento.acao}`,
        recurso: 'pca',
        recursoId: id,
        resumo: evento.resumo,
        dados: { uasg: plano.uasg, ano: plano.ano, situacaoAnterior: plano.situacao, ...evento.dados },
      });
    });
    return id;
  }

  // ───────── PCA ─────────

  app.get('/pca', leituraPca, async (request): Promise<ResumoPlanoContratacoes[]> => {
    const f = esquemaFiltroPca.parse(request.query);
    return listarPlanos(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)), ano: f.ano, uasg: f.uasg });
  });

  app.post('/pca', { preHandler: exigir('pca:editar') }, async (request, reply): Promise<PlanoContratacoesDetalhe> => {
    const entrada = esquemaPlano.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, entrada.uasg)) throw regraNegocio('A UASG está fora do seu escopo.', [{ campo: 'uasg', mensagem: 'UASG fora do escopo do usuário' }]);
    const id = await ctx.banco.transacao(async (tx) => {
      const [uasg] = await tx.consultar<{ codigo: string }>('SELECT codigo FROM uasgs WHERE codigo = $1', [entrada.uasg]);
      if (!uasg) throw naoEncontrado('UASG não encontrada.');
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM pca_planos WHERE uasg = $1 AND ano = $2', [entrada.uasg, entrada.ano]);
      if (existente) throw conflito(`A UASG ${entrada.uasg} já tem plano de contratações para ${entrada.ano}.`);
      const novo = await inserirPlano(tx, { uasg: entrada.uasg, ano: entrada.ano, criadoPor: sessao.usuario.id }, ctx.relogio());
      await auditar(tx, request, {
        acao: 'pca.criar',
        recurso: 'pca',
        recursoId: novo,
        resumo: `Abriu a elaboração do plano de contratações anual ${entrada.ano} da UASG ${entrada.uasg}`,
        dados: { uasg: entrada.uasg, ano: entrada.ano },
      });
      return novo;
    });
    reply.status(201);
    return planoDetalhado(request, id);
  });

  app.get('/pca/:id', leituraPca, async (request): Promise<PlanoContratacoesDetalhe> => planoDetalhado(request, idDaRota(request.params)));

  /** Demanda de uma unidade requisitante (Decreto 10.947/2022, art. 8º), com o plano em elaboração. */
  app.post('/pca/:id/demandas', { preHandler: exigir('pca:editar') }, async (request, reply): Promise<PlanoContratacoesDetalhe> => {
    const entrada = esquemaDemanda.parse(request.body);
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      if (plano.situacao !== 'em_elaboracao') throw regraNegocio('Só o plano em elaboração recebe demandas; peça a devolução para ajustes.');
      const pendencias = validarDemandaPca({ id: 'nova', ...entrada }, plano.ano);
      if (pendencias.length > 0) throw regraNegocio('A demanda está incompleta.', pendencias.map((mensagem) => ({ campo: 'demanda', mensagem })));
      const demandaId = await inserirDemanda(tx, plano.id, entrada, sessaoDe(request).usuario.id, agora);
      return {
        acao: 'registrar_demanda',
        resumo: `Registrou demanda no PCA ${plano.ano}: ${entrada.descricao.slice(0, 80)}`,
        dados: { demandaId, codigoCatalogo: entrada.codigoCatalogo, quantidade: entrada.quantidade, valorUnitario: entrada.valorUnitario, prioridade: entrada.prioridade },
      };
    });
    reply.status(201);
    return planoDetalhado(request, id);
  });

  app.delete('/pca/:id/demandas/:demandaId', { preHandler: exigir('pca:editar') }, async (request): Promise<PlanoContratacoesDetalhe> => {
    const demandaId = idDaRota(request.params, 'demandaId');
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      if (plano.situacao !== 'em_elaboracao') throw regraNegocio('Só o plano em elaboração pode ter demandas removidas.');
      const [removida] = await tx.consultar<{ descricao: string }>('DELETE FROM pca_demandas WHERE id = $1 AND plano_id = $2 RETURNING descricao', [demandaId, plano.id]);
      if (!removida) throw naoEncontrado('Demanda não encontrada no plano.');
      await tx.executar('UPDATE pca_planos SET atualizado_em = $2 WHERE id = $1', [plano.id, agora.toISOString()]);
      return { acao: 'remover_demanda', resumo: `Removeu demanda do PCA ${plano.ano}: ${removida.descricao.slice(0, 80)}`, dados: { demandaId } };
    });
    return planoDetalhado(request, id);
  });

  /** Consolidação pelo setor de contratações (Decreto 10.947/2022, art. 11). */
  app.post('/pca/:id/consolidar', { preHandler: exigir('pca:editar') }, async (request): Promise<PlanoContratacoesDetalhe> => {
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      const r = await gravarConsolidacao(tx, plano, sessaoDe(request).usuario.id, agora);
      return {
        acao: 'consolidar',
        resumo: `Consolidou o PCA ${plano.ano}: ${r.totalDemandas} demandas em ${r.itens.length} itens`,
        dados: { demandas: r.totalDemandas, itens: r.itens.length, demandasAgregadas: r.demandasAgregadas, valorTotal: r.valorTotal, fundamento: r.fundamento },
      };
    });
    return planoDetalhado(request, id);
  });

  /** Devolução para ajustes pela autoridade competente (Decreto 10.947/2022, art. 12, § 1º). */
  app.post('/pca/:id/devolver', { preHandler: exigir('pca:aprovar') }, async (request): Promise<PlanoContratacoesDetalhe> => {
    const { motivo } = esquemaDevolucao.parse(request.body);
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      await registrarTransicao(tx, plano, 'devolver', { usuarioId: sessaoDe(request).usuario.id, motivo }, agora);
      return { acao: 'devolver', resumo: `Devolveu o PCA ${plano.ano} para ajustes`, dados: { motivo } };
    });
    return planoDetalhado(request, id);
  });

  /**
   * Aprovação pela autoridade competente (Decreto 10.947/2022, art. 12): quem consolidou não aprova (segregação de
   * funções, art. 7º, § 1º). O plano aprovado vai para o PNCP pela fila de integrações (art. 12, § 2º).
   */
  app.post('/pca/:id/aprovar', { preHandler: exigir('pca:aprovar') }, async (request): Promise<PlanoContratacoesDetalhe> => {
    const sessao = sessaoDe(request);
    const enviadas: LinhaTarefa[] = [];
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      if (plano.consolidado_por === sessao.usuario.id) {
        throw regraNegocio('Quem consolidou o plano não pode aprová-lo: a aprovação cabe a outra autoridade (segregação de funções).', [
          { campo: 'RF-31', mensagem: 'Segregação entre consolidação e aprovação do PCA' },
        ]);
      }
      if (plano.situacao !== 'consolidado') throw regraNegocio('Só o plano consolidado pode ser aprovado.');
      const pedido = await solicitarPublicacaoPca(tx, app.fila, plano, sessao.usuario.id, agora);
      enviadas.push(pedido.tarefa);
      await registrarTransicao(tx, plano, 'aprovar', { usuarioId: sessao.usuario.id, tarefaId: pedido.tarefa.id }, agora);
      return {
        acao: 'aprovar',
        resumo: `Aprovou o PCA ${plano.ano} da UASG ${plano.uasg} e enviou para publicação no PNCP pela fila de integrações`,
        dados: { itens: plano.itens, valorTotal: plano.valor_total, tarefaId: pedido.tarefa.id, fila: app.fila.driver.transporte, modo: ctx.config.integracoes },
      };
    });
    await app.fila.despachar(enviadas);
    const [tarefa] = enviadas;
    if (tarefa) await app.fila.aguardar(tarefa.id);
    return planoDetalhado(request, id);
  });

  /** Reenvio ao PNCP do plano aprovado cuja publicação foi para a fila de erro (reprocessamento auditado). */
  app.post('/pca/:id/publicar', { preHandler: exigir('pca:aprovar') }, async (request): Promise<PlanoContratacoesDetalhe> => {
    const sessao = sessaoDe(request);
    const enviadas: LinhaTarefa[] = [];
    const id = await alterarPlano(request, async (tx, plano, agora) => {
      if (plano.situacao !== 'aprovado') throw regraNegocio(plano.situacao === 'publicado' ? 'O plano já foi publicado no PNCP.' : 'Só o plano aprovado pode ser publicado no PNCP.');
      const pedido = await solicitarPublicacaoPca(tx, app.fila, plano, sessao.usuario.id, agora);
      if (!pedido.nova && !pedido.reaberta) throw regraNegocio('O plano já está na fila de publicação do PNCP.');
      enviadas.push(pedido.tarefa);
      await tx.executar('UPDATE pca_planos SET tarefa_publicacao_id = $2, atualizado_em = $3 WHERE id = $1', [plano.id, pedido.tarefa.id, agora.toISOString()]);
      return {
        acao: 'publicar',
        resumo: pedido.reaberta ? `Reenviou ao PNCP o PCA ${plano.ano} que estava na fila de erro` : `Enviou o PCA ${plano.ano} para publicação no PNCP`,
        dados: { tarefaId: pedido.tarefa.id, reprocessada: pedido.reaberta, modo: ctx.config.integracoes },
      };
    });
    await app.fila.despachar(enviadas);
    const [tarefa] = enviadas;
    if (tarefa) await app.fila.aguardar(tarefa.id);
    return planoDetalhado(request, id);
  });

  // ───────── DFD: PCA e catálogo ─────────

  app.get('/processos/:id/pca', { preHandler: exigir('jornada:ler') }, async (request): Promise<PlanejamentoDfd> => {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return montarPlanejamentoDfd(ctx.banco, linha, ctx.hoje());
  });

  /** Conferência do DFD com o PCA publicado (art. 18, § 1º, II): o item do plano ou a justificativa da demanda fora dele. */
  app.put('/processos/:id/pca', { preHandler: exigir('jornada:editar') }, async (request): Promise<ProcessoDetalhe> => {
    const entrada = esquemaVinculo.parse(request.body);
    const sessao = sessaoDe(request);
    return alterarProcesso(request, idDaRota(request.params), async (tx, linha, agora) => {
      exigirEtapa(linha, 1, 'O vínculo do DFD com o PCA');
      let dados: DadosEvento;
      let resumo: string;
      if (entrada.tipo === 'item') {
        const encontrado = await itemPcaPorId(tx, entrada.itemId);
        if (!encontrado) throw naoEncontrado('Item do PCA não encontrado.');
        if (!encontrado.publicado) throw regraNegocio('O item pertence a um PCA ainda não publicado: aponte um item do plano publicado.');
        if (encontrado.item.uasg !== linha.uasg) throw regraNegocio(`O item ${encontrado.item.identificador} é do PCA de outra UASG.`);
        await tx.executar(
          `INSERT INTO dfd_vinculos_pca (processo_id, pca_item_id, justificativa_fora_pca, registrado_por, registrado_em)
           VALUES ($1, $2, NULL, $3, $4)
           ON CONFLICT (processo_id) DO UPDATE SET pca_item_id = EXCLUDED.pca_item_id, justificativa_fora_pca = NULL,
                                                   registrado_por = EXCLUDED.registrado_por, registrado_em = EXCLUDED.registrado_em`,
          [linha.id, encontrado.item.id, sessao.usuario.id, agora.toISOString()],
        );
        resumo = `Apontou no DFD o item ${encontrado.item.identificador} do PCA publicado`;
        dados = { tipo: 'item', itemPca: encontrado.item.identificador, idPcaPncp: encontrado.item.idPcaPncp };
      } else {
        await tx.executar(
          `INSERT INTO dfd_vinculos_pca (processo_id, pca_item_id, justificativa_fora_pca, registrado_por, registrado_em)
           VALUES ($1, NULL, $2, $3, $4)
           ON CONFLICT (processo_id) DO UPDATE SET pca_item_id = NULL, justificativa_fora_pca = EXCLUDED.justificativa_fora_pca,
                                                   registrado_por = EXCLUDED.registrado_por, registrado_em = EXCLUDED.registrado_em`,
          [linha.id, entrada.justificativa, sessao.usuario.id, agora.toISOString()],
        );
        resumo = 'Registrou no DFD a justificativa da contratação não prevista no PCA';
        dados = { tipo: 'fora_do_pca', caracteresJustificativa: entrada.justificativa.length };
      }
      // A marcação "prevista no PCA" do DFD acompanha o vínculo registrado.
      await gravarJson(tx, linha.id, 'dfd', { ...linha.dfd, previstoNoPca: entrada.tipo === 'item' }, agora);
      return { acao: 'dfd.pca', resumo, dados };
    });
  });

  /** Consulta do PCA publicado no PNCP para a UASG do processo, pelo conector do servidor (offline: carga sintética). */
  app.post('/processos/:id/pca/consultar', { preHandler: exigir('jornada:editar') }, async (request): Promise<PlanejamentoDfd> => {
    const sessao = sessaoDe(request);
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessao));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    const exercicio = Number(ctx.hoje().slice(0, 4));
    await consultarPcaDaUasg(ctx, { uasg: linha.uasg, anos: [exercicio, exercicio + 1], usuarioId: sessao.usuario.id, ipHash: request.ipHash || null });
    return montarPlanejamentoDfd(ctx.banco, linha, ctx.hoje());
  });

  /** Escolha do código do catálogo de um item do DFD (RIA-13: decisão do agente, registrada na trilha). */
  app.put('/processos/:id/dfd/itens/:indice/catalogo', { preHandler: exigir('jornada:editar') }, async (request): Promise<ProcessoDetalhe> => {
    const { id, indice } = esquemaIndice.parse(request.params);
    const entrada = esquemaEscolha.parse(request.body);
    return alterarProcesso(request, id.toLowerCase(), async (tx, linha, agora) => {
      exigirEtapa(linha, 1, 'A escolha do código do catálogo');
      const item = linha.dfd.itens[indice - 1];
      if (!item) throw naoEncontrado(`O DFD não tem o item ${indice}.`);
      const catalogo = await itemDoCatalogo(tx, entrada.tipo, entrada.codigo);
      if (!catalogo) throw regraNegocio(`O código ${entrada.codigo} não foi encontrado no catálogo: consulte o catálogo antes de escolher.`);
      if (!catalogo.ativo) throw regraNegocio(`O código ${entrada.codigo} está inativo no catálogo.`);
      const itens = linha.dfd.itens.map((i, n) => (n === indice - 1 ? { ...i, catmat: entrada.codigo } : i));
      await gravarJson(tx, linha.id, 'dfd', { ...linha.dfd, itens }, agora);
      return {
        acao: 'dfd.catalogo',
        resumo: `Escolheu o código ${entrada.codigo} do catálogo para o item ${indice} do DFD${entrada.origem === 'sugestao' ? ' (sugestão RIA-13 conferida pelo agente)' : ''}`,
        dados: {
          item: indice,
          codigoAnterior: item.catmat,
          codigo: entrada.codigo,
          tipo: entrada.tipo,
          origem: entrada.origem,
          pontuacao: entrada.pontuacao,
          regra: 'RIA-13',
          decisao: 'humana',
        },
      };
    });
  });

  app.get('/catalogo/itens', leituraCatalogo, async (request): Promise<ConsultaCatalogo> => {
    const f = esquemaBusca.parse(request.query);
    return consultarCatalogo(ctx, { tipo: f.tipo, busca: f.busca, usuarioId: sessaoDe(request).usuario.id, ipHash: request.ipHash || null });
  });

  app.get('/catalogo/sugestoes', leituraCatalogo, async (request): Promise<SugestoesCatalogo> => {
    const f = esquemaSugestao.parse(request.query);
    return sugerirCodigos(ctx, { tipo: f.tipo, descricao: f.descricao, usuarioId: sessaoDe(request).usuario.id, ipHash: request.ipHash || null });
  });

  // ───────── IRP ─────────

  async function irpOuErro(id: string): Promise<IntencaoRegistroPrecos> {
    const irp = await obterIrp(ctx.banco, id, ctx.hoje());
    if (!irp) throw naoEncontrado('Intenção de registro de preços não encontrada.');
    return irp;
  }

  app.get('/irps', leituraPca, async (): Promise<IntencaoRegistroPrecos[]> => listarIrps(ctx.banco, ctx.hoje()));

  app.get('/irps/:id', leituraPca, async (request): Promise<IntencaoRegistroPrecos> => irpOuErro(idDaRota(request.params)));

  /** Abertura da IRP pelo órgão gerenciador (art. 86): pelo menos 8 dias úteis (RN-38), contados no servidor. */
  app.post('/irps', { preHandler: exigir('irp:gerenciar') }, async (request, reply): Promise<IntencaoRegistroPrecos> => {
    const entrada = esquemaIrp.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, entrada.uasgGerenciadora)) {
      throw regraNegocio('A UASG gerenciadora está fora do seu escopo.', [{ campo: 'uasgGerenciadora', mensagem: 'UASG fora do escopo do usuário' }]);
    }
    const hoje = ctx.hoje();
    const prazo = verificarPrazoIrp({ abertura: entrada.abertura, encerramento: entrada.encerramento, hoje }, await opcoesCalendario(ctx.banco));
    if (!prazo.valido) {
      throw regraNegocio(prazo.pendencias[0] ?? 'Prazo da intenção de registro de preços inválido.', prazo.pendencias.map((mensagem) => ({ campo: 'RN-38', mensagem })));
    }
    const id = randomUUID();
    await ctx.banco.transacao(async (tx) => {
      if (entrada.processoId !== null) {
        const processo = await obterLinhaProcesso(tx, entrada.processoId, escopoUasgs(sessao));
        if (!processo) throw naoEncontrado('Processo não encontrado.');
        if (processo.uasg !== entrada.uasgGerenciadora) throw regraNegocio('A UASG gerenciadora da IRP deve ser a UASG do processo.');
      }
      const numero = await proximoNumeroIrp(tx, entrada.abertura.slice(0, 4));
      await tx.executar(
        `INSERT INTO irps (id, numero, uasg_gerenciadora, processo_id, objeto, codigo_catalogo, unidade_fornecimento, quantidade_gerenciador,
                           abertura, encerramento, dias_uteis, criada_por, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          numero,
          entrada.uasgGerenciadora,
          entrada.processoId,
          entrada.objeto,
          entrada.codigoCatalogo,
          entrada.unidadeFornecimento,
          entrada.quantidadeGerenciador,
          entrada.abertura,
          entrada.encerramento,
          prazo.diasUteis,
          sessao.usuario.id,
          ctx.relogio().toISOString(),
        ],
      );
      await auditar(tx, request, {
        acao: 'irp.abrir',
        recurso: 'irp',
        recursoId: id,
        resumo: `Abriu a intenção de registro de preços ${numero} (UASG ${entrada.uasgGerenciadora}) de ${formatarData(entrada.abertura)} a ${formatarData(entrada.encerramento)}`,
        dados: {
          numero,
          processoId: entrada.processoId,
          codigoCatalogo: entrada.codigoCatalogo,
          quantidadeGerenciador: entrada.quantidadeGerenciador,
          abertura: entrada.abertura,
          encerramento: entrada.encerramento,
          diasUteis: prazo.diasUteis,
          fundamento: prazo.fundamento,
        },
      });
    });
    reply.status(201);
    return irpOuErro(id);
  });

  /** Adesão de uma UASG participante, enquanto a IRP está aberta (art. 86; Decreto 11.462/2023, art. 9º). */
  app.post('/irps/:id/adesoes', { preHandler: exigir('irp:aderir') }, async (request, reply): Promise<IntencaoRegistroPrecos> => {
    const id = idDaRota(request.params);
    const entrada = esquemaAdesao.parse(request.body);
    const sessao = sessaoDe(request);
    if (!podeVerUasg(sessao, entrada.uasg)) throw semPermissao('A UASG participante está fora do seu escopo.');
    await ctx.banco.transacao(async (tx) => {
      const irp = await obterLinhaIrp(tx, id, true);
      if (!irp) throw naoEncontrado('Intenção de registro de preços não encontrada.');
      const atual = await obterIrp(tx, id, ctx.hoje());
      if (atual?.situacao !== 'aberta') {
        throw regraNegocio(`A intenção de registro de preços ${irp.numero} não está aberta: as adesões são aceitas de ${formatarData(irp.abertura)} a ${formatarData(irp.encerramento)}.`, [
          { campo: 'RN-38', mensagem: 'Adesão fora do período da IRP' },
        ]);
      }
      if (entrada.uasg === irp.uasg_gerenciadora) throw regraNegocio('A UASG gerenciadora não adere à própria intenção de registro de preços.');
      const anterior = (await adesoesDaIrp(tx, id)).find((a) => a.uasg === entrada.uasg);
      await tx.executar(
        `INSERT INTO irp_adesoes (id, irp_id, uasg, quantidade, manifestacao, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (irp_id, uasg) DO UPDATE SET quantidade = EXCLUDED.quantidade, manifestacao = EXCLUDED.manifestacao,
                                                 registrada_por = EXCLUDED.registrada_por, registrada_em = EXCLUDED.registrada_em`,
        [randomUUID(), id, entrada.uasg, entrada.quantidade, entrada.manifestacao, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'irp.aderir',
        recurso: 'irp',
        recursoId: id,
        resumo: `${anterior ? 'Retificou a adesão' : 'Registrou a adesão'} da UASG ${entrada.uasg} à intenção de registro de preços ${irp.numero}: ${entrada.quantidade.toLocaleString('pt-BR')} ${irp.unidade_fornecimento}`,
        dados: { numero: irp.numero, uasg: entrada.uasg, quantidade: entrada.quantidade, quantidadeAnterior: anterior?.quantidade ?? null },
      });
    });
    reply.status(201);
    return irpOuErro(id);
  });

  /** Consolidação das quantidades pelo gerenciador, depois do encerramento (art. 86, caput). */
  app.post('/irps/:id/consolidar', { preHandler: exigir('irp:gerenciar') }, async (request): Promise<IntencaoRegistroPrecos> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      const irp = await obterLinhaIrp(tx, id, true);
      if (!irp) throw naoEncontrado('Intenção de registro de preços não encontrada.');
      if (!podeVerUasg(sessao, irp.uasg_gerenciadora)) throw semPermissao('A UASG gerenciadora está fora do seu escopo.');
      if (irp.consolidada_em !== null) throw regraNegocio('As quantidades desta intenção de registro de preços já foram consolidadas.');
      if (ctx.hoje() <= irp.encerramento) {
        throw regraNegocio(`A consolidação só pode ser feita depois do encerramento da IRP, em ${formatarData(irp.encerramento)}.`, [
          { campo: 'RN-38', mensagem: 'IRP ainda aberta para adesões' },
        ]);
      }
      const adesoes = await adesoesDaIrp(tx, id);
      const consolidacao = consolidarQuantidadesIrp(
        { uasg: irp.uasg_gerenciadora, quantidade: irp.quantidade_gerenciador },
        adesoes.map((a) => ({ uasg: a.uasg, quantidade: a.quantidade })),
      );
      const agora = ctx.relogio().toISOString();
      await tx.executar('UPDATE irps SET consolidacao = $2::jsonb, consolidada_por = $3, consolidada_em = $4 WHERE id = $1', [
        id,
        JSON.stringify({ quantidadeTotal: consolidacao.quantidadeTotal, participantes: consolidacao.participantes }),
        sessao.usuario.id,
        agora,
      ]);
      await auditar(tx, request, {
        acao: 'irp.consolidar',
        recurso: 'irp',
        recursoId: id,
        resumo: `Consolidou as quantidades da intenção de registro de preços ${irp.numero}: ${consolidacao.quantidadeTotal.toLocaleString('pt-BR')} ${irp.unidade_fornecimento} de ${consolidacao.participantes.length} unidades`,
        dados: { numero: irp.numero, quantidadeTotal: consolidacao.quantidadeTotal, participantes: consolidacao.participantes, fundamento: consolidacao.fundamento },
      });
    });
    return irpOuErro(id);
  });
}
