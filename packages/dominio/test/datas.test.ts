import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  adicionarDias,
  adicionarDiasUteis,
  contarPrazo,
  diaDaSemana,
  diasEntre,
  diasUteisEntre,
  ehDiaUtil,
  feriadosNacionais,
  formatarData,
  hojeISO,
  pascoa,
  proximoDiaUtil,
  validarDataISO,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('validarDataISO', () => {
  it('aceita datas existentes no formato AAAA-MM-DD', () => {
    assert.equal(validarDataISO('2026-11-08'), true);
    assert.equal(validarDataISO('2024-02-29'), true);
    assert.equal(validarDataISO('2000-02-29'), true);
  });

  it('rejeita datas inexistentes ou mal formatadas', () => {
    for (const d of ['2026-02-29', '1900-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '08/11/2026', '2026-11-08T00:00:00Z', '']) {
      assert.equal(validarDataISO(d), false, d);
    }
  });
});

describe('hojeISO', () => {
  it('usa o fuso America/Sao_Paulo', () => {
    assert.equal(hojeISO(new Date('2026-11-08T02:30:00Z')), '2026-11-07');
    assert.equal(hojeISO(new Date('2026-11-08T03:00:00Z')), '2026-11-08');
    assert.equal(hojeISO(new Date('2026-11-08T23:59:00-03:00')), '2026-11-08');
  });

  it('rejeita instante inválido', () => {
    assert.throws(() => hojeISO(new Date('invalido')), comCodigo('DATA_INVALIDA'));
  });
});

describe('adicionarDias e diasEntre', () => {
  it('soma dias atravessando meses e anos bissextos', () => {
    assert.equal(adicionarDias('2026-02-28', 1), '2026-03-01');
    assert.equal(adicionarDias('2024-02-28', 1), '2024-02-29');
    assert.equal(adicionarDias('2026-01-01', -1), '2025-12-31');
    assert.equal(adicionarDias('2026-11-08', 0), '2026-11-08');
  });

  it('diferença em dias, com sinal', () => {
    assert.equal(diasEntre('2026-01-01', '2026-12-31'), 364);
    assert.equal(diasEntre('2026-12-31', '2026-01-01'), -364);
    assert.equal(diasEntre('2024-01-01', '2025-01-01'), 366);
  });

  it('rejeita entradas inválidas', () => {
    assert.throws(() => adicionarDias('2026-11-08', 1.5), comCodigo('DIAS_INVALIDOS'));
    assert.throws(() => adicionarDias('2026-02-30', 1), comCodigo('DATA_INVALIDA'));
    assert.throws(() => diasEntre('x', '2026-01-01'), comCodigo('DATA_INVALIDA'));
  });
});

describe('diaDaSemana', () => {
  it('0 = domingo', () => {
    assert.equal(diaDaSemana('2026-11-08'), 0);
    assert.equal(diaDaSemana('2026-04-03'), 5);
    assert.equal(diaDaSemana('2026-11-14'), 6);
  });
});

describe('pascoa', () => {
  it('2026 = 2026-04-05', () => {
    assert.equal(pascoa(2026), '2026-04-05');
  });

  it('confere com datas conhecidas', () => {
    assert.equal(pascoa(2000), '2000-04-23');
    assert.equal(pascoa(2024), '2024-03-31');
    assert.equal(pascoa(2025), '2025-04-20');
    assert.equal(pascoa(2027), '2027-03-28');
    assert.equal(pascoa(2038), '2038-04-25');
  });

  it('rejeita ano fora do calendário gregoriano suportado', () => {
    assert.throws(() => pascoa(1500), comCodigo('ANO_INVALIDO'));
    assert.throws(() => pascoa(2026.5), comCodigo('ANO_INVALIDO'));
  });
});

describe('feriadosNacionais', () => {
  const f2026 = feriadosNacionais(2026);
  const porData = new Map(f2026.map((f) => [f.data, f]));

  it('Sexta-feira Santa 2026 = 2026-04-03 (feriado)', () => {
    assert.equal(porData.get('2026-04-03')?.tipo, 'feriado');
  });

  it('Carnaval 2026 = 2026-02-16 e 2026-02-17 (pontos facultativos)', () => {
    assert.equal(porData.get('2026-02-16')?.tipo, 'ponto_facultativo');
    assert.equal(porData.get('2026-02-17')?.tipo, 'ponto_facultativo');
  });

  it('Corpus Christi 2026 = 2026-06-04 (ponto facultativo)', () => {
    assert.equal(porData.get('2026-06-04')?.tipo, 'ponto_facultativo');
  });

  it('inclui os feriados fixos, inclusive 20 de novembro', () => {
    for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25']) {
      assert.equal(porData.get(d)?.tipo, 'feriado', d);
    }
    assert.equal(porData.get('2026-11-20')?.nome, 'Dia Nacional de Zumbi e da Consciência Negra');
    assert.equal(f2026.length, 13);
  });

  it('está ordenado por data', () => {
    const datas = f2026.map((f) => f.data);
    assert.deepEqual(datas, [...datas].sort());
  });

  it('20 de novembro é feriado nacional a partir de 2024 (Lei 14.759/2023)', () => {
    assert.equal(feriadosNacionais(2023).some((f) => f.data === '2023-11-20'), false);
    assert.equal(feriadosNacionais(2024).some((f) => f.data === '2024-11-20'), true);
  });
});

