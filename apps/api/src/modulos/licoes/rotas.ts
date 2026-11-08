/**
 * Lições aprendidas da execução (RIA-12): registro das ocorrências pela fiscalização (art. 117), base de conhecimento
 * por contrato e sugestões de cláusula no DFD, no ETP e no TR de objeto semelhante. A sugestão é sinal: o agente aceita
 * ou recusa, a decisão é auditada e só o que foi aceito entra no rascunho do documento.
 */
import { randomUUID } from 'node:crypto';
import { categoriaPadraoFato, sugerirClausulasLicoes, type DocumentoLicao } from '@agora/dominio';
import type { BaseConhecimentoContrato, LicoesAprendidasProcesso, OcorrenciaExecucao, SugestaoLicaoAprendida } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Executor } from '../../banco/tipos.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota } from '../../http/validacao.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { carregarBaseConhecimento, listarDecisoes, listarOcorrencias, paraDecisao } from './repositorio.ts';

const CATEGORIAS = ['prazo', 'qualidade', 'nivel_servico', 'garantia', 'quantitativo', 'fiscalizacao'] as const;
const DOCUMENTOS = ['dfd', 'etp', 'tr'] as const;
/** Etapa da jornada em que cada documento é preparado (a decisão é tomada nela). */
const ETAPA_DOCUMENTO: Record<DocumentoLicao, number> = { dfd: 1, etp: 3, tr: 4 };
const NOME_DOCUMENTO: Record<DocumentoLicao, string> = { dfd: 'DFD', etp: 'ETP', tr: 'termo de referência' };

const esquemaOcorrencia = z.object({
  tipo: z.enum(['ocorrencia', 'glosa', 'atraso', 'rescisao']),
  categoria: z.enum(CATEGORIAS).nullable().optional(),
  data: dataIso,
  descricao: z.string().trim().min(15).max(2000),
  diasAtraso: z.number().int().positive().max(3650).nullable().optional(),
  valorGlosa: centavos.positive().nullable().optional(),
});

const esquemaSolucao = z.object({ situacao: z.enum(['resolvida_no_prazo', 'resolvida_fora_do_prazo']), resolvidaEm: dataIso });

const esquemaDocumento = z.object({ documento: z.enum(DOCUMENTOS) });

const esquemaDecisao = z.object({
  documento: z.enum(DOCUMENTOS),
  chave: z.string().trim().min(3).max(80),
  decisao: z.enum(['aceita', 'recusada']),
  motivo: z.string().trim().max(2000).nullable().optional(),
});

function pretendidoDe(linha: LinhaProcesso) {
  return { descricao: linha.titulo, itens: linha.dfd.itens.map((i) => ({ catmat: i.catmat, descricao: i.descricao })) };
}

