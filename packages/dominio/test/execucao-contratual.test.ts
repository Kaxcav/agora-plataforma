import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  avaliarTermoRecebimento,
  calcularAtualizacaoMonetaria,
  calcularGarantiaObjeto,
  calcularPrazoPagamento,
  classificarPreteridosComAlteracoes,
  corrigirPorIndice,
  prazoRecebimentoProvisorio,
  situacaoPrazoExecucao,
  validarAlteracaoOrdemCronologica,
  validarDecisaoAutoridade,
  validarOcorrencia,
  verificarDesignacoesContrato,
  type ParametrosRecebimento,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09'; // segunda-feira
const PARAMETROS: ParametrosRecebimento = { prazoProvisorioDiasUteis: 5, prazoDefinitivoDiasUteis: 10, prazoCorrecaoDiasUteis: 7 };
const RELATO = 'Entrega parcial dos equipamentos sem o manual em português exigido pelo termo de referência.';

describe('verificarDesignacoesContrato (art. 117 e art. 7º, § 1º)', () => {
  it('equipe completa sem conflito', () => {
    const r = verificarDesignacoesContrato([
      { papel: 'gestor', usuarioId: 'u1', nome: 'Gestora' },
      { papel: 'fiscal_tecnico', usuarioId: 'u2', nome: 'Fiscal técnico' },
      { papel: 'fiscal_administrativo', usuarioId: 'u3', nome: 'Fiscal administrativo' },
      { papel: 'fiscal_requisitante', usuarioId: 'u4', nome: 'Fiscal requisitante' },
    ]);
    assert.deepEqual(r.conflitos, []);
    assert.deepEqual(r.faltantes, []);
    assert.equal(r.completa, true);
    assert.equal(r.temFiscal, true);
    assert.match(r.fundamento, /art\. 117/);
  });

  it('gestor e fiscal técnico na mesma pessoa é conflito; faltantes listados', () => {
    const r = verificarDesignacoesContrato([
      { papel: 'gestor', usuarioId: 'u1', nome: 'Pessoa' },
      { papel: 'fiscal_tecnico', usuarioId: 'u1', nome: 'Pessoa' },
    ]);
    assert.equal(r.conflitos.length, 1);
    assert.deepEqual(r.conflitos[0]?.papeis, ['gestor', 'fiscal_tecnico']);
    assert.match(r.conflitos[0]?.fundamento ?? '', /art\. 7º, § 1º/);
    assert.deepEqual(r.faltantes, ['fiscal_administrativo', 'fiscal_requisitante']);
    assert.equal(r.completa, false);
  });

  it('substituto não conta como titular; sem fiscal → temFiscal false', () => {
    const r = verificarDesignacoesContrato([
      { papel: 'gestor', usuarioId: 'u1', nome: 'G' },
      { papel: 'fiscal_tecnico', usuarioId: 'u2', nome: 'S', substituto: true },
    ]);
    assert.equal(r.temFiscal, false);
    assert.ok(r.faltantes.includes('fiscal_tecnico'));
  });

  it('papel desconhecido → DESIGNACAO_INVALIDA', () => {
    assert.throws(() => verificarDesignacoesContrato([{ papel: 'pregoeiro' as never, usuarioId: 'u', nome: 'x' }]), comCodigo('DESIGNACAO_INVALIDA'));
  });
});

describe('validarOcorrencia (art. 117, § 1º)', () => {
  it('com prazo de regularização exige notificação', () => {
    const r = validarOcorrencia({ tipo: 'falha_execucao', dataFato: '2026-11-06', relato: RELATO, prazoRegularizacao: '2026-11-20', hoje: HOJE });
    assert.equal(r.exigeNotificacao, true);
    assert.match(r.fundamento, /art\. 117, § 1º/);
  });

  it('sem prazo não exige; fato futuro, relato curto e prazo passado são recusados', () => {
    assert.equal(validarOcorrencia({ tipo: 'comunicacao', dataFato: HOJE, relato: RELATO, prazoRegularizacao: null, hoje: HOJE }).exigeNotificacao, false);
    assert.throws(() => validarOcorrencia({ tipo: 'atraso', dataFato: '2026-11-10', relato: RELATO, prazoRegularizacao: null, hoje: HOJE }), comCodigo('OCORRENCIA_INVALIDA'));
    assert.throws(() => validarOcorrencia({ tipo: 'atraso', dataFato: HOJE, relato: 'curto', prazoRegularizacao: null, hoje: HOJE }), comCodigo('OCORRENCIA_INVALIDA'));
    assert.throws(() => validarOcorrencia({ tipo: 'atraso', dataFato: HOJE, relato: RELATO, prazoRegularizacao: '2026-11-01', hoje: HOJE }), comCodigo('OCORRENCIA_INVALIDA'));
  });
});

