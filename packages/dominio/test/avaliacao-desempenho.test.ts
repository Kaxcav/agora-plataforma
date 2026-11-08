import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  NOTA_MINIMA_CERTIFICADO_DESEMPENHO,
  avaliarDesempenhoContratado,
  avaliarIncentivoDesempenho,
  clausulaCriterioDesempenhoEdital,
  comporNotaTecnicaComDesempenho,
  consolidarRegistroDesempenho,
  redigirCertificadoDesempenho,
  redigirDocumentoAvaliacaoDesempenho,
  simularImpactoDesempenho,
  situacaoAvaliacaoDesempenho,
  validarAnaliseManifestacao,
  validarCriterioDesempenhoTecnica,
  validarManifestacaoContratado,
  type AvaliacaoNoRegistro,
  type EntradaAvaliacaoDesempenho,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09'; // segunda-feira
const MOTIVACAO = 'Entregas conferidas nos termos de recebimento do período; duas entregas fora do prazo, já regularizadas pelo contratado.';

const base: EntradaAvaliacaoDesempenho = {
  tipo: 'parcial',
  periodoInicio: '2026-05-01',
  periodoFim: '2026-10-31',
  vigenciaInicio: '2026-01-15',
  vigenciaFim: '2027-01-14',
  indicadores: { entregasNoPrazo: 8, entregasTotal: 10, recebimentosAprovados: 9, recebimentosTotal: 10, ocorrenciasFiscalizacao: 4, ocorrenciasResolvidasNoPrazo: 3 },
  sancoes: [],
  motivacao: MOTIVACAO,
};

