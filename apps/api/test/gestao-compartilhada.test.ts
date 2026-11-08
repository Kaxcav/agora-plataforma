import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  ContratoPublico,
  GestaoCompartilhadaContrato,
  GestaoCompartilhadaPublica,
  ManifestacaoModeracao,
  MinhaManifestacao,
  Pagina,
  RegistroExecucaoInterno,
  RelatorioFinalPublico,
} from '@agora/contratos';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { detectarFormatoMidia, removerMetadados } from '../src/compartilhado/midia.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';
import { jpegComLocalizacao, MARCA_LOCALIZACAO, mp4ComLocalizacao, pngComLocalizacao } from './apoio-midia.ts';

const CPF_TERCEIRO = gerarCpf(new Prng(4242));
const CPF_TERCEIRO_FORMATADO = `${CPF_TERCEIRO.slice(0, 3)}.${CPF_TERCEIRO.slice(3, 6)}.${CPF_TERCEIRO.slice(6, 9)}-${CPF_TERCEIRO.slice(9)}`;

function enviarBinario(app: FastifyInstance, cred: Credenciais, url: string, corpo: Buffer, tipo = 'application/octet-stream'): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url, headers: { cookie: cred.cookie, 'x-agora-csrf': cred.csrf, 'content-type': tipo }, payload: corpo });
}

describe('remoção de metadados de imagem e vídeo (LGPD)', () => {
  test('PNG: tEXt e eXIf saem; os pixels ficam', () => {
    const original = pngComLocalizacao();
    const { conteudo, removidos } = removerMetadados(original, 'png');
    assert.equal(detectarFormatoMidia(conteudo), 'png');
    assert.ok(!conteudo.includes(MARCA_LOCALIZACAO));
    assert.ok(conteudo.includes(Buffer.from('IDAT', 'latin1')));
    assert.equal(removidos.length, 2);
  });

  test('JPEG: APP1 (EXIF) e comentário saem; APP0 e a varredura ficam', () => {
    const { conteudo, removidos } = removerMetadados(jpegComLocalizacao(), 'jpeg');
    assert.ok(!conteudo.includes(MARCA_LOCALIZACAO));
    assert.ok(conteudo.includes(Buffer.from('JFIF', 'latin1')));
    assert.deepEqual(conteudo.subarray(-2), Buffer.from([0xff, 0xd9]));
    assert.ok(removidos.some((r) => r.includes('APP1')));
  });

  test('MP4: udta zerada e renomeada para free, sem mudar o tamanho', () => {
    const original = mp4ComLocalizacao();
    const { conteudo, removidos } = removerMetadados(original, 'mp4');
    assert.equal(detectarFormatoMidia(original), 'mp4');
    assert.equal(conteudo.length, original.length);
    assert.ok(!conteudo.includes(MARCA_LOCALIZACAO));
    assert.ok(conteudo.includes(Buffer.from('free', 'latin1')));
    assert.ok(original.includes(MARCA_LOCALIZACAO), 'o original não é alterado');
    assert.equal(removidos.length, 1);
  });

  test('arquivo truncado ou de outro tipo é recusado', () => {
    assert.throws(() => removerMetadados(pngComLocalizacao().subarray(0, 40), 'png'), /PNG/);
    assert.equal(detectarFormatoMidia(Buffer.from('<html><body>não é imagem</body></html>')), null);
  });
});

