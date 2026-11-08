/**
 * Sigilo de segurança pública na contratação (F25; RN-40, RF-33, RNF-09).
 *
 * Lei 14.133/2021:
 *  - art. 13: os atos do processo são públicos, ressalvadas as informações cujo sigilo seja imprescindível à
 *    segurança da sociedade e do Estado; a publicidade do orçamento é diferida nos termos do art. 24 (parágrafo único, II);
 *  - art. 18, § 1º, VI: a estimativa do valor, com preços unitários e memórias de cálculo, pode constar de anexo
 *    classificado até a conclusão da licitação;
 *  - art. 24: o orçamento estimado pode ser sigiloso, desde que justificado, sem prejuízo da divulgação dos
 *    quantitativos; o sigilo não prevalece para os órgãos de controle interno e externo (I); no julgamento por maior
 *    desconto, o preço estimado consta do edital (parágrafo único);
 *  - art. 91, § 1º: contratos e termos aditivos podem ser mantidos em sigilo quando imprescindível à segurança da
 *    sociedade e do Estado, nos termos da legislação de acesso à informação;
 *  - art. 169, § 2º: os órgãos de controle têm acesso irrestrito, inclusive aos documentos classificados pela LAI.
 * Lei 12.527/2011 (LAI): hipóteses (art. 23), graus e prazos máximos contados da produção da informação, termo final
 * por evento e publicidade automática ao fim do prazo (art. 24), acesso restrito a quem tem necessidade de conhecer e
 * credencial (art. 25, § 1º) e competência para classificar (art. 27).
 * Decreto 7.845/2012: acesso por credencial de segurança ou, excepcionalmente, por Termo de Compromisso de Manutenção de
 * Sigilo (art. 18), marcação nos cabeçalhos e rodapés (art. 23) e registro dos acessos autorizados e negados (art. 38, § 4º).
 *
 * Funções puras: "hoje" e "agora" entram como parâmetro.
 */
import { formatarData, validarDataISO, type DataISO } from '../datas.ts';
import { ErroDominio } from '../erros.ts';
import { adicionarMeses } from '../interno.ts';

export type GrauSigilo = 'reservada' | 'secreta' | 'ultrassecreta';
/** `lai`: informação classificada (Lei 12.527/2011); `orcamento`: sigilo do orçamento estimado (Lei 14.133/2021, art. 24). */
export type TipoSigilo = 'lai' | 'orcamento';
/** Incisos do art. 23 da LAI. */
export type HipoteseSigiloLai = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII';
/** Autoridade classificadora (LAI, art. 27, I a III, e § 1º). */
export type NivelAutoridadeClassificadora = 'ministro_estado' | 'titular_entidade' | 'direcao_das_101_5' | 'delegacao';

/** Prazos máximos de restrição de acesso, em anos, contados da produção da informação (LAI, art. 24, § 1º). */
export const PRAZO_MAXIMO_SIGILO_ANOS: Readonly<Record<GrauSigilo, number>> = Object.freeze({ reservada: 5, secreta: 15, ultrassecreta: 25 });

export const GRAUS_SIGILO: readonly GrauSigilo[] = Object.freeze(['reservada', 'secreta', 'ultrassecreta'] as GrauSigilo[]);

/** Hipóteses do art. 23 da LAI, em redação resumida. */
export const HIPOTESES_SIGILO_LAI: Readonly<Record<HipoteseSigiloLai, string>> = Object.freeze({
  I: 'pôr em risco a defesa e a soberania nacionais ou a integridade do território nacional',
  II: 'prejudicar ou pôr em risco negociações ou relações internacionais do País',
  III: 'pôr em risco a vida, a segurança ou a saúde da população',
  IV: 'oferecer elevado risco à estabilidade financeira, econômica ou monetária do País',
  V: 'prejudicar ou causar risco a planos ou operações estratégicos das Forças Armadas',
  VI: 'prejudicar ou causar risco a projetos de pesquisa e desenvolvimento científico ou tecnológico e a sistemas, bens, instalações ou áreas de interesse estratégico nacional',
  VII: 'pôr em risco a segurança de instituições ou de altas autoridades nacionais ou estrangeiras e seus familiares',
  VIII: 'comprometer atividades de inteligência, bem como de investigação ou fiscalização em andamento, relacionadas com a prevenção ou repressão de infrações',
});

