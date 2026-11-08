import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  categoriaPadraoFato,
  derivarFatosExecucao,
  secaoLicoesAceitas,
  semelhancaObjeto,
  sugerirClausulasLicoes,
  termosObjeto,
  type ContratoBaseConhecimento,
  type FatoExecucao,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09';

const coletes: ContratoBaseConhecimento = {
  id: 'c1',
  numero: '7/2026',
  objeto: 'Aquisição de coletes balísticos nível III-A e capacetes balísticos',
  itens: [{ catmat: '466422', descricao: 'Colete balístico nível III-A, modelo feminino, tamanho M' }],
};
const viaturas: ContratoBaseConhecimento = {
  id: 'c2',
  numero: '11/2026',
  objeto: 'Aquisição de viaturas caracterizadas tipo SUV 4x4 e sedã',
  itens: [{ catmat: '150350', descricao: 'Viatura caracterizada tipo SUV 4x4' }],
};
const radios: ContratoBaseConhecimento = {
  id: 'c3',
  numero: '14/2026',
  objeto: 'Aquisição de rádios transceptores digitais portáteis e móveis',
  itens: [{ catmat: '411230', descricao: 'Bateria de íons de lítio para rádio portátil' }],
};

const fato = (id: string, contratoId: string, tipo: FatoExecucao['tipo'], data = '2026-05-10'): FatoExecucao => ({
  id,
  contratoId,
  tipo,
  categoria: categoriaPadraoFato(tipo),
  data,
  descricao: `Fato sintético ${id}`,
});

describe('termos e semelhança de objeto', () => {
  it('normaliza acentos e plurais e descarta palavras vazias', () => {
    assert.deepEqual(termosObjeto('Aquisição de Coletes Balísticos nível III-A'), ['balistico', 'colete', 'iii', 'nivel']);
    assert.deepEqual(termosObjeto('Rádios transceptores digitais'), ['digital', 'radio', 'transceptor']);
  });

  it('mesmo código do catálogo vale 1; texto parecido vale pela fração de termos em comum', () => {
    assert.deepEqual(semelhancaObjeto({ descricao: 'Outro objeto', itens: [{ catmat: '466422', descricao: 'Item' }] }, coletes).motivo, 'catalogo');
    const texto = semelhancaObjeto({ descricao: 'Coletes balísticos para a Força Nacional', itens: [{ catmat: '999999', descricao: 'Colete balístico nível III-A masculino' }] }, coletes);
    assert.equal(texto.motivo, 'texto');
    assert.ok(texto.indice >= 0.5);
    assert.ok(texto.termos.includes('colete'));
    assert.equal(semelhancaObjeto({ descricao: 'Viaturas SUV', itens: [] }, coletes).motivo, null);
  });
});

describe('derivarFatosExecucao', () => {
  it('aditivo de acréscimo acima de 15%, sanção por inciso e avaliação definitiva abaixo de 60', () => {
    const fatos = derivarFatosExecucao({
      contratoId: 'c1',
      valorInicial: 1_000_000,
      aditivos: [
        { id: 'a1', tipo: 'acrescimo', valor: 200_000, assinadoEm: '2026-04-01', justificativa: 'Acréscimo' },
        { id: 'a2', tipo: 'acrescimo', valor: 150_000, assinadoEm: '2026-05-01', justificativa: 'Acréscimo no limite' },
        { id: 'a3', tipo: 'prorrogacao', valor: 0, assinadoEm: '2026-06-01', justificativa: 'Prorrogação' },
      ],
      sancoes: [
        { id: 's1', tipo: 'multa', incisoInfracao: 'VII', aplicadaEm: '2026-03-01', relato: 'Atraso injustificado na entrega.' },
        { id: 's2', tipo: 'advertencia', incisoInfracao: 'I', aplicadaEm: '2026-03-02', relato: 'Inexecução parcial.' },
        { id: 's3', tipo: 'advertencia', incisoInfracao: 'IV', aplicadaEm: '2026-03-03', relato: 'Documentação não entregue.' },
      ],
      avaliacoes: [
        { id: 'v1', nota: 55, periodoFim: '2026-06-30', definitiva: true },
        { id: 'v2', nota: 40, periodoFim: '2026-07-31', definitiva: false },
        { id: 'v3', nota: 75, periodoFim: '2026-08-31', definitiva: true },
      ],
    });
    assert.deepEqual(
      fatos.map((f) => `${f.tipo}:${f.categoria}`),
      ['aditivo:quantitativo', 'sancao:prazo', 'sancao:garantia', 'sancao:fiscalizacao', 'avaliacao:fiscalizacao'],
    );
    assert.match(fatos[0]?.descricao ?? '', /20%/);
  });

  it('rescisão assinada (registro das alterações contratuais) vira fato de garantia', () => {
    const fatos = derivarFatosExecucao({
      contratoId: 'c1',
      valorInicial: 1_000_000,
      aditivos: [],
      sancoes: [],
      avaliacoes: [],
      rescisoes: [{ id: 'r1', assinadaEm: '2026-08-01', justificativa: 'Inexecução reiterada das entregas.' }],
    });
    assert.deepEqual(fatos.map((f) => `${f.tipo}:${f.categoria}:${f.data}`), ['rescisao:garantia:2026-08-01']);
    assert.match(fatos[0]?.descricao ?? '', /Inexecução reiterada/);
  });

  it('categoria padrão de cada tipo de fato', () => {
    assert.equal(categoriaPadraoFato('atraso'), 'prazo');
    assert.equal(categoriaPadraoFato('glosa'), 'nivel_servico');
    assert.equal(categoriaPadraoFato('rescisao'), 'garantia');
    assert.throws(() => categoriaPadraoFato('outro' as 'atraso'), comCodigo('FATO_EXECUCAO_INVALIDO'));
  });
});

