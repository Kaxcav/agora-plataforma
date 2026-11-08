/**
 * Avaliação de desempenho do contratado e registro cadastral de atestos (RN-37, RF-30; Lei 14.133/2021, arts. 87 e 88,
 * §§ 2º a 4º), uso no desempate (art. 60, II), na pontuação técnica (art. 36, § 3º; art. 37, III) e incentivo ao bom
 * desempenho (art. 88, § 4º). O gestor ou o fiscal designado emite; o contratado se manifesta; a avaliação definitiva
 * entra no registro. Toda escrita é transacional e auditada.
 */
import { randomUUID } from 'node:crypto';
import {
  avaliarDesempenhoContratado,
  avaliarIncentivoDesempenho,
  mascararDocumento,
  redigirCertificadoDesempenho,
  redigirDocumentoAvaliacaoDesempenho,
  simularImpactoDesempenho,
  validarAnaliseManifestacao,
  validarCriterioDesempenhoTecnica,
  validarManifestacaoContratado,
  type DadosDocumentoAvaliacao,
} from '@agora/dominio';
import type {
  AvaliacaoDesempenho,
  AvaliacoesContrato,
  CertificadoDesempenho,
  CriterioDesempenhoEdital,
  NotaRegistroDesempenho,
  PreviaAvaliacaoDesempenho,
  RegistroDesempenhoFornecedor,
  ResultadoSimulacaoDesempenho,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Executor } from '../../banco/tipos.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { carregarFornecedor, nomeExibivel } from '../fornecedores/repositorio.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { markdownParaPdf } from './pdf.ts';
import {
  avaliadorDoContrato,
  carregarContratoAvaliado,
  carregarRegistros,
  derivadosDoPeriodo,
  listarCertificados,
  listarLinhasAvaliacoes,
  obterLinhaCriterio,
  paraAvaliacao,
  paraCertificado,
  paraResumo,
  proximoProtocolo,
  type AnaliseArmazenada,
  type ContratoAvaliado,
  type LinhaAvaliacao,
  type ManifestacaoArmazenada,
} from './repositorio.ts';

const contagem = z.number().int().min(0).max(1_000_000);

const esquemaAvaliacao = z.object({
  tipo: z.enum(['parcial', 'final']),
  periodoInicio: dataIso,
  periodoFim: dataIso,
  entregasNoPrazo: contagem,
  entregasTotal: contagem,
  recebimentosAprovados: contagem,
  recebimentosTotal: contagem,
  evidencias: z.string().trim().min(10).max(2000),
  motivacao: z.string().trim().min(1).max(5000),
});

const esquemaPrevia = z.object({ periodoInicio: dataIso, periodoFim: dataIso });

const esquemaManifestacao = z.object({
  texto: z.string().trim().min(1).max(5000),
  recebidaEm: dataIso,
  concorda: z.boolean(),
});

const esquemaAnalise = z.object({
  decisao: z.enum(['mantida', 'revista']),
  motivacao: z.string().trim().min(1).max(5000),
  entregasNoPrazo: contagem.optional(),
  entregasTotal: contagem.optional(),
  recebimentosAprovados: contagem.optional(),
  recebimentosTotal: contagem.optional(),
});

const esquemaCertificado = z.object({ tipo: z.enum(['certificado', 'declaracao']) });

const esquemaNotas = z.object({
  fornecedores: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .transform((s) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(uuid).min(1).max(50)),
});

const esquemaSimulacao = z.object({
  licitantes: z
    .array(z.object({ fornecedorId: uuid, valorProposta: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), notaProposta: z.number().min(0).max(100).nullable().optional() }))
    .min(2)
    .max(20),
  criterio: z
    .object({
      pesoDesempenhoPercentual: z.number().gt(0).max(100),
      notaSemHistorico: z.number().min(0).max(100),
      regulamento: z.string().trim().max(500),
      pesoTecnicoPercentual: z.number().gt(0).max(70),
    })
    .nullable()
    .optional(),
});

const esquemaCriterio = z.object({
  adotado: z.boolean(),
  pesoDesempenhoPercentual: z.number().gt(0).max(100).nullable().optional(),
  notaSemHistorico: z.number().min(0).max(100).nullable().optional(),
  regulamento: z.string().trim().max(500).nullable().optional(),
});

function orgaoDe(c: Pick<ContratoAvaliado, 'uasg_sigla' | 'uasg_nome'>): string {
  return `${c.uasg_sigla} — ${c.uasg_nome}`;
}

