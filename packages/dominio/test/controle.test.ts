import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  adicionarDiasUteis,
  avaliarLimiteAditivos,
  bloqueioControleExterno,
  pagamentosPreteridos,
  prazoDecisaoMerito,
  prazoRespostaCautelar,
  prazoRespostaMedida,
  situacaoMedidaControle,
  situacaoRevisaoRiscos,
  type MedidaParaBloqueio,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('prazoRespostaCautelar (art. 171, § 2º)', () => {
  it('10 dias úteis a partir da ciência, sem contar o feriado de 20/11', () => {
    const r = prazoRespostaCautelar('2026-11-09');
    assert.equal(r.vencimento, '2026-11-24');
    assert.equal(r.diasUteis, 10);
    assert.match(r.fundamento, /art\. 171, § 2º/);
  });

  it('feriado local cadastrado adia o vencimento', () => {
    assert.equal(prazoRespostaCautelar('2026-11-09', { feriadosExtras: ['2026-11-12'] }).vencimento, '2026-11-25');
  });

  it('data inválida → DATA_INVALIDA', () => {
    assert.throws(() => prazoRespostaCautelar('2026-02-30'), comCodigo('DATA_INVALIDA'));
  });
});

describe('prazoRespostaMedida', () => {
  it('cautelar suspensiva usa sempre o prazo legal de 10 dias úteis', () => {
    assert.equal(prazoRespostaMedida({ ciencia: '2026-11-09', efeitoSuspensivo: true }).vencimento, '2026-11-24');
    assert.throws(() => prazoRespostaMedida({ ciencia: '2026-11-09', efeitoSuspensivo: true, diasUteisFixados: 5 }), comCodigo('PRAZO_CONTROLE_INVALIDO'));
  });

  it('medida sem suspensão usa o prazo fixado na comunicação', () => {
    const r = prazoRespostaMedida({ ciencia: '2026-11-09', efeitoSuspensivo: false, diasUteisFixados: 5 });
    assert.equal(r.vencimento, '2026-11-16');
    assert.equal(r.diasUteis, 5);
    assert.match(r.fundamento, /fixado pelo órgão de controle/);
  });

  it('sem prazo fixado, usa a referência de 10 dias úteis', () => {
    const r = prazoRespostaMedida({ ciencia: '2026-11-09', efeitoSuspensivo: false, diasUteisFixados: null });
    assert.equal(r.vencimento, '2026-11-24');
    assert.match(r.fundamento, /referência/);
  });

  it('prazo fixado fora de 1 a 120 dias úteis → PRAZO_CONTROLE_INVALIDO', () => {
    for (const dias of [0, 121, 2.5]) {
      assert.throws(() => prazoRespostaMedida({ ciencia: '2026-11-09', efeitoSuspensivo: false, diasUteisFixados: dias }), comCodigo('PRAZO_CONTROLE_INVALIDO'), String(dias));
    }
  });
});

describe('prazoDecisaoMerito (art. 171, § 1º)', () => {
  it('25 dias úteis do recebimento das informações; prorrogado uma vez, 50', () => {
    const r = prazoDecisaoMerito('2026-11-24');
    assert.equal(r.diasUteis, 25);
    assert.equal(r.vencimento, adicionarDiasUteis('2026-11-24', 25));
    assert.match(r.fundamento, /art\. 171, § 1º/);
    const p = prazoDecisaoMerito('2026-11-24', true);
    assert.equal(p.diasUteis, 50);
    assert.equal(p.vencimento, adicionarDiasUteis('2026-11-24', 50));
  });
});

