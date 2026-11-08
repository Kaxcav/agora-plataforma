/**
 * Frente O — planejamento: PCA (F10, RF-31), catálogo CATMAT/CATSER (F19, RIA-13) e intenção de registro de preços
 * (F5, RN-38). Dados sintéticos da carga; o "hoje" dos testes é 2026-11-09 (segunda-feira). Os testes online usam um
 * `fetch` falso: nenhuma chamada sai para serviço real.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  ConsultaCatalogo,
  IntencaoRegistroPrecos,
  PlanejamentoDfd,
  PlanoContratacoesDetalhe,
  ProcessoDetalhe,
  ResumoPlanoContratacoes,
  RespostaErro,
  SugestoesCatalogo,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const CNPJ_ORGAO = '00394494000136';

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

const DFD_VALIDO = {
  descricaoNecessidade: 'Renovar as estações de trabalho das equipes de análise, hoje com equipamentos sem garantia e lentos.',
  justificativa: 'Os equipamentos atuais travam durante as análises e atrasam a entrega dos relatórios às unidades demandantes.',
  itens: [{ catmat: null, descricao: 'Notebooks com processador de oito núcleos e 16 GB de memória', unidade: 'unidade', quantidade: 40, valorUnitarioEstimado: 720_000 }],
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
};

async function auditoria(app: FastifyInstance, acao: string): Promise<{ acao: string; dados: Record<string, unknown>; resumo: string }[]> {
  return app.agora.banco.consultar('SELECT acao, dados, resumo FROM auditoria_eventos WHERE acao = $1 ORDER BY sequencia', [acao]);
}

describe('planejamento (modo offline): PCA, conferência do DFD, catálogo e IRP', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let gestor: Credenciais;
  let admin: Credenciais;

  const plano = async (uasg: string, ano: number): Promise<ResumoPlanoContratacoes> => {
    const lista = await obterJson<ResumoPlanoContratacoes[]>(app, planejamento, `/api/v1/pca?uasg=${uasg}&ano=${ano}`);
    const p = lista[0];
    if (!p) throw new Error(`Plano não encontrado: ${uasg}/${ano}`);
    return p;
  };

  const novoProcesso = async (uasg: string, titulo: string): Promise<string> => {
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo, orgao: 'MJSP', uasg });
    assert.equal(criado.statusCode, 201, criado.body);
    const id = criado.json<ProcessoDetalhe>().id;
    const dfd = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/dfd`, DFD_VALIDO);
    assert.equal(dfd.statusCode, 200, dfd.body);
    return id;
  };

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('PCA: leitura por escopo e permissão; a carga traz planos publicados, em elaboração e consolidado', async () => {
    const todos = await obterJson<ResumoPlanoContratacoes[]>(app, planejamento, '/api/v1/pca');
    assert.ok(todos.some((p) => p.ano === 2026 && p.uasg === '950002' && p.situacao === 'publicado' && p.publicacao?.idPncp?.includes('-0-')));
    assert.ok(todos.some((p) => p.ano === 2027 && p.uasg === '950001' && p.situacao === 'em_elaboracao' && p.demandas === 7));
    assert.ok(todos.some((p) => p.ano === 2027 && p.uasg === '920001' && p.situacao === 'consolidado'));
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/pca')).statusCode, 403);
    const auditor = await entrar(app, 'auditor@agora.demo');
    assert.equal((await chamar(app, auditor, 'GET', '/api/v1/pca')).statusCode, 200);
    assert.equal((await chamar(app, auditor, 'POST', `/api/v1/pca/${todos[0]?.id ?? ''}/consolidar`)).statusCode, 403);
  });

  test('PCA: demanda validada no servidor (Decreto 10.947/2022, art. 8º), registrada e removida com trilha', async () => {
    const senasp = await plano('930001', 2027);
    const base = `/api/v1/pca/${senasp.id}/demandas`;
    const demanda = {
      unidadeRequisitante: 'Diretoria de Operações',
      descricao: 'Lanterna tática recarregável de LED',
      codigoCatalogo: '240110',
      tipoCatalogo: 'material',
      unidadeFornecimento: 'unidade',
      quantidade: 80,
      valorUnitario: 24_000,
      dataDesejada: '2027-04-10',
      prioridade: 'media',
      categoria: 'material',
    };
    const foraDoAno = await chamar(app, planejamento, 'POST', base, { ...demanda, dataDesejada: '2026-12-10' });
    assert.equal(foraDoAno.statusCode, 422);
    assert.match(JSON.stringify(erro(foraDoAno).detalhes), /exercício de 2027/);
    const criada = await chamar(app, planejamento, 'POST', base, demanda);
    assert.equal(criada.statusCode, 201, criada.body);
    const detalhe = criada.json<PlanoContratacoesDetalhe>();
    assert.equal(detalhe.demandasRegistradas.length, senasp.demandas + 1);
    const nova = detalhe.demandasRegistradas.find((d) => d.codigoCatalogo === '240110');
    assert.ok(nova);
    assert.equal(nova.valorTotal, 80 * 24_000);
    const removida = await chamar(app, planejamento, 'DELETE', `${base}/${nova.id}`);
    assert.equal(removida.statusCode, 200);
    assert.equal(removida.json<PlanoContratacoesDetalhe>().demandasRegistradas.length, senasp.demandas);
    assert.equal((await auditoria(app, 'pca.registrar_demanda')).length, 1);
    assert.equal((await auditoria(app, 'pca.remover_demanda')).length, 1);
  });

  test('PCA: consolidar agrega as demandas de mesma natureza; aprovação por outra autoridade publica no PNCP pela fila', async () => {
    const cgl = await plano('950001', 2027);
    const consolidado = await chamar(app, planejamento, 'POST', `/api/v1/pca/${cgl.id}/consolidar`);
    assert.equal(consolidado.statusCode, 200, consolidado.body);
    const c = consolidado.json<PlanoContratacoesDetalhe>();
    assert.equal(c.situacao, 'consolidado');
    assert.equal(c.itensConsolidados.length, 5, 'papel e mesas agregados');
    const papel = c.itensConsolidados.find((i) => i.codigoCatalogo === '360210');
    assert.equal(papel?.quantidade, 1_200);
    assert.equal(papel?.prioridade, 'alta');
    assert.deepEqual(papel?.unidadesRequisitantes, ['Coordenação de Logística', 'Divisão de Protocolo']);
    assert.equal(c.itensConsolidados[0]?.identificador, '950001/2027-0001');
    assert.ok(c.demandasRegistradas.every((d) => d.itemNumero !== null));
    assert.equal(c.consolidadoPor?.nome, planejamento.sessao.usuario.nome);

    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/pca/${cgl.id}/aprovar`)).statusCode, 403, 'planejamento não aprova');
    const aprovado = await chamar(app, gestor, 'POST', `/api/v1/pca/${cgl.id}/aprovar`);
    assert.equal(aprovado.statusCode, 200, aprovado.body);
    const p = aprovado.json<PlanoContratacoesDetalhe>();
    assert.equal(p.situacao, 'publicado', 'trabalhador embutido publica na sequência');
    assert.equal(p.publicacao?.situacao, 'publicado');
    assert.match(p.publicacao?.idPncp ?? '', /^\d{14}-0-\d{6}\/2027$/);
    assert.match(p.publicacao?.protocolo ?? '', /^SIMULADO-/);
    assert.match(p.publicacao?.hashEnvio ?? '', /^[0-9a-f]{64}$/);
    assert.equal(p.aprovadoPor?.nome, gestor.sessao.usuario.nome);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/pca/${cgl.id}/aprovar`)).statusCode, 422);
    const [evento] = await auditoria(app, 'pncp.publicar_pca');
    assert.ok(evento);
    assert.equal(evento.dados['modo'], 'offline');
    assert.equal((await auditoria(app, 'pca.aprovar')).length, 1);
    assert.equal((await auditoria(app, 'pca.consolidar')).length, 1);
  });

  test('PCA: quem consolidou não aprova (segregação); a autoridade pode devolver para ajustes', async () => {
    const senasp = await plano('930001', 2027);
    assert.equal((await chamar(app, admin, 'POST', `/api/v1/pca/${senasp.id}/consolidar`)).statusCode, 200);
    const mesmo = await chamar(app, admin, 'POST', `/api/v1/pca/${senasp.id}/aprovar`);
    assert.equal(mesmo.statusCode, 422);
    assert.match(erro(mesmo).mensagem, /segregação/);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/pca/${senasp.id}/devolver`, { motivo: 'curto' })).statusCode, 400);
    const devolvido = await chamar(app, gestor, 'POST', `/api/v1/pca/${senasp.id}/devolver`, { motivo: 'Revisar as quantidades de câmeras corporais com a área técnica.' });
    assert.equal(devolvido.statusCode, 200);
    const d = devolvido.json<PlanoContratacoesDetalhe>();
    assert.equal(d.situacao, 'em_elaboracao');
    assert.equal(d.itensConsolidados.length, 0);
    assert.match(d.devolucao?.motivo ?? '', /câmeras corporais/);
  });

  test('DFD em UASG com PCA publicado: sem item do plano bloqueia (RF-31); a justificativa ou o item liberam', async () => {
    const id = await novoProcesso('950002', 'Aquisição de notebooks para as equipes de análise');
    const painel = await obterJson<PlanejamentoDfd>(app, planejamento, `/api/v1/processos/${id}/pca`);
    assert.equal(painel.exigePca, true);
    assert.equal(painel.conferencia.situacao, 'pendente');
    assert.ok(painel.itensDisponiveis.length >= 3);
    assert.ok(painel.itensDisponiveis.every((i) => i.uasg === '950002'));

    const bloqueado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/avancar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.ok((erro(bloqueado).detalhes ?? []).some((d) => d.campo === 'RF-31'), bloqueado.body);

    const semJustificativa = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/pca`, { tipo: 'fora_do_pca', justificativa: 'Urgente.' });
    assert.equal(semJustificativa.statusCode, 400);
    const fora = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/pca`, {
      tipo: 'fora_do_pca',
      justificativa: 'A demanda surgiu depois da aprovação do plano, com a criação de duas novas equipes de análise.',
    });
    assert.equal(fora.statusCode, 200, fora.body);
    const depois = fora.json<ProcessoDetalhe>();
    assert.equal(depois.dfd.previstoNoPca, false, 'a marcação acompanha o vínculo');
    assert.ok(!depois.bloqueiosDetalhe.some((b) => b.regra === 'RF-31'));
    assert.ok(depois.sinais.some((s) => s.regra === 'RF-31' && s.mensagem.includes('revisado')));

    const outraUasg = (await obterJson<PlanejamentoDfd>(app, planejamento, `/api/v1/processos/${id}/pca`)).itensDisponiveis[0];
    assert.ok(outraUasg);
    const [itemAlheio] = await app.agora.banco.consultar<{ id: string }>(
      "SELECT i.id FROM pca_itens i JOIN pca_planos p ON p.id = i.plano_id WHERE p.uasg = '930002' AND p.situacao = 'publicado' LIMIT 1",
    );
    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/pca`, { tipo: 'item', itemId: itemAlheio?.id })).statusCode, 422);
    const vinculado = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/pca`, { tipo: 'item', itemId: outraUasg.id });
    assert.equal(vinculado.statusCode, 200);
    assert.equal(vinculado.json<ProcessoDetalhe>().dfd.previstoNoPca, true);
    const painelVinculado = await obterJson<PlanejamentoDfd>(app, planejamento, `/api/v1/processos/${id}/pca`);
    assert.equal(painelVinculado.vinculo?.tipo, 'item');
    assert.equal(painelVinculado.conferencia.situacao, 'vinculado');
    const eventos = await auditoria(app, 'processo.dfd.pca');
    assert.equal(eventos.length, 2);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/avancar`)).statusCode, 200);
    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/pca`, { tipo: 'item', itemId: outraUasg.id })).statusCode, 422, 'só na etapa 1');
  });

  test('DFD em UASG sem PCA publicado: não bloqueia, só informa; consulta offline registra a proveniência', async () => {
    const id = await novoProcesso('950001', 'Aquisição de notebooks para a coordenação de logística');
    const detalhe = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${id}`);
    assert.ok(!detalhe.bloqueiosDetalhe.some((b) => b.regra === 'RF-31'));
    assert.ok(detalhe.sinais.some((s) => s.regra === 'RF-31' && s.nivel === 'informativo'));
    assert.ok(detalhe.sinais.some((s) => s.regra === 'RN-02' && s.mensagem.includes('item 1')), 'item sem código do catálogo');
    const consultado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/pca/consultar`);
    assert.equal(consultado.statusCode, 200, consultado.body);
    const painel = consultado.json<PlanejamentoDfd>();
    assert.equal(painel.consultaPncp?.modo, 'offline');
    assert.match(painel.consultaPncp?.hash ?? '', /^[0-9a-f]{64}$/);
    assert.equal((await auditoria(app, 'pca.consultar_pncp')).length, 2, 'exercício corrente e seguinte');
  });

  test('catálogo: busca offline com proveniência, sugestão determinística (RIA-13) e escolha do agente registrada', async () => {
    const busca = await obterJson<ConsultaCatalogo>(app, planejamento, '/api/v1/catalogo/itens?busca=luva&tipo=material');
    assert.ok(busca.itens.some((i) => i.codigo === '357301'));
    assert.equal(busca.proveniencia.modo, 'offline');
    assert.equal(busca.proveniencia.registros, busca.itens.length);
    assert.equal((await obterJson<ConsultaCatalogo>(app, planejamento, '/api/v1/catalogo/itens?busca=446901&tipo=material')).itens[0]?.codigo, '446901');

    const descricao = encodeURIComponent('Notebooks com processador de oito núcleos e 16 GB de memória');
    const s1 = await obterJson<SugestoesCatalogo>(app, planejamento, `/api/v1/catalogo/sugestoes?descricao=${descricao}&tipo=material`);
    const s2 = await obterJson<SugestoesCatalogo>(app, planejamento, `/api/v1/catalogo/sugestoes?descricao=${descricao}&tipo=material`);
    assert.equal(s1.regra, 'RIA-13');
    assert.equal(s1.sugestoes[0]?.codigo, '230410');
    assert.deepEqual(s1.sugestoes, s2.sugestoes, 'determinística');
    assert.match(s1.aviso, /Requer revisão humana/);
    assert.ok(s1.fontes.length > 0 && s1.premissas.length > 0);

    const id = await novoProcesso('950001', 'Aquisição de notebooks para a divisão de protocolo');
    const pontuacao = s1.sugestoes[0]?.pontuacao ?? 0;
    const url = `/api/v1/processos/${id}/dfd/itens/1/catalogo`;
    assert.equal((await chamar(app, planejamento, 'PUT', url, { codigo: '999999', tipo: 'material', origem: 'busca', pontuacao: null })).statusCode, 422);
    assert.equal((await chamar(app, planejamento, 'PUT', url, { codigo: '390130', tipo: 'material', origem: 'busca', pontuacao: null })).statusCode, 422, 'inativo');
    assert.equal((await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/dfd/itens/9/catalogo`, { codigo: '230410', tipo: 'material', origem: 'sugestao', pontuacao })).statusCode, 404);
    const escolhido = await chamar(app, planejamento, 'PUT', url, { codigo: '230410', tipo: 'material', origem: 'sugestao', pontuacao });
    assert.equal(escolhido.statusCode, 200, escolhido.body);
    const p = escolhido.json<ProcessoDetalhe>();
    assert.equal(p.dfd.itens[0]?.catmat, '230410');
    assert.ok(!p.sinais.some((s) => s.regra === 'RN-02'));
    const [evento] = await auditoria(app, 'processo.dfd.catalogo');
    assert.equal(evento?.dados['decisao'], 'humana');
    assert.equal(evento?.dados['origem'], 'sugestao');
    assert.ok((await auditoria(app, 'catalogo.consultar')).length >= 3);
  });

  test('RIA-01: luvas previstas em outras UASGs sugerem registro de preços compartilhado na demanda de EPIs', async () => {
    const [epi] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM processos WHERE titulo LIKE '%proteção individual%'");
    assert.ok(epi);
    const detalhe = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${epi.id}`);
    const sinal = detalhe.sinais.find((s) => s.regra === 'RIA-01' && s.mensagem.includes('357301'));
    assert.ok(sinal, JSON.stringify(detalhe.sinais));
    assert.match(sinal.mensagem, /930002/);
    assert.match(sinal.mensagem, /940002/);
    const painel = await obterJson<PlanejamentoDfd>(app, planejamento, `/api/v1/processos/${epi.id}/pca`);
    assert.equal(painel.exigePca, false);
    assert.ok(painel.registroPrecosCompartilhado.some((r) => r.codigoCatalogo === '357301' && r.outrasUnidades.length === 2));
  });

  test('IRP (RN-38): menos de 8 dias úteis é recusado; adesão só aberta e de outra UASG; consolidação depois do encerramento', async () => {
    const irp = {
      uasgGerenciadora: '930001',
      processoId: null,
      objeto: 'Registro de preços de óculos de proteção balística para as equipes',
      codigoCatalogo: '357320',
      unidadeFornecimento: 'unidade',
      quantidadeGerenciador: 300,
      abertura: '2026-11-09',
      encerramento: '2026-11-12',
    };
    const curta = await chamar(app, planejamento, 'POST', '/api/v1/irps', irp);
    assert.equal(curta.statusCode, 422);
    assert.ok((erro(curta).detalhes ?? []).some((d) => d.campo === 'RN-38' && d.mensagem.includes('19/11/2026')), curta.body);
    const passado = await chamar(app, planejamento, 'POST', '/api/v1/irps', { ...irp, abertura: '2026-11-02', encerramento: '2026-11-30' });
    assert.equal(passado.statusCode, 422);
    const criada = await chamar(app, planejamento, 'POST', '/api/v1/irps', { ...irp, encerramento: '2026-11-19' });
    assert.equal(criada.statusCode, 201, criada.body);
    const nova = criada.json<IntencaoRegistroPrecos>();
    assert.equal(nova.diasUteis, 8);
    assert.equal(nova.situacao, 'aberta');
    assert.match(nova.numero, /^\d{3}\/2026$/);

    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/irps/${nova.id}/adesoes`, { uasg: '940002', quantidade: 10, manifestacao: 'Sem permissão para aderir.' })).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/irps/${nova.id}/adesoes`, { uasg: '930001', quantidade: 10, manifestacao: 'A gerenciadora tentando aderir.' })).statusCode, 422);
    const adesao = await chamar(app, gestor, 'POST', `/api/v1/irps/${nova.id}/adesoes`, { uasg: '940002', quantidade: 90, manifestacao: 'A penitenciária usará os óculos nas revistas.' });
    assert.equal(adesao.statusCode, 201, adesao.body);
    assert.equal(adesao.json<IntencaoRegistroPrecos>().quantidadeTotal, 390);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/irps/${nova.id}/consolidar`)).statusCode, 422, 'ainda aberta');

    const lista = await obterJson<IntencaoRegistroPrecos[]>(app, planejamento, '/api/v1/irps');
    const encerrada = lista.find((i) => i.situacao === 'encerrada' && i.codigoCatalogo === '357301');
    assert.ok(encerrada, 'IRP da carga encerrada');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/irps/${encerrada.id}/adesoes`, { uasg: '910002', quantidade: 5, manifestacao: 'Fora do período de adesão.' })).statusCode, 422);
    const consolidada = await chamar(app, planejamento, 'POST', `/api/v1/irps/${encerrada.id}/consolidar`);
    assert.equal(consolidada.statusCode, 200, consolidada.body);
    const c = consolidada.json<IntencaoRegistroPrecos>();
    assert.equal(c.situacao, 'consolidada');
    assert.equal(c.consolidacao?.quantidadeTotal, 530);
    assert.deepEqual(c.consolidacao?.participantes.map((p) => p.papel), ['gerenciador', 'participante', 'participante']);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/irps/${encerrada.id}/consolidar`)).statusCode, 422);
    for (const acao of ['irp.abrir', 'irp.aderir', 'irp.consolidar']) assert.equal((await auditoria(app, acao)).length, 1, acao);
  });
});

/** Dados abertos de compras, consulta do PCA e publicação no PNCP simulados. */
function servicosFalsos() {
  const estado = { catalogo: 0, consultaPca: 0, chamadas: [] as { url: URL; corpo: unknown }[] };
  const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
  const fetch: FuncaoFetch = async (entrada, init) => {
    const url = new URL(String(entrada));
    estado.chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.pathname === '/modulo-material/4_consultarItemMaterial') {
      estado.catalogo++;
      return json({
        resultado: [
          { codigoItem: 612001, descricaoItem: 'Detector de metais portátil para revista', codigoClasse: 6665, nomeClasse: 'Equipamentos de detecção', codigoPdm: 9001, nomePdm: 'Detector de metais', statusItem: true, itemSustentavel: false },
          { codigoItem: 'inválido', descricaoItem: 'ignorado' },
        ],
        totalRegistros: 1,
        totalPaginas: 1,
      });
    }
    if (url.pathname === '/api/consulta/v1/pca/atualizacao') {
      estado.consultaPca++;
      if (url.searchParams.get('codigoUnidade') !== '920002') return json({ data: [], totalPaginas: 0 });
      return json({
        data: [
          {
            idPcaPncp: `${CNPJ_ORGAO}-0-000031/2026`,
            anoPca: 2026,
            codigoUnidade: '920002',
            dataPublicacaoPNCP: '2026-02-10T10:00:00',
            itens: [
              { numeroItem: 1, descricaoItem: 'Munição de treinamento calibre 9 mm', codigoItem: '343101', classificacaoCatalogoId: 1, categoriaItemPcaNome: 'Material', quantidadeEstimada: 20000, valorUnitario: 3.1, valorTotal: 62000, dataDesejada: '2026-05-01', unidadeFornecimento: 'unidade' },
              { numeroItem: 2, descricaoItem: 'Manutenção de viaturas', codigoItem: '24619', classificacaoCatalogoId: 2, categoriaItemPcaNome: 'Serviço', quantidadeEstimada: 12, valorUnitario: 50000, valorTotal: 600000, dataDesejada: '2026-03-01', unidadeFornecimento: 'mês' },
            ],
          },
          { idPcaPncp: `${CNPJ_ORGAO}-0-000032/2025`, anoPca: 2025, codigoUnidade: '920002', itens: [] },
        ],
        totalPaginas: 1,
      });
    }
    if (url.pathname === '/api/pncp/v1/usuarios/login') return new Response(null, { status: 200, headers: { authorization: 'Bearer token-pca' } });
    const pca = /^\/api\/pncp\/v1\/orgaos\/(\d{14})\/pca$/.exec(url.pathname);
    if (pca) return new Response(null, { status: 201, headers: { location: `https://treina.pncp.gov.br/api/pncp/v1/orgaos/${pca[1]}/pca/2027/7` } });
    return new Response('não encontrado', { status: 404 });
  };
  return { fetch, estado };
}

