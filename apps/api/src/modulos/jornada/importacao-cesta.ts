/**
 * Importação da cesta de preços por planilha (RF-16; Lei 14.133/2021, art. 23, § 1º).
 * O servidor lê o texto (CSV ou linhas coladas de uma planilha), valida cada linha e devolve a prévia.
 * Nada é gravado aqui. O conteúdo é tratado só como texto: fórmulas não são avaliadas.
 */
import { validarDataISO, type Centavos, type DataISO, type FonteCotacao } from '@agora/dominio';
import type { LinhaImportacaoCesta, PreviaImportacaoCesta } from '@agora/contratos';

export const MAXIMO_COTACOES_CESTA = 50;
export const MAXIMO_CARACTERES_IMPORTACAO = 100_000;

type Coluna = 'fonte' | 'descricaoFonte' | 'valorUnitario' | 'dataCotacao' | 'justificativa';

/** Ordem do modelo, usada quando a primeira linha não é um cabeçalho reconhecível. */
const ORDEM_DO_MODELO: readonly Coluna[] = ['fonte', 'descricaoFonte', 'valorUnitario', 'dataCotacao', 'justificativa'];
const OBRIGATORIAS: readonly Coluna[] = ['fonte', 'descricaoFonte', 'valorUnitario', 'dataCotacao'];

const NOMES_COLUNA: Record<Coluna, readonly string[]> = {
  fonte: ['fonte', 'fonte_do_preco', 'tipo_de_fonte', 'parametro', 'inciso'],
  descricaoFonte: ['identificacao', 'identificacao_da_fonte', 'descricao_da_fonte', 'descricao_fonte', 'descricao', 'origem', 'fornecedor'],
  valorUnitario: ['valor_unitario', 'valor', 'preco', 'preco_unitario', 'valor_unitario_r'],
  dataCotacao: ['data', 'data_da_cotacao', 'data_cotacao', 'data_do_preco'],
  justificativa: ['justificativa', 'justificativa_da_escolha', 'justificativa_escolha_fornecedor', 'justificativa_da_escolha_do_fornecedor'],
};

const ROTULO_COLUNA: Record<Coluna, string> = {
  fonte: 'fonte',
  descricaoFonte: 'identificação',
  valorUnitario: 'valor unitário',
  dataCotacao: 'data',
  justificativa: 'justificativa',
};

/** Nomes aceitos para cada parâmetro do art. 23, § 1º (código, nome usual ou número do inciso). */
const NOMES_FONTE: Record<FonteCotacao, readonly string[]> = {
  painel_precos: ['painel_precos', 'painel_de_precos', 'painel', 'banco_de_precos', 'i', 'inciso_i'],
  contratacao_similar: ['contratacao_similar', 'contratacoes_similares', 'contratacao_similar_da_administracao', 'ii', 'inciso_ii'],
  midia_especializada: ['midia_especializada', 'midia', 'sitio_eletronico', 'sitios_eletronicos', 'tabela_de_referencia', 'iii', 'inciso_iii'],
  fornecedor_direto: ['fornecedor_direto', 'pesquisa_direta', 'cotacao_direta', 'fornecedor', 'iv', 'inciso_iv'],
  nota_fiscal: ['nota_fiscal', 'notas_fiscais', 'nf', 'nfe', 'nf_e', 'v', 'inciso_v'],
};

/** Minúsculas, sem acento, com `_` no lugar de espaços e pontuação. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function separadorDa(primeiraLinha: string): string {
  if (primeiraLinha.includes('\t')) return '\t';
  if (primeiraLinha.includes(';')) return ';';
  return ',';
}

interface Registro {
  linha: number;
  campos: string[];
}

/** Leitura de CSV com aspas (RFC 4180): aspas duplas escapadas e quebras de linha dentro de campos. */
function lerRegistros(texto: string, separador: string): Registro[] {
  const registros: Registro[] = [];
  let campos: string[] = [];
  let campo = '';
  let entreAspas = false;
  let linhaAtual = 1;
  let inicioRegistro = 1;
  const fecharRegistro = () => {
    campos.push(campo);
    if (campos.some((c) => c.trim() !== '')) registros.push({ linha: inicioRegistro, campos });
    campos = [];
    campo = '';
  };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (entreAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        if (ch === '\n') linhaAtual++;
        campo += ch;
      }
      continue;
    }
    if (ch === '"' && campo.trim() === '') {
      campo = '';
      entreAspas = true;
    } else if (ch === separador) {
      campos.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fecharRegistro();
      linhaAtual++;
      inicioRegistro = linhaAtual;
    } else {
      campo += ch;
    }
  }
  if (campo !== '' || campos.length > 0) fecharRegistro();
  return registros;
}

