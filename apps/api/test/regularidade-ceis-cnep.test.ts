import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adicionarDias, hojeISO } from '@agora/dominio';
import type {
  CertidaoRegistrada,
  ChecklistRegularidade,
  Pagina,
  Pendencia,
  ProcessoDetalhe,
  ProcessoResumo,
  RegistroSancaoCeisCnep,
  RespostaAtesto,
  RespostaErro,
  RespostaProrrogacao,
  VerificacaoAuditoria,
  VerificacaoRegularidade,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { carregarConfig } from '../src/config.ts';
import { ErroIntegracao } from '../src/integracoes/conector.ts';
import {
  consultarCadastrosOnline,
  consultarCadastrosSancoes,
  dataDoPortal,
  FONTE_SIMULADA,
  FONTE_TRANSPARENCIA,
} from '../src/integracoes/transparencia.ts';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, type Credenciais } from './apoio.ts';
import { concluirSelecao } from './apoio-selecao.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const HOJE = hojeISO(new Date(INICIO_TESTES));

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

async function idFornecedor(app: FastifyInstance, prefixo: string): Promise<{ id: string; documento: string }> {
  const [linha] = await app.agora.banco.consultar<{ id: string; documento: string }>('SELECT id, documento FROM fornecedores WHERE razao_social LIKE $1', [
    `${prefixo}%`,
  ]);
  if (!linha) throw new Error(`Fornecedor não encontrado: ${prefixo}`);
  return linha;
}

async function eventos(app: FastifyInstance, acao: string): Promise<{ recurso_id: string | null; dados: Record<string, unknown> }[]> {
  return app.agora.banco.consultar('SELECT recurso_id, dados FROM auditoria_eventos WHERE acao = $1 ORDER BY sequencia', [acao]);
}

