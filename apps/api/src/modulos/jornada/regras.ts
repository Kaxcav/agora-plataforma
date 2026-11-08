import {
  analisarCestaPrecos,
  avaliarFracionamento,
  formatarData,
  limiteDispensaVigente,
  sinalizarArtigoLuxo,
  validarEtp,
  verificarSegregacao,
  type ConteudoEtp,
  type Designacao,
  type TipoObjetoDispensa,
} from '@agora/dominio';
import type { Bloqueio, EtapaJornada, Sinal } from '@agora/contratos';
import { LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL, MINIMO_CARACTERES_TEXTO, TITULOS_DOCUMENTO } from './constantes.ts';
import type {
  AnaliseCesta,
  CestaArmazenada,
  DfdProcesso,
  DisputaArmazenada,
  DocumentoCarregado,
  EtpProcesso,
  MembroEquipe,
  ParametrosEdital,
  ParecerArmazenado,
  PublicacaoProcesso,
  RiscoProcesso,
  TipoDocumento,
} from './tipos.ts';

/**
 * Regras de avanço da jornada (docs/JORNADA.md §2). Funções puras: recebem os dados já carregados e devolvem
 * bloqueios (impedem o avanço) e sinais (alertas que não bloqueiam). Todo juízo legal vem de @agora/dominio;
 * aqui só se combina o resultado das funções do domínio com os dados do processo.
 */
export interface ResultadoRegras {
  bloqueios: Bloqueio[];
  sinais: Sinal[];
}

function criarResultado(etapa: EtapaJornada) {
  const resultado: ResultadoRegras = { bloqueios: [], sinais: [] };
  return {
    resultado,
    bloquear(regra: string, mensagem: string, fundamento: string): void {
      resultado.bloqueios.push({ regra, mensagem, fundamento, etapa });
    },
    sinalizar(regra: string, nivel: Sinal['nivel'], mensagem: string, fundamento: string): void {
      resultado.sinais.push({ regra, nivel, mensagem, fundamento });
    },
  };
}

function textoSuficiente(texto: string | null | undefined): boolean {
  return (texto ?? '').trim().length >= MINIMO_CARACTERES_TEXTO;
}

/** Análise da cesta por @agora/dominio sobre as cotações não expurgadas; null sem cotação válida. */
export function analisarCesta(cesta: CestaArmazenada, hoje: string): AnaliseCesta | null {
  const validas = cesta.cotacoes.filter((c) => !c.expurgada);
  if (validas.length === 0) return null;
  return analisarCestaPrecos(
    validas.map((c) => ({
      id: c.id,
      fonte: c.fonte,
      descricaoFonte: c.descricaoFonte,
      valorUnitario: c.valorUnitario,
      dataCotacao: c.dataCotacao,
      ...(c.justificativaEscolhaFornecedor !== undefined ? { justificativaEscolhaFornecedor: c.justificativaEscolhaFornecedor } : {}),
    })),
    { dataReferencia: hoje },
  );
}

/**
 * Valor estimado do processo: a cesta de preços refere-se ao item 1 (item de referência); os demais itens usam
 * a estimativa preliminar do DFD. Sem itens, não há valor.
 */
export function valorEstimadoProcesso(dfd: DfdProcesso, analise: AnaliseCesta | null): number | null {
  if (dfd.itens.length === 0) return null;
  return dfd.itens.reduce(
    (soma, item, indice) => soma + item.quantidade * (indice === 0 && analise ? analise.valorEstimado : item.valorUnitarioEstimado),
    0,
  );
}

export function tipoDispensa(tipoObjeto: DfdProcesso['tipoObjeto']): TipoObjetoDispensa {
  return tipoObjeto.startsWith('obras_servicos_engenharia') ? 'obras_servicos_engenharia' : 'demais';
}

