import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  HIPOTESES_INEXIGIBILIDADE,
  ROTAS_CONTRATACAO,
  adaptacaoDaRota,
  avaliarAdesaoAta,
  avaliarFracionamentoPorObjeto,
  avaliarReservaSicx,
  julgarPropostasDispensa,
  montarExtratoCartao,
  prazoContratacaoAdesao,
  prazosCompraSicx,
  ranquearOfertasSicx,
  regrasPorTela,
  situacaoAvisoDispensa,
  validarCompraCartao,
  validarCompraSicx,
  validarEscolhaRota,
  validarInexigibilidade,
  type OfertaSicx,
  type PropostaDispensa,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const JUSTIFICATIVA = 'Contratação de pequeno valor para reposição imediata do estoque da unidade.';

describe('adaptacaoDaRota (RF-34)', () => {
  it('licitação mantém a jornada completa; rotas diretas sem edital nem disputa', () => {
    const licitacao = adaptacaoDaRota('licitacao');
    assert.equal(licitacao.edital, 'obrigatorio');
    assert.equal(licitacao.selecaoLicitacao, true);
    assert.equal(licitacao.divulgacaoContrato, 'licitacao');
    for (const rota of ['dispensa', 'inexigibilidade', 'adesao_ata', 'sicx'] as const) {
      const a = adaptacaoDaRota(rota, 'valor_demais');
      assert.equal(a.edital, 'nao_se_aplica', rota);
      assert.equal(a.selecaoLicitacao, false, rota);
    }
    assert.deepEqual([...ROTAS_CONTRATACAO], ['licitacao', 'dispensa', 'inexigibilidade', 'adesao_ata', 'sicx']);
  });

  it('dispensa por valor: ETP e riscos facultativos, aviso de 3 dias úteis, contrato substituível (art. 95, I)', () => {
    const a = adaptacaoDaRota('dispensa', 'valor_demais');
    assert.equal(a.etp, 'facultativo');
    assert.equal(a.matrizRiscos, 'facultativo');
    assert.equal(a.minutaContrato, 'facultativo');
    assert.equal(a.avisoDispensa, true);
    assert.equal(a.autorizacaoContratacao, true);
    assert.equal(a.origemContrato, 'contratacao_direta');
    assert.match(a.modalidade, /art\. 75, II/);
    assert.ok(a.documentos.some((d) => d.id === 'aviso' && /art\. 75, § 3º/.test(d.fundamento)));
    assert.ok(a.documentos.some((d) => d.id === 'autorizacao' && /art\. 72, VIII/.test(d.fundamento)));
    const outra = adaptacaoDaRota('dispensa', 'outra');
    assert.equal(outra.avisoDispensa, false);
    assert.equal(outra.etp, 'obrigatorio');
  });

  it('adesão sem TR próprio; Sicx sem TR, edital nem contrato na jornada (Decreto 13.106/2026, arts. 15 e 21)', () => {
    const adesao = adaptacaoDaRota('adesao_ata');
    assert.equal(adesao.termoReferencia, 'nao_se_aplica');
    assert.equal(adesao.minutaContrato, 'obrigatorio');
    assert.ok(adesao.documentos.some((d) => /art\. 31, § 2º/.test(d.fundamento)));
    const sicx = adaptacaoDaRota('sicx');
    assert.equal(sicx.contratoNaJornada, false);
    assert.equal(sicx.termoReferencia, 'nao_se_aplica');
    assert.equal(sicx.parecerJuridico, 'facultativo');
    assert.match(sicx.fundamento, /Lei 15\.266\/2025/);
  });

  it('rota inválida → ROTA_INVALIDA', () => {
    assert.throws(() => adaptacaoDaRota('pregao' as never), comCodigo('ROTA_INVALIDA'));
  });
});

