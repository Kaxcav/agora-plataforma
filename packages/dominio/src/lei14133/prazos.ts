/**
 * Prazos da Lei 14.133/2021: mínimos para propostas (art. 55), aviso de dispensa eletrônica (art. 75, § 3º)
 * e divulgação de contratos no PNCP (art. 94). Contagem em dias úteis na forma do art. 183.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, adicionarDiasUteis, diasUteisEntre, formatarData } from '../datas.ts';
import { contagem, lerData } from '../interno.ts';

export type ObjetoLicitacao =
  | 'bens'
  | 'servicos_comuns'
  | 'servicos_especiais'
  | 'obras_servicos_engenharia_comuns'
  | 'obras_servicos_engenharia_especiais';
export type CriterioJulgamento = 'menor_preco' | 'maior_desconto' | 'tecnica_preco' | 'melhor_tecnica' | 'maior_lance' | 'maior_retorno_economico';
export type RegimeExecucao = 'integrada' | 'semi_integrada' | 'outro';

const OBJETOS: readonly ObjetoLicitacao[] = [
  'bens',
  'servicos_comuns',
  'servicos_especiais',
  'obras_servicos_engenharia_comuns',
  'obras_servicos_engenharia_especiais',
];
const CRITERIOS: readonly CriterioJulgamento[] = ['menor_preco', 'maior_desconto', 'tecnica_preco', 'melhor_tecnica', 'maior_lance', 'maior_retorno_economico'];
const REGIMES: readonly RegimeExecucao[] = ['integrada', 'semi_integrada', 'outro'];

/**
 * Prazo mínimo entre a divulgação do edital e a apresentação de propostas (art. 55), em dias úteis.
 * Precedência adotada: maior lance → III (15); contratação integrada → II, c (60, também com técnica e preço);
 * técnica e preço ou melhor técnica → IV (35); bens → I, a (8) ou I, b (15); serviços e obras → II, a (10),
 * II, b (25) ou II, d (35, semi-integrada e demais casos, inclusive maior retorno econômico).
 */
export function prazoMinimoPropostas(p: { objeto: ObjetoLicitacao; criterio: CriterioJulgamento; regime?: RegimeExecucao }): {
  diasUteis: number;
  fundamento: string;
} {
  if (!OBJETOS.includes(p.objeto)) throw new ErroDominio('PRAZO_INVALIDO', `Objeto inválido: ${String(p.objeto)}.`);
  if (!CRITERIOS.includes(p.criterio)) throw new ErroDominio('PRAZO_INVALIDO', `Critério de julgamento inválido: ${String(p.criterio)}.`);
  const regime = p.regime ?? 'outro';
  if (!REGIMES.includes(regime)) throw new ErroDominio('PRAZO_INVALIDO', `Regime de execução inválido: ${String(regime)}.`);

  const ehBens = p.objeto === 'bens';
  const precoOuDesconto = p.criterio === 'menor_preco' || p.criterio === 'maior_desconto';
  if (p.criterio === 'maior_lance') return { diasUteis: 15, fundamento: 'Lei 14.133/2021, art. 55, III' };
  if (!ehBens && regime === 'integrada') return { diasUteis: 60, fundamento: 'Lei 14.133/2021, art. 55, II, c' };
  if (p.criterio === 'tecnica_preco' || p.criterio === 'melhor_tecnica') return { diasUteis: 35, fundamento: 'Lei 14.133/2021, art. 55, IV' };
  if (ehBens) {
    return precoOuDesconto
      ? { diasUteis: 8, fundamento: 'Lei 14.133/2021, art. 55, I, a' }
      : { diasUteis: 15, fundamento: 'Lei 14.133/2021, art. 55, I, b' };
  }
  if (regime === 'semi_integrada' || !precoOuDesconto) return { diasUteis: 35, fundamento: 'Lei 14.133/2021, art. 55, II, d' };
  const comum = p.objeto === 'servicos_comuns' || p.objeto === 'obras_servicos_engenharia_comuns';
  return comum ? { diasUteis: 10, fundamento: 'Lei 14.133/2021, art. 55, II, a' } : { diasUteis: 25, fundamento: 'Lei 14.133/2021, art. 55, II, b' };
}

/** Primeira data em que as propostas podem ser abertas: divulgação + prazo mínimo em dias úteis (arts. 55 e 183). */
export function dataMinimaAberturaPropostas(
  publicacao: DataISO,
  p: Parameters<typeof prazoMinimoPropostas>[0],
  opcoes?: OpcoesCalendario,
): { data: DataISO; diasUteis: number; fundamento: string } {
  const prazo = prazoMinimoPropostas(p);
  return {
    data: adicionarDiasUteis(publicacao, prazo.diasUteis, opcoes),
    diasUteis: prazo.diasUteis,
    fundamento: `${prazo.fundamento}, c/c art. 183`,
  };
}