describe('gestão compartilhada com a sociedade (RF-37; art. 174, § 3º, VI)', () => {
  let app: FastifyInstance;
  let cidada: Credenciais;
  let gestor: Credenciais;
  let fiscalObras: Credenciais;
  let fiscal: Credenciais;
  let contratoId: string;
  let manifestacaoId: string;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    cidada = await entrar(app, 'cidadao@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    fiscalObras = await entrar(app, 'fiscal.obras@agora.demo');
    fiscal = await entrar(app, 'fiscal@agora.demo');
    const [vigente] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT c.id FROM contratos c WHERE c.vigencia_fim >= $1 AND NOT EXISTS (SELECT 1 FROM sociedade_manifestacoes m WHERE m.contrato_id = c.id)
        ORDER BY c.numero LIMIT 1`,
      [app.agora.hoje()],
    );
    assert.ok(vigente);
    contratoId = vigente.id;
  });
  after(async () => {
    await app.close();
  });

  test('perfil cidadão: só envia manifestação, sem nenhum acesso interno', async () => {
    assert.deepEqual(cidada.sessao.usuario.perfis, ['cidadao']);
    assert.deepEqual(cidada.sessao.usuario.permissoes, ['sociedade:manifestar']);
    for (const url of ['/api/v1/contratos', '/api/v1/painel', '/api/v1/sociedade/manifestacoes', `/api/v1/sociedade/contratos/${contratoId}`]) {
      assert.equal((await chamar(app, cidada, 'GET', url)).statusCode, 403, url);
    }
    // O cidadão não é agente público: não aparece para designação nem como agente nos vínculos.
    for (const url of ['/api/v1/processos/designaveis', '/api/v1/impedimentos/agentes']) {
      const lista = await obterJson<{ id: string }[]>(app, gestor, url);
      assert.ok(lista.length > 0, url);
      assert.ok(!lista.some((u) => u.id === cidada.sessao.usuario.id), url);
    }
  });

  test('a carga de demonstração traz uma manifestação publicada e respondida, com o autor mascarado', async () => {
    const [publicada] = await app.agora.banco.consultar<{ contrato_id: string }>("SELECT contrato_id FROM sociedade_manifestacoes WHERE situacao = 'publicada'");
    assert.ok(publicada);
    const r = await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${publicada.contrato_id}/gestao-compartilhada` });
    assert.equal(r.statusCode, 200);
    const gestao = r.json<GestaoCompartilhadaPublica>();
    assert.equal(gestao.manifestacoes.length, 1);
    assert.equal(gestao.manifestacoes[0]?.autor, 'Antônia R. C.');
    assert.equal(gestao.manifestacoes[0]?.respostas[0]?.funcao, 'Gestor do contrato');
    assert.equal(gestao.manifestacoes[0]?.situacaoPrazo, 'respondida_no_prazo');
    assert.equal(gestao.prazoRespostaDias, 30);
  });

  test('(a) cidadão envia mensagem e imagem; nada é público antes da moderação', async () => {
    const texto = `A calçada em frente à obra está interditada sem sinalização há uma semana. Meu CPF é ${CPF_TERCEIRO_FORMATADO} e o e-mail morador.sintetico@exemplo.test.`;
    const r = await chamar(app, cidada, 'POST', `/api/v1/sociedade/contratos/${contratoId}/manifestacoes`, { assunto: 'execucao', texto });
    assert.equal(r.statusCode, 201, r.body);
    const minha = r.json<MinhaManifestacao>();
    assert.equal(minha.situacao, 'em_moderacao');
    assert.equal(minha.texto, texto, 'o autor vê o próprio texto original');
    manifestacaoId = minha.id;

    const curta = await chamar(app, cidada, 'POST', `/api/v1/sociedade/contratos/${contratoId}/manifestacoes`, { assunto: 'execucao', texto: 'curta' });
    assert.equal(curta.statusCode, 422);

    const disfarcado = await enviarBinario(app, cidada, `/api/v1/sociedade/manifestacoes/${manifestacaoId}/imagem`, Buffer.from('<script>alert(1)</script>'), 'image/png');
    assert.equal(disfarcado.statusCode, 422, 'o tipo é conferido pelo conteúdo');
    const imagem = await enviarBinario(app, cidada, `/api/v1/sociedade/manifestacoes/${manifestacaoId}/imagem`, pngComLocalizacao());
    assert.equal(imagem.statusCode, 200, imagem.body);
    assert.equal(imagem.json<MinhaManifestacao>().metadadosRemovidos.length, 2);
    const outra = await enviarBinario(app, cidada, `/api/v1/sociedade/manifestacoes/${manifestacaoId}/imagem`, pngComLocalizacao());
    assert.equal(outra.statusCode, 409);
    const alheia = await enviarBinario(app, gestor, `/api/v1/sociedade/manifestacoes/${manifestacaoId}/imagem`, pngComLocalizacao());
    assert.equal(alheia.statusCode, 403, 'gestor não tem sociedade:manifestar');

    const publica = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}/gestao-compartilhada` })).json<GestaoCompartilhadaPublica>();
    assert.equal(publica.manifestacoes.length, 0);
    const imagemPublica = await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}/manifestacoes/${manifestacaoId}/imagem` });
    assert.equal(imagemPublica.statusCode, 404);
  });

  test('moderação: motivo obrigatório, decisão única, auditada; depois o público vê o texto tarjado e a imagem limpa', async () => {
    const fila = await obterJson<Pagina<ManifestacaoModeracao>>(app, gestor, '/api/v1/sociedade/manifestacoes?situacao=em_moderacao&tamanhoPagina=100');
    const item = fila.itens.find((m) => m.id === manifestacaoId);
    assert.ok(item);
    assert.equal(item.dadosPessoaisTarjados, true);
    assert.ok(!item.texto.includes(CPF_TERCEIRO_FORMATADO), 'a moderação vê a versão pública');
    assert.equal((await chamar(app, gestor, 'GET', item.imagemUrl ?? '')).statusCode, 200);

    const semMotivo = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, { decisao: 'publicar', motivo: '' });
    assert.equal(semMotivo.statusCode, 422);
    const cidadaoModera = await chamar(app, cidada, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, { decisao: 'publicar', motivo: 'Quero publicar a minha.' });
    assert.equal(cidadaoModera.statusCode, 403);
    const fiscalModera = await chamar(app, fiscalObras, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, { decisao: 'publicar', motivo: 'Relato pertinente.' });
    assert.equal(fiscalModera.statusCode, 403, 'fiscal responde, mas não modera');

    const ok = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, { decisao: 'publicar', motivo: 'Relato pertinente à execução do contrato.' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json<ManifestacaoModeracao>().situacao, 'publicada');
    const repetida = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, { decisao: 'recusar', motivo: 'Mudei de ideia sobre o relato.' });
    assert.equal(repetida.statusCode, 422);

    const [evento] = await app.agora.banco.consultar<{ dados: { motivo: string } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'sociedade.manifestacao.publicar' AND dados->>'manifestacaoId' = $1",
      [manifestacaoId],
    );
    assert.equal(evento?.dados.motivo, 'Relato pertinente à execução do contrato.');

    const publica = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}/gestao-compartilhada` })).json<GestaoCompartilhadaPublica>();
    const m = publica.manifestacoes[0];
    assert.ok(m);
    assert.equal(m.autor, 'Antônia R. C.');
    assert.ok(!JSON.stringify(publica).includes(CPF_TERCEIRO_FORMATADO));
    assert.ok(!JSON.stringify(publica).includes('morador.sintetico@'));
    assert.ok(!JSON.stringify(publica).includes('Ribeiro Carvalho'), 'nome completo do cidadão não sai');
    const imagem = await app.inject({ method: 'GET', url: m.imagemUrl ?? '' });
    assert.equal(imagem.statusCode, 200);
    assert.equal(imagem.headers['content-type'], 'image/png');
    assert.ok(!imagem.rawPayload.includes(MARCA_LOCALIZACAO));
  });

  test('(c) respostas identificadas da Administração e do contratado, com prazo', async () => {
    const semPreposto = await chamar(app, fiscalObras, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/respostas`, {
      origem: 'contratado',
      texto: 'A sinalização será instalada até sexta-feira pela equipe da obra.',
      representante: null,
    });
    assert.equal(semPreposto.statusCode, 422);
    const adm = await chamar(app, fiscalObras, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/respostas`, {
      origem: 'administracao',
      texto: 'A fiscalização vistoriou o local e determinou ao contratado a sinalização imediata do trecho.',
    });
    assert.equal(adm.statusCode, 200, adm.body);
    const contratado = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/respostas`, {
      origem: 'contratado',
      texto: 'A sinalização será instalada até sexta-feira pela equipe da obra.',
      representante: 'Preposto Sintético da Silva',
    });
    assert.equal(contratado.statusCode, 200, contratado.body);
    const resultado = contratado.json<ManifestacaoModeracao>();
    assert.equal(resultado.respostas.length, 2);
    assert.match(resultado.respostas[0]?.funcao ?? '', /^(Fiscal do contrato|Administração \(Fiscal de contrato\))$/);
    assert.match(resultado.respostas[1]?.funcao ?? '', /^Preposto: Preposto S\. S\./);
    assert.equal(resultado.situacaoPrazo, 'respondida_no_prazo');

    const minhas = await obterJson<MinhaManifestacao[]>(app, cidada, '/api/v1/sociedade/minhas-manifestacoes');
    assert.equal(minhas.find((m) => m.id === manifestacaoId)?.respostas.length, 2);
  });

  test('escopo de UASG: fora do escopo do servidor, 404', async () => {
    const [fora] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT c.id FROM contratos c
        WHERE NOT EXISTS (SELECT 1 FROM usuarios_uasgs uu JOIN usuarios u ON u.id = uu.usuario_id WHERE u.email = 'fiscal@agora.demo' AND uu.uasg = c.uasg)
        LIMIT 1`,
    );
    assert.ok(fora);
    assert.equal((await chamar(app, fiscal, 'GET', `/api/v1/sociedade/contratos/${fora.id}`)).statusCode, 404);
  });

  test('(b) fiscal publica foto e vídeo da execução; registro sigiloso fica guardado sem publicar', async () => {
    const base = `/api/v1/sociedade/contratos/${contratoId}/registros`;
    const foto = await enviarBinario(app, fiscalObras, `${base}?titulo=${encodeURIComponent('Frente de obra — semana 12')}&registradoEm=${app.agora.hoje()}`, pngComLocalizacao([30, 140, 60]));
    assert.equal(foto.statusCode, 201, foto.body);
    const registroFoto = foto.json<RegistroExecucaoInterno>();
    assert.equal(registroFoto.publicado, true);
    assert.equal(registroFoto.midia, 'imagem');

    const video = await enviarBinario(app, fiscalObras, `${base}?titulo=${encodeURIComponent('Concretagem da laje')}&registradoEm=${app.agora.hoje()}`, mp4ComLocalizacao(), 'video/mp4');
    assert.equal(video.statusCode, 201, video.body);
    assert.equal(video.json<RegistroExecucaoInterno>().midia, 'video');

    const sigiloso = await enviarBinario(app, fiscalObras, `${base}?titulo=${encodeURIComponent('Acesso à área restrita')}&registradoEm=${app.agora.hoje()}&sigiloso=true`, pngComLocalizacao([200, 10, 10]));
    assert.equal(sigiloso.statusCode, 201, sigiloso.body);
    const retido = sigiloso.json<RegistroExecucaoInterno>();
    assert.equal(retido.publicado, false);
    assert.match(retido.motivoRetencao ?? '', /sigiloso/);

    const repetido = await enviarBinario(app, fiscalObras, `${base}?titulo=Repetido&registradoEm=${app.agora.hoje()}`, pngComLocalizacao([30, 140, 60]));
    assert.equal(repetido.statusCode, 409);
    const futuro = await enviarBinario(app, fiscalObras, `${base}?titulo=Futuro&registradoEm=2999-01-01`, pngComLocalizacao([1, 2, 3]));
    assert.equal(futuro.statusCode, 400);
    const html = await enviarBinario(app, fiscalObras, `${base}?titulo=Falso&registradoEm=${app.agora.hoje()}`, Buffer.from('<html>falso</html>'), 'image/jpeg');
    assert.equal(html.statusCode, 422);
    assert.equal((await enviarBinario(app, cidada, `${base}?titulo=Cidadao&registradoEm=${app.agora.hoje()}`, pngComLocalizacao())).statusCode, 403);

    const publica = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}/gestao-compartilhada` })).json<GestaoCompartilhadaPublica>();
    assert.equal(publica.registros.length, 2);
    assert.ok(publica.registros.every((r) => r.id !== retido.id));
    const midia = await app.inject({ method: 'GET', url: publica.registros.find((r) => r.midia === 'video')?.url ?? '' });
    assert.equal(midia.headers['content-type'], 'video/mp4');
    assert.ok(!midia.rawPayload.includes(MARCA_LOCALIZACAO));
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}/registros/${retido.id}/midia` })).statusCode, 404);

    const interno = await obterJson<GestaoCompartilhadaContrato>(app, gestor, `/api/v1/sociedade/contratos/${contratoId}`);
    assert.equal(interno.registros.length, 3);
  });

  test('(d) relatório final só ao fim da vigência, uma vez, e público com hash', async () => {
    const vigente = await chamar(app, gestor, 'POST', `/api/v1/sociedade/contratos/${contratoId}/relatorio-final`, {
      objetivos: 'O'.repeat(120),
      resultados: 'R'.repeat(120),
      conclusao: 'atingidos',
    });
    assert.equal(vigente.statusCode, 422);
    const [encerrado] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT c.id FROM contratos c WHERE c.vigencia_fim < $1 AND NOT EXISTS (SELECT 1 FROM sociedade_relatorios_finais r WHERE r.contrato_id = c.id)
        ORDER BY c.numero LIMIT 1`,
      [app.agora.hoje()],
    );
    assert.ok(encerrado);
    const entrada = {
      objetivos: 'Garantir o fornecimento contínuo do objeto às unidades durante a vigência, conforme o estudo técnico preliminar e o termo de referência.',
      resultados: 'Todas as parcelas foram entregues e atestadas; não houve interrupção do atendimento e os atrasos pontuais foram tratados com notificação.',
      conclusao: 'atingidos',
    };
    assert.equal((await chamar(app, fiscalObras, 'POST', `/api/v1/sociedade/contratos/${encerrado.id}/relatorio-final`, entrada)).statusCode, 403);
    const ok = await chamar(app, gestor, 'POST', `/api/v1/sociedade/contratos/${encerrado.id}/relatorio-final`, entrada);
    assert.equal(ok.statusCode, 200, ok.body);
    const relatorio = ok.json<RelatorioFinalPublico>();
    assert.match(relatorio.sha256, /^[0-9a-f]{64}$/);
    assert.match(relatorio.publicadoPor, /^Gestão do contrato — Rafael A\. V\.$/);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/sociedade/contratos/${encerrado.id}/relatorio-final`, entrada)).statusCode, 409);
    const publica = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${encerrado.id}/gestao-compartilhada` })).json<GestaoCompartilhadaPublica>();
    assert.equal(publica.relatorioFinal?.sha256, relatorio.sha256);
    const contrato = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${encerrado.id}` })).json<ContratoPublico>();
    assert.equal(publica.relatorioFinal?.execucao.valorGlobal, contrato.valorGlobal);
  });

  test('limite de 10 manifestações por cidadão em 24 horas', async () => {
    const texto = 'Pergunto se há previsão de nova etapa da execução neste contrato, porque a obra parece parada.';
    let ultimo = 0;
    for (let i = 0; i < 12; i += 1) {
      ultimo = (await chamar(app, cidada, 'POST', `/api/v1/sociedade/contratos/${contratoId}/manifestacoes`, { assunto: 'prazo', texto })).statusCode;
      if (ultimo === 429) break;
    }
    assert.equal(ultimo, 429);
  });
});
