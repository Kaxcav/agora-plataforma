import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { Banco, ParametroSql, Transacao } from '../src/banco/tipos.ts';
import { agendarLimpeza, CHAVE_LOCK_LIMPEZA, executarLimpeza } from '../src/manutencao/limpeza.ts';
import { criarAppTeste, INICIO_TESTES } from './apoio.ts';

const DIA_MS = 24 * 60 * 60 * 1000;

describe('limpeza periódica de retenção (LGPD.md §5)', () => {
  let app: FastifyInstance;
  let usuarioId: string;
  const agora = new Date(INICIO_TESTES + 200 * DIA_MS);
  const antes = (dias: number) => new Date(agora.getTime() - dias * DIA_MS).toISOString();

  async function sessao(id: string, expiraHaDias: number): Promise<void> {
    await app.agora.banco.executar(
      `INSERT INTO sessoes (id, usuario_id, csrf_token, criada_em, expira_em, absoluta_ate, ip_hash, agente, metodo)
       VALUES ($1, $2, 'csrf', $3, $4, $5, 'ip', 'teste', 'senha')`,
      [id, usuarioId, antes(expiraHaDias + 1), antes(expiraHaDias), antes(expiraHaDias - 0.2)],
    );
  }
  const tentativa = (diasAtras: number) =>
    app.agora.banco.executar('INSERT INTO tentativas_login (chave, ocorrida_em, sucesso) VALUES ($1, $2, false)', [`teste-${diasAtras}`, antes(diasAtras)]);
  const existentes = async (tabela: 'sessoes' | 'tentativas_login', coluna: 'id' | 'chave', valores: string[]) =>
    (await app.agora.banco.consultar<{ valor: string }>(`SELECT ${coluna} AS valor FROM ${tabela} WHERE ${coluna} = ANY($1::text[]) ORDER BY 1`, [valores])).map((l) => l.valor);

  before(async () => {
    app = await criarAppTeste();
    const [usuario] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM usuarios WHERE email = 'gestor@agora.demo'");
    usuarioId = usuario?.id ?? '';
  });
  after(async () => {
    await app.close();
  });

  test('remove só sessões expiradas há mais de 30 dias e tentativas com mais de 90 dias, e registra na trilha', async () => {
    await sessao('sessao-expirada-31-dias', 31);
    await sessao('sessao-expirada-29-dias', 29);
    await sessao('sessao-ativa', -1);
    await tentativa(91);
    await tentativa(89);

    const resultado = await executarLimpeza(app.agora.banco, agora);
    assert.deepEqual(resultado, { executada: true, sessoesRemovidas: 1, tentativasRemovidas: 1 });
    assert.deepEqual(await existentes('sessoes', 'id', ['sessao-expirada-31-dias', 'sessao-expirada-29-dias', 'sessao-ativa']), ['sessao-ativa', 'sessao-expirada-29-dias']);
    assert.deepEqual(await existentes('tentativas_login', 'chave', ['teste-91', 'teste-89']), ['teste-89']);
    const eventos = await app.agora.banco.consultar<{ dados: { sessoesRemovidas: number; tentativasRemovidas: number } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'manutencao.limpeza'",
    );
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0]?.dados.sessoesRemovidas, 1);

    const repetida = await executarLimpeza(app.agora.banco, agora);
    assert.deepEqual(repetida, { executada: true, sessoesRemovidas: 0, tentativasRemovidas: 0 });
    const [contagem] = await app.agora.banco.consultar<{ total: number }>("SELECT COUNT(*)::integer AS total FROM auditoria_eventos WHERE acao = 'manutencao.limpeza'");
    assert.equal(contagem?.total, 1, 'sem remoção, sem evento');
  });

  test('o agendamento usa o relógio injetado e para ao encerrar', async () => {
    await sessao('sessao-para-o-agendamento', 31);
    const concluidas: number[] = [];
    const agenda = agendarLimpeza({
      banco: app.agora.banco,
      relogio: () => agora,
      intervaloMs: 60 * 60 * 1000,
      aoConcluir: (r) => concluidas.push(r.sessoesRemovidas),
      aoFalhar: (erro) => assert.fail(String(erro)),
    });
    try {
      const resultado = await agenda.executarAgora();
      assert.equal(resultado?.sessoesRemovidas, 1);
      assert.deepEqual(concluidas, [1]);
    } finally {
      agenda.parar();
    }
  });

  test('sem o advisory lock (outra réplica limpando), não remove nada', async () => {
    const comandos: string[] = [];
    const tx: Transacao = {
      emTransacao: true,
      async consultar<T>(sql: string, parametros: readonly ParametroSql[] = []): Promise<T[]> {
        assert.match(sql, /pg_try_advisory_xact_lock/);
        assert.deepEqual(parametros, [CHAVE_LOCK_LIMPEZA]);
        return [{ obtida: false }] as T[];
      },
      async executar(sql: string): Promise<number> {
        comandos.push(sql);
        return 0;
      },
      async executarScript(sql: string): Promise<void> {
        comandos.push(sql);
      },
    };
    const banco: Banco = {
      tipo: 'pglite',
      consultar: tx.consultar,
      executar: tx.executar,
      executarScript: tx.executarScript,
      transacao: (fn) => fn(tx),
      verificar: async () => true,
      fechar: async () => undefined,
    };
    const resultado = await executarLimpeza(banco, agora);
    assert.deepEqual(resultado, { executada: false, sessoesRemovidas: 0, tentativasRemovidas: 0 });
    assert.deepEqual(comandos, []);
  });
});
