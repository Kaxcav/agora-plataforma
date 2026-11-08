/**
 * Consultas do sigilo de segurança pública (RN-40). Além da tela de sigilo, servem aos pontos de checagem de outros
 * módulos: transparência pública (editais e contratos), publicação no PNCP e documentos do processo. A vigência é
 * sempre conferida com o "hoje" da aplicação (`classificacaoVigente`): vencido o prazo, a informação fica pública sem
 * nenhuma escrita (LAI, art. 24, § 4º).
 */
import { classificacaoVigente, grauAbrange, situacaoOrcamentoSigiloso, type GrauSigilo, type SituacaoOrcamentoSigiloso } from '@agora/dominio';
import type { AlvoSigilo, AutoridadeClassificadoraSigilo, ClassificacaoSigilo, CredencialAcessoSigilo, DocumentoGerado, HipoteseSigiloLai, TipoSigilo } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { TITULOS_DOCUMENTO_COMPLEMENTARES } from '../preparatorios/constantes.ts';

export type TipoDocumentoSigilo = DocumentoGerado['tipo'];

export const ROTULOS_DOCUMENTO: Record<TipoDocumentoSigilo, string> = {
  dfd: 'Documento de formalização da demanda',
  etp: 'Estudo técnico preliminar',
  matriz_riscos: 'Matriz de riscos',
  nota_tecnica_precos: 'Nota técnica de preços',
  tr: 'Termo de referência',
  edital: 'Edital',
  minuta_contrato: 'Minuta do contrato',
  parecer_checklist: 'Parecer jurídico (lista de verificação)',
  // Peças da fase preparatória (RF-32), com os mesmos títulos do painel de documentos.
  ...TITULOS_DOCUMENTO_COMPLEMENTARES,
};

export interface LinhaClassificacao {
  id: string;
  processo_id: string;
  alvo: AlvoSigilo;
  documento_tipo: TipoDocumentoSigilo | null;
  arquivo_id: string | null;
  contrato_id: string | null;
  tipo: TipoSigilo;
  grau: GrauSigilo | null;
  hipotese: HipoteseSigiloLai | null;
  razoes: string;
  data_producao: string;
  prazo_fim: string | null;
  evento_fim: string | null;
  prazo_limite: string | null;
  autoridade: AutoridadeClassificadoraSigilo | null;
  fundamento: string;
  codigo_indexacao: string;
  situacao: 'vigente' | 'desclassificada' | 'substituida';
  versao: number;
  classificada_em: string;
  classificada_por: string;
  classificada_por_nome: string;
  encerrada_em: string | null;
  motivo_encerramento: string | null;
}

const SELECAO = `
  SELECT s.id, s.processo_id, s.alvo, s.documento_tipo, s.arquivo_id, s.contrato_id, s.tipo, s.grau, s.hipotese, s.razoes,
         s.data_producao, s.prazo_fim, s.evento_fim, s.prazo_limite, s.autoridade, s.fundamento, s.codigo_indexacao, s.situacao,
         s.versao, s.classificada_em, s.classificada_por, u.nome AS classificada_por_nome, s.encerrada_em, s.motivo_encerramento
    FROM sigilo_classificacoes s
    JOIN usuarios u ON u.id = s.classificada_por`;

/** Classificações de um processo (vigentes e, se pedido, o histórico), da mais recente para a mais antiga. */
export async function listarClassificacoes(executor: Executor, processoId: string, incluirEncerradas = false): Promise<LinhaClassificacao[]> {
  return executor.consultar<LinhaClassificacao>(
    `${SELECAO}
      WHERE s.processo_id = $1 AND ($2::boolean OR s.situacao = 'vigente')
      ORDER BY s.classificada_em DESC, s.versao DESC`,
    [processoId, incluirEncerradas],
  );
}

export function vigente(linha: LinhaClassificacao, hoje: string): boolean {
  return classificacaoVigente({ situacao: linha.situacao === 'vigente' ? 'vigente' : 'desclassificada', prazoFim: linha.prazo_fim, prazoLimite: linha.prazo_limite }, hoje);
}

