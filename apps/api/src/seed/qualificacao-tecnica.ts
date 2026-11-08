/**
 * Exigências de qualificação técnica (RN-25) dos processos sintéticos que já passaram da etapa 4: cada item do DFD
 * com valor igual ou superior a 4% do total vira parcela de maior relevância, com quantitativo mínimo de 50%.
 * Não consome o PRNG (os identificadores derivam do processo), para não alterar as etapas seguintes da carga.
 */
import { createHash } from 'node:crypto';
import { avaliarExigenciasQualificacaoTecnica } from '@agora/dominio';
import { analisarCesta } from '../modulos/jornada/regras.ts';
import type { CestaArmazenada, DfdProcesso } from '../modulos/jornada/tipos.ts';
import type { ParcelaArmazenada } from '../modulos/documentos/repositorio.ts';
import type { ContextoSeed } from './contexto.ts';

function uuidDerivado(semente: string): string {
  const h = createHash('sha256').update(semente).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function gerarQualificacaoTecnica(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados, eventos } = ctx;
  const planejamento = dados.usuarios.get('planejamento@agora.demo');
  const processos = await tx.consultar<{ id: string; numero_sei: string; dfd: DfdProcesso; cesta: CestaArmazenada; etapa_atual: number; criado_em: string }>(
    'SELECT id, numero_sei, dfd, cesta, etapa_atual, criado_em FROM processos WHERE etapa_atual >= 5 ORDER BY numero_sei',
  );
  let definidas = 0;
  for (const p of processos) {
    const analise = analisarCesta(p.cesta, hoje);
    const valores = p.dfd.itens.map((item, indice) => Math.round(item.quantidade * (indice === 0 && analise ? analise.valorEstimado : item.valorUnitarioEstimado)));
    const total = valores.reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    const parcelas: ParcelaArmazenada[] = p.dfd.itens.flatMap((item, indice) => {
      const valor = valores[indice] ?? 0;
      if (valor * 100 < 4 * total || item.quantidade < 2) return [];
      return [
        {
          id: uuidDerivado(`${p.id}:parcela:${indice}`),
          descricao: item.descricao.split(',')[0]?.trim() ?? item.descricao,
          unidade: item.unidade === 'unidade' ? 'unidades' : item.unidade,
          quantidadeObjeto: item.quantidade,
          valorEstimado: valor,
          quantidadeMinima: Math.floor(item.quantidade / 2),
          termos: [],
        },
      ];
    });
    if (parcelas.length === 0 || !avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: total, parcelas }).valida) continue;
    const avanco = eventos.find((e) => e.recursoId === p.id && e.acao === 'processo.avancar' && (e.dados as { para?: number } | undefined)?.para === 5);
    const momento = new Date(Math.min((avanco?.ocorridoEm.getTime() ?? Date.parse(p.criado_em)) - 60 * 60_000, agora.getTime()));
    await tx.executar(
      'INSERT INTO processos_qualificacao_tecnica (processo_id, parcelas, definida_em, definida_por) VALUES ($1, $2::jsonb, $3, $4)',
      [p.id, JSON.stringify(parcelas), momento.toISOString(), planejamento?.id ?? null],
    );
    eventos.push({
      ocorridoEm: momento,
      usuarioId: planejamento?.id ?? null,
      acao: 'processo.qualificacao_tecnica.definir',
      recurso: 'processo',
      recursoId: p.id,
      resumo: `Definiu ${parcelas.length} parcela(s) de maior relevância para a qualificação técnica (art. 67)`,
      dados: { carga: 'demonstracao', numeroSei: p.numero_sei, etapa: 4, valorTotalEstimado: total, parcelas: parcelas.map((x) => ({ id: x.id, descricao: x.descricao, quantidadeMinima: x.quantidadeMinima })) },
    });
    definidas++;
  }
  dados.contagens.qualificacoesTecnicas = definidas;
}
