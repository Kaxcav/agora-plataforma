/**
 * Gestão compartilhada com a sociedade (Lei 14.133/2021, art. 174, § 3º, VI, alíneas "a" a "d"; art. 19, III) — RF-37.
 * - Público, sem login: o que a moderação publicou, os registros da execução, as respostas e o relatório final.
 * - Cidadão identificado pelo gov.br (perfil "cidadao"): envia mensagem e imagem e acompanha as próprias.
 * - Administração (escopo de UASG do contrato): modera com motivo, responde de forma identificada, publica fotos e
 *   vídeos da execução e o relatório final. Toda escrita vai para a trilha de auditoria na mesma transação.
 */
import {
  avaliarPublicacaoRegistroExecucao,
  ASSUNTOS_MANIFESTACAO,
  CONCLUSOES_RELATORIO_FINAL,
  FUNDAMENTO_GESTAO_COMPARTILHADA,
  PRAZO_RESPOSTA_MANIFESTACAO_DIAS,
  prazoRespostaManifestacao,
  montarMensagemNotificacao,
  validarDecisaoModeracao,
  validarManifestacao,
  validarRelatorioFinal,
  validarResposta,
} from '@agora/dominio';
import type {
  GestaoCompartilhadaContrato,
  GestaoCompartilhadaPublica,
  ManifestacaoModeracao,
  MinhaManifestacao,
  Pagina,
  RegistroExecucaoInterno,
  RelatorioFinalPublico,
} from '@agora/contratos';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { criarArmazenamento, ErroArmazenamento, type ArmazenamentoArquivos } from '../../armazenamento/arquivos.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { PERFIS } from '../../autorizacao/perfis.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { detectarFormatoMidia, ErroMidia, removerMetadados, TIPO_CONTEUDO_MIDIA, type FormatoMidia } from '../../compartilhado/midia.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, ErroApi, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { camposPaginacao, dataIso, deslocamento, idDaRota, pagina, uuid } from '../../http/validacao.ts';
import { verificarAntivirus } from '../../integracoes/antivirus.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { carregarInstrumento, gravarNotificacao, instrumentoDaMensagem, processarFila, type Destinatario } from '../notificacoes/servico.ts';
import { marcarIntencaoCidadao } from './cidadaos.ts';
import { aceitarCorpoBinario } from './corpo-binario.ts';
import {
  listarModeracao,
  manifestacaoModeracao,
  manifestacoesPublicas,
  mapearRegistroInterno,
  mapearRegistroPublico,
  minhaManifestacao,
  minhasManifestacoes,
  obterContratoSociedade,
  obterLinhaManifestacao,
  obterRegistro,
  registrosDoContrato,
  relatorioFinal,
  type LinhaContratoSociedade,
  type LinhaManifestacao,
} from './repositorio.ts';

/** Imagem enviada pelo cidadão: até 5 MB (ou o limite geral de arquivos, se menor). */
const LIMITE_IMAGEM_CIDADAO_BYTES = 5 * 1024 * 1024;
/** Proteção contra abuso do canal: até 10 manifestações por cidadão em 24 horas. */
const MAXIMO_MANIFESTACOES_24H = 10;
const DIA_MS = 24 * 60 * 60 * 1000;

