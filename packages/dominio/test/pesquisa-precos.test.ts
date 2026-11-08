import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  enquadrarAmostraArt23,
  projetarValorEstimado,
  selecionarSugestoesPrecos,
  type AmostraPrecoExterna,
  type IndiceMensal,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09';

function amostra(origem: AmostraPrecoExterna['origem'], identificador: string, valorUnitario: number, data: string): AmostraPrecoExterna {
  return { origem, identificador, descricao: `Item de referência ${identificador}`, valorUnitario, data, local: 'UASG 999001' };
}

/** 12 meses de IPCA com a mesma variação mensal, de 2025-10 a 2026-09. */
function ipcaConstante(variacao: number): IndiceMensal[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = ((9 + i) % 12) + 1;
    const ano = 2025 + Math.floor((9 + i) / 12);
    return { competencia: `${ano}-${String(mes).padStart(2, '0')}`, valor: variacao };
  });
}

describe('enquadrarAmostraArt23 (art. 23, §§ 1º e 2º)', () => {
  it('bens e serviços: painel → § 1º, I; similares → § 1º, II (12 meses); notas fiscais → § 1º, V (12 meses)', () => {
    assert.deepEqual(
      ['painel_precos', 'contratacoes_similares', 'notas_fiscais'].map((o) => {
        const e = enquadrarAmostraArt23(o as AmostraPrecoExterna['origem'], 'bens');
        return [e?.fonteCotacao, e?.inciso, e?.prazoMeses];
      }),
      [
        ['painel_precos', 'art. 23, § 1º, I', null],
        ['contratacao_similar', 'art. 23, § 1º, II', 12],
        ['nota_fiscal', 'art. 23, § 1º, V', 12],
      ],
    );
  });

  it('obras e serviços de engenharia: Sinapi e Sicro → § 2º, I como tabela oficial; similares → § 2º, III; notas → § 2º, IV', () => {
    const sinapi = enquadrarAmostraArt23('sinapi', 'obras_servicos_engenharia_comuns');
    assert.equal(sinapi?.fonteCotacao, 'midia_especializada');
    assert.equal(sinapi?.inciso, 'art. 23, § 2º, I');
    assert.match(sinapi?.fundamento ?? '', /Sicro para infraestrutura de transportes/);
    assert.equal(enquadrarAmostraArt23('sicro', 'obras_servicos_engenharia_especiais')?.inciso, 'art. 23, § 2º, I');
    assert.equal(enquadrarAmostraArt23('contratacoes_similares', 'obras_servicos_engenharia_comuns')?.inciso, 'art. 23, § 2º, III');
    assert.equal(enquadrarAmostraArt23('notas_fiscais', 'obras_servicos_engenharia_comuns')?.inciso, 'art. 23, § 2º, IV');
  });

  it('fonte não prevista para o tipo de objeto → null; origem ou tipo inválidos → AMOSTRA_PRECO_INVALIDA', () => {
    assert.equal(enquadrarAmostraArt23('painel_precos', 'obras_servicos_engenharia_comuns'), null);
    assert.equal(enquadrarAmostraArt23('sinapi', 'servicos_comuns'), null);
    assert.throws(() => enquadrarAmostraArt23('internet' as never, 'bens'), comCodigo('AMOSTRA_PRECO_INVALIDA'));
    assert.throws(() => enquadrarAmostraArt23('sinapi', 'outro' as never), comCodigo('AMOSTRA_PRECO_INVALIDA'));
  });
});

