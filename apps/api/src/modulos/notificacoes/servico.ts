/**
 * Serviço da central de notificações (RF-26) e dos avisos de vencimento 30/60/90/120 (RN-31).
 *
 * - Outbox: a notificação e os envios são gravados na mesma transação da escrita (ou da varredura), com a trilha
 *   de auditoria; o envio acontece depois, fora da transação, com novas tentativas (`processarFila`).
 * - Varredura diária idempotente: uma chave por instrumento, tipo, faixa e data de referência; um advisory lock
 *   impede duas réplicas (ou a API e o processo à parte) de varrerem ao mesmo tempo.
 * - LGPD: o e-mail fica na fila só para o envio, aparece mascarado nas telas e não entra na trilha; o CPF do
 *   gov.br é lido do cadastro na hora do envio. Cada envio registra a base legal do tratamento.
 */
import type {
  CanalNotificacao,
  FaixaVencimento,
  PapelDestinatario,
  ResultadoVarreduraNotificacoes,
  TipoNotificacao,
} from '@agora/contratos';
import {
  adicionarDias,
  avaliarAvisoGarantia,
  avaliarAvisoReajuste,
  avaliarAvisoVencimento,
  baseLegalEnvio,
  decidirEntregaNotificacao,
  formatarData,
  mascararEmail,
  montarMensagemNotificacao,
  proximaTentativa,
  MAXIMO_TENTATIVAS_ENVIO,
  type MensagemNotificacao,
} from '@agora/dominio';
import { registrarEventos, type EntradaEvento } from '../../auditoria/trilha.ts';
import { inserirEmLote } from '../../banco/lote.ts';
import type { Banco, Executor, ParametroSql, Transacao } from '../../banco/tipos.ts';
import type { Config } from '../../config.ts';
import { identificadorInstrumento, normalizarBusca } from '../../compartilhado/texto.ts';
import { criarDrivers, ErroEnvio, type DriversCanais } from './canais.ts';
import { alertasProrrogacao } from '../alteracoes/prorrogacao.ts';

/** Dependências do serviço (o `ContextoApp` da API e o processo à parte as fornecem). */
export interface ContextoNotificacoes {
  banco: Banco;
  config: Config;
  relogio: () => Date;
  hoje: () => string;
}

/** Advisory lock da varredura diária (uma réplica por vez). */
export const CHAVE_LOCK_VARREDURA = 14_133_026;
/** Envio preso em "enviando" (processo caiu no meio) volta para a fila depois deste tempo. */
const ENVIANDO_EXPIRA_MS = 10 * 60 * 1000;
const TAMANHO_LOTE_FILA = 50;
const LIMITE_ERRO = 500;
/** Tipos de pendência já cobertos por avisos próprios (vencimento, garantia e reajuste). */
const PENDENCIAS_COM_AVISO_PROPRIO = ['vigencia', 'garantia', 'reajuste'];

export const ROTULO_CANAL: Record<CanalNotificacao, string> = { email: 'e-mail', sei: 'SEI', govbr: 'gov.br' };
export const ROTULO_PAPEL: Record<PapelDestinatario, string> = {
  gestor: 'gestor',
  fiscal: 'fiscal',
  contratada: 'contratada',
  responsavel: 'responsável',
  cidadao: 'cidadão',
};
export const ROTULO_TIPO: Record<TipoNotificacao, string> = {
  vencimento: 'vencimento',
  reajuste: 'reajuste',
  garantia: 'garantia',
  pendencia: 'pendência',
  ocorrencia: 'ocorrência',
  manifestacao: 'manifestação',
};

// ───────────────────────── Instrumentos e destinatários ─────────────────────────

export interface InstrumentoNotificavel {
  tipo: 'ata' | 'contrato';
  id: string;
  numero: string;
  uasg: string;
  objeto: string;
  processoSei: string | null;
  vigenciaFim: string;
  gestorId: string | null;
  fiscalId: string | null;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  indiceReajuste: string | null;
  dataBaseReajuste: string | null;
  garantiaValidaAte: string | null;
}

interface LinhaInstrumento {
  id: string;
  numero: string;
  uasg: string;
  objeto: string;
  processo_sei: string | null;
  vigencia_fim: string;
  gestor_id: string | null;
  fiscal_id: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  indice_reajuste: string | null;
  data_base_reajuste: string | null;
  garantia_valida_ate: string | null;
}

const SELECAO_CONTRATOS = `
  SELECT c.id, c.numero, c.uasg, c.objeto, c.processo_sei, c.vigencia_fim, c.gestor_id, c.fiscal_id, c.fornecedor_id,
         f.razao_social AS fornecedor_nome, c.indice_reajuste, c.data_base_reajuste, c.garantia_valida_ate
    FROM contratos c
    JOIN fornecedores f ON f.id = c.fornecedor_id`;

