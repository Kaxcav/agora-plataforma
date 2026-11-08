import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  avaliarAlertaProrrogacao,
  avaliarDecisaoExtincao,
  avaliarInstauracaoExtincao,
  avaliarProrrogacao,
  avaliarReajuste,
  avaliarReequilibrio,
  avaliarRepactuacao,
  avaliarTermoAditivo,
  interpretarLocalizacaoTermoPncp,
  numeroTermoContratual,
  situacaoDivulgacaoTermoPncp,
  situacaoProrrogacao,
  tipoTermoContratoPncp,
  vigenciaMaximaAnos,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const JUSTIFICATIVA = 'Ampliação do atendimento nas unidades regionais, conforme estudo de demanda do processo.';
const baseAditivo = {
  valorInicialAtualizado: 1_000_000,
  acrescimosAnteriores: 0,
  supressoesAnteriores: 0,
  justificativa: JUSTIFICATIVA,
  vigenciaFim: '2027-06-30',
  hoje: '2026-11-09',
};

describe('avaliarTermoAditivo (RN-32, art. 125)', () => {
  it('acréscimo dentro de 25% é permitido e conta no limite', () => {
    const r = avaliarTermoAditivo({ ...baseAditivo, tipo: 'acrescimo', valor: 100_000 });
    assert.equal(r.permitido, true);
    assert.equal(r.contaNoLimite, 'acrescimo');
    assert.equal(r.efeitoValor, 100_000);
    assert.equal(r.percentualAcumulado, 10);
    assert.equal(r.limitePercentual, 25);
    assert.equal(r.margemRestante, 150_000);
    assert.equal(r.fundamento, 'Lei 14.133/2021, arts. 124 e 125');
  });

  it('acréscimo acima do limite é recusado (trava), somando os anteriores', () => {
    const r = avaliarTermoAditivo({ ...baseAditivo, acrescimosAnteriores: 200_000, tipo: 'acrescimo', valor: 50_001 });
    assert.equal(r.permitido, false);
    assert.match(r.motivos.join(' '), /acima do limite de 25% \(art\. 125\)\. Trava RN-32/);
    const borda = avaliarTermoAditivo({ ...baseAditivo, acrescimosAnteriores: 200_000, tipo: 'acrescimo', valor: 50_000 });
    assert.equal(borda.permitido, true);
  });

  it('reforma de edifício ou de equipamento: acréscimos até 50%; supressões continuam em 25%', () => {
    assert.equal(avaliarTermoAditivo({ ...baseAditivo, tipo: 'acrescimo', valor: 400_000, reformaEdificioOuEquipamento: true }).permitido, true);
    assert.equal(avaliarTermoAditivo({ ...baseAditivo, tipo: 'acrescimo', valor: 500_001, reformaEdificioOuEquipamento: true }).permitido, false);
    assert.equal(avaliarTermoAditivo({ ...baseAditivo, tipo: 'supressao', valor: 260_000, reformaEdificioOuEquipamento: true }).permitido, false);
  });

  it('acréscimos e supressões não se compensam', () => {
    const r = avaliarTermoAditivo({ ...baseAditivo, acrescimosAnteriores: 240_000, supressoesAnteriores: 240_000, tipo: 'acrescimo', valor: 20_000 });
    assert.equal(r.permitido, false);
    const s = avaliarTermoAditivo({ ...baseAditivo, acrescimosAnteriores: 240_000, tipo: 'supressao', valor: 20_000 });
    assert.equal(s.permitido, true);
    assert.equal(s.efeitoValor, -20_000);
  });

  it('alteração qualitativa: com reflexo conta no limite; sem reflexo não tem valor', () => {
    const com = avaliarTermoAditivo({ ...baseAditivo, tipo: 'qualitativa', efeitoFinanceiro: 'acrescimo', valor: 300_000 });
    assert.equal(com.permitido, false, 'qualitativa com reflexo também respeita o limite');
    const sem = avaliarTermoAditivo({ ...baseAditivo, tipo: 'qualitativa', efeitoFinanceiro: 'nenhum', valor: 0 });
    assert.equal(sem.permitido, true);
    assert.equal(sem.contaNoLimite, null);
    assert.equal(avaliarTermoAditivo({ ...baseAditivo, tipo: 'qualitativa', efeitoFinanceiro: 'nenhum', valor: 10 }).permitido, false);
  });

  it('prazo e reequilíbrio ficam fora do limite do art. 125', () => {
    const prazo = avaliarTermoAditivo({ ...baseAditivo, tipo: 'prazo', valor: 900_000 });
    assert.equal(prazo.permitido, true);
    assert.equal(prazo.contaNoLimite, null);
    assert.match(prazo.explicacao, /RN-33/);
    const reducao = avaliarTermoAditivo({ ...baseAditivo, tipo: 'reequilibrio', sentido: 'reducao', valor: 400_000 });
    assert.equal(reducao.permitido, true);
    assert.equal(reducao.efeitoValor, -400_000);
  });

  it('exige justificativa, vigência em curso e contrato não extinto', () => {
    const r = avaliarTermoAditivo({ ...baseAditivo, tipo: 'acrescimo', valor: 1, justificativa: 'curta', hoje: '2027-07-01', contratoExtinto: true });
    assert.equal(r.permitido, false);
    assert.equal(r.motivos.length, 3);
  });

  it('entrada inválida gera ErroDominio', () => {
    assert.throws(() => avaliarTermoAditivo({ ...baseAditivo, tipo: 'acrescimo', valor: -1 }), comCodigo('ADITIVO_INVALIDO'));
    assert.throws(() => avaliarTermoAditivo({ ...baseAditivo, tipo: 'outro' as 'acrescimo', valor: 1 }), comCodigo('ADITIVO_INVALIDO'));
  });
});

