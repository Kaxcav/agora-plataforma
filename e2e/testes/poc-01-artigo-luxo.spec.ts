/**
 * Roteiro PoC-01 do termo de referência do cliente, com dados sintéticos: DFD com item de luxo → tentar gerar a
 * minuta → bloqueado no servidor, com mensagem clara na tela → justificar (ou remover o item) → a minuta é gerada.
 * O processo é criado no próprio teste, para não depender da ordem dos arquivos.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

/** Gera uma minuta pela API, como a interface faria, com o token CSRF da sessão. */
async function gerarPelaApi(page: Page, processoId: string, tipo: string): Promise<{ status: number; corpo: string }> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const r = await page.request.post(`/api/v1/processos/${processoId}/documentos/gerar`, { data: { tipo }, headers: { 'x-agora-csrf': sessao.csrfToken } });
  return { status: r.status(), corpo: await r.text() };
}

test('PoC-01 — item de luxo no DFD bloqueia a geração de minutas até a justificativa ou a remoção do item', async ({ page }) => {
  test.setTimeout(120_000);
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]{36}\/documentos\/gerar$/);
  await entrar(page, 'planejamento');
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Novo processo', exact: true }).first().click();
  const novo = page.getByRole('dialog', { name: 'Novo processo de contratação' });
  await novo.getByRole('textbox', { name: /^Objeto/ }).fill('Aquisição de mobiliário para a sala de monitoramento integrado (roteiro PoC-01)');
  await novo.getByRole('combobox', { name: /^Órgão requisitante/ }).selectOption('PF');
  await novo.getByRole('button', { name: 'Criar processo', exact: true }).click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);
  const processoId = page.url().split('/jornada/')[1]?.split(/[?#]/)[0] ?? '';

  // DFD simulado com um item de luxo.
  await page.getByRole('textbox', { name: /^Descrição da necessidade/ }).fill('Mobiliar a sala de monitoramento integrado para a operação contínua em turnos de 12 horas.');
  await page.getByRole('textbox', { name: /^Justificativa da contratação/ }).fill('A sala entra em operação no próximo trimestre e não dispõe de mobiliário adequado aos operadores.');
  await page.getByRole('button', { name: 'Adicionar item', exact: true }).click();
  await page.getByRole('textbox', { name: 'Descrição do item 1' }).fill('Poltrona premium revestida em couro legítimo para operador');
  await page.getByRole('spinbutton', { name: 'Quantidade do item 1' }).fill('12');
  const valor = page.getByRole('textbox', { name: 'Valor unitário estimado do item 1' });
  await valor.fill('4.200,00');
  await valor.press('Enter');
  await expect(page.getByText('Indício de artigo de luxo em 1 item (RN-01)')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar DFD', exact: true }).click();
  await esperarAviso(page, 'DFD salvo');
  await esperarFocoPreservado(page);

  // Tentar gerar: bloqueio imediato no servidor, com a regra e a orientação na tela.
  const formalizacao = page.getByRole('region', { name: 'Formalização' });
  await expect(formalizacao.getByText('Geração de minutas bloqueada: indício de artigo de luxo sem justificativa (RN-01)')).toBeVisible();
  await formalizacao.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  const erro = formalizacao.getByRole('alert').filter({ hasText: 'Não foi possível gerar o documento' });
  await expect(erro).toBeVisible();
  await expect(erro).toContainText('RN-01');
  await expect(erro).toContainText('Geração de minutas bloqueada: indício de artigo de luxo sem justificativa aceita no item 1');
  await expect(formalizacao.getByText('Não gerado', { exact: true })).toBeVisible();
  await verificarAcessibilidade(page, 'PoC-01 — geração bloqueada');
  // ETP e TR também são recusados (inclusive se a IA do órgão estiver ligada: a trava vem antes dela).
  for (const tipo of ['etp', 'tr']) {
    const r = await gerarPelaApi(page, processoId, tipo);
    expect(r.status, tipo).toBe(422);
    expect(r.corpo).toContain('RN-01');
  }

  // Justificar: a minuta é gerada.
  await page
    .getByRole('textbox', { name: /^Justificativa — bem de qualidade comum/ })
    .fill('Poltrona de uso contínuo em turnos de 12 horas; o revestimento é o comum de mercado para uso intensivo, sem atributo de luxo.');
  await page.getByRole('button', { name: 'Salvar DFD', exact: true }).click();
  await esperarAviso(page, 'DFD salvo');
  await expect(formalizacao.getByText('Geração de minutas bloqueada: indício de artigo de luxo sem justificativa (RN-01)')).toHaveCount(0);
  await formalizacao.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  await esperarAviso(page, 'Rascunho gerado');
  await expect(page.getByRole('heading', { level: 4, name: 'Documento de formalização da demanda (DFD) — versão 1' })).toBeVisible();
  expect((await gerarPelaApi(page, processoId, 'etp')).status).toBe(200);

  // Remover o item de luxo (sem justificativa): a geração continua liberada.
  await page.getByRole('textbox', { name: 'Descrição do item 1' }).fill('Cadeira giratória com regulagem de altura para operador');
  await page.getByRole('textbox', { name: /^Justificativa — bem de qualidade comum/ }).fill('');
  await page.getByRole('button', { name: 'Salvar DFD', exact: true }).click();
  await esperarAviso(page, 'DFD salvo');
  await formalizacao.getByRole('button', { name: 'Gerar nova versão', exact: true }).click();
  await expect(page.getByRole('heading', { level: 4, name: 'Documento de formalização da demanda (DFD) — versão 2' })).toBeVisible();
  erros.verificar();
});
