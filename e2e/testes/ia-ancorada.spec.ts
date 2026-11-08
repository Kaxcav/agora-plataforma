/**
 * Frente Q — IA ancorada (F24): citação inventada apontada e aprovação travada até a revisão humana (RIA-14),
 * divergência de quantidade entre ETP e TR (RIA-15), busca na base normativa (RNF-08) e auditor contínuo da 2ª linha.
 * Os processos são criados no próprio teste, com dados sintéticos, para não depender da ordem dos arquivos.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

const DFD = {
  justificativa: 'Os rádios atuais estão fora de garantia e não atendem à cobertura exigida nas operações integradas.',
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
};
const item = (quantidade: number) => ({ catmat: '123456', descricao: 'Rádio portátil digital com bateria reserva', unidade: 'unidade', quantidade, valorUnitarioEstimado: 350_000 });

/** Chamada à API como a interface faria, com o token CSRF da sessão. */
async function chamarApi(page: Page, metodo: 'POST' | 'PUT', caminho: string, dados: unknown): Promise<{ status: number; corpo: { id?: string } }> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.fetch(`/api/v1${caminho}`, { method: metodo, data: dados, headers: { 'x-agora-csrf': sessao.csrfToken } });
  return { status: r.status(), corpo: (await r.json()) as { id?: string } };
}

async function novoProcesso(page: Page, titulo: string): Promise<string> {
  const r = await chamarApi(page, 'POST', '/processos', { titulo, orgao: 'PRF' });
  expect(r.status).toBe(201);
  return r.corpo.id ?? '';
}

test('RIA-14 — rascunho com citação inventada é apontado e só é aprovado depois da revisão humana', async ({ page }) => {
  test.setTimeout(120_000);
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]{36}\/documentos\/[0-9a-f-]{36}\/aprovar$/);
  await entrar(page, 'planejamento');
  const id = await novoProcesso(page, 'Aquisição de rádios portáteis digitais (conferência de citações)');
  const dfd = await chamarApi(page, 'PUT', `/processos/${id}/dfd`, {
    ...DFD,
    descricaoNecessidade: 'Substituir os rádios portáteis das equipes de campo, com a contratação direta prevista no art. 250 da Lei 14.133/2021.',
    itens: [item(10)],
  });
  expect(dfd.status).toBe(200);

  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  const formalizacao = page.getByRole('region', { name: 'Formalização' });
  await formalizacao.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  await esperarAviso(page, 'Rascunho gerado');

  const conferencia = page.getByRole('region', { name: 'Conferência das citações legais' });
  await expect(conferencia).toContainText('1 citação apontada');
  await expect(conferencia).toContainText('art. 250 da Lei 14.133/2021');
  await expect(conferencia).toContainText('Dispositivo inexistente');
  await expect(conferencia).toContainText('O art. 250 não existe na lei');
  await expect(conferencia.getByText('Aprovação bloqueada até a revisão das citações (RIA-14)')).toBeVisible();
  await verificarAcessibilidade(page, 'citação inventada apontada no rascunho');

  // O servidor recusa a aprovação enquanto não houver revisão das citações.
  await formalizacao.getByRole('button', { name: 'Aprovar', exact: true }).click();
  const aprovar = page.getByRole('dialog', { name: 'Aprovar documento' });
  await aprovar.getByRole('checkbox', { name: /Revisei integralmente/ }).check();
  await aprovar.getByRole('button', { name: 'Aprovar documento', exact: true }).click();
  await expect(aprovar.getByRole('alert')).toContainText('RIA-14');
  await aprovar.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // Revisão humana registrada (com justificativa): a aprovação é liberada.
  await conferencia.getByRole('button', { name: 'Registrar revisão das citações', exact: true }).click();
  const revisao = page.getByRole('dialog', { name: 'Registrar revisão das citações' });
  await revisao.getByRole('textbox', { name: /^Justificativa da revisão/ }).fill('Citação conferida na base normativa: o texto será corrigido na próxima versão do DFD.');
  await revisao.getByRole('button', { name: 'Registrar revisão', exact: true }).click();
  await esperarAviso(page, 'Revisão registrada');
  await expect(conferencia).toContainText('Revisão das citações registrada por');
  await expect(conferencia.getByText('Aprovação bloqueada até a revisão das citações (RIA-14)')).toHaveCount(0);

  await formalizacao.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await aprovar.getByRole('checkbox', { name: /Revisei integralmente/ }).check();
  await aprovar.getByRole('button', { name: 'Aprovar documento', exact: true }).click();
  await esperarAviso(page, 'Documento aprovado');

  // O painel de qualidade normativa mostra a citação apontada e o IMR-02 do mês abaixo da meta.
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Qualidade normativa' }).click();
  await esperarPaginaOk(page);
  const apontamentos = page.getByRole('region', { name: 'Citações apontadas no mês' });
  await expect(apontamentos).toContainText('art. 250 da Lei 14.133/2021');
  await expect(apontamentos).toContainText('Revisão registrada');
  await expect(page.getByText('Abaixo da meta').first()).toBeVisible();
  await verificarAcessibilidade(page, 'painel de qualidade normativa');

  // Conferir um texto colado, sem gravar.
  const conferir = page.getByRole('region', { name: 'Conferir as citações de um texto' });
  await conferir.getByRole('textbox', { name: 'Texto a conferir' }).fill('É vedada a aquisição de artigos de luxo (art. 20). A garantia segue o art. 96, § 9º.');
  await conferir.getByRole('button', { name: 'Conferir citações', exact: true }).click();
  await expect(conferir.getByRole('status')).toContainText('1 citação apontada');
  await expect(conferir.getByRole('status')).toContainText('O art. 96 não tem § 9º');
  erros.verificar();
});

