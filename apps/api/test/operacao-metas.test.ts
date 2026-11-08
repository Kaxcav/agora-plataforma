import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConfiguracaoMetasEtp, JanelaManutencaoPncp, Pagina, PainelMetasEtp, ProcessoDetalhe, ProcessoResumo, RelatorioDisponibilidade, SituacaoOperacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.ts';
import { carregarConfig } from '../src/config.ts';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, relogioManual, type Credenciais } from './apoio.ts';
import { concluirSelecao } from './apoio-selecao.ts';

async function eventos(app: FastifyInstance, acao: string): Promise<{ recurso_id: string | null; usuario_id: string | null; dados: Record<string, unknown> }[]> {
  return app.agora.banco.consultar('SELECT recurso_id, usuario_id, dados FROM auditoria_eventos WHERE acao = $1 ORDER BY sequencia', [acao]);
}

const DFD_LUXO = {
  descricaoNecessidade: 'Mobiliar a sala sintética de testes com estações de trabalho para operação contínua em turnos.',
  justificativa: 'A sala sintética entra em operação no próximo trimestre e não dispõe de mobiliário adequado.',
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
  itens: [{ catmat: '150102', descricao: 'Cadeira giratória premium revestida em couro legítimo', unidade: 'unidade', quantidade: 4, valorUnitarioEstimado: 420_000 }],
  justificativaArtigoLuxo: null,
};

describe('operação: sonda, disponibilidade (IMR-01) e janelas do PNCP', () => {
  let app: FastifyInstance;
  let admin: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000', AGORA_OPERACAO_META_DISPONIBILIDADE: '99.5' } });
    admin = await entrar(app, 'admin@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('a sonda roda na inicialização: situação atual com os quatro componentes disponíveis', async () => {
    const s = await obterJson<SituacaoOperacao>(app, admin, '/api/v1/operacao/situacao');
    assert.ok(s.verificadaEm);
    assert.equal(s.atual, true);
    assert.deepEqual(s.componentes.map((c) => [c.componente, c.disponivel]), [
      ['api', true],
      ['banco', true],
      ['fila', true],
      ['sincronizacao', true],
    ]);
    assert.equal(s.metaDisponibilidade, 99.5);
    assert.equal(s.sonda.ligada, true);
    assert.match(s.componentes.find((c) => c.componente === 'banco')?.detalhe ?? '', /Respondendo em \d+ ms/);
  });

  test('relatório mensal: minutos, ocorrências (banco e lacuna), janelas do PNCP registrada e detectada, meta e premissas', async () => {
    const meses = ['2026-10', '2026-11'];
    const relatorios = await Promise.all(meses.map((mes) => obterJson<RelatorioDisponibilidade>(app, admin, `/api/v1/operacao/disponibilidade?mes=${mes}`)));
    for (const r of relatorios) {
      assert.ok(r.minutosConsiderados > 0, r.mes);
      assert.ok(r.percentual !== null && r.percentual < 100 && r.percentual > 90, `${r.mes}: ${String(r.percentual)}`);
      assert.equal(r.metaPercentual, 99.5);
      assert.equal(r.situacao, (r.percentual ?? 0) >= 99.5 ? 'atingida' : 'nao_atingida');
      assert.ok(r.premissas.some((p) => /decisão do fiscal do contrato/.test(p)));
    }
    const ocorrencias = relatorios.flatMap((r) => r.ocorrencias);
    assert.ok(ocorrencias.some((o) => o.causas.includes('banco')), 'queda do banco');
    assert.ok(ocorrencias.some((o) => o.causas.includes('sem_medicao')), 'lacuna sem sondagem');
    assert.ok(!ocorrencias.some((o) => o.causas.length === 1 && o.causas[0] === 'sincronizacao'), 'falha só da sincronização, na janela do PNCP, não conta');
    const janelas = relatorios.flatMap((r) => r.janelasPncp);
    assert.deepEqual([...new Set(janelas.map((j) => j.origem))].sort(), ['detectada', 'registrada']);
    assert.ok(janelas.find((j) => j.origem === 'registrada')?.id);
    const [outubro] = relatorios;
    assert.ok(outubro?.inicioMedicao && outubro.inicioMedicao > outubro.periodo.inicio, 'a medição começou no meio de outubro');
  });

  test('CSV do mês com os dias, o total e as janelas; a exportação fica na trilha', async () => {
    const r = await chamar(app, admin, 'GET', '/api/v1/operacao/disponibilidade.csv?mes=2026-11');
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers['content-type']), /text\/csv/);
    assert.match(r.body, /Registro;Data ou período;Minutos considerados/);
    assert.match(r.body, /Dia;2026-11-01;/);
    assert.match(r.body, /Mês;2026-11;/);
    assert.match(r.body, /Janela do PNCP \(registrada\)/);
    assert.equal((await eventos(app, 'operacao.relatorio.exportar')).length, 1);
    assert.equal((await chamar(app, admin, 'GET', '/api/v1/operacao/disponibilidade?mes=2027-01')).statusCode, 400, 'mês futuro');
  });

  test('janela de manutenção do PNCP: registrada pelo administrador, validada e auditada', async () => {
    const inicio = new Date(INICIO_TESTES + 86_400_000).toISOString();
    const fim = new Date(INICIO_TESTES + 86_400_000 + 3 * 3_600_000).toISOString();
    const r = await chamar(app, admin, 'POST', '/api/v1/operacao/janelas', { inicio, fim, descricao: 'Manutenção programada sintética do PNCP' });
    assert.equal(r.statusCode, 200, r.body);
    const janela = r.json<JanelaManutencaoPncp>();
    assert.equal(janela.minutos, 180);
    assert.equal(janela.origem, 'registrada');
    const [evento] = (await eventos(app, 'operacao.janela.registrar')).filter((e) => e.recurso_id === janela.id);
    assert.ok(evento);
    assert.equal(evento.usuario_id, admin.sessao.usuario.id);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/operacao/janelas', { inicio: fim, fim: inicio, descricao: 'Janela invertida sintética' })).statusCode, 400);
    assert.equal(
      (await chamar(app, admin, 'POST', '/api/v1/operacao/janelas', { inicio, fim: new Date(INICIO_TESTES + 9 * 86_400_000).toISOString(), descricao: 'Janela longa demais sintética' })).statusCode,
      400,
    );
  });

  test('permissões: o auditor consulta; gestor e consulta não; só o administrador registra e sonda', async () => {
    const auditor = await entrar(app, 'auditor@agora.demo');
    const gestor = await entrar(app, 'gestor@agora.demo');
    assert.equal((await chamar(app, auditor, 'GET', '/api/v1/operacao/situacao')).statusCode, 200);
    assert.equal((await chamar(app, auditor, 'POST', '/api/v1/operacao/sondar')).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/operacao/disponibilidade')).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/operacao/janelas', {})).statusCode, 403);
    const sondada = await chamar(app, admin, 'POST', '/api/v1/operacao/sondar');
    assert.equal(sondada.statusCode, 200);
    assert.equal((await eventos(app, 'operacao.sondar')).length, 1);
  });
});

