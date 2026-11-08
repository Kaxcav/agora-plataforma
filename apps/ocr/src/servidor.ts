/**
 * Serviço de OCR da Ágora (RIA-08): microsserviço interno, sem dependências npm, que embrulha o Tesseract (idioma
 * português) e o pdftoppm (Poppler) para converter PDF digitalizado em imagem. Só a API da Ágora o chama, pela rede
 * interna (AGORA_OCR_URL); não acessa a internet nem guarda arquivos (usa um diretório temporário por pedido).
 *
 *   POST /v1/ocr   corpo: PDF, PNG ou JPEG   → { motor, confianca, paginas: [{ numero, linhas: [{ texto, confianca }] }] }
 *   GET  /saude    → { situacao, motor }
 *
 * Variáveis: OCR_PORTA (8080), OCR_HOST (0.0.0.0), OCR_TAMANHO_MAXIMO_MB (25), OCR_MAXIMO_PAGINAS (30),
 * OCR_RESOLUCAO_DPI (300), OCR_TIMEOUT_SEGUNDOS (240), OCR_SIMULTANEOS (1).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confiancaMedia, formatoEntrada, linhasDoTsv, type LinhaOcr } from './tsv.ts';

function inteiro(nome: string, padrao: number, minimo: number, maximo: number): number {
  const valor = Number(process.env[nome] ?? padrao);
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) throw new Error(`${nome} inválido: use um inteiro de ${minimo} a ${maximo}.`);
  return valor;
}

const PORTA = inteiro('OCR_PORTA', 8080, 1, 65535);
const HOST = process.env.OCR_HOST ?? '0.0.0.0';
const TAMANHO_MAXIMO = inteiro('OCR_TAMANHO_MAXIMO_MB', 25, 1, 200) * 1024 * 1024;
const MAXIMO_PAGINAS = inteiro('OCR_MAXIMO_PAGINAS', 30, 1, 500);
const DPI = inteiro('OCR_RESOLUCAO_DPI', 300, 100, 600);
const TIMEOUT_MS = inteiro('OCR_TIMEOUT_SEGUNDOS', 240, 10, 3600) * 1000;
const SIMULTANEOS = inteiro('OCR_SIMULTANEOS', 1, 1, 16);

function executar(programa: string, argumentos: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    // execFile, sem shell: nenhum dado do pedido vira comando.
    execFile(programa, argumentos, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', OMP_THREAD_LIMIT: '1' } }, (erro, saida, saidaErro) => {
      if (erro) rejeitar(new Error(`${programa} falhou: ${(saidaErro || erro.message).slice(0, 300)}`));
      else resolver(saida);
    });
  });
}

/** Log estruturado em JSON (uma linha por evento), sem conteúdo do documento. */
function registrar(nivel: 'info' | 'erro', mensagem: string, dados: Record<string, unknown> = {}): void {
  const linha = JSON.stringify({ nivel, mensagem, ...dados });
  if (nivel === 'erro') console.error(linha);
  else console.log(linha);
}

function detalheDe(erro: unknown): Record<string, unknown> {
  return { detalhe: String(erro).slice(0, 500) };
}

const FALHA_OCR = { erro: 'Falha ao reconhecer o texto do documento.' };

let motor = 'Tesseract (versão desconhecida)';
async function identificarMotor(): Promise<boolean> {
  try {
    const versao = (await executar('tesseract', ['--version'], 10_000)).split(/\r?\n/)[0]?.trim();
    const idiomas = await executar('tesseract', ['--list-langs'], 10_000);
    if (!/^por$/m.test(idiomas)) throw new Error('idioma "por" ausente');
    motor = `${versao ?? 'tesseract'} (por) + pdftoppm`;
    return true;
  } catch (erro) {
    registrar('erro', 'tesseract indisponível', detalheDe(erro));
    return false;
  }
}

