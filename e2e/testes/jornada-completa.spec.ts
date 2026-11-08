/**
 * Jornada da contratação ponta a ponta na interface: cada etapa com o seu processo sintético (independentes
 * entre si e da ordem de execução), com o perfil que atua nela, verificação de acessibilidade do painel,
 * foco preservado após as mutações e nenhum erro no navegador.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

/** Abre o processo pela busca da lista da jornada. */
async function abrirProcesso(page: Page, busca: string, titulo: RegExp): Promise<void> {
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(busca);
  const link = page.getByRole('main').getByRole('link', { name: titulo });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);
}

function painel(page: Page, titulo: string) {
  return page.getByRole('heading', { level: 2, name: titulo, exact: true });
}

function etapaAtual(page: Page) {
  return page.getByRole('navigation', { name: 'Etapas do processo' }).locator('[aria-current="step"]');
}

/** "Avançar para a etapa N", confirmação e chegada ao painel da nova etapa, com o foco no título. */
async function avancar(page: Page, proxima: number, titulo: string): Promise<void> {
  await page.getByRole('button', { name: `Avançar para a etapa ${proxima}`, exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: new RegExp(`^Avançar para a etapa ${proxima} — `) });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Avançar etapa', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Etapa concluída');
  await expect(painel(page, titulo)).toBeFocused();
  await expect(etapaAtual(page)).toContainText(`Etapa ${proxima}`);
}

