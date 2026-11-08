import {
  formatarData,
  formatarMoeda,
  INCISOS_ETP,
  prazoMinimoPropostas,
  rotuloExigenciaProvaConceito,
  validarEtp,
  type ConteudoEtp,
  type IncisoEtp,
  type OpcoesCalendario,
  type PapelProcesso,
} from '@agora/dominio';
import type { OrgaoRequisitante } from '@agora/contratos';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import {
  CONDICOES_REFERENCIA,
  ITENS_PARECER,
  LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL,
  ROTULOS_PAPEL,
  ROTULOS_TIPO_OBJETO,
  TITULOS_DOCUMENTO,
} from './constantes.ts';
import { avaliarSegregacao, indiciosArtigoLuxo } from './regras.ts';
import { editalCompleto } from './selecao.ts';
import { criteriosDoProcesso, SECAO_SUSTENTABILIDADE, sustentabilidadeDoProcesso } from './sustentabilidade.ts';
import type { AnaliseCesta, CargaProcesso, CotacaoArmazenada, DocumentoCarregado, TipoDocumento } from './tipos.ts';

/**
 * Modelos de texto determinísticos dos documentos da jornada (docs/JORNADA.md §3). Cada modelo devolve o corpo em
 * Markdown, as premissas (dados usados) e as fontes (normas). Seções sobre conclusão jurídica, sanções e habilitação
 * ficam entre marcadores `<!-- protegido:... -->`: a IA nunca as redige (ver `ia/provedor.ts`).
 */
export interface DadosDocumento {
  carga: CargaProcesso;
  analise: AnaliseCesta | null;
  valorEstimado: number | null;
  /** Data de geração (DataISO), impressa no documento. */
  dataGeracao: string;
  calendario: OpcoesCalendario;
  /** Política de sustentabilidade do órgão ligada (RN-21); padrão: ligada. */
  politicaSustentabilidade?: boolean;
}

export interface ModeloDocumento {
  titulo: string;
  corpo: string;
  premissas: string[];
  fontes: string[];
}

export interface Autoria {
  geradoPor: 'modelo' | 'ia';
  modeloIa: string | null;
}

export const ORGAOS_POR_EXTENSO: Record<OrgaoRequisitante, string> = {
  PF: 'Polícia Federal',
  PRF: 'Polícia Rodoviária Federal',
  SENASP: 'Secretaria Nacional de Segurança Pública',
  SENAPPEN: 'Secretaria Nacional de Políticas Penais',
  MJSP: 'Ministério da Justiça e Segurança Pública',
};

const ROTULOS_FONTE: Record<CotacaoArmazenada['fonte'], string> = {
  painel_precos: 'Painel de Preços / banco de preços oficial (art. 23, § 1º, I)',
  contratacao_similar: 'Contratação similar da Administração (art. 23, § 1º, II)',
  midia_especializada: 'Mídia especializada, tabela de referência ou sítio eletrônico (art. 23, § 1º, III)',
  fornecedor_direto: 'Pesquisa direta com fornecedor (art. 23, § 1º, IV)',
  nota_fiscal: 'Nota fiscal eletrônica (art. 23, § 1º, V)',
};

const ROTULOS_CRITERIO: Record<string, string> = {
  menor_preco: 'menor preço',
  maior_desconto: 'maior desconto',
  tecnica_preco: 'técnica e preço',
  melhor_tecnica: 'melhor técnica ou conteúdo artístico',
  maior_lance: 'maior lance',
  maior_retorno_economico: 'maior retorno econômico',
};

const MARCADOR_SITUACAO = '<!-- situacao -->';

// ───────────────────────── utilitários de Markdown ─────────────────────────

function celula(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
}

function tabela(cabecalho: readonly string[], linhas: readonly (readonly string[])[]): string {
  const topo = `| ${cabecalho.map(celula).join(' | ')} |`;
  const separador = `| ${cabecalho.map(() => '---').join(' | ')} |`;
  return [topo, separador, ...linhas.map((l) => `| ${l.map(celula).join(' | ')} |`)].join('\n');
}

function pendente(descricao: string): string {
  return `*[A definir: ${descricao}]*`;
}

function protegido(nome: string, conteudo: string): string {
  return `<!-- protegido:${nome} -->\n${conteudo}\n<!-- /protegido:${nome} -->`;
}

function numero(valor: number): string {
  return valor.toLocaleString('pt-BR');
}

function texto(valor: string | null | undefined, descricaoPendente: string): string {
  const limpo = (valor ?? '').trim();
  return limpo.length > 0 ? limpo : pendente(descricaoPendente);
}

function nomesNoPapel(carga: CargaProcesso, papel: PapelProcesso): string[] {
  return carga.equipe.filter((m) => m.papel === papel).map((m) => m.nome);
}

function nomesOuPendente(carga: CargaProcesso, papel: PapelProcesso): string {
  const nomes = nomesNoPapel(carga, papel);
  return nomes.length > 0 ? nomes.join(', ') : pendente(`designação de ${ROTULOS_PAPEL[papel].toLowerCase()}`);
}

function documentoAtual(carga: CargaProcesso, tipo: TipoDocumento): DocumentoCarregado | undefined {
  return carga.documentos.find((d) => d.tipo === tipo);
}

function referenciaSei(carga: CargaProcesso, tipo: TipoDocumento): string {
  const doc = documentoAtual(carga, tipo);
  if (!doc) return `${TITULOS_DOCUMENTO[tipo]} (ainda não gerado)`;
  return doc.numeroSei
    ? `${TITULOS_DOCUMENTO[tipo]} (documento SEI nº ${doc.numeroSei})`
    : `${TITULOS_DOCUMENTO[tipo]} (versão ${doc.versao}, ${doc.situacao === 'aprovado' ? 'aprovada' : 'em rascunho'})`;
}

function ehBem(d: DadosDocumento): boolean {
  return d.carga.linha.dfd.tipoObjeto === 'bens';
}

function envolveSoftware(d: DadosDocumento): boolean {
  const { linha } = d.carga;
  return normalizarBusca(linha.titulo, ...linha.dfd.itens.map((i) => i.descricao)).includes('software');
}

function valorPreliminar(d: DadosDocumento): number {
  return d.carga.linha.dfd.itens.reduce((s, i) => s + i.quantidade * i.valorUnitarioEstimado, 0);
}

function tabelaItens(d: DadosDocumento, comPrecoDaCesta: boolean): string {
  const { dfd } = d.carga.linha;
  if (dfd.itens.length === 0) return pendente('itens da contratação (quantidade e unidade de fornecimento)');
  const linhas = dfd.itens.map((item, indice) => {
    const unitario = comPrecoDaCesta && indice === 0 && d.analise ? d.analise.valorEstimado : item.valorUnitarioEstimado;
    return [
      String(indice + 1),
      item.catmat ?? '—',
      item.descricao,
      item.unidade,
      numero(item.quantidade),
      formatarMoeda(unitario),
      formatarMoeda(unitario * item.quantidade),
    ];
  });
  return tabela(['Item', 'CATMAT/CATSER', 'Descrição', 'Unidade', 'Quantidade', 'Valor unitário', 'Valor total'], linhas);
}

function prazoPropostas(d: DadosDocumento): { diasUteis: number; fundamento: string } {
  const { dfd, edital } = d.carga.linha;
  return prazoMinimoPropostas({ objeto: dfd.tipoObjeto, criterio: edital.criterioJulgamento, regime: edital.regimeExecucao });
}

const ROTULOS_REGIME = { integrada: 'contratação integrada', semi_integrada: 'contratação semi-integrada', outro: 'regime comum' } as const;
const { vigenciaMeses, prazoEntregaDias, garantiaExecucaoPercentual } = CONDICOES_REFERENCIA;

function ano(d: DadosDocumento): string {
  return d.dataGeracao.slice(0, 4);
}

// ───────────────────────── Sustentabilidade (RN-21) e prova de conceito (RN-20) ─────────────────────────

/** Critérios ambientais e logística reversa (seção protegida: a IA não pode omiti-la nem reescrevê-la). */
function blocoSustentabilidade(d: DadosDocumento, documento: 'etp' | 'tr'): string {
  const verificacao = sustentabilidadeDoProcesso(d.carga.linha, d.politicaSustentabilidade ?? true, documento);
  const criterios = criteriosDoProcesso(d.carga.linha);
  const conteudo = [
    `**Critérios de sustentabilidade ambiental:** ${texto(criterios.criteriosAmbientais, 'critérios de sustentabilidade ambiental do objeto e da execução')}`,
    '',
    `**Logística reversa (desfazimento e reciclagem de bens e refugos):** ${texto(criterios.logisticaReversa, 'logística reversa, com recolhimento, reciclagem e destinação final ambientalmente adequada')}`,
    '',
    `*${verificacao.orientacao} Fundamento: ${verificacao.fundamento}.*`,
  ].join('\n');
  return protegido(verificacao.completa ? SECAO_SUSTENTABILIDADE : `${SECAO_SUSTENTABILIDADE}_pendente`, conteudo);
}

