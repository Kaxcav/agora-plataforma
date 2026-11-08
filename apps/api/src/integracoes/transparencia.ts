import { createHash } from 'node:crypto';
import { somenteDigitos, validarDataISO, type RegistroCadastroSancoes } from '@agora/dominio';
import { z } from 'zod';
import { jsonCanonico } from '../auditoria/trilha.ts';
import type { Executor } from '../banco/tipos.ts';
import { sha256Hex } from '../compartilhado/cripto.ts';
import type { Config } from '../config.ts';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';

/**
 * Consulta ao CEIS e ao CNEP (Lei 14.133/2021, art. 91, § 4º) pela API de dados do Portal da Transparência (CGU),
 * sempre no servidor: `GET {AGORA_TRANSPARENCIA_URL}/ceis` e `/cnep` com `codigoSancionado` e `pagina`, cabeçalho
 * `chave-api-dados`. Tempo limite por requisição, novas tentativas com espera exponencial em 429/5xx/rede e hash
 * SHA-256 do conteúdo recebido (proveniência). No modo offline, lê a base simulada da carga sintética.
 */

export const FONTE_TRANSPARENCIA = 'Portal da Transparência (CGU) — API de dados do CEIS e do CNEP';
export const FONTE_SIMULADA = 'Base simulada do CEIS e do CNEP (modo offline, dados sintéticos)';

export interface OpcoesTransparencia {
  /** Tempo máximo por requisição (padrão 15 s, como o PNCP). */
  timeoutMs?: number;
  /** Novas tentativas após a primeira falha retentável (padrão 2). */
  novasTentativas?: number;
  /** Espera inicial da retentativa; dobra a cada tentativa. */
  esperaBaseMs?: number;
  /** Páginas lidas por cadastro (a API devolve até 15 registros por página). */
  limitePaginas?: number;
  esperar?: (ms: number) => Promise<void>;
}

export interface ResultadoConsultaCadastros {
  modo: 'offline' | 'online';
  fonte: string;
  registros: RegistroCadastroSancoes[];
  /** SHA-256 do conteúdo recebido (online: corpos das respostas; offline: registros canônicos). */
  hash: string;
  mensagem: string;
}

const textoOpcional = z.string().nullish();

/** Campos usados do CeisDTO/CnepDTO (os demais são ignorados; nomes e documentos de pessoas não são guardados). */
const esquemaRegistro = z.object({
  dataInicioSancao: textoOpcional,
  dataFimSancao: textoOpcional,
  tipoSancao: z.object({ descricaoResumida: textoOpcional, descricaoPortal: textoOpcional }).nullish(),
  orgaoSancionador: z.object({ nome: textoOpcional, siglaUf: textoOpcional, esfera: textoOpcional }).nullish(),
  fonteSancao: z.object({ nomeExibicao: textoOpcional }).nullish(),
  sancionado: z.object({ codigoFormatado: textoOpcional }).nullish(),
  pessoa: z.object({ cnpjFormatado: textoOpcional, cpfFormatado: textoOpcional }).nullish(),
  fundamentacao: z.array(z.object({ codigo: textoOpcional, descricao: textoOpcional })).nullish(),
  numeroProcesso: textoOpcional,
  abrangenciaDefinidaDecisaoJudicial: textoOpcional,
});

type RegistroPortal = z.infer<typeof esquemaRegistro>;

/** 'DD/MM/AAAA' ou 'AAAA-MM-DD…' → 'AAAA-MM-DD'; "Sem informação", vazio ou inválido → null. */
export function dataDoPortal(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = valor.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null;
  return iso !== null && validarDataISO(iso) ? iso : null;
}

function textoOuNulo(valor: string | null | undefined, limite = 300): string | null {
  const t = (valor ?? '').trim();
  return t === '' ? null : t.slice(0, limite);
}

/** O registro devolvido é do documento consultado? PJ: mesma raiz (matriz e filiais são a mesma pessoa jurídica). */
function mesmoSancionado(r: RegistroPortal, documento: string): boolean {
  const codigo = somenteDigitos(r.sancionado?.codigoFormatado ?? r.pessoa?.cnpjFormatado ?? r.pessoa?.cpfFormatado ?? '');
  if (codigo.length === 14 && documento.length === 14) return codigo.slice(0, 8) === documento.slice(0, 8);
  if (codigo.length === 11 && documento.length === 11) return codigo === documento;
  // Documento mascarado ou ausente na resposta: vale o filtro aplicado pela própria API.
  return codigo.length !== 11 && codigo.length !== 14;
}

