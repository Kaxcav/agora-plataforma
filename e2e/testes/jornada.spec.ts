import { expect, test } from '@playwright/test';
import { entrar, esperarPaginaOk, verificarAcessibilidade } from './apoio.ts';

test('agente abre um processo, vê as 7 etapas e a etapa atual', async ({ page }) => {
  await entrar(page, 'agente');
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.locator('main a[href^="/jornada/"]').first().click();
  await esperarPaginaOk(page);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await verificarAcessibilidade(page, '/jornada/:id');
});

test('avançar etapa com regra pendente mostra os bloqueios', async ({ page }) => {
  await entrar(page, 'agente');
  const lista = await page.request.get('/api/v1/processos?tamanhoPagina=50');
  const corpo = (await lista.json()) as { itens: { id: string; bloqueios: number; etapaAtual: number }[] };
  const bloqueado = corpo.itens.find((p) => p.bloqueios > 0 && p.etapaAtual < 7);
  test.skip(!bloqueado, 'nenhum processo com bloqueio nos dados sintéticos');
  await page.goto(`/jornada/${bloqueado?.id ?? ''}`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: /^Avançar para a etapa/ }).first().click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Avançar etapa' }).click();
  // Qualquer regra do catálogo (RN, RF ou RIA): depende de qual processo ainda tem bloqueio.
  await expect(page.getByRole('alert').filter({ hasText: /(?:RN|RF|RIA)-\d{2}/ }).first()).toBeVisible();
});