describe('avaliarDesempenhoContratado (art. 88, § 3º)', () => {
  it('calcula a nota pelos indicadores com os pesos do IDC e fixa o prazo de manifestação em 5 dias úteis', () => {
    const r = avaliarDesempenhoContratado(base, HOJE);
    // 0,4 × 80 + 0,4 × 90 + 0,2 × 75 = 83
    assert.equal(r.nota, 83);
    assert.equal(r.faixa, 'ouro');
    assert.equal(r.componentes.length, 3);
    assert.equal(r.prazoManifestacao, '2026-11-16');
    assert.match(r.fundamento, /art\. 88, § 3º/);
    assert.match(r.metodologia, /parcial/);
    assert.match(r.aviso, /não é sanção/);
  });

  it('desconta só as sanções aplicadas dentro do período avaliado', () => {
    const r = avaliarDesempenhoContratado(
      {
        ...base,
        sancoes: [
          { tipo: 'multa', dataAplicacao: '2026-07-10' },
          { tipo: 'advertencia', dataAplicacao: '2026-03-01' },
        ],
      },
      HOJE,
    );
    assert.equal(r.nota, 73);
    assert.deepEqual(r.penalidades.map((p) => p.tipo), ['multa']);
  });

  it('final na conclusão; o período não pode sair da vigência nem passar de hoje', () => {
    assert.equal(avaliarDesempenhoContratado({ ...base, tipo: 'final', periodoInicio: '2026-01-15', periodoFim: '2026-11-09' }, HOJE).nota, 83);
    assert.throws(() => avaliarDesempenhoContratado({ ...base, periodoInicio: '2026-01-01' }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(() => avaliarDesempenhoContratado({ ...base, periodoFim: '2026-11-10' }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(() => avaliarDesempenhoContratado({ ...base, periodoFim: '2026-04-30' }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(() => avaliarDesempenhoContratado({ ...base, tipo: 'mensal' as 'parcial' }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
  });

  it('exige motivação, indicador aferido e contagens coerentes', () => {
    assert.throws(() => avaliarDesempenhoContratado({ ...base, motivacao: 'Curta.' }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(
      () =>
        avaliarDesempenhoContratado(
          { ...base, indicadores: { entregasNoPrazo: 0, entregasTotal: 0, recebimentosAprovados: 0, recebimentosTotal: 0, ocorrenciasFiscalizacao: 2, ocorrenciasResolvidasNoPrazo: 1 } },
          HOJE,
        ),
      comCodigo('AVALIACAO_SEM_INDICADORES'),
    );
    assert.throws(() => avaliarDesempenhoContratado({ ...base, indicadores: { ...base.indicadores, entregasNoPrazo: 11 } }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(() => avaliarDesempenhoContratado({ ...base, indicadores: { ...base.indicadores, recebimentosTotal: 2.5 } }, HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
  });
});

describe('situação, manifestação e análise', () => {
  const prazo = '2026-11-16';
  it('em prazo, manifestada, definitiva por prazo, por concordância e por análise', () => {
    assert.equal(situacaoAvaliacaoDesempenho({ prazoManifestacao: prazo, manifestacao: null, analise: null }, '2026-11-16').situacao, 'em_manifestacao');
    assert.equal(situacaoAvaliacaoDesempenho({ prazoManifestacao: prazo, manifestacao: null, analise: null }, '2026-11-17').situacao, 'definitiva');
    assert.equal(situacaoAvaliacaoDesempenho({ prazoManifestacao: prazo, manifestacao: { concorda: true }, analise: null }, HOJE).definitiva, true);
    const discordou = situacaoAvaliacaoDesempenho({ prazoManifestacao: prazo, manifestacao: { concorda: false }, analise: null }, '2026-12-01');
    assert.equal(discordou.situacao, 'manifestada');
    assert.equal(discordou.definitiva, false);
    assert.match(situacaoAvaliacaoDesempenho({ prazoManifestacao: prazo, manifestacao: { concorda: false }, analise: { decisao: 'revista' } }, HOJE).explicacao, /revisou/);
  });

  it('a manifestação precisa estar no prazo e ter texto', () => {
    const a = { dataEmissao: HOJE, prazoManifestacao: prazo };
    assert.equal(validarManifestacaoContratado({ texto: 'Ciente e de acordo.', recebidaEm: '2026-11-12', concorda: true }, a, '2026-11-12').tempestiva, true);
    assert.throws(() => validarManifestacaoContratado({ texto: 'Discordamos da contagem.', recebidaEm: '2026-11-17', concorda: false }, a, '2026-11-18'), comCodigo('MANIFESTACAO_FORA_DO_PRAZO'));
    assert.throws(() => validarManifestacaoContratado({ texto: 'Discordamos.', recebidaEm: '2026-11-08', concorda: false }, a, HOJE), comCodigo('MANIFESTACAO_INVALIDA'));
    assert.throws(() => validarManifestacaoContratado({ texto: 'ok', recebidaEm: HOJE, concorda: false }, a, HOJE), comCodigo('MANIFESTACAO_INVALIDA'));
  });

  it('a análise mantém ou revisa, com motivação', () => {
    assert.equal(validarAnaliseManifestacao({ decisao: 'mantida', motivacao: MOTIVACAO }).decisao, 'mantida');
    assert.throws(() => validarAnaliseManifestacao({ decisao: 'anulada', motivacao: MOTIVACAO }), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
    assert.throws(() => validarAnaliseManifestacao({ decisao: 'revista', motivacao: 'curta' }), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
  });
});

describe('consolidarRegistroDesempenho (art. 87; art. 88, §§ 3º e 4º)', () => {
  const av = (id: string, contratoId: string, nota: number, extra: Partial<AvaliacaoNoRegistro> = {}): AvaliacaoNoRegistro => ({
    id,
    contratoId,
    tipo: 'parcial',
    periodoFim: '2026-06-30',
    nota,
    definitiva: true,
    emitidaEm: '2026-07-01T12:00:00.000Z',
    ...extra,
  });

  it('média por contrato das definitivas; a final prevalece sobre as parciais', () => {
    const r = consolidarRegistroDesempenho(
      [av('a1', 'c1', 70), av('a2', 'c1', 90, { tipo: 'final', periodoFim: '2026-03-31' }), av('a3', 'c2', 81), av('a4', 'c3', 20, { definitiva: false })],
      HOJE,
    );
    assert.equal(r.nota, 85.5);
    assert.equal(r.faixa, 'ouro');
    assert.deepEqual(r.avaliacoesConsideradas, ['a2', 'a3']);
    assert.equal(r.contratosConsiderados, 2);
    assert.match(r.versaoRegistro, /^[0-9a-f]{8}$/);
  });

  it('na mesma categoria vale a mais recente; fora da janela de 36 meses não entra', () => {
    const r = consolidarRegistroDesempenho([av('a1', 'c1', 60), av('a2', 'c1', 80, { periodoFim: '2026-09-30' }), av('a3', 'c2', 10, { periodoFim: '2023-11-09' })], HOJE);
    assert.equal(r.nota, 80);
    assert.deepEqual(r.avaliacoesConsideradas, ['a2']);
  });

  it('sem avaliação definitiva: sem nota e sem histórico; a versão muda quando o registro muda', () => {
    const vazio = consolidarRegistroDesempenho([], HOJE);
    assert.equal(vazio.nota, null);
    assert.equal(vazio.faixa, 'sem_historico');
    const um = consolidarRegistroDesempenho([av('a1', 'c1', 92)], HOJE);
    const outro = consolidarRegistroDesempenho([av('a1', 'c1', 92), av('a2', 'c2', 92)], HOJE);
    assert.notEqual(um.versaoRegistro, outro.versaoRegistro);
    assert.equal(um.faixa, 'diamante');
    assert.throws(() => consolidarRegistroDesempenho([av('a1', 'c1', 101)], HOJE), comCodigo('AVALIACAO_DESEMPENHO_INVALIDA'));
  });
});

describe('avaliarIncentivoDesempenho (art. 88, §§ 2º e 4º)', () => {
  it('certificado só com nota de ao menos 90 e sem impedimento; declaração com ao menos uma avaliação', () => {
    const otimo = { nota: NOTA_MINIMA_CERTIFICADO_DESEMPENHO, avaliacoesConsideradas: ['a1'] };
    const cert = avaliarIncentivoDesempenho(otimo, { impedido: false }, 'certificado', HOJE);
    assert.equal(cert.elegivel, true);
    assert.equal(cert.validoAte, '2027-11-09');
    assert.equal(avaliarIncentivoDesempenho({ nota: 89.9, avaliacoesConsideradas: ['a1'] }, { impedido: false }, 'certificado', HOJE).elegivel, false);
    assert.match(avaliarIncentivoDesempenho(otimo, { impedido: true }, 'certificado', HOJE).motivos.join(' '), /impedimento/);
    assert.equal(avaliarIncentivoDesempenho({ nota: 40, avaliacoesConsideradas: ['a1'] }, { impedido: true }, 'declaracao', HOJE).elegivel, true);
    assert.equal(avaliarIncentivoDesempenho({ nota: null, avaliacoesConsideradas: [] }, { impedido: false }, 'declaracao', HOJE).elegivel, false);
  });
});

describe('técnica e preço com desempenho anterior (art. 36, § 3º; art. 37, III)', () => {
  const criterio = { pesoDesempenhoPercentual: 20, notaSemHistorico: 50, regulamento: 'Portaria do órgão nº 1/2026, art. 5º' };

  it('compõe a nota técnica com a nota do registro ou com a nota do edital para quem não tem histórico', () => {
    const r = comporNotaTecnicaComDesempenho(80, 95, criterio);
    assert.equal(r.notaTecnica, 83);
    assert.equal(r.origem, 'registro');
    assert.match(r.memoria, /80% × 80/);
    const s = comporNotaTecnicaComDesempenho(80, null, criterio);
    assert.equal(s.notaTecnica, 74);
    assert.equal(s.origem, 'sem_historico');
  });

  it('a cláusula do edital traz a fórmula, a nota sem histórico e o regulamento', () => {
    const c = clausulaCriterioDesempenhoEdital(criterio);
    assert.match(c.corpo, /80% da nota técnica vêm da proposta técnica e 20%/);
    assert.match(c.corpo, /recebe, nessa parcela, a nota 50/);
    assert.match(c.corpo, /Portaria do órgão nº 1\/2026/);
    assert.match(c.fundamento, /art\. 36, § 3º/);
  });

  it('exige regulamento e critério de julgamento com técnica', () => {
    validarCriterioDesempenhoTecnica(criterio, 'tecnica_preco');
    assert.throws(() => validarCriterioDesempenhoTecnica({ ...criterio, regulamento: '' }, 'tecnica_preco'), comCodigo('CRITERIO_DESEMPENHO_SEM_REGULAMENTO'));
    assert.throws(() => validarCriterioDesempenhoTecnica(criterio, 'menor_preco'), comCodigo('CRITERIO_DESEMPENHO_INVALIDO'));
    assert.throws(() => validarCriterioDesempenhoTecnica({ ...criterio, pesoDesempenhoPercentual: 0 }, 'melhor_tecnica'), comCodigo('CRITERIO_DESEMPENHO_INVALIDO'));
    assert.throws(() => comporNotaTecnicaComDesempenho(101, 50, criterio), comCodigo('CRITERIO_DESEMPENHO_INVALIDO'));
  });
});

describe('simularImpactoDesempenho', () => {
  it('desempata pelo registro (art. 60, II) e classifica por técnica e preço com a fórmula do edital', () => {
    const r = simularImpactoDesempenho({
      licitantes: [
        { id: 'a', nome: 'Alfa', valorProposta: 100_000, notaDesempenho: 85, notaProposta: 80 },
        { id: 'b', nome: 'Beta', valorProposta: 100_000, notaDesempenho: 92, notaProposta: 80 },
        { id: 'c', nome: 'Gama', valorProposta: 100_000, notaDesempenho: null, notaProposta: 80 },
      ],
      criterio: { pesoDesempenhoPercentual: 20, notaSemHistorico: 50, regulamento: 'Portaria do órgão nº 1/2026', pesoTecnicoPercentual: 70 },
    });
    assert.equal(r.desempate.classificacao[0]?.id, 'b');
    assert.match(r.desempate.criterioDecisivo ?? '', /art\. 60, II/);
    assert.equal(r.tecnicaEPreco?.[0]?.id, 'b');
    assert.equal(r.tecnicaEPreco?.[2]?.origem, 'sem_historico');
    assert.throws(() => simularImpactoDesempenho({ licitantes: [{ id: 'a', nome: 'A', valorProposta: 1, notaDesempenho: null }] }), comCodigo('SIMULACAO_INVALIDA'));
  });
});

describe('documentos da avaliação e do incentivo', () => {
  it('o documento traz protocolo, indicadores, nota, motivação, prazo de manifestação e fundamentos', () => {
    const resultado = avaliarDesempenhoContratado(base, HOJE);
    const md = redigirDocumentoAvaliacaoDesempenho({
      protocolo: 'RCD-2026-000001',
      versao: 1,
      orgao: 'Órgão sintético',
      uasg: '200001',
      contrato: { numero: '1/2026', objeto: 'Objeto sintético', vigenciaInicio: base.vigenciaInicio, vigenciaFim: base.vigenciaFim, valorInicial: 1_000_000 },
      fornecedor: { nome: 'Empresa Sintética Ltda.', documento: '00.000.000/0001-00' },
      tipo: 'parcial',
      periodoInicio: base.periodoInicio,
      periodoFim: base.periodoFim,
      avaliador: { nome: 'Servidor Sintético', papel: 'gestor' },
      dataEmissao: HOJE,
      indicadores: base.indicadores,
      evidencias: 'Termos de recebimento 1 a 10.',
      motivacao: MOTIVACAO,
      resultado,
      manifestacao: null,
      analise: null,
    });
    for (const trecho of ['RCD-2026-000001', 'Nota: 83 de 100', 'faixa Ouro', '16/11/2026', 'art. 88, § 3º', 'Termos de recebimento 1 a 10.']) assert.ok(md.includes(trecho), trecho);
  });

  it('o certificado traz código, nota, critério e validade', () => {
    const md = redigirCertificadoDesempenho({
      tipo: 'certificado',
      codigo: 'CDF-ABCDEF12',
      orgao: 'Órgão sintético',
      fornecedor: { nome: 'Empresa Sintética Ltda.', documento: '00.000.000/0001-00' },
      registro: { nota: 92, faixa: 'diamante', contratosConsiderados: 1, versaoRegistro: '0a1b2c3d', metodologia: 'Metodologia.' },
      avaliacoes: [{ contrato: '1/2026', periodoFim: '2026-10-31', nota: 92, tipo: 'final' }],
      dataEmissao: HOJE,
      validoAte: '2027-11-09',
      emitidoPor: 'Servidor Sintético',
      criterio: 'Nota igual ou superior a 90.',
    });
    for (const trecho of ['Certificado de desempenho', 'CDF-ABCDEF12', '92 de 100', 'Diamante', '09/11/2027', 'art. 88, § 4º']) assert.ok(md.includes(trecho), trecho);
  });
});
