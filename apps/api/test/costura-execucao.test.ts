import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  AlteracaoContratual,
  BaseConhecimentoContrato,
  ChecklistRegularidade,
  ContextoConferenciaNota,
  OcorrenciaContrato,
  PreviaAvaliacaoDesempenho,
  RecebimentoContrato,
  RespostaTermoRecebimento,
} from '@agora/contratos';
import { adicionarDias, hojeISO } from '@agora/dominio';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais, INICIO_TESTES } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

describe('costura da execução contratual (ligações entre módulos)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;
  let gestor: Credenciais;
  let fiscalTecnico: Credenciais;
  let juridico: Credenciais;
  let hoje: string;

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    admin = await entrar(app, 'admin@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    fiscalTecnico = await entrar(app, 'fiscal.tecnico@agora.demo');
    juridico = await entrar(app, 'juridico@agora.demo');
    hoje = hojeISO(new Date(INICIO_TESTES));
  });

  after(async () => {
    await app.close();
  });

  async function regularizarCertidoes(fornecedorId: string): Promise<void> {
    const emissores = {
      fiscal_federal: 'Receita Federal do Brasil',
      fgts: 'Caixa Econômica Federal',
      trabalhista: 'Tribunal Superior do Trabalho',
    } as const;
    for (const [tipo, emissor] of Object.entries(emissores)) {
      const r = await chamar(app, admin, 'POST', `/api/v1/fornecedores/${fornecedorId}/certidoes`, {
        tipo,
        numero: `COSTURA-${tipo}`,
        emissor,
        emitidaEm: hoje,
        validaAte: adicionarDias(hoje, 25),
        resultado: 'negativa',
        conferida: true,
      });
      assert.equal(r.statusCode, 201, r.body);
    }
  }

  async function prepararContrato(contratoId: string): Promise<void> {
    await app.agora.banco.executar(
      `UPDATE contratos SET gestor_id = $2, fiscal_id = $3, natureza_duracao = 'continuo' WHERE id = $1`,
      [contratoId, gestor.sessao.usuario.id, fiscalTecnico.sessao.usuario.id],
    );
    await app.agora.banco.executar(
      `UPDATE contratos_designacoes SET fim = $2 WHERE contrato_id = $1 AND fim IS NULL`,
      [contratoId, hoje],
    );
    await app.agora.banco.executar(
      `INSERT INTO contratos_designacoes (contrato_id, usuario_id, papel, ato, inicio, designado_em)
       VALUES ($1, $2, 'fiscal_tecnico', 'Portaria nº 90/2026', $4, now()),
              ($1, $3, 'comissao_recebimento', 'Portaria nº 91/2026', $4, now()),
              ($1, $3, 'gestor', 'Portaria nº 92/2026', $4, now())`,
      [contratoId, fiscalTecnico.sessao.usuario.id, gestor.sessao.usuario.id, hoje],
    );
    await app.agora.banco.executar(
      `INSERT INTO contratos_parametros_execucao (
         contrato_id, prazo_provisorio_dias_uteis, prazo_definitivo_dias_uteis,
         prazo_correcao_dias_uteis, prazo_liquidacao_dias_uteis, prazo_pagamento_dias,
         marco_pagamento, indice_atualizacao, juros_mora_mensal, garantia_objeto_meses
       ) VALUES ($1, 5, 10, 7, 5, 20, 'recebimento_definitivo', 'IPCA', 0.5, 12)
       ON CONFLICT (contrato_id) DO UPDATE SET
         prazo_provisorio_dias_uteis = EXCLUDED.prazo_provisorio_dias_uteis,
         prazo_definitivo_dias_uteis = EXCLUDED.prazo_definitivo_dias_uteis`,
      [contratoId],
    );
  }

  test('a) um único livro de ocorrências: ocorrência na fiscalização aparece no desempenho e nas lições aprendidas', async () => {
    const [c] = await app.agora.banco.consultar<{ id: string; fornecedor_id: string }>(
      `SELECT c.id, c.fornecedor_id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL
        ORDER BY c.numero LIMIT 1`,
      [hoje],
    );
    assert.ok(c);

    await prepararContrato(c.id);

    const relato = 'Atraso na substituição de insumo crítico detectado pela fiscalização de campo.';
    const rOcorr = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/ocorrencias`, {
      tipo: 'falha_execucao',
      categoria: 'qualidade',
      dataFato: hoje,
      relato,
      providencia: 'Apresentação de plano de ação corretiva em 5 dias.',
      prazoRegularizacao: adicionarDias(hoje, 5),
      notificarContratada: false,
    });
    assert.equal(rOcorr.statusCode, 201, rOcorr.body);
    const ocorrencia = rOcorr.json<OcorrenciaContrato>();
    assert.ok(ocorrencia.id);

    // 1. Aparece na avaliação de desempenho (dados derivados)
    const previa = await obterJson<PreviaAvaliacaoDesempenho>(
      app,
      gestor,
      `/api/v1/contratos/${c.id}/avaliacoes-desempenho/previa?periodoInicio=${adicionarDias(hoje, -10)}&periodoFim=${adicionarDias(hoje, 10)}`,
    );
    assert.ok(previa.ocorrencias.total >= 1, 'ocorrência computada no total do período');
    assert.ok(previa.ocorrencias.abertas >= 1, 'ocorrência registrada como aberta');

    // 2. Aparece na base de conhecimento / lições aprendidas do contrato
    const base = await obterJson<BaseConhecimentoContrato>(
      app,
      gestor,
      `/api/v1/contratos/${c.id}/ocorrencias-execucao`,
    );
    assert.ok(
      base.ocorrencias.some((o) => o.id === ocorrencia.id || o.descricao === relato),
      'ocorrência exposta pela view unificada para lições aprendidas',
    );
  });

  test('b) recebimento definitivo sem ressalva conta na avaliação de desempenho (derivadosDoPeriodo) e muda o indicador', async () => {
    const [c] = await app.agora.banco.consultar<{ id: string; fornecedor_id: string }>(
      `SELECT c.id, c.fornecedor_id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL
        ORDER BY c.numero OFFSET 1 LIMIT 1`,
      [hoje],
    );
    assert.ok(c);

    await prepararContrato(c.id);

    const [indAntes] = await app.agora.banco.consultar<{ recebimentos_total: number; recebimentos_aprovados: number }>(
      `SELECT COALESCE(recebimentos_total, 0) AS recebimentos_total,
              COALESCE(recebimentos_aprovados, 0) AS recebimentos_aprovados
         FROM fornecedores_indicadores WHERE fornecedor_id = $1`,
      [c.fornecedor_id],
    );
    const totalAntes = indAntes?.recebimentos_total ?? 0;
    const aprovadosAntes = indAntes?.recebimentos_aprovados ?? 0;

    // Cadastra recebimento
    const rEntrega = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/recebimentos`, {
      descricao: 'Entrega regular do lote de material sem pendências',
      valor: 80_000,
      entregueEm: hoje,
      pagamentoId: null,
    });
    assert.equal(rEntrega.statusCode, 201, rEntrega.body);
    const recebimento = rEntrega.json<RecebimentoContrato>();

    // Termo provisório
    const rProv = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, {
      tipo: 'provisorio',
      resultado: 'aceito',
      data: hoje,
      observacoes: null,
    });
    assert.equal(rProv.statusCode, 201, rProv.body);

    // Termo definitivo sem ressalva
    const rDef = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${recebimento.id}/termos`, {
      tipo: 'definitivo',
      resultado: 'aceito',
      data: hoje,
      observacoes: null,
    });
    assert.equal(rDef.statusCode, 201, rDef.body);

    // Indicador do fornecedor foi incrementado
    const [indDepois] = await app.agora.banco.consultar<{ recebimentos_total: number; recebimentos_aprovados: number }>(
      `SELECT recebimentos_total, recebimentos_aprovados FROM fornecedores_indicadores WHERE fornecedor_id = $1`,
      [c.fornecedor_id],
    );
    assert.equal(indDepois?.recebimentos_total, totalAntes + 1);
    assert.equal(indDepois?.recebimentos_aprovados, aprovadosAntes + 1);

    // Derivados do período trazem o recebimento aprovado
    const previa = await obterJson<PreviaAvaliacaoDesempenho>(
      app,
      gestor,
      `/api/v1/contratos/${c.id}/avaliacoes-desempenho/previa?periodoInicio=${adicionarDias(hoje, -5)}&periodoFim=${adicionarDias(hoje, 5)}`,
    );
    assert.ok(previa.recebimentos.total >= 1);
    assert.ok(previa.recebimentos.aprovados >= 1);
  });

  test('c) a conferência da nota fiscal (imr/servico.ts) usa a quantidade do termo de recebimento definitivo', async () => {
    const [c] = await app.agora.banco.consultar<{ id: string; pagamento_id: string }>(
      `SELECT c.id, p.id AS pagamento_id
         FROM contratos c
         JOIN pagamentos p ON p.contrato_id = c.id
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL AND p.situacao = 'previsto'
          AND NOT EXISTS (SELECT 1 FROM contratos_recebimentos r WHERE r.pagamento_id = p.id)
        ORDER BY c.numero LIMIT 1`,
      [hoje],
    );
    assert.ok(c);

    await prepararContrato(c.id);

    const quantidadeAferida = 48;
    const rEntrega = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/recebimentos`, {
      descricao: 'Entrega de 48 unidades de equipamentos de teste com atesto quantitativo',
      valor: 150_000,
      entregueEm: hoje,
      pagamentoId: c.pagamento_id,
      quantidade: quantidadeAferida,
    });
    assert.equal(rEntrega.statusCode, 201, rEntrega.body);
    const rec = rEntrega.json<RecebimentoContrato>();

    const rProv = await chamar(app, fiscalTecnico, 'POST', `/api/v1/recebimentos/${rec.id}/termos`, {
      tipo: 'provisorio',
      resultado: 'aceito',
      data: hoje,
      observacoes: null,
    });
    assert.equal(rProv.statusCode, 201, rProv.body);

    const rDef = await chamar(app, gestor, 'POST', `/api/v1/recebimentos/${rec.id}/termos`, {
      tipo: 'definitivo',
      resultado: 'aceito',
      data: hoje,
      observacoes: null,
    });
    assert.equal(rDef.statusCode, 201, rDef.body);

    const conferencia = await obterJson<ContextoConferenciaNota>(
      app,
      gestor,
      `/api/v1/pagamentos/${c.pagamento_id}/conferencia`,
    );
    assert.ok(conferencia.recebimentoDefinitivo, 'contexto traz o recebimento definitivo associado');
    assert.equal(conferencia.recebimentoDefinitivo.quantidadeRecebida, quantidadeAferida);
  });

  test('d) a prorrogação assinada abre a renovação da garantia', async () => {
    // A trava RN-09 não muda: escolhe-se um contrato cujo contratado fica regular depois de certidões negativas válidas.
    const candidatos = await app.agora.banco.consultar<{ id: string; numero: string; fornecedor_id: string; vigencia_fim: string }>(
      `SELECT c.id, c.numero, c.fornecedor_id, c.vigencia_fim FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL AND c.id_pncp IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM alteracoes_contratuais a WHERE a.contrato_id = c.id)
        ORDER BY c.numero`,
      [adicionarDias(hoje, 90)],
    );
    let c: (typeof candidatos)[number] | undefined;
    for (const cand of candidatos) {
      const url = `/api/v1/contratos/${cand.id}/regularidade?momento=assinatura`;
      let checklist = await obterJson<ChecklistRegularidade>(app, gestor, url);
      if (checklist.bloqueia) {
        await regularizarCertidoes(cand.fornecedor_id);
        checklist = await obterJson<ChecklistRegularidade>(app, gestor, url);
      }
      if (!checklist.bloqueia) {
        c = cand;
        break;
      }
    }
    assert.ok(c, 'há contrato com contratado regular');

    await app.agora.banco.executar(`UPDATE contratos SET natureza_duracao = 'continuo' WHERE id = $1`, [c.id]);

    // Insere garantia vigente cuja validade terminará antes da nova vigência prorrogada
    const validadeCurta = adicionarDias(hoje, 20);
    const [gar] = await app.agora.banco.consultar<{ id: string }>(
      `INSERT INTO contratos_garantias (
         contrato_id, finalidade, percentual, valor_base, valor_exigido, modalidade,
         valor, saldo, situacao, apresentada_em, valida_ate, registrada_em
       ) VALUES ($1, 'execucao', 5.0, 10000000, 500000, 'seguro_garantia', 500000, 500000, 'vigente', $2, $3, now())
       RETURNING id`,
      [c.id, hoje, validadeCurta],
    );
    assert.ok(gar);

    // Prorroga vigência por 12 meses com as travas da RN-33
    const novaVigencia = adicionarDias(c.vigencia_fim, 365);
    const travas = {
      vantajosidadeAtestada: true,
      precoCompativel: true,
      previsaoEdital: true,
      creditoOrcamentario: true,
    };
    const rProp = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes`, {
      tipo: 'prazo',
      novaVigenciaFim: novaVigencia,
      valor: 0,
      justificativa: 'Prorrogação regular de vigência contratual por doze meses.',
      ...travas,
    });
    assert.equal(rProp.statusCode, 201, rProp.body);
    const alteracao = rProp.json<AlteracaoContratual>();

    await chamar(app, juridico, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${alteracao.id}/parecer`, {
      resultado: 'favoravel',
      numero: 'PARECER-GARANTIA-001',
      texto: 'Parecer favorável à prorrogação de vigência.',
    });

    const rAssinar = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c.id}/alteracoes/${alteracao.id}/assinar`, {
      confirmacao: true,
    });
    assert.equal(rAssinar.statusCode, 200, rAssinar.body);

    // Movimento de renovação exigida foi criado na garantia
    const [mov] = await app.agora.banco.consultar<{ tipo: string; descricao: string }>(
      `SELECT tipo, descricao FROM garantias_movimentos WHERE garantia_id = $1 AND tipo = 'exigencia' ORDER BY registrado_em DESC LIMIT 1`,
      [gar.id],
    );
    assert.ok(mov, 'movimento de exigência registrado na garantia');
    assert.match(mov.descricao, /Renovação exigida pela prorrogação da vigência/);

    // Pendência de renovação foi vinculada
    const [garAtualizada] = await app.agora.banco.consultar<{ pendencia_id: string }>(
      `SELECT pendencia_id FROM contratos_garantias WHERE id = $1`,
      [gar.id],
    );
    assert.ok(garAtualizada?.pendencia_id, 'garantia associada à pendência criada');
  });

  test('e) a extinção registra o efeito na garantia: liberação sem débito, execução com multa', async () => {
    // Caso 1: Extinção consensual sem débitos -> Liberação da garantia
    const [c1] = await app.agora.banco.consultar<{ id: string; numero: string; fornecedor_id: string }>(
      `SELECT c.id, c.numero, c.fornecedor_id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM alteracoes_contratuais a WHERE a.contrato_id = c.id)
        ORDER BY c.numero OFFSET 3 LIMIT 1`,
      [hoje],
    );
    assert.ok(c1);

    const saldoOriginal = 300_000;
    const [gar1] = await app.agora.banco.consultar<{ id: string }>(
      `INSERT INTO contratos_garantias (
         contrato_id, finalidade, percentual, valor_base, valor_exigido, modalidade,
         valor, saldo, situacao, apresentada_em, valida_ate, registrada_em
       ) VALUES ($1, 'execucao', 5.0, 6000000, 300000, 'fianca_bancaria', 300000, $2, 'vigente', $3, $4, now())
       RETURNING id`,
      [c1.id, saldoOriginal, hoje, adicionarDias(hoje, 180)],
    );
    assert.ok(gar1);

    const rExt1 = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c1.id}/extincao`, {
      forma: 'consensual',
      motivo: 'art137_VIII',
      fundamentacao: 'Acordo consensual de extinção por interesse recíproco das partes sem pendências.',
      interesseAdministracao: true,
    });
    assert.equal(rExt1.statusCode, 201, rExt1.body);
    const ext1 = rExt1.json<AlteracaoContratual>();

    const rDec1 = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c1.id}/alteracoes/${ext1.id}/decidir-extincao`, {
      decisao: 'extinguir',
      dataEfeitos: adicionarDias(hoje, 1),
      fundamentacao: 'Homologação da extinção consensual com plena quitação e restituição da garantia.',
      culpaAdministracao: false,
      efeitos: [],
    });
    assert.equal(rDec1.statusCode, 200, rDec1.body);

    const [gLiberada] = await app.agora.banco.consultar<{ situacao: string; liberada_em: string; valor_restituido: number }>(
      `SELECT situacao, liberada_em, valor_restituido FROM contratos_garantias WHERE id = $1`,
      [gar1.id],
    );
    assert.equal(gLiberada?.situacao, 'liberada');
    assert.ok(gLiberada?.liberada_em);
    assert.equal(Number(gLiberada?.valor_restituido), saldoOriginal);

    const [movLib] = await app.agora.banco.consultar<{ tipo: string }>(
      `SELECT tipo FROM garantias_movimentos WHERE garantia_id = $1 AND tipo = 'liberacao'`,
      [gar1.id],
    );
    assert.ok(movLib, 'movimento de liberação registrado');

    // Caso 2: Extinção unilateral com multa aplicada -> Execução da garantia
    const [c2] = await app.agora.banco.consultar<{ id: string; numero: string; fornecedor_id: string }>(
      `SELECT c.id, c.numero, c.fornecedor_id FROM contratos c
        WHERE c.vigencia_fim > $1 AND c.extinto_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM alteracoes_contratuais a WHERE a.contrato_id = c.id)
        ORDER BY c.numero OFFSET 4 LIMIT 1`,
      [hoje],
    );
    assert.ok(c2);

    const [gar2] = await app.agora.banco.consultar<{ id: string }>(
      `INSERT INTO contratos_garantias (
         contrato_id, finalidade, percentual, valor_base, valor_exigido, modalidade,
         valor, saldo, situacao, apresentada_em, valida_ate, registrada_em
       ) VALUES ($1, 'execucao', 5.0, 10000000, 500000, 'seguro_garantia', 500000, 500000, 'vigente', $2, $3, now())
       RETURNING id`,
      [c2.id, hoje, adicionarDias(hoje, 180)],
    );
    assert.ok(gar2);

    const valorMulta = 45_000;
    await app.agora.banco.executar(
      `INSERT INTO sancoes (fornecedor_id, contrato_id, inciso_infracao, tipo, situacao, valor_multa, instaurada_em, relato)
       VALUES ($1, $2, 'II', 'multa', 'aplicada', $3, $4, 'Multa decorrente de descumprimento de obrigação contratual transitada em julgado.')`,
      [c2.fornecedor_id, c2.id, valorMulta, hoje],
    );

    const rExt2 = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c2.id}/extincao`, {
      forma: 'unilateral',
      motivo: 'art137_I',
      fundamentacao: 'Inexecução contratual grave por reiterados descumprimentos e multas não honradas.',
      prazoDefesaDiasUteis: 15,
    });
    assert.equal(rExt2.statusCode, 201, rExt2.body);
    const ext2 = rExt2.json<AlteracaoContratual>();

    const rDefesa = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c2.id}/alteracoes/${ext2.id}/defesa`, {
      apresentadaEm: hoje,
      resumo: 'Defesa prévia apresentada pela contratada alegando inviabilidade financeira.',
    });
    assert.equal(rDefesa.statusCode, 200, rDefesa.body);

    const rDec2 = await chamar(app, gestor, 'POST', `/api/v1/contratos/${c2.id}/alteracoes/${ext2.id}/decidir-extincao`, {
      decisao: 'extinguir',
      dataEfeitos: adicionarDias(hoje, 1),
      fundamentacao: 'Defesa rejeitada pela autoridade competente; extinção unilateral com execução da garantia para cobertura dos prejuízos e multas.',
      culpaAdministracao: false,
      efeitos: ['assuncao_objeto', 'execucao_garantia'],
    });
    assert.equal(rDec2.statusCode, 200, rDec2.body);

    // A multa segue o desconto do art. 156, § 8º: pagamentos devidos primeiro, depois a garantia; a soma cobre a multa.
    const descontos = await app.agora.banco.consultar<{ origem: string; valor: number }>(
      `SELECT d.origem, d.valor FROM multas_descontos d JOIN sancoes s ON s.id = d.sancao_id WHERE s.contrato_id = $1`,
      [c2.id],
    );
    const totalDescontado = descontos.reduce((t, d) => t + Number(d.valor), 0);
    assert.equal(totalDescontado, valorMulta, 'multa descontada por inteiro, sem cobrança em duplicidade');
    const daGarantia = descontos.filter((d) => d.origem === 'garantia').reduce((t, d) => t + Number(d.valor), 0);

    const [gRetida] = await app.agora.banco.consultar<{ saldo: number; situacao: string }>(
      `SELECT saldo, situacao FROM contratos_garantias WHERE id = $1`,
      [gar2.id],
    );
    assert.equal(gRetida?.situacao, 'vigente', 'o efeito de execução retém a garantia: o valor do prejuízo depende de decisão da autoridade');
    assert.equal(Number(gRetida?.saldo), 500_000 - daGarantia);
    if (daGarantia > 0) {
      const [mov] = await app.agora.banco.consultar<{ valor: number }>(
        `SELECT valor FROM garantias_movimentos WHERE garantia_id = $1 AND tipo = 'desconto_multa'`,
        [gar2.id],
      );
      assert.equal(Number(mov?.valor), daGarantia);
    }
    const [liberada] = await app.agora.banco.consultar<{ total: number }>(
      `SELECT count(*)::int AS total FROM garantias_movimentos WHERE garantia_id = $1 AND tipo = 'liberacao'`,
      [gar2.id],
    );
    assert.equal(liberada?.total, 0, 'garantia com efeito de execução não é liberada');

    // O emitente é avisado pela central de notificações
    const [aviso] = await app.agora.banco.consultar<{ total: number }>(
      `SELECT count(*)::int AS total FROM notificacoes_envios WHERE papel = 'emitente_garantia'`,
    );
    assert.ok((aviso?.total ?? 0) >= 2, 'aviso ao emitente na liberação e na retenção');
  });
});
