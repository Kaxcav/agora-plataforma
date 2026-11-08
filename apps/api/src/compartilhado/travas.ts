/**
 * Registro dos bloqueios aplicados pelas travas (RF-39, indicador de erros formais barrados).
 *
 * A trava lança o erro 422 de sempre, quase sempre dentro da transação da ação — que é desfeita. Por isso o ponto
 * de bloqueio só marca o erro com `travaAplicada` (ou envolve a verificação com `comTrava`), e o gancho `onError`
 * da API grava o evento `trava.bloqueio` numa transação própria, depois do desfazimento e antes da resposta.
 * Assim cada ponto de bloqueio muda em uma linha e o registro não depende de a ação ter sido confirmada.
 */
import type { FastifyInstance } from 'fastify';
import { auditar } from '../http/auditar.ts';
import { ErroApi } from '../http/erros.ts';

/** Ponto da jornada em que a trava atuou (agrupamento do painel). */
export type TipoTrava =
  | 'avanco_etapa'
  | 'documento_gerar'
  | 'documento_aprovar'
  | 'publicacao'
  | 'assinatura'
  | 'prorrogacao';

export const ROTULOS_TRAVA: Readonly<Record<TipoTrava, string>> = Object.freeze({
  avanco_etapa: 'Avanço de etapa da jornada',
  documento_gerar: 'Geração de minuta',
  documento_aprovar: 'Aprovação de documento',
  publicacao: 'Publicação do edital',
  assinatura: 'Assinatura do contrato',
  prorrogacao: 'Prorrogação do contrato',
});

export interface AlvoTrava {
  trava: TipoTrava;
  recurso: 'processo' | 'contrato';
  recursoId: string;
  uasg: string | null;
  /** Etapa da jornada no momento do bloqueio (processos). */
  etapa?: number | null;
  /** Identificação do registro para o resumo (número SEI do processo ou número do contrato). */
  identificador?: string | null;
}

/** Alvo de uma trava da jornada a partir da linha do processo. */
export function alvoDoProcesso(linha: { id: string; uasg: string; etapa_atual: number; numero_sei: string }, trava: TipoTrava): AlvoTrava {
  return { trava, recurso: 'processo', recursoId: linha.id, uasg: linha.uasg, etapa: linha.etapa_atual, identificador: linha.numero_sei };
}

const MARCAS = new WeakMap<Error, AlvoTrava>();
const REGRA = /^(RN|RF|RIA|RNF)-\d{2}$/;

/** Marca o erro de uma trava para que o bloqueio entre na trilha; devolve o próprio erro (`throw travaAplicada(...)`). */
export function travaAplicada<E extends Error>(alvo: AlvoTrava, erro: E): E {
  if (erro instanceof ErroApi && erro.codigo === 'REGRA_NEGOCIO') MARCAS.set(erro, alvo);
  return erro;
}

/** Executa a verificação de uma trava existente e marca o erro 422 que ela lançar. */
export async function comTrava<T>(alvo: AlvoTrava, verificar: () => T | Promise<T>): Promise<T> {
  try {
    return await verificar();
  } catch (erro) {
    if (erro instanceof Error) travaAplicada(alvo, erro);
    throw erro;
  }
}

/** Regras citadas nos detalhes do erro (o `campo` de cada detalhe é o código da regra). */
export function regrasDoBloqueio(erro: ErroApi): string[] {
  const regras = new Set<string>();
  for (const d of erro.detalhes ?? []) if (d.campo && REGRA.test(d.campo)) regras.add(d.campo);
  return [...regras].sort();
}

/**
 * Gancho que grava os bloqueios marcados. Registrado no contexto das rotas `/api/v1` (os ganchos do Fastify valem
 * para todas as rotas do contexto, inclusive as declaradas antes). Falha na gravação vai para o log e não muda a
 * resposta do bloqueio.
 */
export function registrarGravacaoTravas(api: FastifyInstance): void {
  api.addHook('onError', async (request, _reply, erro) => {
    const alvo = MARCAS.get(erro);
    if (!alvo || !(erro instanceof ErroApi)) return;
    MARCAS.delete(erro);
    const regras = regrasDoBloqueio(erro);
    const rotulo = ROTULOS_TRAVA[alvo.trava];
    try {
      await request.server.agora.banco.transacao(async (tx) => {
        await auditar(tx, request, {
          acao: 'trava.bloqueio',
          recurso: alvo.recurso,
          recursoId: alvo.recursoId,
          resumo: `Trava barrou: ${rotulo.toLowerCase()}${alvo.identificador ? ` (${alvo.identificador})` : ''}${regras.length > 0 ? ` — ${regras.join(', ')}` : ''}`,
          dados: {
            trava: alvo.trava,
            regras,
            uasg: alvo.uasg,
            etapa: alvo.etapa ?? null,
            mensagem: erro.message.slice(0, 500),
            quantidadeMotivos: erro.detalhes?.length ?? 0,
            ...(alvo.recurso === 'contrato' ? { instrumentoTipo: 'contrato', instrumentoId: alvo.recursoId } : { processoId: alvo.recursoId }),
          },
        });
      });
    } catch (falha) {
      request.log.error({ err: falha }, 'falha ao registrar na trilha o bloqueio de uma trava');
    }
  });
}
