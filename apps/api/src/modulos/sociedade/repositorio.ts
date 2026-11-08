/**
 * Leitura da gestão compartilhada com a sociedade (RF-37): visão pública (só o publicado, autor com primeiro nome e
 * iniciais, textos tarjados), visão da moderação e da Administração (escopo de UASG) e visão do próprio cidadão.
 */
import {
  hojeISO,
  nomePublicoCidadao,
  situacaoPrazoResposta,
  type DataISO,
} from '@agora/dominio';
import type {
  AssuntoManifestacao,
  ConclusaoRelatorioFinal,
  FormatoMidiaSociedade,
  ManifestacaoModeracao,
  ManifestacaoPublica,
  MinhaManifestacao,
  RegistroExecucaoInterno,
  RegistroExecucaoPublico,
  RelatorioFinalPublico,
  RespostaManifestacao,
  SituacaoManifestacao,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';

export interface LinhaContratoSociedade {
  id: string;
  numero: string;
  uasg: string;
  objeto: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  gestor_id: string | null;
  fiscal_id: string | null;
  fornecedor_tipo: 'PJ' | 'PF';
  fornecedor_nome: string;
}

export async function obterContratoSociedade(executor: Executor, id: string, escopo: string[] | null): Promise<LinhaContratoSociedade | null> {
  const [linha] = await executor.consultar<LinhaContratoSociedade>(
    `SELECT c.id, c.numero, c.uasg, c.objeto, c.vigencia_inicio, c.vigencia_fim, c.gestor_id, c.fiscal_id,
            f.tipo_pessoa AS fornecedor_tipo, f.razao_social AS fornecedor_nome
       FROM contratos c
       JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  return linha ?? null;
}

export interface LinhaManifestacao {
  id: string;
  contrato_id: string;
  contrato_numero: string;
  contrato_uasg: string;
  contrato_objeto: string;
  autor_id: string;
  autor_nome: string;
  assunto: AssuntoManifestacao;
  texto: string;
  texto_publico: string;
  dados_pessoais_tarjados: boolean;
  imagem_sha256: string | null;
  imagem_formato: 'jpeg' | 'png' | null;
  metadados_removidos: string[];
  situacao: SituacaoManifestacao;
  motivo_moderacao: string | null;
  moderada_por_nome: string | null;
  moderada_em: string | null;
  recebida_em: string;
  prazo_resposta: string;
}

const SELECAO_MANIFESTACAO = `
  SELECT m.id, m.contrato_id, c.numero AS contrato_numero, c.uasg AS contrato_uasg, c.objeto AS contrato_objeto,
         m.autor_id, ua.nome AS autor_nome, m.assunto, m.texto, m.texto_publico, m.dados_pessoais_tarjados,
         m.imagem_sha256, m.imagem_formato, m.metadados_removidos, m.situacao, m.motivo_moderacao,
         um.nome AS moderada_por_nome, m.moderada_em, m.recebida_em, m.prazo_resposta
    FROM sociedade_manifestacoes m
    JOIN contratos c ON c.id = m.contrato_id
    JOIN usuarios ua ON ua.id = m.autor_id
    LEFT JOIN usuarios um ON um.id = m.moderada_por`;

interface LinhaResposta {
  id: string;
  manifestacao_id: string;
  origem: 'administracao' | 'contratado';
  texto_publico: string;
  funcao: string;
  representante: string | null;
  registrada_por_nome: string;
  fornecedor_tipo: 'PJ' | 'PF';
  fornecedor_nome: string;
  respondida_em: string;
}

async function respostasDe(executor: Executor, manifestacaoIds: readonly string[]): Promise<Map<string, LinhaResposta[]>> {
  const mapa = new Map<string, LinhaResposta[]>();
  if (manifestacaoIds.length === 0) return mapa;
  const linhas = await executor.consultar<LinhaResposta>(
    `SELECT r.id, r.manifestacao_id, r.origem, r.texto_publico, r.funcao, r.representante, u.nome AS registrada_por_nome,
            f.tipo_pessoa AS fornecedor_tipo, f.razao_social AS fornecedor_nome, r.respondida_em
       FROM sociedade_respostas r
       JOIN sociedade_manifestacoes m ON m.id = r.manifestacao_id
       JOIN contratos c ON c.id = m.contrato_id
       JOIN fornecedores f ON f.id = c.fornecedor_id
       JOIN usuarios u ON u.id = r.registrada_por
      WHERE r.manifestacao_id = ANY($1::uuid[])
      ORDER BY r.respondida_em, r.id`,
    [manifestacaoIds],
  );
  for (const l of linhas) mapa.set(l.manifestacao_id, [...(mapa.get(l.manifestacao_id) ?? []), l]);
  return mapa;
}

/** Resposta identificada: servidor (primeiro nome e iniciais, com a função) ou contratado (com o preposto). */
function mapearResposta(l: LinhaResposta): RespostaManifestacao {
  const contratado = l.origem === 'contratado';
  return {
    id: l.id,
    origem: l.origem,
    autor: contratado ? nomeExibivel(l.fornecedor_tipo, l.fornecedor_nome) : nomePublicoCidadao(l.registrada_por_nome),
    funcao: contratado ? `Preposto: ${nomePublicoCidadao(l.representante ?? '')} (registrada por ${nomePublicoCidadao(l.registrada_por_nome)})` : l.funcao,
    texto: l.texto_publico,
    respondidaEm: l.respondida_em,
  };
}

function prazoDe(l: LinhaManifestacao, respostas: readonly LinhaResposta[], hoje: DataISO) {
  const primeiraAdministracao = respostas.find((r) => r.origem === 'administracao');
  return situacaoPrazoResposta({
    prazo: l.prazo_resposta,
    respondidaEm: primeiraAdministracao ? hojeISO(new Date(primeiraAdministracao.respondida_em)) : null,
    hoje,
  }).situacao;
}

function mapearPublica(l: LinhaManifestacao, respostas: readonly LinhaResposta[], hoje: DataISO): ManifestacaoPublica {
  return {
    id: l.id,
    assunto: l.assunto,
    autor: nomePublicoCidadao(l.autor_nome),
    texto: l.texto_publico,
    recebidaEm: l.recebida_em,
    publicadaEm: l.moderada_em,
    imagemUrl: l.imagem_sha256 ? `/api/v1/publico/contratos/${l.contrato_id}/manifestacoes/${l.id}/imagem` : null,
    prazoResposta: l.prazo_resposta,
    situacaoPrazo: prazoDe(l, respostas, hoje),
    respostas: respostas.map(mapearResposta),
  };
}

function mapearModeracao(l: LinhaManifestacao, respostas: readonly LinhaResposta[], hoje: DataISO): ManifestacaoModeracao {
  return {
    id: l.id,
    contrato: { id: l.contrato_id, numero: l.contrato_numero, uasg: l.contrato_uasg, objeto: l.contrato_objeto },
    assunto: l.assunto,
    autor: nomePublicoCidadao(l.autor_nome),
    texto: l.texto_publico,
    dadosPessoaisTarjados: l.dados_pessoais_tarjados,
    situacao: l.situacao,
    motivoModeracao: l.motivo_moderacao,
    moderadaPor: l.moderada_por_nome ? nomePublicoCidadao(l.moderada_por_nome) : null,
    moderadaEm: l.moderada_em,
    recebidaEm: l.recebida_em,
    imagemUrl: l.imagem_sha256 ? `/api/v1/sociedade/manifestacoes/${l.id}/imagem` : null,
    metadadosRemovidos: l.metadados_removidos,
    prazoResposta: l.prazo_resposta,
    situacaoPrazo: prazoDe(l, respostas, hoje),
    respostas: respostas.map(mapearResposta),
  };
}

function mapearMinha(l: LinhaManifestacao, respostas: readonly LinhaResposta[]): MinhaManifestacao {
  return {
    id: l.id,
    contrato: { id: l.contrato_id, numero: l.contrato_numero, objeto: l.contrato_objeto },
    assunto: l.assunto,
    texto: l.texto,
    situacao: l.situacao,
    motivoModeracao: l.motivo_moderacao,
    recebidaEm: l.recebida_em,
    moderadaEm: l.moderada_em,
    temImagem: l.imagem_sha256 !== null,
    metadadosRemovidos: l.metadados_removidos,
    prazoResposta: l.prazo_resposta,
    // O autor só vê as respostas depois da publicação, como qualquer pessoa.
    respostas: l.situacao === 'publicada' ? respostas.map(mapearResposta) : [],
  };
}

export async function obterLinhaManifestacao(executor: Executor, id: string): Promise<LinhaManifestacao | null> {
  const [linha] = await executor.consultar<LinhaManifestacao>(`${SELECAO_MANIFESTACAO} WHERE m.id = $1`, [id]);
  return linha ?? null;
}

export async function manifestacoesPublicas(executor: Executor, contratoId: string, hoje: DataISO): Promise<ManifestacaoPublica[]> {
  const linhas = await executor.consultar<LinhaManifestacao>(
    `${SELECAO_MANIFESTACAO} WHERE m.contrato_id = $1 AND m.situacao = 'publicada' ORDER BY m.moderada_em DESC, m.id`,
    [contratoId],
  );
  const respostas = await respostasDe(executor, linhas.map((l) => l.id));
  return linhas.map((l) => mapearPublica(l, respostas.get(l.id) ?? [], hoje));
}

export async function manifestacaoModeracao(executor: Executor, id: string, hoje: DataISO): Promise<ManifestacaoModeracao | null> {
  const linha = await obterLinhaManifestacao(executor, id);
  if (!linha) return null;
  const respostas = await respostasDe(executor, [linha.id]);
  return mapearModeracao(linha, respostas.get(linha.id) ?? [], hoje);
}

export interface FiltroModeracao {
  escopo: string[] | null;
  situacao: SituacaoManifestacao | null;
  contratoId: string | null;
  limite: number;
  inicio: number;
}

const CONDICOES_MODERACAO = `
   WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
     AND ($2::text IS NULL OR m.situacao = $2)
     AND ($3::uuid IS NULL OR m.contrato_id = $3)`;

export async function listarModeracao(executor: Executor, filtro: FiltroModeracao, hoje: DataISO): Promise<{ itens: ManifestacaoModeracao[]; total: number }> {
  const parametros = [filtro.escopo, filtro.situacao, filtro.contratoId] as const;
  const linhas = await executor.consultar<LinhaManifestacao>(
    `${SELECAO_MANIFESTACAO} ${CONDICOES_MODERACAO}
      ORDER BY (m.situacao = 'em_moderacao') DESC, m.recebida_em DESC, m.id
      LIMIT $4 OFFSET $5`,
    [...parametros, filtro.limite, filtro.inicio],
  );
  const [contagem] = await executor.consultar<{ total: number }>(
    `SELECT COUNT(*)::integer AS total FROM sociedade_manifestacoes m JOIN contratos c ON c.id = m.contrato_id ${CONDICOES_MODERACAO}`,
    [...parametros],
  );
  const respostas = await respostasDe(executor, linhas.map((l) => l.id));
  return { itens: linhas.map((l) => mapearModeracao(l, respostas.get(l.id) ?? [], hoje)), total: contagem?.total ?? 0 };
}

export async function minhasManifestacoes(executor: Executor, autorId: string): Promise<MinhaManifestacao[]> {
  const linhas = await executor.consultar<LinhaManifestacao>(`${SELECAO_MANIFESTACAO} WHERE m.autor_id = $1 ORDER BY m.recebida_em DESC, m.id LIMIT 200`, [autorId]);
  const respostas = await respostasDe(executor, linhas.map((l) => l.id));
  return linhas.map((l) => mapearMinha(l, respostas.get(l.id) ?? []));
}

export async function minhaManifestacao(executor: Executor, id: string): Promise<MinhaManifestacao | null> {
  const linha = await obterLinhaManifestacao(executor, id);
  if (!linha) return null;
  const respostas = await respostasDe(executor, [linha.id]);
  return mapearMinha(linha, respostas.get(linha.id) ?? []);
}

// ───────── registros da execução (art. 19, III) ─────────

export interface LinhaRegistro {
  id: string;
  contrato_id: string;
  titulo: string;
  descricao: string;
  midia: 'imagem' | 'video';
  formato: FormatoMidiaSociedade;
  sha256: string;
  bytes: number;
  registrado_em: string;
  publicado: boolean;
  motivo_retencao: string | null;
  metadados_removidos: string[];
  enviado_por_nome: string;
  enviado_em: string;
}

const SELECAO_REGISTRO = `
  SELECT r.id, r.contrato_id, r.titulo, r.descricao, r.midia, r.formato, r.sha256, r.bytes, r.registrado_em, r.publicado,
         r.motivo_retencao, r.metadados_removidos, u.nome AS enviado_por_nome, r.enviado_em
    FROM sociedade_registros_execucao r
    JOIN usuarios u ON u.id = r.enviado_por`;

export async function obterRegistro(executor: Executor, contratoId: string, registroId: string): Promise<LinhaRegistro | null> {
  const [linha] = await executor.consultar<LinhaRegistro>(`${SELECAO_REGISTRO} WHERE r.contrato_id = $1 AND r.id = $2`, [contratoId, registroId]);
  return linha ?? null;
}

export async function registrosDoContrato(executor: Executor, contratoId: string, somentePublicados: boolean): Promise<LinhaRegistro[]> {
  return executor.consultar<LinhaRegistro>(
    `${SELECAO_REGISTRO} WHERE r.contrato_id = $1 AND (NOT $2::boolean OR r.publicado) ORDER BY r.registrado_em DESC, r.enviado_em DESC, r.id`,
    [contratoId, somentePublicados],
  );
}

export function mapearRegistroPublico(l: LinhaRegistro): RegistroExecucaoPublico {
  return {
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    midia: l.midia,
    formato: l.formato,
    url: `/api/v1/publico/contratos/${l.contrato_id}/registros/${l.id}/midia`,
    registradoEm: l.registrado_em,
    publicadoEm: l.enviado_em,
    sha256: l.sha256,
    bytes: l.bytes,
  };
}

export function mapearRegistroInterno(l: LinhaRegistro): RegistroExecucaoInterno {
  return {
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    midia: l.midia,
    formato: l.formato,
    registradoEm: l.registrado_em,
    sha256: l.sha256,
    bytes: l.bytes,
    publicado: l.publicado,
    motivoRetencao: l.motivo_retencao,
    enviadoPor: nomePublicoCidadao(l.enviado_por_nome),
    enviadoEm: l.enviado_em,
    metadadosRemovidos: l.metadados_removidos,
    url: `/api/v1/sociedade/contratos/${l.contrato_id}/registros/${l.id}/midia`,
  };
}

// ───────── relatório final (art. 174, § 3º, VI, "d") ─────────

interface LinhaRelatorio {
  objetivos: string;
  resultados: string;
  conclusao: ConclusaoRelatorioFinal;
  execucao: RelatorioFinalPublico['execucao'];
  sha256: string;
  publicado_por_nome: string;
  publicado_em: string;
}

export async function relatorioFinal(executor: Executor, contratoId: string): Promise<RelatorioFinalPublico | null> {
  const [l] = await executor.consultar<LinhaRelatorio>(
    `SELECT r.objetivos, r.resultados, r.conclusao, r.execucao, r.sha256, u.nome AS publicado_por_nome, r.publicado_em
       FROM sociedade_relatorios_finais r
       JOIN usuarios u ON u.id = r.publicado_por
      WHERE r.contrato_id = $1`,
    [contratoId],
  );
  if (!l) return null;
  return {
    objetivos: l.objetivos,
    resultados: l.resultados,
    conclusao: l.conclusao,
    publicadoEm: l.publicado_em,
    publicadoPor: `Gestão do contrato — ${nomePublicoCidadao(l.publicado_por_nome)}`,
    execucao: l.execucao,
    sha256: l.sha256,
    fundamento: 'Lei 14.133/2021, art. 174, § 3º, VI, "d"',
  };
}

