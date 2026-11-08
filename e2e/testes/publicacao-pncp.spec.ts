/**
 * PoC-05 (termo de referência do cliente) com dados sintéticos: publicação do edital e dos anexos no PNCP pela fila de
 * integrações (RF-19, RNF-07), em modo offline — protocolo e número de controle simulados de forma reproduzível — e
 * link público do inteiro teor sem cadastro nem login. Também a fila de erro na tela de integrações, com o
 * reprocessamento. Cada teste usa o processo que estiver na situação exigida, sem depender da ordem dos arquivos.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ProcessoLista {
  id: string;
  etapaAtual: number;
  titulo: string;
}

interface Detalhe {
  parecer: { conclusao: string | null };
  publicacao: { pncp: string };
}

/** Processo na etapa 5 ainda não publicado (ou, na falta dele, um já publicado pela fila). */
async function processoParaPublicar(page: Page): Promise<{ id: string; publicado: boolean } | undefined> {
  const resposta = await page.request.get('/api/v1/processos?etapa=5&tamanhoPagina=100');
  const { itens } = (await resposta.json()) as { itens: ProcessoLista[] };
  let publicado: string | undefined;
  for (const processo of itens) {
    const detalhe = (await (await page.request.get(`/api/v1/processos/${processo.id}`)).json()) as Detalhe;
    if (detalhe.publicacao.pncp === 'nao_publicado') return { id: processo.id, publicado: false };
    const envios = (await (await page.request.get(`/api/v1/processos/${processo.id}/publicacao-pncp`)).json()) as { envios: unknown[] };
    if (envios.envios.length > 0) publicado = processo.id;
  }
  return publicado ? { id: publicado, publicado: true } : undefined;
}

test('PoC-05 — edital e anexos publicados pela fila (simulação), com protocolo, número de controle e link público sem login', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  const alvo = await processoParaPublicar(page);
  test.skip(!alvo, 'nenhum processo na etapa 5 nos dados sintéticos');
  const id = alvo?.id ?? '';

  if (!alvo?.publicado) {
    // Parecer favorável da assessoria jurídica (art. 53), quando ainda não registrado.
    const detalhe = (await (await page.request.get(`/api/v1/processos/${id}`)).json()) as Detalhe;
    if (detalhe.parecer.conclusao !== 'favoravel' && detalhe.parecer.conclusao !== 'favoravel_com_ressalvas') {
      await page.context().clearCookies();
      await entrar(page, 'juridico');
      await page.goto(`/jornada/${id}`);
      await esperarPaginaOk(page);
      const atendidos = page.getByRole('radio', { name: 'Atendido', exact: true });
      const itens = await atendidos.count();
      for (let i = 0; i < itens; i++) await atendidos.nth(i).check();
      await page.getByRole('radio', { name: 'Favorável', exact: true }).check();
      await page.getByRole('button', { name: 'Salvar parecer', exact: true }).click();
      await esperarAviso(page, 'Parecer registrado');
      await page.context().clearCookies();
      await entrar(page, 'agente');
    }
    await page.goto(`/jornada/${id}`);
    await esperarPaginaOk(page);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Publicar o edital' });
    await dialogo.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Publicação enviada');
    await esperarFocoPreservado(page);
  } else {
    await page.goto(`/jornada/${id}`);
    await esperarPaginaOk(page);
  }

  // Situação de cada envio na etapa de publicação: compra + edital e os anexos aprovados, publicados pela fila.
  const envios = page.getByRole('region', { name: 'Envios ao PNCP' });
  await expect(envios).toBeVisible();
  await expect(envios.getByText(/^Simulação: as integrações estão em modo offline/)).toBeVisible();
  const cartoes = envios.getByRole('listitem');
  await expect(cartoes).toHaveCount(3, { timeout: 20_000 });
  await expect(cartoes.filter({ hasText: 'Publicado' })).toHaveCount(3, { timeout: 20_000 });
  for (const titulo of ['Edital', 'Termo de referência', 'Minuta do contrato']) await expect(cartoes.filter({ hasText: titulo })).toHaveCount(1);
  await expect(envios.getByText(/^SIMULADO-[0-9A-F]{20}$/)).toHaveCount(3);
  await expect(page.getByText(/^\d{14}-1-\d{6}\/\d{4}$/).first()).toBeVisible();
  await expect(page.getByText(/^Propostas a partir de \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await verificarAcessibilidade(page, 'etapa 5 — envios ao PNCP');

  // Link público do inteiro teor (art. 25, § 3º): abre sem sessão.
  const linkPublico = envios.getByRole('link', { name: 'Inteiro teor, sem login' });
  await expect(linkPublico).toHaveAttribute('href', `/transparencia/editais/${id}`);
  await page.context().clearCookies();
  await page.goto(`/transparencia/editais/${id}`);
  await esperarPaginaOk(page);
  await expect(page).toHaveURL(new RegExp(`/transparencia/editais/${id}$`));
  await expect(page.getByRole('link', { name: /Edital/ }).first()).toBeVisible();
  const pdf = await page.request.get(`/api/v1/publico/editais/${id}/documentos/edital`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  erros.verificar();
});

test('fila de integrações — sincronização na fila de erro aparece na tela e é reprocessada', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'admin');
  await page.goto('/admin/integracoes');
  await esperarPaginaOk(page);
  const fila = page.getByRole('region', { name: 'Fila de integrações', exact: true });
  await expect(fila).toBeVisible();
  await expect(fila.getByText('PostgreSQL', { exact: true })).toBeVisible();
  await expect(fila.getByRole('radio', { name: 'Fila de erro', exact: true })).toBeChecked();
  const linha = fila.getByRole('row').filter({ hasText: 'Sincronizar Empenhos (SIAFI)' });
  await expect(linha).toHaveCount(1);
  await expect(linha).toContainText('Na fila de erro');
  await verificarAcessibilidade(page, 'integrações — fila de erro');

  await linha.getByRole('button', { name: 'Reprocessar: Sincronizar Empenhos (SIAFI)', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Reprocessar tarefa' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText('janela de manutenção');
  await dialogo.getByRole('button', { name: 'Reprocessar', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, /Reprocessada e concluída/);
  await expect(fila.getByRole('row').filter({ hasText: 'Sincronizar Empenhos (SIAFI)' })).toHaveCount(0);

  await fila.getByRole('radio', { name: 'Todas', exact: true }).check();
  await expect(fila.getByRole('row').filter({ hasText: 'Sincronizar Empenhos (SIAFI)' }).first()).toContainText('Concluída');
  erros.verificar();
});
