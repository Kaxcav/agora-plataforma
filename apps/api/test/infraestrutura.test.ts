import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { gerarHashSenha, verificarSenha, avaliarPoliticaSenha } from '../src/autenticacao/senhas.ts';
import { aplicarMigracoes, listarMigracoes, ErroMigracao, DIRETORIO_MIGRACOES } from '../src/banco/migracoes.ts';
import { abrirPglite } from '../src/banco/pglite.ts';
import { carregarConfig, ErroConfiguracao } from '../src/config.ts';
import { gerarCsv } from '../src/modulos/itens/csv.ts';
import { normalizarBusca, padraoContem } from '../src/compartilhado/texto.ts';

describe('infraestrutura: configuração, migrações, senhas e utilitários', () => {
  test('configuração: padrões de demonstração e exigências de produção', () => {
    const demo = carregarConfig({});
    assert.equal(demo.ambiente, 'demonstracao');
    assert.equal(demo.porta, 3000);
    assert.equal(demo.bancoUrl, null);
    assert.equal(demo.cookieSeguro, false);
    assert.equal(demo.seedDemonstracao, true);
    assert.equal(demo.integracoes, 'offline');
    assert.equal(demo.govbr, null);
    assert.equal(demo.orgao.sigla, 'MJSP');

    assert.throws(() => carregarConfig({ AGORA_AMBIENTE: 'producao' }), (erro: unknown) => {
      assert.ok(erro instanceof ErroConfiguracao);
      assert.ok(erro.problemas.some((p) => p.startsWith('AGORA_SEGREDO_SESSAO')));
      assert.ok(erro.problemas.some((p) => p.startsWith('AGORA_BANCO_URL')));
      return true;
    });
    const producao = carregarConfig({
      AGORA_AMBIENTE: 'producao',
      AGORA_SEGREDO_SESSAO: 'x'.repeat(40),
      AGORA_BANCO_URL: 'postgres://agora:senha@banco:5432/agora',
    });
    assert.equal(producao.cookieSeguro, true);
    assert.equal(producao.seedDemonstracao, false);
    assert.throws(() => carregarConfig({ AGORA_PORTA: 'abc' }), ErroConfiguracao);
    assert.throws(() => carregarConfig({ AGORA_GOVBR_CLIENT_ID: 'só um' }), /juntos/);
    assert.throws(() => carregarConfig({ AGORA_SEGREDO_SESSAO: 'curto' }), /32 bytes/);
  });

  test('migrações: ordem, idempotência, trilha somente inclusão e detecção de migração alterada', async () => {
    const nomes = listarMigracoes().map((m) => m.nome);
    assert.deepEqual(nomes, [...nomes].sort());
    assert.equal(nomes[0], '001_cadastros_base.sql');
    const banco = await abrirPglite('memory://');
    try {
      assert.deepEqual(await aplicarMigracoes(banco), nomes);
      assert.deepEqual(await aplicarMigracoes(banco), [], 'segunda execução não reaplica');

      const diretorio = mkdtempSync(join(tmpdir(), 'agora-migracoes-'));
      try {
        const [primeira] = listarMigracoes(DIRETORIO_MIGRACOES);
        assert.ok(primeira);
        writeFileSync(join(diretorio, primeira.nome), `${primeira.sql}\n-- alterada`);
        await assert.rejects(aplicarMigracoes(banco, diretorio), ErroMigracao);
      } finally {
        rmSync(diretorio, { recursive: true, force: true });
      }
    } finally {
      await banco.fechar();
    }
  });

  test('senhas: scrypt no formato scrypt$N$r$p$sal$hash e política mínima', async () => {
    const hash = await gerarHashSenha('Senha-forte-2026');
    const partes = hash.split('$');
    assert.equal(partes.length, 6);
    assert.deepEqual(partes.slice(0, 4), ['scrypt', '16384', '8', '1']);
    assert.equal(Buffer.from(partes[4] ?? '', 'base64').length, 16);
    assert.equal(Buffer.from(partes[5] ?? '', 'base64').length, 64);
    assert.equal(await verificarSenha('Senha-forte-2026', hash), true);
    assert.equal(await verificarSenha('senha-forte-2026', hash), false);
    assert.equal(await verificarSenha('qualquer', null), false);
    assert.equal(await verificarSenha('qualquer', 'formato-invalido'), false);
    assert.ok(avaliarPoliticaSenha('curta1'));
    assert.equal(avaliarPoliticaSenha('Agora@Demo2026'), null);
  });

  test('CSV neutraliza fórmulas e escapa separadores; busca normalizada sem acento', () => {
    const csv = gerarCsv(['A', 'B'], [['=1+1', 'texto; com "aspas"'], [{ centavos: 123456 }, { decimal: 12.34 }]]);
    assert.equal(csv, "﻿A;B\r\n'=1+1;\"texto; com \"\"aspas\"\"\"\r\n1234,56;12,3\r\n");
    assert.equal(normalizarBusca('  Câmera  CORPORAL ', 'Ação'), 'camera corporal acao');
    assert.equal(padraoContem('50%_off'), '%50\\%\\_off%');
  });
});
