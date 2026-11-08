/**
 * Registro cadastral de desempenho (RN-37): avaliações dos contratos, nota consolidada por fornecedor e fórmula do
 * desempenho na pontuação técnica do edital. Cálculos em @agora/dominio; aqui só a leitura e o mapeamento.
 */
import {
  consolidarRegistroDesempenho,
  situacaoAvaliacaoDesempenho,
  type AvaliacaoNoRegistro,
  type CriterioDesempenhoTecnica,
  type RegistroDesempenho,
} from '@agora/dominio';
import type {
  AvaliacaoDesempenho,
  AvaliacaoDesempenhoResumo,
  AvaliadorContrato,
  CertificadoDesempenho,
  FaixaIdc,
  IndicadoresAvaliacaoDesempenho,
  PapelAvaliadorDesempenho,
  TipoAvaliacaoDesempenho,
  TipoDocumentoIncentivo,
  TipoSancao,
  UsuarioResumo,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

export const EXPLICACAO_ENVIO_CADASTRO =
  'O Manual de Integração do PNCP ainda não tem serviço para o cadastro de atesto de cumprimento de obrigações (art. 88, § 4º). A avaliação consta do registro cadastral da Ágora com este protocolo e será enviada pela fila de integrações quando o serviço existir.';

// ───────────────────────── contrato avaliado ─────────────────────────

export interface ContratoAvaliado {
  id: string;
  numero: string;
  objeto: string;
  uasg: string;
  uasg_nome: string;
  uasg_sigla: string;
  fornecedor_id: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  documento: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_inicial: number;
  gestor_id: string | null;
  fiscal_id: string | null;
}

/** Contrato no escopo de UASG do usuário (`null` fora do escopo ou inexistente). */
export async function carregarContratoAvaliado(executor: Executor, contratoId: string, escopo: string[] | null): Promise<ContratoAvaliado | null> {
  const [linha] = await executor.consultar<ContratoAvaliado>(
    `SELECT c.id, c.numero, c.objeto, c.uasg, u.nome AS uasg_nome, u.sigla AS uasg_sigla, c.fornecedor_id, f.tipo_pessoa, f.razao_social,
            f.documento, c.vigencia_inicio, c.vigencia_fim, c.valor_inicial, c.gestor_id, c.fiscal_id
       FROM contratos c
       JOIN uasgs u ON u.codigo = c.uasg
       JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`,
    [contratoId, escopo],
  );
  return linha ?? null;
}

/**
 * Só o gestor ou o fiscal designado do contrato emite a avaliação (art. 88, § 3º; art. 117), com a permissão
 * `desempenho:avaliar`. A interface usa a mesma resposta para mostrar ou esconder o botão.
 */
export function avaliadorDoContrato(contrato: Pick<ContratoAvaliado, 'gestor_id' | 'fiscal_id'>, usuarioId: string, temPermissao: boolean): AvaliadorContrato {
  const papel: PapelAvaliadorDesempenho | null = contrato.gestor_id === usuarioId ? 'gestor' : contrato.fiscal_id === usuarioId ? 'fiscal' : null;
  if (!temPermissao) return { podeAvaliar: false, papel, motivo: 'Seu perfil não emite avaliação de desempenho.' };
  if (papel === null) return { podeAvaliar: false, papel: null, motivo: 'Só o gestor ou o fiscal designado deste contrato emite a avaliação de desempenho (art. 117).' };
  return { podeAvaliar: true, papel, motivo: null };
}

/** Ocorrências registradas e sanções aplicadas no contrato, no período (dados derivados, não digitados). */
export async function derivadosDoPeriodo(
  executor: Executor,
  contratoId: string,
  inicio: string,
  fim: string,
): Promise<{ ocorrencias: { total: number; resolvidasNoPrazo: number; abertas: number }; sancoes: { tipo: TipoSancao; dataAplicacao: string }[] }> {
  const [o] = await executor.consultar<{ total: number; resolvidas: number; abertas: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE situacao = 'resolvida_no_prazo')::int AS resolvidas,
            count(*) FILTER (WHERE situacao = 'aberta')::int AS abertas
       FROM ocorrencias_execucao
      WHERE contrato_id = $1 AND tipo IN ('ocorrencia', 'glosa', 'atraso') AND data BETWEEN $2::date AND $3::date`,
    [contratoId, inicio, fim],
  );
  const sancoes = await executor.consultar<{ tipo: TipoSancao; aplicada_em: string }>(
    `SELECT tipo, aplicada_em FROM sancoes
      WHERE contrato_id = $1 AND situacao = 'aplicada' AND aplicada_em BETWEEN $2::date AND $3::date
      ORDER BY aplicada_em, id`,
    [contratoId, inicio, fim],
  );
  return {
    ocorrencias: { total: o?.total ?? 0, resolvidasNoPrazo: o?.resolvidas ?? 0, abertas: o?.abertas ?? 0 },
    sancoes: sancoes.map((s) => ({ tipo: s.tipo, dataAplicacao: s.aplicada_em })),
  };
}

// ───────────────────────── avaliações ─────────────────────────

export interface ManifestacaoArmazenada {
  texto: string;
  recebidaEm: string;
  concorda: boolean;
  registradaPor: UsuarioResumo;
  registradaEm: string;
}
export interface AnaliseArmazenada {
  decisao: 'mantida' | 'revista';
  motivacao: string;
  por: UsuarioResumo;
  em: string;
  data: string;
}
export interface CalculoArmazenado {
  componentes: AvaliacaoDesempenho['componentes'];
  penalidades: AvaliacaoDesempenho['penalidades'];
  metodologia: string;
}

export interface LinhaAvaliacao {
  id: string;
  contrato_id: string;
  contrato_numero: string;
  contrato_objeto: string;
  fornecedor_id: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  uasg: string;
  tipo: TipoAvaliacaoDesempenho;
  periodo_inicio: string;
  periodo_fim: string;
  indicadores: IndicadoresAvaliacaoDesempenho;
  evidencias: string;
  motivacao: string;
  nota: number;
  faixa: FaixaIdc;
  calculo: CalculoArmazenado;
  avaliador_id: string;
  avaliador_nome: string;
  papel_avaliador: PapelAvaliadorDesempenho;
  emitida_em: string;
  data_emissao: string;
  prazo_manifestacao: string;
  manifestacao: ManifestacaoArmazenada | null;
  analise: AnaliseArmazenada | null;
  versao: number;
  documento: string;
  hash_documento: string;
  protocolo: string;
}

export interface FiltroAvaliacoes {
  id?: string;
  contratoId?: string;
  fornecedorIds?: readonly string[] | null;
}

export async function listarLinhasAvaliacoes(executor: Executor, filtro: FiltroAvaliacoes): Promise<LinhaAvaliacao[]> {
  return executor.consultar<LinhaAvaliacao>(
    `SELECT a.id, a.contrato_id, c.numero AS contrato_numero, c.objeto AS contrato_objeto, a.fornecedor_id, f.tipo_pessoa, f.razao_social,
            a.uasg, a.tipo, a.periodo_inicio, a.periodo_fim, a.indicadores, a.evidencias, a.motivacao, a.nota, a.faixa, a.calculo,
            a.avaliador_id, us.nome AS avaliador_nome, a.papel_avaliador, a.emitida_em, a.data_emissao, a.prazo_manifestacao,
            a.manifestacao, a.analise, a.versao, a.documento, a.hash_documento, a.protocolo
       FROM avaliacoes_desempenho a
       JOIN contratos c ON c.id = a.contrato_id
       JOIN fornecedores f ON f.id = a.fornecedor_id
       JOIN usuarios us ON us.id = a.avaliador_id
      WHERE ($1::uuid IS NULL OR a.id = $1)
        AND ($2::uuid IS NULL OR a.contrato_id = $2)
        AND ($3::uuid[] IS NULL OR a.fornecedor_id = ANY($3::uuid[]))
      ORDER BY a.periodo_fim DESC, a.emitida_em DESC, a.id`,
    [filtro.id ?? null, filtro.contratoId ?? null, filtro.fornecedorIds ? [...filtro.fornecedorIds] : null],
  );
}

export function situacaoDe(l: Pick<LinhaAvaliacao, 'prazo_manifestacao' | 'manifestacao' | 'analise'>, hoje: string) {
  return situacaoAvaliacaoDesempenho({ prazoManifestacao: l.prazo_manifestacao, manifestacao: l.manifestacao, analise: l.analise }, hoje);
}

export function paraAvaliacao(l: LinhaAvaliacao, hoje: string): AvaliacaoDesempenho {
  const s = situacaoDe(l, hoje);
  return {
    id: l.id,
    protocolo: l.protocolo,
    versao: l.versao,
    contrato: { id: l.contrato_id, numero: l.contrato_numero, objeto: l.contrato_objeto, uasg: l.uasg },
    fornecedor: { id: l.fornecedor_id, razaoSocial: nomeExibivel(l.tipo_pessoa, l.razao_social) },
    tipo: l.tipo,
    periodoInicio: l.periodo_inicio,
    periodoFim: l.periodo_fim,
    indicadores: l.indicadores,
    evidencias: l.evidencias,
    motivacao: l.motivacao,
    nota: l.nota,
    faixa: l.faixa,
    componentes: l.calculo.componentes,
    penalidades: l.calculo.penalidades,
    metodologia: l.calculo.metodologia,
    avaliador: { id: l.avaliador_id, nome: l.avaliador_nome, papel: l.papel_avaliador },
    emitidaEm: l.emitida_em,
    prazoManifestacao: l.prazo_manifestacao,
    manifestacao: l.manifestacao,
    analise: l.analise ? { decisao: l.analise.decisao, motivacao: l.analise.motivacao, por: l.analise.por, em: l.analise.em } : null,
    situacao: s.situacao,
    explicacaoSituacao: s.explicacao,
    envioCadastro: { situacao: 'aguardando_cadastro_pncp', explicacao: EXPLICACAO_ENVIO_CADASTRO },
    hashDocumento: l.hash_documento,
  };
}

function paraNoRegistro(l: LinhaAvaliacao, hoje: string): AvaliacaoNoRegistro {
  return { id: l.id, contratoId: l.contrato_id, tipo: l.tipo, periodoFim: l.periodo_fim, nota: l.nota, definitiva: situacaoDe(l, hoje).definitiva, emitidaEm: l.emitida_em };
}

export interface RegistroCarregado {
  registro: RegistroDesempenho;
  linhas: LinhaAvaliacao[];
}

/**
 * Registro cadastral de desempenho de cada fornecedor (nota de `consolidarRegistroDesempenho`). É do órgão (art. 87):
 * reúne as avaliações de todas as UASGs, para que o desempate e a pontuação técnica sejam iguais para todos.
 */
export async function carregarRegistros(executor: Executor, fornecedorIds: readonly string[] | null, hoje: string): Promise<Map<string, RegistroCarregado>> {
  const linhas = await listarLinhasAvaliacoes(executor, { fornecedorIds });
  const porFornecedor = new Map<string, LinhaAvaliacao[]>();
  for (const l of linhas) porFornecedor.set(l.fornecedor_id, [...(porFornecedor.get(l.fornecedor_id) ?? []), l]);
  const ids = fornecedorIds ?? [...porFornecedor.keys()];
  const mapa = new Map<string, RegistroCarregado>();
  for (const id of ids) {
    const doFornecedor = porFornecedor.get(id) ?? [];
    mapa.set(id, { registro: consolidarRegistroDesempenho(doFornecedor.map((l) => paraNoRegistro(l, hoje)), hoje), linhas: doFornecedor });
  }
  return mapa;
}

/** Nota do registro por fornecedor (`null` sem avaliação definitiva): a usada no desempate do art. 60, II. */
export async function notasDoRegistro(executor: Executor, fornecedorIds: readonly string[], hoje: string): Promise<Map<string, number | null>> {
  const registros = await carregarRegistros(executor, [...new Set(fornecedorIds)], hoje);
  return new Map([...registros.entries()].map(([id, r]) => [id, r.registro.nota]));
}

export function paraResumo(l: LinhaAvaliacao, hoje: string, consideradas: ReadonlySet<string>): AvaliacaoDesempenhoResumo {
  return {
    id: l.id,
    protocolo: l.protocolo,
    contrato: { id: l.contrato_id, numero: l.contrato_numero, uasg: l.uasg },
    tipo: l.tipo,
    periodoInicio: l.periodo_inicio,
    periodoFim: l.periodo_fim,
    nota: l.nota,
    faixa: l.faixa,
    situacao: situacaoDe(l, hoje).situacao,
    consideradaNoRegistro: consideradas.has(l.id),
    emitidaEm: l.emitida_em,
  };
}

/** Próximo protocolo do registro cadastral de desempenho: RCD-AAAA-NNNNNN. */
export async function proximoProtocolo(executor: Executor, hoje: string): Promise<string> {
  const [linha] = await executor.consultar<{ n: number }>("SELECT nextval('avaliacoes_desempenho_protocolo_seq')::int AS n");
  return `RCD-${hoje.slice(0, 4)}-${String(linha?.n ?? 0).padStart(6, '0')}`;
}

// ───────────────────────── certificados ─────────────────────────

export interface LinhaCertificado {
  id: string;
  fornecedor_id: string;
  tipo: TipoDocumentoIncentivo;
  codigo: string;
  nota: number | null;
  faixa: FaixaIdc;
  versao_registro: string;
  emitido_em: string;
  valido_ate: string;
  emitido_por: string | null;
  emitido_por_nome: string | null;
  conteudo: string;
}

export async function listarCertificados(executor: Executor, filtro: { fornecedorId?: string; id?: string }): Promise<LinhaCertificado[]> {
  return executor.consultar<LinhaCertificado>(
    `SELECT c.id, c.fornecedor_id, c.tipo, c.codigo, c.nota, c.faixa, c.versao_registro, c.emitido_em, c.valido_ate, c.emitido_por,
            u.nome AS emitido_por_nome, c.conteudo
       FROM certificados_desempenho c
       LEFT JOIN usuarios u ON u.id = c.emitido_por
      WHERE ($1::uuid IS NULL OR c.fornecedor_id = $1) AND ($2::uuid IS NULL OR c.id = $2)
      ORDER BY c.emitido_em DESC, c.id`,
    [filtro.fornecedorId ?? null, filtro.id ?? null],
  );
}

export function paraCertificado(l: LinhaCertificado, versaoAtual: string, hoje: string): CertificadoDesempenho {
  const situacao = l.valido_ate < hoje ? 'vencido' : l.versao_registro !== versaoAtual ? 'registro_atualizado' : 'valido';
  return {
    id: l.id,
    tipo: l.tipo,
    codigo: l.codigo,
    nota: l.nota,
    faixa: l.faixa,
    emitidoEm: l.emitido_em,
    validoAte: l.valido_ate,
    emitidoPor: l.emitido_por && l.emitido_por_nome ? { id: l.emitido_por, nome: l.emitido_por_nome } : null,
    versaoRegistro: l.versao_registro,
    situacao,
  };
}

// ───────────────────────── fórmula do edital (art. 36, § 3º; art. 37, III) ─────────────────────────

export interface LinhaCriterio {
  adotado: boolean;
  peso_desempenho: number | null;
  nota_sem_historico: number | null;
  regulamento: string | null;
  atualizado_por: string | null;
  atualizado_por_nome: string | null;
  atualizado_em: string;
}

export async function obterLinhaCriterio(executor: Executor, processoId: string): Promise<LinhaCriterio | null> {
  const [linha] = await executor.consultar<LinhaCriterio>(
    `SELECT c.adotado, c.peso_desempenho, c.nota_sem_historico, c.regulamento, c.atualizado_por, u.nome AS atualizado_por_nome, c.atualizado_em
       FROM criterios_desempenho_edital c LEFT JOIN usuarios u ON u.id = c.atualizado_por
      WHERE c.processo_id = $1`,
    [processoId],
  );
  return linha ?? null;
}

/** Fórmula adotada no edital do processo, pronta para @agora/dominio (`null` se não adotada). */
export async function criterioDesempenhoDoProcesso(executor: Executor, processoId: string): Promise<CriterioDesempenhoTecnica | null> {
  const linha = await obterLinhaCriterio(executor, processoId);
  if (!linha?.adotado || linha.peso_desempenho === null || linha.nota_sem_historico === null || linha.regulamento === null) return null;
  return { pesoDesempenhoPercentual: linha.peso_desempenho, notaSemHistorico: linha.nota_sem_historico, regulamento: linha.regulamento };
}