/** Cláusula da prova de conceito ou da amostra (art. 17, § 3º, e art. 41, II), vazia quando não exigida. */
function clausulaProvaConceito(d: DadosDocumento, numero: string): string[] {
  const { provaConceito } = editalCompleto(d.carga.linha.edital);
  if (provaConceito.exigencia === 'nenhuma') return [];
  const rotulo = rotuloExigenciaProvaConceito(provaConceito.exigencia);
  return [
    `${numero} Na fase de julgamento, o licitante provisoriamente vencedor será convocado para a ${rotulo} (art. 17, § 3º, e art. 41, II), a realizar em até ${provaConceito.prazoDiasUteis ?? pendente('prazo em dias úteis')} dias úteis contados da convocação, em sessão pública transmitida e gravada em áudio e vídeo, cujo registro integra o processo. Reprovado o licitante, será convocado o próximo colocado.`,
    '',
    `Roteiro e critérios de aprovação: ${texto(provaConceito.roteiro, 'roteiro de testes e critérios objetivos de aprovação')}`,
    '',
    `Justificativa da exigência: ${texto(provaConceito.justificativa, 'justificativa da necessidade (art. 41, II)')}`,
    '',
  ];
}

// ───────────────────────── DFD ─────────────────────────

function modeloDfd(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { dfd } = linha;
  const requisitante = nomesNoPapel(d.carga, 'requisitante');
  const responsavel = requisitante.length > 0 ? requisitante.join(', ') : (linha.responsavel_nome ?? pendente('responsável pela demanda'));
  const luxo = indiciosArtigoLuxo(dfd);
  const secaoLuxo =
    luxo.length === 0
      ? 'A verificação automática das descrições com a lista de termos indicativos de artigo de luxo (Decreto 10.818/2021) não encontrou indícios. Os bens descritos destinam-se ao atendimento da necessidade com qualidade comum, sem características supérfluas.'
      : [
          'A verificação automática encontrou termos indicativos de artigo de luxo, que exigem justificativa:',
          '',
          ...luxo.map((i) => `- Item ${i.item}: ${i.termos.map((t) => `"${t}"`).join(', ')}.`),
          '',
          `**Justificativa da área requisitante:** ${texto(dfd.justificativaArtigoLuxo, 'justificativa de que o bem é de qualidade comum ou enquadra exceção do Decreto 10.818/2021')}`,
        ].join('\n');
  const corpo = [
    '## 1. Identificação da área requisitante',
    '',
    tabela(
      ['Campo', 'Informação'],
      [
        ['Órgão requisitante', ORGAOS_POR_EXTENSO[linha.orgao]],
        ['Unidade (UASG)', `${linha.uasg} — ${linha.uasg_nome}`],
        ['Processo SEI', linha.numero_sei],
        ['Responsável pela demanda', responsavel],
      ],
    ),
    '',
    '## 2. Descrição sucinta do objeto',
    '',
    `${linha.titulo}. Natureza do objeto: ${ROTULOS_TIPO_OBJETO[dfd.tipoObjeto]}.`,
    '',
    '## 3. Justificativa da necessidade da contratação',
    '',
    texto(dfd.descricaoNecessidade, 'descrição da necessidade (mínimo de 30 caracteres)'),
    '',
    texto(dfd.justificativa, 'justificativa da contratação (mínimo de 30 caracteres)'),
    '',
    '## 4. Quantidades e estimativa preliminar do valor',
    '',
    tabelaItens(d, false),
    '',
    `**Valor total estimado (preliminar): ${formatarMoeda(valorPreliminar(d))}.** A estimativa preliminar será substituída pelo valor apurado na pesquisa de preços (art. 23), na fase de estudos técnicos.`,
    '',
    '## 5. Previsão no plano de contratações anual',
    '',
    dfd.previstoNoPca
      ? `A demanda está prevista no Plano de Contratações Anual de ${ano(d)} do órgão, em conformidade com o art. 12, VII, da Lei 14.133/2021.`
      : `A demanda **não consta** do Plano de Contratações Anual de ${ano(d)}. Cabe à área requisitante solicitar a inclusão no plano ou justificar a contratação não planejada, nos termos do Decreto 10.947/2022.`,
    '',
    '## 6. Padronização e catálogo eletrônico',
    '',
    dfd.usaCatalogoPadronizado
      ? 'Os itens foram descritos com base no catálogo eletrônico de padronização de compras, serviços e obras (CATMAT/CATSER), conforme o art. 19, II, da Lei 14.133/2021.'
      : `Não será utilizado o catálogo eletrônico de padronização. **Justificativa (art. 19, § 2º):** ${texto(dfd.justificativaNaoPadronizacao, 'justificativa escrita da não utilização do catálogo')}`,
    '',
    '## 7. Vedação à aquisição de artigos de luxo (art. 20)',
    '',
    secaoLuxo,
    '',
    '## 8. Prioridade e data pretendida',
    '',
    `Grau de prioridade da contratação e data pretendida para a sua conclusão: ${pendente('prioridade (baixa, média ou alta) e data pretendida, conforme o art. 8º, V e VI, do Decreto 10.947/2022')}.`,
    '',
    '## 9. Encaminhamento',
    '',
    'Encaminhe-se à autoridade competente para ciência, aprovação da demanda e designação da equipe de planejamento da contratação e do agente de contratação, nos termos dos arts. 7º e 8º da Lei 14.133/2021.',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.dfd,
    corpo,
    premissas: [
      `Itens e estimativa preliminar registrados no DFD da Ágora: ${dfd.itens.length} item(ns), total de ${formatarMoeda(valorPreliminar(d))}.`,
      `Previsão no PCA declarada pela área requisitante: ${dfd.previstoNoPca ? 'sim' : 'não'}.`,
      `Uso do catálogo de padronização: ${dfd.usaCatalogoPadronizado ? 'sim' : 'não'}.`,
      'Indícios de artigo de luxo apurados por sinalizarArtigoLuxo (@agora/dominio), por palavra ou expressão inteira.',
    ],
    fontes: [
      'Lei 14.133/2021, art. 12, VII',
      'Lei 14.133/2021, art. 18, caput e inciso I',
      'Lei 14.133/2021, art. 19, II e § 2º',
      'Lei 14.133/2021, art. 20',
      'Decreto 10.947/2022, art. 8º',
      'Decreto 10.818/2021',
    ],
  };
}

// ───────────────────────── ETP ─────────────────────────

function modeloEtp(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const validacao = validarEtp(linha.etp as ConteudoEtp);
  const pendencias = new Map(validacao.pendencias.map((p) => [p.inciso, p]));
  const apoio: Partial<Record<IncisoEtp, string>> = {
    II: `*Dado do processo:* demanda ${linha.dfd.previstoNoPca ? 'prevista' : 'não prevista'} no PCA de ${ano(d)}.`,
    IV: `*Dados do DFD:*\n\n${tabelaItens(d, false)}`,
    VI: d.analise
      ? `*Dado do processo:* valor estimado de ${formatarMoeda(d.valorEstimado ?? 0)}, apurado na pesquisa de preços (${d.analise.estatisticasSaneadas.n} preços válidos, metodologia da ${d.analise.metodologiaRecomendada}).`
      : '*Dado do processo:* pesquisa de preços ainda não registrada.',
    XII: blocoSustentabilidade(d, 'etp'),
  };
  const secoes = INCISOS_ETP.map((inciso) => {
    const conteudo = linha.etp[inciso.inciso];
    const textoInciso = (conteudo?.texto ?? '').trim();
    const ausencia = (conteudo?.justificativaAusencia ?? '').trim();
    const pendencia = pendencias.get(inciso.inciso);
    const linhas = [`## ${inciso.inciso} — ${inciso.titulo}${inciso.obrigatorio ? ' *(elemento obrigatório)*' : ''}`, ''];
    if (textoInciso.length > 0) linhas.push(textoInciso);
    else if (ausencia.length > 0) linhas.push(`**Ausência justificada:** ${ausencia}`);
    if (pendencia) linhas.push(`> ⚠️ Pendência: ${pendencia.mensagem}`);
    const extra = apoio[inciso.inciso];
    if (extra) linhas.push('', extra);
    const secao = linhas.join('\n');
    return inciso.inciso === 'XIII' ? protegido('posicionamento_conclusivo', secao) : secao;
  });
  const corpo = [
    'Este Estudo Técnico Preliminar evidencia o problema a ser resolvido e a melhor solução para atendê-lo, de modo a permitir a avaliação da viabilidade técnica e econômica da contratação (art. 6º, XX, e art. 18, § 1º, da Lei 14.133/2021).',
    '',
    tabela(
      ['Indicador', 'Situação'],
      [
        ['Incisos atendidos (preenchidos ou com ausência justificada)', `${validacao.percentualPreenchido.toLocaleString('pt-BR')}%`],
        ['Elementos obrigatórios (§ 2º: I, IV, VI, VIII e XIII)', validacao.completo ? 'atendidos' : `${validacao.pendencias.length} pendência(s)`],
      ],
    ),
    '',
    ...secoes.flatMap((s) => [s, '']),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.etp,
    corpo: corpo.trimEnd(),
    premissas: [
      `Conteúdo dos 13 incisos registrado no ETP da Ágora; completude apurada por validarEtp (@agora/dominio): ${validacao.percentualPreenchido.toLocaleString('pt-BR')}%.`,
      `Quantidades do DFD (${linha.dfd.itens.length} item(ns)) e valor estimado ${d.valorEstimado === null ? 'não apurado' : formatarMoeda(d.valorEstimado)}.`,
      'O posicionamento conclusivo (inciso XIII) é redigido e assinado pela equipe de planejamento; não é gerado por IA.',
    ],
    fontes: ['Lei 14.133/2021, art. 6º, XX', 'Lei 14.133/2021, art. 18, § 1º, incisos I a XIII, e § 2º', 'IN SEGES/ME 58/2022'],
  };
}

