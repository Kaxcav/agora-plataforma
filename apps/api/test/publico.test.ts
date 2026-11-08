import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ContratoPublico, Pagina } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { criarAppTeste } from './apoio.ts';

describe('transparência pública (sem login) e Caderno de Regras', () => {
  let app: FastifyInstance;
  let documentosPf: string[];
  let nomesPf: string[];
  let dadosServidores: string[];

  before(async () => {
    app = await criarAppTeste();
    const pf = await app.agora.banco.consultar<{ documento: string; razao_social: string; email: string; telefone: string }>(
      "SELECT documento, razao_social, email, telefone FROM fornecedores WHERE tipo_pessoa = 'PF'",
    );
    documentosPf = pf.map((p) => p.documento);
    nomesPf = pf.map((p) => p.razao_social);
    const usuarios = await app.agora.banco.consultar<{ nome: string; email: string; cpf: string }>('SELECT nome, email, cpf FROM usuarios');
    dadosServidores = usuarios.flatMap((u) => [u.nome, u.email, u.cpf]);
  });
  after(async () => {
    await app.close();
  });

  test('lista e detalhe de contratos funcionam sem sessão', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/v1/publico/contratos?tamanhoPagina=100' });
    assert.equal(lista.statusCode, 200);
    const pagina = lista.json<Pagina<ContratoPublico>>();
    assert.equal(pagina.total, 60);
    const primeiro = pagina.itens[0];
    assert.ok(primeiro);
    assert.deepEqual(Object.keys(primeiro).sort(), [
      'documentoFornecedor', 'fornecedor', 'id', 'linkPncp', 'numero', 'objeto', 'orgao', 'uasg', 'valorGlobal', 'valorPago', 'vigenciaFim', 'vigenciaInicio',
    ]);
    const detalhe = await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${primeiro.id}` });
    assert.equal(detalhe.statusCode, 200);
    assert.deepEqual(detalhe.json<ContratoPublico>(), primeiro);
    const inexistente = await app.inject({ method: 'GET', url: '/api/v1/publico/contratos/00000000-0000-4000-8000-000000000000' });
    assert.equal(inexistente.statusCode, 404);
    const busca = await app.inject({ method: 'GET', url: '/api/v1/publico/contratos?busca=colete' });
    assert.ok(busca.json<Pagina<ContratoPublico>>().itens.every((c) => /colete/i.test(c.objeto)));
  });

  test('nenhum dado pessoal vaza: CPF e nome de PF mascarados, sem servidores, e-mails ou telefones', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/v1/publico/contratos?tamanhoPagina=100' });
    const texto = lista.body;
    for (const documento of documentosPf) assert.ok(!texto.includes(documento), 'CPF de pessoa física não aparece');
    for (const nome of nomesPf) assert.ok(!texto.includes(nome), 'nome completo de pessoa física não aparece');
    for (const dado of dadosServidores) assert.ok(!texto.includes(dado), 'dados de servidores não aparecem');
    assert.ok(!/@/.test(texto), 'sem e-mails');
    const pagina = lista.json<Pagina<ContratoPublico>>();
    const pf = pagina.itens.filter((c) => c.documentoFornecedor.startsWith('***'));
    assert.ok(pf.length > 0, 'há contratos com pessoa física, todos mascarados');
    for (const c of pf) assert.match(c.documentoFornecedor, /^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
  });

  test('Caderno de Regras público vem de @agora/dominio', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/catalogo-regras' });
    assert.equal(r.statusCode, 200);
    const regras = r.json<{ id: string; tipo: string; fundamento: string }[]>();
    assert.ok(regras.some((regra) => regra.id === 'RN-10'));
    assert.ok(regras.some((regra) => regra.id === 'RNF-03'));
  });

  test('rotas autenticadas continuam fechadas', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/fornecedores' });
    assert.equal(r.statusCode, 401);
  });
});
