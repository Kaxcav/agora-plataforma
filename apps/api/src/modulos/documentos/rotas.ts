/**
 * Documentos do processo e de habilitação (RF-21), leitura assistida de atestados (RIA-08) e exigências de
 * qualificação técnica (RN-25). O arquivo chega como corpo binário, é conferido pelo conteúdo (assinatura, PDF sem
 * código ativo, tamanho, SHA-256, antivírus opcional) e fica no armazenamento da Ágora; o download só sai pela API,
 * com permissão, escopo da UASG do processo e registro LGPD quando o documento tem dado pessoal.
 */
import { randomUUID } from 'node:crypto';
import { avaliarExigenciasQualificacaoTecnica, extrairQuantitativosAtestado } from '@agora/dominio';
import type { ArquivoProcesso, ArquivosProcesso, QualificacaoTecnica } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { criarArmazenamento, ErroArmazenamento } from '../../armazenamento/arquivos.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { inspecionarPdf } from '../../compartilhado/pdf-leitura.ts';
import { detectarFormato, disposicaoAnexo, sanitizarNomeArquivo, TIPO_CONTEUDO } from '../../compartilhado/tipo-arquivo.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, ErroApi, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { verificarAntivirus } from '../../integracoes/antivirus.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { exigirEtapaAte } from '../jornada/servico.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { listarArquivos, mapearArquivo, mencaoPublica, obterArquivo, obterQualificacao, parcelasParaLeitura, type ParcelaArmazenada } from './repositorio.ts';
import { lerDocumento, montarQualificacao, valorTotalEstimado } from './servico.ts';
import { anexoNoCofre } from '../sigilo/consultas.ts';

/** Sigilo (RN-40): o anexo guardado no cofre só sai pela tela de sigilo, com motivo e decisão de acesso. */
const MENSAGEM_COFRE = 'Anexo sigiloso guardado no cofre: abra a tela Sigilo do processo e baixe-o informando o motivo do acesso.';

const CATEGORIAS = ['processo', 'habilitacao'] as const;
const TIPOS = ['atestado_capacidade_tecnica', 'balanco_patrimonial', 'certidao', 'proposta', 'documento_processo', 'outro'] as const;
/** Tipos que só existem como documento de habilitação de um licitante. */
const TIPOS_HABILITACAO = new Set<string>(['atestado_capacidade_tecnica', 'balanco_patrimonial', 'certidao', 'proposta']);
const CABECALHO_NOME = 'x-agora-nome-arquivo';
const ETAPA_LIMITE_EXIGENCIAS = 4;

const esquemaEnvio = z.object({
  categoria: z.enum(CATEGORIAS),
  tipo: z.enum(TIPOS),
  titulo: z.string().trim().min(3).max(200),
  fornecedorId: uuid.optional(),
  contemDadoPessoal: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  exercicio: z.coerce.number().int().min(1900).max(2200).optional(),
  dataConstituicao: dataIso.optional(),
});

const esquemaBaixar = z
  .object({ finalidade: z.string().trim().min(10).max(300).optional() })
  .optional()
  .transform((v) => v ?? {});

const esquemaQualificacao = z.object({
  parcelas: z
    .array(
      z.object({
        id: uuid.optional(),
        descricao: z.string().trim().min(3).max(300),
        unidade: z.string().trim().min(1).max(60),
        quantidadeObjeto: z.number().positive().max(1e12),
        valorEstimado: centavos.positive(),
        quantidadeMinima: z.number().positive().max(1e12),
        termos: z.array(z.string().trim().min(2).max(60)).max(10).default([]),
      }),
    )
    .max(20),
});

const ROTULO_TIPO: Record<(typeof TIPOS)[number], string> = {
  atestado_capacidade_tecnica: 'atestado de capacidade técnica',
  balanco_patrimonial: 'balanço patrimonial',
  certidao: 'certidão',
  proposta: 'proposta',
  documento_processo: 'documento do processo',
  outro: 'documento',
};

