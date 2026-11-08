/**
 * Frente F — vínculos entre licitantes (RIA-06 e RIA-10), extensão de sanção (RN-27, art. 160) e declarações dos
 * agentes (RN-28, arts. 7º e 9º). Dados sintéticos; cada teste prepara o que precisa, sem depender da ordem dos arquivos.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

/** Chamada à API da Ágora com a sessão do navegador e o token CSRF (preparação de dados do teste). */
async function chamarApi<T>(page: Page, metodo: 'POST' | 'PUT', url: string, corpo?: unknown): Promise<T> {
  const sessao = (await (await page.request.get('/api/v1/sessao')).json()) as { csrfToken: string };
  const resposta = await page.request.fetch(url, { method: metodo, headers: { 'x-agora-csrf': sessao.csrfToken }, data: corpo ?? {} });
  expect(resposta.ok(), `${metodo} ${url} → ${resposta.status()} ${await resposta.text()}`).toBeTruthy();
  return (await resposta.json()) as T;
}

async function trocarUsuario(page: Page, perfil: string): Promise<void> {
  await page.context().clearCookies();
  await entrar(page, perfil);
}

test('PoC-03 — quatro licitantes, dois com vínculo de parentesco registrado com evidência: o sinal aparece com as evidências', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Vínculos e impedimentos' }).click();
  await expect(page).toHaveURL(/\/impedimentos$/);
  await esperarPaginaOk(page);
  await verificarAcessibilidade(page, '/impedimentos');

  // Vínculo de fonte lícita, com fonte e evidência (nada é deduzido por cruzamento de dados pessoais).
  await page.getByRole('region', { name: 'Vínculos registrados' }).getByRole('button', { name: 'Registrar vínculo', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Registrar vínculo' });
  await dialogo.getByRole('searchbox', { name: 'Buscar fornecedor' }).fill('Guardião');
  await dialogo.getByRole('radio', { name: /^Guardião Uniformes/ }).check();
  await dialogo.getByRole('searchbox', { name: 'Buscar outro fornecedor' }).fill('Fortaleza');
  await dialogo.getByRole('radio', { name: /^Fortaleza Blindagens/ }).check();
  await dialogo.getByRole('combobox', { name: /^Natureza do vínculo/ }).selectOption('parentesco');
  await dialogo.getByRole('radio', { name: '3º grau' }).check();
  await dialogo.getByRole('radio', { name: /^Informado por agente público/ }).check();
  await dialogo.getByRole('textbox', { name: /^Descrição do vínculo/ }).fill('Os sócios-administradores das duas empresas são tio e sobrinho.');
  await dialogo.getByRole('textbox', { name: /^Evidência/ }).fill('Certidões de nascimento juntadas ao processo SEI nº 0000001 (documento sintético).');
  await verificarAcessibilidade(page, 'registrar vínculo', 'dialog[open]');
  await dialogo.getByRole('button', { name: 'Registrar vínculo', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Vínculo registrado');

  // Sessão com quatro licitantes: dois deles ligados pelo vínculo registrado.
  const analise = page.getByRole('region', { name: 'Analisar vínculos entre licitantes' });
  const filtro = analise.getByRole('searchbox', { name: 'Filtrar fornecedores' });
  for (const [busca, nome] of [
    ['Guardião', /^Guardião Uniformes/],
    ['Fortaleza', /^Fortaleza Blindagens/],
    ['Calibre', /^Calibre Sul/],
    ['Planalto', /^Planalto EPI/],
  ] as const) {
    await filtro.fill(busca);
    await analise.getByRole('checkbox', { name: nome }).check();
  }
  await expect(analise.getByRole('list', { name: 'Fornecedores selecionados' }).getByRole('listitem')).toHaveCount(4);
  await analise.getByRole('button', { name: 'Analisar vínculos', exact: true }).click();

  const sinais = analise.getByRole('list', { name: 'Sinais da análise' });
  const sinal = sinais.locator(':scope > li').filter({ has: page.getByRole('heading', { name: 'Vínculo entre licitantes (RIA-10)' }) });
  await expect(sinal).toHaveCount(1);
  await expect(sinal).toContainText('Risco');
  await expect(sinal).toContainText('Requer revisão humana');
  await expect(sinal).toContainText('parentesco de 3º grau');
  await expect(sinal).toContainText('Certidões de nascimento juntadas ao processo SEI nº 0000001');
  await expect(sinal).toContainText('Informado por agente público');
  await expect(analise.getByText(/^Licitantes ligados entre si:/)).toContainText('Fortaleza Blindagens');
  await verificarAcessibilidade(page, 'resultado da análise de vínculos');
  erros.verificar();
});

test('extensão de sanção do sinal à decisão: contraditório, análise jurídica prévia e decisão da autoridade, com registro em sanções', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  await page.goto('/impedimentos');
  await esperarPaginaOk(page);

  // Sinal de possível sucessão: empresa recém-aberta com o sócio-administrador e o endereço da impedida.
  const sucessoes = page.getByRole('list', { name: 'Possíveis sucessões' });
  const sinal = sucessoes.locator(':scope > li').filter({ hasText: 'Nortelink' });
  await expect(sinal).toContainText('Requer revisão humana');
  await expect(sinal).toContainText('art. 160');
  await sinal.getByRole('button', { name: 'Propor extensão da sanção', exact: true }).click();
  const proposta = page.getByRole('dialog', { name: 'Propor extensão da sanção' });
  await expect(proposta.getByRole('radio', { name: /^Pessoa jurídica sucessora: Nortelink/ })).toBeChecked();
  await proposta
    .getByRole('textbox', { name: /^Fundamentação/ })
    .fill('Empresa aberta depois da instauração do processo, com o mesmo sócio-administrador e o mesmo endereço da impedida, conforme o cadastro do CNPJ.');
  await verificarAcessibilidade(page, 'propor extensão', 'dialog[open]');
  await proposta.getByRole('button', { name: 'Abrir o contraditório', exact: true }).click();
  await esperarAviso(page, 'Proposta de extensão registrada');
  await expect(page).toHaveURL(/\/impedimentos\/extensoes\/[0-9a-f-]{36}$/);
  const url = page.url();
  await esperarPaginaOk(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Extensão de sanção' })).toBeVisible();
  await expect(page.getByText('Contraditório e ampla defesa').first()).toBeVisible();
  await verificarAcessibilidade(page, 'extensão em contraditório');

  await page.getByRole('radio', { name: 'Defesa apresentada', exact: true }).check();
  await page.getByRole('textbox', { name: /^Resumo da defesa/ }).fill('A empresa alega ser independente da impedida e junta contrato social.');
  await page.getByRole('button', { name: 'Registrar defesa', exact: true }).click();
  await esperarAviso(page, 'Defesa registrada');
  await expect(page.getByText('Aguardando a análise jurídica prévia.')).toBeVisible();

  // Análise jurídica prévia: assessoria jurídica, que não propôs.
  await trocarUsuario(page, 'juridico');
  await page.goto(url);
  await esperarPaginaOk(page);
  await page.getByRole('radio', { name: 'Favorável à extensão', exact: true }).check();
  await page.getByRole('textbox', { name: /^Parecer/ }).fill('Há indícios suficientes de sucessão para burlar a sanção; a extensão é juridicamente viável.');
  await page.getByRole('button', { name: 'Registrar parecer', exact: true }).click();
  await esperarAviso(page, 'Parecer registrado');
  await expect(page.getByText('Aguardando decisão da autoridade').first()).toBeVisible();

  // Decisão: autoridade que não propôs nem deu o parecer.
  await trocarUsuario(page, 'admin');
  await page.goto(url);
  await esperarPaginaOk(page);
  await page.getByRole('radio', { name: 'Estender os efeitos da sanção', exact: true }).check();
  await page.getByRole('textbox', { name: /^Motivação/ }).fill('Comprovada a sucessão com abuso da personalidade jurídica, acolho o parecer jurídico.');
  await page.getByRole('button', { name: 'Registrar decisão', exact: true }).click();
  const confirmar = page.getByRole('dialog', { name: 'Confirmar a decisão' });
  await confirmar.getByRole('button', { name: 'Confirmar decisão', exact: true }).click();
  await expect(confirmar).toBeHidden();
  await esperarAviso(page, 'Decisão registrada');
  await expect(page.getByText('Sanção estendida por decisão da autoridade competente')).toBeVisible();
  await verificarAcessibilidade(page, 'extensão decidida');

  await page.getByRole('link', { name: 'Ver no módulo de sanções' }).click();
  await esperarPaginaOk(page);
  await expect(page.getByRole('table', { name: /Processos sancionatórios/ }).getByRole('row').filter({ hasText: 'Nortelink' })).toHaveCount(1);
  erros.verificar();
});

test('RN-28 — agente sem declaração não consegue atuar: a designação é recusada até a declaração ser assinada', async ({ page }) => {
  const erros = monitorarErros(page);
  erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]{36}\/equipe$/);
  await entrar(page, 'agente');
  const processo = await chamarApi<{ id: string }>(page, 'POST', '/api/v1/processos', { titulo: 'Aquisição de lanternas táticas para o patrulhamento', orgao: 'PRF' });
  await chamarApi(page, 'PUT', `/api/v1/processos/${processo.id}/dfd`, {
    descricaoNecessidade: 'Equipar as equipes de patrulhamento noturno com lanternas táticas recarregáveis e padronizadas.',
    justificativa: 'As lanternas atuais estão danificadas e sem reposição, o que compromete a segurança das abordagens noturnas.',
    itens: [{ catmat: null, descricao: 'Lanterna tática recarregável de 1000 lúmens', unidade: 'unidade', quantidade: 200, valorUnitarioEstimado: 25_000 }],
    usaCatalogoPadronizado: true,
    justificativaNaoPadronizacao: null,
    justificativaArtigoLuxo: null,
    previstoNoPca: true,
    tipoObjeto: 'bens',
  });
  await chamarApi(page, 'POST', `/api/v1/processos/${processo.id}/avancar`);

  const designarAgente = async () => {
    await page.goto(`/jornada/${processo.id}`);
    await esperarPaginaOk(page);
    await page.getByRole('button', { name: 'Adicionar designação', exact: true }).click();
    await page.getByRole('combobox', { name: 'Papel da designação 1' }).selectOption('fiscal_tecnico');
    const servidor = page.getByRole('combobox', { name: 'Servidor da designação 1' });
    const marcos = await servidor.getByRole('option', { name: /^Marcos Teles Coutinho/ }).getAttribute('value');
    await servidor.selectOption(marcos ?? '');
    await page.getByRole('button', { name: 'Salvar designações', exact: true }).click();
  };

  await designarAgente();
  const recusa = page.getByRole('alert').filter({ hasText: 'Não foi possível salvar a equipe' });
  await expect(recusa).toContainText('RN-28');
  await expect(recusa).toContainText('Marcos Teles Coutinho: Não há declaração de inexistência de impedimento assinada');
  await verificarAcessibilidade(page, 'designação recusada (RN-28)');

  // O próprio agente declara.
  await trocarUsuario(page, 'financeiro');
  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Minha declaração de impedimentos' }).click();
  await esperarPaginaOk(page);
  await expect(page.getByText('Você ainda não assinou a declaração')).toBeVisible();
  await verificarAcessibilidade(page, '/impedimentos/declaracao (sem declaração)');
  await page.getByRole('checkbox', { name: /^Declaro que não sou cônjuge/ }).check();
  await page.getByRole('checkbox', { name: /^Declaro que não participo/ }).check();
  await page.getByRole('radio', { name: 'Tem atribuições relacionadas a licitações e contratos' }).check();
  await page.getByRole('textbox', { name: /^Descrição da capacitação/ }).fill('Atribuições de apoio à fiscalização de contratos definidas em portaria.');
  await page.getByRole('button', { name: 'Assinar declaração', exact: true }).click();
  await esperarAviso(page, 'Declaração assinada');
  await expect(page.getByText(/^Declaração assinada em/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Aptidão por papel no processo' }).getByRole('row').filter({ hasText: 'Fiscal técnico' })).toContainText('Sim');

  // Agora a designação passa.
  await trocarUsuario(page, 'agente');
  await designarAgente();
  await esperarAviso(page, 'Equipe designada');
  erros.verificar();
});

test('telas de vínculos do processo e do fornecedor: equipe com declarações, quadro societário mascarado e consulta pelo conector', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  await page.goto('/impedimentos');
  await esperarPaginaOk(page);
  await page.getByRole('table', { name: 'Processos com licitantes registrados' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/impedimentos\/processos\/[0-9a-f-]{36}$/);
  await esperarPaginaOk(page);
  await expect(page.getByRole('table', { name: 'Declarações da equipe designada' })).toBeVisible();
  await verificarAcessibilidade(page, '/impedimentos/processos/:id');

  await page.goto('/impedimentos');
  await esperarPaginaOk(page);
  const consulta = page.getByRole('region', { name: 'Consultar um fornecedor' });
  await consulta.getByRole('searchbox', { name: 'Buscar fornecedor' }).fill('Nortelink');
  await consulta.getByRole('radio', { name: /^Nortelink/ }).click();
  await expect(page).toHaveURL(/\/impedimentos\/fornecedores\/[0-9a-f-]{36}$/);
  await esperarPaginaOk(page);
  const quadro = page.getByRole('table', { name: 'Integrantes do quadro societário' });
  await expect(quadro.getByRole('row')).toHaveCount(3);
  await expect(quadro).toContainText(/\*\*\*\.\d{3}\.\d{3}-\*\*/);
  await page.getByRole('button', { name: 'Consultar quadro societário', exact: true }).click();
  await esperarAviso(page, 'Quadro societário atualizado');
  await expect(page.getByText(/simulação offline\. Consultado em/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Sinais do fornecedor' })).toContainText('Possível sucessão de empresa sancionada');
  await verificarAcessibilidade(page, '/impedimentos/fornecedores/:id');
  erros.verificar();
});
