import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  conferirDfdComPca,
  consolidarDemandas,
  consolidarPca,
  consolidarQuantidadesIrp,
  ErroDominio,
  identificadorItemPca,
  interpretarLocalizacaoPncp,
  itemPlanoContratacoesPncp,
  numeroControlePncp,
  prazoMinimoIrp,
  regrasPorTela,
  situacaoIrp,
  sugerirItensCatalogo,
  sugerirRegistroPrecosCompartilhado,
  termosCatalogo,
  validarDemandaPca,
  validarTransicaoPca,
  verificarPrazoIrp,
  type CandidatoCatalogo,
  type DemandaPca,
  type DemandaUnidade,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

function demanda(id: string, mudancas: Partial<DemandaPca> = {}): DemandaPca {
  return {
    id,
    unidadeRequisitante: 'Coordenação de logística',
    descricao: 'Luvas táticas de proteção para operações',
    codigoCatalogo: '357301',
    tipoCatalogo: 'material',
    unidadeFornecimento: 'par',
    quantidade: 100,
    valorUnitario: 8_000,
    dataDesejada: '2027-03-10',
    prioridade: 'media',
    categoria: 'material',
    ...mudancas,
  };
}

describe('validarDemandaPca (Decreto 10.947/2022, art. 8º)', () => {
  it('demanda completa não tem pendências', () => {
    assert.deepEqual(validarDemandaPca(demanda('d1'), 2027), []);
  });

  it('aponta descrição, quantidade, valor, data fora do exercício, prioridade e código do catálogo', () => {
    const pendencias = validarDemandaPca(
      demanda('d1', {
        descricao: 'curta',
        quantidade: 0,
        valorUnitario: 0,
        dataDesejada: '2026-12-01',
        prioridade: 'urgente' as never,
        codigoCatalogo: 'ABC',
        tipoCatalogo: null,
      }),
      2027,
    );
    assert.equal(pendencias.length, 7);
    assert.match(pendencias.join(' '), /exercício de 2027/);
    assert.match(pendencias.join(' '), /baixo, médio ou alto/);
  });

  it('ano fora do intervalo lança ANO_PCA_INVALIDO', () => {
    assert.throws(() => validarDemandaPca(demanda('d1'), 1999), comCodigo('ANO_PCA_INVALIDO'));
  });
});

describe('consolidarPca (art. 12, VII; Decreto 10.947/2022, art. 11)', () => {
  it('agrega demandas de mesmo código, unidade e categoria, com a data mais cedo e a prioridade mais alta', () => {
    const r = consolidarPca(
      [
        demanda('d1', { unidadeRequisitante: 'Coordenação de logística', quantidade: 100, valorUnitario: 8_000, dataDesejada: '2027-05-01', prioridade: 'baixa' }),
        demanda('d2', { unidadeRequisitante: 'Divisão de operações', quantidade: 50, valorUnitario: 9_000, dataDesejada: '2027-03-01', prioridade: 'alta', unidadeFornecimento: 'PAR' }),
        demanda('d3', { codigoCatalogo: null, tipoCatalogo: null, descricao: 'Serviço de manutenção de drones', categoria: 'servico', unidadeFornecimento: 'serviço', quantidade: 1, valorUnitario: 1_000_000, dataDesejada: '2027-02-01', prioridade: 'media' }),
        demanda('d4', { codigoCatalogo: '357320', descricao: 'Óculos de proteção balística', unidadeFornecimento: 'unidade', quantidade: 40, valorUnitario: 5_000, prioridade: 'alta', dataDesejada: '2027-06-01' }),
      ],
      2027,
    );
    assert.equal(r.totalDemandas, 4);
    assert.equal(r.itens.length, 3);
    assert.equal(r.demandasAgregadas, 1);
    const luvas = r.itens.find((i) => i.codigoCatalogo === '357301');
    assert.ok(luvas);
    assert.deepEqual(luvas.demandas, ['d1', 'd2']);
    assert.deepEqual(luvas.unidadesRequisitantes, ['Coordenação de logística', 'Divisão de operações']);
    assert.equal(luvas.quantidade, 150);
    assert.equal(luvas.valorTotal, 100 * 8_000 + 50 * 9_000);
    assert.equal(luvas.valorUnitario, Math.round(1_250_000 / 150));
    assert.equal(luvas.dataDesejada, '2027-03-01');
    assert.equal(luvas.prioridade, 'alta');
    // Calendário de contratação: prioridade alta primeiro, depois a data desejada.
    assert.deepEqual(
      r.itens.map((i) => [i.numero, i.codigoCatalogo]),
      [
        [1, '357301'],
        [2, '357320'],
        [3, null],
      ],
    );
    assert.equal(r.valorTotal, r.itens.reduce((s, i) => s + i.valorTotal, 0));
    assert.match(r.fundamento, /arts\. 8º, 11 e 12/);
  });

  it('é determinística e não agrega unidades de fornecimento ou categorias diferentes', () => {
    const entrada = [demanda('a'), demanda('b', { unidadeFornecimento: 'caixa' }), demanda('c', { categoria: 'solucoes_tic' })];
    const r1 = consolidarPca(entrada, 2027);
    const r2 = consolidarPca([...entrada], 2027);
    assert.deepEqual(r1, r2);
    assert.equal(r1.itens.length, 3);
  });

  it('sem demandas ou com demanda incompleta, recusa', () => {
    assert.throws(() => consolidarPca([], 2027), comCodigo('PCA_SEM_DEMANDAS'));
    assert.throws(() => consolidarPca([demanda('x', { quantidade: -1 })], 2027), comCodigo('DEMANDA_PCA_INVALIDA'));
  });
});

