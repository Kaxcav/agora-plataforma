import { parseArgs } from 'node:util';
import { hojeISO } from '@agora/dominio';
import { abrirBanco } from '../banco/abrir.ts';
import { aplicarMigracoes } from '../banco/migracoes.ts';
import { carregarConfig, ErroConfiguracao } from '../config.ts';
import { agendarNotificacoes } from '../modulos/notificacoes/agendador.ts';

/**
 * Processo à parte da central de notificações (use com `AGORA_NOTIFICACOES_AGENDADOR=externo` na API):
 * `npm run notificacoes -w @agora/api` fica em execução (varredura diária e fila a cada minuto);
 * `-- --uma-vez` faz a varredura do dia e esvazia a fila, e termina (para cron do sistema operacional).
 */
async function principal(): Promise<number> {
  const { values } = parseArgs({ options: { 'uma-vez': { type: 'boolean', default: false } } });
  const config = carregarConfig();
  const banco = await abrirBanco(config, (erro) => process.stderr.write(`Erro de conexão: ${erro.message}\n`));
  const relogio = () => new Date();
  const registrar = (texto: string) => process.stdout.write(`[agora-notificacoes] ${new Date().toISOString()} ${texto}\n`);
  try {
    await aplicarMigracoes(banco);
    const agenda = agendarNotificacoes({
      contexto: { banco, config, relogio, hoje: () => hojeISO(relogio()) },
      aoConcluir: (r) => {
        if (r.varredura || r.enviosProcessados > 0) {
          registrar(`avisos gerados: ${r.varredura?.notificacoesCriadas ?? 0}; envios processados: ${r.enviosProcessados}`);
        }
      },
      aoFalhar: (erro) => process.stderr.write(`[agora-notificacoes] falha: ${erro instanceof Error ? erro.message : String(erro)}\n`),
    });
    const primeiro = await agenda.executarAgora();
    if (values['uma-vez']) {
      agenda.parar();
      return primeiro === null ? 1 : 0;
    }
    registrar('em execução (varredura diária e fila a cada minuto). Ctrl+C para encerrar.');
    await new Promise<void>((resolver) => {
      const encerrar = () => {
        agenda.parar();
        resolver();
      };
      process.once('SIGTERM', encerrar);
      process.once('SIGINT', encerrar);
      // Mantém o processo vivo (os timers do agendador são `unref`).
      setInterval(() => undefined, 1 << 30);
    });
    return 0;
  } finally {
    await banco.fechar();
  }
}

principal()
  .then((codigo) => {
    process.exit(codigo);
  })
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof ErroConfiguracao ? erro.message : erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}\n`);
    process.exit(1);
  });
