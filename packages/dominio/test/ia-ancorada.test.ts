import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  artigoDaConsulta,
  buscarNaBaseNormativa,
  conferirCitacoesLegais,
  conferirDocumentosCruzados,
  conferirEstruturaModelo,
  estruturarTextoLei,
  extrairCitacoesLegais,
  extrairFatosDocumento,
  formatarReferenciaDispositivo,
  indexarBaseNormativa,
  localizarDispositivo,
  mapaArtigos,
  numeroParaRomano,
  romanoParaNumero,
  roteiroModeloPadronizado,
  sinaisAuditorContinuo,
  termosNormativos,
  type BaseNormativa,
  type ContratoAuditavel,
  type DocumentoConferenciaCruzada,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

/** Lei sintética no formato do texto compilado oficial (uma linha por dispositivo). */
const LEI_SINTETICA = [
  'LEI DE TESTE',
  'TÍTULO I',
  'DISPOSIÇÕES GERAIS',
  'CAPÍTULO I',
  'DAS DEFINIÇÕES',
  'Art. 1º Para os fins desta Lei, consideram-se:',
  'I - bem comum: aquele cujo padrão de qualidade pode ser definido pelo edital;',
  'II - termo de referência: documento que deve conter:',
  'a) definição do objeto e dos quantitativos;',
  'b) fundamentação da contratação;',
  'III - (VETADO);',
  'Art. 2º Os itens de consumo serão de qualidade comum, vedada a aquisição de artigos de luxo.',
  'Parágrafo único. O regulamento definirá os limites de enquadramento dos bens de consumo.',
  'CAPÍTULO II',
  'DA CONTRATAÇÃO DIRETA',
  'Seção I',
  'Da Dispensa de Licitação',
  'Art. 3º É dispensável a licitação:',
  'I - para obras de valor inferior ao limite fixado;',
  'II - para compras de pequeno valor;',
  '§ 1º Para aferição dos valores, serão somadas as despesas do exercício com objetos da mesma natureza.',
  '§ 2º (Revogado).',
  'Art. 4º A multa de mora por atraso injustificado na execução do contrato será aplicada pela autoridade competente, assegurada a defesa.',
  'Art. 5º Altera outra lei:',
  '"Art. 99. Texto da outra lei que não é dispositivo desta.',
  'Parágrafo único. Também não é dispositivo desta lei." (NR)',
  'Art. 6º (VETADO).',
  'Art. 7º As garantias de execução são a caução em dinheiro, o seguro-garantia e a fiança bancária.',
  'Brasília, 1º de abril de 2021.',
  'Nome que não entra',
].join('\n');

function baseSintetica(): BaseNormativa {
  return {
    norma: { id: 'lei-teste', titulo: 'Lei 14.133/2021', ementa: 'Teste.', numero: '14.133', ano: 2021 },
    proveniencia: { fonte: 'teste', url: 'https://exemplo.invalid', obtidoEm: '2026-11-08T00:00:00Z', formato: 'txt', sha256Arquivo: 'a'.repeat(64), sha256Texto: 'b'.repeat(64), observacao: '' },
    artigos: estruturarTextoLei(LEI_SINTETICA),
  };
}

describe('termos da base normativa', () => {
  it('normaliza acentos, plural e radical de 7 letras, sem palavras vazias nem números', () => {
    assert.deepEqual(termosNormativos('A dispensa e as dispensas de licitação em 2026'), ['dispens', 'dispens', 'licitac']);
    assert.deepEqual(termosNormativos('Órgãos e preços'), ['orgao', 'preco']);
    assert.deepEqual(termosNormativos('nos termos do art. 5º', { ignorarRemissivas: true }), []);
  });
});

