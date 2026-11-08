import { adicionarDiasUteis, type MomentoVerificacaoRegularidade } from '@agora/dominio';
import type { VerificacaoRegularidade } from '@agora/contratos';
import type { FastifyRequest } from 'fastify';
import { registrarEvento } from '../../auditoria/trilha.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, normalizarBusca } from '../../compartilhado/texto.ts';
import { auditar } from '../../http/auditar.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { consultarCadastrosSancoes } from '../../integracoes/transparencia.ts';
import {
  fornecedorExibivel,
  montarChecklist,
  obterFornecedorRegularidade,
  ultimaConsulta,
  type FornecedorRegularidade,
  type LinhaConsulta,
} from './repositorio.ts';

/**
 * Serviço da regularidade do contratado: consulta ao CEIS/CNEP com cache e proveniência e a verificação
 * registrada (checklist + trilha de auditoria) usada nas travas de assinatura e prorrogação (RN-09) e nos
 * rechecagens do atesto e do pagamento (RN-23).
 */

export type MotivoConsulta = MomentoVerificacaoRegularidade | 'consulta';

export interface AutorConsulta {
  usuarioId: string | null;
  ipHash: string | null;
}

const ROTULO_MOMENTO: Record<MomentoVerificacaoRegularidade, string> = {
  assinatura: 'a assinatura do contrato',
  prorrogacao: 'a prorrogação da vigência',
  atesto: 'o atesto da nota fiscal',
  pagamento: 'o pagamento',
};

export function autorDe(request: FastifyRequest): AutorConsulta {
  return { usuarioId: request.sessao?.usuario.id ?? null, ipHash: request.ipHash || null };
}

/**
 * Última consulta ao CEIS/CNEP dentro do cache (`AGORA_TRANSPARENCIA_CACHE_MINUTOS`) ou uma consulta nova, gravada
 * com fonte, modo, instante, hash e quantidade e registrada na trilha. Falha da fonte não derruba a requisição:
 * volta a consulta anterior (o domínio decide se ainda vale) e o motivo da falha, também auditado.
 */
export async function garantirConsulta(
  ctx: ContextoApp,
  fornecedor: FornecedorRegularidade,
  autor: AutorConsulta,
  motivo: MotivoConsulta,
  opcoes: { forcar?: boolean } = {},
): Promise<{ consulta: LinhaConsulta | null; falha: string | null; nova: boolean }> {
  const anterior = await ultimaConsulta(ctx.banco, fornecedor.id);
  const cacheMs = ctx.config.transparencia.cacheMinutos * 60_000;
  if (!opcoes.forcar && anterior && ctx.relogio().getTime() - Date.parse(anterior.consultado_em) < cacheMs) {
    return { consulta: anterior, falha: null, nova: false };
  }
  const exibivel = fornecedorExibivel(fornecedor);
  try {
    const resultado = await consultarCadastrosSancoes({ config: ctx.config, fetch: ctx.fetch, banco: ctx.banco }, fornecedor.documento);
    const consulta = await ctx.banco.transacao(async (tx) => {
      const instante = ctx.relogio();
      const [linha] = await tx.consultar<LinhaConsulta>(
        `INSERT INTO consultas_ceis_cnep (fornecedor_id, modo, fonte, consultado_em, hash_conteudo, quantidade, registros, motivo, consultado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         RETURNING id, modo, fonte, consultado_em, hash_conteudo, quantidade, registros`,
        [
          fornecedor.id,
          resultado.modo,
          resultado.fonte,
          instante.toISOString(),
          resultado.hash,
          resultado.registros.length,
          JSON.stringify(resultado.registros),
          motivo,
          autor.usuarioId,
        ],
      );
      if (!linha) throw new Error('Consulta ao CEIS/CNEP não registrada');
      await registrarEvento(
        tx,
        {
          usuarioId: autor.usuarioId,
          acao: 'regularidade.consultar',
          recurso: 'fornecedor',
          recursoId: fornecedor.id,
          resumo: `Consultou o CEIS e o CNEP de ${exibivel.razaoSocial} (${resultado.modo === 'online' ? 'Portal da Transparência' : 'base simulada'}): ${resultado.registros.length} registro(s)`,
          dados: {
            fornecedorId: fornecedor.id,
            consultaId: linha.id,
            fonte: resultado.fonte,
            modo: resultado.modo,
            quantidade: resultado.registros.length,
            hashConteudo: resultado.hash,
            motivo,
            mensagem: resultado.mensagem,
          },
          ipHash: autor.ipHash,
        },
        instante,
      );
      return linha;
    });
    return { consulta, falha: null, nova: true };
  } catch (erro) {
    if (!(erro instanceof ErroIntegracao)) throw erro;
    const falha = erro.message;
    await ctx.banco.transacao((tx) =>
      registrarEvento(
        tx,
        {
          usuarioId: autor.usuarioId,
          acao: 'regularidade.consulta_falhou',
          recurso: 'fornecedor',
          recursoId: fornecedor.id,
          resumo: `Falha ao consultar o CEIS e o CNEP de ${exibivel.razaoSocial}`,
          dados: { fornecedorId: fornecedor.id, modo: ctx.config.integracoes, motivo, mensagem: falha, consultaAnteriorId: anterior?.id ?? null },
          ipHash: autor.ipHash,
        },
        ctx.relogio(),
      ),
    );
    return { consulta: anterior, falha, nova: false };
  }
}