/** Termo final do sigilo do orçamento estimado. */
export const EVENTO_FIM_SIGILO_ORCAMENTO =
  'Conclusão da fase de lances ou do julgamento das propostas (Lei 14.133/2021, art. 18, § 1º, VI, e art. 24)';

const INCISO_GRAU: Record<GrauSigilo, string> = { ultrassecreta: 'I', secreta: 'II', reservada: 'III' };
const ORDEM_GRAU: Record<GrauSigilo, number> = { reservada: 1, secreta: 2, ultrassecreta: 3 };
const MARCA_GRAU: Record<GrauSigilo, string> = { reservada: 'RESERVADO', secreta: 'SECRETO', ultrassecreta: 'ULTRASSECRETO' };
const RAZOES_MINIMO = 30;
const RAZOES_MAXIMO = 2000;
const EVENTO_MINIMO = 10;

function erro(mensagem: string, codigo = 'SIGILO_INVALIDO'): ErroDominio {
  return new ErroDominio(codigo, mensagem);
}

function exigirData(d: unknown, campo: string): DataISO {
  if (typeof d !== 'string' || !validarDataISO(d)) throw erro(`${campo} inválida: esperado AAAA-MM-DD.`);
  return d;
}

function exigirGrau(grau: unknown): GrauSigilo {
  if (grau !== 'reservada' && grau !== 'secreta' && grau !== 'ultrassecreta') {
    throw erro('Informe o grau de sigilo: reservada, secreta ou ultrassecreta (Lei 12.527/2011, art. 24).');
  }
  return grau;
}

/** true se `a` é grau igual ou superior a `b` (reservada < secreta < ultrassecreta). */
export function grauAbrange(a: GrauSigilo, b: GrauSigilo): boolean {
  return ORDEM_GRAU[exigirGrau(a)] >= ORDEM_GRAU[exigirGrau(b)];
}

/**
 * Data-limite da restrição: a da produção da informação somada ao prazo máximo do grau (LAI, art. 24, § 1º).
 * Ex.: reservada produzida em 2026-11-08 → 2031-11-08.
 */
export function prazoMaximoSigilo(grau: GrauSigilo, dataProducao: DataISO): DataISO {
  return adicionarMeses(exigirData(dataProducao, 'dataProducao'), PRAZO_MAXIMO_SIGILO_ANOS[exigirGrau(grau)] * 12);
}

/**
 * Competência para classificar (LAI, art. 27): ultrassecreta — Ministro de Estado e autoridades equivalentes (I);
 * secreta — também os titulares de autarquias, fundações, empresas públicas e sociedades de economia mista (II);
 * reservada — também quem exerce direção, comando ou chefia de nível DAS 101.5 ou superior, ou equivalente (III).
 * A competência para ultrassecreta e secreta pode ser delegada, vedada a subdelegação (§ 1º).
 */
export function autoridadeCompetenteSigilo(grau: GrauSigilo, nivel: NivelAutoridadeClassificadora): boolean {
  switch (exigirGrau(grau)) {
    case 'ultrassecreta':
      return nivel === 'ministro_estado' || nivel === 'delegacao';
    case 'secreta':
      return nivel === 'ministro_estado' || nivel === 'titular_entidade' || nivel === 'delegacao';
    case 'reservada':
      return nivel === 'ministro_estado' || nivel === 'titular_entidade' || nivel === 'direcao_das_101_5';
  }
}

export interface AutoridadeClassificadora {
  nome: string;
  cargo: string;
  nivel: NivelAutoridadeClassificadora;
  /** Ato de delegação (obrigatório quando `nivel` = 'delegacao'). */
  atoDelegacao: string | null;
}

