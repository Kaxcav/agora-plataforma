/**
 * Leitura da tabela oficial do Sinapi ou do Sicro (CSV extraído da planilha publicada pela Caixa ou pelo DNIT).
 * Colunas: código; descrição; unidade; preço (valor de referência). Cabeçalho opcional; separador ponto e vírgula,
 * tabulação ou vírgula. O conteúdo é tratado só como texto.
 */
import type { Detalhe } from '../../http/erros.ts';
import type { LinhaReferencia } from '../../integracoes/precos/referencias-engenharia.ts';
import { lerValorEmCentavos } from '../jornada/importacao-cesta.ts';

export const MAXIMO_LINHAS_REFERENCIA = 5_000;
export const MAXIMO_CARACTERES_REFERENCIA = 900_000;

const CABECALHOS = ['codigo', 'código', 'cod', 'codigo da composicao', 'código da composição'];

function separadorDa(linha: string): string {
  if (linha.includes('\t')) return '\t';
  if (linha.includes(';')) return ';';
  return ',';
}

/** Divide uma linha respeitando campos entre aspas (aspas duplas escapadas por repetição). */
function campos(linha: string, separador: string): string[] {
  const saida: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"' && atual.trim() === '') {
      atual = '';
      aspas = true;
    } else if (c === separador) {
      saida.push(atual.trim());
      atual = '';
    } else {
      atual += c;
    }
  }
  saida.push(atual.trim());
  return saida;
}

export function lerTabelaReferencia(conteudo: string): { linhas: LinhaReferencia[]; erros: Detalhe[] } {
  const texto = conteudo.replace(/^﻿/, '');
  const brutas = texto.split(/\r?\n/).map((l, i) => ({ numero: i + 1, texto: l })).filter((l) => l.texto.trim() !== '');
  const erros: Detalhe[] = [];
  if (brutas.length === 0) return { linhas: [], erros: [{ campo: 'conteudo', mensagem: 'A tabela não tem linhas.' }] };
  const separador = separadorDa(brutas[0]?.texto ?? '');
  const primeira = campos(brutas[0]?.texto ?? '', separador)[0]?.toLowerCase() ?? '';
  const dados = CABECALHOS.includes(primeira) ? brutas.slice(1) : brutas;
  if (dados.length > MAXIMO_LINHAS_REFERENCIA) {
    return { linhas: [], erros: [{ campo: 'conteudo', mensagem: `A tabela tem ${dados.length} linhas; o limite por importação é ${MAXIMO_LINHAS_REFERENCIA}.` }] };
  }
  const linhas: LinhaReferencia[] = [];
  const codigos = new Set<string>();
  for (const bruta of dados) {
    const [codigo = '', descricao = '', unidade = '', preco = ''] = campos(bruta.texto, separador);
    const problemas: string[] = [];
    if (!/^[A-Za-z0-9./-]{1,40}$/.test(codigo)) problemas.push('código ausente ou inválido');
    else if (codigos.has(codigo)) problemas.push(`código ${codigo} repetido`);
    if (descricao.length < 3 || descricao.length > 1000) problemas.push('descrição deve ter de 3 a 1.000 caracteres');
    if (unidade.length < 1 || unidade.length > 20) problemas.push('unidade deve ter de 1 a 20 caracteres');
    const valor = lerValorEmCentavos(preco);
    if (valor === null || valor <= 0) problemas.push(`preço "${preco}" inválido`);
    if (problemas.length > 0 || valor === null) {
      if (erros.length < 50) erros.push({ campo: `linha ${bruta.numero}`, mensagem: problemas.join('; ') });
      continue;
    }
    codigos.add(codigo);
    linhas.push({ codigo, descricao, unidade, preco: valor });
  }
  if (linhas.length === 0 && erros.length === 0) erros.push({ campo: 'conteudo', mensagem: 'A tabela não tem linhas de composição.' });
  return { linhas, erros };
}
