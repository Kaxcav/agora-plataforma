/**
 * Consulta automática de preços (RF-25) e projeção do valor estimado (RIA-11), em modo offline (padrão):
 * o servidor consulta as fontes (simuladas de forma determinística), o agente inclui duas sugestões na cesta,
 * com a fonte, e vê a projeção com premissas e "requer revisão humana".
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

async function processoNaEtapa3(page: Page): Promise<{ id: string } | undefined> {
  const resposta = await page.request.get('/api/v1/processos?tamanhoPagina=100');
  const corpo = (await resposta.json()) as { itens: { id: string; etapaAtual: number }[] };
  return corpo.itens.find((p) => p.etapaAtual === 3);
}

function daquiA(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

test('RF-25 e RIA-11 — busca preços do item da cesta, inclui duas sugestões com a fonte e vê a projeção', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const processo = await processoNaEtapa3(page);
  test.skip(!processo, 'nenhum processo na etapa 3 nos dados sintéticos');
  await page.goto(`/jornada/${processo?.id ?? ''}`);
  await esperarPaginaOk(page);

  const secao = page.getByRole('region', { name: 'Consulta automática de preços' });
  await expect(secao.getByText(/Item de referência da cesta \(item 1\)/)).toBeVisible();
  await expect(secao.getByRole('textbox', { name: /^Termo de busca/ })).not.toHaveValue('');
  await secao.getByRole('button', { name: 'Buscar preços', exact: true }).click();

  const fontes = secao.getByRole('table', { name: 'Fontes consultadas pelo servidor' });
  await expect(fontes.getByRole('row', { name: /^Painel de Preços/ })).toContainText('Consultada');
  await expect(fontes.getByRole('row', { name: /^Sinapi/ })).toContainText('Não se aplica');
  const sugestoes = secao.getByRole('group', { name: 'Preços sugeridos (RF-25)' });
  await expect(sugestoes.getByRole('checkbox', { name: /^Painel de Preços — R\$\s[\d.,]+ em \d{2}\/\d{2}\/\d{4} \(art\. 23, § 1º, I\) Compra DEMO-/ })).toHaveCount(4);
  await expect(sugestoes.getByRole('checkbox', { name: /^Contratação similar — R\$\s[\d.,]+ em \d{2}\/\d{2}\/\d{4} \(art\. 23, § 1º, II\) PNCP DEMO-/ })).toHaveCount(3);
  await expect(sugestoes.getByRole('checkbox', { name: /^Nota fiscal eletrônica — R\$\s[\d.,]+ em \d{2}\/\d{2}\/\d{4} \(art\. 23, § 1º, V\) NF-e DEMO/ })).toHaveCount(3);
  await expect(secao.getByText('Amostras descartadas (1)')).toBeVisible();
  await verificarAcessibilidade(page, 'consulta automática de preços', '#etapa3-pesquisa');

  // A cesta pode estar vazia (a tabela só aparece com cotações): a contagem anterior vem da API.
  const detalhe = (await (await page.request.get(`/api/v1/processos/${processo?.id ?? ''}`)).json()) as { cestaPrecos: { cotacoes: unknown[] } };
  const cotacoesAntes = detalhe.cestaPrecos.cotacoes.length;
  const cotacoes = page.getByRole('region', { name: /^Cotações \(/ });
  await sugestoes.getByRole('checkbox', { name: /^Painel de Preços/ }).first().check();
  await sugestoes.getByRole('checkbox', { name: /^Contratação similar/ }).first().check();
  await sugestoes.getByRole('button', { name: 'Incluir 2 preços na cesta', exact: true }).click();
  await esperarAviso(page, 'Preços incluídos na cesta');
  await expect(sugestoes.getByText('Incluído na cesta', { exact: true })).toHaveCount(2);
  await expect(cotacoes.locator('tbody tr')).toHaveCount(cotacoesAntes + 2);
  await expect(cotacoes).toContainText(/Painel de Preços — .*\(Compra DEMO-.*art\. 23, § 1º, I\)/);
  await expect(cotacoes).toContainText(/Contratação similar \(PNCP\) — .*\(PNCP DEMO-.*art\. 23, § 1º, II\)/);

  const projecao = page.getByRole('region', { name: 'Projeção do valor estimado' });
  await projecao.getByLabel(/^Data prevista da contratação/).fill(daquiA(200));
  await projecao.getByRole('spinbutton', { name: /^Parcela do valor sujeita ao câmbio/ }).fill('20');
  await projecao.getByRole('button', { name: 'Projetar valor', exact: true }).click();
  await expect(projecao.getByText('Requer revisão humana', { exact: true })).toBeVisible();
  await expect(projecao.getByText(/^Valor projetado para \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(projecao.getByRole('heading', { name: 'Premissas' })).toBeVisible();
  await expect(projecao).toContainText('IPCA');
  await expect(projecao).toContainText('20% do valor está sujeito à variação cambial');
  await verificarAcessibilidade(page, 'projeção do valor estimado', '#etapa3-projecao');
  erros.verificar();
});