describe('validarEscolhaRota', () => {
  const base = { valorEstimado: 6_000_000, tipoObjeto: 'demais' as const, data: '2026-11-09', justificativa: JUSTIFICATIVA, natureza: 'material de expediente' };

  it('dispensa por valor dentro do limite de 2026 (Decreto 12.807/2025) é válida', () => {
    const r = validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'valor_demais' });
    assert.deepEqual(r.pendencias, []);
    assert.equal(r.limite?.valor, 6_549_211);
    assert.equal(r.limite?.norma, 'Decreto 12.807/2025');
  });

  it('acima do limite, hipótese trocada e sem ramo de atividade → pendências', () => {
    const r = validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'valor_obras_engenharia', valorEstimado: 7_000_000, natureza: '' });
    const campos = r.pendencias.map((p) => p.campo).sort();
    assert.deepEqual(campos, ['hipoteseDispensa', 'natureza', 'valorEstimado']);
    const acima = validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'valor_demais', valorEstimado: 6_549_212 });
    assert.equal(acima.pendencias[0]?.campo, 'valorEstimado');
    assert.match(acima.pendencias[0]?.mensagem ?? '', /licite o objeto/);
  });

  it('outra hipótese exige inciso III a XVI; I e II são a dispensa por valor', () => {
    const ok = validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'outra', incisoDispensa: 'VIII' });
    assert.deepEqual(ok.pendencias, []);
    assert.deepEqual(validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'outra', incisoDispensa: 'IV, c' }).pendencias, []);
    for (const inciso of ['II', 'XX', '', 'oito']) {
      const r = validarEscolhaRota({ ...base, rota: 'dispensa', hipoteseDispensa: 'outra', incisoDispensa: inciso });
      assert.equal(r.pendencias[0]?.campo, 'incisoDispensa', inciso);
    }
  });

  it('inexigibilidade sem hipótese e rota direta sem justificativa → pendências; licitação dispensa justificativa', () => {
    const r = validarEscolhaRota({ ...base, rota: 'inexigibilidade', justificativa: 'curta' });
    assert.deepEqual(r.pendencias.map((p) => p.campo).sort(), ['hipoteseInexigibilidade', 'justificativa']);
    assert.deepEqual(validarEscolhaRota({ ...base, rota: 'licitacao', justificativa: null }).pendencias, []);
  });
});

describe('situacaoAvisoDispensa (RN-41, art. 75, § 3º)', () => {
  it('3 dias úteis contados da divulgação: aberto até o último dia, julgamento no dia seguinte', () => {
    const publicado = '2026-11-09';
    const hoje = situacaoAvisoDispensa({ publicadoEm: publicado, hoje: '2026-11-09' });
    assert.equal(hoje.encerramento, '2026-11-12');
    assert.equal(hoje.aberto, true);
    assert.equal(hoje.diasUteisRestantes, 3);
    assert.equal(hoje.julgamentoLiberado, false);
    const ultimo = situacaoAvisoDispensa({ publicadoEm: publicado, hoje: '2026-11-12' });
    assert.equal(ultimo.aberto, true);
    assert.match(ultimo.mensagem, /último dia/);
    const depois = situacaoAvisoDispensa({ publicadoEm: publicado, hoje: '2026-11-13' });
    assert.equal(depois.aberto, false);
    assert.equal(depois.julgamentoLiberado, true);
    assert.match(depois.fundamento, /art\. 75, § 3º/);
  });

  it('pula o feriado de 20/11 (Consciência Negra) e o fim de semana', () => {
    assert.equal(situacaoAvisoDispensa({ publicadoEm: '2026-11-18', hoje: '2026-11-18' }).encerramento, '2026-11-24');
  });

  it('data de referência anterior à publicação → DATA_INVALIDA', () => {
    assert.throws(() => situacaoAvisoDispensa({ publicadoEm: '2026-11-09', hoje: '2026-11-06' }), comCodigo('DATA_INVALIDA'));
  });
});

describe('julgarPropostasDispensa', () => {
  const proposta = (id: string, fornecedorId: string, valor: number, recebidaEm: string, adicional = true): PropostaDispensa => ({
    id,
    fornecedorId,
    valor,
    recebidaEm,
    adicional,
  });

  it('seleciona o menor preço dentro do limite; empate pela ordem de recebimento; acima do limite desclassifica', () => {
    const r = julgarPropostasDispensa({
      limite: 6_549_211,
      valorEstimado: 5_000_000,
      propostas: [
        proposta('a', 'f1', 4_800_000, '2026-11-09T14:00:00Z', false),
        proposta('b', 'f2', 4_700_000, '2026-11-10T14:00:00Z'),
        proposta('c', 'f3', 4_700_000, '2026-11-10T10:00:00Z'),
        proposta('d', 'f4', 7_000_000, '2026-11-11T10:00:00Z'),
      ],
    });
    assert.equal(r.selecionada?.id, 'c');
    assert.deepEqual(r.classificadas.map((p) => p.id), ['c', 'b', 'a']);
    assert.equal(r.desclassificadas[0]?.proposta.id, 'd');
    assert.deepEqual(r.sinais, []);
  });

  it('a proposta mais recente do mesmo fornecedor substitui a anterior; acima do estimado vira sinal', () => {
    const r = julgarPropostasDispensa({
      limite: 6_549_211,
      valorEstimado: 4_000_000,
      propostas: [proposta('a', 'f1', 4_500_000, '2026-11-09T14:00:00Z'), proposta('b', 'f1', 4_400_000, '2026-11-10T14:00:00Z')],
    });
    assert.equal(r.classificadas.length, 1);
    assert.equal(r.selecionada?.id, 'b');
    assert.ok(r.sinais.some((s) => /art\. 72, VII/.test(s)));
    assert.ok(r.sinais.some((s) => /Só uma proposta/.test(s)));
  });
});