const esquemaManifestacao = z.object({
  assunto: z.enum(ASSUNTOS_MANIFESTACAO),
  texto: z.string().max(4000),
});
const esquemaModeracao = z.object({ decisao: z.enum(['publicar', 'recusar']), motivo: z.string().max(1000) });
const esquemaResposta = z.object({
  origem: z.enum(['administracao', 'contratado']),
  texto: z.string().max(8000),
  representante: z.string().max(200).nullable().default(null),
});
const esquemaRelatorio = z.object({
  objetivos: z.string().max(16000),
  resultados: z.string().max(16000),
  conclusao: z.enum(CONCLUSOES_RELATORIO_FINAL),
});
const esquemaRegistro = z.object({
  titulo: z.string().trim().min(3).max(200),
  descricao: z.string().trim().max(2000).default(''),
  registradoEm: dataIso,
  sigiloso: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
const esquemaListaModeracao = z.object({
  situacao: z.enum(['em_moderacao', 'publicada', 'recusada']).optional(),
  contratoId: uuid.optional(),
  ...camposPaginacao,
});

function enviarMidia(reply: FastifyReply, conteudo: Buffer, formato: FormatoMidia, nome: string, sha256: string) {
  return reply
    .header('content-type', TIPO_CONTEUDO_MIDIA[formato])
    .header('content-disposition', `inline; filename="${nome}.${formato === 'jpeg' ? 'jpg' : formato}"`)
    .header('x-agora-sha256', sha256)
    .send(conteudo);
}

async function lerArmazenado(armazenamento: ArmazenamentoArquivos | null, sha256: string): Promise<Buffer> {
  if (armazenamento === null) throw naoEncontrado('Arquivo não disponível neste ambiente.');
  try {
    return await armazenamento.ler(sha256);
  } catch (erro) {
    if (erro instanceof ErroArmazenamento && erro.motivo === 'ausente') throw naoEncontrado('Arquivo não encontrado no armazenamento.');
    if (erro instanceof ErroArmazenamento) throw new ErroApi(500, 'INTERNO', 'O arquivo armazenado não confere com o SHA-256 registrado.');
    throw erro;
  }
}

/** Formato pelo conteúdo e metadados removidos; 422 para formato não aceito ou arquivo corrompido. */
function prepararMidia(corpo: unknown, aceitos: readonly FormatoMidia[]): { conteudo: Buffer; formato: FormatoMidia; removidos: string[] } {
  if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw validacao('Envie o conteúdo do arquivo no corpo da requisição (application/octet-stream).');
  const formato = detectarFormatoMidia(corpo);
  const nomes = aceitos.map((f) => (f === 'mp4' ? 'vídeo MP4' : f.toUpperCase())).join(', ');
  if (formato === null || !aceitos.includes(formato)) {
    throw regraNegocio(`Formato não aceito: envie ${nomes}. O tipo é conferido pelo conteúdo do arquivo, não pela extensão do nome.`, [
      { campo: 'arquivo', mensagem: 'Conteúdo não reconhecido' },
    ]);
  }
  try {
    const limpo = removerMetadados(corpo, formato);
    return { conteudo: limpo.conteudo, formato, removidos: limpo.removidos };
  } catch (erro) {
    if (erro instanceof ErroMidia) throw regraNegocio(`Arquivo corrompido ou incompleto: ${erro.message}`);
    throw erro;
  }
}

export async function rotasSociedade(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const armazenamento = criarArmazenamento(ctx.config.arquivos.dir);
  const limiteArquivo = ctx.config.arquivos.tamanhoMaximoBytes;
  const limiteImagemCidadao = Math.min(LIMITE_IMAGEM_CIDADAO_BYTES, limiteArquivo);

  async function contratoNoEscopo(request: FastifyRequest, campo = 'id'): Promise<LinhaContratoSociedade> {
    const contrato = await obterContratoSociedade(ctx.banco, idDaRota(request.params, campo), escopoUasgs(sessaoDe(request)));
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  /** Manifestação cujo contrato está no escopo de UASG de quem pede (fora do escopo: 404). */
  async function manifestacaoNoEscopo(request: FastifyRequest) {
    const linha = await obterLinhaManifestacao(ctx.banco, idDaRota(request.params));
    const escopo = escopoUasgs(sessaoDe(request));
    if (!linha || (escopo !== null && !escopo.includes(linha.contrato_uasg))) throw naoEncontrado('Manifestação não encontrada.');
    return linha;
  }

  /** Antivírus do órgão, quando configurado (o mesmo gancho dos documentos do processo): falha fechada. */
  async function exigirSemAmeaca(request: FastifyRequest, conteudo: Buffer, contratoId: string, sha256: string): Promise<void> {
    if (ctx.config.antivirusUrl === null) return;
    let resultado;
    try {
      resultado = await verificarAntivirus(ctx.config.antivirusUrl, conteudo);
    } catch (erro) {
      if (erro instanceof ErroIntegracao) {
        request.log.warn({ err: erro }, 'antivírus indisponível: envio recusado');
        throw new ErroApi(503, 'INDISPONIVEL', 'O antivírus do órgão não respondeu. Por segurança, o arquivo não foi recebido; tente novamente em instantes.');
      }
      throw erro;
    }
    if (resultado.limpo) return;
    const assinatura = resultado.assinatura;
    await ctx.banco.transacao((tx) =>
      auditar(tx, request, {
        acao: 'sociedade.arquivo.recusar_antivirus',
        recurso: 'contrato',
        recursoId: contratoId,
        resumo: 'Arquivo da gestão compartilhada recusado pelo antivírus',
        dados: { sha256, tamanhoBytes: conteudo.length, assinatura },
      }),
    );
    throw regraNegocio('O arquivo foi recusado pelo antivírus do órgão.');
  }

  async function moderacaoAtual(id: string): Promise<ManifestacaoModeracao> {
    const atual = await manifestacaoModeracao(ctx.banco, id, ctx.hoje());
    if (!atual) throw naoEncontrado('Manifestação não encontrada.');
    return atual;
  }

  async function notificarCidadaoManifestacao(
    tx: Transacao,
    linha: LinhaManifestacao,
    detalhe: string,
    usuarioId: string,
  ): Promise<string | null> {
    const instrumento = await carregarInstrumento(tx, 'contrato', linha.contrato_id, null);
    if (!instrumento) return null;
    const mensagem = montarMensagemNotificacao({
      tipo: 'manifestacao',
      origem: 'automatica',
      hoje: ctx.hoje(),
      instrumento: instrumentoDaMensagem(instrumento),
      detalhe,
    });
    const destinatarios: Destinatario[] = [
      {
        papel: 'cidadao',
        usuarioId: linha.autor_id,
        fornecedorId: null,
        nome: linha.autor_nome,
        email: linha.autor_email,
        ativo: true,
        pessoaFisica: true,
      },
    ];
    const gravada = await gravarNotificacao(
      tx,
      ctx.config,
      ctx.relogio(),
      {
        tipo: 'manifestacao',
        origem: 'automatica',
        instrumento,
        mensagem,
        chave: null,
        criadaPor: usuarioId,
      },
      destinatarios,
      ['email'],
    );
    return gravada?.id ?? null;
  }

  // ───────── público (sem login) ─────────

  app.get('/publico/contratos/:id/gestao-compartilhada', async (request): Promise<GestaoCompartilhadaPublica> => {
    const contrato = await obterContratoSociedade(ctx.banco, idDaRota(request.params), null);
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return {
      contratoId: contrato.id,
      numero: contrato.numero,
      manifestacoes: await manifestacoesPublicas(ctx.banco, contrato.id, ctx.hoje()),
      registros: (await registrosDoContrato(ctx.banco, contrato.id, true)).map(mapearRegistroPublico),
      relatorioFinal: await relatorioFinal(ctx.banco, contrato.id),
      vigenciaFim: contrato.vigencia_fim,
      prazoRespostaDias: PRAZO_RESPOSTA_MANIFESTACAO_DIAS,
      fundamento: FUNDAMENTO_GESTAO_COMPARTILHADA,
    };
  });

  app.get('/publico/contratos/:id/manifestacoes/:manifestacaoId/imagem', async (request, reply) => {
    const { id, manifestacaoId } = z.object({ id: uuid, manifestacaoId: uuid }).parse(request.params);
    const linha = await obterLinhaManifestacao(ctx.banco, manifestacaoId.toLowerCase());
    if (!linha || linha.contrato_id !== id.toLowerCase() || linha.situacao !== 'publicada' || !linha.imagem_sha256 || !linha.imagem_formato) {
      throw naoEncontrado('Imagem não encontrada ou não publicada.');
    }
    return enviarMidia(reply, await lerArmazenado(armazenamento, linha.imagem_sha256), linha.imagem_formato, 'manifestacao', linha.imagem_sha256);
  });

  app.get('/publico/contratos/:id/registros/:registroId/midia', async (request, reply) => {
    const { id, registroId } = z.object({ id: uuid, registroId: uuid }).parse(request.params);
    const registro = await obterRegistro(ctx.banco, id.toLowerCase(), registroId.toLowerCase());
    if (!registro || !registro.publicado) throw naoEncontrado('Registro não encontrado ou não publicado.');
    return enviarMidia(reply, await lerArmazenado(armazenamento, registro.sha256), registro.formato, 'registro-execucao', registro.sha256);
  });

  // ───────── cidadão: entrada pelo gov.br ─────────

  app.get('/sessao/govbr/cidadao', async (request, reply) => {
    if (!ctx.config.govbr) throw naoEncontrado('Login Único gov.br não está habilitado.');
    const { retorno } = z.object({ retorno: z.string().max(200).optional() }).parse(request.query);
    marcarIntencaoCidadao(reply, retorno ?? '', ctx.config.cookieSeguro);
    return reply.redirect('/api/v1/sessao/govbr/iniciar', 302);
  });

  // ───────── cidadão identificado ─────────

  app.post('/sociedade/contratos/:id/manifestacoes', { preHandler: exigir('sociedade:manifestar') }, async (request, reply): Promise<MinhaManifestacao> => {
    const sessao = sessaoDe(request);
    const entrada = esquemaManifestacao.parse(request.body);
    const contrato = await obterContratoSociedade(ctx.banco, idDaRota(request.params), null);
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    const texto = validarManifestacao(entrada.texto);
    const agora = ctx.relogio();
    const [recentes] = await ctx.banco.consultar<{ total: number }>(
      'SELECT COUNT(*)::integer AS total FROM sociedade_manifestacoes WHERE autor_id = $1 AND recebida_em > $2',
      [sessao.usuario.id, new Date(agora.getTime() - DIA_MS).toISOString()],
    );
    if ((recentes?.total ?? 0) >= MAXIMO_MANIFESTACOES_24H) {
      throw new ErroApi(429, 'LIMITE_REQUISICOES', `Limite de ${MAXIMO_MANIFESTACOES_24H} manifestações em 24 horas atingido. Tente novamente amanhã.`);
    }
    const id = await ctx.banco.transacao(async (tx) => {
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO sociedade_manifestacoes (contrato_id, autor_id, assunto, texto, texto_publico, dados_pessoais_tarjados, recebida_em, prazo_resposta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [contrato.id, sessao.usuario.id, entrada.assunto, texto.texto, texto.textoPublico, texto.dadosPessoaisTarjados, agora.toISOString(), prazoRespostaManifestacao(ctx.hoje())],
      );
      if (!criada) throw new Error('Falha ao registrar a manifestação.');
      await auditar(tx, request, {
        acao: 'sociedade.manifestacao.enviar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Enviou manifestação sobre o contrato ${contrato.numero} (aguarda moderação)`,
        dados: { manifestacaoId: criada.id, assunto: entrada.assunto, caracteres: texto.texto.length, dadosPessoaisTarjados: texto.dadosPessoaisTarjados },
      });
      return criada.id;
    });
    const resposta = await minhaManifestacao(ctx.banco, id);
    if (!resposta) throw naoEncontrado();
    return reply.status(201).send(resposta);
  });

  app.get('/sociedade/minhas-manifestacoes', { preHandler: exigir('sociedade:manifestar') }, async (request): Promise<MinhaManifestacao[]> =>
    minhasManifestacoes(ctx.banco, sessaoDe(request).usuario.id),
  );

  // ───────── Administração: leitura e decisões ─────────

  app.get('/sociedade/manifestacoes', { preHandler: exigir('sociedade:ler') }, async (request): Promise<Pagina<ManifestacaoModeracao>> => {
    const f = esquemaListaModeracao.parse(request.query);
    const { itens, total } = await listarModeracao(
      ctx.banco,
      {
        escopo: escopoUasgs(sessaoDe(request)),
        situacao: f.situacao ?? null,
        contratoId: f.contratoId?.toLowerCase() ?? null,
        limite: f.tamanhoPagina,
        inicio: deslocamento(f.pagina, f.tamanhoPagina),
      },
      ctx.hoje(),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  app.get('/sociedade/manifestacoes/:id/imagem', { preHandler: exigir('sociedade:ler') }, async (request, reply) => {
    const linha = await manifestacaoNoEscopo(request);
    if (!linha.imagem_sha256 || !linha.imagem_formato) throw naoEncontrado('A manifestação não tem imagem.');
    return enviarMidia(reply, await lerArmazenado(armazenamento, linha.imagem_sha256), linha.imagem_formato, 'manifestacao', linha.imagem_sha256);
  });

  app.post('/sociedade/manifestacoes/:id/moderacao', { preHandler: exigir('sociedade:moderar') }, async (request): Promise<ManifestacaoModeracao> => {
    const linha = await manifestacaoNoEscopo(request);
    const entrada = esquemaModeracao.parse(request.body);
    const decisao = validarDecisaoModeracao({ decisao: entrada.decisao, motivo: entrada.motivo, situacaoAtual: linha.situacao });
    let notificacaoId: string | null = null;
    await ctx.banco.transacao(async (tx) => {
      const alteradas = await tx.executar(
        `UPDATE sociedade_manifestacoes SET situacao = $2, motivo_moderacao = $3, moderada_por = $4, moderada_em = $5
          WHERE id = $1 AND situacao = 'em_moderacao'`,
        [linha.id, decisao.decisao === 'publicar' ? 'publicada' : 'recusada', decisao.motivo, sessaoDe(request).usuario.id, ctx.relogio().toISOString()],
      );
      if (alteradas !== 1) throw conflito('Esta manifestação já foi moderada por outra pessoa. Recarregue a página.');
      await auditar(tx, request, {
        acao: decisao.decisao === 'publicar' ? 'sociedade.manifestacao.publicar' : 'sociedade.manifestacao.recusar',
        recurso: 'contrato',
        recursoId: linha.contrato_id,
        resumo: `${decisao.decisao === 'publicar' ? 'Publicou' : 'Recusou'} manifestação sobre o contrato ${linha.contrato_numero}`,
        dados: { manifestacaoId: linha.id, motivo: decisao.motivo },
      });
      const detalhe =
        decisao.decisao === 'publicar'
          ? `Manifestação publicada pela moderação. Motivo: ${decisao.motivo}`
          : `Manifestação recusada pela moderação. Motivo: ${decisao.motivo}`;
      notificacaoId = await notificarCidadaoManifestacao(tx, linha, detalhe, sessaoDe(request).usuario.id);
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    return moderacaoAtual(linha.id);
  });

  app.post('/sociedade/manifestacoes/:id/respostas', { preHandler: exigir('sociedade:responder') }, async (request): Promise<ManifestacaoModeracao> => {
    const linha = await manifestacaoNoEscopo(request);
    const entrada = esquemaResposta.parse(request.body);
    const resposta = validarResposta({ ...entrada, situacaoManifestacao: linha.situacao });
    const sessao = sessaoDe(request);
    const contrato = await obterContratoSociedade(ctx.banco, linha.contrato_id, null);
    const nomePerfil = PERFIS.find((p) => sessao.perfis.includes(p.codigo))?.nome ?? 'Servidor';
    const funcao =
      resposta.origem === 'contratado'
        ? 'Contratado'
        : contrato?.gestor_id === sessao.usuario.id
          ? 'Gestor do contrato'
          : contrato?.fiscal_id === sessao.usuario.id
            ? 'Fiscal do contrato'
            : `Administração (${nomePerfil})`;
    let notificacaoId: string | null = null;
    await ctx.banco.transacao(async (tx) => {
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO sociedade_respostas (manifestacao_id, origem, texto, texto_publico, funcao, representante, registrada_por, respondida_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [linha.id, resposta.origem, resposta.texto, resposta.textoPublico, funcao, resposta.representante, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'sociedade.manifestacao.responder',
        recurso: 'contrato',
        recursoId: linha.contrato_id,
        resumo: `${resposta.origem === 'contratado' ? 'Registrou a resposta do contratado' : 'Respondeu'} à manifestação sobre o contrato ${linha.contrato_numero}`,
        dados: { manifestacaoId: linha.id, respostaId: criada?.id ?? null, origem: resposta.origem, funcao },
      });
      const detalhe = `Resposta registrada (${funcao}): ${resposta.textoPublico}`;
      notificacaoId = await notificarCidadaoManifestacao(tx, linha, detalhe, sessao.usuario.id);
    });
    if (notificacaoId) await processarFila(ctx, { notificacaoId });
    return moderacaoAtual(linha.id);
  });

  app.get('/sociedade/contratos/:id', { preHandler: exigir('sociedade:ler') }, async (request): Promise<GestaoCompartilhadaContrato> => {
    const contrato = await contratoNoEscopo(request);
    const hoje = ctx.hoje();
    const { itens } = await listarModeracao(ctx.banco, { escopo: null, situacao: null, contratoId: contrato.id, limite: 500, inicio: 0 }, hoje);
    return {
      contrato: {
        id: contrato.id,
        numero: contrato.numero,
        uasg: contrato.uasg,
        objeto: contrato.objeto,
        vigenciaInicio: contrato.vigencia_inicio,
        vigenciaFim: contrato.vigencia_fim,
        encerrado: contrato.vigencia_fim <= hoje,
      },
      manifestacoes: itens,
      registros: (await registrosDoContrato(ctx.banco, contrato.id, false)).map(mapearRegistroInterno),
      relatorioFinal: await relatorioFinal(ctx.banco, contrato.id),
      armazenamentoDisponivel: armazenamento !== null,
      tamanhoMaximoImagemBytes: limiteImagemCidadao,
      tamanhoMaximoVideoBytes: limiteArquivo,
      formatosAceitos: ['jpeg', 'png', 'mp4'],
      prazoRespostaDias: PRAZO_RESPOSTA_MANIFESTACAO_DIAS,
    };
  });

  app.get('/sociedade/contratos/:id/registros/:registroId/midia', { preHandler: exigir('sociedade:ler') }, async (request, reply) => {
    const contrato = await contratoNoEscopo(request);
    const registro = await obterRegistro(ctx.banco, contrato.id, idDaRota(request.params, 'registroId'));
    if (!registro) throw naoEncontrado('Registro não encontrado.');
    return enviarMidia(reply, await lerArmazenado(armazenamento, registro.sha256), registro.formato, 'registro-execucao', registro.sha256);
  });

  app.post('/sociedade/contratos/:id/relatorio-final', { preHandler: exigir('sociedade:relatorio_final') }, async (request): Promise<RelatorioFinalPublico> => {
    const contrato = await contratoNoEscopo(request);
    const entrada = esquemaRelatorio.parse(request.body);
    const relatorio = validarRelatorioFinal({ vigenciaFim: contrato.vigencia_fim, hoje: ctx.hoje(), ...entrada });
    if (await relatorioFinal(ctx.banco, contrato.id)) throw conflito('O relatório final deste contrato já foi publicado.');
    await ctx.banco.transacao(async (tx) => {
      const [dados] = await tx.consultar<{ valor_global: number; valor_pago: number; aditivos: number; manifestacoes: number; registros: number }>(
        `SELECT v.valor_global, v.valor_pago,
                (SELECT COUNT(*)::integer FROM aditivos a WHERE a.contrato_id = $1) AS aditivos,
                (SELECT COUNT(*)::integer FROM sociedade_manifestacoes m WHERE m.contrato_id = $1 AND m.situacao = 'publicada') AS manifestacoes,
                (SELECT COUNT(*)::integer FROM sociedade_registros_execucao r WHERE r.contrato_id = $1 AND r.publicado) AS registros
           FROM vw_contratos_valores v WHERE v.contrato_id = $1`,
        [contrato.id],
      );
      const execucao: RelatorioFinalPublico['execucao'] = {
        vigenciaInicio: contrato.vigencia_inicio,
        vigenciaFim: contrato.vigencia_fim,
        valorGlobal: dados?.valor_global ?? 0,
        valorPago: dados?.valor_pago ?? 0,
        aditivos: dados?.aditivos ?? 0,
        manifestacoesPublicadas: dados?.manifestacoes ?? 0,
        registrosPublicados: dados?.registros ?? 0,
      };
      const sha256 = sha256Hex(JSON.stringify({ contratoId: contrato.id, objetivos: relatorio.objetivos, resultados: relatorio.resultados, conclusao: relatorio.conclusao, execucao }));
      await tx.executar(
        `INSERT INTO sociedade_relatorios_finais (contrato_id, objetivos, resultados, conclusao, execucao, sha256, publicado_por, publicado_em)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [contrato.id, relatorio.objetivos, relatorio.resultados, relatorio.conclusao, JSON.stringify(execucao), sha256, sessaoDe(request).usuario.id, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'sociedade.relatorio_final.publicar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Publicou o relatório final do contrato ${contrato.numero}`,
        dados: { conclusao: relatorio.conclusao, sha256 },
      });
    });
    const publicado = await relatorioFinal(ctx.banco, contrato.id);
    if (!publicado) throw naoEncontrado();
    return publicado;
  });

  // ───────── envios binários (só neste escopo) ─────────

  await app.register(async (escopo) => {
    aceitarCorpoBinario(escopo, limiteArquivo);

    escopo.post('/sociedade/manifestacoes/:id/imagem', { preHandler: exigir('sociedade:manifestar') }, async (request): Promise<MinhaManifestacao> => {
      if (armazenamento === null) throw new ErroApi(503, 'INDISPONIVEL', 'O envio de imagens não está configurado neste ambiente (defina AGORA_ARQUIVOS_DIR).');
      const sessao = sessaoDe(request);
      const linha = await obterLinhaManifestacao(ctx.banco, idDaRota(request.params));
      if (!linha || linha.autor_id !== sessao.usuario.id) throw naoEncontrado('Manifestação não encontrada.');
      if (linha.situacao !== 'em_moderacao') throw regraNegocio('A imagem só pode ser anexada enquanto a manifestação aguarda moderação.');
      if (linha.imagem_sha256 !== null) throw conflito('Esta manifestação já tem uma imagem.');
      if (Buffer.isBuffer(request.body) && request.body.length > limiteImagemCidadao) {
        throw new ErroApi(413, 'VALIDACAO', `A imagem passa do limite de ${Math.round(limiteImagemCidadao / (1024 * 1024))} MB.`);
      }
      const midia = prepararMidia(request.body, ['jpeg', 'png']);
      const sha256 = sha256Hex(midia.conteudo);
      await exigirSemAmeaca(request, midia.conteudo, linha.contrato_id, sha256);
      await armazenamento.gravar(sha256, midia.conteudo);
      await ctx.banco.transacao(async (tx) => {
        await tx.executar(
          `UPDATE sociedade_manifestacoes SET imagem_sha256 = $2, imagem_formato = $3, imagem_bytes = $4, metadados_removidos = $5::text[]
            WHERE id = $1 AND imagem_sha256 IS NULL AND situacao = 'em_moderacao'`,
          [linha.id, sha256, midia.formato, midia.conteudo.length, midia.removidos],
        );
        await auditar(tx, request, {
          acao: 'sociedade.manifestacao.anexar_imagem',
          recurso: 'contrato',
          recursoId: linha.contrato_id,
          resumo: `Anexou imagem à manifestação sobre o contrato ${linha.contrato_numero}`,
          dados: { manifestacaoId: linha.id, formato: midia.formato, bytes: midia.conteudo.length, sha256, metadadosRemovidos: midia.removidos },
        });
      });
      const atual = await minhaManifestacao(ctx.banco, linha.id);
      if (!atual) throw naoEncontrado();
      return atual;
    });

    escopo.post('/sociedade/contratos/:id/registros', { preHandler: exigir('sociedade:registrar') }, async (request, reply): Promise<RegistroExecucaoInterno> => {
      if (armazenamento === null) throw new ErroApi(503, 'INDISPONIVEL', 'O envio de arquivos não está configurado neste ambiente (defina AGORA_ARQUIVOS_DIR).');
      const contrato = await contratoNoEscopo(request);
      const entrada = esquemaRegistro.parse(request.query);
      if (entrada.registradoEm > ctx.hoje()) throw validacao('A data do registro não pode ser futura.', [{ campo: 'registradoEm', mensagem: 'Data futura' }]);
      const midia = prepararMidia(request.body, ['jpeg', 'png', 'mp4']);
      const sha256 = sha256Hex(midia.conteudo);
      const [repetido] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM sociedade_registros_execucao WHERE contrato_id = $1 AND sha256 = $2', [contrato.id, sha256]);
      if (repetido) throw conflito('Este arquivo já foi registrado neste contrato.');
      // Ponto de checagem do sigilo (art. 13): a classificação formal de documentos, quando existir, entra em `classificacaoSigilosa`.
      const sigilo = avaliarPublicacaoRegistroExecucao({ declaradoSigiloso: entrada.sigiloso, classificacaoSigilosa: false });
      await exigirSemAmeaca(request, midia.conteudo, contrato.id, sha256);
      await armazenamento.gravar(sha256, midia.conteudo);
      const id = await ctx.banco.transacao(async (tx) => {
        const [criado] = await tx.consultar<{ id: string }>(
          `INSERT INTO sociedade_registros_execucao
             (contrato_id, titulo, descricao, midia, formato, sha256, bytes, registrado_em, declarado_sigiloso, publicado, motivo_retencao,
              metadados_removidos, enviado_por, enviado_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14) RETURNING id`,
          [
            contrato.id,
            entrada.titulo,
            entrada.descricao,
            midia.formato === 'mp4' ? 'video' : 'imagem',
            midia.formato,
            sha256,
            midia.conteudo.length,
            entrada.registradoEm,
            entrada.sigiloso,
            sigilo.publicavel,
            sigilo.motivo,
            midia.removidos,
            sessaoDe(request).usuario.id,
            ctx.relogio().toISOString(),
          ],
        );
        if (!criado) throw new Error('Falha ao registrar o arquivo.');
        await auditar(tx, request, {
          acao: sigilo.publicavel ? 'sociedade.registro.publicar' : 'sociedade.registro.reter_sigilo',
          recurso: 'contrato',
          recursoId: contrato.id,
          resumo: sigilo.publicavel
            ? `Publicou registro da execução do contrato ${contrato.numero}: ${entrada.titulo}`
            : `Guardou sem publicar (sigilo) registro da execução do contrato ${contrato.numero}`,
          dados: { registroId: criado.id, formato: midia.formato, bytes: midia.conteudo.length, sha256, metadadosRemovidos: midia.removidos, fundamento: sigilo.fundamento },
        });
        return criado.id;
      });
      const registro = await obterRegistro(ctx.banco, contrato.id, id);
      if (!registro) throw naoEncontrado();
      return reply.status(201).send(mapearRegistroInterno(registro));
    });
  });
}
