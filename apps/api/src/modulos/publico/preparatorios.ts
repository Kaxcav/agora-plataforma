/**
 * Divulgação pós-homologação dos documentos da fase preparatória (Lei 14.133/2021, art. 54, § 3º; RF-18): depois
 * da homologação, os documentos elaborados na fase preparatória que não integraram o edital e os anexos ficam
 * disponíveis na página pública do edital, sem login, em PDF gerado no servidor a partir da última versão aprovada e
 * com os dados pessoais tarjados. A nota técnica de preços de orçamento sigiloso (art. 24) não é divulgada.
 */
import type { DocumentoPreparatorioPublico, EditalPublico } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { TITULOS_DOCUMENTO } from '../jornada/constantes.ts';
import { tarjarDadosPessoais } from './editais.ts';

export const DOCUMENTOS_PREPARATORIOS = ['dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'parecer_checklist'] as const;
export type TipoDocumentoPreparatorio = (typeof DOCUMENTOS_PREPARATORIOS)[number];

interface LinhaHomologado {
  id: string;
  numero_sei: string;
  homologado_em: string;
  sigiloso: boolean;
}

interface LinhaDocumento {
  processo_id: string;
  tipo: TipoDocumentoPreparatorio;
  versao: number;
  conteudo: string;
}

/** Processos publicados, homologados e com os documentos preparatórios divulgados (`selecao.preparatoriosDivulgadosEm`). */
async function homologados(executor: Executor, processoIds: readonly string[]): Promise<LinhaHomologado[]> {
  if (processoIds.length === 0) return [];
  return executor.consultar<LinhaHomologado>(
    `SELECT p.id, p.numero_sei, p.selecao->'homologacao'->>'data' AS homologado_em,
            COALESCE((p.cesta->>'orcamentoSigiloso')::boolean, false) AS sigiloso
       FROM processos p
      WHERE p.id = ANY($1::uuid[])
        AND p.publicacao->>'pncp' = 'publicado'
        AND p.selecao->'homologacao'->>'data' IS NOT NULL
        AND p.selecao->>'preparatoriosDivulgadosEm' IS NOT NULL`,
    [[...processoIds]],
  );
}

async function documentosAprovados(executor: Executor, processoIds: readonly string[]): Promise<LinhaDocumento[]> {
  if (processoIds.length === 0) return [];
  return executor.consultar<LinhaDocumento>(
    `SELECT DISTINCT ON (processo_id, tipo) processo_id, tipo, versao, conteudo
       FROM documentos_gerados
      WHERE processo_id = ANY($1::uuid[]) AND situacao = 'aprovado' AND tipo = ANY($2::text[])
      ORDER BY processo_id, tipo, versao DESC`,
    [[...processoIds], [...DOCUMENTOS_PREPARATORIOS]],
  );
}

function divulgavel(tipo: TipoDocumentoPreparatorio, sigiloso: boolean): boolean {
  return !(sigiloso && tipo === 'nota_tecnica_precos');
}

/** Data da homologação e documentos preparatórios divulgados de cada processo (ausente = ainda não homologado). */
export async function preparatoriosDivulgados(
  executor: Executor,
  processoIds: readonly string[],
): Promise<Map<string, { homologadoEm: string; documentos: DocumentoPreparatorioPublico[] }>> {
  const processos = await homologados(executor, processoIds);
  const documentos = await documentosAprovados(
    executor,
    processos.map((p) => p.id),
  );
  const resultado = new Map<string, { homologadoEm: string; documentos: DocumentoPreparatorioPublico[] }>();
  for (const p of processos) {
    const docs = DOCUMENTOS_PREPARATORIOS.flatMap((tipo): DocumentoPreparatorioPublico[] => {
      const d = documentos.find((x) => x.processo_id === p.id && x.tipo === tipo);
      if (!d || !divulgavel(tipo, p.sigiloso)) return [];
      return [{ tipo, titulo: TITULOS_DOCUMENTO[tipo], versao: d.versao, url: `/api/v1/publico/editais/${p.id}/preparatorios/${tipo}` }];
    });
    resultado.set(p.id, { homologadoEm: p.homologado_em, documentos: docs });
  }
  return resultado;
}

/** Acrescenta aos editais publicados a data da homologação e os documentos preparatórios divulgados. */
export async function comDocumentosPreparatorios(executor: Executor, editais: readonly EditalPublico[]): Promise<EditalPublico[]> {
  const divulgados = await preparatoriosDivulgados(
    executor,
    editais.map((e) => e.id),
  );
  return editais.map((e) => {
    const d = divulgados.get(e.id);
    return d ? { ...e, homologadoEm: d.homologadoEm, documentosPreparatorios: d.documentos } : e;
  });
}

/** PDF do documento preparatório (dados pessoais tarjados); null antes da homologação ou se não houver versão aprovada. */
export async function pdfPreparatorio(
  executor: Executor,
  processoId: string,
  tipo: TipoDocumentoPreparatorio,
): Promise<{ pdf: Buffer; nomeArquivo: string } | null> {
  const [processo] = await homologados(executor, [processoId]);
  if (!processo || !divulgavel(tipo, processo.sigiloso)) return null;
  const [documento] = (await documentosAprovados(executor, [processoId])).filter((d) => d.tipo === tipo);
  if (!documento) return null;
  const titulo = `${TITULOS_DOCUMENTO[tipo]} — processo ${processo.numero_sei}`;
  const pdf = gerarPdfTexto({
    titulo,
    rodape: `${titulo} (versão ${documento.versao}; divulgado após a homologação — art. 54, § 3º)`,
    conteudo: tarjarDadosPessoais(documento.conteudo),
  });
  return { pdf, nomeArquivo: `${tipo.replaceAll('_', '-')}-${processo.numero_sei.replace(/[^0-9]/g, '')}.pdf` };
}
