import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  LICENCA_DADOS_ABERTOS,
  centavosParaDecimal,
  gerarCsvDadosAbertos,
  prepararLinhasDadosAbertos,
  type ColunaDadosAbertos,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const COLUNAS: ColunaDadosAbertos[] = [
  { nome: 'id', tipo: 'identificador', descricao: 'Identificador do registro.' },
  { nome: 'objeto', tipo: 'texto', descricao: 'Objeto do contrato, em texto livre.' },
  { nome: 'parcelas', tipo: 'inteiro', descricao: 'Quantidade de parcelas.' },
  { nome: 'valor', tipo: 'decimal', descricao: 'Valor em reais, com ponto decimal.' },
  { nome: 'assinado_em', tipo: 'data', descricao: 'Data de assinatura (AAAA-MM-DD).' },
  { nome: 'ativo', tipo: 'booleano', descricao: 'Se o registro está ativo.' },
];

describe('centavosParaDecimal', () => {
  it('converte centavos inteiros em reais com duas casas, sem ponto flutuante', () => {
    assert.equal(centavosParaDecimal(123_456_789), '1234567.89');
    assert.equal(centavosParaDecimal(5), '0.05');
    assert.equal(centavosParaDecimal(0), '0.00');
    assert.equal(centavosParaDecimal(-150), '-1.50');
    assert.throws(() => centavosParaDecimal(1.5), comCodigo('VALOR_INVALIDO'));
  });
});

describe('gerarCsvDadosAbertos (RFC 4180)', () => {
  it('cabeçalho do dicionário, CRLF, aspas quando preciso e nulo como célula vazia', () => {
    const csv = gerarCsvDadosAbertos(COLUNAS, [
      { id: 'a1', objeto: 'Coletes, "nível III-A"\nlote 2', parcelas: 3, valor: '10.50', assinado_em: '2026-01-02', ativo: true },
      { id: 'a2', objeto: 'Rádios', parcelas: null, valor: '0.00', assinado_em: null, ativo: false },
    ]);
    assert.equal(
      csv,
      'id,objeto,parcelas,valor,assinado_em,ativo\r\n' + 'a1,"Coletes, ""nível III-A""\nlote 2",3,10.50,2026-01-02,true\r\n' + 'a2,Rádios,,0.00,,false\r\n',
    );
  });

  it('texto que começaria fórmula de planilha recebe apóstrofo', () => {
    const csv = gerarCsvDadosAbertos(COLUNAS.slice(0, 2), [{ id: 'x', objeto: '=HYPERLINK("http://exemplo.test")' }]);
    assert.ok(csv.includes(`"'=HYPERLINK(""http://exemplo.test"")"`));
  });

  it('tarja CPF, e-mail e telefone em texto e conta as células alteradas', () => {
    const { linhas, celulasTarjadas } = prepararLinhasDadosAbertos(COLUNAS.slice(0, 2), [
      { id: 'x', objeto: 'Contato do preposto: preposto@exemplo.test, (61) 99876-1234' },
      { id: 'y', objeto: 'Sem dado pessoal' },
    ]);
    assert.equal(celulasTarjadas, 1);
    assert.ok(!String(linhas[0]?.objeto).includes('preposto@exemplo.test'));
    assert.equal(linhas[1]?.objeto, 'Sem dado pessoal');
  });

  it('recusa valor fora do tipo do dicionário e dicionário malformado', () => {
    assert.throws(() => gerarCsvDadosAbertos(COLUNAS, [{ id: 'a', valor: 10.5 }]), comCodigo('VALOR_INVALIDO'));
    assert.throws(() => gerarCsvDadosAbertos(COLUNAS, [{ id: 'a', assinado_em: '02/01/2026' }]), comCodigo('VALOR_INVALIDO'));
    assert.throws(() => gerarCsvDadosAbertos([], []), comCodigo('DICIONARIO_INVALIDO'));
    assert.throws(() => gerarCsvDadosAbertos([{ nome: 'Valor Total', tipo: 'texto', descricao: 'Descrição suficiente.' }], []), comCodigo('DICIONARIO_INVALIDO'));
  });

  it('colunas fora do dicionário não saem no arquivo', () => {
    const csv = gerarCsvDadosAbertos(COLUNAS.slice(0, 1), [{ id: 'a', cpf: '00000000000' }]);
    assert.equal(csv, 'id\r\na\r\n');
  });

  it('licença aberta CC BY 4.0', () => {
    assert.equal(LICENCA_DADOS_ABERTOS.identificador, 'CC-BY-4.0');
  });
});
