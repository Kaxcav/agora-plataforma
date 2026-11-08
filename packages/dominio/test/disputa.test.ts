import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  avaliarReinicioDisputa,
  calcularEstadoSessao,
  calcularEstadoSessaoSimulada,
  classificarOfertas,
  classificarSessaoDisputa,
  parametrosPadraoDisputa,
  perfisCenarioSimulacao,
  pontuarTecnicaEPreco,
  propostasIniciaisSimuladas,
  redigirAtaSessaoDisputa,
  selecionarLicitantesFaixa,
  sorteioDeterministico,
  validarLance,
  validarModoDisputa,
  verificarAcaoSessao,
  type CriterioJulgamentoDisputa,
  type DefinicaoSessaoDisputa,
  type EventoSessaoDisputa,
  type ModoDisputa,
  type ParametrosDisputa,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const T0 = Date.parse('2026-11-09T13:00:00.000Z');
const em = (segundos: number) => new Date(T0 + segundos * 1000).toISOString();

function definicao(
  modo: ModoDisputa = 'aberto',
  criterio: CriterioJulgamentoDisputa = 'menor_preco',
  propostas: number[] = [100_000, 102_000, 104_000, 120_000],
  ajustes: Partial<ParametrosDisputa> = {},
  extra: Partial<DefinicaoSessaoDisputa> = {},
): DefinicaoSessaoDisputa {
  return {
    criterio,
    modo,
    parametros: parametrosPadraoDisputa(modo, criterio, ajustes),
    participantes: propostas.map((p, i) => ({ id: `L${i + 1}`, nome: `Licitante ${i + 1}`, propostaInicial: p })),
    valorReferencia: 110_000,
    semente: 73,
    ...extra,
  };
}

const abertura: EventoSessaoDisputa = { tipo: 'abertura', instante: em(0) };
const lance = (segundos: number, licitanteId: string, valor: number): EventoSessaoDisputa => ({ tipo: 'lance', instante: em(segundos), licitanteId, valor });

describe('modos de disputa e parâmetros (art. 56; IN SEGES/ME 73/2022)', () => {
  it('veda o modo fechado isolado no menor preço e no maior desconto (art. 56, § 1º)', () => {
    assert.throws(() => validarModoDisputa('menor_preco', 'fechado'), comCodigo('MODO_DISPUTA_VEDADO'));
    assert.throws(() => validarModoDisputa('maior_desconto', 'fechado'), comCodigo('MODO_DISPUTA_VEDADO'));
  });

  it('veda o modo aberto, isolado ou combinado, na técnica e preço (art. 56, § 2º)', () => {
    for (const modo of ['aberto', 'aberto_fechado', 'fechado_aberto'] as const) {
      assert.throws(() => validarModoDisputa('tecnica_e_preco', modo), comCodigo('MODO_DISPUTA_VEDADO'), modo);
    }
    assert.match(validarModoDisputa('tecnica_e_preco', 'fechado').fundamento, /art\. 56, II/);
  });

  it('padrão da IN 73/2022: 10 min no aberto, 15 min no aberto e fechado, prorrogação de 2 min, faixa de 10% e 3 ofertas', () => {
    const aberto = parametrosPadraoDisputa('aberto', 'menor_preco');
    assert.equal(aberto.duracaoEtapaAbertaSegundos, 600);
    assert.equal(aberto.janelaProrrogacaoSegundos, 120);
    assert.equal(aberto.prorrogacaoSegundos, 120);
    assert.equal(aberto.faixaSelecaoPercentual, 10);
    assert.equal(aberto.minimoSelecionados, 3);
    assert.equal(aberto.diferencaReinicioPercentual, 5);
    assert.equal(aberto.pesoTecnicoPercentual, null);
    assert.equal(parametrosPadraoDisputa('aberto_fechado', 'menor_preco').duracaoEtapaAbertaSegundos, 900);
    assert.equal(parametrosPadraoDisputa('fechado', 'tecnica_e_preco').pesoTecnicoPercentual, 70);
  });

  it('ajustes do edital substituem o padrão e são validados; peso técnico acima de 70% é recusado (art. 36, § 2º)', () => {
    assert.equal(parametrosPadraoDisputa('aberto', 'menor_preco', { duracaoEtapaAbertaSegundos: 900 }).duracaoEtapaAbertaSegundos, 900);
    assert.throws(() => parametrosPadraoDisputa('fechado', 'tecnica_e_preco', { pesoTecnicoPercentual: 71 }), comCodigo('PESO_TECNICO_INVALIDO'));
    assert.throws(() => parametrosPadraoDisputa('aberto', 'menor_preco', { faixaSelecaoPercentual: 0 }), comCodigo('PARAMETRO_DISPUTA_INVALIDO'));
    assert.throws(() => parametrosPadraoDisputa('aberto', 'menor_preco', { pesoTecnicoPercentual: 50 }), comCodigo('PARAMETRO_DISPUTA_INVALIDO'));
    assert.throws(
      () => parametrosPadraoDisputa('aberto', 'menor_preco', { intervaloMinimo: { tipo: 'absoluto', valor: 10.5 } }),
      comCodigo('PARAMETRO_DISPUTA_INVALIDO'),
    );
  });

  it('maior desconto exige o preço global de referência (art. 34, § 2º)', () => {
    const d = definicao('aberto', 'maior_desconto', [2, 3], {}, { valorReferencia: null });
    assert.throws(() => calcularEstadoSessao(d, [], em(0)), comCodigo('VALOR_REFERENCIA_OBRIGATORIO'));
  });
});