describe('estruturarTextoLei e localizarDispositivo', () => {
  const artigos = estruturarTextoLei(LEI_SINTETICA);
  const mapa = mapaArtigos({ artigos });

  it('lê artigos, parágrafos, incisos, alíneas e divisões; ignora preâmbulo, fecho e texto alterador', () => {
    assert.deepEqual(artigos.map((a) => a.numero), ['1', '2', '3', '4', '5', '6', '7']);
    const art1 = mapa.get('1');
    assert.equal(art1?.incisos.length, 3);
    assert.deepEqual(art1?.incisos[1]?.alineas.map((a) => a.letra), ['a', 'b']);
    assert.deepEqual(mapa.get('2')?.paragrafos.map((p) => p.numero), ['unico']);
    assert.deepEqual(mapa.get('3')?.titulos, ['TÍTULO I — DISPOSIÇÕES GERAIS', 'CAPÍTULO II — DA CONTRATAÇÃO DIRETA', 'Seção I — Da Dispensa de Licitação']);
    assert.deepEqual(mapa.get('1')?.titulos, ['TÍTULO I — DISPOSIÇÕES GERAIS', 'CAPÍTULO I — DAS DEFINIÇÕES']);
    assert.equal(mapa.get('5')?.textoAlterador.length, 2);
    assert.equal(mapa.get('5')?.paragrafos.length, 0);
    assert.ok(!artigos.some((a) => a.caput.includes('Nome que não entra')));
  });

  it('algarismos romanos canônicos', () => {
    assert.equal(romanoParaNumero('XXIII'), 23);
    assert.equal(romanoParaNumero('LX'), 60);
    assert.equal(romanoParaNumero('IIII'), null);
    assert.equal(numeroParaRomano(14), 'XIV');
    assert.throws(() => numeroParaRomano(0), comCodigo('ROMANO_INVALIDO'));
  });

  it('localiza o dispositivo ou explica o que existe', () => {
    const ok = localizarDispositivo(mapa, { artigo: '1', paragrafo: null, inciso: 'II', alinea: 'b' });
    assert.ok(ok.encontrado);
    assert.match(ok.encontrado ? ok.texto : '', /fundamentação/);
    const semArtigo = localizarDispositivo(mapa, { artigo: '250', paragrafo: null, inciso: null, alinea: null });
    assert.ok(!semArtigo.encontrado && /art\. 250 não existe na lei, que vai do art\. 1º ao art\. 7º/.test(semArtigo.motivo));
    const semParagrafo = localizarDispositivo(mapa, { artigo: '3', paragrafo: '9', inciso: null, alinea: null });
    assert.ok(!semParagrafo.encontrado && /não tem § 9º: tem §§ 1º a 2º/.test(semParagrafo.motivo));
    const semInciso = localizarDispositivo(mapa, { artigo: '3', paragrafo: null, inciso: 'IX', alinea: null });
    assert.ok(!semInciso.encontrado && /caput do art\. 3º não tem inciso IX: tem incisos I a II/.test(semInciso.motivo));
    assert.equal(formatarReferenciaDispositivo({ artigo: '3', paragrafo: '1', inciso: 'II', alinea: 'a' }), 'art. 3º, § 1º, II, "a"');
  });
});

describe('buscarNaBaseNormativa (BM25F)', () => {
  const indice = indexarBaseNormativa(baseSintetica());

  it('a seção "Da Dispensa de Licitação" põe o art. 3º em primeiro, com o trecho', () => {
    const r = buscarNaBaseNormativa(indice, 'dispensa de licitação');
    assert.equal(r[0]?.artigo, '3');
    assert.equal(r[0]?.divisao, 'Seção I — Da Dispensa de Licitação');
    assert.ok((r[0]?.trechos.length ?? 0) > 0);
  });

  it('pedido pelo número vem primeiro, marcado como exato', () => {
    const r = buscarNaBaseNormativa(indice, 'art. 7º');
    assert.equal(r[0]?.artigo, '7');
    assert.equal(r[0]?.exato, true);
    assert.equal(artigoDaConsulta('artigo 44-a'), '44-A');
    assert.equal(artigoDaConsulta('15 dias'), null);
  });

  it('é determinística e valida a consulta', () => {
    assert.deepEqual(buscarNaBaseNormativa(indice, 'garantia de execução'), buscarNaBaseNormativa(indice, 'garantia de execução'));
    assert.throws(() => buscarNaBaseNormativa(indice, '  '), comCodigo('CONSULTA_VAZIA'));
    assert.throws(() => buscarNaBaseNormativa(indice, 'luxo', 0), comCodigo('LIMITE_INVALIDO'));
    assert.throws(() => indexarBaseNormativa({ ...baseSintetica(), artigos: [] }), comCodigo('BASE_NORMATIVA_VAZIA'));
  });
});

