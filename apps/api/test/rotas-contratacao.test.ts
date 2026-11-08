import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adicionarDias, hojeISO, prazoDivulgacaoContratoPncp } from '@agora/dominio';
import type {
  AdesaoProcesso,
  CompraSicx,
  ContratoDetalhe,
  ExtratoCartaoPagamento,
  Pagina,
  ProcessoDetalhe,
  RespostaCompraCartao,
  RespostaErro,
  RotaProcesso,
  VitrineSicx,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { opcoesCalendario } from '../src/compartilhado/instrumentos.ts';
import { chamar, criarAppTeste, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const DIA_MS = 24 * 60 * 60 * 1000;
const JUSTIFICATIVA = 'Contratação de pequeno valor para reposição do estoque operacional da unidade requisitante.';

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

function regras(resposta: { json<T>(): T }): string[] {
  return (erro(resposta).detalhes ?? []).map((d) => d.campo ?? '');
}

interface Atores {
  planejamento: Credenciais;
  agente: Credenciais;
  juridico: Credenciais;
  gestor: Credenciais;
}

/** Leva um processo novo de uma rota até a etapa pedida, pelas mesmas chamadas da interface. */
async function processoNaRota(
  app: FastifyInstance,
  atores: Atores,
  opcoes: { titulo: string; orgao: string; rota: Record<string, unknown>; quantidade: number; valorUnitario: number; etapa: 1 | 2 | 3 | 4 | 5 },
): Promise<{ id: string; base: string; detalhe: ProcessoDetalhe }> {
  const { planejamento, agente, juridico, gestor } = atores;
  const ok = async (c: Credenciais, metodo: 'POST' | 'PUT', url: string, corpo?: unknown) => {
    const r = await chamar(app, c, metodo, url, corpo);
    assert.ok(r.statusCode === 200 || r.statusCode === 201, `${metodo} ${url} → ${r.statusCode} ${r.body}`);
    return r.json<ProcessoDetalhe>();
  };
  let p = await ok(planejamento, 'POST', '/api/v1/processos', { titulo: opcoes.titulo, orgao: opcoes.orgao });
  const base = `/api/v1/processos/${p.id}`;
  await ok(planejamento, 'PUT', `${base}/dfd`, {
    descricaoNecessidade: 'Repor o material de uso contínuo das equipes operacionais da unidade requisitante.',
    justificativa: 'O estoque atual não atende à demanda prevista para os próximos meses de operação da unidade.',
    itens: [{ catmat: '150000', descricao: 'Material de consumo padronizado para as equipes', unidade: 'unidade', quantidade: opcoes.quantidade, valorUnitarioEstimado: opcoes.valorUnitario }],
    usaCatalogoPadronizado: true,
    justificativaNaoPadronizacao: null,
    justificativaArtigoLuxo: null,
    previstoNoPca: true,
    tipoObjeto: 'bens',
  });
  const r = await chamar(app, planejamento, 'PUT', `${base}/rota`, opcoes.rota);
  assert.equal(r.statusCode, 200, r.body);
  if (opcoes.etapa === 1) return { id: p.id, base, detalhe: await obterJson<ProcessoDetalhe>(app, planejamento, base) };
  p = await ok(planejamento, 'POST', `${base}/avancar`);
  await ok(agente, 'PUT', `${base}/equipe`, {
    designacoes: [
      { papel: 'equipe_planejamento', usuarioId: planejamento.sessao.usuario.id },
      { papel: 'agente_contratacao', usuarioId: agente.sessao.usuario.id },
      { papel: 'autoridade_competente', usuarioId: gestor.sessao.usuario.id },
      { papel: 'parecerista_juridico', usuarioId: juridico.sessao.usuario.id },
    ],
  });
  const aprovarEAssinar = async (c: Credenciais, tipo: string) => {
    const gerado = await ok(c, 'POST', `${base}/documentos/gerar`, { tipo });
    const doc = gerado.documentos.find((d) => d.tipo === tipo);
    assert.ok(doc);
    const aprovado = await ok(c, 'POST', `${base}/documentos/${doc.id}/aprovar`);
    return ok(c, 'POST', `${base}/sei/assinar`, { documentoNumero: aprovado.documentos.find((d) => d.id === doc.id)?.numeroSei });
  };
  await aprovarEAssinar(planejamento, 'dfd');
  p = await ok(agente, 'POST', `${base}/avancar`);
  if (opcoes.etapa === 2) return { id: p.id, base, detalhe: p };
  const hoje = hojeISO(app.agora.relogio());
  await ok(planejamento, 'PUT', `${base}/cesta-precos`, {
    orcamentoSigiloso: false,
    motivoSigilo: null,
    cotacoes: [
      { fonte: 'painel_precos', descricaoFonte: 'Painel de Preços', valorUnitario: opcoes.valorUnitario, dataCotacao: adicionarDias(hoje, -10) },
      { fonte: 'contratacao_similar', descricaoFonte: 'Contratação similar de outro órgão', valorUnitario: Math.round(opcoes.valorUnitario * 1.02), dataCotacao: adicionarDias(hoje, -40) },
      { fonte: 'nota_fiscal', descricaoFonte: 'Nota fiscal de venda a órgão público', valorUnitario: Math.round(opcoes.valorUnitario * 0.98), dataCotacao: adicionarDias(hoje, -20) },
    ],
  });
  await ok(planejamento, 'PUT', `${base}/sustentabilidade`, {
    criteriosAmbientais: 'Embalagens recicláveis e produtos com certificação ambiental reconhecida, quando houver no mercado.',
    logisticaReversa: 'O fornecedor recolhe embalagens e resíduos para destinação ambientalmente adequada, sem custo adicional.',
  });
  if (opcoes.rota.rota === 'inexigibilidade' || opcoes.rota.rota === 'adesao_ata') {
    await ok(planejamento, 'PUT', `${base}/etp`, {
      I: { texto: 'Repor o material de uso contínuo das equipes operacionais da unidade.' },
      IV: { texto: 'Quantidade dimensionada pelo consumo médio dos últimos doze meses.' },
      VI: { texto: 'Valor estimado pela pesquisa de preços registrada no processo.' },
      VIII: { texto: 'Item único, sem parcelamento, pela padronização do material.' },
      XIII: { texto: 'A contratação é viável e adequada pela rota escolhida.' },
      ...Object.fromEntries(['II', 'III', 'V', 'VII', 'IX', 'X', 'XI', 'XII'].map((i) => [i, { justificativaAusencia: 'Elemento dispensado pela baixa complexidade da aquisição de bem comum.' }])),
    });
    await ok(planejamento, 'PUT', `${base}/riscos`, {
      riscos: [{ descricao: 'Atraso na entrega do material', probabilidade: 2, impacto: 3, alocacao: 'contratada', mitigacao: 'Prazo de entrega com multa moratória' }],
    });
  }
  p = await ok(planejamento, 'POST', `${base}/avancar`);
  assert.equal(p.etapaAtual, 4);
  if (opcoes.etapa === 3 || opcoes.etapa === 4) return { id: p.id, base, detalhe: p };
  // RN-39 (frente P): dotação e declaração de adequação orçamentária aprovada pela autoridade (art. 72, IV).
  await ok(agente, 'PUT', `${base}/dotacao`, {
    linhas: [
      {
        unidadeGestora: '910001',
        programaTrabalho: '06.181.9990.AG99.0001',
        naturezaDespesa: '3.3.90.30',
        fonteRecursos: '1001000000',
        exercicio: Number(hoje.slice(0, 4)),
        valor: Math.round(opcoes.quantidade * opcoes.valorUnitario * 1.2),
        preEmpenho: null,
      },
    ],
  });
  const comDeclaracao = await ok(agente, 'POST', `${base}/documentos/gerar`, { tipo: 'declaracao_orcamentaria' });
  const declaracao = comDeclaracao.documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
  assert.ok(declaracao);
  const declarada = await ok(gestor, 'POST', `${base}/documentos/${declaracao.id}/aprovar`);
  await ok(gestor, 'POST', `${base}/sei/assinar`, { documentoNumero: declarada.documentos.find((d) => d.id === declaracao.id)?.numeroSei });
  await aprovarEAssinar(agente, 'tr');
  if (opcoes.rota.rota !== 'dispensa' || opcoes.rota.hipoteseDispensa === 'outra') await aprovarEAssinar(agente, 'minuta_contrato');
  p = await ok(agente, 'POST', `${base}/avancar`);
  assert.equal(p.etapaAtual, 5);
  await ok(juridico, 'PUT', `${base}/parecer`, { itens: p.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })), conclusao: 'favoravel' });
  return { id: p.id, base, detalhe: await obterJson<ProcessoDetalhe>(app, agente, base) };
}

