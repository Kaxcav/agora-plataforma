/**
 * Fluxos de conta: senha temporária gerada pela administração (troca obrigatória no primeiro acesso) e troca
 * voluntária pelo menu do usuário. Cada teste usa um usuário de demonstração que nenhum outro teste usa.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, SENHA, verificarAcessibilidade } from './apoio.ts';

async function entrarCom(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByRole('textbox', { name: /^E-mail institucional/ }).fill(email);
  await page.getByRole('textbox', { name: /^Senha/ }).fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function sair(page: Page): Promise<void> {
  await page.getByRole('button', { name: /dados da sessão/ }).click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar|\/transparencia/);
}

async function preencherTroca(page: Page, atual: string, nova: string, confirmacao = nova): Promise<void> {
  await page.getByRole('textbox', { name: /^Senha atual/ }).fill(atual);
  await page.getByRole('textbox', { name: /^Nova senha/ }).fill(nova);
  await page.getByRole('textbox', { name: /^Confirmar nova senha/ }).fill(confirmacao);
  await page.getByRole('button', { name: 'Trocar senha', exact: true }).click();
}

test('administrador gera senha temporária; no primeiro acesso a troca é obrigatória e depois o usuário entra na Ágora', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.goto('/admin/usuarios');
  await esperarPaginaOk(page);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('Paulo Henrique');
  const gerar = page.getByRole('button', { name: 'Gerar senha temporária para Paulo Henrique Siqueira' });
  await gerar.click();
  const confirmar = page.getByRole('dialog', { name: 'Gerar senha temporária' });
  await confirmar.getByRole('button', { name: 'Gerar senha temporária', exact: true }).click();
  const gerada = page.getByRole('dialog', { name: 'Senha temporária gerada' });
  await expect(gerada).toBeVisible();
  const temporaria = ((await gerada.locator('code').textContent()) ?? '').trim();
  expect(temporaria.length).toBeGreaterThanOrEqual(12);
  await verificarAcessibilidade(page, 'senha temporária gerada');
  await gerada.getByRole('button', { name: 'Concluído', exact: true }).click();
  await expect(gerada).toBeHidden();
  await expect(gerar).toBeFocused();
  await sair(page);

  // Primeiro acesso com a senha temporária: só a troca de senha fica disponível.
  await entrarCom(page, 'auditor@agora.demo', temporaria);
  await expect(page).toHaveURL(/\/trocar-senha/);
  await expect(page.getByText('Troca de senha obrigatória')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toHaveCount(0);
  await page.goto('/auditoria');
  await expect(page).toHaveURL(/\/trocar-senha/);
  await verificarAcessibilidade(page, '/trocar-senha (obrigatória)');

  const nova = 'Auditoria segura de 2026';
  await preencherTroca(page, temporaria, nova);
  await esperarAviso(page, 'Senha alterada');
  await expect(page).not.toHaveURL(/\/trocar-senha/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeVisible();
  await page.goto('/auditoria');
  await esperarPaginaOk(page);
  await expect(page).toHaveURL(/\/auditoria/);
  await sair(page);

  // A senha temporária deixa de valer (401 na entrada, já admitido) e a nova senha funciona.
  await entrarCom(page, 'auditor@agora.demo', temporaria);
  await expect(page.getByText(/E-mail ou senha inválidos/i)).toBeVisible();
  await entrarCom(page, 'auditor@agora.demo', nova);
  await expect(page).not.toHaveURL(/\/entrar|\/trocar-senha/);
  await esperarPaginaOk(page);
  erros.verificar();
});

test('troca voluntária de senha pelo menu do usuário, com senha atual errada recusada', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'fiscal');
  await page.goto('/contratos');
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: /dados da sessão/ }).click();
  await page.getByRole('link', { name: 'Trocar senha', exact: true }).click();
  await expect(page).toHaveURL(/\/trocar-senha/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trocar senha');
  await expect(page.getByText('Troca de senha obrigatória')).toHaveCount(0);
  await verificarAcessibilidade(page, '/trocar-senha (voluntária)');

  const nova = 'Fiscalizacao diaria 2026';
  erros.permitir(401, /\/api\/v1\/sessao\/senha$/);
  await preencherTroca(page, 'senha-errada-123', nova);
  const atual = page.getByRole('textbox', { name: /^Senha atual/ });
  await expect(page.getByText('A senha atual não confere.')).toBeVisible();
  await expect(atual).toBeFocused();
  await expect(atual).toHaveValue('');

  await preencherTroca(page, SENHA, nova);
  await esperarAviso(page, 'Senha alterada');
  await expect(page).toHaveURL(/\/contratos/);
  await esperarPaginaOk(page);
  await sair(page);

  await entrarCom(page, 'fiscal@agora.demo', nova);
  await expect(page).not.toHaveURL(/\/entrar/);
  await esperarPaginaOk(page);
  erros.verificar();
});
