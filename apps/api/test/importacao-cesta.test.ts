import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Pagina, PreviaImportacaoCesta, ProcessoDetalhe, ProcessoResumo, RespostaErro } from '@agora/contratos';
import { lerData, lerFonte, lerPlanilhaCesta, lerValorEmCentavos, modeloPlanilhaCesta } from '../src/modulos/jornada/importacao-cesta.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const HOJE = '2026-11-09';

describe('importação da cesta de preços — leitura da planilha', () => {
  test('valores em reais no formato brasileiro e internacional', () => {
    assert.equal(lerValorEmCentavos('R$ 1.234,56'), 123456);
    assert.equal(lerValorEmCentavos('1234,56'), 123456);
    assert.equal(lerValorEmCentavos('1234.56'), 123456);
    assert.equal(lerValorEmCentavos('1,234.56'), 123456);
    assert.equal(lerValorEmCentavos('1.234'), 123400, 'um ponto seguido de 3 dígitos é separador de milhar');
    assert.equal(lerValorEmCentavos('12.5'), 1250);
    assert.equal(lerValorEmCentavos('0,005'), 1, 'arredonda na terceira casa');
    assert.equal(lerValorEmCentavos('1.234.567,8'), 123456780);
    for (const invalido of ['', 'abc', '-10', '1,2,3', '1.23.4', '=SOMA(A1)']) assert.equal(lerValorEmCentavos(invalido), null, invalido);
  });

  test('datas dd/mm/aaaa e ISO; fontes por código, nome ou inciso', () => {
    assert.equal(lerData('05/10/2026'), '2026-10-05');
    assert.equal(lerData('5-1-2026'), '2026-01-05');
    assert.equal(lerData('2026-10-05'), '2026-10-05');
    assert.equal(lerData('31/02/2026'), null);
    assert.equal(lerData('outubro'), null);
    assert.equal(lerFonte('Painel de Preços'), 'painel_precos');
    assert.equal(lerFonte('Contratações similares'), 'contratacao_similar');
    assert.equal(lerFonte('IV'), 'fornecedor_direto');
    assert.equal(lerFonte('inciso V'), 'nota_fiscal');
    assert.equal(lerFonte('internet'), null);
  });

  test('cabeçalho com acentos e ponto e vírgula; erros apontados por linha', () => {
    const csv = [
      'Fonte;Identificação;Valor unitário;Data da cotação;Justificativa',
      'painel_precos;Painel de Preços — item 1;1.000,00;01/10/2026;',
      'fornecedor_direto;Fornecedor A;1.050,00;02/10/2026;',
      'internet;Site qualquer;abc;30/12/2026;',
    ].join('\n');
    const previa = lerPlanilhaCesta(csv, { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 0 });
    assert.equal(previa.cabecalhoReconhecido, true);
    assert.deepEqual(previa.errosGerais, []);
    assert.equal(previa.validas, 1);
    assert.equal(previa.comErro, 2);
    assert.equal(previa.linhas[0]?.linha, 2);
    assert.equal(previa.linhas[0]?.valorUnitario, 100000);
    assert.match(previa.linhas[1]?.erros.join(' ') ?? '', /art\. 23, § 1º, IV/);
    const terceira = previa.linhas[2]?.erros.join(' ') ?? '';
    assert.match(terceira, /não reconhecida/);
    assert.match(terceira, /Valor unitário "abc" inválido/);
    assert.match(terceira, /não pode ser futura/);
  });

  test('sem cabeçalho, colado de planilha (tabulação) e CSV com aspas', () => {
    const colado = 'painel_precos\tPainel item\t1000,00\t01/10/2026\nnota_fiscal\tNF-e 123\t990,00\t03/10/2026';
    const previa = lerPlanilhaCesta(colado, { hoje: HOJE, modo: 'substituir', cotacoesNaCesta: 40 });
    assert.equal(previa.cabecalhoReconhecido, false);
    assert.equal(previa.validas, 2);
    assert.equal(previa.totalAposImportacao, 2);

    const comAspas = 'fonte,identificacao,valor,data\ncontratacao_similar,"Contrato 1/2026, órgão ""X""","1.010,00",2026-09-30';
    const outra = lerPlanilhaCesta(comAspas, { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 0 });
    assert.equal(outra.validas, 1);
    assert.equal(outra.linhas[0]?.descricaoFonte, 'Contrato 1/2026, órgão "X"');
    assert.equal(outra.linhas[0]?.valorUnitario, 101000);
  });

  test('erros gerais: colunas ausentes, planilha vazia e limite de 50 cotações', () => {
    assert.match(lerPlanilhaCesta('fonte;valor\npainel_precos;10,00', { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 0 }).errosGerais.join(' '), /identificação, data/);
    assert.match(lerPlanilhaCesta('\n\n', { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 0 }).errosGerais.join(' '), /não tem linhas/);
    const tres = 'painel_precos;A;10,00;01/10/2026\npainel_precos;B;11,00;01/10/2026\npainel_precos;C;12,00;01/10/2026';
    const excede = lerPlanilhaCesta(tres, { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 48 });
    assert.equal(excede.totalAposImportacao, 51);
    assert.match(excede.errosGerais.join(' '), /limite é 50/);
    assert.deepEqual(lerPlanilhaCesta(tres, { hoje: HOJE, modo: 'substituir', cotacoesNaCesta: 48 }).errosGerais, []);
  });

  test('o modelo de planilha é lido sem erros', () => {
    const previa = lerPlanilhaCesta(modeloPlanilhaCesta(), { hoje: HOJE, modo: 'acrescentar', cotacoesNaCesta: 0 });
    assert.equal(previa.cabecalhoReconhecido, true);
    assert.equal(previa.comErro, 0);
    assert.equal(previa.validas, 3);
  });
});

