import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, EventoHistorico, Pagina, Pendencia, RespostaErro, VerificacaoAuditoria } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('pendências: resolver e reabrir com auditoria', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let auditor: Credenciais;

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    auditor = await entrar(app, 'auditor@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('filtros e ordenação da fila de pendências', async () => {
    const abertas = await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?situacao=aberta&tamanhoPagina=100');
    assert.ok(abertas.total >= 60);
    assert.ok(abertas.itens.every((p) => p.situacao === 'aberta' && p.resolvidaEm === null));
    const pesos = { alta: 0, media: 1, baixa: 2 };
    const ordem = abertas.itens.map((p) => pesos[p.prioridade]);
    assert.deepEqual(ordem, [...ordem].sort((a, b) => a - b), 'ordenadas por prioridade');

    const resolvidas = await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?situacao=resolvida');
    assert.ok(resolvidas.total > 0);
    assert.ok(resolvidas.itens.every((p) => p.resolvidaPor !== null && p.observacaoResolucao !== null));

    const divulgacao = await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?tipo=divulgacao_pncp');
    assert.ok(divulgacao.itens.every((p) => p.tipo === 'divulgacao_pncp' && p.instrumento.tipo === 'contrato'));

    const minhas = await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?responsavel=eu&tamanhoPagina=100');
    assert.ok(minhas.itens.every((p) => p.responsavel?.id === gestor.sessao.usuario.id));

    const porPrazo = await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?ordenarPor=prazo&ordem=asc&tamanhoPagina=50');
    const prazos = porPrazo.itens.map((p) => p.prazo).filter((p): p is string => p !== null);
    assert.deepEqual(prazos, [...prazos].sort());
  });

  test('resolver exige observação de 5 a 500 caracteres', async () => {
    const [alvo] = (await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?situacao=aberta&tamanhoPagina=1')).itens;
    assert.ok(alvo);
    const curta = await chamar(app, gestor, 'POST', `/api/v1/pendencias/${alvo.id}/resolver`, { observacao: 'ok' });
    assert.equal(curta.statusCode, 400);
    const corpo = curta.json<RespostaErro>();
    assert.equal(corpo.erro.codigo, 'VALIDACAO');
    assert.equal(corpo.erro.detalhes?.[0]?.campo, 'observacao');
  });

  test('resolver e reabrir: estado, conflito, trilha de auditoria e histórico do instrumento', async () => {
    const [alvo] = (await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?situacao=aberta&tipo=vigencia&tamanhoPagina=1')).itens;
    assert.ok(alvo);
    const resolvida = await chamar(app, gestor, 'POST', `/api/v1/pendencias/${alvo.id}/resolver`, {
      observacao: 'Prorrogação autuada no processo SEI.',
    });
    assert.equal(resolvida.statusCode, 200);
    const pendencia = resolvida.json<Pendencia>();
    assert.equal(pendencia.situacao, 'resolvida');
    assert.equal(pendencia.resolvidaPor?.id, gestor.sessao.usuario.id);
    assert.equal(pendencia.observacaoResolucao, 'Prorrogação autuada no processo SEI.');
    assert.ok(pendencia.resolvidaEm);

    const repetida = await chamar(app, gestor, 'POST', `/api/v1/pendencias/${alvo.id}/resolver`, { observacao: 'de novo, por engano' });
    assert.equal(repetida.statusCode, 409);
    assert.equal(repetida.json<RespostaErro>().erro.codigo, 'CONFLITO');

    const reaberta = await chamar(app, gestor, 'POST', `/api/v1/pendencias/${alvo.id}/reabrir`);
    assert.equal(reaberta.statusCode, 200);
    const depois = reaberta.json<Pendencia>();
    assert.equal(depois.situacao, 'aberta');
    assert.equal(depois.resolvidaEm, null);
    assert.equal(depois.resolvidaPor, null);

    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?recurso=pendencia&tamanhoPagina=100');
    const doAlvo = trilha.itens.filter((e) => e.recursoId === alvo.id);
    assert.deepEqual(
      doAlvo.map((e) => e.acao),
      ['pendencia.reabrir', 'pendencia.resolver'],
      'eventos mais recentes primeiro',
    );
    assert.equal(doAlvo[0]?.usuario?.id, gestor.sessao.usuario.id);
    assert.equal(doAlvo[0]?.hashAnterior, doAlvo[1]?.hash, 'eventos consecutivos encadeados');
    assert.match(doAlvo[1]?.resumo ?? '', /^Resolveu pendência de vigência/);

    const rota = alvo.instrumento.tipo === 'ata' ? 'atas' : 'contratos';
    const historico = await obterJson<EventoHistorico[]>(app, gestor, `/api/v1/${rota}/${alvo.instrumento.id}/historico`);
    assert.ok(historico.some((h) => h.acao.startsWith('Reabriu pendência')));
    assert.ok(historico.some((h) => h.acao.startsWith('Resolveu pendência')));

    const verificacao = await obterJson<VerificacaoAuditoria>(app, auditor, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);
  });
});