describe('recebimento provisório e definitivo (RN-34, art. 140)', () => {
  const base = {
    data: HOJE,
    hoje: HOJE,
    entregueEm: '2026-11-03',
    observacoes: '',
    responsavelProvisorioId: null,
    limiteTermo: null,
    parametros: PARAMETROS,
  } as const;

  it('prazo do provisório em dias úteis a partir da entrega (art. 140, § 3º)', () => {
    // 03/11/2026 (terça) + 5 dias úteis, sem feriado no meio → 10/11/2026
    assert.equal(prazoRecebimentoProvisorio('2026-11-03', PARAMETROS).limite, '2026-11-10');
  });

  it('provisório aceito pelo fiscal → aguarda definitivo, com prazo; não libera liquidação', () => {
    const r = avaliarTermoRecebimento({
      ...base,
      situacao: 'aguardando_provisorio',
      etapaCorrecao: null,
      tipo: 'provisorio',
      resultado: 'aceito',
      responsavel: { usuarioId: 'fiscal', papeis: ['fiscal_tecnico'] },
    });
    assert.equal(r.novaSituacao, 'aguardando_definitivo');
    assert.equal(r.liberaLiquidacao, false);
    assert.equal(r.proximoPrazo, '2026-11-24'); // 09/11 + 10 dias úteis (20/11 é feriado nacional da Consciência Negra)
    assert.match(r.fundamento, /art\. 140, I, "a"/);
  });

  it('definitivo aceito pelo gestor → recebido e libera a liquidação', () => {
    const r = avaliarTermoRecebimento({
      ...base,
      situacao: 'aguardando_definitivo',
      etapaCorrecao: null,
      tipo: 'definitivo',
      resultado: 'aceito',
      responsavel: { usuarioId: 'gestor', papeis: ['gestor'] },
      responsavelProvisorioId: 'fiscal',
    });
    assert.equal(r.novaSituacao, 'recebido');
    assert.equal(r.liberaLiquidacao, true);
    assert.match(r.fundamento, /Lei 4\.320\/1964, art\. 63/);
  });

  it('definitivo antes do provisório → RECEBIMENTO_TRANSICAO_INVALIDA', () => {
    assert.throws(
      () =>
        avaliarTermoRecebimento({
          ...base,
          situacao: 'aguardando_provisorio',
          etapaCorrecao: null,
          tipo: 'definitivo',
          resultado: 'aceito',
          responsavel: { usuarioId: 'gestor', papeis: ['gestor'] },
        }),
      comCodigo('RECEBIMENTO_TRANSICAO_INVALIDA'),
    );
  });

  it('definitivo por quem lavrou o provisório → RECEBIMENTO_SEGREGACAO', () => {
    assert.throws(
      () =>
        avaliarTermoRecebimento({
          ...base,
          situacao: 'aguardando_definitivo',
          etapaCorrecao: null,
          tipo: 'definitivo',
          resultado: 'aceito',
          responsavel: { usuarioId: 'gestor', papeis: ['gestor'] },
          responsavelProvisorioId: 'gestor',
        }),
      comCodigo('RECEBIMENTO_SEGREGACAO'),
    );
  });

  it('definitivo por fiscal sem comissão, ou provisório por quem não fiscaliza → RECEBIMENTO_RESPONSAVEL_INVALIDO', () => {
    assert.throws(
      () =>
        avaliarTermoRecebimento({
          ...base,
          situacao: 'aguardando_definitivo',
          etapaCorrecao: null,
          tipo: 'definitivo',
          resultado: 'aceito',
          responsavel: { usuarioId: 'f2', papeis: ['fiscal_administrativo'] },
        }),
      comCodigo('RECEBIMENTO_RESPONSAVEL_INVALIDO'),
    );
    assert.throws(
      () =>
        avaliarTermoRecebimento({
          ...base,
          situacao: 'aguardando_provisorio',
          etapaCorrecao: null,
          tipo: 'provisorio',
          resultado: 'aceito',
          responsavel: { usuarioId: 'c1', papeis: ['comissao_recebimento'] },
        }),
      comCodigo('RECEBIMENTO_RESPONSAVEL_INVALIDO'),
    );
  });

  it('ressalva sem descrição é recusada; com descrição abre prazo de correção e refaz o mesmo exame', () => {
    const entrada = {
      ...base,
      situacao: 'aguardando_provisorio' as const,
      etapaCorrecao: null,
      tipo: 'provisorio' as const,
      resultado: 'com_ressalva' as const,
      responsavel: { usuarioId: 'fiscal', papeis: ['fiscal_tecnico' as const] },
    };
    assert.throws(() => avaliarTermoRecebimento(entrada), comCodigo('RECEBIMENTO_SEM_MOTIVO'));
    const r = avaliarTermoRecebimento({ ...entrada, observacoes: RELATO });
    assert.equal(r.novaSituacao, 'em_correcao');
    assert.equal(r.etapaCorrecao, 'provisorio');
    assert.equal(r.prazoCorrecao, '2026-11-18'); // 09/11 + 7 dias úteis
    assert.equal(r.proximoPrazo, '2026-11-26'); // 18/11 + 5 dias úteis (20/11 feriado)
    assert.ok(r.avisos.some((a) => /art\. 119/.test(a)));
    // na correção, o próximo termo é de novo o provisório
    const novo = avaliarTermoRecebimento({ ...entrada, situacao: 'em_correcao', etapaCorrecao: 'provisorio', resultado: 'aceito' });
    assert.equal(novo.novaSituacao, 'aguardando_definitivo');
  });

  it('rejeição no definitivo volta para correção do definitivo; termo fora do prazo gera aviso', () => {
    const r = avaliarTermoRecebimento({
      ...base,
      situacao: 'aguardando_definitivo',
      etapaCorrecao: null,
      tipo: 'definitivo',
      resultado: 'rejeitado',
      observacoes: RELATO,
      responsavel: { usuarioId: 'c1', papeis: ['comissao_recebimento'] },
      responsavelProvisorioId: 'fiscal',
      limiteTermo: '2026-11-06',
    });
    assert.equal(r.etapaCorrecao, 'definitivo');
    assert.equal(r.foraDoPrazo, true);
    assert.ok(r.avisos.some((a) => /depois do prazo/.test(a)));
    assert.ok(r.avisos.some((a) => /rejeitado/.test(a)));
  });

  it('recebido não aceita novo termo; data futura ou anterior à entrega é recusada', () => {
    const entrada = {
      ...base,
      situacao: 'recebido' as const,
      etapaCorrecao: null,
      tipo: 'definitivo' as const,
      resultado: 'aceito' as const,
      responsavel: { usuarioId: 'g', papeis: ['gestor' as const] },
    };
    assert.throws(() => avaliarTermoRecebimento(entrada), comCodigo('RECEBIMENTO_CONCLUIDO'));
    const provisorio = { ...entrada, situacao: 'aguardando_provisorio' as const, tipo: 'provisorio' as const };
    assert.throws(() => avaliarTermoRecebimento({ ...provisorio, data: '2026-11-10' }), comCodigo('RECEBIMENTO_INVALIDO'));
    assert.throws(() => avaliarTermoRecebimento({ ...provisorio, data: '2026-11-02' }), comCodigo('RECEBIMENTO_INVALIDO'));
  });

  it('garantia técnica do objeto contada do definitivo; situação do prazo', () => {
    assert.equal(calcularGarantiaObjeto('2026-11-09', 12).ate, '2027-11-09');
    assert.equal(calcularGarantiaObjeto('2026-11-09', 0).ate, null);
    assert.deepEqual(situacaoPrazoExecucao('2026-11-12', HOJE), { situacao: 'no_prazo', dias: 3 });
    assert.deepEqual(situacaoPrazoExecucao(HOJE, HOJE), { situacao: 'vence_hoje', dias: 0 });
    assert.equal(situacaoPrazoExecucao('2026-11-01', HOJE).situacao, 'vencido');
  });
});

