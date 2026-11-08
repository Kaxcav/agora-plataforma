/**
 * Auditor contínuo da 2ª linha de defesa (RIA-15; "Auditor IA contínuo" da conversa do cliente): varre os contratos
 * do escopo (notas fiscais, medições e aditivos) e os documentos dos processos da jornada e devolve sinais
 * determinísticos com fundamento e evidências. Nada é gravado: o painel é recalculado a cada consulta.
 */
import { AVISO_AUDITOR_CONTINUO, sinaisAuditorContinuo, type AditivoAuditavel, type ItemAuditavel, type PagamentoAuditavel } from '@agora/dominio';
import type { PainelAuditorIa, SinalAuditorIa } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { conferirCitacoes } from '../../ia/base-normativa.ts';
import { referenciaContrato, referenciaProcesso } from '../controle/medidas.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import type { CestaArmazenada, DfdProcesso } from '../jornada/tipos.ts';
import { conferenciaCruzada, documentosDoProcesso } from './servico.ts';

export interface ContextoAuditor {
  executor: Executor;
  escopo: string[] | null;
  uasg: string | null;
  hoje: string;
  agora: Date;
}

/** Evidências por sinal exibidas no painel. */
const MAXIMO_EVIDENCIAS = 6;

interface LinhaContrato {
  id: string;
  numero: string;
  valor_inicial: number;
  valor_global: number;
  data_base_reajuste: string;
}

function agrupar<T extends { contrato_id: string }>(linhas: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const l of linhas) mapa.set(l.contrato_id, [...(mapa.get(l.contrato_id) ?? []), l]);
  return mapa;
}

function data(valor: string | Date | null): string | null {
  if (valor === null) return null;
  return (valor instanceof Date ? valor.toISOString() : String(valor)).slice(0, 10);
}

async function sinaisDosContratos(ctx: ContextoAuditor): Promise<{ sinais: SinalAuditorIa[]; contratos: number }> {
  const contratos = await ctx.executor.consultar<LinhaContrato>(
    `SELECT c.id, c.numero, c.valor_inicial, v.valor_global, c.data_base_reajuste::text AS data_base_reajuste
       FROM contratos c
       JOIN vw_contratos_valores v ON v.contrato_id = c.id
      WHERE ($1::text[] IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR c.uasg = $2)
      ORDER BY c.numero`,
    [ctx.escopo, ctx.uasg],
  );
  if (contratos.length === 0) return { sinais: [], contratos: 0 };
  const ids = contratos.map((c) => c.id);
  const pagamentos = agrupar(
    await ctx.executor.consultar<{ contrato_id: string; nota_fiscal: string; competencia: string; valor: number; situacao: PagamentoAuditavel['situacao']; atestado_em: string | null; pago_em: string | null }>(
      `SELECT contrato_id, nota_fiscal, competencia, valor, situacao, atestado_em, pago_em::text AS pago_em
         FROM pagamentos WHERE contrato_id = ANY($1::uuid[]) ORDER BY competencia, nota_fiscal`,
      [ids],
    ),
  );
  const aditivos = agrupar(
    await ctx.executor.consultar<{ contrato_id: string; numero: string; tipo: AditivoAuditavel['tipo']; valor: number; assinado_em: string }>(
      'SELECT contrato_id, numero, tipo, valor, assinado_em::text AS assinado_em FROM aditivos WHERE contrato_id = ANY($1::uuid[]) ORDER BY assinado_em',
      [ids],
    ),
  );
  const itens = agrupar(
    await ctx.executor.consultar<{ contrato_id: string; numero: number; descricao: string; quantidade: number; quantidade_recebida: number }>(
      'SELECT contrato_id, numero, descricao, quantidade, quantidade_recebida FROM itens_contrato WHERE contrato_id = ANY($1::uuid[]) ORDER BY numero',
      [ids],
    ),
  );
  const processos = new Map(
    (
      await ctx.executor.consultar<{ contrato_id: string; dfd: DfdProcesso; cesta: CestaArmazenada }>(
        'SELECT contrato_id, dfd, cesta FROM processos WHERE contrato_id = ANY($1::uuid[])',
        [ids],
      )
    ).map((p) => [p.contrato_id, p]),
  );
  const sinais: SinalAuditorIa[] = [];
  for (const c of contratos) {
    const processo = processos.get(c.id);
    const estimado = processo ? valorEstimadoProcesso(processo.dfd, analisarCesta(processo.cesta, ctx.hoje)) : null;
    const encontrados = sinaisAuditorContinuo({
      valorInicial: Number(c.valor_inicial),
      valorGlobal: Number(c.valor_global),
      dataBaseReajuste: data(c.data_base_reajuste) ?? ctx.hoje,
      pagamentos: (pagamentos.get(c.id) ?? []).map((p) => ({
        notaFiscal: p.nota_fiscal,
        competencia: p.competencia,
        valor: Number(p.valor),
        situacao: p.situacao,
        atestadoEm: data(p.atestado_em),
        pagoEm: data(p.pago_em),
      })),
      aditivos: (aditivos.get(c.id) ?? []).map((a) => ({ numero: a.numero, tipo: a.tipo, valor: Number(a.valor), assinadoEm: data(a.assinado_em) ?? ctx.hoje })),
      itens: (itens.get(c.id) ?? []).map((i): ItemAuditavel => ({ numero: i.numero, descricao: i.descricao, quantidade: i.quantidade, quantidadeRecebida: i.quantidade_recebida })),
      valorEstimadoProcesso: estimado,
    });
    for (const s of encontrados) sinais.push({ ...s, evidencias: s.evidencias.slice(0, MAXIMO_EVIDENCIAS), referencia: referenciaContrato(c.id, c.numero) });
  }
  return { sinais, contratos: contratos.length };
}

