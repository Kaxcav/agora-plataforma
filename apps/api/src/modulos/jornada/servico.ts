import {
  adicionarDias,
  aplicarDesempate,
  avaliarBloqueioLuxoMinutas,
  dataMinimaAberturaPropostas,
  formatarData,
  prazoDivulgacaoContratoPncp,
  type Licitante,
  type OpcoesCalendario,
  type PapelProcesso,
} from '@agora/dominio';
import type { EtapaJornada, OrgaoRequisitante, UsuarioDesignavel } from '@agora/contratos';
import { ehCodigoPerfil } from '../../autorizacao/perfis.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { inserirEmLote } from '../../banco/lote.ts';
import { adicionarMeses } from '../../compartilhado/instrumentos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { identificadorInstrumento, normalizarBusca } from '../../compartilhado/texto.ts';
import { regraNegocio } from '../../http/erros.ts';
import { ErroIa, restaurarTrechosProtegidos, type ProvedorIa } from '../../ia/provedor.ts';
import { ancorarPromptIa } from '../../ia/ancoragem.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { CONDICOES_REFERENCIA, DOCUMENTOS_SEM_IA, ETAPA_DOCUMENTO, MINIMO_CARACTERES_TEXTO, TITULOS_DOCUMENTO, TITULOS_ETAPA } from './constantes.ts';
import { gerarModelo, marcarAprovado, montarConteudo, montarPromptIa, type Autoria, type DadosDocumento } from './documentos.ts';
import { hashParametrosDocumento } from './parametros-edital.ts';
import { analisarCesta, valorEstimadoProcesso } from './regras.ts';
import { vencedorDoProcesso } from './selecao.ts';
import type {
  CargaProcesso,
  CestaArmazenada,
  DfdProcesso,
  DisputaArmazenada,
  EtpProcesso,
  LicitanteArmazenado,
  LinhaProcesso,
  ParametrosEdital,
  ParecerArmazenado,
  PublicacaoProcesso,
  RiscoProcesso,
  TipoDocumento,
} from './tipos.ts';

export interface ContextoJornada {
  hoje: string;
  agora: Date;
  calendario: OpcoesCalendario;
  /** Política de sustentabilidade do órgão (RN-21); ausente = ligada (padrão). */
  politicaSustentabilidade?: boolean;
}

// ───────────────────────── numeração ─────────────────────────

/** Dígitos verificadores (módulo 11) dos 15 dígitos de um número de processo no padrão NUP. */
export function digitosVerificadoresNup(base: string): string {
  const calcular = (digitos: string): number => {
    const soma = [...digitos].reduce((acc, d, i) => acc + Number(d) * (digitos.length + 1 - i), 0);
    const resto = 11 - (soma % 11);
    return resto >= 10 ? resto - 10 : resto;
  };
  const primeiro = calcular(base);
  const segundo = calcular(`${base}${primeiro}`);
  return `${primeiro}${segundo}`;
}

/** Número SEI sintético `08000.NNNNNN/AAAA-DV` (sequência própria, dígitos verificadores módulo 11). */
async function proximoNumeroSei(tx: Transacao, ano: string): Promise<string> {
  const [linha] = await tx.consultar<{ numero: number }>("SELECT nextval('processos_numero_seq') AS numero");
  const sequencial = String(linha?.numero ?? 0).padStart(6, '0');
  const base = `08000${sequencial}${ano}`;
  return `08000.${sequencial}/${ano}-${digitosVerificadoresNup(base)}`;
}

async function proximoNumeroArvore(tx: Transacao): Promise<string> {
  const [linha] = await tx.consultar<{ numero: number }>("SELECT nextval('processos_arvore_sei_numero_seq') AS numero");
  return String(linha?.numero ?? 0).padStart(8, '0');
}

// ───────────────────────── gravação do processo ─────────────────────────

export interface NovoProcesso {
  id: string;
  titulo: string;
  orgao: OrgaoRequisitante;
  uasg: string;
  responsavelId: string | null;
  etapa: EtapaJornada;
  modalidadePrevista: string | null;
  dfd: DfdProcesso;
  etp: EtpProcesso;
  riscos: RiscoProcesso[];
  cesta: CestaArmazenada;
  edital: ParametrosEdital;
  parecer: ParecerArmazenado;
  publicacao: PublicacaoProcesso;
  disputa: DisputaArmazenada;
  /** Instante ISO de criação (a carga de demonstração usa datas passadas). */
  criadoEm: string;
}

