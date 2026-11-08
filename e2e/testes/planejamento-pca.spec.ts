/**
 * Frente O — planejamento: plano de contratações anual (RF-31), conferência do DFD com o PCA, sugestão do código do
 * catálogo (RIA-13) e intenção de registro de preços (RN-38). Dados sintéticos; cada teste prepara o que precisa, sem
 * depender da ordem dos arquivos. Contas usadas: planejamento e gestor.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

/** Chamada à API da Ágora com a sessão do navegador e o token CSRF (preparação de dados do teste). */
async function chamarApi<T>(page: Page, metodo: 'GET' | 'POST' | 'PUT', url: string, corpo?: unknown): Promise<T> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const resposta = await page.request.fetch(url, {
    method: metodo,
    headers: { 'x-agora-csrf': sessao.csrfToken },
    ...(metodo === 'GET' ? {} : { data: corpo ?? {} }),
  });
  expect(resposta.ok(), `${metodo} ${url} → ${resposta.status()} ${await resposta.text()}`).toBeTruthy();
  return (await resposta.json()) as T;
}

async function trocarUsuario(page: Page, perfil: string): Promise<void> {
  await page.context().clearCookies();
  await entrar(page, perfil);
}

/** Processo novo na etapa 1 com o DFD completo e um item sem código do catálogo. */
async function processoComDfd(page: Page, uasg: string, titulo: string): Promise<string> {
  const processo = await chamarApi<{ id: string }>(page, 'POST', '/api/v1/processos', { titulo, orgao: 'MJSP', uasg });
  await chamarApi(page, 'PUT', `/api/v1/processos/${processo.id}/dfd`, {
    descricaoNecessidade: 'Renovar as estações de trabalho das equipes de análise, hoje com equipamentos sem garantia e lentos.',
    justificativa: 'Os equipamentos atuais travam durante as análises e atrasam a entrega dos relatórios às unidades demandantes.',
    itens: [{ catmat: null, descricao: 'Notebooks com processador de oito núcleos e 16 GB de memória', unidade: 'unidade', quantidade: 40, valorUnitarioEstimado: 720_000 }],
    usaCatalogoPadronizado: true,
    justificativaNaoPadronizacao: null,
    justificativaArtigoLuxo: null,
    previstoNoPca: true,
    tipoObjeto: 'bens',
  });
  return processo.id;
}

function dataMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(d);
}

test('consolidar e publicar o PCA: o planejamento consolida as demandas, a autoridade aprova e o plano vai ao PNCP', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Plano de contratações' }).click();
  await expect(page).toHaveURL(/\/planejamento\/pca$/);
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/planejamento/pca');

  const planos = await chamarApi<{ id: string; ano: number; situacao: string }[]>(page, 'GET', '/api/v1/pca?uasg=950001');
  const plano = planos.find((p) => p.situacao === 'em_elaboracao');
  expect(plano, 'PCA do exercício seguinte em elaboração na carga').toBeTruthy();
  const titulo = `PCA ${plano?.ano ?? ''} · UASG 950001`;
  await page.getByRole('button', { name: `Abrir o PCA ${plano?.ano ?? ''} da UASG 950001` }).click();
  const secao = page.getByRole('region', { name: titulo, exact: true });
  await expect(secao).toBeVisible();
  await expect(secao).toContainText('Em elaboração');
  await expect(secao.getByRole('region', { name: `Demandas das unidades do ${titulo}` }).locator('tbody tr')).toHaveCount(7);

  await secao.getByRole('button', { name: 'Consolidar demandas', exact: true }).click();
  const consolidar = page.getByRole('dialog', { name: 'Consolidar demandas' });
  await consolidar.getByRole('button', { name: 'Consolidar', exact: true }).click();
  await expect(consolidar).toBeHidden();
  await esperarAviso(page, 'Plano consolidado');
  await expect(secao).toContainText('Consolidado, aguardando aprovação');
  await expect(secao.getByRole('region', { name: `Itens consolidados do ${titulo}` }).locator('tbody tr')).toHaveCount(5);
  await expect(secao).toContainText(`950001/${plano?.ano ?? ''}-0001`);
  await verificarAcessibilidade(page, 'plano consolidado');
  // O planejamento não aprova: o botão nem aparece (o servidor também recusaria).
  await expect(secao.getByRole('button', { name: 'Aprovar e publicar no PNCP' })).toHaveCount(0);

  await trocarUsuario(page, 'gestor');
  await page.goto(`/planejamento/pca?plano=${plano?.id ?? ''}`);
  await esperarPaginaOk(page);
  const secaoGestor = page.getByRole('region', { name: titulo, exact: true });
  await secaoGestor.getByRole('button', { name: 'Aprovar e publicar no PNCP', exact: true }).click();
  const aprovar = page.getByRole('dialog', { name: 'Aprovar e publicar no PNCP' });
  await aprovar.getByRole('button', { name: 'Aprovar e publicar', exact: true }).click();
  await expect(aprovar).toBeHidden();
  await esperarAviso(page, 'Plano aprovado');
  await expect(secaoGestor).toContainText('Publicado no PNCP');
  await expect(secaoGestor).toContainText(new RegExp(`Nº \\d{14}-0-\\d{6}/${plano?.ano ?? ''}`));
  await expect(secaoGestor).toContainText('Publicação simulada');
  await verificarAcessibilidade(page, 'plano publicado');
  erros.verificar();
});

