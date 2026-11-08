/**
 * Regularidade do contratado e registro de sanções no CEIS/CNEP (Lei 14.133/2021).
 *
 * - Art. 91, § 4º: antes de formalizar ou prorrogar o contrato, a Administração verifica a regularidade fiscal,
 *   consulta o CEIS e o CNEP e junta as certidões ao processo.
 * - Art. 92, XVI: o contratado mantém, durante toda a execução, as condições de habilitação; por isso a Ágora
 *   repete a verificação antes do atesto e do pagamento.
 * - Art. 68, III a V: regularidade perante a Fazenda federal, a seguridade social e o FGTS e a Justiça do Trabalho.
 * - Art. 161: a sanção aplicada é informada ao CEIS/CNEP em até 15 dias úteis.
 *
 * Funções puras: a consulta às bases externas e o registro das certidões ficam no servidor; aqui só se avalia o
 * resultado. Nada aqui aplica sanção ou declara impedimento: são verificações de apoio com fonte e data.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, diasEntre, diasUteisEntre, formatarData, validarDataISO } from '../datas.ts';
import { prazoRegistroCeisCnep } from './sancoes.ts';

// ───────────────────────── Certidões de regularidade ─────────────────────────

export type TipoCertidaoRegularidade = 'fiscal_federal' | 'fgts' | 'trabalhista';
export type ResultadoCertidao = 'negativa' | 'positiva_com_efeitos_de_negativa' | 'positiva';
export type SituacaoCertidao = 'valida' | 'a_vencer' | 'vencida' | 'positiva';

export interface DefinicaoCertidao {
  tipo: TipoCertidaoRegularidade;
  nome: string;
  sigla: string;
  emissor: string;
  /** Validade máxima da certidão, em dias corridos a partir da emissão (norma do emissor). */
  validadeMaximaDias: number;
  fundamento: string;
}

/** Certidões exigidas antes de assinar, prorrogar, atestar e pagar. Não há API aberta: o agente confere e registra. */
export const CERTIDOES_REGULARIDADE: readonly DefinicaoCertidao[] = Object.freeze([
  Object.freeze({
    tipo: 'fiscal_federal' as const,
    nome: 'Certidão de débitos relativos a créditos tributários federais e à dívida ativa da União',
    sigla: 'CND federal',
    emissor: 'Receita Federal e Procuradoria-Geral da Fazenda Nacional',
    validadeMaximaDias: 180,
    fundamento: 'Lei 14.133/2021, art. 68, III',
  }),
  Object.freeze({
    tipo: 'fgts' as const,
    nome: 'Certificado de Regularidade do FGTS',
    sigla: 'CRF',
    emissor: 'Caixa Econômica Federal',
    validadeMaximaDias: 30,
    fundamento: 'Lei 14.133/2021, art. 68, IV',
  }),
  Object.freeze({
    tipo: 'trabalhista' as const,
    nome: 'Certidão Negativa de Débitos Trabalhistas',
    sigla: 'CNDT',
    emissor: 'Tribunal Superior do Trabalho',
    validadeMaximaDias: 180,
    fundamento: 'Lei 14.133/2021, art. 68, V',
  }),
]);

const RESULTADOS_CERTIDAO: readonly ResultadoCertidao[] = ['negativa', 'positiva_com_efeitos_de_negativa', 'positiva'];
const ANTECEDENCIA_AVISO_PADRAO = 15;

export interface CertidaoRegularidade {
  tipo: TipoCertidaoRegularidade;
  numero: string;
  emitidaEm: DataISO;
  validaAte: DataISO;
  resultado: ResultadoCertidao;
}

function definicaoCertidao(tipo: TipoCertidaoRegularidade): DefinicaoCertidao {
  const definicao = CERTIDOES_REGULARIDADE.find((c) => c.tipo === tipo);
  if (!definicao) throw new ErroDominio('CERTIDAO_INVALIDA', `Tipo de certidão desconhecido: ${String(tipo)}.`);
  return definicao;
}

