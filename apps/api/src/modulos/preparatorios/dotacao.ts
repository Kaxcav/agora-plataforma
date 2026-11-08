/**
 * Dotação orçamentária do processo (RN-39; Lei 14.133/2021, art. 6º, XXIII, "j", art. 18, caput, e art. 150).
 *
 * A dotação é gravada em `processos_dotacoes` (migração 025). A declaração de adequação orçamentária é o documento
 * `declaracao_orcamentaria`, aprovado pela autoridade competente designada. O TR, a minuta e a declaração gravam no
 * texto o hash da dotação com que foram gerados (`<!-- dotacao:<hash> -->`, dentro de seção protegida): mudar a
 * dotação desatualiza a declaração e pede nova versão do TR e da minuta antes do avanço da etapa 4 para a 5.
 */
import {
  chaveDotacao,
  validarDotacaoOrcamentaria,
  verificarDotacaoParaEdital,
  type DeclaracaoAgente,
  type LinhaDotacao,
  type SituacaoDeclaracaoOrcamentaria,
  type SituacaoDotacaoDocumento,
  type ValidacaoDotacao,
} from '@agora/dominio';
import type { Bloqueio, DotacaoProcesso, Sinal } from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { paraDeclaracaoDominio, type LinhaDeclaracao } from '../impedimentos/declaracoes.ts';
import type { CargaProcesso, DadosPreparatorios, DocumentoCarregado, DotacaoArmazenada, LinhaProcesso } from '../jornada/tipos.ts';

export const DOTACAO_VAZIA: DotacaoArmazenada = { linhas: [], registradaEm: null, registradaPor: null };

/** Documentos que trazem a dotação e entram na RN-39. */
export const DOCUMENTOS_COM_DOTACAO = ['tr', 'minuta_contrato'] as const;

export async function carregarDotacao(executor: Executor, processoId: string): Promise<DotacaoArmazenada> {
  const linhas = await executor.consultar<{
    unidade_gestora: string;
    programa_trabalho: string;
    natureza_despesa: string;
    fonte_recursos: string;
    exercicio: number;
    valor: number;
    pre_empenho: string | null;
    registrada_em: string;
    registrada_por: string | null;
    registrada_por_nome: string | null;
  }>(
    `SELECT d.unidade_gestora, d.programa_trabalho, d.natureza_despesa, d.fonte_recursos, d.exercicio, d.valor, d.pre_empenho,
            d.registrada_em, d.registrada_por, u.nome AS registrada_por_nome
       FROM processos_dotacoes d
       LEFT JOIN usuarios u ON u.id = d.registrada_por
      WHERE d.processo_id = $1
      ORDER BY d.ordem`,
    [processoId],
  );
  const primeira = linhas[0];
  if (!primeira) return DOTACAO_VAZIA;
  return {
    linhas: linhas.map((l) => ({
      unidadeGestora: l.unidade_gestora,
      programaTrabalho: l.programa_trabalho,
      naturezaDespesa: l.natureza_despesa,
      fonteRecursos: l.fonte_recursos,
      exercicio: l.exercicio,
      valor: l.valor,
      preEmpenho: l.pre_empenho,
    })),
    registradaEm: primeira.registrada_em,
    registradaPor: primeira.registrada_por && primeira.registrada_por_nome ? { id: primeira.registrada_por, nome: primeira.registrada_por_nome } : null,
  };
}

