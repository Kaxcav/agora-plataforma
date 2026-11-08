import type { Manipuladores } from '../../fila/tipos.ts';
import { executarPublicacaoArquivo, executarPublicacaoCompra, executarPublicacaoContrato } from '../publicacao-pncp/tarefas.ts';
import { executarTarefaSincronizacao } from './sincronizacao.ts';
import { executarPublicacaoPca } from '../planejamento/publicacao.ts';

/** O que o trabalhador sabe executar, por tipo de tarefa (usado pela API com trabalhador embutido e por src/trabalhador.ts). */
export const MANIPULADORES: Manipuladores = {
  sincronizacao: executarTarefaSincronizacao,
  'pncp.compra': executarPublicacaoCompra,
  'pncp.arquivo': executarPublicacaoArquivo,
  'pncp.contrato': executarPublicacaoContrato,
  'pncp.pca': executarPublicacaoPca,
};
