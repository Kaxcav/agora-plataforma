/**
 * Vínculos entre licitantes e com agentes públicos (Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV e V) e
 * possível sucessão de empresa sancionada (art. 14, III e § 1º, e art. 160).
 *
 * Só entram fontes lícitas: o quadro societário (QSA) dos dados abertos do CNPJ, o cadastro do fornecedor,
 * as declarações dos licitantes e dos agentes e os vínculos informados por agente público, sempre com fonte e
 * evidência. Não há inferência de parentesco por cruzamento de dados pessoais nem por endereço IP.
 * Tudo aqui é SINAL para análise humana: nenhuma função desclassifica, impede, sanciona ou acusa.
 */
import { ErroDominio } from '../erros.ts';
import { formatarData, type DataISO } from '../datas.ts';
import { mascararEmail, mascararNome, mascararTelefone, somenteDigitos } from '../documentos.ts';
import { adicionarMeses, lerData } from '../interno.ts';

export type QualificacaoQsa = 'socio' | 'administrador' | 'socio_administrador';

/** Integrante do quadro societário. `documento`: CPF completo (11 dígitos) ou o CPF parcial dos dados abertos ("***456789**"). */
export interface IntegranteQsa {
  documento: string;
  nome: string;
  qualificacao: QualificacaoQsa;
}

export interface FornecedorParaVinculos {
  id: string;
  /** Razão social. */
  nome: string;
  dataAbertura: DataISO | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  quadro: readonly IntegranteQsa[];
}

export type FonteVinculo = 'qsa_receita' | 'cadastro_fornecedor' | 'declaracao_licitante' | 'declaracao_agente' | 'informado_agente';

export type NaturezaVinculo =
  | 'conjuge'
  | 'parentesco'
  | 'societario'
  | 'tecnico'
  | 'comercial'
  | 'economico'
  | 'financeiro'
  | 'trabalhista'
  | 'civil';

/** Vínculo registrado com fonte e evidência: entre dois fornecedores ou entre um fornecedor e um agente público. */
export interface VinculoInformado {
  id: string;
  natureza: NaturezaVinculo;
  /** Só para parentesco: 1º a 3º grau (art. 7º, III, e art. 14, IV). */
  grauParentesco: 1 | 2 | 3 | null;
  fornecedorId: string;
  outroFornecedorId: string | null;
  agente: { usuarioId: string; nome: string } | null;
  fonte: FonteVinculo;
  evidencia: string;
  descricao: string;
}

/** Agente público que atua no processo (equipe designada). CPF completo, usado só para comparar. */
export interface AgenteParaVinculos {
  usuarioId: string;
  nome: string;
  cpf: string;
}

export type TipoSinalVinculo =
  | 'socio_comum'
  | 'administrador_comum'
  | 'endereco_comum'
  | 'contato_comum'
  | 'vinculo_informado'
  | 'agente_publico'
  | 'possivel_sucessao';

export interface EvidenciaVinculo {
  fonte: FonteVinculo;
  descricao: string;
}

export interface SinalVinculo {
  /** RIA-06: cruzamento do quadro societário; RIA-10: demais vínculos e possível sucessão. */
  regra: 'RIA-06' | 'RIA-10';
  tipo: TipoSinalVinculo;
  nivel: 'atencao' | 'risco';
  fornecedores: { id: string; nome: string }[];
  agente: { usuarioId: string; nome: string } | null;
  mensagem: string;
  evidencias: EvidenciaVinculo[];
  fundamento: string;
  requerRevisaoHumana: true;
  /** Sanção de origem, nos sinais de possível sucessão (base da proposta de extensão do art. 160). */
  sancaoOrigemId: string | null;
}

export const AVISO_SINAIS_VINCULO =
  'Sinais para análise humana: não constituem acusação, desclassificação, inabilitação ou impedimento. A apuração cabe ao agente de contratação ou à comissão, com contraditório e ampla defesa. Requer revisão humana.';

