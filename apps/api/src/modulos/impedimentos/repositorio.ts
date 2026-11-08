/**
 * Leitura dos dados de vínculos (RIA-10), extensões de sanção (RN-27) e declarações dos agentes (RN-28).
 * Dados pessoais (CPF de sócio, nome de pessoa física) só saem daqui mascarados.
 */
import {
  detectarPossivelSucessao,
  mascararDocumento,
  mascararNome,
  normalizarEndereco,
  sinalizarVinculosLicitantes,
  type AgenteParaVinculos,
  type FornecedorParaVinculos,
  type SancaoParaSucessao,
  type VinculoInformado,
} from '@agora/dominio';
import type {
  AnaliseVinculos,
  ExtensaoSancao,
  IntegranteQuadro,
  QuadroSocietario,
  SinalVinculo,
  TipoSancao,
  VinculoRegistrado,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

// ───────────────────────── fornecedores para a análise ─────────────────────────

export interface FornecedorAnalise extends FornecedorParaVinculos {
  documento: string;
  tipoPessoa: 'PJ' | 'PF';
  qsaConsultadoEm: string | null;
}

/** Fornecedores com quadro societário (dados abertos, se consultados; senão, o do cadastro), endereço do CNPJ e contato. */
export async function carregarFornecedoresAnalise(executor: Executor, ids: readonly string[] | null): Promise<FornecedorAnalise[]> {
  const parametro = ids === null ? null : [...ids];
  const linhas = await executor.consultar<{
    id: string;
    documento: string;
    tipo_pessoa: 'PJ' | 'PF';
    razao_social: string;
    telefone: string | null;
    email: string | null;
    data_abertura: string | null;
    endereco: string | null;
    consultado_em: string | null;
  }>(
    `SELECT f.id, f.documento, f.tipo_pessoa, f.razao_social, f.telefone, f.email, c.data_abertura, c.endereco, c.consultado_em
       FROM fornecedores f
       LEFT JOIN fornecedores_cadastro_cnpj c ON c.fornecedor_id = f.id
      WHERE ($1::uuid[] IS NULL OR f.id = ANY($1::uuid[]))
      ORDER BY f.razao_social`,
    [parametro],
  );
  const quadro = await executor.consultar<{ fornecedor_id: string; documento: string; nome: string; qualificacao: 'socio' | 'administrador' | 'socio_administrador' }>(
    `SELECT q.fornecedor_id, q.documento_parcial AS documento, q.nome, q.qualificacao
       FROM fornecedores_qsa q
      WHERE ($1::uuid[] IS NULL OR q.fornecedor_id = ANY($1::uuid[]))
     UNION ALL
     SELECT s.fornecedor_id, s.cpf AS documento, s.nome, s.qualificacao
       FROM fornecedores_socios s
      WHERE ($1::uuid[] IS NULL OR s.fornecedor_id = ANY($1::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM fornecedores_qsa q2 WHERE q2.fornecedor_id = s.fornecedor_id)`,
    [parametro],
  );
  const porFornecedor = new Map<string, FornecedorParaVinculos['quadro'][number][]>();
  for (const q of quadro) {
    const lista = porFornecedor.get(q.fornecedor_id) ?? [];
    lista.push({ documento: q.documento, nome: q.nome, qualificacao: q.qualificacao });
    porFornecedor.set(q.fornecedor_id, lista);
  }
  return linhas.map((l) => ({
    id: l.id,
    nome: nomeExibivel(l.tipo_pessoa, l.razao_social),
    documento: l.documento,
    tipoPessoa: l.tipo_pessoa,
    dataAbertura: l.data_abertura,
    endereco: l.endereco,
    telefone: l.telefone,
    email: l.email,
    quadro: l.tipo_pessoa === 'PJ' ? (porFornecedor.get(l.id) ?? []) : [],
    qsaConsultadoEm: l.consultado_em,
  }));
}

/**
 * Fornecedores que podem ter vínculo com `id`: mesma pessoa no quadro societário (6 dígitos centrais do CPF),
 * mesmo contato, mesmo endereço normalizado ou vínculo registrado. Evita comparar o cadastro inteiro par a par.
 */
export async function candidatosVinculo(executor: Executor, id: string): Promise<string[]> {
  const porQuadroOuContato = await executor.consultar<{ id: string }>(
    `WITH pessoas AS (
       SELECT documento_parcial AS centrais FROM fornecedores_qsa WHERE fornecedor_id = $1
       UNION SELECT substr(cpf, 4, 6) FROM fornecedores_socios WHERE fornecedor_id = $1
     ), alvo AS (SELECT telefone, lower(email) AS email FROM fornecedores WHERE id = $1)
     SELECT DISTINCT f.id FROM fornecedores f
      WHERE f.id <> $1 AND (
        EXISTS (SELECT 1 FROM fornecedores_qsa q JOIN pessoas p ON p.centrais = q.documento_parcial WHERE q.fornecedor_id = f.id)
        OR EXISTS (SELECT 1 FROM fornecedores_socios s JOIN pessoas p ON p.centrais = substr(s.cpf, 4, 6) WHERE s.fornecedor_id = f.id)
        OR EXISTS (SELECT 1 FROM alvo a WHERE (a.telefone IS NOT NULL AND a.telefone = f.telefone) OR (a.email IS NOT NULL AND a.email = lower(f.email)))
        OR EXISTS (SELECT 1 FROM vinculos_licitantes v WHERE v.situacao = 'ativo'
                     AND ((v.fornecedor_id = $1 AND v.outro_fornecedor_id = f.id) OR (v.outro_fornecedor_id = $1 AND v.fornecedor_id = f.id))))`,
    [id],
  );
  const enderecos = await executor.consultar<{ fornecedor_id: string; endereco: string }>(
    'SELECT fornecedor_id, endereco FROM fornecedores_cadastro_cnpj WHERE endereco IS NOT NULL',
  );
  const proprio = enderecos.find((e) => e.fornecedor_id === id);
  const normalizado = proprio ? normalizarEndereco(proprio.endereco) : null;
  const porEndereco =
    normalizado === null ? [] : enderecos.filter((e) => e.fornecedor_id !== id && normalizarEndereco(e.endereco) === normalizado).map((e) => e.fornecedor_id);
  return [...new Set([...porQuadroOuContato.map((l) => l.id), ...porEndereco])];
}

// ───────────────────────── vínculos registrados ─────────────────────────

interface LinhaVinculo {
  id: string;
  natureza: VinculoRegistrado['natureza'];
  grau_parentesco: 1 | 2 | 3 | null;
  fornecedor_id: string;
  fornecedor_nome: string;
  fornecedor_tipo: 'PJ' | 'PF';
  outro_fornecedor_id: string | null;
  outro_nome: string | null;
  outro_tipo: 'PJ' | 'PF' | null;
  agente_id: string | null;
  agente_nome: string | null;
  fonte: VinculoRegistrado['fonte'];
  descricao: string;
  evidencia: string;
  processo_id: string | null;
  processo_numero: string | null;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
  situacao: 'ativo' | 'revogado';
  motivo_revogacao: string | null;
}

export interface FiltroVinculos {
  id?: string | undefined;
  /** Vínculos que envolvem qualquer destes fornecedores (dos dois lados). */
  fornecedorIds?: readonly string[] | undefined;
  processoId?: string | undefined;
  agenteId?: string | undefined;
  declaracaoId?: string | undefined;
  situacao?: 'ativo' | 'revogado' | undefined;
}

export async function listarVinculos(executor: Executor, filtro: FiltroVinculos): Promise<LinhaVinculo[]> {
  return executor.consultar<LinhaVinculo>(
    `SELECT v.id, v.natureza, v.grau_parentesco, v.fornecedor_id, f.razao_social AS fornecedor_nome, f.tipo_pessoa AS fornecedor_tipo,
            v.outro_fornecedor_id, o.razao_social AS outro_nome, o.tipo_pessoa AS outro_tipo,
            v.agente_id, a.nome AS agente_nome, v.fonte, v.descricao, v.evidencia, v.processo_id, p.numero_sei AS processo_numero,
            v.registrado_por, r.nome AS registrado_por_nome, v.registrado_em, v.situacao, v.motivo_revogacao
       FROM vinculos_licitantes v
       JOIN fornecedores f ON f.id = v.fornecedor_id
       LEFT JOIN fornecedores o ON o.id = v.outro_fornecedor_id
       LEFT JOIN usuarios a ON a.id = v.agente_id
       LEFT JOIN processos p ON p.id = v.processo_id
       LEFT JOIN usuarios r ON r.id = v.registrado_por
      WHERE ($1::uuid IS NULL OR v.id = $1)
        AND ($2::uuid[] IS NULL OR v.fornecedor_id = ANY($2::uuid[]) OR v.outro_fornecedor_id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR v.processo_id = $3)
        AND ($4::uuid IS NULL OR v.agente_id = $4)
        AND ($5::uuid IS NULL OR v.declaracao_id = $5)
        AND ($6::text IS NULL OR v.situacao = $6)
      ORDER BY v.registrado_em DESC, v.id
      LIMIT 500`,
    [
      filtro.id ?? null,
      filtro.fornecedorIds === undefined ? null : [...filtro.fornecedorIds],
      filtro.processoId ?? null,
      filtro.agenteId ?? null,
      filtro.declaracaoId ?? null,
      filtro.situacao ?? null,
    ],
  );
}

export function paraVinculoRegistrado(l: LinhaVinculo): VinculoRegistrado {
  return {
    id: l.id,
    natureza: l.natureza,
    grauParentesco: l.grau_parentesco,
    fornecedor: { id: l.fornecedor_id, nome: nomeExibivel(l.fornecedor_tipo, l.fornecedor_nome) },
    outroFornecedor:
      l.outro_fornecedor_id !== null && l.outro_nome !== null && l.outro_tipo !== null
        ? { id: l.outro_fornecedor_id, nome: nomeExibivel(l.outro_tipo, l.outro_nome) }
        : null,
    agente: usuarioResumo(l.agente_id, l.agente_nome),
    fonte: l.fonte,
    descricao: l.descricao,
    evidencia: l.evidencia,
    processo: l.processo_id !== null && l.processo_numero !== null ? { id: l.processo_id, numeroSei: l.processo_numero } : null,
    registradoPor: usuarioResumo(l.registrado_por, l.registrado_por_nome),
    registradoEm: l.registrado_em,
    situacao: l.situacao,
    motivoRevogacao: l.motivo_revogacao,
  };
}

function paraVinculoInformado(l: LinhaVinculo): VinculoInformado {
  return {
    id: l.id,
    natureza: l.natureza,
    grauParentesco: l.grau_parentesco,
    fornecedorId: l.fornecedor_id,
    outroFornecedorId: l.outro_fornecedor_id,
    agente: l.agente_id !== null && l.agente_nome !== null ? { usuarioId: l.agente_id, nome: l.agente_nome } : null,
    fonte: l.fonte,
    evidencia: l.evidencia,
    descricao: l.descricao,
  };
}

// ───────────────────────── análise (RIA-06 e RIA-10) ─────────────────────────

/** Sanções impeditivas aplicadas e vigentes, com o fornecedor punido, para a detecção de possível sucessão. */
export async function carregarSancionadas(
  executor: Executor,
  hoje: string,
): Promise<{ fornecedor: FornecedorAnalise; sancao: SancaoParaSucessao }[]> {
  const sancoes = await executor.consultar<{ id: string; fornecedor_id: string; tipo: TipoSancao; situacao: SancaoParaSucessao['situacao']; instaurada_em: string; fim_vigencia: string | null }>(
    `SELECT id, fornecedor_id, tipo, situacao, instaurada_em, fim_vigencia FROM sancoes
      WHERE tipo IN ('impedimento_licitar', 'declaracao_inidoneidade') AND situacao = 'aplicada'
        AND (fim_vigencia IS NULL OR fim_vigencia >= $1::date)
      ORDER BY instaurada_em, id`,
    [hoje],
  );
  if (sancoes.length === 0) return [];
  const fornecedores = new Map((await carregarFornecedoresAnalise(executor, [...new Set(sancoes.map((s) => s.fornecedor_id))])).map((f) => [f.id, f]));
  return sancoes.flatMap((s) => {
    const fornecedor = fornecedores.get(s.fornecedor_id);
    return fornecedor
      ? [{ fornecedor, sancao: { id: s.id, tipo: s.tipo, situacao: s.situacao, instauradaEm: s.instaurada_em, fimVigencia: s.fim_vigencia } }]
      : [];
  });
}

function paraSinalContrato(s: ReturnType<typeof sinalizarVinculosLicitantes>['sinais'][number]): SinalVinculo {
  return { ...s, fornecedores: s.fornecedores.map((f) => ({ ...f })), evidencias: s.evidencias.map((e) => ({ ...e })) };
}

/**
 * Análise de vínculos de um conjunto de fornecedores (licitantes de um processo ou escolhidos na tela): RIA-06 e
 * RIA-10 entre eles, vínculos registrados e ativos, agentes da equipe (se houver) e possível sucessão de sancionada.
 */
export async function analisarFornecedores(
  executor: Executor,
  ids: readonly string[],
  opcoes: { agentes?: readonly AgenteParaVinculos[]; hoje: string; agora: Date },
): Promise<AnaliseVinculos> {
  const unicos = [...new Set(ids)];
  const fornecedores = await carregarFornecedoresAnalise(executor, unicos);
  const vinculos = (await listarVinculos(executor, { fornecedorIds: unicos, situacao: 'ativo' })).map(paraVinculoInformado);
  const entreEles = sinalizarVinculosLicitantes({
    licitantes: fornecedores,
    vinculosInformados: vinculos,
    ...(opcoes.agentes ? { agentes: opcoes.agentes } : {}),
  });
  const sucessao = detectarPossivelSucessao({ candidatos: fornecedores, sancionadas: await carregarSancionadas(executor, opcoes.hoje), hoje: opcoes.hoje });
  return {
    licitantes: fornecedores.map((f) => ({ id: f.id, nome: f.nome, documento: mascararDocumento(f.documento), qsaConsultadoEm: f.qsaConsultadoEm })),
    sinais: [...sucessao.sinais, ...entreEles.sinais].map(paraSinalContrato).sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'risco' ? -1 : 1)),
    grupos: entreEles.grupos,
    aviso: entreEles.aviso,
    premissas: entreEles.premissas,
    fundamento: `${entreEles.fundamento}; ${sucessao.fundamento}`,
    analisadoEm: opcoes.agora.toISOString(),
  };
}

