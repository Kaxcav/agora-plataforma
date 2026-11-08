/**
 * Publicação no DOU (RF-36) — leitura das matérias, com o envio pelo INCom, a publicação conferida, a última
 * conferência pela fila e a publicação do aviso em jornal.
 */
import type { MateriaDou, SituacaoMateriaDou, TipoMateriaDou } from '@agora/contratos';
import type { Executor, ParametroSql } from '../../banco/tipos.ts';
import { situacaoTarefa } from '../sei/repositorio.ts';

export interface LinhaMateria {
  id: string;
  tipo: TipoMateriaDou;
  processo_id: string | null;
  contrato_id: string | null;
  aditivo_id: string | null;
  processo_numero: string;
  uasg: string;
  secao: number;
  titulo: string;
  identificacao: string;
  texto: string;
  hash_texto: string;
  obrigatoria: boolean;
  fundamento: string;
  situacao: SituacaoMateriaDou;
  automatica: boolean;
  gerada_em: string;
  gerada_por: string | null;
  gerada_por_nome: string | null;
  protocolo_incom: string | null;
  enviada_em: string | null;
  envio_registrado_por: string | null;
  registrado_por_nome: string | null;
  data_prevista: string | null;
  publicada_em: string | null;
  edicao: string | null;
  pagina: string | null;
  url_publicacao: string | null;
  forma_confirmacao: 'consulta' | 'manual' | null;
  modo_confirmacao: 'offline' | 'online' | null;
  publicacao_registrada_em: string | null;
  conferencias: number;
  ultima_conferencia_em: string | null;
  ultima_conferencia_resultado: string | null;
  jornal_nome: string | null;
  jornal_publicado_em: string | null;
  jornal_registrado_em: string | null;
  contrato_numero: string | null;
  aditivo_numero: string | null;
  conf_situacao: 'pendente' | 'executando' | 'concluida' | 'erro' | null;
  conf_tentativas: number | null;
  conf_erro: string | null;
  conf_disponivel: string | null;
}

const SELECAO = `SELECT m.*, g.nome AS gerada_por_nome, r.nome AS registrado_por_nome, c.numero AS contrato_numero, ad.numero AS aditivo_numero,
       t.situacao AS conf_situacao, t.tentativas AS conf_tentativas, t.ultimo_erro AS conf_erro, t.disponivel_em AS conf_disponivel
  FROM dou_materias m
  LEFT JOIN usuarios g ON g.id = m.gerada_por
  LEFT JOIN usuarios r ON r.id = m.envio_registrado_por
  LEFT JOIN contratos c ON c.id = m.contrato_id
  LEFT JOIN aditivos ad ON ad.id = m.aditivo_id
  LEFT JOIN LATERAL (
    SELECT f.situacao, f.tentativas, f.ultimo_erro, f.disponivel_em FROM fila_tarefas f
     WHERE f.tipo = 'dou.conferencia' AND f.carga->>'materiaId' = m.id::text
     ORDER BY f.criada_em DESC LIMIT 1
  ) t ON true`;