async function reconhecer(conteudo: Buffer, formato: 'pdf' | 'png' | 'jpeg'): Promise<{ numero: number; linhas: LinhaOcr[] }[]> {
  const dir = await mkdtemp(join(tmpdir(), 'agora-ocr-'));
  try {
    const entrada = join(dir, `entrada.${formato === 'jpeg' ? 'jpg' : formato}`);
    await writeFile(entrada, conteudo, { mode: 0o600 });
    let imagens: string[];
    if (formato === 'pdf') {
      await executar('pdftoppm', ['-r', String(DPI), '-gray', '-png', '-f', '1', '-l', String(MAXIMO_PAGINAS), entrada, join(dir, 'pagina')], TIMEOUT_MS);
      imagens = (await readdir(dir)).filter((n) => /^pagina-\d+\.png$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0])).map((n) => join(dir, n));
    } else {
      imagens = [entrada];
    }
    const paginas: { numero: number; linhas: LinhaOcr[] }[] = [];
    for (const [i, imagem] of imagens.entries()) {
      const tsv = await executar('tesseract', [imagem, 'stdout', '-l', 'por', '--psm', '3', 'tsv'], TIMEOUT_MS);
      paginas.push({ numero: i + 1, linhas: linhasDoTsv(tsv) });
    }
    return paginas;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(texto), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(texto);
}

function lerCorpo(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolver, rejeitar) => {
    const declarado = Number(req.headers['content-length'] ?? 0);
    if (declarado > TAMANHO_MAXIMO) {
      req.resume();
      resolver(null);
      return;
    }
    const partes: Buffer[] = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (parte: Buffer) => {
      total += parte.length;
      if (total > TAMANHO_MAXIMO) excedeu = true;
      else partes.push(parte);
    });
    req.on('end', () => resolver(excedeu ? null : Buffer.concat(partes)));
    req.on('error', rejeitar);
  });
}

let emAndamento = 0;
let disponivel = false;

const servidor = createServer(async (req, res) => {
  const caminho = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'GET' && caminho === '/saude') {
      responder(res, disponivel ? 200 : 503, { situacao: disponivel ? 'ok' : 'indisponivel', motor });
      return;
    }
    if (req.method !== 'POST' || caminho !== '/v1/ocr') {
      responder(res, 404, { erro: 'Recurso não encontrado.' });
      return;
    }
    if (!disponivel) {
      responder(res, 503, { erro: 'Tesseract indisponível no contêiner.' });
      return;
    }
    if (emAndamento >= SIMULTANEOS) {
      req.resume();
      responder(res, 503, { erro: 'Serviço ocupado; tente novamente.' });
      return;
    }
    emAndamento++;
    try {
      const corpo = await lerCorpo(req);
      if (corpo === null) {
        responder(res, 413, { erro: `Arquivo acima de ${Math.round(TAMANHO_MAXIMO / 1024 / 1024)} MB.` });
        return;
      }
      const formato = formatoEntrada(corpo);
      if (formato === null) {
        responder(res, 415, { erro: 'Envie PDF, PNG ou JPEG.' });
        return;
      }
      const inicio = Date.now();
      const paginas = await reconhecer(corpo, formato);
      responder(res, 200, { motor, confianca: confiancaMedia(paginas), duracaoMs: Date.now() - inicio, paginas });
      registrar('info', 'ocr concluído', { formato, bytes: corpo.length, paginas: paginas.length, duracaoMs: Date.now() - inicio });
    } finally {
      emAndamento--;
    }
  } catch (erro) {
    registrar('erro', 'falha no ocr', detalheDe(erro));
    if (!res.headersSent) responder(res, 500, FALHA_OCR);
    return;
  }
});

servidor.requestTimeout = TIMEOUT_MS + 30_000;
disponivel = await identificarMotor();
servidor.listen(PORTA, HOST, () => registrar('info', 'serviço de OCR no ar', { porta: PORTA, motor, disponivel }));

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
