import { avaliarAditivo } from '@agora/dominio';
import type { Aditivo, ContratoResumo, ItemContrato, Pagina, ResultadoSimulacaoAditivo } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { listarHistorico } from '../../auditoria/historico.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { naoEncontrado } from '../../http/erros.ts';
import {
  booleanoQuery,
  camposPaginacao,
  centavos,
  codigoUasg,
  idDaRota,
  ordemQuery,
  ordenarPor,
  paginarEmMemoria,
  textoBusca,
} from '../../http/validacao.ts';
import { carregarProveniencias, provenienciaDe } from '../../integracoes/servico.ts';
import { empenhosDoContrato, listarPagamentos } from '../financeiro/repositorio.ts';
import { avaliarRegularidade } from '../fornecedores/repositorio.ts';
import { tarefasDoInstrumento } from '../tarefas/repositorio.ts';
import { listarContratos, montarContratoDetalhe, obterContratoDetalheBase } from './repositorio.ts';

const CHAVES_ORDENACAO = {
  vigenciaFim: (c: ContratoResumo) => c.vigenciaFim,
  diasRestantes: (c: ContratoResumo) => c.diasRestantes,
  numero: (c: ContratoResumo) => c.numero,
  objeto: (c: ContratoResumo) => c.objeto.toLocaleLowerCase('pt-BR'),
  fornecedor: (c: ContratoResumo) => c.fornecedor.razaoSocial.toLocaleLowerCase('pt-BR'),
  uasg: (c: ContratoResumo) => c.uasg.codigo,
  valorGlobal: (c: ContratoResumo) => c.valorGlobal,
  percentualExecutado: (c: ContratoResumo) => c.percentualExecutado,
  pendenciasAbertas: (c: ContratoResumo) => c.pendenciasAbertas,
} as const;

const esquemaFiltro = z.object({
  busca: textoBusca,
  situacao: z.enum(['vigente', 'a_vencer', 'encerrado']).optional(),
  uasg: codigoUasg.optional(),
  gestor: z.enum(['eu', 'todos']).optional(),
  semAta: booleanoQuery.optional(),
  ordenarPor: z
    .enum(['vigenciaFim', 'diasRestantes', 'numero', 'objeto', 'fornecedor', 'uasg', 'valorGlobal', 'percentualExecutado', 'pendenciasAbertas'])
    .optional(),
  ordem: ordemQuery,
  ...camposPaginacao,
});

const esquemaSimulacao = z.object({
  tipo: z.enum(['acrescimo', 'supressao']),
  valor: centavos.positive(),
  reformaEdificioOuEquipamento: z.boolean().optional(),
});

interface LinhaItemContrato {
  id: string;
  numero: number;
  descricao: string;
  unidade_fornecimento: string;
  quantidade: number;
  valor_unitario: number;
  quantidade_empenhada: number;
  quantidade_recebida: number;
}

interface LinhaAditivo {
  id: string;
  numero: string;
  tipo: Aditivo['tipo'];
  valor: number;
  nova_vigencia_fim: string | null;
  assinado_em: string;
  justificativa: string;
}