describe('validarTransicaoPca (Decreto 10.947/2022, art. 12)', () => {
  it('segue em elaboração → consolidado → aprovado → publicado, com devolução para ajustes', () => {
    assert.equal(validarTransicaoPca('em_elaboracao', 'consolidar'), 'consolidado');
    assert.equal(validarTransicaoPca('consolidado', 'devolver'), 'em_elaboracao');
    assert.equal(validarTransicaoPca('consolidado', 'aprovar'), 'aprovado');
    assert.equal(validarTransicaoPca('aprovado', 'publicar'), 'publicado');
  });

  it('recusa saltos e repetições', () => {
    assert.throws(() => validarTransicaoPca('em_elaboracao', 'aprovar'), comCodigo('TRANSICAO_PCA_INVALIDA'));
    assert.throws(() => validarTransicaoPca('publicado', 'consolidar'), comCodigo('TRANSICAO_PCA_INVALIDA'));
    assert.throws(() => validarTransicaoPca('aprovado', 'devolver'), comCodigo('TRANSICAO_PCA_INVALIDA'));
  });
});

describe('identificadores e formato do PNCP para o PCA', () => {
  it('identificador legível do item', () => {
    assert.equal(identificadorItemPca({ uasg: '950002', ano: 2026, numero: 3 }), '950002/2026-0003');
    assert.throws(() => identificadorItemPca({ uasg: '95', ano: 2026, numero: 3 }), comCodigo('PCA_INVALIDO'));
  });

  it('número de controle do PCA com o marcador 0 e leitura do location devolvido pelo PNCP', () => {
    assert.equal(numeroControlePncp({ registro: 'pca', cnpj: '00000000000191', ano: 2027, sequencial: 12 }), '00000000000191-0-000012/2027');
    const l = interpretarLocalizacaoPncp('https://treina.pncp.gov.br/api/pncp/v1/orgaos/00000000000191/pca/2027/12');
    assert.equal(l.registro, 'pca');
    assert.equal(l.numeroControle, '00000000000191-0-000012/2027');
    assert.throws(() => interpretarLocalizacaoPncp('/v1/orgaos/00000000000191/pca/2027/12/atas/1'), comCodigo('PNCP_LOCALIZACAO_INVALIDA'));
    // As compras continuam como antes.
    assert.equal(interpretarLocalizacaoPncp('/v1/orgaos/00000000000191/compras/2026/7').numeroControle, '00000000000191-1-000007/2026');
  });

  it('item do plano no formato do PNCP: categoria, catálogo, classe e valores em reais', () => {
    const [item] = consolidarPca([demanda('d1', { quantidade: 3, valorUnitario: 12_345 })], 2027).itens;
    assert.ok(item);
    const pncp = itemPlanoContratacoesPncp(item, { codigo: '8415', nome: 'Vestuário de proteção' });
    assert.equal(pncp.categoriaItemPca, 1);
    assert.equal(pncp.catalogo, 1);
    assert.equal(pncp.classificacaoCatalogo, '1');
    assert.equal(pncp.codigoItem, '357301');
    assert.equal(pncp.valorUnitario, 123.45);
    assert.equal(pncp.valorTotal, 370.35);
    assert.equal(pncp.valorOrcamentoExercicio, 370.35);
    const semCodigo = itemPlanoContratacoesPncp({ ...item, codigoCatalogo: null, tipoCatalogo: null, categoria: 'servico' }, null);
    assert.equal(semCodigo.catalogo, 2);
    assert.equal(semCodigo.classificacaoCatalogo, '2');
    assert.equal(semCodigo.codigoItem, undefined);
    assert.equal(semCodigo.categoriaItemPca, 2);
  });
});

