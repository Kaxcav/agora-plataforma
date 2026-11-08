/**
 * Consulta do PCA publicado no PNCP para a UASG (F10, RF-31), feita só pelo servidor:
 *   * online: lê o PNCP pelo conector (`consultarPcaPublicadoPncp`) e grava os planos encontrados como planos de origem
 *     'pncp' — itens atualizados pelo número, nunca apagados (o DFD pode apontá-los). Plano elaborado na própria Ágora
 *     para o mesmo exercício não é sobrescrito;
 *   * offline (padrão): os planos publicados da carga sintética e os publicados pela Ágora fazem o papel do PNCP, com
 *     resposta determinística.
 * Cada consulta grava a proveniência (modo, endereço, quantidade e hash) e o evento na trilha de auditoria.
 */
import { randomUUID } from 'node:crypto';
import { jsonCanonico, registrarEvento } from '../../auditoria/trilha.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { ErroApi } from '../../http/erros.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { consultarPcaPublicadoPncp, type PlanoPcaLido } from '../../integracoes/pncp-pca.ts';
import { opcoesHttpPadrao } from '../../integracoes/precos/http.ts';
import { inserirPlano } from './pca.ts';

/** Grava (ou atualiza) o plano lido do PNCP; devolve false se a Ágora já tem plano próprio para a UASG e o exercício. */
async function importarPlano(tx: Transacao, plano: PlanoPcaLido, agora: Date): Promise<boolean> {
  const [existente] = await tx.consultar<{ id: string; origem: 'agora' | 'pncp' }>('SELECT id, origem FROM pca_planos WHERE uasg = $1 AND ano = $2 FOR UPDATE', [
    plano.uasg,
    plano.ano,
  ]);
  if (existente && existente.origem === 'agora') return false;
  const id = existente?.id ?? (await inserirPlano(tx, { uasg: plano.uasg, ano: plano.ano, situacao: 'publicado', origem: 'pncp', criadoPor: null }, agora));
  await tx.executar(
    `UPDATE pca_planos SET situacao = 'publicado', id_pncp = $2, publicado_em = COALESCE($3::timestamptz, publicado_em, $4::timestamptz),
                           atualizado_em = $4 WHERE id = $1`,
    [id, plano.idPcaPncp, plano.publicadoEm, agora.toISOString()],
  );
  for (const i of plano.itens) {
    await tx.executar(
      `INSERT INTO pca_itens (id, plano_id, numero, descricao, codigo_catalogo, tipo_catalogo, unidade_fornecimento, categoria, quantidade,
                              valor_unitario, valor_total, data_desejada, prioridade, unidades_requisitantes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'media', $13::jsonb)
       ON CONFLICT (plano_id, numero) DO UPDATE
          SET descricao = EXCLUDED.descricao, codigo_catalogo = EXCLUDED.codigo_catalogo, tipo_catalogo = EXCLUDED.tipo_catalogo,
              unidade_fornecimento = EXCLUDED.unidade_fornecimento, categoria = EXCLUDED.categoria, quantidade = EXCLUDED.quantidade,
              valor_unitario = EXCLUDED.valor_unitario, valor_total = EXCLUDED.valor_total, data_desejada = EXCLUDED.data_desejada,
              unidades_requisitantes = EXCLUDED.unidades_requisitantes`,
      [
        randomUUID(),
        id,
        i.numero,
        i.descricao,
        i.codigoCatalogo,
        i.tipoCatalogo,
        i.unidadeFornecimento,
        i.categoria,
        i.quantidade,
        i.valorUnitario,
        i.valorTotal,
        i.dataDesejada,
        JSON.stringify(i.unidadeRequisitante ? [i.unidadeRequisitante] : []),
      ],
    );
  }
  return true;
}

/** Consulta o PCA publicado da UASG para os exercícios indicados e registra a proveniência. */
export async function consultarPcaDaUasg(
  ctx: ContextoApp,
  pedido: { uasg: string; anos: readonly number[]; usuarioId: string | null; ipHash: string | null },
): Promise<void> {
  const agora = ctx.relogio();
  for (const ano of pedido.anos) {
    let modo: 'offline' | 'online' = 'offline';
    let endereco: string | null = null;
    let hash: string;
    let registros: number;
    let ignorado = false;
    let lidos: PlanoPcaLido[] = [];
    if (ctx.config.integracoes === 'online') {
      const cnpj = ctx.config.orgao.cnpj;
      if (!cnpj) throw new ErroApi(422, 'REGRA_NEGOCIO', 'AGORA_ORGAO_CNPJ não configurado: informe o CNPJ do órgão para consultar o PCA no PNCP.');
      try {
        const r = await consultarPcaPublicadoPncp(ctx.fetch, ctx.config.planejamento.pncpConsultaUrl, opcoesHttpPadrao(ctx.config.precos.timeoutMs), {
          cnpj,
          uasg: pedido.uasg,
          ano,
          hoje: ctx.hoje(),
        });
        modo = 'online';
        endereco = r.endereco;
        hash = r.hash;
        registros = r.registros;
        lidos = r.planos;
      } catch (erro) {
        if (erro instanceof ErroIntegracao) throw new ErroApi(503, 'INDISPONIVEL', erro.message);
        throw erro;
      }
    } else {
      const itens = await ctx.banco.consultar<{ numero: number; descricao: string; codigo_catalogo: string | null; quantidade: number; valor_total: number }>(
        `SELECT i.numero, i.descricao, i.codigo_catalogo, i.quantidade, i.valor_total
           FROM pca_itens i JOIN pca_planos p ON p.id = i.plano_id
          WHERE p.uasg = $1 AND p.ano = $2 AND p.situacao = 'publicado'
          ORDER BY i.numero`,
        [pedido.uasg, ano],
      );
      hash = sha256Hex(jsonCanonico(itens));
      registros = itens.length;
    }
    await ctx.banco.transacao(async (tx) => {
      for (const plano of lidos) if (!(await importarPlano(tx, plano, agora))) ignorado = true;
      await tx.executar(
        `INSERT INTO pca_consultas_pncp (id, uasg, ano, modo, endereco, registros, hash_conteudo, consultado_por, consultado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), pedido.uasg, ano, modo, endereco, registros, hash, pedido.usuarioId, agora.toISOString()],
      );
      await registrarEvento(
        tx,
        {
          usuarioId: pedido.usuarioId,
          acao: 'pca.consultar_pncp',
          recurso: 'pca',
          recursoId: null,
          resumo: `Consultou o PCA ${ano} publicado da UASG ${pedido.uasg}${modo === 'online' ? ' no PNCP' : ' (modo offline)'}: ${registros} ${registros === 1 ? 'item' : 'itens'}`,
          dados: { uasg: pedido.uasg, ano, modo, endereco, registros, hash, planoProprioMantido: ignorado },
          ipHash: pedido.ipHash,
        },
        agora,
      );
    });
  }
}
