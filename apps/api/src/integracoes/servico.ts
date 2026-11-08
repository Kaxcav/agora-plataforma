import type { FonteDados, Proveniencia, Sincronizacao } from '@agora/contratos';
import type { Executor } from '../banco/tipos.ts';
import { registrarEvento } from '../auditoria/trilha.ts';
import type { ContextoApp } from '../http/contexto.ts';
import { conflito } from '../http/erros.ts';
import { CONJUNTOS, type Conector, type FonteExecutavel } from './conector.ts';
import { criarConectorOffline } from './offline.ts';
import { criarConectorPncp, type OpcoesPncp } from './pncp.ts';

/** Fábrica de conectores: online só para o PNCP e só com `AGORA_INTEGRACOES=online`. */
export function conectorPara(fonte: FonteExecutavel, modo: 'offline' | 'online', opcoesPncp?: OpcoesPncp): Conector {
  if (modo === 'online' && fonte === 'PNCP') return criarConectorPncp(opcoesPncp);
  return criarConectorOffline(fonte);
}

interface LinhaSincronizacao {
  fonte: FonteExecutavel;
  conjunto: string;
  modo: 'offline' | 'online';
  ultima_execucao_em: string | null;
  ultimo_sucesso_em: string | null;
  situacao: Sincronizacao['situacao'];
  registros_processados: number;
  mensagem: string | null;
  hash_conteudo: string | null;
}

const COLUNAS = `fonte, conjunto, modo, ultima_execucao_em, ultimo_sucesso_em, situacao, registros_processados, mensagem, hash_conteudo`;

function mapear(linha: LinhaSincronizacao): Sincronizacao {
  return {
    fonte: linha.fonte,
    conjunto: linha.conjunto,
    modo: linha.modo,
    ultimaExecucaoEm: linha.ultima_execucao_em,
    ultimoSucessoEm: linha.ultimo_sucesso_em,
    situacao: linha.situacao,
    registrosProcessados: linha.registros_processados,
    mensagem: linha.mensagem,
    hashConteudo: linha.hash_conteudo,
  };
}

export async function listarSincronizacoes(executor: Executor, modo: 'offline' | 'online'): Promise<Sincronizacao[]> {
  const linhas = await executor.consultar<LinhaSincronizacao>(`SELECT ${COLUNAS} FROM sincronizacoes`);
  return CONJUNTOS.map((c) => {
    const linha = linhas.find((l) => l.fonte === c.fonte && l.conjunto === c.conjunto);
    if (linha) return mapear(linha);
    return {
      fonte: c.fonte,
      conjunto: c.conjunto,
      modo: conectorPara(c.fonte, modo).modo,
      ultimaExecucaoEm: null,
      ultimoSucessoEm: null,
      situacao: 'nunca_executado',
      registrosProcessados: 0,
      mensagem: null,
      hashConteudo: null,
    };
  });
}

/** Execução concorrente da mesma fonte é recusada enquanto a anterior estiver em andamento (até 10 min). */
const JANELA_EXECUCAO_MS = 10 * 60 * 1000;

/**
 * Executa a sincronização de uma fonte, registra a proveniência (horário, hash, quantidade) e a trilha de auditoria.
 * Falhas da fonte externa não derrubam a requisição: a sincronização volta com situação 'falhou' e a mensagem.
 */
