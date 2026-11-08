/**
 * Pesquisa de preços (Lei 14.133/2021, art. 23, e IN SEGES/ME 65/2021): estatísticas da cesta, sugestão de
 * expurgo de valores inexequíveis ou excessivamente elevados e alertas de conformidade.
 * Expurgos são sugestões estatísticas: a exclusão é confirmada e justificada pelo agente responsável.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, formatarData } from '../datas.ts';
import { type Centavos, formatarMoeda } from '../moeda.ts';
import { adicionarMeses, arredondar, contagem, exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';

export type FonteCotacao = 'painel_precos' | 'contratacao_similar' | 'midia_especializada' | 'fornecedor_direto' | 'nota_fiscal';

export interface Cotacao {
  id: string;
  fonte: FonteCotacao;
  descricaoFonte: string;
  valorUnitario: Centavos;
  dataCotacao: DataISO;
  justificativaEscolhaFornecedor?: string;
}

const FONTES: readonly FonteCotacao[] = ['painel_precos', 'contratacao_similar', 'midia_especializada', 'fornecedor_direto', 'nota_fiscal'];
const LIMITE_CV_MEDIA = 25;
const AVISO_CESTA = 'Expurgos são sugestões estatísticas; a exclusão de preços deve ser confirmada e justificada pelo agente responsável.';

interface Resumo {
  n: number;
  mediaExata: number;
  medianaExata: number;
  menor: number;
  maior: number;
  desvioExato: number;
  coeficienteVariacao: number;
}

/** Quantil por interpolação linear (equivale a QUARTIL.INC das planilhas). */
function quantil(ordenados: readonly number[], p: number): number {
  const h = (ordenados.length - 1) * p;
  const inferior = Math.floor(h);
  const a = ordenados[inferior] ?? 0;
  const b = ordenados[inferior + 1] ?? a;
  return a + (h - inferior) * (b - a);
}

/** Estatísticas com desvio-padrão amostral (n − 1); CV em % com 2 casas. */
function resumir(valores: readonly number[]): Resumo {
  const ordenados = [...valores].sort((x, y) => x - y);
  const n = ordenados.length;
  const mediaExata = ordenados.reduce((acc, v) => acc + v, 0) / n;
  const variancia = n > 1 ? ordenados.reduce((acc, v) => acc + (v - mediaExata) ** 2, 0) / (n - 1) : 0;
  const desvioExato = Math.sqrt(variancia);
  return {
    n,
    mediaExata,
    medianaExata: quantil(ordenados, 0.5),
    menor: ordenados[0] ?? 0,
    maior: ordenados[n - 1] ?? 0,
    desvioExato,
    coeficienteVariacao: mediaExata === 0 ? 0 : arredondar((desvioExato / mediaExata) * 100, 2),
  };
}

function validar(cotacoes: Cotacao[], dataReferencia: DataISO): void {
  if (!Array.isArray(cotacoes) || cotacoes.length === 0) {
    throw new ErroDominio('CESTA_VAZIA', 'Informe ao menos uma cotação para analisar a cesta de preços.');
  }
  lerData(dataReferencia, 'dataReferencia');
  const ids = new Set<string>();
  for (const c of cotacoes) {
    if (typeof c.id !== 'string' || c.id.length === 0) throw new ErroDominio('COTACAO_INVALIDA', 'Cotação sem id.');
    if (ids.has(c.id)) throw new ErroDominio('COTACAO_INVALIDA', `id de cotação repetido: ${c.id}.`);
    ids.add(c.id);
    if (!FONTES.includes(c.fonte)) throw new ErroDominio('COTACAO_INVALIDA', `Fonte inválida na cotação ${c.id}: ${String(c.fonte)}.`);
    exigirInteiro(c.valorUnitario, `valorUnitario da cotação ${c.id}`, 'COTACAO_INVALIDA', 1);
    lerData(c.dataCotacao, `dataCotacao da cotação ${c.id}`);
  }
}

/** A cotação é antiga quando dataCotacao + `meses` < dataReferencia. */
function maisAntigaQue(dataCotacao: DataISO, meses: number, dataReferencia: DataISO): boolean {
  return lerData(adicionarMeses(dataCotacao, meses)) < lerData(dataReferencia);
}

function rotuloCotacao(c: Cotacao): string {
  return `${c.id} (${c.descricaoFonte}, ${formatarData(c.dataCotacao)})`;
}

