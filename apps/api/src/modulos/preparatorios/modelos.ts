/**
 * Modelos de texto determinísticos das peças complementares da fase preparatória (frente P — RF-32 e RN-39), no mesmo
 * formato dos modelos da jornada (`jornada/documentos.ts`): corpo em Markdown, premissas (dados usados) e fontes.
 * Atos da autoridade, quesitos e julgamento ficam em seções `<!-- protegido:... -->`, que a IA não redige.
 * Campos a cargo do licitante, do contratado ou do fiscal aparecem como "[preencher: …]"; o que a equipe ainda precisa
 * definir aparece como "[A definir: …]".
 */
import {
  CAPACITACOES_AGENTE,
  formatarData,
  formatarMoeda,
  gerarQuesitosControleLegalidade,
  montarCasosTesteProvaConceito,
  rotuloExigenciaProvaConceito,
  validarDotacaoOrcamentaria,
  verificarDeclaracaoAgente,
  VINCULOS_FUNCIONAIS,
  type DeclaracaoAgente,
  type LinhaDotacao,
  type PapelProcesso,
  type ValidacaoDotacao,
} from '@agora/dominio';
import type { TipoDocumentoComplementar } from '@agora/contratos';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { CONDICOES_REFERENCIA, PAPEIS_PROCESSO, ROTULOS_PAPEL, ROTULOS_TIPO_OBJETO, TITULOS_DOCUMENTO, TITULOS_ETAPA } from '../jornada/constantes.ts';
import type { DadosDocumento, ModeloDocumento } from '../jornada/documentos.ts';
import { avaliarSegregacao, indiciosArtigoLuxo } from '../jornada/regras.ts';
import { editalCompleto } from '../jornada/selecao.ts';
import type { CargaProcesso, TipoDocumento } from '../jornada/tipos.ts';
import { checklistDaCarga } from './checklist.ts';
import { dotacaoDaCarga, hashDotacao, marcadorDotacao, situacaoDeclaracao } from './dotacao.ts';
import { TITULOS_DOCUMENTO_COMPLEMENTARES } from './constantes.ts';

// ───────────────────────── utilitários ─────────────────────────

