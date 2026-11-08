import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { ConfiguracaoPublica, EventoAuditoria, Pagina, ProcessoDetalhe, ProcessoResumo } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { criarProvedorIa, ErroIa, MODELO_DETERMINISTICO, restaurarTrechosProtegidos } from '../src/ia/provedor.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

type Modo = 'ok' | 'erro' | 'omite' | 'lento';

interface ChamadaRecebida {
  url: string;
  autorizacao: string | undefined;
  corpo: { model?: string; messages: { role: string; content: string }[] };
}

/** Servidor local no formato OpenAI (chat completions), com modos de falha controlados pelo teste. */
async function servidorIaSimulado(): Promise<{ servidor: Server; url: string; chamadas: ChamadaRecebida[]; definirModo(m: Modo): void }> {
  let modo: Modo = 'ok';
  const chamadas: ChamadaRecebida[] = [];
  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8')) as ChamadaRecebida['corpo'];
      chamadas.push({ url: req.url ?? '', autorizacao: req.headers.authorization, corpo });
      if (modo === 'lento') return;
      if (modo === 'erro') {
        res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"indisponivel"}');
        return;
      }
      const prompt = corpo.messages.at(-1)?.content ?? '';
      const rascunho = prompt.slice(prompt.indexOf('<<<\n') + 4, prompt.lastIndexOf('\n>>>'));
      const protegido = /(<!-- protegido:([a-z_]+) -->)[\s\S]*?(<!-- \/protegido:\2 -->)/g;
      const texto =
        modo === 'omite'
          ? rascunho.replace(protegido, '')
          : `Redação revisada pela IA (TEXTO-DA-IA).\n\n${rascunho.replace(protegido, '$1\nCONTEUDO ADULTERADO PELA IA\n$3')}`;
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ model: 'modelo-local-7b', choices: [{ index: 0, message: { role: 'assistant', content: texto } }] }));
    });
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  const { port } = servidor.address() as AddressInfo;
  return { servidor, url: `http://127.0.0.1:${port}`, chamadas, definirModo: (m) => (modo = m) };
}

