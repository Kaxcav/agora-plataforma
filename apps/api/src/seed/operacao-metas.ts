/**
 * Carga sintética da operação (RNF-10) e das metas do ETP (RF-39): metas configuradas com valores sintéticos, um
 * histórico de 20 dias da sonda de disponibilidade (com uma queda curta do banco, uma lacuna de implantação e uma
 * janela de manutenção do PNCP detectada pela fila), a janela registrada pelo órgão e alguns bloqueios das travas.
 * Nenhum valor vem de dados reais: as metas do órgão são configuradas na tela de metas.
 */
import type { ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/** Semente própria: a etapa não consome a sequência do gerador compartilhado pelas demais. */
const SEMENTE_OPERACAO = 14_133_031;
const MINUTO = 60_000;
const DIA = 86_400_000;

/** Metas sintéticas de demonstração (o órgão define as suas na tela de metas). */
const METAS_DEMONSTRACAO = {
  tempo_instrucao: { reducaoPercentual: 40, linhaBaseDias: { '1': 30, '2': 20, '3': 40, '4': 30 } },
  erros_formais: { mitigacaoPercentual: 95 },
  economia: { economiaPercentual: 6 },
} as const;

const DETALHES = { latenciaBancoMs: 3, tarefasAtrasadas: 0, tarefasPncpEmEspera: 0, transporte: 'postgres', sincronizacaoPncp: null, replica: 'agora-demonstracao' };

interface TrechoSonda {
  /** Minutos antes de `agora`. */
  de: number;
  ate: number;
  banco?: boolean;
  sincronizacao?: boolean;
  pncp?: boolean;
}

export async function gerarOperacaoMetas(ctx: ContextoSeed): Promise<void> {
  const { tx, agora, eventos, dados } = ctx;
  const prng = new Prng(SEMENTE_OPERACAO);
  const admin = dados.usuarios.get('admin@agora.demo');
  if (!admin) throw new Error('Usuário de demonstração ausente: admin@agora.demo');
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  // Metas do ETP configuradas pelo administrador há 30 dias.
  const configuradas = antes(30 * DIA);
  for (const [indicador, configuracao] of Object.entries(METAS_DEMONSTRACAO)) {
    await tx.executar('INSERT INTO metas_etp (indicador, configuracao, atualizada_por, atualizada_em) VALUES ($1, $2::jsonb, $3, $4)', [
      indicador,
      JSON.stringify(configuracao),
      admin.id,
      configuradas.toISOString(),
    ]);
  }
  eventos.push({
    ocorridoEm: configuradas,
    usuarioId: admin.id,
    acao: 'metas.configurar',
    recurso: 'metas_etp',
    recursoId: null,
    resumo: 'Configurou as metas do ETP (tempo de instrução, erros formais e economia)',
    dados: { carga: 'demonstracao', depois: METAS_DEMONSTRACAO },
  });

  // Janela de manutenção do PNCP informada pelo órgão (há 4 dias, 90 minutos).
  const minutosJanela = 4 * 24 * 60 + 120;
  const inicioJanela = antes(minutosJanela * MINUTO);
  const fimJanela = new Date(inicioJanela.getTime() + 90 * MINUTO);
  const janelaId = prng.uuid();
  const descricao = 'Janela programada de manutenção do PNCP divulgada no portal (registro sintético da demonstração).';
  await tx.executar(
    `INSERT INTO operacao_janelas_manutencao (id, sistema, inicio, fim, descricao, registrada_por, registrada_em)
     VALUES ($1, 'pncp', $2, $3, $4, $5, $6)`,
    [janelaId, inicioJanela.toISOString(), fimJanela.toISOString(), descricao, admin.id, antes((minutosJanela + 24 * 60) * MINUTO).toISOString()],
  );
  eventos.push({
    ocorridoEm: antes((minutosJanela + 24 * 60) * MINUTO),
    usuarioId: admin.id,
    acao: 'operacao.janela.registrar',
    recurso: 'janela_manutencao',
    recursoId: janelaId,
    resumo: 'Registrou uma janela de manutenção do PNCP',
    dados: { carga: 'demonstracao', sistema: 'pncp', inicio: inicioJanela.toISOString(), fim: fimJanela.toISOString(), descricao },
  });

  // Histórico da sonda: 20 dias, sondagem a cada minuto, com três ocorrências.
  const quedaBanco = 9 * 24 * 60 + prng.inteiro(0, 600);
  const lacuna = 2 * 24 * 60 + prng.inteiro(0, 600);
  const manutencao = minutosJanela - 30;
  const trechos: TrechoSonda[] = [
    { de: 20 * 24 * 60, ate: quedaBanco + 1 },
    { de: quedaBanco, ate: quedaBanco - 5, banco: false, sincronizacao: false },
    { de: quedaBanco - 6, ate: manutencao + 1 },
    { de: manutencao, ate: manutencao - 44, sincronizacao: false, pncp: true },
    { de: manutencao - 45, ate: lacuna + 1 },
    // lacuna de 12 minutos sem sondagem (implantação de nova versão)
    { de: lacuna - 12, ate: 1 },
  ];
  for (const t of trechos) {
    const banco = t.banco ?? true;
    await tx.executar(
      `INSERT INTO operacao_sondagens (id, inicio, fim, api, banco, fila, sincronizacao, pncp_em_manutencao, amostras, detalhes)
       VALUES ($1, $2, $3, true, $4, $4, $5, $6, $7, $8::jsonb)`,
      [
        prng.uuid(),
        antes(t.de * MINUTO).toISOString(),
        antes(t.ate * MINUTO).toISOString(),
        banco,
        t.sincronizacao ?? true,
        t.pncp ?? false,
        t.de - t.ate + 1,
        JSON.stringify({ ...DETALHES, latenciaBancoMs: banco ? DETALHES.latenciaBancoMs : null, tarefasPncpEmEspera: t.pncp ? 2 : 0 }),
      ],
    );
  }

  // Bloqueios das travas nos processos sintéticos (erros formais barrados, RF-39).
  const processos = await tx.consultar<{ id: string; numero_sei: string; uasg: string; etapa_atual: number }>(
    'SELECT id, numero_sei, uasg, etapa_atual FROM processos ORDER BY etapa_atual, numero_sei',
  );
  const naEtapa = (etapa: number) => processos.find((p) => p.etapa_atual === etapa);
  const planejamento = dados.usuarios.get('planejamento@agora.demo');
  const agente = dados.usuarios.get('agente@agora.demo');
  const bloqueios = [
    { processo: naEtapa(3), dias: 12, trava: 'avanco_etapa', rotulo: 'avanço de etapa da jornada', regras: ['RN-04'], usuario: planejamento },
    { processo: naEtapa(3), dias: 11, trava: 'avanco_etapa', rotulo: 'avanço de etapa da jornada', regras: ['RN-04', 'RN-05'], usuario: planejamento },
    { processo: naEtapa(1), dias: 7, trava: 'documento_gerar', rotulo: 'geração de minuta', regras: ['RN-01'], usuario: planejamento },
    { processo: naEtapa(4), dias: 5, trava: 'documento_aprovar', rotulo: 'aprovação de documento', regras: ['RN-21'], usuario: agente },
  ];
  for (const b of bloqueios) {
    if (!b.processo) continue;
    const quando = antes(b.dias * DIA + prng.inteiro(60, 480) * MINUTO);
    eventos.push({
      ocorridoEm: quando,
      usuarioId: b.usuario?.id ?? null,
      acao: 'trava.bloqueio',
      recurso: 'processo',
      recursoId: b.processo.id,
      resumo: `Trava barrou: ${b.rotulo} (${b.processo.numero_sei}) — ${b.regras.join(', ')}`,
      dados: {
        carga: 'demonstracao',
        trava: b.trava,
        regras: b.regras,
        uasg: b.processo.uasg,
        etapa: b.processo.etapa_atual,
        mensagem: 'Bloqueio sintético da carga de demonstração.',
        quantidadeMotivos: b.regras.length,
        processoId: b.processo.id,
      },
    });
  }

  dados.contagens.sondagensSinteticas = trechos.length;
  dados.contagens.bloqueiosTravas = bloqueios.filter((b) => b.processo).length;
}
