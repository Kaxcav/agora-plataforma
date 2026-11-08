/**
 * Carga sintética do controle das contratações (Lei 14.133/2021, arts. 169 a 171): usuário de demonstração do controle
 * interno (2ª linha de defesa), medidas de controle externo em situações variadas e revisões trimestrais da matriz de
 * riscos dos contratos (RN-29). Usa PRNG próprio para não alterar a sequência dos dados das etapas anteriores.
 * Nenhuma cautelar suspensiva ativa recai sobre os processos da jornada: o bloqueio (RN-30) é demonstrado registrando a
 * cautelar na tela "Controle externo". Textos, números e datas são inventados.
 */
import { adicionarDias, prazoRespostaMedida, type TipoMedidaControle } from '@agora/dominio';
import type { RiscoMatriz } from '@agora/contratos';
import { identificadorInstrumento, normalizarBusca } from '../compartilhado/texto.ts';
import { instanteEm, type ContextoSeed, type EventoSeed } from './contexto.ts';
import { gerarCpf } from './documentos.ts';
import { Prng } from './prng.ts';
import { USUARIOS_DEMONSTRACAO_ADICIONAIS } from './usuarios-demonstracao.ts';

/** Semente própria desta etapa (Lei 14.133, art. 169). */
const SEMENTE_CONTROLE = 14_133_169;

/** Contas de demonstração criadas por esta etapa: controle interno (2ª linha) e auditor do controle externo (3ª linha). */
const CONTAS_DESTA_ETAPA = new Set(['controle@agora.demo', 'auditoria.externa@agora.demo']);

const RISCOS_MODELO: readonly Omit<RiscoMatriz, 'id'>[] = [
  {
    descricao: 'Atraso na entrega ou na execução pelo contratado',
    probabilidade: 3,
    impacto: 4,
    alocacao: 'contratada',
    mitigacao: 'Cronograma com marcos mensais, multa moratória prevista no contrato e acompanhamento semanal pelo fiscal.',
  },
  {
    descricao: 'Variação de preço de insumos importados',
    probabilidade: 3,
    impacto: 3,
    alocacao: 'compartilhado',
    mitigacao: 'Reajuste pelo índice contratual na data-base e verificação de vantajosidade antes de cada aditivo.',
  },
  {
    descricao: 'Descontinuidade do serviço por falha do contratado',
    probabilidade: 2,
    impacto: 5,
    alocacao: 'contratada',
    mitigacao: 'Níveis mínimos de serviço com glosa, garantia contratual e plano de contingência aprovado pela gestão.',
  },
  {
    descricao: 'Insuficiência de dotação orçamentária no exercício',
    probabilidade: 2,
    impacto: 4,
    alocacao: 'contratante',
    mitigacao: 'Programação financeira trimestral com a área de orçamento e empenho estimativo no início do exercício.',
  },
  {
    descricao: 'Recebimento sem conferência técnica completa',
    probabilidade: 2,
    impacto: 3,
    alocacao: 'contratante',
    mitigacao: 'Lista de verificação de recebimento provisório e definitivo, com comissão designada para itens de maior valor.',
  },
  {
    descricao: 'Perda de regularidade fiscal ou trabalhista do contratado',
    probabilidade: 2,
    impacto: 3,
    alocacao: 'contratada',
    mitigacao: 'Consulta de regularidade antes de cada pagamento e notificação imediata com prazo para regularização.',
  },
];

const OBSERVACOES_REVISAO = [
  'Matriz revisada com a equipe de fiscalização; probabilidades mantidas e mitigação de atraso reforçada.',
  'Revisão trimestral sem novos riscos; controles de recebimento ajustados após a última medição.',
  'Risco de preço reavaliado após o reajuste; demais riscos e responsáveis mantidos.',
  'Matriz conferida pela unidade de controle interno; recomendado acompanhar a regularidade do contratado.',
] as const;

interface MedidaPlano {
  orgao: 'TCU' | 'CGU';
  tipo: TipoMedidaControle;
  numero: string;
  objeto: string;
  efeitoSuspensivo: boolean;
  alvo: { processoId: string; numeroSei: string; uasg: string } | { contratoId: string; numero: string; uasg: string };
  decididaHaDias: number;
  cienciaHaDias: number;
  prazoDiasUteis: number | null;
  resposta?: { haDias: number; texto: string };
  revogacao?: { haDias: number; texto: string };
}

