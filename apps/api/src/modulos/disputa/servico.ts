/**
 * Sala de disputa (RF-22): leitura das sessões, cálculo do estado pelo @agora/dominio, sigilo dos licitantes durante a
 * etapa de lances, sinais RIA-09 cruzados com RIA-06, julgamento, ata e registro do resultado na disputa do processo.
 */
import type {
  AtaSessao,
  ClassificadoSessao,
  JulgamentoSessao,
  LanceSessao,
  ParticipanteSessao,
  SessaoDisputa,
  SessaoDisputaResumo,
  SinalSessaoDisputa,
  UsoSessaoDisputa,
} from '@agora/contratos';
import {
  AVISO_SINAL_DISPUTA,
  FUNDAMENTOS_PARAMETROS_DISPUTA,
  ErroDominio,
  avaliarReinicioDisputa,
  calcularEstadoSessao,
  calcularEstadoSessaoSimulada,
  classificarOfertas,
  classificarSessaoDisputa,
  cruzarPadroesComVinculos,
  mascararCpf,
  ofertaMelhor,
  ofertaValida,
  redigirAtaSessaoDisputa,
  type ClassificacaoSessaoDisputa,
  type CriterioJulgamentoDisputa,
  type DefinicaoSessaoDisputa,
  type EstadoSessaoDisputa,
  type EventoSessaoDisputa,
  type LanceSessaoDisputa,
  type ModoDisputa,
  type OfertaParaClassificar,
  type ParametrosDisputa,
  type PerfilLicitanteSimulado,
  detectarPadroesLances,
} from '@agora/dominio';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import type { ConsultaSessaoOficial } from '../../integracoes/compras-gov-sessao.ts';
import { nomeExibivel } from '../fornecedores/repositorio.ts';
import { sinaisVinculosDaDisputa } from '../impedimentos/jornada.ts';
import { gravarJson, montarDisputa } from '../jornada/servico.ts';
import type { DisputaArmazenada } from '../jornada/tipos.ts';

export interface ParticipanteArmazenado {
  chave: string;
  fornecedorId: string;
  nome: string;
  tipoPessoa: 'PJ' | 'PF';
  documento: string;
  meEpp: boolean;
  propostaInicial: number | null;
  notaTecnica: number | null;
  perfil: PerfilLicitanteSimulado | null;
}

export type EventoArmazenado = EventoSessaoDisputa & {
  usuarioId: string | null;
  registradoEm: string;
  justificativa?: string;
  origem?: 'transcrito';
};

export interface LinhaSessao {
  id: string;
  processo_id: string;
  uso: UsoSessaoDisputa;
  criterio: CriterioJulgamentoDisputa;
  modo: ModoDisputa;
  parametros: ParametrosDisputa;
  participantes: ParticipanteArmazenado[];
  eventos: EventoArmazenado[];
  cenario: 'concorrencia' | 'conluio_e_robo' | null;
  semente: number;
  valor_referencia: number | null;
  deslocamento_ms: number;
  id_compra: string | null;
  oficial: ConsultaSessaoOficial | null;
  ata: AtaSessao | null;
  conduzida_por: string | null;
  conduzida_por_nome: string | null;
  criada_em: string;
  atualizada_em: string;
  concluida_em: string | null;
  numero_sei: string;
  processo_titulo: string;
  uasg: string;
  etapa_atual: number;
}

export interface VinculoPar {
  a: string;
  b: string;
  descricao: string;
}

const FASES_DE_LANCE = new Set(['aguardando_abertura', 'lances_abertos', 'fechamento_iminente', 'lance_final_fechado']);

const SELECAO = `SELECT s.id, s.processo_id, s.uso, s.criterio, s.modo, s.parametros, s.participantes, s.eventos, s.cenario, s.semente,
         s.valor_referencia, s.deslocamento_ms, s.id_compra, s.oficial, s.ata, s.conduzida_por, u.nome AS conduzida_por_nome,
         s.criada_em, s.atualizada_em, s.concluida_em, p.numero_sei, p.titulo AS processo_titulo, p.uasg, p.etapa_atual
    FROM sessoes_disputa s
    JOIN processos p ON p.id = s.processo_id
    LEFT JOIN usuarios u ON u.id = s.conduzida_por`;

