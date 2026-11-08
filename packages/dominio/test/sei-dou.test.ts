import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dataHoraSei,
  dataHoraSeiParaIso,
  dataPrevistaPublicacaoDou,
  digitosVerificadoresNup,
  ErroDominio,
  formatarNup,
  localizarMateriaDou,
  montarMateriaDou,
  nivelAcessoSei,
  situacaoAssinaturaSei,
  validarNup,
  type DadosAvisoLicitacao,
  type DadosExtratoAditivo,
  type DadosExtratoContrato,
  type ResultadoBuscaDou,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('NUP (Portaria Interministerial nº 11/2019)', () => {
  it('reproduz o exemplo do anexo: 35041.000387/2000-19', () => {
    assert.equal(digitosVerificadoresNup('350410003872000'), '19');
    assert.equal(formatarNup({ unidade: '35041', sequencial: 387, ano: 2000 }), '35041.000387/2000-19');
    assert.ok(validarNup('35041.000387/2000-19'));
  });

  it('11 − resto com a dezena desprezada: resto 0 → 1 e resto 1 → 0', () => {
    for (let s = 1; s <= 400; s += 1) {
      const nup = formatarNup({ unidade: '08000', sequencial: s, ano: 2026 });
      assert.ok(validarNup(nup), nup);
      assert.match(nup, /^08000\.\d{6}\/2026-\d{2}$/);
    }
  });

  it('recusa dígito trocado, formato errado e base inválida', () => {
    assert.equal(validarNup('35041.000387/2000-18'), false);
    assert.equal(validarNup('35041000387200019'), false);
    assert.throws(() => digitosVerificadoresNup('123'), comCodigo('NUP_INVALIDO'));
    assert.throws(() => formatarNup({ unidade: '0800', sequencial: 1, ano: 2026 }), comCodigo('NUP_INVALIDO'));
    assert.throws(() => formatarNup({ unidade: '08000', sequencial: 0, ano: 2026 }), comCodigo('NUP_INVALIDO'));
  });
});

describe('nivelAcessoSei', () => {
  it('restrito com dado pessoal ou orçamento sigiloso; senão, o do tipo de processo', () => {
    assert.equal(nivelAcessoSei({ contemDadoPessoal: true, orcamentoSigiloso: false }).nivel, 1);
    assert.match(nivelAcessoSei({ contemDadoPessoal: true, orcamentoSigiloso: false }).fundamento, /art\. 31/);
    assert.match(nivelAcessoSei({ contemDadoPessoal: false, orcamentoSigiloso: true }).fundamento, /art\. 24/);
    assert.equal(nivelAcessoSei({ contemDadoPessoal: false, orcamentoSigiloso: false }).nivel, null);
  });
});

describe('datas do SEI (Brasília)', () => {
  it('converte dd/mm/aaaa hh:mm:ss para UTC e volta', () => {
    assert.equal(dataHoraSeiParaIso('09/11/2026 10:15:30'), '2026-11-09T13:15:30.000Z');
    assert.equal(dataHoraSeiParaIso('09/11/2026'), '2026-11-09T03:00:00.000Z');
    assert.equal(dataHoraSeiParaIso(' 31/12/2026 23:59 '), '2027-01-01T02:59:00.000Z');
    assert.equal(dataHoraSei(new Date('2026-11-09T13:15:30.000Z')), '09/11/2026 10:15:30');
  });

  it('recusa datas inexistentes e fora do formato', () => {
    assert.throws(() => dataHoraSeiParaIso('31/02/2026 10:00:00'), comCodigo('DATA_SEI_INVALIDA'));
    assert.throws(() => dataHoraSeiParaIso('2026-11-09'), comCodigo('DATA_SEI_INVALIDA'));
    assert.throws(() => dataHoraSeiParaIso('09/11/2026 24:00:00'), comCodigo('DATA_SEI_INVALIDA'));
  });
});

describe('situacaoAssinaturaSei', () => {
  it('sem assinatura: pendente', () => {
    assert.deepEqual(situacaoAssinaturaSei([]), { assinado: false, primeiraEm: null, signatarios: [], resumo: '' });
  });

  it('ordena por data, não repete o signatário e resume com o cargo', () => {
    const s = situacaoAssinaturaSei([
      { nome: 'Caio Lima', cargoFuncao: null, assinadoEm: '2026-11-09T15:00:00.000Z' },
      { nome: 'Ana Ribeiro', cargoFuncao: 'Requisitante', assinadoEm: '2026-11-09T13:00:00.000Z' },
      { nome: 'Ana Ribeiro', cargoFuncao: 'Requisitante', assinadoEm: '2026-11-09T16:00:00.000Z' },
      { nome: ' ', cargoFuncao: null, assinadoEm: '2026-11-09T12:00:00.000Z' },
    ]);
    assert.equal(s.assinado, true);
    assert.equal(s.primeiraEm, '2026-11-09T13:00:00.000Z');
    assert.deepEqual(s.signatarios, ['Ana Ribeiro', 'Caio Lima']);
    assert.equal(s.resumo, 'Ana Ribeiro (Requisitante) e Caio Lima');
  });
});

