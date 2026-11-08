import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVISO_SINAL_DISPUTA,
  LIMIARES_PADROES_LANCES,
  calcularEstadoSessaoSimulada,
  cruzarPadroesComVinculos,
  detectarPadroesLances,
  parametrosPadraoDisputa,
  perfisCenarioSimulacao,
  propostasIniciaisSimuladas,
  type LanceAnalisado,
} from '../src/index.ts';

const T0 = Date.parse('2026-11-09T13:00:00.000Z');
const em = (segundos: number) => new Date(T0 + segundos * 1000).toISOString();
function lances(lista: [number, string, number, boolean?][]): LanceAnalisado[] {
  return lista.map(([segundos, licitanteId, valor, intermediario], i) => ({ sequencia: i + 1, licitanteId, valor, instante: em(segundos), intermediario }));
}
const nomes = { A: 'Empresa A', B: 'Empresa B', C: 'Empresa C' };
const tipos = (s: { tipo: string }[]) => s.map((x) => x.tipo).sort();

describe('detectarPadroesLances (RIA-09)', () => {
  it('lances irregulares de licitantes diferentes não geram sinal', () => {
    const r = detectarPadroesLances(
      lances([
        [5, 'A', 10_000],
        [17, 'B', 9_900],
        [40, 'A', 9_750],
        [44, 'C', 9_700],
        [90, 'B', 9_500],
        [130, 'A', 9_420],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    assert.deepEqual(r, []);
  });

  it('intervalos regulares: 5 lances do mesmo licitante com variação de até 1 s', () => {
    const r = detectarPadroesLances(
      lances([
        [10, 'A', 10_000],
        [20, 'A', 9_950],
        [30.5, 'A', 9_870],
        [40, 'A', 9_800],
        [50, 'A', 9_720],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    assert.deepEqual(tipos(r), ['intervalos_regulares']);
    assert.match(r[0]?.evidencias[0] ?? '', /5 lances seguidos de Empresa A com intervalos entre 9,5 s e 10,5 s \(lances nº 1 a 5\)/);
    assert.match(r[0]?.fundamento ?? '', /art\. 19/);
    assert.equal(r[0]?.aviso, AVISO_SINAL_DISPUTA);
    assert.match(AVISO_SINAL_DISPUTA, /requer revisão humana/);
    assert.match(AVISO_SINAL_DISPUTA, /Não desclassifica/);
  });

  it('reduções idênticas: 3 reduções seguidas de exatamente o mesmo valor', () => {
    const r = detectarPadroesLances(
      lances([
        [3, 'B', 10_000],
        [19, 'B', 9_900],
        [61, 'B', 9_800],
        [70, 'B', 9_700],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    assert.deepEqual(tipos(r), ['decrementos_identicos']);
    assert.match(r[0]?.evidencias[0] ?? '', /3 reduções seguidas de exatamente R\$ 1,00/);
  });

  it('alternância: 6 lances que assumem a melhor oferta só entre dois licitantes; intermediários de terceiros não quebram', () => {
    const r = detectarPadroesLances(
      lances([
        [3, 'A', 10_000],
        [7, 'B', 9_950],
        [8, 'C', 12_000, true],
        [15, 'A', 9_890],
        [26, 'B', 9_810],
        [33, 'A', 9_760],
        [49, 'B', 9_690],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    const alternancia = r.find((s) => s.tipo === 'alternancia_combinada');
    assert.ok(alternancia);
    assert.deepEqual(alternancia.licitantes, ['A', 'B']);
    assert.match(alternancia.evidencias[0] ?? '', /6 lances seguidos que assumiram a melhor oferta alternaram apenas entre Empresa A e Empresa B/);
    assert.match(alternancia.fundamento, /Lei 12\.846\/2013/);
  });

  it('com menos que o mínimo de alternâncias, não sinaliza', () => {
    assert.equal(LIMIARES_PADROES_LANCES.minimoAlternancia, 6);
    const r = detectarPadroesLances(
      lances([
        [3, 'A', 10_000],
        [9, 'B', 9_950],
        [25, 'A', 9_890],
        [26, 'B', 9_810],
        [80, 'A', 9_700],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    assert.equal(r.filter((s) => s.tipo === 'alternancia_combinada').length, 0);
  });

  it('lances iguais de licitantes diferentes', () => {
    const r = detectarPadroesLances(
      lances([
        [3, 'A', 10_000],
        [40, 'C', 9_500],
        [55, 'A', 9_500],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    assert.deepEqual(tipos(r), ['lances_iguais']);
    assert.deepEqual(r[0]?.licitantes, ['A', 'C']);
    assert.match(r[0]?.evidencias[0] ?? '', /mesmo valor, R\$ 95,00 \(lances nº 2, 3\)/);
  });

  it('maior desconto: reduções em pontos percentuais', () => {
    const r = detectarPadroesLances(
      lances([
        [3, 'A', 2],
        [30, 'A', 2.5],
        [41, 'A', 3],
        [99, 'A', 3.5],
      ]),
      { criterio: 'maior_desconto', nomes },
    );
    assert.match(r[0]?.evidencias[0] ?? '', /0,5 ponto\(s\) percentual\(is\)/);
  });
});

describe('cruzarPadroesComVinculos (RIA-09 × RIA-06)', () => {
  it('reforça o padrão que envolve os dois licitantes do vínculo e mantém os demais', () => {
    const sinais = detectarPadroesLances(
      lances([
        [3, 'A', 10_000],
        [40, 'C', 9_500],
        [55, 'A', 9_500],
        [60, 'B', 9_000],
        [70, 'C', 9_000],
      ]),
      { criterio: 'menor_preco', nomes },
    );
    const cruzados = cruzarPadroesComVinculos(sinais, [{ licitantes: ['A', 'C'], descricao: 'Empresa A e Empresa C têm sócio em comum' }]);
    const ac = cruzados.find((s) => s.licitantes.join() === 'A,C');
    const bc = cruzados.find((s) => s.licitantes.join() === 'B,C');
    assert.equal(ac?.reforcadoPorVinculo, true);
    assert.deepEqual(ac?.vinculos, ['Empresa A e Empresa C têm sócio em comum']);
    assert.match(ac?.evidencias.at(-1) ?? '', /RIA-06/);
    assert.equal(bc?.reforcadoPorVinculo, false);
  });
});

describe('PoC-03: simulação com 4 empresas, duas com sócio em comum', () => {
  it('o par combinado gera alternância reforçada pelo vínculo; o robô gera intervalos regulares', () => {
    const ids = ['A', 'B', 'C', 'D'];
    const propostas = propostasIniciaisSimuladas(14, 4, 'menor_preco', 250_000_000);
    const estado = calcularEstadoSessaoSimulada(
      {
        criterio: 'menor_preco',
        modo: 'aberto',
        parametros: parametrosPadraoDisputa('aberto', 'menor_preco'),
        participantes: ids.map((id, i) => ({ id, nome: `Empresa ${id}`, propostaInicial: propostas[i]?.propostaInicial ?? 0 })),
        valorReferencia: 250_000_000,
        semente: 14,
      },
      [{ tipo: 'abertura', instante: em(0) }],
      em(7200),
      perfisCenarioSimulacao('conluio_e_robo', ids, ['A', 'C']),
    );
    const sinais = cruzarPadroesComVinculos(detectarPadroesLances(estado.lances, { criterio: 'menor_preco', nomes }), [
      { licitantes: ['A', 'C'], descricao: 'sócio em comum' },
    ]);
    const alternancia = sinais.find((s) => s.tipo === 'alternancia_combinada');
    assert.deepEqual(alternancia?.licitantes, ['A', 'C']);
    assert.equal(alternancia?.reforcadoPorVinculo, true);
    assert.ok(sinais.some((s) => s.tipo === 'intervalos_regulares' && s.licitantes.join() === 'D'));
    assert.ok(sinais.every((s) => s.aviso === AVISO_SINAL_DISPUTA));
  });
});
