/**
 * Consultas dos documentos do processo (RF-21), das leituras de atestados (RIA-08) e das exigências de
 * qualificação técnica (RN-25). O escopo de UASG é conferido antes, pelo processo (obterLinhaProcesso).
 */
import {
  AVISO_LEITURA_ASSISTIDA,
  extrairQuantitativosAtestado,
  type ExtracaoAtestado,
  type PaginaTexto,
  type ParcelaLeitura,
} from '@agora/dominio';
import type {
  ArquivoProcesso,
  CategoriaArquivoProcesso,
  FormatoArquivo,
  LeituraAtestado,
  MencaoQuantitativoAtestado,
  TipoArquivoProcesso,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';
import type { ParcelaArmazenada } from './tipos.ts';

export interface LinhaArquivo {
  id: string;
  processo_id: string;
  categoria: CategoriaArquivoProcesso;
  tipo: TipoArquivoProcesso;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  titulo: string;
  nome_original: string;
  formato: FormatoArquivo;
  tamanho_bytes: number;
  sha256: string;
  contem_dado_pessoal: boolean;
  antivirus: 'nao_verificado' | 'limpo';
  exercicio: number | null;
  data_constituicao: string | null;
  enviado_por: string;
  enviado_por_nome: string;
  enviado_em: string;
  leitura_id: string | null;
  leitura_metodo: LeituraAtestado['metodo'] | null;
  leitura_situacao: LeituraAtestado['situacao'] | null;
  leitura_mensagem: string | null;
  leitura_paginas: PaginaTexto[] | null;
  leitura_hash: string | null;
  leitura_motor: string | null;
  leitura_confianca: number | null;
  lida_em: string | null;
  lida_por: string | null;
  lida_por_nome: string | null;
}

const SELECAO_ARQUIVO = `
  SELECT a.id, a.processo_id, a.categoria, a.tipo, a.fornecedor_id, f.razao_social AS fornecedor_nome, a.titulo, a.nome_original,
         a.formato, a.tamanho_bytes, a.sha256, a.contem_dado_pessoal, a.antivirus, a.exercicio, a.data_constituicao,
         a.enviado_por, u.nome AS enviado_por_nome, a.enviado_em,
         l.id AS leitura_id, l.metodo AS leitura_metodo, l.situacao AS leitura_situacao, l.mensagem AS leitura_mensagem,
         l.paginas AS leitura_paginas, l.hash_texto AS leitura_hash, l.motor AS leitura_motor, l.confianca_media AS leitura_confianca,
         l.lida_em, l.lida_por, lu.nome AS lida_por_nome
    FROM processos_arquivos a
    JOIN usuarios u ON u.id = a.enviado_por
    LEFT JOIN fornecedores f ON f.id = a.fornecedor_id
    LEFT JOIN LATERAL (
      SELECT x.* FROM processos_arquivos_leituras x WHERE x.arquivo_id = a.id ORDER BY x.lida_em DESC, x.id DESC LIMIT 1
    ) l ON true
    LEFT JOIN usuarios lu ON lu.id = l.lida_por`;

export async function listarArquivos(executor: Executor, processoId: string): Promise<LinhaArquivo[]> {
  return executor.consultar<LinhaArquivo>(`${SELECAO_ARQUIVO}\n   WHERE a.processo_id = $1\n   ORDER BY a.enviado_em DESC, a.id`, [processoId]);
}

export async function obterArquivo(executor: Executor, processoId: string, arquivoId: string): Promise<LinhaArquivo | null> {
  const [linha] = await executor.consultar<LinhaArquivo>(`${SELECAO_ARQUIVO}\n   WHERE a.processo_id = $1 AND a.id = $2`, [processoId, arquivoId]);
  return linha ?? null;
}

export type { ParcelaArmazenada };

export interface LinhaQualificacao {
  parcelas: ParcelaArmazenada[];
  definida_em: string;
  definida_por: string | null;
  definida_por_nome: string | null;
}

export async function obterQualificacao(executor: Executor, processoId: string): Promise<LinhaQualificacao | null> {
  const [linha] = await executor.consultar<LinhaQualificacao>(
    `SELECT q.parcelas, q.definida_em, q.definida_por, u.nome AS definida_por_nome
       FROM processos_qualificacao_tecnica q LEFT JOIN usuarios u ON u.id = q.definida_por
      WHERE q.processo_id = $1`,
    [processoId],
  );
  return linha ?? null;
}

export function parcelasParaLeitura(parcelas: readonly ParcelaArmazenada[]): ParcelaLeitura[] {
  return parcelas.map((p) => ({ id: p.id, descricao: p.descricao, unidade: p.unidade, termos: p.termos }));
}

/** Extração da última leitura concluída, recalculada com as parcelas atuais (`null` sem leitura concluída). */
export function extracaoDoArquivo(linha: LinhaArquivo, parcelas: readonly ParcelaLeitura[]): ExtracaoAtestado | null {
  if (linha.leitura_situacao !== 'concluida' || linha.leitura_paginas === null) return null;
  return extrairQuantitativosAtestado(linha.leitura_paginas, parcelas);
}

/** Menção para a resposta HTTP: o trecho sai com CPF, e-mail e telefone tarjados (LGPD). */
export function mencaoPublica(m: ExtracaoAtestado['mencoes'][number]): MencaoQuantitativoAtestado {
  return { ...m, trecho: tarjarDadosPessoais(m.trecho) };
}

export function mapearArquivo(linha: LinhaArquivo, parcelas: readonly ParcelaLeitura[]): ArquivoProcesso {
  let leitura: LeituraAtestado | null = null;
  if (linha.leitura_id !== null && linha.leitura_metodo !== null && linha.leitura_situacao !== null && linha.lida_em !== null && linha.lida_por !== null) {
    const extracao = extracaoDoArquivo(linha, parcelas);
    leitura = {
      id: linha.leitura_id,
      metodo: linha.leitura_metodo,
      situacao: linha.leitura_situacao,
      mensagem: linha.leitura_mensagem,
      paginas: linha.leitura_paginas?.length ?? 0,
      linhas: (linha.leitura_paginas ?? []).reduce((s, p) => s + p.linhas.length, 0),
      confiancaOcr: linha.leitura_confianca,
      motor: linha.leitura_motor,
      hashTexto: linha.leitura_hash,
      mencoes: (extracao?.mencoes ?? []).map(mencaoPublica),
      lidaEm: linha.lida_em,
      lidaPor: { id: linha.lida_por, nome: linha.lida_por_nome ?? '' },
      aviso: AVISO_LEITURA_ASSISTIDA,
    };
  }
  return {
    id: linha.id,
    processoId: linha.processo_id,
    categoria: linha.categoria,
    tipo: linha.tipo,
    titulo: linha.titulo,
    nomeOriginal: linha.nome_original,
    formato: linha.formato,
    tamanhoBytes: linha.tamanho_bytes,
    sha256: linha.sha256,
    contemDadoPessoal: linha.contem_dado_pessoal,
    antivirus: linha.antivirus,
    fornecedor: linha.fornecedor_id === null ? null : { id: linha.fornecedor_id, nome: linha.fornecedor_nome ?? '' },
    exercicio: linha.exercicio,
    dataConstituicao: linha.data_constituicao,
    enviadoPor: { id: linha.enviado_por, nome: linha.enviado_por_nome },
    enviadoEm: linha.enviado_em,
    leitura,
  };
}
