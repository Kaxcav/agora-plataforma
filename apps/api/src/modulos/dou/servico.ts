/**
 * Publicação no DOU (RF-36) — regras de gravação. A Imprensa Nacional recebe as matérias pelo INCom, operado por
 * servidor credenciado, sem API pública de envio. Por isso a Ágora:
 *   1. gera a matéria no padrão da Seção 3 (`montarMateriaDou`) a partir dos dados do ato;
 *   2. registra o envio feito no INCom, com o protocolo, e calcula a edição prevista (`dataPrevistaPublicacaoDou`);
 *   3. confere a publicação na consulta pública do DOU, pelo servidor e pela fila, ou aceita o registro manual;
 *   4. no aviso de licitação, registra também a publicação em jornal diário de grande circulação (art. 54, § 1º).
 * Publicado o aviso, a situação "Diário Oficial da União" da etapa 5 da jornada passa a "Publicado".
 */
import {
  dataPrevistaPublicacaoDou,
  hojeISO,
  montarMateriaDou,
  type DadosMateriaDou,
  type MateriaDouMontada,
  type OpcoesCalendario,
  type TipoMateriaDou,
} from '@agora/dominio';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { linkPncpCompra } from '../../compartilhado/instrumentos.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { carregarEquipe, obterLinhaProcesso } from '../jornada/repositorio.ts';
import type { LinhaMateria } from './repositorio.ts';

export interface AlvoMateria {
  tipo: TipoMateriaDou;
  processoId?: string | undefined;
  contratoId?: string | undefined;
  aditivoId?: string | undefined;
}

export interface AtoMateria {
  dados: DadosMateriaDou;
  uasg: string;
  processoId: string | null;
  contratoId: string | null;
  aditivoId: string | null;
  processoNumero: string;
}

interface LinhaContratoDou {
  id: string;
  numero: string;
  uasg: string;
  uasg_nome: string;
  uasg_orgao: string;
  objeto: string;
  processo_sei: string;
  modalidade: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_inicial: number;
  assinatura_em: string;
  razao_social: string;
  documento: string;
  processo_id: string | null;
}

async function contratoDoAto(executor: Executor, contratoId: string, escopo: string[] | null): Promise<LinhaContratoDou> {
  const [c] = await executor.consultar<LinhaContratoDou>(
    `SELECT c.id, c.numero, c.uasg, u.nome AS uasg_nome, u.orgao AS uasg_orgao, c.objeto, c.processo_sei, c.modalidade, c.vigencia_inicio, c.vigencia_fim,
            c.valor_inicial, c.assinatura_em, f.razao_social, f.documento,
            (SELECT p.id FROM processos p WHERE p.contrato_id = c.id) AS processo_id
       FROM contratos c
       JOIN uasgs u ON u.codigo = c.uasg
       JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.id = $1 AND ($2::text[] IS NULL OR c.uasg = ANY($2::text[]))`,
    [contratoId, escopo],
  );
  if (!c) throw naoEncontrado('Contrato não encontrado.');
  return c;
}

/**
 * Dados do ato (processo, contrato ou termo aditivo) no formato de `montarMateriaDou`, respeitando o escopo de UASG.
 * O cabeçalho da matéria é o órgão e a unidade da UASG do ato.
 */