// ───────────────────────── Matriz de riscos ─────────────────────────

function nivelRisco(probabilidade: number, impacto: number): string {
  const nivel = probabilidade * impacto;
  if (nivel >= 20) return `${nivel} — extremo`;
  if (nivel >= 10) return `${nivel} — alto`;
  if (nivel >= 5) return `${nivel} — moderado`;
  return `${nivel} — baixo`;
}

const ROTULOS_ALOCACAO = { contratante: 'Contratante', contratada: 'Contratada', compartilhado: 'Compartilhado' } as const;

function modeloMatrizRiscos(d: DadosDocumento): ModeloDocumento {
  const { riscos } = d.carga.linha;
  const ordenados = [...riscos].sort((a, b) => b.probabilidade * b.impacto - a.probabilidade * a.impacto);
  const contagem = (alocacao: keyof typeof ROTULOS_ALOCACAO) => riscos.filter((r) => r.alocacao === alocacao).length;
  const corpo = [
    'A matriz de riscos é a cláusula contratual que define os riscos e as responsabilidades entre as partes e caracteriza o equilíbrio econômico-financeiro inicial do contrato em relação a eventos supervenientes (art. 6º, XXVII, e art. 103 da Lei 14.133/2021).',
    '',
    '## 1. Escala adotada',
    '',
    'Probabilidade de 1 (rara) a 5 (quase certa); impacto de 1 (insignificante) a 5 (catastrófico). O nível do risco é o produto P × I: 1 a 4 baixo; 5 a 9 moderado; 10 a 16 alto; 20 a 25 extremo. A escala serve à priorização; a classificação final é da equipe de planejamento.',
    '',
    '## 2. Riscos identificados',
    '',
    riscos.length === 0
      ? pendente('identificação dos riscos da contratação')
      : tabela(
          ['Nº', 'Risco', 'P', 'I', 'Nível', 'Alocação', 'Tratamento e mitigação'],
          ordenados.map((r, i) => [
            String(i + 1),
            r.descricao,
            String(r.probabilidade),
            String(r.impacto),
            nivelRisco(r.probabilidade, r.impacto),
            ROTULOS_ALOCACAO[r.alocacao],
            r.mitigacao,
          ]),
        ),
    '',
    '## 3. Alocação dos riscos',
    '',
    `Riscos alocados à contratante: ${contagem('contratante')}; à contratada: ${contagem('contratada')}; compartilhados: ${contagem('compartilhado')}. A alocação considera a natureza do risco, o beneficiário das prestações a que se vincula e a capacidade de cada parte para melhor gerenciá-lo (art. 103, § 1º). Os riscos assumidos pela contratada devem estar precificados na proposta.`,
    '',
    'Atendidas as condições do contrato e da matriz, considera-se mantido o equilíbrio econômico-financeiro, renunciando as partes aos pedidos de restabelecimento relacionados aos riscos assumidos, ressalvadas as alterações unilaterais e a variação de tributos por legislação superveniente (art. 103, § 5º).',
    '',
    '## 4. Obrigatoriedade',
    '',
    'A matriz de alocação de riscos é obrigatória nas obras e serviços de grande vulto e nos regimes de contratação integrada e semi-integrada (art. 22, § 3º). Nos demais casos, é adotada como boa prática de gestão de riscos da contratação (art. 18, X, e art. 22, caput).',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.matriz_riscos,
    corpo,
    premissas: [
      `${riscos.length} risco(s) registrado(s) na matriz da Ágora, com probabilidade, impacto, alocação e mitigação informados pela equipe.`,
      'Nível de risco calculado como probabilidade × impacto (escala 5 × 5) apenas para priorização.',
    ],
    fontes: ['Lei 14.133/2021, art. 6º, XXVII', 'Lei 14.133/2021, art. 18, X', 'Lei 14.133/2021, art. 22', 'Lei 14.133/2021, art. 103'],
  };
}

// ───────────────────────── Nota técnica de preços ─────────────────────────

function modeloNotaTecnica(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { cesta } = linha;
  const item = linha.dfd.itens[0];
  const analise = d.analise;
  const sugeridas = new Map((analise?.sugeridasExpurgo ?? []).map((s) => [s.id, s]));
  const porFonte = new Map<CotacaoArmazenada['fonte'], number>();
  for (const c of cesta.cotacoes) porFonte.set(c.fonte, (porFonte.get(c.fonte) ?? 0) + 1);
  const linhasCotacoes = cesta.cotacoes.map((c, i) => {
    const sugerida = sugeridas.get(c.id);
    const situacao = c.expurgada
      ? `Expurgada — ${c.motivoExpurgo ?? 'motivo não registrado'}`
      : sugerida
        ? `Sugerida para expurgo (${sugerida.motivo === 'inexequivel' ? 'inexequível' : 'excessivamente elevado'})`
        : 'Válida';
    return [String(i + 1), ROTULOS_FONTE[c.fonte], c.descricaoFonte, formatarData(c.dataCotacao), formatarMoeda(c.valorUnitario), situacao];
  });
  const metodo = analise && analise.estatisticas.n >= 4 ? 'critério de Tukey (intervalo interquartil: fora de [Q1 − 1,5·IQR; Q3 + 1,5·IQR])' : 'mediana ± 50%';
  const estatisticas = analise
    ? tabela(
        ['Estatística', 'Conjunto válido', 'Após saneamento'],
        [
          ['Número de preços', String(analise.estatisticas.n), String(analise.estatisticasSaneadas.n)],
          ['Média', formatarMoeda(analise.estatisticas.media), formatarMoeda(analise.estatisticasSaneadas.media)],
          ['Mediana', formatarMoeda(analise.estatisticas.mediana), formatarMoeda(analise.estatisticasSaneadas.mediana)],
          ['Menor valor', formatarMoeda(analise.estatisticas.menor), formatarMoeda(analise.estatisticasSaneadas.menor)],
          ['Maior valor', formatarMoeda(analise.estatisticas.maior), '—'],
          ['Desvio-padrão', formatarMoeda(analise.estatisticas.desvioPadrao), '—'],
          [
            'Coeficiente de variação',
            `${analise.estatisticas.coeficienteVariacao.toLocaleString('pt-BR')}%`,
            `${analise.estatisticasSaneadas.coeficienteVariacao.toLocaleString('pt-BR')}%`,
          ],
        ],
      )
    : pendente('cotações válidas para o tratamento estatístico');
  const corpo = [
    '## 1. Objeto da pesquisa',
    '',
    item
      ? `Pesquisa de preços do item de referência (item 1 do DFD): **${item.descricao}**, unidade de fornecimento "${item.unidade}", quantidade de ${numero(item.quantidade)}. Os demais itens, quando houver, seguem a estimativa preliminar do DFD.`
      : pendente('item de referência da pesquisa'),
    '',
    '## 2. Parâmetros utilizados (art. 23, § 1º)',
    '',
    ...(Object.keys(ROTULOS_FONTE) as CotacaoArmazenada['fonte'][]).map((fonte) => `- ${ROTULOS_FONTE[fonte]}: ${porFonte.get(fonte) ?? 0} cotação(ões).`),
    '',
    'A pesquisa combinou parâmetros oficiais e de mercado, priorizando o Painel de Preços e as contratações similares, nos termos do art. 5º da IN SEGES/ME 65/2021. As cotações diretas foram obtidas mediante solicitação formal, com justificativa da escolha dos fornecedores.',
    '',
    '## 3. Cotações obtidas',
    '',
    cesta.cotacoes.length === 0
      ? pendente('cotações da cesta de preços')
      : tabela(['Nº', 'Parâmetro', 'Descrição da fonte', 'Data', 'Valor unitário', 'Situação'], linhasCotacoes),
    '',
    '## 4. Tratamento estatístico e saneamento',
    '',
    estatisticas,
    '',
    `Critério de saneamento: ${metodo}. Foram desconsiderados os preços inexequíveis, inconsistentes ou excessivamente elevados (IN SEGES/ME 65/2021, art. 6º, § 1º), com justificativa registrada no processo.`,
    ...(analise && analise.sugeridasExpurgo.length > 0
      ? ['', 'Sugestões do saneamento estatístico ainda pendentes de decisão do agente responsável:', '', ...analise.sugeridasExpurgo.map((s) => `- ${s.explicacao}`)]
      : []),
    '',
    analise ? `> ${analise.aviso}` : '',
    '',
    '## 5. Metodologia e valor estimado',
    '',
    analise && item
      ? [
          `Coeficiente de variação após o saneamento: ${analise.estatisticasSaneadas.coeficienteVariacao.toLocaleString('pt-BR')}%. Metodologia adotada: **${analise.metodologiaRecomendada}** dos preços saneados (CV até 25% → média; acima → mediana), na forma do art. 6º da IN SEGES/ME 65/2021.`,
          '',
          tabela(
            ['Referência', 'Valor'],
            [
              ['Valor unitário estimado do item de referência', formatarMoeda(analise.valorEstimado)],
              [`Valor total do item (× ${numero(item.quantidade)})`, formatarMoeda(analise.valorEstimado * item.quantidade)],
              ['Valor global estimado da contratação', formatarMoeda(d.valorEstimado ?? 0)],
            ],
          ),
        ].join('\n')
      : pendente('valor estimado (depende de cotações válidas)'),
    '',
    '## 6. Alertas da análise',
    '',
    analise && analise.alertas.length > 0
      ? analise.alertas.map((a) => `- **${a.codigo}** — ${a.mensagem} (${a.fundamento})`).join('\n')
      : analise
        ? 'Nenhum alerta: a cesta atende aos parâmetros do art. 23, § 1º, e da IN SEGES/ME 65/2021.'
        : pendente('análise da cesta'),
    '',
    '## 7. Sigilo do orçamento (art. 24)',
    '',
    cesta.orcamentoSigiloso
      ? `O orçamento estimado terá caráter sigiloso até o julgamento das propostas, sem prejuízo da divulgação dos quantitativos e das demais informações necessárias à elaboração das propostas. O sigilo não prevalece para os órgãos de controle interno e externo. **Motivo:** ${texto(cesta.motivoSigilo, 'motivo do sigilo')}`
      : 'O orçamento estimado não é sigiloso e será divulgado com o edital.',
    '',
    '## 8. Responsabilidade',
    '',
    'A estimativa observa os parâmetros legais e deve ser ratificada pelo agente responsável pela pesquisa, que responde pela escolha das fontes e pelos expurgos realizados.',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.nota_tecnica_precos,
    corpo,
    premissas: [
      `${cesta.cotacoes.length} cotação(ões) registradas na cesta, ${cesta.cotacoes.filter((c) => c.expurgada).length} expurgada(s) com justificativa.`,
      `Estatísticas, sugestões de expurgo e alertas calculados por analisarCestaPrecos (@agora/dominio) com data de referência ${formatarData(d.dataGeracao)}.`,
      'A cesta de preços refere-se ao item 1 do DFD (item de referência).',
    ],
    fontes: ['Lei 14.133/2021, art. 23, § 1º', 'Lei 14.133/2021, art. 24', 'IN SEGES/ME 65/2021, arts. 5º e 6º'],
  };
}