describe('situacaoMedidaControle', () => {
  const base = { prazoResposta: '2026-11-24', prorrogadoAte: null, respondidaEm: null, revogadaEm: null };

  it('aguardando resposta com folga → regular', () => {
    const r = situacaoMedidaControle(base, '2026-11-09');
    assert.equal(r.situacao, 'aguardando_resposta');
    assert.equal(r.diasUteisRestantes, 10);
    assert.equal(r.semaforo, 'regular');
  });

  it('até 2 dias úteis → crítico; até 5 → atenção', () => {
    assert.equal(situacaoMedidaControle(base, '2026-11-19').semaforo, 'critico');
    assert.equal(situacaoMedidaControle(base, '2026-11-19').diasUteisRestantes, 2);
    assert.equal(situacaoMedidaControle(base, '2026-11-16').semaforo, 'atencao');
  });

  it('prazo vencido sem resposta → resposta_vencida, com o § 4º na explicação', () => {
    const r = situacaoMedidaControle(base, '2026-11-25');
    assert.equal(r.situacao, 'resposta_vencida');
    assert.equal(r.semaforo, 'vencido');
    assert.equal(r.diasUteisRestantes, -1);
    assert.match(r.explicacao, /§ 4º/);
  });

  it('prorrogação estende o prazo efetivo', () => {
    const r = situacaoMedidaControle({ ...base, prorrogadoAte: '2026-12-08' }, '2026-11-25');
    assert.equal(r.situacao, 'aguardando_resposta');
    assert.equal(r.prazoEfetivo, '2026-12-08');
    assert.match(r.explicacao, /prorrogado/);
  });

  it('prorrogação anterior ao prazo original → PRAZO_CONTROLE_INVALIDO', () => {
    assert.throws(() => situacaoMedidaControle({ ...base, prorrogadoAte: '2026-11-20' }, '2026-11-09'), comCodigo('PRAZO_CONTROLE_INVALIDO'));
  });

  it('respondida → concluído, indicando se dentro do prazo', () => {
    const r = situacaoMedidaControle({ ...base, respondidaEm: '2026-11-20' }, '2026-12-01');
    assert.equal(r.situacao, 'respondida');
    assert.equal(r.semaforo, 'concluido');
    assert.equal(r.diasUteisRestantes, null);
    assert.match(r.explicacao, /dentro do prazo/);
    assert.match(situacaoMedidaControle({ ...base, respondidaEm: '2026-11-30' }, '2026-12-01').explicacao, /depois do prazo/);
  });

  it('revogação prevalece; revogação com data futura ainda não vale', () => {
    assert.equal(situacaoMedidaControle({ ...base, respondidaEm: '2026-11-20', revogadaEm: '2026-11-27' }, '2026-12-01').situacao, 'revogada');
    assert.equal(situacaoMedidaControle({ ...base, revogadaEm: '2026-12-10' }, '2026-11-10').situacao, 'aguardando_resposta');
  });
});

describe('bloqueioControleExterno (RN-30)', () => {
  const cautelar: MedidaParaBloqueio = { orgao: 'TCU', tipo: 'cautelar', numero: '1234/2026', efeitoSuspensivo: true, cienciaEm: '2026-11-09', revogadaEm: null };

  it('cautelar suspensiva ativa bloqueia e cita órgão, número e ciência', () => {
    const r = bloqueioControleExterno([cautelar], '2026-11-10');
    assert.equal(r.bloqueado, true);
    assert.equal(r.ativas.length, 1);
    assert.match(r.mensagem ?? '', /TCU nº 1234\/2026/);
    assert.match(r.mensagem ?? '', /09\/11\/2026/);
    assert.match(r.fundamento, /art\. 171/);
  });

  it('revogada ou sem efeito suspensivo não bloqueia', () => {
    assert.equal(bloqueioControleExterno([{ ...cautelar, revogadaEm: '2026-11-10' }], '2026-11-10').bloqueado, false);
    assert.equal(bloqueioControleExterno([{ ...cautelar, efeitoSuspensivo: false }], '2026-11-10').bloqueado, false);
    assert.equal(bloqueioControleExterno([], '2026-11-10').mensagem, null);
  });

  it('várias medidas ativas aparecem na mesma mensagem', () => {
    const r = bloqueioControleExterno([cautelar, { ...cautelar, orgao: 'CGU', numero: '77/2026' }], '2026-11-10');
    assert.equal(r.ativas.length, 2);
    assert.match(r.mensagem ?? '', /TCU nº 1234\/2026.* e .*CGU nº 77\/2026/);
  });
});

describe('situacaoRevisaoRiscos (RN-29)', () => {
  const contrato = { inicioVigencia: '2026-05-04', vigenciaFim: '2027-05-03' };

  it('sem revisão: vence 3 meses após o início da vigência', () => {
    const r = situacaoRevisaoRiscos({ ...contrato, ultimaRevisao: null, hoje: '2026-11-09' });
    assert.equal(r.situacao, 'vencida');
    assert.equal(r.proximaRevisao, '2026-08-04');
    assert.equal(r.diasRestantes, -97);
    assert.match(r.explicacao, /sem revisão registrada/);
    assert.match(r.fundamento, /art(s)?\. 22 e 169/);
  });

  it('a vencer nos 15 dias anteriores; em dia antes disso', () => {
    const aVencer = situacaoRevisaoRiscos({ ...contrato, ultimaRevisao: '2026-08-20', hoje: '2026-11-09' });
    assert.equal(aVencer.situacao, 'a_vencer');
    assert.equal(aVencer.proximaRevisao, '2026-11-20');
    assert.equal(aVencer.diasRestantes, 11);
    const emDia = situacaoRevisaoRiscos({ ...contrato, ultimaRevisao: '2026-10-01', hoje: '2026-11-09' });
    assert.equal(emDia.situacao, 'em_dia');
    assert.equal(emDia.proximaRevisao, '2027-01-01');
  });

  it('vigência encerrada não exige revisão', () => {
    const r = situacaoRevisaoRiscos({ inicioVigencia: '2025-11-01', vigenciaFim: '2026-11-01', ultimaRevisao: null, hoje: '2026-11-09' });
    assert.equal(r.situacao, 'encerrado');
    assert.equal(r.proximaRevisao, null);
  });

  it('fim anterior ao início → DATA_INVALIDA', () => {
    assert.throws(() => situacaoRevisaoRiscos({ inicioVigencia: '2026-05-04', vigenciaFim: '2026-05-01', ultimaRevisao: null, hoje: '2026-11-09' }), comCodigo('DATA_INVALIDA'));
  });
});