export interface EntradaClassificacaoSigilo {
  tipo: TipoSigilo;
  grau: GrauSigilo | null;
  hipotese: HipoteseSigiloLai | null;
  razoes: string;
  /** Data de produção da informação: início da contagem do prazo (LAI, art. 24, § 1º). */
  dataProducao: DataISO;
  /** Termo final por data (LAI, art. 24, § 1º) ... */
  prazoFim: DataISO | null;
  /** ... ou por evento (art. 24, § 3º), que deve ocorrer antes do prazo máximo. */
  eventoFim: string | null;
  autoridade: AutoridadeClassificadora | null;
  /** O processo decidiu, na pesquisa de preços, pelo orçamento sigiloso motivado (exigido para o tipo `orcamento`). */
  orcamentoSigilosoNoProcesso: boolean;
  /** Critério de julgamento do edital ('menor_preco', 'maior_desconto'...). */
  criterioJulgamento: string | null;
}

export interface ClassificacaoSigiloValidada {
  tipo: TipoSigilo;
  grau: GrauSigilo | null;
  hipotese: HipoteseSigiloLai | null;
  razoes: string;
  dataProducao: DataISO;
  prazoFim: DataISO | null;
  eventoFim: string | null;
  /** Data em que a informação se torna pública mesmo sem o evento (prazo máximo do grau); null no orçamento. */
  prazoLimite: DataISO | null;
  autoridade: AutoridadeClassificadora | null;
  fundamento: string;
}

/**
 * Valida a classificação (RN-40).
 *  - LAI: grau, hipótese do art. 23, razões (mín. 30 caracteres), data de produção não futura, termo final por data
 *    (posterior a hoje e dentro do prazo máximo do grau) ou por evento, e autoridade competente (art. 27).
 *  - Orçamento (art. 24): exige a decisão motivada de orçamento sigiloso no processo, não admite o julgamento por maior
 *    desconto (art. 24, parágrafo único) e termina com a fase de lances ou o julgamento.
 * Lança `ErroDominio` 'SIGILO_INVALIDO', 'SIGILO_ORCAMENTO_SEM_DECISAO' ou 'SIGILO_ORCAMENTO_MAIOR_DESCONTO'.
 */