/** Termos indicativos de artigo de luxo por item (RN-01, `sinalizarArtigoLuxo`). */
export function indiciosArtigoLuxo(dfd: DfdProcesso): { item: number; termos: string[]; orientacao: string; fundamento: string }[] {
  return dfd.itens.flatMap((item, indice) => {
    const sinal = sinalizarArtigoLuxo(item.descricao);
    return sinal.sinal === 'possivel_artigo_luxo'
      ? [{ item: indice + 1, termos: sinal.termosEncontrados, orientacao: sinal.orientacao, fundamento: sinal.fundamento }]
      : [];
  });
}

// ───────────────────────── Etapa 1 — Demanda e PCA ─────────────────────────

export interface EntradaEtapa1 {
  dfd: DfdProcesso;
  valorEstimado: number | null;
  /** Valores das demais contratações da mesma UASG, natureza e exercício dentro do limite de dispensa. */
  outrasContratacoes: number[];
  hoje: string;
}

export function regrasEtapa1(e: EntradaEtapa1): ResultadoRegras {
  const r = criarResultado(1);
  const { dfd } = e;
  if (!textoSuficiente(dfd.descricaoNecessidade)) {
    r.bloquear('RF-15', `Descreva a necessidade da contratação com pelo menos ${MINIMO_CARACTERES_TEXTO} caracteres.`, 'Lei 14.133/2021, art. 18, I; Decreto 10.947/2022, art. 8º, I');
  }
  if (!textoSuficiente(dfd.justificativa)) {
    r.bloquear('RF-15', `Apresente a justificativa da contratação com pelo menos ${MINIMO_CARACTERES_TEXTO} caracteres.`, 'Lei 14.133/2021, art. 18, I; Decreto 10.947/2022, art. 8º, I');
  }
  const itensValidos = dfd.itens.filter((i) => i.quantidade > 0 && i.valorUnitarioEstimado > 0);
  if (itensValidos.length === 0) {
    r.bloquear('RF-15', 'Informe ao menos um item com quantidade e valor unitário estimado maiores que zero.', 'Decreto 10.947/2022, art. 8º, III e IV');
  }
  if (!dfd.usaCatalogoPadronizado && !textoSuficiente(dfd.justificativaNaoPadronizacao)) {
    r.bloquear(
      'RN-02',
      `A contratação não utiliza o catálogo eletrônico de padronização: registre a justificativa por escrito (mínimo de ${MINIMO_CARACTERES_TEXTO} caracteres).`,
      'Lei 14.133/2021, art. 19, II e § 2º',
    );
  }
  const luxo = indiciosArtigoLuxo(dfd);
  for (const indicio of luxo) {
    const termos = indicio.termos.map((t) => `"${t}"`).join(', ');
    if (textoSuficiente(dfd.justificativaArtigoLuxo)) {
      r.sinalizar('RN-01', 'atencao', `Indício de artigo de luxo no item ${indicio.item} (${termos}), com justificativa registrada: confirme que o bem é de qualidade comum.`, indicio.fundamento);
    } else {
      r.bloquear('RN-01', `Indício de artigo de luxo no item ${indicio.item} (${termos}). ${indicio.orientacao}`, indicio.fundamento);
    }
  }
  if (!dfd.previstoNoPca) {
    r.sinalizar(
      'RF-15',
      'atencao',
      'A demanda não consta do plano de contratações anual: avalie a inclusão no PCA ou registre a justificativa da contratação não planejada.',
      'Lei 14.133/2021, art. 12, VII e § 1º; Decreto 10.947/2022',
    );
  }
  if (e.valorEstimado !== null && e.valorEstimado > 0) {
    const tipo = tipoDispensa(dfd.tipoObjeto);
    const limite = limiteDispensaVigente(e.hoje, tipo);
    if (e.valorEstimado <= limite.valor) {
      const avaliacao = avaliarFracionamento({
        data: e.hoje,
        tipo,
        contratacoesMesmaNaturezaNoExercicio: e.outrasContratacoes,
        novaContratacao: e.valorEstimado,
      });
      if (avaliacao.sinal !== 'sem_risco') {
        r.sinalizar('RN-14', avaliacao.sinal === 'risco' ? 'risco' : 'atencao', avaliacao.explicacao, avaliacao.fundamento);
      }
    }
  }
  return r.resultado;
}