/** Aviso de dispensa eletrônica: divulgação por no mínimo 3 dias úteis (art. 75, § 3º). */
export function prazoAvisoDispensaEletronica(publicacao: DataISO, opcoes?: OpcoesCalendario): { data: DataISO; fundamento: string } {
  return { data: adicionarDiasUteis(publicacao, 3, opcoes), fundamento: 'Lei 14.133/2021, art. 75, § 3º' };
}

function prazoPncp(origem: 'licitacao' | 'contratacao_direta'): { diasUteis: number; fundamento: string } {
  if (origem === 'licitacao') return { diasUteis: 20, fundamento: 'Lei 14.133/2021, art. 94, I' };
  if (origem === 'contratacao_direta') return { diasUteis: 10, fundamento: 'Lei 14.133/2021, art. 94, II' };
  throw new ErroDominio('PRAZO_INVALIDO', `Origem da contratação inválida: ${String(origem)}.`);
}

/**
 * Limite para divulgar o contrato no PNCP, contado da assinatura: 20 dias úteis (licitação) ou 10 dias úteis
 * (contratação direta). A divulgação é condição indispensável para a eficácia do contrato (art. 94).
 */
export function prazoDivulgacaoContratoPncp(
  assinatura: DataISO,
  origem: 'licitacao' | 'contratacao_direta',
  opcoes?: OpcoesCalendario,
): { limite: DataISO; diasUteis: number; fundamento: string } {
  const prazo = prazoPncp(origem);
  return { limite: adicionarDiasUteis(assinatura, prazo.diasUteis, opcoes), diasUteis: prazo.diasUteis, fundamento: prazo.fundamento };
}

export function situacaoDivulgacaoPncp(
  assinatura: DataISO,
  origem: 'licitacao' | 'contratacao_direta',
  divulgacao: DataISO | null,
  hoje: DataISO,
  opcoes?: OpcoesCalendario,
): { situacao: 'divulgado_no_prazo' | 'divulgado_fora_do_prazo' | 'pendente_no_prazo' | 'pendente_vencido'; limite: DataISO; explicacao: string } {
  const { limite, diasUteis } = prazoDivulgacaoContratoPncp(assinatura, origem, opcoes);
  const regra = `prazo de ${diasUteis} dias úteis contados da assinatura em ${formatarData(assinatura)} (limite: ${formatarData(limite)})`;
  const eficacia = 'A divulgação no PNCP é condição indispensável para a eficácia do contrato (Lei 14.133/2021, art. 94).';
  lerData(hoje, 'hoje');

  if (divulgacao !== null) {
    if (lerData(divulgacao, 'divulgacao') < lerData(assinatura, 'assinatura')) {
      throw new ErroDominio('DATA_INVALIDA', 'A data de divulgação no PNCP é anterior à assinatura do contrato.');
    }
    if (divulgacao <= limite) {
      return {
        situacao: 'divulgado_no_prazo',
        limite,
        explicacao: `Contrato divulgado no PNCP em ${formatarData(divulgacao)}, dentro do ${regra}. ${eficacia}`,
      };
    }
    const atraso = diasUteisEntre(limite, divulgacao, opcoes);
    return {
      situacao: 'divulgado_fora_do_prazo',
      limite,
      explicacao: `Contrato divulgado no PNCP em ${formatarData(divulgacao)}, ${contagem(atraso, 'dia útil', 'dias úteis')} após o fim do ${regra}. ${eficacia}`,
    };
  }

  if (hoje <= limite) {
    const restantes = diasUteisEntre(hoje, limite, opcoes);
    const quando = restantes === 0 ? 'O prazo vence hoje' : restantes === 1 ? 'Resta 1 dia útil' : `Restam ${restantes} dias úteis`;
    return {
      situacao: 'pendente_no_prazo',
      limite,
      explicacao: `Divulgação no PNCP pendente. ${quando} do ${regra}. ${eficacia}`,
    };
  }
  const vencidos = diasUteisEntre(limite, hoje, opcoes);
  return {
    situacao: 'pendente_vencido',
    limite,
    explicacao: `Divulgação no PNCP pendente e prazo vencido há ${contagem(vencidos, 'dia útil', 'dias úteis')} (${regra}). O contrato não produz efeitos enquanto não for divulgado. ${eficacia}`,
  };
}