describe('regularidade do contratado (modo offline): CEIS/CNEP simulados, certidões e travas', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let gestor: Credenciais;
  let agente: Credenciais;
  let financeiro: Credenciais;
  let juridico: Credenciais;
  let consulta: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    admin = await entrar(app, 'admin@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    agente = await entrar(app, 'agente@agora.demo');
    financeiro = await entrar(app, 'financeiro@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  test('carga sintética: certidões para todos, base simulada e primeira consulta com proveniência', async () => {
    const [contagem] = await app.agora.banco.consultar<{ fornecedores: number; certidoes: number; consultas: number }>(
      `SELECT (SELECT COUNT(*)::integer FROM fornecedores) AS fornecedores,
              (SELECT COUNT(*)::integer FROM certidoes_regularidade) AS certidoes,
              (SELECT COUNT(*)::integer FROM consultas_ceis_cnep WHERE motivo = 'carga') AS consultas`,
    );
    assert.ok(contagem);
    assert.equal(contagem.certidoes, contagem.fornecedores * 3);
    assert.equal(contagem.consultas, contagem.fornecedores);
  });

  test('checklist do fornecedor (RF-20): sanção vigente no CEIS, atenção por abrangência, certidão a vencer e fornecedor regular', async () => {
    const mirante = await idFornecedor(app, 'Mirante');
    const sancionado = await obterJson<ChecklistRegularidade>(app, gestor, `/api/v1/fornecedores/${mirante.id}/regularidade`);
    assert.equal(sancionado.regular, false);
    assert.equal(sancionado.momento, 'assinatura');
    const ceis = sancionado.itens.find((i) => i.id === 'ceis_cnep');
    assert.equal(ceis?.situacao, 'impeditivo');
    assert.equal(ceis?.fonte, FONTE_SIMULADA);
    assert.ok(ceis?.referencia, 'data da consulta');
    assert.match(sancionado.motivos[0] ?? '', /^CEIS: Inidoneidade/);
    assert.equal(sancionado.consulta?.modo, 'offline');
    assert.match(sancionado.consulta?.hashConteudo ?? '', /^[0-9a-f]{64}$/);
    assert.equal(sancionado.consulta?.registros[0]?.impeditivo, true);
    assert.match(sancionado.fornecedor.documento, /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'CNPJ formatado');

    const aria = await obterJson<ChecklistRegularidade>(app, gestor, `/api/v1/fornecedores/${(await idFornecedor(app, 'Ária')).id}/regularidade`);
    assert.equal(aria.regular, true);
    assert.equal(aria.itens[0]?.situacao, 'atencao');
    assert.match(aria.avisos.join(' '), /art\. 156, § 4º/);

    const lumen = await obterJson<ChecklistRegularidade>(app, gestor, `/api/v1/fornecedores/${(await idFornecedor(app, 'Lumen')).id}/regularidade`);
    assert.equal(lumen.regular, true);
    assert.equal(lumen.itens.find((i) => i.id === 'fgts')?.situacao, 'atencao');

    const rota = await obterJson<ChecklistRegularidade>(app, gestor, `/api/v1/fornecedores/${(await idFornecedor(app, 'Rota Segura')).id}/regularidade`);
    assert.equal(rota.regular, true);
    assert.ok(rota.itens.every((i) => i.situacao === 'conforme'));

    // O detalhe do fornecedor usa o mesmo checklist (RN-09).
    const detalhe = await obterJson<{ regularidade: { regular: boolean; motivos: string[]; fontes: string[] } }>(app, gestor, `/api/v1/fornecedores/${mirante.id}`);
    assert.equal(detalhe.regularidade.regular, false);
    assert.ok(detalhe.regularidade.fontes.includes(FONTE_SIMULADA));
    assert.equal((await chamar(app, gestor, 'GET', `/api/v1/fornecedores/${mirante.id}/regularidade?momento=outro`)).statusCode, 400);
  });

  test('consulta a pedido do agente: nova consulta, verificação registrada e trilha; sem permissão → 403', async () => {
    const rota = await idFornecedor(app, 'Rota Segura');
    const antes = (await eventos(app, 'regularidade.consultar')).length;
    const r = await chamar(app, agente, 'POST', `/api/v1/fornecedores/${rota.id}/regularidade/consultar`, {});
    assert.equal(r.statusCode, 200);
    const v = r.json<VerificacaoRegularidade>();
    assert.equal(v.regular, true);
    assert.deepEqual(v.instrumento, { tipo: 'fornecedor', id: rota.id });
    assert.equal(v.verificadoPor?.id, agente.sessao.usuario.id);
    assert.equal(v.consulta?.fonte, FONTE_SIMULADA);
    assert.ok(Date.parse(v.consulta?.consultadoEm ?? '') >= INICIO_TESTES, 'consulta nova');
    assert.equal((await eventos(app, 'regularidade.consultar')).length, antes + 1);
    const verificacoes = await eventos(app, 'regularidade.verificar');
    assert.equal(verificacoes.at(-1)?.dados.verificacaoId, v.id);

    for (const credenciais of [juridico, consulta]) {
      assert.equal((await chamar(app, credenciais, 'POST', `/api/v1/fornecedores/${rota.id}/regularidade/consultar`, {})).statusCode, 403);
    }
    assert.equal((await chamar(app, consulta, 'GET', `/api/v1/fornecedores/${rota.id}/regularidade`)).statusCode, 200);

    const pdf = await chamar(app, gestor, 'GET', `/api/v1/regularidade/verificacoes/${v.id}/comprovante.pdf`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.ok(pdf.rawPayload.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/regularidade/verificacoes/00000000-0000-4000-8000-000000000000/comprovante.pdf')).statusCode, 404);
  });

  test('registro de certidão conferida: validação do domínio, confirmação de conferência, trilha e permissão', async () => {
    const lumen = await idFornecedor(app, 'Lumen');
    const base = {
      tipo: 'fgts',
      numero: 'CRF-2026-TESTE-01',
      emissor: 'Caixa Econômica Federal',
      emitidaEm: HOJE,
      validaAte: adicionarDias(HOJE, 30),
      resultado: 'negativa',
      conferida: true,
    };
    const criada = await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${lumen.id}/certidoes`, base);
    assert.equal(criada.statusCode, 201);
    const certidao = criada.json<CertidaoRegistrada>();
    assert.equal(certidao.situacao, 'valida');
    assert.equal(certidao.diasRestantes, 30);
    assert.equal(certidao.conferidaPor?.id, gestor.sessao.usuario.id);
    const lista = await obterJson<CertidaoRegistrada[]>(app, gestor, `/api/v1/fornecedores/${lumen.id}/certidoes`);
    assert.equal(lista[0]?.id, certidao.id, 'mais recente primeiro');
    const checklist = await obterJson<ChecklistRegularidade>(app, gestor, `/api/v1/fornecedores/${lumen.id}/regularidade`);
    assert.equal(checklist.itens.find((i) => i.id === 'fgts')?.situacao, 'conforme', 'a certidão nova substitui a que vencia');
    assert.equal((await eventos(app, 'certidao.registrar')).at(-1)?.dados.certidaoId, certidao.id);

    const longa = await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${lumen.id}/certidoes`, { ...base, validaAte: adicionarDias(HOJE, 45) });
    assert.equal(longa.statusCode, 422);
    assert.equal(erro(longa).detalhes?.[0]?.campo, 'CERTIDAO_INVALIDA');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${lumen.id}/certidoes`, { ...base, emitidaEm: adicionarDias(HOJE, 1), validaAte: adicionarDias(HOJE, 10) })).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/fornecedores/${lumen.id}/certidoes`, { ...base, conferida: false })).statusCode, 400);
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/fornecedores/${lumen.id}/certidoes`, base)).statusCode, 403);
    assert.equal((await chamar(app, gestor, 'POST', '/api/v1/fornecedores/00000000-0000-4000-8000-000000000000/certidoes', base)).statusCode, 404);
  });

  test('PoC-04: contratar com CNPJ que tem sanção vigente no CEIS é bloqueado (RN-09), com a fonte, e a tentativa fica registrada', async () => {
    const processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
    const radios = processos.find((p) => p.titulo.toLowerCase().includes('rádios'));
    assert.ok(radios);
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/avancar`)).statusCode, 200, 'etapa 5 → 6');
    const mirante = await idFornecedor(app, 'Mirante');
    const vigilant = await idFornecedor(app, 'Vigilant');
    const disputa = await chamar(app, agente, 'PUT', `/api/v1/processos/${radios.id}/disputa`, {
      licitantes: [
        { id: mirante.id, valorProposta: 780_000_000 },
        { id: vigilant.id, valorProposta: 790_000_000 },
      ],
    });
    assert.equal(disputa.statusCode, 200);
    // Atos da seleção até a homologação (RN-20, RN-22 e RF-18), pela autoridade competente designada (gestor).
    await concluirSelecao(app, radios.id, agente, gestor);
    // A habilitação da etapa 6 confere as sanções do próprio órgão; o CEIS/CNEP é consultado na assinatura.
    assert.equal((await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/avancar`)).statusCode, 200, 'etapa 6 → 7');

    const detalhe = await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${radios.id}`);
    assert.ok(detalhe.bloqueiosDetalhe.some((b) => b.regra === 'RN-09' && /CEIS: Inidoneidade/.test(b.mensagem)), 'bloqueio já visível na etapa 7');

    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${radios.id}/contratar`);
    assert.equal(r.statusCode, 422);
    assert.equal(erro(r).codigo, 'REGRA_NEGOCIO');
    assert.match(erro(r).mensagem, /RN-09, art\. 91, § 4º/);
    assert.ok((erro(r).detalhes ?? []).every((d) => d.campo === 'RN-09'));
    assert.match(JSON.stringify(erro(r).detalhes), /CEIS: Inidoneidade - Lei 14\.133\/2021, aplicada por Órgão federal de demonstração/);
    assert.equal((await obterJson<ProcessoDetalhe>(app, agente, `/api/v1/processos/${radios.id}`)).contratoGerado, null);

    const [registrada] = await app.agora.banco.consultar<{ bloqueia: boolean; momento: string; consulta_id: string | null; resultado: ChecklistRegularidade }>(
      `SELECT bloqueia, momento, consulta_id, resultado FROM verificacoes_regularidade
        WHERE instrumento_tipo = 'processo' AND instrumento_id = $1 ORDER BY verificado_em DESC LIMIT 1`,
      [radios.id],
    );
    assert.ok(registrada);
    assert.equal(registrada.bloqueia, true);
    assert.equal(registrada.momento, 'assinatura');
    assert.ok(registrada.consulta_id, 'consulta usada fica vinculada');
    assert.equal(registrada.resultado.consulta?.fonte, FONTE_SIMULADA);
    const auditoria = (await eventos(app, 'regularidade.verificar')).filter((e) => e.recurso_id === radios.id);
    assert.equal(auditoria.at(-1)?.dados.bloqueia, true);
  });

  test('contratar com vencedor regular registra a verificação e o contrato (viaturas)', async () => {
    const processos = (await obterJson<Pagina<ProcessoResumo>>(app, agente, '/api/v1/processos?tamanhoPagina=100')).itens;
    const viaturas = processos.find((p) => p.titulo.toLowerCase().includes('viaturas'));
    assert.ok(viaturas);
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${viaturas.id}/contratar`);
    assert.equal(r.statusCode, 200, r.body);
    const [contratar] = (await eventos(app, 'processo.contratar')).filter((e) => e.recurso_id === viaturas.id);
    assert.ok((contratar?.dados.regularidade as { verificacaoId: string | null }).verificacaoId);
  });

  test('prorrogação (RN-09): certidão vencida bloqueia; nova certidão conferida libera e registra o termo aditivo', async () => {
    const metropolitana = await idFornecedor(app, 'Metropolitana');
    const [contrato] = await app.agora.banco.consultar<{ id: string; vigencia_fim: string }>(
      'SELECT id, vigencia_fim FROM contratos WHERE fornecedor_id = $1 ORDER BY vigencia_fim DESC LIMIT 1',
      [metropolitana.id],
    );
    assert.ok(contrato);
    const previa = await obterJson<ChecklistRegularidade>(app, admin, `/api/v1/contratos/${contrato.id}/regularidade`);
    assert.equal(previa.momento, 'prorrogacao');
    assert.equal(previa.bloqueia, true);

    const corpo = { novaVigenciaFim: adicionarDias(contrato.vigencia_fim, 365), valor: 0, justificativa: 'Prorrogação por mais 12 meses: serviço contínuo com preços vantajosos (art. 107).' };
    const bloqueada = await chamar(app, admin, 'POST', `/api/v1/contratos/${contrato.id}/prorrogacoes`, corpo);
    assert.equal(bloqueada.statusCode, 422);
    assert.match(JSON.stringify(erro(bloqueada).detalhes), /CNDT .*validade expirada/);
    assert.ok((erro(bloqueada).detalhes ?? []).every((d) => d.campo === 'RN-09'));
    assert.equal((await chamar(app, admin, 'POST', `/api/v1/contratos/${contrato.id}/prorrogacoes`, { ...corpo, novaVigenciaFim: contrato.vigencia_fim })).statusCode, 422);
    assert.equal((await chamar(app, financeiro, 'POST', `/api/v1/contratos/${contrato.id}/prorrogacoes`, corpo)).statusCode, 403);

    const cndt = await chamar(app, admin, 'POST', `/api/v1/fornecedores/${metropolitana.id}/certidoes`, {
      tipo: 'trabalhista',
      numero: 'CNDT-TESTE-0001',
      emissor: 'Tribunal Superior do Trabalho',
      emitidaEm: HOJE,
      validaAte: adicionarDias(HOJE, 180),
      resultado: 'negativa',
      conferida: true,
    });
    assert.equal(cndt.statusCode, 201);
    const ok = await chamar(app, admin, 'POST', `/api/v1/contratos/${contrato.id}/prorrogacoes`, corpo);
    assert.equal(ok.statusCode, 201, ok.body);
    const resposta = ok.json<RespostaProrrogacao>();
    assert.equal(resposta.aditivo.tipo, 'prorrogacao');
    assert.equal(resposta.aditivo.novaVigenciaFim, corpo.novaVigenciaFim);
    assert.equal(resposta.verificacao.regular, true);
    assert.equal(resposta.verificacao.momento, 'prorrogacao');
    const [atualizado] = await app.agora.banco.consultar<{ vigencia_fim: string; campos_editados: string[] }>(
      'SELECT vigencia_fim, campos_editados FROM contratos WHERE id = $1',
      [contrato.id],
    );
    assert.equal(atualizado?.vigencia_fim, corpo.novaVigenciaFim);
    assert.ok(atualizado?.campos_editados.includes('vigencia_fim'), 'a sincronização não sobrescreve a vigência prorrogada');
    const historico = await obterJson<{ acao: string }[]>(app, admin, `/api/v1/contratos/${contrato.id}/historico`);
    assert.ok(historico.some((h) => /prorrogação/.test(h.acao)));
    assert.ok(historico.some((h) => /Verificou a regularidade/.test(h.acao)));
  });

  test('RN-23: atesto rechecado — irregular abre pendência sem impedir o atesto; regular atesta sem pendência', async () => {
    const pagamentoDe = async (prefixo: string) => {
      const [linha] = await app.agora.banco.consultar<{ id: string; contrato_id: string }>(
        `SELECT p.id, p.contrato_id FROM pagamentos p JOIN contratos c ON c.id = p.contrato_id JOIN fornecedores f ON f.id = c.fornecedor_id
          WHERE f.razao_social LIKE $1 AND p.situacao = 'previsto' ORDER BY p.vencimento LIMIT 1`,
        [`${prefixo}%`],
      );
      return linha;
    };
    const irregular = await pagamentoDe('Amazônia');
    assert.ok(irregular, 'pagamento previsto de fornecedor irregular');
    const r = await chamar(app, admin, 'POST', `/api/v1/pagamentos/${irregular.id}/atestar`);
    assert.equal(r.statusCode, 200, r.body);
    const atesto = r.json<RespostaAtesto>();
    assert.equal(atesto.situacao === 'atestado' || atesto.situacao === 'atrasado', true);
    assert.equal(atesto.verificacaoRegularidade.momento, 'atesto');
    assert.equal(atesto.verificacaoRegularidade.regular, false);
    assert.equal(atesto.verificacaoRegularidade.bloqueia, false);
    assert.match(atesto.verificacaoRegularidade.providencias.join(' '), /art\. 92, XVI/);
    assert.equal(atesto.pendenciaAberta, true);
    const pendencias = await obterJson<Pagina<Pendencia>>(app, admin, '/api/v1/pendencias?tipo=pagamento&situacao=aberta&tamanhoPagina=100');
    assert.ok(pendencias.itens.some((p) => p.instrumento.id === irregular.contrato_id && p.motivo.startsWith('Regularidade do contratado:')));

    const regular = await pagamentoDe('Rota Segura');
    if (regular) {
      const ok = (await chamar(app, admin, 'POST', `/api/v1/pagamentos/${regular.id}/atestar`)).json<RespostaAtesto>();
      assert.equal(ok.verificacaoRegularidade.regular, true);
      assert.equal(ok.pendenciaAberta, false);
    }
  });

  test('RN-23: recheque antes do pagamento pelo financeiro, registrado; sem permissão → 403', async () => {
    const [atestado] = await app.agora.banco.consultar<{ id: string; contrato_id: string }>(
      `SELECT p.id, p.contrato_id FROM pagamentos p WHERE p.situacao IN ('atestado', 'liquidado') ORDER BY p.vencimento LIMIT 1`,
    );
    assert.ok(atestado);
    const previa = await chamar(app, admin, 'GET', `/api/v1/pagamentos/${atestado.id}/regularidade`);
    assert.equal(previa.statusCode, 200);
    assert.equal(previa.json<ChecklistRegularidade>().momento, 'pagamento');
    const r = await chamar(app, admin, 'POST', `/api/v1/pagamentos/${atestado.id}/regularidade`);
    assert.equal(r.statusCode, 200);
    const v = r.json<VerificacaoRegularidade>();
    assert.equal(v.momento, 'pagamento');
    assert.deepEqual(v.instrumento, { tipo: 'pagamento', id: atestado.id });
    assert.equal(v.bloqueia, false);
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/pagamentos/${atestado.id}/regularidade`)).statusCode, 403);
    assert.ok([200, 404].includes((await chamar(app, financeiro, 'POST', `/api/v1/pagamentos/${atestado.id}/regularidade`)).statusCode), 'financeiro tem a permissão');
  });

  test('RN-24: sanção aplicada sem registro no CEIS/CNEP é pendência com prazo e alerta; o envio é registrado com protocolo', async () => {
    const lista = await obterJson<RegistroSancaoCeisCnep[]>(app, gestor, '/api/v1/sancoes/registro-ceis-cnep');
    assert.ok(lista.length >= 2);
    const pendente = lista[0];
    assert.ok(pendente);
    assert.equal(pendente.situacao, 'pendente_vencida', 'pendentes vencidas primeiro');
    assert.equal(pendente.alerta, true);
    assert.equal(pendente.envio, null);
    assert.match(pendente.fornecedor.razaoSocial, /^Nortecom/);
    assert.ok(lista.some((r) => r.envio !== null && r.situacao === 'registrada_no_prazo'), 'envio sintético da carga');
    assert.deepEqual(
      (await obterJson<RegistroSancaoCeisCnep[]>(app, gestor, '/api/v1/sancoes/registro-ceis-cnep?situacao=pendentes')).map((r) => r.sancao.id),
      [pendente.sancao.id],
    );

    const url = `/api/v1/sancoes/${pendente.sancao.id}/registro-ceis-cnep`;
    const envio = { cadastro: 'CEIS', protocolo: 'CGU-TESTE-0001', enviadoEm: HOJE, observacao: 'Envio feito no sistema da CGU.' };
    assert.equal((await chamar(app, gestor, 'POST', url, { ...envio, enviadoEm: adicionarDias(pendente.sancao.aplicadaEm, -1) })).statusCode, 422);
    assert.equal((await chamar(app, gestor, 'POST', url, { ...envio, enviadoEm: adicionarDias(HOJE, 1) })).statusCode, 422);
    assert.equal((await chamar(app, financeiro, 'POST', url, envio)).statusCode, 403);
    const r = await chamar(app, gestor, 'POST', url, envio);
    assert.equal(r.statusCode, 200, r.body);
    const registrado = r.json<RegistroSancaoCeisCnep>();
    assert.equal(registrado.situacao, 'registrada_fora_do_prazo');
    assert.equal(registrado.envio?.protocolo, 'CGU-TESTE-0001');
    assert.equal(registrado.envio?.responsavel?.id, gestor.sessao.usuario.id);
    assert.equal((await chamar(app, gestor, 'POST', url, envio)).statusCode, 409);
    assert.equal((await eventos(app, 'sancao.registrar_ceis_cnep')).at(-1)?.recurso_id, pendente.sancao.id);
    const sancoes = await obterJson<Pagina<{ id: string; registradaCeisCnep: boolean }>>(app, gestor, '/api/v1/sancoes?situacao=aplicada');
    assert.equal(sancoes.itens.find((s) => s.id === pendente.sancao.id)?.registradaCeisCnep, true);

    const [emDefesa] = await app.agora.banco.consultar<{ id: string }>("SELECT id FROM sancoes WHERE situacao <> 'aplicada' LIMIT 1");
    assert.ok(emDefesa);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/sancoes/${emDefesa.id}/registro-ceis-cnep`, envio)).statusCode, 422);
  });

  test('trilha de auditoria íntegra depois das escritas da regularidade', async () => {
    const auditor = await entrar(app, 'auditor@agora.demo');
    const verificacao = await obterJson<VerificacaoAuditoria>(app, auditor, '/api/v1/auditoria/verificacao');
    assert.equal(verificacao.integra, true);
  });
});

