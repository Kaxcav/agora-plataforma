/**
 * Gerador de PDF de texto, sem dependências: documentos da jornada (edital, TR, minuta) em A4, com títulos,
 * listas e numeração de páginas. Usa as fontes padrão Helvetica (não precisam ser embutidas) com WinAnsiEncoding,
 * que cobre o português. Determinístico: o mesmo conteúdo gera o mesmo arquivo (o hash enviado ao PNCP é reproduzível).
 */
import { deflateSync } from 'node:zlib';

const LARGURA_PAGINA = 595.28;
const ALTURA_PAGINA = 841.89;
const MARGEM = 56;
const LARGURA_UTIL = LARGURA_PAGINA - 2 * MARGEM;
const RODAPE = 32;

/** Larguras da Helvetica (AFM, milésimos de em) para ASCII 32–126. */
const LARGURAS_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722,
  500, 500, 500, 334, 260, 334, 584,
];

/** Caracteres de WinAnsiEncoding fora do Latin-1 (0x80–0x9F) e as suas larguras na Helvetica. */
const WIN_ANSI_EXTRA: Record<string, [number, number]> = {
  '€': [0x80, 556],
  '‚': [0x82, 222],
  '„': [0x84, 333],
  '…': [0x85, 1000],
  '†': [0x86, 556],
  '‡': [0x87, 556],
  '‰': [0x89, 1000],
  '‘': [0x91, 222],
  '’': [0x92, 222],
  '“': [0x93, 333],
  '”': [0x94, 333],
  '•': [0x95, 350],
  '–': [0x96, 556],
  '—': [0x97, 1000],
  '™': [0x99, 1000],
};

/** Substituições para caracteres sem glifo em WinAnsi. */
const SUBSTITUICOES: Record<string, string> = { '≥': '>=', '≤': '<=', '≠': '!=', '→': '->', '←': '<-', '×': 'x', ' ': ' ', '\t': '    ' };

/** Largura aproximada de letras acentuadas e símbolos do Latin-1: a da letra base (ou 556). */
function larguraLatin1(ch: string): number {
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (base.length === 1 && base.charCodeAt(0) >= 32 && base.charCodeAt(0) <= 126) return LARGURAS_ASCII[base.charCodeAt(0) - 32] ?? 556;
  const especiais: Record<string, number> = { 'º': 365, 'ª': 370, '§': 556, '°': 400, '«': 556, '»': 556, '·': 278, '©': 737, '®': 737 };
  return especiais[ch] ?? 556;
}

function normalizarTexto(texto: string): string {
  let saida = '';
  for (const ch of texto.normalize('NFC')) saida += SUBSTITUICOES[ch] ?? ch;
  return saida;
}

/** Código WinAnsi e largura de um caractere; caracteres sem representação viram "?". */
function glifo(ch: string): [number, number] {
  const codigo = ch.charCodeAt(0);
  if (codigo >= 32 && codigo <= 126) return [codigo, LARGURAS_ASCII[codigo - 32] ?? 556];
  const extra = WIN_ANSI_EXTRA[ch];
  if (extra) return extra;
  if (codigo >= 0xa0 && codigo <= 0xff) return [codigo, larguraLatin1(ch)];
  return [0x3f, 556];
}

function larguraTexto(texto: string, tamanho: number, negrito: boolean): number {
  let total = 0;
  for (const ch of texto) total += glifo(ch)[1];
  return (total * tamanho * (negrito ? 1.06 : 1)) / 1000;
}

/** String literal de PDF em WinAnsi, com escapes. */
function literal(texto: string): string {
  let saida = '(';
  for (const ch of texto) {
    const [codigo] = glifo(ch);
    if (codigo === 0x28 || codigo === 0x29 || codigo === 0x5c) saida += `\\${String.fromCharCode(codigo)}`;
    else if (codigo < 32 || codigo > 126) saida += `\\${codigo.toString(8).padStart(3, '0')}`;
    else saida += String.fromCharCode(codigo);
  }
  return `${saida})`;
}

