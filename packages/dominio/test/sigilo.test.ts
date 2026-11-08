import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancoragemDevida,
  autoridadeCompetenteSigilo,
  CATALOGO_REGRAS,
  classificacaoVigente,
  codigoIndexacaoSigilo,
  conferirAncoragem,
  declaracaoAncoragem,
  decidirAcessoSigilo,
  ErroDominio,
  grauAbrange,
  marcacaoSigilo,
  prazoMaximoSigilo,
  regrasPorTela,
  situacaoOrcamentoSigiloso,
  validarClassificacaoSigilo,
  type EntradaClassificacaoSigilo,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const HOJE = '2026-11-09';
const RAZOES = 'Especificações táticas de equipamento de uso policial cuja divulgação compromete operações em andamento.';

function lai(extra: Partial<EntradaClassificacaoSigilo> = {}): EntradaClassificacaoSigilo {
  return {
    tipo: 'lai',
    grau: 'reservada',
    hipotese: 'VIII',
    razoes: RAZOES,
    dataProducao: '2026-11-01',
    prazoFim: '2028-11-01',
    eventoFim: null,
    autoridade: { nome: 'Autoridade Sintética', cargo: 'Diretor de Logística', nivel: 'direcao_das_101_5', atoDelegacao: null },
    orcamentoSigilosoNoProcesso: false,
    criterioJulgamento: 'menor_preco',
    ...extra,
  };
}

describe('prazoMaximoSigilo e competência (LAI, arts. 24, § 1º, e 27)', () => {
  it('5, 15 e 25 anos contados da produção', () => {
    assert.equal(prazoMaximoSigilo('reservada', '2026-11-08'), '2031-11-08');
    assert.equal(prazoMaximoSigilo('secreta', '2026-11-08'), '2041-11-08');
    assert.equal(prazoMaximoSigilo('ultrassecreta', '2026-11-08'), '2051-11-08');
    // 29/02 sem correspondente no ano final: vence no dia imediato (CC, art. 132, § 3º).
    assert.equal(prazoMaximoSigilo('reservada', '2028-02-29'), '2033-03-01');
  });

  it('grau inválido e data inválida são recusados', () => {
    assert.throws(() => prazoMaximoSigilo('confidencial' as 'reservada', '2026-11-08'), comCodigo('SIGILO_INVALIDO'));
    assert.throws(() => prazoMaximoSigilo('reservada', '2026-02-30'), comCodigo('SIGILO_INVALIDO'));
  });

  it('competência por grau, com delegação só para secreta e ultrassecreta', () => {
    assert.equal(autoridadeCompetenteSigilo('ultrassecreta', 'ministro_estado'), true);
    assert.equal(autoridadeCompetenteSigilo('ultrassecreta', 'titular_entidade'), false);
    assert.equal(autoridadeCompetenteSigilo('secreta', 'titular_entidade'), true);
    assert.equal(autoridadeCompetenteSigilo('secreta', 'direcao_das_101_5'), false);
    assert.equal(autoridadeCompetenteSigilo('secreta', 'delegacao'), true);
    assert.equal(autoridadeCompetenteSigilo('reservada', 'direcao_das_101_5'), true);
    assert.equal(autoridadeCompetenteSigilo('reservada', 'delegacao'), false);
  });

  it('grauAbrange segue reservada < secreta < ultrassecreta', () => {
    assert.equal(grauAbrange('secreta', 'reservada'), true);
    assert.equal(grauAbrange('reservada', 'secreta'), false);
    assert.equal(grauAbrange('ultrassecreta', 'ultrassecreta'), true);
  });
});

