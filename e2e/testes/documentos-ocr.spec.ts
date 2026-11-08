/**
 * PoC-03 (parte de OCR/NLP) com dados sintéticos: o agente de contratação envia dois atestados de um licitante,
 * a Ágora lê os quantitativos (camada de texto do PDF; o caminho do PDF digitalizado é coberto nos testes da API
 * com o serviço de OCR simulado), soma os atestados e compara com o mínimo do edital — como sinal com trecho-fonte,
 * que requer revisão humana.
 */
import { expect, test, type Page } from '@playwright/test';
import { gerarPdfTexto } from '../../apps/api/src/compartilhado/pdf-texto.ts';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ProcessoLista {
  id: string;
  etapaAtual: number;
}

async function processoNaEtapa(page: Page, etapa: number): Promise<ProcessoLista | undefined> {
  const resposta = await page.request.get('/api/v1/processos?tamanhoPagina=100');
  const corpo = (await resposta.json()) as { itens: ProcessoLista[] };
  return corpo.itens.find((p) => p.etapaAtual === etapa);
}

function atestado(orgao: string, linha: string): Buffer {
  return gerarPdfTexto({
    titulo: `Atestado de capacidade técnica — ${orgao}`,
    conteudo: ['# ATESTADO DE CAPACIDADE TÉCNICA', '', linha, '', `Emitido por ${orgao} (documento sintético de teste).`].join('\n'),
  });
}

const ATESTADO_A = atestado('Órgão estadual fictício A', 'Atestamos que a empresa forneceu 400 (quatrocentos) coletes balísticos nível III-A, com execução satisfatória.');
const ATESTADO_B = atestado('Órgão municipal fictício B', 'Atestamos o fornecimento de 350 (trezentos e cinquenta) coletes balísticos, entregues no prazo contratado.');

async function enviarAtestado(page: Page, arquivo: { nome: string; conteudo: Buffer }, titulo: string, licitante: string): Promise<void> {
  await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Enviar documento' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel(/^Arquivo/).setInputFiles({ name: arquivo.nome, mimeType: 'application/pdf', buffer: arquivo.conteudo });
  await dialogo.getByRole('combobox', { name: /^Licitante/ }).selectOption({ label: licitante });
  await dialogo.getByRole('textbox', { name: /^Título/ }).fill(titulo);
  await dialogo.getByRole('button', { name: 'Enviar documento', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Documento recebido');
}

test('PoC-03 — atestados sintéticos em PDF: quantitativos extraídos, com página e linha, e somados por licitante', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  const processo = await processoNaEtapa(page, 6);
  test.skip(!processo, 'nenhum processo na etapa 6 nos dados sintéticos');
  await page.goto(`/jornada/${processo?.id ?? ''}`);
  await esperarPaginaOk(page);
  await page.getByRole('link', { name: 'Documentos e habilitação', exact: true }).click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}\/documentos$/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Documentos e habilitação');

  // Exigências do edital (RN-25): parcela de maior relevância com mínimo de 50%.
  const exigencias = page.getByRole('table', { name: 'Parcelas de maior relevância' });
  await expect(exigencias.getByText('Dentro do art. 67')).toBeVisible();
  await expect(exigencias.getByText('(50%)')).toBeVisible();
  await verificarAcessibilidade(page, '/jornada/:id/documentos');

  await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Enviar documento' });
  const licitantes = dialogo.getByRole('combobox', { name: /^Licitante/ }).locator('option:not([value=""])');
  const licitante = ((await licitantes.first().textContent()) ?? '').trim();
  expect(licitante).not.toBe('');
  await verificarAcessibilidade(page, 'envio de documento', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialogo).toBeHidden();

  await enviarAtestado(page, { nome: 'atestado-orgao-a.pdf', conteudo: ATESTADO_A }, 'Atestado do órgão estadual A', licitante);
  await enviarAtestado(page, { nome: 'atestado-orgao-b.pdf', conteudo: ATESTADO_B }, 'Atestado do órgão municipal B', licitante);

  const documentos = page.getByRole('table', { name: /^Documentos do processo/ });
  await expect(documentos.getByRole('row')).toHaveCount(3);
  await expect(documentos.getByText('Ainda não lido')).toHaveCount(2);

  await page.getByRole('button', { name: 'Ler atestado Atestado do órgão estadual A', exact: true }).click();
  await esperarAviso(page, 'Leitura concluída');
  await page.getByRole('button', { name: 'Ler atestado Atestado do órgão municipal B', exact: true }).click();
  await expect(documentos.getByText('1 quantitativo por camada de texto')).toHaveCount(2);

  // Soma por licitante: 400 + 350 = 750 coletes, acima do mínimo de 600, com os trechos-fonte.
  const soma = page.getByRole('table', { name: `Quantitativos somados — ${licitante}` });
  const linha = soma.getByRole('row').filter({ hasText: 'Colete' });
  await expect(linha.getByRole('cell').nth(1)).toHaveText('750 unidades');
  await expect(linha.getByText('Alcança o mínimo')).toBeVisible();
  await expect(linha.getByText(/Página 1, linha 2: “Atestamos que a empresa forneceu 400 \(quatrocentos\) coletes/)).toBeVisible();
  await expect(linha.getByText(/Página 1, linha 2: “Atestamos o fornecimento de 350 \(trezentos e cinquenta\) coletes/)).toBeVisible();
  const cartao = page.getByRole('region', { name: licitante, exact: true });
  await expect(cartao.getByText('Indica atendimento')).toBeVisible();
  await expect(page.getByText('Sinal para apoio à análise — requer revisão humana')).toBeVisible();
  await verificarAcessibilidade(page, 'leitura assistida com resultado');
  erros.verificar();
});

test('PoC-03 — perfil sem permissão de documentos: o servidor nega e a página não mostra os documentos', async ({ page }) => {
  // Financeiro não tem documentos:ler (o fiscal tem a senha trocada por conta.spec.ts na suíte completa).
  await entrar(page, 'financeiro');
  const resposta = await page.request.get('/api/v1/processos/00000000-0000-4000-8000-000000000000/arquivos');
  expect(resposta.status()).toBe(403);
  await page.goto('/jornada/00000000-0000-4000-8000-000000000000/documentos');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: /^Documentos do processo/ })).toHaveCount(0);
});
