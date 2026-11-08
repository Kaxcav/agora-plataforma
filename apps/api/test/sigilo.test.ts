import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AcessoSigiloRegistrado,
  AncoragemTrilha,
  ContratoPublico,
  EditalPublico,
  EntradaClassificacaoSigilo,
  EventoAuditoria,
  Pagina,
  ProcessoDetalhe,
  ProcessoResumo,
  PublicacaoPncp,
  SigiloProcesso,
  SituacaoAncoragens,
  VerificacaoAncoragens,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { construirApp } from '../src/app.ts';
import { criarArmazenamento } from '../src/armazenamento/arquivos.ts';
import { TODAS_PERMISSOES, PERFIS } from '../src/autorizacao/perfis.ts';
import { sha256Hex } from '../src/compartilhado/cripto.ts';
import { lerTextoPdf } from '../src/compartilhado/pdf-leitura.ts';
import { gerarPdfTexto } from '../src/compartilhado/pdf-texto.ts';
import { carregarConfig, ErroConfiguracao } from '../src/config.ts';
import { lerRespostaCarimbo, lerTokenCarimbo, montarRequisicaoCarimbo } from '../src/integracoes/carimbo-tempo.ts';
import { aadAnexo, cifrar, decifrar, ErroCofre, idChave, resolverChaveCofre } from '../src/modulos/sigilo/cofre.ts';
import { chamar, entrar, obterJson, relogioManual, type Credenciais } from './apoio.ts';
import { criarAutoridadeCarimbo } from './apoio-carimbo.ts';

const RAZOES = 'Especificações táticas do equipamento policial cuja divulgação compromete operações de segurança pública em andamento.';
const AUTORIDADE_DAS = { nome: 'Autoridade Sintética Silva', cargo: 'Diretor de Logística (DAS 101.5)', nivel: 'direcao_das_101_5' as const, atoDelegacao: null };
const AUTORIDADE_TITULAR = { nome: 'Autoridade Sintética Souza', cargo: 'Diretor-Geral', nivel: 'titular_entidade' as const, atoDelegacao: null };

function classificacao(extra: Partial<EntradaClassificacaoSigilo>): EntradaClassificacaoSigilo {
  return {
    alvo: 'documento',
    tipo: 'lai',
    grau: 'reservada',
    hipotese: 'VIII',
    razoes: RAZOES,
    dataProducao: '2026-11-02',
    prazoFim: '2028-11-02',
    eventoFim: null,
    autoridade: AUTORIDADE_DAS,
    ...extra,
  };
}

async function processoPorBusca(app: FastifyInstance, credenciais: Credenciais, busca: string): Promise<string> {
  const lista = await obterJson<Pagina<ProcessoResumo>>(app, credenciais, `/api/v1/processos?busca=${encodeURIComponent(busca)}`);
  const id = lista.itens[0]?.id;
  assert.ok(id, `processo "${busca}" não encontrado`);
  return id;
}

async function esperar(condicao: () => Promise<boolean>, descricao: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!(await condicao())) {
    if (Date.now() > limite) throw new Error(`Tempo esgotado esperando: ${descricao}`);
    await new Promise((resolver) => setTimeout(resolver, 25));
  }
}

function pdfSintetico(texto: string): Buffer {
  return gerarPdfTexto({ titulo: 'Anexo tático sintético', conteudo: `# ANEXO TÁTICO\n\n${texto}` });
}

