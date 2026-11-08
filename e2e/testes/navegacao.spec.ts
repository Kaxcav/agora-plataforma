import { test } from '@playwright/test';
import { entrar, esperarPaginaOk, verificarAcessibilidade } from './apoio.ts';

const ROTAS = [
  '/', '/jornada', '/atas', '/contratos', '/itens',
  '/financeiro/empenhos', '/financeiro/pagamentos', '/financeiro/previsao',
  '/vinculos', '/fornecedores', '/sancoes',
  '/ajustes/modelos', '/ajustes/unidades', '/ajustes/grupos-uasg', '/ajustes/feriados',
  '/admin/usuarios', '/admin/perfis', '/admin/integracoes',
  '/auditoria', '/auditoria/lgpd',
];

test.describe('administrador percorre todas as telas', () => {
  for (const rota of ROTAS) {
    test(`tela ${rota} carrega sem erro e sem violações graves de acessibilidade`, async ({ page }) => {
      await entrar(page, 'admin');
      await page.goto(rota);
      await esperarPaginaOk(page);
      await verificarAcessibilidade(page, rota);
    });
  }
});
