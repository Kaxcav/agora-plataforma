import { randomUUID } from 'node:crypto';
import { INCISOS_ETP, type IncisoEtp } from '@agora/dominio';
import type { EtapaJornada, Pagina, ProcessoDetalhe, ProcessoResumo, UsuarioDesignavel } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, exigirAlguma, exigirPermissaoNoHandler, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import type { DadosEvento } from '../../auditoria/trilha.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { camposPaginacao, centavos, codigoUasg, dataIso, idDaRota, pagina, textoBusca, uuid } from '../../http/validacao.ts';
import { criarProvedorIa } from '../../ia/provedor.ts';
import { avaliarRegularidade } from '../fornecedores/repositorio.ts';
import {
  DFD_INICIAL,
  DISPUTA_INICIAL,
  EDITAL_PADRAO,
  ITENS_PARECER,
  modalidadeSugerida,
  PAPEIS_PROCESSO,
  parecerInicial,
  PUBLICACAO_INICIAL,
  TIPOS_DOCUMENTO,
  TITULOS_ETAPA,
} from './constantes.ts';
import { geradoComParametrosAnteriores } from './parametros-edital.ts';
import {
  avaliarProcesso,
  carregarProcesso,
  listarLinhasProcessos,
  montarResumo,
  obterLinhaProcesso,
  obterProcessoDetalhe,
  primeiroClassificado,
} from './repositorio.ts';
import { analisarCesta, avaliarSegregacao } from './regras.ts';
import {
  aprovarDocumento,
  assinarNaArvore,
  avancarEtapa,
  carregarDesignaveis,
  cnpjDoOrgao,
  criarContratoDoProcesso,
  definirModalidade,
  exigirEtapa,
  exigirEtapaAte,
  exigirEtapaDocumento,
  gravarEquipe,
  gravarJson,
  inserirDocumento,
  inserirProcesso,
  listarDesignaveis,
  montarDisputa,
  obterDocumentoParaAprovar,
  prepararDocumento,
  publicarOffline,
  tipoDocumentoDaArvore,
  type ContextoJornada,
} from './servico.ts';
import type { CestaArmazenada, CotacaoArmazenada, LinhaProcesso, ParametrosEdital, TipoDocumento } from './tipos.ts';

// ───────────────────────── esquemas ─────────────────────────

const ORGAOS = ['PF', 'PRF', 'SENASP', 'SENAPPEN', 'MJSP'] as const;
const TIPOS_OBJETO = ['bens', 'servicos_comuns', 'servicos_especiais', 'obras_servicos_engenharia_comuns', 'obras_servicos_engenharia_especiais'] as const;
const FONTES_COTACAO = ['painel_precos', 'contratacao_similar', 'midia_especializada', 'fornecedor_direto', 'nota_fiscal'] as const;
const INCISOS = INCISOS_ETP.map((i) => i.inciso) as [IncisoEtp, ...IncisoEtp[]];
const textoLongo = z.string().max(20_000);
const textoOpcional = textoLongo
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v));

const esquemaFiltro = z.object({
  orgao: z.enum(ORGAOS).optional(),
  etapa: z.coerce.number().int().min(1).max(7).optional(),
  busca: textoBusca,
  ...camposPaginacao,
});

const esquemaNovo = z.object({
  titulo: z.string().trim().min(10).max(300),
  orgao: z.enum(ORGAOS),
  uasg: codigoUasg.optional(),
});

const esquemaDfd = z.object({
  descricaoNecessidade: textoLongo,
  justificativa: textoLongo,
  itens: z
    .array(
      z.object({
        catmat: z.string().trim().max(20).nullable().optional().transform((v) => (v ? v : null)),
        descricao: z.string().trim().min(3).max(1000),
        unidade: z.string().trim().min(1).max(60),
        quantidade: z.number().int().nonnegative().max(100_000_000),
        valorUnitarioEstimado: centavos,
      }),
    )
    .max(200),
  usaCatalogoPadronizado: z.boolean(),
  justificativaNaoPadronizacao: textoOpcional,
  justificativaArtigoLuxo: textoOpcional,
  previstoNoPca: z.boolean(),
  tipoObjeto: z.enum(TIPOS_OBJETO),
});