export async function inserirProcesso(tx: Transacao, p: NovoProcesso): Promise<{ id: string; numeroSei: string }> {
  const numeroSei = await proximoNumeroSei(tx, p.criadoEm.slice(0, 4));
  await tx.executar(
    `INSERT INTO processos (id, numero_sei, titulo, orgao, uasg, etapa_atual, responsavel_id, modalidade_prevista, dfd, etp, riscos,
                            cesta, edital, parecer, publicacao, disputa, busca_normalizada, criado_em, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
             $16::jsonb, $17, $18, $18)`,
    [
      p.id,
      numeroSei,
      p.titulo,
      p.orgao,
      p.uasg,
      p.etapa,
      p.responsavelId,
      p.modalidadePrevista,
      JSON.stringify(p.dfd),
      JSON.stringify(p.etp),
      JSON.stringify(p.riscos),
      JSON.stringify(p.cesta),
      JSON.stringify(p.edital),
      JSON.stringify(p.parecer),
      JSON.stringify(p.publicacao),
      JSON.stringify(p.disputa),
      normalizarBusca(numeroSei, p.titulo, p.orgao, p.uasg),
      p.criadoEm,
    ],
  );
  return { id: p.id, numeroSei };
}

/** Colunas jsonb do processo que as rotas atualizam (lista fechada; nunca vem do cliente). */
export type ColunaJson = 'dfd' | 'etp' | 'riscos' | 'cesta' | 'edital' | 'parecer' | 'publicacao' | 'disputa' | 'selecao' | 'sustentabilidade';
const COLUNAS_JSON: ReadonlySet<ColunaJson> = new Set<ColunaJson>([
  'dfd',
  'etp',
  'riscos',
  'cesta',
  'edital',
  'parecer',
  'publicacao',
  'disputa',
  'selecao',
  'sustentabilidade',
]);

export async function gravarJson(tx: Transacao, processoId: string, coluna: ColunaJson, valor: unknown, agora: Date): Promise<void> {
  if (!COLUNAS_JSON.has(coluna)) throw new Error(`Coluna não permitida: ${coluna}`);
  await tx.executar(`UPDATE processos SET ${coluna} = $2::jsonb, atualizado_em = $3 WHERE id = $1`, [
    processoId,
    JSON.stringify(valor),
    agora.toISOString(),
  ]);
}

export async function definirModalidade(tx: Transacao, processoId: string, modalidade: string): Promise<void> {
  await tx.executar('UPDATE processos SET modalidade_prevista = $2 WHERE id = $1 AND modalidade_prevista IS NULL', [processoId, modalidade]);
}

export async function avancarEtapa(tx: Transacao, processoId: string, etapa: EtapaJornada, agora: Date): Promise<void> {
  await tx.executar('UPDATE processos SET etapa_atual = $2, atualizado_em = $3 WHERE id = $1', [processoId, etapa, agora.toISOString()]);
}

export async function gravarEquipe(
  tx: Transacao,
  processoId: string,
  designacoes: readonly { papel: PapelProcesso; usuarioId: string }[],
  agora: Date,
): Promise<void> {
  await tx.executar('DELETE FROM processos_equipe WHERE processo_id = $1', [processoId]);
  const unicas = new Map(designacoes.map((d) => [`${d.papel}|${d.usuarioId}`, d]));
  await inserirEmLote(
    tx,
    'processos_equipe',
    ['processo_id', 'papel', 'usuario_id', 'designado_em'],
    [...unicas.values()].map((d) => [processoId, d.papel, d.usuarioId, agora.toISOString()]),
  );
  await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [processoId, agora.toISOString()]);
}

/**
 * Usuários ativos no escopo de UASG de quem designa (`$1` nulo = todas): com acesso a todas as UASGs, a alguma
 * UASG do escopo, ou administradores/auditores sem UASG explícita (escopo total por perfil). O perfil cidadão
 * (gestão compartilhada com a sociedade) não é agente público e nunca é designável.
 */
const CONDICAO_DESIGNAVEL = `u.ativo AND NOT EXISTS (SELECT 1 FROM usuarios_perfis pc WHERE pc.usuario_id = u.id AND pc.perfil = 'cidadao')
     AND ($1::text[] IS NULL OR u.todas_uasgs
     OR EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = ANY($1::text[]))
     OR (NOT EXISTS (SELECT 1 FROM usuarios_uasgs ux WHERE ux.usuario_id = u.id)
         AND EXISTS (SELECT 1 FROM usuarios_perfis px WHERE px.usuario_id = u.id AND px.perfil IN ('administrador', 'auditor'))))`;

