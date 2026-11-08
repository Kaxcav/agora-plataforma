/**
 * Integração com o SEI (RF-35) — gravação e leitura: processo gerado no SEI, documentos da árvore incluídos e as
 * assinaturas consultadas. As gravações de prova (`gravar*`) são feitas logo depois da resposta do SEI, fora da
 * transação final da tarefa: se a execução cair no meio, a nova tentativa continua de onde parou e não repete a
 * inclusão no SEI.
 */
import { situacaoAssinaturaSei, type AssinaturaSei } from '@agora/dominio';
import type { DocumentoSei, IntegracaoSeiProcesso, SituacaoTarefaSei, TarefaSei } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import type { Config } from '../../config.ts';
import type { LinhaTarefa } from '../../fila/tipos.ts';
import type { TipoDocumento } from '../jornada/tipos.ts';

export interface LinhaProcessoSei {
  processo_id: string;
  id_procedimento: string;
  protocolo: string;
  link: string | null;
  modo: 'offline' | 'online';
  gerado_em: string;
  unidade_destino: string | null;
  enviado_unidade_em: string | null;
}

export interface EntradaSei {
  arvore_id: string;
  numero: string;
  titulo: string;
  documento_id: string | null;
  tipo: TipoDocumento | null;
  versao: number | null;
  conteudo: string | null;
  revisor_nome: string | null;
  assinado_em: string | null;
  assinado_nome: string | null;
  id_documento: string | null;
  documento_formatado: string | null;
  link: string | null;
  incluido_em: string | null;
  nivel_acesso: number | null;
  bloco_assinatura: string | null;
  assinaturas: AssinaturaSei[] | null;
  consultado_em: string | null;
  tarefa_id: string | null;
}

export async function obterProcessoSei(executor: Executor, processoId: string): Promise<LinhaProcessoSei | null> {
  const [linha] = await executor.consultar<LinhaProcessoSei>(
    `SELECT processo_id, id_procedimento, protocolo, link, modo, gerado_em, unidade_destino, enviado_unidade_em
       FROM sei_processos WHERE processo_id = $1`,
    [processoId],
  );
  return linha ?? null;
}

/** Entradas da árvore com o que já foi incluído no SEI. O conteúdo do documento só é lido para o envio. */
export async function listarEntradasSei(executor: Executor, processoId: string, comConteudo: boolean): Promise<EntradaSei[]> {
  return executor.consultar<EntradaSei>(
    `SELECT a.id AS arvore_id, a.numero, a.titulo, a.documento_id, d.tipo, d.versao, ${comConteudo ? 'd.conteudo' : 'NULL::text AS conteudo'},
            r.nome AS revisor_nome, a.assinado_em, COALESCE(u.nome, a.assinado_por_nome) AS assinado_nome,
            s.id_documento, s.documento_formatado, s.link, s.incluido_em, s.nivel_acesso, s.bloco_assinatura, s.assinaturas,
            s.consultado_em, s.tarefa_id
       FROM processos_arvore_sei a
       LEFT JOIN documentos_gerados d ON d.id = a.documento_id
       LEFT JOIN usuarios r ON r.id = d.revisado_por
       LEFT JOIN usuarios u ON u.id = a.assinado_por
       LEFT JOIN sei_documentos s ON s.arvore_id = a.id
      WHERE a.processo_id = $1
      ORDER BY a.numero`,
    [processoId],
  );
}

export async function gravarProcessoSei(
  executor: Executor,
  p: { processoId: string; idProcedimento: string; protocolo: string; link: string | null; modo: 'offline' | 'online'; tarefaId: string | null },
  agora: Date,
): Promise<LinhaProcessoSei> {
  const [linha] = await executor.consultar<LinhaProcessoSei>(
    `INSERT INTO sei_processos (processo_id, id_procedimento, protocolo, link, modo, tarefa_id, gerado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (processo_id) DO UPDATE SET processo_id = EXCLUDED.processo_id
     RETURNING processo_id, id_procedimento, protocolo, link, modo, gerado_em, unidade_destino, enviado_unidade_em`,
    [p.processoId, p.idProcedimento, p.protocolo, p.link, p.modo, p.tarefaId, agora.toISOString()],
  );
  if (!linha) throw new Error('Falha ao gravar o processo SEI.');
  return linha;
}

export async function gravarDocumentoSei(
  executor: Executor,
  d: {
    arvoreId: string;
    processoId: string;
    idDocumento: string;
    documentoFormatado: string;
    link: string | null;
    modo: 'offline' | 'online';
    hashArquivo: string;
    nivelAcesso: number | null;
    tarefaId: string | null;
  },
  agora: Date,
): Promise<void> {
  await executor.executar(
    `INSERT INTO sei_documentos (arvore_id, processo_id, id_documento, documento_formatado, link, modo, hash_arquivo, nivel_acesso, tarefa_id, incluido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (arvore_id) DO NOTHING`,
    [d.arvoreId, d.processoId, d.idDocumento, d.documentoFormatado, d.link, d.modo, d.hashArquivo, d.nivelAcesso, d.tarefaId, agora.toISOString()],
  );
}

