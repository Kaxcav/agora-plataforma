import type { CodigoPerfil } from '@agora/contratos';
import { inserirEmLote } from '../banco/lote.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { EMPRESAS, GRUPOS_UASG, MODELOS_GESTAO, PESSOAS_FORNECEDORAS, PRENOMES, SOBRENOMES, UASGS, UNIDADES_INTERNAS } from './catalogo.ts';
import type { ContextoSeed, FornecedorSeed, UsuarioSeed } from './contexto.ts';
import { gerarCnpj, gerarCpf } from './documentos.ts';

/** Prenome + dois sobrenomes distintos. Mantém o mesmo número de sorteios do PRNG (dados determinísticos inalterados). */
function nomeCompleto(prng: { escolher<T>(lista: readonly T[]): T }): string {
  const prenome = prng.escolher(PRENOMES);
  const primeiro = prng.escolher(SOBRENOMES);
  const sorteado = prng.escolher(SOBRENOMES);
  const segundo = sorteado === primeiro ? (SOBRENOMES[(SOBRENOMES.indexOf(primeiro) + 1) % SOBRENOMES.length] ?? sorteado) : sorteado;
  return `${prenome} ${primeiro} ${segundo}`;
}
import { USUARIOS_DEMONSTRACAO } from './usuarios-demonstracao.ts';

const DDD_POR_UF: Record<string, string> = {
  DF: '61', SP: '11', MG: '31', RJ: '21', SC: '48', GO: '62', RS: '51', PA: '91', PR: '41', CE: '85', AM: '92', BA: '71', RO: '69',
};

const UNIDADE_POR_PERFIL: Record<CodigoPerfil, string> = {
  administrador: 'CGTI',
  gestor_contratos: 'COGEC',
  fiscal: 'COGEC',
  financeiro: 'COFIN',
  planejamento: 'COPLAN',
  agente_contratacao: 'CGLIC',
  juridico: 'ASJUR',
  auditor: 'COCIN',
  consulta: 'DIPAT',
};

function telefone(ctx: ContextoSeed, uf: string): string {
  return `(${DDD_POR_UF[uf] ?? '61'}) 9${ctx.prng.digitos(4)}-${ctx.prng.digitos(4)}`;
}

function semAcento(texto: string): string {
  return normalizarBusca(texto).replace(/[^a-z]/g, '');
}