/** Sessão no escopo de UASG do usuário (fora do escopo = não encontrada). */
export async function carregarSessao(executor: Executor, id: string, escopo: string[] | null, bloquear = false): Promise<LinhaSessao | null> {
  const [linha] = await executor.consultar<LinhaSessao>(
    `${SELECAO}
      WHERE s.id = $1 AND ($2::text[] IS NULL OR p.uasg = ANY($2::text[]))${bloquear ? '\n      FOR UPDATE OF s' : ''}`,
    [id, escopo],
  );
  return linha ?? null;
}

export async function listarSessoesDoProcesso(executor: Executor, processoId: string, relogio: Date): Promise<SessaoDisputaResumo[]> {
  const linhas = await executor.consultar<LinhaSessao>(`${SELECAO} WHERE s.processo_id = $1 ORDER BY s.criada_em DESC`, [processoId]);
  return linhas.map((l) => {
    const estado = estadoDe(l, agoraDaSessao(l, relogio));
    return {
      id: l.id,
      uso: l.uso,
      criterio: l.criterio,
      modo: l.modo,
      fase: estado.fase,
      participantes: l.participantes.length,
      lances: estado.lances.length,
      conduzidaPor: l.conduzida_por_nome,
      criadaEm: l.criada_em,
      concluidaEm: l.concluida_em,
    };
  });
}

/** Relógio da sessão: na simulação, o relógio da Ágora mais o adiantamento acumulado. */
export function agoraDaSessao(linha: Pick<LinhaSessao, 'uso' | 'deslocamento_ms'>, agora: Date): string {
  return new Date(agora.getTime() + (linha.uso === 'simulacao' ? linha.deslocamento_ms : 0)).toISOString();
}

// ───────────────────────── estado ─────────────────────────

function ultimosLances(linha: LinhaSessao): Map<string, { valor: number; instante: string }> {
  const mapa = new Map<string, { valor: number; instante: string }>();
  const lances = linha.eventos.filter((e): e is EventoArmazenado & { tipo: 'lance' } => e.tipo === 'lance');
  for (const e of [...lances].sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante))) mapa.set(e.licitanteId, { valor: e.valor, instante: e.instante });
  return mapa;
}

/** Resultado oficial convertido em oferta do critério (desconto equivalente sobre a referência, no maior desconto). */
function ofertaOficial(linha: LinhaSessao, p: ParticipanteArmazenado): number | null {
  const r = linha.oficial?.resultados.find((x) => x.documento === p.documento);
  if (!r) return null;
  if (linha.criterio !== 'maior_desconto') return r.valorTotalHomologado > 0 ? r.valorTotalHomologado : null;
  const referencia = linha.valor_referencia;
  if (referencia === null) return null;
  const desconto = Math.round((1 - r.valorTotalHomologado / referencia) * 10_000) / 100;
  return ofertaValida('maior_desconto', desconto) ? desconto : null;
}

/** Valor conhecido do participante: resultado oficial, último lance transcrito ou proposta. */
function valorConhecido(linha: LinhaSessao, p: ParticipanteArmazenado, lances: Map<string, { valor: number }>): number | null {
  return ofertaOficial(linha, p) ?? lances.get(p.fornecedorId)?.valor ?? p.propostaInicial;
}

/** Definição para o @agora/dominio: na simulação, todos; no acompanhamento, quem tem valor conhecido. */
export function definicaoDe(linha: LinhaSessao): DefinicaoSessaoDisputa | null {
  const lances = ultimosLances(linha);
  const participantes = linha.participantes
    .map((p) => {
      const valor = linha.uso === 'simulacao' ? p.propostaInicial : valorConhecido(linha, p, lances);
      return valor === null
        ? null
        : { id: p.fornecedorId, nome: p.nome, propostaInicial: valor, meEpp: p.meEpp, ...(p.notaTecnica !== null ? { notaTecnica: p.notaTecnica } : {}) };
    })
    .filter((p) => p !== null);
  if (participantes.length === 0) return null;
  return { criterio: linha.criterio, modo: linha.modo, parametros: linha.parametros, participantes, valorReferencia: linha.valor_referencia, semente: linha.semente };
}

function perfisDe(linha: LinhaSessao): Record<string, PerfilLicitanteSimulado> {
  const perfis: Record<string, PerfilLicitanteSimulado> = {};
  for (const p of linha.participantes) if (p.perfil) perfis[p.fornecedorId] = p.perfil;
  return perfis;
}

