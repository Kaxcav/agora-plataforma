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
import { rotasRegularidade } from './regularidade/rotas.ts';
import { rotasSancoes } from './sancoes/rotas.ts';
import { rotasSessao } from './sessao/rotas.ts';
import { rotasSincronizacoes } from './sincronizacoes/rotas.ts';
import { rotasTarefas } from './tarefas/rotas.ts';
import { rotasVinculos } from './vinculos/rotas.ts';
import { rotasPesquisaPrecos } from './precos/rotas.ts';
import { rotasNotificacoes } from './notificacoes/rotas.ts';
import { rotasDisputa } from './disputa/rotas.ts';
import { rotasControle } from './controle/rotas.ts';
import { rotasSelecao } from './selecao/rotas.ts';
import { rotasPoliticas } from './politicas/rotas.ts';
import { rotasDocumentos } from './documentos/rotas.ts';
import { rotasImpedimentos } from './impedimentos/rotas.ts';
import { rotasFila } from './fila/rotas.ts';
import { rotasPublicacaoPncp } from './publicacao-pncp/rotas.ts';
import { rotasOperacao } from './operacao/rotas.ts';
import { rotasMetasEtp } from './metas-etp/rotas.ts';

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
  rotasPesquisaPrecos,
  rotasNotificacoes,
  rotasDisputa,
  rotasControle,
  rotasSelecao,
  rotasPoliticas,
  rotasRegularidade,
  rotasDocumentos,
  rotasImpedimentos,
  rotasFila,
  rotasPublicacaoPncp,
  rotasOperacao,
  rotasMetasEtp,
];
