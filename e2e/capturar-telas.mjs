// Gera capturas de tela da Ágora para documentação e apresentação.
// Uso: node e2e/capturar-telas.mjs <baseURL> <pastaSaida>
// Requer a plataforma rodando (ex.: AGORA_PORTA=3300 node apps/api/dist/servidor.js) com os dados sintéticos.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:3300';
const saida = process.argv[3] ?? 'docs/capturas';
mkdirSync(saida, { recursive: true });

const navegador = await chromium.launch();

async function sessao(perfil, largura = 1440, altura = 900) {
  const contexto = await navegador.newContext({ viewport: { width: largura, height: altura }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', deviceScaleFactor: 2 });
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
  await pagina.getByRole('heading', { level: 1 }).first().waitFor();
  await pagina.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, null, { timeout: 15000 });
  await pagina.waitForTimeout(400);
}

async function capturar(pagina, nome, rota, inteira = false) {
  if (rota) await pagina.goto(`${base}${rota}`);
  await pronta(pagina);
  await pagina.screenshot({ path: join(saida, `${nome}.png`), fullPage: inteira });
  console.log('ok', nome);
}

async function primeiroDetalhe(pagina, lista) {
  await pagina.goto(`${base}${lista}`);
  await pronta(pagina);
  const href = await pagina.locator(`main a[href^="${lista}/"]`).first().getAttribute('href');
  return href;
}

// Público
{
  const { contexto, pagina } = await sessao(null);
  await capturar(pagina, '01-entrar', '/entrar');
  await capturar(pagina, '02-transparencia', '/transparencia');
  await capturar(pagina, '03-caderno-de-regras', '/regras');
  await contexto.close();
}

// Gestor
{
  const { contexto, pagina } = await sessao('gestor');
  await capturar(pagina, '10-inicio-painel', '/');
  await capturar(pagina, '10b-inicio-painel-completo', '/', true);
  await capturar(pagina, '11-contratos', '/contratos');
  // Contrato vigente com execução em andamento, para a demonstração.
  const vigentes = await (await pagina.request.get(`${base}/api/v1/contratos?situacao=vigente&tamanhoPagina=50`)).json();
  const escolhido = vigentes.itens.find((c) => c.percentualExecutado > 30 && c.diasRestantes > 60) ?? vigentes.itens[0];
  const contrato = escolhido ? `/contratos/${escolhido.id}` : await primeiroDetalhe(pagina, '/contratos');
  if (contrato) {
    await capturar(pagina, '12-contrato-detalhe', contrato);
    await capturar(pagina, '13-contrato-aditivos', `${contrato}?aba=aditivos`);
  }
  await capturar(pagina, '14-atas', '/atas');
  await capturar(pagina, '15-previsao-pagamentos', '/financeiro/previsao');
  await capturar(pagina, '16-vinculos', '/vinculos');
  await pagina.goto(`${base}/contratos`);
  await pronta(pagina);
  await pagina.getByRole('switch', { name: 'Modo especificação técnica' }).click();
  await capturar(pagina, '17-modo-especificacao', null);
  await contexto.close();
}

// Agente de contratação — jornada
{
  const { contexto, pagina } = await sessao('agente');
  await capturar(pagina, '20-jornada-lista', '/jornada');
  const resposta = await pagina.request.get(`${base}/api/v1/processos?tamanhoPagina=50`);
  const { itens } = await resposta.json();
  const porEtapa = new Map(itens.map((p) => [p.etapaAtual, p.id]));
  for (const etapa of [1, 2, 3, 4, 5, 6, 7]) {
    const id = porEtapa.get(etapa);
    if (id) await capturar(pagina, `2${etapa}-jornada-etapa-${etapa}`, `/jornada/${id}`);
  }
  await contexto.close();
}

// Auditor
{
  const { contexto, pagina } = await sessao('auditor');
  await capturar(pagina, '30-auditoria', '/auditoria');
  const fornecedor = await primeiroDetalhe(pagina, '/fornecedores');
  if (fornecedor) await capturar(pagina, '31-fornecedor-idc', fornecedor);
  await capturar(pagina, '32-sancoes-dosimetria', '/sancoes');
  await contexto.close();
}

// Celular
{
  const { contexto, pagina } = await sessao('gestor', 390, 844);
  await capturar(pagina, '40-celular-inicio', '/');
  await capturar(pagina, '41-celular-contratos', '/contratos');
  await contexto.close();
}

await navegador.close();
