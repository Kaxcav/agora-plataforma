/**
 * Frente P (F20): dotação orçamentária estruturada e declaração da autoridade (RN-39), peças complementares da fase
 * preparatória com versões, aprovação, árvore do SEI e PDF (RF-32), e checklist das peças por etapa.
 * Processos sintéticos: "drones" (etapa 4, dotação declarada na carga), "rádios" e "software" (etapa 5) e "coletes" (etapa 6, com amostra).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inflateSync } from 'node:zlib';
import type { ChecklistDocumentosProcesso, DotacaoProcesso, EntradaDotacao, EventoAuditoria, Pagina, ProcessoDetalhe, ProcessoResumo, RespostaErro, VerificacaoAuditoria } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

function regras(resposta: { json<T>(): T }): string[] {
  return (erro(resposta).detalhes ?? []).map((d) => d.campo ?? '');
}

/** Texto das páginas do PDF (fluxos FlateDecode descomprimidos). */
function textoPdf(pdf: Buffer): string {
  const bruto = pdf.toString('latin1');
  const partes: string[] = [];
  for (const m of bruto.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    try {
      partes.push(inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1'));
    } catch {
      // fluxo sem compressão
    }
  }
  return partes.join('\n');
}

describe('frente P: dotação (RN-39), peças complementares e checklist (RF-32)', () => {
  let app: FastifyInstance;
  let agente: Credenciais;
  let planejamento: Credenciais;
  let gestor: Credenciais;
  let admin: Credenciais;
  let juridico: Credenciais;
  let processos: ProcessoResumo[];

  const idDe = (fragmento: string): string => {
    const p = processos.find((x) => x.titulo.toLowerCase().includes(fragmento));
    if (!p) throw new Error(`Processo não encontrado: ${fragmento}`);
    return p.id;
  };
  const detalhe = (id: string) => obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${id}`);
  const dotacao = (id: string, credenciais: Credenciais = agente) => obterJson<DotacaoProcesso>(app, credenciais, `/api/v1/processos/${id}/dotacao`);
  const gerar = async (credenciais: Credenciais, id: string, tipo: string) => {
    const r = await chamar(app, credenciais, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo });
    assert.equal(r.statusCode, 200, `gerar ${tipo}: ${r.body}`);
    const doc = r.json<ProcessoDetalhe>().documentos.find((d) => d.tipo === tipo);
    assert.ok(doc, tipo);
    return doc;
  };
  const rn39 = (p: ProcessoDetalhe) => p.bloqueiosDetalhe.filter((b) => b.regra === 'RN-39').map((b) => b.mensagem);

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    agente = await entrar(app, 'agente@agora.demo');
    planejamento = await entrar(app, 'planejamento@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    admin = await entrar(app, 'admin@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
  });
  after(async () => {
    await app.close();
  });

  test('carga sintética: dotação declarada pela autoridade nos processos da etapa 4 em diante, com TR e minuta antigos acusados', async () => {
    for (const fragmento of ['drones', 'rádios', 'software', 'coletes', 'viaturas']) {
      const d = await dotacao(idDe(fragmento));
      assert.equal(d.linhas.length, 1, fragmento);
      assert.equal(d.valida, true, `${fragmento}: ${d.pendencias.join('; ')}`);
      assert.equal(d.declarada, true, fragmento);
      assert.equal(d.declaracao.situacao, 'aprovada');
      assert.equal(d.declaracao.aprovadaPor?.nome, gestor.sessao.usuario.nome);
      assert.match(d.declaracao.numeroSei ?? '', /^\d{8}$/);
      assert.match(d.linhas[0]?.programaTrabalho ?? '', /^06\.\d{3}\.\d{4}\.AG\d{2}\.0001$/);
    }
    const scanners = await dotacao(idDe('scanners'));
    assert.deepEqual(scanners.linhas, []);
    assert.equal(scanners.declaracao.situacao, 'nao_gerada');
    assert.equal(scanners.editavel, true);
    assert.equal((await dotacao(idDe('rádios'))).editavel, false, 'etapa 5: a dotação fica travada');

    const drones = await detalhe(idDe('drones'));
    assert.deepEqual(rn39(drones), [
      '"Termo de Referência" (versão 1) não traz a dotação declarada: gere nova versão e aprove.',
      '"Minuta do Contrato" (versão 1) não traz a dotação declarada: gere nova versão e aprove.',
    ]);
    assert.ok(drones.bloqueiosDetalhe.filter((b) => b.regra === 'RN-39').every((b) => b.etapa === 4 && /art\. 150/.test(b.fundamento)));
    assert.ok(drones.arvoreSei.every((a) => a.assinado), 'a declaração da carga está assinada');
    assert.equal((await detalhe(idDe('rádios'))).bloqueiosDetalhe.filter((b) => b.regra === 'RN-39').length, 0, 'a RN-39 só se aplica à etapa 4');
  });

  test('PUT /dotacao: formato conferido no servidor, permissão, escopo e etapa', async () => {
    const id = idDe('drones');
    const linha = { unidadeGestora: '910001', programaTrabalho: '06.181.9990.AG99.0001', naturezaDespesa: '4.4.90.52', fonteRecursos: '1001000000', exercicio: 2026, valor: 10_000, preEmpenho: null };
    const invalidos = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/dotacao`, { linhas: [{ ...linha, unidadeGestora: '12', naturezaDespesa: '9.9.90.52' }] });
    assert.equal(invalidos.statusCode, 400);
    assert.equal(erro(invalidos).codigo, 'VALIDACAO');
    assert.equal((await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/dotacao`, { linhas: Array.from({ length: 21 }, () => linha) })).statusCode, 400);
    assert.equal((await chamar(app, gestor, 'PUT', `/api/v1/processos/${id}/dotacao`, { linhas: [linha] })).statusCode, 403, 'gestor não edita a dotação');
    const etapa5 = await chamar(app, agente, 'PUT', `/api/v1/processos/${idDe('rádios')}/dotacao`, { linhas: [linha] });
    assert.equal(etapa5.statusCode, 422);
    assert.match(erro(etapa5).mensagem, /fase preparatória/);
    assert.equal((await chamar(app, agente, 'PUT', '/api/v1/processos/00000000-0000-4000-8000-000000000000/dotacao', { linhas: [linha] })).statusCode, 404);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${id}/dotacao`)).statusCode, 403);
  });

  test('mudar a dotação desatualiza a declaração; a autoridade designada aprova a nova, e só ela', async () => {
    const id = idDe('drones');
    const atual = await dotacao(id);
    const ano = atual.exercicioReferencia;
    const entrada: EntradaDotacao = {
      linhas: [
        { ...atual.linhas[0]!, naturezaDespesa: '449052', programaTrabalho: '061819010ag010001', preEmpenho: null },
        { unidadeGestora: '910001', programaTrabalho: '06.181.9010.AG01.0001', naturezaDespesa: '3.3.90.30', fonteRecursos: '1001000000', exercicio: ano + 1, valor: 500_000, preEmpenho: null },
      ],
    };
    const r = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/dotacao`, entrada);
    assert.equal(r.statusCode, 200, r.body);
    const salva = r.json<DotacaoProcesso>();
    assert.equal(salva.linhas[0]?.naturezaDespesa, '4.4.90.52', 'normalizada no servidor');
    assert.equal(salva.linhas[0]?.programaTrabalho, '06.181.9010.AG01.0001', 'programa de trabalho no formato padrão');
    assert.equal(salva.valida, true, salva.pendencias.join('; '));
    assert.equal(salva.totalExercicio, atual.linhas[0]?.valor);
    assert.equal(salva.declaracao.situacao, 'desatualizada');
    assert.equal(salva.declarada, false);
    assert.equal(salva.registradaPor?.nome, agente.sessao.usuario.nome);
    const p = await detalhe(id);
    assert.ok(rn39(p).some((m) => m.includes('A dotação mudou depois da declaração')));

    // Declaração gerada com a dotação antiga não pode ser aprovada nem pela autoridade.
    const antiga = p.documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
    assert.ok(antiga);
    const nova = await gerar(agente, id, 'declaracao_orcamentaria');
    assert.equal(nova.versao, 2);
    assert.match(nova.conteudo, /DECLARO que a despesa decorrente desta contratação tem adequação orçamentária/);
    assert.match(nova.conteudo, /\| 2 \| 910001 \| 06\.181\.9010\.AG01\.0001 \| 3\.3\.90\.30 \|/);
    assert.match(nova.conteudo, /<!-- dotacao:[0-9a-f]{64} -->/);
    assert.equal(nova.geradoPor, 'modelo');

    const peloAgente = await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${nova.id}/aprovar`);
    assert.equal(peloAgente.statusCode, 403, 'o agente não tem jornada:autorizar');
    const peloAdmin = await chamar(app, admin, 'POST', `/api/v1/processos/${id}/documentos/${nova.id}/aprovar`);
    assert.equal(peloAdmin.statusCode, 403, 'o administrador não é a autoridade designada');
    assert.match(erro(peloAdmin).mensagem, /autoridade competente designada/);
    const aprovada = await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/documentos/${nova.id}/aprovar`);
    assert.equal(aprovada.statusCode, 200, aprovada.body);
    const numero = aprovada.json<ProcessoDetalhe>().documentos.find((d) => d.id === nova.id)?.numeroSei ?? '';
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/sei/assinar`, { documentoNumero: numero })).statusCode, 403, 'só a autoridade assina');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/sei/assinar`, { documentoNumero: numero })).statusCode, 200);
    const declarada = await dotacao(id);
    assert.equal(declarada.declarada, true);
    assert.equal(declarada.declaracao.versao, 2);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.dotacao.atualizar&tamanhoPagina=50');
    const evento = trilha.itens.find((e) => e.recursoId === id && /deixa de valer/.test(e.resumo));
    assert.ok(evento, 'a alteração da dotação fica na trilha');
  });

  test('declaração com dotação inválida não é aprovada (RN-39); TR e minuta novos trazem a dotação e liberam o avanço', async () => {
    const id = idDe('drones');
    const atual = await dotacao(id);
    const passado = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/dotacao`, { linhas: [{ ...atual.linhas[0]!, exercicio: atual.exercicioReferencia - 1, preEmpenho: null }] });
    assert.equal(passado.statusCode, 200);
    assert.equal(passado.json<DotacaoProcesso>().valida, false);
    const invalida = await gerar(agente, id, 'declaracao_orcamentaria');
    assert.match(invalida.conteudo, /Pendências da dotação/);
    const recusada = await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/documentos/${invalida.id}/aprovar`);
    assert.equal(recusada.statusCode, 422);
    assert.ok(regras(recusada).every((r) => r === 'RN-39') && regras(recusada).length >= 2);

    const corrigida = await chamar(app, agente, 'PUT', `/api/v1/processos/${id}/dotacao`, { linhas: atual.linhas });
    assert.equal(corrigida.json<DotacaoProcesso>().valida, true);
    const declaracao = await gerar(agente, id, 'declaracao_orcamentaria');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/documentos/${declaracao.id}/aprovar`)).statusCode, 200);

    const tr = await gerar(agente, id, 'tr');
    assert.match(tr.conteudo, /## j\) Adequação orçamentária/);
    assert.match(tr.conteudo, /<!-- protegido:dotacao_orcamentaria -->/);
    assert.match(tr.conteudo, /\| Linha \| Unidade gestora \| Programa de trabalho \| Natureza da despesa \| Fonte \| Exercício \| Valor \| Pré-empenho \|/);
    let p = await detalhe(id);
    assert.deepEqual(rn39(p), ['"Minuta do Contrato" (versão 1) não traz a dotação declarada: gere nova versão e aprove.']);
    const minuta = await gerar(agente, id, 'minuta_contrato');
    assert.match(minuta.conteudo, /CLÁUSULA OITAVA — DO CRÉDITO ORÇAMENTÁRIO \(art\. 92, VIII\)/);
    assert.match(minuta.conteudo, /natureza da despesa 4\.4\.90\.52/);
    assert.match(minuta.conteudo, /apostilamento \(art\. 136, IV\)/);
    p = await detalhe(id);
    assert.deepEqual(rn39(p), []);
  });

  test('portaria de designação: equipe, declarações dos agentes e segregação; aprovada e assinada pela autoridade', async () => {
    const id = idDe('drones');
    const portaria = await gerar(planejamento, id, 'portaria_designacao');
    assert.match(portaria.conteudo, /\*\*PORTARIA Nº/);
    assert.match(portaria.conteudo, /arts\. 7º e 8º da Lei 14\.133\/2021/);
    assert.match(portaria.conteudo, new RegExp(`\\| Agente de contratação \\| ${agente.sessao.usuario.nome} \\|`));
    assert.match(portaria.conteudo, /Vigente até \d{2}\/\d{2}\/\d{4}/);
    assert.match(portaria.conteudo, /não encontrou acúmulo de funções conflitantes/);
    assert.doesNotMatch(portaria.conteudo, /\d{3}\.\d{3}\.\d{3}-\d{2}|@agora\.demo/, 'sem CPF nem e-mail');
    assert.equal(portaria.geradoPor, 'modelo');
    assert.equal((await chamar(app, planejamento, 'POST', `/api/v1/processos/${id}/documentos/${portaria.id}/aprovar`)).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/documentos/${portaria.id}/aprovar`)).statusCode, 200);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/processos/${id}/documentos/gerar`, { tipo: 'portaria_designacao' })).statusCode, 403, 'a autoridade aprova, não redige');
  });

  test('anexos operacionais: proposta, ordem de fornecimento, sigilo e recebimentos, aprovados pela equipe', async () => {
    const id = idDe('drones');
    const casos: [string, RegExp[]][] = [
      ['modelo_proposta', [/art\. 63, § 1º/, /\[preencher: valor unitário \(r\$\)\]/, /Lei Complementar 123\/2006/]],
      ['ordem_servico', [/ORDEM DE FORNECIMENTO/, /art\. 92, § 2º/, /Gestor do contrato/]],
      ['termo_sigilo', [/TERMO DE COMPROMISSO E DE SIGILO/, /Lei 13\.709\/2018, art\. 48/, /art\. 13/]],
      ['termo_recebimento_provisorio', [/TERMO DE RECEBIMENTO PROVISÓRIO/, /art\. 140, II, "a"/, /de forma sumária/]],
      ['termo_recebimento_definitivo', [/TERMO DE RECEBIMENTO DEFINITIVO/, /art\. 140, II, "b"/, /ordem cronológica/]],
    ];
    for (const [tipo, esperados] of casos) {
      const doc = await gerar(agente, id, tipo);
      for (const esperado of esperados) assert.match(doc.conteudo, esperado, tipo);
      assert.doesNotMatch(doc.conteudo, /R\$ \d/, `${tipo}: sem o valor estimado da Administração`);
      assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${id}/documentos/${doc.id}/aprovar`)).statusCode, 200, tipo);
    }
  });

  test('nota técnica à assessoria jurídica: síntese, instrução e quesitos objetivos gerados dos dados do processo', async () => {
    const id = idDe('drones');
    const nota = await gerar(agente, id, 'nota_tecnica_conjur');
    assert.match(nota.conteudo, /## 3\. Quesitos ao controle prévio de legalidade/);
    assert.match(nota.conteudo, /<!-- protegido:quesitos -->/);
    assert.match(nota.conteudo, /^1\. A instrução reúne os elementos da fase preparatória/m);
    assert.match(nota.conteudo, /\(Lei 14\.133\/2021, art\. 6º, XXIII, "j", e art\. 150\)\. \*Motivo: Dotação declarada/);
    assert.match(nota.conteudo, /\| Critério de julgamento \| menor preço \|/, 'parâmetros do edital do processo');
    assert.match(nota.conteudo, /não contém juízo jurídico/);
    assert.match(nota.conteudo, /\| Declaração de adequação orçamentária \| Pronta \(versão \d\)/);
  });

  test('despacho de autorização: só com a dotação declarada, aprovado pela autoridade; parecer muda a decisão sugerida', async () => {
    const drones = idDe('drones');
    const despacho = await gerar(agente, drones, 'despacho_autorizacao');
    assert.match(despacho.conteudo, /AUTORIZO o encaminhamento do processo à assessoria jurídica/);
    assert.match(despacho.conteudo, /<!-- protegido:decisao_autoridade -->/);
    const atual = await dotacao(drones);
    await chamar(app, agente, 'PUT', `/api/v1/processos/${drones}/dotacao`, { linhas: [{ ...atual.linhas[0]!, valor: atual.linhas[0]!.valor + 100 }] });
    const semDeclaracao = await chamar(app, gestor, 'POST', `/api/v1/processos/${drones}/documentos/${despacho.id}/aprovar`);
    assert.equal(semDeclaracao.statusCode, 422);
    assert.match(JSON.stringify(semDeclaracao.json()), /Aprove antes a declaração de adequação orçamentária/);
    await chamar(app, agente, 'PUT', `/api/v1/processos/${drones}/dotacao`, { linhas: atual.linhas });
    // A dotação voltou à mesma chave: a declaração aprovada volta a valer, sem nova versão.
    assert.equal((await dotacao(drones)).declarada, true);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/processos/${drones}/documentos/${despacho.id}/aprovar`)).statusCode, 200);

    const radios = idDe('rádios');
    const comParecer = await gerar(agente, radios, 'despacho_autorizacao');
    assert.match(comParecer.conteudo, /AUTORIZO a realização da licitação, determinando a divulgação do edital/);
  });

  test('caderno da prova de conceito: casos do roteiro, planilha da comissão e convocações; sem exigência, não se aplica', async () => {
    const coletes = idDe('coletes');
    const caderno = await gerar(agente, coletes, 'caderno_prova_conceito');
    assert.match(caderno.conteudo, /\| CT-01 \| Entrega de 2 coletes/);
    assert.match(caderno.conteudo, /## 3\. Planilha de julgamento da comissão/);
    assert.match(caderno.conteudo, /<!-- protegido:julgamento -->/);
    assert.match(caderno.conteudo, /aprovado somente se todos os casos \(1\) forem atendidos/);
    assert.match(caderno.conteudo, /art\. 17, § 2º/);
    assert.equal(caderno.geradoPor, 'modelo');
    const drones = await gerar(agente, idDe('drones'), 'caderno_prova_conceito');
    assert.match(drones.conteudo, /não exigem prova de conceito nem amostra/);
  });

  test('checklist das peças por etapa: prontas, desatualizadas e faltantes; também como documento', async () => {
    const id = idDe('drones');
    const checklist = await obterJson<ChecklistDocumentosProcesso>(app, agente, `/api/v1/processos/${id}/checklist-documentos`);
    assert.equal(checklist.etapaAtual, 4);
    assert.deepEqual(
      checklist.etapas.map((e) => e.etapa),
      [1, 2, 3, 4, 5],
    );
    const item = (tipo: string) => checklist.etapas.flatMap((e) => e.itens).find((i) => i.tipo === tipo);
    assert.equal(item('dfd')?.situacao, 'pronta');
    assert.equal(item('dfd')?.assinado, true);
    assert.equal(item('portaria_designacao')?.situacao, 'pronta');
    assert.equal(item('portaria_designacao')?.assinado, false);
    assert.equal(item('declaracao_orcamentaria')?.situacao, 'pronta');
    assert.equal(item('tr')?.situacao, 'rascunho', 'TR regerado, ainda sem aprovação');
    assert.equal(item('caderno_prova_conceito')?.situacao, 'nao_aplicavel');
    assert.equal(item('parecer_checklist')?.situacao, 'falta');
    assert.ok(checklist.faltantes >= 4);
    assert.equal(checklist.prontas, checklist.etapas.reduce((s, e) => s + e.prontas, 0));
    const doc = await gerar(agente, id, 'checklist_documentos');
    assert.match(doc.conteudo, /## Etapa 4 — TR, edital e minuta/);
    assert.match(doc.conteudo, /\| Declaração de adequação orçamentária \| Obrigatória \| Pronta/);
    const consulta = await entrar(app, 'consulta@agora.demo');
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/processos/${id}/checklist-documentos`)).statusCode, 403);
  });

  test('checklist do parecer (art. 53) usa a declaração como evidência da previsão orçamentária', async () => {
    const parecer = await gerar(juridico, idDe('software'), 'parecer_checklist');
    assert.match(parecer.conteudo, /Previsão de recursos orçamentários .*1 crédito\(s\) orçamentário\(s\) indicado\(s\); declaração de adequação orçamentária aprovada por/);
  });

  test('PDF do documento: gerado no servidor, sem marcadores internos, com as tabelas em lista; escopo e 404', async () => {
    const id = idDe('drones');
    const declaracao = (await detalhe(id)).documentos.find((d) => d.tipo === 'declaracao_orcamentaria');
    assert.ok(declaracao);
    const r = await chamar(app, agente, 'GET', `/api/v1/processos/${id}/documentos/${declaracao.id}/pdf`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.match(String(r.headers['content-disposition']), /declaracao-orcamentaria-v\d+-\d+\.pdf/);
    const pdf = r.rawPayload;
    assert.ok(pdf.toString('latin1').startsWith('%PDF-1.4'));
    const texto = textoPdf(pdf);
    assert.match(texto, /Unidade gestora: 9\d{5}/);
    assert.doesNotMatch(texto, /<!--|protegido|dotacao:/);
    assert.equal((await chamar(app, agente, 'GET', `/api/v1/processos/${idDe('rádios')}/documentos/${declaracao.id}/pdf`)).statusCode, 404, 'documento de outro processo');
    assert.equal((await chamar(app, agente, 'GET', `/api/v1/processos/${id}/documentos/123/pdf`)).statusCode, 404);
  });

  test('trilha de auditoria íntegra depois das escritas', async () => {
    const auditor = await entrar(app, 'auditor@agora.demo');
    const verificacao = await obterJson<VerificacaoAuditoria>(app, auditor, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);
    const aprovacoes = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.documento.aprovar&tamanhoPagina=100');
    assert.ok(aprovacoes.itens.some((e) => e.usuario?.id === gestor.sessao.usuario.id && /Declaração de Adequação Orçamentária/.test(e.resumo)));
  });
});
