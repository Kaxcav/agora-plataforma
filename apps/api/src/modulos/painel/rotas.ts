import { projetarQueimaSaldo, situacaoDivulgacaoPncp } from '@agora/dominio';
import type { InstrumentoVencimento, Painel } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento } from '../../compartilhado/texto.ts';
import { codigoUasg } from '../../http/validacao.ts';
import { carregarProveniencias } from '../../integracoes/servico.ts';
import { listarAtas } from '../atas/repositorio.ts';
import { listarContratos } from '../contratos/repositorio.ts';

const LIMITE_PROXIMOS_VENCIMENTOS = 8;

export async function rotasPainel(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;

  app.get('/painel', { preHandler: exigir('painel:ler') }, async (request): Promise<Painel> => {
    const consulta = z.object({ uasg: codigoUasg.optional() }).parse(request.query);
    const sessao = sessaoDe(request);
    const escopo = escopoUasgs(sessao);
    const hoje = ctx.hoje();
    const agora = ctx.relogio();

    const [contratos, atas] = [
      await listarContratos(ctx.banco, { escopo, uasg: consulta.uasg }, hoje),
      await listarAtas(ctx.banco, { escopo, uasg: consulta.uasg }, hoje),
    ];
    const contratosVigentes = contratos.filter((c) => c.situacao !== 'encerrado');
    const atasVigentes = atas.filter((a) => a.situacao !== 'encerrado');

    const [pendencias] = await ctx.banco.consultar<{ abertas: number; alta: number }>(
      `SELECT COUNT(*)::integer AS abertas, (COUNT(*) FILTER (WHERE prioridade = 'alta'))::integer AS alta
         FROM pendencias
        WHERE situacao = 'aberta'
          AND ($1::text[] IS NULL OR uasg = ANY($1::text[]))
          AND ($2::text IS NULL OR uasg = $2)`,
      [escopo, consulta.uasg ?? null],
    );

    const calendario = await opcoesCalendario(ctx.banco);
    const semDivulgacao = await ctx.banco.consultar<{ assinatura_em: string; origem: 'licitacao' | 'contratacao_direta' }>(
      `SELECT assinatura_em, origem FROM contratos
        WHERE divulgacao_pncp_em IS NULL
          AND ($1::text[] IS NULL OR uasg = ANY($1::text[]))
          AND ($2::text IS NULL OR uasg = $2)`,
      [escopo, consulta.uasg ?? null],
    );
    const divulgacaoPendente = semDivulgacao.filter(
      (c) => situacaoDivulgacaoPncp(c.assinatura_em, c.origem, null, hoje, calendario).situacao === 'pendente_vencido',
    ).length;

    const queimaAcelerada = contratosVigentes.filter(
      (c) =>
        c.valorGlobal > 0 &&
        c.vigenciaInicio <= hoje &&
        projetarQueimaSaldo({ valorTotal: c.valorGlobal, valorExecutado: c.valorPago, inicio: c.vigenciaInicio, fim: c.vigenciaFim, hoje })
          .sinal === 'acelerado',
    ).length;

    const instrumentos: InstrumentoVencimento[] = [
      ...atas.map(
        (a): InstrumentoVencimento => ({
          tipo: 'ata',
          id: a.id,
          identificador: identificadorInstrumento('ata', a.numero),
          objeto: a.objeto,
          uasg: a.uasgGerenciadora.codigo,
          vigenciaFim: a.vigenciaFim,
          diasRestantes: a.diasRestantes,
          semaforo: a.semaforo,
        }),
      ),
      ...contratos.map(
        (c): InstrumentoVencimento => ({
          tipo: 'contrato',
          id: c.id,
          identificador: identificadorInstrumento('contrato', c.numero),
          objeto: c.objeto,
          uasg: c.uasg.codigo,
          vigenciaFim: c.vigenciaFim,
          diasRestantes: c.diasRestantes,
          semaforo: c.semaforo,
        }),
      ),
    ];
    const contar = (semaforo: InstrumentoVencimento['semaforo']) => instrumentos.filter((i) => i.semaforo === semaforo).length;

    return {
      indicadores: {
        atasVigentes: atasVigentes.length,
        contratosVigentes: contratosVigentes.length,
        valorGlobalContratos: contratosVigentes.reduce((s, c) => s + c.valorGlobal, 0),
        valorEmpenhado: contratosVigentes.reduce((s, c) => s + c.valorEmpenhado, 0),
        valorPago: contratosVigentes.reduce((s, c) => s + c.valorPago, 0),
        saldoAEmpenhar: contratosVigentes.reduce((s, c) => s + Math.max(0, c.valorGlobal - c.valorEmpenhado), 0),
        pendenciasAbertas: pendencias?.abertas ?? 0,
        pendenciasAltaPrioridade: pendencias?.alta ?? 0,
      },
      vencimentos: { em30: contar('critico'), em60: contar('atencao'), em90: contar('alerta'), vencidos: contar('vencido'), em120: contar('planejamento') },
      divulgacaoPncpPendente: divulgacaoPendente,
      queimaAcelerada,
      proximosVencimentos: instrumentos
        .filter((i) => i.diasRestantes >= 0)
        .sort((a, b) => a.diasRestantes - b.diasRestantes || a.identificador.localeCompare(b.identificador, 'pt-BR'))
        .slice(0, LIMITE_PROXIMOS_VENCIMENTOS),
      proveniencia: await carregarProveniencias(ctx.banco, agora),
    };
  });
}
