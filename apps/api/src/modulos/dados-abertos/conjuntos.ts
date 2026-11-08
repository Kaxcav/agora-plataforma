/**
 * Conjuntos do catálogo de dados abertos (RF-38): consulta, dicionário de dados e fundamento de cada um.
 * Regra de ouro: nenhum dado pessoal. Fornecedor pessoa física sai sem CPF e com o nome mascarado; servidores não
 * aparecem; textos livres passam pela tarja de CPF, e-mail e telefone (`prepararLinhasDadosAbertos`).
 */
import { centavosParaDecimal, validarDataISO, type ColunaDadosAbertos, type LinhaDadosAbertos } from '@agora/dominio';
import type { Executor } from '../../banco/tipos.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { situacaoExibida } from '../financeiro/repositorio.ts';

export interface DefinicaoConjunto {
  id: string;
  titulo: string;
  descricao: string;
  fundamento: string;
  periodicidade: string;
  colunas: readonly ColunaDadosAbertos[];
  /** Linhas do conjunto, já sem dado pessoal, e a data da última alteração (ISO) ou null se vazio. */
  carregar(executor: Executor, hoje: string): Promise<{ linhas: LinhaDadosAbertos[]; atualizadoEm: string | null }>;
}

const PERIODICIDADE = 'Contínua: o arquivo é gerado a partir da base da Ágora no momento do download.';

const data = (valor: string | null | undefined): string | null => (typeof valor === 'string' && validarDataISO(valor) ? valor : null);
const decimal = (centavos: number | null): string | null => (centavos === null ? null : centavosParaDecimal(centavos));

/** Fornecedor sem dado pessoal: CNPJ e razão social de PJ; de PF, só o nome mascarado e nenhum documento. */
function fornecedor(tipo: 'PJ' | 'PF', nome: string, documento: string) {
  return { fornecedor_tipo: tipo, fornecedor_nome: nomeExibivel(tipo, nome), fornecedor_cnpj: tipo === 'PJ' ? documento : null };
}

const COLUNAS_FORNECEDOR: readonly ColunaDadosAbertos[] = [
  { nome: 'fornecedor_tipo', tipo: 'texto', descricao: 'PJ (pessoa jurídica) ou PF (pessoa física).' },
  { nome: 'fornecedor_nome', tipo: 'texto', descricao: 'Razão social; de pessoa física, só o primeiro nome e as iniciais (LGPD).' },
  { nome: 'fornecedor_cnpj', tipo: 'identificador', descricao: 'CNPJ, somente dígitos. Vazio para pessoa física: o CPF não é publicado (LGPD).' },
];

async function maximo(executor: Executor, sql: string): Promise<string | null> {
  const [linha] = await executor.consultar<{ maximo: string | null }>(sql);
  return linha?.maximo ?? null;
}

