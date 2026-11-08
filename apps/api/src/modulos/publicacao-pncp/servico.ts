/**
 * Publicação no PNCP (RF-19) — lado da API: grava o pedido na fila (RNF-07) junto com o registro do envio, e monta a
 * situação de cada envio para a etapa de publicação da jornada. A execução é do trabalhador (./tarefas.ts).
 */
import { chaveIdempotencia, TIPOS_DOCUMENTO_PNCP, tituloDocumentoPncp } from '@agora/dominio';
import type { EnvioPncp, PublicacaoPncp, SituacaoEnvioPncp } from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { linkPncpCompra } from '../../compartilhado/instrumentos.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { reabrir } from '../../fila/registro.ts';
import { FalhaTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ServicoFila } from '../../fila/servico.ts';
import type { ArquivoPncp } from '../../integracoes/pncp-publicacao.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';

export type DocumentoPublicavel = 'edital' | 'tr' | 'minuta_contrato';

/** Anexos enviados depois da inclusão da compra (o edital vai junto com a compra). */
export const ANEXOS_PNCP: readonly Exclude<DocumentoPublicavel, 'edital'>[] = ['tr', 'minuta_contrato'];

const ROTULOS: Record<DocumentoPublicavel, string> = { edital: 'Edital', tr: 'Termo de referência', minuta_contrato: 'Minuta do contrato' };
const TIPO_DOCUMENTO: Record<DocumentoPublicavel, number> = {
  edital: TIPOS_DOCUMENTO_PNCP.edital,
  tr: TIPOS_DOCUMENTO_PNCP.termoReferencia,
  minuta_contrato: TIPOS_DOCUMENTO_PNCP.minutaContrato,
};

export interface LinhaEnvio {
  id: string;
  tarefa_id: string;
  objeto: 'compra' | 'arquivo' | 'contrato';
  processo_id: string;
  contrato_id: string | null;
  documento_tipo: string | null;
  titulo: string;
  tipo_documento_pncp: number | null;
  modo: 'offline' | 'online';
  hash_arquivo: string | null;
  protocolo: string | null;
  numero_controle: string | null;
  sequencial_documento: number | null;
  enviado_em: string | null;
  criado_em: string;
}

const COLUNAS_ENVIO = `id, tarefa_id, objeto, processo_id, contrato_id, documento_tipo, titulo, tipo_documento_pncp, modo, hash_arquivo,
  protocolo, numero_controle, sequencial_documento, enviado_em, criado_em`;

export async function registrarEnvio(
  tx: Transacao,
  envio: {
    tarefaId: string;
    objeto: LinhaEnvio['objeto'];
    processoId: string;
    contratoId?: string | null;
    documento?: DocumentoPublicavel | null;
    titulo: string;
    modo: 'offline' | 'online';
  },
  agora: Date,
): Promise<void> {
  await tx.executar(
    `INSERT INTO pncp_envios (tarefa_id, objeto, processo_id, contrato_id, documento_tipo, titulo, tipo_documento_pncp, modo, criado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tarefa_id) DO NOTHING`,
    [
      envio.tarefaId,
      envio.objeto,
      envio.processoId,
      envio.contratoId ?? null,
      envio.documento ?? null,
      envio.titulo,
      envio.documento ? TIPO_DOCUMENTO[envio.documento] : null,
      envio.modo,
      agora.toISOString(),
    ],
  );
}

export async function obterEnvio(executor: Executor, tarefaId: string): Promise<LinhaEnvio | null> {
  const [linha] = await executor.consultar<LinhaEnvio>(`SELECT ${COLUNAS_ENVIO} FROM pncp_envios WHERE tarefa_id = $1`, [tarefaId]);
  return linha ?? null;
}

/**
 * Grava, logo depois da resposta do PNCP, o que ele devolveu (protocolo e número de controle). É a prova do envio:
 * se a execução cair antes de concluir a tarefa, a próxima tentativa reaproveita a resposta e não envia de novo.
 */
export async function gravarEvidencia(
  executor: Executor,
  tarefaId: string,
  e: { protocolo: string; numeroControle: string; hashArquivo: string | null; sequencialDocumento: number | null; modo: 'offline' | 'online' },
  agora: Date,
): Promise<LinhaEnvio> {
  const [linha] = await executor.consultar<LinhaEnvio>(
    `UPDATE pncp_envios
        SET protocolo = $2, numero_controle = $3, hash_arquivo = $4, sequencial_documento = $5, modo = $6, enviado_em = $7
      WHERE tarefa_id = $1
      RETURNING ${COLUNAS_ENVIO}`,
    [tarefaId, e.protocolo, e.numeroControle, e.hashArquivo, e.sequencialDocumento, e.modo, agora.toISOString()],
  );
  if (!linha) throw new FalhaTarefa('Registro do envio ao PNCP não encontrado para a tarefa.', false);
  return linha;
}

