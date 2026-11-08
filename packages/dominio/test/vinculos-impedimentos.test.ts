import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_REGRAS,
  ErroDominio,
  avancarExtensaoSancao,
  detectarPossivelSucessao,
  efeitosExtensaoSancao,
  exigenciasDoPapel,
  mesmaPessoaQsa,
  normalizarEndereco,
  proporExtensaoSancao,
  sinalizarVinculosLicitantes,
  validarDeclaracaoAgente,
  validarVinculoInformado,
  verificarDeclaracaoAgente,
  verificarDeclaracoesEquipe,
  type DeclaracaoAgente,
  type FornecedorParaVinculos,
  type VinculoInformado,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

// Dados 100% sintéticos (CPFs inventados).
const SOCIO_COMUM = { documento: '11122233344', nome: 'Otávio Brandão Lins', qualificacao: 'socio_administrador' as const };

function fornecedor(id: string, nome: string, extra: Partial<FornecedorParaVinculos> = {}): FornecedorParaVinculos {
  return { id, nome, dataAbertura: '2015-03-10', endereco: null, telefone: null, email: null, quadro: [], ...extra };
}

const alfa = fornecedor('a', 'Alfa Equipamentos Ltda.', {
  quadro: [SOCIO_COMUM, { documento: '55566677788', nome: 'Rita Moura Sales', qualificacao: 'socio' }],
  endereco: 'R. das Acácias, nº 120, Sala 3 — Centro',
  telefone: '(61) 3333-4444',
});
// Mesma pessoa vinda dos dados abertos: CPF parcial (6 dígitos centrais) e nome sem acento.
const beta = fornecedor('b', 'Beta Táticos Ltda.', {
  quadro: [{ documento: '***222333**', nome: 'OTAVIO BRANDAO LINS', qualificacao: 'administrador' }],
  endereco: 'Rua das Acacias 120 sala 3 centro',
  telefone: '+55 61 3333-4444',
});
const gama = fornecedor('c', 'Gama Proteção Ltda.', { quadro: [{ documento: '99988877766', nome: 'Caio Ferraz Dutra', qualificacao: 'socio' }] });
const delta = fornecedor('d', 'Delta Uniformes Ltda.', { quadro: [{ documento: '12312312312', nome: 'Lúcia Prado Neves', qualificacao: 'socio_administrador' }] });

const parentesco: VinculoInformado = {
  id: 'v1',
  natureza: 'parentesco',
  grauParentesco: 2,
  fornecedorId: 'c',
  outroFornecedorId: 'd',
  agente: null,
  fonte: 'informado_agente',
  evidencia: 'Certidões de nascimento juntadas ao processo SEI 08000.000001/2026-01.',
  descricao: 'Os sócios-administradores são irmãos.',
};