const editais: DefinicaoConjunto = {
  id: 'editais',
  titulo: 'Editais publicados',
  descricao: 'Licitações com edital divulgado no PNCP e na Ágora, com o endereço público do inteiro teor (sem cadastro nem login).',
  fundamento: 'Lei 14.133/2021, art. 25, § 3º, art. 54 e art. 174, § 4º; Lei 12.527/2011, art. 8º, § 1º, IV',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador do processo na Ágora (UUID).' },
    { nome: 'processo_sei', tipo: 'identificador', descricao: 'Número do processo administrativo no SEI.' },
    { nome: 'objeto', tipo: 'texto', descricao: 'Objeto da contratação.' },
    { nome: 'orgao', tipo: 'texto', descricao: 'Sigla do órgão requisitante.' },
    { nome: 'uasg', tipo: 'identificador', descricao: 'Código da UASG (6 dígitos).' },
    { nome: 'modalidade', tipo: 'texto', descricao: 'Modalidade da licitação.' },
    { nome: 'publicado_em', tipo: 'data', descricao: 'Data da divulgação do edital (AAAA-MM-DD).' },
    { nome: 'data_minima_propostas', tipo: 'data', descricao: 'Data a partir da qual as propostas podem ser abertas (art. 55).' },
    { nome: 'id_pncp', tipo: 'identificador', descricao: 'Número de controle da contratação no PNCP.' },
    { nome: 'endereco_publico', tipo: 'identificador', descricao: 'Caminho da página pública do edital na Ágora.' },
  ],
  async carregar(executor) {
    const linhas = await executor.consultar<{
      id: string;
      numero_sei: string;
      titulo: string;
      orgao: string;
      uasg: string;
      modalidade_prevista: string | null;
      publicado_em: string | null;
      data_minima: string | null;
      id_pncp: string | null;
    }>(
      `SELECT p.id, p.numero_sei, p.titulo, p.orgao, p.uasg, p.modalidade_prevista, p.publicacao->>'publicadoEm' AS publicado_em,
              p.publicacao->>'dataMinimaPropostas' AS data_minima, p.publicacao->>'idPncp' AS id_pncp
         FROM processos p
        WHERE p.publicacao->>'pncp' = 'publicado'
        ORDER BY p.publicacao->>'publicadoEm' DESC NULLS LAST, p.numero_sei`,
    );
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        processo_sei: l.numero_sei,
        objeto: l.titulo,
        orgao: l.orgao,
        uasg: l.uasg,
        modalidade: l.modalidade_prevista,
        publicado_em: data(l.publicado_em),
        data_minima_propostas: data(l.data_minima),
        id_pncp: l.id_pncp,
        endereco_publico: `/transparencia/editais/${l.id}`,
      })),
      atualizadoEm: await maximo(executor, "SELECT MAX(atualizado_em) AS maximo FROM processos WHERE publicacao->>'pncp' = 'publicado'"),
    };
  },
};

const contratos: DefinicaoConjunto = {
  id: 'contratos',
  titulo: 'Contratos',
  descricao: 'Contratos com objeto, fornecedor, vigência, valores inicial, global (com aditivos) e pago, e a divulgação no PNCP.',
  fundamento: 'Lei 14.133/2021, art. 94 e art. 174, § 4º; Lei 12.527/2011, art. 8º, § 1º, IV',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador do contrato na Ágora (UUID).' },
    { nome: 'numero', tipo: 'identificador', descricao: 'Número do contrato na UASG.' },
    { nome: 'ano', tipo: 'inteiro', descricao: 'Ano do contrato.' },
    { nome: 'uasg', tipo: 'identificador', descricao: 'Código da UASG contratante (6 dígitos).' },
    { nome: 'orgao', tipo: 'texto', descricao: 'Órgão da UASG contratante.' },
    { nome: 'objeto', tipo: 'texto', descricao: 'Objeto do contrato.' },
    { nome: 'processo_sei', tipo: 'identificador', descricao: 'Número do processo administrativo no SEI.' },
    { nome: 'origem', tipo: 'texto', descricao: 'licitacao ou contratacao_direta.' },
    { nome: 'modalidade', tipo: 'texto', descricao: 'Modalidade da contratação.' },
    ...COLUNAS_FORNECEDOR,
    { nome: 'assinatura_em', tipo: 'data', descricao: 'Data de assinatura (AAAA-MM-DD).' },
    { nome: 'vigencia_inicio', tipo: 'data', descricao: 'Início da vigência.' },
    { nome: 'vigencia_fim', tipo: 'data', descricao: 'Fim da vigência, considerados os aditivos de prorrogação.' },
    { nome: 'valor_inicial', tipo: 'decimal', descricao: 'Valor inicial em reais, com ponto decimal.' },
    { nome: 'valor_global', tipo: 'decimal', descricao: 'Valor global em reais: inicial + acréscimos − supressões + reajustes + prorrogações.' },
    { nome: 'valor_pago', tipo: 'decimal', descricao: 'Total pago em reais.' },
    { nome: 'divulgacao_pncp_em', tipo: 'data', descricao: 'Data da divulgação do contrato no PNCP (art. 94).' },
    { nome: 'id_pncp', tipo: 'identificador', descricao: 'Número de controle do contrato no PNCP.' },
  ],
  async carregar(executor) {
    const linhas = await executor.consultar<{
      id: string;
      numero: string;
      ano: number;
      uasg: string;
      orgao: string;
      objeto: string;
      processo_sei: string;
      origem: string;
      modalidade: string;
      tipo_pessoa: 'PJ' | 'PF';
      razao_social: string;
      documento: string;
      assinatura_em: string;
      vigencia_inicio: string;
      vigencia_fim: string;
      valor_inicial: number;
      valor_global: number;
      valor_pago: number;
      divulgacao_pncp_em: string | null;
      id_pncp: string | null;
    }>(
      `SELECT c.id, c.numero, c.ano, c.uasg, u.orgao, c.objeto, c.processo_sei, c.origem, c.modalidade,
              f.tipo_pessoa, f.razao_social, f.documento, c.assinatura_em, c.vigencia_inicio, c.vigencia_fim,
              c.valor_inicial, v.valor_global, v.valor_pago, c.divulgacao_pncp_em, c.id_pncp
         FROM contratos c
         JOIN uasgs u ON u.codigo = c.uasg
         JOIN fornecedores f ON f.id = c.fornecedor_id
         JOIN vw_contratos_valores v ON v.contrato_id = c.id
        ORDER BY c.assinatura_em DESC, c.uasg, c.numero`,
    );
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        numero: l.numero,
        ano: l.ano,
        uasg: l.uasg,
        orgao: l.orgao,
        objeto: l.objeto,
        processo_sei: l.processo_sei,
        origem: l.origem,
        modalidade: l.modalidade,
        ...fornecedor(l.tipo_pessoa, l.razao_social, l.documento),
        assinatura_em: data(l.assinatura_em),
        vigencia_inicio: data(l.vigencia_inicio),
        vigencia_fim: data(l.vigencia_fim),
        valor_inicial: decimal(l.valor_inicial),
        valor_global: decimal(l.valor_global),
        valor_pago: decimal(l.valor_pago),
        divulgacao_pncp_em: data(l.divulgacao_pncp_em),
        id_pncp: l.id_pncp,
      })),
      atualizadoEm: await maximo(executor, 'SELECT GREATEST(MAX(c.atualizado_em), (SELECT MAX(p.criado_em) FROM pagamentos p)) AS maximo FROM contratos c'),
    };
  },
};

