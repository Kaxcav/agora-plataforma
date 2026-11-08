import type { FastifyInstance } from 'fastify';
import { ErroApi } from '../../http/erros.ts';

const TIPOS_BINARIOS = ['application/octet-stream', 'image/png', 'image/jpeg', 'video/mp4', 'video/quicktime'];

/**
 * Aceita, só no escopo em que for registrado, o arquivo como corpo binário, com limite de tamanho conferido pelo
 * cabeçalho e pelos bytes recebidos (413 acima do limite). O tipo real é conferido depois, pelo conteúdo.
 */
export function aceitarCorpoBinario(escopo: FastifyInstance, limiteBytes: number): void {
  const megabytes = Math.round(limiteBytes / (1024 * 1024));
  const excedeu = () => new ErroApi(413, 'VALIDACAO', `O arquivo passa do limite de ${megabytes} MB.`);
  escopo.addContentTypeParser(TIPOS_BINARIOS, (request, carga, feito) => {
    if (Number(request.headers['content-length'] ?? 0) > limiteBytes) {
      feito(excedeu(), undefined);
      carga.resume();
      return;
    }
    const partes: Buffer[] = [];
    let recebido = 0;
    let encerrado = false;
    carga.on('data', (parte: Buffer) => {
      if (encerrado) return;
      recebido += parte.length;
      if (recebido > limiteBytes) {
        encerrado = true;
        feito(excedeu(), undefined);
        return;
      }
      partes.push(parte);
    });
    carga.on('end', () => {
      if (!encerrado) feito(null, Buffer.concat(partes));
    });
    carga.on('error', (erro: Error) => {
      if (!encerrado) {
        encerrado = true;
        feito(erro, undefined);
      }
    });
  });
}
