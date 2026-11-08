/**
 * Editais publicados (transparência ativa; Lei 14.133/2021, art. 25, § 3º, e art. 54): o inteiro teor do edital e
 * dos anexos fica disponível sem cadastro nem login. Os documentos saem da última versão aprovada e com os dados
 * pessoais tarjados (RIA-05; LGPD, art. 6º, III). O PDF é gerado no servidor.
 */
import { mascararCpf, mascararEmail, mascararTelefone } from '@agora/dominio';
import type { DocumentoEditalPublico, EditalPublico, OrgaoRequisitante } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { linkPncpCompra } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { ORGAOS_POR_EXTENSO } from '../jornada/documentos.ts';

export const DOCUMENTOS_PUBLICOS = ['edital', 'tr', 'minuta_contrato'] as const;
export type TipoDocumentoPublico = (typeof DOCUMENTOS_PUBLICOS)[number];

const ROTULOS: Record<TipoDocumentoPublico, string> = { edital: 'Edital', tr: 'Termo de referência', minuta_contrato: 'Minuta do contrato' };

interface LinhaEdital {
  id: string;
  numero_sei: string;
  titulo: string;
  orgao: OrgaoRequisitante;
  modalidade_prevista: string | null;
  publicacao: { publicadoEm: string | null; dataMinimaPropostas: string | null; idPncp: string | null };
}

interface LinhaDocumento {
  processo_id: string;
  tipo: TipoDocumentoPublico;
  titulo: string;
  versao: number;
  conteudo: string;
}

/** Tarja CPF, e-mail e telefone escritos no texto (formatos usuais). Mantém o restante intacto. */
export function tarjarDadosPessoais(texto: string): string {
  return texto
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (cpf) => mascararCpf(cpf))
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (email) => mascararEmail(email))
    .replace(/\(\d{2}\)\s?\d{4,5}-\d{4}\b/g, (telefone) => mascararTelefone(telefone));
}

const CONDICOES = `
    FROM processos p
   WHERE p.publicacao->>'pncp' = 'publicado'
     AND ($1::text IS NULL OR p.busca_normalizada LIKE $1 ESCAPE '\\')
     AND ($2::uuid IS NULL OR p.id = $2)`;

async function documentosAprovados(executor: Executor, processoIds: string[]): Promise<LinhaDocumento[]> {
  if (processoIds.length === 0) return [];
  return executor.consultar<LinhaDocumento>(
    `SELECT DISTINCT ON (processo_id, tipo) processo_id, tipo, titulo, versao, conteudo
       FROM documentos_gerados
      WHERE processo_id = ANY($1::uuid[]) AND situacao = 'aprovado' AND tipo = ANY($2::text[])
      ORDER BY processo_id, tipo, versao DESC`,
    [processoIds, [...DOCUMENTOS_PUBLICOS]],
  );
}

function mapear(l: LinhaEdital, documentos: LinhaDocumento[], pncpReal: boolean): EditalPublico {
  const docs: DocumentoEditalPublico[] = DOCUMENTOS_PUBLICOS.flatMap((tipo) => {
    const d = documentos.find((x) => x.processo_id === l.id && x.tipo === tipo);
    return d ? [{ tipo, titulo: ROTULOS[tipo], versao: d.versao, url: `/api/v1/publico/editais/${l.id}/documentos/${tipo}` }] : [];
  });
  return {
    id: l.id,
    numeroSei: l.numero_sei,
    objeto: l.titulo,
    orgaoRequisitante: ORGAOS_POR_EXTENSO[l.orgao],
    modalidade: l.modalidade_prevista,
    publicadoEm: l.publicacao.publicadoEm ?? '',
    dataMinimaPropostas: l.publicacao.dataMinimaPropostas,
    idPncp: l.publicacao.idPncp,
    linkPncp: pncpReal ? linkPncpCompra(l.publicacao.idPncp) : null,
    documentos: docs,
    // Preenchidos após a homologação por `comDocumentosPreparatorios` (preparatorios.ts; art. 54, § 3º).
    homologadoEm: null,
    documentosPreparatorios: [],
  };
}

/** Editais publicados; `pncpReal` indica se a publicação foi feita no PNCP de verdade (integração online). */
export async function consultarEditais(
  executor: Executor,
  filtro: { busca: string | null; id: string | null; limite: number; inicio: number; pncpReal: boolean },
): Promise<{ itens: EditalPublico[]; total: number }> {
  const parametros = [filtro.busca ? padraoContem(filtro.busca) : null, filtro.id] as const;
  const linhas = await executor.consultar<LinhaEdital>(
    `SELECT p.id, p.numero_sei, p.titulo, p.orgao, p.modalidade_prevista, p.publicacao
     ${CONDICOES}
      ORDER BY p.publicacao->>'publicadoEm' DESC, p.numero_sei
      LIMIT $3 OFFSET $4`,
    [...parametros, filtro.limite, filtro.inicio],
  );
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total ${CONDICOES}`, [...parametros]);
  const documentos = await documentosAprovados(
    executor,
    linhas.map((l) => l.id),
  );
  return { itens: linhas.map((l) => mapear(l, documentos, filtro.pncpReal)), total: contagem?.total ?? 0 };
}

/** PDF do documento público (última versão aprovada, dados pessoais tarjados); null se o edital ou o documento não existir. */
export async function pdfDocumentoPublico(executor: Executor, processoId: string, tipo: TipoDocumentoPublico): Promise<{ pdf: Buffer; nomeArquivo: string } | null> {
  const [edital] = await executor.consultar<{ numero_sei: string }>(
    `SELECT numero_sei FROM processos WHERE id = $1 AND publicacao->>'pncp' = 'publicado'`,
    [processoId],
  );
  if (!edital) return null;
  const [documento] = (await documentosAprovados(executor, [processoId])).filter((d) => d.tipo === tipo);
  if (!documento) return null;
  const titulo = `${ROTULOS[tipo]} — processo ${edital.numero_sei}`;
  const pdf = gerarPdfTexto({ titulo, rodape: `${titulo} (versão ${documento.versao})`, conteudo: tarjarDadosPessoais(documento.conteudo) });
  const nomeArquivo = `${tipo.replace('_', '-')}-${edital.numero_sei.replace(/[^0-9]/g, '')}.pdf`;
  return { pdf, nomeArquivo };
}
