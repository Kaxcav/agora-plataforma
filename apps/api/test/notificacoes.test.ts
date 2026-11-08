import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  EstadoNotificacoes,
  EventoAuditoria,
  LinhaTempoVencimentos,
  NotificacaoDetalhe,
  NotificacaoResumo,
  Pagina,
  Painel,
  PreferenciaNotificacao,
  ResultadoVarreduraNotificacoes,
} from '@agora/contratos';
import { adicionarDias } from '@agora/dominio';
import type { FastifyInstance } from 'fastify';
import { agendarNotificacoes } from '../src/modulos/notificacoes/agendador.ts';
import { ErroEnvio, type DriverCanal, type DriversCanais } from '../src/modulos/notificacoes/canais.ts';
import { carregarInstrumento, criarNotificacaoManual, processarFila, sanitizarErro } from '../src/modulos/notificacoes/servico.ts';
import { chamar, criarAppTeste, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';

interface ContratoAlvo {
  id: string;
  numero: string;
  uasg: string;
  fiscal_id: string;
  gestor_id: string;
  processo_sei: string;
}

async function contratoVigente(app: FastifyInstance, condicao: string, parametros: (string | number)[] = []): Promise<ContratoAlvo> {
  const [c] = await app.agora.banco.consultar<ContratoAlvo>(
    `SELECT c.id, c.numero, c.uasg, c.fiscal_id, c.gestor_id, c.processo_sei FROM contratos c
      WHERE c.vigencia_fim >= $1 AND c.fiscal_id IS NOT NULL AND c.gestor_id IS NOT NULL AND ${condicao}
      ORDER BY c.numero LIMIT 1`,
    [app.agora.hoje(), ...parametros],
  );
  assert.ok(c, `contrato para o teste: ${condicao}`);
  return c;
}

describe('central de notificações (RF-26) e semáforo 30/60/90/120 (RN-31)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let gestor: Credenciais;
  let fiscal: Credenciais;
  let consulta: Credenciais;
  let financeiro: Credenciais;
  let auditor: Credenciais;

  before(async () => {
    app = await criarAppTeste();
    admin = await entrar(app, 'admin@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    fiscal = await entrar(app, 'fiscal@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
    financeiro = await entrar(app, 'financeiro@agora.demo');
    auditor = await entrar(app, 'auditor@agora.demo');
  });

  after(async () => {
    await app.close();
  });

  test('a varredura da inicialização gera avisos automáticos por faixa, todos enviados pelo driver simulado', async () => {
    const estado = await obterJson<EstadoNotificacoes>(app, gestor, '/api/v1/notificacoes/canais');
    assert.deepEqual(
      estado.canais.map((c) => [c.canal, c.modo]),
      [
        ['email', 'simulado'],
        ['sei', 'simulado'],
        ['govbr', 'simulado'],
      ],
    );
    assert.equal(estado.agendador, 'api');
    assert.equal(estado.ultimaVarredura?.data, app.agora.hoje());
    assert.equal(estado.fila.pendentes, 0);
    assert.ok(estado.fila.enviadosHoje > 0);

    const automaticas = await obterJson<Pagina<NotificacaoResumo>>(app, gestor, '/api/v1/notificacoes?origem=automatica&tamanhoPagina=100');
    assert.ok(automaticas.total > 20);
    const faixas = new Set(automaticas.itens.filter((n) => n.tipo === 'vencimento').map((n) => n.faixa));
    for (const faixa of [30, 60, 90, 120]) assert.ok(faixas.has(faixa as 30), `faixa ${faixa}`);
    assert.ok(automaticas.itens.every((n) => n.criadaPor === null && n.contagem.pendentes === 0));
    assert.ok(automaticas.itens.filter((n) => n.faixa === 30).every((n) => n.obrigatoria));
    assert.ok(automaticas.itens.filter((n) => n.faixa === 120).every((n) => !n.obrigatoria));
  });

  test('contrato que passa a vencer em 120 dias gera aviso ao gestor e ao fiscal; repetir a varredura não duplica', async () => {
    const hoje = app.agora.hoje();
    const alvo = await contratoVigente(app, 'c.vigencia_fim > $2', [adicionarDias(hoje, 200)]);
    await app.agora.banco.executar('UPDATE contratos SET vigencia_fim = $2 WHERE id = $1', [alvo.id, adicionarDias(hoje, 120)]);

    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/notificacoes/varredura')).statusCode, 403, 'só a administração força a varredura');
    const r = await chamar(app, admin, 'POST', '/api/v1/notificacoes/varredura');
    assert.equal(r.statusCode, 200, r.body);
    const resultado = r.json<ResultadoVarreduraNotificacoes>();
    assert.equal(resultado.notificacoesCriadas, 1);
    assert.equal(resultado.enviosProcessados, resultado.enviosCriados);

    const lista = await obterJson<Pagina<NotificacaoResumo>>(app, gestor, `/api/v1/notificacoes?instrumentoTipo=contrato&instrumentoId=${alvo.id}&faixa=120`);
    assert.equal(lista.total, 1);
    const aviso = lista.itens[0];
    assert.ok(aviso);
    assert.equal(aviso.assunto, `Contrato ${alvo.numero}: vigência termina em 120 dias (faixa de 120 dias)`);
    const detalhe = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${aviso.id}`);
    assert.deepEqual(detalhe.envios.map((e) => e.papel).sort(), ['fiscal', 'gestor']);
    for (const envio of detalhe.envios) {
      assert.equal(envio.situacao, 'enviado');
      assert.equal(envio.modo, 'simulado');
      assert.equal(envio.tentativas, 1);
      assert.match(envio.endereco ?? '', /^[^*@]\*+@/, 'e-mail mascarado');
      assert.match(envio.baseLegal, /LGPD/);
      assert.ok(envio.protocolo);
    }
    assert.match(detalhe.corpo, /Providência sugerida: avaliar se a prorrogação é vantajosa/);

    const segunda = (await chamar(app, admin, 'POST', '/api/v1/notificacoes/varredura')).json<ResultadoVarreduraNotificacoes>();
    assert.equal(segunda.notificacoesCriadas, 0, 'idempotente');

    const historico = await obterJson<{ acao: string }[]>(app, gestor, `/api/v1/contratos/${alvo.id}/historico`);
    assert.ok(historico.some((h) => h.acao.startsWith('Gerou aviso automático de vencimento (faixa de 120 dias)')));

    // Prorrogação muda o fim da vigência e reinicia o ciclo de avisos.
    await app.agora.banco.executar('UPDATE contratos SET vigencia_fim = $2 WHERE id = $1', [alvo.id, adicionarDias(hoje, 119)]);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/notificacoes/varredura')).json<ResultadoVarreduraNotificacoes>().notificacoesCriadas, 1);
  });

  test('disparo manual em um clique: ocorrência ao fiscal e à contratada por e-mail e SEI, obrigatória e auditada', async () => {
    const alvo = await contratoVigente(app, 'true');
    const r = await chamar(app, gestor, 'POST', '/api/v1/notificacoes', {
      instrumentoTipo: 'contrato',
      instrumentoId: alvo.id,
      tipo: 'ocorrencia',
      destinatarios: ['fiscal', 'contratada'],
      canais: ['email', 'sei'],
      detalhe: 'Equipe incompleta no posto de atendimento em três dias consecutivos.',
      dataReferencia: adicionarDias(app.agora.hoje(), 5),
      complemento: 'Responder pelo processo SEI.',
    });
    assert.equal(r.statusCode, 201, r.body);
    const detalhe = r.json<NotificacaoDetalhe>();
    assert.equal(detalhe.origem, 'manual');
    assert.equal(detalhe.obrigatoria, true);
    assert.equal(detalhe.criadaPor?.id, gestor.sessao.usuario.id);
    assert.equal(detalhe.envios.length, 4);
    assert.ok(detalhe.envios.every((e) => e.situacao === 'enviado'), JSON.stringify(detalhe.envios.map((e) => [e.canal, e.situacao, e.ultimoErro])));
    const sei = detalhe.envios.filter((e) => e.canal === 'sei');
    assert.ok(sei.every((e) => e.endereco === alvo.processo_sei && /^SEI-SIM-/.test(e.protocolo ?? '')));
    const contratada = detalhe.envios.find((e) => e.papel === 'contratada' && e.canal === 'email');
    assert.match(contratada?.baseLegal ?? '', /art\. 7º, II e V/);
    assert.match(detalhe.corpo, /Mensagem de quem enviou: Responder pelo processo SEI\./);

    const emails = await app.agora.banco.consultar<{ email: string }>(
      'SELECT u.email FROM usuarios u WHERE u.id = $1 UNION SELECT f.email FROM fornecedores f JOIN contratos c ON c.fornecedor_id = f.id WHERE c.id = $2',
      [alvo.fiscal_id, alvo.id],
    );
    for (const { email } of emails) assert.ok(!r.body.includes(email), 'e-mail completo nunca sai na resposta');

    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=notificacao.disparar');
    assert.ok(trilha.itens.some((e) => e.recursoId === detalhe.id));
  });

  test('preferências: o servidor desliga um tipo opcional; o aviso obrigatório chega mesmo assim', async () => {
    const inicial = await obterJson<PreferenciaNotificacao[]>(app, fiscal, '/api/v1/notificacoes/preferencias');
    assert.equal(inicial.length, 10);
    assert.ok(inicial.every((p) => p.padrao));
    assert.equal(inicial.find((p) => p.tipo === 'reajuste' && p.canal === 'email')?.ativo, true);
    assert.equal(inicial.find((p) => p.tipo === 'reajuste' && p.canal === 'govbr')?.ativo, false);
    assert.match(inicial.find((p) => p.tipo === 'ocorrencia' && p.canal === 'email')?.obrigatorios ?? '', /obrigatórios/);

    const r = await chamar(app, fiscal, 'PUT', '/api/v1/notificacoes/preferencias', {
      preferencias: [
        { tipo: 'reajuste', canal: 'email', ativo: false },
        { tipo: 'ocorrencia', canal: 'email', ativo: false },
      ],
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<PreferenciaNotificacao[]>().find((p) => p.tipo === 'reajuste' && p.canal === 'email')?.ativo, false);

    const alvo = await contratoVigente(app, 'c.fiscal_id = $2', [fiscal.sessao.usuario.id]);
    const reajuste = (
      await chamar(app, gestor, 'POST', '/api/v1/notificacoes', {
        instrumentoTipo: 'contrato',
        instrumentoId: alvo.id,
        tipo: 'reajuste',
        destinatarios: ['fiscal'],
        canais: ['email', 'govbr'],
      })
    ).json<NotificacaoDetalhe>();
    assert.deepEqual(
      reajuste.envios.map((e) => [e.canal, e.situacao]),
      [
        ['email', 'suprimido'],
        ['govbr', 'suprimido'],
      ],
    );
    assert.match(reajuste.envios[0]?.motivoSupressao ?? '', /optou por não receber/);
    assert.match(reajuste.envios[1]?.motivoSupressao ?? '', /não aderiu/);

    const ocorrencia = (
      await chamar(app, gestor, 'POST', '/api/v1/notificacoes', {
        instrumentoTipo: 'contrato',
        instrumentoId: alvo.id,
        tipo: 'ocorrencia',
        destinatarios: ['fiscal'],
        canais: ['email'],
        detalhe: 'Atraso na entrega do relatório mensal de execução.',
      })
    ).json<NotificacaoDetalhe>();
    assert.equal(ocorrencia.envios[0]?.situacao, 'enviado', 'obrigatório ignora a preferência');

    const suprimido = reajuste.envios[0];
    assert.ok(suprimido);
    const reenvio = await chamar(app, gestor, 'POST', `/api/v1/notificacoes/envios/${suprimido.id}/reenviar`);
    assert.equal(reenvio.statusCode, 422, 'envio suprimido não é reenviado');

    const minhas = await obterJson<Pagina<NotificacaoResumo>>(app, fiscal, '/api/v1/notificacoes?minhas=true&tipo=ocorrencia');
    assert.ok(minhas.itens.some((n) => n.id === ocorrencia.id));
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=notificacao.preferencias');
    assert.ok(trilha.total >= 1);
  });

  test('fila: falha temporária reagenda (1, 5, 15, 60 min), a 5ª falha marca "falhou" e o reenvio cria novo envio', async () => {
    const tempo = relogioManual();
    const local = await criarAppTeste({ relogio: tempo.relogio, env: { AGORA_NOTIFICACOES_AGENDADOR: 'externo' } });
    try {
      const ctx = local.agora;
      const [c] = await ctx.banco.consultar<{ id: string }>(
        'SELECT id FROM contratos WHERE vigencia_fim >= $1 AND fiscal_id IS NOT NULL ORDER BY numero LIMIT 1',
        [ctx.hoje()],
      );
      assert.ok(c);
      const instrumento = await carregarInstrumento(ctx.banco, 'contrato', c.id, null);
      assert.ok(instrumento);
      const [autor] = await ctx.banco.consultar<{ id: string }>("SELECT id FROM usuarios WHERE email = 'gestor@agora.demo'");
      assert.ok(autor);
      const gravada = await ctx.banco.transacao((tx) =>
        criarNotificacaoManual(tx, ctx.config, ctx.relogio(), ctx.hoje(), instrumento, {
          tipo: 'vencimento',
          destinatarios: ['fiscal'],
          canais: ['email'],
          dataReferencia: null,
          detalhe: null,
          complemento: null,
        }, autor.id),
      );
      let chamadas = 0;
      const falhando: DriverCanal = {
        canal: 'email',
        modo: 'smtp',
        descricao: 'teste',
        enviar: () => {
          chamadas++;
          return Promise.reject(new ErroEnvio('421 Serviço temporariamente indisponível para fulano@orgao.gov.br'));
        },
      };
      const drivers = { email: falhando } as unknown as DriversCanais;
      const situacao = async () =>
        (
          await ctx.banco.consultar<{ situacao: string; tentativas: number; proxima_tentativa_em: string | null; ultimo_erro: string | null }>(
            'SELECT situacao, tentativas, proxima_tentativa_em, ultimo_erro FROM notificacoes_envios WHERE notificacao_id = $1 AND reenvio_de IS NULL',
            [gravada.id],
          )
        )[0];

      assert.equal(await processarFila(ctx, { drivers, notificacaoId: gravada.id }), 1);
      let s = await situacao();
      assert.equal(s?.situacao, 'pendente');
      assert.equal(s?.tentativas, 1);
      assert.equal(s?.ultimo_erro, '421 Serviço temporariamente indisponível para f*****@orgao.gov.br', 'e-mail mascarado no erro');
      assert.equal(await processarFila(ctx, { drivers, notificacaoId: gravada.id }), 0, 'ainda não venceu a espera');

      for (const minutos of [1, 5, 15, 60]) {
        tempo.avancar(minutos * 60_000);
        assert.equal(await processarFila(ctx, { drivers, notificacaoId: gravada.id }), 1, `após ${minutos} min`);
      }
      s = await situacao();
      assert.equal(s?.situacao, 'falhou');
      assert.equal(s?.tentativas, 5);
      assert.equal(s?.proxima_tentativa_em, null);
      assert.equal(chamadas, 5);

      const gestorLocal = await entrar(local, 'gestor@agora.demo');
      const [envio] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM notificacoes_envios WHERE notificacao_id = $1', [gravada.id]);
      assert.ok(envio);
      const r = await chamar(local, gestorLocal, 'POST', `/api/v1/notificacoes/envios/${envio.id}/reenviar`);
      assert.equal(r.statusCode, 201, r.body);
      const detalhe = r.json<NotificacaoDetalhe>();
      assert.equal(detalhe.envios.length, 2);
      const novo = detalhe.envios.find((e) => e.reenvioDe === envio.id);
      assert.equal(novo?.situacao, 'enviado');
      assert.deepEqual(detalhe.contagem, { total: 1, enviados: 1, pendentes: 0, falhas: 0, suprimidos: 0 }, 'conta só o envio vigente');
      assert.equal((await chamar(local, gestorLocal, 'POST', `/api/v1/notificacoes/envios/${envio.id}/reenviar`)).statusCode, 409);

      const falhas = await obterJson<Pagina<EventoAuditoria>>(local, await entrar(local, 'auditor@agora.demo'), '/api/v1/auditoria?acao=notificacao.envio_falha');
      assert.equal(falhas.total, 5);
    } finally {
      await local.close();
    }
  });

  test('agendador (processo à parte): a 1ª execução do dia varre e esvazia a fila; a seguinte só confere a fila', async () => {
    const local = await criarAppTeste({ env: { AGORA_NOTIFICACOES_AGENDADOR: 'externo' } });
    try {
      const [antes] = await local.agora.banco.consultar<{ n: number }>('SELECT COUNT(*)::integer AS n FROM notificacoes');
      assert.equal(antes?.n, 0, 'com agendador externo a API não varre');
      const falhas: unknown[] = [];
      const agenda = agendarNotificacoes({ contexto: local.agora, aoFalhar: (e) => falhas.push(e) });
      try {
        const primeiro = await agenda.executarAgora();
        assert.ok((primeiro?.varredura?.notificacoesCriadas ?? 0) > 20);
        assert.ok((primeiro?.enviosProcessados ?? 0) > 0 && (primeiro?.enviosProcessados ?? 0) <= (primeiro?.varredura?.enviosCriados ?? 0));
        const segundo = await agenda.executarAgora();
        assert.equal(segundo?.varredura, null, 'o dia já foi varrido');
        assert.equal(segundo?.enviosProcessados, 0);
        assert.deepEqual(falhas, []);
      } finally {
        agenda.parar();
      }
    } finally {
      await local.close();
    }
  });

  test('autorização e escopo: consulta não vê a central; financeiro só lê; fora do escopo responde 404', async () => {
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/notificacoes')).statusCode, 403);
    assert.equal((await chamar(app, financeiro, 'GET', '/api/v1/notificacoes')).statusCode, 200);
    const alvo = await contratoVigente(app, 'true');
    const disparo = { instrumentoTipo: 'contrato', instrumentoId: alvo.id, tipo: 'vencimento', destinatarios: ['gestor'], canais: ['email'] };
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/notificacoes', disparo)).statusCode, 403);

    const uasgsFiscal = new Set(fiscal.sessao.usuario.uasgs);
    const [fora] = await app.agora.banco.consultar<{ id: string; uasg: string }>(
      "SELECT id, uasg FROM notificacoes WHERE NOT (uasg = ANY($1::text[])) ORDER BY criada_em LIMIT 1",
      [[...uasgsFiscal]],
    );
    assert.ok(fora);
    assert.equal((await chamar(app, fiscal, 'GET', `/api/v1/notificacoes/${fora.id}`)).statusCode, 404);
    const doFiscal = await obterJson<Pagina<NotificacaoResumo>>(app, fiscal, '/api/v1/notificacoes?tamanhoPagina=100');
    assert.ok(doFiscal.itens.every((n) => uasgsFiscal.has(n.uasg)));

    const [contratoFora] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM contratos WHERE NOT (uasg = ANY($1::text[])) LIMIT 1', [[...uasgsFiscal]]);
    assert.ok(contratoFora);
    const r = await chamar(app, fiscal, 'POST', '/api/v1/notificacoes', { ...disparo, instrumentoId: contratoFora.id });
    assert.equal(r.statusCode, 404);
  });

  test('validação: entrada malformada → 400; regra do domínio → 422', async () => {
    const alvo = await contratoVigente(app, 'true');
    const base = { instrumentoTipo: 'contrato', instrumentoId: alvo.id, tipo: 'vencimento', destinatarios: ['gestor'], canais: ['email'] };
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/notificacoes', { ...base, destinatarios: [] })).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/notificacoes', { ...base, canais: ['email', 'email'] })).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/notificacoes', { ...base, canais: ['fax'] })).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/notificacoes', { ...base, tipo: 'ocorrencia', detalhe: 'curto' })).statusCode, 422);
    const [ata] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM atas WHERE gestor_id IS NOT NULL LIMIT 1');
    assert.ok(ata);
    const r = await chamar(app, gestor, 'POST', '/api/v1/notificacoes', { ...base, instrumentoTipo: 'ata', instrumentoId: ata.id, destinatarios: ['fiscal'] });
    assert.equal(r.statusCode, 422);
    assert.match(r.body, /não tem fiscal/);
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/notificacoes?faixa=45')).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/notificacoes/nao-e-uuid')).statusCode, 404);
  });

  test('linha do tempo de vencimentos (painel): 0 a 120 dias, por faixa, coerente com o semáforo do painel', async () => {
    const linha = await obterJson<LinhaTempoVencimentos>(app, consulta, '/api/v1/vencimentos');
    assert.equal(linha.hoje, app.agora.hoje());
    assert.ok(linha.instrumentos.length > 0);
    assert.ok(linha.instrumentos.every((i) => i.diasRestantes >= 0 && i.diasRestantes <= 120));
    assert.ok(linha.instrumentos.every((i, n, l) => n === 0 || (l[n - 1]?.diasRestantes ?? 0) <= i.diasRestantes));
    const uasgsConsulta = new Set(consulta.sessao.usuario.uasgs);
    assert.ok(linha.instrumentos.every((i) => uasgsConsulta.has(i.uasg)), 'escopo de UASG');

    const painel = await obterJson<Painel>(app, gestor, '/api/v1/painel');
    const todas = await obterJson<LinhaTempoVencimentos>(app, gestor, '/api/v1/vencimentos');
    const contar = (faixa: number) => todas.instrumentos.filter((i) => i.faixa === faixa).length;
    assert.equal(painel.vencimentos.em120, contar(120));
    assert.equal(painel.vencimentos.em90, contar(90));
    assert.equal(painel.vencimentos.em30, contar(30));
    assert.ok(todas.instrumentos.filter((i) => i.faixa === 120).every((i) => i.semaforo === 'planejamento'));
  });

  test('LGPD: a trilha das notificações não guarda e-mails nem CPFs', async () => {
    const contatos = await app.agora.banco.consultar<{ valor: string }>(
      "SELECT email AS valor FROM usuarios UNION SELECT cpf FROM usuarios UNION SELECT email FROM fornecedores WHERE email IS NOT NULL",
    );
    const eventos = await app.agora.banco.consultar<{ texto: string }>(
      "SELECT resumo || ' ' || dados::text AS texto FROM auditoria_eventos WHERE acao LIKE 'notificacao.%'",
    );
    assert.ok(eventos.length > 50);
    const vazados = eventos.filter((e) => contatos.some((c) => e.texto.includes(c.valor)));
    assert.deepEqual(vazados, []);
    assert.equal(sanitizarErro('550 <maria.silva@orgao.gov.br>: caixa inexistente'), '550 <m**********@orgao.gov.br>: caixa inexistente');
  });
});
