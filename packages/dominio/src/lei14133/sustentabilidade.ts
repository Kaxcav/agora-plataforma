/**
 * Critérios de sustentabilidade ambiental e logística reversa no ETP e no termo de referência (RN-21).
 *
 * O desenvolvimento nacional sustentável é princípio e objetivo das contratações (Lei 14.133/2021, art. 5º, e
 * art. 11, IV), e o ETP descreve os impactos ambientais e as medidas mitigadoras, inclusive a logística reversa para
 * desfazimento e reciclagem de bens e refugos (art. 18, § 1º, XII). A lei deixa ao órgão exigir esses elementos em
 * todos os ETPs e TRs: com a política do órgão ligada, o documento não se conclui sem os dois critérios preenchidos.
 */
import { ErroDominio } from '../erros.ts';

export interface CriteriosSustentabilidade {
  /** Critérios de sustentabilidade ambiental exigidos do objeto e da execução (consumo de energia e recursos, materiais, emissões). */
  criteriosAmbientais: string | null;
  /** Logística reversa: desfazimento, recolhimento, reciclagem e destinação final ambientalmente adequada de bens e refugos. */
  logisticaReversa: string | null;
}

const FUNDAMENTO = 'Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII; política de sustentabilidade do órgão';

const DOCUMENTOS = { etp: 'Estudo Técnico Preliminar', tr: 'termo de referência' } as const;

function preenchido(texto: string | null | undefined, minimo: number): boolean {
  return (texto ?? '').trim().length >= minimo;
}

/**
 * Situação dos critérios de sustentabilidade para concluir o ETP ou o TR. Com a política do órgão ligada, cada
 * critério ausente (ou com menos de `minimoCaracteres`) vira pendência que impede a conclusão do documento; com a
 * política desligada, os critérios continuam recomendados, sem bloquear.
 */
export function verificarSustentabilidade(
  e: { politicaAtiva: boolean; criterios: CriteriosSustentabilidade; documento: 'etp' | 'tr' },
  minimoCaracteres = 30,
): {
  exigida: boolean;
  completa: boolean;
  pendencias: { campo: 'criteriosAmbientais' | 'logisticaReversa'; mensagem: string }[];
  orientacao: string;
  fundamento: string;
} {
  if (e.documento !== 'etp' && e.documento !== 'tr') throw new ErroDominio('DOCUMENTO_INVALIDO', `Documento inválido: ${String(e.documento)}.`);
  const documento = DOCUMENTOS[e.documento];
  const ambientais = preenchido(e.criterios.criteriosAmbientais, minimoCaracteres);
  const reversa = preenchido(e.criterios.logisticaReversa, minimoCaracteres);
  const completa = ambientais && reversa;
  const pendencias: { campo: 'criteriosAmbientais' | 'logisticaReversa'; mensagem: string }[] = [];
  if (e.politicaAtiva) {
    if (!ambientais) {
      pendencias.push({
        campo: 'criteriosAmbientais',
        mensagem: `Preencha os critérios de sustentabilidade ambiental do ${documento} (mínimo de ${minimoCaracteres} caracteres), exigidos pela política do órgão.`,
      });
    }
    if (!reversa) {
      pendencias.push({
        campo: 'logisticaReversa',
        mensagem: `Preencha a logística reversa — desfazimento e reciclagem de bens e refugos — do ${documento} (mínimo de ${minimoCaracteres} caracteres), exigida pela política do órgão.`,
      });
    }
  }
  return {
    exigida: e.politicaAtiva,
    completa,
    pendencias,
    orientacao: e.politicaAtiva
      ? `A política de sustentabilidade do órgão está ligada: o ${documento} só se conclui com os critérios ambientais e a logística reversa preenchidos.`
      : `A política de sustentabilidade do órgão está desligada: os critérios são recomendados, mas não impedem a conclusão do ${documento}.`,
    fundamento: FUNDAMENTO,
  };
}
