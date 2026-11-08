/**
 * PoC-04 (parte do art. 91, § 4º) e frente C: consulta ao CEIS/CNEP e certidões antes de assinar e de prorrogar,
 * recheque no atesto (RN-23) e registro do envio da sanção ao CEIS/CNEP (RN-24). Dados sintéticos: a base simulada
 * do CEIS traz uma inidoneidade vigente para um dos fornecedores da carga de demonstração.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ProcessoLista {
  id: string;
  etapaAtual: number;
  titulo: string;
}

/** Data de hoje no fuso do órgão (igual ao servidor). */
function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

async function idFornecedor(page: Page, busca: string): Promise<string> {
  const corpo = (await (await page.request.get(`/api/v1/fornecedores?busca=${encodeURIComponent(busca)}&tamanhoPagina=10`)).json()) as {
    itens: { id: string; razaoSocial: string }[];
  };
  const fornecedor = corpo.itens.find((f) => f.razaoSocial.startsWith(busca));
  expect(fornecedor, `fornecedor ${busca}`).toBeTruthy();
  return fornecedor?.id ?? '';
}

const MOTIVACAO = 'Motivação sintética registrada pelo teste ponta a ponta da Ágora.';

/**
 * Pratica, pela API, os atos da seleção até a homologação, no caminho sem recurso (RN-20, RN-22 e RF-18): o agente
 * conduz a prova de conceito (se exigida), a habilitação e o registro de intenções; a autoridade competente designada
 * no processo (gestor de demonstração) adjudica e homologa. Sem eles, o avanço da etapa 6 para a 7 é recusado.
 */
async function concluirSelecao(page: Page, autoridade: Page, processoId: string): Promise<void> {
  const base = `/api/v1/processos/${processoId}/selecao`;
  const atos: Partial<Record<string, [Page, string, unknown]>> = {
    convocar_prova_conceito: [page, `${base}/prova-conceito/convocacao`, {}],
    registrar_resultado_prova_conceito: [
      page,
      `${base}/prova-conceito/resultado`,
      { resultado: 'aprovado', motivacao: MOTIVACAO, linkGravacao: 'https://video.orgao.exemplo/sessoes/prova-conceito-radios' },
    ],
    registrar_habilitacao: [page, `${base}/habilitacao`, { resultado: 'habilitado', motivacao: MOTIVACAO }],
    registrar_intencao_recurso: [page, `${base}/recurso/encerrar-intencao`, {}],
    adjudicar: [autoridade, `${base}/adjudicacao`, { motivacao: null }],
    homologar: [autoridade, `${base}/homologacao`, { motivacao: null }],
  };
  let detalhe = (await (await page.request.get(`/api/v1/processos/${processoId}`)).json()) as { selecao: { proximoAto: string } };
  for (let passo = 0; passo < 12 && detalhe.selecao.proximoAto !== 'concluida'; passo++) {
    const ato = atos[detalhe.selecao.proximoAto];
    expect(ato, `ato da seleção sem atalho no teste: ${detalhe.selecao.proximoAto}`).toBeTruthy();
    if (!ato) return;
    const [quem, url, corpo] = ato;
    const resposta = await quem.request.post(url, { headers: { 'x-agora-csrf': await csrf(quem) }, data: corpo });
    expect(resposta.status(), `${url} → ${await resposta.text()}`).toBe(200);
    detalhe = (await resposta.json()) as typeof detalhe;
  }
  expect(detalhe.selecao.proximoAto).toBe('concluida');
}