describe('avaliarFracionamentoPorObjeto (RIA-01, art. 75, § 1º)', () => {
  it('soma dispensas e cartão do mesmo ramo no exercício; ignora Sicx, outro ramo e outro exercício', () => {
    const r = avaliarFracionamentoPorObjeto({
      data: '2026-11-09',
      tipo: 'demais',
      natureza: 'Material de Expediente',
      novaContratacao: 2_000_000,
      despesas: [
        { valor: 3_000_000, natureza: 'material de expediente', data: '2026-03-10', origem: 'dispensa', tipo: 'demais' },
        { valor: 1_600_000, natureza: 'material  de expediente', data: '2026-08-10', origem: 'cartao', tipo: 'demais' },
        { valor: 9_000_000, natureza: 'material de expediente', data: '2026-05-10', origem: 'sicx', tipo: 'demais' },
        { valor: 9_000_000, natureza: 'informática', data: '2026-05-10', origem: 'dispensa', tipo: 'demais' },
        { valor: 9_000_000, natureza: 'material de expediente', data: '2025-12-30', origem: 'dispensa', tipo: 'demais' },
      ],
    });
    assert.equal(r.somaComNova, 6_600_000);
    assert.equal(r.sinal, 'risco');
    assert.equal(r.consideradas, 2);
    assert.equal(r.desconsideradas, 1);
    assert.match(r.explicacao, /Sicx/);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 75, § 1º');
  });

  it('sem ramo de atividade → FRACIONAMENTO_INVALIDO', () => {
    assert.throws(() => avaliarFracionamentoPorObjeto({ data: '2026-11-09', tipo: 'demais', natureza: ' ', despesas: [], novaContratacao: 1 }), comCodigo('FRACIONAMENTO_INVALIDO'));
  });
});

describe('validarInexigibilidade (art. 74)', () => {
  const longo = 'Somente este fornecedor atende à especificação, conforme documento juntado ao processo.';

  it('as cinco hipóteses do art. 74 estão catalogadas', () => {
    assert.deepEqual(HIPOTESES_INEXIGIBILIDADE.map((h) => h.inciso), ['I', 'II', 'III', 'IV', 'V']);
  });

  it('exclusividade exige documento e vedação de preferência por marca', () => {
    assert.deepEqual(validarInexigibilidade({ hipotese: 'exclusividade', justificativaInviabilidade: longo, documentoExclusividade: 'carta_exclusividade', semPreferenciaMarca: true }).pendencias, []);
    const r = validarInexigibilidade({ hipotese: 'exclusividade', justificativaInviabilidade: longo });
    assert.deepEqual(r.pendencias.map((p) => p.campo), ['documentoExclusividade', 'semPreferenciaMarca']);
    assert.match(r.fundamento, /§ 1º/);
  });

  it('notória especialização: alínea, elementos e vedação de publicidade', () => {
    const r = validarInexigibilidade({ hipotese: 'notoria_especializacao', justificativaInviabilidade: longo, alinea: 'z', publicidade: true, elementosNotoriaEspecializacao: 'curto' });
    assert.deepEqual(r.pendencias.map((p) => p.campo), ['publicidade', 'alinea', 'elementosNotoriaEspecializacao']);
    assert.deepEqual(validarInexigibilidade({ hipotese: 'notoria_especializacao', justificativaInviabilidade: longo, alinea: 'C', elementosNotoriaEspecializacao: longo }).pendencias, []);
  });

  it('artista por empresário exige exclusividade permanente; credenciamento exige edital; imóvel exige o § 5º', () => {
    assert.deepEqual(
      validarInexigibilidade({ hipotese: 'artista', justificativaInviabilidade: longo, consagracao: longo, porEmpresario: true }).pendencias.map((p) => p.campo),
      ['exclusividadePermanente'],
    );
    assert.deepEqual(validarInexigibilidade({ hipotese: 'credenciamento', justificativaInviabilidade: longo, editalChamamento: null }).pendencias.map((p) => p.campo), ['editalChamamento']);
    assert.deepEqual(
      validarInexigibilidade({ hipotese: 'imovel', justificativaInviabilidade: null }).pendencias.map((p) => p.campo),
      ['justificativaInviabilidade', 'avaliacaoPrevia', 'semImovelPublicoDisponivel', 'justificativaSingularidade'],
    );
    assert.throws(() => validarInexigibilidade({ hipotese: 'outra' as never, justificativaInviabilidade: longo }), comCodigo('INEXIGIBILIDADE_INVALIDA'));
  });
});

