/**
 * Rotas de contratação (F9): licitação, dispensa (art. 75), inexigibilidade (art. 74), adesão a ata de registro de
 * preços (art. 86, § 2º) e comércio eletrônico pelo Sistema de Compras Expressas — Sicx (art. 79, IV, incluído pela
 * Lei 15.266/2025 e regulamentado pelo Decreto 13.106/2026). Cada rota define os documentos e as travas do art. 72 e
 * o que muda nas 7 etapas da jornada. Também ficam aqui a dispensa eletrônica (aviso de 3 dias úteis e propostas
 * adicionais, art. 75, § 3º), o controle de fracionamento por objeto (art. 75, § 1º) e o cartão de pagamento
 * (art. 75, § 4º). Funções puras: "hoje" e o calendário entram como parâmetro.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, adicionarDias, adicionarDiasUteis, diasEntre, diasUteisEntre, formatarData } from '../datas.ts';
import { type Centavos, formatarMoeda, percentual } from '../moeda.ts';
import { contagem, exigirInteiro, formatarPercentualTexto, lerData } from '../interno.ts';
import { avaliarFracionamento, limiteDispensaVigente, type LimiteDispensa, type TipoObjetoDispensa } from './limites.ts';

// ───────────────────────── rotas ─────────────────────────

export type RotaContratacao = 'licitacao' | 'dispensa' | 'inexigibilidade' | 'adesao_ata' | 'sicx';
export const ROTAS_CONTRATACAO: readonly RotaContratacao[] = Object.freeze(['licitacao', 'dispensa', 'inexigibilidade', 'adesao_ata', 'sicx']);

/** Hipótese da dispensa: por valor (art. 75, I e II, com aviso de dispensa eletrônica) ou outro inciso do art. 75. */
export type HipoteseDispensa = 'valor_obras_engenharia' | 'valor_demais' | 'outra';
/** Hipótese da inexigibilidade (art. 74, I a V). */
export type HipoteseInexigibilidade = 'exclusividade' | 'artista' | 'notoria_especializacao' | 'credenciamento' | 'imovel';

export type ExigenciaDocumento = 'obrigatorio' | 'facultativo' | 'nao_se_aplica';

export interface DocumentoRota {
  id: string;
  titulo: string;
  exigencia: ExigenciaDocumento;
  fundamento: string;
}

/**
 * Como a rota adapta as 7 etapas da jornada. Os campos dizem o que a rota exige; a API aplica a adaptação sobre as
 * regras da licitação, sem mudar as regras das etapas.
 */
export interface AdaptacaoRota {
  rota: RotaContratacao;
  titulo: string;
  fundamento: string;
  /** Texto da "modalidade prevista" do processo. */
  modalidade: string;
  /** ETP: obrigatório, facultativo (IN SEGES/ME 58/2022, art. 14, I) ou dispensado. */
  etp: ExigenciaDocumento;
  matrizRiscos: ExigenciaDocumento;
  pesquisaPrecos: ExigenciaDocumento;
  termoReferencia: ExigenciaDocumento;
  edital: ExigenciaDocumento;
  minutaContrato: ExigenciaDocumento;
  parecerJuridico: ExigenciaDocumento;
  /** Aviso de contratação direta por 3 dias úteis com propostas adicionais (art. 75, § 3º). */
  avisoDispensa: boolean;
  /** Disputa e atos da seleção da licitação (arts. 33, 59 a 71). */
  selecaoLicitacao: boolean;
  /** Ato de autorização da contratação direta pela autoridade competente (art. 72, VIII). */
  autorizacaoContratacao: boolean;
  /** A jornada gera o contrato na etapa 7; no Sicx a conclusão da compra é a contratação (Decreto 13.106/2026, art. 21). */
  contratoNaJornada: boolean;
  origemContrato: 'licitacao' | 'contratacao_direta';
  /** Prazo de divulgação do contrato no PNCP (art. 94, I ou II). */
  divulgacaoContrato: 'licitacao' | 'contratacao_direta';
  documentos: DocumentoRota[];
}

