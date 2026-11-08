/**
 * Catálogo de dados abertos (RF-38; Decreto 8.777/2016; Lei 12.527/2011, art. 8º, § 3º; Lei 14.133/2021,
 * art. 174, § 4º): rotas públicas, sem login, com limite de requisições por IP. Cada conjunto sai em CSV e JSON, com
 * dicionário de dados, licença aberta, data da última alteração, periodicidade e o SHA-256 de cada arquivo.
 */
import { gerarCsvDadosAbertos, LICENCA_DADOS_ABERTOS, prepararLinhasDadosAbertos } from '@agora/dominio';
import type { CatalogoDadosAbertos, ConjuntoDadosAbertos } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { naoEncontrado } from '../../http/erros.ts';
import { CONJUNTOS, CONJUNTOS_INDISPONIVEIS, type DefinicaoConjunto } from './conjuntos.ts';

const TIPO_MIDIA = { csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8' } as const;
type Formato = keyof typeof TIPO_MIDIA;

interface ArquivosGerados {
  definicao: DefinicaoConjunto;
  atualizadoEm: string | null;
  registros: number;
  conteudo: Record<Formato, Buffer>;
}

function publicador(ctx: ContextoApp): string {
  const { nome, sigla } = ctx.config.orgao;
  return sigla ? `${nome} (${sigla})` : nome;
}

async function gerar(ctx: ContextoApp, definicao: DefinicaoConjunto): Promise<ArquivosGerados> {
  const { linhas, atualizadoEm } = await definicao.carregar(ctx.banco, ctx.hoje());
  const prontas = prepararLinhasDadosAbertos(definicao.colunas, linhas).linhas;
  const decimais = new Set(definicao.colunas.filter((c) => c.tipo === 'decimal').map((c) => c.nome));
  const registros = prontas.map((l) =>
    Object.fromEntries(Object.entries(l).map(([nome, valor]) => [nome, decimais.has(nome) && typeof valor === 'string' ? Number(valor) : valor])),
  );
  const json = JSON.stringify({
    conjunto: definicao.id,
    titulo: definicao.titulo,
    publicador: publicador(ctx),
    licenca: LICENCA_DADOS_ABERTOS.identificador,
    atualizadoEm,
    dicionario: definicao.colunas,
    registros,
  });
  return {
    definicao,
    atualizadoEm,
    registros: prontas.length,
    conteudo: { csv: Buffer.from(gerarCsvDadosAbertos(definicao.colunas, prontas), 'utf8'), json: Buffer.from(json, 'utf8') },
  };
}

function metadados(ctx: ContextoApp, gerado: ArquivosGerados): ConjuntoDadosAbertos {
  const { definicao } = gerado;
  return {
    id: definicao.id,
    titulo: definicao.titulo,
    descricao: definicao.descricao,
    fundamento: definicao.fundamento,
    publicador: publicador(ctx),
    licenca: { ...LICENCA_DADOS_ABERTOS },
    atualizadoEm: gerado.atualizadoEm,
    periodicidade: definicao.periodicidade,
    registros: gerado.registros,
    arquivos: (['csv', 'json'] as const).map((formato) => ({
      formato,
      url: `/api/v1/publico/dados-abertos/${definicao.id}/${formato}`,
      tipoMidia: TIPO_MIDIA[formato],
      sha256: sha256Hex(gerado.conteudo[formato]),
      bytes: gerado.conteudo[formato].length,
    })),
    dicionario: definicao.colunas.map((c) => ({ nome: c.nome, tipo: c.tipo, descricao: c.descricao })),
  };
}

function definicaoDe(id: string): DefinicaoConjunto {
  const definicao = CONJUNTOS.find((c) => c.id === id);
  if (!definicao) throw naoEncontrado('Conjunto de dados não encontrado.');
  return definicao;
}

export async function rotasDadosAbertos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const limite = ctx.config.dadosAbertos.limitePorMinuto;
  const opcoes = { config: { rateLimit: { max: limite, timeWindow: 60_000 } } };
  const parametros = z.object({ conjunto: z.string().max(40) });

  app.get('/publico/dados-abertos', opcoes, async (): Promise<CatalogoDadosAbertos> => {
    const conjuntos: ConjuntoDadosAbertos[] = [];
    for (const definicao of CONJUNTOS) conjuntos.push(metadados(ctx, await gerar(ctx, definicao)));
    return {
      publicador: publicador(ctx),
      geradoEm: ctx.relogio().toISOString(),
      conjuntos,
      limiteRequisicoesPorMinuto: limite,
      indisponiveis: CONJUNTOS_INDISPONIVEIS.map((c) => ({ ...c })),
    };
  });

  app.get('/publico/dados-abertos/:conjunto', opcoes, async (request): Promise<ConjuntoDadosAbertos> => {
    const { conjunto } = parametros.parse(request.params);
    return metadados(ctx, await gerar(ctx, definicaoDe(conjunto)));
  });

  app.get('/publico/dados-abertos/:conjunto/:formato', opcoes, async (request, reply) => {
    const { conjunto, formato } = parametros.extend({ formato: z.enum(['csv', 'json']) }).parse(request.params);
    const gerado = await gerar(ctx, definicaoDe(conjunto));
    const conteudo = gerado.conteudo[formato];
    return reply
      .header('content-type', TIPO_MIDIA[formato])
      .header('content-disposition', `attachment; filename="${gerado.definicao.id}.${formato}"`)
      .header('x-agora-sha256', sha256Hex(conteudo))
      .header('x-agora-licenca', LICENCA_DADOS_ABERTOS.identificador)
      .send(conteudo);
  });
}
