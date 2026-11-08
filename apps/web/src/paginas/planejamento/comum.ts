/**
 * Rótulos pt-BR do planejamento (PCA, catálogo e intenções de registro de preços).
 */
import type {
  CategoriaPca,
  PrioridadeDemandaPca,
  PublicacaoPca,
  SituacaoIntencaoRegistroPrecos,
  SituacaoPlanoContratacoes,
  TipoItemCatalogo,
} from '@agora/contratos';
import type { RotuloTom } from '../compartilhado/rotulos';

export const SITUACOES_PCA: Record<SituacaoPlanoContratacoes, RotuloTom> = {
  em_elaboracao: { rotulo: 'Em elaboração', tom: 'neutro' },
  consolidado: { rotulo: 'Consolidado, aguardando aprovação', tom: 'aviso' },
  aprovado: { rotulo: 'Aprovado, publicação em andamento', tom: 'info' },
  publicado: { rotulo: 'Publicado no PNCP', tom: 'sucesso' },
};

export const SITUACOES_PUBLICACAO_PCA: Record<PublicacaoPca['situacao'], RotuloTom> = {
  na_fila: { rotulo: 'Na fila de publicação', tom: 'info' },
  publicado: { rotulo: 'Publicado', tom: 'sucesso' },
  erro: { rotulo: 'Na fila de erro', tom: 'erro' },
};

export const PRIORIDADES_PCA: Record<PrioridadeDemandaPca, RotuloTom> = {
  alta: { rotulo: 'Alta', tom: 'erro' },
  media: { rotulo: 'Média', tom: 'aviso' },
  baixa: { rotulo: 'Baixa', tom: 'neutro' },
};

export const CATEGORIAS_PCA: Record<CategoriaPca, string> = {
  material: 'Material',
  servico: 'Serviço',
  obras: 'Obras',
  servicos_engenharia: 'Serviços de engenharia',
  solucoes_tic: 'Soluções de TIC',
  locacao_imoveis: 'Locação de imóveis',
  alienacao_concessao_permissao: 'Alienação, concessão ou permissão',
  obras_servicos_engenharia: 'Obras e serviços de engenharia',
};

export const TIPOS_CATALOGO: Record<TipoItemCatalogo, string> = {
  material: 'Material (CATMAT)',
  servico: 'Serviço (CATSER)',
};

export const SITUACOES_IRP: Record<SituacaoIntencaoRegistroPrecos, RotuloTom> = {
  agendada: { rotulo: 'Agendada', tom: 'neutro' },
  aberta: { rotulo: 'Aberta para adesões', tom: 'info' },
  encerrada: { rotulo: 'Encerrada, aguardando consolidação', tom: 'aviso' },
  consolidada: { rotulo: 'Consolidada', tom: 'sucesso' },
};

/** Código do catálogo com o tipo: "CATMAT 357301". */
export function rotuloCodigo(codigo: string | null, tipo: TipoItemCatalogo | null): string {
  if (codigo === null) return 'Sem código';
  return `${tipo === 'servico' ? 'CATSER' : 'CATMAT'} ${codigo}`;
}