const esquemaEquipe = z.object({
  designacoes: z.array(z.object({ papel: z.enum(PAPEIS_PROCESSO as [string, ...string[]]).transform((p) => p as (typeof PAPEIS_PROCESSO)[number]), usuarioId: uuid })).max(50),
});

const esquemaAssinatura = z.object({ documentoNumero: z.string().regex(/^\d{8}$/, 'Informe o número SEI de 8 dígitos') });

const esquemaEtp = z.partialRecord(
  z.enum(INCISOS),
  z.object({ texto: z.string().max(20_000).optional(), justificativaAusencia: z.string().max(5_000).optional() }),
);

const esquemaRiscos = z.object({
  riscos: z
    .array(
      z.object({
        id: uuid.optional(),
        descricao: z.string().trim().min(5).max(1000),
        probabilidade: z.literal([1, 2, 3, 4, 5]),
        impacto: z.literal([1, 2, 3, 4, 5]),
        alocacao: z.enum(['contratante', 'contratada', 'compartilhado']),
        mitigacao: z.string().trim().min(5).max(2000),
      }),
    )
    .max(100),
});

const esquemaCesta = z.object({
  cotacoes: z
    .array(
      z.object({
        id: uuid.optional(),
        fonte: z.enum(FONTES_COTACAO),
        descricaoFonte: z.string().trim().min(3).max(500),
        valorUnitario: centavos.positive(),
        dataCotacao: dataIso,
        justificativaEscolhaFornecedor: z.string().trim().max(2000).optional(),
      }),
    )
    .max(50),
  orcamentoSigiloso: z.boolean(),
  motivoSigilo: textoOpcional,
});

const esquemaExpurgos = z.object({
  aceitar: z.array(uuid).min(1).max(50),
  justificativa: z.string().trim().min(20).max(2000),
});

const esquemaParametrosEdital = z.object({
  criterioJulgamento: z.enum(['menor_preco', 'maior_desconto', 'tecnica_preco', 'melhor_tecnica', 'maior_lance', 'maior_retorno_economico']),
  regimeExecucao: z.enum(['integrada', 'semi_integrada', 'outro']),
  exigeFaturamentoMinimo: z.boolean(),
  patrimonioLiquidoMinimoPercentual: z.number().min(0).max(100).nullable(),
  exigeRegistroCadastralComplementar: z.boolean(),
});

const esquemaGerar = z.object({ tipo: z.enum(TIPOS_DOCUMENTO as [TipoDocumento, ...TipoDocumento[]]) });

const esquemaParecer = z.object({
  itens: z
    .array(
      z.object({
        id: z.string().max(60),
        atendido: z.boolean().nullable(),
        observacao: z.string().trim().max(2000).nullable().optional().transform((v) => (v ? v : null)),
      }),
    )
    .max(30),
  conclusao: z.enum(['favoravel', 'favoravel_com_ressalvas', 'desfavoravel']).nullable(),
});

/** `null` → `undefined` (critério não informado). */
function semNulo<T>(valor: T | null | undefined): T | undefined {
  return valor === null ? undefined : valor;
}
const booleanoOpcional = z.boolean().nullable().optional().transform(semNulo);

const esquemaDisputa = z.object({
  licitantes: z
    .array(
      z.object({
        id: uuid,
        valorProposta: centavos.positive(),
        notaDesempenhoPrevio: z.number().min(0).max(100).nullable().optional(),
        // Critérios do art. 60: `null` (como devolvido em ProcessoDetalhe) equivale a não informado.
        lanceDisputaFinal: centavos.positive().nullable().optional().transform(semNulo),
        acoesEquidadeGenero: booleanoOpcional,
        programaIntegridade: booleanoOpcional,
        empresaBrasileira: booleanoOpcional,
        investePesquisaDesenvolvimentoNoPais: booleanoOpcional,
        praticaMitigacaoClimatica: booleanoOpcional,
      }),
    )
    .min(1)
    .max(100),
});

/** Permissão para gerar, aprovar ou assinar cada tipo de documento: o checklist do parecer é da assessoria jurídica. */
function permissaoDocumento(tipo: TipoDocumento | null): 'jornada:editar' | 'jornada:aprovar_juridico' {
  return tipo === 'parecer_checklist' ? 'jornada:aprovar_juridico' : 'jornada:editar';
}

