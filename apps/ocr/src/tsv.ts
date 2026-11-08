/**
 * Interpretação da saída TSV do Tesseract (`tesseract imagem stdout tsv`): agrupa as palavras (nível 5) por bloco,
 * parágrafo e linha, na ordem em que o Tesseract as lê, e calcula a confiança média de cada linha.
 * Função pura, testada sem o Tesseract instalado.
 */

export interface LinhaOcr {
  texto: string;
  /** Confiança média das palavras (0 a 100); `null` se o Tesseract não informou. */
  confianca: number | null;
}

const COLUNAS = ['level', 'page_num', 'block_num', 'par_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'] as const;

export function linhasDoTsv(tsv: string): LinhaOcr[] {
  const registros = tsv.split(/\r?\n/);
  const cabecalho = (registros[0] ?? '').split('\t');
  const indice = (nome: (typeof COLUNAS)[number]) => {
    const i = cabecalho.indexOf(nome);
    return i >= 0 ? i : COLUNAS.indexOf(nome);
  };
  const [iNivel, iBloco, iPar, iLinha, iConf, iTexto] = [indice('level'), indice('block_num'), indice('par_num'), indice('line_num'), indice('conf'), indice('text')];
  const linhas = new Map<string, { palavras: string[]; notas: number[] }>();
  for (const registro of registros.slice(1)) {
    if (registro.trim() === '') continue;
    const campos = registro.split('\t');
    if (campos[iNivel] !== '5') continue;
    const texto = (campos[iTexto] ?? '').trim();
    if (texto === '') continue;
    const chave = `${campos[iBloco]}:${campos[iPar]}:${campos[iLinha]}`;
    const linha = linhas.get(chave) ?? { palavras: [], notas: [] };
    linha.palavras.push(texto);
    const nota = Number(campos[iConf]);
    if (Number.isFinite(nota) && nota >= 0) linha.notas.push(nota);
    linhas.set(chave, linha);
  }
  return [...linhas.values()].map((l) => ({
    texto: l.palavras.join(' '),
    confianca: l.notas.length === 0 ? null : Math.round((l.notas.reduce((a, b) => a + b, 0) / l.notas.length) * 100) / 100,
  }));
}

/** Média ponderada pelo número de linhas com nota. */
export function confiancaMedia(paginas: readonly { linhas: readonly LinhaOcr[] }[]): number | null {
  const notas = paginas.flatMap((p) => p.linhas.map((l) => l.confianca)).filter((n): n is number => n !== null);
  return notas.length === 0 ? null : Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100;
}

/** Tipo de entrada aceito pelo serviço, pela assinatura dos bytes (não pelo Content-Type). */
export function formatoEntrada(conteudo: Buffer): 'pdf' | 'png' | 'jpeg' | null {
  if (conteudo.length >= 5 && conteudo.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (conteudo.length >= 8 && conteudo[0] === 0x89 && conteudo.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (conteudo.length >= 3 && conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff) return 'jpeg';
  return null;
}