export const PREMISSAS_SINAIS_VINCULO: readonly string[] = Object.freeze([
  'Fontes lícitas apenas: quadro societário dos dados abertos do CNPJ (Receita Federal), cadastro do fornecedor, declarações dos licitantes e dos agentes e vínculos informados por agente público com fonte e evidência.',
  'Parentesco e casamento não são deduzidos por cruzamento de dados pessoais nem por endereço IP: só entram quando declarados ou informados com evidência.',
  'A mesma pessoa em dois quadros societários é reconhecida pelos 6 dígitos centrais do CPF, que os dados abertos publicam, e pelo nome.',
  'Nomes de pessoas e documentos aparecem mascarados (LGPD).',
]);

const NATUREZAS: readonly NaturezaVinculo[] = [
  'conjuge',
  'parentesco',
  'societario',
  'tecnico',
  'comercial',
  'economico',
  'financeiro',
  'trabalhista',
  'civil',
];

const ROTULO_NATUREZA: Record<NaturezaVinculo, string> = {
  conjuge: 'cônjuge ou companheiro',
  parentesco: 'parentesco',
  societario: 'vínculo societário',
  tecnico: 'vínculo técnico',
  comercial: 'vínculo comercial',
  economico: 'vínculo econômico',
  financeiro: 'vínculo financeiro',
  trabalhista: 'vínculo trabalhista',
  civil: 'vínculo civil',
};

const ROTULO_FONTE: Record<FonteVinculo, string> = {
  qsa_receita: 'quadro societário (dados abertos do CNPJ)',
  cadastro_fornecedor: 'cadastro do fornecedor',
  declaracao_licitante: 'declaração do licitante',
  declaracao_agente: 'declaração do agente público',
  informado_agente: 'informado por agente público',
};

const FUNDAMENTO_ENTRE_LICITANTES =
  'Lei 14.133/2021, art. 14, V (coligadas ou controladas concorrendo entre si), e art. 155, IX e XI (fraude e atos para frustrar a licitação)';
const FUNDAMENTO_AGENTE = 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV';
const FUNDAMENTO_SUCESSAO = 'Lei 14.133/2021, art. 14, III e § 1º, e art. 160';

export function rotuloNaturezaVinculo(natureza: NaturezaVinculo): string {
  return ROTULO_NATUREZA[natureza];
}

export function rotuloFonteVinculo(fonte: FonteVinculo): string {
  return ROTULO_FONTE[fonte];
}

/**
 * Valida um vínculo antes do registro: natureza conhecida, grau só para parentesco (1º a 3º grau, art. 14, IV),
 * exatamente uma contraparte (outro fornecedor ou agente público) e evidência descrita.
 */
export function validarVinculoInformado(v: Omit<VinculoInformado, 'id' | 'agente'> & { agenteId: string | null }): void {
  if (!NATUREZAS.includes(v.natureza)) throw new ErroDominio('VINCULO_INVALIDO', `Natureza de vínculo inválida: ${String(v.natureza)}.`);
  if (v.natureza === 'parentesco') {
    if (v.grauParentesco === null || ![1, 2, 3].includes(v.grauParentesco)) {
      throw new ErroDominio('VINCULO_INVALIDO', 'Informe o grau de parentesco (1º, 2º ou 3º grau, em linha reta, colateral ou por afinidade).');
    }
  } else if (v.grauParentesco !== null) {
    throw new ErroDominio('VINCULO_INVALIDO', 'O grau só se aplica ao vínculo de parentesco.');
  }
  const contrapartes = (v.outroFornecedorId !== null ? 1 : 0) + (v.agenteId !== null ? 1 : 0);
  if (contrapartes !== 1) {
    throw new ErroDominio('VINCULO_INVALIDO', 'Indique a outra parte do vínculo: outro fornecedor ou um agente público (apenas um).');
  }
  if (v.outroFornecedorId !== null && v.outroFornecedorId === v.fornecedorId) {
    throw new ErroDominio('VINCULO_INVALIDO', 'O vínculo precisa ligar dois fornecedores diferentes.');
  }
  if (typeof v.evidencia !== 'string' || v.evidencia.trim().length < 15) {
    throw new ErroDominio('VINCULO_INVALIDO', 'Descreva a evidência (documento, certidão ou declaração e onde está juntada), com pelo menos 15 caracteres.');
  }
}

