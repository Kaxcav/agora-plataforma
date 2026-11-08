import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, ResumoFila, Sincronizacao, TarefaFila } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { criarDriverPostgres } from '../src/fila/postgres.ts';
import { FILA_ERRO, FILA_PRINCIPAL, criarDriverRabbitmq, filaEspera, type CanalAmqp, type ConexaoAmqp, type MensagemAmqp } from '../src/fila/rabbitmq.ts';
import { obterTarefa } from '../src/fila/registro.ts';
import { FalhaTarefa, type Manipuladores } from '../src/fila/tipos.ts';
import { criarTrabalhador } from '../src/fila/trabalhador.ts';
import { construirApp } from '../src/app.ts';
import { carregarConfig } from '../src/config.ts';
import { MANIPULADORES } from '../src/modulos/fila/manipuladores.ts';
import { chamar, criarAppTeste, entrar, obterJson, relogioManual } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const POLITICA = { AGORA_FILA_TENTATIVAS: '3', AGORA_FILA_ESPERA_MS: '1000', AGORA_FILA_ESPERA_MAXIMA_MS: '4000' };

function manipuladoresCom(sincronizacao: Manipuladores['sincronizacao']): Manipuladores {
  const nunca: Manipuladores['sincronizacao'] = async () => {
    throw new Error('não usado neste teste');
  };
  return { sincronizacao, 'pncp.compra': nunca, 'pncp.arquivo': nunca, 'pncp.contrato': nunca, 'sei.envio': nunca, 'sei.assinaturas': nunca, 'dou.conferencia': nunca };
}

