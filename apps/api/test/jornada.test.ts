import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adicionarDias, dataMinimaAberturaPropostas, hojeISO } from '@agora/dominio';
import type {
  ContratoDetalhe,
  EventoHistorico,
  Pagina,
  ProcessoDetalhe,
  ProcessoResumo,
  RespostaErro,
  RespostaSenhaTemporaria,
  Tarefa,
  UsuarioAdmin,
  UsuarioDesignavel,
  VerificacaoAuditoria,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { geradoComParametrosAnteriores, hashParametrosDocumento } from '../src/modulos/jornada/parametros-edital.ts';
import type { ParametrosEdital } from '../src/modulos/jornada/tipos.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { USUARIOS_DEMONSTRACAO_ADICIONAIS } from '../src/seed/usuarios-demonstracao.ts';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, relogioManual, type Credenciais } from './apoio.ts';
import { concluirSelecao } from './apoio-selecao.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const DIA_MS = 24 * 60 * 60 * 1000;

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

function regras(resposta: { json<T>(): T }): string[] {
  return (erro(resposta).detalhes ?? []).map((d) => d.campo ?? '');
}

describe('jornada da contratação: processos sintéticos, regras de avanço e contratação', () => {
  let app: FastifyInstance;
  let agente: Credenciais;
  let planejamento: Credenciais;
  let juridico: Credenciais;
  let gestor: Credenciais;
  let processos: ProcessoResumo[];

  const processo = (fragmento: string): ProcessoResumo => {
    const p = processos.find((x) => x.titulo.toLowerCase().includes(fragmento));
    if (!p) throw new Error(`Processo não encontrado: ${fragmento}`);
    return p;
  };
  const detalhe = (id: string, credenciais: Credenciais = agente) => obterJson<ProcessoDetalhe>(app, credenciais, `/api/v1/processos/${id}`);
  const fornecedor = async (prefixo: string): Promise<string> => {
    const [linha] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE razao_social LIKE $1', [`${prefixo}%`]);
    if (!linha) throw new Error(`Fornecedor não encontrado: ${prefixo}`);
    return linha.id;
  };

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    agente = await entrar(app, 'agente@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
  });
  after(async () => {
    await app.close();
  });

  test('lista os 8 processos sintéticos cobrindo as 7 etapas, com filtros e permissão jornada:ler', async () => {
    assert.equal(processos.length, 8);
    assert.deepEqual([...new Set(processos.map((p) => p.etapaAtual))].sort(), [1, 2, 3, 4, 5, 6, 7]);
    for (const p of processos) {
      assert.match(p.numeroSei, /^08000\.\d{6}\/\d{4}-\d{2}$/);
      assert.ok(p.valorEstimado !== null && p.valorEstimado > 0);
      assert.ok(p.responsavel);
    }
    assert.ok(processo('equipamentos de proteção').bloqueios >= 1);
    assert.equal(processo('rádios').bloqueios, 0);
    const etapa5 = await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?etapa=5');
    assert.equal(etapa5.total, 2);
    const prf = await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?orgao=PRF');
    assert.ok(prf.itens.every((p) => p.orgao === 'PRF') && prf.total === 2);
    const busca = await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?busca=drones');
    assert.equal(busca.total, 1);

    const consulta = await entrar(app, 'consulta@agora.demo');
    const negado = await chamar(app, consulta, 'GET', '/api/v1/processos');
    assert.equal(negado.statusCode, 403);
    assert.equal(erro(negado).codigo, 'SEM_PERMISSAO');
    const gestorLe = await chamar(app, gestor, 'GET', '/api/v1/processos');
    assert.equal(gestorLe.statusCode, 200, 'gestor de contratos tem jornada:ler');
    const gestorEdita = await chamar(app, gestor, 'POST', '/api/v1/processos', { titulo: 'Tentativa sem jornada:editar', orgao: 'PF' });
    assert.equal(gestorEdita.statusCode, 403);
  });

  test('detalhe: bloqueios e sinais da etapa atual, documentos, árvore SEI com data de assinatura e parâmetros do edital', async () => {
    const drones = await detalhe(processo('drones').id);
    assert.equal(drones.etapaAtual, 4);
    assert.equal(drones.bloqueios, drones.bloqueiosDetalhe.length);
    assert.ok(drones.bloqueiosDetalhe.every((b) => b.etapa === 4 && b.fundamento.length > 0));
    assert.ok(drones.bloqueiosDetalhe.some((b) => b.regra === 'RN-06' && b.fundamento.includes('art. 69, § 2º')));
    assert.equal(drones.parametrosEdital.exigeFaturamentoMinimo, true);
    assert.ok(drones.arvoreSei.length >= 5);
    assert.ok(drones.arvoreSei.every((a) => a.assinado && typeof a.assinadoEm === 'string' && a.assinadoPor));
    assert.equal(drones.cestaPrecos.cotacoes.filter((c) => c.expurgada).length, 1, 'cesta com o preço discrepante já expurgado');
    assert.ok(drones.cestaPrecos.analise);

    const epi = await detalhe(processo('equipamentos de proteção').id);
    assert.ok(epi.bloqueiosDetalhe.some((b) => b.regra === 'RN-01'));
    assert.ok(epi.sinais.some((s) => s.regra === 'RN-14'), 'fracionamento: dispensa perto do limite');
    assert.ok(epi.sinais.some((s) => s.regra === 'RF-15' && s.mensagem.includes('plano de contratações')), 'fora do PCA');

    for (const url of ['/api/v1/processos/123', '/api/v1/processos/00000000-0000-4000-8000-000000000000']) {
      const r = await chamar(app, agente, 'GET', url);
      assert.equal(r.statusCode, 404, url);
    }
  });

  test('GET /processos/designaveis lista servidores ativos do escopo, ordenados e sem dados pessoais', async () => {
    const lista = await obterJson<UsuarioDesignavel[]>(app, agente, '/api/v1/processos/designaveis');
    // O perfil cidadão (gestão compartilhada com a sociedade) não tem acesso interno nem é designável.
    assert.equal(lista.length, 17 + USUARIOS_DEMONSTRACAO_ADICIONAIS.filter((u) => u.perfil !== 'cidadao').length);
    assert.deepEqual(
      lista.map((u) => u.nome),
      [...lista.map((u) => u.nome)].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    );
    for (const u of lista) assert.deepEqual(Object.keys(u).sort(), ['id', 'nome', 'perfis', 'unidadeInterna']);
    assert.doesNotMatch(JSON.stringify(lista), /@agora\.demo|\d{11}/);
    const beatriz = lista.find((u) => u.nome === planejamento.sessao.usuario.nome);
    assert.deepEqual(beatriz?.perfis, ['planejamento']);
    assert.equal(beatriz?.unidadeInterna, 'COPLAN');
  });

  test('etapa 1 → 2: DFD incompleto e indício de artigo de luxo bloqueiam; com justificativa, avança', async () => {
    const id = processo('equipamentos de proteção').id;
    const original = await detalhe(id);
    const bloqueado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.equal(erro(bloqueado).codigo, 'REGRA_NEGOCIO');
    assert.ok(regras(bloqueado).includes('RN-01'));

    const incompleto = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/dfd`, {
      ...original.dfd,
      descricaoNecessidade: 'curta',
      itens: [],
      usaCatalogoPadronizado: false,
      justificativaNaoPadronizacao: null,
    });
    assert.equal(incompleto.statusCode, 200);
    const tentativa = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(tentativa.statusCode, 422);
    const mensagens = (erro(tentativa).detalhes ?? []).map((d) => d.mensagem).join(' | ');
    assert.match(mensagens, /necessidade da contratação/);
    assert.match(mensagens, /ao menos um item/);
    assert.ok(regras(tentativa).includes('RN-02'));

    const justificado = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/dfd`, {
      ...original.dfd,
      justificativaArtigoLuxo: 'Couro bovino comum, de uso profissional, exigido pela norma de proteção das mãos; não se trata de bem de luxo.',
    });
    assert.equal(justificado.statusCode, 200);
    const depois = justificado.json<ProcessoDetalhe>();
    assert.equal(depois.bloqueiosDetalhe.length, 0);
    assert.ok(depois.sinais.some((s) => s.regra === 'RN-01' && s.nivel === 'atencao'), 'indício justificado vira sinal');
    const avancou = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(avancou.statusCode, 200);
    assert.equal(avancou.json<ProcessoDetalhe>().etapaAtual, 2);
    const fora = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/dfd`, original.dfd);
    assert.equal(fora.statusCode, 422, 'o DFD fica travado depois da etapa 1');
  });

  test('etapa 2 → 3: conflito de segregação (RN-03) responde 422 e o DFD precisa estar aprovado e assinado no SEI', async () => {
    const municao = processo('munição').id;
    const bloqueado = await chamar(app, agente, 'POST', `/api/v1/processos/${municao}/avancar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.ok(regras(bloqueado).includes('RN-03'));
    assert.ok(regras(bloqueado).includes('RIA-02'), 'DFD aprovado, mas ainda sem assinatura na árvore SEI');

    const beatriz = planejamento.sessao.usuario.id;
    const conflito = await chamar(app, agente, 'PUT', `/api/v1/processos/${municao}/equipe`, {
      designacoes: [
        { papel: 'equipe_planejamento', usuarioId: beatriz },
        { papel: 'agente_contratacao', usuarioId: beatriz },
      ],
    });
    assert.equal(conflito.statusCode, 422);
    assert.ok(regras(conflito).includes('RN-03'));
    assert.match(erro(conflito).detalhes?.[0]?.mensagem ?? '', /art\. 7º, § 1º/);

    const equipeValida = {
      designacoes: [
        { papel: 'equipe_planejamento', usuarioId: beatriz },
        { papel: 'agente_contratacao', usuarioId: agente.sessao.usuario.id },
        { papel: 'autoridade_competente', usuarioId: gestor.sessao.usuario.id },
      ],
    };
    assert.equal((await chamar(app, agente, 'PUT', `/api/v1/processos/${municao}/equipe`, equipeValida)).statusCode, 200);
    const semAssinatura = await chamar(app, agente, 'POST', `/api/v1/processos/${municao}/avancar`);
    assert.equal(semAssinatura.statusCode, 422);
    assert.deepEqual(regras(semAssinatura), ['RIA-02']);
    const pendente = (await detalhe(municao)).arvoreSei.find((a) => !a.assinado);
    assert.ok(pendente && /DFD/.test(pendente.titulo), 'DFD na árvore SEI aguardando assinatura');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${municao}/sei/assinar`, { documentoNumero: pendente.numero })).statusCode, 200);
    const avancou = await chamar(app, agente, 'POST', `/api/v1/processos/${municao}/avancar`);
    assert.equal(avancou.statusCode, 200);
    assert.equal(avancou.json<ProcessoDetalhe>().etapaAtual, 3);

    // EPIs (agora na etapa 2): sem equipe e sem DFD na árvore SEI.
    const epi = processo('equipamentos de proteção').id;
    const semDfd = await chamar(app, agente, 'POST', `/api/v1/processos/${epi}/avancar`);
    assert.equal(semDfd.statusCode, 422);
    assert.ok(regras(semDfd).includes('RIA-02') && regras(semDfd).includes('RF-15'));
    const gerado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${epi}/documentos/gerar`, { tipo: 'dfd' });
    assert.equal(gerado.statusCode, 200);
    const dfd = gerado.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'dfd');
    assert.ok(dfd);
    assert.equal(dfd.situacao, 'rascunho');
    assert.equal(dfd.geradoPor, 'modelo');
    assert.match(dfd.conteudo, /Rascunho — requer revisão humana/);
    assert.match(dfd.conteudo, /### Fontes/);
    assert.ok(dfd.premissas.length > 0 && dfd.fontes.some((f) => f.includes('art. 20')));
    const aprovado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${epi}/documentos/${dfd.id}/aprovar`);
    assert.equal(aprovado.statusCode, 200);
    const aposAprovar = aprovado.json<ProcessoDetalhe>();
    const numero = aposAprovar.documentos.find((d) => d.id === dfd.id)?.numeroSei;
    assert.match(numero ?? '', /^\d{8}$/);
    assert.match(aposAprovar.documentos.find((d) => d.id === dfd.id)?.conteudo ?? '', /Aprovado após revisão humana/);
    assert.ok(aposAprovar.bloqueiosDetalhe.some((b) => b.regra === 'RIA-02' && b.mensagem.includes('Assine')));
    const assinado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${epi}/sei/assinar`, { documentoNumero: numero });
    assert.equal(assinado.statusCode, 200);
    const entrada = assinado.json<ProcessoDetalhe>().arvoreSei.find((a) => a.numero === numero);
    assert.equal(entrada?.assinado, true);
    assert.equal(entrada?.assinadoPor, planejamento.sessao.usuario.nome);
    assert.ok(entrada?.assinadoEm);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${epi}/sei/assinar`, { documentoNumero: numero })).statusCode, 422);
    assert.equal((await chamar(app, agente, 'PUT', `/api/v1/processos/${epi}/equipe`, equipeValida)).statusCode, 200);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${epi}/avancar`)).statusCode, 200);
  });

  test('etapa 3 → 4: ETP incompleto (RN-04), regras da cesta de preços (RN-05) e expurgo justificado', async () => {
    const id = processo('scanners').id;
    const inicial = await detalhe(id);
    const bloqueado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.equal(regras(bloqueado).filter((r) => r === 'RN-04').length, 3);

    const analise = inicial.cestaPrecos.analise as { sugeridasExpurgo: { id: string }[]; estatisticas: { n: number } };
    assert.equal(analise.sugeridasExpurgo.length, 1, 'o preço discrepante é sugerido para expurgo');
    const discrepante = analise.sugeridasExpurgo[0]?.id ?? '';
    const curta = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/cesta-precos/expurgos`, { aceitar: [discrepante], justificativa: 'curta' });
    assert.equal(curta.statusCode, 400);
    const expurgo = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/cesta-precos/expurgos`, {
      aceitar: [discrepante],
      justificativa: 'Equipamento de tecnologia distinta (ondas milimétricas), não comparável ao objeto.',
    });
    assert.equal(expurgo.statusCode, 200);
    const aposExpurgo = expurgo.json<ProcessoDetalhe>();
    const cotacao = aposExpurgo.cestaPrecos.cotacoes.find((c) => c.id === discrepante);
    assert.equal(cotacao?.expurgada, true);
    assert.match(cotacao?.motivoExpurgo ?? '', /ondas milimétricas/);
    assert.equal((aposExpurgo.cestaPrecos.analise as { estatisticas: { n: number } }).estatisticas.n, 6);

    const validas = aposExpurgo.cestaPrecos.cotacoes.filter((c) => !c.expurgada);
    const semDiretas = validas.filter((c) => c.fonte !== 'fornecedor_direto');
    const diretas = validas.filter((c) => c.fonte === 'fornecedor_direto');
    const cesta = (cotacoes: typeof validas, extra: Record<string, unknown> = {}) => ({ cotacoes, orcamentoSigiloso: false, motivoSigilo: null, ...extra });

    const poucasDiretas = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/cesta-precos`, cesta([...semDiretas, ...diretas.slice(0, 2)]));
    assert.equal(poucasDiretas.statusCode, 200);
    assert.ok(poucasDiretas.json<ProcessoDetalhe>().bloqueiosDetalhe.some((b) => b.regra === 'RN-05' && b.mensagem.includes('três fornecedores')));

    const semJustificativa = diretas.map((c, i) => (i === 0 ? { ...c, justificativaEscolhaFornecedor: '' } : c));
    const r1 = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/cesta-precos`, cesta([...semDiretas, ...semJustificativa]));
    assert.ok(r1.json<ProcessoDetalhe>().bloqueiosDetalhe.some((b) => b.regra === 'RN-05' && b.mensagem.includes('sem justificativa')));

    const r2 = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/cesta-precos`, cesta(semDiretas.slice(0, 2)));
    assert.ok(r2.json<ProcessoDetalhe>().bloqueiosDetalhe.some((b) => b.regra === 'RN-05' && b.mensagem.includes('preços válidos')));

    const r3 = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/cesta-precos`, cesta(validas, { orcamentoSigiloso: true }));
    assert.ok(r3.json<ProcessoDetalhe>().bloqueiosDetalhe.some((b) => b.fundamento.includes('art. 24')));

    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/cesta-precos`, cesta(validas))).statusCode, 200);
    const etp = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/etp`, {
      ...inicial.etp,
      XI: { justificativaAusencia: 'Não há contratações correlatas ou interdependentes para este objeto.' },
      XII: { texto: 'Equipamentos com baixa emissão de radiação, licenciados pela CNEN, e descarte pelo fabricante ao fim da vida útil.' },
      XIII: { texto: 'A contratação é viável técnica e economicamente, recomendando-se o prosseguimento por pregão eletrônico.' },
    });
    assert.equal(etp.statusCode, 200);
    assert.deepEqual(etp.json<ProcessoDetalhe>().bloqueiosDetalhe, []);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/avancar`)).statusCode, 200);

    const tarde = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processo('drones').id}/cesta-precos/expurgos`, {
      aceitar: [discrepante],
      justificativa: 'Tentativa de expurgo depois da etapa de preços.',
    });
    assert.equal(tarde.statusCode, 422);
  });

  test('etapa 4 → 5: documentos aprovados e RN-06 (art. 69 e art. 87) nos parâmetros do edital', async () => {
    const id = processo('drones').id;
    const bloqueado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.equal(regras(bloqueado).filter((r) => r === 'RIA-04').length, 2, 'edital e minuta sem aprovação');
    assert.ok(regras(bloqueado).includes('RN-06'));

    const parametros = { criterioJulgamento: 'menor_preco', regimeExecucao: 'outro', exigeFaturamentoMinimo: false, patrimonioLiquidoMinimoPercentual: 15, exigeRegistroCadastralComplementar: true };
    const invalidos = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/parametros-edital`, parametros);
    assert.equal(invalidos.statusCode, 200);
    const rn06 = invalidos
      .json<ProcessoDetalhe>()
      .bloqueiosDetalhe.filter((b) => b.regra === 'RN-06' && !b.mensagem.includes('parâmetros anteriores'))
      .map((b) => b.fundamento);
    assert.deepEqual(rn06.sort(), ['Lei 14.133/2021, art. 69, § 4º', 'Lei 14.133/2021, art. 87, § 2º']);
    const foraDaEtapa = await chamar(app, agente, 'PUT', `/api/v1/processos/${processo('rádios').id}/parametros-edital`, parametros);
    assert.equal(foraDaEtapa.statusCode, 422);
    assert.equal((await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parametros-edital`, parametros)).statusCode, 403);

    const conformes = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/parametros-edital`, { ...parametros, patrimonioLiquidoMinimoPercentual: 10, exigeRegistroCadastralComplementar: false });
    const aposConformes = conformes.json<ProcessoDetalhe>();
    assert.equal(aposConformes.parametrosEdital.patrimonioLiquidoMinimoPercentual, 10);

    // TR (já aprovado), edital e minuta foram gerados com os parâmetros anteriores: marca, sinal e bloqueio RN-06.
    for (const tipo of ['tr', 'edital', 'minuta_contrato']) {
      assert.equal(aposConformes.documentos.find((d) => d.tipo === tipo)?.geradoComParametrosAnteriores, true, tipo);
    }
    assert.ok(aposConformes.documentos.filter((d) => !['tr', 'edital', 'minuta_contrato'].includes(d.tipo)).every((d) => !d.geradoComParametrosAnteriores));
    const sinal = aposConformes.sinais.find((s) => s.regra === 'RN-06');
    assert.equal(sinal?.nivel, 'atencao');
    assert.match(sinal?.mensagem ?? '', /"Termo de Referência" \(versão 1\), "Minuta do Edital" \(versão 1\), "Minuta do Contrato" \(versão 1\)/);
    const desatualizados = aposConformes.bloqueiosDetalhe.filter((b) => b.mensagem.includes('foi gerado com parâmetros anteriores — gere novamente e aprove'));
    assert.equal(desatualizados.length, 3);
    assert.ok(desatualizados.every((b) => b.regra === 'RN-06' && b.fundamento.includes('art. 69')));

    // Aprovar a versão gerada com os parâmetros anteriores é recusado: é preciso gerar de novo.
    const minutaAntiga = aposConformes.documentos.find((d) => d.tipo === 'minuta_contrato');
    assert.ok(minutaAntiga);
    const recusada = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${minutaAntiga.id}/aprovar`);
    assert.equal(recusada.statusCode, 422);
    assert.deepEqual(regras(recusada), ['RN-06']);
    assert.match(erro(recusada).mensagem, /"Minuta do Contrato" \(versão 1\) foi gerado com parâmetros anteriores/);
    const comTrAntigo = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(comTrAntigo.statusCode, 422);
    assert.ok(
      erro(comTrAntigo).detalhes?.some((d) => d.mensagem.includes('"Termo de Referência" (versão 1) foi gerado com parâmetros anteriores')),
      'TR aprovado com parâmetros anteriores não conta como aprovado',
    );

    const edital = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'edital' });
    const novoEdital = edital.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'edital');
    assert.equal(novoEdital?.versao, 2);
    assert.equal(novoEdital?.geradoComParametrosAnteriores, false);
    assert.match(novoEdital?.conteudo ?? '', /sem necessidade de registro ou de identificação para acesso/);
    assert.match(novoEdital?.conteudo ?? '', /art\. 69, § 2º/);
    assert.match(novoEdital?.conteudo ?? '', /art\. 60/);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'tr' })).statusCode, 200);
    const gerados = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'minuta_contrato' })).json<ProcessoDetalhe>();
    assert.ok(gerados.documentos.every((d) => !d.geradoComParametrosAnteriores));
    assert.equal(gerados.sinais.filter((s) => s.regra === 'RN-06').length, 0, 'o sinal some depois de gerar de novo');
    const minuta = gerados.documentos.find((d) => d.tipo === 'minuta_contrato');
    const tr = gerados.documentos.find((d) => d.tipo === 'tr');
    assert.ok(novoEdital && minuta && tr);
    for (const inciso of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX']) {
      assert.ok(minuta.conteudo.includes(`(art. 92, ${inciso})`), `minuta sem a cláusula do inciso ${inciso}`);
    }
    assert.doesNotMatch(minuta.conteudo, /art\. 93\)/, 'drones não envolvem software');
    for (const alinea of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) assert.ok(tr.conteudo.includes(`## ${alinea})`), `TR sem a alínea ${alinea}`);

    for (const doc of [novoEdital, tr]) assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${doc.id}/aprovar`)).statusCode, 200);
    const ultimo = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${minuta.id}/aprovar`);
    assert.deepEqual(ultimo.json<ProcessoDetalhe>().bloqueiosDetalhe, []);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${minuta.id}/aprovar`)).statusCode, 422, 'aprovação dupla');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`)).statusCode, 200);
  });

  test('hash dos parâmetros do edital: determinístico, só para TR, edital e minuta, e sensível a cada parâmetro', () => {
    const base: ParametrosEdital = {
      criterioJulgamento: 'menor_preco',
      regimeExecucao: 'outro',
      exigeFaturamentoMinimo: false,
      patrimonioLiquidoMinimoPercentual: 10,
      exigeRegistroCadastralComplementar: false,
    };
    const reordenado: ParametrosEdital = {
      exigeRegistroCadastralComplementar: false,
      patrimonioLiquidoMinimoPercentual: 10,
      exigeFaturamentoMinimo: false,
      regimeExecucao: 'outro',
      criterioJulgamento: 'menor_preco',
    };
    const hash = hashParametrosDocumento('edital', base);
    assert.match(hash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(hashParametrosDocumento('edital', reordenado), hash, 'a ordem das chaves não importa');
    assert.equal(hashParametrosDocumento('tr', base), hash);
    assert.equal(hashParametrosDocumento('minuta_contrato', base), hash);
    for (const tipo of ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'parecer_checklist'] as const) assert.equal(hashParametrosDocumento(tipo, base), null, tipo);
    const variacoes: ParametrosEdital[] = [
      { ...base, criterioJulgamento: 'maior_desconto' },
      { ...base, regimeExecucao: 'integrada' },
      { ...base, exigeFaturamentoMinimo: true },
      { ...base, patrimonioLiquidoMinimoPercentual: null },
      { ...base, exigeRegistroCadastralComplementar: true },
    ];
    for (const v of variacoes) assert.notEqual(hashParametrosDocumento('edital', v), hash, JSON.stringify(v));
    assert.equal(geradoComParametrosAnteriores('edital', hash, base), false);
    assert.equal(geradoComParametrosAnteriores('edital', hash, { ...base, exigeFaturamentoMinimo: true }), true);
    assert.equal(geradoComParametrosAnteriores('edital', null, { ...base, exigeFaturamentoMinimo: true }), false, 'documento sem hash registrado');
    assert.equal(geradoComParametrosAnteriores('dfd', hash, { ...base, exigeFaturamentoMinimo: true }), false);
  });

  test('etapa 5: parecer só pela assessoria jurídica; a publicação fixa a data mínima e 5 → 6 fica bloqueado antes dela', async () => {
    const id = processo('software').id;
    const itens = (await detalhe(id)).parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null }));
    for (const credenciais of [agente, planejamento]) {
      const negado = await chamar(app, credenciais, 'PUT', `/api/v1/processos/${id}/parecer`, { itens, conclusao: 'favoravel' });
      assert.equal(negado.statusCode, 403);
    }
    const checklistPorAgente = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'parecer_checklist' });
    assert.equal(checklistPorAgente.statusCode, 403, 'o checklist do parecer é da assessoria jurídica');
    const semParecer = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(semParecer.statusCode, 422);

    const incoerente = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, {
      itens: itens.map((i, n) => (n === 0 ? { ...i, atendido: false } : i)),
      conclusao: 'favoravel',
    });
    assert.equal(incoerente.statusCode, 422);
    const parecer = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, { itens, conclusao: 'favoravel' });
    assert.equal(parecer.statusCode, 200);
    const comParecer = parecer.json<ProcessoDetalhe>();
    assert.equal(comParecer.parecer.conclusao, 'favoravel');
    assert.equal(comParecer.parecer.parecerista?.id, juridico.sessao.usuario.id);
    const checklist = await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'parecer_checklist' });
    const doc = checklist.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'parecer_checklist');
    assert.match(doc?.conteudo ?? '', /Favorável/);
    const minuta = comParecer.documentos.find((d) => d.tipo === 'minuta_contrato');
    assert.match(minuta?.conteudo ?? '', /\(art\. 93\)/, 'software: cláusula de cessão de direitos');

    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/publicar`)).statusCode, 403);

    // Edital na fila de publicação: o parecer que o fundamenta fica imutável (409 CONFLITO).
    const situacaoPncp = (situacao: string) =>
      app.agora.banco.executar(`UPDATE processos SET publicacao = jsonb_set(publicacao, '{pncp}', to_jsonb($2::text)) WHERE id = $1`, [id, situacao]);
    await situacaoPncp('na_fila');
    const naFila = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, { itens, conclusao: 'favoravel_com_ressalvas' });
    assert.equal(naFila.statusCode, 409);
    assert.equal(erro(naFila).codigo, 'CONFLITO');
    await situacaoPncp('nao_publicado');

    const publicado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(publicado.statusCode, 200);
    const pub = publicado.json<ProcessoDetalhe>().publicacao;
    const hoje = hojeISO(new Date(INICIO_TESTES));
    assert.equal(pub.pncp, 'publicado');
    assert.equal(pub.dou, 'na_fila', 'RF-36: o DOU só fica publicado quando o aviso de licitação é conferido');
    assert.equal(pub.publicadoEm, hoje);
    assert.equal(pub.dataMinimaPropostas, dataMinimaAberturaPropostas(hoje, { objeto: 'bens', criterio: 'menor_preco', regime: 'outro' }).data);
    assert.match(pub.idPncp ?? '', /^\d{14}-1-\d{6}\/\d{4}$/);
    const antesDoPrazo = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(antesDoPrazo.statusCode, 422);
    assert.deepEqual(regras(antesDoPrazo), ['RN-15']);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`)).statusCode, 422, 'publicação única');

    const aposPublicar = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, { itens, conclusao: 'desfavoravel' });
    assert.equal(aposPublicar.statusCode, 409);
    assert.equal(erro(aposPublicar).codigo, 'CONFLITO');
    assert.equal(erro(aposPublicar).mensagem, 'O parecer não pode ser alterado após a publicação; registre nova manifestação jurídica no SEI.');
    const mantido = await detalhe(id);
    assert.equal(mantido.parecer.conclusao, 'favoravel', 'o parecer registrado não muda');
    assert.equal(mantido.parecer.parecerista?.id, juridico.sessao.usuario.id);

    const radios = processo('rádios').id;
    const passou = await chamar(app, agente, 'POST', `/api/v1/processos/${radios}/avancar`);
    assert.equal(passou.statusCode, 200, 'edital publicado há mais tempo que o prazo mínimo');
    assert.equal(passou.json<ProcessoDetalhe>().etapaAtual, 6);
  });

  test('etapa 6: licitantes são fornecedores do cadastro; critérios do art. 60 vão e voltam (null = não informado)', async () => {
    const id = processo('coletes').id;
    const original = await detalhe(id);
    const escudo = await fornecedor('Escudo Forte');
    const boreal = await fornecedor('Boreal');
    assert.ok(original.disputa.licitantes.length === 3);
    for (const l of original.disputa.licitantes) {
      assert.equal(l.lanceDisputaFinal, null);
      assert.equal(l.programaIntegridade, null);
    }

    // Ida e volta: o corpo do PUT pode ser exatamente o que o GET devolve (nome e porte são ignorados e lidos do cadastro).
    const mesmo = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, {
      licitantes: original.disputa.licitantes.map((l) => ({ ...l, nome: 'Nome digitado no navegador', meEpp: !l.meEpp })),
    });
    assert.equal(mesmo.statusCode, 200);
    const aposMesmo = mesmo.json<ProcessoDetalhe>();
    assert.deepEqual(aposMesmo.disputa.licitantes, original.disputa.licitantes);
    assert.deepEqual(aposMesmo.disputa.resultado, original.disputa.resultado);

    // Lance na disputa final (art. 60, I) desfaz o empate antes do desempenho prévio.
    const comLance = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, {
      licitantes: original.disputa.licitantes.map((l) => ({
        ...l,
        lanceDisputaFinal: l.id === boreal ? l.valorProposta - 100_000 : null,
        programaIntegridade: l.id === escudo ? true : null,
      })),
    });
    assert.equal(comLance.statusCode, 200);
    const aposLance = comLance.json<ProcessoDetalhe>();
    const resultado = aposLance.disputa.resultado as { classificacao: { id: string; posicao: number }[]; criterioDecisivo: string | null };
    assert.equal(resultado.classificacao.find((c) => c.posicao === 1)?.id, boreal);
    assert.match(resultado.criterioDecisivo ?? '', /disputa final/i);
    const borealSalvo = aposLance.disputa.licitantes.find((l) => l.id === boreal);
    assert.equal(borealSalvo?.meEpp, true, 'porte EPP vem do cadastro');
    assert.equal(borealSalvo?.lanceDisputaFinal, (borealSalvo?.valorProposta ?? 0) - 100_000);
    assert.equal(aposLance.disputa.licitantes.find((l) => l.id === escudo)?.programaIntegridade, true);

    const desconhecido = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, {
      licitantes: [{ id: '00000000-0000-4000-8000-000000000000', valorProposta: 100 }],
    });
    assert.equal(desconhecido.statusCode, 422);
    const repetido = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, {
      licitantes: [
        { id: escudo, valorProposta: 100 },
        { id: escudo, valorProposta: 200 },
      ],
    });
    assert.equal(repetido.statusCode, 422);

    // Restaura a disputa sintética para o teste seguinte.
    const restaurado = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/disputa`, { licitantes: original.disputa.licitantes });
    assert.equal(restaurado.statusCode, 200);
    assert.deepEqual(restaurado.json<ProcessoDetalhe>().disputa.resultado, original.disputa.resultado);
  });

  test('etapa 6 → 7: desempate do art. 60, sorteio pendente e vencedor com sanção impeditiva', async () => {
    const coletes = await detalhe(processo('coletes').id);
    const resultado = coletes.disputa.resultado as {
      empateDetectado: boolean;
      criterioDecisivo: string | null;
      sorteioNecessario: boolean;
      classificacao: { id: string; posicao: number }[];
      passos: { fundamento: string; resultado: string }[];
    };
    assert.equal(resultado.empateDetectado, true);
    assert.equal(resultado.sorteioNecessario, false);
    assert.match(resultado.criterioDecisivo ?? '', /desempenho/i);
    assert.equal(resultado.classificacao[0]?.id, await fornecedor('Escudo Forte'));
    assert.ok(resultado.passos.some((p) => p.fundamento.includes('art. 60, II')));
    assert.ok(resultado.passos.some((p) => /123/.test(p.fundamento)), 'passo informativo do empate ficto (LC 123/2006)');

    const radios = processo('rádios').id;
    const [vigilant, aria, nortecom, metropolitana] = await Promise.all([
      fornecedor('Vigilant'),
      fornecedor('Ária'),
      fornecedor('Nortecom'),
      fornecedor('Metropolitana'),
    ]);
    const empate = await chamar(app, agente, 'PUT', `/api/v1/processos/${radios}/disputa`, {
      licitantes: [
        { id: vigilant, valorProposta: 790_000_000 },
        { id: aria, valorProposta: 790_000_000 },
      ],
    });
    assert.equal(empate.statusCode, 200);
    assert.equal((empate.json<ProcessoDetalhe>().disputa.resultado as { sorteioNecessario: boolean }).sorteioNecessario, true);
    const sorteio = await chamar(app, agente, 'POST', `/api/v1/processos/${radios}/avancar`);
    assert.equal(sorteio.statusCode, 422);
    assert.deepEqual(regras(sorteio), ['RN-08']);

    await chamar(app, agente, 'PUT', `/api/v1/processos/${radios}/disputa`, {
      licitantes: [
        { id: nortecom, valorProposta: 780_000_000 },
        { id: vigilant, valorProposta: 790_000_000 },
      ],
    });
    const sancionado = await chamar(app, agente, 'POST', `/api/v1/processos/${radios}/avancar`);
    assert.equal(sancionado.statusCode, 422);
    assert.deepEqual(regras(sancionado), ['RN-09']);
    assert.match(erro(sancionado).detalhes?.[0]?.mensagem ?? '', /Impedimento de licitar/);

    // Vencedor sem sanção impeditiva, mas com certidão vencida: avança à etapa 7 e é barrado na contratação (RN-09).
    await chamar(app, agente, 'PUT', `/api/v1/processos/${radios}/disputa`, {
      licitantes: [
        { id: metropolitana, valorProposta: 780_000_000 },
        { id: vigilant, valorProposta: 790_000_000 },
      ],
    });
    // Antes do avanço, os atos da seleção até a homologação (RN-22 e RF-18).
    await concluirSelecao(app, radios, agente, gestor);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${radios}/avancar`)).statusCode, 200);
    const irregular = await chamar(app, agente, 'POST', `/api/v1/processos/${radios}/contratar`);
    assert.equal(irregular.statusCode, 422);
    assert.ok(regras(irregular).every((r) => r === 'RN-09'));
    assert.match(JSON.stringify(erro(irregular).detalhes), /CNDT/);

    // Sanção impeditiva aplicada depois do avanço também barra a contratação.
    const coletesId = processo('coletes').id;
    await concluirSelecao(app, coletesId, agente, gestor);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${coletesId}/avancar`)).statusCode, 200);
    const hoje = hojeISO(new Date(INICIO_TESTES));
    await app.agora.banco.executar(
      `INSERT INTO sancoes (fornecedor_id, inciso_infracao, tipo, situacao, aplicada_em, inicio_vigencia, fim_vigencia, instaurada_em, relato)
       VALUES ($1, 'IV', 'impedimento_licitar', 'aplicada', $2, $2, $3, $4, 'Sanção sintética aplicada para o teste da RN-09.')`,
      [await fornecedor('Escudo Forte'), hoje, adicionarDias(hoje, 365), adicionarDias(hoje, -60)],
    );
    const escudo = await chamar(app, agente, 'POST', `/api/v1/processos/${coletesId}/contratar`);
    assert.equal(escudo.statusCode, 422);
    assert.match(JSON.stringify(erro(escudo).detalhes), /Impedimento de licitar e contratar vigente/);
  });

  test('etapa 7: contratar cria o contrato na carteira (tarefas de assinatura, divulgação PNCP pendente) e liga ao processo', async () => {
    const id = processo('viaturas').id;
    const antes = await obterJson<Pagina<unknown>>(app, gestor, '/api/v1/contratos?tamanhoPagina=1');
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contratar`);
    assert.equal(r.statusCode, 200);
    const processoContratado = r.json<ProcessoDetalhe>();
    assert.ok(processoContratado.contratoGerado);
    assert.match(processoContratado.contratoGerado.numero, /^\d+\/2026$/);
    assert.ok(processoContratado.sinais.some((s) => s.regra === 'RN-11'));

    const contrato = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${processoContratado.contratoGerado.id}`);
    assert.equal(contrato.processoSei, processoContratado.numeroSei);
    assert.equal(contrato.fornecedor.id, await fornecedor('Rota Segura'));
    assert.equal(contrato.valorGlobal, 15_180_000_00);
    assert.equal(contrato.origem, 'licitacao');
    assert.equal(contrato.divulgacaoPncp.situacao, 'pendente_no_prazo');
    assert.equal(contrato.uasg.codigo, '920001');
    const depois = await obterJson<Pagina<unknown>>(app, gestor, '/api/v1/contratos?tamanhoPagina=1');
    assert.equal(depois.total, antes.total + 1);
    const tarefas = await obterJson<Tarefa[]>(app, gestor, `/api/v1/contratos/${contrato.id}/tarefas`);
    assert.equal(tarefas.length, 4);
    assert.ok(tarefas.every((t) => t.macrotarefa === 'Assinatura' && t.situacao === 'pendente'));
    const historico = await obterJson<EventoHistorico[]>(app, gestor, `/api/v1/contratos/${contrato.id}/historico`);
    assert.ok(historico.some((h) => h.acao.startsWith('Gerou o contrato')));

    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contratar`)).statusCode, 422, 'contrato único por processo');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/avancar`)).statusCode, 422, 'etapa 7 é a última');
  });

  test('escopo de UASG: usuário restrito a uma UASG só vê e altera os processos dela', async () => {
    const admin = await entrar(app, 'admin@agora.demo');
    const criado = await chamar(app, admin, 'POST', '/api/v1/usuarios', {
      nome: 'Otávio Restrito Lima',
      email: 'restrito@agora.demo',
      cpf: gerarCpf(new Prng(77)),
      perfis: ['planejamento'],
      uasgs: ['910001'],
      unidadeInternaId: null,
    });
    assert.equal(criado.statusCode, 201);
    const usuarioId = criado.json<UsuarioAdmin>().id;
    const temporaria = (await chamar(app, admin, 'POST', `/api/v1/usuarios/${usuarioId}/senha-temporaria`)).json<RespostaSenhaTemporaria>();
    let restrito = await entrar(app, 'restrito@agora.demo', temporaria.senhaTemporaria);
    assert.equal((await chamar(app, restrito, 'POST', '/api/v1/sessao/senha', { senhaAtual: temporaria.senhaTemporaria, novaSenha: 'Escopo-Restrito-2026' })).statusCode, 204);
    restrito = await entrar(app, 'restrito@agora.demo', 'Escopo-Restrito-2026');

    const visiveis = await obterJson<Pagina<ProcessoResumo>>(app, restrito, '/api/v1/processos');
    assert.deepEqual(visiveis.itens.map((p) => p.id), [processo('rádios').id]);
    const foraDoEscopo = processo('viaturas').id;
    assert.equal((await chamar(app, restrito, 'GET', `/api/v1/processos/${foraDoEscopo}`)).statusCode, 404);
    assert.equal((await chamar(app, restrito, 'POST', `/api/v1/processos/${foraDoEscopo}/avancar`)).statusCode, 404);

    const novo = await chamar(app, restrito, 'POST', '/api/v1/processos', { titulo: 'Aquisição de algemas e coldres para a unidade', orgao: 'PRF' });
    assert.equal(novo.statusCode, 201);
    const detalheNovo = novo.json<ProcessoDetalhe>();
    assert.equal(detalheNovo.etapaAtual, 1);
    assert.equal((await obterJson<Pagina<ProcessoResumo>>(app, restrito, '/api/v1/processos')).total, 2);
    assert.equal((await chamar(app, restrito, 'POST', '/api/v1/processos', { titulo: 'Processo em UASG fora do escopo', orgao: 'PF', uasg: '920001' })).statusCode, 422);

    const [semEscopo] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT u.id FROM usuarios u WHERE NOT u.todas_uasgs AND NOT EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = '910001')
         AND EXISTS (SELECT 1 FROM usuarios_uasgs ux WHERE ux.usuario_id = u.id) ORDER BY u.nome LIMIT 1`,
    );
    assert.ok(semEscopo, 'há servidor sem acesso à UASG 910001 na carga sintética');
    const designaveis = await obterJson<UsuarioDesignavel[]>(app, restrito, '/api/v1/processos/designaveis');
    assert.ok(designaveis.some((u) => u.id === usuarioId));
    assert.ok(!designaveis.some((u) => u.id === semEscopo.id), 'servidor fora do escopo não é designável');
    const equipe = await chamar(app, restrito, 'PUT', `/api/v1/processos/${detalheNovo.id}/equipe`, {
      designacoes: [{ papel: 'equipe_planejamento', usuarioId: semEscopo.id }],
    });
    assert.equal(equipe.statusCode, 422, 'só designa servidores do próprio escopo');
  });
});

