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
import { rotasExecucao } from './execucao/rotas.ts';
import { rotasOperacao } from './operacao/rotas.ts';
import { rotasMetasEtp } from './metas-etp/rotas.ts';
import { rotasImr } from './imr/rotas.ts';
import { rotasPreparatorios } from './preparatorios/rotas.ts';
import { rotasSociedade } from './sociedade/rotas.ts';
import { rotasDadosAbertos } from './dados-abertos/rotas.ts';
import { rotasAlteracoes } from './alteracoes/rotas.ts';
import { rotasIaAncorada } from './ia-ancorada/rotas.ts';
import { rotasSei } from './sei/rotas.ts';
import { rotasDou } from './dou/rotas.ts';
import { rotasSigilo } from './sigilo/rotas.ts';
import { rotasDesempenho } from './desempenho/rotas.ts';
import { rotasLicoes } from './licoes/rotas.ts';

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
  rotasExecucao,
  rotasOperacao,
  rotasMetasEtp,
  rotasImr,
  rotasPreparatorios,
  rotasSociedade,
  rotasDadosAbertos,
  rotasAlteracoes,
  rotasIaAncorada,
  rotasSei,
  rotasDou,
  rotasSigilo,
  rotasDesempenho,
  rotasLicoes,
];