export function validarClassificacaoSigilo(e: EntradaClassificacaoSigilo, hoje: DataISO): ClassificacaoSigiloValidada {
  exigirData(hoje, 'hoje');
  const razoes = typeof e.razoes === 'string' ? e.razoes.trim().replace(/\s+/g, ' ') : '';
  if (razoes.length < RAZOES_MINIMO || razoes.length > RAZOES_MAXIMO) {
    throw erro(`Registre as razões da classificação com ${RAZOES_MINIMO} a ${RAZOES_MAXIMO} caracteres (Lei 12.527/2011, art. 28, II; Lei 14.133/2021, art. 24).`);
  }
  const dataProducao = exigirData(e.dataProducao, 'dataProducao');
  if (dataProducao > hoje) throw erro('A data de produção da informação não pode ser futura.');

  if (e.tipo === 'orcamento') {
    if (e.grau !== null || e.hipotese !== null) throw erro('O sigilo do orçamento (art. 24) não tem grau nem hipótese da LAI: use o tipo "informação classificada" para isso.');
    if (!e.orcamentoSigilosoNoProcesso) {
      throw erro('Marque o orçamento estimado como sigiloso, com o motivo, na pesquisa de preços (etapa 3) antes de classificar o anexo (art. 24).', 'SIGILO_ORCAMENTO_SEM_DECISAO');
    }
    if (e.criterioJulgamento === 'maior_desconto') {
      throw erro('No julgamento por maior desconto, o preço estimado consta do edital: o orçamento não pode ser sigiloso (Lei 14.133/2021, art. 24, parágrafo único).', 'SIGILO_ORCAMENTO_MAIOR_DESCONTO');
    }
    return {
      tipo: 'orcamento',
      grau: null,
      hipotese: null,
      razoes,
      dataProducao,
      prazoFim: null,
      eventoFim: EVENTO_FIM_SIGILO_ORCAMENTO,
      prazoLimite: null,
      autoridade: e.autoridade ? validarAutoridade(e.autoridade, null) : null,
      fundamento: 'Lei 14.133/2021, art. 13, parágrafo único, II, art. 18, § 1º, VI, e art. 24',
    };
  }
  if (e.tipo !== 'lai') throw erro('Tipo de sigilo inválido: use "lai" ou "orcamento".');

  const grau = exigirGrau(e.grau);
  if (e.hipotese === null || !(e.hipotese in HIPOTESES_SIGILO_LAI)) throw erro('Indique a hipótese do art. 23 da Lei 12.527/2011 (incisos I a VIII).');
  const prazoLimite = prazoMaximoSigilo(grau, dataProducao);
  if (prazoLimite <= hoje) {
    throw erro(`O prazo máximo do grau ${grau} contado da produção (${formatarData(dataProducao)}) já terminou em ${formatarData(prazoLimite)}: a informação é pública (LAI, art. 24, § 4º).`);
  }
  const temPrazo = e.prazoFim !== null && e.prazoFim !== undefined;
  const evento = typeof e.eventoFim === 'string' ? e.eventoFim.trim() : '';
  if (temPrazo === (evento !== '')) throw erro('Defina o termo final do sigilo por data ou por evento, um dos dois (LAI, art. 24, §§ 1º e 3º).');
  let prazoFim: DataISO | null = null;
  if (temPrazo) {
    prazoFim = exigirData(e.prazoFim, 'prazoFim');
    if (prazoFim <= hoje) throw erro('A data final do sigilo deve ser posterior a hoje.');
    if (prazoFim > prazoLimite) {
      throw erro(`A data final passa do prazo máximo do grau ${grau} (${PRAZO_MAXIMO_SIGILO_ANOS[grau]} anos da produção: até ${formatarData(prazoLimite)}; LAI, art. 24, § 1º).`);
    }
  } else if (evento.length < EVENTO_MINIMO) {
    throw erro(`Descreva o evento que encerra o sigilo com pelo menos ${EVENTO_MINIMO} caracteres (LAI, art. 24, § 3º).`);
  }
  if (!e.autoridade) throw erro('Identifique a autoridade classificadora (LAI, art. 27; art. 28, IV).');
  const autoridade = validarAutoridade(e.autoridade, grau);
  return {
    tipo: 'lai',
    grau,
    hipotese: e.hipotese,
    razoes,
    dataProducao,
    prazoFim,
    eventoFim: prazoFim === null ? evento : null,
    prazoLimite,
    autoridade,
    fundamento: `Lei 12.527/2011, art. 23, ${e.hipotese}, e art. 24, § 1º, ${INCISO_GRAU[grau]}; Lei 14.133/2021, art. 13`,
  };
}

function validarAutoridade(a: AutoridadeClassificadora, grau: GrauSigilo | null): AutoridadeClassificadora {
  const nome = typeof a.nome === 'string' ? a.nome.trim() : '';
  const cargo = typeof a.cargo === 'string' ? a.cargo.trim() : '';
  if (nome.length < 3 || cargo.length < 3) throw erro('Informe o nome e o cargo da autoridade classificadora.');
  const niveis: NivelAutoridadeClassificadora[] = ['ministro_estado', 'titular_entidade', 'direcao_das_101_5', 'delegacao'];
  if (!niveis.includes(a.nivel)) throw erro('Nível da autoridade classificadora inválido.');
  const ato = typeof a.atoDelegacao === 'string' ? a.atoDelegacao.trim() : '';
  if (a.nivel === 'delegacao' && ato.length < 5) throw erro('Informe o ato de delegação da competência para classificar (LAI, art. 27, § 1º).');
  if (grau !== null && !autoridadeCompetenteSigilo(grau, a.nivel)) {
    throw erro(
      grau === 'reservada' && a.nivel === 'delegacao'
        ? 'A delegação prevista no art. 27, § 1º, da LAI vale só para os graus ultrassecreto e secreto: o grau reservado é classificado pela autoridade de direção, comando ou chefia (art. 27, III).'
        : `A autoridade indicada não tem competência para classificar no grau ${grau} (Lei 12.527/2011, art. 27).`,
    );
  }
  return { nome, cargo, nivel: a.nivel, atoDelegacao: a.nivel === 'delegacao' ? ato : null };
}

