/**
 * Central de notificações (RF-26) e semáforo 30/60/90/120 (RN-31), com dados sintéticos e drivers simulados.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface Vencimento {
  tipo: 'ata' | 'contrato';
  id: string;
  identificador: string;
  diasRestantes: number;
  faixa: number;
}

interface ContratoLista {
  id: string;
  numero: string;
}

async function vencimentoNaFaixa120(page: Page): Promise<Vencimento | undefined> {
  const resposta = await page.request.get('/api/v1/vencimentos');
  const corpo = (await resposta.json()) as { instrumentos: Vencimento[] };
  return corpo.instrumentos.find((i) => i.tipo === 'contrato' && i.faixa === 120);
}

test('contrato vencendo em até 120 dias gera aviso automático ao gestor e ao fiscal, visto no painel e na central', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const alvo = await vencimentoNaFaixa120(page);
  test.skip(!alvo, 'nenhum contrato entre 91 e 120 dias nos dados sintéticos');
  if (!alvo) return;
  expect(alvo.diasRestantes).toBeGreaterThan(90);
  expect(alvo.diasRestantes).toBeLessThanOrEqual(120);

  // Painel: semáforo com a faixa de 120 dias e linha do tempo.
  await page.goto('/');
  await esperarPaginaOk(page);
  await expect(page.getByRole('list', { name: 'Quantidade de instrumentos por faixa de vencimento' }).getByText('91 a 120 dias').first()).toBeVisible();
  const linhaTempo = page.getByRole('region', { name: 'Linha do tempo de vencimentos' });
  const faixa120 = linhaTempo.getByRole('region', { name: /91 a 120 dias/ });
  await expect(faixa120.getByRole('link', { name: alvo.identificador, exact: true })).toBeVisible();
  await verificarAcessibilidade(page, 'painel com linha do tempo de vencimentos', '#linha-tempo-vencimentos');

  // Central: o aviso automático da faixa de 120 dias.
  await page.goto('/notificacoes?faixa=120&origem=automatica');
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/notificacoes');
  const tabela = page.getByRole('table', { name: /Avisos registrados/ });
  const linha = tabela.getByRole('row').filter({ hasText: `${alvo.identificador}: vigência termina em ${alvo.diasRestantes} dias (faixa de 120 dias)` });
  await expect(linha).toHaveCount(1);
  await linha.getByRole('button', { name: /^Ver envios/ }).click();
  const dialogo = page.getByRole('dialog', { name: 'Envios do aviso' });
  await expect(dialogo).toBeVisible();
  const envios = dialogo.getByRole('table', { name: /Envios do aviso/ });
  await expect(envios.getByRole('row').filter({ hasText: 'Gestor' })).toContainText('Enviado');
  await expect(envios.getByRole('row').filter({ hasText: 'Fiscal' })).toContainText('Enviado');
  await expect(envios.getByText('Simulado').first()).toBeVisible();
  await verificarAcessibilidade(page, 'detalhe do aviso automático', 'dialog[open]');
  erros.verificar();
});

test('disparo manual de notificação ao fiscal em um clique e situação do envio no driver simulado', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const resposta = await page.request.get('/api/v1/contratos?situacao=vigente&tamanhoPagina=50');
  const { itens } = (await resposta.json()) as { itens: ContratoLista[] };
  let contrato: ContratoLista | undefined;
  for (const c of itens) {
    const detalhe = (await (await page.request.get(`/api/v1/contratos/${c.id}`)).json()) as { fiscal: { nome: string } | null };
    if (detalhe.fiscal) {
      contrato = c;
      break;
    }
  }
  expect(contrato, 'contrato vigente com fiscal designado').toBeDefined();
  if (!contrato) return;

  await page.goto(`/contratos/${contrato.id}`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Notificar', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: `Notificar sobre Contrato ${contrato.numero}` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('radio', { name: /^Vencimento/ })).toBeChecked();
  await expect(dialogo.getByRole('checkbox', { name: /^Fiscal do contrato/ })).toBeChecked();
  await expect(dialogo.getByRole('checkbox', { name: /^E-mail institucional/ })).toBeChecked();
  await verificarAcessibilidade(page, 'diálogo de notificação', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Enviar aviso', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Aviso registrado e enviado');
  await esperarAviso(page, /1 envio concluído/);

  await page.goto('/notificacoes?origem=manual');
  await esperarPaginaOk(page);
  const linha = page
    .getByRole('table', { name: /Avisos registrados/ })
    .getByRole('row')
    .filter({ hasText: `Contrato ${contrato.numero}:` })
    .first();
  await expect(linha).toContainText('Manual');
  await expect(linha).toContainText('1 enviado');
  await linha.getByRole('button', { name: /^Ver envios/ }).click();
  const detalhe = page.getByRole('dialog', { name: 'Envios do aviso' });
  const envio = detalhe.getByRole('table', { name: /Envios do aviso/ }).getByRole('row').filter({ hasText: 'Fiscal' });
  await expect(envio).toContainText('E-mail');
  await expect(envio).toContainText('Enviado');
  await expect(envio).toContainText('Simulado');
  await expect(envio).toContainText('1 de 5');
  await expect(envio).toContainText(/\*{3,}@/);
  await expect(envio).toContainText(/@agora\.simulado>/);
  await expect(detalhe.getByRole('button', { name: /^Reenviar para/ })).toBeVisible();
  await verificarAcessibilidade(page, 'situação do envio manual', 'dialog[open]');
  erros.verificar();
});

// O perfil financeiro, porque a suíte de conta troca a senha do fiscal de demonstração.
test('o servidor ajusta as próprias preferências de notificação', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'financeiro');
  await page.goto('/notificacoes?aba=preferencias');
  await esperarPaginaOk(page);
  const caixa = page.getByRole('checkbox', { name: 'Receber avisos de reajuste por e-mail' });
  await expect(caixa).toBeChecked();
  await caixa.uncheck();
  await page.getByRole('button', { name: 'Salvar preferências', exact: true }).click();
  await esperarAviso(page, 'Preferências salvas');
  await expect(caixa).not.toBeChecked();
  await expect(page.getByText(/Avisos de ocorrência são obrigatórios/)).toBeVisible();
  await verificarAcessibilidade(page, 'preferências de notificação');
  erros.verificar();
});

test('o perfil consulta não vê a central de notificações', async ({ page }) => {
  await entrar(page, 'consulta');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(menu.getByRole('link', { name: 'Notificações' })).toHaveCount(0);
});
