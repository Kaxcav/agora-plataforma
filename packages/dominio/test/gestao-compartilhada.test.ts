import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  avaliarPublicacaoRegistroExecucao,
  contemDadoPessoal,
  nomePublicoCidadao,
  prazoRespostaManifestacao,
  situacaoPrazoResposta,
  tarjarDadosPessoaisLivres,
  validarCpf,
  validarDecisaoModeracao,
  validarManifestacao,
  validarRelatorioFinal,
  validarResposta,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

/** CPF sintético: dígitos verificadores calculados sobre uma base inventada. */
function cpfSintetico(base: string): string {
  const digito = (parcial: string) => {
    const soma = [...parcial].reduce((t, d, i) => t + Number(d) * (parcial.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return String(resto === 10 ? 0 : resto);
  };
  const primeiro = digito(base);
  return `${base}${primeiro}${digito(base + primeiro)}`;
}

const CPF = cpfSintetico('314159265');
const CPF_FORMATADO = `${CPF.slice(0, 3)}.${CPF.slice(3, 6)}.${CPF.slice(6, 9)}-${CPF.slice(9)}`;

describe('tarjarDadosPessoaisLivres (LGPD)', () => {
  it('o CPF sintético é válido', () => {
    assert.ok(validarCpf(CPF));
  });

  it('tarja CPF formatado e sem pontuação, e-mail e telefones', () => {
    const texto = `Meu CPF é ${CPF_FORMATADO}, ou ${CPF}; escreva para maria.souza@exemplo.test ou ligue (61) 99876-1234, 61 3333-4444 ou 99876-1234.`;
    const tarjado = tarjarDadosPessoaisLivres(texto);
    assert.ok(!tarjado.includes(CPF_FORMATADO));
    assert.ok(!tarjado.includes(CPF));
    assert.ok(!tarjado.includes('maria.souza@'));
    assert.ok(!tarjado.includes('99876-1234'));
    assert.ok(!tarjado.includes('3333-4444'));
    assert.match(tarjado, /\*\*\*\.\d{3}\.\d{3}-\*\*/);
    assert.match(tarjado, /m\*+@exemplo\.test/);
  });

  it('mantém números que não são dado pessoal: CNPJ, valores, datas, contrato e 11 dígitos sem CPF válido', () => {
    const texto = 'Contrato 12/2026, CNPJ 12.345.678/0001-90, valor R$ 1.234.567,89, em 2026-11-09; protocolo 12345678901.';
    assert.equal(tarjarDadosPessoaisLivres(texto), texto);
    assert.equal(contemDadoPessoal(texto), false);
  });

  it('é idempotente e contemDadoPessoal reconhece o texto já tarjado', () => {
    const uma = tarjarDadosPessoaisLivres(`CPF ${CPF}`);
    assert.equal(tarjarDadosPessoaisLivres(uma), uma);
    assert.equal(contemDadoPessoal(`CPF ${CPF}`), true);
    assert.equal(contemDadoPessoal(uma), false);
    assert.equal(tarjarDadosPessoaisLivres(''), '');
  });
});

describe('validarManifestacao (art. 174, § 3º, VI, "a")', () => {
  it('normaliza o texto e prepara a versão pública com dados tarjados', () => {
    const r = validarManifestacao(`  A obra da quadra está parada há duas semanas.\r\n\r\n\r\nContato: ${CPF_FORMATADO}\u0007  `);
    assert.equal(r.texto, `A obra da quadra está parada há duas semanas.\n\nContato: ${CPF_FORMATADO}`);
    assert.ok(!r.textoPublico.includes(CPF_FORMATADO));
    assert.equal(r.dadosPessoaisTarjados, true);
  });

  it('recusa texto curto ou longo demais', () => {
    assert.throws(() => validarManifestacao('curto'), comCodigo('MANIFESTACAO_INVALIDA'));
    assert.throws(() => validarManifestacao('x'.repeat(2001)), comCodigo('MANIFESTACAO_INVALIDA'));
  });
});

describe('validarDecisaoModeracao', () => {
  it('exige motivo de 10 a 500 caracteres e só modera o que está em moderação', () => {
    const ok = validarDecisaoModeracao({ decisao: 'publicar', motivo: '  Relato pertinente à execução.  ', situacaoAtual: 'em_moderacao' });
    assert.deepEqual(ok, { decisao: 'publicar', motivo: 'Relato pertinente à execução.' });
    assert.throws(() => validarDecisaoModeracao({ decisao: 'recusar', motivo: 'curto', situacaoAtual: 'em_moderacao' }), comCodigo('MOTIVO_MODERACAO'));
    assert.throws(() => validarDecisaoModeracao({ decisao: 'publicar', motivo: 'Motivo suficiente.', situacaoAtual: 'publicada' }), comCodigo('MODERACAO_ENCERRADA'));
    assert.throws(
      () => validarDecisaoModeracao({ decisao: 'apagar' as 'publicar', motivo: 'Motivo suficiente.', situacaoAtual: 'em_moderacao' }),
      comCodigo('MODERACAO_INVALIDA'),
    );
  });
});

describe('nomePublicoCidadao', () => {
  it('mostra só o primeiro nome e as iniciais', () => {
    assert.equal(nomePublicoCidadao('Maria das Graças Souza'), 'Maria G. S.');
    assert.equal(nomePublicoCidadao('   '), 'Cidadão identificado');
  });
});

describe('prazo de resposta (Lei 13.460/2017, art. 16)', () => {
  it('30 dias corridos do recebimento; 60 com a prorrogação', () => {
    assert.equal(prazoRespostaManifestacao('2026-11-09'), '2026-12-09');
    assert.equal(prazoRespostaManifestacao('2026-11-09', true), '2027-01-08');
    assert.throws(() => prazoRespostaManifestacao('09/11/2026'), comCodigo('DATA_INVALIDA'));
  });

  it('situação: aguardando, vence em breve, vencido e respondida no prazo ou fora dele', () => {
    const prazo = '2026-12-09';
    assert.deepEqual(situacaoPrazoResposta({ prazo, respondidaEm: null, hoje: '2026-11-20' }).situacao, 'aguardando');
    const breve = situacaoPrazoResposta({ prazo, respondidaEm: null, hoje: '2026-12-05' });
    assert.equal(breve.situacao, 'vence_em_breve');
    assert.equal(breve.diasRestantes, 4);
    assert.equal(situacaoPrazoResposta({ prazo, respondidaEm: null, hoje: '2026-12-10' }).situacao, 'vencido');
    assert.equal(situacaoPrazoResposta({ prazo, respondidaEm: '2026-12-09', hoje: '2026-12-20' }).situacao, 'respondida_no_prazo');
    assert.equal(situacaoPrazoResposta({ prazo, respondidaEm: '2026-12-10', hoje: '2026-12-20' }).situacao, 'respondida_fora_do_prazo');
    assert.equal(situacaoPrazoResposta({ prazo, respondidaEm: null, hoje: '2026-11-20' }).fundamento, 'Lei 13.460/2017, art. 16');
  });
});

describe('validarResposta (art. 174, § 3º, VI, "c")', () => {
  const texto = 'A equipe retoma a obra na segunda-feira, conforme o cronograma revisado.';
  it('resposta do contratado exige o preposto; a da Administração não guarda representante', () => {
    assert.throws(() => validarResposta({ origem: 'contratado', texto, representante: null, situacaoManifestacao: 'publicada' }), comCodigo('REPRESENTANTE_OBRIGATORIO'));
    const contratado = validarResposta({ origem: 'contratado', texto, representante: ' Preposto Sintético ', situacaoManifestacao: 'publicada' });
    assert.equal(contratado.representante, 'Preposto Sintético');
    const adm = validarResposta({ origem: 'administracao', texto, representante: 'ignorado', situacaoManifestacao: 'publicada' });
    assert.equal(adm.representante, null);
  });

  it('só responde manifestação publicada; tarja dado pessoal na versão pública', () => {
    assert.throws(() => validarResposta({ origem: 'administracao', texto, representante: null, situacaoManifestacao: 'em_moderacao' }), comCodigo('MANIFESTACAO_NAO_PUBLICADA'));
    const r = validarResposta({ origem: 'administracao', texto: `${texto} Dúvidas: atendimento@exemplo.test`, representante: null, situacaoManifestacao: 'publicada' });
    assert.ok(!r.textoPublico.includes('atendimento@exemplo.test'));
    assert.throws(() => validarResposta({ origem: 'administracao', texto: 'curta', representante: null, situacaoManifestacao: 'publicada' }), comCodigo('RESPOSTA_INVALIDA'));
  });
});

describe('avaliarPublicacaoRegistroExecucao (ponto de checagem do sigilo)', () => {
  it('registro sigiloso, por declaração ou por classificação, não é publicado', () => {
    assert.deepEqual(avaliarPublicacaoRegistroExecucao({ declaradoSigiloso: false, classificacaoSigilosa: false }).publicavel, true);
    const declarado = avaliarPublicacaoRegistroExecucao({ declaradoSigiloso: true, classificacaoSigilosa: false });
    assert.equal(declarado.publicavel, false);
    assert.match(declarado.motivo ?? '', /sigiloso/);
    assert.equal(avaliarPublicacaoRegistroExecucao({ declaradoSigiloso: false, classificacaoSigilosa: true }).publicavel, false);
    assert.match(declarado.fundamento, /art\. 13/);
  });
});

describe('validarRelatorioFinal (art. 174, § 3º, VI, "d")', () => {
  const objetivos = 'Atender à demanda de equipamentos de proteção das equipes de campo, com entrega integral nas unidades e substituição dos itens vencidos.';
  const resultados = 'Foram entregues todos os itens previstos, dentro do prazo, sem ocorrências de qualidade; as unidades registraram a substituição completa.';

  it('só depois do fim da vigência', () => {
    assert.throws(() => validarRelatorioFinal({ vigenciaFim: '2026-11-10', hoje: '2026-11-09', objetivos, resultados, conclusao: 'atingidos' }), comCodigo('CONTRATO_EM_EXECUCAO'));
    const r = validarRelatorioFinal({ vigenciaFim: '2026-11-09', hoje: '2026-11-09', objetivos, resultados, conclusao: 'atingidos' });
    assert.equal(r.conclusao, 'atingidos');
    assert.match(r.fundamento, /"d"/);
  });

  it('exige textos de 100 caracteres ou mais e conclusão válida', () => {
    assert.throws(() => validarRelatorioFinal({ vigenciaFim: '2026-01-01', hoje: '2026-11-09', objetivos: 'curto', resultados, conclusao: 'atingidos' }), comCodigo('RELATORIO_INVALIDO'));
    assert.throws(
      () => validarRelatorioFinal({ vigenciaFim: '2026-01-01', hoje: '2026-11-09', objetivos, resultados, conclusao: 'talvez' as 'atingidos' }),
      comCodigo('CONCLUSAO_INVALIDA'),
    );
  });
});

describe('catálogo: RF-37 e RF-38', () => {
  it('RF-37 cita as alíneas "a" a "d" do art. 174, § 3º, VI, e o art. 19, III; RF-38 cita o Decreto 8.777/2016', () => {
    const rf37 = CATALOGO_REGRAS.find((r) => r.id === 'RF-37');
    const rf38 = CATALOGO_REGRAS.find((r) => r.id === 'RF-38');
    assert.ok(rf37 && rf38);
    assert.match(rf37.fundamento, /art\. 174, § 3º, VI, alíneas "a" a "d", e art\. 19, III/);
    assert.ok(rf37.telas.includes('sociedade'));
    assert.match(rf38.fundamento, /Decreto 8\.777\/2016/);
    assert.ok(rf38.telas.includes('dados-abertos'));
    assert.match(rf37.descricao, /moderador/);
  });
});
