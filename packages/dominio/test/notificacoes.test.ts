import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  adicionarDias,
  avaliarAvisoGarantia,
  avaliarAvisoReajuste,
  avaliarAvisoVencimento,
  avisoObrigatorio,
  baseLegalEnvio,
  decidirEntregaNotificacao,
  faixaVencimento,
  montarMensagemNotificacao,
  proximaTentativa,
  regrasPorTela,
  type EntradaMensagemNotificacao,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-08';
const em = (dias: number) => adicionarDias(HOJE, dias);

const CONTRATO: EntradaMensagemNotificacao['instrumento'] = {
  tipo: 'contrato',
  identificador: 'Contrato 12/2026',
  objeto: 'Serviço contínuo de limpeza predial',
  uasg: '200999',
  processoSei: '08000.000001/2026-11',
  vigenciaFim: em(100),
  fornecedor: 'Empresa Fictícia de Serviços Ltda',
  indiceReajuste: 'IPCA',
};

describe('faixaVencimento (RN-31)', () => {
  it('classifica as bordas de 30, 60, 90 e 120 dias', () => {
    const casos: [number, number | null][] = [
      [-1, null],
      [0, 30],
      [30, 30],
      [31, 60],
      [60, 60],
      [61, 90],
      [90, 90],
      [91, 120],
      [120, 120],
      [121, null],
    ];
    for (const [dias, faixa] of casos) assert.equal(faixaVencimento(dias), faixa, String(dias));
  });

  it('rejeita dias não inteiros', () => {
    assert.throws(() => faixaVencimento(1.5), comCodigo('DIAS_INVALIDOS'));
  });
});

describe('avaliarAvisoVencimento', () => {
  it('contrato vencendo em 120 dias gera aviso da faixa de 120, não obrigatório', () => {
    assert.deepEqual(avaliarAvisoVencimento(em(120), HOJE), { diasRestantes: 120, faixa: 120, obrigatorio: false, rotulo: 'Vence em 120 dias' });
  });

  it('a faixa de 30 dias é aviso obrigatório', () => {
    const aviso = avaliarAvisoVencimento(em(12), HOJE);
    assert.equal(aviso?.faixa, 30);
    assert.equal(aviso?.obrigatorio, true);
  });

  it('sem aviso para vencido ou a mais de 120 dias', () => {
    assert.equal(avaliarAvisoVencimento(em(-1), HOJE), null);
    assert.equal(avaliarAvisoVencimento(em(121), HOJE), null);
  });
});

describe('avaliarAvisoReajuste', () => {
  it('avisa quando o aniversário da data-base cai nos próximos 30 dias', () => {
    assert.deepEqual(avaliarAvisoReajuste('2024-11-20', HOJE), { aniversario: '2026-11-20', diasAte: 12 });
    assert.deepEqual(avaliarAvisoReajuste('2025-11-08', HOJE), { aniversario: '2026-11-08', diasAte: 0 });
  });

  it('não avisa antes do 1º aniversário nem com aniversário distante', () => {
    assert.equal(avaliarAvisoReajuste('2026-11-01', HOJE), null, 'data-base recente: 1º aniversário em 2027');
    assert.equal(avaliarAvisoReajuste('2024-03-10', HOJE), null);
  });

  it('data-base em 29/02 tem aniversário em 01/03 nos anos comuns (Código Civil, art. 132, § 3º)', () => {
    assert.deepEqual(avaliarAvisoReajuste('2024-02-29', '2027-02-10'), { aniversario: '2027-03-01', diasAte: 19 });
  });

  it('antecedência configurável e validada', () => {
    assert.ok(avaliarAvisoReajuste('2024-12-20', HOJE, 60));
    assert.throws(() => avaliarAvisoReajuste('2024-12-20', HOJE, -1), comCodigo('DIAS_INVALIDOS'));
  });
});

