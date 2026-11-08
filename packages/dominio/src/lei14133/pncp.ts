/**
 * Publicação no Portal Nacional de Contratações Públicas (RF-19): identificadores e tabelas de domínio do
 * Manual de Integração PNCP (versão 2.2.x, seções 4.3, 5.1 a 5.4, 5.12, 5.15 e 5.17). O PNCP é o sítio
 * oficial de divulgação dos atos exigidos pela lei (art. 174, § 2º); a divulgação do edital (art. 54) e a do
 * contrato (art. 94) dependem dele.
 */
import { ErroDominio } from '../erros.ts';
import type { CriterioJulgamento, ObjetoLicitacao } from './prazos.ts';

/** Tipos de documento aceitos pelas APIs de documento do PNCP (seção 5.12 do manual). */
export const TIPOS_DOCUMENTO_PNCP = Object.freeze({
  avisoContratacaoDireta: 1,
  edital: 2,
  minutaContrato: 3,
  termoReferencia: 4,
  estudoTecnicoPreliminar: 7,
  mapaRiscos: 9,
  dfd: 10,
  ataRegistroPreco: 11,
  contrato: 12,
  outrosDocumentos: 16,
} as const);

export type RegistroPncp = 'compra' | 'contrato' | 'ata';

export interface LocalizacaoPncp {
  registro: RegistroPncp;
  cnpj: string;
  ano: number;
  sequencial: number;
  /** Sequencial da ata dentro da compra (só para atas). */
  sequencialAta: number | null;
  /** Sequencial do documento quando o endereço aponta um arquivo (`.../arquivos/{n}`). */
  sequencialDocumento: number | null;
  /** Número de controle PNCP do registro (compra, contrato ou ata). */
  numeroControle: string;
}

const seis = (n: number) => String(n).padStart(6, '0');

/**
 * Número de controle PNCP (seção 4.3 do manual): `CNPJ-1-SEQUENCIAL/ANO` para a contratação,
 * `CNPJ-2-SEQUENCIAL/ANO` para o contrato e `CNPJ-1-SEQUENCIAL/ANO-SEQUENCIALATA` para a ata. O sequencial tem
 * 6 dígitos e reinicia a cada ano.
 */
export function numeroControlePncp(p: { registro: RegistroPncp; cnpj: string; ano: number; sequencial: number; sequencialAta?: number }): string {
  if (!/^\d{14}$/.test(p.cnpj)) throw new ErroDominio('PNCP_INVALIDO', 'O CNPJ do órgão deve ter 14 dígitos.');
  if (!Number.isInteger(p.ano) || p.ano < 2021 || p.ano > 2999) throw new ErroDominio('PNCP_INVALIDO', `Ano inválido: ${String(p.ano)}.`);
  const sequencialValido = (n: number | undefined) => n !== undefined && Number.isInteger(n) && n >= 1 && n <= 999_999;
  if (!sequencialValido(p.sequencial)) throw new ErroDominio('PNCP_INVALIDO', 'O sequencial PNCP deve ser um inteiro de 1 a 999999.');
  if (p.registro === 'contrato') return `${p.cnpj}-2-${seis(p.sequencial)}/${p.ano}`;
  const compra = `${p.cnpj}-1-${seis(p.sequencial)}/${p.ano}`;
  if (p.registro === 'compra') return compra;
  if (!sequencialValido(p.sequencialAta)) throw new ErroDominio('PNCP_INVALIDO', 'O sequencial da ata deve ser um inteiro de 1 a 999999.');
  return `${compra}-${seis(p.sequencialAta as number)}`;
}

const PADRAO_LOCALIZACAO =
  /\/v1\/orgaos\/(\d{14})\/(compras|contratos)\/(\d{4})\/(\d{1,6})(?:\/atas\/(\d{1,6}))?(?:\/arquivos\/(\d{1,6}))?\/?$/;

/**
 * Interpreta o endereço devolvido pelo PNCP no cabeçalho `location` (ou em `compraUri`) de uma inclusão bem-sucedida
 * (HTTP 201) e calcula o número de controle do registro. Ex.: `.../v1/orgaos/{cnpj}/compras/2026/7` → compra
 * `{cnpj}-1-000007/2026`; `.../compras/2026/7/arquivos/2` → mesma compra, documento 2.
 */
export function interpretarLocalizacaoPncp(localizacao: string): LocalizacaoPncp {
  const texto = typeof localizacao === 'string' ? localizacao.trim() : '';
  const caminho = texto.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const partes = PADRAO_LOCALIZACAO.exec(caminho);
  if (!partes) throw new ErroDominio('PNCP_LOCALIZACAO_INVALIDA', `Endereço de registro do PNCP não reconhecido: "${texto.slice(0, 200)}".`);
  const [, cnpj = '', colecao, ano = '0', sequencial = '0', ata, arquivo] = partes;
  if (colecao === 'contratos' && ata !== undefined) {
    throw new ErroDominio('PNCP_LOCALIZACAO_INVALIDA', 'Contratos do PNCP não têm atas: endereço inconsistente.');
  }
  const registro: RegistroPncp = colecao === 'contratos' ? 'contrato' : ata !== undefined ? 'ata' : 'compra';
  const sequencialAta = ata === undefined ? null : Number(ata);
  return {
    registro,
    cnpj,
    ano: Number(ano),
    sequencial: Number(sequencial),
    sequencialAta,
    sequencialDocumento: arquivo === undefined ? null : Number(arquivo),
    numeroControle: numeroControlePncp({ registro, cnpj, ano: Number(ano), sequencial: Number(sequencial), ...(sequencialAta === null ? {} : { sequencialAta }) }),
  };
}

