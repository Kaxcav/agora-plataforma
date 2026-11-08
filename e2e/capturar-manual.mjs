// Gera as capturas de tela do Manual do usuário (docs/manual/capturas/*.jpg) a partir da Ágora em execução,
// com os dados sintéticos. Diálogos são abertos e cancelados; só ações de consulta são executadas.
// Uso: node e2e/capturar-manual.mjs [baseURL]   (padrão http://127.0.0.1:3000)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const saida = join(raiz, 'docs', 'manual', 'capturas');
const textosDialogos = process.argv[3] ?? null;
mkdirSync(saida, { recursive: true });

const navegador = await chromium.launch();
const dialogos = {};
const falhas = [];

async function sessao(perfil, largura = 1440, altura = 900) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', deviceScaleFactor: 1.5 });
  const pagina = await contexto.newPage();
  if (perfil) {
    await pagina.goto(`${base}/entrar`);
    await pagina.getByRole('textbox', { name: /^E-mail institucional/ }).fill(`${perfil}@agora.demo`);
    await pagina.getByRole('textbox', { name: /^Senha/ }).fill('Agora@Demo2026');
    await pagina.getByRole('button', { name: 'Entrar', exact: true }).click();
    await pagina.waitForURL((u) => !u.pathname.startsWith('/entrar'));
  }
  return { contexto, pagina };
}

async function pronta(pagina) {
  await pagina.locator('h1').first().waitFor({ timeout: 15000 });
  await pagina.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, null, { timeout: 15000 }).catch(() => {});
  await pagina.waitForTimeout(350);
}

async function foto(pagina, nome, alvo = null) {
  const opcoes = { path: join(saida, `${nome}.jpg`), type: 'jpeg', quality: 82 };
  if (alvo) await alvo.screenshot(opcoes);
  else await pagina.screenshot(opcoes);
  console.log('ok', nome);
}

async function registrarDialogo(pagina, nome) {
  const dialogo = pagina.locator('dialog[open], [role="dialog"]').last();
  await dialogo.waitFor({ timeout: 5000 });
  await pagina.waitForTimeout(250);
  dialogos[nome] = (await dialogo.innerText()).replace(/\n+/g, ' / ').slice(0, 1500);
  return dialogo;
}

/** Cada captura é independente: uma falha é registrada, as demais continuam, e o processo termina com erro. */
async function passo(nome, fn) {
  try {
    await fn();
    return true;
  } catch (erro) {
    falhas.push(`${nome}: ${String(erro.message).split('\n')[0]}`);
    console.log('FALHOU', nome);
    return false;
  }
}

// ── Público ──
{
  const { contexto, pagina } = await sessao(null);
  await passo('m01-entrar', async () => {
    await pagina.goto(`${base}/entrar`);
    await pronta(pagina);
    await foto(pagina, 'm01-entrar');
  });
  await passo('m30-transparencia', async () => {
    await pagina.goto(`${base}/transparencia`);
    await pronta(pagina);
    await foto(pagina, 'm30-transparencia');
  });
  await passo('m37-edital-publico', async () => {
    await pagina.goto(`${base}/transparencia/editais`);
    await pronta(pagina);
    await pagina.getByRole('table', { name: /Editais publicados/ }).getByRole('link').first().click();
    await pronta(pagina);
    await foto(pagina, 'm37-edital-publico');
  });
  await contexto.close();
}

