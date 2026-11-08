/**
 * Painel das metas do ETP (RF-39) e tela de operação (RNF-10, IMR-01). Dados sintéticos: as metas e o histórico
 * da sonda vêm da carga de demonstração; o processo barrado pela trava é criado pelo próprio teste.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

function valorIndicador(page: Page, rotulo: string) {
  return page.locator('.indicador').filter({ hasText: rotulo }).locator('.indicador__valor');
}

/** 'AAAA-MM-DDTHH:mm' no fuso de Brasília, para campos datetime-local. */
function horarioLocal(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const p = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}

test('painel das metas mostra os três indicadores com as metas configuradas, e um bloqueio provocado entra na contagem', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.getByRole('link', { name: 'Metas do ETP', exact: true }).click();
  await expect(page).toHaveURL(/\/metas-etp$/);
  await esperarPaginaOk(page);

  await expect(page.getByRole('heading', { name: 'Tempo de instrução da fase preparatória' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Erros formais barrados pelas travas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Economia: estimado × contratado' })).toBeVisible();
  await expect(page.getByText('Meta: reduzir em 40% o tempo da linha de base.', { exact: false })).toBeVisible();
  await expect(page.getByText('Meta: barrar pelo menos 95% das ocorrências de erro formal.')).toBeVisible();
  await expect(page.getByText('Meta: economia de pelo menos 6,0% sobre o valor estimado.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Efeito dos expurgos da cesta de preços (à parte)' })).toBeVisible();
  await expect(page.getByText(/Não atribui a economia à IA/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Tempo de instrução por etapa' }).getByRole('row')).toHaveCount(5);
  await verificarAcessibilidade(page, '/metas-etp');

  const antes = Number((await valorIndicador(page, 'Erros formais barrados').innerText()).replace(/\D/g, ''));
  expect(antes).toBeGreaterThan(0);

  // Processo novo, sem DFD: o avanço é barrado pela trava e o bloqueio entra na trilha.
  const token = await csrf(page);
  const criado = await page.request.post('/api/v1/processos', { headers: { 'x-agora-csrf': token }, data: { titulo: `Aquisição sintética para provocar a trava ${Date.now()}`, orgao: 'MJSP' } });
  expect(criado.status()).toBeLessThan(300);
  const processo = (await criado.json()) as { id: string };
  const avanco = await page.request.post(`/api/v1/processos/${processo.id}/avancar`, { headers: { 'x-agora-csrf': token } });
  expect(avanco.status()).toBe(422);

  await page.reload();
  await esperarPaginaOk(page);
  await expect(valorIndicador(page, 'Erros formais barrados')).toHaveText(String(antes + 1));

  // CSV gerado no servidor.
  const csv = await page.request.get((await page.getByRole('link', { name: 'Baixar CSV' }).getAttribute('href')) ?? '');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');

  // O administrador ajusta a meta de economia; o painel passa a medir contra ela.
  await page.getByRole('button', { name: 'Configurar metas', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Configurar as metas do ETP' });
  await expect(dialogo).toBeVisible();
  const economia = dialogo.getByRole('textbox', { name: 'Economia mínima sobre o estimado (%)' });
  await expect(economia).toHaveValue('6');
  await verificarAcessibilidade(page, 'configuração das metas', 'dialog[open]');
  await economia.fill('7,5');
  await dialogo.getByRole('button', { name: 'Salvar metas', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Metas salvas');
  await expect(page.getByText('Meta: economia de pelo menos 7,5% sobre o valor estimado.')).toBeVisible();
  erros.verificar();
});

test('tela de operação mostra a disponibilidade medida pela sonda e registra a janela do PNCP', async ({ page, browser }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.getByRole('link', { name: 'Operação', exact: true }).click();
  await expect(page).toHaveURL(/\/operacao$/);
  await esperarPaginaOk(page);

  const componentes = page.getByRole('list', { name: 'Componentes da plataforma' }).getByRole('listitem');
  await expect(componentes).toHaveCount(4);
  await expect(componentes.filter({ hasText: 'Banco de dados' }).getByText('Disponível', { exact: true })).toBeVisible();
  await expect(valorIndicador(page, 'Disponibilidade no mês')).toHaveText(/^\d{1,3},\d{2}%$/);
  await expect(page.getByRole('table', { name: 'Disponibilidade por componente no mês' }).getByRole('row')).toHaveCount(5);
  await verificarAcessibilidade(page, '/operacao');

  await page.getByRole('button', { name: 'Sondar agora', exact: true }).click();
  await esperarAviso(page, 'Sondagem concluída');

  const agora = Date.now();
  await page.getByRole('button', { name: 'Registrar janela do PNCP', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Registrar janela de manutenção do PNCP' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel(/^Início/).fill(horarioLocal(new Date(agora - 30 * 60_000)));
  await dialogo.getByLabel(/^Fim/).fill(horarioLocal(new Date(agora - 10 * 60_000)));
  await dialogo.getByRole('textbox', { name: /^Descrição/ }).fill('Janela sintética de manutenção do PNCP registrada pelo teste.');
  await verificarAcessibilidade(page, 'registro da janela', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar janela', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Janela registrada');
  await expect(page.getByRole('table', { name: 'Janelas de manutenção do PNCP' }).getByText('Janela sintética de manutenção do PNCP registrada pelo teste.')).toBeVisible();

  const csv = await page.request.get((await page.getByRole('link', { name: 'Baixar relatório do mês (CSV)' }).getAttribute('href')) ?? '');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('Janela do PNCP (registrada)');
  erros.verificar();

  // Gestor: sem a tela de operação no menu e sem acesso pela API; vê o painel das metas, sem configurar.
  const contexto = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 900 } });
  const gestor = await contexto.newPage();
  await entrar(gestor, 'gestor');
  await expect(gestor.getByRole('link', { name: 'Operação', exact: true })).toHaveCount(0);
  expect((await gestor.request.get('/api/v1/operacao/situacao')).status()).toBe(403);
  await gestor.goto('/metas-etp');
  await esperarPaginaOk(gestor);
  await expect(gestor.getByRole('button', { name: 'Configurar metas', exact: true })).toHaveCount(0);
  await contexto.close();
});