function eventosDominio(linha: LinhaSessao): EventoSessaoDisputa[] {
  return linha.eventos;
}

/** Acompanhamento: lances transcritos em ordem, sem as regras de tempo (já aplicadas pelo sistema oficial). */
export function estadoAcompanhamento(linha: LinhaSessao, agora: string): EstadoSessaoDisputa {
  const transcritos = linha.eventos
    .filter((e): e is EventoArmazenado & { tipo: 'lance' } => e.tipo === 'lance')
    .sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante) || a.registradoEm.localeCompare(b.registradoEm));
  let melhor: number | null = null;
  const lances: LanceSessaoDisputa[] = transcritos.map((e, i) => {
    const cobre = melhor === null || ofertaMelhor(linha.criterio, e.valor, melhor);
    if (cobre) melhor = e.valor;
    return { sequencia: i + 1, licitanteId: e.licitanteId, valor: e.valor, instante: e.instante, fase: 'lances_abertos', rodada: 0, intermediario: !cobre, origem: 'registrado' };
  });
  const ultimos = ultimosLances(linha);
  const ofertas = linha.participantes.flatMap((p) => {
    const valor = valorConhecido(linha, p, ultimos);
    if (valor === null) return [];
    const ultimo = ultimos.get(p.fornecedorId);
    return [{ licitanteId: p.fornecedorId, valor, instante: ultimo && ofertaOficial(linha, p) === null ? ultimo.instante : null, lanceFinal: null, lanceFinalInstante: null, lances: lances.filter((l) => l.licitanteId === p.fornecedorId).length }];
  });
  const melhorOferta = ofertas.reduce<(typeof ofertas)[number] | null>((m, o) => (m === null || ofertaMelhor(linha.criterio, o.valor, m.valor) ? o : m), null);
  const marcos = [{ instante: linha.criada_em, descricao: 'Acompanhamento da sessão oficial criado na Ágora', fundamento: 'Lei 14.133/2021, art. 17' }];
  if (linha.oficial) {
    marcos.push({
      instante: linha.oficial.consultadoEm,
      descricao: `Compra consultada nos dados abertos do Compras.gov.br (${linha.oficial.modo === 'online' ? 'consulta online' : 'resposta simulada offline'}): ${linha.oficial.compra.situacao ?? 'situação não informada'}`,
      fundamento: 'Lei 14.133/2021, art. 174',
    });
  }
  if (lances.length > 0) marcos.push({ instante: lances.at(-1)?.instante ?? agora, descricao: `${lances.length} lance(s) transcrito(s) da sessão oficial`, fundamento: 'IN SEGES/ME 73/2022, art. 21' });
  const fase = linha.concluida_em ? 'concluida' : linha.oficial?.compra.existeResultado || lances.length > 0 || ofertas.length > 0 ? 'encerrada' : 'lances_abertos';
  if (linha.concluida_em) marcos.push({ instante: linha.concluida_em, descricao: 'Acompanhamento concluído; resultado registrado no processo', fundamento: 'Lei 14.133/2021, arts. 59 a 61' });
  return {
    fase,
    rodada: 0,
    abertaEm: null,
    faseIniciadaEm: null,
    fimPrevisto: null,
    fimSigiloso: false,
    habilitados: [],
    ofertas,
    melhorValor: melhorOferta?.valor ?? null,
    liderId: melhorOferta?.licitanteId ?? null,
    lances,
    recusados: [],
    prorrogacoes: 0,
    marcos,
    negociacoes: [],
    encerradaEm: fase === 'encerrada' || fase === 'concluida' ? (linha.oficial?.consultadoEm ?? lances.at(-1)?.instante ?? null) : null,
    concluidaEm: linha.concluida_em,
    calculadoAte: agora,
    ultimoInstante: null,
  };
}

/** Estado da sessão no instante informado (relógio da sessão). */
export function estadoDe(linha: LinhaSessao, agora: string): EstadoSessaoDisputa {
  if (linha.uso === 'acompanhamento') return estadoAcompanhamento(linha, agora);
  const definicao = definicaoDe(linha);
  if (!definicao) throw new ErroDominio('PARTICIPANTES_INVALIDOS', 'A sessão não tem participantes.');
  const perfis = perfisDe(linha);
  return Object.keys(perfis).length > 0
    ? calcularEstadoSessaoSimulada(definicao, eventosDominio(linha), agora, perfis)
    : calcularEstadoSessao(definicao, eventosDominio(linha), agora);
}

