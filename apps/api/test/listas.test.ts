import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AtaAMontar,
  AtaDetalhe,
  AtaResumo,
  ConfiguracaoPublica,
  ContratoDetalhe,
  ContratoResumo,
  EmpenhoSemContrato,
  EmpenhoSemItem,
  Feriado,
  GrupoUasg,
  InfoReajuste,
  ItemAta,
  ItemCarteira,
  ItemContrato,
  ModeloGestao,
  Pagamento,
  Pagina,
  PaginaEmpenhos,
  Painel,
  PrevisaoPagamentos,
  RespostaErro,
  Sancao,
  Sincronizacao,
  SugestaoVinculoContratoAta,
  Tarefa,
  UnidadeInterna,
  UsuarioAdmin,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { USUARIOS_DEMONSTRACAO, USUARIOS_DEMONSTRACAO_ADICIONAIS } from '../src/seed/usuarios-demonstracao.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

function temCampos(objeto: unknown, campos: readonly string[], contexto: string): void {
  assert.ok(typeof objeto === 'object' && objeto !== null, `${contexto}: objeto ausente`);
  for (const campo of campos) assert.ok(campo in objeto, `${contexto}: campo "${campo}" ausente`);
}

function ehPagina(valor: unknown, contexto: string): void {
  temCampos(valor, ['itens', 'total', 'pagina', 'tamanhoPagina'], contexto);
}