describe('configuração do sigilo (RNF-09)', () => {
  const base = { AGORA_AMBIENTE: 'demonstracao', AGORA_DADOS_DIR: 'memory://', AGORA_LOG_NIVEL: 'silent' };

  test('chave do cofre em hexadecimal ou base64 com 32 bytes; formatos errados são recusados', () => {
    const hex = 'ab'.repeat(32);
    assert.equal(carregarConfig({ ...base, AGORA_COFRE_CHAVE: hex }).sigilo.cofreChave?.length, 32);
    assert.equal(carregarConfig({ ...base, AGORA_COFRE_CHAVE: Buffer.alloc(32, 7).toString('base64') }).sigilo.cofreChave?.length, 32);
    assert.throws(() => carregarConfig({ ...base, AGORA_COFRE_CHAVE: 'curta' }), (e: unknown) => e instanceof ErroConfiguracao && /AGORA_COFRE_CHAVE/.test(e.message));
  });

  test('autoridade de carimbo: URL válida, credenciais juntas e só em https, impressão do certificado e OID', () => {
    const ok = carregarConfig({ ...base, AGORA_CARIMBO_TEMPO_URL: 'https://act.orgao.example/tsa', AGORA_CARIMBO_TEMPO_CERTIFICADO_SHA256: `AB:${'cd'.repeat(31)}` });
    assert.equal(ok.sigilo.carimboTempo.certificadoSha256, `ab${'cd'.repeat(31)}`);
    assert.equal(ok.sigilo.carimboTempo.intervaloHoras, 24);
    for (const env of [
      { AGORA_CARIMBO_TEMPO_URL: 'ftp://x' },
      { AGORA_CARIMBO_TEMPO_URL: 'https://act.orgao.example', AGORA_CARIMBO_TEMPO_USUARIO: 'sistema' },
      { AGORA_CARIMBO_TEMPO_URL: 'http://act.orgao.example', AGORA_CARIMBO_TEMPO_USUARIO: 'sistema', AGORA_CARIMBO_TEMPO_SENHA: 'senha-sintetica' },
      { AGORA_CARIMBO_TEMPO_CERTIFICADO_SHA256: 'xyz' },
      { AGORA_CARIMBO_TEMPO_POLITICA: 'politica' },
    ]) {
      assert.throws(() => carregarConfig({ ...base, ...env }), ErroConfiguracao, JSON.stringify(env));
    }
  });

  test('produção sem AGORA_COFRE_CHAVE: cofre indisponível; fora de produção, chave derivada do segredo', () => {
    const producao = carregarConfig({ ...base, AGORA_AMBIENTE: 'producao', AGORA_SEGREDO_SESSAO: 'x'.repeat(40), AGORA_BANCO_URL: 'postgres://banco.exemplo:5432/agora' });
    assert.equal(resolverChaveCofre(producao, 'x'.repeat(40)), null);
    const demo = resolverChaveCofre(carregarConfig(base), 'segredo-de-teste-com-mais-de-32-bytes!!');
    assert.ok(demo?.derivada);
    assert.match(demo?.id ?? '', /^[0-9a-f]{16}$/);
  });
});

describe('cofre AES-256-GCM (RNF-09)', () => {
  const chave = { chave: Buffer.alloc(32, 9), id: idChave(Buffer.alloc(32, 9)), derivada: false };

  test('cifra com nonce aleatório e só abre com a mesma chave e o mesmo registro', () => {
    const original = Buffer.from('conteúdo tático sintético');
    const aad = aadAnexo('00000000-0000-4000-8000-000000000001', sha256Hex(original));
    const a = cifrar(chave, original, aad);
    const b = cifrar(chave, original, aad);
    assert.notDeepEqual(a, b, 'nonce novo a cada cifra');
    assert.equal(a.subarray(0, 4).toString('latin1'), 'AGC1');
    assert.ok(!a.includes(original), 'nada em claro');
    assert.deepEqual(decifrar(chave, a, aad), original);
    assert.throws(() => decifrar(chave, a, aadAnexo('00000000-0000-4000-8000-000000000002', sha256Hex(original))), ErroCofre);
    assert.throws(() => decifrar({ ...chave, chave: Buffer.alloc(32, 1) }, a, aad), ErroCofre);
    const adulterado = Buffer.from(a);
    adulterado[adulterado.length - 1] = (adulterado[adulterado.length - 1] ?? 0) ^ 1;
    assert.throws(() => decifrar(chave, adulterado, aad), ErroCofre);
  });
});