describe('selecionarSugestoesPrecos (RF-25)', () => {
  it('bens: ordena painel, similares e notas; mais recentes primeiro; descarta similar com mais de 1 ano, data futura, repetida e valor zero', () => {
    const r = selecionarSugestoesPrecos(
      [
        amostra('notas_fiscais', 'NF-1', 10_050_00, '2026-10-05'),
        amostra('contratacoes_similares', 'PNCP-1', 9_800_00, '2026-09-15'),
        amostra('painel_precos', 'COMPRA-1', 10_000_00, '2026-10-01'),
        amostra('painel_precos', 'COMPRA-2', 10_200_00, '2026-10-03'),
        amostra('contratacoes_similares', 'PNCP-ANTIGO', 9_000_00, '2025-11-01'),
        amostra('painel_precos', 'COMPRA-FUTURA', 9_900_00, '2026-12-01'),
        amostra('painel_precos', 'compra-1', 10_000_00, '2026-10-01'),
        amostra('notas_fiscais', 'NF-ZERO', 0, '2026-10-01'),
        amostra('sinapi', 'SIN-1', 5_000_00, '2026-10-01'),
      ],
      { hoje: HOJE, tipoObjeto: 'bens' },
    );
    assert.deepEqual(
      r.sugestoes.map((s) => s.identificador),
      ['COMPRA-2', 'COMPRA-1', 'PNCP-1', 'NF-1'],
    );
    assert.deepEqual(
      r.descartadas.map((d) => [d.identificador, d.motivo.slice(0, 20)]),
      [
        ['PNCP-ANTIGO', 'Fora do período de 1'],
        ['COMPRA-FUTURA', 'Data posterior à dat'],
        ['compra-1', 'Registro repetido na'],
        ['NF-ZERO', 'Valor unitário ausen'],
        ['SIN-1', 'Sinapi e Sicro são p'],
      ],
    );
    assert.equal(r.alertas.length, 0);
    const primeira = r.sugestoes[0];
    assert.equal(primeira?.fonteCotacao, 'painel_precos');
    assert.equal(primeira?.inciso, 'art. 23, § 1º, I');
    assert.equal(primeira?.descricaoFonte, 'Painel de Preços — Item de referência COMPRA-2 (COMPRA-2, UASG 999001; art. 23, § 1º, I)');
    assert.match(r.aviso, /escolha do agente/);
  });

  it('similar no limite exato de 12 meses ainda vale; um dia além, não', () => {
    const r = selecionarSugestoesPrecos(
      [amostra('contratacoes_similares', 'NO-LIMITE', 100, '2025-11-09'), amostra('contratacoes_similares', 'ALEM', 100, '2025-11-08')],
      { hoje: HOJE, tipoObjeto: 'servicos_comuns' },
    );
    assert.deepEqual(r.sugestoes.map((s) => s.identificador), ['NO-LIMITE']);
    assert.deepEqual(r.descartadas.map((d) => d.identificador), ['ALEM']);
  });

  it('limite por fonte: excedentes contados, sem descartar', () => {
    const muitas = Array.from({ length: 7 }, (_, i) => amostra('painel_precos', `C-${i}`, 1000 + i, `2026-10-0${i + 1}`));
    const r = selecionarSugestoesPrecos(muitas, { hoje: HOJE, tipoObjeto: 'bens', limitePorOrigem: 5 });
    assert.equal(r.sugestoes.length, 5);
    assert.equal(r.excedentes, 2);
    assert.equal(r.sugestoes[0]?.identificador, 'C-6');
  });

  it('obras: Sinapi primeiro; painel descartado; sem Sinapi/Sicro → alerta SEM_REFERENCIA_SINAPI_SICRO', () => {
    const r = selecionarSugestoesPrecos(
      [amostra('contratacoes_similares', 'PNCP-9', 50_000, '2026-08-01'), amostra('sinapi', 'DEMO-101', 48_000, '2026-10-01'), amostra('painel_precos', 'X', 1, '2026-10-01')],
      { hoje: HOJE, tipoObjeto: 'obras_servicos_engenharia_comuns' },
    );
    assert.deepEqual(r.sugestoes.map((s) => s.origem), ['sinapi', 'contratacoes_similares']);
    assert.match(r.descartadas[0]?.motivo ?? '', /§ 2º, não prevê esta fonte/);
    assert.deepEqual(r.alertas.map((a) => a.codigo), ['POUCAS_SUGESTOES']);
    const sem = selecionarSugestoesPrecos([amostra('notas_fiscais', 'NF', 10, '2026-10-01')], { hoje: HOJE, tipoObjeto: 'obras_servicos_engenharia_comuns' });
    assert.deepEqual(sem.alertas.map((a) => a.codigo), ['SEM_REFERENCIA_SINAPI_SICRO', 'POUCAS_SUGESTOES']);
  });

  it('bens só com notas fiscais → alerta SEM_PARAMETRO_PRIORITARIO (IN 65/2021, art. 5º, § 1º)', () => {
    const r = selecionarSugestoesPrecos(
      [amostra('notas_fiscais', 'A', 10, '2026-10-01'), amostra('notas_fiscais', 'B', 11, '2026-10-02'), amostra('notas_fiscais', 'C', 12, '2026-10-03')],
      { hoje: HOJE, tipoObjeto: 'bens' },
    );
    assert.deepEqual(r.alertas.map((a) => [a.codigo, a.fundamento]), [['SEM_PARAMETRO_PRIORITARIO', 'IN SEGES/ME 65/2021, art. 5º, § 1º']]);
  });

  it('a identificação da fonte respeita o limite de 500 caracteres da cesta', () => {
    const longa = { ...amostra('painel_precos', 'L'.repeat(200), 100, '2026-10-01'), descricao: 'x '.repeat(600), local: 'y'.repeat(400) };
    const [s] = selecionarSugestoesPrecos([longa], { hoje: HOJE, tipoObjeto: 'bens' }).sugestoes;
    assert.ok((s?.descricaoFonte.length ?? 0) <= 500);
  });

  it('entradas inválidas → AMOSTRA_PRECO_INVALIDA ou DATA_INVALIDA', () => {
    assert.throws(() => selecionarSugestoesPrecos(null as never, { hoje: HOJE, tipoObjeto: 'bens' }), comCodigo('AMOSTRA_PRECO_INVALIDA'));
    assert.throws(() => selecionarSugestoesPrecos([], { hoje: '2026-13-01', tipoObjeto: 'bens' }), comCodigo('DATA_INVALIDA'));
    assert.throws(() => selecionarSugestoesPrecos([], { hoje: HOJE, tipoObjeto: 'bens', limitePorOrigem: 0 }), comCodigo('AMOSTRA_PRECO_INVALIDA'));
    assert.throws(() => selecionarSugestoesPrecos([], { hoje: HOJE, tipoObjeto: 'bens', limitePorOrigem: 51 }), comCodigo('AMOSTRA_PRECO_INVALIDA'));
  });
});