export async function gerarControle(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados, calendario } = ctx;
  const prng = new Prng(SEMENTE_CONTROLE);
  const eventos: EventoSeed[] = [];
  const carga = { carga: 'demonstracao' };
  const ano = Number(hoje.slice(0, 4));

  // ───────── contas do controle interno e do controle externo ─────────
  let controleId: string | null = null;
  for (const u of USUARIOS_DEMONSTRACAO_ADICIONAIS.filter((x) => CONTAS_DESTA_ETAPA.has(x.email))) {
    const id = prng.uuid();
    const uasgs = u.escopo === 'todas' ? 'todas' : dados.uasgs.slice(0, u.escopo);
    await tx.executar(
      `INSERT INTO usuarios (id, nome, email, cpf, senha_hash, ativo, unidade_interna_id, todas_uasgs, ultimo_acesso_em, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, NULL, $8)`,
      [id, u.nome, u.email, gerarCpf(prng), ctx.senhaHashDemonstracao, u.perfil === 'controle_interno' ? (dados.unidades.get('COCIN') ?? null) : null, uasgs === 'todas', normalizarBusca(u.nome, u.email)],
    );
    await tx.executar('INSERT INTO usuarios_perfis (usuario_id, perfil) VALUES ($1, $2)', [id, u.perfil]);
    if (uasgs !== 'todas') for (const codigo of uasgs) await tx.executar('INSERT INTO usuarios_uasgs (usuario_id, uasg) VALUES ($1, $2)', [id, codigo]);
    dados.usuarios.set(u.email, { id, email: u.email, nome: u.nome, perfis: [u.perfil], uasgs });
    if (u.perfil === 'controle_interno') controleId ??= id;
  }

  // ───────── medidas de controle externo ─────────
  const processos = await tx.consultar<{ id: string; numero_sei: string; uasg: string; etapa_atual: number }>(
    'SELECT id, numero_sei, uasg, etapa_atual FROM processos ORDER BY etapa_atual, numero_sei',
  );
  const vigentes = dados.contratos
    .filter((c) => c.vigenciaInicio <= adicionarDias(hoje, -60) && c.vigenciaFim >= adicionarDias(hoje, 120))
    .sort((a, b) => a.numero.localeCompare(b.numero));
  const escolhidos = prng.embaralhar(vigentes).slice(0, 3);
  const [contratoSuspenso, contratoRecomendacao, contratoDeterminacao] = escolhidos;
  const processoCinco = processos.find((p) => p.etapa_atual === 5);
  const processoTres = processos.find((p) => p.etapa_atual === 3);

  const planos: MedidaPlano[] = [];
  if (contratoSuspenso) {
    planos.push({
      orgao: 'TCU',
      tipo: 'cautelar',
      numero: `${prng.inteiro(1100, 1999)}/${ano}`,
      objeto: 'Suspensão cautelar da assinatura de termos aditivos e de novos empenhos até a análise de indícios de sobrepreço em itens do contrato.',
      efeitoSuspensivo: true,
      alvo: { contratoId: contratoSuspenso.id, numero: contratoSuspenso.numero, uasg: contratoSuspenso.uasg },
      decididaHaDias: 6,
      cienciaHaDias: 4,
      prazoDiasUteis: null,
    });
  }
  if (processoCinco) {
    planos.push({
      orgao: 'TCU',
      tipo: 'cautelar',
      numero: `${prng.inteiro(2000, 2999)}/${ano}`,
      objeto: 'Suspensão cautelar do certame para exame de exigência de qualificação técnica possivelmente restritiva no edital.',
      efeitoSuspensivo: true,
      alvo: { processoId: processoCinco.id, numeroSei: processoCinco.numero_sei, uasg: processoCinco.uasg },
      decididaHaDias: 66,
      cienciaHaDias: 64,
      prazoDiasUteis: null,
      resposta: {
        haDias: 55,
        texto: 'Informadas as medidas adotadas: exigência revista pela equipe de planejamento, parecer jurídico complementar juntado e apuração interna instaurada.',
      },
      revogacao: { haDias: 21, texto: 'O tribunal revogou a cautelar após as informações prestadas, com determinação de ajuste do edital antes da publicação.' },
    });
  }
  if (contratoRecomendacao) {
    planos.push({
      orgao: 'CGU',
      tipo: 'recomendacao',
      numero: `${prng.inteiro(300, 899)}/${ano}`,
      objeto: 'Recomendação para aprimorar a conferência das medições mensais e o registro das glosas aplicadas na execução do contrato.',
      efeitoSuspensivo: false,
      alvo: { contratoId: contratoRecomendacao.id, numero: contratoRecomendacao.numero, uasg: contratoRecomendacao.uasg },
      decididaHaDias: 44,
      cienciaHaDias: 40,
      prazoDiasUteis: 15,
    });
  }
  if (processoTres) {
    planos.push({
      orgao: 'TCU',
      tipo: 'diligencia',
      numero: `${prng.inteiro(3000, 3999)}/${ano}`,
      objeto: 'Diligência para encaminhar a memória da pesquisa de preços e a justificativa dos expurgos realizados na cesta.',
      efeitoSuspensivo: false,
      alvo: { processoId: processoTres.id, numeroSei: processoTres.numero_sei, uasg: processoTres.uasg },
      decididaHaDias: 3,
      cienciaHaDias: 2,
      prazoDiasUteis: 5,
    });
  }
  if (contratoDeterminacao) {
    planos.push({
      orgao: 'TCU',
      tipo: 'determinacao',
      numero: `${prng.inteiro(4000, 4999)}/${ano}`,
      objeto: 'Determinação para designar formalmente o fiscal técnico substituto e publicar o ato de designação.',
      efeitoSuspensivo: false,
      alvo: { contratoId: contratoDeterminacao.id, numero: contratoDeterminacao.numero, uasg: contratoDeterminacao.uasg },
      decididaHaDias: 33,
      cienciaHaDias: 30,
      prazoDiasUteis: null,
      resposta: { haDias: 20, texto: 'Encaminhada a portaria de designação do fiscal técnico substituto, publicada no boletim de serviço.' },
    });
  }

  for (const m of planos) {
    const id = prng.uuid();
    const decidida = adicionarDias(hoje, -m.decididaHaDias);
    const ciencia = adicionarDias(hoje, -m.cienciaHaDias);
    const prazo = prazoRespostaMedida({ ciencia, efeitoSuspensivo: m.efeitoSuspensivo, diasUteisFixados: m.prazoDiasUteis }, calendario);
    const respondida = m.resposta ? adicionarDias(hoje, -m.resposta.haDias) : null;
    const revogada = m.revogacao ? adicionarDias(hoje, -m.revogacao.haDias) : null;
    const ehProcesso = 'processoId' in m.alvo;
    const identificador = 'processoId' in m.alvo ? `Processo ${m.alvo.numeroSei}` : identificadorInstrumento('contrato', m.alvo.numero);
    const vinculo = 'processoId' in m.alvo ? { processoId: m.alvo.processoId } : { instrumentoTipo: 'contrato', instrumentoId: m.alvo.contratoId };
    const registradaEm = instanteEm(ciencia, prng, agora);
    await tx.executar(
      `INSERT INTO medidas_controle (id, orgao, tipo, numero, decidida_em, ciencia_em, objeto, efeito_suspensivo, processo_id, contrato_id, uasg,
                                     prazo_resposta, dias_uteis_prazo, fundamento_prazo, respondida_em, resposta, respondida_por,
                                     revogada_em, revogacao, revogada_por, registrada_por, registrada_em, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
      [
        id,
        m.orgao,
        m.tipo,
        m.numero,
        decidida,
        ciencia,
        m.objeto,
        m.efeitoSuspensivo,
        'processoId' in m.alvo ? m.alvo.processoId : null,
        'contratoId' in m.alvo ? m.alvo.contratoId : null,
        m.alvo.uasg,
        prazo.vencimento,
        prazo.diasUteis,
        prazo.fundamento,
        respondida,
        m.resposta?.texto ?? null,
        respondida ? controleId : null,
        revogada,
        m.revogacao?.texto ?? null,
        revogada ? controleId : null,
        controleId,
        registradaEm.toISOString(),
        normalizarBusca(m.orgao, m.numero, m.objeto, identificador),
      ],
    );
    eventos.push({
      ocorridoEm: registradaEm,
      usuarioId: controleId,
      acao: 'medida_controle.registrar',
      recurso: 'medida_controle',
      recursoId: id,
      resumo: `Registrou ${m.tipo === 'cautelar' ? 'medida cautelar' : m.tipo === 'diligencia' ? 'diligência' : m.tipo === 'determinacao' ? 'determinação' : 'recomendação'} do ${m.orgao} nº ${m.numero} sobre ${identificador}${m.efeitoSuspensivo ? ' com efeito suspensivo' : ''}`,
      dados: { ...carga, ...vinculo, orgao: m.orgao, tipo: m.tipo, numero: m.numero, efeitoSuspensivo: m.efeitoSuspensivo, prazoResposta: prazo.vencimento },
    });
    if (respondida) {
      eventos.push({
        ocorridoEm: instanteEm(respondida, prng, agora),
        usuarioId: controleId,
        acao: 'medida_controle.responder',
        recurso: 'medida_controle',
        recursoId: id,
        resumo: `Registrou a resposta do órgão à medida nº ${m.numero}`,
        dados: { ...carga, ...vinculo, respondidaEm: respondida, prazo: prazo.vencimento },
      });
    }
    if (revogada) {
      eventos.push({
        ocorridoEm: instanteEm(revogada, prng, agora),
        usuarioId: controleId,
        acao: 'medida_controle.revogar',
        recurso: 'medida_controle',
        recursoId: id,
        resumo: `Registrou a revogação da medida nº ${m.numero}${m.efeitoSuspensivo ? '; a suspensão deixa de bloquear o processo' : ''}`,
        dados: { ...carga, ...vinculo, revogadaEm: revogada, efeitoSuspensivo: m.efeitoSuspensivo, processo: ehProcesso },
      });
    }
  }

  // ───────── revisões trimestrais da matriz de riscos (RN-29) ─────────
  let revisoes = 0;
  for (const c of dados.contratos) {
    if (c.vigenciaFim < hoje || c.vigenciaInicio > adicionarDias(hoje, -20)) continue;
    const sorteio = prng.proximo();
    if (sorteio < 0.15) continue; // sem revisão registrada: aparece como vencida
    const diasAtras = sorteio < 0.3 ? prng.inteiro(80, 96) : prng.inteiro(5, 70);
    const candidata = adicionarDias(hoje, -diasAtras);
    const revisadaEm = candidata < c.vigenciaInicio ? c.vigenciaInicio : candidata;
    const segunda = controleId !== null && prng.chance(0.25);
    const riscos = prng
      .embaralhar(RISCOS_MODELO)
      .slice(0, 3)
      .map((r) => ({ ...r, id: prng.uuid() }));
    const id = prng.uuid();
    const registradaEm = instanteEm(revisadaEm, prng, agora);
    const autor = segunda ? controleId : c.gestorId;
    await tx.executar(
      `INSERT INTO revisoes_matriz_riscos (id, contrato_id, revisada_em, linha, riscos, observacao, revisada_por, registrada_em)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [id, c.id, revisadaEm, segunda ? 'segunda' : 'primeira', JSON.stringify(riscos), prng.escolher(OBSERVACOES_REVISAO), autor, registradaEm.toISOString()],
    );
    eventos.push({
      ocorridoEm: registradaEm,
      usuarioId: autor,
      acao: 'contrato.riscos.revisar',
      recurso: 'contrato',
      recursoId: c.id,
      resumo: `Registrou a revisão trimestral da matriz de riscos do contrato ${c.numero} (${segunda ? '2ª' : '1ª'} linha de defesa), com ${riscos.length} risco(s)`,
      dados: { ...carga, instrumentoTipo: 'contrato', instrumentoId: c.id, revisadaEm, linha: segunda ? 'segunda' : 'primeira', riscos: riscos.length },
    });
    revisoes += 1;
  }

  ctx.eventos.push(...eventos);
  dados.contagens.medidasControle = planos.length;
  dados.contagens.revisoesMatrizRiscos = revisoes;
}
