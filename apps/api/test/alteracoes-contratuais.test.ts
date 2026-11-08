import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adicionarDias, hojeISO } from '@agora/dominio';
import type { AlteracaoContratual, ChecklistRegularidade, NotificacaoDetalhe, NotificacaoResumo, Pagina, PainelAlteracoesContrato, RespostaErro, RespostaProrrogacao } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { criarClientePncp } from '../src/integracoes/pncp-publicacao.ts';
import { montarTermoPncp } from '../src/modulos/alteracoes/tarefas.ts';
import { obterContratoAlteracao, obterLinhaAlteracao } from '../src/modulos/alteracoes/repositorio.ts';
import { chamar, criarAppTeste, entrar, INICIO_TESTES, obterJson, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };
const HOJE = hojeISO(new Date(INICIO_TESTES));
const JUSTIFICATIVA = 'Ampliação do atendimento nas unidades regionais, conforme estudo de demanda juntado ao processo.';

function erro(resposta: { json<T>(): T }): RespostaErro['erro'] {
  return resposta.json<RespostaErro>().erro;
}

interface ContratoTeste {
  id: string;
  numero: string;
  valor_inicial: number;
  vigencia_inicio: string;
  vigencia_fim: string;
  fornecedor_id: string;
}

describe('alterações contratuais como ato (F22a: RN-32, RN-33 e RF-27)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let gestor: Credenciais;
  let juridico: Credenciais;
  let financeiro: Credenciais;
  let consulta: Credenciais;
  const usados = new Set<string>();

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    admin = await entrar(app, 'admin@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    financeiro = await entrar(app, 'financeiro@agora.demo');
    consulta = await entrar(app, 'consulta@agora.demo');
  });
  after(async () => {
    await app.close();
  });

  /** Registra certidões negativas válidas (dados sintéticos) para o contratado, como faria o agente depois de conferi-las. */
  async function regularizarCertidoes(fornecedorId: string): Promise<void> {
    const emissores = { fiscal_federal: 'Receita Federal do Brasil', fgts: 'Caixa Econômica Federal', trabalhista: 'Tribunal Superior do Trabalho' } as const;
    for (const [tipo, emissor] of Object.entries(emissores)) {
      const r = await chamar(app, admin, 'POST', `/api/v1/fornecedores/${fornecedorId}/certidoes`, {
        tipo,
        numero: `TESTE-K-${tipo}`,
        emissor,
        emitidaEm: HOJE,
        validaAte: adicionarDias(HOJE, 25),
        resultado: 'negativa',
        conferida: true,
      });
      assert.equal(r.statusCode, 201, r.body);
    }
  }

  /**
   * Contrato vigente, divulgado no PNCP e ainda sem alterações. Com `regular`, o contratado passa no checklist
   * da frente C (certidões vencidas são renovadas; sanção no CEIS/CNEP descarta o contrato).
   */
  async function contratoRegular(condicao = 'true', regular = true): Promise<ContratoTeste> {
    const candidatos = await app.agora.banco.consultar<ContratoTeste>(
      `SELECT c.id, c.numero, c.valor_inicial, c.vigencia_inicio, c.vigencia_fim, c.fornecedor_id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.id_pncp IS NOT NULL AND c.extinto_em IS NULL AND ${condicao}
          AND NOT EXISTS (SELECT 1 FROM alteracoes_contratuais a WHERE a.contrato_id = c.id)
        ORDER BY c.numero`,
      [adicionarDias(HOJE, 90)],
    );
    for (const c of candidatos) {
      if (usados.has(c.id)) continue;
      if (regular) {
        const url = `/api/v1/contratos/${c.id}/regularidade?momento=assinatura`;
        let checklist = await obterJson<ChecklistRegularidade>(app, gestor, url);
        if (checklist.bloqueia) {
          await regularizarCertidoes(c.fornecedor_id);
          checklist = await obterJson<ChecklistRegularidade>(app, gestor, url);
          if (checklist.bloqueia) continue;
        }
      }
      usados.add(c.id);
      return c;
    }
    throw new Error(`Nenhum contrato para o teste (${condicao}).`);
  }

  async function painel(id: string, quem: Credenciais = gestor): Promise<PainelAlteracoesContrato> {
    return obterJson<PainelAlteracoesContrato>(app, quem, `/api/v1/contratos/${id}/alteracoes`);
  }

  async function propor(id: string, corpo: Record<string, unknown>): Promise<AlteracaoContratual> {
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${id}/alteracoes`, corpo);
    assert.equal(r.statusCode, 201, r.body);
    return r.json<AlteracaoContratual>();
  }

  async function parecer(id: string, alteracaoId: string, resultado = 'favoravel'): Promise<AlteracaoContratual> {
    const r = await chamar(app, juridico, 'POST', `/api/v1/contratos/${id}/alteracoes/${alteracaoId}/parecer`, {
      resultado,
      numero: 'PARECER-SINT-001',
      texto: 'Controle prévio de legalidade: alteração fundamentada e dentro dos limites legais.',
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json<AlteracaoContratual>();
  }

  test('carga sintética: natureza dos contratos, acréscimo aguardando parecer e painel com limites e histórico', async () => {
    const [contagem] = await app.agora.banco.consultar<{ sem_natureza: number; continuos: number; dedicacao: number; pendentes: number }>(
      `SELECT (SELECT COUNT(*)::integer FROM contratos WHERE natureza_duracao IS NULL) AS sem_natureza,
              (SELECT COUNT(*)::integer FROM contratos WHERE natureza_duracao = 'continuo') AS continuos,
              (SELECT COUNT(*)::integer FROM contratos WHERE regime_mao_obra = 'dedicacao_exclusiva') AS dedicacao,
              (SELECT COUNT(*)::integer FROM alteracoes_contratuais WHERE situacao = 'aguardando_parecer') AS pendentes`,
    );
    assert.ok(contagem);
    assert.equal(contagem.sem_natureza, 0);
    assert.ok(contagem.continuos > 0);
    assert.ok(contagem.dedicacao > 0);
    assert.equal(contagem.pendentes, 1);

    const [comTermos] = await app.agora.banco.consultar<{ contrato_id: string }>(`SELECT contrato_id FROM aditivos WHERE tipo = 'acrescimo' ORDER BY numero LIMIT 1`);
    assert.ok(comTermos);
    const p = await painel(comTermos.contrato_id);
    assert.ok(p.limites.percentualAcrescimos > 0);
    assert.equal(p.limites.limiteAcrescimos, 25);
    assert.equal(p.limites.fundamento, 'Lei 14.133/2021, art. 125');
    assert.ok(p.alteracoes.some((a) => a.origem === 'importado' && a.divulgacao.situacao === 'importado'));
    assert.ok(['planejar_prorrogacao', 'limite_prorrogacao', 'nova_licitacao', 'prorrogacao_automatica'].includes(p.prorrogacao.tipo));

    const fora = await chamar(app, consulta, 'GET', `/api/v1/contratos/${comTermos.contrato_id}/alteracoes`);
    assert.ok([200, 404].includes(fora.statusCode), 'consulta só vê o que o escopo permite');
    assert.equal((await chamar(app, consulta, 'POST', `/api/v1/contratos/${comTermos.contrato_id}/alteracoes`, { tipo: 'acrescimo', valor: 1, justificativa: JUSTIFICATIVA })).statusCode, 403);
  });

  test('RN-32: acréscimo dentro do limite segue para parecer, é assinado com o checklist de regularidade e divulgado no PNCP', async () => {
    const c = await contratoRegular();
    const antes = await painel(c.id);
    const valor = Math.round(c.valor_inicial * 0.1);
    const proposta = await propor(c.id, { tipo: 'acrescimo', valor, justificativa: JUSTIFICATIVA });
    assert.equal(proposta.situacao, 'aguardando_parecer');
    assert.equal(proposta.valor, valor);
    assert.equal(proposta.acoes.parecer, true);
    assert.match(proposta.avaliacao?.fundamento ?? '', /arts\. 124 e 125/);

    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${proposta.id}/assinar`, { confirmacao: true })).statusCode, 409, 'sem parecer não assina');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${proposta.id}/parecer`, { resultado: 'favoravel', numero: 'X-1', texto: 'Parecer emitido por quem não é da assessoria.' })).statusCode, 403);
    const comParecer = await parecer(c.id, proposta.id);
    assert.equal(comParecer.situacao, 'pronto_para_assinatura');
    assert.equal(comParecer.parecer?.emitidoPor?.nome !== undefined, true);

    assert.equal((await chamar(app, financeiro, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${proposta.id}/assinar`, { confirmacao: true })).statusCode, 403);
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${proposta.id}/assinar`, { confirmacao: true })).statusCode, 403);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${proposta.id}/assinar`, { confirmacao: true });
    assert.equal(r.statusCode, 200, r.body);
    const assinado = r.json<AlteracaoContratual>();
    assert.equal(assinado.situacao, 'assinado');
    assert.match(assinado.numero ?? '', /^\d+º Termo Aditivo$/);
    assert.equal(assinado.assinadoEm, HOJE);
    assert.ok(assinado.verificacaoRegularidadeId);
    assert.equal(assinado.divulgacao.situacao, 'publicado');
    assert.equal(assinado.divulgacao.modo, 'offline');
    assert.match(assinado.divulgacao.protocolo ?? '', /^SIMULADO-[0-9A-F]{20}$/);
    assert.match(assinado.divulgacao.hashDados ?? '', /^[0-9a-f]{64}$/);
    assert.equal(assinado.divulgacao.prazo?.situacao, 'divulgado_no_prazo');
    assert.ok(assinado.linkTermo);

    const depois = await painel(c.id);
    assert.equal(depois.limites.acrescimos, antes.limites.acrescimos + valor);
    const [livro] = await app.agora.banco.consultar<{ valor_global: number }>('SELECT valor_global FROM vw_contratos_valores WHERE contrato_id = $1', [c.id]);
    assert.ok(livro);
    const pdf = await chamar(app, gestor, 'GET', assinado.linkTermo ?? '');
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.ok(pdf.rawPayload.subarray(0, 5).toString('latin1').startsWith('%PDF'));

    const historico = await obterJson<{ acao: string }[]>(app, gestor, `/api/v1/contratos/${c.id}/historico`);
    for (const padrao of [/^Propôs termo aditivo de acréscimo/, /^Registrou o parecer jurídico/, /^Verificou a regularidade/, /^Assinou o \d+º Termo Aditivo/, /^Divulgou o \d+º Termo Aditivo .* no PNCP \(simulação\)/]) {
      assert.ok(historico.some((h) => padrao.test(h.acao)), `histórico sem ${padrao.source}`);
    }
    const [termo] = await app.agora.banco.consultar<{ id: string }>('SELECT id FROM aditivos WHERE contrato_id = $1 AND numero = $2', [c.id, assinado.numero]);
    assert.ok(termo, 'termo gravado no livro de aditivos');
  });

  test('RN-32: acima de 25% a API recusa na proposta e de novo na assinatura (propostas que, somadas, passam do limite)', async () => {
    const c = await contratoRegular();
    const p = await painel(c.id);
    const acima = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes`, { tipo: 'acrescimo', valor: p.limites.margemAcrescimos + 1, justificativa: JUSTIFICATIVA });
    assert.equal(acima.statusCode, 422);
    assert.ok((erro(acima).detalhes ?? []).some((d) => d.campo === 'RN-32' && /acima do limite de 25%/.test(d.mensagem)));
    const reforma = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes`, {
      tipo: 'acrescimo',
      valor: p.limites.margemAcrescimos + 1,
      reformaEdificioOuEquipamento: true,
      justificativa: JUSTIFICATIVA,
    });
    assert.equal(reforma.statusCode, 201, 'reforma admite até 50%');

    // Duas propostas cabem sozinhas; somadas, não. A segunda assinatura é recusada.
    const metade = Math.floor(p.limites.margemAcrescimos * 0.6);
    const a = await propor(c.id, { tipo: 'supressao', valor: metade, justificativa: JUSTIFICATIVA });
    const b = await propor(c.id, { tipo: 'supressao', valor: metade, justificativa: JUSTIFICATIVA });
    await parecer(c.id, a.id);
    await parecer(c.id, b.id);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${a.id}/assinar`, { confirmacao: true })).statusCode, 200);
    const segunda = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${b.id}/assinar`, { confirmacao: true });
    assert.equal(segunda.statusCode, 422, segunda.body);
    assert.ok((erro(segunda).detalhes ?? []).every((d) => d.campo === 'RN-32'));
    const indeferida = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${b.id}/indeferir`, { fundamentacao: 'Supressão acima do limite do art. 125 somada à anterior.' });
    assert.equal(indeferida.json<AlteracaoContratual>().situacao, 'indeferido');

    const parecerDesfavoravel = await propor(c.id, { tipo: 'qualitativa', valor: 0, efeitoFinanceiro: 'nenhum', descricaoAlteracao: 'Troca da especificação do relatório mensal.', justificativa: JUSTIFICATIVA });
    const devolvida = await parecer(c.id, parecerDesfavoravel.id, 'desfavoravel');
    assert.equal(devolvida.situacao, 'devolvido');
    assert.equal(devolvida.acoes.assinar, false);
  });

  test('reajuste: antes de 12 meses da data-base é recusado; depois, é apostilado pelo índice, com o ciclo registrado', async () => {
    const recente = await app.agora.banco.consultar<{ id: string }>(
      `SELECT id FROM contratos WHERE data_base_reajuste > $1 AND vigencia_fim > $2 ORDER BY numero LIMIT 1`,
      [adicionarDias(HOJE, -330), HOJE],
    );
    assert.ok(recente[0]);
    const antes = await chamar(app, gestor, 'POST', `/api/v1/contratos/${recente[0].id}/reajustes`, { percentual: 4.5, fonteIndice: 'IPCA acumulado em 12 meses (série sintética de teste)' });
    assert.equal(antes.statusCode, 422);
    assert.match(JSON.stringify(erro(antes).detalhes), /interregno mínimo de 12 meses/);

    const candidatos = await app.agora.banco.consultar<{ id: string }>(
      `SELECT c.id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM reajustes_ciclos r WHERE r.instrumento_id = c.id AND r.aplicado_em IS NOT NULL)
          AND c.data_base_reajuste <= $2
        ORDER BY c.numero`,
      [adicionarDias(HOJE, 30), adicionarDias(HOJE, -366)],
    );
    const alvo = candidatos.find((c) => !usados.has(c.id));
    assert.ok(alvo, 'contrato com aniversário da data-base já completo');
    usados.add(alvo.id);
    const p = await painel(alvo.id);
    assert.equal(p.reajuste.disponivel, true);
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/contratos/${alvo.id}/reajustes`, { percentual: 4.5, fonteIndice: 'Série sintética de teste' })).statusCode, 403);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${alvo.id}/reajustes`, { percentual: 4.5, fonteIndice: 'IPCA acumulado em 12 meses (série sintética de teste)' });
    assert.equal(r.statusCode, 201, r.body);
    const apostila = r.json<AlteracaoContratual>();
    assert.equal(apostila.especie, 'apostila');
    assert.equal(apostila.tipo, 'reajuste');
    assert.match(apostila.numero ?? '', /^\d+º Apostilamento$/);
    assert.equal(apostila.valor, Math.round((p.reajuste.saldoContratual * 4.5) / 100));
    assert.equal(apostila.divulgacao.prazo?.situacao, 'sem_prazo_de_eficacia');
    const [ciclo] = await app.agora.banco.consultar<{ percentual: number; aplicado_em: string }>(
      `SELECT percentual, aplicado_em FROM reajustes_ciclos WHERE instrumento_id = $1 AND aplicado_em IS NOT NULL`,
      [alvo.id],
    );
    assert.equal(ciclo?.aplicado_em, HOJE);
    const depois = await painel(alvo.id);
    assert.equal(depois.limites.reajustes, p.limites.reajustes + apostila.valor);
    assert.equal(depois.reajuste.ciclosAplicados, 1);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${alvo.id}/reajustes`, { percentual: 3, fonteIndice: 'IPCA acumulado (série sintética)' })).statusCode, 422, 'o 2º ciclo exige 24 meses');
  });

  test('RN-33: prorrogação da frente C recusa sem vantajosidade e acima de 10 anos; o termo de prazo com parecer prorroga e é divulgado', async () => {
    const c = await contratoRegular();
    await app.agora.banco.executar(`UPDATE contratos SET natureza_duracao = 'continuo' WHERE id = $1`, [c.id]);
    const travas = { vantajosidadeAtestada: true, precoCompativel: true, previsaoEdital: true, creditoOrcamentario: true };
    const sem = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/prorrogacoes`, {
      novaVigenciaFim: adicionarDias(c.vigencia_fim, 365),
      valor: 0,
      justificativa: 'Prorrogação por mais 12 meses do serviço contínuo.',
    });
    assert.equal(sem.statusCode, 422);
    assert.ok((erro(sem).detalhes ?? []).every((d) => d.campo === 'RN-33'));
    assert.match(JSON.stringify(erro(sem).detalhes), /art\. 107/);
    const dezAnos = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/prorrogacoes`, {
      novaVigenciaFim: adicionarDias(c.vigencia_inicio, 3653),
      valor: 0,
      justificativa: 'Prorrogação além da vigência máxima do serviço contínuo.',
      ...travas,
    });
    assert.equal(dezAnos.statusCode, 422);
    assert.match(JSON.stringify(erro(dezAnos).detalhes), /vigência máxima de 10 anos/);

    const direta = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/prorrogacoes`, {
      novaVigenciaFim: adicionarDias(c.vigencia_fim, 180),
      valor: 1000,
      justificativa: 'Prorrogação por mais 6 meses do serviço contínuo, preços vantajosos.',
      ...travas,
    });
    assert.equal(direta.statusCode, 201, direta.body);
    const resposta = direta.json<RespostaProrrogacao>();
    assert.equal(resposta.alteracao?.tipo, 'prazo');
    assert.equal(resposta.alteracao?.divulgacao.situacao, 'publicado');

    const novoFim = adicionarDias(c.vigencia_fim, 365);
    const termo = await propor(c.id, { tipo: 'prazo', novaVigenciaFim: novoFim, valor: 0, justificativa: JUSTIFICATIVA, ...travas });
    assert.equal(termo.novaVigenciaFim, novoFim);
    await parecer(c.id, termo.id);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${termo.id}/assinar`, { confirmacao: true });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json<AlteracaoContratual>().situacao, 'assinado');
    const [atual] = await app.agora.banco.consultar<{ vigencia_fim: string }>('SELECT vigencia_fim FROM contratos WHERE id = $1', [c.id]);
    assert.equal(atual?.vigencia_fim, novoFim);
  });

  test('reequilíbrio: risco da contratada é vedado; evento não previsto é instruído, deferido parcialmente e soma ao valor global', async () => {
    const c = await contratoRegular();
    const riscoId = 'risco-sintetico-contratada';
    await app.agora.banco.executar(
      `INSERT INTO revisoes_matriz_riscos (contrato_id, revisada_em, linha, riscos, observacao, registrada_em)
       VALUES ($1, $2, 'primeira', $3::jsonb, 'Revisão sintética para o teste do reequilíbrio.', $4)`,
      [
        c.id,
        HOJE,
        JSON.stringify([{ id: riscoId, descricao: 'Variação do custo do insumo principal', probabilidade: 3, impacto: 3, alocacao: 'contratada', mitigacao: 'Estoque regulador' }]),
        new Date(INICIO_TESTES).toISOString(),
      ],
    );
    const pedido = {
      tipo: 'reequilibrio',
      enquadramento: 'fato_imprevisivel',
      dataEvento: adicionarDias(HOJE, -20),
      solicitadoEm: adicionarDias(HOJE, -5),
      solicitante: 'contratada',
      sentido: 'aumento',
      valor: 500_000,
      demonstracao: 'Planilha comparativa dos custos do insumo antes e depois do evento, com notas fiscais e cotações sintéticas.',
      justificativa: 'Pedido de restabelecimento do equilíbrio por evento extraordinário na cadeia de suprimentos.',
    };
    const vedado = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes`, { ...pedido, riscoId });
    assert.equal(vedado.statusCode, 422);
    assert.match(JSON.stringify(erro(vedado).detalhes), /art\. 103, § 5º/);

    const instruido = await propor(c.id, pedido);
    assert.equal(instruido.tipo, 'reequilibrio');
    assert.ok(instruido.detalhes.some((d) => d.rotulo === 'Matriz de riscos' && /não previsto/.test(d.valor)));
    await parecer(c.id, instruido.id, 'favoravel_com_ressalvas');
    const acima = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${instruido.id}/assinar`, { confirmacao: true, valorReconhecido: 600_000 });
    assert.equal(acima.statusCode, 422);
    const antes = await painel(c.id);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${instruido.id}/assinar`, {
      confirmacao: true,
      valorReconhecido: 300_000,
      fundamentacao: 'Reconhecida parte do desequilíbrio demonstrado, conforme a análise técnica.',
    });
    assert.equal(r.statusCode, 200, r.body);
    const deferido = r.json<AlteracaoContratual>();
    assert.equal(deferido.valor, 300_000);
    assert.equal(deferido.decisao?.resultado, 'deferido_parcialmente');
    const depois = await painel(c.id);
    assert.equal(depois.limites.acrescimos, antes.limites.acrescimos, 'reequilíbrio não conta no art. 125');
    const [valores] = await app.agora.banco.consultar<{ reequilibrios: number }>('SELECT reequilibrios FROM vw_contratos_valores WHERE contrato_id = $1', [c.id]);
    assert.equal(valores?.reequilibrios, 300_000);
  });

  test('repactuação: com dedicação exclusiva de mão de obra e demonstração analítica é apostilada; sem dedicação, recusada', async () => {
    const [dedicado] = await app.agora.banco.consultar<{ id: string; vigencia_fim: string }>(
      `SELECT id, vigencia_fim FROM contratos WHERE regime_mao_obra = 'dedicacao_exclusiva' AND vigencia_fim > $1 AND extinto_em IS NULL ORDER BY numero LIMIT 1`,
      [adicionarDias(HOJE, 60)],
    );
    assert.ok(dedicado);
    const corpo = {
      solicitadaEm: adicionarDias(HOJE, -3),
      efeitosDesde: adicionarDias(HOJE, -3),
      clausulasNaoTrabalhistasExcluidas: true,
      justificativa: 'Repactuação dos postos pela nova convenção coletiva sintética, com planilha de custos.',
      componentes: [
        { descricao: 'Salário e encargos dos postos', origem: 'mao_de_obra', dataBase: adicionarDias(HOJE, -400), valorMensalAnterior: 2_000_000, valorMensalNovo: 2_100_000, documento: 'Convenção coletiva sintética de teste' },
      ],
    };
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${dedicado.id}/repactuacoes`, corpo);
    assert.equal(r.statusCode, 201, r.body);
    const apostila = r.json<AlteracaoContratual>();
    assert.equal(apostila.tipo, 'repactuacao');
    assert.ok(apostila.valor >= 100_000);
    assert.ok(apostila.detalhes.some((d) => /Mão de obra/.test(d.rotulo)));

    const [semDedicacao] = await app.agora.banco.consultar<{ id: string }>(`SELECT id FROM contratos WHERE regime_mao_obra = 'sem_dedicacao' AND vigencia_fim > $1 ORDER BY numero LIMIT 1`, [HOJE]);
    assert.ok(semDedicacao);
    const recusada = await chamar(app, gestor, 'POST', `/api/v1/contratos/${semDedicacao.id}/repactuacoes`, corpo);
    assert.equal(recusada.statusCode, 422);
    assert.match(JSON.stringify(erro(recusada).detalhes), /art\. 135, caput/);
  });

  test('extinção unilateral: contraditório com notificação, decisão depois da defesa, efeitos do art. 139, termo de rescisão divulgado', async () => {
    const c = await contratoRegular();
    const pendente = await propor(c.id, { tipo: 'acrescimo', valor: Math.round(c.valor_inicial * 0.02), justificativa: JUSTIFICATIVA });
    const fundamentacao = 'Descumprimento reiterado dos prazos de entrega apontado nos relatórios da fiscalização, sem regularização após notificação.';
    const semPrazo = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'unilateral', motivo: 'art137_I', fundamentacao });
    assert.equal(semPrazo.statusCode, 422);
    const culpaPropria = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'unilateral', motivo: 'art137_p2_IV', fundamentacao, prazoDefesaDiasUteis: 5 });
    assert.equal(culpaPropria.statusCode, 422);

    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'unilateral', motivo: 'art137_I', fundamentacao, prazoDefesaDiasUteis: 5 });
    assert.equal(r.statusCode, 201, r.body);
    const extincao = r.json<AlteracaoContratual>();
    assert.equal(extincao.situacao, 'em_contraditorio');
    assert.equal(extincao.contraditorio?.prazoDiasUteis, 5);
    assert.ok((extincao.contraditorio?.prazoFim ?? '') > HOJE);
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'unilateral', motivo: 'art137_I', fundamentacao, prazoDefesaDiasUteis: 5 })).statusCode, 409);

    const avisos = await obterJson<Pagina<NotificacaoResumo>>(app, gestor, `/api/v1/notificacoes?instrumentoTipo=contrato&instrumentoId=${c.id}`);
    const aviso = avisos.itens.find((n) => n.tipo === 'ocorrencia');
    assert.ok(aviso, 'contratado notificado pela central');
    const detalhe = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${aviso.id}`);
    assert.match(detalhe.corpo, /processo de extinção/);
    assert.ok(detalhe.envios.every((e) => e.papel === 'contratada'));

    const decisao = {
      decisao: 'extinguir',
      dataEfeitos: adicionarDias(HOJE, 1),
      fundamentacao: 'Defesa analisada e rejeitada; mantidos os descumprimentos apontados pela fiscalização.',
      culpaAdministracao: false,
      efeitos: ['assuncao_objeto', 'execucao_garantia'],
    };
    const cedo = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/decidir-extincao`, decisao);
    assert.equal(cedo.statusCode, 422, 'sem defesa e no prazo, não decide');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/defesa`, { semManifestacao: true })).statusCode, 422, 'prazo ainda corre');
    const defesa = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/defesa`, {
      apresentadaEm: HOJE,
      resumo: 'A contratada alega atrasos por falta de insumos no mercado, sem comprovação.',
    });
    assert.equal(defesa.statusCode, 200, defesa.body);
    assert.equal(defesa.json<AlteracaoContratual>().situacao, 'aguardando_decisao');
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/decidir-extincao`, { ...decisao, efeitos: ['devolucao_garantia'] })).statusCode, 422);
    const decidida = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/decidir-extincao`, decisao);
    assert.equal(decidida.statusCode, 200, decidida.body);
    const termo = decidida.json<AlteracaoContratual>();
    assert.equal(termo.situacao, 'assinado');
    assert.equal(termo.numero, 'Termo de Rescisão');
    assert.equal(termo.divulgacao.situacao, 'publicado');
    assert.ok(termo.detalhes.some((d) => /art\. 139, I/.test(d.valor)));

    const [contrato] = await app.agora.banco.consultar<{ extinto_em: string; vigencia_fim: string }>('SELECT extinto_em, vigencia_fim FROM contratos WHERE id = $1', [c.id]);
    assert.equal(contrato?.extinto_em, decisao.dataEfeitos);
    assert.equal(contrato?.vigencia_fim, decisao.dataEfeitos);
    const p = await painel(c.id);
    assert.equal(p.extintoEm, decisao.dataEfeitos);
    assert.equal(p.alteracoes.find((a) => a.id === pendente.id)?.situacao, 'arquivado');
    const depois = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes`, { tipo: 'acrescimo', valor: 100, justificativa: JUSTIFICATIVA });
    assert.equal(depois.statusCode, 422);
    assert.match(JSON.stringify(erro(depois).detalhes), /extinto/);
  });

  test('extinção consensual: sem fase de defesa, depende do interesse da Administração; arquivamento mantém o contrato', async () => {
    const c = await contratoRegular('true', false);
    const fundamentacao = 'Extinção por acordo: a demanda deixou de existir com a reestruturação das unidades atendidas pelo contrato.';
    assert.equal((await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'consensual', motivo: 'art137_VIII', fundamentacao })).statusCode, 422);
    const r = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/extincao`, { forma: 'consensual', motivo: 'art137_VIII', fundamentacao, interesseAdministracao: true });
    assert.equal(r.statusCode, 201, r.body);
    const extincao = r.json<AlteracaoContratual>();
    assert.equal(extincao.situacao, 'aguardando_decisao');
    assert.equal(extincao.contraditorio, null);
    const arquivada = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${extincao.id}/decidir-extincao`, {
      decisao: 'arquivar',
      dataEfeitos: HOJE,
      fundamentacao: 'Acordo não concluído: a contratada manteve o interesse na execução.',
      culpaAdministracao: false,
      efeitos: [],
    });
    assert.equal(arquivada.statusCode, 200, arquivada.body);
    assert.equal(arquivada.json<AlteracaoContratual>().situacao, 'arquivado');
    const [contrato] = await app.agora.banco.consultar<{ extinto_em: string | null }>('SELECT extinto_em FROM contratos WHERE id = $1', [c.id]);
    assert.equal(contrato?.extinto_em, null);
  });

  test('alerta de 120 dias: o aviso de vencimento da central diz que não cabe nova prorrogação no limite de 10 anos', async () => {
    const c = await contratoRegular('c.fiscal_id IS NOT NULL AND c.gestor_id IS NOT NULL', false);
    const fim = adicionarDias(HOJE, 100);
    await app.agora.banco.executar(`UPDATE contratos SET natureza_duracao = 'continuo', vigencia_inicio = $2, vigencia_fim = $3 WHERE id = $1`, [
      c.id,
      adicionarDias(fim, -3652),
      fim,
    ]);
    const r = await chamar(app, admin, 'POST', '/api/v1/notificacoes/varredura');
    assert.equal(r.statusCode, 200, r.body);
    const lista = await obterJson<Pagina<NotificacaoResumo>>(app, gestor, `/api/v1/notificacoes?instrumentoTipo=contrato&instrumentoId=${c.id}&faixa=120`);
    const aviso = lista.itens[0];
    assert.ok(aviso);
    const detalhe = await obterJson<NotificacaoDetalhe>(app, gestor, `/api/v1/notificacoes/${aviso.id}`);
    assert.match(detalhe.corpo, /Prorrogação: a vigência máxima de 10 anos termina em .*não cabe nova prorrogação/);
    const p = await painel(c.id);
    assert.equal(p.prorrogacao.tipo, 'nova_licitacao');
  });

  test('PNCP online: o termo vai ao endpoint de termos do contrato com o IncluirTermoContratoDTO e o location dá o sequencial', async () => {
    const [assinada] = await app.agora.banco.consultar<{ id: string; contrato_id: string }>(
      `SELECT id, contrato_id FROM alteracoes_contratuais WHERE situacao = 'assinado' AND tipo = 'acrescimo' ORDER BY proposto_em LIMIT 1`,
    );
    assert.ok(assinada);
    const contrato = await obterContratoAlteracao(app.agora.banco, assinada.contrato_id, null);
    const linha = await obterLinhaAlteracao(app.agora.banco, assinada.contrato_id, assinada.id);
    assert.ok(contrato && linha);
    const termo = montarTermoPncp(linha, contrato);
    assert.equal(termo.tipoTermoContratoId, 2);
    assert.equal(termo.qualificacaoAcrescimoSupressao, true);
    assert.equal(termo.qualificacaoVigencia, false);
    assert.equal(termo.valorAcrescido, linha.valor / 100);

    const chamadas: { url: string; corpo: unknown }[] = [];
    const base = 'https://pncp.teste.invalid/api/pncp';
    const cliente = criarClientePncp({
      urlBase: base,
      usuario: 'sistema-agora',
      senha: 'senha-de-teste-sintetica',
      fetch: async (entrada, init) => {
        const url = String(entrada);
        if (url.endsWith('/v1/usuarios/login')) return new Response(null, { status: 200, headers: { authorization: 'Bearer token-sintetico' } });
        chamadas.push({ url, corpo: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(null, { status: 201, headers: { location: `${url}/7` } });
      },
    });
    const resposta = await cliente.incluirTermoContrato('12345678000195', 2026, 412, termo);
    assert.equal(chamadas[0]?.url, `${base}/v1/orgaos/12345678000195/contratos/2026/412/termos`);
    assert.equal((chamadas[0]?.corpo as { numeroTermoContrato: string }).numeroTermoContrato, linha.numero);
    assert.equal(resposta.registro.sequencialDocumento, 7);
    assert.equal(resposta.registro.numeroControle, '12345678000195-2-000412/2026');
  });
});
