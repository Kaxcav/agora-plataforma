/**
 * Costura da execução contratual (frentes K, L, M e N ligadas entre si), com dados sintéticos:
 * 1) o recebimento definitivo de uma entrega aparece na prévia da avaliação de desempenho do contrato (art. 88, § 3º);
 * 2) a prorrogação assinada deixa a renovação da garantia pendente na aba Garantias (art. 96).
 * Contas usadas: gestor e fiscal.tecnico (as contas fiscal e auditor trocam de senha em outro arquivo).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrar, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ContratoLista {
  id: string;
  numero: string;
  fornecedor: { razaoSocial: string };
}

interface Execucao {
  parametros: unknown;
  recebimentos: unknown[];
  garantias: { id: string; valorExigido: number; situacao: string; movimentos: { tipo: string; descricao: string }[] }[];
  notasDisponiveis: unknown[];
  multas: unknown[];
}

interface Servidor {
  id: string;
  nome: string;
}

/** Fornecedores que os testes da frente C usam para as travas de regularidade: ficam de fora. */
const RESERVADOS = /^(Metropolitana|Mirante|Amazônia)/;
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const usados = new Set<string>();

function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

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

async function enviar(page: Page, url: string, corpo: unknown): Promise<{ status: number; json: unknown }> {
  const r = await page.request.post(url, { headers: { 'x-agora-csrf': await csrf(page) }, data: corpo });
  return { status: r.status(), json: await r.json().catch(() => null) };
}

async function execucaoDe(page: Page, id: string): Promise<Execucao> {
  return (await (await page.request.get(`/api/v1/contratos/${id}/execucao`)).json()) as Execucao;
}

async function contratosVigentes(page: Page): Promise<ContratoLista[]> {
  const { itens } = (await (await page.request.get('/api/v1/contratos?situacao=vigente&tamanhoPagina=100&ordenarPor=numero&ordem=desc')).json()) as { itens: ContratoLista[] };
  return itens.filter((c) => !usados.has(c.id) && !RESERVADOS.test(c.fornecedor.razaoSocial));
}

test('o recebimento definitivo da entrega aparece na prévia da avaliação de desempenho do contrato', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');

  // Prefere contrato sem nota prevista: os outros arquivos escolhem contratos com nota para o fluxo do atesto.
  let contrato: ContratoLista | null = null;
  let ultimoRecurso: ContratoLista | null = null;
  for (const c of await contratosVigentes(page)) {
    const e = await execucaoDe(page, c.id);
    if (e.parametros === null || e.recebimentos.length > 0) continue;
    if (e.notasDisponiveis.length === 0) {
      contrato = c;
      break;
    }
    ultimoRecurso ??= c;
  }
  contrato ??= ultimoRecurso;
  test.skip(!contrato, 'nenhum contrato vigente com parâmetros de execução e sem entregas');
  if (!contrato) return;
  usados.add(contrato.id);

  // Fiscalização: o fiscal técnico e a comissão de recebimento são designados pelo gestor.
  const servidores = (await (await page.request.get(`/api/v1/contratos/${contrato.id}/designaveis`)).json()) as Servidor[];
  const fiscal = servidores.find((s) => s.nome === 'Tiago Rangel Assunção');
  const comissao = servidores.find((s) => s.nome === 'Rafael Antunes Veloso');
  expect(fiscal, 'fiscal técnico designável').toBeTruthy();
  expect(comissao, 'comissão de recebimento designável').toBeTruthy();
  for (const [papel, servidor] of [
    ['fiscal_tecnico', fiscal],
    ['comissao_recebimento', comissao],
  ] as const) {
    const r = await enviar(page, `/api/v1/contratos/${contrato.id}/designacoes`, { papel, usuarioId: servidor?.id, ato: 'Portaria sintética nº 701/2026', inicio: HOJE });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
  }

  const entrega = await enviar(page, `/api/v1/contratos/${contrato.id}/recebimentos`, {
    descricao: 'Entrega sintética para a costura da avaliação de desempenho',
    valor: 100_000,
    entregueEm: HOJE,
    pagamentoId: null,
  });
  expect(entrega.status, JSON.stringify(entrega.json)).toBe(201);
  const recebimentoId = (entrega.json as { id: string }).id;

  const fiscalTecnico = await sessaoDe(browser, 'fiscal.tecnico');
  const provisorio = await enviar(fiscalTecnico, `/api/v1/recebimentos/${recebimentoId}/termos`, { tipo: 'provisorio', resultado: 'aceito', data: HOJE, observacoes: null });
  expect(provisorio.status, JSON.stringify(provisorio.json)).toBe(201);
  await fiscalTecnico.context().close();
  const definitivo = await enviar(page, `/api/v1/recebimentos/${recebimentoId}/termos`, { tipo: 'definitivo', resultado: 'aceito', data: HOJE, observacoes: null });
  expect(definitivo.status, JSON.stringify(definitivo.json)).toBe(201);

  // Avaliação de desempenho: a prévia já traz o recebimento sem ressalva, e as contagens vêm preenchidas.
  await page.goto(`/contratos/${contrato.id}`);
  await esperarPaginaOk(page);
  await page.getByRole('tab', { name: 'Avaliação de desempenho' }).click();
  await page.getByRole('button', { name: 'Emitir avaliação de desempenho', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: `Avaliação de desempenho — Contrato ${contrato.numero}` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('Dados do período registrados na Ágora')).toBeVisible();
  await expect(dialogo.getByText(/Recebimentos sem ressalva: [1-9]\d*\/[1-9]\d*\./)).toBeVisible();
  await expect(dialogo.getByText(/Entregas no prazo: [1-9]\d*\/[1-9]\d*\./)).toBeVisible();
  await expect(dialogo.getByRole('textbox', { name: /^Total de recebimentos/ })).toHaveValue(/^[1-9]\d*$/);
  await verificarAcessibilidade(page, 'prévia da avaliação de desempenho com os recebimentos');
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogo).toHaveCount(0);

  // A mesma contagem vem da API (dados derivados no servidor, não digitados).
  const previa = (await (await page.request.get(`/api/v1/contratos/${contrato.id}/avaliacoes-desempenho/previa?periodoInicio=${somarDias(HOJE, -5)}&periodoFim=${HOJE}`)).json()) as {
    recebimentos: { total: number; aprovados: number };
  };
  expect(previa.recebimentos.aprovados).toBeGreaterThanOrEqual(1);
  erros.verificar();
});

