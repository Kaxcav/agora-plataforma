/**
 * Vínculo entre os documentos do pacote do edital (TR, edital e minuta de contrato) e os parâmetros do edital
 * com que foram gerados (RN-06, art. 69). Cada documento guarda o hash dos parâmetros vigentes na geração; se os
 * parâmetros mudarem depois, o documento precisa ser gerado de novo e aprovado antes do avanço à etapa 5.
 */
import { sha256Hex } from '../../compartilhado/cripto.ts';
import type { ParametrosEdital, TipoDocumento } from './tipos.ts';

/** Documentos que formam o pacote do edital e dependem dos seus parâmetros (a minuta é anexo do edital). */
export const DOCUMENTOS_DO_PACOTE_DO_EDITAL: readonly TipoDocumento[] = ['tr', 'edital', 'minuta_contrato'];

/**
 * Hash determinístico (SHA-256) dos parâmetros do edital de que o documento depende: os campos entram em ordem
 * fixa, independentemente da ordem das chaves no JSON armazenado. `null` para documentos fora do pacote do edital.
 * A prova de conceito ou amostra (RN-20) a inversão de fases e o modo de disputa (diferente de aberto) entram só quando adotados, de modo que os documentos
 * gerados sem elas mantêm o hash anterior.
 */
export function hashParametrosDocumento(tipo: TipoDocumento, edital: ParametrosEdital): string | null {
  if (!DOCUMENTOS_DO_PACOTE_DO_EDITAL.includes(tipo)) return null;
  const prova = edital.provaConceito;
  const inversao = edital.inversaoFases;
  const canonico = JSON.stringify([
    'parametros-edital/v1',
    edital.criterioJulgamento,
    edital.regimeExecucao,
    edital.exigeFaturamentoMinimo,
    edital.patrimonioLiquidoMinimoPercentual,
    edital.exigeRegistroCadastralComplementar,
    ...(prova && prova.exigencia !== 'nenhuma' ? ['prova-conceito/v1', prova.exigencia, prova.roteiro, prova.justificativa, prova.prazoDiasUteis] : []),
    ...(inversao?.adotada ? ['inversao-fases/v1', inversao.motivacao] : []),
    ...(edital.modoDisputa && edital.modoDisputa !== 'aberto' ? ['modo-disputa/v1', edital.modoDisputa] : []),
  ]);
  return sha256Hex(canonico);
}

/**
 * O documento foi gerado com parâmetros do edital diferentes dos atuais. Sem hash registrado (documento gerado
 * antes do registro do vínculo), não se presume desatualização.
 */
export function geradoComParametrosAnteriores(tipo: TipoDocumento, hashRegistrado: string | null, edital: ParametrosEdital): boolean {
  if (hashRegistrado === null) return false;
  const atual = hashParametrosDocumento(tipo, edital);
  return atual !== null && atual !== hashRegistrado;
}