test('RIA-15 — divergência de quantidade entre o ETP e o TR é apontada na conferência dos documentos', async ({ page }) => {
  test.setTimeout(120_000);
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await novoProcesso(page, 'Aquisição de rádios portáteis digitais (conferência cruzada)');
  const necessidade = 'Substituir os rádios portáteis das equipes de campo, que já não têm peças de reposição nem cobertura adequada.';
  expect((await chamarApi(page, 'PUT', `/processos/${id}/dfd`, { ...DFD, descricaoNecessidade: necessidade, itens: [item(10)] })).status).toBe(200);
  expect((await chamarApi(page, 'POST', `/processos/${id}/documentos/gerar`, { tipo: 'etp' })).status).toBe(200);
  expect((await chamarApi(page, 'PUT', `/processos/${id}/dfd`, { ...DFD, descricaoNecessidade: necessidade, itens: [item(15)] })).status).toBe(200);
  expect((await chamarApi(page, 'POST', `/processos/${id}/documentos/gerar`, { tipo: 'tr' })).status).toBe(200);

  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  await page.getByRole('link', { name: 'Conferir documentos', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/jornada/${id}/conferencia$`));
  await esperarPaginaOk(page);
  await expect(page.getByText('1 divergência encontrada entre os documentos')).toBeVisible();
  const divergencia = page.getByRole('table', { name: /^Item 1 — Rádio portátil digital com bateria reserva: valores diferentes entre os documentos/ });
  await expect(divergencia.getByRole('row', { name: /Estudo Técnico Preliminar \(ETP\) \(versão 1\)/ })).toContainText('10 unidade');
  await expect(divergencia.getByRole('row', { name: /Termo de Referência \(versão 1\)/ })).toContainText('15 unidade');
  await expect(page.getByRole('region', { name: 'Conferência cruzada entre os documentos' })).toContainText('requer revisão humana');
  await verificarAcessibilidade(page, 'conferência dos documentos do processo');
  erros.verificar();
});

test('RNF-08 — a busca na base normativa encontra o art. 75 e abre o artigo estruturado', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Base normativa' }).click();
  await esperarPaginaOk(page);
  await page.getByRole('textbox', { name: /^Buscar na Lei 14\.133\/2021/ }).fill('dispensa de licitação');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  const resultados = page.getByRole('list', { name: 'Resultados da busca por dispensa de licitação' });
  const primeiro = resultados.getByRole('listitem').first();
  await expect(primeiro).toContainText('Art. 75');
  await expect(primeiro).toContainText('Seção III — Da Dispensa de Licitação');
  await primeiro.getByRole('button', { name: 'Ler o art. 75' }).click();
  await expect(page.getByRole('heading', { name: 'Art. 75 da Lei 14.133/2021' })).toBeVisible();
  const artigo = page.getByRole('article', { name: 'Texto do art. 75' });
  await expect(artigo).toContainText('É dispensável a licitação');
  await expect(artigo).toContainText('II –');
  await expect(page.getByRole('region', { name: 'Origem do texto' })).toContainText('Câmara dos Deputados');
  await verificarAcessibilidade(page, 'base normativa com o art. 75 aberto');
  erros.verificar();
});

test('Auditor contínuo na aba da 2ª linha de defesa, com sinais e fundamento', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'controle');
  await page.goto('/controle?linha=segunda');
  await esperarPaginaOk(page);
  const auditor = page.getByRole('region', { name: 'Auditor contínuo' });
  await expect(auditor).toContainText('Contratos varridos');
  await expect(auditor).toContainText('requerem revisão humana');
  await verificarAcessibilidade(page, 'auditor contínuo da 2ª linha', '#segunda-auditor');
  erros.verificar();
});
