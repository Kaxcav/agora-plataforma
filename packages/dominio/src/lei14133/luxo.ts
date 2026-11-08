/**
 * Sinal de possível artigo de luxo (Lei 14.133/2021, art. 20; Decreto 10.818/2021).
 * Os itens de consumo devem ser de qualidade comum, não superior à necessária, vedada a aquisição de artigos de luxo.
 * A função apenas sinaliza: a classificação final é do agente responsável.
 */
import { ErroDominio } from '../erros.ts';

export const TERMOS_INDICATIVOS_LUXO: readonly string[] = Object.freeze([
  'luxo',
  'premium',
  'gourmet',
  'grife',
  'cristal',
  'ouro',
  'banhado a ouro',
  'seda pura',
  'couro legítimo',
  'champanhe',
  'caviar',
  'importado de luxo',
  'edição limitada',
  'alto padrão',
  'design exclusivo',
]);

/** Sem acentos, minúsculas, pontuação vira espaço, espaços colapsados. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Busca termos por palavra ou expressão inteira, sem distinção de acentos e de maiúsculas. */
export function sinalizarArtigoLuxo(
  descricao: string,
  termos: readonly string[] = TERMOS_INDICATIVOS_LUXO,
): { sinal: 'sem_indicio' | 'possivel_artigo_luxo'; termosEncontrados: string[]; orientacao: string; fundamento: string } {
  if (typeof descricao !== 'string') throw new ErroDominio('DESCRICAO_INVALIDA', 'A descrição do item deve ser um texto.');
  const texto = ` ${normalizar(descricao)} `;
  const termosEncontrados: string[] = [];
  for (const termo of termos) {
    const alvo = normalizar(termo);
    if (alvo.length > 0 && texto.includes(` ${alvo} `) && !termosEncontrados.includes(termo)) termosEncontrados.push(termo);
  }
  const possivel = termosEncontrados.length > 0;
  return {
    sinal: possivel ? 'possivel_artigo_luxo' : 'sem_indicio',
    termosEncontrados,
    orientacao: possivel
      ? `A descrição contém ${termosEncontrados.length === 1 ? 'termo indicativo' : 'termos indicativos'} de artigo de luxo (${termosEncontrados.join(', ')}). Exija justificativa de que o bem é de qualidade comum, não superior à necessária para a finalidade, ou de que se enquadra em exceção prevista no Decreto 10.818/2021. A classificação final é do agente responsável.`
      : 'Nenhum termo indicativo de artigo de luxo foi encontrado. A verificação é automática e não substitui a análise do agente responsável.',
    fundamento: 'Lei 14.133/2021, art. 20; Decreto 10.818/2021',
  };
}
