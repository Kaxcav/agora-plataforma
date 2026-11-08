/**
 * RN-21 (política de sustentabilidade do órgão, critérios do ETP e do TR) e RN-20/RN-22 nos parâmetros do edital
 * (prova de conceito ou amostra e inversão de fases). Processos sintéticos "scanners" (etapa 3) e "drones" (etapa 4).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, ParametrosEdital, PoliticaSustentabilidade, ProcessoDetalhe, ProcessoResumo, RespostaErro } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { hashParametrosDocumento } from '../src/modulos/jornada/parametros-edital.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const CRITERIOS = {
  criteriosAmbientais: 'Equipamentos com selo de eficiência energética, embalagens recicláveis e sem substâncias restritas.',
  logisticaReversa: 'O fornecedor recolhe os bens substituídos e os refugos para reciclagem e destinação adequada.',
};

function regras(resposta: { json<T>(): T }): string[] {
  return (resposta.json<RespostaErro>().erro.detalhes ?? []).map((d) => d.campo ?? '');
}

describe('sustentabilidade obrigatória (RN-21) e parâmetros de seleção do edital (RN-20, RN-22)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let planejamento: Credenciais;
  let agente: Credenciais;
  let gestor: Credenciais;
  let processos: ProcessoResumo[];
  const idDe = (fragmento: string) => {
    const p = processos.find((x) => x.titulo.toLowerCase().includes(fragmento));
    if (!p) throw new Error(fragmento);
    return p.id;
  };
  const detalhe = (id: string) => obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`);
  const politica = (ativa: boolean, credenciais = admin) =>
    chamar(app, credenciais, 'PUT', '/api/v1/politicas-orgao/sustentabilidade', { ativa, justificativa: 'Alteração sintética da política para o teste automatizado.' });

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    admin = await entrar(app, 'admin@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
  });
  after(async () => {
    await app.close();
  });

  test('a política começa ligada; só o administrador a altera, com justificativa e evento na trilha', async () => {
    const inicial = await obterJson<PoliticaSustentabilidade>(app, gestor, '/api/v1/politicas-orgao/sustentabilidade');
    assert.equal(inicial.ativa, true);
    assert.equal(inicial.alteradaPor, null);
    assert.equal((await politica(false, gestor)).statusCode, 403);
    assert.equal((await chamar(app, admin, 'PUT', '/api/v1/politicas-orgao/sustentabilidade', { ativa: false, justificativa: 'curta' })).statusCode, 400);

    const desligada = await politica(false);
    assert.equal(desligada.statusCode, 200);
    assert.equal(desligada.json<PoliticaSustentabilidade>().ativa, false);
    assert.equal(desligada.json<PoliticaSustentabilidade>().alteradaPor?.id, admin.sessao.usuario.id);
    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=politica.sustentabilidade.alterar');
    assert.equal(trilha.total, 1);
    assert.match(trilha.itens[0]?.resumo ?? '', /^Desligou a política de sustentabilidade/);
    assert.equal((await politica(true)).statusCode, 200);
  });

  test('ETP (etapa 3): sem os critérios, RN-21 bloqueia o avanço e a aprovação; com a política desligada, não bloqueia', async () => {
    const id = idDe('scanners');
    let p = await detalhe(id);
    assert.equal(p.sustentabilidade.politicaObrigatoria, true);
    assert.ok(p.sustentabilidade.criteriosAmbientais, 'critérios da carga sintética');
    assert.ok(!p.bloqueiosDetalhe.some((b) => b.regra === 'RN-21'));

    const limpo = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/sustentabilidade`, { criteriosAmbientais: null, logisticaReversa: '  ' });
    assert.equal(limpo.statusCode, 200);
    p = limpo.json<ProcessoDetalhe>();
    assert.equal(p.bloqueiosDetalhe.filter((b) => b.regra === 'RN-21').length, 2);
    const etp = p.documentos.find((d) => d.tipo === 'etp');
    assert.ok(etp);
    const aprovar = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/documentos/${etp.id}/aprovar`);
    assert.equal(aprovar.statusCode, 422);
    assert.deepEqual(regras(aprovar), ['RN-21', 'RN-21']);

    await politica(false);
    assert.ok(!(await detalhe(id)).bloqueiosDetalhe.some((b) => b.regra === 'RN-21'), 'política desligada não bloqueia');
    await politica(true);

    p = (await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/sustentabilidade`, CRITERIOS)).json<ProcessoDetalhe>();
    assert.ok(!p.bloqueiosDetalhe.some((b) => b.regra === 'RN-21'));
    const novo = (await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'etp' })).json<ProcessoDetalhe>();
    const etpNovo = novo.documentos.find((d) => d.tipo === 'etp');
    assert.ok(etpNovo);
    assert.match(etpNovo.conteudo, /Logística reversa \(desfazimento e reciclagem de bens e refugos\):\*\* O fornecedor recolhe/);
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/documentos/${etpNovo.id}/aprovar`)).statusCode, 200);
  });

  test('TR (etapa 4): o documento gerado traz a seção; gerado sem os critérios, não é aprovado nem conta para o avanço', async () => {
    const id = idDe('drones');
    const comCriterios = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'tr' })).json<ProcessoDetalhe>();
    const tr = comCriterios.documentos.find((d) => d.tipo === 'tr');
    assert.ok(tr);
    assert.match(tr.conteudo, /### Sustentabilidade ambiental e logística reversa/);
    assert.match(tr.conteudo, /<!-- protegido:sustentabilidade -->/);

    await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/sustentabilidade`, { criteriosAmbientais: null, logisticaReversa: null });
    const semCriterios = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'tr' })).json<ProcessoDetalhe>();
    const trPendente = semCriterios.documentos.find((d) => d.tipo === 'tr');
    assert.ok(trPendente);
    assert.match(trPendente.conteudo, /<!-- protegido:sustentabilidade_pendente -->/);
    assert.ok(semCriterios.bloqueiosDetalhe.filter((b) => b.regra === 'RN-21').length >= 2);
    assert.deepEqual(regras(await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${trPendente.id}/aprovar`)), ['RN-21', 'RN-21']);

    // Critérios preenchidos depois: a versão gerada sem eles continua sem valer.
    const preenchido = (await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/sustentabilidade`, CRITERIOS)).json<ProcessoDetalhe>();
    assert.ok(preenchido.bloqueiosDetalhe.some((b) => b.regra === 'RN-21' && /não traz os critérios/.test(b.mensagem)));
    const aprovar = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${trPendente.id}/aprovar`);
    assert.equal(aprovar.statusCode, 422);
    assert.match(JSON.stringify(aprovar.json()), /gerada sem os critérios de sustentabilidade/);
  });

  test('parâmetros do edital: prova de conceito ou amostra e inversão de fases bem instruídas (RN-20, RN-22) e refletidas nos documentos', async () => {
    const id = idDe('drones');
    const atual = (await detalhe(id)).parametrosEdital;
    const comAmostra: ParametrosEdital = {
      ...atual,
      exigeFaturamentoMinimo: false,
      provaConceito: { exigencia: 'prova_conceito', roteiro: 'curto', justificativa: null, prazoDiasUteis: 5 },
      inversaoFases: { adotada: true, motivacao: null },
    };
    let p = (await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/parametros-edital`, comAmostra)).json<ProcessoDetalhe>();
    const pendentes = p.bloqueiosDetalhe.map((b) => b.regra);
    assert.equal(pendentes.filter((r) => r === 'RN-20').length, 2, 'roteiro e justificativa');
    assert.ok(pendentes.includes('RN-22'), 'inversão sem motivação');
    assert.equal((await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/parametros-edital`, { ...comAmostra, provaConceito: { ...comAmostra.provaConceito, prazoDiasUteis: 31 } })).statusCode, 400);

    p = (
      await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/parametros-edital`, {
        ...comAmostra,
        provaConceito: {
          exigencia: 'prova_conceito',
          roteiro: 'Voo noturno de 30 minutos com detecção térmica de alvo a 300 m, aprovado se identificado em até 5 minutos.',
          justificativa: 'O desempenho térmico noturno só se verifica em demonstração prática do equipamento ofertado.',
          prazoDiasUteis: 5,
        },
        inversaoFases: { adotada: false, motivacao: null },
      })
    ).json<ProcessoDetalhe>();
    assert.ok(!p.bloqueiosDetalhe.some((b) => b.regra === 'RN-20' || b.regra === 'RN-22'));
    assert.ok(p.documentos.filter((d) => d.geradoComParametrosAnteriores).length >= 1, 'a prova de conceito muda os parâmetros do pacote do edital');
    const edital = (await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'edital' })).json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'edital');
    assert.match(edital?.conteudo ?? '', /5\.3\. Na fase de julgamento, o licitante provisoriamente vencedor será convocado para a prova de conceito/);
    assert.match(edital?.conteudo ?? '', /sessão pública transmitida e gravada/);
    assert.match(edital?.conteudo ?? '', /reconsiderá-lo em 3 dias úteis/);
    assert.match(edital?.conteudo ?? '', /art\. 54, § 3º/);
  });

  test('hash do pacote do edital: sem prova de conceito, o hash anterior é preservado', () => {
    const base: ParametrosEdital = {
      criterioJulgamento: 'menor_preco',
      regimeExecucao: 'outro',
      exigeFaturamentoMinimo: false,
      patrimonioLiquidoMinimoPercentual: null,
      exigeRegistroCadastralComplementar: false,
    };
    const semProva = { ...base, provaConceito: { exigencia: 'nenhuma' as const, roteiro: null, justificativa: null, prazoDiasUteis: null }, inversaoFases: { adotada: false, motivacao: null } };
    assert.equal(hashParametrosDocumento('tr', semProva), hashParametrosDocumento('tr', base));
    const comProva = { ...semProva, provaConceito: { exigencia: 'amostra' as const, roteiro: 'r', justificativa: 'j', prazoDiasUteis: 3 } };
    assert.notEqual(hashParametrosDocumento('tr', comProva), hashParametrosDocumento('tr', base));
  });

  test('os critérios só se editam até a etapa 4', async () => {
    const r = await chamar(app, agente, 'PUT', `/api/v1/processos/${idDe('rádios')}/sustentabilidade`, CRITERIOS);
    assert.equal(r.statusCode, 422);
  });
});
