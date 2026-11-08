import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EventoAuditoria, Pagina, Painel, Sincronizacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import type { FuncaoFetch } from '../src/http/contexto.ts';
import { ErroIntegracao, type ContextoConector } from '../src/integracoes/conector.ts';
import { criarConectorPncp } from '../src/integracoes/pncp.ts';
import { gerarCnpj } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { chamar, criarAppTeste, entrar, obterJson } from './apoio.ts';

const prng = new Prng(77);
const CNPJ_ORGAO = gerarCnpj(prng);
const DOCUMENTOS = [gerarCnpj(prng), gerarCnpj(prng), gerarCnpj(prng)];

function registro(n: number, alteracoes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numeroControlePNCP: `${CNPJ_ORGAO}-2-${String(n).padStart(6, '0')}/2026`,
    numeroContratoEmpenho: String(n),
    anoContrato: 2026,
    processo: `08000.00000${n}/2026-01`,
    objetoContrato: `Aquisição sintética de equipamentos de teste ${n}`,
    niFornecedor: DOCUMENTOS[n - 1] ?? DOCUMENTOS[0],
    nomeRazaoSocialFornecedor: `Fornecedor Sintético ${n} Ltda.`,
    tipoPessoa: 'PJ',
    valorInicial: 12345.67 * n,
    valorGlobal: 12345.67 * n,
    dataAssinatura: '2026-10-01',
    dataVigenciaInicio: '2026-10-01',
    dataVigenciaFim: '2027-09-30',
    dataPublicacaoPncp: '2026-10-05T10:00:00',
    unidadeOrgao: { codigoUnidade: '990001', nomeUnidade: 'Unidade sintética de teste', ufSigla: 'DF' },
    orgaoEntidade: { cnpj: CNPJ_ORGAO, razaoSocial: 'Órgão sintético de teste' },
    categoriaProcesso: { nome: 'Compras' },
    ...alteracoes,
  };
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

function paginas(registros: Record<string, unknown>[][]): FuncaoFetch {
  return async (entrada) => {
    const pagina = Number(new URL(String(entrada)).searchParams.get('pagina'));
    const dados = registros[pagina - 1] ?? [];
    return json({ data: dados, totalRegistros: registros.flat().length, totalPaginas: registros.length, numeroPagina: pagina });
  };
}

