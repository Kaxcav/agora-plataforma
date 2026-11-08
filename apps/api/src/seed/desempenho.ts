import {
  adicionarDias,
  avaliarDesempenhoContratado,
  categoriaPadraoFato,
  mascararDocumento,
  redigirDocumentoAvaliacaoDesempenho,
  type IndicadoresAvaliacao,
  type TipoSancao,
} from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { sha256Hex } from '../compartilhado/cripto.ts';
import { instanteEm, type ContextoSeed, type ContratoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/** Semente própria: a etapa não altera a sequência pseudoaleatória das etapas anteriores. */
const SEMENTE_DESEMPENHO = 14_133_023;

/**
 * Notas do registro de desempenho dos fornecedores que disputam os processos sintéticos da jornada. São as mesmas
 * notas com que a carga da jornada registrou essas disputas: o registro cadastral passa a ser a fonte delas (RN-37).
 */
export const NOTAS_REGISTRO_DEMONSTRACAO: Readonly<Record<string, number>> = Object.freeze({
  escudo: 92,
  boreal: 85,
  guardiao: 88,
  rota: 90,
  fortaleza: 86,
  horizonte: 71,
});

type TipoOcorrencia = 'ocorrencia' | 'glosa' | 'atraso' | 'rescisao';

/** Fatos sintéticos da execução, por palavra do objeto do contrato (base das lições aprendidas, RIA-12). */
const OCORRENCIAS_POR_OBJETO: readonly { termo: string; fatos: readonly { tipo: TipoOcorrencia; descricao: string; diasAtraso?: number; valorGlosa?: number }[] }[] = [
  {
    termo: 'coletes',
    fatos: [
      { tipo: 'atraso', descricao: 'Lote de coletes entregue depois do prazo do cronograma, sem justificativa aceita.', diasAtraso: 18 },
      { tipo: 'ocorrencia', descricao: 'Coletes com etiqueta de proteção balística ilegível; o lote foi substituído pelo contratado.' },
    ],
  },
  {
    termo: 'viaturas caracterizadas',
    fatos: [
      { tipo: 'atraso', descricao: 'Entrega das viaturas caracterizadas atrasada por falta de chassis no fornecedor.', diasAtraso: 25 },
      { tipo: 'ocorrencia', descricao: 'Grafismo das viaturas fora do padrão visual previsto no termo de referência.' },
    ],
  },
  {
    termo: 'manutenção preventiva',
    fatos: [
      { tipo: 'glosa', descricao: 'Glosa por tempo de reparo acima do nível de serviço contratado em três ordens de serviço.', valorGlosa: 412_500 },
      { tipo: 'atraso', descricao: 'Ordens de serviço de manutenção preventiva concluídas fora do prazo.', diasAtraso: 6 },
    ],
  },
  {
    termo: 'rádios',
    fatos: [
      { tipo: 'ocorrencia', descricao: 'Baterias dos rádios portáteis com autonomia inferior à especificada no teste de recebimento.' },
      { tipo: 'atraso', descricao: 'Entrega de rádios móveis atrasada em relação ao cronograma.', diasAtraso: 12 },
    ],
  },
  {
    termo: 'pneus',
    fatos: [
      { tipo: 'ocorrencia', descricao: 'Pneus entregues com data de fabricação acima do limite previsto no termo de referência.' },
      { tipo: 'rescisao', descricao: 'Rescisão por inexecução parcial depois de reiteradas entregas fora da especificação.' },
    ],
  },
  {
    termo: 'munição',
    fatos: [{ tipo: 'ocorrencia', descricao: 'Lote de munição de treinamento com embalagem violada, devolvido na conferência.' }],
  },
];

interface LinhaContratoSeed {
  id: string;
  uasg: string;
  uasg_nome: string;
  uasg_sigla: string;
  documento: string;
  razao_social: string;
}

/** Contagens de entrega e recebimento que levam à nota-alvo com as ocorrências e sanções do período (busca determinística). */
function indicadoresParaNota(
  alvo: number,
  ocorrencias: { total: number; resolvidas: number },
  base: { periodoInicio: string; periodoFim: string; vigenciaInicio: string; vigenciaFim: string; sancoes: { tipo: TipoSancao; dataAplicacao: string }[] },
  hoje: string,
): IndicadoresAvaliacao | null {
  for (const total of [20, 40, 50]) {
    for (let a = total; a >= Math.floor(total / 2); a -= 1) {
      for (let b = total; b >= Math.floor(total / 2); b -= 1) {
        const indicadores = {
          entregasNoPrazo: a,
          entregasTotal: total,
          recebimentosAprovados: b,
          recebimentosTotal: total,
          ocorrenciasFiscalizacao: ocorrencias.total,
          ocorrenciasResolvidasNoPrazo: ocorrencias.resolvidas,
        };
        const r = avaliarDesempenhoContratado({ tipo: 'parcial', ...base, indicadores, motivacao: 'x'.repeat(60) }, hoje);
        if (r.nota === alvo) return indicadores;
      }
    }
  }
  return null;
}

export async function gerarDesempenhoLicoes(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados, eventos } = ctx;
  const prng = new Prng(SEMENTE_DESEMPENHO);
  const porChave = new Map(dados.fornecedores.map((f) => [f.id, f.chave]));
  const nomes = new Map([...dados.usuarios.values()].map((u) => [u.id, u.nome]));
  const linhas = await tx.consultar<LinhaContratoSeed>(
    `SELECT c.id, c.uasg, u.nome AS uasg_nome, u.sigla AS uasg_sigla, f.documento, f.razao_social
       FROM contratos c JOIN uasgs u ON u.codigo = c.uasg JOIN fornecedores f ON f.id = c.fornecedor_id`,
  );
  const porId = new Map(linhas.map((l) => [l.id, l]));

  // ───────── ocorrências da execução (art. 117) ─────────
  const ocorrencias: (readonly (string | number | null)[])[] = [];
  const ocorrenciasPorContrato = new Map<string, { data: string; situacao: string; tipo: TipoOcorrencia }[]>();
  const elegiveis = (c: ContratoSeed) => adicionarDias(c.vigenciaInicio, 60) <= hoje;
  for (const grupo of OCORRENCIAS_POR_OBJETO) {
    const contratos = dados.contratos.filter((c) => c.objeto.toLocaleLowerCase('pt-BR').includes(grupo.termo) && elegiveis(c)).sort((a, b) => a.numero.localeCompare(b.numero) || a.id.localeCompare(b.id));
    for (const c of contratos.slice(0, 3)) {
      const linha = porId.get(c.id);
      if (!linha) continue;
      const fimJanela = c.vigenciaFim < hoje ? c.vigenciaFim : adicionarDias(hoje, -15);
      grupo.fatos.forEach((f, i) => {
        const data = adicionarDias(c.vigenciaInicio, 20 + i * 15 + prng.inteiro(0, 8));
        if (data > fimJanela) return;
        const resolvida = f.tipo === 'rescisao' ? 'resolvida_fora_do_prazo' : prng.chance(0.5) ? 'resolvida_no_prazo' : 'resolvida_fora_do_prazo';
        const id = prng.uuid();
        ocorrencias.push([
          id,
          c.id,
          linha.uasg,
          f.tipo,
          categoriaPadraoFato(f.tipo),
          data,
          f.descricao,
          f.tipo === 'atraso' ? (f.diasAtraso ?? 1) : null,
          f.tipo === 'glosa' ? (f.valorGlosa ?? 100) : null,
          resolvida,
          adicionarDias(data, f.tipo === 'rescisao' ? 0 : 7),
          c.fiscalId,
          instanteEm(data, prng, agora).toISOString(),
        ]);
        ocorrenciasPorContrato.set(c.id, [...(ocorrenciasPorContrato.get(c.id) ?? []), { data, situacao: resolvida, tipo: f.tipo }]);
        eventos.push({
          ocorridoEm: instanteEm(data, prng, agora),
          usuarioId: c.fiscalId,
          acao: 'execucao.ocorrencia.registrar',
          recurso: 'ocorrencia_execucao',
          recursoId: id,
          resumo: `Registrou ${f.tipo === 'ocorrencia' ? 'ocorrência' : f.tipo === 'rescisao' ? 'rescisão' : f.tipo} na execução do contrato ${c.numero}`,
          dados: { instrumentoTipo: 'contrato', instrumentoId: c.id, tipo: f.tipo, data },
        });
      });
    }
  }
  await inserirEmLote(
    tx,
    'ocorrencias_execucao',
    ['id', 'contrato_id', 'uasg', 'tipo', 'categoria', 'data', 'descricao', 'dias_atraso', 'valor_glosa', 'situacao', 'resolvida_em', 'registrada_por', 'registrada_em'],
    ocorrencias,
  );

  // ───────── avaliações definitivas do registro cadastral (art. 88, § 3º) ─────────
  const sancoes = await tx.consultar<{ contrato_id: string; tipo: TipoSancao; aplicada_em: string }>(
    "SELECT contrato_id, tipo, aplicada_em FROM sancoes WHERE contrato_id IS NOT NULL AND situacao = 'aplicada' AND aplicada_em IS NOT NULL",
  );
  const avaliacoes: (readonly (string | number | null)[])[] = [];
  for (const [chave, alvo] of Object.entries(NOTAS_REGISTRO_DEMONSTRACAO)) {
    const fornecedor = dados.fornecedores.find((f) => f.chave === chave);
    if (!fornecedor) continue;
    const contrato = dados.contratos
      .filter((c) => c.fornecedorId === fornecedor.id && adicionarDias(c.vigenciaInicio, 90) <= hoje)
      .sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio) || a.id.localeCompare(b.id))[0];
    const linha = contrato ? porId.get(contrato.id) : undefined;
    if (!contrato || !linha) continue;
    const final = contrato.vigenciaFim < adicionarDias(hoje, -30);
    const periodoInicio = contrato.vigenciaInicio;
    const periodoFim = final ? contrato.vigenciaFim : adicionarDias(hoje, -30);
    // Mesma regra do servidor (derivadosDoPeriodo): ocorrências, glosas e atrasos do período; a rescisão não conta.
    const doPeriodo = (ocorrenciasPorContrato.get(contrato.id) ?? []).filter((o) => o.tipo !== 'rescisao' && o.data >= periodoInicio && o.data <= periodoFim);
    const sancoesPeriodo = sancoes.filter((s) => s.contrato_id === contrato.id).map((s) => ({ tipo: s.tipo, dataAplicacao: s.aplicada_em }));
    const base = { periodoInicio, periodoFim, vigenciaInicio: contrato.vigenciaInicio, vigenciaFim: contrato.vigenciaFim, sancoes: sancoesPeriodo };
    const indicadores = indicadoresParaNota(alvo, { total: doPeriodo.length, resolvidas: doPeriodo.filter((o) => o.situacao === 'resolvida_no_prazo').length }, base, hoje);
    if (!indicadores) continue;
    const emissao = adicionarDias(periodoFim, 3);
    const motivacao =
      'Indicadores aferidos nos termos de recebimento e no registro de ocorrências do período; as falhas apontadas foram tratadas pelo contratado conforme registrado pela fiscalização.';
    const r = avaliarDesempenhoContratado({ tipo: final ? 'final' : 'parcial', ...base, indicadores, motivacao }, emissao, ctx.calendario);
    const [seq] = await tx.consultar<{ n: number }>("SELECT nextval('avaliacoes_desempenho_protocolo_seq')::int AS n");
    const protocolo = `RCD-${emissao.slice(0, 4)}-${String(seq?.n ?? 0).padStart(6, '0')}`;
    const avaliador = nomes.get(contrato.gestorId) ?? 'Gestor do contrato';
    const concorda = prng.chance(0.5);
    const recebidaEm = adicionarDias(emissao, 2);
    const manifestacao = concorda
      ? { texto: 'O contratado declarou ciência da avaliação e concordou com os indicadores.', recebidaEm, concorda: true, registradaPor: { id: contrato.gestorId, nome: avaliador }, registradaEm: instanteEm(recebidaEm, prng, agora).toISOString() }
      : null;
    const evidencias = `Termos de recebimento do período e registro de ocorrências do contrato ${contrato.numero}.`;
    const documento = redigirDocumentoAvaliacaoDesempenho({
      protocolo,
      versao: 1,
      orgao: `${linha.uasg_sigla} — ${linha.uasg_nome}`,
      uasg: linha.uasg,
      contrato: { numero: contrato.numero, objeto: contrato.objeto, vigenciaInicio: contrato.vigenciaInicio, vigenciaFim: contrato.vigenciaFim, valorInicial: contrato.valorInicial },
      fornecedor: { nome: linha.razao_social, documento: mascararDocumento(linha.documento) },
      tipo: final ? 'final' : 'parcial',
      periodoInicio,
      periodoFim,
      avaliador: { nome: avaliador, papel: 'gestor' },
      dataEmissao: emissao,
      indicadores,
      evidencias,
      motivacao,
      resultado: r,
      manifestacao: manifestacao ? { texto: manifestacao.texto, recebidaEm, concorda: true } : null,
      analise: null,
    });
    const id = prng.uuid();
    const emitidaEm = instanteEm(emissao, prng, agora);
    avaliacoes.push([
      id,
      contrato.id,
      contrato.fornecedorId,
      linha.uasg,
      final ? 'final' : 'parcial',
      periodoInicio,
      periodoFim,
      JSON.stringify(indicadores),
      evidencias,
      motivacao,
      r.nota,
      r.faixa,
      JSON.stringify({ componentes: r.componentes, penalidades: r.penalidades, metodologia: r.metodologia }),
      contrato.gestorId,
      'gestor',
      emitidaEm.toISOString(),
      emissao,
      r.prazoManifestacao,
      manifestacao ? JSON.stringify(manifestacao) : null,
      documento,
      sha256Hex(documento),
      protocolo,
    ]);
    eventos.push({
      ocorridoEm: emitidaEm,
      usuarioId: contrato.gestorId,
      acao: 'desempenho.avaliacao.emitir',
      recurso: 'avaliacao_desempenho',
      recursoId: id,
      resumo: `Emitiu a avaliação de desempenho ${final ? 'final' : 'parcial'} do contrato ${contrato.numero} (nota ${r.nota}, protocolo ${protocolo})`,
      dados: { instrumentoTipo: 'contrato', instrumentoId: contrato.id, fornecedorId: contrato.fornecedorId, protocolo, nota: r.nota, chave: porChave.get(contrato.fornecedorId) ?? null },
    });
  }
  await inserirEmLote(
    tx,
    'avaliacoes_desempenho',
    [
      'id', 'contrato_id', 'fornecedor_id', 'uasg', 'tipo', 'periodo_inicio', 'periodo_fim', 'indicadores', 'evidencias', 'motivacao', 'nota', 'faixa', 'calculo',
      'avaliador_id', 'papel_avaliador', 'emitida_em', 'data_emissao', 'prazo_manifestacao', 'manifestacao', 'documento', 'hash_documento', 'protocolo',
    ],
    avaliacoes,
  );
  dados.contagens.ocorrenciasExecucao = ocorrencias.length;
  dados.contagens.avaliacoesDesempenho = avaliacoes.length;
}