/** Classificação: na simulação, pelo estado; no acompanhamento, pelas ofertas conhecidas (resultado oficial primeiro). */
export function julgarSessao(linha: LinhaSessao, estado: EstadoSessaoDisputa): ClassificacaoSessaoDisputa | null {
  const definicao = definicaoDe(linha);
  if (!definicao) return null;
  try {
    if (linha.uso === 'simulacao') return classificarSessaoDisputa(definicao, estado);
    const ofertas: OfertaParaClassificar[] = estado.ofertas.map((o) => ({ licitanteId: o.licitanteId, valor: o.valor, instante: o.instante, origem: o.instante === null ? 'proposta' : 'lance' }));
    return classificarOfertas(definicao, ofertas);
  } catch (erro) {
    if (erro instanceof ErroDominio) return null;
    throw erro;
  }
}

// ───────────────────────── vínculos (RIA-06) ─────────────────────────

/** Sócio em comum entre licitantes (RIA-06), pelo mesmo cruzamento da etapa 6 (`sinaisVinculosDaDisputa`, frente de vínculos). */
async function vinculosEntreLicitantes(executor: Executor, disputa: DisputaArmazenada): Promise<string[]> {
  const agora = new Date();
  const ids = disputa.licitantes.map((l) => l.fornecedorId);
  if (ids.length < 2) return [];
  return (await sinaisVinculosDaDisputa(executor, ids, [], agora.toISOString().slice(0, 10), agora)).ria06;
}

/** Pares de participantes com sócio em comum, pelo mesmo cruzamento do registro da disputa. */
export async function vinculosDaSessao(executor: Executor, participantes: readonly ParticipanteArmazenado[]): Promise<VinculoPar[]> {
  const comoDisputa = (lista: readonly ParticipanteArmazenado[]): DisputaArmazenada => ({
    licitantes: lista.map((p) => ({ fornecedorId: p.fornecedorId, nome: p.nome, meEpp: p.meEpp, valorProposta: 0 })),
    resultado: null,
    registradaEm: null,
  });
  if ((await vinculosEntreLicitantes(executor, comoDisputa(participantes))).length === 0) return [];
  const pares: VinculoPar[] = [];
  for (const [i, a] of participantes.entries()) {
    for (const b of participantes.slice(i + 1)) {
      for (const descricao of await vinculosEntreLicitantes(executor, comoDisputa([a, b]))) pares.push({ a: a.fornecedorId, b: b.fornecedorId, descricao });
    }
  }
  return pares;
}

// ───────────────────────── apresentação ─────────────────────────

function identidadesOcultas(linha: LinhaSessao, estado: EstadoSessaoDisputa): boolean {
  return linha.uso === 'simulacao' && FASES_DE_LANCE.has(estado.fase);
}

function rotulos(linha: LinhaSessao, ocultas: boolean): Map<string, { chave: string; rotulo: string }> {
  return new Map(
    linha.participantes.map((p) => [
      p.fornecedorId,
      { chave: p.chave, rotulo: ocultas ? `Licitante ${p.chave.slice(1)}` : nomeExibivel(p.tipoPessoa, p.nome) },
    ]),
  );
}

