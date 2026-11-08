import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { inspecionarPdf, lerTextoPdf, temCamadaDeTexto } from '../src/compartilhado/pdf-leitura.ts';
import { gerarPdfTexto } from '../src/compartilhado/pdf-texto.ts';
import { detectarFormato, disposicaoAnexo, sanitizarNomeArquivo } from '../src/compartilhado/tipo-arquivo.ts';

/** PDF a partir de objetos numerados (números ausentes ficam para o fluxo de objetos). */
function pdf(objetos: Map<number, Buffer | string>): Buffer {
  const partes: Buffer[] = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  for (const [n, corpo] of [...objetos.entries()].sort((a, b) => a[0] - b[0])) {
    partes.push(Buffer.from(`${n} 0 obj\n`, 'latin1'), typeof corpo === 'string' ? Buffer.from(corpo, 'latin1') : corpo, Buffer.from('\nendobj\n', 'latin1'));
  }
  partes.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'));
  return Buffer.concat(partes);
}

function fluxo(dicionario: string, dados: Buffer | string, comprimir = true): Buffer {
  const bruto = typeof dados === 'string' ? Buffer.from(dados, 'latin1') : dados;
  const conteudo = comprimir ? deflateSync(bruto) : bruto;
  return Buffer.concat([
    Buffer.from(`<< ${dicionario} /Length ${conteudo.length}${comprimir ? ' /Filter /FlateDecode' : ''} >>\nstream\n`, 'latin1'),
    conteudo,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/** Fluxo de objetos (/ObjStm) com os objetos indicados. */
function fluxoDeObjetos(objetos: [number, string][]): Buffer {
  let corpo = '';
  const cabecalho: string[] = [];
  for (const [n, texto] of objetos) {
    cabecalho.push(`${n} ${corpo.length}`);
    corpo += `${texto}\n`;
  }
  const inicio = `${cabecalho.join(' ')}\n`;
  return fluxo(`/Type /ObjStm /N ${objetos.length} /First ${inicio.length}`, inicio + corpo);
}

const hex = (texto: string) => `<${[...texto].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`;

const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '1 beginbfrange <0020> <007E> <0020> endbfrange',
  'endcmap CMapName currentdict /CMap defineresource pop end end',
].join('\n');

describe('lerTextoPdf — camada de texto sem dependências', () => {
  test('lê o PDF gerado pela própria Ágora, com acentos, por página e linha', () => {
    const documento = gerarPdfTexto({
      titulo: 'Atestado',
      conteudo: '# ATESTADO DE CAPACIDADE TÉCNICA\n\nAtestamos a execução satisfatória do fornecimento de 1.200 (mil e duzentos) coletes balísticos.\n\n- Município: São João; prazo cumprido.',
    });
    const r = lerTextoPdf(documento);
    assert.equal(r.criptografado, false);
    assert.equal(r.paginas.length, 1);
    assert.deepEqual(r.paginas[0]?.linhas.slice(0, 3), [
      'ATESTADO DE CAPACIDADE TÉCNICA',
      'Atestamos a execução satisfatória do fornecimento de 1.200 (mil e duzentos) coletes balísticos.',
      '• Município: São João; prazo cumprido.',
    ]);
    assert.equal(temCamadaDeTexto(r), true);
  });

  test('fonte composta com /ToUnicode, kerning do TJ, /Differences, formulário e objetos em /ObjStm', () => {
    const conteudo = [
      'BT /F1 12 Tf 1 0 0 1 72 700 Tm',
      `${hex('Total: ')} Tj`,
      `[${hex('9')} -100 ${hex('2')} 0 ${hex('5')}] TJ`,
      `[-600 ${hex('PF')}] TJ`,
      '0 -20 Td /F2 12 Tf (ExecuABo do contrato) Tj',
      'ET',
      'q 1 0 0 1 0 -60 cm /Fm1 Do Q',
    ].join('\n');
    const objetos = new Map<number, Buffer | string>([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 9 0 R >> /XObject << /Fm1 8 0 R >> >> /Contents 5 0 R >>'],
      [5, fluxo('', conteudo)],
      [7, fluxo('', TO_UNICODE)],
      [8, fluxo('/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Resources << /Font << /F2 9 0 R >> >>', 'BT /F2 10 Tf 72 700 Td (Texto no formul\\341rio) Tj ET')],
      [
        10,
        fluxoDeObjetos([
          [4, '<< /Type /Font /Subtype /Type0 /BaseFont /Sintetica /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>'],
          [6, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Sintetica /DW 500 >>'],
          [9, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /ccedilla /atilde] >> >>'],
        ]),
      ],
    ]);
    const r = lerTextoPdf(pdf(objetos));
    assert.deepEqual(r.paginas[0]?.linhas, ['Total: 925 PF', 'Execução do contrato', 'Texto no formulário']);
  });

  test('PDF só com imagem não tem camada de texto; PDF criptografado não é decifrado', () => {
    const imagem = pdf(
      new Map<number, Buffer | string>([
        [1, '<< /Type /Catalog /Pages 2 0 R >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'],
        [4, fluxo('', 'q 100 0 0 100 0 0 cm /Im1 Do Q')],
        [5, fluxo('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8', Buffer.from([0, 255, 255, 0]), false)],
      ]),
    );
    const r = lerTextoPdf(imagem);
    assert.equal(r.paginas.length, 1);
    assert.equal(temCamadaDeTexto(r), false);

    const cifrado = Buffer.concat([gerarPdfTexto({ titulo: 'x', conteudo: 'texto' }), Buffer.from('trailer\n<< /Root 1 0 R /Encrypt 99 0 R >>\n%%EOF\n', 'latin1')]);
    assert.equal(lerTextoPdf(cifrado).criptografado, true);
    assert.equal(inspecionarPdf(cifrado).criptografado, true);
  });

  test('não lança com PDF truncado ou lixo', () => {
    const inteiro = gerarPdfTexto({ titulo: 'x', conteudo: 'Um texto qualquer para cortar no meio.' });
    assert.doesNotThrow(() => lerTextoPdf(inteiro.subarray(0, Math.floor(inteiro.length / 2))));
    assert.deepEqual(lerTextoPdf(Buffer.from('%PDF-1.4 lixo')).paginas, []);
  });
});

describe('inspecionarPdf — conteúdo ativo', () => {
  test('acha JavaScript, inclusive escondido em fluxo de objetos e com nome escapado', () => {
    const escondido = pdf(
      new Map<number, Buffer | string>([
        [1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R >>'],
        [5, fluxoDeObjetos([[4, '<< /S /Java#53cript /JS (app.alert\\(1\\)) >>']])],
      ]),
    );
    const r = inspecionarPdf(escondido);
    assert.equal(r.paginas, 1);
    assert.deepEqual(r.ativos, ['JS', 'JavaScript']);
    assert.deepEqual(inspecionarPdf(gerarPdfTexto({ titulo: 'ok', conteudo: 'limpo' })).ativos, []);
  });
});

describe('tipo de arquivo pelo conteúdo e nome seguro', () => {
  test('assinaturas de PDF, PNG e JPEG; o resto é recusado', () => {
    assert.equal(detectarFormato(gerarPdfTexto({ titulo: 'a', conteudo: 'b' })), 'pdf');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(13)]);
    assert.equal(detectarFormato(png), 'png');
    assert.equal(detectarFormato(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'jpeg');
    assert.equal(detectarFormato(Buffer.from('MZ\x90\x00executavel', 'latin1')), null);
    assert.equal(detectarFormato(Buffer.from('PK\x03\x04zip', 'latin1')), null);
    assert.equal(detectarFormato(Buffer.from('<html>%PDF-1.4</html>')), null);
  });

  test('nome sem diretórios nem controle; Content-Disposition com reserva ASCII', () => {
    assert.equal(sanitizarNomeArquivo(encodeURIComponent('../../etc/passwd')), 'passwd');
    assert.equal(sanitizarNomeArquivo(encodeURIComponent('C:\\Users\\x\\Atestado nº 3.pdf')), 'Atestado nº 3.pdf');
    assert.equal(sanitizarNomeArquivo('%E0%A4%A'), '%E0%A4%A');
    assert.equal(sanitizarNomeArquivo(undefined), 'documento');
    assert.equal(disposicaoAnexo('Atestado nº 3.pdf', 'pdf'), `attachment; filename="Atestado n 3.pdf"; filename*=UTF-8''${encodeURIComponent('Atestado nº 3.pdf')}`);
    assert.match(disposicaoAnexo('foto', 'jpeg'), /filename="foto\.jpg"/);
  });
});
