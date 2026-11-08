/**
 * Cliente do web service do SEI (SeiWS), conforme o manual "SEI WebServices" v4.0 (seções 1 a 3):
 *   * SOAP 1.1 no estilo RPC/encoded, namespace `Sei`, SOAPAction `SeiAction`, no endereço do serviço
 *     (`.../sei/ws/SeiWS.php`; o WSDL fica em `.../sei/controlador_ws.php?servico=sei`);
 *   * autenticação por `SiglaSistema` e `IdentificacaoServico` (chave de acesso gerada no SEI para o serviço);
 *   * operações: gerarProcedimento, incluirDocumento, consultarDocumento (com as assinaturas), gerarBloco
 *     (bloco de assinatura) e enviarProcesso.
 * Só o servidor chama o SEI (o trabalhador da fila e o canal SEI das notificações). Cada requisição tem tempo
 * limite. SOAP Fault é recusa do SEI (falha definitiva, vai para a fila de erro); rede, tempo esgotado e HTTP 5xx
 * sem Fault são transitórios e voltam para a fila com nova tentativa.
 */
import { dataHoraSeiParaIso } from '@agora/dominio';
import { buscarXml, bytesLatin1, escaparXml, filhoXml, lerXml, textoXml, type NoXml } from '../compartilhado/xml.ts';
import { FalhaTarefa } from '../fila/tipos.ts';
import type { FuncaoFetch } from '../http/contexto.ts';

export interface AcessoSei {
  url: string;
  siglaSistema: string;
  identificacaoServico: string;
  idUnidade: string;
}

export interface OpcoesClienteSei extends AcessoSei {
  fetch: FuncaoFetch;
  timeoutMs?: number;
}

export interface ProcedimentoSei {
  idTipoProcedimento: string;
  especificacao: string;
  observacao: string | null;
  /** 1 = restrito; null = nível sugerido pelo tipo de processo. */
  nivelAcesso: 1 | null;
  idHipoteseLegal: string | null;
}

/** Documento externo (Tipo "R"): o PDF gerado pela Ágora. */
export interface DocumentoExternoSei {
  protocoloProcedimento: string;
  idSerie: string;
  /** Número informado para o documento externo (o SEI não numera documentos externos). */
  numero: string;
  /** Nome complementar exibido na árvore do processo. */
  nomeArvore: string;
  /** Data do documento, dd/mm/aaaa. */
  data: string;
  remetente: { sigla: string; nome: string };
  nomeArquivo: string;
  conteudo: Buffer;
  nivelAcesso: 1 | null;
  idHipoteseLegal: string | null;
  observacao: string | null;
}

export interface RetornoProcedimentoSei {
  idProcedimento: string;
  procedimentoFormatado: string;
  linkAcesso: string | null;
}

export interface RetornoDocumentoSei {
  idDocumento: string;
  documentoFormatado: string;
  linkAcesso: string | null;
}

export interface AssinaturaConsultadaSei {
  nome: string;
  cargoFuncao: string | null;
  /** Instante ISO (UTC). */
  assinadoEm: string;
  sigla: string | null;
}

export interface ConsultaDocumentoSei extends RetornoDocumentoSei {
  assinaturas: AssinaturaConsultadaSei[];
}

export interface ClienteSei {
  gerarProcedimento(procedimento: ProcedimentoSei, unidadesEnvio: readonly string[]): Promise<RetornoProcedimentoSei>;
  incluirDocumento(documento: DocumentoExternoSei): Promise<RetornoDocumentoSei>;
  consultarDocumento(protocoloDocumento: string): Promise<ConsultaDocumentoSei>;
  /** Bloco de assinatura (tipo A) com os documentos; devolve o número do bloco. */
  gerarBloco(p: { descricao: string; documentos: readonly string[]; unidadesDisponibilizacao: readonly string[] }): Promise<string>;
  enviarProcesso(protocoloProcedimento: string, unidadesDestino: readonly string[]): Promise<void>;
}

