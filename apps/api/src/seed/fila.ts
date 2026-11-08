import { chaveIdempotencia, POLITICA_PADRAO_FILA } from '@agora/dominio';
import type { ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/** Semente própria: a etapa não consome a sequência do gerador compartilhado pelas demais. */
const SEMENTE_FILA = 14_133_007;

/**
 * Fila de integrações (RNF-07) na demonstração: uma sincronização sintética do SIAFI que esgotou as tentativas
 * durante uma janela de manutenção simulada e está na fila de erro, para mostrar o reprocessamento na tela de
 * integrações. Nenhuma chamada externa é feita; reprocessada, ela roda o conector offline.
 */
export async function gerarFila(ctx: ContextoSeed): Promise<void> {
  const id = new Prng(SEMENTE_FILA).uuid();
  const criadaEm = new Date(ctx.agora.getTime() - 3 * 60 * 60 * 1000);
  const ultimaFalha = new Date(ctx.agora.getTime() - 30 * 60 * 1000);
  const tentativas = POLITICA_PADRAO_FILA.maximoTentativas;
  const erro = `SIAFI indisponível nas ${tentativas} tentativas: janela de manutenção programada da fonte (simulação da carga de demonstração).`;
  await ctx.tx.executar(
    `INSERT INTO fila_tarefas (id, tipo, chave_idempotencia, descricao, carga, recurso_tipo, recurso_id, situacao, tentativas,
                               maximo_tentativas, disponivel_em, ultimo_erro, criada_em, atualizada_em)
     VALUES ($1, 'sincronizacao', $2, 'Sincronizar Empenhos (SIAFI)', $3::jsonb, 'sincronizacao', 'SIAFI', 'erro', $4, $4, $5, $6, $5, $7)`,
    [
      id,
      chaveIdempotencia(['sincronizacao', 'SIAFI', 'carga-demonstracao']),
      JSON.stringify({ fonte: 'SIAFI', usuarioId: null, ipHash: null }),
      tentativas,
      criadaEm.toISOString(),
      erro,
      ultimaFalha.toISOString(),
    ],
  );
  ctx.eventos.push({
    ocorridoEm: ultimaFalha,
    usuarioId: null,
    acao: 'fila.erro',
    recurso: 'fila_tarefa',
    recursoId: id,
    resumo: '"Sincronizar Empenhos (SIAFI)" foi para a fila de erro (tentativas esgotadas)',
    dados: { tipo: 'sincronizacao', tentativas, maximoTentativas: tentativas, erro, destino: 'fila_erro', motivo: 'limite_tentativas', transporte: 'postgres' },
  });
  ctx.dados.contagens['tarefasFilaDemonstracao'] = 1;
}