describe('avaliarProrrogacao (RN-33, arts. 105 a 114)', () => {
  const continuo = {
    natureza: 'continuo' as const,
    vigenciaInicio: '2020-01-01',
    vigenciaFimAtual: '2026-12-31',
    novaVigenciaFim: '2027-12-31',
    hoje: '2026-11-09',
    vantajosidadeAtestada: true,
    precoCompativel: true,
    previsaoEdital: true,
    creditoOrcamentario: true,
  };

  it('contínuo com vantajosidade, preço compatível, edital e crédito: permitido até 10 anos', () => {
    const r = avaliarProrrogacao(continuo);
    assert.equal(r.permitido, true);
    assert.equal(r.limiteVigencia, '2029-12-31');
    assert.equal(r.prorrogacaoAutomatica, false);
    assert.equal(r.fundamento, 'Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114');
  });

  it('acima de 10 anos é recusado, com a indicação de nova licitação', () => {
    const r = avaliarProrrogacao({ ...continuo, novaVigenciaFim: '2030-01-01' });
    assert.equal(r.permitido, false);
    assert.match(r.motivos.join(' '), /vigência máxima de 10 anos .* nova licitação/);
    assert.equal(avaliarProrrogacao({ ...continuo, novaVigenciaFim: '2029-12-31' }).permitido, true);
  });

  it('sem atestado de vantajosidade, preço, edital ou crédito: cada falta vira motivo', () => {
    const r = avaliarProrrogacao({ ...continuo, vantajosidadeAtestada: false, precoCompativel: false, previsaoEdital: false, creditoOrcamentario: false });
    assert.equal(r.motivos.length, 4);
    assert.match(r.motivos.join(' '), /art\. 107/);
    assert.match(r.motivos.join(' '), /art\. 105/);
  });

  it('formalização depois do fim da vigência é recusada (exceto escopo)', () => {
    assert.equal(avaliarProrrogacao({ ...continuo, hoje: '2027-01-02' }).permitido, false);
  });

  it('TI estruturante: até 15 anos (art. 114)', () => {
    assert.equal(vigenciaMaximaAnos('ti_estruturante'), 15);
    assert.equal(avaliarProrrogacao({ ...continuo, natureza: 'ti_estruturante', novaVigenciaFim: '2034-12-31' }).permitido, true);
  });

  it('receita: 10 ou 35 anos, sem exigir vantajosidade de preço nem crédito', () => {
    const r = avaliarProrrogacao({
      natureza: 'receita_com_investimento',
      vigenciaInicio: '2020-01-01',
      vigenciaFimAtual: '2026-12-31',
      novaVigenciaFim: '2040-12-31',
      hoje: '2026-11-09',
      previsaoEdital: true,
    });
    assert.equal(r.permitido, true);
    assert.equal(r.limiteVigencia, '2054-12-31');
  });

  it('escopo sem culpa: prorrogação automática, mesmo depois do prazo (art. 111)', () => {
    const r = avaliarProrrogacao({
      natureza: 'escopo',
      vigenciaInicio: '2026-01-01',
      vigenciaFimAtual: '2026-10-31',
      novaVigenciaFim: '2027-02-28',
      hoje: '2026-11-09',
      causaAtraso: 'sem_culpa_contratado',
      creditoOrcamentario: true,
    });
    assert.equal(r.permitido, true);
    assert.equal(r.prorrogacaoAutomatica, true);
    assert.equal(r.limiteVigencia, null);
  });

  it('escopo com culpa do contratado: só com a mora constituída', () => {
    const base = {
      natureza: 'escopo' as const,
      vigenciaInicio: '2026-01-01',
      vigenciaFimAtual: '2026-12-31',
      novaVigenciaFim: '2027-02-28',
      hoje: '2026-11-09',
      causaAtraso: 'culpa_contratado' as const,
      creditoOrcamentario: true,
    };
    const sem = avaliarProrrogacao(base);
    assert.equal(sem.permitido, false);
    assert.match(sem.motivos.join(' '), /parágrafo único, I/);
    assert.equal(avaliarProrrogacao({ ...base, moraConstituida: true }).permitido, true);
    assert.equal(avaliarProrrogacao({ ...base, causaAtraso: undefined }).permitido, false);
  });

  it('nova data igual ou anterior e natureza inválida', () => {
    assert.equal(avaliarProrrogacao({ ...continuo, novaVigenciaFim: '2026-12-31' }).permitido, false);
    assert.throws(() => avaliarProrrogacao({ ...continuo, natureza: 'x' as 'continuo' }), comCodigo('PRORROGACAO_INVALIDA'));
  });
});

