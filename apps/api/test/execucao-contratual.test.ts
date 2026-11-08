import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type {
  AlteracaoOrdemCronologica,
  ContratoDetalhe,
  DesignacaoContrato,
  EventoHistorico,
  ExecucaoContrato,
  NotificacaoDetalhe,
  OcorrenciaContrato,
  PaginaPrazosPagamento,
  PainelSegundaLinha,
  RecebimentoContrato,
  RespostaDescontoMulta,
  RespostaGarantia,
  RespostaTermoRecebimento,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const PARAMETROS = {
  prazoProvisorioDiasUteis: 5,
  prazoDefinitivoDiasUteis: 10,
  prazoCorrecaoDiasUteis: 7,
  prazoLiquidacaoDiasUteis: 5,
  prazoPagamentoDias: 20,
  marcoPagamento: 'recebimento_definitivo',
  indiceAtualizacao: 'IPCA',
  jurosMoraMensal: 0.5,
  garantiaObjetoMeses: 12,
};
const RESSALVA = 'Itens entregues sem o manual em português e com etiqueta de patrimônio ausente em parte dos volumes.';
const JUSTIFICATIVA =
  'Pagamento a microempresa com risco demonstrado de descontinuidade do serviço essencial, conforme nota técnica juntada ao processo.';

describe('execução contratual: fiscalização, recebimentos, garantias e prazos (frente L)', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let fiscalTecnico: Credenciais;
  let consulta: Credenciais;
  let controle: Credenciais;
  let hoje: string;
  let contratoId: string;
  let notaPrevista: { id: string; nota: string };

  const contratoDoGestor = async (): Promise<{ id: string; nota: { id: string; nota: string } }> => {
    const [linha] = await app.agora.banco.consultar<{ contrato_id: string; pagamento_id: string; nota_fiscal: string }>(
      `SELECT c.id AS contrato_id, p.id AS pagamento_id, p.nota_fiscal
         FROM contratos c JOIN pagamentos p ON p.contrato_id = c.id
        WHERE c.vigencia_fim > $1::date + 60 AND c.vigencia_inicio < $1::date - 30 AND p.situacao = 'previsto'
          AND c.garantia_valor IS NULL
          AND NOT EXISTS (SELECT 1 FROM sancoes s WHERE s.contrato_id = c.id)
        ORDER BY c.numero, p.vencimento LIMIT 1`,
      [hoje],
    );
    assert.ok(linha, 'contrato vigente com nota prevista');
    return { id: linha.contrato_id, nota: { id: linha.pagamento_id, nota: linha.nota_fiscal } };
  };

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    fiscalTecnico = await entrar(app, 'fiscal.tecnico@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
    controle = await entrar(app, 'controle@agora.demo');
    hoje = app.agora.hoje();
    const alvo = await contratoDoGestor();
    contratoId = alvo.id;
    notaPrevista = alvo.nota;
  });

  after(async () => {
    await app.close();
  });

  test('a carga traz prazos, designações e garantias; a conta consulta só lê', async () => {
    const execucao = await obterJson<ExecucaoContrato>(app, gestor, `/api/v1/contratos/${contratoId}/execucao`);
    assert.ok(execucao.parametros, 'prazos definidos na carga');
    assert.ok(execucao.designacoes.some((d) => d.papel === 'gestor' && d.fim === null));
    assert.ok(execucao.equipe.faltantes.includes('fiscal_administrativo'));
    assert.ok(execucao.notasDisponiveis.some((n) => n.pagamentoId === notaPrevista.id));
    const [garantias] = await app.agora.banco.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total FROM contratos_garantias`);
    const [colunas] = await app.agora.banco.consultar<{ total: number }>(`SELECT COUNT(*)::integer AS total FROM contratos WHERE garantia_valor IS NOT NULL`);
    assert.equal(garantias?.total, colunas?.total);
    assert.equal((await chamar(app, consulta, 'PUT', `/api/v1/contratos/${contratoId}/parametros-execucao`, PARAMETROS)).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'PUT', `/api/v1/contratos/${contratoId}/parametros-execucao`, PARAMETROS)).statusCode, 200);
  });

  test('designação do fiscal técnico substitui a anterior e atualiza o fiscal do contrato; gestor não fiscaliza tecnicamente', async () => {
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/designacoes`, {
      papel: 'fiscal_tecnico',
      usuarioId: fiscalTecnico.sessao.usuario.id,
      ato: 'Portaria nº 77/2026',
      inicio: hoje,
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json<DesignacaoContrato>().usuario.id, fiscalTecnico.sessao.usuario.id);
    const contrato = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${contratoId}`);
    assert.equal(contrato.fiscal?.id, fiscalTecnico.sessao.usuario.id);

    const comoGestor = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/designacoes`, {
      papel: 'gestor',
      usuarioId: gestor.sessao.usuario.id,
      ato: 'Portaria nº 78/2026',
      inicio: hoje,
    });
    assert.equal(comoGestor.statusCode, 201, comoGestor.body);
    const conflito = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/designacoes`, {
      papel: 'fiscal_tecnico',
      usuarioId: gestor.sessao.usuario.id,
      ato: 'Portaria nº 79/2026',
      inicio: hoje,
    });
    assert.equal(conflito.statusCode, 422);
    assert.match(conflito.body, /segregação/);
    // o gestor integra a comissão de recebimento (lavra o definitivo)
    const comissao = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/designacoes`, {
      papel: 'comissao_recebimento',
      usuarioId: gestor.sessao.usuario.id,
      ato: 'Portaria nº 80/2026',
      inicio: hoje,
    });
    assert.equal(comissao.statusCode, 201, comissao.body);
  });

  test('ocorrência com prazo de regularização notifica a contratada pela central', async () => {
    const r = await chamar(app, fiscalTecnico, 'POST', `/api/v1/contratos/${contratoId}/ocorrencias`, {
      tipo: 'falha_execucao',
      dataFato: hoje,
      relato: 'Equipe da contratada sem os equipamentos de proteção previstos no termo de referência durante a vistoria.',
      providencia: 'Apresentar os equipamentos de proteção e o registro de entrega à equipe.',
      prazoRegularizacao: hoje,
      notificarContratada: false,
    });
    assert.equal(r.statusCode, 201, r.body);
    const ocorrencia = r.json<OcorrenciaContrato>();
    assert.ok(ocorrencia.notificacaoId, 'prazo de regularização obriga a notificação');
    const notificacao = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${ocorrencia.notificacaoId}`);
    assert.equal(notificacao.tipo, 'ocorrencia');
    assert.ok(notificacao.envios.some((e) => e.papel === 'contratada'));
    const regularizada = await chamar(app, fiscalTecnico, 'POST', `/api/v1/ocorrencias/${ocorrencia.id}/regularizar`, { data: hoje, observacao: 'Equipamentos apresentados e conferidos.' });
    assert.equal(regularizada.statusCode, 200, regularizada.body);
  });

  test('recebimento provisório e definitivo: o definitivo atesta a nota, conta o prazo de pagamento e gera o termo em PDF', async () => {
    const entrega = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/recebimentos`, {
      descricao: 'Parcela mensal dos serviços do período',
      valor: 1_000_000,
      entregueEm: hoje,
      pagamentoId: notaPrevista.id,
    });
    assert.equal(entrega.statusCode, 201, entrega.body);
    const recebimento = entrega.json<RecebimentoContrato>();
    assert.equal(recebimento.situacao, 'aguardando_provisorio');

    // o atesto direto fica bloqueado enquanto a entrega não for recebida definitivamente
    const atestoDireto = await chamar(app, gestor, 'POST', `/api/v1/pagamentos/${notaPrevista.id}/atestar`);
    assert.ok(atestoDireto.statusCode === 403 || atestoDireto.statusCode === 409);
    const admin = await entrar(app, 'admin@agora.demo');
    assert.equal((await chamar(app, admin, 'POST', `/api/v1/pagamentos/${notaPrevista.id}/atestar`)).statusCode, 409);

    const definitivoAntes = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'definitivo', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(definitivoAntes.statusCode, 422);

    const provisorio = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'provisorio', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(provisorio.statusCode, 201, provisorio.body);
    assert.equal(provisorio.json<RespostaTermoRecebimento>().recebimento.situacao, 'aguardando_definitivo');

    const definitivoPeloFiscal = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'definitivo', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(definitivoPeloFiscal.statusCode, 422);

    const definitivo = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'definitivo', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(definitivo.statusCode, 201, definitivo.body);
    const resposta = definitivo.json<RespostaTermoRecebimento>();
    assert.equal(resposta.recebimento.situacao, 'recebido');
    assert.equal(resposta.atesto?.pagamentoId, notaPrevista.id);
    assert.ok(resposta.limitePagamento && resposta.limitePagamento > hoje);
    assert.ok(resposta.recebimento.garantiaObjetoAte, 'garantia técnica do objeto de 12 meses');
    const [nota] = await app.agora.banco.consultar<{ situacao: string }>('SELECT situacao FROM pagamentos WHERE id = $1', [notaPrevista.id]);
    assert.equal(nota?.situacao, 'atestado');

    const pdf = await chamar(app, consulta, 'GET', `/api/v1/recebimentos/termos/${resposta.termo.id}/termo.pdf`);
    assert.ok(pdf.statusCode === 200 || pdf.statusCode === 404, 'consulta só vê as UASGs do seu escopo');
    const termoPdf = await chamar(app, gestor, 'GET', `/api/v1/recebimentos/termos/${resposta.termo.id}/termo.pdf`);
    assert.equal(termoPdf.statusCode, 200);
    assert.equal(termoPdf.headers['content-type'], 'application/pdf');
    assert.ok(termoPdf.rawPayload.subarray(0, 5).toString('latin1').startsWith('%PDF'));
    assert.equal(createHash('sha256').update(termoPdf.rawPayload).digest('hex'), resposta.termo.hashPdf, 'o PDF baixado confere com o hash do registro');

    const historico = await obterJson<EventoHistorico[]>(app, gestor, `/api/v1/contratos/${contratoId}/historico`);
    assert.ok(historico.some((h) => /termo de recebimento definitivo/.test(h.acao)));
    assert.ok(historico.some((h) => /Atestou a nota fiscal .* no recebimento definitivo/.test(h.acao)));

    const prazos = await obterJson<PaginaPrazosPagamento>(app, gestor, `/api/v1/pagamentos/prazos?busca=${encodeURIComponent(notaPrevista.nota)}&tamanhoPagina=100`);
    const prazo = prazos.itens.find((p) => p.pagamento.id === notaPrevista.id);
    assert.equal(prazo?.origemMarco, 'recebimento_definitivo');
    assert.equal(prazo?.limitePagamento, resposta.limitePagamento);
    assert.ok(prazo?.situacao === 'no_prazo');
  });

  test('ressalva exige descrição, abre prazo de correção, registra ocorrência e notifica; quem lavrou o provisório não lavra o definitivo', async () => {
    const entrega = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/recebimentos`, { descricao: 'Entrega parcial de materiais', valor: 50_000, entregueEm: hoje, pagamentoId: null });
    const recebimento = entrega.json<RecebimentoContrato>();
    const semDescricao = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'provisorio', resultado: 'com_ressalva', data: hoje, observacoes: 'curta' });
    assert.equal(semDescricao.statusCode, 422);
    const ressalva = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'provisorio', resultado: 'com_ressalva', data: hoje, observacoes: RESSALVA });
    assert.equal(ressalva.statusCode, 201, ressalva.body);
    const r = ressalva.json<RespostaTermoRecebimento>();
    assert.equal(r.recebimento.situacao, 'em_correcao');
    assert.ok(r.recebimento.prazoCorrecao);
    assert.ok(r.notificacaoId);
    const execucao = await obterJson<ExecucaoContrato>(app, gestor, `/api/v1/contratos/${contratoId}/execucao`);
    assert.ok(execucao.ocorrencias.some((o) => o.tipo === 'inconformidade' && o.notificacaoId === r.notificacaoId));

    // o gestor lavra o provisório depois da correção e não pode lavrar o definitivo da mesma entrega
    const provisorio = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'provisorio', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(provisorio.statusCode, 201, provisorio.body);
    const definitivo = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, { tipo: 'definitivo', resultado: 'aceito', data: hoje, observacoes: null });
    assert.equal(definitivo.statusCode, 422);
    assert.match(definitivo.body, /RECEBIMENTO_SEGREGACAO/);
  });

  test('garantia: limites do art. 98, apresentação que vence em breve gera o alerta da central e espelha no contrato', async () => {
    const acimaSemJustificativa = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/garantias`, {
      finalidade: 'execucao',
      percentual: 8,
      justificativa: null,
      grandeVultoEngenharia: false,
      clausulaRetomada: false,
      modalidadeExigida: null,
      prazoApresentacao: hoje,
    });
    assert.equal(acimaSemJustificativa.statusCode, 422);
    const exigencia = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/garantias`, {
      finalidade: 'execucao',
      percentual: 5,
      justificativa: null,
      grandeVultoEngenharia: false,
      clausulaRetomada: false,
      modalidadeExigida: null,
      prazoApresentacao: hoje,
    });
    assert.equal(exigencia.statusCode, 201, exigencia.body);
    const garantia = exigencia.json<RespostaGarantia>().garantia;
    assert.equal(garantia.situacao, 'aguardando_apresentacao');
    assert.ok(exigencia.json<RespostaGarantia>().notificacaoId, 'contratada notificada da exigência');

    const validade = new Date(Date.parse(`${hoje}T12:00:00Z`) + 20 * 86_400_000).toISOString().slice(0, 10);
    const menor = await chamar(app, gestor, 'POST', `/api/v1/garantias/${garantia.id}/apresentacao`, {
      modalidade: 'seguro_garantia',
      valor: garantia.valorExigido - 1,
      apresentadaEm: hoje,
      validaAte: validade,
      emissor: 'Seguradora de Teste S.A.',
      documento: 'Apólice 123',
    });
    assert.equal(menor.statusCode, 422);
    const apresentada = await chamar(app, gestor, 'POST', `/api/v1/garantias/${garantia.id}/apresentacao`, {
      modalidade: 'seguro_garantia',
      valor: garantia.valorExigido,
      apresentadaEm: hoje,
      validaAte: validade,
      emissor: 'Seguradora de Teste S.A.',
      documento: 'Apólice 123',
    });
    assert.equal(apresentada.statusCode, 200, apresentada.body);
    const resposta = apresentada.json<RespostaGarantia>();
    assert.equal(resposta.garantia.situacao, 'vence_em_breve');
    assert.ok(resposta.notificacaoId, 'alerta de vencimento gerado');
    const aviso = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${resposta.notificacaoId}`);
    assert.equal(aviso.tipo, 'garantia');
    const contrato = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${contratoId}`);
    assert.equal(contrato.garantia?.validaAte, validade);

    // renovar com a mesma chave não duplica; a liberação só depois da fiel execução
    const renovada = await chamar(app, gestor, 'POST', `/api/v1/garantias/${garantia.id}/renovacao`, { data: hoje, validaAte: '2030-12-31', documento: 'Endosso 1', valor: null });
    assert.equal(renovada.statusCode, 200, renovada.body);
    const liberar = await chamar(app, gestor, 'POST', `/api/v1/garantias/${garantia.id}/liberacao`, { data: hoje, extincaoCulpaAdministracao: false, observacao: 'Tentativa antes do fim da execução.' });
    assert.equal(liberar.statusCode, 422);
  });

  test('desconto de multa: primeiro os pagamentos devidos, depois a garantia, com decisão registrada', async () => {
    const [multa] = await app.agora.banco.consultar<{ id: string; contrato_id: string; valor_multa: number }>(
      `SELECT s.id, s.contrato_id, s.valor_multa FROM sancoes s
         JOIN contratos_garantias g ON g.contrato_id = s.contrato_id AND g.situacao = 'vigente'
        WHERE s.tipo = 'multa' AND s.situacao = 'aplicada' ORDER BY s.id LIMIT 1`,
    );
    assert.ok(multa, 'multa aplicada em contrato com garantia');
    const antes = await obterJson<ExecucaoContrato>(app, gestor, `/api/v1/contratos/${multa.contrato_id}/execucao`);
    const saldoGarantia = antes.garantias.find((g) => g.situacao !== 'liberada')?.saldo ?? 0;
    const devidos = antes.pagamentosDevidos.reduce((t, p) => t + p.disponivel, 0);
    const decisao = { autoridade: 'Coordenadora de Contratos (autoridade competente)', ato: 'Despacho SEI 4455', decididaEm: hoje, justificativa: 'Desconto da multa aplicada após o trânsito do processo sancionatório, conforme o contrato e o art. 156, § 8º.' };
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/sancoes/${multa.id}/descontos`, { ...decisao, valor: 100 })).statusCode, 403);
    const acima = await chamar(app, gestor, 'POST', `/api/v1/sancoes/${multa.id}/descontos`, { ...decisao, valor: multa.valor_multa + 1 });
    assert.equal(acima.statusCode, 422);
    const r = await chamar(app, gestor, 'POST', `/api/v1/sancoes/${multa.id}/descontos`, { ...decisao, valor: multa.valor_multa });
    assert.equal(r.statusCode, 201, r.body);
    const desconto = r.json<RespostaDescontoMulta>();
    const totalPagamentos = desconto.plano.pagamentos.reduce((t, p) => t + p.valor, 0);
    assert.equal(totalPagamentos, Math.min(devidos, multa.valor_multa));
    assert.equal(desconto.plano.garantia, Math.min(saldoGarantia, multa.valor_multa - totalPagamentos));
    assert.ok(desconto.notificacaoId);
    const depois = await obterJson<ExecucaoContrato>(app, gestor, `/api/v1/contratos/${multa.contrato_id}/execucao`);
    const garantiaDepois = depois.garantias.find((g) => g.movimentos.some((m) => m.tipo === 'desconto_multa'));
    assert.equal(garantiaDepois?.saldo, saldoGarantia - desconto.plano.garantia);
    assert.equal(depois.multas.find((m) => m.sancaoId === multa.id)?.descontado, totalPagamentos + desconto.plano.garantia);
  });

  test('alteração justificada da ordem cronológica: prévia, com comunicações e exceção justificada na 2ª linha', async () => {
    const [alvo] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT p.id FROM pagamentos p
        WHERE p.situacao IN ('atestado', 'liquidado')
          AND EXISTS (SELECT 1 FROM pagamentos q WHERE q.fonte_recurso = p.fonte_recurso AND q.situacao <> 'pago' AND q.vencimento < p.vencimento)
        ORDER BY p.vencimento DESC LIMIT 1`,
    );
    assert.ok(alvo);
    const decisao = { inciso: 'II', justificativa: JUSTIFICATIVA, autoridade: 'Ordenador de despesas da unidade', ato: 'Despacho SEI 9911', decididaEm: hoje };
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/pagamentos/${alvo.id}/alteracoes-ordem`, decisao)).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/pagamentos/${alvo.id}/alteracoes-ordem`, { ...decisao, inciso: 'VI' })).statusCode, 400);
    const r = await chamar(app, gestor, 'POST', `/api/v1/pagamentos/${alvo.id}/alteracoes-ordem`, decisao);
    assert.equal(r.statusCode, 201, r.body);
    const alteracao = r.json<AlteracaoOrdemCronologica>();
    assert.equal(alteracao.comunicacaoPendente, true);
    for (const orgao of ['controle_interno', 'tribunal_contas'] as const) {
      const c = await chamar(app, gestor, 'POST', `/api/v1/alteracoes-ordem/${alteracao.id}/comunicacoes`, { orgao, data: hoje, protocolo: `Ofício ${orgao}` });
      assert.equal(c.statusCode, 200, c.body);
    }
    const final = await obterJson<AlteracaoOrdemCronologica[]>(app, gestor, '/api/v1/alteracoes-ordem');
    assert.equal(final.find((a) => a.id === alteracao.id)?.comunicacaoPendente, false);
    const painel = await obterJson<PainelSegundaLinha>(app, controle, '/api/v1/controle/segunda-linha');
    assert.ok(painel.excecoes.some((e) => e.tipo === 'ordem_cronologica' && e.referencia.id === alvo.id));

    // pagamento já feito antes da decisão: a justificativa não é prévia
    const [pago] = await app.agora.banco.consultar<{ id: string }>(`SELECT id FROM pagamentos WHERE situacao = 'pago' AND pago_em < $1::date ORDER BY pago_em DESC LIMIT 1`, [hoje]);
    assert.ok(pago);
    const tardia = await chamar(app, gestor, 'POST', `/api/v1/pagamentos/${pago.id}/alteracoes-ordem`, decisao);
    assert.equal(tardia.statusCode, 422);
    assert.match(tardia.body, /ALTERACAO_ORDEM_NAO_PREVIA/);
  });

  test('prazos de pagamento: resumo e atualização estimada nas parcelas vencidas', async () => {
    const prazos = await obterJson<PaginaPrazosPagamento>(app, gestor, '/api/v1/pagamentos/prazos?situacao=vencido&tamanhoPagina=100');
    assert.ok(prazos.total >= 0);
    assert.equal(prazos.resumo.vencidos, prazos.total);
    for (const p of prazos.itens) {
      assert.equal(p.situacao, 'vencido');
      assert.ok(p.diasAtraso > 0);
      if (p.atualizacao) assert.match(p.atualizacao.aviso, /requer revisão humana/);
    }
  });
});
