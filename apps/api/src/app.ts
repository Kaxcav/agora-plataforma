import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hojeISO } from '@agora/dominio';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { abrirBanco } from './banco/abrir.ts';
import { apagarEsquema, aplicarMigracoes } from './banco/migracoes.ts';
import type { Banco } from './banco/tipos.ts';
import type { Config } from './config.ts';
import type { ContextoApp, FuncaoFetch } from './http/contexto.ts';
import { corpoErro, ErroApi } from './http/erros.ts';
import { diretorioWeb, ehNavegacaoSpa, enviarIndex, registrarEstatico } from './http/estatico.ts';
import { registrarSeguranca } from './http/seguranca.ts';
import { registrarTratadorErros } from './http/tratador-erros.ts';
import { agendarLimpeza } from './manutencao/limpeza.ts';
import { MODULOS_API } from './modulos/registro.ts';
import { agendarNotificacoes } from './modulos/notificacoes/agendador.ts';
import { rotasSaude } from './modulos/saude/rotas.ts';
import { bancoVazio, executarSeed } from './seed/index.ts';
import { lerVersao } from './versao.ts';
import { criarServicoFila } from './fila/servico.ts';
import { MANIPULADORES } from './modulos/fila/manipuladores.ts';

export interface OpcoesApp {
  /** Relógio da aplicação (testes fixam "hoje"). */
  relogio?: () => Date;
  /** `fetch` usado por integrações e gov.br (testes usam uma simulada). */
  fetch?: FuncaoFetch;
  /** Banco já aberto (senão é aberto conforme a configuração). */
  banco?: Banco;
  /** Intervalo da varredura do trabalhador embutido (testes usam 0 e acionam a fila explicitamente). */
  filaVarreduraMs?: number;
}

const TAMANHO_MAXIMO_CORPO = 1024 * 1024;

/**
 * Segredo de sessão: o configurado; em demonstração/homologação sem segredo, gera um e o persiste em
 * `AGORA_DADOS_DIR/segredo` (com PGlite em memória, vale só para o processo).
 */
function resolverSegredo(config: Config): string {
  if (config.segredoSessao) return config.segredoSessao;
  if (config.ambiente === 'producao') throw new Error('AGORA_SEGREDO_SESSAO é obrigatório em produção');
  if (config.dadosDir.startsWith('memory://')) return randomBytes(48).toString('base64url');
  mkdirSync(config.dadosDir, { recursive: true });
  const arquivo = join(config.dadosDir, 'segredo');
  if (existsSync(arquivo)) {
    const existente = readFileSync(arquivo, 'utf8').trim();
    if (Buffer.byteLength(existente, 'utf8') >= 32) return existente;
  }
  const novo = randomBytes(48).toString('base64url');
  writeFileSync(arquivo, novo, { encoding: 'utf8', mode: 0o600 });
  return novo;
}

function opcoesLogger(config: Config) {
  if (config.logNivel === 'silent') return false;
  return {
    level: config.logNivel,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-agora-csrf"]',
        'senha',
        '*.senha',
        'cpf',
        '*.cpf',
        'email',
        '*.email',
      ],
      censor: '[omitido]',
    },
    serializers: {
      req(request: { method?: string; url?: string }) {
        return { metodo: request.method, url: (request.url ?? '').split('?')[0] };
      },
      res(reply: { statusCode?: number }) {
        return { status: reply.statusCode };
      },
    },
  };
}