describe('formato das respostas (contrato @agora/contratos) e escritas operacionais', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let admin: Credenciais;

  before(async () => {
    app = await criarAppTeste();
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('configuração pública lista os usuários de demonstração', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' });
    const config = r.json<ConfiguracaoPublica>();
    temCampos(config, ['produto', 'versao', 'ambiente', 'orgao', 'govbrHabilitado', 'iaHabilitada', 'encarregadoLgpd', 'usuariosDemonstracao'], 'configuração');
    assert.equal(config.produto, 'Ágora');
    assert.equal(config.usuariosDemonstracao?.length, USUARIOS_DEMONSTRACAO.length + USUARIOS_DEMONSTRACAO_ADICIONAIS.length);
    assert.ok(!JSON.stringify(config).includes('Agora@Demo2026'), 'a senha não é exposta');
  });

  test('painel: indicadores, semáforo de vencimentos, PNCP pendente e proveniência', async () => {
    const painel = await obterJson<Painel>(app, gestor, '/api/v1/painel');
    temCampos(painel.indicadores, ['atasVigentes', 'contratosVigentes', 'valorGlobalContratos', 'valorEmpenhado', 'valorPago', 'saldoAEmpenhar', 'pendenciasAbertas', 'pendenciasAltaPrioridade'], 'indicadores');
    assert.ok(painel.vencimentos.em30 > 0 && painel.vencimentos.em60 > 0 && painel.vencimentos.em90 > 0 && painel.vencimentos.vencidos > 0, 'todo o semáforo exercitado');
    assert.ok(painel.divulgacaoPncpPendente > 0);
    assert.ok(painel.queimaAcelerada > 0);
    assert.ok(painel.proximosVencimentos.length <= 8 && painel.proximosVencimentos.length > 0);
    const dias = painel.proximosVencimentos.map((v) => v.diasRestantes);
    assert.deepEqual(dias, [...dias].sort((a, b) => a - b));
    temCampos(painel.proximosVencimentos[0], ['tipo', 'id', 'identificador', 'objeto', 'uasg', 'vigenciaFim', 'diasRestantes', 'semaforo'], 'vencimento');
    assert.equal(painel.proveniencia.length, 4);
    assert.ok(painel.proveniencia.every((p) => p.situacao === 'atualizado'));
    assert.ok(Number.isInteger(painel.indicadores.valorGlobalContratos));
  });

  test('atas: lista, a montar, detalhe e abas', async () => {
    const atas = await obterJson<Pagina<AtaResumo>>(app, gestor, '/api/v1/atas?tamanhoPagina=100');
    ehPagina(atas, 'atas');
    assert.equal(atas.total, 40);
    temCampos(atas.itens[0], ['id', 'numero', 'uasgGerenciadora', 'objeto', 'fornecedores', 'vigenciaInicio', 'vigenciaFim', 'diasRestantes', 'semaforo', 'situacao', 'valorRegistrado', 'valorContratado', 'percentualConsumido', 'quantidadeItens', 'itensEmRisco', 'criticidade', 'gestor'], 'ata');
    const totalItens = atas.itens.reduce((s, a) => s + a.quantidadeItens, 0);
    assert.ok(totalItens >= 250 && totalItens <= 400, `≈ 320 itens (${totalItens})`);
    const encerradas = await obterJson<Pagina<AtaResumo>>(app, gestor, '/api/v1/atas?situacao=encerrado&tamanhoPagina=100');
    assert.ok(encerradas.itens.every((a) => a.situacao === 'encerrado' && a.semaforo === 'vencido'));
    const altas = await obterJson<Pagina<AtaResumo>>(app, gestor, '/api/v1/atas?criticidade=alta');
    assert.ok(altas.itens.every((a) => a.criticidade === 'alta'));

    const aMontar = await obterJson<Pagina<AtaAMontar>>(app, gestor, '/api/v1/atas/a-montar');
    assert.equal(aMontar.total, 8);
    temCampos(aMontar.itens[0], ['id', 'numeroCompra', 'modalidade', 'uasg', 'objeto', 'homologadaEm', 'quantidadeItens', 'valorHomologado', 'idPncp'], 'a montar');

    const comContratos = atas.itens.find((a) => a.valorContratado > 0);
    assert.ok(comContratos);
    const detalhe = await obterJson<AtaDetalhe>(app, gestor, `/api/v1/atas/${comContratos.id}`);
    temCampos(detalhe, ['processoSei', 'modalidade', 'numeroCompra', 'assinaturaEm', 'divulgacaoPncpEm', 'aceitaAdesao', 'idPncp', 'linkPncp', 'saldoContratavel', 'linhaDoTempo', 'proveniencia'], 'ata detalhe');
    assert.match(detalhe.linkPncp, /^https:\/\/pncp\.gov\.br\/app\/atas\//);
    assert.equal(detalhe.saldoContratavel, detalhe.valorRegistrado - detalhe.valorContratado);
    assert.ok(detalhe.linhaDoTempo.some((e) => e.tipo === 'assinatura'));
    const itens = await obterJson<ItemAta[]>(app, gestor, `/api/v1/atas/${comContratos.id}/itens`);
    temCampos(itens[0], ['id', 'numero', 'descricao', 'catmat', 'unidadeFornecimento', 'fornecedor', 'valorUnitario', 'quantidadeRegistrada', 'quantidadeContratada', 'quantidadeEmpenhada', 'percentualConsumido', 'emRisco'], 'item ata');
    const contratos = await obterJson<ContratoResumo[]>(app, gestor, `/api/v1/atas/${comContratos.id}/contratos`);
    assert.ok(contratos.length > 0 && contratos.every((c) => c.ataOrigem?.id === comContratos.id));
    const tarefas = await obterJson<Tarefa[]>(app, gestor, `/api/v1/atas/${comContratos.id}/tarefas`);
    assert.ok(tarefas.length > 0);
    const reajuste = await obterJson<InfoReajuste>(app, gestor, `/api/v1/atas/${comContratos.id}/reajuste`);
    temCampos(reajuste, ['indice', 'dataBase', 'proximoReajustePossivelEm', 'ciclos', 'observacao'], 'reajuste');
    assert.ok(reajuste.proximoReajustePossivelEm > reajuste.dataBase);
    const historico = await obterJson<unknown[]>(app, gestor, `/api/v1/atas/${comContratos.id}/historico`);
    assert.ok(historico.length > 0);
  });

  test('contratos: lista, filtros, detalhe (art. 94 e queima de saldo) e abas', async () => {
    const contratos = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?tamanhoPagina=100');
    assert.equal(contratos.total, 60);
    temCampos(contratos.itens[0], ['id', 'numero', 'uasg', 'fornecedor', 'objeto', 'vigenciaInicio', 'vigenciaFim', 'diasRestantes', 'semaforo', 'situacao', 'valorGlobal', 'valorEmpenhado', 'valorPago', 'percentualExecutado', 'pendenciasAbertas', 'gestor', 'ataOrigem'], 'contrato');
    const comAta = contratos.itens.filter((c) => c.ataOrigem !== null).length;
    assert.ok(comAta >= 40 && comAta <= 50, `≈ 45 contratos com ata (${comAta})`);
    const semAta = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?semAta=true&tamanhoPagina=100');
    assert.equal(semAta.total, 60 - comAta);
    const pagina2 = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?tamanhoPagina=5&pagina=2');
    assert.equal(pagina2.itens.length, 5);
    assert.equal(pagina2.pagina, 2);
    const porValor = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?ordenarPor=valorGlobal&ordem=desc&tamanhoPagina=10');
    const valores = porValor.itens.map((c) => c.valorGlobal);
    assert.deepEqual(valores, [...valores].sort((a, b) => b - a));
    const busca = await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?busca=viaturas');
    assert.ok(busca.total > 0 && busca.itens.every((c) => /viatura/i.test(c.objeto)));

    const alvo = contratos.itens.find((c) => c.valorPago > 0 && c.situacao !== 'encerrado');
    assert.ok(alvo);
    const detalhe = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${alvo.id}`);
    temCampos(detalhe, ['processoSei', 'origem', 'modalidade', 'assinaturaEm', 'divulgacaoPncpEm', 'divulgacaoPncp', 'valorInicial', 'acrescimos', 'supressoes', 'fiscal', 'idPncp', 'linkPncp', 'garantia', 'queimaSaldo', 'linhaDoTempo', 'proveniencia'], 'contrato detalhe');
    temCampos(detalhe.divulgacaoPncp, ['situacao', 'limite', 'explicacao'], 'divulgação');
    temCampos(detalhe.queimaSaldo, ['percentualExecutado', 'percentualTempoDecorrido', 'dataEsgotamentoProjetada', 'esgotaAntesDoFim', 'sinal', 'explicacao'], 'queima');
    assert.equal(detalhe.proveniencia.fonte, 'CONTRATOS_GOV');

    const pendenteVencido = (
      await Promise.all(
        contratos.itens.map((c) => obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${c.id}`)),
      )
    ).filter((c) => c.divulgacaoPncp.situacao === 'pendente_vencido');
    assert.ok(pendenteVencido.length > 0, 'há contratos com divulgação no PNCP vencida');

    const itens = await obterJson<ItemContrato[]>(app, gestor, `/api/v1/contratos/${alvo.id}/itens`);
    temCampos(itens[0], ['id', 'numero', 'descricao', 'unidadeFornecimento', 'quantidade', 'valorUnitario', 'valorTotal', 'quantidadeEmpenhada', 'quantidadeRecebida'], 'item contrato');
    const pagamentos = await obterJson<Pagamento[]>(app, gestor, `/api/v1/contratos/${alvo.id}/pagamentos`);
    assert.equal(pagamentos.length, 8);
    const empenhos = await obterJson<unknown[]>(app, gestor, `/api/v1/contratos/${alvo.id}/empenhos`);
    assert.ok(empenhos.length >= 3);
    const aditivos = await obterJson<unknown[]>(app, gestor, `/api/v1/contratos/${alvo.id}/aditivos`);
    assert.ok(Array.isArray(aditivos));
    const historico = await obterJson<{ acao: string }[]>(app, gestor, `/api/v1/contratos/${alvo.id}/historico`);
    assert.ok(historico.some((h) => h.acao.startsWith('Registrou o contrato')));
  });

  test('itens: carteira paginada e exportação CSV (BOM, separador ;)', async () => {
    const itens = await obterJson<Pagina<ItemCarteira>>(app, gestor, '/api/v1/itens?tamanhoPagina=10');
    ehPagina(itens, 'itens');
    temCampos(itens.itens[0], ['id', 'ata', 'numero', 'descricao', 'uasg', 'fornecedor', 'valorUnitario', 'quantidadeRegistrada', 'quantidadeContratada', 'quantidadeEmpenhada', 'percentualConsumido', 'alocado', 'empenhado'], 'item carteira');
    const naoAlocados = await obterJson<Pagina<ItemCarteira>>(app, gestor, '/api/v1/itens?alocacao=nao_alocado&tamanhoPagina=100');
    assert.ok(naoAlocados.itens.every((i) => !i.alocado && i.quantidadeContratada === 0));

    const csv = await chamar(app, gestor, 'GET', '/api/v1/itens/exportar.csv?alocacao=alocado');
    assert.equal(csv.statusCode, 200);
    assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.match(String(csv.headers['content-disposition']), /attachment; filename="itens-agora-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.ok(csv.body.startsWith('﻿'), 'BOM UTF-8');
    const linhas = csv.body.slice(1).trim().split('\r\n');
    assert.equal(linhas[0], 'Ata;Item;Descrição;UASG;Fornecedor;Valor unitário (R$);Qtd. registrada;Qtd. contratada;Qtd. empenhada;% consumido;Alocado;Empenhado');
    const alocados = await obterJson<Pagina<ItemCarteira>>(app, gestor, '/api/v1/itens?alocacao=alocado&tamanhoPagina=10');
    assert.equal(linhas.length - 1, alocados.total);
    assert.match(linhas[1] ?? '', /;\d+,\d{2};/, 'valor com vírgula decimal');
    assert.ok((linhas[1] ?? '').endsWith(';Sim') || (linhas[1] ?? '').endsWith(';Não'));
  });

  test('financeiro: empenhos com totais e proveniência; pagamentos em ordem cronológica; previsão', async () => {
    const empenhos = await obterJson<PaginaEmpenhos>(app, gestor, '/api/v1/empenhos?tamanhoPagina=100');
    assert.ok(empenhos.total >= 215 && empenhos.total <= 225, `≈ 220 empenhos (${empenhos.total})`);
    temCampos(empenhos, ['totais', 'proveniencia'], 'página de empenhos');
    assert.equal(empenhos.proveniencia.fonte, 'SIAFI');
    temCampos(empenhos.itens[0], ['id', 'numero', 'uasg', 'credor', 'contrato', 'emissaoEm', 'ano', 'naturezaDespesa', 'valorEmpenhado', 'valorLiquidado', 'valorPago', 'saldo', 'restosAPagar'], 'empenho');
    assert.match(empenhos.itens[0]?.numero ?? '', /^\d{4}NE\d{6}$/);
    const comSaldo = await obterJson<PaginaEmpenhos>(app, gestor, '/api/v1/empenhos?saldo=com&tamanhoPagina=100');
    assert.ok(comSaldo.itens.every((e) => e.saldo > 0));
    assert.equal(comSaldo.totais.saldo, comSaldo.totais.empenhado - comSaldo.totais.liquidado);

    const pagamentos = await obterJson<Pagina<Pagamento>>(app, gestor, '/api/v1/pagamentos?tamanhoPagina=100');
    assert.equal(pagamentos.total, 480);
    temCampos(pagamentos.itens[0], ['id', 'contrato', 'fornecedor', 'notaFiscal', 'competencia', 'valor', 'vencimento', 'pagoEm', 'situacao', 'posicaoOrdemCronologica', 'atestadoPor'], 'pagamento');
    const pagos = await obterJson<Pagina<Pagamento>>(app, gestor, '/api/v1/pagamentos?situacao=pago&tamanhoPagina=10');
    assert.ok(pagos.itens.every((p) => p.situacao === 'pago' && p.posicaoOrdemCronologica === null && p.pagoEm !== null));
    const atrasados = await obterJson<Pagina<Pagamento>>(app, gestor, '/api/v1/pagamentos?situacao=atrasado&tamanhoPagina=10');
    assert.ok(atrasados.itens.every((p) => p.situacao === 'atrasado' && p.posicaoOrdemCronologica !== null));

    const previsao = await obterJson<PrevisaoPagamentos>(app, gestor, '/api/v1/pagamentos/previsao?ano=2026');
    assert.equal(previsao.ano, 2026);
    assert.equal(previsao.meses.length, 12);
    assert.equal(previsao.meses[0]?.mes, '2026-01');
    assert.ok(previsao.porContrato.length > 0);
    temCampos(previsao.porContrato[0], ['contrato', 'fornecedor', 'previstoAno', 'realizadoAno'], 'previsão por contrato');
  });

  test('fiscal atesta pagamento previsto (só de previsto para atestado)', async () => {
    const fiscal = await entrar(app, 'fiscal@agora.demo');
    const previstos = await obterJson<Pagina<Pagamento>>(app, fiscal, '/api/v1/pagamentos?situacao=previsto&tamanhoPagina=1');
    const alvo = previstos.itens[0];
    assert.ok(alvo);
    const r = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${alvo.id}/atestar`);
    assert.equal(r.statusCode, 200);
    const atestado = r.json<Pagamento>();
    assert.equal(atestado.situacao, 'atestado');
    assert.equal(atestado.atestadoPor?.id, fiscal.sessao.usuario.id);
    const repetido = await chamar(app, fiscal, 'POST', `/api/v1/pagamentos/${alvo.id}/atestar`);
    assert.equal(repetido.statusCode, 409);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/pagamentos/${alvo.id}/atestar`)).statusCode, 403, 'gestor não atesta');
  });

  test('tarefas: concluir e reabrir pelo PATCH', async () => {
    const [contrato] = (await obterJson<Pagina<ContratoResumo>>(app, gestor, '/api/v1/contratos?situacao=vigente&tamanhoPagina=1')).itens;
    assert.ok(contrato);
    const tarefas = await obterJson<Tarefa[]>(app, gestor, `/api/v1/contratos/${contrato.id}/tarefas`);
    const pendente = tarefas.find((t) => t.situacao !== 'concluida');
    assert.ok(pendente);
    const concluida = await chamar(app, gestor, 'PATCH', `/api/v1/tarefas/${pendente.id}`, { situacao: 'concluida' });
    assert.equal(concluida.statusCode, 200);
    assert.equal(concluida.json<Tarefa>().situacao, 'concluida');
    assert.ok(concluida.json<Tarefa>().concluidaEm);
    const reaberta = await chamar(app, gestor, 'PATCH', `/api/v1/tarefas/${pendente.id}`, { situacao: 'pendente' });
    assert.notEqual(reaberta.json<Tarefa>().situacao, 'concluida');
    const invalida = await chamar(app, gestor, 'PATCH', `/api/v1/tarefas/${pendente.id}`, { situacao: 'atrasada' });
    assert.equal(invalida.statusCode, 400);
  });

  test('vínculos: sugestões, vincular e desfazer (auditados)', async () => {
    const semAta = await obterJson<SugestaoVinculoContratoAta[]>(app, gestor, '/api/v1/vinculos/contratos-sem-ata');
    assert.ok(semAta.length > 0);
    temCampos(semAta[0], ['contrato', 'ataSugerida', 'confianca', 'motivo'], 'sugestão');
    const comSugestao = semAta.find((s) => s.ataSugerida !== null);
    assert.ok(comSugestao?.ataSugerida, 'há sugestão de ata para contrato sem vínculo');

    const vincular = await chamar(app, gestor, 'POST', '/api/v1/vinculos/contrato-ata', { contratoId: comSugestao.contrato.id, ataId: comSugestao.ataSugerida.id });
    assert.equal(vincular.statusCode, 204);
    const detalhe = await obterJson<ContratoDetalhe>(app, gestor, `/api/v1/contratos/${comSugestao.contrato.id}`);
    assert.equal(detalhe.ataOrigem?.id, comSugestao.ataSugerida.id);
    const duplicado = await chamar(app, gestor, 'POST', '/api/v1/vinculos/contrato-ata', { contratoId: comSugestao.contrato.id, ataId: comSugestao.ataSugerida.id });
    assert.equal(duplicado.statusCode, 409);
    const desfazer = await chamar(app, gestor, 'DELETE', `/api/v1/vinculos/contrato-ata/${comSugestao.contrato.id}`);
    assert.equal(desfazer.statusCode, 204);

    const empenhosSemContrato = await obterJson<EmpenhoSemContrato[]>(app, gestor, '/api/v1/vinculos/empenhos-sem-contrato');
    assert.equal(empenhosSemContrato.length, 15);
    const sugerido = empenhosSemContrato.find((e) => e.contratoSugerido !== null);
    assert.ok(sugerido?.contratoSugerido);
    assert.equal(
      (await chamar(app, gestor, 'POST', '/api/v1/vinculos/empenho-contrato', { empenhoId: sugerido.empenho.id, contratoId: sugerido.contratoSugerido.id })).statusCode,
      204,
    );
    const semItem = await obterJson<EmpenhoSemItem[]>(app, gestor, '/api/v1/vinculos/empenhos-sem-item');
    const recemVinculado = semItem.find((e) => e.empenho.id === sugerido.empenho.id);
    assert.ok(recemVinculado && recemVinculado.itensCandidatos.length > 0);
    const item = recemVinculado.itensCandidatos[0];
    assert.ok(item);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/vinculos/empenho-item', { empenhoId: sugerido.empenho.id, itemContratoId: item.id })).statusCode, 204);
    assert.equal((await chamar(app, gestor, 'DELETE', `/api/v1/vinculos/empenho-contrato/${sugerido.empenho.id}`)).statusCode, 204);

    const consulta = await entrar(app, 'consulta@agora.demo');
    const negado = await chamar(app, consulta, 'POST', '/api/v1/vinculos/contrato-ata', { contratoId: comSugestao.contrato.id, ataId: comSugestao.ataSugerida.id });
    assert.equal(negado.statusCode, 403);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<{ acao: string }>>(app, auditor, '/api/v1/auditoria?acao=vinculo&tamanhoPagina=20');
    const acoes = trilha.itens.map((e) => e.acao);
    for (const esperada of ['vinculo.contrato_ata.criar', 'vinculo.contrato_ata.desfazer', 'vinculo.empenho_contrato.criar', 'vinculo.empenho_item.criar', 'vinculo.empenho_contrato.desfazer']) {
      assert.ok(acoes.includes(esperada), esperada);
    }
  });

  test('ajustes: leitura para todos os perfis e escrita só do administrador', async () => {
    const modelos = await obterJson<ModeloGestao[]>(app, gestor, '/api/v1/modelos-gestao');
    assert.equal(modelos.length, 6);
    temCampos(modelos[0], ['id', 'tipo', 'nome', 'evento', 'ativo', 'tarefas'], 'modelo');
    const modelosAta = await obterJson<ModeloGestao[]>(app, gestor, '/api/v1/modelos-gestao?tipo=ata');
    assert.ok(modelosAta.every((m) => m.tipo === 'ata'));
    const novo = { tipo: 'contrato', nome: 'Plano de gestão de garantias', evento: 'assinatura', ativo: true, tarefas: [{ titulo: 'Conferir apólice', macrotarefa: 'Garantia', diasRelativos: 5, papelResponsavel: 'gestor' }] };
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/modelos-gestao', novo)).statusCode, 403);
    const criado = await chamar(app, admin, 'POST', '/api/v1/modelos-gestao', novo);
    assert.equal(criado.statusCode, 201);
    const modelo = criado.json<ModeloGestao>();
    assert.equal(modelo.tarefas.length, 1);
    const atualizado = await chamar(app, admin, 'PUT', `/api/v1/modelos-gestao/${modelo.id}`, { ...novo, ativo: false, tarefas: [] });
    assert.equal(atualizado.json<ModeloGestao>().ativo, false);

    const unidades = await obterJson<UnidadeInterna[]>(app, gestor, '/api/v1/unidades-internas');
    assert.equal(unidades.length, 8);
    assert.ok(unidades.some((u) => u.usuarios > 0));
    const unidade = await chamar(app, admin, 'POST', '/api/v1/unidades-internas', { sigla: 'NUSEG', nome: 'Núcleo de Segurança Orgânica' });
    assert.equal(unidade.statusCode, 201);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/unidades-internas', { sigla: 'nuseg', nome: 'Duplicada' })).statusCode, 409);
    const editada = await chamar(app, admin, 'PUT', `/api/v1/unidades-internas/${unidade.json<UnidadeInterna>().id}`, { sigla: 'NUSEG', nome: 'Núcleo de Segurança', ativa: false });
    assert.equal(editada.json<UnidadeInterna>().ativa, false);

    const grupos = await obterJson<GrupoUasg[]>(app, gestor, '/api/v1/grupos-uasg');
    assert.equal(grupos.length, 4);
    const pendente = grupos.find((g) => g.situacao === 'pendente_confirmacao');
    assert.ok(pendente);
    const confirmado = await chamar(app, admin, 'POST', `/api/v1/grupos-uasg/${pendente.id}/confirmar`);
    assert.equal(confirmado.json<GrupoUasg>().situacao, 'confirmado');
    assert.equal((await chamar(app, admin, 'POST', `/api/v1/grupos-uasg/${pendente.id}/confirmar`)).statusCode, 409);

    const feriados = await obterJson<Feriado[]>(app, gestor, '/api/v1/feriados?ano=2026');
    assert.ok(feriados.some((f) => f.data === '2026-11-20' && f.tipo === 'feriado'), 'Consciência Negra (nacional)');
    assert.ok(feriados.some((f) => f.tipo === 'ponto_facultativo'));
    assert.ok(feriados.some((f) => f.tipo === 'local'));
    const novoFeriado = await chamar(app, admin, 'POST', '/api/v1/feriados', { data: '2026-12-31', nome: 'Ponto facultativo de fim de ano' });
    assert.equal(novoFeriado.statusCode, 201);
    assert.deepEqual(novoFeriado.json<Feriado>(), { data: '2026-12-31', nome: 'Ponto facultativo de fim de ano', tipo: 'local' });
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/feriados', { data: '2026-02-30', nome: 'Data inválida' })).statusCode, 400);
  });

  test('administração de usuários: criar, editar, desativar e proteções', async () => {
    const lista = await obterJson<Pagina<UsuarioAdmin>>(app, admin, '/api/v1/usuarios?busca=agora.demo&tamanhoPagina=50');
    assert.ok(lista.total >= 9);
    temCampos(lista.itens[0], ['id', 'nome', 'email', 'cpf', 'perfis', 'uasgs', 'unidadeInterna', 'ativo', 'ultimoAcessoEm'], 'usuário');
    const prng = new Prng(2026);
    const cpf = gerarCpf(prng);
    const outroCpf = gerarCpf(prng);
    const entrada = { nome: 'Teresa Moura Bastos', email: 'teresa.bastos@agora.demo', cpf, perfis: ['fiscal'], uasgs: ['910001'], unidadeInternaId: null };
    const criado = await chamar(app, admin, 'POST', '/api/v1/usuarios', entrada);
    assert.equal(criado.statusCode, 201);
    const usuario = criado.json<UsuarioAdmin>();
    assert.equal(usuario.cpf, `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`);
    assert.deepEqual(usuario.uasgs, ['910001']);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/usuarios', entrada)).statusCode, 409);
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/usuarios', { ...entrada, email: 'outra@agora.demo', cpf: '111.111.111-11' })).statusCode, 400);
    const desconhecida = await chamar(app, admin, 'POST', '/api/v1/usuarios', { ...entrada, email: 'x@agora.demo', cpf: outroCpf, uasgs: ['999999'] });
    assert.equal(desconhecida.statusCode, 422);
    const editado = await chamar(app, admin, 'PATCH', `/api/v1/usuarios/${usuario.id}`, { perfis: ['fiscal', 'gestor_contratos'], ativo: false });
    assert.equal(editado.statusCode, 200);
    assert.deepEqual(editado.json<UsuarioAdmin>().perfis, ['fiscal', 'gestor_contratos']);
    assert.equal(editado.json<UsuarioAdmin>().ativo, false);
    const proprio = await chamar(app, admin, 'PATCH', `/api/v1/usuarios/${admin.sessao.usuario.id}`, { ativo: false });
    assert.equal(proprio.statusCode, 422);
    assert.equal(proprio.json<RespostaErro>().erro.codigo, 'REGRA_NEGOCIO');
  });

  test('sincronizações: lista e execução offline (proveniência com hash)', async () => {
    const lista = await obterJson<Sincronizacao[]>(app, gestor, '/api/v1/sincronizacoes');
    assert.equal(lista.length, 4);
    temCampos(lista[0], ['fonte', 'conjunto', 'modo', 'ultimaExecucaoEm', 'ultimoSucessoEm', 'situacao', 'registrosProcessados', 'mensagem', 'hashConteudo'], 'sincronização');
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/sincronizacoes/SIAFI/executar')).statusCode, 403);
    const financeiro = await entrar(app, 'financeiro@agora.demo');
    const r = await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/SIAFI/executar');
    assert.equal(r.statusCode, 200);
    const sincronizacao = r.json<Sincronizacao>();
    assert.equal(sincronizacao.situacao, 'ok');
    assert.equal(sincronizacao.modo, 'offline');
    assert.match(sincronizacao.hashConteudo ?? '', /^[0-9a-f]{64}$/);
    assert.ok(sincronizacao.registrosProcessados >= 215);
    const repetida = await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/SIAFI/executar');
    assert.equal(repetida.json<Sincronizacao>().hashConteudo, sincronizacao.hashConteudo, 'idempotente: mesmo conteúdo, mesmo hash');
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/sincronizacoes/AGORA/executar')).statusCode, 400);
  });

  test('sanções: lista paginada', async () => {
    const sancoes = await obterJson<Pagina<Sancao>>(app, gestor, '/api/v1/sancoes');
    assert.equal(sancoes.total, 6);
    temCampos(sancoes.itens[0], ['id', 'fornecedor', 'contrato', 'incisoInfracao', 'tipo', 'situacao', 'valorMulta', 'inicioVigencia', 'fimVigencia', 'prazoDefesa', 'prazoRegistroCeisCnep', 'registradaCeisCnep', 'instauradaEm'], 'sanção');
    const aplicadas = await obterJson<Pagina<Sancao>>(app, gestor, '/api/v1/sancoes?situacao=aplicada');
    assert.ok(aplicadas.itens.every((s) => s.situacao === 'aplicada'));
  });
});