describe('fila de integrações em PostgreSQL (RNF-07)', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;

  before(async () => {
    // Sem varredura periódica: o trabalhador embutido só age quando a API despacha; os testes acionam os demais.
    const config = carregarConfig({
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_DADOS_DIR: 'memory://',
      AGORA_LOG_NIVEL: 'silent',
      AGORA_WEB_DIR: 'memory://sem-front-end',
      ...SEM_LIMITE,
      ...POLITICA,
    });
    app = await construirApp(config, { relogio: tempo.relogio, filaVarreduraMs: 0 });
  });
  after(async () => {
    await app.close();
  });

  async function enfileirarSincronizacao(chave: string) {
    return app.agora.banco.transacao((tx) =>
      app.fila.enfileirar(tx, { tipo: 'sincronizacao', chave, descricao: `Tarefa de teste ${chave}`, carga: { teste: true }, recurso: { tipo: 'sincronizacao', id: 'TESTE' } }),
    );
  }

  test('idempotência: a mesma chave não cria segunda tarefa', async () => {
    const primeira = await enfileirarSincronizacao('teste:idempotencia:1');
    const repetida = await enfileirarSincronizacao('teste:idempotencia:1');
    assert.equal(primeira.criada, true);
    assert.equal(repetida.criada, false);
    assert.equal(repetida.tarefa.id, primeira.tarefa.id);
    const [contagem] = await app.agora.banco.consultar<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM fila_tarefas WHERE chave_idempotencia = 'teste:idempotencia:1'",
    );
    assert.equal(contagem?.total, 1);
  });

  test('falha transitória: nova tentativa com espera exponencial; esgotado o limite, fila de erro auditada', async () => {
    const chamadas: string[] = [];
    const trabalhador = criarTrabalhador({
      ctx: app.agora,
      driver: criarDriverPostgres(),
      intervaloMs: 0,
      manipuladores: manipuladoresCom(async (_ctx, executada) => {
        chamadas.push(executada.id);
        throw new FalhaTarefa('Serviço externo indisponível (HTTP 503)', true);
      }),
    });
    const { tarefa } = await enfileirarSincronizacao('teste:transitoria:1');
    const daTarefa = () => chamadas.filter((id) => id === tarefa.id).length;
    const inicio = tempo.relogio().getTime();

    assert.equal(await trabalhador.processar(tarefa.id), 'nova_tentativa');
    let atual = await obterTarefa(app.agora.banco, tarefa.id);
    assert.equal(atual?.situacao, 'pendente');
    assert.equal(atual?.tentativas, 1);
    assert.equal(Date.parse(atual?.disponivel_em ?? '') - inicio, 1000, 'espera base de 1 s');
    assert.match(atual?.ultimo_erro ?? '', /HTTP 503/);
    assert.equal(await trabalhador.processar(tarefa.id), 'ignorada', 'antes da espera não executa');

    tempo.avancar(1000);
    assert.ok((await trabalhador.varrer()) >= 1);
    assert.equal(daTarefa(), 2, 'a varredura retoma a tarefa quando a espera vence');
    atual = await obterTarefa(app.agora.banco, tarefa.id);
    assert.equal(atual?.tentativas, 2);
    assert.equal(Date.parse(atual?.disponivel_em ?? '') - tempo.relogio().getTime(), 2000, 'a espera dobra');

    tempo.avancar(2000);
    assert.equal(await trabalhador.processar(tarefa.id), 'erro');
    atual = await obterTarefa(app.agora.banco, tarefa.id);
    assert.equal(atual?.situacao, 'erro');
    assert.equal(atual?.tentativas, 3);
    assert.equal(daTarefa(), 3);
    await trabalhador.parar();

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?recurso=fila_tarefa&tamanhoPagina=100`);
    const eventos = trilha.itens.filter((e) => e.recursoId === tarefa.id).map((e) => e.acao);
    assert.deepEqual(eventos.sort(), ['fila.erro', 'fila.nova_tentativa', 'fila.nova_tentativa']);
  });

  test('falha definitiva vai direto para a fila de erro, sem nova tentativa', async () => {
    const chamadas: string[] = [];
    const trabalhador = criarTrabalhador({
      ctx: app.agora,
      driver: criarDriverPostgres(),
      intervaloMs: 0,
      manipuladores: manipuladoresCom(async (_ctx, executada) => {
        chamadas.push(executada.id);
        throw new FalhaTarefa('PNCP recusou a inclusão (HTTP 422): unidade compradora não cadastrada', false);
      }),
    });
    const { tarefa } = await enfileirarSincronizacao('teste:definitiva:1');
    assert.equal(await trabalhador.processar(tarefa.id), 'erro');
    tempo.avancar(60_000);
    await trabalhador.varrer();
    assert.equal(chamadas.filter((id) => id === tarefa.id).length, 1);
    assert.equal((await obterTarefa(app.agora.banco, tarefa.id))?.situacao, 'erro');
    await trabalhador.parar();
  });

  test('tela de integrações: resumo, fila de erro e reprocessamento auditado; permissão e escopo no servidor', async () => {
    const administrador = await entrar(app, 'admin@agora.demo');
    const resumo = await obterJson<ResumoFila>(app, administrador, '/api/v1/fila/resumo');
    assert.equal(resumo.transporte, 'postgres');
    assert.equal(resumo.trabalhador, 'embutido');
    assert.deepEqual(resumo.politica, { maximoTentativas: 3, esperaBaseMs: 1000, esperaMaximaMs: 4000 });
    assert.ok(resumo.comErro >= 3, 'carga de demonstração + falhas dos testes anteriores');

    const comErro = await obterJson<Pagina<TarefaFila>>(app, administrador, '/api/v1/fila/tarefas?situacao=erro&tamanhoPagina=100');
    const demonstracao = comErro.itens.find((t) => t.recurso?.id === 'SIAFI' && /janela de manutenção/i.test(t.ultimoErro ?? ''));
    assert.ok(demonstracao, 'a carga sintética traz uma sincronização na fila de erro');

    const agente = await entrar(app, 'agente@agora.demo');
    assert.equal((await chamar(app, agente, 'GET', '/api/v1/fila/tarefas')).statusCode, 403);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/fila/tarefas/${demonstracao.id}/reprocessar`)).statusCode, 403);

    const financeiro = await entrar(app, 'financeiro@agora.demo');
    const reprocessada = await chamar(app, financeiro, 'POST', `/api/v1/fila/tarefas/${demonstracao.id}/reprocessar`);
    assert.equal(reprocessada.statusCode, 200);
    assert.equal(reprocessada.json<TarefaFila>().situacao, 'concluida', 'o trabalhador embutido executou o conector offline');
    const repetida = await chamar(app, financeiro, 'POST', `/api/v1/fila/tarefas/${demonstracao.id}/reprocessar`);
    assert.equal(repetida.statusCode, 422, 'só tarefas na fila de erro');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=fila.reprocessar');
    assert.ok(trilha.itens.some((e) => e.recursoId === demonstracao.id && e.usuario?.id === financeiro.sessao.usuario.id));
    const sincronizacoes = await obterJson<Sincronizacao[]>(app, financeiro, '/api/v1/sincronizacoes');
    assert.equal(sincronizacoes.find((s) => s.fonte === 'SIAFI')?.situacao, 'ok');
  });

  test('sincronização pela API: a rota publica a tarefa e o trabalhador embutido executa o conector', async () => {
    const financeiro = await entrar(app, 'financeiro@agora.demo');
    const resposta = await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/COMPRAS_GOV/executar');
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json<Sincronizacao>().situacao, 'ok');
    const [tarefa] = await app.agora.banco.consultar<{ situacao: string; solicitada_por: string }>(
      "SELECT situacao, solicitada_por FROM fila_tarefas WHERE tipo = 'sincronizacao' AND recurso_id = 'COMPRAS_GOV' ORDER BY criada_em DESC LIMIT 1",
    );
    assert.deepEqual(tarefa, { situacao: 'concluida', solicitada_por: financeiro.sessao.usuario.id });
  });
});

