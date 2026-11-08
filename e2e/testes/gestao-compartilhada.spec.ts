/**
 * Gestão compartilhada com a sociedade (RF-37; art. 174, § 3º, VI) e dados abertos (RF-38), com dados sintéticos:
 * a cidadã identificada envia mensagem e imagem, a moderação publica com motivo e o texto aparece tarjado na página
 * pública do contrato; o fiscal publica a foto da obra sem os metadados de localização; o CSV de contratos sai sem CPF.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { MARCA_LOCALIZACAO, pngComLocalizacao } from '../../apps/api/test/apoio-midia.ts';
import { validarCpf } from '../../packages/dominio/src/documentos.ts';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, SENHA, verificarAcessibilidade } from './apoio.ts';

const MENSAGEM = 'A calçada ao lado da obra do contrato está sem sinalização desde segunda-feira. Contato: vizinha.sintetica@exemplo.test';

/** Contrato público ainda sem manifestação publicada (a carga de demonstração já tem uma em outro contrato). */
async function contratoSemManifestacao(page: Page): Promise<string> {
  const lista = (await (await page.request.get('/api/v1/publico/contratos?tamanhoPagina=50')).json()) as { itens: { id: string; vigenciaFim: string }[] };
  const hoje = new Date().toISOString().slice(0, 10);
  for (const c of lista.itens.filter((x) => x.vigenciaFim >= hoje)) {
    const gestao = (await (await page.request.get(`/api/v1/publico/contratos/${c.id}/gestao-compartilhada`)).json()) as { manifestacoes: unknown[]; registros: unknown[] };
    if (gestao.manifestacoes.length === 0 && gestao.registros.length === 0) return c.id;
  }
  throw new Error('nenhum contrato vigente sem manifestação nos dados sintéticos');
}

async function semDadosDeLocalizacao(page: Page, url: string): Promise<void> {
  const resposta = await page.request.get(url);
  expect(resposta.ok()).toBe(true);
  const corpo = await resposta.body();
  expect(corpo.includes(Buffer.from(MARCA_LOCALIZACAO, 'latin1'))).toBe(false);
}

test.describe.configure({ mode: 'serial' });

let contratoId = '';

