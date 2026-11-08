/**
 * Cliente da API de manutenção do PNCP (Manual de Integração PNCP 2.2.x), chamado só pelo servidor, pelo trabalhador
 * da fila (RNF-07). Uma chamada por execução: novas tentativas e fila de erro são decididas pela fila.
 *   * Login: POST /v1/usuarios/login { login, senha } → JWT no cabeçalho `Authorization` (válido por 1 hora).
 *   * Compra com o documento principal: POST /v1/orgaos/{cnpj}/compras, multipart (partes `compra` e `documento`),
 *     cabeçalhos `Titulo-Documento` e `Tipo-Documento-Id` → 201 com `location`.
 *   * Anexos da compra: POST /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos, multipart (parte `arquivo`).
 *   * Ata: POST /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/atas (JSON). Contrato: POST /v1/orgaos/{cnpj}/contratos (JSON).
 * Respostas: 2xx sucesso; 401 refaz o login uma vez; 408/425/429/5xx e falhas de rede são transitórias (nova
 * tentativa); os demais 4xx são definitivos e vão para a fila de erro (`classificarRespostaHttp`).
 */
import { classificarRespostaHttp, interpretarLocalizacaoPncp, type ItemPlanoPncp, type LocalizacaoPncp } from '@agora/dominio';
import { FalhaTarefa } from '../fila/tipos.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

export interface ArquivoPncp {
  nome: string;
  conteudo: Buffer;
  titulo: string;
  tipoDocumentoId: number;
}

/** Item da contratação no formato do PNCP (seção 6.3.1 do manual). */
export interface ItemCompraPncp {
  numeroItem: number;
  materialOuServico: 'M' | 'S';
  tipoBeneficioId: number;
  incentivoProdutivoBasico: boolean;
  descricao: string;
  quantidade: number;
  unidadeMedida: string;
  orcamentoSigiloso: boolean;
  valorUnitarioEstimado: number;
  valorTotal: number;
  criterioJulgamentoId: number;
  itemCategoriaId: number;
}

export interface CompraPncp {
  codigoUnidadeCompradora: string;
  tipoInstrumentoConvocatorioId: number;
  modalidadeId: number;
  modoDisputaId: number;
  numeroCompra: string;
  anoCompra: number;
  numeroProcesso: string;
  objetoCompra: string;
  srp: boolean;
  dataAberturaProposta: string;
  dataEncerramentoProposta: string;
  amparoLegalId: number;
  itensCompra: ItemCompraPncp[];
}

export interface ContratoPncp {
  cnpjCompra: string;
  anoCompra: number;
  sequencialCompra: number;
  tipoContratoId: number;
  numeroContratoEmpenho: string;
  anoContrato: number;
  processo: string;
  categoriaProcessoId: number;
  receita: boolean;
  codigoUnidade: string;
  niFornecedor: string;
  tipoPessoaFornecedor: 'PJ' | 'PF';
  nomeRazaoSocialFornecedor: string;
  objetoContrato: string;
  valorInicial: number;
  numeroParcelas: number;
  valorGlobal: number;
  dataAssinatura: string;
  dataVigenciaInicio: string;
  dataVigenciaFim: string;
}

export interface AtaPncp {
  numeroAtaRegistroPreco: string;
  anoAta: number;
  dataAssinatura: string;
  dataVigenciaInicio: string;
  dataVigenciaFim: string;
}

/** Plano de contratações anual de uma unidade (seção 6.7.1 do manual: `POST /v1/orgaos/{cnpj}/pca`). */
export interface PlanoPncp {
  codigoUnidade: string;
  anoPca: number;
  itensPlano: ItemPlanoPncp[];
}

export interface RespostaInclusao {
  /** Endereço do registro criado, devolvido no `location` (protocolo do PNCP). */
  localizacao: string;
  registro: LocalizacaoPncp;
}

export interface OpcoesClientePncp {
  urlBase: string;
  usuario: string;
  senha: string;
  fetch: FuncaoFetch;
  /** Tempo máximo por requisição (envio de arquivos de até 30 MB). */
  timeoutMs?: number;
}

/** Cabeçalhos HTTP só aceitam texto simples: sem acentos nem símbolos fora do ASCII. */
export function textoCabecalho(texto: string): string {
  return texto
    .replace(/º/g, 'o')
    .replace(/ª/g, 'a')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .trim();
}

