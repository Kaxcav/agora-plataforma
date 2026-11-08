/**
 * Declarações dos agentes designados (RN-28; Lei 14.133/2021, art. 7º, I a III, art. 8º e art. 9º, § 1º).
 * `verificarDeclaracoesDesignados` é a verificação que a designação da equipe (RN-03, na jornada) chama.
 */
import {
  adicionarDias,
  verificarDeclaracaoAgente,
  verificarDeclaracoesEquipe,
  VALIDADE_DECLARACAO_MESES_PADRAO,
  type DeclaracaoAgente,
  type PapelProcesso,
} from '@agora/dominio';
import type { AptidaoAgente, CapacitacaoAgente, DeclaracaoAgenteRegistrada, VinculoFuncional } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { listarVinculos, paraVinculoRegistrado } from './repositorio.ts';

export interface LinhaDeclaracao {
  id: string;
  usuario_id: string;
  usuario_nome: string;
  declarada_em: string;
  data_declaracao: string;
  sem_parentesco_ou_vinculo: boolean;
  sem_conflito_interesses: boolean;
  vinculo: VinculoFuncional;
  cargo_matricula: string | null;
  capacitacao: CapacitacaoAgente;
  capacitacao_descricao: string | null;
}

/** Declaração vigente (a mais recente) de cada usuário informado. */
export async function declaracoesVigentes(executor: Executor, usuarioIds: readonly string[]): Promise<Map<string, LinhaDeclaracao>> {
  if (usuarioIds.length === 0) return new Map();
  const linhas = await executor.consultar<LinhaDeclaracao>(
    `SELECT d.id, d.usuario_id, u.nome AS usuario_nome, d.declarada_em, d.data_declaracao, d.sem_parentesco_ou_vinculo,
            d.sem_conflito_interesses, d.vinculo, d.cargo_matricula, d.capacitacao, d.capacitacao_descricao
       FROM declaracoes_agentes d JOIN usuarios u ON u.id = d.usuario_id
      WHERE d.vigente AND d.usuario_id = ANY($1::uuid[])`,
    [[...new Set(usuarioIds)]],
  );
  return new Map(linhas.map((l) => [l.usuario_id, l]));
}

export function paraDeclaracaoDominio(l: LinhaDeclaracao): DeclaracaoAgente {
  return {
    declaradaEm: l.data_declaracao,
    semParentescoOuVinculo: l.sem_parentesco_ou_vinculo,
    semConflitoInteresses: l.sem_conflito_interesses,
    vinculo: l.vinculo,
    capacitacao: l.capacitacao,
    capacitacaoDescricao: l.capacitacao_descricao,
  };
}

/** Validade da declaração: a data em que vence (fim da validade padrão de 12 meses). */
export function validadeDeclaracao(l: LinhaDeclaracao, hoje: string): { validaAte: string; vencida: boolean } {
  const r = verificarDeclaracaoAgente({ papel: 'requisitante', declaracao: paraDeclaracaoDominio(l), hoje });
  const validaAte = r.validaAte ?? adicionarDias(l.data_declaracao, 365);
  return { validaAte, vencida: validaAte < hoje };
}

export async function declaracaoRegistrada(executor: Executor, l: LinhaDeclaracao, hoje: string): Promise<DeclaracaoAgenteRegistrada> {
  const validade = validadeDeclaracao(l, hoje);
  const vinculos = await listarVinculos(executor, { declaracaoId: l.id });
  return {
    id: l.id,
    usuario: { id: l.usuario_id, nome: l.usuario_nome },
    declaradaEm: l.declarada_em,
    validaAte: validade.validaAte,
    semParentescoOuVinculo: l.sem_parentesco_ou_vinculo,
    semConflitoInteresses: l.sem_conflito_interesses,
    vinculo: l.vinculo,
    cargoMatricula: l.cargo_matricula,
    capacitacao: l.capacitacao,
    capacitacaoDescricao: l.capacitacao_descricao,
    situacao: validade.vencida ? 'vencida' : 'vigente',
    vinculosDeclarados: vinculos.map(paraVinculoRegistrado),
  };
}

/**
 * Verificação da designação (RN-28), para a jornada chamar junto com a segregação de funções (RN-03): devolve, no
 * formato dos detalhes de erro da API, uma pendência por designação sem declaração válida. Lista vazia = pode designar.
 */
export async function verificarDeclaracoesDesignados(
  executor: Executor,
  designacoes: readonly { papel: PapelProcesso; usuarioId: string; nome: string }[],
  hoje: string,
): Promise<{ campo: string; mensagem: string }[]> {
  const vigentes = await declaracoesVigentes(
    executor,
    designacoes.map((d) => d.usuarioId),
  );
  const resultado = verificarDeclaracoesEquipe(
    designacoes.map((d) => {
      const linha = vigentes.get(d.usuarioId);
      return { papel: d.papel, servidorId: d.usuarioId, nome: d.nome, declaracao: linha ? paraDeclaracaoDominio(linha) : null };
    }),
    hoje,
    { validadeMeses: VALIDADE_DECLARACAO_MESES_PADRAO },
  );
  return resultado.pendencias.map((p) => ({ campo: 'RN-28', mensagem: `${p.mensagem} (${p.fundamento})` }));
}

/** Aptidão de cada agente da equipe, por papel (sem dados pessoais além do nome do servidor). */
export async function aptidaoDaEquipe(
  executor: Executor,
  equipe: readonly { papel: PapelProcesso; usuarioId: string; nome: string }[],
  hoje: string,
): Promise<AptidaoAgente[]> {
  const vigentes = await declaracoesVigentes(
    executor,
    equipe.map((m) => m.usuarioId),
  );
  const porUsuario = new Map<string, AptidaoAgente>();
  for (const m of equipe) {
    const linha = vigentes.get(m.usuarioId) ?? null;
    const atual =
      porUsuario.get(m.usuarioId) ??
      ({
        usuario: { id: m.usuarioId, nome: m.nome },
        declaracao: linha
          ? { declaradaEm: linha.declarada_em, validaAte: validadeDeclaracao(linha, hoje).validaAte, vinculo: linha.vinculo, capacitacao: linha.capacitacao }
          : null,
        papeis: [],
      } satisfies AptidaoAgente);
    const r = verificarDeclaracaoAgente({ papel: m.papel, declaracao: linha ? paraDeclaracaoDominio(linha) : null, hoje });
    atual.papeis.push({ papel: m.papel, apto: r.apto, pendencias: r.pendencias, sinais: r.sinais });
    porUsuario.set(m.usuarioId, atual);
  }
  return [...porUsuario.values()];
}