// ───────────────────────── montagem do envelope ─────────────────────────

type Valor = string | null | { tipo: string; campos: Record<string, Valor> } | { lista: string; itens: Valor[] };

const s = (v: string | null): Valor => v;
const estrutura = (tipo: string, campos: Record<string, Valor>): Valor => ({ tipo, campos });
const lista = (tipoItem: string, itens: Valor[]): Valor => ({ lista: tipoItem, itens });

function serializar(nome: string, valor: Valor): string {
  if (valor === null) return `<${nome} xsi:nil="true"/>`;
  if (typeof valor === 'string') return `<${nome} xsi:type="xsd:string">${escaparXml(valor)}</${nome}>`;
  if ('lista' in valor) {
    const itens = valor.itens.map((item) => serializar('item', item)).join('');
    return `<${nome} xsi:type="soapenc:Array" soapenc:arrayType="${valor.lista}[${valor.itens.length}]">${itens}</${nome}>`;
  }
  const campos = Object.entries(valor.campos)
    .map(([k, v]) => serializar(k, v))
    .join('');
  return `<${nome} xsi:type="sei:${valor.tipo}">${campos}</${nome}>`;
}

/** Envelope SOAP 1.1 RPC/encoded da operação (mesmo formato do exemplo PHP do manual). */
export function envelopeSei(operacao: string, parametros: [string, Valor][]): string {
  const corpo = parametros.map(([nome, valor]) => serializar(nome, valor)).join('');
  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:sei="Sei">' +
    `<soapenv:Body><sei:${operacao} soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">${corpo}</sei:${operacao}></soapenv:Body>` +
    '</soapenv:Envelope>'
  );
}

// ───────────────────────── resposta ─────────────────────────

function decodificarResposta(bytes: ArrayBuffer, contentType: string | null): string {
  const inicio = Buffer.from(bytes.slice(0, 200)).toString('latin1');
  const declarado = /encoding=["']([^"']+)["']/i.exec(inicio)?.[1] ?? /charset=([^;\s]+)/i.exec(contentType ?? '')?.[1] ?? 'utf-8';
  const latin1 = /^(iso-8859-1|latin1|windows-1252)$/i.test(declarado);
  return latin1 ? Buffer.from(bytes).toString('latin1') : new TextDecoder('utf-8').decode(bytes);
}

function textoOuErro(no: NoXml | undefined, campo: string, operacao: string): string {
  const valor = textoXml(no, campo);
  if (valor === null || valor === '') throw new FalhaTarefa(`SEI respondeu ${operacao} sem o campo ${campo}.`, false);
  return valor;
}

/** Itens de um array SOAP-encoded (elementos `item` ou qualquer filho). */
function itensDe(no: NoXml | undefined): NoXml[] {
  return no?.filhos ?? [];
}

function falhaDeRede(erro: unknown, operacao: string, timeoutMs: number): FalhaTarefa {
  const motivo =
    erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')
      ? `tempo limite de ${timeoutMs} ms excedido`
      : erro instanceof Error
        ? erro.message
        : 'falha de rede';
  return new FalhaTarefa(`SEI indisponível em ${operacao}: ${motivo}.`, true, { cause: erro });
}