const orgao = { nome: 'Ministério Exemplo', unidade: 'Secretaria de Exemplo' };
const uasg = { codigo: '200999', nome: 'Coordenação de Compras Exemplo' };

const aviso: DadosAvisoLicitacao = {
  tipo: 'aviso_licitacao',
  orgao,
  uasg,
  processo: '08000.014501/2026-11',
  objeto: 'Aquisição de coletes balísticos',
  modalidade: 'Pregão eletrônico',
  numero: '14501/2026',
  totalItens: 2,
  dataEdital: '2026-11-09',
  dataPropostas: '2026-11-18',
  enderecoEdital: 'https://agora.exemplo.gov.br/transparencia/editais/1',
  responsavel: { nome: 'Agente Exemplo', cargo: 'Agente de contratação' },
};

describe('montarMateriaDou', () => {
  it('aviso de licitação: padrão da Seção 3, obrigatório (art. 54, § 1º)', () => {
    const m = montarMateriaDou(aviso);
    assert.equal(m.secao, 3);
    assert.equal(m.titulo, 'AVISO DE LICITAÇÃO');
    assert.equal(m.identificacao, 'PREGÃO ELETRÔNICO Nº 14501/2026');
    assert.equal(m.obrigatoria, true);
    assert.match(m.fundamento, /art\. 54, § 1º/);
    assert.match(m.texto, /^MINISTÉRIO EXEMPLO\nSECRETARIA DE EXEMPLO\n/);
    assert.match(m.texto, /Processo nº 08000\.014501\/2026-11/);
    assert.match(m.texto, /Abertura das propostas: 18\/11\/2026/);
    assert.match(m.texto, /AGENTE EXEMPLO\nAgente de contratação$/);
    assert.deepEqual(montarMateriaDou(aviso), m, 'determinístico');
  });

  it('aviso: recusa propostas antes do edital e licitação sem itens', () => {
    assert.throws(() => montarMateriaDou({ ...aviso, dataPropostas: '2026-11-01' }), comCodigo('MATERIA_DOU_INVALIDA'));
    assert.throws(() => montarMateriaDou({ ...aviso, totalItens: 0 }), comCodigo('MATERIA_DOU_INVALIDA'));
    assert.throws(() => montarMateriaDou({ ...aviso, objeto: '  ' }), comCodigo('MATERIA_DOU_INVALIDA'));
  });

  const contrato: DadosExtratoContrato = {
    tipo: 'extrato_contrato',
    orgao,
    uasg,
    processo: '08000.014501/2026-11',
    objeto: 'Aquisição de coletes balísticos',
    numeroContrato: '12/2026',
    origem: 'Pregão eletrônico nº 14501/2026',
    contratado: { nome: 'Empresa Exemplo Ltda', documento: '11222333000181' },
    vigenciaInicio: '2026-11-10',
    vigenciaFim: '2027-11-09',
    valor: 123_456_78,
    dataAssinatura: '2026-11-10',
  };

  it('extrato de contrato: CNPJ completo, valor e vigência; publicidade complementar (art. 94)', () => {
    const m = montarMateriaDou(contrato);
    assert.equal(m.identificacao, 'EXTRATO DE CONTRATO Nº 12/2026');
    assert.equal(m.obrigatoria, false);
    assert.match(m.texto, /CNPJ 11\.222\.333\/0001-81 - EMPRESA EXEMPLO LTDA/);
    assert.match(m.texto, /Vigência: 10\/11\/2026 a 09\/11\/2027/);
    assert.match(m.texto, /R\$\s?123\.456,78/);
    assert.match(m.fundamento, /art\. 94/);
  });

  it('extrato de contrato com pessoa física: CPF mascarado (LGPD)', () => {
    const m = montarMateriaDou({ ...contrato, contratado: { nome: 'Pessoa Exemplo', documento: '52998224725' } });
    assert.match(m.texto, /CPF \*\*\*\.982\.247-\*\*/);
    assert.doesNotMatch(m.texto, /52998224725|529\.982\.247-25/);
    assert.throws(() => montarMateriaDou({ ...contrato, contratado: { nome: 'X', documento: '123' } }), comCodigo('MATERIA_DOU_INVALIDA'));
    assert.throws(() => montarMateriaDou({ ...contrato, vigenciaFim: '2026-01-01' }), comCodigo('MATERIA_DOU_INVALIDA'));
  });

  it('extrato de termo aditivo: natureza, nova vigência e valor', () => {
    const d: DadosExtratoAditivo = {
      tipo: 'extrato_aditivo',
      orgao,
      uasg,
      processo: '08000.014501/2026-11',
      objeto: 'Aquisição de coletes balísticos',
      numeroContrato: '12/2026',
      numeroAditivo: '1',
      natureza: 'prorrogacao',
      contratado: { nome: 'Empresa Exemplo Ltda', documento: '11.222.333/0001-81' },
      valor: 0,
      novaVigenciaFim: '2028-11-09',
      dataAssinatura: '2027-10-01',
    };
    const m = montarMateriaDou(d);
    assert.equal(m.identificacao, 'EXTRATO DO TERMO ADITIVO Nº 1 AO CONTRATO Nº 12/2026');
    assert.match(m.texto, /Prorrogação da vigência \(arts\. 106 e 107\)/);
    assert.match(m.texto, /Nova vigência até 09\/11\/2028/);
    assert.doesNotMatch(montarMateriaDou({ ...d, natureza: 'acrescimo', novaVigenciaFim: null }).texto, /Nova vigência/);
  });
});