describe('sugerirClausulasLicoes (RIA-12)', () => {
  const fatos = [fato('f1', 'c1', 'atraso'), fato('f2', 'c1', 'ocorrencia'), fato('f3', 'c1', 'atraso', '2026-06-01'), fato('f4', 'c2', 'rescisao'), fato('f5', 'c3', 'glosa')];
  const pretendido = { descricao: 'Aquisição de coletes balísticos nível III-A para a Força Nacional', itens: [{ catmat: null, descricao: 'Colete balístico nível III-A (NIJ 0101.06)' }] };

  it('só usa contratos semelhantes e devolve sinal com fontes, premissas e revisão humana', () => {
    const tr = sugerirClausulasLicoes(pretendido, [coletes, viaturas, radios], fatos, 'tr', HOJE);
    assert.deepEqual(tr.map((s) => s.chave), ['tr:prazo', 'tr:qualidade']);
    const prazo = tr[0];
    assert.ok(prazo);
    assert.equal(prazo.regra, 'RIA-12');
    assert.equal(prazo.ocorrencias, 2);
    assert.equal(prazo.fontes[0]?.numero, '7/2026');
    assert.equal(prazo.fontes[0]?.fatos[0]?.data, '2026-06-01');
    assert.match(prazo.fontes[0]?.motivo ?? '', /objeto semelhante/);
    assert.match(prazo.fundamento, /art\. 162/);
    assert.match(prazo.aviso, /requer revisão humana/);
    assert.ok(prazo.premissas.some((p) => p.includes('09/11/2026')));
    assert.match(tr[1]?.fundamento ?? '', /art\. 17, § 3º/);
  });

  it('cada documento tem as suas cláusulas; sem semelhança não há sugestão', () => {
    assert.deepEqual(sugerirClausulasLicoes(pretendido, [coletes], fatos, 'dfd', HOJE).map((s) => s.chave), ['dfd:prazo', 'dfd:qualidade']);
    assert.deepEqual(sugerirClausulasLicoes(pretendido, [coletes], fatos, 'etp', HOJE).map((s) => s.chave), ['etp:prazo', 'etp:qualidade']);
    assert.deepEqual(sugerirClausulasLicoes({ descricao: 'Mobiliário de escritório', itens: [] }, [coletes, viaturas, radios], fatos, 'tr', HOJE), []);
    const porCatalogo = sugerirClausulasLicoes({ descricao: 'Baterias', itens: [{ catmat: '411230', descricao: 'Bateria' }] }, [radios], fatos, 'tr', HOJE);
    assert.deepEqual(porCatalogo.map((s) => s.chave), ['tr:nivel_servico']);
    assert.match(porCatalogo[0]?.fontes[0]?.motivo ?? '', /catálogo/);
    assert.throws(() => sugerirClausulasLicoes(pretendido, [], fatos, 'edital' as 'tr', HOJE), comCodigo('LICAO_INVALIDA'));
  });

  it('fato futuro não entra', () => {
    assert.deepEqual(sugerirClausulasLicoes(pretendido, [coletes], [fato('f9', 'c1', 'atraso', '2026-12-01')], 'tr', HOJE), []);
  });
});

describe('secaoLicoesAceitas', () => {
  it('monta a seção só com as aceitas, com origem e quem decidiu', () => {
    assert.equal(secaoLicoesAceitas([]), null);
    const s = secaoLicoesAceitas([
      { titulo: 'Cronograma', clausula: 'Fixar marcos.', fundamento: 'Lei 14.133/2021, art. 162', contratos: ['7/2026'], decididaPor: 'Servidora Sintética', decididaEm: HOJE },
    ]);
    assert.ok(s);
    assert.match(s.corpo, /RIA-12/);
    assert.match(s.corpo, /7\/2026/);
    assert.match(s.corpo, /09\/11\/2026/);
    assert.equal(s.premissas.length, 1);
  });
});