// ───────────────────────── normalização ─────────────────────────

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizarNome(nome: string): string {
  return semAcento(nome).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 6 dígitos centrais do CPF (posições 4 a 9), os mesmos que os dados abertos do CNPJ publicam. */
function digitosCentraisCpf(documento: string): string | null {
  const d = somenteDigitos(documento);
  if (d.length === 11) return d.slice(3, 9);
  if (d.length === 6) return d;
  return null;
}

/** Chave da pessoa: dígitos centrais do CPF e nome normalizado. Sem documento legível, não há comparação. */
function chavePessoa(documento: string, nome: string): string | null {
  const centrais = digitosCentraisCpf(documento);
  const n = normalizarNome(nome);
  return centrais === null || n.length === 0 ? null : `${centrais}|${n}`;
}

/**
 * A mesma pessoa em dois registros do quadro societário: mesmos 6 dígitos centrais do CPF (o que os dados abertos
 * publicam) e mesmo nome, sem acentos nem diferença de maiúsculas. CPF completo de um lado e parcial do outro é aceito.
 */
export function mesmaPessoaQsa(a: { documento: string; nome: string }, b: { documento: string; nome: string }): boolean {
  const chaveA = chavePessoa(a.documento, a.nome);
  return chaveA !== null && chaveA === chavePessoa(b.documento, b.nome);
}

function documentoMascarado(documento: string): string {
  const centrais = digitosCentraisCpf(documento);
  return centrais === null ? 'documento não informado' : `***.${centrais.slice(0, 3)}.${centrais.slice(3)}-**`;
}

function pessoaMascarada(nome: string, documento: string): string {
  let nomeSeguro = 'Pessoa';
  try {
    nomeSeguro = mascararNome(nome);
  } catch {
    // nome vazio: fica o genérico
  }
  return `${nomeSeguro} (CPF ${documentoMascarado(documento)})`;
}

const ABREVIACOES: Record<string, string> = {
  r: 'rua',
  av: 'avenida',
  rod: 'rodovia',
  q: 'quadra',
  qd: 'quadra',
  cj: 'conjunto',
  bl: 'bloco',
  lt: 'lote',
  sl: 'sala',
  ed: 'edificio',
  tv: 'travessa',
  al: 'alameda',
  pc: 'praca',
  pca: 'praca',
  est: 'estrada',
};
const DESCARTAR = new Set(['n', 'no', 'num', 'numero', 'nro', 's', 'sn']);

/** Endereço comparável: sem acentos, pontuação e abreviações comuns. Endereço curto demais não é comparado. */
export function normalizarEndereco(endereco: string): string | null {
  const tokens = semAcento(endereco)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0 && !DESCARTAR.has(t))
    .map((t) => ABREVIACOES[t] ?? t);
  const resultado = tokens.join(' ');
  return resultado.length >= 10 ? resultado : null;
}

function telefoneComparavel(telefone: string | null): string | null {
  if (telefone === null) return null;
  let d = somenteDigitos(telefone);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length >= 10 ? d : null;
}

