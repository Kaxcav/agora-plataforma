import { formatarData, formatarMoeda, situacaoRegistroCeisCnep, validarCertidao } from '@agora/dominio';
import type {
  Aditivo,
  CertidaoRegistrada,
  ChecklistRegularidade,
  RegistroSancaoCeisCnep,
  RespostaProrrogacao,
  VerificacaoRegularidade,
} from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota } from '../../http/validacao.ts';
import {
  carregarCertidoes,
  escopoDaVerificacao,
  fornecedorExibivel,
  mapearCertidao,
  montarChecklist,
  obterFornecedorRegularidade,
  obterVerificacao,
} from './repositorio.ts';
import { abrirPendenciaRegularidade, exigirRegularidade, verificarRegularidade } from './servico.ts';
import { listarRegistrosCeisCnep } from './ceis-cnep.ts';
import { comTrava } from '../../compartilhado/travas.ts';

const MOMENTOS = ['assinatura', 'prorrogacao', 'atesto', 'pagamento'] as const;
const esquemaMomento = z.object({ momento: z.enum(MOMENTOS).default('assinatura') });
const textoOpcional = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null || v === '' ? null : v));

const esquemaCertidao = z.object({
  tipo: z.enum(['fiscal_federal', 'fgts', 'trabalhista']),
  numero: z.string().trim().min(3).max(80),
  emissor: z.string().trim().min(3).max(200),
  emitidaEm: dataIso,
  validaAte: dataIso,
  resultado: z.enum(['negativa', 'positiva_com_efeitos_de_negativa', 'positiva']),
  observacao: textoOpcional,
  conferida: z.literal(true, { error: 'Confirme que conferiu a certidão no sítio do emissor.' }),
});

const esquemaProrrogacao = z.object({
  novaVigenciaFim: dataIso,
  valor: centavos.default(0),
  justificativa: z.string().trim().min(20).max(5000),
});

const esquemaEnvio = z.object({
  cadastro: z.enum(['CEIS', 'CNEP']),
  protocolo: z.string().trim().min(3).max(120),
  enviadoEm: dataIso,
  observacao: textoOpcional,
});

const esquemaFiltroRegistros = z.object({ situacao: z.enum(['pendentes', 'registradas', 'todas']).default('todas') });

const ROTULO_MOMENTO: Record<(typeof MOMENTOS)[number], string> = {
  assinatura: 'Assinatura do contrato',
  prorrogacao: 'Prorrogação da vigência',
  atesto: 'Atesto da nota fiscal',
  pagamento: 'Pagamento',
};

const ROTULO_SITUACAO_ITEM: Record<ChecklistRegularidade['itens'][number]['situacao'], string> = {
  conforme: 'Conforme',
  atencao: 'Atenção',
  pendente: 'Pendente',
  impeditivo: 'Impeditivo',
};

function formatarInstante(instante: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(instante));
}

/** Texto (Markdown simples) do comprovante da verificação, para juntar ao processo (art. 91, § 4º). */
function textoComprovante(v: VerificacaoRegularidade): string {
  const linhas = [
    `# Verificação de regularidade — ${ROTULO_MOMENTO[v.momento]}`,
    '',
    `**Fornecedor:** ${v.fornecedor.razaoSocial} (${v.fornecedor.documento})`,
    `**Resultado:** ${v.regular ? 'regular' : v.bloqueia ? 'irregular — ato bloqueado' : 'irregular — providências indicadas'}`,
    `**Verificado em:** ${formatarInstante(v.avaliadoEm)}${v.verificadoPor ? ` por ${v.verificadoPor.nome}` : ''}`,
    `**Fundamento:** ${v.fundamento}`,
    '',
    '## Consulta ao CEIS e ao CNEP',
    v.consulta
      ? `Fonte: ${v.consulta.fonte}. Consulta de ${formatarInstante(v.consulta.consultadoEm)} (modo ${v.consulta.modo}), ${v.consulta.quantidade} registro(s), hash SHA-256 ${v.consulta.hashConteudo}.`
      : `Consulta indisponível${v.falhaConsulta ? `: ${v.falhaConsulta}` : ''}.`,
    '',
    '## Itens verificados',
  ];
  for (const item of v.itens) {
    linhas.push(`- **${item.rotulo}** — ${ROTULO_SITUACAO_ITEM[item.situacao]}. ${item.detalhes.join(' ')} Fonte: ${item.fonte}.`);
  }
  if (v.providencias.length > 0) {
    linhas.push('', '## Providências');
    for (const p of v.providencias) linhas.push(`- ${p}`);
  }
  linhas.push('', `Verificação nº ${v.id}. ${v.aviso}`);
  return linhas.join('\n');
}