describe('validarClassificacaoSigilo (RN-40)', () => {
  it('reservada com data final dentro do prazo máximo: fundamento com o inciso do art. 23 e o grau', () => {
    const c = validarClassificacaoSigilo(lai(), HOJE);
    assert.equal(c.grau, 'reservada');
    assert.equal(c.prazoFim, '2028-11-01');
    assert.equal(c.prazoLimite, '2031-11-01');
    assert.equal(c.eventoFim, null);
    assert.match(c.fundamento, /art\. 23, VIII, e art\. 24, § 1º, III/);
    assert.match(c.fundamento, /Lei 14\.133\/2021, art\. 13/);
  });

  it('termo final por evento fica limitado ao prazo máximo do grau', () => {
    const c = validarClassificacaoSigilo(lai({ prazoFim: null, eventoFim: 'Conclusão da operação integrada de fronteira' }), HOJE);
    assert.equal(c.prazoFim, null);
    assert.equal(c.prazoLimite, '2031-11-01');
    assert.match(c.eventoFim ?? '', /operação integrada/);
  });

  it('recusa data além do prazo máximo, data passada, prazo e evento juntos, e razões curtas', () => {
    assert.throws(() => validarClassificacaoSigilo(lai({ prazoFim: '2031-11-02' }), HOJE), /prazo máximo/);
    assert.throws(() => validarClassificacaoSigilo(lai({ prazoFim: '2026-11-09' }), HOJE), /posterior a hoje/);
    assert.throws(() => validarClassificacaoSigilo(lai({ eventoFim: 'Fim da operação X' }), HOJE), /um dos dois/);
    assert.throws(() => validarClassificacaoSigilo(lai({ prazoFim: null, eventoFim: null }), HOJE), /um dos dois/);
    assert.throws(() => validarClassificacaoSigilo(lai({ razoes: 'curta demais' }), HOJE), comCodigo('SIGILO_INVALIDO'));
    assert.throws(() => validarClassificacaoSigilo(lai({ dataProducao: '2026-12-01' }), HOJE), /futura/);
  });

  it('informação produzida há mais tempo que o prazo máximo já é pública (art. 24, § 4º)', () => {
    assert.throws(() => validarClassificacaoSigilo(lai({ dataProducao: '2020-01-01', prazoFim: '2027-01-01' }), HOJE), /já terminou/);
  });

  it('autoridade sem competência para o grau, delegação sem ato e delegação no grau reservado são recusadas', () => {
    assert.throws(() => validarClassificacaoSigilo(lai({ grau: 'secreta' }), HOJE), /não tem competência para classificar no grau secreta/);
    assert.throws(
      () => validarClassificacaoSigilo(lai({ grau: 'secreta', autoridade: { nome: 'Agente Sintético', cargo: 'Coordenador', nivel: 'delegacao', atoDelegacao: null } }), HOJE),
      /ato de delegação/,
    );
    assert.throws(
      () => validarClassificacaoSigilo(lai({ autoridade: { nome: 'Agente Sintético', cargo: 'Coordenador', nivel: 'delegacao', atoDelegacao: 'Portaria 1/2026' } }), HOJE),
      /só para os graus ultrassecreto e secreto/,
    );
    const secreta = validarClassificacaoSigilo(
      lai({ grau: 'secreta', prazoFim: '2036-11-01', autoridade: { nome: 'Agente Sintético', cargo: 'Coordenador', nivel: 'delegacao', atoDelegacao: ' Portaria 1/2026 ' } }),
      HOJE,
    );
    assert.equal(secreta.autoridade?.atoDelegacao, 'Portaria 1/2026');
    assert.throws(() => validarClassificacaoSigilo(lai({ autoridade: null }), HOJE), /autoridade classificadora/);
  });

  it('orçamento (art. 24): exige a decisão no processo, recusa maior desconto e termina com os lances', () => {
    const base = lai({ tipo: 'orcamento', grau: null, hipotese: null, prazoFim: null, autoridade: null, orcamentoSigilosoNoProcesso: true });
    const c = validarClassificacaoSigilo(base, HOJE);
    assert.equal(c.tipo, 'orcamento');
    assert.equal(c.prazoLimite, null);
    assert.match(c.eventoFim ?? '', /fase de lances/);
    assert.match(c.fundamento, /art\. 24/);
    assert.throws(() => validarClassificacaoSigilo({ ...base, orcamentoSigilosoNoProcesso: false }, HOJE), comCodigo('SIGILO_ORCAMENTO_SEM_DECISAO'));
    assert.throws(() => validarClassificacaoSigilo({ ...base, criterioJulgamento: 'maior_desconto' }, HOJE), comCodigo('SIGILO_ORCAMENTO_MAIOR_DESCONTO'));
    assert.throws(() => validarClassificacaoSigilo({ ...base, grau: 'reservada' }, HOJE), /não tem grau/);
  });
});

