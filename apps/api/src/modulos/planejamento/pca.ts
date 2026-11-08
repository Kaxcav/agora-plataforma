/**
 * Plano de contratações anual (F10, RF-31): leitura dos planos por UASG e exercício, registro das demandas,
 * consolidação (`consolidarPca`), devolução e aprovação (`validarTransicaoPca`). A publicação no PNCP segue pela fila de
 * integrações (`publicacao.ts`). Toda escrita acontece na transação da rota, com evento na trilha de auditoria.
 */
import { randomUUID } from 'node:crypto';
import { consolidarPca, identificadorItemPca, validarTransicaoPca, type AcaoPca, type DemandaPca } from '@agora/dominio';
import type {
  CategoriaPca,
  DemandaPlanoContratacoes,
  EntradaDemandaPca,
  ItemPlanoContratacoes,
  PlanoContratacoesDetalhe,
  PrioridadeDemandaPca,
  PublicacaoPca,
  ResumoPlanoContratacoes,
  SituacaoPlanoContratacoes,
  SituacaoTarefaFila,
  TipoItemCatalogo,
} from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

export const FUNDAMENTO_PCA = 'Lei 14.133/2021, art. 12, VII e § 1º; Decreto 10.947/2022, arts. 8º, 11, 12 e 14';

export interface LinhaPlano {
  id: string;
  uasg: string;
  uasg_nome: string;
  ano: number;
  situacao: SituacaoPlanoContratacoes;
  origem: 'agora' | 'pncp';
  consolidado_por: string | null;
  consolidado_por_nome: string | null;
  consolidado_em: string | null;
  aprovado_por: string | null;
  aprovado_por_nome: string | null;
  aprovado_em: string | null;
  devolucao_motivo: string | null;
  devolvido_por: string | null;
  devolvido_por_nome: string | null;
  devolvido_em: string | null;
  tarefa_publicacao_id: string | null;
  tarefa_situacao: SituacaoTarefaFila | null;
  tarefa_tentativas: number | null;
  tarefa_erro: string | null;
  id_pncp: string | null;
  protocolo_pncp: string | null;
  modo_publicacao: 'offline' | 'online' | null;
  hash_envio: string | null;
  publicado_em: string | null;
  demandas: number;
  itens: number;
  valor_total: number;
}

const SELECAO_PLANO = `
  SELECT p.id, p.uasg, u.nome AS uasg_nome, p.ano, p.situacao, p.origem,
         p.consolidado_por, uc.nome AS consolidado_por_nome, p.consolidado_em,
         p.aprovado_por, ua.nome AS aprovado_por_nome, p.aprovado_em,
         p.devolucao_motivo, p.devolvido_por, ud.nome AS devolvido_por_nome, p.devolvido_em,
         p.tarefa_publicacao_id, t.situacao AS tarefa_situacao, t.tentativas AS tarefa_tentativas, t.ultimo_erro AS tarefa_erro,
         p.id_pncp, p.protocolo_pncp, p.modo_publicacao, p.hash_envio, p.publicado_em,
         (SELECT COUNT(*)::integer FROM pca_demandas d WHERE d.plano_id = p.id) AS demandas,
         (SELECT COUNT(*)::integer FROM pca_itens i WHERE i.plano_id = p.id) AS itens,
         COALESCE(
           (SELECT SUM(i.valor_total) FROM pca_itens i WHERE i.plano_id = p.id),
           (SELECT SUM(ROUND(d.quantidade * d.valor_unitario)) FROM pca_demandas d WHERE d.plano_id = p.id),
           0
         )::bigint AS valor_total
    FROM pca_planos p
    JOIN uasgs u ON u.codigo = p.uasg
    LEFT JOIN usuarios uc ON uc.id = p.consolidado_por
    LEFT JOIN usuarios ua ON ua.id = p.aprovado_por
    LEFT JOIN usuarios ud ON ud.id = p.devolvido_por
    LEFT JOIN fila_tarefas t ON t.id = p.tarefa_publicacao_id`;

