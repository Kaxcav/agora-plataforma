import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, VerificacaoAuditoria } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { HASH_INICIAL, calcularHashEvento, jsonCanonico, verificarCadeia } from '../src/auditoria/trilha.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('trilha de auditoria encadeada por hash', () => {
  let app: FastifyInstance;
  let auditor: Credenciais;

  before(async () => {
    app = await criarAppTeste();
    auditor = await entrar(app, 'auditor@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('JSON canônico ordena chaves e omite undefined', () => {
    assert.equal(jsonCanonico({ b: 1, a: { d: [1, 'x', null], c: true }, z: undefined }), '{"a":{"c":true,"d":[1,"x",null]},"b":1}');
  });

  test('a cadeia da carga de demonstração é íntegra (também verificada em lotes pequenos)', async () => {
    const verificacao = await obterJson<VerificacaoAuditoria>(app, auditor, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);
    assert.equal(verificacao.primeiraFalha, null);
    assert.ok(verificacao.eventosVerificados > 100);
    const emLotes = await verificarCadeia(app.agora.banco, new Date(), 7);
    assert.equal(emLotes.integra, true);
    assert.equal(emLotes.eventosVerificados, verificacao.eventosVerificados);

    const primeiro = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?tamanhoPagina=1&pagina=${verificacao.eventosVerificados}`);
    assert.equal(primeiro.itens[0]?.hashAnterior, HASH_INICIAL);
  });

  test('filtros da trilha: ação, recurso, usuário e período', async () => {
    const sincronizacoes = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=sincronizacao');
    assert.equal(sincronizacoes.total, 4, 'uma sincronização offline por fonte na carga');
    const seed = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=seed.executar');
    assert.equal(seed.total, 1);
    const hoje = app.agora.hoje();
    const doDia = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?de=${hoje}&ate=${hoje}&tamanhoPagina=100`);
    assert.ok(doDia.itens.every((e) => e.ocorridoEm >= `${hoje.slice(0, 8)}`));
    const doAuditor = await obterJson<Pagina<EventoAuditoria>>(app, auditor, `/api/v1/auditoria?usuario=${auditor.sessao.usuario.id}`);
    assert.ok(doAuditor.itens.every((e) => e.usuario?.id === auditor.sessao.usuario.id));
    const busca = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?busca=pendencia');
    assert.ok(busca.total > 0, 'busca sem acento encontra "pendência"');
  });

  test('UPDATE, DELETE e TRUNCATE na trilha são bloqueados por trigger', async () => {
    const banco = app.agora.banco;
    await assert.rejects(banco.executar("UPDATE auditoria_eventos SET resumo = 'adulterado' WHERE sequencia = 1"), /somente inclusão/);
    await assert.rejects(banco.executar('DELETE FROM auditoria_eventos WHERE sequencia = 1'), /somente inclusão/);
    await assert.rejects(banco.executarScript('TRUNCATE auditoria_eventos'), /somente inclusão/);

    const [fornecedor] = await banco.consultar<{ id: string }>('SELECT id FROM fornecedores ORDER BY documento LIMIT 1');
    assert.ok(fornecedor);
    const revelacao = await chamar(app, auditor, 'POST', '/api/v1/lgpd/revelar', {
      recurso: 'fornecedor',
      id: fornecedor.id,
      campo: 'email',
      finalidade: 'Teste do bloqueio de alteração do registro de acesso',
    });
    assert.equal(revelacao.statusCode, 200);
    await assert.rejects(banco.executar("UPDATE lgpd_acessos SET finalidade = 'x'"), /somente inclusão/);
    await assert.rejects(banco.executar('DELETE FROM lgpd_acessos'), /somente inclusão/);
  });

  test('adulteração é detectada: conteúdo alterado, hash recalculado e evento removido', async () => {
    const adulterado = await criarAppTeste();
    try {
      const banco = adulterado.agora.banco;
      const agora = new Date();
      assert.equal((await verificarCadeia(banco, agora)).integra, true);
      const desabilitar = 'ALTER TABLE auditoria_eventos DISABLE TRIGGER auditoria_eventos_somente_inclusao';
      const habilitar = 'ALTER TABLE auditoria_eventos ENABLE TRIGGER auditoria_eventos_somente_inclusao';

      // 1) Conteúdo alterado por superusuário com o trigger desligado
      await banco.executarScript(desabilitar);
      await banco.executar(`UPDATE auditoria_eventos SET dados = dados || '{"valor": 1}'::jsonb WHERE sequencia = 50`);
      await banco.executarScript(habilitar);
      let verificacao = await verificarCadeia(banco, agora);
      assert.equal(verificacao.integra, false);
      assert.equal(verificacao.primeiraFalha?.sequencia, 50);
      assert.match(verificacao.primeiraFalha?.motivo ?? '', /alterado/);

      // 2) Atacante recalcula o hash do evento adulterado: a quebra aparece no elo seguinte
      const [linha] = await banco.consultar<{
        sequencia: number;
        ocorrido_em: string;
        usuario_id: string | null;
        acao: string;
        recurso: string;
        recurso_id: string | null;
        dados: unknown;
        hash_anterior: string;
      }>('SELECT sequencia, ocorrido_em, usuario_id, acao, recurso, recurso_id, dados, hash_anterior FROM auditoria_eventos WHERE sequencia = 50');
      assert.ok(linha);
      const hashForjado = calcularHashEvento({
        hashAnterior: linha.hash_anterior,
        sequencia: linha.sequencia,
        ocorridoEm: linha.ocorrido_em,
        usuarioId: linha.usuario_id,
        acao: linha.acao,
        recurso: linha.recurso,
        recursoId: linha.recurso_id,
        dados: linha.dados,
      });
      await banco.executarScript(desabilitar);
      await banco.executar('UPDATE auditoria_eventos SET hash = $1 WHERE sequencia = 50', [hashForjado]);
      await banco.executarScript(habilitar);
      verificacao = await verificarCadeia(banco, agora);
      assert.equal(verificacao.integra, false);
      assert.equal(verificacao.primeiraFalha?.sequencia, 51);
      assert.match(verificacao.primeiraFalha?.motivo ?? '', /hash anterior/);
      assert.equal(verificacao.eventosVerificados, 50);

      // 3) Remoção de um evento no meio da cadeia
      const outro = await criarAppTeste();
      try {
        await outro.agora.banco.executarScript(desabilitar);
        await outro.agora.banco.executar('DELETE FROM auditoria_eventos WHERE sequencia = 20');
        await outro.agora.banco.executarScript(habilitar);
        const auditorOutro = await entrar(outro, 'auditor@agora.demo');
        const resposta = await obterJson<VerificacaoAuditoria>(outro, auditorOutro, '/api/v1/auditoria/verificacao');
        assert.equal(resposta.integra, false);
        assert.equal(resposta.primeiraFalha?.sequencia, 21);
      } finally {
        await outro.close();
      }
    } finally {
      await adulterado.close();
    }
  });
});
