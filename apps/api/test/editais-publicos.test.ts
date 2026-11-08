import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { EditalPublico, Pagina } from '@agora/contratos';
import { tarjarDadosPessoais } from '../src/modulos/publico/editais.ts';
import { criarAppTeste } from './apoio.ts';

describe('editais públicos — tarja de dados pessoais (RIA-05)', () => {
  test('tarja CPF, e-mail e telefone sem alterar número do processo, CNPJ e valores', () => {
    const texto = [
      'Fiscal: Maria, CPF 123.456.789-09, e-mail maria.silva@orgao.gov.br, telefone (61) 99876-1234.',
      'Processo 08000.014502/2026-77; contratada CNPJ 46.906.416/0001-74; valor R$ 3.505.560,00.',
    ].join('\n');
    const tarjado = tarjarDadosPessoais(texto);
    assert.match(tarjado, /\*\*\*\.456\.789-\*\*/);
    assert.match(tarjado, /m\*+@orgao\.gov\.br/);
    assert.match(tarjado, /\(61\) \*+-1234/);
    assert.doesNotMatch(tarjado, /123\.456\.789-09|maria\.silva@|99876-1234/);
    assert.match(tarjado, /08000\.014502\/2026-77/);
    assert.match(tarjado, /46\.906\.416\/0001-74/);
    assert.match(tarjado, /R\$ 3\.505\.560,00/);
  });
});

describe('editais públicos — API sem login (art. 25, § 3º; roteiro PoC-05)', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
  });
  after(async () => {
    await app.close();
  });

  test('lista e detalhe dos editais publicados, com o edital e os anexos', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/v1/publico/editais' });
    assert.equal(lista.statusCode, 200);
    const pagina = lista.json<Pagina<EditalPublico>>();
    assert.ok(pagina.total >= 1, 'o seed tem editais publicados');
    const edital = pagina.itens[0];
    assert.ok(edital);
    assert.deepEqual(edital.documentos.map((d) => d.tipo), ['edital', 'tr', 'minuta_contrato']);
    assert.equal(edital.linkPncp, null, 'publicação simulada não aponta para o PNCP real');
    assert.ok(edital.publicadoEm);

    const detalhe = await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${edital.id}` });
    assert.equal(detalhe.statusCode, 200);
    assert.equal(detalhe.json<EditalPublico>().numeroSei, edital.numeroSei);
  });

  test('inteiro teor em PDF sem login; edital não publicado e tipo inválido são recusados', async () => {
    const { itens } = (await app.inject({ method: 'GET', url: '/api/v1/publico/editais' })).json<Pagina<EditalPublico>>();
    const edital = itens[0];
    assert.ok(edital);
    const documento = edital.documentos.find((d) => d.tipo === 'edital');
    assert.ok(documento);
    const pdf = await app.inject({ method: 'GET', url: documento.url });
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(String(pdf.headers['content-disposition']), /^inline; filename="edital-\d+\.pdf"$/);
    assert.ok(pdf.rawPayload.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));

    const [naoPublicado] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM processos WHERE publicacao->>'pncp' <> 'publicado' LIMIT 1");
    assert.ok(naoPublicado);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${naoPublicado.id}` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${naoPublicado.id}/documentos/edital` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${edital.id}/documentos/etp` })).statusCode, 400);
  });
});
