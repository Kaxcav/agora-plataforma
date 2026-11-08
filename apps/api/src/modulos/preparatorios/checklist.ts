/**
 * Checklist das peças do processo por etapa (RF-32): o que já existe, em que situação, e o que falta. A regra das
 * peças (obrigatoriedade e fundamento) vem de `montarChecklistPecas` (@agora/dominio); aqui se apura, para a versão
 * atual de cada documento, se está aprovada, assinada na árvore do SEI e válida (parâmetros do edital e dotação atuais).
 */
import { montarChecklistPecas, type ChecklistPecas, type DocumentoChecklist } from '@agora/dominio';
import type { ChecklistDocumentosProcesso, DocumentoGerado, EtapaJornada } from '@agora/contratos';
import { TITULOS_ETAPA } from '../jornada/constantes.ts';
import { editalCompleto } from '../jornada/selecao.ts';
import type { CargaProcesso } from '../jornada/tipos.ts';
import { documentoTrazDotacao, dotacaoDaCarga, hashDotacao } from './dotacao.ts';

/** Documentos cuja validade depende da dotação atual (RN-39). */
const DEPENDEM_DA_DOTACAO: ReadonlySet<string> = new Set(['tr', 'minuta_contrato', 'declaracao_orcamentaria']);

/** Versão atual de cada documento, com a assinatura no SEI e a indicação de desatualizada. */
export function documentosParaChecklist(carga: CargaProcesso): DocumentoChecklist[] {
  const hash = hashDotacao(dotacaoDaCarga(carga).linhas);
  return carga.documentos.map((d) => {
    const entrada = carga.arvore.find((a) => a.documentoId === d.id);
    const semDotacao = DEPENDEM_DA_DOTACAO.has(d.tipo) && (d.tipo === 'declaracao_orcamentaria' || hash !== null) && !documentoTrazDotacao(d.conteudo, hash);
    return {
      tipo: d.tipo,
      versao: d.versao,
      situacao: d.situacao,
      assinado: entrada?.assinadoEm != null,
      desatualizado: d.geradoComParametrosAnteriores || semDotacao,
    };
  });
}

export function checklistDaCarga(carga: CargaProcesso): ChecklistPecas {
  return montarChecklistPecas({
    etapaAtual: carga.linha.etapa_atual,
    documentos: documentosParaChecklist(carga),
    provaConceitoExigida: editalCompleto(carga.linha.edital).provaConceito.exigencia !== 'nenhuma',
  });
}

/** GET /processos/:id/checklist-documentos. */
export function montarChecklistDocumentos(carga: CargaProcesso): ChecklistDocumentosProcesso {
  const checklist = checklistDaCarga(carga);
  return {
    etapaAtual: carga.linha.etapa_atual,
    etapas: checklist.etapas.map((e) => ({
      etapa: e.etapa as EtapaJornada,
      titulo: TITULOS_ETAPA[e.etapa as EtapaJornada],
      itens: e.itens.map((i) => ({ ...i, tipo: i.tipo as DocumentoGerado['tipo'] })),
      prontas: e.prontas,
      faltantes: e.faltantes,
    })),
    prontas: checklist.prontas,
    faltantes: checklist.faltantes,
    recomendadasPendentes: checklist.recomendadasPendentes,
    fundamento: checklist.fundamento,
  };
}
