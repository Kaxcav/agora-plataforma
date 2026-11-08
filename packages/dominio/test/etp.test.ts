import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ErroDominio, INCISOS_ETP, validarEtp, type ConteudoEtp, type IncisoEtp } from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;
const TEXTO = 'Texto suficiente para o inciso do estudo técnico preliminar.';
const JUSTIFICATIVA = 'Não se aplica ao objeto, conforme análise da equipe de planejamento.';
const OBRIGATORIOS: IncisoEtp[] = ['I', 'IV', 'VI', 'VIII', 'XIII'];

function conteudo(preencher: (inciso: IncisoEtp, obrigatorio: boolean) => { texto?: string; justificativaAusencia?: string } | undefined): ConteudoEtp {
  const c: ConteudoEtp = {};
  for (const { inciso, obrigatorio } of INCISOS_ETP) {
    const valor = preencher(inciso, obrigatorio);
    if (valor !== undefined) c[inciso] = valor;
  }
  return c;
}

describe('INCISOS_ETP', () => {
  it('tem os 13 incisos do art. 18, § 1º', () => {
    assert.equal(INCISOS_ETP.length, 13);
    assert.equal(INCISOS_ETP[0]?.titulo, 'Descrição da necessidade da contratação');
    assert.equal(INCISOS_ETP[12]?.titulo, 'Posicionamento conclusivo sobre a adequação da contratação');
  });

  it('obrigatórios (§ 2º): I, IV, VI, VIII e XIII', () => {
    assert.deepEqual(INCISOS_ETP.filter((i) => i.obrigatorio).map((i) => i.inciso), OBRIGATORIOS);
  });
});

describe('validarEtp', () => {
  it('ETP vazio: 5 obrigatórios vazios e 8 sem justificativa', () => {
    const r = validarEtp({});
    assert.equal(r.completo, false);
    assert.equal(r.percentualPreenchido, 0);
    assert.equal(r.pendencias.length, 13);
    assert.deepEqual(r.pendencias.filter((p) => p.motivo === 'obrigatorio_vazio').map((p) => p.inciso), OBRIGATORIOS);
    assert.equal(r.pendencias.filter((p) => p.motivo === 'sem_justificativa_ausencia').length, 8);
    assert.equal(r.fundamento, 'Lei 14.133/2021, art. 18, §§ 1º e 2º');
  });

  it('todos os incisos com texto: completo', () => {
    const r = validarEtp(conteudo(() => ({ texto: TEXTO })));
    assert.equal(r.completo, true);
    assert.equal(r.percentualPreenchido, 100);
    assert.deepEqual(r.pendencias, []);
  });

  it('obrigatórios com texto e demais com ausência justificada: completo', () => {
    const r = validarEtp(conteudo((_, obrigatorio) => (obrigatorio ? { texto: TEXTO } : { justificativaAusencia: JUSTIFICATIVA })));
    assert.equal(r.completo, true);
    assert.equal(r.percentualPreenchido, 100);
  });

  it('justificativa de ausência não supre inciso obrigatório', () => {
    const r = validarEtp(conteudo((inciso) => (inciso === 'VI' ? { justificativaAusencia: JUSTIFICATIVA } : { texto: TEXTO })));
    assert.equal(r.completo, false);
    assert.deepEqual(r.pendencias.map((p) => [p.inciso, p.motivo]), [['VI', 'obrigatorio_vazio']]);
    assert.match(r.pendencias[0]?.mensagem ?? '', /Estimativa do valor da contratação/);
  });

  it('somente os obrigatórios preenchidos: 5 de 13 atendidos', () => {
    const r = validarEtp(conteudo((_, obrigatorio) => (obrigatorio ? { texto: TEXTO } : undefined)));
    assert.equal(r.percentualPreenchido, 38.5);
    assert.ok(r.pendencias.every((p) => p.motivo === 'sem_justificativa_ausencia'));
  });

  it('texto abaixo do mínimo não conta; espaços nas pontas são ignorados', () => {
    const curto = 'a'.repeat(29);
    const r = validarEtp(conteudo(() => ({ texto: `   ${curto}   ` })));
    assert.equal(r.pendencias.length, 13);
    const exato = validarEtp(conteudo(() => ({ texto: 'a'.repeat(30) })));
    assert.equal(exato.completo, true);
  });

  it('mínimo de caracteres configurável', () => {
    const r = validarEtp(conteudo(() => ({ texto: 'curto, mas ok' })), 10);
    assert.equal(r.completo, true);
  });

  it('rejeita mínimo inválido e conteúdo ausente', () => {
    assert.throws(() => validarEtp({}, -1), comCodigo('ETP_INVALIDO'));
    assert.throws(() => validarEtp(null as unknown as ConteudoEtp), comCodigo('ETP_INVALIDO'));
  });
});