describe('selecionarLicitantesFaixa (IN 73/2022, art. 24, §§ 2º e 4º; art. 25)', () => {
  const ofertas = [
    { licitanteId: 'A', valor: 1000 },
    { licitanteId: 'B', valor: 1090 },
    { licitanteId: 'C', valor: 1100 },
    { licitanteId: 'D', valor: 1300 },
    { licitanteId: 'E', valor: 1400 },
  ];
  it('melhor oferta e as até 10% piores', () => {
    assert.deepEqual(selecionarLicitantesFaixa('menor_preco', ofertas, 10, 3), ['A', 'B', 'C']);
  });
  it('menos de 3 na faixa: as 3 melhores, com os empatados no corte', () => {
    assert.deepEqual(selecionarLicitantesFaixa('menor_preco', ofertas, 5, 3), ['A', 'B', 'C']);
    const empate = [...ofertas, { licitanteId: 'F', valor: 1100 }];
    assert.deepEqual(selecionarLicitantesFaixa('menor_preco', empate, 5, 3).sort(), ['A', 'B', 'C', 'F']);
  });
  it('maior desconto: até 10% abaixo do maior desconto', () => {
    const d = [
      { licitanteId: 'A', valor: 10 },
      { licitanteId: 'B', valor: 9.2 },
      { licitanteId: 'C', valor: 8.5 },
      { licitanteId: 'D', valor: 8 },
    ];
    assert.deepEqual(selecionarLicitantesFaixa('maior_desconto', d, 10, 2), ['A', 'B']);
  });
});

