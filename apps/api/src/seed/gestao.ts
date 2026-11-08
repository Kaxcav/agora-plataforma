import {
  adicionarDias,
  calcularDosimetriaMulta,
  diasEntre,
  formatarData,
  prazoDefesa,
  prazoDivulgacaoContratoPncp,
  prazoRegistroCeisCnep,
  vigenciaSancao,
} from '@agora/dominio';
import type { Prioridade, TipoPendencia } from '@agora/contratos';
import { inserirEmLote } from '../banco/lote.ts';
import { adicionarMeses } from '../compartilhado/instrumentos.ts';
import { identificadorInstrumento, normalizarBusca } from '../compartilhado/texto.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';

interface ModeloBanco {
  id: string;
  tipo: 'ata' | 'contrato';
  evento: 'assinatura' | 'inicio_vigencia' | 'mensal' | 'reajuste' | 'fim_vigencia';
  ativo: boolean;
}

interface TarefaModeloBanco {
  modelo_id: string;
  titulo: string;
  macrotarefa: string;
  dias_relativos: number;
  papel_responsavel: 'gestor' | 'fiscal' | 'financeiro';
}

interface PendenciaGerada {
  id: string;
  tipo: TipoPendencia;
  prioridade: Prioridade;
  instrumentoTipo: 'ata' | 'contrato';
  instrumentoId: string;
  uasg: string;
  motivo: string;
  prazo: string | null;
  responsavelId: string | null;
  busca: string;
}

const OBSERVACOES_RESOLUCAO = [
  'Providência registrada no processo SEI e comunicada à área demandante.',
  'Fornecedor notificado; situação regularizada dentro do prazo.',
  'Verificado com a área financeira; pagamento programado na ordem cronológica.',
  'Garantia renovada e juntada ao processo de fiscalização.',
  'Decisão de prorrogação autuada e encaminhada à assessoria jurídica.',
];