describe('conferirDfdComPca (art. 18, § 1º, II)', () => {
  const item = { identificador: '950002/2026-0001', descricao: 'Licenças', uasg: '950002', ano: 2026, valorTotal: 1_000_000, publicado: true };
  const base = { uasgProcesso: '950002', previstoNoPca: true, valorTotalDfd: 900_000, exigePca: true };

  it('UASG com PCA publicado e DFD sem vínculo: pendência que bloqueia', () => {
    const r = conferirDfdComPca({ ...base, vinculo: null });
    assert.equal(r.situacao, 'pendente');
    assert.equal(r.pendencias.length, 1);
    assert.match(r.pendencias[0] ?? '', /justificativa da contratação não planejada/);
    assert.match(r.fundamento, /art\. 18, § 1º, II/);
  });

  it('sem PCA publicado no exercício: não exige, só informa', () => {
    const r = conferirDfdComPca({ ...base, exigePca: false, vinculo: null });
    assert.equal(r.situacao, 'sem_pca_publicado');
    assert.deepEqual(r.pendencias, []);
    assert.equal(r.alertas[0]?.nivel, 'informativo');
  });

  it('fora do PCA: exige justificativa e marcação coerente', () => {
    const curta = conferirDfdComPca({ ...base, previstoNoPca: false, vinculo: { tipo: 'fora_do_pca', justificativa: 'curta' } });
    assert.equal(curta.pendencias.length, 1);
    const marcada = conferirDfdComPca({
      ...base,
      vinculo: { tipo: 'fora_do_pca', justificativa: 'Demanda surgida após a aprovação do plano, por nova atribuição legal da unidade.' },
    });
    assert.equal(marcada.situacao, 'fora_do_pca');
    assert.equal(marcada.pendencias.length, 1);
    assert.match(marcada.pendencias[0] ?? '', /marcação/);
    const ok = conferirDfdComPca({
      ...base,
      previstoNoPca: false,
      vinculo: { tipo: 'fora_do_pca', justificativa: 'Demanda surgida após a aprovação do plano, por nova atribuição legal da unidade.' },
    });
    assert.deepEqual(ok.pendencias, []);
    assert.match(ok.alertas[0]?.mensagem ?? '', /revisado/);
  });

  it('item vinculado: confere publicação, UASG, marcação e valor planejado', () => {
    assert.deepEqual(conferirDfdComPca({ ...base, vinculo: { tipo: 'item', item } }).pendencias, []);
    const acima = conferirDfdComPca({ ...base, valorTotalDfd: 1_500_000, vinculo: { tipo: 'item', item } });
    assert.deepEqual(acima.pendencias, []);
    assert.equal(acima.alertas[0]?.nivel, 'atencao');
    assert.match(acima.alertas[0]?.mensagem ?? '', /supera o planejado/);
    const errado = conferirDfdComPca({ ...base, previstoNoPca: false, vinculo: { tipo: 'item', item: { ...item, uasg: '910001', publicado: false } } });
    assert.equal(errado.pendencias.length, 3);
    assert.equal(conferirDfdComPca({ ...base, vinculo: { tipo: 'item', item: null } }).pendencias.length, 1);
  });
});