describe('classificacaoVigente (LAI, art. 24, § 4º)', () => {
  it('vale até a data final, inclusive; depois é pública automaticamente', () => {
    const c = { situacao: 'vigente' as const, prazoFim: '2028-11-01', prazoLimite: '2031-11-01' };
    assert.equal(classificacaoVigente(c, '2028-11-01'), true);
    assert.equal(classificacaoVigente(c, '2028-11-02'), false);
    assert.equal(classificacaoVigente({ ...c, situacao: 'desclassificada' }, HOJE), false);
    assert.equal(classificacaoVigente({ situacao: 'vigente', prazoFim: null, prazoLimite: '2031-11-01' }, '2031-11-02'), false);
    assert.equal(classificacaoVigente({ situacao: 'vigente', prazoFim: null, prazoLimite: null }, '2099-01-01'), true);
  });
});

describe('situacaoOrcamentoSigiloso (art. 24)', () => {
  it('público, sigiloso até os lances e divulgado no primeiro marco', () => {
    assert.equal(situacaoOrcamentoSigiloso({ orcamentoSigiloso: false, faseLancesEncerradaEm: null, julgamentoConcluidoEm: null }).situacao, 'publico');
    const sigiloso = situacaoOrcamentoSigiloso({ orcamentoSigiloso: true, faseLancesEncerradaEm: null, julgamentoConcluidoEm: null });
    assert.equal(sigiloso.situacao, 'sigiloso');
    assert.equal(sigiloso.divulgavel, false);
    const divulgado = situacaoOrcamentoSigiloso({ orcamentoSigiloso: true, faseLancesEncerradaEm: '2026-11-10T15:00:00.000Z', julgamentoConcluidoEm: '2026-11-05T10:00:00.000Z' });
    assert.equal(divulgado.situacao, 'divulgado');
    assert.equal(divulgado.divulgavel, true);
    assert.equal(divulgado.divulgadoEm, '2026-11-05T10:00:00.000Z');
  });
});

describe('decidirAcessoSigilo (RN-40; Decreto 7.845/2012, arts. 18 e 38, § 4º)', () => {
  const reservada = { tipo: 'lai' as const, grau: 'reservada' as const, vigente: true };
  const secreta = { tipo: 'lai' as const, grau: 'secreta' as const, vigente: true };
  const base = { orcamentoDivulgado: false, orgaoControle: false, credencial: null, hoje: HOJE };

  it('sem classificação vigente: acesso comum, sem registro', () => {
    const d = decidirAcessoSigilo({ ...base, classificacao: null });
    assert.deepEqual([d.permitido, d.base, d.registrar], [true, 'sem_sigilo', false]);
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: { ...reservada, vigente: false } }).base, 'sem_sigilo');
  });

  it('órgão de controle: acesso irrestrito e registrado (art. 24, I; art. 169, § 2º)', () => {
    const d = decidirAcessoSigilo({ ...base, classificacao: secreta, orgaoControle: true });
    assert.deepEqual([d.permitido, d.base, d.registrar], [true, 'controle', true]);
    assert.match(d.fundamento, /art\. 169, § 2º/);
  });

  it('sem credencial, credencial revogada, vencida ou de grau inferior: negado e registrado', () => {
    const semCredencial = decidirAcessoSigilo({ ...base, classificacao: reservada });
    assert.deepEqual([semCredencial.permitido, semCredencial.base, semCredencial.registrar], [false, 'negado_sem_credencial', true]);
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: reservada, credencial: { grauMaximo: 'secreta', validaAte: null, ativa: false } }).base, 'negado_sem_credencial');
    assert.equal(
      decidirAcessoSigilo({ ...base, classificacao: reservada, credencial: { grauMaximo: 'secreta', validaAte: '2026-11-08', ativa: true } }).base,
      'negado_credencial_vencida',
    );
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: secreta, credencial: { grauMaximo: 'reservada', validaAte: null, ativa: true } }).base, 'negado_grau_insuficiente');
  });

  it('credencial ativa, no prazo e de grau suficiente: permitido e registrado', () => {
    const d = decidirAcessoSigilo({ ...base, classificacao: reservada, credencial: { grauMaximo: 'secreta', validaAte: HOJE, ativa: true } });
    assert.deepEqual([d.permitido, d.base, d.registrar], [true, 'credencial', true]);
  });

  it('orçamento sigiloso: divulgado após os lances é público; antes, exige credencial', () => {
    const orcamento = { tipo: 'orcamento' as const, grau: null, vigente: true };
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: orcamento }).permitido, false);
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: orcamento, orcamentoDivulgado: true }).base, 'orcamento_divulgado');
    assert.equal(decidirAcessoSigilo({ ...base, classificacao: orcamento, credencial: { grauMaximo: 'reservada', validaAte: null, ativa: true } }).base, 'credencial');
  });
});

