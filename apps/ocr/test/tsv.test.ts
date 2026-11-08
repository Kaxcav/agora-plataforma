import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { confiancaMedia, formatoEntrada, linhasDoTsv } from '../src/tsv.ts';

const CABECALHO = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const palavra = (bloco: number, linha: number, n: number, conf: number, texto: string) => `5\t1\t${bloco}\t1\t${linha}\t${n}\t10\t10\t10\t10\t${conf}\t${texto}`;

describe('linhasDoTsv', () => {
  test('agrupa palavras por linha, na ordem do Tesseract, com a confiança média', () => {
    const tsv = [
      CABECALHO,
      '1\t1\t0\t0\t0\t0\t0\t0\t2480\t3508\t-1\t',
      '4\t1\t1\t1\t1\t0\t10\t10\t500\t40\t-1\t',
      palavra(1, 1, 1, 96, 'ATESTADO'),
      palavra(1, 1, 2, 90, 'DE'),
      palavra(1, 2, 1, 80, 'Fornecimento'),
      palavra(1, 2, 2, 70, 'de'),
      palavra(1, 2, 3, 90, '350'),
      palavra(1, 2, 4, 84, 'coletes.'),
      palavra(2, 1, 1, -1, ' '),
      '',
    ].join('\n');
    assert.deepEqual(linhasDoTsv(tsv), [
      { texto: 'ATESTADO DE', confianca: 93 },
      { texto: 'Fornecimento de 350 coletes.', confianca: 81 },
    ]);
  });

  test('TSV vazio ou só com cabeçalho → nenhuma linha; confiança média das páginas', () => {
    assert.deepEqual(linhasDoTsv(''), []);
    assert.deepEqual(linhasDoTsv(CABECALHO), []);
    assert.equal(confiancaMedia([{ linhas: [{ texto: 'a', confianca: 90 }, { texto: 'b', confianca: null }] }, { linhas: [{ texto: 'c', confianca: 70 }] }]), 80);
    assert.equal(confiancaMedia([]), null);
  });
});

describe('formatoEntrada', () => {
  test('aceita só PDF, PNG e JPEG pela assinatura', () => {
    assert.equal(formatoEntrada(Buffer.from('%PDF-1.7\n')), 'pdf');
    assert.equal(formatoEntrada(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
    assert.equal(formatoEntrada(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), 'jpeg');
    assert.equal(formatoEntrada(Buffer.from('GIF89a')), null);
  });
});
