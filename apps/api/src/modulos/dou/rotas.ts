/**
 * Publicações no DOU (RF-36): matérias no padrão da Seção 3, registro do envio pelo INCom, conferência da publicação
 * na consulta pública do DOU (pela fila, no servidor) e registro da publicação do aviso em jornal.
 * Aviso de licitação: leitura com `jornada:ler`, escrita com `jornada:publicar`. Extratos de contrato e de aditivo:
 * leitura com `contratos:ler`, escrita com `contratos:editar`. Sempre no escopo de UASG do usuário.
 */
import { montarMateriaDou, type TipoMateriaDou } from '@agora/dominio';
import type { CandidatoMateriaDou, MateriaDou, Pagina, Permissao, ResumoPublicacoesDou } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigirAlguma, exigirPermissaoNoHandler, sessaoDe } from '../../autorizacao/exigir.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { pedirTarefaRepetivel } from '../../fila/pedido-repetivel.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import type { Executor } from '../../banco/tipos.ts';
import type { SessaoAtiva } from '../../http/contexto.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, dataIso, deslocamento, idDaRota, pagina, uuid } from '../../http/validacao.ts';
import { contarMaterias, listarMaterias, mapearMateria, obterMateria, type LinhaMateria } from './repositorio.ts';
import { atoDaMateria, gravarMateria, registrarEnvioDou, registrarPublicacaoDou } from './servico.ts';

const TIPOS: readonly TipoMateriaDou[] = ['aviso_licitacao', 'extrato_contrato', 'extrato_aditivo'];
const tipoMateria = z.enum(['aviso_licitacao', 'extrato_contrato', 'extrato_aditivo']);
const ROTULO_TIPO: Record<TipoMateriaDou, string> = {
  aviso_licitacao: 'o aviso de licitação',
  extrato_contrato: 'o extrato de contrato',
  extrato_aditivo: 'o extrato de termo aditivo',
};

const leitura = (tipo: TipoMateriaDou): Permissao => (tipo === 'aviso_licitacao' ? 'jornada:ler' : 'contratos:ler');
const escrita = (tipo: TipoMateriaDou): Permissao => (tipo === 'aviso_licitacao' ? 'jornada:publicar' : 'contratos:editar');
const tiposVisiveis = (sessao: SessaoAtiva): TipoMateriaDou[] => TIPOS.filter((t) => sessao.permissoes.has(leitura(t)));

