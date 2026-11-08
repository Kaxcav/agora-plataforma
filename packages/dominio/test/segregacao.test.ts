import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, PARES_CONFLITANTES, verificarSegregacao, type Designacao, type PapelProcesso } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const conflitam = (a: PapelProcesso, b: PapelProcesso) => PARES_CONFLITANTES.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
const d = (papel: PapelProcesso, servidorId: string, cpf?: string): Designacao => ({ papel, servidorId, nome: `Servidor ${servidorId}`, ...(cpf !== undefined ? { cpf } : {}) });

describe('PARES_CONFLITANTES', () => {
  it('contém os pares mínimos da especificação', () => {
    const minimos: [PapelProcesso, PapelProcesso][] = [
      ['equipe_planejamento', 'agente_contratacao'],
      ['equipe_planejamento', 'pregoeiro'],
      ['agente_contratacao', 'fiscal_tecnico'],
      ['agente_contratacao', 'fiscal_administrativo'],
      ['pregoeiro', 'fiscal_tecnico'],
      ['agente_contratacao', 'autoridade_competente'],
      ['pregoeiro', 'autoridade_competente'],
      ['gestor_contrato', 'fiscal_tecnico'],
      ['comissao_contratacao', 'fiscal_tecnico'],
    ];
    for (const [a, b] of minimos) assert.ok(conflitam(a, b), `${a} × ${b}`);
  });

  it('parecerista jurídico conflita com todos os outros papéis', () => {
    const outros: PapelProcesso[] = [
      'requisitante', 'equipe_planejamento', 'agente_contratacao', 'pregoeiro', 'comissao_contratacao',
      'autoridade_competente', 'gestor_contrato', 'fiscal_tecnico', 'fiscal_administrativo',
    ];
    for (const p of outros) assert.ok(conflitam('parecerista_juridico', p), p);
  });

  it('todo par tem motivo e não há par repetido', () => {
    const chaves = PARES_CONFLITANTES.map((p) => [p.a, p.b].sort().join('|'));
    assert.equal(new Set(chaves).size, chaves.length);
    assert.ok(PARES_CONFLITANTES.every((p) => p.motivo.length > 20 && p.a !== p.b));
  });

  it('requisitante pode integrar a equipe de planejamento', () => {
    assert.equal(conflitam('requisitante', 'equipe_planejamento'), false);
  });
});

describe('verificarSegregacao', () => {
  it('equipe com servidores distintos é válida', () => {
    const r = verificarSegregacao([d('equipe_planejamento', '1'), d('agente_contratacao', '2'), d('autoridade_competente', '3'), d('fiscal_tecnico', '4')]);
    assert.deepEqual(r, { valido: true, conflitos: [] });
  });

  it('acúmulo de planejamento e condução da seleção é conflito (art. 7º, § 1º)', () => {
    const r = verificarSegregacao([d('equipe_planejamento', '1'), d('agente_contratacao', '1'), d('autoridade_competente', '2')]);
    assert.equal(r.valido, false);
    assert.equal(r.conflitos.length, 1);
    const c = r.conflitos[0];
    assert.equal(c?.tipo, 'acumulo_funcoes');
    assert.equal(c?.servidorId, '1');
    assert.deepEqual(c?.papeis, ['equipe_planejamento', 'agente_contratacao']);
    assert.equal(c?.fundamento, 'Lei 14.133/2021, art. 7º, § 1º');
    assert.match(c?.descricao ?? '', /equipe de planejamento e agente de contratação/);
  });

  it('acúmulo permitido não gera conflito', () => {
    assert.equal(verificarSegregacao([d('requisitante', '1'), d('equipe_planejamento', '1')]).valido, true);
  });

  it('gera um conflito por par conflitante', () => {
    const r = verificarSegregacao([d('pregoeiro', '1'), d('fiscal_tecnico', '1'), d('autoridade_competente', '1')]);
    assert.equal(r.conflitos.length, 2);
  });

  it('parecerista jurídico em outra função é conflito', () => {
    const r = verificarSegregacao([d('parecerista_juridico', '9'), d('requisitante', '9')]);
    assert.equal(r.conflitos[0]?.tipo, 'acumulo_funcoes');
  });

  it('designação repetida do mesmo papel não é conflito', () => {
    assert.equal(verificarSegregacao([d('fiscal_tecnico', '1'), d('fiscal_tecnico', '1')]).valido, true);
  });

  it('vínculo societário: CPF do designado entre os sócios do fornecedor (só dígitos)', () => {
    const r = verificarSegregacao([d('fiscal_tecnico', '5', '529.982.247-25'), d('gestor_contrato', '6', '123.456.789-09')], {
      sociosFornecedores: [{ cnpj: '11222333000181', razaoSocial: 'Fornecedora Exemplo Ltda', cpfsSocios: ['52998224725'] }],
    });
    assert.equal(r.valido, false);
    assert.equal(r.conflitos.length, 1);
    const c = r.conflitos[0];
    assert.equal(c?.tipo, 'vinculo_societario');
    assert.equal(c?.servidorId, '5');
    assert.deepEqual(c?.papeis, ['fiscal_tecnico']);
    assert.equal(c?.fundamento, 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV');
    assert.match(c?.descricao ?? '', /não constitui acusação/);
    assert.match(c?.descricao ?? '', /11\.222\.333\/0001-81/);
    assert.doesNotMatch(c?.descricao ?? '', /529\.982|52998224725/);
  });

  it('sem CPF informado não há verificação de vínculo', () => {
    const r = verificarSegregacao([d('fiscal_tecnico', '5')], {
      sociosFornecedores: [{ cnpj: '11222333000181', razaoSocial: 'X', cpfsSocios: ['52998224725'] }],
    });
    assert.equal(r.valido, true);
  });

  it('rejeita papel inválido e designação sem servidor', () => {
    assert.throws(() => verificarSegregacao([d('diretor' as unknown as PapelProcesso, '1')]), comCodigo('SEGREGACAO_INVALIDA'));
    assert.throws(() => verificarSegregacao([d('requisitante', '')]), comCodigo('SEGREGACAO_INVALIDA'));
  });
});