describe('marcacaoSigilo (Decreto 7.845/2012, art. 23) e código de indexação', () => {
  it('cabeçalho com o grau e o art. 13; rodapé com o fundamento e o termo final', () => {
    const m = marcacaoSigilo({ tipo: 'lai', grau: 'reservada', prazoFim: '2028-11-01', eventoFim: null, prazoLimite: '2031-11-01' });
    assert.match(m.cabecalho, /^RESERVADO — INFORMAÇÃO CLASSIFICADA \(Lei 14\.133\/2021, art\. 13\)$/);
    assert.match(m.rodape, /art\. 24, § 1º, III; restrição de acesso até 01\/11\/2028/);
    const evento = marcacaoSigilo({ tipo: 'lai', grau: 'secreta', prazoFim: null, eventoFim: 'Conclusão da operação integrada', prazoLimite: '2041-11-01' });
    assert.match(evento.rodape, /^SECRETO/);
    assert.match(evento.rodape, /no máximo até 01\/11\/2041/);
    assert.match(marcacaoSigilo({ tipo: 'orcamento', grau: null, prazoFim: null, eventoFim: null, prazoLimite: null }).cabecalho, /ORÇAMENTO ESTIMADO/);
  });

  it('código de indexação simplificado', () => {
    assert.equal(
      codigoIndexacaoSigilo({ numeroSei: '08000.014503/2026-11', tipo: 'lai', grau: 'reservada', classificadaEm: '2026-11-09', prazoFim: '2028-11-01' }),
      '08000.014503/2026-11.R.20261109.20281101',
    );
    assert.equal(codigoIndexacaoSigilo({ numeroSei: '08000.014503/2026-11', tipo: 'orcamento', grau: null, classificadaEm: '2026-11-09', prazoFim: null }), '08000.014503/2026-11.O.20261109.EVENTO');
  });
});

