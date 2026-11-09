import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import type { EditalPublico, OrdemCronologicaPublicaResposta } from '@agora/contratos';
import { criarAppTeste, entrar, type Credenciais } from './apoio.ts';

const SEM_LIMITE = { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' };

describe('ordem cronológica pública (art. 141, § 3º) e nota técnica pós-homologação (art. 54, § 3º)', () => {
  let app: FastifyInstance;
  let admin: Credenciais;

  before(async () => {
    app = await criarAppTeste({ env: SEM_LIMITE });
    admin = await entrar(app, 'admin@agora.demo');
  });

  after(async () => {
    await app.close();
  });

  test('mês inválido responde 400', async () => {
    const r1 = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=invalido' });
    assert.equal(r1.statusCode, 400);

    const r2 = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-13' });
    assert.equal(r2.statusCode, 400);

    const r3 = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-00' });
    assert.equal(r3.statusCode, 400);
  });

  test('mês com pagamentos lista notas por UASG e fonte com posição e dados exigidos', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-11' });
    assert.equal(r.statusCode, 200);
    const resp = r.json<OrdemCronologicaPublicaResposta>();
    assert.equal(resp.mes, '2026-11');
    assert.ok(resp.uasgs.length >= 1, 'o seed possui UASGs');

    const todasNotas = resp.uasgs.flatMap((u) => u.fontes.flatMap((f) => f.notas));
    assert.ok(todasNotas.length >= 1, 'o seed possui notas para a competência/mês');

    for (const nota of todasNotas) {
      assert.ok(nota.id);
      assert.ok(nota.numeroContrato);
      assert.ok(nota.objeto);
      assert.ok(nota.fornecedor.razaoSocial);
      assert.ok(typeof nota.valor === 'number' && nota.valor > 0);
      assert.match(nota.dataExigibilidade, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(nota.situacao);
      if (nota.situacao !== 'pago') {
        assert.ok(nota.posicaoFila === null || typeof nota.posicaoFila === 'number');
      } else {
        assert.equal(nota.posicaoFila, null);
      }
    }
  });

  test('alteração justificada da ordem cronológica aparece no mês correspondente', async () => {
    // Localiza um pagamento existente
    const [pagamento] = await app.agora.banco.consultar<{ id: string }>(
      "SELECT id FROM pagamentos WHERE situacao <> 'pago' LIMIT 1",
    );
    assert.ok(pagamento);

    // Insere alteração justificada da ordem no mês 2026-11
    await app.agora.banco.executar(
      `INSERT INTO alteracoes_ordem_cronologica
         (pagamento_id, inciso, justificativa, autoridade, ato, decidida_em, registrado_por, registrado_em)
       VALUES
         ($1, 'II', 'Calamidade pública que demanda pagamento prioritário de insumos essenciais.', 'Secretário Nacional', 'Portaria 42/2026', '2026-11-05', $2, '2026-11-05T14:00:00.000Z')`,
      [pagamento.id, admin.sessao.usuario.id],
    );

    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-11' });
    assert.equal(r.statusCode, 200);
    const resp = r.json<OrdemCronologicaPublicaResposta>();

    const alteracoes = resp.uasgs.flatMap((u) => u.fontes.flatMap((f) => f.alteracoes));
    const alt = alteracoes.find((a) => a.pagamentoId === pagamento.id);
    assert.ok(alt, 'alteração justificada deve constar na resposta do mês');
    assert.equal(alt.inciso, 'II');
    assert.equal(alt.justificativa, 'Calamidade pública que demanda pagamento prioritário de insumos essenciais.');
    assert.equal(alt.autoridade, 'Secretário Nacional');
    assert.equal(alt.ato, 'Portaria 42/2026');
    assert.equal(alt.data, '2026-11-05');
  });

  test('credor pessoa física tem CPF mascarado no padrão gov.br', async () => {
    // Insere fornecedor pessoa física
    const [fornecedorPf] = await app.agora.banco.consultar<{ id: string }>(
      `INSERT INTO fornecedores (tipo_pessoa, razao_social, documento, uf, telefone, email)
       VALUES ('PF', 'Carlos Alberto de Oliveira', '12345678909', 'DF', '61999998888', 'carlos@exemplo.com')
       RETURNING id`,
    );
    assert.ok(fornecedorPf);

    // Vincula um contrato existente na competência 2026-11 a esse fornecedor PF
    const [pagamentoAlvo] = await app.agora.banco.consultar<{ id: string; contrato_id: string }>(
      "SELECT id, contrato_id FROM pagamentos WHERE competencia = '2026-11' LIMIT 1",
    );
    assert.ok(pagamentoAlvo);

    await app.agora.banco.executar(
      'UPDATE contratos SET fornecedor_id = $1 WHERE id = $2',
      [fornecedorPf.id, pagamentoAlvo.contrato_id],
    );

    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-11' });
    assert.equal(r.statusCode, 200);
    const resp = r.json<OrdemCronologicaPublicaResposta>();

    const notaPf = resp.uasgs
      .flatMap((u) => u.fontes.flatMap((f) => f.notas))
      .find((n) => n.id === pagamentoAlvo.id);
    assert.ok(notaPf);
    assert.equal(notaPf.fornecedor.cnpj, null);
    assert.equal(notaPf.fornecedor.cpf, '***.456.789-**', 'CPF deve ser mascarado');
    assert.doesNotMatch(notaPf.fornecedor.cpf, /12345678909/);
    assert.equal(notaPf.fornecedor.razaoSocial, 'Carlos A. O.');
  });

  test('contrato com sigilo vigente da LAI tem objeto e fornecedor rotulados como Informação classificada', async () => {
    // Localiza um contrato que possua pagamento na competência 2026-11
    const [alvo] = await app.agora.banco.consultar<{ id: string; processo_id: string; pagamento_id: string }>(
      `SELECT c.id, (SELECT id FROM processos LIMIT 1) AS processo_id, p.id AS pagamento_id
         FROM contratos c
         JOIN pagamentos p ON p.contrato_id = c.id
        WHERE p.competencia = '2026-11'
        LIMIT 1`,
    );
    assert.ok(alvo);

    // Classifica o contrato com sigilo LAI vigente (grau reservada)
    await app.agora.banco.executar(
      `INSERT INTO sigilo_classificacoes
         (processo_id, contrato_id, alvo, tipo, grau, hipotese, razoes, data_producao, prazo_fim, fundamento, codigo_indexacao, situacao, versao, classificada_por)
       VALUES
         ($1, $2, 'contrato', 'lai', 'reservada', 'seguranca_sociedade_estado', 'Operação de inteligência de segurança pública.', '2026-11-01', '2031-11-01', 'LAI, art. 23, VIII', 'CID-888-2026', 'vigente', 1, $3)`,
      [alvo.processo_id, alvo.id, admin.sessao.usuario.id],
    );

    const r = await app.inject({ method: 'GET', url: '/api/v1/publico/ordem-cronologica?mes=2026-11' });
    assert.equal(r.statusCode, 200);
    const resp = r.json<OrdemCronologicaPublicaResposta>();

    const nota = resp.uasgs
      .flatMap((u) => u.fontes.flatMap((f) => f.notas))
      .find((n) => n.id === alvo.pagamento_id);
    assert.ok(nota);
    assert.match(nota.objeto, /Informação classificada/);
    assert.match(nota.fornecedor.razaoSocial, /Informação classificada/);
    assert.equal(nota.fornecedor.cnpj, null);
    assert.equal(nota.fornecedor.cpf, null);
  });

  test('TAREFA A: nota técnica de preços divulgada após homologação mesmo com orçamento sigiloso, exceto com sigilo LAI vigente', async () => {
    // 1. Processo com orçamento sigiloso homologado: divulga a nota técnica de preços
    const [proc1] = await app.agora.banco.consultar<{ id: string }>(
      "SELECT id FROM processos WHERE publicacao->>'pncp' = 'publicado' LIMIT 1",
    );
    assert.ok(proc1);

    await app.agora.banco.executar(
      `UPDATE processos
          SET selecao = '{"homologacao": {"data": "2026-11-08"}, "preparatoriosDivulgadosEm": "2026-11-08T15:00:00.000Z"}'::jsonb,
              cesta = jsonb_set(cesta, '{orcamentoSigiloso}', 'true')
        WHERE id = $1`,
      [proc1.id],
    );

    await app.agora.banco.executar(
      `INSERT INTO documentos_gerados (processo_id, tipo, versao, situacao, titulo, conteudo, gerado_por)
       VALUES ($1, 'nota_tecnica_precos', 1, 'aprovado', 'Nota técnica de preços', 'Nota técnica de preços com pesquisa de mercado consolidada.', 'modelo')
       ON CONFLICT (processo_id, tipo, versao) DO UPDATE SET situacao = 'aprovado'`,
      [proc1.id],
    );

    const rEdital1 = await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${proc1.id}` });
    assert.equal(rEdital1.statusCode, 200);
    const edital1 = rEdital1.json<EditalPublico>();
    const docNota = edital1.documentosPreparatorios.find((d) => d.tipo === 'nota_tecnica_precos');
    assert.ok(docNota, 'nota_tecnica_precos deve ser divulgada após homologação mesmo com orçamento sigiloso (art. 24 e 54)');

    const rPdf = await app.inject({ method: 'GET', url: docNota.url });
    assert.equal(rPdf.statusCode, 200);
    assert.equal(rPdf.headers['content-type'], 'application/pdf');

    // 2. Processo com sigilo LAI vigente: NÃO divulga nota_tecnica_precos
    const [proc2] = await app.agora.banco.consultar<{ id: string }>(
      "SELECT id FROM processos WHERE id <> $1 AND publicacao->>'pncp' = 'publicado' LIMIT 1",
      [proc1.id],
    );
    assert.ok(proc2);

    await app.agora.banco.executar(
      `UPDATE processos
          SET selecao = '{"homologacao": {"data": "2026-11-08"}, "preparatoriosDivulgadosEm": "2026-11-08T15:00:00.000Z"}'::jsonb,
              cesta = jsonb_set(cesta, '{orcamentoSigiloso}', 'true')
        WHERE id = $1`,
      [proc2.id],
    );

    await app.agora.banco.executar(
      `INSERT INTO documentos_gerados (processo_id, tipo, versao, situacao, titulo, conteudo, gerado_por)
       VALUES ($1, 'nota_tecnica_precos', 1, 'aprovado', 'Nota técnica de preços', 'Nota técnica com valores e metodologia sigilosa.', 'modelo')
       ON CONFLICT (processo_id, tipo, versao) DO UPDATE SET situacao = 'aprovado'`,
      [proc2.id],
    );

    // Classifica processo com LAI vigente
    await app.agora.banco.executar(
      `INSERT INTO sigilo_classificacoes
         (processo_id, alvo, tipo, grau, hipotese, razoes, data_producao, prazo_fim, fundamento, codigo_indexacao, situacao, versao, classificada_por)
       VALUES
         ($1, 'processo', 'lai', 'secreta', 'seguranca_sociedade_estado', 'Segurança pública e sigilo operacional.', '2026-11-01', '2041-11-01', 'LAI, art. 23, VIII', 'CID-LAI-001', 'vigente', 1, $2)`,
      [proc2.id, admin.sessao.usuario.id],
    );

    const rEditalLai = await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${proc2.id}` });
    assert.equal(rEditalLai.statusCode, 200);
    const editalLai = rEditalLai.json<EditalPublico>();
    const docNotaLai = editalLai.documentosPreparatorios.find((d) => d.tipo === 'nota_tecnica_precos');
    assert.equal(docNotaLai, undefined, 'processo com sigilo LAI vigente não deve divulgar nota técnica de preços');

    // Ao tentar acessar a URL do PDF de nota técnica, deve responder 404
    const rPdfLai = await app.inject({ method: 'GET', url: `/api/v1/publico/editais/${proc2.id}/preparatorios/nota_tecnica_precos` });
    assert.equal(rPdfLai.statusCode, 404);
  });
});
