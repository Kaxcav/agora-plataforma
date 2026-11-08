import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as dominio from '../src/index.ts';
import { ErroDominio, paraCentavos } from '../src/index.ts';

describe('ErroDominio', () => {
  it('é um Error com nome, código e mensagem', () => {
    const erro = new ErroDominio('CODIGO_TESTE', 'Mensagem de teste');
    assert.ok(erro instanceof Error);
    assert.ok(erro instanceof ErroDominio);
    assert.equal(erro.name, 'ErroDominio');
    assert.equal(erro.codigo, 'CODIGO_TESTE');
    assert.equal(erro.message, 'Mensagem de teste');
  });

  it('é lançado pelas funções do domínio com código estável', () => {
    assert.throws(
      () => paraCentavos('abc'),
      (e: unknown) => e instanceof ErroDominio && e.codigo === 'MOEDA_INVALIDA',
    );
  });
});

describe('index (superfície pública)', () => {
  const funcoes = [
    'ehCentavos', 'paraCentavos', 'formatarMoeda', 'formatarMoedaCompacta', 'somar', 'percentual', 'aplicarPercentual',
    'somenteDigitos', 'validarCpf', 'validarCnpj', 'formatarCpf', 'formatarCnpj', 'tipoDocumento', 'mascararCpf',
    'mascararDocumento', 'mascararEmail', 'mascararTelefone', 'mascararNome',
    'validarDataISO', 'hojeISO', 'adicionarDias', 'diasEntre', 'diaDaSemana', 'pascoa', 'feriadosNacionais', 'ehDiaUtil',
    'adicionarDiasUteis', 'diasUteisEntre', 'proximoDiaUtil', 'contarPrazo', 'formatarData',
    'classificarVigencia', 'projetarQueimaSaldo',
    'limiteDispensaVigente', 'avaliarFracionamento', 'avaliarAditivo',
    'sancoesCabiveis', 'calcularDosimetriaMulta', 'prazoDefesa', 'prazoRegistroCeisCnep', 'vigenciaSancao',
    'aplicarDesempate', 'validarEtp', 'analisarCestaPrecos', 'verificarSegregacao',
    'prazoMinimoPropostas', 'dataMinimaAberturaPropostas', 'prazoAvisoDispensaEletronica', 'prazoDivulgacaoContratoPncp',
    'situacaoDivulgacaoPncp', 'sinalizarArtigoLuxo', 'calcularIdc', 'regrasPorTela', 'regrasPorEtapa',
  ] as const;
  const constantes = [
    'LIMITES_DISPENSA', 'INFRACOES_ART_155', 'PARAMETROS_DOSIMETRIA_PADRAO', 'INCISOS_ETP', 'PARES_CONFLITANTES',
    'TERMOS_INDICATIVOS_LUXO', 'PESOS_IDC_PADRAO', 'CATALOGO_REGRAS',
  ] as const;
  const exportados: Record<string, unknown> = { ...dominio };

  it('exporta todas as funções da especificação', () => {
    for (const nome of funcoes) assert.equal(typeof exportados[nome], 'function', nome);
  });

  it('exporta todas as constantes da especificação', () => {
    for (const nome of constantes) assert.equal(typeof exportados[nome], 'object', nome);
  });

  it('não expõe utilitários internos', () => {
    for (const nome of ['arredondar', 'lerData', 'escreverData', 'adicionarMeses', 'exigirInteiro']) {
      assert.equal(exportados[nome], undefined, nome);
    }
  });
});