describe('importação da cesta de preços — API (roteiro PoC-02 do TR)', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let gestor: Credenciais;
  let idScanners = '';

  // 8 amostras: 6 coerentes, 1 com sobrepreço evidente e 1 manifestamente inexequível.
  const CESTA_POC = [
    'fonte;identificacao;valor_unitario;data_cotacao;justificativa',
    'painel_precos;Painel de Preços — referência A;10.000,00;01/10/2026;',
    'painel_precos;Painel de Preços — referência B;10.200,00;03/10/2026;',
    'contratacao_similar;Contrato similar 1;9.800,00;15/09/2026;',
    'contratacao_similar;Contrato similar 2;10.100,00;20/09/2026;',
    'fornecedor_direto;Fornecedor fictício A;9.950,00;10/10/2026;Atua no ramo e enviou proposta formal',
    'nota_fiscal;NF-e fictícia 1;10.050,00;05/10/2026;',
    'fornecedor_direto;Fornecedor fictício B;25.000,00;12/10/2026;Atua no ramo e enviou proposta formal',
    'midia_especializada;Publicação especializada;3.000,00;08/10/2026;',
  ].join('\r\n');

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    const processos = (await obterJson<Pagina<ProcessoResumo>>(app, planejamento, '/api/v1/processos?tamanhoPagina=100')).itens;
    idScanners = processos.find((p) => p.titulo.toLowerCase().includes('scanners'))?.id ?? '';
    assert.ok(idScanners, 'processo da etapa 3 presente no seed');
  });
  after(async () => {
    await app.close();
  });

  test('a prévia não grava e a importação substitui a cesta; os 2 outliers são apontados', async () => {
    const base = `/api/v1/processos/${idScanners}/cesta-precos/importacao`;
    const antes = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${idScanners}`);

    const previa = await chamar(app, planejamento, 'POST', `${base}/previa`, { conteudo: CESTA_POC, modo: 'substituir' });
    assert.equal(previa.statusCode, 200);
    const corpo = previa.json<PreviaImportacaoCesta>();
    assert.equal(corpo.validas, 8);
    assert.equal(corpo.comErro, 0);
    const semMudanca = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${idScanners}`);
    assert.deepEqual(semMudanca.cestaPrecos.cotacoes, antes.cestaPrecos.cotacoes, 'a prévia não altera a cesta');

    const importada = await chamar(app, planejamento, 'POST', base, { conteudo: CESTA_POC, modo: 'substituir' });
    assert.equal(importada.statusCode, 200);
    const processo = importada.json<ProcessoDetalhe>();
    assert.equal(processo.cestaPrecos.cotacoes.length, 8);
    const analise = processo.cestaPrecos.analise as { sugeridasExpurgo: { id: string; motivo: string }[] };
    const motivos = analise.sugeridasExpurgo.map((s) => s.motivo).sort();
    assert.deepEqual(motivos, ['excessivamente_elevado', 'inexequivel']);

    const [evento] = await app.agora.banco.consultar<{ acao: string; dados: { importadas: number; modo: string } }>(
      "SELECT acao, dados FROM auditoria_eventos WHERE acao = 'processo.cesta.importar' ORDER BY sequencia DESC LIMIT 1",
    );
    assert.equal(evento?.dados.importadas, 8);
    assert.equal(evento?.dados.modo, 'substituir');
  });

  test('planilha com erro é recusada com os detalhes por linha; perfil sem edição recebe 403', async () => {
    const base = `/api/v1/processos/${idScanners}/cesta-precos/importacao`;
    const comErro = await chamar(app, planejamento, 'POST', base, { conteudo: 'painel_precos;A;abc;01/10/2026', modo: 'acrescentar' });
    assert.equal(comErro.statusCode, 422);
    const detalhes = comErro.json<RespostaErro>().erro.detalhes ?? [];
    assert.ok(detalhes.some((d) => d.campo === 'linha 1' && /inválido/.test(d.mensagem)));

    assert.equal((await chamar(app, gestor, 'POST', `${base}/previa`, { conteudo: CESTA_POC, modo: 'substituir' })).statusCode, 403);
    assert.equal((await chamar(app, planejamento, 'POST', base, { conteudo: '', modo: 'substituir' })).statusCode, 400);
  });

  test('o modelo de planilha é baixado como CSV', async () => {
    const resposta = await chamar(app, planejamento, 'GET', '/api/v1/cesta-precos/modelo.csv');
    assert.equal(resposta.statusCode, 200);
    assert.match(String(resposta.headers['content-type']), /text\/csv/);
    assert.match(resposta.body, /fonte;identificacao;valor_unitario;data_cotacao;justificativa/);
  });
});
