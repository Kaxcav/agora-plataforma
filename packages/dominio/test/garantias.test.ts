import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  MODALIDADES_GARANTIA,
  atualizarCaucaoDinheiro,
  avaliarExecucaoGarantia,
  avaliarLiberacaoGarantia,
  avaliarPercentualGarantia,
  baseCalculoGarantia,
  planejarDescontoMulta,
  situacaoGarantia,
  validarApresentacaoGarantia,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09';
const JUSTIFICATIVA = 'Objeto de alta complexidade técnica, com integração a sistemas críticos e risco elevado de falha.';

describe('modalidades e base de cálculo (arts. 96 e 98)', () => {
  it('cinco modalidades do art. 96, § 1º, incluído o título de capitalização', () => {
    assert.deepEqual([...MODALIDADES_GARANTIA], ['caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria', 'titulo_capitalizacao']);
  });

  it('contínuo com vigência acima de um ano usa o valor anual (art. 98, parágrafo único)', () => {
    const r = baseCalculoGarantia({ valorInicial: 2_000_000_00, vigenciaInicio: '2026-01-01', vigenciaFim: '2027-12-31', continuo: true });
    assert.equal(r.anual, true);
    assert.equal(r.valorBase, Math.round((2_000_000_00 * 365) / 730));
    const naoContinuo = baseCalculoGarantia({ valorInicial: 2_000_000_00, vigenciaInicio: '2026-01-01', vigenciaFim: '2027-12-31', continuo: false });
    assert.equal(naoContinuo.valorBase, 2_000_000_00);
  });
});

describe('avaliarPercentualGarantia (RN-35)', () => {
  const base = { finalidade: 'execucao' as const, valorBase: 1_000_000_00, justificativa: null, grandeVultoEngenharia: false, clausulaRetomada: false, modalidadeExigida: null };

  it('até 5% sem condição', () => {
    const r = avaliarPercentualGarantia({ ...base, percentual: 5 });
    assert.equal(r.permitido, true);
    assert.equal(r.valorExigido, 50_000_00);
    assert.equal(r.limitePercentual, 5);
  });

  it('acima de 5% exige justificativa da complexidade (art. 98)', () => {
    assert.equal(avaliarPercentualGarantia({ ...base, percentual: 8 }).permitido, false);
    assert.equal(avaliarPercentualGarantia({ ...base, percentual: 8, justificativa: JUSTIFICATIVA }).permitido, true);
  });

  it('acima de 10%: grande vulto de engenharia, seguro-garantia com retomada (arts. 99 e 102)', () => {
    const negado = avaliarPercentualGarantia({ ...base, percentual: 20, justificativa: JUSTIFICATIVA });
    assert.equal(negado.permitido, false);
    assert.equal(negado.motivos.length, 3);
    const aceito = avaliarPercentualGarantia({ ...base, percentual: 30, justificativa: JUSTIFICATIVA, grandeVultoEngenharia: true, clausulaRetomada: true, modalidadeExigida: 'seguro_garantia' });
    assert.equal(aceito.permitido, true);
    assert.match(aceito.fundamento, /arts\. 99 e 102/);
    assert.equal(avaliarPercentualGarantia({ ...base, percentual: 31, justificativa: JUSTIFICATIVA, grandeVultoEngenharia: true, clausulaRetomada: true, modalidadeExigida: 'seguro_garantia' }).permitido, false);
  });

  it('antecipação de pagamento: até 100% do valor antecipado (art. 145, § 2º); zero é inválido', () => {
    assert.equal(avaliarPercentualGarantia({ ...base, finalidade: 'antecipacao', percentual: 100 }).permitido, true);
    assert.equal(avaliarPercentualGarantia({ ...base, finalidade: 'antecipacao', percentual: 120 }).permitido, false);
    assert.throws(() => avaliarPercentualGarantia({ ...base, percentual: 0 }), comCodigo('GARANTIA_PERCENTUAL_INVALIDO'));
  });
});

describe('apresentação e situação da garantia', () => {
  const apresentacao = {
    modalidade: 'seguro_garantia' as const,
    valor: 50_000_00,
    valorExigido: 50_000_00,
    apresentadaEm: '2026-11-05',
    prazoApresentacao: '2026-11-10',
    validaAte: '2027-12-31',
    vigenciaFimContrato: '2027-10-31',
    emissor: 'Seguradora Sintética S.A.',
    documento: 'Apólice 001',
    hoje: HOJE,
  };

  it('apresentação regular, sem avisos', () => {
    assert.deepEqual(validarApresentacaoGarantia(apresentacao).avisos, []);
  });

  it('valor menor que o exigido, sem emissor ou validade anterior → recusa', () => {
    assert.throws(() => validarApresentacaoGarantia({ ...apresentacao, valor: 40_000_00 }), comCodigo('GARANTIA_INSUFICIENTE'));
    assert.throws(() => validarApresentacaoGarantia({ ...apresentacao, emissor: '' }), comCodigo('GARANTIA_INVALIDA'));
    assert.throws(() => validarApresentacaoGarantia({ ...apresentacao, validaAte: '2026-11-01' }), comCodigo('GARANTIA_INVALIDA'));
  });

  it('fora do prazo e validade que não cobre a vigência geram avisos (art. 97)', () => {
    const r = validarApresentacaoGarantia({ ...apresentacao, apresentadaEm: HOJE, prazoApresentacao: '2026-11-06', validaAte: '2027-06-30' });
    assert.equal(r.avisos.length, 2);
    assert.ok(r.avisos.some((a) => /art\. 97/.test(a)));
  });

  it('situação: vence em breve, vencida, apresentação vencida e recomposição', () => {
    const base = { situacaoRegistro: 'vigente' as const, prazoApresentacao: null, vigenciaFimContrato: '2026-12-31', saldo: 100, valorExigido: 100, hoje: HOJE };
    assert.equal(situacaoGarantia({ ...base, validaAte: '2026-11-29' }).situacao, 'vence_em_breve');
    assert.equal(situacaoGarantia({ ...base, validaAte: '2026-11-01' }).situacao, 'vencida');
    assert.equal(situacaoGarantia({ ...base, validaAte: '2027-03-01' }).situacao, 'vigente');
    assert.equal(situacaoGarantia({ ...base, situacaoRegistro: 'aguardando_apresentacao', validaAte: null, prazoApresentacao: '2026-11-01' }).situacao, 'apresentacao_vencida');
    assert.ok(situacaoGarantia({ ...base, validaAte: '2027-03-01', saldo: 50 }).alertas.some((a) => /recomposição/.test(a)));
  });
});

