/**
 * Infrações e sanções administrativas (Lei 14.133/2021, arts. 155 a 163).
 * As funções aqui produzem apoio à decisão: a sanção é aplicada pela autoridade competente,
 * após processo com contraditório e ampla defesa.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, contarPrazo } from '../datas.ts';
import { type Centavos, aplicarPercentual, formatarMoeda } from '../moeda.ts';
import { adicionarMeses, arredondar, exigirFinito, exigirInteiro, formatarNumero, lerData } from '../interno.ts';

export type IncisoInfracao = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII' | 'IX' | 'X' | 'XI' | 'XII';

/** Infrações do art. 155 da Lei 14.133/2021. */
export const INFRACOES_ART_155: readonly { inciso: IncisoInfracao; descricao: string }[] = Object.freeze([
  { inciso: 'I', descricao: 'Dar causa à inexecução parcial do contrato' },
  {
    inciso: 'II',
    descricao: 'Dar causa à inexecução parcial do contrato que cause grave dano à Administração, ao funcionamento dos serviços públicos ou ao interesse coletivo',
  },
  { inciso: 'III', descricao: 'Dar causa à inexecução total do contrato' },
  { inciso: 'IV', descricao: 'Deixar de entregar a documentação exigida para o certame' },
  { inciso: 'V', descricao: 'Não manter a proposta, salvo em decorrência de fato superveniente devidamente justificado' },
  {
    inciso: 'VI',
    descricao: 'Não celebrar o contrato ou não entregar a documentação exigida para a contratação, quando convocado dentro do prazo de validade de sua proposta',
  },
  { inciso: 'VII', descricao: 'Ensejar o retardamento da execução ou da entrega do objeto da licitação sem motivo justificado' },
  {
    inciso: 'VIII',
    descricao: 'Apresentar declaração ou documentação falsa exigida para o certame ou prestar declaração falsa durante a licitação ou a execução do contrato',
  },
  { inciso: 'IX', descricao: 'Fraudar a licitação ou praticar ato fraudulento na execução do contrato' },
  { inciso: 'X', descricao: 'Comportar-se de modo inidôneo ou cometer fraude de qualquer natureza' },
  { inciso: 'XI', descricao: 'Praticar atos ilícitos com vistas a frustrar os objetivos da licitação' },
  { inciso: 'XII', descricao: 'Praticar ato lesivo previsto no art. 5º da Lei 12.846/2013' },
]);

export type TipoSancao = 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';

const INCISOS_IMPEDIMENTO: readonly IncisoInfracao[] = ['II', 'III', 'IV', 'V', 'VI', 'VII'];
const INCISOS_INIDONEIDADE_DIRETA: readonly IncisoInfracao[] = ['VIII', 'IX', 'X', 'XI', 'XII'];

function exigirInciso(inciso: IncisoInfracao): void {
  if (!INFRACOES_ART_155.some((i) => i.inciso === inciso)) {
    throw new ErroDominio('INCISO_INVALIDO', `Inciso do art. 155 inválido: ${String(inciso)}.`);
  }
}

/**
 * Sanções cabíveis para a infração (art. 156): advertência só para o inciso I (§ 2º); multa para qualquer
 * inciso (§ 3º); impedimento de licitar e contratar para II a VII (§ 4º); declaração de inidoneidade para
 * VIII a XII e para II a VII quando se justificar penalidade mais grave (§ 5º).
 */
export function sancoesCabiveis(inciso: IncisoInfracao): { tipo: TipoSancao; condicao: string; fundamento: string }[] {
  exigirInciso(inciso);
  const resultado: { tipo: TipoSancao; condicao: string; fundamento: string }[] = [];
  if (inciso === 'I') {
    resultado.push({
      tipo: 'advertencia',
      condicao: 'Aplicável exclusivamente à infração do inciso I do art. 155, quando não se justificar a imposição de penalidade mais grave.',
      fundamento: 'Lei 14.133/2021, art. 156, § 2º',
    });
  }
  resultado.push({
    tipo: 'multa',
    condicao: 'Aplicável a qualquer das infrações do art. 155, calculada na forma do edital ou do contrato, entre 0,5% e 30% do valor do contrato licitado ou celebrado com contratação direta.',
    fundamento: 'Lei 14.133/2021, art. 156, § 3º',
  });
  if (INCISOS_IMPEDIMENTO.includes(inciso)) {
    resultado.push({
      tipo: 'impedimento_licitar',
      condicao: 'Quando não se justificar a imposição de penalidade mais grave; impede o responsável de licitar ou contratar no âmbito da Administração Pública direta e indireta do ente federativo que aplicou a sanção, pelo prazo máximo de 3 anos.',
      fundamento: 'Lei 14.133/2021, art. 156, § 4º',
    });
    resultado.push({
      tipo: 'declaracao_inidoneidade',
      condicao: 'Quando se justificar a imposição de penalidade mais grave que o impedimento; impede o responsável de licitar ou contratar no âmbito da Administração Pública direta e indireta de todos os entes federativos, pelo prazo mínimo de 3 e máximo de 6 anos.',
      fundamento: 'Lei 14.133/2021, art. 156, § 5º',
    });
  }
  if (INCISOS_INIDONEIDADE_DIRETA.includes(inciso)) {
    resultado.push({
      tipo: 'declaracao_inidoneidade',
      condicao: 'Impede o responsável de licitar ou contratar no âmbito da Administração Pública direta e indireta de todos os entes federativos, pelo prazo mínimo de 3 e máximo de 6 anos.',
      fundamento: 'Lei 14.133/2021, art. 156, § 5º',
    });
  }
  return resultado;
}

