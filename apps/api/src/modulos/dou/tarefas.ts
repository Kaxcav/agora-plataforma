/**
 * Conferência da publicação no DOU (`dou.conferencia`), executada pelo trabalhador da fila (RF-36, RNF-07).
 * Modo online: busca na consulta pública do DOU (Seção 3), pelo número do processo, entre o envio e hoje, e confere
 * o ato com `localizarMateriaDou`. Modo offline (padrão): simulação determinística — a matéria aparece publicada na
 * edição prevista, a partir do dia dessa edição. Não localizada não é erro: o resultado fica registrado e a
 * conferência pode ser repetida.
 */
import { formatarData, hojeISO, localizarMateriaDou, type ResultadoBuscaDou } from '@agora/dominio';
import { z } from 'zod';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { consultarDou } from '../../integracoes/dou-consulta.ts';
import { obterMateria, type LinhaMateria } from './repositorio.ts';
import { registrarPublicacaoDou } from './servico.ts';

const cargaConferencia = z.object({ materiaId: z.uuid() });

/** Edição simulada: número e página reproduzíveis a partir da matéria e da data. */
export function edicaoSimulada(m: Pick<LinhaMateria, 'id' | 'titulo' | 'identificacao' | 'texto'>, data: string): ResultadoBuscaDou {
  const semente = Number.parseInt(sha256Hex(`${m.id}|${data}`).slice(0, 8), 16);
  const inicioAno = Date.parse(`${data.slice(0, 4)}-01-01T00:00:00Z`);
  const diaDoAno = Math.floor((Date.parse(`${data}T00:00:00Z`) - inicioAno) / 86_400_000) + 1;
  return {
    titulo: `${m.titulo} ${m.identificacao}`,
    resumo: m.texto,
    data,
    secao: 'DO3',
    url: '',
    edicao: String(Math.max(1, Math.round((diaDoAno * 5) / 7))),
    pagina: String(20 + (semente % 180)),
  };
}

export async function executarConferenciaDou(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const carga = cargaConferencia.safeParse(tarefa.carga);
  if (!carga.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  const materia = await obterMateria(ctx.banco, carga.data.materiaId);
  if (!materia) throw new FalhaTarefa('Matéria do DOU não encontrada.', false);
  const modo = ctx.config.integracoes;
  if (materia.situacao !== 'enviada' || !materia.enviada_em) {
    return { resultado: { modo, conferida: false, motivo: `Matéria ${materia.situacao === 'publicada' ? 'já publicada' : 'ainda não enviada'}.` } };
  }
  const hoje = hojeISO(ctx.relogio());
  const enviadaEm = hojeISO(new Date(materia.enviada_em));
  let achado: ResultadoBuscaDou | null;
  let consultados = 0;
  if (modo === 'online') {
    const resultados = await consultarDou(
      { url: ctx.config.dou.consultaUrl, fetch: ctx.fetch, timeoutMs: ctx.config.dou.timeoutMs },
      { termo: materia.processo_numero, de: enviadaEm, ate: hoje },
    );
    consultados = resultados.length;
    achado = localizarMateriaDou({ tipo: materia.tipo, processo: materia.processo_numero, enviadaEm }, resultados);
  } else {
    const prevista = materia.data_prevista ?? hoje;
    achado = prevista <= hoje ? edicaoSimulada(materia, prevista) : null;
  }
  const resumo = achado
    ? `Publicada no DOU de ${formatarData(achado.data)}, Seção 3${achado.edicao ? `, edição ${achado.edicao}` : ''}${achado.pagina ? `, página ${achado.pagina}` : ''}${modo === 'online' ? '' : ' (simulação)'}.`
    : `Ainda não localizada no DOU até ${formatarData(hoje)}${materia.data_prevista ? `; edição prevista: ${formatarData(materia.data_prevista)}` : ''}.`;

  return {
    resultado: { modo, conferida: achado !== null, consultados, data: achado?.data ?? null, url: achado?.url || null },
    async aplicar(tx) {
      const agora = ctx.relogio();
      const atual = await obterMateria(tx, materia.id, true);
      if (!atual) return;
      await tx.executar(
        `UPDATE dou_materias SET conferencias = conferencias + 1, ultima_conferencia_em = $2, ultima_conferencia_resultado = $3 WHERE id = $1`,
        [materia.id, agora.toISOString(), resumo],
      );
      if (achado && atual.situacao === 'enviada') {
        await registrarPublicacaoDou(
          tx,
          atual,
          { data: achado.data, edicao: achado.edicao, pagina: achado.pagina, url: achado.url || null, forma: 'consulta', modo },
          agora,
        );
      }
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'dou.conferir',
          recurso: 'dou_materia',
          recursoId: materia.id,
          resumo: `Conferiu no DOU ${materia.identificacao.toLowerCase()} (processo ${materia.processo_numero}): ${resumo}`,
          dados: {
            tipo: materia.tipo,
            processo: materia.processo_numero,
            protocoloIncom: materia.protocolo_incom,
            modo,
            tarefaId: tarefa.id,
            consultados,
            publicada: achado !== null,
            data: achado?.data ?? null,
            url: achado?.url || null,
          },
          ipHash: null,
        },
        agora,
      );
    },
  };
}
