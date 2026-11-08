/**
 * Frente P — dotação orçamentária (RN-39), checklist das peças (RF-32) e PDF dos documentos da jornada.
 * As peças complementares são geradas, aprovadas e assinadas pelas rotas de documentos da jornada.
 *
 * GET /processos/:id/dotacao                  → DotacaoProcesso (jornada:ler)
 * PUT /processos/:id/dotacao                  → DotacaoProcesso (jornada:editar; até a etapa 4; auditada)
 * GET /processos/:id/checklist-documentos     → ChecklistDocumentosProcesso (jornada:ler)
 * GET /processos/:id/documentos/:docId/pdf    → application/pdf (jornada:ler)
 */
import { randomUUID } from 'node:crypto';
import { normalizarNaturezaDespesa, normalizarProgramaTrabalho, validarDotacaoOrcamentaria, MAXIMO_LINHAS_DOTACAO } from '@agora/dominio';
import type { ChecklistDocumentosProcesso, DotacaoProcesso } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, idDaRota } from '../../http/validacao.ts';
import { carregarProcesso, obterLinhaProcesso } from '../jornada/repositorio.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import { montarChecklistDocumentos } from './checklist.ts';
import { carregarDotacao, dotacaoEditavel, gravarDotacao, hashDotacao, montarDotacaoProcesso } from './dotacao.ts';
import { pdfDocumentoJornada } from './pdf.ts';

const linhaDotacao = z.object({
  unidadeGestora: z.string().trim().regex(/^\d{6}$/, 'A unidade gestora tem 6 dígitos.'),
  programaTrabalho: z
    .string()
    .max(40)
    .transform(normalizarProgramaTrabalho)
    .pipe(z.string().regex(/^\d{2}\.\d{3}\.\d{4}\.[0-9A-Z]{4}\.\d{4}$/, 'O programa de trabalho segue o formato 00.000.0000.0000.0000.')),
  naturezaDespesa: z
    .string()
    .max(20)
    .transform(normalizarNaturezaDespesa)
    .pipe(z.string().regex(/^[34]\.[1-6]\.\d{2}\.\d{2}$/, 'A natureza da despesa segue o formato categoria.grupo.modalidade.elemento (ex.: 3.3.90.30).')),
  fonteRecursos: z.string().trim().regex(/^(\d{3}|\d{4}|\d{10})$/, 'A fonte de recursos tem 10 dígitos (ou 3 a 4 na classificação anterior).'),
  exercicio: z.number().int().min(2000).max(2100),
  valor: centavos.positive(),
  preEmpenho: z
    .string()
    .max(12)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim().toUpperCase() : null))
    .refine((v) => v === null || /^\d{4}PE\d{6}$/.test(v), 'O pré-empenho segue o formato AAAAPE000000.'),
});

const esquemaDotacao = z.object({ linhas: z.array(linhaDotacao).max(MAXIMO_LINHAS_DOTACAO) });

export async function rotasPreparatorios(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('jornada:ler') };
  const edicao = { preHandler: exigir('jornada:editar') };

  async function carga(request: FastifyRequest, id: string) {
    const linha = await obterLinhaProcesso(ctx.banco, id, escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return carregarProcesso(ctx.banco, linha);
  }

  async function dotacao(request: FastifyRequest, id: string): Promise<DotacaoProcesso> {
    const c = await carga(request, id);
    const hoje = ctx.hoje();
    return montarDotacaoProcesso(c, hoje, valorEstimadoProcesso(c.linha.dfd, analisarCesta(c.linha.cesta, hoje)));
  }

  app.get('/processos/:id/dotacao', leitura, async (request) => dotacao(request, idDaRota(request.params)));

  app.put('/processos/:id/dotacao', edicao, async (request) => {
    const { linhas } = esquemaDotacao.parse(request.body);
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    const agora = ctx.relogio();
    const hoje = ctx.hoje();
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopoUasgs(sessao), true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      if (!dotacaoEditavel(linha)) {
        throw regraNegocio('A dotação orçamentária é da fase preparatória (até a etapa 4 — TR, edital e minuta), já concluída neste processo.');
      }
      const hashAnterior = hashDotacao((await carregarDotacao(tx, linha.id)).linhas);
      await gravarDotacao(tx, linha.id, linhas, { usuarioId: sessao.usuario.id, agora, novoId: randomUUID });
      const validacao = validarDotacaoOrcamentaria(linhas, { hoje, valorEstimado: valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, hoje)) });
      const hash = hashDotacao(linhas);
      await auditar(tx, request, {
        acao: 'processo.dotacao.atualizar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Atualizou a dotação orçamentária do processo (${linhas.length} crédito(s))${hashAnterior !== null && hashAnterior !== hash ? '; a declaração de adequação orçamentária anterior deixa de valer' : ''}`,
        dados: {
          numeroSei: linha.numero_sei,
          etapa: linha.etapa_atual,
          linhas: linhas.length,
          exercicios: [...new Set(linhas.map((l) => l.exercicio))].sort(),
          total: validacao.total,
          hashDotacao: hash,
          hashAnterior,
          pendencias: validacao.pendencias.length,
        },
      });
    });
    return dotacao(request, id);
  });

  app.get('/processos/:id/checklist-documentos', leitura, async (request): Promise<ChecklistDocumentosProcesso> =>
    montarChecklistDocumentos(await carga(request, idDaRota(request.params))),
  );

  app.get('/processos/:id/documentos/:docId/pdf', leitura, async (request, reply) => {
    const id = idDaRota(request.params);
    const docId = idDaRota(request.params, 'docId');
    const [documento] = await ctx.banco.consultar<{ tipo: string; titulo: string; versao: number; conteudo: string; numero_sei: string }>(
      `SELECT d.tipo, d.titulo, d.versao, d.conteudo, p.numero_sei
         FROM documentos_gerados d
         JOIN processos p ON p.id = d.processo_id
        WHERE d.id = $1 AND d.processo_id = $2 AND ($3::text[] IS NULL OR p.uasg = ANY($3::text[]))`,
      [docId, id, escopoUasgs(sessaoDe(request))],
    );
    if (!documento) throw naoEncontrado('Documento não encontrado.');
    const arquivo = pdfDocumentoJornada(documento, documento.numero_sei);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${arquivo.nomeArquivo}"`)
      .header('cache-control', 'no-store')
      .send(arquivo.pdf);
  });
}