export type Gravidade = 'leve' | 'media' | 'grave' | 'gravissima';

/** Pontos percentuais usados na proposta de dosimetria da multa. */
export interface ParametrosDosimetria {
  base: Record<Gravidade, number>;
  porAgravante: number;
  porAtenuante: number;
  programaIntegridade: number;
  danoAdministracao: number;
}

/**
 * Parâmetros ILUSTRATIVOS de dosimetria (em pontos percentuais do valor do contrato).
 * Não decorrem da lei: o órgão deve definir os seus em ato normativo próprio e informá-los em `parametros`.
 */
export const PARAMETROS_DOSIMETRIA_PADRAO: ParametrosDosimetria = Object.freeze({
  base: Object.freeze({ leve: 1, media: 5, grave: 10, gravissima: 20 }),
  porAgravante: 2,
  porAtenuante: 1,
  programaIntegridade: 2,
  danoAdministracao: 3,
});

const GRAVIDADES: readonly Gravidade[] = ['leve', 'media', 'grave', 'gravissima'];
const MULTA_MINIMA_PCT = 0.5;
const MULTA_MAXIMA_PCT = 30;
const AVISO_DOSIMETRIA =
  'Proposta de dosimetria para apoio à decisão. A sanção é aplicada pela autoridade competente após processo com contraditório e ampla defesa (arts. 157 e 158).';

function pp(n: number): string {
  return `${formatarNumero(n)} p.p.`;
}

/**
 * Proposta de percentual de multa:
 * pct = base[gravidade] + agravantes × porAgravante − atenuantes × porAtenuante − (programa de integridade) + (dano à Administração),
 * aplicado entre 0,5% e 30% do valor do contrato (art. 156, § 3º).
 */
export function calcularDosimetriaMulta(e: {
  valorContrato: Centavos;
  gravidade: Gravidade;
  agravantes: string[];
  atenuantes: string[];
  programaIntegridade: boolean;
  danoAdministracao: boolean;
  parametros?: ParametrosDosimetria;
}): {
  percentualCalculado: number;
  percentualAplicado: number;
  valorMulta: Centavos;
  limitado: 'minimo' | 'maximo' | null;
  memoriaCalculo: string[];
  fundamento: string;
  aviso: string;
} {
  exigirInteiro(e.valorContrato, 'valorContrato', 'DOSIMETRIA_INVALIDA', 1);
  if (!GRAVIDADES.includes(e.gravidade)) throw new ErroDominio('DOSIMETRIA_INVALIDA', `Gravidade inválida: ${String(e.gravidade)}.`);
  if (!Array.isArray(e.agravantes) || !Array.isArray(e.atenuantes)) {
    throw new ErroDominio('DOSIMETRIA_INVALIDA', 'agravantes e atenuantes devem ser listas.');
  }
  const p = e.parametros ?? PARAMETROS_DOSIMETRIA_PADRAO;
  for (const g of GRAVIDADES) exigirFinito(p.base[g], `parametros.base.${g}`, 'DOSIMETRIA_INVALIDA');
  exigirFinito(p.porAgravante, 'parametros.porAgravante', 'DOSIMETRIA_INVALIDA');
  exigirFinito(p.porAtenuante, 'parametros.porAtenuante', 'DOSIMETRIA_INVALIDA');
  exigirFinito(p.programaIntegridade, 'parametros.programaIntegridade', 'DOSIMETRIA_INVALIDA');
  exigirFinito(p.danoAdministracao, 'parametros.danoAdministracao', 'DOSIMETRIA_INVALIDA');

  const base = p.base[e.gravidade];
  const somaAgravantes = e.agravantes.length * p.porAgravante;
  const somaAtenuantes = e.atenuantes.length * p.porAtenuante;
  const reducaoIntegridade = e.programaIntegridade ? p.programaIntegridade : 0;
  const acrescimoDano = e.danoAdministracao ? p.danoAdministracao : 0;
  const percentualCalculado = arredondar(base + somaAgravantes - somaAtenuantes - reducaoIntegridade + acrescimoDano, 4);

  let limitado: 'minimo' | 'maximo' | null = null;
  let percentualAplicado = percentualCalculado;
  if (percentualCalculado < MULTA_MINIMA_PCT) {
    limitado = 'minimo';
    percentualAplicado = MULTA_MINIMA_PCT;
  } else if (percentualCalculado > MULTA_MAXIMA_PCT) {
    limitado = 'maximo';
    percentualAplicado = MULTA_MAXIMA_PCT;
  }
  const valorMulta = aplicarPercentual(e.valorContrato, percentualAplicado);

  const circunstancias = (rotulo: string, itens: string[], peso: number, sinal: '+' | '−', total: number): string =>
    itens.length === 0
      ? `${rotulo}: nenhuma informada (0 p.p.)`
      : `${rotulo} (${itens.length} × ${pp(peso)}): ${sinal}${pp(total)} — ${itens.join('; ')}`;
  const memoriaCalculo = [
    'Considerados, nos termos do art. 156, § 1º: a natureza e a gravidade da infração; as peculiaridades do caso concreto; as circunstâncias agravantes ou atenuantes; os danos que dela provierem para a Administração Pública; e a implantação ou o aperfeiçoamento de programa de integridade.',
    `Percentual-base pela gravidade "${e.gravidade}": ${pp(base)}`,
    circunstancias('Agravantes', e.agravantes, p.porAgravante, '+', somaAgravantes),
    circunstancias('Atenuantes', e.atenuantes, p.porAtenuante, '−', somaAtenuantes),
    e.programaIntegridade
      ? `Programa de integridade implantado ou aperfeiçoado: −${pp(reducaoIntegridade)}`
      : 'Programa de integridade: não comprovado (sem redução)',
    e.danoAdministracao ? `Dano à Administração: +${pp(acrescimoDano)}` : 'Dano à Administração: não identificado (sem acréscimo)',
    `Percentual calculado: ${formatarNumero(percentualCalculado)}%.`,
    limitado === 'minimo'
      ? `Percentual aplicado: ${formatarNumero(percentualAplicado)}% (elevado ao mínimo legal de 0,5% — art. 156, § 3º).`
      : limitado === 'maximo'
        ? `Percentual aplicado: ${formatarNumero(percentualAplicado)}% (reduzido ao máximo legal de 30% — art. 156, § 3º).`
        : `Percentual aplicado: ${formatarNumero(percentualAplicado)}% (dentro da faixa legal de 0,5% a 30% — art. 156, § 3º).`,
    `Valor proposto da multa: ${formatarMoeda(valorMulta)} (${formatarNumero(percentualAplicado)}% de ${formatarMoeda(e.valorContrato)}).`,
  ];

  return {
    percentualCalculado,
    percentualAplicado,
    valorMulta,
    limitado,
    memoriaCalculo,
    fundamento: 'Lei 14.133/2021, art. 156, §§ 1º e 3º',
    aviso: AVISO_DOSIMETRIA,
  };
}