export async function gerarGestao(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora, eventos, calendario } = ctx;
  const financeiro = dados.usuarios.get('financeiro@agora.demo');
  const gestorDemo = dados.usuarios.get('gestor@agora.demo');
  if (!financeiro || !gestorDemo) throw new Error('Usuários de demonstração ausentes');
  const fornecedorPorId = new Map(dados.fornecedores.map((f) => [f.id, f]));
  const carga = { carga: 'demonstracao' };

  // ───────── Tarefas a partir dos modelos de gestão ativos ─────────
  const modelos = await tx.consultar<ModeloBanco>('SELECT id, tipo, evento, ativo FROM modelos_gestao WHERE ativo');
  const tarefasModelo = await tx.consultar<TarefaModeloBanco>(
    'SELECT modelo_id, titulo, macrotarefa, dias_relativos, papel_responsavel FROM modelos_gestao_tarefas ORDER BY modelo_id, ordem',
  );
  const tarefas: (readonly (string | number | null)[])[] = [];
  const atrasadas: { titulo: string; instrumentoTipo: 'ata' | 'contrato'; instrumentoId: string; uasg: string; responsavelId: string | null; prazo: string }[] = [];
  const adicionarTarefa = (
    instrumento: { tipo: 'ata' | 'contrato'; id: string; uasg: string; gestorId: string; fiscalId: string },
    modeloId: string,
    t: TarefaModeloBanco,
    prazo: string,
    sufixo = '',
  ) => {
    const responsavel = t.papel_responsavel === 'gestor' ? instrumento.gestorId : t.papel_responsavel === 'fiscal' ? instrumento.fiscalId : financeiro.id;
    const concluida = prazo < hoje && prng.chance(0.85);
    const titulo = `${t.titulo}${sufixo}`;
    if (prazo < hoje && !concluida) atrasadas.push({ titulo, instrumentoTipo: instrumento.tipo, instrumentoId: instrumento.id, uasg: instrumento.uasg, responsavelId: responsavel, prazo });
    tarefas.push([
      prng.uuid(), instrumento.tipo, instrumento.id, instrumento.uasg, modeloId, titulo, t.macrotarefa, prazo,
      concluida ? 'concluida' : 'pendente', responsavel,
      concluida ? instanteEm(adicionarDias(prazo, -prng.inteiro(0, 4)), prng, agora).toISOString() : null,
      concluida ? responsavel : null,
    ]);
  };
  const mesHoje = hoje.slice(0, 7);
  for (const c of dados.contratos) {
    const instrumento = { tipo: 'contrato' as const, id: c.id, uasg: c.uasg, gestorId: c.gestorId, fiscalId: c.fiscalId };
    for (const m of modelos.filter((x) => x.tipo === 'contrato')) {
      const doModelo = tarefasModelo.filter((t) => t.modelo_id === m.id);
      if (m.evento === 'assinatura') for (const t of doModelo) adicionarTarefa(instrumento, m.id, t, adicionarDias(c.assinatura, t.dias_relativos));
      if (m.evento === 'fim_vigencia') for (const t of doModelo) adicionarTarefa(instrumento, m.id, t, adicionarDias(c.vigenciaFim, t.dias_relativos));
      if (m.evento === 'mensal') {
        for (let deslocamento = -3; deslocamento <= 1; deslocamento++) {
          const mes = adicionarMeses(`${mesHoje}-01`, deslocamento).slice(0, 7);
          if (mes < c.vigenciaInicio.slice(0, 7) || mes > c.vigenciaFim.slice(0, 7)) continue;
          for (const t of doModelo) {
            adicionarTarefa(instrumento, m.id, t, adicionarDias(`${mes}-01`, t.dias_relativos), ` — ${mes.slice(5, 7)}/${mes.slice(0, 4)}`);
          }
        }
      }
    }
  }
  for (const a of dados.atas) {
    const instrumento = { tipo: 'ata' as const, id: a.id, uasg: a.uasg, gestorId: a.gestorId, fiscalId: a.gestorId };
    for (const m of modelos.filter((x) => x.tipo === 'ata')) {
      const base = m.evento === 'assinatura' ? a.assinatura : m.evento === 'fim_vigencia' ? a.vigenciaFim : null;
      if (base === null) continue;
      for (const t of tarefasModelo.filter((x) => x.modelo_id === m.id)) adicionarTarefa(instrumento, m.id, t, adicionarDias(base, t.dias_relativos));
    }
  }
  await inserirEmLote(
    tx,
    'tarefas',
    ['id', 'instrumento_tipo', 'instrumento_id', 'uasg', 'modelo_id', 'titulo', 'macrotarefa', 'prazo', 'situacao', 'responsavel_id', 'concluida_em', 'concluida_por'],
    tarefas,
  );

  // ───────── Pendências (120) ─────────
  const porCategoria = new Map<TipoPendencia, PendenciaGerada[]>();
  const adicionar = (p: Omit<PendenciaGerada, 'id' | 'busca'>, objeto: string, numero: string, fornecedorNome: string) => {
    const lista = porCategoria.get(p.tipo) ?? [];
    lista.push({ ...p, id: prng.uuid(), busca: normalizarBusca(p.motivo, objeto, identificadorInstrumento(p.instrumentoTipo, numero), fornecedorNome, p.uasg) });
    porCategoria.set(p.tipo, lista);
  };
  const nomeFornecedor = (id: string) => {
    const f = fornecedorPorId.get(id);
    return f && f.tipo === 'PJ' ? f.nome : '';
  };

  for (const c of dados.contratos) {
    const fornecedorNome = nomeFornecedor(c.fornecedorId);
    const base = { instrumentoTipo: 'contrato' as const, instrumentoId: c.id, uasg: c.uasg };
    if (c.divulgacao === null) {
      const prazo = prazoDivulgacaoContratoPncp(c.assinatura, c.origem, calendario).limite;
      adicionar(
        {
          ...base,
          tipo: 'divulgacao_pncp',
          prioridade: prazo < hoje ? 'alta' : 'media',
          motivo: `Contrato assinado em ${formatarData(c.assinatura)} ainda não divulgado no PNCP; prazo legal até ${formatarData(prazo)} (art. 94).`,
          prazo,
          responsavelId: c.gestorId,
        },
        c.objeto, c.numero, fornecedorNome,
      );
    }
    const restantes = diasEntre(hoje, c.vigenciaFim);
    if (restantes >= 0 && restantes <= 90) {
      adicionar(
        {
          ...base,
          tipo: 'vigencia',
          prioridade: restantes <= 30 ? 'alta' : restantes <= 60 ? 'media' : 'baixa',
          motivo: `Vigência termina em ${formatarData(c.vigenciaFim)}; decidir sobre prorrogação ou nova contratação.`,
          prazo: restantes > 30 ? adicionarDias(c.vigenciaFim, -30) : adicionarDias(hoje, 5),
          responsavelId: c.gestorId,
        },
        c.objeto, c.numero, fornecedorNome,
      );
    }
    if (c.garantiaValidaAte !== null && c.garantiaValidaAte >= hoje && diasEntre(hoje, c.garantiaValidaAte) <= 30) {
      adicionar(
        { ...base, tipo: 'garantia', prioridade: 'alta', motivo: `Garantia contratual vence em ${formatarData(c.garantiaValidaAte)}; exigir renovação (art. 96).`, prazo: c.garantiaValidaAte, responsavelId: c.gestorId },
        c.objeto, c.numero, fornecedorNome,
      );
    }
    if (c.acelerado) {
      adicionar(
        { ...base, tipo: 'saldo', prioridade: 'alta', motivo: 'Execução financeira acima do ritmo da vigência: risco de esgotar o saldo antes do fim do contrato.', prazo: adicionarDias(hoje, 15), responsavelId: c.gestorId },
        c.objeto, c.numero, fornecedorNome,
      );
    }
    const aniversario = adicionarMeses(c.dataBase, 12);
    if (!c.reajusteAplicado && aniversario <= hoje && c.vigenciaFim > hoje) {
      adicionar(
        { ...base, tipo: 'reajuste', prioridade: 'baixa', motivo: `Data-base completou 12 meses em ${formatarData(aniversario)}; avaliar pedido de reajuste pelo IPCA.`, prazo: adicionarDias(hoje, 30), responsavelId: c.gestorId },
        c.objeto, c.numero, fornecedorNome,
      );
    }
  }
  for (const p of dados.pagamentos) {
    if ((p.situacao === 'atestado' || p.situacao === 'liquidado') && p.vencimento < hoje) {
      const c = dados.contratos.find((x) => x.id === p.contratoId);
      if (!c) continue;
      adicionar(
        {
          instrumentoTipo: 'contrato', instrumentoId: c.id, uasg: c.uasg, tipo: 'pagamento', prioridade: 'alta',
          motivo: `Nota fiscal ${p.notaFiscal} (competência ${p.competencia.slice(5)}/${p.competencia.slice(0, 4)}) vencida em ${formatarData(p.vencimento)} sem pagamento.`,
          prazo: adicionarDias(hoje, 3), responsavelId: financeiro.id,
        },
        c.objeto, c.numero, nomeFornecedor(c.fornecedorId),
      );
    }
  }
  for (const a of dados.atas) {
    const restantes = diasEntre(hoje, a.vigenciaFim);
    if (restantes >= 0 && restantes <= 90) {
      adicionar(
        {
          instrumentoTipo: 'ata', instrumentoId: a.id, uasg: a.uasg, tipo: 'vigencia', prioridade: restantes <= 30 ? 'alta' : 'media',
          motivo: `Ata vence em ${formatarData(a.vigenciaFim)}; avaliar prorrogação (art. 84) ou nova licitação.`,
          prazo: adicionarDias(a.vigenciaFim, -15) < hoje ? adicionarDias(hoje, 3) : adicionarDias(a.vigenciaFim, -15), responsavelId: a.gestorId,
        },
        a.objeto, a.numero, '',
      );
    }
    const criticos = a.itens.filter((i) => i.quantidadeRegistrada === 0 || i.restante * 10 <= i.quantidadeRegistrada).length;
    if (criticos > 0 && a.vigenciaFim >= hoje) {
      adicionar(
        {
          instrumentoTipo: 'ata', instrumentoId: a.id, uasg: a.uasg, tipo: 'saldo', prioridade: criticos >= 3 ? 'alta' : 'media',
          motivo: `${criticos} ${criticos === 1 ? 'item com saldo' : 'itens com saldo'} igual ou inferior a 10% do registrado; planejar nova contratação.`,
          prazo: adicionarDias(hoje, prng.inteiro(10, 40)), responsavelId: a.gestorId,
        },
        a.objeto, a.numero, '',
      );
    }
  }
  for (const t of atrasadas.slice(0, 40)) {
    const instrumento = t.instrumentoTipo === 'contrato' ? dados.contratos.find((c) => c.id === t.instrumentoId) : dados.atas.find((a) => a.id === t.instrumentoId);
    if (!instrumento) continue;
    adicionar(
      { instrumentoTipo: t.instrumentoTipo, instrumentoId: t.instrumentoId, uasg: t.uasg, tipo: 'tarefa', prioridade: 'media', motivo: `Tarefa do plano de gestão em atraso desde ${formatarData(t.prazo)}: ${t.titulo}.`, prazo: t.prazo, responsavelId: t.responsavelId },
      instrumento.objeto, instrumento.numero, '',
    );
  }
  for (const c of prng.embaralhar(dados.contratos.filter((x) => x.vigenciaFim > hoje)).slice(0, 30)) {
    adicionar(
      {
        instrumentoTipo: 'contrato', instrumentoId: c.id, uasg: c.uasg, tipo: 'lembrete', prioridade: 'baixa',
        motivo: prng.escolher([
          'Reunião de acompanhamento da execução com o preposto do fornecedor.',
          'Conferir a atualização do cronograma físico-financeiro.',
          'Verificar a regularidade fiscal do fornecedor antes do próximo atesto.',
          'Atualizar a designação de fiscal substituto no período de férias.',
        ]),
        prazo: adicionarDias(hoje, prng.inteiro(3, 45)), responsavelId: prng.chance(0.85) ? c.gestorId : null,
      },
      c.objeto, c.numero, nomeFornecedor(c.fornecedorId),
    );
  }

  // Seleção equilibrada entre as categorias até 120 pendências
  const filas = [...porCategoria.values()].map((l) => prng.embaralhar(l));
  const pendencias: PendenciaGerada[] = [];
  while (pendencias.length < 120 && filas.some((f) => f.length > 0)) {
    for (const fila of filas) {
      const proxima = fila.shift();
      if (proxima && pendencias.length < 120) pendencias.push(proxima);
    }
  }
  const resolvidas = new Set(prng.embaralhar(pendencias.filter((p) => p.tipo !== 'divulgacao_pncp')).slice(0, 28).map((p) => p.id));
  const linhasPendencias = pendencias.map((p) => {
    const resolvida = resolvidas.has(p.id);
    const resolvidaEm = resolvida ? instanteEm(adicionarDias(hoje, -prng.inteiro(1, 60)), prng, agora) : null;
    const resolvidaPor = resolvida ? (p.responsavelId ?? gestorDemo.id) : null;
    if (resolvidaEm && resolvidaPor) {
      eventos.push({
        ocorridoEm: resolvidaEm,
        usuarioId: resolvidaPor,
        acao: 'pendencia.resolver',
        recurso: 'pendencia',
        recursoId: p.id,
        resumo: `Resolveu pendência de ${p.tipo === 'divulgacao_pncp' ? 'divulgação no PNCP' : p.tipo === 'vigencia' ? 'vigência' : p.tipo}`,
        dados: { ...carga, instrumentoTipo: p.instrumentoTipo, instrumentoId: p.instrumentoId, tipo: p.tipo, situacao: { de: 'aberta', para: 'resolvida' } },
      });
    }
    return [
      p.id, p.tipo, p.prioridade, p.instrumentoTipo, p.instrumentoId, p.uasg, p.motivo, p.prazo, p.responsavelId,
      resolvida ? 'resolvida' : 'aberta', resolvidaEm ? resolvidaEm.toISOString() : null, resolvidaPor,
      resolvida ? prng.escolher(OBSERVACOES_RESOLUCAO) : null, p.busca,
      new Date(agora.getTime() - prng.inteiro(2, 90) * 86_400_000).toISOString(),
    ];
  });
  await inserirEmLote(
    tx,
    'pendencias',
    ['id', 'tipo', 'prioridade', 'instrumento_tipo', 'instrumento_id', 'uasg', 'motivo', 'prazo', 'responsavel_id', 'situacao', 'resolvida_em', 'resolvida_por', 'observacao_resolucao', 'busca_normalizada', 'criada_em'],
    linhasPendencias,
  );

  // ───────── Sanções (6), com prazos e dosimetria calculados por @agora/dominio ─────────
  const porChave = new Map(dados.fornecedores.map((f) => [f.chave, f]));
  const contratoDe = (fornecedorId: string | undefined) => dados.contratos.find((c) => c.fornecedorId === fornecedorId) ?? null;
  const planos = [
    { chave: 'metropolitana', tipo: 'multa', inciso: 'VII', situacao: 'aplicada', diasInstauracao: 280 },
    { chave: 'nortecom', tipo: 'impedimento_licitar', inciso: 'IV', situacao: 'aplicada', diasInstauracao: 210 },
    { chave: 'guardiao', tipo: 'advertencia', inciso: 'I', situacao: 'em_instrucao', diasInstauracao: 10 },
    { chave: 'horizonte', tipo: 'multa', inciso: 'VII', situacao: 'defesa', diasInstauracao: 12 },
    { chave: 'calibre', tipo: 'multa', inciso: 'II', situacao: 'decisao', diasInstauracao: 75 },
    { chave: 'planalto', tipo: 'advertencia', inciso: 'I', situacao: 'arquivada', diasInstauracao: 160 },
  ] as const;
  const linhasSancoes = planos.flatMap((plano) => {
    const fornecedor = porChave.get(plano.chave);
    if (!fornecedor) return [];
    const contrato = contratoDe(fornecedor.id);
    const instaurada = adicionarDias(hoje, -plano.diasInstauracao);
    const intimacao = plano.situacao === 'em_instrucao' ? null : adicionarDias(instaurada, 3);
    const defesa = intimacao ? prazoDefesa(intimacao, calendario).vencimento : null;
    const aplicada = plano.situacao === 'aplicada' ? adicionarDias(instaurada, 60) : null;
    const vigencia = aplicada && plano.tipo === 'impedimento_licitar' ? vigenciaSancao('impedimento_licitar', aplicada, 2) : null;
    const multa =
      plano.tipo === 'multa' && contrato
        ? calcularDosimetriaMulta({
            valorContrato: contrato.valorGlobal,
            gravidade: plano.inciso === 'II' ? 'grave' : 'media',
            agravantes: plano.chave === 'metropolitana' ? ['Reincidência em atrasos de entrega'] : [],
            atenuantes: [],
            programaIntegridade: false,
            danoAdministracao: plano.inciso === 'II',
          }).valorMulta
        : null;
    const id = prng.uuid();
    const autor = contrato?.gestorId ?? gestorDemo.id;
    eventos.push({
      ocorridoEm: instanteEm(instaurada, prng, agora),
      usuarioId: autor,
      acao: 'sancao.instaurar',
      recurso: 'sancao',
      recursoId: id,
      resumo: `Instaurou processo sancionatório (art. 155, ${plano.inciso})`,
      dados: { ...carga, fornecedorId: fornecedor.id, ...(contrato ? { instrumentoTipo: 'contrato', instrumentoId: contrato.id } : {}) },
    });
    if (aplicada) {
      eventos.push({
        ocorridoEm: instanteEm(aplicada, prng, agora),
        usuarioId: autor,
        acao: 'sancao.aplicar',
        recurso: 'sancao',
        recursoId: id,
        resumo: 'Registrou a decisão da autoridade competente que aplicou a sanção',
        dados: { ...carga, tipo: plano.tipo, ...(contrato ? { instrumentoTipo: 'contrato', instrumentoId: contrato.id } : {}) },
      });
    }
    return [[
      id, fornecedor.id, contrato?.id ?? null, plano.inciso, plano.tipo, plano.situacao, multa, intimacao, aplicada,
      vigencia ? aplicada : null, vigencia ? vigencia.fim : null, defesa, aplicada ? prazoRegistroCeisCnep(aplicada, calendario).vencimento : null,
      plano.situacao === 'aplicada', instaurada,
      'Relato sintético de demonstração: descumprimento contratual apurado pela fiscalização, com documentação juntada ao processo.',
      autor,
    ]];
  });
  await inserirEmLote(
    tx,
    'sancoes',
    ['id', 'fornecedor_id', 'contrato_id', 'inciso_infracao', 'tipo', 'situacao', 'valor_multa', 'intimacao_em', 'aplicada_em', 'inicio_vigencia', 'fim_vigencia', 'prazo_defesa', 'prazo_registro_ceis_cnep', 'registrada_ceis_cnep', 'instaurada_em', 'relato', 'criada_por'],
    linhasSancoes,
  );

  dados.contagens.tarefas = tarefas.length;
  dados.contagens.pendencias = pendencias.length;
  dados.contagens.pendenciasResolvidas = resolvidas.size;
  dados.contagens.sancoes = linhasSancoes.length;
}
