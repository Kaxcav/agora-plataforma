import { construirApp } from './app.ts';
import { carregarConfig, ErroConfiguracao, type Config } from './config.ts';

const PRAZO_ENCERRAMENTO_MS = 10_000;

function falhar(mensagem: string): never {
  process.stderr.write(`[agora] ${mensagem}\n`);
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

  const app = await construirApp(config);
  let encerrando = false;

  const encerrar = (sinal: NodeJS.Signals) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info({ sinal }, 'encerrando: parando de aceitar conexões e fechando o banco');
    const forcar = setTimeout(() => {
      app.log.error('encerramento excedeu o prazo; saindo à força');
      process.exit(1);
    }, PRAZO_ENCERRAMENTO_MS);
    forcar.unref();
    app
      .close()
      .then(() => {
        clearTimeout(forcar);
        process.exit(0);
      })
      .catch((erro: unknown) => {
        app.log.error({ err: erro }, 'falha no encerramento');
        process.exit(1);
      });
  };
  process.once('SIGTERM', encerrar);
  process.once('SIGINT', encerrar);

  await app.listen({ port: config.porta, host: config.host });
  app.log.info({ ambiente: config.ambiente, banco: config.bancoUrl ? 'postgres' : 'pglite', integracoes: config.integracoes }, 'Ágora no ar');
}

iniciar().catch((erro: unknown) => {
  falhar(`falha ao iniciar: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`);
});
