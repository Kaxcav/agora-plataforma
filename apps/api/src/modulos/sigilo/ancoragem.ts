/**
 * Carimbo de tempo da trilha de auditoria (RNF-09). Periodicamente, o servidor ancora o hash da cadeia no último
 * evento: envia o SHA-256 da declaração (`declaracaoAncoragem`) a uma autoridade de carimbo do tempo RFC 3161
 * configurada pelo órgão e guarda o token; sem a autoridade (modo offline), registra a ancoragem local com prova HMAC
 * do servidor. A verificação recalcula a cadeia e confere cada ancoragem (`conferirAncoragem`).
 * A ancoragem é feita por uma réplica de cada vez (advisory lock) e grava o evento `auditoria.ancorar` na trilha.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { ancoragemDevida, conferirAncoragem, declaracaoAncoragem } from '@agora/dominio';
import type { AncoragemTrilha, ConferenciaAncoragemTrilha, SituacaoAncoragens, VerificacaoAncoragens } from '@agora/contratos';
import { registrarEvento, verificarCadeia } from '../../auditoria/trilha.ts';
import type { Executor } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { ErroDer } from '../../compartilhado/der.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { enderecoPublicoAutoridade, lerTokenCarimbo, solicitarCarimbo } from '../../integracoes/carimbo-tempo.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';

/** Chave do advisory lock que impede duas réplicas de ancorarem ao mesmo tempo. */
const CHAVE_LOCK_ANCORAGEM = 14_133_327;
const LIMITE_LISTAGEM = 50;

interface LinhaAncoragem {
  id: string;
  sequencia: number;
  hash: string;
  impressao: string;
  modo: 'rfc3161' | 'local';
  origem: 'periodica' | 'manual';
  ancorada_em: string;
  autoridade: string | null;
  token: string | null;
  hash_token: string | null;
  carimbo_em: string | null;
  numero_serie: string | null;
  politica: string | null;
  prova_local: string | null;
  solicitada_por: string | null;
  solicitada_por_nome: string | null;
}

function chaveProvaLocal(segredo: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from('agora-ancoragem', 'utf8'), Buffer.from('agora:trilha:ancoragem-local:v1', 'utf8'), 32));
}

function provaLocal(segredo: string, impressao: string, ancoradaEm: string): string {
  return createHmac('sha256', chaveProvaLocal(segredo)).update(`${impressao}|${ancoradaEm}`).digest('hex');
}

export function modoAncoragem(ctx: ContextoApp): 'rfc3161' | 'local' {
  return ctx.config.sigilo.carimboTempo.url === null ? 'local' : 'rfc3161';
}

function mapear(l: LinhaAncoragem): AncoragemTrilha {
  return {
    id: l.id,
    sequencia: l.sequencia,
    hash: l.hash,
    impressao: l.impressao,
    modo: l.modo,
    origem: l.origem,
    ancoradaEm: l.ancorada_em,
    autoridade: l.autoridade,
    carimboEm: l.carimbo_em,
    numeroSerie: l.numero_serie,
    politica: l.politica,
    hashToken: l.hash_token,
    solicitadaPor: l.solicitada_por ? { id: l.solicitada_por, nome: l.solicitada_por_nome ?? '' } : null,
  };
}

async function listar(executor: Executor, limite = LIMITE_LISTAGEM): Promise<LinhaAncoragem[]> {
  return executor.consultar<LinhaAncoragem>(
    `SELECT a.id, a.sequencia, a.hash, a.impressao, a.modo, a.origem, a.ancorada_em, a.autoridade, a.token, a.hash_token, a.carimbo_em,
            a.numero_serie, a.politica, a.prova_local, a.solicitada_por, u.nome AS solicitada_por_nome
       FROM auditoria_ancoragens a LEFT JOIN usuarios u ON u.id = a.solicitada_por
      ORDER BY a.ancorada_em DESC, a.sequencia DESC
      LIMIT $1`,
    [limite],
  );
}

async function cabecaDaTrilha(executor: Executor): Promise<{ sequencia: number; hash: string } | null> {
  const [linha] = await executor.consultar<{ sequencia: number; hash: string }>('SELECT sequencia, hash FROM auditoria_eventos ORDER BY sequencia DESC LIMIT 1');
  return linha ?? null;
}

async function proximaDevida(ctx: ContextoApp, executor: Executor): Promise<{ devida: boolean; motivo: string }> {
  const [ultima] = await listar(executor, 1);
  const cabeca = await cabecaDaTrilha(executor);
  return ancoragemDevida({
    ultimaAncoradaEm: ultima?.ancorada_em ?? null,
    ultimaSequencia: ultima?.sequencia ?? null,
    sequenciaAtual: cabeca?.sequencia ?? 0,
    agora: ctx.relogio().toISOString(),
    intervaloHoras: ctx.config.sigilo.carimboTempo.intervaloHoras,
  });
}