describe('validarLance (arts. 56, § 3º, e 57; IN 73/2022, art. 21)', () => {
  const d = definicao('aberto', 'menor_preco', [100_000, 102_000], { intervaloMinimo: { tipo: 'absoluto', valor: 500 } });
  const aberta = calcularEstadoSessao(d, [abertura], em(10));

  it('lance que cobre a melhor oferta com a diferença mínima é aceito', () => {
    assert.deepEqual(validarLance(d, aberta, { licitanteId: 'L2', valor: 99_500, instante: em(10) }), { valido: true, intermediario: false });
  });
  it('lance intermediário: melhora o próprio sem cobrir a melhor oferta (inclusive igual a ela)', () => {
    assert.deepEqual(validarLance(d, aberta, { licitanteId: 'L2', valor: 101_000, instante: em(10) }), { valido: true, intermediario: true });
    assert.deepEqual(validarLance(d, aberta, { licitanteId: 'L2', valor: 100_000, instante: em(10) }), { valido: true, intermediario: true });
  });
  it('recusa lance que não melhora o último do próprio licitante (art. 21, § 2º)', () => {
    const r = validarLance(d, aberta, { licitanteId: 'L2', valor: 102_000, instante: em(10) });
    assert.equal(r.valido, false);
    assert.match(r.valido ? '' : r.fundamento, /art\. 21, § 2º/);
  });
  it('recusa diferença menor que o intervalo mínimo, contra a melhor oferta e contra o próprio lance (art. 57)', () => {
    const cobrindo = validarLance(d, aberta, { licitanteId: 'L2', valor: 99_800, instante: em(10) });
    assert.equal(cobrindo.valido, false);
    assert.match(cobrindo.valido ? '' : cobrindo.motivo, /em relação à melhor oferta/);
    const intermediario = validarLance(d, aberta, { licitanteId: 'L2', valor: 101_700, instante: em(10) });
    assert.match(intermediario.valido ? '' : intermediario.motivo, /último lance do próprio licitante/);
  });
  it('intervalo percentual arredonda para cima, em centavos', () => {
    const p = definicao('aberto', 'menor_preco', [100_000, 102_000], { intervaloMinimo: { tipo: 'percentual', valor: 0.5 } });
    const e = calcularEstadoSessao(p, [abertura], em(1));
    assert.equal(validarLance(p, e, { licitanteId: 'L2', valor: 99_501, instante: em(1) }).valido, false);
    assert.equal(validarLance(p, e, { licitanteId: 'L2', valor: 99_500, instante: em(1) }).valido, true);
  });
  it('recusa lance antes da abertura, depois do prazo e de valor inválido', () => {
    const antes = calcularEstadoSessao(d, [], em(0));
    assert.equal(validarLance(d, antes, { licitanteId: 'L2', valor: 90_000, instante: em(0) }).valido, false);
    assert.equal(validarLance(d, aberta, { licitanteId: 'L2', valor: 90_000, instante: em(600) }).valido, false);
    assert.equal(validarLance(d, aberta, { licitanteId: 'L2', valor: 90_000.5, instante: em(10) }).valido, false);
    assert.throws(() => verificarAcaoSessao(d, aberta, lance(10, 'L2', 102_000)), comCodigo('LANCE_RECUSADO'));
  });
});

describe('calcularEstadoSessao — modo aberto (IN 73/2022, art. 23)', () => {
  const d = definicao();

  it('sem lances, encerra 10 minutos após a abertura', () => {
    const e = calcularEstadoSessao(d, [abertura], em(3600));
    assert.equal(e.fase, 'encerrada');
    assert.equal(e.encerradaEm, em(600));
    assert.equal(e.prorrogacoes, 0);
  });

  it('em curso: fase, prazo e melhor oferta pública', () => {
    const e = calcularEstadoSessao(d, [abertura, lance(30, 'L2', 99_000)], em(60));
    assert.equal(e.fase, 'lances_abertos');
    assert.equal(e.fimPrevisto, em(600));
    assert.equal(e.melhorValor, 99_000);
    assert.equal(e.liderId, 'L2');
    assert.equal(e.lances[0]?.intermediario, false);
  });

  it('lance nos 2 minutos finais prorroga por 2 minutos, sucessivamente, inclusive intermediário (art. 23, § 1º)', () => {
    const eventos = [abertura, lance(500, 'L2', 99_000), lance(590, 'L3', 103_000), lance(700, 'L1', 98_000)];
    const e = calcularEstadoSessao(d, eventos, em(3600));
    assert.equal(e.prorrogacoes, 3);
    assert.equal(e.encerradaEm, em(820));
    assert.equal(e.lances.find((l) => l.licitanteId === 'L3')?.intermediario, true);
    assert.ok(e.marcos.some((m) => /prorrogação automática/.test(m.descricao)));
  });

  it('lance no instante exato do fim não é aceito: a etapa termina antes', () => {
    const e = calcularEstadoSessao(d, [abertura, lance(600, 'L2', 90_000)], em(3600));
    assert.equal(e.lances.length, 0);
    assert.equal(e.recusados.length, 1);
    assert.equal(e.encerradaEm, em(600));
  });

  it('classificação: melhor lance; valores iguais por lance — vale quem registrou primeiro (art. 5º, I, da IN 73/2022)', () => {
    const e = calcularEstadoSessao(d, [abertura, lance(10, 'L2', 95_000), lance(20, 'L3', 95_000)], em(3600));
    const c = classificarSessaoDisputa(d, e);
    assert.deepEqual(c.classificacao.map((x) => x.id), ['L2', 'L3', 'L1', 'L4']);
    assert.equal(c.classificacao[1]?.origem, 'lance');
    assert.equal(c.classificacao[2]?.origem, 'proposta');
    assert.ok(c.memoria.some((m) => /registrado primeiro/.test(m)));
    assert.equal(c.empateDetectado, false);
  });

  it('propostas iguais sem lances: critérios do art. 60 por aplicarDesempate (IN 73/2022, art. 28)', () => {
    const empate = definicao('aberto', 'menor_preco', [100_000, 100_000]);
    const e = calcularEstadoSessao(empate, [abertura], em(3600));
    const c = classificarSessaoDisputa(empate, e);
    assert.equal(c.empateDetectado, true);
    assert.equal(c.sorteioNecessario, true);
    assert.deepEqual(c.classificacao.map((x) => x.posicao), [1, 1]);
  });

  it('sinaliza a melhor oferta acima do valor estimado (art. 59, III) sem desclassificar', () => {
    const caro = definicao('aberto', 'menor_preco', [130_000, 140_000]);
    const c = classificarSessaoDisputa(caro, calcularEstadoSessao(caro, [abertura], em(3600)));
    assert.equal(c.acimaDoEstimado, true);
    assert.equal(c.classificacao[0]?.id, 'L1');
    assert.ok(c.memoria.some((m) => /art\. 59, III/.test(m)));
  });
});