describe('liberação, execução e caução em dinheiro (arts. 100 e 139)', () => {
  it('liberação só depois da fiel execução e sem multa pendente', () => {
    const ok = avaliarLiberacaoGarantia({ situacaoRegistro: 'vigente', vigenciaEncerrada: true, recebimentosPendentes: 0, ocorrenciasAbertas: 0, saldoMultasPendentes: 0, extincaoCulpaAdministracao: false });
    assert.equal(ok.permitido, true);
    assert.match(ok.fundamento, /art\. 100/);
    const negado = avaliarLiberacaoGarantia({ situacaoRegistro: 'vigente', vigenciaEncerrada: false, recebimentosPendentes: 2, ocorrenciasAbertas: 1, saldoMultasPendentes: 500, extincaoCulpaAdministracao: false });
    assert.equal(negado.motivos.length, 4);
    const culpaAdministracao = avaliarLiberacaoGarantia({ situacaoRegistro: 'vigente', vigenciaEncerrada: false, recebimentosPendentes: 2, ocorrenciasAbertas: 0, saldoMultasPendentes: 0, extincaoCulpaAdministracao: true });
    assert.equal(culpaAdministracao.permitido, true);
  });

  it('caução em dinheiro restituída com atualização', () => {
    const r = atualizarCaucaoDinheiro({ saldo: 1_000_000, depositadaEm: '2026-10-01', restituidaEm: '2026-11-01', variacoes: [{ competencia: '2026-10', percentual: 1 }] });
    assert.equal(r.valorRestituido, 1_010_000);
  });

  it('execução limitada ao saldo; retomada só no seguro-garantia com cláusula', () => {
    assert.equal(avaliarExecucaoGarantia({ situacaoRegistro: 'vigente', modalidade: 'fianca_bancaria', clausulaRetomada: false, saldo: 1000, valor: 400, motivo: 'verbas_trabalhistas' }).saldoFinal, 600);
    assert.throws(() => avaliarExecucaoGarantia({ situacaoRegistro: 'vigente', modalidade: 'fianca_bancaria', clausulaRetomada: false, saldo: 1000, valor: 1400, motivo: 'ressarcimento_prejuizos' }), comCodigo('GARANTIA_INSUFICIENTE'));
    assert.throws(() => avaliarExecucaoGarantia({ situacaoRegistro: 'vigente', modalidade: 'fianca_bancaria', clausulaRetomada: false, saldo: 1000, valor: 100, motivo: 'retomada_seguradora' }), comCodigo('GARANTIA_INVALIDA'));
    assert.throws(() => avaliarExecucaoGarantia({ situacaoRegistro: 'liberada', modalidade: 'fianca_bancaria', clausulaRetomada: false, saldo: 1000, valor: 100, motivo: 'verbas_trabalhistas' }), comCodigo('GARANTIA_INDISPONIVEL'));
  });
});

describe('planejarDescontoMulta (art. 156, § 8º)', () => {
  it('primeiro os pagamentos devidos, depois a garantia, o resto para cobrança judicial', () => {
    const r = planejarDescontoMulta({ saldoMulta: 10_000, pagamentosDevidos: [{ id: 'a', disponivel: 3_000 }, { id: 'b', disponivel: 2_000 }], saldoGarantia: 4_000 });
    assert.deepEqual(r.pagamentos, [{ id: 'a', valor: 3_000 }, { id: 'b', valor: 2_000 }]);
    assert.equal(r.garantia, 4_000);
    assert.equal(r.remanescente, 1_000);
    assert.match(r.fundamento, /art\. 156, § 8º/);
  });

  it('sem pagamento devido, tudo da garantia até o saldo; valor decidido menor que a multa', () => {
    const r = planejarDescontoMulta({ saldoMulta: 10_000, pagamentosDevidos: [], saldoGarantia: 6_000, valorDecidido: 5_000 });
    assert.equal(r.garantia, 5_000);
    assert.equal(r.remanescente, 0);
  });

  it('valor acima do saldo da multa ou multa quitada → DESCONTO_MULTA_INVALIDO', () => {
    assert.throws(() => planejarDescontoMulta({ saldoMulta: 100, pagamentosDevidos: [], saldoGarantia: 0, valorDecidido: 200 }), comCodigo('DESCONTO_MULTA_INVALIDO'));
    assert.throws(() => planejarDescontoMulta({ saldoMulta: 0, pagamentosDevidos: [], saldoGarantia: 0 }), comCodigo('DESCONTO_MULTA_INVALIDO'));
  });
});