export interface EstadoClassificacaoSigilo {
  situacao: 'vigente' | 'desclassificada';
  prazoFim: DataISO | null;
  prazoLimite: DataISO | null;
}

/**
 * A classificação produz efeito hoje? Termina com a desclassificação, com a data final ou, no termo por evento, no
 * prazo máximo do grau: transcorrido o prazo, a informação é de acesso público automaticamente (LAI, art. 24, § 4º).
 */
export function classificacaoVigente(c: EstadoClassificacaoSigilo, hoje: DataISO): boolean {
  exigirData(hoje, 'hoje');
  if (c.situacao !== 'vigente') return false;
  if (c.prazoFim !== null && exigirData(c.prazoFim, 'prazoFim') < hoje) return false;
  if (c.prazoLimite !== null && exigirData(c.prazoLimite, 'prazoLimite') < hoje) return false;
  return true;
}

export interface SituacaoOrcamentoSigiloso {
  situacao: 'publico' | 'sigiloso' | 'divulgado';
  /** O orçamento pode ser divulgado agora (sempre true quando não é sigiloso). */
  divulgavel: boolean;
  divulgadoEm: string | null;
  mensagem: string;
  fundamento: string;
}

/**
 * Publicidade diferida do orçamento sigiloso (art. 13, parágrafo único, II, e art. 24): permanece sigiloso até a
 * conclusão da fase de lances ou do julgamento das propostas (vale o que ocorrer primeiro); depois disso, é público.
 */
export function situacaoOrcamentoSigiloso(e: {
  orcamentoSigiloso: boolean;
  faseLancesEncerradaEm: string | null;
  julgamentoConcluidoEm: string | null;
}): SituacaoOrcamentoSigiloso {
  const fundamento = 'Lei 14.133/2021, art. 13, parágrafo único, II, e art. 24';
  if (!e.orcamentoSigiloso) {
    return { situacao: 'publico', divulgavel: true, divulgadoEm: null, mensagem: 'O orçamento estimado não é sigiloso.', fundamento };
  }
  const marcos = [e.faseLancesEncerradaEm, e.julgamentoConcluidoEm].filter((m): m is string => typeof m === 'string' && m !== '').sort();
  const marco = marcos[0] ?? null;
  if (marco === null) {
    return {
      situacao: 'sigiloso',
      divulgavel: false,
      divulgadoEm: null,
      mensagem: 'Orçamento estimado sigiloso até a conclusão da fase de lances ou do julgamento; os quantitativos são públicos e os órgãos de controle têm acesso (art. 24, I).',
      fundamento,
    };
  }
  return { situacao: 'divulgado', divulgavel: true, divulgadoEm: marco, mensagem: 'A fase de lances ou o julgamento terminou: o orçamento estimado é público.', fundamento };
}

export interface CredencialSigilo {
  grauMaximo: GrauSigilo;
  validaAte: DataISO | null;
  ativa: boolean;
}

export type BaseAcessoSigilo =
  | 'sem_sigilo'
  | 'controle'
  | 'credencial'
  | 'orcamento_divulgado'
  | 'negado_sem_credencial'
  | 'negado_credencial_vencida'
  | 'negado_grau_insuficiente';

