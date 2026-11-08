/**
 * Segregação de funções (Lei 14.133/2021, art. 7º, § 1º) e vínculo societário de agentes públicos
 * com fornecedores (art. 9º, § 1º, e art. 14, IV). Os conflitos de vínculo são sinais para análise, não acusação.
 */
import { ErroDominio } from '../erros.ts';
import { formatarCnpj, somenteDigitos } from '../documentos.ts';

export type PapelProcesso =
  | 'requisitante'
  | 'equipe_planejamento'
  | 'agente_contratacao'
  | 'pregoeiro'
  | 'comissao_contratacao'
  | 'autoridade_competente'
  | 'gestor_contrato'
  | 'fiscal_tecnico'
  | 'fiscal_administrativo'
  | 'parecerista_juridico';

export interface Designacao {
  papel: PapelProcesso;
  servidorId: string;
  nome: string;
  cpf?: string;
}

const PAPEIS: readonly PapelProcesso[] = [
  'requisitante',
  'equipe_planejamento',
  'agente_contratacao',
  'pregoeiro',
  'comissao_contratacao',
  'autoridade_competente',
  'gestor_contrato',
  'fiscal_tecnico',
  'fiscal_administrativo',
  'parecerista_juridico',
];

const ROTULOS: Record<PapelProcesso, string> = {
  requisitante: 'requisitante',
  equipe_planejamento: 'equipe de planejamento',
  agente_contratacao: 'agente de contratação',
  pregoeiro: 'pregoeiro',
  comissao_contratacao: 'comissão de contratação',
  autoridade_competente: 'autoridade competente',
  gestor_contrato: 'gestor do contrato',
  fiscal_tecnico: 'fiscal técnico',
  fiscal_administrativo: 'fiscal administrativo',
  parecerista_juridico: 'parecerista jurídico',
};

const MOTIVO_PLANEJAMENTO_SELECAO =
  'Quem elabora os artefatos do planejamento (ETP, termo de referência, pesquisa de preços) não deve conduzir a seleção que julga as propostas com base neles.';
const MOTIVO_SELECAO_FISCALIZACAO = 'Quem conduz a seleção do fornecedor não deve fiscalizar a execução do contrato dela resultante.';
const MOTIVO_SELECAO_HOMOLOGACAO =
  'Quem conduz o certame não deve homologar ou adjudicar o próprio trabalho: a autoridade competente exerce o controle sobre a condução.';
const MOTIVO_PARECERISTA =
  'O órgão de assessoramento jurídico realiza o controle prévio de legalidade (art. 53) e não deve exercer funções que ele próprio controla.';

const PARES_BASE: readonly { a: PapelProcesso; b: PapelProcesso; motivo: string }[] = [
  { a: 'equipe_planejamento', b: 'agente_contratacao', motivo: MOTIVO_PLANEJAMENTO_SELECAO },
  { a: 'equipe_planejamento', b: 'pregoeiro', motivo: MOTIVO_PLANEJAMENTO_SELECAO },
  { a: 'equipe_planejamento', b: 'comissao_contratacao', motivo: MOTIVO_PLANEJAMENTO_SELECAO },
  { a: 'agente_contratacao', b: 'fiscal_tecnico', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'agente_contratacao', b: 'fiscal_administrativo', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'pregoeiro', b: 'fiscal_tecnico', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'pregoeiro', b: 'fiscal_administrativo', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'comissao_contratacao', b: 'fiscal_tecnico', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'comissao_contratacao', b: 'fiscal_administrativo', motivo: MOTIVO_SELECAO_FISCALIZACAO },
  { a: 'agente_contratacao', b: 'autoridade_competente', motivo: MOTIVO_SELECAO_HOMOLOGACAO },
  { a: 'pregoeiro', b: 'autoridade_competente', motivo: MOTIVO_SELECAO_HOMOLOGACAO },
  { a: 'comissao_contratacao', b: 'autoridade_competente', motivo: MOTIVO_SELECAO_HOMOLOGACAO },
  {
    a: 'gestor_contrato',
    b: 'fiscal_tecnico',
    motivo: 'Gestão e fiscalização técnica do contrato são funções de controle recíproco: quem gere não deve atestar tecnicamente a execução.',
  },
];

