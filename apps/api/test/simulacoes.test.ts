import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { avaliarAditivo, calcularDosimetriaMulta } from '@agora/dominio';
import type {
  ContratoDetalhe,
  ContratoResumo,
  FornecedorDetalhe,
  Pagina,
  RespostaErro,
  ResultadoDosimetria,
  ResultadoSimulacaoAditivo,
  Sancao,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('simulações (art. 125 e art. 156) e instauração de sanção', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let contrato: ContratoDetalhe;

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    const lista = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?situacao=vigente&tamanhoPagina=1');
    const primeiro = lista.itens[0];
    assert.ok(primeiro);
    contrato = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${primeiro.id}`);
  });
  after(async () => {
    await app.close();
  });

  test('simulação de acréscimo aplica o art. 125 via @agora/dominio e consulta a regularidade (RN-09)', async () => {
    const valor = Math.round(contrato.valorInicial * 0.1);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contrato.id}/aditivos/simular`, { tipo: 'acrescimo', valor });
    assert.equal(r.statusCode, 200);
    const resultado = r.json<ResultadoSimulacaoAditivo>();
    const [linha] = await app.agora.banco.consultar<{ reajustes: number }>('SELECT reajustes FROM vw_contratos_valores WHERE contrato_id = $1', [contrato.id]);
    const esperado = avaliarAditivo({
      valorInicialAtualizado: contrato.valorInicial + (linha?.reajustes ?? 0),
      acrescimosAnteriores: contrato.acrescimos,
      supressoesAnteriores: contrato.supressoes,
      tipo: 'acrescimo',
      valor,
      reformaEdificioOuEquipamento: false,
    });
    assert.equal(resultado.percentualAcumulado, esperado.percentualAcumulado);
    assert.equal(resultado.limitePercentual, 25);
    assert.equal(resultado.permitido, esperado.permitido);
    assert.equal(resultado.margemRestante, esperado.margemRestante);
    assert.match(resultado.fundamento, /125/);
    assert.equal(typeof resultado.regularidadeFornecedor.regular, 'boolean');
    assert.ok(Array.isArray(resultado.regularidadeFornecedor.motivos));

    const excessivo = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contrato.id}/aditivos/simular`, {
      tipo: 'acrescimo',
      valor: contrato.valorInicial,
    });
    assert.equal(excessivo.json<ResultadoSimulacaoAditivo>().permitido, false);

    const reforma = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contrato.id}/aditivos/simular`, {
      tipo: 'acrescimo',
      valor: Math.round(contrato.valorInicial * 0.4),
      reformaEdificioOuEquipamento: true,
    });
    assert.equal(reforma.json<ResultadoSimulacaoAditivo>().limitePercentual, 50);

    const invalido = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contrato.id}/aditivos/simular`, { tipo: 'acrescimo', valor: -10 });
    assert.equal(invalido.statusCode, 400);
    const quantidadeAditivos = (await obterJson<unknown[]>(app, gestor, `/api/v1/contratos/${contrato.id}/aditivos`)).length;
    assert.equal(quantidadeAditivos, (await obterJson<unknown[]>(app, gestor, `/api/v1/contratos/${contrato.id}/aditivos`)).length, 'simulação não grava');
  });

  test('regularidade aponta certidão vencida e sanção impeditiva vigente', async () => {
    const [irregular] = await app.agora.banco.consultar<{ id: string }>(
      "SELECT id FROM fornecedores WHERE cardinality(certidoes_irregulares) > 0 ORDER BY documento LIMIT 1",
    );
    assert.ok(irregular);
    const detalhe = await obterJson<FornecedorDetalhe>(app, gestor, `/api/v1/fornecedores/${irregular.id}`);
    assert.equal(detalhe.regularidade.regular, false);
    assert.ok(detalhe.regularidade.motivos.length > 0);
    assert.ok(detalhe.regularidade.fontes.length > 0);
    assert.ok(detalhe.idcDetalhe.metodologia.length > 0);
    assert.match(detalhe.idcDetalhe.fundamento, /88/);
  });

  test('dosimetria de multa (art. 156, § 3º) é proposta, com memória de cálculo e aviso', async () => {
    const entrada = { valorContrato: 100_000_000, gravidade: 'grave', agravantes: ['Reincidência'], atenuantes: [], programaIntegridade: false, danoAdministracao: true };
    const r = await chamar(app, gestor, 'POST', '/api/v1/sancoes/dosimetria/simular', entrada);
    assert.equal(r.statusCode, 200);
    const resultado = r.json<ResultadoDosimetria>();
    const esperado = calcularDosimetriaMulta({ ...entrada, gravidade: 'grave' });
    assert.equal(resultado.percentualAplicado, esperado.percentualAplicado);
    assert.equal(resultado.valorMulta, esperado.valorMulta);
    assert.ok(resultado.memoriaCalculo.length > 0);
    assert.match(resultado.aviso, /autoridade competente/);

    const maximo = await chamar(app, gestor, 'POST', '/api/v1/sancoes/dosimetria/simular', {
      ...entrada,
      gravidade: 'gravissima',
      agravantes: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    const limitado = maximo.json<ResultadoDosimetria>();
    assert.equal(limitado.limitado, 'maximo');
    assert.equal(limitado.percentualAplicado, 30);
    assert.equal(limitado.valorMulta, 30_000_000);

    const invalida = await chamar(app, gestor, 'POST', '/api/v1/sancoes/dosimetria/simular', { ...entrada, gravidade: 'extrema' });
    assert.equal(invalida.statusCode, 400);
  });

  test('instauração de sanção confere cabimento (art. 156) e calcula o prazo de defesa', async () => {
    const corpo = {
      fornecedorId: contrato.fornecedor.id,
      contratoId: contrato.id,
      incisoInfracao: 'vii',
      tipo: 'multa',
      intimacaoEm: '2026-11-09',
      relato: 'Atraso reiterado na entrega dos itens, apurado em relatório de fiscalização.',
    };
    const r = await chamar(app, gestor, 'POST', '/api/v1/sancoes', corpo);
    assert.equal(r.statusCode, 201);
    const sancao = r.json<Sancao>();
    assert.equal(sancao.incisoInfracao, 'VII');
    assert.equal(sancao.situacao, 'defesa');
    assert.ok(sancao.prazoDefesa && sancao.prazoDefesa > '2026-11-09');

    const naoCabivel = await chamar(app, gestor, 'POST', '/api/v1/sancoes', { ...corpo, incisoInfracao: 'VII', tipo: 'advertencia' });
    assert.equal(naoCabivel.statusCode, 422);
    const erro = naoCabivel.json<RespostaErro>();
    assert.equal(erro.erro.codigo, 'REGRA_NEGOCIO');
    assert.ok((erro.erro.detalhes ?? []).length > 0, 'detalhes listam as sanções cabíveis');

    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'POST', '/api/v1/sancoes', corpo)).statusCode, 403);
  });
});
