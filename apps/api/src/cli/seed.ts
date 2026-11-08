import { parseArgs } from 'node:util';
import { hojeISO } from '@agora/dominio';
import { abrirBanco } from '../banco/abrir.ts';
import { apagarEsquema, aplicarMigracoes } from '../banco/migracoes.ts';
import { carregarConfig, ErroConfiguracao } from '../config.ts';
import { bancoVazio, executarSeed } from '../seed/index.ts';
import { lerVersao } from '../versao.ts';

/** `npm run seed -w @agora/api [-- --reset]`: carga sintética de demonstração (nunca em produção). */
async function principal(): Promise<number> {
  const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });
  const config = carregarConfig();
  if (config.ambiente !== 'demonstracao') {
    process.stderr.write('A carga sintética só pode ser executada com AGORA_AMBIENTE=demonstracao.\n');
    return 1;
  }
  const banco = await abrirBanco(config, (erro) => process.stderr.write(`Erro de conexão: ${erro.message}\n`));
  try {
    if (values.reset) await apagarEsquema(banco);
    await aplicarMigracoes(banco);
    if (!(await bancoVazio(banco))) {
      process.stderr.write('O banco já contém dados. Use --reset para recriar a carga de demonstração.\n');
      return 1;
    }
    const relogio = () => new Date();
    const contagens = await executarSeed({
      config,
      banco,
      segredo: '',
      versao: lerVersao(),
      relogio,
      hoje: () => hojeISO(relogio()),
      fetch: (entrada, init) => fetch(entrada, init),
    });
    process.stdout.write(`Carga sintética concluída: ${JSON.stringify(contagens)}\n`);
    return 0;
  } finally {
    await banco.fechar();
  }
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof ErroConfiguracao ? erro.message : erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}\n`);
    process.exitCode = 1;
  });