export function normalizarRegistroPortal(cadastro: 'CEIS' | 'CNEP', r: RegistroPortal): RegistroCadastroSancoes {
  const uf = textoOuNulo(r.orgaoSancionador?.siglaUf, 2);
  const fundamentacao = (r.fundamentacao ?? [])
    .map((f) => [f.codigo, f.descricao].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(' — '))
    .filter((t) => t !== '')
    .join('; ');
  return {
    cadastro,
    tipoSancao: textoOuNulo(r.tipoSancao?.descricaoResumida) ?? textoOuNulo(r.tipoSancao?.descricaoPortal) ?? 'Sanção sem tipo informado',
    orgaoSancionador: textoOuNulo(r.orgaoSancionador?.nome) ?? textoOuNulo(r.fonteSancao?.nomeExibicao) ?? 'Órgão sancionador não informado',
    esfera: textoOuNulo(r.orgaoSancionador?.esfera, 40),
    uf: uf !== null && /^[A-Za-z]{2}$/.test(uf) ? uf.toUpperCase() : null,
    dataInicio: dataDoPortal(r.dataInicioSancao),
    dataFim: dataDoPortal(r.dataFimSancao),
    numeroProcesso: textoOuNulo(r.numeroProcesso, 80),
    fundamentacao: fundamentacao === '' ? null : fundamentacao.slice(0, 500),
    abrangencia: textoOuNulo(r.abrangenciaDefinidaDecisaoJudicial),
  };
}

class RespostaRetentavel extends Error {
  constructor(status: number) {
    super(`o Portal da Transparência respondeu HTTP ${status}`);
    this.name = 'RespostaRetentavel';
  }
}

async function buscarComRetentativa(
  fetch: FuncaoFetch,
  url: string,
  chave: string,
  opcoes: Required<Pick<OpcoesTransparencia, 'timeoutMs' | 'novasTentativas' | 'esperaBaseMs' | 'esperar'>>,
): Promise<string> {
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa <= opcoes.novasTentativas; tentativa++) {
    if (tentativa > 0) await opcoes.esperar(opcoes.esperaBaseMs * 2 ** (tentativa - 1));
    try {
      const resposta = await fetch(url, {
        headers: { accept: 'application/json', 'chave-api-dados': chave, 'user-agent': 'Agora/1.0 (consulta CEIS/CNEP)' },
        signal: AbortSignal.timeout(opcoes.timeoutMs),
      });
      if (resposta.status === 429 || resposta.status >= 500) throw new RespostaRetentavel(resposta.status);
      if (resposta.status === 401 || resposta.status === 403) {
        throw new ErroIntegracao(`o Portal da Transparência recusou a chave de acesso (HTTP ${resposta.status}); confira AGORA_TRANSPARENCIA_CHAVE`);
      }
      if (!resposta.ok) throw new ErroIntegracao(`o Portal da Transparência recusou a consulta (HTTP ${resposta.status})`);
      return await resposta.text();
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
  throw new ErroIntegracao(`Portal da Transparência indisponível após ${opcoes.novasTentativas + 1} tentativas: ${motivo}`, { cause: ultimoErro });
}

/** Consulta online do documento no CEIS e no CNEP, com paginação limitada. */
export async function consultarCadastrosOnline(
  fetch: FuncaoFetch,
  base: { url: string; chave: string },
  documento: string,
  opcoes: OpcoesTransparencia = {},
): Promise<ResultadoConsultaCadastros> {
  const configuracao = {
    timeoutMs: opcoes.timeoutMs ?? 15_000,
    novasTentativas: opcoes.novasTentativas ?? 2,
    esperaBaseMs: opcoes.esperaBaseMs ?? 1_000,
    esperar: opcoes.esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))),
  };
  const limitePaginas = opcoes.limitePaginas ?? 10;
  const urlBase = base.url.replace(/\/+$/, '');
  const hash = createHash('sha256');
  const registros: RegistroCadastroSancoes[] = [];
  let ignorados = 0;
  for (const cadastro of ['CEIS', 'CNEP'] as const) {
    for (let pagina = 1; pagina <= limitePaginas; pagina++) {
      const parametros = new URLSearchParams({ codigoSancionado: documento, pagina: String(pagina) });
      const corpo = await buscarComRetentativa(fetch, `${urlBase}/${cadastro.toLowerCase()}?${parametros.toString()}`, base.chave, configuracao);
      hash.update(`${cadastro}:${pagina}:`).update(corpo);
      let json: unknown;
      try {
        json = corpo.trim() === '' ? [] : JSON.parse(corpo);
      } catch {
        throw new ErroIntegracao('o Portal da Transparência respondeu em formato inesperado (JSON inválido)');
      }
      const lista = z.array(z.unknown()).safeParse(json);
      if (!lista.success) throw new ErroIntegracao('o Portal da Transparência respondeu em formato inesperado (lista esperada)');
      for (const item of lista.data) {
        const r = esquemaRegistro.safeParse(item);
        if (!r.success) {
          ignorados++;
          continue;
        }
        if (mesmoSancionado(r.data, documento)) registros.push(normalizarRegistroPortal(cadastro, r.data));
      }
      if (lista.data.length === 0) break;
    }
  }
  return {
    modo: 'online',
    fonte: FONTE_TRANSPARENCIA,
    registros,
    hash: hash.digest('hex'),
    mensagem: `CEIS e CNEP consultados: ${registros.length} registro(s) do documento${ignorados > 0 ? `; ${ignorados} registro(s) ignorado(s) por formato inválido` : ''}.`,
  };
}

