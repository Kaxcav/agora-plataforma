/**
 * Tarefas da fila de integrações (RNF-07, frente B) das rotas de contratação:
 *   * `pncp.contratacao_direta`: divulga no PNCP o aviso de contratação direta da dispensa por valor (art. 75, § 3º)
 *     ou o ato que autoriza a contratação direta (art. 72, parágrafo único). Publicado o aviso, começa a contar o
 *     prazo de 3 dias úteis para as propostas adicionais;
 *   * `pncp.extrato_cartao`: divulga o extrato mensal do cartão de pagamento (art. 75, § 4º).
 * Modo offline (padrão): simulação determinística, com protocolo derivado do hash do conteúdo. Modo online: a inclusão
 * real depende dos códigos de amparo legal das tabelas de domínio do PNCP (consultadas no portal) e, para o extrato do
 * cartão, de serviço que o PNCP ainda não oferece; a tarefa vai para a fila de erro com o motivo, para reprocessar.
 */
import { formatarData, hojeISO, situacaoAvisoDispensa, TIPOS_DOCUMENTO_PNCP } from '@agora/dominio';
import { z } from 'zod';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { cnpjDoOrgao } from '../jornada/servico.ts';

const cargaContratacao = z.object({ processoId: z.uuid(), ato: z.enum(['aviso', 'autorizacao']) });
const cargaExtrato = z.object({ extratoId: z.uuid() });

function lerCarga<T>(esquema: z.ZodType<T>, tarefa: LinhaTarefa): T {
  const r = esquema.safeParse(tarefa.carga);
  if (!r.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  return r.data;
}

function protocoloSimulado(tarefa: LinhaTarefa, hash: string): string {
  return `SIMULADO-${sha256Hex(`${tarefa.chave_idempotencia}|${hash}`).slice(0, 20).toUpperCase()}`;
}

/** Título e tipo de documento PNCP do ato divulgado. */
export const ATOS_CONTRATACAO_DIRETA = {
  aviso: { titulo: 'Aviso de contratação direta', tipoDocumentoPncp: TIPOS_DOCUMENTO_PNCP.avisoContratacaoDireta },
  autorizacao: { titulo: 'Ato que autoriza a contratação direta', tipoDocumentoPncp: TIPOS_DOCUMENTO_PNCP.outrosDocumentos },
} as const;

export async function executarPublicacaoContratacaoDireta(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const { processoId, ato } = lerCarga(cargaContratacao, tarefa);
  const linha = await obterLinhaProcesso(ctx.banco, processoId, null);
  if (!linha) throw new FalhaTarefa('Processo não encontrado.', false);
  if (ctx.config.integracoes === 'online') {
    throw new FalhaTarefa(
      'Publicação real da contratação direta no PNCP pendente: confira os códigos de amparo legal do art. 72, 74 e 75 nas tabelas de domínio do PNCP (pncp.gov.br/app/entidades-dominio) antes de habilitar o envio; reprocesse depois da configuração.',
      false,
    );
  }
  const agora = ctx.relogio();
  const hoje = hojeISO(agora);
  const cnpj = await cnpjDoOrgao(ctx.banco, ctx.config.orgao.cnpj);
  const numeroControle = `${cnpj}-1-${linha.numero_sei.slice(6, 12)}/${hoje.slice(0, 4)}`;
  const conteudo = JSON.stringify({ processo: linha.numero_sei, ato, objeto: linha.titulo, uasg: linha.uasg, itens: linha.dfd.itens.length });
  const hash = sha256Hex(conteudo);
  const protocolo = protocoloSimulado(tarefa, hash);
  const calendario = await opcoesCalendario(ctx.banco);
  const encerramento = ato === 'aviso' ? situacaoAvisoDispensa({ publicadoEm: hoje, hoje, opcoes: calendario }).encerramento : null;
  return {
    resultado: { protocolo, numeroControle, hashArquivo: hash, modo: 'offline', ato },
    async aplicar(tx) {
      await tx.executar(
        `UPDATE pncp_envios SET protocolo = $2, numero_controle = $3, hash_arquivo = $4, sequencial_documento = 1, modo = 'offline', enviado_em = $5
          WHERE tarefa_id = $1`,
        [tarefa.id, protocolo, numeroControle, hash, agora.toISOString()],
      );
      if (ato === 'aviso') {
        await tx.executar(
          `UPDATE dispensas_avisos SET situacao = 'publicado', publicado_em = $2, encerramento = $3, protocolo = $4, numero_controle = $5,
                  hash_arquivo = $6, modo = 'offline'
            WHERE processo_id = $1`,
          [processoId, hoje, encerramento, protocolo, numeroControle, hash],
        );
      }
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: ato === 'aviso' ? 'pncp.aviso_dispensa' : 'pncp.ato_contratacao_direta',
          recurso: 'processo',
          recursoId: processoId,
          resumo:
            ato === 'aviso'
              ? `Publicou no PNCP (simulação) o aviso de contratação direta sob o nº ${numeroControle}; propostas adicionais até ${formatarData(encerramento ?? hoje)}`
              : `Divulgou no PNCP (simulação) o ato que autoriza a contratação direta sob o nº ${numeroControle}`,
          dados: { numeroSei: linha.numero_sei, numeroControle, protocolo, hashArquivo: hash, modo: 'offline', encerramento },
        },
        agora,
      );
    },
  };
}

export async function executarPublicacaoExtratoCartao(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const { extratoId } = lerCarga(cargaExtrato, tarefa);
  const [extrato] = await ctx.banco.consultar<{ id: string; uasg: string; competencia: string; hash: string; total: number; quantidade: number }>(
    'SELECT id, uasg, competencia, hash, total, quantidade FROM cartao_pagamento_extratos WHERE id = $1',
    [extratoId],
  );
  if (!extrato) throw new FalhaTarefa('Extrato não encontrado.', false);
  if (ctx.config.integracoes === 'online') {
    throw new FalhaTarefa(
      'O PNCP ainda não oferece serviço de inclusão do extrato do cartão de pagamento (art. 75, § 4º): o extrato fica registrado na Ágora e a tarefa pode ser reprocessada quando o serviço existir.',
      false,
    );
  }
  const agora = ctx.relogio();
  const protocolo = protocoloSimulado(tarefa, extrato.hash);
  return {
    resultado: { protocolo, hash: extrato.hash, modo: 'offline' },
    async aplicar(tx) {
      await tx.executar(`UPDATE cartao_pagamento_extratos SET situacao = 'publicado', protocolo = $2, modo = 'offline', publicado_em = $3 WHERE id = $1`, [
        extrato.id,
        protocolo,
        agora.toISOString(),
      ]);
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.extrato_cartao',
          recurso: 'cartao_pagamento',
          recursoId: extrato.id,
          resumo: `Divulgou no PNCP (simulação) o extrato do cartão de pagamento da UASG ${extrato.uasg}, competência ${extrato.competencia}`,
          dados: { uasg: extrato.uasg, competencia: extrato.competencia, protocolo, hash: extrato.hash, total: extrato.total, quantidade: extrato.quantidade, modo: 'offline' },
        },
        agora,
      );
    },
  };
}