/** Processos: divergência entre os documentos mais recentes e documento aprovado com citação apontada. */
async function sinaisDosProcessos(ctx: ContextoAuditor): Promise<{ sinais: SinalAuditorIa[]; processos: number }> {
  const processos = await ctx.executor.consultar<{ id: string; numero_sei: string }>(
    `SELECT p.id, p.numero_sei FROM processos p
      WHERE ($1::text[] IS NULL OR p.uasg = ANY($1::text[])) AND ($2::text IS NULL OR p.uasg = $2)
        AND EXISTS (SELECT 1 FROM documentos_gerados d WHERE d.processo_id = p.id)
      ORDER BY p.numero_sei`,
    [ctx.escopo, ctx.uasg],
  );
  const sinais: SinalAuditorIa[] = [];
  for (const p of processos) {
    const documentos = await documentosDoProcesso(ctx.executor, p.id);
    const referencia = referenciaProcesso(p.id, p.numero_sei);
    const cruzada = conferenciaCruzada(p.id, documentos, ctx.agora);
    if (cruzada.divergencias.length > 0) {
      sinais.push({
        tipo: 'divergencia_documentos',
        nivel: 'atencao',
        titulo: 'Documentos do processo com dados divergentes',
        descricao: `A conferência cruzada encontrou ${cruzada.divergencias.length === 1 ? '1 divergência' : `${cruzada.divergencias.length} divergências`} entre os documentos mais recentes (objeto, quantidades, valor, prazos, dotação, modalidade ou critério).`,
        fundamento: 'Lei 14.133/2021, art. 6º, XXIII, art. 18 e art. 25',
        evidencias: cruzada.divergencias.slice(0, MAXIMO_EVIDENCIAS).map((d) => `${d.titulo.split(':')[0]} — ${d.descricao}`),
        referencia,
      });
    }
    for (const d of documentos.filter((x) => x.situacao === 'aprovado')) {
      const conferencia = conferirCitacoes(d.conteudo);
      if (conferencia.problemas === 0) continue;
      const apontadas = conferencia.citacoes.filter((c) => c.situacao !== 'confere' && c.situacao !== 'outra_norma');
      sinais.push({
        tipo: 'citacao_documento_aprovado',
        nivel: conferencia.bloqueantes > 0 ? 'risco' : 'atencao',
        titulo: 'Documento aprovado com citação legal apontada',
        descricao: `"${d.titulo}" (versão ${d.versao}) foi aprovado com ${apontadas.length === 1 ? '1 citação apontada' : `${apontadas.length} citações apontadas`} pela conferência com a base normativa${d.revisao_por_nome ? `; revisão das citações registrada por ${d.revisao_por_nome}` : ''}.`,
        fundamento: 'Lei 14.133/2021, art. 53 e art. 169; IMR-02 (precisão normativa)',
        evidencias: apontadas.slice(0, MAXIMO_EVIDENCIAS).map((c) => `${c.trecho} — ${c.motivo}`),
        referencia,
      });
    }
  }
  return { sinais, processos: processos.length };
}

export async function montarPainelAuditorIa(ctx: ContextoAuditor): Promise<PainelAuditorIa> {
  const deContratos = await sinaisDosContratos(ctx);
  const deProcessos = await sinaisDosProcessos(ctx);
  const sinais = [...deContratos.sinais, ...deProcessos.sinais].sort(
    (a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'risco' ? -1 : 1) || a.referencia.identificador.localeCompare(b.referencia.identificador, 'pt-BR', { numeric: true }),
  );
  return {
    geradoEm: ctx.agora.toISOString(),
    uasg: ctx.uasg,
    indicadores: {
      contratosVarridos: deContratos.contratos,
      processosVarridos: deProcessos.processos,
      sinaisRisco: sinais.filter((s) => s.nivel === 'risco').length,
      sinaisAtencao: sinais.filter((s) => s.nivel === 'atencao').length,
    },
    sinais,
    premissas: [
      'Notas fiscais atestadas, liquidadas ou pagas; notas previstas não entram na soma nem na mediana.',
      'Nota atípica: valor acima de 2,5 vezes a mediana das notas do contrato, com ao menos 4 notas.',
      'Reajuste: interregno mínimo de 1 ano da data-base do contrato ou do reajuste anterior.',
      'Documentos: versão mais recente de cada tipo para a conferência cruzada; documentos aprovados para as citações.',
    ],
    fontes: [
      'Contratos, itens, notas fiscais, pagamentos e aditivos registrados na Ágora',
      'Documentos gerados nos processos da jornada da contratação',
      'Base normativa da Ágora (Lei 14.133/2021)',
    ],
    aviso: AVISO_AUDITOR_CONTINUO,
  };
}