/** Valor em reais com até 4 casas, a partir de centavos (o PNCP trabalha com decimais). */
export function reais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** Tokens por servidor PNCP e usuário, renovados antes de 1 hora (o manual pede um único token durante a validade). */
const tokens = new WeakMap<FuncaoFetch, Map<string, { token: string; expiraEm: number }>>();
const VALIDADE_TOKEN_MS = 50 * 60 * 1000;

function mensagemDoCorpo(corpo: string): string {
  const texto = corpo.trim();
  if (texto === '') return '';
  try {
    const json = JSON.parse(texto) as Record<string, unknown>;
    const candidata = json['message'] ?? json['mensagem'] ?? json['erro'] ?? json['error'] ?? json['detail'];
    if (typeof candidata === 'string') return candidata.slice(0, 500);
  } catch {
    // Corpo não é JSON: usa o texto.
  }
  return texto.slice(0, 500);
}

function falhaDeRede(erro: unknown, operacao: string, timeoutMs: number): FalhaTarefa {
  const motivo =
    erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')
      ? `tempo limite de ${timeoutMs} ms excedido`
      : erro instanceof Error
        ? erro.message
        : 'falha de rede';
  return new FalhaTarefa(`PNCP indisponível em ${operacao}: ${motivo}.`, true, { cause: erro });
}

export interface ClientePncp {
  incluirCompra(cnpj: string, compra: CompraPncp, documento: ArquivoPncp): Promise<RespostaInclusao>;
  incluirArquivoCompra(cnpj: string, ano: number, sequencial: number, arquivo: ArquivoPncp): Promise<RespostaInclusao>;
  incluirContrato(cnpj: string, contrato: ContratoPncp): Promise<RespostaInclusao>;
  incluirAta(cnpj: string, anoCompra: number, sequencialCompra: number, ata: AtaPncp): Promise<RespostaInclusao>;
  /** PCA aprovado da unidade (art. 12, § 1º; Decreto 10.947/2022, art. 12, § 2º). */
  incluirPca(cnpj: string, plano: PlanoPncp): Promise<RespostaInclusao>;
}