describe('sinalizarVinculosLicitantes (RIA-06 e RIA-10)', () => {
  it('quatro licitantes, dois com parentesco informado: sinal de risco com a evidência e revisão humana', () => {
    const r = sinalizarVinculosLicitantes({ licitantes: [gama, delta, fornecedor('e', 'Épsilon Ltda.'), fornecedor('f', 'Zeta Ltda.')], vinculosInformados: [parentesco] });
    assert.equal(r.sinais.length, 1);
    const s = r.sinais[0];
    assert.ok(s);
    assert.equal(s.regra, 'RIA-10');
    assert.equal(s.tipo, 'vinculo_informado');
    assert.equal(s.nivel, 'risco');
    assert.deepEqual(s.fornecedores.map((f) => f.id).sort(), ['c', 'd']);
    assert.match(s.mensagem, /parentesco de 2º grau/);
    assert.match(s.evidencias[0]?.descricao ?? '', /Certidões de nascimento/);
    assert.equal(s.requerRevisaoHumana, true);
    assert.deepEqual(r.grupos.map((g) => g.fornecedores.map((f) => f.id).sort()), [['c', 'd']]);
    assert.match(r.aviso, /não constituem acusação/);
    assert.ok(r.premissas.some((p) => /endereço IP/.test(p)));
  });

  it('administrador em comum pelo CPF parcial dos dados abertos (RIA-06), com nome mascarado; endereço e telefone em comum (RIA-10)', () => {
    const r = sinalizarVinculosLicitantes({ licitantes: [alfa, beta, gama], vinculosInformados: [] });
    const tipos = r.sinais.map((s) => `${s.regra}:${s.tipo}`);
    assert.deepEqual(tipos, ['RIA-06:administrador_comum', 'RIA-10:endereco_comum', 'RIA-10:contato_comum']);
    const adm = r.sinais[0];
    assert.ok(adm);
    assert.match(adm.mensagem, /Otávio B\. L\./);
    assert.match(adm.mensagem, /\*\*\*\.222\.333-\*\*/);
    assert.doesNotMatch(JSON.stringify(r), /Brandão Lins|11122233344/);
    assert.match(r.sinais[2]?.evidencias[0]?.descricao ?? '', /\(61\) \*+-4444/);
  });

  it('agente da equipe no quadro societário (RIA-06) e vínculo informado com agente (RIA-10, art. 14, IV)', () => {
    const agentes = [
      { usuarioId: 'u1', nome: 'Servidora Um', cpf: '555.666.777-88' },
      { usuarioId: 'u2', nome: 'Servidor Dois', cpf: '00011122233' },
    ];
    const comAgente: VinculoInformado = { ...parentesco, id: 'v2', fornecedorId: 'c', outroFornecedorId: null, agente: { usuarioId: 'u2', nome: 'Servidor Dois' }, grauParentesco: 3 };
    const foraDaEquipe: VinculoInformado = { ...comAgente, id: 'v3', natureza: 'comercial', grauParentesco: null, agente: { usuarioId: 'u9', nome: 'Dirigente Nove' } };
    const r = sinalizarVinculosLicitantes({ licitantes: [alfa, gama], vinculosInformados: [comAgente, foraDaEquipe], agentes });
    const doQuadro = r.sinais.find((s) => s.regra === 'RIA-06' && s.tipo === 'agente_publico');
    assert.ok(doQuadro, 'CPF da servidora no quadro de Alfa');
    assert.equal(doQuadro.agente?.usuarioId, 'u1');
    assert.match(doQuadro.fundamento, /art\. 14, IV/);
    const informado = r.sinais.find((s) => s.regra === 'RIA-10' && s.agente?.usuarioId === 'u2');
    assert.ok(informado);
    assert.equal(informado.nivel, 'risco');
    assert.match(informado.mensagem, /Possível vínculo impeditivo/);
    const fora = r.sinais.find((s) => s.agente?.usuarioId === 'u9');
    assert.equal(fora?.nivel, 'atencao');
    assert.match(fora?.mensagem ?? '', /dirigente/);
  });

  it('sem vínculo, sem sinal; vínculo com fornecedor fora da análise é ignorado', () => {
    assert.deepEqual(sinalizarVinculosLicitantes({ licitantes: [gama, fornecedor('e', 'Épsilon Ltda.')], vinculosInformados: [parentesco] }).sinais, []);
  });

  it('entrada inválida → VINCULOS_INVALIDOS', () => {
    assert.throws(() => sinalizarVinculosLicitantes({ licitantes: [gama, gama], vinculosInformados: [] }), comCodigo('VINCULOS_INVALIDOS'));
  });

  it('mesmaPessoaQsa: CPF completo e CPF parcial dos dados abertos, com o mesmo nome', () => {
    assert.equal(mesmaPessoaQsa({ documento: '11122233344', nome: 'Otávio Brandão Lins' }, { documento: '***222333**', nome: 'OTAVIO BRANDAO LINS' }), true);
    assert.equal(mesmaPessoaQsa({ documento: '11122233344', nome: 'Otávio Brandão Lins' }, { documento: '***222333**', nome: 'Outra Pessoa' }), false);
    assert.equal(mesmaPessoaQsa({ documento: '', nome: 'Otávio' }, { documento: '', nome: 'Otávio' }), false, 'sem documento não compara');
  });

  it('normalizarEndereco ignora acentos, pontuação e abreviações; endereço curto não é comparado', () => {
    assert.equal(normalizarEndereco('Av. Brasil, nº 10'), normalizarEndereco('avenida brasil 10'));
    assert.equal(normalizarEndereco('Rua A'), null);
  });

  it('validarVinculoInformado: grau só para parentesco, uma contraparte e evidência', () => {
    const base = { ...parentesco, agenteId: null };
    assert.doesNotThrow(() => validarVinculoInformado(base));
    assert.throws(() => validarVinculoInformado({ ...base, grauParentesco: null }), comCodigo('VINCULO_INVALIDO'));
    assert.throws(() => validarVinculoInformado({ ...base, natureza: 'comercial' }), comCodigo('VINCULO_INVALIDO'));
    assert.throws(() => validarVinculoInformado({ ...base, agenteId: 'u1' }), comCodigo('VINCULO_INVALIDO'));
    assert.throws(() => validarVinculoInformado({ ...base, outroFornecedorId: 'c' }), comCodigo('VINCULO_INVALIDO'));
    assert.throws(() => validarVinculoInformado({ ...base, evidencia: 'curta' }), comCodigo('VINCULO_INVALIDO'));
  });
});