/** Aprova o documento aberto no visualizador (revisão humana confirmada). */
async function aprovarDocumentoAberto(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Aprovar documento' });
  await dialogo.getByRole('checkbox', { name: /^Revisei integralmente o texto/ }).check();
  await dialogo.getByRole('button', { name: 'Aprovar documento', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await esperarAviso(page, 'Documento aprovado');
  await esperarFocoPreservado(page);
}

function itemDocumento(page: Page, rotulo: string) {
  return page.getByRole('listitem').filter({ has: page.getByText(rotulo, { exact: true }) });
}

test.describe('jornada completa na interface', () => {
  test('etapa 1 — EPIs: indício de artigo de luxo, justificativa, salvar e avançar', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'planejamento');
    await abrirProcesso(page, 'proteção individual', /equipamentos de proteção individual/i);
    await expect(painel(page, 'Demanda e PCA')).toBeVisible();

    const bloqueios = page.getByRole('region', { name: 'Bloqueios' });
    await expect(bloqueios).toContainText('RN-01');
    await expect(page.getByText('Indício de artigo de luxo em 1 item (RN-01)')).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 1 (EPIs)');

    await page
      .getByRole('textbox', { name: /^Justificativa — bem de qualidade comum/ })
      .fill('As luvas táticas são de qualidade comum, adequadas à proteção nas operações, sem atributos de luxo ou ostentação.');
    await expect(page.getByText('Há alterações não salvas.')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar DFD', exact: true }).click();
    await esperarAviso(page, 'DFD salvo');
    await esperarFocoPreservado(page);
    await expect(page.getByText('Sem alterações pendentes.')).toBeVisible();
    await expect(bloqueios).toContainText('Nenhum bloqueio registrado');

    await avancar(page, 2, 'Instrução no SEI e equipe');
    await verificarAcessibilidade(page, 'etapa 2 após o avanço (EPIs)');
    erros.verificar();
  });

  test('etapa 2 — munição: conflito de segregação, equipe corrigida, DFD assinado no SEI e avanço', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'planejamento');
    await abrirProcesso(page, 'munição', /munição de treinamento/i);
    await expect(painel(page, 'Instrução no SEI e equipe')).toBeVisible();
    await expect(page.getByText('Conflito de segregação de funções (RN-03)')).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 2 (munição)');

    // O agente de contratação designado é a mesma pessoa da equipe de planejamento: troca pelo agente.
    const papeis = page.getByRole('combobox', { name: /^Papel da designação \d+$/ });
    const total = await papeis.count();
    let linhaAgente = 0;
    for (let i = 0; i < total; i++) {
      if ((await papeis.nth(i).inputValue()) === 'agente_contratacao') linhaAgente = i + 1;
    }
    expect(linhaAgente, 'designação do agente de contratação').toBeGreaterThan(0);
    const servidor = page.getByRole('combobox', { name: `Servidor da designação ${linhaAgente}` });
    const diego = await servidor.getByRole('option', { name: /^Diego Moraes Albuquerque/ }).getAttribute('value');
    await servidor.selectOption(diego ?? '');
    await expect(page.getByText('Conflito de segregação de funções (RN-03)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar designações', exact: true }).click();
    await esperarAviso(page, 'Equipe designada');
    await esperarFocoPreservado(page);

    const arvore = page.getByRole('region', { name: 'Árvore do processo SEI' });
    await expect(arvore).toContainText('1 pendente de assinatura');
    await arvore.getByRole('button', { name: /^Assinar documento \d{8} — Documento de Formalização da Demanda/ }).click();
    const dialogo = page.getByRole('dialog', { name: 'Assinar documento (simulação)' });
    await dialogo.getByRole('button', { name: 'Assinar (simulação)', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Assinatura registrada');
    // O botão "Assinar" deixou de existir: o foco vai para o título da árvore, não para o <body>.
    await expect(arvore.getByRole('heading', { name: 'Árvore do processo SEI' })).toBeFocused();
    await expect(arvore).toContainText('todos assinados');
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('Nenhum bloqueio registrado');

    await avancar(page, 3, 'ETP, riscos e preços');
    erros.verificar();
  });

  test('etapa 3 — scanners: ETP completo (XI a XIII), expurgo justificado e avanço', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'planejamento');
    await abrirProcesso(page, 'scanners', /scanners corporais/i);
    await expect(painel(page, 'ETP, riscos e preços')).toBeVisible();
    await expect(page.getByText('ETP com pendências (RN-04)')).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 3 (scanners)');

    await page.getByRole('textbox', { name: /^Inciso XI —/ }).fill('Não há contratações correlatas ou interdependentes: o objeto é autônomo e produz resultado sozinho.');
    await page.getByRole('textbox', { name: /^Inciso XII —/ }).fill('Logística reversa dos equipamentos substituídos e descarte ambientalmente adequado dos componentes eletrônicos.');
    await page.getByRole('textbox', { name: /^Inciso XIII —/ }).fill('A contratação é viável e adequada, recomendando-se o prosseguimento por pregão eletrônico com critério de menor preço.');
    await expect(page.getByText('ETP completo (RN-04)')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar ETP', exact: true }).click();
    await esperarAviso(page, 'ETP salvo');
    await esperarFocoPreservado(page);

    const expurgos = page.getByRole('group', { name: 'Expurgos sugeridos (RIA-03)' });
    await expurgos.getByRole('checkbox').first().check();
    await expurgos
      .getByRole('textbox', { name: /^Justificativa da exclusão/ })
      .fill('Preço muito acima da mediana da cesta, para equipamento com configuração superior à especificada no termo de referência.');
    await expurgos.getByRole('button', { name: 'Aceitar 1 expurgo', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Confirmar expurgo de preços' });
    await dialogo.getByRole('button', { name: 'Confirmar expurgo', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Expurgo registrado');
    await expect(expurgos).toHaveCount(0);
    await esperarFocoPreservado(page);
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('Nenhum bloqueio registrado');

    await avancar(page, 4, 'TR, edital e minuta');
    erros.verificar();
  });

  test('etapa 4 — drones: parâmetros do edital corrigidos, pacote do edital regerado e aprovado e avanço', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'agente');
    await abrirProcesso(page, 'drones', /drones/i);
    await expect(painel(page, 'TR, edital e minuta')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('faturamento mínimo');
    await verificarAcessibilidade(page, 'etapa 4 (drones)');

    await page.getByRole('switch', { name: /^Exige faturamento mínimo anterior/ }).click();
    await expect(page.getByText('Sem vedações (RN-06)')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar parâmetros', exact: true }).click();
    await esperarAviso(page, 'Parâmetros do edital salvos');
    await esperarFocoPreservado(page);

    // O servidor marca TR, edital e minuta gerados com os parâmetros anteriores (sinal e bloqueio RN-06).
    const pacote = [
      { rotulo: 'Termo de referência (TR)', titulo: 'Termo de referência (TR) — versão 2' },
      { rotulo: 'Edital', titulo: 'Edital — versão 2' },
      { rotulo: 'Minuta de contrato', titulo: 'Minuta de contrato — versão 2' },
    ];
    const aviso = page.getByRole('region', { name: 'TR, edital e minuta' }).getByText(/^Os parâmetros do edital foram alterados depois da geração de "Termo de Referência" \(versão 1\), "Minuta do Edital" \(versão 1\), "Minuta do Contrato" \(versão 1\)/);
    await expect(aviso).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sinais' })).toContainText('RN-06');
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('foi gerado com parâmetros anteriores — gere novamente e aprove');
    for (const { rotulo } of pacote) await expect(itemDocumento(page, rotulo)).toContainText('Parâmetros anteriores — gere nova versão');

    // A versão antiga da minuta não pode ser aprovada.
    await itemDocumento(page, 'Minuta de contrato').getByRole('button', { name: 'Visualizar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 4, name: 'Minuta de contrato — versão 1' })).toBeVisible();
    await expect(page.getByText('Versão gerada com parâmetros anteriores do edital (RN-06)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
    await verificarAcessibilidade(page, 'etapa 4 com documentos desatualizados (drones)');

    for (const { rotulo, titulo } of pacote) {
      await itemDocumento(page, rotulo).getByRole('button', { name: 'Gerar nova versão', exact: true }).click();
      await esperarAviso(page, 'Rascunho gerado');
      await expect(page.getByRole('heading', { level: 4, name: titulo })).toBeVisible();
      await aprovarDocumentoAberto(page);
      await expect(itemDocumento(page, rotulo)).not.toContainText('Parâmetros anteriores');
    }
    await expect(aviso).toHaveCount(0);
    // Marcadores internos do documento (comentários HTML) não aparecem no texto aprovado.
    const minuta = page.getByRole('article', { name: 'Conteúdo: Minuta de contrato' });
    await expect(minuta).toContainText('Aprovado após revisão humana');
    await expect(minuta).not.toContainText('<!--');
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('Nenhum bloqueio registrado');
    await verificarAcessibilidade(page, 'etapa 4 com o visualizador aberto (drones)');

    await avancar(page, 5, 'Controle jurídico e publicação');
    erros.verificar();
  });

  test('etapa 5 — software de perícia: parecer da assessoria jurídica, publicação pelo agente e prazo mínimo (RN-15)', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'juridico');
    await abrirProcesso(page, 'software', /software de extração/i);
    await expect(painel(page, 'Controle jurídico e publicação')).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 5 — jurídico (software)');

    const atendidos = page.getByRole('radio', { name: 'Atendido', exact: true });
    const itens = await atendidos.count();
    expect(itens).toBeGreaterThan(5);
    for (let i = 0; i < itens; i++) await atendidos.nth(i).check();
    await page.getByRole('radio', { name: 'Favorável', exact: true }).check();
    await page.getByRole('button', { name: 'Salvar parecer', exact: true }).click();
    await esperarAviso(page, 'Parecer registrado');
    await esperarFocoPreservado(page);

    // O documento do checklist é da assessoria jurídica: gera a versão com o parecer salvo, aprova e assina.
    await itemDocumento(page, 'Checklist do parecer jurídico').getByRole('button', { name: 'Gerar nova versão', exact: true }).click();
    await esperarAviso(page, 'Rascunho gerado');
    await aprovarDocumentoAberto(page);
    const arvore = page.getByRole('region', { name: 'Árvore do processo SEI' });
    await arvore.getByRole('button', { name: /^Assinar documento \d{8} — Lista de Verificação/ }).click();
    await page.getByRole('dialog', { name: 'Assinar documento (simulação)' }).getByRole('button', { name: 'Assinar (simulação)', exact: true }).click();
    await esperarAviso(page, 'Assinatura registrada');
    await expect(arvore).toContainText('todos assinados');

    // A publicação é do agente de contratação.
    await page.context().clearCookies();
    await entrar(page, 'agente');
    await abrirProcesso(page, 'software', /software de extração/i);
    await expect(page.getByText('Favorável', { exact: true }).first()).toBeVisible();
    await expect(itemDocumento(page, 'Checklist do parecer jurídico').getByRole('button', { name: /Gerar/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    const publicar = page.getByRole('dialog', { name: 'Publicar o edital' });
    await publicar.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(publicar).toBeHidden();
    await esperarAviso(page, 'Publicação enviada');
    await esperarFocoPreservado(page);
    await expect(page.getByText(/^Propostas a partir de \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
    await expect(page.getByText(/^Faltam \d+ dias? corridos$/)).toBeVisible();

    // RN-15 (art. 55): publicado hoje, o processo só passa à etapa 6 depois da data mínima.
    erros.permitir(422, /\/api\/v1\/processos\/[0-9a-f-]{36}\/avancar$/);
    await page.getByRole('button', { name: 'Avançar para a etapa 6', exact: true }).click();
    await page.getByRole('dialog', { name: /^Avançar para a etapa 6/ }).getByRole('button', { name: 'Avançar etapa', exact: true }).click();
    const falha = page.getByRole('alert').filter({ hasText: 'O processo permanece na etapa 5' });
    await expect(falha).toBeVisible();
    await expect(falha).toContainText('RN-15');
    await expect(falha).toContainText('As propostas só podem ser abertas a partir de');
    await expect(etapaAtual(page)).toContainText('Etapa 5');
    await verificarAcessibilidade(page, 'etapa 5 — bloqueio pelo prazo mínimo (software)');

    // Publicado o edital, o parecer fica travado também na tela da assessoria jurídica (o servidor responde 409).
    await page.context().clearCookies();
    await entrar(page, 'juridico');
    await abrirProcesso(page, 'software', /software de extração/i);
    await expect(page.getByText(/O parecer não pode ser alterado após a publicação; registre nova manifestação jurídica no SEI\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar parecer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Atendido', exact: true })).toHaveCount(0);
    await verificarAcessibilidade(page, 'etapa 5 — parecer travado após a publicação (software)');
    erros.verificar();
  });

  test('etapa 6 — coletes: desempate visível, licitante incluído pelo cadastro, registro no servidor e atos da seleção pendentes', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'agente');
    await abrirProcesso(page, 'coletes', /coletes balísticos/i);
    await expect(painel(page, 'Seleção do fornecedor')).toBeVisible();

    await expect(page.getByText('Resultado registrado no processo')).toBeVisible();
    await expect(page.getByText('Empate detectado no primeiro lugar. Critérios aplicados:')).toBeVisible();
    const passos = page.getByRole('list', { name: 'Critérios de desempate aplicados' });
    await expect(passos.getByRole('listitem').filter({ hasText: 'Critério decisivo' })).toContainText('Avaliação do desempenho contratual prévio');
    await expect(page.getByText(/^Primeiro colocado:/)).toContainText('Escudo Forte');
    await verificarAcessibilidade(page, 'etapa 6 (coletes)');

    // Licitante vem do cadastro de fornecedores (GET /fornecedores?busca=).
    await page.getByRole('searchbox', { name: 'Buscar fornecedor por razão social ou CNPJ' }).fill('Fortaleza');
    const resultados = page.getByRole('list', { name: 'Fornecedores encontrados' });
    await expect(resultados).toBeVisible();
    await resultados.getByRole('button', { name: /^Incluir Fortaleza Blindagens/ }).click();
    const valor = page.getByRole('textbox', { name: /^Valor da proposta — Fortaleza Blindagens/ });
    await expect(valor).toBeFocused();
    await expect(resultados.getByRole('button', { name: /^Incluído: Fortaleza Blindagens .* já consta da disputa$/ })).toBeDisabled();
    await expect(page.getByText('1 licitante sem valor de proposta fica fora desta prévia.')).toBeVisible();
    await page.getByRole('button', { name: 'Registrar propostas', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Informe o valor da proposta de Fortaleza Blindagens' })).toBeVisible();
    await expect(valor).toBeFocused();
    await valor.fill('3.520.000,00');
    // Art. 60, II (RN-37): a nota de desempenho vem do registro cadastral, não é digitada.
    await expect(page.getByRole('row').filter({ hasText: 'Fortaleza Blindagens' }).first()).toContainText('86');
    await page.getByText(/^4\. Fortaleza Blindagens/).click();
    await page
      .getByRole('group', { name: /^Critérios do art\. 60 — Fortaleza Blindagens/ })
      .getByRole('combobox', { name: 'Programa de integridade' })
      .selectOption('sim');
    await expect(page.getByText('Prévia calculada neste navegador', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Registrar propostas', exact: true }).click();
    await esperarAviso(page, 'Propostas registradas');
    await esperarFocoPreservado(page);
    await expect(page.getByText('Resultado registrado no processo')).toBeVisible();
    const classificacao = page.getByRole('table', { name: 'Classificação' });
    await expect(classificacao.getByRole('row')).toHaveCount(5);
    await expect(classificacao.getByRole('row').nth(1)).toContainText('Escudo Forte');
    await expect(classificacao.getByRole('row').nth(4)).toContainText('Fortaleza Blindagens');

    await page.getByRole('button', { name: 'Ver passo a passo', exact: true }).click();
    await expect(passos.getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'Mostrar todos', exact: true }).click();
    await expect(passos.getByRole('listitem')).toHaveCount(3);
    await verificarAcessibilidade(page, 'etapa 6 após o registro (coletes)');

    // Depois do registro das propostas, o avanço depende dos atos da seleção (amostra exigida no edital — RN-20);
    // o fluxo completo até a homologação está em selecao-atos.spec.ts.
    const atos = page.getByRole('region', { name: 'Atos da seleção' });
    await expect(atos.getByRole('heading', { level: 4, name: 'Painel da amostra (RN-20)' })).toBeVisible();
    await expect(atos.getByRole('button', { name: /^Convocar Escudo Forte/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bloqueios' })).toContainText('RN-20');
    erros.verificar();
  });

  test('etapa 7 — viaturas: contratar, abrir o contrato criado e encontrá-lo na carteira', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'agente');
    // Carteira visitada antes: o contrato novo precisa aparecer mesmo com a lista em cache.
    await page.goto('/contratos');
    await esperarPaginaOk(page);
    await abrirProcesso(page, 'viaturas', /viaturas caracterizadas/i);
    await expect(painel(page, 'Contrato e gestão')).toBeVisible();
    await verificarAcessibilidade(page, 'etapa 7 (viaturas)');

    await page.getByRole('button', { name: 'Contratar', exact: true }).click();
    const dialogo = page.getByRole('dialog', { name: 'Contratar' });
    await dialogo.getByRole('button', { name: 'Contratar', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await esperarAviso(page, 'Contrato criado');
    const abrir = page.getByRole('link', { name: /^Abrir o contrato \d+\/\d{4}$/ });
    await expect(abrir).toBeVisible();
    await esperarFocoPreservado(page);
    const numero = ((await abrir.textContent()) ?? '').replace('Abrir o contrato', '').trim();
    await expect(page.getByText(`Contrato ${numero} criado na carteira`)).toBeVisible();
    // O foco vai para o aviso do contrato criado (o botão "Contratar" deixou de existir).
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? '')).toContain(`Contrato ${numero} criado na carteira`);
    await verificarAcessibilidade(page, 'etapa 7 com o contrato criado (viaturas)');

    await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Contratos', exact: true }).click();
    await esperarPaginaOk(page);
    // A numeração é por UASG: outra unidade pode ter um contrato com o mesmo número.
    await page.getByRole('searchbox', { name: 'Buscar' }).fill(numero);
    const linha = page.getByRole('row').filter({ hasText: numero }).filter({ hasText: /viaturas caracterizadas/i });
    await expect(linha).toHaveCount(1);
    await linha.getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Contrato ${numero}`);
    await esperarPaginaOk(page);
    await expect(page.getByText(/viaturas caracterizadas/i).first()).toBeVisible();
    erros.verificar();
  });

  test('painéis das 7 etapas sem rolagem horizontal em 1440 px e 390 px', async ({ page }) => {
    const erros = monitorarErros(page);
    await entrar(page, 'agente');
    await abrirProcesso(page, 'rádios', /rádios digitais/i);
    const endereco = page.url();
    for (const largura of [1440, 390]) {
      await page.setViewportSize({ width: largura, height: largura === 390 ? 844 : 900 });
      for (let etapa = 1; etapa <= 7; etapa++) {
        await page.goto(`${endereco}?etapa=${etapa}`);
        await esperarPaginaOk(page);
        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
        await expect(page.getByText(`Etapa ${etapa} de 7`, { exact: true }).first()).toBeVisible();
        const larguras = await page.evaluate(() => ({ total: document.documentElement.scrollWidth, visivel: document.documentElement.clientWidth }));
        expect(larguras.total, `etapa ${etapa} em ${largura} px`).toBeLessThanOrEqual(larguras.visivel);
      }
    }
    await verificarAcessibilidade(page, 'etapa 7 em 390 px (rádios)');
    erros.verificar();
  });
});