export interface DecisaoAcessoSigilo {
  permitido: boolean;
  base: BaseAcessoSigilo;
  /** O acesso deve ser registrado (todo acesso a informação classificada, permitido ou negado). */
  registrar: boolean;
  mensagem: string;
  fundamento: string;
}

/**
 * Decide o acesso a informação sigilosa (RN-40). Sem classificação vigente, o acesso segue as regras comuns. Os órgãos
 * de controle têm acesso irrestrito (art. 24, I, e art. 169, § 2º). Os demais precisam de credencial no processo, ativa,
 * dentro da validade e com grau igual ou superior ao da informação (LAI, art. 25, § 1º; Decreto 7.845/2012, art. 18).
 * O orçamento sigiloso já divulgado (fim da fase de lances ou do julgamento) é público. Todo acesso a informação
 * classificada é registrado, inclusive o negado (Decreto 7.845/2012, art. 38, § 4º).
 */
export function decidirAcessoSigilo(e: {
  classificacao: { tipo: TipoSigilo; grau: GrauSigilo | null; vigente: boolean } | null;
  orcamentoDivulgado: boolean;
  orgaoControle: boolean;
  credencial: CredencialSigilo | null;
  hoje: DataISO;
}): DecisaoAcessoSigilo {
  exigirData(e.hoje, 'hoje');
  const c = e.classificacao;
  if (c === null || !c.vigente) {
    return { permitido: true, base: 'sem_sigilo', registrar: false, mensagem: 'Sem classificação de sigilo vigente.', fundamento: 'Lei 14.133/2021, art. 13' };
  }
  if (e.orgaoControle) {
    return {
      permitido: true,
      base: 'controle',
      registrar: true,
      mensagem: 'Acesso irrestrito do órgão de controle, registrado. O órgão que recebe a informação passa a responder pela manutenção do sigilo.',
      fundamento: 'Lei 14.133/2021, art. 24, I, e art. 169, § 2º',
    };
  }
  if (c.tipo === 'orcamento' && e.orcamentoDivulgado) {
    return { permitido: true, base: 'orcamento_divulgado', registrar: true, mensagem: 'Orçamento já divulgado após a fase de lances ou o julgamento.', fundamento: 'Lei 14.133/2021, art. 24' };
  }
  const fundamentoCredencial = 'Lei 12.527/2011, art. 25, § 1º; Decreto 7.845/2012, art. 18';
  const cred = e.credencial;
  if (cred === null || !cred.ativa) {
    return {
      permitido: false,
      base: 'negado_sem_credencial',
      registrar: true,
      mensagem: 'Acesso negado: informação sigilosa e você não tem credencial de acesso neste processo. Peça o credenciamento ao gestor de segurança e credenciamento.',
      fundamento: fundamentoCredencial,
    };
  }
  if (cred.validaAte !== null && exigirData(cred.validaAte, 'validaAte') < e.hoje) {
    return {
      permitido: false,
      base: 'negado_credencial_vencida',
      registrar: true,
      mensagem: `Acesso negado: a sua credencial neste processo venceu em ${formatarData(cred.validaAte)}.`,
      fundamento: fundamentoCredencial,
    };
  }
  if (c.tipo === 'lai') {
    const grau = exigirGrau(c.grau);
    if (!grauAbrange(cred.grauMaximo, grau)) {
      return {
        permitido: false,
        base: 'negado_grau_insuficiente',
        registrar: true,
        mensagem: `Acesso negado: a sua credencial vai até o grau ${cred.grauMaximo}, e a informação é ${grau}.`,
        fundamento: fundamentoCredencial,
      };
    }
  }
  return { permitido: true, base: 'credencial', registrar: true, mensagem: 'Acesso por credencial no processo, registrado.', fundamento: fundamentoCredencial };
}

export interface MarcacaoSigilo {
  /** Texto do cabeçalho de cada página. */
  cabecalho: string;
  /** Texto do rodapé de cada página (acima da numeração "Página X de N"). */
  rodape: string;
}

