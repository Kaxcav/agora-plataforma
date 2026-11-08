/**
 * Política de sustentabilidade do órgão e critérios do processo (RN-21). A política fica em `politicas_orgao`
 * (ligada por padrão, migração 011); só o administrador a altera, com justificativa na trilha de auditoria.
 */
import { verificarSustentabilidade, type CriteriosSustentabilidade } from '@agora/dominio';
import type { PoliticaSustentabilidade } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { MINIMO_CARACTERES_TEXTO } from './constantes.ts';
import type { LinhaProcesso } from './tipos.ts';

export const CODIGO_POLITICA_SUSTENTABILIDADE = 'sustentabilidade_obrigatoria';

/** Seção protegida do ETP e do TR com os dois critérios preenchidos; incompleta, chama-se `sustentabilidade_pendente`. */
export const SECAO_SUSTENTABILIDADE = 'sustentabilidade';

/** O ETP ou o TR foi gerado com os critérios de sustentabilidade e de logística reversa preenchidos (RN-21). */
export function documentoTrazSustentabilidade(conteudo: string): boolean {
  return conteudo.includes(`<!-- protegido:${SECAO_SUSTENTABILIDADE} -->`);
}

/** Política vigente; sem registro (banco anterior à migração), vale o padrão: ligada. */
export async function obterPoliticaSustentabilidade(executor: Executor): Promise<PoliticaSustentabilidade> {
  const [linha] = await executor.consultar<{ ativa: boolean; justificativa: string | null; alterada_em: string | null; alterada_por: string | null; nome: string | null }>(
    `SELECT p.ativa, p.justificativa, p.alterada_em, p.alterada_por, u.nome
       FROM politicas_orgao p LEFT JOIN usuarios u ON u.id = p.alterada_por
      WHERE p.codigo = $1`,
    [CODIGO_POLITICA_SUSTENTABILIDADE],
  );
  if (!linha) return { ativa: true, justificativa: null, alteradaEm: null, alteradaPor: null };
  return { ativa: linha.ativa, justificativa: linha.justificativa, alteradaEm: linha.alterada_em, alteradaPor: usuarioResumo(linha.alterada_por, linha.nome) };
}

export async function politicaSustentabilidadeAtiva(executor: Executor): Promise<boolean> {
  return (await obterPoliticaSustentabilidade(executor)).ativa;
}

export function criteriosDoProcesso(linha: Pick<LinhaProcesso, 'sustentabilidade'>): CriteriosSustentabilidade {
  return { criteriosAmbientais: linha.sustentabilidade.criteriosAmbientais ?? null, logisticaReversa: linha.sustentabilidade.logisticaReversa ?? null };
}

/** Verificação da RN-21 para o ETP ou o TR do processo (`verificarSustentabilidade`). */
export function sustentabilidadeDoProcesso(linha: Pick<LinhaProcesso, 'sustentabilidade'>, politicaAtiva: boolean, documento: 'etp' | 'tr') {
  return verificarSustentabilidade({ politicaAtiva, criterios: criteriosDoProcesso(linha), documento }, MINIMO_CARACTERES_TEXTO);
}