/** Classificações que produzem efeito hoje, por processo. */
export async function vigentesPorProcesso(executor: Executor, processoIds: readonly string[], hoje: string): Promise<Map<string, LinhaClassificacao[]>> {
  const mapa = new Map<string, LinhaClassificacao[]>();
  if (processoIds.length === 0) return mapa;
  const linhas = await executor.consultar<LinhaClassificacao>(`${SELECAO} WHERE s.processo_id = ANY($1::uuid[]) AND s.situacao = 'vigente'`, [[...processoIds]]);
  for (const l of linhas) {
    if (!vigente(l, hoje)) continue;
    const lista = mapa.get(l.processo_id) ?? [];
    lista.push(l);
    mapa.set(l.processo_id, lista);
  }
  return mapa;
}

/** Mais restritiva primeiro: LAI antes do orçamento; entre LAI, o grau maior. */
function maisRestritiva(a: LinhaClassificacao, b: LinhaClassificacao): LinhaClassificacao {
  if (a.tipo !== b.tipo) return a.tipo === 'lai' ? a : b;
  if (a.tipo === 'lai' && a.grau && b.grau) return grauAbrange(a.grau, b.grau) ? a : b;
  return a;
}

export interface AlvoConsulta {
  alvo: AlvoSigilo;
  documentoTipo?: TipoDocumentoSigilo | null;
  arquivoId?: string | null;
  contratoId?: string | null;
}

/**
 * Classificação que vale para o alvo: a própria e a do processo inteiro (que abrange documentos, anexos e contrato);
 * havendo as duas, a mais restritiva.
 */
export function classificacaoAplicavel(vigentes: readonly LinhaClassificacao[], alvo: AlvoConsulta): LinhaClassificacao | null {
  const doProcesso = vigentes.find((c) => c.alvo === 'processo') ?? null;
  const propria =
    alvo.alvo === 'processo'
      ? null
      : (vigentes.find(
          (c) =>
            c.alvo === alvo.alvo &&
            (alvo.alvo !== 'documento' || c.documento_tipo === alvo.documentoTipo) &&
            (alvo.alvo !== 'anexo' || c.arquivo_id === alvo.arquivoId) &&
            (alvo.alvo !== 'contrato' || c.contrato_id === alvo.contratoId),
        ) ?? null);
  if (doProcesso && propria) return maisRestritiva(doProcesso, propria);
  return propria ?? doProcesso;
}

export function mapearClassificacao(l: LinhaClassificacao, hoje: string, comRazoes: boolean): ClassificacaoSigilo {
  const situacao: ClassificacaoSigilo['situacao'] = l.situacao !== 'vigente' ? 'desclassificada' : vigente(l, hoje) ? 'vigente' : 'expirada';
  return {
    id: l.id,
    alvo: l.alvo,
    documentoTipo: l.documento_tipo,
    arquivoId: l.arquivo_id,
    contratoId: l.contrato_id,
    tipo: l.tipo,
    grau: l.grau,
    hipotese: l.hipotese,
    razoes: comRazoes ? l.razoes : 'Restrito a quem tem acesso à informação (credencial no processo ou órgão de controle).',
    dataProducao: l.data_producao,
    prazoFim: l.prazo_fim,
    eventoFim: l.evento_fim,
    prazoLimite: l.prazo_limite,
    autoridade: l.autoridade,
    fundamento: l.fundamento,
    codigoIndexacao: l.codigo_indexacao,
    situacao,
    versao: l.versao,
    classificadaEm: l.classificada_em,
    classificadaPor: { id: l.classificada_por, nome: l.classificada_por_nome },
    desclassificadaEm: l.encerrada_em,
    motivoDesclassificacao: l.motivo_encerramento,
  };
}

// ───────────────────────── orçamento sigiloso (art. 24) ─────────────────────────

export interface MarcosOrcamento {
  orcamentoSigiloso: boolean;
  motivo: string | null;
  criterio: string | null;
  situacao: SituacaoOrcamentoSigiloso;
}

/**
 * Situação do orçamento de cada processo: sigiloso pela decisão da pesquisa de preços (etapa 3) até a conclusão da fase
 * de lances (sessão oficial acompanhada na sala de disputa) ou do julgamento (resultado registrado na etapa 6).
 */
