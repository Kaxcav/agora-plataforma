/**
 * IA ancorada (F24): conferência das citações dos documentos gerados (RIA-14), revisão humana que libera a aprovação,
 * painel de qualidade normativa (IMR-02) e conferência cruzada entre os documentos do processo (RIA-15).
 * Os resultados são recalculados do texto guardado e da base normativa: nada aqui decide, tudo requer revisão humana.
 */
import {
  conferirDocumentosCruzados,
  conferirEstruturaModelo,
  ehTipoModeloPadronizado,
  type ConferenciaCitacoes,
} from '@agora/dominio';
import type {
  CitacoesDocumento,
  ConferenciaCitacoesApi,
  ConferenciaCruzadaApi,
  DocumentoGerado,
  IndicadorImr02,
  PainelQualidadeNormativa,
} from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { conferirCitacoes, indiceNormativo } from '../../ia/base-normativa.ts';
import { regraNegocio } from '../../http/erros.ts';
import { referenciaProcesso } from '../controle/medidas.ts';
import { TITULOS_DOCUMENTO } from '../jornada/constantes.ts';

type TipoDocumento = DocumentoGerado['tipo'];

/** Meta do IMR-02: 100% das minutas com citações fiéis à lei. */
export const META_IMR02 = 100;
/** Documentos que entram no IMR-02 e na conferência cruzada: o checklist do parecer nunca é redigido por IA. */
export const TIPOS_MINUTA: readonly TipoDocumento[] = ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato'];
const MESES_SERIE = 6;
const LIMITE_APONTAMENTOS = 200;

export interface LinhaDocumentoCitacoes {
  id: string;
  processo_id: string;
  tipo: TipoDocumento;
  titulo: string;
  versao: number;
  conteudo: string;
  situacao: DocumentoGerado['situacao'];
  gerado_por: DocumentoGerado['geradoPor'];
  gerado_em: string;
  revisao_justificativa: string | null;
  revisao_em: string | null;
  revisao_por_id: string | null;
  revisao_por_nome: string | null;
}

const COLUNAS_DOCUMENTO = `d.id, d.processo_id, d.tipo, d.titulo, d.versao, d.conteudo, d.situacao, d.gerado_por, d.gerado_em,
         r.justificativa AS revisao_justificativa, r.revisado_em AS revisao_em, r.revisado_por AS revisao_por_id, u.nome AS revisao_por_nome`;
const JUNCOES_REVISAO = `LEFT JOIN revisoes_citacoes r ON r.documento_id = d.id
    LEFT JOIN usuarios u ON u.id = r.revisado_por`;

function instante(valor: string | Date): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

export function paraConferenciaApi(c: ConferenciaCitacoes, agora: Date): ConferenciaCitacoesApi {
  return { ...c, citacoes: c.citacoes.map((x) => ({ ...x, referencias: [...x.referencias] })), conferidoEm: agora.toISOString() };
}

/** Resumo para a trilha de auditoria da geração do documento. */
export function resumoCitacoes(conteudo: string): { total: number; inexistentes: number; semEfeito: number; suspeitas: number; fiel: boolean } {
  const c = conferirCitacoes(conteudo);
  return { total: c.total, inexistentes: c.inexistentes, semEfeito: c.semEfeito, suspeitas: c.suspeitas, fiel: c.fiel };
}

export async function documentosDoProcesso(executor: Executor, processoId: string): Promise<LinhaDocumentoCitacoes[]> {
  return executor.consultar<LinhaDocumentoCitacoes>(
    `SELECT ${COLUNAS_DOCUMENTO}
       FROM documentos_gerados d
       ${JUNCOES_REVISAO}
      WHERE d.processo_id = $1
      ORDER BY d.gerado_em DESC, d.versao DESC`,
    [processoId],
  );
}

export function citacoesDoDocumento(l: LinhaDocumentoCitacoes, agora: Date): CitacoesDocumento {
  const conferencia = conferirCitacoes(l.conteudo);
  const revisao =
    l.revisao_em !== null && l.revisao_por_id !== null
      ? { revisadoPor: { id: l.revisao_por_id, nome: l.revisao_por_nome ?? '' }, revisadoEm: instante(l.revisao_em), justificativa: l.revisao_justificativa ?? '' }
      : null;
  return {
    documentoId: l.id,
    tipo: l.tipo,
    titulo: l.titulo,
    versao: l.versao,
    situacao: l.situacao,
    geradoPor: l.gerado_por,
    geradoEm: instante(l.gerado_em),
    conferencia: paraConferenciaApi(conferencia, agora),
    estrutura: conferirEstruturaModelo(l.tipo, l.conteudo),
    revisao,
    aprovacaoBloqueada: l.situacao !== 'aprovado' && conferencia.bloqueantes > 0 && revisao === null,
  };
}