describe('avaliarAvisoGarantia', () => {
  it('avisa entre 0 e 30 dias antes da validade', () => {
    assert.deepEqual(avaliarAvisoGarantia(em(30), HOJE), { diasRestantes: 30 });
    assert.deepEqual(avaliarAvisoGarantia(HOJE, HOJE), { diasRestantes: 0 });
    assert.equal(avaliarAvisoGarantia(em(31), HOJE), null);
    assert.equal(avaliarAvisoGarantia(em(-2), HOJE), null);
  });
});

describe('avisoObrigatorio e decidirEntregaNotificacao', () => {
  it('ocorrência e vencimento na faixa de 30 dias são obrigatórios', () => {
    assert.equal(avisoObrigatorio('ocorrencia', null), true);
    assert.equal(avisoObrigatorio('vencimento', 30), true);
    assert.equal(avisoObrigatorio('vencimento', 120), false);
    assert.equal(avisoObrigatorio('reajuste', null), false);
  });

  it('preferência desligada suprime o aviso opcional, mas não o obrigatório', () => {
    const base = { canal: 'email' as const, papel: 'fiscal' as const, destinatarioPessoaFisica: true };
    assert.deepEqual(decidirEntregaNotificacao({ ...base, obrigatoria: false, preferencia: false }), {
      enviar: false,
      motivo: 'O destinatário optou por não receber este tipo de aviso por e-mail.',
    });
    assert.deepEqual(decidirEntregaNotificacao({ ...base, obrigatoria: true, preferencia: false }), { enviar: true, motivo: null });
    assert.deepEqual(decidirEntregaNotificacao({ ...base, obrigatoria: false, preferencia: null }), { enviar: true, motivo: null });
  });

  it('gov.br: depende de adesão do servidor (mesmo no aviso obrigatório) e é indisponível para pessoa jurídica', () => {
    assert.equal(decidirEntregaNotificacao({ canal: 'govbr', papel: 'gestor', obrigatoria: false, preferencia: null, destinatarioPessoaFisica: true }).enviar, false);
    assert.equal(decidirEntregaNotificacao({ canal: 'govbr', papel: 'gestor', obrigatoria: true, preferencia: null, destinatarioPessoaFisica: true }).enviar, false);
    assert.equal(decidirEntregaNotificacao({ canal: 'govbr', papel: 'gestor', obrigatoria: false, preferencia: true, destinatarioPessoaFisica: true }).enviar, true);
    assert.equal(decidirEntregaNotificacao({ canal: 'govbr', papel: 'contratada', obrigatoria: false, preferencia: null, destinatarioPessoaFisica: true }).enviar, true);
    const pj = decidirEntregaNotificacao({ canal: 'govbr', papel: 'contratada', obrigatoria: true, preferencia: null, destinatarioPessoaFisica: false });
    assert.equal(pj.enviar, false);
    assert.match(pj.motivo ?? '', /pessoas físicas/);
  });

  it('SEI e contratada não dependem de preferência', () => {
    assert.equal(decidirEntregaNotificacao({ canal: 'sei', papel: 'fiscal', obrigatoria: false, preferencia: false, destinatarioPessoaFisica: true }).enviar, true);
    assert.equal(decidirEntregaNotificacao({ canal: 'email', papel: 'contratada', obrigatoria: false, preferencia: false, destinatarioPessoaFisica: false }).enviar, true);
  });

  it('base legal por papel do destinatário', () => {
    assert.match(baseLegalEnvio('contratada'), /art\. 7º, II e V/);
    assert.match(baseLegalEnvio('fiscal'), /art\. 23/);
    assert.throws(() => baseLegalEnvio('outro' as never), comCodigo('NOTIFICACAO_INVALIDA'));
  });
});

