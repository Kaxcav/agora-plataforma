/**
 * Extensão dos efeitos da sanção (RN-27; Lei 14.133/2021, art. 160): proposta a partir de um sinal, contraditório e
 * ampla defesa com prazo, análise jurídica prévia e decisão da autoridade competente. Só a decisão de estender
 * registra a sanção para o alcançado no módulo de sanções, e cada passo gera evento na trilha de auditoria.
 */
import {
  avancarExtensaoSancao,
  efeitosExtensaoSancao,
  mesmaPessoaQsa,
  prazoRegistroCeisCnep,
  proporExtensaoSancao,
  somenteDigitos,
  type AcaoExtensaoSancao,
} from '@agora/dominio';
import type { ExtensaoSancao, TipoSancao } from '@agora/contratos';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoUasgs, exigir, sessaoDe } from '../../autorizacao/exigir.ts';
import type { Transacao } from '../../banco/tipos.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado, regraNegocio } from '../../http/erros.ts';
import { dataIso, idDaRota, uuid } from '../../http/validacao.ts';
import { listarExtensoes, paraExtensao } from './repositorio.ts';

const ALVOS = ['administrador', 'socio_administrador', 'sucessora', 'coligada_controlada'] as const;
const ALVOS_PESSOA_JURIDICA: readonly string[] = ['sucessora', 'coligada_controlada'];

const esquemaProposta = z.object({
  sancaoOrigemId: uuid,
  alvo: z.enum(ALVOS),
  alvoFornecedorId: uuid.nullable(),
  alvoIntegranteId: uuid.nullable(),
  fundamentacao: z.string().trim().min(50).max(5000),
  sinal: z.string().trim().max(3000).nullable().transform((v) => (v ? v : null)),
  intimacaoEm: dataIso,
});
const esquemaDefesa = z.object({ apresentada: z.boolean(), resumo: z.string().trim().max(5000).nullable().transform((v) => (v ? v : null)) });
const esquemaParecer = z.object({ conclusao: z.enum(['favoravel', 'desfavoravel']), texto: z.string().trim().min(30).max(10_000) });
const esquemaDecisao = z.object({ resultado: z.enum(['estender', 'nao_estender']), motivacao: z.string().trim().min(30).max(10_000) });
const esquemaArquivar = z.object({ motivo: z.string().trim().min(20).max(5000) });

interface SancaoOrigem {
  id: string;
  fornecedor_id: string;
  razao_social: string;
  inciso_infracao: string;
  tipo: TipoSancao;
  situacao: 'em_instrucao' | 'defesa' | 'decisao' | 'aplicada' | 'arquivada';
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
}

const ROTULO_ALVO: Record<(typeof ALVOS)[number], string> = {
  administrador: 'administrador',
  socio_administrador: 'sócio com poderes de administração',
  sucessora: 'pessoa jurídica sucessora',
  coligada_controlada: 'empresa coligada ou controlada',
};

/** Sanção de origem no escopo de UASG de quem pede (sanção ligada a contrato segue a UASG do contrato). */
async function sancaoOrigem(tx: Transacao, id: string, escopo: string[] | null): Promise<SancaoOrigem> {
  const [s] = await tx.consultar<SancaoOrigem>(
    `SELECT s.id, s.fornecedor_id, f.razao_social, s.inciso_infracao, s.tipo, s.situacao, s.inicio_vigencia, s.fim_vigencia
       FROM sancoes s JOIN fornecedores f ON f.id = s.fornecedor_id LEFT JOIN contratos c ON c.id = s.contrato_id
      WHERE s.id = $1 AND ($2::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($2::text[]))`,
    [id, escopo],
  );
  if (!s) throw naoEncontrado('Sanção de origem não encontrada.');
  return s;
}

function origemDominio(s: SancaoOrigem) {
  return { tipo: s.tipo, situacao: s.situacao, inicioVigencia: s.inicio_vigencia, fimVigencia: s.fim_vigencia };
}

/**
 * Administrador ou sócio com poderes de administração da sancionada, pelo quadro societário. Quando a linha vem dos
 * dados abertos (CPF parcial), o CPF completo precisa constar do cadastro do fornecedor (mesmos dígitos centrais e nome).
 */
