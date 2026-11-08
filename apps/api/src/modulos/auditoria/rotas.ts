import type { EventoAuditoria, Pagina, VerificacaoAuditoria } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verificarCadeia } from '../../auditoria/trilha.ts';
import { exigir } from '../../autorizacao/exigir.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { camposPaginacao, dataIso, deslocamento, pagina, textoBusca, uuid } from '../../http/validacao.ts';

const esquemaFiltro = z.object({
  busca: textoBusca,
  acao: z.string().trim().max(100).optional(),
  recurso: z.string().trim().max(100).optional(),
  usuario: uuid.optional(),
  de: dataIso.optional(),
  ate: dataIso.optional(),
  ...camposPaginacao,
});

interface LinhaEvento {
  id: string;
  sequencia: number;
  ocorrido_em: string;
  usuario_id: string | null;
  usuario_nome: string | null;
  acao: string;
  recurso: string;
  recurso_id: string | null;
  resumo: string;
  hash: string;
  hash_anterior: string;
}

/** Brasil sem horário de verão desde 2019: o dia civil de Brasília começa às 03:00 UTC. */
function inicioDoDia(data: string): string {
  return `${data}T00:00:00-03:00`;
}

export async function rotasAuditoria(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('auditoria:ler') };

  app.get('/auditoria', leitura, async (request): Promise<Pagina<EventoAuditoria>> => {
    const f = esquemaFiltro.parse(request.query);
    const busca = f.busca ? `%${normalizarBusca(f.busca).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const ateExclusivo = f.ate ? new Date(Date.parse(inicioDoDia(f.ate)) + 24 * 60 * 60 * 1000).toISOString() : null;
    const parametros = [
      busca,
      f.acao ?? null,
      f.recurso ?? null,
      f.usuario ?? null,
      f.de ? inicioDoDia(f.de) : null,
      ateExclusivo,
    ] as const;
    const condicoes = `
      WHERE ($1::text IS NULL
             OR translate(lower(e.resumo), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') LIKE $1 ESCAPE '\\'
             OR e.acao LIKE $1 ESCAPE '\\'
             OR lower(COALESCE(e.recurso_id, '')) LIKE $1 ESCAPE '\\')
        AND ($2::text IS NULL OR e.acao = $2 OR e.acao LIKE $2 || '.%')
        AND ($3::text IS NULL OR e.recurso = $3)
        AND ($4::uuid IS NULL OR e.usuario_id = $4)
        AND ($5::timestamptz IS NULL OR e.ocorrido_em >= $5)
        AND ($6::timestamptz IS NULL OR e.ocorrido_em < $6)`;
    const linhas = await ctx.banco.consultar<LinhaEvento>(
      `SELECT e.id, e.sequencia, e.ocorrido_em, e.usuario_id, u.nome AS usuario_nome, e.acao, e.recurso, e.recurso_id,
              e.resumo, e.hash, e.hash_anterior
         FROM auditoria_eventos e
         LEFT JOIN usuarios u ON u.id = e.usuario_id
       ${condicoes}
        ORDER BY e.sequencia DESC
        LIMIT $7 OFFSET $8`,
      [...parametros, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina)],
    );
    const [contagem] = await ctx.banco.consultar<{ total: number }>(
      `SELECT COUNT(*)::integer AS total FROM auditoria_eventos e ${condicoes}`,
      [...parametros],
    );
    return pagina(
      linhas.map((l) => ({
        id: l.id,
        sequencia: l.sequencia,
        ocorridoEm: l.ocorrido_em,
        usuario: usuarioResumo(l.usuario_id, l.usuario_nome),
        acao: l.acao,
        recurso: l.recurso,
        recursoId: l.recurso_id,
        resumo: l.resumo,
        hash: l.hash,
        hashAnterior: l.hash_anterior,
      })),
      contagem?.total ?? 0,
      f.pagina,
      f.tamanhoPagina,
    );
  });

  app.get('/auditoria/verificacao', leitura, async (): Promise<VerificacaoAuditoria> => verificarCadeia(ctx.banco, ctx.relogio()));
}
