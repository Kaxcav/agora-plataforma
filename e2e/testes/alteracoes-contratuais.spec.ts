/**
 * Frente K (F22a): execução contratual como ato. Termo aditivo dentro do limite do art. 125 é proposto, recebe o
 * parecer jurídico, é assinado (checklist de regularidade) e divulgado no PNCP pela fila; acima do limite a API
 * recusa (RN-32). Reajuste antes de 12 meses da data-base é recusado; depois, é apostilado (RF-27). Extinção
 * unilateral com defesa e decisão da autoridade, com o termo de rescisão. Dados sintéticos da carga de demonstração.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ContratoLista {
  id: string;
  numero: string;
  fornecedor: { razaoSocial: string };
}

interface Painel {
  limites: { margemAcrescimos: number };
  reajuste: { disponivel: boolean };
  alteracoes: { situacao: string }[];
}

/** Fornecedores que os testes da frente C usam para as travas de regularidade: ficam de fora. */
const RESERVADOS = /^(Metropolitana|Mirante|Amazônia)/;
const usados = new Set<string>();

async function sessaoDe(browser: Browser, perfil: string): Promise<Page> {
  const contexto = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 900 } });
  const page = await contexto.newPage();
  await entrar(page, perfil);
  return page;
}

async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

/** Centavos no formato do campo de moeda (1.234,56). */
function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Contrato vigente, divulgado no PNCP, sem atos pendentes e que atende ao filtro. */
async function escolherContrato(page: Page, filtro: (painel: Painel, id: string) => Promise<boolean> | boolean): Promise<ContratoLista> {
  const { itens } = (await (await page.request.get('/api/v1/contratos?situacao=vigente&tamanhoPagina=100&ordenarPor=numero&ordem=desc')).json()) as { itens: ContratoLista[] };
  for (const c of itens) {
    if (usados.has(c.id) || RESERVADOS.test(c.fornecedor.razaoSocial)) continue;
    const detalhe = (await (await page.request.get(`/api/v1/contratos/${c.id}`)).json()) as { idPncp: string | null };
    if (!detalhe.idPncp) continue;
    const painel = (await (await page.request.get(`/api/v1/contratos/${c.id}/alteracoes`)).json()) as Painel;
    if (painel.alteracoes.some((a) => ['aguardando_parecer', 'pronto_para_assinatura', 'em_contraditorio', 'aguardando_decisao'].includes(a.situacao))) continue;
    if (!(await filtro(painel, c.id))) continue;
    usados.add(c.id);
    return c;
  }
  throw new Error('Nenhum contrato atende ao cenário.');
}

async function abrirAlteracoes(page: Page, contratoId: string): Promise<void> {
  await page.goto(`/contratos/${contratoId}`);
  await esperarPaginaOk(page);
  await page.getByRole('tab', { name: /^Alterações/ }).click();
  await expect(page.getByRole('heading', { name: 'Limites de alteração (art. 125)' })).toBeVisible();
}

function historico(page: Page) {
  return page.getByRole('table', { name: 'Histórico de alterações' });
}

