/**
 * Conector do quadro societário (QSA) e do cadastro do CNPJ — dados abertos da Receita Federal (RIA-10).
 * Roda só no servidor. Em produção, aponta para o espelho dos dados abertos do CNPJ mantido pelo órgão
 * (ou para a API do acordo de cooperação técnica), em `AGORA_QSA_URL`. O CPF do sócio chega mascarado como nos
 * dados abertos ("***456789**"); a Ágora guarda só os 6 dígitos centrais (minimização, LGPD art. 6º, III).
 * Modo `offline` (padrão): resposta simulada e determinística a partir do cadastro sintético do seed.
 */
import { createHash } from 'node:crypto';
import { somenteDigitos, validarDataISO } from '@agora/dominio';
import { z } from 'zod';
import type { Executor } from '../banco/tipos.ts';
import type { FuncaoFetch } from '../http/contexto.ts';
import { ErroIntegracao } from './conector.ts';

export interface OpcoesQsa {
  modo: 'offline' | 'online';
  urlBase: string | null;
  chave: string | null;
  fetch: FuncaoFetch;
  /** Tempo máximo por requisição (ARQUITETURA §6: 15 s). */
  timeoutMs?: number;
  /** Novas tentativas após falha retentável (ARQUITETURA §6: 2). */
  novasTentativas?: number;
  esperaBaseMs?: number;
  esperar?: (ms: number) => Promise<void>;
}

export const FONTE_QSA = 'Receita Federal — dados abertos do CNPJ (quadro societário e cadastro)';

const dataOpcional = z
  .string()
  .nullish()
  .transform((v) => (v ? v.slice(0, 10) : null))
  .refine((v) => v === null || validarDataISO(v), 'data inválida');

/** Formato aceito do espelho dos dados abertos (documentado na entrega da frente F). */
export const esquemaRespostaQsa = z.object({
  cnpj: z.string().transform(somenteDigitos).refine((v) => v.length === 14, 'CNPJ deve ter 14 dígitos'),
  dataInicioAtividade: dataOpcional,
  endereco: z
    .object({
      logradouro: z.string().nullish(),
      numero: z.string().nullish(),
      complemento: z.string().nullish(),
      bairro: z.string().nullish(),
      municipio: z.string().nullish(),
      uf: z.string().nullish(),
      cep: z.string().nullish(),
    })
    .nullish(),
  socios: z
    .array(
      z.object({
        nome: z.string().min(1).max(300),
        cpfCnpj: z.string().max(30),
        qualificacao: z.string().max(200),
        dataEntrada: dataOpcional,
      }),
    )
    .max(500),
});

export type QualificacaoQsa = 'socio' | 'administrador' | 'socio_administrador';

export interface DadosQsa {
  cnpj: string;
  dataAbertura: string | null;
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  socios: { documentoParcial: string; nome: string; qualificacao: QualificacaoQsa; dataEntrada: string | null }[];
}

export interface ResultadoQsa {
  dados: DadosQsa;
  proveniencia: { fonte: string; modo: 'offline' | 'online'; consultadoEm: string; hash: string; registros: number };
}

/** Qualificação dos dados abertos ("49 - Sócio-Administrador", "05 - Administrador", "22 - Sócio") → categoria da Ágora. */
export function categoriaQualificacao(qualificacao: string): QualificacaoQsa {
  const q = qualificacao.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const administra = /administrador|diretor|presidente|gerente/.test(q);
  if (administra && /socio/.test(q)) return 'socio_administrador';
  if (administra) return 'administrador';
  return 'socio';
}

const ROTULO_QUALIFICACAO: Record<QualificacaoQsa, string> = {
  socio: '22 - Sócio',
  administrador: '05 - Administrador',
  socio_administrador: '49 - Sócio-Administrador',
};

/** Converte a resposta validada: só pessoas físicas, com os 6 dígitos centrais do CPF; endereço em uma linha. */
function interpretar(bruto: z.infer<typeof esquemaRespostaQsa>): DadosQsa {
  const e = bruto.endereco;
  const partes = e ? [e.logradouro, e.numero, e.complemento, e.bairro].map((p) => (p ?? '').trim()).filter((p) => p.length > 0) : [];
  const socios = bruto.socios.flatMap((s) => {
    const digitos = somenteDigitos(s.cpfCnpj);
    // CPF mascarado dos dados abertos ("***456789**" → 6 dígitos) ou completo (11): guarda só os centrais.
    const centrais = digitos.length === 6 ? digitos : digitos.length === 11 ? digitos.slice(3, 9) : null;
    if (centrais === null) return [];
    return [{ documentoParcial: centrais, nome: s.nome.trim(), qualificacao: categoriaQualificacao(s.qualificacao), dataEntrada: s.dataEntrada }];
  });
  return {
    cnpj: bruto.cnpj,
    dataAbertura: bruto.dataInicioAtividade,
    endereco: partes.length > 0 ? partes.join(', ') : null,
    municipio: e?.municipio?.trim() || null,
    uf: e?.uf ? e.uf.trim().slice(0, 2).toUpperCase() : null,
    socios,
  };
}

