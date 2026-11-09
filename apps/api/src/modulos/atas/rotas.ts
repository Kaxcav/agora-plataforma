import type { AtaAMontar, AtaResumo, Pagina } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listarHistorico } from '../../auditoria/historico.ts';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { uasgDe } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { naoEncontrado } from '../../http/erros.ts';
import {
  camposPaginacao,
  codigoUasg,
  deslocamento,
  idDaRota,
  ordemQuery,
  ordenarPor,
  pagina,
  paginarEmMemoria,
  textoBusca,
} from '../../http/validacao.ts';
import { carregarProveniencias, provenienciaDe } from '../../integracoes/servico.ts';
import { listarContratos } from '../contratos/repositorio.ts';
import { mascararContratosSigilosos } from '../sigilo/acesso.ts';
import { tarefasDoInstrumento } from '../tarefas/repositorio.ts';
import { itensDaAta, listarAtas, montarAtaDetalhe, montarInfoReajuste, obterAtaBase } from './repositorio.ts';

const PESO_CRITICIDADE = { alta: 0, media: 1, baixa: 2 } as const;

const CHAVES_ORDENACAO = {
  vigenciaFim: (a: AtaResumo) => a.vigenciaFim,
  diasRestantes: (a: AtaResumo) => a.diasRestantes,
  numero: (a: AtaResumo) => a.numero,
  objeto: (a: AtaResumo) => a.objeto.toLocaleLowerCase('pt-BR'),
  valorRegistrado: (a: AtaResumo) => a.valorRegistrado,
  percentualConsumido: (a: AtaResumo) => a.percentualConsumido,
  criticidade: (a: AtaResumo) => PESO_CRITICIDADE[a.criticidade],
  uasg: (a: AtaResumo) => a.uasgGerenciadora.codigo,
} as const;

const esquemaFiltro = z.object({
  busca: textoBusca,
  situacao: z.enum(['vigente', 'a_vencer', 'encerrado']).optional(),
  criticidade: z.enum(['alta', 'media', 'baixa']).optional(),
  uasg: codigoUasg.optional(),
  gestor: z.enum(['eu', 'todos']).optional(),
  ordenarPor: z
    .enum(['vigenciaFim', 'diasRestantes', 'numero', 'objeto', 'valorRegistrado', 'percentualConsumido', 'criticidade', 'uasg'])
    .optional(),
  ordem: ordemQuery,
  ...camposPaginacao,
});

const esquemaAMontar = z.object({ busca: textoBusca, uasg: codigoUasg.optional(), ...camposPaginacao });

interface LinhaAMontar {
  id: string;
  numero_compra: string;
  modalidade: string;
  uasg: string;
  uasg_nome: string;
  uasg_sigla: string;
  uasg_uf: string;
  objeto: string;
  homologada_em: string;
  quantidade_itens: number;
  valor_homologado: number;
  id_pncp: string;
}

export async function rotasAtas(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('atas:ler') };

  app.get('/atas', leitura, async (request): Promise<Pagina<AtaResumo>> => {
    const f = esquemaFiltro.parse(request.query);
    const sessao = sessaoDe(request);
    const atas = await listarAtas(
      ctx.banco,
      { escopo: escopoUasgs(sessao), busca: f.busca, uasg: f.uasg, gestorId: f.gestor === 'eu' ? sessao.usuario.id : undefined },
      ctx.hoje(),
    );
    const filtradas = atas.filter(
      (a) => (!f.situacao || a.situacao === f.situacao) && (!f.criticidade || a.criticidade === f.criticidade),
    );
    const ordenadas = ordenarPor(filtradas, CHAVES_ORDENACAO[f.ordenarPor ?? 'vigenciaFim'], f.ordem ?? 'asc');
    return paginarEmMemoria(ordenadas, f.pagina, f.tamanhoPagina);
  });

  app.get('/atas/a-montar', leitura, async (request): Promise<Pagina<AtaAMontar>> => {
    const f = esquemaAMontar.parse(request.query);
    const escopo = escopoUasgs(sessaoDe(request));
    const parametros = [escopo, f.busca ? padraoContem(f.busca) : null, f.uasg ?? null] as const;
    const condicoes = `
      WHERE NOT m.montada
        AND ($1::text[] IS NULL OR m.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR m.busca_normalizada LIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR m.uasg = $3)`;
    const linhas = await ctx.banco.consultar<LinhaAMontar>(
      `SELECT m.id, m.numero_compra, m.modalidade, m.uasg, u.nome AS uasg_nome, u.sigla AS uasg_sigla, u.uf AS uasg_uf,
              m.objeto, m.homologada_em, m.quantidade_itens, m.valor_homologado, m.id_pncp
         FROM atas_a_montar m
         JOIN uasgs u ON u.codigo = m.uasg
       ${condicoes}
        ORDER BY m.homologada_em DESC, m.numero_compra
        LIMIT $4 OFFSET $5`,
      [...parametros, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina)],
    );
    const [contagem] = await ctx.banco.consultar<{ total: number }>(
      `SELECT COUNT(*)::integer AS total FROM atas_a_montar m ${condicoes}`,
      [...parametros],
    );
    return pagina(
      linhas.map((l) => ({
        id: l.id,
        numeroCompra: l.numero_compra,
        modalidade: l.modalidade,
        uasg: uasgDe(l.uasg, l.uasg_nome, l.uasg_sigla, l.uasg_uf),
        objeto: l.objeto,
        homologadaEm: l.homologada_em,
        quantidadeItens: l.quantidade_itens,
        valorHomologado: l.valor_homologado,
        idPncp: l.id_pncp,
      })),
      contagem?.total ?? 0,
      f.pagina,
      f.tamanhoPagina,
    );
  });

  /** Carrega a ata no escopo do usuário; fora do escopo responde 404 (não revela existência). */
  async function ataVisivel(request: Parameters<typeof sessaoDe>[0]) {
    const id = idDaRota(request.params);
    const base = await obterAtaBase(ctx.banco, id, escopoUasgs(sessaoDe(request)), ctx.hoje());
    if (!base) throw naoEncontrado('Ata não encontrada.');
    return base;
  }

  app.get('/atas/:id', leitura, async (request) => {
    const base = await ataVisivel(request);
    const agora = ctx.relogio();
    const proveniencia = provenienciaDe(await carregarProveniencias(ctx.banco, agora), base.fonte_dados, agora);
    return montarAtaDetalhe(ctx.banco, base, ctx.hoje(), proveniencia);
  });

  app.get('/atas/:id/itens', leitura, async (request) => {
    const base = await ataVisivel(request);
    return itensDaAta(ctx.banco, base.resumo.id);
  });

  app.get('/atas/:id/contratos', leitura, async (request) => {
    const base = await ataVisivel(request);
    const sessao = sessaoDe(request);
    const contratos = await listarContratos(ctx.banco, { escopo: escopoUasgs(sessao), ataId: base.resumo.id }, ctx.hoje());
    return mascararContratosSigilosos(ctx.banco, sessao, ctx.hoje(), contratos);
  });

  app.get('/atas/:id/tarefas', leitura, async (request) => {
    const base = await ataVisivel(request);
    return tarefasDoInstrumento(ctx.banco, 'ata', base.resumo.id, ctx.hoje());
  });

  app.get('/atas/:id/reajuste', leitura, async (request) => {
    const base = await ataVisivel(request);
    return montarInfoReajuste(ctx.banco, base);
  });

  app.get('/atas/:id/historico', leitura, async (request) => {
    const base = await ataVisivel(request);
    return listarHistorico(ctx.banco, 'ata', base.resumo.id);
  });
}