export function criarClienteSei(o: OpcoesClienteSei): ClienteSei {
  const timeoutMs = o.timeoutMs ?? 60_000;
  // Todas as operações usadas recebem a unidade: a chave de acesso pode restringir o serviço a ela.
  const credenciais: [string, Valor][] = [
    ['SiglaSistema', s(o.siglaSistema)],
    ['IdentificacaoServico', s(o.identificacaoServico)],
    ['IdUnidade', s(o.idUnidade)],
  ];

  /** Chama a operação e devolve o elemento `parametros` da resposta. */
  async function chamar(operacao: string, parametros: [string, Valor][]): Promise<NoXml | undefined> {
    let resposta: Response;
    try {
      resposta = await o.fetch(o.url, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=ISO-8859-1', soapaction: '"SeiAction"', 'user-agent': 'Agora/1.0 (SeiWS)' },
        body: bytesLatin1(envelopeSei(operacao, [...credenciais, ...parametros])),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (erro) {
      throw falhaDeRede(erro, operacao, timeoutMs);
    }
    let texto: string;
    try {
      texto = decodificarResposta(await resposta.arrayBuffer(), resposta.headers.get('content-type'));
    } catch (erro) {
      throw falhaDeRede(erro, operacao, timeoutMs);
    }
    let raiz: NoXml | null = null;
    try {
      raiz = lerXml(texto);
    } catch {
      raiz = null;
    }
    const fault = buscarXml(raiz ?? undefined, 'Fault');
    if (fault) {
      const mensagem = (textoXml(fault, 'faultstring') ?? 'erro não informado').slice(0, 500);
      throw new FalhaTarefa(`SEI recusou ${operacao}: ${mensagem}`, false);
    }
    if (resposta.status === 408 || resposta.status === 429 || resposta.status >= 500) {
      throw new FalhaTarefa(`SEI indisponível em ${operacao} (HTTP ${resposta.status}). Nova tentativa automática.`, true);
    }
    if (resposta.status < 200 || resposta.status >= 300) {
      throw new FalhaTarefa(`SEI recusou ${operacao} (HTTP ${resposta.status}): confira AGORA_SEI_URL e o cadastro do sistema no SEI.`, false);
    }
    if (!raiz) throw new FalhaTarefa(`SEI respondeu ${operacao} com XML inválido.`, false);
    const corpo = buscarXml(raiz, 'Body');
    const retorno = corpo?.filhos[0];
    return filhoXml(retorno, 'parametros') ?? retorno?.filhos[0];
  }

  return {
    async gerarProcedimento(p, unidadesEnvio) {
      const parametros = await chamar('gerarProcedimento', [
        [
          'Procedimento',
          estrutura('Procedimento', {
            IdTipoProcedimento: s(p.idTipoProcedimento),
            NumeroProtocolo: null,
            DataAutuacao: null,
            Especificacao: s(p.especificacao.slice(0, 100)),
            Assuntos: lista('sei:Assunto', []),
            Interessados: lista('sei:Interessado', []),
            Observacao: s(p.observacao),
            NivelAcesso: s(p.nivelAcesso === null ? null : String(p.nivelAcesso)),
            IdHipoteseLegal: s(p.nivelAcesso === null ? null : p.idHipoteseLegal),
          }),
        ],
        ['Documentos', lista('sei:Documento', [])],
        ['ProcedimentosRelacionados', lista('xsd:string', [])],
        ['UnidadesEnvio', lista('xsd:string', [...unidadesEnvio])],
        ['SinManterAbertoUnidade', s('S')],
        ['SinEnviarEmailNotificacao', s('N')],
        ['DataRetornoProgramado', null],
        ['DiasRetornoProgramado', null],
        ['SinDiasUteisRetornoProgramado', s('N')],
        ['IdMarcador', null],
        ['TextoMarcador', null],
        ['DataControlePrazo', null],
        ['DiasControlePrazo', null],
        ['SinDiasUteisControlePrazo', s('N')],
      ]);
      return {
        idProcedimento: textoOuErro(parametros, 'IdProcedimento', 'gerarProcedimento'),
        procedimentoFormatado: textoOuErro(parametros, 'ProcedimentoFormatado', 'gerarProcedimento'),
        linkAcesso: textoXml(parametros, 'LinkAcesso'),
      };
    },

    async incluirDocumento(d) {
      const parametros = await chamar('incluirDocumento', [
        [
          'Documento',
          estrutura('Documento', {
            Tipo: s('R'),
            IdProcedimento: null,
            ProtocoloProcedimento: s(d.protocoloProcedimento),
            IdSerie: s(d.idSerie),
            Numero: s(d.numero),
            NomeArvore: s(d.nomeArvore.slice(0, 60)),
            Data: s(d.data),
            Descricao: null,
            IdTipoConferencia: null,
            SinArquivamento: s('N'),
            Remetente: estrutura('Remetente', { Sigla: s(d.remetente.sigla), Nome: s(d.remetente.nome) }),
            Interessados: lista('sei:Interessado', []),
            Destinatarios: lista('sei:Destinatario', []),
            Observacao: s(d.observacao),
            NomeArquivo: s(d.nomeArquivo),
            NivelAcesso: s(d.nivelAcesso === null ? null : String(d.nivelAcesso)),
            IdHipoteseLegal: s(d.nivelAcesso === null ? null : d.idHipoteseLegal),
            Conteudo: s(d.conteudo.toString('base64')),
          }),
        ],
      ]);
      return {
        idDocumento: textoOuErro(parametros, 'IdDocumento', 'incluirDocumento'),
        documentoFormatado: textoOuErro(parametros, 'DocumentoFormatado', 'incluirDocumento'),
        linkAcesso: textoXml(parametros, 'LinkAcesso'),
      };
    },

    async consultarDocumento(protocoloDocumento) {
      const parametros = await chamar('consultarDocumento', [
        ['ProtocoloDocumento', s(protocoloDocumento)],
        ['SinRetornarAndamentoGeracao', s('N')],
        ['SinRetornarAssinaturas', s('S')],
        ['SinRetornarPublicacao', s('N')],
        ['SinRetornarCampos', s('N')],
      ]);
      const assinaturas: AssinaturaConsultadaSei[] = [];
      for (const item of itensDe(filhoXml(parametros, 'Assinaturas'))) {
        const nome = textoXml(item, 'Nome');
        const dataHora = textoXml(item, 'DataHora');
        if (!nome || !dataHora) continue;
        let assinadoEm: string;
        try {
          assinadoEm = dataHoraSeiParaIso(dataHora);
        } catch {
          throw new FalhaTarefa(`SEI devolveu assinatura com data fora do padrão (${dataHora.slice(0, 30)}).`, false);
        }
        assinaturas.push({ nome, cargoFuncao: textoXml(item, 'CargoFuncao'), assinadoEm, sigla: textoXml(item, 'Sigla') });
      }
      return {
        idDocumento: textoOuErro(parametros, 'IdDocumento', 'consultarDocumento'),
        documentoFormatado: textoOuErro(parametros, 'DocumentoFormatado', 'consultarDocumento'),
        linkAcesso: textoXml(parametros, 'LinkAcesso'),
        assinaturas,
      };
    },

    async gerarBloco(p) {
      const parametros = await chamar('gerarBloco', [
        ['Tipo', s('A')],
        ['Descricao', s(p.descricao.slice(0, 250))],
        ['UnidadesDisponibilizacao', lista('xsd:string', [...p.unidadesDisponibilizacao])],
        ['Documentos', lista('xsd:string', [...p.documentos])],
        ['SinDisponibilizar', s(p.unidadesDisponibilizacao.length > 0 ? 'S' : 'N')],
      ]);
      const numero = parametros?.texto.trim() ?? '';
      if (numero === '') throw new FalhaTarefa('SEI respondeu gerarBloco sem o número do bloco.', false);
      return numero;
    },

    async enviarProcesso(protocoloProcedimento, unidadesDestino) {
      await chamar('enviarProcesso', [
        ['ProtocoloProcedimento', s(protocoloProcedimento)],
        ['UnidadesDestino', lista('xsd:string', [...unidadesDestino])],
        ['SinManterAbertoUnidade', s('S')],
        ['SinRemoverAnotacao', s('N')],
        ['SinEnviarEmailNotificacao', s('N')],
        ['DataRetornoProgramado', null],
        ['DiasRetornoProgramado', null],
        ['SinDiasUteisRetornoProgramado', s('N')],
        ['SinReabrir', s('S')],
      ]);
    },
  };
}