describe('calcularEstadoSessao — aberto e fechado (IN 73/2022, art. 24)', () => {
  const d = definicao('aberto_fechado', 'menor_preco', [100_000, 105_000, 109_000, 130_000]);
  const sorteio = 1 + Math.floor(sorteioDeterministico(73, 'fechamento-iminente', 0) * 600);

  it('15 minutos sem prorrogação, fechamento iminente sorteado em até 10 minutos e prazo de 5 minutos para o lance final', () => {
    const e = calcularEstadoSessao(d, [abertura, lance(890, 'L2', 99_000)], em(900 + sorteio + 1));
    assert.equal(e.prorrogacoes, 0);
    assert.equal(e.fase, 'lance_final_fechado');
    assert.equal(e.faseIniciadaEm, em(900 + sorteio));
    assert.equal(e.fimPrevisto, em(900 + sorteio + 300));
    assert.ok(sorteio >= 1 && sorteio <= 600);
    // Faixa de 10% a partir de 99.000: L2 (99.000), L1 (100.000) e L3 (109.000 > 108.900 fica de fora), mas o mínimo é 3.
    assert.deepEqual([...e.habilitados].sort(), ['L1', 'L2', 'L3']);
  });

  it('o fim sorteado do fechamento iminente é sigiloso', () => {
    const e = calcularEstadoSessao(d, [abertura], em(901));
    assert.equal(e.fase, 'fechamento_iminente');
    assert.equal(e.fimSigiloso, true);
  });

  it('lance final é único, sigiloso até o fim do prazo e depois classifica (art. 24, §§ 2º, 3º e 5º)', () => {
    const inicioFinal = 900 + sorteio;
    const eventos = [abertura, lance(inicioFinal + 10, 'L3', 98_000), lance(inicioFinal + 20, 'L3', 97_000)];
    const durante = calcularEstadoSessao(d, eventos, em(inicioFinal + 30));
    assert.equal(durante.recusados.length, 1);
    assert.equal(durante.melhorValor, 100_000, 'o lance final não altera a melhor oferta pública');
    assert.equal(classificarSessaoDisputa(d, durante).classificacao[0]?.id, 'L1');
    const depois = calcularEstadoSessao(d, eventos, em(inicioFinal + 400));
    assert.equal(depois.fase, 'encerrada');
    const c = classificarSessaoDisputa(d, depois);
    assert.equal(c.classificacao[0]?.id, 'L3');
    assert.equal(c.classificacao[0]?.origem, 'lance_final');
  });

  it('licitante fora da faixa não dá lance final', () => {
    const e = calcularEstadoSessao(d, [abertura], em(900 + sorteio + 1));
    assert.equal(validarLance(d, e, { licitanteId: 'L4', valor: 90_000, instante: em(900 + sorteio + 2) }).valido, false);
  });
});