describe('avaliarAdesaoAta (art. 86, §§ 2º a 5º e 8º)', () => {
  const base = {
    quantidadeRegistrada: 100,
    quantidadeAderidaPeloOrgao: 0,
    quantidadeAderidaTotal: 0,
    quantidadeSolicitada: 50,
    ataVigente: true,
    ataAceitaAdesao: true,
    esferaGerenciador: 'federal' as const,
    esferaAderente: 'federal' as const,
    aderenteParticipante: false,
  };

  it('até 50% por órgão e o dobro no total', () => {
    const ok = avaliarAdesaoAta(base);
    assert.equal(ok.permitida, true);
    assert.equal(ok.limitePorOrgao, 50);
    assert.equal(ok.limiteTotal, 200);
    const acima = avaliarAdesaoAta({ ...base, quantidadeSolicitada: 51 });
    assert.equal(acima.permitida, false);
    assert.match(acima.recusas[0] ?? '', /50% .*art\. 86, § 4º/);
    const total = avaliarAdesaoAta({ ...base, quantidadeAderidaTotal: 180, quantidadeSolicitada: 30 });
    assert.equal(total.permitida, false);
    assert.equal(total.saldoTotal, 20);
    assert.ok(total.recusas.some((r) => /§ 5º/.test(r)));
    assert.equal(avaliarAdesaoAta({ ...base, quantidadeAderidaPeloOrgao: 40, quantidadeSolicitada: 11 }).permitida, false);
  });

  it('ata vencida, sem previsão de adesão, participante e órgão federal em ata estadual → recusas', () => {
    const r = avaliarAdesaoAta({ ...base, ataVigente: false, ataAceitaAdesao: false, aderenteParticipante: true, esferaGerenciador: 'estadual' });
    assert.equal(r.recusas.length, 4);
    assert.ok(r.recusas.some((x) => /§ 8º/.test(x)));
    assert.equal(avaliarAdesaoAta({ ...base, esferaAderente: 'municipal', esferaGerenciador: 'estadual' }).permitida, true);
  });

  it('quantidade não inteira ou zero → ADESAO_INVALIDA', () => {
    assert.throws(() => avaliarAdesaoAta({ ...base, quantidadeSolicitada: 0 }), comCodigo('ADESAO_INVALIDA'));
  });

  it('prazo de 90 dias da anuência, limitado à vigência da ata (Decreto 11.462/2023, art. 31, § 2º)', () => {
    const r = prazoContratacaoAdesao({ autorizadaEm: '2026-11-09', vigenciaFimAta: '2027-06-30', hoje: '2026-11-09' });
    assert.equal(r.limite, '2027-02-07');
    assert.equal(r.vencido, false);
    assert.equal(r.diasRestantes, 90);
    const curta = prazoContratacaoAdesao({ autorizadaEm: '2026-11-09', vigenciaFimAta: '2026-12-01', hoje: '2026-12-02' });
    assert.equal(curta.limite, '2026-12-01');
    assert.equal(curta.vencido, true);
  });
});