/** Dados do documento a partir da avaliação gravada (ou a gravar) e do contrato. */
function dadosDocumento(c: ContratoAvaliado, a: Omit<DadosDocumentoAvaliacao, 'orgao' | 'uasg' | 'contrato' | 'fornecedor'>): DadosDocumentoAvaliacao {
  return {
    ...a,
    orgao: orgaoDe(c),
    uasg: c.uasg,
    contrato: { numero: c.numero, objeto: c.objeto, vigenciaInicio: c.vigencia_inicio, vigenciaFim: c.vigencia_fim, valorInicial: c.valor_inicial },
    fornecedor: { nome: nomeExibivel(c.tipo_pessoa, c.razao_social), documento: mascararDocumento(c.documento) },
  };
}

function documentoDaLinha(c: ContratoAvaliado, l: LinhaAvaliacao, resultadoNota?: Pick<LinhaAvaliacao, 'nota' | 'faixa' | 'calculo'>): string {
  const r = resultadoNota ?? l;
  return redigirDocumentoAvaliacaoDesempenho(
    dadosDocumento(c, {
      protocolo: l.protocolo,
      versao: l.versao,
      tipo: l.tipo,
      periodoInicio: l.periodo_inicio,
      periodoFim: l.periodo_fim,
      avaliador: { nome: l.avaliador_nome, papel: l.papel_avaliador },
      dataEmissao: l.data_emissao,
      indicadores: l.indicadores,
      evidencias: l.evidencias,
      motivacao: l.motivacao,
      resultado: {
        nota: r.nota,
        faixa: r.faixa,
        componentes: r.calculo.componentes,
        penalidades: r.calculo.penalidades,
        metodologia: r.calculo.metodologia,
        aviso: 'A avaliação de desempenho não é sanção e não impede a participação em licitações. A nota resulta só dos indicadores aferidos e das penalidades aplicadas no período; a motivação do avaliador explica os fatos, sem alterar a nota.',
        prazoManifestacao: l.prazo_manifestacao,
      },
      manifestacao: l.manifestacao ? { texto: l.manifestacao.texto, recebidaEm: l.manifestacao.recebidaEm, concorda: l.manifestacao.concorda } : null,
      analise: l.analise ? { decisao: l.analise.decisao, motivacao: l.analise.motivacao, data: l.analise.data, por: l.analise.por.nome } : null,
    }),
  );
}