describe('calcularEstadoSessao — fechado e aberto (IN 73/2022, art. 25)', () => {
  it('só as propostas na faixa (ou as 3 melhores) seguem para a etapa aberta', () => {
    const d = definicao('fechado_aberto', 'menor_preco', [100_000, 105_000, 130_000, 140_000]);
    const e = calcularEstadoSessao(d, [abertura], em(1));
    assert.equal(e.fase, 'lances_abertos');
    assert.deepEqual(e.habilitados, ['L1', 'L2', 'L3']);
    assert.equal(validarLance(d, e, { licitanteId: 'L4', valor: 90_000, instante: em(2) }).valido, false);
  });
});

describe('técnica e preço (art. 36, § 2º)', () => {
  it('pontuarTecnicaEPreco: nota de preço proporcional ao menor preço e peso técnico de até 70%', () => {
    const r = pontuarTecnicaEPreco(
      [
        { id: 'A', notaTecnica: 90, preco: 120_000 },
        { id: 'B', notaTecnica: 70, preco: 100_000 },
      ],
      70,
    );
    assert.deepEqual(r, [
      { id: 'A', notaTecnica: 90, notaPreco: 83.33, notaFinal: 88 },
      { id: 'B', notaTecnica: 70, notaPreco: 100, notaFinal: 79 },
    ]);
    assert.throws(() => pontuarTecnicaEPreco([{ id: 'A', notaTecnica: 90, preco: 1 }], 75), comCodigo('PESO_TECNICO_INVALIDO'));
  });

  it('modo fechado: propostas divulgadas na abertura e classificadas pela nota final', () => {
    const d: DefinicaoSessaoDisputa = {
      ...definicao('fechado', 'tecnica_e_preco', [120_000, 100_000]),
      participantes: [
        { id: 'A', nome: 'A', propostaInicial: 120_000, notaTecnica: 90 },
        { id: 'B', nome: 'B', propostaInicial: 100_000, notaTecnica: 70 },
      ],
    };
    const e = calcularEstadoSessao(d, [abertura], em(1));
    assert.equal(e.fase, 'encerrada');
    const c = classificarSessaoDisputa(d, e);
    assert.deepEqual(c.classificacao.map((x) => [x.id, x.notaFinal]), [['A', 88], ['B', 79]]);
    assert.equal(c.classificacao[0]?.valorConsiderado, 120_000);
  });

  it('exige nota técnica de cada participante', () => {
    const d = definicao('fechado', 'tecnica_e_preco', [100_000]);
    assert.throws(() => calcularEstadoSessao(d, [], em(0)), comCodigo('PARTICIPANTES_INVALIDOS'));
  });
});

describe('maior desconto (art. 34, § 2º)', () => {
  it('o maior percentual vence e o valor considerado é a referência com o desconto', () => {
    const d = definicao('aberto', 'maior_desconto', [2, 3.5], {}, { valorReferencia: 1_000_000 });
    const e = calcularEstadoSessao(d, [abertura, lance(10, 'L1', 4.25)], em(3600));
    const c = classificarSessaoDisputa(d, e);
    assert.equal(c.classificacao[0]?.id, 'L1');
    assert.equal(c.classificacao[0]?.valorConsiderado, 957_500);
    assert.equal(c.acimaDoEstimado, null);
    assert.equal(validarLance(d, calcularEstadoSessao(d, [abertura], em(1)), { licitanteId: 'L1', valor: 1.5, instante: em(1) }).valido, false);
  });
});