export async function gravarBlocoSei(executor: Executor, arvoreIds: readonly string[], bloco: string): Promise<void> {
  if (arvoreIds.length === 0) return;
  await executor.executar('UPDATE sei_documentos SET bloco_assinatura = $2 WHERE arvore_id = ANY($1::uuid[])', [arvoreIds, bloco]);
}

export async function gravarTramitacaoSei(executor: Executor, processoId: string, unidade: string, agora: Date): Promise<void> {
  await executor.executar('UPDATE sei_processos SET unidade_destino = $2, enviado_unidade_em = $3 WHERE processo_id = $1', [
    processoId,
    unidade,
    agora.toISOString(),
  ]);
}

/** Última tarefa do SEI de um tipo para o processo (para a situação exibida na tela). */
async function ultimaTarefa(executor: Executor, tipo: 'sei.envio' | 'sei.assinaturas', processoId: string): Promise<LinhaTarefa | null> {
  const [linha] = await executor.consultar<LinhaTarefa>(
    `SELECT * FROM fila_tarefas WHERE tipo = $1 AND recurso_tipo = 'processo' AND recurso_id = $2 ORDER BY criada_em DESC LIMIT 1`,
    [tipo, processoId],
  );
  return linha ?? null;
}

export function situacaoTarefa(t: Pick<LinhaTarefa, 'situacao' | 'tentativas'>): SituacaoTarefaSei {
  if (t.situacao === 'pendente') return t.tentativas > 0 ? 'nova_tentativa' : 'na_fila';
  return t.situacao;
}

function mapearTarefa(t: LinhaTarefa | null, tipo: TarefaSei['tipo']): TarefaSei | null {
  if (!t) return null;
  const situacao = situacaoTarefa(t);
  return {
    id: t.id,
    tipo,
    situacao,
    tentativas: t.tentativas,
    maximoTentativas: t.maximo_tentativas,
    proximaTentativaEm: situacao === 'nova_tentativa' ? t.disponivel_em : null,
    ultimoErro: situacao === 'concluida' ? null : t.ultimo_erro,
    criadaEm: t.criada_em,
    concluidaEm: t.concluida_em,
  };
}

function mapearDocumento(e: EntradaSei): DocumentoSei {
  const assinaturas = e.assinaturas ?? [];
  const situacao = situacaoAssinaturaSei(assinaturas);
  const assinadoNaArvore = e.assinado_em !== null;
  return {
    numeroArvore: e.numero,
    titulo: e.titulo,
    tipo: e.tipo,
    enviado: e.documento_formatado !== null,
    numeroSei: e.documento_formatado,
    linkSei: e.link,
    enviadoEm: e.incluido_em,
    nivelAcesso: e.documento_formatado === null ? null : e.nivel_acesso === 1 ? 'restrito' : 'padrao',
    blocoAssinatura: e.bloco_assinatura,
    assinaturas: assinaturas.map((a) => ({ nome: a.nome, cargoFuncao: a.cargoFuncao, assinadoEm: a.assinadoEm })),
    assinado: situacao.assinado || assinadoNaArvore,
    resumoAssinatura: situacao.assinado ? situacao.resumo : (e.assinado_nome ?? ''),
    consultadoEm: e.consultado_em,
  };
}

/** GET /processos/:id/sei — processo no SEI, documentos, assinaturas refletidas e as tarefas da fila. */
export async function montarIntegracaoSei(executor: Executor, processoId: string, config: Config): Promise<IntegracaoSeiProcesso> {
  const [processo, entradas, envio, consulta] = await Promise.all([
    obterProcessoSei(executor, processoId),
    listarEntradasSei(executor, processoId, false),
    ultimaTarefa(executor, 'sei.envio', processoId),
    ultimaTarefa(executor, 'sei.assinaturas', processoId),
  ]);
  const documentos = entradas.map(mapearDocumento);
  return {
    processoId,
    modo: config.integracoes,
    configurado: config.integracoes === 'offline' || config.sei.configurado,
    processo: processo
      ? {
          numero: processo.protocolo,
          idProcedimento: processo.id_procedimento,
          link: processo.link,
          geradoEm: processo.gerado_em,
          unidadeDestino: processo.unidade_destino,
          enviadoUnidadeEm: processo.enviado_unidade_em,
        }
      : null,
    documentos,
    pendentesEnvio: entradas.filter((e) => e.documento_id !== null && e.documento_formatado === null).length,
    pendentesAssinatura: documentos.filter((d) => d.enviado && !d.assinado).length,
    envio: mapearTarefa(envio, 'sei.envio'),
    consulta: mapearTarefa(consulta, 'sei.assinaturas'),
  };
}
