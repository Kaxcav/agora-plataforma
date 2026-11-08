import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { gerarPdfTexto } from '../src/compartilhado/pdf-texto.ts';

const DOCUMENTO = {
  titulo: 'Edital de licitação — exemplo',
  rodape: 'Edital — processo 08000.000000/2026-00',
  conteudo: [
    '# Edital de pregão eletrônico nº 1/2026',
    '',
    '## 1. Objeto',
    'Aquisição de coletes balísticos nível III-A, conforme o termo de referência (art. 6º, XXIII, da Lei 14.133/2021). Preço máximo: R$ 3.505.560,00.',
    '',
    '- Habilitação econômico-financeira sem exigência de faturamento mínimo (art. 69, § 2º).',
    '- Prova de conceito do primeiro colocado (art. 17, § 3º).',
    '',
    ...Array.from({ length: 160 }, (_, i) => `Cláusula ${i + 1}. Texto de exemplo com acentuação — ação, opção, ênfase, "aspas" e (parênteses) para conferir a quebra de linha.`),
  ].join('\n'),
};

function objetosPdf(pdf: Buffer): string {
  return pdf.toString('latin1');
}

describe('gerador de PDF de texto', () => {
  test('estrutura válida: cabeçalho, objetos nas posições do xref, startxref e EOF', () => {
    const pdf = gerarPdfTexto(DOCUMENTO);
    const texto = objetosPdf(pdf);
    assert.ok(texto.startsWith('%PDF-1.4\n'));
    assert.ok(texto.trimEnd().endsWith('%%EOF'));
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(texto)?.[1]);
    assert.equal(texto.slice(startxref, startxref + 4), 'xref');
    const entradas = [...texto.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.ok(entradas.length >= 7);
    entradas.forEach((deslocamento, i) => assert.ok(texto.startsWith(`${i + 1} 0 obj`, deslocamento), `objeto ${i + 1}`));
  });

  test('várias páginas numeradas; acentos em WinAnsi; parênteses escapados', () => {
    const pdf = gerarPdfTexto(DOCUMENTO);
    const texto = objetosPdf(pdf);
    const total = Number(/\/Type \/Pages \/Count (\d+)/.exec(texto)?.[1]);
    assert.ok(total >= 3, `páginas: ${total}`);
    const fluxos = [...texto.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1'));
    assert.equal(fluxos.length, total);
    assert.match(fluxos[0] ?? '', /\(Edital de preg\\343o eletr\\364nico n\\272 1\/2026\) Tj/);
    assert.match(fluxos[0] ?? '', /\\227/, 'travessão em WinAnsi (0x97)');
    assert.match(fluxos.join('\n'), /\\\(par\\352nteses\\\)/);
    assert.match(fluxos[total - 1] ?? '', new RegExp(`P\\\\341gina ${total} de ${total}`));
  });

  test('linhas dentro da margem e saída determinística', () => {
    const a = gerarPdfTexto(DOCUMENTO);
    const b = gerarPdfTexto(DOCUMENTO);
    assert.ok(a.equals(b));
    const fluxo = inflateSync(Buffer.from(/stream\n([\s\S]*?)\nendstream/.exec(objetosPdf(a))?.[1] ?? '', 'latin1')).toString('latin1');
    for (const m of fluxo.matchAll(/BT \/F[12] [\d.]+ Tf ([\d.]+) ([\d.]+) Td/g)) {
      assert.ok(Number(m[1]) >= 56 && Number(m[2]) >= 56, `posição ${m[1]},${m[2]}`);
    }
  });
});
