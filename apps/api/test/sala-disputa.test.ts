import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { AtaSessao, Pagina, ProcessoDetalhe, ProcessoResumo, RespostaErro, RespostaSenhaTemporaria, SessaoDisputa, SessaoDisputaResumo, UsuarioAdmin } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { chamar, criarAppTeste, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

async function prepararProcessoNaEtapa6(app: FastifyInstance, agente: Credenciais): Promise<string> {
  const processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
  const radios = processos.find((p) => p.titulo.toLowerCase().includes('rádios'));
  assert.ok(radios, 'processo sintético dos rádios');
  const avancou = await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/avancar`);
  assert.equal(avancou.statusCode, 200, avancou.body);
  return radios.id;
}

async function fornecedor(app: FastifyInstance, prefixo: string): Promise<string> {
  const [linha] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE razao_social LIKE $1', [`${prefixo}%`]);
  if (!linha) throw new Error(`Fornecedor não encontrado: ${prefixo}`);
  return linha.id;
}

describe('sala de disputa — simulação da PoC-03 (4 empresas, duas com sócio em comum)', () => {
  const relogio = relogioManual();
  let app: FastifyInstance;
  let agente: Credenciais;
  let processoId: string;
  let sessaoId: string;
  let ids: { vigilant: string; aria: string; atlas: string; sentinela: string };

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE, relogio: relogio.relogio });
    agente = await entrar(app, 'agente@agora.demo');
    processoId = await prepararProcessoNaEtapa6(app, agente);
    ids = {
      vigilant: await fornecedor(app, 'Vigilant'),
      aria: await fornecedor(app, 'Ária'),
      atlas: await fornecedor(app, 'Atlas'),
      sentinela: await fornecedor(app, 'Sentinela'),
    };
  });
  after(async () => {
    await app.close();
  });

  const sessao = () => obterJson<SessaoDisputa>(app, agente, `/api/v1/sessoes-disputa/${sessaoId}`);
  const corpoNovo = (extra: Record<string, unknown> = {}) => ({
    uso: 'simulacao',
    criterio: 'menor_preco',
    modo: 'aberto',
    cenario: 'conluio_e_robo',
    participantes: [ids.vigilant, ids.aria, ids.atlas, ids.sentinela].map((fornecedorId) => ({ fornecedorId })),
    ...extra,
  });

  test('autorização: só quem conduz (agente de contratação) cria; planejamento não; consulta não lê', async () => {
    const planejamento = await entrar(app, 'planejamento@agora.demo');
    const negado = await chamar(app, planejamento, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, corpoNovo());
    assert.equal(negado.statusCode, 403);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${processoId}/sessoes-disputa`)).statusCode, 403);
  });

  test('validação: modo vedado pelo critério (art. 56), peso técnico acima de 70% e participantes insuficientes', async () => {
    const vedado = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, corpoNovo({ modo: 'fechado' }));
    assert.equal(vedado.statusCode, 422);
    assert.equal(erro(vedado).detalhes?.[0]?.campo, 'MODO_DISPUTA_VEDADO');
    const peso = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, corpoNovo({ criterio: 'tecnica_e_preco', modo: 'fechado', parametros: { pesoTecnicoPercentual: 80 } }));
    assert.equal(peso.statusCode, 400);
    const poucos = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, corpoNovo({ participantes: [{ fornecedorId: ids.aria }] }));
    assert.equal(poucos.statusCode, 400);
  });

  test('cria a simulação com identidades ocultas, perfis sintéticos sigilosos e o sinal de sócio em comum (RIA-06) anônimo', async () => {
    const criada = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, corpoNovo());
    assert.equal(criada.statusCode, 201, criada.body);
    const s = criada.json<SessaoDisputa>();
    sessaoId = s.id;
    assert.equal(s.fase, 'aguardando_abertura');
    assert.equal(s.identidadesOcultas, true);
    assert.equal(s.participantes.length, 4);
    assert.ok(s.participantes.every((p) => p.nome === null && p.fornecedorId === null && p.perfilSimulado === null && /^Licitante \d$/.test(p.rotulo)));
    assert.equal(s.parametros.duracaoEtapaAbertaSegundos, 600);
    assert.match(s.fundamentosParametros.prorrogacaoSegundos ?? '', /IN SEGES\/ME 73\/2022, art\. 23, § 1º/);
    assert.ok(s.valorReferencia !== null && s.valorReferencia > 0);
    assert.equal(s.acoes.abrir, true);
    const socio = s.sinais.find((x) => x.regra === 'RIA-06');
    assert.ok(socio, 'Ária e Atlas têm sócio em comum na carga sintética');
    assert.match(socio.evidencias[0] ?? '', /^Licitante \d e Licitante \d têm sócio em comum/);
    assert.doesNotMatch(JSON.stringify(s), /Ária|Atlas|Vigilant|Sentinela/);
    const lista = await obterJson<SessaoDisputaResumo[]>(app, agente, `/api/v1/processos/${processoId}/sessoes-disputa`);
    assert.deepEqual(lista.map((x) => x.id), [sessaoId]);
  });

  test('abre a sessão, adianta o relógio e mostra os lances sintéticos e a melhor oferta sem identificar o licitante', async () => {
    const aberta = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/abertura`);
    assert.equal(aberta.statusCode, 200, aberta.body);
    const s = aberta.json<SessaoDisputa>();
    assert.equal(s.fase, 'lances_abertos');
    assert.equal(Date.parse(s.fimPrevisto ?? '') - Date.parse(s.agora), 600_000);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/abertura`)).statusCode, 422);

    const minuto = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/relogio`, { avancar: 'minuto' });
    assert.equal(minuto.statusCode, 200, minuto.body);
    const depois = minuto.json<SessaoDisputa>();
    assert.equal(depois.adiantamentoSegundos, 60);
    assert.ok(depois.lances.length >= 5, `lances: ${depois.lances.length}`);
    assert.ok(depois.lances.every((l) => l.origem === 'simulador' && /^Licitante \d$/.test(l.rotulo)));
    assert.ok(depois.melhorOferta !== null && depois.lider !== null);
    assert.doesNotMatch(JSON.stringify(depois), /Ária|Atlas|Vigilant|Sentinela/);
  });

  test('lance de treino: recusa o que não melhora o próprio lance (art. 21, § 2º) e aceita o válido', async () => {
    const s = await sessao();
    const alvo = s.participantes.find((p) => !p.lider && p.ofertaAtual !== null);
    assert.ok(alvo);
    const pior = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/lances`, { participante: alvo.chave, valor: (alvo.ofertaAtual ?? 0) + 100 });
    assert.equal(pior.statusCode, 422);
    assert.equal(erro(pior).detalhes?.[0]?.campo, 'LANCE_RECUSADO');
    assert.match(erro(pior).detalhes?.[0]?.mensagem ?? '', /art\. 21, § 2º/);
    const valido = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/lances`, { participante: alvo.chave, valor: (alvo.ofertaAtual ?? 0) - 1_000 });
    assert.equal(valido.statusCode, 200, valido.body);
    assert.ok(valido.json<SessaoDisputa>().lances.some((l) => l.origem === 'registrado' && l.participante === alvo.chave));
    assert.equal((await chamar(app, agente, 'GET', `/api/v1/sessoes-disputa/${sessaoId}/ata`)).statusCode, 422, 'sem ata durante os lances (sigilo)');
  });

  test('encerramento da etapa: prorrogação, identidades reveladas, sinais RIA-09 reforçados pelo RIA-06 e julgamento', async () => {
    let s = await sessao();
    for (let i = 0; i < 5 && s.fase !== 'encerrada'; i++) {
      const r = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/relogio`, { avancar: 'fim_da_etapa' });
      assert.equal(r.statusCode, 200, r.body);
      s = r.json<SessaoDisputa>();
    }
    assert.equal(s.fase, 'encerrada');
    assert.ok(s.prorrogacoes >= 1);
    assert.equal(s.identidadesOcultas, false);
    assert.ok(s.participantes.every((p) => p.nome !== null && p.perfilSimulado !== null));
    const chaveDe = (id: string) => s.participantes.find((p) => p.fornecedorId === id)?.chave;
    const par = [chaveDe(ids.aria), chaveDe(ids.atlas)].sort();
    assert.deepEqual(s.participantes.filter((p) => p.perfilSimulado === 'combinado').map((p) => p.chave).sort(), par);
    const alternancia = s.sinais.find((x) => x.tipo === 'alternancia_combinada');
    assert.ok(alternancia, JSON.stringify(s.sinais.map((x) => x.titulo)));
    assert.deepEqual([...alternancia.participantes].sort(), par);
    assert.equal(alternancia.reforcadoPorVinculo, true);
    assert.match(alternancia.aviso, /requer revisão humana/);
    const socio = s.sinais.find((x) => x.regra === 'RIA-06');
    const textoSocio = socio?.evidencias[0] ?? '';
    assert.match(textoSocio, /Ária Telecomunicações Ltda\./);
    assert.match(textoSocio, /Atlas Informática Robusta Ltda\./);
    assert.match(textoSocio, /têm sócio em comum \(\p{L}+( \p{L}\.)+\)/u, 'nome do sócio mascarado (LGPD)');
    assert.ok(s.sinais.some((x) => x.tipo === 'intervalos_regulares'));
    assert.ok(s.julgamento);
    assert.equal(s.julgamento.classificacao.length, 4);
    assert.equal(s.acoes.encerrar, true);
    assert.equal(s.acoes.negociar, true);
    const ata = await obterJson<AtaSessao>(app, agente, `/api/v1/sessoes-disputa/${sessaoId}/ata`);
    assert.equal(ata.definitiva, false);
    assert.match(ata.texto, /requer revisão humana/);
  });

  test('negociação com o primeiro colocado (art. 61): recusa oferta pior e registra a melhor', async () => {
    const s = await sessao();
    const primeiro = s.julgamento?.classificacao[0];
    assert.ok(primeiro);
    const pior = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/negociacao`, { valor: primeiro.valorOfertado + 1, justificativa: 'Contraproposta registrada na sessão.' });
    assert.equal(pior.statusCode, 422);
    const melhor = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/negociacao`, {
      valor: primeiro.valorOfertado - 10_000,
      justificativa: 'Primeiro colocado aceitou reduzir o valor global.',
    });
    assert.equal(melhor.statusCode, 200, melhor.body);
    const negociado = melhor.json<SessaoDisputa>().julgamento?.classificacao[0];
    assert.equal(negociado?.origem, 'negociacao');
    assert.equal(negociado?.valorOfertado, primeiro.valorOfertado - 10_000);
  });

  test('encerramento: ata definitiva, resultado no registro da disputa do processo e trilha de auditoria', async () => {
    const r = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/encerramento`, {});
    assert.equal(r.statusCode, 200, r.body);
    const s = r.json<SessaoDisputa>();
    assert.equal(s.fase, 'concluida');
    assert.ok(Object.values(s.acoes).every((v) => v === false));
    const processo = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${processoId}`);
    assert.equal(processo.disputa.licitantes.length, 4);
    const resultado = processo.disputa.resultado as { classificacao: { id: string; valorConsiderado: number }[] };
    const primeiro = s.julgamento?.classificacao[0];
    assert.equal(resultado.classificacao[0]?.id, s.participantes.find((p) => p.chave === primeiro?.participante)?.fornecedorId);
    assert.equal(resultado.classificacao[0]?.valorConsiderado, primeiro?.valorConsiderado);
    assert.ok(processo.sinais.some((x) => x.regra === 'RIA-06'), 'o registro da disputa mantém o sinal de sócio em comum');
    const ata = await obterJson<AtaSessao>(app, agente, `/api/v1/sessoes-disputa/${sessaoId}/ata`);
    assert.equal(ata.definitiva, true);
    assert.match(ata.texto, /## 6\. Negociação/);
    assert.match(ata.texto, /Ária Telecomunicações/);
    assert.match(ata.texto, /Alternância de lances/);
    const eventos = await app.agora.banco.consultar<{ acao: string }>(
      `SELECT acao FROM auditoria_eventos WHERE (recurso = 'sessao_disputa' AND recurso_id = $1) OR (recurso = 'processo' AND recurso_id = $2) ORDER BY sequencia`,
      [sessaoId, processoId],
    );
    const acoes = eventos.map((e) => e.acao);
    for (const acao of ['disputa.sessao.criar', 'disputa.sessao.abrir', 'disputa.sessao.relogio', 'disputa.lance.registrar', 'disputa.sessao.negociar', 'disputa.sessao.encerrar', 'processo.disputa.registrar']) {
      assert.ok(acoes.includes(acao), acao);
    }
    const repetido = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/encerramento`, {});
    assert.equal(repetido.statusCode, 422);
  });

  test('escopo de UASG: agente de outra UASG não vê a sessão (404)', async () => {
    const admin = await entrar(app, 'admin@agora.demo');
    const criado = await chamar(app, admin, 'POST', '/api/v1/usuarios', {
      nome: 'Vera Escopo Distinto',
      email: 'outra.uasg@agora.demo',
      cpf: gerarCpf(new Prng(1505)),
      perfis: ['agente_contratacao'],
      uasgs: ['920001'],
      unidadeInternaId: null,
    });
    assert.equal(criado.statusCode, 201, criado.body);
    const temporaria = (await chamar(app, admin, 'POST', `/api/v1/usuarios/${criado.json<UsuarioAdmin>().id}/senha-temporaria`)).json<RespostaSenhaTemporaria>();
    const primeiro = await entrar(app, 'outra.uasg@agora.demo', temporaria.senhaTemporaria);
    await chamar(app, primeiro, 'POST', '/api/v1/sessao/senha', { senhaAtual: temporaria.senhaTemporaria, novaSenha: 'Outra-Uasg-Sala-2026' });
    const outro = await entrar(app, 'outra.uasg@agora.demo', 'Outra-Uasg-Sala-2026');
    assert.equal((await chamar(app, outro, 'GET', `/api/v1/sessoes-disputa/${sessaoId}`)).statusCode, 404);
    assert.equal((await chamar(app, outro, 'POST', `/api/v1/sessoes-disputa/${sessaoId}/relogio`, { avancar: 'minuto' })).statusCode, 404);
  });
});

describe('sala de disputa — acompanhamento da sessão oficial (Compras.gov.br)', () => {
  test('offline: resposta simulada com proveniência, transcrição dos lances, sinais e registro no processo', async () => {
    const app = await criarAppTeste({ env: SEM_LIMITE, relogio: relogioManual().relogio });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const processoId = await prepararProcessoNaEtapa6(app, agente);
      const [aria, atlas] = await app.agora.banco.consultar<{ id: string; documento: string }>(
        `SELECT id, documento FROM fornecedores WHERE razao_social LIKE 'Ária%' OR razao_social LIKE 'Atlas%' ORDER BY razao_social`,
      );
      assert.ok(aria && atlas);
      const sem = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, { uso: 'acompanhamento', criterio: 'menor_preco', modo: 'aberto', participantes: [] });
      assert.equal(sem.statusCode, 400, 'o acompanhamento exige o identificador da compra');
      const criada = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, {
        uso: 'acompanhamento',
        criterio: 'menor_preco',
        modo: 'aberto',
        idCompra: '91000105900012026',
        participantes: [],
      });
      assert.equal(criada.statusCode, 201, criada.body);
      const id = criada.json<SessaoDisputa>().id;
      assert.equal(criada.json<SessaoDisputa>().identidadesOcultas, false);

      const base = Date.parse('2026-11-05T13:00:00.000Z');
      const lances = Array.from({ length: 8 }, (_, i) => ({
        documento: i % 2 === 0 ? aria.documento : atlas.documento,
        valor: 50_000_000 - i * 100_000,
        instante: new Date(base + i * 7_000).toISOString(),
      }));
      const transcrita = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/lances/transcricao`, { lances });
      assert.equal(transcrita.statusCode, 200, transcrita.body);
      const s = transcrita.json<SessaoDisputa>();
      assert.equal(s.lances.length, 8);
      assert.ok(s.lances.every((l) => l.origem === 'transcrito'));
      const alternancia = s.sinais.find((x) => x.tipo === 'alternancia_combinada');
      assert.equal(alternancia?.reforcadoPorVinculo, true);
      const invalida = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/lances/transcricao`, {
        lances: [{ documento: '00000000000191', valor: 1_000, instante: new Date(base).toISOString() }],
      });
      assert.equal(invalida.statusCode, 422);

      const sinc = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/sincronizacao`);
      assert.equal(sinc.statusCode, 200, sinc.body);
      const oficial = sinc.json<SessaoDisputa>().oficial;
      assert.equal(oficial?.modo, 'offline');
      assert.match(oficial?.hash ?? '', /^[0-9a-f]{64}$/);
      assert.equal(oficial?.registros, 2);
      assert.equal(oficial?.resultados[0]?.valorTotalHomologado, 49_300_000);
      assert.equal(sinc.json<SessaoDisputa>().julgamento?.classificacao[0]?.origem, 'resultado_oficial');

      const fim = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/encerramento`, {});
      assert.equal(fim.statusCode, 200, fim.body);
      const processo = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${processoId}`);
      assert.equal(processo.disputa.licitantes.length, 2);
      const [sincronizacao] = await app.agora.banco.consultar<{ dados: { hash: string; fonte: string } }>(
        `SELECT dados FROM auditoria_eventos WHERE acao = 'disputa.sessao.sincronizar' AND recurso_id = $1`,
        [id],
      );
      assert.equal(sincronizacao?.dados.fonte, 'COMPRAS_GOV');
      assert.equal(sincronizacao?.dados.hash, oficial?.hash);
    } finally {
      await app.close();
    }
  });

  test('online: consulta os dados abertos pelo servidor (fetch simulado), converte reais em centavos e trata recusa', async () => {
    const chamadas: string[] = [];
    let recusar = false;
    const fetchFalso: FuncaoFetch = async (entrada) => {
      const url = String(entrada);
      chamadas.push(url);
      if (recusar) return new Response('{}', { status: 400 });
      if (url.includes('1.1_consultarContratacoes_PNCP_14133_Id')) {
        return Response.json({
          resultado: [
            {
              idCompra: '91000105900012026',
              numeroCompra: '00001',
              modalidadeNome: 'Pregão - Eletrônico',
              modoDisputaNomePncp: 'Aberto',
              situacaoCompraNomePncp: 'Divulgada no PNCP',
              objetoCompra: 'Objeto sintético',
              valorTotalEstimado: 500_000,
              valorTotalHomologado: 480_000.5,
              dataAberturaPropostaPncp: '2026-11-03T09:00:00',
              existeResultado: true,
            },
          ],
          totalRegistros: 1,
        });
      }
      return Response.json({
        resultado: [
          { niFornecedor: '11222333000181', nomeRazaoSocialFornecedor: 'Fornecedora Sintética Oficial Ltda.', valorTotalHomologado: 300_000.25, situacaoCompraItemResultadoNome: 'Informado' },
          { niFornecedor: '11222333000181', nomeRazaoSocialFornecedor: 'Fornecedora Sintética Oficial Ltda.', valorTotalHomologado: 180_000.25, situacaoCompraItemResultadoNome: 'Informado' },
          { niFornecedor: '44555666000172', nomeRazaoSocialFornecedor: 'Item Cancelado Ltda.', valorTotalHomologado: 10, situacaoCompraItemResultadoNome: 'Cancelado' },
        ],
      });
    };
    const app = await criarAppTeste({
      env: { ...SEM_LIMITE, AGORA_INTEGRACOES: 'online', AGORA_COMPRAS_GOV_URL: 'https://dados.exemplo.gov.br/' },
      fetch: fetchFalso,
      relogio: relogioManual().relogio,
    });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const processoId = await prepararProcessoNaEtapa6(app, agente);
      const criada = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/sessoes-disputa`, {
        uso: 'acompanhamento',
        criterio: 'menor_preco',
        modo: 'aberto',
        idCompra: '91000105900012026',
        participantes: [],
      });
      const id = criada.json<SessaoDisputa>().id;
      const sinc = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/sincronizacao`);
      assert.equal(sinc.statusCode, 200, sinc.body);
      const s = sinc.json<SessaoDisputa>();
      assert.equal(s.oficial?.modo, 'online');
      assert.equal(s.oficial?.compra.valorTotalHomologado, 48_000_050);
      assert.equal(s.oficial?.compra.aberturaPropostas, '2026-11-03T12:00:00.000Z');
      assert.deepEqual(s.oficial?.resultados.map((r) => [r.documento, r.valorTotalHomologado, r.itens]), [['11222333000181', 48_000_050, 2]]);
      assert.equal(s.participantes.length, 1, 'o fornecedor do resultado entra na sessão e no cadastro');
      assert.ok(chamadas.every((u) => u.startsWith('https://dados.exemplo.gov.br/modulo-contratacoes/') && u.includes('tipo=idCompra&codigo=91000105900012026')));
      recusar = true;
      const falha = await chamar(app, agente, 'POST', `/api/v1/sessoes-disputa/${id}/sincronizacao`);
      assert.equal(falha.statusCode, 503);
      assert.match(erro(falha).mensagem, /HTTP 400/);
    } finally {
      await app.close();
    }
  });
});
