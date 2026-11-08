import type { Permissao } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import type { SessaoAtiva } from '../http/contexto.ts';
import { naoAutenticado, semPermissao, trocaSenhaObrigatoria } from '../http/erros.ts';

/** Sessão válida e sem troca de senha pendente (rotas de negócio). */
function sessaoLiberada(request: FastifyRequest): SessaoAtiva {
  const sessao = request.sessao;
  if (!sessao) throw naoAutenticado();
  if (sessao.deveTrocarSenha) throw trocaSenhaObrigatoria();
  return sessao;
}

/**
 * preHandler: exige sessão válida e a permissão indicada (401 sem sessão; 403 `SEM_PERMISSAO` sem permissão;
 * 403 `TROCA_SENHA_OBRIGATORIA` enquanto a senha temporária não for trocada).
 */
export function exigir(permissao: Permissao) {
  return async function verificarPermissao(request: FastifyRequest): Promise<void> {
    if (!sessaoLiberada(request).permissoes.has(permissao)) throw semPermissao();
  };
}

/** preHandler: exige ao menos uma das permissões (a rota refina a exigência conforme o caso). */
export function exigirAlguma(permissoes: readonly Permissao[]) {
  return async function verificarAlgumaPermissao(request: FastifyRequest): Promise<void> {
    const sessao = sessaoLiberada(request);
    if (!permissoes.some((p) => sessao.permissoes.has(p))) throw semPermissao();
  };
}

/**
 * preHandler: exige apenas sessão válida. Usado só pelas rotas da própria sessão (GET/DELETE /sessao e
 * POST /sessao/senha), que continuam disponíveis durante a troca obrigatória de senha.
 */
export async function exigirSessao(request: FastifyRequest): Promise<void> {
  if (!request.sessao) throw naoAutenticado();
}

/** Sessão já garantida por `exigir`/`exigirSessao` (para uso dentro dos handlers). */
export function sessaoDe(request: FastifyRequest): SessaoAtiva {
  const sessao = request.sessao;
  if (!sessao) throw naoAutenticado();
  return sessao;
}

/** Verifica, dentro do handler, uma permissão que depende do conteúdo da requisição. */
export function exigirPermissaoNoHandler(request: FastifyRequest, permissao: Permissao): void {
  if (!sessaoDe(request).permissoes.has(permissao)) throw semPermissao();
}

/**
 * Escopo de UASG para filtros SQL (`$n::text[] IS NULL OR uasg = ANY($n::text[])`):
 * `null` = todas as UASGs; senão a lista autorizada.
 */
export function escopoUasgs(sessao: SessaoAtiva): string[] | null {
  return sessao.todasUasgs ? null : sessao.uasgs;
}

export function podeVerUasg(sessao: SessaoAtiva, uasg: string): boolean {
  return sessao.todasUasgs || sessao.uasgs.includes(uasg);
}
