import { feriadosNacionais } from '@agora/dominio';
import type { Feriado, GrupoUasg, ModeloGestao, UnidadeInterna } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exigir } from '../../autorizacao/exigir.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { inserirEmLote } from '../../banco/lote.ts';
import { auditar } from '../../http/auditar.ts';
import { conflito, naoEncontrado } from '../../http/erros.ts';
import { dataIso, idDaRota } from '../../http/validacao.ts';

// ───────────────────────── Modelos de gestão ─────────────────────────

const esquemaTarefaModelo = z.object({
  titulo: z.string().trim().min(3).max(200),
  macrotarefa: z.string().trim().min(2).max(100),
  diasRelativos: z.number().int().min(-3650).max(3650),
  papelResponsavel: z.enum(['gestor', 'fiscal', 'financeiro']),
});

const esquemaModelo = z.object({
  tipo: z.enum(['ata', 'contrato']),
  nome: z.string().trim().min(3).max(200),
  evento: z.enum(['assinatura', 'inicio_vigencia', 'mensal', 'reajuste', 'fim_vigencia']),
  ativo: z.boolean(),
  tarefas: z.array(esquemaTarefaModelo).max(100),
});

interface LinhaModelo {
  id: string;
  tipo: ModeloGestao['tipo'];
  nome: string;
  evento: ModeloGestao['evento'];
  ativo: boolean;
}

interface LinhaTarefaModelo {
  modelo_id: string;
  titulo: string;
  macrotarefa: string;
  dias_relativos: number;
  papel_responsavel: 'gestor' | 'fiscal' | 'financeiro';
}

async function listarModelos(executor: Executor, filtro: { tipo?: 'ata' | 'contrato' | undefined; id?: string | undefined }): Promise<ModeloGestao[]> {
  const modelos = await executor.consultar<LinhaModelo>(
    `SELECT id, tipo, nome, evento, ativo FROM modelos_gestao
      WHERE ($1::text IS NULL OR tipo = $1) AND ($2::uuid IS NULL OR id = $2)
      ORDER BY tipo, nome`,
    [filtro.tipo ?? null, filtro.id ?? null],
  );
  if (modelos.length === 0) return [];
  const tarefas = await executor.consultar<LinhaTarefaModelo>(
    `SELECT modelo_id, titulo, macrotarefa, dias_relativos, papel_responsavel
       FROM modelos_gestao_tarefas WHERE modelo_id = ANY($1::uuid[]) ORDER BY ordem`,
    [modelos.map((m) => m.id)],
  );
  return modelos.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    nome: m.nome,
    evento: m.evento,
    ativo: m.ativo,
    tarefas: tarefas
      .filter((t) => t.modelo_id === m.id)
      .map((t) => ({ titulo: t.titulo, macrotarefa: t.macrotarefa, diasRelativos: t.dias_relativos, papelResponsavel: t.papel_responsavel })),
  }));
}

async function gravarTarefasModelo(tx: Transacao, modeloId: string, tarefas: z.infer<typeof esquemaModelo>['tarefas']): Promise<void> {
  await tx.executar('DELETE FROM modelos_gestao_tarefas WHERE modelo_id = $1', [modeloId]);
  await inserirEmLote(
    tx,
    'modelos_gestao_tarefas',
    ['modelo_id', 'ordem', 'titulo', 'macrotarefa', 'dias_relativos', 'papel_responsavel'],
    tarefas.map((t, i) => [modeloId, i + 1, t.titulo, t.macrotarefa, t.diasRelativos, t.papelResponsavel]),
  );
}

// ───────────────────────── Unidades internas ─────────────────────────

const esquemaUnidadeNova = z.object({ sigla: z.string().trim().min(2).max(20), nome: z.string().trim().min(3).max(200) });
const esquemaUnidade = esquemaUnidadeNova.extend({ ativa: z.boolean() });

async function listarUnidades(executor: Executor, id?: string): Promise<UnidadeInterna[]> {
  return executor.consultar<UnidadeInterna>(
    `SELECT ui.id, ui.sigla, ui.nome, ui.ativa,
            (SELECT COUNT(*) FROM usuarios u WHERE u.unidade_interna_id = ui.id)::integer AS usuarios
       FROM unidades_internas ui
      WHERE ($1::uuid IS NULL OR ui.id = $1)
      ORDER BY ui.sigla`,
    [id ?? null],
  );
}

// ───────────────────────── Grupos de UASG ─────────────────────────