describe('reinício da disputa aberta (art. 56, § 4º) e negociação (art. 61)', () => {
  const d = definicao('aberto', 'menor_preco', [100_000, 102_000, 104_000]);
  const base = [abertura, lance(30, 'L1', 90_000)];

  it('cabe com diferença de ao menos 5% entre a 1ª e a 2ª; só intermediários e sem o primeiro colocado', () => {
    const encerrada = calcularEstadoSessao(d, base, em(700));
    const r = avaliarReinicioDisputa(d, encerrada);
    assert.equal(r.cabivel, true);
    assert.equal(r.diferencaPercentual, 13.33);
    const eventos = [...base, { tipo: 'reinicio', instante: em(700) } as EventoSessaoDisputa];
    const reiniciada = calcularEstadoSessao(d, eventos, em(701));
    assert.equal(reiniciada.fase, 'lances_abertos');
    assert.equal(reiniciada.rodada, 1);
    assert.deepEqual(reiniciada.habilitados, ['L2', 'L3']);
    assert.equal(validarLance(d, reiniciada, { licitanteId: 'L3', valor: 89_000, instante: em(702) }).valido, false);
    assert.deepEqual(validarLance(d, reiniciada, { licitanteId: 'L3', valor: 95_000, instante: em(702) }), { valido: true, intermediario: true });
    const final = calcularEstadoSessao(d, [...eventos, lance(710, 'L3', 95_000)], em(5000));
    assert.equal(final.fase, 'encerrada');
    assert.deepEqual(classificarSessaoDisputa(d, final).classificacao.map((c) => c.id), ['L1', 'L3', 'L2']);
  });

  it('não cabe com diferença menor que 5%, no modo fechado nem antes do encerramento', () => {
    const perto = calcularEstadoSessao(d, [abertura, lance(30, 'L1', 99_000)], em(700));
    assert.equal(avaliarReinicioDisputa(d, perto).cabivel, false);
    assert.equal(avaliarReinicioDisputa(d, calcularEstadoSessao(d, base, em(40))).cabivel, false);
    assert.throws(() => verificarAcaoSessao(d, perto, { tipo: 'reinicio', instante: em(700) }), comCodigo('ACAO_SESSAO_INVALIDA'));
  });

  it('negociação só com o primeiro colocado e por oferta mais vantajosa; entra na classificação e na ata', () => {
    const encerrada = calcularEstadoSessao(d, base, em(700));
    assert.throws(() => verificarAcaoSessao(d, encerrada, { tipo: 'negociacao', instante: em(700), licitanteId: 'L2', valor: 80_000 }), comCodigo('ACAO_SESSAO_INVALIDA'));
    assert.throws(() => verificarAcaoSessao(d, encerrada, { tipo: 'negociacao', instante: em(700), licitanteId: 'L1', valor: 91_000 }), comCodigo('ACAO_SESSAO_INVALIDA'));
    const eventos = [...base, { tipo: 'negociacao', instante: em(700), licitanteId: 'L1', valor: 88_000 } as EventoSessaoDisputa];
    const negociada = calcularEstadoSessao(d, eventos, em(710));
    const c = classificarSessaoDisputa(d, negociada);
    assert.equal(c.classificacao[0]?.valorConsiderado, 88_000);
    assert.equal(c.classificacao[0]?.origem, 'negociacao');
    assert.equal(avaliarReinicioDisputa(d, negociada).cabivel, false);
    const concluida = calcularEstadoSessao(d, [...eventos, { tipo: 'conclusao', instante: em(720) }], em(730));
    assert.equal(concluida.fase, 'concluida');
    const ata = redigirAtaSessaoDisputa(d, concluida, classificarSessaoDisputa(d, concluida), [], {
      uso: 'simulacao',
      processo: { numeroSei: '08000.000001/2026-00', titulo: 'Processo sintético', uasg: '930002' },
      conduzidaPor: 'Agente sintético',
      emitidaEm: em(730),
      idCompra: null,
      vinculos: [],
      proveniencia: null,
    });
    assert.match(ata.texto, /## 6\. Negociação/);
    assert.match(ata.texto, /R\$ 900,00 → R\$ 880,00/);
    assert.match(ata.texto, /requer revisão humana/);
    assert.match(ata.texto, /não substitui a sessão pública oficial/);
    assert.ok(ata.fontes.some((f) => /IN SEGES\/ME 73\/2022/.test(f)));
  });
});

describe('classificarOfertas — ofertas avulsas (sessão acompanhada)', () => {
  it('classifica valores transcritos com a regra de registro e o art. 60', () => {
    const d = definicao('aberto', 'menor_preco', [100_000, 100_000, 100_000]);
    const c = classificarOfertas(d, [
      { licitanteId: 'L1', valor: 90_000, instante: em(20), origem: 'lance' },
      { licitanteId: 'L2', valor: 90_000, instante: em(10), origem: 'lance' },
      { licitanteId: 'L3', valor: 95_000, instante: null, origem: 'proposta' },
    ]);
    assert.deepEqual(c.classificacao.map((x) => x.id), ['L2', 'L1', 'L3']);
  });
});

describe('simulador de licitantes sintéticos (PoC-03)', () => {
  const ids = ['A', 'B', 'C', 'D'];
  const propostas = propostasIniciaisSimuladas(2026, 4, 'menor_preco', 400_000_000);
  const d: DefinicaoSessaoDisputa = {
    criterio: 'menor_preco',
    modo: 'aberto',
    parametros: parametrosPadraoDisputa('aberto', 'menor_preco'),
    participantes: ids.map((id, i) => ({ id, nome: `Empresa ${id}`, propostaInicial: propostas[i]?.propostaInicial ?? 0 })),
    valorReferencia: 400_000_000,
    semente: 2026,
  };
  const perfis = perfisCenarioSimulacao('conluio_e_robo', ids, ['B', 'C']);

  it('propostas iniciais entre 98% e 108% da referência, em reais inteiros, e determinísticas', () => {
    for (const p of propostas) {
      assert.ok(p.propostaInicial >= 392_000_000 && p.propostaInicial <= 432_000_000);
      assert.equal(p.propostaInicial % 100, 0);
    }
    assert.deepEqual(propostasIniciaisSimuladas(2026, 4, 'menor_preco', 400_000_000), propostas);
    assert.throws(() => propostasIniciaisSimuladas(1, 4, 'menor_preco', null), comCodigo('VALOR_REFERENCIA_OBRIGATORIO'));
  });

  it('perfis do cenário: o par vinculado combina; os demais são lance tardio e robô', () => {
    assert.deepEqual(perfis, { B: 'combinado', C: 'combinado', A: 'tardio', D: 'robo' });
    assert.deepEqual(perfisCenarioSimulacao('conluio_e_robo', ids), { B: 'combinado', C: 'combinado', A: 'tardio', D: 'robo' });
    assert.deepEqual(Object.values(perfisCenarioSimulacao('concorrencia', ids)), ['competitivo', 'competitivo', 'tardio', 'conservador']);
  });

  it('mesma semente, mesmos lances; todos válidos pelo rito; encerra com prorrogação', () => {
    const a = calcularEstadoSessaoSimulada(d, [abertura], em(7200), perfis);
    const b = calcularEstadoSessaoSimulada(d, [abertura], em(7200), perfis);
    assert.deepEqual(a, b);
    assert.equal(a.fase, 'encerrada');
    assert.ok(a.lances.length >= 20, `lances: ${a.lances.length}`);
    assert.ok(a.prorrogacoes >= 1);
    assert.equal(a.recusados.length, 0);
    assert.ok(a.lances.every((l) => l.origem === 'simulador'));
    const lancesPar = a.lances.filter((l) => l.licitanteId === 'B' || l.licitanteId === 'C');
    assert.ok(lancesPar.length >= 10);
  });

  it('o estado parcial é prefixo do estado final (a sala ao vivo mostra os lances até o instante)', () => {
    const parcial = calcularEstadoSessaoSimulada(d, [abertura], em(60), perfis);
    const final = calcularEstadoSessaoSimulada(d, [abertura], em(7200), perfis);
    assert.equal(parcial.fase, 'lances_abertos');
    assert.deepEqual(parcial.lances, final.lances.slice(0, parcial.lances.length));
  });

  it('lance registrado no meio da simulação é respeitado pelos sintéticos', () => {
    const comLance = calcularEstadoSessaoSimulada(d, [abertura, lance(20, 'A', 300_000_000)], em(7200), perfis);
    assert.ok(comLance.lances.some((l) => l.origem === 'registrado' && l.licitanteId === 'A'));
    assert.equal(comLance.recusados.length, 0);
    assert.equal(classificarSessaoDisputa(d, comLance).classificacao[0]?.id, 'A');
  });

  it('funciona nos três modos com etapa aberta e no maior desconto', () => {
    for (const modo of ['aberto_fechado', 'fechado_aberto'] as const) {
      const m = { ...d, modo, parametros: parametrosPadraoDisputa(modo, 'menor_preco') };
      assert.equal(calcularEstadoSessaoSimulada(m, [abertura], em(7200), perfis).fase, 'encerrada', modo);
    }
    const desconto: DefinicaoSessaoDisputa = {
      ...d,
      criterio: 'maior_desconto',
      participantes: d.participantes.map((p, i) => ({ ...p, propostaInicial: 1 + i })),
    };
    const e = calcularEstadoSessaoSimulada(desconto, [abertura], em(7200), perfis);
    assert.equal(e.fase, 'encerrada');
    assert.ok(e.lances.every((l) => l.valor > 0 && l.valor < 100));
  });
});
