/**
 * Cliente do protocolo de carimbo do tempo (Time-Stamp Protocol, RFC 3161), chamado só pelo servidor (RNF-09).
 * A autoridade é configurada pelo órgão (`AGORA_CARIMBO_TEMPO_URL`): servida por ele ou credenciada na ICP-Brasil.
 *   - Requisição: `application/timestamp-query` com o SHA-256 da declaração ancorada, nonce aleatório e pedido do
 *     certificado (certReq), para que o token traga o certificado da autoridade.
 *   - Resposta: `application/timestamp-reply`; status concedido, TSTInfo com a mesma impressão e o mesmo nonce.
 *   - Conferência do token: CMS SignedData — o atributo messageDigest bate com o TSTInfo e a assinatura dos atributos
 *     assinados confere com a chave do certificado; opcionalmente, o certificado é o reconhecido como confiável.
 * Timeout por chamada e uma nova tentativa em falha de rede, 429 ou 5xx.
 */
import { createHash, randomBytes, verify as verificarAssinatura, X509Certificate } from 'node:crypto';
import type { FuncaoFetch } from '../http/contexto.ts';
import { der, ErroDer, exigirTag, filhosDer, lerGeneralizedTime, lerInteiro, lerOid, lerUnico, TAG, type NoDer } from '../compartilhado/der.ts';
import { ErroIntegracao } from './conector.ts';

export const OID = {
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  rsaEncryption: '1.2.840.113549.1.1.1',
  sha256ComRsa: '1.2.840.113549.1.1.11',
  sha384ComRsa: '1.2.840.113549.1.1.12',
  sha512ComRsa: '1.2.840.113549.1.1.13',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  ecdsaSha512: '1.2.840.10045.4.3.4',
} as const;

const RESUMOS: Record<string, string> = { [OID.sha256]: 'sha256', [OID.sha384]: 'sha384', [OID.sha512]: 'sha512' };
const ASSINATURAS: Record<string, string | null> = {
  [OID.rsaEncryption]: null,
  [OID.sha256ComRsa]: 'sha256',
  [OID.sha384ComRsa]: 'sha384',
  [OID.sha512ComRsa]: 'sha512',
  [OID.ecdsaSha256]: 'sha256',
  [OID.ecdsaSha384]: 'sha384',
  [OID.ecdsaSha512]: 'sha512',
};

/** TimeStampReq (RFC 3161, seção 2.4.1) com SHA-256, nonce e pedido do certificado. */
export function montarRequisicaoCarimbo(impressaoHex: string, nonce: bigint, politica: string | null = null): Buffer {
  if (!/^[0-9a-f]{64}$/.test(impressaoHex)) throw new Error('Impressão SHA-256 inválida.');
  return der.sequencia(
    der.inteiro(1),
    der.sequencia(der.sequencia(der.oid(OID.sha256), der.nulo()), der.octetos(Buffer.from(impressaoHex, 'hex'))),
    ...(politica ? [der.oid(politica)] : []),
    der.inteiro(nonce),
    der.booleano(true),
  );
}

export interface CarimboLido {
  /** SHA-256 carimbado (hex). */
  impressao: string;
  algoritmoImpressao: string;
  politica: string;
  numeroSerie: string;
  carimboEm: Date;
  nonce: bigint | null;
  /** Assinatura CMS conferida com a chave do certificado presente no token. */
  assinaturaValida: boolean;
  motivoAssinatura: string | null;
  /** Impressão SHA-256 do certificado do assinante (hex minúsculo), quando presente. */
  certificadoSha256: string | null;
  certificadoTitular: string | null;
}

function hash(algoritmo: string, dados: Buffer): Buffer {
  return createHash(algoritmo).update(dados).digest();
}