describe('Sicx (RN-42)', () => {
  const oferta = (id: string, preco: number, extra: Partial<OfertaSicx> = {}): OfertaSicx => ({
    id,
    fornecedorId: `f-${id}`,
    precoUnitario: preco,
    faixas: [],
    localidades: ['DF', 'GO'],
    prazoEntregaDias: 5,
    prazoPagamentoDias: 30,
    restricaoCadin: false,
    credenciada: true,
    reputacao: 4,
    ...extra,
  });

  it('ranqueia só ofertas aptas, com preço escalonado, e desempata por reputação e sorteio', () => {
    const r = ranquearOfertasSicx({
      quantidade: 100,
      uf: 'df',
      semente: 'compra-1',
      ofertas: [
        oferta('a', 1_000, { faixas: [{ aPartirDe: 50, precoUnitario: 900 }] }),
        oferta('b', 950),
        oferta('c', 900, { reputacao: 3 }),
        oferta('d', 800, { restricaoCadin: true }),
        oferta('e', 800, { localidades: ['SP'] }),
        oferta('f', 800, { prazoPagamentoDias: 45 }),
        oferta('g', 800, { credenciada: false }),
      ],
    });
    assert.deepEqual(r.ranqueadas.map((o) => o.oferta.id), ['a', 'c', 'b']);
    assert.equal(r.ranqueadas[0]?.valorTotal, 90_000);
    assert.equal(r.ranqueadas[0]?.desempate, 'reputacao');
    assert.equal(r.inaptas.length, 4);
    assert.ok(r.inaptas.some((i) => /Cadin/.test(i.motivo)));
    const empate = ranquearOfertasSicx({ quantidade: 1, uf: 'DF', semente: 's', ofertas: [oferta('x', 500), oferta('y', 500)] });
    assert.equal(empate.ranqueadas[0]?.desempate, 'sorteio');
    const repetido = ranquearOfertasSicx({ quantidade: 1, uf: 'DF', semente: 's', ofertas: [oferta('y', 500), oferta('x', 500)] });
    assert.deepEqual(repetido.ranqueadas.map((o) => o.oferta.id), empate.ranqueadas.map((o) => o.oferta.id), 'sorteio determinístico');
  });

  it('outra oferta exige justificativa; o mesmo agente não conclui sem autorização prévia', () => {
    const r = validarCompraSicx({ posicaoSelecionada: 2, justificativaSelecao: null, agenteOrdemId: 'u1', agenteConclusaoId: 'u1', autorizacaoPrevia: false });
    assert.deepEqual(r.pendencias.map((p) => p.campo), ['justificativaSelecao', 'agenteConclusao']);
    assert.deepEqual(validarCompraSicx({ posicaoSelecionada: 1, justificativaSelecao: null, agenteOrdemId: 'u1', agenteConclusaoId: 'u1', autorizacaoPrevia: true }).pendencias, []);
    assert.deepEqual(validarCompraSicx({ posicaoSelecionada: 1, justificativaSelecao: null, agenteOrdemId: 'u1', agenteConclusaoId: 'u2', autorizacaoPrevia: false }).pendencias, []);
  });

  it('prazos: provisório em 2 dias úteis, definitivo em 10 dias, tácito no silêncio e pagamento em 30 dias', () => {
    const entrega = prazosCompraSicx({ entregaRegistradaEm: '2026-11-09', recebimentoProvisorioEm: null, recebimentoDefinitivoEm: null, pagoEm: null, hoje: '2026-11-10' });
    assert.equal(entrega.situacao, 'aguardando_recebimento_provisorio');
    assert.equal(entrega.limiteRecebimentoProvisorio, '2026-11-11');
    const tacito = prazosCompraSicx({ entregaRegistradaEm: '2026-11-09', recebimentoProvisorioEm: null, recebimentoDefinitivoEm: null, pagoEm: null, hoje: '2026-11-30' });
    assert.equal(tacito.recebimentoTacito, true);
    assert.equal(tacito.situacao, 'aguardando_pagamento');
    assert.equal(tacito.limiteRecebimentoDefinitivo, '2026-11-21');
    assert.equal(tacito.limitePagamento, '2026-12-21');
    const expresso = prazosCompraSicx({ entregaRegistradaEm: '2026-11-09', recebimentoProvisorioEm: '2026-11-10', recebimentoDefinitivoEm: '2026-11-12', pagoEm: null, hoje: '2027-01-15' });
    assert.equal(expresso.recebimentoTacito, false);
    assert.equal(expresso.limitePagamento, '2026-12-12');
    assert.equal(expresso.pagamentoVencido, true);
    const paga = prazosCompraSicx({ entregaRegistradaEm: '2026-11-09', recebimentoProvisorioEm: '2026-11-10', recebimentoDefinitivoEm: '2026-11-12', pagoEm: '2026-11-20', hoje: '2026-11-25' });
    assert.equal(paga.situacao, 'paga');
    assert.equal(prazosCompraSicx({ entregaRegistradaEm: null, recebimentoProvisorioEm: null, recebimentoDefinitivoEm: null, pagoEm: null, hoje: '2026-11-25' }).situacao, 'aguardando_entrega');
    assert.throws(
      () => prazosCompraSicx({ entregaRegistradaEm: null, recebimentoProvisorioEm: null, recebimentoDefinitivoEm: null, pagoEm: null, hoje: '2026-11-25', prazoDefinitivoDias: 31 }),
      comCodigo('SICX_INVALIDO'),
    );
  });

  it('reserva de limite do ETP abrangente: recusa acima do saldo e sinaliza a partir de 80%', () => {
    assert.equal(avaliarReservaSicx({ limite: 1_000_000, utilizado: 0, novaCompra: 100_000 }).sinal, 'sem_risco');
    assert.equal(avaliarReservaSicx({ limite: 1_000_000, utilizado: 700_000, novaCompra: 100_000 }).sinal, 'atencao');
    const esgotado = avaliarReservaSicx({ limite: 1_000_000, utilizado: 950_000, novaCompra: 100_000 });
    assert.equal(esgotado.permitida, false);
    assert.equal(esgotado.saldo, 50_000);
    assert.match(esgotado.fundamento, /art\. 13, § 1º/);
  });
});

