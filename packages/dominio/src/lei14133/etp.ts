/**
 * Estudo Técnico Preliminar (Lei 14.133/2021, art. 18, §§ 1º e 2º).
 * O ETP deve conter ao menos os elementos dos incisos I, IV, VI, VIII e XIII do § 1º; quando não contemplar
 * os demais, deve apresentar as devidas justificativas (§ 2º).
 */
import { ErroDominio } from '../erros.ts';
import { percentual } from '../moeda.ts';
import { exigirInteiro } from '../interno.ts';

export type IncisoEtp = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII' | 'IX' | 'X' | 'XI' | 'XII' | 'XIII';

export const INCISOS_ETP: readonly { inciso: IncisoEtp; titulo: string; obrigatorio: boolean }[] = Object.freeze([
  { inciso: 'I', titulo: 'Descrição da necessidade da contratação', obrigatorio: true },
  { inciso: 'II', titulo: 'Previsão no plano de contratações anual', obrigatorio: false },
  { inciso: 'III', titulo: 'Requisitos da contratação', obrigatorio: false },
  { inciso: 'IV', titulo: 'Estimativas das quantidades e memórias de cálculo', obrigatorio: true },
  { inciso: 'V', titulo: 'Levantamento de mercado', obrigatorio: false },
  { inciso: 'VI', titulo: 'Estimativa do valor da contratação', obrigatorio: true },
  { inciso: 'VII', titulo: 'Descrição da solução como um todo', obrigatorio: false },
  { inciso: 'VIII', titulo: 'Justificativas para o parcelamento ou não', obrigatorio: true },
  { inciso: 'IX', titulo: 'Demonstrativo dos resultados pretendidos', obrigatorio: false },
  { inciso: 'X', titulo: 'Providências prévias à celebração do contrato', obrigatorio: false },
  { inciso: 'XI', titulo: 'Contratações correlatas e/ou interdependentes', obrigatorio: false },
  { inciso: 'XII', titulo: 'Impactos ambientais e medidas mitigadoras', obrigatorio: false },
  { inciso: 'XIII', titulo: 'Posicionamento conclusivo sobre a adequação da contratação', obrigatorio: true },
]);

export type ConteudoEtp = Partial<Record<IncisoEtp, { texto?: string; justificativaAusencia?: string }>>;

function tamanho(s: string | undefined): number {
  return typeof s === 'string' ? Array.from(s.trim()).length : 0;
}

/**
 * Valida o conteúdo do ETP. Inciso obrigatório sem texto com ao menos `minimoCaracteres` → obrigatorio_vazio
 * (a justificativa de ausência não supre inciso obrigatório). Inciso não obrigatório sem texto suficiente e sem
 * justificativa de ausência suficiente → sem_justificativa_ausencia.
 * percentualPreenchido = incisos atendidos (texto suficiente ou ausência justificada) ÷ 13.
 */
export function validarEtp(
  c: ConteudoEtp,
  minimoCaracteres = 30,
): {
  completo: boolean;
  percentualPreenchido: number;
  pendencias: { inciso: IncisoEtp; motivo: 'obrigatorio_vazio' | 'sem_justificativa_ausencia'; mensagem: string }[];
  fundamento: string;
} {
  if (c === null || typeof c !== 'object') throw new ErroDominio('ETP_INVALIDO', 'Conteúdo do ETP ausente.');
  exigirInteiro(minimoCaracteres, 'minimoCaracteres', 'ETP_INVALIDO', 0);

  const pendencias: { inciso: IncisoEtp; motivo: 'obrigatorio_vazio' | 'sem_justificativa_ausencia'; mensagem: string }[] = [];
  let atendidos = 0;
  for (const item of INCISOS_ETP) {
    const conteudo = c[item.inciso];
    const temTexto = tamanho(conteudo?.texto) >= minimoCaracteres;
    if (item.obrigatorio) {
      if (temTexto) {
        atendidos += 1;
      } else {
        pendencias.push({
          inciso: item.inciso,
          motivo: 'obrigatorio_vazio',
          mensagem: `Inciso ${item.inciso} (${item.titulo}) é obrigatório e deve ter ao menos ${minimoCaracteres} caracteres (art. 18, § 2º).`,
        });
      }
      continue;
    }
    if (temTexto || tamanho(conteudo?.justificativaAusencia) >= minimoCaracteres) {
      atendidos += 1;
    } else {
      pendencias.push({
        inciso: item.inciso,
        motivo: 'sem_justificativa_ausencia',
        mensagem: `Inciso ${item.inciso} (${item.titulo}): preencha o conteúdo ou justifique a ausência com ao menos ${minimoCaracteres} caracteres (art. 18, § 2º).`,
      });
    }
  }

  return {
    completo: pendencias.length === 0,
    percentualPreenchido: percentual(atendidos, INCISOS_ETP.length),
    pendencias,
    fundamento: 'Lei 14.133/2021, art. 18, §§ 1º e 2º',
  };
}