// ───────────────────────── Termo de referência ─────────────────────────

function modeloTr(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { dfd, edital, etp } = linha;
  const bem = ehBem(d);
  const prazo = prazoPropostas(d);
  const itensMeEpp = dfd.itens
    .map((item, indice) => ({ indice: indice + 1, total: item.quantidade * item.valorUnitarioEstimado }))
    .filter((i) => i.total > 0 && i.total <= 8_000_000);
  const corpo = [
    'Termo de referência elaborado a partir do Estudo Técnico Preliminar, com os parâmetros e elementos descritivos do art. 6º, XXIII, da Lei 14.133/2021.',
    '',
    '## a) Definição do objeto, quantitativos e prazo do contrato',
    '',
    `Constitui objeto desta contratação: **${linha.titulo}**, de natureza ${ROTULOS_TIPO_OBJETO[dfd.tipoObjeto]}, nos quantitativos abaixo.`,
    '',
    tabelaItens(d, true),
    '',
    bem
      ? `O prazo de vigência do contrato é de ${vigenciaMeses} meses, contados da assinatura, com entrega em até ${prazoEntregaDias} dias corridos do recebimento da ordem de fornecimento. Não concluído o objeto no prazo, a vigência será prorrogada automaticamente para a sua conclusão, sem prejuízo das sanções cabíveis (art. 111).`
      : `O prazo de vigência do contrato é de ${vigenciaMeses} meses, contados da assinatura, admitida a prorrogação na forma dos arts. 106 e 107, se demonstrada a vantajosidade.`,
    '',
    '## b) Fundamentação da contratação',
    '',
    `A contratação fundamenta-se no ${referenciaSei(d.carga, 'etp')} e no ${referenciaSei(d.carga, 'dfd')}. Em síntese: ${texto(dfd.descricaoNecessidade, 'necessidade da contratação')}`,
    '',
    '## c) Descrição da solução como um todo',
    '',
    texto(etp.VII?.texto, 'descrição da solução como um todo, considerado o ciclo de vida do objeto (ETP, inciso VII)'),
    '',
    '## d) Requisitos da contratação',
    '',
    texto(etp.III?.texto, 'requisitos da contratação (ETP, inciso III)'),
    '',
    bem
      ? 'Os bens devem ser novos, de primeiro uso, entregues em embalagem original e acompanhados de manual em português e do certificado de garantia do fabricante. Aplicam-se os critérios de sustentabilidade do Guia Nacional de Contratações Sustentáveis, no que couber.'
      : 'Os serviços devem ser prestados por profissionais qualificados, com observância das normas técnicas aplicáveis e dos critérios de sustentabilidade do Guia Nacional de Contratações Sustentáveis, no que couber.',
    '',
    '### Sustentabilidade ambiental e logística reversa',
    '',
    blocoSustentabilidade(d, 'tr'),
    '',
    '## e) Modelo de execução do objeto',
    '',
    bem
      ? `A entrega ocorrerá na unidade ${linha.uasg_nome}, em dias úteis e horário de expediente, mediante agendamento. O recebimento será provisório, pelo fiscal técnico, para verificação da conformidade, e definitivo, por servidor ou comissão designada, após a verificação da qualidade e da quantidade (art. 140, II).`
      : 'A execução será iniciada a partir da ordem de serviço, conforme cronograma aprovado pela fiscalização. O recebimento será provisório, pelo fiscal, e definitivo, por servidor ou comissão designada, mediante termo detalhado (art. 140, I).',
    '',
    '## f) Modelo de gestão do contrato',
    '',
    `A execução será acompanhada e fiscalizada por gestor e fiscais designados (art. 117): gestor do contrato — ${nomesOuPendente(d.carga, 'gestor_contrato')}; fiscal técnico — ${nomesOuPendente(d.carga, 'fiscal_tecnico')}; fiscal administrativo — ${nomesOuPendente(d.carga, 'fiscal_administrativo')}. As ocorrências serão registradas e comunicadas formalmente ao preposto da contratada, e as que ultrapassarem a competência da fiscalização serão levadas à autoridade superior (art. 117, §§ 1º e 2º).`,
    '',
    '## g) Critérios de medição e de pagamento',
    '',
    bem
      ? 'O pagamento será efetuado após o recebimento definitivo e o atesto da nota fiscal, observada a ordem cronológica de exigibilidade por fonte de recursos (art. 141). A regularidade fiscal e trabalhista será conferida antes de cada pagamento.'
      : 'A medição será mensal, com base nos níveis de serviço e nos indicadores previstos, e o pagamento ocorrerá após o atesto, observada a ordem cronológica de exigibilidade por fonte de recursos (art. 141).',
    'Em caso de atraso imputável à Administração, o valor devido será atualizado monetariamente pelo IPCA, de forma pro rata, entre o adimplemento e o pagamento (art. 92, V).',
    '',
    '## h) Forma e critérios de seleção do fornecedor',
    '',
    `Modalidade prevista: **${linha.modalidade_prevista ?? 'Pregão eletrônico'}**, na forma eletrônica, com critério de julgamento de **${ROTULOS_CRITERIO[edital.criterioJulgamento] ?? edital.criterioJulgamento}** e modo de disputa aberto (arts. 33 e 56), ${ROTULOS_REGIME[edital.regimeExecucao]}. Prazo mínimo para apresentação de propostas: ${prazo.diasUteis} dias úteis (${prazo.fundamento}). As exigências de habilitação constarão do edital, limitadas às dos arts. 62 a 70.`,
    'Aplicam-se os benefícios da Lei Complementar 123/2006 às microempresas e empresas de pequeno porte (art. 4º da Lei 14.133/2021).',
    ...clausulaProvaConceito(d, '').map((l) => l.trimStart()),
    ...(itensMeEpp.length > 0
      ? [`O(s) item(ns) ${itensMeEpp.map((i) => i.indice).join(', ')} têm valor estimado de até R$ 80.000,00: avaliar a participação exclusiva de ME/EPP (LC 123/2006, art. 48, I), ressalvadas as hipóteses do art. 49.`]
      : []),
    '',
    '## i) Estimativas do valor da contratação',
    '',
    linha.cesta.orcamentoSigiloso
      ? `O orçamento estimado tem caráter sigiloso (art. 24), divulgando-se apenas os quantitativos e as informações necessárias à elaboração das propostas. Os preços unitários referenciais, a memória de cálculo e os documentos de suporte constam da ${referenciaSei(d.carga, 'nota_tecnica_precos')}, classificada.`
      : `Valor global estimado: **${d.valorEstimado === null ? pendente('valor estimado') : formatarMoeda(d.valorEstimado)}**. Os preços unitários referenciais, a memória de cálculo e os parâmetros utilizados constam da ${referenciaSei(d.carga, 'nota_tecnica_precos')}.`,
    '',
    '## j) Adequação orçamentária',
    '',
    `As despesas correrão à conta de recursos consignados no Orçamento Geral da União para o exercício de ${ano(d)}: ${pendente('programa de trabalho, natureza da despesa e fonte de recursos, a indicar pela área orçamentária')}.`,
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.tr,
    corpo,
    premissas: [
      `Objeto, natureza e quantitativos do DFD (${dfd.itens.length} item(ns)); valor estimado ${d.valorEstimado === null ? 'não apurado' : formatarMoeda(d.valorEstimado)}.`,
      `Parâmetros do edital: critério ${ROTULOS_CRITERIO[edital.criterioJulgamento] ?? edital.criterioJulgamento}, ${ROTULOS_REGIME[edital.regimeExecucao]}; condições de referência: vigência de ${vigenciaMeses} meses${bem ? `, entrega em ${prazoEntregaDias} dias` : ''}.`,
      `Prazo mínimo de propostas por prazoMinimoPropostas (@agora/dominio): ${prazo.diasUteis} dias úteis.`,
      'Gestor e fiscais conforme as designações registradas na equipe do processo.',
      `Critérios de sustentabilidade e logística reversa do processo, conferidos por verificarSustentabilidade (@agora/dominio); política do órgão ${(d.politicaSustentabilidade ?? true) ? 'ligada' : 'desligada'}.`,
    ],
    fontes: [
      'Lei 14.133/2021, art. 6º, XXIII, alíneas a a j',
      'Lei 14.133/2021, arts. 24, 40, 55, 92, 111, 117, 140 e 141',
      'Lei Complementar 123/2006, arts. 48 e 49',
    ],
  };
}

