import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CERTIDOES_REGULARIDADE,
  ErroDominio,
  avaliarChecklistRegularidade,
  classificarRegistroSancaoExterna,
  situacaoCertidao,
  situacaoRegistroCeisCnep,
  validarCertidao,
  type CertidaoRegularidade,
  type EntradaChecklistRegularidade,
  type RegistroCadastroSancoes,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

const HOJE = '2026-11-09';
const AGORA = '2026-11-09T13:00:00.000Z';

function certidao(tipo: CertidaoRegularidade['tipo'], validaAte: string, alteracoes: Partial<CertidaoRegularidade> = {}): CertidaoRegularidade {
  return { tipo, numero: `${tipo.toUpperCase()}-0001`, emitidaEm: '2026-11-01', validaAte, resultado: 'negativa', ...alteracoes };
}

const CERTIDOES_VALIDAS: CertidaoRegularidade[] = [
  certidao('fiscal_federal', '2027-04-30'),
  certidao('fgts', '2026-12-01'),
  certidao('trabalhista', '2027-04-30'),
];

function registro(alteracoes: Partial<RegistroCadastroSancoes> = {}): RegistroCadastroSancoes {
  return {
    cadastro: 'CEIS',
    tipoSancao: 'Inidoneidade - Lei 14.133/2021',
    orgaoSancionador: 'Órgão federal de demonstração',
    esfera: 'Federal',
    uf: 'DF',
    dataInicio: '2026-01-10',
    dataFim: '2029-01-10',
    numeroProcesso: '00000.000001/2026-00',
    fundamentacao: 'Art. 156, § 5º',
    abrangencia: null,
    ...alteracoes,
  };
}

function entrada(alteracoes: Partial<EntradaChecklistRegularidade> = {}): EntradaChecklistRegularidade {
  return {
    momento: 'assinatura',
    hoje: HOJE,
    agora: AGORA,
    consulta: { fonte: 'Base simulada', consultadoEm: '2026-11-09T12:30:00.000Z', registros: [] },
    consultaObrigatoria: true,
    sancoesAgora: [],
    certidoes: CERTIDOES_VALIDAS,
    ...alteracoes,
  };
}

describe('validarCertidao (art. 68, III a V)', () => {
  it('aceita certidão dentro da validade máxima do emissor e devolve a definição', () => {
    const d = validarCertidao(certidao('fgts', '2026-12-01'), HOJE);
    assert.equal(d.sigla, 'CRF');
    assert.equal(d.validadeMaximaDias, 30);
    assert.equal(CERTIDOES_REGULARIDADE.length, 3);
  });

  it('rejeita emissão futura, validade anterior à emissão, validade acima do máximo, número vazio e resultado desconhecido', () => {
    assert.throws(() => validarCertidao(certidao('fgts', '2026-12-10', { emitidaEm: '2026-11-10' }), HOJE), comCodigo('CERTIDAO_INVALIDA'));
    assert.throws(() => validarCertidao(certidao('fgts', '2026-10-01'), HOJE), comCodigo('CERTIDAO_INVALIDA'));
    assert.throws(() => validarCertidao(certidao('fgts', '2026-12-05'), HOJE), /excede o prazo de 30 dias da CRF/);
    assert.throws(() => validarCertidao(certidao('trabalhista', '2027-04-30', { numero: ' ' }), HOJE), comCodigo('CERTIDAO_INVALIDA'));
    assert.throws(
      () => validarCertidao(certidao('trabalhista', '2027-04-30', { resultado: 'talvez' as CertidaoRegularidade['resultado'] }), HOJE),
      comCodigo('CERTIDAO_INVALIDA'),
    );
    assert.throws(() => validarCertidao(certidao('estadual' as CertidaoRegularidade['tipo'], '2027-01-01'), HOJE), comCodigo('CERTIDAO_INVALIDA'));
    assert.throws(() => validarCertidao(certidao('fgts', '2026-13-01'), HOJE), comCodigo('CERTIDAO_INVALIDA'));
  });
});

