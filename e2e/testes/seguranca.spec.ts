import { expect, test } from '@playwright/test';
import { entrar } from './apoio.ts';

test('cabeçalhos de segurança no documento e na API', async ({ request }) => {
  const doc = await request.get('/');
  const csp = doc.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(doc.headers()['x-frame-options']).toBe('DENY');
  expect(doc.headers()['x-content-type-options']).toBe('nosniff');
  const api = await request.get('/api/v1/configuracao-publica');
  expect(api.headers()['cache-control']).toContain('no-store');
  expect(api.headers()['access-control-allow-origin']).toBeUndefined();
});

test('sessão em cookie HttpOnly e nada de negócio no armazenamento do navegador', async ({ page, context }) => {
  await entrar(page, 'gestor');
  await page.goto('/contratos');
  const cookies = await context.cookies();
  const sessao = cookies.find((c) => c.name === 'agora_sessao');
  expect(sessao?.httpOnly).toBe(true);
  expect(sessao?.sameSite).toBe('Strict');
  const chaves = await page.evaluate(() => Object.keys(window.localStorage));
  expect(chaves).toEqual([]);
});

test('escrita sem cabeçalho CSRF é recusada', async ({ page }) => {
  await entrar(page, 'gestor');
  const resposta = await page.request.post('/api/v1/pendencias/00000000-0000-4000-8000-000000000000/resolver', {
    data: { observacao: 'teste sem csrf' },
  });
  expect(resposta.status()).toBe(403);
});