const atas: DefinicaoConjunto = {
  id: 'atas',
  titulo: 'Atas de registro de preços',
  descricao: 'Atas de registro de preços com vigência, valor registrado, aceite de adesão e divulgação no PNCP.',
  fundamento: 'Lei 14.133/2021, arts. 82 a 86 e art. 174, § 2º, III, e § 4º; Lei 12.527/2011, art. 8º, § 1º, IV',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador da ata na Ágora (UUID).' },
    { nome: 'numero', tipo: 'identificador', descricao: 'Número da ata na UASG gerenciadora.' },
    { nome: 'ano', tipo: 'inteiro', descricao: 'Ano da ata.' },
    { nome: 'uasg', tipo: 'identificador', descricao: 'Código da UASG gerenciadora (6 dígitos).' },
    { nome: 'objeto', tipo: 'texto', descricao: 'Objeto registrado.' },
    { nome: 'processo_sei', tipo: 'identificador', descricao: 'Número do processo administrativo no SEI.' },
    { nome: 'modalidade', tipo: 'texto', descricao: 'Modalidade da licitação que gerou a ata.' },
    { nome: 'numero_compra', tipo: 'identificador', descricao: 'Número da compra (pregão ou concorrência).' },
    { nome: 'assinatura_em', tipo: 'data', descricao: 'Data de assinatura.' },
    { nome: 'vigencia_inicio', tipo: 'data', descricao: 'Início da vigência.' },
    { nome: 'vigencia_fim', tipo: 'data', descricao: 'Fim da vigência.' },
    { nome: 'valor_registrado', tipo: 'decimal', descricao: 'Soma de valor unitário × quantidade registrada, em reais.' },
    { nome: 'aceita_adesao', tipo: 'booleano', descricao: 'true quando a ata admite adesão de outros órgãos (art. 86).' },
    { nome: 'divulgacao_pncp_em', tipo: 'data', descricao: 'Data da divulgação no PNCP.' },
    { nome: 'id_pncp', tipo: 'identificador', descricao: 'Número de controle da ata no PNCP.' },
  ],
  async carregar(executor) {
    const linhas = await executor.consultar<{
      id: string;
      numero: string;
      ano: number;
      uasg: string;
      objeto: string;
      processo_sei: string;
      modalidade: string;
      numero_compra: string;
      assinatura_em: string;
      vigencia_inicio: string;
      vigencia_fim: string;
      valor_registrado: number;
      aceita_adesao: boolean;
      divulgacao_pncp_em: string | null;
      id_pncp: string;
    }>(
      `SELECT a.id, a.numero, a.ano, a.uasg, a.objeto, a.processo_sei, a.modalidade, a.numero_compra, a.assinatura_em,
              a.vigencia_inicio, a.vigencia_fim, v.valor_registrado, a.aceita_adesao, a.divulgacao_pncp_em, a.id_pncp
         FROM atas a
         JOIN vw_atas_valores v ON v.ata_id = a.id
        ORDER BY a.assinatura_em DESC, a.uasg, a.numero`,
    );
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        numero: l.numero,
        ano: l.ano,
        uasg: l.uasg,
        objeto: l.objeto,
        processo_sei: l.processo_sei,
        modalidade: l.modalidade,
        numero_compra: l.numero_compra,
        assinatura_em: data(l.assinatura_em),
        vigencia_inicio: data(l.vigencia_inicio),
        vigencia_fim: data(l.vigencia_fim),
        valor_registrado: decimal(l.valor_registrado),
        aceita_adesao: l.aceita_adesao,
        divulgacao_pncp_em: data(l.divulgacao_pncp_em),
        id_pncp: l.id_pncp,
      })),
      atualizadoEm: await maximo(executor, 'SELECT MAX(atualizada_em) AS maximo FROM atas'),
    };
  },
};

