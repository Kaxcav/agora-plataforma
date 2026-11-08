/**
 * Ponte com a jornada da contratação (etapa 6): os sinais de vínculo dos licitantes do processo, num só motor.
 * O sócio em comum (RIA-06) e os demais vínculos de fonte lícita (RIA-10) saem de `analisarFornecedores`.
 */
import type { Sinal } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { analisarFornecedores } from './repositorio.ts';

export async function sinaisVinculosDaDisputa(
  executor: Executor,
  fornecedorIds: readonly string[],
  equipe: readonly { usuarioId: string; nome: string; cpf: string }[],
  hoje: string,
  agora: Date,
): Promise<{ ria06: string[]; ria10: Sinal[] }> {
  if (fornecedorIds.length === 0) return { ria06: [], ria10: [] };
  const analise = await analisarFornecedores(executor, fornecedorIds, {
    agentes: equipe.map((m) => ({ usuarioId: m.usuarioId, nome: m.nome, cpf: m.cpf })),
    hoje,
    agora,
  });
  return {
    ria06: analise.sinais.filter((s) => s.regra === 'RIA-06').map((s) => s.mensagem),
    ria10: analise.sinais
      .filter((s) => s.regra === 'RIA-10')
      .map((s) => ({
        regra: 'RIA-10',
        nivel: s.nivel,
        mensagem: `${s.mensagem} Evidências em "Vínculos e impedimentos". Requer revisão humana.`,
        fundamento: s.fundamento,
      })),
  };
}
