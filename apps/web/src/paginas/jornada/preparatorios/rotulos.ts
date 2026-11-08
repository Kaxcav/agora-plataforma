/**
 * Rótulos pt-BR e regras de exibição das peças complementares da fase preparatória (frente P — RF-32 e RN-39).
 * O servidor decide quem gera, aprova e assina; aqui só se escolhe o que mostrar em cada etapa.
 */
import type { EtapaJornada, Permissao, SituacaoDeclaracaoOrcamentaria, SituacaoPecaProcesso, TipoDocumentoComplementar } from '@agora/contratos';
import type { RotuloTom } from '../../compartilhado/rotulos';

export const TIPOS_DOCUMENTO_COMPLEMENTARES: Record<TipoDocumentoComplementar, { rotulo: string; fundamento: string }> = {
  portaria_designacao: { rotulo: 'Portaria de designação da equipe e dos agentes', fundamento: 'Lei 14.133/2021, arts. 7º e 8º' },
  declaracao_orcamentaria: { rotulo: 'Declaração de adequação orçamentária', fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "j", e art. 150' },
  despacho_autorizacao: { rotulo: 'Despacho de autorização da contratação', fundamento: 'Lei 14.133/2021, art. 53, § 3º, e art. 72, VIII' },
  nota_tecnica_conjur: { rotulo: 'Nota técnica à assessoria jurídica', fundamento: 'Lei 14.133/2021, art. 53' },
  modelo_proposta: { rotulo: 'Modelo de proposta comercial', fundamento: 'Lei 14.133/2021, art. 25 e art. 63' },
  ordem_servico: { rotulo: 'Modelo de ordem de serviço ou de fornecimento', fundamento: 'Lei 14.133/2021, art. 92, § 2º, e art. 117' },
  termo_sigilo: { rotulo: 'Modelo de termo de compromisso e de sigilo', fundamento: 'Lei 14.133/2021, art. 13; Lei 13.709/2018' },
  termo_recebimento_provisorio: { rotulo: 'Modelo de termo de recebimento provisório', fundamento: 'Lei 14.133/2021, art. 140' },
  termo_recebimento_definitivo: { rotulo: 'Modelo de termo de recebimento definitivo', fundamento: 'Lei 14.133/2021, art. 140' },
  caderno_prova_conceito: { rotulo: 'Caderno de testes da prova de conceito', fundamento: 'Lei 14.133/2021, art. 17, § 3º, e art. 41, II' },
  checklist_documentos: { rotulo: 'Checklist de documentos do processo', fundamento: 'Lei 14.133/2021, arts. 18, 53 e 72' },
};

/** Etapas em que cada peça aparece no painel: da primeira em que faz sentido até a última em que pode ser gerada. */
export const ETAPAS_DAS_PECAS: Record<TipoDocumentoComplementar, readonly [EtapaJornada, EtapaJornada]> = {
  portaria_designacao: [2, 7],
  declaracao_orcamentaria: [3, 4],
  despacho_autorizacao: [4, 5],
  nota_tecnica_conjur: [4, 5],
  modelo_proposta: [4, 4],
  ordem_servico: [4, 4],
  termo_sigilo: [4, 4],
  termo_recebimento_provisorio: [4, 4],
  termo_recebimento_definitivo: [4, 4],
  caderno_prova_conceito: [4, 6],
  checklist_documentos: [1, 7],
};

export const ORDEM_PECAS = Object.keys(ETAPAS_DAS_PECAS).filter((t): t is TipoDocumentoComplementar => Object.hasOwn(ETAPAS_DAS_PECAS, t));

export function pecasDaEtapa(etapa: EtapaJornada): TipoDocumentoComplementar[] {
  return ORDEM_PECAS.filter((t) => ETAPAS_DAS_PECAS[t][0] <= etapa && etapa <= ETAPAS_DAS_PECAS[t][1]);
}

/** Atos da autoridade competente designada no processo. */
const DA_AUTORIDADE: ReadonlySet<string> = new Set<TipoDocumentoComplementar>(['portaria_designacao', 'declaracao_orcamentaria', 'despacho_autorizacao']);

export function documentoDaAutoridade(tipo: string | undefined): boolean {
  return tipo !== undefined && DA_AUTORIDADE.has(tipo);
}

/** Permissão para aprovar e assinar um documento da jornada (o servidor confere também a designação). */
export function permissaoAssinatura(tipo: string | undefined): Permissao {
  if (tipo === 'parecer_checklist') return 'jornada:aprovar_juridico';
  return documentoDaAutoridade(tipo) ? 'jornada:autorizar' : 'jornada:editar';
}

export const SITUACOES_DECLARACAO: Record<SituacaoDeclaracaoOrcamentaria, RotuloTom> = {
  nao_gerada: { rotulo: 'Declaração não gerada', tom: 'neutro' },
  rascunho: { rotulo: 'Declaração aguardando a autoridade', tom: 'aviso' },
  aprovada: { rotulo: 'Declarada pela autoridade', tom: 'sucesso' },
  desatualizada: { rotulo: 'Declaração desatualizada', tom: 'erro' },
};

export const SITUACOES_PECA: Record<SituacaoPecaProcesso, RotuloTom> = {
  pronta: { rotulo: 'Pronta', tom: 'sucesso' },
  rascunho: { rotulo: 'Em rascunho', tom: 'aviso' },
  desatualizada: { rotulo: 'Desatualizada', tom: 'erro' },
  falta: { rotulo: 'Falta', tom: 'erro' },
  nao_aplicavel: { rotulo: 'Não se aplica', tom: 'neutro' },
};

export const OBRIGATORIEDADES: Record<'obrigatoria' | 'condicional' | 'recomendada', string> = {
  obrigatoria: 'Obrigatória',
  condicional: 'Condicional',
  recomendada: 'Recomendada',
};