describe('IA opcional: provedor compatível com OpenAI, trechos protegidos e retorno ao modelo de texto', () => {
  let ia: Awaited<ReturnType<typeof servidorIaSimulado>>;
  let app: FastifyInstance;
  let agente: Credenciais;
  let processos: ProcessoResumo[];
  const idDe = (fragmento: string) => {
    const p = processos.find((x) => x.titulo.toLowerCase().includes(fragmento));
    if (!p) throw new Error(fragmento);
    return p.id;
  };

  before(async () => {
    ia = await servidorIaSimulado();
    app = await criarAppTeste({
      env: { AGORA_IA_PROVEDOR: 'openai_compativel', AGORA_IA_URL: `${ia.url}/`, AGORA_IA_MODELO: 'modelo-local', AGORA_IA_CHAVE: 'chave-secreta-teste' },
    });
    agente = await entrar(app, 'agente@agora.demo');
    processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos')).itens;
  });
  after(async () => {
    await app.close();
    ia.servidor.closeAllConnections();
    await new Promise<void>((resolver) => ia.servidor.close(() => resolver()));
  });

  test('com IA habilitada, o edital é redigido pela IA, marcado como tal, e as seções protegidas voltam do modelo', async () => {
    const publica = await app.inject({ method: 'GET', url: '/api/v1/configuracao-publica' });
    assert.equal(publica.json<ConfiguracaoPublica>().iaHabilitada, true);
    ia.definirModo('ok');
    const id = idDe('drones');
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'edital' });
    assert.equal(r.statusCode, 200);
    const edital = r.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'edital');
    assert.ok(edital);
    assert.equal(edital.geradoPor, 'ia');
    assert.equal(edital.versao, 2);
    assert.match(edital.conteudo, /Rascunho gerado por IA — requer revisão humana/);
    assert.match(edital.conteudo, /TEXTO-DA-IA/);
    assert.match(edital.conteudo, /modelo modelo-local-7b/);
    assert.doesNotMatch(edital.conteudo, /ADULTERADO/, 'habilitação e sanções nunca são redigidas pela IA');
    assert.match(edital.conteudo, /Habilitação jurídica \(art\. 66\)/);
    assert.match(edital.conteudo, /Das infrações e sanções administrativas/);
    assert.ok(edital.fontes.length > 0 && edital.premissas.length > 0);

    const chamada = ia.chamadas.at(-1);
    assert.ok(chamada);
    assert.equal(chamada.url, '/v1/chat/completions');
    assert.equal(chamada.autorizacao, 'Bearer chave-secreta-teste');
    assert.equal(chamada.corpo.model, 'modelo-local');
    assert.equal(chamada.corpo.messages[0]?.role, 'system');
    assert.match(chamada.corpo.messages[0]?.content ?? '', /protegido/);
    assert.match(chamada.corpo.messages[1]?.content ?? '', /Minuta do Edital/);
    assert.doesNotMatch(JSON.stringify(chamada.corpo), /\d{3}\.\d{3}\.\d{3}-\d{2}|@agora\.demo/, 'nenhum dado pessoal no prompt');

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.documento.gerar');
    assert.ok(trilha.itens.some((e) => e.resumo.includes('com apoio de IA')));
  });

  test('falha do provedor (HTTP 500) volta ao modelo de texto e registra um sinal RIA-04', async () => {
    ia.definirModo('erro');
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${idDe('drones')}/documentos/gerar`, { tipo: 'tr' });
    assert.equal(r.statusCode, 200);
    const detalhe = r.json<ProcessoDetalhe>();
    const tr = detalhe.documentos.find((d) => d.tipo === 'tr');
    assert.equal(tr?.geradoPor, 'modelo');
    assert.match(tr?.conteudo ?? '', /Rascunho — requer revisão humana/);
    const sinal = detalhe.sinais.find((s) => s.regra === 'RIA-04');
    assert.ok(sinal);
    assert.equal(sinal.nivel, 'atencao');
    assert.match(sinal.mensagem, /HTTP 500/);
  });

  test('resposta que omite seção protegida é recusada; o checklist do parecer nunca passa pela IA', async () => {
    ia.definirModo('omite');
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${idDe('drones')}/documentos/gerar`, { tipo: 'minuta_contrato' });
    const detalhe = r.json<ProcessoDetalhe>();
    assert.equal(detalhe.documentos.find((d) => d.tipo === 'minuta_contrato')?.geradoPor, 'modelo');
    assert.ok(detalhe.sinais.some((s) => s.regra === 'RIA-04' && s.mensagem.includes('omitiu a seção protegida')));

    ia.definirModo('ok');
    const antes = ia.chamadas.length;
    const juridico = await entrar(app, 'juridico@agora.demo');
    const checklist = await chamar(app, juridico, 'POST', `/api/v1/processos/${idDe('software')}/documentos/gerar`, { tipo: 'parecer_checklist' });
    assert.equal(checklist.statusCode, 200);
    assert.equal(checklist.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'parecer_checklist')?.geradoPor, 'modelo');
    assert.equal(ia.chamadas.length, antes, 'a IA não foi chamada para o parecer');
  });

  test('provedor: tempo limite, provedor "nenhum" e restauração de trechos protegidos', async () => {
    ia.definirModo('lento');
    const lento = criarProvedorIa({ provedor: 'openai_compativel', url: ia.url, modelo: null, chave: null }, (e, i) => fetch(e, i), { timeoutMs: 150 });
    await assert.rejects(lento.gerar('teste', { modeloBase: 'x', finalidade: 'teste', fontes: [] }), (erro: unknown) => erro instanceof Error && erro.name === 'TimeoutError');
    const chamada = ia.chamadas.at(-1);
    assert.equal(chamada?.autorizacao, undefined, 'sem AGORA_IA_CHAVE não há cabeçalho Authorization');
    assert.equal(chamada?.corpo.model, undefined);

    const nenhum = criarProvedorIa({ provedor: 'nenhum', url: null, modelo: null, chave: null }, (e, i) => fetch(e, i));
    assert.deepEqual(await nenhum.gerar('ignorado', { modeloBase: 'texto do modelo', finalidade: 'teste', fontes: [] }), { texto: 'texto do modelo', modelo: MODELO_DETERMINISTICO });

    const modelo = 'A\n<!-- protegido:conclusao -->\noriginal\n<!-- /protegido:conclusao -->';
    assert.equal(
      restaurarTrechosProtegidos('B\n<!-- protegido:conclusao -->\nalterado\n<!-- /protegido:conclusao -->\n<!-- protegido:inventado -->\nx\n<!-- /protegido:inventado -->', modelo),
      'B\n<!-- protegido:conclusao -->\noriginal\n<!-- /protegido:conclusao -->\n',
    );
    assert.throws(() => restaurarTrechosProtegidos('sem trecho', modelo), ErroIa);
  });
});
