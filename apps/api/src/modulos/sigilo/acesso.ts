/**
 * Decisão de acesso a informação sigilosa no servidor (RN-40) e registro de cada acesso, permitido ou negado
 * (Decreto 7.845/2012, art. 38, § 4º). A decisão vem de `decidirAcessoSigilo` (@agora/dominio); aqui se reúnem os
 * dados: classificações vigentes, credencial do usuário no processo, perfil de órgão de controle (`sigilo:controle`)
 * e a situação do orçamento sigiloso.
 */
import { decidirAcessoSigilo, type DecisaoAcessoSigilo } from '@agora/dominio';
import type { AlvoSigilo, BaseAcessoSigilo, CredencialAcessoSigilo } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import { permissoesDosPerfis } from '../../autorizacao/perfis.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import type { SessaoAtiva } from '../../http/contexto.ts';
import { auditar } from '../../http/auditar.ts';
import {
  classificacaoAplicavel,
  contratosSigilosos,
  credencialAtiva,
  idsContratosComClassificacaoLai,
  idsProcessosComClassificacaoLai,
  marcosOrcamento,
  vigentesPorProcesso,
  type AlvoConsulta,
  type LinhaClassificacao,
} from './consultas.ts';

export interface ContextoAcessoSigilo {
  processoId: string;
  vigentes: LinhaClassificacao[];
  orcamentoDivulgado: boolean;
  orgaoControle: boolean;
  credencial: CredencialAcessoSigilo | null;
  hoje: string;
}

/**
 * Órgão de controle: algum perfil, fora o de administrador, concede `sigilo:controle` (auditor e controle interno).
 * O administrador tem todas as permissões da matriz por definição, mas administrar o sistema não dá necessidade de
 * conhecer a informação classificada: ele precisa de credencial como qualquer servidor.
 */
export function ehOrgaoControle(sessao: SessaoAtiva): boolean {
  return permissoesDosPerfis(sessao.perfis.filter((p) => p !== 'administrador')).includes('sigilo:controle');
}

export async function carregarContextoAcesso(executor: Executor, processoId: string, sessao: SessaoAtiva, hoje: string): Promise<ContextoAcessoSigilo> {
  const vigentes = (await vigentesPorProcesso(executor, [processoId], hoje)).get(processoId) ?? [];
  const precisaOrcamento = vigentes.some((c) => c.tipo === 'orcamento');
  const marcos = precisaOrcamento ? (await marcosOrcamento(executor, [processoId])).get(processoId) : undefined;
  return {
    processoId,
    vigentes,
    orcamentoDivulgado: marcos?.situacao.divulgavel ?? false,
    orgaoControle: ehOrgaoControle(sessao),
    credencial: vigentes.length > 0 ? await credencialAtiva(executor, processoId, sessao.usuario.id) : null,
    hoje,
  };
}

export interface ResultadoDecisao {
  decisao: DecisaoAcessoSigilo;
  classificacao: LinhaClassificacao | null;
}

export function decidirPara(c: ContextoAcessoSigilo, alvo: AlvoConsulta): ResultadoDecisao {
  const classificacao = classificacaoAplicavel(c.vigentes, alvo);
  const decisao = decidirAcessoSigilo({
    classificacao: classificacao ? { tipo: classificacao.tipo, grau: classificacao.grau, vigente: true } : null,
    orcamentoDivulgado: c.orcamentoDivulgado,
    orgaoControle: c.orgaoControle,
    credencial: c.credencial ? { grauMaximo: c.credencial.grauMaximo, validaAte: c.credencial.validaAte, ativa: c.credencial.ativa } : null,
    hoje: c.hoje,
  });
  return { decisao, classificacao };
}

export const ROTULO_BASE: Record<BaseAcessoSigilo, string> = {
  sem_sigilo: 'sem classificação vigente',
  controle: 'órgão de controle, acesso irrestrito',
  credencial: 'credencial no processo',
  orcamento_divulgado: 'orçamento já divulgado',
  negado_sem_credencial: 'sem credencial',
  negado_credencial_vencida: 'credencial vencida',
  negado_grau_insuficiente: 'grau da credencial insuficiente',
};

export interface RegistroAcesso {
  processoId: string;
  numeroSei: string;
  classificacaoId: string | null;
  alvo: AlvoSigilo;
  titulo: string;
  operacao: 'consulta' | 'pdf' | 'download';
  permitido: boolean;
  base: BaseAcessoSigilo;
  motivo: string | null;
}