describe('situacaoCertidao', () => {
  it('válida, a vencer (até 15 dias, inclusive no último dia), vencida no dia seguinte e positiva', () => {
    assert.equal(situacaoCertidao(certidao('trabalhista', '2027-04-30'), HOJE).situacao, 'valida');
    const aVencer = situacaoCertidao(certidao('fgts', '2026-11-20'), HOJE);
    assert.equal(aVencer.situacao, 'a_vencer');
    assert.equal(aVencer.diasRestantes, 11);
    assert.match(aVencer.mensagem, /vence em 11 dias, em 20\/11\/2026/);
    assert.match(situacaoCertidao(certidao('fgts', HOJE), HOJE).mensagem, /vence hoje/);
    const vencida = situacaoCertidao(certidao('trabalhista', '2026-11-08'), HOJE);
    assert.equal(vencida.situacao, 'vencida');
    assert.equal(vencida.diasRestantes, -1);
    assert.match(vencida.mensagem, /^CNDT \(nº TRABALHISTA-0001\): validade expirada em 08\/11\/2026\.$/);
    const positiva = situacaoCertidao(certidao('fiscal_federal', '2027-04-30', { resultado: 'positiva' }), HOJE);
    assert.equal(positiva.situacao, 'positiva');
    assert.match(positiva.fundamento, /art\. 68, III; art\. 91, § 4º/);
  });

  it('positiva com efeitos de negativa comprova a regularidade', () => {
    assert.equal(situacaoCertidao(certidao('fiscal_federal', '2027-04-30', { resultado: 'positiva_com_efeitos_de_negativa' }), HOJE).situacao, 'valida');
  });

  it('antecedência configurável e validação da antecedência', () => {
    assert.equal(situacaoCertidao(certidao('fgts', '2026-11-20'), HOJE, 5).situacao, 'valida');
    assert.throws(() => situacaoCertidao(certidao('fgts', '2026-11-20'), HOJE, -1), comCodigo('CERTIDAO_INVALIDA'));
  });
});

describe('classificarRegistroSancaoExterna', () => {
  it('inidoneidade vigente é impeditiva, com descrição de fonte, período e processo', () => {
    const c = classificarRegistroSancaoExterna(registro(), HOJE);
    assert.equal(c.vigente, true);
    assert.equal(c.impeditivo, true);
    assert.equal(
      c.descricao,
      'CEIS: Inidoneidade - Lei 14.133/2021, aplicada por Órgão federal de demonstração (DF, Federal), de 10/01/2026 a 10/01/2029 — processo 00000.000001/2026-00.',
    );
  });

  it('sanção encerrada ou ainda não iniciada não é vigente', () => {
    assert.equal(classificarRegistroSancaoExterna(registro({ dataFim: '2026-11-08' }), HOJE).vigente, false);
    assert.equal(classificarRegistroSancaoExterna(registro({ dataInicio: '2026-11-10' }), HOJE).vigente, false);
    assert.equal(classificarRegistroSancaoExterna(registro({ dataFim: HOJE }), HOJE).vigente, true, 'último dia ainda vale');
  });

  it('impedimento de outra esfera vira atenção (art. 156, § 4º); da mesma esfera é impeditivo', () => {
    const estadual = classificarRegistroSancaoExterna(registro({ tipoSancao: 'Impedimento de licitar e contratar', esfera: 'Estadual' }), HOJE);
    assert.equal(estadual.impeditivo, false);
    assert.match(estadual.observacao ?? '', /art\. 156, § 4º/);
    assert.equal(classificarRegistroSancaoExterna(registro({ tipoSancao: 'Suspensão temporária', esfera: 'Federal' }), HOJE).impeditivo, true);
    assert.equal(
      classificarRegistroSancaoExterna(registro({ tipoSancao: 'Impedimento de licitar e contratar', esfera: 'Estadual' }), HOJE, 'Estadual').impeditivo,
      true,
    );
  });

  it('multa do CNEP não impede contratar; proibição judicial do CNEP impede; registro do CEIS sem palavra-chave é impeditivo', () => {
    const multa = classificarRegistroSancaoExterna(registro({ cadastro: 'CNEP', tipoSancao: 'Multa - Lei 12.846/2013' }), HOJE);
    assert.equal(multa.impeditivo, false);
    assert.match(multa.observacao ?? '', /não impede contratar/);
    assert.equal(classificarRegistroSancaoExterna(registro({ cadastro: 'CNEP', tipoSancao: 'Proibição de receber incentivos' }), HOJE).impeditivo, true);
    assert.equal(classificarRegistroSancaoExterna(registro({ tipoSancao: 'Decisão administrativa' }), HOJE).impeditivo, true);
  });

  it('sem início nem fim: vigente e sem período informado; dados inválidos → REGISTRO_SANCAO_INVALIDO', () => {
    const c = classificarRegistroSancaoExterna(registro({ dataInicio: null, dataFim: null, uf: null, esfera: null, numeroProcesso: null }), HOJE);
    assert.equal(c.vigente, true);
    assert.match(c.descricao, /sem período informado\.$/);
    assert.throws(() => classificarRegistroSancaoExterna(registro({ cadastro: 'CADIN' as 'CEIS' }), HOJE), comCodigo('REGISTRO_SANCAO_INVALIDO'));
    assert.throws(() => classificarRegistroSancaoExterna(registro({ dataFim: '31/12/2026' }), HOJE), comCodigo('REGISTRO_SANCAO_INVALIDO'));
  });
});

