import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORTA = Number(process.env.AGORA_E2E_PORTA ?? 3100);
const raiz = resolve(import.meta.dirname, '..');
// Banco novo (PGlite) a cada execução: dados sintéticos determinísticos.
const dados = mkdtempSync(join(tmpdir(), 'agora-e2e-'));

export default defineConfig({
  testDir: './testes',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node apps/api/dist/servidor.js',
    cwd: raiz,
    url: `http://127.0.0.1:${PORTA}/saude/pronto`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_PORTA: String(PORTA),
      AGORA_HOST: '127.0.0.1',
      AGORA_DADOS_DIR: dados,
      AGORA_COOKIE_SEGURO: 'false',
      AGORA_LOG_NIVEL: 'warn',
    },
  },
});