// ───────────────────────── Edital ─────────────────────────

function secaoHabilitacao(d: DadosDocumento): string {
  const { edital } = d.carga.linha;
  const valor = d.valorEstimado ?? 0;
  const pl = edital.patrimonioLiquidoMinimoPercentual;
  const linhasEconomica = [
    '6.3. Habilitação econômico-financeira (art. 69): certidão negativa de falência expedida pelo distribuidor da sede do licitante e balanço patrimonial, demonstração de resultado de exercício e demais demonstrações contábeis dos 2 últimos exercícios sociais.',
    edital.exigeFaturamentoMinimo
      ? '> ⚠️ Parâmetro em desacordo com o art. 69, § 2º: exigência de faturamento mínimo anterior. Revise os parâmetros do edital antes de avançar.'
      : 'É vedada a exigência de valores mínimos de faturamento anterior e de índices de rentabilidade ou lucratividade (art. 69, § 2º).',
    pl === null
      ? 'Não será exigido capital mínimo ou patrimônio líquido mínimo.'
      : `Será exigido patrimônio líquido mínimo de ${pl.toLocaleString('pt-BR')}% do valor estimado da contratação (${formatarMoeda(Math.round((valor * pl) / 100))})${pl > LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL ? ` — ⚠️ acima do limite de ${LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL}% do art. 69, § 4º` : `, dentro do limite de ${LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL}% (art. 69, § 4º)`}.`,
  ];
  return protegido(
    'habilitacao',
    [
      '## 6. Da habilitação',
      '',
      '6.1. Habilitação jurídica (art. 66): documentos que comprovem a existência jurídica e a capacidade do licitante para exercer direitos e assumir obrigações.',
      '',
      '6.2. Habilitação fiscal, social e trabalhista (art. 68): inscrição no CNPJ; regularidade perante as Fazendas federal, estadual e municipal, a seguridade social e o FGTS; regularidade trabalhista (CNDT); e cumprimento do art. 7º, XXXIII, da Constituição.',
      '',
      ...linhasEconomica.flatMap((l) => [l, '']),
      `6.4. Qualificação técnica (art. 67): ${pendente('atestados de capacidade técnica compatíveis com o objeto, conforme o termo de referência')}.`,
      '',
      '6.5. A habilitação será verificada por meio do SICAF, sempre que possível (art. 87), e somente do licitante vencedor, após o julgamento das propostas (art. 63, II). O exame da documentação é ato do agente de contratação.',
    ].join('\n'),
  );
}

function secaoSancoes(): string {
  return protegido(
    'sancoes',
    [
      '## 8. Das infrações e sanções administrativas',
      '',
      '8.1. Comete infração administrativa o licitante ou contratado que incorrer nas condutas do art. 155 da Lei 14.133/2021, entre elas deixar de entregar a documentação exigida, não manter a proposta, não celebrar o contrato quando convocado, apresentar declaração ou documentação falsa e fraudar a licitação.',
      '',
      '8.2. Serão aplicáveis, conforme a natureza e a gravidade da infração, as sanções do art. 156: advertência; multa de 0,5% a 30% do valor do contrato (§ 3º); impedimento de licitar e contratar por até 3 anos (§ 4º); e declaração de inidoneidade por 3 a 6 anos (§ 5º).',
      '',
      '8.3. A aplicação de sanção será precedida de processo com contraditório e ampla defesa (arts. 157 e 158), e a decisão cabe exclusivamente à autoridade competente. As sanções serão registradas no CEIS e no CNEP em até 15 dias úteis (art. 161).',
    ].join('\n'),
  );
}

function modeloEdital(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { edital, publicacao } = linha;
  const modalidade = linha.modalidade_prevista ?? 'Pregão eletrônico';
  const prazo = prazoPropostas(d);
  const { inversaoFases: inversao, provaConceito } = editalCompleto(edital);
  const prazosTexto =
    publicacao.publicadoEm && publicacao.dataMinimaPropostas
      ? `3.1. Edital divulgado no PNCP em ${formatarData(publicacao.publicadoEm)}. As propostas poderão ser abertas a partir de ${formatarData(publicacao.dataMinimaPropostas)}, observado o prazo mínimo de ${prazo.diasUteis} dias úteis (${prazo.fundamento}).`
      : `3.1. Entre a divulgação deste edital e a apresentação das propostas será observado o prazo mínimo de ${prazo.diasUteis} dias úteis (${prazo.fundamento}), contado na forma do art. 183. A data da sessão será fixada na publicação.`;
  const corpo = [
    `**${modalidade.toUpperCase()} Nº ${pendente('número/ano')}**`,
    '',
    `A União, por intermédio da unidade ${linha.uasg_nome} (UASG ${linha.uasg}), torna público que realizará licitação na modalidade ${modalidade.toLowerCase()}, na forma eletrônica, com critério de julgamento de ${ROTULOS_CRITERIO[edital.criterioJulgamento] ?? edital.criterioJulgamento} e modo de disputa aberto, nos termos da Lei 14.133/2021, da Lei Complementar 123/2006 e das demais normas aplicáveis, e de acordo com as condições deste edital e de seus anexos.`,
    '',
    '## 1. Do objeto',
    '',
    `1.1. O objeto da licitação é ${linha.titulo.charAt(0).toLowerCase()}${linha.titulo.slice(1)}, conforme as especificações, quantidades e condições do Termo de Referência (Anexo I).`,
    '',
    tabelaItens(d, !linha.cesta.orcamentoSigiloso),
    '',
    ...(linha.cesta.orcamentoSigiloso ? ['1.2. O orçamento estimado tem caráter sigiloso (art. 24) e será divulgado após o julgamento das propostas.', ''] : []),
    '## 2. Da participação e do acesso ao edital',
    '',
    '2.1. O edital e todos os seus anexos, incluídos o termo de referência e a minuta de contrato, estão divulgados no Portal Nacional de Contratações Públicas (PNCP) e no sítio eletrônico oficial do órgão, na mesma data, **sem necessidade de registro ou de identificação para acesso** (art. 25, § 3º). É vedada a exigência de registro cadastral complementar para acesso ao edital e aos anexos (art. 87, § 2º).',
    ...(edital.exigeRegistroCadastralComplementar
      ? ['', '> ⚠️ Parâmetro em desacordo com o art. 87, § 2º: o edital está configurado para exigir registro cadastral complementar. Revise os parâmetros do edital antes de avançar.']
      : []),
    '',
    '2.2. Poderão participar os interessados cujo ramo de atividade seja compatível com o objeto, previamente credenciados no sistema eletrônico de licitações. Não poderão participar as pessoas físicas e jurídicas incursas nas vedações do art. 14, inclusive as impedidas de licitar e contratar ou declaradas inidôneas.',
    '',
    '2.3. As microempresas e empresas de pequeno porte terão o tratamento diferenciado da Lei Complementar 123/2006, nos termos do art. 4º da Lei 14.133/2021.',
    '',
    '## 3. Dos prazos',
    '',
    prazosTexto,
    '',
    '3.2. Pedidos de esclarecimento e impugnações poderão ser apresentados por qualquer pessoa até 3 dias úteis antes da data de abertura do certame; as respostas serão divulgadas em até 3 dias úteis, limitadas ao último dia útil anterior à abertura (art. 164).',
    '',
    '## 4. Da apresentação das propostas e dos lances',
    '',
    '4.1. Os licitantes encaminharão, exclusivamente pelo sistema, proposta com a descrição do objeto e o preço, até a data e o horário estabelecidos. Na etapa competitiva, os lances serão sucessivos e públicos, observado o modo de disputa adotado (art. 56).',
    '',
    '## 5. Do julgamento e do desempate',
    '',
    `5.1. As propostas serão julgadas pelo critério de ${ROTULOS_CRITERIO[edital.criterioJulgamento] ?? edital.criterioJulgamento} (art. 33). Serão desclassificadas as propostas que contiverem vícios insanáveis, não obedecerem às especificações, apresentarem preços inexequíveis ou permanecerem acima do orçamento estimado (art. 59).`,
    '',
    '5.2. Em caso de empate, será assegurada a preferência das microempresas e empresas de pequeno porte (LC 123/2006, arts. 44 e 45) e, persistindo o empate, serão aplicados sucessivamente os critérios do art. 60: I — disputa final entre os empatados; II — avaliação do desempenho contratual prévio; III — desenvolvimento de ações de equidade entre homens e mulheres no ambiente de trabalho; IV — desenvolvimento de programa de integridade; e, em igualdade de condições, as preferências do art. 60, § 1º.',
    '',
    ...clausulaProvaConceito(d, '5.3.'),
    ...(inversao.adotada
      ? [
          `5.4. Por ato motivado (art. 17, § 1º), a fase de habilitação antecederá as de apresentação de propostas e de julgamento. Motivação: ${texto(inversao.motivacao, 'motivação e benefícios da inversão de fases')}`,
          '',
        ]
      : []),
    secaoHabilitacao(d),
    '',
    '## 7. Dos recursos',
    '',
    '7.1. A intenção de recorrer deverá ser manifestada imediatamente após o ato, sob pena de preclusão, e as razões serão apresentadas em 3 dias úteis, contados da intimação ou da lavratura da ata (art. 165, I e § 1º). Os demais licitantes poderão apresentar contrarrazões em igual prazo (art. 165, § 4º).',
    '',
    `7.2. A fase recursal é única e ocorre após a ${inversao.adotada ? 'fase de julgamento, em razão da inversão de fases' : 'habilitação'} (art. 165, § 1º, II). O recurso será dirigido a quem praticou o ato, que poderá reconsiderá-lo em 3 dias úteis; mantido o ato, o recurso será encaminhado à autoridade superior, que decidirá em até 10 dias úteis do recebimento dos autos (art. 165, § 2º).`,
    '',
    '7.3. Exauridos os recursos, a autoridade superior adjudicará o objeto e homologará a licitação (art. 71, IV). Após a homologação, os documentos elaborados na fase preparatória que não integraram este edital serão divulgados no PNCP e no sítio eletrônico oficial (art. 54, § 3º).',
    '',
    secaoSancoes(),
    '',
    '## 9. Da fiscalização do contrato',
    '',
    '9.1. A execução do contrato será acompanhada e fiscalizada por gestor e fiscais designados, na forma do art. 117 e do modelo de gestão do Termo de Referência.',
    '',
    '## 10. Do pagamento',
    '',
    '10.1. O pagamento observará os critérios de medição e de pagamento do Termo de Referência e a ordem cronológica de exigibilidade por fonte de recursos (art. 141).',
    '',
    '## 11. Das disposições gerais',
    '',
    '11.1. Integram este edital: Anexo I — Termo de Referência; Anexo II — Minuta do Contrato; Anexo III — Modelo de proposta.',
    '',
    '11.2. O extrato deste edital será publicado no Diário Oficial da União e em jornal diário de grande circulação, e o inteiro teor, no PNCP (art. 54, caput e § 1º).',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.edital,
    corpo,
    premissas: [
      `Modalidade ${modalidade}; critério ${ROTULOS_CRITERIO[edital.criterioJulgamento] ?? edital.criterioJulgamento}; ${ROTULOS_REGIME[edital.regimeExecucao]}.`,
      `Habilitação econômico-financeira: faturamento mínimo ${edital.exigeFaturamentoMinimo ? 'exigido' : 'não exigido'}; patrimônio líquido mínimo ${descreverPatrimonio(edital.patrimonioLiquidoMinimoPercentual)}; registro cadastral complementar ${edital.exigeRegistroCadastralComplementar ? 'exigido' : 'não exigido'}.`,
      `Prazo mínimo de propostas por prazoMinimoPropostas (@agora/dominio): ${prazo.diasUteis} dias úteis.`,
      `Prova de conceito ou amostra: ${provaConceito.exigencia === 'nenhuma' ? 'não exigida' : `${rotuloExigenciaProvaConceito(provaConceito.exigencia)} em ${provaConceito.prazoDiasUteis ?? '—'} dias úteis da convocação`}; inversão de fases ${inversao.adotada ? 'adotada' : 'não adotada'}.`,
      'As seções de habilitação e de sanções seguem o texto-padrão da Ágora e não são redigidas por IA.',
    ],
    fontes: [
      'Lei 14.133/2021, art. 25 e § 3º',
      'Lei 14.133/2021, arts. 33, 54, 55, 56, 59 e 60',
      'Lei 14.133/2021, arts. 62 a 70 (habilitação), especialmente art. 69, §§ 2º e 4º',
      'Lei 14.133/2021, art. 87, § 2º',
      'Lei 14.133/2021, arts. 155, 156, 164 e 165',
      'Lei Complementar 123/2006, arts. 42 a 49',
    ],
  };
}