describe('sonda: intervalos contínuos e fila atrasada', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  let admin: Credenciais;

  before(async () => {
    const config = carregarConfig({
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_DADOS_DIR: 'memory://',
      AGORA_LOG_NIVEL: 'silent',
      AGORA_WEB_DIR: 'memory://sem-front-end',
      AGORA_OPERACAO_SONDA_SEGUNDOS: '0',
      AGORA_LIMITE_REQUISICOES_MINUTO: '100000',
    });
    app = await construirApp(config, { relogio: tempo.relogio, filaVarreduraMs: 0 });
    admin = await entrar(app, 'admin@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  const intervalos = () => app.agora.banco.consultar<{ fila: boolean; amostras: number }>('SELECT fila, amostras FROM operacao_sondagens ORDER BY fim DESC');

  test('mesmo resultado estende o intervalo; tarefa pronta sem trabalhador abre um intervalo com a fila indisponível', async () => {
    const antes = await intervalos();
    tempo.avancar(30_000);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/operacao/sondar')).statusCode, 200);
    const depois = await intervalos();
    assert.equal(depois.length, antes.length, 'sem intervalo novo');
    assert.equal(depois[0]?.amostras, (antes[0]?.amostras ?? 0) + 1);

    await app.agora.banco.executar(
      `INSERT INTO fila_tarefas (tipo, chave_idempotencia, descricao, situacao, tentativas, maximo_tentativas, disponivel_em, criada_em, atualizada_em)
       VALUES ('sincronizacao', 'teste-fila-atrasada', 'Tarefa sintética parada', 'pendente', 0, 3, $1, $1, $1)`,
      [new Date(tempo.relogio().getTime() - 60 * 60_000).toISOString()],
    );
    tempo.avancar(30_000);
    const s = (await chamar(app, admin, 'POST', '/api/v1/operacao/sondar')).json<SituacaoOperacao>();
    const fila = s.componentes.find((c) => c.componente === 'fila');
    assert.equal(fila?.disponivel, false);
    assert.match(fila?.detalhe ?? '', /1 tarefa\(s\) prontas e sem trabalhador/);
    const finais = await intervalos();
    assert.equal(finais.length, antes.length + 1);
    assert.equal(finais[0]?.fila, false);
    assert.equal(s.sonda.ligada, false);
  });
});

describe('painel das metas do ETP (RF-39) e registro dos bloqueios das travas', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let admin: Credenciais;
  let planejamento: Credenciais;
  let agente: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  const painel = (filtro = '') => obterJson<PainelMetasEtp>(app, gestor, `/api/v1/metas-etp${filtro}`);

  test('mostra os três indicadores contra as metas sintéticas configuradas, e diz o que mede e o que não mede', async () => {
    const p = await painel();
    assert.equal(p.metasConfiguradas, true);
    assert.equal(p.tempoInstrucao.metaReducaoPercentual, 40);
    assert.deepEqual(p.tempoInstrucao.etapas.map((e) => [e.etapa, e.linhaBaseDias, e.alvoDias]), [
      [1, 30, 18],
      [2, 20, 12],
      [3, 40, 24],
      [4, 30, 18],
    ]);
    assert.ok(p.tempoInstrucao.etapas.every((e) => e.processosMedidos > 0 && e.mediaDias !== null), 'avanços sintéticos medidos pela trilha');
    assert.ok(p.tempoInstrucao.fase.processosMedidos > 0);
    assert.equal(p.tempoInstrucao.fase.linhaBaseDias, 120);
    assert.ok(p.errosFormais.bloqueios >= 4, 'bloqueios sintéticos da carga');
    assert.ok(p.errosFormais.porRegra.some((r) => r.regra === 'RN-04' && /Estudo Técnico Preliminar|ETP/.test(r.titulo)));
    assert.equal(p.errosFormais.metaPercentual, 95);
    assert.ok(p.economia.processos.length >= 1, 'processo homologado na carga');
    assert.equal(p.economia.metaPercentual, 6);
    assert.equal(typeof p.economia.economiaPercentual, 'number');
    assert.match(p.economia.explicacao.naoMede, /Não atribui a economia à IA/);
    assert.ok(p.economia.processos.some((e) => e.expurgos.descartadas > 0 && e.expurgos.mediaComDescartadas !== e.expurgos.mediaSemDescartadas), 'efeito dos expurgos à parte');
    assert.ok(p.premissas.some((x) => /Requer revisão humana/.test(x)));
  });

  test('avanço barrado vira trava.bloqueio na trilha (fora da transação desfeita) e entra na contagem', async () => {
    const antes = (await painel()).errosFormais.bloqueios;
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição sintética para medir as travas do painel de metas', orgao: 'MJSP' });
    assert.equal(criado.statusCode, 201, criado.body);
    const processo = criado.json<ProcessoDetalhe>();
    const avanco = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processo.id}/avancar`);
    assert.equal(avanco.statusCode, 422);
    assert.equal((await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${processo.id}`)).etapaAtual, 1, 'a ação foi desfeita');

    const [evento] = (await eventos(app, 'trava.bloqueio')).filter((e) => e.recurso_id === processo.id);
    const [{ uasg } = { uasg: '' }] = await app.agora.banco.consultar<{ uasg: string }>('SELECT uasg FROM processos WHERE id = $1', [processo.id]);
    assert.ok(evento, 'bloqueio registrado');
    assert.equal(evento.dados.trava, 'avanco_etapa');
    assert.equal(evento.dados.uasg, uasg);
    assert.equal(evento.dados.etapa, 1);
    assert.ok(Array.isArray(evento.dados.regras) && (evento.dados.regras as string[]).length > 0);
    assert.equal(evento.usuario_id, planejamento.sessao.usuario.id);
    assert.equal((await painel()).errosFormais.bloqueios, antes + 1);
    assert.equal((await painel(`?uasg=${uasg}&de=2026-11-09&ate=2026-11-09`)).errosFormais.bloqueios, 1, 'filtro por UASG e período');
  });

  test('minuta recusada por item de luxo (RN-01) também é registrada', async () => {
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição sintética de mobiliário para a trava de luxo', orgao: 'MJSP' });
    const processo = criado.json<ProcessoDetalhe>();
    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${processo.id}/dfd`, DFD_LUXO)).statusCode, 200);
    const r = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processo.id}/documentos/gerar`, { tipo: 'dfd' });
    assert.equal(r.statusCode, 422);
    const [evento] = (await eventos(app, 'trava.bloqueio')).filter((e) => e.recurso_id === processo.id);
    assert.equal(evento?.dados.trava, 'documento_gerar');
    assert.deepEqual(evento?.dados.regras, ['RN-01']);
  });

  test('assinatura barrada pelo CEIS (RN-09) é registrada como bloqueio na assinatura', async () => {
    const processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
    const radios = processos.find((p) => p.titulo.toLowerCase().includes('rádios'));
    assert.ok(radios);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/avancar`)).statusCode, 200, 'etapa 5 → 6');
    const fornecedores = await app.agora.banco.consultar<{ id: string; nome: string }>(
      "SELECT id, razao_social AS nome FROM fornecedores WHERE razao_social LIKE 'Mirante%' OR razao_social LIKE 'Vigilant%'",
    );
    const mirante = fornecedores.find((f) => /Mirante/.test(f.nome));
    const vigilant = fornecedores.find((f) => /Vigilant/.test(f.nome));
    assert.ok(mirante && vigilant);
    const disputa = await chamar(app, agente, 'PUT', `/api/v1/processos/${radios.id}/disputa`, {
      licitantes: [
        { id: mirante.id, valorProposta: 780_000_000 },
        { id: vigilant.id, valorProposta: 790_000_000 },
      ],
    });
    assert.equal(disputa.statusCode, 200, disputa.body);
    await concluirSelecao(app, radios.id, agente, gestor);
    const avanco = await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/avancar`);
    assert.equal(avanco.statusCode, 200, `etapa 6 → 7: ${avanco.body}`);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/contratar`)).statusCode, 422);
    const [evento] = (await eventos(app, 'trava.bloqueio')).filter((e) => e.recurso_id === radios.id);
    assert.equal(evento?.dados.trava, 'assinatura');
    assert.deepEqual(evento?.dados.regras, ['RN-09']);
  });

  test('configuração das metas: só o administrador altera, com validação e trilha; o painel usa as novas metas', async () => {
    const metas = {
      tempoInstrucao: { reducaoPercentual: 25, linhaBaseDias: { '1': 10, '2': 10, '3': 10, '4': 10 } },
      errosFormais: { mitigacaoPercentual: 80 },
      economia: { economiaPercentual: 3 },
    };
    assert.equal((await chamar(app, gestor, 'PUT', '/api/v1/metas-etp/configuracao', metas)).statusCode, 403);
    assert.equal((await chamar(app, admin, 'PUT', '/api/v1/metas-etp/configuracao', { ...metas, economia: { economiaPercentual: 0 } })).statusCode, 400);
    const r = await chamar(app, admin, 'PUT', '/api/v1/metas-etp/configuracao', metas);
    assert.equal(r.statusCode, 200, r.body);
    const salva = r.json<ConfiguracaoMetasEtp>();
    assert.equal(salva.atualizadaPor?.id, admin.sessao.usuario.id);
    const evento = (await eventos(app, 'metas.configurar')).at(-1);
    assert.deepEqual((evento?.dados.depois as typeof metas).economia, { economiaPercentual: 3 });
    assert.equal((evento?.dados.antes as typeof metas).economia.economiaPercentual, 6);
    const p = await painel();
    assert.equal(p.tempoInstrucao.etapas[0]?.alvoDias, 7.5);
    assert.equal(p.errosFormais.metaPercentual, 80);
  });

  test('CSV do painel e permissões de leitura', async () => {
    const r = await chamar(app, gestor, 'GET', '/api/v1/metas-etp/exportar.csv');
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /Indicador;Item;Atual/);
    assert.match(r.body, /Tempo de instrução;Etapa 1/);
    assert.match(r.body, /Erros formais barrados;Mitigação/);
    assert.match(r.body, /Economia;Total/);
    assert.equal((await eventos(app, 'metas.exportar')).length, 1);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/metas-etp')).statusCode, 403);
    const auditor = await entrar(app, 'auditor@agora.demo');
    assert.equal((await chamar(app, auditor, 'GET', '/api/v1/metas-etp')).statusCode, 200);
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/metas-etp?de=2026-11-10&ate=2026-11-01')).statusCode, 400);
  });
});