// ───────────────────────── Etapa 2 — Instrução no SEI e equipe ─────────────────────────

export interface SocioFornecedor {
  cnpj: string;
  razaoSocial: string;
  cpfsSocios: string[];
}

export interface AvaliacaoSegregacao {
  conflitos: { mensagem: string; fundamento: string }[];
  vinculos: { mensagem: string; fundamento: string }[];
}

/** RN-03 por `verificarSegregacao`: acúmulo de funções bloqueia; vínculo societário é sinal para análise. */
export function avaliarSegregacao(equipe: readonly MembroEquipe[], socios: readonly SocioFornecedor[]): AvaliacaoSegregacao {
  const designacoes: Designacao[] = equipe.map((m) => ({ papel: m.papel, servidorId: m.usuarioId, nome: m.nome, cpf: m.cpf }));
  const verificacao = verificarSegregacao(designacoes, { sociosFornecedores: [...socios] });
  return {
    conflitos: verificacao.conflitos
      .filter((c) => c.tipo === 'acumulo_funcoes')
      .map((c) => ({ mensagem: c.descricao, fundamento: c.fundamento })),
    vinculos: verificacao.conflitos
      .filter((c) => c.tipo === 'vinculo_societario')
      .map((c) => ({ mensagem: c.descricao, fundamento: c.fundamento })),
  };
}

export type SituacaoDfdSei = 'sem_documento' | 'nao_aprovado' | 'nao_assinado' | 'assinado';

export interface EntradaEtapa2 {
  equipe: MembroEquipe[];
  socios: SocioFornecedor[];
  dfdSei: SituacaoDfdSei;
}

export function regrasEtapa2(e: EntradaEtapa2): ResultadoRegras {
  const r = criarResultado(2);
  const papeis = new Set(e.equipe.map((m) => m.papel));
  const fundamentoEquipe = 'Lei 14.133/2021, arts. 7º e 8º';
  if (!papeis.has('equipe_planejamento')) r.bloquear('RF-15', 'Designe a equipe de planejamento da contratação.', fundamentoEquipe);
  if (!papeis.has('agente_contratacao') && !papeis.has('pregoeiro')) {
    r.bloquear('RF-15', 'Designe o agente de contratação (ou o pregoeiro) responsável pelo certame.', 'Lei 14.133/2021, art. 8º');
  }
  if (!papeis.has('autoridade_competente')) r.bloquear('RF-15', 'Indique a autoridade competente do processo.', fundamentoEquipe);
  const segregacao = avaliarSegregacao(e.equipe, e.socios);
  for (const c of segregacao.conflitos) r.bloquear('RN-03', c.mensagem, c.fundamento);
  for (const v of segregacao.vinculos) r.sinalizar('RIA-06', 'risco', v.mensagem, v.fundamento);
  const fundamentoSei = 'Lei 14.133/2021, art. 12, VII; instrução processual no SEI (simulação)';
  if (e.dfdSei === 'sem_documento') r.bloquear('RIA-02', 'Gere o DFD e aprove-o para incluí-lo na árvore do processo SEI.', fundamentoSei);
  if (e.dfdSei === 'nao_aprovado') r.bloquear('RIA-02', 'Aprove a versão atual do DFD (revisão humana) para incluí-la na árvore do processo SEI.', fundamentoSei);
  if (e.dfdSei === 'nao_assinado') r.bloquear('RIA-02', 'Assine o DFD na árvore do processo SEI.', fundamentoSei);
  return r.resultado;
}

// ───────────────────────── Etapa 3 — ETP, riscos e preços ─────────────────────────