function celula(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

function tabela(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  return [
    `| ${cabecalho.map(celula).join(' | ')} |`,
    `| ${cabecalho.map(() => '---').join(' | ')} |`,
    ...linhas.map((l) => `| ${l.map(celula).join(' | ')} |`),
  ].join('\n');
}

function pendente(descricao: string): string {
  return `*[A definir: ${descricao}]*`;
}

function preencher(campo: string): string {
  return `[preencher: ${campo}]`;
}

function protegido(nome: string, conteudo: string): string {
  return `<!-- protegido:${nome} -->\n${conteudo}\n<!-- /protegido:${nome} -->`;
}

function membros(carga: CargaProcesso, papel: PapelProcesso): string[] {
  return carga.equipe.filter((m) => m.papel === papel).map((m) => m.nome);
}

function nomeOuPendente(carga: CargaProcesso, papel: PapelProcesso): string {
  const nomes = membros(carga, papel);
  return nomes.length > 0 ? nomes.join(', ') : pendente(`designação de ${ROTULOS_PAPEL[papel].toLowerCase()}`);
}

function ano(d: DadosDocumento): string {
  return d.dataGeracao.slice(0, 4);
}

function ehBem(d: DadosDocumento): boolean {
  return d.carga.linha.dfd.tipoObjeto === 'bens';
}

function envolveSoftware(carga: CargaProcesso): boolean {
  return normalizarBusca(carga.linha.titulo, ...carga.linha.dfd.itens.map((i) => i.descricao)).includes('software');
}

function valorEstimadoTexto(d: DadosDocumento): string {
  if (d.carga.linha.cesta.orcamentoSigiloso) return 'sigiloso (art. 24), conhecido da área orçamentária e dos órgãos de controle';
  return d.valorEstimado === null ? pendente('valor estimado pela pesquisa de preços') : formatarMoeda(d.valorEstimado);
}

function modalidade(d: DadosDocumento): string {
  return d.carga.linha.modalidade_prevista ?? 'Pregão eletrônico';
}

function documento(carga: CargaProcesso, tipo: TipoDocumento) {
  return carga.documentos.find((x) => x.tipo === tipo);
}

/** "Termo de Referência (documento SEI nº 41730012)" ou a situação da versão atual. */
function referencia(carga: CargaProcesso, tipo: TipoDocumento): string {
  const doc = documento(carga, tipo);
  if (!doc) return `${TITULOS_DOCUMENTO[tipo]} — ainda não gerado`;
  if (doc.situacao === 'aprovado') return `${TITULOS_DOCUMENTO[tipo]} — versão ${doc.versao} aprovada${doc.numeroSei ? `, documento SEI nº ${doc.numeroSei}` : ''}`;
  return `${TITULOS_DOCUMENTO[tipo]} — versão ${doc.versao} em rascunho`;
}

function tabelaItensParaPreencher(d: DadosDocumento, colunas: readonly string[]): string {
  const { itens } = d.carga.linha.dfd;
  if (itens.length === 0) return pendente('itens da contratação (registrados no DFD)');
  return tabela(
    ['Item', 'CATMAT/CATSER', 'Descrição', 'Unidade', 'Quantidade', ...colunas],
    itens.map((item, i) => [String(i + 1), item.catmat ?? '—', item.descricao, item.unidade, item.quantidade.toLocaleString('pt-BR'), ...colunas.map((c) => preencher(c.toLowerCase()))]),
  );
}

function assinatura(papel: string, nome: string): string {
  return `**${nome}** — ${papel.toLowerCase()} (assinatura eletrônica no SEI).`;
}

// ───────────────────────── Dotação no TR, na minuta e no checklist do parecer (RN-39) ─────────────────────────

function validacaoDotacao(d: DadosDocumento): ValidacaoDotacao {
  return validarDotacaoOrcamentaria(dotacaoDaCarga(d.carga).linhas, { hoje: d.dataGeracao, valorEstimado: d.valorEstimado });
}

function classificacao(l: LinhaDotacao): string {
  return `unidade gestora ${l.unidadeGestora}, programa de trabalho ${l.programaTrabalho}, natureza da despesa ${l.naturezaDespesa}, fonte ${l.fonteRecursos}, exercício de ${l.exercicio}`;
}

function tabelaDotacao(linhas: readonly LinhaDotacao[], comValores: boolean): string {
  const cabecalho = ['Linha', 'Unidade gestora', 'Programa de trabalho', 'Natureza da despesa', 'Fonte', 'Exercício', ...(comValores ? ['Valor', 'Pré-empenho'] : [])];
  return tabela(
    cabecalho,
    linhas.map((l, i) => [
      String(i + 1),
      l.unidadeGestora,
      l.programaTrabalho,
      l.naturezaDespesa,
      l.fonteRecursos,
      String(l.exercicio),
      ...(comValores ? [formatarMoeda(l.valor), l.preEmpenho ?? '—'] : []),
    ]),
  );
}

/** Alínea "j" do TR (art. 6º, XXIII): a dotação estruturada, em seção protegida com o hash da dotação. */
export function secaoDotacaoTr(d: DadosDocumento): string {
  const validacao = validacaoDotacao(d);
  const hash = hashDotacao(validacao.linhas);
  if (hash === null) {
    return `As despesas correrão à conta de recursos consignados no Orçamento Geral da União para o exercício de ${ano(d)}: ${pendente('dotação orçamentária — unidade gestora, programa de trabalho, natureza da despesa, fonte de recursos e exercício (RN-39)')}.`;
  }
  const sigiloso = d.carga.linha.cesta.orcamentoSigiloso;
  return protegido(
    'dotacao_orcamentaria',
    [
      marcadorDotacao(hash),
      'As despesas decorrentes desta contratação correrão à conta dos créditos orçamentários abaixo, consignados na lei orçamentária anual (art. 6º, XXIII, "j", e art. 150):',
      '',
      tabelaDotacao(validacao.linhas, !sigiloso),
      '',
      sigiloso
        ? 'Os valores dos créditos não são divulgados, por se tratar de orçamento sigiloso (art. 24).'
        : `Total dos créditos indicados: **${formatarMoeda(validacao.total)}**, dos quais ${formatarMoeda(validacao.totalExercicio)} no exercício de ${validacao.exercicioReferencia}.`,
      'A adequação orçamentária e financeira é objeto de declaração da autoridade competente, juntada ao processo.',
    ].join('\n'),
  );
}

/** Cláusula do crédito orçamentário da minuta (art. 92, VIII), com o hash da dotação. */
export function clausulaCreditoOrcamentario(d: DadosDocumento): string {
  const validacao = validacaoDotacao(d);
  const hash = hashDotacao(validacao.linhas);
  if (hash === null) return `A despesa correrá à conta do crédito orçamentário: ${pendente('programa de trabalho, natureza da despesa, fonte de recursos e nota de empenho')}.`;
  return [
    marcadorDotacao(hash),
    `A despesa correrá à conta dos créditos consignados na lei orçamentária, com a seguinte classificação: ${validacao.linhas.map(classificacao).join('; ')}. Nos exercícios seguintes, as despesas correrão à conta dos créditos próprios, indicados por apostilamento (art. 136, IV). Nota de empenho: ${pendente('número da nota de empenho, informado na assinatura')}.`,
  ].join('\n');
}

/** Evidência do item "previsão orçamentária" do checklist do parecer (art. 53). */
export function evidenciaDotacao(carga: CargaProcesso): string {
  const linhas = dotacaoDaCarga(carga).linhas;
  if (linhas.length === 0) return 'Dotação orçamentária não informada (RN-39).';
  const situacao = situacaoDeclaracao(carga.documentos, hashDotacao(linhas));
  const doc = documento(carga, 'declaracao_orcamentaria');
  const creditos = `${linhas.length} crédito(s) orçamentário(s) indicado(s)`;
  if (situacao === 'aprovada') {
    return `${creditos}; declaração de adequação orçamentária aprovada${doc?.revisadoPor ? ` por ${doc.revisadoPor.nome}` : ''}${doc?.numeroSei ? `, SEI nº ${doc.numeroSei}` : ''} (RN-39).`;
  }
  const textos = { nao_gerada: 'declaração de adequação orçamentária não gerada', rascunho: 'declaração em rascunho, sem aprovação da autoridade', desatualizada: 'declaração gerada com dotação anterior' } as const;
  return `${creditos}; ${textos[situacao]} (RN-39).`;
}

// ───────────────────────── Portaria de designação (arts. 7º e 8º) ─────────────────────────

const ATRIBUICOES: Record<PapelProcesso, string> = {
  requisitante: 'formalizar a demanda e responder pelas informações do documento de formalização da demanda',
  equipe_planejamento: 'elaborar os estudos técnicos preliminares, a matriz de riscos, a pesquisa de preços e o termo de referência (art. 18)',
  agente_contratacao: 'conduzir a licitação, tomar as decisões e impulsionar o procedimento até a homologação (art. 8º)',
  pregoeiro: 'conduzir a licitação na modalidade pregão (art. 8º, § 5º)',
  comissao_contratacao: 'conduzir a licitação, receber, examinar e julgar documentos, inclusive a prova de conceito (art. 8º, § 2º)',
  autoridade_competente: 'aprovar os atos da fase preparatória, adjudicar e homologar (art. 71)',
  gestor_contrato: 'coordenar a gestão do contrato (art. 117)',
  fiscal_tecnico: 'acompanhar e fiscalizar a execução técnica do contrato e registrar as ocorrências (art. 117, § 1º)',
  fiscal_administrativo: 'acompanhar os aspectos administrativos da execução, como a regularidade fiscal e trabalhista (art. 117)',
  parecerista_juridico: 'prestar o assessoramento jurídico e realizar o controle prévio de legalidade (art. 53)',
};

function situacaoDeclaracaoAgente(papel: PapelProcesso, declaracao: DeclaracaoAgente | undefined, hoje: string): string {
  const r = verificarDeclaracaoAgente({ papel, declaracao: declaracao ?? null, hoje });
  if (r.apto) return `Vigente até ${formatarData(r.validaAte ?? hoje)}`;
  return `Pendente: ${r.pendencias[0] ?? 'declaração ausente'}`;
}

function modeloPortaria(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const { linha } = carga;
  const declaracoes = carga.preparatorios?.declaracoes ?? {};
  const designados = carga.equipe.filter((m) => m.papel !== 'autoridade_competente');
  const autoridade = membros(carga, 'autoridade_competente');
  const segregacao = avaliarSegregacao(carga.equipe, []);
  const papeis = PAPEIS_PROCESSO.filter((p) => p !== 'autoridade_competente' && designados.some((m) => m.papel === p));
  const corpo = [
    `**PORTARIA Nº ${pendente('número/ano')}**, de ${pendente('data da assinatura')}`,
    '',
    `A AUTORIDADE COMPETENTE da unidade ${linha.uasg_nome} (UASG ${linha.uasg}), no uso das suas atribuições, tendo em vista o disposto nos arts. 7º e 8º da Lei 14.133/2021 e o que consta do processo SEI nº ${linha.numero_sei}, resolve:`,
    '',
    protegido(
      'designacao',
      [
        `**Art. 1º** Designar, para atuar no processo de contratação de ${linha.titulo.charAt(0).toLowerCase()}${linha.titulo.slice(1)}, os agentes públicos abaixo, nas funções indicadas:`,
        '',
        designados.length === 0
          ? pendente('designação da equipe do processo (etapa 2)')
          : tabela(
              ['Função', 'Agente público', 'Vínculo declarado', 'Capacitação declarada', 'Declaração de inexistência de impedimento'],
              designados.map((m) => {
                const declaracao = declaracoes[m.usuarioId];
                return [
                  ROTULOS_PAPEL[m.papel],
                  m.nome,
                  declaracao ? VINCULOS_FUNCIONAIS[declaracao.vinculo] : 'Não declarado',
                  declaracao ? CAPACITACOES_AGENTE[declaracao.capacitacao] : 'Não declarada',
                  situacaoDeclaracaoAgente(m.papel, declaracao, d.dataGeracao),
                ];
              }),
            ),
      ].join('\n'),
    ),
    '',
    '**Art. 2º** Compete aos designados, sem prejuízo das demais atribuições legais e regulamentares:',
    '',
    ...(papeis.length === 0 ? [pendente('atribuições, conforme as funções designadas')] : papeis.map((p) => `- ${ROTULOS_PAPEL[p]}: ${ATRIBUICOES[p]}.`)),
    '',
    `**Art. 3º** Fica observado o princípio da segregação de funções, vedada a designação do mesmo agente para funções suscetíveis a riscos (art. 7º, § 1º). ${
      segregacao.conflitos.length === 0
        ? 'A verificação das designações não encontrou acúmulo de funções conflitantes.'
        : `${pendente(`resolver ${segregacao.conflitos.length} conflito(s) de segregação apontado(s) antes da assinatura`)}`
    }`,
    '',
    '**Art. 4º** Os designados declararam não ser cônjuges, companheiros ou parentes até o terceiro grau de licitantes ou contratados habituais, nem ter com eles vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil, e não estar em conflito de interesses (art. 7º, III, e art. 9º, § 1º), conforme as declarações registradas, e assumem o dever de comunicar qualquer fato superveniente.',
    '',
    '**Art. 5º** Esta portaria entra em vigor na data da sua assinatura.',
    '',
    assinatura('Autoridade competente', autoridade.length > 0 ? autoridade.join(', ') : pendente('designação da autoridade competente')),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.portaria_designacao,
    corpo,
    premissas: [
      `Designações registradas na equipe do processo: ${designados.length} (a autoridade competente assina a portaria).`,
      'Vínculo, capacitação e validade das declarações conferidos por verificarDeclaracaoAgente (@agora/dominio), a partir das declarações registradas pelos próprios agentes (RN-28).',
      `Segregação de funções conferida por verificarSegregacao (@agora/dominio): ${segregacao.conflitos.length} conflito(s).`,
    ],
    fontes: ['Lei 14.133/2021, art. 7º, I a III e § 1º', 'Lei 14.133/2021, art. 8º, caput e §§ 2º e 5º', 'Lei 14.133/2021, art. 9º, § 1º, e art. 117', 'Decreto 11.246/2022'],
  };
}

// ───────────────────────── Declaração de adequação orçamentária (art. 150) ─────────────────────────

function modeloDeclaracaoOrcamentaria(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const validacao = validacaoDotacao(d);
  const hash = hashDotacao(validacao.linhas);
  const autoridade = membros(carga, 'autoridade_competente');
  const creditos =
    hash === null
      ? pendente('dotação orçamentária do processo (unidade gestora, programa de trabalho, natureza da despesa, fonte, exercício e valor)')
      : [
          marcadorDotacao(hash),
          tabelaDotacao(validacao.linhas, true),
          '',
          `Total dos créditos: **${formatarMoeda(validacao.total)}**; no exercício de ${validacao.exercicioReferencia}: **${formatarMoeda(validacao.totalExercicio)}**.`,
        ].join('\n');
  const pendencias = validacao.pendencias.map((p) => `- ${p.mensagem}`);
  const sinais = validacao.sinais.map((s) => `- ${s}`);
  const corpo = [
    '## 1. Contratação',
    '',
    tabela(
      ['Campo', 'Informação'],
      [
        ['Objeto', carga.linha.titulo],
        ['Processo SEI', carga.linha.numero_sei],
        ['Valor estimado', valorEstimadoTexto(d)],
        ['Modalidade prevista', modalidade(d)],
      ],
    ),
    '',
    '## 2. Créditos orçamentários',
    '',
    protegido('dotacao_orcamentaria', creditos),
    '',
    ...(pendencias.length > 0 ? ['**Pendências da dotação, a resolver antes da aprovação (RN-39):**', '', ...pendencias, ''] : []),
    ...(sinais.length > 0 ? ['**Pontos de atenção:**', '', ...sinais, ''] : []),
    '## 3. Declaração',
    '',
    protegido(
      'declaracao_autoridade',
      `Na qualidade de autoridade competente, DECLARO que a despesa decorrente desta contratação tem adequação orçamentária e financeira com a lei orçamentária anual de ${validacao.exercicioReferencia} e compatibilidade com o plano plurianual e a lei de diretrizes orçamentárias, e que os créditos indicados acima atendem às parcelas que vencem no exercício (Lei 14.133/2021, art. 150, e Lei Complementar 101/2000, art. 16, II). Esta declaração produz efeito com a aprovação e a assinatura da autoridade na Ágora e no SEI.`,
    ),
    '',
    assinatura('Autoridade competente', autoridade.length > 0 ? autoridade.join(', ') : pendente('designação da autoridade competente')),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.declaracao_orcamentaria,
    corpo,
    premissas: [
      `Dotação registrada no processo: ${validacao.linhas.length} linha(s), conferida por validarDotacaoOrcamentaria (@agora/dominio): ${validacao.valida ? 'sem pendências' : `${validacao.pendencias.length} pendência(s)`}.`,
      `Valor estimado do processo: ${d.carga.linha.cesta.orcamentoSigiloso ? 'sigiloso (art. 24)' : d.valorEstimado === null ? 'não apurado' : formatarMoeda(d.valorEstimado)}.`,
      'A declaração vale para a dotação desta versão: qualquer alteração da dotação exige nova versão e nova aprovação.',
    ],
    fontes: ['Lei 14.133/2021, art. 6º, XXIII, "j"', 'Lei 14.133/2021, art. 18, caput, e art. 150', 'Lei Complementar 101/2000, art. 16, II'],
  };
}

// ───────────────────────── Despacho de autorização (art. 53, § 3º, e art. 72, VIII) ─────────────────────────

function modeloDespachoAutorizacao(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const { linha } = carga;
  const autoridade = membros(carga, 'autoridade_competente');
  const direta = /dispensa|inexigibilidade|contrata[cç][aã]o direta/i.test(modalidade(d));
  const conclusao = linha.parecer.conclusao;
  const declaracao = situacaoDeclaracao(carga.documentos, hashDotacao(dotacaoDaCarga(carga).linhas));
  const tiposExaminados: TipoDocumento[] = ['dfd', 'portaria_designacao', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'declaracao_orcamentaria', 'edital', 'minuta_contrato', 'parecer_checklist'];
  let decisao: string;
  if (conclusao === 'desfavoravel') {
    decisao = `A assessoria jurídica concluiu desfavoravelmente. ${pendente('saneamento dos apontamentos e nova análise jurídica, ou decisão motivada da autoridade sobre o prosseguimento')}`;
  } else if (direta) {
    decisao = `APROVO a instrução da fase preparatória e AUTORIZO a contratação direta, nos termos do art. 72, VIII, da Lei 14.133/2021, determinando a divulgação deste ato em sítio eletrônico oficial (art. 72, parágrafo único).${conclusao === null ? ' A contratação fica condicionada à manifestação da assessoria jurídica (art. 53, § 4º).' : ''}`;
  } else if (conclusao === null) {
    decisao =
      'APROVO os estudos e os documentos da fase preparatória e AUTORIZO o encaminhamento do processo à assessoria jurídica para o controle prévio de legalidade (art. 53, caput). A divulgação do edital fica condicionada à manifestação jurídica.';
  } else {
    decisao = `APROVO a fase preparatória e AUTORIZO a realização da licitação, determinando a divulgação do edital e dos anexos no Portal Nacional de Contratações Públicas e do extrato no Diário Oficial da União (art. 53, § 3º, e art. 54).${conclusao === 'favoravel_com_ressalvas' ? ' As ressalvas da assessoria jurídica foram consideradas e atendidas, conforme registro nos autos.' : ''}`;
  }
  const corpo = [
    `**DESPACHO Nº ${pendente('número/ano')}**`,
    '',
    '## 1. Contratação',
    '',
    tabela(
      ['Campo', 'Informação'],
      [
        ['Objeto', linha.titulo],
        ['Natureza do objeto', ROTULOS_TIPO_OBJETO[linha.dfd.tipoObjeto]],
        ['Modalidade prevista', modalidade(d)],
        ['Valor estimado', valorEstimadoTexto(d)],
        ['Dotação orçamentária', declaracao === 'aprovada' ? 'Declarada pela autoridade competente (RN-39)' : pendente('declaração de adequação orçamentária aprovada (RN-39)')],
        ['Parecer jurídico', conclusao === null ? 'Ainda não emitido' : { favoravel: 'Favorável', favoravel_com_ressalvas: 'Favorável com ressalvas', desfavoravel: 'Desfavorável' }[conclusao]],
      ],
    ),
    '',
    '## 2. Documentos examinados',
    '',
    ...tiposExaminados.map((t) => `- ${referencia(carga, t)}.`),
    '',
    '## 3. Decisão',
    '',
    protegido('decisao_autoridade', decisao),
    '',
    assinatura('Autoridade competente', autoridade.length > 0 ? autoridade.join(', ') : pendente('designação da autoridade competente')),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.despacho_autorizacao,
    corpo,
    premissas: [
      `Situação dos documentos do processo na data da geração (${tiposExaminados.length} peças examinadas).`,
      `Conclusão do parecer jurídico registrada: ${conclusao ?? 'nenhuma'}; declaração orçamentária: ${declaracao}.`,
      'O texto da decisão é sugestão de redação: a decisão é ato da autoridade competente e produz efeito com a sua aprovação e assinatura.',
    ],
    fontes: ['Lei 14.133/2021, art. 53, caput, §§ 3º e 4º', 'Lei 14.133/2021, art. 54', 'Lei 14.133/2021, art. 72, VIII e parágrafo único', 'Lei 14.133/2021, art. 150'],
  };
}

// ───────────────────────── Nota técnica de encaminhamento à assessoria jurídica (art. 53) ─────────────────────────

const ROTULOS_CRITERIO: Record<string, string> = {
  menor_preco: 'menor preço',
  maior_desconto: 'maior desconto',
  tecnica_preco: 'técnica e preço',
  melhor_tecnica: 'melhor técnica ou conteúdo artístico',
  maior_lance: 'maior lance',
  maior_retorno_economico: 'maior retorno econômico',
};
const ROTULOS_SITUACAO_PECA = { pronta: 'Pronta', rascunho: 'Em rascunho', desatualizada: 'Desatualizada', falta: 'Falta', nao_aplicavel: 'Não se aplica' } as const;

function modeloNotaTecnicaConjur(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const { linha } = carga;
  const edital = editalCompleto(linha.edital);
  const validacao = validacaoDotacao(d);
  const declarada = validacao.valida && situacaoDeclaracao(carga.documentos, hashDotacao(validacao.linhas)) === 'aprovada';
  const declaracoes = carga.preparatorios?.declaracoes ?? {};
  const semVinculoEfetivo = new Set(
    carga.equipe.filter((m) => {
      const v = declaracoes[m.usuarioId]?.vinculo;
      return v !== undefined && v !== 'servidor_efetivo' && v !== 'empregado_publico_permanente';
    }).map((m) => m.usuarioId),
  ).size;
  const quesitos = gerarQuesitosControleLegalidade({
    criterioJulgamento: linha.edital.criterioJulgamento,
    orcamentoSigiloso: linha.cesta.orcamentoSigiloso,
    exigenciaProvaConceito: edital.provaConceito.exigencia,
    inversaoFases: edital.inversaoFases.adotada,
    previstoNoPca: linha.dfd.previstoNoPca,
    usaCatalogoPadronizado: linha.dfd.usaCatalogoPadronizado,
    justificativaArtigoLuxo: indiciosArtigoLuxo(linha.dfd).length > 0 && (linha.dfd.justificativaArtigoLuxo ?? '').trim().length > 0,
    patrimonioLiquidoMinimoPercentual: linha.edital.patrimonioLiquidoMinimoPercentual,
    envolveSoftware: envolveSoftware(carga),
    cotacoesExpurgadas: linha.cesta.cotacoes.filter((c) => c.expurgada).length,
    cotacoesFornecedorDireto: linha.cesta.cotacoes.filter((c) => !c.expurgada && c.fonte === 'fornecedor_direto').length,
    itensAteLimiteMeEpp: linha.dfd.itens.filter((i) => i.quantidade * i.valorUnitarioEstimado > 0 && i.quantidade * i.valorUnitarioEstimado <= 8_000_000).length,
    dotacaoDeclarada: declarada,
    creditosCobremValorEstimado: d.valorEstimado === null ? null : validacao.totalExercicio >= d.valorEstimado,
    agentesSemVinculoEfetivo: semVinculoEfetivo,
    sustentabilidadeExigida: d.politicaSustentabilidade ?? true,
    riscosRegistrados: linha.riscos.length,
  });
  const checklist = checklistDaCarga(carga);
  const pecas = checklist.etapas.filter((e) => e.etapa <= 4).flatMap((e) => e.itens);
  const corpo = [
    `**NOTA TÉCNICA Nº ${pendente('número/ano')}**`,
    '',
    '**Assunto:** encaminhamento do processo à assessoria jurídica para o controle prévio de legalidade da contratação (art. 53 da Lei 14.133/2021).',
    '',
    '## 1. Síntese da contratação',
    '',
    tabela(
      ['Campo', 'Informação'],
      [
        ['Objeto', linha.titulo],
        ['Unidade (UASG)', `${linha.uasg} — ${linha.uasg_nome}`],
        ['Natureza do objeto', ROTULOS_TIPO_OBJETO[linha.dfd.tipoObjeto]],
        ['Modalidade prevista', modalidade(d)],
        ['Critério de julgamento', ROTULOS_CRITERIO[linha.edital.criterioJulgamento] ?? linha.edital.criterioJulgamento],
        ['Valor estimado', valorEstimadoTexto(d)],
        ['Previsão no PCA', linha.dfd.previstoNoPca ? 'Sim' : 'Não'],
        ['Prova de conceito ou amostra', edital.provaConceito.exigencia === 'nenhuma' ? 'Não exigida' : `Exigida (${rotuloExigenciaProvaConceito(edital.provaConceito.exigencia)})`],
        ['Dotação orçamentária', declarada ? 'Declarada pela autoridade competente' : 'Declaração pendente (RN-39)'],
      ],
    ),
    '',
    '## 2. Instrução da fase preparatória',
    '',
    tabela(
      ['Peça', 'Situação', 'Fundamento'],
      pecas.map((p) => [p.titulo, `${ROTULOS_SITUACAO_PECA[p.situacao]}${p.versao !== null ? ` (versão ${p.versao})` : ''}`, p.fundamento]),
    ),
    '',
    `Peças exigidas ainda pendentes nas etapas 1 a 4: ${pecas.filter((p) => p.falta).length}.`,
    '',
    '## 3. Quesitos ao controle prévio de legalidade',
    '',
    protegido(
      'quesitos',
      [
        'Submetem-se à assessoria jurídica os quesitos abaixo, montados a partir dos dados registrados no processo:',
        '',
        ...quesitos.map((q) => `${q.numero}. ${q.pergunta} (${q.fundamento}). *Motivo: ${q.motivo}*`),
      ].join('\n'),
    ),
    '',
    '## 4. Encaminhamento',
    '',
    'Encaminhe-se à assessoria jurídica para análise e manifestação, nos termos do art. 53 da Lei 14.133/2021. Esta nota não contém juízo jurídico: a análise, as respostas aos quesitos e a conclusão do parecer são de competência exclusiva da assessoria jurídica.',
    '',
    assinatura('Agente de contratação', membros(carga, 'agente_contratacao').join(', ') || membros(carga, 'pregoeiro').join(', ') || pendente('responsável pelo encaminhamento')),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.nota_tecnica_conjur,
    corpo,
    premissas: [
      `Quesitos montados por gerarQuesitosControleLegalidade (@agora/dominio) a partir dos dados do processo: ${quesitos.length} quesito(s).`,
      'Situação das peças apurada por montarChecklistPecas (@agora/dominio).',
      'Os quesitos são perguntas: nenhuma conclusão jurídica é sugerida.',
    ],
    fontes: ['Lei 14.133/2021, art. 53, caput e § 1º', 'Lei 14.133/2021, art. 169, II', 'Lei 14.133/2021, art. 18'],
  };
}

// ───────────────────────── Anexos operacionais (modelos) ─────────────────────────

function cabecalhoInstrumento(d: DadosDocumento): string {
  const { linha } = d.carga;
  return tabela(
    ['Campo', 'Informação'],
    [
      ['Contratante', `${linha.uasg_nome} (UASG ${linha.uasg})`],
      ['Processo SEI', linha.numero_sei],
      ['Contrato', preencher('número/ano do contrato')],
      ['Contratada', preencher('razão social e CNPJ')],
    ],
  );
}

function modeloProposta(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { provaConceito } = editalCompleto(linha.edital);
  const corpo = [
    `Modelo de proposta comercial, anexo do edital de ${modalidade(d).toLowerCase()} nº ${pendente('número/ano do edital')}, processo SEI nº ${linha.numero_sei}.`,
    '',
    '## 1. Identificação do licitante',
    '',
    tabela(
      ['Campo', 'Informação'],
      [
        ['Razão social', preencher('razão social')],
        ['CNPJ', preencher('CNPJ')],
        ['Endereço', preencher('endereço completo')],
        ['Representante legal', preencher('nome e cargo')],
        ['Contato', preencher('e-mail e telefone institucionais')],
        ['Dados bancários', preencher('banco, agência e conta')],
      ],
    ),
    '',
    '## 2. Preços',
    '',
    tabelaItensParaPreencher(d, ['Valor unitário (R$)', 'Valor total (R$)']),
    '',
    `Valor global da proposta: ${preencher('valor em algarismos e por extenso')}.`,
    '',
    '## 3. Declarações do licitante',
    '',
    '- Os preços incluem todos os custos diretos e indiretos, tributos, encargos sociais e trabalhistas, fretes e seguros, inclusive os necessários ao cumprimento dos direitos trabalhistas (art. 63, § 1º).',
    `- O prazo de validade da proposta é de ${preencher('dias, conforme o edital')}, contado da data da sessão pública.`,
    '- A proposta atende integralmente às especificações do termo de referência.',
    '- O licitante cumpre a reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social (art. 63, IV).',
    '- O licitante não está impedido de licitar nem de contratar com a Administração (art. 14).',
    `- Enquadramento como microempresa ou empresa de pequeno porte: ${preencher('sim ou não')} (Lei Complementar 123/2006).`,
    ...(provaConceito.exigencia === 'nenhuma'
      ? []
      : [
          `- O licitante, se provisoriamente vencedor, compromete-se a realizar a ${rotuloExigenciaProvaConceito(provaConceito.exigencia)} no prazo de ${provaConceito.prazoDiasUteis ?? pendente('prazo em dias úteis')} dias úteis contados da convocação, em sessão pública gravada (art. 17, § 3º).`,
        ]),
    '',
    `Local e data: ${preencher('local e data')}.`,
    '',
    `${preencher('assinatura do representante legal')}`,
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.modelo_proposta,
    corpo,
    premissas: [
      `Itens e quantidades do DFD (${linha.dfd.itens.length} item(ns)); a proposta não traz o valor estimado da Administração.`,
      `Prova de conceito ou amostra: ${provaConceito.exigencia === 'nenhuma' ? 'não exigida' : rotuloExigenciaProvaConceito(provaConceito.exigencia)}.`,
    ],
    fontes: ['Lei 14.133/2021, art. 25, caput', 'Lei 14.133/2021, art. 59', 'Lei 14.133/2021, art. 63, IV e § 1º', 'Lei Complementar 123/2006'],
  };
}

function modeloOrdemServico(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const bem = ehBem(d);
  const nome = bem ? 'ORDEM DE FORNECIMENTO' : 'ORDEM DE SERVIÇO';
  const corpo = [
    `**${nome} Nº ${preencher('número/ano')}**`,
    '',
    cabecalhoInstrumento(d),
    '',
    `## 1. ${bem ? 'Bens a fornecer' : 'Serviços a executar'}`,
    '',
    tabelaItensParaPreencher(d, ['Quantidade desta ordem', 'Valor (R$)']),
    '',
    '## 2. Prazos e local',
    '',
    `- Período antecedente à expedição desta ordem (art. 92, § 2º): pendências verificadas e providências adotadas em ${preencher('data e registro')}.`,
    bem
      ? `- Entrega em até ${CONDICOES_REFERENCIA.prazoEntregaDias} dias corridos do recebimento desta ordem, na unidade ${carga.linha.uasg_nome}, em dias úteis e horário de expediente, mediante agendamento.`
      : `- Início da execução em ${preencher('data')}, conforme o cronograma aprovado pela fiscalização.`,
    `- Local: ${preencher('endereço de entrega ou de execução')}.`,
    '',
    '## 3. Gestão e fiscalização (art. 117)',
    '',
    `Gestor do contrato: ${nomeOuPendente(carga, 'gestor_contrato')}. Fiscal técnico: ${nomeOuPendente(carga, 'fiscal_tecnico')}. Fiscal administrativo: ${nomeOuPendente(carga, 'fiscal_administrativo')}.`,
    '',
    '## 4. Recebimento',
    '',
    `O objeto será recebido provisória e definitivamente nos termos do art. 140, ${bem ? 'II' : 'I'}, da Lei 14.133/2021, com os termos de recebimento anexos ao edital.`,
    '',
    `Emitente: ${nomeOuPendente(carga, 'gestor_contrato')} — gestor do contrato.`,
    '',
    `Ciente da contratada: ${preencher('nome do preposto, data e assinatura')}.`,
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.ordem_servico,
    corpo,
    premissas: [`Natureza do objeto: ${ROTULOS_TIPO_OBJETO[carga.linha.dfd.tipoObjeto]} (${bem ? 'ordem de fornecimento' : 'ordem de serviço'}).`, 'Gestor e fiscais conforme as designações da equipe do processo.'],
    fontes: ['Lei 14.133/2021, art. 6º, XXIII, "e"', 'Lei 14.133/2021, art. 92, § 2º', 'Lei 14.133/2021, arts. 117 e 140'],
  };
}

function modeloTermoSigilo(d: DadosDocumento): ModeloDocumento {
  const corpo = [
    '**TERMO DE COMPROMISSO E DE SIGILO**',
    '',
    cabecalhoInstrumento(d),
    '',
    `A contratada, por seu representante legal ${preencher('nome e cargo')}, compromete-se, por si e por seus empregados e prepostos, a:`,
    '',
    '1. Manter sigilo sobre as informações e os documentos a que tiver acesso em razão do contrato, inclusive dados pessoais e informações de segurança pública, sem divulgá-los nem usá-los para outra finalidade (Lei 14.133/2021, art. 13; Lei 12.527/2011, arts. 23 a 26).',
    '2. Tratar os dados pessoais apenas conforme as instruções do contratante, como operadora, com as medidas de segurança técnicas e administrativas adequadas (Lei 13.709/2018, arts. 39 e 46).',
    '3. Restringir o acesso às informações aos profissionais que delas precisem para executar o contrato, que assinarão o termo de ciência abaixo.',
    `4. Comunicar ao contratante, em até ${preencher('prazo, em horas')}, qualquer incidente de segurança que envolva as informações ou os dados pessoais (Lei 13.709/2018, art. 48).`,
    '5. Devolver ou eliminar, ao fim do contrato, as informações e os dados recebidos, mediante registro, ressalvadas as hipóteses legais de guarda.',
    `6. Manter o sigilo durante a vigência do contrato e depois dela, ${preencher('prazo ou enquanto durar a classificação da informação')}.`,
    '',
    'O descumprimento sujeita a contratada às sanções do contrato (arts. 155 e 156 da Lei 14.133/2021), sem prejuízo da responsabilidade civil, penal e administrativa.',
    '',
    '## Termo de ciência dos profissionais da contratada',
    '',
    tabela(['Nome', 'Função', 'Data', 'Assinatura'], [1, 2, 3].map(() => [preencher('nome'), preencher('função'), preencher('data'), preencher('assinatura')])),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.termo_sigilo,
    corpo,
    premissas: ['Modelo para os contratos que deem acesso a dados pessoais ou a informações sigilosas de segurança pública.'],
    fontes: ['Lei 14.133/2021, art. 13 e art. 91, § 1º', 'Lei 12.527/2011, arts. 23 a 26', 'Lei 13.709/2018, arts. 39, 46 e 48', 'Lei 14.133/2021, arts. 155 e 156'],
  };
}

function modeloTermoRecebimento(d: DadosDocumento, tipo: 'provisorio' | 'definitivo'): ModeloDocumento {
  const { carga } = d;
  const bem = ehBem(d);
  const provisorio = tipo === 'provisorio';
  const alinea = `art. 140, ${bem ? 'II' : 'I'}, "${provisorio ? 'a' : 'b'}"`;
  const forma = provisorio
    ? bem
      ? 'de forma sumária, pelo responsável pelo acompanhamento e fiscalização, com verificação posterior da conformidade do material com as exigências contratuais'
      : 'pelo responsável pelo acompanhamento e fiscalização, mediante termo detalhado, verificado o cumprimento das exigências de caráter técnico'
    : 'por servidor ou comissão designada pela autoridade competente, mediante termo detalhado que comprove o atendimento das exigências contratuais';
  const verificacoes = provisorio
    ? [
        'Quantidade entregue ou serviço executado conforme a ordem',
        bem ? 'Embalagem, identificação e prazo de validade' : 'Cumprimento das exigências técnicas do termo de referência',
        'Documento fiscal correspondente',
        'Ocorrências registradas durante a execução',
      ]
    : [
        'Qualidade e quantidade conforme o contrato e o termo de referência',
        `Termo de recebimento provisório nº ${preencher('número')}`,
        bem ? 'Testes de funcionamento e garantia do fabricante' : 'Níveis de serviço e indicadores do período',
        'Regularidade fiscal e trabalhista conferida antes do pagamento (art. 92, XVI)',
      ];
  const responsavel = provisorio ? nomeOuPendente(carga, 'fiscal_tecnico') : `${nomeOuPendente(carga, 'gestor_contrato')} ${preencher('ou comissão designada')}`;
  const corpo = [
    `**TERMO DE RECEBIMENTO ${provisorio ? 'PROVISÓRIO' : 'DEFINITIVO'}**`,
    '',
    cabecalhoInstrumento(d),
    '',
    `Ordem de ${bem ? 'fornecimento' : 'serviço'}: ${preencher('número')}. Documento fiscal: ${preencher('número e data')}.`,
    '',
    '## 1. Objeto recebido',
    '',
    tabelaItensParaPreencher(d, ['Quantidade recebida']),
    '',
    '## 2. Verificações',
    '',
    tabela(['Verificação', 'Resultado', 'Observação'], verificacoes.map((v) => [v, preencher('conforme ou não conforme'), preencher('observação')])),
    '',
    `## 3. ${provisorio ? 'Recebimento provisório' : 'Recebimento definitivo'}`,
    '',
    `O objeto é recebido ${forma} (${alinea}, da Lei 14.133/2021).${
      provisorio
        ? ` O recebimento definitivo ocorrerá no prazo previsto no contrato (${preencher('prazo')}), contado deste termo (art. 140, § 3º).`
        : ' Fica liberado o pagamento, observada a ordem cronológica de exigibilidade por fonte de recursos (art. 141).'
    }`,
    '',
    'O recebimento não exclui a responsabilidade civil pela solidez e pela segurança do objeto nem a responsabilidade ético-profissional pela perfeita execução do contrato (art. 140, § 2º).',
    '',
    `Responsável pelo recebimento: ${responsavel}. Data: ${preencher('data')}.`,
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES[provisorio ? 'termo_recebimento_provisorio' : 'termo_recebimento_definitivo'],
    corpo,
    premissas: [`Natureza do objeto: ${ROTULOS_TIPO_OBJETO[carga.linha.dfd.tipoObjeto]} (${alinea}).`, 'Responsáveis conforme as designações da equipe do processo.'],
    fontes: ['Lei 14.133/2021, art. 140, I e II e §§ 2º e 3º', 'Lei 14.133/2021, art. 92, XVI, e art. 141'],
  };
}

// ───────────────────────── Caderno de casos de teste da prova de conceito (art. 17, § 3º) ─────────────────────────

const ROTULOS_RESULTADO = { aprovado: 'Aprovado', reprovado: 'Reprovado' } as const;

function modeloCadernoProvaConceito(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const { linha } = carga;
  const { provaConceito } = editalCompleto(linha.edital);
  const fontes = ['Lei 14.133/2021, art. 17, §§ 2º e 3º', 'Lei 14.133/2021, art. 41, II', 'Lei 14.133/2021, art. 8º, § 2º'];
  if (provaConceito.exigencia === 'nenhuma') {
    return {
      titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.caderno_prova_conceito,
      corpo: 'Os parâmetros do edital não exigem prova de conceito nem amostra (RN-20): este caderno não se aplica. Se a exigência for adotada, gere nova versão.',
      premissas: ['Parâmetros do edital sem prova de conceito nem amostra.'],
      fontes,
    };
  }
  const rotulo = rotuloExigenciaProvaConceito(provaConceito.exigencia);
  const casos = montarCasosTesteProvaConceito(provaConceito.roteiro);
  const comissao = [...membros(carga, 'comissao_contratacao'), ...membros(carga, 'agente_contratacao'), ...membros(carga, 'pregoeiro'), ...membros(carga, 'equipe_planejamento')];
  const convocacoes = linha.selecao.convocacoes ?? [];
  const nomeLicitante = (id: string) => linha.disputa.licitantes.find((l) => l.fornecedorId === id)?.nome ?? 'Licitante';
  const corpo = [
    '## 1. Regras da sessão',
    '',
    `- O licitante provisoriamente vencedor é convocado para a ${rotulo} e a realiza em até ${provaConceito.prazoDiasUteis ?? pendente('prazo em dias úteis')} dias úteis contados da convocação (art. 17, § 3º, e art. 41, II).`,
    '- A sessão é pública, transmitida e gravada em áudio e vídeo; o link da gravação integra o processo (art. 17, § 2º).',
    '- Cada caso de teste é julgado pela comissão como atendido ou não atendido, com registro da evidência (minuto da gravação).',
    '- Reprovado o licitante, convoca-se o próximo colocado (RN-20).',
    '',
    `**Justificativa da exigência:** ${provaConceito.justificativa?.trim() || pendente('justificativa da necessidade (art. 41, II)')}`,
    '',
    '## 2. Casos de teste',
    '',
    casos.length === 0
      ? pendente('roteiro de testes e critérios objetivos de aprovação, nos parâmetros do edital')
      : tabela(
          ['Caso', 'Descrição (roteiro do edital)', 'Critério de aprovação', 'Evidência'],
          casos.map((c) => [c.codigo, c.descricao, 'Atende integralmente ao descrito', preencher('minuto da gravação')]),
        ),
    '',
    '## 3. Planilha de julgamento da comissão',
    '',
    protegido(
      'julgamento',
      [
        `Licitante avaliado: ${preencher('razão social e CNPJ')}. Data da sessão: ${preencher('data')}. Gravação: ${preencher('endereço da gravação')}.`,
        '',
        casos.length === 0
          ? pendente('planilha, depois de definidos os casos de teste')
          : tabela(
              ['Caso', 'Atende? (sim/não)', 'Observação da comissão', 'Avaliador'],
              casos.map((c) => [c.codigo, preencher('sim ou não'), preencher('observação'), preencher('nome')]),
            ),
        '',
        `**Regra de consolidação:** o licitante é aprovado somente se todos os casos${casos.length > 0 ? ` (${casos.length})` : ''} forem atendidos; qualquer caso não atendido reprova. O resultado é registrado na Ágora pelo agente de contratação, com motivação e link da gravação (RN-20): a decisão é da comissão, não do sistema.`,
      ].join('\n'),
    ),
    '',
    '## 4. Resultados registrados no processo',
    '',
    convocacoes.length === 0
      ? 'Nenhuma convocação registrada até a geração deste caderno.'
      : tabela(
          ['Licitante', 'Convocado em', 'Prazo', 'Resultado', 'Realizada em', 'Gravação'],
          convocacoes.map((c) => [
            nomeLicitante(c.fornecedorId),
            formatarData(c.convocadoEm),
            formatarData(c.limite),
            c.resultado ? ROTULOS_RESULTADO[c.resultado] : 'Aguardando',
            c.realizadaEm ? formatarData(c.realizadaEm.slice(0, 10)) : '—',
            c.linkGravacao ?? '—',
          ]),
        ),
    '',
    '## 5. Assinaturas da comissão',
    '',
    tabela(
      ['Membro', 'Assinatura'],
      (comissao.length > 0 ? [...new Set(comissao)] : [pendente('membros da comissão ou agente de contratação')]).map((n) => [n, preencher('assinatura eletrônica no SEI')]),
    ),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.caderno_prova_conceito,
    corpo,
    premissas: [
      `Casos de teste montados por montarCasosTesteProvaConceito (@agora/dominio) a partir do roteiro do edital: ${casos.length} caso(s).`,
      `Convocações e resultados registrados na seleção (RN-20): ${convocacoes.length}.`,
      'A planilha é preenchida e assinada pela comissão; o sistema não julga a prova.',
    ],
    fontes,
  };
}

// ───────────────────────── Checklist de documentos do processo ─────────────────────────

const ROTULOS_OBRIGATORIEDADE = { obrigatoria: 'Obrigatória', condicional: 'Condicional', recomendada: 'Recomendada' } as const;

function modeloChecklistDocumentos(d: DadosDocumento): ModeloDocumento {
  const checklist = checklistDaCarga(d.carga);
  const corpo = [
    `Situação das peças do processo em ${formatarData(d.dataGeracao)}, na etapa ${d.carga.linha.etapa_atual} (${TITULOS_ETAPA[d.carga.linha.etapa_atual]}): **${checklist.prontas} pronta(s)**, **${checklist.faltantes} exigida(s) pendente(s)** e ${checklist.recomendadasPendentes} recomendada(s) pendente(s).`,
    '',
    ...checklist.etapas.flatMap((e) => [
      `## Etapa ${e.etapa} — ${TITULOS_ETAPA[e.etapa]}`,
      '',
      tabela(
        ['Peça', 'Exigência', 'Situação', 'Assinada no SEI', 'Fundamento'],
        e.itens.map((i) => [
          i.titulo,
          ROTULOS_OBRIGATORIEDADE[i.obrigatoriedade],
          `${ROTULOS_SITUACAO_PECA[i.situacao]}${i.versao !== null ? ` (versão ${i.versao})` : ''}`,
          i.assinado === null ? '—' : i.assinado ? 'Sim' : 'Não',
          i.fundamento,
        ]),
      ),
      '',
    ]),
    'Peça "pronta" é a versão atual aprovada e válida; "desatualizada" é a gerada com parâmetros do edital ou dotação diferentes dos atuais. A conferência final é do servidor responsável.',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO_COMPLEMENTARES.checklist_documentos,
    corpo,
    premissas: ['Situação apurada por montarChecklistPecas (@agora/dominio) a partir da versão atual de cada documento do processo.'],
    fontes: ['Lei 14.133/2021, art. 12, I', 'Lei 14.133/2021, arts. 18, 53 e 72'],
  };
}

/** Modelos das peças complementares, acrescentados aos da jornada em `jornada/documentos.ts`. */
export const MODELOS_COMPLEMENTARES: Record<TipoDocumentoComplementar, (d: DadosDocumento) => ModeloDocumento> = {
  portaria_designacao: modeloPortaria,
  declaracao_orcamentaria: modeloDeclaracaoOrcamentaria,
  despacho_autorizacao: modeloDespachoAutorizacao,
  nota_tecnica_conjur: modeloNotaTecnicaConjur,
  modelo_proposta: modeloProposta,
  ordem_servico: modeloOrdemServico,
  termo_sigilo: modeloTermoSigilo,
  termo_recebimento_provisorio: (d) => modeloTermoRecebimento(d, 'provisorio'),
  termo_recebimento_definitivo: (d) => modeloTermoRecebimento(d, 'definitivo'),
  caderno_prova_conceito: modeloCadernoProvaConceito,
  checklist_documentos: modeloChecklistDocumentos,
};
