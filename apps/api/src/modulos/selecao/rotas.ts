/**
 * Atos da seleção do fornecedor (etapa 6 da jornada): prova de conceito ou amostra (RN-20), habilitação, fase
 * recursal única (RN-22), adjudicação e homologação com a divulgação dos documentos preparatórios (RF-18).
 *
 * A ordem e os prazos dos atos são decididos por @agora/dominio (`validarAtoSelecao`), no servidor; cada ato é uma
 * escrita transacional com evento na trilha de auditoria. Os atos da autoridade superior (decisão do recurso,
 * adjudicação e homologação) exigem a permissão `jornada:homologar` e a designação como autoridade competente no
 * processo (art. 71; segregação do art. 7º, § 1º). Aprovar ou reprovar, habilitar e decidir são sempre atos humanos.
 */
import {
  avaliarSelecao,
  formatarData,
  prazoProvaConceito,
  rotuloExigenciaProvaConceito,
  validarAtoSelecao,
  type AtoSelecao,
  type AvaliacaoSelecao,
  type EfeitoReforma,
} from '@agora/dominio';
import type { ProcessoDetalhe } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DadosEvento } from '../../auditoria/trilha.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, semPermissao } from '../../http/erros.ts';
import { idDaRota, uuid } from '../../http/validacao.ts';
import { obterLinhaProcesso, obterProcessoDetalhe } from '../jornada/repositorio.ts';
import { editalCompleto, estadoSelecao, selecaoCompleta } from '../jornada/selecao.ts';
import { exigirEtapa, gravarJson } from '../jornada/servico.ts';
import type { AutorAto, LinhaProcesso, RecursoArmazenado, SelecaoArmazenada } from '../jornada/tipos.ts';

// ───────────────────────── esquemas ─────────────────────────

const motivacao = z.string().trim().min(30, 'A motivação precisa de pelo menos 30 caracteres.').max(5000);
const motivacaoOpcional = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));
const idFornecedor = uuid.transform((v) => v.toLowerCase());

/** Endereço http(s) da gravação da sessão pública; outros esquemas (javascript:, data:) são recusados. */
const linkGravacao = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Informe o endereço (http ou https) da gravação da sessão pública.');

const esquemaResultadoProva = z
  .object({ resultado: z.enum(['aprovado', 'reprovado']), motivacao, linkGravacao })
  .refine((e) => e.resultado === 'reprovado' || e.linkGravacao !== null, {
    message: 'Informe o link da gravação da sessão pública em que a prova foi realizada.',
    path: ['linkGravacao'],
  });

const esquemaHabilitacao = z.object({ resultado: z.enum(['habilitado', 'inabilitado']), motivacao });

const esquemaManifestacao = z.object({
  tipo: z.enum(['intencao', 'razoes', 'contrarrazoes']),
  fornecedorId: idFornecedor,
  texto: z.string().trim().min(10, 'Resuma a manifestação em pelo menos 10 caracteres.').max(5000),
});

const esquemaEfeito = z
  .discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('desclassificar_vencedor') }),
    z.object({ tipo: z.literal('reintegrar_licitante'), fornecedorId: idFornecedor }),
  ])
  .nullable()
  .optional()
  .transform((v): EfeitoReforma | null => v ?? null);

function esquemaDecisao<const D extends readonly [string, string]>(decisoes: D, reforma: D[0]) {
  return z
    .object({ decisao: z.enum(decisoes), motivacao, efeito: esquemaEfeito })
    .refine((e) => (e.decisao === reforma) === (e.efeito !== null), {
      message: 'Indique o efeito da reforma do ato (desclassificar o vencedor ou reintegrar licitante) somente quando o ato for reformado.',
      path: ['efeito'],
    });
}

const esquemaReconsideracao = esquemaDecisao(['reconsiderada', 'mantida'] as const, 'reconsiderada');
const esquemaDecisaoSuperior = esquemaDecisao(['provido', 'nao_provido'] as const, 'provido');
const esquemaAtoAutoridade = z.object({ motivacao: motivacaoOpcional }).optional();

// ───────────────────────── apoio ─────────────────────────

interface EventoSelecao {
  acao: string;
  resumo: string;
  dados?: DadosEvento;
}

interface ContextoAto {
  hoje: string;
  agora: Date;
  calendario: Awaited<ReturnType<typeof opcoesCalendario>>;
  autor: AutorAto;
}

function nomeLicitante(linha: LinhaProcesso, fornecedorId: string | null): string {
  return linha.disputa.licitantes.find((l) => l.fornecedorId === fornecedorId)?.nome ?? 'licitante';
}

