import { formatarCnpj, formatarCpf } from '@agora/dominio';
import type { Pagina, RegistroAcessoDadoPessoal, RespostaRevelar } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Executor } from '../../banco/tipos.ts';
import { auditar } from '../../http/auditar.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, deslocamento, pagina, uuid } from '../../http/validacao.ts';

const esquemaRevelar = z.object({
  recurso: z.enum(['fornecedor', 'usuario', 'credor_empenho']),
  id: uuid,
  campo: z.enum(['documento', 'email', 'telefone']),
  finalidade: z.string().trim().min(10).max(300),
});
type EntradaRevelar = z.infer<typeof esquemaRevelar>;

function formatarDocumento(documento: string): string {
  return documento.length === 14 ? formatarCnpj(documento) : formatarCpf(documento);
}

/** Lê o valor completo do campo pedido, respeitando o escopo de UASG para credores de empenho. */
async function lerValor(executor: Executor, entrada: EntradaRevelar, escopo: string[] | null): Promise<string | null> {
  const id = entrada.id.toLowerCase();
  if (entrada.recurso === 'fornecedor') {
    const [f] = await executor.consultar<{ documento: string; email: string | null; telefone: string | null }>(
      'SELECT documento, email, telefone FROM fornecedores WHERE id = $1',
      [id],
    );
    if (!f) throw naoEncontrado('Fornecedor não encontrado.');
    if (entrada.campo === 'documento') return formatarDocumento(f.documento);
    return entrada.campo === 'email' ? f.email : f.telefone;
  }
  if (entrada.recurso === 'usuario') {
    const [u] = await executor.consultar<{ cpf: string; email: string }>('SELECT cpf, email FROM usuarios WHERE id = $1', [id]);
    if (!u) throw naoEncontrado('Usuário não encontrado.');
    if (entrada.campo === 'documento') return formatarCpf(u.cpf);
    if (entrada.campo === 'email') return u.email;
    return null;
  }
  const [e] = await executor.consultar<{ credor_documento: string }>(
    'SELECT credor_documento FROM empenhos WHERE id = $1 AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))',
    [id, escopo],
  );
  if (!e) throw naoEncontrado('Empenho não encontrado.');
  return entrada.campo === 'documento' ? formatarDocumento(e.credor_documento) : null;
}

interface LinhaAcesso {
  id: string;
  ocorrido_em: string;
  usuario_id: string;
  usuario_nome: string;
  recurso: string;
  recurso_id: string;
  campo: string;
  finalidade: string;
}

export async function rotasLgpd(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  /** Revelação de dado pessoal (LGPD art. 37): exige permissão e finalidade; grava o acesso e a trilha de auditoria. */
  app.post('/lgpd/revelar', { preHandler: exigir('lgpd:revelar') }, async (request): Promise<RespostaRevelar> => {
    const entrada = esquemaRevelar.parse(request.body);
    const sessao = sessaoDe(request);
    return ctx.banco.transacao(async (tx) => {
      const valor = await lerValor(tx, entrada, escopoUasgs(sessao));
      if (valor === null || valor === '') {
        throw regraNegocio('Este registro não possui o campo solicitado.', [{ campo: 'campo', mensagem: 'Campo indisponível para o recurso' }]);
      }
      const agora = ctx.relogio().toISOString();
      const [acesso] = await tx.consultar<{ id: string }>(
        `INSERT INTO lgpd_acessos (ocorrido_em, usuario_id, recurso, recurso_id, campo, finalidade, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [agora, sessao.usuario.id, entrada.recurso, entrada.id.toLowerCase(), entrada.campo, entrada.finalidade, request.ipHash],
      );
      if (!acesso) throw new Error('Falha ao registrar o acesso a dado pessoal');
      await auditar(tx, request, {
        acao: 'lgpd.revelar',
        recurso: entrada.recurso,
        recursoId: entrada.id.toLowerCase(),
        resumo: `Revelou o campo "${entrada.campo}" de ${entrada.recurso.replace('_', ' ')}`,
        dados: { campo: entrada.campo, finalidade: entrada.finalidade, registroAcessoId: acesso.id },
      });
      return { valor, registroAcessoId: acesso.id };
    });
  });

  app.get('/lgpd/acessos', { preHandler: exigir('lgpd:relatorio') }, async (request): Promise<Pagina<RegistroAcessoDadoPessoal>> => {
    const f = z.object({ usuario: uuid.optional(), ...camposPaginacao }).parse(request.query);
    const linhas = await ctx.banco.consultar<LinhaAcesso>(
      `SELECT a.id, a.ocorrido_em, a.usuario_id, u.nome AS usuario_nome, a.recurso, a.recurso_id, a.campo, a.finalidade
         FROM lgpd_acessos a JOIN usuarios u ON u.id = a.usuario_id
        WHERE ($1::uuid IS NULL OR a.usuario_id = $1)
        ORDER BY a.ocorrido_em DESC, a.id
        LIMIT $2 OFFSET $3`,
      [f.usuario ?? null, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina)],
    );
    const [contagem] = await ctx.banco.consultar<{ total: number }>(
      'SELECT COUNT(*)::integer AS total FROM lgpd_acessos a WHERE ($1::uuid IS NULL OR a.usuario_id = $1)',
      [f.usuario ?? null],
    );
    return pagina(
      linhas.map((l) => ({
        id: l.id,
        ocorridoEm: l.ocorrido_em,
        usuario: { id: l.usuario_id, nome: l.usuario_nome },
        recurso: l.recurso,
        recursoId: l.recurso_id,
        campo: l.campo,
        finalidade: l.finalidade,
      })),
      contagem?.total ?? 0,
      f.pagina,
      f.tamanhoPagina,
    );
  });
}
