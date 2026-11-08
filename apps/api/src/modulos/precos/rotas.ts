/**
 * Rotas da pesquisa de preços automatizada (RF-25) e da projeção do valor estimado (RIA-11).
 * As fontes externas são chamadas só aqui, no servidor; o escopo de UASG do processo é conferido em toda rota,
 * e toda escrita grava evento na trilha de auditoria na mesma transação.
 */
import { createHash, randomUUID } from 'node:crypto';
import { projetarValorEstimado } from '@agora/dominio';
import type {
  ConsultaPrecos,
  PesquisaPrecosProcesso,
  ProcessoDetalhe,
  ProjecaoValorEstimado,
  ResultadoImportacaoReferencias,
  SerieIndiceProjecao,
  TabelaReferenciaEngenharia,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { obterSeriesProjecao } from '../../integracoes/precos/indices.ts';
import { gravarLoteReferencias, listarTabelasEngenharia } from '../../integracoes/precos/referencias-engenharia.ts';
import { MAXIMO_COTACOES_CESTA } from '../jornada/importacao-cesta.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import { obterLinhaProcesso, obterProcessoDetalhe } from '../jornada/repositorio.ts';
import { exigirEtapaAte, gravarJson } from '../jornada/servico.ts';
import type { CestaArmazenada, CotacaoArmazenada, LinhaProcesso } from '../jornada/tipos.ts';
import { lerTabelaReferencia, MAXIMO_CARACTERES_REFERENCIA } from './importacao-referencias.ts';
import {
  contextoColeta,
  gravarConsulta,
  gravarProjecao,
  itemReferencia,
  marcarSugestoesIncluidas,
  montarPesquisa,
  obterConsulta,
  pedidoDoProcesso,
  pesquisarPrecos,
} from './servico.ts';

const esquemaConsulta = z.object({
  termo: z.string().trim().min(3, 'Informe ao menos 3 caracteres').max(120).optional(),
  catmat: z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, 'Informe o código CATMAT/CATSER só com números')
    .nullable()
    .optional(),
});

const esquemaIncluir = z.object({ sugestoes: z.array(uuid).min(1, 'Escolha ao menos uma sugestão').max(20) });

const esquemaProjecao = z.object({
  dataPrevista: dataIso,
  percentualCambial: z
    .number()
    .min(0)
    .max(100)
    .transform((v) => Math.round(v * 100) / 100),
});

const esquemaImportacaoReferencias = z.object({
  sistema: z.enum(['SINAPI', 'SICRO']),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF com 2 letras'),
  dataBase: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use o mês de referência no formato AAAA-MM'),
  desonerado: z.boolean(),
  conteudo: z.string().min(1).max(MAXIMO_CARACTERES_REFERENCIA),
});

/** A pesquisa e a projeção pertencem à etapa 3 (ETP, riscos e preços), como a cesta. */
const ETAPA_PRECOS = 3;