export interface AlvoVerificacao {
  fornecedorId: string;
  momento: MomentoVerificacaoRegularidade;
  instrumento: VerificacaoRegularidade['instrumento'];
  /** Contrato relacionado (para o histórico do contrato), quando o instrumento é um pagamento ou o próprio contrato. */
  contratoId?: string | null;
  /** Nova consulta mesmo dentro do cache (pedido explícito do agente). */
  forcarConsulta?: boolean;
}

/**
 * Executa o checklist de regularidade numa trava (consulta obrigatória) e o registra com a trilha de auditoria,
 * inclusive quando o resultado bloqueia o ato — a tentativa fica documentada com fonte e data.
 */
export async function verificarRegularidade(ctx: ContextoApp, request: FastifyRequest, alvo: AlvoVerificacao): Promise<VerificacaoRegularidade> {
  const fornecedor = await obterFornecedorRegularidade(ctx.banco, alvo.fornecedorId);
  if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
  const { consulta, falha } = await garantirConsulta(ctx, fornecedor, autorDe(request), alvo.momento, { forcar: alvo.forcarConsulta ?? false });
  return ctx.banco.transacao(async (tx) => {
    const agora = ctx.relogio();
    const { checklist, consultaId } = await montarChecklist(tx, fornecedor, alvo.momento, ctx.hoje(), agora, {
      consultaObrigatoria: true,
      consulta,
      falhaConsulta: falha,
    });
    const usuario = request.sessao?.usuario ?? null;
    const [linha] = await tx.consultar<{ id: string }>(
      `INSERT INTO verificacoes_regularidade (fornecedor_id, momento, instrumento_tipo, instrumento_id, regular, bloqueia, consulta_id,
                                             falha_consulta, resultado, verificado_por, verificado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) RETURNING id`,
      [
        fornecedor.id,
        alvo.momento,
        alvo.instrumento.tipo,
        alvo.instrumento.id,
        checklist.regular,
        checklist.bloqueia,
        consultaId,
        falha,
        JSON.stringify(checklist),
        usuario?.id ?? null,
        agora.toISOString(),
      ],
    );
    if (!linha) throw new Error('Verificação de regularidade não registrada');
    const contratoId = alvo.contratoId ?? (alvo.instrumento.tipo === 'contrato' ? alvo.instrumento.id : null);
    await auditar(tx, request, {
      acao: 'regularidade.verificar',
      recurso: alvo.instrumento.tipo,
      recursoId: alvo.instrumento.id,
      resumo: checklist.regular
        ? `Verificou a regularidade de ${checklist.fornecedor.razaoSocial} antes de ${ROTULO_MOMENTO[alvo.momento]}: regular`
        : `Verificou a regularidade de ${checklist.fornecedor.razaoSocial} antes de ${ROTULO_MOMENTO[alvo.momento]}: ${checklist.motivos.length} restrição(ões)${checklist.bloqueia ? ' — ato bloqueado' : ''}`,
      dados: {
        verificacaoId: linha.id,
        fornecedorId: fornecedor.id,
        momento: alvo.momento,
        regular: checklist.regular,
        bloqueia: checklist.bloqueia,
        motivos: checklist.motivos,
        consultaId,
        fonteConsulta: checklist.consulta?.fonte ?? null,
        consultadoEm: checklist.consulta?.consultadoEm ?? null,
        hashConsulta: checklist.consulta?.hashConteudo ?? null,
        falhaConsulta: falha,
        ...(contratoId ? { instrumentoTipo: 'contrato', instrumentoId: contratoId } : {}),
      },
    });
    return {
      ...checklist,
      id: linha.id,
      instrumento: alvo.instrumento,
      verificadoPor: usuario ? usuarioResumo(usuario.id, usuario.nome) : null,
    };
  });
}