describe('avaliarChecklistRegularidade (RF-20, RN-09, RN-23)', () => {
  it('fornecedor regular: 5 itens conformes, sem bloqueio nem providências', () => {
    const r = avaliarChecklistRegularidade(entrada());
    assert.equal(r.regular, true);
    assert.equal(r.bloqueia, false);
    assert.deepEqual(r.itens.map((i) => i.id), ['ceis_cnep', 'sancoes_agora', 'fiscal_federal', 'fgts', 'trabalhista']);
    assert.ok(r.itens.every((i) => i.situacao === 'conforme'));
    assert.equal(r.itens[0]?.fonte, 'Base simulada');
    assert.equal(r.itens[0]?.referencia, '2026-11-09T12:30:00.000Z');
    assert.deepEqual(r.motivos, []);
    assert.deepEqual(r.providencias, []);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 91, § 4º');
    assert.match(r.aviso, /Não aplica sanção nem declara impedimento/);
  });

  it('PoC-04: sanção vigente no CEIS bloqueia a assinatura e a prorrogação, com a fonte no item', () => {
    for (const momento of ['assinatura', 'prorrogacao'] as const) {
      const r = avaliarChecklistRegularidade(entrada({ momento, consulta: { fonte: 'Portal da Transparência', consultadoEm: AGORA, registros: [registro()] } }));
      assert.equal(r.regular, false);
      assert.equal(r.bloqueia, true);
      assert.equal(r.itens[0]?.situacao, 'impeditivo');
      assert.match(r.motivos[0] ?? '', /^CEIS: Inidoneidade .* Sanção vigente impede a contratação\.$/);
      assert.match(r.providencias.join(' '), /bloqueadas \(art\. 91, § 4º\)/);
    }
  });

  it('certidão ausente, vencida ou positiva bloqueia; a vencer só avisa', () => {
    const r = avaliarChecklistRegularidade(
      entrada({
        certidoes: [certidao('fiscal_federal', '2027-04-30', { resultado: 'positiva' }), certidao('trabalhista', '2026-11-01')],
      }),
    );
    assert.equal(r.bloqueia, true);
    assert.deepEqual(
      r.itens.filter((i) => i.situacao === 'impeditivo').map((i) => i.id),
      ['fiscal_federal', 'fgts', 'trabalhista'],
    );
    assert.ok(r.motivos.some((m) => /^CRF: certidão não registrada/.test(m)));
    assert.ok(r.motivos.some((m) => /CNDT .*validade expirada em 01\/11\/2026/.test(m)));

    const aVencer = avaliarChecklistRegularidade(entrada({ certidoes: [...CERTIDOES_VALIDAS.slice(0, 2), certidao('trabalhista', '2026-11-15')] }));
    assert.equal(aVencer.regular, true);
    assert.equal(aVencer.itens.find((i) => i.id === 'trabalhista')?.situacao, 'atencao');
    assert.equal(aVencer.avisos.length, 1);
    assert.match(aVencer.providencias.join(' '), /vencem em breve/);
  });

  it('usa a certidão mais recente de cada tipo', () => {
    const r = avaliarChecklistRegularidade(entrada({ certidoes: [...CERTIDOES_VALIDAS, certidao('fgts', '2026-10-30', { emitidaEm: '2026-10-01' })] }));
    assert.equal(r.itens.find((i) => i.id === 'fgts')?.situacao, 'conforme');
  });

  it('sanção aplicada pelo órgão (impedimento ou inidoneidade vigente) bloqueia; advertência, multa, encerrada ou em instrução não', () => {
    const r = avaliarChecklistRegularidade(
      entrada({
        sancoesAgora: [
          { tipo: 'impedimento_licitar', situacao: 'aplicada', fimVigencia: '2027-12-31' },
          { tipo: 'declaracao_inidoneidade', situacao: 'aplicada', fimVigencia: null },
          { tipo: 'impedimento_licitar', situacao: 'aplicada', fimVigencia: '2026-11-08' },
          { tipo: 'impedimento_licitar', situacao: 'defesa', fimVigencia: null },
          { tipo: 'multa', situacao: 'aplicada', fimVigencia: null },
        ],
      }),
    );
    assert.deepEqual(r.motivos, ['Impedimento de licitar e contratar vigente até 31/12/2027 (art. 156)', 'Declaração de inidoneidade vigente (art. 156)']);
  });

  it('consulta ausente ou falha: impeditivo nas travas, pendente na exibição', () => {
    const trava = avaliarChecklistRegularidade(entrada({ consulta: null, falhaConsulta: 'tempo limite de 15000 ms excedido' }));
    assert.equal(trava.bloqueia, true);
    assert.equal(trava.motivos[0], 'Não foi possível consultar o CEIS e o CNEP: tempo limite de 15000 ms excedido');
    const exibicao = avaliarChecklistRegularidade(entrada({ consulta: null, consultaObrigatoria: false }));
    assert.equal(exibicao.regular, true);
    assert.equal(exibicao.itens[0]?.situacao, 'pendente');
    assert.match(exibicao.avisos[0] ?? '', /ainda não foram consultados/);
  });

  it('consulta com mais de 24 horas: impeditiva na trava, pendente na exibição; dentro da validade, a falha nova só é informada', () => {
    const antiga = { fonte: 'Portal da Transparência', consultadoEm: '2026-11-08T10:00:00.000Z', registros: [] };
    assert.equal(avaliarChecklistRegularidade(entrada({ consulta: antiga, falhaConsulta: 'HTTP 503' })).bloqueia, true);
    assert.equal(avaliarChecklistRegularidade(entrada({ consulta: antiga, consultaObrigatoria: false })).itens[0]?.situacao, 'pendente');
    const recente = avaliarChecklistRegularidade(entrada({ falhaConsulta: 'HTTP 503' }));
    assert.equal(recente.regular, true);
    assert.match(recente.itens[0]?.detalhes.join(' ') ?? '', /vale o resultado da consulta anterior/);
    assert.equal(avaliarChecklistRegularidade(entrada({ consulta: antiga, validadeConsultaHoras: 48 })).regular, true);
  });

  it('registro de outra esfera ou multa do CNEP: atenção, sem bloqueio', () => {
    const r = avaliarChecklistRegularidade(
      entrada({
        consulta: {
          fonte: 'Portal da Transparência',
          consultadoEm: AGORA,
          registros: [registro({ tipoSancao: 'Impedimento', esfera: 'Municipal' }), registro({ cadastro: 'CNEP', tipoSancao: 'Multa' })],
        },
      }),
    );
    assert.equal(r.regular, true);
    assert.equal(r.itens[0]?.situacao, 'atencao');
    assert.equal(r.avisos.length, 2);
  });

  it('RN-23: no atesto e no pagamento a irregularidade não bloqueia e orienta notificar o contratado', () => {
    for (const momento of ['atesto', 'pagamento'] as const) {
      const r = avaliarChecklistRegularidade(entrada({ momento, certidoes: CERTIDOES_VALIDAS.slice(0, 2) }));
      assert.equal(r.regular, false);
      assert.equal(r.bloqueia, false);
      assert.match(r.providencias[0] ?? '', /Notifique o contratado .* \(art\. 92, XVI\)/);
      assert.match(r.providencias[1] ?? '', /não autoriza, por si só, reter o pagamento/);
      assert.match(r.fundamento, /art\. 92, XVI/);
    }
  });

  it('entradas inválidas → CHECKLIST_INVALIDO', () => {
    assert.throws(() => avaliarChecklistRegularidade(entrada({ momento: 'empenho' as 'atesto' })), comCodigo('CHECKLIST_INVALIDO'));
    assert.throws(() => avaliarChecklistRegularidade(entrada({ agora: 'ontem' })), comCodigo('CHECKLIST_INVALIDO'));
    assert.throws(() => avaliarChecklistRegularidade(entrada({ validadeConsultaHoras: 0 })), comCodigo('CHECKLIST_INVALIDO'));
    assert.throws(
      () => avaliarChecklistRegularidade(entrada({ consulta: { fonte: 'x', consultadoEm: 'sem data', registros: [] } })),
      comCodigo('CHECKLIST_INVALIDO'),
    );
  });
});