function descreverPatrimonio(percentual: number | null): string {
  return percentual === null ? 'não exigido' : `${percentual.toLocaleString('pt-BR')}% do valor estimado`;
}

// ───────────────────────── Minuta de contrato ─────────────────────────

const ORDINAIS = [
  'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA', 'DÉCIMA',
  'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA', 'DÉCIMA TERCEIRA', 'DÉCIMA QUARTA', 'DÉCIMA QUINTA', 'DÉCIMA SEXTA',
  'DÉCIMA SÉTIMA', 'DÉCIMA OITAVA', 'DÉCIMA NONA', 'VIGÉSIMA', 'VIGÉSIMA PRIMEIRA', 'VIGÉSIMA SEGUNDA', 'VIGÉSIMA TERCEIRA',
] as const;

interface Clausula {
  titulo: string;
  /** Dispositivo legal da cláusula (ex.: 'art. 92, I'). */
  referencia: string;
  texto: string;
  protegida?: string;
}

function modeloMinuta(d: DadosDocumento): ModeloDocumento {
  const { linha } = d.carga;
  const { edital } = linha;
  const bem = ehBem(d);
  const software = envolveSoftware(d);
  const dataBase = linha.publicacao.publicadoEm ?? d.dataGeracao;
  const clausulas: Clausula[] = [
    {
      titulo: 'DO OBJETO',
      referencia: 'art. 92, I',
      texto: `O objeto deste contrato é ${linha.titulo.charAt(0).toLowerCase()}${linha.titulo.slice(1)}, nas condições estabelecidas no Termo de Referência, conforme a tabela de itens, quantidades e preços da proposta vencedora.`,
    },
    {
      titulo: 'DA VINCULAÇÃO AO EDITAL E À PROPOSTA',
      referencia: 'art. 92, II',
      texto: 'Vinculam este contrato, independentemente de transcrição: o Termo de Referência; o edital da licitação; a proposta do contratado; e eventuais anexos dos documentos supracitados.',
    },
    {
      titulo: 'DA LEGISLAÇÃO APLICÁVEL',
      referencia: 'art. 92, III',
      texto: 'Este contrato rege-se pela Lei 14.133/2021, pelas suas cláusulas e pelos preceitos de direito público, aplicando-se supletivamente os princípios da teoria geral dos contratos e as disposições de direito privado (art. 89). Os casos omissos serão decididos pelo contratante, segundo as disposições da Lei 14.133/2021 e demais normas aplicáveis.',
    },
    {
      titulo: 'DO REGIME DE EXECUÇÃO OU DA FORMA DE FORNECIMENTO',
      referencia: 'art. 92, IV',
      texto: bem
        ? `O fornecimento será realizado de acordo com o Termo de Referência, com entrega em até ${prazoEntregaDias} dias corridos contados do recebimento da ordem de fornecimento, no endereço indicado pelo contratante.`
        : 'A execução será indireta, nos termos do Termo de Referência, iniciando-se a partir da emissão da ordem de serviço.',
    },
    {
      titulo: 'DO PREÇO, DO PAGAMENTO, DO REAJUSTE E DA ATUALIZAÇÃO MONETÁRIA',
      referencia: 'art. 92, V',
      texto: [
        `O valor total da contratação é de ${pendente('valor da proposta vencedora')}. No preço estão incluídos todos os custos diretos e indiretos, tributos, encargos, fretes e seguros.`,
        `Os preços serão reajustados pelo IPCA, com data-base vinculada à data do orçamento estimado (${formatarData(dataBase)}), observado o interregno mínimo de 12 meses (art. 25, § 7º, e art. 92, § 3º).`,
        'Entre a data do adimplemento e a do efetivo pagamento, os valores serão atualizados monetariamente pelo IPCA, de forma pro rata.',
      ].join(' '),
    },
    {
      titulo: 'DOS CRITÉRIOS DE MEDIÇÃO, DA LIQUIDAÇÃO E DO PAGAMENTO',
      referencia: 'art. 92, VI',
      texto: 'A medição, a liquidação e o pagamento seguirão o Termo de Referência. O pagamento observará a ordem cronológica de exigibilidade por fonte de recursos (art. 141) e será precedido da verificação da regularidade fiscal e trabalhista do contratado.',
    },
    {
      titulo: 'DOS PRAZOS DE EXECUÇÃO, DE ENTREGA E DE RECEBIMENTO',
      referencia: 'art. 92, VII',
      texto: `A vigência é de ${vigenciaMeses} meses, contados da assinatura. O recebimento será provisório, pelo responsável pelo acompanhamento e fiscalização, e definitivo, por servidor ou comissão designada, em ${pendente('prazos de recebimento provisório e definitivo')}, nos termos do art. 140.`,
    },
    {
      titulo: 'DO CRÉDITO ORÇAMENTÁRIO',
      referencia: 'art. 92, VIII',
      texto: `A despesa correrá à conta do crédito orçamentário: ${pendente('programa de trabalho, natureza da despesa, fonte de recursos e nota de empenho')}.`,
    },
    {
      titulo: 'DA MATRIZ DE RISCOS',
      referencia: 'art. 92, IX',
      texto: `Integra este contrato a ${referenciaSei(d.carga, 'matriz_riscos')}, com ${linha.riscos.length} risco(s) identificado(s) e a respectiva alocação entre as partes (art. 103).`,
    },
    {
      titulo: 'DO PRAZO PARA RESPOSTA AO PEDIDO DE REPACTUAÇÃO',
      referencia: 'art. 92, X',
      texto: bem
        ? 'Não se aplica repactuação, por não se tratar de serviço contínuo com regime de dedicação exclusiva de mão de obra ou com predominância de mão de obra (art. 135).'
        : 'Quando cabível a repactuação (art. 135), o pedido será respondido no prazo de até 1 mês, contado da apresentação da documentação completa (art. 92, § 6º).',
    },
    {
      titulo: 'DO PRAZO PARA RESPOSTA AO PEDIDO DE RESTABELECIMENTO DO EQUILÍBRIO ECONÔMICO-FINANCEIRO',
      referencia: 'art. 92, XI',
      texto: 'Concluída a instrução do pedido de restabelecimento do equilíbrio econômico-financeiro (art. 124, II, "d"), o contratante decidirá no prazo de 1 mês, admitida a prorrogação motivada por igual período (art. 123, parágrafo único).',
    },
    {
      titulo: 'DAS GARANTIAS DE EXECUÇÃO',
      referencia: 'art. 92, XII',
      texto:
        `O contratado prestará garantia de ${garantiaExecucaoPercentual}% do valor inicial do contrato, em uma das modalidades do art. 96, § 1º (caução em dinheiro ou em títulos da dívida pública, seguro-garantia, fiança bancária ou título de capitalização), observados os arts. 96 a 98. ${pendente('confirmar a exigência e o percentual da garantia (até 5%, ou até 10% justificadamente — art. 98)')}`,
    },
    {
      titulo: 'DA GARANTIA DO OBJETO E DA ASSISTÊNCIA TÉCNICA',
      referencia: 'art. 92, XIII',
      texto: bem
        ? `O prazo de garantia do objeto será de ${pendente('prazo de garantia, não inferior ao do fabricante e ao legal')}, com assistência técnica nas condições do Termo de Referência, sem prejuízo das garantias do Código de Defesa do Consumidor.`
        : 'Os serviços terão garantia de qualidade pelo prazo previsto no Termo de Referência, obrigando-se o contratado a refazer, sem ônus, os serviços rejeitados pela fiscalização.',
    },
    {
      titulo: 'DOS DIREITOS, DAS RESPONSABILIDADES, DAS PENALIDADES E DAS MULTAS',
      referencia: 'art. 92, XIV',
      protegida: 'penalidades',
      texto: [
        'São direitos e responsabilidades das partes os previstos no Termo de Referência e na Lei 14.133/2021. O contratado responde pelos danos causados ao contratante ou a terceiros em razão da execução do contrato (art. 120) e pelos encargos trabalhistas, previdenciários, fiscais e comerciais (art. 121).',
        'Pelas infrações do art. 155, o contratado ficará sujeito às sanções do art. 156: advertência; multa de 0,5% a 30% do valor do contrato, calculada sobre o valor do contrato; impedimento de licitar e contratar; e declaração de inidoneidade. A sanção será aplicada pela autoridade competente, após processo com contraditório e ampla defesa (arts. 157 e 158).',
      ].join(' '),
    },
    {
      titulo: 'DAS CONDIÇÕES DE IMPORTAÇÃO E DO CÂMBIO',
      referencia: 'art. 92, XV',
      texto: 'Não se aplica: os preços são cotados e pagos em moeda nacional, cabendo ao contratado eventuais providências de importação, sem ônus adicional ao contratante.',
    },
    {
      titulo: 'DA MANUTENÇÃO DAS CONDIÇÕES DE HABILITAÇÃO',
      referencia: 'art. 92, XVI',
      protegida: 'habilitacao',
      texto: 'O contratado obriga-se a manter, durante toda a execução do contrato, em compatibilidade com as obrigações assumidas, todas as condições exigidas para a habilitação na licitação. A regularidade será verificada antes de cada pagamento e de eventual prorrogação (art. 91, § 4º).',
    },
    {
      titulo: 'DA RESERVA DE CARGOS',
      referencia: 'art. 92, XVII',
      texto: 'O contratado deverá cumprir, ao longo de toda a execução, a reserva de cargos prevista em lei para pessoa com deficiência, para reabilitado da Previdência Social e para aprendiz, comprovando-a sempre que solicitado (art. 116).',
    },
    {
      titulo: 'DO MODELO DE GESTÃO DO CONTRATO',
      referencia: 'art. 92, XVIII',
      texto: `A gestão e a fiscalização serão exercidas por gestor e fiscais designados (art. 117): gestor — ${nomesOuPendente(d.carga, 'gestor_contrato')}; fiscal técnico — ${nomesOuPendente(d.carga, 'fiscal_tecnico')}. O contratado manterá preposto aceito pelo contratante para representá-lo na execução (art. 118).`,
    },
    {
      titulo: 'DA EXTINÇÃO',
      referencia: 'art. 92, XIX',
      texto: 'O contrato poderá ser extinto pelos motivos do art. 137, de forma unilateral, consensual ou por decisão arbitral ou judicial (art. 138), assegurados o contraditório e a ampla defesa e observadas as consequências do art. 139.',
    },
  ];
  if (software) {
    clausulas.push({
      titulo: 'DA CESSÃO DOS DIREITOS PATRIMONIAIS',
      referencia: 'art. 93',
      texto: 'Nas parcelas que envolvam desenvolvimento ou customização de software sob encomenda, o contratado cede ao contratante todos os direitos patrimoniais relativos aos programas, à documentação técnica associada e aos códigos-fonte, que poderão ser livremente utilizados e alterados pela Administração (art. 93). Para licenças de uso de software de prateleira, a cessão abrange as customizações, integrações e documentos produzidos para o contratante.',
    });
  }
  clausulas.push(
    {
      titulo: 'DA DIVULGAÇÃO',
      referencia: 'art. 94',
      texto: 'O contrato e seus aditamentos serão divulgados no PNCP em até 20 dias úteis da assinatura, condição indispensável para a sua eficácia (art. 94, I).',
    },
    {
      titulo: 'DO FORO',
      referencia: 'art. 92, § 1º',
      texto: `Fica eleito o foro da Justiça Federal, Seção Judiciária do estado de ${linha.uasg_uf}, sede da Administração, para dirimir as questões decorrentes deste contrato (art. 92, § 1º).`,
    },
  );
  const corpo = [
    `**CONTRATO ADMINISTRATIVO Nº ${pendente('número/ano')}**, que entre si celebram a União, por intermédio da unidade ${linha.uasg_nome} (UASG ${linha.uasg}), e ${pendente('razão social e CNPJ do contratado')}, decorrente do processo SEI nº ${linha.numero_sei}.`,
    '',
    ...clausulas.flatMap((c, i) => {
      const cabecalho = `## CLÁUSULA ${ORDINAIS[i] ?? String(i + 1)} — ${c.titulo} (${c.referencia})`;
      const secao = `${cabecalho}\n\n${c.texto}`;
      return [c.protegida ? protegido(c.protegida, secao) : secao, ''];
    }),
    'E, por estarem de acordo, as partes assinam este contrato eletronicamente, para que produza os seus efeitos após a divulgação no PNCP.',
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.minuta_contrato,
    corpo,
    premissas: [
      'Cláusulas necessárias do art. 92, incisos I a XIX, na ordem da lei, acrescidas de divulgação (art. 94) e foro (art. 92, § 1º).',
      software ? 'Objeto envolve software: incluída a cláusula de cessão de direitos patrimoniais (art. 93).' : 'Objeto sem desenvolvimento de software: cláusula do art. 93 não aplicável.',
      `Condições de referência: vigência de ${vigenciaMeses} meses, garantia de execução de ${garantiaExecucaoPercentual}% e reajuste pelo IPCA, a confirmar pela equipe.`,
      'As cláusulas de penalidades e de manutenção da habilitação seguem o texto-padrão e não são redigidas por IA.',
    ],
    fontes: [
      'Lei 14.133/2021, art. 89',
      'Lei 14.133/2021, art. 92, incisos I a XIX e §§ 1º, 3º e 6º',
      'Lei 14.133/2021, art. 93',
      'Lei 14.133/2021, arts. 94, 96 a 98, 103, 116 a 118, 120, 121, 123, 135, 137 a 141 e 155 a 158',
    ],
  };
}

