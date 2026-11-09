/**
 * Sigilo de segurança pública (F25): classificação do processo, dos documentos, dos anexos e do contrato (RN-40),
 * credenciamento e registro de acessos (RF-33), cofre de anexos e carimbo de tempo da trilha (RNF-09).
 *
 * Além das rotas, o módulo registra dois pontos de checagem para todas as rotas `/processos/:id…`:
 *   - processo classificado pela LAI: só quem tem credencial no processo (ou órgão de controle) passa; a negação é
 *     registrada (Decreto 7.845/2012, art. 38, § 4º);
 *   - documento classificado: o conteúdo devolvido no detalhe do processo é trocado por um aviso para quem não tem
 *     acesso; para quem tem, a consulta é registrada.
 * A decisão é sempre do servidor (`decidirAcessoSigilo`); a interface só esconde o que o servidor já negou.
 */
import { randomUUID } from 'node:crypto';
import { codigoIndexacaoSigilo, grauAbrange, marcacaoSigilo, validarClassificacaoSigilo, type GrauSigilo, type HipoteseSigiloLai, type NivelAutoridadeClassificadora } from '@agora/dominio';
import type { AcessoSigiloRegistrado, AlvoSigilo, ItemSigiloProcesso, Pagina, SigiloProcesso, UsuarioCredenciavel } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { criarArmazenamento, ErroArmazenamento } from '../../armazenamento/arquivos.ts';
import { escopoUasgs, exigir, podeVerUasg, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { inspecionarPdf } from '../../compartilhado/pdf-leitura.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { detectarFormato, disposicaoAnexo, sanitizarNomeArquivo, TIPO_CONTEUDO } from '../../compartilhado/tipo-arquivo.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, ErroApi, naoEncontrado, regraNegocio, validacao } from '../../http/erros.ts';
import { camposPaginacao, dataIso, deslocamento, idDaRota, pagina, uuid } from '../../http/validacao.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { verificarAntivirus } from '../../integracoes/antivirus.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';
import { carregarContextoAcesso, consultaRegistradaRecentemente, decidirPara, registrarAcessoSigilo, type RegistroAcesso } from './acesso.ts';
import { agendarAncoragem, ancorarTrilha, situacaoAncoragens, verificarAncoragens } from './ancoragem.ts';
import { aadAnexo, cifrar, decifrar, ErroCofre, resolverChaveCofre } from './cofre.ts';
import {
  anexosNoCofre,
  contratosSigilosos,
  listarClassificacoes,
  listarCredenciais,
  mapearClassificacao,
  marcosOrcamento,
  processoClassificado,
  ROTULOS_DOCUMENTO,
  vigente,
  vigentesPorProcesso,
  type AlvoConsulta,
  type LinhaClassificacao,
  type TipoDocumentoSigilo,
} from './consultas.ts';

const GRAUS = ['reservada', 'secreta', 'ultrassecreta'] as const;
const HIPOTESES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'] as const;
const NIVEIS = ['ministro_estado', 'titular_entidade', 'direcao_das_101_5', 'delegacao'] as const;
const TIPOS_DOCUMENTO = ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato', 'parecer_checklist'] as const;
const PREFIXO_PROCESSO = '/api/v1/processos/:id';
const PREFIXO_CONTRATO = '/api/v1/contratos/:id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CABECALHO_NOME = 'x-agora-nome-arquivo';

const esquemaAutoridade = z.object({
  nome: z.string().trim().min(3).max(200),
  cargo: z.string().trim().min(3).max(200),
  nivel: z.enum(NIVEIS),
  atoDelegacao: z.string().trim().max(200).nullable().default(null),
});

const esquemaClassificacao = z.object({
  alvo: z.enum(['processo', 'documento', 'anexo', 'contrato']),
  documentoTipo: z.enum(TIPOS_DOCUMENTO).optional(),
  arquivoId: uuid.optional(),
  tipo: z.enum(['lai', 'orcamento']),
  grau: z.enum(GRAUS).nullable(),
  hipotese: z.enum(HIPOTESES).nullable(),
  razoes: z.string().trim().min(30).max(2000),
  dataProducao: dataIso,
  prazoFim: dataIso.nullable(),
  eventoFim: z.string().trim().max(500).nullable(),
  autoridade: esquemaAutoridade.nullable(),
  motivoReclassificacao: z.string().trim().min(10).max(500).optional(),
});

const esquemaMotivo = (minimo: number, maximo: number) => z.object({ motivo: z.string().trim().min(minimo).max(maximo) });

const esquemaCredencial = z.object({
  usuarioId: uuid,
  grauMaximo: z.enum(GRAUS),
  fundamento: z.enum(['credencial_seguranca', 'tcms']),
  necessidade: z.string().trim().min(20).max(500),
  validaAte: dataIso.nullable(),
});

const esquemaEnvioCofre = z.object({
  titulo: z.string().trim().min(3).max(200),
  contemDadoPessoal: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  tipoSigilo: z.enum(['lai', 'orcamento']),
  grau: z.enum(GRAUS).optional(),
  hipotese: z.enum(HIPOTESES).optional(),
  razoes: z.string().trim().min(30).max(2000),
  dataProducao: dataIso,
  prazoFim: dataIso.optional(),
  eventoFim: z.string().trim().max(500).optional(),
  autoridadeNome: z.string().trim().min(3).max(200).optional(),
  autoridadeCargo: z.string().trim().min(3).max(200).optional(),
  autoridadeNivel: z.enum(NIVEIS).optional(),
  atoDelegacao: z.string().trim().max(200).optional(),
});

const ROTULO_GRAU: Record<GrauSigilo, string> = { reservada: 'reservada', secreta: 'secreta', ultrassecreta: 'ultrassecreta' };

function ehDetalheProcesso(valor: unknown): valor is { id: string; numeroSei: string; documentos: { tipo: TipoDocumentoSigilo; conteudo: string }[] } {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.numeroSei === 'string' && Array.isArray(v.documentos);
}

function avisoConteudoRetido(c: LinhaClassificacao): string {
  const marca = marcacaoSigilo({ tipo: c.tipo, grau: c.grau, prazoFim: c.prazo_fim, eventoFim: c.evento_fim, prazoLimite: c.prazo_limite });
  return [
    `# ${marca.cabecalho}`,
    '',
    `Conteúdo restrito: ${marca.rodape}`,
    '',
    'Peça o credenciamento no processo ao gestor de segurança e credenciamento. A tentativa de acesso foi registrada.',
  ].join('\n');
}