export async function rotasLicoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function contratoNoEscopo(executor: Executor, contratoId: string, escopo: string[] | null): Promise<{ id: string; uasg: string; numero: string; vigencia_inicio: string }> {
    const [contrato] = await executor.consultar<{ id: string; uasg: string; numero: string; vigencia_inicio: string }>(
      'SELECT id, uasg, numero, vigencia_inicio FROM contratos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))',
      [contratoId, escopo],
    );
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  // ───────── ocorrências da execução (art. 117) ─────────

  app.get('/contratos/:id/ocorrencias-execucao', { preHandler: exigir('contratos:ler') }, async (request): Promise<BaseConhecimentoContrato> => {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    await contratoNoEscopo(ctx.banco, id, escopo);
    const ocorrencias = await listarOcorrencias(ctx.banco, { contratoId: id, escopo });
    const base = await carregarBaseConhecimento(ctx.banco, escopo, ctx.hoje(), id);
    return {
      ocorrencias,
      fatosDerivados: base.fatos
        .filter((f) => !f.id.startsWith('ocorrencia:'))
        .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
        .map((f) => ({ tipo: f.tipo, categoria: f.categoria, data: f.data, descricao: f.descricao })),
    };
  });

  app.post('/contratos/:id/ocorrencias-execucao', { preHandler: exigir('licoes:registrar') }, async (request, reply): Promise<OcorrenciaExecucao> => {
    const contratoId = idDaRota(request.params);
    const entrada = esquemaOcorrencia.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const hoje = ctx.hoje();
    const novoId = randomUUID();
    await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoNoEscopo(tx, contratoId, escopo);
      if (entrada.data > hoje) throw regraNegocio('A ocorrência não pode ter data futura.');
      if (entrada.data < contrato.vigencia_inicio) throw regraNegocio('A ocorrência não pode ser anterior ao início da vigência do contrato.');
      if (entrada.tipo === 'atraso' && !entrada.diasAtraso) throw regraNegocio('Informe os dias de atraso.', [{ campo: 'diasAtraso', mensagem: 'Obrigatório para atraso' }]);
      if (entrada.tipo === 'glosa' && !entrada.valorGlosa) throw regraNegocio('Informe o valor glosado.', [{ campo: 'valorGlosa', mensagem: 'Obrigatório para glosa' }]);
      const categoria = entrada.categoria ?? categoriaPadraoFato(entrada.tipo);
      // A rescisão encerra o fato; as demais ficam abertas até a solução.
      const situacao = entrada.tipo === 'rescisao' ? 'resolvida_fora_do_prazo' : 'aberta';
      await tx.executar(
        `INSERT INTO ocorrencias_execucao (id, contrato_id, uasg, tipo, categoria, data, descricao, dias_atraso, valor_glosa, situacao, resolvida_em, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          novoId,
          contrato.id,
          contrato.uasg,
          entrada.tipo,
          categoria,
          entrada.data,
          entrada.descricao,
          entrada.tipo === 'atraso' ? (entrada.diasAtraso ?? null) : null,
          entrada.tipo === 'glosa' ? (entrada.valorGlosa ?? null) : null,
          situacao,
          entrada.tipo === 'rescisao' ? entrada.data : null,
          sessao.usuario.id,
          ctx.relogio().toISOString(),
        ],
      );
      await auditar(tx, request, {
        acao: 'execucao.ocorrencia.registrar',
        recurso: 'ocorrencia_execucao',
        recursoId: novoId,
        resumo: `Registrou ${entrada.tipo === 'ocorrencia' ? 'ocorrência' : entrada.tipo === 'rescisao' ? 'rescisão' : entrada.tipo} na execução do contrato ${contrato.numero}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: contrato.id, tipo: entrada.tipo, categoria, data: entrada.data, diasAtraso: entrada.diasAtraso ?? null, valorGlosa: entrada.valorGlosa ?? null },
      });
    });
    const [criada] = await listarOcorrencias(ctx.banco, { id: novoId, escopo });
    if (!criada) throw naoEncontrado();
    reply.status(201);
    return criada;
  });

  app.post('/ocorrencias-execucao/:id/solucao', { preHandler: exigir('licoes:registrar') }, async (request): Promise<OcorrenciaExecucao> => {
    const id = idDaRota(request.params);
    const entrada = esquemaSolucao.parse(request.body);
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const [atual] = await listarOcorrencias(tx, { id, escopo });
      if (!atual) throw naoEncontrado('Ocorrência não encontrada.');
      if (atual.situacao !== 'aberta') throw regraNegocio('A ocorrência já tem solução registrada.');
      if (entrada.resolvidaEm < atual.data || entrada.resolvidaEm > ctx.hoje()) throw regraNegocio('A data da solução deve estar entre a ocorrência e hoje.');
      await tx.executar('UPDATE ocorrencias_execucao SET situacao = $2, resolvida_em = $3 WHERE id = $1', [id, entrada.situacao, entrada.resolvidaEm]);
      await auditar(tx, request, {
        acao: 'execucao.ocorrencia.solucionar',
        recurso: 'ocorrencia_execucao',
        recursoId: id,
        resumo: `Registrou a solução da ocorrência de ${atual.data} (${entrada.situacao === 'resolvida_no_prazo' ? 'no prazo' : 'fora do prazo'})`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: atual.contratoId, situacao: entrada.situacao, resolvidaEm: entrada.resolvidaEm },
      });
    });
    const [solucionada] = await listarOcorrencias(ctx.banco, { id, escopo });
    if (!solucionada) throw naoEncontrado();
    return solucionada;
  });

  // ───────── sugestões no DFD, no ETP e no TR ─────────

  async function montarLicoes(executor: Executor, processo: LinhaProcesso, documento: DocumentoLicao, escopo: string[] | null): Promise<LicoesAprendidasProcesso> {
    const hoje = ctx.hoje();
    const base = await carregarBaseConhecimento(executor, escopo, hoje);
    const sugestoes = sugerirClausulasLicoes(pretendidoDe(processo), base.contratos, base.fatos, documento, hoje);
    const decisoes = await listarDecisoes(executor, processo.id, documento);
    const porChave = new Map(decisoes.map((d) => [d.chave, d]));
    const comDecisao: SugestaoLicaoAprendida[] = sugestoes.map((s) => {
      const d = porChave.get(s.chave);
      return { ...s, decisao: d ? paraDecisao(d) : null };
    });
    const chaves = new Set(sugestoes.map((s) => s.chave));
    return {
      documento,
      sugestoes: comDecisao,
      decisoesAnteriores: decisoes.filter((d) => !chaves.has(d.chave)).map(paraDecisao),
      contratosAnalisados: base.contratos.length,
      consultadoEm: hoje,
    };
  }

  app.get('/processos/:id/licoes-aprendidas', { preHandler: exigir('jornada:ler') }, async (request): Promise<LicoesAprendidasProcesso> => {
    const id = idDaRota(request.params);
    const { documento } = esquemaDocumento.parse(request.query);
    const escopo = escopoUasgs(sessaoDe(request));
    const processo = await obterLinhaProcesso(ctx.banco, id, escopo);
    if (!processo) throw naoEncontrado('Processo não encontrado.');
    return montarLicoes(ctx.banco, processo, documento, escopo);
  });

  app.post('/processos/:id/licoes-aprendidas/decisoes', { preHandler: exigir('jornada:editar') }, async (request): Promise<LicoesAprendidasProcesso> => {
    const id = idDaRota(request.params);
    const entrada = esquemaDecisao.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    if (entrada.decisao === 'recusada' && (entrada.motivo ?? '').trim().length < 10) {
      throw regraNegocio('Registre o motivo da recusa (ao menos 10 caracteres).', [{ campo: 'motivo', mensagem: 'Obrigatório ao recusar' }]);
    }
    await ctx.banco.transacao(async (tx) => {
      const processo = await obterLinhaProcesso(tx, id, escopo, true);
      if (!processo) throw naoEncontrado('Processo não encontrado.');
      const etapa = ETAPA_DOCUMENTO[entrada.documento];
      if (processo.etapa_atual !== etapa) {
        throw regraNegocio(`A decisão sobre as lições do ${NOME_DOCUMENTO[entrada.documento]} é tomada na etapa ${etapa} da jornada.`, [
          { campo: 'RIA-12', mensagem: `O processo está na etapa ${processo.etapa_atual}.` },
        ]);
      }
      const { sugestoes } = await montarLicoes(tx, processo, entrada.documento, escopo);
      const sugestao = sugestoes.find((s) => s.chave === entrada.chave);
      if (!sugestao) throw regraNegocio('A sugestão não está mais disponível para este processo. Atualize a página.');
      const { decisao: _anterior, ...instantaneo } = sugestao;
      const motivo = entrada.motivo?.trim() || null;
      const agora = ctx.relogio().toISOString();
      await tx.executar(
        `INSERT INTO licoes_decisoes (id, processo_id, documento, chave, decisao, motivo, sugestao, decidida_por, decidida_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (processo_id, documento, chave) DO UPDATE SET decisao = $5, motivo = $6, sugestao = $7::jsonb, decidida_por = $8, decidida_em = $9`,
        [randomUUID(), processo.id, entrada.documento, entrada.chave, entrada.decisao, motivo, JSON.stringify(instantaneo), sessao.usuario.id, agora],
      );
      await auditar(tx, request, {
        acao: 'processo.licao.decidir',
        recurso: 'processo',
        recursoId: processo.id,
        resumo: `${entrada.decisao === 'aceita' ? 'Aceitou' : 'Recusou'} a lição aprendida "${sugestao.titulo}" no ${NOME_DOCUMENTO[entrada.documento]} (RIA-12)`,
        dados: {
          numeroSei: processo.numero_sei,
          etapa: processo.etapa_atual,
          documento: entrada.documento,
          chave: entrada.chave,
          decisao: entrada.decisao,
          motivo,
          contratosOrigem: sugestao.fontes.map((f) => f.numero),
          decisaoAnterior: sugestao.decisao?.decisao ?? null,
        },
      });
    });
    const processo = await obterLinhaProcesso(ctx.banco, id, escopo);
    if (!processo) throw naoEncontrado('Processo não encontrado.');
    return montarLicoes(ctx.banco, processo, entrada.documento, escopo);
  });
}