/** Prazo de defesa: 15 dias úteis contados da intimação (arts. 157 e 158), na forma do art. 183. */
export function prazoDefesa(intimacao: DataISO, opcoes?: OpcoesCalendario): { vencimento: DataISO; fundamento: string } {
  const { vencimento } = contarPrazo(intimacao, 15, 'uteis', opcoes);
  return { vencimento, fundamento: 'Lei 14.133/2021, arts. 157 e 158' };
}

/** Prazo para informar a sanção no CEIS/CNEP: 15 dias úteis contados da aplicação (art. 161). */
export function prazoRegistroCeisCnep(aplicacao: DataISO, opcoes?: OpcoesCalendario): { vencimento: DataISO; fundamento: string } {
  const { vencimento } = contarPrazo(aplicacao, 15, 'uteis', opcoes);
  return { vencimento, fundamento: 'Lei 14.133/2021, art. 161' };
}

/**
 * Data final da sanção: impedimento de 1 a 3 anos (art. 156, § 4º); inidoneidade de 3 a 6 anos (art. 156, § 5º).
 * Anos inteiros; o prazo expira no dia de igual número do início ou, sem correspondência (29/02), no dia
 * imediato (Código Civil, art. 132, § 3º).
 */
export function vigenciaSancao(
  tipo: 'impedimento_licitar' | 'declaracao_inidoneidade',
  inicio: DataISO,
  anos: number,
): { fim: DataISO; fundamento: string } {
  lerData(inicio, 'inicio');
  const faixa = tipo === 'impedimento_licitar' ? { min: 1, max: 3, paragrafo: '§ 4º' } : tipo === 'declaracao_inidoneidade' ? { min: 3, max: 6, paragrafo: '§ 5º' } : null;
  if (faixa === null) throw new ErroDominio('PRAZO_SANCAO_INVALIDO', `Tipo de sanção sem prazo de vigência: ${String(tipo)}.`);
  if (!Number.isInteger(anos) || anos < faixa.min || anos > faixa.max) {
    throw new ErroDominio(
      'PRAZO_SANCAO_INVALIDO',
      `Prazo de ${String(anos)} ${anos === 1 ? 'ano' : 'anos'} fora da faixa legal de ${faixa.min} a ${faixa.max} anos (art. 156, ${faixa.paragrafo}).`,
    );
  }
  return { fim: adicionarMeses(inicio, anos * 12), fundamento: `Lei 14.133/2021, art. 156, ${faixa.paragrafo}` };
}