function sinaisDaSessao(linha: LinhaSessao, lances: readonly LanceSessaoDisputa[], vinculos: readonly VinculoPar[], ocultas: boolean): SinalSessaoDisputa[] {
  const r = rotulos(linha, ocultas);
  const rotulo = (id: string) => r.get(id)?.rotulo ?? 'Licitante';
  const chave = (id: string) => r.get(id)?.chave ?? id;
  const nomes = Object.fromEntries([...r.entries()].map(([id, v]) => [id, v.rotulo]));
  const descricaoVinculo = (v: VinculoPar) =>
    ocultas
      ? `${rotulo(v.a)} e ${rotulo(v.b)} têm sócio em comum no cadastro de fornecedores; a identificação aparece ao fim da etapa de lances. Sinal para análise, não constitui acusação.`
      : v.descricao;
  const padroes = cruzarPadroesComVinculos(
    detectarPadroesLances(lances, { criterio: linha.criterio, nomes }),
    vinculos.map((v) => ({ licitantes: [v.a, v.b] as const, descricao: descricaoVinculo(v) })),
  );
  const ria09: SinalSessaoDisputa[] = padroes.map((s) => ({
    regra: 'RIA-09',
    tipo: s.tipo,
    titulo: s.titulo,
    participantes: s.licitantes.map(chave),
    evidencias: s.evidencias,
    fundamento: s.fundamento,
    aviso: s.aviso,
    reforcadoPorVinculo: s.reforcadoPorVinculo,
  }));
  const ria06: SinalSessaoDisputa[] = vinculos.map((v) => ({
    regra: 'RIA-06',
    tipo: 'socio_em_comum',
    titulo: `Sócio em comum — ${rotulo(v.a)} e ${rotulo(v.b)}`,
    participantes: [chave(v.a), chave(v.b)],
    evidencias: [descricaoVinculo(v)],
    fundamento: 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV',
    aviso: AVISO_SINAL_DISPUTA,
    reforcadoPorVinculo: padroes.some((s) => s.reforcadoPorVinculo && s.licitantes.includes(v.a) && s.licitantes.includes(v.b)),
  }));
  const peso = (s: SinalSessaoDisputa) => (s.reforcadoPorVinculo ? 0 : s.regra === 'RIA-06' ? 1 : 2);
  return [...ria06, ...ria09].sort((a, b) => peso(a) - peso(b));
}

function julgamentoContrato(linha: LinhaSessao, estado: EstadoSessaoDisputa, c: ClassificacaoSessaoDisputa, ocultas: boolean): JulgamentoSessao {
  const r = rotulos(linha, ocultas);
  const definicao = definicaoDe(linha);
  const reinicio =
    linha.uso === 'simulacao' && definicao
      ? avaliarReinicioDisputa(definicao, estado)
      : { cabivel: false, diferencaPercentual: null, motivo: 'O reinício da disputa acontece no sistema oficial.', fundamento: 'Lei 14.133/2021, art. 56, § 4º' };
  const oficiais = new Set(linha.participantes.filter((p) => ofertaOficial(linha, p) !== null).map((p) => p.fornecedorId));
  return {
    classificacao: c.classificacao.map(
      (x): ClassificadoSessao => ({
        posicao: x.posicao,
        participante: r.get(x.id)?.chave ?? x.id,
        rotulo: r.get(x.id)?.rotulo ?? x.nome,
        valorOfertado: x.valorOfertado,
        valorConsiderado: x.valorConsiderado,
        origem: linha.uso === 'acompanhamento' && oficiais.has(x.id) ? 'resultado_oficial' : x.origem,
        notaTecnica: x.notaTecnica,
        notaPreco: x.notaPreco,
        notaFinal: x.notaFinal,
      }),
    ),
    empateDetectado: c.empateDetectado,
    criterioDecisivo: c.criterioDecisivo,
    passos: c.passos,
    sorteioNecessario: c.sorteioNecessario,
    acimaDoEstimado: c.acimaDoEstimado,
    memoria: c.memoria,
    fundamento: c.fundamento,
    reinicio,
  };
}

