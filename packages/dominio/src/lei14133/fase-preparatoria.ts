/**
 * Fase preparatória: dotação orçamentária estruturada (RN-39) e peças complementares do processo (RF-32).
 *
 * - Nenhuma contratação é feita sem a indicação dos créditos orçamentários para pagar as parcelas que vencem no
 *   exercício (Lei 14.133/2021, art. 150); o termo de referência traz a adequação orçamentária (art. 6º, XXIII, "j")
 *   e a fase preparatória se compatibiliza com as leis orçamentárias (art. 18, caput).
 * - A declaração de adequação orçamentária é ato da autoridade competente; a Ágora só confere a forma dos campos,
 *   o exercício e a cobertura do valor estimado, e mostra o que falta.
 * - Os quesitos ao controle prévio de legalidade (art. 53) são perguntas montadas a partir dos dados do processo:
 *   a conclusão é sempre da assessoria jurídica.
 */
import { ErroDominio } from '../erros.ts';
import type { DataISO } from '../datas.ts';
import { lerData } from '../interno.ts';
import { formatarMoeda, type Centavos } from '../moeda.ts';

// ───────────────────────── Dotação orçamentária (RN-39) ─────────────────────────

/** Uma linha da dotação: o crédito orçamentário que paga a contratação. */
export interface LinhaDotacao {
  /** Unidade gestora (UG) responsável pelo crédito: 6 dígitos. */
  unidadeGestora: string;
  /** Programa de trabalho (classificação funcional-programática): função.subfunção.programa.ação.localizador. */
  programaTrabalho: string;
  /** Natureza da despesa: categoria econômica.grupo.modalidade de aplicação.elemento (ex.: 4.4.90.52). */
  naturezaDespesa: string;
  /** Fonte de recursos: 10 dígitos (classificação vigente) ou 3 a 4 dígitos (classificação anterior). */
  fonteRecursos: string;
  /** Exercício financeiro do crédito (ano da lei orçamentária). */
  exercicio: number;
  /** Valor do crédito reservado, em centavos. */
  valor: Centavos;
  /** Número do pré-empenho no sistema financeiro (AAAAPE000000), quando já houver reserva. */
  preEmpenho?: string | null;
}

export interface PendenciaDotacao {
  /** Linha da dotação (1, 2, …) ou null quando a pendência é da dotação inteira. */
  linha: number | null;
  campo: keyof LinhaDotacao | 'linhas';
  mensagem: string;
}

export interface ValidacaoDotacao {
  valida: boolean;
  pendencias: PendenciaDotacao[];
  sinais: string[];
  /** Linhas com a natureza da despesa e o programa de trabalho no formato padrão. */
  linhas: LinhaDotacao[];
  /** Exercício em que a contratação é feita (ano de `hoje`). */
  exercicioReferencia: number;
  total: Centavos;
  totalExercicio: Centavos;
  fundamento: string;
}

export const MAXIMO_LINHAS_DOTACAO = 20;
/** Exercícios seguintes aceitos numa dotação plurianual (contratos de serviços contínuos podem chegar a 10 anos — art. 107). */
const EXERCICIOS_FUTUROS = 10;

const FUNDAMENTO_DOTACAO = 'Lei 14.133/2021, art. 6º, XXIII, "j", art. 18, caput, e art. 150';

const PADRAO_UG = /^\d{6}$/;
const PADRAO_PROGRAMA = /^\d{2}\.\d{3}\.\d{4}\.[0-9A-Z]{4}\.\d{4}$/;
const PADRAO_NATUREZA = /^([34])\.([1-6])\.(\d{2})\.(\d{2})$/;
const PADRAO_FONTE = /^(\d{3}|\d{4}|\d{10})$/;
const PADRAO_PRE_EMPENHO = /^(\d{4})PE\d{6}$/;

const GRUPOS_POR_CATEGORIA: Readonly<Record<string, readonly string[]>> = { '3': ['1', '2', '3'], '4': ['4', '5', '6'] };
const GRUPOS_INCOMUNS: Readonly<Record<string, string>> = { '1': 'pessoal e encargos sociais', '2': 'juros e encargos da dívida', '6': 'amortização da dívida' };

/** "449052", "44.90.52" ou "4.4.90.52" → "4.4.90.52". Outro formato volta aparado, para a validação apontar o erro. */
export function normalizarNaturezaDespesa(texto: string): string {
  const digitos = texto.replace(/[\s.]/g, '');
  if (/^\d{6}$/.test(digitos)) return `${digitos.slice(0, 1)}.${digitos.slice(1, 2)}.${digitos.slice(2, 4)}.${digitos.slice(4, 6)}`;
  return texto.trim();
}

