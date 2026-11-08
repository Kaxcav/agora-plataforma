/**
 * Leitura das alterações do contrato (RF-27): o contrato com os valores do livro de aditivos, o histórico de atos da
 * Ágora (`alteracoes_contratuais`) somado aos termos importados e a situação de cada divulgação no PNCP.
 */
import {
  avaliarAditivo,
  avaliarLimiteAditivos,
  hojeISO,
  numeroTermoContratual,
  situacaoDivulgacaoTermoPncp,
  situacaoProrrogacao,
  type OpcoesCalendario,
} from '@agora/dominio';
import type {
  AlteracaoContratual,
  DivulgacaoAlteracaoPncp,
  EspecieAlteracaoContratual,
  NaturezaDuracaoContrato,
  PainelAlteracoesContrato,
  RegimeMaoDeObra,
  ResultadoParecerAlteracao,
  SituacaoAlteracaoContratual,
  TipoAlteracaoContratual,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { adicionarMeses, usuarioResumo } from '../../compartilhado/instrumentos.ts';

export interface LinhaContratoAlteracao {
  id: string;
  numero: string;
  ano: number;
  uasg: string;
  origem: 'licitacao' | 'contratacao_direta';
  fornecedor_id: string;
  objeto: string;
  processo_sei: string;
  assinatura_em: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_inicial: number;
  indice_reajuste: string;
  data_base_reajuste: string;
  natureza_duracao: NaturezaDuracaoContrato | null;
  regime_mao_obra: RegimeMaoDeObra | null;
  extinto_em: string | null;
  id_pncp: string | null;
  acrescimos: number;
  supressoes: number;
  reajustes: number;
  valor_global: number;
  valor_pago: number;
  uasg_nome: string;
  razao_social: string;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
}

const SELECAO = `
  SELECT c.id, c.numero, c.ano, c.uasg, c.origem, c.fornecedor_id, c.objeto, c.processo_sei, c.assinatura_em, c.vigencia_inicio,
         c.vigencia_fim, c.valor_inicial, c.indice_reajuste, c.data_base_reajuste, c.natureza_duracao, c.regime_mao_obra, c.extinto_em,
         c.id_pncp, v.acrescimos, v.supressoes, v.reajustes, v.valor_global, v.valor_pago, u.nome AS uasg_nome,
         f.razao_social, f.documento, f.tipo_pessoa
    FROM contratos c
    JOIN vw_contratos_valores v ON v.contrato_id = c.id
    JOIN uasgs u ON u.codigo = c.uasg
    JOIN fornecedores f ON f.id = c.fornecedor_id`;

/** Contrato no escopo de UASG (null fora do escopo). Na transação, `bloquear` trava a linha do contrato. */
export async function obterContratoAlteracao(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  bloquear = false,
): Promise<LinhaContratoAlteracao | null> {
  if (bloquear) await executor.consultar('SELECT id FROM contratos WHERE id = $1 FOR UPDATE', [id]);
  const [linha] = await executor.consultar<LinhaContratoAlteracao>(`${SELECAO} WHERE c.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`, [
    id,
    escopo,
  ]);
  return linha ?? null;
}

/** Valor inicial atualizado pelos reajustes e repactuações (base do art. 125). */
export function valorInicialAtualizado(c: LinhaContratoAlteracao): number {
  return c.valor_inicial + c.reajustes;
}

export async function ciclosReajusteAplicados(executor: Executor, contratoId: string): Promise<number> {
  const [linha] = await executor.consultar<{ total: number }>(
    `SELECT COUNT(*)::integer AS total FROM reajustes_ciclos WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND aplicado_em IS NOT NULL`,
    [contratoId],
  );
  return linha?.total ?? 0;
}

/** Assinatura da prorrogação mais recente (art. 131, parágrafo único). */
export async function ultimaProrrogacao(executor: Executor, contratoId: string): Promise<string | null> {
  const [linha] = await executor.consultar<{ assinado_em: string | null }>(
    `SELECT MAX(assinado_em) AS assinado_em FROM aditivos WHERE contrato_id = $1 AND tipo = 'prorrogacao'`,
    [contratoId],
  );
  return linha?.assinado_em ?? null;
}

const TIPOS_LIVRO_ADITIVO = ['acrescimo', 'supressao', 'prorrogacao', 'qualitativa', 'reequilibrio'];

/** Próximo número do termo da espécie: aditivos e apostilas contam o livro (inclusive os importados). */
export async function proximoNumeroTermo(executor: Executor, contratoId: string, especie: EspecieAlteracaoContratual): Promise<string> {
  if (especie === 'rescisao') return numeroTermoContratual('rescisao', 1);
  const tipos = especie === 'aditivo' ? TIPOS_LIVRO_ADITIVO : ['reajuste'];
  const [linha] = await executor.consultar<{ total: number }>(
    'SELECT COUNT(*)::integer AS total FROM aditivos WHERE contrato_id = $1 AND tipo = ANY($2::text[])',
    [contratoId, tipos],
  );
  return numeroTermoContratual(especie, (linha?.total ?? 0) + 1);
}

export interface LinhaAlteracao {
  id: string;
  contrato_id: string;
  especie: EspecieAlteracaoContratual;
  tipo: TipoAlteracaoContratual;
  situacao: SituacaoAlteracaoContratual;
  numero: string | null;
  valor: number;
  nova_vigencia_fim: string | null;
  justificativa: string;
  dados: DadosAlteracao;
  parecer: ParecerGravado | null;
  decisao: DecisaoGravada | null;
  contraditorio: ContraditorioGravado | null;
  aditivo_id: string | null;
  verificacao_regularidade_id: string | null;
  proposto_por: string | null;
  proposto_por_nome: string | null;
  proposto_em: string;
  assinado_por: string | null;
  assinado_por_nome: string | null;
  assinado_em: string | null;
  divulgacao_tarefa_id: string | null;
  divulgacao_modo: 'offline' | 'online' | null;
  divulgacao_protocolo: string | null;
  divulgacao_numero_controle: string | null;
  divulgacao_hash: string | null;
  divulgado_em: string | null;
  tarefa_situacao: 'pendente' | 'executando' | 'concluida' | 'erro' | null;
  tarefa_tentativas: number | null;
  tarefa_erro: string | null;
}

/** Dados próprios de cada tipo, guardados em jsonb, com as linhas de resumo já formatadas. */
export interface DadosAlteracao {
  detalhes?: { rotulo: string; valor: string }[];
  avaliacao?: { explicacao: string; fundamento: string };
  [chave: string]: unknown;
}

export interface ParecerGravado {
  resultado: ResultadoParecerAlteracao;
  numero: string;
  texto: string;
  emitidoPor: string;
  emitidoPorNome: string;
  emitidoEm: string;
}

export interface DecisaoGravada {
  resultado: string;
  fundamentacao: string;
  decididoPor: string;
  decididoPorNome: string;
  decididoEm: string;
}

export interface ContraditorioGravado {
  prazoDiasUteis: number;
  prazoFim: string;
  notificadoEm: string;
  notificacaoId: string | null;
  defesa: { apresentadaEm: string; resumo: string } | null;
  semManifestacao: boolean;
}

const SELECAO_ALTERACOES = `
  SELECT a.id, a.contrato_id, a.especie, a.tipo, a.situacao, a.numero, a.valor, a.nova_vigencia_fim, a.justificativa, a.dados,
         a.parecer, a.decisao, a.contraditorio, a.aditivo_id, a.verificacao_regularidade_id, a.proposto_por, p.nome AS proposto_por_nome,
         a.proposto_em, a.assinado_por, s.nome AS assinado_por_nome, a.assinado_em, a.divulgacao_tarefa_id, a.divulgacao_modo,
         a.divulgacao_protocolo, a.divulgacao_numero_controle, a.divulgacao_hash, a.divulgado_em,
         t.situacao AS tarefa_situacao, t.tentativas AS tarefa_tentativas, t.ultimo_erro AS tarefa_erro
    FROM alteracoes_contratuais a
    LEFT JOIN usuarios p ON p.id = a.proposto_por
    LEFT JOIN usuarios s ON s.id = a.assinado_por
    LEFT JOIN fila_tarefas t ON t.id = a.divulgacao_tarefa_id`;

export async function obterLinhaAlteracao(executor: Executor, contratoId: string, alteracaoId: string, bloquear = false): Promise<LinhaAlteracao | null> {
  if (bloquear) await executor.consultar('SELECT id FROM alteracoes_contratuais WHERE id = $1 FOR UPDATE', [alteracaoId]);
  const [linha] = await executor.consultar<LinhaAlteracao>(`${SELECAO_ALTERACOES} WHERE a.id = $1 AND a.contrato_id = $2`, [alteracaoId, contratoId]);
  return linha ?? null;
}

function situacaoTarefa(l: LinhaAlteracao): DivulgacaoAlteracaoPncp['situacao'] {
  if (l.divulgacao_tarefa_id === null) return 'nao_solicitada';
  if (l.tarefa_situacao === 'concluida') return 'publicado';
  if (l.tarefa_situacao === 'erro') return 'erro';
  if (l.tarefa_situacao === 'executando') return 'enviando';
  return (l.tarefa_tentativas ?? 0) > 0 ? 'nova_tentativa' : 'na_fila';
}

export function mapearAlteracao(
  l: LinhaAlteracao,
  contrato: Pick<LinhaContratoAlteracao, 'origem'>,
  hoje: string,
  calendario: OpcoesCalendario,
): AlteracaoContratual {
  const assinado = l.situacao === 'assinado';
  const situacao = situacaoTarefa(l);
  const divulgadoEm = l.divulgado_em ? hojeISO(new Date(l.divulgado_em)) : null;
  const prazo =
    assinado && l.assinado_em
      ? situacaoDivulgacaoTermoPncp({ especie: l.especie, assinadoEm: l.assinado_em, origem: contrato.origem, divulgadoEm, hoje }, calendario)
      : null;
  return {
    id: l.id,
    contratoId: l.contrato_id,
    especie: l.especie,
    tipo: l.tipo,
    situacao: l.situacao,
    numero: l.numero,
    valor: l.valor,
    novaVigenciaFim: l.nova_vigencia_fim,
    justificativa: l.justificativa,
    origem: 'agora',
    detalhes: l.dados.detalhes ?? [],
    avaliacao: l.dados.avaliacao ?? null,
    parecer: l.parecer
      ? {
          resultado: l.parecer.resultado,
          numero: l.parecer.numero,
          texto: l.parecer.texto,
          emitidoPor: usuarioResumo(l.parecer.emitidoPor, l.parecer.emitidoPorNome),
          emitidoEm: l.parecer.emitidoEm,
        }
      : null,
    decisao: l.decisao
      ? {
          resultado: l.decisao.resultado,
          fundamentacao: l.decisao.fundamentacao,
          decididoPor: usuarioResumo(l.decisao.decididoPor, l.decisao.decididoPorNome),
          decididoEm: l.decisao.decididoEm,
        }
      : null,
    contraditorio: l.contraditorio
      ? {
          prazoDiasUteis: l.contraditorio.prazoDiasUteis,
          prazoFim: l.contraditorio.prazoFim,
          notificadoEm: l.contraditorio.notificadoEm,
          defesa: l.contraditorio.defesa,
          semManifestacao: l.contraditorio.semManifestacao,
        }
      : null,
    propostoPor: usuarioResumo(l.proposto_por, l.proposto_por_nome),
    propostoEm: l.proposto_em,
    assinadoPor: usuarioResumo(l.assinado_por, l.assinado_por_nome),
    assinadoEm: l.assinado_em,
    verificacaoRegularidadeId: l.verificacao_regularidade_id,
    divulgacao: {
      situacao,
      modo: l.divulgacao_modo,
      tarefaId: l.divulgacao_tarefa_id,
      protocolo: l.divulgacao_protocolo,
      numeroControle: l.divulgacao_numero_controle,
      hashDados: l.divulgacao_hash,
      enviadoEm: l.divulgado_em,
      ultimoErro: situacao === 'publicado' ? null : l.tarefa_erro,
      prazo,
    },
    linkTermo: assinado ? `/api/v1/contratos/${l.contrato_id}/alteracoes/${l.id}/termo.pdf` : null,
    acoes: {
      parecer: l.situacao === 'aguardando_parecer',
      assinar: l.situacao === 'pronto_para_assinatura',
      indeferir: l.situacao === 'aguardando_parecer' || l.situacao === 'pronto_para_assinatura' || l.situacao === 'devolvido',
      defesa: l.situacao === 'em_contraditorio',
      decidirExtincao: l.situacao === 'em_contraditorio' || l.situacao === 'aguardando_decisao',
      divulgar: assinado && situacao === 'erro',
    },
  };
}

interface LinhaLivro {
  id: string;
  numero: string;
  tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste' | 'qualitativa' | 'reequilibrio';
  valor: number;
  nova_vigencia_fim: string | null;
  assinado_em: string;
  justificativa: string;
}

const TIPO_IMPORTADO: Record<LinhaLivro['tipo'], { especie: EspecieAlteracaoContratual; tipo: TipoAlteracaoContratual }> = {
  acrescimo: { especie: 'aditivo', tipo: 'acrescimo' },
  supressao: { especie: 'aditivo', tipo: 'supressao' },
  prorrogacao: { especie: 'aditivo', tipo: 'prazo' },
  qualitativa: { especie: 'aditivo', tipo: 'qualitativa' },
  reequilibrio: { especie: 'aditivo', tipo: 'reequilibrio' },
  reajuste: { especie: 'apostila', tipo: 'reajuste' },
};

/** Termo do livro de aditivos sem ato correspondente na Ágora (carga do Contratos.gov.br). */
function mapearImportado(l: LinhaLivro, contratoId: string): AlteracaoContratual {
  const { especie, tipo } = TIPO_IMPORTADO[l.tipo];
  return {
    id: l.id,
    contratoId,
    especie,
    tipo,
    situacao: 'assinado',
    numero: l.numero,
    valor: l.tipo === 'supressao' ? -l.valor : l.valor,
    novaVigenciaFim: l.nova_vigencia_fim,
    justificativa: l.justificativa,
    origem: 'importado',
    detalhes: [],
    avaliacao: null,
    parecer: null,
    decisao: null,
    contraditorio: null,
    propostoPor: null,
    propostoEm: `${l.assinado_em}T12:00:00.000Z`,
    assinadoPor: null,
    assinadoEm: l.assinado_em,
    verificacaoRegularidadeId: null,
    divulgacao: {
      situacao: 'importado',
      modo: null,
      tarefaId: null,
      protocolo: null,
      numeroControle: null,
      hashDados: null,
      enviadoEm: null,
      ultimoErro: null,
      prazo: null,
    },
    linkTermo: null,
    acoes: { parecer: false, assinar: false, indeferir: false, defesa: false, decidirExtincao: false, divulgar: false },
  };
}

/** Histórico completo: atos da Ágora e termos importados, do mais recente para o mais antigo. */
export async function listarAlteracoes(
  executor: Executor,
  contrato: LinhaContratoAlteracao,
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<AlteracaoContratual[]> {
  const atos = await executor.consultar<LinhaAlteracao>(`${SELECAO_ALTERACOES} WHERE a.contrato_id = $1`, [contrato.id]);
  const importados = await executor.consultar<LinhaLivro>(
    `SELECT d.id, d.numero, d.tipo, d.valor, d.nova_vigencia_fim, d.assinado_em, d.justificativa
       FROM aditivos d
      WHERE d.contrato_id = $1
        AND NOT EXISTS (SELECT 1 FROM alteracoes_contratuais a WHERE a.aditivo_id = d.id)`,
    [contrato.id],
  );
  const todos = [...atos.map((l) => mapearAlteracao(l, contrato, hoje, calendario)), ...importados.map((l) => mapearImportado(l, contrato.id))];
  const chave = (a: AlteracaoContratual) => a.assinadoEm ?? a.propostoEm.slice(0, 10);
  return todos.sort((a, b) => (chave(a) === chave(b) ? b.propostoEm.localeCompare(a.propostoEm) : chave(b).localeCompare(chave(a))));
}

/** Painel da aba Alterações: limites do art. 125, prorrogação, reajuste e histórico. */
export async function montarPainelAlteracoes(
  executor: Executor,
  contrato: LinhaContratoAlteracao,
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<PainelAlteracoesContrato> {
  const base = valorInicialAtualizado(contrato);
  const nivel = avaliarLimiteAditivos({ valorInicialAtualizado: Math.max(base, 1), acrescimos: contrato.acrescimos, supressoes: contrato.supressoes });
  const margem = (tipo: 'acrescimo' | 'supressao') =>
    avaliarAditivo({
      valorInicialAtualizado: Math.max(base, 1),
      acrescimosAnteriores: contrato.acrescimos,
      supressoesAnteriores: contrato.supressoes,
      tipo,
      valor: 0,
    }).margemRestante;
  const ciclos = await ciclosReajusteAplicados(executor, contrato.id);
  const proximoAniversario = adicionarMeses(contrato.data_base_reajuste, 12 * (ciclos + 1));
  const prorrogacao = situacaoProrrogacao({
    natureza: contrato.natureza_duracao,
    vigenciaInicio: contrato.vigencia_inicio,
    vigenciaFim: contrato.vigencia_fim,
    hoje,
  });
  return {
    contratoId: contrato.id,
    natureza: contrato.natureza_duracao,
    regimeMaoDeObra: contrato.regime_mao_obra,
    extintoEm: contrato.extinto_em,
    limites: {
      valorInicial: contrato.valor_inicial,
      reajustes: contrato.reajustes,
      valorInicialAtualizado: base,
      acrescimos: contrato.acrescimos,
      supressoes: contrato.supressoes,
      percentualAcrescimos: nivel.percentualAcrescimos,
      percentualSupressoes: nivel.percentualSupressoes,
      limiteAcrescimos: nivel.limiteAcrescimos,
      limiteSupressoes: 25,
      margemAcrescimos: margem('acrescimo'),
      margemSupressoes: margem('supressao'),
      nivel: nivel.nivel,
      explicacao: nivel.explicacao,
      fundamento: nivel.fundamento,
    },
    prorrogacao: {
      tipo: contrato.extinto_em ? 'nova_licitacao' : prorrogacao.tipo,
      limiteVigencia: prorrogacao.limiteVigencia,
      diasRestantes: prorrogacao.diasRestantes,
      mensagem: contrato.extinto_em ? 'contrato extinto: não cabe prorrogação (arts. 137 a 139).' : prorrogacao.mensagem,
      fundamento: prorrogacao.fundamento,
    },
    reajuste: {
      indice: contrato.indice_reajuste,
      dataBase: contrato.data_base_reajuste,
      ciclosAplicados: ciclos,
      proximoAniversario,
      disponivel: proximoAniversario <= hoje && proximoAniversario <= contrato.vigencia_fim && contrato.extinto_em === null,
      saldoContratual: Math.max(0, contrato.valor_global - contrato.valor_pago),
    },
    alteracoes: await listarAlteracoes(executor, contrato, hoje, calendario),
  };
}