function emailComparavel(email: string | null): string | null {
  if (email === null) return null;
  const e = email.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

function telefoneSeguro(telefone: string): string {
  try {
    return mascararTelefone(telefone);
  } catch {
    return 'telefone informado';
  }
}

function emailSeguro(email: string): string {
  try {
    return mascararEmail(email);
  } catch {
    return 'e-mail informado';
  }
}

const ROTULO_QUALIFICACAO: Record<QualificacaoQsa, string> = {
  socio: 'sócio',
  administrador: 'administrador',
  socio_administrador: 'sócio-administrador',
};

function administra(q: QualificacaoQsa): boolean {
  return q === 'administrador' || q === 'socio_administrador';
}

function indexarQuadro(f: FornecedorParaVinculos): Map<string, IntegranteQsa> {
  const mapa = new Map<string, IntegranteQsa>();
  for (const i of f.quadro) {
    const chave = chavePessoa(i.documento, i.nome);
    if (chave !== null && !mapa.has(chave)) mapa.set(chave, i);
  }
  return mapa;
}

function exigirFornecedores(lista: readonly FornecedorParaVinculos[], campo: string): void {
  if (!Array.isArray(lista as unknown)) throw new ErroDominio('VINCULOS_INVALIDOS', `${campo} deve ser uma lista.`);
  if (lista.length > 500) throw new ErroDominio('VINCULOS_INVALIDOS', `${campo}: no máximo 500 fornecedores por análise.`);
  const ids = new Set<string>();
  for (const f of lista) {
    if (typeof f.id !== 'string' || f.id.length === 0) throw new ErroDominio('VINCULOS_INVALIDOS', `${campo}: fornecedor sem id.`);
    if (ids.has(f.id)) throw new ErroDominio('VINCULOS_INVALIDOS', `${campo}: fornecedor repetido (${f.id}).`);
    ids.add(f.id);
  }
}

const ORDEM_TIPO: readonly TipoSinalVinculo[] = [
  'agente_publico',
  'possivel_sucessao',
  'administrador_comum',
  'socio_comum',
  'vinculo_informado',
  'endereco_comum',
  'contato_comum',
];

function ordenarSinais(sinais: SinalVinculo[]): SinalVinculo[] {
  return sinais.sort(
    (a, b) =>
      (a.nivel === b.nivel ? 0 : a.nivel === 'risco' ? -1 : 1) ||
      ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo) ||
      a.mensagem.localeCompare(b.mensagem, 'pt-BR'),
  );
}

function sinal(dados: Omit<SinalVinculo, 'requerRevisaoHumana' | 'sancaoOrigemId'> & { sancaoOrigemId?: string | null }): SinalVinculo {
  return { ...dados, requerRevisaoHumana: true, sancaoOrigemId: dados.sancaoOrigemId ?? null };
}

/** Grupos de fornecedores ligados entre si por algum sinal (componentes conexos), com dois ou mais membros. */
function agruparFornecedores(sinais: readonly SinalVinculo[]): { fornecedores: { id: string; nome: string }[] }[] {
  const pai = new Map<string, string>();
  const nomes = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r) ?? r;
    pai.set(x, r);
    return r;
  };
  for (const s of sinais) {
    for (const f of s.fornecedores) {
      nomes.set(f.id, f.nome);
      if (!pai.has(f.id)) pai.set(f.id, f.id);
    }
    const [primeiro, ...demais] = s.fornecedores;
    if (!primeiro) continue;
    for (const f of demais) pai.set(raiz(f.id), raiz(primeiro.id));
  }
  const grupos = new Map<string, { id: string; nome: string }[]>();
  for (const id of pai.keys()) {
    const r = raiz(id);
    const lista = grupos.get(r) ?? [];
    lista.push({ id, nome: nomes.get(id) ?? id });
    grupos.set(r, lista);
  }
  return [...grupos.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ fornecedores: g.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }));
}

// ───────────────────────── RIA-06 e RIA-10: vínculos entre licitantes e com agentes ─────────────────────────

/**
 * Sinais de vínculo entre os licitantes e com os agentes públicos do processo (RIA-06 e RIA-10).
 * - RIA-06 (quadro societário): sócio ou administrador em comum entre licitantes (art. 14, V; art. 155, IX e XI) e
 *   agente público da equipe no quadro de um licitante (art. 9º, § 1º, e art. 14, IV).
 * - RIA-10 (demais fontes lícitas): endereço ou contato de cadastro em comum; vínculos declarados ou informados com
 *   evidência entre licitantes; vínculo de agente público com licitante, inclusive parentesco até o 3º grau e
 *   cônjuge ou companheiro (art. 14, IV). Vínculo de agente que não integra a equipe vira sinal de atenção,
 *   para verificar se é dirigente do órgão.
 * Sem `agentes`, a análise não conhece a equipe e trata todo vínculo com agente público como sinal de atenção.
 * Sinal para análise humana: nunca desclassifica nem impede.
 */
