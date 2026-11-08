/**
 * Tarefas do SEI executadas pelo trabalhador da fila (RF-35, RNF-07):
 *   * `sei.envio`: gera o processo no SEI (se ainda não existe), inclui como PDF cada documento aprovado da árvore
 *     ainda não enviado, monta o bloco de assinatura com os documentos incluídos e, se configurada a unidade de
 *     destino, envia o processo a ela. Cada passo grava a prova logo depois da resposta do SEI, para que a nova
 *     tentativa continue de onde parou;
 *   * `sei.assinaturas`: consulta cada documento no SEI e reflete as assinaturas na árvore do processo.
 * Modo online (AGORA_INTEGRACOES=online): SeiWS do órgão. Modo offline (padrão): SEI simulado determinístico.
 */
import { dataHoraSei, nivelAcessoSei, situacaoAssinaturaSei } from '@agora/dominio';
import { z } from 'zod';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { criarClienteSei, type AssinaturaConsultadaSei, type ClienteSei } from '../../integracoes/sei.ts';
import { carregarEquipe, obterLinhaProcesso } from '../jornada/repositorio.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';
import {
  gravarBlocoSei,
  gravarDocumentoSei,
  gravarProcessoSei,
  gravarTramitacaoSei,
  listarEntradasSei,
  obterProcessoSei,
  type EntradaSei,
} from './repositorio.ts';
import { criarSeiSimulado } from './simulacao.ts';

const cargaSei = z.object({ processoId: z.uuid() });