describe('prazo de pagamento (art. 92, VI)', () => {
  const parametros = { prazoLiquidacaoDiasUteis: 5, prazoPagamentoDias: 20, marcoPagamento: 'recebimento_definitivo' as const };

  it('sem recebimento definitivo → aguardando o marco', () => {
    const r = calcularPrazoPagamento({ parametros, recebimentoDefinitivoEm: null, liquidadoEm: null, pagoEm: null, hoje: HOJE });
    assert.equal(r.situacao, 'aguardando_marco');
    assert.equal(r.limitePagamento, null);
  });

  it('contado do definitivo, em dias corridos com prorrogação para dia útil (art. 183)', () => {
    // 10/10/2026 + 20 dias = 30/10/2026 (sexta)
    const r = calcularPrazoPagamento({ parametros, recebimentoDefinitivoEm: '2026-10-10', liquidadoEm: null, pagoEm: null, hoje: HOJE });
    assert.equal(r.limitePagamento, '2026-10-30');
    assert.equal(r.situacao, 'vencido');
    assert.equal(r.diasAtraso, 10);
    assert.equal(r.liquidacaoAtrasada, true);
    // 11/10 + 20 = 31/10 (sábado) → 03/11 (02/11 é feriado de Finados)
    assert.equal(calcularPrazoPagamento({ parametros, recebimentoDefinitivoEm: '2026-10-11', liquidadoEm: null, pagoEm: null, hoje: HOJE }).limitePagamento, '2026-11-03');
  });

  it('contado da liquidação; pago no prazo e com atraso', () => {
    const pelaLiquidacao = { ...parametros, marcoPagamento: 'liquidacao' as const };
    const noPrazo = calcularPrazoPagamento({ parametros: pelaLiquidacao, recebimentoDefinitivoEm: '2026-10-01', liquidadoEm: '2026-10-05', pagoEm: '2026-10-20', hoje: HOJE });
    assert.equal(noPrazo.situacao, 'pago_no_prazo');
    const atrasado = calcularPrazoPagamento({ parametros: pelaLiquidacao, recebimentoDefinitivoEm: '2026-10-01', liquidadoEm: '2026-10-05', pagoEm: '2026-10-30', hoje: HOJE });
    assert.equal(atrasado.limitePagamento, '2026-10-26');
    assert.equal(atrasado.situacao, 'pago_com_atraso');
    assert.equal(atrasado.diasAtraso, 4);
  });

  it('parâmetros inválidos → PARAMETROS_EXECUCAO_INVALIDOS', () => {
    assert.throws(
      () => calcularPrazoPagamento({ parametros: { ...parametros, prazoPagamentoDias: 0 }, recebimentoDefinitivoEm: null, liquidadoEm: null, pagoEm: null, hoje: HOJE }),
      comCodigo('PARAMETROS_EXECUCAO_INVALIDOS'),
    );
  });
});