/** Envio da compra já aceito pelo PNCP (base dos anexos e do contrato). */
export async function compraPublicada(executor: Executor, processoId: string): Promise<LinhaEnvio | null> {
  const [linha] = await executor.consultar<LinhaEnvio>(
    `SELECT ${COLUNAS_ENVIO} FROM pncp_envios
      WHERE processo_id = $1 AND objeto = 'compra' AND numero_controle IS NOT NULL
      ORDER BY enviado_em DESC LIMIT 1`,
    [processoId],
  );
  return linha ?? null;
}

/** Documento aprovado em PDF (o mesmo inteiro teor da página pública: dados pessoais tarjados), com hash. */
export async function arquivoDoDocumento(
  executor: Executor,
  linha: Pick<LinhaProcesso, 'id' | 'numero_sei'>,
  tipo: DocumentoPublicavel,
  referencia: string,
): Promise<ArquivoPncp & { hash: string; versao: number }> {
  const [documento] = await executor.consultar<{ titulo: string; versao: number; conteudo: string }>(
    `SELECT titulo, versao, conteudo FROM documentos_gerados
      WHERE processo_id = $1 AND tipo = $2 AND situacao = 'aprovado'
      ORDER BY versao DESC LIMIT 1`,
    [linha.id, tipo],
  );
  if (!documento) throw new FalhaTarefa(`Não há ${ROTULOS[tipo].toLowerCase()} aprovado no processo ${linha.numero_sei}.`, false);
  const titulo = `${ROTULOS[tipo]} — processo ${linha.numero_sei}`;
  const conteudo = gerarPdfTexto({ titulo, rodape: `${titulo} (versão ${documento.versao})`, conteudo: tarjarDadosPessoais(documento.conteudo) });
  return {
    nome: `${tipo.replace('_', '-')}-${linha.numero_sei.replace(/[^0-9]/g, '')}.pdf`,
    conteudo,
    titulo: tituloDocumentoPncp(`${ROTULOS[tipo]} ${referencia}`),
    tipoDocumentoId: TIPO_DOCUMENTO[tipo],
    hash: sha256Hex(conteudo),
    versao: documento.versao,
  };
}

