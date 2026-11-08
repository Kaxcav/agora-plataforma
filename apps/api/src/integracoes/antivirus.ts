/**
 * Verificação antivírus dos documentos enviados (RF-21), pelo clamd do órgão (protocolo INSTREAM do ClamAV, TCP).
 * Desligada por padrão; com `AGORA_ANTIVIRUS_URL` definida, todo envio passa por ela e a falha de comunicação
 * recusa o envio (falha fechada): nenhum arquivo entra sem verificação quando o antivírus está configurado.
 */
import { connect } from 'node:net';
import { ErroIntegracao } from './conector.ts';

export type ResultadoAntivirus = { limpo: true; assinatura: null } | { limpo: false; assinatura: string };

const TAMANHO_BLOCO = 64 * 1024;

/** Envia o conteúdo ao clamd (`tcp://host:porta`) e interpreta a resposta ("stream: OK" ou "stream: <assinatura> FOUND"). */
export function verificarAntivirus(url: string, conteudo: Buffer, timeoutMs = 30_000): Promise<ResultadoAntivirus> {
  const alvo = /^tcp:\/\/([^\s/:]+):(\d{1,5})$/.exec(url);
  if (!alvo) return Promise.reject(new ErroIntegracao('Endereço do antivírus inválido.'));
  const host = alvo[1] ?? '';
  const porta = Number(alvo[2]);
  return new Promise((resolver, rejeitar) => {
    const partes: Buffer[] = [];
    let concluido = false;
    const encerrar = (erro: Error | null, resultado?: ResultadoAntivirus) => {
      if (concluido) return;
      concluido = true;
      socket.destroy();
      if (erro) rejeitar(erro);
      else if (resultado) resolver(resultado);
    };
    const socket = connect({ host, port: porta });
    socket.setTimeout(timeoutMs, () => encerrar(new ErroIntegracao(`Antivírus sem resposta em ${Math.round(timeoutMs / 1000)} s.`)));
    socket.on('error', (erro) => encerrar(new ErroIntegracao(`Antivírus indisponível: ${erro.message}`, { cause: erro })));
    socket.on('data', (dados: Buffer) => {
      partes.push(dados);
      if (dados.includes(0)) socket.end();
    });
    socket.on('end', () => {
      const resposta = Buffer.concat(partes).toString('utf8').replace(/\0/g, '').trim();
      if (/^stream: OK$/i.test(resposta)) encerrar(null, { limpo: true, assinatura: null });
      else {
        const achado = /^stream: (.+) FOUND$/i.exec(resposta);
        if (achado) encerrar(null, { limpo: false, assinatura: (achado[1] ?? '').slice(0, 200) });
        else encerrar(new ErroIntegracao(`Resposta inesperada do antivírus: ${resposta.slice(0, 120) || '(vazia)'}`));
      }
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < conteudo.length; i += TAMANHO_BLOCO) {
        const bloco = conteudo.subarray(i, i + TAMANHO_BLOCO);
        const tamanho = Buffer.alloc(4);
        tamanho.writeUInt32BE(bloco.length, 0);
        socket.write(tamanho);
        socket.write(bloco);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
