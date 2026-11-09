import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construirApp } from '../src/app.ts';
import { carregarConfig, ErroConfiguracao } from '../src/config.ts';

/** Sobe a Ágora num banco PGlite persistido em disco (o mesmo diretório entre as inicializações). */
async function subir(dados: string, env: Record<string, string> = {}) {
  const config = carregarConfig({
    AGORA_AMBIENTE: 'demonstracao',
    AGORA_DADOS_DIR: dados,
    AGORA_LOG_NIVEL: 'silent',
    AGORA_WEB_DIR: 'memory://sem-front-end',
    AGORA_OPERACAO_SONDA_SEGUNDOS: '0',
    ...env,
  });
  return construirApp(config);
}

async function nomeDoAdministrador(app: Awaited<ReturnType<typeof subir>>): Promise<string> {
  const [linha] = await app.agora.banco.consultar<{ nome: string }>("SELECT nome FROM usuarios WHERE email = 'admin@agora.demo'");
  return linha?.nome ?? '';
}

describe('recarga única da demonstração (AGORA_SEED_RECRIAR)', () => {
  test('recria a carga uma vez por marca e preserva os dados nas reinicializações seguintes', async () => {
    const dados = mkdtempSync(join(tmpdir(), 'agora-recarga-'));
    try {
      // 1) Primeira subida: banco vazio, carga normal. Uma alteração marca o estado.
      let app = await subir(dados);
      const original = await nomeDoAdministrador(app);
      assert.ok(original.length > 0, 'carga sintética criada na primeira subida');
      await app.agora.banco.executar("UPDATE usuarios SET nome = 'Marcador da recarga' WHERE email = 'admin@agora.demo'");
      await app.close();

      // 2) Com a marca nova: o banco é apagado e a carga recriada (a alteração some) e a marca fica registrada.
      app = await subir(dados, { AGORA_SEED_RECRIAR: 'teste-1' });
      assert.equal(await nomeDoAdministrador(app), original, 'carga recriada do zero');
      const [marca] = await app.agora.banco.consultar<{ total: number }>("SELECT count(*)::int AS total FROM recargas_demonstracao WHERE marca = 'teste-1'");
      assert.equal(marca?.total, 1);
      await app.agora.banco.executar("UPDATE usuarios SET nome = 'Depois da recarga' WHERE email = 'admin@agora.demo'");
      await app.close();

      // 3) Mesma marca de novo (reinicialização do serviço): nada é apagado.
      app = await subir(dados, { AGORA_SEED_RECRIAR: 'teste-1' });
      assert.equal(await nomeDoAdministrador(app), 'Depois da recarga', 'a mesma marca não recria a carga');
      await app.close();
    } finally {
      rmSync(dados, { recursive: true, force: true });
    }
  });

  test('a variável é recusada fora da demonstração e com formato inválido', () => {
    assert.throws(
      () => carregarConfig({ AGORA_AMBIENTE: 'homologacao', AGORA_SEED_RECRIAR: 'x1', AGORA_LOG_NIVEL: 'silent' }),
      (e: unknown) => e instanceof ErroConfiguracao && e.problemas.some((p) => p.startsWith('AGORA_SEED_RECRIAR: só é aceita')),
    );
    assert.throws(
      () => carregarConfig({ AGORA_AMBIENTE: 'demonstracao', AGORA_SEED_RECRIAR: 'com espaço', AGORA_LOG_NIVEL: 'silent' }),
      (e: unknown) => e instanceof ErroConfiguracao && e.problemas.some((p) => p.startsWith('AGORA_SEED_RECRIAR: use')),
    );
  });
});