/** Possíveis sucessões em todo o cadastro de pessoas jurídicas (painel de vínculos e impedimentos). */
export async function sucessoesNoCadastro(executor: Executor, hoje: string): Promise<SinalVinculo[]> {
  const sancionadas = await carregarSancionadas(executor, hoje);
  if (sancionadas.length === 0) return [];
  const candidatos = (await carregarFornecedoresAnalise(executor, null)).filter((f) => f.tipoPessoa === 'PJ');
  return detectarPossivelSucessao({ candidatos, sancionadas, hoje }).sinais.map(paraSinalContrato);
}

// ───────────────────────── quadro societário ─────────────────────────

export async function quadroSocietario(executor: Executor, fornecedorId: string): Promise<QuadroSocietario | null> {
  const [f] = await executor.consultar<{
    id: string;
    documento: string;
    tipo_pessoa: 'PJ' | 'PF';
    razao_social: string;
    data_abertura: string | null;
    endereco: string | null;
    fonte: string | null;
    modo: 'offline' | 'online' | null;
    consultado_em: string | null;
    hash: string | null;
    registros: number | null;
  }>(
    `SELECT f.id, f.documento, f.tipo_pessoa, f.razao_social, c.data_abertura, c.endereco, c.fonte, c.modo, c.consultado_em, c.hash, c.registros
       FROM fornecedores f LEFT JOIN fornecedores_cadastro_cnpj c ON c.fornecedor_id = f.id
      WHERE f.id = $1`,
    [fornecedorId],
  );
  if (!f) return null;
  const integrantes = await executor.consultar<{ id: string; documento: string; nome: string; qualificacao: IntegranteQuadro['qualificacao']; data_entrada: string | null }>(
    `SELECT id, documento_parcial AS documento, nome, qualificacao, data_entrada FROM fornecedores_qsa WHERE fornecedor_id = $1
     UNION ALL
     SELECT id, cpf AS documento, nome, qualificacao, NULL::date AS data_entrada FROM fornecedores_socios
      WHERE fornecedor_id = $1 AND NOT EXISTS (SELECT 1 FROM fornecedores_qsa q WHERE q.fornecedor_id = $1)
     ORDER BY nome`,
    [fornecedorId],
  );
  const mascarar = (documento: string) =>
    documento.length === 11 ? mascararDocumento(documento) : `***.${documento.slice(0, 3)}.${documento.slice(3, 6)}-**`;
  return {
    fornecedor: { id: f.id, nome: nomeExibivel(f.tipo_pessoa, f.razao_social), documento: mascararDocumento(f.documento) },
    dataAbertura: f.data_abertura,
    endereco: f.endereco,
    integrantes: integrantes.map((i) => ({ id: i.id, nome: mascararNome(i.nome), documento: mascarar(i.documento), qualificacao: i.qualificacao, dataEntrada: i.data_entrada })),
    proveniencia:
      f.consultado_em !== null && f.fonte !== null && f.modo !== null && f.hash !== null
        ? { fonte: f.fonte, modo: f.modo, consultadoEm: f.consultado_em, hash: f.hash, registros: f.registros ?? 0 }
        : null,
  };
}

