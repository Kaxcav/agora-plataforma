import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliarSelecao,
  ErroDominio,
  prazoProvaConceito,
  prazosRecursoSelecao,
  validarAtoSelecao,
  validarInversaoFases,
  validarProvaConceito,
  type EstadoSelecao,
  type FaseRecursalRegistrada,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

// Novembro de 2026: 9 é segunda-feira; 15 (domingo) e 20 (sexta, Consciência Negra) são feriados nacionais.
const A = 'licitante-a';
const B = 'licitante-b';
const C = 'licitante-c';

function estado(mudanca: Partial<EstadoSelecao> = {}): EstadoSelecao {
  return {
    classificacao: [A, B, C],
    dataJulgamento: '2026-11-09',
    sorteioPendente: false,
    provaConceito: { exigida: true, prazoDiasUteis: 5 },
    inversaoFases: false,
    convocacoes: [],
    habilitacoes: [],
    recursos: [],
    adjudicacao: null,
    homologacao: null,
    ...mudanca,
  };
}

function recurso(mudanca: Partial<FaseRecursalRegistrada> = {}): FaseRecursalRegistrada {
  return {
    vencedorId: B,
    dataAto: '2026-11-10',
    intencoes: [{ fornecedorId: A, data: '2026-11-10' }],
    intencaoEncerradaEm: '2026-11-10',
    razoes: [],
    contrarrazoes: [],
    reconsideracao: null,
    decisaoSuperior: null,
    ...mudanca,
  };
}

/** B aprovado na prova (A reprovado) e habilitado em 10/11/2026. */
const B_HABILITADO: Partial<EstadoSelecao> = {
  convocacoes: [
    { fornecedorId: A, convocadoEm: '2026-11-09', resultado: 'reprovado', realizadaEm: '2026-11-09' },
    { fornecedorId: B, convocadoEm: '2026-11-09', resultado: 'aprovado', realizadaEm: '2026-11-10' },
  ],
  habilitacoes: [{ fornecedorId: B, resultado: 'habilitado', data: '2026-11-10' }],
};

describe('prazos dos atos da seleção (art. 183)', () => {
  it('prazoProvaConceito: 5 dias úteis da convocação de sexta, 13/11/2026, saltam o feriado de 20/11 → 23/11/2026', () => {
    assert.equal(prazoProvaConceito('2026-11-13', 5).limite, '2026-11-23');
    assert.match(prazoProvaConceito('2026-11-13', 5).fundamento, /art\. 17, § 3º/);
  });

  it('prazoProvaConceito rejeita prazo fora de 1 a 30 dias úteis', () => {
    for (const prazo of [0, 31, 2.5]) assert.throws(() => prazoProvaConceito('2026-11-09', prazo), comCodigo('PROVA_CONCEITO_INVALIDA'), String(prazo));
  });

  it('prazosRecursoSelecao: ato em 09/11/2026 → razões 12/11, contrarrazões 17/11, reconsideração 23/11 (salta 20/11)', () => {
    const p = prazosRecursoSelecao('2026-11-09', null);
    assert.equal(p.razoes, '2026-11-12');
    assert.equal(p.contrarrazoes, '2026-11-17');
    assert.equal(p.reconsideracao, '2026-11-23');
    assert.equal(p.decisaoSuperior, null);
    assert.match(p.fundamento, /art\. 165/);
  });

  it('prazosRecursoSelecao: decisão superior em 10 dias úteis do encaminhamento (23/11 → 07/12/2026)', () => {
    assert.equal(prazosRecursoSelecao('2026-11-09', '2026-11-23').decisaoSuperior, '2026-12-07');
  });

  it('prazosRecursoSelecao considera os feriados locais do órgão', () => {
    assert.equal(prazosRecursoSelecao('2026-11-09', null, { feriadosExtras: ['2026-11-11'] }).razoes, '2026-11-13');
  });
});

