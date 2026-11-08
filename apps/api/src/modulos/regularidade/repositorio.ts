import {
  avaliarChecklistRegularidade,
  classificarRegistroSancaoExterna,
  mascararDocumento,
  mascararNome,
  situacaoCertidao,
  type MomentoVerificacaoRegularidade,
  type RegistroCadastroSancoes,
  type ResultadoCertidao,
  type SancaoRegistradaNaAgora,
  type TipoCertidaoRegularidade,
} from '@agora/dominio';
import type { CertidaoRegistrada, ChecklistRegularidade, ConsultaCadastrosSancoes, VerificacaoRegularidade } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

/**
 * Acesso a dados da regularidade do contratado (RF-20): consultas ao CEIS/CNEP em cache, certidões registradas,
 * sanções aplicadas pelo órgão e verificações executadas. A regra fica em @agora/dominio (avaliarChecklistRegularidade).
 */

/** Idade máxima da consulta para valer como atual no checklist (a CGU atualiza os cadastros diariamente). */
export const VALIDADE_CONSULTA_HORAS = 24;

export interface FornecedorRegularidade {
  id: string;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
}

export async function obterFornecedorRegularidade(executor: Executor, id: string): Promise<FornecedorRegularidade | null> {
  const [linha] = await executor.consultar<FornecedorRegularidade>(
    'SELECT id, documento, tipo_pessoa, razao_social FROM fornecedores WHERE id = $1',
    [id],
  );
  return linha ?? null;
}

/** Fornecedor como exibido: documento mascarado e nome de pessoa física mascarado (LGPD). */
export function fornecedorExibivel(f: FornecedorRegularidade): ChecklistRegularidade['fornecedor'] {
  return {
    id: f.id,
    razaoSocial: f.tipo_pessoa === 'PF' ? mascararNome(f.razao_social) : f.razao_social,
    documento: mascararDocumento(f.documento),
  };
}

// ───────── consultas ao CEIS/CNEP ─────────

export interface LinhaConsulta {
  id: string;
  modo: 'offline' | 'online';
  fonte: string;
  consultado_em: string;
  hash_conteudo: string;
  quantidade: number;
  registros: RegistroCadastroSancoes[];
}

const COLUNAS_CONSULTA = 'id, modo, fonte, consultado_em, hash_conteudo, quantidade, registros';

export async function ultimaConsulta(executor: Executor, fornecedorId: string): Promise<LinhaConsulta | null> {
  const [linha] = await executor.consultar<LinhaConsulta>(
    `SELECT ${COLUNAS_CONSULTA} FROM consultas_ceis_cnep WHERE fornecedor_id = $1 ORDER BY consultado_em DESC, id LIMIT 1`,
    [fornecedorId],
  );
  return linha ?? null;
}

export async function obterConsulta(executor: Executor, id: string): Promise<LinhaConsulta | null> {
  const [linha] = await executor.consultar<LinhaConsulta>(`SELECT ${COLUNAS_CONSULTA} FROM consultas_ceis_cnep WHERE id = $1`, [id]);
  return linha ?? null;
}

export function mapearConsulta(l: LinhaConsulta, hoje: string): ConsultaCadastrosSancoes {
  return {
    id: l.id,
    modo: l.modo,
    fonte: l.fonte,
    consultadoEm: l.consultado_em,
    hashConteudo: l.hash_conteudo,
    quantidade: l.quantidade,
    registros: l.registros.map((r) => {
      const c = classificarRegistroSancaoExterna(r, hoje);
      return { ...r, vigente: c.vigente, impeditivo: c.impeditivo };
    }),
  };
}

// ───────── certidões ─────────

interface LinhaCertidao {
  id: string;
  tipo: TipoCertidaoRegularidade;
  numero: string;
  emissor: string;
  emitida_em: string;
  valida_ate: string;
  resultado: ResultadoCertidao;
  observacao: string | null;
  conferida_por: string | null;
  conferida_por_nome: string | null;
  conferida_em: string;
}

export async function carregarCertidoes(executor: Executor, fornecedorId: string): Promise<LinhaCertidao[]> {
  return executor.consultar<LinhaCertidao>(
    `SELECT c.id, c.tipo, c.numero, c.emissor, c.emitida_em, c.valida_ate, c.resultado, c.observacao,
            c.conferida_por, u.nome AS conferida_por_nome, c.conferida_em
       FROM certidoes_regularidade c
       LEFT JOIN usuarios u ON u.id = c.conferida_por
      WHERE c.fornecedor_id = $1
      ORDER BY c.conferida_em DESC, c.valida_ate DESC, c.id`,
    [fornecedorId],
  );
}

export function mapearCertidao(l: LinhaCertidao, hoje: string): CertidaoRegistrada {
  const s = situacaoCertidao({ tipo: l.tipo, numero: l.numero, emitidaEm: l.emitida_em, validaAte: l.valida_ate, resultado: l.resultado }, hoje);
  return {
    id: l.id,
    tipo: l.tipo,
    numero: l.numero,
    emissor: l.emissor,
    emitidaEm: l.emitida_em,
    validaAte: l.valida_ate,
    resultado: l.resultado,
    situacao: s.situacao,
    diasRestantes: s.diasRestantes,
    mensagem: s.mensagem,
    conferidaPor: usuarioResumo(l.conferida_por, l.conferida_por_nome),
    conferidaEm: l.conferida_em,
    observacao: l.observacao,
  };
}