async function listarGrupos(executor: Executor, id?: string): Promise<GrupoUasg[]> {
  const grupos = await executor.consultar<{ id: string; nome: string; situacao: GrupoUasg['situacao'] }>(
    `SELECT id, nome, situacao FROM grupos_uasg WHERE ($1::uuid IS NULL OR id = $1) ORDER BY nome`,
    [id ?? null],
  );
  if (grupos.length === 0) return [];
  const membros = await executor.consultar<{ grupo_id: string; codigo: string; nome: string; sigla: string; uf: string }>(
    `SELECT m.grupo_id, u.codigo, u.nome, u.sigla, u.uf
       FROM grupos_uasg_membros m JOIN uasgs u ON u.codigo = m.uasg
      WHERE m.grupo_id = ANY($1::uuid[])
      ORDER BY u.codigo`,
    [grupos.map((g) => g.id)],
  );
  return grupos.map((g) => ({
    ...g,
    uasgs: membros.filter((m) => m.grupo_id === g.id).map((m) => ({ codigo: m.codigo, nome: m.nome, sigla: m.sigla, uf: m.uf })),
  }));
}

// ───────────────────────── Feriados ─────────────────────────

const esquemaFeriado = z.object({ data: dataIso, nome: z.string().trim().min(3).max(120) });