export async function gerarCadastros(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora } = ctx;

  // UASGs, unidades internas e grupos
  await inserirEmLote(tx, 'uasgs', ['codigo', 'nome', 'sigla', 'uf', 'orgao'], UASGS.map((u) => [u.codigo, u.nome, u.sigla, u.uf, u.orgao]));
  dados.uasgs = UASGS.map((u) => u.codigo);

  const unidades = UNIDADES_INTERNAS.map((u) => ({ ...u, id: prng.uuid() }));
  await inserirEmLote(tx, 'unidades_internas', ['id', 'sigla', 'nome', 'ativa'], unidades.map((u) => [u.id, u.sigla, u.nome, true]));
  for (const u of unidades) dados.unidades.set(u.sigla, u.id);

  // Usuários de demonstração (senha única) e servidores sintéticos (somente gov.br, sem senha)
  const usuarios: (UsuarioSeed & { cpf: string; senha: string | null; unidade: string })[] = USUARIOS_DEMONSTRACAO.map((u) => ({
    id: prng.uuid(),
    email: u.email,
    nome: u.nome,
    perfis: [u.perfil],
    uasgs: u.escopo === 'todas' ? 'todas' : dados.uasgs.slice(0, u.escopo),
    cpf: gerarCpf(prng),
    senha: ctx.senhaHashDemonstracao,
    unidade: UNIDADE_POR_PERFIL[u.perfil],
  }));
  const perfisServidores: CodigoPerfil[] = ['gestor_contratos', 'gestor_contratos', 'gestor_contratos', 'fiscal', 'fiscal', 'fiscal', 'financeiro', 'planejamento'];
  const nomesUsados = new Set(usuarios.map((u) => u.nome));
  for (const perfil of perfisServidores) {
    let nome = '';
    do {
      nome = nomeCompleto(prng);
    } while (nomesUsados.has(nome));
    nomesUsados.add(nome);
    const [primeiro, , ultimo] = nome.split(' ');
    usuarios.push({
      id: prng.uuid(),
      email: `${semAcento(primeiro ?? 'servidor')}.${semAcento(ultimo ?? 'agora')}@agora.demo`,
      nome,
      perfis: [perfil],
      uasgs: prng.embaralhar(dados.uasgs).slice(0, prng.inteiro(2, 5)).sort(),
      cpf: gerarCpf(prng),
      senha: null,
      unidade: UNIDADE_POR_PERFIL[perfil],
    });
  }
  await inserirEmLote(
    tx,
    'usuarios',
    ['id', 'nome', 'email', 'cpf', 'senha_hash', 'ativo', 'unidade_interna_id', 'todas_uasgs', 'ultimo_acesso_em', 'busca_normalizada'],
    usuarios.map((u) => [
      u.id,
      u.nome,
      u.email,
      u.cpf,
      u.senha,
      true,
      dados.unidades.get(u.unidade) ?? null,
      u.uasgs === 'todas',
      u.senha === null ? new Date(agora.getTime() - prng.inteiro(2, 30) * 86_400_000).toISOString() : null,
      normalizarBusca(u.nome, u.email),
    ]),
  );
  await inserirEmLote(tx, 'usuarios_perfis', ['usuario_id', 'perfil'], usuarios.flatMap((u) => u.perfis.map((p) => [u.id, p])));
  await inserirEmLote(
    tx,
    'usuarios_uasgs',
    ['usuario_id', 'uasg'],
    usuarios.flatMap((u) => (u.uasgs === 'todas' ? [] : u.uasgs.map((codigo) => [u.id, codigo]))),
  );
  for (const u of usuarios) dados.usuarios.set(u.email, { id: u.id, email: u.email, nome: u.nome, perfis: u.perfis, uasgs: u.uasgs });
  dados.gestores = usuarios.filter((u) => u.perfis.includes('gestor_contratos')).map((u) => u.id);
  dados.fiscais = usuarios.filter((u) => u.perfis.includes('fiscal')).map((u) => u.id);

  const admin = dados.usuarios.get('admin@agora.demo');
  const grupos = GRUPOS_UASG.map((g) => ({ ...g, id: prng.uuid() }));
  await inserirEmLote(
    tx,
    'grupos_uasg',
    ['id', 'nome', 'situacao', 'confirmado_em', 'confirmado_por'],
    grupos.map((g) => [
      g.id,
      g.nome,
      g.confirmado ? 'confirmado' : 'pendente_confirmacao',
      g.confirmado ? new Date(agora.getTime() - prng.inteiro(30, 200) * 86_400_000).toISOString() : null,
      g.confirmado ? (admin?.id ?? null) : null,
    ]),
  );
  await inserirEmLote(tx, 'grupos_uasg_membros', ['grupo_id', 'uasg'], grupos.flatMap((g) => g.uasgs.map((u) => [g.id, u])));

  // Fornecedores: 25 PJ e 5 PF, com quadro societário e indicadores de desempenho
  const fornecedores: (FornecedorSeed & { uf: string; telefone: string; email: string; certidoes: string[] })[] = [
    ...EMPRESAS.map((e) => ({
      id: prng.uuid(),
      chave: e.chave,
      documento: gerarCnpj(prng),
      tipo: 'PJ' as const,
      nome: e.razaoSocial,
      porte: e.porte,
      uf: e.uf,
      telefone: '',
      email: `comercial@${e.dominio}`,
      certidoes: [] as string[],
    })),
    ...PESSOAS_FORNECEDORAS.map((p) => ({
      id: prng.uuid(),
      chave: p.chave,
      documento: gerarCpf(prng),
      tipo: 'PF' as const,
      nome: p.nome,
      porte: null,
      uf: p.uf,
      telefone: '',
      email: `${semAcento(p.nome.split(' ')[0] ?? 'contato')}.${semAcento(p.nome.split(' ').at(-1) ?? 'pf')}@correio.example`,
      certidoes: [] as string[],
    })),
  ];
  for (const f of fornecedores) f.telefone = telefone(ctx, f.uf);
  const irregulares: Record<string, string[]> = {
    metropolitana: ['Certidão Negativa de Débitos Trabalhistas (CNDT) vencida'],
    amazonia: ['Certificado de Regularidade do FGTS (CRF) vencido', 'Certidão de débitos federais com pendência'],
  };
  for (const f of fornecedores) f.certidoes = irregulares[f.chave] ?? [];

  await inserirEmLote(
    tx,
    'fornecedores',
    ['id', 'documento', 'tipo_pessoa', 'razao_social', 'porte', 'uf', 'telefone', 'email', 'certidoes_irregulares', 'regularidade_consultada_em', 'busca_normalizada', 'fonte_dados'],
    fornecedores.map((f) => [
      f.id,
      f.documento,
      f.tipo,
      f.nome,
      f.porte,
      f.uf,
      f.telefone,
      f.email,
      f.certidoes,
      new Date(agora.getTime() - prng.inteiro(1, 20) * 86_400_000).toISOString(),
      f.tipo === 'PJ' ? normalizarBusca(f.nome, f.documento) : '',
      'COMPRAS_GOV',
    ]),
  );
  dados.fornecedores = fornecedores.map((f) => ({ id: f.id, chave: f.chave, documento: f.documento, tipo: f.tipo, nome: f.nome, porte: f.porte }));

  const socios = fornecedores
    .filter((f) => f.tipo === 'PJ')
    .flatMap((f) =>
      Array.from({ length: prng.inteiro(1, 2) }, () => [
        prng.uuid(),
        f.id,
        gerarCpf(prng),
        nomeCompleto(prng),
      ]),
    );
  await inserirEmLote(tx, 'fornecedores_socios', ['id', 'fornecedor_id', 'cpf', 'nome'], socios);

  const semHistorico = new Set(['ipe', 'amazonia', 'pf_consultora', 'pf_piloto']);
  const desempenhoFraco = new Set(['metropolitana', 'nortecom', 'horizonte']);
  await inserirEmLote(
    tx,
    'fornecedores_indicadores',
    ['fornecedor_id', 'entregas_no_prazo', 'entregas_total', 'recebimentos_aprovados', 'recebimentos_total', 'ocorrencias_fiscalizacao', 'ocorrencias_resolvidas_no_prazo', 'atualizado_em'],
    fornecedores
      .filter((f) => !semHistorico.has(f.chave))
      .map((f) => {
        const fraco = desempenhoFraco.has(f.chave);
        const entregas = prng.inteiro(10, 80);
        const recebimentos = prng.inteiro(8, 60);
        const ocorrencias = fraco ? prng.inteiro(6, 14) : prng.inteiro(0, 6);
        return [
          f.id,
          Math.round(entregas * (fraco ? prng.inteiro(45, 70) : prng.inteiro(82, 100)) / 100),
          entregas,
          Math.round(recebimentos * (fraco ? prng.inteiro(55, 75) : prng.inteiro(85, 100)) / 100),
          recebimentos,
          ocorrencias,
          Math.round(ocorrencias * (fraco ? prng.inteiro(20, 50) : prng.inteiro(70, 100)) / 100),
          new Date(agora.getTime() - prng.inteiro(1, 10) * 86_400_000).toISOString(),
        ];
      }),
  );

  // Modelos de gestão
  const modelos = MODELOS_GESTAO.map((m) => ({ ...m, id: prng.uuid() }));
  await inserirEmLote(tx, 'modelos_gestao', ['id', 'tipo', 'nome', 'evento', 'ativo'], modelos.map((m) => [m.id, m.tipo, m.nome, m.evento, m.ativo]));
  await inserirEmLote(
    tx,
    'modelos_gestao_tarefas',
    ['id', 'modelo_id', 'ordem', 'titulo', 'macrotarefa', 'dias_relativos', 'papel_responsavel'],
    modelos.flatMap((m) => m.tarefas.map((t, i) => [prng.uuid(), m.id, i + 1, t.titulo, t.macrotarefa, t.diasRelativos, t.papel])),
  );

  // Feriados locais (portarias do órgão)
  const ano = Number(hoje.slice(0, 4));
  const feriados = [
    [`${ano}-06-24`, 'Feriado municipal de São João (demonstração)'],
    [`${ano}-12-08`, 'Feriado local de Nossa Senhora da Conceição (demonstração)'],
    [`${ano + 1}-03-19`, 'Feriado local de São José (demonstração)'],
  ];
  await inserirEmLote(tx, 'feriados_locais', ['id', 'data', 'nome', 'criado_por'], feriados.map(([data, nome]) => [prng.uuid(), data ?? hoje, nome ?? '', admin?.id ?? null]));
  ctx.calendario = { feriadosExtras: [...(ctx.calendario.feriadosExtras ?? []), ...feriados.map(([data]) => data ?? hoje)], considerarPontosFacultativos: true };

  dados.contagens.usuarios = usuarios.length;
  dados.contagens.fornecedores = fornecedores.length;
  dados.contagens.feriadosLocais = feriados.length;
  dados.cnpjOrgao = gerarCnpj(prng);
}