describe('extrairCitacoesLegais', () => {
  const dispositivos = (texto: string) =>
    extrairCitacoesLegais(texto).map((c) => ({ norma: c.norma, refs: c.dispositivos.map(formatarReferenciaDispositivo) }));

  it('listas, faixas, parágrafos, incisos e alíneas', () => {
    assert.deepEqual(dispositivos('Lei 14.133/2021, arts. 62 a 64 e 70'), [{ norma: null, refs: ['art. 62', 'art. 63', 'art. 64', 'art. 70'] }]);
    assert.deepEqual(dispositivos('art. 18, § 1º, incisos I a III, e § 2º'), [{ norma: null, refs: ['art. 18, § 1º, I', 'art. 18, § 1º, II', 'art. 18, § 1º, III', 'art. 18, § 2º'] }]);
    assert.deepEqual(dispositivos('(art. 124, II, “d”)'), [{ norma: null, refs: ['art. 124, II, "d"'] }]);
    assert.deepEqual(dispositivos('art. 6º, XXIII, alíneas a a c'), [{ norma: null, refs: ['art. 6º, XXIII, "a"', 'art. 6º, XXIII, "b"', 'art. 6º, XXIII, "c"'] }]);
    assert.deepEqual(dispositivos('art. 75, I e II, e § 1º'), [{ norma: null, refs: ['art. 75, I', 'art. 75, II', 'art. 75, § 1º'] }]);
    assert.deepEqual(dispositivos('art. 18, caput e inciso I'), [{ norma: null, refs: ['art. 18', 'art. 18, I'] }]);
    assert.deepEqual(dispositivos('art. 123, parágrafo único'), [{ norma: null, refs: ['art. 123, parágrafo único'] }]);
    assert.deepEqual(dispositivos('art. 25 e § 3º'), [{ norma: null, refs: ['art. 25', 'art. 25, § 3º'] }]);
  });

  it('forma invertida', () => {
    assert.deepEqual(dispositivos('alínea "a" do inciso XVIII do caput do art. 6º desta Lei'), [{ norma: null, refs: ['art. 6º, XVIII, "a"'] }]);
    assert.deepEqual(dispositivos('incisos I e IV do § 1º do art. 18'), [{ norma: null, refs: ['art. 18, § 1º, I', 'art. 18, § 1º, IV'] }]);
  });

  it('outra norma, antes ou depois, e herança na mesma frase', () => {
    assert.deepEqual(dispositivos('art. 8º, V e VI, do Decreto 10.947/2022'), [{ norma: 'Decreto 10.947/2022', refs: ['art. 8º, V', 'art. 8º, VI'] }]);
    assert.deepEqual(dispositivos('Lei 13.709/2018 (LGPD), arts. 6º e 37'), [{ norma: 'Lei 13.709/2018', refs: ['art. 6º', 'art. 37'] }]);
    assert.deepEqual(dispositivos('art. 7º, XXXIII, da Constituição'), [{ norma: 'Constituição', refs: ['art. 7º, XXXIII'] }]);
    assert.deepEqual(dispositivos('(LC 123/2006, art. 48, I), ressalvadas as hipóteses do art. 49.'), [
      { norma: 'LC 123/2006', refs: ['art. 48, I'] },
      { norma: 'LC 123/2006', refs: ['art. 49'] },
    ]);
    // Frase nova: volta a valer a Lei 14.133/2021.
    assert.equal(extrairCitacoesLegais('(LC 123/2006, art. 48). Aplica-se o art. 4º.')[1]?.norma, null);
    assert.equal(extrairCitacoesLegais('o art. 4º da Lei nº 14.133, de 1º de abril de 2021')[0]?.norma, null);
  });

  it('ignora texto sem citação de artigo', () => {
    assert.deepEqual(extrairCitacoesLegais('Decreto 10.818/2021; § 2º: I, IV e XIII; artigos de luxo.'), []);
  });
});

