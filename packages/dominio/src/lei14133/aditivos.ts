/**
 * Limites de alterações unilaterais (Lei 14.133/2021, art. 125).
 *
 * O contratado é obrigado a aceitar acréscimos ou supressões de até 25% do valor inicial atualizado do contrato;
 * em reforma de edifício ou de equipamento, o limite para acréscimos é de 50%. Acréscimos e supressões são
 * computados separadamente, sem compensação entre si (jurisprudência do TCU).
 */
import { ErroDominio } from '../erros.ts';
import { type Centavos, formatarMoeda, percentual } from '../moeda.ts';
import { exigirInteiro, formatarPercentualTexto } from '../interno.ts';

export function avaliarAditivo(e: {
  valorInicialAtualizado: Centavos;
  acrescimosAnteriores: Centavos;
  supressoesAnteriores: Centavos;
  tipo: 'acrescimo' | 'supressao';
  valor: Centavos;
  reformaEdificioOuEquipamento?: boolean;
}): {
  percentualAcumulado: number;
  limitePercentual: number;
  permitido: boolean;
  margemRestante: Centavos;
  explicacao: string;
  fundamento: string;
} {
  exigirInteiro(e.valorInicialAtualizado, 'valorInicialAtualizado', 'ADITIVO_INVALIDO', 1);
  exigirInteiro(e.acrescimosAnteriores, 'acrescimosAnteriores', 'ADITIVO_INVALIDO', 0);
  exigirInteiro(e.supressoesAnteriores, 'supressoesAnteriores', 'ADITIVO_INVALIDO', 0);
  exigirInteiro(e.valor, 'valor', 'ADITIVO_INVALIDO', 0);
  if (e.tipo !== 'acrescimo' && e.tipo !== 'supressao') {
    throw new ErroDominio('ADITIVO_INVALIDO', `Tipo de alteração inválido: ${String(e.tipo)}.`);
  }

  const ehAcrescimo = e.tipo === 'acrescimo';
  const reforma = e.reformaEdificioOuEquipamento === true;
  const limitePercentual = ehAcrescimo && reforma ? 50 : 25;
  const anteriores = ehAcrescimo ? e.acrescimosAnteriores : e.supressoesAnteriores;
  const acumulado = anteriores + e.valor;
  // Comparação inteira exata: acumulado ≤ valor × limite / 100.
  const permitido = acumulado * 100 <= e.valorInicialAtualizado * limitePercentual;
  const limiteValor = Math.floor((e.valorInicialAtualizado * limitePercentual) / 100);
  const margemRestante = Math.max(0, limiteValor - acumulado);
  const percentualAcumulado = percentual(acumulado, e.valorInicialAtualizado, 2);

  const rotulo = ehAcrescimo ? 'Acréscimos' : 'Supressões';
  const regraLimite = ehAcrescimo && reforma ? '50% (reforma de edifício ou de equipamento)' : '25%';
  const resumo = `${rotulo} acumulados, incluída esta alteração: ${formatarMoeda(acumulado)}, ou ${formatarPercentualTexto(percentualAcumulado)} do valor inicial atualizado de ${formatarMoeda(e.valorInicialAtualizado)}. Limite: ${regraLimite}, equivalente a ${formatarMoeda(limiteValor)}.`;
  const resultado = permitido
    ? `Dentro do limite; margem restante de ${formatarMoeda(margemRestante)}.`
    : `Excede o limite em ${formatarMoeda(acumulado - limiteValor)}; o contratado não é obrigado a aceitar a alteração unilateral.`;
  const explicacao = `${resumo} ${resultado} Acréscimos e supressões são computados separadamente, sem compensação entre si.`;

  return { percentualAcumulado, limitePercentual, permitido, margemRestante, explicacao, fundamento: 'Lei 14.133/2021, art. 125' };
}