test('aditivo acima de 25% é recusado; dentro do limite recebe parecer, é assinado e divulgado no PNCP (RN-32)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/contratos\/[0-9a-f-]+\/alteracoes$/);
  await entrar(page, 'gestor');
  let margem = 0;
  const contrato = await escolherContrato(page, async (painel, id) => {
    if (painel.limites.margemAcrescimos < 200_00) return false;
    const regularidade = (await (await page.request.get(`/api/v1/contratos/${id}/regularidade?momento=assinatura`)).json()) as { bloqueia: boolean };
    margem = painel.limites.margemAcrescimos;
    return !regularidade.bloqueia;
  });

  await abrirAlteracoes(page, contrato.id);
  await verificarAcessibilidade(page, 'aba Alterações do contrato');

  const propor = async (valor: number) => {
    await page.getByRole('button', { name: 'Propor termo aditivo', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Propor termo aditivo' });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('radio', { name: /^Acréscimo quantitativo/ }).check();
    const campo = dialogo.getByRole('textbox', { name: /^Valor do acréscimo/ });
    await campo.fill(reais(valor));
    await campo.press('Tab');
    await dialogo
      .getByRole('textbox', { name: /^Justificativa/ })
      .fill('Ampliação do atendimento nas unidades regionais, conforme estudo de demanda do fiscal (dados sintéticos).');
    await dialogo.getByRole('button', { name: 'Propor termo aditivo', exact: true }).click();
    return dialogo;
  };

  // Acima do limite: a API recusa e mostra a trava RN-32.
  const recusado = await propor(margem + 100);
  const falha = recusado.getByRole('alert').filter({ hasText: 'A proposta não foi registrada' });
  await expect(falha).toBeVisible();
  await expect(falha).toContainText('RN-32');
  await expect(falha).toContainText(/acima do limite de 25%/);
  await verificarAcessibilidade(page, 'aditivo recusado acima do limite', 'dialog[open]');
  await recusado.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(recusado).toBeHidden();

  // Dentro do limite: proposta registrada, aguardando o parecer jurídico.
  const aceito = await propor(Math.round(margem / 4));
  await expect(aceito).toBeHidden();
  await esperarAviso(page, 'Termo aditivo proposto');
  await expect(historico(page).getByRole('row').filter({ hasText: 'Aguardando parecer jurídico' })).toHaveCount(1);

  // Parecer jurídico favorável (assessoria jurídica, art. 53, § 4º).
  const juridico = await sessaoDe(browser, 'juridico');
  await abrirAlteracoes(juridico, contrato.id);
  await historico(juridico).getByRole('button', { name: /^Ver proposta de acréscimo/ }).click();
  const detalheJuridico = juridico.getByRole('dialog', { name: 'Proposta de acréscimo' });
  await detalheJuridico.getByRole('button', { name: 'Registrar parecer jurídico', exact: true }).click();
  await detalheJuridico.getByRole('radio', { name: 'Favorável', exact: true }).check();
  await detalheJuridico.getByRole('textbox', { name: /^Número do parecer/ }).fill('PARECER-E2E-001');
  await detalheJuridico.getByRole('textbox', { name: /^Conclusão do parecer/ }).fill('Alteração fundamentada e dentro do limite do art. 125.');
  await verificarAcessibilidade(juridico, 'parecer jurídico do aditivo', 'dialog[open]');
  await detalheJuridico.getByRole('button', { name: 'Registrar parecer', exact: true }).click();
  await esperarAviso(juridico, 'Parecer registrado');
  await juridico.context().close();

  // Assinatura pela autoridade: checklist de regularidade e divulgação no PNCP pela fila.
  await page.reload();
  await esperarPaginaOk(page);
  await page.getByRole('tab', { name: /^Alterações/ }).click();
  await expect(historico(page).getByRole('row').filter({ hasText: 'Pronto para assinatura' })).toHaveCount(1);
  await historico(page).getByRole('button', { name: /^Ver proposta de acréscimo/ }).click();
  const detalhe = page.getByRole('dialog', { name: 'Proposta de acréscimo' });
  await detalhe.getByRole('button', { name: 'Assinar termo aditivo', exact: true }).click();
  await detalhe.getByRole('checkbox', { name: /^Confirmo a assinatura do termo/ }).check();
  await detalhe.getByRole('button', { name: 'Assinar', exact: true }).click();
  await esperarAviso(page, 'Termo aditivo assinado');
  const linha = historico(page).getByRole('row').filter({ hasText: /\d+º Termo Aditivo/ }).filter({ hasText: 'Divulgado no PNCP' });
  await expect(linha.first()).toBeVisible();
  await expect(linha.first()).toContainText('Assinado');
  await verificarAcessibilidade(page, 'histórico com o aditivo assinado');
  erros.verificar();
});

test('reajuste antes de 12 meses da data-base é recusado; depois do aniversário, é apostilado (RF-27)', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const token = await csrf(page);

  const recente = await escolherContrato(page, (painel) => !painel.reajuste.disponivel);
  await abrirAlteracoes(page, recente.id);
  await expect(page.getByText('Antes de 12 meses: vedado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar reajuste', exact: true })).toHaveCount(0);
  const recusa = await page.request.post(`/api/v1/contratos/${recente.id}/reajustes`, {
    data: { percentual: 4.5, fonteIndice: 'Série sintética de teste' },
    headers: { 'x-agora-csrf': token },
  });
  expect(recusa.status()).toBe(422);
  expect(JSON.stringify(await recusa.json())).toMatch(/interregno mínimo de 12 meses/);

  const aniversario = await escolherContrato(page, (painel) => painel.reajuste.disponivel);
  await abrirAlteracoes(page, aniversario.id);
  await expect(page.getByText('Interregno de 12 meses cumprido')).toBeVisible();
  await page.getByRole('button', { name: 'Registrar reajuste', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Registrar reajuste' });
  await dialogo.getByRole('textbox', { name: /^Variação do/ }).fill('4,5');
  await dialogo.getByRole('textbox', { name: /^Fonte e período do índice/ }).fill('Série sintética do índice, 12 meses');
  await verificarAcessibilidade(page, 'registro de reajuste', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Apostilar reajuste', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Reajuste apostilado');
  const linha = historico(page).getByRole('row').filter({ hasText: /\d+º Apostilamento/ }).filter({ hasText: 'Reajuste (apostila)' });
  await expect(linha.first()).toBeVisible();
  await expect(page.getByText('Antes de 12 meses: vedado')).toBeVisible();
  erros.verificar();
});

test('extinção unilateral: contraditório, defesa registrada, decisão com efeitos do art. 139 e termo de rescisão', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const contrato = await escolherContrato(page, () => true);
  await abrirAlteracoes(page, contrato.id);

  await page.getByRole('button', { name: 'Abrir extinção', exact: true }).click();
  const abertura = page.getByRole('dialog', { name: 'Abrir processo de extinção' });
  await abertura.getByRole('radio', { name: /^Unilateral/ }).check();
  await abertura.getByRole('combobox', { name: /^Motivo/ }).selectOption('art137_I');
  await abertura
    .getByRole('textbox', { name: /^Motivação/ })
    .fill('Descumprimento reiterado dos prazos de entrega apontado nos relatórios da fiscalização, sem regularização (dados sintéticos).');
  await verificarAcessibilidade(page, 'abertura da extinção', 'dialog[open]');
  await abertura.getByRole('button', { name: 'Abrir processo de extinção', exact: true }).click();
  await expect(abertura).toBeHidden();
  await esperarAviso(page, 'Processo de extinção aberto');
  await expect(historico(page).getByRole('row').filter({ hasText: 'Prazo de defesa' })).toHaveCount(1);

  await historico(page).getByRole('button', { name: /^Ver processo de extinção/ }).click();
  const detalhe = page.getByRole('dialog', { name: 'Processo de extinção' });
  await detalhe.getByRole('button', { name: 'Registrar defesa', exact: true }).click();
  await detalhe.getByRole('textbox', { name: /^Resumo da defesa/ }).fill('A contratada alega falta de insumos no mercado, sem comprovação (dados sintéticos).');
  await detalhe.getByRole('button', { name: 'Registrar defesa', exact: true }).click();
  await esperarAviso(page, 'Defesa registrada');

  await historico(page).getByRole('button', { name: /^Ver processo de extinção/ }).click();
  const decisao = page.getByRole('dialog', { name: 'Processo de extinção' });
  await decisao.getByRole('button', { name: 'Decidir a extinção', exact: true }).click();
  await decisao.getByRole('checkbox', { name: /^Assunção imediata do objeto/ }).check();
  await decisao.getByRole('textbox', { name: /^Fundamentação da decisão/ }).fill('Defesa analisada e rejeitada; mantidos os descumprimentos apontados.');
  await verificarAcessibilidade(page, 'decisão da extinção', 'dialog[open]');
  await decisao.getByRole('button', { name: 'Registrar decisão', exact: true }).click();
  await esperarAviso(page, 'Extinção decidida');
  await expect(page.getByText(/^Contrato extinto em/)).toBeVisible();
  const termo = historico(page).getByRole('row').filter({ hasText: 'Termo de Rescisão' });
  await expect(termo).toContainText('Assinado');
  await expect(termo).toContainText('Divulgado no PNCP');
  await expect(page.getByRole('button', { name: 'Propor termo aditivo', exact: true })).toHaveCount(0);
  erros.verificar();
});