const aditivos: DefinicaoConjunto = {
  id: 'aditivos',
  titulo: 'Termos aditivos',
  descricao: 'Acréscimos, supressões, prorrogações e reajustes dos contratos, com valor, nova vigência e justificativa.',
  fundamento: 'Lei 14.133/2021, arts. 124 a 136, art. 94 e art. 174, § 2º, V, e § 4º',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador do termo aditivo na Ágora (UUID).' },
    { nome: 'contrato_id', tipo: 'identificador', descricao: 'Identificador do contrato (liga ao conjunto de contratos).' },
    { nome: 'contrato_numero', tipo: 'identificador', descricao: 'Número do contrato.' },
    { nome: 'uasg', tipo: 'identificador', descricao: 'Código da UASG contratante.' },
    { nome: 'numero', tipo: 'identificador', descricao: 'Número do termo aditivo.' },
    { nome: 'tipo', tipo: 'texto', descricao: 'acrescimo, supressao, prorrogacao ou reajuste.' },
    { nome: 'valor', tipo: 'decimal', descricao: 'Valor do termo em reais.' },
    { nome: 'nova_vigencia_fim', tipo: 'data', descricao: 'Novo fim da vigência, nas prorrogações.' },
    { nome: 'assinado_em', tipo: 'data', descricao: 'Data de assinatura do termo.' },
    { nome: 'justificativa', tipo: 'texto', descricao: 'Justificativa do termo (dados pessoais tarjados).' },
  ],
  async carregar(executor) {
    const linhas = await executor.consultar<{
      id: string;
      contrato_id: string;
      contrato_numero: string;
      uasg: string;
      numero: string;
      tipo: string;
      valor: number;
      nova_vigencia_fim: string | null;
      assinado_em: string;
      justificativa: string;
    }>(
      `SELECT ad.id, ad.contrato_id, c.numero AS contrato_numero, c.uasg, ad.numero, ad.tipo, ad.valor, ad.nova_vigencia_fim,
              ad.assinado_em, ad.justificativa
         FROM aditivos ad
         JOIN contratos c ON c.id = ad.contrato_id
        ORDER BY ad.assinado_em DESC, c.numero, ad.numero`,
    );
    const [ultima] = await executor.consultar<{ maximo: string | null }>('SELECT MAX(assinado_em)::text AS maximo FROM aditivos');
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        contrato_id: l.contrato_id,
        contrato_numero: l.contrato_numero,
        uasg: l.uasg,
        numero: l.numero,
        tipo: l.tipo,
        valor: decimal(l.valor),
        nova_vigencia_fim: data(l.nova_vigencia_fim),
        assinado_em: data(l.assinado_em),
        justificativa: l.justificativa,
      })),
      atualizadoEm: ultima?.maximo ? `${ultima.maximo}T00:00:00.000Z` : null,
    };
  },
};