// ───────────────────────── Conector online (API de dados do Portal da Transparência) ─────────────────────────

interface Chamada {
  url: string;
  chave: string | null;
}

function resposta(corpo: unknown, status = 200): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
}

function registroCeis(cnpjFormatado: string, alteracoes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    dataInicioSancao: '10/01/2026',
    dataFimSancao: '10/01/2030',
    tipoSancao: { descricaoResumida: 'Inidoneidade - Lei 14.133/2021', descricaoPortal: 'Declaração de inidoneidade' },
    orgaoSancionador: { nome: 'Órgão federal de teste', siglaUf: 'DF', esfera: 'Federal', poder: 'Executivo' },
    fonteSancao: { nomeExibicao: 'Fonte de teste' },
    sancionado: { nome: 'Empresa de teste', codigoFormatado: cnpjFormatado },
    pessoa: { cnpjFormatado, nome: 'Empresa de teste' },
    fundamentacao: [{ codigo: '156', descricao: 'Art. 156, § 5º' }],
    numeroProcesso: '00000.000099/2026-00',
    ...alteracoes,
  };
}

function formatarCnpj(d: string): string {
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

describe('conector do Portal da Transparência (CEIS e CNEP)', () => {
  const DOCUMENTO = '11222333000181';
  const BASE = { url: 'https://transparencia.exemplo/api-de-dados', chave: 'chave-de-teste' };

  test('consulta CEIS e CNEP com o cabeçalho chave-api-dados, paginação, filtro pela raiz do CNPJ e datas normalizadas', async () => {
    const chamadas: Chamada[] = [];
    const fetchFalso = async (entrada: string | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(entrada));
      chamadas.push({ url: url.toString(), chave: new Headers(init?.headers).get('chave-api-dados') });
      if (url.pathname.endsWith('/ceis') && url.searchParams.get('pagina') === '1') {
        return resposta([registroCeis(formatarCnpj(DOCUMENTO)), registroCeis('99.888.777/0001-66'), { formatoInesperado: 1, dataInicioSancao: 5 }]);
      }
      return resposta([]);
    };
    const r = await consultarCadastrosOnline(fetchFalso, BASE, DOCUMENTO);
    assert.equal(r.modo, 'online');
    assert.equal(r.fonte, FONTE_TRANSPARENCIA);
    assert.equal(r.registros.length, 1, 'registro de outro CNPJ descartado');
    assert.deepEqual(r.registros[0], {
      cadastro: 'CEIS',
      tipoSancao: 'Inidoneidade - Lei 14.133/2021',
      orgaoSancionador: 'Órgão federal de teste',
      esfera: 'Federal',
      uf: 'DF',
      dataInicio: '2026-01-10',
      dataFim: '2030-01-10',
      numeroProcesso: '00000.000099/2026-00',
      fundamentacao: '156 — Art. 156, § 5º',
      abrangencia: null,
    });
    assert.match(r.hash, /^[0-9a-f]{64}$/);
    assert.match(r.mensagem, /1 registro\(s\) ignorado\(s\)/);
    assert.deepEqual(
      chamadas.map((c) => c.url),
      [
        `${BASE.url}/ceis?codigoSancionado=${DOCUMENTO}&pagina=1`,
        `${BASE.url}/ceis?codigoSancionado=${DOCUMENTO}&pagina=2`,
        `${BASE.url}/cnep?codigoSancionado=${DOCUMENTO}&pagina=1`,
      ],
    );
    assert.ok(chamadas.every((c) => c.chave === BASE.chave));
  });

  test('novas tentativas com espera exponencial em 503 e 429; 401 não repete; tempo limite e JSON inválido viram ErroIntegracao', async () => {
    const esperas: number[] = [];
    const esperar = async (ms: number) => {
      esperas.push(ms);
    };
    let tentativas = 0;
    const instavel = async (): Promise<Response> => {
      tentativas++;
      return tentativas === 1 ? resposta('', 503) : tentativas === 2 ? resposta('', 429) : resposta([]);
    };
    const r = await consultarCadastrosOnline(instavel, BASE, DOCUMENTO, { esperar, esperaBaseMs: 10 });
    assert.equal(r.registros.length, 0);
    assert.deepEqual(esperas, [10, 20]);

    let chamadas401 = 0;
    await assert.rejects(
      consultarCadastrosOnline(async () => {
        chamadas401++;
        return resposta({ erro: 'chave' }, 401);
      }, BASE, DOCUMENTO, { esperar }),
      (e: unknown) => e instanceof ErroIntegracao && /recusou a chave de acesso \(HTTP 401\)/.test(e.message),
    );
    assert.equal(chamadas401, 1);

    await assert.rejects(
      consultarCadastrosOnline(
        async () => {
          throw new DOMException('tempo esgotado', 'TimeoutError');
        },
        BASE,
        DOCUMENTO,
        { esperar, timeoutMs: 50 },
      ),
      (e: unknown) => e instanceof ErroIntegracao && /indisponível após 3 tentativas: tempo limite de 50 ms excedido/.test(e.message),
    );
    await assert.rejects(consultarCadastrosOnline(async () => resposta('<html>'), BASE, DOCUMENTO, { esperar }), /JSON inválido/);
    await assert.rejects(consultarCadastrosOnline(async () => resposta({ dados: [] }), BASE, DOCUMENTO, { esperar }), /lista esperada/);
  });

  test('modo online sem chave falha (nunca usa a base simulada); datas do portal', async () => {
    const config = carregarConfig({ AGORA_INTEGRACOES: 'online', AGORA_DADOS_DIR: 'memory://' });
    await assert.rejects(
      consultarCadastrosSancoes({ config, fetch: async () => resposta([]), banco: { consultar: async () => [], executar: async () => 0, executarScript: async () => undefined } }, DOCUMENTO),
      /AGORA_TRANSPARENCIA_CHAVE não configurada/,
    );
    assert.equal(config.transparencia.url, 'https://api.portaldatransparencia.gov.br/api-de-dados');
    assert.equal(config.transparencia.cacheMinutos, 60);
    assert.throws(() => carregarConfig({ AGORA_TRANSPARENCIA_URL: 'ftp://exemplo' }), /AGORA_TRANSPARENCIA_URL/);
    assert.equal(dataDoPortal('31/12/2026'), '2026-12-31');
    assert.equal(dataDoPortal('2026-12-31T00:00:00'), '2026-12-31');
    assert.equal(dataDoPortal('Sem informação'), null);
    assert.equal(dataDoPortal('31/02/2026'), null);
  });

  test('pela API em AGORA_INTEGRACOES=online: consulta real (fetch simulado), proveniência e trava; falha usa a consulta anterior dentro de 24 h', async () => {
    let falhar = false;
    let documentoSancionado = '';
    const chamadas: Chamada[] = [];
    const fetchFalso = async (entrada: string | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(entrada));
      chamadas.push({ url: url.toString(), chave: new Headers(init?.headers).get('chave-api-dados') });
      if (falhar) return resposta({ mensagem: 'chave inválida' }, 403);
      const documento = url.searchParams.get('codigoSancionado') ?? '';
      if (url.pathname.endsWith('/ceis') && url.searchParams.get('pagina') === '1' && documento === documentoSancionado) {
        return resposta([registroCeis(formatarCnpj(documento))]);
      }
      return resposta([]);
    };
    const app = await criarAppTeste({
      env: { ...SEM_LIMITE, AGORA_INTEGRACOES: 'online', AGORA_TRANSPARENCIA_URL: BASE.url, AGORA_TRANSPARENCIA_CHAVE: BASE.chave },
      fetch: fetchFalso,
    });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const escudo = await idFornecedor(app, 'Escudo Forte');
      documentoSancionado = escudo.documento;
      const r = await chamar(app, agente, 'POST', `/api/v1/fornecedores/${escudo.id}/regularidade/consultar`, {});
      assert.equal(r.statusCode, 200);
      const v = r.json<VerificacaoRegularidade>();
      assert.equal(v.consulta?.modo, 'online');
      assert.equal(v.consulta?.fonte, FONTE_TRANSPARENCIA);
      assert.equal(v.consulta?.quantidade, 1);
      assert.equal(v.regular, false);
      assert.equal(v.bloqueia, true);
      assert.match(v.motivos[0] ?? '', /^CEIS: Inidoneidade - Lei 14\.133\/2021, aplicada por Órgão federal de teste \(DF, Federal\)/);
      assert.ok(chamadas.length >= 3 && chamadas.every((c) => c.chave === BASE.chave));
      const [evento] = (await eventos(app, 'regularidade.consultar')).slice(-1);
      assert.equal(evento?.dados.modo, 'online');
      assert.equal(evento?.dados.hashConteudo, v.consulta?.hashConteudo);

      falhar = true;
      const tupa = await idFornecedor(app, 'Tupã');
      const comFalha = (await chamar(app, agente, 'POST', `/api/v1/fornecedores/${tupa.id}/regularidade/consultar`, {})).json<VerificacaoRegularidade>();
      assert.match(comFalha.falhaConsulta ?? '', /HTTP 403/);
      assert.equal(comFalha.consulta?.modo, 'offline', 'vale a consulta anterior (carga) dentro de 24 horas');
      assert.equal(comFalha.regular, true);
      assert.equal((await eventos(app, 'regularidade.consulta_falhou')).length, 1);
    } finally {
      await app.close();
    }
  });
});
