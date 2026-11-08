/**
 * Política de sustentabilidade do órgão (RN-21): ligada por padrão, alterável só pelo administrador com justificativa
 * registrada na trilha de auditoria. O teste desliga e religa a política, deixando-a como encontrou.
 */
import { expect, test } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

test('RN-21 — administrador desliga e religa a política, com justificativa e evento na trilha', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Políticas do órgão', exact: true }).click();
  await expect(page).toHaveURL(/\/ajustes\/politicas$/);
  await esperarPaginaOk(page);
  const secao = page.getByRole('region', { name: 'Sustentabilidade ambiental e logística reversa (RN-21)' });
  await expect(secao.getByText('Ligada', { exact: true })).toBeVisible();
  await verificarAcessibilidade(page, '/ajustes/politicas');

  const alternador = secao.getByRole('switch', { name: /^Exigir critérios de sustentabilidade/ });
  await alternador.click();
  await secao.getByRole('button', { name: 'Salvar política', exact: true }).click();
  await expect(secao.getByText(/Justifique a alteração em pelo menos 20 caracteres/)).toBeVisible();
  await secao.getByRole('textbox', { name: /^Justificativa da alteração/ }).fill('Teste sintético de alteração da política, desfeito em seguida.');
  await secao.getByRole('button', { name: 'Salvar política', exact: true }).click();
  await esperarAviso(page, 'Política alterada');
  await expect(secao.getByText('Desligada', { exact: true })).toBeVisible();

  await secao.getByRole('switch', { name: /^Exigir critérios de sustentabilidade/ }).click();
  await secao.getByRole('textbox', { name: /^Justificativa da alteração/ }).fill('Política religada: critérios obrigatórios no ETP e no TR.');
  await secao.getByRole('button', { name: 'Salvar política', exact: true }).click();
  await expect(secao.getByText('Ligada', { exact: true })).toBeVisible();

  const trilha = await page.request.get('/api/v1/auditoria?acao=politica.sustentabilidade.alterar');
  const corpo = (await trilha.json()) as { total: number; itens: { resumo: string }[] };
  expect(corpo.total).toBeGreaterThanOrEqual(2);
  expect(corpo.itens.map((e) => e.resumo).join(' ')).toMatch(/Desligou a política de sustentabilidade/);
  erros.verificar();
});

test('RN-21 — o ETP mostra os critérios de sustentabilidade e a política vigente; o perfil de consulta não altera a política', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const lista = (await (await page.request.get('/api/v1/processos?tamanhoPagina=100')).json()) as { itens: { id: string; etapaAtual: number }[] };
  const processo = lista.itens.find((p) => p.etapaAtual === 3);
  test.skip(!processo, 'nenhum processo na etapa 3 nos dados sintéticos');
  await page.goto(`/jornada/${processo?.id ?? ''}`);
  await esperarPaginaOk(page);
  const secao = page.locator('#etapa-sustentabilidade-etp');
  await expect(secao.getByRole('heading', { level: 3, name: 'Sustentabilidade ambiental e logística reversa' })).toBeVisible();
  await expect(secao.getByText(/RN-21/).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Logística reversa/ })).toBeVisible();
  await verificarAcessibilidade(page, 'etapa 3 com critérios de sustentabilidade', '#etapa-sustentabilidade-etp');

  await page.goto('/ajustes/politicas');
  await esperarPaginaOk(page);
  await expect(page.getByText('Consulta somente leitura')).toBeVisible();
  await expect(page.getByRole('switch', { name: /^Exigir critérios de sustentabilidade/ })).toHaveCount(0);
  erros.verificar();
});
