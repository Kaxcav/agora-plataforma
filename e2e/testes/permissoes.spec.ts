import { expect, test } from '@playwright/test';
import { entrar } from './apoio.ts';

test('perfil consulta não vê administração e recebe "sem permissão" no acesso direto', async ({ page }) => {
  await entrar(page, 'consulta');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(menu.getByRole('link', { name: /Usuários/ })).toHaveCount(0);
  await page.goto('/admin/usuarios');
  await expect(page.getByText(/permissão/i).first()).toBeVisible();
});

test('perfil consulta só enxerga as UASGs do seu escopo', async ({ page }) => {
  await entrar(page, 'consulta');
  const resposta = await page.request.get('/api/v1/contratos?tamanhoPagina=100');
  const corpo = (await resposta.json()) as { itens: { uasg: { codigo: string } }[] };
  const uasgs = new Set(corpo.itens.map((c) => c.uasg.codigo));
  expect(uasgs.size).toBeGreaterThan(0);
  expect([...uasgs].every((u) => u === '910001' || u === '920001')).toBe(true);
});