describe('validarProvaConceito e validarInversaoFases', () => {
  it('sem exigência: completa e sem pendências', () => {
    const r = validarProvaConceito({ exigencia: 'nenhuma', roteiro: null, justificativa: null, prazoDiasUteis: null });
    assert.equal(r.exigida, false);
    assert.equal(r.completa, true);
    assert.deepEqual(r.pendencias, []);
  });

  it('amostra sem roteiro, sem justificativa e com prazo inválido: três pendências', () => {
    const r = validarProvaConceito({ exigencia: 'amostra', roteiro: 'curto', justificativa: null, prazoDiasUteis: 0 });
    assert.equal(r.exigida, true);
    assert.deepEqual(
      r.pendencias.map((p) => p.campo),
      ['roteiro', 'justificativa', 'prazoDiasUteis'],
    );
    assert.match(r.fundamento, /art\. 41, II/);
  });

  it('prova de conceito completa', () => {
    const r = validarProvaConceito({
      exigencia: 'prova_conceito',
      roteiro: 'Roteiro de testes com cinco cenários e critério objetivo de aprovação por cenário.',
      justificativa: 'A solução tem requisitos técnicos que só se verificam em demonstração prática.',
      prazoDiasUteis: 5,
    });
    assert.equal(r.completa, true);
  });

  it('exigência desconhecida → PROVA_CONCEITO_INVALIDA', () => {
    assert.throws(
      () => validarProvaConceito({ exigencia: 'teste' as never, roteiro: null, justificativa: null, prazoDiasUteis: null }),
      comCodigo('PROVA_CONCEITO_INVALIDA'),
    );
  });

  it('inversão de fases exige motivação', () => {
    assert.equal(validarInversaoFases({ adotada: true, motivacao: 'curta' }).pendencias.length, 1);
    assert.deepEqual(validarInversaoFases({ adotada: true, motivacao: 'Habilitação prévia reduz o tempo de análise de propostas inexequíveis.' }).pendencias, []);
    assert.deepEqual(validarInversaoFases({ adotada: false, motivacao: null }).pendencias, []);
  });
});

