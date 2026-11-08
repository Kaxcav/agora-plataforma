/**
 * Cliente SMTP mínimo para o servidor de e-mail institucional do órgão (RFC 5321), sem dependências externas:
 * EHLO, STARTTLS ou TLS implícito, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO e DATA. A mensagem é texto puro em
 * UTF-8 (corpo em base64, assunto em RFC 2047). Respostas 5xx são falhas permanentes (não adianta repetir).
 */
import { randomUUID } from 'node:crypto';
import { connect as conectarTcp, type Socket } from 'node:net';
import { connect as conectarTls } from 'node:tls';
import type { ConfigSmtp } from '../../config.ts';

export interface MensagemEmail {
  para: string;
  nomeRemetente: string;
  assunto: string;
  texto: string;
  /** Instante do cabeçalho Date (relógio da aplicação). */
  agora: Date;
}

export interface ResultadoSmtp {
  idMensagem: string;
  resposta: string;
}

export class ErroSmtp extends Error {
  readonly permanente: boolean;
  readonly codigo: number | null;
  constructor(mensagem: string, opcoes: { permanente?: boolean; codigo?: number | null; cause?: unknown } = {}) {
    super(mensagem, { cause: opcoes.cause });
    this.name = 'ErroSmtp';
    this.permanente = opcoes.permanente ?? false;
    this.codigo = opcoes.codigo ?? null;
  }
}

interface Resposta {
  codigo: number;
  texto: string;
}

const ENDERECO_SEGURO = /^[^\s<>()\\,;:"@]+@[^\s<>()\\,;:"@]+$/;

