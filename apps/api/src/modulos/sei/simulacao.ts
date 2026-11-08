/**
 * SEI simulado (modo offline, padrão): implementa o mesmo contrato do cliente do SeiWS sem nenhuma chamada externa,
 * de forma determinística.
 *   * O processo recebe no SEI o mesmo número que já tem na Ágora (NUP sintético da carga de demonstração).
 *   * Cada documento recebe no SEI o número que já tem na árvore da Ágora.
 *   * Na consulta, o documento aparece assinado pelo servidor designado no processo para aquele documento (ou por
 *     quem o aprovou), no instante da primeira consulta; se já havia assinatura simulada na árvore, ela é devolvida.
 * Nada disso é assinatura ICP-Brasil: a tela informa que é simulação.
 */
import type { PapelProcesso } from '@agora/dominio';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import type { AssinaturaConsultadaSei, ClienteSei } from '../../integracoes/sei.ts';
import { ROTULOS_PAPEL } from '../jornada/constantes.ts';
import type { TipoDocumento } from '../jornada/tipos.ts';
import type { EntradaSei } from './repositorio.ts';

/** Quem assina cada documento no SEI, na simulação. */
export const SIGNATARIO_SIMULADO: Record<TipoDocumento, PapelProcesso> = {
  dfd: 'requisitante',
  etp: 'equipe_planejamento',
  matriz_riscos: 'equipe_planejamento',
  nota_tecnica_precos: 'equipe_planejamento',
  tr: 'equipe_planejamento',
  edital: 'agente_contratacao',
  minuta_contrato: 'autoridade_competente',
  parecer_checklist: 'parecerista_juridico',
};

function identificador(semente: string, digitos: number): string {
  const hex = sha256Hex(semente).slice(0, 15);
  return String(Number.parseInt(hex, 16)).padStart(digitos, '0').slice(-digitos);
}

export interface DadosSimulacaoSei {
  numeroProcesso: string;
  processoId: string;
  entradas: readonly EntradaSei[];
  equipe: readonly { papel: PapelProcesso; nome: string }[];
  agora: () => Date;
}

/** Assinaturas que o SEI simulado devolve para um documento da árvore. */
export function assinaturasSimuladas(d: DadosSimulacaoSei, entrada: EntradaSei | undefined): AssinaturaConsultadaSei[] {
  if (!entrada) return [];
  if (entrada.assinaturas && entrada.assinaturas.length > 0) {
    return entrada.assinaturas.map((a) => ({ nome: a.nome, cargoFuncao: a.cargoFuncao, assinadoEm: a.assinadoEm, sigla: null }));
  }
  if (entrada.assinado_em && entrada.assinado_nome) {
    return [{ nome: entrada.assinado_nome, cargoFuncao: null, assinadoEm: entrada.assinado_em, sigla: null }];
  }
  const papel = entrada.tipo ? SIGNATARIO_SIMULADO[entrada.tipo] : null;
  const designado = papel ? d.equipe.find((m) => m.papel === papel) : undefined;
  const nome = designado?.nome ?? entrada.revisor_nome;
  if (!nome) return [];
  return [{ nome, cargoFuncao: designado && papel ? ROTULOS_PAPEL[papel] : null, assinadoEm: d.agora().toISOString(), sigla: null }];
}

export function criarSeiSimulado(d: DadosSimulacaoSei): ClienteSei {
  const porNumero = new Map(d.entradas.map((e) => [e.numero, e]));
  return {
    gerarProcedimento: () =>
      Promise.resolve({ idProcedimento: identificador(`procedimento|${d.processoId}`, 13), procedimentoFormatado: d.numeroProcesso, linkAcesso: null }),
    incluirDocumento: (documento) =>
      Promise.resolve({ idDocumento: identificador(`documento|${d.processoId}|${documento.numero}`, 13), documentoFormatado: documento.numero, linkAcesso: null }),
    consultarDocumento: (numero) =>
      Promise.resolve({
        idDocumento: identificador(`documento|${d.processoId}|${numero}`, 13),
        documentoFormatado: numero,
        linkAcesso: null,
        assinaturas: assinaturasSimuladas(d, porNumero.get(numero)),
      }),
    gerarBloco: (p) => Promise.resolve(identificador(`bloco|${d.processoId}|${[...p.documentos].sort().join(',')}`, 6).replace(/^0+(?=\d)/, '')),
    enviarProcesso: () => Promise.resolve(),
  };
}