/** Grava o acesso em `sigilo_acessos` (somente inclusão) e na trilha de auditoria, na transação informada. */
export async function registrarAcessoSigilo(tx: Transacao, request: FastifyRequest, r: RegistroAcesso): Promise<void> {
  const usuarioId = request.sessao?.usuario.id;
  if (!usuarioId) return;
  const agora = request.server.agora.relogio().toISOString();
  await tx.executar(
    `INSERT INTO sigilo_acessos (processo_id, classificacao_id, usuario_id, ocorrido_em, alvo, titulo, operacao, permitido, base, motivo, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [r.processoId, r.classificacaoId, usuarioId, agora, r.alvo, r.titulo.slice(0, 300), r.operacao, r.permitido, r.base, r.motivo, request.ipHash || null],
  );
  const verbo = r.operacao === 'consulta' ? 'Consultou' : r.operacao === 'pdf' ? 'Gerou o PDF marcado de' : 'Baixou do cofre';
  await auditar(tx, request, {
    acao: r.permitido ? 'sigilo.acessar' : 'sigilo.acesso_negado',
    recurso: 'processo',
    recursoId: r.processoId,
    resumo: r.permitido ? `${verbo} informação sigilosa: ${r.titulo} (${ROTULO_BASE[r.base]})` : `Acesso negado a informação sigilosa: ${r.titulo} (${ROTULO_BASE[r.base]})`,
    dados: {
      numeroSei: r.numeroSei,
      alvo: r.alvo,
      operacao: r.operacao,
      base: r.base,
      classificacaoId: r.classificacaoId,
      ...(r.motivo !== null ? { motivo: r.motivo } : {}),
    },
  });
}

/** Consulta (permitida ou negada) já registrada nos últimos 10 minutos: evita uma linha por requisição da mesma tela. */
export async function consultaRegistradaRecentemente(
  executor: Executor,
  processoId: string,
  usuarioId: string,
  alvo: AlvoSigilo,
  titulo: string,
  agora: Date,
  permitido: boolean,
): Promise<boolean> {
  const limite = new Date(agora.getTime() - 10 * 60 * 1000).toISOString();
  const [linha] = await executor.consultar<{ existe: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM sigilo_acessos
        WHERE processo_id = $1 AND usuario_id = $2 AND alvo = $3 AND titulo = $4 AND operacao = 'consulta' AND permitido = $6 AND ocorrido_em >= $5
     ) AS existe`,
    [processoId, usuarioId, alvo, titulo, limite, permitido],
  );
  return linha?.existe ?? false;
}

/** Texto que substitui título e objeto de quem não tem credencial nas listas internas (LAI, art. 24). */
export function rotuloInformacaoClassificada(c: LinhaClassificacao): string {
  return c.grau ? `Informação classificada (${c.grau})` : 'Informação classificada';
}

/**
 * Processos classificados pela LAI aos quais o usuário NÃO tem acesso hoje, com a classificação que vale. Órgão de
 * controle (auditor, controle interno) tem acesso irrestrito e nunca entra aqui. A decisão é a mesma do detalhe
 * (`decidirPara`), sem regra paralela.
 */
export async function processosSemAcesso(executor: Executor, sessao: SessaoAtiva, hoje: string): Promise<Map<string, LinhaClassificacao>> {
  const mapa = new Map<string, LinhaClassificacao>();
  if (ehOrgaoControle(sessao)) return mapa;
  for (const processoId of await idsProcessosComClassificacaoLai(executor)) {
    const contexto = await carregarContextoAcesso(executor, processoId, sessao, hoje);
    const { decisao, classificacao } = decidirPara(contexto, { alvo: 'processo' });
    if (!decisao.permitido && classificacao?.tipo === 'lai') mapa.set(processoId, classificacao);
  }
  return mapa;
}

/** Contratos sigilosos (art. 91, § 1º) aos quais o usuário não tem acesso hoje, com a classificação que vale. */
export async function contratosSemAcesso(executor: Executor, sessao: SessaoAtiva, hoje: string): Promise<Map<string, LinhaClassificacao>> {
  const mapa = new Map<string, LinhaClassificacao>();
  if (ehOrgaoControle(sessao)) return mapa;
  const sigilosos = await contratosSigilosos(executor, await idsContratosComClassificacaoLai(executor), hoje);
  const contextos = new Map<string, ContextoAcessoSigilo>();
  for (const [contratoId, classificacao] of sigilosos) {
    let contexto = contextos.get(classificacao.processo_id);
    if (!contexto) {
      contexto = await carregarContextoAcesso(executor, classificacao.processo_id, sessao, hoje);
      contextos.set(classificacao.processo_id, contexto);
    }
    if (!decidirPara(contexto, { alvo: 'contrato', contratoId }).decisao.permitido) mapa.set(contratoId, classificacao);
  }
  return mapa;
}

/** Troca o objeto de contrato sigiloso por "Informação classificada" para quem não tem acesso (listas aninhadas). */
export async function mascararContratosSigilosos<T extends { id: string; objeto: string }>(
  executor: Executor,
  sessao: SessaoAtiva,
  hoje: string,
  contratos: T[],
): Promise<T[]> {
  const restritos = await contratosSemAcesso(executor, sessao, hoje);
  for (const c of contratos) {
    const restrito = restritos.get(c.id);
    if (restrito) c.objeto = rotuloInformacaoClassificada(restrito);
  }
  return contratos;
}