function publicacaoDe(l: LinhaPlano): PublicacaoPca | null {
  if (l.situacao === 'publicado') {
    return {
      situacao: 'publicado',
      idPncp: l.id_pncp,
      protocolo: l.protocolo_pncp,
      modo: l.modo_publicacao,
      hashEnvio: l.hash_envio,
      publicadoEm: l.publicado_em,
      tentativas: l.tarefa_tentativas ?? 0,
      ultimoErro: null,
    };
  }
  if (l.tarefa_publicacao_id === null) return null;
  return {
    situacao: l.tarefa_situacao === 'erro' ? 'erro' : 'na_fila',
    idPncp: l.id_pncp,
    protocolo: l.protocolo_pncp,
    modo: l.modo_publicacao,
    hashEnvio: l.hash_envio,
    publicadoEm: null,
    tentativas: l.tarefa_tentativas ?? 0,
    ultimoErro: l.tarefa_erro,
  };
}

export function resumoPlano(l: LinhaPlano): ResumoPlanoContratacoes {
  return {
    id: l.id,
    uasg: l.uasg,
    uasgNome: l.uasg_nome,
    ano: l.ano,
    situacao: l.situacao,
    origem: l.origem,
    demandas: l.demandas,
    itens: l.itens,
    valorTotal: l.valor_total,
    publicacao: publicacaoDe(l),
  };
}

export async function listarPlanos(
  executor: Executor,
  filtro: { escopo: string[] | null; ano?: number | undefined; uasg?: string | undefined },
): Promise<ResumoPlanoContratacoes[]> {
  const linhas = await executor.consultar<LinhaPlano>(
    `${SELECAO_PLANO}
      WHERE ($1::text[] IS NULL OR p.uasg = ANY($1::text[]))
        AND ($2::integer IS NULL OR p.ano = $2)
        AND ($3::text IS NULL OR p.uasg = $3)
      ORDER BY p.ano DESC, p.uasg`,
    [filtro.escopo, filtro.ano ?? null, filtro.uasg ?? null],
  );
  return linhas.map(resumoPlano);
}

