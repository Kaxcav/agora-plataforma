/**
 * Rótulos pt-BR e tons visuais dos valores enumerados do contrato da API.
 */
import type {
  Aditivo,
  FaixaIdc,
  Prioridade,
  Sancao,
  SituacaoInstrumento,
  SituacaoPagamento,
  Tarefa,
  TipoPendencia,
  TipoSancao,
} from '@agora/contratos';
import type { OpcaoSelecao } from '../../componentes/Campo';
import type { TomEtiqueta } from '../../componentes/Etiqueta';

export interface RotuloTom {
  rotulo: string;
  tom: TomEtiqueta;
}

export function opcoesDe<T extends string>(mapa: Record<T, RotuloTom | string>): OpcaoSelecao[] {
  return (Object.keys(mapa) as T[]).map((valor) => {
    const item = mapa[valor];
    return { valor, rotulo: typeof item === 'string' ? item : item.rotulo };
  });
}

export function chavesDe<T extends string>(mapa: Record<T, unknown>): readonly T[] {
  return Object.keys(mapa) as T[];
}

export const SITUACOES_INSTRUMENTO: Record<SituacaoInstrumento, RotuloTom> = {
  vigente: { rotulo: 'Vigente', tom: 'sucesso' },
  a_vencer: { rotulo: 'A vencer', tom: 'aviso' },
  encerrado: { rotulo: 'Encerrado', tom: 'neutro' },
};

export const PRIORIDADES: Record<Prioridade, RotuloTom> = {
  alta: { rotulo: 'Alta', tom: 'erro' },
  media: { rotulo: 'Média', tom: 'aviso' },
  baixa: { rotulo: 'Baixa', tom: 'neutro' },
};

export const TIPOS_PENDENCIA: Record<TipoPendencia, string> = {
  saldo: 'Saldo',
  vigencia: 'Vigência',
  reajuste: 'Reajuste',
  pagamento: 'Pagamento',
  tarefa: 'Tarefa do plano',
  divulgacao_pncp: 'Divulgação no PNCP',
  garantia: 'Garantia',
  lembrete: 'Lembrete',
};

export const SITUACOES_PAGAMENTO: Record<SituacaoPagamento, RotuloTom> = {
  previsto: { rotulo: 'Previsto', tom: 'neutro' },
  atestado: { rotulo: 'Atestado', tom: 'info' },
  liquidado: { rotulo: 'Liquidado', tom: 'alerta' },
  pago: { rotulo: 'Pago', tom: 'sucesso' },
  atrasado: { rotulo: 'Atrasado', tom: 'erro' },
};

export const SITUACOES_TAREFA: Record<Tarefa['situacao'], RotuloTom> = {
  pendente: { rotulo: 'Pendente', tom: 'neutro' },
  concluida: { rotulo: 'Concluída', tom: 'sucesso' },
  atrasada: { rotulo: 'Atrasada', tom: 'erro' },
};

export const TIPOS_SANCAO: Record<TipoSancao, string> = {
  advertencia: 'Advertência',
  multa: 'Multa',
  impedimento_licitar: 'Impedimento de licitar e contratar',
  declaracao_inidoneidade: 'Declaração de inidoneidade',
};

export const SITUACOES_SANCAO: Record<Sancao['situacao'], RotuloTom> = {
  em_instrucao: { rotulo: 'Em instrução', tom: 'info' },
  defesa: { rotulo: 'Prazo de defesa', tom: 'aviso' },
  decisao: { rotulo: 'Aguardando decisão', tom: 'alerta' },
  aplicada: { rotulo: 'Aplicada', tom: 'erro' },
  arquivada: { rotulo: 'Arquivada', tom: 'neutro' },
};

export const FAIXAS_IDC: Record<FaixaIdc, RotuloTom> = {
  excelente: { rotulo: 'Excelente', tom: 'sucesso' },
  bom: { rotulo: 'Bom', tom: 'sucesso' },
  regular: { rotulo: 'Regular', tom: 'alerta' },
  insuficiente: { rotulo: 'Insuficiente', tom: 'aviso' },
  critico: { rotulo: 'Crítico', tom: 'erro' },
};

export const TIPOS_ADITIVO: Record<Aditivo['tipo'], string> = {
  acrescimo: 'Acréscimo',
  supressao: 'Supressão',
  prorrogacao: 'Prorrogação',
  reajuste: 'Reajuste',
};

export const ORIGENS_CONTRATO = {
  licitacao: 'Licitação',
  contratacao_direta: 'Contratação direta',
} as const;

export const PORTES = { ME: 'Microempresa', EPP: 'Empresa de pequeno porte', DEMAIS: 'Demais' } as const;