export async function marcosOrcamento(executor: Executor, processoIds: readonly string[]): Promise<Map<string, MarcosOrcamento>> {
  const mapa = new Map<string, MarcosOrcamento>();
  if (processoIds.length === 0) return mapa;
  const linhas = await executor.consultar<{ id: string; sigiloso: boolean; motivo: string | null; criterio: string | null; julgamento: string | null; lances: string | null }>(
    `SELECT p.id,
            COALESCE((p.cesta->>'orcamentoSigiloso')::boolean, false) AS sigiloso,
            p.cesta->>'motivoSigilo' AS motivo,
            p.edital->>'criterioJulgamento' AS criterio,
            CASE WHEN jsonb_typeof(p.disputa->'resultado') = 'object' THEN p.disputa->>'registradaEm' END AS julgamento,
            (SELECT min(s.concluida_em) FROM sessoes_disputa s
              WHERE s.processo_id = p.id AND s.uso = 'acompanhamento' AND s.concluida_em IS NOT NULL) AS lances
       FROM processos p
      WHERE p.id = ANY($1::uuid[])`,
    [[...processoIds]],
  );
  for (const l of linhas) {
    mapa.set(l.id, {
      orcamentoSigiloso: l.sigiloso,
      motivo: l.motivo,
      criterio: l.criterio,
      situacao: situacaoOrcamentoSigiloso({ orcamentoSigiloso: l.sigiloso, faseLancesEncerradaEm: l.lances, julgamentoConcluidoEm: l.julgamento }),
    });
  }
  return mapa;
}

// ───────────────────────── pontos de checagem (transparência e PNCP) ─────────────────────────

export type DocumentoPublicavelSigilo = 'edital' | 'tr' | 'minuta_contrato';

/** Por que a classificação retém o documento fora da transparência e do PNCP; null se não retém. */
export function motivoRetencao(c: LinhaClassificacao | null, orcamentoDivulgado: boolean): string | null {
  if (c === null) return null;
  if (c.tipo === 'orcamento') return orcamentoDivulgado ? null : 'Anexo do orçamento sigiloso até a conclusão da fase de lances ou do julgamento (Lei 14.133/2021, art. 24).';
  const escopo = c.alvo === 'processo' ? 'Processo classificado' : 'Documento classificado';
  return `${escopo} como informação ${c.grau ?? ''} (Lei 14.133/2021, art. 13; Lei 12.527/2011, art. 24).`;
}

/** Documentos de cada processo retidos por sigilo hoje (não aparecem na transparência nem vão ao PNCP), com o motivo. */
export async function documentosRetidos(executor: Executor, processoIds: readonly string[], hoje: string): Promise<Map<string, Map<TipoDocumentoSigilo, string>>> {
  const resultado = new Map<string, Map<TipoDocumentoSigilo, string>>();
  const vigentes = await vigentesPorProcesso(executor, processoIds, hoje);
  if (vigentes.size === 0) return resultado;
  const marcos = await marcosOrcamento(executor, [...vigentes.keys()]);
  for (const [processoId, lista] of vigentes) {
    const divulgado = marcos.get(processoId)?.situacao.divulgavel ?? false;
    const retidos = new Map<TipoDocumentoSigilo, string>();
    for (const tipo of Object.keys(ROTULOS_DOCUMENTO) as TipoDocumentoSigilo[]) {
      const motivo = motivoRetencao(classificacaoAplicavel(lista, { alvo: 'documento', documentoTipo: tipo }), divulgado);
      if (motivo !== null) retidos.set(tipo, motivo);
    }
    if (retidos.size > 0) resultado.set(processoId, retidos);
  }
  return resultado;
}

/** Motivo da retenção de um documento do processo, ou null. */
export async function documentoRetido(executor: Executor, processoId: string, tipo: TipoDocumentoSigilo, hoje: string): Promise<string | null> {
  return (await documentosRetidos(executor, [processoId], hoje)).get(processoId)?.get(tipo) ?? null;
}

/** Classificação vigente do processo inteiro pela LAI (registro mínimo na transparência e bloqueio do PNCP). */
export async function processoClassificado(executor: Executor, processoId: string, hoje: string): Promise<LinhaClassificacao | null> {
  const lista = (await vigentesPorProcesso(executor, [processoId], hoje)).get(processoId) ?? [];
  return lista.find((c) => c.alvo === 'processo') ?? null;
}

