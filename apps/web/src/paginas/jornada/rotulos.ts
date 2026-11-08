/**
 * Rótulos pt-BR da Jornada da contratação (órgãos, papéis, documentos, fontes de preço, riscos).
 */
import {
  ETAPAS_JORNADA,
  type CriterioJulgamentoEdital,
  type DocumentoGerado,
  type EtapaJornada,
  type OrgaoRequisitante,
  type ParametrosEdital,
  type ProcessoDetalhe,
  type Sinal,
} from '@agora/contratos';
import type { FonteCotacao, PapelProcesso } from '@agora/dominio';
import type { RotuloTom } from '../compartilhado/rotulos';

export const ORGAOS: Record<OrgaoRequisitante, { sigla: string; nome: string }> = {
  PF: { sigla: 'PF', nome: 'Polícia Federal' },
  PRF: { sigla: 'PRF', nome: 'Polícia Rodoviária Federal' },
  SENASP: { sigla: 'SENASP', nome: 'Secretaria Nacional de Segurança Pública' },
  SENAPPEN: { sigla: 'SENAPPEN', nome: 'Secretaria Nacional de Políticas Penais' },
  MJSP: { sigla: 'MJSP', nome: 'Ministério da Justiça e Segurança Pública (administração direta)' },
};

export const LISTA_ORGAOS = Object.keys(ORGAOS).filter((o): o is OrgaoRequisitante => Object.hasOwn(ORGAOS, o));

export const TOTAL_ETAPAS = ETAPAS_JORNADA.length;
export const NUMEROS_ETAPAS: readonly EtapaJornada[] = ETAPAS_JORNADA.map((e) => e.etapa);

export function tituloEtapa(etapa: number): string {
  return ETAPAS_JORNADA.find((e) => e.etapa === etapa)?.titulo ?? `Etapa ${etapa}`;
}

export function ehEtapa(valor: number): valor is EtapaJornada {
  return NUMEROS_ETAPAS.some((e) => e === valor);
}

export const PAPEIS: Record<PapelProcesso, string> = {
  requisitante: 'Requisitante',
  equipe_planejamento: 'Equipe de planejamento da contratação',
  agente_contratacao: 'Agente de contratação',
  pregoeiro: 'Pregoeiro',
  comissao_contratacao: 'Comissão de contratação',
  autoridade_competente: 'Autoridade competente',
  gestor_contrato: 'Gestor do contrato',
  fiscal_tecnico: 'Fiscal técnico',
  fiscal_administrativo: 'Fiscal administrativo',
  parecerista_juridico: 'Parecerista jurídico',
};

export function ehPapel(valor: string): valor is PapelProcesso {
  return Object.hasOwn(PAPEIS, valor);
}

export function rotuloPapel(valor: string): string {
  return ehPapel(valor) ? PAPEIS[valor] : valor;
}

export type TipoObjeto = ProcessoDetalhe['dfd']['tipoObjeto'];
export const TIPOS_OBJETO: Record<TipoObjeto, string> = {
  bens: 'Bens',
  servicos_comuns: 'Serviços comuns',
  servicos_especiais: 'Serviços especiais',
  obras_servicos_engenharia_comuns: 'Obras e serviços comuns de engenharia',
  obras_servicos_engenharia_especiais: 'Obras e serviços especiais de engenharia',
};

export function ehTipoObjeto(valor: string): valor is TipoObjeto {
  return Object.hasOwn(TIPOS_OBJETO, valor);
}

