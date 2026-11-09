import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  ContratoDetalhe,
  ContratoResumo,
  EntradaClassificacaoSigilo,
  ManifestacaoModeracao,
  MinhaManifestacao,
  NotificacaoDetalhe,
  Pagina,
  ProcessoDetalhe,
  ProcessoResumo,
  QualificacaoTecnica,
  RegistroAcessoDadoPessoal,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

describe('costura transversal: avisos ao cidadão na gestão compartilhada (Frente Y)', () => {
  let app: FastifyInstance;
  let cidadao: Credenciais;
  let gestor: Credenciais;
  let contratoId: string;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    cidadao = await entrar(app, 'cidadao@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    const [c] = await app.agora.banco.consultar<{ id: string }>(
      `SELECT c.id FROM contratos c
        WHERE c.vigencia_fim >= $1 AND c.gestor_id IS NOT NULL
        ORDER BY c.numero LIMIT 1`,
      [app.agora.hoje()],
    );
    assert.ok(c, 'contrato vigente encontrado');
    contratoId = c.id;
  });

  after(async () => {
    await app.close();
  });

  test('moderação aprova a manifestação e o cidadão recebe o aviso; a resposta gera outro aviso', async () => {
    // 1. Cidadão envia uma manifestação
    const texto = 'Relato de cidadão sobre a execução das obras e serviços previstos no contrato.';
    const envioResp = await chamar(app, cidadao, 'POST', `/api/v1/sociedade/contratos/${contratoId}/manifestacoes`, {
      assunto: 'execucao',
      texto,
    });
    assert.equal(envioResp.statusCode, 201, envioResp.body);
    const manifestacao = envioResp.json<MinhaManifestacao>();
    const manifestacaoId = manifestacao.id;
    assert.ok(manifestacaoId);

    // 2. Moderação aprova (decisao = 'publicar')
    const motivoAprovacao = 'Manifestação pertinente e legítima quanto ao andamento do contrato.';
    const modResp = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/moderacao`, {
      decisao: 'publicar',
      motivo: motivoAprovacao,
    });
    assert.equal(modResp.statusCode, 200, modResp.body);
    const moderada = modResp.json<ManifestacaoModeracao>();
    assert.equal(moderada.situacao, 'publicada');

    // 3. Verifica que a notificação ao cidadão foi gerada e enviada
    const notificacoes = await app.agora.banco.consultar<{ id: string; tipo: string; origem: string; assunto: string; corpo: string }>(
      `SELECT id, tipo, origem, assunto, corpo FROM notificacoes
        WHERE tipo = 'manifestacao' AND instrumento_id = $1
        ORDER BY criada_em DESC`,
      [contratoId],
    );
    assert.ok(notificacoes.length >= 1, 'notificação de manifestação gerada');
    const notifAprovacao = notificacoes[0]!;
    assert.equal(notifAprovacao.tipo, 'manifestacao');
    assert.equal(notifAprovacao.origem, 'automatica');
    assert.match(notifAprovacao.corpo, /Manifestação publicada pela moderação/);

    const enviosAprovacao = await app.agora.banco.consultar<{
      id: string;
      canal: string;
      papel: string;
      usuario_id: string;
      endereco: string;
      base_legal: string;
      situacao: string;
    }>(
      `SELECT id, canal, papel, usuario_id, endereco, base_legal, situacao
         FROM notificacoes_envios
        WHERE notificacao_id = $1`,
      [notifAprovacao.id],
    );
    assert.equal(enviosAprovacao.length, 1);
    const envio1 = enviosAprovacao[0]!;
    assert.equal(envio1.canal, 'email');
    assert.equal(envio1.papel, 'cidadao');
    assert.equal(envio1.usuario_id, cidadao.sessao.usuario.id);
    assert.equal(envio1.situacao, 'enviado');
    assert.match(envio1.base_legal, /Lei 13\.709\/2018/);
    assert.match(envio1.base_legal, /art\. 174, § 3º, VI/);

    // O detalhe da notificação na tela/API exibe o e-mail mascarado
    const detalheNotif = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${notifAprovacao.id}`);
    assert.ok(detalheNotif);
    const envioDetalhe1 = detalheNotif.envios.find((e) => e.id === envio1.id);
    assert.ok(envioDetalhe1);
    assert.ok(envioDetalhe1.endereco !== null);
    assert.ok(!envioDetalhe1.endereco.includes('cidadao@agora.demo'), 'e-mail não aparece sem máscara');
    assert.match(envioDetalhe1.endereco, /c\*+@agora\.demo/);

    // 4. A administração responde à manifestação
    const textoResposta = 'Agradecemos a manifestação. A equipe de fiscalização adotou as providências cabíveis.';
    const resp = await chamar(app, gestor, 'POST', `/api/v1/sociedade/manifestacoes/${manifestacaoId}/respostas`, {
      origem: 'administracao',
      texto: textoResposta,
    });
    assert.equal(resp.statusCode, 200, resp.body);

    // 5. Verifica que a resposta gerou outro aviso ao cidadão
    const notificacoesAposResp = await app.agora.banco.consultar<{ id: string; tipo: string; origem: string; assunto: string; corpo: string }>(
      `SELECT id, tipo, origem, assunto, corpo FROM notificacoes
        WHERE tipo = 'manifestacao' AND instrumento_id = $1
        ORDER BY criada_em DESC`,
      [contratoId],
    );
    assert.ok(notificacoesAposResp.length >= 2, 'segunda notificação de manifestação gerada');
    const notifResposta = notificacoesAposResp[0]!;
    assert.notEqual(notifResposta.id, notifAprovacao.id, 'id diferente do primeiro aviso');
    assert.equal(notifResposta.tipo, 'manifestacao');
    assert.match(notifResposta.corpo, /Resposta registrada/);
    assert.match(notifResposta.corpo, /Agradecemos a manifestação/);

    const enviosResposta = await app.agora.banco.consultar<{
      id: string;
      canal: string;
      papel: string;
      usuario_id: string;
      endereco: string;
      base_legal: string;
      situacao: string;
    }>(
      `SELECT id, canal, papel, usuario_id, endereco, base_legal, situacao
         FROM notificacoes_envios
        WHERE notificacao_id = $1`,
      [notifResposta.id],
    );
    assert.equal(enviosResposta.length, 1);
    const envio2 = enviosResposta[0]!;
    assert.equal(envio2.canal, 'email');
    assert.equal(envio2.papel, 'cidadao');
    assert.equal(envio2.usuario_id, cidadao.sessao.usuario.id);
    assert.equal(envio2.situacao, 'enviado');
    assert.match(envio2.base_legal, /Lei 13\.709\/2018/);

    // Detalhe da segunda notificação também exibe o e-mail mascarado
    const detalheNotif2 = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${notifResposta.id}`);
    const envioDetalhe2 = detalheNotif2.envios.find((e) => e.id === envio2.id);
    assert.ok(envioDetalhe2);
    assert.match(envioDetalhe2.endereco ?? '', /c\*+@agora\.demo/);
  });
});

const RAZOES = 'Especificações táticas do equipamento policial cuja divulgação compromete operações de segurança pública em andamento.';
const AUTORIDADE = { nome: 'Autoridade Sintética Souza', cargo: 'Diretor-Geral', nivel: 'titular_entidade' as const, atoDelegacao: null };

function classificacao(extra: Partial<EntradaClassificacaoSigilo>): EntradaClassificacaoSigilo {
  return {
    alvo: 'processo',
    tipo: 'lai',
    grau: 'secreta',
    hipotese: 'VIII',
    razoes: RAZOES,
    dataProducao: '2026-11-02',
    prazoFim: '2036-11-02',
    eventoFim: null,
    autoridade: AUTORIDADE,
    ...extra,
  };
}

describe('costura transversal: sigilo nas listas e no detalhe internos e relatório LGPD (Frente Y)', () => {
  let app: FastifyInstance;
  let gestor: Credenciais;
  let agente: Credenciais;
  let juridico: Credenciais;
  let auditor: Credenciais;
  let controle: Credenciais;
  let processoId: string;
  let contratoId: string;
  let contratoObjeto: string;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    gestor = await entrar(app, 'gestor@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    auditor = await entrar(app, 'auditoria.externa@agora.demo');
    controle = await entrar(app, 'controle@agora.demo');
    const lista = await obterJson<Pagina<ProcessoResumo>>(app, agente, `/api/v1/processos?busca=${encodeURIComponent('viaturas')}`);
    const id = lista.itens[0]?.id;
    assert.ok(id, 'processo de viaturas no seed');
    processoId = id;
    const contratado = await chamar(app, agente, 'POST', `/api/v1/processos/${processoId}/contratar`);
    assert.equal(contratado.statusCode, 200, contratado.body);
    const contrato = contratado.json<ProcessoDetalhe>().contratoGerado;
    assert.ok(contrato);
    contratoId = contrato.id;
    const detalhe = await obterJson<ContratoDetalhe>(app, juridico, `/api/v1/contratos/${contratoId}`);
    contratoObjeto = detalhe.objeto;
    assert.match(contratoObjeto, /viaturas/i);
  });

  after(async () => {
    await app.close();
  });

  test('sem credencial: "Informação classificada" com o grau nas listas, busca cega ao texto real e detalhe do contrato 403; controle acessa e fica registrado', async () => {
    const r = await chamar(app, gestor, 'POST', `/api/v1/processos/${processoId}/sigilo/classificacoes`, classificacao({ alvo: 'processo' }));
    assert.equal(r.statusCode, 200, r.body);

    // Lista de processos
    const aberta = await obterJson<Pagina<ProcessoResumo>>(app, juridico, '/api/v1/processos?tamanhoPagina=100');
    const mascarado = aberta.itens.find((p) => p.id === processoId);
    assert.ok(mascarado);
    assert.equal(mascarado.titulo, 'Informação classificada (secreta)');
    const busca = await obterJson<Pagina<ProcessoResumo>>(app, juridico, '/api/v1/processos?busca=viaturas&tamanhoPagina=100');
    assert.ok(!busca.itens.some((p) => p.id === processoId), 'a busca não acha o texto real');
    assert.equal(busca.total, busca.itens.length, 'a contagem também não revela');
    const peloNumero = await obterJson<Pagina<ProcessoResumo>>(app, juridico, `/api/v1/processos?busca=${encodeURIComponent(mascarado.numeroSei)}`);
    assert.ok(peloNumero.itens.some((p) => p.id === processoId), 'o número SEI continua achando');
    for (const quem of [auditor, controle]) {
      const real = await obterJson<Pagina<ProcessoResumo>>(app, quem, '/api/v1/processos?busca=viaturas&tamanhoPagina=100');
      const item = real.itens.find((p) => p.id === processoId);
      assert.ok(item, 'órgão de controle vê o processo');
      assert.doesNotMatch(item.titulo, /Informação classificada/);
    }

    // Lista de contratos (o contrato herda a classificação do processo)
    const contratos = await obterJson<Pagina<ContratoResumo>>(app, juridico, '/api/v1/contratos?tamanhoPagina=100');
    const contrato = contratos.itens.find((c) => c.id === contratoId);
    assert.ok(contrato);
    assert.equal(contrato.objeto, 'Informação classificada (secreta)');
    const buscaContrato = await obterJson<Pagina<ContratoResumo>>(app, juridico, '/api/v1/contratos?busca=viaturas&tamanhoPagina=100');
    assert.ok(!buscaContrato.itens.some((c) => c.id === contratoId), 'a busca de contratos não acha o texto real');
    const realContrato = await obterJson<Pagina<ContratoResumo>>(app, auditor, '/api/v1/contratos?busca=viaturas&tamanhoPagina=100');
    assert.equal(realContrato.itens.find((c) => c.id === contratoId)?.objeto, contratoObjeto);

    // Detalhe e sub-recursos do contrato
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/contratos/${contratoId}`)).statusCode, 403);
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/contratos/${contratoId}/itens`)).statusCode, 403);
    assert.equal((await chamar(app, auditor, 'GET', `/api/v1/contratos/${contratoId}`)).statusCode, 200);
    assert.equal((await chamar(app, controle, 'GET', `/api/v1/contratos/${contratoId}`)).statusCode, 200);

    const acessos = await app.agora.banco.consultar<{ usuario_id: string; permitido: boolean; base: string; alvo: string }>(
      'SELECT usuario_id, permitido, base, alvo FROM sigilo_acessos WHERE processo_id = $1',
      [processoId],
    );
    assert.ok(acessos.some((a) => a.usuario_id === auditor.sessao.usuario.id && a.permitido && a.base === 'controle' && a.alvo === 'contrato'), 'acesso do auditor registrado');
    assert.ok(acessos.some((a) => a.usuario_id === controle.sessao.usuario.id && a.permitido && a.base === 'controle'), 'acesso do controle interno registrado');
    assert.ok(acessos.some((a) => a.usuario_id === juridico.sessao.usuario.id && !a.permitido), 'negação registrada');
  });

  test('relatório LGPD lista acessos a documentos com dado pessoal e a informação sigilosa, sem CPF', async () => {
    const [arquivo] = await app.agora.banco.consultar<{ id: string }>(
      `INSERT INTO processos_arquivos (processo_id, categoria, tipo, titulo, nome_original, formato, tamanho_bytes, sha256, contem_dado_pessoal, antivirus, enviado_por, enviado_em)
       VALUES ($1, 'processo', 'documento_processo', 'Documento sintético', 'doc.pdf', 'pdf', 10, $2, true, 'limpo', $3, $4) RETURNING id`,
      [processoId, 'a'.repeat(64), gestor.sessao.usuario.id, app.agora.relogio().toISOString()],
    );
    assert.ok(arquivo);
    await app.agora.banco.executar(
      `INSERT INTO processos_arquivos_acessos (arquivo_id, usuario_id, ocorrido_em, finalidade, ip_hash) VALUES ($1, $2, $3, $4, 'hash')`,
      [arquivo.id, agente.sessao.usuario.id, app.agora.relogio().toISOString(), 'Conferência do documento do titular na habilitação'],
    );

    const relatorio = await obterJson<Pagina<RegistroAcessoDadoPessoal>>(app, auditor, '/api/v1/lgpd/acessos?tamanhoPagina=100');
    const documento = relatorio.itens.find((a) => a.origem === 'documento' && a.recursoId === arquivo.id);
    assert.ok(documento, 'acesso a documento com dado pessoal');
    assert.equal(documento.usuario.nome, agente.sessao.usuario.nome);
    assert.match(documento.finalidade, /Conferência do documento/);
    const sigilo = relatorio.itens.filter((a) => a.origem === 'sigilo' && a.recursoId === processoId);
    assert.ok(sigilo.some((a) => /permitido/.test(a.finalidade)), 'acesso permitido do controle');
    assert.ok(sigilo.some((a) => /negado/.test(a.finalidade)), 'acesso negado registrado');
    assert.ok(sigilo.every((a) => a.usuario.nome.length > 0));
    assert.ok(!/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(JSON.stringify(relatorio)), 'sem CPF');
    const soSigilo = await obterJson<Pagina<RegistroAcessoDadoPessoal>>(app, auditor, '/api/v1/lgpd/acessos?origem=sigilo&tamanhoPagina=100');
    assert.ok(soSigilo.itens.length > 0 && soSigilo.itens.every((a) => a.origem === 'sigilo'));
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/lgpd/acessos')).statusCode, 403);
  });
});

describe('costura transversal: edital com modo de disputa e art. 67 (Frente Y)', () => {
  let app: FastifyInstance;
  let agente: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    agente = await entrar(app, 'agente@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('modo "fechado e aberto" e a tabela das parcelas de maior relevância saem no edital', async () => {
    const lista = await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?etapa=4&tamanhoPagina=100');
    const primeiro = lista.itens[0];
    assert.ok(primeiro, 'processo na etapa 4');
    const processo = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${primeiro.id}`);
    const total = processo.valorEstimado;
    const item = processo.dfd.itens[0];
    assert.ok(total !== null && total > 0 && item);

    const gerar = async (): Promise<string> => {
      const r = await chamar(app, agente, 'POST', `/api/v1/processos/${primeiro.id}/documentos/gerar`, { tipo: 'edital' });
      assert.equal(r.statusCode, 200, r.body);
      const edital = r.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === 'edital');
      assert.ok(edital);
      return edital.conteudo;
    };

    const padrao = await gerar();
    assert.match(padrao, /modo de disputa aberto/);
    assert.doesNotMatch(padrao, /Quantitativo mínimo exigido/);

    const parametros = { ...processo.parametrosEdital, exigeFaturamentoMinimo: false, exigeRegistroCadastralComplementar: false, modoDisputa: 'fechado_aberto' };
    const salvo = await chamar(app, agente, 'PUT', `/api/v1/processos/${primeiro.id}/parametros-edital`, parametros);
    assert.equal(salvo.statusCode, 200, salvo.body);
    const stale = salvo.json<ProcessoDetalhe>();
    assert.equal(stale.parametrosEdital.modoDisputa, 'fechado_aberto');
    assert.ok(stale.documentos.some((d) => d.tipo === 'edital' && d.geradoComParametrosAnteriores), 'mudar o modo de disputa exige gerar de novo');

    const parcela = { descricao: item.descricao.slice(0, 120), unidade: item.unidade, quantidadeObjeto: item.quantidade, valorEstimado: Math.round(total / 2), termos: [], quantidadeMinima: Math.floor(item.quantidade / 2) };
    const q = await chamar(app, agente, 'PUT', `/api/v1/processos/${primeiro.id}/qualificacao-tecnica`, { parcelas: [parcela] });
    assert.equal(q.statusCode, 200, q.body);
    assert.equal(q.json<QualificacaoTecnica>().parcelas.length, 1);

    const conteudo = await gerar();
    assert.match(conteudo, /modo de disputa fechado e aberto/);
    assert.match(conteudo, /Parcela de maior relevância/);
    assert.match(conteudo, /Quantitativo mínimo exigido \(art\. 67, § 2º\)/);
    assert.ok(conteudo.includes(parcela.descricao));
  });
});