export async function documentoAprovado(executor: Executor, processoId: string, tipo: DocumentoPublicavel): Promise<boolean> {
  const [linha] = await executor.consultar<{ existe: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM documentos_gerados WHERE processo_id = $1 AND tipo = $2 AND situacao = 'aprovado') AS existe`,
    [processoId, tipo],
  );
  return linha?.existe ?? false;
}

/**
 * Pede a publicação do edital (compra + edital) na transação da rota. Idempotente pela chave `pncp:compra:<processo>`:
 * se a tarefa já existe e está na fila de erro, é reaberta (reprocessamento); se está pendente, nada muda.
 */
export async function solicitarPublicacaoEdital(
  tx: Transacao,
  fila: ServicoFila,
  linha: LinhaProcesso,
  solicitante: string,
  modo: 'offline' | 'online',
  agora: Date,
): Promise<{ tarefa: LinhaTarefa; nova: boolean; reaberta: boolean }> {
  const { tarefa, criada } = await fila.enfileirar(tx, {
    tipo: 'pncp.compra',
    chave: chaveIdempotencia(['pncp', 'compra', linha.id]),
    descricao: `Publicar no PNCP a contratação e o edital do processo ${linha.numero_sei}`,
    carga: { processoId: linha.id },
    uasg: linha.uasg,
    recurso: { tipo: 'processo', id: linha.id },
    solicitadaPor: solicitante,
  });
  if (criada) {
    await registrarEnvio(tx, { tarefaId: tarefa.id, objeto: 'compra', processoId: linha.id, documento: 'edital', titulo: ROTULOS.edital, modo }, agora);
    return { tarefa, nova: true, reaberta: false };
  }
  if (tarefa.situacao === 'erro') {
    const reaberta = await reabrir(tx, tarefa.id, agora);
    if (reaberta) return { tarefa: reaberta, nova: false, reaberta: true };
  }
  return { tarefa, nova: false, reaberta: false };
}

/** Pede a divulgação do contrato gerado pela jornada (art. 94), com chave `pncp:contrato:<contrato>`. */
export async function solicitarDivulgacaoContrato(
  tx: Transacao,
  fila: ServicoFila,
  linha: LinhaProcesso,
  contrato: { id: string; numero: string },
  solicitante: string,
  modo: 'offline' | 'online',
  agora: Date,
): Promise<{ tarefa: LinhaTarefa; nova: boolean }> {
  const { tarefa, criada } = await fila.enfileirar(tx, {
    tipo: 'pncp.contrato',
    chave: chaveIdempotencia(['pncp', 'contrato', contrato.id]),
    descricao: `Divulgar no PNCP o contrato ${contrato.numero} (processo ${linha.numero_sei})`,
    carga: { processoId: linha.id, contratoId: contrato.id },
    uasg: linha.uasg,
    recurso: { tipo: 'contrato', id: contrato.id },
    solicitadaPor: solicitante,
  });
  if (criada) {
    await registrarEnvio(
      tx,
      { tarefaId: tarefa.id, objeto: 'contrato', processoId: linha.id, contratoId: contrato.id, titulo: `Contrato ${contrato.numero}`, modo },
      agora,
    );
  }
  return { tarefa, nova: criada };
}

interface LinhaEnvioComTarefa extends LinhaEnvio {
  situacao: LinhaTarefa['situacao'];
  tentativas: number;
  maximo_tentativas: number;
  disponivel_em: string;
  ultimo_erro: string | null;
}

function situacaoEnvio(l: LinhaEnvioComTarefa): SituacaoEnvioPncp {
  if (l.situacao === 'concluida') return 'publicado';
  if (l.situacao === 'erro') return 'erro';
  if (l.situacao === 'executando') return 'enviando';
  return l.tentativas > 0 ? 'nova_tentativa' : 'na_fila';
}

function mapearEnvio(l: LinhaEnvioComTarefa): EnvioPncp {
  const situacao = situacaoEnvio(l);
  return {
    id: l.id,
    tarefaId: l.tarefa_id,
    objeto: l.objeto,
    titulo: l.titulo,
    tipoDocumentoPncp: l.tipo_documento_pncp,
    situacao,
    modo: l.modo,
    tentativas: l.tentativas,
    maximoTentativas: l.maximo_tentativas,
    proximaTentativaEm: situacao === 'nova_tentativa' ? l.disponivel_em : null,
    ultimoErro: situacao === 'publicado' ? null : l.ultimo_erro,
    protocolo: l.protocolo,
    numeroControle: l.numero_controle,
    hashArquivo: l.hash_arquivo,
    enviadoEm: l.enviado_em,
  };
}

/** Situação dos envios ao PNCP de um processo (etapas 5 e 7 da jornada). */
export async function consultarPublicacaoPncp(executor: Executor, linha: LinhaProcesso): Promise<PublicacaoPncp> {
  const linhas = await executor.consultar<LinhaEnvioComTarefa>(
    `SELECT e.id, e.tarefa_id, e.objeto, e.processo_id, e.contrato_id, e.documento_tipo, e.titulo, e.tipo_documento_pncp, e.modo,
            e.hash_arquivo, e.protocolo, e.numero_controle, e.sequencial_documento, e.enviado_em, e.criado_em,
            t.situacao, t.tentativas, t.maximo_tentativas, t.disponivel_em, t.ultimo_erro
       FROM pncp_envios e JOIN fila_tarefas t ON t.id = e.tarefa_id
      WHERE e.processo_id = $1
      ORDER BY CASE e.objeto WHEN 'compra' THEN 0 WHEN 'arquivo' THEN 1 ELSE 2 END,
               CASE e.documento_tipo WHEN 'edital' THEN 0 WHEN 'tr' THEN 1 WHEN 'minuta_contrato' THEN 2 ELSE 3 END, e.criado_em`,
    [linha.id],
  );
  const envios = linhas.filter((l) => l.objeto !== 'contrato').map(mapearEnvio);
  const contrato = linhas.find((l) => l.objeto === 'contrato');
  const compra = envios.find((e) => e.objeto === 'compra');
  const numeroControle = compra?.numeroControle ?? linha.publicacao.idPncp;
  const publicado = linha.publicacao.pncp === 'publicado';
  return {
    processoId: linha.id,
    numeroControle,
    linkPncp: publicado && compra?.modo === 'online' ? linkPncpCompra(numeroControle) : null,
    linkPublico: publicado ? `/transparencia/editais/${linha.id}` : null,
    envios,
    contrato: contrato ? mapearEnvio(contrato) : null,
  };
}