/** Recurso do vencedor provisório (cria o registro na abertura da fase recursal). */
function recursoDoVencedor(s: Required<SelecaoArmazenada>, avaliacao: AvaliacaoSelecao): RecursoArmazenado {
  const vencedor = avaliacao.vencedorProvisorio;
  if (vencedor === null || avaliacao.faseRecursal === null) throw new Error('Fase recursal sem vencedor provisório');
  const existente = s.recursos.filter((r) => r.vencedorId === vencedor).at(-1);
  if (existente) return existente;
  const novo: RecursoArmazenado = {
    vencedorId: vencedor,
    dataAto: avaliacao.faseRecursal.dataAto,
    intencoes: [],
    intencaoEncerradaEm: null,
    razoes: [],
    contrarrazoes: [],
    reconsideracao: null,
    decisaoSuperior: null,
  };
  s.recursos.push(novo);
  return novo;
}

/**
 * RN-20: depois de reprovação, inabilitação ou reforma em recurso, o próximo colocado é convocado automaticamente
 * para a prova de conceito ou a amostra, com o prazo do edital contado da data de hoje.
 */
function convocarProximoSeNecessario(linha: LinhaProcesso, s: Required<SelecaoArmazenada>, c: ContextoAto): { fornecedorId: string; limite: string } | null {
  const estado = estadoSelecao({ disputa: linha.disputa, edital: linha.edital, selecao: s });
  const avaliacao = avaliarSelecao(estado, c.hoje, c.calendario);
  if (!avaliacao.convocacaoAutomatica || avaliacao.vencedorProvisorio === null) return null;
  const prazo = editalCompleto(linha.edital).provaConceito.prazoDiasUteis ?? 1;
  const limite = prazoProvaConceito(c.hoje, prazo, c.calendario).limite;
  s.convocacoes.push({
    fornecedorId: avaliacao.vencedorProvisorio,
    convocadoEm: c.hoje,
    limite,
    convocacaoAutomatica: true,
    resultado: null,
    realizadaEm: null,
    motivacao: null,
    linkGravacao: null,
    por: c.autor,
    registradoPor: null,
  });
  return { fornecedorId: avaliacao.vencedorProvisorio, limite };
}

function textoConvocacaoAutomatica(linha: LinhaProcesso, convocado: { fornecedorId: string; limite: string } | null): string {
  if (!convocado) return '';
  const rotulo = rotuloExigenciaProvaConceito(editalCompleto(linha.edital).provaConceito.exigencia);
  return `; convocou automaticamente ${nomeLicitante(linha, convocado.fornecedorId)} para a ${rotulo}, com prazo até ${formatarData(convocado.limite)}`;
}

