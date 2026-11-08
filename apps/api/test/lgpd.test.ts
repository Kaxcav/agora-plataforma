import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type {
  EventoAuditoria,
  FornecedorDetalhe,
  FornecedorResumo,
  Pagina,
  PaginaEmpenhos,
  RegistroAcessoDadoPessoal,
  RespostaErro,
  RespostaRevelar,
  UsuarioAdmin,
} from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

const CPF_MASCARADO = /^\*\*\*\.\d{3}\.\d{3}-\*\*$/;
const CNPJ_FORMATADO = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

describe('LGPD: mascaramento por padrão e revelação registrada', () => {
  let app: FastifyInstance;
  let auditor: Credenciais;
  let gestor: Credenciais;
  let fornecedorPf: FornecedorResumo;
  let cpfReal: string;

  before(async () => {
    app = await criarAppTeste();
    auditor = await entrar(app, 'auditor@agora.demo');
    gestor = await entrar(app, 'gestor@agora.demo');
    const lista = await obterJson<Pagina<FornecedorResumo>>(app, gestor, '/api/v1/fornecedores?tamanhoPagina=100');
    const pf = lista.itens.find((f) => f.tipoPessoa === 'PF');
    assert.ok(pf);
    fornecedorPf = pf;
    const [linha] = await app.agora.banco.consultar<{ documento: string; razao_social: string }>(
      'SELECT documento, razao_social FROM fornecedores WHERE id = $1',
      [pf.id],
    );
    assert.ok(linha);
    cpfReal = linha.documento;
  });
  after(async () => {
    await app.close();
  });

  test('fornecedores: CPF e nome de pessoa física mascarados; CNPJ formatado', async () => {
    const lista = await obterJson<Pagina<FornecedorResumo>>(app, gestor, '/api/v1/fornecedores?tamanhoPagina=100');
    const [cadastro] = await app.agora.banco.consultar<{ total: number }>('SELECT COUNT(*)::integer AS total FROM fornecedores');
    assert.equal(lista.total, cadastro?.total, 'todos os fornecedores da carga sintética');
    assert.ok(lista.total >= 30);
    for (const f of lista.itens) {
      if (f.tipoPessoa === 'PF') {
        assert.match(f.documento, CPF_MASCARADO);
        assert.match(f.razaoSocial, /^\S+ (\p{Lu}\. ?)+$/u, `nome mascarado: ${f.razaoSocial}`);
      } else {
        assert.match(f.documento, CNPJ_FORMATADO);
      }
    }
    const detalhe = await obterJson<FornecedorDetalhe>(app, gestor, `/api/v1/fornecedores/${fornecedorPf.id}`);
    assert.match(detalhe.documento, CPF_MASCARADO);
    const texto = JSON.stringify(detalhe);
    assert.ok(!texto.includes(cpfReal), 'o CPF completo não aparece no detalhe');
    assert.ok(!/@/.test(texto), 'e-mail do fornecedor não é exposto');

    const empenhos = await obterJson<PaginaEmpenhos>(app, gestor, '/api/v1/empenhos?tamanhoPagina=100');
    for (const e of empenhos.itens) assert.ok(CPF_MASCARADO.test(e.credor.documento) || CNPJ_FORMATADO.test(e.credor.documento));
  });

  test('usuários: CPF sempre mascarado', async () => {
    const admin = await entrar(app, 'admin@agora.demo');
    const usuarios = await obterJson<Pagina<UsuarioAdmin>>(app, admin, '/api/v1/usuarios?tamanhoPagina=100');
    assert.equal(usuarios.total, 17);
    assert.ok(usuarios.itens.every((u) => CPF_MASCARADO.test(u.cpf)));
  });

  test('revelar exige a permissão lgpd:revelar', async () => {
    const r = await chamar(app, gestor, 'POST', '/api/v1/lgpd/revelar', {
      recurso: 'fornecedor',
      id: fornecedorPf.id,
      campo: 'documento',
      finalidade: 'Instrução de processo sancionatório',
    });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json<RespostaErro>().erro.codigo, 'SEM_PERMISSAO');
  });

  test('revelar exige finalidade (10 a 300 caracteres)', async () => {
    const semFinalidade = await chamar(app, auditor, 'POST', '/api/v1/lgpd/revelar', { recurso: 'fornecedor', id: fornecedorPf.id, campo: 'documento' });
    assert.equal(semFinalidade.statusCode, 400);
    const curta = await chamar(app, auditor, 'POST', '/api/v1/lgpd/revelar', { recurso: 'fornecedor', id: fornecedorPf.id, campo: 'documento', finalidade: 'ver' });
    assert.equal(curta.statusCode, 400);
    assert.equal(curta.json<RespostaErro>().erro.detalhes?.[0]?.campo, 'finalidade');
  });

  test('revelação devolve o valor completo e é registrada em lgpd_acessos e na trilha', async () => {
    const finalidade = 'Conferência cadastral para instrução de processo sancionatório';
    const r = await chamar(app, auditor, 'POST', '/api/v1/lgpd/revelar', { recurso: 'fornecedor', id: fornecedorPf.id, campo: 'documento', finalidade });
    assert.equal(r.statusCode, 200);
    const revelado = r.json<RespostaRevelar>();
    assert.equal(revelado.valor.replace(/\D/g, ''), cpfReal);
    assert.match(revelado.valor, /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);

    const acessos = await obterJson<Pagina<RegistroAcessoDadoPessoal>>(app, auditor, '/api/v1/lgpd/acessos');
    const registro = acessos.itens.find((a) => a.id === revelado.registroAcessoId);
    assert.ok(registro);
    assert.equal(registro.finalidade, finalidade);
    assert.equal(registro.campo, 'documento');
    assert.equal(registro.usuario.id, auditor.sessao.usuario.id);

    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=lgpd.revelar');
    const evento = trilha.itens.find((e) => e.recursoId === fornecedorPf.id);
    assert.ok(evento);
    const [dados] = await app.agora.banco.consultar<{ dados: Record<string, unknown> }>('SELECT dados FROM auditoria_eventos WHERE id = $1', [evento.id]);
    assert.equal(dados?.dados.registroAcessoId, revelado.registroAcessoId);
    assert.ok(!JSON.stringify(dados).includes(cpfReal), 'o valor revelado não vai para a trilha');

    const campoInexistente = await chamar(app, auditor, 'POST', '/api/v1/lgpd/revelar', {
      recurso: 'credor_empenho',
      id: '00000000-0000-4000-8000-000000000000',
      campo: 'documento',
      finalidade,
    });
    assert.equal(campoInexistente.statusCode, 404);
    assert.equal((await chamar(app, gestor, 'GET', '/api/v1/lgpd/acessos')).statusCode, 403);
  });
});