describe('detectarPossivelSucessao (RIA-10, art. 14, § 1º, e art. 160)', () => {
  const punida = fornecedor('p', 'Punida Rádios Ltda.', {
    quadro: [SOCIO_COMUM],
    endereco: 'Travessa do Comércio, 45, Galpão 2',
    dataAbertura: '2012-01-01',
  });
  const sancao = { id: 's1', tipo: 'impedimento_licitar' as const, situacao: 'aplicada' as const, instauradaEm: '2026-03-01', fimVigencia: '2028-05-01' };
  const nova = fornecedor('n', 'Nova Rádios Ltda.', {
    quadro: [{ ...SOCIO_COMUM, documento: '***222333**', qualificacao: 'socio' }],
    endereco: 'Tv. do Comercio 45 Galpao 2',
    dataAbertura: '2026-04-15',
  });

  it('empresa aberta depois da instauração, com sócio e endereço da punida → risco, com a sanção de origem', () => {
    const r = detectarPossivelSucessao({ candidatos: [nova, gama], sancionadas: [{ fornecedor: punida, sancao }], hoje: '2026-11-09' });
    assert.equal(r.sinais.length, 1);
    const s = r.sinais[0];
    assert.ok(s);
    assert.equal(s.tipo, 'possivel_sucessao');
    assert.equal(s.nivel, 'risco');
    assert.equal(s.sancaoOrigemId, 's1');
    assert.deepEqual(s.fornecedores.map((f) => f.id), ['n', 'p']);
    assert.match(s.mensagem, /administrador e endereço em comum/);
    assert.match(s.mensagem, /art\. 160/);
    assert.equal(s.evidencias.length, 3);
    assert.match(s.fundamento, /art\. 14, III e § 1º/);
  });

  it('empresa antiga → atenção; sanção encerrada, não impeditiva ou não aplicada → sem sinal', () => {
    const antiga = { ...nova, dataAbertura: '2018-01-01' };
    assert.equal(detectarPossivelSucessao({ candidatos: [antiga], sancionadas: [{ fornecedor: punida, sancao }], hoje: '2026-11-09' }).sinais[0]?.nivel, 'atencao');
    for (const outra of [{ ...sancao, fimVigencia: '2026-01-01' }, { ...sancao, tipo: 'multa' as const }, { ...sancao, situacao: 'defesa' as const }]) {
      assert.deepEqual(detectarPossivelSucessao({ candidatos: [nova], sancionadas: [{ fornecedor: punida, sancao: outra }], hoje: '2026-11-09' }).sinais, []);
    }
  });

  it('janela de meses antes da instauração é parâmetro (padrão 12)', () => {
    const abertaAntes = { ...nova, dataAbertura: '2025-06-01' };
    assert.equal(detectarPossivelSucessao({ candidatos: [abertaAntes], sancionadas: [{ fornecedor: punida, sancao }], hoje: '2026-11-09' }).sinais[0]?.nivel, 'risco');
    assert.equal(
      detectarPossivelSucessao({ candidatos: [abertaAntes], sancionadas: [{ fornecedor: punida, sancao }], hoje: '2026-11-09', mesesAntes: 3 }).sinais[0]?.nivel,
      'atencao',
    );
    assert.throws(() => detectarPossivelSucessao({ candidatos: [], sancionadas: [], hoje: '2026-11-09', mesesAntes: -1 }), comCodigo('VINCULOS_INVALIDOS'));
  });
});