async function pessoaAlvo(tx: Transacao, fornecedorId: string, integranteId: string): Promise<{ nome: string; cpf: string; qualificacao: string }> {
  const [doCadastro] = await tx.consultar<{ nome: string; cpf: string; qualificacao: string }>(
    'SELECT nome, cpf, qualificacao FROM fornecedores_socios WHERE id = $1 AND fornecedor_id = $2',
    [integranteId, fornecedorId],
  );
  if (doCadastro) return doCadastro;
  const [doQsa] = await tx.consultar<{ nome: string; documento_parcial: string; qualificacao: string }>(
    'SELECT nome, documento_parcial, qualificacao FROM fornecedores_qsa WHERE id = $1 AND fornecedor_id = $2',
    [integranteId, fornecedorId],
  );
  if (!doQsa) throw naoEncontrado('A pessoa indicada não consta do quadro societário da empresa sancionada.');
  const socios = await tx.consultar<{ nome: string; cpf: string }>('SELECT nome, cpf FROM fornecedores_socios WHERE fornecedor_id = $1', [fornecedorId]);
  const correspondente = socios.find((s) => mesmaPessoaQsa({ documento: s.cpf, nome: s.nome }, { documento: doQsa.documento_parcial, nome: doQsa.nome }));
  if (!correspondente) {
    throw regraNegocio('O CPF completo dessa pessoa não consta do cadastro do fornecedor: registre-o a partir dos documentos do processo antes de propor a extensão.');
  }
  return { nome: correspondente.nome, cpf: correspondente.cpf, qualificacao: doQsa.qualificacao };
}

/** Fornecedor (pessoa física) que recebe a sanção estendida: o existente com o mesmo CPF ou um novo cadastro. */
async function fornecedorDaPessoa(tx: Transacao, nome: string, cpf: string): Promise<string> {
  await tx.executar(
    `INSERT INTO fornecedores (documento, tipo_pessoa, razao_social, busca_normalizada, fonte_dados)
     VALUES ($1, 'PF', $2, '', 'AGORA') ON CONFLICT (documento) DO NOTHING`,
    [somenteDigitos(cpf), nome],
  );
  const [f] = await tx.consultar<{ id: string }>('SELECT id FROM fornecedores WHERE documento = $1', [somenteDigitos(cpf)]);
  if (!f) throw new Error('Falha ao localizar o cadastro da pessoa física');
  return f.id;
}

