import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AnaliseVinculos,
  ExtensaoSancao,
  MinhaDeclaracao,
  Pagina,
  ProcessoComLicitantes,
  ProcessoDetalhe,
  QuadroSocietario,
  RespostaErro,
  Sancao,
  SinalVinculo,
  VinculoRegistrado,
  VinculosFornecedor,
  VinculosProcesso,
  VerificacaoAuditoria,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { ErroIntegracao } from '../src/integracoes/conector.ts';
import { categoriaQualificacao, consultarQsa } from '../src/integracoes/qsa-receita.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

async function idFornecedor(app: FastifyInstance, inicio: string): Promise<string> {
  const [f] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE razao_social LIKE $1', [`${inicio}%`]);
  assert.ok(f, `fornecedor ${inicio}`);
  return f.id;
}

const erro = (r: { json: <T>() => T }) => r.json<RespostaErro>().erro;

describe('vínculos entre licitantes (RIA-06 e RIA-10), extensão de sanção (RN-27) e declarações (RN-28)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let gestor: Credenciais;
  let agente: Credenciais;
  let juridico: Credenciais;
  let financeiro: Credenciais;
  let consulta: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    admin = await entrar(app, 'admin@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    financeiro = await entrar(app, 'financeiro@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('quatro licitantes, dois com parentesco declarado: sinal RIA-10 de risco com a evidência; sem dado pessoal exposto', async () => {
    const ids = await Promise.all(['Escudo Forte', 'Boreal', 'Guardião', 'Fortaleza'].map((n) => idFornecedor(app, n)));
    const r = await chamar(app, agente, 'POST', '/api/v1/impedimentos/analise', { fornecedorIds: ids });
    assert.equal(r.statusCode, 200, r.body);
    const analise = r.json<AnaliseVinculos>();
    assert.equal(analise.licitantes.length, 4);
    const parentesco = analise.sinais.find((s) => s.tipo === 'vinculo_informado');
    assert.ok(parentesco, 'sinal do parentesco declarado');
    assert.equal(parentesco.regra, 'RIA-10');
    assert.equal(parentesco.nivel, 'risco');
    assert.equal(parentesco.requerRevisaoHumana, true);
    assert.match(parentesco.mensagem, /parentesco de 2º grau/);
    assert.match(parentesco.evidencias[0]?.descricao ?? '', /Declaração de parentesco entregue com a proposta/);
    assert.match(analise.aviso, /não constituem acusação/);
    const socios = await app.agora.banco.consultar<{ cpf: string; nome: string }>('SELECT cpf, nome FROM fornecedores_socios');
    const corpo = r.body;
    assert.ok(socios.every((s) => !corpo.includes(s.cpf) && !corpo.includes(s.nome)), 'CPF e nome completos dos sócios não saem na resposta');

    assert.equal((await chamar(app, consulta, 'POST', '/api/v1/impedimentos/analise', { fornecedorIds: ids })).statusCode, 403);
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/impedimentos/analise', { fornecedorIds: [ids[0]] })).statusCode, 400);
  });

  test('sócio em comum (RIA-06) e possível sucessão (RIA-10) no mesmo motor; painel de sucessões do cadastro', async () => {
    const [nortecom, nortelink] = await Promise.all([idFornecedor(app, 'Nortecom'), idFornecedor(app, 'Nortelink')]);
    const analise = (await chamar(app, gestor, 'POST', '/api/v1/impedimentos/analise', { fornecedorIds: [nortecom, nortelink] })).json<AnaliseVinculos>();
    assert.ok(analise.sinais.some((s) => s.regra === 'RIA-06' && s.tipo === 'administrador_comum'));
    assert.ok(analise.sinais.some((s) => s.regra === 'RIA-10' && s.tipo === 'endereco_comum'));
    const sucessao = analise.sinais.find((s) => s.tipo === 'possivel_sucessao');
    assert.ok(sucessao);
    assert.equal(sucessao.nivel, 'risco');
    assert.ok(sucessao.sancaoOrigemId);

    const painel = await obterJson<SinalVinculo[]>(app, gestor, '/api/v1/impedimentos/sucessoes');
    assert.ok(painel.some((s) => s.fornecedores[0]?.id === nortelink && s.fornecedores[1]?.id === nortecom));
  });

  test('registro de vínculo com fonte e evidência, auditado; validação; revogação', async () => {
    const [guardiao, fortaleza] = await Promise.all([idFornecedor(app, 'Guardião'), idFornecedor(app, 'Fortaleza')]);
    const base = {
      natureza: 'parentesco',
      grauParentesco: 3,
      fornecedorId: guardiao,
      outroFornecedorId: fortaleza,
      agenteId: null,
      fonte: 'informado_agente',
      descricao: 'Os sócios-administradores são tio e sobrinho.',
      evidencia: 'Certidões de nascimento juntadas ao processo SEI (sintético).',
      processoId: null,
    };
    assert.equal((await chamar(app, consulta, 'POST', '/api/v1/impedimentos/vinculos', base)).statusCode, 403);
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/impedimentos/vinculos', { ...base, natureza: 'comercial' })).statusCode, 422);
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/impedimentos/vinculos', { ...base, outroFornecedorId: guardiao })).statusCode, 422);
    const criado = await chamar(app, agente, 'POST', '/api/v1/impedimentos/vinculos', base);
    assert.equal(criado.statusCode, 201, criado.body);
    const vinculo = criado.json<VinculoRegistrado>();
    assert.equal(vinculo.situacao, 'ativo');
    assert.equal(vinculo.registradoPor?.id, agente.sessao.usuario.id);
    const [evento] = await app.agora.banco.consultar<{ acao: string }>(
      "SELECT acao FROM auditoria_eventos WHERE recurso = 'vinculo_licitante' AND recurso_id = $1",
      [vinculo.id],
    );
    assert.equal(evento?.acao, 'impedimentos.vinculo.registrar');
    const doFornecedor = await obterJson<VinculoRegistrado[]>(app, agente, `/api/v1/impedimentos/vinculos?fornecedorId=${fortaleza}`);
    assert.ok(doFornecedor.some((v) => v.id === vinculo.id));

    const revogado = await chamar(app, agente, 'POST', `/api/v1/impedimentos/vinculos/${vinculo.id}/revogar`, { motivo: 'Registro em duplicidade, conferido no processo.' });
    assert.equal(revogado.json<VinculoRegistrado>().situacao, 'revogado');
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/impedimentos/vinculos/${vinculo.id}/revogar`, { motivo: 'Registro em duplicidade, conferido no processo.' })).statusCode, 422);
  });

  test('processo em seleção: sinal RIA-10 também na jornada (etapa 6) e aptidão da equipe', async () => {
    const processos = await obterJson<ProcessoComLicitantes[]>(app, agente, '/api/v1/impedimentos/processos');
    const coletes = processos.find((p) => /coletes/i.test(p.titulo));
    assert.ok(coletes && coletes.licitantes >= 3);
    const vinculos = await obterJson<VinculosProcesso>(app, agente, `/api/v1/impedimentos/processos/${coletes.id}`);
    assert.ok(vinculos.analise.sinais.some((s) => s.tipo === 'vinculo_informado' && s.nivel === 'risco'));
    assert.ok(vinculos.equipe.length > 0);
    assert.ok(vinculos.equipe.some((m) => m.papeis.every((p) => p.apto)));
    const detalhe = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${coletes.id}`);
    assert.equal(detalhe.etapaAtual, 6);
    const sinal = detalhe.sinais.find((s) => s.regra === 'RIA-10');
    assert.ok(sinal, 'o sinal de vínculo aparece na etapa 6 da jornada');
    assert.match(sinal.mensagem, /Requer revisão humana/);
    assert.equal(detalhe.bloqueiosDetalhe.filter((b) => b.regra === 'RIA-10').length, 0, 'sinal nunca bloqueia');
  });

  test('quadro societário pelo conector offline: CPF mascarado, proveniência e auditoria', async () => {
    const nortelink = await idFornecedor(app, 'Nortelink');
    const antes = await obterJson<VinculosFornecedor>(app, agente, `/api/v1/impedimentos/fornecedores/${nortelink}`);
    assert.ok(antes.quadro.integrantes.every((i) => /^\*\*\*\.\d{3}\.\d{3}-\*\*$/.test(i.documento)));
    assert.ok(antes.sinais.some((s) => s.tipo === 'possivel_sucessao'));
    const r = await chamar(app, agente, 'POST', `/api/v1/impedimentos/fornecedores/${nortelink}/qsa`);
    assert.equal(r.statusCode, 200, r.body);
    const quadro = r.json<QuadroSocietario>();
    assert.equal(quadro.proveniencia?.modo, 'offline');
    assert.match(quadro.proveniencia?.hash ?? '', /^[0-9a-f]{64}$/);
    assert.equal(quadro.proveniencia?.registros, 2);
    const [evento] = await app.agora.banco.consultar<{ dados: { modo: string } }>(
      "SELECT dados FROM auditoria_eventos WHERE acao = 'impedimentos.qsa.consultar' AND recurso_id = $1 ORDER BY sequencia DESC LIMIT 1",
      [nortelink],
    );
    assert.equal(evento?.dados.modo, 'offline');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/impedimentos/fornecedores/${nortelink}`)).statusCode, 403);
  });

  test('extensão de sanção do sinal à decisão: contraditório, análise jurídica, segregação e registro no módulo de sanções', async () => {
    const [nortecom, nortelink] = await Promise.all([idFornecedor(app, 'Nortecom'), idFornecedor(app, 'Nortelink')]);
    const sinal = (await obterJson<SinalVinculo[]>(app, gestor, '/api/v1/impedimentos/sucessoes')).find((s) => s.fornecedores[0]?.id === nortelink);
    assert.ok(sinal?.sancaoOrigemId);
    const proposta = {
      sancaoOrigemId: sinal.sancaoOrigemId,
      alvo: 'sucessora',
      alvoFornecedorId: nortelink,
      alvoIntegranteId: null,
      fundamentacao: 'Empresa aberta depois da instauração do processo, com o mesmo sócio-administrador e o mesmo endereço da impedida.',
      sinal: sinal.mensagem,
      intimacaoEm: app.agora.hoje(),
    };
    assert.equal((await chamar(app, agente, 'POST', '/api/v1/impedimentos/extensoes', proposta)).statusCode, 403, 'propor exige sancoes:instruir');
    const [multa] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM sancoes WHERE tipo = 'multa' AND situacao = 'aplicada' LIMIT 1");
    assert.ok(multa);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/impedimentos/extensoes', { ...proposta, sancaoOrigemId: multa.id })).statusCode, 422);

    const criada = await chamar(app, gestor, 'POST', '/api/v1/impedimentos/extensoes', proposta);
    assert.equal(criada.statusCode, 201, criada.body);
    let extensao = criada.json<ExtensaoSancao>();
    assert.equal(extensao.situacao, 'contraditorio');
    assert.ok(extensao.prazoDefesa > proposta.intimacaoEm);
    assert.equal(extensao.alvo.fornecedor?.id, nortelink);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/impedimentos/extensoes', proposta)).statusCode, 409);
    const sancoesAntes = await obterJson<Pagina<Sancao>>(app, gestor, '/api/v1/sancoes?tamanhoPagina=100');
    assert.ok(!sancoesAntes.itens.some((s) => s.fornecedor.id === nortelink), 'a proposta não estende nada');

    const base = `/api/v1/impedimentos/extensoes/${extensao.id}`;
    const parecer = { conclusao: 'favoravel', texto: 'Há indícios suficientes de sucessão para burlar a sanção; a extensão é juridicamente viável.' };
    assert.equal((await chamar(app, juridico, 'POST', `${base}/parecer`, parecer)).statusCode, 422, 'parecer só depois do contraditório');
    assert.equal((await chamar(app, gestor, 'POST', `${base}/defesa`, { apresentada: false, resumo: null })).statusCode, 422, 'prazo de defesa correndo');
    extensao = (await chamar(app, gestor, 'POST', `${base}/defesa`, { apresentada: true, resumo: 'A empresa alega ser independente da impedida.' })).json<ExtensaoSancao>();
    assert.equal(extensao.situacao, 'analise_juridica');
    assert.equal((await chamar(app, gestor, 'POST', `${base}/parecer`, parecer)).statusCode, 403, 'parecer exige impedimentos:parecer');
    extensao = (await chamar(app, juridico, 'POST', `${base}/parecer`, parecer)).json<ExtensaoSancao>();
    assert.equal(extensao.situacao, 'decisao');
    const decisao = { resultado: 'estender', motivacao: 'Comprovada a sucessão com abuso da personalidade jurídica, acolho o parecer.' };
    const pelaPropositora = await chamar(app, gestor, 'POST', `${base}/decisao`, decisao);
    assert.equal(pelaPropositora.statusCode, 422);
    assert.match(erro(pelaPropositora).mensagem, /não pode ser quem propôs/);
    assert.equal((await chamar(app, juridico, 'POST', `${base}/decisao`, decisao)).statusCode, 403);
    const decidida = await chamar(app, admin, 'POST', `${base}/decisao`, decisao);
    assert.equal(decidida.statusCode, 200, decidida.body);
    extensao = decidida.json<ExtensaoSancao>();
    assert.equal(extensao.situacao, 'estendida');
    assert.ok(extensao.decisao?.sancaoEstendidaId);

    const sancoes = await obterJson<Pagina<Sancao>>(app, gestor, '/api/v1/sancoes?tamanhoPagina=100');
    const estendida = sancoes.itens.find((s) => s.id === extensao.decisao?.sancaoEstendidaId);
    assert.ok(estendida);
    assert.equal(estendida.fornecedor.id, nortelink);
    assert.equal(estendida.situacao, 'aplicada');
    assert.equal(estendida.tipo, 'impedimento_licitar');
    const origem = sancoes.itens.find((s) => s.id === sinal.sancaoOrigemId);
    assert.equal(estendida.fimVigencia, origem?.fimVigencia);
    assert.equal((await chamar(app, gestor, 'POST', `${base}/arquivar`, { motivo: 'Tentativa de arquivar depois da decisão.' })).statusCode, 422);
    const acoes = await app.agora.banco.consultar<{ acao: string }>(
      'SELECT acao FROM auditoria_eventos WHERE recurso_id = $1 OR recurso_id = $2 ORDER BY sequencia',
      [extensao.id, extensao.decisao?.sancaoEstendidaId ?? ''],
    );
    assert.deepEqual(
      acoes.map((a) => a.acao),
      ['impedimentos.extensao.propor', 'impedimentos.extensao.registrar_defesa', 'impedimentos.extensao.registrar_parecer', 'sancao.estender', 'impedimentos.extensao.decidir'],
    );
    const verificacao = await obterJson<VerificacaoAuditoria>(app, admin, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);

    const doFornecedor = await obterJson<VinculosFornecedor>(app, gestor, `/api/v1/impedimentos/fornecedores/${nortecom}`);
    assert.ok(doFornecedor.extensoes.some((x) => x.id === extensao.id));
  });

  test('extensão a administrador da sancionada: pessoa física alcançada só pelo quadro, com CPF mascarado', async () => {
    const nortecom = await idFornecedor(app, 'Nortecom');
    const quadro = await obterJson<VinculosFornecedor>(app, gestor, `/api/v1/impedimentos/fornecedores/${nortecom}`);
    const administrador = quadro.quadro.integrantes.find((i) => i.qualificacao === 'socio_administrador');
    assert.ok(administrador);
    const [origem] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM sancoes WHERE fornecedor_id = $1 AND tipo = 'impedimento_licitar'", [nortecom]);
    assert.ok(origem);
    const r = await chamar(app, gestor, 'POST', '/api/v1/impedimentos/extensoes', {
      sancaoOrigemId: origem.id,
      alvo: 'socio_administrador',
      alvoFornecedorId: null,
      alvoIntegranteId: administrador.id,
      fundamentacao: 'O sócio-administrador conduziu a confusão patrimonial entre a impedida e a empresa nova, conforme o relatório.',
      sinal: null,
      intimacaoEm: app.agora.hoje(),
    });
    assert.equal(r.statusCode, 201, r.body);
    const extensao = r.json<ExtensaoSancao>();
    assert.match(extensao.alvo.pessoa?.documento ?? '', /^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    assert.equal(extensao.alvo.fornecedor, null);
    const arquivada = await chamar(app, gestor, 'POST', `/api/v1/impedimentos/extensoes/${extensao.id}/arquivar`, { motivo: 'Proposta arquivada para instrução em outro processo.' });
    assert.equal(arquivada.json<ExtensaoSancao>().situacao, 'arquivada');
  });

  test('RN-28: agente sem declaração não é designado; depois de declarar, é', async () => {
    const minha = await obterJson<MinhaDeclaracao>(app, financeiro, '/api/v1/impedimentos/declaracoes/minha');
    assert.equal(minha.declaracao, null);
    assert.ok(minha.aptidao.papeis.every((p) => !p.apto));
    assert.equal((await chamar(app, consulta, 'GET', '/api/v1/impedimentos/declaracoes/minha')).statusCode, 403);

    const novo = await chamar(app, agente, 'POST', '/api/v1/processos', { titulo: 'Aquisição de lanternas táticas para patrulhamento', orgao: 'PRF' });
    assert.equal(novo.statusCode, 201);
    const processo = novo.json<ProcessoDetalhe>();
    const designacoes = {
      designacoes: [
        { papel: 'equipe_planejamento', usuarioId: agente.sessao.usuario.id },
        { papel: 'fiscal_tecnico', usuarioId: financeiro.sessao.usuario.id },
      ],
    };
    const recusada = await chamar(app, agente, 'PUT', `/api/v1/processos/${processo.id}/equipe`, designacoes);
    assert.equal(recusada.statusCode, 422);
    const detalhes = erro(recusada).detalhes ?? [];
    assert.ok(detalhes.length > 0 && detalhes.every((d) => d.campo === 'RN-28'));
    assert.match(detalhes[0]?.mensagem ?? '', /^Marcos Teles Coutinho: Não há declaração/);

    const pampa = await idFornecedor(app, 'Pampa');
    const declaracao = {
      semParentescoOuVinculo: true,
      semConflitoInteresses: true,
      vinculo: 'servidor_efetivo',
      cargoMatricula: 'Matrícula 1234567',
      capacitacao: 'atribuicoes',
      capacitacaoDescricao: 'Atribuições de apoio à fiscalização de contratos definidas em portaria.',
      vinculosDeclarados: [{ fornecedorId: pampa, natureza: 'parentesco', grauParentesco: 3, descricao: 'Um primo trabalha como vendedor na empresa.' }],
    };
    assert.equal((await chamar(app, financeiro, 'POST', '/api/v1/impedimentos/declaracoes', { ...declaracao, capacitacaoDescricao: 'curta' })).statusCode, 422);
    const assinada = await chamar(app, financeiro, 'POST', '/api/v1/impedimentos/declaracoes', declaracao);
    assert.equal(assinada.statusCode, 201, assinada.body);
    const corpo = assinada.json<MinhaDeclaracao>();
    assert.equal(corpo.declaracao?.situacao, 'vigente');
    assert.equal(corpo.declaracao?.vinculosDeclarados.length, 1);
    assert.equal(corpo.declaracao?.vinculosDeclarados[0]?.fonte, 'declaracao_agente');
    assert.ok(corpo.aptidao.papeis.find((p) => p.papel === 'fiscal_tecnico')?.apto);
    assert.equal(corpo.aptidao.papeis.find((p) => p.papel === 'pregoeiro')?.apto, true, 'servidora efetiva com atribuições');

    const aceita = await chamar(app, agente, 'PUT', `/api/v1/processos/${processo.id}/equipe`, designacoes);
    assert.equal(aceita.statusCode, 200, aceita.body);

    // O vínculo declarado pela agente vira sinal (RIA-10) quando a empresa é analisada com a equipe do processo.
    const vinculos = await obterJson<VinculoRegistrado[]>(app, gestor, `/api/v1/impedimentos/vinculos?fornecedorId=${pampa}`);
    assert.ok(vinculos.some((v) => v.fonte === 'declaracao_agente' && v.agente?.id === financeiro.sessao.usuario.id));
  });
});

describe('conector do QSA em modo online (fetch falso; nenhum serviço real)', () => {
  const URL_QSA = 'https://qsa.orgao.exemplo/api';
  const chamadas: { url: string; autorizacao: string | null }[] = [];
  let app: FastifyInstance;

  before(async () => {
    app = await criarAppTeste({
      env: { ...SEM_LIMITE, AGORA_INTEGRACOES: 'online', AGORA_QSA_URL: `${URL_QSA}/`, AGORA_QSA_CHAVE: 'chave-de-teste' },
      fetch: async (entrada, init) => {
        const url = String(entrada);
        chamadas.push({ url, autorizacao: new Headers(init?.headers).get('authorization') });
        const cnpj = url.split('/cnpj/')[1] ?? '';
        if (!url.startsWith(`${URL_QSA}/cnpj/`)) return new Response('não encontrado', { status: 404 });
        return Response.json({
          cnpj,
          dataInicioAtividade: '2024-02-01',
          endereco: { logradouro: 'Rua Sintética', numero: '10', bairro: 'Centro', municipio: 'Brasília', uf: 'DF', cep: '70000000' },
          socios: [
            { nome: 'PESSOA FICTICIA UM', cpfCnpj: '***123456**', qualificacao: '49 - Sócio-Administrador', dataEntrada: '2024-02-01' },
            { nome: 'EMPRESA SOCIA LTDA', cpfCnpj: '12345678000190', qualificacao: '22 - Sócio', dataEntrada: null },
          ],
        });
      },
    });
  });
  after(async () => {
    await app.close();
  });

  test('consulta pelo servidor, com a chave do ambiente, guarda só os 6 dígitos centrais e registra a proveniência', async () => {
    const agente = await entrar(app, 'agente@agora.demo');
    const [f] = await app.agora.banco.consultar<{ id: string; documento: string }>("SELECT id, documento FROM fornecedores WHERE razao_social LIKE 'Lumen%'");
    assert.ok(f);
    const r = await chamar(app, agente, 'POST', `/api/v1/impedimentos/fornecedores/${f.id}/qsa`);
    assert.equal(r.statusCode, 200, r.body);
    const quadro = r.json<QuadroSocietario>();
    assert.equal(quadro.proveniencia?.modo, 'online');
    assert.equal(quadro.endereco, 'Rua Sintética, 10, Centro');
    assert.equal(quadro.dataAbertura, '2024-02-01');
    assert.deepEqual(
      quadro.integrantes.map((i) => [i.documento, i.qualificacao]),
      [['***.123.456-**', 'socio_administrador']],
      'sócio pessoa jurídica fica de fora; CPF mascarado',
    );
    assert.deepEqual(chamadas.at(-1), { url: `${URL_QSA}/cnpj/${f.documento}`, autorizacao: 'Bearer chave-de-teste' });
    const [linha] = await app.agora.banco.consultar<{ documento_parcial: string }>('SELECT documento_parcial FROM fornecedores_qsa WHERE fornecedor_id = $1', [f.id]);
    assert.equal(linha?.documento_parcial, '123456');
  });

  test('falha retentável: 3 tentativas e erro de integração; resposta fora do formato também é recusada', async () => {
    let tentativas = 0;
    const indisponivel = async () => {
      tentativas++;
      return new Response('erro', { status: 503 });
    };
    await assert.rejects(
      consultarQsa(app.agora.banco, '12345678000190', { modo: 'online', urlBase: URL_QSA, chave: null, fetch: indisponivel, esperar: async () => {} }, new Date()),
      (e: unknown) => e instanceof ErroIntegracao && /após 3 tentativas/.test(e.message),
    );
    assert.equal(tentativas, 3);
    const foraDoFormato = async () => Response.json({ cnpj: '123' });
    await assert.rejects(
      consultarQsa(app.agora.banco, '12345678000190', { modo: 'online', urlBase: URL_QSA, chave: null, fetch: foraDoFormato, esperar: async () => {} }, new Date()),
      ErroIntegracao,
    );
    assert.equal(categoriaQualificacao('05 - Administrador'), 'administrador');
    assert.equal(categoriaQualificacao('49 - Sócio-Administrador'), 'socio_administrador');
    assert.equal(categoriaQualificacao('22 - Sócio'), 'socio');
  });
});