/** Alertas da análise da cesta que impedem o avanço (RN-05). */
const ALERTAS_BLOQUEANTES = new Set(['MENOS_DE_3_PRECOS', 'FORNECEDOR_DIRETO_INSUFICIENTE', 'SEM_JUSTIFICATIVA_FORNECEDOR']);

export interface EntradaEtapa3 {
  etp: EtpProcesso;
  riscos: RiscoProcesso[];
  cesta: CestaArmazenada;
  analise: AnaliseCesta | null;
}

export function regrasEtapa3(e: EntradaEtapa3): ResultadoRegras {
  const r = criarResultado(3);
  const etp = validarEtp(e.etp as ConteudoEtp);
  for (const p of etp.pendencias) r.bloquear('RN-04', p.mensagem, etp.fundamento);
  if (e.riscos.length === 0) {
    r.bloquear('RF-15', 'Registre ao menos um risco na matriz de riscos, com probabilidade, impacto, alocação e mitigação.', 'Lei 14.133/2021, art. 18, X, e art. 22');
  }
  if (!e.analise) {
    r.bloquear('RN-05', 'Registre a pesquisa de preços: a cesta não tem cotações válidas.', 'Lei 14.133/2021, art. 23, § 1º');
  } else {
    for (const alerta of e.analise.alertas) {
      if (ALERTAS_BLOQUEANTES.has(alerta.codigo)) r.bloquear('RN-05', alerta.mensagem, alerta.fundamento);
      else if (alerta.codigo === 'EXPURGO_NAO_SUGERIDO') r.sinalizar('RIA-03', 'atencao', alerta.mensagem, alerta.fundamento);
      else r.sinalizar('RN-05', 'atencao', alerta.mensagem, alerta.fundamento);
    }
    if (e.analise.metodologiaRecomendada === 'mediana') {
      r.sinalizar(
        'RIA-03',
        'atencao',
        `Coeficiente de variação elevado (${e.analise.estatisticasSaneadas.coeficienteVariacao.toLocaleString('pt-BR')}% após o saneamento): a metodologia recomendada é a mediana. Avalie ampliar a pesquisa.`,
        'IN SEGES/ME 65/2021, art. 6º',
      );
    }
    if (e.analise.sugeridasExpurgo.length > 0) {
      const quantidade = e.analise.sugeridasExpurgo.length;
      r.sinalizar(
        'RIA-03',
        'informativo',
        `${quantidade} ${quantidade === 1 ? 'cotação sugerida' : 'cotações sugeridas'} para expurgo pelo saneamento estatístico: confirme com justificativa ou mantenha na cesta. ${e.analise.aviso}`,
        'IN SEGES/ME 65/2021, art. 6º',
      );
    }
  }
  if (e.cesta.orcamentoSigiloso && !textoSuficiente(e.cesta.motivoSigilo)) {
    r.bloquear('RF-15', `O orçamento é sigiloso: registre o motivo do sigilo (mínimo de ${MINIMO_CARACTERES_TEXTO} caracteres).`, 'Lei 14.133/2021, art. 24');
  }
  return r.resultado;
}

// ───────────────────────── Etapa 4 — TR, edital e minuta ─────────────────────────

const DOCUMENTOS_ETAPA_4: readonly TipoDocumento[] = ['tr', 'edital', 'minuta_contrato'];

export interface EntradaEtapa4 {
  documentos: DocumentoCarregado[];
  edital: ParametrosEdital;
}