describe('situacaoRegistroCeisCnep (RN-24, art. 161)', () => {
  // Aplicação numa segunda-feira de agosto (sem feriado nacional): 15 dias úteis → segunda-feira, 24/08.
  const APLICACAO = '2026-08-03';

  it('pendente no prazo, com dias úteis restantes e alerta a partir de 5', () => {
    const r = situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: null, hoje: '2026-08-04' });
    assert.equal(r.vencimento, '2026-08-24');
    assert.equal(r.situacao, 'pendente_no_prazo');
    assert.equal(r.diasUteisRestantes, 14);
    assert.equal(r.alerta, false);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 161');
    const perto = situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: null, hoje: '2026-08-18' });
    assert.equal(perto.diasUteisRestantes, 4);
    assert.equal(perto.alerta, true);
    assert.match(perto.mensagem, /até 24\/08\/2026 \(4 dias úteis restantes\)/);
    assert.match(situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: null, hoje: '2026-08-24' }).mensagem, /vence hoje/);
  });

  it('pendente vencida, com dias úteis de atraso', () => {
    const r = situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: null, hoje: '2026-08-26' });
    assert.equal(r.situacao, 'pendente_vencida');
    assert.equal(r.diasUteisAtraso, 2);
    assert.equal(r.alerta, true);
    assert.match(r.mensagem, /vencido em 24\/08\/2026 \(2 dias úteis de atraso\)/);
  });

  it('registrada no prazo ou fora do prazo', () => {
    assert.equal(situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: '2026-08-24', hoje: '2026-11-09' }).situacao, 'registrada_no_prazo');
    const tarde = situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: '2026-08-25', hoje: '2026-11-09' });
    assert.equal(tarde.situacao, 'registrada_fora_do_prazo');
    assert.equal(tarde.diasUteisAtraso, 1);
    assert.equal(tarde.alerta, false);
  });

  it('feriado local do órgão prorroga o prazo', () => {
    assert.equal(situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: null, hoje: '2026-08-04' }, { feriadosExtras: ['2026-08-05'] }).vencimento, '2026-08-25');
  });

  it('envio anterior à aplicação, envio futuro ou datas inválidas → REGISTRO_CEIS_CNEP_INVALIDO', () => {
    assert.throws(() => situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: '2026-08-01', hoje: '2026-11-09' }), comCodigo('REGISTRO_CEIS_CNEP_INVALIDO'));
    assert.throws(() => situacaoRegistroCeisCnep({ aplicacao: APLICACAO, enviadoEm: '2026-11-10', hoje: '2026-11-09' }), comCodigo('REGISTRO_CEIS_CNEP_INVALIDO'));
    assert.throws(() => situacaoRegistroCeisCnep({ aplicacao: '05/10/2026', enviadoEm: null, hoje: '2026-11-09' }), comCodigo('REGISTRO_CEIS_CNEP_INVALIDO'));
  });
});
