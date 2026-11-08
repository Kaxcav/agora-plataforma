import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conferirCitacoesLegais, indexarBaseNormativa, type BaseNormativa, type ConferenciaCitacoes, type IndiceNormativo } from '@agora/dominio';

/**
 * Base normativa soberana (RNF-08): texto estruturado da Lei 14.133/2021 guardado no repositório
 * (`apps/api/dados/normas/`), lido uma vez e indexado em memória no servidor. Nada é consultado fora da Ágora.
 */
export const ARQUIVO_BASE_NORMATIVA = fileURLToPath(new URL('../../dados/normas/lei-14133-2021.json', import.meta.url));

/** Quantas conferências de citações ficam em memória (por hash do texto conferido). */
const LIMITE_CACHE_CONFERENCIAS = 2_000;

export class ErroBaseNormativa extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroBaseNormativa';
  }
}

let indiceCarregado: IndiceNormativo | null = null;
const conferencias = new Map<string, ConferenciaCitacoes>();

function validar(dados: unknown): BaseNormativa {
  const base = dados as Partial<BaseNormativa> | null;
  if (!base || typeof base !== 'object' || !Array.isArray(base.artigos) || !base.norma || !base.proveniencia) {
    throw new ErroBaseNormativa('O arquivo da base normativa não tem o formato esperado (norma, proveniencia e artigos).');
  }
  if (base.artigos.length === 0) throw new ErroBaseNormativa('A base normativa não tem artigos.');
  return base as BaseNormativa;
}

/** Índice da base normativa (carregado e indexado na primeira chamada). */
export function indiceNormativo(): IndiceNormativo {
  if (indiceCarregado === null) {
    const base = validar(JSON.parse(readFileSync(ARQUIVO_BASE_NORMATIVA, 'utf8')));
    indiceCarregado = indexarBaseNormativa(base);
  }
  return indiceCarregado;
}

/** Conferência das citações de um texto, guardada em memória pelo SHA-256 do texto (o resultado é determinístico). */
export function conferirCitacoes(texto: string): ConferenciaCitacoes {
  const chave = createHash('sha256').update(texto, 'utf8').digest('hex');
  const existente = conferencias.get(chave);
  if (existente) return existente;
  const resultado = conferirCitacoesLegais(texto, indiceNormativo());
  if (conferencias.size >= LIMITE_CACHE_CONFERENCIAS) {
    const maisAntiga = conferencias.keys().next().value;
    if (maisAntiga !== undefined) conferencias.delete(maisAntiga);
  }
  conferencias.set(chave, resultado);
  return resultado;
}
