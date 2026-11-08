/**
 * Base de conhecimento da execução (RIA-12): ocorrências registradas pela fiscalização, fatos derivados (aditivos,
 * sanções e avaliações) e decisões do agente sobre as sugestões. As sugestões vêm de @agora/dominio.
 */
import {
  derivarFatosExecucao,
  hojeISO,
  situacaoAvaliacaoDesempenho,
  type ContratoBaseConhecimento,
  type DocumentoLicao,
  type FatoExecucao,
  type IncisoInfracao,
  type LicaoAceita,
  type TipoSancao,
} from '@agora/dominio';
import type { CategoriaLicao, DecisaoLicao, OcorrenciaExecucao, SituacaoOcorrenciaExecucao, SugestaoLicaoAprendida, TipoOcorrenciaExecucao } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

interface LinhaOcorrencia {
  id: string;
  contrato_id: string;
  tipo: TipoOcorrenciaExecucao;
  categoria: CategoriaLicao;
  data: string;
  descricao: string;
  dias_atraso: number | null;
  valor_glosa: number | null;
  situacao: SituacaoOcorrenciaExecucao;
  resolvida_em: string | null;
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
}

function paraOcorrencia(l: LinhaOcorrencia): OcorrenciaExecucao {
  return {
    id: l.id,
    contratoId: l.contrato_id,
    tipo: l.tipo,
    categoria: l.categoria,
    data: l.data,
    descricao: l.descricao,
    diasAtraso: l.dias_atraso,
    valorGlosa: l.valor_glosa,
    situacao: l.situacao,
    resolvidaEm: l.resolvida_em,
    registradaPor: usuarioResumo(l.registrada_por, l.registrada_por_nome),
    registradaEm: l.registrada_em,
  };
}

export async function listarOcorrencias(executor: Executor, filtro: { contratoId?: string; id?: string; escopo: string[] | null }): Promise<OcorrenciaExecucao[]> {
  const linhas = await executor.consultar<LinhaOcorrencia>(
    `SELECT o.id, o.contrato_id, o.tipo, o.categoria, o.data, o.descricao, o.dias_atraso, o.valor_glosa, o.situacao, o.resolvida_em,
            o.registrada_por, u.nome AS registrada_por_nome, o.registrada_em
       FROM ocorrencias_execucao o
       LEFT JOIN usuarios u ON u.id = o.registrada_por
      WHERE ($1::uuid IS NULL OR o.contrato_id = $1) AND ($2::uuid IS NULL OR o.id = $2)
        AND ($3::text[] IS NULL OR o.uasg = ANY($3::text[]))
      ORDER BY o.data DESC, o.registrada_em DESC, o.id`,
    [filtro.contratoId ?? null, filtro.id ?? null, filtro.escopo],
  );
  return linhas.map(paraOcorrencia);
}

interface LinhaContratoBase {
  id: string;
  numero: string;
  objeto: string;
  valor_inicial: number;
}

/**
 * Base de conhecimento no escopo de UASG do usuário: contratos (objeto e itens com o código do catálogo) e todos os
 * fatos — ocorrências registradas e fatos derivados de aditivos, sanções aplicadas e avaliações definitivas.
 */
