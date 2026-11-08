import { mascararEmail } from '@agora/dominio';
import type { Sessao } from '@agora/contratos';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CAMINHO_COOKIE_GOVBR,
  COOKIE_GOVBR,
  ClienteGovbr,
  VALIDADE_ESTADO_MS,
  lerEstado,
  serializarEstado,
} from '../../autenticacao/govbr.ts';
import { avaliarPoliticaSenha, gerarHashSenha, verificarSenha } from '../../autenticacao/senhas.ts';
import {
  carregarSessao,
  criarSessao,
  definirCookieSessao,
  encerrarSessao,
  encerrarSessoesDoUsuario,
  limparCookieSessao,
  montarSessao,
} from '../../autenticacao/sessoes.ts';
import { exigirSessao, sessaoDe } from '../../autorizacao/exigir.ts';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { auditar } from '../../http/auditar.ts';
import { ErroApi, naoAutenticado, naoEncontrado, validacao } from '../../http/erros.ts';

/** 5 tentativas malsucedidas por e-mail+IP em 15 minutos (ARQUITETURA §3.2). */
const MAXIMO_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const MENSAGEM_FALHA_LOGIN = 'E-mail ou senha inválidos.';

const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  senha: z.string().min(1).max(512),
});

const esquemaTrocaSenha = z.object({
  senhaAtual: z.string().min(1).max(512),
  novaSenha: z.string().min(1).max(512),
});

/** Erros de senha atual na troca: 5 por usuário em 15 minutos (mesma janela do login). */
function chaveTrocaSenha(usuarioId: string): string {
  return sha256Hex(`troca-senha|${usuarioId}`);
}

function emailParaTrilha(email: string): string {
  return /^[^@\s]+@[^@\s]+$/.test(email) ? mascararEmail(email) : '***';
}