const SELECAO_ATAS = `
  SELECT a.id, a.numero, a.uasg, a.objeto, a.processo_sei, a.vigencia_fim, a.gestor_id, NULL::uuid AS fiscal_id,
         NULL::uuid AS fornecedor_id, NULL::text AS fornecedor_nome, a.indice_reajuste, a.data_base_reajuste,
         NULL::date AS garantia_valida_ate
    FROM atas a`;

function mapearInstrumento(tipo: 'ata' | 'contrato', l: LinhaInstrumento): InstrumentoNotificavel {
  return {
    tipo,
    id: l.id,
    numero: l.numero,
    uasg: l.uasg,
    objeto: l.objeto,
    processoSei: l.processo_sei,
    vigenciaFim: l.vigencia_fim,
    gestorId: l.gestor_id,
    fiscalId: l.fiscal_id,
    fornecedorId: l.fornecedor_id,
    fornecedorNome: l.fornecedor_nome,
    indiceReajuste: l.indice_reajuste,
    dataBaseReajuste: l.data_base_reajuste,
    garantiaValidaAte: l.garantia_valida_ate,
  };
}

/** Contrato ou ata dentro do escopo de UASG (null = fora do escopo ou inexistente). */
export async function carregarInstrumento(
  executor: Executor,
  tipo: 'ata' | 'contrato',
  id: string,
  escopo: string[] | null,
): Promise<InstrumentoNotificavel | null> {
  const selecao = tipo === 'contrato' ? SELECAO_CONTRATOS : SELECAO_ATAS;
  const alias = tipo === 'contrato' ? 'c' : 'a';
  const [linha] = await executor.consultar<LinhaInstrumento>(
    `${selecao} WHERE ${alias}.id = $1 AND ($2::text[] IS NULL OR ${alias}.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  return linha ? mapearInstrumento(tipo, linha) : null;
}

export interface Destinatario {
  papel: PapelDestinatario;
  usuarioId: string | null;
  fornecedorId: string | null;
  nome: string;
  email: string | null;
  ativo: boolean;
  pessoaFisica: boolean;
}

async function carregarUsuarios(executor: Executor, ids: readonly string[]): Promise<Map<string, { nome: string; email: string; ativo: boolean }>> {
  if (ids.length === 0) return new Map();
  const linhas = await executor.consultar<{ id: string; nome: string; email: string; ativo: boolean }>(
    'SELECT id, nome, email, ativo FROM usuarios WHERE id = ANY($1::uuid[])',
    [[...new Set(ids)]],
  );
  return new Map(linhas.map((l) => [l.id, { nome: l.nome, email: l.email, ativo: l.ativo }]));
}

async function contratadasDe(executor: Executor, instrumento: InstrumentoNotificavel): Promise<Destinatario[]> {
  const linhas = await executor.consultar<{ id: string; razao_social: string; email: string | null; tipo_pessoa: 'PJ' | 'PF' }>(
    instrumento.tipo === 'contrato'
      ? 'SELECT id, razao_social, email, tipo_pessoa FROM fornecedores WHERE id = $1'
      : `SELECT DISTINCT f.id, f.razao_social, f.email, f.tipo_pessoa
           FROM itens_ata i JOIN fornecedores f ON f.id = i.fornecedor_id
          WHERE i.ata_id = $1 ORDER BY f.razao_social`,
    [instrumento.tipo === 'contrato' ? (instrumento.fornecedorId ?? '') : instrumento.id],
  );
  return linhas.map((l) => ({
    papel: 'contratada',
    usuarioId: null,
    fornecedorId: l.id,
    nome: l.razao_social,
    email: l.email,
    ativo: true,
    pessoaFisica: l.tipo_pessoa === 'PF',
  }));
}

/** Destinatários dos papéis pedidos; o mesmo servidor em dois papéis recebe uma vez só. */
export async function resolverDestinatarios(
  executor: Executor,
  instrumento: InstrumentoNotificavel,
  papeis: readonly PapelDestinatario[],
  responsavelId: string | null = null,
): Promise<Destinatario[]> {
  const idPorPapel: Partial<Record<PapelDestinatario, string | null>> = {
    gestor: instrumento.gestorId,
    fiscal: instrumento.fiscalId,
    responsavel: responsavelId,
  };
  const usuarios = await carregarUsuarios(
    executor,
    papeis.flatMap((p) => {
      const id = idPorPapel[p];
      return id ? [id] : [];
    }),
  );
  const destinatarios: Destinatario[] = [];
  const vistos = new Set<string>();
  for (const papel of papeis) {
    if (papel === 'contratada') {
      destinatarios.push(...(await contratadasDe(executor, instrumento)));
      continue;
    }
    const id = idPorPapel[papel];
    const usuario = id ? usuarios.get(id) : undefined;
    if (!id || !usuario || vistos.has(id)) continue;
    vistos.add(id);
    destinatarios.push({ papel, usuarioId: id, fornecedorId: null, nome: usuario.nome, email: usuario.email, ativo: usuario.ativo, pessoaFisica: true });
  }
  return destinatarios;
}

// ───────────────────────── Gravação (outbox) ─────────────────────────

export interface NovaNotificacao {
  tipo: TipoNotificacao;
  origem: 'automatica' | 'manual';
  instrumento: InstrumentoNotificavel;
  mensagem: MensagemNotificacao;
  /** Só nos avisos automáticos (idempotência da varredura). */
  chave: string | null;
  criadaPor: string | null;
}

export interface NotificacaoGravada {
  id: string;
  envios: number;
  suprimidos: number;
}

const COLUNAS_ENVIOS = [
  'notificacao_id', 'canal', 'papel', 'usuario_id', 'fornecedor_id', 'destinatario', 'endereco', 'base_legal', 'situacao',
  'motivo_supressao', 'max_tentativas', 'proxima_tentativa_em', 'reenvio_de', 'criado_em', 'atualizado_em',
] as const;

function canalDesligado(config: Config, canal: CanalNotificacao): boolean {
  return (canal === 'sei' && config.notificacoes.sei === 'desligado') || (canal === 'govbr' && config.notificacoes.govbr === 'desligado');
}

/** Situação inicial de um envio: pendente ou suprimido (com o motivo, para a trilha e a tela). */
function situacaoInicial(
  config: Config,
  instrumento: InstrumentoNotificavel,
  d: Destinatario,
  canal: CanalNotificacao,
  obrigatoria: boolean,
  preferencia: boolean | null,
): { endereco: string | null; motivo: string | null } {
  const endereco = canal === 'email' ? d.email : canal === 'sei' ? instrumento.processoSei : null;
  if (canalDesligado(config, canal)) return { endereco, motivo: 'Canal desligado na configuração do órgão.' };
  if (!d.ativo) return { endereco, motivo: 'Usuário inativo na Ágora.' };
  const decisao = decidirEntregaNotificacao({ canal, papel: d.papel, obrigatoria, preferencia, destinatarioPessoaFisica: d.pessoaFisica });
  if (!decisao.enviar) return { endereco, motivo: decisao.motivo };
  if (canal === 'email' && !endereco) return { endereco, motivo: 'Destinatário sem e-mail cadastrado.' };
  if (canal === 'sei' && !endereco) return { endereco, motivo: 'O instrumento não tem processo SEI informado.' };
  return { endereco, motivo: null };
}

/**
 * Grava a notificação e um envio por destinatário e canal (outbox), na transação do chamador.
 * Devolve null quando a chave de idempotência já existe (aviso automático já gerado).
 */
export async function gravarNotificacao(
  tx: Transacao,
  config: Config,
  agora: Date,
  nova: NovaNotificacao,
  destinatarios: readonly Destinatario[],
  canais: readonly CanalNotificacao[],
  /** Varredura automática: só cria envio pelo gov.br para quem aderiu (evita uma linha suprimida por servidor). */
  omitirGovbrSemAdesao = false,
): Promise<NotificacaoGravada | null> {
  const instante = agora.toISOString();
  const i = nova.instrumento;
  const [criada] = await tx.consultar<{ id: string }>(
    `INSERT INTO notificacoes (tipo, origem, instrumento_tipo, instrumento_id, uasg, faixa, obrigatoria, assunto, corpo, fundamento,
                               chave_idempotencia, criada_por, criada_em, busca_normalizada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING id`,
    [
      nova.tipo,
      nova.origem,
      i.tipo,
      i.id,
      i.uasg,
      nova.mensagem.faixa,
      nova.mensagem.obrigatoria,
      nova.mensagem.assunto,
      nova.mensagem.corpo,
      nova.mensagem.fundamento,
      nova.chave,
      nova.criadaPor,
      instante,
      normalizarBusca(nova.mensagem.assunto, i.objeto, i.numero),
    ],
  );
  if (!criada) return null;

  const idsUsuarios = destinatarios.flatMap((d) => (d.usuarioId ? [d.usuarioId] : []));
  const preferencias =
    idsUsuarios.length === 0
      ? []
      : await tx.consultar<{ usuario_id: string; canal: string; ativo: boolean }>(
          'SELECT usuario_id, canal, ativo FROM notificacoes_preferencias WHERE usuario_id = ANY($1::uuid[]) AND tipo = $2',
          [idsUsuarios, nova.tipo],
        );
  const preferenciaDe = (usuarioId: string | null, canal: CanalNotificacao): boolean | null =>
    usuarioId === null ? null : (preferencias.find((p) => p.usuario_id === usuarioId && p.canal === canal)?.ativo ?? null);

  const linhas: ParametroSql[][] = [];
  let suprimidos = 0;
  for (const d of destinatarios) {
    for (const canal of canais) {
      if (canal === 'govbr' && omitirGovbrSemAdesao && preferenciaDe(d.usuarioId, 'govbr') !== true) continue;
      const { endereco, motivo } = situacaoInicial(config, i, d, canal, nova.mensagem.obrigatoria, preferenciaDe(d.usuarioId, canal));
      if (motivo !== null) suprimidos++;
      linhas.push([
        criada.id,
        canal,
        d.papel,
        d.usuarioId,
        d.fornecedorId,
        d.nome,
        endereco,
        baseLegalEnvio(d.papel),
        motivo === null ? 'pendente' : 'suprimido',
        motivo,
        MAXIMO_TENTATIVAS_ENVIO,
        motivo === null ? instante : null,
        null,
        instante,
        instante,
      ]);
    }
  }
  if (linhas.length > 0) await inserirEmLote(tx, 'notificacoes_envios', COLUNAS_ENVIOS, linhas);
  return { id: criada.id, envios: linhas.length, suprimidos };
}

/** Dados do instrumento para os modelos de mensagem do domínio. */
export function instrumentoDaMensagem(i: InstrumentoNotificavel) {
  return {
    tipo: i.tipo,
    identificador: identificadorInstrumento(i.tipo, i.numero),
    objeto: i.objeto,
    uasg: i.uasg,
    processoSei: i.processoSei,
    vigenciaFim: i.vigenciaFim,
    fornecedor: i.fornecedorNome,
    indiceReajuste: i.indiceReajuste,
  };
}

// ───────────────────────── Disparo manual e reenvio ─────────────────────────

export interface EntradaDisparo {
  tipo: TipoNotificacao;
  destinatarios: readonly ('gestor' | 'fiscal' | 'contratada')[];
  canais: readonly CanalNotificacao[];
  dataReferencia: string | null;
  detalhe: string | null;
  complemento: string | null;
}

export class ErroDisparo extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDisparo';
  }
}

/** Data de referência padrão do aviso manual: aniversário da data-base (reajuste) ou validade da garantia. */
function dataReferenciaPadrao(tipo: TipoNotificacao, i: InstrumentoNotificavel, hoje: string): string | null {
  if (tipo === 'reajuste' && i.dataBaseReajuste) return avaliarAvisoReajuste(i.dataBaseReajuste, hoje, 400)?.aniversario ?? null;
  if (tipo === 'garantia') return i.garantiaValidaAte;
  return null;
}

/** Disparo manual em um clique (na transação do chamador, que registra o evento de auditoria). */
export async function criarNotificacaoManual(
  tx: Transacao,
  config: Config,
  agora: Date,
  hoje: string,
  instrumento: InstrumentoNotificavel,
  entrada: EntradaDisparo,
  usuarioId: string,
): Promise<NotificacaoGravada & { mensagem: MensagemNotificacao }> {
  if (entrada.destinatarios.includes('fiscal') && instrumento.tipo === 'ata') {
    throw new ErroDisparo('Ata de registro de preços não tem fiscal: escolha o gestor ou as fornecedoras.');
  }
  if (entrada.destinatarios.includes('fiscal') && !instrumento.fiscalId) throw new ErroDisparo('O contrato não tem fiscal designado.');
  if (entrada.destinatarios.includes('gestor') && !instrumento.gestorId) throw new ErroDisparo('O instrumento não tem gestor designado.');
  if (entrada.tipo === 'garantia' && instrumento.tipo === 'ata') throw new ErroDisparo('Ata de registro de preços não tem garantia contratual.');
  const dataReferencia = entrada.dataReferencia ?? dataReferenciaPadrao(entrada.tipo, instrumento, hoje);
  const mensagem = montarMensagemNotificacao({
    tipo: entrada.tipo,
    origem: 'manual',
    hoje,
    instrumento: instrumentoDaMensagem(instrumento),
    dataReferencia,
    detalhe: entrada.detalhe,
    complemento: entrada.complemento,
  });
  const destinatarios = await resolverDestinatarios(tx, instrumento, entrada.destinatarios);
  if (destinatarios.length === 0) throw new ErroDisparo('Nenhum destinatário encontrado para o instrumento.');
  const gravada = await gravarNotificacao(
    tx,
    config,
    agora,
    { tipo: entrada.tipo, origem: 'manual', instrumento, mensagem, chave: null, criadaPor: usuarioId },
    destinatarios,
    entrada.canais,
  );
  if (!gravada) throw new Error('Falha ao gravar a notificação');
  return { ...gravada, mensagem };
}

/**
 * Reenvio: um novo envio, ligado ao original, para o mesmo destinatário e canal (o original fica no histórico).
 * O endereço é relido do cadastro atual: corrigido o e-mail (ou o processo SEI), o reenvio já usa o novo.
 */
export async function criarReenvio(tx: Transacao, agora: Date, envioId: string): Promise<{ id: string; notificacaoId: string }> {
  const instante = agora.toISOString();
  const [novo] = await tx.consultar<{ id: string; notificacao_id: string }>(
    `INSERT INTO notificacoes_envios (notificacao_id, canal, papel, usuario_id, fornecedor_id, destinatario, endereco, base_legal,
                                      situacao, max_tentativas, proxima_tentativa_em, reenvio_de, criado_em, atualizado_em)
     SELECT e.notificacao_id, e.canal, e.papel, e.usuario_id, e.fornecedor_id, e.destinatario,
            CASE e.canal
              WHEN 'email' THEN COALESCE(u.email, f.email, e.endereco)
              WHEN 'sei' THEN COALESCE(c.processo_sei, a.processo_sei, e.endereco)
              ELSE e.endereco
            END,
            e.base_legal, 'pendente', $3, $2, e.id, $2, $2
       FROM notificacoes_envios e
       JOIN notificacoes n ON n.id = e.notificacao_id
       LEFT JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
       LEFT JOIN contratos c ON n.instrumento_tipo = 'contrato' AND c.id = n.instrumento_id
       LEFT JOIN atas a ON n.instrumento_tipo = 'ata' AND a.id = n.instrumento_id
      WHERE e.id = $1
     RETURNING id, notificacao_id`,
    [envioId, instante, MAXIMO_TENTATIVAS_ENVIO],
  );
  if (!novo) throw new Error('Falha ao criar o reenvio');
  return { id: novo.id, notificacaoId: novo.notificacao_id };
}

// ───────────────────────── Fila (envio com novas tentativas) ─────────────────────────

interface LinhaEnvioFila {
  id: string;
  notificacao_id: string;
  canal: CanalNotificacao;
  papel: PapelDestinatario;
  destinatario: string;
  endereco: string | null;
  tentativas: number;
  max_tentativas: number;
  assunto: string;
  corpo: string;
  cpf: string | null;
}

/** Mascara e-mails que o servidor de destino devolva na mensagem de erro (a mensagem vai para a tela e a trilha). */
export function sanitizarErro(texto: string): string {
  const mascarado = texto.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[^\s<>"'(),;:]+/g, (email) => {
    try {
      return mascararEmail(email);
    } catch {
      return '[e-mail omitido]';
    }
  });
  return mascarado.length > LIMITE_ERRO ? `${mascarado.slice(0, LIMITE_ERRO - 1)}…` : mascarado;
}

export interface OpcoesFila {
  drivers?: DriversCanais;
  notificacaoId?: string;
  envioIds?: readonly string[];
  /** Máximo de envios processados nesta execução. */
  limite?: number;
}

async function reservarLote(ctx: ContextoNotificacoes, opcoes: OpcoesFila, tamanho: number): Promise<LinhaEnvioFila[]> {
  const agora = ctx.relogio();
  const instante = agora.toISOString();
  return ctx.banco.transacao(async (tx) => {
    await tx.executar(
      `UPDATE notificacoes_envios SET situacao = 'pendente', proxima_tentativa_em = $1, atualizado_em = $1
        WHERE situacao = 'enviando' AND atualizado_em < $2`,
      [instante, new Date(agora.getTime() - ENVIANDO_EXPIRA_MS).toISOString()],
    );
    const devidos = await tx.consultar<{ id: string }>(
      `SELECT id FROM notificacoes_envios
        WHERE situacao = 'pendente' AND proxima_tentativa_em <= $1
          AND ($2::uuid IS NULL OR notificacao_id = $2)
          AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
        ORDER BY proxima_tentativa_em, criado_em
        LIMIT $4
        FOR UPDATE SKIP LOCKED`,
      [instante, opcoes.notificacaoId ?? null, opcoes.envioIds ? [...opcoes.envioIds] : null, tamanho],
    );
    if (devidos.length === 0) return [];
    const ids = devidos.map((d) => d.id);
    await tx.executar(
      `UPDATE notificacoes_envios
          SET situacao = 'enviando', tentativas = tentativas + 1, ultima_tentativa_em = $2, atualizado_em = $2
        WHERE id = ANY($1::uuid[])`,
      [ids, instante],
    );
    return tx.consultar<LinhaEnvioFila>(
      `SELECT e.id, e.notificacao_id, e.canal, e.papel, e.destinatario, e.endereco, e.tentativas, e.max_tentativas,
              n.assunto, n.corpo,
              CASE WHEN e.canal = 'govbr' THEN COALESCE(u.cpf, CASE WHEN f.tipo_pessoa = 'PF' THEN f.documento END) END AS cpf
         FROM notificacoes_envios e
         JOIN notificacoes n ON n.id = e.notificacao_id
         LEFT JOIN usuarios u ON u.id = e.usuario_id
         LEFT JOIN fornecedores f ON f.id = e.fornecedor_id
        WHERE e.id = ANY($1::uuid[])
        ORDER BY e.criado_em, e.id`,
      [ids],
    );
  });
}

type Desfecho = { envio: LinhaEnvioFila; ok: true; modo: string; protocolo: string } | { envio: LinhaEnvioFila; ok: false; erro: string; permanente: boolean };

async function registrarDesfechos(ctx: ContextoNotificacoes, desfechos: readonly Desfecho[]): Promise<void> {
  const agora = ctx.relogio();
  const instante = agora.toISOString();
  await ctx.banco.transacao(async (tx) => {
    const eventos: (EntradaEvento & { ocorridoEm: Date })[] = [];
    for (const d of desfechos) {
      const e = d.envio;
      const base = { notificacaoId: e.notificacao_id, envioId: e.id, canal: e.canal, papel: e.papel, tentativas: e.tentativas };
      if (d.ok) {
        await tx.executar(
          `UPDATE notificacoes_envios
              SET situacao = 'enviado', enviado_em = $2, modo = $3, protocolo = $4, ultimo_erro = NULL,
                  proxima_tentativa_em = NULL, atualizado_em = $2
            WHERE id = $1`,
          [e.id, instante, d.modo, d.protocolo],
        );
        eventos.push({
          ocorridoEm: agora,
          usuarioId: null,
          acao: 'notificacao.envio',
          recurso: 'notificacao_envio',
          recursoId: e.id,
          resumo: `Enviou aviso por ${ROTULO_CANAL[e.canal]} (${ROTULO_PAPEL[e.papel]}): ${e.assunto}`,
          dados: { ...base, situacao: 'enviado', modo: d.modo, protocolo: d.protocolo },
        });
        continue;
      }
      const proxima = d.permanente ? null : proximaTentativa(e.tentativas, instante, e.max_tentativas);
      const situacao = proxima === null ? 'falhou' : 'pendente';
      await tx.executar(
        `UPDATE notificacoes_envios
            SET situacao = $2, ultimo_erro = $3, proxima_tentativa_em = $4, atualizado_em = $5
          WHERE id = $1`,
        [e.id, situacao, d.erro, proxima, instante],
      );
      eventos.push({
        ocorridoEm: agora,
        usuarioId: null,
        acao: 'notificacao.envio_falha',
        recurso: 'notificacao_envio',
        recursoId: e.id,
        resumo:
          situacao === 'falhou'
            ? `Falha definitiva no envio por ${ROTULO_CANAL[e.canal]} (${ROTULO_PAPEL[e.papel]}) após ${e.tentativas} tentativa(s): ${e.assunto}`
            : `Falha no envio por ${ROTULO_CANAL[e.canal]} (${ROTULO_PAPEL[e.papel]}), tentativa ${e.tentativas} de ${e.max_tentativas}; nova tentativa agendada: ${e.assunto}`,
        dados: { ...base, situacao, erro: d.erro, proximaTentativaEm: proxima },
      });
    }
    await registrarEventos(tx, eventos);
  });
}

/**
 * Processa a fila: reserva os envios devidos (FOR UPDATE SKIP LOCKED), envia fora da transação e grava o
 * desfecho com a trilha. Falha temporária reagenda (1, 5, 15 e 60 min); falha permanente ou a 5ª falha marca
 * "falhou". Devolve quantos envios foram processados.
 */
export async function processarFila(ctx: ContextoNotificacoes, opcoes: OpcoesFila = {}): Promise<number> {
  const drivers = opcoes.drivers ?? criarDrivers(ctx.config);
  const limite = opcoes.limite ?? 1000;
  let processados = 0;
  while (processados < limite) {
    const lote = await reservarLote(ctx, opcoes, Math.min(TAMANHO_LOTE_FILA, limite - processados));
    if (lote.length === 0) break;
    const desfechos: Desfecho[] = [];
    for (const envio of lote) {
      try {
        const r = await drivers[envio.canal].enviar({
          envioId: envio.id,
          canal: envio.canal,
          papel: envio.papel,
          destinatario: envio.destinatario,
          endereco: envio.endereco,
          cpf: envio.cpf,
          assunto: envio.assunto,
          corpo: envio.corpo,
          agora: ctx.relogio(),
        });
        desfechos.push({ envio, ok: true, modo: r.modo, protocolo: r.protocolo });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        desfechos.push({ envio, ok: false, erro: sanitizarErro(mensagem), permanente: erro instanceof ErroEnvio && erro.permanente });
      }
    }
    await registrarDesfechos(ctx, desfechos);
    processados += lote.length;
  }
  return processados;
}

// ───────────────────────── Varredura diária (RN-31) ─────────────────────────

interface Candidato {
  tipo: TipoNotificacao;
  instrumento: InstrumentoNotificavel;
  chave: string;
  papeis: PapelDestinatario[];
  dataReferencia: string | null;
  detalhe: string | null;
  responsavelId: string | null;
}

async function coletarCandidatos(executor: Executor, hoje: string): Promise<Candidato[]> {
  const limite = adicionarDias(hoje, 120);
  const contratos = (
    await executor.consultar<LinhaInstrumento>(`${SELECAO_CONTRATOS} WHERE c.vigencia_fim >= $1 ORDER BY c.vigencia_fim, c.numero`, [hoje])
  ).map((l) => mapearInstrumento('contrato', l));
  const atas = (await executor.consultar<LinhaInstrumento>(`${SELECAO_ATAS} WHERE a.vigencia_fim >= $1 ORDER BY a.vigencia_fim, a.numero`, [hoje])).map(
    (l) => mapearInstrumento('ata', l),
  );
  const candidatos: Candidato[] = [];
  // RN-33 (frente K): o aviso de vencimento do contrato diz se cabe prorrogar, até quando, ou se é preciso nova licitação.
  const prorrogacoes = await alertasProrrogacao(executor, contratos.filter((c) => c.vigenciaFim <= limite).map((c) => c.id), hoje);

  for (const i of [...contratos, ...atas]) {
    const papeis: PapelDestinatario[] = i.tipo === 'contrato' ? ['gestor', 'fiscal'] : ['gestor'];
    if (i.vigenciaFim <= limite) {
      const aviso = avaliarAvisoVencimento(i.vigenciaFim, hoje);
      if (aviso) {
        candidatos.push({
          tipo: 'vencimento',
          instrumento: i,
          chave: `vencimento:${i.tipo}:${i.id}:${i.vigenciaFim}:${aviso.faixa}`,
          papeis,
          dataReferencia: null,
          detalhe: i.tipo === 'contrato' ? (prorrogacoes.get(i.id) ?? null) : null,
          responsavelId: null,
        });
      }
    }
    const reajuste = i.dataBaseReajuste ? avaliarAvisoReajuste(i.dataBaseReajuste, hoje) : null;
    if (reajuste && reajuste.aniversario <= i.vigenciaFim) {
      candidatos.push({
        tipo: 'reajuste',
        instrumento: i,
        chave: `reajuste:${i.tipo}:${i.id}:${reajuste.aniversario}`,
        papeis,
        dataReferencia: reajuste.aniversario,
        detalhe: null,
        responsavelId: null,
      });
    }
    const garantia = i.garantiaValidaAte ? avaliarAvisoGarantia(i.garantiaValidaAte, hoje) : null;
    if (garantia && i.garantiaValidaAte) {
      candidatos.push({
        tipo: 'garantia',
        instrumento: i,
        chave: `garantia:${i.tipo}:${i.id}:${i.garantiaValidaAte}`,
        papeis,
        dataReferencia: i.garantiaValidaAte,
        detalhe: null,
        responsavelId: null,
      });
    }
  }

  const porChave = new Map([...contratos, ...atas].map((i) => [`${i.tipo}:${i.id}`, i]));
  const pendencias = await executor.consultar<{
    id: string;
    instrumento_tipo: 'ata' | 'contrato';
    instrumento_id: string;
    motivo: string;
    prazo: string | null;
    responsavel_id: string;
  }>(
    `SELECT id, instrumento_tipo, instrumento_id, motivo, prazo, responsavel_id
       FROM pendencias
      WHERE situacao = 'aberta' AND prioridade = 'alta' AND responsavel_id IS NOT NULL
        AND NOT (tipo = ANY($1::text[]))
      ORDER BY prazo NULLS LAST, id`,
    [PENDENCIAS_COM_AVISO_PROPRIO],
  );
  for (const p of pendencias) {
    const instrumento = porChave.get(`${p.instrumento_tipo}:${p.instrumento_id}`);
    if (!instrumento) continue;
    candidatos.push({
      tipo: 'pendencia',
      instrumento,
      chave: `pendencia:${p.id}`,
      papeis: ['responsavel'],
      dataReferencia: p.prazo,
      detalhe: p.motivo,
      responsavelId: p.responsavel_id,
    });
  }
  return candidatos;
}

function resumoGeracao(tipo: TipoNotificacao, faixa: FaixaVencimento | null, identificador: string): string {
  const qual = tipo === 'vencimento' && faixa !== null ? `vencimento (faixa de ${faixa} dias)` : ROTULO_TIPO[tipo];
  return `Gerou aviso automático de ${qual} — ${identificador}`;
}

/**
 * Varredura diária idempotente: gera os avisos devidos hoje (vencimento por faixa, reajuste, garantia e
 * pendências de alta prioridade) e processa a fila. Sem `forcar`, pula o dia já varrido; com `forcar`
 * (execução manual) varre de novo, sem duplicar avisos. Devolve null se outra execução detinha o lock.
 */
export async function executarVarredura(
  ctx: ContextoNotificacoes,
  opcoes: { forcar?: boolean; drivers?: DriversCanais; processar?: boolean; usuarioId?: string | null; ipHash?: string | null } = {},
): Promise<ResultadoVarreduraNotificacoes | null> {
  const agora = ctx.relogio();
  const hoje = ctx.hoje();
  const gerado = await ctx.banco.transacao(async (tx) => {
    const [trava] = await tx.consultar<{ obtida: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS obtida', [CHAVE_LOCK_VARREDURA]);
    if (!trava?.obtida) return null;
    if (!opcoes.forcar) {
      const [feita] = await tx.consultar<{ data: string }>('SELECT data FROM notificacoes_varreduras WHERE data = $1', [hoje]);
      if (feita) return null;
    }
    const candidatos = await coletarCandidatos(tx, hoje);
    const eventos: (EntradaEvento & { ocorridoEm: Date })[] = [];
    let notificacoesCriadas = 0;
    let enviosCriados = 0;
    for (const c of candidatos) {
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM notificacoes WHERE chave_idempotencia = $1', [c.chave]);
      if (existente) continue;
      const mensagem = montarMensagemNotificacao({
        tipo: c.tipo,
        origem: 'automatica',
        hoje,
        instrumento: instrumentoDaMensagem(c.instrumento),
        dataReferencia: c.dataReferencia,
        detalhe: c.detalhe,
      });
      const destinatarios = await resolverDestinatarios(tx, c.instrumento, c.papeis, c.responsavelId);
      const gravada = await gravarNotificacao(
        tx,
        ctx.config,
        agora,
        { tipo: c.tipo, origem: 'automatica', instrumento: c.instrumento, mensagem, chave: c.chave, criadaPor: null },
        destinatarios,
        ['email', 'govbr'],
        true,
      );
      if (!gravada) continue;
      notificacoesCriadas++;
      enviosCriados += gravada.envios;
      eventos.push({
        ocorridoEm: agora,
        usuarioId: null,
        acao: 'notificacao.gerar',
        recurso: 'notificacao',
        recursoId: gravada.id,
        resumo: resumoGeracao(c.tipo, mensagem.faixa, identificadorInstrumento(c.instrumento.tipo, c.instrumento.numero)),
        dados: {
          instrumentoTipo: c.instrumento.tipo,
          instrumentoId: c.instrumento.id,
          tipo: c.tipo,
          faixa: mensagem.faixa,
          obrigatoria: mensagem.obrigatoria,
          envios: gravada.envios,
          suprimidos: gravada.suprimidos,
          ...(c.dataReferencia ? { dataReferencia: c.dataReferencia } : {}),
        },
      });
    }
    if (notificacoesCriadas > 0 || opcoes.forcar) {
      eventos.push({
        ocorridoEm: agora,
        usuarioId: opcoes.usuarioId ?? null,
        ipHash: opcoes.ipHash ?? null,
        acao: 'notificacao.varredura',
        recurso: 'sistema',
        recursoId: null,
        resumo: `${opcoes.forcar ? 'Executou a varredura' : 'Varredura diária'} de notificações de ${formatarData(hoje)}: ${notificacoesCriadas} aviso(s) gerado(s)`,
        dados: { data: hoje, notificacoesCriadas, enviosCriados, candidatos: candidatos.length, manual: opcoes.forcar === true },
      });
    }
    await registrarEventos(tx, eventos);
    await tx.executar(
      `INSERT INTO notificacoes_varreduras (data, executada_em, notificacoes_criadas, envios_criados)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (data) DO UPDATE
          SET executada_em = EXCLUDED.executada_em,
              notificacoes_criadas = notificacoes_varreduras.notificacoes_criadas + EXCLUDED.notificacoes_criadas,
              envios_criados = notificacoes_varreduras.envios_criados + EXCLUDED.envios_criados`,
      [hoje, agora.toISOString(), notificacoesCriadas, enviosCriados],
    );
    return { data: hoje, executadaEm: agora.toISOString(), notificacoesCriadas, enviosCriados };
  });
  if (gerado === null) return null;
  const enviosProcessados = opcoes.processar === false ? 0 : await processarFila(ctx, opcoes.drivers ? { drivers: opcoes.drivers } : {});
  return { ...gerado, enviosProcessados };
}
