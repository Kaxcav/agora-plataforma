/**
 * PDF dos documentos da jornada para uso interno (RF-32), gerado no servidor por `gerarPdfTexto`: o Markdown do
 * documento perde os marcadores internos (comentários HTML), as tabelas viram listas legíveis e os dados pessoais
 * escritos no texto saem tarjados (LGPD, art. 6º, III).
 */
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

function separador(linha: string | undefined): boolean {
  return linha !== undefined && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(linha);
}

/** Markdown do documento → texto simples que o gerador de PDF diagrama (títulos, listas e parágrafos). */
export function textoParaPdf(conteudo: string): string {
  const linhas = conteudo.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const saida: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? '';
    if (linha.trim().startsWith('|') && separador(linhas[i + 1])) {
      const cabecalho = celulas(linha);
      i += 1;
      while (i + 1 < linhas.length && (linhas[i + 1] ?? '').trim().startsWith('|')) {
        i += 1;
        const valores = celulas(linhas[i] ?? '');
        saida.push(`- ${valores.map((v, j) => (cabecalho[j] ? `${cabecalho[j]}: ${v}` : v)).join('; ')}`);
      }
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(linha)) {
      saida.push('');
      continue;
    }
    saida.push(
      linha
        .replace(/^>\s?/, '')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
        .replace(/\s{2,}$/, ''),
    );
  }
  return tarjarDadosPessoais(saida.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export function pdfDocumentoJornada(documento: { titulo: string; versao: number; conteudo: string; tipo: string }, numeroSei: string): { pdf: Buffer; nomeArquivo: string } {
  const titulo = `${documento.titulo} — processo ${numeroSei}`;
  const pdf = gerarPdfTexto({ titulo, rodape: `${documento.titulo} (versão ${documento.versao})`, conteudo: textoParaPdf(documento.conteudo) });
  return { pdf, nomeArquivo: `${documento.tipo.replaceAll('_', '-')}-v${documento.versao}-${numeroSei.replace(/[^0-9]/g, '')}.pdf` };
}