/** UASGs do órgão requisitante (pelo nome do órgão no cadastro de UASGs). */
const PREFIXO_ORGAO: Record<(typeof ORGAOS)[number], string> = {
  PF: 'policia federal',
  PRF: 'policia rodoviaria federal',
  SENASP: 'secretaria nacional de seguranca publica',
  SENAPPEN: 'secretaria nacional de politicas penais',
  MJSP: 'ministerio da justica',
};

interface EventoProcesso {
  acao: string;
  resumo: string;
  dados?: DadosEvento;
}

export async function rotasJornada(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const provedorIa = criarProvedorIa(ctx.config.ia, ctx.fetch);
  const leitura = { preHandler: exigir('jornada:ler') };
  const edicao = { preHandler: exigir('jornada:editar') };
  const juridico = { preHandler: exigir('jornada:aprovar_juridico') };
  const publicacao = { preHandler: exigir('jornada:publicar') };
  const documentos = { preHandler: exigirAlguma(['jornada:editar', 'jornada:aprovar_juridico']) };

  async function contexto(): Promise<ContextoJornada> {
    const agora = ctx.relogio();
    return { agora, hoje: ctx.hoje(), calendario: await opcoesCalendario(ctx.banco) };
  }

  async function responder(request: FastifyRequest, id: string): Promise<ProcessoDetalhe> {
    const c = await contexto();
    const detalhe = await obterProcessoDetalhe(ctx.banco, id, escopoUasgs(sessaoDe(request)), c.hoje, c.calendario, c.agora);
    if (!detalhe) throw naoEncontrado('Processo não encontrado.');
    return detalhe;
  }

  /** Escrita no processo: trava a linha (escopo de UASG → 404), executa a ação e registra na trilha, numa transação. */
  async function alterar(
    request: FastifyRequest,
    acao: (tx: Transacao, linha: LinhaProcesso, c: ContextoJornada) => Promise<EventoProcesso>,
  ): Promise<ProcessoDetalhe> {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const c = await contexto();
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      const evento = await acao(tx, linha, c);
      await auditar(tx, request, {
        acao: `processo.${evento.acao}`,
        recurso: 'processo',
        recursoId: id,
        resumo: evento.resumo,
        dados: { numeroSei: linha.numero_sei, etapa: linha.etapa_atual, ...evento.dados },
      });
    });
    return responder(request, id);
  }

  // ───────── leitura ─────────

  app.get('/processos', leitura, async (request): Promise<Pagina<ProcessoResumo>> => {
    const f = esquemaFiltro.parse(request.query);
    const c = await contexto();
    const { linhas, total } = await listarLinhasProcessos(
      ctx.banco,
      { escopo: escopoUasgs(sessaoDe(request)), orgao: f.orgao, etapa: f.etapa as EtapaJornada | undefined, busca: f.busca },
      f.tamanhoPagina,
      (f.pagina - 1) * f.tamanhoPagina,
    );
    const itens: ProcessoResumo[] = [];
    for (const linha of linhas) {
      const avaliacao = await avaliarProcesso(ctx.banco, await carregarProcesso(ctx.banco, linha), c.hoje, c.calendario, c.agora);
      itens.push(montarResumo(linha, avaliacao.bloqueios, avaliacao.valorEstimado));
    }
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  // Rota estática registrada antes de /processos/:id.
  app.get('/processos/designaveis', leitura, async (request): Promise<UsuarioDesignavel[]> =>
    listarDesignaveis(ctx.banco, escopoUasgs(sessaoDe(request))),
  );

  app.get('/processos/:id', leitura, async (request): Promise<ProcessoDetalhe> => responder(request, idDaRota(request.params)));

  // ───────── etapa 1 ─────────

  app.post('/processos', edicao, async (request, reply): Promise<ProcessoDetalhe> => {
    const entrada = esquemaNovo.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const c = await contexto();
    const id = randomUUID();
    await ctx.banco.transacao(async (tx) => {
      const uasgs = await tx.consultar<{ codigo: string; orgao: string }>(
        `SELECT codigo, orgao FROM uasgs WHERE ($1::text[] IS NULL OR codigo = ANY($1::text[])) ORDER BY codigo`,
        [escopo],
      );
      const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const uasg = entrada.uasg
        ? uasgs.find((u) => u.codigo === entrada.uasg)
        : (uasgs.find((u) => normalizar(u.orgao).startsWith(PREFIXO_ORGAO[entrada.orgao])) ?? uasgs[0]);
      if (!uasg) throw regraNegocio('Nenhuma UASG do seu escopo pode autuar este processo.', [{ campo: 'uasg', mensagem: 'UASG fora do escopo do usuário' }]);
      const { numeroSei } = await inserirProcesso(tx, {
        id,
        titulo: entrada.titulo,
        orgao: entrada.orgao,
        uasg: uasg.codigo,
        responsavelId: sessao.usuario.id,
        etapa: 1,
        modalidadePrevista: null,
        dfd: DFD_INICIAL,
        etp: {},
        riscos: [],
        cesta: { cotacoes: [], orcamentoSigiloso: false, motivoSigilo: null },
        edital: EDITAL_PADRAO,
        parecer: parecerInicial(),
        publicacao: PUBLICACAO_INICIAL,
        disputa: DISPUTA_INICIAL,
        criadoEm: c.agora.toISOString(),
      });
      await auditar(tx, request, {
        acao: 'processo.criar',
        recurso: 'processo',
        recursoId: id,
        resumo: `Autuou o processo ${numeroSei} — ${entrada.titulo}`,
        dados: { numeroSei, orgao: entrada.orgao, uasg: uasg.codigo },
      });
    });
    reply.status(201);
    return responder(request, id);
  });

  app.put('/processos/:id/dfd', edicao, async (request) => {
    const dfd = esquemaDfd.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 1, 'A edição do DFD');
      await gravarJson(tx, linha.id, 'dfd', dfd, c.agora);
      await definirModalidade(tx, linha.id, modalidadeSugerida(dfd.tipoObjeto));
      return {
        acao: 'dfd.atualizar',
        resumo: 'Atualizou o Documento de Formalização da Demanda',
        dados: { itens: dfd.itens.length, previstoNoPca: dfd.previstoNoPca, usaCatalogoPadronizado: dfd.usaCatalogoPadronizado, tipoObjeto: dfd.tipoObjeto },
      };
    });
  });

  // ───────── etapa 2 ─────────

  app.put('/processos/:id/equipe', edicao, async (request) => {
    const { designacoes } = esquemaEquipe.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      if (linha.contrato_id !== null) throw regraNegocio('O processo já gerou contrato: a equipe é mantida na gestão contratual.');
      const usuarios = await carregarDesignaveis(tx, designacoes.map((d) => d.usuarioId), escopoUasgs(sessaoDe(request)));
      const faltantes = designacoes.filter((d) => !usuarios.has(d.usuarioId));
      if (faltantes.length > 0) {
        throw regraNegocio(
          'Há designações de usuários inexistentes, inativos ou fora do seu escopo de UASG.',
          faltantes.map((d) => ({ campo: d.papel, mensagem: `Usuário ${d.usuarioId} não designável` })),
        );
      }
      const equipe = designacoes.map((d) => {
        const u = usuarios.get(d.usuarioId);
        return { papel: d.papel, usuarioId: d.usuarioId, nome: u?.nome ?? '', cpf: u?.cpf ?? '' };
      });
      const segregacao = avaliarSegregacao(equipe, []);
      if (segregacao.conflitos.length > 0) {
        throw regraNegocio(
          'A equipe viola a segregação de funções (RN-03).',
          segregacao.conflitos.map((cf) => ({ campo: 'RN-03', mensagem: `${cf.mensagem} (${cf.fundamento})` })),
        );
      }
      await gravarEquipe(tx, linha.id, designacoes, c.agora);
      return {
        acao: 'equipe.designar',
        resumo: `Designou a equipe do processo (${designacoes.length} designação(ões))`,
        dados: { designacoes: designacoes.map((d) => ({ papel: d.papel, usuarioId: d.usuarioId })) },
      };
    });
  });

  app.post('/processos/:id/sei/assinar', documentos, async (request) => {
    const { documentoNumero } = esquemaAssinatura.parse(request.body);
    const id = idDaRota(request.params);
    exigirPermissaoNoHandler(request, permissaoDocumento(await tipoDocumentoDaArvore(ctx.banco, id, documentoNumero)));
    return alterar(request, async (tx, linha, c) => {
      const assinado = await assinarNaArvore(tx, linha.id, documentoNumero, sessaoDe(request).usuario.id, c.agora);
      return {
        acao: 'sei.assinar',
        resumo: `Assinou (simulação) o documento SEI nº ${documentoNumero} — ${assinado.titulo}`,
        dados: { documentoNumero, tipo: assinado.tipo, simulacao: true },
      };
    });
  });

  // ───────── etapa 3 ─────────

  app.put('/processos/:id/etp', edicao, async (request) => {
    const etp = esquemaEtp.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 3, 'O Estudo Técnico Preliminar');
      await gravarJson(tx, linha.id, 'etp', etp, c.agora);
      return { acao: 'etp.atualizar', resumo: 'Atualizou o Estudo Técnico Preliminar', dados: { incisos: Object.keys(etp).sort() } };
    });
  });

  app.put('/processos/:id/riscos', edicao, async (request) => {
    const { riscos } = esquemaRiscos.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 3, 'A matriz de riscos');
      const comId = riscos.map((r) => ({ ...r, id: r.id ?? randomUUID() }));
      await gravarJson(tx, linha.id, 'riscos', comId, c.agora);
      return { acao: 'riscos.atualizar', resumo: `Atualizou a matriz de riscos (${comId.length} risco(s))`, dados: { riscos: comId.length } };
    });
  });

  app.put('/processos/:id/cesta-precos', edicao, async (request) => {
    const entrada = esquemaCesta.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 3, 'A pesquisa de preços');
      const anteriores = new Map(linha.cesta.cotacoes.map((x) => [x.id, x]));
      const cotacoes: CotacaoArmazenada[] = entrada.cotacoes.map((cot) => {
        const id = cot.id ?? randomUUID();
        const anterior = anteriores.get(id);
        // Expurgo só se mantém para a mesma cotação, sem alteração de valor ou data (o expurgo é feito na rota própria).
        const manterExpurgo = anterior?.expurgada === true && anterior.valorUnitario === cot.valorUnitario && anterior.dataCotacao === cot.dataCotacao;
        return {
          id,
          fonte: cot.fonte,
          descricaoFonte: cot.descricaoFonte,
          valorUnitario: cot.valorUnitario,
          dataCotacao: cot.dataCotacao,
          ...(cot.justificativaEscolhaFornecedor ? { justificativaEscolhaFornecedor: cot.justificativaEscolhaFornecedor } : {}),
          expurgada: manterExpurgo,
          motivoExpurgo: manterExpurgo ? (anterior?.motivoExpurgo ?? null) : null,
        };
      });
      const cesta: CestaArmazenada = { cotacoes, orcamentoSigiloso: entrada.orcamentoSigiloso, motivoSigilo: entrada.motivoSigilo };
      await gravarJson(tx, linha.id, 'cesta', cesta, c.agora);
      const analise = analisarCesta(cesta, c.hoje);
      return {
        acao: 'cesta.atualizar',
        resumo: `Atualizou a pesquisa de preços (${cotacoes.length} cotação(ões))`,
        dados: {
          cotacoes: cotacoes.length,
          orcamentoSigiloso: cesta.orcamentoSigiloso,
          valorEstimadoUnitario: analise?.valorEstimado ?? null,
          alertas: analise?.alertas.map((a) => a.codigo) ?? [],
        },
      };
    });
  });

  app.post('/processos/:id/cesta-precos/expurgos', edicao, async (request) => {
    const entrada = esquemaExpurgos.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 3, 'A pesquisa de preços');
      const analise = analisarCesta(linha.cesta, c.hoje);
      const sugeridas = new Map((analise?.sugeridasExpurgo ?? []).map((s) => [s.id, s]));
      const aceitar = new Set(entrada.aceitar.map((x) => x.toLowerCase()));
      const disponiveis = new Set(linha.cesta.cotacoes.filter((x) => !x.expurgada).map((x) => x.id.toLowerCase()));
      const invalidas = [...aceitar].filter((x) => !disponiveis.has(x));
      if (invalidas.length > 0) {
        throw regraNegocio('Há cotações inexistentes ou já expurgadas.', invalidas.map((x) => ({ campo: 'aceitar', mensagem: `Cotação ${x} indisponível para expurgo` })));
      }
      const cesta: CestaArmazenada = {
        ...linha.cesta,
        cotacoes: linha.cesta.cotacoes.map((cot) => {
          if (!aceitar.has(cot.id.toLowerCase())) return cot;
          const sugestao = sugeridas.get(cot.id);
          return { ...cot, expurgada: true, motivoExpurgo: sugestao ? `${entrada.justificativa} (${sugestao.explicacao})` : entrada.justificativa };
        }),
      };
      await gravarJson(tx, linha.id, 'cesta', cesta, c.agora);
      return {
        acao: 'cesta.expurgar',
        resumo: `Expurgou ${aceitar.size} cotação(ões) da pesquisa de preços, com justificativa`,
        dados: { expurgadas: [...aceitar], sugeridasPeloSaneamento: [...aceitar].filter((x) => sugeridas.has(x)).length },
      };
    });
  });

  // ───────── documentos (etapas 1 a 5) ─────────

  app.post('/processos/:id/documentos/gerar', documentos, async (request) => {
    const entrada = esquemaGerar.parse(request.body);
    exigirPermissaoNoHandler(request, permissaoDocumento(entrada.tipo));
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const c = await contexto();
    const linha = await obterLinhaProcesso(ctx.banco, id, escopo);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    exigirEtapaDocumento(linha, entrada.tipo);
    const carga = await carregarProcesso(ctx.banco, linha);
    // Redação fora da transação: a IA pode levar até 60 s e não deve travar o processo.
    const preparado = await prepararDocumento(carga, entrada.tipo, provedorIa, c);
    if (preparado.falhaIa) request.log.warn({ tipo: entrada.tipo, falha: preparado.falhaIa }, 'redação por IA falhou; usado o modelo de texto');
    return alterar(request, async (tx, atual) => {
      exigirEtapaDocumento(atual, entrada.tipo);
      const doc = await inserirDocumento(tx, atual.id, preparado, { id: randomUUID(), geradoEm: c.agora.toISOString(), usuarioId: sessaoDe(request).usuario.id });
      return {
        acao: 'documento.gerar',
        resumo: `Gerou o rascunho de "${preparado.titulo}" (versão ${doc.versao}${preparado.geradoPor === 'ia' ? ', com apoio de IA' : ''})`,
        dados: {
          documentoId: doc.id,
          tipo: entrada.tipo,
          versao: doc.versao,
          geradoPor: preparado.geradoPor,
          modeloIa: preparado.modeloIa,
          falhaIa: preparado.falhaIa,
          hashConteudo: doc.hash,
        },
      };
    });
  });

  app.post('/processos/:id/documentos/:docId/aprovar', documentos, async (request) => {
    const documentoId = idDaRota(request.params, 'docId');
    const sessao = sessaoDe(request);
    return alterar(request, async (tx, linha, c) => {
      const doc = await obterDocumentoParaAprovar(tx, linha.id, documentoId);
      if (!doc) throw naoEncontrado('Documento não encontrado.');
      exigirPermissaoNoHandler(request, permissaoDocumento(doc.tipo));
      if (geradoComParametrosAnteriores(doc.tipo, doc.hash_parametros, linha.edital)) {
        const mensagem = `O documento "${doc.titulo}" (versão ${doc.versao}) foi gerado com parâmetros anteriores — gere novamente e aprove.`;
        throw regraNegocio(mensagem, [{ campo: 'RN-06', mensagem }]);
      }
      const aprovado = await aprovarDocumento(tx, linha.id, doc, { id: sessao.usuario.id, nome: sessao.usuario.nome }, c.agora, c.hoje, randomUUID());
      return {
        acao: 'documento.aprovar',
        resumo: `Aprovou "${doc.titulo}" (versão ${doc.versao}) e o incluiu na árvore SEI sob o nº ${aprovado.numeroSei}`,
        dados: { documentoId: doc.id, tipo: doc.tipo, versao: doc.versao, numeroSei: aprovado.numeroSei, hashConteudo: aprovado.hash },
      };
    });
  });

  // ───────── etapa 4: parâmetros do edital (RN-06 e prazo do art. 55) ─────────

  app.put('/processos/:id/parametros-edital', edicao, async (request) => {
    const parametros: ParametrosEdital = esquemaParametrosEdital.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 4, 'A definição dos parâmetros do edital');
      await gravarJson(tx, linha.id, 'edital', parametros, c.agora);
      return {
        acao: 'edital.parametros',
        resumo: 'Atualizou os parâmetros do edital (critério, regime e habilitação econômico-financeira)',
        dados: { antes: linha.edital, depois: parametros },
      };
    });
  });

  // ───────── etapa 5 ─────────

  app.put('/processos/:id/parecer', juridico, async (request) => {
    const entrada = esquemaParecer.parse(request.body);
    const sessao = sessaoDe(request);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 5, 'O parecer jurídico');
      // Publicado (ou na fila de publicação) o edital, o parecer que o fundamentou fica imutável (art. 53).
      if (linha.publicacao.pncp !== 'nao_publicado') {
        throw conflito('O parecer não pode ser alterado após a publicação; registre nova manifestação jurídica no SEI.');
      }
      const conhecidos = new Set(ITENS_PARECER.map((i) => i.id));
      const desconhecidos = entrada.itens.filter((i) => !conhecidos.has(i.id));
      if (desconhecidos.length > 0) throw validacao('Há itens fora do checklist do art. 53.', desconhecidos.map((i) => ({ campo: 'itens', mensagem: `Item desconhecido: ${i.id}` })));
      const itens = ITENS_PARECER.map((item) => {
        const informado = entrada.itens.find((i) => i.id === item.id);
        return { id: item.id, atendido: informado?.atendido ?? null, observacao: informado?.observacao ?? null };
      });
      if (entrada.conclusao !== null) {
        const naoAvaliados = itens.filter((i) => i.atendido === null);
        if (naoAvaliados.length > 0) {
          throw regraNegocio('Avalie todos os itens do checklist antes de registrar a conclusão.', naoAvaliados.map((i) => ({ campo: i.id, mensagem: 'Item não avaliado' })));
        }
        const naoAtendidos = itens.filter((i) => i.atendido === false);
        if (entrada.conclusao === 'favoravel' && naoAtendidos.length > 0) {
          throw regraNegocio('Há itens não atendidos: registre a conclusão como favorável com ressalvas ou desfavorável.', naoAtendidos.map((i) => ({ campo: i.id, mensagem: 'Item não atendido' })));
        }
        const semObservacao = naoAtendidos.filter((i) => (i.observacao ?? '').length < 10);
        if (entrada.conclusao === 'favoravel_com_ressalvas' && semObservacao.length > 0) {
          throw regraNegocio('Descreva a ressalva de cada item não atendido.', semObservacao.map((i) => ({ campo: i.id, mensagem: 'Ressalva sem observação' })));
        }
      }
      await gravarJson(tx, linha.id, 'parecer', { itens, conclusao: entrada.conclusao, pareceristaId: sessao.usuario.id, emitidoEm: entrada.conclusao ? c.agora.toISOString() : null }, c.agora);
      return {
        acao: 'parecer.registrar',
        resumo: entrada.conclusao ? `Registrou o parecer jurídico: ${entrada.conclusao.replaceAll('_', ' ')}` : 'Registrou a análise parcial do checklist jurídico',
        dados: { conclusao: entrada.conclusao, atendidos: itens.filter((i) => i.atendido === true).length, naoAtendidos: itens.filter((i) => i.atendido === false).length },
      };
    });
  });

  app.post('/processos/:id/publicar', publicacao, async (request) => {
    const cnpj = await cnpjDoOrgao(ctx.banco, ctx.config.orgao.cnpj);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 5, 'A publicação do edital');
      if (linha.publicacao.pncp === 'publicado') throw regraNegocio('O edital já foi publicado no PNCP.');
      const conclusao = linha.parecer.conclusao;
      if (conclusao !== 'favoravel' && conclusao !== 'favoravel_com_ressalvas') {
        throw regraNegocio('O edital só pode ser publicado após o parecer jurídico favorável (art. 53).', [{ campo: 'RF-15', mensagem: 'Parecer jurídico favorável pendente' }]);
      }
      const resultado = publicarOffline(linha, cnpj, c);
      await gravarJson(tx, linha.id, 'publicacao', resultado.publicacao, c.agora);
      return {
        acao: 'publicar',
        resumo: `Publicou o edital no PNCP e o extrato no DOU (fila offline); propostas a partir de ${resultado.publicacao.dataMinimaPropostas ?? '—'}`,
        dados: { fila: 'offline', ...resultado.publicacao, diasUteis: resultado.diasUteis, fundamento: resultado.fundamento },
      };
    });
  });

  // ───────── etapa 6 ─────────

  app.put('/processos/:id/disputa', edicao, async (request) => {
    const { licitantes } = esquemaDisputa.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 6, 'O registro da disputa');
      const disputa = await montarDisputa(tx, licitantes, c.agora);
      await gravarJson(tx, linha.id, 'disputa', disputa, c.agora);
      const resultado = disputa.resultado;
      return {
        acao: 'disputa.registrar',
        resumo: `Registrou a disputa com ${licitantes.length} licitante(s)${resultado?.empateDetectado ? ' e aplicou os critérios de desempate do art. 60' : ''}`,
        dados: {
          licitantes: licitantes.map((l) => ({ fornecedorId: l.id, valorProposta: l.valorProposta })),
          vencedor: primeiroClassificado(disputa),
          empateDetectado: resultado?.empateDetectado ?? false,
          criterioDecisivo: resultado?.criterioDecisivo ?? null,
          sorteioNecessario: resultado?.sorteioNecessario ?? false,
        },
      };
    });
  });

  // ───────── avanço e contratação ─────────

  app.post('/processos/:id/avancar', edicao, async (request) =>
    alterar(request, async (tx, linha, c) => {
      if (linha.etapa_atual === 7) {
        throw regraNegocio('O processo já está na última etapa (Contrato e gestão): gere o contrato para concluir a jornada.');
      }
      const carga = await carregarProcesso(tx, linha);
      const avaliacao = await avaliarProcesso(tx, carga, c.hoje, c.calendario, c.agora);
      if (avaliacao.bloqueios.length > 0) {
        throw regraNegocio(
          `A etapa ${linha.etapa_atual} (${TITULOS_ETAPA[linha.etapa_atual]}) tem ${avaliacao.bloqueios.length} bloqueio(s) que impedem o avanço.`,
          avaliacao.bloqueios.map((b) => ({ campo: b.regra, mensagem: b.mensagem })),
        );
      }
      const proxima = (linha.etapa_atual + 1) as EtapaJornada;
      await avancarEtapa(tx, linha.id, proxima, c.agora);
      return {
        acao: 'avancar',
        resumo: `Concluiu a etapa ${linha.etapa_atual} e avançou para a etapa ${proxima} — ${TITULOS_ETAPA[proxima]}`,
        dados: { de: linha.etapa_atual, para: proxima, sinais: avaliacao.sinais.map((s) => s.regra) },
      };
    }),
  );

  app.post('/processos/:id/contratar', edicao, async (request) =>
    alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 7, 'A geração do contrato');
      if (linha.contrato_id !== null) throw regraNegocio(`O processo já gerou o contrato ${linha.contrato_numero ?? ''}.`.trim());
      const vencedor = primeiroClassificado(linha.disputa);
      if (!vencedor) throw regraNegocio('Não há licitante vencedor registrado na disputa.');
      // RN-09 (art. 91, § 4º): sem impedimento/inidoneidade vigentes e com regularidade fiscal e trabalhista.
      const regularidade = await avaliarRegularidade(tx, vencedor, c.hoje, c.agora);
      if (!regularidade.regular) {
        throw regraNegocio(
          'O vencedor não atende à verificação prévia à assinatura (RN-09, art. 91, § 4º).',
          regularidade.motivos.map((m) => ({ campo: 'RN-09', mensagem: m })),
        );
      }
      const carga = await carregarProcesso(tx, linha);
      const contrato = await criarContratoDoProcesso(tx, carga, c, randomUUID);
      return {
        acao: 'contratar',
        resumo: `Gerou o contrato ${contrato.numero} na carteira, com ${contrato.tarefas} tarefa(s) do plano de gestão`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: contrato.id,
          contratoNumero: contrato.numero,
          fornecedorId: contrato.fornecedorId,
          valorInicial: contrato.valorInicial,
          tarefas: contrato.tarefas,
          limiteDivulgacaoPncp: contrato.limiteDivulgacao,
          regularidade: { consultadoEm: regularidade.consultadoEm, fontes: regularidade.fontes },
        },
      };
    }),
  );
}