describe('extensão de sanção (RN-27, art. 160)', () => {
  const origem = { tipo: 'impedimento_licitar' as const, situacao: 'aplicada' as const, inicioVigencia: '2026-05-01', fimVigencia: '2028-05-01' };
  const fundamentacao = 'Empresa aberta logo após a sanção, com o mesmo sócio-administrador e o mesmo endereço da punida.';

  it('proposta: contraditório com prazo de 15 dias úteis a partir da intimação', () => {
    const r = proporExtensaoSancao({ sancaoOrigem: origem, alvo: 'sucessora', fundamentacao, intimacaoEm: '2026-11-09', hoje: '2026-11-09' });
    assert.equal(r.situacao, 'contraditorio');
    assert.equal(r.prazoDefesa, '2026-12-01');
    assert.match(r.fundamento, /art\. 160/);
    assert.match(r.aviso, /não estende nada por si/);
  });

  it('origem não impeditiva, não aplicada ou encerrada; fundamentação curta; intimação futura → EXTENSAO_SANCAO_INVALIDA', () => {
    const base = { sancaoOrigem: origem, alvo: 'sucessora' as const, fundamentacao, intimacaoEm: '2026-11-09', hoje: '2026-11-09' };
    for (const e of [
      { ...base, sancaoOrigem: { ...origem, tipo: 'multa' as const } },
      { ...base, sancaoOrigem: { ...origem, situacao: 'defesa' as const } },
      { ...base, sancaoOrigem: { ...origem, fimVigencia: '2026-01-01' } },
      { ...base, fundamentacao: 'curta' },
      { ...base, intimacaoEm: '2026-11-10' },
    ]) {
      assert.throws(() => proporExtensaoSancao(e), comCodigo('EXTENSAO_SANCAO_INVALIDA'));
    }
  });

  it('rito: defesa → parecer jurídico → decisão, com segregação de funções', () => {
    const comum = { hoje: '2026-11-20', prazoDefesa: '2026-12-01', propostoPorId: 'gestor', pareceristaId: null };
    assert.throws(() => avancarExtensaoSancao({ ...comum, situacao: 'contraditorio', acao: 'registrar_defesa', autorId: 'gestor', defesaApresentada: false }), comCodigo('EXTENSAO_TRANSICAO_INVALIDA'));
    assert.equal(avancarExtensaoSancao({ ...comum, situacao: 'contraditorio', acao: 'registrar_defesa', autorId: 'gestor', defesaApresentada: true }).situacao, 'analise_juridica');
    assert.equal(
      avancarExtensaoSancao({ ...comum, hoje: '2026-12-02', situacao: 'contraditorio', acao: 'registrar_defesa', autorId: 'gestor', defesaApresentada: false }).situacao,
      'analise_juridica',
      'revelia depois do prazo',
    );
    assert.throws(() => avancarExtensaoSancao({ ...comum, situacao: 'analise_juridica', acao: 'registrar_parecer', autorId: 'gestor' }), comCodigo('EXTENSAO_SEGREGACAO'));
    assert.equal(avancarExtensaoSancao({ ...comum, situacao: 'analise_juridica', acao: 'registrar_parecer', autorId: 'juridico' }).situacao, 'decisao');
    assert.throws(() => avancarExtensaoSancao({ ...comum, situacao: 'contraditorio', acao: 'decidir', autorId: 'autoridade', decisao: 'estender' }), comCodigo('EXTENSAO_TRANSICAO_INVALIDA'));
    const decisao = { ...comum, situacao: 'decisao' as const, acao: 'decidir' as const, pareceristaId: 'juridico' };
    assert.throws(() => avancarExtensaoSancao({ ...decisao, autorId: 'juridico', decisao: 'estender' }), comCodigo('EXTENSAO_SEGREGACAO'));
    assert.throws(() => avancarExtensaoSancao({ ...decisao, autorId: 'gestor', decisao: 'estender' }), comCodigo('EXTENSAO_SEGREGACAO'));
    assert.equal(avancarExtensaoSancao({ ...decisao, autorId: 'autoridade', decisao: 'estender' }).situacao, 'estendida');
    assert.equal(avancarExtensaoSancao({ ...decisao, autorId: 'autoridade', decisao: 'nao_estender' }).situacao, 'nao_estendida');
    assert.equal(avancarExtensaoSancao({ ...comum, situacao: 'decisao', acao: 'arquivar', autorId: 'gestor' }).situacao, 'arquivada');
    assert.throws(() => avancarExtensaoSancao({ ...comum, situacao: 'estendida', acao: 'arquivar', autorId: 'gestor' }), comCodigo('EXTENSAO_TRANSICAO_INVALIDA'));
  });

  it('efeitos: mesma sanção, da decisão até o fim da vigência de origem', () => {
    assert.deepEqual(efeitosExtensaoSancao(origem, '2026-12-10'), {
      tipo: 'impedimento_licitar',
      inicioVigencia: '2026-12-10',
      fimVigencia: '2028-05-01',
      fundamento: 'Lei 14.133/2021, art. 160',
    });
    assert.throws(() => efeitosExtensaoSancao(origem, '2028-05-02'), comCodigo('EXTENSAO_SANCAO_INVALIDA'));
  });
});