const pagamentos: DefinicaoConjunto = {
  id: 'pagamentos',
  titulo: 'Pagamentos na ordem cronológica',
  descricao:
    'Pagamentos dos contratos por fonte de recursos, na ordem cronológica das datas de exigibilidade, com a posição de cada nota ainda não paga na fila.',
  fundamento: 'Lei 14.133/2021, art. 141, caput e § 3º; Lei 12.527/2011, art. 8º',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador do pagamento na Ágora (UUID).' },
    { nome: 'fonte_recurso', tipo: 'identificador', descricao: 'Fonte de recursos: a ordem cronológica é contada dentro de cada fonte.' },
    { nome: 'posicao_ordem_cronologica', tipo: 'inteiro', descricao: 'Posição na fila de pagamento da fonte (só notas não pagas; vazio quando paga).' },
    { nome: 'data_exigibilidade', tipo: 'data', descricao: 'Data em que o pagamento se torna exigível (vencimento).' },
    { nome: 'contrato_id', tipo: 'identificador', descricao: 'Identificador do contrato (liga ao conjunto de contratos).' },
    { nome: 'contrato_numero', tipo: 'identificador', descricao: 'Número do contrato.' },
    { nome: 'uasg', tipo: 'identificador', descricao: 'Código da UASG contratante.' },
    ...COLUNAS_FORNECEDOR,
    { nome: 'nota_fiscal', tipo: 'identificador', descricao: 'Número da nota fiscal ou do documento de cobrança.' },
    { nome: 'competencia', tipo: 'identificador', descricao: 'Mês de competência (AAAA-MM).' },
    { nome: 'valor', tipo: 'decimal', descricao: 'Valor em reais.' },
    { nome: 'situacao', tipo: 'texto', descricao: 'previsto, atestado, liquidado, pago ou atrasado (exigível e não pago).' },
    { nome: 'pago_em', tipo: 'data', descricao: 'Data do pagamento, quando pago.' },
  ],
  async carregar(executor, hoje) {
    const linhas = await executor.consultar<{
      id: string;
      fonte_recurso: string;
      posicao: number | null;
      vencimento: string;
      contrato_id: string;
      contrato_numero: string;
      uasg: string;
      tipo_pessoa: 'PJ' | 'PF';
      razao_social: string;
      documento: string;
      nota_fiscal: string;
      competencia: string;
      valor: number;
      situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
      pago_em: string | null;
    }>(
      `WITH ordem AS (
         SELECT op.id, ROW_NUMBER() OVER (PARTITION BY op.fonte_recurso ORDER BY op.vencimento, op.criado_em, op.nota_fiscal)::integer AS posicao
           FROM pagamentos op
          WHERE op.situacao <> 'pago'
       )
       SELECT p.id, p.fonte_recurso, o.posicao, p.vencimento, p.contrato_id, c.numero AS contrato_numero, c.uasg,
              f.tipo_pessoa, f.razao_social, f.documento, p.nota_fiscal, p.competencia, p.valor, p.situacao, p.pago_em
         FROM pagamentos p
         JOIN contratos c ON c.id = p.contrato_id
         JOIN fornecedores f ON f.id = c.fornecedor_id
         LEFT JOIN ordem o ON o.id = p.id
        ORDER BY p.fonte_recurso, p.vencimento, p.criado_em, p.nota_fiscal`,
    );
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        fonte_recurso: l.fonte_recurso,
        posicao_ordem_cronologica: l.situacao === 'pago' ? null : l.posicao,
        data_exigibilidade: data(l.vencimento),
        contrato_id: l.contrato_id,
        contrato_numero: l.contrato_numero,
        uasg: l.uasg,
        ...fornecedor(l.tipo_pessoa, l.razao_social, l.documento),
        nota_fiscal: l.nota_fiscal,
        competencia: l.competencia,
        valor: decimal(l.valor),
        situacao: situacaoExibida(l.situacao, l.vencimento, hoje),
        pago_em: data(l.pago_em),
      })),
      atualizadoEm: await maximo(executor, 'SELECT GREATEST(MAX(criado_em), MAX(atestado_em)) AS maximo FROM pagamentos'),
    };
  },
};