describe('atualização monetária (art. 92, V)', () => {
  const variacoes = [
    { competencia: '2026-09', percentual: 0.3 },
    { competencia: '2026-10', percentual: 0.62 },
  ];

  it('correção pro rata die composta por mês', () => {
    // 16/09 a 16/10: 15/30 de setembro (0,3%) e 15/31 de outubro (0,62%)
    const r = corrigirPorIndice({ valor: 1_000_000, de: '2026-09-16', ate: '2026-10-16', variacoes });
    const esperado = (1.003 ** (15 / 30)) * (1.0062 ** (15 / 31));
    assert.equal(r.valorCorrigido, Math.round(1_000_000 * esperado));
    assert.deepEqual(r.competenciasSemIndice, []);
    const semIndice = corrigirPorIndice({ valor: 1_000_000, de: '2026-10-20', ate: '2026-11-05', variacoes });
    assert.deepEqual(semIndice.competenciasSemIndice, ['2026-11']);
  });

  it('pagamento no prazo → não devida', () => {
    const r = calcularAtualizacaoMonetaria({ valor: 1_000_000, adimplementoEm: '2026-10-01', limitePagamento: '2026-10-31', pagamentoEm: '2026-10-30', indice: 'IPCA', variacoes, jurosMensalPercentual: 0.5 });
    assert.equal(r.devida, false);
    assert.equal(r.valorTotal, 1_000_000);
  });

  it('atraso → correção desde o adimplemento e juros simples pro rata die', () => {
    const r = calcularAtualizacaoMonetaria({ valor: 1_000_000, adimplementoEm: '2026-10-01', limitePagamento: '2026-10-16', pagamentoEm: '2026-10-31', indice: 'IPCA', variacoes, jurosMensalPercentual: 0.5 });
    assert.equal(r.devida, true);
    assert.equal(r.diasAtraso, 15);
    assert.equal(r.diasAtualizacao, 30);
    assert.equal(r.valorJuros, 5_000); // 0,5% × 30/30 sobre R$ 10.000,00
    assert.equal(r.valorCorrecao, Math.round(1_000_000 * 1.0062 ** (30 / 31)) - 1_000_000);
    assert.equal(r.valorTotal, 1_000_000 + r.valorCorrecao + r.valorJuros);
    assert.match(r.fundamento, /art\. 92, V/);
    assert.match(r.aviso, /requer revisão humana/);
  });

  it('juros fora de 0 a 2% e limite anterior ao adimplemento → ATUALIZACAO_INVALIDA', () => {
    const e = { valor: 1, adimplementoEm: '2026-10-01', limitePagamento: '2026-10-16', pagamentoEm: '2026-10-31', indice: 'IPCA', variacoes };
    assert.throws(() => calcularAtualizacaoMonetaria({ ...e, jurosMensalPercentual: 3 }), comCodigo('ATUALIZACAO_INVALIDA'));
    assert.throws(() => calcularAtualizacaoMonetaria({ ...e, limitePagamento: '2026-09-01', jurosMensalPercentual: 0 }), comCodigo('ATUALIZACAO_INVALIDA'));
  });
});

