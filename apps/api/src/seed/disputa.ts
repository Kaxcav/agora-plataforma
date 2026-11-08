import { inserirEmLote } from '../banco/lote.ts';
import { PRENOMES, SOBRENOMES } from './catalogo.ts';
import type { ContextoSeed } from './contexto.ts';
import { gerarCpf } from './documentos.ts';
import { Prng } from './prng.ts';

/**
 * Par de empresas sintéticas com sócio em comum, para a simulação da sala de disputa da PoC-03 (4 empresas, duas com
 * quadro societário cruzado): exercita o sinal de sócio em comum (RIA-06) e o seu cruzamento com o padrão de lances
 * (RIA-09). O par não disputa junto nenhum processo sintético, para não alterar os demais cenários.
 */
export const PAR_SOCIO_EM_COMUM_DEMONSTRACAO = ['aria', 'atlas'] as const;

/** Semente própria: a etapa não altera a sequência pseudoaleatória das etapas anteriores. */
const SEMENTE_SALA_DISPUTA = 14_133_015;

export async function gerarVinculoSalaDisputa(ctx: ContextoSeed): Promise<void> {
  const prng = new Prng(SEMENTE_SALA_DISPUTA);
  const empresas = PAR_SOCIO_EM_COMUM_DEMONSTRACAO.map((chave) => ctx.dados.fornecedores.find((f) => f.chave === chave && f.tipo === 'PJ'));
  const [a, b] = empresas;
  if (!a || !b) return;
  const cpf = gerarCpf(prng);
  const nome = `${prng.escolher(PRENOMES)} ${prng.escolher(SOBRENOMES)} ${prng.escolher(SOBRENOMES)}`;
  await inserirEmLote(
    ctx.tx,
    'fornecedores_socios',
    ['id', 'fornecedor_id', 'cpf', 'nome'],
    [
      [prng.uuid(), a.id, cpf, nome],
      [prng.uuid(), b.id, cpf, nome],
    ],
  );
  ctx.dados.contagens.sociosEmComumSalaDisputa = 1;
}
