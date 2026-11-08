import type { ArquivoProcesso, CategoriaArquivoProcesso, LeituraAtestado, TipoArquivoProcesso } from '@agora/contratos';
import type { TomEtiqueta } from '../../componentes';
import { formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';

export const TIPOS_ARQUIVO: Record<TipoArquivoProcesso, string> = {
  atestado_capacidade_tecnica: 'Atestado de capacidade técnica',
  balanco_patrimonial: 'Balanço patrimonial',
  certidao: 'Certidão',
  proposta: 'Proposta',
  documento_processo: 'Documento do processo',
  outro: 'Outro documento',
};

export const TIPOS_POR_CATEGORIA: Record<CategoriaArquivoProcesso, TipoArquivoProcesso[]> = {
  habilitacao: ['atestado_capacidade_tecnica', 'balanco_patrimonial', 'certidao', 'proposta', 'outro'],
  processo: ['documento_processo', 'outro'],
};

export const SITUACOES_LEITURA: Record<LeituraAtestado['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  concluida: { rotulo: 'Lido', tom: 'sucesso' },
  sem_texto: { rotulo: 'Sem texto reconhecido', tom: 'aviso' },
  ocr_indisponivel: { rotulo: 'OCR indisponível', tom: 'aviso' },
  falhou: { rotulo: 'Leitura falhou', tom: 'erro' },
};

export const SINAIS: Record<'indica_atendimento' | 'indica_insuficiencia' | 'inconclusivo', { rotulo: string; tom: TomEtiqueta }> = {
  indica_atendimento: { rotulo: 'Indica atendimento', tom: 'sucesso' },
  indica_insuficiencia: { rotulo: 'Indica quantitativo insuficiente', tom: 'aviso' },
  inconclusivo: { rotulo: 'Sem leitura suficiente', tom: 'neutro' },
};

export const CONFIANCAS: Record<'alta' | 'media' | 'baixa', string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa — confira' };

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatarNumero(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${formatarNumero(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
}

export function rotuloFormato(arquivo: Pick<ArquivoProcesso, 'formato'>): string {
  return arquivo.formato === 'jpeg' ? 'JPEG' : arquivo.formato.toUpperCase();
}

/** 50 → "50%"; 3,333 → "3,33%". */
export function percentualCurto(valor: number): string {
  return formatarPercentual(valor, Number.isInteger(valor) ? 0 : 2);
}