/**
 * Marcação do documento classificado nos cabeçalhos e rodapés de todas as páginas (Decreto 7.845/2012, art. 23), com
 * o grau, o fundamento e o termo final; no orçamento, a publicidade diferida do art. 24.
 */
export function marcacaoSigilo(c: { tipo: TipoSigilo; grau: GrauSigilo | null; prazoFim: DataISO | null; eventoFim: string | null; prazoLimite: DataISO | null }): MarcacaoSigilo {
  if (c.tipo === 'orcamento') {
    return {
      cabecalho: 'SIGILOSO — ORÇAMENTO ESTIMADO (Lei 14.133/2021, art. 24)',
      rodape: 'Publicidade diferida (art. 13, parágrafo único, II) até a conclusão da fase de lances ou do julgamento. Sem sigilo para os órgãos de controle (art. 24, I).',
    };
  }
  const grau = exigirGrau(c.grau);
  const termo =
    c.prazoFim !== null
      ? `restrição de acesso até ${formatarData(c.prazoFim)}`
      : `restrição até o evento: ${(c.eventoFim ?? '').slice(0, 60)}${(c.eventoFim ?? '').length > 60 ? '…' : ''}${c.prazoLimite ? ` (no máximo até ${formatarData(c.prazoLimite)})` : ''}`;
  return {
    cabecalho: `${MARCA_GRAU[grau]} — INFORMAÇÃO CLASSIFICADA (Lei 14.133/2021, art. 13)`,
    rodape: `${MARCA_GRAU[grau]} — Lei 12.527/2011, art. 24, § 1º, ${INCISO_GRAU[grau]}; ${termo}. Acesso restrito a pessoas credenciadas (Decreto 7.845/2012, art. 18).`,
  };
}

/**
 * Código de indexação da informação classificada (Decreto 7.845/2012, art. 2º, III), em formato simplificado:
 * número do processo, grau (U, S, R; O para o orçamento), data da classificação e termo final (data ou "EVENTO").
 */
export function codigoIndexacaoSigilo(c: { numeroSei: string; tipo: TipoSigilo; grau: GrauSigilo | null; classificadaEm: DataISO; prazoFim: DataISO | null }): string {
  const letra = c.tipo === 'orcamento' ? 'O' : { ultrassecreta: 'U', secreta: 'S', reservada: 'R' }[exigirGrau(c.grau)];
  const data = (d: DataISO) => exigirData(d, 'data').replaceAll('-', '');
  return `${c.numeroSei}.${letra}.${data(c.classificadaEm)}.${c.prazoFim ? data(c.prazoFim) : 'EVENTO'}`;
}

// ───────────────────────── Carimbo de tempo da trilha (RNF-09) ─────────────────────────

/**
 * Declaração ancorada: liga o número do último evento coberto ao hash da cadeia nesse evento. O servidor envia o
 * SHA-256 desta declaração à autoridade de carimbo do tempo (RFC 3161) ou o registra localmente no modo offline.
 */
export function declaracaoAncoragem(sequencia: number, hash: string): string {
  if (!Number.isSafeInteger(sequencia) || sequencia < 1) throw erro('Sequência da trilha inválida para a ancoragem.', 'ANCORAGEM_INVALIDA');
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw erro('Hash da trilha inválido para a ancoragem.', 'ANCORAGEM_INVALIDA');
  return `agora:trilha-auditoria:v1:${sequencia}:${hash}`;
}

/**
 * A ancoragem periódica é devida? Sim quando nunca houve ancoragem, ou quando a última tem `intervaloHoras` ou mais e há
 * eventos novos na trilha. Sem eventos novos, não há o que ancorar.
 */