interface LinhaSimulada {
  cadastro: 'CEIS' | 'CNEP';
  tipo_sancao: string;
  orgao_sancionador: string;
  esfera: string | null;
  uf: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  numero_processo: string | null;
  fundamentacao: string | null;
  abrangencia: string | null;
}

/** Consulta offline: registros simulados da carga sintética (mesma regra de raiz do CNPJ do modo online). */
export async function consultarCadastrosOffline(executor: Executor, documento: string): Promise<ResultadoConsultaCadastros> {
  const linhas = await executor.consultar<LinhaSimulada>(
    `SELECT cadastro, tipo_sancao, orgao_sancionador, esfera, uf, data_inicio, data_fim, numero_processo, fundamentacao, abrangencia
       FROM ceis_cnep_simulados
      WHERE documento = $1 OR (length($1) = 14 AND length(documento) = 14 AND left(documento, 8) = left($1, 8))
      ORDER BY cadastro, data_inicio NULLS FIRST, id`,
    [documento],
  );
  const registros: RegistroCadastroSancoes[] = linhas.map((l) => ({
    cadastro: l.cadastro,
    tipoSancao: l.tipo_sancao,
    orgaoSancionador: l.orgao_sancionador,
    esfera: l.esfera,
    uf: l.uf,
    dataInicio: l.data_inicio,
    dataFim: l.data_fim,
    numeroProcesso: l.numero_processo,
    fundamentacao: l.fundamentacao,
    abrangencia: l.abrangencia,
  }));
  return {
    modo: 'offline',
    fonte: FONTE_SIMULADA,
    registros,
    hash: sha256Hex(jsonCanonico(registros)),
    mensagem: `Modo offline: base simulada consultada (${registros.length} registro(s)). Nenhuma chamada externa foi feita.`,
  };
}

/**
 * Consulta o documento no CEIS e no CNEP conforme `AGORA_INTEGRACOES`: online exige `AGORA_TRANSPARENCIA_CHAVE`
 * (sem chave, a consulta falha — nunca cai para a base simulada em produção).
 */
export async function consultarCadastrosSancoes(
  dependencias: { config: Config; fetch: FuncaoFetch; banco: Executor },
  documento: string,
  opcoes: OpcoesTransparencia & { modo?: 'offline' | 'online' } = {},
): Promise<ResultadoConsultaCadastros> {
  const modo = opcoes.modo ?? dependencias.config.integracoes;
  if (modo === 'offline') return consultarCadastrosOffline(dependencias.banco, documento);
  const chave = dependencias.config.transparencia.chave;
  if (!chave) {
    throw new ErroIntegracao('AGORA_TRANSPARENCIA_CHAVE não configurada: cadastre a chave da API de dados do Portal da Transparência');
  }
  return consultarCadastrosOnline(dependencias.fetch, { url: dependencias.config.transparencia.url, chave }, documento, opcoes);
}
