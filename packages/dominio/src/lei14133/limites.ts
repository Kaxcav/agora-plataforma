/**
 * Dispensa de licitação por valor (Lei 14.133/2021, art. 75, I e II) e sinal de fracionamento (art. 75, § 1º).
 * Os valores são atualizados anualmente por decreto (art. 182); vale a vigência mais recente com vigenteDesde ≤ data.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, formatarData } from '../datas.ts';
import { type Centavos, formatarMoeda, percentual } from '../moeda.ts';
import { exigirInteiro, formatarPercentualTexto, lerData } from '../interno.ts';

export interface LimiteDispensa {
  norma: string;
  vigenteDesde: DataISO;
  obrasServicosEngenharia: Centavos;
  demais: Centavos;
}

export const LIMITES_DISPENSA: readonly LimiteDispensa[] = Object.freeze([
  { norma: 'Lei 14.133/2021, art. 75, I e II (valores originais)', vigenteDesde: '2021-04-01', obrasServicosEngenharia: 10_000_000, demais: 5_000_000 },
  { norma: 'Decreto 10.922/2021', vigenteDesde: '2022-01-01', obrasServicosEngenharia: 10_804_082, demais: 5_402_041 },
  { norma: 'Decreto 11.317/2022', vigenteDesde: '2023-01-01', obrasServicosEngenharia: 11_441_665, demais: 5_720_833 },
  { norma: 'Decreto 11.871/2023', vigenteDesde: '2024-01-01', obrasServicosEngenharia: 11_981_202, demais: 5_990_602 },
  { norma: 'Decreto 12.343/2024', vigenteDesde: '2025-01-01', obrasServicosEngenharia: 12_545_115, demais: 6_272_559 },
  // Decreto 12.807, de 29/12/2025 (DOU de 30/12/2025, Seção 1, p. 17), em vigor em 1º/1/2026: IPCA-E de 4,41%.
  { norma: 'Decreto 12.807/2025', vigenteDesde: '2026-01-01', obrasServicosEngenharia: 13_098_420, demais: 6_549_211 },
]);

export type TipoObjetoDispensa = 'obras_servicos_engenharia' | 'demais';

function incisoDoTipo(tipo: TipoObjetoDispensa): 'I' | 'II' {
  if (tipo === 'obras_servicos_engenharia') return 'I';
  if (tipo === 'demais') return 'II';
  throw new ErroDominio('TIPO_DISPENSA_INVALIDO', `Tipo de objeto inválido: ${String(tipo)}.`);
}

export function limiteDispensaVigente(
  data: DataISO,
  tipo: TipoObjetoDispensa,
  tabela: readonly LimiteDispensa[] = LIMITES_DISPENSA,
): { valor: Centavos; norma: string; vigenteDesde: DataISO; fundamento: string } {
  const inciso = incisoDoTipo(tipo);
  const alvo = lerData(data);
  let vigente: LimiteDispensa | undefined;
  for (const linha of tabela) {
    const desde = lerData(linha.vigenteDesde, 'vigenteDesde');
    if (desde <= alvo && (vigente === undefined || desde > lerData(vigente.vigenteDesde))) vigente = linha;
  }
  if (vigente === undefined) {
    throw new ErroDominio('LIMITE_INEXISTENTE', `Não há limite de dispensa vigente em ${formatarData(data)}.`);
  }
  const valor = tipo === 'obras_servicos_engenharia' ? vigente.obrasServicosEngenharia : vigente.demais;
  return {
    valor,
    norma: vigente.norma,
    vigenteDesde: vigente.vigenteDesde,
    fundamento: `Lei 14.133/2021, art. 75, ${inciso}, c/c art. 182 (${vigente.norma})`,
  };
}

/**
 * Soma as dispensas por valor de mesma natureza já realizadas no exercício pela unidade gestora com a nova
 * contratação e compara com o limite. risco: soma > limite; atencao: soma ≥ 80% do limite; senão sem_risco.
 * É sinal para análise: a decisão é do agente responsável.
 */
export function avaliarFracionamento(e: {
  data: DataISO;
  tipo: TipoObjetoDispensa;
  contratacoesMesmaNaturezaNoExercicio: Centavos[];
  novaContratacao: Centavos;
  tabela?: readonly LimiteDispensa[];
}): {
  somaComNova: Centavos;
  limite: Centavos;
  percentualDoLimite: number;
  sinal: 'sem_risco' | 'atencao' | 'risco';
  explicacao: string;
  fundamento: string;
} {
  if (!Array.isArray(e.contratacoesMesmaNaturezaNoExercicio)) {
    throw new ErroDominio('FRACIONAMENTO_INVALIDO', 'contratacoesMesmaNaturezaNoExercicio deve ser uma lista de valores.');
  }
  e.contratacoesMesmaNaturezaNoExercicio.forEach((v, i) => exigirInteiro(v, `contratacoesMesmaNaturezaNoExercicio[${i}]`, 'FRACIONAMENTO_INVALIDO', 0));
  exigirInteiro(e.novaContratacao, 'novaContratacao', 'FRACIONAMENTO_INVALIDO', 0);

  const vigente = limiteDispensaVigente(e.data, e.tipo, e.tabela);
  const limite = vigente.valor;
  const somaComNova = e.contratacoesMesmaNaturezaNoExercicio.reduce((acc, v) => acc + v, e.novaContratacao);
  const percentualDoLimite = percentual(somaComNova, limite);
  // Comparação inteira exata: soma ≥ 80% do limite ⇔ soma × 10 ≥ limite × 8.
  const sinal: 'sem_risco' | 'atencao' | 'risco' = somaComNova > limite ? 'risco' : somaComNova * 10 >= limite * 8 ? 'atencao' : 'sem_risco';

  const inciso = incisoDoTipo(e.tipo);
  const base = `Soma das dispensas por valor de mesma natureza no exercício, incluída a nova contratação: ${formatarMoeda(somaComNova)}, ou ${formatarPercentualTexto(percentualDoLimite)} do limite de ${formatarMoeda(limite)} do art. 75, ${inciso} (${vigente.norma}).`;
  const leitura = {
    risco: 'A soma ultrapassa o limite: há indício de fracionamento de despesa; avalie licitar o objeto ou outro fundamento legal de contratação.',
    atencao: 'A soma atingiu 80% ou mais do limite: acompanhe as próximas contratações de mesma natureza.',
    sem_risco: 'A soma está abaixo de 80% do limite.',
  }[sinal];
  const explicacao = `${base} ${leitura} O somatório considera o despendido no exercício pela unidade gestora com objetos do mesmo ramo de atividade. Sinal para análise; a decisão é do agente responsável.`;

  return { somaComNova, limite, percentualDoLimite, sinal, explicacao, fundamento: 'Lei 14.133/2021, art. 75, § 1º' };
}