/** Texto de metadados (dicionário Info): UTF-16BE com marca de ordem, como manda a especificação para qualquer caractere. */
function textoMetadado(texto: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < texto.length; i++) hex += texto.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function quebrarLinhas(texto: string, largura: number, tamanho: number, negrito: boolean): string[] {
  const linhas: string[] = [];
  let atual = '';
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual === '' ? palavra : `${atual} ${palavra}`;
    if (larguraTexto(tentativa, tamanho, negrito) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual !== '') linhas.push(atual);
    // Palavra maior que a linha (URL, identificador): quebra em pedaços.
    let resto = palavra;
    while (larguraTexto(resto, tamanho, negrito) > largura) {
      let corte = resto.length - 1;
      while (corte > 1 && larguraTexto(resto.slice(0, corte), tamanho, negrito) > largura) corte--;
      linhas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    atual = resto;
  }
  if (atual !== '') linhas.push(atual);
  return linhas;
}

interface Linha {
  texto: string;
  tamanho: number;
  negrito: boolean;
  recuo: number;
  espacoAntes: number;
}

/** Converte o texto (Markdown simples: #, ##, ###, listas com "-" ou "*", negrito com **) em linhas posicionáveis. */
function diagramar(conteudo: string): Linha[] {
  const linhas: Linha[] = [];
  let paragrafo: string[] = [];
  const despejar = () => {
    if (paragrafo.length === 0) return;
    quebrarLinhas(paragrafo.join(' '), LARGURA_UTIL, 10.5, false).forEach((t, i) => linhas.push({ texto: t, tamanho: 10.5, negrito: false, recuo: 0, espacoAntes: i === 0 ? 6 : 0 }));
    paragrafo = [];
  };
  for (const bruta of normalizarTexto(conteudo).split(/\r?\n/)) {
    const linha = bruta.replace(/\*\*(.+?)\*\*/g, '$1').trimEnd();
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linha);
    const item = /^\s*[-*]\s+(.*)$/.exec(linha);
    if (titulo) {
      despejar();
      const nivel = titulo[1]?.length ?? 1;
      const tamanho = nivel === 1 ? 15 : nivel === 2 ? 12.5 : 11;
      quebrarLinhas(titulo[2] ?? '', LARGURA_UTIL, tamanho, true).forEach((t, i) => linhas.push({ texto: t, tamanho, negrito: true, recuo: 0, espacoAntes: i === 0 ? (nivel === 1 ? 4 : 14) : 0 }));
    } else if (item) {
      despejar();
      quebrarLinhas(item[1] ?? '', LARGURA_UTIL - 14, 10.5, false).forEach((t, i) =>
        linhas.push({ texto: i === 0 ? `• ${t}` : t, tamanho: 10.5, negrito: false, recuo: i === 0 ? 4 : 14, espacoAntes: i === 0 ? 3 : 0 }),
      );
    } else if (linha.trim() === '') {
      despejar();
    } else {
      paragrafo.push(linha.trim());
    }
  }
  despejar();
  return linhas;
}

export interface DocumentoPdf {
  titulo: string;
  conteudo: string;
  /** Texto do rodapé à esquerda (ex.: "Edital — processo 08000.000000/2026-00"). */
  rodape?: string;
  /**
   * Marcação de documento classificado nos cabeçalhos e rodapés de todas as páginas (Decreto 7.845/2012, art. 23):
   * grau de sigilo no cabeçalho e fundamento e termo final acima do rodapé.
   */
  marcacao?: { cabecalho: string; rodape: string };
}

