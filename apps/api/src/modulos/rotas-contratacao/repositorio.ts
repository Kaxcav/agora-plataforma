/**
 * Leitura das rotas de contratação (F9): rota do processo, aviso e propostas da dispensa, adesão a ata, compras do
 * Sicx e as despesas do exercício que entram no controle de fracionamento (art. 75, § 1º).
 */
import {
  adaptacaoDaRota,
  avaliarFracionamentoPorObjeto,
  hojeISO,
  prazoContratacaoAdesao,
  prazosCompraSicx,
  situacaoAvisoDispensa,
  validarInexigibilidade,
  type DespesaExercicio,
  type OpcoesCalendario,
  type TipoObjetoDispensa,
} from '@agora/dominio';
import type {
  AdesaoProcesso,
  AutorizacaoContratacaoDireta,
  AvisoDispensa,
  CompraSicx,
  ComprovacaoInexigibilidadeProcesso,
  FracionamentoRota,
  HipoteseDispensa,
  HipoteseInexigibilidade,
  PropostaDispensaResumo,
  RotaContratacao,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { analisarCesta, tipoDispensa, valorEstimadoProcesso } from '../jornada/regras.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';

export interface LinhaRota {
  processo_id: string;
  rota: RotaContratacao;
  hipotese_dispensa: HipoteseDispensa | null;
  inciso_dispensa: string | null;
  hipotese_inexigibilidade: HipoteseInexigibilidade | null;
  justificativa: string | null;
  natureza: string | null;
  justificativa_fracionamento: string | null;
  inexigibilidade: ComprovacaoInexigibilidadeProcesso | null;
  autorizacao: (Omit<AutorizacaoContratacaoDireta, 'fornecedor' | 'por'> & { fornecedorId: string; porId: string; porNome: string }) | null;
  julgado_em: string | null;
  escolhida_por: string | null;
  escolhida_por_nome: string | null;
  escolhida_em: string;
}

export interface LinhaAviso {
  processo_id: string;
  tarefa_id: string;
  situacao: 'na_fila' | 'publicado' | 'erro';
  publicado_em: string | null;
  encerramento: string | null;
  protocolo: string | null;
  numero_controle: string | null;
  modo: 'offline' | 'online' | null;
  ultimo_erro: string | null;
}

export interface LinhaProposta {
  id: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo_pessoa: 'PJ' | 'PF';
  valor: number;
  adicional: boolean;
  recebida_em: string;
  posicao: number | null;
  motivo_desclassificacao: string | null;
}

export interface LinhaAdesao {
  id: string;
  ata_id: string;
  ata_numero: string;
  ata_uasg: string;
  ata_objeto: string;
  ata_vigencia_fim: string;
  item_ata_id: string;
  item_numero: number;
  item_descricao: string;
  item_unidade: string;
  quantidade_registrada: number;
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo_pessoa: 'PJ' | 'PF';
  uasg_aderente: string;
  quantidade: number;
  valor_unitario: number;
  justificativa_vantagem: string;
  situacao: AdesaoProcesso['situacao'];
  aceite_fornecedor_em: string | null;
  anuencia_em: string | null;
  anuencia_por: string | null;
  anuencia_por_nome: string | null;
  motivo_recusa: string | null;
}

export interface CargaRota {
  rota: LinhaRota;
  aviso: LinhaAviso | null;
  propostas: LinhaProposta[];
  adesao: LinhaAdesao | null;
  compras: CompraSicx[];
}

export async function obterLinhaRota(executor: Executor, processoId: string): Promise<LinhaRota | null> {
  const [linha] = await executor.consultar<LinhaRota>(
    `SELECT r.processo_id, r.rota, r.hipotese_dispensa, r.inciso_dispensa, r.hipotese_inexigibilidade, r.justificativa, r.natureza,
            r.justificativa_fracionamento, r.inexigibilidade, r.autorizacao, r.julgado_em, r.escolhida_por, u.nome AS escolhida_por_nome,
            r.escolhida_em
       FROM processos_rotas r LEFT JOIN usuarios u ON u.id = r.escolhida_por
      WHERE r.processo_id = $1`,
    [processoId],
  );
  return linha ?? null;
}

/** Aviso do processo; enquanto não publicado, a situação acompanha a tarefa da fila (fila de erro = 'erro'). */
export async function obterAviso(executor: Executor, processoId: string): Promise<LinhaAviso | null> {
  const [linha] = await executor.consultar<LinhaAviso & { situacao_tarefa: string }>(
    `SELECT a.processo_id, a.tarefa_id, a.situacao, a.publicado_em, a.encerramento, a.protocolo, a.numero_controle, a.modo,
            t.ultimo_erro, t.situacao AS situacao_tarefa
       FROM dispensas_avisos a JOIN fila_tarefas t ON t.id = a.tarefa_id
      WHERE a.processo_id = $1`,
    [processoId],
  );
  if (!linha) return null;
  const { situacao_tarefa, ...aviso } = linha;
  return aviso.situacao === 'na_fila' && situacao_tarefa === 'erro' ? { ...aviso, situacao: 'erro' } : aviso;
}

export async function listarPropostas(executor: Executor, processoId: string): Promise<LinhaProposta[]> {
  return executor.consultar<LinhaProposta>(
    `SELECT p.id, p.fornecedor_id, f.razao_social AS fornecedor_nome, f.tipo_pessoa, p.valor, p.adicional, p.recebida_em, p.posicao,
            p.motivo_desclassificacao
       FROM dispensas_propostas p JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.processo_id = $1
      ORDER BY p.posicao NULLS LAST, p.recebida_em, p.id`,
    [processoId],
  );
}

const SELECAO_ADESAO = `
  SELECT ad.id, ad.ata_id, a.numero AS ata_numero, a.uasg AS ata_uasg, a.objeto AS ata_objeto, a.vigencia_fim AS ata_vigencia_fim,
         ad.item_ata_id, i.numero AS item_numero, i.descricao AS item_descricao, i.unidade_fornecimento AS item_unidade,
         i.quantidade_registrada, i.fornecedor_id, f.razao_social AS fornecedor_nome, f.tipo_pessoa, ad.uasg_aderente, ad.quantidade,
         ad.valor_unitario, ad.justificativa_vantagem, ad.situacao, ad.aceite_fornecedor_em, ad.anuencia_em, ad.anuencia_por,
         u.nome AS anuencia_por_nome, ad.motivo_recusa
    FROM atas_adesoes ad
    JOIN atas a ON a.id = ad.ata_id
    JOIN itens_ata i ON i.id = ad.item_ata_id
    JOIN fornecedores f ON f.id = i.fornecedor_id
    LEFT JOIN usuarios u ON u.id = ad.anuencia_por`;

export async function obterAdesao(executor: Executor, processoId: string): Promise<LinhaAdesao | null> {
  const [linha] = await executor.consultar<LinhaAdesao>(`${SELECAO_ADESAO} WHERE ad.processo_id = $1`, [processoId]);
  return linha ?? null;
}

/** Quantidades já aderidas no item (adesões autorizadas), no total e pela UASG aderente, sem a adesão `exceto`. */
export async function quantidadesAderidas(
  executor: Executor,
  itemAtaId: string,
  uasgAderente: string,
  exceto: string | null,
): Promise<{ total: number; orgao: number }> {
  const [linha] = await executor.consultar<{ total: number; orgao: number }>(
    `SELECT COALESCE(SUM(quantidade), 0)::integer AS total,
            COALESCE(SUM(quantidade) FILTER (WHERE uasg_aderente = $2), 0)::integer AS orgao
       FROM atas_adesoes
      WHERE item_ata_id = $1 AND situacao = 'autorizada' AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [itemAtaId, uasgAderente, exceto],
  );
  return { total: linha?.total ?? 0, orgao: linha?.orgao ?? 0 };
}

// ───────────────────────── Sicx ─────────────────────────

export interface LinhaCompraSicx {
  id: string;
  numero: string;
  uasg: string;
  processo_id: string | null;
  reserva_id: string | null;
  item_codigo: string;
  item_descricao: string;
  unidade: string;
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo_pessoa: 'PJ' | 'PF';
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  posicao: number;
  justificativa_selecao: string | null;
  situacao: CompraSicx['situacao'];
  ordem_por: string;
  ordem_por_nome: string;
  ordem_em: string;
  conclusao_por: string | null;
  conclusao_por_nome: string | null;
  conclusao_em: string | null;
  entrega_registrada_em: string | null;
  recebimento_provisorio_em: string | null;
  recebimento_definitivo_em: string | null;
  pago_em: string | null;
}

export const SELECAO_COMPRA_SICX = `
  SELECT c.id, c.numero, c.uasg, c.processo_id, c.reserva_id, o.item_codigo, o.item_descricao, o.unidade, c.fornecedor_id,
         f.razao_social AS fornecedor_nome, f.tipo_pessoa, c.quantidade, c.preco_unitario, c.valor_total, c.posicao,
         c.justificativa_selecao, c.situacao, c.ordem_por, uo.nome AS ordem_por_nome, c.ordem_em, c.conclusao_por,
         uc.nome AS conclusao_por_nome, c.conclusao_em, c.entrega_registrada_em, c.recebimento_provisorio_em,
         c.recebimento_definitivo_em, c.pago_em
    FROM sicx_compras c
    JOIN sicx_ofertas o ON o.id = c.oferta_id
    JOIN fornecedores f ON f.id = c.fornecedor_id
    JOIN usuarios uo ON uo.id = c.ordem_por
    LEFT JOIN usuarios uc ON uc.id = c.conclusao_por`;

export function montarCompraSicx(l: LinhaCompraSicx, hoje: string, calendario: OpcoesCalendario): CompraSicx {
  const prazos =
    l.situacao === 'concluida'
      ? prazosCompraSicx({
          entregaRegistradaEm: l.entrega_registrada_em,
          recebimentoProvisorioEm: l.recebimento_provisorio_em,
          recebimentoDefinitivoEm: l.recebimento_definitivo_em,
          pagoEm: l.pago_em,
          hoje,
          opcoes: calendario,
        })
      : null;
  return {
    id: l.id,
    numero: l.numero,
    uasg: l.uasg,
    processoId: l.processo_id,
    reservaId: l.reserva_id,
    item: { codigo: l.item_codigo, descricao: l.item_descricao, unidade: l.unidade },
    fornecedor: { id: l.fornecedor_id, nome: nomeExibivel(l.tipo_pessoa, l.fornecedor_nome) },
    quantidade: l.quantidade,
    precoUnitario: l.preco_unitario,
    valorTotal: l.valor_total,
    posicao: l.posicao,
    justificativaSelecao: l.justificativa_selecao,
    situacao: l.situacao,
    ordemEm: l.ordem_em,
    ordemPor: { id: l.ordem_por, nome: l.ordem_por_nome },
    conclusaoEm: l.conclusao_em,
    conclusaoPor: usuarioResumo(l.conclusao_por, l.conclusao_por_nome),
    entregaRegistradaEm: l.entrega_registrada_em,
    recebimentoProvisorioEm: l.recebimento_provisorio_em,
    recebimentoDefinitivoEm: l.recebimento_definitivo_em,
    pagoEm: l.pago_em,
    prazos: prazos
      ? {
          situacao: prazos.situacao,
          limiteRecebimentoProvisorio: prazos.limiteRecebimentoProvisorio,
          limiteRecebimentoDefinitivo: prazos.limiteRecebimentoDefinitivo,
          recebimentoTacito: prazos.recebimentoTacito,
          limitePagamento: prazos.limitePagamento,
          pagamentoVencido: prazos.pagamentoVencido,
          mensagem: prazos.mensagem,
        }
      : null,
  };
}

export async function comprasSicxDoProcesso(executor: Executor, processoId: string, hoje: string, calendario: OpcoesCalendario): Promise<CompraSicx[]> {
  const linhas = await executor.consultar<LinhaCompraSicx>(`${SELECAO_COMPRA_SICX} WHERE c.processo_id = $1 ORDER BY c.ordem_em`, [processoId]);
  return linhas.map((l) => montarCompraSicx(l, hoje, calendario));
}

export async function carregarRota(executor: Executor, processoId: string, hoje: string, calendario: OpcoesCalendario): Promise<CargaRota | null> {
  const rota = await obterLinhaRota(executor, processoId);
  if (!rota) return null;
  return {
    rota,
    aviso: rota.rota === 'dispensa' ? await obterAviso(executor, processoId) : null,
    propostas: rota.rota === 'dispensa' ? await listarPropostas(executor, processoId) : [],
    adesao: rota.rota === 'adesao_ata' ? await obterAdesao(executor, processoId) : null,
    compras: rota.rota === 'sicx' ? await comprasSicxDoProcesso(executor, processoId, hoje, calendario) : [],
  };
}

// ───────────────────────── fracionamento (RIA-01, art. 75, § 1º) ─────────────────────────

/**
 * Despesas do exercício da UASG que entram na soma da dispensa por valor: outras dispensas por valor (rota
 * dispensa, incisos I e II, com o valor autorizado ou estimado) e as compras com cartão de pagamento.
 */
export async function despesasDoExercicio(executor: Executor, uasg: string, exercicio: string, excetoProcesso: string | null): Promise<DespesaExercicio[]> {
  const dispensas = await executor.consultar<Pick<LinhaProcesso, 'dfd' | 'cesta'> & { natureza: string; escolhida_em: string; autorizacao: { valor: number } | null }>(
    `SELECT p.dfd, p.cesta, r.natureza, r.escolhida_em, r.autorizacao
       FROM processos_rotas r JOIN processos p ON p.id = r.processo_id
      WHERE p.uasg = $1 AND r.rota = 'dispensa' AND r.hipotese_dispensa IN ('valor_obras_engenharia', 'valor_demais') AND r.natureza IS NOT NULL
        AND ($2::uuid IS NULL OR p.id <> $2::uuid)`,
    [uasg, excetoProcesso],
  );
  const despesas: DespesaExercicio[] = [];
  for (const d of dispensas) {
    const data = hojeISO(new Date(d.escolhida_em));
    if (data.slice(0, 4) !== exercicio) continue;
    const valor = d.autorizacao?.valor ?? valorEstimadoProcesso(d.dfd, analisarCesta(d.cesta, data)) ?? 0;
    if (valor > 0) despesas.push({ valor, natureza: d.natureza, data, origem: 'dispensa', tipo: tipoDispensa(d.dfd.tipoObjeto) });
  }
  const cartao = await executor.consultar<{ valor: number; natureza: string; data_compra: string; tipo_objeto: TipoObjetoDispensa }>(
    `SELECT valor, natureza, data_compra, tipo_objeto FROM cartao_pagamento_compras
      WHERE uasg = $1 AND data_compra >= $2::date AND data_compra < ($2::date + interval '1 year')`,
    [uasg, `${exercicio}-01-01`],
  );
  for (const c of cartao) despesas.push({ valor: c.valor, natureza: c.natureza, data: c.data_compra, origem: 'cartao', tipo: c.tipo_objeto });
  return despesas;
}

export async function fracionamentoDaUasg(
  executor: Executor,
  e: { uasg: string; natureza: string; tipo: TipoObjetoDispensa; novaContratacao: number; hoje: string; excetoProcesso: string | null },
): Promise<FracionamentoRota> {
  const despesas = await despesasDoExercicio(executor, e.uasg, e.hoje.slice(0, 4), e.excetoProcesso);
  const r = avaliarFracionamentoPorObjeto({ data: e.hoje, tipo: e.tipo, natureza: e.natureza, despesas, novaContratacao: e.novaContratacao });
  return {
    natureza: r.natureza,
    somaComNova: r.somaComNova,
    limite: r.limite,
    percentualDoLimite: r.percentualDoLimite,
    sinal: r.sinal,
    explicacao: r.explicacao,
    fundamento: r.fundamento,
    consideradas: r.consideradas,
  };
}

// ───────────────────────── montagem ─────────────────────────

export function montarAviso(aviso: LinhaAviso | null, hoje: string, calendario: OpcoesCalendario): AvisoDispensa | null {
  if (!aviso) return null;
  if (aviso.situacao !== 'publicado' || !aviso.publicado_em) {
    return {
      situacao: aviso.situacao,
      publicadoEm: null,
      encerramento: null,
      aberto: false,
      julgamentoLiberado: false,
      diasUteisRestantes: 0,
      mensagem:
        aviso.situacao === 'erro'
          ? 'O envio do aviso ao PNCP falhou e está na fila de erro: corrija e reenvie.'
          : 'Aviso na fila de publicação do PNCP; o prazo de 3 dias úteis começa na publicação.',
      protocolo: aviso.protocolo,
      numeroControle: aviso.numero_controle,
      modo: aviso.modo,
      ultimoErro: aviso.ultimo_erro,
    };
  }
  const s = situacaoAvisoDispensa({ publicadoEm: aviso.publicado_em, hoje: hoje < aviso.publicado_em ? aviso.publicado_em : hoje, opcoes: calendario });
  return {
    situacao: 'publicado',
    publicadoEm: aviso.publicado_em,
    encerramento: s.encerramento,
    aberto: s.aberto,
    julgamentoLiberado: s.julgamentoLiberado,
    diasUteisRestantes: s.diasUteisRestantes,
    mensagem: s.mensagem,
    protocolo: aviso.protocolo,
    numeroControle: aviso.numero_controle,
    modo: aviso.modo,
    ultimoErro: null,
  };
}

export function montarPropostas(propostas: readonly LinhaProposta[]): PropostaDispensaResumo[] {
  return propostas.map((p) => ({
    id: p.id,
    fornecedor: { id: p.fornecedor_id, nome: nomeExibivel(p.tipo_pessoa, p.fornecedor_nome) },
    valor: p.valor,
    recebidaEm: p.recebida_em,
    adicional: p.adicional,
    posicao: p.posicao,
    motivoDesclassificacao: p.motivo_desclassificacao,
  }));
}

export function montarAdesao(a: LinhaAdesao | null, aderidas: { total: number; orgao: number }, hoje: string): AdesaoProcesso | null {
  if (!a) return null;
  return {
    id: a.id,
    ata: { id: a.ata_id, numero: a.ata_numero, uasg: a.ata_uasg, objeto: a.ata_objeto, vigenciaFim: a.ata_vigencia_fim },
    item: {
      id: a.item_ata_id,
      numero: a.item_numero,
      descricao: a.item_descricao,
      unidade: a.item_unidade,
      valorUnitario: a.valor_unitario,
      quantidadeRegistrada: a.quantidade_registrada,
    },
    fornecedor: { id: a.fornecedor_id, nome: nomeExibivel(a.tipo_pessoa, a.fornecedor_nome) },
    quantidade: a.quantidade,
    valorTotal: a.quantidade * a.valor_unitario,
    justificativaVantagem: a.justificativa_vantagem,
    situacao: a.situacao,
    aceiteFornecedorEm: a.aceite_fornecedor_em,
    anuenciaEm: a.anuencia_em,
    anuenciaPor: usuarioResumo(a.anuencia_por, a.anuencia_por_nome),
    motivoRecusa: a.motivo_recusa,
    limiteContratacao: a.anuencia_em ? prazoContratacaoAdesao({ autorizadaEm: a.anuencia_em, vigenciaFimAta: a.ata_vigencia_fim, hoje }).limite : null,
    limites: {
      limitePorOrgao: Math.floor(a.quantidade_registrada / 2),
      limiteTotal: a.quantidade_registrada * 2,
      aderidoPeloOrgao: aderidas.orgao,
      aderidoTotal: aderidas.total,
    },
  };
}

export function montarInexigibilidade(rota: LinhaRota): (ComprovacaoInexigibilidadeProcesso & { pendencias: string[] }) | null {
  if (rota.rota !== 'inexigibilidade' || !rota.hipotese_inexigibilidade) return null;
  const comprovacao: ComprovacaoInexigibilidadeProcesso = rota.inexigibilidade
    ? { ...rota.inexigibilidade, hipotese: rota.hipotese_inexigibilidade }
    : { hipotese: rota.hipotese_inexigibilidade, justificativaInviabilidade: rota.justificativa };
  return { ...comprovacao, pendencias: validarInexigibilidade(comprovacao).pendencias.map((p) => p.mensagem) };
}

export function adaptacaoDaLinha(rota: LinhaRota | null): ReturnType<typeof adaptacaoDaRota> {
  return adaptacaoDaRota(rota?.rota ?? 'licitacao', rota?.hipotese_dispensa ?? null);
}
