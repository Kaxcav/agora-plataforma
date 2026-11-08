/**
 * Frente N — avaliação de desempenho do contratado (RN-37, RF-30) e lições aprendidas (RIA-12), com dados sintéticos:
 * 1) o gestor designado emite a avaliação de um contrato, registra a concordância do contratado e a nota aparece no
 *    registro de desempenho do fornecedor;
 * 2) o desempate do art. 60, II, usa a nota do registro (simulador e etapa 6, sem digitação);
 * 3) no DFD de um objeto semelhante a contratos com atrasos, a lição aprendida é sugerida, com fontes, e aceita.
 * Não altera os processos sintéticos usados por outros arquivos: a avaliação é de um fornecedor sem disputa na carga
 * e o DFD é de um processo criado no próprio teste.
 */
import { expect, test, type Page } from '@playwright/test';
import { entrar, esperarAviso, esperarFocoPreservado, esperarPaginaOk, monitorarErros, verificarAcessibilidade } from './apoio.ts';

interface ContratoApi {
  id: string;
  numero: string;
  vigenciaInicio: string;
  fornecedor: { id: string; razaoSocial: string };
}

async function contratoDoGestor(page: Page): Promise<ContratoApi> {
  const r = await page.request.get('/api/v1/contratos?gestor=eu&busca=Planalto&tamanhoPagina=50');
  expect(r.status()).toBe(200);
  const { itens } = (await r.json()) as { itens: ContratoApi[] };
  const ordenados = itens.filter((c) => c.fornecedor.razaoSocial.startsWith('Planalto')).sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio));
  const primeiro = ordenados[0];
  if (!primeiro) throw new Error('Contrato sintético do gestor não encontrado');
  return primeiro;
}

test('avaliação de desempenho: emitida no contrato, com manifestação do contratado, e nota no registro do fornecedor', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'gestor');
  const contrato = await contratoDoGestor(page);
  await page.goto(`/contratos/${contrato.id}`);
  await esperarPaginaOk(page);
  await page.getByRole('tab', { name: 'Avaliação de desempenho' }).click();
  await expect(page.getByText('Nenhuma avaliação emitida')).toBeVisible();
  await page.getByRole('button', { name: 'Emitir avaliação de desempenho', exact: true }).click();

  const dialogo = page.getByRole('dialog', { name: `Avaliação de desempenho — Contrato ${contrato.numero}` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('Dados do período registrados na Ágora')).toBeVisible();
  await dialogo.getByRole('textbox', { name: /^Entregas no prazo/ }).fill('9');
  await dialogo.getByRole('textbox', { name: /^Total de entregas/ }).fill('10');
  await dialogo.getByRole('textbox', { name: /^Recebimentos definitivos sem ressalva/ }).fill('10');
  await dialogo.getByRole('textbox', { name: /^Total de recebimentos/ }).fill('10');
  await dialogo.getByRole('textbox', { name: /^Evidências/ }).fill('Termos de recebimento definitivo do período e notas fiscais atestadas.');
  await dialogo
    .getByRole('textbox', { name: /^Avaliação motivada/ })
    .fill('Uma entrega chegou dois dias depois do prazo do cronograma; as demais foram entregues e recebidas sem ressalva.');
  await verificarAcessibilidade(page, 'diálogo de emissão da avaliação de desempenho');
  await dialogo.getByRole('button', { name: 'Emitir avaliação', exact: true }).click();
  await esperarAviso(page, 'Avaliação emitida');
  await expect(dialogo).toHaveCount(0);

  const cartao = page.getByRole('article').filter({ hasText: 'Avaliação parcial' });
  await expect(cartao.getByText('Em prazo de manifestação', { exact: true })).toBeVisible();
  const textoNota = (await cartao.getByText(/^Nota \d+,\d$/).textContent()) ?? '';
  const nota = textoNota.replace('Nota ', '');
  expect(nota).toMatch(/^\d+,\d$/);
  await expect(cartao.getByRole('link', { name: /Documento da avaliação \(PDF\)/ })).toHaveAttribute('href', /\/api\/v1\/avaliacoes-desempenho\/[0-9a-f-]{36}\/documento\.pdf$/);

  // O contratado se manifesta (recebido por SEI ou e-mail): concorda — a avaliação fica definitiva.
  await cartao.getByRole('button', { name: 'Registrar manifestação do contratado', exact: true }).click();
  const manifestacao = page.getByRole('dialog', { name: /^Manifestação do contratado — RCD-/ });
  await manifestacao.getByRole('radio', { name: 'Concorda', exact: true }).check();
  await manifestacao.getByRole('textbox', { name: /^Manifestação do contratado/ }).fill('Ciente da avaliação; de acordo com os indicadores apurados.');
  await manifestacao.getByRole('button', { name: 'Registrar manifestação', exact: true }).click();
  await esperarAviso(page, 'Manifestação registrada');
  await expect(cartao.getByText('Definitiva', { exact: true })).toBeVisible();
  await esperarFocoPreservado(page);
  await verificarAcessibilidade(page, 'aba de avaliação de desempenho do contrato');

  // Registro cadastral do fornecedor: a avaliação definitiva entra na nota.
  await page.goto(`/fornecedores/${contrato.fornecedor.id}`);
  await esperarPaginaOk(page);
  await page.getByRole('tab', { name: 'Desempenho registrado' }).click();
  await expect(page.getByText(`Nota do registro: ${nota} / 100`)).toBeVisible();
  const historico = page.getByRole('table', { name: 'Histórico de avaliações de desempenho' });
  await expect(historico.getByRole('row').filter({ hasText: contrato.numero })).toContainText('Na nota do registro');
  await verificarAcessibilidade(page, 'aba de desempenho registrado do fornecedor');
  erros.verificar();
});