export async function rotasDesempenho(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function avaliacaoDoEscopo(executor: Executor, id: string, escopo: string[] | null): Promise<{ linha: LinhaAvaliacao; contrato: ContratoAvaliado }> {
    const [linha] = await listarLinhasAvaliacoes(executor, { id });
    if (!linha) throw naoEncontrado('Avaliação não encontrada.');
    const contrato = await carregarContratoAvaliado(executor, linha.contrato_id, escopo);
    if (!contrato) throw naoEncontrado('Avaliação não encontrada.');
    return { linha, contrato };
  }

  async function responderAvaliacao(id: string): Promise<AvaliacaoDesempenho> {
    const [linha] = await listarLinhasAvaliacoes(ctx.banco, { id });
    if (!linha) throw naoEncontrado('Avaliação não encontrada.');
    return paraAvaliacao(linha, ctx.hoje());
  }

  // ───────── avaliação no contrato ─────────

  app.get('/contratos/:id/avaliacoes-desempenho', { preHandler: exigir('contratos:ler') }, async (request): Promise<AvaliacoesContrato> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    const contrato = await carregarContratoAvaliado(ctx.banco, id, escopoUasgs(sessao));
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    const hoje = ctx.hoje();
    const linhas = await listarLinhasAvaliacoes(ctx.banco, { contratoId: id });
    return {
      avaliador: avaliadorDoContrato(contrato, sessao.usuario.id, sessao.permissoes.has('desempenho:avaliar')),
      avaliacoes: linhas.map((l) => paraAvaliacao(l, hoje)),
    };
  });

  app.get('/contratos/:id/avaliacoes-desempenho/previa', { preHandler: exigir('contratos:ler') }, async (request): Promise<PreviaAvaliacaoDesempenho> => {
    const id = idDaRota(request.params);
    const { periodoInicio, periodoFim } = esquemaPrevia.parse(request.query);
    const sessao = sessaoDe(request);
    const contrato = await carregarContratoAvaliado(ctx.banco, id, escopoUasgs(sessao));
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    const derivados = await derivadosDoPeriodo(ctx.banco, id, periodoInicio, periodoFim);
    return {
      periodoInicio,
      periodoFim,
      vigenciaInicio: contrato.vigencia_inicio,
      vigenciaFim: contrato.vigencia_fim,
      ocorrencias: derivados.ocorrencias,
      sancoesNoPeriodo: derivados.sancoes,
      avaliador: avaliadorDoContrato(contrato, sessao.usuario.id, sessao.permissoes.has('desempenho:avaliar')),
    };
  });

  app.post('/contratos/:id/avaliacoes-desempenho', { preHandler: exigir('desempenho:avaliar') }, async (request, reply): Promise<AvaliacaoDesempenho> => {
    const id = idDaRota(request.params);
    const entrada = esquemaAvaliacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio();
    const calendario = await opcoesCalendario(ctx.banco);
    const avaliacaoId = randomUUID();
    await ctx.banco.transacao(async (tx) => {
      const contrato = await carregarContratoAvaliado(tx, id, escopoUasgs(sessao));
      if (!contrato) throw naoEncontrado('Contrato não encontrado.');
      const avaliador = avaliadorDoContrato(contrato, sessao.usuario.id, true);
      if (!avaliador.podeAvaliar || avaliador.papel === null) {
        throw regraNegocio(avaliador.motivo ?? 'Avaliação não permitida.', [{ campo: 'RN-37', mensagem: 'O gestor ou o fiscal designado do contrato emite a avaliação (art. 88, § 3º; art. 117).' }]);
      }
      const derivados = await derivadosDoPeriodo(tx, id, entrada.periodoInicio, entrada.periodoFim);
      const indicadores = {
        entregasNoPrazo: entrada.entregasNoPrazo,
        entregasTotal: entrada.entregasTotal,
        recebimentosAprovados: entrada.recebimentosAprovados,
        recebimentosTotal: entrada.recebimentosTotal,
        ocorrenciasFiscalizacao: derivados.ocorrencias.total,
        ocorrenciasResolvidasNoPrazo: derivados.ocorrencias.resolvidasNoPrazo,
      };
      const r = avaliarDesempenhoContratado(
        {
          tipo: entrada.tipo,
          periodoInicio: entrada.periodoInicio,
          periodoFim: entrada.periodoFim,
          vigenciaInicio: contrato.vigencia_inicio,
          vigenciaFim: contrato.vigencia_fim,
          indicadores,
          sancoes: derivados.sancoes,
          motivacao: entrada.motivacao,
        },
        hoje,
        calendario,
      );
      const protocolo = await proximoProtocolo(tx, hoje);
      const calculo = { componentes: r.componentes, penalidades: r.penalidades, metodologia: r.metodologia };
      const linha: LinhaAvaliacao = {
        id: avaliacaoId,
        contrato_id: contrato.id,
        contrato_numero: contrato.numero,
        contrato_objeto: contrato.objeto,
        fornecedor_id: contrato.fornecedor_id,
        tipo_pessoa: contrato.tipo_pessoa,
        razao_social: contrato.razao_social,
        uasg: contrato.uasg,
        tipo: entrada.tipo,
        periodo_inicio: entrada.periodoInicio,
        periodo_fim: entrada.periodoFim,
        indicadores,
        evidencias: entrada.evidencias,
        motivacao: entrada.motivacao,
        nota: r.nota,
        faixa: r.faixa,
        calculo,
        avaliador_id: sessao.usuario.id,
        avaliador_nome: sessao.usuario.nome,
        papel_avaliador: avaliador.papel,
        emitida_em: agora.toISOString(),
        data_emissao: hoje,
        prazo_manifestacao: r.prazoManifestacao,
        manifestacao: null,
        analise: null,
        versao: 1,
        documento: '',
        hash_documento: '',
        protocolo,
      };
      const documento = documentoDaLinha(contrato, linha);
      const hash = sha256Hex(documento);
      await tx.executar(
        `INSERT INTO avaliacoes_desempenho (id, contrato_id, fornecedor_id, uasg, tipo, periodo_inicio, periodo_fim, indicadores, evidencias, motivacao,
                                            nota, faixa, calculo, avaliador_id, papel_avaliador, emitida_em, data_emissao, prazo_manifestacao,
                                            documento, hash_documento, protocolo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          avaliacaoId,
          contrato.id,
          contrato.fornecedor_id,
          contrato.uasg,
          entrada.tipo,
          entrada.periodoInicio,
          entrada.periodoFim,
          JSON.stringify(indicadores),
          entrada.evidencias,
          entrada.motivacao,
          r.nota,
          r.faixa,
          JSON.stringify(calculo),
          sessao.usuario.id,
          avaliador.papel,
          agora.toISOString(),
          hoje,
          r.prazoManifestacao,
          documento,
          hash,
          protocolo,
        ],
      );
      await auditar(tx, request, {
        acao: 'desempenho.avaliacao.emitir',
        recurso: 'avaliacao_desempenho',
        recursoId: avaliacaoId,
        resumo: `Emitiu a avaliação de desempenho ${entrada.tipo === 'final' ? 'final' : 'parcial'} do contrato ${contrato.numero} (nota ${r.nota}, protocolo ${protocolo})`,
        dados: {
          instrumentoTipo: 'contrato',
          instrumentoId: contrato.id,
          fornecedorId: contrato.fornecedor_id,
          protocolo,
          tipo: entrada.tipo,
          periodo: [entrada.periodoInicio, entrada.periodoFim],
          indicadores,
          nota: r.nota,
          faixa: r.faixa,
          papel: avaliador.papel,
          prazoManifestacao: r.prazoManifestacao,
          hashDocumento: hash,
          envioCadastro: 'aguardando_cadastro_pncp',
        },
      });
    });
    reply.status(201);
    return responderAvaliacao(avaliacaoId);
  });

  app.post('/avaliacoes-desempenho/:id/manifestacao', { preHandler: exigir('desempenho:avaliar') }, async (request): Promise<AvaliacaoDesempenho> => {
    const id = idDaRota(request.params);
    const entrada = esquemaManifestacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio();
    await ctx.banco.transacao(async (tx) => {
      const { linha, contrato } = await avaliacaoDoEscopo(tx, id, escopoUasgs(sessao));
      if (!avaliadorDoContrato(contrato, sessao.usuario.id, true).podeAvaliar) {
        throw regraNegocio('Só o gestor ou o fiscal designado do contrato registra a manifestação do contratado.', [{ campo: 'RN-37', mensagem: 'Art. 117' }]);
      }
      if (linha.manifestacao) throw regraNegocio('A manifestação do contratado já foi registrada para esta avaliação.');
      const m = validarManifestacaoContratado(entrada, { dataEmissao: linha.data_emissao, prazoManifestacao: linha.prazo_manifestacao }, hoje);
      const manifestacao: ManifestacaoArmazenada = {
        texto: m.texto,
        recebidaEm: entrada.recebidaEm,
        concorda: entrada.concorda,
        registradaPor: { id: sessao.usuario.id, nome: sessao.usuario.nome },
        registradaEm: agora.toISOString(),
      };
      const documento = documentoDaLinha(contrato, { ...linha, manifestacao });
      const hash = sha256Hex(documento);
      await tx.executar('UPDATE avaliacoes_desempenho SET manifestacao = $2::jsonb, documento = $3, hash_documento = $4 WHERE id = $1', [
        id,
        JSON.stringify(manifestacao),
        documento,
        hash,
      ]);
      await auditar(tx, request, {
        acao: 'desempenho.avaliacao.manifestacao',
        recurso: 'avaliacao_desempenho',
        recursoId: id,
        resumo: `Registrou a manifestação do contratado sobre a avaliação ${linha.protocolo} (${entrada.concorda ? 'concorda' : 'discorda'})`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: linha.contrato_id, protocolo: linha.protocolo, recebidaEm: entrada.recebidaEm, concorda: entrada.concorda, hashDocumento: hash },
      });
    });
    return responderAvaliacao(id);
  });

  app.post('/avaliacoes-desempenho/:id/analise', { preHandler: exigir('desempenho:avaliar') }, async (request): Promise<AvaliacaoDesempenho> => {
    const id = idDaRota(request.params);
    const entrada = esquemaAnalise.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio();
    const calendario = await opcoesCalendario(ctx.banco);
    await ctx.banco.transacao(async (tx) => {
      const { linha, contrato } = await avaliacaoDoEscopo(tx, id, escopoUasgs(sessao));
      if (!avaliadorDoContrato(contrato, sessao.usuario.id, true).podeAvaliar) {
        throw regraNegocio('Só o gestor ou o fiscal designado do contrato analisa a manifestação do contratado.', [{ campo: 'RN-37', mensagem: 'Art. 117' }]);
      }
      if (!linha.manifestacao || linha.manifestacao.concorda) throw regraNegocio('Só a manifestação de discordância do contratado é analisada.');
      if (linha.analise) throw regraNegocio('A manifestação já foi analisada.');
      const a = validarAnaliseManifestacao(entrada);
      let atual = linha;
      if (a.decisao === 'revista') {
        const indicadores = {
          ...linha.indicadores,
          entregasNoPrazo: entrada.entregasNoPrazo ?? linha.indicadores.entregasNoPrazo,
          entregasTotal: entrada.entregasTotal ?? linha.indicadores.entregasTotal,
          recebimentosAprovados: entrada.recebimentosAprovados ?? linha.indicadores.recebimentosAprovados,
          recebimentosTotal: entrada.recebimentosTotal ?? linha.indicadores.recebimentosTotal,
        };
        const derivados = await derivadosDoPeriodo(tx, linha.contrato_id, linha.periodo_inicio, linha.periodo_fim);
        const r = avaliarDesempenhoContratado(
          {
            tipo: linha.tipo,
            periodoInicio: linha.periodo_inicio,
            periodoFim: linha.periodo_fim,
            vigenciaInicio: contrato.vigencia_inicio,
            vigenciaFim: contrato.vigencia_fim,
            indicadores,
            sancoes: derivados.sancoes,
            motivacao: linha.motivacao,
          },
          hoje,
          calendario,
        );
        atual = { ...linha, indicadores, nota: r.nota, faixa: r.faixa, calculo: { componentes: r.componentes, penalidades: r.penalidades, metodologia: r.metodologia }, versao: linha.versao + 1 };
      }
      const analise: AnaliseArmazenada = { decisao: a.decisao, motivacao: a.motivacao, por: { id: sessao.usuario.id, nome: sessao.usuario.nome }, em: agora.toISOString(), data: hoje };
      atual = { ...atual, analise };
      const documento = documentoDaLinha(contrato, atual);
      const hash = sha256Hex(documento);
      const anterior = { versao: linha.versao, nota: linha.nota, faixa: linha.faixa, indicadores: linha.indicadores, hashDocumento: linha.hash_documento };
      await tx.executar(
        `UPDATE avaliacoes_desempenho
            SET analise = $2::jsonb, indicadores = $3::jsonb, nota = $4, faixa = $5, calculo = $6::jsonb, versao = $7,
                versoes_anteriores = CASE WHEN $7::int > versao THEN versoes_anteriores || $8::jsonb ELSE versoes_anteriores END,
                documento = $9, hash_documento = $10
          WHERE id = $1`,
        [id, JSON.stringify(analise), JSON.stringify(atual.indicadores), atual.nota, atual.faixa, JSON.stringify(atual.calculo), atual.versao, JSON.stringify([anterior]), documento, hash],
      );
      await auditar(tx, request, {
        acao: 'desempenho.avaliacao.analisar',
        recurso: 'avaliacao_desempenho',
        recursoId: id,
        resumo: `Analisou a manifestação do contratado e ${a.decisao === 'revista' ? `revisou a avaliação ${linha.protocolo} (nota ${linha.nota} → ${atual.nota})` : `manteve a avaliação ${linha.protocolo}`}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: linha.contrato_id, protocolo: linha.protocolo, decisao: a.decisao, notaAnterior: linha.nota, nota: atual.nota, versao: atual.versao, hashDocumento: hash },
      });
    });
    return responderAvaliacao(id);
  });

  app.get('/avaliacoes-desempenho/:id/documento.pdf', { preHandler: exigir('fornecedores:ler') }, async (request, reply) => {
    const id = idDaRota(request.params);
    const [linha] = await listarLinhasAvaliacoes(ctx.banco, { id });
    if (!linha) throw naoEncontrado('Avaliação não encontrada.');
    const pdf = gerarPdfTexto({
      titulo: `Avaliação de desempenho ${linha.protocolo}`,
      rodape: `Avaliação de desempenho ${linha.protocolo} — Lei 14.133/2021, art. 88, § 3º`,
      conteudo: markdownParaPdf(linha.documento),
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="avaliacao-desempenho-${linha.protocolo}.pdf"`)
      .send(pdf);
  });

  // ───────── registro cadastral do fornecedor e incentivo ─────────

  async function montarRegistro(fornecedorId: string): Promise<RegistroDesempenhoFornecedor> {
    const hoje = ctx.hoje();
    const fornecedor = await carregarFornecedor(ctx.banco, fornecedorId, hoje);
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    const registros = await carregarRegistros(ctx.banco, [fornecedorId], hoje);
    const carregado = registros.get(fornecedorId);
    if (!carregado) throw naoEncontrado('Fornecedor não encontrado.');
    const { registro, linhas } = carregado;
    const consideradas = new Set(registro.avaliacoesConsideradas);
    const certificados = await listarCertificados(ctx.banco, { fornecedorId });
    const impedido = fornecedor.resumo.impedido;
    const elegibilidade = (tipo: 'certificado' | 'declaracao') => {
      const r = avaliarIncentivoDesempenho(registro, { impedido }, tipo, hoje);
      return { elegivel: r.elegivel, motivos: r.motivos, criterio: r.criterio };
    };
    return {
      fornecedor: { id: fornecedorId, razaoSocial: fornecedor.resumo.razaoSocial, documento: fornecedor.resumo.documento, impedido },
      nota: registro.nota,
      faixa: registro.faixa,
      contratosConsiderados: registro.contratosConsiderados,
      versaoRegistro: registro.versaoRegistro,
      metodologia: registro.metodologia,
      fundamento: registro.fundamento,
      avaliacoes: linhas.map((l) => paraResumo(l, hoje, consideradas)),
      certificados: certificados.map((c) => paraCertificado(c, registro.versaoRegistro, hoje)),
      incentivo: { certificado: elegibilidade('certificado'), declaracao: elegibilidade('declaracao') },
    };
  }

  app.get('/fornecedores/:id/desempenho', { preHandler: exigir('fornecedores:ler') }, async (request): Promise<RegistroDesempenhoFornecedor> => montarRegistro(idDaRota(request.params)));

  app.post('/fornecedores/:id/certificados-desempenho', { preHandler: exigir('desempenho:certificar') }, async (request, reply): Promise<CertificadoDesempenho> => {
    const fornecedorId = idDaRota(request.params);
    const { tipo } = esquemaCertificado.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const agora = ctx.relogio();
    const certificadoId = randomUUID();
    const codigo = `${tipo === 'certificado' ? 'CDF' : 'DDR'}-${hoje.slice(0, 4)}-${sha256Hex(`${certificadoId}:${agora.toISOString()}`).slice(0, 8).toUpperCase()}`;
    const resposta = await ctx.banco.transacao(async (tx) => {
      const fornecedor = await carregarFornecedor(tx, fornecedorId, hoje);
      if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
      const carregado = (await carregarRegistros(tx, [fornecedorId], hoje)).get(fornecedorId);
      if (!carregado) throw naoEncontrado('Fornecedor não encontrado.');
      const { registro, linhas } = carregado;
      const incentivo = avaliarIncentivoDesempenho(registro, { impedido: fornecedor.resumo.impedido }, tipo, hoje);
      if (!incentivo.elegivel) {
        throw regraNegocio(
          tipo === 'certificado' ? 'O fornecedor não atende ao critério do certificado de desempenho.' : 'O fornecedor não tem avaliação definitiva no registro.',
          incentivo.motivos.map((m) => ({ campo: 'RN-37', mensagem: m })),
        );
      }
      const consideradas = linhas.filter((l) => registro.avaliacoesConsideradas.includes(l.id));
      const [primeira] = await tx.consultar<{ sigla: string; nome: string }>(
        'SELECT u.sigla, u.nome FROM uasgs u JOIN contratos c ON c.uasg = u.codigo WHERE c.id = $1',
        [consideradas[0]?.contrato_id ?? null],
      );
      const conteudo = redigirCertificadoDesempenho({
        tipo,
        codigo,
        orgao: primeira ? `${primeira.sigla} — ${primeira.nome}` : 'Órgão contratante',
        fornecedor: { nome: fornecedor.resumo.razaoSocial, documento: fornecedor.resumo.documento },
        registro,
        avaliacoes: consideradas.map((l) => ({ contrato: l.contrato_numero, periodoFim: l.periodo_fim, nota: l.nota, tipo: l.tipo })),
        dataEmissao: hoje,
        validoAte: incentivo.validoAte,
        emitidoPor: sessao.usuario.nome,
        criterio: incentivo.criterio,
      });
      const hash = sha256Hex(conteudo);
      await tx.executar(
        `INSERT INTO certificados_desempenho (id, fornecedor_id, tipo, codigo, nota, faixa, contratos_considerados, avaliacoes, versao_registro,
                                              emitido_em, data_emissao, valido_ate, emitido_por, conteudo, hash_conteudo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)`,
        [
          certificadoId,
          fornecedorId,
          tipo,
          codigo,
          registro.nota,
          registro.faixa,
          registro.contratosConsiderados,
          JSON.stringify(registro.avaliacoesConsideradas),
          registro.versaoRegistro,
          agora.toISOString(),
          hoje,
          incentivo.validoAte,
          sessao.usuario.id,
          conteudo,
          hash,
        ],
      );
      await auditar(tx, request, {
        acao: tipo === 'certificado' ? 'desempenho.certificado.emitir' : 'desempenho.declaracao.emitir',
        recurso: 'certificado_desempenho',
        recursoId: certificadoId,
        resumo: `Emitiu ${tipo === 'certificado' ? 'o certificado de desempenho' : 'a declaração de desempenho registrado'} ${codigo} (nota ${registro.nota ?? '—'})`,
        dados: { fornecedorId, codigo, nota: registro.nota, faixa: registro.faixa, versaoRegistro: registro.versaoRegistro, validoAte: incentivo.validoAte, criterio: incentivo.criterio, hashConteudo: hash },
      });
      return registro.versaoRegistro;
    });
    const [linha] = await listarCertificados(ctx.banco, { id: certificadoId });
    if (!linha) throw naoEncontrado();
    reply.status(201);
    return paraCertificado(linha, resposta, hoje);
  });

  app.get('/certificados-desempenho/:id/documento.pdf', { preHandler: exigir('fornecedores:ler') }, async (request, reply) => {
    const id = idDaRota(request.params);
    const [linha] = await listarCertificados(ctx.banco, { id });
    if (!linha) throw naoEncontrado('Documento não encontrado.');
    const titulo = linha.tipo === 'certificado' ? 'Certificado de desempenho' : 'Declaração de desempenho registrado';
    const pdf = gerarPdfTexto({ titulo: `${titulo} ${linha.codigo}`, rodape: `${titulo} ${linha.codigo} — Lei 14.133/2021, art. 88, § 4º`, conteudo: markdownParaPdf(linha.conteudo) });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${linha.tipo}-desempenho-${linha.codigo}.pdf"`)
      .send(pdf);
  });

  // ───────── notas do registro, ranking e simulador ─────────

  async function notasComNome(ids: readonly string[] | null): Promise<NotaRegistroDesempenho[]> {
    const hoje = ctx.hoje();
    const registros = await carregarRegistros(ctx.banco, ids, hoje);
    const chaves = [...registros.keys()];
    const nomes = await ctx.banco.consultar<{ id: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string }>(
      'SELECT id, tipo_pessoa, razao_social FROM fornecedores WHERE id = ANY($1::uuid[])',
      [chaves],
    );
    const porId = new Map(nomes.map((n) => [n.id, nomeExibivel(n.tipo_pessoa, n.razao_social)]));
    return chaves
      .filter((id) => porId.has(id))
      .map((id) => {
        const r = registros.get(id)?.registro;
        return { fornecedorId: id, razaoSocial: porId.get(id) ?? '', nota: r?.nota ?? null, faixa: r?.faixa ?? 'sem_historico', contratosConsiderados: r?.contratosConsiderados ?? 0 };
      });
  }

  app.get('/desempenho/notas', { preHandler: exigir('fornecedores:ler') }, async (request): Promise<NotaRegistroDesempenho[]> => {
    const { fornecedores } = esquemaNotas.parse(request.query);
    return notasComNome([...new Set(fornecedores)]);
  });

  app.get('/desempenho/ranking', { preHandler: exigir('fornecedores:ler') }, async (): Promise<NotaRegistroDesempenho[]> => {
    const notas = await notasComNome(null);
    return notas.sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'));
  });

  app.post('/desempenho/simulacao', { preHandler: exigir('fornecedores:ler') }, async (request): Promise<ResultadoSimulacaoDesempenho> => {
    const entrada = esquemaSimulacao.parse(request.body);
    const ids = entrada.licitantes.map((l) => l.fornecedorId.toLowerCase());
    if (new Set(ids).size !== ids.length) throw regraNegocio('Cada fornecedor pode constar uma única vez na simulação.');
    const notas = await notasComNome(ids);
    const porId = new Map(notas.map((n) => [n.fornecedorId, n]));
    const faltantes = ids.filter((id) => !porId.has(id));
    if (faltantes.length > 0) throw regraNegocio('Há fornecedores que não constam do cadastro.', faltantes.map((id) => ({ campo: 'licitantes', mensagem: `Fornecedor ${id} não cadastrado` })));
    const r = simularImpactoDesempenho({
      licitantes: entrada.licitantes.map((l) => {
        const n = porId.get(l.fornecedorId.toLowerCase());
        return {
          id: l.fornecedorId.toLowerCase(),
          nome: n?.razaoSocial ?? l.fornecedorId,
          valorProposta: l.valorProposta,
          notaDesempenho: n?.nota ?? null,
          ...(l.notaProposta !== undefined && l.notaProposta !== null ? { notaProposta: l.notaProposta } : {}),
        };
      }),
      criterio: entrada.criterio ?? null,
    });
    return {
      licitantes: ids.map((id) => {
        const n = porId.get(id);
        return { fornecedorId: id, nome: n?.razaoSocial ?? id, notaDesempenho: n?.nota ?? null, faixa: n?.faixa ?? 'sem_historico' };
      }),
      desempate: r.desempate,
      tecnicaEPreco: r.tecnicaEPreco,
      aviso: r.aviso,
    };
  });

  // ───────── fórmula do desempenho na pontuação técnica do edital ─────────

  async function montarCriterio(processoId: string, escopo: string[] | null): Promise<CriterioDesempenhoEdital> {
    const processo = await obterLinhaProcesso(ctx.banco, processoId, escopo);
    if (!processo) throw naoEncontrado('Processo não encontrado.');
    const linha = await obterLinhaCriterio(ctx.banco, processoId);
    const criterioJulgamento = processo.edital.criterioJulgamento;
    const aplicavel = criterioJulgamento === 'tecnica_preco' || criterioJulgamento === 'melhor_tecnica';
    return {
      adotado: linha?.adotado ?? false,
      pesoDesempenhoPercentual: linha?.peso_desempenho ?? null,
      notaSemHistorico: linha?.nota_sem_historico ?? null,
      regulamento: linha?.regulamento ?? null,
      criterioJulgamento,
      aplicavel,
      explicacao: aplicavel
        ? 'O desempenho pretérito deve ser considerado na pontuação técnica, observado o regulamento (art. 36, § 3º); a nota vem do registro cadastral de desempenho (art. 37, III).'
        : 'O critério de julgamento do edital não tem pontuação técnica: o desempenho registrado só entra no desempate (art. 60, II).',
      atualizadoEm: linha?.atualizado_em ?? null,
      atualizadoPor: linha?.atualizado_por && linha.atualizado_por_nome ? { id: linha.atualizado_por, nome: linha.atualizado_por_nome } : null,
    };
  }

  app.get('/processos/:id/criterio-desempenho', { preHandler: exigir('jornada:ler') }, async (request): Promise<CriterioDesempenhoEdital> =>
    montarCriterio(idDaRota(request.params), escopoUasgs(sessaoDe(request))),
  );

  app.put('/processos/:id/criterio-desempenho', { preHandler: exigir('jornada:editar') }, async (request): Promise<CriterioDesempenhoEdital> => {
    const processoId = idDaRota(request.params);
    const entrada = esquemaCriterio.parse(request.body);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    await ctx.banco.transacao(async (tx) => {
      const processo = await obterLinhaProcesso(tx, processoId, escopo, true);
      if (!processo) throw naoEncontrado('Processo não encontrado.');
      if (processo.etapa_atual > 4) {
        throw regraNegocio('A fórmula do desempenho na pontuação técnica é definida no edital, até a etapa 4.', [{ campo: 'RN-37', mensagem: 'Depois da publicação, o edital não muda por esta tela.' }]);
      }
      const criterio = {
        pesoDesempenhoPercentual: entrada.pesoDesempenhoPercentual ?? 0,
        notaSemHistorico: entrada.notaSemHistorico ?? -1,
        regulamento: entrada.regulamento ?? '',
      };
      if (entrada.adotado) validarCriterioDesempenhoTecnica(criterio, processo.edital.criterioJulgamento);
      const valores = entrada.adotado ? [criterio.pesoDesempenhoPercentual, criterio.notaSemHistorico, criterio.regulamento.trim()] : [null, null, null];
      await tx.executar(
        `INSERT INTO criterios_desempenho_edital (processo_id, adotado, peso_desempenho, nota_sem_historico, regulamento, atualizado_por, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (processo_id) DO UPDATE SET adotado = $2, peso_desempenho = $3, nota_sem_historico = $4, regulamento = $5, atualizado_por = $6, atualizado_em = $7`,
        [processoId, entrada.adotado, ...valores, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'processo.criterio_desempenho.definir',
        recurso: 'processo',
        recursoId: processoId,
        resumo: entrada.adotado
          ? `Adotou no edital o desempenho anterior na pontuação técnica (${criterio.pesoDesempenhoPercentual}% da nota técnica)`
          : 'Retirou do edital o desempenho anterior na pontuação técnica',
        dados: { numeroSei: processo.numero_sei, adotado: entrada.adotado, pesoDesempenhoPercentual: valores[0], notaSemHistorico: valores[1], regulamento: valores[2] },
      });
    });
    return montarCriterio(processoId, escopo);
  });
}