// ───────────────────────── extensões de sanção ─────────────────────────

interface LinhaExtensao {
  id: string;
  sancao_origem_id: string;
  origem_tipo: TipoSancao;
  origem_fim: string | null;
  origem_fornecedor_id: string;
  origem_fornecedor_nome: string;
  origem_fornecedor_tipo: 'PJ' | 'PF';
  origem_fornecedor_documento: string;
  alvo: ExtensaoSancao['alvo']['tipo'];
  alvo_fornecedor_id: string | null;
  alvo_fornecedor_nome: string | null;
  alvo_fornecedor_tipo: 'PJ' | 'PF' | null;
  alvo_fornecedor_documento: string | null;
  alvo_pessoa_nome: string | null;
  alvo_pessoa_cpf: string | null;
  situacao: ExtensaoSancao['situacao'];
  fundamentacao: string;
  sinal: string | null;
  intimacao_em: string;
  prazo_defesa: string;
  defesa_apresentada: boolean | null;
  defesa_resumo: string | null;
  defesa_registrada_em: string | null;
  parecer_conclusao: 'favoravel' | 'desfavoravel' | null;
  parecer_texto: string | null;
  parecerista_id: string | null;
  parecerista_nome: string | null;
  parecer_em: string | null;
  decisao_resultado: 'estender' | 'nao_estender' | null;
  decisao_motivacao: string | null;
  autoridade_id: string | null;
  autoridade_nome: string | null;
  decidida_em: string | null;
  sancao_estendida_id: string | null;
  arquivamento_motivo: string | null;
  arquivada_em: string | null;
  proposto_por: string;
  proposto_por_nome: string;
  proposta_em: string;
}

