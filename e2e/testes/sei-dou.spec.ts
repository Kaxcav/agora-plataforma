/**
 * RF-35 e RF-36 em modo offline (dados sintéticos): o processo é enviado ao SEI simulado, os documentos ganham o número
 * SEI e a assinatura feita no SEI aparece refletida na Ágora; na área de publicações, um extrato de contrato é gerado
 * no padrão do DOU, o envio pelo INCom é registrado com o protocolo e a publicação é conferida.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ProcessoLista {
  id: string;
}

interface SeiProcesso {
  processo: { numero: string } | null;
  pendentesEnvio: number;
  documentos: { enviado: boolean; numeroSei: string | null; assinado: boolean; resumoAssinatura: string; consultadoEm: string | null }[];
}

/** Processo com documentos aprovados que ainda não foi enviado ao SEI. */
async function processoParaSei(page: Page): Promise<{ id: string; pendentes: number } | undefined> {
  const { itens } = (await (await page.request.get('/api/v1/processos?tamanhoPagina=100')).json()) as { itens: ProcessoLista[] };
  for (const p of itens) {
    const sei = (await (await page.request.get(`/api/v1/processos/${p.id}/sei`)).json()) as SeiProcesso;
    if (sei.processo === null && sei.pendentesEnvio >= 2) return { id: p.id, pendentes: sei.pendentesEnvio };
  }
  return undefined;
}

test('SEI (simulação) — enviar o processo, ver o número SEI dos documentos e a assinatura refletida', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  const alvo = await processoParaSei(page);
  test.skip(!alvo, 'nenhum processo com documentos aprovados fora do SEI nos dados sintéticos');
  const id = alvo?.id ?? '';
  const pendentes = alvo?.pendentes ?? 0;

  await page.goto(`/jornada/${id}`);
  await esperarPaginaOk(page);
  const painel = page.getByRole('region', { name: 'Integração com o SEI' });
  await expect(painel).toContainText('Simulação: as integrações estão em modo offline');
  await expect(painel).toContainText('Ainda não enviado');
  await verificarAcessibilidade(page, 'processo — integração com o SEI antes do envio');

  await painel.getByRole('button', { name: 'Enviar ao SEI', exact: true }).click();
  await esperarAviso(page, 'Processo enviado ao SEI');
  await esperarFocoPreservado(page);
  const { numeroSei } = (await (await page.request.get(`/api/v1/processos/${id}`)).json()) as { numeroSei: string };
  await expect(painel).toContainText(numeroSei);
  await expect(painel).toContainText(`${pendentes} de ${pendentes}`);
  await expect(painel.getByText('Bloco de assinatura')).toBeVisible();
  const arvore = page.getByRole('region', { name: 'Árvore do processo SEI' });
  await expect(arvore.getByText(/^SEI nº \d+/)).toHaveCount(pendentes);

  await painel.getByRole('button', { name: 'Consultar assinaturas', exact: true }).click();
  await esperarAviso(page, 'Assinaturas consultadas no SEI');
  const sei = (await (await page.request.get(`/api/v1/processos/${id}/sei`)).json()) as SeiProcesso;
  const enviados = sei.documentos.filter((d) => d.enviado);
  expect(enviados).toHaveLength(pendentes);
  expect(enviados.every((d) => d.assinado && d.resumoAssinatura !== '' && d.consultadoEm !== null)).toBe(true);
  await expect(painel).not.toContainText('aguardando assinatura');
  await expect(arvore).toContainText('todos assinados');
  await verificarAcessibilidade(page, 'processo — integração com o SEI após o envio e a consulta');
  erros.verificar();
});

test('DOU — gerar o extrato de um contrato, registrar o envio pelo INCom e conferir a publicação', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  await page.getByRole('navigation').getByRole('link', { name: 'Publicações no DOU' }).click();
  await expect(page).toHaveURL(/\/publicacoes-dou$/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Publicações no DOU' })).toBeVisible();
  await expect(page.getByText('Conferência simulada')).toBeVisible();

  // Os avisos de licitação dos editais publicados na carga sintética já estão conferidos.
  await page.getByRole('combobox', { name: 'Tipo' }).selectOption('aviso_licitacao');
  await expect(page.getByRole('table').getByText('Publicada', { exact: true }).first()).toBeVisible();
  await verificarAcessibilidade(page, 'publicações no DOU');
  await page.getByRole('combobox', { name: 'Tipo' }).selectOption('');

  await page.getByRole('button', { name: 'Gerar matéria', exact: true }).click();
  const gerar = page.getByRole('dialog', { name: 'Gerar matéria para o DOU' });
  await expect(gerar.getByRole('radio', { name: /^Extrato de contrato/ })).toBeChecked();
  await expect(gerar.getByRole('radio', { name: /^Aviso de licitação/ })).toHaveCount(0);
  const contrato = gerar.getByRole('combobox', { name: /^Contrato/ });
  await expect(contrato.locator('option').nth(1)).toBeAttached();
  const opcoes = await contrato.locator('option').evaluateAll((os) =>
    os.map((o) => ({ valor: (o as HTMLOptionElement).value, texto: o.textContent ?? '' })).filter((o) => o.valor !== '' && !o.texto.includes('já tem matéria')),
  );
  expect(opcoes.length).toBeGreaterThan(0);
  await contrato.selectOption(opcoes[0]?.valor ?? '');
  await gerar.getByRole('button', { name: 'Gerar matéria', exact: true }).click();
  await esperarAviso(page, 'Matéria gerada');

  const materia = page.getByRole('dialog', { name: /^EXTRATO DE CONTRATO Nº / });
  await expect(materia).toBeVisible();
  await expect(materia.getByRole('region', { name: /^Texto da matéria/ })).toContainText('Fundamento legal: Lei nº 14.133/2021');
  await expect(materia).toContainText('A enviar pelo INCom');
  await expect(materia).toContainText('Publicidade complementar');
  await verificarAcessibilidade(page, 'matéria do DOU (rascunho)', 'dialog');

  await materia.getByRole('button', { name: 'Registrar envio pelo INCom', exact: true }).click();
  await materia.getByRole('textbox', { name: /^Protocolo do INCom/ }).fill('INCOM-E2E-000123');
  await materia.getByRole('button', { name: 'Salvar envio', exact: true }).click();
  await esperarAviso(page, 'Envio registrado');
  await expect(materia).toContainText('Enviada, aguardando publicação');
  await expect(materia).toContainText('INCOM-E2E-000123');
  await expect(materia).toContainText(/Edição prevista: \d{2}\/\d{2}\/\d{4}/);

  await materia.getByRole('button', { name: 'Conferir no DOU', exact: true }).click();
  await esperarAviso(page, 'Conferência concluída');
  await expect(materia).toContainText(/Ainda não localizada no DOU até \d{2}\/\d{2}\/\d{4}; edição prevista: \d{2}\/\d{2}\/\d{4}/);
  await verificarAcessibilidade(page, 'matéria do DOU (enviada)', 'dialog');
  await materia.getByRole('button', { name: 'Fechar', exact: true }).first().click();
  await expect(materia).toBeHidden();
  await expect(page.getByRole('table').getByText('INCOM-E2E-000123')).toBeVisible();
  erros.verificar();
});
