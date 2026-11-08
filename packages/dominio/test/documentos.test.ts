import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ErroDominio,
  formatarCnpj,
  formatarCpf,
  mascararCpf,
  mascararDocumento,
  mascararEmail,
  mascararNome,
  mascararTelefone,
  somenteDigitos,
  tipoDocumento,
  validarCnpj,
  validarCpf,
} from '../src/index.ts';

const comCodigo = (codigo: string) => (e: unknown) => e instanceof ErroDominio && e.codigo === codigo;

describe('somenteDigitos', () => {
  it('remove tudo que não é dígito', () => {
    assert.equal(somenteDigitos('529.982.247-25'), '52998224725');
    assert.equal(somenteDigitos('abc'), '');
  });
});

describe('validarCpf', () => {
  it('aceita CPF válido com e sem pontuação', () => {
    assert.equal(validarCpf('529.982.247-25'), true);
    assert.equal(validarCpf('52998224725'), true);
    assert.equal(validarCpf('123.456.789-09'), true);
  });

  it('rejeita dígito verificador errado', () => {
    assert.equal(validarCpf('529.982.247-26'), false);
    assert.equal(validarCpf('529.982.247-15'), false);
  });

  it('rejeita sequências repetidas', () => {
    assert.equal(validarCpf('111.111.111-11'), false);
    assert.equal(validarCpf('000.000.000-00'), false);
  });

  it('rejeita tamanho errado e caracteres estranhos', () => {
    assert.equal(validarCpf('123'), false);
    assert.equal(validarCpf('529.982.247-2a5'), false);
    assert.equal(validarCpf(''), false);
  });
});

describe('validarCnpj', () => {
  it('aceita CNPJ válido com e sem pontuação', () => {
    assert.equal(validarCnpj('11.222.333/0001-81'), true);
    assert.equal(validarCnpj('11222333000181'), true);
    assert.equal(validarCnpj('12.345.678/0001-95'), true);
  });

  it('rejeita dígito verificador errado e sequências repetidas', () => {
    assert.equal(validarCnpj('11.222.333/0001-82'), false);
    assert.equal(validarCnpj('00.000.000/0000-00'), false);
  });

  it('não trata o CNPJ alfanumérico', () => {
    assert.equal(validarCnpj('12.ABC.345/01DE-35'), false);
  });

  it('não confunde CPF com CNPJ', () => {
    assert.equal(validarCnpj('529.982.247-25'), false);
  });
});

describe('formatarCpf e formatarCnpj', () => {
  it('formatam a partir de dígitos', () => {
    assert.equal(formatarCpf('52998224725'), '529.982.247-25');
    assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
  });

  it('rejeitam tamanho inválido', () => {
    assert.throws(() => formatarCpf('123'), comCodigo('CPF_INVALIDO'));
    assert.throws(() => formatarCnpj('123'), comCodigo('CNPJ_INVALIDO'));
  });
});

describe('tipoDocumento', () => {
  it('identifica CPF, CNPJ e inválido', () => {
    assert.equal(tipoDocumento('529.982.247-25'), 'cpf');
    assert.equal(tipoDocumento('11.222.333/0001-81'), 'cnpj');
    assert.equal(tipoDocumento('529.982.247-26'), 'invalido');
    assert.equal(tipoDocumento('qualquer coisa'), 'invalido');
  });
});

describe('mascararCpf', () => {
  it('segue o padrão de anonimização do governo federal', () => {
    assert.equal(mascararCpf('123.456.789-09'), '***.456.789-**');
    assert.equal(mascararCpf('52998224725'), '***.982.247-**');
  });

  it('rejeita tamanho inválido', () => {
    assert.throws(() => mascararCpf('1234'), comCodigo('CPF_INVALIDO'));
  });
});

describe('mascararDocumento', () => {
  it('CNPJ é exibido completo e formatado', () => {
    assert.equal(mascararDocumento('11222333000181'), '11.222.333/0001-81');
  });

  it('CPF é mascarado', () => {
    assert.equal(mascararDocumento('529.982.247-25'), '***.982.247-**');
  });

  it('documento inválido', () => {
    assert.equal(mascararDocumento('529.982.247-26'), 'Documento inválido');
    assert.equal(mascararDocumento(''), 'Documento inválido');
  });
});

describe('mascararEmail', () => {
  it('mantém o primeiro caractere e o domínio', () => {
    assert.equal(mascararEmail('joao.silva@mj.gov.br'), 'j*********@mj.gov.br');
    assert.equal(mascararEmail('  ana@exemplo.gov.br '), 'a**@exemplo.gov.br');
    assert.equal(mascararEmail('x@y.br'), 'x@y.br');
  });

  it('rejeita e-mail inválido', () => {
    for (const invalido of ['sem-arroba', '@mj.gov.br', 'joao@', 'jo ao@mj.gov.br']) {
      assert.throws(() => mascararEmail(invalido), comCodigo('EMAIL_INVALIDO'), invalido);
    }
  });
});

describe('mascararTelefone', () => {
  it('celular e fixo com DDD', () => {
    assert.equal(mascararTelefone('(61) 99876-1234'), '(61) *****-1234');
    assert.equal(mascararTelefone('(61) 3333-1234'), '(61) ****-1234');
  });

  it('com código do país e sem DDD', () => {
    assert.equal(mascararTelefone('+55 61 99876-1234'), '(61) *****-1234');
    assert.equal(mascararTelefone('99876-1234'), '*****-1234');
  });

  it('rejeita telefone inválido', () => {
    assert.throws(() => mascararTelefone('123'), comCodigo('TELEFONE_INVALIDO'));
  });
});

describe('mascararNome', () => {
  it('primeiro nome e iniciais, ignorando partículas', () => {
    assert.equal(mascararNome('Maria das Graças Souza'), 'Maria G. S.');
    assert.equal(mascararNome('João da Silva e Souza'), 'João S. S.');
    assert.equal(mascararNome('José Ávila'), 'José Á.');
    assert.equal(mascararNome('pedro de oliveira'), 'pedro O.');
  });

  it('nome único é mantido', () => {
    assert.equal(mascararNome('  Cláudia  '), 'Cláudia');
  });

  it('rejeita nome vazio', () => {
    assert.throws(() => mascararNome('   '), comCodigo('NOME_INVALIDO'));
  });
});