export async function rotasAjustes(app: FastifyInstance): Promise<void> {
  const ctx = app.agora;
  const leitura = { preHandler: exigir('painel:ler') };
  const escrita = { preHandler: exigir('ajustes:editar') };

  app.get('/modelos-gestao', leitura, async (request) => {
    const { tipo } = z.object({ tipo: z.enum(['ata', 'contrato']).optional() }).parse(request.query);
    return listarModelos(ctx.banco, { tipo });
  });

  app.post('/modelos-gestao', escrita, async (request, reply): Promise<ModeloGestao> => {
    const entrada = esquemaModelo.parse(request.body);
    const id = await ctx.banco.transacao(async (tx) => {
      const [criado] = await tx.consultar<{ id: string }>(
        'INSERT INTO modelos_gestao (tipo, nome, evento, ativo) VALUES ($1, $2, $3, $4) RETURNING id',
        [entrada.tipo, entrada.nome, entrada.evento, entrada.ativo],
      );
      if (!criado) throw new Error('Falha ao criar modelo de gestão');
      await gravarTarefasModelo(tx, criado.id, entrada.tarefas);
      await auditar(tx, request, {
        acao: 'modelo_gestao.criar',
        recurso: 'modelo_gestao',
        recursoId: criado.id,
        resumo: `Criou o modelo de gestão "${entrada.nome}"`,
        dados: { tipo: entrada.tipo, evento: entrada.evento, ativo: entrada.ativo, tarefas: entrada.tarefas.length },
      });
      return criado.id;
    });
    const [modelo] = await listarModelos(ctx.banco, { id });
    if (!modelo) throw naoEncontrado();
    reply.status(201);
    return modelo;
  });

  app.put('/modelos-gestao/:id', escrita, async (request): Promise<ModeloGestao> => {
    const id = idDaRota(request.params);
    const entrada = esquemaModelo.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const [antes] = await tx.consultar<LinhaModelo>('SELECT id, tipo, nome, evento, ativo FROM modelos_gestao WHERE id = $1 FOR UPDATE', [id]);
      if (!antes) throw naoEncontrado('Modelo de gestão não encontrado.');
      await tx.executar(
        'UPDATE modelos_gestao SET tipo = $2, nome = $3, evento = $4, ativo = $5, atualizado_em = $6 WHERE id = $1',
        [id, entrada.tipo, entrada.nome, entrada.evento, entrada.ativo, ctx.relogio().toISOString()],
      );
      await gravarTarefasModelo(tx, id, entrada.tarefas);
      await auditar(tx, request, {
        acao: 'modelo_gestao.atualizar',
        recurso: 'modelo_gestao',
        recursoId: id,
        resumo: `Atualizou o modelo de gestão "${entrada.nome}"`,
        dados: {
          antes: { tipo: antes.tipo, nome: antes.nome, evento: antes.evento, ativo: antes.ativo },
          depois: { tipo: entrada.tipo, nome: entrada.nome, evento: entrada.evento, ativo: entrada.ativo, tarefas: entrada.tarefas.length },
        },
      });
    });
    const [modelo] = await listarModelos(ctx.banco, { id });
    if (!modelo) throw naoEncontrado();
    return modelo;
  });

  app.get('/unidades-internas', leitura, async () => listarUnidades(ctx.banco));

  app.post('/unidades-internas', escrita, async (request, reply): Promise<UnidadeInterna> => {
    const entrada = esquemaUnidadeNova.parse(request.body);
    const id = await ctx.banco.transacao(async (tx) => {
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM unidades_internas WHERE upper(sigla) = upper($1)', [entrada.sigla]);
      if (existente) throw conflito('Já existe uma unidade interna com esta sigla.');
      const [criada] = await tx.consultar<{ id: string }>('INSERT INTO unidades_internas (sigla, nome) VALUES ($1, $2) RETURNING id', [
        entrada.sigla,
        entrada.nome,
      ]);
      if (!criada) throw new Error('Falha ao criar unidade interna');
      await auditar(tx, request, {
        acao: 'unidade_interna.criar',
        recurso: 'unidade_interna',
        recursoId: criada.id,
        resumo: `Criou a unidade interna ${entrada.sigla}`,
        dados: { sigla: entrada.sigla, nome: entrada.nome },
      });
      return criada.id;
    });
    const [unidade] = await listarUnidades(ctx.banco, id);
    if (!unidade) throw naoEncontrado();
    reply.status(201);
    return unidade;
  });

  app.put('/unidades-internas/:id', escrita, async (request): Promise<UnidadeInterna> => {
    const id = idDaRota(request.params);
    const entrada = esquemaUnidade.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const [antes] = await tx.consultar<{ sigla: string; nome: string; ativa: boolean }>(
        'SELECT sigla, nome, ativa FROM unidades_internas WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!antes) throw naoEncontrado('Unidade interna não encontrada.');
      const [duplicada] = await tx.consultar<{ id: string }>(
        'SELECT id FROM unidades_internas WHERE upper(sigla) = upper($1) AND id <> $2',
        [entrada.sigla, id],
      );
      if (duplicada) throw conflito('Já existe uma unidade interna com esta sigla.');
      await tx.executar('UPDATE unidades_internas SET sigla = $2, nome = $3, ativa = $4 WHERE id = $1', [id, entrada.sigla, entrada.nome, entrada.ativa]);
      await auditar(tx, request, {
        acao: 'unidade_interna.atualizar',
        recurso: 'unidade_interna',
        recursoId: id,
        resumo: `Atualizou a unidade interna ${entrada.sigla}`,
        dados: { antes, depois: entrada },
      });
    });
    const [unidade] = await listarUnidades(ctx.banco, id);
    if (!unidade) throw naoEncontrado();
    return unidade;
  });

  app.get('/grupos-uasg', leitura, async () => listarGrupos(ctx.banco));

  app.post('/grupos-uasg/:id/confirmar', escrita, async (request): Promise<GrupoUasg> => {
    const id = idDaRota(request.params);
    await ctx.banco.transacao(async (tx) => {
      const [grupo] = await tx.consultar<{ nome: string; situacao: string }>('SELECT nome, situacao FROM grupos_uasg WHERE id = $1 FOR UPDATE', [id]);
      if (!grupo) throw naoEncontrado('Grupo de UASG não encontrado.');
      if (grupo.situacao === 'confirmado') throw conflito('Este grupo de UASG já está confirmado.');
      await tx.executar(`UPDATE grupos_uasg SET situacao = 'confirmado', confirmado_em = $2, confirmado_por = $3 WHERE id = $1`, [
        id,
        ctx.relogio().toISOString(),
        request.sessao?.usuario.id ?? null,
      ]);
      await auditar(tx, request, {
        acao: 'grupo_uasg.confirmar',
        recurso: 'grupo_uasg',
        recursoId: id,
        resumo: `Confirmou o grupo de UASG "${grupo.nome}"`,
        dados: { situacao: { de: grupo.situacao, para: 'confirmado' } },
      });
    });
    const [grupo] = await listarGrupos(ctx.banco, id);
    if (!grupo) throw naoEncontrado();
    return grupo;
  });

  app.get('/feriados', leitura, async (request): Promise<Feriado[]> => {
    const { ano: anoInformado } = z.object({ ano: z.coerce.number().int().min(1990).max(2100).optional() }).parse(request.query);
    const ano = anoInformado ?? Number(ctx.hoje().slice(0, 4));
    const locais = await ctx.banco.consultar<{ data: string; nome: string }>(
      'SELECT data, nome FROM feriados_locais WHERE data BETWEEN $1::date AND $2::date ORDER BY data',
      [`${ano}-01-01`, `${ano}-12-31`],
    );
    const todos: Feriado[] = [
      ...feriadosNacionais(ano).map((f) => ({ data: f.data, nome: f.nome, tipo: f.tipo })),
      ...locais.map((l) => ({ data: l.data, nome: l.nome, tipo: 'local' as const })),
    ];
    return todos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  });

  app.post('/feriados', escrita, async (request, reply): Promise<Feriado> => {
    const entrada = esquemaFeriado.parse(request.body);
    await ctx.banco.transacao(async (tx) => {
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM feriados_locais WHERE data = $1', [entrada.data]);
      if (existente) throw conflito('Já existe um feriado local cadastrado nesta data.');
      const [criado] = await tx.consultar<{ id: string }>(
        'INSERT INTO feriados_locais (data, nome, criado_por) VALUES ($1, $2, $3) RETURNING id',
        [entrada.data, entrada.nome, request.sessao?.usuario.id ?? null],
      );
      await auditar(tx, request, {
        acao: 'feriado.criar',
        recurso: 'feriado',
        recursoId: criado?.id ?? null,
        resumo: `Cadastrou o feriado local "${entrada.nome}"`,
        dados: { data: entrada.data, nome: entrada.nome },
      });
    });
    reply.status(201);
    return { data: entrada.data, nome: entrada.nome, tipo: 'local' };
  });
}