describe('avaliarAlertaProrrogacao (alertas de 120 dias)', () => {
  it('fora da janela de 120 dias não há alerta', () => {
    assert.equal(avaliarAlertaProrrogacao({ natureza: 'continuo', vigenciaInicio: '2024-01-01', vigenciaFim: '2027-12-31', hoje: '2026-11-09' }), null);
    assert.equal(avaliarAlertaProrrogacao({ natureza: 'continuo', vigenciaInicio: '2024-01-01', vigenciaFim: '2026-11-08', hoje: '2026-11-09' }), null);
  });

  it('dentro da janela: planejar, limite próximo, nova licitação, escopo e natureza ausente', () => {
    const planejar = avaliarAlertaProrrogacao({ natureza: 'continuo', vigenciaInicio: '2024-01-01', vigenciaFim: '2027-01-31', hoje: '2026-11-09' });
    assert.equal(planejar?.tipo, 'planejar_prorrogacao');
    assert.equal(planejar?.limiteVigencia, '2033-12-31');
    const limite = avaliarAlertaProrrogacao({ natureza: 'continuo', vigenciaInicio: '2017-03-01', vigenciaFim: '2027-01-31', hoje: '2026-11-09' });
    assert.equal(limite?.tipo, 'limite_prorrogacao');
    assert.match(limite?.mensagem ?? '', /limitada a 28\/02\/2027/);
    const nova = avaliarAlertaProrrogacao({ natureza: 'continuo', vigenciaInicio: '2017-02-01', vigenciaFim: '2027-01-31', hoje: '2026-11-09' });
    assert.equal(nova?.tipo, 'nova_licitacao');
    assert.match(nova?.mensagem ?? '', /não cabe nova prorrogação/);
    assert.equal(avaliarAlertaProrrogacao({ natureza: 'escopo', vigenciaInicio: '2026-01-01', vigenciaFim: '2027-01-31', hoje: '2026-11-09' })?.tipo, 'prorrogacao_automatica');
    assert.equal(avaliarAlertaProrrogacao({ natureza: null, vigenciaInicio: '2026-01-01', vigenciaFim: '2027-01-31', hoje: '2026-11-09' })?.tipo, 'natureza_nao_informada');
    assert.equal(situacaoProrrogacao({ natureza: 'continuo', vigenciaInicio: '2024-01-01', vigenciaFim: '2028-01-31', hoje: '2026-11-09' }).tipo, 'planejar_prorrogacao');
  });
});

