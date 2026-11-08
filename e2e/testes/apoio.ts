import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const SENHA = 'Agora@Demo2026';

export async function entrar(page: Page, perfil: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByRole('textbox', { name: /^E-mail institucional/ }).fill(`${perfil}@agora.demo`);
  await page.getByRole('textbox', { name: /^Senha/ }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Página carregada sem estado de erro e com um único h1. */
export async function esperarPaginaOk(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Não foi possível carregar os dados')).toHaveCount(0);
}

/** Sem violações sérias ou críticas de acessibilidade (WCAG 2.1 A/AA), na página inteira ou só em `escopo`. */
export async function verificarAcessibilidade(page: Page, contexto: string, escopo?: string): Promise<void> {
  // Animações de entrada (opacidade) distorcem o cálculo de contraste: espera as finitas terminarem.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.then(() => true, () => false)),
    ),
  );
  const construtor = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const resultado = await (escopo ? construtor.include(escopo) : construtor).analyze();
  const graves = resultado.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const resumo = graves.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(resumo, `Violações de acessibilidade em ${contexto}`).toEqual([]);
}

interface RespostaPermitida {
  status: number;
  url: RegExp;
}

/**
 * Falhas do navegador durante o teste: exceções da página (`pageerror`), erros no console e respostas HTTP
 * de erro. O "Failed to load resource" que o navegador registra para toda resposta 4xx/5xx é conferido pela
 * lista de respostas, que só admite as esperadas (a sondagem da sessão antes do login responde 401).
 */
export function monitorarErros(page: Page) {
  const permitidas: RespostaPermitida[] = [{ status: 401, url: /\/api\/v1\/sessao$/ }];
  const falhas: string[] = [];
  page.on('pageerror', (erro) => falhas.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() !== 'error' || mensagem.text().startsWith('Failed to load resource')) return;
    falhas.push(`console.error: ${mensagem.text()}`);
  });
  page.on('response', (resposta) => {
    if (resposta.status() < 400) return;
    const url = resposta.url().split('?')[0] ?? '';
    if (permitidas.some((p) => p.status === resposta.status() && p.url.test(url))) return;
    falhas.push(`HTTP ${resposta.status()} ${resposta.request().method()} ${url}`);
  });
  return {
    /** Admite uma resposta de erro esperada (ex.: 422 ao tentar avançar com bloqueio). */
    permitir(status: number, url: RegExp): void {
      permitidas.push({ status, url });
    },
    verificar(): void {
      expect(falhas, 'erros no navegador').toEqual([]);
    },
  };
}

/** O foco não pode cair no `<body>` depois de uma ação (botão desabilitado ou removido após a mutação). */
export async function esperarFocoPreservado(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true);
}

/** Aviso (toast) na região `aria-live` de avisos, com o texto informado. */
export async function esperarAviso(page: Page, texto: string | RegExp): Promise<void> {
  await expect(page.locator('.avisos').getByText(texto).first()).toBeVisible();
}
