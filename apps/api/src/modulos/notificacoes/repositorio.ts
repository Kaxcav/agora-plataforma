import type {
  CanalNotificacao,
  ContagemEnvios,
  EnvioNotificacao,
  EstadoNotificacoes,
  FaixaVencimento,
  NotificacaoDetalhe,
  NotificacaoResumo,
  PapelDestinatario,
  PreferenciaNotificacao,
  SituacaoEnvio,
  TipoNotificacao,
  VencimentoLinhaTempo,
} from '@agora/contratos';
import { adicionarDias, avisoObrigatorio, faixaVencimento, mascararEmail, preferenciaPadrao, TIPOS_NOTIFICACAO, TIPOS_PREFERENCIA_NOTIFICACAO } from '@agora/dominio';
import type { Executor, ParametroSql } from '../../banco/tipos.ts';
import type { Config } from '../../config.ts';
import { classificar, usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { identificadorInstrumento, padraoContem } from '../../compartilhado/texto.ts';
import type { DriversCanais } from './canais.ts';

export interface FiltroNotificacoesSql {
  escopo: string[] | null;
  tipo?: TipoNotificacao | undefined;
  origem?: 'automatica' | 'manual' | undefined;
  situacao?: SituacaoEnvio | undefined;
  faixa?: number | undefined;
  /** "Minhas": notificações com envio para este usuário. */
  destinatarioId?: string | undefined;
  instrumentoTipo?: 'ata' | 'contrato' | undefined;
  instrumentoId?: string | undefined;
  busca?: string | undefined;
  id?: string | undefined;
}

/** Envio vigente: o que não foi substituído por um reenvio (o original continua no histórico do detalhe). */
const ENVIO_VIGENTE = 'NOT EXISTS (SELECT 1 FROM notificacoes_envios r WHERE r.reenvio_de = e.id)';

function condicoes(f: FiltroNotificacoesSql): { where: string; parametros: ParametroSql[] } {
  const parametros: ParametroSql[] = [
    f.escopo,
    f.tipo ?? null,
    f.origem ?? null,
    f.situacao ?? null,
    f.faixa ?? null,
    f.destinatarioId ?? null,
    f.instrumentoTipo ?? null,
    f.instrumentoId ?? null,
    f.busca ? padraoContem(f.busca) : null,
    f.id ?? null,
  ];
  const where = `
    WHERE ($1::text[] IS NULL OR n.uasg = ANY($1::text[]))
      AND ($2::text IS NULL OR n.tipo = $2)
      AND ($3::text IS NULL OR n.origem = $3)
      AND ($4::text IS NULL OR EXISTS (
            SELECT 1 FROM notificacoes_envios e
             WHERE e.notificacao_id = n.id AND ${ENVIO_VIGENTE}
               AND (e.situacao = $4 OR ($4 = 'pendente' AND e.situacao = 'enviando'))))
      AND ($5::integer IS NULL OR n.faixa = $5)
      AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM notificacoes_envios e WHERE e.notificacao_id = n.id AND e.usuario_id = $6))
      AND ($7::text IS NULL OR n.instrumento_tipo = $7)
      AND ($8::uuid IS NULL OR n.instrumento_id = $8)
      AND ($9::text IS NULL OR n.busca_normalizada LIKE $9 ESCAPE '\\')
      AND ($10::uuid IS NULL OR n.id = $10)`;
  return { where, parametros };
}

interface LinhaNotificacao {
  id: string;
  tipo: TipoNotificacao;
  origem: 'automatica' | 'manual';
  instrumento_tipo: 'ata' | 'contrato';
  instrumento_id: string;
  numero: string | null;
  uasg: string;
  faixa: number | null;
  obrigatoria: boolean;
  assunto: string;
  corpo: string;
  fundamento: string;
  criada_em: string;
  criada_por: string | null;
  criada_por_nome: string | null;
  total: number;
  enviados: number;
  pendentes: number;
  falhas: number;
  suprimidos: number;
}

const SELECAO = `
  SELECT n.id, n.tipo, n.origem, n.instrumento_tipo, n.instrumento_id, COALESCE(c.numero, a.numero) AS numero, n.uasg, n.faixa,
         n.obrigatoria, n.assunto, n.corpo, n.fundamento, n.criada_em, n.criada_por, u.nome AS criada_por_nome,
         k.total, k.enviados, k.pendentes, k.falhas, k.suprimidos
    FROM notificacoes n
    LEFT JOIN usuarios u ON u.id = n.criada_por
    LEFT JOIN contratos c ON n.instrumento_tipo = 'contrato' AND c.id = n.instrumento_id
    LEFT JOIN atas a ON n.instrumento_tipo = 'ata' AND a.id = n.instrumento_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS total,
             (COUNT(*) FILTER (WHERE e.situacao = 'enviado'))::integer AS enviados,
             (COUNT(*) FILTER (WHERE e.situacao IN ('pendente', 'enviando')))::integer AS pendentes,
             (COUNT(*) FILTER (WHERE e.situacao = 'falhou'))::integer AS falhas,
             (COUNT(*) FILTER (WHERE e.situacao = 'suprimido'))::integer AS suprimidos
        FROM notificacoes_envios e
       WHERE e.notificacao_id = n.id AND ${ENVIO_VIGENTE}
    ) k ON true`;

function faixaValida(valor: number | null): FaixaVencimento | null {
  return valor === 30 || valor === 60 || valor === 90 || valor === 120 ? valor : null;
}

function mapearResumo(l: LinhaNotificacao): NotificacaoResumo {
  const contagem: ContagemEnvios = { total: l.total, enviados: l.enviados, pendentes: l.pendentes, falhas: l.falhas, suprimidos: l.suprimidos };
  return {
    id: l.id,
    tipo: l.tipo,
    origem: l.origem,
    instrumento: {
      tipo: l.instrumento_tipo,
      id: l.instrumento_id,
      identificador: l.numero === null ? (l.instrumento_tipo === 'ata' ? 'Ata' : 'Contrato') : identificadorInstrumento(l.instrumento_tipo, l.numero),
    },
    uasg: l.uasg,
    faixa: faixaValida(l.faixa),
    obrigatoria: l.obrigatoria,
    assunto: l.assunto,
    criadaEm: l.criada_em,
    criadaPor: usuarioResumo(l.criada_por, l.criada_por_nome),
    contagem,
  };
}

export async function listarNotificacoes(
  executor: Executor,
  filtro: FiltroNotificacoesSql,
  limite: number,
  deslocamento: number,
): Promise<{ itens: NotificacaoResumo[]; total: number }> {
  const { where, parametros } = condicoes(filtro);
  const [contagem] = await executor.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total FROM notificacoes n ${where}`, parametros);
  const linhas = await executor.consultar<LinhaNotificacao>(
    `${SELECAO} ${where} ORDER BY n.criada_em DESC, n.id LIMIT $11 OFFSET $12`,
    [...parametros, limite, deslocamento],
  );
  return { itens: linhas.map(mapearResumo), total: contagem?.total ?? 0 };
}

interface LinhaEnvio {
  id: string;
  canal: CanalNotificacao;
  papel: PapelDestinatario;
  destinatario: string;
  endereco: string | null;
  situacao: SituacaoEnvio;
  tentativas: number;
  max_tentativas: number;
  proxima_tentativa_em: string | null;
  ultima_tentativa_em: string | null;
  enviado_em: string | null;
  modo: EnvioNotificacao['modo'];
  protocolo: string | null;
  ultimo_erro: string | null;
  motivo_supressao: string | null;
  base_legal: string;
  reenvio_de: string | null;
  criado_em: string;
}

/** E-mail sempre mascarado na resposta (LGPD); o processo SEI é dado do processo, não pessoal. */
function enderecoExibido(canal: CanalNotificacao, endereco: string | null): string | null {
  if (endereco === null || canal !== 'email') return endereco;
  try {
    return mascararEmail(endereco);
  } catch {
    return 'e-mail inválido';
  }
}

export async function obterNotificacao(executor: Executor, id: string, escopo: string[] | null): Promise<NotificacaoDetalhe | null> {
  const { where, parametros } = condicoes({ escopo, id });
  const [linha] = await executor.consultar<LinhaNotificacao>(`${SELECAO} ${where}`, parametros);
  if (!linha) return null;
  const envios = await executor.consultar<LinhaEnvio>(
    `SELECT id, canal, papel, destinatario, endereco, situacao, tentativas, max_tentativas, proxima_tentativa_em, ultima_tentativa_em,
            enviado_em, modo, protocolo, ultimo_erro, motivo_supressao, base_legal, reenvio_de, criado_em
       FROM notificacoes_envios
      WHERE notificacao_id = $1
      ORDER BY criado_em, CASE papel WHEN 'gestor' THEN 1 WHEN 'fiscal' THEN 2 WHEN 'responsavel' THEN 3 ELSE 4 END, destinatario, canal`,
    [id],
  );
  return {
    ...mapearResumo(linha),
    corpo: linha.corpo,
    fundamento: linha.fundamento,
    envios: envios.map((e) => ({
      id: e.id,
      canal: e.canal,
      papel: e.papel,
      destinatario: e.destinatario,
      endereco: enderecoExibido(e.canal, e.endereco),
      situacao: e.situacao,
      tentativas: e.tentativas,
      maxTentativas: e.max_tentativas,
      proximaTentativaEm: e.proxima_tentativa_em,
      ultimaTentativaEm: e.ultima_tentativa_em,
      enviadoEm: e.enviado_em,
      modo: e.modo,
      protocolo: e.protocolo,
      ultimoErro: e.ultimo_erro,
      motivoSupressao: e.motivo_supressao,
      baseLegal: e.base_legal,
      reenvioDe: e.reenvio_de,
      criadoEm: e.criado_em,
    })),
  };
}

/** Envio e a UASG da sua notificação (para conferir o escopo antes do reenvio). */
export async function obterEnvio(
  executor: Executor,
  id: string,
  escopo: string[] | null,
): Promise<{ id: string; notificacaoId: string; situacao: SituacaoEnvio; canal: CanalNotificacao; papel: PapelDestinatario; instrumentoTipo: 'ata' | 'contrato'; instrumentoId: string; reenviado: boolean } | null> {
  const [linha] = await executor.consultar<{
    id: string;
    notificacao_id: string;
    situacao: SituacaoEnvio;
    canal: CanalNotificacao;
    papel: PapelDestinatario;
    instrumento_tipo: 'ata' | 'contrato';
    instrumento_id: string;
    reenviado: boolean;
  }>(
    `SELECT e.id, e.notificacao_id, e.situacao, e.canal, e.papel, n.instrumento_tipo, n.instrumento_id,
            EXISTS (SELECT 1 FROM notificacoes_envios r WHERE r.reenvio_de = e.id) AS reenviado
       FROM notificacoes_envios e
       JOIN notificacoes n ON n.id = e.notificacao_id
      WHERE e.id = $1 AND ($2::text[] IS NULL OR n.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  if (!linha) return null;
  return {
    id: linha.id,
    notificacaoId: linha.notificacao_id,
    situacao: linha.situacao,
    canal: linha.canal,
    papel: linha.papel,
    instrumentoTipo: linha.instrumento_tipo,
    instrumentoId: linha.instrumento_id,
    reenviado: linha.reenviado,
  };
}

// ───────────────────────── Preferências ─────────────────────────

const CANAIS_PESSOAIS = ['email', 'govbr'] as const;

function textoObrigatorios(tipo: TipoNotificacao): string | null {
  if (avisoObrigatorio(tipo, null)) return 'Avisos de ocorrência são obrigatórios e chegam por e-mail mesmo com a preferência desligada.';
  if (tipo === 'vencimento' && avisoObrigatorio(tipo, 30)) {
    return 'O aviso da faixa de 30 dias é obrigatório e chega por e-mail mesmo com a preferência desligada.';
  }
  return null;
}

export async function listarPreferencias(executor: Executor, usuarioId: string): Promise<PreferenciaNotificacao[]> {
  const gravadas = await executor.consultar<{ tipo: TipoNotificacao; canal: 'email' | 'govbr'; ativo: boolean }>(
    'SELECT tipo, canal, ativo FROM notificacoes_preferencias WHERE usuario_id = $1',
    [usuarioId],
  );
  return TIPOS_PREFERENCIA_NOTIFICACAO.flatMap((tipo) =>
    CANAIS_PESSOAIS.map((canal): PreferenciaNotificacao => {
      const gravada = gravadas.find((g) => g.tipo === tipo && g.canal === canal);
      return {
        tipo,
        canal,
        ativo: gravada?.ativo ?? preferenciaPadrao(canal),
        padrao: gravada === undefined,
        obrigatorios: canal === 'email' ? textoObrigatorios(tipo) : null,
      };
    }),
  );
}

// ───────────────────────── Estado dos canais e da fila ─────────────────────────

export async function estadoNotificacoes(executor: Executor, config: Config, drivers: DriversCanais, hoje: string): Promise<EstadoNotificacoes> {
  // Brasília não tem horário de verão desde 2019: o dia começa às 03:00 UTC.
  const inicioDia = `${hoje}T03:00:00.000Z`;
  const [fila] = await executor.consultar<{ pendentes: number; falhas: number; enviados_hoje: number }>(
    `SELECT (COUNT(*) FILTER (WHERE e.situacao IN ('pendente', 'enviando')))::integer AS pendentes,
            (COUNT(*) FILTER (WHERE e.situacao = 'falhou' AND ${ENVIO_VIGENTE}))::integer AS falhas,
            (COUNT(*) FILTER (WHERE e.situacao = 'enviado' AND e.enviado_em >= $1))::integer AS enviados_hoje
       FROM notificacoes_envios e`,
    [inicioDia],
  );
  const [varredura] = await executor.consultar<{ data: string; executada_em: string; notificacoes_criadas: number; envios_criados: number }>(
    'SELECT data, executada_em, notificacoes_criadas, envios_criados FROM notificacoes_varreduras ORDER BY data DESC LIMIT 1',
  );
  return {
    canais: (['email', 'sei', 'govbr'] as const).map((canal) => ({ canal, modo: drivers[canal].modo, descricao: drivers[canal].descricao })),
    agendador: config.notificacoes.agendador,
    fila: { pendentes: fila?.pendentes ?? 0, falhas: fila?.falhas ?? 0, enviadosHoje: fila?.enviados_hoje ?? 0 },
    ultimaVarredura: varredura
      ? {
          data: varredura.data,
          executadaEm: varredura.executada_em,
          notificacoesCriadas: varredura.notificacoes_criadas,
          enviosCriados: varredura.envios_criados,
        }
      : null,
  };
}

// ───────────────────────── Linha do tempo de vencimentos (painel) ─────────────────────────

export async function linhaTempoVencimentos(executor: Executor, escopo: string[] | null, uasg: string | null, hoje: string): Promise<VencimentoLinhaTempo[]> {
  const limite = adicionarDias(hoje, 120);
  const linhas = await executor.consultar<{ tipo: 'ata' | 'contrato'; id: string; numero: string; objeto: string; uasg: string; vigencia_fim: string }>(
    `SELECT 'contrato' AS tipo, id, numero, objeto, uasg, vigencia_fim FROM contratos
      WHERE vigencia_fim BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR uasg = ANY($3::text[])) AND ($4::text IS NULL OR uasg = $4)
     UNION ALL
     SELECT 'ata' AS tipo, id, numero, objeto, uasg, vigencia_fim FROM atas
      WHERE vigencia_fim BETWEEN $1 AND $2 AND ($3::text[] IS NULL OR uasg = ANY($3::text[])) AND ($4::text IS NULL OR uasg = $4)`,
    [hoje, limite, escopo, uasg],
  );
  return linhas
    .flatMap((l): VencimentoLinhaTempo[] => {
      const vigencia = classificar(l.vigencia_fim, hoje);
      const faixa = faixaVencimento(vigencia.diasRestantes);
      if (faixa === null) return [];
      return [
        {
          tipo: l.tipo,
          id: l.id,
          identificador: identificadorInstrumento(l.tipo, l.numero),
          objeto: l.objeto,
          uasg: l.uasg,
          vigenciaFim: l.vigencia_fim,
          diasRestantes: vigencia.diasRestantes,
          semaforo: vigencia.semaforo,
          faixa,
        },
      ];
    })
    .sort((a, b) => a.diasRestantes - b.diasRestantes || a.identificador.localeCompare(b.identificador, 'pt-BR'));
}
