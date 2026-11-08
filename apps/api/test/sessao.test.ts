import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, RespostaErro, Sessao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, cookieDe, criarAppTeste, entrar, obterJson } from './apoio.ts';

describe('sessão e autenticação', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste();
  });
  after(async () => {
    await app.close();
  });

  test('login com sucesso devolve a sessão e um cookie HttpOnly, SameSite=Strict e assinado', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/v1/sessao',
      payload: { email: 'GESTOR@agora.demo ', senha: 'Agora@Demo2026' },
    });
    assert.equal(resposta.statusCode, 200);
    const sessao = resposta.json<Sessao>();
    assert.equal(sessao.usuario.email, 'gestor@agora.demo', 'o próprio usuário vê o e-mail completo');
    assert.deepEqual(sessao.usuario.perfis, ['gestor_contratos']);
    assert.ok(sessao.usuario.permissoes.includes('pendencias:resolver'));
    assert.equal(sessao.usuario.todasUasgs, true);
    assert.equal(sessao.usuario.uasgs.length, 12);
    assert.ok(sessao.csrfToken.length >= 40);
    assert.ok(Date.parse(sessao.expiraEm) > Date.now());
    const cookie = String(resposta.headers['set-cookie']);
    assert.match(cookie, /^agora_sessao=[^;]+\.[^;]+;/, 'cookie assinado');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/, 'demonstração sem HTTPS');

    const atual = await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie: cookieDe(resposta) } });
    assert.equal(atual.statusCode, 200);
    assert.equal(atual.json<Sessao>().csrfToken, sessao.csrfToken);
  });

  test('falha de login é genérica (senha errada e e-mail inexistente)', async () => {
    const senhaErrada = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'juridico@agora.demo', senha: 'errada-123456' } });
    const inexistente = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'ninguem@agora.demo', senha: 'errada-123456' } });
    for (const r of [senhaErrada, inexistente]) {
      assert.equal(r.statusCode, 401);
      const corpo = r.json<RespostaErro>();
      assert.equal(corpo.erro.codigo, 'NAO_AUTENTICADO');
      assert.equal(corpo.erro.mensagem, 'E-mail ou senha inválidos.');
      assert.ok(corpo.erro.idRequisicao);
      assert.equal(r.headers['set-cookie'], undefined);
    }
  });

  test('5 tentativas malsucedidas por e-mail+IP bloqueiam o login por 15 minutos (429)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'planejamento@agora.demo', senha: `errada-${i}` } });
      assert.equal(r.statusCode, 401);
    }
    const bloqueada = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'planejamento@agora.demo', senha: 'Agora@Demo2026' } });
    assert.equal(bloqueada.statusCode, 429);
    assert.equal(bloqueada.json<RespostaErro>().erro.codigo, 'LIMITE_TENTATIVAS');
    assert.ok(bloqueada.headers['retry-after']);

    const outroUsuario = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'agente@agora.demo', senha: 'Agora@Demo2026' } });
    assert.equal(outroUsuario.statusCode, 200, 'o bloqueio é por e-mail+IP');
  });

  test('sem sessão a API responde 401 NAO_AUTENTICADO', async () => {
    for (const url of ['/api/v1/sessao', '/api/v1/painel', '/api/v1/contratos']) {
      const r = await app.inject({ method: 'GET', url });
      assert.equal(r.statusCode, 401, url);
      assert.equal(r.json<RespostaErro>().erro.codigo, 'NAO_AUTENTICADO');
    }
    const cookieAdulterado = await app.inject({ method: 'GET', url: '/api/v1/painel', headers: { cookie: 'agora_sessao=abc.def' } });
    assert.equal(cookieAdulterado.statusCode, 401);
    const escritaSemSessao = await app.inject({ method: 'POST', url: '/api/v1/pendencias/00000000-0000-4000-8000-000000000000/reabrir' });
    assert.equal(escritaSemSessao.statusCode, 401);
  });

  test('logout exige CSRF, encerra a sessão e é auditado; login e falha também ficam na trilha', async () => {
    const credenciais = await entrar(app, 'financeiro@agora.demo');
    const semCsrf = await app.inject({ method: 'DELETE', url: '/api/v1/sessao', headers: { cookie: credenciais.cookie } });
    assert.equal(semCsrf.statusCode, 403);
    const saida = await chamar(app, credenciais, 'DELETE', '/api/v1/sessao');
    assert.equal(saida.statusCode, 204);
    assert.match(String(saida.headers['set-cookie']), /agora_sessao=;/);
    const depois = await app.inject({ method: 'GET', url: '/api/v1/sessao', headers: { cookie: credenciais.cookie } });
    assert.equal(depois.statusCode, 401);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?recurso=sessao&tamanhoPagina=100');
    const acoes = new Set(trilha.itens.map((e) => e.acao));
    assert.ok(acoes.has('sessao.entrar'));
    assert.ok(acoes.has('sessao.sair'));
    assert.ok(acoes.has('sessao.falhar'));
    const falha = trilha.itens.find((e) => e.acao === 'sessao.falhar');
    assert.ok(falha);
    assert.doesNotMatch(JSON.stringify(trilha), /errada-/, 'senhas nunca vão para a trilha');
  });

  test('Login Único gov.br desabilitado sem configuração', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/sessao/govbr/iniciar' });
    assert.equal(r.statusCode, 404);
    const config = await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' });
    assert.equal(config.json<{ govbrHabilitado: boolean }>().govbrHabilitado, false);
  });
});