export function regrasEtapa4(e: EntradaEtapa4): ResultadoRegras {
  const r = criarResultado(4);
  const fundamentoDocs = 'Lei 14.133/2021, art. 6º, XXIII, art. 25 e art. 92; revisão humana obrigatória (RIA-04)';
  const fundamentoParametros = 'Lei 14.133/2021, art. 69 (RN-06); o texto deve refletir os parâmetros do edital vigentes';
  const desatualizados: string[] = [];
  for (const tipo of DOCUMENTOS_ETAPA_4) {
    const doc = e.documentos.find((d) => d.tipo === tipo);
    const titulo = TITULOS_DOCUMENTO[tipo];
    if (!doc) r.bloquear('RIA-04', `Gere o documento "${titulo}".`, fundamentoDocs);
    else if (doc.geradoComParametrosAnteriores) {
      // Aprovado ou não, o texto foi redigido com parâmetros que já não valem: não conta como aprovado.
      desatualizados.push(`"${titulo}" (versão ${doc.versao})`);
      r.bloquear('RN-06', `O documento "${titulo}" (versão ${doc.versao}) foi gerado com parâmetros anteriores — gere novamente e aprove.`, fundamentoParametros);
    } else if (doc.situacao !== 'aprovado') {
      r.bloquear('RIA-04', `Aprove a versão ${doc.versao} do documento "${titulo}" após a revisão humana.`, fundamentoDocs);
    }
  }
  if (desatualizados.length > 0) {
    r.sinalizar(
      'RN-06',
      'atencao',
      `Os parâmetros do edital foram alterados depois da geração de ${desatualizados.join(', ')}. Gere ${desatualizados.length === 1 ? 'o documento' : 'os documentos'} novamente e aprove antes de avançar à etapa 5.`,
      fundamentoParametros,
    );
  }
  if (e.edital.exigeFaturamentoMinimo) {
    r.bloquear('RN-06', 'O edital exige faturamento mínimo anterior, o que é vedado na habilitação econômico-financeira.', 'Lei 14.133/2021, art. 69, § 2º');
  }
  const pl = e.edital.patrimonioLiquidoMinimoPercentual;
  if (pl !== null && pl > LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL) {
    r.bloquear(
      'RN-06',
      `O patrimônio líquido mínimo exigido (${pl.toLocaleString('pt-BR')}% do valor estimado) supera o limite de ${LIMITE_PATRIMONIO_LIQUIDO_PERCENTUAL}%.`,
      'Lei 14.133/2021, art. 69, § 4º',
    );
  }
  if (e.edital.exigeRegistroCadastralComplementar) {
    r.bloquear(
      'RN-06',
      'O edital exige registro cadastral complementar para acesso ao edital e aos anexos, o que é vedado.',
      'Lei 14.133/2021, art. 87, § 2º',
    );
  }
  return r.resultado;
}

// ───────────────────────── Etapa 5 — Controle jurídico e publicação ─────────────────────────

export interface EntradaEtapa5 {
  parecer: ParecerArmazenado;
  publicacao: PublicacaoProcesso;
  hoje: string;
}

export function regrasEtapa5(e: EntradaEtapa5): ResultadoRegras {
  const r = criarResultado(5);
  const { conclusao } = e.parecer;
  if (conclusao === null) {
    r.bloquear('RF-15', 'Aguardando o parecer jurídico de controle prévio de legalidade.', 'Lei 14.133/2021, art. 53');
  } else if (conclusao === 'desfavoravel') {
    r.bloquear('RF-15', 'O parecer jurídico é desfavorável: saneie os apontamentos e submeta o processo a nova análise.', 'Lei 14.133/2021, art. 53');
  } else if (conclusao === 'favoravel_com_ressalvas') {
    r.sinalizar('RF-15', 'atencao', 'Parecer favorável com ressalvas: confirme o atendimento das ressalvas registradas pela assessoria jurídica.', 'Lei 14.133/2021, art. 53, § 1º');
  }
  if (e.publicacao.pncp !== 'publicado') {
    r.bloquear('RN-07', 'Publique o edital e os anexos no PNCP (com acesso sem cadastro) e o extrato no Diário Oficial da União.', 'Lei 14.133/2021, art. 25, § 3º, e art. 54');
  } else if (e.publicacao.dataMinimaPropostas === null) {
    r.bloquear('RN-15', 'A publicação não registrou a data mínima de abertura das propostas.', 'Lei 14.133/2021, art. 55');
  } else if (e.hoje < e.publicacao.dataMinimaPropostas) {
    r.bloquear(
      'RN-15',
      `As propostas só podem ser abertas a partir de ${formatarData(e.publicacao.dataMinimaPropostas)} (prazo mínimo contado da divulgação do edital).`,
      'Lei 14.133/2021, art. 55',
    );
  }
  return r.resultado;
}