export async function rotasContratos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('contratos:ler') };

  app.get('/contratos', leitura, async (request): Promise<Pagina<ContratoResumo>> => {
    const f = esquemaFiltro.parse(request.query);
    const sessao = sessaoDe(request);
    const contratos = await listarContratos(
      ctx.banco,
      {
        escopo: escopoUasgs(sessao),
        busca: f.busca,
        uasg: f.uasg,
        gestorId: f.gestor === 'eu' ? sessao.usuario.id : undefined,
        semAta: f.semAta,
      },
      ctx.hoje(),
    );
    const filtrados = f.situacao ? contratos.filter((c) => c.situacao === f.situacao) : contratos;
    const ordenados = ordenarPor(filtrados, CHAVES_ORDENACAO[f.ordenarPor ?? 'vigenciaFim'], f.ordem ?? 'asc');
    return paginarEmMemoria(ordenados, f.pagina, f.tamanhoPagina);
  });

  /** Contrato no escopo do usuário; fora do escopo responde 404. */
  async function contratoVisivel(request: FastifyRequest) {
    const id = idDaRota(request.params);
    const base = await obterContratoDetalheBase(ctx.banco, id, escopoUasgs(sessaoDe(request)), ctx.hoje());
    if (!base) throw naoEncontrado('Contrato não encontrado.');
    return base;
  }

  app.get('/contratos/:id', leitura, async (request) => {
    const base = await contratoVisivel(request);
    const agora = ctx.relogio();
    const proveniencia = provenienciaDe(await carregarProveniencias(ctx.banco, agora), base.fonte_dados, agora);
    return montarContratoDetalhe(ctx.banco, base, ctx.hoje(), await opcoesCalendario(ctx.banco), proveniencia);
  });

  app.get('/contratos/:id/itens', leitura, async (request): Promise<ItemContrato[]> => {
    const base = await contratoVisivel(request);
    const linhas = await ctx.banco.consultar<LinhaItemContrato>(
      `SELECT ic.id, ic.numero, ic.descricao, ic.unidade_fornecimento, ic.quantidade, ic.valor_unitario,
              s.quantidade_empenhada, ic.quantidade_recebida
         FROM itens_contrato ic
         JOIN vw_itens_contrato_saldos s ON s.item_contrato_id = ic.id
        WHERE ic.contrato_id = $1
        ORDER BY ic.numero`,
      [base.resumo.id],
    );
    return linhas.map((l) => ({
      id: l.id,
      numero: l.numero,
      descricao: l.descricao,
      unidadeFornecimento: l.unidade_fornecimento,
      quantidade: l.quantidade,
      valorUnitario: l.valor_unitario,
      valorTotal: l.quantidade * l.valor_unitario,
      quantidadeEmpenhada: l.quantidade_empenhada,
      quantidadeRecebida: l.quantidade_recebida,
    }));
  });

  app.get('/contratos/:id/empenhos', leitura, async (request) => {
    const base = await contratoVisivel(request);
    return empenhosDoContrato(ctx.banco, base.resumo.id);
  });

  app.get('/contratos/:id/pagamentos', leitura, async (request) => {
    const base = await contratoVisivel(request);
    const { itens } = await listarPagamentos(ctx.banco, { escopo: null, contratoId: base.resumo.id }, ctx.hoje(), 1000, 0);
    return itens;
  });

  app.get('/contratos/:id/tarefas', leitura, async (request) => {
    const base = await contratoVisivel(request);
    return tarefasDoInstrumento(ctx.banco, 'contrato', base.resumo.id, ctx.hoje());
  });

  app.get('/contratos/:id/historico', leitura, async (request) => {
    const base = await contratoVisivel(request);
    return listarHistorico(ctx.banco, 'contrato', base.resumo.id);
  });

  app.get('/contratos/:id/aditivos', leitura, async (request): Promise<Aditivo[]> => {
    const base = await contratoVisivel(request);
    const linhas = await ctx.banco.consultar<LinhaAditivo>(
      `SELECT id, numero, tipo, valor, nova_vigencia_fim, assinado_em, justificativa
         FROM aditivos WHERE contrato_id = $1 ORDER BY assinado_em, numero`,
      [base.resumo.id],
    );
    return linhas.map((l) => ({
      id: l.id,
      numero: l.numero,
      tipo: l.tipo,
      valor: l.valor,
      novaVigenciaFim: l.nova_vigencia_fim,
      assinadoEm: l.assinado_em,
      justificativa: l.justificativa,
    }));
  });

  /** Simulação de aditivo (somente leitura): limites do art. 125 por @agora/dominio + regularidade (RN-09). */
  app.post('/contratos/:id/aditivos/simular', leitura, async (request): Promise<ResultadoSimulacaoAditivo> => {
    const base = await contratoVisivel(request);
    const entrada = esquemaSimulacao.parse(request.body);
    const avaliacao = avaliarAditivo({
      valorInicialAtualizado: base.valor_inicial + base.reajustes,
      acrescimosAnteriores: base.acrescimos,
      supressoesAnteriores: base.supressoes,
      tipo: entrada.tipo,
      valor: entrada.valor,
      reformaEdificioOuEquipamento: entrada.reformaEdificioOuEquipamento ?? false,
    });
    const regularidade = await avaliarRegularidade(ctx.banco, base.fornecedor_id, ctx.hoje(), ctx.relogio());
    return {
      percentualAcumulado: avaliacao.percentualAcumulado,
      limitePercentual: avaliacao.limitePercentual,
      permitido: avaliacao.permitido,
      margemRestante: avaliacao.margemRestante,
      explicacao: avaliacao.explicacao,
      fundamento: avaliacao.fundamento,
      regularidadeFornecedor: { regular: regularidade.regular, motivos: regularidade.motivos },
    };
  });
}
