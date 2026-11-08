/**
 * Frente L — execução contratual como ato (F22): recebimento provisório e definitivo com termo em PDF (RN-34),
 * garantia vencendo com alerta da central de notificações e desconto de multa da garantia (RN-35), e alteração
 * justificada da ordem cronológica de pagamentos com exceção justificada na 2ª linha de defesa (RF-28).
 * Dados sintéticos; as contas de demonstração usadas são gestor, fiscal.tecnico e controle.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ContratoLista {
  id: string;
  numero: string;
}

interface Execucao {
  parametros: unknown;
  recebimentos: unknown[];
  garantias: { id: string; valorExigido: number; saldo: number; movimentos: { tipo: string }[] }[];
  notasDisponiveis: { pagamentoId: string; notaFiscal: string }[];
  multas: { sancaoId: string; incisoInfracao: string; saldo: number }[];
}

/** Data de hoje no fuso do órgão (igual ao servidor). */
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function execucaoDe(page: Page, id: string): Promise<Execucao> {
  return (await (await page.request.get(`/api/v1/contratos/${id}/execucao`)).json()) as Execucao;
}

/** Contrato vigente que atende ao critério, procurado entre os de vigência mais longa. */
async function contratoCom(page: Page, criterio: (e: Execucao) => boolean, ignorar: readonly string[] = []): Promise<ContratoLista | null> {
  const lista = (await (await page.request.get('/api/v1/contratos?situacao=vigente&ordenarPor=vigenciaFim&ordem=desc&tamanhoPagina=40')).json()) as { itens: ContratoLista[] };
  for (const c of lista.itens) {
    if (ignorar.includes(c.id)) continue;
    if (criterio(await execucaoDe(page, c.id))) return c;
  }
  return null;
}

async function trocarUsuario(page: Page, perfil: string): Promise<void> {
  await page.context().clearCookies();
  await entrar(page, perfil);
}

const usados: string[] = [];