export async function rotasSigilo(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const armazenamento = criarArmazenamento(ctx.config.arquivos.dir);
  const chave = resolverChaveCofre(ctx.config, ctx.segredo);
  const limite = ctx.config.arquivos.tamanhoMaximoBytes;
  const megabytes = Math.round(limite / (1024 * 1024));

  async function registrarSeparado(request: FastifyRequest, r: RegistroAcesso): Promise<void> {
    await ctx.banco.transacao((tx) => registrarAcessoSigilo(tx, request, r));
  }

  async function processoNoEscopo(request: FastifyRequest, tx?: Transacao): Promise<LinhaProcesso> {
    const linha = await obterLinhaProcesso(tx ?? ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)), tx !== undefined);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return linha;
  }

  // ───────── ponto de checagem: processo classificado ─────────

  app.addHook('preHandler', async (request) => {
    const rota = request.routeOptions.url ?? '';
    if (!(rota === PREFIXO_PROCESSO || rota.startsWith(`${PREFIXO_PROCESSO}/`)) || rota.startsWith(`${PREFIXO_PROCESSO}/sigilo`)) return;
    const sessao = request.sessao;
    const id = (request.params as { id?: unknown }).id;
    if (!sessao || sessao.deveTrocarSenha || typeof id !== 'string' || !UUID.test(id)) return;
    const [processo] = await ctx.banco.consultar<{ uasg: string; numero_sei: string }>('SELECT uasg, numero_sei FROM processos WHERE id = $1', [id]);
    if (!processo || !podeVerUasg(sessao, processo.uasg)) return;
    const hoje = ctx.hoje();
    const classificacao = await processoClassificado(ctx.banco, id, hoje);
    if (!classificacao) return;
    const contexto = await carregarContextoAcesso(ctx.banco, id, sessao, hoje);
    const { decisao } = decidirPara(contexto, { alvo: 'processo' });
    const titulo = `Processo ${processo.numero_sei}`;
    const registrar = !(await consultaRegistradaRecentemente(ctx.banco, id, sessao.usuario.id, 'processo', titulo, ctx.relogio(), decisao.permitido));
    if (registrar && (!decisao.permitido || (request.method === 'GET' && rota === PREFIXO_PROCESSO))) {
      await registrarSeparado(request, {
        processoId: id,
        numeroSei: processo.numero_sei,
        classificacaoId: classificacao.id,
        alvo: 'processo',
        titulo,
        operacao: 'consulta',
        permitido: decisao.permitido,
        base: decisao.base,
        motivo: null,
      });
    }
    if (!decisao.permitido) throw new ErroApi(403, 'SEM_PERMISSAO', decisao.mensagem);
  });

  // ───────── ponto de checagem: contrato sigiloso ─────────

  app.addHook('preHandler', async (request) => {
    const rota = request.routeOptions.url ?? '';
    if (!(rota === PREFIXO_CONTRATO || rota.startsWith(`${PREFIXO_CONTRATO}/`))) return;
    const sessao = request.sessao;
    const id = (request.params as { id?: unknown }).id;
    if (!sessao || sessao.deveTrocarSenha || typeof id !== 'string' || !UUID.test(id)) return;
    const hoje = ctx.hoje();
    const sigilosos = await contratosSigilosos(ctx.banco, [id], hoje);
    const classificacao = sigilosos.get(id);
    if (!classificacao) return;
    const [contrato] = await ctx.banco.consultar<{ uasg: string; numero: string }>('SELECT uasg, numero FROM contratos WHERE id = $1', [id]);
    if (!contrato || !podeVerUasg(sessao, contrato.uasg)) return;
    const contexto = await carregarContextoAcesso(ctx.banco, classificacao.processo_id, sessao, hoje);
    const { decisao } = decidirPara(contexto, { alvo: 'contrato', contratoId: id });
    const [processo] = await ctx.banco.consultar<{ numero_sei: string }>('SELECT numero_sei FROM processos WHERE id = $1', [classificacao.processo_id]);
    const titulo = `Contrato ${contrato.numero}`;
    const registrar = !(await consultaRegistradaRecentemente(ctx.banco, classificacao.processo_id, sessao.usuario.id, 'contrato', titulo, ctx.relogio(), decisao.permitido));
    if (registrar && (!decisao.permitido || (request.method === 'GET' && rota === PREFIXO_CONTRATO))) {
      await registrarSeparado(request, {
        processoId: classificacao.processo_id,
        numeroSei: processo?.numero_sei ?? '08000.000000/0000-00',
        classificacaoId: classificacao.id,
        alvo: 'contrato',
        titulo,
        operacao: 'consulta',
        permitido: decisao.permitido,
        base: decisao.base,
        motivo: null,
      });
    }
    if (!decisao.permitido) throw new ErroApi(403, 'SEM_PERMISSAO', decisao.mensagem);
  });

  // ───────── ponto de checagem: conteúdo de documento classificado no detalhe do processo ─────────

  app.addHook('preSerialization', async (request, _reply, payload: unknown) => {
    const rota = request.routeOptions.url ?? '';
    if (!(rota === '/api/v1/processos' || rota === PREFIXO_PROCESSO || rota.startsWith(`${PREFIXO_PROCESSO}/`))) return payload;
    const sessao = request.sessao;
    if (!sessao || !ehDetalheProcesso(payload)) return payload;
    const hoje = ctx.hoje();
    const vigentes = (await vigentesPorProcesso(ctx.banco, [payload.id], hoje)).get(payload.id) ?? [];
    if (!vigentes.some((c) => c.alvo === 'documento' || c.alvo === 'processo')) return payload;
    const contexto = await carregarContextoAcesso(ctx.banco, payload.id, sessao, hoje);
    const registros: RegistroAcesso[] = [];
    const documentos = [];
    for (const d of payload.documentos) {
      const { decisao, classificacao } = decidirPara(contexto, { alvo: 'documento', documentoTipo: d.tipo });
      if (classificacao === null) {
        documentos.push(d);
        continue;
      }
      const titulo = `${ROTULOS_DOCUMENTO[d.tipo]} do processo ${payload.numeroSei}`;
      if (!registros.some((r) => r.titulo === titulo) && !(await consultaRegistradaRecentemente(ctx.banco, payload.id, sessao.usuario.id, 'documento', titulo, ctx.relogio(), decisao.permitido))) {
        registros.push({
          processoId: payload.id,
          numeroSei: payload.numeroSei,
          classificacaoId: classificacao.id,
          alvo: 'documento',
          titulo,
          operacao: 'consulta',
          permitido: decisao.permitido,
          base: decisao.base,
          motivo: null,
        });
      }
      documentos.push(decisao.permitido ? d : { ...d, conteudo: avisoConteudoRetido(classificacao) });
    }
    if (registros.length > 0) {
      await ctx.banco.transacao(async (tx) => {
        for (const r of registros) await registrarAcessoSigilo(tx, request, r);
      });
    }
    return { ...payload, documentos };
  });

  // ───────── tela de sigilo ─────────

  async function montarSigilo(request: FastifyRequest, linha: LinhaProcesso): Promise<SigiloProcesso> {
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const todas = await listarClassificacoes(ctx.banco, linha.id, true);
    const contexto = await carregarContextoAcesso(ctx.banco, linha.id, sessao, hoje);
    const temAcesso = (alvo: AlvoConsulta) => decidirPara(contexto, alvo).decisao.permitido;
    const atuais = todas.filter((c) => c.situacao === 'vigente');
    const atual = (pred: (c: LinhaClassificacao) => boolean) => atuais.find(pred) ?? null;
    const mapear = (c: LinhaClassificacao | null, alvo: AlvoConsulta) => (c === null ? null : mapearClassificacao(c, hoje, temAcesso(alvo)));

    const tipos = await ctx.banco.consultar<{ tipo: TipoDocumentoSigilo }>('SELECT DISTINCT tipo FROM documentos_gerados WHERE processo_id = $1', [linha.id]);
    const anexos = await ctx.banco.consultar<{ id: string; titulo: string; tipo: string; formato: string; tamanho_bytes: number }>(
      'SELECT id, titulo, tipo, formato, tamanho_bytes FROM processos_arquivos WHERE processo_id = $1 ORDER BY enviado_em',
      [linha.id],
    );
    const cofre = await anexosNoCofre(ctx.banco, anexos.map((a) => a.id));
    const itens: ItemSigiloProcesso[] = [
      ...TIPOS_DOCUMENTO.filter((t) => tipos.some((x) => x.tipo === t)).map((t) => {
        const alvo: AlvoConsulta = { alvo: 'documento', documentoTipo: t };
        return {
          alvo: 'documento' as const,
          documentoTipo: t,
          arquivoId: null,
          titulo: ROTULOS_DOCUMENTO[t],
          descricao: 'Documento gerado na jornada',
          noCofre: false,
          classificacao: mapear(atual((c) => c.alvo === 'documento' && c.documento_tipo === t), alvo),
        };
      }),
      ...anexos.map((a) => {
        const alvo: AlvoConsulta = { alvo: 'anexo', arquivoId: a.id };
        const propria = atual((c) => c.alvo === 'anexo' && c.arquivo_id === a.id);
        const oculto = propria !== null && vigente(propria, hoje) && !temAcesso(alvo);
        return {
          alvo: 'anexo' as const,
          documentoTipo: null,
          arquivoId: a.id,
          titulo: oculto ? 'Anexo classificado' : a.titulo,
          descricao: `Anexo ${a.formato.toUpperCase()}, ${Math.max(1, Math.round(a.tamanho_bytes / 1024))} KB`,
          noCofre: cofre.has(a.id),
          classificacao: mapear(propria, alvo),
        };
      }),
    ];
    const marcos = (await marcosOrcamento(ctx.banco, [linha.id])).get(linha.id);
    const podeCredenciar = sessao.permissoes.has('sigilo:credenciar');
    let credenciaveis: UsuarioCredenciavel[] = [];
    if (podeCredenciar) {
      const linhas = await ctx.banco.consultar<{ id: string; nome: string; perfis: UsuarioCredenciavel['perfis'] }>(
        `SELECT u.id, u.nome, array_agg(DISTINCT up.perfil ORDER BY up.perfil) AS perfis
           FROM usuarios u JOIN usuarios_perfis up ON up.usuario_id = u.id
          WHERE u.ativo AND (u.todas_uasgs OR EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = $1))
          GROUP BY u.id, u.nome
          ORDER BY u.nome`,
        [linha.uasg],
      );
      credenciaveis = linhas.map((l) => ({ id: l.id, nome: l.nome, perfis: l.perfis }));
    }
    const credenciais = await listarCredenciais(ctx.banco, linha.id);
    return {
      processoId: linha.id,
      numeroSei: linha.numero_sei,
      titulo: linha.titulo,
      processo: mapear(atual((c) => c.alvo === 'processo'), { alvo: 'processo' }),
      contrato:
        linha.contrato_id === null
          ? null
          : {
              id: linha.contrato_id,
              numero: linha.contrato_numero ?? '',
              classificacao: mapear(
                atual((c) => c.alvo === 'contrato'),
                { alvo: 'contrato', contratoId: linha.contrato_id },
              ),
            },
      itens,
      orcamento: {
        sigiloso: marcos?.orcamentoSigiloso ?? false,
        motivo: marcos?.motivo ?? null,
        situacao: marcos?.situacao.situacao ?? 'publico',
        divulgadoEm: marcos?.situacao.divulgadoEm ?? null,
        mensagem: marcos?.situacao.mensagem ?? 'O orçamento estimado não é sigiloso.',
        fundamento: marcos?.situacao.fundamento ?? 'Lei 14.133/2021, art. 24',
      },
      credenciais,
      credenciaveis,
      meuAcesso: {
        orgaoControle: contexto.orgaoControle,
        credencial: credenciais.find((c) => c.ativa && c.usuario.id === sessao.usuario.id) ?? null,
        podeClassificar: sessao.permissoes.has('sigilo:classificar'),
        podeCredenciar,
      },
      cofre: {
        disponivel: chave !== null && armazenamento !== null,
        algoritmo: 'AES-256-GCM',
        chaveId: chave?.id ?? null,
        motivoIndisponivel:
          armazenamento === null
            ? 'O armazenamento de documentos não está configurado (AGORA_ARQUIVOS_DIR).'
            : chave === null
              ? 'A chave do cofre não está configurada (AGORA_COFRE_CHAVE).'
              : chave.derivada
                ? 'Chave derivada do segredo do servidor (só fora de produção): em produção, use AGORA_COFRE_CHAVE.'
                : null,
      },
      historico: todas
        .filter((c) => c.situacao !== 'vigente')
        .map((c) => mapearClassificacao(c, hoje, temAcesso({ alvo: c.alvo, documentoTipo: c.documento_tipo, arquivoId: c.arquivo_id, contratoId: c.contrato_id }))),
    };
  }

  app.get('/processos/:id/sigilo', { preHandler: exigir('sigilo:ler') }, async (request): Promise<SigiloProcesso> => montarSigilo(request, await processoNoEscopo(request)));

  // ───────── cofre: selar um anexo existente ─────────

  async function prepararSelo(arquivo: { id: string; sha256: string }): Promise<{ sha256Cifrado: string; tamanho: number; chaveId: string }> {
    if (armazenamento === null) throw new ErroApi(503, 'INDISPONIVEL', 'O armazenamento de documentos não está configurado neste ambiente (AGORA_ARQUIVOS_DIR).');
    if (chave === null) throw new ErroApi(503, 'INDISPONIVEL', 'O cofre de anexos sigilosos não está configurado: defina AGORA_COFRE_CHAVE (32 bytes, base64 ou hexadecimal).');
    let conteudo: Buffer;
    try {
      conteudo = await armazenamento.ler(arquivo.sha256);
    } catch (erro) {
      if (erro instanceof ErroArmazenamento) throw new ErroApi(500, 'INTERNO', 'O conteúdo do anexo não está disponível para ser cifrado.');
      throw erro;
    }
    const pacote = cifrar(chave, conteudo, aadAnexo(arquivo.id, arquivo.sha256));
    const sha256Cifrado = sha256Hex(pacote);
    await armazenamento.gravar(sha256Cifrado, pacote);
    return { sha256Cifrado, tamanho: pacote.length, chaveId: chave.id };
  }

  /** Apaga o original em claro quando nenhum outro registro fora do cofre usa o mesmo conteúdo. */
  async function removerOriginal(sha256: string): Promise<void> {
    if (armazenamento === null) return;
    const [uso] = await ctx.banco.consultar<{ total: number }>(
      `SELECT COUNT(*)::integer AS total FROM processos_arquivos pa
        WHERE pa.sha256 = $1 AND NOT EXISTS (SELECT 1 FROM sigilo_cofre c WHERE c.arquivo_id = pa.id)`,
      [sha256],
    );
    if ((uso?.total ?? 0) === 0) await armazenamento.remover(sha256);
  }

  // ───────── classificação, reclassificação e desclassificação ─────────

  async function garantirCredencialDoClassificador(tx: Transacao, request: FastifyRequest, processoId: string, numeroSei: string, grau: GrauSigilo): Promise<void> {
    const sessao = sessaoDe(request);
    const [ativa] = await tx.consultar<{ id: string; grau_maximo: GrauSigilo; valida_ate: string | null }>(
      'SELECT id, grau_maximo, valida_ate FROM sigilo_credenciais WHERE processo_id = $1 AND usuario_id = $2 AND revogada_em IS NULL',
      [processoId, sessao.usuario.id],
    );
    if (ativa && grauAbrange(ativa.grau_maximo, grau) && (ativa.valida_ate === null || ativa.valida_ate >= ctx.hoje())) return;
    const agora = ctx.relogio().toISOString();
    if (ativa) {
      await tx.executar('UPDATE sigilo_credenciais SET revogada_em = $2, revogada_por = $3, motivo_revogacao = $4 WHERE id = $1', [
        ativa.id,
        agora,
        sessao.usuario.id,
        'Substituída pela credencial do classificador, de grau maior.',
      ]);
    }
    await tx.executar(
      `INSERT INTO sigilo_credenciais (processo_id, usuario_id, grau_maximo, fundamento, necessidade, valida_ate, concedida_em, concedida_por)
       VALUES ($1, $2, $3, 'credencial_seguranca', $4, NULL, $5, $2)`,
      [processoId, sessao.usuario.id, grau, 'Registrou a classificação da informação no processo (credencial do classificador).', agora],
    );
    await auditar(tx, request, {
      acao: 'sigilo.credenciar',
      recurso: 'processo',
      recursoId: processoId,
      resumo: `Recebeu credencial de acesso até o grau ${ROTULO_GRAU[grau]} ao registrar a classificação`,
      dados: { numeroSei, usuarioId: sessao.usuario.id, grauMaximo: grau, fundamento: 'credencial_seguranca', automatica: true },
    });
  }

  app.post('/processos/:id/sigilo/classificacoes', { preHandler: exigir('sigilo:classificar') }, async (request): Promise<SigiloProcesso> => {
    const entrada = esquemaClassificacao.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    const previa = await processoNoEscopo(request);

    // Alvo: existe no processo?
    const alvo: AlvoConsulta = { alvo: entrada.alvo };
    let tituloAlvo = `Processo ${previa.numero_sei}`;
    let arquivo: { id: string; sha256: string; titulo: string } | null = null;
    if (entrada.alvo === 'documento') {
      if (!entrada.documentoTipo) throw validacao('Indique o documento a classificar.', [{ campo: 'documentoTipo', mensagem: 'Obrigatório para documento' }]);
      const [existe] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM documentos_gerados WHERE processo_id = $1 AND tipo = $2 LIMIT 1', [previa.id, entrada.documentoTipo]);
      if (!existe) throw regraNegocio(`O processo ainda não tem ${ROTULOS_DOCUMENTO[entrada.documentoTipo].toLowerCase()} gerado.`);
      alvo.documentoTipo = entrada.documentoTipo;
      tituloAlvo = ROTULOS_DOCUMENTO[entrada.documentoTipo];
    } else if (entrada.alvo === 'anexo') {
      if (!entrada.arquivoId) throw validacao('Indique o anexo a classificar.', [{ campo: 'arquivoId', mensagem: 'Obrigatório para anexo' }]);
      const [a] = await ctx.banco.consultar<{ id: string; sha256: string; titulo: string }>('SELECT id, sha256, titulo FROM processos_arquivos WHERE id = $1 AND processo_id = $2', [
        entrada.arquivoId.toLowerCase(),
        previa.id,
      ]);
      if (!a) throw naoEncontrado('Anexo não encontrado neste processo.');
      arquivo = a;
      alvo.arquivoId = a.id;
      tituloAlvo = a.titulo;
    } else if (entrada.alvo === 'contrato') {
      if (previa.contrato_id === null) throw regraNegocio('O processo ainda não gerou contrato (etapa 7).');
      alvo.contratoId = previa.contrato_id;
      tituloAlvo = `Contrato ${previa.contrato_numero ?? ''}`.trim();
    }
    if (entrada.tipo === 'orcamento' && entrada.alvo !== 'documento' && entrada.alvo !== 'anexo') {
      throw regraNegocio('O sigilo do orçamento (art. 24) vale para documentos e anexos com o orçamento e as memórias de cálculo; para o processo ou o contrato, use a classificação da LAI.');
    }

    const validada = validarClassificacaoSigilo(
      {
        tipo: entrada.tipo,
        grau: entrada.grau,
        hipotese: entrada.hipotese,
        razoes: entrada.razoes,
        dataProducao: entrada.dataProducao,
        prazoFim: entrada.prazoFim,
        eventoFim: entrada.eventoFim,
        autoridade: entrada.autoridade,
        orcamentoSigilosoNoProcesso: previa.cesta.orcamentoSigiloso,
        criterioJulgamento: previa.edital.criterioJulgamento ?? null,
      },
      hoje,
    );

    // Quem reclassifica precisa ter acesso ao que já está classificado.
    const contexto = await carregarContextoAcesso(ctx.banco, previa.id, sessao, hoje);
    const atual = decidirPara(contexto, alvo);
    if (!atual.decisao.permitido) {
      await registrarSeparado(request, {
        processoId: previa.id,
        numeroSei: previa.numero_sei,
        classificacaoId: atual.classificacao?.id ?? null,
        alvo: entrada.alvo,
        titulo: tituloAlvo,
        operacao: 'consulta',
        permitido: false,
        base: atual.decisao.base,
        motivo: null,
      });
      throw new ErroApi(403, 'SEM_PERMISSAO', atual.decisao.mensagem);
    }

    const selo = arquivo && !(await anexosNoCofre(ctx.banco, [arquivo.id])).has(arquivo.id) ? await prepararSelo(arquivo) : null;

    await ctx.banco.transacao(async (tx) => {
      const linha = await processoNoEscopo(request, tx);
      const [anterior] = await tx.consultar<{ id: string; versao: number; tipo: string; grau: string | null }>(
        `SELECT id, versao, tipo, grau FROM sigilo_classificacoes
          WHERE processo_id = $1 AND alvo = $2 AND situacao = 'vigente'
            AND COALESCE(documento_tipo, '') = COALESCE($3, '') AND COALESCE(arquivo_id::text, '') = COALESCE($4, '')
            AND COALESCE(contrato_id::text, '') = COALESCE($5, '')
          FOR UPDATE`,
        [linha.id, entrada.alvo, alvo.documentoTipo ?? null, alvo.arquivoId ?? null, alvo.contratoId ?? null],
      );
      const agora = ctx.relogio().toISOString();
      if (anterior) {
        if (!entrada.motivoReclassificacao) {
          throw regraNegocio('Já há classificação vigente para este item: informe o motivo da reclassificação (Lei 12.527/2011, art. 29).', [
            { campo: 'motivoReclassificacao', mensagem: 'Obrigatório na reclassificação (10 a 500 caracteres)' },
          ]);
        }
        await tx.executar(`UPDATE sigilo_classificacoes SET situacao = 'substituida', encerrada_em = $2, encerrada_por = $3, motivo_encerramento = $4 WHERE id = $1`, [
          anterior.id,
          agora,
          sessao.usuario.id,
          entrada.motivoReclassificacao,
        ]);
      }
      const id = randomUUID();
      const codigo = codigoIndexacaoSigilo({ numeroSei: linha.numero_sei, tipo: validada.tipo, grau: validada.grau, classificadaEm: hoje, prazoFim: validada.prazoFim });
      await tx.executar(
        `INSERT INTO sigilo_classificacoes (id, processo_id, alvo, documento_tipo, arquivo_id, contrato_id, tipo, grau, hipotese, razoes, data_producao,
                                            prazo_fim, evento_fim, prazo_limite, autoridade, fundamento, codigo_indexacao, situacao, versao,
                                            classificada_em, classificada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, 'vigente', $18, $19, $20)`,
        [
          id,
          linha.id,
          entrada.alvo,
          alvo.documentoTipo ?? null,
          alvo.arquivoId ?? null,
          alvo.contratoId ?? null,
          validada.tipo,
          validada.grau,
          validada.hipotese,
          validada.razoes,
          validada.dataProducao,
          validada.prazoFim,
          validada.eventoFim,
          validada.prazoLimite,
          validada.autoridade === null ? null : JSON.stringify(validada.autoridade),
          validada.fundamento,
          codigo,
          (anterior?.versao ?? 0) + 1,
          agora,
          sessao.usuario.id,
        ],
      );
      if (selo && arquivo) {
        await tx.executar(
          `INSERT INTO sigilo_cofre (arquivo_id, sha256_cifrado, chave_id, tamanho_cifrado, selado_em, selado_por) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (arquivo_id) DO NOTHING`,
          [arquivo.id, selo.sha256Cifrado, selo.chaveId, selo.tamanho, agora, sessao.usuario.id],
        );
      }
      await garantirCredencialDoClassificador(tx, request, linha.id, linha.numero_sei, validada.grau ?? 'reservada');
      await auditar(tx, request, {
        acao: anterior ? 'sigilo.reclassificar' : 'sigilo.classificar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo:
          validada.tipo === 'lai'
            ? `${anterior ? 'Reclassificou' : 'Classificou'} ${tituloAlvo} como informação ${validada.grau} (${codigo})`
            : `${anterior ? 'Reclassificou' : 'Classificou'} ${tituloAlvo} como anexo do orçamento sigiloso (art. 24)`,
        dados: {
          numeroSei: linha.numero_sei,
          classificacaoId: id,
          anteriorId: anterior?.id ?? null,
          alvo: entrada.alvo,
          documentoTipo: alvo.documentoTipo ?? null,
          arquivoId: alvo.arquivoId ?? null,
          contratoId: alvo.contratoId ?? null,
          tipo: validada.tipo,
          grau: validada.grau,
          hipotese: validada.hipotese,
          dataProducao: validada.dataProducao,
          prazoFim: validada.prazoFim,
          prazoLimite: validada.prazoLimite,
          termoPorEvento: validada.eventoFim !== null,
          autoridade: validada.autoridade ? { cargo: validada.autoridade.cargo, nivel: validada.autoridade.nivel } : null,
          codigoIndexacao: codigo,
          versao: (anterior?.versao ?? 0) + 1,
          // As razões integram o termo de classificação e têm o mesmo sigilo: na trilha vai só o hash.
          hashRazoes: sha256Hex(validada.razoes),
          ...(anterior ? { motivoReclassificacao: entrada.motivoReclassificacao } : {}),
          ...(selo ? { cofre: { sha256Cifrado: selo.sha256Cifrado, chaveId: selo.chaveId, algoritmo: 'AES-256-GCM' } } : {}),
        },
      });
    });
    if (selo && arquivo) await removerOriginal(arquivo.sha256);
    return montarSigilo(request, await processoNoEscopo(request));
  });

  app.post('/processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar', { preHandler: exigir('sigilo:classificar') }, async (request): Promise<SigiloProcesso> => {
    const { motivo } = esquemaMotivo(20, 1000).parse(request.body);
    const sessao = sessaoDe(request);
    const previa = await processoNoEscopo(request);
    const classificacaoId = idDaRota(request.params, 'classificacaoId');
    const [alvoLinha] = await ctx.banco.consultar<LinhaClassificacao>(
      `SELECT id, alvo, documento_tipo, arquivo_id, contrato_id FROM sigilo_classificacoes WHERE id = $1 AND processo_id = $2 AND situacao = 'vigente'`,
      [classificacaoId, previa.id],
    );
    if (!alvoLinha) throw naoEncontrado('Classificação vigente não encontrada neste processo.');
    const alvo: AlvoConsulta = { alvo: alvoLinha.alvo, documentoTipo: alvoLinha.documento_tipo, arquivoId: alvoLinha.arquivo_id, contratoId: alvoLinha.contrato_id };
    const contexto = await carregarContextoAcesso(ctx.banco, previa.id, sessao, ctx.hoje());
    const { decisao } = decidirPara(contexto, alvo);
    if (!decisao.permitido) {
      await registrarSeparado(request, {
        processoId: previa.id,
        numeroSei: previa.numero_sei,
        classificacaoId,
        alvo: alvo.alvo,
        titulo: 'Desclassificação',
        operacao: 'consulta',
        permitido: false,
        base: decisao.base,
        motivo: null,
      });
      throw new ErroApi(403, 'SEM_PERMISSAO', decisao.mensagem);
    }
    await ctx.banco.transacao(async (tx) => {
      const linha = await processoNoEscopo(request, tx);
      const alteradas = await tx.executar(
        `UPDATE sigilo_classificacoes SET situacao = 'desclassificada', encerrada_em = $3, encerrada_por = $4, motivo_encerramento = $5
          WHERE id = $1 AND processo_id = $2 AND situacao = 'vigente'`,
        [classificacaoId, linha.id, ctx.relogio().toISOString(), sessao.usuario.id, motivo],
      );
      if (alteradas === 0) throw conflito('A classificação já foi encerrada por outra pessoa. Atualize a página.');
      await auditar(tx, request, {
        acao: 'sigilo.desclassificar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Desclassificou informação do processo (${alvo.alvo === 'documento' && alvo.documentoTipo ? ROTULOS_DOCUMENTO[alvo.documentoTipo] : alvo.alvo})`,
        dados: { numeroSei: linha.numero_sei, classificacaoId, alvo: alvo.alvo, documentoTipo: alvo.documentoTipo ?? null, arquivoId: alvo.arquivoId ?? null, motivo },
      });
    });
    return montarSigilo(request, await processoNoEscopo(request));
  });

  // ───────── credenciamento ─────────

  app.post('/processos/:id/sigilo/credenciais', { preHandler: exigir('sigilo:credenciar') }, async (request): Promise<SigiloProcesso> => {
    const entrada = esquemaCredencial.parse(request.body);
    const sessao = sessaoDe(request);
    const hoje = ctx.hoje();
    if (entrada.validaAte !== null && entrada.validaAte < hoje) throw validacao('A validade da credencial não pode estar no passado.', [{ campo: 'validaAte', mensagem: 'Data passada' }]);
    await ctx.banco.transacao(async (tx) => {
      const linha = await processoNoEscopo(request, tx);
      const usuarioId = entrada.usuarioId.toLowerCase();
      const [usuario] = await tx.consultar<{ id: string; nome: string }>(
        `SELECT u.id, u.nome FROM usuarios u
          WHERE u.id = $1 AND u.ativo AND (u.todas_uasgs OR EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = $2))`,
        [usuarioId, linha.uasg],
      );
      if (!usuario) throw regraNegocio('O usuário não existe, está inativo ou não tem acesso à UASG do processo.', [{ campo: 'usuarioId', mensagem: 'Fora do escopo do processo' }]);
      const agora = ctx.relogio().toISOString();
      const [ativa] = await tx.consultar<{ id: string }>('SELECT id FROM sigilo_credenciais WHERE processo_id = $1 AND usuario_id = $2 AND revogada_em IS NULL FOR UPDATE', [linha.id, usuarioId]);
      if (ativa) {
        await tx.executar('UPDATE sigilo_credenciais SET revogada_em = $2, revogada_por = $3, motivo_revogacao = $4 WHERE id = $1', [ativa.id, agora, sessao.usuario.id, 'Substituída por nova credencial.']);
      }
      await tx.executar(
        `INSERT INTO sigilo_credenciais (processo_id, usuario_id, grau_maximo, fundamento, necessidade, valida_ate, concedida_em, concedida_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [linha.id, usuarioId, entrada.grauMaximo, entrada.fundamento, entrada.necessidade, entrada.validaAte, agora, sessao.usuario.id],
      );
      await auditar(tx, request, {
        acao: 'sigilo.credenciar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Credenciou ${usuario.nome} no processo até o grau ${ROTULO_GRAU[entrada.grauMaximo]} (${entrada.fundamento === 'tcms' ? 'termo de compromisso de manutenção de sigilo' : 'credencial de segurança'})`,
        dados: {
          numeroSei: linha.numero_sei,
          usuarioId,
          grauMaximo: entrada.grauMaximo,
          fundamento: entrada.fundamento,
          validaAte: entrada.validaAte,
          substituiu: ativa?.id ?? null,
          hashNecessidade: sha256Hex(entrada.necessidade),
        },
      });
    });
    return montarSigilo(request, await processoNoEscopo(request));
  });

  app.post('/processos/:id/sigilo/credenciais/:credencialId/revogar', { preHandler: exigir('sigilo:credenciar') }, async (request): Promise<SigiloProcesso> => {
    const { motivo } = esquemaMotivo(10, 500).parse(request.body);
    const credencialId = idDaRota(request.params, 'credencialId');
    await ctx.banco.transacao(async (tx) => {
      const linha = await processoNoEscopo(request, tx);
      const [credencial] = await tx.consultar<{ usuario_id: string; nome: string }>(
        `SELECT c.usuario_id, u.nome FROM sigilo_credenciais c JOIN usuarios u ON u.id = c.usuario_id
          WHERE c.id = $1 AND c.processo_id = $2 AND c.revogada_em IS NULL FOR UPDATE OF c`,
        [credencialId, linha.id],
      );
      if (!credencial) throw naoEncontrado('Credencial ativa não encontrada neste processo.');
      await tx.executar('UPDATE sigilo_credenciais SET revogada_em = $2, revogada_por = $3, motivo_revogacao = $4 WHERE id = $1', [
        credencialId,
        ctx.relogio().toISOString(),
        sessaoDe(request).usuario.id,
        motivo,
      ]);
      await auditar(tx, request, {
        acao: 'sigilo.descredenciar',
        recurso: 'processo',
        recursoId: linha.id,
        resumo: `Revogou a credencial de ${credencial.nome} no processo`,
        dados: { numeroSei: linha.numero_sei, credencialId, usuarioId: credencial.usuario_id, motivo },
      });
    });
    return montarSigilo(request, await processoNoEscopo(request));
  });

  // ───────── registro de acessos (RF-33) ─────────

  app.get('/processos/:id/sigilo/acessos', { preHandler: exigir('sigilo:ler') }, async (request): Promise<Pagina<AcessoSigiloRegistrado>> => {
    const f = z.object({ ...camposPaginacao }).parse(request.query);
    const linha = await processoNoEscopo(request);
    const sessao = sessaoDe(request);
    // Quem classifica, credencia ou é órgão de controle vê todos os acessos; os demais, só os próprios.
    const todos = (['sigilo:classificar', 'sigilo:credenciar', 'sigilo:controle'] as const).some((p) => sessao.permissoes.has(p));
    const parametros = [linha.id, todos ? null : sessao.usuario.id] as const;
    const linhas = await ctx.banco.consultar<{
      id: string;
      ocorrido_em: string;
      usuario_id: string;
      usuario_nome: string;
      alvo: AlvoSigilo;
      titulo: string;
      operacao: AcessoSigiloRegistrado['operacao'];
      permitido: boolean;
      base: AcessoSigiloRegistrado['base'];
      motivo: string | null;
    }>(
      `SELECT a.id, a.ocorrido_em, a.usuario_id, u.nome AS usuario_nome, a.alvo, a.titulo, a.operacao, a.permitido, a.base, a.motivo
         FROM sigilo_acessos a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.processo_id = $1 AND ($2::uuid IS NULL OR a.usuario_id = $2)
        ORDER BY a.ocorrido_em DESC, a.id
        LIMIT $3 OFFSET $4`,
      [...parametros, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina)],
    );
    const [contagem] = await ctx.banco.consultar<{ total: number }>(
      'SELECT COUNT(*)::integer AS total FROM sigilo_acessos WHERE processo_id = $1 AND ($2::uuid IS NULL OR usuario_id = $2)',
      [...parametros],
    );
    return pagina(
      linhas.map((l) => ({
        id: l.id,
        ocorridoEm: l.ocorrido_em,
        usuario: { id: l.usuario_id, nome: l.usuario_nome },
        alvo: l.alvo,
        titulo: l.titulo,
        operacao: l.operacao,
        permitido: l.permitido,
        base: l.base,
        motivo: l.motivo,
      })),
      contagem?.total ?? 0,
      f.pagina,
      f.tamanhoPagina,
    );
  });

  // ───────── PDF marcado de documento classificado ─────────

  app.post('/processos/:id/sigilo/documentos/:tipo/pdf', { preHandler: exigir('sigilo:ler') }, async (request, reply) => {
    const { tipo } = z.object({ id: uuid, tipo: z.enum(TIPOS_DOCUMENTO) }).parse(request.params);
    const { motivo } = esquemaMotivo(10, 300).parse(request.body);
    const linha = await processoNoEscopo(request);
    const [documento] = await ctx.banco.consultar<{ versao: number; conteudo: string; situacao: string }>(
      `SELECT versao, conteudo, situacao FROM documentos_gerados WHERE processo_id = $1 AND tipo = $2
        ORDER BY (situacao = 'aprovado') DESC, versao DESC LIMIT 1`,
      [linha.id, tipo],
    );
    if (!documento) throw naoEncontrado('Documento não encontrado neste processo.');
    const contexto = await carregarContextoAcesso(ctx.banco, linha.id, sessaoDe(request), ctx.hoje());
    const { decisao, classificacao } = decidirPara(contexto, { alvo: 'documento', documentoTipo: tipo });
    if (classificacao === null) throw regraNegocio('O documento não está classificado: o PDF marcado é só para documentos sigilosos. Consulte-o na jornada.');
    const titulo = `${ROTULOS_DOCUMENTO[tipo]} do processo ${linha.numero_sei}`;
    await registrarSeparado(request, {
      processoId: linha.id,
      numeroSei: linha.numero_sei,
      classificacaoId: classificacao.id,
      alvo: 'documento',
      titulo,
      operacao: 'pdf',
      permitido: decisao.permitido,
      base: decisao.base,
      motivo,
    });
    if (!decisao.permitido) throw new ErroApi(403, 'SEM_PERMISSAO', decisao.mensagem);
    const marcacao = marcacaoSigilo({ tipo: classificacao.tipo, grau: classificacao.grau, prazoFim: classificacao.prazo_fim, eventoFim: classificacao.evento_fim, prazoLimite: classificacao.prazo_limite });
    const pdf = gerarPdfTexto({
      titulo: `${ROTULOS_DOCUMENTO[tipo]} — processo ${linha.numero_sei}`,
      rodape: `${ROTULOS_DOCUMENTO[tipo]} — ${linha.numero_sei} (versão ${documento.versao}) — ${classificacao.codigo_indexacao}`,
      conteudo: tarjarDadosPessoais(documento.conteudo),
      marcacao,
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', disposicaoAnexo(`${tipo.replace('_', '-')}-${linha.numero_sei.replace(/[^0-9]/g, '')}-sigiloso.pdf`, 'pdf'))
      .header('x-agora-sha256', sha256Hex(pdf))
      .header('cache-control', 'no-store')
      .send(pdf);
  });

  // ───────── cofre: envio direto e download ─────────

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

    escopo.post('/processos/:id/sigilo/anexos', { preHandler: exigir('sigilo:classificar') }, async (request, reply): Promise<SigiloProcesso> => {
      const entrada = esquemaEnvioCofre.parse(request.query);
      if (armazenamento === null || chave === null) {
        throw new ErroApi(503, 'INDISPONIVEL', armazenamento === null ? 'O armazenamento de documentos não está configurado (AGORA_ARQUIVOS_DIR).' : 'O cofre não está configurado: defina AGORA_COFRE_CHAVE.');
      }
      const conteudo = request.body;
      if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw validacao('Envie o conteúdo do arquivo no corpo da requisição (application/octet-stream).');
      const formato = detectarFormato(conteudo);
      if (formato === null) throw regraNegocio('Formato não aceito: envie PDF, PNG ou JPEG. O tipo é conferido pelo conteúdo do arquivo.');
      if (formato === 'pdf') {
        const inspecao = inspecionarPdf(conteudo);
        if (inspecao.criptografado) throw regraNegocio('PDF protegido por senha ou criptografado: envie uma versão sem proteção (o cofre cifra o arquivo).');
        if (inspecao.paginas === 0) throw regraNegocio('PDF inválido ou corrompido: nenhuma página foi encontrada.');
        if (inspecao.ativos.length > 0) throw regraNegocio(`O PDF contém conteúdo ativo ou arquivo embutido (${inspecao.ativos.join(', ')}) e foi recusado por segurança.`);
      }
      const autoridade =
        entrada.autoridadeNome && entrada.autoridadeCargo && entrada.autoridadeNivel
          ? { nome: entrada.autoridadeNome, cargo: entrada.autoridadeCargo, nivel: entrada.autoridadeNivel as NivelAutoridadeClassificadora, atoDelegacao: entrada.atoDelegacao ?? null }
          : null;
      const previa = await processoNoEscopo(request);
      const hoje = ctx.hoje();
      const validada = validarClassificacaoSigilo(
        {
          tipo: entrada.tipoSigilo,
          grau: entrada.grau ?? null,
          hipotese: (entrada.hipotese ?? null) as HipoteseSigiloLai | null,
          razoes: entrada.razoes,
          dataProducao: entrada.dataProducao,
          prazoFim: entrada.prazoFim ?? null,
          eventoFim: entrada.eventoFim ?? null,
          autoridade,
          orcamentoSigilosoNoProcesso: previa.cesta.orcamentoSigiloso,
          criterioJulgamento: previa.edital.criterioJulgamento ?? null,
        },
        hoje,
      );
      const sha256 = sha256Hex(conteudo);
      const [repetido] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM processos_arquivos WHERE processo_id = $1 AND sha256 = $2', [previa.id, sha256]);
      if (repetido) throw conflito('Este arquivo já está no processo (mesmo SHA-256). Para protegê-lo, classifique o anexo existente.');
      let antivirus: 'nao_verificado' | 'limpo' = 'nao_verificado';
      if (ctx.config.antivirusUrl !== null) {
        let resultado;
        try {
          resultado = await verificarAntivirus(ctx.config.antivirusUrl, conteudo);
        } catch (erro) {
          if (erro instanceof ErroIntegracao) throw new ErroApi(503, 'INDISPONIVEL', 'O antivírus do órgão não respondeu. Por segurança, o anexo não foi recebido.');
          throw erro;
        }
        if (!resultado.limpo) throw regraNegocio('O antivírus do órgão apontou ameaça no arquivo e ele foi recusado.');
        antivirus = 'limpo';
      }
      const arquivoId = randomUUID();
      const pacote = cifrar(chave, conteudo, aadAnexo(arquivoId, sha256));
      const sha256Cifrado = sha256Hex(pacote);
      await armazenamento.gravar(sha256Cifrado, pacote);
      const nomeOriginal = sanitizarNomeArquivo(typeof request.headers[CABECALHO_NOME] === 'string' ? request.headers[CABECALHO_NOME] : undefined);
      const sessao = sessaoDe(request);
      await ctx.banco.transacao(async (tx) => {
        const linha = await processoNoEscopo(request, tx);
        const agora = ctx.relogio().toISOString();
        await tx.executar(
          `INSERT INTO processos_arquivos (id, processo_id, categoria, tipo, fornecedor_id, titulo, nome_original, formato, tamanho_bytes, sha256,
                                           contem_dado_pessoal, antivirus, exercicio, data_constituicao, enviado_por, enviado_em)
           VALUES ($1, $2, 'processo', 'documento_processo', NULL, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, $10, $11)`,
          [arquivoId, linha.id, entrada.titulo, nomeOriginal, formato, conteudo.length, sha256, entrada.contemDadoPessoal, antivirus, sessao.usuario.id, agora],
        );
        await tx.executar(
          `INSERT INTO sigilo_cofre (arquivo_id, sha256_cifrado, chave_id, tamanho_cifrado, selado_em, selado_por) VALUES ($1, $2, $3, $4, $5, $6)`,
          [arquivoId, sha256Cifrado, chave.id, pacote.length, agora, sessao.usuario.id],
        );
        const id = randomUUID();
        const codigo = codigoIndexacaoSigilo({ numeroSei: linha.numero_sei, tipo: validada.tipo, grau: validada.grau, classificadaEm: hoje, prazoFim: validada.prazoFim });
        await tx.executar(
          `INSERT INTO sigilo_classificacoes (id, processo_id, alvo, arquivo_id, tipo, grau, hipotese, razoes, data_producao, prazo_fim, evento_fim,
                                              prazo_limite, autoridade, fundamento, codigo_indexacao, situacao, versao, classificada_em, classificada_por)
           VALUES ($1, $2, 'anexo', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, 'vigente', 1, $15, $16)`,
          [
            id,
            linha.id,
            arquivoId,
            validada.tipo,
            validada.grau,
            validada.hipotese,
            validada.razoes,
            validada.dataProducao,
            validada.prazoFim,
            validada.eventoFim,
            validada.prazoLimite,
            validada.autoridade === null ? null : JSON.stringify(validada.autoridade),
            validada.fundamento,
            codigo,
            agora,
            sessao.usuario.id,
          ],
        );
        await garantirCredencialDoClassificador(tx, request, linha.id, linha.numero_sei, validada.grau ?? 'reservada');
        await auditar(tx, request, {
          acao: 'sigilo.cofre.enviar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Enviou anexo sigiloso ao cofre (${formato.toUpperCase()}, cifrado com AES-256-GCM) e o classificou (${codigo})`,
          dados: {
            numeroSei: linha.numero_sei,
            arquivoId,
            classificacaoId: id,
            formato,
            tamanhoBytes: conteudo.length,
            sha256,
            sha256Cifrado,
            chaveId: chave.id,
            antivirus,
            tipo: validada.tipo,
            grau: validada.grau,
            codigoIndexacao: codigo,
            hashRazoes: sha256Hex(validada.razoes),
          },
        });
      });
      reply.status(201);
      return montarSigilo(request, await processoNoEscopo(request));
    });
  });

  app.post('/processos/:id/sigilo/anexos/:arquivoId/baixar', { preHandler: exigir('sigilo:ler') }, async (request, reply) => {
    const { motivo } = esquemaMotivo(10, 300).parse(request.body);
    const linha = await processoNoEscopo(request);
    const arquivoId = idDaRota(request.params, 'arquivoId');
    const [arquivo] = await ctx.banco.consultar<{ id: string; titulo: string; nome_original: string; formato: 'pdf' | 'png' | 'jpeg'; sha256: string; sha256_cifrado: string | null; chave_id: string | null }>(
      `SELECT a.id, a.titulo, a.nome_original, a.formato, a.sha256, c.sha256_cifrado, c.chave_id
         FROM processos_arquivos a LEFT JOIN sigilo_cofre c ON c.arquivo_id = a.id
        WHERE a.id = $1 AND a.processo_id = $2`,
      [arquivoId, linha.id],
    );
    if (!arquivo) throw naoEncontrado('Anexo não encontrado neste processo.');
    if (arquivo.sha256_cifrado === null || arquivo.chave_id === null) throw regraNegocio('Este anexo não está no cofre: baixe-o na página de documentos do processo.');
    const contexto = await carregarContextoAcesso(ctx.banco, linha.id, sessaoDe(request), ctx.hoje());
    const { decisao, classificacao } = decidirPara(contexto, { alvo: 'anexo', arquivoId: arquivo.id });
    await registrarSeparado(request, {
      processoId: linha.id,
      numeroSei: linha.numero_sei,
      classificacaoId: classificacao?.id ?? null,
      alvo: 'anexo',
      titulo: arquivo.titulo,
      operacao: 'download',
      permitido: decisao.permitido,
      base: decisao.base,
      motivo,
    });
    if (!decisao.permitido) throw new ErroApi(403, 'SEM_PERMISSAO', decisao.mensagem);
    if (armazenamento === null || chave === null) throw new ErroApi(503, 'INDISPONIVEL', 'O cofre não está disponível neste ambiente (AGORA_ARQUIVOS_DIR e AGORA_COFRE_CHAVE).');
    if (chave.id !== arquivo.chave_id) throw new ErroApi(500, 'INTERNO', 'O anexo foi cifrado com outra chave do cofre. Restaure a chave anterior (AGORA_COFRE_CHAVE) para abri-lo.');
    let conteudo: Buffer;
    try {
      conteudo = decifrar(chave, await armazenamento.ler(arquivo.sha256_cifrado), aadAnexo(arquivo.id, arquivo.sha256));
    } catch (erro) {
      if (erro instanceof ErroArmazenamento || erro instanceof ErroCofre) {
        request.log.error({ err: erro, arquivoId: arquivo.id }, 'anexo do cofre indisponível ou adulterado');
        throw new ErroApi(500, 'INTERNO', 'O anexo do cofre não está disponível ou não confere. Informe o código ao suporte.');
      }
      throw erro;
    }
    if (sha256Hex(conteudo) !== arquivo.sha256) throw new ErroApi(500, 'INTERNO', 'O anexo decifrado não confere com o SHA-256 registrado.');
    return reply
      .header('content-type', TIPO_CONTEUDO[arquivo.formato])
      .header('content-disposition', disposicaoAnexo(arquivo.nome_original, arquivo.formato))
      .header('x-agora-sha256', arquivo.sha256)
      .header('cache-control', 'no-store')
      .send(conteudo);
  });

  // ───────── carimbo de tempo da trilha (RNF-09) ─────────

  app.get('/auditoria/ancoragens', { preHandler: exigir('auditoria:ler') }, async () => situacaoAncoragens(ctx));

  app.get('/auditoria/ancoragens/verificacao', { preHandler: exigir('auditoria:ler') }, async () => verificarAncoragens(ctx));

  app.post('/auditoria/ancoragens', { preHandler: exigir('auditoria:ancorar') }, async (request, reply) => {
    try {
      const ancoragem = await ancorarTrilha(ctx, { origem: 'manual', usuarioId: sessaoDe(request).usuario.id, ipHash: request.ipHash || null });
      if (!ancoragem) throw regraNegocio('A trilha ainda não tem eventos para ancorar.');
      reply.status(201);
      return ancoragem;
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw new ErroApi(503, 'INDISPONIVEL', erro.message);
      throw erro;
    }
  });

  const agendamento = agendarAncoragem(ctx, (erro) => app.log.error({ err: erro }, 'falha na ancoragem periódica da trilha'));
  app.addHook('onClose', async () => {
    agendamento.parar();
  });
}
