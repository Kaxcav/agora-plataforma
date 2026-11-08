import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, RespostaErro, RespostaSenhaTemporaria, Sessao, UsuarioAdmin } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, relogioManual, type Credenciais } from './apoio.ts';

const HORA_MS = 60 * 60 * 1000;

function codigo(resposta: { json<T>(): T }): string {
  return resposta.json<RespostaErro>().erro.codigo;
}

describe('manutenção de conta: troca de senha, senha temporária e troca obrigatória', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let usuarios: UsuarioAdmin[];
  const idDe = (email: string) => {
    const u = usuarios.find((x) => x.email === email);
    if (!u) throw new Error(email);
    return u.id;
  };

  before(async () => {
    app = await criarAppTeste();
    admin = await entrar(app, 'admin@agora.demo');
    usuarios = (await obterJson<Pagina<UsuarioAdmin>>(app, admin, '/api/v1/usuarios?tamanhoPagina=100')).itens;
  });
  after(async () => {
    await app.close();
  });

  test('a sessão informa deveTrocarSenha (falso para os usuários de demonstração)', async () => {
    assert.equal(admin.sessao.usuario.deveTrocarSenha, false);
    const atual = await obterJson<Sessao>(app, admin, '/api/v1/sessao');
    assert.equal(atual.usuario.deveTrocarSenha, false);
  });

  test('POST /sessao/senha confere a senha atual, aplica a política, encerra as outras sessões e é auditado', async () => {
    const principal = await entrar(app, 'financeiro@agora.demo');
    const outra = await entrar(app, 'financeiro@agora.demo');

    const semCsrf = await app.inject({ method: 'POST', url: '/api/v1/sessao/senha', headers: { cookie: principal.cookie }, payload: {} });
    assert.equal(semCsrf.statusCode, 403);
    const errada = await chamar(app, principal, 'POST', '/api/v1/sessao/senha', { senhaAtual: 'nao-e-esta-123', novaSenha: 'Nova-Senha-Forte-2026' });
    assert.equal(errada.statusCode, 401);
    const curta = await chamar(app, principal, 'POST', '/api/v1/sessao/senha', { senhaAtual: 'Agora@Demo2026', novaSenha: 'Curta-1' });
    assert.equal(curta.statusCode, 400);
    assert.equal(curta.json<RespostaErro>().erro.detalhes?.[0]?.campo, 'novaSenha');
    const igual = await chamar(app, principal, 'POST', '/api/v1/sessao/senha', { senhaAtual: 'Agora@Demo2026', novaSenha: 'Agora@Demo2026' });
    assert.equal(igual.statusCode, 400);
    assert.match(igual.json<RespostaErro>().erro.mensagem, /diferente da atual/);

    const trocada = await chamar(app, principal, 'POST', '/api/v1/sessao/senha', { senhaAtual: 'Agora@Demo2026', novaSenha: 'Nova-Senha-Forte-2026' });
    assert.equal(trocada.statusCode, 204);
    assert.equal((await chamar(app, principal, 'GET', '/api/v1/sessao')).statusCode, 200, 'a sessão atual continua válida');
    assert.equal((await chamar(app, outra, 'GET', '/api/v1/sessao')).statusCode, 401, 'as outras sessões foram encerradas');

    const antiga = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'financeiro@agora.demo', senha: 'Agora@Demo2026' } });
    assert.equal(antiga.statusCode, 401);
    await entrar(app, 'financeiro@agora.demo', 'Nova-Senha-Forte-2026');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?recurso=usuario&tamanhoPagina=100');
    const evento = trilha.itens.find((e) => e.acao === 'sessao.trocar_senha');
    assert.ok(evento);
    assert.equal(evento.recursoId, principal.sessao.usuario.id);
    assert.ok(trilha.itens.some((e) => e.acao === 'sessao.trocar_senha_falhar'));
    const dados = await app.agora.banco.consultar<{ dados: string }>("SELECT dados::text AS dados FROM auditoria_eventos WHERE acao LIKE 'sessao.trocar_senha%'");
    assert.doesNotMatch(JSON.stringify(dados), /Nova-Senha-Forte|nao-e-esta|Agora@Demo/);
  });

  test('erros repetidos de senha atual são limitados (429)', async () => {
    const credenciais = await entrar(app, 'consulta@agora.demo');
    for (let i = 0; i < 5; i++) {
      const r = await chamar(app, credenciais, 'POST', '/api/v1/sessao/senha', { senhaAtual: `errada-${i}-xxxxxx`, novaSenha: 'Qualquer-Senha-2026' });
      assert.equal(r.statusCode, 401);
    }
    const bloqueada = await chamar(app, credenciais, 'POST', '/api/v1/sessao/senha', { senhaAtual: 'Agora@Demo2026', novaSenha: 'Qualquer-Senha-2026' });
    assert.equal(bloqueada.statusCode, 429);
    assert.equal(codigo(bloqueada), 'LIMITE_TENTATIVAS');
  });

  test('senha temporária: só administrador, exibida uma vez, 72 h, encerra sessões e obriga a troca antes de qualquer rota', async () => {
    const fiscalId = idDe('fiscal@agora.demo');
    const sessaoAnterior = await entrar(app, 'fiscal@agora.demo');
    const gestor = await entrar(app, 'gestor@agora.demo');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/usuarios/${fiscalId}/senha-temporaria`)).statusCode, 403);
    assert.equal((await chamar(app, admin, 'POST', `/api/v1/usuarios/${admin.sessao.usuario.id}/senha-temporaria`)).statusCode, 422);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/usuarios/00000000-0000-4000-8000-000000000000/senha-temporaria')).statusCode, 404);

    const emitida = await chamar(app, admin, 'POST', `/api/v1/usuarios/${fiscalId}/senha-temporaria`);
    assert.equal(emitida.statusCode, 200);
    const { senhaTemporaria, expiraEm } = emitida.json<RespostaSenhaTemporaria>();
    assert.ok(senhaTemporaria.length >= 16);
    const validade = Date.parse(expiraEm) - INICIO_TESTES;
    assert.ok(validade > 71.9 * HORA_MS && validade <= 72.1 * HORA_MS, `validade de 72 h (${validade})`);
    assert.equal((await chamar(app, sessaoAnterior, 'GET', '/api/v1/sessao')).statusCode, 401, 'sessões do usuário encerradas');
    const [hash] = await app.agora.banco.consultar<{ senha_hash: string }>('SELECT senha_hash FROM usuarios WHERE id = $1', [fiscalId]);
    assert.match(hash?.senha_hash ?? '', /^scrypt\$16384\$8\$1\$/);
    const trilha = await app.agora.banco.consultar<{ dados: string; resumo: string }>(
      "SELECT dados::text AS dados, resumo FROM auditoria_eventos WHERE acao = 'usuario.senha_temporaria'",
    );
    assert.equal(trilha.length, 1);
    assert.ok(!trilha[0]?.dados.includes(senhaTemporaria) && !trilha[0]?.resumo.includes(senhaTemporaria), 'a senha não vai para a trilha');

    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'fiscal@agora.demo', senha: 'Agora@Demo2026' } })).statusCode, 401);
    const temporaria = await entrar(app, 'fiscal@agora.demo', senhaTemporaria);
    assert.equal(temporaria.sessao.usuario.deveTrocarSenha, true);
    for (const url of ['/api/v1/painel', '/api/v1/contratos', '/api/v1/pendencias']) {
      const negado = await chamar(app, temporaria, 'GET', url);
      assert.equal(negado.statusCode, 403, url);
      assert.equal(codigo(negado), 'TROCA_SENHA_OBRIGATORIA');
    }
    assert.equal(codigo(await chamar(app, temporaria, 'POST', '/api/v1/pagamentos/00000000-0000-4000-8000-000000000000/atestar')), 'TROCA_SENHA_OBRIGATORIA');
    assert.equal((await chamar(app, temporaria, 'GET', '/api/v1/sessao')).json<Sessao>().usuario.deveTrocarSenha, true);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica', headers: { cookie: temporaria.cookie } })).statusCode, 200);

    const trocada = await chamar(app, temporaria, 'POST', '/api/v1/sessao/senha', { senhaAtual: senhaTemporaria, novaSenha: 'Fiscal-Nova-Senha-2026' });
    assert.equal(trocada.statusCode, 204);
    assert.equal((await chamar(app, temporaria, 'GET', '/api/v1/sessao')).json<Sessao>().usuario.deveTrocarSenha, false);
    assert.equal((await chamar(app, temporaria, 'GET', '/api/v1/painel')).statusCode, 200);
    const [depois] = await app.agora.banco.consultar<{ deve_trocar_senha: boolean; senha_expira_em: string | null }>(
      'SELECT deve_trocar_senha, senha_expira_em FROM usuarios WHERE id = $1',
      [fiscalId],
    );
    assert.deepEqual(depois, { deve_trocar_senha: false, senha_expira_em: null });
    const saida = await chamar(app, temporaria, 'DELETE', '/api/v1/sessao');
    assert.equal(saida.statusCode, 204);
  });
});

describe('senha temporária vencida', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ relogio: tempo.relogio });
  });
  after(async () => {
    await app.close();
  });

  test('depois de 72 h, o login com a senha temporária falha com a mensagem genérica', async () => {
    const admin = await entrar(app, 'admin@agora.demo');
    const usuarios = (await obterJson<Pagina<UsuarioAdmin>>(app, admin, '/api/v1/usuarios?tamanhoPagina=100')).itens;
    const juridico = usuarios.find((u) => u.email === 'juridico@agora.demo');
    assert.ok(juridico);
    const { senhaTemporaria } = (await chamar(app, admin, 'POST', `/api/v1/usuarios/${juridico.id}/senha-temporaria`)).json<RespostaSenhaTemporaria>();

    tempo.avancar(71 * HORA_MS);
    const valida = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'juridico@agora.demo', senha: senhaTemporaria } });
    assert.equal(valida.statusCode, 200);

    tempo.avancar(2 * HORA_MS);
    const vencida = await app.inject({ method: 'POST', url: '/api/v1/sessao', payload: { email: 'juridico@agora.demo', senha: senhaTemporaria } });
    assert.equal(vencida.statusCode, 401);
    assert.equal(vencida.json<RespostaErro>().erro.mensagem, 'E-mail ou senha inválidos.');
    const [falha] = await app.agora.banco.consultar<{ motivo: string | null }>(
      "SELECT dados ->> 'motivo' AS motivo FROM auditoria_eventos WHERE acao = 'sessao.falhar' ORDER BY sequencia DESC LIMIT 1",
    );
    assert.equal(falha?.motivo, 'senha_temporaria_expirada');
  });
});
