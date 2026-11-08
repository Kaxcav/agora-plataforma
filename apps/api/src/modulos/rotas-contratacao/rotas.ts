/**
 * Rotas HTTP das rotas de contratação (F9): escolha da rota (RF-34), dispensa eletrônica (RN-41), inexigibilidade,
 * adesão a ata e autorização da contratação direta. Toda escrita é transacional e auditada; o escopo de UASG do
 * processo é conferido no servidor (fora do escopo → 404).
 */
import {
  adaptacaoDaRota,
  avaliarAdesaoAta,
  chaveIdempotencia,
  julgarPropostasDispensa,
  limiteDispensaVigente,
  prazoAvisoDispensaEletronica,
  validarEscolhaRota,
  validarInexigibilidade,
  type OpcoesCalendario,
} from '@agora/dominio';
import type { AdesaoProcesso, AtaDisponivelAdesao, RotaProcesso } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, podeVerUasg, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import type { DadosEvento } from '../../auditoria/trilha.ts';
import { opcoesCalendario, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio, semPermissao } from '../../http/erros.ts';
import { centavos, dataIso, idDaRota, textoBusca, uuid } from '../../http/validacao.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import { reabrir } from '../../fila/registro.ts';
import { MINIMO_CARACTERES_TEXTO, modalidadeSugerida } from '../jornada/constantes.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { analisarCesta, tipoDispensa, valorEstimadoProcesso } from '../jornada/regras.ts';
import { selecaoCompleta } from '../jornada/selecao.ts';
import { exigirEtapa, exigirEtapaAte, gravarJson, montarDisputa } from '../jornada/servico.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { pendenciasDaRota } from './jornada.ts';
import {
  adaptacaoDaLinha,
  carregarRota,
  fracionamentoDaUasg,
  montarAdesao,
  montarAviso,
  montarInexigibilidade,
  montarPropostas,
  obterAdesao,
  obterLinhaRota,
  quantidadesAderidas,
  type CargaRota,
  type LinhaRota,
} from './repositorio.ts';
import { ATOS_CONTRATACAO_DIRETA } from './tarefas.ts';

const ROTAS = ['licitacao', 'dispensa', 'inexigibilidade', 'adesao_ata', 'sicx'] as const;
const HIPOTESES_DISPENSA = ['valor_obras_engenharia', 'valor_demais', 'outra'] as const;
const HIPOTESES_INEXIGIBILIDADE = ['exclusividade', 'artista', 'notoria_especializacao', 'credenciamento', 'imovel'] as const;

const textoOpcional = z
  .string()
  .max(5_000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null || v.trim() === '' ? null : v.trim()));

const esquemaRota = z
  .object({
    rota: z.enum(ROTAS),
    hipoteseDispensa: z.enum(HIPOTESES_DISPENSA).nullable().optional().transform((v) => v ?? null),
    incisoDispensa: z.string().trim().max(20).nullable().optional().transform((v) => (v ? v : null)),
    hipoteseInexigibilidade: z.enum(HIPOTESES_INEXIGIBILIDADE).nullable().optional().transform((v) => v ?? null),
    justificativa: textoOpcional,
    natureza: z.string().trim().max(120).nullable().optional().transform((v) => (v ? v : null)),
    justificativaFracionamento: textoOpcional,
  })
  .refine((e) => e.rota !== 'dispensa' || e.hipoteseDispensa !== null, { message: 'Informe a hipótese de dispensa do art. 75', path: ['hipoteseDispensa'] })
  .refine((e) => e.rota !== 'inexigibilidade' || e.hipoteseInexigibilidade !== null, { message: 'Informe a hipótese do art. 74', path: ['hipoteseInexigibilidade'] });

const esquemaProposta = z.object({ fornecedorId: uuid, valor: centavos.positive() });

const esquemaInexigibilidade = z.object({
  justificativaInviabilidade: textoOpcional,
  documentoExclusividade: z.enum(['atestado', 'contrato', 'declaracao', 'carta_exclusividade', 'outro']).nullable().optional(),
  semPreferenciaMarca: z.boolean().optional(),
  consagracao: textoOpcional,
  porEmpresario: z.boolean().optional(),
  exclusividadePermanente: z.boolean().optional(),
  alinea: z.string().trim().max(2).nullable().optional(),
  elementosNotoriaEspecializacao: textoOpcional,
  publicidade: z.boolean().optional(),
  editalChamamento: textoOpcional,
  avaliacaoPrevia: z.boolean().optional(),
  semImovelPublicoDisponivel: z.boolean().optional(),
  justificativaSingularidade: textoOpcional,
});

const esquemaAdesao = z.object({
  ataId: uuid,
  itemId: uuid,
  quantidade: z.number().int().positive().max(100_000_000),
  justificativaVantagem: z.string().trim().min(MINIMO_CARACTERES_TEXTO).max(5_000),
});

const esquemaAceite = z.object({ data: dataIso });
const esquemaAnuencia = z.object({ decisao: z.enum(['autorizada', 'recusada']), motivo: textoOpcional });

const esquemaAutorizacao = z.object({
  fornecedorId: uuid,
  valor: centavos.positive().nullable().optional().transform((v) => v ?? null),
  razaoEscolha: z.string().trim().min(MINIMO_CARACTERES_TEXTO).max(5_000),
  justificativaPreco: z.string().trim().min(MINIMO_CARACTERES_TEXTO).max(5_000),
  habilitacaoVerificada: z.boolean(),
});

interface EventoRota {
  acao: string;
  resumo: string;
  dados?: DadosEvento;
}

