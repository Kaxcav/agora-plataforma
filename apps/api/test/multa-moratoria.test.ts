import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ResultadoMultaMoratoria } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, type Credenciais } from './apoio.ts';

describe('simulação de multa moratória (art. 162)', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let consulta: Credenciais;

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });

  after(async () => {
    await app.close();
  });

  test('gestor@agora.demo, parcela 10000000 centavos, 15 dias, 0.5% ao dia, limite 30 → 200, valorMulta 750000, percentualAplicado 7.5, limitado false, fundamento contém art. 162', async () => {
    const entrada = {
      valorParcela: 10_000_000,
      diasAtraso: 15,
      percentualDia: 0.5,
      limiteDias: 30,
    };
    const r = await chamar(app, gestor, 'POST', '/api/v1/sancoes/moratoria/simular', entrada);
    assert.equal(r.statusCode, 200);
    const resultado = r.json<ResultadoMultaMoratoria>();
    assert.equal(resultado.valorMulta, 750_000);
    assert.equal(resultado.percentualAplicado, 7.5);
    assert.equal(resultado.limitado, false);
    assert.equal(resultado.diasConsiderados, 15);
    assert.match(resultado.fundamento, /art\. 162/);
  });

  test('45 dias com limite 30 → limitado true, diasConsiderados 30', async () => {
    const entrada = {
      valorParcela: 10_000_000,
      diasAtraso: 45,
      percentualDia: 0.5,
      limiteDias: 30,
    };
    const r = await chamar(app, gestor, 'POST', '/api/v1/sancoes/moratoria/simular', entrada);
    assert.equal(r.statusCode, 200);
    const resultado = r.json<ResultadoMultaMoratoria>();
    assert.equal(resultado.limitado, true);
    assert.equal(resultado.diasConsiderados, 30);
  });

  test('percentualDia 0 → 400', async () => {
    const entrada = {
      valorParcela: 10_000_000,
      diasAtraso: 15,
      percentualDia: 0,
      limiteDias: 30,
    };
    const r = await chamar(app, gestor, 'POST', '/api/v1/sancoes/moratoria/simular', entrada);
    assert.equal(r.statusCode, 400);
  });

  test('consulta@agora.demo (sem permissão sancoes:ler) → 403', async () => {
    const entrada = {
      valorParcela: 10_000_000,
      diasAtraso: 15,
      percentualDia: 0.5,
      limiteDias: 30,
    };
    const r = await chamar(app, consulta, 'POST', '/api/v1/sancoes/moratoria/simular', entrada);
    assert.equal(r.statusCode, 403);
  });
});
