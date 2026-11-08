/**
 * Requisitos dos agentes designados e declaração de inexistência de impedimento
 * (Lei 14.133/2021, art. 7º, I a III e § 2º; art. 8º, caput, §§ 2º e 5º; art. 9º, § 1º).
 * A declaração é do próprio agente; a Ágora só confere se ela existe, está em validade e cobre os requisitos do papel.
 */
import { ErroDominio } from '../erros.ts';
import { formatarData, type DataISO } from '../datas.ts';
import { adicionarMeses, lerData } from '../interno.ts';
import type { PapelProcesso } from './segregacao.ts';

export type VinculoFuncional = 'servidor_efetivo' | 'empregado_publico_permanente' | 'cargo_comissao' | 'temporario' | 'outro';

export type CapacitacaoAgente = 'atribuicoes' | 'formacao' | 'certificacao_escola_governo' | 'nenhuma';

export interface DeclaracaoAgente {
  declaradaEm: DataISO;
  /** Art. 7º, III: não é cônjuge, companheiro ou parente até o 3º grau de licitantes ou contratados habituais, nem tem com eles vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil. */
  semParentescoOuVinculo: boolean;
  /** Art. 9º, § 1º: não participa, direta ou indiretamente, da licitação ou da execução do contrato, nem está em conflito de interesses. */
  semConflitoInteresses: boolean;
  vinculo: VinculoFuncional;
  capacitacao: CapacitacaoAgente;
  capacitacaoDescricao: string | null;
}

/** Validade da declaração em meses (critério da Ágora: a lei não fixa prazo; o órgão pode adotar outro). */
export const VALIDADE_DECLARACAO_MESES_PADRAO = 12;

export const VINCULOS_FUNCIONAIS: Readonly<Record<VinculoFuncional, string>> = Object.freeze({
  servidor_efetivo: 'Servidor efetivo',
  empregado_publico_permanente: 'Empregado público dos quadros permanentes',
  cargo_comissao: 'Ocupante de cargo em comissão sem vínculo efetivo',
  temporario: 'Contratado temporário',
  outro: 'Outro vínculo',
});

export const CAPACITACOES_AGENTE: Readonly<Record<CapacitacaoAgente, string>> = Object.freeze({
  atribuicoes: 'Tem atribuições relacionadas a licitações e contratos',
  formacao: 'Tem formação compatível',
  certificacao_escola_governo: 'Tem certificação profissional emitida por escola de governo',
  nenhuma: 'Nenhuma das anteriores',
});

/** Papéis das funções essenciais do art. 7º (inclusive a assessoria jurídica, pelo § 2º). */
const PAPEIS_ART_7: readonly PapelProcesso[] = [
  'equipe_planejamento',
  'agente_contratacao',
  'pregoeiro',
  'comissao_contratacao',
  'gestor_contrato',
  'fiscal_tecnico',
  'fiscal_administrativo',
  'parecerista_juridico',
];

/** Art. 8º, caput e § 5º: agente de contratação e pregoeiro vêm dos quadros permanentes. */
const PAPEIS_VINCULO_OBRIGATORIO: readonly PapelProcesso[] = ['agente_contratacao', 'pregoeiro'];

const EFETIVOS: readonly VinculoFuncional[] = ['servidor_efetivo', 'empregado_publico_permanente'];

export interface ExigenciasPapel {
  capacitacao: boolean;
  vinculoEfetivo: 'obrigatorio' | 'preferencial' | 'nao_aplicavel';
  fundamento: string;
}

/** O que a lei exige de quem ocupa o papel, além da declaração de inexistência de impedimento (exigida de todos). */
export function exigenciasDoPapel(papel: PapelProcesso): ExigenciasPapel {
  if (PAPEIS_VINCULO_OBRIGATORIO.includes(papel)) {
    return { capacitacao: true, vinculoEfetivo: 'obrigatorio', fundamento: 'Lei 14.133/2021, art. 7º, II e III, e art. 8º, caput e § 5º' };
  }
  if (PAPEIS_ART_7.includes(papel)) {
    return { capacitacao: true, vinculoEfetivo: 'preferencial', fundamento: 'Lei 14.133/2021, art. 7º, I a III e § 2º' };
  }
  return { capacitacao: false, vinculoEfetivo: 'nao_aplicavel', fundamento: 'Lei 14.133/2021, art. 9º, § 1º' };
}

/** Valida o conteúdo da declaração antes do registro (capacitação descrita quando informada). */
export function validarDeclaracaoAgente(d: Omit<DeclaracaoAgente, 'declaradaEm'>): void {
  if (!(d.vinculo in VINCULOS_FUNCIONAIS)) throw new ErroDominio('DECLARACAO_INVALIDA', `Vínculo funcional inválido: ${String(d.vinculo)}.`);
  if (!(d.capacitacao in CAPACITACOES_AGENTE)) throw new ErroDominio('DECLARACAO_INVALIDA', `Capacitação inválida: ${String(d.capacitacao)}.`);
  if (d.capacitacao !== 'nenhuma' && (d.capacitacaoDescricao === null || d.capacitacaoDescricao.trim().length < 10)) {
    throw new ErroDominio('DECLARACAO_INVALIDA', 'Descreva a capacitação (cargo, curso, escola de governo ou ano), com pelo menos 10 caracteres.');
  }
}

