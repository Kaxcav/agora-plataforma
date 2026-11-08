/**
 * Painel das metas do ETP (RF-39): leitura no escopo de UASG, exportação em CSV e configuração das metas pelo órgão.
 * Também liga o registro dos bloqueios das travas na trilha (`trava.bloqueio`), que alimenta o indicador de erros
 * formais barrados.
 */
import { adicionarDias, diasEntre, ErroDominio, formatarMoeda, validarMetasEtp } from '@agora/dominio';
import type { ConfiguracaoMetasEtp, PainelMetasEtp } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { registrarGravacaoTravas } from '../../compartilhado/travas.ts';
import { auditar } from '../../http/auditar.ts';
import { regraNegocio, validacao } from '../../http/erros.ts';
import { codigoUasg, dataIso } from '../../http/validacao.ts';
import { gerarCsv, type CelulaCsv } from '../itens/csv.ts';
import { gravarMetas, lerMetas } from './configuracao.ts';
import { montarPainelMetas } from './painel.ts';

const PERIODO_PADRAO_DIAS = 365;
const PERIODO_MAXIMO_DIAS = 1830;

const esquemaFiltro = z.object({ uasg: codigoUasg.optional(), de: dataIso.optional(), ate: dataIso.optional() });
const percentual = z.number().gt(0).max(100).nullable();
const dias = z.number().gt(0).max(3650).nullable();
const esquemaMetas = z.object({
  tempoInstrucao: z.object({
    reducaoPercentual: percentual,
    linhaBaseDias: z.object({ '1': dias, '2': dias, '3': dias, '4': dias }),
  }),
  errosFormais: z.object({ mitigacaoPercentual: percentual }),
  economia: z.object({ economiaPercentual: percentual }),
});

function numeroCsv(valor: number | null): CelulaCsv {
  return valor === null ? '' : String(valor).replace('.', ',');
}

function centavosCsv(valor: number | null): CelulaCsv {
  return valor === null ? '' : { centavos: valor };
}

const ROTULO_SITUACAO: Record<PainelMetasEtp['economia']['situacao'], string> = {
  atingida: 'Meta atingida',
  nao_atingida: 'Meta não atingida',
  sem_meta: 'Sem meta configurada',
  sem_dados: 'Sem dados no período',
};