test('cidadã identificada envia mensagem e imagem; a moderação publica com motivo; aparece tarjada no contrato público', async ({ page }) => {
  const erros = monitorarErros(page);
  contratoId = await contratoSemManifestacao(page);
  const paginaPublica = `/transparencia/contratos/${contratoId}`;

  // 1. Cidadã identificada (perfil sem acesso interno) entra e volta para a página pública do contrato.
  await page.goto(`/entrar?retorno=${encodeURIComponent(paginaPublica)}`);
  await page.getByRole('textbox', { name: /^E-mail institucional/ }).fill('cidadao@agora.demo');
  await page.getByRole('textbox', { name: /^Senha/ }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${paginaPublica}$`));
  await esperarPaginaOk(page);

  const envio = page.locator('#enviar-manifestacao');
  await envio.getByRole('combobox', { name: /^Assunto/ }).selectOption({ label: 'Execução do contrato' });
  await envio.getByRole('textbox', { name: /^Mensagem/ }).fill(MENSAGEM);
  await envio.getByLabel(/^Imagem/).setInputFiles({ name: 'calcada.png', mimeType: 'image/png', buffer: pngComLocalizacao() });
  await envio.getByRole('button', { name: 'Enviar manifestação' }).click();
  await expect(envio.getByText('Manifestação recebida')).toBeVisible();
  await expect(envio.getByText(/dados de localização e do aparelho foram retirados/)).toBeVisible();
  await expect(page.locator('#manifestacoes-sociedade').getByText('Nenhuma manifestação publicada sobre este contrato.')).toBeVisible();
  await verificarAcessibilidade(page, '/transparencia/contratos/:id (cidadã)');

  // A cidadã não tem acesso interno: a fila de moderação é negada.
  await page.goto('/sociedade');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acesso não permitido');
  await page.goto('/sociedade/minhas-manifestacoes');
  await esperarPaginaOk(page);
  await expect(page.getByText('Aguardando moderação').first()).toBeVisible();

  // 2. Moderação pelo gestor: publica com motivo.
  await page.context().clearCookies();
  await entrar(page, 'gestor');
  await page.goto('/sociedade');
  await esperarPaginaOk(page);
  const cartao = page.locator('li.sociedade__manifestacao', { hasText: 'A calçada ao lado da obra' });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByText('CPF, e-mail ou telefone do texto foram tarjados na versão pública.')).toBeVisible();
  await verificarAcessibilidade(page, '/sociedade');
  await cartao.getByRole('button', { name: 'Publicar', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Publicar manifestação' });
  await dialogo.getByRole('textbox', { name: /^Motivo da decisão/ }).fill('Relato pertinente à execução, sem dado pessoal de terceiros.');
  await dialogo.getByRole('button', { name: 'Publicar', exact: true }).click();
  await esperarAviso(page, 'Manifestação publicada');

  // 3. Público, sem login: mensagem tarjada, autora só com as iniciais e imagem sem localização.
  await page.context().clearCookies();
  await page.goto(paginaPublica);
  await esperarPaginaOk(page);
  const publicadas = page.locator('#manifestacoes-sociedade');
  await expect(publicadas.getByText('A calçada ao lado da obra do contrato está sem sinalização')).toBeVisible();
  await expect(publicadas.getByText('Antônia R. C.')).toBeVisible();
  await expect(publicadas.getByText('vizinha.sintetica@exemplo.test')).toHaveCount(0);
  await expect(publicadas.getByText('Ribeiro Carvalho')).toHaveCount(0);
  const imagem = publicadas.getByRole('img', { name: 'Imagem enviada por Antônia R. C.' });
  await expect(imagem).toBeVisible();
  await semDadosDeLocalizacao(page, (await imagem.getAttribute('src')) ?? '');
  await verificarAcessibilidade(page, '/transparencia/contratos/:id (público)');
  erros.verificar();
});

test('fiscal publica a foto da obra; a página pública mostra a foto sem metadados de localização', async ({ page }) => {
  const erros = monitorarErros(page);
  test.skip(contratoId === '', 'depende do contrato escolhido no teste anterior');
  await entrar(page, 'fiscal.obras');
  await page.goto(`/sociedade/contratos/${contratoId}`);
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Publicar foto ou vídeo' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Publicar foto ou vídeo da execução' });
  await dialogo.getByLabel(/^Foto ou vídeo/).setInputFiles({ name: 'frente-de-obra.png', mimeType: 'image/png', buffer: pngComLocalizacao([40, 120, 60]) });
  await dialogo.getByRole('textbox', { name: /^Título/ }).fill('Frente de obra — fundações do bloco B');
  await dialogo.getByRole('button', { name: 'Publicar registro' }).click();
  await esperarAviso(page, 'Registro publicado');
  await expect(page.locator('#registros-execucao').getByText('Publicado', { exact: true })).toBeVisible();
  await verificarAcessibilidade(page, '/sociedade/contratos/:id');

  await page.context().clearCookies();
  await page.goto(`/transparencia/contratos/${contratoId}`);
  await esperarPaginaOk(page);
  const foto = page.locator('#acompanhamento-execucao').getByRole('img', { name: 'Frente de obra — fundações do bloco B' });
  await expect(foto).toBeVisible();
  await semDadosDeLocalizacao(page, (await foto.getAttribute('src')) ?? '');
  erros.verificar();
});

test('dados abertos: página pública sem login e CSV de contratos sem CPF, com hash conferível', async ({ page }) => {
  const erros = monitorarErros(page);
  await page.goto('/dados-abertos');
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dados abertos');
  for (const titulo of ['Editais publicados', 'Contratos', 'Atas de registro de preços', 'Termos aditivos', 'Pagamentos na ordem cronológica', 'Sanções aplicadas']) {
    await expect(page.getByRole('heading', { level: 2, name: titulo, exact: true })).toBeVisible();
  }
  await verificarAcessibilidade(page, '/dados-abertos');

  const secao = page.locator('#conjunto-contratos');
  const link = secao.getByRole('link', { name: /^Baixar CSV de contratos/ });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const caminho = await download.path();
  const conteudo = await readFile(caminho);
  const texto = conteudo.toString('utf8');
  expect(texto.split('\r\n')[0]).toContain('fornecedor_cnpj');
  expect(texto.split('\r\n').length).toBeGreaterThan(10);
  expect(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/.test(texto), 'CPF formatado no CSV').toBe(false);
  const onzeDigitos = [...texto.matchAll(/(?<!\d)\d{11}(?!\d)/g)].map((m) => m[0]);
  expect(onzeDigitos.filter((d) => validarCpf(d)), 'CPF sem pontuação no CSV').toEqual([]);
  const hash = createHash('sha256').update(conteudo).digest('hex');
  await expect(secao.getByText(hash).first()).toBeVisible();
  erros.verificar();
});