/**
 * Trava da aprovação (RIA-14): rascunho com citação inexistente ou sem efeito só é aprovado depois da revisão humana
 * das citações registrada na Ágora. Chamada na aprovação do documento, dentro da transação.
 */
export async function exigirCitacoesRevisadas(tx: Transacao, doc: { id: string; titulo: string; versao: number; conteudo: string }): Promise<void> {
  const conferencia = conferirCitacoes(doc.conteudo);
  if (conferencia.bloqueantes === 0) return;
  const [revisao] = await tx.consultar<{ id: string }>('SELECT id FROM revisoes_citacoes WHERE documento_id = $1', [doc.id]);
  if (revisao) return;
  const apontadas = conferencia.citacoes.filter((c) => c.situacao === 'inexistente' || c.situacao === 'sem_efeito');
  throw regraNegocio(
    `"${doc.titulo}" (versão ${doc.versao}) tem ${apontadas.length === 1 ? '1 citação legal inexistente ou sem efeito' : `${apontadas.length} citações legais inexistentes ou sem efeito`}: registre a revisão humana das citações antes de aprovar (RIA-14).`,
    apontadas.map((c) => ({ campo: 'RIA-14', mensagem: `${c.trecho}: ${c.motivo}` })),
  );
}

// ───────────────────────── conferência cruzada (RIA-15) ─────────────────────────

/** Conferência cruzada da versão mais recente de cada documento do processo. */
export function conferenciaCruzada(processoId: string, documentos: readonly LinhaDocumentoCitacoes[], agora: Date): ConferenciaCruzadaApi {
  const recentes = new Map<TipoDocumento, LinhaDocumentoCitacoes>();
  for (const d of documentos) {
    if (!TIPOS_MINUTA.includes(d.tipo)) continue;
    const atual = recentes.get(d.tipo);
    if (!atual || d.versao > atual.versao) recentes.set(d.tipo, d);
  }
  const ordenados = TIPOS_MINUTA.flatMap((t) => {
    const d = recentes.get(t);
    return d ? [{ tipo: d.tipo, titulo: TITULOS_DOCUMENTO[d.tipo], versao: d.versao, conteudo: d.conteudo }] : [];
  });
  const r = conferirDocumentosCruzados(ordenados);
  return {
    processoId,
    geradoEm: agora.toISOString(),
    documentos: r.documentos.map((d) => ({ ...d, tipo: d.tipo as TipoDocumento })),
    aspectos: r.aspectos,
    divergencias: r.divergencias.map((d) => ({ ...d, ocorrencias: d.ocorrencias.map((o) => ({ ...o, tipo: o.tipo as TipoDocumento })) })),
    consistente: r.consistente,
    premissas: r.premissas,
    fontes: ['Lei 14.133/2021, art. 6º, XXIII; art. 18; art. 25; art. 92', 'Documentos gerados no processo e guardados na Ágora (versão mais recente de cada tipo)'],
    aviso: r.aviso,
  };
}

// ───────────────────────── painel de qualidade normativa (IMR-02) ─────────────────────────

interface LinhaQualidade extends LinhaDocumentoCitacoes {
  numero_sei: string;
}

/** Diferença fixa de Brasília para o UTC (sem horário de verão desde 2019). */
const DESLOCAMENTO_BRASILIA_MS = 3 * 3_600_000;

/** Mês (AAAA-MM) do instante, no horário de Brasília. */
function mesDe(valor: string | Date): string {
  return new Date(new Date(valor).getTime() - DESLOCAMENTO_BRASILIA_MS).toISOString().slice(0, 7);
}

/** Início do mês (AAAA-MM) no horário de Brasília, como instante UTC. */
function inicioDoMes(mes: string): string {
  return new Date(Date.parse(`${mes}-01T00:00:00.000Z`) + DESLOCAMENTO_BRASILIA_MS).toISOString();
}

function indicador(total: number, fieis: number): IndicadorImr02 {
  if (total === 0) return { total, fieis, percentual: null, situacao: 'sem_minutas' };
  const percentual = Math.floor((fieis / total) * 1000) / 10;
  return { total, fieis, percentual, situacao: fieis === total ? 'atingida' : 'abaixo' };
}