describe('proximaTentativa', () => {
  const agora = '2026-11-08T12:00:00.000Z';
  it('intervalos crescentes de 1, 5, 15 e 60 minutos', () => {
    assert.equal(proximaTentativa(1, agora), '2026-11-08T12:01:00.000Z');
    assert.equal(proximaTentativa(2, agora), '2026-11-08T12:05:00.000Z');
    assert.equal(proximaTentativa(3, agora), '2026-11-08T12:15:00.000Z');
    assert.equal(proximaTentativa(4, agora), '2026-11-08T13:00:00.000Z');
  });

  it('esgota na 5ª tentativa (ou no máximo informado)', () => {
    assert.equal(proximaTentativa(5, agora), null);
    assert.equal(proximaTentativa(2, agora, 2), null);
  });

  it('valida as entradas', () => {
    assert.throws(() => proximaTentativa(0, agora), comCodigo('TENTATIVA_INVALIDA'));
    assert.throws(() => proximaTentativa(1, 'ontem'), comCodigo('TENTATIVA_INVALIDA'));
  });
});

describe('montarMensagemNotificacao', () => {
  it('vencimento na faixa de 120 dias: assunto, providência e fundamento', () => {
    const m = montarMensagemNotificacao({ tipo: 'vencimento', origem: 'automatica', hoje: HOJE, instrumento: { ...CONTRATO, vigenciaFim: em(95) } });
    assert.equal(m.assunto, 'Contrato 12/2026: vigência termina em 95 dias (faixa de 120 dias)');
    assert.equal(m.faixa, 120);
    assert.equal(m.obrigatoria, false);
    assert.match(m.corpo, /^Aviso de vencimento da vigência — Contrato 12\/2026/);
    assert.match(m.corpo, /Fim da vigência: 11\/02\/2027 \(vence em 95 dias\)\./);
    assert.match(m.corpo, /Providência sugerida: avaliar se a prorrogação é vantajosa/);
    assert.match(m.corpo, /Fundamento: Lei 14\.133\/2021, arts\. 105 a 107/);
    assert.doesNotMatch(m.fundamento, /art\. 84/);
    assert.match(m.corpo, /Aviso automático gerado pela Ágora em 08\/11\/2026/);
    assert.doesNotMatch(m.corpo, /Aviso obrigatório/);
  });

  it('vencimento na faixa de 30 dias informa que o aviso é obrigatório', () => {
    const m = montarMensagemNotificacao({ tipo: 'vencimento', origem: 'manual', hoje: HOJE, instrumento: { ...CONTRATO, vigenciaFim: HOJE } });
    assert.equal(m.assunto, 'Contrato 12/2026: vigência termina hoje');
    assert.equal(m.obrigatoria, true);
    assert.match(m.corpo, /Aviso obrigatório/);
    assert.match(m.corpo, /Aviso enviado pela equipe de gestão/);
  });

  it('ata cita a vigência do art. 84 e vencido orienta o encerramento', () => {
    const ata = montarMensagemNotificacao({
      tipo: 'vencimento',
      origem: 'automatica',
      hoje: HOJE,
      instrumento: { tipo: 'ata', identificador: 'Ata 3/2026', objeto: 'Material de expediente', uasg: '200999', vigenciaFim: em(-4) },
    });
    assert.equal(ata.faixa, null);
    assert.match(ata.assunto, /vigência encerrada em 04\/11\/2026/);
    assert.match(ata.corpo, /art\. 84/);
    assert.match(ata.fundamento, /^Lei 14\.133\/2021, art\. 84/);
    assert.match(ata.corpo, /liberação da garantia/);
  });

  it('reajuste e garantia exigem a data de referência', () => {
    const r = montarMensagemNotificacao({ tipo: 'reajuste', origem: 'automatica', hoje: HOJE, instrumento: CONTRATO, dataReferencia: em(10) });
    assert.match(r.assunto, /data-base do reajuste completa 12 meses em 18\/11\/2026/);
    assert.match(r.corpo, /Índice de reajuste: IPCA\./);
    const g = montarMensagemNotificacao({ tipo: 'garantia', origem: 'automatica', hoje: HOJE, instrumento: CONTRATO, dataReferencia: em(20) });
    assert.match(g.corpo, /renovação ou a complementação da garantia/);
    assert.throws(() => montarMensagemNotificacao({ tipo: 'garantia', origem: 'manual', hoje: HOJE, instrumento: CONTRATO }), comCodigo('NOTIFICACAO_INVALIDA'));
  });

  it('ocorrência exige relato de 20 caracteres, é obrigatória e não aplica penalidade', () => {
    assert.throws(
      () => montarMensagemNotificacao({ tipo: 'ocorrencia', origem: 'manual', hoje: HOJE, instrumento: CONTRATO, detalhe: 'curto' }),
      comCodigo('NOTIFICACAO_INVALIDA'),
    );
    const m = montarMensagemNotificacao({
      tipo: 'ocorrencia',
      origem: 'manual',
      hoje: HOJE,
      instrumento: CONTRATO,
      detalhe: 'Equipe incompleta no posto da portaria em três dias da semana.',
      dataReferencia: em(5),
      complemento: 'Favor responder pelo SEI.',
    });
    assert.equal(m.obrigatoria, true);
    assert.match(m.corpo, /Prazo para regularização: 13\/11\/2026\./);
    assert.match(m.corpo, /não aplica penalidade/);
    assert.match(m.corpo, /Mensagem de quem enviou: Favor responder pelo SEI\./);
  });

  it('pendência usa o motivo e o prazo; assunto sem quebra de linha', () => {
    const m = montarMensagemNotificacao({
      tipo: 'pendencia',
      origem: 'automatica',
      hoje: HOJE,
      instrumento: { ...CONTRATO, identificador: 'Contrato\n12/2026' },
      detalhe: 'Nota fiscal aguardando atesto',
      dataReferencia: em(3),
    });
    assert.equal(m.assunto, 'Contrato 12/2026: pendência com prazo em 11/11/2026');
    assert.match(m.corpo, /Pendência: Nota fiscal aguardando atesto/);
  });

  it('valida o tamanho da mensagem complementar e o tipo', () => {
    assert.throws(
      () => montarMensagemNotificacao({ tipo: 'vencimento', origem: 'manual', hoje: HOJE, instrumento: CONTRATO, complemento: 'x'.repeat(2001) }),
      comCodigo('NOTIFICACAO_INVALIDA'),
    );
    assert.throws(() => montarMensagemNotificacao({ tipo: 'outro' as never, origem: 'manual', hoje: HOJE, instrumento: CONTRATO }), comCodigo('NOTIFICACAO_INVALIDA'));
  });
});

describe('catálogo: RN-31 e RF-26', () => {
  it('RN-31 cobre o semáforo de 120 dias nas telas de vencimento e na central', () => {
    const rn = CATALOGO_REGRAS.find((r) => r.id === 'RN-31');
    assert.ok(rn);
    assert.match(rn.descricao, /120 dias/);
    assert.match(rn.fundamento, /arts\. 105 a 107/);
    for (const tela of ['painel', 'contratos', 'atas', 'notificacoes']) assert.ok(rn.telas.includes(tela), tela);
  });

  it('RF-26 é o requisito da tela de notificações e cita a LGPD', () => {
    const rf = regrasPorTela('notificacoes').filter((r) => r.tipo === 'RF');
    assert.deepEqual(rf.map((r) => r.id), ['RF-26']);
    assert.match(rf[0]?.fundamento ?? '', /arts\. 91, 92, 106, 117 e 141/);
    assert.match(rf[0]?.fundamento ?? '', /LGPD/);
  });

  it('RN-17 descreve a nova faixa de planejamento', () => {
    assert.match(CATALOGO_REGRAS.find((r) => r.id === 'RN-17')?.descricao ?? '', /planejamento \(91 a 120 dias/);
  });
});