describe('ancoragem da trilha (RNF-09)', () => {
  const hash = 'a'.repeat(64);

  it('declaração liga a sequência ao hash; entradas inválidas são recusadas', () => {
    assert.equal(declaracaoAncoragem(42, hash), `agora:trilha-auditoria:v1:42:${hash}`);
    assert.throws(() => declaracaoAncoragem(0, hash), comCodigo('ANCORAGEM_INVALIDA'));
    assert.throws(() => declaracaoAncoragem(1, 'XYZ'), comCodigo('ANCORAGEM_INVALIDA'));
  });

  it('devida na primeira vez e depois do intervalo, só com eventos novos', () => {
    const agora = '2026-11-09T12:00:00.000Z';
    assert.equal(ancoragemDevida({ ultimaAncoradaEm: null, ultimaSequencia: null, sequenciaAtual: 10, agora, intervaloHoras: 24 }).devida, true);
    assert.equal(ancoragemDevida({ ultimaAncoradaEm: '2026-11-09T00:00:00.000Z', ultimaSequencia: 5, sequenciaAtual: 10, agora, intervaloHoras: 24 }).devida, false);
    assert.equal(ancoragemDevida({ ultimaAncoradaEm: '2026-11-08T11:00:00.000Z', ultimaSequencia: 5, sequenciaAtual: 10, agora, intervaloHoras: 24 }).devida, true);
    assert.equal(ancoragemDevida({ ultimaAncoradaEm: '2026-11-01T00:00:00.000Z', ultimaSequencia: 10, sequenciaAtual: 10, agora, intervaloHoras: 24 }).devida, false);
    assert.throws(() => ancoragemDevida({ ultimaAncoradaEm: null, ultimaSequencia: null, sequenciaAtual: 1, agora, intervaloHoras: 0 }), comCodigo('ANCORAGEM_INVALIDA'));
  });

  it('conferência: íntegra, hash alterado, carimbo de outra declaração e prova local inválida', () => {
    const base = {
      modo: 'rfc3161' as const,
      hashRegistrado: hash,
      hashCadeia: hash,
      cadeiaIntegra: true,
      impressaoEsperada: 'b'.repeat(64),
      carimbo: { impressao: 'b'.repeat(64), assinaturaValida: true, certificadoConfiavel: true, carimboEm: '2026-11-09T12:00:05.000Z' },
      provaLocalValida: null,
      ancoradaEm: '2026-11-09T12:00:00.000Z',
    };
    assert.deepEqual(conferirAncoragem(base), { situacao: 'integra', problemas: [], avisos: [] });
    assert.equal(conferirAncoragem({ ...base, hashCadeia: 'c'.repeat(64) }).situacao, 'divergente');
    assert.match(conferirAncoragem({ ...base, carimbo: { ...base.carimbo, impressao: 'd'.repeat(64) } }).problemas.join(' '), /não corresponde/);
    assert.match(conferirAncoragem({ ...base, carimbo: { ...base.carimbo, assinaturaValida: false } }).problemas.join(' '), /assinatura/);
    assert.equal(conferirAncoragem({ ...base, carimbo: { ...base.carimbo, certificadoConfiavel: null } }).avisos.length, 1);
    const local = conferirAncoragem({ ...base, modo: 'local', carimbo: null, provaLocalValida: true });
    assert.equal(local.situacao, 'integra');
    assert.match(local.avisos.join(' '), /modo offline/);
    assert.equal(conferirAncoragem({ ...base, modo: 'local', carimbo: null, provaLocalValida: false }).situacao, 'divergente');
  });
});

describe('catálogo — frente R (RN-40, RF-33 e RNF-09)', () => {
  const regra = (id: string) => {
    const r = CATALOGO_REGRAS.find((x) => x.id === id);
    assert.ok(r, id);
    return r;
  };

  it('as três regras citam a base legal e aparecem na tela de sigilo', () => {
    assert.match(regra('RN-40').fundamento, /arts\. 13, 18, § 1º, VI, 24, 91, § 1º, e 169, § 2º/);
    assert.match(regra('RN-40').fundamento, /Lei 12\.527\/2011, arts\. 23 a 27/);
    assert.match(regra('RN-40').fundamento, /Decreto 7\.845\/2012/);
    assert.match(regra('RNF-09').fundamento, /RFC 3161/);
    assert.ok(regra('RN-40').implementacao.includes('decidirAcessoSigilo'));
    assert.ok(regra('RNF-09').implementacao.includes('conferirAncoragem'));
    assert.deepEqual(regrasPorTela('jornada.sigilo').map((r) => r.id).sort(), ['RF-33', 'RN-40', 'RNF-09']);
    assert.ok(regra('RNF-09').telas.includes('auditoria'));
  });
});