/** Título do documento no cabeçalho `Titulo-Documento`: espaços normalizados e no máximo 50 caracteres (manual, 6.3.1). */
export function tituloDocumentoPncp(titulo: string): string {
  const limpo = String(titulo ?? '').replace(/\s+/g, ' ').trim();
  if (limpo === '') throw new ErroDominio('PNCP_INVALIDO', 'Informe o título do documento.');
  if (limpo.length <= 50) return limpo;
  const corte = limpo.slice(0, 50);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco >= 30 ? corte.slice(0, ultimoEspaco) : corte).trim();
}

export interface CodigosContratacaoPncp {
  /** 1 = Edital (seção 5.1). */
  tipoInstrumentoConvocatorioId: 1;
  modalidadeId: number;
  modoDisputaId: number;
  amparoLegalId: number;
  criterioJulgamentoId: number;
  /** 'M' para bens, 'S' para serviços e obras. */
  materialOuServico: 'M' | 'S';
  /** Categoria do processo (seção 5.11), usada na inclusão do contrato. */
  categoriaProcessoId: number;
}

/** Modalidade (texto da jornada) → código PNCP (seção 5.2) e amparo legal da licitação (art. 28; seções 5.15 e 5.17). */
const MODALIDADES: readonly { padrao: RegExp; modalidadeId: number; amparoLegalId: number }[] = [
  { padrao: /^preg[aã]o eletr[oô]nico/i, modalidadeId: 6, amparoLegalId: 1 },
  { padrao: /^preg[aã]o presencial/i, modalidadeId: 7, amparoLegalId: 1 },
  { padrao: /^concorr[eê]ncia eletr[oô]nica/i, modalidadeId: 4, amparoLegalId: 2 },
  { padrao: /^concorr[eê]ncia presencial/i, modalidadeId: 5, amparoLegalId: 2 },
  { padrao: /^concurso/i, modalidadeId: 3, amparoLegalId: 3 },
  { padrao: /^leil[aã]o eletr[oô]nico/i, modalidadeId: 1, amparoLegalId: 4 },
  { padrao: /^leil[aã]o presencial/i, modalidadeId: 13, amparoLegalId: 4 },
  { padrao: /^di[aá]logo competitivo/i, modalidadeId: 2, amparoLegalId: 5 },
];

const CRITERIOS_PNCP: Record<CriterioJulgamento, number> = {
  menor_preco: 1,
  maior_desconto: 2,
  tecnica_preco: 4,
  maior_lance: 5,
  maior_retorno_economico: 6,
  melhor_tecnica: 8,
};

const CATEGORIAS: Record<ObjetoLicitacao, number> = {
  bens: 2,
  servicos_comuns: 8,
  servicos_especiais: 8,
  obras_servicos_engenharia_comuns: 9,
  obras_servicos_engenharia_especiais: 9,
};

/**
 * Códigos PNCP de uma licitação publicada com edital, a partir da modalidade e do critério de julgamento.
 * O amparo legal segue o art. 28 conforme a regra de conformidade da seção 5.17 do manual. O modo de disputa
 * segue o art. 56: aberto (código 1) para menor preço, maior desconto, maior lance e maior retorno econômico;
 * fechado (código 2) para técnica e preço e melhor técnica, porque o modo aberto isolado é vedado com técnica e
 * preço (art. 56, § 1º). Modalidades sem edital (dispensa, inexigibilidade) não passam por esta publicação.
 */
export function codigosContratacaoPncp(p: { modalidade: string; criterio: CriterioJulgamento; objeto: ObjetoLicitacao }): CodigosContratacaoPncp {
  const modalidade = MODALIDADES.find((m) => m.padrao.test(String(p.modalidade ?? '').trim()));
  if (!modalidade) {
    throw new ErroDominio('PNCP_MODALIDADE', `Modalidade sem edital publicável no PNCP por esta rotina: "${String(p.modalidade)}".`);
  }
  const criterioJulgamentoId = CRITERIOS_PNCP[p.criterio];
  if (criterioJulgamentoId === undefined) throw new ErroDominio('PNCP_INVALIDO', `Critério de julgamento inválido: ${String(p.criterio)}.`);
  const categoriaProcessoId = CATEGORIAS[p.objeto];
  if (categoriaProcessoId === undefined) throw new ErroDominio('PNCP_INVALIDO', `Objeto inválido: ${String(p.objeto)}.`);
  const fechado = p.criterio === 'tecnica_preco' || p.criterio === 'melhor_tecnica';
  return {
    tipoInstrumentoConvocatorioId: 1,
    modalidadeId: modalidade.modalidadeId,
    modoDisputaId: fechado ? 2 : 1,
    amparoLegalId: modalidade.amparoLegalId,
    criterioJulgamentoId,
    materialOuServico: p.objeto === 'bens' ? 'M' : 'S',
    categoriaProcessoId,
  };
}
