/**
 * Costura transversal (Frente Y) com dados sintéticos: um processo novo é classificado como informação secreta; quem
 * não tem credencial (jurídico) vê "Informação classificada" com o grau na lista de processos e não o acha pelo texto
 * real, enquanto o órgão de controle vê o título. O relatório LGPD reúne o acesso a um documento com dado pessoal e os
 * acessos à informação sigilosa, sem CPF.
 */
import { expect, test, type Page } from '@playwright/test';
import { gerarPdfTexto } from '../../apps/api/src/compartilhado/pdf-texto.ts';
import { entrar, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

const TITULO = 'Aquisição de embarcações blindadas sintéticas para a costura transversal';

async function csrf(page: Page): Promise<string> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  return sessao.csrfToken;
}

async function criarProcesso(page: Page): Promise<string> {
  const resposta = await page.request.post('/api/v1/processos', { data: { titulo: TITULO, orgao: 'PF' }, headers: { 'x-agora-csrf': await csrf(page) } });
  expect(resposta.status(), await resposta.text()).toBeLessThan(300);
  return ((await resposta.json()) as { id: string }).id;
}

async function classificarProcesso(page: Page, id: string): Promise<void> {
  const resposta = await page.request.post(`/api/v1/processos/${id}/sigilo/classificacoes`, {
    headers: { 'x-agora-csrf': await csrf(page) },
    data: {
      alvo: 'processo',
      tipo: 'lai',
      grau: 'secreta',
      hipotese: 'VIII',
      razoes: 'Especificações táticas do equipamento policial cuja divulgação compromete operações de segurança pública em andamento.',
      dataProducao: '2026-01-02',
      prazoFim: '2036-01-02',
      eventoFim: null,
      autoridade: { nome: 'Autoridade Sintética Souza', cargo: 'Diretor-Geral', nivel: 'titular_entidade', atoDelegacao: null },
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(200);
}

test('sem credencial, a lista de processos mostra "Informação classificada" com o grau e a busca não acha o texto real', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await criarProcesso(page);
  await classificarProcesso(page, id);
  await page.context().clearCookies();

  await entrar(page, 'juridico');
  await page.goto('/jornada?busca=blindadas');
  await esperarPaginaOk(page);
  await expect(page.getByText(TITULO)).toHaveCount(0);
  await expect(page.getByText('Informação classificada')).toHaveCount(0);

  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await expect(page.getByText(/Informação classificada \(secreta\)/).first()).toBeVisible();
  await expect(page.getByText(TITULO)).toHaveCount(0);
  await verificarAcessibilidade(page, '/jornada com processo classificado');
  await page.context().clearCookies();

  // Órgão de controle: acesso irrestrito, vê o título real.
  await entrar(page, 'controle');
  await page.goto('/jornada?busca=blindadas');
  await esperarPaginaOk(page);
  await expect(page.getByText(TITULO).first()).toBeVisible();
  erros.verificar();
});

test('o relatório LGPD lista um acesso a documento com dado pessoal e os acessos a informação sigilosa, sem CPF', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  const id = await criarProcesso(page);
  const pdf = gerarPdfTexto({ titulo: 'Documento sintético', conteudo: '# DOCUMENTO\n\nTexto sintético com dado pessoal fictício para teste.' });
  const envio = await page.request.post(`/api/v1/processos/${id}/arquivos?categoria=processo&tipo=documento_processo&titulo=${encodeURIComponent('Documento sintético do titular')}&contemDadoPessoal=true`, {
    headers: { 'x-agora-csrf': await csrf(page), 'content-type': 'application/octet-stream', 'x-agora-nome-arquivo': 'documento.pdf' },
    data: pdf,
  });
  expect(envio.status(), await envio.text()).toBe(201);
  const arquivo = (await envio.json()) as { id: string };
  const baixado = await page.request.post(`/api/v1/processos/${id}/arquivos/${arquivo.id}/baixar`, {
    headers: { 'x-agora-csrf': await csrf(page) },
    data: { finalidade: 'Conferência do documento do titular na instrução' },
  });
  expect(baixado.status()).toBe(200);
  await page.context().clearCookies();

  await entrar(page, 'auditoria.externa');
  await page.goto('/auditoria/lgpd');
  await esperarPaginaOk(page);
  const tabela = page.getByRole('table', { name: 'Registros de acesso a dados pessoais' });
  const linha = tabela.getByRole('row').filter({ hasText: 'Conferência do documento do titular na instrução' });
  await expect(linha).toContainText('Documento com dado pessoal');
  await expect(linha).toContainText('Beatriz Lacerda Fontes');
  await expect(page.getByText(/\d{3}\.\d{3}\.\d{3}-\d{2}/)).toHaveCount(0);
  await verificarAcessibilidade(page, '/auditoria/lgpd com acessos de documento');
  erros.verificar();
});
