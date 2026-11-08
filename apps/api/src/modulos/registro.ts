import type { FastifyInstance } from 'fastify';
import { rotasAdministracao } from './administracao/rotas.ts';
import { rotasAjustes } from './ajustes/rotas.ts';
import { rotasAtas } from './atas/rotas.ts';
import { rotasAuditoria } from './auditoria/rotas.ts';
import { rotasConfiguracao } from './configuracao/rotas.ts';
import { rotasContratos } from './contratos/rotas.ts';
import { rotasFinanceiro } from './financeiro/rotas.ts';
import { rotasFornecedores } from './fornecedores/rotas.ts';
import { rotasItens } from './itens/rotas.ts';
import { rotasJornada } from './jornada/rotas.ts';
import { rotasLgpd } from './lgpd/rotas.ts';
import { rotasPainel } from './painel/rotas.ts';
import { rotasPendencias } from './pendencias/rotas.ts';
import { rotasPublico } from './publico/rotas.ts';
import { rotasSancoes } from './sancoes/rotas.ts';
import { rotasSessao } from './sessao/rotas.ts';
import { rotasSincronizacoes } from './sincronizacoes/rotas.ts';
import { rotasTarefas } from './tarefas/rotas.ts';
import { rotasVinculos } from './vinculos/rotas.ts';
import { rotasDisputa } from './disputa/rotas.ts';

export type ModuloRotas = (api: FastifyInstance) => Promise<void>;

/** Módulos montados sob `/api/v1`. Cada rota declara a sua permissão com `exigir(...)`. */
export const MODULOS_API: readonly ModuloRotas[] = [
  rotasConfiguracao,
  rotasSessao,
  rotasPainel,
  rotasPendencias,
  rotasAtas,
  rotasContratos,
  rotasTarefas,
  rotasItens,
  rotasFinanceiro,
  rotasVinculos,
  rotasAjustes,
  rotasAdministracao,
  rotasAuditoria,
  rotasLgpd,
  rotasSincronizacoes,
  rotasFornecedores,
  rotasSancoes,
  rotasJornada,
  rotasPublico,
  rotasDisputa,
];