function processoIdDa(tarefa: LinhaTarefa): string {
  const r = cargaSei.safeParse(tarefa.carga);
  if (!r.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  return r.data.processoId;
}

async function processoDa(ctx: ContextoApp, processoId: string): Promise<LinhaProcesso> {
  const linha = await obterLinhaProcesso(ctx.banco, processoId, null);
  if (!linha) throw new FalhaTarefa('Processo não encontrado.', false);
  return linha;
}

/** Cliente do SEI conforme o modo: SeiWS do órgão (online) ou simulação determinística (offline). */
async function clienteSei(ctx: ContextoApp, linha: LinhaProcesso, entradas: readonly EntradaSei[]): Promise<ClienteSei> {
  const sei = ctx.config.sei;
  if (ctx.config.integracoes === 'online') {
    if (!sei.configurado || !sei.url || !sei.siglaSistema || !sei.identificacaoServico || !sei.idUnidade) {
      throw new FalhaTarefa('Web service do SEI não configurado: defina AGORA_SEI_URL, AGORA_SEI_SIGLA_SISTEMA, AGORA_SEI_IDENTIFICACAO_SERVICO e os ids do SEI.', false);
    }
    return criarClienteSei({
      url: sei.url,
      siglaSistema: sei.siglaSistema,
      identificacaoServico: sei.identificacaoServico,
      idUnidade: sei.idUnidade,
      fetch: ctx.fetch,
      timeoutMs: sei.timeoutMs,
    });
  }
  const equipe = await carregarEquipe(ctx.banco, linha.id);
  return criarSeiSimulado({
    numeroProcesso: linha.numero_sei,
    processoId: linha.id,
    entradas,
    equipe: equipe.map((m) => ({ papel: m.papel, nome: m.nome })),
    agora: ctx.relogio,
  });
}

// ───────────────────────── sei.envio ─────────────────────────

export async function executarEnvioSei(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const linha = await processoDa(ctx, processoIdDa(tarefa));
  const sei = ctx.config.sei;
  const modo = ctx.config.integracoes;
  const entradas = await listarEntradasSei(ctx.banco, linha.id, true);
  const cliente = await clienteSei(ctx, linha, entradas);

  let processoSei = await obterProcessoSei(ctx.banco, linha.id);
  const processoGerado = processoSei === null;
  if (!processoSei) {
    const nivel = nivelAcessoSei({ contemDadoPessoal: false, orcamentoSigiloso: linha.cesta.orcamentoSigiloso });
    const gerado = await cliente.gerarProcedimento(
      {
        idTipoProcedimento: sei.idTipoProcedimento ?? '',
        especificacao: linha.titulo,
        observacao: `Processo ${linha.numero_sei} da Ágora (UASG ${linha.uasg}).`,
        nivelAcesso: nivel.nivel,
        idHipoteseLegal: sei.idHipoteseLegal,
      },
      [],
    );
    processoSei = await gravarProcessoSei(
      ctx.banco,
      { processoId: linha.id, idProcedimento: gerado.idProcedimento, protocolo: gerado.procedimentoFormatado, link: gerado.linkAcesso, modo, tarefaId: tarefa.id },
      ctx.relogio(),
    );
  }

  const incluidos: { numero: string; numeroSei: string; restrito: boolean }[] = [];
  for (const entrada of entradas) {
    if (entrada.documento_id === null || entrada.documento_formatado !== null || entrada.conteudo === null) continue;
    const titulo = `${entrada.titulo} — processo ${linha.numero_sei}`;
    const pdf = gerarPdfTexto({ titulo, rodape: titulo, conteudo: entrada.conteudo });
    const nivel = nivelAcessoSei({
      contemDadoPessoal: tarjarDadosPessoais(entrada.conteudo) !== entrada.conteudo,
      orcamentoSigiloso: linha.cesta.orcamentoSigiloso && entrada.tipo !== 'edital',
    });
    const agora = ctx.relogio();
    const incluido = await cliente.incluirDocumento({
      protocoloProcedimento: processoSei.protocolo,
      idSerie: sei.idSerie ?? '',
      numero: entrada.numero,
      nomeArvore: entrada.titulo,
      data: dataHoraSei(agora).slice(0, 10),
      remetente: { sigla: ctx.config.orgao.sigla, nome: `${ctx.config.orgao.nome} — Ágora` },
      nomeArquivo: `${(entrada.tipo ?? 'documento').replace(/_/g, '-')}-${entrada.numero}.pdf`,
      conteudo: pdf,
      nivelAcesso: nivel.nivel,
      idHipoteseLegal: sei.idHipoteseLegal,
      observacao: `Documento aprovado na Ágora (versão ${entrada.versao ?? 1}); SHA-256 ${sha256Hex(pdf)}.`,
    });
    await gravarDocumentoSei(
      ctx.banco,
      {
        arvoreId: entrada.arvore_id,
        processoId: linha.id,
        idDocumento: incluido.idDocumento,
        documentoFormatado: incluido.documentoFormatado,
        link: incluido.linkAcesso,
        modo,
        hashArquivo: sha256Hex(pdf),
        nivelAcesso: nivel.nivel,
        tarefaId: tarefa.id,
      },
      agora,
    );
    incluidos.push({ numero: entrada.numero, numeroSei: incluido.documentoFormatado, restrito: nivel.nivel === 1 });
  }

  // Bloco de assinatura com os documentos incluídos por esta tarefa (também os de uma tentativa anterior que caiu).
  let bloco: string | null = null;
  if (sei.blocoAssinatura) {
    const semBloco = (await listarEntradasSei(ctx.banco, linha.id, false)).filter((e) => e.tarefa_id === tarefa.id && e.bloco_assinatura === null);
    if (semBloco.length > 0) {
      bloco = await cliente.gerarBloco({
        descricao: `Ágora — assinatura dos documentos do processo ${processoSei.protocolo}`,
        documentos: semBloco.map((e) => e.documento_formatado ?? ''),
        unidadesDisponibilizacao: sei.idUnidadeDestino ? [sei.idUnidadeDestino] : [],
      });
      await gravarBlocoSei(
        ctx.banco,
        semBloco.map((e) => e.arvore_id),
        bloco,
      );
    }
  }

  let tramitado = false;
  if (sei.idUnidadeDestino && processoSei.enviado_unidade_em === null) {
    await cliente.enviarProcesso(processoSei.protocolo, [sei.idUnidadeDestino]);
    await gravarTramitacaoSei(ctx.banco, linha.id, sei.idUnidadeDestino, ctx.relogio());
    tramitado = true;
  }

  const protocolo = processoSei.protocolo;
  return {
    resultado: { modo, processoSei: protocolo, processoGerado, documentos: incluidos.map((d) => d.numeroSei), bloco, tramitado },
    async aplicar(tx) {
      const agora = ctx.relogio();
      await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [linha.id, agora.toISOString()]);
      const partes = [
        processoGerado ? `gerou o processo ${protocolo} no SEI` : `usou o processo ${protocolo} do SEI`,
        incluidos.length === 0 ? 'nenhum documento novo' : `incluiu ${incluidos.length} documento(s)`,
        ...(bloco ? [`montou o bloco de assinatura ${bloco}`] : []),
        ...(tramitado ? [`enviou o processo à unidade ${sei.idUnidadeDestino ?? ''}`] : []),
      ];
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'sei.enviar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Integração com o SEI${modo === 'online' ? '' : ' (simulação)'}: ${partes.join('; ')}`,
          dados: {
            numeroSei: linha.numero_sei,
            processoSei: protocolo,
            modo,
            tarefaId: tarefa.id,
            tentativa: tarefa.tentativas,
            documentos: incluidos,
            bloco,
            unidadeDestino: tramitado ? sei.idUnidadeDestino : null,
          },
          ipHash: null,
        },
        agora,
      );
    },
  };
}