function porValor(rota: LinhaRota | null): boolean {
  return rota?.rota === 'dispensa' && (rota.hipotese_dispensa === 'valor_demais' || rota.hipotese_dispensa === 'valor_obras_engenharia');
}

/** Bloco `RotaProcesso` (GET /processos/:id/rota): rota, documentos e travas, aviso, propostas, adesão e compras. */
export async function montarRotaProcesso(
  executor: Executor,
  linha: LinhaProcesso,
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<RotaProcesso> {
  const carga: CargaRota | null = await carregarRota(executor, linha.id, hoje, calendario);
  const rota = carga?.rota ?? null;
  const a = adaptacaoDaLinha(rota);
  const valorEstimado = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, hoje));
  const tipo = tipoDispensa(linha.dfd.tipoObjeto);
  const limite = rota?.rota === 'dispensa' && porValor(rota) ? limiteDispensaVigente(hoje, tipo) : null;
  const fracionamento =
    rota && porValor(rota) && rota.natureza && valorEstimado !== null && valorEstimado > 0
      ? await fracionamentoDaUasg(executor, { uasg: linha.uasg, natureza: rota.natureza, tipo, novaContratacao: valorEstimado, hoje, excetoProcesso: linha.id })
      : null;
  let adesao: AdesaoProcesso | null = null;
  if (carga?.adesao) {
    const aderidas = await quantidadesAderidas(executor, carga.adesao.item_ata_id, carga.adesao.uasg_aderente, carga.adesao.id);
    adesao = montarAdesao(carga.adesao, aderidas, hoje);
  }
  const pendencias = carga ? (await pendenciasDaRota(executor, linha, carga, a, valorEstimado, hoje, calendario)).bloqueios.map((b) => b.mensagem) : [];
  const autorizacao = rota?.autorizacao ?? null;
  return {
    processoId: linha.id,
    uasg: linha.uasg,
    rota: a.rota,
    titulo: a.titulo,
    fundamento: a.fundamento,
    modalidade: a.modalidade,
    hipoteseDispensa: rota?.hipotese_dispensa ?? null,
    incisoDispensa: rota?.inciso_dispensa ?? null,
    hipoteseInexigibilidade: rota?.hipotese_inexigibilidade ?? null,
    natureza: rota?.natureza ?? null,
    justificativa: rota?.justificativa ?? null,
    justificativaFracionamento: rota?.justificativa_fracionamento ?? null,
    escolhidaEm: rota?.escolhida_em ?? null,
    escolhidaPor: usuarioResumo(rota?.escolhida_por ?? null, rota?.escolhida_por_nome ?? null),
    documentos: a.documentos,
    exigencias: {
      etp: a.etp,
      matrizRiscos: a.matrizRiscos,
      pesquisaPrecos: a.pesquisaPrecos,
      termoReferencia: a.termoReferencia,
      edital: a.edital,
      minutaContrato: a.minutaContrato,
      parecerJuridico: a.parecerJuridico,
      avisoDispensa: a.avisoDispensa,
      autorizacaoContratacao: a.autorizacaoContratacao,
      contratoNaJornada: a.contratoNaJornada,
    },
    limite: limite ? { valor: limite.valor, norma: limite.norma, fundamento: limite.fundamento } : null,
    valorEstimado,
    fracionamento,
    aviso: montarAviso(carga?.aviso ?? null, hoje, calendario),
    previaEncerramentoAviso: a.avisoDispensa ? prazoAvisoDispensaEletronica(hoje, calendario).data : null,
    propostas: montarPropostas(carga?.propostas ?? []),
    julgadoEm: rota?.julgado_em ?? null,
    inexigibilidade: rota ? montarInexigibilidade(rota) : null,
    adesao,
    autorizacao: autorizacao
      ? {
          fornecedor: { id: autorizacao.fornecedorId, nome: linha.disputa.licitantes.find((l) => l.fornecedorId === autorizacao.fornecedorId)?.nome ?? 'Fornecedor' },
          valor: autorizacao.valor,
          razaoEscolha: autorizacao.razaoEscolha,
          justificativaPreco: autorizacao.justificativaPreco,
          data: autorizacao.data,
          por: { id: autorizacao.porId, nome: autorizacao.porNome },
        }
      : null,
    comprasSicx: carga?.compras ?? [],
    pendencias,
  };
}