export function ancoragemDevida(e: {
  ultimaAncoradaEm: string | null;
  ultimaSequencia: number | null;
  sequenciaAtual: number;
  agora: string;
  intervaloHoras: number;
}): { devida: boolean; motivo: string } {
  if (!Number.isFinite(e.intervaloHoras) || e.intervaloHoras <= 0) throw erro('O intervalo da ancoragem deve ser maior que zero.', 'ANCORAGEM_INVALIDA');
  const agora = Date.parse(e.agora);
  if (Number.isNaN(agora)) throw erro('Instante "agora" inválido.', 'ANCORAGEM_INVALIDA');
  if (e.sequenciaAtual < 1) return { devida: false, motivo: 'A trilha ainda não tem eventos.' };
  if (e.ultimaSequencia !== null && e.ultimaSequencia >= e.sequenciaAtual) return { devida: false, motivo: 'Nenhum evento novo desde a última ancoragem.' };
  if (e.ultimaAncoradaEm === null) return { devida: true, motivo: 'A trilha ainda não foi ancorada.' };
  const decorridas = (agora - Date.parse(e.ultimaAncoradaEm)) / 3_600_000;
  if (decorridas >= e.intervaloHoras) return { devida: true, motivo: `A última ancoragem tem ${Math.floor(decorridas)} hora(s).` };
  return { devida: false, motivo: `A próxima ancoragem é devida ${e.intervaloHoras} hora(s) depois da última.` };
}

export interface ConferenciaAncoragem {
  situacao: 'integra' | 'divergente';
  problemas: string[];
  avisos: string[];
}

/**
 * Confere uma ancoragem: o hash registrado deve ser o hash da cadeia (íntegra) no evento ancorado; no RFC 3161, o token
 * deve carimbar exatamente a declaração ancorada, com assinatura válida da autoridade de carimbo; no modo local, a prova
 * (HMAC do servidor) deve conferir. Certificado não reconhecido como confiável e diferença grande entre o carimbo e o
 * registro geram aviso.
 */
export function conferirAncoragem(e: {
  modo: 'rfc3161' | 'local';
  hashRegistrado: string;
  hashCadeia: string | null;
  cadeiaIntegra: boolean;
  impressaoEsperada: string;
  carimbo: { impressao: string; assinaturaValida: boolean; certificadoConfiavel: boolean | null; carimboEm: string } | null;
  provaLocalValida: boolean | null;
  ancoradaEm: string;
}): ConferenciaAncoragem {
  const problemas: string[] = [];
  const avisos: string[] = [];
  if (!e.cadeiaIntegra) problemas.push('A cadeia de hashes da trilha não está íntegra até o evento ancorado.');
  if (e.hashCadeia === null) problemas.push('O evento ancorado não existe mais na trilha.');
  else if (e.hashCadeia !== e.hashRegistrado) problemas.push('O hash da trilha no evento ancorado mudou depois da ancoragem.');
  if (e.modo === 'rfc3161') {
    if (e.carimbo === null) problemas.push('O token de carimbo do tempo não pôde ser lido.');
    else {
      if (e.carimbo.impressao !== e.impressaoEsperada) problemas.push('O carimbo do tempo não corresponde à declaração ancorada.');
      if (!e.carimbo.assinaturaValida) problemas.push('A assinatura da autoridade de carimbo do tempo não confere.');
      if (e.carimbo.certificadoConfiavel === false) problemas.push('O certificado da autoridade de carimbo não é o configurado como confiável.');
      if (e.carimbo.certificadoConfiavel === null) avisos.push('Nenhum certificado confiável configurado: a assinatura foi conferida com o certificado que veio no próprio token.');
      const diferenca = Math.abs(Date.parse(e.carimbo.carimboEm) - Date.parse(e.ancoradaEm));
      if (Number.isFinite(diferenca) && diferenca > 24 * 3_600_000) avisos.push('O horário do carimbo difere mais de 24 horas do registro da ancoragem.');
    }
  } else {
    if (e.provaLocalValida !== true) problemas.push('A prova local da ancoragem não confere com o segredo do servidor.');
    avisos.push('Ancoragem local (modo offline): comprova a integridade, mas o horário é o do próprio servidor, sem carimbo de terceiro.');
  }
  return { situacao: problemas.length === 0 ? 'integra' : 'divergente', problemas, avisos };
}