export function sinalizarVinculosLicitantes(e: {
  licitantes: readonly FornecedorParaVinculos[];
  vinculosInformados: readonly VinculoInformado[];
  agentes?: readonly AgenteParaVinculos[];
}): {
  sinais: SinalVinculo[];
  grupos: { fornecedores: { id: string; nome: string }[] }[];
  aviso: string;
  premissas: string[];
  fundamento: string;
} {
  exigirFornecedores(e.licitantes, 'licitantes');
  if (!Array.isArray(e.vinculosInformados as unknown)) throw new ErroDominio('VINCULOS_INVALIDOS', 'vinculosInformados deve ser uma lista.');
  const porId = new Map(e.licitantes.map((f) => [f.id, f]));
  const quadros = new Map(e.licitantes.map((f) => [f.id, indexarQuadro(f)]));
  const sinais: SinalVinculo[] = [];
  const ref = (f: FornecedorParaVinculos) => ({ id: f.id, nome: f.nome });

  // Pares de licitantes: quadro societário, endereço e contato do cadastro.
  e.licitantes.forEach((a, i) => {
    for (const b of e.licitantes.slice(i + 1)) {
      const qa = quadros.get(a.id) ?? new Map<string, IntegranteQsa>();
      const qb = quadros.get(b.id) ?? new Map<string, IntegranteQsa>();
      const comuns: { pessoa: IntegranteQsa; emA: IntegranteQsa; emB: IntegranteQsa }[] = [];
      for (const [chave, emA] of qa) {
        const emB = qb.get(chave);
        if (emB) comuns.push({ pessoa: emA, emA, emB });
      }
      if (comuns.length > 0) {
        const administrador = comuns.some((c) => administra(c.emA.qualificacao) && administra(c.emB.qualificacao));
        const pessoas = comuns.map((c) => pessoaMascarada(c.pessoa.nome, c.pessoa.documento));
        sinais.push(
          sinal({
            regra: 'RIA-06',
            tipo: administrador ? 'administrador_comum' : 'socio_comum',
            nivel: 'risco',
            fornecedores: [ref(a), ref(b)],
            agente: null,
            mensagem: `${a.nome} e ${b.nome} têm ${administrador ? 'administrador' : 'sócio'} em comum (${pessoas.join('; ')}): sinal de possível conluio para análise, não constitui acusação.`,
            evidencias: comuns.map((c) => ({
              fonte: 'qsa_receita',
              descricao: `${pessoaMascarada(c.pessoa.nome, c.pessoa.documento)}: ${ROTULO_QUALIFICACAO[c.emA.qualificacao]} de ${a.nome} e ${ROTULO_QUALIFICACAO[c.emB.qualificacao]} de ${b.nome}.`,
            })),
            fundamento: FUNDAMENTO_ENTRE_LICITANTES,
          }),
        );
      }
      const enderecoA = a.endereco === null ? null : normalizarEndereco(a.endereco);
      if (enderecoA !== null && b.endereco !== null && enderecoA === normalizarEndereco(b.endereco)) {
        sinais.push(
          sinal({
            regra: 'RIA-10',
            tipo: 'endereco_comum',
            nivel: 'atencao',
            fornecedores: [ref(a), ref(b)],
            agente: null,
            mensagem: `${a.nome} e ${b.nome} declaram o mesmo endereço no cadastro do CNPJ: verifique se são empresas independentes.`,
            evidencias: [{ fonte: 'qsa_receita', descricao: `Endereço de ambas no cadastro do CNPJ: ${a.endereco}.` }],
            fundamento: FUNDAMENTO_ENTRE_LICITANTES,
          }),
        );
      }
      const evidenciasContato: EvidenciaVinculo[] = [];
      const telA = telefoneComparavel(a.telefone);
      if (telA !== null && telA === telefoneComparavel(b.telefone)) {
        evidenciasContato.push({ fonte: 'cadastro_fornecedor', descricao: `Mesmo telefone de contato: ${telefoneSeguro(telA)}.` });
      }
      const emailA = emailComparavel(a.email);
      if (emailA !== null && emailA === emailComparavel(b.email)) {
        evidenciasContato.push({ fonte: 'cadastro_fornecedor', descricao: `Mesmo e-mail de contato: ${emailSeguro(emailA)}.` });
      }
      if (evidenciasContato.length > 0) {
        sinais.push(
          sinal({
            regra: 'RIA-10',
            tipo: 'contato_comum',
            nivel: 'atencao',
            fornecedores: [ref(a), ref(b)],
            agente: null,
            mensagem: `${a.nome} e ${b.nome} usam o mesmo contato no cadastro: verifique se as propostas foram elaboradas de forma independente.`,
            evidencias: evidenciasContato,
            fundamento: FUNDAMENTO_ENTRE_LICITANTES,
          }),
        );
      }
    }
  });

  // Vínculos declarados ou informados com evidência.
  const equipe = e.agentes === undefined ? null : new Map(e.agentes.map((x) => [x.usuarioId, x]));
  for (const v of e.vinculosInformados) {
    const f = porId.get(v.fornecedorId);
    const descricaoVinculo = `${ROTULO_NATUREZA[v.natureza]}${v.grauParentesco !== null ? ` de ${v.grauParentesco}º grau` : ''}`;
    const evidencia: EvidenciaVinculo = {
      fonte: v.fonte,
      descricao: `${ROTULO_FONTE[v.fonte][0]?.toUpperCase() ?? ''}${ROTULO_FONTE[v.fonte].slice(1)}: ${v.descricao.trim()} Evidência: ${v.evidencia.trim()}`,
    };
    if (v.outroFornecedorId !== null) {
      const outro = porId.get(v.outroFornecedorId);
      if (!f || !outro) continue;
      const grave = v.natureza === 'conjuge' || v.natureza === 'parentesco' || v.natureza === 'societario';
      sinais.push(
        sinal({
          regra: 'RIA-10',
          tipo: 'vinculo_informado',
          nivel: grave ? 'risco' : 'atencao',
          fornecedores: [ref(f), ref(outro)],
          agente: null,
          mensagem: `Vínculo de ${descricaoVinculo} entre ${f.nome} e ${outro.nome}: sinal de possível conluio para análise, não constitui acusação.`,
          evidencias: [evidencia],
          fundamento: FUNDAMENTO_ENTRE_LICITANTES,
        }),
      );
    } else if (v.agente !== null && f) {
      const naEquipe = equipe?.has(v.agente.usuarioId) ?? false;
      sinais.push(
        sinal({
          regra: 'RIA-10',
          tipo: 'agente_publico',
          nivel: naEquipe ? 'risco' : 'atencao',
          fornecedores: [ref(f)],
          agente: v.agente,
          mensagem: naEquipe
            ? `Possível vínculo impeditivo (art. 14, IV): ${v.agente.nome}, que atua neste processo, tem ${descricaoVinculo} com ${f.nome}. Requer apuração humana antes de qualquer providência.`
            : `${v.agente.nome}, agente público do órgão, tem ${descricaoVinculo} com ${f.nome}. ${equipe === null ? 'Verifique se o agente atua na licitação, na gestão ou na fiscalização do contrato, ou se é dirigente do órgão (art. 14, IV).' : 'O agente não integra a equipe deste processo: verifique se é dirigente do órgão (art. 14, IV).'}`,
          evidencias: [evidencia],
          fundamento: FUNDAMENTO_AGENTE,
        }),
      );
    }
  }

  // Agente da equipe no quadro societário de licitante (comparação pelo CPF).
  for (const agente of e.agentes ?? []) {
    const cpfAgente = somenteDigitos(agente.cpf);
    const chaveAgente = chavePessoa(agente.cpf, agente.nome);
    for (const f of e.licitantes) {
      const integrante = f.quadro.find((i) => {
        const d = somenteDigitos(i.documento);
        if (d.length === 11) return cpfAgente.length === 11 && d === cpfAgente;
        return chaveAgente !== null && chavePessoa(i.documento, i.nome) === chaveAgente;
      });
      if (!integrante) continue;
      sinais.push(
        sinal({
          regra: 'RIA-06',
          tipo: 'agente_publico',
          nivel: 'risco',
          fornecedores: [ref(f)],
          agente: { usuarioId: agente.usuarioId, nome: agente.nome },
          mensagem: `O CPF de ${agente.nome}, que atua neste processo, consta do quadro societário de ${f.nome}: possível impedimento (art. 9º, § 1º, e art. 14, IV) para análise, não constitui acusação.`,
          evidencias: [
            {
              fonte: 'qsa_receita',
              descricao: `${pessoaMascarada(integrante.nome, integrante.documento)} figura como ${ROTULO_QUALIFICACAO[integrante.qualificacao]} de ${f.nome}.`,
            },
          ],
          fundamento: FUNDAMENTO_AGENTE,
        }),
      );
    }
  }

  const ordenados = ordenarSinais(sinais);
  return {
    sinais: ordenados,
    grupos: agruparFornecedores(ordenados),
    aviso: AVISO_SINAIS_VINCULO,
    premissas: [...PREMISSAS_SINAIS_VINCULO],
    fundamento: 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV e V',
  };
}

