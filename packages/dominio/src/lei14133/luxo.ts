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

/**
 * Trava da geração de minutas (roteiro PoC-01; Lei 14.133/2021, art. 20): enquanto algum item do DFD tiver indício de
 * artigo de luxo sem justificativa aceita, nenhuma minuta é gerada (DFD, ETP, matriz de riscos, nota técnica, TR,
 * edital, contrato), inclusive com a redação por IA ligada. A justificativa é aceita quando demonstra, com pelo menos
 * `minimoCaracteres`, que o bem é de qualidade comum ou se enquadra em exceção do Decreto 10.818/2021 — o mesmo
 * critério que libera o avanço da etapa 1. A trava não classifica o bem: só impede a redação até a decisão humana.
 */
export function avaliarBloqueioLuxoMinutas(
  itens: readonly { descricao: string }[],
  justificativa: string | null,
  minimoCaracteres = 30,
): { bloqueado: boolean; itens: { item: number; termos: string[] }[]; mensagem: string; fundamento: string } {
  if (!Array.isArray(itens)) throw new ErroDominio('ITENS_INVALIDOS', 'Informe a lista de itens do DFD.');
  const comIndicio = itens.flatMap((item, indice) => {
    const sinal = sinalizarArtigoLuxo(item.descricao);
    return sinal.sinal === 'possivel_artigo_luxo' ? [{ item: indice + 1, termos: sinal.termosEncontrados }] : [];
  });
  const aceita = (justificativa ?? '').trim().length >= minimoCaracteres;
  const bloqueado = comIndicio.length > 0 && !aceita;
  const descricaoItens = comIndicio.map((x) => `item ${x.item} (${x.termos.map((t) => `"${t}"`).join(', ')})`).join('; ');
  let mensagem = 'Nenhum indício de artigo de luxo nos itens do DFD.';
  if (bloqueado) {
    mensagem = `Geração de minutas bloqueada: indício de artigo de luxo sem justificativa aceita no ${descricaoItens}. Justifique no DFD que o bem é de qualidade comum ou se enquadra em exceção do Decreto 10.818/2021 (mínimo de ${minimoCaracteres} caracteres), ou remova o item, e gere a minuta novamente.`;
  } else if (comIndicio.length > 0) {
    mensagem = `Indício de artigo de luxo no ${descricaoItens}, com justificativa registrada: a geração de minutas está liberada.`;
  }
  return { bloqueado, itens: comIndicio, mensagem, fundamento: 'Lei 14.133/2021, art. 20; Decreto 10.818/2021' };
}