/** Pares de papéis que o mesmo agente público não pode acumular no mesmo processo. */
export const PARES_CONFLITANTES: readonly { a: PapelProcesso; b: PapelProcesso; motivo: string }[] = Object.freeze([
  ...PARES_BASE,
  ...PAPEIS.filter((p) => p !== 'parecerista_juridico').map((p) => ({ a: 'parecerista_juridico' as const, b: p, motivo: MOTIVO_PARECERISTA })),
]);

function parConflitante(x: PapelProcesso, y: PapelProcesso): { a: PapelProcesso; b: PapelProcesso; motivo: string } | undefined {
  return PARES_CONFLITANTES.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

/**
 * Verifica acúmulo de funções conflitantes por servidor (um conflito por par) e, se informados os sócios
 * de fornecedores, o CPF de designado que conste do quadro societário (comparando só os dígitos).
 */
export function verificarSegregacao(
  designacoes: Designacao[],
  opcoes?: { sociosFornecedores?: { cnpj: string; razaoSocial: string; cpfsSocios: string[] }[] },
): {
  valido: boolean;
  conflitos: {
    tipo: 'acumulo_funcoes' | 'vinculo_societario';
    servidorId: string;
    nome: string;
    papeis: PapelProcesso[];
    descricao: string;
    fundamento: string;
  }[];
} {
  if (!Array.isArray(designacoes)) throw new ErroDominio('SEGREGACAO_INVALIDA', 'designacoes deve ser uma lista.');
  const porServidor = new Map<string, { nome: string; papeis: PapelProcesso[]; cpfs: Set<string> }>();
  for (const d of designacoes) {
    if (!PAPEIS.includes(d.papel)) throw new ErroDominio('SEGREGACAO_INVALIDA', `Papel inválido: ${String(d.papel)}.`);
    if (typeof d.servidorId !== 'string' || d.servidorId.length === 0) {
      throw new ErroDominio('SEGREGACAO_INVALIDA', 'Designação sem servidorId.');
    }
    const registro = porServidor.get(d.servidorId) ?? { nome: d.nome, papeis: [], cpfs: new Set<string>() };
    if (!registro.papeis.includes(d.papel)) registro.papeis.push(d.papel);
    if (typeof d.cpf === 'string' && somenteDigitos(d.cpf).length > 0) registro.cpfs.add(somenteDigitos(d.cpf));
    porServidor.set(d.servidorId, registro);
  }

  const conflitos: {
    tipo: 'acumulo_funcoes' | 'vinculo_societario';
    servidorId: string;
    nome: string;
    papeis: PapelProcesso[];
    descricao: string;
    fundamento: string;
  }[] = [];

  for (const [servidorId, r] of porServidor) {
    for (let i = 0; i < r.papeis.length; i += 1) {
      for (let j = i + 1; j < r.papeis.length; j += 1) {
        const x = r.papeis[i];
        const y = r.papeis[j];
        if (x === undefined || y === undefined) continue;
        const par = parConflitante(x, y);
        if (par === undefined) continue;
        conflitos.push({
          tipo: 'acumulo_funcoes',
          servidorId,
          nome: r.nome,
          papeis: [x, y],
          descricao: `${r.nome} foi designado(a) como ${ROTULOS[x]} e ${ROTULOS[y]}. ${par.motivo}`,
          fundamento: 'Lei 14.133/2021, art. 7º, § 1º',
        });
      }
    }
  }

  for (const fornecedor of opcoes?.sociosFornecedores ?? []) {
    const socios = new Set(fornecedor.cpfsSocios.map(somenteDigitos).filter((c) => c.length > 0));
    const cnpjDigitos = somenteDigitos(fornecedor.cnpj);
    const cnpj = cnpjDigitos.length === 14 ? formatarCnpj(cnpjDigitos) : fornecedor.cnpj;
    for (const [servidorId, r] of porServidor) {
      if (![...r.cpfs].some((cpf) => socios.has(cpf))) continue;
      conflitos.push({
        tipo: 'vinculo_societario',
        servidorId,
        nome: r.nome,
        papeis: [...r.papeis],
        descricao: `O CPF de ${r.nome} consta do quadro societário de ${fornecedor.razaoSocial} (CNPJ ${cnpj}). Sinal para análise, não constitui acusação: verifique o impedimento antes de manter a designação ou a participação do fornecedor.`,
        fundamento: 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV',
      });
    }
  }

  return { valido: conflitos.length === 0, conflitos };
}