// ── Gestor ──
{
  const { contexto, pagina } = await sessao('gestor');
  await passo('m02-inicio', async () => {
    await pronta(pagina);
    await foto(pagina, 'm02-inicio');
  });
  await passo('m03-menu-usuario', async () => {
    await pagina.getByRole('button', { name: /dados da sessão/ }).click();
    await pagina.waitForTimeout(300);
    await foto(pagina, 'm03-menu-usuario');
    dialogos['menu-usuario'] = (await pagina.locator('header').first().innerText()).replace(/\n+/g, ' / ');
  });
  await passo('m04-trocar-senha', async () => {
    await pagina.getByRole('link', { name: 'Trocar senha' }).click();
    await pronta(pagina);
    dialogos['trocar-senha'] = (await pagina.locator('main').innerText()).replace(/\n+/g, ' / ').slice(0, 1200);
    await foto(pagina, 'm04-trocar-senha');
  });
  await passo('m05-fila-pendencias', async () => {
    await pagina.goto(`${base}/`);
    await pronta(pagina);
    const secao = pagina.locator('section', { has: pagina.getByRole('heading', { name: 'Fila de pendências' }) }).first();
    await secao.scrollIntoViewIfNeeded();
    await foto(pagina, 'm05-fila-pendencias');
  });
  await passo('m06-resolver-pendencia', async () => {
    await pagina.getByRole('button', { name: /^Resolver pendência de/ }).first().click();
    await registrarDialogo(pagina, 'resolver-pendencia');
    await foto(pagina, 'm06-resolver-pendencia');
    await pagina.keyboard.press('Escape');
  });
  await passo('m07-contratos', async () => {
    await pagina.goto(`${base}/contratos`);
    await pronta(pagina);
    await foto(pagina, 'm07-contratos');
  });
  const vigentes = await (await pagina.request.get(`${base}/api/v1/contratos?situacao=vigente&tamanhoPagina=50`)).json();
  const escolhido = vigentes.itens.find((c) => c.percentualExecutado > 30 && c.diasRestantes > 60) ?? vigentes.itens[0];
  const contrato = `/contratos/${escolhido.id}`;
  await passo('m08-contrato', async () => {
    await pagina.goto(`${base}${contrato}`);
    await pronta(pagina);
    await foto(pagina, 'm08-contrato');
  });
  await passo('m09-plano-gestao', async () => {
    const abas = pagina.getByRole('tablist').first();
    await abas.scrollIntoViewIfNeeded();
    await pagina.evaluate(() => window.scrollBy(0, -80));
    await foto(pagina, 'm09-plano-gestao');
  });
  await passo('m10-aditivo', async () => {
    await pagina.goto(`${base}${contrato}?aba=aditivos`);
    await pronta(pagina);
    await pagina.getByLabel(/^Acréscimo/).check();
    const valor = Math.round(escolhido.valorGlobal * 0.3);
    await pagina.getByRole('textbox', { name: /^Valor da alteração/ }).fill((valor / 100).toFixed(2).replace('.', ','));
    await pagina.getByRole('button', { name: 'Simular' }).click();
    await pagina.waitForTimeout(800);
    const simulador = pagina.locator('section, div', { has: pagina.getByRole('heading', { name: /Simulador de aditivo/ }) }).last();
    await simulador.scrollIntoViewIfNeeded();
    dialogos['simulador-aditivo'] = (await simulador.innerText()).replace(/\n+/g, ' / ').slice(0, 1500);
    await foto(pagina, 'm10-aditivo');
  });
  await passo('m11-atas', async () => {
    await pagina.goto(`${base}/atas`);
    await pronta(pagina);
    await foto(pagina, 'm11-atas');
  });
  await passo('m13-previsao', async () => {
    await pagina.goto(`${base}/financeiro/previsao`);
    await pronta(pagina);
    await foto(pagina, 'm13-previsao');
  });
  await passo('m14-vinculos', async () => {
    await pagina.goto(`${base}/vinculos`);
    await pronta(pagina);
    await foto(pagina, 'm14-vinculos');
    await pagina.getByRole('button', { name: /^Vincular à ata sugerida/ }).first().click();
    await registrarDialogo(pagina, 'vincular');
    await pagina.keyboard.press('Escape');
  });
  await passo('m25-sancoes', async () => {
    await pagina.goto(`${base}/sancoes`);
    await pronta(pagina);
    await pagina.getByRole('button', { name: 'Instaurar processo' }).click();
    await registrarDialogo(pagina, 'instaurar-processo');
    await pagina.keyboard.press('Escape');
    await pagina.getByRole('textbox', { name: /^Valor do contrato/ }).fill('1.250.000,00');
    await pagina.getByLabel('Grave', { exact: true }).check();
    await pagina.getByLabel('Reincidência').check();
    await pagina.getByLabel('Colaboração com a apuração').check();
    await pagina.getByRole('button', { name: 'Calcular proposta' }).click();
    await pagina.waitForTimeout(800);
    const simulador = pagina.locator('section', { has: pagina.getByRole('heading', { name: /Simulador de dosimetria/ }) }).last();
    await simulador.scrollIntoViewIfNeeded();
    dialogos['dosimetria'] = (await simulador.innerText()).replace(/\n+/g, ' / ').slice(0, 1800);
    await foto(pagina, 'm25-sancoes');
  });
  await passo('m36-moratoria', async () => {
    const secao = pagina.locator('section', { has: pagina.getByRole('heading', { name: /Simulador de multa moratória/ }) }).last();
    await secao.getByRole('textbox', { name: /^Valor da parcela em atraso/ }).fill('100.000,00');
    await secao.getByRole('textbox', { name: /^Dias de atraso/ }).fill('15');
    await secao.getByRole('button', { name: 'Calcular multa moratória' }).click();
    await secao.getByRole('heading', { name: 'Proposta de multa moratória' }).waitFor();
    await secao.getByRole('heading', { name: 'Proposta de multa moratória' }).scrollIntoViewIfNeeded();
    await foto(pagina, 'm36-moratoria');
  });
  await passo('m31-modo-especificacao', async () => {
    await pagina.goto(`${base}${contrato}`);
    await pronta(pagina);
    await pagina.getByRole('switch', { name: 'Modo especificação técnica' }).click();
    await pagina.waitForTimeout(500);
    await foto(pagina, 'm31-modo-especificacao');
    await pagina.getByRole('switch', { name: 'Modo especificação técnica' }).click();
  });
  await passo('m32-caderno-regras', async () => {
    await pagina.goto(`${base}/regras`);
    await pronta(pagina);
    await foto(pagina, 'm32-caderno-regras');
  });
  await contexto.close();
}

