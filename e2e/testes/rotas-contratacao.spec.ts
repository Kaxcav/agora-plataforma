/**
 * Rotas de contratação (F9): dispensa eletrônica com aviso de 3 dias úteis e propostas adicionais, sinal de
 * fracionamento, adesão a ata acima do limite recusada e compra pela vitrine do Sicx. Os processos são criados por
 * cada teste (pela API, como a interface faria), para não depender dos processos da carga nem da ordem dos arquivos.
 */
import { expect, test, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { SENHA, entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

const JUSTIFICATIVA = 'Contratação de pequeno valor para reposição do estoque operacional da unidade requisitante.';

interface Detalhe {
  id: string;
  etapaAtual: number;
  documentos: { id: string; tipo: string; numeroSei: string | null }[];
  parecer: { itens: { id: string }[] };
}

/** Hoje em Brasília (AAAA-MM-DD), como o servidor calcula. */
function hojeBrasilia(deslocamentoDias = 0): string {
  const data = new Date(Date.now() + deslocamentoDias * 86_400_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
}

interface ClienteApi {
  api: APIRequestContext;
  csrf: string;
  usuarioId: string;
  enviar<T>(metodo: 'POST' | 'PUT', url: string, corpo?: unknown): Promise<T>;
}

async function clienteApi(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string | undefined, perfil: string): Promise<ClienteApi> {
  const api = await playwright.request.newContext({ baseURL });
  const login = await api.post('/api/v1/sessao', { data: { email: `${perfil}@agora.demo`, senha: SENHA } });
  expect(login.status()).toBe(200);
  const { csrfToken, usuario } = (await login.json()) as { csrfToken: string; usuario: { id: string } };
  return {
    api,
    csrf: csrfToken,
    usuarioId: usuario.id,
    async enviar<T>(metodo: 'POST' | 'PUT', url: string, corpo?: unknown): Promise<T> {
      const r = await api.fetch(url, { method: metodo, data: corpo ?? {}, headers: { 'x-agora-csrf': csrfToken } });
      expect(r.status(), `${metodo} ${url}: ${await r.text()}`).toBeLessThan(300);
      return (await r.json()) as T;
    },
  };
}

const DFD = (quantidade: number, valorUnitario: number) => ({
  descricaoNecessidade: 'Repor o material de uso contínuo das equipes operacionais da unidade requisitante.',
  justificativa: 'O estoque atual não atende à demanda prevista para os próximos meses de operação da unidade.',
  itens: [{ catmat: null, descricao: 'Material de consumo padronizado para as equipes', unidade: 'unidade', quantidade, valorUnitarioEstimado: valorUnitario }],
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
});

/** Processo novo na etapa 1 com o DFD preenchido. */
async function processoNovo(c: ClienteApi, titulo: string, orgao: string, quantidade: number, valorUnitario: number): Promise<string> {
  const p = await c.enviar<Detalhe>('POST', '/api/v1/processos', { titulo, orgao });
  await c.enviar('PUT', `/api/v1/processos/${p.id}/dfd`, DFD(quantidade, valorUnitario));
  return p.id;
}

/** Dispensa por valor levada até a etapa 5 com parecer favorável, pelas mesmas chamadas da interface. */
async function dispensaNaEtapa5(c: ClienteApi, autoridade: ClienteApi): Promise<string> {
  const id = await processoNovo(c, 'Aquisição de kits de higiene por dispensa eletrônica', 'SENASP', 100, 50_000);
  const base = `/api/v1/processos/${id}`;
  await c.enviar('PUT', `${base}/rota`, { rota: 'dispensa', hipoteseDispensa: 'valor_demais', natureza: 'Kits de higiene pessoal', justificativa: JUSTIFICATIVA });
  await c.enviar('POST', `${base}/avancar`);
  const designaveis = (await (await c.api.get('/api/v1/processos/designaveis')).json()) as { id: string; perfis: string[] }[];
  const com = (perfil: string) => designaveis.find((u) => u.perfis.includes(perfil))?.id ?? '';
  await c.enviar('PUT', `${base}/equipe`, {
    designacoes: [
      { papel: 'equipe_planejamento', usuarioId: com('planejamento') },
      { papel: 'agente_contratacao', usuarioId: com('agente_contratacao') },
      { papel: 'autoridade_competente', usuarioId: autoridade.usuarioId },
      { papel: 'parecerista_juridico', usuarioId: com('juridico') },
    ],
  });
  const aprovarEAssinar = async (tipo: string) => {
    const gerado = await c.enviar<Detalhe>('POST', `${base}/documentos/gerar`, { tipo });
    const doc = gerado.documentos.find((d) => d.tipo === tipo);
    const aprovado = await c.enviar<Detalhe>('POST', `${base}/documentos/${doc?.id ?? ''}/aprovar`);
    await c.enviar('POST', `${base}/sei/assinar`, { documentoNumero: aprovado.documentos.find((d) => d.id === doc?.id)?.numeroSei });
  };
  await aprovarEAssinar('dfd');
  await c.enviar('POST', `${base}/avancar`);
  await c.enviar('PUT', `${base}/cesta-precos`, {
    orcamentoSigiloso: false,
    motivoSigilo: null,
    cotacoes: [
      { fonte: 'painel_precos', descricaoFonte: 'Painel de Preços', valorUnitario: 50_000, dataCotacao: hojeBrasilia(-10) },
      { fonte: 'contratacao_similar', descricaoFonte: 'Contratação similar de outro órgão', valorUnitario: 51_000, dataCotacao: hojeBrasilia(-40) },
      { fonte: 'nota_fiscal', descricaoFonte: 'Nota fiscal de venda a órgão público', valorUnitario: 49_000, dataCotacao: hojeBrasilia(-20) },
    ],
  });
  await c.enviar('PUT', `${base}/sustentabilidade`, {
    criteriosAmbientais: 'Embalagens recicláveis e produtos com certificação ambiental reconhecida, quando houver no mercado.',
    logisticaReversa: 'O fornecedor recolhe embalagens e resíduos para destinação ambientalmente adequada, sem custo adicional.',
  });
  await c.enviar('POST', `${base}/avancar`);
  // RN-39: dotação e declaração de adequação orçamentária aprovada pela autoridade designada (art. 72, IV).
  await c.enviar('PUT', `${base}/dotacao`, {
    linhas: [
      { unidadeGestora: '910001', programaTrabalho: '06.181.9990.AG99.0001', naturezaDespesa: '3.3.90.30', fonteRecursos: '1001000000', exercicio: Number(hojeBrasilia().slice(0, 4)), valor: 6_000_000, preEmpenho: null },
    ],
  });
  const comDeclaracao = await c.enviar<Detalhe>('POST', `${base}/documentos/gerar`, { tipo: 'declaracao_orcamentaria' });
  const declaracao = comDeclaracao.documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
  const declarada = await autoridade.enviar<Detalhe>('POST', `${base}/documentos/${declaracao?.id ?? ''}/aprovar`);
  await autoridade.enviar('POST', `${base}/sei/assinar`, { documentoNumero: declarada.documentos.find((d) => d.id === declaracao?.id)?.numeroSei });
  await aprovarEAssinar('tr');
  const etapa5 = await c.enviar<Detalhe>('POST', `${base}/avancar`);
  expect(etapa5.etapaAtual).toBe(5);
  await c.enviar('PUT', `${base}/parecer`, { itens: etapa5.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })), conclusao: 'favoravel' });
  return id;
}