export async function rotasSelecao(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const edicao = { preHandler: exigir('jornada:editar') };
  const autoridade = { preHandler: exigir('jornada:homologar') };

  /**
   * Ato da seleção: trava o processo (escopo de UASG → 404), confere a etapa e a ordem do ato (`validarAtoSelecao`),
   * grava a coluna `selecao` e registra os eventos na trilha, numa transação.
   */
  async function praticar(
    request: FastifyRequest,
    ato: AtoSelecao,
    opcoes: { exigeAutoridade?: boolean },
    executar: (s: Required<SelecaoArmazenada>, linha: LinhaProcesso, avaliacao: AvaliacaoSelecao, c: ContextoAto, tx: Transacao) => Promise<EventoSelecao[]> | EventoSelecao[],
  ): Promise<ProcessoDetalhe> {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const c: ContextoAto = {
      hoje: ctx.hoje(),
      agora: ctx.relogio(),
      calendario: await opcoesCalendario(ctx.banco),
      autor: { id: sessao.usuario.id, nome: sessao.usuario.nome },
    };
    await ctx.banco.transacao(async (tx) => {
      const linha = await obterLinhaProcesso(tx, id, escopo, true);
      if (!linha) throw naoEncontrado('Processo não encontrado.');
      exigirEtapa(linha, 6, 'O registro dos atos da seleção');
      if (opcoes.exigeAutoridade) {
        const [designado] = await tx.consultar<{ ok: number }>(
          `SELECT 1 AS ok FROM processos_equipe WHERE processo_id = $1 AND papel = 'autoridade_competente' AND usuario_id = $2`,
          [linha.id, sessao.usuario.id],
        );
        if (!designado) throw semPermissao('Somente a autoridade competente designada na equipe do processo pratica este ato (art. 71).');
      }
      const s = selecaoCompleta(linha.selecao);
      const avaliacao = validarAtoSelecao(estadoSelecao(linha), ato, c.hoje, c.calendario);
      const eventos = await executar(s, linha, avaliacao, c, tx);
      await gravarJson(tx, linha.id, 'selecao', s, c.agora);
      for (const evento of eventos) {
        await auditar(tx, request, {
          acao: `processo.selecao.${evento.acao}`,
          recurso: 'processo',
          recursoId: linha.id,
          resumo: evento.resumo,
          dados: { numeroSei: linha.numero_sei, etapa: linha.etapa_atual, ...evento.dados },
        });
      }
    });
    const detalhe = await obterProcessoDetalhe(ctx.banco, id, escopo, c.hoje, c.calendario, c.agora);
    if (!detalhe) throw naoEncontrado('Processo não encontrado.');
    return detalhe;
  }

  // ───────── prova de conceito ou amostra (RN-20) ─────────

  app.post('/processos/:id/selecao/prova-conceito/convocacao', edicao, async (request) =>
    praticar(request, { tipo: 'convocar_prova_conceito' }, {}, (s, linha, avaliacao, c) => {
      const vencedor = avaliacao.vencedorProvisorio ?? '';
      const { provaConceito } = editalCompleto(linha.edital);
      const limite = prazoProvaConceito(c.hoje, provaConceito.prazoDiasUteis ?? 1, c.calendario).limite;
      s.convocacoes.push({
        fornecedorId: vencedor,
        convocadoEm: c.hoje,
        limite,
        convocacaoAutomatica: false,
        resultado: null,
        realizadaEm: null,
        motivacao: null,
        linkGravacao: null,
        por: c.autor,
        registradoPor: null,
      });
      return [
        {
          acao: 'prova_conceito.convocar',
          resumo: `Convocou ${nomeLicitante(linha, vencedor)} para a ${rotuloExigenciaProvaConceito(provaConceito.exigencia)}, com prazo até ${formatarData(limite)}`,
          dados: { fornecedorId: vencedor, convocadoEm: c.hoje, limite, prazoDiasUteis: provaConceito.prazoDiasUteis, fundamento: 'Lei 14.133/2021, art. 17, § 3º' },
        },
      ];
    }),
  );

  app.post('/processos/:id/selecao/prova-conceito/resultado', edicao, async (request) => {
    const entrada = esquemaResultadoProva.parse(request.body);
    return praticar(request, { tipo: 'registrar_resultado_prova_conceito' }, {}, (s, linha, avaliacao, c) => {
      const vencedor = avaliacao.vencedorProvisorio ?? '';
      const convocacao = s.convocacoes.filter((x) => x.fornecedorId === vencedor && x.resultado === null).at(-1);
      if (!convocacao) throw naoEncontrado('Convocação em aberto não encontrada.');
      convocacao.resultado = entrada.resultado;
      convocacao.realizadaEm = c.hoje;
      convocacao.motivacao = entrada.motivacao;
      convocacao.linkGravacao = entrada.linkGravacao;
      convocacao.registradoPor = c.autor;
      const convocado = entrada.resultado === 'reprovado' ? convocarProximoSeNecessario(linha, s, c) : null;
      const rotulo = rotuloExigenciaProvaConceito(editalCompleto(linha.edital).provaConceito.exigencia);
      return [
        {
          acao: 'prova_conceito.resultado',
          resumo: `Registrou a ${rotulo} de ${nomeLicitante(linha, vencedor)}: ${entrada.resultado}${textoConvocacaoAutomatica(linha, convocado)}`,
          dados: {
            fornecedorId: vencedor,
            resultado: entrada.resultado,
            dentroDoPrazo: c.hoje <= convocacao.limite,
            linkGravacao: entrada.linkGravacao,
            convocadoAutomaticamente: convocado?.fornecedorId ?? null,
            fundamento: 'Lei 14.133/2021, art. 17, § 3º, e art. 41, II',
          },
        },
      ];
    });
  });

  // ───────── habilitação ─────────

  app.post('/processos/:id/selecao/habilitacao', edicao, async (request) => {
    const entrada = esquemaHabilitacao.parse(request.body);
    return praticar(request, { tipo: 'registrar_habilitacao', resultado: entrada.resultado }, {}, (s, linha, avaliacao, c) => {
      const vencedor = avaliacao.vencedorProvisorio ?? '';
      s.habilitacoes.push({ fornecedorId: vencedor, resultado: entrada.resultado, data: c.hoje, motivacao: entrada.motivacao, por: c.autor });
      const convocado = entrada.resultado === 'inabilitado' ? convocarProximoSeNecessario(linha, s, c) : null;
      return [
        {
          acao: 'habilitacao.registrar',
          resumo: `Registrou a habilitação de ${nomeLicitante(linha, vencedor)}: ${entrada.resultado}${textoConvocacaoAutomatica(linha, convocado)}`,
          dados: { fornecedorId: vencedor, resultado: entrada.resultado, data: c.hoje, convocadoAutomaticamente: convocado?.fornecedorId ?? null, fundamento: 'Lei 14.133/2021, arts. 62 a 70' },
        },
      ];
    });
  });

  // ───────── fase recursal única (RN-22) ─────────

  app.post('/processos/:id/selecao/recurso/manifestacao', edicao, async (request) => {
    const entrada = esquemaManifestacao.parse(request.body);
    const ato: AtoSelecao =
      entrada.tipo === 'intencao'
        ? { tipo: 'registrar_intencao_recurso', fornecedorId: entrada.fornecedorId }
        : entrada.tipo === 'razoes'
          ? { tipo: 'registrar_razoes', fornecedorId: entrada.fornecedorId }
          : { tipo: 'registrar_contrarrazoes', fornecedorId: entrada.fornecedorId };
    return praticar(request, ato, {}, (s, linha, avaliacao, c) => {
      const recurso = recursoDoVencedor(s, avaliacao);
      const manifestacao = { fornecedorId: entrada.fornecedorId, data: c.hoje, texto: entrada.texto };
      const rotulos = { intencao: 'a intenção de recurso', razoes: 'as razões recursais', contrarrazoes: 'as contrarrazões' } as const;
      if (entrada.tipo === 'intencao') recurso.intencoes.push(manifestacao);
      else if (entrada.tipo === 'razoes') recurso.razoes.push(manifestacao);
      else recurso.contrarrazoes.push(manifestacao);
      return [
        {
          acao: `recurso.${entrada.tipo}`,
          resumo: `Registrou ${rotulos[entrada.tipo]} de ${nomeLicitante(linha, entrada.fornecedorId)}`,
          dados: {
            fornecedorId: entrada.fornecedorId,
            vencedorId: recurso.vencedorId,
            dataAto: recurso.dataAto,
            prazos: avaliacao.faseRecursal?.prazos ?? null,
            fundamento: 'Lei 14.133/2021, art. 165',
          },
        },
      ];
    });
  });

  app.post('/processos/:id/selecao/recurso/encerrar-intencao', edicao, async (request) =>
    praticar(request, { tipo: 'encerrar_intencao_recurso' }, {}, (s, _linha, avaliacao, c) => {
      const recurso = recursoDoVencedor(s, avaliacao);
      recurso.intencaoEncerradaEm = c.hoje;
      const quantidade = recurso.intencoes.length;
      return [
        {
          acao: 'recurso.encerrar_intencao',
          resumo:
            quantidade === 0
              ? 'Encerrou o registro de intenções de recurso sem manifestação: preclusão do direito de recorrer'
              : `Encerrou o registro de intenções de recurso com ${quantidade} intenção(ões); razões até ${formatarData(avaliacao.faseRecursal?.prazos.razoes ?? c.hoje)}`,
          dados: { intencoes: quantidade, dataAto: recurso.dataAto, prazos: avaliacao.faseRecursal?.prazos ?? null, fundamento: 'Lei 14.133/2021, art. 165, § 1º, I' },
        },
      ];
    }),
  );

  app.post('/processos/:id/selecao/recurso/reconsideracao', edicao, async (request) => {
    const entrada = esquemaReconsideracao.parse(request.body);
    return praticar(request, { tipo: 'decidir_reconsideracao', efeito: entrada.efeito }, {}, (s, linha, avaliacao, c) => {
      const recurso = recursoDoVencedor(s, avaliacao);
      recurso.reconsideracao = { decisao: entrada.decisao, data: c.hoje, motivacao: entrada.motivacao, efeito: entrada.efeito, por: c.autor };
      const convocado = entrada.decisao === 'reconsiderada' ? convocarProximoSeNecessario(linha, s, c) : null;
      return [
        {
          acao: 'recurso.reconsideracao',
          resumo:
            entrada.decisao === 'reconsiderada'
              ? `Reconsiderou o ato recorrido (${entrada.efeito?.tipo === 'reintegrar_licitante' ? `reintegrou ${nomeLicitante(linha, entrada.efeito.fornecedorId)}` : 'desclassificou o vencedor'})${textoConvocacaoAutomatica(linha, convocado)}`
              : 'Manteve o ato recorrido e encaminhou o recurso à autoridade superior (prazo de 10 dias úteis)',
          dados: { decisao: entrada.decisao, efeito: entrada.efeito, convocadoAutomaticamente: convocado?.fornecedorId ?? null, fundamento: 'Lei 14.133/2021, art. 165, § 2º' },
        },
      ];
    });
  });

  app.post('/processos/:id/selecao/recurso/decisao', autoridade, async (request) => {
    const entrada = esquemaDecisaoSuperior.parse(request.body);
    return praticar(request, { tipo: 'decidir_recurso', efeito: entrada.efeito }, { exigeAutoridade: true }, (s, linha, avaliacao, c) => {
      const recurso = recursoDoVencedor(s, avaliacao);
      recurso.decisaoSuperior = { decisao: entrada.decisao, data: c.hoje, motivacao: entrada.motivacao, efeito: entrada.efeito, por: c.autor };
      const convocado = entrada.decisao === 'provido' ? convocarProximoSeNecessario(linha, s, c) : null;
      const limite = avaliacao.faseRecursal?.prazos.decisaoSuperior ?? null;
      return [
        {
          acao: 'recurso.decisao',
          resumo: `Decidiu o recurso como autoridade superior: ${entrada.decisao === 'provido' ? 'provido' : 'não provido'}${textoConvocacaoAutomatica(linha, convocado)}`,
          dados: {
            decisao: entrada.decisao,
            efeito: entrada.efeito,
            dentroDoPrazo: limite === null ? null : c.hoje <= limite,
            convocadoAutomaticamente: convocado?.fornecedorId ?? null,
            fundamento: 'Lei 14.133/2021, art. 165, § 2º',
          },
        },
      ];
    });
  });

  // ───────── adjudicação e homologação (RF-18) ─────────

  app.post('/processos/:id/selecao/adjudicacao', autoridade, async (request) => {
    const entrada = esquemaAtoAutoridade.parse(request.body ?? {});
    return praticar(request, { tipo: 'adjudicar' }, { exigeAutoridade: true }, (s, linha, avaliacao, c) => {
      const vencedor = avaliacao.vencedorProvisorio ?? '';
      s.adjudicacao = { data: c.hoje, fornecedorId: vencedor, motivacao: entrada?.motivacao ?? null, por: c.autor };
      const proposta = linha.disputa.licitantes.find((l) => l.fornecedorId === vencedor)?.valorProposta ?? null;
      return [
        {
          acao: 'adjudicar',
          resumo: `Adjudicou o objeto a ${nomeLicitante(linha, vencedor)}`,
          dados: { fornecedorId: vencedor, valorProposta: proposta, fundamento: 'Lei 14.133/2021, art. 71, IV' },
        },
      ];
    });
  });

  app.post('/processos/:id/selecao/homologacao', autoridade, async (request) => {
    const entrada = esquemaAtoAutoridade.parse(request.body ?? {});
    return praticar(request, { tipo: 'homologar' }, { exigeAutoridade: true }, async (s, linha, _avaliacao, c, tx) => {
      s.homologacao = { data: c.hoje, fornecedorId: s.adjudicacao?.fornecedorId ?? '', motivacao: entrada?.motivacao ?? null, por: c.autor };
      s.preparatoriosDivulgadosEm = c.agora.toISOString();
      const documentos = await tx.consultar<{ tipo: string; versao: number }>(
        `SELECT DISTINCT ON (tipo) tipo, versao FROM documentos_gerados
          WHERE processo_id = $1 AND situacao = 'aprovado' AND tipo = ANY($2::text[])
          ORDER BY tipo, versao DESC`,
        [linha.id, ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'parecer_checklist']],
      );
      const divulgados = documentos.filter((d) => !(linha.cesta.orcamentoSigiloso && d.tipo === 'nota_tecnica_precos'));
      return [
        {
          acao: 'homologar',
          resumo: `Homologou a licitação adjudicada a ${nomeLicitante(linha, s.adjudicacao?.fornecedorId ?? null)}`,
          dados: { fornecedorId: s.adjudicacao?.fornecedorId ?? null, fundamento: 'Lei 14.133/2021, art. 71, IV' },
        },
        {
          acao: 'divulgar_preparatorios',
          resumo: `Divulgou na página pública do edital ${divulgados.length} documento(s) da fase preparatória`,
          dados: {
            documentos: divulgados.map((d) => ({ tipo: d.tipo, versao: d.versao })),
            naoDivulgados: linha.cesta.orcamentoSigiloso ? ['nota_tecnica_precos (orçamento sigiloso, art. 24)'] : [],
            fundamento: 'Lei 14.133/2021, art. 54, § 3º',
          },
        },
      ];
    });
  });
}