function exigirData(valor: string, campo: string, codigo: string): void {
  if (typeof valor !== 'string' || !validarDataISO(valor)) throw new ErroDominio(codigo, `${campo} inválida: ${String(valor)}.`);
}

/**
 * Confere os dados de uma certidão antes do registro (art. 91, § 4º): tipo conhecido, número informado,
 * emissão até hoje, validade posterior à emissão e dentro do prazo máximo do emissor (180 dias para a CND federal
 * e a CNDT; 30 dias para o CRF). Devolve a definição da certidão.
 */
export function validarCertidao(c: CertidaoRegularidade, hoje: DataISO): DefinicaoCertidao {
  const definicao = definicaoCertidao(c.tipo);
  exigirData(hoje, 'hoje', 'CERTIDAO_INVALIDA');
  exigirData(c.emitidaEm, 'Data de emissão', 'CERTIDAO_INVALIDA');
  exigirData(c.validaAte, 'Data de validade', 'CERTIDAO_INVALIDA');
  if (typeof c.numero !== 'string' || c.numero.trim().length < 3 || c.numero.trim().length > 80) {
    throw new ErroDominio('CERTIDAO_INVALIDA', 'Informe o número ou código de controle da certidão (3 a 80 caracteres).');
  }
  if (!RESULTADOS_CERTIDAO.includes(c.resultado)) {
    throw new ErroDominio('CERTIDAO_INVALIDA', `Resultado de certidão inválido: ${String(c.resultado)}.`);
  }
  if (c.emitidaEm > hoje) throw new ErroDominio('CERTIDAO_INVALIDA', 'A data de emissão não pode ser posterior a hoje.');
  const validade = diasEntre(c.emitidaEm, c.validaAte);
  if (validade < 0) throw new ErroDominio('CERTIDAO_INVALIDA', 'A validade não pode ser anterior à emissão.');
  if (validade > definicao.validadeMaximaDias) {
    throw new ErroDominio(
      'CERTIDAO_INVALIDA',
      `A validade informada (${validade} dias) excede o prazo de ${definicao.validadeMaximaDias} dias da ${definicao.sigla}: confira a data no documento.`,
    );
  }
  return definicao;
}

/**
 * Situação de uma certidão em `hoje` (válida até o último dia da validade, inclusive): positiva (não comprova
 * regularidade), vencida, a vencer (até `antecedenciaAvisoDias` dias) ou válida.
 */
export function situacaoCertidao(
  c: CertidaoRegularidade,
  hoje: DataISO,
  antecedenciaAvisoDias = ANTECEDENCIA_AVISO_PADRAO,
): { situacao: SituacaoCertidao; diasRestantes: number; mensagem: string; fundamento: string } {
  const definicao = definicaoCertidao(c.tipo);
  exigirData(hoje, 'hoje', 'CERTIDAO_INVALIDA');
  exigirData(c.validaAte, 'Data de validade', 'CERTIDAO_INVALIDA');
  if (!Number.isInteger(antecedenciaAvisoDias) || antecedenciaAvisoDias < 0) {
    throw new ErroDominio('CERTIDAO_INVALIDA', 'A antecedência do aviso deve ser um inteiro não negativo.');
  }
  const diasRestantes = diasEntre(hoje, c.validaAte);
  const rotulo = `${definicao.sigla} (nº ${c.numero.trim()})`;
  const fundamento = `${definicao.fundamento}; art. 91, § 4º`;
  if (c.resultado === 'positiva') {
    return { situacao: 'positiva', diasRestantes, mensagem: `${rotulo}: certidão positiva, com débitos — não comprova a regularidade.`, fundamento };
  }
  if (diasRestantes < 0) {
    return { situacao: 'vencida', diasRestantes, mensagem: `${rotulo}: validade expirada em ${formatarData(c.validaAte)}.`, fundamento };
  }
  if (diasRestantes <= antecedenciaAvisoDias) {
    const prazo = diasRestantes === 0 ? 'vence hoje' : `vence em ${diasRestantes} ${diasRestantes === 1 ? 'dia' : 'dias'}, em ${formatarData(c.validaAte)}`;
    return { situacao: 'a_vencer', diasRestantes, mensagem: `${rotulo}: ${prazo}. Providencie a nova certidão.`, fundamento };
  }
  return { situacao: 'valida', diasRestantes, mensagem: `${rotulo}: válida até ${formatarData(c.validaAte)}.`, fundamento };
}