export function criarClientePncp(o: OpcoesClientePncp): ClientePncp {
  const urlBase = o.urlBase.replace(/\/+$/, '');
  const timeoutMs = o.timeoutMs ?? 60_000;
  const chaveToken = `${urlBase}|${o.usuario}`;

  function cacheTokens(): Map<string, { token: string; expiraEm: number }> {
    let mapa = tokens.get(o.fetch);
    if (!mapa) {
      mapa = new Map();
      tokens.set(o.fetch, mapa);
    }
    return mapa;
  }

  async function login(): Promise<string> {
    let resposta: Response;
    try {
      resposta = await o.fetch(`${urlBase}/v1/usuarios/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: '*/*', 'user-agent': 'Agora/1.0 (publicacao PNCP)' },
        body: JSON.stringify({ login: o.usuario, senha: o.senha }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      throw falhaDeRede(erro, 'login', timeoutMs);
    }
    const natureza = classificarRespostaHttp(resposta.status);
    if (natureza === 'nova_tentativa') throw new FalhaTarefa(`PNCP indisponível no login (HTTP ${resposta.status}).`, true);
    if (natureza !== 'sucesso') {
      throw new FalhaTarefa(
        `PNCP recusou o login do sistema (HTTP ${resposta.status}): confira AGORA_PNCP_USUARIO, AGORA_PNCP_SENHA e o credenciamento do órgão.`,
        false,
      );
    }
    const cabecalho = resposta.headers.get('authorization') ?? '';
    const token = cabecalho.replace(/^Bearer\s+/i, '').trim();
    if (token === '') throw new FalhaTarefa('PNCP aceitou o login, mas não devolveu o token no cabeçalho Authorization.', true);
    cacheTokens().set(chaveToken, { token, expiraEm: Date.now() + VALIDADE_TOKEN_MS });
    return token;
  }

  async function tokenValido(): Promise<string> {
    const guardado = cacheTokens().get(chaveToken);
    if (guardado && guardado.expiraEm > Date.now()) return guardado.token;
    return login();
  }

  /** POST autenticado; 401 renova o token uma vez. Devolve o `location` do 201. */
  async function incluir(operacao: string, caminho: string, montar: () => { corpo: FormData | string; cabecalhos: Record<string, string> }): Promise<RespostaInclusao> {
    for (let renovou = false; ; renovou = true) {
      const token = renovou ? await login() : await tokenValido();
      const { corpo, cabecalhos } = montar();
      let resposta: Response;
      try {
        resposta = await o.fetch(`${urlBase}${caminho}`, {
          method: 'POST',
          headers: { accept: '*/*', 'user-agent': 'Agora/1.0 (publicacao PNCP)', ...cabecalhos, authorization: `Bearer ${token}` },
          body: corpo,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (erro) {
        throw falhaDeRede(erro, operacao, timeoutMs);
      }
      const natureza = classificarRespostaHttp(resposta.status);
      if (natureza === 'reautenticar' && !renovou) {
        cacheTokens().delete(chaveToken);
        continue;
      }
      const texto = await resposta.text().catch(() => '');
      if (natureza === 'nova_tentativa') {
        throw new FalhaTarefa(`PNCP indisponível em ${operacao} (HTTP ${resposta.status}). Nova tentativa automática.`, true);
      }
      if (natureza !== 'sucesso') {
        const detalhe = mensagemDoCorpo(texto);
        throw new FalhaTarefa(`PNCP recusou ${operacao} (HTTP ${resposta.status})${detalhe ? `: ${detalhe}` : '.'}`, false);
      }
      let localizacao = resposta.headers.get('location') ?? '';
      if (localizacao === '' && texto !== '') {
        try {
          const json = JSON.parse(texto) as { compraUri?: unknown };
          if (typeof json.compraUri === 'string') localizacao = json.compraUri;
        } catch {
          // Sem corpo JSON: depende do cabeçalho location.
        }
      }
      try {
        return { localizacao, registro: interpretarLocalizacaoPncp(localizacao) };
      } catch {
        throw new FalhaTarefa(`PNCP respondeu ${resposta.status} em ${operacao}, mas sem o endereço do registro criado (location).`, false);
      }
    }
  }

  function multipart(partes: { nome: string; conteudo: Buffer | string; tipo: string; arquivo: string }[], arquivo: ArquivoPncp) {
    return () => {
      const formulario = new FormData();
      for (const parte of partes) formulario.append(parte.nome, new Blob([parte.conteudo], { type: parte.tipo }), parte.arquivo);
      return {
        corpo: formulario,
        cabecalhos: { 'Titulo-Documento': textoCabecalho(arquivo.titulo), 'Tipo-Documento-Id': String(arquivo.tipoDocumentoId) },
      };
    };
  }

  const json = (valor: unknown) => () => ({ corpo: JSON.stringify(valor), cabecalhos: { 'content-type': 'application/json' } });

  return {
    incluirCompra(cnpj, compra, documento) {
      return incluir(
        'a inclusão da contratação',
        `/v1/orgaos/${cnpj}/compras`,
        multipart(
          [
            { nome: 'compra', conteudo: JSON.stringify(compra), tipo: 'application/json', arquivo: 'compra.json' },
            { nome: 'documento', conteudo: documento.conteudo, tipo: 'application/pdf', arquivo: documento.nome },
          ],
          documento,
        ),
      );
    },
    incluirArquivoCompra(cnpj, ano, sequencial, arquivo) {
      return incluir(
        'a inclusão do anexo',
        `/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`,
        multipart([{ nome: 'arquivo', conteudo: arquivo.conteudo, tipo: 'application/pdf', arquivo: arquivo.nome }], arquivo),
      );
    },
    incluirContrato(cnpj, contrato) {
      return incluir('a inclusão do contrato', `/v1/orgaos/${cnpj}/contratos`, json(contrato));
    },
    incluirAta(cnpj, anoCompra, sequencialCompra, ata) {
      return incluir('a inclusão da ata', `/v1/orgaos/${cnpj}/compras/${anoCompra}/${sequencialCompra}/atas`, json(ata));
    },
    incluirPca(cnpj, plano) {
      return incluir('a inclusão do plano de contratações anual', `/v1/orgaos/${cnpj}/pca`, json(plano));
    },
  };
}
