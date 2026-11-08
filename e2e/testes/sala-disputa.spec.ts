/**
 * PoC-03 — sala de disputa simulada com 4 empresas, duas com sócio em comum (RF-22, RN-26, RIA-09 e RIA-06):
 * a sessão corre só com teclado, os licitantes ficam anônimos durante os lances, a sala mostra os sinais com
 * "requer revisão humana", encerra, emite a ata e registra o resultado na disputa do processo. Verificação axe.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

async function abrirProcesso(page: Page, busca: string, titulo: RegExp): Promise<void> {
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(busca);
  const link = page.getByRole('main').getByRole('link', { name: titulo });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);
}

/** Aciona o controle só com teclado: foco e Enter. */
async function pressionar(controle: Locator): Promise<void> {
  await controle.focus();
  await expect(controle).toBeFocused();
  await controle.press('Enter');
}

async function incluirParticipante(page: Page, busca: string, nome: RegExp): Promise<void> {
  const campo = page.getByRole('searchbox', { name: 'Buscar participante por razão social ou CNPJ' });
  await campo.fill(busca);
  const resultados = page.getByRole('list', { name: 'Fornecedores encontrados' });
  await pressionar(resultados.getByRole('button', { name: nome }));
  await expect(page.getByRole('list', { name: 'Participantes incluídos' }).getByText(busca, { exact: false })).toBeVisible();
}

