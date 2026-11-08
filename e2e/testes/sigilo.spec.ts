/**
 * Sigilo de segurança pública (F25: RN-40, RF-33 e RNF-09) com dados sintéticos: o planejamento classifica o termo de
 * referência de um edital publicado como reservado — ele some da transparência e fica retido fora da fila do PNCP; o
 * jurídico, sem credencial, é negado; o auditor do controle externo acessa o PDF marcado e o acesso fica registrado. Na
 * tela da trilha, a ancoragem (modo offline: registro local) é feita e verificada.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

async function processoPublicado(page: Page): Promise<string> {
  const resposta = await page.request.get('/api/v1/processos?busca=P25&tamanhoPagina=10');
  const { itens } = (await resposta.json()) as { itens: { id: string }[] };
  const id = itens[0]?.id;
  expect(id, 'processo sintético com edital publicado').toBeTruthy();
  return id ?? '';
}

function daquiAUmAno(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

async function abrirSigilo(page: Page, id: string): Promise<void> {
  await page.goto(`/jornada/${id}/sigilo`);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sigilo do processo');
}

async function pedirPdfMarcado(page: Page, motivo: string): Promise<void> {
  await page.getByRole('button', { name: 'PDF marcado Termo de referência', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'PDF marcado: Termo de referência' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('textbox', { name: /^Motivo do acesso/ }).fill(motivo);
  await dialogo.getByRole('button', { name: 'Registrar e baixar', exact: true }).click();
}

test('documento reservado: some da transparência e da fila do PNCP; sem credencial é negado; o auditor acessa e fica registrado', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await processoPublicado(page);
  const antes = (await (await page.request.get(`/api/v1/publico/editais/${id}`)).json()) as { documentos: { tipo: string }[] };
  expect(antes.documentos.map((d) => d.tipo)).toContain('tr');

  // Tela de sigilo, a partir do processo.
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  await page.getByRole('link', { name: 'Sigilo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/jornada/${id}/sigilo$`));
  await esperarPaginaOk(page);
  await expect(page.getByText('Você não tem credencial neste processo')).toBeVisible();
  await verificarAcessibilidade(page, '/jornada/:id/sigilo');

  // Classificação do termo de referência como reservado (LAI), com hipótese, razões, prazo e autoridade.
  await page.getByRole('button', { name: 'Classificar Termo de referência', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Classificar: Termo de referência' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('radio', { name: /^Reservada/ })).toBeChecked();
  await dialogo.getByRole('combobox', { name: /^Hipótese de sigilo/ }).selectOption('VIII');
  await dialogo
    .getByRole('textbox', { name: /^Razões da classificação/ })
    .fill('Especificações técnicas dos rádios revelam a capacidade de comunicação das operações policiais em curso.');
  await dialogo.getByLabel(/^Sigiloso até/).fill(daquiAUmAno());
  await dialogo.getByRole('textbox', { name: /^Nome da autoridade/ }).fill('Autoridade Sintética de Logística');
  await dialogo.getByRole('textbox', { name: /^Cargo/ }).fill('Diretor de Logística');
  await dialogo.getByRole('combobox', { name: /^Competência/ }).selectOption('direcao_das_101_5');
  await verificarAcessibilidade(page, 'classificação de documento', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Classificar', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Classificação registrada');
  const linhaTr = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Termo de referência/ }) });
  await expect(linhaTr).toContainText('Reservada até');
  await expect(page.getByText(/Você tem credencial neste processo até o grau reservada/)).toBeVisible();

  // Fila do PNCP: o termo de referência aparece retido por sigilo nos envios da etapa de publicação.
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  const envios = page.getByRole('region', { name: 'Envios ao PNCP' });
  await expect(envios.getByText('Retidos por sigilo, não enviados ao PNCP:')).toBeVisible();
  await expect(envios.getByText('Termo de referência', { exact: true })).toBeVisible();

  // Transparência, sem login: o termo de referência não aparece e o PDF responde 404.
  await page.context().clearCookies();
  await page.goto(`/transparencia/editais/${id}`);
  await esperarPaginaOk(page);
  await expect(page.getByText('Documentos sigilosos não divulgados')).toBeVisible();
  await expect(page.getByRole('link', { name: /Termo de referência/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Edital/ }).first()).toBeVisible();
  expect((await page.request.get(`/api/v1/publico/editais/${id}/documentos/tr`)).status()).toBe(404);
  await verificarAcessibilidade(page, '/transparencia/editais/:id com documento sigiloso');

  // Jurídico, sem credencial: o pedido do PDF é negado pelo servidor e registrado.
  await entrar(page, 'juridico');
  erros.permitir(403, new RegExp(`/api/v1/processos/${id}/sigilo/documentos/tr/pdf$`));
  await abrirSigilo(page, id);
  await pedirPdfMarcado(page, 'Leitura do termo de referência para o parecer');
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível concluir' })).toContainText('não tem credencial');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.context().clearCookies();

  // Auditor do controle externo: acesso irrestrito ao PDF marcado, com o motivo registrado.
  await entrar(page, 'auditoria.externa');
  await abrirSigilo(page, id);
  await expect(page.getByText('Você acessa como órgão de controle')).toBeVisible();
  const download = page.waitForEvent('download');
  await pedirPdfMarcado(page, 'Auditoria de conformidade do controle externo');
  expect((await download).suggestedFilename()).toMatch(/-sigiloso\.pdf$/);
  await esperarAviso(page, 'Acesso registrado');
  const acessos = page.getByRole('table', { name: /^Acessos registrados/ });
  await expect(acessos.getByRole('row').filter({ hasText: 'Auditoria de conformidade do controle externo' })).toContainText('Órgão de controle');
  await expect(acessos.getByRole('row').filter({ hasText: 'Leitura do termo de referência para o parecer' })).toContainText('Negado: sem credencial');
  await verificarAcessibilidade(page, 'registro de acessos');
  erros.verificar();
});

test('carimbo de tempo da trilha: ancoragem registrada e verificada na tela da trilha', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.goto('/auditoria');
  await esperarPaginaOk(page);
  const secao = page.getByRole('region', { name: 'Carimbo de tempo da trilha' });
  await expect(secao.getByText(/Modo offline/)).toBeVisible();
  await secao.getByRole('button', { name: 'Ancorar agora', exact: true }).click();
  await esperarAviso(page, 'Trilha ancorada');
  await expect(secao.getByRole('table', { name: 'Ancoragens mais recentes' }).getByText('Local (offline)').first()).toBeVisible();
  await secao.getByRole('button', { name: 'Verificar ancoragens', exact: true }).click();
  await expect(secao.getByText('Ancoragens íntegras')).toBeVisible();
  await expect(secao.getByText(/sem carimbo de terceiro/)).toBeVisible();
  await verificarAcessibilidade(page, '/auditoria com ancoragem');
  erros.verificar();
});