describe('conferirCitacoesLegais (RIA-14)', () => {
  const indice = indexarBaseNormativa(baseSintetica());

  it('aponta citação inexistente com o motivo e sugere o artigo do assunto', () => {
    const r = conferirCitacoesLegais('A dispensa de licitação para compras de pequeno valor segue o art. 250 da Lei 14.133/2021.', indice);
    assert.equal(r.inexistentes, 1);
    assert.equal(r.bloqueantes, 1);
    assert.equal(r.fiel, false);
    const c = r.citacoes[0];
    assert.equal(c?.situacao, 'inexistente');
    assert.match(c?.motivo ?? '', /art\. 250 não existe/);
    assert.match(c?.sugestao ?? '', /art\. 3º/);
    assert.match(c?.contexto ?? '', /dispensa de licitação/);
    assert.match(r.aviso, /requer revisão humana/);
  });

  it('dispositivo vetado ou revogado fica sem efeito', () => {
    const r = conferirCitacoesLegais('Conforme o art. 1º, III, e o art. 3º, § 2º, e o art. 6º.', indice);
    assert.deepEqual(r.citacoes.map((c) => c.situacao), ['sem_efeito', 'sem_efeito', 'sem_efeito']);
    assert.equal(r.semEfeito, 3);
  });

  it('assunto que não corresponde ao dispositivo é suspeito, com sugestão', () => {
    const r = conferirCitacoesLegais('A multa de mora por atraso injustificado na execução será aplicada pela autoridade, assegurada a defesa (art. 2º).', indice);
    assert.equal(r.citacoes[0]?.situacao, 'suspeita');
    assert.match(r.citacoes[0]?.sugestao ?? '', /art\. 4º/);
    assert.equal(r.bloqueantes, 0);
    assert.equal(r.problemas, 1);
  });

  it('citação correta confere; outra norma não é conferida; sem citação é fiel', () => {
    const r = conferirCitacoesLegais('É vedada a aquisição de artigos de luxo (art. 2º, parágrafo único). Ver art. 8º do Decreto 10.947/2022.', indice);
    assert.deepEqual(r.citacoes.map((c) => c.situacao), ['outra_norma', 'confere']);
    assert.equal(r.fiel, true);
    assert.equal(conferirCitacoesLegais('Texto sem citação.', indice).total, 0);
  });
});

describe('conferirEstruturaModelo (modelos padronizados, art. 19, IV)', () => {
  it('TR sem a seção de adequação orçamentária', () => {
    const tr = ['# Termo de Referência', '## a) Definição do objeto', '## b) Fundamentação', '## c) Descrição da solução', '## d) Requisitos', '## e) Modelo de execução do objeto', '## f) Modelo de gestão do contrato', '## g) Critérios de medição e de pagamento', '## h) Forma e critérios de seleção do fornecedor', '## i) Estimativas do valor'].join('\n');
    const r = conferirEstruturaModelo('tr', tr);
    assert.equal(r.aplicavel, true);
    assert.deepEqual(r.ausentes.map((a) => a.id), ['j']);
    assert.equal(r.percentual, 90);
  });

  it('ETP reconhece o inciso no início do título; documento sem modelo não se aplica', () => {
    const etp = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'].map((i) => `## ${i} — Seção`).join('\n');
    assert.equal(conferirEstruturaModelo('etp', etp).ausentes.length, 0);
    assert.equal(conferirEstruturaModelo('dfd', 'qualquer').aplicavel, false);
    assert.equal(roteiroModeloPadronizado('minuta_contrato').length, 19);
  });
});