/** Contratos sigilosos hoje (art. 91, § 1º): classificação do próprio contrato ou do processo que o gerou. */
export async function contratosSigilosos(executor: Executor, contratoIds: readonly string[], hoje: string): Promise<Map<string, LinhaClassificacao>> {
  const mapa = new Map<string, LinhaClassificacao>();
  if (contratoIds.length === 0) return mapa;
  const vinculos = await executor.consultar<{ processo_id: string; contrato_id: string }>(
    `SELECT id AS processo_id, contrato_id FROM processos WHERE contrato_id = ANY($1::uuid[])
     UNION
     SELECT processo_id, contrato_id FROM sigilo_classificacoes WHERE contrato_id = ANY($1::uuid[]) AND situacao = 'vigente'`,
    [[...contratoIds]],
  );
  if (vinculos.length === 0) return mapa;
  const vigentes = await vigentesPorProcesso(executor, [...new Set(vinculos.map((v) => v.processo_id))], hoje);
  for (const v of vinculos) {
    const c = classificacaoAplicavel(vigentes.get(v.processo_id) ?? [], { alvo: 'contrato', contratoId: v.contrato_id });
    if (c && c.tipo === 'lai') mapa.set(v.contrato_id, c);
  }
  return mapa;
}

// ───────────────────────── credenciais ─────────────────────────

interface LinhaCredencial {
  id: string;
  usuario_id: string;
  usuario_nome: string;
  grau_maximo: GrauSigilo;
  fundamento: 'credencial_seguranca' | 'tcms';
  necessidade: string;
  valida_ate: string | null;
  concedida_em: string;
  concedida_por: string;
  concedida_por_nome: string;
  revogada_em: string | null;
  motivo_revogacao: string | null;
}

export async function listarCredenciais(executor: Executor, processoId: string, usuarioId: string | null = null): Promise<CredencialAcessoSigilo[]> {
  const linhas = await executor.consultar<LinhaCredencial>(
    `SELECT c.id, c.usuario_id, u.nome AS usuario_nome, c.grau_maximo, c.fundamento, c.necessidade, c.valida_ate, c.concedida_em,
            c.concedida_por, p.nome AS concedida_por_nome, c.revogada_em, c.motivo_revogacao
       FROM sigilo_credenciais c
       JOIN usuarios u ON u.id = c.usuario_id
       JOIN usuarios p ON p.id = c.concedida_por
      WHERE c.processo_id = $1 AND ($2::uuid IS NULL OR c.usuario_id = $2)
      ORDER BY (c.revogada_em IS NULL) DESC, c.concedida_em DESC`,
    [processoId, usuarioId],
  );
  return linhas.map((l) => ({
    id: l.id,
    usuario: { id: l.usuario_id, nome: l.usuario_nome },
    grauMaximo: l.grau_maximo,
    fundamento: l.fundamento,
    necessidade: l.necessidade,
    validaAte: l.valida_ate,
    ativa: l.revogada_em === null,
    concedidaEm: l.concedida_em,
    concedidaPor: { id: l.concedida_por, nome: l.concedida_por_nome },
    revogadaEm: l.revogada_em,
    motivoRevogacao: l.motivo_revogacao,
  }));
}

/** Credencial ativa (não revogada) do usuário no processo; a validade é conferida pela decisão de acesso. */
export async function credencialAtiva(executor: Executor, processoId: string, usuarioId: string): Promise<CredencialAcessoSigilo | null> {
  return (await listarCredenciais(executor, processoId, usuarioId)).find((c) => c.ativa) ?? null;
}

/** Anexos do processo cifrados no cofre. */
export async function anexosNoCofre(executor: Executor, arquivoIds: readonly string[]): Promise<Map<string, { sha256Cifrado: string; chaveId: string }>> {
  const mapa = new Map<string, { sha256Cifrado: string; chaveId: string }>();
  if (arquivoIds.length === 0) return mapa;
  const linhas = await executor.consultar<{ arquivo_id: string; sha256_cifrado: string; chave_id: string }>(
    'SELECT arquivo_id, sha256_cifrado, chave_id FROM sigilo_cofre WHERE arquivo_id = ANY($1::uuid[])',
    [[...arquivoIds]],
  );
  for (const l of linhas) mapa.set(l.arquivo_id, { sha256Cifrado: l.sha256_cifrado, chaveId: l.chave_id });
  return mapa;
}

/** O anexo está no cofre (ponto de checagem do download e da leitura de documentos). */
export async function anexoNoCofre(executor: Executor, arquivoId: string): Promise<boolean> {
  return (await anexosNoCofre(executor, [arquivoId])).has(arquivoId);
}