export async function rotasRegularidade(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  async function fornecedorDaRota(request: FastifyRequest) {
    const fornecedor = await obterFornecedorRegularidade(ctx.banco, idDaRota(request.params));
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    return fornecedor;
  }

  /** Contrato no escopo de UASG do usuário (fora do escopo → 404). */
  async function contratoDaRota(request: FastifyRequest) {
    const id = idDaRota(request.params);
    const [contrato] = await ctx.banco.consultar<{ id: string; numero: string; uasg: string; fornecedor_id: string; vigencia_fim: string }>(
      `SELECT id, numero, uasg, fornecedor_id, vigencia_fim FROM contratos
        WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  /** Pagamento no escopo de UASG do usuário, com o contrato e o fornecedor. */
  async function pagamentoDaRota(request: FastifyRequest) {
    const id = idDaRota(request.params);
    const [pagamento] = await ctx.banco.consultar<{ id: string; situacao: string; contrato_id: string; fornecedor_id: string; nota_fiscal: string }>(
      `SELECT p.id, p.situacao, p.contrato_id, c.fornecedor_id, p.nota_fiscal
         FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id
        WHERE p.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!pagamento) throw naoEncontrado('Pagamento não encontrado.');
    return pagamento;
  }

  // ───────── fornecedor: checklist, consulta e certidões (RF-20) ─────────

  /** Checklist com a última consulta em cache (sem chamada externa). */
  app.get('/fornecedores/:id/regularidade', { preHandler: exigir('fornecedores:ler') }, async (request): Promise<ChecklistRegularidade> => {
    const { momento } = esquemaMomento.parse(request.query);
    const fornecedor = await fornecedorDaRota(request);
    const { checklist } = await montarChecklist(ctx.banco, fornecedor, momento, ctx.hoje(), ctx.relogio(), { consultaObrigatoria: false });
    return checklist;
  });

  /** Nova consulta ao CEIS e ao CNEP, a pedido do agente, registrada como verificação. */
  app.post('/fornecedores/:id/regularidade/consultar', { preHandler: exigir('regularidade:consultar') }, async (request): Promise<VerificacaoRegularidade> => {
    const { momento } = esquemaMomento.parse(request.body ?? {});
    const fornecedor = await fornecedorDaRota(request);
    return verificarRegularidade(ctx, request, {
      fornecedorId: fornecedor.id,
      momento,
      instrumento: { tipo: 'fornecedor', id: fornecedor.id },
      forcarConsulta: true,
    });
  });

  app.get('/fornecedores/:id/certidoes', { preHandler: exigir('fornecedores:ler') }, async (request): Promise<CertidaoRegistrada[]> => {
    const fornecedor = await fornecedorDaRota(request);
    const hoje = ctx.hoje();
    return (await carregarCertidoes(ctx.banco, fornecedor.id)).map((c) => mapearCertidao(c, hoje));
  });

  /** Registro da certidão conferida pelo agente (não há API aberta das certidões). */
  app.post('/fornecedores/:id/certidoes', { preHandler: exigir('certidoes:registrar') }, async (request, reply): Promise<CertidaoRegistrada> => {
    const entrada = esquemaCertidao.parse(request.body);
    const fornecedor = await fornecedorDaRota(request);
    const hoje = ctx.hoje();
    const definicao = validarCertidao(entrada, hoje);
    const sessao = sessaoDe(request);
    const id = await ctx.banco.transacao(async (tx) => {
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO certidoes_regularidade (fornecedor_id, tipo, numero, emissor, emitida_em, valida_ate, resultado, observacao, conferida_por, conferida_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [fornecedor.id, entrada.tipo, entrada.numero, entrada.emissor, entrada.emitidaEm, entrada.validaAte, entrada.resultado, entrada.observacao, sessao.usuario.id, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Certidão não registrada');
      await auditar(tx, request, {
        acao: 'certidao.registrar',
        recurso: 'fornecedor',
        recursoId: fornecedor.id,
        resumo: `Registrou a ${definicao.sigla} nº ${entrada.numero} de ${fornecedorExibivel(fornecedor).razaoSocial}, válida até ${formatarData(entrada.validaAte)}`,
        dados: {
          certidaoId: criada.id,
          fornecedorId: fornecedor.id,
          tipo: entrada.tipo,
          numero: entrada.numero,
          emissor: entrada.emissor,
          emitidaEm: entrada.emitidaEm,
          validaAte: entrada.validaAte,
          resultado: entrada.resultado,
          conferida: true,
        },
      });
      return criada.id;
    });
    const certidao = (await carregarCertidoes(ctx.banco, fornecedor.id)).find((c) => c.id === id);
    if (!certidao) throw naoEncontrado();
    reply.status(201);
    return mapearCertidao(certidao, hoje);
  });

  // ───────── contrato: checklist e prorrogação (RN-09) ─────────

  app.get('/contratos/:id/regularidade', { preHandler: exigir('contratos:ler') }, async (request): Promise<ChecklistRegularidade> => {
    const { momento } = esquemaMomento.parse({ momento: 'prorrogacao', ...(request.query as object) });
    const contrato = await contratoDaRota(request);
    const fornecedor = await obterFornecedorRegularidade(ctx.banco, contrato.fornecedor_id);
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    const { checklist } = await montarChecklist(ctx.banco, fornecedor, momento, ctx.hoje(), ctx.relogio(), { consultaObrigatoria: false });
    return checklist;
  });

  /**
   * Prorrogação da vigência (termo aditivo de prazo): antes de registrar, o checklist do art. 91, § 4º, com nova
   * consulta ao CEIS/CNEP. Restrição → 422 com os motivos (RN-09); a verificação fica registrada mesmo assim.
   */
  app.post('/contratos/:id/prorrogacoes', { preHandler: exigir('contratos:editar') }, async (request, reply): Promise<RespostaProrrogacao> => {
    const entrada = esquemaProrrogacao.parse(request.body);
    const contrato = await contratoDaRota(request);
    if (entrada.novaVigenciaFim <= contrato.vigencia_fim) {
      throw regraNegocio(`A nova data de fim da vigência deve ser posterior à atual (${formatarData(contrato.vigencia_fim)}).`, [
        { campo: 'novaVigenciaFim', mensagem: 'Informe uma data posterior ao fim da vigência atual.' },
      ]);
    }
    const verificacao = await verificarRegularidade(ctx, request, {
      fornecedorId: contrato.fornecedor_id,
      momento: 'prorrogacao',
      instrumento: { tipo: 'contrato', id: contrato.id },
    });
    await comTrava({ trava: 'prorrogacao', recurso: 'contrato', recursoId: contrato.id, uasg: contrato.uasg, identificador: contrato.numero }, () =>
      exigirRegularidade(verificacao, 'O contratado não atende à verificação prévia à prorrogação (RN-09, art. 91, § 4º).'),
    );

    const hoje = ctx.hoje();
    const aditivo = await ctx.banco.transacao(async (tx) => {
      const [atual] = await tx.consultar<{ id: string; numero: string; vigencia_fim: string }>(
        'SELECT id, numero, vigencia_fim FROM contratos WHERE id = $1 FOR UPDATE',
        [contrato.id],
      );
      if (!atual) throw naoEncontrado('Contrato não encontrado.');
      if (entrada.novaVigenciaFim <= atual.vigencia_fim) throw conflito('A vigência do contrato mudou durante a operação. Recarregue e tente de novo.');
      const [contagem] = await tx.consultar<{ total: number }>('SELECT COUNT(*)::integer AS total FROM aditivos WHERE contrato_id = $1', [atual.id]);
      const numero = `${(contagem?.total ?? 0) + 1}º Termo Aditivo`;
      const [criado] = await tx.consultar<{ id: string }>(
        `INSERT INTO aditivos (contrato_id, numero, tipo, valor, nova_vigencia_fim, assinado_em, justificativa)
         VALUES ($1, $2, 'prorrogacao', $3, $4, $5, $6) RETURNING id`,
        [atual.id, numero, entrada.valor, entrada.novaVigenciaFim, hoje, entrada.justificativa],
      );
      if (!criado) throw new Error('Aditivo não registrado');
      await tx.executar(
        `UPDATE contratos
            SET vigencia_fim = $2,
                campos_editados = CASE WHEN 'vigencia_fim' = ANY(campos_editados) THEN campos_editados ELSE array_append(campos_editados, 'vigencia_fim') END,
                atualizado_em = $3
          WHERE id = $1`,
        [atual.id, entrada.novaVigenciaFim, ctx.relogio().toISOString()],
      );
      await auditar(tx, request, {
        acao: 'contrato.prorrogar',
        recurso: 'contrato',
        recursoId: atual.id,
        resumo: `Registrou o ${numero} (prorrogação) do contrato ${atual.numero}: vigência até ${formatarData(entrada.novaVigenciaFim)}${entrada.valor > 0 ? `, ${formatarMoeda(entrada.valor)}` : ''}`,
        dados: {
          aditivoId: criado.id,
          vigenciaFim: { de: atual.vigencia_fim, para: entrada.novaVigenciaFim },
          valor: entrada.valor,
          verificacaoId: verificacao.id,
          consultaCeisCnep: verificacao.consulta ? { fonte: verificacao.consulta.fonte, consultadoEm: verificacao.consulta.consultadoEm } : null,
        },
      });
      return { id: criado.id, numero };
    });
    reply.status(201);
    const resultado: Aditivo = {
      id: aditivo.id,
      numero: aditivo.numero,
      tipo: 'prorrogacao',
      valor: entrada.valor,
      novaVigenciaFim: entrada.novaVigenciaFim,
      assinadoEm: hoje,
      justificativa: entrada.justificativa,
    };
    return { aditivo: resultado, verificacao };
  });

  // ───────── pagamento: recheque antes do pagamento (RN-23) ─────────

  app.get('/pagamentos/:id/regularidade', { preHandler: exigir('pagamentos:ler') }, async (request): Promise<ChecklistRegularidade> => {
    const pagamento = await pagamentoDaRota(request);
    const fornecedor = await obterFornecedorRegularidade(ctx.banco, pagamento.fornecedor_id);
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    const momento = pagamento.situacao === 'previsto' ? 'atesto' : 'pagamento';
    const { checklist } = await montarChecklist(ctx.banco, fornecedor, momento, ctx.hoje(), ctx.relogio(), { consultaObrigatoria: false });
    return checklist;
  });

  app.post('/pagamentos/:id/regularidade', { preHandler: exigir('regularidade:consultar') }, async (request): Promise<VerificacaoRegularidade> => {
    const pagamento = await pagamentoDaRota(request);
    if (pagamento.situacao === 'pago') throw conflito('O pagamento já foi feito: a verificação prévia não se aplica.');
    const verificacao = await verificarRegularidade(ctx, request, {
      fornecedorId: pagamento.fornecedor_id,
      momento: 'pagamento',
      instrumento: { tipo: 'pagamento', id: pagamento.id },
      contratoId: pagamento.contrato_id,
    });
    if (!verificacao.regular) {
      await ctx.banco.transacao(async (tx) => {
        const pendenciaId = await abrirPendenciaRegularidade(tx, ctx, { contratoId: pagamento.contrato_id, notaFiscal: pagamento.nota_fiscal, momento: 'pagamento', verificacao });
        if (pendenciaId) {
          await auditar(tx, request, {
            acao: 'pendencia.criar',
            recurso: 'pendencia',
            recursoId: pendenciaId,
            resumo: `Abriu pendência para notificar o contratado sobre a regularidade antes do pagamento da nota fiscal ${pagamento.nota_fiscal}`,
            dados: { instrumentoTipo: 'contrato', instrumentoId: pagamento.contrato_id, verificacaoId: verificacao.id, motivos: verificacao.motivos },
          });
        }
      });
    }
    return verificacao;
  });

  // ───────── comprovante da verificação (para juntar ao processo) ─────────

  app.get('/regularidade/verificacoes/:id/comprovante.pdf', { preHandler: exigir('fornecedores:ler') }, async (request, reply) => {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const alvo = await escopoDaVerificacao(ctx.banco, id);
    if (!alvo || (escopo !== null && alvo.uasg !== null && !escopo.includes(alvo.uasg))) throw naoEncontrado('Verificação não encontrada.');
    const verificacao = await obterVerificacao(ctx.banco, id);
    if (!verificacao) throw naoEncontrado('Verificação não encontrada.');
    const titulo = `Verificação de regularidade — ${ROTULO_MOMENTO[verificacao.momento]}`;
    const pdf = gerarPdfTexto({ titulo, rodape: `${titulo} — Lei 14.133/2021, art. 91, § 4º`, conteudo: textoComprovante(verificacao) });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="verificacao-regularidade-${verificacao.id.slice(0, 8)}.pdf"`)
      .send(pdf);
  });

  // ───────── registro das sanções aplicadas no CEIS/CNEP (RN-24, art. 161) ─────────

  app.get('/sancoes/registro-ceis-cnep', { preHandler: exigir('sancoes:ler') }, async (request): Promise<RegistroSancaoCeisCnep[]> => {
    const { situacao } = esquemaFiltroRegistros.parse(request.query);
    const todos = await listarRegistrosCeisCnep(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)) }, ctx.hoje(), await opcoesCalendario(ctx.banco));
    if (situacao === 'pendentes') return todos.filter((r) => r.envio === null && r.situacao.startsWith('pendente'));
    if (situacao === 'registradas') return todos.filter((r) => r.situacao.startsWith('registrada'));
    return todos;
  });

  /**
   * Registro do envio da sanção ao CEIS/CNEP: não há API pública de escrita nesses cadastros; o responsável informa o
   * cadastro, o protocolo e a data do envio feito no sistema da CGU, e a Ágora registra quem informou e quando.
   */
  app.post('/sancoes/:id/registro-ceis-cnep', { preHandler: exigir('sancoes:instruir') }, async (request): Promise<RegistroSancaoCeisCnep> => {
    const entrada = esquemaEnvio.parse(request.body);
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const hoje = ctx.hoje();
    const calendario = await opcoesCalendario(ctx.banco);
    await ctx.banco.transacao(async (tx) => {
      const [sancao] = await tx.consultar<{ id: string; situacao: string; aplicada_em: string | null; contrato_id: string | null; fornecedor_id: string }>(
        `SELECT s.id, s.situacao, s.aplicada_em, s.contrato_id, s.fornecedor_id
           FROM sancoes s LEFT JOIN contratos c ON c.id = s.contrato_id
          WHERE s.id = $1 AND ($2::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($2::text[]))
          FOR UPDATE OF s`,
        [id, escopo],
      );
      if (!sancao) throw naoEncontrado('Sanção não encontrada.');
      if (sancao.situacao !== 'aplicada' || sancao.aplicada_em === null) {
        throw regraNegocio('Só a sanção aplicada pela autoridade competente é informada ao CEIS/CNEP (art. 161).');
      }
      const [existente] = await tx.consultar<{ sancao_id: string }>('SELECT sancao_id FROM sancoes_envios_ceis_cnep WHERE sancao_id = $1', [id]);
      if (existente) throw conflito('O envio desta sanção ao CEIS/CNEP já foi registrado.');
      const situacao = situacaoRegistroCeisCnep({ aplicacao: sancao.aplicada_em, enviadoEm: entrada.enviadoEm, hoje }, calendario);
      await tx.executar(
        `INSERT INTO sancoes_envios_ceis_cnep (sancao_id, cadastro, protocolo, enviado_em, responsavel_id, registrado_em, observacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, entrada.cadastro, entrada.protocolo, entrada.enviadoEm, sessaoDe(request).usuario.id, ctx.relogio().toISOString(), entrada.observacao],
      );
      await tx.executar('UPDATE sancoes SET registrada_ceis_cnep = true, prazo_registro_ceis_cnep = COALESCE(prazo_registro_ceis_cnep, $2) WHERE id = $1', [
        id,
        situacao.vencimento,
      ]);
      await auditar(tx, request, {
        acao: 'sancao.registrar_ceis_cnep',
        recurso: 'sancao',
        recursoId: id,
        resumo: `Registrou o envio da sanção ao ${entrada.cadastro} (protocolo ${entrada.protocolo}, em ${formatarData(entrada.enviadoEm)}) — ${situacao.situacao === 'registrada_no_prazo' ? 'no prazo' : 'fora do prazo'} do art. 161`,
        dados: {
          fornecedorId: sancao.fornecedor_id,
          cadastro: entrada.cadastro,
          protocolo: entrada.protocolo,
          enviadoEm: entrada.enviadoEm,
          prazo: situacao.vencimento,
          situacao: situacao.situacao,
          ...(sancao.contrato_id ? { instrumentoTipo: 'contrato', instrumentoId: sancao.contrato_id } : {}),
        },
      });
    });
    const [registro] = (await listarRegistrosCeisCnep(ctx.banco, { escopo, sancaoId: id }, hoje, calendario));
    if (!registro) throw naoEncontrado();
    return registro;
  });
}