describe('avaliarReajuste (art. 25, § 7º, e art. 92, § 3º)', () => {
  const base = { dataBase: '2025-10-15', ciclosAplicados: 0, percentual: 4.5, saldoContratual: 1_000_000, indice: 'IPCA', vigenciaFim: '2027-06-30' };

  it('antes de 12 meses da data-base é recusado', () => {
    const r = avaliarReajuste({ ...base, hoje: '2026-10-14' });
    assert.equal(r.permitido, false);
    assert.equal(r.aniversario, '2026-10-15');
    assert.match(r.motivos.join(' '), /interregno mínimo de 12 meses/);
    assert.equal(r.valor, 0);
  });

  it('depois do aniversário: calcula sobre o saldo e indica a apostila', () => {
    const r = avaliarReajuste({ ...base, hoje: '2026-10-15' });
    assert.equal(r.permitido, true);
    assert.equal(r.valor, 45_000);
    assert.deepEqual(r.periodo, { inicio: '2025-10-15', fim: '2026-10-14' });
    assert.match(r.explicacao, /apostila \(art\. 136, I\)/);
  });

  it('segundo ciclo conta 24 meses; índice negativo reduz o valor', () => {
    assert.equal(avaliarReajuste({ ...base, ciclosAplicados: 1, hoje: '2026-11-09' }).permitido, false);
    const r = avaliarReajuste({ ...base, ciclosAplicados: 1, hoje: '2027-10-15', vigenciaFim: '2028-01-31', percentual: -1.25 });
    assert.equal(r.permitido, true);
    assert.equal(r.valor, -12_500);
  });

  it('percentual zero, fora da faixa, aniversário depois da vigência e contrato extinto', () => {
    assert.equal(avaliarReajuste({ ...base, hoje: '2026-11-09', percentual: 0 }).permitido, false);
    assert.equal(avaliarReajuste({ ...base, hoje: '2026-11-09', percentual: 150 }).permitido, false);
    assert.equal(avaliarReajuste({ ...base, hoje: '2026-11-09', vigenciaFim: '2026-09-30' }).permitido, false);
    assert.equal(avaliarReajuste({ ...base, hoje: '2026-11-09', contratoExtinto: true }).permitido, false);
    assert.throws(() => avaliarReajuste({ ...base, hoje: '2026-11-09', percentual: Number.NaN }), comCodigo('REAJUSTE_INVALIDO'));
  });
});

describe('avaliarRepactuacao (art. 135)', () => {
  const base = {
    regimeMaoDeObra: 'dedicacao_exclusiva' as const,
    natureza: 'continuo' as const,
    solicitadaEm: '2026-11-01',
    efeitosDesde: '2026-11-01',
    vigenciaFim: '2027-04-30',
    hoje: '2026-11-09',
    clausulasNaoTrabalhistasExcluidas: true,
    componentes: [
      { descricao: 'Salário e encargos dos postos', origem: 'mao_de_obra' as const, dataBase: '2025-09-01', valorMensalAnterior: 1_000_000, valorMensalNovo: 1_060_000, documento: 'Convenção coletiva sintética 2026' },
      { descricao: 'Uniformes e materiais', origem: 'insumos' as const, dataBase: '2025-10-01', valorMensalAnterior: 50_000, valorMensalNovo: 52_000, documento: 'Planilha de custos' },
    ],
  };

  it('demonstração analítica com anualidade cumprida: variação mensal × meses de vigência', () => {
    const r = avaliarRepactuacao(base);
    assert.equal(r.permitido, true, r.motivos.join(' '));
    assert.equal(r.variacaoMensal, 62_000);
    assert.equal(r.mesesRemanescentes, 6);
    assert.equal(r.valor, 372_000);
    assert.equal(r.componentes[0]?.percentual, 6);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 135 e art. 136, I');
  });

  it('interregno de 1 ano por componente (art. 135, § 3º)', () => {
    const r = avaliarRepactuacao({ ...base, componentes: [{ ...base.componentes[0]!, dataBase: '2026-01-01' }] });
    assert.equal(r.permitido, false);
    assert.match(r.motivos.join(' '), /só se completa em 01\/01\/2027 \(art\. 135, § 3º\)/);
  });

  it('só para dedicação exclusiva ou predominância de mão de obra, com cláusulas não trabalhistas excluídas', () => {
    const r = avaliarRepactuacao({ ...base, regimeMaoDeObra: 'sem_dedicacao', clausulasNaoTrabalhistasExcluidas: false });
    assert.equal(r.permitido, false);
    assert.equal(r.motivos.length, 2);
    assert.equal(avaliarRepactuacao({ ...base, componentes: [] }).permitido, false);
  });
});