/** Dias úteis para a providência de notificar o contratado sobre a irregularidade apontada no recheque. */
const DIAS_UTEIS_PENDENCIA_REGULARIDADE = 5;

/**
 * Recheque irregular no atesto ou antes do pagamento (RN-23): abre pendência de alta prioridade para o gestor
 * notificar o contratado (art. 92, XVI). Não duplica pendência aberta pelo mesmo motivo no contrato.
 * Devolve o id da pendência criada, ou null se já havia uma aberta. Chamar dentro da transação da escrita.
 */
export async function abrirPendenciaRegularidade(
  tx: Transacao,
  ctx: ContextoApp,
  e: { contratoId: string; notaFiscal: string; momento: 'atesto' | 'pagamento'; verificacao: VerificacaoRegularidade },
): Promise<string | null> {
  const [contrato] = await tx.consultar<{ uasg: string; numero: string; objeto: string; gestor_id: string | null }>(
    'SELECT uasg, numero, objeto, gestor_id FROM contratos WHERE id = $1',
    [e.contratoId],
  );
  if (!contrato) return null;
  const [aberta] = await tx.consultar<{ id: string }>(
    `SELECT id FROM pendencias
      WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND tipo = 'pagamento' AND situacao = 'aberta'
        AND motivo LIKE 'Regularidade do contratado:%'
      LIMIT 1`,
    [e.contratoId],
  );
  if (aberta) return null;
  const prazo = adicionarDiasUteis(ctx.hoje(), DIAS_UTEIS_PENDENCIA_REGULARIDADE, await opcoesCalendario(tx));
  const momento = e.momento === 'atesto' ? 'no atesto' : 'antes do pagamento';
  const motivo = `Regularidade do contratado: ${e.verificacao.motivos.length} restrição(ões) ${momento} da nota fiscal ${e.notaFiscal}. Notifique o contratado para regularizar (art. 92, XVI) — ${e.verificacao.motivos.join(' ')}`.slice(0, 1000);
  const [criada] = await tx.consultar<{ id: string }>(
    `INSERT INTO pendencias (tipo, prioridade, instrumento_tipo, instrumento_id, uasg, motivo, prazo, responsavel_id, busca_normalizada)
     VALUES ('pagamento', 'alta', 'contrato', $1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      e.contratoId,
      contrato.uasg,
      motivo,
      prazo,
      contrato.gestor_id,
      normalizarBusca(motivo, contrato.objeto, identificadorInstrumento('contrato', contrato.numero), e.verificacao.fornecedor.razaoSocial, contrato.uasg),
    ],
  );
  return criada?.id ?? null;
}

/** Trava da assinatura e da prorrogação (RN-09): 422 com cada motivo, depois de registrada a verificação. */
export function exigirRegularidade(verificacao: VerificacaoRegularidade, mensagem: string): void {
  if (!verificacao.bloqueia) return;
  throw regraNegocio(
    mensagem,
    verificacao.motivos.map((m) => ({ campo: 'RN-09', mensagem: m })),
  );
}