/**
 * Analisa a cesta de preços.
 * - iqr (padrão quando n ≥ 4): Tukey, fora de [Q1 − 1,5·IQR, Q3 + 1,5·IQR], quartis por interpolação linear;
 * - percentual_mediana (padrão quando n < 4): fora de mediana ± percentualMediana% (padrão 50).
 * Abaixo do intervalo → inexequivel; acima → excessivamente_elevado. Se o critério excluísse todos os preços,
 * nenhum expurgo é sugerido e um alerta EXPURGO_NAO_SUGERIDO é emitido.
 * Metodologia: CV saneado ≤ 25% → média; senão mediana. valorEstimado é calculado sobre o conjunto saneado.
 */
export function analisarCestaPrecos(
  cotacoes: Cotacao[],
  opcoes: { dataReferencia: DataISO; metodo?: 'iqr' | 'percentual_mediana'; percentualMediana?: number },
): {
  estatisticas: { n: number; media: Centavos; mediana: Centavos; menor: Centavos; maior: Centavos; desvioPadrao: Centavos; coeficienteVariacao: number };
  sugeridasExpurgo: { id: string; motivo: 'inexequivel' | 'excessivamente_elevado'; explicacao: string }[];
  estatisticasSaneadas: { n: number; media: Centavos; mediana: Centavos; menor: Centavos; coeficienteVariacao: number };
  metodologiaRecomendada: 'media' | 'mediana';
  valorEstimado: Centavos;
  alertas: { codigo: string; mensagem: string; fundamento: string }[];
  aviso: string;
} {
  validar(cotacoes, opcoes?.dataReferencia);
  const metodo = opcoes.metodo ?? (cotacoes.length >= 4 ? 'iqr' : 'percentual_mediana');
  if (metodo !== 'iqr' && metodo !== 'percentual_mediana') throw new ErroDominio('METODO_INVALIDO', `Método de saneamento inválido: ${String(metodo)}.`);
  const percentualMediana = opcoes.percentualMediana ?? 50;
  exigirFinito(percentualMediana, 'percentualMediana', 'METODO_INVALIDO');
  if (percentualMediana <= 0) throw new ErroDominio('METODO_INVALIDO', 'percentualMediana deve ser maior que zero.');

  const todos = resumir(cotacoes.map((c) => c.valorUnitario));
  const alertas: { codigo: string; mensagem: string; fundamento: string }[] = [];

  let inferior: number;
  let superior: number;
  let criterio: string;
  if (metodo === 'iqr') {
    const ordenados = cotacoes.map((c) => c.valorUnitario).sort((x, y) => x - y);
    const q1 = quantil(ordenados, 0.25);
    const q3 = quantil(ordenados, 0.75);
    const iqr = q3 - q1;
    inferior = q1 - 1.5 * iqr;
    superior = q3 + 1.5 * iqr;
    criterio = `critério de Tukey: Q1 = ${formatarMoeda(Math.round(q1))}, Q3 = ${formatarMoeda(Math.round(q3))}, IQR = ${formatarMoeda(Math.round(iqr))}`;
  } else {
    inferior = todos.medianaExata * (1 - percentualMediana / 100);
    superior = todos.medianaExata * (1 + percentualMediana / 100);
    criterio = `mediana ${formatarMoeda(Math.round(todos.medianaExata))} ± ${formatarNumero(percentualMediana)}%`;
  }

  let sugeridasExpurgo: { id: string; motivo: 'inexequivel' | 'excessivamente_elevado'; explicacao: string }[] = [];
  for (const c of cotacoes) {
    if (c.valorUnitario < inferior) {
      sugeridasExpurgo.push({
        id: c.id,
        motivo: 'inexequivel',
        explicacao: `Valor de ${formatarMoeda(c.valorUnitario)} abaixo do limite inferior de ${formatarMoeda(Math.round(inferior))} (${criterio}).`,
      });
    } else if (c.valorUnitario > superior) {
      sugeridasExpurgo.push({
        id: c.id,
        motivo: 'excessivamente_elevado',
        explicacao: `Valor de ${formatarMoeda(c.valorUnitario)} acima do limite superior de ${formatarMoeda(Math.round(superior))} (${criterio}).`,
      });
    }
  }
  if (sugeridasExpurgo.length === cotacoes.length) {
    sugeridasExpurgo = [];
    alertas.push({
      codigo: 'EXPURGO_NAO_SUGERIDO',
      mensagem: 'O critério estatístico excluiria todos os preços; nenhum expurgo foi sugerido. Analise criticamente a dispersão da cesta e amplie a pesquisa.',
      fundamento: 'IN SEGES/ME 65/2021, art. 6º',
    });
  }

  const expurgados = new Set(sugeridasExpurgo.map((s) => s.id));
  const saneado = resumir(cotacoes.filter((c) => !expurgados.has(c.id)).map((c) => c.valorUnitario));
  const metodologiaRecomendada: 'media' | 'mediana' = saneado.coeficienteVariacao <= LIMITE_CV_MEDIA ? 'media' : 'mediana';
  const valorEstimado = Math.round(metodologiaRecomendada === 'media' ? saneado.mediaExata : saneado.medianaExata);

  if (saneado.n < 3) {
    alertas.push({
      codigo: 'MENOS_DE_3_PRECOS',
      mensagem: `O cálculo incide sobre ${contagem(saneado.n, 'preço válido', 'preços válidos')} após os expurgos sugeridos; com menos de três preços, a estimativa exige justificativa do gestor responsável e aprovação da autoridade competente.`,
      fundamento: 'IN SEGES/ME 65/2021, art. 6º, § 5º',
    });
  }
  const diretas = cotacoes.filter((c) => c.fonte === 'fornecedor_direto');
  if (diretas.length > 0 && diretas.length < 3) {
    alertas.push({
      codigo: 'FORNECEDOR_DIRETO_INSUFICIENTE',
      mensagem: `A pesquisa direta tem ${contagem(diretas.length, 'fornecedor', 'fornecedores')}; quando utilizada, deve abranger no mínimo três fornecedores, mediante solicitação formal de cotação.`,
      fundamento: 'Lei 14.133/2021, art. 23, § 1º, IV',
    });
  }
  for (const c of cotacoes) {
    if (c.fonte === 'fornecedor_direto') {
      if (maisAntigaQue(c.dataCotacao, 6, opcoes.dataReferencia)) {
        alertas.push({
          codigo: 'COTACAO_DIRETA_ANTIGA',
          mensagem: `Cotação direta ${rotuloCotacao(c)} obtida com mais de 6 meses de antecedência da data de referência (${formatarData(opcoes.dataReferencia)}).`,
          fundamento: 'Lei 14.133/2021, art. 23, § 1º, IV',
        });
      }
      if ((c.justificativaEscolhaFornecedor ?? '').trim().length === 0) {
        alertas.push({
          codigo: 'SEM_JUSTIFICATIVA_FORNECEDOR',
          mensagem: `Cotação direta ${rotuloCotacao(c)} sem justificativa da escolha do fornecedor.`,
          fundamento: 'Lei 14.133/2021, art. 23, § 1º, IV',
        });
      }
    } else if (c.fonte === 'contratacao_similar' && maisAntigaQue(c.dataCotacao, 12, opcoes.dataReferencia)) {
      alertas.push({
        codigo: 'SIMILAR_ANTIGA',
        mensagem: `Contratação similar ${rotuloCotacao(c)} fora do período de 1 ano anterior à data de referência (${formatarData(opcoes.dataReferencia)}).`,
        fundamento: 'Lei 14.133/2021, art. 23, § 1º, II',
      });
    } else if (c.fonte === 'midia_especializada' && maisAntigaQue(c.dataCotacao, 6, opcoes.dataReferencia)) {
      alertas.push({
        codigo: 'MIDIA_ANTIGA',
        mensagem: `Preço de mídia especializada ${rotuloCotacao(c)} com mais de 6 meses em relação à data de referência (${formatarData(opcoes.dataReferencia)}).`,
        fundamento: 'Lei 14.133/2021, art. 23, § 1º, III',
      });
    }
  }

  return {
    estatisticas: {
      n: todos.n,
      media: Math.round(todos.mediaExata),
      mediana: Math.round(todos.medianaExata),
      menor: todos.menor,
      maior: todos.maior,
      desvioPadrao: Math.round(todos.desvioExato),
      coeficienteVariacao: todos.coeficienteVariacao,
    },
    sugeridasExpurgo,
    estatisticasSaneadas: {
      n: saneado.n,
      media: Math.round(saneado.mediaExata),
      mediana: Math.round(saneado.medianaExata),
      menor: saneado.menor,
      coeficienteVariacao: saneado.coeficienteVariacao,
    },
    metodologiaRecomendada,
    valorEstimado,
    alertas,
    aviso: AVISO_CESTA,
  };
}
