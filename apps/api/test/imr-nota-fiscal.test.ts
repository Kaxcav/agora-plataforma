import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ContextoConferenciaNota, ImrContrato, Pagina, Pagamento, RespostaAtesto, RespostaErro, RespostaMedicaoImr, Tarefa } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('F7 — IMR do contrato e conferência da nota fiscal (RF-29 e RN-36)', () => {
  let app: FastifyInstance;
  let fiscal: Credenciais;
  let gestor: Credenciais;
  let consulta: Credenciais;
  let contratoId: string;
  let imr: ImrContrato;

  before(async () => {
    app = await criarAppTeste();
    fiscal = await entrar(app, 'fiscal.tecnico@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
    const [linha] = await app.agora.banco.consultar<{ contrato_id: string }>('SELECT DISTINCT contrato_id FROM imr_indicadores');
    assert.ok(linha, 'a carga sintética configura o IMR de um contrato');
    contratoId = linha.contrato_id;
    imr = await obterJson<ImrContrato>(app, gestor, `/api/v1/contratos/${contratoId}/imr`);
  });

  after(async () => {
    await app.close();
  });

  const competenciaAnterior = () => {
    const [ano, mes] = app.agora.hoje().slice(0, 7).split('-').map(Number);
    const total = (ano ?? 0) * 12 + (mes ?? 1) - 2;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  };

  test('carga: dois indicadores e duas medições — uma na meta e outra com glosa — e a competência anterior pendente', () => {
    assert.equal(imr.indicadores.length, 2);
    assert.deepEqual(imr.indicadores.map((i) => i.formaCalculo).sort(), ['percentual_razao', 'valor_medido']);
    assert.equal(imr.medicoes.length, 2);
    assert.equal(imr.resumo.naMeta, 1);
    assert.equal(imr.resumo.comGlosa, 1);
    assert.match(imr.fundamento, /art\. 6º, XXIII, "g"/);
    const atual = imr.competencias[0];
    assert.equal(atual?.competencia, competenciaAnterior());
    assert.deepEqual(atual?.pendentes.map((p) => p.codigo), ['IND-01']);
    assert.equal(atual?.pagamento?.situacao, 'previsto');
    const comGlosa = imr.competencias.find((c) => c.percentualGlosaSomado > 0);
    assert.equal(comGlosa?.conferencia?.situacao, 'justificada', 'a nota da competência com glosa foi conferida com a divergência justificada');
    assert.ok((comGlosa?.conferencia?.glosaImr ?? 0) > 0);
  });

  test('fora do escopo de UASG → 404; leitura exige contratos:ler', async () => {
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/contratos/${contratoId}/imr`)).statusCode, 404);
  });

  test('RN-36: contrato com IMR — atesto sem conferência é recusado (422)', async () => {
    const pagamentoId = imr.competencias[0]?.pagamento?.id ?? '';
    const contexto = await obterJson<ContextoConferenciaNota>(app, fiscal, `/api/v1/pagamentos/${pagamentoId}/conferencia`);
    assert.equal(contexto.contrato.temImr, true);
    assert.equal(contexto.atesto.liberado, false);
    const r = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/atestar`);
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json<RespostaErro>().erro.detalhes?.[0]?.campo, 'RN-36');
  });

  test('conferência antes da medição: medição pendente; a medição abaixo do limite recalcula a nota, encaminha e conclui a tarefa', async () => {
    const pagamentoId = imr.competencias[0]?.pagamento?.id ?? '';
    const competencia = competenciaAnterior();
    const contexto = await obterJson<ContextoConferenciaNota>(app, fiscal, `/api/v1/pagamentos/${pagamentoId}/conferencia`);
    const item = contexto.itensContrato[0];
    assert.ok(item);
    const nota = {
      numeroNota: 'NF 70001',
      emitidaEm: app.agora.hoje(),
      valorNota: item.valorUnitario,
      itens: [{ itemContratoId: item.id, quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: item.valorUnitario }],
    };
    const r = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia`, nota);
    assert.equal(r.statusCode, 200, r.body);
    const registrada = r.json<ContextoConferenciaNota>();
    assert.equal(registrada.conferencia?.situacao, 'divergente');
    assert.deepEqual(registrada.conferencia?.divergencias.map((d) => d.tipo), ['medicao_imr_pendente']);
    assert.equal(registrada.pagamento.notaFiscal, 'NF 70001');

    // 650 de 720 horas = 90,28%: abaixo de 93% → faixa 2, glosa de 7% e encaminhamento sancionatório.
    const indicador = imr.indicadores.find((i) => i.codigo === 'IND-01');
    const m = await chamar(app, fiscal, 'POST', `/api/v1/contratos/${contratoId}/imr/medicoes`, {
      indicadorId: indicador?.id,
      competencia,
      numerador: 650,
      denominador: 720,
      evidencia: 'Relatório de disponibilidade do mês com as janelas de indisponibilidade registradas.',
      referenciaEvidencia: 'Documento de teste 1',
    });
    assert.equal(m.statusCode, 201, m.body);
    const medicao = m.json<RespostaMedicaoImr>();
    assert.equal(medicao.medicao.resultado, 90.28);
    assert.equal(medicao.medicao.faixa, 2);
    assert.equal(medicao.medicao.percentualGlosa, 7);
    assert.equal(medicao.pendenciaAberta, true);
    assert.equal(medicao.conferenciasRecalculadas, 1);
    assert.ok(medicao.medicao.memoriaCalculo.some((l) => /Faixa 2/.test(l)));

    const depois = await obterJson<ContextoConferenciaNota>(app, fiscal, `/api/v1/pagamentos/${pagamentoId}/conferencia`);
    const glosa = Math.round((item.valorUnitario * 7) / 100);
    assert.equal(depois.conferencia?.glosaImr, glosa);
    assert.equal(depois.conferencia?.valorDevido, item.valorUnitario - glosa);
    assert.deepEqual(depois.conferencia?.divergencias.map((d) => d.tipo), ['valor_nota_diferente_do_devido']);
    assert.equal(depois.conferencia?.versao, 2);

    const [pendencia] = await app.agora.banco.consultar<{ motivo: string }>("SELECT motivo FROM pendencias WHERE id = $1", [medicao.medicao.pendenciaId ?? '']);
    assert.match(pendencia?.motivo ?? '', /processo sancionatório/);
    assert.match(pendencia?.motivo ?? '', /autoridade competente/);
    const tarefas = await obterJson<Tarefa[]>(app, gestor, `/api/v1/contratos/${contratoId}/tarefas`);
    const tarefa = tarefas.find((t) => t.titulo.startsWith('Registrar as medições do IMR') && t.titulo.endsWith(`${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`));
    assert.equal(tarefa?.situacao, 'concluida');
  });

  test('RN-36: divergência sem justificativa bloqueia o atesto; com justificativa, o atesto passa e liquida pelo valor devido', async () => {
    const pagamentoId = imr.competencias[0]?.pagamento?.id ?? '';
    const bloqueado = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/atestar`);
    assert.equal(bloqueado.statusCode, 422);
    assert.match(bloqueado.json<RespostaErro>().erro.mensagem, /divergência/);

    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia/justificativa`, { justificativa: 'x'.repeat(30) })).statusCode, 403);
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia/justificativa`, { justificativa: 'curta' })).statusCode, 400);
    const j = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia/justificativa`, {
      justificativa: 'A glosa do IMR foi comunicada ao preposto; a nota veio pelo valor cheio e a diferença é descontada na liquidação.',
    });
    assert.equal(j.statusCode, 200, j.body);
    const justificada = j.json<ContextoConferenciaNota>();
    assert.equal(justificada.conferencia?.situacao, 'justificada');
    assert.equal(justificada.atesto.liberado, true);
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia/justificativa`, { justificativa: 'y'.repeat(30) })).statusCode, 409);

    const a = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/atestar`);
    assert.equal(a.statusCode, 200, a.body);
    const atestado = a.json<RespostaAtesto>();
    assert.equal(atestado.valor, justificada.conferencia?.valorALiquidar);
    const [evento] = await app.agora.banco.consultar<{ dados: { conferenciaNota?: { situacao: string } } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'pagamento.atestar' AND recurso_id = $1 ORDER BY ocorrido_em DESC LIMIT 1",
      [pagamentoId],
    );
    assert.equal(evento?.dados.conferenciaNota?.situacao, 'justificada');
    const [justificativa] = await app.agora.banco.consultar<{ total: number }>(
      "SELECT COUNT(*)::integer AS total FROM auditoria_eventos WHERE acao = 'pagamento.conferencia.justificar' AND recurso_id = $1",
      [pagamentoId],
    );
    assert.equal(justificativa?.total, 1);
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${pagamentoId}/conferencia`, { numeroNota: 'NF 1', emitidaEm: app.agora.hoje(), valorNota: 1, itens: [{ itemContratoId: justificada.itensContrato[0]?.id, quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 1 }] })).statusCode, 409);
  });

  test('medição: competência em curso → 422; repetida → 409; sem imr:medir → 403', async () => {
    const indicador = imr.indicadores.find((i) => i.codigo === 'IND-01');
    const base = { indicadorId: indicador?.id, numerador: 700, denominador: 720, evidencia: 'Relatório mensal de disponibilidade do serviço.' };
    const emCurso = await chamar(app, fiscal, 'POST', `/api/v1/contratos/${contratoId}/imr/medicoes`, { ...base, competencia: app.agora.hoje().slice(0, 7) });
    assert.equal(emCurso.statusCode, 422);
    const repetida = await chamar(app, fiscal, 'POST', `/api/v1/contratos/${contratoId}/imr/medicoes`, { ...base, competencia: competenciaAnterior() });
    assert.equal(repetida.statusCode, 409);
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/contratos/${contratoId}/imr/medicoes`, { ...base, competencia: competenciaAnterior() })).statusCode, 403);
  });

  test('configuração: gestor inclui, altera e encerra indicador; faixa dentro da meta → 422; com medições não se altera; fiscal não configura', async () => {
    const novo = {
      codigo: 'IND-03',
      nome: 'Chamados reabertos no mês',
      formaCalculo: 'valor_medido',
      descricaoCalculo: 'Quantidade de chamados reabertos por falha na solução no mês.',
      rotuloNumerador: null,
      rotuloDenominador: null,
      unidade: 'chamados',
      sentidoMeta: 'menor_igual',
      meta: 2,
      periodicidade: 'trimestral',
      inicioCompetencia: app.agora.hoje().slice(0, 7),
      fonteMedicao: 'Central de atendimento da contratada',
      itensAlcancados: [imr.itensContrato[0]?.id],
      faixas: [{ limite: 2, percentualGlosa: 1, percentualPorUnidade: 0.5, encaminharSancionatorio: false }],
      tetoPercentual: 3,
    };
    assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/contratos/${contratoId}/imr/indicadores`, novo)).statusCode, 403);
    const invalido = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/imr/indicadores`, { ...novo, faixas: [{ limite: 1, percentualGlosa: 1, percentualPorUnidade: 0, encaminharSancionatorio: false }] });
    assert.equal(invalido.statusCode, 422);
    const criado = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/imr/indicadores`, novo);
    assert.equal(criado.statusCode, 201, criado.body);
    const config = criado.json<ImrContrato>();
    const ind3 = config.indicadores.find((i) => i.codigo === 'IND-03');
    assert.equal(ind3?.itensAlcancados.length, 1);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/imr/indicadores`, novo)).statusCode, 409);
    const alterado = await chamar(app, gestor, 'PUT', `/api/v1/contratos/${contratoId}/imr/indicadores/${ind3?.id}`, { ...novo, meta: 3, faixas: [{ limite: 3, percentualGlosa: 1, percentualPorUnidade: 0, encaminharSancionatorio: false }] });
    assert.equal(alterado.statusCode, 200, alterado.body);
    assert.equal(alterado.json<ImrContrato>().indicadores.find((i) => i.codigo === 'IND-03')?.meta, 3);
    const ind1 = config.indicadores.find((i) => i.codigo === 'IND-01');
    assert.equal(ind1?.temMedicoes, true);
    const travado = await chamar(app, gestor, 'PUT', `/api/v1/contratos/${contratoId}/imr/indicadores/${ind1?.id}`, { ...novo, codigo: 'IND-01' });
    assert.equal(travado.statusCode, 409);
    const encerrado = await chamar(app, gestor, 'POST', `/api/v1/contratos/${contratoId}/imr/indicadores/${ind3?.id}/encerrar`, {
      ultimaCompetencia: app.agora.hoje().slice(0, 7),
      justificativa: 'Indicador substituído conforme ajuste formalizado no contrato.',
    });
    assert.equal(encerrado.statusCode, 200, encerrado.body);
    assert.equal(encerrado.json<ImrContrato>().indicadores.find((i) => i.codigo === 'IND-03')?.situacao, 'encerrado');
  });

  test('contrato sem IMR: a conferência é opcional; nota igual ao devido fica conforme e não bloqueia', async () => {
    const [linha] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT p.id FROM pagamentos p
        WHERE p.situacao = 'previsto' AND NOT EXISTS (SELECT 1 FROM imr_indicadores i WHERE i.contrato_id = p.contrato_id)
        ORDER BY p.vencimento DESC LIMIT 1`,
    );
    assert.ok(linha);
    const contexto = await obterJson<ContextoConferenciaNota>(app, fiscal, `/api/v1/pagamentos/${linha.id}/conferencia`);
    assert.equal(contexto.contrato.temImr, false);
    assert.equal(contexto.atesto.liberado, true);
    const item = contexto.itensContrato[0];
    assert.ok(item);
    const r = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${linha.id}/conferencia`, {
      numeroNota: 'NF 80002',
      emitidaEm: app.agora.hoje(),
      valorNota: item.valorUnitario * 2,
      itens: [{ itemContratoId: item.id, quantidadeRecebida: 2, quantidadeFaturada: 2, valorUnitarioFaturado: item.valorUnitario }],
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<ContextoConferenciaNota>().conferencia?.situacao, 'conforme');
    // Preço acima do contratado → divergente; data de emissão futura → 400; item de outro contrato → 422.
    const acima = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${linha.id}/conferencia`, {
      numeroNota: 'NF 80002',
      emitidaEm: app.agora.hoje(),
      valorNota: (item.valorUnitario + 100) * 2,
      itens: [{ itemContratoId: item.id, quantidadeRecebida: 2, quantidadeFaturada: 2, valorUnitarioFaturado: item.valorUnitario + 100 }],
    });
    const divergente = acima.json<ContextoConferenciaNota>();
    assert.equal(divergente.conferencia?.situacao, 'divergente');
    assert.ok(divergente.conferencia?.divergencias.some((d) => d.tipo === 'preco_acima_contratado'));
    assert.equal(divergente.atesto.liberado, false);
    const futura = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${linha.id}/conferencia`, { numeroNota: 'NF 1', emitidaEm: '2099-01-01', valorNota: 1, itens: [{ itemContratoId: item.id, quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 1 }] });
    assert.equal(futura.statusCode, 400);
    const outro = imr.itensContrato[0]?.id;
    const fora = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${linha.id}/conferencia`, { numeroNota: 'NF 1', emitidaEm: app.agora.hoje(), valorNota: 1, itens: [{ itemContratoId: outro, quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: 1 }] });
    assert.equal(fora.statusCode, 422);
    const busca = await obterJson<Pagina<Pagamento>>(app, fiscal, '/api/v1/pagamentos?busca=80002');
    assert.ok(busca.itens.some((p) => p.id === linha.id), 'a nota conferida identifica a parcela na busca');
  });
});
