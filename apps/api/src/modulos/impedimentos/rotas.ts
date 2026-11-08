/**
 * Vínculos entre licitantes e impedimentos (F4 e F14): análise de vínculos (RIA-06 e RIA-10), vínculos de fonte
 * lícita com evidência, quadro societário pelo conector do CNPJ, possíveis sucessões de sancionadas e declarações
 * dos agentes (RN-28). As extensões de sanção (RN-27) estão em `rotas-extensoes.ts`.
 */
import { validarDeclaracaoAgente, validarVinculoInformado, verificarDeclaracaoAgente } from '@agora/dominio';
import type {
  AnaliseVinculos,
  MinhaDeclaracao,
  ProcessoComLicitantes,
  QuadroSocietario,
  SinalVinculo,
  UsuarioResumo,
  VinculoRegistrado,
  VinculosFornecedor,
  VinculosProcesso,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { ErroApi, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { idDaRota, uuid } from '../../http/validacao.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { consultarQsa } from '../../integracoes/qsa-receita.ts';
import { PAPEIS_PROCESSO } from '../jornada/constantes.ts';
import { carregarEquipe, obterLinhaProcesso } from '../jornada/repositorio.ts';
import { aptidaoDaEquipe, declaracaoRegistrada, declaracoesVigentes, paraDeclaracaoDominio } from './declaracoes.ts';
import {
  analisarFornecedores,
  candidatosVinculo,
  carregarFornecedoresAnalise,
  listarExtensoes,
  listarVinculos,
  paraExtensao,
  paraVinculoRegistrado,
  quadroSocietario,
  sucessoesNoCadastro,
} from './repositorio.ts';
import { rotasExtensoes } from './rotas-extensoes.ts';

const NATUREZAS = ['conjuge', 'parentesco', 'societario', 'tecnico', 'comercial', 'economico', 'financeiro', 'trabalhista', 'civil'] as const;
const grau = z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable();

const esquemaAnalise = z.object({ fornecedorIds: z.array(uuid).min(2).max(50) });

const esquemaFiltroVinculos = z.object({
  fornecedorId: uuid.optional(),
  processoId: uuid.optional(),
  situacao: z.enum(['ativo', 'revogado']).optional(),
});

const esquemaVinculo = z.object({
  natureza: z.enum(NATUREZAS),
  grauParentesco: grau,
  fornecedorId: uuid,
  outroFornecedorId: uuid.nullable(),
  agenteId: uuid.nullable(),
  fonte: z.enum(['declaracao_licitante', 'informado_agente']),
  descricao: z.string().trim().min(10).max(2000),
  evidencia: z.string().trim().min(15).max(2000),
  processoId: uuid.nullable(),
});

const esquemaRevogar = z.object({ motivo: z.string().trim().min(15).max(2000) });

const esquemaDeclaracao = z.object({
  semParentescoOuVinculo: z.boolean(),
  semConflitoInteresses: z.boolean(),
  vinculo: z.enum(['servidor_efetivo', 'empregado_publico_permanente', 'cargo_comissao', 'temporario', 'outro']),
  cargoMatricula: z.string().trim().max(200).nullable().transform((v) => (v ? v : null)),
  capacitacao: z.enum(['atribuicoes', 'formacao', 'certificacao_escola_governo', 'nenhuma']),
  capacitacaoDescricao: z.string().trim().max(1000).nullable().transform((v) => (v ? v : null)),
  vinculosDeclarados: z
    .array(z.object({ fornecedorId: uuid, natureza: z.enum(NATUREZAS), grauParentesco: grau, descricao: z.string().trim().min(10).max(1000) }))
    .max(20),
});

export async function rotasImpedimentos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('impedimentos:ler') };
  const registro = { preHandler: exigir('impedimentos:registrar') };
  const declarar = { preHandler: exigir('agentes:declarar') };

  async function vinculoPorId(id: string): Promise<VinculoRegistrado> {
    const [linha] = await listarVinculos(ctx.banco, { id });
    if (!linha) throw naoEncontrado('Vínculo não encontrado.');
    return paraVinculoRegistrado(linha);
  }

  async function exigirFornecedores(tx: Transacao, ids: readonly string[]): Promise<void> {
    const unicos = [...new Set(ids)];
    const achados = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE id = ANY($1::uuid[])', [unicos]);
    if (achados.length !== unicos.length) throw naoEncontrado('Fornecedor não encontrado.');
  }

  // ───────── análise (RIA-06 e RIA-10) ─────────

  /** Análise avulsa de 2 a 50 fornecedores (somente leitura). */
  app.post('/impedimentos/analise', leitura, async (request): Promise<AnaliseVinculos> => {
    const { fornecedorIds } = esquemaAnalise.parse(request.body);
    const ids = [...new Set(fornecedorIds.map((i) => i.toLowerCase()))];
    const existentes = await carregarFornecedoresAnalise(ctx.banco, ids);
    if (existentes.length !== ids.length) throw naoEncontrado('Fornecedor não encontrado.');
    return analisarFornecedores(ctx.banco, ids, { hoje: ctx.hoje(), agora: ctx.relogio() });
  });

  app.get('/impedimentos/sucessoes', leitura, async (): Promise<SinalVinculo[]> => sucessoesNoCadastro(ctx.banco, ctx.hoje()));

  app.get('/impedimentos/processos', leitura, async (request): Promise<ProcessoComLicitantes[]> => {
    const linhas = await ctx.banco.consultar<{ id: string; numero_sei: string; titulo: string; etapa_atual: ProcessoComLicitantes['etapaAtual']; licitantes: number }>(
      `SELECT id, numero_sei, titulo, etapa_atual, jsonb_array_length(disputa -> 'licitantes')::integer AS licitantes
         FROM processos
        WHERE ($1::text[] IS NULL OR uasg = ANY($1::text[])) AND jsonb_array_length(disputa -> 'licitantes') > 0
        ORDER BY atualizado_em DESC, numero_sei
        LIMIT 100`,
      [escopoUasgs(sessaoDe(request))],
    );
    return linhas.map((l) => ({ id: l.id, numeroSei: l.numero_sei, titulo: l.titulo, etapaAtual: l.etapa_atual, licitantes: l.licitantes }));
  });

  app.get('/impedimentos/processos/:id', leitura, async (request): Promise<VinculosProcesso> => {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    const hoje = ctx.hoje();
    const equipe = await carregarEquipe(ctx.banco, linha.id);
    const ids = linha.disputa.licitantes.map((l) => l.fornecedorId);
    const analise = await analisarFornecedores(ctx.banco, ids, { agentes: equipe, hoje, agora: ctx.relogio() });
    const vinculos = ids.length === 0 ? [] : await listarVinculos(ctx.banco, { fornecedorIds: ids, situacao: 'ativo' });
    return {
      processo: { id: linha.id, numeroSei: linha.numero_sei, titulo: linha.titulo, etapaAtual: linha.etapa_atual },
      analise,
      equipe: await aptidaoDaEquipe(ctx.banco, equipe, hoje),
      vinculos: vinculos.map(paraVinculoRegistrado),
    };
  });

  // ───────── fornecedor: quadro societário, vínculos, sinais e extensões ─────────

  app.get('/impedimentos/fornecedores/:id', leitura, async (request): Promise<VinculosFornecedor> => {
    const id = idDaRota(request.params);
    const quadro = await quadroSocietario(ctx.banco, id);
    if (!quadro) throw naoEncontrado('Fornecedor não encontrado.');
    const hoje = ctx.hoje();
    const candidatos = await candidatosVinculo(ctx.banco, id);
    const analise = await analisarFornecedores(ctx.banco, [id, ...candidatos], { hoje, agora: ctx.relogio() });
    const sucessoes = (await sucessoesNoCadastro(ctx.banco, hoje)).filter((s) => s.fornecedores.some((f) => f.id === id));
    const daAnalise = analise.sinais.filter((s) => s.tipo !== 'possivel_sucessao' && s.fornecedores.some((f) => f.id === id));
    return {
      quadro,
      vinculos: (await listarVinculos(ctx.banco, { fornecedorIds: [id] })).map(paraVinculoRegistrado),
      sinais: [...sucessoes, ...daAnalise],
      extensoes: (await listarExtensoes(ctx.banco, { fornecedorId: id, escopo: escopoUasgs(sessaoDe(request)) })).map(paraExtensao),
    };
  });

  /** Consulta o QSA e o cadastro do CNPJ pelo conector no servidor (offline por padrão), com proveniência e auditoria. */
  app.post('/impedimentos/fornecedores/:id/qsa', registro, async (request): Promise<QuadroSocietario> => {
    const id = idDaRota(request.params);
    const [fornecedor] = await ctx.banco.consultar<{ id: string; documento: string; tipo_pessoa: 'PJ' | 'PF' }>(
      'SELECT id, documento, tipo_pessoa FROM fornecedores WHERE id = $1',
      [id],
    );
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    if (fornecedor.tipo_pessoa !== 'PJ') throw regraNegocio('Pessoa física não tem quadro societário.');
    const modo = ctx.config.integracoes === 'online' && ctx.config.qsa.url !== null ? 'online' : 'offline';
    let resultado;
    try {
      resultado = await consultarQsa(ctx.banco, fornecedor.documento, { modo, urlBase: ctx.config.qsa.url, chave: ctx.config.qsa.chave, fetch: ctx.fetch }, ctx.relogio());
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw new ErroApi(503, 'INDISPONIVEL', erro.message);
      throw erro;
    }
    await ctx.banco.transacao(async (tx) => {
      const { dados, proveniencia } = resultado;
      await tx.executar('DELETE FROM fornecedores_qsa WHERE fornecedor_id = $1', [id]);
      for (const s of dados.socios) {
        await tx.executar(
          'INSERT INTO fornecedores_qsa (fornecedor_id, documento_parcial, nome, qualificacao, data_entrada) VALUES ($1, $2, $3, $4, $5)',
          [id, s.documentoParcial, s.nome, s.qualificacao, s.dataEntrada],
        );
      }
      await tx.executar(
        `INSERT INTO fornecedores_cadastro_cnpj (fornecedor_id, data_abertura, endereco, municipio, uf, fonte, modo, consultado_em, hash, registros)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (fornecedor_id) DO UPDATE SET data_abertura = EXCLUDED.data_abertura, endereco = EXCLUDED.endereco,
           municipio = EXCLUDED.municipio, uf = EXCLUDED.uf, fonte = EXCLUDED.fonte, modo = EXCLUDED.modo,
           consultado_em = EXCLUDED.consultado_em, hash = EXCLUDED.hash, registros = EXCLUDED.registros`,
        [id, dados.dataAbertura, dados.endereco, dados.municipio, dados.uf, proveniencia.fonte, proveniencia.modo, proveniencia.consultadoEm, proveniencia.hash, proveniencia.registros],
      );
      await auditar(tx, request, {
        acao: 'impedimentos.qsa.consultar',
        recurso: 'fornecedor',
        recursoId: id,
        resumo: `Consultou o quadro societário do CNPJ (${proveniencia.modo === 'online' ? 'base do CNPJ' : 'simulação offline'})`,
        dados: { fonte: proveniencia.fonte, modo: proveniencia.modo, hash: proveniencia.hash, registros: proveniencia.registros },
      });
    });
    const quadro = await quadroSocietario(ctx.banco, id);
    if (!quadro) throw naoEncontrado('Fornecedor não encontrado.');
    return quadro;
  });

  // ───────── vínculos de fonte lícita ─────────

  app.get('/impedimentos/vinculos', leitura, async (request): Promise<VinculoRegistrado[]> => {
    const f = esquemaFiltroVinculos.parse(request.query);
    const linhas = await listarVinculos(ctx.banco, {
      fornecedorIds: f.fornecedorId ? [f.fornecedorId.toLowerCase()] : undefined,
      processoId: f.processoId?.toLowerCase(),
      situacao: f.situacao,
    });
    return linhas.map(paraVinculoRegistrado);
  });

  /** Agentes públicos do órgão (servidores ativos), para registrar vínculo de agente com fornecedor. */
  app.get('/impedimentos/agentes', registro, async (): Promise<UsuarioResumo[]> =>
    ctx.banco.consultar<UsuarioResumo>(
      // O perfil cidadão (gestão compartilhada com a sociedade) não é agente público.
      "SELECT id, nome FROM usuarios u WHERE ativo AND NOT EXISTS (SELECT 1 FROM usuarios_perfis pc WHERE pc.usuario_id = u.id AND pc.perfil = 'cidadao') ORDER BY nome LIMIT 1000",
    ),
  );

  app.post('/impedimentos/vinculos', registro, async (request, reply): Promise<VinculoRegistrado> => {
    const e = esquemaVinculo.parse(request.body);
    const fornecedorId = e.fornecedorId.toLowerCase();
    const outroFornecedorId = e.outroFornecedorId?.toLowerCase() ?? null;
    const agenteId = e.agenteId?.toLowerCase() ?? null;
    const processoId = e.processoId?.toLowerCase() ?? null;
    validarVinculoInformado({ ...e, fornecedorId, outroFornecedorId, agenteId });
    const id = await ctx.banco.transacao(async (tx) => {
      await exigirFornecedores(tx, outroFornecedorId === null ? [fornecedorId] : [fornecedorId, outroFornecedorId]);
      if (agenteId !== null) {
        const [agente] = await tx.consultar<{ id: string }>('SELECT id FROM usuarios WHERE id = $1', [agenteId]);
        if (!agente) throw naoEncontrado('Agente público não encontrado.');
      }
      if (processoId !== null) {
        const processo = await obterLinhaProcesso(tx, processoId, escopoUasgs(sessaoDe(request)));
        if (!processo) throw naoEncontrado('Processo não encontrado.');
      }
      const [criado] = await tx.consultar<{ id: string }>(
        `INSERT INTO vinculos_licitantes (natureza, grau_parentesco, fornecedor_id, outro_fornecedor_id, agente_id, fonte, descricao, evidencia,
                                          processo_id, registrado_por, registrado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [e.natureza, e.grauParentesco, fornecedorId, outroFornecedorId, agenteId, e.fonte, e.descricao, e.evidencia, processoId, sessaoDe(request).usuario.id, ctx.relogio().toISOString()],
      );
      if (!criado) throw new Error('Falha ao registrar o vínculo');
      await auditar(tx, request, {
        acao: 'impedimentos.vinculo.registrar',
        recurso: 'vinculo_licitante',
        recursoId: criado.id,
        resumo: `Registrou vínculo de fonte lícita (${e.natureza}) com evidência`,
        dados: { fornecedorId, outroFornecedorId, agenteId, natureza: e.natureza, grauParentesco: e.grauParentesco, fonte: e.fonte, processoId },
      });
      return criado.id;
    });
    reply.status(201);
    return vinculoPorId(id);
  });

  app.post('/impedimentos/vinculos/:id/revogar', registro, async (request): Promise<VinculoRegistrado> => {
    const id = idDaRota(request.params);
    const { motivo } = esquemaRevogar.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const [vinculo] = await tx.consultar<{ situacao: string; fonte: string }>('SELECT situacao, fonte FROM vinculos_licitantes WHERE id = $1 FOR UPDATE', [id]);
      if (!vinculo) throw naoEncontrado('Vínculo não encontrado.');
      if (vinculo.situacao !== 'ativo') throw regraNegocio('O vínculo já foi revogado.');
      if (vinculo.fonte === 'declaracao_agente') throw regraNegocio('Vínculo declarado pelo próprio agente só muda com nova declaração dele.');
      await tx.executar(`UPDATE vinculos_licitantes SET situacao = 'revogado', motivo_revogacao = $2 WHERE id = $1`, [id, motivo]);
      await auditar(tx, request, {
        acao: 'impedimentos.vinculo.revogar',
        recurso: 'vinculo_licitante',
        recursoId: id,
        resumo: 'Revogou vínculo registrado',
        dados: { motivo },
      });
    });
    return vinculoPorId(id);
  });

  // ───────── declarações dos agentes (RN-28) ─────────

  async function minhaDeclaracao(request: FastifyRequest): Promise<MinhaDeclaracao> {
    const { usuario } = sessaoDe(request);
    const hoje = ctx.hoje();
    const linha = (await declaracoesVigentes(ctx.banco, [usuario.id])).get(usuario.id) ?? null;
    const dominio = linha ? paraDeclaracaoDominio(linha) : null;
    const registrada = linha ? await declaracaoRegistrada(ctx.banco, linha, hoje) : null;
    return {
      declaracao: registrada,
      aptidao: {
        usuario: { id: usuario.id, nome: usuario.nome },
        declaracao: registrada
          ? { declaradaEm: registrada.declaradaEm, validaAte: registrada.validaAte, vinculo: registrada.vinculo, capacitacao: registrada.capacitacao }
          : null,
        papeis: PAPEIS_PROCESSO.map((papel) => {
          const r = verificarDeclaracaoAgente({ papel, declaracao: dominio, hoje });
          return { papel, apto: r.apto, pendencias: r.pendencias, sinais: r.sinais };
        }),
      },
    };
  }

  app.get('/impedimentos/declaracoes/minha', declarar, async (request): Promise<MinhaDeclaracao> => minhaDeclaracao(request));

  /** Declaração do próprio agente (art. 7º, I a III; art. 9º, § 1º). Substitui a anterior e os vínculos que ela declarava. */
  app.post('/impedimentos/declaracoes', declarar, async (request, reply): Promise<MinhaDeclaracao> => {
    const e = esquemaDeclaracao.parse(request.body);
    const { usuario } = sessaoDe(request);
    const agora = ctx.relogio();
    const evidencia = `Declaração do agente público assinada na Ágora em ${ctx.hoje()}.`;
    validarDeclaracaoAgente(e);
    for (const v of e.vinculosDeclarados) {
      validarVinculoInformado({
        natureza: v.natureza,
        grauParentesco: v.grauParentesco,
        fornecedorId: v.fornecedorId,
        outroFornecedorId: null,
        agenteId: usuario.id,
        fonte: 'declaracao_agente',
        evidencia,
        descricao: v.descricao,
      });
    }
    await ctx.banco.transacao(async (tx) => {
      await exigirFornecedores(tx, e.vinculosDeclarados.map((v) => v.fornecedorId.toLowerCase()));
      await tx.executar('UPDATE declaracoes_agentes SET vigente = false WHERE usuario_id = $1 AND vigente', [usuario.id]);
      await tx.executar(
        `UPDATE vinculos_licitantes SET situacao = 'revogado', motivo_revogacao = 'Substituído por nova declaração do agente.'
          WHERE agente_id = $1 AND fonte = 'declaracao_agente' AND situacao = 'ativo'`,
        [usuario.id],
      );
      const [declaracao] = await tx.consultar<{ id: string }>(
        `INSERT INTO declaracoes_agentes (usuario_id, declarada_em, data_declaracao, sem_parentesco_ou_vinculo, sem_conflito_interesses,
                                          vinculo, cargo_matricula, capacitacao, capacitacao_descricao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [usuario.id, agora.toISOString(), ctx.hoje(), e.semParentescoOuVinculo, e.semConflitoInteresses, e.vinculo, e.cargoMatricula, e.capacitacao, e.capacitacaoDescricao],
      );
      if (!declaracao) throw new Error('Falha ao registrar a declaração');
      for (const v of e.vinculosDeclarados) {
        await tx.executar(
          `INSERT INTO vinculos_licitantes (natureza, grau_parentesco, fornecedor_id, agente_id, fonte, descricao, evidencia, declaracao_id,
                                            registrado_por, registrado_em)
           VALUES ($1, $2, $3, $4, 'declaracao_agente', $5, $6, $7, $4, $8)`,
          [v.natureza, v.grauParentesco, v.fornecedorId.toLowerCase(), usuario.id, v.descricao, evidencia, declaracao.id, agora.toISOString()],
        );
      }
      await auditar(tx, request, {
        acao: 'impedimentos.declaracao.assinar',
        recurso: 'declaracao_agente',
        recursoId: declaracao.id,
        resumo: 'Assinou a declaração de inexistência de impedimento (arts. 7º e 9º)',
        dados: {
          semParentescoOuVinculo: e.semParentescoOuVinculo,
          semConflitoInteresses: e.semConflitoInteresses,
          vinculo: e.vinculo,
          capacitacao: e.capacitacao,
          vinculosDeclarados: e.vinculosDeclarados.length,
        },
      });
    });
    reply.status(201);
    return minhaDeclaracao(request);
  });

  await rotasExtensoes(app);
}
