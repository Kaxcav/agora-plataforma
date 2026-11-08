import { createHash } from 'node:crypto';
import { adicionarDias, somenteDigitos, validarDataISO } from '@agora/dominio';
import { z } from 'zod';
import type { Transacao } from '../banco/tipos.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao, type Conector, type ContextoConector } from './conector.ts';

export interface OpcoesPncp {
  /** Base da API pública de consulta do PNCP. */
  urlBase?: string;
  /** Tempo máximo por requisição (ARQUITETURA §6: 15 s). */
  timeoutMs?: number;
  /** Novas tentativas após a primeira falha retentável (ARQUITETURA §6: 2). */
  novasTentativas?: number;
  /** Espera inicial da retentativa; dobra a cada tentativa. */
  esperaBaseMs?: number;
  limitePaginas?: number;
  tamanhoPagina?: number;
  /** Janela de consulta em dias até hoje. */
  janelaDias?: number;
  esperar?: (ms: number) => Promise<void>;
}

const URL_BASE_PADRAO = 'https://pncp.gov.br/api/consulta';

const esquemaPagina = z.object({
  data: z.array(z.unknown()),
  totalRegistros: z.number().int().optional(),
  totalPaginas: z.number().int().optional(),
  numeroPagina: z.number().int().optional(),
});

const textoData = z.string().transform((v) => v.slice(0, 10)).refine((v) => validarDataISO(v), 'data inválida');

const esquemaContrato = z.object({
  numeroControlePNCP: z.string().min(10).max(80),
  numeroContratoEmpenho: z.string().nullish(),
  anoContrato: z.number().int().min(1990).max(2100),
  processo: z.string().nullish(),
  objetoContrato: z.string().min(1),
  niFornecedor: z.string().min(11),
  nomeRazaoSocialFornecedor: z.string().min(1),
  valorInicial: z.number().nonnegative(),
  dataAssinatura: textoData,
  dataVigenciaInicio: textoData,
  dataVigenciaFim: textoData,
  dataPublicacaoPncp: z.string().nullish(),
  unidadeOrgao: z.object({
    codigoUnidade: z.string(),
    nomeUnidade: z.string(),
    ufSigla: z.string().nullish(),
  }),
  orgaoEntidade: z.object({ razaoSocial: z.string() }).nullish(),
  categoriaProcesso: z.object({ nome: z.string() }).nullish(),
});

type ContratoPncp = z.infer<typeof esquemaContrato>;

/** Campos que a sincronização pode atualizar — nunca sobrescreve os listados em `contratos.campos_editados`. */
export const CAMPOS_SINCRONIZAVEIS = [
  'objeto',
  'processo_sei',
  'assinatura_em',
  'divulgacao_pncp_em',
  'vigencia_inicio',
  'vigencia_fim',
  'valor_inicial',
] as const;

function formatoPncp(data: string): string {
  return data.replaceAll('-', '');
}

class RespostaRetentavel extends Error {
  constructor(status: number) {
    super(`PNCP respondeu ${status}`);
    this.name = 'RespostaRetentavel';
  }
}

async function buscarComRetentativa(
  fetch: FuncaoFetch,
  url: string,
  opcoes: Required<Pick<OpcoesPncp, 'timeoutMs' | 'novasTentativas' | 'esperaBaseMs' | 'esperar'>>,
): Promise<{ status: number; corpo: string }> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa <= opcoes.novasTentativas; tentativa++) {
    if (tentativa > 0) await opcoes.esperar(opcoes.esperaBaseMs * 2 ** (tentativa - 1));
    try {
      const resposta = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Agora/1.0 (integracao PNCP)' },
        signal: AbortSignal.timeout(opcoes.timeoutMs),
      });
      if (resposta.status === 429 || resposta.status >= 500) throw new RespostaRetentavel(resposta.status);
      if (resposta.status === 204) return { status: 204, corpo: '' };
      if (!resposta.ok) throw new ErroIntegracao(`PNCP recusou a consulta (HTTP ${resposta.status}).`);
      return { status: resposta.status, corpo: await resposta.text() };
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimoErro = erro;
    }
  }
  const motivo =
    ultimoErro instanceof Error && (ultimoErro.name === 'TimeoutError' || ultimoErro.name === 'AbortError')
      ? `tempo limite de ${opcoes.timeoutMs} ms excedido`
      : ultimoErro instanceof Error
        ? ultimoErro.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`PNCP indisponível após ${opcoes.novasTentativas + 1} tentativas: ${motivo}.`, { cause: ultimoErro });
}

