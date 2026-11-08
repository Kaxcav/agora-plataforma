import { expect, test } from '@playwright/test';
import { entrar } from './apoio.ts';

test('primeiro Tab foca o link de salto, que leva ao conteúdo', async ({ page }) => {
  await entrar(page, 'gestor');
  await page.goto('/contratos');
  await page.keyboard.press('Tab');
  const salto = page.getByRole('link', { name: 'Ir para o conteúdo principal' });
  await expect(salto).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#conteudo')).toBeFocused();
});

test('em celular o menu vira gaveta e fecha com Esc', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await entrar(page, 'gestor');
  const botao = page.getByRole('button', { name: 'Menu', exact: true });
  await botao.click();
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(botao).toBeFocused();
});