const esquemaLista = z.object({
  ...camposPaginacao,
  tipo: tipoMateria.optional(),
  situacao: z.enum(['rascunho', 'enviada', 'publicada']).optional(),
  processoId: uuid.optional(),
});
const esquemaNova = z.object({ tipo: tipoMateria, processoId: uuid.optional(), contratoId: uuid.optional(), aditivoId: uuid.optional() });
const esquemaEnvio = z.object({
  protocolo: z.string().trim().min(3, 'Informe o protocolo devolvido pelo INCom').max(80),
  enviadaEm: z.iso.datetime({ offset: true }).optional(),
});
const esquemaPublicacao = z.object({
  data: dataIso,
  edicao: z.string().trim().min(1, 'Informe o número da edição').max(20),
  pagina: z.string().trim().min(1, 'Informe a página').max(20),
  url: z
    .url()
    .refine((v) => /^https:\/\/(www\.)?in\.gov\.br\//.test(v), 'Use o endereço da matéria no portal da Imprensa Nacional (https://www.in.gov.br/...)')
    .nullable()
    .optional(),
});
const esquemaJornal = z.object({ nome: z.string().trim().min(3, 'Informe o nome do jornal').max(200), data: dataIso });

export async function rotasDou(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leituraDou = exigirAlguma(['jornada:ler', 'contratos:ler']);

  /** Matéria no escopo do usuário, com a permissão de leitura (e, se pedido, a de escrita) do tipo. */
  async function materiaAutorizada(request: FastifyRequest, executor: Executor = ctx.banco, paraEscrita = false, bloquear = false): Promise<LinhaMateria> {
    const sessao = sessaoDe(request);
    const linha = await obterMateria(executor, idDaRota(request.params), bloquear);
    const escopo = escopoUasgs(sessao);
    if (!linha || !sessao.permissoes.has(leitura(linha.tipo)) || (escopo !== null && !escopo.includes(linha.uasg))) throw naoEncontrado('Matéria não encontrada.');
    if (paraEscrita) exigirPermissaoNoHandler(request, escrita(linha.tipo));
    return linha;
  }

  async function responder(id: string): Promise<MateriaDou> {
    const linha = await obterMateria(ctx.banco, id);
    if (!linha) throw naoEncontrado('Matéria não encontrada.');
    return mapearMateria(linha);
  }

  app.get('/publicacoes-dou/resumo', { preHandler: leituraDou }, async (request): Promise<ResumoPublicacoesDou> => {
    const sessao = sessaoDe(request);
    const contagem = await contarMaterias(ctx.banco, tiposVisiveis(sessao), escopoUasgs(sessao));
    return { modo: ctx.config.integracoes, consulta: ctx.config.dou.consultaUrl, ...contagem };
  });

  app.get('/publicacoes-dou', { preHandler: leituraDou }, async (request): Promise<Pagina<MateriaDou>> => {
    const f = esquemaLista.parse(request.query);
    const sessao = sessaoDe(request);
    const { itens, total } = await listarMaterias(
      ctx.banco,
      { tipos: tiposVisiveis(sessao), escopo: escopoUasgs(sessao), tipo: f.tipo ?? null, situacao: f.situacao ?? null, processoId: f.processoId ?? null },
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  /** Atos que podem gerar matéria: editais publicados no PNCP, contratos e termos aditivos, com a matéria existente. */
  app.get('/publicacoes-dou/candidatos', { preHandler: leituraDou }, async (request): Promise<CandidatoMateriaDou[]> => {
    const { tipo } = z.object({ tipo: tipoMateria }).parse(request.query);
    const sessao = sessaoDe(request);
    exigirPermissaoNoHandler(request, leitura(tipo));
    const escopo = escopoUasgs(sessao);
    if (tipo === 'aviso_licitacao') {
      const linhas = await ctx.banco.consultar<{ id: string; numero_sei: string; titulo: string; uasg: string; materia_id: string | null }>(
        `SELECT p.id, p.numero_sei, p.titulo, p.uasg, m.id AS materia_id
           FROM processos p
           LEFT JOIN dou_materias m ON m.tipo = 'aviso_licitacao' AND m.processo_id = p.id
          WHERE p.publicacao->>'pncp' = 'publicado' AND ($1::text[] IS NULL OR p.uasg = ANY($1::text[]))
          ORDER BY p.publicacao->>'publicadoEm' DESC NULLS LAST, p.numero_sei LIMIT 100`,
        [escopo],
      );
      return linhas.map((l) => ({ tipo, processoId: l.id, contratoId: null, aditivoId: null, rotulo: `Processo ${l.numero_sei} — ${l.titulo}`, uasg: l.uasg, materiaId: l.materia_id }));
    }
    if (tipo === 'extrato_contrato') {
      const linhas = await ctx.banco.consultar<{ id: string; numero: string; objeto: string; uasg: string; materia_id: string | null }>(
        `SELECT c.id, c.numero, c.objeto, c.uasg, m.id AS materia_id
           FROM contratos c
           LEFT JOIN dou_materias m ON m.tipo = 'extrato_contrato' AND m.contrato_id = c.id
          WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
          ORDER BY c.assinatura_em DESC, c.numero LIMIT 100`,
        [escopo],
      );
      return linhas.map((l) => ({ tipo, processoId: null, contratoId: l.id, aditivoId: null, rotulo: `Contrato ${l.numero} — ${l.objeto}`, uasg: l.uasg, materiaId: l.materia_id }));
    }
    const linhas = await ctx.banco.consultar<{ id: string; numero: string; contrato_id: string; contrato_numero: string; uasg: string; materia_id: string | null }>(
      `SELECT a.id, a.numero, c.id AS contrato_id, c.numero AS contrato_numero, c.uasg, m.id AS materia_id
         FROM aditivos a
         JOIN contratos c ON c.id = a.contrato_id
         LEFT JOIN dou_materias m ON m.tipo = 'extrato_aditivo' AND m.aditivo_id = a.id
        WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        ORDER BY a.assinado_em DESC, c.numero, a.numero LIMIT 100`,
      [escopo],
    );
    return linhas.map((l) => ({
      tipo,
      processoId: null,
      contratoId: l.contrato_id,
      aditivoId: l.id,
      rotulo: `Termo aditivo ${l.numero} ao contrato ${l.contrato_numero}`,
      uasg: l.uasg,
      materiaId: l.materia_id,
    }));
  });

  app.get('/publicacoes-dou/:id', { preHandler: leituraDou }, async (request): Promise<MateriaDou> => mapearMateria(await materiaAutorizada(request)));

  app.post('/publicacoes-dou', { preHandler: exigirAlguma(['jornada:publicar', 'contratos:editar']) }, async (request): Promise<MateriaDou> => {
    const entrada = esquemaNova.parse(request.body);
    exigirPermissaoNoHandler(request, escrita(entrada.tipo));
    const sessao = sessaoDe(request);
    const id = await ctx.banco.transacao(async (tx) => {
      const ato = await atoDaMateria(tx, entrada, escopoUasgs(sessao));
      const montada = montarMateriaDou(ato.dados);
      const agora = ctx.relogio();
      const gravada = await gravarMateria(tx, ato, montada, { usuarioId: sessao.usuario.id, automatica: false }, agora);
      await auditar(tx, request, {
        acao: gravada.criada ? 'dou.materia.gerar' : 'dou.materia.refazer',
        recurso: 'dou_materia',
        recursoId: gravada.id,
        resumo: `${gravada.criada ? 'Gerou' : 'Refez'} ${ROTULO_TIPO[entrada.tipo]} para o DOU (${montada.identificacao}, processo ${ato.processoNumero}), a enviar pelo INCom`,
        dados: { tipo: entrada.tipo, processo: ato.processoNumero, identificacao: montada.identificacao, obrigatoria: montada.obrigatoria, fundamento: montada.fundamento },
      });
      return gravada.id;
    });
    return responder(id);
  });

  app.post('/publicacoes-dou/:id/envio', { preHandler: exigirAlguma(['jornada:publicar', 'contratos:editar']) }, async (request): Promise<MateriaDou> => {
    const entrada = esquemaEnvio.parse(request.body);
    const sessao = sessaoDe(request);
    const calendario = await opcoesCalendario(ctx.banco);
    const id = await ctx.banco.transacao(async (tx) => {
      const materia = await materiaAutorizada(request, tx, true, true);
      const agora = ctx.relogio();
      const enviadaEm = entrada.enviadaEm ? new Date(entrada.enviadaEm) : agora;
      const prevista = await registrarEnvioDou(
        tx,
        materia,
        { protocolo: entrada.protocolo, enviadaEm, usuarioId: sessao.usuario.id },
        { ...calendario, horaFechamento: ctx.config.dou.horaFechamento },
        agora,
      );
      await auditar(tx, request, {
        acao: 'dou.materia.enviar',
        recurso: 'dou_materia',
        recursoId: materia.id,
        resumo: `Registrou o envio pelo INCom de ${ROTULO_TIPO[materia.tipo]} (${materia.identificacao}), protocolo ${entrada.protocolo}; edição prevista: ${prevista.split('-').reverse().join('/')}`,
        dados: { tipo: materia.tipo, processo: materia.processo_numero, protocoloIncom: entrada.protocolo, enviadaEm: enviadaEm.toISOString(), dataPrevista: prevista },
      });
      return materia.id;
    });
    return responder(id);
  });

  app.post('/publicacoes-dou/:id/conferir', { preHandler: exigirAlguma(['jornada:publicar', 'contratos:editar']) }, async (request): Promise<MateriaDou> => {
    const sessao = sessaoDe(request);
    const tarefa = await ctx.banco.transacao(async (tx): Promise<LinhaTarefa> => {
      const materia = await materiaAutorizada(request, tx, true, true);
      if (materia.situacao !== 'enviada') {
        throw regraNegocio(
          materia.situacao === 'publicada' ? 'A publicação desta matéria já está registrada.' : 'Registre antes o envio pelo INCom: só a matéria enviada pode ser conferida no DOU.',
        );
      }
      const recurso = materia.tipo === 'aviso_licitacao' && materia.processo_id ? { tipo: 'processo' as const, id: materia.processo_id } : materia.contrato_id ? { tipo: 'contrato' as const, id: materia.contrato_id } : null;
      const pedido = await pedirTarefaRepetivel(
        tx,
        app.fila,
        ['dou', 'conferencia', materia.id],
        {
          tipo: 'dou.conferencia',
          descricao: `Conferir no DOU ${ROTULO_TIPO[materia.tipo]} do processo ${materia.processo_numero}`,
          carga: { materiaId: materia.id },
          uasg: materia.uasg,
          recurso,
          solicitadaPor: sessao.usuario.id,
        },
        ctx.relogio(),
      );
      if (pedido.situacao !== 'pendente') {
        await auditar(tx, request, {
          acao: 'dou.materia.conferir',
          recurso: 'dou_materia',
          recursoId: materia.id,
          resumo: `Pediu a conferência no DOU de ${ROTULO_TIPO[materia.tipo]} (${materia.identificacao})`,
          dados: { tarefaId: pedido.tarefa.id, reprocessada: pedido.situacao === 'reaberta', modo: ctx.config.integracoes },
        });
      }
      return pedido.tarefa;
    });
    await app.fila.despachar([tarefa]);
    await app.fila.aguardar(tarefa.id);
    return responder(idDaRota(request.params));
  });

  app.post('/publicacoes-dou/:id/publicacao', { preHandler: exigirAlguma(['jornada:publicar', 'contratos:editar']) }, async (request): Promise<MateriaDou> => {
    const entrada = esquemaPublicacao.parse(request.body);
    const id = await ctx.banco.transacao(async (tx) => {
      const materia = await materiaAutorizada(request, tx, true, true);
      const agora = ctx.relogio();
      if (entrada.data > ctx.hoje()) throw regraNegocio('A data da edição não pode estar no futuro.', [{ campo: 'data', mensagem: 'Data futura' }]);
      await registrarPublicacaoDou(
        tx,
        materia,
        { data: entrada.data, edicao: entrada.edicao, pagina: entrada.pagina, url: entrada.url ?? null, forma: 'manual', modo: ctx.config.integracoes },
        agora,
      );
      await auditar(tx, request, {
        acao: 'dou.materia.publicacao',
        recurso: 'dou_materia',
        recursoId: materia.id,
        resumo: `Registrou a publicação no DOU de ${ROTULO_TIPO[materia.tipo]} (${materia.identificacao}): edição ${entrada.edicao} de ${entrada.data.split('-').reverse().join('/')}, página ${entrada.pagina}`,
        dados: { tipo: materia.tipo, processo: materia.processo_numero, data: entrada.data, edicao: entrada.edicao, pagina: entrada.pagina, url: entrada.url ?? null },
      });
      return materia.id;
    });
    return responder(id);
  });

  app.post('/publicacoes-dou/:id/jornal', { preHandler: exigirAlguma(['jornada:publicar']) }, async (request): Promise<MateriaDou> => {
    const entrada = esquemaJornal.parse(request.body);
    const id = await ctx.banco.transacao(async (tx) => {
      const materia = await materiaAutorizada(request, tx, true, true);
      if (materia.tipo !== 'aviso_licitacao') throw regraNegocio('Só o aviso de licitação é publicado em jornal diário de grande circulação (art. 54, § 1º).');
      if (materia.situacao === 'rascunho') throw regraNegocio('Envie antes o aviso ao DOU pelo INCom.');
      if (entrada.data > ctx.hoje()) throw regraNegocio('A data da publicação no jornal não pode estar no futuro.', [{ campo: 'data', mensagem: 'Data futura' }]);
      const agora = ctx.relogio();
      await tx.executar('UPDATE dou_materias SET jornal_nome = $2, jornal_publicado_em = $3, jornal_registrado_em = $4 WHERE id = $1', [
        materia.id,
        entrada.nome,
        entrada.data,
        agora.toISOString(),
      ]);
      await auditar(tx, request, {
        acao: 'dou.materia.jornal',
        recurso: 'dou_materia',
        recursoId: materia.id,
        resumo: `Registrou a publicação do aviso (${materia.identificacao}) no jornal ${entrada.nome} de ${entrada.data.split('-').reverse().join('/')} (art. 54, § 1º)`,
        dados: { processo: materia.processo_numero, jornal: entrada.nome, data: entrada.data, anterior: materia.jornal_nome ? { nome: materia.jornal_nome, data: materia.jornal_publicado_em } : null },
      });
      return materia.id;
    });
    return responder(id);
  });
}