test('desempate pelo desempenho registrado: simulador e etapa 6 usam a nota do registro, sem digitação', async ({ page }) => {
  const erros = monitorarErros(page);
  await entrar(page, 'agente');
  await page.goto('/desempenho');
  await esperarPaginaOk(page);
  const ranking = page.getByRole('table', { name: 'Fornecedores com avaliação de desempenho' });
  await expect(ranking.getByRole('row').filter({ hasText: 'Escudo Forte' })).toContainText('92,0');
  await expect(ranking.getByRole('row').filter({ hasText: 'Boreal' })).toContainText('85,0');

  await page.getByRole('checkbox', { name: /^Incluir na simulação — Boreal/ }).check();
  await page.getByRole('checkbox', { name: /^Incluir na simulação — Escudo Forte/ }).check();
  await page.getByRole('button', { name: 'Simular', exact: true }).click();
  await expect(page.getByText('Primeiro colocado: Escudo Forte Equipamentos de Proteção Ltda.')).toBeVisible();
  await expect(page.getByText(/^Critério decisivo: Avaliação do desempenho contratual prévio/)).toBeVisible();

  // Técnica e preço: a nota do registro vira parte da nota técnica (art. 37, III), com o regulamento indicado.
  await page.getByRole('switch', { name: 'Simular também a técnica e preço com o desempenho na nota técnica' }).click();
  await page.getByRole('textbox', { name: /^Regulamento que disciplina o critério/ }).fill('Portaria sintética nº 1/2026, art. 5º');
  await page.getByRole('button', { name: 'Simular', exact: true }).click();
  const tecnica = page.getByRole('table', { name: 'Técnica e preço com o desempenho anterior na nota técnica' });
  await expect(tecnica.getByRole('row').nth(1)).toContainText('Escudo Forte');
  await verificarAcessibilidade(page, 'simulador de impacto em editais futuros');

  // Etapa 6 do processo dos coletes: a coluna mostra a nota do registro, não um campo para digitar.
  const busca = await page.request.get('/api/v1/processos?busca=coletes');
  const { itens } = (await busca.json()) as { itens: { id: string; titulo: string }[] };
  const coletes = itens.find((p) => /coletes balísticos/i.test(p.titulo));
  if (!coletes) throw new Error('Processo sintético dos coletes não encontrado');
  await page.goto(`/jornada/${coletes.id}`);
  await esperarPaginaOk(page);
  const propostas = page.getByRole('table', { name: 'Licitantes e propostas' });
  await expect(propostas.getByRole('columnheader', { name: 'Desempenho registrado (art. 60, II)' })).toBeVisible();
  await expect(propostas.getByRole('row').filter({ hasText: 'Escudo Forte' })).toContainText('92');
  await expect(page.getByRole('spinbutton', { name: /desempenho/i })).toHaveCount(0);
  const passos = page.getByRole('list', { name: 'Critérios de desempate aplicados' });
  await expect(passos.getByRole('listitem').filter({ hasText: 'Critério decisivo' })).toContainText('Avaliação do desempenho contratual prévio');
  erros.verificar();
});

