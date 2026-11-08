/**
 * Identificação do cidadão pelo Login Único gov.br (art. 174, § 3º, VI, "a": interessado previamente identificado).
 * O cidadão entra por `GET /sessao/govbr/cidadao`, que marca a intenção num cookie assinado e segue o fluxo OIDC
 * do gov.br que já existe. No retorno, um CPF sem usuário interno vira conta no perfil "cidadao", sem nenhum acesso
 * interno — só envia e acompanha as próprias manifestações. Sem a marcação, o CPF desconhecido continua recusado.
 */
import { mascararCpf } from '@agora/dominio';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CAMINHO_COOKIE_GOVBR, VALIDADE_ESTADO_MS } from '../../autenticacao/govbr.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { auditar } from '../../http/auditar.ts';

export const COOKIE_CIDADAO_GOVBR = 'agora_govbr_cidadao';
export const RETORNO_PADRAO_CIDADAO = '/sociedade/minhas-manifestacoes';
const RETORNO_PERMITIDO = /^\/(transparencia\/contratos\/[0-9a-f-]{36}|sociedade\/minhas-manifestacoes)$/;
const EMAIL_VALIDO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Só caminhos internos conhecidos (evita redirecionamento aberto). */
export function retornoCidadaoSeguro(retorno: unknown): string {
  return typeof retorno === 'string' && RETORNO_PERMITIDO.test(retorno) ? retorno : RETORNO_PADRAO_CIDADAO;
}

/** Marca, por 10 minutos, que o próximo retorno do gov.br é de um cidadão (cookie assinado, só no caminho do gov.br). */
export function marcarIntencaoCidadao(reply: FastifyReply, retorno: string, cookieSeguro: boolean): void {
  reply.setCookie(COOKIE_CIDADAO_GOVBR, retornoCidadaoSeguro(retorno), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSeguro,
    path: CAMINHO_COOKIE_GOVBR,
    maxAge: VALIDADE_ESTADO_MS / 1000,
  });
}

/** Lê e apaga a marcação de cidadão; devolve o caminho de retorno ou null quando o login não é de cidadão. */
export function consumirIntencaoCidadao(request: FastifyRequest, reply: FastifyReply, cookieSeguro: boolean): { retorno: string } | null {
  const bruto = request.cookies[COOKIE_CIDADAO_GOVBR];
  if (!bruto) return null;
  reply.clearCookie(COOKIE_CIDADAO_GOVBR, { path: CAMINHO_COOKIE_GOVBR, httpOnly: true, sameSite: 'lax', secure: cookieSeguro });
  const desassinado = request.unsignCookie(bruto);
  return desassinado.valid && desassinado.value ? { retorno: retornoCidadaoSeguro(desassinado.value) } : null;
}

/**
 * Conta do cidadão pelo CPF devolvido pelo gov.br: a existente, se ativa; null se a conta estiver desativada; ou
 * uma nova no perfil "cidadao", sem UASG e sem senha (só entra pelo gov.br). O cadastro vai para a trilha com o CPF
 * mascarado. E-mail ausente ou já usado por outra conta vira um endereço técnico não roteável.
 */
export async function obterOuCriarCidadao(
  ctx: ContextoApp,
  request: FastifyRequest,
  dados: { cpf: string; nome: string | null; email: string | null },
): Promise<string | null> {
  return ctx.banco.transacao(async (tx) => {
    const [existente] = await tx.consultar<{ id: string; ativo: boolean }>('SELECT id, ativo FROM usuarios WHERE cpf = $1', [dados.cpf]);
    if (existente) return existente.ativo ? existente.id : null;
    const nome = (dados.nome ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Cidadão identificado pelo gov.br';
    const informado = (dados.email ?? '').trim().toLowerCase();
    let email = `cidadao.${sha256Hex(`${dados.cpf}|${ctx.segredo}`).slice(0, 20)}@cidadao.invalid`;
    if (EMAIL_VALIDO.test(informado)) {
      const [usado] = await tx.consultar<{ id: string }>('SELECT id FROM usuarios WHERE email = $1', [informado]);
      if (!usado) email = informado;
    }
    const agora = ctx.relogio().toISOString();
    const [criado] = await tx.consultar<{ id: string }>(
      `INSERT INTO usuarios (nome, email, cpf, senha_hash, ativo, todas_uasgs, busca_normalizada, criado_em, atualizado_em)
       VALUES ($1, $2, $3, NULL, true, false, $4, $5, $5) RETURNING id`,
      [nome, email, dados.cpf, normalizarBusca(nome, email), agora],
    );
    if (!criado) throw new Error('Falha ao cadastrar o cidadão.');
    await tx.executar("INSERT INTO usuarios_perfis (usuario_id, perfil) VALUES ($1, 'cidadao')", [criado.id]);
    await auditar(tx, request, {
      usuarioId: criado.id,
      acao: 'sociedade.cidadao.cadastrar',
      recurso: 'usuario',
      recursoId: criado.id,
      resumo: 'Cidadão identificado pelo gov.br cadastrado no perfil sem acesso interno',
      dados: { cpf: mascararCpf(dados.cpf), perfil: 'cidadao' },
    });
    return criado.id;
  });
}
