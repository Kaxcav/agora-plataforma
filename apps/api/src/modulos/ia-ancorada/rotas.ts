/**
 * IA ancorada (F24): base normativa soberana (RNF-08), conferência de citações e IMR-02 (RIA-14), conferência cruzada
 * entre documentos e auditor contínuo da 2ª linha (RIA-15). Leituras com permissão e escopo de UASG no servidor; a
 * única escrita — a revisão humana das citações — é transacional e auditada.
 */
import { randomUUID } from 'node:crypto';
import {
  MODELOS_PADRONIZADOS,
  buscarNaBaseNormativa,
  rotuloArtigo,
  rotuloParagrafo,
  type IncisoLei,
} from '@agora/dominio';
import type {
  ArtigoLeiApi,
  CitacoesDocumento,
  ConferenciaCitacoesApi,
  ConferenciaCruzadaApi,
  IncisoLeiApi,
  ModeloPadronizadoApi,
  PainelAuditorIa,
  PainelQualidadeNormativa,
  ResultadoBuscaNormas,
  ResumoBaseNormativa,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, exigirAlguma, exigirPermissaoNoHandler, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { codigoUasg, idDaRota } from '../../http/validacao.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { conferirCitacoes, indiceNormativo } from '../../ia/base-normativa.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { montarPainelAuditorIa } from './auditor.ts';
import { citacoesDoDocumento, conferenciaCruzada, documentosDoProcesso, montarPainelQualidade, paraConferenciaApi } from './servico.ts';

const esquemaBusca = z.object({ q: z.string().trim().min(1).max(200), limite: z.coerce.number().int().min(1).max(50).default(10) });
const esquemaConferir = z.object({ texto: z.string().min(1).max(100_000) });
const esquemaRevisao = z.object({ justificativa: z.string().trim().min(30, 'Justifique em ao menos 30 caracteres').max(2000) });
const esquemaQualidade = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM')
    .optional(),
  uasg: codigoUasg.optional(),
});
const esquemaUasg = z.object({ uasg: codigoUasg.optional() });
const PADRAO_NUMERO_ARTIGO = /^\d{1,3}(-[A-Z])?$/;

function incisosApi(lista: readonly IncisoLei[]): IncisoLeiApi[] {
  return lista.map((i) => ({ numero: i.numero, texto: i.texto, alineas: i.alineas.map((a) => ({ letra: a.letra, texto: a.texto })) }));
}