describe('planejamento (modo online com serviços simulados): catálogo, PCA do PNCP e publicação', () => {
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let gestor: Credenciais;
  const falso = servicosFalsos();

  before(async () => {
    app = await criarAppTeste({
      env: {
        ...SEM_LIMITE,
        AGORA_INTEGRACOES: 'online',
        AGORA_ORGAO_CNPJ: CNPJ_ORGAO,
        AGORA_PNCP_USUARIO: 'sistema-agora',
        AGORA_PNCP_SENHA: 'senha-de-teste-sintetica',
        AGORA_COMPRAS_DADOS_URL: 'https://dadosabertos.exemplo.gov.br',
        AGORA_PNCP_CONSULTA_URL: 'https://pncp.exemplo.gov.br/api/consulta',
      },
      fetch: falso.fetch,
    });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('catálogo online: consulta o catálogo oficial, guarda no cache e reaproveita a consulta dentro da validade', async () => {
    const r1 = await obterJson<ConsultaCatalogo>(app, planejamento, '/api/v1/catalogo/itens?busca=detector&tipo=material');
    assert.equal(r1.proveniencia.modo, 'online');
    assert.match(r1.proveniencia.endereco ?? '', /^https:\/\/dadosabertos\.exemplo\.gov\.br\/modulo-material\/4_consultarItemMaterial\?.*descricaoItem=detector/);
    assert.deepEqual(r1.itens.map((i) => [i.codigo, i.origem, i.classeNome]), [['612001', 'api', 'Equipamentos de detecção']]);
    const r2 = await obterJson<ConsultaCatalogo>(app, planejamento, '/api/v1/catalogo/itens?busca=detector&tipo=material');
    assert.equal(r2.proveniencia.deCache, true);
    assert.equal(falso.estado.catalogo, 1, 'segunda consulta veio do cache');
    const servico = await obterJson<ConsultaCatalogo>(app, planejamento, '/api/v1/catalogo/itens?busca=manutencao&tipo=servico');
    assert.match(servico.aviso ?? '', /não aceita busca por texto/);
    assert.equal(falso.estado.catalogo, 1);
  });

  test('PCA do PNCP: a consulta importa o plano publicado da UASG e passa a exigir o vínculo no DFD', async () => {
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Aquisição de munição de treinamento', orgao: 'PRF', uasg: '920002' });
    const id = criado.json<ProcessoDetalhe>().id;
    const antes = await obterJson<PlanejamentoDfd>(app, planejamento, `/api/v1/processos/${id}/pca`);
    assert.equal(antes.exigePca, false);
    const consultado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/pca/consultar`);
    assert.equal(consultado.statusCode, 200, consultado.body);
    const painel = consultado.json<PlanejamentoDfd>();
    assert.equal(painel.exigePca, true);
    assert.equal(painel.consultaPncp?.modo, 'online');
    assert.match(painel.consultaPncp?.endereco ?? '', /\/v1\/pca\/atualizacao\?dataInicio=\d{8}&dataFim=20261109&cnpj=\d{14}&codigoUnidade=920002/);
    assert.deepEqual(painel.itensDisponiveis.map((i) => [i.identificador, i.codigoCatalogo, i.valorTotal, i.idPcaPncp]), [
      ['920002/2026-0001', '343101', 6_200_000, `${CNPJ_ORGAO}-0-000031/2026`],
      ['920002/2026-0002', '24619', 60_000_000, `${CNPJ_ORGAO}-0-000031/2026`],
    ]);
    const [importado] = await app.agora.banco.consultar<{ origem: string }>("SELECT origem FROM pca_planos WHERE uasg = '920002' AND ano = 2026");
    assert.equal(importado?.origem, 'pncp');
    // Nova consulta atualiza os itens sem duplicar.
    await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/pca/consultar`);
    const [contagem] = await app.agora.banco.consultar<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM pca_itens i JOIN pca_planos p ON p.id = i.plano_id WHERE p.uasg = '920002' AND p.ano = 2026",
    );
    assert.equal(contagem?.total, 2);
  });

  test('publicação online: o plano aprovado vai ao PNCP (POST /v1/orgaos/{cnpj}/pca) e guarda o número de controle', async () => {
    const [cgl] = await obterJson<ResumoPlanoContratacoes[]>(app, planejamento, '/api/v1/pca?uasg=950001&ano=2027');
    assert.ok(cgl);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/pca/${cgl.id}/consolidar`)).statusCode, 200);
    const aprovado = await chamar(app, gestor, 'POST', `/api/v1/pca/${cgl.id}/aprovar`);
    assert.equal(aprovado.statusCode, 200, aprovado.body);
    const p = aprovado.json<PlanoContratacoesDetalhe>();
    assert.equal(p.situacao, 'publicado');
    assert.equal(p.publicacao?.idPncp, `${CNPJ_ORGAO}-0-000007/2027`);
    assert.equal(p.publicacao?.modo, 'online');
    assert.match(p.publicacao?.protocolo ?? '', /\/pca\/2027\/7$/);
    const envio = falso.estado.chamadas.find((c) => c.url.pathname.endsWith(`/orgaos/${CNPJ_ORGAO}/pca`));
    assert.ok(envio);
    const corpo = envio.corpo as { codigoUnidade: string; anoPca: number; itensPlano: { numeroItem: number; categoriaItemPca: number; catalogo: number; classificacaoSuperiorNome: string; valorTotal: number }[] };
    assert.equal(corpo.codigoUnidade, '950001');
    assert.equal(corpo.anoPca, 2027);
    assert.equal(corpo.itensPlano.length, 5);
    assert.deepEqual(corpo.itensPlano.map((i) => i.numeroItem), [1, 2, 3, 4, 5]);
    const papel = corpo.itensPlano.find((i) => i.classificacaoSuperiorNome === 'Papelaria e material de expediente');
    assert.equal(papel?.catalogo, 1);
    assert.equal(papel?.categoriaItemPca, 1);
    assert.ok(corpo.itensPlano.some((i) => i.catalogo === 2 && i.categoriaItemPca === 4), 'item sem código vai como "outros"');
  });
});