describe('conector online do PNCP (fetch simulado)', () => {
  let app: FastifyInstance;
  let ctxBase: Omit<ContextoConector, 'fetch'>;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_ORGAO_CNPJ: CNPJ_ORGAO } });
    ctxBase = { banco: app.agora.banco, config: app.agora.config, hoje: app.agora.hoje(), agora: new Date() };
  });
  after(async () => {
    await app.close();
  });

  test('timeout e erro 500 são retentados com espera exponencial; paginação completa; staging com hash', async () => {
    const chamadas: string[] = [];
    const esperas: number[] = [];
    let tentativaPagina1 = 0;
    const fetchSimulado: FuncaoFetch = (entrada, init) => {
      const url = String(entrada);
      chamadas.push(url);
      const pagina = Number(new URL(url).searchParams.get('pagina'));
      if (pagina === 1) {
        tentativaPagina1++;
        if (tentativaPagina1 === 1) {
          return new Promise((_resolver, rejeitar) => {
            init?.signal?.addEventListener('abort', () => rejeitar(init.signal?.reason));
          });
        }
        if (tentativaPagina1 === 2) return Promise.resolve(json({ mensagem: 'erro interno' }, 500));
        return Promise.resolve(json({ data: [registro(1), registro(2), { numeroControlePNCP: 'malformado' }], totalPaginas: 2, numeroPagina: 1 }));
      }
      return Promise.resolve(json({ data: [registro(3)], totalPaginas: 2, numeroPagina: 2 }));
    };
    const conector = criarConectorPncp({ timeoutMs: 40, esperaBaseMs: 10, esperar: async (ms) => { esperas.push(ms); } });
    const resultado = await conector.executar({ ...ctxBase, fetch: fetchSimulado });

    assert.equal(chamadas.length, 4, '3 tentativas na página 1 + página 2');
    assert.deepEqual(esperas, [10, 20], 'espera exponencial entre tentativas');
    const url = new URL(chamadas[0] ?? '');
    assert.equal(url.origin + url.pathname, 'https://pncp.gov.br/api/consulta/v1/contratos');
    assert.equal(url.searchParams.get('cnpjOrgao'), CNPJ_ORGAO);
    assert.match(url.searchParams.get('dataInicial') ?? '', /^\d{8}$/);
    assert.equal(url.searchParams.get('dataFinal'), ctxBase.hoje.replaceAll('-', ''));
    assert.equal(resultado.registros, 3);
    assert.match(resultado.hash, /^[0-9a-f]{64}$/);
    assert.match(resultado.mensagem, /1 registro\(s\) ignorado/);

    const [staging] = await app.agora.banco.consultar<{ total: number }>('SELECT COUNT(*)::integer AS total FROM pncp_contratos_staging');
    assert.equal(staging?.total, 3);
    const contratos = await app.agora.banco.consultar<{ numero: string; valor_inicial: number; fonte_dados: string; uasg: string }>(
      "SELECT numero, valor_inicial, fonte_dados, uasg FROM contratos WHERE fonte_dados = 'PNCP' ORDER BY numero",
    );
    assert.deepEqual(contratos.map((c) => c.numero), ['1/2026', '2/2026', '3/2026']);
    assert.equal(contratos[0]?.valor_inicial, 1234567);
    assert.equal(contratos[0]?.uasg, '990001');
  });

  test('upsert idempotente que preserva campos editados por usuários', async () => {
    const contar = async () =>
      (await app.agora.banco.consultar<{ total: number }>("SELECT COUNT(*)::integer AS total FROM contratos WHERE fonte_dados = 'PNCP'"))[0]?.total;
    const antes = await contar();
    const conector = criarConectorPncp({ esperar: async () => undefined });
    await conector.executar({ ...ctxBase, fetch: paginas([[registro(1), registro(2)], [registro(3)]]) });
    assert.equal(await contar(), antes, 'reexecução não duplica');

    const idPncp = String(registro(1).numeroControlePNCP);
    await app.agora.banco.executar(
      "UPDATE contratos SET objeto = 'Objeto ajustado pelo gestor', campos_editados = array_append(campos_editados, 'objeto') WHERE id_pncp = $1",
      [idPncp],
    );
    await conector.executar({
      ...ctxBase,
      fetch: paginas([[registro(1, { objetoContrato: 'Objeto alterado no PNCP', dataVigenciaFim: '2027-12-31' }), registro(2, { objetoContrato: 'Novo objeto do 2' })]]),
    });
    const [um] = await app.agora.banco.consultar<{ objeto: string; vigencia_fim: string }>('SELECT objeto, vigencia_fim FROM contratos WHERE id_pncp = $1', [idPncp]);
    assert.equal(um?.objeto, 'Objeto ajustado pelo gestor', 'campo editado não é sobrescrito');
    assert.equal(um?.vigencia_fim, '2027-12-31', 'campo não editado é atualizado');
    const [dois] = await app.agora.banco.consultar<{ objeto: string }>('SELECT objeto FROM contratos WHERE id_pncp = $1', [String(registro(2).numeroControlePNCP)]);
    assert.equal(dois?.objeto, 'Novo objeto do 2');
    assert.equal(await contar(), antes);
  });

  test('indisponibilidade persistente falha após 3 tentativas', async () => {
    let chamadas = 0;
    const conector = criarConectorPncp({ esperaBaseMs: 1, esperar: async () => undefined });
    await assert.rejects(
      conector.executar({
        ...ctxBase,
        fetch: async () => {
          chamadas++;
          return json({}, 503);
        },
      }),
      (erro: unknown) => erro instanceof ErroIntegracao && /após 3 tentativas/.test(erro.message),
    );
    assert.equal(chamadas, 3);
  });

  test('sem CNPJ do órgão configurado, o conector recusa com mensagem clara', async () => {
    const conector = criarConectorPncp();
    await assert.rejects(
      conector.executar({ ...ctxBase, config: { ...ctxBase.config, orgao: { ...ctxBase.config.orgao, cnpj: null } }, fetch: paginas([]) }),
      /AGORA_ORGAO_CNPJ/,
    );
  });

  test('em AGORA_INTEGRACOES=online a execução pela API usa o PNCP, registra proveniência, auditoria e falhas', async () => {
    let falhar = false;
    const online = await criarAppTeste({
      env: { AGORA_INTEGRACOES: 'online', AGORA_ORGAO_CNPJ: CNPJ_ORGAO },
      fetch: async (entrada, init) => (falhar ? json({ mensagem: 'parâmetros inválidos' }, 400) : paginas([[registro(1), registro(2)]])(entrada, init)),
    });
    try {
      const financeiro = await entrar(online, 'financeiro@agora.demo');
      const ok = await chamar(online, financeiro, 'POST', '/api/v1/sincronizacoes/PNCP/executar');
      assert.equal(ok.statusCode, 200);
      const sincronizacao = ok.json<Sincronizacao>();
      assert.equal(sincronizacao.modo, 'online');
      assert.equal(sincronizacao.situacao, 'ok');
      assert.equal(sincronizacao.registrosProcessados, 2);

      falhar = true;
      const falha = await chamar(online, financeiro, 'POST', '/api/v1/sincronizacoes/PNCP/executar');
      assert.equal(falha.statusCode, 200);
      const falhou = falha.json<Sincronizacao>();
      assert.equal(falhou.situacao, 'falhou');
      assert.match(falhou.mensagem ?? '', /HTTP 400/);

      const painel = await obterJson<Painel>(online, financeiro, '/api/v1/painel');
      assert.equal(painel.proveniencia.find((p) => p.fonte === 'PNCP')?.situacao, 'falhou');
      const auditor = await entrar(online, 'auditor@agora.demo');
      const trilha = await obterJson<Pagina<EventoAuditoria>>(online, auditor, '/api/v1/auditoria?recurso=sincronizacao&tamanhoPagina=50');
      assert.ok(trilha.itens.some((e) => e.acao === 'sincronizacao.executar' && e.usuario?.id === financeiro.sessao.usuario.id));
      assert.ok(trilha.itens.some((e) => e.acao === 'sincronizacao.falhar'));
    } finally {
      await online.close();
    }
  });
});