describe('jornada completa de um processo novo, com relógio controlado, e integridade da trilha', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE, relogio: tempo.relogio });
  });
  after(async () => {
    await app.close();
  });

  test('etapas 1 a 7 até o contrato, com auditoria de cada escrita e cadeia íntegra', async () => {
    let agente = await entrar(app, 'agente@agora.demo');
    let juridico = await entrar(app, 'juridico@agora.demo');
    const planejamento = await entrar(app, 'planejamento@agora.demo');
    let gestor = await entrar(app, 'gestor@agora.demo');
    const fornecedores = await app.agora.banco.consultar<{ id: string; razao_social: string }>(
      "SELECT id, razao_social FROM fornecedores WHERE razao_social LIKE 'Planalto%' OR razao_social LIKE 'Guardião%' OR razao_social LIKE 'Tupã%'",
    );
    const ok = async (credenciais: Credenciais, metodo: 'POST' | 'PUT', url: string, corpo?: unknown): Promise<ProcessoDetalhe> => {
      const r = await chamar(app, credenciais, metodo, url, corpo);
      assert.ok(r.statusCode === 200 || r.statusCode === 201, `${metodo} ${url} → ${r.statusCode} ${r.body}`);
      return r.json<ProcessoDetalhe>();
    };

    let p = await ok(planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de kits de primeiros socorros táticos', orgao: 'SENASP' });
    const base = `/api/v1/processos/${p.id}`;
    assert.equal(p.parametrosEdital.criterioJulgamento, 'menor_preco');
    assert.deepEqual(p.parametrosEdital, {
      criterioJulgamento: 'menor_preco',
      regimeExecucao: 'outro',
      exigeFaturamentoMinimo: false,
      patrimonioLiquidoMinimoPercentual: null,
      exigeRegistroCadastralComplementar: false,
      provaConceito: { exigencia: 'nenhuma', roteiro: null, justificativa: null, prazoDiasUteis: null },
      inversaoFases: { adotada: false, motivacao: null },
      modoDisputa: 'aberto', // padrão do art. 56 para menor preço, levado ao edital
    });
    await ok(planejamento, 'PUT', `${base}/dfd`, {
      descricaoNecessidade: 'Equipar as equipes de pronta resposta com kits de atendimento pré-hospitalar tático padronizados.',
      justificativa: 'Os kits atuais estão vencidos e incompletos, o que compromete o atendimento a feridos em operações.',
      itens: [{ catmat: '650510', descricao: 'Kit de primeiros socorros tático com torniquete e bandagem israelense', unidade: 'kit', quantidade: 400, valorUnitarioEstimado: 61_000 }],
      usaCatalogoPadronizado: true,
      justificativaNaoPadronizacao: null,
      justificativaArtigoLuxo: null,
      previstoNoPca: true,
      tipoObjeto: 'bens',
    });
    p = await ok(planejamento, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 2);

    await ok(agente, 'PUT', `${base}/equipe`, {
      designacoes: [
        { papel: 'equipe_planejamento', usuarioId: planejamento.sessao.usuario.id },
        { papel: 'agente_contratacao', usuarioId: agente.sessao.usuario.id },
        { papel: 'autoridade_competente', usuarioId: gestor.sessao.usuario.id },
        { papel: 'parecerista_juridico', usuarioId: juridico.sessao.usuario.id },
      ],
    });
    const aprovarEAssinar = async (credenciais: Credenciais, tipo: string) => {
      const gerado = await ok(credenciais, 'POST', `${base}/documentos/gerar`, { tipo });
      const doc = gerado.documentos.find((d) => d.tipo === tipo);
      assert.ok(doc);
      const aprovado = await ok(credenciais, 'POST', `${base}/documentos/${doc.id}/aprovar`);
      const numeroNaArvore = aprovado.documentos.find((d) => d.id === doc.id)?.numeroSei;
      return ok(credenciais, 'POST', `${base}/sei/assinar`, { documentoNumero: numeroNaArvore });
    };
    await aprovarEAssinar(planejamento, 'dfd');
    p = await ok(agente, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 3);

    const hoje = hojeISO(tempo.relogio());
    await ok(planejamento, 'PUT', `${base}/etp`, {
      I: { texto: 'Repor os kits de atendimento pré-hospitalar das equipes de pronta resposta.' },
      IV: { texto: 'Um kit por servidor das equipes de pronta resposta (400 servidores).' },
      VI: { texto: 'Valor estimado pela pesquisa de preços registrada na nota técnica.' },
      VIII: { texto: 'Item único: a padronização do kit é condição para o treinamento uniforme.' },
      XIII: { texto: 'A contratação é viável e adequada, recomendando-se o pregão eletrônico.' },
      ...Object.fromEntries(['II', 'III', 'V', 'VII', 'IX', 'X', 'XI', 'XII'].map((i) => [i, { justificativaAusencia: 'Elemento dispensado pela baixa complexidade da aquisição de bem comum.' }])),
    });
    await ok(planejamento, 'PUT', `${base}/riscos`, {
      riscos: [{ descricao: 'Entrega de kits com validade curta', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: 'Exigir validade mínima de 24 meses na entrega' }],
    });
    await ok(planejamento, 'PUT', `${base}/cesta-precos`, {
      orcamentoSigiloso: false,
      motivoSigilo: null,
      cotacoes: [
        { fonte: 'painel_precos', descricaoFonte: 'Painel de Preços', valorUnitario: 60_500, dataCotacao: adicionarDias(hoje, -10) },
        { fonte: 'contratacao_similar', descricaoFonte: 'Contrato similar de órgão estadual', valorUnitario: 62_100, dataCotacao: adicionarDias(hoje, -90) },
        { fonte: 'nota_fiscal', descricaoFonte: 'Nota fiscal de venda a órgão público', valorUnitario: 59_800, dataCotacao: adicionarDias(hoje, -30) },
        { fonte: 'midia_especializada', descricaoFonte: 'Catálogo de fornecedor especializado', valorUnitario: 61_400, dataCotacao: adicionarDias(hoje, -5) },
      ],
    });
    // RN-21: com a política do órgão ligada (padrão), o ETP não se conclui sem os critérios de sustentabilidade.
    assert.deepEqual(regras(await chamar(app, planejamento, 'POST', `${base}/avancar`)), ['RN-21', 'RN-21']);
    await ok(planejamento, 'PUT', `${base}/sustentabilidade`, {
      criteriosAmbientais: 'Kits com embalagem reciclável e componentes sem látex, com validade mínima de 24 meses na entrega.',
      logisticaReversa: 'O fornecedor recolhe os kits e os componentes vencidos para descarte ambientalmente adequado.',
    });
    for (const tipo of ['etp', 'matriz_riscos', 'nota_tecnica_precos']) await aprovarEAssinar(planejamento, tipo);
    p = await ok(planejamento, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 4);

    // RN-39: dotação estruturada e declaração de adequação orçamentária aprovada pela autoridade designada antes do edital.
    await ok(agente, 'PUT', `${base}/dotacao`, {
      linhas: [
        { unidadeGestora: '910001', programaTrabalho: '06.181.9990.AG99.0001', naturezaDespesa: '3.3.90.30', fonteRecursos: '1001000000', exercicio: Number(hoje.slice(0, 4)), valor: 25_000_000, preEmpenho: null },
      ],
    });
    const comDeclaracao = await ok(agente, 'POST', `${base}/documentos/gerar`, { tipo: 'declaracao_orcamentaria' });
    const declaracao = comDeclaracao.documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
    assert.ok(declaracao);
    const declarada = await ok(gestor, 'POST', `${base}/documentos/${declaracao.id}/aprovar`);
    await ok(gestor, 'POST', `${base}/sei/assinar`, { documentoNumero: declarada.documentos.find((d) => d.id === declaracao.id)?.numeroSei });
    for (const tipo of ['tr', 'edital', 'minuta_contrato']) await aprovarEAssinar(agente, tipo);
    p = await ok(agente, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 5);

    await ok(juridico, 'PUT', `${base}/parecer`, { itens: p.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })), conclusao: 'favoravel' });
    await aprovarEAssinar(juridico, 'parecer_checklist');
    p = await ok(agente, 'POST', `${base}/publicar`);
    const dataMinima = p.publicacao.dataMinimaPropostas;
    assert.ok(dataMinima && dataMinima > hoje);
    assert.equal((await chamar(app, agente, 'POST', `${base}/avancar`)).statusCode, 422);

    // O prazo mínimo transcorre: o relógio da aplicação avança 20 dias (as sessões expiram e são renovadas).
    tempo.avancar(20 * DIA_MS);
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    p = await ok(agente, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 6);

    const [primeiro, segundo] = fornecedores;
    assert.ok(primeiro && segundo);
    await ok(agente, 'PUT', `${base}/disputa`, {
      licitantes: [
        { id: primeiro.id, valorProposta: 23_600_000, notaDesempenhoPrevio: 80 },
        { id: segundo.id, valorProposta: 24_100_000, notaDesempenhoPrevio: 90 },
      ],
    });
    // Atos da seleção: habilitação, preclusão sem intenção de recurso, adjudicação e homologação (RN-22, RF-18).
    assert.deepEqual(regras(await chamar(app, agente, 'POST', `${base}/avancar`)), ['RN-22']);
    await concluirSelecao(app, p.id, agente, gestor);
    p = await ok(agente, 'POST', `${base}/avancar`);
    assert.equal(p.etapaAtual, 7);
    p = await ok(agente, 'POST', `${base}/contratar`);
    assert.ok(p.contratoGerado);
    const contratoDaJornada = await obterJson<ContratoDetalhe>(app, agente, `/api/v1/contratos/${p.contratoGerado.id}`);
    assert.equal(contratoDaJornada.valorGlobal, 23_600_000);
    assert.equal(contratoDaJornada.fornecedor.id, primeiro.id);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<{ acao: string; recursoId: string | null }>>(app, auditor, `/api/v1/auditoria?recurso=processo&tamanhoPagina=100`);
    const doProcesso = trilha.itens.filter((e) => e.recursoId === p.id).map((e) => e.acao);
    for (const acao of [
      'processo.criar',
      'processo.dfd.atualizar',
      'processo.equipe.designar',
      'processo.documento.gerar',
      'processo.documento.aprovar',
      'processo.sei.assinar',
      'processo.avancar',
      'processo.parecer.registrar',
      'processo.publicar',
      'processo.disputa.registrar',
      'processo.sustentabilidade.atualizar',
      'processo.selecao.habilitacao.registrar',
      'processo.selecao.recurso.encerrar_intencao',
      'processo.selecao.adjudicar',
      'processo.selecao.homologar',
      'processo.selecao.divulgar_preparatorios',
      'processo.contratar',
      'processo.dotacao.atualizar',
    ]) {
      assert.ok(doProcesso.includes(acao), `trilha sem ${acao}`);
    }
    const verificacao = await obterJson<VerificacaoAuditoria>(app, auditor, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);
    assert.equal(verificacao.primeiraFalha, null);
  });
});