/** Leva o processo dos rádios à etapa 7 com um vencedor que tem sanção vigente no CEIS (base simulada). */
async function prepararProcessoComVencedorSancionado(page: Page, browser: Browser): Promise<ProcessoLista | null> {
  const token = await csrf(page);
  const cabecalhos = { 'x-agora-csrf': token };
  const buscar = async () => {
    const corpo = (await (await page.request.get('/api/v1/processos?busca=r%C3%A1dios&tamanhoPagina=10')).json()) as { itens: ProcessoLista[] };
    return corpo.itens.find((p) => /rádios digitais/i.test(p.titulo)) ?? null;
  };
  let processo = await buscar();
  if (!processo) return null;
  if (processo.etapaAtual === 5) {
    expect((await page.request.post(`/api/v1/processos/${processo.id}/avancar`, { headers: cabecalhos })).status()).toBe(200);
    processo = await buscar();
  }
  if (processo?.etapaAtual === 6) {
    const mirante = await idFornecedor(page, 'Mirante');
    const vigilant = await idFornecedor(page, 'Vigilant');
    const disputa = await page.request.put(`/api/v1/processos/${processo.id}/disputa`, {
      headers: cabecalhos,
      data: { licitantes: [{ id: mirante, valorProposta: 780_000_000 }, { id: vigilant, valorProposta: 790_000_000 }] },
    });
    expect(disputa.status()).toBe(200);
    const contexto = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    try {
      const autoridade = await contexto.newPage();
      await entrar(autoridade, 'gestor');
      await concluirSelecao(page, autoridade, processo.id);
    } finally {
      await contexto.close();
    }
    expect((await page.request.post(`/api/v1/processos/${processo.id}/avancar`, { headers: cabecalhos })).status()).toBe(200);
    processo = await buscar();
  }
  return processo?.etapaAtual === 7 ? processo : null;
}