// ───────────────────────── sei.assinaturas ─────────────────────────

export async function executarConsultaAssinaturasSei(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const linha = await processoDa(ctx, processoIdDa(tarefa));
  const entradas = (await listarEntradasSei(ctx.banco, linha.id, false)).filter((e) => e.documento_formatado !== null);
  if (entradas.length === 0) throw new FalhaTarefa('Nenhum documento deste processo foi enviado ao SEI.', false);
  const cliente = await clienteSei(ctx, linha, entradas);
  const consultas: { entrada: EntradaSei; assinaturas: AssinaturaConsultadaSei[] }[] = [];
  for (const entrada of entradas) {
    const r = await cliente.consultarDocumento(entrada.documento_formatado ?? '');
    consultas.push({ entrada, assinaturas: r.assinaturas });
  }
  const assinados = consultas.filter((c) => c.assinaturas.length > 0).length;
  const modo = ctx.config.integracoes;
  return {
    resultado: { modo, consultados: consultas.length, assinados },
    async aplicar(tx) {
      const agora = ctx.relogio();
      const refletidos: { numero: string; numeroSei: string; signatarios: string[] }[] = [];
      for (const { entrada, assinaturas } of consultas) {
        const lista = assinaturas.map((a) => ({ nome: a.nome, cargoFuncao: a.cargoFuncao, assinadoEm: a.assinadoEm }));
        await tx.executar('UPDATE sei_documentos SET assinaturas = $2::jsonb, consultado_em = $3 WHERE arvore_id = $1', [
          entrada.arvore_id,
          JSON.stringify(lista),
          agora.toISOString(),
        ]);
        const situacao = situacaoAssinaturaSei(lista);
        if (!situacao.assinado || entrada.assinado_em !== null || situacao.primeiraEm === null) continue;
        await tx.executar(
          'UPDATE processos_arvore_sei SET assinado_em = $2, assinado_por_nome = $3 WHERE id = $1 AND assinado_em IS NULL',
          [entrada.arvore_id, situacao.primeiraEm, situacao.resumo.slice(0, 400)],
        );
        refletidos.push({ numero: entrada.numero, numeroSei: entrada.documento_formatado ?? '', signatarios: situacao.signatarios });
      }
      if (refletidos.length > 0) await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [linha.id, agora.toISOString()]);
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'sei.assinaturas.consultar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Consultou no SEI${modo === 'online' ? '' : ' (simulação)'} as assinaturas de ${consultas.length} documento(s): ${assinados} assinado(s)${refletidos.length > 0 ? `, ${refletidos.length} refletido(s) agora na árvore` : ''}`,
          dados: { numeroSei: linha.numero_sei, modo, tarefaId: tarefa.id, consultados: consultas.length, assinados, refletidos },
          ipHash: null,
        },
        agora,
      );
    },
  };
}
