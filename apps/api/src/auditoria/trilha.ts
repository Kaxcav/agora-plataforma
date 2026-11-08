import type { VerificacaoAuditoria } from '@agora/contratos';
import type { Executor, Transacao } from '../banco/tipos.ts';
import { sha256Hex } from '../compartilhado/cripto.ts';

/** `hash_anterior` do primeiro evento da cadeia. */
export const HASH_INICIAL = '0'.repeat(64);

/** Chave do advisory lock que serializa a inserção de eventos (ARQUITETURA §3.4). */
const CHAVE_LOCK_AUDITORIA = 14_133_169;

export type DadosEvento = Record<string, unknown>;

export interface EntradaEvento {
  usuarioId: string | null;
  /** Código da ação: 'pendencia.resolver', 'sessao.entrar', 'lgpd.revelar'... */
  acao: string;
  /** Recurso afetado: 'pendencia', 'contrato', 'sessao'... */
  recurso: string;
  recursoId: string | null;
  /** Texto pt-BR exibido na trilha e no histórico: "Resolveu pendência de saldo". */
  resumo: string;
  /** Antes/depois e contexto, sem dados pessoais em claro. */
  dados?: DadosEvento;
  ipHash?: string | null;
}

export interface EventoGravado {
  id: string;
  sequencia: number;
  hash: string;
}

