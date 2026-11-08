import { createHash } from 'node:crypto';
import type { DadosOficiaisSessao } from '@agora/contratos';
import { somenteDigitos, sorteioDeterministico } from '@agora/dominio';
import { z } from 'zod';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';

/**
 * Conector do acompanhamento da sessão oficial (RF-22): consulta, no servidor, os dados abertos do Compras.gov.br
 * (API pública https://dadosabertos.compras.gov.br, módulo "Contratações" da Lei 14.133/2021) — a compra
 * (`1.1_consultarContratacoes_PNCP_14133_Id`: situação, modalidade, modo de disputa, valores) e o resultado por item
 * (`3.1_consultarResultadoItensContratacoes_PNCP_14133_Id`: fornecedor e valor homologado). Os dados abertos não
 * trazem os lances nem o andamento ao vivo da sessão pública; esses ficam no próprio Compras.gov.br.
 *
 * O modo offline (padrão) responde de forma determinística a partir dos participantes da sessão. Timeout por
 * requisição, novas tentativas com espera exponencial e proveniência (hora, SHA-256 e quantidade de registros).
 */

export interface OpcoesConsultaSessaoOficial {
  timeoutMs?: number;
  novasTentativas?: number;
  esperaBaseMs?: number;
  esperar?: (ms: number) => Promise<void>;
}

export interface ParticipanteConsulta {
  documento: string;
  nome: string;
  tipoPessoa: 'PJ' | 'PF';
  /** Melhor valor conhecido na Ágora (proposta ou último lance transcrito), em centavos. */
  valor: number | null;
}

export interface ResultadoOficial {
  documento: string;
  nome: string;
  tipoPessoa: 'PJ' | 'PF';
  valorTotalHomologado: number;
  itens: number;
}

export type ConsultaSessaoOficial = Omit<DadosOficiaisSessao, 'resultados'> & { resultados: ResultadoOficial[] };

const esquemaLista = z.union([z.array(z.unknown()), z.object({ resultado: z.array(z.unknown()).nullish() }).passthrough()]);

const esquemaCompra = z
  .object({
    idCompra: z.coerce.string().nullish(),
    numeroCompra: z.coerce.string().nullish(),
    modalidadeNome: z.string().nullish(),
    modoDisputaNomePncp: z.string().nullish(),
    situacaoCompraNomePncp: z.string().nullish(),
    objetoCompra: z.string().nullish(),
    valorTotalEstimado: z.number().nullish(),
    valorTotalHomologado: z.number().nullish(),
    dataAberturaPropostaPncp: z.string().nullish(),
    existeResultado: z.boolean().nullish(),
  })
  .passthrough();

const esquemaResultado = z
  .object({
    niFornecedor: z.string().min(11),
    nomeRazaoSocialFornecedor: z.string().min(1),
    tipoPessoa: z.string().nullish(),
    valorTotalHomologado: z.number().nonnegative().nullish(),
    situacaoCompraItemResultadoNome: z.string().nullish(),
  })
  .passthrough();

class RespostaRetentavel extends Error {
  constructor(status: number) {
    super(`Compras.gov.br respondeu ${status}`);
    this.name = 'RespostaRetentavel';
  }
}

async function buscarComRetentativa(fetch: FuncaoFetch, url: string, o: Required<OpcoesConsultaSessaoOficial>): Promise<string> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa <= o.novasTentativas; tentativa++) {
    if (tentativa > 0) await o.esperar(o.esperaBaseMs * 2 ** (tentativa - 1));
    try {
      const resposta = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'Agora/1.0 (acompanhamento de sessao de disputa)' },
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      if (resposta.status === 429 || resposta.status >= 500) throw new RespostaRetentavel(resposta.status);
      if (resposta.status === 204) return '';
      if (!resposta.ok) throw new ErroIntegracao(`Compras.gov.br recusou a consulta (HTTP ${resposta.status}).`);
      return await resposta.text();
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimoErro = erro;
    }
  }
  const motivo =
    ultimoErro instanceof Error && (ultimoErro.name === 'TimeoutError' || ultimoErro.name === 'AbortError')
      ? `tempo limite de ${o.timeoutMs} ms excedido`
      : ultimoErro instanceof Error
        ? ultimoErro.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`Compras.gov.br indisponível após ${o.novasTentativas + 1} tentativas: ${motivo}.`, { cause: ultimoErro });
}

