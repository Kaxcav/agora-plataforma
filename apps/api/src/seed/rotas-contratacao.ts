/**
 * Carga sintética das rotas de contratação (F9), sem criar processos (os processos da jornada continuam os 8 da carga
 * da jornada):
 * - vitrine simulada do Sicx: itens comuns padronizados com ofertas de fornecedores sintéticos (preço escalonado,
 *   uma oferta com restrição no Cadin e uma que não atende ao Distrito Federal);
 * - reservas de limite do ETP abrangente em duas UASGs (uma com autorização prévia, art. 13, § 1º, II);
 * - compras com cartão de pagamento no exercício, no ramo "material de expediente" da UASG da SENASP, perto do limite
 *   da dispensa por valor, para demonstrar o sinal de fracionamento (art. 75, § 1º).
 * Gerador próprio (semente fixa): não altera a sequência das demais etapas da carga.
 */
import { adicionarDias } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

const SEMENTE_ROTAS = 14_133_079;

/** UASG das compras com cartão (SENASP) e o ramo usado na demonstração do fracionamento. */
export const UASG_CARTAO_DEMONSTRACAO = '930001';
export const NATUREZA_CARTAO_DEMONSTRACAO = 'material de expediente';

interface ItemSicx {
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string;
  /** Preço de referência em reais. */
  referencia: number;
}

export const ITENS_SICX: readonly ItemSicx[] = [
  { codigo: 'SICX-100001', descricao: 'Papel A4 75 g/m², resma com 500 folhas', unidade: 'resma', categoria: 'Material de expediente', referencia: 28.9 },
  { codigo: 'SICX-100002', descricao: 'Pilha alcalina AA, cartela com 4 unidades', unidade: 'cartela', categoria: 'Material de expediente', referencia: 21.5 },
  { codigo: 'SICX-100003', descricao: 'Toner para impressora laser monocromática, rendimento 3.000 páginas', unidade: 'unidade', categoria: 'Suprimentos de informática', referencia: 189.0 },
  { codigo: 'SICX-100004', descricao: 'Álcool etílico 70% em gel, frasco de 500 ml', unidade: 'frasco', categoria: 'Higiene e limpeza', referencia: 9.8 },
  { codigo: 'SICX-100005', descricao: 'Lanterna LED recarregável de uso profissional, 300 lúmens', unidade: 'unidade', categoria: 'Equipamentos operacionais', referencia: 146.0 },
  { codigo: 'SICX-100006', descricao: 'Café torrado e moído, pacote de 500 g', unidade: 'pacote', categoria: 'Gêneros alimentícios', referencia: 17.4 },
];

const UFS_NACIONAIS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const centavos = (reais: number) => Math.round(reais * 100);

export async function gerarRotasContratacao(ctx: ContextoSeed): Promise<void> {
  const { tx, dados, hoje, agora } = ctx;
  const prng = new Prng(SEMENTE_ROTAS);
  const pj = dados.fornecedores.filter((f) => f.tipo === 'PJ');
  if (pj.length < 5) return;
  const admin = dados.usuarios.get('admin@agora.demo') ?? null;
  const agente = dados.usuarios.get('agente@agora.demo') ?? admin;
  const financeiro = dados.usuarios.get('financeiro@agora.demo') ?? admin;

  // ── vitrine do Sicx ──
  const ofertas: (string | number | boolean | readonly string[] | null)[][] = [];
  for (const [indice, item] of ITENS_SICX.entries()) {
    const fornecedores = prng.embaralhar(pj).slice(0, 5);
    for (const [k, f] of fornecedores.entries()) {
      const fator = 0.88 + prng.inteiro(0, 24) / 100;
      const preco = centavos(item.referencia * fator);
      const faixas = k % 2 === 0 ? [{ aPartirDe: 50, precoUnitario: Math.round(preco * 0.95) }, { aPartirDe: 200, precoUnitario: Math.round(preco * 0.9) }] : [];
      // Casos de demonstração: no item 1, uma oferta com restrição no Cadin e outra que só atende a SP.
      const restricao = indice === 0 && k === 3;
      const localidades = indice === 0 && k === 4 ? ['SP'] : UFS_NACIONAIS;
      ofertas.push([
        prng.uuid(),
        item.codigo,
        item.descricao,
        item.unidade,
        item.categoria,
        f.id,
        preco,
        JSON.stringify(faixas),
        localidades,
        prng.inteiro(2, 10),
        prng.escolher([15, 20, 30]),
        restricao,
        true,
        (prng.inteiro(30, 50) / 10).toFixed(2),
        normalizarBusca(item.codigo, item.descricao, item.categoria),
        agora.toISOString(),
      ]);
    }
  }
  await inserirEmLote(
    tx,
    'sicx_ofertas',
    [
      'id', 'item_codigo', 'item_descricao', 'unidade', 'categoria', 'fornecedor_id', 'preco_unitario', 'faixas', 'localidades',
      'prazo_entrega_dias', 'prazo_pagamento_dias', 'restricao_cadin', 'credenciada', 'reputacao', 'busca_normalizada', 'atualizada_em',
    ],
    ofertas,
  );

  // ── reservas do ETP abrangente (Decreto 13.106/2026, art. 13) ──
  const ano = hoje.slice(0, 4);
  const fimExercicio = `${ano}-12-31`;
  await inserirEmLote(
    tx,
    'sicx_reservas',
    ['id', 'uasg', 'descricao', 'etp_referencia', 'limite', 'autorizacao_previa', 'vigencia_fim', 'criada_por', 'criada_em'],
    [
      [prng.uuid(), '910001', 'Material de expediente e suprimentos de informática da sede', `ETP abrangente nº 1/${ano}`, centavos(50_000), true, fimExercicio, agente?.id ?? null, agora.toISOString()],
      [prng.uuid(), '920001', 'Material de higiene, limpeza e copa da sede', `ETP abrangente nº 2/${ano}`, centavos(30_000), false, fimExercicio, agente?.id ?? null, agora.toISOString()],
    ],
  );

  // ── cartão de pagamento (art. 75, § 4º): perto do limite da dispensa por valor no mesmo ramo ──
  const inicioExercicio = `${ano}-01-01`;
  const compras: (string | number | null)[][] = [];
  const valores = [9_850, 12_400, 11_300, 8_990, 10_760];
  for (const [i, valor] of valores.entries()) {
    const data = adicionarDias(hoje, -(15 + i * 21));
    const f = pj[i % pj.length];
    if (!f) continue;
    compras.push([
      prng.uuid(),
      UASG_CARTAO_DEMONSTRACAO,
      data < inicioExercicio ? inicioExercicio : data,
      f.id,
      centavos(valor),
      `Aquisição de material de expediente para a unidade (lote ${i + 1})`,
      NATUREZA_CARTAO_DEMONSTRACAO,
      'demais',
      financeiro?.id ?? null,
      instanteEm(data < inicioExercicio ? inicioExercicio : data, prng, agora).toISOString(),
    ]);
  }
  await inserirEmLote(
    tx,
    'cartao_pagamento_compras',
    ['id', 'uasg', 'data_compra', 'fornecedor_id', 'valor', 'objeto', 'natureza', 'tipo_objeto', 'registrada_por', 'registrada_em'],
    compras,
  );

  dados.contagens.sicxOfertas = ofertas.length;
  dados.contagens.sicxReservas = 2;
  dados.contagens.cartaoPagamentoCompras = compras.length;
}