describe('rotas de contratação: escolha da rota, limites e fracionamento (RF-34, RN-41)', () => {
  let app: FastifyInstance;
  let atores: Atores;
  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    atores = {
      planejamento: await entrar(app, 'planejamento@agora.demo'),
      agente: await entrar(app, 'agente@agora.demo'),
      juridico: await entrar(app, 'juridico@agora.demo'),
      gestor: await entrar(app, 'gestor@agora.demo'),
    };
  });
  after(async () => {
    await app.close();
  });

  test('sem rota registrada o processo segue a licitação; GET /rota devolve a licitação e os documentos', async () => {
    const [qualquer] = (await obterJson<Pagina<{ id: string }>>(app, atores.agente, '/api/v1/processos?tamanhoPagina=1')).itens;
    assert.ok(qualquer);
    const rota = await obterJson<RotaProcesso>(app, atores.agente, `/api/v1/processos/${qualquer.id}/rota`);
    assert.equal(rota.rota, 'licitacao');
    assert.equal(rota.exigencias.edital, 'obrigatorio');
    assert.equal(rota.escolhidaEm, null);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${qualquer.id}/rota`)).statusCode, 403);
  });

  test('dispensa por valor: limite de 2026, fracionamento no mesmo ramo com o cartão de pagamento e análise do agente', async () => {
    const { base } = await processoNaRota(app, atores, {
      titulo: 'Aquisição de resmas de papel e material de expediente',
      orgao: 'SENASP',
      quantidade: 200,
      valorUnitario: 8_000,
      etapa: 1,
      rota: { rota: 'dispensa', hipoteseDispensa: 'valor_demais', natureza: 'Material de expediente', justificativa: JUSTIFICATIVA },
    });
    const rota = await obterJson<RotaProcesso>(app, atores.planejamento, `${base}/rota`);
    assert.equal(rota.rota, 'dispensa');
    assert.equal(rota.modalidade, 'Dispensa eletrônica (art. 75, II)');
    assert.equal(rota.limite?.valor, 6_549_211);
    assert.equal(rota.limite?.norma, 'Decreto 12.807/2025');
    assert.ok(rota.fracionamento);
    assert.equal(rota.fracionamento.sinal, 'risco', rota.fracionamento.explicacao);
    assert.ok(rota.fracionamento.consideradas >= 5, 'compras com cartão do mesmo ramo entram na soma');
    let p = await obterJson<ProcessoDetalhe>(app, atores.planejamento, base);
    assert.equal(p.modalidadePrevista, 'Dispensa eletrônica (art. 75, II)');
    assert.ok(p.sinais.some((s) => s.regra === 'RIA-01' && s.nivel === 'risco'));
    assert.ok(p.bloqueiosDetalhe.some((b) => b.regra === 'RN-41' && /fracionamento/.test(b.mensagem)));
    assert.deepEqual(regras(await chamar(app, atores.planejamento, 'POST', `${base}/avancar`)), ['RN-41']);

    const comAnalise = await chamar(app, atores.planejamento, 'PUT', `${base}/rota`, {
      rota: 'dispensa',
      hipoteseDispensa: 'valor_demais',
      natureza: 'Material de expediente',
      justificativa: JUSTIFICATIVA,
      justificativaFracionamento: 'As compras com cartão atenderam a demandas emergenciais distintas, de outro centro de custo e sem previsibilidade.',
    });
    assert.equal(comAnalise.statusCode, 200);
    p = await obterJson<ProcessoDetalhe>(app, atores.planejamento, base);
    assert.ok(!p.bloqueiosDetalhe.some((b) => b.regra === 'RN-41'));
    assert.ok(p.sinais.some((s) => s.regra === 'RIA-01'), 'o sinal continua visível');

    // Acima do limite da dispensa por valor: bloqueio RN-41.
    await chamar(app, atores.planejamento, 'PUT', `${base}/dfd`, {
      ...p.dfd,
      itens: [{ catmat: null, descricao: 'Resma de papel A4', unidade: 'resma', quantidade: 1_000, valorUnitarioEstimado: 8_000 }],
    });
    p = await obterJson<ProcessoDetalhe>(app, atores.planejamento, base);
    assert.ok(p.bloqueiosDetalhe.some((b) => b.regra === 'RN-41' && /supera o limite/.test(b.mensagem)));
  });

  test('validação da escolha: hipótese obrigatória (400), inexigibilidade sem comprovação vira pendência, só na etapa 1 e com permissão', async () => {
    const { base, id } = await processoNaRota(app, atores, {
      titulo: 'Contratação de serviço de manutenção de equipamento exclusivo',
      orgao: 'PF',
      quantidade: 1,
      valorUnitario: 9_000_000,
      etapa: 1,
      rota: { rota: 'inexigibilidade', hipoteseInexigibilidade: 'exclusividade', justificativa: 'curta' },
    });
    assert.equal((await chamar(app, atores.planejamento, 'PUT', `${base}/rota`, { rota: 'dispensa' })).statusCode, 400);
    let rota = await obterJson<RotaProcesso>(app, atores.planejamento, `${base}/rota`);
    assert.ok(rota.pendencias.some((m) => /Justifique a escolha da rota/.test(m)));
    assert.ok(rota.inexigibilidade?.pendencias.some((m) => /exclusividade/.test(m)));
    const salvo = await chamar(app, atores.planejamento, 'PUT', `${base}/inexigibilidade`, {
      justificativaInviabilidade: 'Só o fabricante presta a manutenção do equipamento, conforme carta de exclusividade juntada ao processo.',
      documentoExclusividade: 'carta_exclusividade',
      semPreferenciaMarca: true,
    });
    assert.equal(salvo.statusCode, 200, salvo.body);
    rota = salvo.json<RotaProcesso>();
    assert.deepEqual(rota.inexigibilidade?.pendencias, []);
    const consulta = await entrar(app, 'juridico@agora.demo');
    assert.equal((await chamar(app, consulta, 'PUT', `${base}/rota`, { rota: 'licitacao' })).statusCode, 403);
    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<{ acao: string; recursoId: string | null }>>(app, auditor, '/api/v1/auditoria?recurso=processo&tamanhoPagina=100');
    const acoes = trilha.itens.filter((e) => e.recursoId === id).map((e) => e.acao);
    assert.ok(acoes.includes('processo.rota.escolher'));
    assert.ok(acoes.includes('processo.inexigibilidade.registrar'));
  });

  test('adesão a ata: acima de 50% por órgão é recusada; aceite, anuência do gerenciador e limite total', async () => {
    const hoje = hojeISO(app.agora.relogio());
    const [item] = await app.agora.banco.consultar<{ ata_id: string; item_id: string; uasg: string; quantidade_registrada: number; fornecedor_id: string }>(
      `SELECT a.id AS ata_id, i.id AS item_id, a.uasg, i.quantidade_registrada, i.fornecedor_id FROM atas a JOIN itens_ata i ON i.ata_id = a.id
        WHERE a.aceita_adesao AND a.vigencia_inicio <= $1 AND a.vigencia_fim >= $1 AND a.uasg <> '930001' AND i.quantidade_registrada >= 10
        ORDER BY a.numero, i.numero LIMIT 1`,
      [hoje],
    );
    assert.ok(item, 'carga com ata vigente que aceita adesão');
    const { base } = await processoNaRota(app, atores, {
      titulo: 'Adesão à ata de registro de preços de material permanente',
      orgao: 'SENASP',
      quantidade: 1,
      valorUnitario: 100_000,
      etapa: 1,
      rota: { rota: 'adesao_ata', justificativa: JUSTIFICATIVA },
    });
    const metade = Math.floor(item.quantidade_registrada / 2);
    const acima = await chamar(app, atores.planejamento, 'POST', `${base}/adesao`, { ataId: item.ata_id, itemId: item.item_id, quantidade: metade + 1, justificativaVantagem: JUSTIFICATIVA });
    assert.equal(acima.statusCode, 422);
    assert.ok((erro(acima).detalhes ?? []).some((d) => /art\. 86, § 4º/.test(d.mensagem)));
    const pedido = await chamar(app, atores.planejamento, 'POST', `${base}/adesao`, { ataId: item.ata_id, itemId: item.item_id, quantidade: metade, justificativaVantagem: JUSTIFICATIVA });
    assert.equal(pedido.statusCode, 200, pedido.body);
    let rota = pedido.json<RotaProcesso>();
    assert.equal(rota.adesao?.situacao, 'solicitada');
    assert.equal(rota.adesao?.limites.limitePorOrgao, metade);
    assert.equal(rota.adesao?.limites.limiteTotal, item.quantidade_registrada * 2);
    rota = (await chamar(app, atores.planejamento, 'POST', `${base}/adesao/aceite-fornecedor`, { data: hoje })).json<RotaProcesso>();
    assert.equal(rota.adesao?.situacao, 'aceita_fornecedor');
    const adesaoId = rota.adesao?.id ?? '';
    assert.equal((await chamar(app, atores.planejamento, 'POST', `/api/v1/atas/adesoes/${adesaoId}/anuencia`, { decisao: 'autorizada' })).statusCode, 403);
    const anuencia = await chamar(app, atores.gestor, 'POST', `/api/v1/atas/adesoes/${adesaoId}/anuencia`, { decisao: 'autorizada' });
    assert.equal(anuencia.statusCode, 200, anuencia.body);
    const adesao = anuencia.json<AdesaoProcesso>();
    assert.equal(adesao.situacao, 'autorizada');
    assert.ok(adesao.limiteContratacao && adesao.limiteContratacao <= adicionarDias(hoje, 90));
    const pendentes = await obterJson<AdesaoProcesso[]>(app, atores.gestor, '/api/v1/atas/adesoes');
    assert.ok(pendentes.some((a) => a.id === adesaoId));

    // Outros órgãos aderem até o dobro do registrado; depois disso, recusa (§ 5º).
    const outrosOrgaos = ['910001', '920001', '940001', '950001', '910002'].filter((u) => u !== item.uasg);
    let recusadoNoTotal = false;
    for (const uasg of outrosOrgaos) {
      const outro = await chamar(app, atores.planejamento, 'POST', '/api/v1/processos', { titulo: `Adesão de outro órgão ${uasg} à mesma ata`, orgao: 'MJSP', uasg });
      const outroBase = `/api/v1/processos/${outro.json<ProcessoDetalhe>().id}`;
      await chamar(app, atores.planejamento, 'PUT', `${outroBase}/rota`, { rota: 'adesao_ata', justificativa: JUSTIFICATIVA });
      const r = await chamar(app, atores.planejamento, 'POST', `${outroBase}/adesao`, { ataId: item.ata_id, itemId: item.item_id, quantidade: metade, justificativaVantagem: JUSTIFICATIVA });
      if (r.statusCode === 422) {
        recusadoNoTotal = (erro(r).detalhes ?? []).some((d) => /§ 5º/.test(d.mensagem));
        break;
      }
      const id = r.json<RotaProcesso>().adesao?.id ?? '';
      await chamar(app, atores.planejamento, 'POST', `${outroBase}/adesao/aceite-fornecedor`, { data: hoje });
      assert.equal((await chamar(app, atores.gestor, 'POST', `/api/v1/atas/adesoes/${id}/anuencia`, { decisao: 'autorizada' })).statusCode, 200);
    }
    assert.ok(recusadoNoTotal, 'a soma das adesões não passa do dobro do registrado');
  });
});

describe('dispensa eletrônica de ponta a ponta: aviso de 3 dias úteis, propostas adicionais, julgamento, autorização e contrato', () => {
  const tempo = relogioManual();
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE, relogio: tempo.relogio });
  });
  after(async () => {
    await app.close();
  });

  test('etapas 5 a 7 da dispensa por valor (RN-41) e contrato de contratação direta com divulgação em 10 dias úteis', async () => {
    const atores: Atores = {
      planejamento: await entrar(app, 'planejamento@agora.demo'),
      agente: await entrar(app, 'agente@agora.demo'),
      juridico: await entrar(app, 'juridico@agora.demo'),
      gestor: await entrar(app, 'gestor@agora.demo'),
    };
    const fornecedores = await app.agora.banco.consultar<{ id: string }>(
      "SELECT id FROM fornecedores WHERE razao_social LIKE 'Planalto%' OR razao_social LIKE 'Guardião%' OR razao_social LIKE 'Tupã%' ORDER BY razao_social",
    );
    const [f1, f2, f3] = fornecedores;
    assert.ok(f1 && f2 && f3);
    const { base, detalhe } = await processoNaRota(app, atores, {
      titulo: 'Aquisição de kits de primeiros socorros por dispensa eletrônica',
      orgao: 'SENASP',
      quantidade: 100,
      valorUnitario: 55_000,
      etapa: 5,
      rota: { rota: 'dispensa', hipoteseDispensa: 'valor_demais', natureza: 'Material de primeiros socorros', justificativa: JUSTIFICATIVA },
    });
    assert.equal(detalhe.etapaAtual, 5);
    assert.ok(detalhe.bloqueiosDetalhe.some((b) => b.regra === 'RN-41' && /Publique o aviso/.test(b.mensagem)));
    assert.ok(!detalhe.bloqueiosDetalhe.some((b) => b.regra === 'RN-07'), 'sem edital nesta rota');
    // Não há edital nem disputa na rota da dispensa.
    assert.deepEqual(regras(await chamar(app, atores.agente, 'POST', `${base}/publicar`)), ['RF-34']);

    const { agente, gestor } = atores;
    assert.equal((await chamar(app, agente, 'POST', `${base}/dispensa/propostas`, { fornecedorId: f1.id, valor: 5_400_000 })).statusCode, 200);
    let rota = (await chamar(app, agente, 'POST', `${base}/dispensa/aviso`)).json<RotaProcesso>();
    assert.equal(rota.aviso?.situacao, 'publicado');
    assert.equal(rota.aviso?.publicadoEm, '2026-11-09');
    assert.equal(rota.aviso?.encerramento, '2026-11-12');
    assert.equal(rota.aviso?.aberto, true);
    assert.match(rota.aviso?.protocolo ?? '', /^SIMULADO-/);
    assert.equal((await chamar(app, agente, 'POST', `${base}/dispensa/aviso`)).statusCode, 422, 'aviso não é publicado duas vezes');
    const envios = await obterJson<{ envios: { titulo: string; situacao: string }[] }>(app, agente, `${base}/publicacao-pncp`);
    assert.ok(envios.envios.some((e) => e.titulo === 'Aviso de contratação direta'));

    rota = (await chamar(app, agente, 'POST', `${base}/dispensa/propostas`, { fornecedorId: f2.id, valor: 5_250_000 })).json<RotaProcesso>();
    rota = (await chamar(app, agente, 'POST', `${base}/dispensa/propostas`, { fornecedorId: f3.id, valor: 7_000_000 })).json<RotaProcesso>();
    assert.equal(rota.propostas.filter((p) => p.adicional).length, 2);
    assert.equal(rota.propostas.filter((p) => !p.adicional).length, 1);
    assert.deepEqual(regras(await chamar(app, agente, 'POST', `${base}/avancar`)), ['RN-41'], 'aviso aberto impede o julgamento');

    // Encerrado o aviso (3 dias úteis), não entram novas propostas e o processo segue para o julgamento.
    tempo.avancar(4 * DIA_MS);
    const agente2 = await entrar(app, 'agente@agora.demo');
    const gestor2 = await entrar(app, 'gestor@agora.demo');
    void gestor;
    const tardia = await chamar(app, agente2, 'POST', `${base}/dispensa/propostas`, { fornecedorId: f1.id, valor: 4_000_000 });
    assert.equal(tardia.statusCode, 422);
    let p = (await chamar(app, agente2, 'POST', `${base}/avancar`)).json<ProcessoDetalhe>();
    assert.equal(p.etapaAtual, 6);
    assert.deepEqual(p.bloqueiosDetalhe.map((b) => b.regra).sort(), ['RF-34', 'RN-41']);

    rota = (await chamar(app, agente2, 'POST', `${base}/dispensa/julgamento`)).json<RotaProcesso>();
    const classificadas = rota.propostas.filter((x) => x.posicao !== null).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
    assert.equal(classificadas[0]?.fornecedor.id, f2.id, 'a proposta adicional mais vantajosa é selecionada');
    assert.ok(rota.propostas.some((x) => x.fornecedor.id === f3.id && x.motivoDesclassificacao !== null), 'acima do limite desclassifica');
    assert.ok(rota.julgadoEm);

    const autorizacao = { fornecedorId: f2.id, razaoEscolha: 'Proposta mais vantajosa entre as recebidas no aviso de dispensa eletrônica.', justificativaPreco: 'Preço abaixo do valor estimado pela pesquisa de preços do processo.', habilitacaoVerificada: true };
    assert.equal((await chamar(app, agente2, 'POST', `${base}/contratacao-direta/autorizacao`, autorizacao)).statusCode, 403, 'só a autoridade competente');
    assert.equal((await chamar(app, gestor2, 'POST', `${base}/contratacao-direta/autorizacao`, { ...autorizacao, habilitacaoVerificada: false })).statusCode, 422);
    const autorizado = await chamar(app, gestor2, 'POST', `${base}/contratacao-direta/autorizacao`, autorizacao);
    assert.equal(autorizado.statusCode, 200, autorizado.body);
    assert.equal(autorizado.json<RotaProcesso>().autorizacao?.valor, 5_250_000);

    p = (await chamar(app, agente2, 'POST', `${base}/avancar`)).json<ProcessoDetalhe>();
    assert.equal(p.etapaAtual, 7);
    const contratado = await chamar(app, agente2, 'POST', `${base}/contratar`);
    assert.equal(contratado.statusCode, 200, contratado.body);
    p = contratado.json<ProcessoDetalhe>();
    assert.ok(p.contratoGerado);
    const contrato = await obterJson<ContratoDetalhe>(app, agente2, `/api/v1/contratos/${p.contratoGerado.id}`);
    assert.equal(contrato.fornecedor.id, f2.id);
    assert.equal(contrato.valorGlobal, 5_250_000);
    const [linha] = await app.agora.banco.consultar<{ origem: string; modalidade: string; prazo: string }>(
      `SELECT c.origem, c.modalidade, pe.prazo FROM contratos c JOIN pendencias pe ON pe.instrumento_id = c.id AND pe.tipo = 'divulgacao_pncp' WHERE c.id = $1`,
      [p.contratoGerado.id],
    );
    assert.equal(linha?.origem, 'contratacao_direta');
    assert.equal(linha?.modalidade, 'Dispensa eletrônica (art. 75, II)');
    const esperado = prazoDivulgacaoContratoPncp(hojeISO(tempo.relogio()), 'contratacao_direta', await opcoesCalendario(app.agora.banco)).limite;
    assert.equal(linha?.prazo, esperado, '10 dias úteis da contratação direta (art. 94, II)');
    assert.equal(esperado, '2026-11-30', 'contados de 13/11, pulando o feriado de 20/11');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<{ acao: string; recursoId: string | null }>>(app, auditor, '/api/v1/auditoria?recurso=processo&tamanhoPagina=100');
    const acoes = trilha.itens.filter((e) => e.recursoId === p.id).map((e) => e.acao);
    for (const acao of ['processo.dispensa.aviso.publicar', 'pncp.aviso_dispensa', 'processo.dispensa.proposta.registrar', 'processo.dispensa.julgar', 'processo.contratacao_direta.autorizar', 'processo.contratar']) {
      assert.ok(acoes.includes(acao), acao);
    }
  });
});

describe('Sicx e cartão de pagamento (RN-42 e art. 75, § 4º)', () => {
  let app: FastifyInstance;
  let agente: Credenciais;
  let planejamento: Credenciais;
  let financeiro: Credenciais;
  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    agente = await entrar(app, 'agente@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    financeiro = await entrar(app, 'financeiro@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('vitrine ranqueia só ofertas aptas para a UF da UASG, com motivo da inaptidão', async () => {
    const vitrine = await obterJson<VitrineSicx>(app, agente, '/api/v1/sicx/ofertas?uasg=910001&quantidade=100&busca=papel');
    assert.equal(vitrine.uf, 'DF');
    assert.equal(vitrine.modo, 'offline');
    const [item] = vitrine.itens;
    assert.ok(item);
    assert.equal(item.codigo, 'SICX-100001');
    const aptas = item.ofertas.filter((o) => o.posicao !== null);
    const inaptas = item.ofertas.filter((o) => o.posicao === null);
    assert.equal(aptas.length, 3);
    assert.equal(inaptas.length, 2);
    assert.ok(inaptas.some((o) => /Cadin/.test(o.motivoInaptidao ?? '')));
    assert.ok(inaptas.some((o) => /localidade DF/.test(o.motivoInaptidao ?? '')));
    for (let i = 1; i < aptas.length; i += 1) assert.ok((aptas[i - 1]?.valorTotal ?? 0) <= (aptas[i]?.valorTotal ?? 0));
    assert.equal((await chamar(app, await entrar(app, 'consulta@agora.demo'), 'GET', '/api/v1/sicx/ofertas?uasg=910001')).statusCode, 403);
  });

  test('compra pela reserva do ETP abrangente: justificativa fora da 1ª posição, segregação, recebimento e pagamento em 30 dias', async () => {
    const vitrine = await obterJson<VitrineSicx>(app, agente, '/api/v1/sicx/ofertas?uasg=920001&quantidade=10&busca=alcool');
    const ofertas = vitrine.itens[0]?.ofertas.filter((o) => o.posicao !== null) ?? [];
    const [primeira, segunda] = ofertas;
    assert.ok(primeira && segunda);
    const [reserva] = await obterJson<{ id: string; autorizacaoPrevia: boolean; saldo: number }[]>(app, agente, '/api/v1/sicx/reservas?uasg=920001');
    assert.ok(reserva && !reserva.autorizacaoPrevia);
    const semJustificativa = await chamar(app, agente, 'POST', '/api/v1/sicx/compras', { ofertaId: segunda.id, quantidade: 10, uasg: '920001', reservaId: reserva.id });
    assert.equal(semJustificativa.statusCode, 422);
    assert.deepEqual(regras(semJustificativa), ['justificativaSelecao']);
    const ordem = await chamar(app, agente, 'POST', '/api/v1/sicx/compras', { ofertaId: primeira.id, quantidade: 10, uasg: '920001', reservaId: reserva.id });
    assert.equal(ordem.statusCode, 201, ordem.body);
    const compra = ordem.json<CompraSicx>();
    assert.equal(compra.situacao, 'ordem_emitida');
    assert.equal(compra.posicao, 1);
    assert.equal(compra.valorTotal, primeira.valorTotal);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/sicx/compras/${compra.id}/conclusao`)).statusCode, 403, 'segregação: quem emitiu a ordem não conclui');
    const concluida = await chamar(app, planejamento, 'POST', `/api/v1/sicx/compras/${compra.id}/conclusao`);
    assert.equal(concluida.statusCode, 200, concluida.body);
    assert.equal(concluida.json<CompraSicx>().prazos?.situacao, 'aguardando_entrega');
    const hoje = hojeISO(app.agora.relogio());
    assert.equal((await chamar(app, financeiro, 'POST', `/api/v1/sicx/compras/${compra.id}/pagamento`, { data: hoje })).statusCode, 422, 'sem recebimento definitivo');
    await chamar(app, agente, 'POST', `/api/v1/sicx/compras/${compra.id}/entrega`, { data: hoje });
    await chamar(app, agente, 'POST', `/api/v1/sicx/compras/${compra.id}/recebimento`, { tipo: 'provisorio', data: hoje });
    const definitivo = (await chamar(app, agente, 'POST', `/api/v1/sicx/compras/${compra.id}/recebimento`, { tipo: 'definitivo', data: hoje })).json<CompraSicx>();
    assert.equal(definitivo.prazos?.situacao, 'aguardando_pagamento');
    assert.equal(definitivo.prazos?.limitePagamento, adicionarDias(hoje, 30));
    const paga = await chamar(app, financeiro, 'POST', `/api/v1/sicx/compras/${compra.id}/pagamento`, { data: hoje });
    assert.equal(paga.statusCode, 200, paga.body);
    assert.equal(paga.json<CompraSicx>().prazos?.situacao, 'paga');

    // Reserva com autorização prévia (910001): o mesmo agente emite e conclui; acima do saldo, recusa.
    const doDf = await obterJson<VitrineSicx>(app, agente, '/api/v1/sicx/ofertas?uasg=910001&quantidade=5&busca=toner');
    const toner = doDf.itens[0]?.ofertas.find((o) => o.posicao === 1);
    const [reservaDf] = await obterJson<{ id: string; autorizacaoPrevia: boolean }[]>(app, agente, '/api/v1/sicx/reservas?uasg=910001');
    assert.ok(toner && reservaDf?.autorizacaoPrevia);
    const ordemDf = (await chamar(app, agente, 'POST', '/api/v1/sicx/compras', { ofertaId: toner.id, quantidade: 5, uasg: '910001', reservaId: reservaDf.id })).json<CompraSicx>();
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/sicx/compras/${ordemDf.id}/conclusao`)).statusCode, 200);
    const acima = await chamar(app, agente, 'POST', '/api/v1/sicx/compras', { ofertaId: toner.id, quantidade: 100_000, uasg: '910001', reservaId: reservaDf.id });
    assert.equal(acima.statusCode, 422);
    assert.match(erro(acima).mensagem, /saldo/);
  });

  test('cartão de pagamento: limite da dispensa por valor, sinal de fracionamento e extrato mensal no PNCP', async () => {
    const [fornecedor] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM fornecedores WHERE tipo_pessoa = 'PJ' ORDER BY razao_social LIMIT 1");
    assert.ok(fornecedor);
    const hoje = hojeISO(app.agora.relogio());
    const compra = { uasg: '930001', data: hoje, fornecedorId: fornecedor.id, valor: 1_500_000, objeto: 'Material de expediente para a coordenação', natureza: 'material de expediente', tipoObjeto: 'demais' };
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'POST', '/api/v1/cartao-pagamento/compras', compra)).statusCode, 403);
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/cartao-pagamento/compras', { ...compra, valor: 7_000_000 })).statusCode, 422);
    const r = await chamar(app, financeiro, 'POST', '/api/v1/cartao-pagamento/compras', compra);
    assert.equal(r.statusCode, 201, r.body);
    const resposta = r.json<RespostaCompraCartao>();
    assert.equal(resposta.fracionamento.sinal, 'risco');
    assert.ok(resposta.compra.fornecedor.documento.length > 0);

    const competencia = hoje.slice(0, 7);
    const extrato = await chamar(app, financeiro, 'POST', '/api/v1/cartao-pagamento/extratos', { uasg: '930001', competencia });
    assert.equal(extrato.statusCode, 200, extrato.body);
    const e = extrato.json<ExtratoCartaoPagamento>();
    assert.equal(e.situacao, 'publicado');
    assert.match(e.protocolo ?? '', /^SIMULADO-/);
    assert.match(e.texto, /art\. 75, § 4º/);
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/cartao-pagamento/extratos', { uasg: '930001', competencia })).statusCode, 409);
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/cartao-pagamento/compras', compra)).statusCode, 409, 'competência com extrato divulgado');
    const lista = await obterJson<ExtratoCartaoPagamento[]>(app, financeiro, '/api/v1/cartao-pagamento/extratos');
    assert.ok(lista.some((x) => x.id === e.id));
  });

  test('processo na rota Sicx: sem TR, edital nem disputa; a jornada não gera contrato', async () => {
    const criado = await chamar(app, planejamento, 'POST', '/api/v1/processos', { titulo: 'Compra de café e copa pelo Sicx para a sede', orgao: 'PRF' });
    const id = criado.json<ProcessoDetalhe>().id;
    const rota = await chamar(app, planejamento, 'PUT', `/api/v1/processos/${id}/rota`, { rota: 'sicx', justificativa: JUSTIFICATIVA });
    assert.equal(rota.statusCode, 200);
    const r = rota.json<RotaProcesso>();
    assert.equal(r.exigencias.termoReferencia, 'nao_se_aplica');
    assert.equal(r.exigencias.contratoNaJornada, false);
    const compraFora = await chamar(app, agente, 'POST', '/api/v1/sicx/compras', { ofertaId: (await obterJson<VitrineSicx>(app, agente, '/api/v1/sicx/ofertas?uasg=920001&busca=cafe')).itens[0]?.ofertas[0]?.id, quantidade: 1, uasg: '920001', processoId: id });
    assert.equal(compraFora.statusCode, 422, 'compra só na etapa 6 do processo');
  });
});