describe('projetarValorEstimado (RIA-11)', () => {
  it('IPCA constante de 0,5% ao mês por 181 dias, sem câmbio → fator 1,030103 e R$ 10.301,03 sobre R$ 10.000,00', () => {
    const r = projetarValorEstimado({ valorBase: 1_000_000, dataBase: HOJE, dataPrevista: '2027-05-09', ipca: ipcaConstante(0.5) });
    assert.equal(r.meses, 5.95);
    assert.equal(r.fatorCentral, 1.030103);
    assert.equal(r.valorProjetado, 1_030_103);
    assert.equal(r.variacaoPercentual, 3.01);
    assert.deepEqual(r.faixa, { minimo: 1_030_103, maximo: 1_030_103 }, 'sem dispersão, a faixa colapsa no valor central');
    assert.equal(r.inflacao.taxaMensalMedia, 0.5);
    assert.equal(r.inflacao.periodo, '10/2025 a 09/2026');
    assert.equal(r.inflacao.acumuladoPeriodo, 6.17);
    assert.equal(r.cambio, null);
    assert.equal(r.sinal.nivel, 'informativo');
    assert.match(r.premissas.join(' '), /nenhuma parcela do valor foi indicada como sujeita à variação cambial/);
    assert.match(r.aviso, /Requer revisão humana/);
    assert.match(r.fundamento, /art\. 25, § 7º/);
  });

  it('metade do valor sujeita ao câmbio com alta de 1% ao mês → combina os dois fatores e sinaliza atenção acima de 5%', () => {
    const cambio: IndiceMensal[] = Array.from({ length: 13 }, (_, i) => {
      const mes = ((8 + i) % 12) + 1;
      const ano = 2025 + Math.floor((8 + i) / 12);
      return { competencia: `${ano}-${String(mes).padStart(2, '0')}`, valor: 5 * 1.01 ** i };
    });
    const r = projetarValorEstimado({
      valorBase: 1_000_000,
      dataBase: HOJE,
      dataPrevista: '2027-11-09',
      ipca: ipcaConstante(0.5),
      cambio,
      percentualCambial: 50,
    });
    const m = 365 / 30.4375;
    const esperado = 0.5 * 1.005 ** m + 0.5 * 1.01 ** m;
    assert.equal(r.fatorCentral, Math.round(esperado * 1e6) / 1e6);
    assert.equal(r.valorProjetado, Math.round(1_000_000 * esperado));
    assert.equal(r.cambio?.participacao, 50);
    assert.equal(r.cambio?.taxaMensalMedia, 1);
    assert.equal(r.cambio?.competencias, 13);
    assert.equal(r.sinal.nivel, 'atencao');
    assert.ok(r.variacaoPercentual >= 5);
  });

  it('usa só os 12 últimos meses e calcula faixa com o desvio das variações', () => {
    const serie = [...ipcaConstante(0.4), { competencia: '2025-09', valor: 5 }];
    serie[11] = { competencia: '2026-09', valor: 1.2 };
    const r = projetarValorEstimado({ valorBase: 500_000, dataBase: HOJE, dataPrevista: '2027-02-09', ipca: serie });
    assert.equal(r.inflacao.competencias, 12);
    assert.ok(r.faixa.minimo < r.valorProjetado && r.valorProjetado < r.faixa.maximo);
  });

  it('entradas inválidas → PROJECAO_INVALIDA', () => {
    const ok = { valorBase: 1000, dataBase: HOJE, dataPrevista: '2027-05-09', ipca: ipcaConstante(0.5) };
    assert.throws(() => projetarValorEstimado({ ...ok, dataPrevista: HOJE }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, dataPrevista: '2029-12-01' }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, valorBase: 0 }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, ipca: ipcaConstante(0.5).slice(0, 5) }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, ipca: [...ipcaConstante(0.5), { competencia: '2026-09', valor: 1 }] }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, ipca: [{ competencia: '2026/09', valor: 1 }] }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, percentualCambial: 120 }), comCodigo('PROJECAO_INVALIDA'));
    assert.throws(() => projetarValorEstimado({ ...ok, percentualCambial: 30 }), comCodigo('PROJECAO_INVALIDA'), 'câmbio exigido quando há parcela cambial');
    assert.throws(() => projetarValorEstimado({ ...ok, dataBase: 'ontem' }), comCodigo('DATA_INVALIDA'));
  });
});

describe('catálogo — RF-25 e RIA-11', () => {
  it('RF-25 e RIA-11 na etapa 3, com o art. 23 e as funções do domínio', () => {
    const rf = CATALOGO_REGRAS.find((r) => r.id === 'RF-25');
    const ria = CATALOGO_REGRAS.find((r) => r.id === 'RIA-11');
    assert.equal(rf?.etapa, 3);
    assert.match(rf?.fundamento ?? '', /art\. 23, §§ 1º e 2º/);
    assert.ok(rf?.implementacao.includes('selecionarSugestoesPrecos'));
    assert.equal(ria?.tipo, 'RIA');
    assert.equal(ria?.etapa, 3);
    assert.ok(ria?.implementacao.includes('projetarValorEstimado'));
    assert.match(ria?.descricao ?? '', /requer revisão humana/);
  });
});