export async function rotasPesquisaPrecos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('jornada:ler') };
  const edicao = { preHandler: exigir('jornada:editar') };
  const importacao = { preHandler: exigir('integracoes:executar') };

  async function linhaNoEscopo(request: FastifyRequest): Promise<LinhaProcesso> {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return linha;
  }

  /** Trava o processo no escopo do usuário dentro da transação (404 fora do escopo). */
  async function travar(tx: Transacao, request: FastifyRequest, id: string): Promise<LinhaProcesso> {
    const linha = await obterLinhaProcesso(tx, id, escopoUasgs(sessaoDe(request)), true);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return linha;
  }

  app.get('/processos/:id/pesquisa-precos', leitura, async (request): Promise<PesquisaPrecosProcesso> =>
    montarPesquisa(ctx.banco, await linhaNoEscopo(request), ctx.config.integracoes),
  );

  // RF-25: consulta combinada das fontes oficiais. A rede é chamada fora da transação; o registro, dentro.
  app.post('/processos/:id/pesquisa-precos/consultas', edicao, async (request, reply): Promise<ConsultaPrecos> => {
    const entrada = esquemaConsulta.parse(request.body ?? {});
    const linha = await linhaNoEscopo(request);
    exigirEtapaAte(linha, ETAPA_PRECOS, 'A pesquisa de preços');
    const item = itemReferencia(linha);
    if (!item) throw regraNegocio('Inclua ao menos um item no DFD: a pesquisa de preços procura o item de referência da cesta (item 1).');
    const sessao = sessaoDe(request);
    const pedido = pedidoDoProcesso(linha, item, entrada);
    const { consulta, hashConteudo } = await pesquisarPrecos(contextoColeta(ctx), ctx.config.integracoes, linha, item, pedido, sessao.usuario.nome);
    await ctx.banco.transacao(async (tx) => {
      const atual = await travar(tx, request, linha.id);
      await gravarConsulta(tx, atual.id, consulta, hashConteudo, sessao.usuario.id);
      await auditar(tx, request, {
        acao: 'processo.precos.consultar',
        recurso: 'processo',
        recursoId: atual.id,
        resumo: `Consultou as fontes oficiais de preços para o item 1 (${consulta.sugestoes.length} sugestão(ões))`,
        dados: {
          numeroSei: atual.numero_sei,
          etapa: atual.etapa_atual,
          consultaId: consulta.id,
          termo: consulta.termo,
          catmat: pedido.catmat,
          modo: consulta.modo,
          hashConteudo,
          fontes: consulta.fontes.map((f) => ({ fonte: f.fonte, situacao: f.situacao, modo: f.modo, registros: f.registros, hashConteudo: f.hashConteudo })),
          sugestoes: consulta.sugestoes.length,
          descartadas: consulta.descartadas.length,
        },
      });
    });
    reply.code(201);
    return consulta;
  });

  // Inclusão das sugestões escolhidas pelo agente na cesta (as cotações levam fonte, data, inciso e registro na fonte).
  app.post('/processos/:id/pesquisa-precos/consultas/:consultaId/incluir', edicao, async (request): Promise<ProcessoDetalhe> => {
    const entrada = esquemaIncluir.parse(request.body);
    const id = idDaRota(request.params);
    const consultaId = idDaRota(request.params, 'consultaId');
    const agora = ctx.relogio();
    await ctx.banco.transacao(async (tx) => {
      const linha = await travar(tx, request, id);
      exigirEtapaAte(linha, ETAPA_PRECOS, 'A pesquisa de preços');
      const consulta = await obterConsulta(tx, linha.id, consultaId, true);
      if (!consulta) throw naoEncontrado('Consulta de preços não encontrada.');
      const pedidas = new Set(entrada.sugestoes.map((s) => s.toLowerCase()));
      const indisponiveis = [...pedidas].filter((s) => !consulta.sugestoes.some((x) => x.id === s && x.cotacaoId === null));
      if (indisponiveis.length > 0) {
        throw regraNegocio(
          'Há sugestões inexistentes ou já incluídas na cesta.',
          indisponiveis.map((s) => ({ campo: 'sugestoes', mensagem: `Sugestão ${s} indisponível` })),
        );
      }
      const total = linha.cesta.cotacoes.length + pedidas.size;
      if (total > MAXIMO_COTACOES_CESTA) {
        throw regraNegocio(`Com esta inclusão a cesta teria ${total} cotações; o limite é ${MAXIMO_COTACOES_CESTA}.`);
      }
      const incluidaEm = agora.toISOString();
      const novas: CotacaoArmazenada[] = [];
      const sugestoes = consulta.sugestoes.map((s) => {
        if (!pedidas.has(s.id)) return s;
        const cotacao: CotacaoArmazenada = {
          id: randomUUID(),
          fonte: s.fonteCotacao,
          descricaoFonte: s.descricaoFonte,
          valorUnitario: s.valorUnitario,
          dataCotacao: s.data,
          expurgada: false,
          motivoExpurgo: null,
        };
        novas.push(cotacao);
        return { ...s, cotacaoId: cotacao.id, incluidaEm };
      });
      const cesta: CestaArmazenada = { ...linha.cesta, cotacoes: [...linha.cesta.cotacoes, ...novas] };
      await gravarJson(tx, linha.id, 'cesta', cesta, agora);
      await marcarSugestoesIncluidas(tx, consulta.id, sugestoes);
      const analise = analisarCesta(cesta, ctx.hoje());
      await auditar(tx, request, {
        acao: 'processo.cesta.incluir_sugestoes',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Incluiu na cesta ${novas.length} preço(s) da consulta automática às fontes oficiais`,
        dados: {
          numeroSei: linha.numero_sei,
          etapa: linha.etapa_atual,
          consultaId: consulta.id,
          incluidas: sugestoes
            .filter((s) => pedidas.has(s.id))
            .map((s) => ({ sugestaoId: s.id, cotacaoId: s.cotacaoId, fonte: s.fonte, inciso: s.inciso, identificador: s.identificador, valorUnitario: s.valorUnitario, data: s.data })),
          cotacoes: cesta.cotacoes.length,
          valorEstimadoUnitario: analise?.valorEstimado ?? null,
        },
      });
    });
    const calendario = await opcoesCalendario(ctx.banco);
    const detalhe = await obterProcessoDetalhe(ctx.banco, id, escopoUasgs(sessaoDe(request)), ctx.hoje(), calendario, ctx.relogio());
    if (!detalhe) throw naoEncontrado('Processo não encontrado.');
    return detalhe;
  });

  // RIA-11: projeção do valor estimado até a data prevista da contratação. Sinal: não altera a cesta nem o valor.
  app.post('/processos/:id/pesquisa-precos/projecao', edicao, async (request, reply): Promise<ProjecaoValorEstimado> => {
    const entrada = esquemaProjecao.parse(request.body);
    const linha = await linhaNoEscopo(request);
    exigirEtapaAte(linha, ETAPA_PRECOS, 'A projeção do valor estimado');
    const hoje = ctx.hoje();
    const analise = analisarCesta(linha.cesta, hoje);
    const valorBase = valorEstimadoProcesso(linha.dfd, analise);
    if (valorBase === null || valorBase <= 0) {
      throw regraNegocio('O processo ainda não tem valor estimado: inclua os itens no DFD e as cotações na cesta antes de projetar.');
    }
    const coleta = contextoColeta(ctx);
    const series = await obterSeriesProjecao(coleta, ctx.config.integracoes, entrada.percentualCambial > 0);
    if (!series.ipca) throw regraNegocio('A série oficial do IPCA não está disponível no servidor. Execute a projeção com as integrações online ou carregue os índices.');
    if (entrada.percentualCambial > 0 && !series.cambio) {
      throw regraNegocio('A série oficial do câmbio não está disponível no servidor. Informe 0% de parcela cambial ou carregue os índices.');
    }
    const projetar = (valor: number) =>
      projetarValorEstimado({
        valorBase: valor,
        dataBase: hoje,
        dataPrevista: entrada.dataPrevista,
        ipca: series.ipca?.competencias ?? [],
        ...(series.cambio ? { cambio: series.cambio.competencias } : {}),
        percentualCambial: entrada.percentualCambial,
      });
    const resultado = projetar(valorBase);
    const valorUnitarioBase = analise && analise.valorEstimado > 0 ? analise.valorEstimado : null;
    const sessao = sessaoDe(request);
    const fontes: SerieIndiceProjecao[] = [series.ipca, ...(series.cambio ? [series.cambio] : [])];
    const projecao: ProjecaoValorEstimado = {
      id: randomUUID(),
      dataBase: hoje,
      dataPrevista: entrada.dataPrevista,
      percentualCambial: entrada.percentualCambial,
      valorBase,
      valorProjetado: resultado.valorProjetado,
      faixa: resultado.faixa,
      valorUnitarioBase,
      valorUnitarioProjetado: valorUnitarioBase === null ? null : projetar(valorUnitarioBase).valorProjetado,
      variacaoPercentual: resultado.variacaoPercentual,
      meses: resultado.meses,
      inflacao: resultado.inflacao,
      cambio: resultado.cambio,
      sinal: resultado.sinal,
      premissas: [
        ...resultado.premissas,
        ...fontes.filter((f) => f.modo === 'offline').map((f) => `${f.nome}: série sintética de demonstração (modo offline), não é o índice oficial.`),
        ...series.avisos,
      ],
      memoriaCalculo: resultado.memoriaCalculo,
      fontes,
      fundamento: resultado.fundamento,
      aviso: resultado.aviso,
      geradaEm: coleta.agora.toISOString(),
      geradaPor: sessao.usuario.nome,
    };
    await ctx.banco.transacao(async (tx) => {
      const atual = await travar(tx, request, linha.id);
      await gravarProjecao(tx, atual.id, projecao, sessao.usuario.id);
      await auditar(tx, request, {
        acao: 'processo.precos.projetar',
        recurso: 'processo',
        recursoId: atual.id,
        resumo: `Projetou o valor estimado até ${entrada.dataPrevista.split('-').reverse().join('/')} (variação de ${projecao.variacaoPercentual}%)`,
        dados: {
          numeroSei: atual.numero_sei,
          etapa: atual.etapa_atual,
          projecaoId: projecao.id,
          dataPrevista: projecao.dataPrevista,
          percentualCambial: projecao.percentualCambial,
          valorBase,
          valorProjetado: projecao.valorProjetado,
          sinal: projecao.sinal.nivel,
          fontes: fontes.map((f) => ({ serie: f.serie, modo: f.modo, consultadoEm: f.consultadoEm, hashConteudo: f.hashConteudo })),
        },
      });
    });
    reply.code(201);
    return projecao;
  });

  app.get('/pesquisa-precos/referencias-engenharia', leitura, async (): Promise<TabelaReferenciaEngenharia[]> => listarTabelasEngenharia(ctx.banco));

  // Sinapi e Sicro não têm API pública: a tabela oficial é importada no servidor, por lote (sistema, UF, data-base, desoneração).
  app.post('/pesquisa-precos/referencias-engenharia/importacao', importacao, async (request): Promise<ResultadoImportacaoReferencias> => {
    const entrada = esquemaImportacaoReferencias.parse(request.body);
    const { linhas, erros } = lerTabelaReferencia(entrada.conteudo);
    if (erros.length > 0) throw regraNegocio('A tabela tem erros. Corrija as linhas indicadas e importe de novo.', erros);
    const hashConteudo = createHash('sha256').update(entrada.conteudo).digest('hex');
    return ctx.banco.transacao(async (tx) => {
      const resultado = await gravarLoteReferencias(
        tx,
        {
          sistema: entrada.sistema,
          uf: entrada.uf,
          dataBase: entrada.dataBase,
          desonerado: entrada.desonerado,
          hashConteudo,
          importadoPor: sessaoDe(request).usuario.id,
          importadoEm: ctx.relogio().toISOString(),
        },
        linhas,
      );
      await auditar(tx, request, {
        acao: 'precos.referencias.importar',
        recurso: 'referencias_engenharia',
        recursoId: `${entrada.sistema}-${entrada.uf}-${entrada.dataBase}${entrada.desonerado ? '-desonerado' : ''}`,
        resumo: `Importou a tabela do ${entrada.sistema} (${entrada.uf}, data-base ${entrada.dataBase}) com ${linhas.length} composição(ões)`,
        dados: { ...resultado.tabela, substituidos: resultado.substituidos },
      });
      return resultado;
    });
  });
}