describe('dataPrevistaPublicacaoDou', () => {
  // 09/11/2026 é segunda-feira; 13/11 é sexta; 15/11 (domingo) é feriado nacional.
  it('recebida até as 19h de dia útil: edição do dia útil seguinte', () => {
    assert.equal(dataPrevistaPublicacaoDou(new Date('2026-11-09T13:00:00.000Z')), '2026-11-10');
  });

  it('depois do fechamento: um dia útil a mais', () => {
    assert.equal(dataPrevistaPublicacaoDou(new Date('2026-11-09T22:30:00.000Z')), '2026-11-11');
  });

  it('sexta à noite ou fim de semana: recebida na segunda, publicada na terça', () => {
    assert.equal(dataPrevistaPublicacaoDou(new Date('2026-11-13T23:00:00.000Z')), '2026-11-17');
    assert.equal(dataPrevistaPublicacaoDou(new Date('2026-11-14T14:00:00.000Z')), '2026-11-17');
  });

  it('respeita o horário de fechamento informado', () => {
    assert.equal(dataPrevistaPublicacaoDou(new Date('2026-11-09T21:30:00.000Z'), { horaFechamento: 18 }), '2026-11-11');
    assert.throws(() => dataPrevistaPublicacaoDou(new Date('x')), comCodigo('DATA_INVALIDA'));
  });
});

describe('localizarMateriaDou', () => {
  const resultado = (r: Partial<ResultadoBuscaDou>): ResultadoBuscaDou => ({
    titulo: 'AVISO DE LICITAÇÃO PREGÃO ELETRÔNICO Nº 14501/2026',
    resumo: 'UASG 200999. Processo nº 08000.014501/2026-11. Objeto: ...',
    data: '2026-11-10',
    secao: 'DO3',
    url: 'https://www.in.gov.br/web/dou/-/aviso-1',
    edicao: '214',
    pagina: '88',
    ...r,
  });

  it('acha a primeira edição do mesmo ato com o número do processo, a partir do envio', () => {
    const achado = localizarMateriaDou({ tipo: 'aviso_licitacao', processo: '08000.014501/2026-11', enviadaEm: '2026-11-09' }, [
      resultado({ data: '2026-11-12', url: 'https://www.in.gov.br/web/dou/-/aviso-2' }),
      resultado({ titulo: 'EXTRATO DE CONTRATO Nº 12/2026' }),
      resultado({ resumo: 'Processo nº 08000.099999/2026-00' }),
      resultado({ data: '2026-11-01' }),
      resultado({}),
    ]);
    assert.equal(achado?.url, 'https://www.in.gov.br/web/dou/-/aviso-1');
  });

  it('extrato de termo aditivo em suas grafias usuais; nada encontrado → null', () => {
    const base = { tipo: 'extrato_aditivo' as const, processo: '08000.014501/2026-11', enviadaEm: '2026-11-09' };
    assert.ok(localizarMateriaDou(base, [resultado({ titulo: 'EXTRATO DO 1º TERMO ADITIVO AO CONTRATO Nº 12/2026' })]));
    assert.ok(localizarMateriaDou(base, [resultado({ titulo: 'Extrato de Termo Aditivo nº 1/2026' })]));
    assert.equal(localizarMateriaDou(base, [resultado({})]), null);
    assert.throws(() => localizarMateriaDou({ ...base, enviadaEm: '09/11/2026' }, []), comCodigo('DATA_INVALIDA'));
  });
});