/** Monta a aplicação: banco + migrações, carga de demonstração (se vazio), segurança, rotas e front-end. */
export async function construirApp(config: Config, opcoes: OpcoesApp = {}): Promise<FastifyInstance> {
  z.config(z.locales.ptBR());
  const app = Fastify({
    logger: opcoesLogger(config),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'idRequisicao' }),
    trustProxy: config.confiarProxy,
    bodyLimit: TAMANHO_MAXIMO_CORPO,
    return503OnClosing: true,
  });

  const banco = opcoes.banco ?? (await abrirBanco(config, (erro) => app.log.error({ err: erro }, 'erro na conexão com o banco')));
  let filaAberta: { fechar(): Promise<void> } | null = null;
  try {
    await aplicarMigracoes(banco);
    const relogio = opcoes.relogio ?? (() => new Date());
    const ctx: ContextoApp = {
      config,
      banco,
      segredo: resolverSegredo(config),
      versao: lerVersao(),
      relogio,
      hoje: () => hojeISO(relogio()),
      fetch: opcoes.fetch ?? ((entrada, init) => fetch(entrada, init)),
    };
    app.decorate('agora', ctx);
    app.addHook('onClose', async () => {
      await banco.fechar();
    });

    // Recarga única da demonstração (AGORA_SEED_RECRIAR): atualiza um ambiente de demonstração já existente sem
    // acesso direto ao banco. Apaga e recria a carga sintética uma vez por marca; nunca em homologação ou produção.
    if (config.ambiente === 'demonstracao' && config.seedRecriar !== null && !(await recargaAplicada(banco, config.seedRecriar))) {
      await apagarEsquema(banco);
      await aplicarMigracoes(banco);
      const contagens = await executarSeed(ctx);
      await banco.executar('INSERT INTO recargas_demonstracao (marca) VALUES ($1) ON CONFLICT DO NOTHING', [config.seedRecriar]);
      app.log.warn({ contagens, marca: config.seedRecriar }, 'demonstração recriada (AGORA_SEED_RECRIAR)');
    }

    if (config.ambiente === 'demonstracao' && config.seedDemonstracao && (await bancoVazio(banco))) {
      const contagens = await executarSeed(ctx);
      app.log.info({ contagens }, 'banco vazio: dados sintéticos de demonstração carregados');
    }

    // Retenção LGPD (sessões e tentativas de login): na inicialização e a cada hora, uma réplica por vez.
    const limpeza = agendarLimpeza({
      banco,
      relogio,
      aoConcluir: (resultado) => {
        if (resultado.sessoesRemovidas + resultado.tentativasRemovidas > 0) app.log.info({ limpeza: resultado }, 'limpeza de retenção concluída');
      },
      aoFalhar: (erro) => app.log.error({ err: erro }, 'falha na limpeza de retenção'),
    });
    app.addHook('onClose', async () => {
      limpeza.parar();
    });
    await limpeza.executarAgora();

    // Central de notificações (RF-26/RN-31): varredura diária e fila no processo da API, salvo agendador externo.
    if (config.notificacoes.agendador === 'api') {
      const notificacoes = agendarNotificacoes({
        contexto: ctx,
        aoConcluir: (r) => {
          if (r.varredura || r.enviosProcessados > 0) app.log.info({ notificacoes: r }, 'notificações: varredura e fila processadas');
        },
        aoFalhar: (erro) => app.log.error({ err: erro }, 'falha na varredura ou na fila de notificações'),
      });
      app.addHook('onClose', async () => {
        notificacoes.parar();
      });
      // Com SMTP real a fila da inicialização segue em segundo plano; com drivers simulados (sem I/O externo), é aguardada.
      await notificacoes.iniciar(config.notificacoes.email !== 'smtp');
    }
    // Fila de integrações (RNF-07): a API publica as tarefas; o trabalhador roda embutido (demonstração de contêiner
    // único) ou à parte (src/trabalhador.ts). O gancho de encerramento roda antes do fechamento do banco.
    const fila = await criarServicoFila(ctx, {
      manipuladores: MANIPULADORES,
      executarTarefas: config.fila.trabalhador === 'embutido',
      ...(opcoes.filaVarreduraMs === undefined ? {} : { intervaloMs: opcoes.filaVarreduraMs }),
      registrar: (nivel, mensagem, dados) => app.log[nivel]({ fila: dados }, mensagem),
    });
    filaAberta = fila;
    app.decorate('fila', fila);
    app.addHook('onClose', async () => {
      await fila.fechar();
    });

    // Corpo JSON vazio (ex.: POST de ação sem parâmetros) é aceito como ausente.
    const parserJson = app.getDefaultJsonParser('error', 'error');
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, corpo, feito) => {
      const texto = typeof corpo === 'string' ? corpo : corpo.toString('utf8');
      if (texto.trim() === '') {
        feito(null, undefined);
        return;
      }
      parserJson(request, texto, (erro, valor) => {
        if (erro) feito(new ErroApi(400, 'VALIDACAO', 'O corpo da requisição não é um JSON válido.'), undefined);
        else feito(null, valor);
      });
    });

    await registrarSeguranca(app, ctx);
    registrarTratadorErros(app);

    await app.register(
      async (api) => {
        for (const modulo of MODULOS_API) await modulo(api);
      },
      { prefix: '/api/v1' },
    );
    await rotasSaude(app);

    const spaDisponivel = await registrarEstatico(app, diretorioWeb(config));
    app.setNotFoundHandler((request, reply) => {
      if (spaDisponivel && ehNavegacaoSpa(request.method, request.url)) return enviarIndex(reply);
      return reply.status(404).send(corpoErro('NAO_ENCONTRADO', 'Recurso não encontrado.', request.id));
    });
  } catch (erro) {
    await filaAberta?.fechar();
    await banco.fechar();
    throw erro;
  }
  return app;
}

/** A marca de recarga da demonstração já foi aplicada neste banco? (tabela da migração 034) */
async function recargaAplicada(banco: Banco, marca: string): Promise<boolean> {
  const [linha] = await banco.consultar<{ aplicada: boolean }>('SELECT EXISTS (SELECT 1 FROM recargas_demonstracao WHERE marca = $1) AS aplicada', [marca]);
  return linha?.aplicada ?? false;
}