describe('avaliarReequilibrio (art. 124, II, "d")', () => {
  const base = {
    enquadramento: 'fato_imprevisivel' as const,
    alocacaoRisco: 'contratante' as const,
    dataEvento: '2026-08-01',
    solicitadoEm: '2026-09-01',
    vigenciaInicio: '2026-01-01',
    vigenciaFim: '2026-12-31',
    ultimaProrrogacaoEm: null,
    sentido: 'aumento' as const,
    valorPleiteado: 250_000,
    demonstracao: 'Memória de cálculo comparando os custos do insumo antes e depois do evento, com notas fiscais e cotações juntadas.',
    hoje: '2026-11-09',
  };

  it('risco da Administração, pedido na vigência e demonstração: apto à decisão', () => {
    const r = avaliarReequilibrio(base);
    assert.equal(r.permitido, true);
    assert.match(r.explicacao, /decisão é da autoridade competente/);
  });

  it('risco alocado à contratada é vedado, salvo tributo superveniente ou alteração unilateral', () => {
    assert.equal(avaliarReequilibrio({ ...base, alocacaoRisco: 'contratada' }).permitido, false);
    assert.match(avaliarReequilibrio({ ...base, alocacaoRisco: 'contratada' }).motivos.join(' '), /art\. 103, § 5º/);
    assert.equal(avaliarReequilibrio({ ...base, alocacaoRisco: 'contratada', enquadramento: 'tributo_superveniente' }).permitido, true);
    assert.equal(avaliarReequilibrio({ ...base, alocacaoRisco: 'compartilhado' }).observacoes.length, 1);
  });

  it('preclusão: evento antes da prorrogação e pedido depois dela (art. 131, parágrafo único)', () => {
    const r = avaliarReequilibrio({ ...base, ultimaProrrogacaoEm: '2026-08-15' });
    assert.equal(r.permitido, false);
    assert.match(r.motivos.join(' '), /antes da prorrogação/);
  });

  it('pedido fora da vigência, sem valor e sem demonstração', () => {
    const r = avaliarReequilibrio({ ...base, solicitadoEm: '2025-12-01', dataEvento: '2025-11-01', valorPleiteado: 0, demonstracao: 'curta' });
    assert.equal(r.motivos.length, 3);
    assert.throws(() => avaliarReequilibrio({ ...base, enquadramento: 'x' as 'caso_fortuito' }), comCodigo('REEQUILIBRIO_INVALIDO'));
  });
});

describe('extinção do contrato (arts. 137 a 139)', () => {
  const fundamentacao = 'Descumprimento reiterado dos prazos de entrega apontado em relatórios da fiscalização, com notificações sem regularização.';

  it('unilateral exige motivo do art. 137, I a IX, e prazo de defesa', () => {
    const r = avaliarInstauracaoExtincao({ forma: 'unilateral', motivo: 'art137_I', fundamentacao, prazoDefesaDiasUteis: 15 });
    assert.equal(r.permitido, true);
    assert.equal(r.exigeContraditorio, true);
    assert.equal(avaliarInstauracaoExtincao({ forma: 'unilateral', motivo: 'art137_I', fundamentacao }).permitido, false);
    const culpa = avaliarInstauracaoExtincao({ forma: 'unilateral', motivo: 'art137_p2_IV', fundamentacao, prazoDefesaDiasUteis: 15 });
    assert.equal(culpa.permitido, false);
    assert.match(culpa.motivos.join(' '), /art\. 138, I/);
  });

  it('consensual exige interesse da Administração; judicial exige a referência', () => {
    assert.equal(avaliarInstauracaoExtincao({ forma: 'consensual', motivo: 'art137_VIII', fundamentacao }).permitido, false);
    const consensual = avaliarInstauracaoExtincao({ forma: 'consensual', motivo: 'art137_VIII', fundamentacao, interesseAdministracao: true });
    assert.equal(consensual.permitido, true);
    assert.equal(consensual.exigeContraditorio, false);
    assert.equal(avaliarInstauracaoExtincao({ forma: 'judicial_arbitral', motivo: 'art137_V', fundamentacao, referenciaDecisao: '' }).permitido, false);
    assert.throws(() => avaliarInstauracaoExtincao({ forma: 'unilateral', motivo: 'art999' as 'art137_I', fundamentacao }), comCodigo('EXTINCAO_INVALIDA'));
  });

  const decisao = {
    forma: 'unilateral' as const,
    decisao: 'extinguir' as const,
    instauradaEm: '2026-10-01',
    hoje: '2026-11-09',
    vigenciaFim: '2027-06-30',
    dataEfeitos: '2026-11-10',
    fundamentacao: 'Defesa analisada e rejeitada; mantidos os descumprimentos.',
    prazoDefesaFim: '2026-10-22',
    defesaRegistrada: false,
    culpaAdministracao: false,
    efeitos: ['assuncao_objeto', 'execucao_garantia'] as const,
  };

  it('decide depois do prazo de defesa, com efeitos do art. 139', () => {
    const r = avaliarDecisaoExtincao(decisao);
    assert.equal(r.permitido, true, r.motivos.join(' '));
    assert.equal(r.efeitos.length, 2);
    assert.match(r.efeitos[0]?.descricao ?? '', /art\. 139, I/);
  });

  it('antes do fim do prazo de defesa, sem defesa registrada, não decide', () => {
    assert.equal(avaliarDecisaoExtincao({ ...decisao, prazoDefesaFim: '2026-11-20' }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, prazoDefesaFim: '2026-11-20', defesaRegistrada: true }).permitido, true);
  });

  it('efeitos do art. 139 só sem culpa da Administração; art. 138, § 2º, só com culpa; ocupação exige o ministro', () => {
    const consensual = avaliarDecisaoExtincao({ ...decisao, forma: 'consensual', prazoDefesaFim: null, culpaAdministracao: true });
    assert.equal(consensual.permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, forma: 'consensual', prazoDefesaFim: null, culpaAdministracao: true, efeitos: ['devolucao_garantia', 'pagamentos_devidos'] }).permitido, true);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, efeitos: ['devolucao_garantia'] }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, efeitos: ['ocupacao_local'] }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, efeitos: ['ocupacao_local'], autorizacaoMinistro: true }).permitido, true);
  });

  it('data dos efeitos dentro do intervalo; arquivamento sem efeitos', () => {
    assert.equal(avaliarDecisaoExtincao({ ...decisao, dataEfeitos: '2026-09-30' }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, dataEfeitos: '2027-07-01' }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, decisao: 'arquivar' }).permitido, false);
    assert.equal(avaliarDecisaoExtincao({ ...decisao, decisao: 'arquivar', efeitos: [] }).permitido, true);
  });
});

