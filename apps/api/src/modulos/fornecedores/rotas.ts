import type { FornecedorDetalhe, FornecedorResumo, Pagina } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { naoEncontrado } from '../../http/erros.ts';
import { booleanoQuery, camposPaginacao, idDaRota, ordemQuery, ordenarPor, paginarEmMemoria, textoBusca } from '../../http/validacao.ts';
import { listarContratos } from '../contratos/repositorio.ts';
import { mascararContratosSigilosos } from '../sigilo/acesso.ts';
import { listarSancoes } from '../sancoes/repositorio.ts';
import { avaliarRegularidade, carregarFornecedor, carregarFornecedores } from './repositorio.ts';

const esquemaFiltro = z.object({
  busca: textoBusca,
  faixa: z.enum(['diamante', 'ouro', 'prata', 'em_observacao', 'critico', 'sem_historico']).optional(),
  comSancao: booleanoQuery.optional(),
  ordenarPor: z.enum(['razaoSocial', 'idc', 'sancoesVigentes', 'uf']).optional(),
  ordem: ordemQuery,
  ...camposPaginacao,
});

const CHAVES_ORDENACAO = {
  razaoSocial: (f: FornecedorResumo) => f.razaoSocial.toLocaleLowerCase('pt-BR'),
  idc: (f: FornecedorResumo) => f.idc?.nota ?? -1,
  sancoesVigentes: (f: FornecedorResumo) => f.sancoesVigentes,
  uf: (f: FornecedorResumo) => f.uf ?? '',
} as const;

export async function rotasFornecedores(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('fornecedores:ler') };

  app.get('/fornecedores', leitura, async (request): Promise<Pagina<FornecedorResumo>> => {
    const f = esquemaFiltro.parse(request.query);
    const hoje = ctx.hoje();
    const ids = await ctx.banco.consultar<{ id: string }>(
      `SELECT fo.id FROM fornecedores fo
        WHERE ($1::text IS NULL OR fo.busca_normalizada LIKE $1 ESCAPE '\\')
          AND ($2::boolean IS NULL
               OR $2 = EXISTS (SELECT 1 FROM sancoes s WHERE s.fornecedor_id = fo.id AND s.situacao = 'aplicada'))`,
      [f.busca ? padraoContem(f.busca) : null, f.comSancao ?? null],
    );
    const mapa = await carregarFornecedores(
      ctx.banco,
      ids.map((i) => i.id),
      hoje,
    );
    const resumos = [...mapa.values()].map((c) => c.resumo).filter((r) => !f.faixa || r.idc?.faixa === f.faixa);
    const ordenados = ordenarPor(resumos, CHAVES_ORDENACAO[f.ordenarPor ?? 'razaoSocial'], f.ordem ?? 'asc');
    return paginarEmMemoria(ordenados, f.pagina, f.tamanhoPagina);
  });

  app.get('/fornecedores/:id', leitura, async (request): Promise<FornecedorDetalhe> => {
    const id = idDaRota(request.params);
    const hoje = ctx.hoje();
    const fornecedor = await carregarFornecedor(ctx.banco, id, hoje);
    if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
    const escopo = escopoUasgs(sessaoDe(request));
    const { idc } = fornecedor;
    const sancoes = await listarSancoes(ctx.banco, { escopo, fornecedorId: id }, 500, 0);
    return {
      ...fornecedor.resumo,
      idcDetalhe: {
        nota: idc.nota,
        faixa: idc.faixa,
        semHistorico: idc.semHistorico,
        componentes: idc.componentes,
        penalidades: idc.penalidades,
        metodologia: idc.metodologia,
        fundamento: idc.fundamento,
        aviso: idc.aviso,
      },
      contratos: await mascararContratosSigilosos(ctx.banco, sessaoDe(request), hoje, await listarContratos(ctx.banco, { escopo, fornecedorId: id }, hoje)),
      sancoes: sancoes.itens,
      regularidade: await avaliarRegularidade(ctx.banco, id, hoje, ctx.relogio()),
    };
  });
}
