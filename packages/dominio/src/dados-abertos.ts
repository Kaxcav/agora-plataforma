/**
 * Dados abertos (Decreto 8.777/2016; Lei 12.527/2011, art. 8º, § 3º, II e III; Lei 14.133/2021, art. 174, § 4º):
 * serialização em CSV (RFC 4180) e JSON, dicionário de dados e a última barreira contra dado pessoal — toda célula
 * de texto passa pela tarja de CPF, e-mail e telefone antes de sair.
 */
import { ErroDominio } from './erros.ts';
import { validarDataISO } from './datas.ts';
import { ehCentavos } from './moeda.ts';
import { tarjarDadosPessoaisLivres } from './privacidade.ts';

export type TipoColunaDadosAbertos = 'identificador' | 'texto' | 'inteiro' | 'decimal' | 'data' | 'booleano';

export interface ColunaDadosAbertos {
  nome: string;
  tipo: TipoColunaDadosAbertos;
  descricao: string;
}

export type ValorDadosAbertos = string | number | boolean | null;
export type LinhaDadosAbertos = Record<string, ValorDadosAbertos>;

/** Licença aberta que só exige citar a autoria ou a fonte (definição de dados abertos do Decreto 8.777/2016). */
export const LICENCA_DADOS_ABERTOS = Object.freeze({
  nome: 'Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)',
  identificador: 'CC-BY-4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/deed.pt_BR',
});

export const FUNDAMENTO_DADOS_ABERTOS = 'Decreto 8.777/2016 (Política de Dados Abertos); Lei 12.527/2011, art. 8º, § 1º, IV, e § 3º, II, III e VI; Lei 14.133/2021, art. 174, § 4º';

const NOME_COLUNA = /^[a-z][a-z0-9_]{0,62}$/;
/** Célula de texto que começa com estes caracteres vira fórmula em planilhas: recebe um apóstrofo na frente. */
const INICIO_FORMULA = /^[=+\-@\t\r]/;

/** Centavos inteiros → reais com duas casas ("1234.56"), sem perda de precisão. */
export function centavosParaDecimal(centavos: number): string {
  if (!ehCentavos(centavos)) throw new ErroDominio('VALOR_INVALIDO', 'Valor em centavos inválido.');
  const absoluto = Math.abs(centavos);
  const sinal = centavos < 0 ? '-' : '';
  return `${sinal}${Math.floor(absoluto / 100)}.${String(absoluto % 100).padStart(2, '0')}`;
}

function exigirColunas(colunas: readonly ColunaDadosAbertos[]): void {
  if (colunas.length === 0) throw new ErroDominio('DICIONARIO_INVALIDO', 'O conjunto precisa de ao menos uma coluna.');
  const nomes = new Set<string>();
  for (const c of colunas) {
    if (!NOME_COLUNA.test(c.nome)) throw new ErroDominio('DICIONARIO_INVALIDO', `Nome de coluna inválido: ${c.nome}.`);
    if (nomes.has(c.nome)) throw new ErroDominio('DICIONARIO_INVALIDO', `Coluna repetida: ${c.nome}.`);
    if (c.descricao.trim().length < 10) throw new ErroDominio('DICIONARIO_INVALIDO', `A coluna ${c.nome} precisa de descrição.`);
    nomes.add(c.nome);
  }
}

function conferirValor(coluna: ColunaDadosAbertos, valor: ValorDadosAbertos): ValorDadosAbertos {
  if (valor === null) return null;
  const invalido = () => new ErroDominio('VALOR_INVALIDO', `Valor inválido na coluna ${coluna.nome} (${coluna.tipo}).`);
  switch (coluna.tipo) {
    case 'inteiro':
      if (typeof valor !== 'number' || !Number.isSafeInteger(valor)) throw invalido();
      return valor;
    case 'decimal':
      if (typeof valor !== 'string' || !/^-?\d+\.\d{2}$/.test(valor)) throw invalido();
      return valor;
    case 'data':
      if (typeof valor !== 'string' || !validarDataISO(valor)) throw invalido();
      return valor;
    case 'booleano':
      if (typeof valor !== 'boolean') throw invalido();
      return valor;
    case 'identificador':
      if (typeof valor !== 'string' || /[\r\n]/.test(valor)) throw invalido();
      return valor;
    case 'texto':
      if (typeof valor !== 'string') throw invalido();
      return valor;
  }
}

/**
 * Confere cada valor contra o dicionário (colunas desconhecidas são descartadas) e tarja CPF, e-mail e telefone em
 * toda coluna de texto. Devolve as linhas prontas e quantas células foram tarjadas.
 */
export function prepararLinhasDadosAbertos(
  colunas: readonly ColunaDadosAbertos[],
  linhas: readonly LinhaDadosAbertos[],
): { linhas: LinhaDadosAbertos[]; celulasTarjadas: number } {
  exigirColunas(colunas);
  let celulasTarjadas = 0;
  const prontas = linhas.map((linha) => {
    const saida: LinhaDadosAbertos = {};
    for (const coluna of colunas) {
      const valor = conferirValor(coluna, linha[coluna.nome] ?? null);
      if (coluna.tipo === 'texto' && typeof valor === 'string') {
        const tarjado = tarjarDadosPessoaisLivres(valor);
        if (tarjado !== valor) celulasTarjadas += 1;
        saida[coluna.nome] = tarjado;
      } else {
        saida[coluna.nome] = valor;
      }
    }
    return saida;
  });
  return { linhas: prontas, celulasTarjadas };
}

function celulaCsv(valor: ValorDadosAbertos, tipo: TipoColunaDadosAbertos): string {
  if (valor === null) return '';
  let texto = typeof valor === 'boolean' ? (valor ? 'true' : 'false') : String(valor);
  if (tipo === 'texto' && INICIO_FORMULA.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) || texto !== texto.trim() ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * CSV RFC 4180: UTF-8, vírgula como separador, ponto como separador decimal, datas AAAA-MM-DD, linhas terminadas
 * em CRLF e cabeçalho com os nomes do dicionário. Texto que começaria uma fórmula de planilha recebe apóstrofo.
 */
export function gerarCsvDadosAbertos(colunas: readonly ColunaDadosAbertos[], linhas: readonly LinhaDadosAbertos[]): string {
  const { linhas: prontas } = prepararLinhasDadosAbertos(colunas, linhas);
  const cabecalho = colunas.map((c) => c.nome).join(',');
  const corpo = prontas.map((l) => colunas.map((c) => celulaCsv(l[c.nome] ?? null, c.tipo)).join(','));
  return `${[cabecalho, ...corpo].join('\r\n')}\r\n`;
}