// ───────────────────────── Registros do CEIS e do CNEP ─────────────────────────

/** Registro do CEIS ou do CNEP, normalizado pelo servidor (sem dados pessoais). */
export interface RegistroCadastroSancoes {
  cadastro: 'CEIS' | 'CNEP';
  tipoSancao: string;
  orgaoSancionador: string;
  /** Esfera do órgão sancionador, como informada pela fonte ('Federal', 'Estadual', 'Municipal'). */
  esfera: string | null;
  uf: string | null;
  dataInicio: DataISO | null;
  dataFim: DataISO | null;
  numeroProcesso: string | null;
  fundamentacao: string | null;
  abrangencia: string | null;
}

export interface ClassificacaoRegistroSancoes {
  vigente: boolean;
  impeditivo: boolean;
  descricao: string;
  observacao: string | null;
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const RESTRICAO_NACIONAL = /inidon|proibi|judicial|dissolu|interdi/;
const RESTRICAO_DO_ENTE = /impedi|suspens/;

/**
 * Classifica um registro do CEIS/CNEP em `hoje`. Vigente: iniciado e sem término ou com término futuro.
 * Impeditivo, quando vigente:
 * - inidoneidade, proibição de contratar e decisões judiciais: alcançam todos os entes (art. 156, § 5º);
 * - impedimento ou suspensão: alcançam o ente que aplicou (art. 156, § 4º) — impeditivo se da mesma esfera da
 *   contratante; de outra esfera vira atenção, para o agente conferir a abrangência;
 * - demais registros do CEIS são tratados como impeditivos (cadastro de empresas inidôneas e suspensas);
 * - registros do CNEP sem restrição de contratar (multa, publicação extraordinária, acordo de leniência) são atenção.
 */
export function classificarRegistroSancaoExterna(
  r: RegistroCadastroSancoes,
  hoje: DataISO,
  esferaContratante = 'Federal',
): ClassificacaoRegistroSancoes {
  exigirData(hoje, 'hoje', 'REGISTRO_SANCAO_INVALIDO');
  if (r.cadastro !== 'CEIS' && r.cadastro !== 'CNEP') {
    throw new ErroDominio('REGISTRO_SANCAO_INVALIDO', `Cadastro desconhecido: ${String(r.cadastro)}.`);
  }
  if (r.dataInicio !== null) exigirData(r.dataInicio, 'Data de início da sanção', 'REGISTRO_SANCAO_INVALIDO');
  if (r.dataFim !== null) exigirData(r.dataFim, 'Data de fim da sanção', 'REGISTRO_SANCAO_INVALIDO');

  const vigente = (r.dataInicio === null || r.dataInicio <= hoje) && (r.dataFim === null || r.dataFim >= hoje);
  const tipo = semAcento(r.tipoSancao);
  const mesmaEsfera = r.esfera === null || semAcento(r.esfera) === semAcento(esferaContratante);
  let impeditivo = false;
  let observacao: string | null = null;
  if (vigente) {
    if (RESTRICAO_NACIONAL.test(tipo)) impeditivo = true;
    else if (RESTRICAO_DO_ENTE.test(tipo)) {
      impeditivo = mesmaEsfera;
      if (!mesmaEsfera) {
        observacao = 'Restrição aplicada por ente de outra esfera: alcança o ente que a aplicou (art. 156, § 4º). Confira a abrangência antes de contratar.';
      }
    } else if (r.cadastro === 'CEIS') impeditivo = true;
    else observacao = 'Sanção registrada no CNEP que, por si, não impede contratar: registre a ciência no processo.';
  }

  const local = [r.uf, r.esfera].filter((v): v is string => v !== null && v.trim() !== '').join(', ');
  const periodo =
    r.dataInicio === null
      ? r.dataFim === null
        ? 'sem período informado'
        : `até ${formatarData(r.dataFim)}`
      : r.dataFim === null
        ? `desde ${formatarData(r.dataInicio)}, sem data de término`
        : `de ${formatarData(r.dataInicio)} a ${formatarData(r.dataFim)}`;
  const processo = r.numeroProcesso ? ` — processo ${r.numeroProcesso}` : '';
  const descricao = `${r.cadastro}: ${r.tipoSancao.trim()}, aplicada por ${r.orgaoSancionador.trim()}${local ? ` (${local})` : ''}, ${periodo}${processo}.`;
  return { vigente, impeditivo, descricao, observacao };
}

// ───────────────────────── Checklist de regularidade ─────────────────────────

export type MomentoVerificacaoRegularidade = 'assinatura' | 'prorrogacao' | 'atesto' | 'pagamento';
export type SituacaoItemRegularidade = 'conforme' | 'atencao' | 'pendente' | 'impeditivo';

export interface ConsultaCadastrosSancoes {
  fonte: string;
  /** Instante ISO 8601 da consulta. */
  consultadoEm: string;
  registros: readonly RegistroCadastroSancoes[];
}

export interface SancaoRegistradaNaAgora {
  tipo: 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';
  situacao: 'em_instrucao' | 'defesa' | 'decisao' | 'aplicada' | 'arquivada';
  fimVigencia: DataISO | null;
}

export interface EntradaChecklistRegularidade {
  momento: MomentoVerificacaoRegularidade;
  hoje: DataISO;
  /** Instante ISO 8601 da avaliação (idade da consulta). */
  agora: string;
  /** Última consulta bem-sucedida ao CEIS/CNEP (null: nunca consultado ou falhou sem resultado anterior). */
  consulta: ConsultaCadastrosSancoes | null;
  /** Motivo da falha da última tentativa de consulta, se houver. */
  falhaConsulta?: string | null;
  /** true nas travas (assinar, prorrogar, atestar, pagar): sem consulta atual, o item fica impeditivo. */
  consultaObrigatoria: boolean;
  sancoesAgora: readonly SancaoRegistradaNaAgora[];
  certidoes: readonly CertidaoRegularidade[];
  /** Idade máxima da consulta para valer como atual (padrão 24 h). */
  validadeConsultaHoras?: number;
  /** Antecedência do aviso de vencimento das certidões (padrão 15 dias). */
  antecedenciaAvisoDias?: number;
  esferaContratante?: string;
}

export interface ItemChecklistRegularidade {
  id: 'ceis_cnep' | 'sancoes_agora' | TipoCertidaoRegularidade;
  rotulo: string;
  situacao: SituacaoItemRegularidade;
  detalhes: string[];
  fonte: string;
  /** Instante da consulta (CEIS/CNEP) ou data de validade (certidão). */
  referencia: string | null;
  fundamento: string;
}

export interface ResultadoChecklistRegularidade {
  momento: MomentoVerificacaoRegularidade;
  regular: boolean;
  /** true quando a irregularidade impede o ato (assinatura e prorrogação). */
  bloqueia: boolean;
  itens: ItemChecklistRegularidade[];
  motivos: string[];
  avisos: string[];
  providencias: string[];
  fundamento: string;
  aviso: string;
}

const MOMENTOS: Record<MomentoVerificacaoRegularidade, { bloqueia: boolean; fundamento: string }> = {
  assinatura: { bloqueia: true, fundamento: 'Lei 14.133/2021, art. 91, § 4º' },
  prorrogacao: { bloqueia: true, fundamento: 'Lei 14.133/2021, art. 91, § 4º' },
  atesto: { bloqueia: false, fundamento: 'Lei 14.133/2021, art. 92, XVI, e art. 91, § 4º' },
  pagamento: { bloqueia: false, fundamento: 'Lei 14.133/2021, art. 92, XVI, e art. 91, § 4º' },
};

const ROTULO_SANCAO_IMPEDITIVA: Record<'impedimento_licitar' | 'declaracao_inidoneidade', string> = {
  impedimento_licitar: 'Impedimento de licitar e contratar',
  declaracao_inidoneidade: 'Declaração de inidoneidade',
};

const FONTE_CADASTROS = 'CEIS e CNEP — Portal da Transparência (CGU)';
const AVISO_CHECKLIST =
  'Verificação automática de apoio, com fonte e data de cada consulta. Não aplica sanção nem declara impedimento: decidir sobre a contratação, a retenção, a extinção do contrato ou a sanção cabe ao agente ou à autoridade competente.';

function itemCadastros(e: EntradaChecklistRegularidade, validadeHoras: number, esfera: string): { item: ItemChecklistRegularidade; motivos: string[]; avisos: string[] } {
  const base = { id: 'ceis_cnep' as const, rotulo: 'Consulta ao CEIS e ao CNEP', fundamento: 'Lei 14.133/2021, art. 91, § 4º' };
  const falha = e.falhaConsulta?.trim() ? e.falhaConsulta.trim() : null;
  if (e.consulta === null) {
    const motivo = falha
      ? `Não foi possível consultar o CEIS e o CNEP: ${falha}`
      : 'O CEIS e o CNEP ainda não foram consultados para este fornecedor.';
    const detalhes = [
      motivo,
      e.consultaObrigatoria
        ? 'Sem a consulta, o ato fica bloqueado até nova tentativa (art. 91, § 4º).'
        : 'A consulta é feita automaticamente antes de assinar, prorrogar, atestar e pagar.',
    ];
    return {
      item: { ...base, situacao: e.consultaObrigatoria ? 'impeditivo' : 'pendente', detalhes, fonte: FONTE_CADASTROS, referencia: null },
      motivos: e.consultaObrigatoria ? [motivo] : [],
      avisos: e.consultaObrigatoria ? [] : [motivo],
    };
  }

  const instante = Date.parse(e.consulta.consultadoEm);
  if (!Number.isFinite(instante)) throw new ErroDominio('CHECKLIST_INVALIDO', `Instante da consulta inválido: ${String(e.consulta.consultadoEm)}.`);
  const idadeHoras = (Date.parse(e.agora) - instante) / 3_600_000;
  const desatualizada = idadeHoras > validadeHoras;
  const motivos: string[] = [];
  const avisos: string[] = [];
  const detalhes: string[] = [];
  for (const registro of e.consulta.registros) {
    const c = classificarRegistroSancaoExterna(registro, e.hoje, esfera);
    if (!c.vigente) continue;
    if (c.impeditivo) {
      motivos.push(`${c.descricao} Sanção vigente impede a contratação.`);
      detalhes.push(`${c.descricao} Sanção vigente impede a contratação.`);
    } else {
      const texto = `${c.descricao}${c.observacao ? ` ${c.observacao}` : ''}`;
      avisos.push(texto);
      detalhes.push(texto);
    }
  }
  if (detalhes.length === 0) detalhes.push('Nada consta, no CEIS e no CNEP, sanção vigente para o CNPJ ou CPF consultado.');
  let situacao: SituacaoItemRegularidade = motivos.length > 0 ? 'impeditivo' : avisos.length > 0 ? 'atencao' : 'conforme';
  if (desatualizada && motivos.length === 0) {
    const texto = `A última consulta tem mais de ${validadeHoras} horas${falha ? ` e a nova tentativa falhou: ${falha}` : ''}.`;
    detalhes.push(texto);
    if (e.consultaObrigatoria) {
      motivos.push(texto);
      situacao = 'impeditivo';
    } else {
      avisos.push(texto);
      situacao = 'pendente';
    }
  } else if (falha) {
    detalhes.push(`A nova tentativa de consulta falhou (${falha}); vale o resultado da consulta anterior, dentro da validade.`);
  }
  return {
    item: { ...base, situacao, detalhes, fonte: e.consulta.fonte, referencia: e.consulta.consultadoEm },
    motivos,
    avisos,
  };
}

function itemSancoesAgora(e: EntradaChecklistRegularidade): { item: ItemChecklistRegularidade; motivos: string[] } {
  const motivos: string[] = [];
  for (const s of e.sancoesAgora) {
    if (s.tipo !== 'impedimento_licitar' && s.tipo !== 'declaracao_inidoneidade') continue;
    if (s.situacao !== 'aplicada') continue;
    if (s.fimVigencia !== null) exigirData(s.fimVigencia, 'Fim da vigência da sanção', 'CHECKLIST_INVALIDO');
    if (s.fimVigencia !== null && s.fimVigencia < e.hoje) continue;
    motivos.push(`${ROTULO_SANCAO_IMPEDITIVA[s.tipo]} vigente${s.fimVigencia ? ` até ${formatarData(s.fimVigencia)}` : ''} (art. 156)`);
  }
  return {
    item: {
      id: 'sancoes_agora',
      rotulo: 'Sanções aplicadas pelo órgão',
      situacao: motivos.length > 0 ? 'impeditivo' : 'conforme',
      detalhes: motivos.length > 0 ? [...motivos] : ['Nenhum impedimento ou declaração de inidoneidade vigente nos processos sancionatórios do órgão.'],
      fonte: 'Processos sancionatórios registrados na Ágora',
      referencia: e.agora,
      fundamento: 'Lei 14.133/2021, art. 14, III, e art. 156, §§ 4º e 5º',
    },
    motivos,
  };
}

function itemCertidao(
  definicao: DefinicaoCertidao,
  certidoes: readonly CertidaoRegularidade[],
  hoje: DataISO,
  antecedencia: number,
): { item: ItemChecklistRegularidade; motivos: string[]; avisos: string[]; aVencer: boolean } {
  const doTipo = certidoes
    .filter((c) => c.tipo === definicao.tipo)
    .sort((a, b) => (a.validaAte === b.validaAte ? b.emitidaEm.localeCompare(a.emitidaEm) : b.validaAte.localeCompare(a.validaAte)));
  const base = {
    id: definicao.tipo,
    rotulo: `${definicao.sigla} — ${definicao.nome}`,
    fonte: `Certidão emitida por ${definicao.emissor}, conferida e registrada pelo agente`,
    fundamento: `${definicao.fundamento}; art. 91, § 4º`,
  };
  const atual = doTipo[0];
  if (!atual) {
    const motivo = `${definicao.sigla}: certidão não registrada. Emita a certidão no sítio do emissor e registre-a na Ágora.`;
    return { item: { ...base, situacao: 'impeditivo', detalhes: [motivo], referencia: null }, motivos: [motivo], avisos: [], aVencer: false };
  }
  const s = situacaoCertidao(atual, hoje, antecedencia);
  const detalhes = [s.mensagem];
  if (s.situacao === 'positiva' || s.situacao === 'vencida') {
    return { item: { ...base, situacao: 'impeditivo', detalhes, referencia: atual.validaAte }, motivos: [s.mensagem], avisos: [], aVencer: false };
  }
  if (s.situacao === 'a_vencer') {
    return { item: { ...base, situacao: 'atencao', detalhes, referencia: atual.validaAte }, motivos: [], avisos: [s.mensagem], aVencer: true };
  }
  return { item: { ...base, situacao: 'conforme', detalhes, referencia: atual.validaAte }, motivos: [], avisos: [], aVencer: false };
}

/**
 * Checklist de regularidade do contratado (RF-20): consulta ao CEIS e ao CNEP (com fonte e data), sanções
 * impeditivas aplicadas pelo órgão e certidões fiscal federal, do FGTS e trabalhista.
 * - Assinatura e prorrogação (art. 91, § 4º): qualquer item impeditivo bloqueia o ato (RN-09).
 * - Atesto e pagamento (art. 92, XVI): o recheque (RN-23) registra a situação e orienta as providências, sem reter
 *   automaticamente o que já foi executado — decidir é da autoridade competente.
 */
export function avaliarChecklistRegularidade(e: EntradaChecklistRegularidade): ResultadoChecklistRegularidade {
  const definicaoMomento = MOMENTOS[e.momento];
  if (!definicaoMomento) throw new ErroDominio('CHECKLIST_INVALIDO', `Momento de verificação inválido: ${String(e.momento)}.`);
  exigirData(e.hoje, 'hoje', 'CHECKLIST_INVALIDO');
  if (typeof e.agora !== 'string' || !Number.isFinite(Date.parse(e.agora))) {
    throw new ErroDominio('CHECKLIST_INVALIDO', `Instante da avaliação inválido: ${String(e.agora)}.`);
  }
  if (!Array.isArray(e.sancoesAgora) || !Array.isArray(e.certidoes)) {
    throw new ErroDominio('CHECKLIST_INVALIDO', 'sancoesAgora e certidoes devem ser listas.');
  }
  const validadeHoras = e.validadeConsultaHoras ?? 24;
  if (!Number.isFinite(validadeHoras) || validadeHoras <= 0) {
    throw new ErroDominio('CHECKLIST_INVALIDO', 'A validade da consulta deve ser um número positivo de horas.');
  }
  const antecedencia = e.antecedenciaAvisoDias ?? ANTECEDENCIA_AVISO_PADRAO;

  const cadastros = itemCadastros(e, validadeHoras, e.esferaContratante ?? 'Federal');
  const sancoes = itemSancoesAgora(e);
  const certidoes = CERTIDOES_REGULARIDADE.map((d) => itemCertidao(d, e.certidoes, e.hoje, antecedencia));

  const itens = [cadastros.item, sancoes.item, ...certidoes.map((c) => c.item)];
  const motivos = [...cadastros.motivos, ...sancoes.motivos, ...certidoes.flatMap((c) => c.motivos)];
  const avisos = [...cadastros.avisos, ...certidoes.flatMap((c) => c.avisos)];
  const regular = itens.every((i) => i.situacao !== 'impeditivo');
  const bloqueia = !regular && definicaoMomento.bloqueia;

  const providencias: string[] = [];
  if (!regular && definicaoMomento.bloqueia) {
    providencias.push(
      'Regularize as pendências apontadas — registre certidões válidas ou aguarde o fim da sanção — e repita a verificação.',
      'Enquanto houver restrição, a assinatura e a prorrogação ficam bloqueadas (art. 91, § 4º).',
    );
  } else if (!regular) {
    providencias.push(
      'Notifique o contratado para regularizar a situação e manter as condições de habilitação durante a execução (art. 92, XVI).',
      'A irregularidade não autoriza, por si só, reter o pagamento do que já foi executado. Extinção do contrato (art. 137) ou sanção (art. 156) dependem de decisão da autoridade competente, em processo com contraditório e ampla defesa.',
    );
  }
  if (certidoes.some((c) => c.aVencer)) providencias.push('Peça ao contratado as certidões que vencem em breve, para não interromper a execução.');

  return {
    momento: e.momento,
    regular,
    bloqueia,
    itens,
    motivos,
    avisos,
    providencias,
    fundamento: definicaoMomento.fundamento,
    aviso: AVISO_CHECKLIST,
  };
}

// ───────────────────────── Registro da sanção no CEIS/CNEP (art. 161) ─────────────────────────

export type SituacaoRegistroCeisCnep = 'pendente_no_prazo' | 'pendente_vencida' | 'registrada_no_prazo' | 'registrada_fora_do_prazo';

/** Dias úteis restantes a partir dos quais a pendência de registro vira alerta. */
const DIAS_UTEIS_ALERTA_REGISTRO = 5;

/**
 * Situação do registro de uma sanção aplicada no CEIS/CNEP: prazo de 15 dias úteis contados da aplicação
 * (art. 161, contagem do art. 183). Sem envio registrado, informa os dias úteis restantes ou em atraso e acende
 * o alerta a partir de 5 dias úteis do vencimento. O envio não pode ser anterior à aplicação nem posterior a hoje.
 */
export function situacaoRegistroCeisCnep(
  e: { aplicacao: DataISO; enviadoEm: DataISO | null; hoje: DataISO },
  opcoes?: OpcoesCalendario,
): {
  vencimento: DataISO;
  situacao: SituacaoRegistroCeisCnep;
  diasUteisRestantes: number | null;
  diasUteisAtraso: number | null;
  alerta: boolean;
  mensagem: string;
  fundamento: string;
} {
  exigirData(e.aplicacao, 'Data de aplicação da sanção', 'REGISTRO_CEIS_CNEP_INVALIDO');
  exigirData(e.hoje, 'hoje', 'REGISTRO_CEIS_CNEP_INVALIDO');
  const { vencimento, fundamento } = prazoRegistroCeisCnep(e.aplicacao, opcoes);
  if (e.enviadoEm !== null) {
    exigirData(e.enviadoEm, 'Data do envio', 'REGISTRO_CEIS_CNEP_INVALIDO');
    if (e.enviadoEm < e.aplicacao) throw new ErroDominio('REGISTRO_CEIS_CNEP_INVALIDO', 'O envio ao CEIS/CNEP não pode ser anterior à aplicação da sanção.');
    if (e.enviadoEm > e.hoje) throw new ErroDominio('REGISTRO_CEIS_CNEP_INVALIDO', 'A data do envio não pode ser posterior a hoje.');
    const noPrazo = e.enviadoEm <= vencimento;
    return {
      vencimento,
      situacao: noPrazo ? 'registrada_no_prazo' : 'registrada_fora_do_prazo',
      diasUteisRestantes: null,
      diasUteisAtraso: noPrazo ? null : diasUteisEntre(vencimento, e.enviadoEm, opcoes),
      alerta: false,
      mensagem: noPrazo
        ? `Enviada ao CEIS/CNEP em ${formatarData(e.enviadoEm)}, dentro do prazo que venceu em ${formatarData(vencimento)}.`
        : `Enviada ao CEIS/CNEP em ${formatarData(e.enviadoEm)}, depois do prazo que venceu em ${formatarData(vencimento)}.`,
      fundamento,
    };
  }
  if (e.hoje > vencimento) {
    const atraso = diasUteisEntre(vencimento, e.hoje, opcoes);
    return {
      vencimento,
      situacao: 'pendente_vencida',
      diasUteisRestantes: null,
      diasUteisAtraso: atraso,
      alerta: true,
      mensagem: `Prazo de registro no CEIS/CNEP vencido em ${formatarData(vencimento)} (${atraso} ${atraso === 1 ? 'dia útil' : 'dias úteis'} de atraso): informe a sanção e registre o protocolo.`,
      fundamento,
    };
  }
  const restantes = diasUteisEntre(e.hoje, vencimento, opcoes);
  return {
    vencimento,
    situacao: 'pendente_no_prazo',
    diasUteisRestantes: restantes,
    diasUteisAtraso: null,
    alerta: restantes <= DIAS_UTEIS_ALERTA_REGISTRO,
    mensagem:
      restantes === 0
        ? `O prazo de registro no CEIS/CNEP vence hoje (${formatarData(vencimento)}).`
        : `Registre a sanção no CEIS/CNEP até ${formatarData(vencimento)} (${restantes} ${restantes === 1 ? 'dia útil' : 'dias úteis'} restantes).`,
    fundamento,
  };
}