// ───────── checklist ─────────

async function sancoesDoOrgao(executor: Executor, fornecedorId: string): Promise<SancaoRegistradaNaAgora[]> {
  const linhas = await executor.consultar<{ tipo: SancaoRegistradaNaAgora['tipo']; situacao: SancaoRegistradaNaAgora['situacao']; fim_vigencia: string | null }>(
    'SELECT tipo, situacao, fim_vigencia FROM sancoes WHERE fornecedor_id = $1 ORDER BY instaurada_em, id',
    [fornecedorId],
  );
  return linhas.map((l) => ({ tipo: l.tipo, situacao: l.situacao, fimVigencia: l.fim_vigencia }));
}

export interface OpcoesChecklist {
  /** true nas travas: sem consulta atual, o item do CEIS/CNEP fica impeditivo. */
  consultaObrigatoria: boolean;
  /** Consulta a usar (padrão: a última em cache). */
  consulta?: LinhaConsulta | null;
  falhaConsulta?: string | null;
}

/** Checklist do fornecedor a partir dos dados gravados (consulta em cache, sanções do órgão e certidões). */
export async function montarChecklist(
  executor: Executor,
  fornecedor: FornecedorRegularidade,
  momento: MomentoVerificacaoRegularidade,
  hoje: string,
  agora: Date,
  opcoes: OpcoesChecklist,
): Promise<{ checklist: ChecklistRegularidade; consultaId: string | null }> {
  const consulta = opcoes.consulta === undefined ? await ultimaConsulta(executor, fornecedor.id) : opcoes.consulta;
  const certidoes = await carregarCertidoes(executor, fornecedor.id);
  const r = avaliarChecklistRegularidade({
    momento,
    hoje,
    agora: agora.toISOString(),
    consulta: consulta ? { fonte: consulta.fonte, consultadoEm: consulta.consultado_em, registros: consulta.registros } : null,
    falhaConsulta: opcoes.falhaConsulta ?? null,
    consultaObrigatoria: opcoes.consultaObrigatoria,
    sancoesAgora: await sancoesDoOrgao(executor, fornecedor.id),
    certidoes: certidoes.map((c) => ({ tipo: c.tipo, numero: c.numero, emitidaEm: c.emitida_em, validaAte: c.valida_ate, resultado: c.resultado })),
    validadeConsultaHoras: VALIDADE_CONSULTA_HORAS,
  });
  return {
    checklist: {
      fornecedor: fornecedorExibivel(fornecedor),
      momento,
      regular: r.regular,
      bloqueia: r.bloqueia,
      itens: r.itens,
      motivos: r.motivos,
      avisos: r.avisos,
      providencias: r.providencias,
      consulta: consulta ? mapearConsulta(consulta, hoje) : null,
      falhaConsulta: opcoes.falhaConsulta ?? null,
      fundamento: r.fundamento,
      aviso: r.aviso,
      avaliadoEm: agora.toISOString(),
    },
    consultaId: consulta?.id ?? null,
  };
}

// ───────── verificações registradas ─────────

interface LinhaVerificacao {
  id: string;
  instrumento_tipo: VerificacaoRegularidade['instrumento']['tipo'];
  instrumento_id: string;
  resultado: ChecklistRegularidade;
  verificado_por: string | null;
  verificado_por_nome: string | null;
}

export function mapearVerificacao(l: LinhaVerificacao): VerificacaoRegularidade {
  return {
    ...l.resultado,
    id: l.id,
    instrumento: { tipo: l.instrumento_tipo, id: l.instrumento_id },
    verificadoPor: usuarioResumo(l.verificado_por, l.verificado_por_nome),
  };
}

export async function obterVerificacao(executor: Executor, id: string): Promise<VerificacaoRegularidade | null> {
  const [linha] = await executor.consultar<LinhaVerificacao>(
    `SELECT v.id, v.instrumento_tipo, v.instrumento_id, v.resultado, v.verificado_por, u.nome AS verificado_por_nome
       FROM verificacoes_regularidade v
       LEFT JOIN usuarios u ON u.id = v.verificado_por
      WHERE v.id = $1`,
    [id],
  );
  return linha ? mapearVerificacao(linha) : null;
}

/** Fornecedor e UASG do instrumento da verificação, para conferir o escopo de quem pede o comprovante. */
export async function escopoDaVerificacao(
  executor: Executor,
  id: string,
): Promise<{ fornecedor_id: string; instrumento_tipo: string; uasg: string | null } | null> {
  const [linha] = await executor.consultar<{ fornecedor_id: string; instrumento_tipo: string; uasg: string | null }>(
    `SELECT v.fornecedor_id, v.instrumento_tipo,
            COALESCE(c.uasg, pc.uasg, pr.uasg) AS uasg
       FROM verificacoes_regularidade v
       LEFT JOIN contratos c ON v.instrumento_tipo = 'contrato' AND c.id = v.instrumento_id
       LEFT JOIN pagamentos p ON v.instrumento_tipo = 'pagamento' AND p.id = v.instrumento_id
       LEFT JOIN contratos pc ON pc.id = p.contrato_id
       LEFT JOIN processos pr ON v.instrumento_tipo = 'processo' AND pr.id = v.instrumento_id
      WHERE v.id = $1`,
    [id],
  );
  return linha ?? null;
}