// ── Fiscal: atesto ──
{
  const { contexto, pagina } = await sessao('fiscal');
  await passo('m12-pagamentos', async () => {
    await pagina.goto(`${base}/financeiro/pagamentos`);
    await pronta(pagina);
    await foto(pagina, 'm12-pagamentos');
    await pagina.getByRole('button', { name: /^Atestar nota fiscal/ }).first().click();
    await registrarDialogo(pagina, 'atestar');
    await foto(pagina, 'm12b-atestar');
    await pagina.keyboard.press('Escape');
  });
  await contexto.close();
}

// ── Agente: jornada ──
{
  const { contexto, pagina } = await sessao('agente');
  await passo('m15-jornada-lista', async () => {
    await pagina.goto(`${base}/jornada`);
    await pronta(pagina);
    await foto(pagina, 'm15-jornada-lista');
  });
  const { itens } = await (await pagina.request.get(`${base}/api/v1/processos?tamanhoPagina=50`)).json();
  const porEtapa = new Map();
  for (const p of itens) if (!porEtapa.has(p.etapaAtual)) porEtapa.set(p.etapaAtual, p.id);
  for (const etapa of [1, 2, 3, 4, 6, 7]) {
    const id = porEtapa.get(etapa);
    if (!id) continue;
    await passo(`m16-etapa-${etapa}`, async () => {
      await pagina.goto(`${base}/jornada/${id}`);
      await pronta(pagina);
      await foto(pagina, `m16-etapa-${etapa}`);
    });
  }
  await passo('m17-bloqueio', async () => {
    await pagina.goto(`${base}/jornada/${porEtapa.get(1)}`);
    await pronta(pagina);
    await pagina.getByRole('button', { name: /^Avançar para a etapa/ }).click();
    const dialogo = await registrarDialogo(pagina, 'avancar-etapa');
    const confirmar = dialogo.getByRole('button', { name: /Avançar etapa/ });
    if (await confirmar.count()) {
      await confirmar.click();
      await pagina.waitForTimeout(1000);
    }
    dialogos['avancar-resultado'] = (await pagina.locator('main').innerText()).replace(/\n+/g, ' / ').slice(0, 1200);
    await foto(pagina, 'm17-bloqueio');
    await pagina.keyboard.press('Escape');
  });
  await passo('m35-importar-cesta', async () => {
    await pagina.goto(`${base}/jornada/${porEtapa.get(3)}`);
    await pronta(pagina);
    await pagina.getByRole('button', { name: 'Importar planilha', exact: true }).click();
    const dialogo = pagina.getByRole('dialog', { name: 'Importar cotações de planilha' });
    const csv = [
      'fonte;identificacao;valor_unitario;data_cotacao;justificativa',
      'painel_precos;Painel de Preços — referência A;10.000,00;01/10/2026;',
      'painel_precos;Painel de Preços — referência B;10.200,00;03/10/2026;',
      'contratacao_similar;Contrato similar 1;9.800,00;15/09/2026;',
      'contratacao_similar;Contrato similar 2;10.100,00;20/09/2026;',
      'fornecedor_direto;Fornecedor fictício A;9.950,00;10/10/2026;Atua no ramo e enviou proposta formal',
      'nota_fiscal;NF-e fictícia 1;10.050,00;05/10/2026;',
      'fornecedor_direto;Fornecedor fictício B;25.000,00;12/10/2026;Atua no ramo e enviou proposta formal',
      'midia_especializada;Publicação especializada;3.000,00;08/10/2026;',
    ].join('\r\n');
    await dialogo.getByLabel('Arquivo da planilha').setInputFiles({ name: 'cesta.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
    await dialogo.getByRole('button', { name: 'Conferir planilha', exact: true }).click();
    await dialogo.getByText(/linha\(s\) válida\(s\)/).waitFor();
    await dialogo.getByRole('table', { name: 'Prévia da importação' }).scrollIntoViewIfNeeded();
    await foto(pagina, 'm35-importar-cesta');
    await pagina.keyboard.press('Escape');
  });
  await passo('m18-dossie', async () => {
    await pagina.goto(`${base}/jornada/${porEtapa.get(6)}`);
    await pronta(pagina);
    await pagina.getByRole('link', { name: 'Exportar dossiê' }).click();
    await pronta(pagina);
    dialogos['dossie'] = (await pagina.locator('main').innerText()).replace(/\n+/g, ' / ').slice(0, 800);
    await foto(pagina, 'm18-dossie');
  });
  await contexto.close();
}

// ── Jurídico: parecer (etapa 5) ──
{
  const { contexto, pagina } = await sessao('juridico');
  await passo('m16-etapa-5', async () => {
    const { itens } = await (await pagina.request.get(`${base}/api/v1/processos?tamanhoPagina=50`)).json();
    const id = itens.find((p) => p.etapaAtual === 5)?.id;
    await pagina.goto(`${base}/jornada/${id}`);
    await pronta(pagina);
    await foto(pagina, 'm16-etapa-5');
    const parecer = pagina.locator('section', { has: pagina.getByRole('heading', { name: 'Parecer jurídico' }) }).first();
    dialogos['parecer'] = (await parecer.innerText()).replace(/\n+/g, ' / ').slice(0, 1500);
  });
  await contexto.close();
}

// ── Auditor ──
{
  const { contexto, pagina } = await sessao('auditor');
  await passo('m21-auditoria', async () => {
    await pagina.goto(`${base}/auditoria`);
    await pronta(pagina);
    await pagina.getByRole('button', { name: 'Verificar integridade da cadeia' }).click();
    await pagina.waitForTimeout(1500);
    dialogos['integridade'] = (await pagina.locator('main').innerText()).replace(/\n+/g, ' / ').slice(0, 600);
    await foto(pagina, 'm21-auditoria');
  });
  await passo('m22-lgpd', async () => {
    await pagina.goto(`${base}/auditoria/lgpd`);
    await pronta(pagina);
    await foto(pagina, 'm22-lgpd');
  });
  await passo('m23-fornecedor', async () => {
    await pagina.goto(`${base}/fornecedores`);
    await pronta(pagina);
    await pagina.getByRole('button', { name: 'Revelar CPF do fornecedor' }).first().click();
    await registrarDialogo(pagina, 'revelar');
    await foto(pagina, 'm24-revelar');
    await pagina.keyboard.press('Escape');
    const href = await pagina.locator('main a[href^="/fornecedores/"]').first().getAttribute('href');
    await pagina.goto(`${base}${href}`);
    await pronta(pagina);
    await foto(pagina, 'm23-fornecedor');
  });
  await contexto.close();
}

// ── Administrador ──
{
  const { contexto, pagina } = await sessao('admin');
  await passo('m26-usuarios', async () => {
    await pagina.goto(`${base}/admin/usuarios`);
    await pronta(pagina);
    await foto(pagina, 'm26-usuarios');
    await pagina.getByRole('button', { name: 'Novo usuário' }).click();
    await registrarDialogo(pagina, 'novo-usuario');
    await foto(pagina, 'm27-novo-usuario');
    await pagina.keyboard.press('Escape');
    await pagina.getByRole('button', { name: /^Gerar senha temporária para/ }).first().click();
    await registrarDialogo(pagina, 'senha-temporaria');
    await pagina.keyboard.press('Escape');
  });
  await passo('m28-integracoes', async () => {
    await pagina.goto(`${base}/admin/integracoes`);
    await pronta(pagina);
    await foto(pagina, 'm28-integracoes');
  });
  await passo('m29-ajustes', async () => {
    await pagina.goto(`${base}/ajustes/feriados`);
    await pronta(pagina);
    dialogos['feriados'] = (await pagina.locator('main').innerText()).replace(/\n+/g, ' / ').slice(0, 500);
    await pagina.goto(`${base}/ajustes/modelos`);
    await pronta(pagina);
    await foto(pagina, 'm29-ajustes');
  });
  await contexto.close();
}

// ── Celular ──
{
  const { contexto, pagina } = await sessao('gestor', 390, 844);
  await passo('m33-celular', async () => {
    await pronta(pagina);
    await foto(pagina, 'm33-celular');
    await pagina.getByRole('button', { name: /^Menu/ }).first().click();
    await pagina.waitForTimeout(400);
    await foto(pagina, 'm34-celular-menu');
  });
  await contexto.close();
}

await navegador.close();
if (textosDialogos) writeFileSync(textosDialogos, JSON.stringify(dialogos, null, 1));
if (falhas.length) {
  console.error(`falhas:\n  ${falhas.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('todas as capturas concluídas');
}