describe('avaliarLimiteAditivos (art. 125)', () => {
  it('regular, perto (80% do limite) e acima do limite', () => {
    assert.equal(avaliarLimiteAditivos({ valorInicialAtualizado: 1_000_000, acrescimos: 100_000, supressoes: 0 }).nivel, 'regular');
    const perto = avaliarLimiteAditivos({ valorInicialAtualizado: 1_000_000, acrescimos: 200_000, supressoes: 0 });
    assert.equal(perto.nivel, 'proximo');
    assert.equal(perto.percentualAcrescimos, 20);
    assert.equal(avaliarLimiteAditivos({ valorInicialAtualizado: 1_000_000, acrescimos: 260_000, supressoes: 0 }).nivel, 'excedido');
    assert.equal(avaliarLimiteAditivos({ valorInicialAtualizado: 1_000_000, acrescimos: 0, supressoes: 260_000 }).nivel, 'excedido');
  });

  it('reforma de edifício ou equipamento: limite de 50% para acréscimos', () => {
    const r = avaliarLimiteAditivos({ valorInicialAtualizado: 1_000_000, acrescimos: 300_000, supressoes: 0, reformaEdificioOuEquipamento: true });
    assert.equal(r.nivel, 'regular');
    assert.equal(r.limiteAcrescimos, 50);
    assert.match(r.fundamento, /art\. 125/);
  });
});

describe('pagamentosPreteridos (art. 141)', () => {
  it('nota exigível sem pagamento enquanto posteriores da mesma fonte foram pagas', () => {
    const r = pagamentosPreteridos(
      [
        { id: 'q1', fonteRecurso: '1000', vencimento: '2026-08-10', pagoEm: null, exigivel: true },
        { id: 'p1', fonteRecurso: '1000', vencimento: '2026-09-10', pagoEm: '2026-09-08', exigivel: true },
        { id: 'p2', fonteRecurso: '1000', vencimento: '2026-10-10', pagoEm: '2026-10-09', exigivel: true },
        { id: 'outra', fonteRecurso: '1001', vencimento: '2026-10-10', pagoEm: '2026-10-01', exigivel: true },
      ],
      '2026-11-09',
    );
    assert.deepEqual(r.map((x) => [x.id, x.posterioresPagos]), [['q1', 2]]);
    assert.match(r[0]?.fundamento ?? '', /art\. 141/);
  });

  it('não sinaliza nota ainda não exigível, paga antes, ou que vencia depois do pagamento da outra', () => {
    const r = pagamentosPreteridos(
      [
        { id: 'nao-atestada', fonteRecurso: '1000', vencimento: '2026-08-10', pagoEm: null, exigivel: false },
        { id: 'em-ordem', fonteRecurso: '1000', vencimento: '2026-08-20', pagoEm: '2026-08-20', exigivel: true },
        { id: 'vence-depois', fonteRecurso: '1000', vencimento: '2026-09-10', pagoEm: null, exigivel: true },
        { id: 'adiantada', fonteRecurso: '1000', vencimento: '2026-09-11', pagoEm: '2026-09-05', exigivel: true },
      ],
      '2026-11-09',
    );
    assert.deepEqual(r, []);
  });

  it('nota paga depois de outra posterior também é preterida', () => {
    const r = pagamentosPreteridos(
      [
        { id: 'antiga', fonteRecurso: '1000', vencimento: '2026-08-10', pagoEm: '2026-10-20', exigivel: true },
        { id: 'nova', fonteRecurso: '1000', vencimento: '2026-09-10', pagoEm: '2026-09-10', exigivel: true },
      ],
      '2026-11-09',
    );
    assert.deepEqual(r.map((x) => x.id), ['antiga']);
  });
});