/** Monta a resposta da sala: sigilo durante a etapa de lances, lances finais ocultos até o fim do prazo, sinais e ações. */
export async function montarSessao(executor: Executor, linha: LinhaSessao, relogio: Date, podeConduzir: boolean): Promise<SessaoDisputa> {
  const agora = agoraDaSessao(linha, relogio);
  const estado = estadoDe(linha, agora);
  const ocultas = identidadesOcultas(linha, estado);
  const r = rotulos(linha, ocultas);
  const sigiloFinal = estado.fase === 'lance_final_fechado';
  const visiveis = estado.lances.filter((l) => !(sigiloFinal && l.fase === 'lance_final_fechado'));
  const vinculos = await vinculosDaSessao(executor, linha.participantes);
  const encerrada = estado.fase === 'encerrada' || estado.fase === 'concluida';
  const classificacao = encerrada ? julgarSessao(linha, estado) : null;
  const julgamento = classificacao ? julgamentoContrato(linha, estado, classificacao, ocultas) : null;

  const participantes: ParticipanteSessao[] = [...linha.participantes]
    .sort((a, b) => Number(a.chave.slice(1)) - Number(b.chave.slice(1)))
    .map((p) => {
      const oferta = estado.ofertas.find((o) => o.licitanteId === p.fornecedorId);
      return {
        chave: p.chave,
        rotulo: r.get(p.fornecedorId)?.rotulo ?? p.chave,
        fornecedorId: ocultas ? null : p.fornecedorId,
        nome: ocultas ? null : nomeExibivel(p.tipoPessoa, p.nome),
        meEpp: ocultas ? null : p.meEpp,
        propostaInicial: linha.uso === 'simulacao' && estado.fase === 'aguardando_abertura' ? null : (p.propostaInicial ?? null),
        notaTecnica: p.notaTecnica,
        perfilSimulado: ocultas ? null : p.perfil,
        ofertaAtual: estado.fase === 'aguardando_abertura' ? null : (oferta?.valor ?? null),
        lances: visiveis.filter((l) => l.licitanteId === p.fornecedorId).length,
        lanceFinalRegistrado: oferta?.lanceFinal !== null && oferta?.lanceFinal !== undefined,
        convocado: estado.habilitados.includes(p.fornecedorId),
        lider: estado.fase !== 'aguardando_abertura' && estado.liderId === p.fornecedorId,
      };
    });

  const lances: LanceSessao[] = visiveis.map((l) => ({
    sequencia: l.sequencia,
    participante: r.get(l.licitanteId)?.chave ?? l.licitanteId,
    rotulo: r.get(l.licitanteId)?.rotulo ?? 'Licitante',
    valor: l.valor,
    instante: l.instante,
    fase: l.fase,
    rodada: l.rodada,
    intermediario: l.intermediario,
    origem: linha.uso === 'acompanhamento' ? 'transcrito' : l.origem,
  }));

  const etapaSelecao = linha.etapa_atual === 6;
  const conduz = podeConduzir && etapaSelecao && linha.concluida_em === null;
  const simulacao = linha.uso === 'simulacao';
  const emLances = estado.fase === 'lances_abertos' || estado.fase === 'fechamento_iminente' || estado.fase === 'lance_final_fechado';
  const primeiro = julgamento?.classificacao[0];

  return {
    id: linha.id,
    processoId: linha.processo_id,
    numeroSei: linha.numero_sei,
    processoTitulo: linha.processo_titulo,
    uso: linha.uso,
    criterio: linha.criterio,
    modo: linha.modo,
    parametros: linha.parametros,
    fundamentosParametros: { ...FUNDAMENTOS_PARAMETROS_DISPUTA },
    cenario: linha.cenario,
    idCompra: linha.id_compra,
    valorReferencia: linha.valor_referencia,
    fase: estado.fase,
    rodada: estado.rodada,
    agora,
    adiantamentoSegundos: Math.round(linha.deslocamento_ms / 1000),
    abertaEm: estado.abertaEm,
    faseIniciadaEm: estado.faseIniciadaEm,
    fimPrevisto: estado.fimSigiloso ? null : estado.fimPrevisto,
    fimSigiloso: estado.fimSigiloso,
    encerradaEm: estado.encerradaEm,
    concluidaEm: estado.concluidaEm ?? linha.concluida_em,
    identidadesOcultas: ocultas,
    participantes,
    melhorOferta: estado.fase === 'aguardando_abertura' ? null : estado.melhorValor,
    lider: estado.fase === 'aguardando_abertura' || estado.liderId === null ? null : (r.get(estado.liderId)?.chave ?? null),
    lances,
    lancesSigilosos: estado.lances.length - visiveis.length,
    prorrogacoes: estado.prorrogacoes,
    marcos: estado.marcos,
    sinais: sinaisDaSessao(linha, visiveis, vinculos, ocultas),
    julgamento,
    oficial: linha.oficial
      ? {
          ...linha.oficial,
          resultados: linha.oficial.resultados.map((x) => ({
            participante: linha.participantes.find((p) => p.documento === x.documento)?.chave ?? null,
            documento: x.tipoPessoa === 'PF' ? mascararCpf(x.documento) : x.documento,
            nome: nomeExibivel(x.tipoPessoa, x.nome),
            valorTotalHomologado: x.valorTotalHomologado,
            itens: x.itens,
          })),
        }
      : null,
    conduzidaPor: linha.conduzida_por_nome,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
    acoes: {
      abrir: conduz && simulacao && estado.fase === 'aguardando_abertura',
      adiantarRelogio: conduz && simulacao && emLances,
      registrarLance: conduz && simulacao && emLances,
      transcreverLances: conduz && !simulacao,
      sincronizar: conduz && !simulacao,
      reiniciar: conduz && simulacao && (julgamento?.reinicio.cabivel ?? false),
      negociar: conduz && simulacao && estado.fase === 'encerrada' && primeiro !== undefined,
      encerrar: conduz && estado.fase === 'encerrada' && (julgamento?.classificacao.length ?? 0) > 0,
    },
  };
}