function mesAnterior(mes: string, quantos: number): string {
  const [ano, m] = mes.split('-').map(Number);
  const total = (ano ?? 0) * 12 + ((m ?? 1) - 1) - quantos;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Painel do IMR-02: percentual de minutas geradas no mês com todas as citações fiéis à lei (meta de 100%). */
export async function montarPainelQualidade(
  executor: Executor,
  filtro: { escopo: string[] | null; uasg: string | null; mes: string },
  agora: Date,
): Promise<PainelQualidadeNormativa> {
  const linhas = await executor.consultar<LinhaQualidade>(
    `SELECT p.numero_sei, ${COLUNAS_DOCUMENTO}
       FROM documentos_gerados d
       JOIN processos p ON p.id = d.processo_id
       ${JUNCOES_REVISAO}
      WHERE d.tipo = ANY($1::text[])
        AND d.gerado_em >= $2::timestamptz AND d.gerado_em < $3::timestamptz
        AND ($4::text[] IS NULL OR p.uasg = ANY($4::text[]))
        AND ($5::text IS NULL OR p.uasg = $5)
      ORDER BY d.gerado_em DESC, d.versao DESC`,
    [TIPOS_MINUTA, inicioDoMes(mesAnterior(filtro.mes, MESES_SERIE - 1)), inicioDoMes(mesAnterior(filtro.mes, -1)), filtro.escopo, filtro.uasg],
  );
  const avaliadas = linhas.map((l) => ({ l, mes: mesDe(l.gerado_em), c: conferirCitacoes(l.conteudo) }));
  const doMes = avaliadas.filter((a) => a.mes === filtro.mes);
  const contar = (lista: typeof avaliadas) => indicador(lista.length, lista.filter((a) => a.c.fiel).length);
  const serie = Array.from({ length: MESES_SERIE }, (_, i) => mesAnterior(filtro.mes, MESES_SERIE - 1 - i)).map((mes) => ({
    mes,
    ...contar(avaliadas.filter((a) => a.mes === mes)),
  }));
  const comEstrutura = doMes.filter((a) => ehTipoModeloPadronizado(a.l.tipo));
  const apontamentos = doMes
    .flatMap(({ l, c }) =>
      c.citacoes
        .filter((x) => x.situacao === 'inexistente' || x.situacao === 'sem_efeito' || x.situacao === 'suspeita')
        .map((x) => ({
          processo: referenciaProcesso(l.processo_id, l.numero_sei),
          documentoId: l.id,
          tipoDocumento: l.tipo,
          titulo: l.titulo,
          versao: l.versao,
          geradoPor: l.gerado_por,
          geradoEm: instante(l.gerado_em),
          trecho: x.trecho,
          referencias: [...x.referencias],
          situacao: x.situacao,
          motivo: x.motivo,
          sugestao: x.sugestao,
          contexto: x.contexto,
          revisado: l.revisao_em !== null,
        })),
    )
    .slice(0, LIMITE_APONTAMENTOS);
  const { base } = indiceNormativo();
  return {
    mes: filtro.mes,
    uasg: filtro.uasg,
    geradoEm: agora.toISOString(),
    meta: META_IMR02,
    imr02: contar(doMes),
    serie,
    porTipo: TIPOS_MINUTA.map((tipo) => {
      const lista = doMes.filter((a) => a.l.tipo === tipo);
      return { tipo, rotulo: TITULOS_DOCUMENTO[tipo], total: lista.length, fieis: lista.filter((a) => a.c.fiel).length };
    }).filter((t) => t.total > 0),
    porOrigem: (['modelo', 'ia'] as const).map((origem) => {
      const lista = doMes.filter((a) => a.l.gerado_por === origem);
      return { origem, total: lista.length, fieis: lista.filter((a) => a.c.fiel).length };
    }),
    estrutura: { conferidos: comEstrutura.length, completos: comEstrutura.filter((a) => conferirEstruturaModelo(a.l.tipo, a.l.conteudo).ausentes.length === 0).length },
    apontamentos,
    base: { norma: base.norma.titulo, proveniencia: base.proveniencia },
    premissas: [
      `Contam todas as versões de minutas geradas no mês (${TIPOS_MINUTA.map((t) => TITULOS_DOCUMENTO[t]).join(', ')}); o checklist do parecer, que nunca é redigido por IA, não entra.`,
      'Minuta fiel: nenhuma citação inexistente, sem efeito ou suspeita na conferência automática com a base normativa. Citações de outras normas não entram no cálculo.',
      'Mês pela data de geração, no horário de Brasília. Percentual truncado em uma casa decimal.',
    ],
    fontes: ['IMR-02 (precisão normativa da IA) do termo de referência da contratação da plataforma', `${base.norma.titulo}, texto compilado de ${base.proveniencia.fonte}`, 'Lei 14.133/2021, art. 19, IV (modelos padronizados)'],
    aviso: 'Indicador calculado automaticamente para acompanhamento do contrato: requer revisão humana. A correção do índice e eventual glosa são decisões do gestor e do fiscal do contrato.',
  };
}