export const TIPOS_DOCUMENTO: Record<DocumentoGerado['tipo'], { rotulo: string; fundamento: string }> = {
  dfd: { rotulo: 'Documento de formalização da demanda (DFD)', fundamento: 'Lei 14.133/2021, art. 12, VII; Decreto 10.947/2022' },
  etp: { rotulo: 'Estudo técnico preliminar (ETP)', fundamento: 'Lei 14.133/2021, art. 18, §§ 1º e 2º' },
  matriz_riscos: { rotulo: 'Matriz de riscos', fundamento: 'Lei 14.133/2021, art. 6º, XXVII, e art. 22' },
  nota_tecnica_precos: { rotulo: 'Nota técnica da pesquisa de preços', fundamento: 'Lei 14.133/2021, art. 23; IN SEGES/ME 65/2021' },
  tr: { rotulo: 'Termo de referência (TR)', fundamento: 'Lei 14.133/2021, art. 6º, XXIII' },
  edital: { rotulo: 'Edital', fundamento: 'Lei 14.133/2021, art. 25' },
  minuta_contrato: { rotulo: 'Minuta de contrato', fundamento: 'Lei 14.133/2021, art. 92' },
  parecer_checklist: { rotulo: 'Checklist do parecer jurídico', fundamento: 'Lei 14.133/2021, art. 53' },
};

export const SITUACOES_DOCUMENTO: Record<DocumentoGerado['situacao'], RotuloTom> = {
  rascunho: { rotulo: 'Rascunho — requer revisão humana', tom: 'aviso' },
  revisado: { rotulo: 'Revisado, aguardando aprovação', tom: 'info' },
  aprovado: { rotulo: 'Aprovado', tom: 'sucesso' },
};

export const FONTES_COTACAO: Record<FonteCotacao, { rotulo: string; curto: string; fundamento: string }> = {
  painel_precos: { rotulo: 'Painel de preços (PNCP)', curto: 'Painel de preços', fundamento: 'art. 23, § 1º, I' },
  contratacao_similar: { rotulo: 'Contratação similar da Administração', curto: 'Contratação similar', fundamento: 'art. 23, § 1º, II' },
  midia_especializada: { rotulo: 'Mídia especializada, tabela ou sítio eletrônico', curto: 'Mídia ou tabela', fundamento: 'art. 23, § 1º, III' },
  fornecedor_direto: { rotulo: 'Pesquisa direta com fornecedor', curto: 'Fornecedor direto', fundamento: 'art. 23, § 1º, IV' },
  nota_fiscal: { rotulo: 'Base nacional de notas fiscais eletrônicas', curto: 'Notas fiscais', fundamento: 'art. 23, § 1º, V' },
};

export function ehFonteCotacao(valor: string): valor is FonteCotacao {
  return Object.hasOwn(FONTES_COTACAO, valor);
}

export function rotuloFonte(valor: string, curto = false): string {
  if (!ehFonteCotacao(valor)) return valor;
  return curto ? FONTES_COTACAO[valor].curto : FONTES_COTACAO[valor].rotulo;
}

export const MOTIVOS_EXPURGO: Record<'inexequivel' | 'excessivamente_elevado', string> = {
  inexequivel: 'Possivelmente inexequível (abaixo do intervalo)',
  excessivamente_elevado: 'Excessivamente elevado (acima do intervalo)',
};

export type Alocacao = ProcessoDetalhe['riscos'][number]['alocacao'];
export const ALOCACOES: Record<Alocacao, string> = {
  contratante: 'Contratante (Administração)',
  contratada: 'Contratada',
  compartilhado: 'Compartilhado',
};

export type Escala = 1 | 2 | 3 | 4 | 5;
export const ESCALA: readonly Escala[] = [1, 2, 3, 4, 5];
export const PROBABILIDADES: Record<Escala, string> = { 1: 'Rara', 2: 'Improvável', 3: 'Possível', 4: 'Provável', 5: 'Quase certa' };
export const IMPACTOS: Record<Escala, string> = { 1: 'Muito baixo', 2: 'Baixo', 3: 'Moderado', 4: 'Alto', 5: 'Muito alto' };

export function ehEscala(valor: number): valor is Escala {
  return ESCALA.some((e) => e === valor);
}