const sancoes: DefinicaoConjunto = {
  id: 'sancoes',
  titulo: 'Sanções aplicadas',
  descricao: 'Sanções administrativas aplicadas a licitantes e contratados, com tipo, infração, multa, vigência e registro no CEIS/CNEP.',
  fundamento: 'Lei 14.133/2021, arts. 155, 156 e 161; Lei 12.527/2011, art. 8º',
  periodicidade: PERIODICIDADE,
  colunas: [
    { nome: 'id', tipo: 'identificador', descricao: 'Identificador da sanção na Ágora (UUID).' },
    ...COLUNAS_FORNECEDOR,
    { nome: 'tipo', tipo: 'texto', descricao: 'advertencia, multa, impedimento_licitar ou declaracao_inidoneidade (art. 156).' },
    { nome: 'inciso_infracao', tipo: 'identificador', descricao: 'Inciso do art. 155 da infração (I a XII).' },
    { nome: 'valor_multa', tipo: 'decimal', descricao: 'Valor da multa em reais, quando houver.' },
    { nome: 'aplicada_em', tipo: 'data', descricao: 'Data da decisão que aplicou a sanção.' },
    { nome: 'inicio_vigencia', tipo: 'data', descricao: 'Início dos efeitos.' },
    { nome: 'fim_vigencia', tipo: 'data', descricao: 'Fim dos efeitos (vazio quando não se aplica).' },
    { nome: 'contrato_numero', tipo: 'identificador', descricao: 'Número do contrato relacionado, quando houver.' },
    { nome: 'registrada_ceis_cnep', tipo: 'booleano', descricao: 'true quando já informada ao CEIS ou ao CNEP (art. 161).' },
  ],
  async carregar(executor) {
    const linhas = await executor.consultar<{
      id: string;
      tipo_pessoa: 'PJ' | 'PF';
      razao_social: string;
      documento: string;
      tipo: string;
      inciso_infracao: string;
      valor_multa: number | null;
      aplicada_em: string | null;
      inicio_vigencia: string | null;
      fim_vigencia: string | null;
      contrato_numero: string | null;
      registrada_ceis_cnep: boolean;
    }>(
      `SELECT s.id, f.tipo_pessoa, f.razao_social, f.documento, s.tipo, s.inciso_infracao, s.valor_multa, s.aplicada_em,
              s.inicio_vigencia, s.fim_vigencia, c.numero AS contrato_numero, s.registrada_ceis_cnep
         FROM sancoes s
         JOIN fornecedores f ON f.id = s.fornecedor_id
         LEFT JOIN contratos c ON c.id = s.contrato_id
        WHERE s.situacao = 'aplicada'
        ORDER BY s.aplicada_em DESC NULLS LAST, s.id`,
    );
    return {
      linhas: linhas.map((l) => ({
        id: l.id,
        ...fornecedor(l.tipo_pessoa, l.razao_social, l.documento),
        tipo: l.tipo,
        inciso_infracao: l.inciso_infracao,
        valor_multa: decimal(l.valor_multa),
        aplicada_em: data(l.aplicada_em),
        inicio_vigencia: data(l.inicio_vigencia),
        fim_vigencia: data(l.fim_vigencia),
        contrato_numero: l.contrato_numero,
        registrada_ceis_cnep: l.registrada_ceis_cnep,
      })),
      atualizadoEm: await maximo(executor, "SELECT MAX(criada_em) AS maximo FROM sancoes WHERE situacao = 'aplicada'"),
    };
  },
};

/** Conjuntos publicados, na ordem do catálogo. */
export const CONJUNTOS: readonly DefinicaoConjunto[] = [editais, contratos, atas, aditivos, pagamentos, sancoes];

/** Conjuntos previstos que dependem de módulo ainda ausente na Ágora. */
export const CONJUNTOS_INDISPONIVEIS = [
  {
    id: 'pca',
    titulo: 'Plano de contratações anual (PCA)',
    motivo: 'A Ágora ainda não tem o módulo do plano de contratações anual; o conjunto entra no catálogo quando o módulo existir.',
  },
] as const;