describe('termos no PNCP e numeração', () => {
  it('numera aditivos, apostilas e o termo de rescisão', () => {
    assert.equal(numeroTermoContratual('aditivo', 3), '3º Termo Aditivo');
    assert.equal(numeroTermoContratual('apostila', 1), '1º Apostilamento');
    assert.equal(numeroTermoContratual('rescisao', 1), 'Termo de Rescisão');
    assert.throws(() => numeroTermoContratual('aditivo', 0), comCodigo('TERMO_INVALIDO'));
  });

  it('prazo do art. 94 para o aditivo; apostila sem prazo de eficácia', () => {
    const pendente = situacaoDivulgacaoTermoPncp({ especie: 'aditivo', assinadoEm: '2026-11-09', origem: 'licitacao', divulgadoEm: null, hoje: '2026-11-10' });
    assert.equal(pendente.situacao, 'pendente_no_prazo');
    assert.ok(pendente.limite && pendente.limite > '2026-11-30');
    const divulgado = situacaoDivulgacaoTermoPncp({ especie: 'aditivo', assinadoEm: '2026-11-09', origem: 'contratacao_direta', divulgadoEm: '2026-11-10', hoje: '2026-11-10' });
    assert.equal(divulgado.situacao, 'divulgado_no_prazo');
    const vencido = situacaoDivulgacaoTermoPncp({ especie: 'aditivo', assinadoEm: '2026-01-05', origem: 'contratacao_direta', divulgadoEm: null, hoje: '2026-11-10' });
    assert.equal(vencido.situacao, 'pendente_vencido');
    assert.equal(situacaoDivulgacaoTermoPncp({ especie: 'apostila', assinadoEm: '2026-11-09', origem: 'licitacao', divulgadoEm: null, hoje: '2026-11-10' }).situacao, 'sem_prazo_de_eficacia');
  });

  it('interpreta o location do termo e o tipo do termo no PNCP', () => {
    const l = interpretarLocalizacaoTermoPncp('https://treina.pncp.gov.br/api/pncp/v1/orgaos/12345678000195/contratos/2026/412/termos/3');
    assert.deepEqual(l, { cnpj: '12345678000195', anoContrato: 2026, sequencialContrato: 412, sequencialTermo: 3 });
    assert.throws(() => interpretarLocalizacaoTermoPncp('/v1/orgaos/1/contratos/2026/1'), comCodigo('PNCP_LOCALIZACAO_INVALIDA'));
    assert.equal(tipoTermoContratoPncp('rescisao'), 1);
    assert.equal(tipoTermoContratoPncp('aditivo'), 2);
    assert.equal(tipoTermoContratoPncp('apostila'), 3);
  });
});