function documento(tipo: string, titulo: string, corpo: string[]): DocumentoConferenciaCruzada {
  return { tipo, titulo, versao: 1, conteudo: ['# ' + titulo, '', '**Objeto:** Aquisição de rádios portáteis', '', ...corpo].join('\n') };
}

const tabela = (quantidade: string) => ['| Item | CATMAT/CATSER | Descrição | Unidade | Quantidade | Valor unitário | Valor total |', '| --- | --- | --- | --- | --- | --- | --- |', `| 1 | 123 | Rádio portátil | unidade | ${quantidade} | R$ 10,00 | R$ 100,00 |`];

describe('conferirDocumentosCruzados (RIA-15)', () => {
  it('aponta a quantidade diferente entre o ETP e o TR, com os trechos', () => {
    const r = conferirDocumentosCruzados([
      documento('etp', 'Estudo Técnico Preliminar (ETP)', tabela('1.200')),
      documento('tr', 'Termo de Referência', [...tabela('1.500'), 'Modalidade prevista: **Pregão eletrônico**, na forma eletrônica, com critério de julgamento de **menor preço** e modo de disputa aberto.']),
    ]);
    assert.equal(r.consistente, false);
    const d = r.divergencias.find((x) => x.chave === 'quantidade:1');
    assert.ok(d);
    assert.equal(d.aspecto, 'quantidade');
    assert.deepEqual(d.ocorrencias.map((o) => [o.tipo, o.valor]), [['etp', '1.200 unidade'], ['tr', '1.500 unidade']]);
    assert.match(d.fundamento, /art\. 18, § 1º, IV/);
    assert.match(r.aviso, /requer revisão humana/);
    assert.equal(r.aspectos.find((a) => a.aspecto === 'quantidade')?.divergencias, 1);
  });

  it('prazos, valor, modalidade e critério iguais não divergem; diferentes divergem', () => {
    const tr = documento('tr', 'Termo de Referência', [
      'O prazo de vigência do contrato é de 12 meses, contados da assinatura, com entrega em até 30 dias corridos.',
      'Modalidade prevista: **Pregão eletrônico**, na forma eletrônica, com critério de julgamento de **menor preço** e modo de disputa aberto.',
      'Valor global estimado: **R$ 1.000,00**.',
    ]);
    const minuta = documento('minuta_contrato', 'Minuta do Contrato', ['A vigência é de 24 meses, contados da assinatura.', 'com entrega em até 30 dias corridos contados do recebimento']);
    const edital = documento('edital', 'Minuta do Edital', ['realizará licitação na modalidade pregão eletrônico, na forma eletrônica, com critério de julgamento de maior desconto e modo de disputa aberto']);
    const nota = documento('nota_tecnica_precos', 'Nota Técnica', ['| Valor global estimado da contratação | R$ 1.000,00 |']);
    const r = conferirDocumentosCruzados([tr, minuta, edital, nota]);
    assert.deepEqual(r.divergencias.map((d) => d.chave).sort(), ['criterio', 'prazo:vigencia']);
    assert.equal(r.aspectos.find((a) => a.aspecto === 'valor_estimado')?.comparacoes, 1);
  });

  it('pequena diferença de redação do objeto não é divergência', () => {
    const a = documento('tr', 'Termo de Referência', ['Constitui objeto desta contratação: **Aquisição de rádios portáteis**, de natureza bens, nos quantitativos abaixo.']);
    const b = documento('edital', 'Minuta do Edital', ['1.1. O objeto da licitação é aquisição de rádios portáteis, conforme as especificações.']);
    assert.equal(conferirDocumentosCruzados([a, b]).consistente, true);
    const c = documento('edital', 'Minuta do Edital', ['1.1. O objeto da licitação é contratação de serviço de limpeza predial, conforme as especificações.']);
    assert.ok(conferirDocumentosCruzados([a, c]).divergencias.some((d) => d.aspecto === 'objeto'));
  });

  it('dado "a definir" não é fato', () => {
    assert.equal(extrairFatosDocumento('Modalidade prevista: **[A definir: modalidade]**, na forma').length, 0);
  });
});