describe('cartão de pagamento (art. 75, § 4º)', () => {
  it('só dentro do limite da dispensa por valor e com o ramo de atividade', () => {
    assert.deepEqual(validarCompraCartao({ data: '2026-11-09', tipo: 'demais', valor: 120_000, natureza: 'material de expediente' }).pendencias, []);
    const r = validarCompraCartao({ data: '2026-11-09', tipo: 'demais', valor: 7_000_000, natureza: null });
    assert.deepEqual(r.pendencias.map((p) => p.campo), ['valor', 'natureza']);
    assert.equal(r.limite, 6_549_211);
  });

  it('extrato mensal com total, em ordem de data, e recusa compra de outra competência', () => {
    const e = montarExtratoCartao({
      competencia: '2026-10',
      compras: [
        { data: '2026-10-20', valor: 30_000, objeto: 'Cartuchos de toner', favorecido: 'Papelaria Sintética Ltda', documentoFavorecido: '11.222.333/0001-81' },
        { data: '2026-10-05', valor: 12_550, objeto: 'Pilhas e baterias', favorecido: 'Comercial Exemplo ME', documentoFavorecido: '22.333.444/0001-05' },
      ],
    });
    assert.equal(e.quantidade, 2);
    assert.equal(e.total, 42_550);
    assert.equal(e.linhas[0]?.data, '2026-10-05');
    assert.match(e.texto, /competência 10\/2026/);
    assert.match(e.texto, /art\. 75, § 4º/);
    assert.throws(
      () => montarExtratoCartao({ competencia: '2026-10', compras: [{ data: '2026-11-01', valor: 1, objeto: 'x', favorecido: 'y', documentoFavorecido: 'z' }] }),
      comCodigo('CARTAO_INVALIDO'),
    );
    assert.throws(() => montarExtratoCartao({ competencia: '2026-13', compras: [] }), comCodigo('CARTAO_INVALIDO'));
  });
});

describe('catálogo: RN-41, RN-42 e RF-34', () => {
  const porId = new Map(CATALOGO_REGRAS.map((r) => [r.id, r]));
  it('regras da frente nas etapas e telas certas', () => {
    assert.equal(porId.get('RN-41')?.etapa, 5);
    assert.equal(porId.get('RN-42')?.etapa, 6);
    assert.equal(porId.get('RF-34')?.etapa, 1);
    assert.match(porId.get('RN-41')?.fundamento ?? '', /art\. 75, I e II e §§ 1º, 3º e 4º/);
    assert.match(porId.get('RN-42')?.fundamento ?? '', /Decreto 13\.106\/2026/);
    assert.deepEqual(regrasPorTela('sicx').map((r) => r.id).sort(), ['RF-34', 'RN-42']);
    assert.ok(regrasPorTela('jornada.rota').some((r) => r.id === 'RF-34'));
  });
});
