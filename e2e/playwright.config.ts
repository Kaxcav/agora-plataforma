import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORTA = Number(process.env.AGORA_E2E_PORTA ?? 3100);
const raiz = resolve(import.meta.dirname, '..');
// Banco novo (PGlite) a cada execução: dados sintéticos determinísticos.
const dados = mkdtempSync(join(tmpdir(), 'agora-e2e-'));
const navegador = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
/**
 * O banco é um só para a suíte, e os arquivos rodam em ordem alfabética. O processo dos rádios é o único da carga
 * pronto para passar da etapa 5 à 6: a sala de disputa (PoC-03) precisa dele na etapa 5 ou 6, e o PoC-04
 * (`ceis-cnep.spec.ts`) o leva até a etapa 7. A sala roda antes, na ordem da jornada (disputa → seleção → contrato);
 * o PoC-04 parte da etapa em que a sala deixou o processo.
 */
const ANTES_DA_CONTRATACAO = /sala-disputa\.spec\.ts$/;

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
  // Com um único worker, os projetos rodam na ordem desta lista. Sem `dependencies` de propósito: uma falha na sala
  // não deixa de executar o resto da suíte.
  projects: [
    { name: 'disputa', testMatch: ANTES_DA_CONTRATACAO, use: navegador },
    { name: 'chromium', testIgnore: ANTES_DA_CONTRATACAO, use: navegador },
  ],
  webServer: {
    command: 'node apps/api/dist/servidor.js',
    cwd: raiz,
    url: `http://127.0.0.1:${PORTA}/saude/pronto`,
    // A carga sintética de demonstração tem dezenas de etapas: ~30 s com a máquina livre, bem mais sob carga.
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_PORTA: String(PORTA),
      AGORA_HOST: '127.0.0.1',
      AGORA_DADOS_DIR: dados,
      AGORA_COOKIE_SEGURO: 'false',
      AGORA_LOG_NIVEL: 'warn',
      // A suíte inteira passa pelo mesmo IP: sem isso, o limite padrão (300/min) devolve 429 no meio dos testes.
      AGORA_LIMITE_REQUISICOES_MINUTO: '100000',
    },
  },
});