describe('trabalhador separado da API', () => {
  test('a API só publica (202 "executando"); o serviço trabalhador consome e executa', async () => {
    const app = await criarAppTeste({ env: { ...SEM_LIMITE, AGORA_TRABALHADOR: 'separado' } });
    try {
      assert.equal(app.fila.trabalhador, null);
      const financeiro = await entrar(app, 'financeiro@agora.demo');
      const resposta = await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/SIAFI/executar');
      assert.equal(resposta.statusCode, 202);
      const pendente = resposta.json<Sincronizacao>();
      assert.equal(pendente.situacao, 'executando');
      assert.match(pendente.mensagem ?? '', /fila de integrações/);
      const repetida = await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/SIAFI/executar');
      assert.equal(repetida.statusCode, 202, 'pedido repetido antecipa a mesma tarefa, sem duplicar');
      const [contagem] = await app.agora.banco.consultar<{ total: number }>(
        "SELECT COUNT(*)::integer AS total FROM fila_tarefas WHERE tipo = 'sincronizacao' AND recurso_id = 'SIAFI' AND situacao = 'pendente'",
      );
      assert.equal(contagem?.total, 1);

      const trabalhador = criarTrabalhador({ ctx: app.agora, driver: criarDriverPostgres(), manipuladores: MANIPULADORES, intervaloMs: 0 });
      assert.equal(await trabalhador.varrer(), 1);
      await trabalhador.parar();
      const lista = await obterJson<Sincronizacao[]>(app, financeiro, '/api/v1/sincronizacoes');
      assert.equal(lista.find((s) => s.fonte === 'SIAFI')?.situacao, 'ok');
    } finally {
      await app.close();
    }
  });
});

describe('configuração da fila e da publicação no PNCP (variáveis AGORA_*)', () => {
  test('padrões, validação da URL do RabbitMQ, política de tentativas e credenciais do PNCP', () => {
    const padrao = carregarConfig({});
    assert.deepEqual(padrao.fila, {
      url: null,
      trabalhador: 'embutido',
      trabalhadorPorta: 3001,
      politica: { maximoTentativas: 10, esperaBaseMs: 30_000, esperaMaximaMs: 3_600_000 },
    });
    assert.deepEqual(padrao.pncpPublicacao, { url: 'https://treina.pncp.gov.br/api/pncp', usuario: null, senha: null });
    const producao = carregarConfig({
      AGORA_AMBIENTE: 'producao',
      AGORA_SEGREDO_SESSAO: 'x'.repeat(48),
      AGORA_BANCO_URL: 'postgres://banco:5432/agora',
      AGORA_FILA_URL: 'amqp://agora:senha@fila:5672/agora',
      AGORA_TRABALHADOR: 'separado',
    });
    assert.equal(producao.pncpPublicacao.url, 'https://pncp.gov.br/api/pncp');
    assert.equal(producao.fila.url, 'amqp://agora:senha@fila:5672/agora');
    assert.equal(producao.fila.trabalhador, 'separado');
    assert.throws(() => carregarConfig({ AGORA_FILA_URL: 'http://fila:5672' }), /AGORA_FILA_URL/);
    assert.throws(() => carregarConfig({ AGORA_PNCP_USUARIO: 'sistema' }), /defina os dois juntos/);
    assert.throws(() => carregarConfig({ AGORA_FILA_ESPERA_MS: '5000', AGORA_FILA_ESPERA_MAXIMA_MS: '1000' }), /AGORA_FILA_ESPERA_MAXIMA_MS/);
    assert.throws(() => carregarConfig({ AGORA_TRABALHADOR: 'talvez' }), /AGORA_TRABALHADOR/);
  });
});