// ───────────────────────── RIA-10: possível sucessão de empresa sancionada ─────────────────────────

export interface SancaoParaSucessao {
  id: string;
  tipo: 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';
  situacao: 'em_instrucao' | 'defesa' | 'decisao' | 'aplicada' | 'arquivada';
  instauradaEm: DataISO;
  fimVigencia: DataISO | null;
}

/** Meses antes da instauração do processo sancionatório em que a abertura da empresa ainda é considerada "nova" (critério da Ágora). */
export const MESES_ANTES_SANCAO_PADRAO = 12;

function impeditivaVigente(s: SancaoParaSucessao, hoje: DataISO): boolean {
  return (
    (s.tipo === 'impedimento_licitar' || s.tipo === 'declaracao_inidoneidade') &&
    s.situacao === 'aplicada' &&
    (s.fimVigencia === null || s.fimVigencia >= hoje)
  );
}

const ROTULO_SANCAO_SUCESSAO: Record<'impedimento_licitar' | 'declaracao_inidoneidade', string> = {
  impedimento_licitar: 'impedimento de licitar e contratar',
  declaracao_inidoneidade: 'declaração de inidoneidade',
};

/**
 * Possível sucessão de empresa sancionada (RIA-10): empresa com sócio, administrador ou endereço em comum com
 * fornecedor que cumpre impedimento ou inidoneidade (art. 156, §§ 4º e 5º). É "risco" quando a empresa foi aberta
 * depois da instauração do processo sancionatório ou até `mesesAntes` meses antes dela; "atenção" nos demais casos.
 * O impedimento só alcança quem atua em substituição para burlar a sanção, "desde que devidamente comprovado" (art.
 * 14, § 1º), e a extensão dos efeitos exige processo com contraditório, ampla defesa e análise jurídica prévia
 * (art. 160): o sinal é o ponto de partida dessa apuração, nunca a decisão.
 */