export async function atoDaMateria(executor: Executor, alvo: AlvoMateria, escopo: string[] | null): Promise<AtoMateria> {
  if (alvo.tipo === 'aviso_licitacao') {
    if (!alvo.processoId) throw regraNegocio('Informe o processo do aviso de licitação.');
    const linha = await obterLinhaProcesso(executor, alvo.processoId, escopo);
    if (!linha) throw naoEncontrado('Processo não encontrado.');
    const { publicadoEm, dataMinimaPropostas, idPncp } = linha.publicacao;
    if (linha.publicacao.pncp !== 'publicado' || !publicadoEm || !dataMinimaPropostas) {
      throw regraNegocio('O aviso de licitação é gerado depois que o edital é aceito no PNCP (art. 54): publique o edital na etapa 5.', [
        { campo: 'RF-36', mensagem: 'Edital não publicado no PNCP' },
      ]);
    }
    const agente = (await carregarEquipe(executor, linha.id)).find((m) => m.papel === 'agente_contratacao');
    return {
      dados: {
        tipo: 'aviso_licitacao',
        orgao: { nome: linha.uasg_orgao, unidade: linha.uasg_nome },
        uasg: { codigo: linha.uasg, nome: linha.uasg_nome },
        processo: linha.numero_sei,
        objeto: linha.titulo,
        modalidade: linha.modalidade_prevista ?? 'Pregão eletrônico',
        numero: `${Number(linha.numero_sei.slice(6, 12))}/${publicadoEm.slice(0, 4)}`,
        totalItens: linha.dfd.itens.length,
        dataEdital: publicadoEm,
        dataPropostas: dataMinimaPropostas,
        enderecoEdital: linkPncpCompra(idPncp) ?? 'https://pncp.gov.br',
        responsavel: { nome: agente?.nome ?? linha.responsavel_nome ?? linha.uasg_nome, cargo: 'Agente de contratação' },
      },
      uasg: linha.uasg,
      processoId: linha.id,
      contratoId: null,
      aditivoId: null,
      processoNumero: linha.numero_sei,
    };
  }

  if (!alvo.contratoId) throw regraNegocio('Informe o contrato do extrato.');
  const c = await contratoDoAto(executor, alvo.contratoId, escopo);
  const base = {
    orgao: { nome: c.uasg_orgao, unidade: c.uasg_nome },
    uasg: { codigo: c.uasg, nome: c.uasg_nome },
    processo: c.processo_sei,
    objeto: c.objeto,
    numeroContrato: c.numero,
    contratado: { nome: c.razao_social, documento: c.documento },
  };
  const ato = { uasg: c.uasg, processoId: c.processo_id, contratoId: c.id, processoNumero: c.processo_sei };
  if (alvo.tipo === 'extrato_contrato') {
    return {
      ...ato,
      aditivoId: null,
      dados: {
        tipo: 'extrato_contrato',
        ...base,
        origem: c.modalidade,
        vigenciaInicio: c.vigencia_inicio,
        vigenciaFim: c.vigencia_fim,
        valor: c.valor_inicial,
        dataAssinatura: c.assinatura_em,
      },
    };
  }
  if (!alvo.aditivoId) throw regraNegocio('Informe o termo aditivo do extrato.');
  const [ad] = await executor.consultar<{ id: string; numero: string; tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste'; valor: number; nova_vigencia_fim: string | null; assinado_em: string }>(
    'SELECT id, numero, tipo, valor, nova_vigencia_fim, assinado_em FROM aditivos WHERE id = $1 AND contrato_id = $2',
    [alvo.aditivoId, c.id],
  );
  if (!ad) throw naoEncontrado('Termo aditivo não encontrado neste contrato.');
  return {
    ...ato,
    aditivoId: ad.id,
    dados: {
      tipo: 'extrato_aditivo',
      ...base,
      numeroAditivo: ad.numero,
      natureza: ad.tipo,
      valor: ad.valor,
      novaVigenciaFim: ad.nova_vigencia_fim,
      dataAssinatura: ad.assinado_em,
    },
  };
}

/** Matéria já gerada para o mesmo ato (há no máximo uma por processo, contrato ou aditivo). */
export async function materiaDoAto(executor: Executor, ato: Pick<AtoMateria, 'processoId' | 'contratoId' | 'aditivoId'> & { tipo: TipoMateriaDou }): Promise<{ id: string; situacao: string } | null> {
  const coluna = ato.tipo === 'aviso_licitacao' ? 'processo_id' : ato.tipo === 'extrato_contrato' ? 'contrato_id' : 'aditivo_id';
  const valor = ato.tipo === 'aviso_licitacao' ? ato.processoId : ato.tipo === 'extrato_contrato' ? ato.contratoId : ato.aditivoId;
  const [linha] = await executor.consultar<{ id: string; situacao: string }>(
    `SELECT id, situacao FROM dou_materias WHERE tipo = $1 AND ${coluna} = $2 FOR UPDATE`,
    [ato.tipo, valor ?? null],
  );
  return linha ?? null;
}

/**
 * Grava a matéria montada: cria, ou refaz o rascunho existente com os dados atuais do ato. Matéria já enviada ao
 * INCom não muda (a publicação é a do texto enviado).
 */
