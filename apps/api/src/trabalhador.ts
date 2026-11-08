/**
 * Serviço trabalhador da Ágora (RNF-07): consome a fila de integrações e executa os conectores e a publicação no
 * PNCP. Roda em processo próprio, ao lado da API (deploy/docker-compose.yml e deploy/k8s/), com a mesma imagem:
 *   node apps/api/dist/trabalhador.js
 * Exige PostgreSQL (AGORA_BANCO_URL): o PGlite é de um processo só — com ele, use AGORA_TRABALHADOR=embutido na API.
 * Sondas: GET /saude/vivo e GET /saude/pronto na porta AGORA_TRABALHADOR_PORTA (padrão 3001).
 */
import { createServer } from 'node:http';
import { hojeISO } from '@agora/dominio';
import { abrirBanco } from './banco/abrir.ts';
import { aplicarMigracoes } from './banco/migracoes.ts';
import { carregarConfig, ErroConfiguracao, type Config } from './config.ts';
import { criarServicoFila } from './fila/servico.ts';
import type { ContextoApp } from './http/contexto.ts';
import { MANIPULADORES } from './modulos/fila/manipuladores.ts';
import { lerVersao } from './versao.ts';

const PRAZO_ENCERRAMENTO_MS = 30_000;
const NIVEIS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

function registrador(config: Config) {
  const minimo = config.logNivel === 'silent' ? Number.POSITIVE_INFINITY : NIVEIS.indexOf(config.logNivel);
  return (nivel: 'info' | 'warn' | 'error', mensagem: string, dados: Record<string, unknown> = {}) => {
    if (NIVEIS.indexOf(nivel) < minimo) return;
    process.stdout.write(`${JSON.stringify({ nivel, hora: new Date().toISOString(), servico: 'agora-trabalhador', mensagem, ...dados })}\n`);
  };
}

function falhar(mensagem: string): never {
  process.stderr.write(`[agora-trabalhador] ${mensagem}\n`);
  process.exit(1);
}

async function iniciar(): Promise<void> {
  let config: Config;
  try {
    config = carregarConfig();
  } catch (erro) {
    if (erro instanceof ErroConfiguracao) falhar(erro.message);
    throw erro;
  }
  if (config.bancoUrl === null) {
    falhar('o trabalhador separado exige PostgreSQL (AGORA_BANCO_URL). Com PGlite, use AGORA_TRABALHADOR=embutido na API.');
  }
  const registrar = registrador(config);
  const banco = await abrirBanco(config, (erro) => registrar('error', 'erro na conexão com o banco', { erro: erro.message }));
  await aplicarMigracoes(banco);
  const relogio = () => new Date();
  const ctx: ContextoApp = {
    config,
    banco,
    // O trabalhador não emite sessões; o segredo só existe para completar o contexto compartilhado.
    segredo: config.segredoSessao ?? '',
    versao: lerVersao(),
    relogio,
    hoje: () => hojeISO(relogio()),
    fetch: (entrada, init) => fetch(entrada, init),
  };

  let encerrando = false;
  const fila = await criarServicoFila(ctx, {
    manipuladores: MANIPULADORES,
    executarTarefas: true,
    intervaloMs: 1000,
    registrar,
    aoDesconectar: () => {
      if (encerrando) return;
      registrar('error', 'conexão com o RabbitMQ perdida: encerrando para o orquestrador reiniciar o trabalhador');
      void encerrar(1);
    },
  });

  const sondas = createServer((requisicao, resposta) => {
    const responder = (status: number, corpo: Record<string, unknown>) => {
      resposta.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      resposta.end(JSON.stringify(corpo));
    };
    if (requisicao.method === 'GET' && requisicao.url === '/saude/vivo') return responder(200, { situacao: 'ok' });
    if (requisicao.method === 'GET' && requisicao.url === '/saude/pronto') {
      banco
        .verificar()
        .catch(() => false)
        .then((bancoOk) => {
          const pronto = bancoOk && fila.driver.pronto() && !encerrando;
          responder(pronto ? 200 : 503, { situacao: pronto ? 'ok' : 'indisponivel', banco: bancoOk, transporte: fila.driver.transporte, versao: ctx.versao });
        });
      return;
    }
    responder(404, { erro: 'Recurso não encontrado.' });
  });
  sondas.listen(config.fila.trabalhadorPorta, config.host);

  async function encerrar(codigo: number): Promise<void> {
    if (encerrando) return;
    encerrando = true;
    registrar('info', 'encerrando: terminando as tarefas em execução');
    const forcar = setTimeout(() => process.exit(1), PRAZO_ENCERRAMENTO_MS);
    forcar.unref();
    sondas.close();
    await fila.fechar().catch(() => undefined);
    await banco.fechar().catch(() => undefined);
    clearTimeout(forcar);
    process.exit(codigo);
  }
  process.once('SIGTERM', () => void encerrar(0));
  process.once('SIGINT', () => void encerrar(0));

  registrar('info', 'trabalhador no ar', {
    transporte: fila.driver.transporte,
    integracoes: config.integracoes,
    porta: config.fila.trabalhadorPorta,
    politica: config.fila.politica,
  });
}

iniciar().catch((erro: unknown) => {
  falhar(`falha ao iniciar: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`);
});