/** Plano no escopo de UASG (`bloquear` trava a linha até o fim da transação). */
export async function obterLinhaPlano(executor: Executor, id: string, escopo: string[] | null, bloquear = false): Promise<LinhaPlano | null> {
  if (bloquear) {
    // FOR UPDATE não se combina com as subconsultas agregadas: trava a linha antes e lê depois.
    const [travada] = await executor.consultar<{ id: string }>(
      'SELECT id FROM pca_planos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[])) FOR UPDATE',
      [id, escopo],
    );
    if (!travada) return null;
  }
  const [linha] = await executor.consultar<LinhaPlano>(
    `${SELECAO_PLANO}
      WHERE p.id = $1 AND ($2::text[] IS NULL OR p.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  return linha ?? null;
}

interface LinhaDemanda {
  id: string;
  unidade_requisitante: string;
  descricao: string;
  codigo_catalogo: string | null;
  tipo_catalogo: TipoItemCatalogo | null;
  unidade_fornecimento: string;
  categoria: CategoriaPca;
  quantidade: number;
  valor_unitario: number;
  data_desejada: string;
  prioridade: PrioridadeDemandaPca;
  item_numero: number | null;
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
}

async function demandasDoPlano(executor: Executor, planoId: string): Promise<LinhaDemanda[]> {
  return executor.consultar<LinhaDemanda>(
    `SELECT d.id, d.unidade_requisitante, d.descricao, d.codigo_catalogo, d.tipo_catalogo, d.unidade_fornecimento, d.categoria,
            d.quantidade, d.valor_unitario, d.data_desejada, d.prioridade, i.numero AS item_numero,
            d.registrada_por, u.nome AS registrada_por_nome, d.registrada_em
       FROM pca_demandas d
       LEFT JOIN pca_itens i ON i.id = d.item_id
       LEFT JOIN usuarios u ON u.id = d.registrada_por
      WHERE d.plano_id = $1
      ORDER BY d.registrada_em, d.id`,
    [planoId],
  );
}

interface LinhaItem {
  id: string;
  numero: number;
  descricao: string;
  codigo_catalogo: string | null;
  tipo_catalogo: TipoItemCatalogo | null;
  unidade_fornecimento: string;
  categoria: CategoriaPca;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  data_desejada: string;
  prioridade: PrioridadeDemandaPca;
  unidades_requisitantes: string[];
  demandas: number;
}

async function itensDoPlano(executor: Executor, planoId: string): Promise<LinhaItem[]> {
  return executor.consultar<LinhaItem>(
    `SELECT i.id, i.numero, i.descricao, i.codigo_catalogo, i.tipo_catalogo, i.unidade_fornecimento, i.categoria, i.quantidade,
            i.valor_unitario, i.valor_total, i.data_desejada, i.prioridade, i.unidades_requisitantes,
            (SELECT COUNT(*)::integer FROM pca_demandas d WHERE d.item_id = i.id) AS demandas
       FROM pca_itens i
      WHERE i.plano_id = $1
      ORDER BY i.numero`,
    [planoId],
  );
}

export async function detalharPlano(executor: Executor, l: LinhaPlano): Promise<PlanoContratacoesDetalhe> {
  const demandas = await demandasDoPlano(executor, l.id);
  const itens = await itensDoPlano(executor, l.id);
  return {
    ...resumoPlano(l),
    demandasRegistradas: demandas.map(
      (d): DemandaPlanoContratacoes => ({
        id: d.id,
        unidadeRequisitante: d.unidade_requisitante,
        descricao: d.descricao,
        codigoCatalogo: d.codigo_catalogo,
        tipoCatalogo: d.tipo_catalogo,
        unidadeFornecimento: d.unidade_fornecimento,
        quantidade: d.quantidade,
        valorUnitario: d.valor_unitario,
        valorTotal: Math.round(d.quantidade * d.valor_unitario),
        dataDesejada: d.data_desejada,
        prioridade: d.prioridade,
        categoria: d.categoria,
        itemNumero: d.item_numero,
        registradaPor: usuarioResumo(d.registrada_por, d.registrada_por_nome),
        registradaEm: d.registrada_em,
      }),
    ),
    itensConsolidados: itens.map(
      (i): ItemPlanoContratacoes => ({
        id: i.id,
        numero: i.numero,
        identificador: identificadorItemPca({ uasg: l.uasg, ano: l.ano, numero: i.numero }),
        descricao: i.descricao,
        codigoCatalogo: i.codigo_catalogo,
        tipoCatalogo: i.tipo_catalogo,
        unidadeFornecimento: i.unidade_fornecimento,
        categoria: i.categoria,
        quantidade: i.quantidade,
        valorUnitario: i.valor_unitario,
        valorTotal: i.valor_total,
        dataDesejada: i.data_desejada,
        prioridade: i.prioridade,
        unidadesRequisitantes: i.unidades_requisitantes,
        demandas: i.demandas,
      }),
    ),
    consolidadoPor: usuarioResumo(l.consolidado_por, l.consolidado_por_nome),
    consolidadoEm: l.consolidado_em,
    aprovadoPor: usuarioResumo(l.aprovado_por, l.aprovado_por_nome),
    aprovadoEm: l.aprovado_em,
    devolucao:
      l.devolucao_motivo !== null && l.devolvido_em !== null
        ? { motivo: l.devolucao_motivo, em: l.devolvido_em, por: usuarioResumo(l.devolvido_por, l.devolvido_por_nome) }
        : null,
    fundamento: FUNDAMENTO_PCA,
  };
}

// ───────────────────────── escrita ─────────────────────────

export async function inserirPlano(tx: Transacao, p: { id?: string; uasg: string; ano: number; situacao?: SituacaoPlanoContratacoes; origem?: 'agora' | 'pncp'; criadoPor: string | null }, agora: Date): Promise<string> {
  const id = p.id ?? randomUUID();
  await tx.executar(
    `INSERT INTO pca_planos (id, uasg, ano, situacao, origem, criado_por, criado_em, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [id, p.uasg, p.ano, p.situacao ?? 'em_elaboracao', p.origem ?? 'agora', p.criadoPor, agora.toISOString()],
  );
  return id;
}

export async function inserirDemanda(tx: Transacao, planoId: string, d: EntradaDemandaPca, usuarioId: string | null, agora: Date, id: string = randomUUID()): Promise<string> {
  await tx.executar(
    `INSERT INTO pca_demandas (id, plano_id, unidade_requisitante, descricao, codigo_catalogo, tipo_catalogo, unidade_fornecimento, categoria,
                               quantidade, valor_unitario, data_desejada, prioridade, registrada_por, registrada_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      planoId,
      d.unidadeRequisitante.trim(),
      d.descricao.trim(),
      d.codigoCatalogo,
      d.codigoCatalogo === null ? null : d.tipoCatalogo,
      d.unidadeFornecimento.trim(),
      d.categoria,
      d.quantidade,
      d.valorUnitario,
      d.dataDesejada,
      d.prioridade,
      usuarioId,
      agora.toISOString(),
    ],
  );
  await tx.executar('UPDATE pca_planos SET atualizado_em = $2 WHERE id = $1', [planoId, agora.toISOString()]);
  return id;
}

/** Demandas do plano no formato do domínio, na ordem de registro. */
export async function demandasParaConsolidar(executor: Executor, planoId: string): Promise<DemandaPca[]> {
  return (await demandasDoPlano(executor, planoId)).map((d) => ({
    id: d.id,
    unidadeRequisitante: d.unidade_requisitante,
    descricao: d.descricao,
    codigoCatalogo: d.codigo_catalogo,
    tipoCatalogo: d.tipo_catalogo,
    unidadeFornecimento: d.unidade_fornecimento,
    quantidade: d.quantidade,
    valorUnitario: d.valor_unitario,
    dataDesejada: d.data_desejada,
    prioridade: d.prioridade,
    categoria: d.categoria,
  }));
}

/**
 * Consolida as demandas em itens numerados (Decreto 10.947/2022, art. 11), substituindo uma consolidação anterior
 * desfeita pela devolução. Devolve o resultado do domínio para a trilha.
 */
export async function gravarConsolidacao(
  tx: Transacao,
  plano: Pick<LinhaPlano, 'id' | 'ano' | 'situacao'>,
  usuarioId: string,
  agora: Date,
  novoId: () => string = randomUUID,
): Promise<ReturnType<typeof consolidarPca>> {
  const proxima = validarTransicaoPca(plano.situacao, 'consolidar');
  const resultado = consolidarPca(await demandasParaConsolidar(tx, plano.id), plano.ano);
  await tx.executar('UPDATE pca_demandas SET item_id = NULL WHERE plano_id = $1', [plano.id]);
  await tx.executar('DELETE FROM pca_itens WHERE plano_id = $1', [plano.id]);
  for (const item of resultado.itens) {
    const itemId = novoId();
    await tx.executar(
      `INSERT INTO pca_itens (id, plano_id, numero, descricao, codigo_catalogo, tipo_catalogo, unidade_fornecimento, categoria, quantidade,
                              valor_unitario, valor_total, data_desejada, prioridade, unidades_requisitantes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [
        itemId,
        plano.id,
        item.numero,
        item.descricao,
        item.codigoCatalogo,
        item.tipoCatalogo,
        item.unidadeFornecimento,
        item.categoria,
        item.quantidade,
        item.valorUnitario,
        item.valorTotal,
        item.dataDesejada,
        item.prioridade,
        JSON.stringify(item.unidadesRequisitantes),
      ],
    );
    await tx.executar('UPDATE pca_demandas SET item_id = $1 WHERE id = ANY($2::uuid[])', [itemId, item.demandas]);
  }
  await tx.executar(
    `UPDATE pca_planos SET situacao = $2, consolidado_por = $3, consolidado_em = $4, atualizado_em = $4 WHERE id = $1`,
    [plano.id, proxima, usuarioId, agora.toISOString()],
  );
  return resultado;
}

/** Transição simples do ciclo (devolver, aprovar, publicar), com os campos do ato. */
export async function registrarTransicao(
  tx: Transacao,
  plano: LinhaPlano,
  acao: Exclude<AcaoPca, 'consolidar'>,
  dados: { usuarioId: string | null; motivo?: string; tarefaId?: string },
  agora: Date,
): Promise<void> {
  const proxima = validarTransicaoPca(plano.situacao, acao);
  const instante = agora.toISOString();
  if (acao === 'devolver') {
    await tx.executar('UPDATE pca_demandas SET item_id = NULL WHERE plano_id = $1', [plano.id]);
    await tx.executar('DELETE FROM pca_itens WHERE plano_id = $1', [plano.id]);
    await tx.executar(
      `UPDATE pca_planos SET situacao = $2, devolucao_motivo = $3, devolvido_por = $4, devolvido_em = $5, consolidado_por = NULL,
                             consolidado_em = NULL, atualizado_em = $5 WHERE id = $1`,
      [plano.id, proxima, dados.motivo ?? '', dados.usuarioId, instante],
    );
  } else if (acao === 'aprovar') {
    await tx.executar(
      `UPDATE pca_planos SET situacao = $2, aprovado_por = $3, aprovado_em = $4, tarefa_publicacao_id = $5, atualizado_em = $4 WHERE id = $1`,
      [plano.id, proxima, dados.usuarioId, instante, dados.tarefaId ?? null],
    );
  } else {
    await tx.executar(`UPDATE pca_planos SET situacao = $2, publicado_em = $3, atualizado_em = $3 WHERE id = $1`, [plano.id, proxima, instante]);
  }
}