export function detectarPossivelSucessao(e: {
  candidatos: readonly FornecedorParaVinculos[];
  sancionadas: readonly { fornecedor: FornecedorParaVinculos; sancao: SancaoParaSucessao }[];
  hoje: DataISO;
  mesesAntes?: number;
}): { sinais: SinalVinculo[]; aviso: string; fundamento: string } {
  lerData(e.hoje, 'hoje');
  exigirFornecedores(e.candidatos, 'candidatos');
  if (!Array.isArray(e.sancionadas as unknown)) throw new ErroDominio('VINCULOS_INVALIDOS', 'sancionadas deve ser uma lista.');
  const mesesAntes = e.mesesAntes ?? MESES_ANTES_SANCAO_PADRAO;
  if (!Number.isInteger(mesesAntes) || mesesAntes < 0 || mesesAntes > 120) {
    throw new ErroDominio('VINCULOS_INVALIDOS', 'mesesAntes deve ser um inteiro de 0 a 120.');
  }
  const sinais: SinalVinculo[] = [];
  for (const { fornecedor: punida, sancao } of e.sancionadas) {
    if (!impeditivaVigente(sancao, e.hoje)) continue;
    lerData(sancao.instauradaEm, 'instauradaEm');
    const quadroPunida = indexarQuadro(punida);
    const enderecoPunida = punida.endereco === null ? null : normalizarEndereco(punida.endereco);
    const limite = adicionarMeses(sancao.instauradaEm, -mesesAntes);
    const rotuloSancao = ROTULO_SANCAO_SUCESSAO[sancao.tipo as 'impedimento_licitar' | 'declaracao_inidoneidade'];
    for (const c of e.candidatos) {
      if (c.id === punida.id) continue;
      const evidencias: EvidenciaVinculo[] = [];
      const partes: string[] = [];
      for (const [chave, integrante] of indexarQuadro(c)) {
        const naPunida = quadroPunida.get(chave);
        if (!naPunida) continue;
        evidencias.push({
          fonte: 'qsa_receita',
          descricao: `${pessoaMascarada(integrante.nome, integrante.documento)}: ${ROTULO_QUALIFICACAO[integrante.qualificacao]} de ${c.nome} e ${ROTULO_QUALIFICACAO[naPunida.qualificacao]} de ${punida.nome}.`,
        });
        partes.push(administra(naPunida.qualificacao) ? 'administrador' : 'sócio');
      }
      if (enderecoPunida !== null && c.endereco !== null && normalizarEndereco(c.endereco) === enderecoPunida) {
        evidencias.push({ fonte: 'qsa_receita', descricao: `Mesmo endereço no cadastro do CNPJ: ${c.endereco}.` });
        partes.push('endereço');
      }
      if (evidencias.length === 0) continue;
      const nova = c.dataAbertura !== null && c.dataAbertura >= limite;
      if (c.dataAbertura !== null) {
        evidencias.push({
          fonte: 'qsa_receita',
          descricao: `${c.nome} foi aberta em ${formatarData(c.dataAbertura)}; o processo sancionatório de ${punida.nome} foi instaurado em ${formatarData(sancao.instauradaEm)}.`,
        });
      }
      const emComum = [...new Set(partes)].join(', ').replace(/, ([^,]*)$/, ' e $1');
      sinais.push(
        sinal({
          regra: 'RIA-10',
          tipo: 'possivel_sucessao',
          nivel: nova ? 'risco' : 'atencao',
          fornecedores: [
            { id: c.id, nome: c.nome },
            { id: punida.id, nome: punida.nome },
          ],
          agente: null,
          mensagem: `${c.nome} tem ${emComum} em comum com ${punida.nome}, que cumpre ${rotuloSancao}${sancao.fimVigencia ? ` até ${formatarData(sancao.fimVigencia)}` : ''}.${nova ? ' A empresa foi aberta perto ou depois da instauração do processo sancionatório.' : ''} Possível sucessão para burlar a sanção (art. 14, § 1º): sinal para análise; estender a sanção exige processo próprio, com contraditório, ampla defesa e análise jurídica prévia (art. 160).`,
          evidencias,
          fundamento: FUNDAMENTO_SUCESSAO,
          sancaoOrigemId: sancao.id,
        }),
      );
    }
  }
  return { sinais: ordenarSinais(sinais), aviso: AVISO_SINAIS_VINCULO, fundamento: FUNDAMENTO_SUCESSAO };
}