describe('alteração justificada da ordem cronológica (art. 141, § 1º)', () => {
  const justificativa =
    'Pagamento a microempresa com risco demonstrado de descontinuidade do serviço essencial, conforme nota técnica juntada ao processo.';
  const entrada = { inciso: 'II', justificativa, autoridade: 'Ordenadora de despesas — Coordenação-Geral', ato: 'Despacho SEI 123', decididaEm: HOJE, hoje: HOJE, pagoEm: null, exigivel: true };

  it('hipótese válida, com comunicações exigidas e aviso de risco de descontinuidade', () => {
    const r = validarAlteracaoOrdemCronologica(entrada);
    assert.equal(r.inciso, 'II');
    assert.deepEqual(r.comunicacoesExigidas, ['controle_interno', 'tribunal_contas']);
    assert.ok(r.avisos.some((a) => /descontinuidade/.test(a)));
    assert.match(r.fundamento, /art\. 141, § 1º, II/);
  });

  it('inciso fora do rol, decisão posterior ao pagamento e parcela não exigível são recusados', () => {
    assert.throws(() => validarAlteracaoOrdemCronologica({ ...entrada, inciso: 'VI' }), comCodigo('ALTERACAO_ORDEM_HIPOTESE_INVALIDA'));
    assert.throws(() => validarAlteracaoOrdemCronologica({ ...entrada, pagoEm: '2026-11-05' }), comCodigo('ALTERACAO_ORDEM_NAO_PREVIA'));
    assert.throws(() => validarAlteracaoOrdemCronologica({ ...entrada, exigivel: false }), comCodigo('ALTERACAO_ORDEM_NAO_EXIGIVEL'));
    assert.throws(() => validarAlteracaoOrdemCronologica({ ...entrada, justificativa: 'curta' }), comCodigo('DECISAO_INVALIDA'));
  });

  it('validarDecisaoAutoridade exige autoridade, ato e data não futura', () => {
    assert.throws(() => validarDecisaoAutoridade({ autoridade: 'x', ato: 'Despacho 1', justificativa, decididaEm: HOJE, hoje: HOJE }), comCodigo('DECISAO_INVALIDA'));
    assert.throws(() => validarDecisaoAutoridade({ autoridade: 'Autoridade', ato: '', justificativa, decididaEm: HOJE, hoje: HOJE }), comCodigo('DECISAO_INVALIDA'));
    assert.throws(() => validarDecisaoAutoridade({ autoridade: 'Autoridade', ato: 'Despacho 1', justificativa, decididaEm: '2026-11-10', hoje: HOJE }), comCodigo('DECISAO_INVALIDA'));
  });

  it('preterido com alteração registrada e comunicada deixa de ser achado de risco', () => {
    const pagamentos = [
      { id: 'q', fonteRecurso: '1000', vencimento: '2026-10-01', pagoEm: null, exigivel: true },
      { id: 'p', fonteRecurso: '1000', vencimento: '2026-10-10', pagoEm: '2026-10-12', exigivel: true },
    ];
    assert.equal(classificarPreteridosComAlteracoes(pagamentos, [], HOJE)[0]?.situacao, 'sem_justificativa');
    const pendente = classificarPreteridosComAlteracoes(pagamentos, [{ id: 'a', pagamentoId: 'p', comunicadaControleInterno: true, comunicadaTribunal: false }], HOJE);
    assert.equal(pendente[0]?.situacao, 'comunicacao_pendente');
    const justificado = classificarPreteridosComAlteracoes(pagamentos, [{ id: 'a', pagamentoId: 'p', comunicadaControleInterno: true, comunicadaTribunal: true }], HOJE);
    assert.equal(justificado[0]?.situacao, 'justificado');
    assert.deepEqual(justificado[0]?.alteracoes, ['a']);
  });
});