test('recebimento provisório pelo fiscal e definitivo pela comissão, com termo em PDF e atesto da nota', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const contrato = await contratoCom(page, (e) => e.parametros !== null && e.recebimentos.length === 0 && e.notasDisponiveis.length > 0);
  test.skip(!contrato, 'nenhum contrato vigente com nota prevista e sem entregas');
  if (!contrato) return;
  usados.push(contrato.id);

  // Fiscalização: o gestor designa o fiscal técnico e integra a comissão de recebimento.
  await page.goto(`/contratos/${contrato.id}?aba=fiscalizacao`);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { name: 'Gestão e fiscalização' })).toBeVisible();
  for (const [papel, servidor] of [
    ['Fiscal técnico', 'Tiago Arantes Fontoura'],
    ['Comissão de recebimento definitivo', 'Rafael Antunes Veloso'],
  ] as const) {
    await page.getByRole('button', { name: 'Designar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Designar gestor ou fiscal' });
    await dialogo.getByRole('combobox', { name: /^Papel/ }).selectOption({ label: papel });
    await dialogo.getByRole('combobox', { name: /^Servidor/ }).selectOption({ label: servidor });
    await dialogo.getByRole('textbox', { name: /^Ato de designação/ }).fill('Portaria sintética nº 501/2026');
    await dialogo.getByRole('button', { name: 'Registrar designação' }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Designação registrada');
  }
  const equipe = page.getByRole('table', { name: /Equipe designada/ });
  await expect(equipe.getByRole('row').filter({ hasText: 'Tiago Arantes Fontoura' })).toContainText('Fiscal técnico');
  await verificarAcessibilidade(page, 'aba Fiscalização do contrato');

  // Recebimentos: o gestor registra a entrega ligada à nota fiscal prevista.
  await page.getByRole('tab', { name: 'Recebimentos' }).click();
  await expect(page.getByRole('heading', { name: 'Entregas e termos de recebimento' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  const entrega = page.getByRole('dialog', { name: 'Registrar entrega' });
  await entrega.getByRole('textbox', { name: /^Descrição da entrega/ }).fill('Parcela mensal sintética do serviço contratado');
  await entrega.getByRole('combobox', { name: /^Nota fiscal/ }).selectOption({ index: 1 });
  await entrega.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(entrega).toBeHidden();
  await esperarAviso(page, /Entrega nº 1 registrada/);

  // O fiscal técnico lavra o recebimento provisório.
  await trocarUsuario(page, 'fiscal.tecnico');
  await page.goto(`/contratos/${contrato.id}?aba=recebimentos`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Lavrar o termo provisório da entrega nº 1' }).click();
  const provisorio = page.getByRole('dialog', { name: 'Termo de recebimento provisório' });
  await expect(provisorio.getByRole('radio', { name: 'Objeto recebido' })).toBeChecked();
  await provisorio.getByRole('button', { name: 'Registrar termo' }).click();
  await expect(provisorio).toBeHidden();
  await esperarAviso(page, 'Termo de recebimento provisório registrado');
  await expect(page.getByRole('button', { name: 'Lavrar o termo definitivo da entrega nº 1' })).toBeVisible();

  // O gestor, como comissão de recebimento, lavra o definitivo: a nota é atestada e o prazo de pagamento começa.
  await trocarUsuario(page, 'gestor');
  await page.goto(`/contratos/${contrato.id}?aba=recebimentos`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Lavrar o termo definitivo da entrega nº 1' }).click();
  const definitivo = page.getByRole('dialog', { name: 'Termo de recebimento definitivo' });
  await definitivo.getByRole('button', { name: 'Registrar termo' }).click();
  await expect(definitivo).toBeHidden();
  await esperarAviso(page, /Nota fiscal .* atestada/);
  const tabela = page.getByRole('table', { name: /Entregas e termos de recebimento/ });
  await expect(tabela.getByText('Recebido definitivamente')).toBeVisible();
  await verificarAcessibilidade(page, 'aba Recebimentos do contrato');

  const link = tabela.getByRole('link', { name: /^Definitivo de .* \(PDF\)/ });
  const pdf = await page.request.get((await link.getAttribute('href')) ?? '');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(tabela.getByRole('link', { name: /^Provisório de .* \(PDF\)/ })).toBeVisible();

  const pagamentos = (await (await page.request.get(`/api/v1/contratos/${contrato.id}/pagamentos`)).json()) as { notaFiscal: string; situacao: string }[];
  expect(pagamentos.some((p) => p.situacao === 'atestado')).toBe(true);
  erros.verificar();
});

test('garantia apresentada com validade próxima gera o alerta de vencimento na central de notificações', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const contrato = await contratoCom(page, (e) => e.garantias.length === 0 && e.multas.length === 0, usados);
  test.skip(!contrato, 'nenhum contrato vigente sem garantia');
  if (!contrato) return;
  usados.push(contrato.id);

  await page.goto(`/contratos/${contrato.id}?aba=garantias`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Exigir garantia', exact: true }).click();
  const exigencia = page.getByRole('dialog', { name: 'Exigir garantia' });
  await expect(exigencia.getByRole('spinbutton', { name: /^Percentual/ })).toHaveValue('5');
  await exigencia.getByRole('button', { name: 'Exigir garantia' }).click();
  await expect(exigencia).toBeHidden();
  await esperarAviso(page, 'Garantia exigida');

  const garantia = (await execucaoDe(page, contrato.id)).garantias[0];
  expect(garantia).toBeTruthy();
  const validade = somarDias(HOJE, 20);
  await page.getByRole('button', { name: 'Registrar apresentação', exact: true }).click();
  const apresentacao = page.getByRole('dialog', { name: 'Registrar apresentação da garantia' });
  await apresentacao.getByRole('combobox', { name: /^Modalidade escolhida/ }).selectOption({ label: 'Seguro-garantia' });
  await apresentacao.getByRole('textbox', { name: /^Valor da garantia/ }).fill(reais(garantia?.valorExigido ?? 0));
  await apresentacao.getByLabel(/^Válida até/).fill(validade);
  await apresentacao.getByRole('textbox', { name: /^Emissor/ }).fill('Seguradora Sintética de Teste S.A.');
  await apresentacao.getByRole('textbox', { name: /^Número da apólice/ }).fill('Apólice sintética 2026-001');
  await apresentacao.getByRole('button', { name: 'Registrar apresentação da garantia' }).click();
  await expect(apresentacao).toBeHidden();
  await esperarAviso(page, /Aviso registrado na central de notificações/);
  await expect(page.getByText('Vence em breve')).toBeVisible();
  await verificarAcessibilidade(page, 'aba Garantias do contrato');

  // O alerta de vencimento chega ao gestor e ao fiscal pela central (frente J).
  await page.goto('/notificacoes?tipo=garantia');
  await esperarPaginaOk(page);
  const [ano, mes, dia] = validade.split('-');
  const tabela = page.getByRole('table', { name: /Avisos registrados/ });
  await expect(tabela.getByRole('row').filter({ hasText: `Contrato ${contrato.numero}: garantia contratual vence em ${dia}/${mes}/${ano}` })).toHaveCount(1);
  erros.verificar();
});

test('multa aplicada é descontada da garantia por decisão registrada da autoridade', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const sancoes = (await (await page.request.get('/api/v1/sancoes?situacao=aplicada&tipo=multa&tamanhoPagina=50')).json()) as { itens: { contrato: ContratoLista | null }[] };
  let contrato: ContratoLista | null = null;
  for (const s of sancoes.itens) {
    if (!s.contrato || usados.includes(s.contrato.id)) continue;
    const e = await execucaoDe(page, s.contrato.id);
    if (e.multas.some((m) => m.saldo > 0) && e.garantias.some((g) => g.saldo > 0)) {
      contrato = s.contrato;
      break;
    }
  }
  test.skip(!contrato, 'nenhum contrato com multa aplicada e garantia vigente');
  if (!contrato) return;
  usados.push(contrato.id);
  const antes = await execucaoDe(page, contrato.id);
  const multa = antes.multas.find((m) => m.saldo > 0);
  const saldoAntes = antes.garantias.reduce((t, g) => t + g.saldo, 0);

  await page.goto(`/contratos/${contrato.id}?aba=garantias`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: `Descontar a multa do inciso ${multa?.incisoInfracao ?? ''}` }).click();
  const dialogo = page.getByRole('dialog', { name: 'Descontar multa' });
  await expect(dialogo.getByText(/2º — garantia contratual/)).toBeVisible();
  await dialogo.getByRole('textbox', { name: /^Autoridade competente/ }).fill('Coordenadora sintética de contratos');
  await dialogo.getByRole('textbox', { name: /^Ato da decisão/ }).fill('Despacho sintético 77/2026');
  await dialogo
    .getByRole('textbox', { name: /^Justificativa/ })
    .fill('Desconto da multa aplicada em decisão definitiva, na ordem do art. 156, § 8º, da Lei 14.133/2021, com notificação da contratada.');
  await verificarAcessibilidade(page, 'diálogo de desconto de multa', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar desconto' }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Desconto de multa registrado');

  const depois = await execucaoDe(page, contrato.id);
  expect(depois.garantias.reduce((t, g) => t + g.saldo, 0)).toBeLessThan(saldoAntes);
  expect(depois.garantias.some((g) => g.movimentos.some((m) => m.tipo === 'desconto_multa'))).toBe(true);
  await page.getByText(/^Movimentos da garantia/).first().click();
  await expect(page.getByText(/Desconto de multa por decisão de Coordenadora sintética de contratos/)).toBeVisible();
  erros.verificar();
});

test('alteração justificada da ordem cronológica, comunicada ao controle, aparece como exceção na 2ª linha', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  await page.getByRole('link', { name: 'Prazos de pagamento', exact: true }).click();
  await expect(page).toHaveURL(/\/financeiro\/prazos$/);
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/financeiro/prazos');

  const botao = page.getByRole('button', { name: /^Alterar a ordem cronológica para a nota fiscal/ }).first();
  const nome = (await botao.getAttribute('aria-label')) ?? '';
  const notaFiscal = nome.replace('Alterar a ordem cronológica para a nota fiscal ', '');
  await botao.click();
  const dialogo = page.getByRole('dialog', { name: 'Alterar a ordem cronológica' });
  await dialogo.getByRole('combobox', { name: /^Hipótese/ }).selectOption({ value: 'V' });
  await dialogo
    .getByRole('textbox', { name: /^Justificativa/ })
    .fill('Serviço imprescindível ao funcionamento da atividade finalística, com risco demonstrado de descontinuidade na nota técnica sintética.');
  await dialogo.getByRole('textbox', { name: /^Autoridade competente/ }).fill('Ordenador sintético de despesas');
  await dialogo.getByRole('textbox', { name: /^Ato da decisão/ }).fill('Despacho sintético 88/2026');
  await dialogo.getByRole('button', { name: 'Registrar alteração' }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Alteração da ordem registrada');

  const secao = page.getByRole('region', { name: 'Alterações justificadas da ordem cronológica' });
  const item = secao.getByRole('listitem').filter({ hasText: `Nota fiscal ${notaFiscal}` });
  for (const [botaoNome, titulo, rotulo] of [
    ['Registrar comunicação ao controle interno', 'Comunicação ao controle interno', 'Controle interno: comunicado em'],
    ['Registrar comunicação ao tribunal de contas', 'Comunicação ao tribunal de contas', 'Tribunal de contas: comunicado em'],
  ] as const) {
    await item.getByRole('button', { name: botaoNome }).click();
    const comunicacao = page.getByRole('dialog', { name: titulo });
    await comunicacao.getByRole('textbox', { name: /^Protocolo ou ofício/ }).fill('Ofício sintético 12/2026');
    await comunicacao.getByRole('button', { name: 'Registrar comunicação' }).click();
    await expect(comunicacao).toBeHidden();
    await expect(item.getByText(rotulo)).toBeVisible();
  }

  // A 2ª linha de defesa vê a alteração como exceção justificada.
  await trocarUsuario(page, 'controle');
  await page.goto('/controle');
  await esperarPaginaOk(page);
  const excecoes = page.getByRole('region', { name: 'Exceções justificadas' });
  await expect(excecoes.getByText('Alteração justificada da ordem cronológica de pagamentos').first()).toBeVisible();
  await expect(excecoes.getByRole('link', { name: new RegExp(`^Nota fiscal ${notaFiscal}`) }).first()).toBeVisible();
  erros.verificar();
});