export async function executarSincronizacao(
  ctx: ContextoApp,
  fonte: FonteExecutavel,
  autor: { usuarioId: string | null; ipHash: string | null },
  opcoes: { modo?: 'offline' | 'online'; pncp?: OpcoesPncp } = {},
): Promise<Sincronizacao> {
  const conector = conectorPara(fonte, opcoes.modo ?? ctx.config.integracoes, opcoes.pncp);
  const inicio = ctx.relogio();

  await ctx.banco.transacao(async (tx) => {
    const atuais = await tx.consultar<{ situacao: string; ultima_execucao_em: string | null }>(
      'SELECT situacao, ultima_execucao_em FROM sincronizacoes WHERE fonte = $1 AND conjunto = $2 FOR UPDATE',
      [conector.fonte, conector.conjunto],
    );
    const atual = atuais[0];
    if (
      atual?.situacao === 'executando' &&
      atual.ultima_execucao_em !== null &&
      inicio.getTime() - Date.parse(atual.ultima_execucao_em) < JANELA_EXECUCAO_MS
    ) {
      throw conflito('Já existe uma sincronização desta fonte em andamento.');
    }
    await tx.executar(
      `INSERT INTO sincronizacoes (fonte, conjunto, modo, ultima_execucao_em, situacao)
       VALUES ($1, $2, $3, $4, 'executando')
       ON CONFLICT (fonte, conjunto) DO UPDATE SET modo = EXCLUDED.modo, ultima_execucao_em = EXCLUDED.ultima_execucao_em, situacao = 'executando'`,
      [conector.fonte, conector.conjunto, conector.modo, inicio.toISOString()],
    );
  });

  let resultado: { registros: number; hash: string; mensagem: string } | null = null;
  let falha: string | null = null;
  try {
    resultado = await conector.executar({
      banco: ctx.banco,
      config: ctx.config,
      hoje: ctx.hoje(),
      agora: inicio,
      fetch: ctx.fetch,
    });
  } catch (erro) {
    falha = erro instanceof Error ? erro.message : 'Falha desconhecida na sincronização.';
  }

  const fim = ctx.relogio();
  return ctx.banco.transacao(async (tx) => {
    if (resultado) {
      await tx.executar(
        `UPDATE sincronizacoes
            SET situacao = 'ok', ultimo_sucesso_em = $3, registros_processados = $4, mensagem = $5, hash_conteudo = $6
          WHERE fonte = $1 AND conjunto = $2`,
        [conector.fonte, conector.conjunto, fim.toISOString(), resultado.registros, resultado.mensagem, resultado.hash],
      );
    } else {
      await tx.executar(
        `UPDATE sincronizacoes SET situacao = 'falhou', mensagem = $3 WHERE fonte = $1 AND conjunto = $2`,
        [conector.fonte, conector.conjunto, falha],
      );
    }
    await registrarEvento(
      tx,
      {
        usuarioId: autor.usuarioId,
        acao: resultado ? 'sincronizacao.executar' : 'sincronizacao.falhar',
        recurso: 'sincronizacao',
        recursoId: conector.fonte,
        resumo: resultado
          ? `Sincronizou ${conector.conjunto} (${conector.fonte}, ${conector.modo}): ${resultado.registros} registros`
          : `Falha ao sincronizar ${conector.conjunto} (${conector.fonte})`,
        dados: {
          fonte: conector.fonte,
          conjunto: conector.conjunto,
          modo: conector.modo,
          registros: resultado?.registros ?? 0,
          hashConteudo: resultado?.hash ?? null,
          mensagem: resultado?.mensagem ?? falha,
        },
        ipHash: autor.ipHash,
      },
      fim,
    );
    const linhas = await tx.consultar<LinhaSincronizacao>(
      `SELECT ${COLUNAS} FROM sincronizacoes WHERE fonte = $1 AND conjunto = $2`,
      [conector.fonte, conector.conjunto],
    );
    const linha = linhas[0];
    if (!linha) throw new Error('Sincronização não registrada');
    return mapear(linha);
  });
}

/** Proveniência por fonte, para exibir junto de cada tabela. Mais de 24 h sem sucesso = desatualizado. */
const VALIDADE_MS = 24 * 60 * 60 * 1000;

export async function carregarProveniencias(executor: Executor, agora: Date): Promise<Proveniencia[]> {
  const linhas = await executor.consultar<Pick<LinhaSincronizacao, 'fonte' | 'situacao' | 'ultimo_sucesso_em'>>(
    'SELECT fonte, situacao, ultimo_sucesso_em FROM sincronizacoes',
  );
  return CONJUNTOS.map((c) => {
    const linha = linhas.find((l) => l.fonte === c.fonte);
    if (!linha || linha.situacao === 'nunca_executado' || (linha.ultimo_sucesso_em === null && linha.situacao !== 'falhou')) {
      return { fonte: c.fonte, atualizadoEm: linha?.ultimo_sucesso_em ?? null, situacao: 'nunca_sincronizado' };
    }
    if (linha.situacao === 'falhou') return { fonte: c.fonte, atualizadoEm: linha.ultimo_sucesso_em, situacao: 'falhou' };
    const recente = linha.ultimo_sucesso_em !== null && agora.getTime() - Date.parse(linha.ultimo_sucesso_em) <= VALIDADE_MS;
    return { fonte: c.fonte, atualizadoEm: linha.ultimo_sucesso_em, situacao: recente ? 'atualizado' : 'desatualizado' };
  });
}

export function provenienciaDe(lista: readonly Proveniencia[], fonte: FonteDados, agora: Date): Proveniencia {
  if (fonte === 'AGORA') return { fonte: 'AGORA', atualizadoEm: agora.toISOString(), situacao: 'atualizado' };
  return lista.find((p) => p.fonte === fonte) ?? { fonte, atualizadoEm: null, situacao: 'nunca_sincronizado' };
}