export async function rotasSessao(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const govbr = ctx.config.govbr ? new ClienteGovbr(ctx.config.govbr, ctx.fetch, ctx.relogio) : null;

  async function concluirLogin(
    request: FastifyRequest,
    reply: FastifyReply,
    usuarioId: string,
    metodo: 'senha' | 'govbr',
    chaveTentativa: string | null,
  ): Promise<string> {
    const agora = ctx.relogio();
    const criada = await ctx.banco.transacao(async (tx) => {
      if (chaveTentativa !== null) {
        await tx.executar('INSERT INTO tentativas_login (chave, ocorrida_em, sucesso) VALUES ($1, $2, true)', [
          chaveTentativa,
          agora.toISOString(),
        ]);
      }
      if (request.sessao) await encerrarSessao(tx, request.sessao.id);
      const sessao = await criarSessao(
        tx,
        { usuarioId, ipHash: request.ipHash, agente: String(request.headers['user-agent'] ?? ''), metodo },
        agora,
      );
      await auditar(tx, request, {
        usuarioId,
        acao: 'sessao.entrar',
        recurso: 'sessao',
        recursoId: usuarioId,
        resumo: metodo === 'govbr' ? 'Entrou com o Login Único gov.br' : 'Entrou com e-mail e senha',
        dados: { metodo },
      });
      return sessao;
    });
    definirCookieSessao(reply, criada.token, ctx.config);
    return criada.token;
  }

  app.post('/sessao', async (request, reply): Promise<Sessao> => {
    const corpo = esquemaLogin.parse(request.body);
    const agora = ctx.relogio();
    const chave = sha256Hex(`${corpo.email}|${request.ipHash}`);

    const [contagem] = await ctx.banco.consultar<{ falhas: number }>(
      'SELECT COUNT(*)::integer AS falhas FROM tentativas_login WHERE chave = $1 AND NOT sucesso AND ocorrida_em > $2',
      [chave, new Date(agora.getTime() - JANELA_TENTATIVAS_MS).toISOString()],
    );
    if ((contagem?.falhas ?? 0) >= MAXIMO_TENTATIVAS) {
      reply.header('retry-after', String(JANELA_TENTATIVAS_MS / 1000));
      throw new ErroApi(429, 'LIMITE_TENTATIVAS', 'Muitas tentativas de entrada. Aguarde 15 minutos e tente novamente.');
    }

    const [usuario] = await ctx.banco.consultar<{ id: string; senha_hash: string | null; senha_expira_em: string | null }>(
      'SELECT id, senha_hash, senha_expira_em FROM usuarios WHERE email = $1 AND ativo',
      [corpo.email],
    );
    const senhaConfere = await verificarSenha(corpo.senha, usuario?.senha_hash ?? null);
    // Senha temporária vencida (72 h) falha como qualquer outra: a mensagem continua genérica.
    const senhaExpirada = usuario?.senha_expira_em != null && Date.parse(usuario.senha_expira_em) <= agora.getTime();
    if (!usuario || !senhaConfere || senhaExpirada) {
      await ctx.banco.transacao(async (tx) => {
        await tx.executar('INSERT INTO tentativas_login (chave, ocorrida_em, sucesso) VALUES ($1, $2, false)', [
          chave,
          agora.toISOString(),
        ]);
        await tx.executar('DELETE FROM tentativas_login WHERE ocorrida_em < $1', [
          new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        ]);
        await auditar(tx, request, {
          usuarioId: usuario?.id ?? null,
          acao: 'sessao.falhar',
          recurso: 'sessao',
          recursoId: null,
          resumo: 'Tentativa de entrada malsucedida',
          dados: {
            metodo: 'senha',
            email: emailParaTrilha(corpo.email),
            ...(senhaConfere && senhaExpirada ? { motivo: 'senha_temporaria_expirada' } : {}),
          },
        });
      });
      throw naoAutenticado(MENSAGEM_FALHA_LOGIN);
    }

    const token = await concluirLogin(request, reply, usuario.id, 'senha', chave);
    const sessao = await carregarSessao(ctx.banco, token, agora);
    if (!sessao) throw naoAutenticado();
    return montarSessao(ctx.banco, sessao);
  });

  app.get('/sessao', { preHandler: exigirSessao }, async (request): Promise<Sessao> => montarSessao(ctx.banco, sessaoDe(request)));

  /**
   * Troca da própria senha (também durante a troca obrigatória): confere a senha atual, aplica a política
   * (mínimo de 12 caracteres, diferente da atual), encerra as OUTRAS sessões do usuário e registra na trilha.
   */
  app.post('/sessao/senha', { preHandler: exigirSessao }, async (request, reply) => {
    const sessao = sessaoDe(request);
    const entrada = esquemaTrocaSenha.parse(request.body);
    const agora = ctx.relogio();
    const chave = chaveTrocaSenha(sessao.usuario.id);
    const [contagem] = await ctx.banco.consultar<{ falhas: number }>(
      'SELECT COUNT(*)::integer AS falhas FROM tentativas_login WHERE chave = $1 AND NOT sucesso AND ocorrida_em > $2',
      [chave, new Date(agora.getTime() - JANELA_TENTATIVAS_MS).toISOString()],
    );
    if ((contagem?.falhas ?? 0) >= MAXIMO_TENTATIVAS) {
      reply.header('retry-after', String(JANELA_TENTATIVAS_MS / 1000));
      throw new ErroApi(429, 'LIMITE_TENTATIVAS', 'Muitas tentativas com a senha atual incorreta. Aguarde 15 minutos e tente novamente.');
    }
    const [usuario] = await ctx.banco.consultar<{ senha_hash: string | null }>('SELECT senha_hash FROM usuarios WHERE id = $1 AND ativo', [
      sessao.usuario.id,
    ]);
    if (!(await verificarSenha(entrada.senhaAtual, usuario?.senha_hash ?? null))) {
      await ctx.banco.transacao(async (tx) => {
        await tx.executar('INSERT INTO tentativas_login (chave, ocorrida_em, sucesso) VALUES ($1, $2, false)', [chave, agora.toISOString()]);
        await auditar(tx, request, {
          acao: 'sessao.trocar_senha_falhar',
          recurso: 'usuario',
          recursoId: sessao.usuario.id,
          resumo: 'Tentativa de troca de senha com a senha atual incorreta',
        });
      });
      throw naoAutenticado('A senha atual está incorreta.');
    }
    const problema = avaliarPoliticaSenha(entrada.novaSenha);
    if (problema) throw validacao(problema, [{ campo: 'novaSenha', mensagem: problema }]);
    if (entrada.novaSenha.normalize('NFKC') === entrada.senhaAtual.normalize('NFKC')) {
      throw validacao('A nova senha deve ser diferente da atual.', [{ campo: 'novaSenha', mensagem: 'A nova senha deve ser diferente da atual.' }]);
    }
    const hash = await gerarHashSenha(entrada.novaSenha);
    await ctx.banco.transacao(async (tx) => {
      await tx.executar(
        'UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = false, senha_expira_em = NULL, atualizado_em = $3 WHERE id = $1',
        [sessao.usuario.id, hash, agora.toISOString()],
      );
      const encerradas = await encerrarSessoesDoUsuario(tx, sessao.usuario.id, sessao.id);
      await auditar(tx, request, {
        acao: 'sessao.trocar_senha',
        recurso: 'usuario',
        recursoId: sessao.usuario.id,
        resumo: sessao.deveTrocarSenha ? 'Trocou a senha temporária no primeiro acesso' : 'Trocou a própria senha',
        dados: { outrasSessoesEncerradas: encerradas, eraTemporaria: sessao.deveTrocarSenha },
      });
    });
    return reply.status(204).send();
  });

  app.delete('/sessao', { preHandler: exigirSessao }, async (request, reply) => {
    const sessao = sessaoDe(request);
    await ctx.banco.transacao(async (tx) => {
      await encerrarSessao(tx, sessao.id);
      await auditar(tx, request, {
        acao: 'sessao.sair',
        recurso: 'sessao',
        recursoId: sessao.usuario.id,
        resumo: 'Saiu da Ágora',
      });
    });
    limparCookieSessao(reply, ctx.config);
    return reply.status(204).send();
  });

  // ───────── Login Único gov.br (OIDC + PKCE), habilitado só com AGORA_GOVBR_* definidos ─────────

  app.get('/sessao/govbr/iniciar', async (request, reply) => {
    if (!govbr) throw naoEncontrado('Login Único gov.br não está habilitado.');
    const inicio = await govbr.iniciar().catch((erro: unknown) => {
      request.log.warn({ err: erro }, 'falha ao iniciar o Login Único gov.br');
      return null;
    });
    if (!inicio) return reply.redirect('/entrar?erro=govbr', 302);
    reply.setCookie(COOKIE_GOVBR, serializarEstado(inicio.estado), {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.cookieSeguro,
      path: CAMINHO_COOKIE_GOVBR,
      maxAge: VALIDADE_ESTADO_MS / 1000,
    });
    return reply.redirect(inicio.url, 302);
  });

  const esquemaRetorno = z.object({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(512).optional(),
    error: z.string().max(200).optional(),
  });

  app.get('/sessao/govbr/retorno', async (request, reply) => {
    if (!govbr) throw naoEncontrado('Login Único gov.br não está habilitado.');
    reply.clearCookie(COOKIE_GOVBR, { path: CAMINHO_COOKIE_GOVBR, httpOnly: true, sameSite: 'lax', secure: ctx.config.cookieSeguro });

    const falhar = async (motivo: string, erro?: unknown) => {
      request.log.warn({ err: erro, motivo }, 'Login Único gov.br recusado');
      await ctx.banco.transacao((tx) =>
        registrarEvento(
          tx,
          {
            usuarioId: null,
            acao: 'sessao.falhar',
            recurso: 'sessao',
            recursoId: null,
            resumo: 'Tentativa de entrada pelo gov.br recusada',
            dados: { metodo: 'govbr', motivo },
            ipHash: request.ipHash,
          },
          ctx.relogio(),
        ),
      );
      return reply.redirect('/entrar?erro=govbr', 302);
    };

    const consulta = esquemaRetorno.safeParse(request.query);
    if (!consulta.success || consulta.data.error || !consulta.data.code || !consulta.data.state) {
      return falhar('retorno sem código de autorização');
    }
    const bruto = request.cookies[COOKIE_GOVBR];
    const desassinado = bruto ? request.unsignCookie(bruto) : null;
    const estado = desassinado?.valid && desassinado.value ? lerEstado(desassinado.value) : null;
    if (!estado) return falhar('estado ausente ou adulterado');

    const resultado = await govbr
      .concluir({ code: consulta.data.code, state: consulta.data.state }, estado)
      .then((r) => ({ ok: true as const, cpf: r.cpf }))
      .catch((erro: unknown) => ({ ok: false as const, erro }));
    if (!resultado.ok) return falhar('validação do gov.br falhou', resultado.erro);

    const [usuario] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM usuarios WHERE cpf = $1 AND ativo', [resultado.cpf]);
    if (!usuario) return falhar('CPF sem usuário ativo vinculado');

    await concluirLogin(request, reply, usuario.id, 'govbr', null);
    return reply.redirect('/', 302);
  });
}