test.describe('CEIS, CNEP e certidões (frente C)', () => {
  test('PoC-04 — contratar CNPJ com sanção vigente no CEIS é bloqueado, com a fonte e a data da consulta', async ({ page, browser }) => {
    const erros = monitorarErros(page);
    erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]+\/contratar$/);
    await entrar(page, 'agente');
    const processo = await prepararProcessoComVencedorSancionado(page, browser);
    test.skip(!processo, 'processo dos rádios indisponível para o roteiro');
    await page.goto(`/jornada/${processo?.id ?? ''}`);
    await esperarPaginaOk(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Contrato e gestão', exact: true })).toBeVisible();

    const checklist = page.getByRole('region', { name: 'Regularidade do vencedor' });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText('Irregular — bloqueia o ato')).toBeVisible();
    await expect(checklist.getByText(/Base simulada do CEIS e do CNEP/).first()).toBeVisible();
    await expect(checklist.getByText(/^CEIS: Inidoneidade - Lei 14\.133\/2021/).first()).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 7 com vencedor sancionado no CEIS');

    await page.getByRole('button', { name: 'Contratar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Contratar' });
    await dialogo.getByRole('button', { name: 'Contratar', exact: true }).click();
    await expect(dialogo).toBeHidden();
    const bloqueio = page.getByRole('alert').filter({ hasText: 'A contratação foi bloqueada' });
    await expect(bloqueio).toBeVisible();
    await expect(bloqueio).toContainText('RN-09');
    await expect(bloqueio).toContainText('CEIS: Inidoneidade');
    await expect(page.getByRole('link', { name: /^Abrir o contrato/ })).toHaveCount(0);
    // A tentativa refez a consulta: o checklist mostra a consulta registrada agora, com a fonte.
    await expect(checklist.getByText(/^Consulta:/)).toBeVisible();
    await verificarAcessibilidade(page, 'contratação bloqueada pela RN-09');
    erros.verificar();
  });

  test('certidão vencida bloqueia a prorrogação; certidão nova conferida libera e registra o termo aditivo', async ({ page }) => {
    const erros = monitorarErros(page);
    erros.permitir(422, /\/api\/v1\/contratos\/[0-9a-f-]+\/prorrogacoes$/);
    await entrar(page, 'gestor');
    const contratos = (await (await page.request.get('/api/v1/contratos?busca=Metropolitana&tamanhoPagina=10&ordenarPor=vigenciaFim&ordem=desc')).json()) as {
      itens: { id: string; numero: string; vigenciaFim: string; fornecedor: { id: string; razaoSocial: string } }[];
    };
    const contrato = contratos.itens.find((c) => c.fornecedor.razaoSocial.startsWith('Metropolitana'));
    test.skip(!contrato, 'nenhum contrato da Metropolitana no escopo');
    if (!contrato) return;
    const certidoes = (await (await page.request.get(`/api/v1/fornecedores/${contrato.fornecedor.id}/certidoes`)).json()) as { tipo: string; situacao: string }[];
    const cndtValida = certidoes.some((c) => c.tipo === 'trabalhista' && (c.situacao === 'valida' || c.situacao === 'a_vencer'));

    const prorrogar = async () => {
      await page.goto(`/contratos/${contrato.id}`);
      await esperarPaginaOk(page);
      await page.getByRole('tab', { name: /^Alterações/ }).click();
      await expect(page.getByRole('heading', { name: 'Prorrogação da vigência (RN-09 e RN-33)' })).toBeVisible();
      await page.getByRole('button', { name: 'Registrar prorrogação', exact: true }).click();
      const dialogo = page.getByRole('dialog', { name: 'Registrar prorrogação' });
      await expect(dialogo).toBeVisible();
      await dialogo.getByLabel(/^Nova data de fim da vigência/).fill(somarDias(contrato.vigenciaFim, 365));
      await dialogo
        .getByRole('textbox', { name: /^Justificativa/ })
        .fill('Serviço contínuo com preços vantajosos e execução satisfatória; prorrogação por 12 meses (art. 107).');
      // Travas da RN-33 (frente K), conforme a natureza do contrato: aqui só a regularidade (RN-09) decide.
      const semCulpa = dialogo.getByRole('radio', { name: /^Sem culpa do contratado/ });
      if ((await semCulpa.count()) > 0) await semCulpa.check();
      else for (const nome of [/^O edital prevê/, /^A autoridade atestou/, /^A pesquisa de preços/]) await dialogo.getByRole('checkbox', { name: nome }).check();
      await dialogo.getByRole('checkbox', { name: /^Há crédito orçamentário/ }).check();
      await dialogo.getByRole('button', { name: 'Verificar e prorrogar', exact: true }).click();
      return dialogo;
    };

    if (!cndtValida) {
      const dialogo = await prorrogar();
      const falha = dialogo.getByRole('alert').filter({ hasText: 'A prorrogação não foi registrada' });
      await expect(falha).toBeVisible();
      await expect(falha).toContainText('RN-09');
      await expect(falha).toContainText(/CNDT .*validade expirada/);
      await verificarAcessibilidade(page, 'prorrogação bloqueada por certidão vencida', 'dialog[open]');
      await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(dialogo).toBeHidden();

      // Regularização: o gestor registra a CNDT nova, conferida no sítio do TST.
      await page.goto(`/fornecedores/${contrato.fornecedor.id}`);
      await esperarPaginaOk(page);
      await page.getByRole('tab', { name: /^Regularidade e certidões/ }).click();
      const checklist = page.getByRole('region', { name: 'Checklist de regularidade' });
      await expect(checklist.getByText(/CNDT .*validade expirada/)).toBeVisible();
      await page.getByRole('button', { name: 'Registrar certidão', exact: true }).click();
      const registro = page.getByRole('dialog', { name: 'Registrar certidão' });
      await registro.getByRole('combobox', { name: /^Certidão/ }).selectOption('trabalhista');
      await expect(registro.getByRole('textbox', { name: /^Emissor/ })).toHaveValue('Tribunal Superior do Trabalho');
      await registro.getByRole('textbox', { name: /^Número ou código de controle/ }).fill('CNDT-E2E-000123');
      await registro.getByLabel(/^Data de emissão/).fill(hoje());
      await registro.getByLabel(/^Válida até/).fill(somarDias(hoje(), 180));
      await registro.getByRole('radio', { name: /^Negativa/ }).check();
      await registro.getByRole('checkbox', { name: /^Conferi a autenticidade/ }).check();
      await verificarAcessibilidade(page, 'registro de certidão', 'dialog[open]');
      await registro.getByRole('button', { name: 'Registrar certidão', exact: true }).click();
      await expect(registro).toBeHidden();
      await esperarAviso(page, 'Certidão registrada');
      await expect(page.getByRole('table', { name: /^Certidões registradas/ }).getByText('CNDT-E2E-000123')).toBeVisible();
      await verificarAcessibilidade(page, 'aba de regularidade do fornecedor');
    }

    const dialogo = await prorrogar();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Prorrogação registrada');
    await expect(page.getByRole('table', { name: 'Histórico de alterações' }).getByText(/^Prorrogação/).first()).toBeVisible();
    erros.verificar();
  });

  test('RN-23 — o atesto mostra a regularidade do contratado e registra o recheque', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'fiscal');
    const previstos = (await (await page.request.get('/api/v1/pagamentos?situacao=previsto&tamanhoPagina=1')).json()) as { total: number };
    test.skip(previstos.total === 0, 'nenhum pagamento previsto no escopo do fiscal');
    await page.goto('/financeiro/pagamentos?situacao=previsto');
    await esperarPaginaOk(page);
    const atestar = page.getByRole('button', { name: /^Atestar nota fiscal/ }).first();
    await expect(atestar).toBeVisible();
    await atestar.click();
    const dialogo = page.getByRole('dialog', { name: 'Atestar pagamento' });
    await expect(dialogo.getByRole('region', { name: 'Última verificação registrada' })).toBeVisible();
    await expect(dialogo.getByText(/consulta de novo o CEIS e o CNEP/)).toBeVisible();
    await verificarAcessibilidade(page, 'atesto com recheque de regularidade', 'dialog[open]');
    await dialogo.getByRole('button', { name: 'Atestar pagamento', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, /^Pagamento atestado/);
    erros.verificar();
  });

  test('RN-24 — sanção aplicada sem registro no CEIS/CNEP aparece com prazo vencido e o envio é registrado com protocolo', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'gestor');
    await page.goto('/sancoes');
    await esperarPaginaOk(page);
    const secao = page.getByRole('region', { name: 'Registro no CEIS/CNEP (art. 161)' });
    await expect(secao).toBeVisible();
    const tabela = secao.getByRole('table', { name: 'Sanções aplicadas e o registro no CEIS/CNEP' });
    await expect(tabela.getByRole('row').nth(1)).toBeVisible();
    await verificarAcessibilidade(page, '/sancoes com registro no CEIS/CNEP');
    const registrar = secao.getByRole('button', { name: /^Registrar envio ao CEIS\/CNEP da sanção de Nortecom/ });
    test.skip((await registrar.count()) === 0, 'envio já registrado nesta carga');
    await expect(secao.getByText(/aguardando registro no CEIS\/CNEP/)).toBeVisible();
    await expect(tabela.getByText('Pendente, prazo vencido')).toBeVisible();
    await registrar.click();
    const dialogo = page.getByRole('dialog', { name: 'Registrar envio ao CEIS/CNEP' });
    await dialogo.getByRole('radio', { name: /^CEIS/ }).check();
    await dialogo.getByRole('textbox', { name: /^Protocolo do envio/ }).fill('CGU-E2E-2026-0001');
    await dialogo.getByLabel(/^Data do envio/).fill(hoje());
    await verificarAcessibilidade(page, 'registro do envio ao CEIS/CNEP', 'dialog[open]');
    await dialogo.getByRole('button', { name: 'Registrar envio', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Envio registrado');
    await expect(tabela.getByText('CGU-E2E-2026-0001')).toBeVisible();
    await expect(tabela.getByText('Registrada fora do prazo')).toBeVisible();
    erros.verificar();
  });
});
