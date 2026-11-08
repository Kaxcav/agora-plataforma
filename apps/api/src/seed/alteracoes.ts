/**
 * Carga sintética da frente K (F22a): natureza dos contratos quanto à duração (arts. 105 a 114), regime de mão de obra
 * dos serviços contínuos (art. 135) e um termo aditivo de acréscimo aguardando o parecer jurídico, para demonstrar o
 * ciclo do ato (RN-32). Determinística e sem dados reais.
 */
import { adicionarDias, avaliarTermoAditivo, formatarMoeda } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

const SEMENTE_ALTERACOES = 14_133_022;

/** Serviços contínuos com postos dedicados na carga sintética (repactuação, art. 135). */
const DEDICACAO_EXCLUSIVA = /manutenção preventiva e corretiva da frota|transporte fluvial/i;

export async function gerarAlteracoes(ctx: ContextoSeed): Promise<void> {
  const { tx, dados, hoje, agora } = ctx;
  const prng = new Prng(SEMENTE_ALTERACOES);
  const naturezas: [string, string, string | null][] = dados.contratos.map((c) => {
    const continuo = c.servico && c.origem === 'licitacao';
    const regime = continuo ? (DEDICACAO_EXCLUSIVA.test(c.objeto) ? 'dedicacao_exclusiva' : 'sem_dedicacao') : null;
    return [c.id, continuo ? 'continuo' : 'escopo', regime];
  });
  if (naturezas.length > 0) {
    await tx.executar(
      `UPDATE contratos c
          SET natureza_duracao = n.natureza, regime_mao_obra = NULLIF(n.regime, '')
         FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS natureza, unnest($3::text[]) AS regime) n
        WHERE c.id = n.id`,
      [naturezas.map((n) => n[0]), naturezas.map((n) => n[1]), naturezas.map((n) => n[2] ?? '')],
    );
  }

  // Um acréscimo de 5% aguardando o parecer jurídico, num serviço contínuo vigente e já divulgado no PNCP.
  const candidatos = dados.contratos
    .filter((c) => c.servico && c.origem === 'licitacao' && c.vigenciaFim > adicionarDias(hoje, 200) && c.divulgacao !== null)
    .sort((a, b) => a.numero.localeCompare(b.numero));
  const alvo = candidatos[prng.inteiro(0, Math.max(0, candidatos.length - 1))];
  if (!alvo) return;
  const [valores] = await tx.consultar<{ acrescimos: number; supressoes: number; reajustes: number }>(
    'SELECT acrescimos, supressoes, reajustes FROM vw_contratos_valores WHERE contrato_id = $1',
    [alvo.id],
  );
  const valor = Math.round(alvo.valorInicial * 0.05);
  const justificativa = 'Acréscimo de 5% para atender à ampliação temporária da demanda nas unidades regionais, conforme estudo do fiscal.';
  const avaliacao = avaliarTermoAditivo({
    tipo: 'acrescimo',
    valor,
    valorInicialAtualizado: Math.max(1, alvo.valorInicial + (valores?.reajustes ?? 0)),
    acrescimosAnteriores: valores?.acrescimos ?? 0,
    supressoesAnteriores: valores?.supressoes ?? 0,
    justificativa,
    vigenciaFim: alvo.vigenciaFim,
    hoje,
  });
  if (!avaliacao.permitido) return;
  const proposto = instanteEm(adicionarDias(hoje, -2), prng, agora);
  const id = prng.uuid();
  await inserirEmLote(
    tx,
    'alteracoes_contratuais',
    ['id', 'contrato_id', 'especie', 'tipo', 'situacao', 'valor', 'justificativa', 'dados', 'proposto_por', 'proposto_em', 'atualizado_em'],
    [
      [
        id,
        alvo.id,
        'aditivo',
        'acrescimo',
        'aguardando_parecer',
        valor,
        justificativa,
        JSON.stringify({
          reformaEdificioOuEquipamento: false,
          detalhes: [
            { rotulo: 'Acréscimo', valor: formatarMoeda(valor) },
            {
              rotulo: 'Acréscimos acumulados',
              valor: `${(avaliacao.percentualAcumulado ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do valor inicial atualizado (limite de 25%)`,
            },
          ],
          avaliacao: { explicacao: avaliacao.explicacao, fundamento: avaliacao.fundamento },
        }),
        alvo.gestorId,
        proposto.toISOString(),
        proposto.toISOString(),
      ],
    ],
  );
  ctx.eventos.push({
    ocorridoEm: proposto,
    usuarioId: alvo.gestorId,
    acao: 'contrato.alteracao.propor',
    recurso: 'contrato',
    recursoId: alvo.id,
    resumo: `Propôs termo aditivo de acréscimo ao contrato ${alvo.numero} (${formatarMoeda(valor)}); segue para o parecer jurídico`,
    dados: { alteracaoId: id, tipo: 'acrescimo', valor },
  });
  dados.contagens.alteracoesContratuais = 1;
}
