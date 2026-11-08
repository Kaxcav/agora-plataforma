import { INFRACOES_ART_155, calcularDosimetriaMulta, prazoDefesa, sancoesCabiveis, type IncisoInfracao } from '@agora/dominio';
import type { Pagina, ResultadoDosimetria, Sancao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, centavos, dataIso, deslocamento, pagina, uuid } from '../../http/validacao.ts';
import { rotuloSancao } from '../fornecedores/repositorio.ts';
import { listarSancoes } from './repositorio.ts';

const TIPOS_SANCAO = ['advertencia', 'multa', 'impedimento_licitar', 'declaracao_inidoneidade'] as const;
const INCISOS = INFRACOES_ART_155.map((i) => i.inciso);

function ehInciso(valor: string): valor is IncisoInfracao {
  return (INCISOS as readonly string[]).includes(valor);
}

const esquemaFiltro = z.object({
  situacao: z.enum(['em_instrucao', 'defesa', 'decisao', 'aplicada', 'arquivada']).optional(),
  tipo: z.enum(TIPOS_SANCAO).optional(),
  ...camposPaginacao,
});

const esquemaInstaurar = z.object({
  fornecedorId: uuid,
  contratoId: uuid.nullable(),
  incisoInfracao: z.string().trim().toUpperCase().refine(ehInciso, 'Inciso do art. 155 inválido (use I a XII)'),
  tipo: z.enum(TIPOS_SANCAO),
  intimacaoEm: dataIso,
  relato: z.string().trim().min(20).max(5000),
});

const esquemaDosimetria = z.object({
  valorContrato: centavos.positive(),
  gravidade: z.enum(['leve', 'media', 'grave', 'gravissima']),
  agravantes: z.array(z.string().trim().min(1).max(200)).max(20),
  atenuantes: z.array(z.string().trim().min(1).max(200)).max(20),
  programaIntegridade: z.boolean(),
  danoAdministracao: z.boolean(),
});

export async function rotasSancoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/sancoes', { preHandler: exigir('sancoes:ler') }, async (request): Promise<Pagina<Sancao>> => {
    const f = esquemaFiltro.parse(request.query);
    const { itens, total } = await listarSancoes(
      ctx.banco,
      { escopo: escopoUasgs(sessaoDe(request)), situacao: f.situacao, tipo: f.tipo },
      f.tamanhoPagina,
      deslocamento(f.pagina, f.tamanhoPagina),
    );
    return pagina(itens, total, f.pagina, f.tamanhoPagina);
  });

  /**
   * Instauração de processo sancionatório (decisão humana; a Ágora só calcula prazos e confere cabimento).
   * Prazo de defesa de 15 dias úteis a partir da intimação (arts. 157 e 158), por @agora/dominio.
   */
  app.post('/sancoes', { preHandler: exigir('sancoes:instruir') }, async (request, reply): Promise<Sancao> => {
    const entrada = esquemaInstaurar.parse(request.body);
    if (!ehInciso(entrada.incisoInfracao)) throw regraNegocio('Inciso do art. 155 inválido.');
    const inciso = entrada.incisoInfracao;
    const cabiveis = sancoesCabiveis(inciso);
    if (!cabiveis.some((c) => c.tipo === entrada.tipo)) {
      throw regraNegocio(
        `${rotuloSancao(entrada.tipo)} não é cabível para a infração do inciso ${inciso} do art. 155.`,
        cabiveis.map((c) => ({ campo: 'tipo', mensagem: `${rotuloSancao(c.tipo)}: ${c.condicao} (${c.fundamento})` })),
      );
    }
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const fornecedorId = entrada.fornecedorId.toLowerCase();
    const contratoId = entrada.contratoId === null ? null : entrada.contratoId.toLowerCase();
    const defesa = prazoDefesa(entrada.intimacaoEm, await opcoesCalendario(ctx.banco));

    const id = await ctx.banco.transacao(async (tx) => {
      const [fornecedor] = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE id = $1', [fornecedorId]);
      if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
      if (contratoId !== null) {
        const [contrato] = await tx.consultar<{ fornecedor_id: string }>(
          'SELECT fornecedor_id FROM contratos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))',
          [contratoId, escopo],
        );
        if (!contrato) throw naoEncontrado('Contrato não encontrado.');
        if (contrato.fornecedor_id !== fornecedorId) throw regraNegocio('O contrato informado não é do fornecedor indicado.');
      }
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO sancoes (fornecedor_id, contrato_id, inciso_infracao, tipo, situacao, intimacao_em, prazo_defesa,
                              instaurada_em, relato, criada_por)
         VALUES ($1, $2, $3, $4, 'defesa', $5, $6, $7, $8, $9) RETURNING id`,
        [fornecedorId, contratoId, inciso, entrada.tipo, entrada.intimacaoEm, defesa.vencimento, ctx.hoje(), entrada.relato, sessao.usuario.id],
      );
      if (!criada) throw new Error('Falha ao instaurar sanção');
      await auditar(tx, request, {
        acao: 'sancao.instaurar',
        recurso: 'sancao',
        recursoId: criada.id,
        resumo: `Instaurou processo sancionatório (art. 155, ${inciso}) — ${rotuloSancao(entrada.tipo)} proposta`,
        dados: {
          fornecedorId,
          ...(contratoId !== null ? { instrumentoTipo: 'contrato', instrumentoId: contratoId } : {}),
          inciso,
          tipo: entrada.tipo,
          intimacaoEm: entrada.intimacaoEm,
          prazoDefesa: defesa.vencimento,
          fundamentoPrazo: defesa.fundamento,
        },
      });
      return criada.id;
    });
    const { itens } = await listarSancoes(ctx.banco, { escopo, id }, 1, 0);
    const sancao = itens[0];
    if (!sancao) throw naoEncontrado();
    reply.status(201);
    return sancao;
  });

  /** Simulação de dosimetria de multa (somente leitura; proposta para decisão da autoridade competente). */
  app.post('/sancoes/dosimetria/simular', { preHandler: exigir('sancoes:ler') }, async (request): Promise<ResultadoDosimetria> => {
    const entrada = esquemaDosimetria.parse(request.body);
    const r = calcularDosimetriaMulta(entrada);
    return {
      percentualCalculado: r.percentualCalculado,
      percentualAplicado: r.percentualAplicado,
      valorMulta: r.valorMulta,
      limitado: r.limitado,
      memoriaCalculo: r.memoriaCalculo,
      fundamento: r.fundamento,
      aviso: r.aviso,
    };
  });
}