/** Lê o TimeStampToken (ContentInfo com SignedData) e confere a assinatura. Lança `ErroDer` se estiver malformado. */
export function lerTokenCarimbo(token: Buffer): CarimboLido {
  const contentInfo = filhosDer(lerUnico(token, TAG.sequencia));
  if (lerOid(exigirTag(contentInfo[0], TAG.oid, 'ContentInfo')) !== OID.signedData) throw new ErroDer('O token não é um SignedData (CMS).');
  const conteudo = exigirTag(contentInfo[1], 0xa0, 'ContentInfo.content');
  const signedData = filhosDer(exigirTag(filhosDer(conteudo)[0], TAG.sequencia, 'SignedData'));
  const encap = filhosDer(exigirTag(signedData[2], TAG.sequencia, 'EncapsulatedContentInfo'));
  if (lerOid(exigirTag(encap[0], TAG.oid, 'eContentType')) !== OID.tstInfo) throw new ErroDer('O conteúdo do token não é um TSTInfo.');
  const eContent = exigirTag(filhosDer(exigirTag(encap[1], 0xa0, 'eContent'))[0], TAG.octetos, 'eContent').conteudo;
  const tst = filhosDer(lerUnico(eContent, TAG.sequencia));
  const politica = lerOid(exigirTag(tst[1], TAG.oid, 'TSTInfo.policy'));
  const imprint = filhosDer(exigirTag(tst[2], TAG.sequencia, 'TSTInfo.messageImprint'));
  const algoritmoImpressao = lerOid(exigirTag(filhosDer(exigirTag(imprint[0], TAG.sequencia, 'hashAlgorithm'))[0], TAG.oid, 'hashAlgorithm'));
  const impressao = exigirTag(imprint[1], TAG.octetos, 'hashedMessage').conteudo.toString('hex');
  const numeroSerie = lerInteiro(exigirTag(tst[3], TAG.inteiro, 'serialNumber')).toString(16);
  const carimboEm = lerGeneralizedTime(exigirTag(tst[4], TAG.generalizedTime, 'genTime'));
  const nonceNo = tst.slice(5).find((n) => n.tag === TAG.inteiro);
  const nonce = nonceNo ? lerInteiro(nonceNo) : null;

  // Certificados ([0] IMPLICIT) e SignerInfo (último SET).
  let indice = 3;
  const certificados: Buffer[] = [];
  if (signedData[indice]?.tag === 0xa0) {
    for (const c of filhosDer(signedData[indice] as NoDer)) if (c.tag === TAG.sequencia) certificados.push(Buffer.from(c.bruto));
    indice++;
  }
  if (signedData[indice]?.tag === 0xa1) indice++;
  const signerInfos = filhosDer(exigirTag(signedData[indice], TAG.conjunto, 'signerInfos'));
  const signer = filhosDer(exigirTag(signerInfos[0], TAG.sequencia, 'SignerInfo'));
  const sid = signer[1];
  const resumo = RESUMOS[lerOid(exigirTag(filhosDer(exigirTag(signer[2], TAG.sequencia, 'digestAlgorithm'))[0], TAG.oid, 'digestAlgorithm'))];
  const atributosNo = signer[3]?.tag === 0xa0 ? signer[3] : null;
  const posAlg = atributosNo ? 4 : 3;
  const algoritmoAssinatura = lerOid(exigirTag(filhosDer(exigirTag(signer[posAlg], TAG.sequencia, 'signatureAlgorithm'))[0], TAG.oid, 'signatureAlgorithm'));
  const assinatura = exigirTag(signer[posAlg + 1], TAG.octetos, 'signature').conteudo;

  let certificado: X509Certificate | null = null;
  const serialSid = sid?.tag === TAG.sequencia ? lerInteiro(exigirTag(filhosDer(sid)[1], TAG.inteiro, 'sid.serialNumber')).toString(16).toUpperCase() : null;
  for (const bruto of certificados) {
    try {
      const c = new X509Certificate(bruto);
      if (certificado === null || (serialSid !== null && c.serialNumber.replace(/^0+/, '').toUpperCase() === serialSid.replace(/^0+/, ''))) certificado = c;
    } catch {
      // certificado ilegível: ignorado
    }
  }

  let assinaturaValida = false;
  let motivoAssinatura: string | null = null;
  if (!resumo) motivoAssinatura = 'Algoritmo de resumo do assinante não suportado.';
  else if (!atributosNo) motivoAssinatura = 'O token não tem atributos assinados (exigidos pela RFC 3161).';
  else if (certificado === null) motivoAssinatura = 'O token não traz o certificado da autoridade de carimbo.';
  else {
    const atributos = filhosDer(atributosNo).map((a) => filhosDer(a));
    const digest = atributos.find((a) => a[0] && lerOid(a[0]) === OID.messageDigest);
    const valorDigest = digest?.[1] ? filhosDer(digest[1])[0] : undefined;
    if (!valorDigest || valorDigest.tag !== TAG.octetos) motivoAssinatura = 'O token não tem o atributo messageDigest.';
    else if (!valorDigest.conteudo.equals(hash(resumo, eContent))) motivoAssinatura = 'O messageDigest não corresponde ao TSTInfo.';
    else {
      const algoritmo = ASSINATURAS[algoritmoAssinatura];
      if (algoritmo === undefined) motivoAssinatura = `Algoritmo de assinatura não suportado (${algoritmoAssinatura}).`;
      else {
        // A assinatura cobre os atributos assinados codificados como SET OF (RFC 5652, seção 5.4).
        const assinado = Buffer.concat([Buffer.from([TAG.conjunto]), atributosNo.bruto.subarray(1)]);
        try {
          assinaturaValida = verificarAssinatura(algoritmo ?? resumo, assinado, certificado.publicKey, assinatura);
          if (!assinaturaValida) motivoAssinatura = 'A assinatura do token não confere com o certificado.';
        } catch {
          motivoAssinatura = 'Não foi possível conferir a assinatura do token.';
        }
      }
    }
  }
  return {
    impressao,
    algoritmoImpressao,
    politica,
    numeroSerie,
    carimboEm,
    nonce,
    assinaturaValida,
    motivoAssinatura,
    certificadoSha256: certificado ? certificado.fingerprint256.replace(/:/g, '').toLowerCase() : null,
    certificadoTitular: certificado ? certificado.subject.replace(/\n/g, ', ') : null,
  };
}