export async function rotasExtensoes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('impedimentos:ler') };
  const instrucao = { preHandler: exigir('sancoes:instruir') };
  const parecer = { preHandler: exigir('impedimentos:parecer') };
  const decisao = { preHandler: exigir('impedimentos:decidir') };

  async function obter(id: string, escopo: string[] | null): Promise<ExtensaoSancao> {
    const [linha] = await listarExtensoes(ctx.banco, { id, escopo });
    if (!linha) throw naoEncontrado('Procedimento de extensão não encontrado.');
    return paraExtensao(linha);
  }

  /** Passo do rito numa transação: trava o procedimento, aplica a transição do domínio, grava e audita. */
  async function avancar(
    request: FastifyRequest,
    acao: AcaoExtensaoSancao,
    extra: { defesaApresentada?: boolean; decisao?: 'estender' | 'nao_estender' },
    gravar: (tx: Transacao, e: ExtensaoSancao, novaSituacao: ExtensaoSancao['situacao']) => Promise<{ resumo: string; dados: Record<string, string | number | boolean | null> }>,
  ): Promise<ExtensaoSancao> {
    const id = idDaRota(request.params);
    const usuarioId = sessaoDe(request).usuario.id;
    const escopo = escopoUasgs(sessaoDe(request));
    await ctx.banco.transacao(async (tx) => {
      const [linha] = await listarExtensoes(tx, { id, escopo }, true);
      if (!linha) throw naoEncontrado('Procedimento de extensão não encontrado.');
      const atual = paraExtensao(linha);
      const transicao = avancarExtensaoSancao({
        situacao: atual.situacao,
        acao,
        hoje: ctx.hoje(),
        prazoDefesa: atual.prazoDefesa,
        autorId: usuarioId,
        propostoPorId: linha.proposto_por,
        pareceristaId: linha.parecerista_id,
        ...extra,
      });
      const evento = await gravar(tx, atual, transicao.situacao);
      await tx.executar('UPDATE extensoes_sancao SET situacao = $2 WHERE id = $1', [id, transicao.situacao]);
      await auditar(tx, request, {
        acao: `impedimentos.extensao.${acao}`,
        recurso: 'extensao_sancao',
        recursoId: id,
        resumo: evento.resumo,
        dados: { sancaoOrigemId: atual.sancaoOrigem.id, de: atual.situacao, para: transicao.situacao, fundamento: transicao.fundamento, ...evento.dados },
      });
    });
    return obter(id, escopo);
  }

  app.get('/impedimentos/extensoes', leitura, async (request): Promise<ExtensaoSancao[]> =>
    (await listarExtensoes(ctx.banco, { escopo: escopoUasgs(sessaoDe(request)) })).map(paraExtensao),
  );

  app.get('/impedimentos/extensoes/:id', leitura, async (request): Promise<ExtensaoSancao> => obter(idDaRota(request.params), escopoUasgs(sessaoDe(request))));

  /** Proposta de extensão (art. 160): abre o contraditório com prazo de defesa de 15 dias úteis. Não estende nada. */
  app.post('/impedimentos/extensoes', instrucao, async (request, reply): Promise<ExtensaoSancao> => {
    const e = esquemaProposta.parse(request.body);
    const usuarioId = sessaoDe(request).usuario.id;
    const escopo = escopoUasgs(sessaoDe(request));
    const calendario = await opcoesCalendario(ctx.banco);
    const id = await ctx.banco.transacao(async (tx) => {
      const origem = await sancaoOrigem(tx, e.sancaoOrigemId.toLowerCase(), escopo);
      const proposta = proporExtensaoSancao(
        { sancaoOrigem: origemDominio(origem), alvo: e.alvo, fundamentacao: e.fundamentacao, intimacaoEm: e.intimacaoEm, hoje: ctx.hoje() },
        calendario,
      );
      let alvoFornecedorId: string | null = null;
      let pessoa: { nome: string; cpf: string } | null = null;
      if (ALVOS_PESSOA_JURIDICA.includes(e.alvo)) {
        if (e.alvoFornecedorId === null) throw regraNegocio('Indique a empresa a ser alcançada pela extensão.');
        alvoFornecedorId = e.alvoFornecedorId.toLowerCase();
        const [alvo] = await tx.consultar<{ tipo_pessoa: 'PJ' | 'PF' }>('SELECT tipo_pessoa FROM fornecedores WHERE id = $1', [alvoFornecedorId]);
        if (!alvo) throw naoEncontrado('Empresa indicada não encontrada.');
        if (alvo.tipo_pessoa !== 'PJ') throw regraNegocio('Sucessora, coligada ou controlada é pessoa jurídica.');
        if (alvoFornecedorId === origem.fornecedor_id) throw regraNegocio('A empresa indicada é a própria sancionada.');
      } else {
        if (e.alvoIntegranteId === null) throw regraNegocio('Indique o administrador ou sócio com poderes de administração no quadro societário.');
        const p = await pessoaAlvo(tx, origem.fornecedor_id, e.alvoIntegranteId.toLowerCase());
        if (p.qualificacao === 'socio') {
          throw regraNegocio('Sócio sem poderes de administração não é alcançado pela extensão (art. 160): indique administrador ou sócio-administrador.');
        }
        pessoa = { nome: p.nome, cpf: p.cpf };
      }
      const [duplicada] = await tx.consultar<{ id: string }>(
        `SELECT id FROM extensoes_sancao
          WHERE sancao_origem_id = $1 AND situacao IN ('contraditorio', 'analise_juridica', 'decisao', 'estendida')
            AND (alvo_fornecedor_id = $2 OR alvo_pessoa_cpf = $3)`,
        [origem.id, alvoFornecedorId, pessoa?.cpf ?? null],
      );
      if (duplicada) throw conflito('Já existe procedimento de extensão desta sanção para o mesmo alcançado.');
      const [criada] = await tx.consultar<{ id: string }>(
        `INSERT INTO extensoes_sancao (sancao_origem_id, alvo, alvo_fornecedor_id, alvo_pessoa_nome, alvo_pessoa_cpf, situacao, fundamentacao,
                                       sinal, intimacao_em, prazo_defesa, proposto_por, proposta_em)
         VALUES ($1, $2, $3, $4, $5, 'contraditorio', $6, $7, $8, $9, $10, $11) RETURNING id`,
        [origem.id, e.alvo, alvoFornecedorId, pessoa?.nome ?? null, pessoa?.cpf ?? null, e.fundamentacao, e.sinal, e.intimacaoEm, proposta.prazoDefesa, usuarioId, ctx.relogio().toISOString()],
      );
      if (!criada) throw new Error('Falha ao registrar a proposta de extensão');
      await auditar(tx, request, {
        acao: 'impedimentos.extensao.propor',
        recurso: 'extensao_sancao',
        recursoId: criada.id,
        resumo: `Propôs estender a sanção de ${origem.razao_social} a ${ROTULO_ALVO[e.alvo]} (art. 160) e abriu o contraditório`,
        dados: {
          sancaoOrigemId: origem.id,
          alvo: e.alvo,
          alvoFornecedorId,
          pessoaAlcancada: pessoa !== null,
          intimacaoEm: e.intimacaoEm,
          prazoDefesa: proposta.prazoDefesa,
          fundamento: proposta.fundamento,
        },
      });
      return criada.id;
    });
    reply.status(201);
    return obter(id, escopo);
  });

  app.post('/impedimentos/extensoes/:id/defesa', instrucao, async (request) => {
    const e = esquemaDefesa.parse(request.body);
    if (e.apresentada && (e.resumo === null || e.resumo.length < 20)) throw regraNegocio('Resuma a defesa apresentada (pelo menos 20 caracteres).');
    return avancar(request, 'registrar_defesa', { defesaApresentada: e.apresentada }, async (tx, atual) => {
      await tx.executar('UPDATE extensoes_sancao SET defesa_apresentada = $2, defesa_resumo = $3, defesa_registrada_em = $4 WHERE id = $1', [
        atual.id,
        e.apresentada,
        e.resumo,
        ctx.relogio().toISOString(),
      ]);
      return {
        resumo: e.apresentada ? 'Registrou a defesa do interessado e encaminhou à análise jurídica' : 'Registrou o fim do prazo sem defesa e encaminhou à análise jurídica',
        dados: { defesaApresentada: e.apresentada },
      };
    });
  });

  app.post('/impedimentos/extensoes/:id/parecer', parecer, async (request) => {
    const e = esquemaParecer.parse(request.body);
    return avancar(request, 'registrar_parecer', {}, async (tx, atual) => {
      await tx.executar('UPDATE extensoes_sancao SET parecer_conclusao = $2, parecer_texto = $3, parecerista_id = $4, parecer_em = $5 WHERE id = $1', [
        atual.id,
        e.conclusao,
        e.texto,
        sessaoDe(request).usuario.id,
        ctx.relogio().toISOString(),
      ]);
      return { resumo: `Registrou a análise jurídica prévia (${e.conclusao === 'favoravel' ? 'favorável' : 'desfavorável'} à extensão)`, dados: { conclusao: e.conclusao } };
    });
  });

  /** Decisão da autoridade competente. Estender registra a sanção para o alcançado, com a vigência restante da origem. */
  app.post('/impedimentos/extensoes/:id/decisao', decisao, async (request) => {
    const e = esquemaDecisao.parse(request.body);
    const usuarioId = sessaoDe(request).usuario.id;
    const calendario = await opcoesCalendario(ctx.banco);
    return avancar(request, 'decidir', { decisao: e.resultado }, async (tx, atual) => {
      const hoje = ctx.hoje();
      let sancaoEstendidaId: string | null = null;
      if (e.resultado === 'estender') {
        const origem = await sancaoOrigem(tx, atual.sancaoOrigem.id, null);
        const efeitos = efeitosExtensaoSancao(origemDominio(origem), hoje);
        const [linha] = await tx.consultar<{ alvo_fornecedor_id: string | null; alvo_pessoa_nome: string | null; alvo_pessoa_cpf: string | null }>(
          'SELECT alvo_fornecedor_id, alvo_pessoa_nome, alvo_pessoa_cpf FROM extensoes_sancao WHERE id = $1',
          [atual.id],
        );
        if (!linha) throw naoEncontrado('Procedimento de extensão não encontrado.');
        const fornecedorId =
          linha.alvo_fornecedor_id ??
          (linha.alvo_pessoa_nome !== null && linha.alvo_pessoa_cpf !== null ? await fornecedorDaPessoa(tx, linha.alvo_pessoa_nome, linha.alvo_pessoa_cpf) : null);
        if (fornecedorId === null) throw regraNegocio('O procedimento não identifica quem é alcançado pela extensão.');
        const [criada] = await tx.consultar<{ id: string }>(
          `INSERT INTO sancoes (fornecedor_id, contrato_id, inciso_infracao, tipo, situacao, intimacao_em, aplicada_em, inicio_vigencia, fim_vigencia,
                                prazo_defesa, prazo_registro_ceis_cnep, registrada_ceis_cnep, instaurada_em, relato, criada_por)
           VALUES ($1, NULL, $2, $3, 'aplicada', $4, $5, $6, $7, $8, $9, false, $10, $11, $12) RETURNING id`,
          [
            fornecedorId,
            origem.inciso_infracao,
            efeitos.tipo,
            atual.intimacaoEm,
            hoje,
            efeitos.inicioVigencia,
            efeitos.fimVigencia,
            atual.prazoDefesa,
            prazoRegistroCeisCnep(hoje, calendario).vencimento,
            atual.propostaEm.slice(0, 10),
            `Extensão dos efeitos da sanção aplicada a ${origem.razao_social} (art. 160 da Lei 14.133/2021), decidida pela autoridade competente após contraditório, ampla defesa e análise jurídica prévia. Motivação: ${e.motivacao}`,
            usuarioId,
          ],
        );
        if (!criada) throw new Error('Falha ao registrar a sanção estendida');
        sancaoEstendidaId = criada.id;
        await auditar(tx, request, {
          acao: 'sancao.estender',
          recurso: 'sancao',
          recursoId: criada.id,
          resumo: `Registrou a sanção estendida por decisão da autoridade competente (art. 160), a partir da sanção de ${origem.razao_social}`,
          dados: { sancaoOrigemId: origem.id, extensaoId: atual.id, tipo: efeitos.tipo, inicioVigencia: efeitos.inicioVigencia, fimVigencia: efeitos.fimVigencia },
        });
      }
      await tx.executar(
        'UPDATE extensoes_sancao SET decisao_resultado = $2, decisao_motivacao = $3, autoridade_id = $4, decidida_em = $5, sancao_estendida_id = $6 WHERE id = $1',
        [atual.id, e.resultado, e.motivacao, usuarioId, ctx.relogio().toISOString(), sancaoEstendidaId],
      );
      return {
        resumo: e.resultado === 'estender' ? 'Decidiu estender os efeitos da sanção (art. 160)' : 'Decidiu não estender os efeitos da sanção (art. 160)',
        dados: { resultado: e.resultado, sancaoEstendidaId, parecer: atual.parecer?.conclusao ?? null },
      };
    });
  });

  app.post('/impedimentos/extensoes/:id/arquivar', instrucao, async (request) => {
    const e = esquemaArquivar.parse(request.body);
    return avancar(request, 'arquivar', {}, async (tx, atual) => {
      await tx.executar('UPDATE extensoes_sancao SET arquivamento_motivo = $2, arquivada_em = $3 WHERE id = $1', [atual.id, e.motivo, ctx.relogio().toISOString()]);
      return { resumo: 'Arquivou o procedimento de extensão de sanção', dados: { motivo: e.motivo } };
    });
  });
}
