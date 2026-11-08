/**
 * Cliente HTTP da Ágora. O navegador fala só com a própria API (`/api/v1`), mesma origem.
 * - Cookie de sessão HttpOnly (enviado pelo navegador); token CSRF mantido apenas em memória.
 * - Erros viram `ErroApi` com o `idRequisicao` para suporte.
 * - 401 fora do fluxo de login dispara o tratador registrado pela sessão (limpa e leva para /entrar).
 */
import type { RespostaErro } from '@agora/contratos';

export const PREFIXO_API = '/api/v1';

export interface DetalheErro {
  campo?: string;
  mensagem: string;
}

export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly mensagem: string;
  readonly detalhes: DetalheErro[];
  readonly idRequisicao: string | null;

  constructor(dados: { status: number; codigo: string; mensagem: string; detalhes?: DetalheErro[]; idRequisicao: string | null }) {
    super(dados.mensagem);
    this.name = 'ErroApi';
    this.status = dados.status;
    this.mensagem = dados.mensagem;
    this.codigo = dados.codigo;
    this.detalhes = dados.detalhes ?? [];
    this.idRequisicao = dados.idRequisicao;
  }
}

export function ehErroApi(erro: unknown): erro is ErroApi {
  return erro instanceof ErroApi;
}

let tokenCsrf: string | null = null;
let aoNaoAutenticado: (() => void) | null = null;
let aoExigirTrocaSenha: (() => void) | null = null;

/** Código do 403 devolvido enquanto a senha temporária não for trocada. */
export const CODIGO_TROCA_SENHA = 'TROCA_SENHA_OBRIGATORIA';

export function definirTokenCsrf(token: string | null): void {
  tokenCsrf = token;
}

export function registrarAoNaoAutenticado(tratador: (() => void) | null): void {
  aoNaoAutenticado = tratador;
}

/** Tratador do 403 `TROCA_SENHA_OBRIGATORIA` (a sessão leva o usuário a /trocar-senha). */
export function registrarAoExigirTrocaSenha(tratador: (() => void) | null): void {
  aoExigirTrocaSenha = tratador;
}

export type ValorParametro = string | number | boolean | undefined | null;
export type Parametros = Record<string, ValorParametro>;

export function montarConsulta(parametros?: Parametros): string {
  if (!parametros) return '';
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null || valor === '') continue;
    busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : '';
}

/** URL completa de um recurso da API (para links de download, como o CSV de itens). */
export function urlApi(caminho: string, parametros?: Parametros): string {
  return `${PREFIXO_API}${caminho}${montarConsulta(parametros)}`;
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OpcoesRequisicao {
  metodo?: Metodo;
  corpo?: unknown;
  parametros?: Parametros;
  sinal?: AbortSignal;
  /** false no login e na leitura da sessão: 401 ali é resposta esperada, não sessão expirada. */
  tratar401?: boolean;
}

const MENSAGENS_PADRAO: Record<number, { codigo: string; mensagem: string }> = {
  400: { codigo: 'VALIDACAO', mensagem: 'Os dados enviados não são válidos.' },
  401: { codigo: 'NAO_AUTENTICADO', mensagem: 'Sua sessão expirou. Entre novamente.' },
  403: { codigo: 'SEM_PERMISSAO', mensagem: 'Seu perfil não tem permissão para esta operação.' },
  404: { codigo: 'NAO_ENCONTRADO', mensagem: 'O registro não foi encontrado ou não está no seu escopo.' },
  409: { codigo: 'CONFLITO', mensagem: 'O registro foi alterado por outra pessoa. Atualize e tente novamente.' },
  422: { codigo: 'REGRA_NEGOCIO', mensagem: 'A operação não atende a uma regra de negócio.' },
  429: { codigo: 'LIMITE_TENTATIVAS', mensagem: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.' },
};

function ehRespostaErro(valor: unknown): valor is RespostaErro {
  if (typeof valor !== 'object' || valor === null || !('erro' in valor)) return false;
  const erro = valor.erro;
  return typeof erro === 'object' && erro !== null && 'mensagem' in erro && typeof erro.mensagem === 'string';
}

async function lerErro(resposta: Response): Promise<ErroApi> {
  const idCabecalho = resposta.headers.get('x-request-id') ?? resposta.headers.get('x-id-requisicao');
  let corpo: unknown = null;
  const tipo = resposta.headers.get('content-type') ?? '';
  if (tipo.includes('application/json')) {
    try {
      corpo = await resposta.json();
    } catch {
      corpo = null;
    }
  }
  if (ehRespostaErro(corpo)) {
    return new ErroApi({
      status: resposta.status,
      codigo: corpo.erro.codigo,
      mensagem: corpo.erro.mensagem,
      detalhes: corpo.erro.detalhes,
      idRequisicao: corpo.erro.idRequisicao || idCabecalho,
    });
  }
  const padrao = MENSAGENS_PADRAO[resposta.status] ?? {
    codigo: 'INTERNO',
    mensagem: 'O servidor não conseguiu concluir a operação. Tente novamente em instantes.',
  };
  return new ErroApi({ status: resposta.status, ...padrao, idRequisicao: idCabecalho });
}

async function executar(caminho: string, opcoes: OpcoesRequisicao): Promise<Response> {
  const metodo = opcoes.metodo ?? 'GET';
  const cabecalhos: Record<string, string> = { Accept: 'application/json' };
  if (opcoes.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (metodo !== 'GET' && tokenCsrf) cabecalhos['X-Agora-CSRF'] = tokenCsrf;

  let resposta: Response;
  try {
    resposta = await fetch(urlApi(caminho, opcoes.parametros), {
      method: metodo,
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      credentials: 'same-origin',
      signal: opcoes.sinal,
    });
  } catch (causa) {
    if (causa instanceof DOMException && causa.name === 'AbortError') throw causa;
    throw new ErroApi({
      status: 0,
      codigo: 'REDE',
      mensagem: 'Não foi possível conectar ao servidor da Ágora. Verifique a conexão e tente novamente.',
      idRequisicao: null,
    });
  }

  if (resposta.status === 401 && opcoes.tratar401 !== false) aoNaoAutenticado?.();
  if (!resposta.ok) {
    const erro = await lerErro(resposta);
    if (erro.status === 403 && erro.codigo === CODIGO_TROCA_SENHA) aoExigirTrocaSenha?.();
    throw erro;
  }
  return resposta;
}

/** Requisição que devolve JSON. */
export async function requisitar<T>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const resposta = await executar(caminho, opcoes);
  const dados: unknown = await resposta.json();
  return dados as T;
}

/** Requisição sem corpo de resposta (204). */
export async function requisitarSemCorpo(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<void> {
  await executar(caminho, opcoes);
}

export const api = {
  ler: <T>(caminho: string, parametros?: Parametros, sinal?: AbortSignal) => requisitar<T>(caminho, { parametros, sinal }),
  criar: <T>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: 'POST', corpo: corpo ?? {} }),
  substituir: <T>(caminho: string, corpo: unknown) => requisitar<T>(caminho, { metodo: 'PUT', corpo }),
  alterar: <T>(caminho: string, corpo: unknown) => requisitar<T>(caminho, { metodo: 'PATCH', corpo }),
  acionar: (caminho: string, corpo?: unknown) => requisitarSemCorpo(caminho, { metodo: 'POST', corpo: corpo ?? {} }),
  remover: (caminho: string) => requisitarSemCorpo(caminho, { metodo: 'DELETE' }),
};

/** Mensagem pronta para exibir a partir de qualquer erro. */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.mensagem;
  if (erro instanceof Error) return erro.message;
  return 'Ocorreu um erro inesperado.';
}

