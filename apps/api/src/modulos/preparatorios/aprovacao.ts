/**
 * Regras da aprovação e da assinatura das peças complementares, chamadas pelas rotas de documentos da jornada:
 * - portaria de designação, declaração de adequação orçamentária e despacho de autorização são atos da autoridade
 *   competente: só ela, designada na equipe do processo, os aprova e assina (arts. 7º, 8º, 53, § 3º, e 150);
 * - a declaração só é aprovada com a dotação válida e gerada com a dotação atual; o despacho, com a declaração
 *   aprovada (RN-39).
 */
import { validarDotacaoOrcamentaria } from '@agora/dominio';
import type { Executor } from '../../banco/tipos.ts';
import { regraNegocio, semPermissao } from '../../http/erros.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import type { DocumentoCarregado, LinhaProcesso } from '../jornada/tipos.ts';
import { DOCUMENTOS_DA_AUTORIDADE } from './constantes.ts';
import { carregarDotacao, documentoTrazDotacao, hashDotacao, situacaoDeclaracao } from './dotacao.ts';

export async function exigirAutoridadeDesignada(executor: Executor, processoId: string, tipo: string | null, usuarioId: string): Promise<void> {
  if (tipo === null || !DOCUMENTOS_DA_AUTORIDADE.has(tipo)) return;
  const [designado] = await executor.consultar<{ ok: number }>(
    `SELECT 1 AS ok FROM processos_equipe WHERE processo_id = $1 AND papel = 'autoridade_competente' AND usuario_id = $2`,
    [processoId, usuarioId],
  );
  if (!designado) {
    throw semPermissao('Somente a autoridade competente designada na equipe do processo aprova e assina a portaria, a declaração de adequação orçamentária e o despacho de autorização.');
  }
}

export async function verificarAprovacaoComplementar(
  executor: Executor,
  linha: LinhaProcesso,
  doc: { tipo: string; titulo: string; versao: number; conteudo: string },
  usuarioId: string,
  hoje: string,
): Promise<void> {
  await exigirAutoridadeDesignada(executor, linha.id, doc.tipo, usuarioId);
  if (doc.tipo !== 'declaracao_orcamentaria' && doc.tipo !== 'despacho_autorizacao') return;
  const dotacao = await carregarDotacao(executor, linha.id);
  const validacao = validarDotacaoOrcamentaria(dotacao.linhas, { hoje, valorEstimado: valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, hoje)) });
  const hash = hashDotacao(validacao.linhas);
  const pendencias = validacao.pendencias.map((p) => p.mensagem);
  if (doc.tipo === 'declaracao_orcamentaria') {
    if (hash !== null && !documentoTrazDotacao(doc.conteudo, hash)) {
      pendencias.push(`A versão ${doc.versao} da declaração foi gerada com outra dotação: gere nova versão com a dotação atual.`);
    }
  } else {
    const declaracoes = await executor.consultar<Pick<DocumentoCarregado, 'tipo' | 'conteudo' | 'situacao'>>(
      `SELECT tipo, conteudo, situacao FROM documentos_gerados
        WHERE processo_id = $1 AND tipo = 'declaracao_orcamentaria'
        ORDER BY versao DESC LIMIT 1`,
      [linha.id],
    );
    if (situacaoDeclaracao(declaracoes, hash) !== 'aprovada') {
      pendencias.push('Aprove antes a declaração de adequação orçamentária com a dotação atual: sem crédito indicado, a contratação não é autorizada (art. 150).');
    }
  }
  if (pendencias.length > 0) {
    throw regraNegocio(
      `"${doc.titulo}" não pode ser aprovado sem a dotação orçamentária válida e declarada (RN-39).`,
      pendencias.map((mensagem) => ({ campo: 'RN-39', mensagem })),
    );
  }
}