function contrato(parcial: Partial<ContratoAuditavel> = {}): ContratoAuditavel {
  return {
    valorInicial: 1_200_000,
    valorGlobal: 1_200_000,
    dataBaseReajuste: '2025-01-10',
    pagamentos: [1, 2, 3, 4].map((n) => ({ notaFiscal: `NF ${1000 + n}`, competencia: `2025-0${n}`, valor: 100_000, situacao: 'pago' as const, atestadoEm: `2025-0${n}-05`, pagoEm: `2025-0${n}-10` })),
    aditivos: [],
    itens: [{ numero: 1, descricao: 'Serviço mensal', quantidade: 12, quantidadeRecebida: 4 }],
    valorEstimadoProcesso: null,
    ...parcial,
  };
}

describe('sinaisAuditorContinuo (auditor contínuo da 2ª linha)', () => {
  it('contrato regular não gera sinal', () => {
    assert.deepEqual(sinaisAuditorContinuo(contrato()), []);
  });

  it('nota duplicada, atípica, pagamento antes do atesto e execução acima do valor', () => {
    const base = contrato().pagamentos;
    const sinais = sinaisAuditorContinuo(
      contrato({
        valorGlobal: 500_000,
        pagamentos: [
          ...base,
          { notaFiscal: 'NF-e 1001', competencia: '2025-05', valor: 100_000, situacao: 'atestado', atestadoEm: '2025-05-05', pagoEm: null },
          { notaFiscal: 'NF 2000', competencia: '2025-06', valor: 900_000, situacao: 'pago', atestadoEm: '2025-06-20', pagoEm: '2025-06-10' },
          { notaFiscal: 'NF 3000', competencia: '2025-07', valor: 50_000, situacao: 'previsto', atestadoEm: null, pagoEm: null },
        ],
      }),
    );
    const tipos = sinais.map((s) => s.tipo);
    assert.deepEqual(tipos, ['nota_duplicada', 'execucao_acima_valor', 'pagamento_antecipado', 'nota_atipica']);
    assert.ok(sinais.slice(0, 3).every((s) => s.nivel === 'risco'));
    assert.match(sinais[0]?.descricao ?? '', /NF 1001 aparece 2 vezes/);
    assert.match(sinais[2]?.fundamento ?? '', /art\. 145/);
    assert.ok(sinais.every((s) => s.evidencias.length > 0));
  });

  it('reajuste antes de 1 ano, recebimento acima do contratado e valor acima da estimativa', () => {
    const sinais = sinaisAuditorContinuo(
      contrato({
        aditivos: [{ numero: '1º Termo de Apostilamento', tipo: 'reajuste', valor: 30_000, assinadoEm: '2025-08-01' }],
        itens: [{ numero: 1, descricao: 'Rádio portátil', quantidade: 10, quantidadeRecebida: 12 }],
        valorEstimadoProcesso: 1_000_000,
      }),
    );
    assert.deepEqual(sinais.map((s) => s.tipo), ['recebimento_acima_contratado', 'reajuste_antecipado', 'sobrepreco_estimativa']);
    assert.match(sinais[1]?.evidencias[0] ?? '', /antes de 2026-01-10/);
    assert.match(sinais[2]?.descricao ?? '', /supera em 20%/);
  });

  it('valores inválidos', () => {
    assert.throws(() => sinaisAuditorContinuo(contrato({ valorInicial: 1.5 })), comCodigo('VALOR_INVALIDO'));
  });
});