export async function rotasIaAncorada(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const normas = { preHandler: exigir('normas:ler') };

  // ───────── base normativa (RNF-08) ─────────

  app.get('/normas', normas, async (): Promise<ResumoBaseNormativa> => {
    const { base } = indiceNormativo();
    const divisoes: ResumoBaseNormativa['divisoes'] = [];
    for (const artigo of base.artigos) {
      const titulo = artigo.titulos.slice(0, 2).join(' › ');
      const ultima = divisoes.at(-1);
      if (ultima && ultima.titulo === titulo) ultima.ultimoArtigo = artigo.numero;
      else divisoes.push({ titulo, primeiroArtigo: artigo.numero, ultimoArtigo: artigo.numero });
    }
    return { norma: { id: base.norma.id, titulo: base.norma.titulo, ementa: base.norma.ementa }, proveniencia: base.proveniencia, totalArtigos: base.artigos.length, divisoes };
  });

  app.get('/normas/busca', normas, async (request): Promise<ResultadoBuscaNormas> => {
    const { q, limite } = esquemaBusca.parse(request.query);
    return { consulta: q, resultados: buscarNaBaseNormativa(indiceNormativo(), q, limite) };
  });

  app.get('/normas/artigos/:numero', normas, async (request): Promise<ArtigoLeiApi> => {
    const numero = String((request.params as { numero?: unknown }).numero ?? '').toUpperCase();
    if (!PADRAO_NUMERO_ARTIGO.test(numero)) throw naoEncontrado('Artigo não encontrado na base normativa.');
    const { base, artigos } = indiceNormativo();
    const artigo = artigos.get(numero);
    if (!artigo) throw naoEncontrado(`O ${rotuloArtigo(numero)} não existe na ${base.norma.titulo}.`);
    const posicao = base.artigos.indexOf(artigo);
    return {
      numero: artigo.numero,
      rotulo: rotuloArtigo(artigo.numero),
      caput: artigo.caput,
      incisos: incisosApi(artigo.incisos),
      paragrafos: artigo.paragrafos.map((p) => ({ numero: p.numero, rotulo: rotuloParagrafo(p.numero), texto: p.texto, incisos: incisosApi(p.incisos) })),
      titulos: [...artigo.titulos],
      textoAlterador: [...artigo.textoAlterador],
      anterior: base.artigos[posicao - 1]?.numero ?? null,
      proximo: base.artigos[posicao + 1]?.numero ?? null,
      norma: base.norma.titulo,
      proveniencia: base.proveniencia,
    };
  });

  app.get('/normas/modelos', normas, async (): Promise<ModeloPadronizadoApi[]> =>
    Object.values(MODELOS_PADRONIZADOS).map((m) => ({
      tipo: m.tipo,
      documento: m.documento,
      fundamento: m.fundamento,
      secoes: m.secoes.map((s) => ({ id: s.id, titulo: s.titulo, fundamento: s.fundamento })),
    })),
  );

  /** Confere as citações de um texto colado (minuta externa, parecer, rascunho): leitura, sem gravação. */
  app.post('/normas/conferir', normas, async (request): Promise<ConferenciaCitacoesApi> => {
    const { texto } = esquemaConferir.parse(request.body);
    return paraConferenciaApi(conferirCitacoes(texto), ctx.relogio());
  });

  // ───────── citações dos documentos do processo (RIA-14) ─────────

  async function processoVisivel(request: FastifyRequest): Promise<{ id: string; numero_sei: string }> {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return linha;
  }

  app.get('/processos/:id/citacoes', { preHandler: exigir('jornada:ler') }, async (request): Promise<CitacoesDocumento[]> => {
    const processo = await processoVisivel(request);
    const agora = ctx.relogio();
    return (await documentosDoProcesso(ctx.banco, processo.id)).map((d) => citacoesDoDocumento(d, agora));
  });

  app.post(
    '/processos/:id/documentos/:docId/citacoes/revisao',
    { preHandler: exigirAlguma(['jornada:editar', 'jornada:aprovar_juridico']) },
    async (request): Promise<CitacoesDocumento> => {
      const { justificativa } = esquemaRevisao.parse(request.body);
      const processoId = idDaRota(request.params);
      const documentoId = idDaRota(request.params, 'docId');
      const sessao = sessaoDe(request);
      const agora = ctx.relogio();
      await ctx.banco.transacao(async (tx) => {
        const linha = await obterLinhaProcesso(tx, processoId, escopoUasgs(sessao), true);
        if (!linha) throw naoEncontrado('Processo não encontrado.');
        const [doc] = await tx.consultar<{ id: string; tipo: string; titulo: string; versao: number; conteudo: string; situacao: string }>(
          'SELECT id, tipo, titulo, versao, conteudo, situacao FROM documentos_gerados WHERE id = $1 AND processo_id = $2 FOR UPDATE',
          [documentoId, processoId],
        );
        if (!doc) throw naoEncontrado('Documento não encontrado.');
        // Mesma permissão da aprovação: o checklist do parecer é da assessoria jurídica.
        exigirPermissaoNoHandler(request, doc.tipo === 'parecer_checklist' ? 'jornada:aprovar_juridico' : 'jornada:editar');
        if (doc.situacao === 'aprovado') throw regraNegocio(`A versão ${doc.versao} de "${doc.titulo}" já está aprovada.`);
        const conferencia = conferirCitacoes(doc.conteudo);
        const apontadas = conferencia.citacoes.filter((c) => c.situacao !== 'confere' && c.situacao !== 'outra_norma');
        if (apontadas.length === 0) throw regraNegocio('A conferência não apontou citação para revisar neste documento.');
        const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM revisoes_citacoes WHERE documento_id = $1', [doc.id]);
        if (existente) throw conflito('A revisão das citações desta versão já foi registrada.');
        const hash = sha256Hex(doc.conteudo);
        await tx.executar(
          `INSERT INTO revisoes_citacoes (id, documento_id, processo_id, hash_conteudo, citacoes, justificativa, revisado_por, revisado_em)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
          [
            randomUUID(),
            doc.id,
            processoId,
            hash,
            JSON.stringify(apontadas.map((c) => ({ trecho: c.trecho, situacao: c.situacao, motivo: c.motivo }))),
            justificativa,
            sessao.usuario.id,
            agora.toISOString(),
          ],
        );
        await auditar(tx, request, {
          acao: 'processo.documento.citacoes.revisar',
          recurso: 'processo',
          recursoId: processoId,
          resumo: `Registrou a revisão humana de ${apontadas.length === 1 ? '1 citação apontada' : `${apontadas.length} citações apontadas`} em "${doc.titulo}" (versão ${doc.versao})`,
          dados: {
            numeroSei: linha.numero_sei,
            documentoId: doc.id,
            tipo: doc.tipo,
            versao: doc.versao,
            hashConteudo: hash,
            inexistentes: conferencia.inexistentes,
            semEfeito: conferencia.semEfeito,
            suspeitas: conferencia.suspeitas,
          },
        });
      });
      const atualizado = (await documentosDoProcesso(ctx.banco, processoId)).find((d) => d.id === documentoId);
      if (!atualizado) throw naoEncontrado('Documento não encontrado.');
      return citacoesDoDocumento(atualizado, agora);
    },
  );

  // ───────── conferência cruzada (RIA-15) ─────────

  app.get('/processos/:id/conferencia-cruzada', { preHandler: exigir('jornada:ler') }, async (request): Promise<ConferenciaCruzadaApi> => {
    const processo = await processoVisivel(request);
    return conferenciaCruzada(processo.id, await documentosDoProcesso(ctx.banco, processo.id), ctx.relogio());
  });

  // ───────── painel de qualidade normativa (IMR-02) ─────────

  app.get('/qualidade-normativa', { preHandler: exigir('qualidade_ia:ler') }, async (request): Promise<PainelQualidadeNormativa> => {
    const f = esquemaQualidade.parse(request.query);
    return montarPainelQualidade(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)), uasg: f.uasg ?? null, mes: f.mes ?? ctx.hoje().slice(0, 7) }, ctx.relogio());
  });

  // ───────── auditor contínuo da 2ª linha (RIA-15) ─────────

  app.get('/controle/auditor-ia', { preHandler: exigir('controle:segunda_linha') }, async (request): Promise<PainelAuditorIa> => {
    const { uasg } = esquemaUasg.parse(request.query);
    return montarPainelAuditorIa({ executor: ctx.banco, escopo: escopoUasgs(sessaoDe(request)), uasg: uasg ?? null, hoje: ctx.hoje(), agora: ctx.relogio() });
  });
}
