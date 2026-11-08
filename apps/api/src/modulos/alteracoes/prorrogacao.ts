/**
 * RN-33 — travas da prorrogação (arts. 105 a 114), compartilhadas pela rota de prorrogação da frente C
 * (`POST /contratos/:id/prorrogacoes`) e pelo termo aditivo de prazo da aba Alterações, e o texto do alerta de
 * prorrogação que a varredura diária da central de notificações (frente J) acrescenta aos avisos de vencimento.
 */
import { avaliarAlertaProrrogacao, avaliarProrrogacao, formatarData, NATUREZAS_DURACAO, type AvaliacaoProrrogacao, type NaturezaDuracaoContrato } from '@agora/dominio';
import { z } from 'zod';
import type { Executor } from '../../banco/tipos.ts';
import { regraNegocio } from '../../http/erros.ts';
import type { LinhaContratoAlteracao } from './repositorio.ts';

/** Campos da RN-33 aceitos na prorrogação (todos opcionais na entrada; o domínio decide o que a natureza exige). */
export const camposTravasProrrogacao = {
  natureza: z.enum(NATUREZAS_DURACAO as [NaturezaDuracaoContrato, ...NaturezaDuracaoContrato[]]).optional(),
  vantajosidadeAtestada: z.boolean().optional(),
  precoCompativel: z.boolean().optional(),
  previsaoEdital: z.boolean().optional(),
  creditoOrcamentario: z.boolean().optional(),
  causaAtraso: z.enum(['sem_culpa_contratado', 'culpa_contratado']).optional(),
  moraConstituida: z.boolean().optional(),
};

export interface EntradaTravasProrrogacao {
  novaVigenciaFim: string;
  natureza?: NaturezaDuracaoContrato | undefined;
  vantajosidadeAtestada?: boolean | undefined;
  precoCompativel?: boolean | undefined;
  previsaoEdital?: boolean | undefined;
  creditoOrcamentario?: boolean | undefined;
  causaAtraso?: 'sem_culpa_contratado' | 'culpa_contratado' | undefined;
  moraConstituida?: boolean | undefined;
}

/**
 * Confere a RN-33 para o contrato: a natureza vem do contrato ou da entrada (a primeira prorrogação a registra).
 * Recusa com 422 e cada motivo marcado como RN-33.
 */
export function conferirTravasProrrogacao(
  contrato: Pick<LinhaContratoAlteracao, 'natureza_duracao' | 'vigencia_inicio' | 'vigencia_fim' | 'extinto_em'>,
  entrada: EntradaTravasProrrogacao,
  hoje: string,
): { natureza: NaturezaDuracaoContrato; avaliacao: AvaliacaoProrrogacao; travas: Record<string, unknown> } {
  const natureza = contrato.natureza_duracao ?? entrada.natureza ?? null;
  if (natureza === null) {
    throw regraNegocio('Informe a natureza do contrato quanto à duração para conferir os limites da prorrogação (RN-33).', [
      { campo: 'RN-33', mensagem: 'Natureza do contrato não informada (contínuo, escopo, TI estruturante ou receita).' },
    ]);
  }
  const travas = {
    vantajosidadeAtestada: entrada.vantajosidadeAtestada ?? false,
    precoCompativel: entrada.precoCompativel ?? false,
    previsaoEdital: entrada.previsaoEdital ?? false,
    creditoOrcamentario: entrada.creditoOrcamentario ?? false,
    ...(entrada.causaAtraso ? { causaAtraso: entrada.causaAtraso } : {}),
    moraConstituida: entrada.moraConstituida ?? false,
  };
  const avaliacao = avaliarProrrogacao({
    natureza,
    vigenciaInicio: contrato.vigencia_inicio,
    vigenciaFimAtual: contrato.vigencia_fim,
    novaVigenciaFim: entrada.novaVigenciaFim,
    hoje,
    ...travas,
    contratoExtinto: contrato.extinto_em !== null,
  });
  if (!avaliacao.permitido) {
    throw regraNegocio(
      'A prorrogação não atende às travas da RN-33 (Lei 14.133/2021, arts. 105 a 114).',
      avaliacao.motivos.map((mensagem) => ({ campo: 'RN-33', mensagem })),
    );
  }
  return { natureza, avaliacao, travas };
}

/**
 * Texto do alerta de prorrogação de cada contrato a até 120 dias do fim da vigência, para os avisos de vencimento
 * da central de notificações (RN-31 + RN-33): se cabe prorrogar e até quando, se a próxima prorrogação fica limitada
 * ou se é preciso nova licitação.
 */
export async function alertasProrrogacao(executor: Executor, ids: readonly string[], hoje: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const linhas = await executor.consultar<{
    id: string;
    natureza_duracao: NaturezaDuracaoContrato | null;
    vigencia_inicio: string;
    vigencia_fim: string;
    extinto_em: string | null;
  }>('SELECT id, natureza_duracao, vigencia_inicio, vigencia_fim, extinto_em FROM contratos WHERE id = ANY($1::uuid[])', [[...ids]]);
  for (const l of linhas) {
    if (l.extinto_em !== null) {
      mapa.set(l.id, `contrato extinto em ${formatarData(l.extinto_em)} (arts. 137 a 139): não cabe prorrogação.`);
      continue;
    }
    const alerta = avaliarAlertaProrrogacao({ natureza: l.natureza_duracao, vigenciaInicio: l.vigencia_inicio, vigenciaFim: l.vigencia_fim, hoje });
    if (alerta) mapa.set(l.id, `${alerta.mensagem} (${alerta.fundamento})`);
  }
  return mapa;
}