/** Substitui a dotação do processo (linhas já normalizadas e com formato conferido). */
export async function gravarDotacao(
  tx: Transacao,
  processoId: string,
  linhas: readonly LinhaDotacao[],
  meta: { usuarioId: string | null; agora: Date; novoId: () => string },
): Promise<void> {
  await tx.executar('DELETE FROM processos_dotacoes WHERE processo_id = $1', [processoId]);
  let ordem = 0;
  for (const l of linhas) {
    ordem += 1;
    await tx.executar(
      `INSERT INTO processos_dotacoes (id, processo_id, ordem, unidade_gestora, programa_trabalho, natureza_despesa, fonte_recursos, exercicio, valor,
                                       pre_empenho, registrada_em, registrada_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        meta.novoId(),
        processoId,
        ordem,
        l.unidadeGestora,
        l.programaTrabalho,
        l.naturezaDespesa,
        l.fonteRecursos,
        l.exercicio,
        l.valor,
        l.preEmpenho ?? null,
        meta.agora.toISOString(),
        meta.usuarioId,
      ],
    );
  }
  await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [processoId, meta.agora.toISOString()]);
}

/** Declarações vigentes dos agentes designados no processo (RN-28), sem cargo nem matrícula. */
async function declaracoesDaEquipe(executor: Executor, processoId: string): Promise<Record<string, DeclaracaoAgente>> {
  const linhas = await executor.consultar<LinhaDeclaracao>(
    `SELECT d.id, d.usuario_id, u.nome AS usuario_nome, d.declarada_em, d.data_declaracao, d.sem_parentesco_ou_vinculo,
            d.sem_conflito_interesses, d.vinculo, NULL AS cargo_matricula, d.capacitacao, d.capacitacao_descricao
       FROM declaracoes_agentes d
       JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.vigente AND d.usuario_id IN (SELECT e.usuario_id FROM processos_equipe e WHERE e.processo_id = $1)`,
    [processoId],
  );
  return Object.fromEntries(linhas.map((l) => [l.usuario_id, paraDeclaracaoDominio(l)]));
}

export async function carregarDadosPreparatorios(executor: Executor, processoId: string): Promise<DadosPreparatorios> {
  return { dotacao: await carregarDotacao(executor, processoId), declaracoes: await declaracoesDaEquipe(executor, processoId) };
}

export function dotacaoDaCarga(carga: CargaProcesso): DotacaoArmazenada {
  return carga.preparatorios?.dotacao ?? DOTACAO_VAZIA;
}

/** Hash (SHA-256) da chave canônica da dotação; null sem linhas. */
export function hashDotacao(linhas: readonly LinhaDotacao[]): string | null {
  return linhas.length === 0 ? null : sha256Hex(chaveDotacao(linhas));
}

/** Marcador gravado no texto do TR, da minuta e da declaração: liga o documento à dotação com que foi gerado. */
export function marcadorDotacao(hash: string): string {
  return `<!-- dotacao:${hash} -->`;
}

export function documentoTrazDotacao(conteudo: string, hash: string | null): boolean {
  return hash !== null && conteudo.includes(marcadorDotacao(hash));
}

/** Situação da declaração de adequação orçamentária frente à dotação atual. */
export function situacaoDeclaracao(documentos: readonly Pick<DocumentoCarregado, 'tipo' | 'conteudo' | 'situacao'>[], hash: string | null): SituacaoDeclaracaoOrcamentaria {
  const doc = documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
  if (!doc) return 'nao_gerada';
  if (!documentoTrazDotacao(doc.conteudo, hash)) return 'desatualizada';
  return doc.situacao === 'aprovado' ? 'aprovada' : 'rascunho';
}

function situacaoDocumento(doc: DocumentoCarregado | undefined, hash: string | null): SituacaoDotacaoDocumento {
  if (!doc) return 'nao_gerado';
  return documentoTrazDotacao(doc.conteudo, hash) ? 'com_dotacao' : 'sem_dotacao';
}

export function validarDotacaoDaCarga(carga: CargaProcesso, hoje: string, valorEstimado: number | null): ValidacaoDotacao {
  return validarDotacaoOrcamentaria(dotacaoDaCarga(carga).linhas, { hoje, valorEstimado });
}

const FUNDAMENTO_RN39 = 'Lei 14.133/2021, art. 6º, XXIII, "j", art. 18, caput, e art. 150 (RN-39)';

/**
 * RN-39 na etapa 4: sem a dotação declarada (e trazida pelo TR e pela minuta), o processo não segue para o edital.
 * Nas demais etapas não há bloqueio; créditos menores que o valor estimado viram sinal.
 */
export function avaliarDotacaoDoProcesso(carga: CargaProcesso, hoje: string, valorEstimado: number | null): { bloqueios: Bloqueio[]; sinais: Sinal[] } {
  const { linha } = carga;
  if (linha.etapa_atual !== 4) return { bloqueios: [], sinais: [] };
  const validacao = validarDotacaoDaCarga(carga, hoje, valorEstimado);
  const hash = hashDotacao(validacao.linhas);
  const resultado = verificarDotacaoParaEdital({
    validacao,
    declaracao: situacaoDeclaracao(carga.documentos, hash),
    documentos: DOCUMENTOS_COM_DOTACAO.map((tipo) => {
      const doc = carga.documentos.find((d) => d.tipo === tipo);
      return { titulo: doc?.titulo ?? tipo, versao: doc?.versao ?? null, situacao: situacaoDocumento(doc, hash) };
    }),
  });
  return {
    bloqueios: resultado.pendencias.map((mensagem) => ({ regra: 'RN-39', mensagem, fundamento: FUNDAMENTO_RN39, etapa: 4 })),
    sinais: validacao.sinais.map((mensagem) => ({ regra: 'RN-39', nivel: 'atencao', mensagem, fundamento: FUNDAMENTO_RN39 })),
  };
}

/** GET /processos/:id/dotacao. */
export function montarDotacaoProcesso(carga: CargaProcesso, hoje: string, valorEstimado: number | null): DotacaoProcesso {
  const armazenada = dotacaoDaCarga(carga);
  const validacao = validarDotacaoOrcamentaria(armazenada.linhas, { hoje, valorEstimado });
  const hash = hashDotacao(validacao.linhas);
  const situacao = situacaoDeclaracao(carga.documentos, hash);
  const declaracao = carga.documentos.find((d) => d.tipo === 'declaracao_orcamentaria') ?? null;
  return {
    linhas: armazenada.linhas.map((l) => ({ ...l, preEmpenho: l.preEmpenho ?? null })),
    registradaEm: armazenada.registradaEm,
    registradaPor: armazenada.registradaPor ? usuarioResumo(armazenada.registradaPor.id, armazenada.registradaPor.nome) : null,
    exercicioReferencia: validacao.exercicioReferencia,
    total: validacao.total,
    totalExercicio: validacao.totalExercicio,
    valida: validacao.valida,
    pendencias: validacao.pendencias.map((p) => p.mensagem),
    sinais: validacao.sinais,
    declaracao: {
      situacao,
      versao: declaracao?.versao ?? null,
      aprovadaPor: declaracao?.situacao === 'aprovado' ? declaracao.revisadoPor : null,
      numeroSei: declaracao?.numeroSei ?? null,
    },
    declarada: validacao.valida && situacao === 'aprovada',
    editavel: dotacaoEditavel(carga.linha),
    fundamento: validacao.fundamento,
  };
}

/** A dotação pode ser alterada até a etapa 4 (a partir da 5 o edital já foi encaminhado com ela). */
export function dotacaoEditavel(linha: Pick<LinhaProcesso, 'etapa_atual' | 'contrato_id'>): boolean {
  return linha.etapa_atual <= 4 && linha.contrato_id === null;
}