test('lição aprendida no DFD de objeto semelhante: sinal com fontes, aceito pelo agente e levado ao rascunho', async ({ page }) => {
  test.setTimeout(90_000);
  const erros = monitorarErros(page);
  await entrar(page, 'planejamento');
  await page.goto('/jornada');
  await esperarPaginaOk(page);
  await page.getByRole('button', { name: 'Novo processo', exact: true }).first().click();
  const novo = page.getByRole('dialog', { name: 'Novo processo de contratação' });
  // Título sem "coletes balísticos": outros arquivos buscam o processo sintético dos coletes por esse texto.
  await novo.getByRole('textbox', { name: /^Objeto/ }).fill('Reposição de colete balístico nível III-A');
  await novo.getByRole('combobox', { name: /^Órgão requisitante/ }).selectOption('SENASP');
  await novo.getByRole('button', { name: 'Criar processo', exact: true }).click();
  await expect(page).toHaveURL(/\/jornada\/[0-9a-f-]{36}/);
  await esperarPaginaOk(page);

  await page.getByRole('textbox', { name: /^Descrição da necessidade/ }).fill('Repor os coletes balísticos com proteção vencida das equipes de pronta resposta.');
  await page.getByRole('textbox', { name: /^Justificativa da contratação/ }).fill('A validade da proteção balística dos coletes em uso termina neste semestre.');
  await page.getByRole('button', { name: 'Adicionar item', exact: true }).click();
  await page.getByRole('textbox', { name: 'Descrição do item 1' }).fill('Colete balístico nível III-A');
  await page.getByRole('spinbutton', { name: 'Quantidade do item 1' }).fill('300');
  const valor = page.getByRole('textbox', { name: 'Valor unitário estimado do item 1' });
  await valor.fill('3.500,00');
  await valor.press('Enter');
  await page.getByRole('button', { name: 'Salvar DFD', exact: true }).click();
  await esperarAviso(page, 'DFD salvo');

  const painel = page.getByRole('region', { name: 'Lições aprendidas de contratos anteriores (RIA-12)' });
  const sugestao = painel.getByRole('article').filter({ hasText: 'Antecipar a demanda: houve atrasos de entrega' });
  await expect(sugestao).toBeVisible();
  await expect(sugestao).toContainText('requer revisão humana');
  await sugestao.getByText(/^Fontes:/).click();
  await expect(sugestao.getByRole('link', { name: /^Contrato \d+\/\d{4}$/ }).first()).toBeVisible();
  await expect(sugestao).toContainText('Atraso em');
  await verificarAcessibilidade(page, 'painel de lições aprendidas no DFD');

  await sugestao.getByRole('button', { name: 'Considerar no DFD', exact: true }).click();
  await esperarAviso(page, 'Lição considerada');
  await expect(sugestao.getByText('Considerada no DFD', { exact: true })).toBeVisible();
  await expect(sugestao).toContainText('Considerada por');

  // Só o que foi aceito entra no rascunho, com a origem.
  const formalizacao = page.getByRole('region', { name: 'Formalização' });
  await formalizacao.getByRole('button', { name: 'Gerar rascunho', exact: true }).click();
  await esperarAviso(page, 'Rascunho gerado');
  await expect(formalizacao.getByText('Lições aprendidas consideradas (RIA-12)')).toBeVisible();
  erros.verificar();
});
