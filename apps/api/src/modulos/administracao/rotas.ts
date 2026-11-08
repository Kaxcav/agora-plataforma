import { mascararCpf, mascararEmail, somenteDigitos, validarCpf } from '@agora/dominio';
import type { CodigoPerfil, Pagina, PerfilAcesso, RespostaSenhaTemporaria, UsuarioAdmin } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { gerarHashSenha, gerarSenhaTemporaria } from '../../autenticacao/senhas.ts';
import { encerrarSessoesDoUsuario } from '../../autenticacao/sessoes.ts';
import { exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { CODIGOS_PERFIS, PERFIS, PERFIS_ESCOPO_TOTAL } from '../../autorizacao/perfis.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { inserirEmLote } from '../../banco/lote.ts';
import { normalizarBusca, padraoContem } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { camposPaginacao, codigoUasg, deslocamento, idDaRota, pagina, textoBusca, uuid } from '../../http/validacao.ts';

const esquemaPerfis = z.array(z.enum(CODIGOS_PERFIS)).min(1).max(CODIGOS_PERFIS.length);

const esquemaUsuario = z.object({
  nome: z.string().trim().min(3).max(200),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  cpf: z
    .string()
    .transform((v) => somenteDigitos(v))
    .refine((v) => validarCpf(v), 'CPF inválido'),
  perfis: esquemaPerfis,
  uasgs: z.array(codigoUasg).max(500),
  unidadeInternaId: uuid.nullable(),
});

const esquemaAtualizacao = esquemaUsuario.partial().extend({ ativo: z.boolean().optional() });

/** Validade da senha temporária emitida pelo administrador. */
const VALIDADE_SENHA_TEMPORARIA_MS = 72 * 60 * 60 * 1000;

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  cpf: string;
  ativo: boolean;
  todas_uasgs: boolean;
  ultimo_acesso_em: string | null;
  unidade_id: string | null;
  unidade_sigla: string | null;
  perfis: CodigoPerfil[];
  uasgs: string[];
}

const SELECAO_USUARIO = `
  SELECT u.id, u.nome, u.email, u.cpf, u.ativo, u.todas_uasgs, u.ultimo_acesso_em,
         ui.id AS unidade_id, ui.sigla AS unidade_sigla,
         COALESCE((SELECT array_agg(up.perfil ORDER BY up.perfil) FROM usuarios_perfis up WHERE up.usuario_id = u.id), '{}') AS perfis,
         COALESCE((SELECT array_agg(uu.uasg ORDER BY uu.uasg) FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id), '{}') AS uasgs
    FROM usuarios u
    LEFT JOIN unidades_internas ui ON ui.id = u.unidade_interna_id`;

/** E-mail mascarado para quem não tem `lgpd:revelar`; CPF sempre mascarado (o valor completo só via /lgpd/revelar). */
function mapear(l: LinhaUsuario, podeVerEmail: boolean): UsuarioAdmin {
  return {
    id: l.id,
    nome: l.nome,
    email: podeVerEmail ? l.email : mascararEmail(l.email),
    cpf: mascararCpf(l.cpf),
    perfis: l.perfis,
    uasgs: l.uasgs,
    unidadeInterna: l.unidade_id !== null && l.unidade_sigla !== null ? { id: l.unidade_id, sigla: l.unidade_sigla } : null,
    ativo: l.ativo,
    ultimoAcessoEm: l.ultimo_acesso_em,
  };
}

async function obterUsuario(executor: Executor, id: string): Promise<LinhaUsuario | null> {
  const [linha] = await executor.consultar<LinhaUsuario>(`${SELECAO_USUARIO} WHERE u.id = $1`, [id]);
  return linha ?? null;
}

/** Usuários sem UASG explícita só têm escopo total se forem administradores ou auditores. */
function todasUasgsPara(perfis: readonly CodigoPerfil[], uasgs: readonly string[]): boolean {
  return uasgs.length === 0 && perfis.some((p) => PERFIS_ESCOPO_TOTAL.includes(p));
}

async function validarReferencias(tx: Transacao, uasgs: readonly string[], unidadeInternaId: string | null | undefined): Promise<void> {
  if (uasgs.length > 0) {
    const existentes = await tx.consultar<{ codigo: string }>('SELECT codigo FROM uasgs WHERE codigo = ANY($1::text[])', [[...uasgs]]);
    const faltantes = uasgs.filter((u) => !existentes.some((e) => e.codigo === u));
    if (faltantes.length > 0) {
      throw regraNegocio('Há UASGs não cadastradas.', faltantes.map((codigo) => ({ campo: 'uasgs', mensagem: `UASG ${codigo} não cadastrada` })));
    }
  }
  if (unidadeInternaId) {
    const [unidade] = await tx.consultar<{ id: string }>('SELECT id FROM unidades_internas WHERE id = $1 AND ativa', [unidadeInternaId]);
    if (!unidade) throw regraNegocio('Unidade interna inexistente ou inativa.', [{ campo: 'unidadeInternaId', mensagem: 'Unidade interna inválida' }]);
  }
}