test('a prorrogação assinada deixa a renovação da garantia pendente na aba Garantias', async ({ page }) => {
  test.setTimeout(180_000);
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/contratos\/[0-9a-f-]+\/prorrogacoes$/);
  await entrar(page, 'gestor');

  const travas = { vantajosidadeAtestada: true, precoCompativel: true, previsaoEdital: true, creditoOrcamentario: true };
  let escolhido: ContratoLista | null = null;
  let garantiaId = '';
  for (const c of await contratosVigentes(page)) {
    const e = await execucaoDe(page, c.id);
    if (e.garantias.length > 0 || e.multas.length > 0) continue;
    const detalhe = (await (await page.request.get(`/api/v1/contratos/${c.id}`)).json()) as { idPncp: string | null; vigenciaFim: string };
    if (!detalhe.idPncp) continue;
    const regularidade = (await (await page.request.get(`/api/v1/contratos/${c.id}/regularidade?momento=assinatura`)).json()) as { bloqueia: boolean };
    if (regularidade.bloqueia) continue;
    const painel = (await (await page.request.get(`/api/v1/contratos/${c.id}/alteracoes`)).json()) as { alteracoes: { situacao: string }[] };
    if (painel.alteracoes.some((a) => ['aguardando_parecer', 'pronto_para_assinatura', 'em_contraditorio', 'aguardando_decisao'].includes(a.situacao))) continue;

    // Garantia de execução apresentada, com validade que não cobre a vigência prorrogada.
    const exigencia = await enviar(page, `/api/v1/contratos/${c.id}/garantias`, {
      finalidade: 'execucao',
      percentual: 5,
      grandeVultoEngenharia: false,
      clausulaRetomada: false,
      modalidadeExigida: null,
      prazoApresentacao: somarDias(HOJE, 10),
    });
    if (exigencia.status !== 201) continue;
    const garantia = (await execucaoDe(page, c.id)).garantias[0];
    if (!garantia) continue;
    const apresentacao = await enviar(page, `/api/v1/garantias/${garantia.id}/apresentacao`, {
      modalidade: 'seguro_garantia',
      valor: garantia.valorExigido,
      apresentadaEm: HOJE,
      validaAte: somarDias(HOJE, 20),
      emissor: 'Seguradora Sintética de Teste S.A.',
      documento: 'Apólice sintética 2026-002',
    });
    if (apresentacao.status !== 200 && apresentacao.status !== 201) continue;

    const prorrogacao = await enviar(page, `/api/v1/contratos/${c.id}/prorrogacoes`, {
      novaVigenciaFim: somarDias(detalhe.vigenciaFim, 365),
      valor: 0,
      justificativa: 'Prorrogação por mais 12 meses do serviço contínuo, com vantajosidade atestada (dados sintéticos).',
      ...travas,
    });
    if (prorrogacao.status !== 201) continue;
    usados.add(c.id);
    escolhido = c;
    garantiaId = garantia.id;
    break;
  }
  test.skip(!escolhido, 'nenhum contrato permitiu a prorrogação com garantia apresentada');
  if (!escolhido || !garantiaId) return;

  await page.goto(`/contratos/${escolhido.id}?aba=garantias`);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { name: 'Garantias' }).first()).toBeVisible();
  await page.getByText(/^Movimentos da garantia/).first().click();
  await expect(page.getByText(/Renovação exigida pela prorrogação da vigência/)).toBeVisible();
  await verificarAcessibilidade(page, 'aba Garantias com a renovação exigida pela prorrogação');

  // A pendência de renovação fica ligada à garantia e aparece na lista de pendências do contrato.
  const execucao = await execucaoDe(page, escolhido.id);
  const movimentos = execucao.garantias.find((g) => g.id === garantiaId)?.movimentos ?? [];
  expect(movimentos.some((m) => m.tipo === 'exigencia' && /Renovação exigida/.test(m.descricao))).toBe(true);
  const pendencias = (await (await page.request.get(`/api/v1/pendencias?tamanhoPagina=100&busca=${encodeURIComponent(escolhido.numero)}`)).json()) as { itens?: { motivo: string }[] };
  expect((pendencias.itens ?? []).some((p) => /Renovação da garantia de execução/.test(p.motivo))).toBe(true);
  erros.verificar();
});