/** Lê respostas SMTP (linhas "250-..." continuam; "250 ..." encerra) do socket atual. */
class LeitorRespostas {
  #buffer = '';
  #linhas: string[] = [];
  #espera: { resolver: (r: Resposta) => void; rejeitar: (e: Error) => void } | null = null;
  #erro: Error | null = null;
  #socket: Socket | null = null;
  readonly #aoDados = (pedaco: Buffer) => {
    this.#buffer += pedaco.toString('utf8');
    let fim = this.#buffer.indexOf('\n');
    while (fim >= 0) {
      this.#linhas.push(this.#buffer.slice(0, fim).replace(/\r$/, ''));
      this.#buffer = this.#buffer.slice(fim + 1);
      fim = this.#buffer.indexOf('\n');
    }
    this.#entregar();
  };
  readonly #aoErro = (erro: Error) => this.#falhar(new ErroSmtp(`Falha na conexão com o servidor SMTP: ${erro.message}`, { cause: erro }));
  readonly #aoFechar = () => this.#falhar(new ErroSmtp('O servidor SMTP encerrou a conexão.'));

  ligar(socket: Socket): void {
    this.desligar();
    this.#socket = socket;
    socket.on('data', this.#aoDados);
    socket.on('error', this.#aoErro);
    socket.on('close', this.#aoFechar);
  }

  desligar(): void {
    if (!this.#socket) return;
    this.#socket.off('data', this.#aoDados);
    this.#socket.off('error', this.#aoErro);
    this.#socket.off('close', this.#aoFechar);
    this.#socket = null;
  }

  falhar(erro: Error): void {
    this.#falhar(erro);
  }

  #falhar(erro: Error): void {
    if (this.#erro) return;
    this.#erro = erro;
    const espera = this.#espera;
    this.#espera = null;
    espera?.rejeitar(erro);
  }

  #entregar(): void {
    if (!this.#espera) return;
    const fim = this.#linhas.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (fim < 0) return;
    const linhas = this.#linhas.splice(0, fim + 1);
    const ultima = linhas[linhas.length - 1] ?? '';
    const espera = this.#espera;
    this.#espera = null;
    espera.resolver({ codigo: Number(ultima.slice(0, 3)), texto: linhas.map((l) => l.slice(4)).join('\n') });
  }

  proxima(): Promise<Resposta> {
    if (this.#erro) return Promise.reject(this.#erro);
    return new Promise((resolver, rejeitar) => {
      this.#espera = { resolver, rejeitar };
      this.#entregar();
    });
  }
}

/** Palavras codificadas RFC 2047 (UTF-8, base64), em pedaços de até 45 bytes e com dobra de linha. */
export function codificarCabecalho(texto: string): string {
  const limpo = texto.replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(limpo)) return limpo;
  const partes: string[] = [];
  let atual = '';
  for (const caractere of limpo) {
    if (Buffer.byteLength(atual + caractere, 'utf8') > 45) {
      partes.push(atual);
      atual = '';
    }
    atual += caractere;
  }
  if (atual) partes.push(atual);
  return partes.map((p) => `=?UTF-8?B?${Buffer.from(p, 'utf8').toString('base64')}?=`).join('\r\n ');
}

function dataRfc5322(agora: Date): string {
  return agora.toUTCString().replace(/GMT$/, '+0000');
}

/** Monta a mensagem (cabeçalhos e corpo em base64 com linhas de 76 caracteres) já com o ponto final do DATA. */
export function montarMensagemSmtp(config: Pick<ConfigSmtp, 'remetente'>, m: MensagemEmail, idMensagem: string): string {
  const corpo = Buffer.from(m.texto.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const linhasCorpo = corpo.match(/.{1,76}/g) ?? [];
  const cabecalhos = [
    `From: ${codificarCabecalho(m.nomeRemetente)} <${config.remetente}>`,
    `To: <${m.para}>`,
    `Subject: ${codificarCabecalho(m.assunto)}`,
    `Date: ${dataRfc5322(m.agora)}`,
    `Message-ID: ${idMensagem}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
  ];
  // Base64 nunca começa linha com ".", mas o "dot-stuffing" fica por garantia (RFC 5321, 4.5.2).
  const linhas = [...cabecalhos, '', ...linhasCorpo].map((l) => (l.startsWith('.') ? `.${l}` : l));
  return `${linhas.join('\r\n')}\r\n.\r\n`;
}

function dominioDe(endereco: string): string {
  return endereco.slice(endereco.lastIndexOf('@') + 1) || 'localhost';
}

function abrir(config: ConfigSmtp): Promise<Socket> {
  return new Promise((resolver, rejeitar) => {
    const socket =
      config.seguranca === 'tls'
        ? conectarTls({ host: config.host, port: config.porta, servername: config.host }, () => resolver(socket))
        : conectarTcp({ host: config.host, port: config.porta }, () => resolver(socket));
    socket.once('error', (erro) => rejeitar(new ErroSmtp(`Não foi possível conectar ao servidor SMTP: ${erro.message}`, { cause: erro })));
  });
}

function elevarParaTls(socket: Socket, host: string): Promise<Socket> {
  // Depois do STARTTLS os erros chegam pelo socket TLS; o socket puro só precisa não derrubar o processo.
  socket.on('error', () => undefined);
  return new Promise((resolver, rejeitar) => {
    const seguro = conectarTls({ socket, servername: host }, () => resolver(seguro));
    seguro.once('error', (erro) => rejeitar(new ErroSmtp(`Falha ao iniciar TLS (STARTTLS): ${erro.message}`, { cause: erro })));
  });
}

/** Envia um e-mail pelo servidor SMTP configurado. Lança `ErroSmtp` (permanente em respostas 5xx). */
export async function enviarEmailSmtp(config: ConfigSmtp, m: MensagemEmail): Promise<ResultadoSmtp> {
  if (!ENDERECO_SEGURO.test(m.para)) throw new ErroSmtp('Endereço de destino inválido.', { permanente: true });
  if (!ENDERECO_SEGURO.test(config.remetente)) throw new ErroSmtp('Endereço remetente inválido.', { permanente: true });
  const idMensagem = `<${randomUUID()}@${dominioDe(config.remetente)}>`;
  const leitor = new LeitorRespostas();
  let socket = await abrir(config);
  const prazo = () => leitor.falhar(new ErroSmtp(`O servidor SMTP não respondeu em ${config.timeoutMs} ms.`));
  socket.setTimeout(config.timeoutMs, prazo);
  leitor.ligar(socket);

  const esperar = async (aceitos: readonly number[], etapa: string): Promise<Resposta> => {
    const r = await leitor.proxima();
    if (!aceitos.includes(r.codigo)) {
      throw new ErroSmtp(`O servidor SMTP recusou ${etapa}: ${r.codigo} ${r.texto.split('\n').at(-1) ?? ''}`.trim(), {
        permanente: r.codigo >= 500,
        codigo: r.codigo,
      });
    }
    return r;
  };
  const comando = async (linha: string, aceitos: readonly number[], etapa: string): Promise<Resposta> => {
    socket.write(`${linha}\r\n`);
    return esperar(aceitos, etapa);
  };

  try {
    await esperar([220], 'a conexão');
    const nome = dominioDe(config.remetente);
    let ehlo = await comando(`EHLO ${nome}`, [250], 'o EHLO');
    if (config.seguranca === 'starttls') {
      if (!/^STARTTLS\b/im.test(ehlo.texto)) throw new ErroSmtp('O servidor SMTP não oferece STARTTLS.', { permanente: true });
      await comando('STARTTLS', [220], 'o STARTTLS');
      leitor.desligar();
      socket.setTimeout(0);
      socket = await elevarParaTls(socket, config.host);
      socket.setTimeout(config.timeoutMs, prazo);
      leitor.ligar(socket);
      ehlo = await comando(`EHLO ${nome}`, [250], 'o EHLO após o STARTTLS');
    }
    if (config.usuario !== null && config.senha !== null) {
      const mecanismos = /^AUTH[ =](.*)$/im.exec(ehlo.texto)?.[1]?.toUpperCase() ?? '';
      if (mecanismos.includes('PLAIN') || !mecanismos.includes('LOGIN')) {
        const credencial = Buffer.from(`\u0000${config.usuario}\u0000${config.senha}`, 'utf8').toString('base64');
        await comando(`AUTH PLAIN ${credencial}`, [235], 'a autenticação');
      } else {
        await comando('AUTH LOGIN', [334], 'a autenticação');
        await comando(Buffer.from(config.usuario, 'utf8').toString('base64'), [334], 'o usuário');
        await comando(Buffer.from(config.senha, 'utf8').toString('base64'), [235], 'a senha');
      }
    }
    await comando(`MAIL FROM:<${config.remetente}>`, [250], 'o remetente');
    await comando(`RCPT TO:<${m.para}>`, [250, 251], 'o destinatário');
    await comando('DATA', [354], 'o início da mensagem');
    socket.write(montarMensagemSmtp(config, m, idMensagem));
    const aceite = await esperar([250], 'a mensagem');
    // A mensagem já foi aceita: o QUIT é cortesia e não pode atrasar nem derrubar o envio.
    socket.write('QUIT\r\n');
    await Promise.race([leitor.proxima().catch(() => undefined), new Promise((resolver) => setTimeout(resolver, 1000).unref())]);
    return { idMensagem, resposta: `${aceite.codigo} ${aceite.texto}`.trim() };
  } finally {
    leitor.desligar();
    socket.setTimeout(0);
    socket.end();
    socket.destroy();
  }
}
