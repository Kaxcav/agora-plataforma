/**
 * Roteiros da prova de conceito (PoC) previstos no termo de referência do cliente, reproduzidos com dados sintéticos.
 * Cada teste usa o processo que estiver na etapa exigida no momento da execução, para não depender da ordem dos arquivos.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ProcessoLista {
  id: string;
  etapaAtual: number;
  titulo: string;
}

async function processoNaEtapa(page: Page, etapa: number): Promise<ProcessoLista | undefined> {
  const resposta = await page.request.get('/api/v1/processos?tamanhoPagina=100');
  const corpo = (await resposta.json()) as { itens: ProcessoLista[] };
  return corpo.itens.find((p) => p.etapaAtual === etapa);
}

// 8 amostras: 6 coerentes, 1 com sobrepreço evidente e 1 manifestamente inexequível.
const CESTA_POC_02 = [
  'fonte;identificacao;valor_unitario;data_cotacao;justificativa',
  'painel_precos;Painel de Preços — referência A;10.000,00;01/10/2026;',
  'painel_precos;Painel de Preços — referência B;10.200,00;03/10/2026;',
  'contratacao_similar;Contrato similar 1;9.800,00;15/09/2026;',
  'contratacao_similar;Contrato similar 2;10.100,00;20/09/2026;',
  'fornecedor_direto;Fornecedor fictício A;9.950,00;10/10/2026;Atua no ramo e enviou proposta formal',
  'nota_fiscal;NF-e fictícia 1;10.050,00;05/10/2026;',
  'fornecedor_direto;Fornecedor fictício B;25.000,00;12/10/2026;Atua no ramo e enviou proposta formal',
  'midia_especializada;Publicação especializada;3.000,00;08/10/2026;',
].join('\r\n');

test('PoC-02 — cesta de 8 amostras importada por planilha, 2 valores fora da curva apontados e expurgados com justificativa', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const processo = await processoNaEtapa(page, 3);
  test.skip(!processo, 'nenhum processo na etapa 3 nos dados sintéticos');
  await page.goto(`/jornada/${processo?.id ?? ''}`);
  await esperarPaginaOk(page);

  await page.getByRole('button', { name: 'Importar planilha', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Importar cotações de planilha' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Arquivo da planilha').setInputFiles({ name: 'cesta-poc.csv', mimeType: 'text/csv', buffer: Buffer.from(CESTA_POC_02, 'utf-8') });
  await expect(dialogo.getByRole('textbox', { name: /^Conteúdo da planilha/ })).toHaveValue(/Fornecedor fictício B/);
  await dialogo.getByRole('radio', { name: 'Substituir as cotações atuais' }).check();
  await dialogo.getByRole('button', { name: 'Conferir planilha', exact: true }).click();
  await expect(dialogo.getByText('8 linha(s) válida(s) e 0 com erro.')).toBeVisible();
  await verificarAcessibilidade(page, 'importação da cesta (prévia)', 'dialog[open]');

  await dialogo.getByRole('button', { name: 'Importar 8 cotação(ões)', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Cotações importadas');

  const expurgos = page.getByRole('group', { name: 'Expurgos sugeridos (RIA-03)' });
  await expect(expurgos.getByRole('checkbox')).toHaveCount(2);
  await expurgos.getByRole('button', { name: 'Marcar todas as sugestões', exact: true }).click();
  await expect(expurgos.getByRole('checkbox', { checked: true })).toHaveCount(2);
  await expurgos
    .getByRole('textbox', { name: /^Justificativa da exclusão/ })
    .fill('Um preço está muito acima e outro muito abaixo da mediana da cesta, fora do intervalo estatístico (IN SEGES/ME 65/2021).');
  await expurgos.getByRole('button', { name: 'Aceitar 2 expurgos', exact: true }).click();
  const confirmar = page.getByRole('dialog', { name: 'Confirmar expurgo de preços' });
  await confirmar.getByRole('button', { name: 'Confirmar expurgo', exact: true }).click();
  await expect(confirmar).toBeHidden();
  await esperarAviso(page, 'Expurgo registrado');
  await expect(expurgos).toHaveCount(0);
  erros.verificar();
});

test('PoC-05 (parte pública) — inteiro teor do edital publicado em PDF, sem cadastro nem login', async ({ page }) => {
  const erros = monitorarErros(page);
  await page.goto('/transparencia/editais');
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/transparencia/editais');
  await page.getByRole('table', { name: /Editais publicados/ }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/transparencia\/editais\/[0-9a-f-]{36}$/);
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/transparencia/editais/:id');
  const documentos = page.getByRole('region', { name: 'Inteiro teor' }).getByRole('link');
  await expect(documentos).toHaveCount(3);
  const href = await documentos.first().getAttribute('href');
  const pdf = await page.request.get(href ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');
  erros.verificar();
});