// ───────────────────────── Etapa 6 — Seleção do fornecedor ─────────────────────────

export interface EntradaEtapa6 {
  disputa: DisputaArmazenada;
  /** Sanções impeditivas vigentes do primeiro classificado. */
  sancoesVencedor: string[];
  /** Sinais de sócio em comum entre licitantes (RIA-06). */
  vinculosLicitantes: string[];
}

export function regrasEtapa6(e: EntradaEtapa6): ResultadoRegras {
  const r = criarResultado(6);
  const { resultado, licitantes } = e.disputa;
  if (licitantes.length === 0 || resultado === null) {
    r.bloquear('RN-08', 'Registre as propostas da disputa para classificar os licitantes.', 'Lei 14.133/2021, arts. 33, 59 e 60');
  } else {
    if (resultado.sorteioNecessario) {
      r.bloquear(
        'RN-08',
        'O empate persiste após todos os critérios do art. 60: realize o sorteio em ato público e registre o resultado.',
        'Lei 14.133/2021, art. 60',
      );
    }
    for (const motivo of e.sancoesVencedor) {
      r.bloquear('RN-09', `O primeiro classificado tem sanção impeditiva vigente: ${motivo}.`, 'Lei 14.133/2021, art. 14, III, e art. 156, §§ 4º e 5º');
    }
  }
  for (const vinculo of e.vinculosLicitantes) {
    r.sinalizar('RIA-06', 'risco', vinculo, 'Lei 14.133/2021, art. 14, IV; sinal para análise, não constitui acusação');
  }
  return r.resultado;
}

// ───────────────────────── Etapa 7 — Contrato e gestão ─────────────────────────

export interface EntradaEtapa7 {
  temVencedor: boolean;
  contratoGerado: { numero: string; limiteDivulgacao: string; divulgadoEm: string | null } | null;
  regularidadeVencedor: { regular: boolean; motivos: string[] } | null;
}

export function regrasEtapa7(e: EntradaEtapa7): ResultadoRegras {
  const r = criarResultado(7);
  if (e.contratoGerado) {
    if (e.contratoGerado.divulgadoEm === null) {
      r.sinalizar(
        'RN-11',
        'informativo',
        `Contrato ${e.contratoGerado.numero} gerado: divulgue-o no PNCP até ${formatarData(e.contratoGerado.limiteDivulgacao)} — condição de eficácia.`,
        'Lei 14.133/2021, art. 94',
      );
    }
    return r.resultado;
  }
  if (!e.temVencedor) {
    r.bloquear('RN-08', 'Não há licitante vencedor registrado na disputa.', 'Lei 14.133/2021, art. 60');
  }
  for (const motivo of e.regularidadeVencedor?.motivos ?? []) {
    r.bloquear('RN-09', `Regularidade do vencedor: ${motivo}.`, 'Lei 14.133/2021, art. 91, § 4º');
  }
  return r.resultado;
}

/** Sinais dos documentos atuais cuja redação por IA falhou e voltou ao modelo de texto. */
export function sinaisDocumentos(documentos: readonly DocumentoCarregado[]): Sinal[] {
  return documentos
    .filter((d) => d.falhaIa !== null)
    .map((d) => ({
      regra: 'RIA-04',
      nivel: 'atencao' as const,
      mensagem: `A redação assistida por IA do documento "${d.titulo}" (versão ${d.versao}) falhou (${d.falhaIa ?? ''}); o texto foi gerado pelo modelo determinístico.`,
      fundamento: 'IA gera rascunhos e sinais, nunca decisões; revisão humana obrigatória',
    }));
}