/** GET /processos/designaveis: servidores ativos no escopo, sem e-mail nem CPF. */
export async function listarDesignaveis(executor: Executor, escopo: string[] | null): Promise<UsuarioDesignavel[]> {
  const linhas = await executor.consultar<{ id: string; nome: string; unidade_sigla: string | null; perfis: string[] }>(
    `SELECT u.id, u.nome, ui.sigla AS unidade_sigla,
            COALESCE((SELECT array_agg(up.perfil ORDER BY up.perfil) FROM usuarios_perfis up WHERE up.usuario_id = u.id), '{}') AS perfis
       FROM usuarios u
       LEFT JOIN unidades_internas ui ON ui.id = u.unidade_interna_id
      WHERE ${CONDICAO_DESIGNAVEL}`,
    [escopo],
  );
  return linhas
    .map((l) => ({ id: l.id, nome: l.nome, perfis: l.perfis.filter(ehCodigoPerfil), unidadeInterna: l.unidade_sigla }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Designáveis entre os ids informados (nome e CPF, para a verificação de segregação e de vínculo societário). */
export async function carregarDesignaveis(
  executor: Executor,
  ids: readonly string[],
  escopo: string[] | null,
): Promise<Map<string, { nome: string; cpf: string }>> {
  if (ids.length === 0) return new Map();
  const linhas = await executor.consultar<{ id: string; nome: string; cpf: string }>(
    `SELECT u.id, u.nome, u.cpf FROM usuarios u WHERE ${CONDICAO_DESIGNAVEL} AND u.id = ANY($2::uuid[])`,
    [escopo, [...new Set(ids)]],
  );
  return new Map(linhas.map((l) => [l.id, { nome: l.nome, cpf: l.cpf }]));
}

// ───────────────────────── regras de etapa das ações ─────────────────────────

/** Ação permitida somente até a etapa indicada (dados de etapa já concluída ficam travados). */
export function exigirEtapaAte(linha: LinhaProcesso, etapa: EtapaJornada, oQue: string): void {
  if (linha.etapa_atual > etapa) {
    throw regraNegocio(`${oQue} pertence à etapa ${etapa} (${TITULOS_ETAPA[etapa]}), já concluída neste processo.`);
  }
}

/** Ação própria de uma etapa. */
export function exigirEtapa(linha: LinhaProcesso, etapa: EtapaJornada, oQue: string): void {
  if (linha.etapa_atual !== etapa) {
    throw regraNegocio(`${oQue} só é possível na etapa ${etapa} (${TITULOS_ETAPA[etapa]}); o processo está na etapa ${linha.etapa_atual}.`);
  }
}

export function exigirEtapaDocumento(linha: LinhaProcesso, tipo: TipoDocumento): void {
  exigirEtapaAte(linha, ETAPA_DOCUMENTO[tipo], `O documento "${TITULOS_DOCUMENTO[tipo]}"`);
}

// ───────────────────────── documentos ─────────────────────────

export interface DocumentoPreparado {
  tipo: TipoDocumento;
  titulo: string;
  conteudo: string;
  geradoPor: 'modelo' | 'ia';
  modeloIa: string | null;
  falhaIa: string | null;
  premissas: string[];
  fontes: string[];
  /** Hash dos parâmetros do edital usados na geração (TR, edital e minuta); `null` para os demais. */
  hashParametros: string | null;
}

function descreverFalhaIa(erro: unknown): string {
  if (erro instanceof ErroIa) return erro.message;
  if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) return 'tempo de resposta do provedor de IA excedido';
  return 'provedor de IA indisponível';
}

export function dadosDocumento(carga: CargaProcesso, ctx: ContextoJornada): DadosDocumento {
  const analise = analisarCesta(carga.linha.cesta, ctx.hoje);
  return {
    carga,
    analise,
    valorEstimado: valorEstimadoProcesso(carga.linha.dfd, analise),
    dataGeracao: ctx.hoje,
    calendario: ctx.calendario,
    politicaSustentabilidade: ctx.politicaSustentabilidade ?? true,
  };
}

/**
 * Trava do roteiro PoC-01 (RN-01, art. 20): com item do DFD com indício de artigo de luxo sem justificativa aceita,
 * nenhuma minuta é gerada — a verificação acontece antes de qualquer chamada ao provedor de IA.
 */
export function exigirSemArtigoLuxoPendente(linha: Pick<LinhaProcesso, 'dfd'>): void {
  const avaliacao = avaliarBloqueioLuxoMinutas(linha.dfd.itens, linha.dfd.justificativaArtigoLuxo, MINIMO_CARACTERES_TEXTO);
  if (avaliacao.bloqueado) {
    throw regraNegocio(avaliacao.mensagem, [{ campo: 'RN-01', mensagem: `${avaliacao.mensagem} (${avaliacao.fundamento})` }]);
  }
}

/**
 * Redige o documento: modelo de texto determinístico como base e, com IA habilitada, redação assistida.
 * Seções protegidas voltam sempre do modelo; em falha da IA, fica o modelo e registra-se a falha (vira sinal).
 * Chamado fora de transação (a IA pode levar até 60 s).
 */
export async function prepararDocumento(
  carga: CargaProcesso,
  tipo: TipoDocumento,
  provedor: ProvedorIa,
  ctx: ContextoJornada,
): Promise<DocumentoPreparado> {
  exigirSemArtigoLuxoPendente(carga.linha);
  const dados = dadosDocumento(carga, ctx);
  const modelo = gerarModelo(tipo, dados);
  let corpo = modelo.corpo;
  let autoria: Autoria = { geradoPor: 'modelo', modeloIa: null };
  let falhaIa: string | null = null;
  if (!DOCUMENTOS_SEM_IA.has(tipo)) {
    try {
      const prompt = montarPromptIa(tipo, modelo, dados);
      // RAG (RIA-14): com o LLM do órgão, o prompt leva os dispositivos da base normativa e a estrutura do modelo padronizado.
      const ancorado = provedor.tipo === 'nenhum' ? prompt : ancorarPromptIa(prompt, { tipo, corpo: modelo.corpo, fontes: modelo.fontes, objeto: carga.linha.titulo });
      const resposta = await provedor.gerar(ancorado, {
        modeloBase: modelo.corpo,
        finalidade: modelo.titulo,
        fontes: modelo.fontes,
      });
      corpo = restaurarTrechosProtegidos(resposta.texto, modelo.corpo);
      if (provedor.tipo === 'openai_compativel') autoria = { geradoPor: 'ia', modeloIa: resposta.modelo };
    } catch (erro: unknown) {
      corpo = modelo.corpo;
      falhaIa = descreverFalhaIa(erro);
    }
  }
  return {
    tipo,
    titulo: modelo.titulo,
    conteudo: montarConteudo(modelo, corpo, dados, autoria),
    geradoPor: autoria.geradoPor,
    modeloIa: autoria.modeloIa,
    falhaIa,
    premissas: modelo.premissas,
    fontes: modelo.fontes,
    hashParametros: hashParametrosDocumento(tipo, carga.linha.edital),
  };
}

export async function inserirDocumento(
  tx: Transacao,
  processoId: string,
  doc: DocumentoPreparado,
  meta: { id: string; geradoEm: string; usuarioId: string | null },
): Promise<{ id: string; versao: number; hash: string }> {
  const [ultima] = await tx.consultar<{ versao: number }>(
    'SELECT COALESCE(MAX(versao), 0)::integer AS versao FROM documentos_gerados WHERE processo_id = $1 AND tipo = $2',
    [processoId, doc.tipo],
  );
  const versao = (ultima?.versao ?? 0) + 1;
  const hash = sha256Hex(doc.conteudo);
  await tx.executar(
    `INSERT INTO documentos_gerados (id, processo_id, tipo, titulo, versao, conteudo, hash_conteudo, gerado_por, modelo_ia, falha_ia,
                                     premissas, fontes, situacao, gerado_em, gerado_por_usuario, hash_parametros)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'rascunho', $13, $14, $15)`,
    [
      meta.id,
      processoId,
      doc.tipo,
      doc.titulo,
      versao,
      doc.conteudo,
      hash,
      doc.geradoPor,
      doc.modeloIa,
      doc.falhaIa,
      JSON.stringify(doc.premissas),
      JSON.stringify(doc.fontes),
      meta.geradoEm,
      meta.usuarioId,
      doc.hashParametros,
    ],
  );
  await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [processoId, meta.geradoEm]);
  return { id: meta.id, versao, hash };
}

interface DocumentoParaAprovar {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  versao: number;
  conteudo: string;
  situacao: 'rascunho' | 'revisado' | 'aprovado';
  mais_recente: boolean;
  hash_parametros: string | null;
}

export async function obterDocumentoParaAprovar(tx: Transacao, processoId: string, documentoId: string): Promise<DocumentoParaAprovar | null> {
  const [doc] = await tx.consultar<DocumentoParaAprovar>(
    `SELECT d.id, d.tipo, d.titulo, d.versao, d.conteudo, d.situacao, d.hash_parametros,
            d.versao = (SELECT MAX(x.versao) FROM documentos_gerados x WHERE x.processo_id = d.processo_id AND x.tipo = d.tipo) AS mais_recente
       FROM documentos_gerados d
      WHERE d.id = $1 AND d.processo_id = $2
      FOR UPDATE`,
    [documentoId, processoId],
  );
  return doc ?? null;
}

/**
 * Aprova o documento (revisão humana), troca a marca de rascunho pela anotação de aprovação e o inclui na árvore
 * SEI simulada com número sequencial.
 */
export async function aprovarDocumento(
  tx: Transacao,
  processoId: string,
  doc: DocumentoParaAprovar,
  revisor: { id: string; nome: string },
  agora: Date,
  hoje: string,
  idArvore: string,
): Promise<{ numeroSei: string; hash: string }> {
  if (!doc.mais_recente) throw regraNegocio(`A versão ${doc.versao} de "${doc.titulo}" foi substituída por versão mais recente.`);
  if (doc.situacao === 'aprovado') throw regraNegocio(`A versão ${doc.versao} de "${doc.titulo}" já está aprovada.`);
  const conteudo = marcarAprovado(doc.conteudo, revisor.nome, hoje);
  const hash = sha256Hex(conteudo);
  await tx.executar(
    `UPDATE documentos_gerados SET situacao = 'aprovado', revisado_por = $2, revisado_em = $3, conteudo = $4, hash_conteudo = $5
      WHERE id = $1`,
    [doc.id, revisor.id, agora.toISOString(), conteudo, hash],
  );
  const numeroSei = await proximoNumeroArvore(tx);
  await tx.executar(
    `INSERT INTO processos_arvore_sei (id, processo_id, numero, titulo, documento_id, incluido_em)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [idArvore, processoId, numeroSei, `${doc.titulo} — versão ${doc.versao}`, doc.id, agora.toISOString()],
  );
  await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [processoId, agora.toISOString()]);
  return { numeroSei, hash };
}

/** Assinatura simulada na árvore SEI (a assinatura ICP-Brasil real depende da API do SEI do órgão). */
export async function assinarNaArvore(
  tx: Transacao,
  processoId: string,
  numero: string,
  usuarioId: string,
  agora: Date,
): Promise<{ titulo: string; tipo: TipoDocumento | null }> {
  const [entrada] = await tx.consultar<{ titulo: string; assinado_em: string | null; tipo: TipoDocumento | null }>(
    `SELECT a.titulo, a.assinado_em, d.tipo
       FROM processos_arvore_sei a
       LEFT JOIN documentos_gerados d ON d.id = a.documento_id
      WHERE a.processo_id = $1 AND a.numero = $2
      FOR UPDATE OF a`,
    [processoId, numero],
  );
  if (!entrada) throw regraNegocio(`O documento SEI nº ${numero} não está na árvore deste processo.`);
  if (entrada.assinado_em !== null) throw regraNegocio(`O documento SEI nº ${numero} já está assinado.`);
  await tx.executar('UPDATE processos_arvore_sei SET assinado_em = $3, assinado_por = $4 WHERE processo_id = $1 AND numero = $2', [
    processoId,
    numero,
    agora.toISOString(),
    usuarioId,
  ]);
  await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [processoId, agora.toISOString()]);
  return { titulo: entrada.titulo, tipo: entrada.tipo };
}

/** Tipo do documento ligado a um número da árvore (para decidir a permissão de assinatura). */
export async function tipoDocumentoDaArvore(executor: Executor, processoId: string, numero: string): Promise<TipoDocumento | null> {
  const [linha] = await executor.consultar<{ tipo: TipoDocumento | null }>(
    `SELECT d.tipo FROM processos_arvore_sei a LEFT JOIN documentos_gerados d ON d.id = a.documento_id
      WHERE a.processo_id = $1 AND a.numero = $2`,
    [processoId, numero],
  );
  return linha?.tipo ?? null;
}

// ───────────────────────── publicação ─────────────────────────

/**
 * Fila de publicação offline (PNCP e DOU): a integração simulada processa a fila na hora e registra a data
 * mínima de abertura das propostas por `dataMinimaAberturaPropostas` (art. 55, contado na forma do art. 183).
 */
export function publicarOffline(linha: LinhaProcesso, cnpjOrgao: string, ctx: ContextoJornada): { publicacao: PublicacaoProcesso; diasUteis: number; fundamento: string } {
  const prazo = dataMinimaAberturaPropostas(
    ctx.hoje,
    { objeto: linha.dfd.tipoObjeto, criterio: linha.edital.criterioJulgamento, regime: linha.edital.regimeExecucao },
    ctx.calendario,
  );
  const ano = ctx.hoje.slice(0, 4);
  const sequencial = linha.numero_sei.slice(6, 12);
  return {
    publicacao: {
      pncp: 'publicado',
      dou: 'publicado',
      publicadoEm: ctx.hoje,
      dataMinimaPropostas: prazo.data,
      idPncp: `${cnpjOrgao}-1-${sequencial}/${ano}`,
    },
    diasUteis: prazo.diasUteis,
    fundamento: prazo.fundamento,
  };
}

/** CNPJ do órgão para identificadores PNCP simulados: configuração ou o já usado nos instrumentos sincronizados. */
export async function cnpjDoOrgao(executor: Executor, configurado: string | null): Promise<string> {
  if (configurado) return configurado;
  const [linha] = await executor.consultar<{ cnpj: string }>(
    "SELECT substring(id_pncp from 1 for 14) AS cnpj FROM atas WHERE id_pncp ~ '^[0-9]{14}-' ORDER BY criada_em, id_pncp LIMIT 1",
  );
  return linha?.cnpj ?? '00000000000000';
}

// ───────────────────────── disputa ─────────────────────────

export interface EntradaLicitante {
  id: string;
  valorProposta: number;
  notaDesempenhoPrevio?: number | null | undefined;
  lanceDisputaFinal?: number | undefined;
  acoesEquidadeGenero?: boolean | undefined;
  programaIntegridade?: boolean | undefined;
  empresaBrasileira?: boolean | undefined;
  investePesquisaDesenvolvimentoNoPais?: boolean | undefined;
  praticaMitigacaoClimatica?: boolean | undefined;
}

/** Monta a disputa com nome e porte do cadastro e calcula a classificação e o desempate (art. 60) por `aplicarDesempate`. */
export async function montarDisputa(executor: Executor, entrada: readonly EntradaLicitante[], agora: Date): Promise<DisputaArmazenada> {
  const ids = entrada.map((l) => l.id);
  if (new Set(ids).size !== ids.length) throw regraNegocio('Cada fornecedor pode constar uma única vez na disputa.');
  const fornecedores = await executor.consultar<{ id: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string; porte: 'ME' | 'EPP' | 'DEMAIS' | null }>(
    'SELECT id, tipo_pessoa, razao_social, porte FROM fornecedores WHERE id = ANY($1::uuid[])',
    [ids],
  );
  const porId = new Map(fornecedores.map((f) => [f.id, f]));
  const faltantes = ids.filter((id) => !porId.has(id));
  if (faltantes.length > 0) {
    throw regraNegocio('Há licitantes que não constam do cadastro de fornecedores.', faltantes.map((id) => ({ campo: 'licitantes', mensagem: `Fornecedor ${id} não cadastrado` })));
  }
  const licitantes: LicitanteArmazenado[] = entrada.map((l) => {
    const f = porId.get(l.id);
    if (!f) throw regraNegocio('Fornecedor não cadastrado.');
    return {
      fornecedorId: l.id,
      nome: nomeExibivel(f.tipo_pessoa, f.razao_social),
      meEpp: f.porte === 'ME' || f.porte === 'EPP',
      valorProposta: l.valorProposta,
      ...(l.lanceDisputaFinal !== undefined ? { lanceDisputaFinal: l.lanceDisputaFinal } : {}),
      ...(l.notaDesempenhoPrevio !== undefined && l.notaDesempenhoPrevio !== null ? { notaDesempenhoPrevio: l.notaDesempenhoPrevio } : {}),
      ...(l.acoesEquidadeGenero !== undefined ? { acoesEquidadeGenero: l.acoesEquidadeGenero } : {}),
      ...(l.programaIntegridade !== undefined ? { programaIntegridade: l.programaIntegridade } : {}),
      ...(l.empresaBrasileira !== undefined ? { empresaBrasileira: l.empresaBrasileira } : {}),
      ...(l.investePesquisaDesenvolvimentoNoPais !== undefined ? { investePesquisaDesenvolvimentoNoPais: l.investePesquisaDesenvolvimentoNoPais } : {}),
      ...(l.praticaMitigacaoClimatica !== undefined ? { praticaMitigacaoClimatica: l.praticaMitigacaoClimatica } : {}),
    };
  });
  const paraDominio: Licitante[] = licitantes.map(({ fornecedorId, ...resto }) => ({ id: fornecedorId, ...resto }));
  return { licitantes, resultado: aplicarDesempate(paraDominio, { empateFictoMeEpp: true }), registradaEm: agora.toISOString() };
}

// ───────────────────────── contratação (etapa 7) ─────────────────────────

interface TarefaModelo {
  modelo_id: string;
  titulo: string;
  macrotarefa: string;
  dias_relativos: number;
  papel_responsavel: 'gestor' | 'fiscal' | 'financeiro';
}

export interface ContratoCriado {
  id: string;
  numero: string;
  fornecedorId: string;
  valorInicial: number;
  tarefas: number;
  limiteDivulgacao: string;
}

/**
 * Cria o contrato na carteira a partir do processo (RN-09 já verificada pelo chamador): itens do DFD com preços
 * proporcionais à proposta vencedora, tarefas do modelo de gestão "assinatura" e pendência de divulgação no PNCP.
 */
export async function criarContratoDoProcesso(
  tx: Transacao,
  carga: CargaProcesso,
  ctx: ContextoJornada,
  novoId: () => string,
): Promise<ContratoCriado> {
  const { linha } = carga;
  const vencedorId = vencedorDoProcesso(linha);
  const vencedor = linha.disputa.licitantes.find((l) => l.fornecedorId === vencedorId);
  if (!vencedorId || !vencedor) throw regraNegocio('Não há licitante vencedor registrado na disputa.');
  const [fornecedor] = await tx.consultar<{ documento: string; tipo_pessoa: 'PJ' | 'PF'; razao_social: string }>(
    'SELECT documento, tipo_pessoa, razao_social FROM fornecedores WHERE id = $1',
    [vencedorId],
  );
  if (!fornecedor) throw regraNegocio('O fornecedor vencedor não consta do cadastro.');

  const ano = ctx.hoje.slice(0, 4);
  const [sequencia] = await tx.consultar<{ proximo: number }>(
    `SELECT COALESCE(MAX(split_part(numero, '/', 1)::integer), 0)::integer + 1 AS proximo
       FROM contratos WHERE uasg = $1 AND ano = $2 AND numero ~ '^[0-9]+/[0-9]{4}$'`,
    [linha.uasg, Number(ano)],
  );
  const numero = `${sequencia?.proximo ?? 1}/${ano}`;

  const analise = analisarCesta(linha.cesta, ctx.hoje);
  const referencia = linha.dfd.itens.map((item, indice) => (indice === 0 && analise ? analise.valorEstimado : item.valorUnitarioEstimado));
  const totalReferencia = linha.dfd.itens.reduce((s, item, i) => s + item.quantidade * (referencia[i] ?? 0), 0);
  const fator = totalReferencia > 0 ? vencedor.valorProposta / totalReferencia : 1;
  const itens = linha.dfd.itens.map((item, i) => ({
    id: novoId(),
    numero: i + 1,
    descricao: item.descricao,
    unidade: item.unidade,
    quantidade: item.quantidade,
    valorUnitario: Math.round((referencia[i] ?? 0) * fator),
  }));
  const valorInicial = itens.length > 0 ? itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0) : vencedor.valorProposta;

  const gestorId = carga.equipe.find((m) => m.papel === 'gestor_contrato')?.usuarioId ?? null;
  const fiscalId = carga.equipe.find((m) => m.papel === 'fiscal_tecnico' || m.papel === 'fiscal_administrativo')?.usuarioId ?? null;
  const id = novoId();
  const vigenciaFim = adicionarDias(adicionarMeses(ctx.hoje, CONDICOES_REFERENCIA.vigenciaMeses), -1);
  const modalidade = linha.modalidade_prevista ?? 'Pregão eletrônico';
  const busca = normalizarBusca(numero, linha.titulo, linha.numero_sei, linha.uasg, fornecedor.tipo_pessoa === 'PJ' ? `${fornecedor.razao_social} ${fornecedor.documento}` : '');
  await tx.executar(
    `INSERT INTO contratos (id, numero, ano, uasg, fornecedor_id, ata_id, objeto, processo_sei, origem, modalidade, assinatura_em,
                            divulgacao_pncp_em, vigencia_inicio, vigencia_fim, valor_inicial, gestor_id, fiscal_id, id_pncp,
                            indice_reajuste, data_base_reajuste, fonte_recurso, fonte_dados, busca_normalizada)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'licitacao', $8, $9, NULL, $9, $10, $11, $12, $13, NULL, 'IPCA', $14, '1000', 'AGORA', $15)`,
    [
      id,
      numero,
      Number(ano),
      linha.uasg,
      vencedorId,
      linha.titulo,
      linha.numero_sei,
      modalidade,
      ctx.hoje,
      vigenciaFim,
      valorInicial,
      gestorId,
      fiscalId,
      linha.publicacao.publicadoEm ?? ctx.hoje,
      busca,
    ],
  );
  await inserirEmLote(
    tx,
    'itens_contrato',
    ['id', 'contrato_id', 'item_ata_id', 'numero', 'descricao', 'unidade_fornecimento', 'quantidade', 'valor_unitario', 'quantidade_recebida'],
    itens.map((i) => [i.id, id, null, i.numero, i.descricao, i.unidade, i.quantidade, i.valorUnitario, 0]),
  );

  // Tarefas do plano de gestão "assinatura" (modelos ativos de contrato).
  const tarefasModelo = await tx.consultar<TarefaModelo>(
    `SELECT t.modelo_id, t.titulo, t.macrotarefa, t.dias_relativos, t.papel_responsavel
       FROM modelos_gestao_tarefas t
       JOIN modelos_gestao m ON m.id = t.modelo_id
      WHERE m.tipo = 'contrato' AND m.evento = 'assinatura' AND m.ativo
      ORDER BY m.nome, t.ordem`,
  );
  const [financeiro] = await tx.consultar<{ id: string }>(
    `SELECT u.id FROM usuarios u
       JOIN usuarios_perfis p ON p.usuario_id = u.id AND p.perfil = 'financeiro'
      WHERE u.ativo AND (u.todas_uasgs OR EXISTS (SELECT 1 FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id AND uu.uasg = $1))
      ORDER BY u.nome LIMIT 1`,
    [linha.uasg],
  );
  const responsavel = (papel: TarefaModelo['papel_responsavel']) => (papel === 'gestor' ? gestorId : papel === 'fiscal' ? fiscalId : (financeiro?.id ?? null));
  await inserirEmLote(
    tx,
    'tarefas',
    ['id', 'instrumento_tipo', 'instrumento_id', 'uasg', 'modelo_id', 'titulo', 'macrotarefa', 'prazo', 'situacao', 'responsavel_id'],
    tarefasModelo.map((t) => [novoId(), 'contrato', id, linha.uasg, t.modelo_id, t.titulo, t.macrotarefa, adicionarDias(ctx.hoje, t.dias_relativos), 'pendente', responsavel(t.papel_responsavel)]),
  );

  // Divulgação no PNCP pendente (art. 94): condição de eficácia, com prazo de 20 dias úteis.
  const divulgacao = prazoDivulgacaoContratoPncp(ctx.hoje, 'licitacao', ctx.calendario);
  const motivo = `Divulgar o contrato no PNCP até ${formatarData(divulgacao.limite)} — condição de eficácia (art. 94, I)`;
  await tx.executar(
    `INSERT INTO pendencias (id, tipo, prioridade, instrumento_tipo, instrumento_id, uasg, motivo, prazo, responsavel_id, busca_normalizada)
     VALUES ($1, 'divulgacao_pncp', 'alta', 'contrato', $2, $3, $4, $5, $6, $7)`,
    [
      novoId(),
      id,
      linha.uasg,
      motivo,
      divulgacao.limite,
      gestorId,
      normalizarBusca(motivo, linha.titulo, identificadorInstrumento('contrato', numero), nomeExibivel(fornecedor.tipo_pessoa, fornecedor.razao_social), linha.uasg),
    ],
  );
  await tx.executar('UPDATE processos SET contrato_id = $2, atualizado_em = $3 WHERE id = $1', [linha.id, id, ctx.agora.toISOString()]);
  return { id, numero, fornecedorId: vencedorId, valorInicial, tarefas: tarefasModelo.length, limiteDivulgacao: divulgacao.limite };
}