/** Resposta simulada a partir do cadastro sintético (modo offline), no mesmo formato do espelho. */
async function respostaOffline(executor: Executor, cnpj: string): Promise<string> {
  const [fornecedor] = await executor.consultar<{ id: string; uf: string | null }>(
    `SELECT id, uf FROM fornecedores WHERE documento = $1 AND tipo_pessoa = 'PJ'`,
    [cnpj],
  );
  if (!fornecedor) throw new ErroIntegracao('CNPJ não encontrado na base simulada (modo offline).');
  const socios = await executor.consultar<{ cpf: string; nome: string; qualificacao: QualificacaoQsa }>(
    'SELECT cpf, nome, qualificacao FROM fornecedores_socios WHERE fornecedor_id = $1 ORDER BY cpf',
    [fornecedor.id],
  );
  const [cadastro] = await executor.consultar<{ data_abertura: string | null; endereco: string | null; municipio: string | null; uf: string | null }>(
    'SELECT data_abertura, endereco, municipio, uf FROM fornecedores_cadastro_cnpj WHERE fornecedor_id = $1',
    [fornecedor.id],
  );
  const corpo = {
    cnpj,
    dataInicioAtividade: cadastro?.data_abertura ?? null,
    endereco: cadastro?.endereco
      ? { logradouro: cadastro.endereco, municipio: cadastro.municipio, uf: cadastro.uf ?? fornecedor.uf }
      : null,
    socios: socios.map((s) => ({
      nome: s.nome.toUpperCase(),
      cpfCnpj: `***${s.cpf.slice(3, 9)}**`,
      qualificacao: ROTULO_QUALIFICACAO[s.qualificacao],
      dataEntrada: cadastro?.data_abertura ?? null,
    })),
  };
  return JSON.stringify(corpo);
}

class RespostaRetentavel extends Error {
  constructor(status: number) {
    super(`a base do CNPJ respondeu ${status}`);
    this.name = 'RespostaRetentavel';
  }
}

async function respostaOnline(cnpj: string, opcoes: OpcoesQsa): Promise<string> {
  if (opcoes.urlBase === null) throw new ErroIntegracao('AGORA_QSA_URL não configurada: a consulta online do QSA não está disponível.');
  const timeoutMs = opcoes.timeoutMs ?? 15_000;
  const novasTentativas = opcoes.novasTentativas ?? 2;
  const esperaBaseMs = opcoes.esperaBaseMs ?? 1_000;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${opcoes.urlBase}/cnpj/${cnpj}`;
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa <= novasTentativas; tentativa++) {
    if (tentativa > 0) await esperar(esperaBaseMs * 2 ** (tentativa - 1));
    try {
      const resposta = await opcoes.fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Agora/1.0 (consulta QSA)',
          ...(opcoes.chave ? { authorization: `Bearer ${opcoes.chave}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resposta.status === 429 || resposta.status >= 500) throw new RespostaRetentavel(resposta.status);
      if (resposta.status === 404) throw new ErroIntegracao('CNPJ não encontrado na base do CNPJ.');
      if (!resposta.ok) throw new ErroIntegracao(`A base do CNPJ recusou a consulta (HTTP ${resposta.status}).`);
      return await resposta.text();
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimoErro = erro;
    }
  }
  const motivo =
    ultimoErro instanceof Error && (ultimoErro.name === 'TimeoutError' || ultimoErro.name === 'AbortError')
      ? `tempo limite de ${timeoutMs} ms excedido`
      : ultimoErro instanceof Error
        ? ultimoErro.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`Base do CNPJ indisponível após ${novasTentativas + 1} tentativas: ${motivo}.`, { cause: ultimoErro });
}

/**
 * Consulta o QSA e o cadastro de um CNPJ (14 dígitos), com proveniência: fonte, modo, hora, hash SHA-256 do
 * conteúdo recebido e quantidade de sócios. Quem chama grava o resultado e registra a auditoria.
 */
export async function consultarQsa(executor: Executor, cnpj: string, opcoes: OpcoesQsa, agora: Date): Promise<ResultadoQsa> {
  const digitos = somenteDigitos(cnpj);
  if (digitos.length !== 14) throw new ErroIntegracao('Informe um CNPJ com 14 dígitos.');
  const texto = opcoes.modo === 'online' ? await respostaOnline(digitos, opcoes) : await respostaOffline(executor, digitos);
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch (erro) {
    throw new ErroIntegracao('A base do CNPJ devolveu conteúdo que não é JSON.', { cause: erro });
  }
  const validado = esquemaRespostaQsa.safeParse(json);
  if (!validado.success) throw new ErroIntegracao(`Resposta da base do CNPJ fora do formato esperado: ${validado.error.issues[0]?.message ?? 'inválida'}.`);
  if (validado.data.cnpj !== digitos) throw new ErroIntegracao('A base do CNPJ devolveu outro CNPJ.');
  const dados = interpretar(validado.data);
  return {
    dados,
    proveniencia: {
      fonte: opcoes.modo === 'online' ? FONTE_QSA : `${FONTE_QSA} — simulação offline`,
      modo: opcoes.modo,
      consultadoEm: agora.toISOString(),
      hash: createHash('sha256').update(texto).digest('hex'),
      registros: dados.socios.length,
    },
  };
}