export async function rotasProcessoContratacao(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('jornada:ler') };
  const edicao = { preHandler: exigir('jornada:editar') };
  const publicacao = { preHandler: exigir('jornada:publicar') };
  const autoridade = { preHandler: exigir('jornada:homologar') };

  async function responder(request: FastifyRequest, id: string): Promise<RotaProcesso> {
    const linha = await obterLinhaProcesso(ctx.banco, id, escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    return montarRotaProcesso(ctx.banco, linha, ctx.hoje(), await opcoesCalendario(ctx.banco));
  }

  /** Escrita no processo: trava a linha (escopo de UASG → 404), executa e registra na trilha, numa transação. */
  async function alterar(
    request: FastifyRequest,
    acao: (tx: Transacao, linha: LinhaProcesso, c: { hoje: string; agora: Date; calendario: OpcoesCalendario }) => Promise<EventoRota>,
    aposConfirmar?: () => Promise<void>,
  ): Promise<RotaProcesso> {
    const id = idDaRota(request.params);
    const escopo = escopoUasgs(sessaoDe(request));
    const c = { hoje: ctx.hoje(), agora: ctx.relogio(), calendario: await opcoesCalendario(ctx.banco) };
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      const evento = await acao(tx, linha, c);
      await auditar(tx, request, {
        acao: `processo.${evento.acao}`,
        recurso: 'processo',
        recursoId: id,
        resumo: evento.resumo,
        dados: { numeroSei: linha.numero_sei, etapa: linha.etapa_atual, ...evento.dados },
      });
    });
    await aposConfirmar?.();
    return responder(request, id);
  }

  async function exigirRota(tx: Transacao, linha: LinhaProcesso, rotas: readonly LinhaRota['rota'][], oQue: string): Promise<LinhaRota> {
    const rota = await obterLinhaRota(tx, linha.id);
    if (!rota || !rotas.includes(rota.rota)) throw regraNegocio(`${oQue} não se aplica à rota de contratação deste processo.`, [{ campo: 'RF-34', mensagem: `Rota: ${rota?.rota ?? 'licitacao'}` }]);
    return rota;
  }

  app.get('/processos/:id/rota', leitura, async (request): Promise<RotaProcesso> => responder(request, idDaRota(request.params)));

  // ───────── escolha da rota (etapa 1, RF-34) ─────────

  app.put('/processos/:id/rota', edicao, async (request) => {
    const e = esquemaRota.parse(request.body);
    const sessao = sessaoDe(request);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 1, 'A escolha da rota de contratação');
      const anterior = await obterLinhaRota(tx, linha.id);
      const valorEstimado = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, c.hoje));
      const escolha = validarEscolhaRota(
        { ...e, valorEstimado, tipoObjeto: tipoDispensa(linha.dfd.tipoObjeto), data: c.hoje },
        MINIMO_CARACTERES_TEXTO,
      );
      const a = adaptacaoDaRota(e.rota, e.hipoteseDispensa);
      await tx.executar(
        `INSERT INTO processos_rotas (processo_id, rota, hipotese_dispensa, inciso_dispensa, hipotese_inexigibilidade, justificativa, natureza,
                                      justificativa_fracionamento, escolhida_por, escolhida_em, atualizada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (processo_id) DO UPDATE SET rota = EXCLUDED.rota, hipotese_dispensa = EXCLUDED.hipotese_dispensa,
           inciso_dispensa = EXCLUDED.inciso_dispensa, hipotese_inexigibilidade = EXCLUDED.hipotese_inexigibilidade,
           justificativa = EXCLUDED.justificativa, natureza = EXCLUDED.natureza, justificativa_fracionamento = EXCLUDED.justificativa_fracionamento,
           inexigibilidade = CASE WHEN processos_rotas.rota = EXCLUDED.rota THEN processos_rotas.inexigibilidade ELSE NULL END,
           escolhida_por = EXCLUDED.escolhida_por, atualizada_em = EXCLUDED.atualizada_em`,
        [
          linha.id,
          e.rota,
          e.rota === 'dispensa' ? e.hipoteseDispensa : null,
          e.rota === 'dispensa' && e.hipoteseDispensa === 'outra' ? e.incisoDispensa : null,
          e.rota === 'inexigibilidade' ? e.hipoteseInexigibilidade : null,
          e.justificativa,
          e.natureza,
          e.justificativaFracionamento,
          sessao.usuario.id,
          c.agora.toISOString(),
        ],
      );
      if (anterior?.rota === 'adesao_ata' && e.rota !== 'adesao_ata') await tx.executar('DELETE FROM atas_adesoes WHERE processo_id = $1', [linha.id]);
      await tx.executar('UPDATE processos SET modalidade_prevista = $2, atualizado_em = $3 WHERE id = $1', [
        linha.id,
        e.rota === 'licitacao' ? modalidadeSugerida(linha.dfd.tipoObjeto) : a.modalidade,
        c.agora.toISOString(),
      ]);
      return {
        acao: 'rota.escolher',
        resumo: `Escolheu a rota de contratação: ${a.titulo}${anterior && anterior.rota !== e.rota ? ` (antes: ${adaptacaoDaRota(anterior.rota, anterior.hipotese_dispensa).titulo})` : ''}`,
        dados: { rota: e.rota, hipoteseDispensa: e.hipoteseDispensa, hipoteseInexigibilidade: e.hipoteseInexigibilidade, natureza: e.natureza, pendencias: escolha.pendencias.length },
      };
    });
  });

  // ───────── dispensa eletrônica (RN-41) ─────────

  app.post('/processos/:id/dispensa/aviso', publicacao, async (request) => {
    const sessao = sessaoDe(request);
    const enviadas: LinhaTarefa[] = [];
    return alterar(
      request,
      async (tx, linha, c) => {
        exigirEtapa(linha, 5, 'A publicação do aviso de dispensa');
        const rota = await exigirRota(tx, linha, ['dispensa'], 'O aviso de dispensa eletrônica');
        if (!porValor(rota)) throw regraNegocio('O aviso de 3 dias úteis é da dispensa por valor (art. 75, I e II, e § 3º).');
        const conclusao = linha.parecer.conclusao;
        if (conclusao !== 'favoravel' && conclusao !== 'favoravel_com_ressalvas') {
          throw regraNegocio('O aviso só é publicado depois do parecer jurídico favorável (art. 72, III).', [{ campo: 'RF-15', mensagem: 'Parecer jurídico favorável pendente' }]);
        }
        const [existente] = await tx.consultar<{ tarefa_id: string; situacao: string }>('SELECT tarefa_id, situacao FROM dispensas_avisos WHERE processo_id = $1', [linha.id]);
        if (existente) {
          const reaberta = await reabrir(tx, existente.tarefa_id, c.agora);
          if (!reaberta) throw regraNegocio(existente.situacao === 'publicado' ? 'O aviso já foi publicado no PNCP.' : 'O aviso já está na fila de publicação do PNCP.');
          enviadas.push(reaberta);
          return { acao: 'dispensa.aviso.reenviar', resumo: 'Reenviou o aviso de contratação direta ao PNCP (estava na fila de erro)', dados: { tarefaId: reaberta.id } };
        }
        const { tarefa } = await app.fila.enfileirar(tx, {
          tipo: 'pncp.contratacao_direta',
          chave: chaveIdempotencia(['pncp', 'contratacao_direta', 'aviso', linha.id]),
          descricao: `Publicar no PNCP o aviso de contratação direta do processo ${linha.numero_sei}`,
          carga: { processoId: linha.id, ato: 'aviso' },
          uasg: linha.uasg,
          recurso: { tipo: 'processo', id: linha.id },
          solicitadaPor: sessao.usuario.id,
        });
        await tx.executar(
          `INSERT INTO pncp_envios (tarefa_id, objeto, processo_id, documento_tipo, titulo, tipo_documento_pncp, modo, criado_em)
           VALUES ($1, 'compra', $2, 'aviso_contratacao_direta', $3, $4, $5, $6) ON CONFLICT (tarefa_id) DO NOTHING`,
          [tarefa.id, linha.id, ATOS_CONTRATACAO_DIRETA.aviso.titulo, ATOS_CONTRATACAO_DIRETA.aviso.tipoDocumentoPncp, ctx.config.integracoes, c.agora.toISOString()],
        );
        await tx.executar(
          `INSERT INTO dispensas_avisos (processo_id, tarefa_id, situacao, solicitado_por, solicitado_em) VALUES ($1, $2, 'na_fila', $3, $4)`,
          [linha.id, tarefa.id, sessao.usuario.id, c.agora.toISOString()],
        );
        enviadas.push(tarefa);
        return {
          acao: 'dispensa.aviso.publicar',
          resumo: 'Enviou o aviso de contratação direta ao PNCP pela fila de integrações (prazo mínimo de 3 dias úteis para propostas adicionais)',
          dados: { tarefaId: tarefa.id, chaveIdempotencia: tarefa.chave_idempotencia, modo: ctx.config.integracoes, fila: app.fila.driver.transporte },
        };
      },
      async () => {
        await app.fila.despachar(enviadas);
        const [tarefa] = enviadas;
        if (tarefa) await app.fila.aguardar(tarefa.id);
      },
    );
  });

  app.post('/processos/:id/dispensa/propostas', edicao, async (request) => {
    const e = esquemaProposta.parse(request.body);
    const sessao = sessaoDe(request);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 5, 'O registro de propostas da dispensa');
      const rota = await exigirRota(tx, linha, ['dispensa'], 'O registro de propostas');
      if (!porValor(rota)) throw regraNegocio('Propostas adicionais são da dispensa por valor com aviso (art. 75, § 3º).');
      const carga = await carregarRota(tx, linha.id, c.hoje, c.calendario);
      const aviso = montarAviso(carga?.aviso ?? null, c.hoje, c.calendario);
      if (aviso?.situacao === 'publicado' && !aviso.aberto) {
        throw regraNegocio(`O aviso encerrou em ${aviso.encerramento ?? ''}: não se recebem novas propostas.`, [{ campo: 'RN-41', mensagem: 'Prazo de 3 dias úteis encerrado (art. 75, § 3º)' }]);
      }
      const [fornecedor] = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE id = $1', [e.fornecedorId]);
      if (!fornecedor) throw regraNegocio('O fornecedor não consta do cadastro.', [{ campo: 'fornecedorId', mensagem: 'Fornecedor não cadastrado' }]);
      const adicional = aviso?.situacao === 'publicado' && aviso.aberto;
      await tx.executar(
        `INSERT INTO dispensas_propostas (processo_id, fornecedor_id, valor, adicional, recebida_em, registrada_por) VALUES ($1, $2, $3, $4, $5, $6)`,
        [linha.id, e.fornecedorId, e.valor, adicional, c.agora.toISOString(), sessao.usuario.id],
      );
      return {
        acao: 'dispensa.proposta.registrar',
        resumo: adicional ? 'Registrou proposta adicional recebida durante o aviso de dispensa' : 'Registrou proposta inicial da dispensa (antes do aviso)',
        dados: { fornecedorId: e.fornecedorId, valor: e.valor, adicional },
      };
    });
  });

  app.post('/processos/:id/dispensa/julgamento', edicao, async (request) =>
    alterar(request, async (tx, linha, c) => {
      exigirEtapa(linha, 6, 'O julgamento das propostas da dispensa');
      const rota = await exigirRota(tx, linha, ['dispensa'], 'O julgamento das propostas');
      if (!porValor(rota)) throw regraNegocio('O julgamento das propostas do aviso é da dispensa por valor.');
      if (rota.autorizacao) throw regraNegocio('A contratação já foi autorizada: o julgamento não pode ser refeito.');
      const carga = await carregarRota(tx, linha.id, c.hoje, c.calendario);
      const aviso = montarAviso(carga?.aviso ?? null, c.hoje, c.calendario);
      if (!aviso?.julgamentoLiberado) throw regraNegocio('O julgamento só começa depois do encerramento do aviso de 3 dias úteis (art. 75, § 3º).');
      const limite = limiteDispensaVigente(c.hoje, tipoDispensa(linha.dfd.tipoObjeto)).valor;
      const valorEstimado = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, c.hoje));
      const r = julgarPropostasDispensa({
        limite,
        valorEstimado,
        propostas: (carga?.propostas ?? []).map((p) => ({ id: p.id, fornecedorId: p.fornecedor_id, valor: p.valor, recebidaEm: p.recebida_em, adicional: p.adicional })),
      });
      if (!r.selecionada) throw regraNegocio('Não há proposta válida dentro do limite: a dispensa ficou deserta ou fracassada; avalie repetir o aviso ou licitar.', [{ campo: 'RN-41', mensagem: 'Nenhuma proposta classificada' }]);
      await tx.executar('UPDATE dispensas_propostas SET posicao = NULL, motivo_desclassificacao = NULL WHERE processo_id = $1', [linha.id]);
      for (const [i, p] of r.classificadas.entries()) await tx.executar('UPDATE dispensas_propostas SET posicao = $2 WHERE id = $1', [p.id, i + 1]);
      for (const d of r.desclassificadas) await tx.executar('UPDATE dispensas_propostas SET motivo_desclassificacao = $2 WHERE id = $1', [d.proposta.id, d.motivo]);
      await tx.executar('UPDATE processos_rotas SET julgado_em = $2, atualizada_em = $2 WHERE processo_id = $1', [linha.id, c.agora.toISOString()]);
      return {
        acao: 'dispensa.julgar',
        resumo: `Julgou ${r.classificadas.length} proposta(s) da dispensa e selecionou a mais vantajosa (${r.selecionada.valor} centavos)`,
        dados: { selecionada: r.selecionada.fornecedorId, valor: r.selecionada.valor, classificadas: r.classificadas.length, desclassificadas: r.desclassificadas.length, sinais: r.sinais },
      };
    }),
  );

  // ───────── inexigibilidade (art. 74) ─────────

  app.put('/processos/:id/inexigibilidade', edicao, async (request) => {
    const e = esquemaInexigibilidade.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 5, 'A comprovação da inexigibilidade');
      const rota = await exigirRota(tx, linha, ['inexigibilidade'], 'A comprovação da inexigibilidade');
      const comprovacao = { ...e, hipotese: rota.hipotese_inexigibilidade ?? 'exclusividade' };
      const v = validarInexigibilidade(comprovacao, MINIMO_CARACTERES_TEXTO);
      await tx.executar('UPDATE processos_rotas SET inexigibilidade = $2::jsonb, atualizada_em = $3 WHERE processo_id = $1', [
        linha.id,
        JSON.stringify(comprovacao),
        c.agora.toISOString(),
      ]);
      return { acao: 'inexigibilidade.registrar', resumo: 'Registrou a comprovação da inexigibilidade (art. 74)', dados: { hipotese: comprovacao.hipotese, pendencias: v.pendencias.length } };
    });
  });

  // ───────── adesão a ata (art. 86, §§ 2º a 5º) ─────────

  app.post('/processos/:id/adesao', edicao, async (request) => {
    const e = esquemaAdesao.parse(request.body);
    const sessao = sessaoDe(request);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 4, 'O registro da adesão à ata');
      await exigirRota(tx, linha, ['adesao_ata'], 'A adesão a ata');
      const atual = await obterAdesao(tx, linha.id);
      if (atual && atual.situacao !== 'solicitada' && atual.situacao !== 'recusada') throw regraNegocio('A adesão já tem aceite do fornecedor ou anuência: não pode ser alterada.');
      const [item] = await tx.consultar<{ id: string; ata_id: string; uasg: string; vigencia_inicio: string; vigencia_fim: string; aceita_adesao: boolean; quantidade_registrada: number; valor_unitario: number }>(
        `SELECT i.id, i.ata_id, a.uasg, a.vigencia_inicio, a.vigencia_fim, a.aceita_adesao, i.quantidade_registrada, i.valor_unitario
           FROM itens_ata i JOIN atas a ON a.id = i.ata_id WHERE i.id = $1 AND i.ata_id = $2`,
        [e.itemId, e.ataId],
      );
      if (!item) throw regraNegocio('O item não pertence à ata informada.', [{ campo: 'itemId', mensagem: 'Item da ata não encontrado' }]);
      const aderidas = await quantidadesAderidas(tx, item.id, linha.uasg, atual?.id ?? null);
      const avaliacao = avaliarAdesaoAta({
        quantidadeRegistrada: item.quantidade_registrada,
        quantidadeAderidaPeloOrgao: aderidas.orgao,
        quantidadeAderidaTotal: aderidas.total,
        quantidadeSolicitada: e.quantidade,
        ataVigente: c.hoje >= item.vigencia_inicio && c.hoje <= item.vigencia_fim,
        ataAceitaAdesao: item.aceita_adesao,
        esferaGerenciador: 'federal',
        esferaAderente: 'federal',
        aderenteParticipante: item.uasg === linha.uasg,
      });
      if (!avaliacao.permitida) {
        throw regraNegocio('A adesão foi recusada: não atende aos requisitos ou aos limites do art. 86.', avaliacao.recusas.map((m) => ({ campo: 'RF-34', mensagem: m })));
      }
      await tx.executar('DELETE FROM atas_adesoes WHERE processo_id = $1', [linha.id]);
      await tx.executar(
        `INSERT INTO atas_adesoes (processo_id, ata_id, item_ata_id, uasg_aderente, quantidade, valor_unitario, justificativa_vantagem, situacao,
                                   solicitada_por, solicitada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'solicitada', $8, $9)`,
        [linha.id, item.ata_id, item.id, linha.uasg, e.quantidade, item.valor_unitario, e.justificativaVantagem, sessao.usuario.id, c.agora.toISOString()],
      );
      return {
        acao: 'adesao.solicitar',
        resumo: `Solicitou adesão de ${e.quantidade} unidade(s) à ata (limite por órgão ${avaliacao.limitePorOrgao}, saldo total ${avaliacao.saldoTotal})`,
        dados: { ataId: item.ata_id, itemId: item.id, quantidade: e.quantidade, limitePorOrgao: avaliacao.limitePorOrgao, limiteTotal: avaliacao.limiteTotal },
      };
    });
  });

  /** Atas vigentes que aceitam adesão, gerenciadas por outra UASG, com os saldos do art. 86, §§ 4º e 5º para este processo. */
  app.get('/processos/:id/adesao/atas-disponiveis', leitura, async (request): Promise<AtaDisponivelAdesao[]> => {
    const q = z.object({ busca: textoBusca }).parse(request.query);
    const linha = await obterLinhaProcesso(ctx.banco, idDaRota(request.params), escopoUasgs(sessaoDe(request)));
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    const hoje = ctx.hoje();
    const itens = await ctx.banco.consultar<{
      ata_id: string; numero: string; uasg: string; objeto: string; vigencia_fim: string; item_id: string; item_numero: number; descricao: string;
      unidade: string; valor_unitario: number; quantidade_registrada: number; fornecedor_id: string; razao_social: string; tipo_pessoa: 'PJ' | 'PF';
      aderido_total: number; aderido_orgao: number;
    }>(
      `SELECT a.id AS ata_id, a.numero, a.uasg, a.objeto, a.vigencia_fim, i.id AS item_id, i.numero AS item_numero, i.descricao,
              i.unidade_fornecimento AS unidade, i.valor_unitario, i.quantidade_registrada, i.fornecedor_id, f.razao_social, f.tipo_pessoa,
              COALESCE((SELECT SUM(ad.quantidade) FROM atas_adesoes ad WHERE ad.item_ata_id = i.id AND ad.situacao = 'autorizada'), 0)::integer AS aderido_total,
              COALESCE((SELECT SUM(ad.quantidade) FROM atas_adesoes ad WHERE ad.item_ata_id = i.id AND ad.situacao = 'autorizada' AND ad.uasg_aderente = $2), 0)::integer AS aderido_orgao
         FROM atas a JOIN itens_ata i ON i.ata_id = a.id JOIN fornecedores f ON f.id = i.fornecedor_id
        WHERE a.aceita_adesao AND a.vigencia_inicio <= $1 AND a.vigencia_fim >= $1 AND a.uasg <> $2
          AND ($3::text IS NULL OR a.busca_normalizada LIKE $3 ESCAPE '\\' OR i.busca_normalizada LIKE $3 ESCAPE '\\')
        ORDER BY a.vigencia_fim DESC, a.numero, i.numero
        LIMIT 200`,
      [hoje, linha.uasg, q.busca ? padraoContem(q.busca) : null],
    );
    const porAta = new Map<string, AtaDisponivelAdesao>();
    for (const i of itens) {
      const ata = porAta.get(i.ata_id) ?? { id: i.ata_id, numero: i.numero, uasg: i.uasg, objeto: i.objeto, vigenciaFim: i.vigencia_fim, itens: [] };
      const limitePorOrgao = Math.floor(i.quantidade_registrada / 2);
      const limiteTotal = i.quantidade_registrada * 2;
      ata.itens.push({
        id: i.item_id,
        numero: i.item_numero,
        descricao: i.descricao,
        unidade: i.unidade,
        valorUnitario: i.valor_unitario,
        quantidadeRegistrada: i.quantidade_registrada,
        fornecedor: { id: i.fornecedor_id, nome: nomeExibivel(i.tipo_pessoa, i.razao_social) },
        limitePorOrgao,
        saldoOrgao: Math.max(0, limitePorOrgao - i.aderido_orgao),
        limiteTotal,
        saldoTotal: Math.max(0, limiteTotal - i.aderido_total),
      });
      porAta.set(i.ata_id, ata);
    }
    return [...porAta.values()];
  });

  app.post('/processos/:id/adesao/aceite-fornecedor', edicao, async (request) => {
    const e = esquemaAceite.parse(request.body);
    return alterar(request, async (tx, linha, c) => {
      exigirEtapaAte(linha, 5, 'O aceite do fornecedor');
      await exigirRota(tx, linha, ['adesao_ata'], 'O aceite do fornecedor');
      const adesao = await obterAdesao(tx, linha.id);
      if (!adesao || adesao.situacao !== 'solicitada') throw regraNegocio('Não há adesão aguardando o aceite do fornecedor.');
      if (e.data > c.hoje) throw regraNegocio('A data do aceite não pode ser futura.');
      await tx.executar(`UPDATE atas_adesoes SET situacao = 'aceita_fornecedor', aceite_fornecedor_em = $2 WHERE id = $1`, [adesao.id, e.data]);
      return { acao: 'adesao.aceite_fornecedor', resumo: 'Registrou o aceite do fornecedor à adesão (Decreto 11.462/2023, art. 31, § 1º)', dados: { adesaoId: adesao.id, data: e.data } };
    });
  });

  // ───────── autorização da contratação direta (art. 72, VIII) ─────────

  app.post('/processos/:id/contratacao-direta/autorizacao', autoridade, async (request) => {
    const e = esquemaAutorizacao.parse(request.body);
    const sessao = sessaoDe(request);
    const enviadas: LinhaTarefa[] = [];
    return alterar(
      request,
      async (tx, linha, c) => {
        exigirEtapa(linha, 6, 'A autorização da contratação');
        const [designado] = await tx.consultar<{ ok: number }>(
          `SELECT 1 AS ok FROM processos_equipe WHERE processo_id = $1 AND papel = 'autoridade_competente' AND usuario_id = $2`,
          [linha.id, sessao.usuario.id],
        );
        if (!designado) throw semPermissao('Somente a autoridade competente designada na equipe do processo autoriza a contratação (art. 72, VIII).');
        const rota = await exigirRota(tx, linha, ['dispensa', 'inexigibilidade', 'adesao_ata'], 'A autorização da contratação direta');
        if (rota.autorizacao) throw regraNegocio('A contratação já foi autorizada.');
        if (!e.habilitacaoVerificada) throw regraNegocio('Confirme que o contratado preenche os requisitos de habilitação (art. 72, V).', [{ campo: 'habilitacaoVerificada', mensagem: 'Habilitação não verificada' }]);
        let valor = e.valor;
        if (porValor(rota)) {
          if (!rota.julgado_em) throw regraNegocio('Julgue as propostas do aviso antes de autorizar a contratação.');
          const carga = await carregarRota(tx, linha.id, c.hoje, c.calendario);
          const proposta = carga?.propostas.find((p) => p.fornecedor_id === e.fornecedorId && p.posicao !== null);
          if (!proposta) throw regraNegocio('O fornecedor não tem proposta classificada no julgamento da dispensa.', [{ campo: 'fornecedorId', mensagem: 'Proposta não classificada' }]);
          valor = proposta.valor;
        } else if (rota.rota === 'adesao_ata') {
          const adesao = await obterAdesao(tx, linha.id);
          if (!adesao || adesao.situacao !== 'autorizada') throw regraNegocio('A adesão ainda não tem a anuência do gerenciador.');
          if (adesao.fornecedor_id !== e.fornecedorId) throw regraNegocio('Na adesão, o contratado é o fornecedor registrado no item da ata.', [{ campo: 'fornecedorId', mensagem: 'Fornecedor diferente do da ata' }]);
          valor = adesao.quantidade * adesao.valor_unitario;
        } else {
          if (rota.rota === 'inexigibilidade') {
            const inex = montarInexigibilidade(rota);
            if (inex && inex.pendencias.length > 0) throw regraNegocio('A comprovação da inexigibilidade está incompleta.', inex.pendencias.map((m) => ({ campo: 'RF-34', mensagem: m })));
          }
          const [fornecedor] = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE id = $1', [e.fornecedorId]);
          if (!fornecedor) throw regraNegocio('O fornecedor não consta do cadastro.');
          if (valor === null) throw regraNegocio('Informe o valor da contratação.', [{ campo: 'valor', mensagem: 'Valor obrigatório' }]);
        }
        if (valor === null) throw regraNegocio('Valor da contratação não identificado.');
        const disputa = await montarDisputa(tx, [{ id: e.fornecedorId, valorProposta: valor }], c.agora);
        await gravarJson(tx, linha.id, 'disputa', disputa, c.agora);
        const selecao = selecaoCompleta(linha.selecao);
        const autor = { id: sessao.usuario.id, nome: sessao.usuario.nome };
        await gravarJson(tx, linha.id, 'selecao', { ...selecao, contratacaoDireta: { data: c.hoje, fornecedorId: e.fornecedorId, motivacao: e.razaoEscolha, por: autor } }, c.agora);
        await tx.executar('UPDATE processos_rotas SET autorizacao = $2::jsonb, atualizada_em = $3 WHERE processo_id = $1', [
          linha.id,
          JSON.stringify({ fornecedorId: e.fornecedorId, valor, razaoEscolha: e.razaoEscolha, justificativaPreco: e.justificativaPreco, data: c.hoje, porId: autor.id, porNome: autor.nome }),
          c.agora.toISOString(),
        ]);
        // Art. 72, parágrafo único: sem aviso publicado (inexigibilidade e demais dispensas), divulga-se o ato de autorização.
        if (!porValor(rota) && rota.rota !== 'adesao_ata') {
          const { tarefa } = await app.fila.enfileirar(tx, {
            tipo: 'pncp.contratacao_direta',
            chave: chaveIdempotencia(['pncp', 'contratacao_direta', 'autorizacao', linha.id]),
            descricao: `Divulgar no PNCP o ato que autoriza a contratação direta do processo ${linha.numero_sei}`,
            carga: { processoId: linha.id, ato: 'autorizacao' },
            uasg: linha.uasg,
            recurso: { tipo: 'processo', id: linha.id },
            solicitadaPor: sessao.usuario.id,
          });
          await tx.executar(
            `INSERT INTO pncp_envios (tarefa_id, objeto, processo_id, documento_tipo, titulo, tipo_documento_pncp, modo, criado_em)
             VALUES ($1, 'compra', $2, 'ato_contratacao_direta', $3, $4, $5, $6) ON CONFLICT (tarefa_id) DO NOTHING`,
            [tarefa.id, linha.id, ATOS_CONTRATACAO_DIRETA.autorizacao.titulo, ATOS_CONTRATACAO_DIRETA.autorizacao.tipoDocumentoPncp, ctx.config.integracoes, c.agora.toISOString()],
          );
          enviadas.push(tarefa);
        }
        return {
          acao: 'contratacao_direta.autorizar',
          resumo: `Autorizou a contratação (${adaptacaoDaRota(rota.rota, rota.hipotese_dispensa).titulo}) com o fornecedor selecionado`,
          dados: { fornecedorId: e.fornecedorId, valor, rota: rota.rota, divulgacaoAto: enviadas.length > 0 },
        };
      },
      async () => {
        await app.fila.despachar(enviadas);
        const [tarefa] = enviadas;
        if (tarefa) await app.fila.aguardar(tarefa.id);
      },
    );
  });

  // ───────── anuência do gerenciador (atas) ─────────

  app.get('/atas/adesoes', { preHandler: exigir('atas:ler') }, async (request) => {
    const escopo = escopoUasgs(sessaoDe(request));
    const hoje = ctx.hoje();
    const linhas = await ctx.banco.consultar<{ processo_id: string; numero_sei: string; titulo: string }>(
      `SELECT ad.processo_id, p.numero_sei, p.titulo FROM atas_adesoes ad JOIN atas a ON a.id = ad.ata_id JOIN processos p ON p.id = ad.processo_id
        WHERE ($1::text[] IS NULL OR a.uasg = ANY($1::text[])) ORDER BY ad.solicitada_em DESC LIMIT 200`,
      [escopo],
    );
    const resultado: (AdesaoProcesso & { processo: { id: string; numeroSei: string; titulo: string } })[] = [];
    for (const l of linhas) {
      const adesao = await obterAdesao(ctx.banco, l.processo_id);
      if (!adesao) continue;
      const aderidas = await quantidadesAderidas(ctx.banco, adesao.item_ata_id, adesao.uasg_aderente, adesao.id);
      const montada = montarAdesao(adesao, aderidas, hoje);
      if (montada) resultado.push({ ...montada, processo: { id: l.processo_id, numeroSei: l.numero_sei, titulo: l.titulo } });
    }
    return resultado;
  });

  app.post('/atas/adesoes/:id/anuencia', { preHandler: exigir('atas:editar') }, async (request) => {
    const e = esquemaAnuencia.parse(request.body);
    const sessao = sessaoDe(request);
    const id = idDaRota(request.params);
    const hoje = ctx.hoje();
    let processoId = '';
    await ctx.banco.transacao(async (tx) => {
      const [adesao] = await tx.consultar<{ id: string; processo_id: string; ata_uasg: string; situacao: string; item_ata_id: string; uasg_aderente: string; quantidade: number; quantidade_registrada: number; vigencia_inicio: string; vigencia_fim: string; aceita_adesao: boolean }>(
        `SELECT ad.id, ad.processo_id, a.uasg AS ata_uasg, ad.situacao, ad.item_ata_id, ad.uasg_aderente, ad.quantidade, i.quantidade_registrada,
                a.vigencia_inicio, a.vigencia_fim, a.aceita_adesao
           FROM atas_adesoes ad JOIN atas a ON a.id = ad.ata_id JOIN itens_ata i ON i.id = ad.item_ata_id
          WHERE ad.id = $1 FOR UPDATE OF ad`,
        [id],
      );
      // Só o gerenciador da ata (UASG no escopo de quem decide) dá a anuência; fora do escopo → 404.
      if (!adesao || !podeVerUasg(sessao, adesao.ata_uasg)) throw naoEncontrado('Adesão não encontrada.');
      processoId = adesao.processo_id;
      if (adesao.situacao !== 'aceita_fornecedor') throw regraNegocio('A anuência só vem depois do aceite do fornecedor (Decreto 11.462/2023, art. 31, § 1º).');
      if (e.decisao === 'recusada' && (e.motivo ?? '').length < MINIMO_CARACTERES_TEXTO) throw regraNegocio(`Registre o motivo da recusa (mínimo de ${MINIMO_CARACTERES_TEXTO} caracteres).`);
      if (e.decisao === 'autorizada') {
        const aderidas = await quantidadesAderidas(tx, adesao.item_ata_id, adesao.uasg_aderente, adesao.id);
        const avaliacao = avaliarAdesaoAta({
          quantidadeRegistrada: adesao.quantidade_registrada,
          quantidadeAderidaPeloOrgao: aderidas.orgao,
          quantidadeAderidaTotal: aderidas.total,
          quantidadeSolicitada: adesao.quantidade,
          ataVigente: hoje >= adesao.vigencia_inicio && hoje <= adesao.vigencia_fim,
          ataAceitaAdesao: adesao.aceita_adesao,
          esferaGerenciador: 'federal',
          esferaAderente: 'federal',
          aderenteParticipante: adesao.ata_uasg === adesao.uasg_aderente,
        });
        if (!avaliacao.permitida) throw regraNegocio('A adesão não cabe mais nos limites do art. 86.', avaliacao.recusas.map((m) => ({ campo: 'RF-34', mensagem: m })));
      }
      await tx.executar(
        `UPDATE atas_adesoes SET situacao = $2, anuencia_em = $3, anuencia_por = $4, motivo_recusa = $5 WHERE id = $1`,
        [adesao.id, e.decisao, e.decisao === 'autorizada' ? hoje : null, e.decisao === 'autorizada' ? sessao.usuario.id : null, e.decisao === 'recusada' ? e.motivo : null],
      );
      await auditar(tx, request, {
        acao: `ata.adesao.${e.decisao === 'autorizada' ? 'anuir' : 'recusar'}`,
        recurso: 'processo',
        recursoId: adesao.processo_id,
        resumo: e.decisao === 'autorizada' ? 'O gerenciador da ata deu anuência à adesão (art. 86, § 2º, III)' : 'O gerenciador da ata recusou a adesão',
        dados: { adesaoId: adesao.id, decisao: e.decisao, quantidade: adesao.quantidade },
      });
    });
    const linha = await obterLinhaProcesso(ctx.banco, processoId, null);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    const rota = await montarRotaProcesso(ctx.banco, linha, hoje, await opcoesCalendario(ctx.banco));
    return rota.adesao;
  });
}