/**
 * POST com corpo arbitrário (arquivo ou JSON) e cabeçalhos próprios, com CSRF e o mesmo tratamento de erros.
 * Usado no envio e no download de documentos do processo (o arquivo trafega só entre o navegador e a API).
 */
async function postarBruto(caminho: string, corpo: BodyInit, cabecalhosExtras: Record<string, string>, parametros?: Parametros): Promise<Response> {
  const cabecalhos: Record<string, string> = { ...cabecalhosExtras };
  if (tokenCsrf) cabecalhos['X-Agora-CSRF'] = tokenCsrf;
  let resposta: Response;
  try {
    resposta = await fetch(urlApi(caminho, parametros), { method: 'POST', headers: cabecalhos, body: corpo, credentials: 'same-origin' });
  } catch {
    throw new ErroApi({
      status: 0,
      codigo: 'REDE',
      mensagem: 'Não foi possível conectar ao servidor da Ágora. Verifique a conexão e tente novamente.',
      idRequisicao: null,
    });
  }
  if (resposta.status === 401) aoNaoAutenticado?.();
  if (!resposta.ok) {
    const erro = await lerErro(resposta);
    if (erro.status === 403 && erro.codigo === CODIGO_TROCA_SENHA) aoExigirTrocaSenha?.();
    throw erro;
  }
  return resposta;
}

/** Envia um arquivo como corpo binário; o servidor confere o tipo pelo conteúdo. Devolve o JSON da resposta. */
export async function enviarArquivo<T>(caminho: string, arquivo: Blob, nomeArquivo: string, parametros?: Parametros): Promise<T> {
  const resposta = await postarBruto(
    caminho,
    arquivo,
    { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Agora-Nome-Arquivo': encodeURIComponent(nomeArquivo) },
    parametros,
  );
  return (await resposta.json()) as T;
}

/** Baixa um arquivo por POST (a requisição leva a finalidade do acesso quando há dado pessoal). */
export async function baixarArquivoApi(caminho: string, corpo: unknown): Promise<{ conteudo: Blob; nome: string | null }> {
  const resposta = await postarBruto(caminho, JSON.stringify(corpo ?? {}), { Accept: '*/*', 'Content-Type': 'application/json' });
  const disposicao = resposta.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposicao)?.[1];
  const ascii = /filename="([^"]+)"/i.exec(disposicao)?.[1];
  let nome: string | null = ascii ?? null;
  if (utf8) {
    try {
      nome = decodeURIComponent(utf8);
    } catch {
      nome = ascii ?? null;
    }
  }
  return { conteudo: await resposta.blob(), nome };
}