// ───────────────────────── Checklist do parecer (art. 53) ─────────────────────────

function evidenciaDocumento(carga: CargaProcesso, tipo: TipoDocumento): string {
  const doc = documentoAtual(carga, tipo);
  if (!doc) return 'Documento não gerado.';
  const entrada = doc.numeroSei ? carga.arvore.find((a) => a.numero === doc.numeroSei) : undefined;
  const assinatura = entrada?.assinadoEm ? `, assinado por ${entrada.assinadoPor ?? '—'} em ${formatarData(entrada.assinadoEm.slice(0, 10))}` : '';
  return doc.situacao === 'aprovado'
    ? `Versão ${doc.versao} aprovada${doc.revisadoPor ? ` por ${doc.revisadoPor.nome}` : ''}; SEI nº ${doc.numeroSei ?? '—'}${assinatura}.`
    : `Versão ${doc.versao} em rascunho, sem aprovação.`;
}

function modeloParecerChecklist(d: DadosDocumento): ModeloDocumento {
  const { carga } = d;
  const { linha } = carga;
  const etp = validarEtp(linha.etp as ConteudoEtp);
  const segregacao = avaliarSegregacao(carga.equipe, []);
  const prazo = prazoPropostas(d);
  const papeis = new Set(carga.equipe.map((m) => m.papel));
  const evidencias: Record<string, string> = {
    dfd: evidenciaDocumento(carga, 'dfd'),
    etp: `${evidenciaDocumento(carga, 'etp')} Completude (validarEtp): ${etp.percentualPreenchido.toLocaleString('pt-BR')}%${etp.completo ? '' : `, ${etp.pendencias.length} pendência(s)`}.`,
    matriz_riscos: `${evidenciaDocumento(carga, 'matriz_riscos')} ${linha.riscos.length} risco(s) registrado(s).`,
    pesquisa_precos: `${evidenciaDocumento(carga, 'nota_tecnica_precos')} ${d.analise ? `${d.analise.estatisticasSaneadas.n} preço(s) válido(s) após saneamento; ${d.analise.alertas.length} alerta(s).` : 'Sem cotações válidas.'}`,
    tr: evidenciaDocumento(carga, 'tr'),
    minuta_edital: evidenciaDocumento(carga, 'edital'),
    minuta_contrato: evidenciaDocumento(carga, 'minuta_contrato'),
    designacoes: carga.equipe.length === 0 ? 'Nenhuma designação registrada.' : carga.equipe.map((m) => `${ROTULOS_PAPEL[m.papel]}: ${m.nome}`).join('; ') + '.',
    segregacao: segregacao.conflitos.length === 0 ? 'Sem acúmulo de funções conflitantes (verificarSegregacao).' : `${segregacao.conflitos.length} conflito(s) de segregação apontado(s).`,
    previsao_orcamentaria: 'Indicação da dotação a cargo da área orçamentária (TR, alínea "j"); verificar nos autos.',
    pca: linha.dfd.previstoNoPca ? 'Demanda prevista no PCA, conforme o DFD.' : 'Demanda não prevista no PCA, conforme o DFD.',
    publicidade_prazos: `Prazo mínimo de propostas: ${prazo.diasUteis} dias úteis (${prazo.fundamento}). Acesso ao edital sem cadastro previsto na minuta (art. 25, § 3º).${papeis.has('agente_contratacao') || papeis.has('pregoeiro') ? '' : ' Agente de contratação ainda não designado.'}`,
  };
  const situacao = (valor: boolean | null) => (valor === null ? 'Não avaliado' : valor ? 'Sim' : 'Não');
  const rotuloConclusao = {
    favoravel: 'Favorável',
    favoravel_com_ressalvas: 'Favorável com ressalvas',
    desfavoravel: 'Desfavorável',
  } as const;
  const conclusao = linha.parecer.conclusao;
  const corpo = [
    'Lista de verificação de apoio ao controle prévio de legalidade da contratação (art. 53 da Lei 14.133/2021). As evidências foram levantadas automaticamente a partir dos registros do processo na Ágora; a análise jurídica, a conclusão e as recomendações são de competência exclusiva da assessoria jurídica.',
    '',
    '## 1. Elementos da fase preparatória',
    '',
    tabela(
      ['Nº', 'Item de verificação', 'Evidência no processo', 'Atendido', 'Observação da assessoria jurídica'],
      ITENS_PARECER.map((item, i) => {
        const registrado = linha.parecer.itens.find((x) => x.id === item.id);
        return [String(i + 1), item.texto, evidencias[item.id] ?? '—', situacao(registrado?.atendido ?? null), registrado?.observacao ?? '—'];
      }),
    ),
    '',
    protegido(
      'conclusao',
      [
        '## 2. Conclusão',
        '',
        conclusao === null
          ? 'A conclusão do parecer será registrada pela assessoria jurídica, em linguagem simples e compreensível, com apreciação dos elementos indispensáveis à contratação (art. 53, § 1º).'
          : `Conclusão registrada pela assessoria jurídica: **${rotuloConclusao[conclusao]}**${linha.parecerista_nome ? `, por ${linha.parecerista_nome}` : ''}${linha.parecer.emitidoEm ? ` em ${formatarData(linha.parecer.emitidoEm.slice(0, 10))}` : ''}.`,
      ].join('\n'),
    ),
  ].join('\n');
  return {
    titulo: TITULOS_DOCUMENTO.parecer_checklist,
    corpo,
    premissas: [
      'Evidências obtidas dos documentos, da equipe, da matriz de riscos e da cesta de preços registrados na Ágora.',
      'Completude do ETP por validarEtp e segregação por verificarSegregacao (@agora/dominio).',
      'A coluna "Atendido" e a conclusão refletem exclusivamente o registro da assessoria jurídica; este documento nunca é redigido por IA.',
    ],
    fontes: ['Lei 14.133/2021, art. 53, caput e § 1º', 'Lei 14.133/2021, arts. 7º, 8º, 12, 18, 22, 23, 25, 54, 55 e 92'],
  };
}

