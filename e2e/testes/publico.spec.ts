import { expect, test } from '@playwright/test';
import { esperarPaginaOk, verificarAcessibilidade } from './apoio.ts';

const PUBLICAS = ['/transparencia', '/privacidade', '/acessibilidade', '/regras', '/entrar'];

for (const rota of PUBLICAS) {
  test(`página pública ${rota} abre sem login, sem terceiros e acessível`, async ({ page, baseURL }) => {
    const externas: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith(baseURL ?? '') && !req.url().startsWith('data:')) externas.push(req.url());
    });
    await page.goto(rota);
    await esperarPaginaOk(page);
    expect(externas, 'o navegador não pode chamar serviços de terceiros').toEqual([]);
    await verificarAcessibilidade(page, rota);
  });
}

test('transparência lista contratos sem dados pessoais em claro', async ({ page }) => {
  await page.goto('/transparencia');
  await esperarPaginaOk(page);
  const texto = await page.locator('main').innerText();
  expect(texto).not.toMatch(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/); // CPF completo
  expect(texto).not.toMatch(/@[a-z0-9-]+\.[a-z.]+/i); // e-mail
});