/** Gera o PDF (PDF 1.4) do documento. */
export function gerarPdfTexto(documento: DocumentoPdf): Buffer {
  const linhas = diagramar(documento.conteudo);
  const marcacao = documento.marcacao;
  const linhasMarcacaoRodape = marcacao ? quebrarLinhas(normalizarTexto(marcacao.rodape), LARGURA_UTIL, 7, false).slice(0, 2) : [];
  const topo = ALTURA_PAGINA - MARGEM - (marcacao ? 22 : 0);
  const base = MARGEM + RODAPE + linhasMarcacaoRodape.length * 9;
  const paginas: string[][] = [[]];
  let y = topo;
  for (const l of linhas) {
    const altura = l.tamanho * 1.38 + l.espacoAntes;
    if (y - altura < base) {
      paginas.push([]);
      y = topo;
    }
    y -= altura;
    const fonte = l.negrito ? 'F2' : 'F1';
    paginas[paginas.length - 1]?.push(`BT /${fonte} ${l.tamanho} Tf ${(MARGEM + l.recuo).toFixed(2)} ${y.toFixed(2)} Td ${literal(l.texto)} Tj ET`);
  }

  const total = paginas.length;
  const rodapeEsquerda = normalizarTexto(documento.rodape ?? documento.titulo).slice(0, 110);
  const conteudos = paginas.map((comandos, i) => {
    const numero = `Página ${i + 1} de ${total}`;
    const xNumero = LARGURA_PAGINA - MARGEM - larguraTexto(numero, 8, false);
    const rodape = [
      '0.6 0.6 0.6 RG 0.5 w',
      `${MARGEM} ${MARGEM + 12} m ${LARGURA_PAGINA - MARGEM} ${MARGEM + 12} l S`,
      '0.35 0.35 0.35 rg',
      `BT /F1 8 Tf ${MARGEM} ${MARGEM} Td ${literal(rodapeEsquerda)} Tj ET`,
      `BT /F1 8 Tf ${xNumero.toFixed(2)} ${MARGEM} Td ${literal(numero)} Tj ET`,
      '0 0 0 rg',
    ];
    if (marcacao) {
      const cabecalho = normalizarTexto(marcacao.cabecalho).slice(0, 110);
      const xCabecalho = Math.max(MARGEM, (LARGURA_PAGINA - larguraTexto(cabecalho, 9, true)) / 2);
      rodape.push(
        '0.55 0 0 rg 0.55 0 0 RG 0.8 w',
        `BT /F2 9 Tf ${xCabecalho.toFixed(2)} ${(ALTURA_PAGINA - MARGEM + 4).toFixed(2)} Td ${literal(cabecalho)} Tj ET`,
        `${MARGEM} ${(ALTURA_PAGINA - MARGEM - 2).toFixed(2)} m ${LARGURA_PAGINA - MARGEM} ${(ALTURA_PAGINA - MARGEM - 2).toFixed(2)} l S`,
        ...linhasMarcacaoRodape.map((t, j) => `BT /F1 7 Tf ${MARGEM} ${(MARGEM + 16 + (linhasMarcacaoRodape.length - 1 - j) * 9).toFixed(2)} Td ${literal(t)} Tj ET`),
        '0 0 0 rg 0 0 0 RG',
      );
    }
    return deflateSync(Buffer.from([...comandos, ...rodape].join('\n'), 'latin1'));
  });

  // Objetos: 1 catálogo, 2 páginas, 3 Helvetica, 4 Helvetica-Bold, 5 Info, depois (página, conteúdo) por página.
  const objetos: Buffer[] = [];
  const idPagina = (i: number) => 6 + i * 2;
  const idConteudo = (i: number) => 7 + i * 2;
  objetos.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  objetos.push(Buffer.from(`<< /Type /Pages /Count ${total} /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] >>`, 'latin1'));
  objetos.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', 'latin1'));
  objetos.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>', 'latin1'));
  objetos.push(Buffer.from(`<< /Title ${textoMetadado(documento.titulo.normalize('NFC'))} /Producer ${textoMetadado('Ágora — plataforma de contratações públicas')} >>`, 'latin1'));
  conteudos.forEach((fluxo, i) => {
    objetos.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA_PAGINA} ${ALTURA_PAGINA}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo(i)} 0 R >>`,
        'latin1',
      ),
    );
    objetos.push(Buffer.concat([Buffer.from(`<< /Length ${fluxo.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), fluxo, Buffer.from('\nendstream', 'latin1')]));
  });

  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const deslocamentos: number[] = [];
  let posicao = partes[0]?.length ?? 0;
  objetos.forEach((corpo, i) => {
    const bloco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), corpo, Buffer.from('\nendobj\n', 'latin1')]);
    deslocamentos.push(posicao);
    partes.push(bloco);
    posicao += bloco.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`, ...deslocamentos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`)].join('');
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${posicao}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}
