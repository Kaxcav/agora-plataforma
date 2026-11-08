import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AtaResumo,
  ContratoResumo,
  ItemCarteira,
  Pagina,
  PaginaEmpenhos,
  Pagamento,
  Painel,
  Pendencia,
  PerfilAcesso,
  RespostaErro,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { TODAS_PERMISSOES } from '../src/autorizacao/perfis.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('autorização: RBAC por perfil e escopo por UASG', () => {
  let app: FastifyInstance;
  let consulta: Credenciais;
  let gestor: Credenciais;
  let uasgsConsulta: Set<string>;

  before(async () => {
    app = await criarAppTeste();
    consulta = await entrar(app, 'consulta@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    uasgsConsulta = new Set(consulta.sessao.usuario.uasgs);
  });
  after(async () => {
    await app.close();
  });

  test('o usuário de consulta tem escopo de exatamente 2 UASGs e só permissões de leitura', () => {
    assert.equal(consulta.sessao.usuario.todasUasgs, false);
    assert.equal(uasgsConsulta.size, 2);
    assert.ok(consulta.sessao.usuario.permissoes.every((p) => p.endsWith(':ler')));
  });

  test('consulta não pode resolver pendência → 403 SEM_PERMISSAO', async () => {
    const pendencias = await obterJson<Pagina<Pendencia>>(app, consulta, '/api/v1/pendencias?situacao=aberta&tamanhoPagina=1');
    const alvo = pendencias.itens[0];
    assert.ok(alvo, 'há pendência aberta no escopo da consulta');
    const r = await chamar(app, consulta, 'POST', `/api/v1/pendencias/${alvo.id}/resolver`, { observacao: 'tentativa sem permissão' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json<RespostaErro>().erro.codigo, 'SEM_PERMISSAO');
    for (const [metodo, url] of [
      ['GET', '/api/v1/usuarios'],
      ['GET', '/api/v1/auditoria'],
      ['GET', '/api/v1/lgpd/acessos'],
      ['POST', '/api/v1/sincronizacoes/PNCP/executar'],
    ] as const) {
      const negado = await chamar(app, consulta, metodo, url);
      assert.equal(negado.statusCode, 403, `${metodo} ${url}`);
    }
  });

  test('consulta só enxerga registros das suas 2 UASGs (filtro no SQL)', async () => {
    const contratos = await obterJson<Pagina<ContratoResumo>>(app, consulta, '/api/v1/contratos?tamanhoPagina=100');
    assert.ok(contratos.total > 0);
    assert.ok(contratos.itens.every((c) => uasgsConsulta.has(c.uasg.codigo)));
    const todos = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?tamanhoPagina=100');
    assert.ok(todos.total > contratos.total, 'o gestor (todas as UASGs) vê mais contratos');

    const atas = await obterJson<Pagina<AtaResumo>>(app, consulta, '/api/v1/atas?tamanhoPagina=100');
    assert.ok(atas.itens.every((a) => uasgsConsulta.has(a.uasgGerenciadora.codigo)));
    const pendencias = await obterJson<Pagina<Pendencia>>(app, consulta, '/api/v1/pendencias?tamanhoPagina=100');
    assert.ok(pendencias.itens.every((p) => uasgsConsulta.has(p.uasg)));
    const empenhos = await obterJson<PaginaEmpenhos>(app, consulta, '/api/v1/empenhos?tamanhoPagina=100');
    assert.ok(empenhos.itens.every((e) => uasgsConsulta.has(e.uasg)));
    const itens = await obterJson<Pagina<ItemCarteira>>(app, consulta, '/api/v1/itens?tamanhoPagina=100');
    assert.ok(itens.itens.every((i) => uasgsConsulta.has(i.uasg)));
    const pagamentos = await obterJson<Pagina<Pagamento>>(app, consulta, '/api/v1/pagamentos?tamanhoPagina=100');
    const idsContratosVisiveis = new Set(contratos.itens.map((c) => c.id));
    assert.ok(pagamentos.itens.every((p) => idsContratosVisiveis.has(p.contrato.id)));

    const painelConsulta = await obterJson<Painel>(app, consulta, '/api/v1/painel');
    const painelGestor = await obterJson<Painel>(app, gestor, '/api/v1/painel');
    assert.ok(painelConsulta.indicadores.contratosVigentes < painelGestor.indicadores.contratosVigentes);
  });

  test('id de outra UASG responde 404 (não revela existência)', async () => {
    const todos = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?tamanhoPagina=100');
    const fora = todos.itens.find((c) => !uasgsConsulta.has(c.uasg.codigo));
    assert.ok(fora);
    for (const sufixo of ['', '/itens', '/empenhos', '/historico']) {
      const r = await chamar(app, consulta, 'GET', `/api/v1/contratos/${fora.id}${sufixo}`);
      assert.equal(r.statusCode, 404, sufixo);
      assert.equal(r.json<RespostaErro>().erro.codigo, 'NAO_ENCONTRADO');
    }
    const dentro = todos.itens.find((c) => uasgsConsulta.has(c.uasg.codigo));
    assert.ok(dentro);
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/contratos/${dentro.id}`)).statusCode, 200);

    const atas = await obterJson<Pagina<AtaResumo>>(app, gestor, '/api/v1/atas?tamanhoPagina=100');
    const ataFora = atas.itens.find((a) => !uasgsConsulta.has(a.uasgGerenciadora.codigo));
    assert.ok(ataFora);
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/atas/${ataFora.id}`)).statusCode, 404);

    const pendenciaFora = (await obterJson<Pagina<Pendencia>>(app, gestor, '/api/v1/pendencias?tamanhoPagina=100')).itens.find(
      (p) => !uasgsConsulta.has(p.uasg) && p.situacao === 'aberta',
    );
    assert.ok(pendenciaFora);
    const fiscal = await entrar(app, 'fiscal@agora.demo');
    const uasgsFiscal = new Set(fiscal.sessao.usuario.uasgs);
    if (!uasgsFiscal.has(pendenciaFora.uasg)) {
      const r = await chamar(app, fiscal, 'POST', `/api/v1/pendencias/${pendenciaFora.id}/resolver`, { observacao: 'fora do escopo do fiscal' });
      assert.equal(r.statusCode, 404, 'escrita fora do escopo também responde 404');
    }
  });

  test('matriz de perfis exibida em GET /perfis (administrador)', async () => {
    const admin = await entrar(app, 'admin@agora.demo');
    const perfis = await obterJson<PerfilAcesso[]>(app, admin, '/api/v1/perfis');
    assert.equal(perfis.length, 9);
    const porCodigo = new Map(perfis.map((p) => [p.codigo, p]));
    assert.equal(porCodigo.get('administrador')?.permissoes.length, TODAS_PERMISSOES.length);
    assert.ok(porCodigo.get('agente_contratacao')?.permissoes.includes('disputa:conduzir'));
    assert.ok(!porCodigo.get('planejamento')?.permissoes.includes('disputa:conduzir'), 'segregação: quem planeja não conduz a sessão');
    assert.ok(porCodigo.get('auditor')?.permissoes.includes('lgpd:revelar'));
    assert.ok(!porCodigo.get('auditor')?.permissoes.includes('pendencias:resolver'));
    assert.ok(porCodigo.get('fiscal')?.permissoes.includes('pagamentos:atestar'));
    assert.ok(!porCodigo.get('gestor_contratos')?.permissoes.includes('ajustes:editar'));
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/perfis')).statusCode, 403);
  });
});