describe('carimbo do tempo RFC 3161 — requisição e token', () => {
  test('TimeStampReq DER com SHA-256, nonce e certReq; token simulado lido e assinatura conferida', async () => {
    const impressao = sha256Hex('declaração sintética');
    const requisicao = montarRequisicaoCarimbo(impressao, 0x1234n);
    assert.equal(requisicao[0], 0x30);
    assert.ok(requisicao.includes(Buffer.from(impressao, 'hex')));
    assert.throws(() => montarRequisicaoCarimbo('xyz', 1n));

    const tsa = criarAutoridadeCarimbo();
    const resposta = Buffer.from(await (await tsa.fetch(tsa.url, { method: 'POST', body: new Uint8Array(requisicao) })).arrayBuffer());
    const { token } = lerRespostaCarimbo(resposta);
    const lido = lerTokenCarimbo(token);
    assert.equal(lido.impressao, impressao);
    assert.equal(lido.nonce, 0x1234n);
    assert.equal(lido.assinaturaValida, true, lido.motivoAssinatura ?? '');
    assert.equal(lido.certificadoSha256, tsa.certificadoSha256);
    // Um byte trocado na assinatura invalida o token.
    const adulterado = Buffer.from(token);
    adulterado[adulterado.length - 3] = (adulterado[adulterado.length - 3] ?? 0) ^ 0xff;
    assert.equal(lerTokenCarimbo(adulterado).assinaturaValida, false);
  });
});