/**
 * Confere se o agente pode atuar no papel (RN-28):
 * - declaração existente, assinada até hoje e dentro da validade (padrão de 12 meses);
 * - inexistência de parentesco ou vínculo com licitantes ou contratados habituais (art. 7º, III) e de conflito de
 *   interesses (art. 9º, § 1º) — exigida de todos os papéis;
 * - nas funções essenciais do art. 7º (e na assessoria jurídica, § 2º), capacitação (art. 7º, II);
 * - para agente de contratação e pregoeiro, vínculo efetivo ou permanente (art. 8º, caput e § 5º); nos demais
 *   papéis do art. 7º, vínculo não efetivo é só sinal ("preferencialmente", inciso I).
 */
export function verificarDeclaracaoAgente(e: {
  papel: PapelProcesso;
  declaracao: DeclaracaoAgente | null;
  hoje: DataISO;
  validadeMeses?: number;
}): { apto: boolean; validaAte: DataISO | null; pendencias: string[]; sinais: string[]; fundamento: string } {
  lerData(e.hoje, 'hoje');
  const validade = e.validadeMeses ?? VALIDADE_DECLARACAO_MESES_PADRAO;
  if (!Number.isInteger(validade) || validade < 1 || validade > 60) {
    throw new ErroDominio('DECLARACAO_INVALIDA', 'validadeMeses deve ser um inteiro de 1 a 60.');
  }
  const exigencias = exigenciasDoPapel(e.papel);
  const d = e.declaracao;
  if (d === null) {
    return {
      apto: false,
      validaAte: null,
      pendencias: ['Não há declaração de inexistência de impedimento assinada: o agente só atua no processo depois de declarar.'],
      sinais: [],
      fundamento: exigencias.fundamento,
    };
  }
  lerData(d.declaradaEm, 'declaradaEm');
  const validaAte = adicionarMeses(d.declaradaEm, validade);
  const pendencias: string[] = [];
  const sinais: string[] = [];
  if (d.declaradaEm > e.hoje) pendencias.push('A declaração tem data futura.');
  if (validaAte < e.hoje) pendencias.push(`A declaração venceu em ${formatarData(validaAte)}: o agente precisa renová-la.`);
  if (!d.semParentescoOuVinculo) {
    pendencias.push(
      'O agente não declarou a inexistência de casamento, união estável, parentesco até o 3º grau ou vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil com licitantes ou contratados habituais (art. 7º, III).',
    );
  }
  if (!d.semConflitoInteresses) {
    pendencias.push('O agente não declarou a inexistência de conflito de interesses na licitação ou na execução do contrato (art. 9º, § 1º).');
  }
  if (exigencias.capacitacao && d.capacitacao === 'nenhuma') {
    pendencias.push(
      'Sem atribuições em licitações e contratos, formação compatível ou certificação por escola de governo, o agente não preenche o requisito do art. 7º, II.',
    );
  }
  const efetivo = EFETIVOS.includes(d.vinculo);
  if (exigencias.vinculoEfetivo === 'obrigatorio' && !efetivo) {
    pendencias.push('O agente de contratação e o pregoeiro são designados entre servidores efetivos ou empregados públicos dos quadros permanentes (art. 8º, caput e § 5º).');
  }
  if (exigencias.vinculoEfetivo === 'preferencial' && !efetivo) {
    sinais.push('A lei prefere servidor efetivo ou empregado público dos quadros permanentes para esta função (art. 7º, I): registre a justificativa da designação.');
  }
  return { apto: pendencias.length === 0, validaAte, pendencias, sinais, fundamento: exigencias.fundamento };
}

/**
 * Confere a equipe inteira (RN-28), para a designação chamar junto com a segregação de funções (RN-03): cada
 * designação sem declaração válida vira pendência que impede a designação; preferências legais viram sinais.
 */
export function verificarDeclaracoesEquipe(
  designacoes: readonly { papel: PapelProcesso; servidorId: string; nome: string; declaracao: DeclaracaoAgente | null }[],
  hoje: DataISO,
  opcoes?: { validadeMeses?: number },
): {
  valido: boolean;
  pendencias: { servidorId: string; nome: string; papel: PapelProcesso; mensagem: string; fundamento: string }[];
  sinais: { servidorId: string; nome: string; papel: PapelProcesso; mensagem: string; fundamento: string }[];
} {
  if (!Array.isArray(designacoes as unknown)) throw new ErroDominio('DECLARACAO_INVALIDA', 'designacoes deve ser uma lista.');
  const pendencias: { servidorId: string; nome: string; papel: PapelProcesso; mensagem: string; fundamento: string }[] = [];
  const sinais: typeof pendencias = [];
  for (const d of designacoes) {
    const r = verificarDeclaracaoAgente({ papel: d.papel, declaracao: d.declaracao, hoje, validadeMeses: opcoes?.validadeMeses });
    for (const p of r.pendencias) pendencias.push({ servidorId: d.servidorId, nome: d.nome, papel: d.papel, mensagem: `${d.nome}: ${p}`, fundamento: r.fundamento });
    for (const s of r.sinais) sinais.push({ servidorId: d.servidorId, nome: d.nome, papel: d.papel, mensagem: `${d.nome}: ${s}`, fundamento: r.fundamento });
  }
  return { valido: pendencias.length === 0, pendencias, sinais };
}