/** RabbitMQ simulado: registra filas declaradas, publicações e confirmações. */
class CanalSimulado implements CanalAmqp {
  filas = new Map<string, { durable?: boolean; arguments?: Record<string, unknown> }>();
  publicadas: { fila: string; corpo: Record<string, unknown>; persistente: boolean }[] = [];
  confirmacoes = 0;
  consumidor: ((mensagem: MensagemAmqp | null) => void) | null = null;
  confirmadas: MensagemAmqp[] = [];
  rejeitadas: { mensagem: MensagemAmqp; recolocar: boolean }[] = [];
  fechado = false;

  async assertQueue(fila: string, opcoes?: { durable?: boolean; arguments?: Record<string, unknown> }) {
    this.filas.set(fila, opcoes ?? {});
    return {};
  }
  sendToQueue(fila: string, conteudo: Buffer, opcoes?: { persistent?: boolean }) {
    this.publicadas.push({ fila, corpo: JSON.parse(conteudo.toString('utf8')) as Record<string, unknown>, persistente: opcoes?.persistent === true });
    return true;
  }
  async waitForConfirms() {
    this.confirmacoes++;
  }
  async prefetch() {
    return {};
  }
  async consume(_fila: string, aoReceber: (mensagem: MensagemAmqp | null) => void) {
    this.consumidor = aoReceber;
    return {};
  }
  ack(mensagem: MensagemAmqp) {
    this.confirmadas.push(mensagem);
  }
  nack(mensagem: MensagemAmqp, _todas?: boolean, recolocar?: boolean) {
    this.rejeitadas.push({ mensagem, recolocar: recolocar === true });
  }
  async close() {
    this.fechado = true;
  }
}

describe('transporte RabbitMQ (amqplib, simulado)', () => {
  test('filas duráveis, mensagens persistentes com confirmação, espera por TTL e fila de erro', async () => {
    const canal = new CanalSimulado();
    let urlUsada = '';
    const conexao: ConexaoAmqp = { createConfirmChannel: async () => canal, close: async () => undefined, on: () => undefined };
    const driver = await criarDriverRabbitmq({
      url: 'amqp://agora:segredo@fila.interna:5672/agora',
      conectar: async (url) => {
        urlUsada = url;
        return conexao;
      },
    });
    assert.equal(urlUsada, 'amqp://agora:segredo@fila.interna:5672/agora');
    assert.equal(driver.transporte, 'rabbitmq');
    assert.equal(canal.filas.get(FILA_PRINCIPAL)?.durable, true);
    assert.equal(canal.filas.get(FILA_ERRO)?.durable, true);

    await driver.despachar({ id: 'tarefa-1', esperaMs: 0 });
    assert.deepEqual(canal.publicadas.at(-1), { fila: FILA_PRINCIPAL, corpo: { id: 'tarefa-1' }, persistente: true });
    assert.equal(canal.confirmacoes, 1);

    await driver.despachar({ id: 'tarefa-1', esperaMs: 30_000 });
    assert.equal(canal.publicadas.at(-1)?.fila, filaEspera(30_000));
    assert.deepEqual(canal.filas.get(filaEspera(30_000))?.arguments, {
      'x-message-ttl': 30_000,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': FILA_PRINCIPAL,
    });

    await driver.registrarErro({ id: 'tarefa-1', tipo: 'pncp.compra', motivo: 'limite_tentativas' });
    assert.deepEqual(canal.publicadas.at(-1), { fila: FILA_ERRO, corpo: { id: 'tarefa-1', tipo: 'pncp.compra', motivo: 'limite_tentativas' }, persistente: true });

    const processadas: string[] = [];
    await driver.consumir(async (id) => {
      if (id === 'quebra') throw new Error('banco fora');
      processadas.push(id);
    });
    const entregar = async (conteudo: string) => {
      const mensagem = { content: Buffer.from(conteudo) };
      canal.consumidor?.(mensagem);
      await new Promise((resolver) => setImmediate(resolver));
      return mensagem;
    };
    const ok = await entregar(JSON.stringify({ id: 'tarefa-2' }));
    assert.deepEqual(processadas, ['tarefa-2']);
    assert.ok(canal.confirmadas.includes(ok));
    const estranha = await entregar('não é json');
    assert.ok(canal.confirmadas.includes(estranha), 'mensagem fora do formato é descartada');
    const falha = await entregar(JSON.stringify({ id: 'quebra' }));
    assert.deepEqual(canal.rejeitadas, [{ mensagem: falha, recolocar: true }], 'erro de infraestrutura devolve a mensagem à fila');

    assert.equal(driver.pronto(), true);
    await driver.fechar();
    assert.equal(canal.fechado, true);
    assert.equal(driver.pronto(), false);
  });
});