describe('sigilo de segurança pública (RN-40, RF-33, RNF-09) — API', () => {
  const tsa = criarAutoridadeCarimbo();
  const tempo = relogioManual();
  let app: FastifyInstance;
  let planejamento: Credenciais;
  let agente: Credenciais;
  let juridico: Credenciais;
  let auditor: Credenciais;
  let gestor: Credenciais;
  let admin: Credenciais;

  before(async () => {
    const config = carregarConfig({
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_DADOS_DIR: 'memory://',
      AGORA_LOG_NIVEL: 'silent',
      AGORA_WEB_DIR: 'memory://sem-front-end',
      AGORA_LIMITE_REQUISICOES_MINUTO: '100000',
      AGORA_CARIMBO_TEMPO_URL: tsa.url,
      AGORA_CARIMBO_TEMPO_CERTIFICADO_SHA256: tsa.certificadoSha256,
    });
    app = await construirApp(config, { relogio: tempo.relogio, fetch: tsa.fetch });
    planejamento = await entrar(app, 'planejamento@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    auditor = await entrar(app, 'auditoria.externa@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('permissões do sigilo na matriz e nos perfis certos', () => {
    // A ordem relativa importa (exibição na matriz); outras frentes podem acrescentar permissões depois destas.
    const inicio = TODAS_PERMISSOES.indexOf('sigilo:ler');
    assert.ok(inicio >= 0, 'sigilo:ler na matriz');
    assert.deepEqual(TODAS_PERMISSOES.slice(inicio, inicio + 5), ['sigilo:ler', 'sigilo:classificar', 'sigilo:credenciar', 'sigilo:controle', 'auditoria:ancorar']);
    const perfil = (codigo: string) => PERFIS.find((p) => p.codigo === codigo)?.permissoes ?? [];
    assert.ok(perfil('auditor').includes('sigilo:controle'));
    assert.ok(perfil('controle_interno').includes('sigilo:controle'));
    assert.ok(perfil('juridico').includes('sigilo:ler') && !perfil('juridico').includes('sigilo:classificar'));
    assert.ok(perfil('planejamento').includes('sigilo:classificar'));
    assert.ok(!perfil('fiscal').includes('sigilo:ler'));
    assert.ok(!perfil('auditor').includes('auditoria:ancorar'));
  });

  test('documento reservado: some da transparência, fica fora do PNCP, nega quem não tem credencial e libera o órgão de controle', async () => {
    const id = await processoPorBusca(app, planejamento, 'P25');
    const antes = (await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}` })).json<EditalPublico>();
    assert.ok(antes.documentos.some((d) => d.tipo === 'tr'));

    // Validação do domínio: grau secreto exige autoridade com competência (art. 27).
    const incompetente = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'tr', grau: 'secreta' }));
    assert.equal(incompetente.statusCode, 422, incompetente.body);

    const r = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'tr' }));
    assert.equal(r.statusCode, 200, r.body);
    const sigilo = r.json<SigiloProcesso>();
    const tr = sigilo.itens.find((i) => i.documentoTipo === 'tr')?.classificacao;
    assert.equal(tr?.situacao, 'vigente');
    assert.equal(tr?.grau, 'reservada');
    assert.match(tr?.codigoIndexacao ?? '', /\.R\.\d{8}\.20281102$/);
    assert.equal(sigilo.meuAcesso.credencial?.grauMaximo, 'reservada', 'quem registra a classificação recebe credencial');

    // Transparência: sem o TR na lista e PDF 404.
    const depois = (await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}` })).json<EditalPublico>();
    assert.ok(!depois.documentos.some((d) => d.tipo === 'tr'));
    assert.equal(depois.sigilo?.documentosRetidos, 1);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}/documentos/tr` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}/documentos/edital` })).statusCode, 200);

    // PNCP: o TR aparece como retido por sigilo.
    const pncp = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
    assert.deepEqual(pncp.retidosPorSigilo?.map((d) => d.documento), ['tr']);

    // Jurídico (sigilo:ler, sem credencial): conteúdo trocado por aviso e PDF negado; tudo registrado.
    const detalhe = await obterJson<ProcessoDetalhe>(app, juridico, `/api/v1/processos/${id}`);
    const conteudoTr = detalhe.documentos.find((d) => d.tipo === 'tr')?.conteudo ?? '';
    assert.match(conteudoTr, /^# RESERVADO — INFORMAÇÃO CLASSIFICADA/);
    const negado = await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/sigilo/documentos/tr/pdf`, { motivo: 'Análise do termo de referência no parecer' });
    assert.equal(negado.statusCode, 403);
    assert.match(negado.json<{ erro: { mensagem: string } }>().erro.mensagem, /não tem credencial/);
    const planejamentoVe = await obterJson<ProcessoDetalhe>(app, planejamento, `/api/v1/processos/${id}`);
    assert.doesNotMatch(planejamentoVe.documentos.find((d) => d.tipo === 'tr')?.conteudo ?? '', /RESERVADO/);

    // Auditor do controle externo: acesso irrestrito, PDF com a marcação em cabeçalho e rodapé, registrado.
    const pdf = await chamar(app, auditor, 'POST', `/api/v1/processos/${id}/sigilo/documentos/tr/pdf`, { motivo: 'Auditoria de conformidade do TCU' });
    assert.equal(pdf.statusCode, 200, pdf.body);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    const texto = lerTextoPdf(pdf.rawPayload).paginas.flatMap((p) => p.linhas).join('\n');
    assert.match(texto, /RESERVADO — INFORMAÇÃO CLASSIFICADA \(Lei 14\.133\/2021, art\. 13\)/);
    assert.match(texto, /restrição de acesso até 02\/11\/2028/);
    assert.match(texto, /Página 1 de \d+/);

    const acessos = await obterJson<Pagina<AcessoSigiloRegistrado>>(app, planejamento, `/api/v1/processos/${id}/sigilo/acessos?tamanhoPagina=50`);
    assert.ok(acessos.itens.some((a) => a.usuario.nome !== '' && !a.permitido && a.base === 'negado_sem_credencial' && a.operacao === 'pdf'));
    assert.ok(acessos.itens.some((a) => a.permitido && a.base === 'controle' && a.operacao === 'pdf' && a.motivo === 'Auditoria de conformidade do TCU'));
    const proprios = await obterJson<Pagina<AcessoSigiloRegistrado>>(app, juridico, `/api/v1/processos/${id}/sigilo/acessos?tamanhoPagina=50`);
    assert.ok(proprios.itens.length > 0 && proprios.itens.every((a) => !a.permitido), 'sem permissão de gestão, cada um vê só os próprios acessos');

    // Trilha: classificação sem as razões em claro (só o hash), negação e acesso do controle.
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=sigilo&tamanhoPagina=50');
    const acoes = new Set(trilha.itens.map((e) => e.acao));
    for (const acao of ['sigilo.classificar', 'sigilo.acesso_negado', 'sigilo.acessar', 'sigilo.credenciar']) assert.ok(acoes.has(acao), acao);
    assert.ok(!JSON.stringify(trilha.itens).includes('Especificações táticas'));

    // Reclassificação exige motivo e cria a versão 2; desclassificação devolve o TR à transparência.
    const semMotivo = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'tr', prazoFim: '2029-11-02' }));
    assert.equal(semMotivo.statusCode, 422);
    const reclassificada = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, {
      ...classificacao({ documentoTipo: 'tr', prazoFim: '2029-11-02' }),
      motivoReclassificacao: 'Operação prorrogada pela coordenação',
    });
    assert.equal(reclassificada.statusCode, 200, reclassificada.body);
    const v2 = reclassificada.json<SigiloProcesso>();
    const atual = v2.itens.find((i) => i.documentoTipo === 'tr')?.classificacao;
    assert.equal(atual?.versao, 2);
    assert.equal(v2.historico[0]?.situacao, 'desclassificada');
    const desclassificar = await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes/${atual?.id ?? ''}/desclassificar`, {
      motivo: 'A operação foi concluída e a informação deixou de ser sensível.',
    });
    assert.equal(desclassificar.statusCode, 200, desclassificar.body);
    const publico = (await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}` })).json<EditalPublico>();
    assert.ok(publico.documentos.some((d) => d.tipo === 'tr'));
    // Orçamento público: o valor estimado aparece no detalhe do edital (na lista, não é recalculado).
    assert.equal(publico.sigilo?.orcamento.situacao, 'publico');
    assert.ok((publico.sigilo?.orcamento.valorEstimado ?? 0) > 0);
  });

  test('processo classificado: credencial no processo decide; grau insuficiente e revogação negam; registro mínimo na transparência', async () => {
    const id = await processoPorBusca(app, gestor, 'coletes');
    const r = await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ alvo: 'processo', grau: 'secreta', prazoFim: '2036-11-02', autoridade: AUTORIDADE_TITULAR }));
    assert.equal(r.statusCode, 200, r.body);

    const negado = await chamar(app, juridico, 'GET', `/api/v1/processos/${id}`);
    assert.equal(negado.statusCode, 403);
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/processos/${id}/arquivos`)).statusCode, 403);
    assert.equal((await chamar(app, auditor, 'GET', `/api/v1/processos/${id}`)).statusCode, 200, 'órgão de controle');
    assert.equal((await chamar(app, admin, 'GET', `/api/v1/processos/${id}`)).statusCode, 403, 'administrar o sistema não dá necessidade de conhecer');

    // Credenciamento pelo administrador (gestor de segurança): reservada não basta para informação secreta.
    const sigilo = await obterJson<SigiloProcesso>(app, admin, `/api/v1/processos/${id}/sigilo`);
    const usuarioJuridico = sigilo.credenciaveis.find((u) => u.perfis.includes('juridico'));
    assert.ok(usuarioJuridico);
    const credencial = (grauMaximo: string) =>
      chamar(app, admin, 'POST', `/api/v1/processos/${id}/sigilo/credenciais`, {
        usuarioId: usuarioJuridico.id,
        grauMaximo,
        fundamento: 'credencial_seguranca',
        necessidade: 'Parecer jurídico do processo (art. 53) exige conhecer o conteúdo.',
        validaAte: '2027-12-31',
      });
    assert.equal((await credencial('reservada')).statusCode, 200);
    const grau = await chamar(app, juridico, 'GET', `/api/v1/processos/${id}`);
    assert.equal(grau.statusCode, 403);
    assert.match(grau.json<{ erro: { mensagem: string } }>().erro.mensagem, /vai até o grau reservada/);
    const segunda = await credencial('secreta');
    assert.equal(segunda.statusCode, 200);
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/processos/${id}`)).statusCode, 200);
    const ativa = segunda.json<SigiloProcesso>().credenciais.find((c) => c.ativa && c.usuario.id === usuarioJuridico.id);
    assert.ok(ativa);
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/sigilo/credenciais`, {})).statusCode, 403, 'só quem credencia');
    const revogada = await chamar(app, admin, 'POST', `/api/v1/processos/${id}/sigilo/credenciais/${ativa.id}/revogar`, { motivo: 'Parecer concluído.' });
    assert.equal(revogada.statusCode, 200);
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/processos/${id}`)).statusCode, 403);

    // Transparência: registro mínimo (sem objeto nem documentos) e fora da busca pelo objeto.
    const edital = (await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${id}` })).json<EditalPublico>();
    assert.equal(edital.sigilo?.registroMinimo, true);
    assert.equal(edital.documentos.length, 0);
    assert.doesNotMatch(edital.objeto, /coletes/i);
    const busca = (await app.inject({ method: 'GET', url: '/api/v1/publico/editais?busca=coletes' })).json<Pagina<EditalPublico>>();
    assert.ok(!busca.itens.some((e) => e.id === id));
  });

  test('contrato sigiloso (art. 91, § 1º): registro mínimo na transparência e sem divulgação no PNCP', async () => {
    const id = await processoPorBusca(app, agente, 'viaturas');
    const contratado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contratar`);
    assert.equal(contratado.statusCode, 200, contratado.body);
    const contratoId = contratado.json<ProcessoDetalhe>().contratoGerado?.id;
    assert.ok(contratoId);
    const r = await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ alvo: 'contrato' }));
    assert.equal(r.statusCode, 200, r.body);
    const publico = (await app.inject({ method: 'GET', url: `/api/v1/publico/contratos/${contratoId}` })).json<ContratoPublico>();
    assert.ok(publico.sigilo);
    assert.equal(publico.valorGlobal, 0);
    assert.match(publico.objeto, /art\. 91, § 1º/);
    const busca = (await app.inject({ method: 'GET', url: '/api/v1/publico/contratos?busca=viaturas' })).json<Pagina<ContratoPublico>>();
    assert.ok(!busca.itens.some((c) => c.id === contratoId));
    const divulgar = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/contrato/publicar-pncp`);
    assert.equal(divulgar.statusCode, 422);
    assert.match(divulgar.body, /sigiloso/);
  });

  test('cofre: anexo enviado direto fica cifrado; o selado sai do armazenamento em claro; download só com motivo e decisão', async () => {
    const id = await processoPorBusca(app, agente, 'drones');
    const conteudo = pdfSintetico(`Rota de patrulha sintética ${Date.now()}`);
    const parametros = new URLSearchParams({
      titulo: 'Plano tático sintético',
      tipoSigilo: 'lai',
      grau: 'reservada',
      hipotese: 'VIII',
      razoes: RAZOES,
      dataProducao: '2026-11-02',
      prazoFim: '2028-11-02',
      autoridadeNome: AUTORIDADE_DAS.nome,
      autoridadeCargo: AUTORIDADE_DAS.cargo,
      autoridadeNivel: AUTORIDADE_DAS.nivel,
    });
    const envio = await app.inject({
      method: 'POST',
      url: `/api/v1/processos/${id}/sigilo/anexos?${parametros.toString()}`,
      headers: { cookie: agente.cookie, 'x-agora-csrf': agente.csrf, 'content-type': 'application/octet-stream', 'x-agora-nome-arquivo': 'plano.pdf' },
      payload: conteudo,
    });
    assert.equal(envio.statusCode, 201, envio.body);
    const item = envio.json<SigiloProcesso>().itens.find((i) => i.alvo === 'anexo' && i.titulo === 'Plano tático sintético');
    assert.ok(item?.noCofre && item.arquivoId);
    const armazenamento = criarArmazenamento('memory://');
    assert.ok(armazenamento);
    await assert.rejects(() => armazenamento.ler(sha256Hex(conteudo)), 'o original em claro nunca foi gravado');

    // Documentos (frente D): o anexo do cofre não sai pela rota comum.
    const comum = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/arquivos/${item.arquivoId}/baixar`, {});
    assert.equal(comum.statusCode, 422);
    assert.match(comum.body, /cofre/);

    const semMotivo = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/anexos/${item.arquivoId}/baixar`, {});
    assert.equal(semMotivo.statusCode, 400);
    const baixado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/anexos/${item.arquivoId}/baixar`, { motivo: 'Conferência do plano na análise' });
    assert.equal(baixado.statusCode, 200, baixado.body);
    assert.deepEqual(baixado.rawPayload, conteudo);
    assert.equal(baixado.headers['x-agora-sha256'], sha256Hex(conteudo));
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/processos/${id}/sigilo/anexos/${item.arquivoId}/baixar`, { motivo: 'Leitura para o parecer jurídico' })).statusCode, 403);
    assert.equal((await chamar(app, auditor, 'POST', `/api/v1/processos/${id}/sigilo/anexos/${item.arquivoId}/baixar`, { motivo: 'Auditoria da CGU sobre o processo' })).statusCode, 200);

    // Anexo já enviado pela página de documentos: ao classificar, é cifrado e o original sai do armazenamento.
    const outro = pdfSintetico(`Memória de cálculo sintética ${Date.now()}`);
    const comumEnviado = await app.inject({
      method: 'POST',
      url: `/api/v1/processos/${id}/arquivos?categoria=processo&tipo=documento_processo&titulo=${encodeURIComponent('Memória sintética')}`,
      headers: { cookie: agente.cookie, 'x-agora-csrf': agente.csrf, 'content-type': 'application/octet-stream', 'x-agora-nome-arquivo': 'memoria.pdf' },
      payload: outro,
    });
    assert.equal(comumEnviado.statusCode, 201, comumEnviado.body);
    const arquivoId = comumEnviado.json<{ id: string }>().id;
    assert.deepEqual(await armazenamento.ler(sha256Hex(outro)), outro);
    const selado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ alvo: 'anexo', arquivoId }));
    assert.equal(selado.statusCode, 200, selado.body);
    assert.ok(selado.json<SigiloProcesso>().itens.find((i) => i.arquivoId === arquivoId)?.noCofre);
    await assert.rejects(() => armazenamento.ler(sha256Hex(outro)));
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=sigilo.cofre&tamanhoPagina=10');
    assert.equal(trilha.itens.length, 1);

    // Orçamento sigiloso (art. 24) só vale com a decisão na pesquisa de preços.
    const orcamento = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'tr', tipo: 'orcamento', grau: null, hipotese: null, prazoFim: null, autoridade: null }));
    assert.equal(orcamento.statusCode, 422);
    assert.match(orcamento.body, /SIGILO_ORCAMENTO_SEM_DECISAO|pesquisa de preços/);
  });

  test('edital classificado não vai ao PNCP; documento classificado fica fora da fila: a publicação envia só o edital e a minuta', async () => {
    const id = await processoPorBusca(app, agente, 'software');
    const detalhe = await obterJson<ProcessoDetalhe>(app, juridico, `/api/v1/processos/${id}`);
    const parecer = await chamar(app, juridico, 'PUT', `/api/v1/processos/${id}/parecer`, {
      itens: detalhe.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })),
      conclusao: 'favoravel',
    });
    assert.equal(parecer.statusCode, 200, parecer.body);

    const edital = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'edital' }));
    assert.equal(edital.statusCode, 200, edital.body);
    const recusado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(recusado.statusCode, 422);
    assert.match(recusado.body, /O edital não pode ser publicado no PNCP/);
    const classificacaoEdital = edital.json<SigiloProcesso>().itens.find((i) => i.documentoTipo === 'edital')?.classificacao?.id ?? '';
    const desclassificado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes/${classificacaoEdital}/desclassificar`, {
      motivo: 'Edital revisado sem as especificações táticas.',
    });
    assert.equal(desclassificado.statusCode, 200, desclassificado.body);

    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sigilo/classificacoes`, classificacao({ documentoTipo: 'tr' }));
    assert.equal(r.statusCode, 200, r.body);
    const publicado = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/publicar`);
    assert.equal(publicado.statusCode, 200, publicado.body);
    await esperar(async () => {
      const s = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
      return s.envios.length === 2 && s.envios.every((e) => e.situacao === 'publicado');
    }, 'compra e minuta publicadas');
    const situacao = await obterJson<PublicacaoPncp>(app, agente, `/api/v1/processos/${id}/publicacao-pncp`);
    assert.deepEqual(situacao.envios.map((e) => e.titulo), ['Edital', 'Minuta do contrato']);
    assert.deepEqual(situacao.retidosPorSigilo?.map((d) => d.documento), ['tr']);
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=pncp.publicar&tamanhoPagina=10');
    assert.ok(trilha.itens.some((e) => e.recursoId === id));
  });

  test('ancoragem RFC 3161: token da autoridade configurada, verificação íntegra e falhas registradas', async () => {
    assert.equal((await chamar(app, juridico, 'POST', '/api/v1/auditoria/ancoragens')).statusCode, 403);
    const r = await chamar(app, admin, 'POST', '/api/v1/auditoria/ancoragens');
    assert.equal(r.statusCode, 201, r.body);
    const ancoragem = r.json<AncoragemTrilha>();
    assert.equal(ancoragem.modo, 'rfc3161');
    assert.ok(ancoragem.carimboEm);
    assert.equal(ancoragem.autoridade, tsa.url);
    const enviada = tsa.requisicoes.at(-1);
    assert.ok(enviada?.includes(Buffer.from(ancoragem.impressao, 'hex')), 'a autoridade recebeu a impressão da declaração');

    const situacao = await obterJson<SituacaoAncoragens>(app, auditor, '/api/v1/auditoria/ancoragens');
    assert.equal(situacao.modo, 'rfc3161');
    assert.equal(situacao.itens[0]?.id, ancoragem.id);
    const verificacao = await obterJson<VerificacaoAncoragens>(app, auditor, '/api/v1/auditoria/ancoragens/verificacao');
    assert.equal(verificacao.cadeiaIntegra, true);
    assert.equal(verificacao.divergentes, 0);
    assert.deepEqual(verificacao.ancoragens[0]?.problemas, []);
    assert.deepEqual(verificacao.ancoragens[0]?.avisos, [], 'certificado confiável configurado');

    tsa.modo = 'nonce_trocado';
    const repetida = await chamar(app, admin, 'POST', '/api/v1/auditoria/ancoragens');
    assert.equal(repetida.statusCode, 503);
    assert.match(repetida.body, /nonce/);
    tsa.modo = 'recusa';
    assert.equal((await chamar(app, admin, 'POST', '/api/v1/auditoria/ancoragens')).statusCode, 503);
    tsa.modo = 'ok';
    const falhas = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=auditoria.ancorar_falhou&tamanhoPagina=10');
    assert.equal(falhas.itens.length, 2);
  });
});

describe('ancoragem local (modo offline)', () => {
  test('sem autoridade configurada, registra a ancoragem local e a verificação confere a prova', async () => {
    const config = carregarConfig({ AGORA_AMBIENTE: 'demonstracao', AGORA_DADOS_DIR: 'memory://', AGORA_LOG_NIVEL: 'silent', AGORA_WEB_DIR: 'memory://sem-front-end', AGORA_LIMITE_REQUISICOES_MINUTO: '100000' });
    let chamadas = 0;
    const app = await construirApp(config, {
      relogio: relogioManual().relogio,
      fetch: async () => {
        chamadas++;
        return new Response('', { status: 500 });
      },
    });
    try {
      const admin = await entrar(app, 'admin@agora.demo');
      const r = await chamar(app, admin, 'POST', '/api/v1/auditoria/ancoragens');
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json<AncoragemTrilha>().modo, 'local');
      const verificacao = await obterJson<VerificacaoAncoragens>(app, admin, '/api/v1/auditoria/ancoragens/verificacao');
      assert.equal(verificacao.integras, 1);
      assert.match(verificacao.ancoragens[0]?.avisos.join(' ') ?? '', /modo offline/);
      assert.equal(chamadas, 0, 'nenhuma chamada externa');
    } finally {
      await app.close();
    }
  });
});