export interface FiltroExtensoes {
  id?: string | undefined;
  fornecedorId?: string | undefined;
  /** Escopo de UASG: sanção de origem ligada a contrato segue a UASG do contrato (como em GET /sancoes). */
  escopo: string[] | null;
}

export async function listarExtensoes(executor: Executor, filtro: FiltroExtensoes, bloquear = false): Promise<LinhaExtensao[]> {
  return executor.consultar<LinhaExtensao>(
    `SELECT e.id, e.sancao_origem_id, s.tipo AS origem_tipo, s.fim_vigencia AS origem_fim, s.fornecedor_id AS origem_fornecedor_id,
            fo.razao_social AS origem_fornecedor_nome, fo.tipo_pessoa AS origem_fornecedor_tipo, fo.documento AS origem_fornecedor_documento,
            e.alvo, e.alvo_fornecedor_id, fa.razao_social AS alvo_fornecedor_nome, fa.tipo_pessoa AS alvo_fornecedor_tipo,
            fa.documento AS alvo_fornecedor_documento, e.alvo_pessoa_nome, e.alvo_pessoa_cpf, e.situacao, e.fundamentacao, e.sinal,
            e.intimacao_em, e.prazo_defesa, e.defesa_apresentada, e.defesa_resumo, e.defesa_registrada_em,
            e.parecer_conclusao, e.parecer_texto, e.parecerista_id, up.nome AS parecerista_nome, e.parecer_em,
            e.decisao_resultado, e.decisao_motivacao, e.autoridade_id, ua.nome AS autoridade_nome, e.decidida_em, e.sancao_estendida_id,
            e.arquivamento_motivo, e.arquivada_em, e.proposto_por, ur.nome AS proposto_por_nome, e.proposta_em
       FROM extensoes_sancao e
       JOIN sancoes s ON s.id = e.sancao_origem_id
       LEFT JOIN contratos c ON c.id = s.contrato_id
       JOIN fornecedores fo ON fo.id = s.fornecedor_id
       LEFT JOIN fornecedores fa ON fa.id = e.alvo_fornecedor_id
       LEFT JOIN usuarios up ON up.id = e.parecerista_id
       LEFT JOIN usuarios ua ON ua.id = e.autoridade_id
       JOIN usuarios ur ON ur.id = e.proposto_por
      WHERE ($1::uuid IS NULL OR e.id = $1)
        AND ($2::uuid IS NULL OR s.fornecedor_id = $2 OR e.alvo_fornecedor_id = $2)
        AND ($3::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($3::text[]))
      ORDER BY e.proposta_em DESC, e.id
      LIMIT 200${bloquear ? '\n      FOR UPDATE OF e' : ''}`,
    [filtro.id ?? null, filtro.fornecedorId ?? null, filtro.escopo],
  );
}

