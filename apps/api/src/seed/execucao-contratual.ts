/**
 * Carga sintética da execução contratual (frente L): prazos de execução de cada contrato, designação do gestor e do
 * fiscal técnico já cadastrados, garantias registradas a partir das colunas do contrato, data da liquidação das notas
 * liquidadas e pagas, algumas entregas aguardando o recebimento provisório e ocorrências no livro. PRNG próprio, para
 * não alterar a sequência dos dados das etapas anteriores. Valores, números de portaria e textos são inventados. A conta
 * de demonstração do fiscal técnico (fiscal.tecnico@agora.demo) é criada pela carga do IMR (frente M).
 */
import { adicionarDias, adicionarDiasUteis, hojeISO, type ModalidadeGarantia } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { instanteEm, type ContextoSeed, type EventoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/** Semente própria desta etapa (Lei 14.133, art. 140). */
const SEMENTE_EXECUCAO_CONTRATUAL = 14_133_140;

const MODALIDADE_POR_ROTULO: Record<string, ModalidadeGarantia> = {
  'Seguro-garantia': 'seguro_garantia',
  'Fiança bancária': 'fianca_bancaria',
  'Caução em dinheiro': 'caucao_dinheiro',
};

const ENTREGAS = [
  'Entrega da parcela mensal dos serviços, com relatório de atividades do período.',
  'Entrega parcial dos itens do contrato no almoxarifado central, com notas de remessa.',
  'Entrega dos equipamentos com manuais e termo de garantia do fabricante.',
] as const;

const OCORRENCIAS = [
  'Atraso de dois dias na entrega da parcela prevista no cronograma, comunicado pela contratada por escrito.',
  'Equipe da contratada sem identificação funcional no posto de serviço durante a vistoria da fiscalização.',
] as const;

function menor(a: string, b: string): string {
  return a < b ? a : b;
}

export async function gerarExecucaoContratual(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados, calendario } = ctx;
  const prng = new Prng(SEMENTE_EXECUCAO_CONTRATUAL);
  const eventos: EventoSeed[] = [];
  const carga = { carga: 'demonstracao' };
  const instante = agora.toISOString();

  // ───────── prazos de execução e designações de cada contrato ─────────
  const parametros: (string | number)[][] = [];
  const designacoes: (string | boolean | null)[][] = [];
  for (const c of dados.contratos) {
    parametros.push([
      c.id,
      prng.inteiro(3, 5),
      prng.inteiro(8, 15),
      prng.inteiro(5, 10),
      prng.inteiro(5, 10),
      prng.escolher([15, 20, 30]),
      prng.chance(0.8) ? 'recebimento_definitivo' : 'liquidacao',
      'IPCA',
      prng.escolher([0, 0.5, 1]),
      c.servico ? prng.escolher([0, 6, 12]) : prng.escolher([12, 24]),
      instante,
    ]);
    const ano = c.assinatura.slice(0, 4);
    const ato = `Portaria nº ${prng.inteiro(100, 999)}/${ano}`;
    designacoes.push([prng.uuid(), c.id, 'gestor', c.gestorId, false, ato, c.assinatura, instante]);
    if (c.fiscalId !== c.gestorId) designacoes.push([prng.uuid(), c.id, 'fiscal_tecnico', c.fiscalId, false, ato, c.assinatura, instante]);
  }
  await inserirEmLote(
    tx,
    'contratos_parametros_execucao',
    ['contrato_id', 'prazo_provisorio_dias_uteis', 'prazo_definitivo_dias_uteis', 'prazo_correcao_dias_uteis', 'prazo_liquidacao_dias_uteis', 'prazo_pagamento_dias', 'marco_pagamento', 'indice_atualizacao', 'juros_mora_mensal', 'garantia_objeto_meses', 'atualizado_em'],
    parametros,
  );
  await inserirEmLote(tx, 'contratos_designacoes', ['id', 'contrato_id', 'papel', 'usuario_id', 'substituto', 'ato', 'inicio', 'designado_em'], designacoes);

  // ───────── garantias já registradas nas colunas do contrato ─────────
  const comGarantia = await tx.consultar<{ id: string; assinatura_em: string; valor_inicial: number; garantia_tipo: string; garantia_valor: number; garantia_valida_ate: string }>(
    `SELECT id, assinatura_em, valor_inicial, garantia_tipo, garantia_valor, garantia_valida_ate
       FROM contratos WHERE garantia_valor IS NOT NULL AND garantia_valida_ate IS NOT NULL AND valor_inicial > 0 ORDER BY numero, id`,
  );
  const garantias: (string | number | boolean | null)[][] = [];
  const movimentos: (string | number | null)[][] = [];
  for (const c of comGarantia) {
    const id = prng.uuid();
    const prazo = adicionarDiasUteis(c.assinatura_em, 10, calendario);
    const apresentada = menor(adicionarDias(c.assinatura_em, prng.inteiro(2, 12)), hoje);
    const percentual = Math.round((c.garantia_valor / c.valor_inicial) * 100_000) / 1000;
    const modalidade = MODALIDADE_POR_ROTULO[c.garantia_tipo] ?? 'seguro_garantia';
    const emissor = modalidade === 'caucao_dinheiro' ? null : modalidade === 'seguro_garantia' ? 'Seguradora Sintética de Demonstração S.A.' : 'Banco Sintético de Demonstração S.A.';
    const documento = modalidade === 'caucao_dinheiro' ? null : `${modalidade === 'seguro_garantia' ? 'Apólice' : 'Carta de fiança'} ${prng.inteiro(100_000, 999_999)}`;
    garantias.push([id, c.id, 'execucao', percentual, c.valor_inicial, false, c.garantia_valor, false, false, prazo, modalidade, c.garantia_valor, c.garantia_valor, emissor, documento, apresentada, c.garantia_valida_ate, 'vigente', instante]);
    movimentos.push([prng.uuid(), id, 'exigencia', c.assinatura_em, c.garantia_valor, `Exigida em ${percentual}% do valor inicial do contrato (art. 98).`, instante]);
    movimentos.push([prng.uuid(), id, 'apresentacao', apresentada, c.garantia_valor, `${c.garantia_tipo}${documento ? `, ${documento}` : ''}, apresentada pela contratada.`, instante]);
  }
  await inserirEmLote(
    tx,
    'contratos_garantias',
    ['id', 'contrato_id', 'finalidade', 'percentual', 'valor_base', 'base_anual', 'valor_exigido', 'grande_vulto_engenharia', 'clausula_retomada', 'prazo_apresentacao', 'modalidade', 'valor', 'saldo', 'emissor', 'documento', 'apresentada_em', 'valida_ate', 'situacao', 'registrada_em'],
    garantias,
  );
  await inserirEmLote(tx, 'garantias_movimentos', ['id', 'garantia_id', 'tipo', 'data', 'valor', 'descricao', 'registrado_em'], movimentos);

  // ───────── data da liquidação das notas liquidadas e pagas (marco alternativo do prazo de pagamento) ─────────
  const liquidadas = await tx.consultar<{ id: string; atestado_em: string | null; pago_em: string | null }>(
    `SELECT id, atestado_em, pago_em FROM pagamentos WHERE situacao IN ('liquidado', 'pago') ORDER BY id`,
  );
  for (const p of liquidadas) {
    if (!p.atestado_em) continue;
    const liquidacao = menor(menor(adicionarDiasUteis(hojeISO(new Date(p.atestado_em)), prng.inteiro(1, 6), calendario), p.pago_em ?? hoje), hoje);
    await tx.executar('UPDATE pagamentos SET liquidado_em = $2 WHERE id = $1', [p.id, liquidacao]);
  }

  // ───────── entregas aguardando o recebimento provisório e ocorrências no livro ─────────
  const vigentes = prng.embaralhar(dados.contratos.filter((c) => c.vigenciaInicio <= adicionarDias(hoje, -30) && c.vigenciaFim >= adicionarDias(hoje, 60)));
  for (const [n, c] of vigentes.slice(0, ENTREGAS.length).entries()) {
    const entregue = adicionarDias(hoje, -prng.inteiro(1, 3));
    eventos.push({
      ocorridoEm: instanteEm(entregue, prng, agora),
      usuarioId: c.fiscalId,
      acao: 'recebimento.registrar_entrega',
      recurso: 'contrato',
      recursoId: c.id,
      resumo: 'Registrou a entrega nº 1, aguardando o recebimento provisório',
      dados: { ...carga },
    });
    await tx.executar(
      `INSERT INTO contratos_recebimentos (id, contrato_id, numero, descricao, valor, entregue_em, situacao, prazo_atual, registrado_por, registrado_em)
       VALUES ($1, $2, 1, $3, $4, $5, 'aguardando_provisorio', $6, $7, $8)`,
      [prng.uuid(), c.id, ENTREGAS[n] ?? ENTREGAS[0], Math.floor(c.valorGlobal / 12), entregue, adicionarDiasUteis(entregue, 5, calendario), c.fiscalId, instante],
    );
  }
  for (const [n, c] of vigentes.slice(ENTREGAS.length, ENTREGAS.length + OCORRENCIAS.length).entries()) {
    const fato = adicionarDias(hoje, -prng.inteiro(5, 20));
    await tx.executar(
      `INSERT INTO contratos_ocorrencias (id, contrato_id, numero, tipo, data_fato, relato, situacao, registrada_por, registrada_em)
       VALUES ($1, $2, 1, $3, $4, $5, 'aberta', $6, $7)`,
      [prng.uuid(), c.id, n === 0 ? 'atraso' : 'inconformidade', fato, OCORRENCIAS[n] ?? OCORRENCIAS[0], c.fiscalId, instante],
    );
    eventos.push({
      ocorridoEm: instanteEm(fato, prng, agora),
      usuarioId: c.fiscalId,
      acao: 'contrato.ocorrencia',
      recurso: 'contrato',
      recursoId: c.id,
      resumo: 'Registrou a ocorrência nº 1 no livro do contrato',
      dados: { ...carga },
    });
  }

  ctx.eventos.push(...eventos);
  dados.contagens.designacoesContratos = designacoes.length;
  dados.contagens.garantiasContratos = garantias.length;
}
