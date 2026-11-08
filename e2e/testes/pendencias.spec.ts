import { expect, test } from '@playwright/test';
import { entrar, esperarPaginaOk } from './apoio.ts';

test('gestor resolve uma pendência com observação e desfaz', async ({ page }) => {
  await entrar(page, 'gestor');
  await page.goto('/');
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: /^Resolver/ }).first().click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('textbox').fill('Saldo conferido com o fiscal do contrato.');
  await dialogo.getByRole('button', { name: /Resolver|Confirmar/ }).click();
  const desfazer = page.getByRole('button', { name: 'Desfazer' });
  await expect(desfazer).toBeVisible();
  await desfazer.click();
  await expect(page.getByText(/reaberta|desfeit/i).first()).toBeVisible();
});
