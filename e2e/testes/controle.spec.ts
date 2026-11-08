/**
 * Controle das contratações (Lei 14.133/2021, arts. 169 a 171): painéis das três linhas de defesa (RF-23), cautelar
 * suspensiva do controle externo que bloqueia o avanço e é revogada (RF-24, RN-30) e revisão trimestral da matriz de
 * riscos do contrato (RN-29). Dados sintéticos; o processo atingido pela cautelar é criado pelo próprio teste.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function sessaoDe(browser: Browser, perfil: string): Promise<Page> {
  const contexto = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 900 } });
  const page = await contexto.newPage();
  await entrar(page, perfil);
  return page;
}

async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

function abasDe(page: Page) {
  return page.getByRole('tablist', { name: 'Linhas de defesa' }).getByRole('tab');
}

test('cada linha de defesa vê o seu painel, e o servidor nega os demais', async ({ page, browser }) => {
  const erros = monitorarErros(page);

  // 1ª linha — agente de contratação
  await entrar(page, 'agente');
  await page.getByRole('link', { name: 'Linhas de defesa', exact: true }).click();
  await expect(page).toHaveURL(/\/controle$/);
  await esperarPaginaOk(page);
  await expect(abasDe(page)).toHaveText(['1ª linha — gestão e fiscalização']);
  await expect(page.getByRole('heading', { name: 'Revisão trimestral da matriz de riscos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Processos com bloqueio' })).toBeVisible();
  await verificarAcessibilidade(page, '/controle (1ª linha)');
  expect((await page.request.get('/api/v1/controle/segunda-linha')).status()).toBe(403);
  expect((await page.request.get('/api/v1/controle/terceira-linha')).status()).toBe(403);
  erros.verificar();

  // 2ª linha — assessoria jurídica
  const juridico = await sessaoDe(browser, 'juridico');
  await juridico.goto('/controle');
  await esperarPaginaOk(juridico);
  await expect(abasDe(juridico)).toHaveText(['2ª linha — jurídico e controle interno']);
  await expect(juridico.getByRole('heading', { name: 'Matriz de achados preventivos' })).toBeVisible();
  await expect(juridico.getByRole('heading', { name: 'Exceções justificadas' })).toBeVisible();
  await verificarAcessibilidade(juridico, '/controle (2ª linha)');
  expect((await juridico.request.get('/api/v1/controle/primeira-linha')).status()).toBe(403);

  // 3ª linha — auditor do controle externo (leitura ampla e relatório em PDF)
  const auditor = await sessaoDe(browser, 'auditoria.externa');
  await auditor.goto('/controle');
  await esperarPaginaOk(auditor);
  await expect(abasDe(auditor)).toHaveCount(3);
  await auditor.getByRole('tab', { name: '3ª linha — auditoria (CGU e TCU)' }).click();
  await expect(auditor.getByText('Trilha íntegra')).toBeVisible();
  await expect(auditor.getByRole('heading', { name: 'Medidas do controle externo e prazos' })).toBeVisible();
  await verificarAcessibilidade(auditor, '/controle (3ª linha)');
  const link = auditor.getByRole('link', { name: 'Baixar relatório executivo (PDF)' });
  const pdf = await auditor.request.get((await link.getAttribute('href')) ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // Sem linha de defesa: sem menu e sem acesso direto
  const consulta = await sessaoDe(browser, 'consulta');
  await expect(consulta.getByRole('link', { name: 'Linhas de defesa', exact: true })).toHaveCount(0);
  expect((await consulta.request.get('/api/v1/controle/primeira-linha')).status()).toBe(403);
});

test('cautelar suspensiva do TCU bloqueia o avanço do processo e é revogada', async ({ page, browser }) => {
  const erros = monitorarErros(page);
  // Processo novo, criado pela equipe de planejamento só para este teste.
  const planejamento = await sessaoDe(browser, 'planejamento');
  const marca = String(Date.now());
  const titulo = `Aquisição sintética para teste do controle externo ${marca}`;
  const criado = await planejamento.request.post('/api/v1/processos', {
    headers: { 'x-agora-csrf': await csrf(planejamento) },
    data: { titulo, orgao: 'PRF' },
  });
  expect(criado.status()).toBeLessThan(300);
  const processo = (await criado.json()) as { id: string; numeroSei: string };

  // Controle interno registra a cautelar com efeito suspensivo.
  await entrar(page, 'controle');
  await page.goto('/controle-externo');
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/controle-externo');
  await page.getByRole('button', { name: 'Registrar medida', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Registrar medida do controle externo' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('checkbox', { name: 'Com efeito suspensivo' })).toBeChecked();
  await dialogo.getByRole('textbox', { name: /^Número da decisão ou do ofício/ }).fill('7001/2026');
  await dialogo.getByLabel(/^Data da decisão/).fill(HOJE);
  await dialogo.getByLabel(/^Data da ciência pelo órgão/).fill(HOJE);
  await expect(dialogo.getByText(/10 dias úteis\)/)).toBeVisible();
  await dialogo.getByRole('searchbox', { name: 'Buscar processo' }).fill(marca);
  await dialogo.getByRole('radio', { name: `Processo ${processo.numeroSei}` }).check();
  await dialogo
    .getByRole('textbox', { name: /^Objeto da medida/ })
    .fill('Suspensão cautelar sintética do processo para exame de cláusula restritiva do edital.');
  await verificarAcessibilidade(page, 'registro da medida', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar medida', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Medida registrada');
  const linha = page.getByRole('row').filter({ hasText: '7001/2026' });
  await expect(linha.getByText('Suspensão em vigor')).toBeVisible();

  // A jornada mostra o bloqueio RN-30 e o servidor recusa o avanço.
  await planejamento.goto(`/jornada/${processo.id}`);
  await esperarPaginaOk(planejamento);
  const bloqueios = planejamento.getByRole('region', { name: 'Bloqueios' });
  await expect(bloqueios.getByText(/Suspensão cautelar em vigor — medida cautelar do TCU nº 7001\/2026/)).toBeVisible();
  const avancar = await planejamento.request.post(`/api/v1/processos/${processo.id}/avancar`, { headers: { 'x-agora-csrf': await csrf(planejamento) } });
  expect(avancar.status()).toBe(422);
  expect(JSON.stringify(await avancar.json())).toContain('RN-30');

  // Revogação registrada pelo controle interno libera o processo.
  await linha.getByRole('button', { name: 'Detalhes da medida nº 7001/2026' }).click();
  const detalhe = page.getByRole('dialog', { name: 'Medida cautelar do TCU nº 7001/2026' });
  await expect(detalhe.getByText('Suspensão cautelar em vigor (RN-30)')).toBeVisible();
  await detalhe.getByRole('button', { name: 'Revogação', exact: true }).click();
  await detalhe.getByRole('textbox', { name: /^Decisão de revogação ou de mérito/ }).fill('Plenário revogou a cautelar após as informações do órgão.');
  await detalhe.getByRole('button', { name: 'Registrar revogação', exact: true }).click();
  await esperarAviso(page, 'Registro concluído');
  await expect(detalhe.getByText('Suspensão cautelar em vigor (RN-30)')).toHaveCount(0);
  await expect(detalhe.getByText(/Medida revogada ou encerrada/)).toBeVisible();
  await detalhe.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(linha.getByText('Revogada')).toBeVisible();

  await planejamento.reload();
  await esperarPaginaOk(planejamento);
  await expect(planejamento.getByRole('region', { name: 'Bloqueios' }).getByText(/Suspensão cautelar em vigor/)).toHaveCount(0);
  const depois = await planejamento.request.post(`/api/v1/processos/${processo.id}/avancar`, { headers: { 'x-agora-csrf': await csrf(planejamento) } });
  expect(JSON.stringify(await depois.json())).not.toContain('RN-30');
  erros.verificar();
});

test('revisão trimestral da matriz de riscos vencida aparece no painel e é registrada no contrato', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  await page.goto('/controle');
  await esperarPaginaOk(page);
  const secao = page.getByRole('region', { name: 'Revisão trimestral da matriz de riscos' });
  const vencida = secao.getByRole('listitem').filter({ hasText: 'Revisão vencida' }).first();
  await expect(vencida).toBeVisible();
  const contrato = vencida.getByRole('link').first();
  const href = (await contrato.getAttribute('href')) ?? '';
  await contrato.click();
  await expect(page).toHaveURL(/\/contratos\/[0-9a-f-]{36}\?aba=riscos$/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('tab', { name: 'Matriz de riscos' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Revisão trimestral vencida', { exact: true })).toBeVisible();
  await verificarAcessibilidade(page, '/contratos/:id?aba=riscos');

  await page.getByRole('button', { name: 'Registrar revisão trimestral', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: /^Revisão trimestral da matriz de riscos/ });
  await expect(dialogo).toBeVisible();
  if ((await dialogo.getByRole('group', { name: /^Risco \d+/ }).count()) === 0) {
    await dialogo.getByRole('button', { name: 'Incluir risco', exact: true }).click();
    await dialogo.getByRole('textbox', { name: /^Descrição do risco/ }).fill('Atraso na entrega pelo contratado');
    await dialogo.getByRole('textbox', { name: /^Tratamento/ }).fill('Cronograma com marcos e multa moratória prevista.');
  }
  await dialogo.getByRole('textbox', { name: /^Observação da revisão/ }).fill('Revisão trimestral feita com a equipe de fiscalização; riscos reavaliados sem alteração relevante.');
  await verificarAcessibilidade(page, 'revisão da matriz de riscos', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar revisão', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Revisão registrada');
  await expect(page.getByText('Revisão em dia', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Revisão de \d{2}\/\d{2}\/\d{4}$/).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText(/Registrou a revisão trimestral da matriz de riscos/).first()).toBeVisible();

  await page.goto('/controle');
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { name: 'Revisão trimestral da matriz de riscos' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Revisão trimestral da matriz de riscos' }).locator(`a[href="${href}"]`)).toHaveCount(0);
  erros.verificar();
});