export async function rotasDocumentos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const armazenamento = criarArmazenamento(ctx.config.arquivos.dir);
  const limite = ctx.config.arquivos.tamanhoMaximoBytes;
  const megabytes = Math.round(limite / (1024 * 1024));

  async function processoNoEscopo(request: FastifyRequest): Promise<LinhaProcesso> {
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return linha;
  }

  async function parcelasDoProcesso(processoId: string) {
    return parcelasParaLeitura((await obterQualificacao(ctx.banco, processoId))?.parcelas ?? []);
  }

  async function responderArquivo(processoId: string, arquivoId: string): Promise<ArquivoProcesso> {
    const linha = await obterArquivo(ctx.banco, processoId, arquivoId);
    if (!linha) throw naoEncontrado('Documento não encontrado.');
    return mapearArquivo(linha, await parcelasDoProcesso(processoId));
  }

  async function qualificacao(linha: LinhaProcesso): Promise<QualificacaoTecnica> {
    return montarQualificacao({
      linha,
      qualificacao: await obterQualificacao(ctx.banco, linha.id),
      arquivos: await listarArquivos(ctx.banco, linha.id),
      hoje: ctx.hoje(),
      agora: ctx.relogio(),
      editavel: linha.etapa_atual <= ETAPA_LIMITE_EXIGENCIAS && linha.contrato_id === null,
    });
  }

  // ───────── leitura ─────────

  app.get('/processos/:id/arquivos', { preHandler: exigir('documentos:ler') }, async (request): Promise<ArquivosProcesso> => {
    const linha = await processoNoEscopo(request);
    const parcelas = await parcelasDoProcesso(linha.id);
    return {
      itens: (await listarArquivos(ctx.banco, linha.id)).map((a) => mapearArquivo(a, parcelas)),
      armazenamentoDisponivel: armazenamento !== null,
      tamanhoMaximoBytes: limite,
      formatosAceitos: ['pdf', 'png', 'jpeg'],
      ocrDisponivel: ctx.config.ocr.url !== null,
      antivirusAtivo: ctx.config.antivirusUrl !== null,
    };
  });

  app.get('/processos/:id/qualificacao-tecnica', { preHandler: exigir('documentos:ler') }, async (request): Promise<QualificacaoTecnica> =>
    qualificacao(await processoNoEscopo(request)),
  );

  // ───────── envio (corpo binário, só neste escopo) ─────────

  await app.register(async (escopo) => {
    escopo.addContentTypeParser(['application/octet-stream', 'application/pdf', 'image/png', 'image/jpeg'], (request, carga, feito) => {
      const declarado = Number(request.headers['content-length'] ?? 0);
      if (declarado > limite) {
        feito(new ErroApi(413, 'VALIDACAO', `O arquivo passa do limite de ${megabytes} MB.`), undefined);
        carga.resume();
        return;
      }
      const partes: Buffer[] = [];
      let recebido = 0;
      let encerrado = false;
      carga.on('data', (parte: Buffer) => {
        if (encerrado) return;
        recebido += parte.length;
        if (recebido > limite) {
          encerrado = true;
          feito(new ErroApi(413, 'VALIDACAO', `O arquivo passa do limite de ${megabytes} MB.`), undefined);
          return;
        }
        partes.push(parte);
      });
      carga.on('end', () => {
        if (!encerrado) feito(null, Buffer.concat(partes));
      });
      carga.on('error', (erro: Error) => {
        if (!encerrado) {
          encerrado = true;
          feito(erro, undefined);
        }
      });
    });

    escopo.post('/processos/:id/arquivos', { preHandler: exigir('documentos:enviar') }, async (request, reply): Promise<ArquivoProcesso> => {
      if (armazenamento === null) {
        throw new ErroApi(503, 'INDISPONIVEL', 'O envio de documentos não está configurado neste ambiente (defina AGORA_ARQUIVOS_DIR).');
      }
      const entrada = esquemaEnvio.parse(request.query);
      const conteudo = request.body;
      if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw validacao('Envie o conteúdo do arquivo no corpo da requisição (application/octet-stream).');
      const nomeOriginal = sanitizarNomeArquivo(typeof request.headers[CABECALHO_NOME] === 'string' ? request.headers[CABECALHO_NOME] : undefined);

      // Coerência entre categoria, tipo e licitante.
      const habilitacao = entrada.categoria === 'habilitacao';
      if (TIPOS_HABILITACAO.has(entrada.tipo) && !habilitacao) throw validacao(`O ${ROTULO_TIPO[entrada.tipo]} é documento de habilitação de um licitante.`, [{ campo: 'categoria', mensagem: 'Use a categoria habilitação' }]);
      if (entrada.tipo === 'documento_processo' && habilitacao) throw validacao('Documento do processo não é documento de habilitação.', [{ campo: 'categoria', mensagem: 'Use a categoria processo' }]);
      if (habilitacao && entrada.fornecedorId === undefined) throw validacao('Indique o licitante que apresentou o documento.', [{ campo: 'fornecedorId', mensagem: 'Obrigatório na habilitação' }]);
      if (!habilitacao && entrada.fornecedorId !== undefined) throw validacao('Documento do processo não tem licitante.', [{ campo: 'fornecedorId', mensagem: 'Não se aplica' }]);
      if (entrada.tipo === 'balanco_patrimonial' && entrada.exercicio === undefined) throw validacao('Informe o exercício social do balanço.', [{ campo: 'exercicio', mensagem: 'Obrigatório no balanço (art. 69, I)' }]);
      if (entrada.tipo !== 'balanco_patrimonial' && (entrada.exercicio !== undefined || entrada.dataConstituicao !== undefined)) {
        throw validacao('Exercício e data de constituição só se aplicam ao balanço patrimonial.');
      }

      // Conteúdo: formato pela assinatura, PDF íntegro e sem código ativo.
      const formato = detectarFormato(conteudo);
      if (formato === null) {
        throw regraNegocio('Formato não aceito: envie PDF, PNG ou JPEG. O tipo é conferido pelo conteúdo do arquivo, não pela extensão do nome.', [
          { campo: 'arquivo', mensagem: 'Conteúdo não reconhecido como PDF, PNG ou JPEG' },
        ]);
      }
      if (formato === 'pdf') {
        const inspecao = inspecionarPdf(conteudo);
        if (inspecao.criptografado) throw regraNegocio('PDF protegido por senha ou criptografado: envie uma versão sem proteção.');
        if (inspecao.paginas === 0) throw regraNegocio('PDF inválido ou corrompido: nenhuma página foi encontrada.');
        if (inspecao.ativos.length > 0) {
          throw regraNegocio(`O PDF contém conteúdo ativo ou arquivo embutido (${inspecao.ativos.join(', ')}) e foi recusado por segurança. Gere o PDF novamente sem esses recursos.`);
        }
      }

      const linha = await processoNoEscopo(request);
      if (entrada.fornecedorId !== undefined) {
        const fornecedorId = entrada.fornecedorId.toLowerCase();
        if (!linha.disputa.licitantes.some((l) => l.fornecedorId === fornecedorId)) {
          throw regraNegocio('O fornecedor indicado não é licitante deste processo. Registre os licitantes na etapa 6 antes de receber os documentos de habilitação.', [
            { campo: 'fornecedorId', mensagem: 'Fornecedor fora da disputa' },
          ]);
        }
      }
      const sha256 = sha256Hex(conteudo);
      const [repetido] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM processos_arquivos WHERE processo_id = $1 AND sha256 = $2', [linha.id, sha256]);
      if (repetido) throw conflito('Este arquivo já foi enviado neste processo (mesmo SHA-256). O mesmo atestado não pode ser contado duas vezes.');

      let antivirus: 'nao_verificado' | 'limpo' = 'nao_verificado';
      if (ctx.config.antivirusUrl !== null) {
        let resultado;
        try {
          resultado = await verificarAntivirus(ctx.config.antivirusUrl, conteudo);
        } catch (erro) {
          if (erro instanceof ErroIntegracao) {
            request.log.warn({ err: erro }, 'antivírus indisponível: envio recusado');
            throw new ErroApi(503, 'INDISPONIVEL', 'O antivírus do órgão não respondeu. Por segurança, o documento não foi recebido; tente novamente em instantes.');
          }
          throw erro;
        }
        if (!resultado.limpo) {
          await ctx.banco.transacao(async (tx) => {
            await auditar(tx, request, {
              acao: 'processo.arquivo.recusar_antivirus',
              recurso: 'processo',
              recursoId: linha.id,
              resumo: 'Documento recusado pelo antivírus',
              dados: { numeroSei: linha.numero_sei, sha256, formato, tamanhoBytes: conteudo.length, assinatura: resultado.assinatura },
            });
          });
          throw regraNegocio('O antivírus do órgão apontou ameaça no arquivo e ele foi recusado. O caso ficou registrado na trilha de auditoria.');
        }
        antivirus = 'limpo';
      }

      await armazenamento.gravar(sha256, conteudo);
      const sessao = sessaoDe(request);
      const id = randomUUID();
      await ctx.banco.transacao(async (tx) => {
        await tx.executar(
          `INSERT INTO processos_arquivos (id, processo_id, categoria, tipo, fornecedor_id, titulo, nome_original, formato, tamanho_bytes, sha256,
                                           contem_dado_pessoal, antivirus, exercicio, data_constituicao, enviado_por, enviado_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            id,
            linha.id,
            entrada.categoria,
            entrada.tipo,
            entrada.fornecedorId?.toLowerCase() ?? null,
            entrada.titulo,
            nomeOriginal,
            formato,
            conteudo.length,
            sha256,
            entrada.contemDadoPessoal,
            antivirus,
            entrada.exercicio ?? null,
            entrada.dataConstituicao ?? null,
            sessao.usuario.id,
            ctx.relogio().toISOString(),
          ],
        );
        await auditar(tx, request, {
          acao: 'processo.arquivo.enviar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Enviou ${ROTULO_TIPO[entrada.tipo]} (${formato.toUpperCase()}, ${Math.max(1, Math.round(conteudo.length / 1024))} KB) ao processo`,
          dados: {
            numeroSei: linha.numero_sei,
            arquivoId: id,
            categoria: entrada.categoria,
            tipo: entrada.tipo,
            formato,
            tamanhoBytes: conteudo.length,
            sha256,
            antivirus,
            contemDadoPessoal: entrada.contemDadoPessoal,
            ...(entrada.fornecedorId ? { fornecedorId: entrada.fornecedorId.toLowerCase() } : {}),
          },
        });
      });
      reply.status(201);
      return responderArquivo(linha.id, id);
    });
  });

  // ───────── download (só pela API; LGPD) ─────────

  app.post('/processos/:id/arquivos/:arquivoId/baixar', { preHandler: exigir('documentos:ler') }, async (request, reply) => {
    const entrada = esquemaBaixar.parse(request.body);
    const linha = await processoNoEscopo(request);
    const arquivo = await obterArquivo(ctx.banco, linha.id, idDaRota(request.params, 'arquivoId'));
    if (!arquivo) throw naoEncontrado('Documento não encontrado.');
    if (await anexoNoCofre(ctx.banco, arquivo.id)) throw regraNegocio(MENSAGEM_COFRE, [{ campo: 'RN-40', mensagem: 'Anexo no cofre' }]);
    if (armazenamento === null) throw new ErroApi(503, 'INDISPONIVEL', 'O armazenamento de documentos não está configurado neste ambiente.');
    if (arquivo.contem_dado_pessoal && entrada.finalidade === undefined) {
      throw regraNegocio('Informe a finalidade do acesso: o documento contém dado pessoal e o acesso é registrado (LGPD, art. 37).', [
        { campo: 'finalidade', mensagem: 'Obrigatória (10 a 300 caracteres)' },
      ]);
    }
    let conteudo: Buffer;
    try {
      conteudo = await armazenamento.ler(arquivo.sha256);
    } catch (erro) {
      if (erro instanceof ErroArmazenamento) {
        request.log.error({ err: erro, arquivoId: arquivo.id }, 'documento indisponível no armazenamento');
        throw new ErroApi(500, 'INTERNO', 'O conteúdo do documento não está disponível ou não confere com o SHA-256 registrado. Informe o código ao suporte.');
      }
      throw erro;
    }
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      let registroAcessoId: string | null = null;
      if (arquivo.contem_dado_pessoal && entrada.finalidade !== undefined) {
        const [acesso] = await tx.consultar<{ id: string }>(
          `INSERT INTO processos_arquivos_acessos (arquivo_id, usuario_id, ocorrido_em, finalidade, ip_hash)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [arquivo.id, sessao.usuario.id, ctx.relogio().toISOString(), entrada.finalidade, request.ipHash],
        );
        registroAcessoId = acesso?.id ?? null;
      }
      await auditar(tx, request, {
        acao: arquivo.contem_dado_pessoal ? 'lgpd.documento.acessar' : 'processo.arquivo.baixar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: arquivo.contem_dado_pessoal ? `Baixou ${ROTULO_TIPO[arquivo.tipo]} com dado pessoal (finalidade registrada)` : `Baixou ${ROTULO_TIPO[arquivo.tipo]}`,
        dados: {
          numeroSei: linha.numero_sei,
          arquivoId: arquivo.id,
          sha256: arquivo.sha256,
          dadoPessoal: arquivo.contem_dado_pessoal,
          ...(registroAcessoId !== null ? { registroAcessoId, finalidade: entrada.finalidade } : {}),
        },
      });
    });
    return reply
      .header('content-type', TIPO_CONTEUDO[arquivo.formato])
      .header('content-disposition', disposicaoAnexo(arquivo.nome_original, arquivo.formato))
      .header('x-agora-sha256', arquivo.sha256)
      .send(conteudo);
  });

  // ───────── leitura assistida (RIA-08) ─────────

  app.post('/processos/:id/arquivos/:arquivoId/leitura', { preHandler: exigir('documentos:analisar') }, async (request): Promise<ArquivoProcesso> => {
    const linha = await processoNoEscopo(request);
    const arquivo = await obterArquivo(ctx.banco, linha.id, idDaRota(request.params, 'arquivoId'));
    if (!arquivo) throw naoEncontrado('Documento não encontrado.');
    if (await anexoNoCofre(ctx.banco, arquivo.id)) throw regraNegocio(MENSAGEM_COFRE, [{ campo: 'RN-40', mensagem: 'Anexo no cofre' }]);
    if (arquivo.tipo !== 'atestado_capacidade_tecnica') throw regraNegocio('A leitura assistida é feita nos atestados de capacidade técnica.');
    if (armazenamento === null) throw new ErroApi(503, 'INDISPONIVEL', 'O armazenamento de documentos não está configurado neste ambiente.');
    let conteudo: Buffer;
    try {
      conteudo = await armazenamento.ler(arquivo.sha256);
    } catch (erro) {
      if (erro instanceof ErroArmazenamento) throw new ErroApi(500, 'INTERNO', 'O conteúdo do documento não está disponível ou não confere com o SHA-256 registrado.');
      throw erro;
    }
    const leitura = await lerDocumento(ctx, arquivo.formato, conteudo);
    const parcelas = await parcelasDoProcesso(linha.id);
    // Retrato do que foi localizado nesta leitura (a resposta recalcula com as parcelas vigentes).
    const mencoes = leitura.situacao === 'concluida' ? extrairQuantitativosAtestado(leitura.paginas, parcelas).mencoes.map(mencaoPublica) : [];
    const leituraId = randomUUID();
    const linhas = leitura.paginas.reduce((s, p) => s + p.linhas.length, 0);
    await ctx.banco.transacao(async (tx) => {
      const [ainda] = await tx.consultar<{ id: string }>('SELECT id FROM processos_arquivos WHERE id = $1 AND processo_id = $2', [arquivo.id, linha.id]);
      if (!ainda) throw naoEncontrado('Documento não encontrado.');
      await tx.executar(
        `INSERT INTO processos_arquivos_leituras (id, arquivo_id, metodo, situacao, mensagem, paginas, mencoes, hash_texto, motor, confianca_media, lida_em, lida_por)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)`,
        [
          leituraId,
          arquivo.id,
          leitura.metodo,
          leitura.situacao,
          leitura.mensagem,
          JSON.stringify(leitura.paginas),
          JSON.stringify(mencoes),
          leitura.hashTexto,
          leitura.motor,
          leitura.confianca,
          ctx.relogio().toISOString(),
          sessaoDe(request).usuario.id,
        ],
      );
      await auditar(tx, request, {
        acao: 'processo.arquivo.ler',
        recurso: 'processo',
        recursoId: linha.id,
        resumo:
          leitura.situacao === 'concluida'
            ? `Leitura assistida do atestado por ${leitura.metodo === 'ocr' ? 'OCR' : 'camada de texto'}: ${mencoes.length} quantitativo(s) localizado(s)`
            : `Leitura assistida do atestado não concluída (${leitura.situacao.replace('_', ' ')})`,
        dados: {
          numeroSei: linha.numero_sei,
          arquivoId: arquivo.id,
          sha256: arquivo.sha256,
          leituraId,
          metodo: leitura.metodo,
          situacao: leitura.situacao,
          paginas: leitura.paginas.length,
          linhas,
          hashTexto: leitura.hashTexto,
          motor: leitura.motor,
          confiancaOcr: leitura.confianca,
          mencoes: mencoes.length,
        },
      });
    });
    return responderArquivo(linha.id, arquivo.id);
  });

  // ───────── exigências de qualificação técnica (RN-25) ─────────

  app.put('/processos/:id/qualificacao-tecnica', { preHandler: exigir('jornada:editar') }, async (request): Promise<QualificacaoTecnica> => {
    const entrada = esquemaQualificacao.parse(request.body);
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      exigirEtapaAte(linha, ETAPA_LIMITE_EXIGENCIAS, 'A definição das exigências de qualificação técnica do edital');
      const total = valorTotalEstimado(linha, ctx.hoje());
      const parcelas: ParcelaArmazenada[] = entrada.parcelas.map((p) => ({ ...p, id: p.id?.toLowerCase() ?? randomUUID(), termos: [...new Set(p.termos)] }));
      if (parcelas.length > 0) {
        if (total === null) throw regraNegocio('Conclua a pesquisa de preços antes: o valor total estimado é a base do art. 67, § 1º.');
        const avaliacao = avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: total, parcelas });
        if (!avaliacao.valida) {
          throw regraNegocio(
            'As exigências de qualificação técnica descumprem o art. 67 da Lei 14.133/2021.',
            avaliacao.problemas.map((p) => ({ campo: p.parcela >= 0 ? `parcelas.${p.parcela}` : 'parcelas', mensagem: p.mensagem })),
          );
        }
      }
      if (new Set(parcelas.map((p) => p.id)).size !== parcelas.length) throw validacao('Há parcelas com o mesmo identificador.');
      const agora = ctx.relogio().toISOString();
      await tx.executar(
        `INSERT INTO processos_qualificacao_tecnica (processo_id, parcelas, definida_em, definida_por) VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (processo_id) DO UPDATE SET parcelas = EXCLUDED.parcelas, definida_em = EXCLUDED.definida_em, definida_por = EXCLUDED.definida_por`,
        [linha.id, JSON.stringify(parcelas), agora, sessaoDe(request).usuario.id],
      );
      await auditar(tx, request, {
        acao: 'processo.qualificacao_tecnica.definir',
        recurso: 'processo',
        recursoId: linha.id,
        resumo:
          parcelas.length === 0
            ? 'Retirou as exigências de atestado de qualificação técnica do edital'
            : `Definiu ${parcelas.length} parcela(s) de maior relevância para a qualificação técnica (art. 67)`,
        dados: {
          numeroSei: linha.numero_sei,
          etapa: linha.etapa_atual,
          valorTotalEstimado: total,
          parcelas: parcelas.map((p) => ({ id: p.id, descricao: p.descricao, unidade: p.unidade, quantidadeObjeto: p.quantidadeObjeto, valorEstimado: p.valorEstimado, quantidadeMinima: p.quantidadeMinima })),
        },
      });
    });
    const linha = await obterLinhaProcesso(ctx.banco, id, escopo);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return qualificacao(linha);
  });
}