/**
 * Valor em reais → centavos. Aceita "R$ 1.234,56", "1234,56", "1234.56" e "1,234.56".
 * Com só um ponto seguido de 3 dígitos ("1.234"), o ponto é separador de milhar, como no uso brasileiro.
 */
export function lerValorEmCentavos(bruto: string): Centavos | null {
  const s = bruto.replace(/R\$/gi, '').replace(/[\s ]/g, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;
  const ultimoPonto = s.lastIndexOf('.');
  const ultimaVirgula = s.lastIndexOf(',');
  let inteiro: string;
  let decimal = '';
  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    const separadorDecimal = ultimoPonto > ultimaVirgula ? '.' : ',';
    const separadorMilhar = separadorDecimal === '.' ? ',' : '.';
    const partes = s.split(separadorDecimal);
    if (partes.length !== 2) return null;
    inteiro = (partes[0] ?? '').split(separadorMilhar).join('');
    decimal = partes[1] ?? '';
  } else if (ultimaVirgula >= 0) {
    const partes = s.split(',');
    if (partes.length !== 2) return null;
    inteiro = partes[0] ?? '';
    decimal = partes[1] ?? '';
  } else if (ultimoPonto >= 0) {
    const partes = s.split('.');
    const ultima = partes[partes.length - 1] ?? '';
    if (partes.length > 2 || ultima.length === 3) {
      if (!partes.slice(1).every((p) => p.length === 3)) return null;
      inteiro = partes.join('');
    } else {
      inteiro = partes[0] ?? '';
      decimal = ultima;
    }
  } else {
    inteiro = s;
  }
  if (!/^\d+$/.test(inteiro) || (decimal !== '' && !/^\d+$/.test(decimal))) return null;
  const tresCasas = `${decimal}000`.slice(0, 3);
  let centavos = Number(inteiro) * 100 + Number(tresCasas.slice(0, 2));
  if (Number(tresCasas[2]) >= 5) centavos += 1;
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Data em "dd/mm/aaaa" (também com "-" ou ".") ou "aaaa-mm-dd" → DataISO. */
export function lerData(bruto: string): DataISO | null {
  const s = bruto.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const brasileira = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  let data: string | null = null;
  if (iso) data = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (brasileira) data = `${brasileira[3]}-${(brasileira[2] ?? '').padStart(2, '0')}-${(brasileira[1] ?? '').padStart(2, '0')}`;
  return data !== null && validarDataISO(data) ? data : null;
}

export function lerFonte(bruto: string): FonteCotacao | null {
  const nome = normalizar(bruto);
  if (nome === '') return null;
  for (const [fonte, nomes] of Object.entries(NOMES_FONTE) as [FonteCotacao, readonly string[]][]) {
    if (nomes.includes(nome)) return fonte;
  }
  return null;
}

function colunasDoCabecalho(campos: string[]): Map<Coluna, number> | null {
  const mapa = new Map<Coluna, number>();
  campos.forEach((campo, indice) => {
    const nome = normalizar(campo);
    for (const [coluna, nomes] of Object.entries(NOMES_COLUNA) as [Coluna, readonly string[]][]) {
      if (!mapa.has(coluna) && nomes.includes(nome)) mapa.set(coluna, indice);
    }
  });
  return mapa.size >= 2 ? mapa : null;
}

function validarLinha(registro: Registro, colunas: Map<Coluna, number>, hoje: DataISO): LinhaImportacaoCesta {
  const valor = (coluna: Coluna) => {
    const indice = colunas.get(coluna);
    return indice === undefined ? '' : (registro.campos[indice] ?? '').trim();
  };
  const erros: string[] = [];

  const textoFonte = valor('fonte');
  const fonte = lerFonte(textoFonte);
  if (textoFonte === '') erros.push('Informe a fonte do preço (art. 23, § 1º, I a V).');
  else if (fonte === null) {
    erros.push(`Fonte "${textoFonte}" não reconhecida. Use painel_precos, contratacao_similar, midia_especializada, fornecedor_direto ou nota_fiscal (ou o inciso I a V).`);
  }

  const descricaoFonte = valor('descricaoFonte');
  if (descricaoFonte.length < 3) erros.push('Identifique a fonte (contratação, fornecedor ou publicação) com pelo menos 3 caracteres.');
  else if (descricaoFonte.length > 500) erros.push('A identificação da fonte passa de 500 caracteres.');

  const textoValor = valor('valorUnitario');
  const valorUnitario = lerValorEmCentavos(textoValor);
  if (valorUnitario === null) erros.push(textoValor === '' ? 'Informe o valor unitário.' : `Valor unitário "${textoValor}" inválido.`);
  else if (valorUnitario <= 0) erros.push('O valor unitário deve ser maior que zero.');

  const textoData = valor('dataCotacao');
  const dataCotacao = lerData(textoData);
  if (dataCotacao === null) erros.push(textoData === '' ? 'Informe a data da cotação.' : `Data "${textoData}" inválida. Use dd/mm/aaaa.`);
  else if (dataCotacao > hoje) erros.push('A data da cotação não pode ser futura.');

  const justificativa = valor('justificativa');
  if (fonte === 'fornecedor_direto' && justificativa === '') {
    erros.push('Pesquisa direta com fornecedor exige justificativa da escolha (art. 23, § 1º, IV).');
  }
  if (justificativa.length > 2000) erros.push('A justificativa passa de 2.000 caracteres.');

  return {
    linha: registro.linha,
    fonte,
    descricaoFonte,
    valorUnitario,
    dataCotacao,
    justificativaEscolhaFornecedor: justificativa === '' ? null : justificativa,
    erros,
  };
}

/**
 * Prévia da importação: lê e valida todas as linhas, sem gravar.
 * `cotacoesNaCesta` é quanto já existe na cesta, para conferir o limite de 50 no modo "acrescentar".
 */
export function lerPlanilhaCesta(conteudo: string, opcoes: { hoje: DataISO; modo: 'acrescentar' | 'substituir'; cotacoesNaCesta: number }): PreviaImportacaoCesta {
  const texto = conteudo.replace(/^﻿/, '');
  const errosGerais: string[] = [];
  const primeiraLinha = texto.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const registros = primeiraLinha === '' ? [] : lerRegistros(texto, separadorDa(primeiraLinha));

  let colunas = registros[0] ? colunasDoCabecalho(registros[0].campos) : null;
  const cabecalhoReconhecido = colunas !== null;
  const dados = cabecalhoReconhecido ? registros.slice(1) : registros;
  if (colunas === null) colunas = new Map(ORDEM_DO_MODELO.map((coluna, indice) => [coluna, indice]));
  else {
    const ausentes = OBRIGATORIAS.filter((c) => !colunas?.has(c));
    if (ausentes.length > 0) errosGerais.push(`Faltam as colunas obrigatórias: ${ausentes.map((c) => ROTULO_COLUNA[c]).join(', ')}.`);
  }

  if (dados.length === 0) errosGerais.push('A planilha não tem linhas de cotação.');
  if (dados.length > MAXIMO_COTACOES_CESTA) errosGerais.push(`A planilha tem ${dados.length} linhas; o limite da cesta é ${MAXIMO_COTACOES_CESTA} cotações.`);

  const mapa = colunas;
  const linhas = errosGerais.length > 0 ? [] : dados.map((registro) => validarLinha(registro, mapa, opcoes.hoje));
  const totalAposImportacao = (opcoes.modo === 'acrescentar' ? opcoes.cotacoesNaCesta : 0) + linhas.length;
  if (totalAposImportacao > MAXIMO_COTACOES_CESTA) {
    errosGerais.push(`Com esta importação a cesta teria ${totalAposImportacao} cotações; o limite é ${MAXIMO_COTACOES_CESTA}. Use "substituir" ou reduza a planilha.`);
  }
  const comErro = linhas.filter((l) => l.erros.length > 0).length;
  return { linhas, validas: linhas.length - comErro, comErro, cabecalhoReconhecido, errosGerais, totalAposImportacao };
}

/** Modelo de planilha com as colunas aceitas e exemplos fictícios. */
export function modeloPlanilhaCesta(): string {
  return [
    'fonte;identificacao;valor_unitario;data_cotacao;justificativa',
    'painel_precos;Painel de Preços do PNCP — item de referência;1.250,00;15/10/2026;',
    'contratacao_similar;Contrato 12/2026 de órgão federal (exemplo fictício);1.190,50;02/09/2026;',
    'fornecedor_direto;Fornecedor Exemplo Ltda. (fictício);1.310,00;20/10/2026;Fornecedor do ramo com atuação nacional e proposta formal',
    '',
  ].join('\r\n');
}
