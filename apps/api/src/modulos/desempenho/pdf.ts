/**
 * Prepara o Markdown dos documentos de desempenho para o gerador de PDF de texto (`gerarPdfTexto`), que entende
 * títulos, parágrafos e listas: cada linha de tabela vira um item de lista com os rótulos das colunas; citações
 * perdem o ">" e as linhas horizontais somem.
 */
function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function markdownParaPdf(markdown: string): string {
  const saida: string[] = [];
  let cabecalho: string[] | null = null;
  for (const linha of markdown.split(/\r?\n/)) {
    const t = linha.trim();
    if (t.startsWith('|')) {
      const partes = celulas(t);
      if (partes.every((p) => /^:?-{3,}:?$/.test(p))) continue;
      if (cabecalho === null) {
        cabecalho = partes;
        continue;
      }
      const [primeira, ...resto] = partes;
      const rotulos = cabecalho.slice(1);
      saida.push(`- ${primeira ?? ''}: ${resto.map((v, i) => `${rotulos[i] ?? ''} ${v}`.trim()).join('; ')}`);
      continue;
    }
    cabecalho = null;
    if (/^-{3,}$/.test(t)) {
      saida.push('');
      continue;
    }
    saida.push(t.startsWith('> ') ? t.slice(2) : linha);
  }
  return saida.join('\n');
}