describe('avaliarSelecao — julgamento e prova de conceito (RN-20)', () => {
  it('sem disputa registrada → registrar_disputa (RN-08)', () => {
    const r = avaliarSelecao(estado({ classificacao: [], dataJulgamento: null }), '2026-11-09');
    assert.equal(r.proximoAto, 'registrar_disputa');
    assert.equal(r.pendencia?.regra, 'RN-08');
    assert.equal(r.vencedorProvisorio, null);
  });

  it('empate pendente de sorteio → registrar_disputa', () => {
    assert.equal(avaliarSelecao(estado({ sorteioPendente: true }), '2026-11-09').pendencia?.regra, 'RN-08');
  });

  it('prova exigida e não convocada → convocar o primeiro classificado, sem convocação automática', () => {
    const r = avaliarSelecao(estado(), '2026-11-09');
    assert.equal(r.proximoAto, 'convocar_prova_conceito');
    assert.equal(r.vencedorProvisorio, A);
    assert.equal(r.convocacaoAutomatica, false);
    assert.equal(r.pendencia?.regra, 'RN-20');
  });

  it('convocado em 09/11 com prazo de 5 dias úteis → resultado pendente até 16/11; depois, prazo vencido vira alerta', () => {
    const e = estado({ convocacoes: [{ fornecedorId: A, convocadoEm: '2026-11-09', resultado: null, realizadaEm: null }] });
    const dentro = avaliarSelecao(e, '2026-11-10');
    assert.equal(dentro.proximoAto, 'registrar_resultado_prova_conceito');
    assert.equal(dentro.convocacaoAtual?.limite, '2026-11-16');
    assert.equal(dentro.convocacaoAtual?.vencida, false);
    assert.deepEqual(dentro.alertas, []);
    const fora = avaliarSelecao(e, '2026-11-17');
    assert.equal(fora.convocacaoAtual?.vencida, true);
    assert.equal(fora.alertas[0]?.regra, 'RN-20');
  });

  it('reprovado o primeiro, o próximo colocado é o vencedor provisório e deve ser convocado automaticamente', () => {
    const r = avaliarSelecao(estado({ convocacoes: [{ fornecedorId: A, convocadoEm: '2026-11-09', resultado: 'reprovado', realizadaEm: '2026-11-09' }] }), '2026-11-09');
    assert.equal(r.vencedorProvisorio, B);
    assert.equal(r.proximoAto, 'convocar_prova_conceito');
    assert.equal(r.convocacaoAutomatica, true);
    assert.deepEqual(r.excluidos, [{ fornecedorId: A, motivo: 'prova_conceito' }]);
  });

  it('aprovado → habilitação pendente (RN-22); convocar de novo é ato fora de ordem', () => {
    const e = estado({ convocacoes: [{ fornecedorId: A, convocadoEm: '2026-11-09', resultado: 'aprovado', realizadaEm: '2026-11-10' }] });
    const r = avaliarSelecao(e, '2026-11-10');
    assert.equal(r.proximoAto, 'registrar_habilitacao');
    assert.equal(r.pendencia?.regra, 'RN-22');
    assert.throws(() => validarAtoSelecao(e, { tipo: 'convocar_prova_conceito' }, '2026-11-10'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
    assert.doesNotThrow(() => validarAtoSelecao(e, { tipo: 'registrar_habilitacao', resultado: 'habilitado' }, '2026-11-10'));
  });

  it('inabilitação é possível antes da prova (ex.: sanção impeditiva); habilitação não', () => {
    const e = estado();
    assert.doesNotThrow(() => validarAtoSelecao(e, { tipo: 'registrar_habilitacao', resultado: 'inabilitado' }, '2026-11-09'));
    assert.throws(() => validarAtoSelecao(e, { tipo: 'registrar_habilitacao', resultado: 'habilitado' }, '2026-11-09'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
  });

  it('sem prova exigida, o primeiro classificado vai direto à habilitação', () => {
    assert.equal(avaliarSelecao(estado({ provaConceito: { exigida: false, prazoDiasUteis: null } }), '2026-11-09').proximoAto, 'registrar_habilitacao');
  });

  it('todos reprovados ou inabilitados → licitação fracassada', () => {
    const r = avaliarSelecao(
      estado({
        provaConceito: { exigida: false, prazoDiasUteis: null },
        habilitacoes: [A, B, C].map((fornecedorId) => ({ fornecedorId, resultado: 'inabilitado' as const, data: '2026-11-10' })),
      }),
      '2026-11-10',
    );
    assert.equal(r.proximoAto, 'fracassada');
    assert.equal(r.vencedorProvisorio, null);
    assert.equal(r.excluidos.length, 3);
  });
});

describe('avaliarSelecao — fase recursal única (RN-22) e atos da autoridade (RF-18)', () => {
  it('habilitado em 10/11: no mesmo dia, intenção de recorrer em aberto, com os prazos calculados', () => {
    const r = avaliarSelecao(estado(B_HABILITADO), '2026-11-10');
    assert.equal(r.vencedorProvisorio, B);
    assert.equal(r.proximoAto, 'registrar_intencao_recurso');
    assert.equal(r.faseRecursal?.atoRecorrivel, 'habilitacao');
    assert.equal(r.faseRecursal?.dataAto, '2026-11-10');
    assert.equal(r.faseRecursal?.prazos.razoes, '2026-11-13');
  });

  it('sem intenção até o fim do dia do ato → preclusão e adjudicação pendente', () => {
    const r = avaliarSelecao(estado(B_HABILITADO), '2026-11-11');
    assert.equal(r.faseRecursal?.situacao, 'preclusa');
    assert.equal(r.recursosExauridos, true);
    assert.equal(r.proximoAto, 'adjudicar');
    assert.equal(r.pendencia?.regra, 'RF-18');
  });

  it('registro encerrado sem intenção no próprio dia → adjudicar no mesmo dia', () => {
    const e = estado({ ...B_HABILITADO, recursos: [recurso({ intencoes: [] })] });
    assert.equal(avaliarSelecao(e, '2026-11-10').proximoAto, 'adjudicar');
  });

  it('intenção do licitante reprovado: razões até 13/11, contrarrazões até 18/11, reconsideração até 24/11', () => {
    const comRazoes = estado({ ...B_HABILITADO, recursos: [recurso({ razoes: [{ fornecedorId: A, data: '2026-11-12' }] })] });
    assert.equal(avaliarSelecao(comRazoes, '2026-11-12').proximoAto, 'aguardar_razoes');
    const contrarrazoes = avaliarSelecao(comRazoes, '2026-11-16');
    assert.equal(contrarrazoes.proximoAto, 'aguardar_contrarrazoes');
    assert.equal(contrarrazoes.faseRecursal?.prazos.contrarrazoes, '2026-11-18');
    const reconsideracao = avaliarSelecao(comRazoes, '2026-11-19');
    assert.equal(reconsideracao.proximoAto, 'decidir_reconsideracao');
    assert.equal(reconsideracao.faseRecursal?.prazos.reconsideracao, '2026-11-24');
    assert.deepEqual(reconsideracao.alertas, []);
    assert.equal(avaliarSelecao(comRazoes, '2026-11-25').alertas[0]?.regra, 'RN-22');
  });

  it('sem razões no prazo → recurso deserto e adjudicação pendente', () => {
    const r = avaliarSelecao(estado({ ...B_HABILITADO, recursos: [recurso()] }), '2026-11-16');
    assert.equal(r.faseRecursal?.situacao, 'deserta');
    assert.equal(r.proximoAto, 'adjudicar');
  });

  it('ato mantido em 19/11 → autoridade superior decide até 04/12; improvido → adjudicar, homologar e concluir', () => {
    const mantido = recurso({
      razoes: [{ fornecedorId: A, data: '2026-11-12' }],
      reconsideracao: { decisao: 'mantida', data: '2026-11-19', efeito: null },
    });
    const decidir = avaliarSelecao(estado({ ...B_HABILITADO, recursos: [mantido] }), '2026-11-19');
    assert.equal(decidir.proximoAto, 'decidir_recurso');
    assert.equal(decidir.faseRecursal?.prazos.decisaoSuperior, '2026-12-04');
    const improvido = { ...mantido, decisaoSuperior: { decisao: 'nao_provido' as const, data: '2026-11-25', efeito: null } };
    const e = estado({ ...B_HABILITADO, recursos: [improvido] });
    assert.equal(avaliarSelecao(e, '2026-11-25').proximoAto, 'adjudicar');
    assert.equal(avaliarSelecao({ ...e, adjudicacao: { data: '2026-11-25', fornecedorId: B } }, '2026-11-25').proximoAto, 'homologar');
    const concluida = avaliarSelecao({ ...e, adjudicacao: { data: '2026-11-25', fornecedorId: B }, homologacao: { data: '2026-11-26' } }, '2026-11-26');
    assert.equal(concluida.proximoAto, 'concluida');
    assert.equal(concluida.pendencia, null);
  });

  it('recurso provido para desclassificar o vencedor → o próximo colocado é convocado automaticamente', () => {
    const provido = recurso({
      razoes: [{ fornecedorId: A, data: '2026-11-12' }],
      reconsideracao: { decisao: 'mantida', data: '2026-11-19', efeito: null },
      decisaoSuperior: { decisao: 'provido', data: '2026-11-25', efeito: { tipo: 'desclassificar_vencedor' } },
    });
    const r = avaliarSelecao(estado({ ...B_HABILITADO, recursos: [provido] }), '2026-11-25');
    assert.equal(r.vencedorProvisorio, C);
    assert.equal(r.proximoAto, 'convocar_prova_conceito');
    assert.equal(r.convocacaoAutomatica, true);
    assert.ok(r.excluidos.some((x) => x.fornecedorId === B && x.motivo === 'recurso'));
  });

  it('reconsideração que reintegra o licitante reprovado → ele volta a vencer e segue para a habilitação', () => {
    const reconsiderado = recurso({
      razoes: [{ fornecedorId: A, data: '2026-11-12' }],
      reconsideracao: { decisao: 'reconsiderada', data: '2026-11-19', efeito: { tipo: 'reintegrar_licitante', fornecedorId: A } },
    });
    const r = avaliarSelecao(estado({ ...B_HABILITADO, recursos: [reconsiderado] }), '2026-11-19');
    assert.equal(r.vencedorProvisorio, A);
    assert.deepEqual(r.reintegrados, [A]);
    assert.equal(r.proximoAto, 'registrar_habilitacao');
  });

  it('inversão de fases: habilitação antes da prova; a fase recursal segue o julgamento', () => {
    const e = estado({ inversaoFases: true });
    assert.equal(avaliarSelecao(e, '2026-11-09').proximoAto, 'registrar_habilitacao');
    const habilitado = { ...e, habilitacoes: [{ fornecedorId: A, resultado: 'habilitado' as const, data: '2026-11-09' }] };
    assert.equal(avaliarSelecao(habilitado, '2026-11-09').proximoAto, 'convocar_prova_conceito');
    const julgado = { ...habilitado, convocacoes: [{ fornecedorId: A, convocadoEm: '2026-11-10', resultado: 'aprovado' as const, realizadaEm: '2026-11-12' }] };
    const r = avaliarSelecao(julgado, '2026-11-12');
    assert.equal(r.proximoAto, 'registrar_intencao_recurso');
    assert.equal(r.faseRecursal?.atoRecorrivel, 'julgamento');
    assert.equal(r.faseRecursal?.dataAto, '2026-11-12');
  });
});

describe('validarAtoSelecao — ordem e legitimidade dos atos', () => {
  const emIntencao = estado(B_HABILITADO);

  it('intenção: do vencedor ou de quem não disputou é inválida; repetida também', () => {
    assert.throws(() => validarAtoSelecao(emIntencao, { tipo: 'registrar_intencao_recurso', fornecedorId: B }, '2026-11-10'), comCodigo('ATO_SELECAO_INVALIDO'));
    assert.throws(() => validarAtoSelecao(emIntencao, { tipo: 'registrar_intencao_recurso', fornecedorId: 'outro' }, '2026-11-10'), comCodigo('ATO_SELECAO_INVALIDO'));
    assert.doesNotThrow(() => validarAtoSelecao(emIntencao, { tipo: 'registrar_intencao_recurso', fornecedorId: C }, '2026-11-10'));
    const comIntencao = estado({ ...B_HABILITADO, recursos: [recurso({ intencaoEncerradaEm: null })] });
    assert.throws(() => validarAtoSelecao(comIntencao, { tipo: 'registrar_intencao_recurso', fornecedorId: A }, '2026-11-10'), comCodigo('ATO_SELECAO_INVALIDO'));
  });

  it('intenção depois do dia do ato → preclusão (fora de ordem)', () => {
    assert.throws(() => validarAtoSelecao(emIntencao, { tipo: 'registrar_intencao_recurso', fornecedorId: C }, '2026-11-11'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
  });

  it('razões só de quem manifestou intenção e dentro do prazo', () => {
    const e = estado({ ...B_HABILITADO, recursos: [recurso()] });
    assert.doesNotThrow(() => validarAtoSelecao(e, { tipo: 'registrar_razoes', fornecedorId: A }, '2026-11-13'));
    assert.throws(() => validarAtoSelecao(e, { tipo: 'registrar_razoes', fornecedorId: C }, '2026-11-13'), comCodigo('ATO_SELECAO_INVALIDO'));
    assert.throws(() => validarAtoSelecao(e, { tipo: 'registrar_razoes', fornecedorId: A }, '2026-11-16'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
  });

  it('contrarrazões exigem razões registradas e vêm de quem não recorreu', () => {
    const semRazoes = estado({ ...B_HABILITADO, recursos: [recurso()] });
    assert.throws(() => validarAtoSelecao(semRazoes, { tipo: 'registrar_contrarrazoes', fornecedorId: B }, '2026-11-13'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
    const comRazoes = estado({ ...B_HABILITADO, recursos: [recurso({ razoes: [{ fornecedorId: A, data: '2026-11-12' }] })] });
    assert.doesNotThrow(() => validarAtoSelecao(comRazoes, { tipo: 'registrar_contrarrazoes', fornecedorId: B }, '2026-11-16'));
    assert.throws(() => validarAtoSelecao(comRazoes, { tipo: 'registrar_contrarrazoes', fornecedorId: A }, '2026-11-16'), comCodigo('ATO_SELECAO_INVALIDO'));
  });

  it('reconsideração antes do fim das contrarrazões é fora de ordem; reintegrar quem não foi excluído é inválido', () => {
    const comRazoes = estado({ ...B_HABILITADO, recursos: [recurso({ razoes: [{ fornecedorId: A, data: '2026-11-12' }] })] });
    assert.throws(() => validarAtoSelecao(comRazoes, { tipo: 'decidir_reconsideracao', efeito: null }, '2026-11-16'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
    assert.throws(
      () => validarAtoSelecao(comRazoes, { tipo: 'decidir_reconsideracao', efeito: { tipo: 'reintegrar_licitante', fornecedorId: C } }, '2026-11-19'),
      comCodigo('ATO_SELECAO_INVALIDO'),
    );
    assert.doesNotThrow(() => validarAtoSelecao(comRazoes, { tipo: 'decidir_reconsideracao', efeito: { tipo: 'reintegrar_licitante', fornecedorId: A } }, '2026-11-19'));
  });

  it('adjudicar antes de exaurir os recursos e homologar antes de adjudicar são fora de ordem', () => {
    assert.throws(() => validarAtoSelecao(emIntencao, { tipo: 'adjudicar' }, '2026-11-10'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
    assert.throws(() => validarAtoSelecao(emIntencao, { tipo: 'homologar' }, '2026-11-11'), comCodigo('ATO_SELECAO_FORA_DE_ORDEM'));
    assert.doesNotThrow(() => validarAtoSelecao(emIntencao, { tipo: 'adjudicar' }, '2026-11-11'));
  });
});