function numeroContrato(c: ContratoPncp): string {
  const bruto = (c.numeroContratoEmpenho ?? '').trim();
  if (bruto === '') return `${c.numeroControlePNCP.slice(-11)}`;
  return bruto.includes('/') ? bruto : `${bruto}/${c.anoContrato}`;
}

async function gravarContrato(tx: Transacao, c: ContratoPncp, recebidoEm: string): Promise<boolean> {
  const uasg = somenteDigitos(c.unidadeOrgao.codigoUnidade);
  const documento = somenteDigitos(c.niFornecedor);
  if (!/^\d{6}$/.test(uasg) || !(documento.length === 11 || documento.length === 14)) return false;

  await tx.executar(
    `INSERT INTO uasgs (codigo, nome, sigla, uf, orgao) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (codigo) DO NOTHING`,
    [
      uasg,
      c.unidadeOrgao.nomeUnidade,
      c.unidadeOrgao.nomeUnidade.slice(0, 20),
      (c.unidadeOrgao.ufSigla ?? 'DF').slice(0, 2).toUpperCase(),
      c.orgaoEntidade?.razaoSocial ?? c.unidadeOrgao.nomeUnidade,
    ],
  );
  const tipoPessoa = documento.length === 14 ? 'PJ' : 'PF';
  await tx.executar(
    `INSERT INTO fornecedores (documento, tipo_pessoa, razao_social, busca_normalizada, fonte_dados)
     VALUES ($1, $2, $3, $4, 'PNCP') ON CONFLICT (documento) DO NOTHING`,
    [documento, tipoPessoa, c.nomeRazaoSocialFornecedor, normalizarBusca(c.nomeRazaoSocialFornecedor, documento)],
  );
  const fornecedor = await tx.consultar<{ id: string; razao_social: string }>(
    'SELECT id, razao_social FROM fornecedores WHERE documento = $1',
    [documento],
  );
  const fornecedorId = fornecedor[0]?.id;
  if (!fornecedorId) return false;

  const numero = numeroContrato(c);
  const divulgacao = c.dataPublicacaoPncp ? c.dataPublicacaoPncp.slice(0, 10) : null;
  const valorInicial = Math.round(c.valorInicial * 100);
  const busca = normalizarBusca(numero, c.objetoContrato, fornecedor[0]?.razao_social, c.numeroControlePNCP);

  const existente = await tx.consultar<{ id: string }>(
    `SELECT id FROM contratos
      WHERE id_pncp = $1 OR (id_pncp IS NULL AND uasg = $2 AND numero = $3)
      ORDER BY (id_pncp IS NOT NULL) DESC
      LIMIT 1`,
    [c.numeroControlePNCP, uasg, numero],
  );
  const alvo = existente[0];
  if (!alvo) {
    await tx.executar(
      `INSERT INTO contratos (numero, ano, uasg, fornecedor_id, objeto, processo_sei, origem, modalidade, assinatura_em,
                              divulgacao_pncp_em, vigencia_inicio, vigencia_fim, valor_inicial, id_pncp, data_base_reajuste,
                              fonte_dados, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, $6, 'licitacao', $7, $8, $9, $10, $11, $12, $13, $8, 'PNCP', $14)`,
      [
        numero,
        c.anoContrato,
        uasg,
        fornecedorId,
        c.objetoContrato,
        c.processo ?? '',
        c.categoriaProcesso?.nome ?? 'Não informada',
        c.dataAssinatura,
        divulgacao,
        c.dataVigenciaInicio,
        c.dataVigenciaFim,
        valorInicial,
        c.numeroControlePNCP,
        busca,
      ],
    );
  } else {
    await tx.executar(
      `UPDATE contratos SET
         id_pncp = $2,
         objeto = CASE WHEN 'objeto' = ANY(campos_editados) THEN objeto ELSE $3 END,
         processo_sei = CASE WHEN 'processo_sei' = ANY(campos_editados) THEN processo_sei ELSE $4 END,
         assinatura_em = CASE WHEN 'assinatura_em' = ANY(campos_editados) THEN assinatura_em ELSE $5::date END,
         divulgacao_pncp_em = CASE WHEN 'divulgacao_pncp_em' = ANY(campos_editados) THEN divulgacao_pncp_em ELSE $6::date END,
         vigencia_inicio = CASE WHEN 'vigencia_inicio' = ANY(campos_editados) THEN vigencia_inicio ELSE $7::date END,
         vigencia_fim = CASE WHEN 'vigencia_fim' = ANY(campos_editados) THEN vigencia_fim ELSE $8::date END,
         valor_inicial = CASE WHEN 'valor_inicial' = ANY(campos_editados) THEN valor_inicial ELSE $9::bigint END,
         busca_normalizada = CASE WHEN 'objeto' = ANY(campos_editados) THEN busca_normalizada ELSE $10 END,
         atualizado_em = $11
       WHERE id = $1`,
      [
        alvo.id,
        c.numeroControlePNCP,
        c.objetoContrato,
        c.processo ?? '',
        c.dataAssinatura,
        divulgacao,
        c.dataVigenciaInicio,
        c.dataVigenciaFim,
        valorInicial,
        busca,
        recebidoEm,
      ],
    );
  }
  return true;
}

