/**
 * Frente P — dotação orçamentária declarada (RN-39) e peças complementares da fase preparatória (RF-32), na interface:
 * o agente altera a dotação do processo dos drones (etapa 4), tenta avançar e é bloqueado, gera a declaração, a
 * portaria e a nota técnica à assessoria jurídica e confere o checklist; a autoridade competente designada (gestor)
 * aprova e assina a declaração e aprova a portaria. O TR e a minuta não são tocados: a jornada completa os regera.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

async function abrirDrones(page: Page): Promise<void> {
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('drones');
  const link = page.getByRole('main').getByRole('link', { name: /drones/i });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 2, name: 'TR, edital e minuta', exact: true })).toBeVisible();
}

function pecas(page: Page) {
  return page.getByRole('region', { name: 'Peças complementares da instrução' });
}

function peca(page: Page, rotulo: string) {
  return pecas(page).getByRole('listitem').filter({ has: page.getByText(rotulo, { exact: true }) });
}

async function gerar(page: Page, rotulo: string, titulo: string): Promise<void> {
  await peca(page, rotulo).getByRole('button', { name: /^Gerar (rascunho|nova versão)$/ }).click();
  await esperarAviso(page, 'Rascunho gerado');
  await expect(pecas(page).getByRole('heading', { level: 4, name: titulo })).toBeVisible();
}

async function aprovarAberto(page: Page): Promise<void> {
  await pecas(page).getByRole('button', { name: 'Aprovar', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Aprovar documento' });
  await dialogo.getByRole('checkbox', { name: /^Revisei integralmente o texto/ }).check();
  await dialogo.getByRole('button', { name: 'Aprovar documento', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Documento aprovado');
  await esperarFocoPreservado(page);
}

test.describe('dotação orçamentária e peças complementares da fase preparatória', () => {
  test('agente: altera a dotação, é bloqueado no avanço (RN-39), gera a declaração, a portaria e a nota técnica e confere o checklist', async ({ page }) => {
    const erros = monitorarErros(page);
    erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]{36}\/avancar$/);
    await entrar(page, 'agente');
    await abrirDrones(page);

    const dotacao = page.getByRole('region', { name: 'Dotação orçamentária' });
    await expect(dotacao.getByText('Declarada pela autoridade').first()).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 4 com a dotação declarada (drones)');

    // Novo pré-empenho: a dotação muda e a declaração anterior deixa de valer.
    const exercicio = await dotacao.getByRole('group', { name: 'Crédito 1' }).getByRole('textbox', { name: /^Exercício/ }).inputValue();
    await dotacao.getByRole('group', { name: 'Crédito 1' }).getByRole('textbox', { name: /^Pré-empenho/ }).fill(`${exercicio}PE009876`);
    await expect(dotacao.getByText('Há alterações não salvas na dotação.')).toBeVisible();
    await dotacao.getByRole('button', { name: 'Salvar dotação', exact: true }).click();
    await esperarAviso(page, 'Dotação salva');
    await expect(dotacao.getByText('Declaração desatualizada').first()).toBeVisible();
    await expect(dotacao).toContainText('Sem a dotação declarada, o processo não segue para o edital (RN-39)');
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('A dotação mudou depois da declaração');

    // RN-39: sem a dotação declarada, o processo permanece na etapa 4.
    await page.getByRole('button', { name: 'Avançar para a etapa 5', exact: true }).click();
    await page.getByRole('dialog', { name: /^Avançar para a etapa 5/ }).getByRole('button', { name: 'Avançar etapa', exact: true }).click();
    const falha = page.getByRole('alert').filter({ hasText: 'O processo permanece na etapa 4' });
    await expect(falha).toBeVisible();
    await expect(falha).toContainText('RN-39');
    await expect(falha).toContainText('A dotação mudou depois da declaração');

    // Nova declaração com a dotação atual: rascunho que só a autoridade aprova.
    await gerar(page, 'Declaração de adequação orçamentária', 'Declaração de adequação orçamentária — versão 2');
    const declaracao = pecas(page).getByRole('article', { name: 'Conteúdo: Declaração de adequação orçamentária' });
    await expect(declaracao).toContainText('DECLARO que a despesa decorrente desta contratação tem adequação orçamentária');
    await expect(declaracao).toContainText(`${exercicio}PE009876`);
    await expect(declaracao).not.toContainText('<!--');
    await expect(pecas(page).getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
    const pdf = await pecas(page).getByRole('link', { name: 'Baixar PDF' }).getAttribute('href');
    const resposta = await page.request.get(pdf ?? '');
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()['content-type']).toBe('application/pdf');
    expect((await resposta.body()).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    // Portaria de designação e nota técnica com quesitos à assessoria jurídica.
    await gerar(page, 'Portaria de designação da equipe e dos agentes', 'Portaria de designação da equipe e dos agentes — versão 1');
    const portaria = pecas(page).getByRole('article', { name: 'Conteúdo: Portaria de designação da equipe e dos agentes' });
    await expect(portaria).toContainText('PORTARIA Nº');
    await expect(portaria).toContainText('Agente de contratação');
    await expect(portaria).toContainText('segregação de funções');
    await gerar(page, 'Nota técnica à assessoria jurídica', 'Nota técnica à assessoria jurídica — versão 1');
    const nota = pecas(page).getByRole('article', { name: 'Conteúdo: Nota técnica à assessoria jurídica' });
    await expect(nota).toContainText('Quesitos ao controle prévio de legalidade');
    await expect(nota).toContainText('art. 150');
    await expect(nota).toContainText('não contém juízo jurídico');

    // Checklist das peças por etapa.
    await page.getByRole('button', { name: 'Ver checklist', exact: true }).click();
    const etapa4 = page.getByRole('table', { name: /^Etapa 4 — TR, edital e minuta/ });
    await expect(etapa4).toBeVisible();
    await expect(etapa4.getByRole('row', { name: /Declaração de adequação orçamentária/ })).toContainText('Em rascunho — versão 2');
    await expect(etapa4.getByRole('row', { name: /Termo de referência/ })).toContainText('Desatualizada');
    await expect(page.getByRole('table', { name: /^Etapa 2 — Instrução no SEI e equipe/ }).getByRole('row', { name: /Portaria de designação/ })).toContainText('Em rascunho — versão 1');
    await verificarAcessibilidade(page, 'etapa 4 com as peças e o checklist abertos (drones)');
    erros.verificar();
  });

  test('autoridade competente designada: aprova e assina a declaração e aprova a portaria; a dotação volta a valer', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'gestor');
    await abrirDrones(page);
    const dotacao = page.getByRole('region', { name: 'Dotação orçamentária' });
    await expect(dotacao.getByText('Declaração aguardando a autoridade').first()).toBeVisible();
    await expect(pecas(page).getByRole('button', { name: /^Gerar/ })).toHaveCount(0);

    await peca(page, 'Declaração de adequação orçamentária').getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(pecas(page).getByRole('heading', { level: 4, name: 'Declaração de adequação orçamentária — versão 2' })).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 4 — autoridade com a declaração aberta (drones)');
    await aprovarAberto(page);
    await expect(dotacao.getByText('Declarada pela autoridade').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bloqueios' })).not.toContainText('A dotação mudou depois da declaração');

    const arvore = page.getByRole('region', { name: 'Árvore do processo SEI' });
    await arvore.getByRole('button', { name: /^Assinar documento \d{8} — Declaração de Adequação Orçamentária — versão 2/ }).click();
    const assinar = page.getByRole('dialog', { name: 'Assinar documento (simulação)' });
    await assinar.getByRole('button', { name: 'Assinar (simulação)', exact: true }).click();
    await expect(assinar).toBeHidden();
    await esperarAviso(page, 'Assinatura registrada');

    await peca(page, 'Portaria de designação da equipe e dos agentes').getByRole('button', { name: 'Visualizar', exact: true }).click();
    await aprovarAberto(page);
    await expect(peca(page, 'Portaria de designação da equipe e dos agentes')).toContainText('Aprovado');
    erros.verificar();
  });
});