export async function carregarBaseConhecimento(
  executor: Executor,
  escopo: string[] | null,
  hoje: string,
  contratoId: string | null = null,
): Promise<{ contratos: ContratoBaseConhecimento[]; fatos: FatoExecucao[] }> {
  const contratos = await executor.consultar<LinhaContratoBase>(
    `SELECT id, numero, objeto, valor_inicial FROM contratos
      WHERE ($1::text[] IS NULL OR uasg = ANY($1::text[])) AND ($2::uuid IS NULL OR id = $2)
      ORDER BY id`,
    [escopo, contratoId],
  );
  const ids = contratos.map((c) => c.id);
  const itens = await executor.consultar<{ contrato_id: string; descricao: string; catmat: string | null }>(
    `SELECT ic.contrato_id, ic.descricao, ia.catmat FROM itens_contrato ic LEFT JOIN itens_ata ia ON ia.id = ic.item_ata_id
      WHERE ic.contrato_id = ANY($1::uuid[]) ORDER BY ic.contrato_id, ic.numero`,
    [ids],
  );
  const ocorrencias = await executor.consultar<{ id: string; contrato_id: string; tipo: TipoOcorrenciaExecucao; categoria: CategoriaLicao; data: string; descricao: string }>(
    'SELECT id, contrato_id, tipo, categoria, data, descricao FROM ocorrencias_execucao WHERE contrato_id = ANY($1::uuid[])',
    [ids],
  );
  const aditivos = await executor.consultar<{ id: string; contrato_id: string; tipo: string; valor: number; assinado_em: string; justificativa: string }>(
    'SELECT id, contrato_id, tipo, valor, assinado_em, justificativa FROM aditivos WHERE contrato_id = ANY($1::uuid[])',
    [ids],
  );
  const sancoes = await executor.consultar<{ id: string; contrato_id: string; tipo: TipoSancao; inciso_infracao: IncisoInfracao; aplicada_em: string; relato: string }>(
    `SELECT id, contrato_id, tipo, inciso_infracao, aplicada_em, relato FROM sancoes
      WHERE contrato_id = ANY($1::uuid[]) AND situacao = 'aplicada' AND aplicada_em IS NOT NULL`,
    [ids],
  );
  const avaliacoes = await executor.consultar<{
    id: string;
    contrato_id: string;
    nota: number;
    periodo_fim: string;
    prazo_manifestacao: string;
    manifestacao: { concorda: boolean } | null;
    analise: { decisao: 'mantida' | 'revista' } | null;
  }>('SELECT id, contrato_id, nota, periodo_fim, prazo_manifestacao, manifestacao, analise FROM avaliacoes_desempenho WHERE contrato_id = ANY($1::uuid[])', [ids]);
  // Rescisões assinadas no registro das alterações contratuais (frente K).
  const rescisoes = await executor.consultar<{ id: string; contrato_id: string; assinado_em: string; justificativa: string }>(
    `SELECT id, contrato_id, assinado_em, justificativa FROM alteracoes_contratuais
      WHERE contrato_id = ANY($1::uuid[]) AND especie = 'rescisao' AND situacao = 'assinado' AND assinado_em IS NOT NULL`,
    [ids],
  );

  const fatos: FatoExecucao[] = ocorrencias.map((o) => ({ id: `ocorrencia:${o.id}`, contratoId: o.contrato_id, tipo: o.tipo, categoria: o.categoria, data: o.data, descricao: o.descricao }));
  for (const c of contratos) {
    fatos.push(
      ...derivarFatosExecucao({
        contratoId: c.id,
        valorInicial: c.valor_inicial,
        aditivos: aditivos.filter((a) => a.contrato_id === c.id).map((a) => ({ id: a.id, tipo: a.tipo, valor: a.valor, assinadoEm: a.assinado_em, justificativa: a.justificativa })),
        sancoes: sancoes
          .filter((s) => s.contrato_id === c.id)
          .map((s) => ({ id: s.id, tipo: s.tipo, incisoInfracao: s.inciso_infracao, aplicadaEm: s.aplicada_em, relato: s.relato })),
        avaliacoes: avaliacoes
          .filter((a) => a.contrato_id === c.id)
          .map((a) => ({
            id: a.id,
            nota: a.nota,
            periodoFim: a.periodo_fim,
            definitiva: situacaoAvaliacaoDesempenho({ prazoManifestacao: a.prazo_manifestacao, manifestacao: a.manifestacao, analise: a.analise }, hoje).definitiva,
          })),
        rescisoes: rescisoes.filter((r) => r.contrato_id === c.id).map((r) => ({ id: r.id, assinadaEm: r.assinado_em, justificativa: r.justificativa })),
      }),
    );
  }
  return {
    contratos: contratos.map((c) => ({
      id: c.id,
      numero: c.numero,
      objeto: c.objeto,
      itens: itens.filter((i) => i.contrato_id === c.id).map((i) => ({ catmat: i.catmat, descricao: i.descricao })),
    })),
    fatos,
  };
}

// ───────────────────────── decisões do agente ─────────────────────────

interface LinhaDecisao {
  chave: string;
  documento: DocumentoLicao;
  decisao: 'aceita' | 'recusada';
  motivo: string | null;
  sugestao: SugestaoLicaoAprendida;
  decidida_por: string | null;
  decidida_por_nome: string | null;
  decidida_em: string;
}

export async function listarDecisoes(executor: Executor, processoId: string, documento: DocumentoLicao | null): Promise<LinhaDecisao[]> {
  return executor.consultar<LinhaDecisao>(
    `SELECT d.chave, d.documento, d.decisao, d.motivo, d.sugestao, d.decidida_por, u.nome AS decidida_por_nome, d.decidida_em
       FROM licoes_decisoes d LEFT JOIN usuarios u ON u.id = d.decidida_por
      WHERE d.processo_id = $1 AND ($2::text IS NULL OR d.documento = $2)
      ORDER BY d.decidida_em, d.chave`,
    [processoId, documento],
  );
}

export function paraDecisao(l: LinhaDecisao): DecisaoLicao {
  return { chave: l.chave, titulo: l.sugestao.titulo, decisao: l.decisao, motivo: l.motivo, por: usuarioResumo(l.decidida_por, l.decidida_por_nome), em: l.decidida_em };
}

/** Lições aceitas pelo agente, por documento, para o rascunho (só as aceitas; RIA-12). */
export async function licoesAceitasDoProcesso(executor: Executor, processoId: string): Promise<Partial<Record<DocumentoLicao, LicaoAceita[]>>> {
  const decisoes = await listarDecisoes(executor, processoId, null);
  const porDocumento: Partial<Record<DocumentoLicao, LicaoAceita[]>> = {};
  for (const d of decisoes) {
    if (d.decisao !== 'aceita') continue;
    const lista = porDocumento[d.documento] ?? [];
    lista.push({
      titulo: d.sugestao.titulo,
      clausula: d.sugestao.clausula,
      fundamento: d.sugestao.fundamento,
      contratos: d.sugestao.fontes.map((f) => f.numero),
      decididaPor: d.decidida_por_nome ?? 'agente responsável',
      decididaEm: hojeISO(new Date(d.decidida_em)),
    });
    porDocumento[d.documento] = lista;
  }
  return porDocumento;
}
