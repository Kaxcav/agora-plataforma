import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio';

/**
 * F7 — IMR do contrato (RF-29) e conferência da nota fiscal (RN-36). Conta do fiscal técnico (carga sintética): mede o
 * indicador, confere a nota e atesta. Os testes são encadeados: a nota conferida no segundo é a da competência medida
 * no primeiro.
 */
test.describe.configure({ mode: 'serial' });

interface ContratoImr {
  id: string;
  numero: string;
  pagamentoId: string;
}

async function contratoComImr(page: Page): Promise<ContratoImr> {
  const lista = (await (await page.request.get('/api/v1/contratos?tamanhoPagina=100')).json()) as { itens: { id: string; numero: string }[] };
  for (const c of lista.itens) {
    const imr = (await (await page.request.get(`/api/v1/contratos/${c.id}/imr`)).json()) as {
      indicadores: unknown[];
      competencias: { pagamento: { id: string } | null }[];
    };
    const pagamento = imr.competencias[0]?.pagamento;
    if (imr.indicadores.length > 0 && pagamento) return { id: c.id, numero: c.numero, pagamentoId: pagamento.id };
  }
  throw new Error('Nenhum contrato com IMR na carga sintética.');
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function diasAtras(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('RF-29 — o fiscal registra a medição abaixo da meta e vê a glosa calculada', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'fiscal.tecnico');
  const contrato = await contratoComImr(page);
  await page.goto(`/contratos/${contrato.id}?aba=imr`);
  await esperarPaginaOk(page);
  await expect(page.getByRole('tab', { name: 'IMR e medições' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('1 medição(ões) pendente(s)')).toBeVisible();
  const medicoes = page.getByRole('table', { name: 'Medições registradas' });
  await expect(medicoes.getByText(/^Glosa de 2,5%/)).toHaveCount(1);
  await verificarAcessibilidade(page, 'aba IMR e medições do contrato');

  await page.getByRole('button', { name: 'Registrar medição', exact: true }).first().click();
  const dialogo = page.getByRole('dialog', { name: `Registrar medição do IMR — Contrato ${contrato.numero}` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('combobox', { name: /^Medição pendente/ })).toHaveValue(/\|/);
  await dialogo.getByRole('textbox', { name: /^Horas com o serviço disponível/ }).fill('684');
  await dialogo.getByRole('textbox', { name: /^Horas previstas de funcionamento/ }).fill('720');
  await dialogo.getByRole('textbox', { name: /^Evidência da medição/ }).fill('Relatório mensal de disponibilidade com as interrupções registradas pela fiscalização.');
  await verificarAcessibilidade(page, 'registro da medição do IMR', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar medição', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, /glosa de 2,5%/);
  await expect(medicoes.getByText(/^Glosa de 2,5%/)).toHaveCount(2);
  await expect(page.getByText(/medição\(ões\) pendente\(s\)/)).toHaveCount(0);
  erros.verificar();
});

test('RN-36 — nota divergente bloqueia o atesto; com a justificativa, o atesto passa', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'fiscal.tecnico');
  const contrato = await contratoComImr(page);
  const contexto = (await (await page.request.get(`/api/v1/pagamentos/${contrato.pagamentoId}/conferencia`)).json()) as {
    itensContrato: { numero: number; valorUnitario: number }[];
  };
  const item = contexto.itensContrato[0];
  expect(item).toBeTruthy();
  const numeroNota = `NF ${String(Date.now()).slice(-6)}`;

  // Conferência com a nota pelo valor cheio: o IMR glosou 2,5%, então o valor devido é menor que o da nota.
  await page.goto(`/financeiro/pagamentos/${contrato.pagamentoId}/conferencia`);
  await esperarPaginaOk(page);
  await expect(page.getByText('Atesto bloqueado')).toBeVisible();
  await page.getByRole('textbox', { name: /^Número da nota fiscal/ }).fill(numeroNota);
  await page.getByLabel(/^Data de emissão/).fill(diasAtras(2));
  await page.getByRole('textbox', { name: /^Valor total da nota/ }).fill(reais(item?.valorUnitario ?? 0));
  await page.getByRole('spinbutton', { name: `Quantidade recebida do item ${item?.numero ?? 1}` }).fill('1');
  await page.getByRole('spinbutton', { name: `Quantidade cobrada do item ${item?.numero ?? 1}` }).fill('1');
  await verificarAcessibilidade(page, 'conferência da nota fiscal');
  await page.getByRole('button', { name: 'Registrar a conferência' }).click();
  await esperarAviso(page, 'Conferência registrada com divergência');
  const resultado = page.getByRole('region', { name: 'Valor da nota × valor devido' });
  await expect(resultado.getByText('Divergente', { exact: true })).toBeVisible();
  await expect(resultado.getByText(/a mais que o valor devido/)).toBeVisible();

  // Na janela de atesto, a divergência sem justificativa bloqueia a confirmação.
  await page.goto(`/financeiro/pagamentos?busca=${encodeURIComponent(numeroNota)}`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: `Atestar nota fiscal ${numeroNota} do contrato ${contrato.numero}` }).click();
  const atesto = page.getByRole('dialog', { name: 'Atestar pagamento' });
  await expect(atesto.getByText('Atesto bloqueado (RN-36)')).toBeVisible();
  await expect(atesto.getByRole('button', { name: 'Atestar pagamento', exact: true })).toBeDisabled();
  await verificarAcessibilidade(page, 'atesto bloqueado pela conferência', 'dialog[open]');
  await atesto.getByRole('button', { name: 'Cancelar' }).click();
  await expect(atesto).toBeHidden();

  // Justificativa registrada: o atesto é liberado e a parcela segue pelo valor a liquidar.
  await page.goto(`/financeiro/pagamentos/${contrato.pagamentoId}/conferencia`);
  await esperarPaginaOk(page);
  await page
    .getByRole('textbox', { name: /^Justificativa da divergência/ })
    .fill('A glosa do IMR foi comunicada ao preposto; a nota veio pelo valor cheio e a diferença será descontada na liquidação.');
  await page.getByRole('button', { name: 'Registrar justificativa' }).click();
  await esperarAviso(page, 'Justificativa registrada');
  await expect(page.getByText('Atesto liberado pela conferência')).toBeVisible();
  await page.getByRole('link', { name: 'Ir para o atesto' }).click();
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: `Atestar nota fiscal ${numeroNota} do contrato ${contrato.numero}` }).click();
  await expect(atesto.getByText('Divergência justificada')).toBeVisible();
  await atesto.getByRole('button', { name: 'Atestar pagamento', exact: true }).click();
  await expect(atesto).toBeHidden();
  await esperarAviso(page, /^Pagamento atestado/);
  erros.verificar();
});