export function paraExtensao(l: LinhaExtensao): ExtensaoSancao {
  return {
    id: l.id,
    sancaoOrigem: {
      id: l.sancao_origem_id,
      tipo: l.origem_tipo,
      fornecedor: {
        id: l.origem_fornecedor_id,
        nome: nomeExibivel(l.origem_fornecedor_tipo, l.origem_fornecedor_nome),
        documento: mascararDocumento(l.origem_fornecedor_documento),
      },
      fimVigencia: l.origem_fim,
    },
    alvo: {
      tipo: l.alvo,
      fornecedor:
        l.alvo_fornecedor_id !== null && l.alvo_fornecedor_nome !== null && l.alvo_fornecedor_tipo !== null && l.alvo_fornecedor_documento !== null
          ? {
              id: l.alvo_fornecedor_id,
              nome: nomeExibivel(l.alvo_fornecedor_tipo, l.alvo_fornecedor_nome),
              documento: mascararDocumento(l.alvo_fornecedor_documento),
            }
          : null,
      pessoa:
        l.alvo_pessoa_nome !== null && l.alvo_pessoa_cpf !== null
          ? { nome: mascararNome(l.alvo_pessoa_nome), documento: mascararDocumento(l.alvo_pessoa_cpf) }
          : null,
    },
    situacao: l.situacao,
    fundamentacao: l.fundamentacao,
    sinal: l.sinal,
    intimacaoEm: l.intimacao_em,
    prazoDefesa: l.prazo_defesa,
    defesa:
      l.defesa_apresentada !== null && l.defesa_registrada_em !== null
        ? { apresentada: l.defesa_apresentada, resumo: l.defesa_resumo, registradaEm: l.defesa_registrada_em }
        : null,
    parecer:
      l.parecer_conclusao !== null && l.parecer_texto !== null && l.parecerista_id !== null && l.parecerista_nome !== null && l.parecer_em !== null
        ? { conclusao: l.parecer_conclusao, texto: l.parecer_texto, parecerista: { id: l.parecerista_id, nome: l.parecerista_nome }, registradoEm: l.parecer_em }
        : null,
    decisao:
      l.decisao_resultado !== null && l.decisao_motivacao !== null && l.autoridade_id !== null && l.autoridade_nome !== null && l.decidida_em !== null
        ? {
            resultado: l.decisao_resultado,
            motivacao: l.decisao_motivacao,
            autoridade: { id: l.autoridade_id, nome: l.autoridade_nome },
            decididaEm: l.decidida_em,
            sancaoEstendidaId: l.sancao_estendida_id,
          }
        : null,
    arquivamento: l.arquivamento_motivo !== null && l.arquivada_em !== null ? { motivo: l.arquivamento_motivo, arquivadoEm: l.arquivada_em } : null,
    propostoPor: { id: l.proposto_por, nome: l.proposto_por_nome },
    propostaEm: l.proposta_em,
  };
}
