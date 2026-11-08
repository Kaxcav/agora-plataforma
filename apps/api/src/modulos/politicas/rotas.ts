/**
 * Políticas do órgão (RN-21): a política de sustentabilidade obrigatória começa ligada e só o administrador
 * (`ajustes:editar`) a altera, sempre com justificativa e evento na trilha de auditoria. Com ela ligada, ETP e TR
 * não se concluem sem os critérios de sustentabilidade ambiental e de logística reversa (art. 18, § 1º, XII).
 */
import type { PoliticaSustentabilidade } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { auditar } from '../../http/auditar.ts';
import { CODIGO_POLITICA_SUSTENTABILIDADE, obterPoliticaSustentabilidade } from '../jornada/sustentabilidade.ts';

const esquemaPolitica = z.object({
  ativa: z.boolean(),
  justificativa: z.string().trim().min(20, 'Justifique a alteração em pelo menos 20 caracteres.').max(2000),
});

export async function rotasPoliticas(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/politicas-orgao/sustentabilidade', { preHandler: exigir('painel:ler') }, async (): Promise<PoliticaSustentabilidade> =>
    obterPoliticaSustentabilidade(ctx.banco),
  );

  app.put('/politicas-orgao/sustentabilidade', { preHandler: exigir('ajustes:editar') }, async (request): Promise<PoliticaSustentabilidade> => {
    const entrada = esquemaPolitica.parse(request.body);
    const sessao = sessaoDe(request);
    const agora = ctx.relogio().toISOString();
    await ctx.banco.transacao(async (tx) => {
      const [anterior] = await tx.consultar<{ ativa: boolean }>('SELECT ativa FROM politicas_orgao WHERE codigo = $1 FOR UPDATE', [CODIGO_POLITICA_SUSTENTABILIDADE]);
      await tx.executar(
        `INSERT INTO politicas_orgao (codigo, ativa, justificativa, alterada_em, alterada_por) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (codigo) DO UPDATE SET ativa = $2, justificativa = $3, alterada_em = $4, alterada_por = $5`,
        [CODIGO_POLITICA_SUSTENTABILIDADE, entrada.ativa, entrada.justificativa, agora, sessao.usuario.id],
      );
      await auditar(tx, request, {
        acao: 'politica.sustentabilidade.alterar',
        recurso: 'politica_orgao',
        recursoId: null,
        resumo: `${entrada.ativa ? 'Ligou' : 'Desligou'} a política de sustentabilidade obrigatória no ETP e no TR (RN-21)`,
        dados: {
          codigo: CODIGO_POLITICA_SUSTENTABILIDADE,
          antes: anterior?.ativa ?? true,
          depois: entrada.ativa,
          justificativa: entrada.justificativa,
          fundamento: 'Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII',
        },
      });
    });
    return obterPoliticaSustentabilidade(ctx.banco);
  });
}
