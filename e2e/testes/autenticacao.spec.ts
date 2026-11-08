import { expect, test } from '@playwright/test';
import { entrar, SENHA } from './apoio.ts';

test('senha errada mostra mensagem genérica', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByRole('textbox', { name: /^E-mail institucional/ }).fill('gestor@agora.demo');
  await page.getByRole('textbox', { name: /^Senha/ }).fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(/E-mail ou senha inválidos/i)).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);
});

test('rota protegida sem sessão leva ao login e volta depois', async ({ page }) => {
  await page.goto('/contratos');
  await expect(page).toHaveURL(/\/entrar/);
  await page.getByRole('textbox', { name: /^E-mail institucional/ }).fill('gestor@agora.demo');
  await page.getByRole('textbox', { name: /^Senha/ }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/contratos/);
});

test('entrar e sair', async ({ page }) => {
  await entrar(page, 'gestor');
  await page.getByRole('button', { name: /dados da sessão/ }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar|\/transparencia/);
});
