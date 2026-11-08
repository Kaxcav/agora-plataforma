import { expect, test } from '@playwright/test';
import { entrar, esperarPaginaOk, verificarAcessibilidade } from './apoio.ts';

const LISTAS = ['/contratos', '/atas', '/fornecedores', '/jornada'];

for (const lista of LISTAS) {
  test(`detalhe a partir de ${lista}: abas por teclado e acessibilidade`, async ({ page }) => {
    await entrar(page, 'admin');
    await page.goto(lista);
    await esperarPaginaOk(page);
    await page.locator(`main a[href^="${lista}/"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${lista}/[0-9a-f-]{36}`));
    await esperarPaginaOk(page);
    const abas = page.getByRole('tab');
    if ((await abas.count()) > 1) {
      await abas.first().focus();
      await page.keyboard.press('ArrowRight');
      await expect(abas.nth(1)).toHaveAttribute('aria-selected', 'true');
      await esperarPaginaOk(page);
    }
    await verificarAcessibilidade(page, `${lista}/:id`);
  });
}
