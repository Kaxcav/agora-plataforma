import type { Executor } from '../banco/tipos.ts';
import { jsonCanonico } from '../auditoria/trilha.ts';
import { sha256Hex } from '../compartilhado/cripto.ts';
import { CONJUNTOS, type Conector, type FonteExecutavel } from './conector.ts';

/**
 * Consulta do snapshot local de cada conjunto. Colunas explícitas e ordem determinística,
 * para que o hash só mude quando o conteúdo mudar (execução idempotente).
 */
const CONSULTAS_SNAPSHOT: Record<FonteExecutavel, string> = {
  PNCP: `SELECT id, numero, uasg, id_pncp, objeto, vigencia_inicio, vigencia_fim, valor_inicial, divulgacao_pncp_em
           FROM contratos ORDER BY id`,
  COMPRAS_GOV: `SELECT 'ata' AS tipo, a.id_pncp, a.numero, a.uasg, a.vigencia_fim AS data,
                       (SELECT COUNT(*) FROM itens_ata ia WHERE ia.ata_id = a.id)::integer AS itens
                  FROM atas a
                UNION ALL
                SELECT 'pregao_homologado' AS tipo, m.id_pncp, m.numero_compra, m.uasg, m.homologada_em, m.quantidade_itens
                  FROM atas_a_montar m
                ORDER BY 1, 2`,
  CONTRATOS_GOV: `SELECT 'item' AS tipo, ic.id, ic.contrato_id, ic.quantidade AS quantidade, ic.valor_unitario AS valor
                    FROM itens_contrato ic
                  UNION ALL
                  SELECT 'aditivo' AS tipo, ad.id, ad.contrato_id, 0 AS quantidade, ad.valor
                    FROM aditivos ad
                  ORDER BY 1, 2`,
  SIAFI: `SELECT id, numero, uasg, ano, valor_empenhado, valor_liquidado, valor_pago, restos_a_pagar
            FROM empenhos ORDER BY id`,
};

async function snapshot(executor: Executor, fonte: FonteExecutavel): Promise<{ registros: number; hash: string }> {
  const linhas = await executor.consultar<Record<string, unknown>>(CONSULTAS_SNAPSHOT[fonte]);
  return { registros: linhas.length, hash: sha256Hex(jsonCanonico(linhas)) };
}

/**
 * Conector offline: verifica o snapshot local do conjunto (dados sintéticos em demonstração ou já carregados
 * em operação), calcula o hash do conteúdo e registra a proveniência. Não faz chamadas externas e não altera dados.
 */
export function criarConectorOffline(fonte: FonteExecutavel): Conector {
  const definicao = CONJUNTOS.find((c) => c.fonte === fonte);
  if (!definicao) throw new Error(`Fonte sem conjunto definido: ${fonte}`);
  return {
    fonte,
    conjunto: definicao.conjunto,
    modo: 'offline',
    async executar(ctx) {
      const { registros, hash } = await snapshot(ctx.banco, fonte);
      return {
        registros,
        hash,
        mensagem: `Modo offline: snapshot local verificado (${registros} registros). Nenhuma chamada externa foi feita.`,
      };
    },
  };
}
