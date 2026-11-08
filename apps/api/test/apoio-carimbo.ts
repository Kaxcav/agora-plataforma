/**
 * Autoridade de carimbo do tempo simulada (RFC 3161) para os testes: chave ECDSA P-256 gerada na hora, certificado
 * X.509 autoassinado com uso estendido "timeStamping" e respostas TimeStampResp com TSTInfo e assinatura CMS reais.
 * Nenhum serviço externo é chamado.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { der, filhosDer, lerUnico, TAG } from '../src/compartilhado/der.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { OID } from '../src/integracoes/carimbo-tempo.ts';

export interface AutoridadeCarimboFalsa {
  url: string;
  fetch: FuncaoFetch;
  certificadoSha256: string;
  requisicoes: Buffer[];
  /** 'ok' | resposta com outro nonce | recusa (status 2) | fora do ar (503). */
  modo: 'ok' | 'nonce_trocado' | 'recusa' | 'fora_do_ar';
}

export function criarAutoridadeCarimbo(url = 'https://carimbo.orgao.example/tsa'): AutoridadeCarimboFalsa {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const nome = der.sequencia(der.conjunto(der.sequencia(der.oid('2.5.4.3'), der.utf8('Autoridade de carimbo do tempo sintética'))));
  const algoritmo = der.sequencia(der.oid(OID.ecdsaSha256));
  const serialCertificado = 0x5a17n;
  const tbs = der.sequencia(
    der.explicito(0, der.inteiro(2)),
    der.inteiro(serialCertificado),
    algoritmo,
    nome,
    der.sequencia(der.utcTime(new Date('2025-01-01T00:00:00Z')), der.utcTime(new Date('2040-01-01T00:00:00Z'))),
    nome,
    Buffer.from(publicKey.export({ type: 'spki', format: 'der' })),
    der.explicito(3, der.sequencia(der.sequencia(der.oid('2.5.29.37'), der.booleano(true), der.octetos(der.sequencia(der.oid('1.3.6.1.5.5.7.3.8')))))),
  );
  const certificado = der.sequencia(tbs, algoritmo, der.bits(sign('sha256', tbs, privateKey)));
  let serie = 1000n;
  const autoridade: AutoridadeCarimboFalsa = {
    url,
    certificadoSha256: createHash('sha256').update(certificado).digest('hex'),
    requisicoes: [],
    modo: 'ok',
    fetch: async (_entrada, init) => {
      if (autoridade.modo === 'fora_do_ar') return new Response('indisponível', { status: 503 });
      const corpo = Buffer.from(init?.body as Uint8Array);
      autoridade.requisicoes.push(corpo);
      const req = filhosDer(lerUnico(corpo, TAG.sequencia));
      const imprint = req[1];
      const inteiros = req.slice(2).filter((n) => n.tag === TAG.inteiro);
      const nonce = inteiros[0]?.bruto ?? der.inteiro(0);
      if (autoridade.modo === 'recusa') {
        const resposta = der.sequencia(der.sequencia(der.inteiro(2), der.sequencia(der.utf8('política não aceita'))));
        return new Response(new Uint8Array(resposta), { status: 200, headers: { 'content-type': 'application/timestamp-reply' } });
      }
      const tst = der.sequencia(
        der.inteiro(1),
        der.oid('2.16.76.1.6.2'),
        Buffer.from(imprint?.bruto ?? Buffer.alloc(0)),
        der.inteiro(serie++),
        der.generalizedTime(new Date()),
        autoridade.modo === 'nonce_trocado' ? der.inteiro(7) : Buffer.from(nonce),
      );
      const atributos = der.conjunto(
        der.sequencia(der.oid(OID.contentType), der.conjunto(der.oid(OID.tstInfo))),
        der.sequencia(der.oid(OID.messageDigest), der.conjunto(der.octetos(createHash('sha256').update(tst).digest()))),
      );
      const signerInfo = der.sequencia(
        der.inteiro(1),
        der.sequencia(nome, der.inteiro(serialCertificado)),
        der.sequencia(der.oid(OID.sha256)),
        der.implicitoConstruido(0, atributos),
        algoritmo,
        der.octetos(sign('sha256', atributos, privateKey)),
      );
      const signedData = der.sequencia(
        der.inteiro(3),
        der.conjunto(der.sequencia(der.oid(OID.sha256))),
        der.sequencia(der.oid(OID.tstInfo), der.explicito(0, der.octetos(tst))),
        der.implicitoConstruido(0, der.conjunto(certificado)),
        der.conjunto(signerInfo),
      );
      const token = der.sequencia(der.oid(OID.signedData), der.explicito(0, signedData));
      const resposta = der.sequencia(der.sequencia(der.inteiro(0)), token);
      return new Response(new Uint8Array(resposta), { status: 200, headers: { 'content-type': 'application/timestamp-reply' } });
    },
  };
  return autoridade;
}
