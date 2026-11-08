/**
 * Acréscimos ao rascunho dos documentos da jornada vindos da frente de desempenho e lições aprendidas:
 * - as lições aprendidas aceitas pelo agente para o DFD, o ETP ou o TR (RIA-12; só as aceitas);
 * - no TR e no edital, a fórmula do desempenho anterior na pontuação técnica, quando adotada (art. 36, § 3º; art. 37, III).
 */
import { clausulaCriterioDesempenhoEdital, secaoLicoesAceitas, type CriterioDesempenhoTecnica, type DocumentoLicao, type LicaoAceita } from '@agora/dominio';
import type { Executor } from '../../banco/tipos.ts';
import { criterioDesempenhoDoProcesso } from '../desempenho/repositorio.ts';
import { licoesAceitasDoProcesso } from './repositorio.ts';

/** Corpo, premissas e fontes do modelo de texto (`ModeloDocumento` da jornada), sem importar o módulo dela. */
interface ModeloComCorpo {
  corpo: string;
  premissas: string[];
  fontes: string[];
}

export interface AnexosDocumento {
  licoesAceitas: Partial<Record<DocumentoLicao, LicaoAceita[]>>;
  criterioDesempenho: CriterioDesempenhoTecnica | null;
}

export async function carregarAnexosDocumento(executor: Executor, processoId: string): Promise<AnexosDocumento> {
  return { licoesAceitas: await licoesAceitasDoProcesso(executor, processoId), criterioDesempenho: await criterioDesempenhoDoProcesso(executor, processoId) };
}

function ehDocumentoLicao(tipo: string): tipo is DocumentoLicao {
  return tipo === 'dfd' || tipo === 'etp' || tipo === 'tr';
}

/** Acrescenta ao modelo do documento as lições aceitas e, no TR e no edital, a fórmula do desempenho. */
export function anexarAoModelo<M extends ModeloComCorpo>(modelo: M, tipo: string, anexos: AnexosDocumento | undefined): M {
  if (!anexos) return modelo;
  const partes = [modelo.corpo.trimEnd()];
  const premissas = [...modelo.premissas];
  const fontes = [...modelo.fontes];
  if (ehDocumentoLicao(tipo)) {
    const secao = secaoLicoesAceitas(anexos.licoesAceitas[tipo] ?? []);
    if (secao) {
      partes.push(secao.corpo);
      premissas.push(...secao.premissas);
      fontes.push(...secao.fontes);
    }
  }
  if ((tipo === 'tr' || tipo === 'edital') && anexos.criterioDesempenho) {
    const clausula = clausulaCriterioDesempenhoEdital(anexos.criterioDesempenho);
    partes.push(clausula.corpo);
    premissas.push(clausula.premissa);
    fontes.push(clausula.fundamento);
  }
  if (partes.length === 1) return modelo;
  return { ...modelo, corpo: partes.join('\n\n'), premissas, fontes };
}