/** Lê a TimeStampResp: status e, se concedido, o token (DER). */
export function lerRespostaCarimbo(resposta: Buffer): { token: Buffer } {
  const partes = filhosDer(lerUnico(resposta, TAG.sequencia));
  const status = filhosDer(exigirTag(partes[0], TAG.sequencia, 'PKIStatusInfo'));
  const codigo = Number(lerInteiro(exigirTag(status[0], TAG.inteiro, 'PKIStatus')));
  if (codigo !== 0 && codigo !== 1) {
    const texto = status[1]?.tag === TAG.sequencia ? filhosDer(status[1]).map((t) => t.conteudo.toString('utf8')).join(' ') : '';
    throw new ErroIntegracao(`A autoridade de carimbo do tempo recusou o pedido (status ${codigo}${texto ? `: ${texto.slice(0, 200)}` : ''}).`);
  }
  const token = partes[1];
  if (!token) throw new ErroIntegracao('A autoridade de carimbo do tempo respondeu sem o token.');
  return { token: Buffer.from(token.bruto) };
}

export interface OpcoesCarimbo {
  url: string;
  usuario: string | null;
  senha: string | null;
  timeoutMs: number;
  politica: string | null;
  novasTentativas?: number;
  esperar?: (ms: number) => Promise<void>;
}

class FalhaRetentavel extends Error {}

export interface CarimboObtido {
  token: Buffer;
  lido: CarimboLido;
  nonce: bigint;
}

/** Pede o carimbo do tempo da impressão (SHA-256 em hex) e confere o que voltou. */
export async function solicitarCarimbo(fetch: FuncaoFetch, opcoes: OpcoesCarimbo, impressaoHex: string): Promise<CarimboObtido> {
  const nonce = BigInt(`0x${randomBytes(8).toString('hex')}`);
  const corpo = montarRequisicaoCarimbo(impressaoHex, nonce, opcoes.politica);
  const tentativas = (opcoes.novasTentativas ?? 1) + 1;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cabecalhos: Record<string, string> = { 'content-type': 'application/timestamp-query', accept: 'application/timestamp-reply' };
  if (opcoes.usuario !== null && opcoes.senha !== null) {
    cabecalhos.authorization = `Basic ${Buffer.from(`${opcoes.usuario}:${opcoes.senha}`, 'utf8').toString('base64')}`;
  }
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    if (tentativa > 0) await esperar(1000 * tentativa);
    try {
      const resposta = await fetch(opcoes.url, { method: 'POST', headers: cabecalhos, body: new Uint8Array(corpo), signal: AbortSignal.timeout(opcoes.timeoutMs) });
      if (resposta.status >= 500 || resposta.status === 429) throw new FalhaRetentavel(`HTTP ${resposta.status}`);
      if (!resposta.ok) throw new ErroIntegracao(`A autoridade de carimbo do tempo recusou a requisição (HTTP ${resposta.status}).`);
      const bruto = Buffer.from(await resposta.arrayBuffer());
      let token: Buffer;
      let lido: CarimboLido;
      try {
        token = lerRespostaCarimbo(bruto).token;
        lido = lerTokenCarimbo(token);
      } catch (erro) {
        if (erro instanceof ErroIntegracao) throw erro;
        throw new ErroIntegracao(`Resposta da autoridade de carimbo do tempo malformada: ${erro instanceof Error ? erro.message : 'erro desconhecido'}.`);
      }
      if (lido.impressao !== impressaoHex || lido.algoritmoImpressao !== OID.sha256) throw new ErroIntegracao('O carimbo devolvido não corresponde à impressão enviada.');
      if (lido.nonce !== nonce) throw new ErroIntegracao('O carimbo devolvido não traz o nonce do pedido (possível resposta repetida).');
      if (!lido.assinaturaValida) throw new ErroIntegracao(`O carimbo devolvido não tem assinatura válida: ${lido.motivoAssinatura ?? 'motivo desconhecido'}.`);
      return { token, lido, nonce };
    } catch (erro) {
      if (erro instanceof ErroIntegracao) throw erro;
      ultimo = erro;
    }
  }
  const motivo =
    ultimo instanceof Error && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError')
      ? `tempo limite de ${Math.round(opcoes.timeoutMs / 1000)} s excedido`
      : ultimo instanceof Error
        ? ultimo.message
        : 'falha desconhecida';
  throw new ErroIntegracao(`A autoridade de carimbo do tempo não respondeu (${motivo}).`);
}

/** Endereço da autoridade sem credenciais nem consulta (para exibir e registrar). */
export function enderecoPublicoAutoridade(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return 'endereço inválido';
  }
}