export type NivelRisco = 'baixo' | 'moderado' | 'alto' | 'critico';
export const NIVEIS_RISCO: Record<NivelRisco, RotuloTom> = {
  baixo: { rotulo: 'Baixo', tom: 'sucesso' },
  moderado: { rotulo: 'Moderado', tom: 'info' },
  alto: { rotulo: 'Alto', tom: 'aviso' },
  critico: { rotulo: 'Crítico', tom: 'erro' },
};

/** Nível pelo produto probabilidade × impacto (classificação de referência; o órgão pode adotar a sua). */
export function nivelRisco(probabilidade: number, impacto: number): NivelRisco {
  const produto = probabilidade * impacto;
  if (produto >= 15) return 'critico';
  if (produto >= 10) return 'alto';
  if (produto >= 5) return 'moderado';
  return 'baixo';
}

export type ConclusaoParecer = NonNullable<ProcessoDetalhe['parecer']['conclusao']>;
export const CONCLUSOES_PARECER: Record<ConclusaoParecer, RotuloTom> = {
  favoravel: { rotulo: 'Favorável', tom: 'sucesso' },
  favoravel_com_ressalvas: { rotulo: 'Favorável com ressalvas', tom: 'aviso' },
  desfavoravel: { rotulo: 'Desfavorável', tom: 'erro' },
};

export type SituacaoPublicacao = ProcessoDetalhe['publicacao']['pncp'];
export const SITUACOES_PUBLICACAO: Record<SituacaoPublicacao, RotuloTom> = {
  nao_publicado: { rotulo: 'Não publicado', tom: 'neutro' },
  na_fila: { rotulo: 'Na fila de envio', tom: 'info' },
  publicado: { rotulo: 'Publicado', tom: 'sucesso' },
};

export const NIVEIS_SINAL: Record<Sinal['nivel'], RotuloTom> = {
  informativo: { rotulo: 'Informativo', tom: 'info' },
  atencao: { rotulo: 'Atenção', tom: 'aviso' },
  risco: { rotulo: 'Risco', tom: 'erro' },
};

/** Critérios de julgamento (art. 33). */
export const CRITERIOS_JULGAMENTO: Record<CriterioJulgamentoEdital, string> = {
  menor_preco: 'Menor preço',
  maior_desconto: 'Maior desconto',
  tecnica_preco: 'Técnica e preço',
  melhor_tecnica: 'Melhor técnica ou conteúdo artístico',
  maior_lance: 'Maior lance (leilão)',
  maior_retorno_economico: 'Maior retorno econômico',
};

export function ehCriterioJulgamento(valor: string): valor is CriterioJulgamentoEdital {
  return Object.hasOwn(CRITERIOS_JULGAMENTO, valor);
}

export type RegimeExecucao = ParametrosEdital['regimeExecucao'];
/** Regimes de execução (art. 46). */
export const REGIMES_EXECUCAO: Record<RegimeExecucao, string> = {
  outro: 'Demais regimes (empreitada, tarefa, fornecimento e serviço associado)',
  integrada: 'Contratação integrada',
  semi_integrada: 'Contratação semi-integrada',
};

export function ehRegimeExecucao(valor: string): valor is RegimeExecucao {
  return Object.hasOwn(REGIMES_EXECUCAO, valor);
}

/** Vedações da habilitação e do acesso ao edital (RN-06): mensagens para a prévia no navegador. */
export function vedacoesEdital(p: ParametrosEdital): string[] {
  const vedacoes: string[] = [];
  if (p.exigeFaturamentoMinimo) vedacoes.push('Exigência de faturamento mínimo anterior é vedada (art. 69, § 2º).');
  if (p.patrimonioLiquidoMinimoPercentual !== null && p.patrimonioLiquidoMinimoPercentual > 10) {
    vedacoes.push('O patrimônio líquido mínimo não pode passar de 10% do valor estimado (art. 69, § 4º).');
  }
  if (p.exigeRegistroCadastralComplementar) vedacoes.push('Exigir registro cadastral complementar para acesso ao edital é vedado (art. 87, § 2º).');
  return vedacoes;
}