describe('declaração dos agentes designados (RN-28, arts. 7º, 8º e 9º)', () => {
  const valida: DeclaracaoAgente = {
    declaradaEm: '2026-10-01',
    semParentescoOuVinculo: true,
    semConflitoInteresses: true,
    vinculo: 'servidor_efetivo',
    capacitacao: 'certificacao_escola_governo',
    capacitacaoDescricao: 'Curso de agente de contratação — escola de governo, 2025',
  };

  it('exigências por papel: agente de contratação e pregoeiro exigem vínculo efetivo; parecerista segue o art. 7º, § 2º', () => {
    assert.equal(exigenciasDoPapel('agente_contratacao').vinculoEfetivo, 'obrigatorio');
    assert.equal(exigenciasDoPapel('pregoeiro').vinculoEfetivo, 'obrigatorio');
    assert.equal(exigenciasDoPapel('fiscal_tecnico').vinculoEfetivo, 'preferencial');
    assert.ok(exigenciasDoPapel('parecerista_juridico').capacitacao);
    assert.equal(exigenciasDoPapel('autoridade_competente').capacitacao, false);
  });

  it('sem declaração → não apto; declaração válida → apto até 12 meses depois', () => {
    const sem = verificarDeclaracaoAgente({ papel: 'equipe_planejamento', declaracao: null, hoje: '2026-11-09' });
    assert.equal(sem.apto, false);
    assert.match(sem.pendencias[0] ?? '', /só atua no processo depois de declarar/);
    const com = verificarDeclaracaoAgente({ papel: 'agente_contratacao', declaracao: valida, hoje: '2026-11-09' });
    assert.deepEqual({ apto: com.apto, validaAte: com.validaAte, pendencias: com.pendencias }, { apto: true, validaAte: '2027-10-01', pendencias: [] });
  });

  it('vencida, impedimento declarado, sem capacitação ou sem vínculo efetivo no papel obrigatório → pendências', () => {
    assert.match(verificarDeclaracaoAgente({ papel: 'fiscal_tecnico', declaracao: valida, hoje: '2027-10-02' }).pendencias[0] ?? '', /venceu/);
    assert.match(
      verificarDeclaracaoAgente({ papel: 'fiscal_tecnico', declaracao: { ...valida, semParentescoOuVinculo: false }, hoje: '2026-11-09' }).pendencias[0] ?? '',
      /art\. 7º, III/,
    );
    assert.match(
      verificarDeclaracaoAgente({ papel: 'fiscal_tecnico', declaracao: { ...valida, capacitacao: 'nenhuma' }, hoje: '2026-11-09' }).pendencias[0] ?? '',
      /art\. 7º, II/,
    );
    const comissionado = { ...valida, vinculo: 'cargo_comissao' as const };
    assert.match(verificarDeclaracaoAgente({ papel: 'pregoeiro', declaracao: comissionado, hoje: '2026-11-09' }).pendencias[0] ?? '', /art\. 8º/);
    const fiscal = verificarDeclaracaoAgente({ papel: 'fiscal_tecnico', declaracao: comissionado, hoje: '2026-11-09' });
    assert.equal(fiscal.apto, true, 'no art. 7º, I, o vínculo efetivo é preferencial');
    assert.match(fiscal.sinais[0] ?? '', /preferencialmente|prefere/);
    assert.equal(verificarDeclaracaoAgente({ papel: 'autoridade_competente', declaracao: { ...valida, capacitacao: 'nenhuma', capacitacaoDescricao: null }, hoje: '2026-11-09' }).apto, true);
  });

  it('verificarDeclaracoesEquipe junta as pendências por designação, com o nome do agente', () => {
    const r = verificarDeclaracoesEquipe(
      [
        { papel: 'equipe_planejamento', servidorId: 'u1', nome: 'Ana', declaracao: valida },
        { papel: 'fiscal_tecnico', servidorId: 'u2', nome: 'Bruno', declaracao: null },
      ],
      '2026-11-09',
    );
    assert.equal(r.valido, false);
    assert.equal(r.pendencias.length, 1);
    assert.equal(r.pendencias[0]?.servidorId, 'u2');
    assert.match(r.pendencias[0]?.mensagem ?? '', /^Bruno: /);
  });

  it('validarDeclaracaoAgente exige descrição da capacitação informada', () => {
    assert.throws(() => validarDeclaracaoAgente({ ...valida, capacitacaoDescricao: 'curta' }), comCodigo('DECLARACAO_INVALIDA'));
    assert.doesNotThrow(() => validarDeclaracaoAgente({ ...valida, capacitacao: 'nenhuma', capacitacaoDescricao: null }));
  });
});

describe('catálogo: RIA-10, RN-27 e RN-28', () => {
  const porId = new Map(CATALOGO_REGRAS.map((r) => [r.id, r]));
  it('regras presentes com fundamento e implementação', () => {
    assert.match(porId.get('RIA-10')?.fundamento ?? '', /art\. 14, III, IV, V e § 1º/);
    assert.ok(porId.get('RIA-10')?.implementacao.includes('detectarPossivelSucessao'));
    assert.match(porId.get('RN-27')?.fundamento ?? '', /art\. 160/);
    assert.equal(porId.get('RN-28')?.etapa, 2);
    assert.ok(porId.get('RN-28')?.telas.includes('jornada.equipe'));
  });
});
