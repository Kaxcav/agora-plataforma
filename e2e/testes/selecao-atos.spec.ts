/**
 * Atos da seleção na interface (etapa 6), com dados sintéticos: amostra exigida no edital com reprovação e convocação
 * automática do próximo colocado (RN-20), habilitação, registro de intenções encerrado sem manifestação (RN-22),
 * adjudicação e homologação pela autoridade competente designada e divulgação dos documentos preparatórios na página
 * pública do edital (RF-18). Usa o processo dos coletes balísticos, na etapa 6.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

const LINK_GRAVACAO = 'https://video.orgao.exemplo/sessoes/amostra-coletes-0001';

async function abrirColetes(page: Page): Promise<string> {
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('coletes');
  const link = page.getByRole('main').getByRole('link', { name: /coletes balísticos/i });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);
  return page.url().split('/jornada/')[1]?.split(/[?#]/)[0] ?? '';
}

test('etapa 6 — amostra reprovada e próximo convocado, habilitação, preclusão, adjudicação e homologação com divulgação pública', async ({ page }) => {
  test.setTimeout(150_000);
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  const id = await abrirColetes(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Seleção do fornecedor', exact: true })).toBeVisible();
  const atos = page.getByRole('region', { name: 'Atos da seleção' });
  await expect(atos.getByRole('heading', { level: 4, name: 'Painel da amostra (RN-20)' })).toBeVisible();
  await verificarAcessibilidade(page, 'etapa 6 — atos da seleção (coletes)', '#etapa6-atos');

  // RN-20: convoca o licitante provisoriamente vencedor e registra a reprovação com a gravação da sessão pública.
  await atos.getByRole('button', { name: /^Convocar Escudo Forte/ }).click();
  await esperarAviso(page, 'Licitante convocado');
  await esperarFocoPreservado(page);
  const resultado = atos.getByRole('form', { name: 'Resultado da amostra' });
  await resultado.getByRole('radio', { name: /^Reprovado/ }).check();
  await resultado.getByRole('textbox', { name: /^Motivação do resultado/ }).fill('A amostra não trouxe o certificado de conformidade exigido no item 1 do roteiro.');
  await resultado.getByRole('textbox', { name: /^Link da gravação/ }).fill(LINK_GRAVACAO);
  await resultado.getByRole('button', { name: 'Registrar resultado', exact: true }).click();
  await esperarAviso(page, /Boreal .* foi convocado automaticamente/);
  const tabela = atos.getByRole('table', { name: 'Convocações e resultados da amostra' });
  await expect(tabela.getByRole('row')).toHaveCount(3);
  await expect(tabela.getByRole('row').nth(2)).toContainText('convocado automaticamente');
  await expect(tabela.getByRole('link', { name: /^Abrir gravação/ })).toHaveAttribute('href', LINK_GRAVACAO);

  // Aprovado o próximo colocado, a habilitação abre a fase recursal única (RN-22).
  await resultado.getByRole('radio', { name: 'Aprovado', exact: true }).check();
  await resultado.getByRole('textbox', { name: /^Motivação do resultado/ }).fill('A amostra atendeu a todos os itens do roteiro, com ensaio aprovado em laboratório acreditado.');
  await resultado.getByRole('textbox', { name: /^Link da gravação/ }).fill(`${LINK_GRAVACAO}-b`);
  await resultado.getByRole('button', { name: 'Registrar resultado', exact: true }).click();
  await esperarAviso(page, 'Resultado registrado');
  const habilitacao = atos.getByRole('form', { name: 'Registro da habilitação' });
  await habilitacao.getByRole('radio', { name: 'Habilitado', exact: true }).check();
  await habilitacao.getByRole('textbox', { name: /^Motivação da habilitação/ }).fill('Documentos de habilitação jurídica, fiscal, trabalhista e técnica conferidos no SICAF.');
  await habilitacao.getByRole('button', { name: 'Registrar habilitação', exact: true }).click();
  await esperarAviso(page, 'Habilitação registrada');
  await expect(atos.getByText('Registro das intenções de recurso em aberto')).toBeVisible();
  await expect(atos.getByText('Razões até', { exact: true })).toBeVisible();
  await verificarAcessibilidade(page, 'etapa 6 — fase recursal (coletes)', '#etapa6-atos');

  await atos.getByRole('button', { name: 'Encerrar registro de intenções', exact: true }).click();
  const encerrar = page.getByRole('dialog', { name: 'Encerrar o registro de intenções' });
  await expect(encerrar).toContainText('preclus');
  await encerrar.getByRole('button', { name: 'Encerrar registro', exact: true }).click();
  await expect(encerrar).toBeHidden();
  await esperarAviso(page, 'Registro encerrado');
  await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('RF-18');
  // O agente não adjudica: o ato é da autoridade competente designada (art. 71).
  await expect(atos.getByRole('button', { name: 'Adjudicar o objeto', exact: true })).toHaveCount(0);
  erros.verificar();

  // Autoridade competente designada no processo (gestor de demonstração).
  await page.context().clearCookies();
  await entrar(page, 'gestor');
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  const atosAutoridade = page.getByRole('region', { name: 'Atos da seleção' });
  await atosAutoridade.getByRole('button', { name: 'Adjudicar o objeto', exact: true }).click();
  const adjudicar = page.getByRole('dialog', { name: 'Adjudicar o objeto' });
  await expect(adjudicar).toContainText('Boreal');
  await adjudicar.getByRole('button', { name: 'Adjudicar', exact: true }).click();
  await expect(adjudicar).toBeHidden();
  await esperarAviso(page, 'Objeto adjudicado');
  await atosAutoridade.getByRole('button', { name: 'Homologar a licitação', exact: true }).click();
  const homologar = page.getByRole('dialog', { name: 'Homologar a licitação' });
  await homologar.getByRole('textbox', { name: /^Observação/ }).fill('Homologação após a regularidade de todos os atos da seleção.');
  await homologar.getByRole('button', { name: 'Homologar', exact: true }).click();
  await expect(homologar).toBeHidden();
  await esperarAviso(page, 'Licitação homologada');
  await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('Nenhum bloqueio registrado');
  await verificarAcessibilidade(page, 'etapa 6 — homologada (coletes)', '#etapa6-atos');

  // RF-18 (art. 54, § 3º): os documentos preparatórios aparecem na página pública do edital, sem login.
  await page.context().clearCookies();
  await page.goto(`/transparencia/editais/${id}`);
  await esperarPaginaOk(page);
  const preparatorios = page.getByRole('region', { name: 'Documentos da fase preparatória' }).getByRole('link');
  await expect(preparatorios).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Inteiro teor' }).getByRole('link')).toHaveCount(3);
  const href = await preparatorios.first().getAttribute('href');
  const pdf = await page.request.get(href ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  await verificarAcessibilidade(page, '/transparencia/editais/:id com documentos preparatórios');

  // O agente avança para a etapa 7: o contrato vai ao adjudicatário.
  await entrar(page, 'agente');
  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Avançar para a etapa 7', exact: true }).click();
  const avancar = page.getByRole('dialog', { name: /^Avançar para a etapa 7 — / });
  await avancar.getByRole('button', { name: 'Avançar etapa', exact: true }).click();
  await expect(avancar).toBeHidden();
  await esperarAviso(page, 'Etapa concluída');
  await expect(page.getByRole('heading', { level: 2, name: 'Contrato e gestão', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Boreal');
  erros.verificar();
});