describe('sugerirItensCatalogo (RIA-13)', () => {
  const candidatos: CandidatoCatalogo[] = [
    { codigo: '357301', tipo: 'material', descricao: 'Luva de proteção tática em couro, com reforço nos nós dos dedos', classe: 'Vestuário de proteção', ativo: true },
    { codigo: '357302', tipo: 'material', descricao: 'Luva de procedimento descartável em nitrila', classe: 'Material hospitalar', ativo: true },
    { codigo: '357399', tipo: 'material', descricao: 'Luva tática de couro (código desativado)', classe: 'Vestuário de proteção', ativo: false },
    { codigo: '420615', tipo: 'material', descricao: 'Rádio transceptor digital portátil', classe: 'Comunicações', ativo: true },
    { codigo: '27502', tipo: 'servico', descricao: 'Licenciamento de software de análise forense', classe: 'Serviços de TIC', ativo: true },
  ];

  it('normaliza termos: acentos, palavras vazias e plurais', () => {
    assert.deepEqual(termosCatalogo('Luvas táticas de couro para as operações'), ['luva', 'tatica', 'couro', 'operacao']);
    assert.deepEqual(termosCatalogo(''), []);
  });

  it('ordena pela semelhança, ignora inativos e explica os termos em comum', () => {
    const r = sugerirItensCatalogo('Luvas táticas de couro legítimo com proteção nos nós dos dedos', candidatos);
    assert.equal(r.sugestoes[0]?.codigo, '357301');
    assert.ok((r.sugestoes[0]?.pontuacao ?? 0) > (r.sugestoes[1]?.pontuacao ?? 0));
    assert.ok(r.sugestoes.every((s) => s.codigo !== '357399'));
    assert.ok(r.sugestoes[0]?.termosComuns.includes('couro'));
    assert.match(r.aviso, /Requer revisão humana/);
    assert.match(r.fundamento, /art\. 19/);
  });

  it('filtra por tipo, respeita o limite e a pontuação mínima, e é determinística', () => {
    const servico = sugerirItensCatalogo('Software forense', candidatos, { tipo: 'servico' });
    assert.deepEqual(servico.sugestoes.map((s) => s.codigo), ['27502']);
    assert.equal(sugerirItensCatalogo('Luva', candidatos, { limite: 1 }).sugestoes.length, 1);
    assert.deepEqual(sugerirItensCatalogo('Caneta esferográfica azul', candidatos).sugestoes, []);
    assert.deepEqual(sugerirItensCatalogo('luvas taticas', candidatos), sugerirItensCatalogo('luvas taticas', [...candidatos]));
    assert.throws(() => sugerirItensCatalogo('luva', candidatos, { limite: 0 }), comCodigo('SUGESTAO_INVALIDA'));
  });
});

describe('consolidarDemandas e registro de preços compartilhado (RIA-01)', () => {
  const demandas: DemandaUnidade[] = [
    { uasg: '930001', origem: 'dfd', referencia: 'processo A', codigoCatalogo: '357301', descricao: 'Luvas táticas', quantidade: 300, unidadeFornecimento: 'par' },
    { uasg: '930002', origem: 'pca', referencia: '930002/2026-0001', codigoCatalogo: '357301', descricao: 'Luvas táticas', quantidade: 150, unidadeFornecimento: 'par' },
    { uasg: '940002', origem: 'pca', referencia: '940002/2026-0002', codigoCatalogo: '357301', descricao: 'Luvas táticas', quantidade: 80, unidadeFornecimento: 'par' },
    { uasg: '930002', origem: 'dfd', referencia: 'processo B', codigoCatalogo: '357301', descricao: 'Luvas táticas', quantidade: 20, unidadeFornecimento: 'par' },
    { uasg: '930001', origem: 'dfd', referencia: 'processo A', codigoCatalogo: '357320', descricao: 'Óculos', quantidade: 300, unidadeFornecimento: 'unidade' },
  ];

  it('agrupa por código só quando há duas ou mais UASGs', () => {
    const grupos = consolidarDemandas(demandas);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0]?.codigoCatalogo, '357301');
    assert.equal(grupos[0]?.quantidadeTotal, 550);
    assert.deepEqual(grupos[0]?.unidades.map((u) => [u.uasg, u.quantidade]), [
      ['930001', 300],
      ['930002', 170],
      ['940002', 80],
    ]);
  });

  it('sugere o registro compartilhado para os códigos do processo, com as outras unidades', () => {
    const [s] = sugerirRegistroPrecosCompartilhado({ uasg: '930001', codigos: ['357301', '357320'] }, demandas);
    assert.ok(s);
    assert.deepEqual(s.outrasUnidades.map((u) => u.uasg), ['930002', '940002']);
    assert.match(s.mensagem, /intenção de registro de preços/);
    assert.match(s.fundamento, /art\. 86/);
    assert.deepEqual(sugerirRegistroPrecosCompartilhado({ uasg: '910001', codigos: ['357301'] }, demandas), []);
  });
});