/** JSON canônico: chaves ordenadas recursivamente, `undefined` omitido (igual ao armazenado em jsonb). */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || valor === undefined) return 'null';
  if (Array.isArray(valor)) {
    return `[${valor.map((item: unknown) => jsonCanonico(item)).join(',')}]`;
  }
  switch (typeof valor) {
    case 'string':
      return JSON.stringify(valor);
    case 'number':
      return Number.isFinite(valor) ? JSON.stringify(valor) : 'null';
    case 'boolean':
      return valor ? 'true' : 'false';
    case 'object': {
      const registro = valor as Record<string, unknown>;
      const chaves = Object.keys(registro)
        .filter((chave) => registro[chave] !== undefined)
        .sort();
      return `{${chaves.map((chave) => `${JSON.stringify(chave)}:${jsonCanonico(registro[chave])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Valor não serializável na trilha de auditoria: ${typeof valor}`);
  }
}

export interface CamposHash {
  hashAnterior: string;
  sequencia: number;
  ocorridoEm: string;
  usuarioId: string | null;
  acao: string;
  recurso: string;
  recursoId: string | null;
  dados: unknown;
}

/** hash = sha256(hash_anterior|sequencia|ocorrido_em ISO|usuario_id|acao|recurso|recurso_id|JSON canônico(dados)). */
export function calcularHashEvento(c: CamposHash): string {
  return sha256Hex(
    [
      c.hashAnterior,
      String(c.sequencia),
      c.ocorridoEm,
      c.usuarioId ?? '',
      c.acao,
      c.recurso,
      c.recursoId ?? '',
      jsonCanonico(c.dados ?? {}),
    ].join('|'),
  );
}

async function travarEObterUltimoHash(tx: Transacao): Promise<string> {
  await tx.consultar('SELECT pg_advisory_xact_lock($1)', [CHAVE_LOCK_AUDITORIA]);
  const ultimo = await tx.consultar<{ hash: string }>('SELECT hash FROM auditoria_eventos ORDER BY sequencia DESC LIMIT 1');
  return ultimo[0]?.hash ?? HASH_INICIAL;
}

async function reservarSequencias(tx: Transacao, quantidade: number): Promise<number[]> {
  const linhas = await tx.consultar<{ sequencia: number }>(
    "SELECT nextval(pg_get_serial_sequence('auditoria_eventos', 'sequencia')) AS sequencia FROM generate_series(1, $1::integer)",
    [quantidade],
  );
  return linhas.map((l) => l.sequencia).sort((a, b) => a - b);
}

const COLUNAS_INSERCAO =
  'sequencia, ocorrido_em, usuario_id, acao, recurso, recurso_id, resumo, dados, ip_hash, hash_anterior, hash';

/**
 * Grava eventos na trilha, na transação da própria escrita (atomicidade entre a mudança e o seu registro).
 * `eventos` com `ocorridoEm` explícito servem à carga de demonstração; em operação use `registrarEvento`.
 */
export async function registrarEventos(
  tx: Transacao,
  eventos: readonly (EntradaEvento & { ocorridoEm: Date })[],
): Promise<EventoGravado[]> {
  if (eventos.length === 0) return [];
  let hashAnterior = await travarEObterUltimoHash(tx);
  const sequencias = await reservarSequencias(tx, eventos.length);
  const gravados: EventoGravado[] = [];
  for (let indice = 0; indice < eventos.length; indice++) {
    const evento = eventos[indice];
    const sequencia = sequencias[indice];
    if (!evento || sequencia === undefined) throw new Error('Falha ao reservar sequência de auditoria');
    const ocorridoEm = evento.ocorridoEm.toISOString();
    const usuarioId = evento.usuarioId === null ? null : evento.usuarioId.toLowerCase();
    const dados = JSON.parse(jsonCanonico(evento.dados ?? {})) as unknown;
    const hash = calcularHashEvento({
      hashAnterior,
      sequencia,
      ocorridoEm,
      usuarioId,
      acao: evento.acao,
      recurso: evento.recurso,
      recursoId: evento.recursoId,
      dados,
    });
    const linhas = await tx.consultar<{ id: string }>(
      `INSERT INTO auditoria_eventos (${COLUNAS_INSERCAO})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
       RETURNING id`,
      [
        sequencia,
        ocorridoEm,
        usuarioId,
        evento.acao,
        evento.recurso,
        evento.recursoId,
        evento.resumo,
        JSON.stringify(dados),
        evento.ipHash ?? null,
        hashAnterior,
        hash,
      ],
    );
    const id = linhas[0]?.id;
    if (!id) throw new Error('Falha ao gravar evento de auditoria');
    gravados.push({ id, sequencia, hash });
    hashAnterior = hash;
  }
  return gravados;
}

/** Grava um evento com o instante atual do relógio da aplicação. */
export async function registrarEvento(tx: Transacao, evento: EntradaEvento, agora: Date): Promise<EventoGravado> {
  const [gravado] = await registrarEventos(tx, [{ ...evento, ocorridoEm: agora }]);
  if (!gravado) throw new Error('Falha ao gravar evento de auditoria');
  return gravado;
}

interface LinhaVerificacao {
  sequencia: number;
  ocorrido_em: string;
  usuario_id: string | null;
  acao: string;
  recurso: string;
  recurso_id: string | null;
  dados: unknown;
  hash_anterior: string;
  hash: string;
}

/** Recalcula a cadeia inteira, em lotes, e aponta a primeira falha (evento alterado, removido ou reordenado). */
export async function verificarCadeia(banco: Executor, agora: Date, tamanhoLote = 1000): Promise<VerificacaoAuditoria> {
  let hashEsperado = HASH_INICIAL;
  let ultimaSequencia = 0;
  let verificados = 0;
  for (;;) {
    const lote = await banco.consultar<LinhaVerificacao>(
      `SELECT sequencia, ocorrido_em, usuario_id, acao, recurso, recurso_id, dados, hash_anterior, hash
         FROM auditoria_eventos
        WHERE sequencia > $1
        ORDER BY sequencia
        LIMIT $2`,
      [ultimaSequencia, tamanhoLote],
    );
    for (const linha of lote) {
      if (linha.hash_anterior !== hashEsperado) {
        return falha(verificados, linha.sequencia, 'O hash anterior não corresponde ao evento precedente: evento removido, inserido fora de ordem ou cadeia adulterada.', agora);
      }
      const recalculado = calcularHashEvento({
        hashAnterior: linha.hash_anterior,
        sequencia: linha.sequencia,
        ocorridoEm: linha.ocorrido_em,
        usuarioId: linha.usuario_id,
        acao: linha.acao,
        recurso: linha.recurso,
        recursoId: linha.recurso_id,
        dados: linha.dados,
      });
      if (recalculado !== linha.hash) {
        return falha(verificados, linha.sequencia, 'O conteúdo do evento não confere com o hash registrado: evento alterado.', agora);
      }
      hashEsperado = linha.hash;
      ultimaSequencia = linha.sequencia;
      verificados++;
    }
    if (lote.length < tamanhoLote) break;
  }
  return { integra: true, eventosVerificados: verificados, primeiraFalha: null, verificadoEm: agora.toISOString() };
}

function falha(verificados: number, sequencia: number, motivo: string, agora: Date): VerificacaoAuditoria {
  return {
    integra: false,
    eventosVerificados: verificados,
    primeiraFalha: { sequencia, motivo },
    verificadoEm: agora.toISOString(),
  };
}