const DOC_DFD: DocumentoRota = { id: 'dfd', titulo: 'Documento de formalização da demanda', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, I' };
const DOC_ESTIMATIVA: DocumentoRota = { id: 'estimativa', titulo: 'Estimativa de despesa (pesquisa de preços)', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, II, c/c art. 23' };
const DOC_ORCAMENTO: DocumentoRota = { id: 'orcamento', titulo: 'Compatibilidade da previsão de recursos orçamentários', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, IV' };
const DOC_HABILITACAO: DocumentoRota = { id: 'habilitacao', titulo: 'Comprovação de que o contratado preenche os requisitos de habilitação', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, V' };
const DOC_RAZAO: DocumentoRota = { id: 'razao_escolha', titulo: 'Razão da escolha do contratado', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, VI' };
const DOC_PRECO: DocumentoRota = { id: 'justificativa_preco', titulo: 'Justificativa de preço', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, VII' };
const DOC_AUTORIZACAO: DocumentoRota = { id: 'autorizacao', titulo: 'Autorização da autoridade competente', exigencia: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 72, VIII' };
const DOC_DIVULGACAO: DocumentoRota = {
  id: 'divulgacao',
  titulo: 'Divulgação do ato que autoriza a contratação direta ou do extrato do contrato',
  exigencia: 'obrigatorio',
  fundamento: 'Lei 14.133/2021, art. 72, parágrafo único, e art. 94, II',
};

function doc(id: string, titulo: string, exigencia: ExigenciaDocumento, fundamento: string): DocumentoRota {
  return { id, titulo, exigencia, fundamento };
}

function exigirRota(rota: RotaContratacao): void {
  if (!ROTAS_CONTRATACAO.includes(rota)) throw new ErroDominio('ROTA_INVALIDA', `Rota de contratação inválida: ${String(rota)}.`);
}

function porValor(hipotese: HipoteseDispensa | null | undefined): boolean {
  return hipotese === 'valor_obras_engenharia' || hipotese === 'valor_demais';
}

/**
 * Adaptação da jornada pela rota escolhida na etapa 1. Licitação: as regras da jornada sem mudança. Contratação
 * direta (dispensa e inexigibilidade): processo instruído com os documentos do art. 72, sem edital nem disputa da
 * licitação, com autorização da autoridade competente (art. 72, VIII) e divulgação do contrato em 10 dias úteis
 * (art. 94, II). Na dispensa por valor (art. 75, I e II): ETP e matriz de riscos facultativos (IN SEGES/ME 58/2022,
 * art. 14, I), contrato substituível por outro instrumento (art. 95, I) e aviso de dispensa eletrônica de 3 dias
 * úteis (art. 75, § 3º). Adesão a ata (art. 86, § 2º): o termo de referência e a seleção são os da ata; a adesão
 * exige vantagem, preços compatíveis, aceite do fornecedor e anuência do gerenciador. Sicx (art. 79, IV; Decreto
 * 13.106/2026): ETP específico ou abrangente, sem termo de referência nem edital (art. 15), com a compra concluída
 * na plataforma valendo como contratação (art. 21).
 */
export function adaptacaoDaRota(rota: RotaContratacao, hipoteseDispensa?: HipoteseDispensa | null): AdaptacaoRota {
  exigirRota(rota);
  if (rota === 'licitacao') {
    return {
      rota,
      titulo: 'Licitação',
      fundamento: 'Lei 14.133/2021, arts. 17 e 28',
      modalidade: 'Pregão ou concorrência eletrônica',
      etp: 'obrigatorio',
      matrizRiscos: 'obrigatorio',
      pesquisaPrecos: 'obrigatorio',
      termoReferencia: 'obrigatorio',
      edital: 'obrigatorio',
      minutaContrato: 'obrigatorio',
      parecerJuridico: 'obrigatorio',
      avisoDispensa: false,
      selecaoLicitacao: true,
      autorizacaoContratacao: false,
      contratoNaJornada: true,
      origemContrato: 'licitacao',
      divulgacaoContrato: 'licitacao',
      documentos: [
        DOC_DFD,
        doc('etp', 'Estudo técnico preliminar', 'obrigatorio', 'Lei 14.133/2021, art. 18, I e § 1º'),
        doc('matriz_riscos', 'Matriz de riscos', 'obrigatorio', 'Lei 14.133/2021, art. 18, X, e art. 22'),
        doc('estimativa', 'Pesquisa de preços', 'obrigatorio', 'Lei 14.133/2021, art. 23'),
        doc('tr', 'Termo de referência', 'obrigatorio', 'Lei 14.133/2021, art. 6º, XXIII'),
        doc('edital', 'Edital', 'obrigatorio', 'Lei 14.133/2021, art. 25'),
        doc('minuta_contrato', 'Minuta do contrato', 'obrigatorio', 'Lei 14.133/2021, art. 92'),
        doc('parecer', 'Parecer jurídico', 'obrigatorio', 'Lei 14.133/2021, art. 53'),
      ],
    };
  }
  if (rota === 'dispensa') {
    const valor = porValor(hipoteseDispensa);
    return {
      rota,
      titulo: valor ? 'Dispensa eletrônica por valor' : 'Dispensa de licitação',
      fundamento: valor ? `Lei 14.133/2021, art. 75, ${hipoteseDispensa === 'valor_obras_engenharia' ? 'I' : 'II'}, e §§ 1º e 3º` : 'Lei 14.133/2021, arts. 72 e 75',
      modalidade: valor ? `Dispensa eletrônica (art. 75, ${hipoteseDispensa === 'valor_obras_engenharia' ? 'I' : 'II'})` : 'Dispensa de licitação (art. 75)',
      etp: valor ? 'facultativo' : 'obrigatorio',
      matrizRiscos: valor ? 'facultativo' : 'obrigatorio',
      pesquisaPrecos: 'obrigatorio',
      termoReferencia: 'obrigatorio',
      edital: 'nao_se_aplica',
      minutaContrato: valor ? 'facultativo' : 'obrigatorio',
      parecerJuridico: 'obrigatorio',
      avisoDispensa: valor,
      selecaoLicitacao: false,
      autorizacaoContratacao: true,
      contratoNaJornada: true,
      origemContrato: 'contratacao_direta',
      divulgacaoContrato: 'contratacao_direta',
      documentos: [
        DOC_DFD,
        doc('etp', 'Estudo técnico preliminar', valor ? 'facultativo' : 'obrigatorio', valor ? 'IN SEGES/ME 58/2022, art. 14, I' : 'Lei 14.133/2021, art. 72, I'),
        doc('matriz_riscos', 'Análise de riscos', valor ? 'facultativo' : 'obrigatorio', 'Lei 14.133/2021, art. 72, I ("se for o caso")'),
        doc('tr', 'Termo de referência', 'obrigatorio', 'Lei 14.133/2021, art. 72, I'),
        DOC_ESTIMATIVA,
        doc('parecer', 'Parecer jurídico', 'obrigatorio', 'Lei 14.133/2021, art. 72, III, e art. 53, § 4º'),
        DOC_ORCAMENTO,
        ...(valor ? [doc('aviso', 'Aviso de contratação direta por 3 dias úteis, com propostas adicionais', 'obrigatorio', 'Lei 14.133/2021, art. 75, § 3º')] : []),
        DOC_HABILITACAO,
        DOC_RAZAO,
        DOC_PRECO,
        DOC_AUTORIZACAO,
        doc('minuta_contrato', 'Minuta do contrato', valor ? 'facultativo' : 'obrigatorio', valor ? 'Lei 14.133/2021, art. 95, I' : 'Lei 14.133/2021, art. 92'),
        DOC_DIVULGACAO,
      ],
    };
  }
  if (rota === 'inexigibilidade') {
    return {
      rota,
      titulo: 'Inexigibilidade de licitação',
      fundamento: 'Lei 14.133/2021, arts. 72 e 74',
      modalidade: 'Inexigibilidade (art. 74)',
      etp: 'obrigatorio',
      matrizRiscos: 'obrigatorio',
      pesquisaPrecos: 'obrigatorio',
      termoReferencia: 'obrigatorio',
      edital: 'nao_se_aplica',
      minutaContrato: 'obrigatorio',
      parecerJuridico: 'obrigatorio',
      avisoDispensa: false,
      selecaoLicitacao: false,
      autorizacaoContratacao: true,
      contratoNaJornada: true,
      origemContrato: 'contratacao_direta',
      divulgacaoContrato: 'contratacao_direta',
      documentos: [
        DOC_DFD,
        doc('etp', 'Estudo técnico preliminar', 'obrigatorio', 'Lei 14.133/2021, art. 72, I'),
        doc('matriz_riscos', 'Análise de riscos', 'obrigatorio', 'Lei 14.133/2021, art. 72, I'),
        doc('tr', 'Termo de referência', 'obrigatorio', 'Lei 14.133/2021, art. 72, I'),
        DOC_ESTIMATIVA,
        doc('inviabilidade', 'Comprovação da inviabilidade de competição na hipótese escolhida', 'obrigatorio', 'Lei 14.133/2021, art. 74, §§ 1º a 5º'),
        doc('parecer', 'Parecer jurídico', 'obrigatorio', 'Lei 14.133/2021, art. 72, III'),
        DOC_ORCAMENTO,
        DOC_HABILITACAO,
        DOC_RAZAO,
        DOC_PRECO,
        DOC_AUTORIZACAO,
        doc('minuta_contrato', 'Minuta do contrato', 'obrigatorio', 'Lei 14.133/2021, art. 92'),
        DOC_DIVULGACAO,
      ],
    };
  }
  if (rota === 'adesao_ata') {
    return {
      rota,
      titulo: 'Adesão a ata de registro de preços',
      fundamento: 'Lei 14.133/2021, art. 86, §§ 2º a 5º e 8º; Decreto 11.462/2023, arts. 31 e 32',
      modalidade: 'Adesão a ata de registro de preços (art. 86, § 2º)',
      etp: 'obrigatorio',
      matrizRiscos: 'obrigatorio',
      pesquisaPrecos: 'obrigatorio',
      termoReferencia: 'nao_se_aplica',
      edital: 'nao_se_aplica',
      minutaContrato: 'obrigatorio',
      parecerJuridico: 'obrigatorio',
      avisoDispensa: false,
      selecaoLicitacao: false,
      autorizacaoContratacao: true,
      contratoNaJornada: true,
      origemContrato: 'licitacao',
      divulgacaoContrato: 'licitacao',
      documentos: [
        DOC_DFD,
        doc('etp', 'Estudo técnico preliminar com a justificativa da vantagem da adesão', 'obrigatorio', 'Lei 14.133/2021, art. 86, § 2º, I'),
        doc('matriz_riscos', 'Matriz de riscos', 'obrigatorio', 'Lei 14.133/2021, art. 18, X'),
        doc('estimativa', 'Compatibilidade dos preços registrados com o mercado', 'obrigatorio', 'Lei 14.133/2021, art. 86, § 2º, II, c/c art. 23'),
        doc('aceite_fornecedor', 'Aceite do fornecedor', 'obrigatorio', 'Lei 14.133/2021, art. 86, § 2º, III; Decreto 11.462/2023, art. 31, § 1º'),
        doc('anuencia', 'Anuência do órgão gerenciador', 'obrigatorio', 'Lei 14.133/2021, art. 86, § 2º, III'),
        doc('parecer', 'Parecer jurídico', 'obrigatorio', 'Lei 14.133/2021, art. 53'),
        doc('minuta_contrato', 'Minuta do contrato', 'obrigatorio', 'Lei 14.133/2021, art. 92'),
        doc('contratacao_90_dias', 'Contratação em até 90 dias da anuência, na vigência da ata', 'obrigatorio', 'Decreto 11.462/2023, art. 31, § 2º'),
      ],
    };
  }
  return {
    rota,
    titulo: 'Comércio eletrônico (Sicx)',
    fundamento: 'Lei 14.133/2021, art. 79, IV e § 1º, VII, e art. 174, § 3º, VII (Lei 15.266/2025); Decreto 13.106/2026',
    modalidade: 'Comércio eletrônico — Sicx (art. 79, IV)',
    etp: 'obrigatorio',
    matrizRiscos: 'facultativo',
    pesquisaPrecos: 'facultativo',
    termoReferencia: 'nao_se_aplica',
    edital: 'nao_se_aplica',
    minutaContrato: 'nao_se_aplica',
    parecerJuridico: 'facultativo',
    avisoDispensa: false,
    selecaoLicitacao: false,
    autorizacaoContratacao: false,
    contratoNaJornada: false,
    origemContrato: 'contratacao_direta',
    divulgacaoContrato: 'contratacao_direta',
    documentos: [
      DOC_DFD,
      doc('etp', 'Estudo técnico preliminar específico ou abrangente', 'obrigatorio', 'Decreto 13.106/2026, arts. 12 a 14'),
      doc('estimativa', 'Estimativa a partir das ofertas da plataforma', 'facultativo', 'Decreto 13.106/2026, art. 16 e art. 36'),
      doc('tr', 'Termo de referência e edital da contratação', 'nao_se_aplica', 'Decreto 13.106/2026, art. 15'),
      doc('ordem_compra', 'Seleção da oferta e ordem de compra, por agente designado', 'obrigatorio', 'Decreto 13.106/2026, arts. 19 e 20, I'),
      doc('conclusao', 'Confirmação e conclusão da compra por outro agente', 'obrigatorio', 'Decreto 13.106/2026, art. 20, II e § 1º, e art. 21'),
      doc('recebimento', 'Recebimento provisório e definitivo', 'obrigatorio', 'Decreto 13.106/2026, art. 22'),
      doc('pagamento', 'Pagamento em até 30 dias do recebimento', 'obrigatorio', 'Lei 14.133/2021, art. 79, § 1º, VII, "e"; Decreto 13.106/2026, arts. 23 e 37'),
    ],
  };
}

// ───────────────────────── escolha da rota ─────────────────────────

export interface Pendencia {
  campo: string;
  mensagem: string;
}

export interface EntradaEscolhaRota {
  rota: RotaContratacao;
  hipoteseDispensa?: HipoteseDispensa | null;
  /** Inciso do art. 75 quando a dispensa não é por valor (ex.: "VIII"). */
  incisoDispensa?: string | null;
  hipoteseInexigibilidade?: HipoteseInexigibilidade | null;
  justificativa?: string | null;
  /** Ramo de atividade do objeto, para somar as despesas de mesma natureza (art. 75, § 1º, II). */
  natureza?: string | null;
  valorEstimado: Centavos | null;
  tipoObjeto: TipoObjetoDispensa;
  data: DataISO;
  tabela?: readonly LimiteDispensa[];
}

const INCISOS_ART_75_SEM_VALOR = ['III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];

/** Inciso III a XVI do art. 75, com a alínea quando houver (ex.: "VIII" ou "IV, c"). */
function incisoDispensaValido(texto: string): boolean {
  const m = /^([IVX]+)(?:\s*,\s*([a-m]))?$/i.exec(texto.trim());
  return m !== null && INCISOS_ART_75_SEM_VALOR.includes((m[1] ?? '').toUpperCase());
}

function suficiente(texto: string | null | undefined, minimo: number): boolean {
  return (texto ?? '').trim().length >= minimo;
}

/**
 * Confere a escolha da rota no início do processo. Dispensa por valor: a hipótese precisa corresponder ao tipo do
 * objeto (art. 75, I para obras e serviços de engenharia ou manutenção de veículos; II para os demais), o valor
 * estimado não pode superar o limite vigente (art. 182) e o ramo de atividade é obrigatório para o controle de
 * fracionamento (art. 75, § 1º). Outra hipótese do art. 75 exige o inciso e a justificativa. Inexigibilidade exige a
 * hipótese do art. 74 e a justificativa da inviabilidade de competição. Adesão e Sicx exigem a justificativa da
 * escolha da rota. Devolve as pendências (vazia = escolha válida) e o limite aplicado.
 */
export function validarEscolhaRota(
  e: EntradaEscolhaRota,
  minimoCaracteres = 30,
): { pendencias: Pendencia[]; limite: { valor: Centavos; norma: string; fundamento: string } | null; adaptacao: AdaptacaoRota; fundamento: string } {
  exigirRota(e.rota);
  lerData(e.data);
  if (e.valorEstimado !== null) exigirInteiro(e.valorEstimado, 'valorEstimado', 'ROTA_INVALIDA', 0);
  const pendencias: Pendencia[] = [];
  let limite: { valor: Centavos; norma: string; fundamento: string } | null = null;
  const adaptacao = adaptacaoDaRota(e.rota, e.hipoteseDispensa ?? null);
  if (e.rota !== 'licitacao' && !suficiente(e.justificativa, minimoCaracteres)) {
    pendencias.push({ campo: 'justificativa', mensagem: `Justifique a escolha da rota com pelo menos ${minimoCaracteres} caracteres (art. 72, I e VI).` });
  }
  if (e.rota === 'dispensa') {
    const hipotese = e.hipoteseDispensa ?? null;
    if (hipotese === null) {
      pendencias.push({ campo: 'hipoteseDispensa', mensagem: 'Informe a hipótese de dispensa do art. 75.' });
    } else if (porValor(hipotese)) {
      const esperado: HipoteseDispensa = e.tipoObjeto === 'obras_servicos_engenharia' ? 'valor_obras_engenharia' : 'valor_demais';
      if (hipotese !== esperado) {
        pendencias.push({
          campo: 'hipoteseDispensa',
          mensagem:
            esperado === 'valor_obras_engenharia'
              ? 'O objeto é obra ou serviço de engenharia: a dispensa por valor segue o art. 75, I.'
              : 'O objeto não é obra nem serviço de engenharia: a dispensa por valor segue o art. 75, II.',
        });
      }
      const vigente = limiteDispensaVigente(e.data, e.tipoObjeto, e.tabela);
      limite = { valor: vigente.valor, norma: vigente.norma, fundamento: vigente.fundamento };
      if (e.valorEstimado !== null && e.valorEstimado > vigente.valor) {
        pendencias.push({
          campo: 'valorEstimado',
          mensagem: `O valor estimado (${formatarMoeda(e.valorEstimado)}) supera o limite de ${formatarMoeda(vigente.valor)} da dispensa por valor (${vigente.norma}): licite o objeto ou use outro fundamento legal.`,
        });
      }
      if (!suficiente(e.natureza, 2)) {
        pendencias.push({ campo: 'natureza', mensagem: 'Informe o ramo de atividade do objeto para o controle de fracionamento (art. 75, § 1º, II).' });
      }
    } else {
      if (!incisoDispensaValido(e.incisoDispensa ?? '')) {
        pendencias.push({ campo: 'incisoDispensa', mensagem: 'Informe o inciso do art. 75 (III a XVI, com a alínea quando houver); os incisos I e II são a dispensa por valor.' });
      }
    }
  }
  if (e.rota === 'inexigibilidade' && !e.hipoteseInexigibilidade) {
    pendencias.push({ campo: 'hipoteseInexigibilidade', mensagem: 'Informe a hipótese de inexigibilidade do art. 74.' });
  }
  return { pendencias, limite, adaptacao, fundamento: adaptacao.fundamento };
}

// ───────────────────────── dispensa eletrônica (RN-41) ─────────────────────────

export interface SituacaoAvisoDispensa {
  publicadoEm: DataISO;
  /** Último dia do prazo: 3 dias úteis contados da divulgação, excluído o dia do começo (art. 183). */
  encerramento: DataISO;
  aberto: boolean;
  diasUteisRestantes: number;
  /** As propostas só são julgadas depois do encerramento do aviso. */
  julgamentoLiberado: boolean;
  mensagem: string;
  fundamento: string;
}

/**
 * Aviso de dispensa eletrônica: divulgado por no mínimo 3 dias úteis, com a especificação do objeto e a manifestação
 * de interesse em propostas adicionais (art. 75, § 3º). Enquanto o aviso está aberto (até o último dia útil do prazo,
 * inclusive), a Administração recebe propostas adicionais; o julgamento só começa no dia seguinte ao encerramento,
 * quando deve ser selecionada a proposta mais vantajosa.
 */
export function situacaoAvisoDispensa(p: { publicadoEm: DataISO; hoje: DataISO; opcoes?: OpcoesCalendario }): SituacaoAvisoDispensa {
  lerData(p.publicadoEm, 'publicadoEm');
  lerData(p.hoje, 'hoje');
  if (p.hoje < p.publicadoEm) throw new ErroDominio('DATA_INVALIDA', 'A data de referência é anterior à publicação do aviso.');
  const encerramento = adicionarDiasUteis(p.publicadoEm, 3, p.opcoes);
  const aberto = p.hoje <= encerramento;
  const restantes = aberto ? diasUteisEntre(p.hoje, encerramento, p.opcoes) : 0;
  const mensagem = aberto
    ? `Aviso aberto até ${formatarData(encerramento)} para propostas adicionais${restantes === 0 ? ' (último dia)' : ` (${contagem(restantes, 'dia útil restante', 'dias úteis restantes')})`}.`
    : `Aviso encerrado em ${formatarData(encerramento)}: as propostas podem ser julgadas.`;
  return {
    publicadoEm: p.publicadoEm,
    encerramento,
    aberto,
    diasUteisRestantes: restantes,
    julgamentoLiberado: !aberto,
    mensagem,
    fundamento: 'Lei 14.133/2021, art. 75, § 3º, c/c art. 183',
  };
}

export interface PropostaDispensa {
  id: string;
  fornecedorId: string;
  valor: Centavos;
  /** Instante ISO do recebimento. */
  recebidaEm: string;
  /** Recebida durante o aviso, além das propostas da pesquisa de preços. */
  adicional: boolean;
}

/**
 * Julgamento das propostas da dispensa por valor: seleciona a proposta mais vantajosa (menor preço; no empate, a
 * recebida primeiro) entre as que cabem no limite da dispensa (art. 75, I ou II). Proposta acima do limite é
 * desclassificada; acima do valor estimado vira sinal para a justificativa de preço (art. 72, VII). Só um fornecedor
 * por proposta vale (a mais recente substitui as anteriores).
 */
export function julgarPropostasDispensa(p: { propostas: readonly PropostaDispensa[]; limite: Centavos; valorEstimado: Centavos | null }): {
  classificadas: PropostaDispensa[];
  desclassificadas: { proposta: PropostaDispensa; motivo: string }[];
  selecionada: PropostaDispensa | null;
  sinais: string[];
  fundamento: string;
} {
  exigirInteiro(p.limite, 'limite', 'PROPOSTA_INVALIDA', 0);
  const porFornecedor = new Map<string, PropostaDispensa>();
  for (const proposta of p.propostas) {
    exigirInteiro(proposta.valor, 'valor', 'PROPOSTA_INVALIDA', 1);
    const anterior = porFornecedor.get(proposta.fornecedorId);
    if (!anterior || anterior.recebidaEm <= proposta.recebidaEm) porFornecedor.set(proposta.fornecedorId, proposta);
  }
  const desclassificadas: { proposta: PropostaDispensa; motivo: string }[] = [];
  const validas: PropostaDispensa[] = [];
  for (const proposta of porFornecedor.values()) {
    if (proposta.valor > p.limite) {
      desclassificadas.push({ proposta, motivo: `Valor de ${formatarMoeda(proposta.valor)} acima do limite de ${formatarMoeda(p.limite)} da dispensa por valor.` });
    } else validas.push(proposta);
  }
  validas.sort((a, b) => a.valor - b.valor || a.recebidaEm.localeCompare(b.recebidaEm) || a.id.localeCompare(b.id));
  const selecionada = validas[0] ?? null;
  const sinais: string[] = [];
  if (selecionada && p.valorEstimado !== null && selecionada.valor > p.valorEstimado) {
    sinais.push(`A proposta mais vantajosa (${formatarMoeda(selecionada.valor)}) supera o valor estimado (${formatarMoeda(p.valorEstimado)}): fundamente a justificativa de preço (art. 72, VII).`);
  }
  if (validas.length === 1) sinais.push('Só uma proposta válida: registre na razão da escolha que o aviso foi divulgado e não houve outras propostas.');
  return { classificadas: validas, desclassificadas, selecionada, sinais, fundamento: 'Lei 14.133/2021, art. 75, § 3º, e art. 72, VI e VII' };
}

// ───────────────────────── fracionamento por objeto (RIA-01) ─────────────────────────

export type OrigemDespesa = 'dispensa' | 'cartao' | 'sicx' | 'licitacao';

export interface DespesaExercicio {
  valor: Centavos;
  /** Ramo de atividade (mesma natureza = mesmo ramo, art. 75, § 1º, II). */
  natureza: string;
  data: DataISO;
  origem: OrigemDespesa;
  tipo: TipoObjetoDispensa;
}

function normalizarNatureza(n: string): string {
  return n.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Controle de fracionamento por exercício e por objeto: soma o despendido no exercício pela unidade gestora com
 * dispensas por valor de mesma natureza (art. 75, § 1º, I e II) — inclusive as pagas com cartão de pagamento, que são
 * dispensas dos incisos I e II (art. 75, § 4º) — e compara com o limite (`avaliarFracionamento`). Compras pelo Sicx e
 * licitações não entram na soma: o § 1º só trata das dispensas dos incisos I e II, o Sicx é hipótese de credenciamento
 * (art. 79, IV) e o Decreto 13.106/2026 não cria limite por valor. É sinal para análise; a decisão é humana.
 */
export function avaliarFracionamentoPorObjeto(e: {
  data: DataISO;
  tipo: TipoObjetoDispensa;
  natureza: string;
  despesas: readonly DespesaExercicio[];
  novaContratacao: Centavos;
  tabela?: readonly LimiteDispensa[];
}): ReturnType<typeof avaliarFracionamento> & { consideradas: number; desconsideradas: number; natureza: string } {
  if (typeof e.natureza !== 'string' || e.natureza.trim().length < 2) throw new ErroDominio('FRACIONAMENTO_INVALIDO', 'Informe o ramo de atividade do objeto.');
  const exercicio = e.data.slice(0, 4);
  lerData(e.data);
  const alvo = normalizarNatureza(e.natureza);
  const consideradas: Centavos[] = [];
  let desconsideradas = 0;
  for (const d of e.despesas) {
    lerData(d.data, 'despesas.data');
    const mesmaNatureza = normalizarNatureza(d.natureza) === alvo && d.tipo === e.tipo && d.data.slice(0, 4) === exercicio;
    if (!mesmaNatureza) continue;
    if (d.origem === 'dispensa' || d.origem === 'cartao') consideradas.push(d.valor);
    else desconsideradas += 1;
  }
  const base = avaliarFracionamento({
    data: e.data,
    tipo: e.tipo,
    contratacoesMesmaNaturezaNoExercicio: consideradas,
    novaContratacao: e.novaContratacao,
    ...(e.tabela ? { tabela: e.tabela } : {}),
  });
  const extra =
    desconsideradas > 0
      ? ` ${contagem(desconsideradas, 'contratação do mesmo ramo pelo Sicx ou por licitação não entra', 'contratações do mesmo ramo pelo Sicx ou por licitação não entram')} na soma.`
      : '';
  return {
    ...base,
    explicacao: `Ramo de atividade "${e.natureza.trim()}" no exercício de ${exercicio}: ${contagem(consideradas.length, 'dispensa anterior', 'dispensas anteriores')} (inclusive cartão de pagamento). ${base.explicacao}${extra}`,
    consideradas: consideradas.length,
    desconsideradas,
    natureza: e.natureza.trim(),
  };
}

// ───────────────────────── inexigibilidade (art. 74) ─────────────────────────

export interface HipoteseInexigibilidadeInfo {
  hipotese: HipoteseInexigibilidade;
  inciso: string;
  titulo: string;
  comprovacao: string;
  fundamento: string;
}

export const HIPOTESES_INEXIGIBILIDADE: readonly HipoteseInexigibilidadeInfo[] = Object.freeze([
  {
    hipotese: 'exclusividade',
    inciso: 'I',
    titulo: 'Fornecedor ou prestador exclusivo',
    comprovacao: 'Atestado, contrato, declaração, carta de exclusividade ou outro documento idôneo; vedada a preferência por marca',
    fundamento: 'Lei 14.133/2021, art. 74, I e § 1º',
  },
  {
    hipotese: 'artista',
    inciso: 'II',
    titulo: 'Profissional do setor artístico consagrado',
    comprovacao: 'Consagração pela crítica ou pela opinião pública e, por empresário, exclusividade permanente e contínua',
    fundamento: 'Lei 14.133/2021, art. 74, II e § 2º',
  },
  {
    hipotese: 'notoria_especializacao',
    inciso: 'III',
    titulo: 'Serviço técnico especializado de natureza predominantemente intelectual, com notória especialização',
    comprovacao: 'Desempenho anterior, estudos, experiência, publicações, organização, aparelhamento ou equipe técnica',
    fundamento: 'Lei 14.133/2021, art. 74, III e §§ 3º e 4º',
  },
  {
    hipotese: 'credenciamento',
    inciso: 'IV',
    titulo: 'Objeto contratado por credenciamento',
    comprovacao: 'Edital de chamamento divulgado, com condições padronizadas e, quando couber, o valor da contratação',
    fundamento: 'Lei 14.133/2021, art. 74, IV, e art. 79',
  },
  {
    hipotese: 'imovel',
    inciso: 'V',
    titulo: 'Aquisição ou locação de imóvel cuja instalação e localização tornem necessária a escolha',
    comprovacao: 'Avaliação prévia, certificação da inexistência de imóvel público disponível e justificativa da singularidade',
    fundamento: 'Lei 14.133/2021, art. 74, V e § 5º',
  },
]);

export const ALINEAS_NOTORIA_ESPECIALIZACAO: readonly { alinea: string; servico: string }[] = Object.freeze([
  { alinea: 'a', servico: 'estudos técnicos, planejamentos, projetos básicos ou executivos' },
  { alinea: 'b', servico: 'pareceres, perícias e avaliações em geral' },
  { alinea: 'c', servico: 'assessorias ou consultorias técnicas e auditorias financeiras ou tributárias' },
  { alinea: 'd', servico: 'fiscalização, supervisão ou gerenciamento de obras ou serviços' },
  { alinea: 'e', servico: 'patrocínio ou defesa de causas judiciais ou administrativas' },
  { alinea: 'f', servico: 'treinamento e aperfeiçoamento de pessoal' },
  { alinea: 'g', servico: 'restauração de obras de arte e de bens de valor histórico' },
  { alinea: 'h', servico: 'controles de qualidade e tecnológico, análises, testes e ensaios, instalação e montagem de equipamentos' },
]);

export interface ComprovacaoInexigibilidade {
  hipotese: HipoteseInexigibilidade;
  justificativaInviabilidade: string | null;
  /** I: tipo do documento de exclusividade. */
  documentoExclusividade?: 'atestado' | 'contrato' | 'declaracao' | 'carta_exclusividade' | 'outro' | null;
  /** I: declaração de que a especificação não indica marca (vedada a preferência por marca). */
  semPreferenciaMarca?: boolean;
  /** II: consagração pela crítica especializada ou pela opinião pública. */
  consagracao?: string | null;
  /** II: contratação por empresário exclusivo (exige exclusividade permanente e contínua). */
  porEmpresario?: boolean;
  exclusividadePermanente?: boolean;
  /** III: alínea do inciso III e elementos de notória especialização. */
  alinea?: string | null;
  elementosNotoriaEspecializacao?: string | null;
  /** III: serviço de publicidade e divulgação (vedado). */
  publicidade?: boolean;
  /** IV: referência ao edital de chamamento do credenciamento. */
  editalChamamento?: string | null;
  /** V: requisitos do § 5º. */
  avaliacaoPrevia?: boolean;
  semImovelPublicoDisponivel?: boolean;
  justificativaSingularidade?: string | null;
}

/**
 * Comprovação da inexigibilidade: justificativa da inviabilidade de competição e os elementos exigidos pela hipótese
 * (art. 74, §§ 1º a 5º). Devolve as pendências; a conclusão sobre a inexigibilidade é do agente e do parecer
 * jurídico (art. 72, III), nunca do sistema.
 */
export function validarInexigibilidade(c: ComprovacaoInexigibilidade, minimoCaracteres = 30): { pendencias: Pendencia[]; fundamento: string } {
  const info = HIPOTESES_INEXIGIBILIDADE.find((h) => h.hipotese === c.hipotese);
  if (!info) throw new ErroDominio('INEXIGIBILIDADE_INVALIDA', `Hipótese de inexigibilidade inválida: ${String(c.hipotese)}.`);
  const pendencias: Pendencia[] = [];
  if (!suficiente(c.justificativaInviabilidade, minimoCaracteres)) {
    pendencias.push({ campo: 'justificativaInviabilidade', mensagem: `Demonstre a inviabilidade de competição com pelo menos ${minimoCaracteres} caracteres (art. 74, caput).` });
  }
  switch (c.hipotese) {
    case 'exclusividade':
      if (!c.documentoExclusividade) pendencias.push({ campo: 'documentoExclusividade', mensagem: 'Junte o documento que comprova a exclusividade (atestado, contrato, declaração ou carta de exclusividade — art. 74, § 1º).' });
      if (c.semPreferenciaMarca !== true) pendencias.push({ campo: 'semPreferenciaMarca', mensagem: 'Confirme que a especificação não indica preferência por marca (art. 74, § 1º).' });
      break;
    case 'artista':
      if (!suficiente(c.consagracao, minimoCaracteres)) pendencias.push({ campo: 'consagracao', mensagem: 'Demonstre a consagração do artista pela crítica especializada ou pela opinião pública (art. 74, II).' });
      if (c.porEmpresario && c.exclusividadePermanente !== true) {
        pendencias.push({ campo: 'exclusividadePermanente', mensagem: 'O empresário precisa de exclusividade permanente e contínua; representação restrita a evento ou local não serve (art. 74, § 2º).' });
      }
      break;
    case 'notoria_especializacao':
      if (c.publicidade === true) pendencias.push({ campo: 'publicidade', mensagem: 'É vedada a inexigibilidade para serviços de publicidade e divulgação (art. 74, III).' });
      if (!ALINEAS_NOTORIA_ESPECIALIZACAO.some((a) => a.alinea === (c.alinea ?? '').trim().toLowerCase())) {
        pendencias.push({ campo: 'alinea', mensagem: 'Indique o serviço técnico especializado (alíneas "a" a "h" do art. 74, III).' });
      }
      if (!suficiente(c.elementosNotoriaEspecializacao, minimoCaracteres)) {
        pendencias.push({ campo: 'elementosNotoriaEspecializacao', mensagem: 'Descreva os elementos da notória especialização (desempenho anterior, estudos, experiência, publicações, equipe técnica — art. 74, § 3º).' });
      }
      break;
    case 'credenciamento':
      if (!suficiente(c.editalChamamento, 5)) pendencias.push({ campo: 'editalChamamento', mensagem: 'Informe o edital de chamamento do credenciamento divulgado em sítio oficial (art. 79, parágrafo único, I).' });
      break;
    case 'imovel':
      if (c.avaliacaoPrevia !== true) pendencias.push({ campo: 'avaliacaoPrevia', mensagem: 'Registre a avaliação prévia do imóvel, do estado de conservação, das adaptações e da amortização (art. 74, § 5º, I).' });
      if (c.semImovelPublicoDisponivel !== true) pendencias.push({ campo: 'semImovelPublicoDisponivel', mensagem: 'Certifique a inexistência de imóvel público vago e disponível que atenda ao objeto (art. 74, § 5º, II).' });
      if (!suficiente(c.justificativaSingularidade, minimoCaracteres)) pendencias.push({ campo: 'justificativaSingularidade', mensagem: 'Justifique a singularidade do imóvel e a vantagem para a Administração (art. 74, § 5º, III).' });
      break;
  }
  return { pendencias, fundamento: info.fundamento };
}

// ───────────────────────── adesão a ata (art. 86, §§ 2º a 5º) ─────────────────────────

export type EsferaFederativa = 'federal' | 'estadual' | 'distrital' | 'municipal';

export interface EntradaAdesaoAta {
  /** Quantidade do item registrada para o gerenciador e os participantes. */
  quantidadeRegistrada: number;
  /** Já aderido por este órgão ou entidade (adesões autorizadas ou contratadas). */
  quantidadeAderidaPeloOrgao: number;
  /** Já aderido por todos os não participantes. */
  quantidadeAderidaTotal: number;
  quantidadeSolicitada: number;
  ataVigente: boolean;
  /** O edital da licitação previu a adesão por não participantes (art. 86, § 2º). */
  ataAceitaAdesao: boolean;
  esferaGerenciador: EsferaFederativa;
  esferaAderente: EsferaFederativa;
  /** O aderente participou do registro (participante não adere, contrata pela própria ata). */
  aderenteParticipante: boolean;
}

/**
 * Limites da adesão de órgão não participante: até 50% dos quantitativos de cada item registrados para o gerenciador e
 * os participantes, por órgão ou entidade (§ 4º), e, no total das adesões, até o dobro desses quantitativos (§ 5º).
 * Órgão federal não adere a ata gerenciada por órgão estadual, distrital ou municipal (§ 8º). A ata deve estar vigente
 * e ter previsto a adesão. Pedido acima do limite é recusado — nunca cortado em silêncio.
 */
export function avaliarAdesaoAta(e: EntradaAdesaoAta): {
  permitida: boolean;
  limitePorOrgao: number;
  limiteTotal: number;
  saldoOrgao: number;
  saldoTotal: number;
  recusas: string[];
  fundamento: string;
} {
  exigirInteiro(e.quantidadeRegistrada, 'quantidadeRegistrada', 'ADESAO_INVALIDA', 0);
  exigirInteiro(e.quantidadeAderidaPeloOrgao, 'quantidadeAderidaPeloOrgao', 'ADESAO_INVALIDA', 0);
  exigirInteiro(e.quantidadeAderidaTotal, 'quantidadeAderidaTotal', 'ADESAO_INVALIDA', 0);
  exigirInteiro(e.quantidadeSolicitada, 'quantidadeSolicitada', 'ADESAO_INVALIDA', 1);
  const limitePorOrgao = Math.floor(e.quantidadeRegistrada / 2);
  const limiteTotal = e.quantidadeRegistrada * 2;
  const saldoOrgao = Math.max(0, limitePorOrgao - e.quantidadeAderidaPeloOrgao);
  const saldoTotal = Math.max(0, limiteTotal - e.quantidadeAderidaTotal);
  const recusas: string[] = [];
  if (!e.ataVigente) recusas.push('A ata não está vigente: não cabe adesão (art. 84).');
  if (!e.ataAceitaAdesao) recusas.push('O edital da licitação não previu a adesão por órgãos não participantes (art. 86, § 2º).');
  if (e.aderenteParticipante) recusas.push('O órgão é participante da ata: contrata pela própria ata, sem adesão (art. 86, caput).');
  if (e.esferaAderente === 'federal' && e.esferaGerenciador !== 'federal') {
    recusas.push('Órgão ou entidade federal não pode aderir a ata gerenciada por órgão estadual, distrital ou municipal (art. 86, § 8º).');
  }
  if (e.quantidadeSolicitada > saldoOrgao) {
    recusas.push(
      `A quantidade solicitada (${e.quantidadeSolicitada}) supera o limite por órgão aderente: até 50% da quantidade registrada (${limitePorOrgao}), com ${e.quantidadeAderidaPeloOrgao} já aderida(s) por este órgão — saldo ${saldoOrgao} (art. 86, § 4º).`,
    );
  }
  if (e.quantidadeSolicitada > saldoTotal) {
    recusas.push(
      `A quantidade solicitada (${e.quantidadeSolicitada}) supera o limite total das adesões: o dobro da quantidade registrada (${limiteTotal}), com ${e.quantidadeAderidaTotal} já aderida(s) — saldo ${saldoTotal} (art. 86, § 5º).`,
    );
  }
  return { permitida: recusas.length === 0, limitePorOrgao, limiteTotal, saldoOrgao, saldoTotal, recusas, fundamento: 'Lei 14.133/2021, art. 86, §§ 2º a 5º e 8º; Decreto 11.462/2023, art. 32' };
}

/**
 * Prazo para contratar a adesão: até 90 dias da autorização do gerenciador, observada a vigência da ata (Decreto
 * 11.462/2023, art. 31, § 2º). A autorização só vem depois do aceite do fornecedor (art. 31, § 1º).
 */
export function prazoContratacaoAdesao(p: { autorizadaEm: DataISO; vigenciaFimAta: DataISO; hoje: DataISO }): {
  limite: DataISO;
  vencido: boolean;
  diasRestantes: number;
  fundamento: string;
} {
  lerData(p.autorizadaEm, 'autorizadaEm');
  lerData(p.vigenciaFimAta, 'vigenciaFimAta');
  lerData(p.hoje, 'hoje');
  const noventa = adicionarDias(p.autorizadaEm, 90);
  const limite = noventa < p.vigenciaFimAta ? noventa : p.vigenciaFimAta;
  return { limite, vencido: p.hoje > limite, diasRestantes: Math.max(0, diasEntre(p.hoje, limite)), fundamento: 'Decreto 11.462/2023, art. 31, § 2º' };
}

// ───────────────────────── Sicx — comércio eletrônico (RN-42) ─────────────────────────

/** Prazo máximo de pagamento no comércio eletrônico, contado do recebimento (art. 79, § 1º, VII, "e"). */
export const PRAZO_MAXIMO_PAGAMENTO_SICX_DIAS = 30;

export interface FaixaPrecoSicx {
  /** A partir desta quantidade vale o preço unitário da faixa (preço escalonado, Decreto 13.106/2026, art. 11, § 3º). */
  aPartirDe: number;
  precoUnitario: Centavos;
}

export interface OfertaSicx {
  id: string;
  fornecedorId: string;
  precoUnitario: Centavos;
  faixas: readonly FaixaPrecoSicx[];
  /** UFs atendidas (oferta por localidade, art. 11). */
  localidades: readonly string[];
  prazoEntregaDias: number;
  prazoPagamentoDias: number;
  /** Restrição no Cadin: não é apta para comprador público (art. 17, § 1º). */
  restricaoCadin: boolean;
  credenciada: boolean;
  /** Reputação de 0 a 5: auxiliar e classificatória, sem caráter de sanção (art. 30). */
  reputacao: number;
}

export interface OfertaRanqueada {
  oferta: OfertaSicx;
  posicao: number;
  precoUnitario: Centavos;
  valorTotal: Centavos;
  /** Empate em valor resolvido pela reputação e, persistindo, por sorteio determinístico (art. 18). */
  desempate: 'nenhum' | 'reputacao' | 'sorteio';
}

function precoNaQuantidade(oferta: OfertaSicx, quantidade: number): Centavos {
  let preco = oferta.precoUnitario;
  let faixaAtual = 0;
  for (const faixa of oferta.faixas) {
    if (quantidade >= faixa.aPartirDe && faixa.aPartirDe >= faixaAtual) {
      preco = faixa.precoUnitario;
      faixaAtual = faixa.aPartirDe;
    }
  }
  return preco;
}

/** Hash FNV-1a de 32 bits: ordem estável do sorteio sem depender de aleatoriedade. */
function sorteioEstavel(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Ranqueamento automático das ofertas aptas do Sicx (Decreto 13.106/2026, art. 17): só ofertas credenciadas, sem
 * restrição no Cadin, que atendem à localidade do comprador e com prazo de pagamento de até 30 dias; ordena pelo valor
 * total na quantidade pedida (com o preço escalonado da faixa). No empate, a reputação desempata (art. 30, caráter
 * auxiliar) e, persistindo, o sorteio (art. 18, parágrafo único) — aqui um sorteio determinístico e auditável pela
 * semente informada. Os critérios de ranqueamento do órgão central ainda dependem de ato da SGI (art. 17, § 2º).
 */
export function ranquearOfertasSicx(p: { ofertas: readonly OfertaSicx[]; quantidade: number; uf: string; semente: string }): {
  ranqueadas: OfertaRanqueada[];
  inaptas: { oferta: OfertaSicx; motivo: string }[];
  fundamento: string;
} {
  exigirInteiro(p.quantidade, 'quantidade', 'SICX_INVALIDO', 1);
  const uf = p.uf.trim().toUpperCase();
  const inaptas: { oferta: OfertaSicx; motivo: string }[] = [];
  const aptas: { oferta: OfertaSicx; precoUnitario: Centavos; valorTotal: Centavos; sorteio: number }[] = [];
  for (const oferta of p.ofertas) {
    if (!oferta.credenciada) inaptas.push({ oferta, motivo: 'Fornecedor não credenciado no edital do Sicx.' });
    else if (oferta.restricaoCadin) inaptas.push({ oferta, motivo: 'Fornecedor com restrição no Cadin: não é apto para comprador público (Decreto 13.106/2026, art. 17, § 1º).' });
    else if (!oferta.localidades.map((l) => l.toUpperCase()).includes(uf)) inaptas.push({ oferta, motivo: `A oferta não atende à localidade ${uf}.` });
    else if (oferta.prazoPagamentoDias > PRAZO_MAXIMO_PAGAMENTO_SICX_DIAS) inaptas.push({ oferta, motivo: 'Prazo de pagamento acima de 30 dias (art. 79, § 1º, VII, "e").' });
    else {
      const precoUnitario = precoNaQuantidade(oferta, p.quantidade);
      aptas.push({ oferta, precoUnitario, valorTotal: precoUnitario * p.quantidade, sorteio: sorteioEstavel(`${p.semente}|${oferta.id}`) });
    }
  }
  aptas.sort((a, b) => a.valorTotal - b.valorTotal || b.oferta.reputacao - a.oferta.reputacao || a.sorteio - b.sorteio);
  const ranqueadas = aptas.map((a, i): OfertaRanqueada => {
    const vizinhos = aptas.filter((o) => o !== a && o.valorTotal === a.valorTotal);
    const desempate = vizinhos.length === 0 ? 'nenhum' : vizinhos.some((o) => o.oferta.reputacao === a.oferta.reputacao) ? 'sorteio' : 'reputacao';
    return { oferta: a.oferta, posicao: i + 1, precoUnitario: a.precoUnitario, valorTotal: a.valorTotal, desempate };
  });
  return { ranqueadas, inaptas, fundamento: 'Decreto 13.106/2026, arts. 11, 17, 18 e 30; Lei 14.133/2021, art. 79, IV' };
}

/**
 * Seleção da oferta e segregação dos agentes da compra no Sicx: a melhor oferta ranqueada é selecionada sem
 * justificativa; outra exige justificativa específica (art. 19). Para comprador público, quem seleciona e emite a
 * ordem de compra não pode ser quem confirma e conclui a compra, salvo autorização prévia no ETP abrangente
 * (art. 20, § 1º, c/c art. 13, § 1º, II).
 */
export function validarCompraSicx(p: {
  posicaoSelecionada: number;
  justificativaSelecao: string | null;
  agenteOrdemId: string;
  agenteConclusaoId: string | null;
  autorizacaoPrevia: boolean;
  minimoCaracteres?: number;
}): { pendencias: Pendencia[]; fundamento: string } {
  exigirInteiro(p.posicaoSelecionada, 'posicaoSelecionada', 'SICX_INVALIDO', 1);
  const minimo = p.minimoCaracteres ?? 30;
  const pendencias: Pendencia[] = [];
  if (p.posicaoSelecionada > 1 && !suficiente(p.justificativaSelecao, minimo)) {
    pendencias.push({ campo: 'justificativaSelecao', mensagem: `A oferta escolhida não é a mais bem ranqueada: registre a justificativa específica com pelo menos ${minimo} caracteres (Decreto 13.106/2026, art. 19).` });
  }
  if (p.agenteConclusaoId !== null && p.agenteConclusaoId === p.agenteOrdemId && !p.autorizacaoPrevia) {
    pendencias.push({
      campo: 'agenteConclusao',
      mensagem: 'Quem selecionou a oferta e emitiu a ordem de compra não pode confirmar e concluir a compra sem autorização prévia no ETP abrangente (Decreto 13.106/2026, art. 20, § 1º).',
    });
  }
  return { pendencias, fundamento: 'Decreto 13.106/2026, arts. 19 e 20' };
}

export interface PrazosCompraSicx {
  limiteRecebimentoProvisorio: DataISO | null;
  limiteRecebimentoDefinitivo: DataISO | null;
  /** Prazo sem manifestação: o recebimento é tácito, com aviso ao comprador e reflexo na reputação (art. 22, §§ 2º e 3º). */
  recebimentoTacito: boolean;
  limitePagamento: DataISO | null;
  pagamentoVencido: boolean;
  situacao: 'aguardando_entrega' | 'aguardando_recebimento_provisorio' | 'aguardando_recebimento_definitivo' | 'aguardando_pagamento' | 'paga';
  mensagem: string;
  fundamento: string;
}

/**
 * Prazos da compra concluída no Sicx: recebimento provisório em até 2 dias úteis do registro da entrega; definitivo em
 * até 10 dias do provisório, ou no prazo do edital, nunca acima de 30 (Decreto 13.106/2026, art. 22); sem manifestação
 * no prazo, recebimento tácito (§ 2º). O pagamento é liberado com o recebimento definitivo, expresso ou tácito
 * (art. 23), e deve ocorrer em até 30 dias contados do recebimento (art. 79, § 1º, VII, "e"; Decreto, art. 37).
 */
export function prazosCompraSicx(p: {
  entregaRegistradaEm: DataISO | null;
  recebimentoProvisorioEm: DataISO | null;
  recebimentoDefinitivoEm: DataISO | null;
  pagoEm: DataISO | null;
  prazoDefinitivoDias?: number;
  hoje: DataISO;
  opcoes?: OpcoesCalendario;
}): PrazosCompraSicx {
  lerData(p.hoje, 'hoje');
  const prazoDefinitivo = p.prazoDefinitivoDias ?? 10;
  exigirInteiro(prazoDefinitivo, 'prazoDefinitivoDias', 'SICX_INVALIDO', 1);
  if (prazoDefinitivo > 30) throw new ErroDominio('SICX_INVALIDO', 'O prazo do recebimento definitivo não pode passar de 30 dias (Decreto 13.106/2026, art. 22).');
  const fundamento = 'Decreto 13.106/2026, arts. 22, 23 e 37; Lei 14.133/2021, art. 79, § 1º, VII, "e"';
  if (p.entregaRegistradaEm === null) {
    return { limiteRecebimentoProvisorio: null, limiteRecebimentoDefinitivo: null, recebimentoTacito: false, limitePagamento: null, pagamentoVencido: false, situacao: 'aguardando_entrega', mensagem: 'Aguardando o registro da entrega pelo fornecedor.', fundamento };
  }
  const limiteProvisorio = adicionarDiasUteis(p.entregaRegistradaEm, 2, p.opcoes);
  const provisorio = p.recebimentoProvisorioEm ?? (p.hoje > limiteProvisorio ? limiteProvisorio : null);
  const limiteDefinitivo = provisorio ? adicionarDias(provisorio, prazoDefinitivo) : null;
  const tacitoProvisorio = p.recebimentoProvisorioEm === null && provisorio !== null;
  const definitivo = p.recebimentoDefinitivoEm ?? (limiteDefinitivo && p.hoje > limiteDefinitivo ? limiteDefinitivo : null);
  const tacito = tacitoProvisorio || (p.recebimentoDefinitivoEm === null && definitivo !== null);
  const limitePagamento = definitivo ? adicionarDias(definitivo, PRAZO_MAXIMO_PAGAMENTO_SICX_DIAS) : null;
  const pagamentoVencido = limitePagamento !== null && p.pagoEm === null && p.hoje > limitePagamento;
  let situacao: PrazosCompraSicx['situacao'];
  let mensagem: string;
  if (p.pagoEm !== null) {
    situacao = 'paga';
    mensagem = `Compra paga em ${formatarData(p.pagoEm)}${limitePagamento && p.pagoEm > limitePagamento ? ', depois do prazo de 30 dias do recebimento' : ''}.`;
  } else if (definitivo) {
    situacao = 'aguardando_pagamento';
    mensagem = pagamentoVencido
      ? `Pagamento vencido desde ${formatarData(limitePagamento as DataISO)} (30 dias do recebimento definitivo).`
      : `Pagamento liberado: pague até ${formatarData(limitePagamento as DataISO)} (30 dias do recebimento definitivo${tacito ? ' tácito' : ''}).`;
  } else if (provisorio) {
    situacao = 'aguardando_recebimento_definitivo';
    mensagem = `Registre o recebimento definitivo até ${formatarData(limiteDefinitivo as DataISO)}; sem manifestação, o recebimento é tácito.`;
  } else {
    situacao = 'aguardando_recebimento_provisorio';
    mensagem = `Registre o recebimento provisório até ${formatarData(limiteProvisorio)} (2 dias úteis da entrega); sem manifestação, o recebimento é tácito.`;
  }
  return {
    limiteRecebimentoProvisorio: limiteProvisorio,
    limiteRecebimentoDefinitivo: limiteDefinitivo,
    recebimentoTacito: tacito,
    limitePagamento,
    pagamentoVencido,
    situacao,
    mensagem,
    fundamento,
  };
}

/**
 * Controle de valores do Sicx: no ETP abrangente o comprador reserva um limite de valor para as linhas de fornecimento
 * e autoriza previamente as compras até esse limite (Decreto 13.106/2026, art. 13, § 1º, I e II). Compra que
 * ultrapassa o saldo da reserva é recusada; a partir de 80% do limite, sinal de atenção.
 */
export function avaliarReservaSicx(p: { limite: Centavos; utilizado: Centavos; novaCompra: Centavos }): {
  permitida: boolean;
  saldo: Centavos;
  saldoAposCompra: Centavos;
  percentualUtilizado: number;
  sinal: 'sem_risco' | 'atencao' | 'esgotado';
  mensagem: string;
  fundamento: string;
} {
  exigirInteiro(p.limite, 'limite', 'SICX_INVALIDO', 1);
  exigirInteiro(p.utilizado, 'utilizado', 'SICX_INVALIDO', 0);
  exigirInteiro(p.novaCompra, 'novaCompra', 'SICX_INVALIDO', 1);
  const saldo = Math.max(0, p.limite - p.utilizado);
  const depois = p.utilizado + p.novaCompra;
  const permitida = depois <= p.limite;
  const percentualUtilizado = percentual(depois, p.limite);
  const sinal = !permitida ? 'esgotado' : depois * 10 >= p.limite * 8 ? 'atencao' : 'sem_risco';
  const mensagem = permitida
    ? `A compra usa ${formatarMoeda(p.novaCompra)} da reserva; restam ${formatarMoeda(p.limite - depois)} (${formatarPercentualTexto(percentualUtilizado)} do limite utilizado).`
    : `A compra de ${formatarMoeda(p.novaCompra)} supera o saldo de ${formatarMoeda(saldo)} da reserva de limite do ETP abrangente.`;
  return { permitida, saldo, saldoAposCompra: Math.max(0, p.limite - depois), percentualUtilizado, sinal, mensagem, fundamento: 'Decreto 13.106/2026, art. 13, § 1º, I e II' };
}

// ───────────────────────── cartão de pagamento (art. 75, § 4º) ─────────────────────────

/**
 * Compra paga com cartão de pagamento: só para as contratações por valor do art. 75, I e II (§ 4º), dentro do limite
 * vigente, e com o ramo de atividade informado — a compra entra na soma do fracionamento (§ 1º). Devolve as pendências.
 */
export function validarCompraCartao(p: { data: DataISO; tipo: TipoObjetoDispensa; valor: Centavos; natureza: string | null; tabela?: readonly LimiteDispensa[] }): {
  pendencias: Pendencia[];
  limite: Centavos;
  fundamento: string;
} {
  exigirInteiro(p.valor, 'valor', 'CARTAO_INVALIDO', 1);
  const vigente = limiteDispensaVigente(p.data, p.tipo, p.tabela);
  const pendencias: Pendencia[] = [];
  if (p.valor > vigente.valor) {
    pendencias.push({ campo: 'valor', mensagem: `O valor (${formatarMoeda(p.valor)}) supera o limite de ${formatarMoeda(vigente.valor)} da dispensa por valor (${vigente.norma}).` });
  }
  if (!suficiente(p.natureza, 2)) pendencias.push({ campo: 'natureza', mensagem: 'Informe o ramo de atividade, que entra no controle de fracionamento (art. 75, § 1º).' });
  return { pendencias, limite: vigente.valor, fundamento: 'Lei 14.133/2021, art. 75, I e II, e § 4º' };
}

export interface CompraCartao {
  data: DataISO;
  valor: Centavos;
  objeto: string;
  /** Nome ou razão social já tratado para publicação (pessoa física mascarada). */
  favorecido: string;
  /** CNPJ (pessoa jurídica) ou CPF mascarado. */
  documentoFavorecido: string;
}

/**
 * Extrato mensal das compras com cartão de pagamento, a divulgar e manter à disposição do público no PNCP (art. 75,
 * § 4º): competência, compras em ordem de data, quantidade e total. O texto não leva dados pessoais além do mascarado.
 */
export function montarExtratoCartao(p: { competencia: string; compras: readonly CompraCartao[] }): {
  competencia: string;
  quantidade: number;
  total: Centavos;
  linhas: CompraCartao[];
  texto: string;
  fundamento: string;
} {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.competencia)) throw new ErroDominio('CARTAO_INVALIDO', 'Competência deve estar no formato AAAA-MM.');
  const linhas = [...p.compras].sort((a, b) => a.data.localeCompare(b.data) || a.valor - b.valor);
  for (const l of linhas) {
    exigirInteiro(l.valor, 'valor', 'CARTAO_INVALIDO', 1);
    if (l.data.slice(0, 7) !== p.competencia) throw new ErroDominio('CARTAO_INVALIDO', `Compra de ${formatarData(l.data)} fora da competência ${p.competencia}.`);
  }
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const [ano, mes] = p.competencia.split('-');
  const texto = [
    `Extrato do cartão de pagamento — competência ${mes}/${ano}`,
    'Fundamento: Lei 14.133/2021, art. 75, § 4º.',
    ...linhas.map((l, i) => `${i + 1}. ${formatarData(l.data)} — ${l.objeto} — ${l.favorecido} (${l.documentoFavorecido}) — ${formatarMoeda(l.valor)}`),
    `Total: ${contagem(linhas.length, 'compra', 'compras')}, ${formatarMoeda(total)}.`,
  ].join('\n');
  return { competencia: p.competencia, quantidade: linhas.length, total, linhas, texto, fundamento: 'Lei 14.133/2021, art. 75, § 4º' };
}