export async function situacaoAncoragens(ctx: ContextoApp): Promise<SituacaoAncoragens> {
  const url = ctx.config.sigilo.carimboTempo.url;
  return {
    modo: modoAncoragem(ctx),
    autoridade: url === null ? null : enderecoPublicoAutoridade(url),
    intervaloHoras: ctx.config.sigilo.carimboTempo.intervaloHoras,
    proxima: await proximaDevida(ctx, ctx.banco),
    itens: (await listar(ctx.banco)).map(mapear),
  };
}

export interface PedidoAncoragem {
  origem: 'periodica' | 'manual';
  usuarioId: string | null;
  ipHash: string | null;
}

/**
 * Ancora a trilha até o último evento. Periódica: só se devida (`ancoragemDevida`) e se nenhuma outra réplica estiver
 * ancorando; devolve null quando não ancorou. Manual: ancora sempre. Falha da autoridade de carimbo vai para a trilha
 * (`auditoria.ancorar_falhou`) e é relançada como `ErroIntegracao`.
 */
export async function ancorarTrilha(ctx: ContextoApp, pedido: PedidoAncoragem): Promise<AncoragemTrilha | null> {
  const modo = modoAncoragem(ctx);
  const opcoes = ctx.config.sigilo.carimboTempo;
  if (pedido.origem === 'periodica' && !(await proximaDevida(ctx, ctx.banco)).devida) return null;
  const cabeca = await cabecaDaTrilha(ctx.banco);
  if (!cabeca) return null;
  const declaracao = declaracaoAncoragem(cabeca.sequencia, cabeca.hash);
  const impressao = sha256Hex(declaracao);
  // A chamada à autoridade fica fora da transação (não prende o banco durante a rede).
  let token: Buffer | null = null;
  let carimbo: { carimboEm: string; numeroSerie: string; politica: string } | null = null;
  if (modo === 'rfc3161' && opcoes.url !== null) {
    try {
      const obtido = await solicitarCarimbo(
        ctx.fetch,
        { url: opcoes.url, usuario: opcoes.usuario, senha: opcoes.senha, timeoutMs: opcoes.timeoutMs, politica: opcoes.politica },
        impressao,
      );
      token = obtido.token;
      carimbo = { carimboEm: obtido.lido.carimboEm.toISOString(), numeroSerie: obtido.lido.numeroSerie, politica: obtido.lido.politica };
    } catch (erro) {
      if (!(erro instanceof ErroIntegracao)) throw erro;
      await registrarFalha(ctx, pedido, erro.message);
      throw erro;
    }
  }
  const gravada = await ctx.banco.transacao(async (tx) => {
    const [trava] = await tx.consultar<{ obtida: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS obtida', [CHAVE_LOCK_ANCORAGEM]);
    if (!trava?.obtida) {
      if (pedido.origem === 'periodica') return null;
      throw new ErroIntegracao('Outra ancoragem da trilha está em andamento. Tente de novo em instantes.');
    }
    // Outra réplica pode ter ancorado enquanto esta falava com a autoridade.
    if (pedido.origem === 'periodica' && !(await proximaDevida(ctx, tx)).devida) return null;
    const ancoradaEm = ctx.relogio().toISOString();
    const [linha] = await tx.consultar<{ id: string }>(
      `INSERT INTO auditoria_ancoragens (sequencia, hash, impressao, modo, origem, ancorada_em, autoridade, token, hash_token, carimbo_em,
                                         numero_serie, politica, prova_local, solicitada_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        cabeca.sequencia,
        cabeca.hash,
        impressao,
        modo,
        pedido.origem,
        ancoradaEm,
        opcoes.url === null ? null : enderecoPublicoAutoridade(opcoes.url),
        token ? token.toString('base64') : null,
        token ? sha256Hex(token) : null,
        carimbo?.carimboEm ?? null,
        carimbo?.numeroSerie ?? null,
        carimbo?.politica ?? null,
        modo === 'local' ? provaLocal(ctx.segredo, impressao, ancoradaEm) : null,
        pedido.usuarioId,
      ],
    );
    if (!linha) throw new Error('Falha ao gravar a ancoragem da trilha.');
    await registrarEvento(
      tx,
      {
        usuarioId: pedido.usuarioId,
        acao: 'auditoria.ancorar',
        recurso: 'auditoria',
        recursoId: linha.id,
        resumo:
          modo === 'rfc3161'
            ? `Ancorou a trilha até o evento ${cabeca.sequencia} em carimbo do tempo (RFC 3161)`
            : `Registrou a ancoragem local da trilha até o evento ${cabeca.sequencia} (modo offline)`,
        dados: {
          sequencia: cabeca.sequencia,
          hash: cabeca.hash,
          impressao,
          modo,
          origem: pedido.origem,
          ...(carimbo ? { carimboEm: carimbo.carimboEm, numeroSerie: carimbo.numeroSerie, politica: carimbo.politica, hashToken: token ? sha256Hex(token) : null } : {}),
        },
        ipHash: pedido.ipHash,
      },
      ctx.relogio(),
    );
    return linha.id;
  });
  if (gravada === null) return null;
  const [linha] = (await listar(ctx.banco, LIMITE_LISTAGEM)).filter((l) => l.id === gravada);
  return linha ? mapear(linha) : null;
}

async function registrarFalha(ctx: ContextoApp, pedido: PedidoAncoragem, motivo: string): Promise<void> {
  const url = ctx.config.sigilo.carimboTempo.url;
  await ctx.banco.transacao(async (tx) => {
    await registrarEvento(
      tx,
      {
        usuarioId: pedido.usuarioId,
        acao: 'auditoria.ancorar_falhou',
        recurso: 'auditoria',
        recursoId: null,
        resumo: 'A ancoragem da trilha em carimbo do tempo falhou',
        dados: { origem: pedido.origem, motivo, autoridade: url === null ? null : enderecoPublicoAutoridade(url) },
        ipHash: pedido.ipHash,
      },
      ctx.relogio(),
    );
  });
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Recalcula a cadeia e confere as ancoragens mais recentes. Não grava nada. */
export async function verificarAncoragens(ctx: ContextoApp): Promise<VerificacaoAncoragens> {
  const agora = ctx.relogio();
  const cadeia = await verificarCadeia(ctx.banco, agora);
  const falhaEm = cadeia.primeiraFalha?.sequencia ?? null;
  const confiavel = ctx.config.sigilo.carimboTempo.certificadoSha256;
  const conferencias: ConferenciaAncoragemTrilha[] = [];
  for (const a of await listar(ctx.banco)) {
    const [evento] = await ctx.banco.consultar<{ hash: string }>('SELECT hash FROM auditoria_eventos WHERE sequencia = $1', [a.sequencia]);
    const impressaoEsperada = sha256Hex(declaracaoAncoragem(a.sequencia, a.hash));
    let carimbo: { impressao: string; assinaturaValida: boolean; certificadoConfiavel: boolean | null; carimboEm: string } | null = null;
    if (a.modo === 'rfc3161' && a.token !== null) {
      try {
        const lido = lerTokenCarimbo(Buffer.from(a.token, 'base64'));
        carimbo = {
          impressao: lido.impressao,
          assinaturaValida: lido.assinaturaValida,
          certificadoConfiavel: confiavel === null ? null : lido.certificadoSha256 === confiavel,
          carimboEm: lido.carimboEm.toISOString(),
        };
      } catch (erro) {
        if (!(erro instanceof ErroDer)) throw erro;
      }
    }
    const resultado = conferirAncoragem({
      modo: a.modo,
      hashRegistrado: a.hash,
      hashCadeia: evento?.hash ?? null,
      cadeiaIntegra: falhaEm === null || falhaEm > a.sequencia,
      impressaoEsperada,
      carimbo,
      provaLocalValida: a.modo === 'local' && a.prova_local !== null ? iguais(a.prova_local, provaLocal(ctx.segredo, a.impressao, a.ancorada_em)) && a.impressao === impressaoEsperada : null,
      ancoradaEm: a.ancorada_em,
    });
    if (a.impressao !== impressaoEsperada && a.modo === 'rfc3161') resultado.problemas.push('A impressão registrada não corresponde à declaração ancorada.');
    conferencias.push({
      ancoragemId: a.id,
      sequencia: a.sequencia,
      modo: a.modo,
      situacao: resultado.problemas.length === 0 ? 'integra' : 'divergente',
      problemas: resultado.problemas,
      avisos: resultado.avisos,
    });
  }
  return {
    verificadoEm: agora.toISOString(),
    cadeiaIntegra: cadeia.integra,
    integras: conferencias.filter((c) => c.situacao === 'integra').length,
    divergentes: conferencias.filter((c) => c.situacao === 'divergente').length,
    ancoragens: conferencias,
  };
}

export interface AgendamentoAncoragem {
  parar(): void;
}

/**
 * Ancoragem periódica no processo da API: primeira conferência 15 minutos após a partida e depois de hora em hora; a
 * ancoragem só acontece quando devida (intervalo `AGORA_CARIMBO_TEMPO_INTERVALO_HORAS`). Temporizadores sem prender o
 * processo e parados no encerramento.
 */
export function agendarAncoragem(ctx: ContextoApp, aoFalhar: (erro: unknown) => void, atrasoInicialMs = 15 * 60 * 1000): AgendamentoAncoragem {
  let parado = false;
  let intervalo: NodeJS.Timeout | null = null;
  const executar = () => {
    if (parado) return;
    ancorarTrilha(ctx, { origem: 'periodica', usuarioId: null, ipHash: null }).catch(aoFalhar);
  };
  const inicial = setTimeout(() => {
    executar();
    intervalo = setInterval(executar, 60 * 60 * 1000);
    intervalo.unref();
  }, atrasoInicialMs);
  inicial.unref();
  return {
    parar() {
      parado = true;
      clearTimeout(inicial);
      if (intervalo) clearInterval(intervalo);
    },
  };
}