describe('intenção de registro de preços (RN-38)', () => {
  const calendario = { feriadosExtras: [], considerarPontosFacultativos: true };

  it('encerramento mínimo: 8 dias úteis excluído o dia da abertura, sem contar o fim de semana', () => {
    // 2026-11-09 é segunda-feira; contam 10 a 13 e 16 a 19 de novembro (o fim de semana não conta).
    const r = prazoMinimoIrp('2026-11-09', calendario);
    assert.equal(r.diasUteis, 8);
    assert.equal(r.encerramentoMinimo, '2026-11-19');
    assert.match(r.fundamento, /art\. 86/);
  });

  it('recusa período menor que 8 dias úteis e abertura no passado', () => {
    const curto = verificarPrazoIrp({ abertura: '2026-11-09', encerramento: '2026-11-12', hoje: '2026-11-09' }, calendario);
    assert.equal(curto.valido, false);
    assert.equal(curto.diasUteis, 3);
    assert.match(curto.pendencias[0] ?? '', /pelo menos 8 dias úteis/);
    assert.match(curto.pendencias[0] ?? '', /19\/11\/2026/);
    // Feriado do órgão (12/11) e o feriado nacional de 20/11 adiam o encerramento mínimo para a segunda-feira 23/11.
    assert.equal(prazoMinimoIrp('2026-11-09', { ...calendario, feriadosExtras: ['2026-11-12'] }).encerramentoMinimo, '2026-11-23');
    const passado = verificarPrazoIrp({ abertura: '2026-11-02', encerramento: '2026-12-30', hoje: '2026-11-09' }, calendario);
    assert.equal(passado.valido, false);
    assert.match(passado.pendencias[0] ?? '', /anterior a hoje/);
    const ok = verificarPrazoIrp({ abertura: '2026-11-09', encerramento: '2026-11-19', hoje: '2026-11-09' }, calendario);
    assert.equal(ok.valido, true);
    assert.equal(ok.diasUteis, 8);
    assert.equal(verificarPrazoIrp({ abertura: 'x', encerramento: '2026-11-23', hoje: '2026-11-09' }).valido, false);
  });

  it('situação: agendada, aberta (inclusive no encerramento), encerrada e consolidada', () => {
    const irp = { abertura: '2026-11-10', encerramento: '2026-11-24', consolidada: false };
    assert.equal(situacaoIrp(irp, '2026-11-09'), 'agendada');
    assert.equal(situacaoIrp(irp, '2026-11-10'), 'aberta');
    assert.equal(situacaoIrp(irp, '2026-11-24'), 'aberta');
    assert.equal(situacaoIrp(irp, '2026-11-25'), 'encerrada');
    assert.equal(situacaoIrp({ ...irp, consolidada: true }, '2026-11-25'), 'consolidada');
  });

  it('consolida as quantidades do gerenciador e dos participantes', () => {
    const r = consolidarQuantidadesIrp({ uasg: '930001', quantidade: 300 }, [
      { uasg: '930002', quantidade: 150 },
      { uasg: '940002', quantidade: 50 },
    ]);
    assert.equal(r.quantidadeTotal, 500);
    assert.deepEqual(r.participantes.map((p) => [p.uasg, p.papel, p.percentual]), [
      ['930001', 'gerenciador', 60],
      ['930002', 'participante', 30],
      ['940002', 'participante', 10],
    ]);
    assert.throws(() => consolidarQuantidadesIrp({ uasg: '930001', quantidade: 1 }, [{ uasg: '930001', quantidade: 2 }]), comCodigo('ADESAO_DUPLICADA'));
    assert.throws(() => consolidarQuantidadesIrp({ uasg: '930001', quantidade: 0 }, []), comCodigo('QUANTIDADE_INVALIDA'));
  });
});

describe('catálogo de regras da frente de planejamento', () => {
  it('RN-38, RF-31 e RIA-13 no catálogo, com as telas do planejamento e do DFD', () => {
    const porId = new Map(CATALOGO_REGRAS.map((r) => [r.id, r]));
    assert.equal(porId.get('RN-38')?.tipo, 'RN');
    assert.match(porId.get('RN-38')?.descricao ?? '', /8 dias úteis/);
    assert.equal(porId.get('RF-31')?.tipo, 'RF');
    assert.equal(porId.get('RIA-13')?.tipo, 'RIA');
    assert.match(porId.get('RIA-13')?.descricao ?? '', /o agente confere/);
    const dfd = regrasPorTela('jornada.dfd').map((r) => r.id);
    for (const id of ['RF-31', 'RIA-13', 'RN-38', 'RIA-01', 'RN-02']) assert.ok(dfd.includes(id), id);
    assert.ok(regrasPorTela('planejamento.pca').some((r) => r.id === 'RF-31'));
    assert.deepEqual(regrasPorTela('planejamento.irp').map((r) => r.id).sort(), ['RF-31', 'RN-38']);
  });
});