async function abrirProcesso(page: Page, id: string): Promise<void> {
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
}

test.describe('rotas de contratação (F9: RF-34, RN-41, RN-42)', () => {
  test('dispensa eletrônica: aviso de 3 dias úteis no PNCP e propostas adicionais; o julgamento espera o encerramento', async ({ page, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const erros = monitorarErros(page);
    erros.permitir(422, /\/processos\/[0-9a-f-]+\/avancar$/);
    const admin = await clienteApi(playwright, baseURL, 'admin');
    const gestor = await clienteApi(playwright, baseURL, 'gestor');
    const id = await dispensaNaEtapa5(admin, gestor);

    await entrar(page, 'agente');
    await abrirProcesso(page, id);
    await expect(page.getByText('Rota: Dispensa eletrônica por valor')).toBeVisible();
    const painel = page.getByRole('region', { name: /Aviso de dispensa eletrônica/ });
    await expect(painel.getByText(/Se publicado hoje, o aviso fica aberto até/)).toBeVisible();
    // Sem edital nesta rota: a publicação do edital não aparece.
    await expect(page.getByRole('heading', { name: 'Publicação do edital', exact: true })).toHaveCount(0);

    await painel.getByRole('button', { name: 'Publicar aviso no PNCP', exact: true }).click();
    await esperarAviso(page, 'Aviso publicado');
    await expect(painel.getByText(/Propostas adicionais até/)).toBeVisible();
    await expect(painel.getByText(/Faltam \d dia\(s\) útil\(eis\)|Último dia do aviso/)).toBeVisible();
    await expect(painel.getByText(/^SIMULADO-/)).toBeVisible();

    const formulario = painel.getByRole('form', { name: 'Registrar proposta' });
    const fornecedor = formulario.getByRole('combobox', { name: /^Fornecedor/ });
    await expect(fornecedor.locator('option')).not.toHaveCount(1);
    await fornecedor.selectOption({ index: 1 });
    await formulario.getByRole('textbox', { name: /^Valor total da proposta/ }).fill('48.500,00');
    await formulario.getByRole('textbox', { name: /^Valor total da proposta/ }).blur();
    await formulario.getByRole('button', { name: 'Registrar proposta', exact: true }).click();
    await esperarAviso(page, 'Proposta registrada');
    await expect(painel.getByRole('table', { name: 'Propostas da dispensa' }).getByText(/Adicional, no aviso/)).toBeVisible();
    await verificarAcessibilidade(page, 'aviso de dispensa eletrônica');

    // Aviso aberto: o avanço para o julgamento é recusado pelo servidor (RN-41).
    await page.getByRole('button', { name: 'Avançar para a etapa 6', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Avançar etapa', exact: true }).click();
    await expect(page.getByText(/O aviso está aberto até .* o julgamento começa depois do encerramento/).first()).toBeVisible();
    erros.verificar();
  });

  test('fracionamento sinalizado: dispensa no mesmo ramo das compras com cartão passa do limite (RIA-01)', async ({ page, playwright, baseURL }) => {
    const erros = monitorarErros(page);
    const planejamento = await clienteApi(playwright, baseURL, 'planejamento');
    const id = await processoNovo(planejamento, 'Aquisição de resmas de papel para a coordenação', 'SENASP', 200, 8_000);

    await entrar(page, 'planejamento');
    await abrirProcesso(page, id);
    const rota = page.getByRole('region', { name: 'Rota de contratação' });
    await rota.getByRole('radio', { name: /^Dispensa de licitação/ }).check();
    await rota.getByRole('radio', { name: /^Por valor — compras e demais serviços/ }).check();
    await rota.getByRole('textbox', { name: /^Ramo de atividade do objeto/ }).fill('material de expediente');
    await rota.getByRole('textbox', { name: /^Justificativa da escolha da rota/ }).fill(JUSTIFICATIVA);
    await rota.getByRole('button', { name: 'Salvar rota', exact: true }).click();
    await esperarAviso(page, 'Rota de contratação salva');
    await expect(rota.getByText(/Fracionamento no ramo "material de expediente"/)).toBeVisible();
    await expect(rota.getByText(/Indício de fracionamento no ramo/)).toBeVisible();
    await expect(page.getByText('RIA-01').first()).toBeVisible();
    await expect(rota.getByRole('textbox', { name: /^Análise do agente sobre o indício de fracionamento/ })).toBeVisible();
    await verificarAcessibilidade(page, 'escolha da rota com sinal de fracionamento');
    erros.verificar();
  });

  test('adesão a ata acima de 50% do registrado por órgão é recusada (art. 86, § 4º)', async ({ page, playwright, baseURL }) => {
    const erros = monitorarErros(page);
    erros.permitir(422, /\/processos\/[0-9a-f-]+\/adesao$/);
    const planejamento = await clienteApi(playwright, baseURL, 'planejamento');
    const id = await processoNovo(planejamento, 'Adesão a ata de registro de preços de material permanente', 'SENASP', 1, 100_000);
    await planejamento.enviar('PUT', `/api/v1/processos/${id}/rota`, { rota: 'adesao_ata', justificativa: JUSTIFICATIVA });
    const atas = (await (await planejamento.api.get(`/api/v1/processos/${id}/adesao/atas-disponiveis`)).json()) as { itens: { id: string; saldoOrgao: number }[] }[];
    const item = atas.flatMap((a) => a.itens).find((i) => i.saldoOrgao > 0);
    test.skip(!item, 'nenhuma ata vigente que aceite adesão nos dados sintéticos');

    await entrar(page, 'planejamento');
    await abrirProcesso(page, id);
    const rota = page.getByRole('region', { name: 'Rota de contratação' });
    await rota.getByRole('combobox', { name: /^Item da ata/ }).selectOption(item?.id ?? '');
    await rota.getByRole('spinbutton', { name: /^Quantidade a aderir/ }).fill(String((item?.saldoOrgao ?? 0) + 1));
    await rota.getByRole('textbox', { name: /^Justificativa da vantagem da adesão/ }).fill(JUSTIFICATIVA);
    await rota.getByRole('button', { name: 'Solicitar adesão', exact: true }).click();
    await expect(rota.getByText('A adesão foi recusada', { exact: true })).toBeVisible();
    await expect(rota.getByText(/limite por órgão aderente: até 50% .*art\. 86, § 4º/)).toBeVisible();
    await verificarAcessibilidade(page, 'adesão recusada');
    erros.verificar();
  });

  test('compra pela vitrine do Sicx: ranqueamento, ordem de compra pela reserva do ETP abrangente e conclusão', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'agente');
    await page.goto('/sicx?uasg=910001');
    await esperarPaginaOk(page);
    await expect(page.getByText('Vitrine simulada')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Item' }).fill('papel');
    const tabela = page.getByRole('table', { name: /^Ofertas de Papel A4/ });
    await expect(tabela).toBeVisible();
    await expect(tabela.getByText(/Cadin/)).toBeVisible();
    await expect(tabela.getByText(/não atende à localidade DF/)).toBeVisible();
    await verificarAcessibilidade(page, 'vitrine do Sicx');

    await tabela.getByRole('button', { name: /^Selecionar oferta 1º/ }).click();
    const dialogo = page.getByRole('dialog', { name: 'Emitir ordem de compra no Sicx' });
    await dialogo.getByRole('combobox', { name: /^Reserva de limite do ETP abrangente/ }).selectOption({ index: 1 });
    await dialogo.getByRole('button', { name: 'Emitir ordem de compra', exact: true }).click();
    await esperarAviso(page, /Ordem de compra SICX-\d{4}-\d{6} emitida/);
    const compras = page.getByRole('table', { name: 'Compras no Sicx' });
    await expect(compras.getByText('Ordem emitida').first()).toBeVisible();
    await compras.getByRole('button', { name: 'Concluir compra', exact: true }).first().click();
    await esperarAviso(page, /concluída/);
    await expect(compras.getByText('Aguardando entrega').first()).toBeVisible();
    erros.verificar();
  });

  test('cartão de pagamento e adesões às atas: telas carregam sem violações graves de acessibilidade', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'admin');
    for (const rota of ['/cartao-pagamento', '/atas/adesoes']) {
      await page.goto(rota);
      await esperarPaginaOk(page);
      await verificarAcessibilidade(page, rota);
    }
    await page.goto('/cartao-pagamento');
    await page.getByRole('textbox', { name: /^UASG/ }).fill('930001');
    // A carga tem compras com cartão da SENASP no ramo "material de expediente" (a primeira, 15 dias atrás).
    await page.getByLabel(/^Competência/).fill(hojeBrasilia(-15).slice(0, 7));
    const compras = page.getByRole('table', { name: 'Compras com cartão de pagamento' });
    await expect(compras).toBeVisible();
    await expect(compras.getByText('material de expediente').first()).toBeVisible();
    erros.verificar();
  });
});