// ───────────────────────── ata e registro no processo ─────────────────────────

export async function redigirAta(executor: Executor, linha: LinhaSessao, estado: EstadoSessaoDisputa, emitidaEm: string, definitiva: boolean): Promise<AtaSessao> {
  const definicao = definicaoDe(linha);
  const classificacao = julgarSessao(linha, estado);
  if (!definicao || !classificacao) throw new ErroDominio('ACAO_SESSAO_INVALIDA', 'A sessão ainda não tem ofertas para a ata.');
  const vinculos = await vinculosDaSessao(executor, linha.participantes);
  const nomes = Object.fromEntries(linha.participantes.map((p) => [p.fornecedorId, nomeExibivel(p.tipoPessoa, p.nome)]));
  const sinais = cruzarPadroesComVinculos(
    detectarPadroesLances(estado.lances, { criterio: linha.criterio, nomes }),
    vinculos.map((v) => ({ licitantes: [v.a, v.b] as const, descricao: v.descricao })),
  );
  const definicaoComNomes: DefinicaoSessaoDisputa = { ...definicao, participantes: definicao.participantes.map((p) => ({ ...p, nome: nomes[p.id] ?? p.nome })) };
  const ata = redigirAtaSessaoDisputa(definicaoComNomes, estado, { ...classificacao, classificacao: classificacao.classificacao.map((c) => ({ ...c, nome: nomes[c.id] ?? c.nome })) }, sinais, {
    uso: linha.uso,
    processo: { numeroSei: linha.numero_sei, titulo: linha.processo_titulo, uasg: linha.uasg },
    conduzidaPor: linha.conduzida_por_nome ?? 'Agente de contratação',
    emitidaEm,
    idCompra: linha.id_compra,
    vinculos: vinculos.map((v) => v.descricao),
    proveniencia: linha.oficial
      ? `Compras.gov.br, ${linha.oficial.modo === 'online' ? 'consulta online' : 'resposta simulada offline'} em ${linha.oficial.consultadoEm}, ${linha.oficial.registros} registro(s), SHA-256 ${linha.oficial.hash}`
      : null,
  });
  return { ...ata, definitiva };
}

/**
 * Registra o resultado da sessão na disputa do processo: licitantes do cadastro (nome e porte lidos por `montarDisputa`)
 * com o valor considerado e a classificação da sessão (ordem de registro dos lances, art. 60, técnica e preço).
 */
export async function registrarResultadoNoProcesso(
  tx: Transacao,
  linha: LinhaSessao,
  classificacao: ClassificacaoSessaoDisputa,
  agora: Date,
): Promise<DisputaArmazenada> {
  const disputa = await montarDisputa(
    tx,
    classificacao.classificacao.map((c) => ({ id: c.id, valorProposta: c.valorConsiderado })),
    agora,
  );
  const nomes = new Map(disputa.licitantes.map((l) => [l.fornecedorId, l.nome]));
  disputa.resultado = {
    classificacao: classificacao.classificacao.map((c) => ({ id: c.id, nome: nomes.get(c.id) ?? c.nome, posicao: c.posicao, valorConsiderado: c.valorConsiderado })),
    empateDetectado: classificacao.empateDetectado,
    criterioDecisivo: classificacao.criterioDecisivo,
    passos: classificacao.passos,
    sorteioNecessario: classificacao.sorteioNecessario,
  };
  await gravarJson(tx, linha.processo_id, 'disputa', disputa, agora);
  return disputa;
}
