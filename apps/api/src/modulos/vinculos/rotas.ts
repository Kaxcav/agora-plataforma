import type { EmpenhoSemContrato, EmpenhoSemItem, SugestaoVinculoContratoAta } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { normalizarBusca, palavrasSignificativas } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { idDaRota, uuid } from '../../http/validacao.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { SELECAO_EMPENHO, mapearEmpenho, type LinhaEmpenho } from '../financeiro/repositorio.ts';

const LIMITE_SUGESTOES = 200;

interface ContratoSemAta {
  id: string;
  numero: string;
  objeto: string;
  uasg: string;
  fornecedor_id: string;
  assinatura_em: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
}

interface AtaCandidata {
  id: string;
  numero: string;
  objeto: string;
  uasg: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  fornecedores: string[];
}

/** Semelhança de Jaccard entre as palavras significativas de dois objetos (0..1). */
function semelhanca(a: string, b: string): number {
  const pa = palavrasSignificativas(a);
  const pb = palavrasSignificativas(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns++;
  return comuns / (pa.size + pb.size - comuns);
}

/**
 * Sugestão de ata para contrato sem vínculo (heurística explicável, decisão humana):
 * mesmo fornecedor com itens na ata (+2), mesma UASG (+1), objeto semelhante (+1 ou +2), assinatura na vigência da ata (+1).
 */
function sugerirAta(contrato: ContratoSemAta, atas: readonly AtaCandidata[]): Omit<SugestaoVinculoContratoAta, 'contrato'> {
  let melhor: { ata: AtaCandidata; pontos: number; motivos: string[] } | null = null;
  for (const ata of atas) {
    const motivos: string[] = [];
    let pontos = 0;
    if (ata.fornecedores.includes(contrato.fornecedor_id)) {
      pontos += 2;
      motivos.push('o fornecedor tem itens registrados na ata');
    }
    if (ata.uasg === contrato.uasg) {
      pontos += 1;
      motivos.push('mesma UASG');
    }
    const s = semelhanca(contrato.objeto, ata.objeto);
    if (s >= 0.4) {
      pontos += 2;
      motivos.push('objeto muito semelhante');
    } else if (s >= 0.2) {
      pontos += 1;
      motivos.push('objeto semelhante');
    }
    if (contrato.assinatura_em >= ata.vigencia_inicio && contrato.assinatura_em <= ata.vigencia_fim) {
      pontos += 1;
      motivos.push('assinado durante a vigência da ata');
    }
    if (!melhor || pontos > melhor.pontos) melhor = { ata, pontos, motivos };
  }
  if (!melhor || melhor.pontos < 2) {
    return { ataSugerida: null, confianca: null, motivo: 'Nenhuma ata compatível encontrada no seu escopo. Verifique se o contrato decorre de ata.' };
  }
  const confianca = melhor.pontos >= 5 ? 'alta' : melhor.pontos >= 3 ? 'media' : 'baixa';
  const motivo = `Sugestão: ${melhor.motivos.join(', ')}. Confirme antes de vincular.`;
  return { ataSugerida: { id: melhor.ata.id, numero: melhor.ata.numero, objeto: melhor.ata.objeto }, confianca, motivo };
}

const esquemaContratoAta = z.object({ contratoId: uuid, ataId: uuid });
const esquemaEmpenhoContrato = z.object({ empenhoId: uuid, contratoId: uuid });
const esquemaEmpenhoItem = z.object({ empenhoId: uuid, itemContratoId: uuid });

export async function rotasVinculos(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('contratos:ler') };
  const escrita = { preHandler: exigir('vinculos:editar') };

  app.get('/vinculos/contratos-sem-ata', leitura, async (request): Promise<SugestaoVinculoContratoAta[]> => {
    const escopo = escopoUasgs(sessaoDe(request));
    const contratos = await ctx.banco.consultar<ContratoSemAta>(
      `SELECT c.id, c.numero, c.objeto, c.uasg, c.fornecedor_id, c.assinatura_em, f.tipo_pessoa, f.razao_social
         FROM contratos c JOIN fornecedores f ON f.id = c.fornecedor_id
        WHERE c.ata_id IS NULL AND c.origem = 'licitacao' AND ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        ORDER BY c.assinatura_em DESC, c.numero
        LIMIT $2`,
      [escopo, LIMITE_SUGESTOES],
    );
    const atas = await ctx.banco.consultar<AtaCandidata>(
      `SELECT a.id, a.numero, a.objeto, a.uasg, a.vigencia_inicio, a.vigencia_fim,
              COALESCE(array_agg(DISTINCT ia.fornecedor_id::text) FILTER (WHERE ia.fornecedor_id IS NOT NULL), '{}') AS fornecedores
         FROM atas a LEFT JOIN itens_ata ia ON ia.ata_id = a.id
        WHERE ($1::text[] IS NULL OR a.uasg = ANY($1::text[]))
        GROUP BY a.id, a.numero, a.objeto, a.uasg, a.vigencia_inicio, a.vigencia_fim`,
      [escopo],
    );
    return contratos.map((c) => ({
      contrato: { id: c.id, numero: c.numero, objeto: c.objeto, fornecedor: nomeExibivel(c.tipo_pessoa, c.razao_social) },
      ...sugerirAta(c, atas),
    }));
  });

  app.get('/vinculos/empenhos-sem-contrato', leitura, async (request): Promise<EmpenhoSemContrato[]> => {
    const escopo = escopoUasgs(sessaoDe(request));
    const empenhos = await ctx.banco.consultar<LinhaEmpenho>(
      `${SELECAO_EMPENHO}
        WHERE e.contrato_id IS NULL AND ($1::text[] IS NULL OR e.uasg = ANY($1::text[]))
        ORDER BY e.emissao_em DESC, e.numero
        LIMIT $2`,
      [escopo, LIMITE_SUGESTOES],
    );
    const candidatos = await ctx.banco.consultar<{
      id: string;
      numero: string;
      uasg: string;
      fornecedor_id: string;
      documento: string;
      vigencia_inicio: string;
      vigencia_fim: string;
      saldo: number;
    }>(
      `SELECT c.id, c.numero, c.uasg, c.fornecedor_id, f.documento, c.vigencia_inicio, c.vigencia_fim,
              (v.valor_global - v.valor_empenhado)::bigint AS saldo
         FROM contratos c
         JOIN fornecedores f ON f.id = c.fornecedor_id
         JOIN vw_contratos_valores v ON v.contrato_id = c.id
        WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))`,
      [escopo],
    );
    return empenhos.map((e) => {
      const compativeis = candidatos
        .filter(
          (c) =>
            c.uasg === e.uasg &&
            (c.fornecedor_id === e.fornecedor_id || c.documento === e.credor_documento) &&
            e.emissao_em >= c.vigencia_inicio &&
            e.emissao_em <= c.vigencia_fim,
        )
        .sort((a, b) => b.saldo - a.saldo);
      const sugerido = compativeis[0];
      return {
        empenho: mapearEmpenho(e),
        contratoSugerido: sugerido ? { id: sugerido.id, numero: sugerido.numero } : null,
        motivo: sugerido
          ? `Mesmo credor e mesma UASG, emitido durante a vigência do contrato${compativeis.length > 1 ? ` (${compativeis.length} contratos compatíveis; sugerido o de maior saldo a empenhar)` : ''}.`
          : 'Nenhum contrato vigente do mesmo credor na UASG do empenho. Pode ser despesa sem contrato (art. 95).',
      };
    });
  });

  app.get('/vinculos/empenhos-sem-item', leitura, async (request): Promise<EmpenhoSemItem[]> => {
    const escopo = escopoUasgs(sessaoDe(request));
    const empenhos = await ctx.banco.consultar<LinhaEmpenho>(
      `${SELECAO_EMPENHO}
        WHERE e.contrato_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM empenhos_itens ei WHERE ei.empenho_id = e.id)
          AND ($1::text[] IS NULL OR e.uasg = ANY($1::text[]))
        ORDER BY e.emissao_em DESC, e.numero
        LIMIT $2`,
      [escopo, LIMITE_SUGESTOES],
    );
    const contratoIds = [...new Set(empenhos.flatMap((e) => (e.contrato_id ? [e.contrato_id] : [])))];
    const itens =
      contratoIds.length === 0
        ? []
        : await ctx.banco.consultar<{ id: string; contrato_id: string; numero: number; descricao: string }>(
            `SELECT id, contrato_id, numero, descricao FROM itens_contrato WHERE contrato_id = ANY($1::uuid[]) ORDER BY numero`,
            [contratoIds],
          );
    return empenhos.flatMap((e) =>
      e.contrato_id && e.contrato_numero
        ? [
            {
              empenho: mapearEmpenho(e),
              contrato: { id: e.contrato_id, numero: e.contrato_numero },
              itensCandidatos: itens
                .filter((i) => i.contrato_id === e.contrato_id)
                .map((i) => ({ id: i.id, numero: i.numero, descricao: i.descricao })),
            },
          ]
        : [],
    );
  });

  async function contratoNoEscopo(tx: Transacao, request: FastifyRequest, id: string) {
    const [contrato] = await tx.consultar<{ id: string; numero: string; uasg: string; ata_id: string | null; fornecedor_id: string }>(
      `SELECT id, numero, uasg, ata_id, fornecedor_id FROM contratos
        WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[])) FOR UPDATE`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!contrato) throw naoEncontrado('Contrato não encontrado.');
    return contrato;
  }

  async function empenhoNoEscopo(tx: Transacao, request: FastifyRequest, id: string) {
    const [empenho] = await tx.consultar<{ id: string; numero: string; uasg: string; contrato_id: string | null; valor_empenhado: number }>(
      `SELECT id, numero, uasg, contrato_id, valor_empenhado FROM empenhos
        WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[])) FOR UPDATE`,
      [id, escopoUasgs(sessaoDe(request))],
    );
    if (!empenho) throw naoEncontrado('Empenho não encontrado.');
    return empenho;
  }

  app.post('/vinculos/contrato-ata', escrita, async (request, reply) => {
    const corpo = esquemaContratoAta.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoNoEscopo(tx, request, corpo.contratoId.toLowerCase());
      const [ata] = await tx.consultar<{ id: string; numero: string }>(
        `SELECT id, numero FROM atas WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))`,
        [corpo.ataId.toLowerCase(), escopoUasgs(sessaoDe(request))],
      );
      if (!ata) throw naoEncontrado('Ata não encontrada.');
      if (contrato.ata_id !== null) throw conflito('O contrato já está vinculado a uma ata. Desfaça o vínculo atual antes.');
      await tx.executar(
        `UPDATE contratos
            SET ata_id = $2, atualizado_em = $3,
                campos_editados = CASE WHEN 'ata_id' = ANY(campos_editados) THEN campos_editados ELSE array_append(campos_editados, 'ata_id') END
          WHERE id = $1`,
        [contrato.id, ata.id, ctx.relogio().toISOString()],
      );
      const mapeados = await mapearItensPelaDescricao(tx, contrato.id, ata.id, contrato.fornecedor_id);
      await auditar(tx, request, {
        acao: 'vinculo.contrato_ata.criar',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Vinculou o contrato ${contrato.numero} à ata ${ata.numero}`,
        dados: { instrumentoTipo: 'ata', instrumentoId: ata.id, ataId: ata.id, itensAssociados: mapeados },
      });
    });
    return reply.status(204).send();
  });

  app.delete('/vinculos/contrato-ata/:contratoId', escrita, async (request, reply) => {
    const contratoId = idDaRota(request.params, 'contratoId');
    await ctx.banco.transacao(async (tx) => {
      const contrato = await contratoNoEscopo(tx, request, contratoId);
      if (contrato.ata_id === null) throw conflito('O contrato não está vinculado a uma ata.');
      const desassociados = await tx.executar('UPDATE itens_contrato SET item_ata_id = NULL WHERE contrato_id = $1 AND item_ata_id IS NOT NULL', [
        contrato.id,
      ]);
      await tx.executar(`UPDATE contratos SET ata_id = NULL, atualizado_em = $2 WHERE id = $1`, [contrato.id, ctx.relogio().toISOString()]);
      await auditar(tx, request, {
        acao: 'vinculo.contrato_ata.desfazer',
        recurso: 'contrato',
        recursoId: contrato.id,
        resumo: `Desfez o vínculo do contrato ${contrato.numero} com a ata`,
        dados: { instrumentoTipo: 'ata', instrumentoId: contrato.ata_id, ataId: contrato.ata_id, itensDesassociados: desassociados },
      });
    });
    return reply.status(204).send();
  });

  app.post('/vinculos/empenho-contrato', escrita, async (request, reply) => {
    const corpo = esquemaEmpenhoContrato.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const empenho = await empenhoNoEscopo(tx, request, corpo.empenhoId.toLowerCase());
      const contrato = await contratoNoEscopo(tx, request, corpo.contratoId.toLowerCase());
      if (empenho.contrato_id !== null) throw conflito('O empenho já está vinculado a um contrato. Desfaça o vínculo atual antes.');
      if (empenho.uasg !== contrato.uasg) throw regraNegocio('O empenho e o contrato pertencem a UASGs diferentes.');
      await tx.executar('UPDATE empenhos SET contrato_id = $2 WHERE id = $1', [empenho.id, contrato.id]);
      await auditar(tx, request, {
        acao: 'vinculo.empenho_contrato.criar',
        recurso: 'empenho',
        recursoId: empenho.id,
        resumo: `Vinculou o empenho ${empenho.numero} ao contrato ${contrato.numero}`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: contrato.id, contratoId: contrato.id },
      });
    });
    return reply.status(204).send();
  });

  app.delete('/vinculos/empenho-contrato/:empenhoId', escrita, async (request, reply) => {
    const empenhoId = idDaRota(request.params, 'empenhoId');
    await ctx.banco.transacao(async (tx) => {
      const empenho = await empenhoNoEscopo(tx, request, empenhoId);
      if (empenho.contrato_id === null) throw conflito('O empenho não está vinculado a um contrato.');
      const itensRemovidos = await tx.executar('DELETE FROM empenhos_itens WHERE empenho_id = $1', [empenho.id]);
      await tx.executar('UPDATE empenhos SET contrato_id = NULL WHERE id = $1', [empenho.id]);
      await auditar(tx, request, {
        acao: 'vinculo.empenho_contrato.desfazer',
        recurso: 'empenho',
        recursoId: empenho.id,
        resumo: `Desfez o vínculo do empenho ${empenho.numero} com o contrato`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: empenho.contrato_id, contratoId: empenho.contrato_id, itensRemovidos },
      });
    });
    return reply.status(204).send();
  });

  app.post('/vinculos/empenho-item', escrita, async (request, reply) => {
    const corpo = esquemaEmpenhoItem.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const empenho = await empenhoNoEscopo(tx, request, corpo.empenhoId.toLowerCase());
      if (empenho.contrato_id === null) throw regraNegocio('Vincule o empenho a um contrato antes de associá-lo a itens.');
      const [item] = await tx.consultar<{ id: string; numero: number; contrato_id: string; quantidade: number; valor_unitario: number; quantidade_empenhada: number }>(
        `SELECT ic.id, ic.numero, ic.contrato_id, ic.quantidade, ic.valor_unitario, s.quantidade_empenhada
           FROM itens_contrato ic JOIN vw_itens_contrato_saldos s ON s.item_contrato_id = ic.id
          WHERE ic.id = $1`,
        [corpo.itemContratoId.toLowerCase()],
      );
      if (!item) throw naoEncontrado('Item de contrato não encontrado.');
      if (item.contrato_id !== empenho.contrato_id) throw regraNegocio('O item não pertence ao contrato vinculado ao empenho.');
      const saldoQuantidade = Math.max(0, item.quantidade - item.quantidade_empenhada);
      const quantidade = item.valor_unitario > 0 ? Math.min(saldoQuantidade, Math.floor(empenho.valor_empenhado / item.valor_unitario)) : 0;
      const inseridos = await tx.executar(
        `INSERT INTO empenhos_itens (empenho_id, item_contrato_id, quantidade, valor) VALUES ($1, $2, $3, $4)
         ON CONFLICT (empenho_id, item_contrato_id) DO NOTHING`,
        [empenho.id, item.id, quantidade, quantidade * item.valor_unitario],
      );
      if (inseridos === 0) throw conflito('O empenho já está associado a este item.');
      await auditar(tx, request, {
        acao: 'vinculo.empenho_item.criar',
        recurso: 'empenho',
        recursoId: empenho.id,
        resumo: `Associou o empenho ${empenho.numero} ao item ${item.numero} do contrato`,
        dados: { instrumentoTipo: 'contrato', instrumentoId: item.contrato_id, itemContratoId: item.id, quantidade },
      });
    });
    return reply.status(204).send();
  });
}

/** Ao vincular, associa itens do contrato aos itens da ata do mesmo fornecedor com a mesma descrição. */
async function mapearItensPelaDescricao(tx: Transacao, contratoId: string, ataId: string, fornecedorId: string): Promise<number> {
  const itensContrato = await tx.consultar<{ id: string; descricao: string }>(
    'SELECT id, descricao FROM itens_contrato WHERE contrato_id = $1 AND item_ata_id IS NULL',
    [contratoId],
  );
  const itensAta = await tx.consultar<{ id: string; descricao: string }>(
    'SELECT id, descricao FROM itens_ata WHERE ata_id = $1 AND fornecedor_id = $2',
    [ataId, fornecedorId],
  );
  let associados = 0;
  for (const item of itensContrato) {
    const correspondente = itensAta.find((i) => normalizarBusca(i.descricao) === normalizarBusca(item.descricao));
    if (correspondente) {
      associados += await tx.executar('UPDATE itens_contrato SET item_ata_id = $2 WHERE id = $1', [item.id, correspondente.id]);
    }
  }
  return associados;
}