export function mapearMateria(l: LinhaMateria): MateriaDou {
  const tarefa =
    l.conf_situacao === null
      ? null
      : (() => {
          const situacao = situacaoTarefa({ situacao: l.conf_situacao, tentativas: l.conf_tentativas ?? 0 });
          return {
            situacao,
            ultimoErro: situacao === 'concluida' ? null : l.conf_erro,
            proximaTentativaEm: situacao === 'nova_tentativa' ? l.conf_disponivel : null,
          };
        })();
  return {
    id: l.id,
    tipo: l.tipo,
    situacao: l.situacao,
    secao: l.secao,
    titulo: l.titulo,
    identificacao: l.identificacao,
    texto: l.texto,
    hashTexto: l.hash_texto,
    obrigatoria: l.obrigatoria,
    fundamento: l.fundamento,
    uasg: l.uasg,
    processo: { id: l.processo_id, numero: l.processo_numero },
    contrato: l.contrato_id ? { id: l.contrato_id, numero: l.contrato_numero ?? '' } : null,
    aditivo: l.aditivo_id ? { id: l.aditivo_id, numero: l.aditivo_numero ?? '' } : null,
    automatica: l.automatica,
    geradaEm: l.gerada_em,
    geradaPor: l.gerada_por ? { id: l.gerada_por, nome: l.gerada_por_nome ?? '' } : null,
    envio:
      l.protocolo_incom && l.enviada_em && l.data_prevista
        ? {
            protocolo: l.protocolo_incom,
            enviadaEm: l.enviada_em,
            registradoPor: l.envio_registrado_por ? { id: l.envio_registrado_por, nome: l.registrado_por_nome ?? '' } : null,
            dataPrevista: l.data_prevista,
          }
        : null,
    publicacao:
      l.publicada_em && l.forma_confirmacao && l.modo_confirmacao && l.publicacao_registrada_em
        ? {
            data: l.publicada_em,
            edicao: l.edicao,
            pagina: l.pagina,
            url: l.url_publicacao,
            forma: l.forma_confirmacao,
            modo: l.modo_confirmacao,
            registradaEm: l.publicacao_registrada_em,
          }
        : null,
    conferencia: { vezes: l.conferencias, ultimaEm: l.ultima_conferencia_em, resultado: l.ultima_conferencia_resultado, tarefa },
    jornal:
      l.jornal_nome && l.jornal_publicado_em && l.jornal_registrado_em
        ? { nome: l.jornal_nome, data: l.jornal_publicado_em, registradoEm: l.jornal_registrado_em }
        : null,
  };
}

export interface FiltroMaterias {
  tipos: readonly TipoMateriaDou[];
  escopo: string[] | null;
  tipo: TipoMateriaDou | null;
  situacao: SituacaoMateriaDou | null;
  processoId: string | null;
}

function condicoes(f: FiltroMaterias): { where: string; parametros: ParametroSql[] } {
  const parametros: ParametroSql[] = [f.tipos, f.escopo, f.tipo, f.situacao, f.processoId];
  return {
    where: `WHERE m.tipo = ANY($1::text[]) AND ($2::text[] IS NULL OR m.uasg = ANY($2::text[]))
      AND ($3::text IS NULL OR m.tipo = $3) AND ($4::text IS NULL OR m.situacao = $4) AND ($5::uuid IS NULL OR m.processo_id = $5)`,
    parametros,
  };
}

export async function listarMaterias(executor: Executor, f: FiltroMaterias, limite: number, deslocamento: number): Promise<{ itens: MateriaDou[]; total: number }> {
  const { where, parametros } = condicoes(f);
  const linhas = await executor.consultar<LinhaMateria>(`${SELECAO}\n ${where}\n ORDER BY m.gerada_em DESC, m.id LIMIT $6 OFFSET $7`, [...parametros, limite, deslocamento]);
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT count(*)::int AS total FROM dou_materias m ${where}`, parametros);
  return { itens: linhas.map(mapearMateria), total: contagem?.total ?? 0 };
}

export async function obterMateria(executor: Executor, id: string, bloquear = false): Promise<LinhaMateria | null> {
  const [linha] = await executor.consultar<LinhaMateria>(`${SELECAO}\n WHERE m.id = $1${bloquear ? '\n FOR UPDATE OF m' : ''}`, [id]);
  return linha ?? null;
}

export async function contarMaterias(executor: Executor, tipos: readonly TipoMateriaDou[], escopo: string[] | null): Promise<Record<SituacaoMateriaDou, number> & { avisosPendentes: number }> {
  const linhas = await executor.consultar<{ situacao: SituacaoMateriaDou; total: number; avisos: number }>(
    `SELECT situacao, count(*)::int AS total, count(*) FILTER (WHERE tipo = 'aviso_licitacao')::int AS avisos
       FROM dou_materias WHERE tipo = ANY($1::text[]) AND ($2::text[] IS NULL OR uasg = ANY($2::text[]))
      GROUP BY situacao`,
    [tipos, escopo],
  );
  const total = (s: SituacaoMateriaDou) => linhas.find((l) => l.situacao === s)?.total ?? 0;
  const avisosPendentes = linhas.filter((l) => l.situacao !== 'publicada').reduce((soma, l) => soma + l.avisos, 0);
  return { rascunho: total('rascunho'), enviada: total('enviada'), publicada: total('publicada'), avisosPendentes };
}