export async function gravarMateria(
  tx: Transacao,
  ato: AtoMateria,
  montada: MateriaDouMontada,
  autor: { usuarioId: string | null; automatica: boolean },
  agora: Date,
): Promise<{ id: string; criada: boolean }> {
  const existente = await materiaDoAto(tx, { tipo: montada.tipo, ...ato });
  const hash = sha256Hex(montada.texto);
  if (existente) {
    if (existente.situacao !== 'rascunho') {
      throw regraNegocio('Esta matéria já foi enviada ao DOU pelo INCom: o texto enviado não pode mudar. Para corrigir, publique uma retificação.', [
        { campo: 'RF-36', mensagem: 'Matéria já enviada' },
      ]);
    }
    await tx.executar(
      `UPDATE dou_materias SET titulo = $2, identificacao = $3, texto = $4, hash_texto = $5, obrigatoria = $6, fundamento = $7,
              processo_numero = $8, gerada_em = $9, gerada_por = $10, automatica = $11
        WHERE id = $1`,
      [existente.id, montada.titulo, montada.identificacao, montada.texto, hash, montada.obrigatoria, montada.fundamento, ato.processoNumero, agora.toISOString(), autor.usuarioId, autor.automatica],
    );
    return { id: existente.id, criada: false };
  }
  const [criada] = await tx.consultar<{ id: string }>(
    `INSERT INTO dou_materias (tipo, processo_id, contrato_id, aditivo_id, processo_numero, uasg, secao, titulo, identificacao, texto, hash_texto,
                               obrigatoria, fundamento, automatica, gerada_em, gerada_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      montada.tipo,
      ato.processoId,
      ato.contratoId,
      ato.aditivoId,
      ato.processoNumero,
      ato.uasg,
      montada.secao,
      montada.titulo,
      montada.identificacao,
      montada.texto,
      hash,
      montada.obrigatoria,
      montada.fundamento,
      autor.automatica,
      agora.toISOString(),
      autor.usuarioId,
    ],
  );
  if (!criada) throw new Error('Falha ao gravar a matéria do DOU.');
  return { id: criada.id, criada: true };
}

/** Envio pelo INCom: protocolo e instante do envio; calcula a edição prevista. */
export async function registrarEnvioDou(
  tx: Transacao,
  materia: LinhaMateria,
  envio: { protocolo: string; enviadaEm: Date; usuarioId: string | null },
  calendario: OpcoesCalendario & { horaFechamento: number },
  agora: Date,
): Promise<string> {
  if (materia.situacao !== 'rascunho') throw regraNegocio('O envio desta matéria pelo INCom já foi registrado.');
  if (envio.enviadaEm.getTime() > agora.getTime() + 5 * 60 * 1000) throw regraNegocio('O envio não pode estar no futuro.', [{ campo: 'enviadaEm', mensagem: 'Data futura' }]);
  if (envio.enviadaEm.getTime() < Date.parse(materia.gerada_em) - 60 * 1000) {
    throw regraNegocio('O envio pelo INCom não pode ser anterior à geração da matéria na Ágora.', [{ campo: 'enviadaEm', mensagem: 'Anterior à geração' }]);
  }
  const prevista = dataPrevistaPublicacaoDou(envio.enviadaEm, calendario);
  await tx.executar(
    `UPDATE dou_materias SET situacao = 'enviada', protocolo_incom = $2, enviada_em = $3, envio_registrado_por = $4, data_prevista = $5 WHERE id = $1`,
    [materia.id, envio.protocolo, envio.enviadaEm.toISOString(), envio.usuarioId, prevista],
  );
  return prevista;
}

/** Publicação conferida (consulta) ou registrada (manual). No aviso de licitação, atualiza a etapa 5 da jornada. */
export async function registrarPublicacaoDou(
  tx: Transacao,
  materia: LinhaMateria,
  p: { data: string; edicao: string | null; pagina: string | null; url: string | null; forma: 'consulta' | 'manual'; modo: 'offline' | 'online' },
  agora: Date,
): Promise<void> {
  if (materia.situacao === 'rascunho') throw regraNegocio('Registre antes o envio da matéria pelo INCom, com o protocolo.');
  if (materia.situacao === 'publicada') throw regraNegocio('A publicação desta matéria já está registrada.');
  if (materia.enviada_em && p.data < hojeISO(new Date(materia.enviada_em))) {
    throw regraNegocio('A data da edição não pode ser anterior ao envio pelo INCom.', [{ campo: 'data', mensagem: 'Anterior ao envio' }]);
  }
  await tx.executar(
    `UPDATE dou_materias SET situacao = 'publicada', publicada_em = $2, edicao = $3, pagina = $4, url_publicacao = $5, forma_confirmacao = $6,
            modo_confirmacao = $7, publicacao_registrada_em = $8
      WHERE id = $1`,
    [materia.id, p.data, p.edicao, p.pagina, p.url, p.forma, p.modo, agora.toISOString()],
  );
  if (materia.tipo === 'aviso_licitacao' && materia.processo_id) {
    await tx.executar(
      `UPDATE processos SET publicacao = jsonb_set(publicacao, '{dou}', '"publicado"'::jsonb), atualizado_em = $2 WHERE id = $1`,
      [materia.processo_id, agora.toISOString()],
    );
  }
}

/**
 * Aviso de licitação gerado sozinho quando o edital é aceito no PNCP (publicação "em um clique": inteiro teor no
 * PNCP e extrato para o DOU). Roda na transação que conclui a publicação no PNCP. Dado do ato que impeça montar a
 * matéria não desfaz a publicação no PNCP: o motivo volta para a trilha e o aviso pode ser gerado na área do DOU.
 */
export async function gerarAvisoLicitacaoAutomatico(
  tx: Transacao,
  processoId: string,
  agora: Date,
): Promise<{ id: string; criada: boolean } | { erro: string }> {
  let ato: AtoMateria;
  let montada: MateriaDouMontada;
  try {
    ato = await atoDaMateria(tx, { tipo: 'aviso_licitacao', processoId }, null);
    montada = montarMateriaDou(ato.dados);
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }
  const existente = await materiaDoAto(tx, { tipo: 'aviso_licitacao', ...ato });
  if (existente && existente.situacao !== 'rascunho') return { id: existente.id, criada: false };
  return gravarMateria(tx, ato, montada, { usuarioId: null, automatica: true }, agora);
}