test.describe('sala de disputa (PoC-03)', () => {
  test('simulação com 4 empresas: sinais de conluio, encerramento, ata e registro no processo', async ({ page }) => {
    test.setTimeout(120_000);
    const erros = monitorarErros(page);
    await entrar(page, 'agente');

    // O processo dos rádios está com o edital publicado e o prazo cumprido: passa à etapa 6.
    await abrirProcesso(page, 'rádios', /rádios digitais/i);
    await page.getByRole('button', { name: 'Avançar para a etapa 6', exact: true }).click();
    const avancar = page.getByRole('dialog', { name: /^Avançar para a etapa 6/ });
    await avancar.getByRole('button', { name: 'Avançar etapa', exact: true }).click();
    await esperarAviso(page, 'Etapa concluída');

    await pressionar(page.getByRole('link', { name: 'Abrir sala de disputa' }));
    await expect(page.getByRole('heading', { level: 1, name: 'Sala de disputa' })).toBeVisible();
    await esperarPaginaOk(page);
    await expect(page.getByText('Nenhuma sessão de disputa criada para este processo.')).toBeVisible();
    await verificarAcessibilidade(page, 'sala de disputa — nova sessão');

    // Nova sessão: simulação, menor preço, modo aberto, cenário de conluio e robô (PoC-03).
    await expect(page.getByRole('combobox', { name: 'Modo de disputa' }).locator('option')).toHaveText(['Aberto', 'Aberto e fechado', 'Fechado e aberto']);
    await page.getByRole('combobox', { name: 'Critério de julgamento' }).selectOption('tecnica_e_preco');
    await expect(page.getByRole('combobox', { name: 'Modo de disputa' }).locator('option')).toHaveText(['Fechado']);
    await page.getByRole('combobox', { name: 'Critério de julgamento' }).selectOption('menor_preco');
    await page.getByRole('combobox', { name: 'Cenário da simulação' }).selectOption('conluio_e_robo');
    await incluirParticipante(page, 'Vigilant', /^Incluir Vigilant/);
    await incluirParticipante(page, 'Ária', /^Incluir Ária/);
    await incluirParticipante(page, 'Atlas', /^Incluir Atlas/);
    await incluirParticipante(page, 'Sentinela', /^Incluir Sentinela/);
    await pressionar(page.getByRole('button', { name: 'Criar sessão', exact: true }));
    await esperarAviso(page, 'Sessão criada');

    const situacao = page.getByRole('heading', { level: 2, name: 'Simulação (treino)' });
    await expect(situacao).toBeVisible();
    await expect(page.getByText('Aguardando abertura', { exact: true })).toBeVisible();
    // Sócio em comum já aparece, sem identificar as empresas (sigilo durante os lances).
    await expect(page.getByText(/^Sócio em comum — Licitante \d e Licitante \d \(RIA-06\)$/)).toBeVisible();

    await pressionar(page.getByRole('button', { name: 'Abrir sessão', exact: true }));
    await esperarAviso(page, 'Sessão aberta');
    await expect(page.getByText('Etapa aberta de lances', { exact: true })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/);

    await pressionar(page.getByRole('button', { name: 'Adiantar 1 minuto', exact: true }));
    const lances = page.getByRole('table', { name: 'Lances, do mais recente ao mais antigo' });
    await expect(lances).toBeVisible();
    await expect(lances.getByRole('row').nth(1)).toContainText(/Licitante \d/);
    await expect(page.getByRole('main')).not.toContainText('Ária Telecomunicações');
    await verificarAcessibilidade(page, 'sala de disputa — etapa aberta de lances');

    // Avança até o fim da etapa (as prorrogações exigem mais de um avanço).
    const encerrada = page.getByText('Lances encerrados', { exact: true });
    const avancarFim = page.getByRole('button', { name: 'Avançar até o fim da etapa', exact: true });
    for (let i = 0; i < 5 && !(await encerrada.isVisible()); i++) {
      const resposta = page.waitForResponse((r) => r.url().endsWith('/relogio') && r.request().method() === 'POST');
      await pressionar(avancarFim);
      expect((await resposta).status()).toBe(200);
      await expect.poll(async () => (await encerrada.isVisible()) || ((await avancarFim.count()) > 0 && (await avancarFim.isEnabled()))).toBe(true);
    }
    await expect(encerrada).toBeVisible();

    // Identidades reveladas, sinais RIA-09 reforçados pelo RIA-06, sempre como sinal para revisão humana.
    const sinais = page.locator('section').filter({ has: page.getByRole('heading', { level: 3, name: /^Sinais para análise/ }) });
    const alternancia = sinais.locator('.alerta').filter({ hasText: 'Alternância de lances entre' }).first();
    await expect(alternancia).toContainText('Ária Telecomunicações Ltda.');
    await expect(alternancia).toContainText('Atlas Informática Robusta Ltda.');
    await expect(alternancia).toContainText('Reforçado por vínculo societário');
    await expect(alternancia).toContainText('requer revisão humana');
    await expect(sinais).toContainText(/Sócio em comum — (Ária Telecomunicações Ltda\.|Atlas Informática Robusta Ltda\.) e/);
    await expect(sinais).toContainText('Lances em intervalos regulares');
    const classificacao = page.getByRole('table', { name: 'Classificação da sessão' });
    await expect(classificacao.getByRole('row')).toHaveCount(5);
    await verificarAcessibilidade(page, 'sala de disputa — lances encerrados com sinais');

    await pressionar(page.getByRole('button', { name: 'Ver ata', exact: true }));
    await expect(page.getByText('Ata da sessão de disputa — simulação para treino')).toBeVisible();
    await expect(page.locator('.disputa-ata')).toContainText('requer revisão humana');

    await pressionar(page.getByRole('button', { name: 'Encerrar e registrar resultado', exact: true }));
    const dialogo = page.getByRole('dialog', { name: 'Encerrar a sessão e registrar o resultado' });
    await expect(dialogo).toBeVisible();
    await pressionar(dialogo.getByRole('button', { name: 'Encerrar e registrar', exact: true }));
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Sessão encerrada');
    await expect(page.getByText('Sessão concluída', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Resultado registrado no processo', { exact: true })).toBeVisible();
    await verificarAcessibilidade(page, 'sala de disputa — sessão concluída');

    // O resultado alimenta o registro da disputa da etapa 6, que mantém o sinal de sócio em comum.
    await pressionar(page.getByRole('link', { name: 'Ver o registro da disputa no processo' }));
    await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}\?etapa=6/);
    await esperarPaginaOk(page);
    await expect(page.getByText('Resultado registrado no processo', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Classificação' }).getByRole('row')).toHaveCount(5);
    await expect(page.getByText('Sinal para análise (RIA-06)').first()).toBeVisible();
    erros.verificar();
  });
});