export async function rotasMetasEtp(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('metas:ler') };
  registrarGravacaoTravas(app);

  async function painelDa(request: FastifyRequest): Promise<PainelMetasEtp> {
    const f = esquemaFiltro.parse(request.query);
    const hoje = ctx.hoje();
    const ate = f.ate ?? hoje;
    const de = f.de ?? adicionarDias(ate, -PERIODO_PADRAO_DIAS);
    if (de > ate) throw validacao('O início do período é posterior ao fim.', [{ campo: 'de', mensagem: 'Início posterior ao fim' }]);
    if (diasEntre(de, ate) > PERIODO_MAXIMO_DIAS) throw validacao('O período máximo do painel é de 5 anos.', [{ campo: 'de', mensagem: 'Período acima de 5 anos' }]);
    const metas = await lerMetas(ctx.banco);
    return montarPainelMetas(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)), uasg: f.uasg ?? null, de, ate }, metas, ctx.relogio());
  }

  app.get('/metas-etp', leitura, async (request): Promise<PainelMetasEtp> => painelDa(request));

  app.get('/metas-etp/exportar.csv', leitura, async (request, reply) => {
    const p = await painelDa(request);
    const linhas: CelulaCsv[][] = [
      ...p.tempoInstrucao.etapas.map((e) => [
        'Tempo de instrução',
        `Etapa ${e.etapa} — ${e.titulo}`,
        numeroCsv(e.mediaDias),
        numeroCsv(e.linhaBaseDias),
        numeroCsv(e.alvoDias),
        ROTULO_SITUACAO[e.situacao],
        `${e.processosMedidos} processo(s) medido(s); mediana ${e.medianaDias ?? '—'} dia(s)`,
      ]),
      [
        'Tempo de instrução',
        'Fase preparatória (etapas 1 a 4)',
        numeroCsv(p.tempoInstrucao.fase.mediaDias),
        numeroCsv(p.tempoInstrucao.fase.linhaBaseDias),
        numeroCsv(p.tempoInstrucao.fase.alvoDias),
        ROTULO_SITUACAO[p.tempoInstrucao.fase.situacao],
        `${p.tempoInstrucao.fase.processosMedidos} processo(s) medido(s)`,
      ],
      [
        'Erros formais barrados',
        'Mitigação (%)',
        numeroCsv(p.errosFormais.mitigacaoPercentual),
        '',
        numeroCsv(p.errosFormais.metaPercentual),
        ROTULO_SITUACAO[p.errosFormais.situacao],
        `${p.errosFormais.bloqueios} bloqueio(s) em ${p.errosFormais.processosAfetados} processo(s); ${p.errosFormais.ocorrenciasNaoBarradas} ocorrência(s) não barrada(s)`,
      ],
      ...p.errosFormais.porRegra.map((r) => ['Erros formais barrados', `${r.regra} — ${r.titulo}`, r.bloqueios, '', '', '', 'bloqueios no período']),
      [
        'Economia',
        'Total (%)',
        numeroCsv(p.economia.economiaPercentual),
        '',
        numeroCsv(p.economia.metaPercentual),
        ROTULO_SITUACAO[p.economia.situacao],
        `Estimado ${formatarMoeda(p.economia.totalEstimado)}; contratado ${formatarMoeda(p.economia.totalContratado)}`,
      ],
      ...p.economia.processos.map((e) => [
        'Economia',
        `${e.processo.identificador} (${e.origem === 'contrato' ? 'contrato' : 'homologação'} em ${e.data})`,
        numeroCsv(e.economiaPercentual),
        centavosCsv(e.valorEstimado),
        centavosCsv(e.valorContratado),
        '',
        `Expurgos: ${e.expurgos.descartadas} de ${e.expurgos.cotacoes} cotação(ões); média com descartadas ${e.expurgos.mediaComDescartadas === null ? '—' : formatarMoeda(e.expurgos.mediaComDescartadas)}, sem ${e.expurgos.mediaSemDescartadas === null ? '—' : formatarMoeda(e.expurgos.mediaSemDescartadas)}`,
      ]),
    ];
    const csv = gerarCsv(['Indicador', 'Item', 'Atual', 'Linha de base ou estimado', 'Meta ou alvo', 'Situação', 'Observação'], linhas);
    await ctx.banco.transacao(async (tx) => {
      await auditar(tx, request, {
        acao: 'metas.exportar',
        recurso: 'painel_metas',
        recursoId: null,
        resumo: `Exportou o painel das metas do ETP de ${p.filtro.de.split('-').reverse().join('/')} a ${p.filtro.ate.split('-').reverse().join('/')} (CSV)`,
        dados: { ...p.filtro },
      });
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="metas-etp-agora-${p.filtro.de}-a-${p.filtro.ate}.csv"`)
      .header('cache-control', 'no-store')
      .send(csv);
  });

  app.get('/metas-etp/configuracao', leitura, async (): Promise<ConfiguracaoMetasEtp> => lerMetas(ctx.banco));

  app.put('/metas-etp/configuracao', { preHandler: exigir('metas:configurar') }, async (request): Promise<ConfiguracaoMetasEtp> => {
    const entrada = esquemaMetas.parse(request.body);
    try {
      validarMetasEtp(entrada);
    } catch (erro) {
      if (erro instanceof ErroDominio) throw regraNegocio(erro.message, [{ campo: erro.codigo, mensagem: erro.message }]);
      throw erro;
    }
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      const antes = await lerMetas(tx);
      await gravarMetas(tx, entrada, sessao.usuario.id, ctx.relogio());
      await auditar(tx, request, {
        acao: 'metas.configurar',
        recurso: 'metas_etp',
        recursoId: null,
        resumo: 'Configurou as metas do ETP (tempo de instrução, erros formais e economia)',
        dados: {
          antes: { tempoInstrucao: antes.tempoInstrucao, errosFormais: antes.errosFormais, economia: antes.economia },
          depois: entrada,
        },
      });
    });
    return lerMetas(ctx.banco);
  });
}