/** "06181501620A10001" (17 caracteres, com ou sem pontos) → "06.181.5016.20A1.0001". Outro formato volta aparado e em maiúsculas. */
export function normalizarProgramaTrabalho(texto: string): string {
  const limpo = texto.replace(/[\s.]/g, '').toUpperCase();
  if (/^\d{9}[0-9A-Z]{4}\d{4}$/.test(limpo)) return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 9)}.${limpo.slice(9, 13)}.${limpo.slice(13, 17)}`;
  return texto.trim().toUpperCase();
}

function normalizarLinha(l: LinhaDotacao): LinhaDotacao {
  const preEmpenho = (l.preEmpenho ?? '').trim().toUpperCase();
  return {
    unidadeGestora: String(l.unidadeGestora ?? '').trim(),
    programaTrabalho: normalizarProgramaTrabalho(String(l.programaTrabalho ?? '')),
    naturezaDespesa: normalizarNaturezaDespesa(String(l.naturezaDespesa ?? '')),
    fonteRecursos: String(l.fonteRecursos ?? '').trim(),
    exercicio: l.exercicio,
    valor: l.valor,
    preEmpenho: preEmpenho === '' ? null : preEmpenho,
  };
}

/**
 * Confere a dotação orçamentária do processo (RN-39; art. 150 e art. 6º, XXIII, "j"):
 * - ao menos uma linha, até 20, cada uma com unidade gestora, programa de trabalho, natureza da despesa, fonte,
 *   exercício e valor no formato da classificação orçamentária;
 * - natureza da despesa coerente: despesa corrente (3) só nos grupos 1 a 3 e de capital (4) só nos grupos 4 a 6;
 * - exercício a partir do ano de `hoje` (exercício encerrado não paga a contratação) e, nos seguintes, até 10 anos;
 * - ao menos um crédito do exercício em que a contratação é feita;
 * - pré-empenho, quando informado, do mesmo exercício da linha; linhas repetidas não são aceitas.
 * Créditos que não alcançam o valor estimado viram sinal: a lei exige o crédito das parcelas que vencem no exercício,
 * não do valor inteiro, e cabe à área orçamentária confirmar a previsão dos exercícios seguintes.
 */
export function validarDotacaoOrcamentaria(
  linhas: readonly LinhaDotacao[],
  opcoes: { hoje: DataISO; valorEstimado?: Centavos | null },
): ValidacaoDotacao {
  if (!Array.isArray(linhas as unknown)) throw new ErroDominio('DOTACAO_INVALIDA', 'A dotação deve ser uma lista de linhas.');
  if (linhas.length > MAXIMO_LINHAS_DOTACAO) {
    throw new ErroDominio('DOTACAO_INVALIDA', `A dotação admite no máximo ${MAXIMO_LINHAS_DOTACAO} linhas.`);
  }
  lerData(opcoes.hoje, 'hoje');
  const exercicioReferencia = Number(opcoes.hoje.slice(0, 4));
  const normalizadas = linhas.map(normalizarLinha);
  const pendencias: PendenciaDotacao[] = [];
  const sinais: string[] = [];
  const pendente = (linha: number | null, campo: PendenciaDotacao['campo'], mensagem: string) => pendencias.push({ linha, campo, mensagem });

  if (normalizadas.length === 0) {
    pendente(null, 'linhas', 'Informe ao menos um crédito orçamentário: unidade gestora, programa de trabalho, natureza da despesa, fonte de recursos, exercício e valor.');
  }
  const vistas = new Map<string, number>();
  normalizadas.forEach((l, i) => {
    const n = i + 1;
    if (!PADRAO_UG.test(l.unidadeGestora)) pendente(n, 'unidadeGestora', `Linha ${n}: a unidade gestora tem 6 dígitos.`);
    if (!PADRAO_PROGRAMA.test(l.programaTrabalho)) {
      pendente(n, 'programaTrabalho', `Linha ${n}: o programa de trabalho segue o formato função.subfunção.programa.ação.localizador (00.000.0000.0000.0000).`);
    }
    const natureza = PADRAO_NATUREZA.exec(l.naturezaDespesa);
    if (!natureza) {
      pendente(n, 'naturezaDespesa', `Linha ${n}: a natureza da despesa segue o formato categoria.grupo.modalidade.elemento (ex.: 3.3.90.30).`);
    } else {
      const [, categoria = '', grupo = '', , elemento = ''] = natureza;
      if (!(GRUPOS_POR_CATEGORIA[categoria] ?? []).includes(grupo)) {
        pendente(n, 'naturezaDespesa', `Linha ${n}: o grupo ${grupo} não pertence à categoria econômica ${categoria} (despesa corrente: grupos 1 a 3; de capital: 4 a 6).`);
      }
      if (elemento === '00') pendente(n, 'naturezaDespesa', `Linha ${n}: informe o elemento de despesa (diferente de 00).`);
      const incomum = GRUPOS_INCOMUNS[grupo];
      if (incomum) sinais.push(`Linha ${n}: natureza da despesa do grupo de ${incomum}, incomum numa contratação — confira a classificação.`);
    }
    if (!PADRAO_FONTE.test(l.fonteRecursos)) pendente(n, 'fonteRecursos', `Linha ${n}: a fonte de recursos tem 10 dígitos (ou 3 a 4 na classificação anterior).`);
    if (!Number.isInteger(l.exercicio)) {
      pendente(n, 'exercicio', `Linha ${n}: informe o exercício com 4 dígitos.`);
    } else if (l.exercicio < exercicioReferencia) {
      pendente(n, 'exercicio', `Linha ${n}: o exercício de ${l.exercicio} já foi encerrado — indique crédito do exercício de ${exercicioReferencia} ou seguintes.`);
    } else if (l.exercicio > exercicioReferencia + EXERCICIOS_FUTUROS) {
      pendente(n, 'exercicio', `Linha ${n}: o exercício de ${l.exercicio} passa de ${EXERCICIOS_FUTUROS} anos à frente.`);
    }
    if (!Number.isInteger(l.valor) || l.valor <= 0) pendente(n, 'valor', `Linha ${n}: informe o valor do crédito, maior que zero.`);
    if (l.preEmpenho) {
      const pre = PADRAO_PRE_EMPENHO.exec(l.preEmpenho);
      if (!pre) pendente(n, 'preEmpenho', `Linha ${n}: o pré-empenho segue o formato AAAAPE000000.`);
      else if (Number(pre[1]) !== l.exercicio) pendente(n, 'preEmpenho', `Linha ${n}: o pré-empenho ${l.preEmpenho} é de outro exercício.`);
    }
    const chave = [l.unidadeGestora, l.programaTrabalho, l.naturezaDespesa, l.fonteRecursos, l.exercicio].join('|');
    const anterior = vistas.get(chave);
    if (anterior !== undefined) pendente(n, 'linhas', `Linha ${n}: repete o crédito da linha ${anterior} (mesma unidade gestora, programa, natureza, fonte e exercício) — some os valores numa linha só.`);
    else vistas.set(chave, n);
  });

  const valoresValidos = normalizadas.filter((l) => Number.isInteger(l.valor) && l.valor > 0);
  const total = valoresValidos.reduce((s, l) => s + l.valor, 0);
  const totalExercicio = valoresValidos.filter((l) => l.exercicio === exercicioReferencia).reduce((s, l) => s + l.valor, 0);
  if (normalizadas.length > 0 && !normalizadas.some((l) => l.exercicio === exercicioReferencia)) {
    pendente(null, 'exercicio', `Indique o crédito do exercício de ${exercicioReferencia}, em que a contratação é feita (art. 150).`);
  }
  const estimado = opcoes.valorEstimado ?? null;
  if (estimado !== null && estimado > 0 && normalizadas.length > 0) {
    if (total < estimado) {
      sinais.push(
        `Os créditos indicados (${formatarMoeda(total)}) não alcançam o valor estimado da contratação (${formatarMoeda(estimado)}): confirme a reserva com a área orçamentária.`,
      );
    } else if (totalExercicio < estimado) {
      sinais.push(
        `Os créditos de ${exercicioReferencia} (${formatarMoeda(totalExercicio)}) cobrem parte do valor estimado (${formatarMoeda(estimado)}): confirme que pagam as parcelas que vencem neste exercício e que os seguintes estão previstos.`,
      );
    }
  }
  return {
    valida: pendencias.length === 0,
    pendencias,
    sinais,
    linhas: normalizadas,
    exercicioReferencia,
    total,
    totalExercicio,
    fundamento: FUNDAMENTO_DOTACAO,
  };
}

/**
 * Chave canônica da dotação (a ordem das linhas e a pontuação não importam). O hash dessa chave liga a declaração
 * de adequação orçamentária, o TR e a minuta à dotação que traziam quando foram gerados.
 */
export function chaveDotacao(linhas: readonly LinhaDotacao[]): string {
  return linhas
    .map(normalizarLinha)
    .map((l) => [l.unidadeGestora, l.programaTrabalho, l.naturezaDespesa, l.fonteRecursos, l.exercicio, l.valor, l.preEmpenho ?? ''].join('|'))
    .sort()
    .join('\n');
}

export type SituacaoDeclaracaoOrcamentaria = 'nao_gerada' | 'rascunho' | 'aprovada' | 'desatualizada';
export type SituacaoDotacaoDocumento = 'nao_gerado' | 'com_dotacao' | 'sem_dotacao';

/**
 * RN-39 — o processo só segue para o edital (da etapa 4 para a 5) com a dotação declarada:
 * - dotação informada e válida (`validarDotacaoOrcamentaria`);
 * - declaração de adequação orçamentária aprovada pela autoridade competente com a dotação atual
 *   (declaração gerada com outra dotação está desatualizada);
 * - o TR e a minuta do contrato, na versão atual, trazem a dotação declarada (art. 6º, XXIII, "j", e art. 92, VIII).
 */
export function verificarDotacaoParaEdital(e: {
  validacao: ValidacaoDotacao;
  declaracao: SituacaoDeclaracaoOrcamentaria;
  documentos: readonly { titulo: string; versao: number | null; situacao: SituacaoDotacaoDocumento }[];
}): { liberado: boolean; pendencias: string[]; fundamento: string } {
  const pendencias = e.validacao.pendencias.map((p) => p.mensagem);
  const declaracoes: Record<SituacaoDeclaracaoOrcamentaria, string | null> = {
    nao_gerada: 'Gere a declaração de adequação orçamentária e encaminhe-a à autoridade competente designada para aprovação.',
    rascunho: 'A declaração de adequação orçamentária aguarda a aprovação da autoridade competente designada no processo.',
    desatualizada: 'A dotação mudou depois da declaração de adequação orçamentária: gere nova versão e obtenha nova aprovação da autoridade competente.',
    aprovada: null,
  };
  const mensagemDeclaracao = declaracoes[e.declaracao];
  if (mensagemDeclaracao === undefined) throw new ErroDominio('DOTACAO_INVALIDA', `Situação da declaração inválida: ${String(e.declaracao)}.`);
  if (mensagemDeclaracao !== null) pendencias.push(mensagemDeclaracao);
  if (e.validacao.linhas.length > 0) {
    for (const d of e.documentos) {
      if (d.situacao === 'sem_dotacao') {
        pendencias.push(`"${d.titulo}"${d.versao === null ? '' : ` (versão ${d.versao})`} não traz a dotação declarada: gere nova versão e aprove.`);
      }
    }
  }
  return { liberado: pendencias.length === 0, pendencias, fundamento: FUNDAMENTO_DOTACAO };
}

// ───────────────────────── Quesitos ao controle prévio de legalidade (art. 53) ─────────────────────────

export interface DadosQuesitosControleLegalidade {
  criterioJulgamento: string;
  orcamentoSigiloso: boolean;
  exigenciaProvaConceito: 'nenhuma' | 'prova_conceito' | 'amostra';
  inversaoFases: boolean;
  previstoNoPca: boolean;
  usaCatalogoPadronizado: boolean;
  /** Há justificativa registrada para item com indício de artigo de luxo (art. 20). */
  justificativaArtigoLuxo: boolean;
  patrimonioLiquidoMinimoPercentual: number | null;
  envolveSoftware: boolean;
  cotacoesExpurgadas: number;
  cotacoesFornecedorDireto: number;
  /** Itens de valor estimado até o limite da participação exclusiva de ME e EPP (LC 123/2006, art. 48, I). */
  itensAteLimiteMeEpp: number;
  dotacaoDeclarada: boolean;
  /** Os créditos do exercício cobrem o valor estimado; null sem valor estimado. */
  creditosCobremValorEstimado: boolean | null;
  agentesSemVinculoEfetivo: number;
  sustentabilidadeExigida: boolean;
  riscosRegistrados: number;
}

export interface QuesitoControleLegalidade {
  numero: number;
  pergunta: string;
  fundamento: string;
  /** Dado do processo que levou ao quesito. */
  motivo: string;
}

/**
 * Quesitos objetivos para a nota técnica de encaminhamento à assessoria jurídica (art. 53): sempre os elementos do
 * art. 18, a dotação (art. 150), as minutas (arts. 25 e 92) e a matriz de riscos (art. 22); e, conforme os dados do
 * processo, PCA, catálogo, artigo de luxo, pesquisa de preços, sigilo do orçamento, técnica e preço, prova de conceito,
 * inversão de fases, patrimônio líquido, software, ME/EPP, vínculo dos agentes e sustentabilidade. São perguntas:
 * a análise e a conclusão são da assessoria jurídica.
 */
export function gerarQuesitosControleLegalidade(d: DadosQuesitosControleLegalidade): QuesitoControleLegalidade[] {
  const quesitos: Omit<QuesitoControleLegalidade, 'numero'>[] = [];
  const incluir = (pergunta: string, fundamento: string, motivo: string) => quesitos.push({ pergunta, fundamento, motivo });

  incluir(
    'A instrução reúne os elementos da fase preparatória: necessidade, objeto, condições de execução e pagamento, orçamento estimado, edital, minuta do contrato, modalidade e critério de julgamento, motivação das exigências e análise de riscos?',
    'Lei 14.133/2021, art. 18, I a XI',
    'Verificação aplicável a toda contratação.',
  );
  if (!d.previstoNoPca) {
    incluir('A contratação não consta do plano de contratações anual: a justificativa registrada permite prosseguir?', 'Lei 14.133/2021, art. 12, VII', 'O DFD informa que a demanda não está prevista no plano de contratações anual.');
  }
  if (!d.usaCatalogoPadronizado) {
    incluir('A justificativa para não usar o catálogo eletrônico de padronização atende à lei?', 'Lei 14.133/2021, art. 19, § 2º', 'O DFD informa que o catálogo de padronização não será usado.');
  }
  if (d.justificativaArtigoLuxo) {
    incluir('A justificativa de que os bens com indício de artigo de luxo são de qualidade comum é suficiente?', 'Lei 14.133/2021, art. 20; Decreto 10.818/2021', 'O DFD tem justificativa para item com indício de artigo de luxo.');
  }
  if (d.cotacoesExpurgadas > 0) {
    incluir(
      'Os preços excluídos da estimativa foram motivados e a metodologia de cálculo do valor estimado atende à lei?',
      'Lei 14.133/2021, art. 23',
      `${d.cotacoesExpurgadas} preço(s) excluído(s) da cesta com justificativa registrada.`,
    );
  }
  if (d.cotacoesFornecedorDireto > 0) {
    incluir(
      'As cotações obtidas diretamente com fornecedores observam a lei e trazem a justificativa da escolha dos fornecedores?',
      'Lei 14.133/2021, art. 23, § 1º, IV',
      `${d.cotacoesFornecedorDireto} cotação(ões) direta(s) com fornecedor na cesta de preços.`,
    );
  }
  if (d.orcamentoSigiloso) {
    incluir('O sigilo do orçamento estimado está motivado e preserva o acesso dos órgãos de controle?', 'Lei 14.133/2021, art. 24', 'A cesta de preços está marcada como orçamento sigiloso.');
  }
  if (d.criterioJulgamento === 'tecnica_preco' || d.criterioJulgamento === 'melhor_tecnica') {
    incluir(
      'Os critérios de pontuação técnica são objetivos e estão motivados?',
      'Lei 14.133/2021, art. 18, IX, e arts. 36 e 37',
      `Critério de julgamento: ${d.criterioJulgamento === 'tecnica_preco' ? 'técnica e preço' : 'melhor técnica'}.`,
    );
  }
  if (d.exigenciaProvaConceito !== 'nenhuma') {
    const rotulo = d.exigenciaProvaConceito === 'amostra' ? 'amostra' : 'prova de conceito';
    incluir(
      `A exigência de ${rotulo} do licitante provisoriamente vencedor está justificada, com roteiro e critérios objetivos de aprovação?`,
      'Lei 14.133/2021, art. 17, § 3º, e art. 41, II',
      `Os parâmetros do edital exigem ${rotulo}.`,
    );
  }
  if (d.inversaoFases) {
    incluir('A inversão de fases (habilitação antes do julgamento) está motivada com os benefícios esperados?', 'Lei 14.133/2021, art. 17, § 1º', 'Os parâmetros do edital adotam a inversão de fases.');
  }
  if (d.patrimonioLiquidoMinimoPercentual !== null) {
    incluir(
      `A exigência de patrimônio líquido mínimo de ${d.patrimonioLiquidoMinimoPercentual.toLocaleString('pt-BR')}% do valor estimado está justificada e dentro do limite legal?`,
      'Lei 14.133/2021, art. 69, § 4º',
      'Os parâmetros do edital exigem patrimônio líquido mínimo.',
    );
  }
  if (d.envolveSoftware) {
    incluir('A cessão dos direitos patrimoniais e do código-fonte prevista na minuta atende à lei?', 'Lei 14.133/2021, art. 93', 'O objeto envolve software.');
  }
  if (d.itensAteLimiteMeEpp > 0) {
    incluir(
      'Os itens de menor valor devem ser exclusivos para microempresas e empresas de pequeno porte, ou há hipótese de exceção?',
      'Lei Complementar 123/2006, arts. 48 e 49',
      `${d.itensAteLimiteMeEpp} item(ns) com valor estimado até o limite da participação exclusiva.`,
    );
  }
  incluir(
    'A indicação dos créditos orçamentários e a declaração de adequação orçamentária da autoridade competente atendem à lei?',
    'Lei 14.133/2021, art. 6º, XXIII, "j", e art. 150',
    !d.dotacaoDeclarada
      ? 'A declaração de adequação orçamentária ainda não foi aprovada pela autoridade competente.'
      : d.creditosCobremValorEstimado === false
        ? 'Dotação declarada; os créditos do exercício cobrem só parte do valor estimado.'
        : 'Dotação declarada pela autoridade competente.',
  );
  if (d.agentesSemVinculoEfetivo > 0) {
    incluir(
      'A designação de agente sem vínculo efetivo com a Administração está justificada?',
      'Lei 14.133/2021, art. 7º, I',
      `${d.agentesSemVinculoEfetivo} agente(s) designado(s) declarou(aram) vínculo não efetivo.`,
    );
  }
  if (d.sustentabilidadeExigida) {
    incluir(
      'Os critérios de sustentabilidade e a logística reversa são compatíveis com o objeto e não restringem indevidamente a competição?',
      'Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII',
      'A política de sustentabilidade do órgão exige os critérios no ETP e no TR.',
    );
  }
  incluir(
    'As minutas do edital e do contrato contêm as cláusulas obrigatórias e preveem o acesso ao edital e aos anexos sem cadastro prévio?',
    'Lei 14.133/2021, art. 25, § 3º, e art. 92',
    'Verificação aplicável a toda licitação.',
  );
  incluir(
    'A matriz de riscos aloca os riscos entre as partes de forma compatível com as obrigações e os encargos de cada uma?',
    'Lei 14.133/2021, art. 22 e art. 103',
    d.riscosRegistrados > 0 ? `${d.riscosRegistrados} risco(s) registrado(s) na matriz.` : 'Nenhum risco registrado na matriz.',
  );
  return quesitos.map((q, i) => ({ numero: i + 1, ...q }));
}

// ───────────────────────── Caderno de casos de teste da prova de conceito ─────────────────────────

export interface CasoTesteProvaConceito {
  codigo: string;
  descricao: string;
}

export const MAXIMO_CASOS_PROVA_CONCEITO = 25;

/**
 * Casos de teste do caderno da prova de conceito (art. 17, § 3º, e art. 41, II), a partir do roteiro do edital: cada
 * linha (ou, num texto de linha única, cada trecho separado por ";") vira um caso, sem a numeração original, até 25
 * casos. Sem roteiro, a lista sai vazia. A aprovação de cada caso é registrada pela comissão na planilha de julgamento.
 */
export function montarCasosTesteProvaConceito(roteiro: string | null | undefined): CasoTesteProvaConceito[] {
  const texto = (roteiro ?? '').trim();
  if (texto === '') return [];
  const linhas = texto.split(/\r?\n/);
  const partes = linhas.filter((l) => l.trim() !== '').length > 1 ? linhas : texto.split(';');
  return partes
    .map((p) => p.replace(/^\s*(?:\d{1,2}\s*[.)\-–]|[a-z]\s*[.)]|[-•*])\s*/i, '').trim().replace(/[;.]+$/, ''))
    .filter((p) => p.length >= 3)
    .slice(0, MAXIMO_CASOS_PROVA_CONCEITO)
    .map((descricao, i) => ({ codigo: `CT-${String(i + 1).padStart(2, '0')}`, descricao }));
}

// ───────────────────────── Checklist de peças do processo (RF-32) ─────────────────────────

export type ObrigatoriedadePeca = 'obrigatoria' | 'condicional' | 'recomendada';
export type SituacaoPeca = 'pronta' | 'rascunho' | 'desatualizada' | 'falta' | 'nao_aplicavel';
export type EtapaPeca = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PecaProcesso {
  /** Tipo do documento gerado na Ágora. */
  tipo: string;
  titulo: string;
  etapa: EtapaPeca;
  fundamento: string;
  obrigatoriedade: ObrigatoriedadePeca;
  /** Condição de uma peça condicional. */
  condicao?: 'prova_conceito';
}

/** Peças do processo de contratação, por etapa da jornada, com o fundamento de cada uma. */
export const PECAS_PROCESSO: readonly PecaProcesso[] = Object.freeze([
  { tipo: 'dfd', titulo: 'Documento de formalização da demanda', etapa: 1, fundamento: 'Lei 14.133/2021, art. 12, VII, e art. 18, I', obrigatoriedade: 'obrigatoria' },
  { tipo: 'portaria_designacao', titulo: 'Portaria de designação da equipe e dos agentes', etapa: 2, fundamento: 'Lei 14.133/2021, arts. 7º e 8º', obrigatoriedade: 'obrigatoria' },
  { tipo: 'etp', titulo: 'Estudo técnico preliminar', etapa: 3, fundamento: 'Lei 14.133/2021, art. 18, I, e §§ 1º e 2º', obrigatoriedade: 'obrigatoria' },
  { tipo: 'matriz_riscos', titulo: 'Matriz de riscos', etapa: 3, fundamento: 'Lei 14.133/2021, art. 18, X, e art. 22', obrigatoriedade: 'obrigatoria' },
  { tipo: 'nota_tecnica_precos', titulo: 'Nota técnica da pesquisa de preços', etapa: 3, fundamento: 'Lei 14.133/2021, art. 18, IV, e art. 23', obrigatoriedade: 'obrigatoria' },
  { tipo: 'tr', titulo: 'Termo de referência', etapa: 4, fundamento: 'Lei 14.133/2021, art. 6º, XXIII, e art. 18, II', obrigatoriedade: 'obrigatoria' },
  { tipo: 'declaracao_orcamentaria', titulo: 'Declaração de adequação orçamentária', etapa: 4, fundamento: FUNDAMENTO_DOTACAO, obrigatoriedade: 'obrigatoria' },
  { tipo: 'edital', titulo: 'Minuta do edital', etapa: 4, fundamento: 'Lei 14.133/2021, art. 18, V, e art. 25', obrigatoriedade: 'obrigatoria' },
  { tipo: 'minuta_contrato', titulo: 'Minuta do contrato', etapa: 4, fundamento: 'Lei 14.133/2021, art. 18, VI, e art. 92', obrigatoriedade: 'obrigatoria' },
  {
    tipo: 'caderno_prova_conceito',
    titulo: 'Caderno de casos de teste da prova de conceito e planilha de julgamento',
    etapa: 4,
    fundamento: 'Lei 14.133/2021, art. 17, § 3º, e art. 41, II',
    obrigatoriedade: 'condicional',
    condicao: 'prova_conceito',
  },
  { tipo: 'modelo_proposta', titulo: 'Modelo de proposta comercial', etapa: 4, fundamento: 'Lei 14.133/2021, art. 25, caput, e art. 59', obrigatoriedade: 'recomendada' },
  { tipo: 'ordem_servico', titulo: 'Modelo de ordem de serviço ou de fornecimento', etapa: 4, fundamento: 'Lei 14.133/2021, art. 6º, XXIII, "e", e art. 117', obrigatoriedade: 'recomendada' },
  { tipo: 'termo_sigilo', titulo: 'Modelo de termo de compromisso e de sigilo', etapa: 4, fundamento: 'Lei 14.133/2021, art. 13 e art. 91, § 1º; Lei 13.709/2018', obrigatoriedade: 'recomendada' },
  { tipo: 'termo_recebimento_provisorio', titulo: 'Modelo de termo de recebimento provisório', etapa: 4, fundamento: 'Lei 14.133/2021, art. 140, I, "a", e II, "a"', obrigatoriedade: 'recomendada' },
  { tipo: 'termo_recebimento_definitivo', titulo: 'Modelo de termo de recebimento definitivo', etapa: 4, fundamento: 'Lei 14.133/2021, art. 140, I, "b", e II, "b"', obrigatoriedade: 'recomendada' },
  { tipo: 'nota_tecnica_conjur', titulo: 'Nota técnica de encaminhamento à assessoria jurídica', etapa: 5, fundamento: 'Lei 14.133/2021, art. 53, caput, e art. 169, II', obrigatoriedade: 'recomendada' },
  { tipo: 'parecer_checklist', titulo: 'Lista de verificação do controle prévio de legalidade', etapa: 5, fundamento: 'Lei 14.133/2021, art. 53, caput e § 1º', obrigatoriedade: 'obrigatoria' },
  { tipo: 'despacho_autorizacao', titulo: 'Despacho de autorização da contratação', etapa: 5, fundamento: 'Lei 14.133/2021, art. 53, § 3º, e art. 72, VIII', obrigatoriedade: 'obrigatoria' },
] satisfies PecaProcesso[]);

export interface DocumentoChecklist {
  tipo: string;
  versao: number;
  situacao: 'rascunho' | 'revisado' | 'aprovado';
  assinado: boolean;
  /** A versão atual não vale mais (parâmetros do edital ou dotação diferentes dos atuais). */
  desatualizado: boolean;
}

export interface ItemChecklistPecas {
  tipo: string;
  titulo: string;
  fundamento: string;
  obrigatoriedade: ObrigatoriedadePeca;
  situacao: SituacaoPeca;
  versao: number | null;
  assinado: boolean | null;
  /** Peça exigida (obrigatória, ou condicional aplicável) que ainda não está pronta. */
  falta: boolean;
}

export interface ChecklistPecas {
  etapas: { etapa: EtapaPeca; itens: ItemChecklistPecas[]; prontas: number; faltantes: number }[];
  prontas: number;
  faltantes: number;
  recomendadasPendentes: number;
  fundamento: string;
}

/**
 * Checklist das peças do processo por etapa (RF-32): o que já está pronto (versão atual aprovada e válida), em
 * rascunho, desatualizado ou faltando. Conta como falta a peça obrigatória — ou a condicional cuja condição se aplica —
 * que não está pronta; peça recomendada pendente é contada à parte. O caderno da prova de conceito só se aplica quando
 * o edital exige prova de conceito ou amostra.
 */
export function montarChecklistPecas(e: {
  etapaAtual: number;
  documentos: readonly DocumentoChecklist[];
  provaConceitoExigida: boolean;
}): ChecklistPecas {
  if (!Number.isInteger(e.etapaAtual) || e.etapaAtual < 1 || e.etapaAtual > 7) throw new ErroDominio('ETAPA_INVALIDA', 'A etapa deve ser um inteiro de 1 a 7.');
  const porTipo = new Map<string, DocumentoChecklist>();
  for (const d of e.documentos) {
    const atual = porTipo.get(d.tipo);
    if (!atual || d.versao > atual.versao) porTipo.set(d.tipo, d);
  }
  const item = (peca: PecaProcesso): ItemChecklistPecas => {
    const aplicavel = peca.condicao !== 'prova_conceito' || e.provaConceitoExigida;
    const doc = porTipo.get(peca.tipo) ?? null;
    let situacao: SituacaoPeca;
    if (!aplicavel) situacao = 'nao_aplicavel';
    else if (!doc) situacao = 'falta';
    else if (doc.desatualizado) situacao = 'desatualizada';
    else situacao = doc.situacao === 'aprovado' ? 'pronta' : 'rascunho';
    const exigida = aplicavel && peca.obrigatoriedade !== 'recomendada';
    return {
      tipo: peca.tipo,
      titulo: peca.titulo,
      fundamento: peca.fundamento,
      obrigatoriedade: peca.obrigatoriedade,
      situacao,
      versao: doc && aplicavel ? doc.versao : null,
      assinado: doc && aplicavel && doc.situacao === 'aprovado' ? doc.assinado : null,
      falta: exigida && situacao !== 'pronta',
    };
  };
  const etapas = [...new Set(PECAS_PROCESSO.map((p) => p.etapa))].map((etapa) => {
    const daEtapa = PECAS_PROCESSO.filter((p) => p.etapa === etapa).map(item);
    return { etapa, itens: daEtapa, prontas: daEtapa.filter((i) => i.situacao === 'pronta').length, faltantes: daEtapa.filter((i) => i.falta).length };
  });
  const itens = etapas.flatMap((x) => x.itens);
  return {
    etapas,
    prontas: itens.filter((i) => i.situacao === 'pronta').length,
    faltantes: itens.filter((i) => i.falta).length,
    recomendadasPendentes: itens.filter((i) => i.obrigatoriedade === 'recomendada' && i.situacao !== 'pronta').length,
    fundamento: 'Lei 14.133/2021, art. 12, I, art. 18, art. 53 e art. 72',
  };
}