const MODELOS: Record<TipoDocumento, (d: DadosDocumento) => ModeloDocumento> = {
  dfd: modeloDfd,
  etp: modeloEtp,
  matriz_riscos: modeloMatrizRiscos,
  nota_tecnica_precos: modeloNotaTecnica,
  tr: modeloTr,
  edital: modeloEdital,
  minuta_contrato: modeloMinuta,
  parecer_checklist: modeloParecerChecklist,
};

/** Modelo de texto determinístico do documento. */
export function gerarModelo(tipo: TipoDocumento, dados: DadosDocumento): ModeloDocumento {
  return MODELOS[tipo](dados);
}

/** Documento completo: cabeçalho, marca de rascunho, corpo, premissas e fontes. */
export function montarConteudo(modelo: ModeloDocumento, corpo: string, dados: DadosDocumento, autoria: Autoria): string {
  const { linha } = dados.carga;
  const marca = autoria.geradoPor === 'ia' ? 'Rascunho gerado por IA — requer revisão humana' : 'Rascunho — requer revisão humana';
  const rodape =
    autoria.geradoPor === 'ia'
      ? `Rascunho redigido com apoio de IA auto-hospedada (modelo ${autoria.modeloIa ?? 'não informado'}) sobre o modelo de texto da Ágora. Confira integralmente antes de aprovar e assinar.`
      : 'Documento redigido pelo modelo de texto determinístico da Ágora. Confira integralmente antes de aprovar e assinar.';
  return [
    `# ${modelo.titulo}`,
    '',
    `**Processo SEI nº ${linha.numero_sei}** · ${ORGAOS_POR_EXTENSO[linha.orgao]} · UASG ${linha.uasg} — ${linha.uasg_nome}`,
    '',
    `**Objeto:** ${linha.titulo}`,
    '',
    `> **${marca}** — gerado em ${formatarData(dados.dataGeracao)} a partir dos dados registrados na Ágora. ${MARCADOR_SITUACAO}`,
    '',
    corpo.trim(),
    '',
    '---',
    '',
    '### Premissas (dados utilizados)',
    '',
    ...modelo.premissas.map((p) => `- ${p}`),
    '',
    '### Fontes',
    '',
    ...modelo.fontes.map((f) => `- ${f}`),
    '',
    `*${rodape}*`,
  ].join('\n');
}

/** Substitui a marca de rascunho pela anotação de aprovação (revisão humana registrada). */
export function marcarAprovado(conteudo: string, revisor: string, data: string): string {
  const linhas = conteudo.split('\n');
  const indice = linhas.findIndex((l) => l.includes(MARCADOR_SITUACAO));
  const anotacao = `> **Aprovado após revisão humana** — por ${revisor} em ${formatarData(data)}. ${MARCADOR_SITUACAO}`;
  if (indice < 0) return `${anotacao}\n\n${conteudo}`;
  linhas[indice] = anotacao;
  return linhas.join('\n');
}

/** Prompt enviado ao provedor de IA: o modelo de texto é a base; os dados do processo vão sem dados pessoais. */
export function montarPromptIa(tipo: TipoDocumento, modelo: ModeloDocumento, dados: DadosDocumento): string {
  const { linha } = dados.carga;
  const resumo = {
    processoSei: linha.numero_sei,
    objeto: linha.titulo,
    orgaoRequisitante: ORGAOS_POR_EXTENSO[linha.orgao],
    uasg: `${linha.uasg} — ${linha.uasg_nome}`,
    naturezaObjeto: ROTULOS_TIPO_OBJETO[linha.dfd.tipoObjeto],
    modalidadePrevista: linha.modalidade_prevista,
    criterioJulgamento: linha.edital.criterioJulgamento,
    valorEstimado: linha.cesta.orcamentoSigiloso ? 'sigiloso (art. 24)' : dados.valorEstimado === null ? null : formatarMoeda(dados.valorEstimado),
    itens: linha.dfd.itens.map((i) => ({ descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade })),
  };
  return [
    `Documento: ${modelo.titulo} (tipo "${tipo}").`,
    'Tarefa: aprimore a redação do rascunho abaixo, sem alterar fatos, valores, datas, quantidades nem referências legais, e preservando literalmente os trechos protegidos.',
    `Fontes normativas que podem ser citadas: ${modelo.fontes.join('; ')}.`,
    '',
    'Dados do processo (JSON):',
    JSON.stringify(resumo, null, 2),
    '',
    'Rascunho (modelo determinístico da Ágora):',
    '<<<',
    modelo.corpo,
    '>>>',
  ].join('\n');
}

