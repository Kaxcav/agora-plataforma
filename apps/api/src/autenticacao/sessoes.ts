import type { CodigoPerfil, Sessao } from '@agora/contratos';
import type { FastifyReply } from 'fastify';
import type { Executor, Transacao } from '../banco/tipos.ts';
import { PERFIS_ESCOPO_TOTAL, ehCodigoPerfil, permissoesDosPerfis } from '../autorizacao/perfis.ts';
import { sha256Hex, tokenAleatorio } from '../compartilhado/cripto.ts';
import type { Config } from '../config.ts';
import type { SessaoAtiva } from '../http/contexto.ts';

export const COOKIE_SESSAO = 'agora_sessao';
const HORA_MS = 60 * 60 * 1000;
/** Expiração deslizante de 8 h, limitada a 12 h absolutas desde o login (ARQUITETURA §3.2). */
export const DURACAO_DESLIZANTE_MS = 8 * HORA_MS;
export const DURACAO_ABSOLUTA_MS = 12 * HORA_MS;
/** Renova a expiração no máximo a cada 5 min, para não gravar a cada requisição. */
const INTERVALO_RENOVACAO_MS = 5 * 60 * 1000;

export interface SessaoCriada {
  token: string;
  id: string;
  csrfToken: string;
  expiraEm: string;
}

export async function criarSessao(
  tx: Transacao,
  dados: { usuarioId: string; ipHash: string; agente: string; metodo: 'senha' | 'govbr' },
  agora: Date,
): Promise<SessaoCriada> {
  const token = tokenAleatorio(32);
  const id = sha256Hex(token);
  const csrfToken = tokenAleatorio(32);
  const expiraEm = new Date(agora.getTime() + DURACAO_DESLIZANTE_MS).toISOString();
  const absolutaAte = new Date(agora.getTime() + DURACAO_ABSOLUTA_MS).toISOString();
  await tx.executar('DELETE FROM sessoes WHERE expira_em <= $1 OR absoluta_ate <= $1', [agora.toISOString()]);
  await tx.executar(
    `INSERT INTO sessoes (id, usuario_id, csrf_token, criada_em, expira_em, absoluta_ate, ip_hash, agente, metodo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, dados.usuarioId, csrfToken, agora.toISOString(), expiraEm, absolutaAte, dados.ipHash, dados.agente.slice(0, 300), dados.metodo],
  );
  await tx.executar('UPDATE usuarios SET ultimo_acesso_em = $2 WHERE id = $1', [dados.usuarioId, agora.toISOString()]);
  return { token, id, csrfToken, expiraEm };
}

interface LinhaSessao {
  id: string;
  csrf_token: string;
  expira_em: string;
  absoluta_ate: string;
  usuario_id: string;
  nome: string;
  email: string;
  todas_uasgs: boolean;
  deve_trocar_senha: boolean;
  perfis: string[];
  uasgs: string[];
}

/** Carrega a sessão pelo token do cookie (guardado como SHA-256) e aplica a renovação deslizante. */
export async function carregarSessao(banco: Executor, token: string, agora: Date): Promise<SessaoAtiva | null> {
  const id = sha256Hex(token);
  const linhas = await banco.consultar<LinhaSessao>(
    `SELECT s.id, s.csrf_token, s.expira_em, s.absoluta_ate,
            u.id AS usuario_id, u.nome, u.email, u.todas_uasgs, u.deve_trocar_senha,
            COALESCE((SELECT array_agg(up.perfil ORDER BY up.perfil) FROM usuarios_perfis up WHERE up.usuario_id = u.id), '{}') AS perfis,
            COALESCE((SELECT array_agg(uu.uasg ORDER BY uu.uasg) FROM usuarios_uasgs uu WHERE uu.usuario_id = u.id), '{}') AS uasgs
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = $1 AND s.expira_em > $2 AND s.absoluta_ate > $2 AND u.ativo`,
    [id, agora.toISOString()],
  );
  const linha = linhas[0];
  if (!linha) return null;

  let expiraEm = linha.expira_em;
  const restante = Date.parse(linha.expira_em) - agora.getTime();
  if (DURACAO_DESLIZANTE_MS - restante > INTERVALO_RENOVACAO_MS) {
    const nova = Math.min(agora.getTime() + DURACAO_DESLIZANTE_MS, Date.parse(linha.absoluta_ate));
    expiraEm = new Date(nova).toISOString();
    await banco.executar('UPDATE sessoes SET expira_em = $2 WHERE id = $1', [id, expiraEm]);
  }

  const perfis: CodigoPerfil[] = linha.perfis.filter(ehCodigoPerfil);
  const escopoTotalPorPerfil = linha.uasgs.length === 0 && perfis.some((p) => PERFIS_ESCOPO_TOTAL.includes(p));
  const todasUasgs = linha.todas_uasgs || escopoTotalPorPerfil;
  return {
    id,
    csrfToken: linha.csrf_token,
    expiraEm,
    usuario: { id: linha.usuario_id, nome: linha.nome, email: linha.email },
    perfis,
    permissoes: new Set(permissoesDosPerfis(perfis)),
    todasUasgs,
    uasgs: todasUasgs ? [] : linha.uasgs,
    deveTrocarSenha: linha.deve_trocar_senha,
  };
}

export async function encerrarSessao(tx: Executor, id: string): Promise<void> {
  await tx.executar('DELETE FROM sessoes WHERE id = $1', [id]);
}

/** Encerra as sessões do usuário, exceto (opcionalmente) a sessão indicada. Devolve quantas foram encerradas. */
export async function encerrarSessoesDoUsuario(tx: Executor, usuarioId: string, exceto: string | null = null): Promise<number> {
  return tx.executar('DELETE FROM sessoes WHERE usuario_id = $1 AND ($2::text IS NULL OR id <> $2)', [usuarioId, exceto]);
}

/** Corpo de `Sessao` (o próprio usuário vê o seu e-mail completo). */
export async function montarSessao(banco: Executor, sessao: SessaoAtiva): Promise<Sessao> {
  const uasgs = sessao.todasUasgs
    ? (await banco.consultar<{ codigo: string }>('SELECT codigo FROM uasgs ORDER BY codigo')).map((u) => u.codigo)
    : sessao.uasgs;
  return {
    usuario: {
      id: sessao.usuario.id,
      nome: sessao.usuario.nome,
      email: sessao.usuario.email,
      perfis: sessao.perfis,
      permissoes: [...sessao.permissoes],
      uasgs,
      todasUasgs: sessao.todasUasgs,
      deveTrocarSenha: sessao.deveTrocarSenha,
    },
    csrfToken: sessao.csrfToken,
    expiraEm: sessao.expiraEm,
  };
}

export function definirCookieSessao(reply: FastifyReply, token: string, config: Pick<Config, 'cookieSeguro'>): void {
  reply.setCookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: config.cookieSeguro,
    signed: true,
    maxAge: Math.floor(DURACAO_ABSOLUTA_MS / 1000),
  });
}

export function limparCookieSessao(reply: FastifyReply, config: Pick<Config, 'cookieSeguro'>): void {
  reply.clearCookie(COOKIE_SESSAO, { httpOnly: true, sameSite: 'strict', path: '/', secure: config.cookieSeguro });
}
