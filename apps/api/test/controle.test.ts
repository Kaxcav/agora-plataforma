import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adicionarDias, hojeISO, prazoRespostaCautelar } from '@agora/dominio';
import type {
  EventoAuditoria,
  EventoHistorico,
  MatrizRiscosContrato,
  MedidaControle,
  Pagina,
  PainelPrimeiraLinha,
  PainelSegundaLinha,
  PainelTerceiraLinha,
  ProcessoDetalhe,
  ProcessoResumo,
  RespostaErro,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { verificarControleExterno } from '../src/compartilhado/controle-externo.ts';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, type Credenciais } from './apoio.ts';

const HOJE = hojeISO(new Date(INICIO_TESTES));

describe('controle das contratações — linhas de defesa (RF-23), controle externo (RF-24, RN-30) e matriz de riscos (RN-29)', () => {
  let app: FastifyInstance;
  let controle: Credenciais;
  let fiscal: Credenciais;
  let juridico: Credenciais;
  let auditor: Credenciais;
  let gestor: Credenciais;
  let agente: Credenciais;
  let consulta: Credenciais;

  const processoPorBusca = async (busca: string): Promise<ProcessoResumo> => {
    const lista = await obterJson<Pagina<ProcessoResumo>>(app, agente, `/api/v1/processos?busca=${encodeURIComponent(busca)}`);
    const p = lista.itens[0];
    assert.ok(p, `processo "${busca}" no seed`);
    return p;
  };
  const regras = (r: { json<T>(): T }) => (r.json<RespostaErro>().erro.detalhes ?? []).map((d) => d.campo);

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    controle = await entrar(app, 'controle@agora.demo');
    fiscal = await entrar(app, 'fiscal@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    auditor = await entrar(app, 'auditor@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('perfil "Controle interno" de demonstração, com as permissões da 2ª linha', async () => {
    assert.deepEqual(controle.sessao.usuario.perfis, ['controle_interno']);
    assert.equal(controle.sessao.usuario.todasUasgs, true);
    for (const p of ['controle:segunda_linha', 'controle_externo:registrar', 'riscos:revisar'] as const) assert.ok(controle.sessao.usuario.permissoes.includes(p), p);
    assert.ok(!controle.sessao.usuario.permissoes.includes('controle:terceira_linha'));
    const config = (await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' })).json<{ usuariosDemonstracao: { email: string }[] }>();
    assert.ok(config.usuariosDemonstracao.some((u) => u.email === 'controle@agora.demo'));
  });

  test('cada linha vê o seu painel; o servidor nega os demais (403)', async () => {
    const status = async (c: Credenciais, linha: string) => (await chamar(app, c, 'GET', `/api/v1/controle/${linha}-linha`)).statusCode;
    assert.deepEqual([await status(fiscal, 'primeira'), await status(fiscal, 'segunda'), await status(fiscal, 'terceira')], [200, 403, 403]);
    assert.deepEqual([await status(juridico, 'primeira'), await status(juridico, 'segunda'), await status(juridico, 'terceira')], [403, 200, 403]);
    assert.deepEqual([await status(controle, 'primeira'), await status(controle, 'segunda'), await status(controle, 'terceira')], [403, 200, 403]);
    assert.deepEqual([await status(auditor, 'primeira'), await status(auditor, 'segunda'), await status(auditor, 'terceira')], [200, 200, 200]);
    assert.deepEqual([await status(consulta, 'primeira'), await status(consulta, 'segunda'), await status(consulta, 'terceira')], [403, 403, 403]);
    const externo = await entrar(app, 'auditoria.externa@agora.demo');
    assert.deepEqual(externo.sessao.usuario.perfis, ['auditor']);
    assert.equal(await status(externo, 'terceira'), 200);
  });

  test('1ª linha: pendências, prazos e bloqueios só das UASGs do usuário', async () => {
    const painel = await obterJson<PainelPrimeiraLinha>(app, fiscal, '/api/v1/controle/primeira-linha');
    const escopo = new Set(fiscal.sessao.usuario.uasgs);
    assert.ok(painel.indicadores.pendenciasAbertas >= painel.indicadores.pendenciasVencidas);
    for (const p of painel.pendenciasVencidas) {
      assert.ok(escopo.has(p.uasg), 'pendência fora do escopo');
      assert.ok(p.prazo !== null && p.prazo < HOJE);
    }
    for (const r of painel.revisoesRiscos) assert.ok(escopo.has(r.uasg));
    for (const m of painel.medidas) assert.ok(escopo.has(m.uasg));
    assert.ok(painel.fontes.length >= 3);

    const geral = await obterJson<PainelPrimeiraLinha>(app, gestor, '/api/v1/controle/primeira-linha');
    assert.ok(geral.revisoesRiscos.some((r) => r.revisao.situacao === 'vencida'), 'o seed tem revisão vencida');
    assert.ok(geral.processosBloqueados.length > 0);
    assert.ok(geral.processosBloqueados.every((p) => p.bloqueios.length > 0));
    const uasg = geral.revisoesRiscos[0]?.uasg ?? '';
    const filtrado = await obterJson<PainelPrimeiraLinha>(app, gestor, `/api/v1/controle/primeira-linha?uasg=${uasg}`);
    assert.ok(filtrado.revisoesRiscos.every((r) => r.uasg === uasg));
  });

  test('2ª linha: pareceres pendentes, matriz de achados preventivos e exceções justificadas', async () => {
    const painel = await obterJson<PainelSegundaLinha>(app, juridico, '/api/v1/controle/segunda-linha');
    assert.ok(painel.pareceresPendentes.length >= 1, 'há processo na etapa 5 sem parecer');
    assert.ok(painel.achados.length > 0);
    assert.ok(painel.achados.every((a) => a.fundamento.startsWith('Lei 14.133/2021')));
    assert.ok(painel.achados.some((a) => a.tipo === 'revisao_riscos'));
    assert.equal(painel.indicadores.achadosRisco + painel.indicadores.achadosAtencao, painel.achados.length);
    assert.ok(painel.excecoes.length >= 1, 'os processos do seed têm justificativas registradas');
    assert.ok(painel.medidas.every((m) => m.situacao !== 'revogada'));
  });

  test('3ª linha: leitura ampla, integridade da trilha e medidas com prazo', async () => {
    const painel = await obterJson<PainelTerceiraLinha>(app, auditor, '/api/v1/controle/terceira-linha');
    assert.equal(painel.integridade.integra, true);
    assert.equal(painel.periodo.ate, HOJE);
    assert.equal(painel.periodo.de, adicionarDias(HOJE, -90));
    assert.ok(painel.medidas.length >= 5, 'medidas sintéticas do seed');
    assert.ok(painel.medidas.some((m) => m.situacao === 'resposta_vencida'));
    assert.ok(painel.medidas.some((m) => m.situacao === 'revogada'));
    assert.ok(painel.medidas.some((m) => m.bloqueia && m.alvo.tipo === 'contrato'));
    assert.ok(painel.indicadores.eventosNoPeriodo > 0);
    assert.ok(painel.ultimosEventos.length > 0 && painel.ultimosEventos.length <= 10);
    const invalido = await chamar(app, auditor, 'GET', '/api/v1/controle/terceira-linha?de=2026-12-01&ate=2026-11-01');
    assert.equal(invalido.statusCode, 400);
  });

  test('relatório executivo de auditoria em PDF, com a emissão registrada na trilha', async () => {
    const r = await chamar(app, auditor, 'GET', `/api/v1/controle/relatorio.pdf?de=${adicionarDias(HOJE, -30)}&ate=${HOJE}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.ok(r.rawPayload.subarray(0, 5).toString('latin1') === '%PDF-');
    assert.match(String(r.headers['content-disposition']), /relatorio-auditoria-/);
    assert.equal((await chamar(app, juridico, 'GET', '/api/v1/controle/relatorio.pdf')).statusCode, 403);
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=controle.relatorio.emitir');
    assert.equal(trilha.total, 1);
    assert.match(trilha.itens[0]?.resumo ?? '', /relatório executivo de auditoria/);
  });

  test('RN-30: cautelar suspensiva bloqueia avanço e contratação até a revogação, com prazo de 10 dias úteis', async () => {
    const viaturas = await processoPorBusca('viaturas');
    const coletes = await processoPorBusca('coletes');
    const entrada = {
      orgao: 'TCU',
      tipo: 'cautelar',
      numero: '9001/2026',
      decididaEm: adicionarDias(HOJE, -2),
      cienciaEm: adicionarDias(HOJE, -1),
      objeto: 'Suspensão cautelar sintética do certame para exame de cláusula do edital.',
      efeitoSuspensivo: true,
      processoId: viaturas.id,
      contratoId: null,
      prazoDiasUteis: null,
    };
    for (const sem of [fiscal, juridico, gestor, agente, auditor]) {
      assert.equal((await chamar(app, sem, 'POST', '/api/v1/medidas-controle', entrada)).statusCode, 403);
    }
    const criada = await chamar(app, controle, 'POST', '/api/v1/medidas-controle', entrada);
    assert.equal(criada.statusCode, 201, criada.body);
    const medida = criada.json<MedidaControle>();
    assert.equal(medida.prazoResposta, prazoRespostaCautelar(entrada.cienciaEm).vencimento);
    assert.equal(medida.diasUteisPrazo, 10);
    assert.equal(medida.bloqueia, true);
    assert.equal(medida.alvo.caminho, `/jornada/${viaturas.id}`);

    const contratar = await chamar(app, agente, 'POST', `/api/v1/processos/${viaturas.id}/contratar`);
    assert.equal(contratar.statusCode, 422);
    assert.deepEqual(regras(contratar), ['RN-30']);
    assert.match(contratar.json<RespostaErro>().erro.mensagem, /TCU nº 9001\/2026/);
    const detalhe = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${viaturas.id}`);
    assert.ok(detalhe.bloqueiosDetalhe.some((b) => b.regra === 'RN-30'));

    // Outro processo, na etapa 6, também não avança enquanto a cautelar sobre ele vigorar.
    const segunda = await chamar(app, controle, 'POST', '/api/v1/medidas-controle', { ...entrada, numero: '9002/2026', processoId: coletes.id });
    assert.equal(segunda.statusCode, 201);
    const avancar = await chamar(app, agente, 'POST', `/api/v1/processos/${coletes.id}/avancar`);
    assert.equal(avancar.statusCode, 422);
    assert.ok(regras(avancar).includes('RN-30'));

    // Resposta, prorrogação e revogação, com as travas de estado.
    const resposta = { respondidaEm: HOJE, texto: 'Informadas ao tribunal as medidas adotadas e prestadas as informações cabíveis.' };
    assert.equal((await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/prorrogacao`, { prorrogadoAte: medida.prazoResposta, justificativa: 'Prazo igual ao atual' })).statusCode, 422);
    const prorrogada = await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/prorrogacao`, {
      prorrogadoAte: adicionarDias(medida.prazoResposta, 7),
      justificativa: 'Prorrogação concedida pelo relator a pedido do órgão.',
    });
    assert.equal(prorrogada.statusCode, 200);
    assert.equal(prorrogada.json<MedidaControle>().prorrogacao?.ate, adicionarDias(medida.prazoResposta, 7));
    const respondida = await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/resposta`, resposta);
    assert.equal(respondida.statusCode, 200);
    const aposResposta = respondida.json<MedidaControle>();
    assert.equal(aposResposta.situacao, 'respondida');
    assert.equal(aposResposta.bloqueia, true, 'a resposta não levanta a suspensão');
    assert.ok(aposResposta.prazoDecisaoMerito, 'prazo informativo do tribunal (art. 171, § 1º)');
    assert.equal((await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/resposta`, resposta)).statusCode, 409);

    const revogada = await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/revogacao`, {
      revogadaEm: HOJE,
      texto: 'Plenário revogou a cautelar após as informações.',
    });
    assert.equal(revogada.statusCode, 200);
    assert.equal(revogada.json<MedidaControle>().bloqueia, false);
    const liberado = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${viaturas.id}`);
    assert.ok(!liberado.bloqueiosDetalhe.some((b) => b.regra === 'RN-30'));
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${viaturas.id}/contratar`)).statusCode, 200);
    assert.equal((await chamar(app, controle, 'POST', `/api/v1/medidas-controle/${medida.id}/revogacao`, { revogadaEm: HOJE, texto: 'De novo, por engano.' })).statusCode, 409);

    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?recurso=medida_controle&busca=${medida.id}&tamanhoPagina=100`);
    assert.deepEqual(trilha.itens.map((e) => e.acao).sort(), ['medida_controle.prorrogar', 'medida_controle.registrar', 'medida_controle.responder', 'medida_controle.revogar']);
  });

  test('validação da medida: efeito suspensivo só em cautelar, alvo único, prazo legal e ciência não futura', async () => {
    const viaturas = await processoPorBusca('viaturas');
    const base = {
      orgao: 'CGU',
      tipo: 'recomendacao',
      numero: '55/2026',
      decididaEm: adicionarDias(HOJE, -3),
      cienciaEm: adicionarDias(HOJE, -2),
      objeto: 'Recomendação sintética para revisar controles de recebimento.',
      efeitoSuspensivo: false,
      processoId: viaturas.id,
      contratoId: null,
      prazoDiasUteis: 5,
    };
    const status = async (corpo: Record<string, unknown>) => (await chamar(app, controle, 'POST', '/api/v1/medidas-controle', corpo)).statusCode;
    assert.equal(await status({ ...base, efeitoSuspensivo: true, prazoDiasUteis: null }), 400);
    assert.equal(await status({ ...base, tipo: 'cautelar', efeitoSuspensivo: true }), 400);
    assert.equal(await status({ ...base, processoId: null }), 400);
    assert.equal(await status({ ...base, cienciaEm: adicionarDias(HOJE, 1), decididaEm: HOJE }), 400);
    assert.equal(await status({ ...base, cienciaEm: adicionarDias(HOJE, -5) }), 400, 'ciência antes da decisão');
    const criada = await chamar(app, controle, 'POST', '/api/v1/medidas-controle', base);
    assert.equal(criada.statusCode, 201);
    assert.equal(criada.json<MedidaControle>().diasUteisPrazo, 5);
    assert.equal(criada.json<MedidaControle>().bloqueia, false);
  });

  test('escopo de UASG nas medidas: fora do escopo não aparece e responde 404', async () => {
    const todas = await obterJson<Pagina<MedidaControle>>(app, controle, '/api/v1/medidas-controle?tamanhoPagina=100');
    const escopo = new Set(fiscal.sessao.usuario.uasgs);
    const doFiscal = await obterJson<Pagina<MedidaControle>>(app, fiscal, '/api/v1/medidas-controle?tamanhoPagina=100');
    assert.ok(doFiscal.itens.every((m) => escopo.has(m.uasg)));
    const fora = todas.itens.find((m) => !escopo.has(m.uasg));
    if (fora) assert.equal((await chamar(app, fiscal, 'GET', `/api/v1/medidas-controle/${fora.id}`)).statusCode, 404);
    const abertas = await obterJson<Pagina<MedidaControle>>(app, controle, '/api/v1/medidas-controle?situacao=abertas&tamanhoPagina=100');
    assert.ok(abertas.itens.every((m) => m.bloqueia || m.situacao === 'aguardando_resposta' || m.situacao === 'resposta_vencida'));
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/medidas-controle')).statusCode, 403);
  });

  test('verificação para os contratos: cautelar suspensiva sobre o contrato bloqueia a assinatura de termos', async () => {
    const suspensas = (await obterJson<Pagina<MedidaControle>>(app, auditor, '/api/v1/medidas-controle?alvo=contrato&tamanhoPagina=100')).itens.filter((m) => m.bloqueia);
    const alvo = suspensas[0];
    assert.ok(alvo, 'o seed tem cautelar suspensiva sobre contrato');
    const r = await verificarControleExterno(app.agora.banco, { contratoId: alvo.alvo.id }, HOJE);
    assert.equal(r.bloqueado, true);
    assert.match(r.mensagem ?? '', /assinatura do contrato/);
    const livre = await verificarControleExterno(app.agora.banco, { contratoId: '00000000-0000-4000-8000-000000000000' }, HOJE);
    assert.equal(livre.bloqueado, false);
  });

  test('RN-29: revisão trimestral vencida aparece e é registrada com a matriz atualizada e auditoria', async () => {
    const painel = await obterJson<PainelPrimeiraLinha>(app, gestor, '/api/v1/controle/primeira-linha');
    const vencida = painel.revisoesRiscos.find((r) => r.revisao.situacao === 'vencida');
    assert.ok(vencida);
    const id = vencida.contrato.id;
    const antes = await obterJson<MatrizRiscosContrato>(app, gestor, `/api/v1/contratos/${id}/riscos`);
    assert.equal(antes.revisao.situacao, 'vencida');

    const entrada = {
      riscos: [
        { descricao: 'Atraso na entrega dos itens', probabilidade: 3, impacto: 4, alocacao: 'contratada', mitigacao: 'Cronograma com marcos e multa moratória.' },
        { descricao: 'Variação de preço de insumos', probabilidade: 2, impacto: 3, alocacao: 'compartilhado', mitigacao: 'Reajuste anual pelo índice do contrato.' },
      ],
      observacao: 'Revisão trimestral feita com a equipe de fiscalização; riscos reavaliados.',
    };
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/contratos/${id}/riscos/revisoes`, entrada)).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${id}/riscos/revisoes`, { ...entrada, riscos: [] })).statusCode, 400);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${id}/riscos/revisoes`, entrada);
    assert.equal(r.statusCode, 201, r.body);
    const depois = r.json<MatrizRiscosContrato>();
    assert.equal(depois.origem, 'revisao');
    assert.equal(depois.revisao.situacao, 'em_dia');
    assert.equal(depois.revisoes[0]?.revisadaEm, HOJE);
    assert.equal(depois.revisoes[0]?.linha, 'primeira');
    assert.equal(depois.riscos.length, 2);

    const pelaSegunda = await chamar(app, controle, 'POST', `/api/v1/contratos/${id}/riscos/revisoes`, entrada);
    assert.equal(pelaSegunda.json<MatrizRiscosContrato>().revisoes[0]?.linha, 'segunda');

    const historico = await obterJson<EventoHistorico[]>(app, gestor, `/api/v1/contratos/${id}/historico`);
    assert.ok(historico.some((h) => h.acao.startsWith('Registrou a revisão trimestral da matriz de riscos')));
    const novo = await obterJson<PainelPrimeiraLinha>(app, gestor, '/api/v1/controle/primeira-linha');
    assert.ok(!novo.revisoesRiscos.some((x) => x.contrato.id === id));

    const fora = painel.revisoesRiscos.find((x) => !fiscal.sessao.usuario.uasgs.includes(x.uasg));
    if (fora) assert.equal((await chamar(app, fiscal, 'POST', `/api/v1/contratos/${fora.contrato.id}/riscos/revisoes`, entrada)).statusCode, 404);
  });
});