describe('ehDiaUtil', () => {
  it('dias de semana sem feriado são úteis', () => {
    assert.equal(ehDiaUtil('2026-11-09'), true);
    assert.equal(ehDiaUtil('2026-02-18'), true);
  });

  it('fins de semana e feriados não são úteis', () => {
    assert.equal(ehDiaUtil('2026-11-08'), false);
    assert.equal(ehDiaUtil('2026-11-14'), false);
    assert.equal(ehDiaUtil('2026-11-20'), false);
    assert.equal(ehDiaUtil('2026-04-03'), false);
  });

  it('pontos facultativos contam como sem expediente por padrão, e podem ser desconsiderados', () => {
    assert.equal(ehDiaUtil('2026-02-16'), false);
    assert.equal(ehDiaUtil('2026-06-04'), false);
    assert.equal(ehDiaUtil('2026-02-16', { considerarPontosFacultativos: false }), true);
    assert.equal(ehDiaUtil('2026-04-03', { considerarPontosFacultativos: false }), false);
  });

  it('feriados extras do órgão', () => {
    assert.equal(ehDiaUtil('2026-11-09', { feriadosExtras: ['2026-11-09'] }), false);
    assert.throws(() => ehDiaUtil('2026-11-09', { feriadosExtras: ['2026-11-31'] }), comCodigo('DATA_INVALIDA'));
  });
});

describe('proximoDiaUtil', () => {
  it('retorna a própria data se útil', () => {
    assert.equal(proximoDiaUtil('2026-11-09'), '2026-11-09');
  });

  it('pula feriado e fim de semana', () => {
    assert.equal(proximoDiaUtil('2026-04-03'), '2026-04-06');
    assert.equal(proximoDiaUtil('2026-11-20'), '2026-11-23');
    assert.equal(proximoDiaUtil('2026-02-14'), '2026-02-18');
  });
});

describe('adicionarDiasUteis', () => {
  it('exclui o dia do começo e pula dias sem expediente', () => {
    assert.equal(adicionarDiasUteis('2026-04-01', 2), '2026-04-06');
    assert.equal(adicionarDiasUteis('2026-11-09', 1), '2026-11-10');
    assert.equal(adicionarDiasUteis('2026-11-19', 1), '2026-11-23');
  });

  it('n = 0 retorna a data se útil, senão o próximo dia útil', () => {
    assert.equal(adicionarDiasUteis('2026-11-09', 0), '2026-11-09');
    assert.equal(adicionarDiasUteis('2026-11-08', 0), '2026-11-09');
  });

  it('considera feriados extras', () => {
    assert.equal(adicionarDiasUteis('2026-11-09', 1, { feriadosExtras: ['2026-11-10'] }), '2026-11-11');
  });

  it('rejeita n negativo ou fracionário', () => {
    assert.throws(() => adicionarDiasUteis('2026-11-09', -1), comCodigo('DIAS_INVALIDOS'));
    assert.throws(() => adicionarDiasUteis('2026-11-09', 1.5), comCodigo('DIAS_INVALIDOS'));
  });
});

describe('diasUteisEntre', () => {
  it('exclui o início e inclui o fim', () => {
    assert.equal(diasUteisEntre('2026-11-06', '2026-11-13'), 5);
    assert.equal(diasUteisEntre('2026-11-09', '2026-11-10'), 1);
    assert.equal(diasUteisEntre('2026-11-09', '2026-11-09'), 0);
  });

  it('desconta feriados', () => {
    assert.equal(diasUteisEntre('2026-11-16', '2026-11-23'), 4);
  });

  it('é simétrico com sinal negativo', () => {
    assert.equal(diasUteisEntre('2026-11-13', '2026-11-06'), -5);
  });
});

describe('contarPrazo (Lei 14.133/2021, art. 183)', () => {
  it('exclui o dia do começo e inclui o do vencimento', () => {
    assert.deepEqual(contarPrazo('2026-11-09', 1, 'corridos'), { vencimento: '2026-11-10', fundamento: 'Lei 14.133/2021, art. 183' });
    assert.deepEqual(contarPrazo('2026-11-09', 1, 'uteis'), { vencimento: '2026-11-10', fundamento: 'Lei 14.133/2021, art. 183' });
  });

  it('corridos: vencimento em dia sem expediente prorroga para o primeiro dia útil seguinte', () => {
    assert.equal(contarPrazo('2026-04-01', 2, 'corridos').vencimento, '2026-04-06');
    assert.equal(contarPrazo('2026-11-06', 1, 'corridos').vencimento, '2026-11-09');
    assert.equal(contarPrazo('2026-11-19', 1, 'corridos').vencimento, '2026-11-23');
    assert.equal(contarPrazo('2026-02-13', 3, 'corridos').vencimento, '2026-02-18');
  });

  it('corridos conta fins de semana no meio do prazo', () => {
    assert.equal(contarPrazo('2026-11-09', 10, 'corridos').vencimento, '2026-11-19');
  });

  it('úteis: conta apenas dias com expediente', () => {
    assert.equal(contarPrazo('2026-04-01', 2, 'uteis').vencimento, '2026-04-06');
    assert.equal(contarPrazo('2026-11-09', 15, 'uteis').vencimento, '2026-12-01');
  });

  it('rejeita tipo e quantidade inválidos', () => {
    assert.throws(() => contarPrazo('2026-11-09', 1, 'meses' as unknown as 'uteis'), comCodigo('TIPO_PRAZO_INVALIDO'));
    assert.throws(() => contarPrazo('2026-11-09', -1, 'corridos'), comCodigo('DIAS_INVALIDOS'));
  });
});

describe('formatarData', () => {
  it('formata como DD/MM/AAAA', () => {
    assert.equal(formatarData('2026-11-08'), '08/11/2026');
    assert.equal(formatarData('2026-01-31'), '31/01/2026');
  });

  it('rejeita data inválida', () => {
    assert.throws(() => formatarData('2026-02-30'), comCodigo('DATA_INVALIDA'));
  });
});