function itens(corpo: string): unknown[] {
  if (corpo.trim() === '') return [];
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch (erro) {
    throw new ErroIntegracao('Resposta do Compras.gov.br em formato inesperado.', { cause: erro });
  }
  const lista = esquemaLista.safeParse(json);
  if (!lista.success) throw new ErroIntegracao('Resposta do Compras.gov.br em formato inesperado.');
  return Array.isArray(lista.data) ? lista.data : (lista.data.resultado ?? []);
}

/** "2025-03-10T09:00:00" sem fuso é horário de Brasília. */
function instante(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const comFuso = /[zZ]|[+-]\d{2}:\d{2}$/.test(valor) ? valor : `${valor}-03:00`;
  const ms = Date.parse(comFuso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const centavos = (reais: number | null | undefined) => (reais === null || reais === undefined ? null : Math.round(reais * 100));

/** Agrupa os resultados por fornecedor (soma dos itens homologados), sem os cancelados. */
function agruparResultados(brutos: unknown[]): { resultados: ResultadoOficial[]; ignorados: number } {
  const porDocumento = new Map<string, ResultadoOficial>();
  let ignorados = 0;
  for (const bruto of brutos) {
    const r = esquemaResultado.safeParse(bruto);
    if (!r.success || /cancel/i.test(r.data.situacaoCompraItemResultadoNome ?? '')) {
      ignorados++;
      continue;
    }
    const documento = somenteDigitos(r.data.niFornecedor);
    if (documento.length !== 11 && documento.length !== 14) {
      ignorados++;
      continue;
    }
    const atual = porDocumento.get(documento) ?? {
      documento,
      nome: r.data.nomeRazaoSocialFornecedor.trim(),
      tipoPessoa: documento.length === 14 ? ('PJ' as const) : ('PF' as const),
      valorTotalHomologado: 0,
      itens: 0,
    };
    atual.valorTotalHomologado += centavos(r.data.valorTotalHomologado) ?? 0;
    atual.itens += 1;
    porDocumento.set(documento, atual);
  }
  return { resultados: [...porDocumento.values()], ignorados };
}

function offline(idCompra: string, participantes: readonly ParticipanteConsulta[], valorReferencia: number | null, semente: number, agora: Date): ConsultaSessaoOficial {
  const conhecidos = participantes.filter((p) => p.valor !== null);
  let vencedor: ResultadoOficial | null = null;
  if (conhecidos.length > 0) {
    const melhor = [...conhecidos].sort((a, b) => (a.valor ?? 0) - (b.valor ?? 0))[0];
    if (melhor) vencedor = { documento: melhor.documento, nome: melhor.nome, tipoPessoa: melhor.tipoPessoa, valorTotalHomologado: melhor.valor ?? 0, itens: 1 };
  } else if (participantes.length > 0 && valorReferencia !== null) {
    const indice = Math.floor(sorteioDeterministico(semente, 'oficial', idCompra) * participantes.length);
    const p = participantes[indice];
    if (p) {
      const fator = 0.9 + sorteioDeterministico(semente, 'oficial-valor', idCompra) * 0.08;
      vencedor = { documento: p.documento, nome: p.nome, tipoPessoa: p.tipoPessoa, valorTotalHomologado: Math.round(valorReferencia * fator), itens: 1 };
    }
  }
  const resultados = vencedor ? [vencedor] : [];
  const compra: ConsultaSessaoOficial['compra'] = {
    idCompra,
    numeroCompra: idCompra.length === 17 ? `${idCompra.slice(8, 13)}/${idCompra.slice(13)}` : null,
    modalidade: 'Pregão — eletrônico (resposta simulada)',
    modoDisputa: 'Aberto',
    situacao: resultados.length > 0 ? 'Resultado divulgado (resposta simulada)' : 'Divulgada no PNCP (resposta simulada)',
    objeto: null,
    valorTotalEstimado: valorReferencia,
    valorTotalHomologado: vencedor?.valorTotalHomologado ?? null,
    aberturaPropostas: null,
    existeResultado: resultados.length > 0,
  };
  const conteudo = JSON.stringify({ compra, resultados });
  return {
    fonte: 'COMPRAS_GOV',
    modo: 'offline',
    consultadoEm: agora.toISOString(),
    hash: createHash('sha256').update(conteudo).digest('hex'),
    registros: 1 + resultados.length,
    endereco: null,
    compra,
    resultados,
  };
}

/**
 * Consulta a compra e o resultado no Compras.gov.br (online) ou monta a resposta simulada determinística (offline).
 * Nunca é chamada pelo navegador.
 */
export async function consultarSessaoOficial(
  entrada: {
    modo: 'offline' | 'online';
    urlBase: string;
    idCompra: string;
    fetch: FuncaoFetch;
    agora: Date;
    semente: number;
    participantes: readonly ParticipanteConsulta[];
    valorReferencia: number | null;
  },
  opcoes: OpcoesConsultaSessaoOficial = {},
): Promise<ConsultaSessaoOficial> {
  if (!/^\d{8,30}$/.test(entrada.idCompra)) throw new ErroIntegracao('Identificador da compra inválido: use só os dígitos do Compras.gov.br.');
  if (entrada.modo === 'offline') return offline(entrada.idCompra, entrada.participantes, entrada.valorReferencia, entrada.semente, entrada.agora);

  const o: Required<OpcoesConsultaSessaoOficial> = {
    timeoutMs: opcoes.timeoutMs ?? 15_000,
    novasTentativas: opcoes.novasTentativas ?? 2,
    esperaBaseMs: opcoes.esperaBaseMs ?? 1_000,
    esperar: opcoes.esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))),
  };
  const base = entrada.urlBase.replace(/\/+$/, '');
  const parametros = new URLSearchParams({ tipo: 'idCompra', codigo: entrada.idCompra }).toString();
  const urlCompra = `${base}/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id?${parametros}`;
  const urlResultado = `${base}/modulo-contratacoes/3.1_consultarResultadoItensContratacoes_PNCP_14133_Id?${parametros}`;
  const corpoCompra = await buscarComRetentativa(entrada.fetch, urlCompra, o);
  const corpoResultado = await buscarComRetentativa(entrada.fetch, urlResultado, o);

  const compraBruta = itens(corpoCompra)[0];
  if (compraBruta === undefined) throw new ErroIntegracao(`Compra ${entrada.idCompra} não encontrada nos dados abertos do Compras.gov.br.`);
  const c = esquemaCompra.safeParse(compraBruta);
  if (!c.success) throw new ErroIntegracao('Compra em formato inesperado nos dados abertos do Compras.gov.br.');
  const { resultados } = agruparResultados(itens(corpoResultado));
  return {
    fonte: 'COMPRAS_GOV',
    modo: 'online',
    consultadoEm: entrada.agora.toISOString(),
    hash: createHash('sha256').update(corpoCompra).update('\n').update(corpoResultado).digest('hex'),
    registros: 1 + resultados.length,
    endereco: urlCompra,
    compra: {
      idCompra: entrada.idCompra,
      numeroCompra: c.data.numeroCompra ?? null,
      modalidade: c.data.modalidadeNome ?? null,
      modoDisputa: c.data.modoDisputaNomePncp ?? null,
      situacao: c.data.situacaoCompraNomePncp ?? null,
      objeto: c.data.objetoCompra ?? null,
      valorTotalEstimado: centavos(c.data.valorTotalEstimado),
      valorTotalHomologado: centavos(c.data.valorTotalHomologado),
      aberturaPropostas: instante(c.data.dataAberturaPropostaPncp),
      existeResultado: c.data.existeResultado ?? resultados.length > 0,
    },
    resultados,
  };
}