test('DFD sem item do PCA publicado exige justificativa: bloqueio RF-31 até registrar a justificativa', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await processoComDfd(page, '950002', 'Aquisição de notebooks para as equipes de análise de dados');
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);

  const bloqueios = page.getByRole('region', { name: 'Bloqueios' });
  await expect(bloqueios).toContainText('RF-31');
  const pca = page.getByRole('region', { name: 'Plano de contratações anual (PCA)' });
  await expect(pca).toContainText('tem PCA');
  await verificarAcessibilidade(page, 'DFD com PCA a conferir');

  await pca.getByRole('radio', { name: /^Não consta do PCA/ }).check();
  await pca.getByRole('button', { name: 'Registrar vínculo com o PCA', exact: true }).click();
  await expect(pca.getByRole('alert')).toContainText('Registre a justificativa da contratação não prevista no PCA');
  await expect(bloqueios).toContainText('RF-31');

  await pca
    .getByRole('textbox', { name: /^Justificativa da contratação não prevista no PCA/ })
    .fill('A demanda surgiu depois da aprovação do plano, com a criação de duas novas equipes de análise de dados.');
  await pca.getByRole('button', { name: 'Registrar vínculo com o PCA', exact: true }).click();
  await esperarAviso(page, 'Vínculo com o PCA registrado');
  await expect(pca).toContainText('Fora do PCA, com justificativa');
  await expect(bloqueios).not.toContainText('RF-31');
  await expect(bloqueios).toContainText('Nenhum bloqueio registrado');
  await expect(page.getByText('Sem alterações pendentes.')).toBeVisible();
  await verificarAcessibilidade(page, 'DFD com justificativa fora do PCA');
  erros.verificar();
});

test('sugestão de código CATMAT aceita: o agente confere a sugestão e o código entra no item do DFD', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await processoComDfd(page, '950001', 'Aquisição de notebooks para a coordenação de logística');
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);

  const catalogo = page.getByRole('region', { name: 'Código do catálogo (CATMAT/CATSER)' });
  await expect(catalogo).toContainText('Sem código do catálogo');
  await catalogo.getByRole('button', { name: 'Sugerir código para o item 1', exact: true }).click();
  const sugestoes = catalogo.getByRole('list', { name: 'Sugestões para o item 1' });
  await expect(sugestoes.getByRole('listitem').first()).toContainText('230410');
  await expect(catalogo).toContainText('Requer revisão humana');
  await verificarAcessibilidade(page, 'sugestões do catálogo');

  await sugestoes.getByRole('button', { name: 'Usar o código 230410 no item 1', exact: true }).click();
  await esperarAviso(page, 'Código do catálogo registrado');
  await expect(catalogo).toContainText('CATMAT 230410');
  await expect(page.getByRole('textbox', { name: 'Código CATMAT/CATSER do item 1' })).toHaveValue('230410');
  await expect(page.getByText('Sem alterações pendentes.')).toBeVisible();
  erros.verificar();
});

test('IRP aberta por menos de 8 dias úteis é recusada pelo servidor (RN-38); com o prazo mínimo, abre', async ({ page }) => {
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/irps$/);
  await entrar(page, 'planejamento');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Intenções de registro de preços' }).click();
  await expect(page).toHaveURL(/\/planejamento\/irp$/);
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/planejamento/irp');

  await page.getByRole('button', { name: 'Abrir intenção de registro de preços', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Abrir intenção de registro de preços' });
  await dialogo.getByRole('textbox', { name: /^UASG gerenciadora/ }).fill('930001');
  await dialogo.getByRole('textbox', { name: /^Código do catálogo/ }).fill('357320');
  await dialogo.getByRole('textbox', { name: /^Objeto/ }).fill('Registro de preços de óculos de proteção balística para as equipes');
  await dialogo.getByRole('textbox', { name: /^Quantidade do gerenciador/ }).fill('300');
  await dialogo.getByLabel(/^Encerramento/).fill(dataMais(3));
  await expect(dialogo).toContainText('Período menor que 8 dias úteis');
  await dialogo.getByRole('button', { name: 'Abrir intenção', exact: true }).click();
  const recusa = dialogo.getByRole('alert').filter({ hasText: 'Não foi possível abrir a intenção de registro de preços' });
  await expect(recusa).toContainText('pelo menos 8 dias úteis');
  await expect(recusa).toContainText('RN-38');
  await verificarAcessibilidade(page, 'IRP recusada', 'dialog[open]');

  await dialogo.getByLabel(/^Encerramento/).fill(dataMais(21));
  await dialogo.getByRole('button', { name: 'Abrir intenção', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Intenção de registro de preços aberta');
  const secao = page.getByRole('region', { name: /^IRP \d{3}\/\d{4}$/ });
  await expect(secao).toContainText('Aberta para adesões');
  await expect(secao).toContainText('Registro de preços de óculos de proteção balística');
  await verificarAcessibilidade(page, 'IRP aberta');
  erros.verificar();
});
