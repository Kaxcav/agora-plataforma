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

/** Telas das frentes recentes, cada uma com a conta de demonstração que tem a permissão (sem as contas fiscal e auditor). */
const TELAS_POR_PERFIL: { rota: string; perfil: string }[] = [
  { rota: '/operacao', perfil: 'auditoria.externa' },
  { rota: '/metas-etp', perfil: 'planejamento' },
  { rota: '/desempenho', perfil: 'financeiro' },
  { rota: '/planejamento/pca', perfil: 'planejamento' },
  { rota: '/sociedade', perfil: 'gestor' },
  { rota: '/dados-abertos', perfil: 'consulta' },
  { rota: '/base-normativa', perfil: 'juridico' },
  { rota: '/qualidade-normativa', perfil: 'juridico' },
  { rota: '/publicacoes-dou', perfil: 'juridico' },
  { rota: '/controle', perfil: 'controle' },
];

test.describe('telas novas com a conta que tem a permissão', () => {
  for (const { rota, perfil } of TELAS_POR_PERFIL) {
    test(`tela ${rota} (${perfil}) carrega sem erro e sem violações graves de acessibilidade`, async ({ page }) => {
      await entrar(page, perfil);
      await page.goto(rota);
      await esperarPaginaOk(page);
      await verificarAcessibilidade(page, rota);
    });
  }
});