async function gravarVinculos(tx: Transacao, usuarioId: string, perfis?: readonly CodigoPerfil[], uasgs?: readonly string[]): Promise<void> {
  if (perfis) {
    await tx.executar('DELETE FROM usuarios_perfis WHERE usuario_id = $1', [usuarioId]);
    await inserirEmLote(tx, 'usuarios_perfis', ['usuario_id', 'perfil'], [...new Set(perfis)].map((p) => [usuarioId, p]));
  }
  if (uasgs) {
    await tx.executar('DELETE FROM usuarios_uasgs WHERE usuario_id = $1', [usuarioId]);
    await inserirEmLote(tx, 'usuarios_uasgs', ['usuario_id', 'uasg'], [...new Set(uasgs)].map((u) => [usuarioId, u]));
  }
}

function podeVerEmails(request: FastifyRequest): boolean {
  return sessaoDe(request).permissoes.has('lgpd:revelar');
}

export async function rotasAdministracao(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const admin = { preHandler: exigir('admin:usuarios') };

  app.get('/perfis', admin, async (): Promise<PerfilAcesso[]> => PERFIS.map((p) => ({ ...p, permissoes: [...p.permissoes] })));

  app.get('/usuarios', admin, async (request): Promise<Pagina<UsuarioAdmin>> => {
    const f = z.object({ busca: textoBusca, ...camposPaginacao }).parse(request.query);
    const busca = f.busca ? padraoContem(f.busca) : null;
    const linhas = await ctx.banco.consultar<LinhaUsuario>(
      `${SELECAO_USUARIO}
        WHERE ($1::text IS NULL OR u.busca_normalizada LIKE $1 ESCAPE '\\')
        ORDER BY u.ativo DESC, u.nome
        LIMIT $2 OFFSET $3`,
      [busca, f.tamanhoPagina, deslocamento(f.pagina, f.tamanhoPagina)],
    );
    const [contagem] = await ctx.banco.consultar<{ total: number }>(
      `SELECT COUNT(*)::integer AS total FROM usuarios u WHERE ($1::text IS NULL OR u.busca_normalizada LIKE $1 ESCAPE '\\')`,
      [busca],
    );
    const verEmail = podeVerEmails(request);
    return pagina(
      linhas.map((l) => mapear(l, verEmail)),
      contagem?.total ?? 0,
      f.pagina,
      f.tamanhoPagina,
    );
  });

  app.post('/usuarios', admin, async (request, reply): Promise<UsuarioAdmin> => {
    const entrada = esquemaUsuario.parse(request.body);
    const id = await ctx.banco.transacao(async (tx) => {
      const [duplicado] = await tx.consultar<{ email: string }>('SELECT email FROM usuarios WHERE email = $1 OR cpf = $2', [entrada.email, entrada.cpf]);
      if (duplicado) throw conflito('Já existe um usuário com este e-mail ou CPF.');
      await validarReferencias(tx, entrada.uasgs, entrada.unidadeInternaId);
      const [criado] = await tx.consultar<{ id: string }>(
        `INSERT INTO usuarios (nome, email, cpf, senha_hash, ativo, unidade_interna_id, todas_uasgs, busca_normalizada)
         VALUES ($1, $2, $3, NULL, true, $4, $5, $6) RETURNING id`,
        [
          entrada.nome,
          entrada.email,
          entrada.cpf,
          entrada.unidadeInternaId,
          todasUasgsPara(entrada.perfis, entrada.uasgs),
          normalizarBusca(entrada.nome, entrada.email),
        ],
      );
      if (!criado) throw new Error('Falha ao criar usuário');
      await gravarVinculos(tx, criado.id, entrada.perfis, entrada.uasgs);
      await auditar(tx, request, {
        acao: 'usuario.criar',
        recurso: 'usuario',
        recursoId: criado.id,
        resumo: `Criou o usuário ${entrada.nome}`,
        dados: { email: mascararEmail(entrada.email), perfis: entrada.perfis, uasgs: entrada.uasgs, unidadeInternaId: entrada.unidadeInternaId },
      });
      return criado.id;
    });
    const usuario = await obterUsuario(ctx.banco, id);
    if (!usuario) throw naoEncontrado();
    reply.status(201);
    return mapear(usuario, podeVerEmails(request));
  });

  app.patch('/usuarios/:id', admin, async (request): Promise<UsuarioAdmin> => {
    const id = idDaRota(request.params);
    const entrada = esquemaAtualizacao.parse(request.body);
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      const antes = await obterUsuario(tx, id);
      if (!antes) throw naoEncontrado('Usuário não encontrado.');
      if (id === sessao.usuario.id) {
        if (entrada.ativo === false) throw regraNegocio('Você não pode desativar o seu próprio usuário.');
        if (entrada.perfis && !entrada.perfis.includes('administrador')) {
          throw regraNegocio('Você não pode remover o seu próprio perfil de administrador.');
        }
      }
      if (entrada.email !== undefined || entrada.cpf !== undefined) {
        const [duplicado] = await tx.consultar<{ id: string }>(
          'SELECT id FROM usuarios WHERE id <> $1 AND (email = $2 OR cpf = $3)',
          [id, entrada.email ?? antes.email, entrada.cpf ?? antes.cpf],
        );
        if (duplicado) throw conflito('Já existe um usuário com este e-mail ou CPF.');
      }
      await validarReferencias(tx, entrada.uasgs ?? [], entrada.unidadeInternaId);

      const perfis = entrada.perfis ?? antes.perfis;
      const uasgs = entrada.uasgs ?? antes.uasgs;
      const nome = entrada.nome ?? antes.nome;
      const email = entrada.email ?? antes.email;
      await tx.executar(
        `UPDATE usuarios SET nome = $2, email = $3, cpf = $4, ativo = $5, unidade_interna_id = $6, todas_uasgs = $7,
                busca_normalizada = $8, atualizado_em = $9
          WHERE id = $1`,
        [
          id,
          nome,
          email,
          entrada.cpf ?? antes.cpf,
          entrada.ativo ?? antes.ativo,
          entrada.unidadeInternaId === undefined ? antes.unidade_id : entrada.unidadeInternaId,
          entrada.perfis !== undefined || entrada.uasgs !== undefined ? todasUasgsPara(perfis, uasgs) : antes.todas_uasgs,
          normalizarBusca(nome, email),
          ctx.relogio().toISOString(),
        ],
      );
      await gravarVinculos(tx, id, entrada.perfis, entrada.uasgs);
      const desativado = entrada.ativo === false && antes.ativo;
      if (desativado || entrada.perfis !== undefined || entrada.uasgs !== undefined) {
        await tx.executar('DELETE FROM sessoes WHERE usuario_id = $1 AND usuario_id <> $2', [id, sessao.usuario.id]);
      }
      await auditar(tx, request, {
        acao: 'usuario.atualizar',
        recurso: 'usuario',
        recursoId: id,
        resumo: `Atualizou o usuário ${nome}`,
        dados: {
          camposAlterados: Object.keys(entrada).sort(),
          antes: { perfis: antes.perfis, uasgs: antes.uasgs, ativo: antes.ativo, unidadeInternaId: antes.unidade_id },
          depois: { perfis, uasgs, ativo: entrada.ativo ?? antes.ativo, unidadeInternaId: entrada.unidadeInternaId === undefined ? antes.unidade_id : entrada.unidadeInternaId },
        },
      });
    });
    const usuario = await obterUsuario(ctx.banco, id);
    if (!usuario) throw naoEncontrado();
    return mapear(usuario, podeVerEmails(request));
  });

  /**
   * Senha temporária (exibida uma única vez): hash scrypt, validade de 72 h, troca obrigatória no primeiro acesso
   * e encerramento de todas as sessões do usuário. A senha nunca vai para a trilha de auditoria.
   */
  app.post('/usuarios/:id/senha-temporaria', admin, async (request): Promise<RespostaSenhaTemporaria> => {
    const id = idDaRota(request.params);
    const sessao = sessaoDe(request);
    if (id === sessao.usuario.id) throw regraNegocio('Para a sua própria senha, use a troca de senha da sua sessão.');
    const senhaTemporaria = gerarSenhaTemporaria();
    const hash = await gerarHashSenha(senhaTemporaria);
    const agora = ctx.relogio();
    const expiraEm = new Date(agora.getTime() + VALIDADE_SENHA_TEMPORARIA_MS).toISOString();
    await ctx.banco.transacao(async (tx) => {
      const alvo = await obterUsuario(tx, id);
      if (!alvo) throw naoEncontrado('Usuário não encontrado.');
      await tx.executar(
        `UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = true, senha_expira_em = $3, atualizado_em = $4
          WHERE id = $1`,
        [id, hash, expiraEm, agora.toISOString()],
      );
      const encerradas = await encerrarSessoesDoUsuario(tx, id);
      await auditar(tx, request, {
        acao: 'usuario.senha_temporaria',
        recurso: 'usuario',
        recursoId: id,
        resumo: `Emitiu senha temporária para ${alvo.nome}`,
        dados: { expiraEm, sessoesEncerradas: encerradas, ativo: alvo.ativo },
      });
    });
    return { senhaTemporaria, expiraEm };
  });
}
