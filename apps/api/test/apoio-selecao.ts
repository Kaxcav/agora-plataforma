import assert from 'node:assert/strict';
import type { ProcessoDetalhe } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, obterJson, type Credenciais } from './apoio.ts';

/** Motivação sintética com o mínimo exigido pelos atos da seleção (30 caracteres). */
export const MOTIVACAO_TESTE = 'Motivação sintética registrada pelo teste automatizado da Ágora.';
export const LINK_GRAVACAO_TESTE = 'https://video.orgao.exemplo/sessoes/prova-conceito-0001';

/**
 * Pratica, pela API, os atos da seleção que faltam até a homologação, no caminho sem recurso: convoca e aprova a
 * prova de conceito (se exigida), habilita o vencedor provisório, encerra o registro de intenções sem manifestação e,
 * como autoridade competente designada, adjudica e homologa (RN-20, RN-22 e RF-18).
 */
export async function concluirSelecao(app: FastifyInstance, processoId: string, agente: Credenciais, autoridade: Credenciais): Promise<ProcessoDetalhe> {
  const base = `/api/v1/processos/${processoId}/selecao`;
  let p = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${processoId}`);
  for (let passo = 0; passo < 12 && p.selecao.proximoAto !== 'concluida'; passo++) {
    const atos: Partial<Record<ProcessoDetalhe['selecao']['proximoAto'], [Credenciais, string, unknown]>> = {
      convocar_prova_conceito: [agente, `${base}/prova-conceito/convocacao`, undefined],
      registrar_resultado_prova_conceito: [agente, `${base}/prova-conceito/resultado`, { resultado: 'aprovado', motivacao: MOTIVACAO_TESTE, linkGravacao: LINK_GRAVACAO_TESTE }],
      registrar_habilitacao: [agente, `${base}/habilitacao`, { resultado: 'habilitado', motivacao: MOTIVACAO_TESTE }],
      registrar_intencao_recurso: [agente, `${base}/recurso/encerrar-intencao`, undefined],
      adjudicar: [autoridade, `${base}/adjudicacao`, { motivacao: null }],
      homologar: [autoridade, `${base}/homologacao`, { motivacao: null }],
    };
    const ato = atos[p.selecao.proximoAto];
    assert.ok(ato, `ato da seleção sem atalho no teste: ${p.selecao.proximoAto}`);
    const [credenciais, url, corpo] = ato;
    const r = await chamar(app, credenciais, 'POST', url, corpo);
    assert.equal(r.statusCode, 200, `${url} → ${r.statusCode} ${r.body}`);
    p = r.json<ProcessoDetalhe>();
  }
  assert.equal(p.selecao.proximoAto, 'concluida');
  return p;
}