/**
 * Conector online do PNCP (API pública de consulta, chamada só pelo servidor): paginação com limite,
 * timeout por requisição, novas tentativas com espera exponencial, staging com hash e upsert idempotente
 * que preserva campos editados por usuários.
 */
export function criarConectorPncp(opcoes: OpcoesPncp = {}): Conector {
  const urlBase = (opcoes.urlBase ?? URL_BASE_PADRAO).replace(/\/+$/, '');
  const configuracao = {
    timeoutMs: opcoes.timeoutMs ?? 15_000,
    novasTentativas: opcoes.novasTentativas ?? 2,
    esperaBaseMs: opcoes.esperaBaseMs ?? 1_000,
    esperar: opcoes.esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))),
  };
  const limitePaginas = opcoes.limitePaginas ?? 20;
  const tamanhoPagina = opcoes.tamanhoPagina ?? 50;
  const janelaDias = opcoes.janelaDias ?? 30;

  return {
    fonte: 'PNCP',
    conjunto: 'Contratos',
    modo: 'online',
    async executar(ctx: ContextoConector) {
      const cnpj = ctx.config.orgao.cnpj;
      if (!cnpj) throw new ErroIntegracao('AGORA_ORGAO_CNPJ não configurado: informe o CNPJ do órgão para consultar o PNCP.');
      const dataInicial = formatoPncp(adicionarDias(ctx.hoje, -janelaDias));
      const dataFinal = formatoPncp(ctx.hoje);
      const hash = createHash('sha256');
      const recebidos: ContratoPncp[] = [];
      let rejeitados = 0;
      let paginasLidas = 0;

      for (let numeroPagina = 1; numeroPagina <= limitePaginas; numeroPagina++) {
        const parametros = new URLSearchParams({
          dataInicial,
          dataFinal,
          cnpjOrgao: cnpj,
          pagina: String(numeroPagina),
          tamanhoPagina: String(tamanhoPagina),
        });
        const { status, corpo } = await buscarComRetentativa(ctx.fetch, `${urlBase}/v1/contratos?${parametros.toString()}`, configuracao);
        paginasLidas++;
        if (status === 204 || corpo.trim() === '') break;
        hash.update(corpo);
        const pagina = esquemaPagina.safeParse(JSON.parse(corpo));
        if (!pagina.success) throw new ErroIntegracao('Resposta do PNCP em formato inesperado.');
        for (const item of pagina.data.data) {
          const contrato = esquemaContrato.safeParse(item);
          if (contrato.success) recebidos.push(contrato.data);
          else rejeitados++;
        }
        const totalPaginas = pagina.data.totalPaginas ?? numeroPagina;
        if (numeroPagina >= totalPaginas || pagina.data.data.length === 0) break;
      }

      const conteudoHash = hash.digest('hex');
      const recebidoEm = ctx.agora.toISOString();
      const gravados = await ctx.banco.transacao(async (tx) => {
        let total = 0;
        for (const contrato of recebidos) {
          await tx.executar(
            `INSERT INTO pncp_contratos_staging (numero_controle_pncp, conteudo, hash, recebido_em)
             VALUES ($1, $2::jsonb, $3, $4)
             ON CONFLICT (numero_controle_pncp) DO UPDATE SET conteudo = EXCLUDED.conteudo, hash = EXCLUDED.hash, recebido_em = EXCLUDED.recebido_em`,
            [
              contrato.numeroControlePNCP,
              JSON.stringify(contrato),
              createHash('sha256').update(JSON.stringify(contrato)).digest('hex'),
              recebidoEm,
            ],
          );
          if (await gravarContrato(tx, contrato, recebidoEm)) total++;
          else rejeitados++;
        }
        return total;
      });

      return {
        registros: gravados,
        hash: conteudoHash,
        mensagem:
          `PNCP: ${gravados} contratos sincronizados (${paginasLidas} página(s), período ${dataInicial}–${dataFinal})` +
          (rejeitados > 0 ? `; ${rejeitados} registro(s) ignorado(s) por formato inválido.` : '.'),
      };
    },
  };
}
