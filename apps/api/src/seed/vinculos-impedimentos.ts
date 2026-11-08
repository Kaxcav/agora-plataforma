/**
 * Carga sintética de vínculos e impedimentos (F4 e F14), depois dos processos:
 * - qualificação no quadro societário, cadastro do CNPJ (abertura e endereço) e QSA consultado pelo conector offline;
 * - uma empresa recém-aberta com o sócio-administrador e o endereço de fornecedor impedido (possível sucessão);
 * - vínculos de fonte lícita com evidência (parentesco declarado por licitante, vínculo de agente informado);
 * - declarações de inexistência de impedimento de todos os usuários, menos o usuário financeiro de demonstração (RN-28).
 * Tudo inventado e determinístico; nada vem de dados reais.
 */
import { createHash } from 'node:crypto';
import { adicionarDias } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { consultarQsa } from '../integracoes/qsa-receita.ts';
import { PRENOMES, SOBRENOMES } from './catalogo.ts';
import { instanteEm, type ContextoSeed } from './contexto.ts';
import { gerarCnpj, gerarCpf } from './documentos.ts';

const LOGRADOUROS = [
  'Rua das Palmeiras',
  'Avenida Central',
  'Rua do Comércio',
  'Avenida dos Ipês',
  'Rua Projetada',
  'Travessa das Oficinas',
  'Rua dos Artesãos',
  'Avenida das Indústrias',
] as const;

const CAPITAIS: Record<string, string> = {
  DF: 'Brasília', SP: 'São Paulo', MG: 'Belo Horizonte', RJ: 'Rio de Janeiro', SC: 'Florianópolis', GO: 'Goiânia', RS: 'Porto Alegre',
  PA: 'Belém', PR: 'Curitiba', CE: 'Fortaleza', AM: 'Manaus', BA: 'Salvador',
};

/** Fornecedores sem consulta do QSA na carga (a tela mostra o quadro do cadastro e a ação de consultar). */
const SEM_CONSULTA = new Set(['ipe', 'amazonia']);

export async function gerarVinculosImpedimentos(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora, eventos } = ctx;
  const usuario = (email: string) => {
    const u = dados.usuarios.get(email);
    if (!u) throw new Error(`Usuário de demonstração ausente: ${email}`);
    return u;
  };
  const agente = usuario('agente@agora.demo');
  const gestor = usuario('gestor@agora.demo');
  const fiscalDemo = usuario('fiscal@agora.demo');
  const semDeclaracao = usuario('financeiro@agora.demo');
  const porChave = new Map(dados.fornecedores.map((f) => [f.chave, f]));
  const fornecedor = (chave: string) => {
    const f = porChave.get(chave);
    if (!f) throw new Error(`Fornecedor sintético ausente: ${chave}`);
    return f;
  };
  const carga = { carga: 'demonstracao' };

  // Qualificação: o primeiro sócio (pela ordem do CPF) de cada empresa administra.
  await tx.executar(
    `UPDATE fornecedores_socios s SET qualificacao = 'socio_administrador'
      WHERE s.id = (SELECT x.id FROM fornecedores_socios x WHERE x.fornecedor_id = s.fornecedor_id ORDER BY x.cpf LIMIT 1)`,
  );

  // Possível sucessão: empresa aberta depois do processo que impediu a Nortecom, com o mesmo sócio-administrador e endereço.
  const punida = fornecedor('nortecom');
  const [administradorPunida] = await tx.consultar<{ cpf: string; nome: string }>(
    `SELECT cpf, nome FROM fornecedores_socios WHERE fornecedor_id = $1 AND qualificacao = 'socio_administrador'`,
    [punida.id],
  );
  if (!administradorPunida) throw new Error('Sócio-administrador da empresa impedida ausente');
  const sucessora = { id: prng.uuid(), chave: 'nortelink', documento: gerarCnpj(prng), tipo: 'PJ' as const, nome: 'Nortelink Radiocomunicação Ltda.', porte: 'ME' as const };
  await inserirEmLote(
    tx,
    'fornecedores',
    ['id', 'documento', 'tipo_pessoa', 'razao_social', 'porte', 'uf', 'telefone', 'email', 'regularidade_consultada_em', 'busca_normalizada', 'fonte_dados'],
    [[sucessora.id, sucessora.documento, 'PJ', sucessora.nome, 'ME', 'PA', `(91) 9${prng.digitos(4)}-${prng.digitos(4)}`, 'contato@nortelink.example', agora.toISOString(), normalizarBusca(sucessora.nome, sucessora.documento), 'COMPRAS_GOV']],
  );
  const novoSocio = `${prng.escolher(PRENOMES)} ${prng.escolher(SOBRENOMES)} ${prng.escolher(SOBRENOMES)}`;
  await inserirEmLote(
    tx,
    'fornecedores_socios',
    ['id', 'fornecedor_id', 'cpf', 'nome', 'qualificacao'],
    [
      [prng.uuid(), sucessora.id, administradorPunida.cpf, administradorPunida.nome, 'socio_administrador'],
      [prng.uuid(), sucessora.id, gerarCpf(prng), novoSocio, 'socio'],
    ],
  );
  dados.fornecedores.push(sucessora);

  // Cadastro do CNPJ de todas as pessoas jurídicas; a sucessora repete o endereço da punida, escrito de outro jeito.
  const pj = await tx.consultar<{ id: string; uf: string | null }>(`SELECT id, uf FROM fornecedores WHERE tipo_pessoa = 'PJ' ORDER BY documento`);
  const enderecos = new Map<string, string>();
  for (const f of pj) enderecos.set(f.id, `${prng.escolher(LOGRADOUROS)}, ${prng.inteiro(10, 2_400)}, Sala ${prng.inteiro(1, 40)}`);
  const enderecoPunida = 'Avenida Almirante Barroso, 1200, Galpão 4';
  enderecos.set(punida.id, enderecoPunida);
  enderecos.set(sucessora.id, 'Av. Almirante Barroso 1200 - Galpao 4');
  // Endereço de cadastro em comum entre duas empresas sem outro vínculo (sinal de atenção na análise).
  const mirante = fornecedor('mirante');
  const sentinela = fornecedor('sentinela');
  const enderecoComum = 'Rua Voluntários da Pátria, 455, Conjunto 12';
  enderecos.set(mirante.id, enderecoComum);
  enderecos.set(sentinela.id, 'R. Voluntarios da Patria, nº 455 - Cj 12');
  const cadastros = pj.map((f) => {
    const abertura = f.id === sucessora.id ? adicionarDias(hoje, -75) : `${prng.inteiro(2004, 2019)}-${String(prng.inteiro(1, 12)).padStart(2, '0')}-${String(prng.inteiro(1, 28)).padStart(2, '0')}`;
    const endereco = enderecos.get(f.id) ?? null;
    const uf = f.uf ?? 'DF';
    const consultadoEm = new Date(agora.getTime() - prng.inteiro(1, 30) * 86_400_000).toISOString();
    const hash = createHash('sha256').update(JSON.stringify({ id: f.id, abertura, endereco })).digest('hex');
    return [f.id, abertura, endereco, CAPITAIS[uf] ?? 'Brasília', uf, 'Cadastro sintético de demonstração', 'offline', consultadoEm, hash, 0];
  });
  await inserirEmLote(
    tx,
    'fornecedores_cadastro_cnpj',
    ['fornecedor_id', 'data_abertura', 'endereco', 'municipio', 'uf', 'fonte', 'modo', 'consultado_em', 'hash', 'registros'],
    cadastros,
  );

  // QSA pelo conector offline (mesmo caminho da consulta na tela), com proveniência.
  const semConsulta = new Set([...SEM_CONSULTA].map((c) => porChave.get(c)?.id));
  let consultados = 0;
  for (const f of await tx.consultar<{ id: string; documento: string }>(`SELECT id, documento FROM fornecedores WHERE tipo_pessoa = 'PJ' ORDER BY documento`)) {
    if (semConsulta.has(f.id)) continue;
    const momento = new Date(agora.getTime() - prng.inteiro(1, 20) * 86_400_000);
    const r = await consultarQsa(tx, f.documento, { modo: 'offline', urlBase: null, chave: null, fetch: () => Promise.reject(new Error('sem rede no seed')) }, momento);
    await inserirEmLote(
      tx,
      'fornecedores_qsa',
      ['id', 'fornecedor_id', 'documento_parcial', 'nome', 'qualificacao', 'data_entrada'],
      r.dados.socios.map((s) => [prng.uuid(), f.id, s.documentoParcial, s.nome, s.qualificacao, s.dataEntrada]),
    );
    await tx.executar(
      'UPDATE fornecedores_cadastro_cnpj SET fonte = $2, modo = $3, consultado_em = $4, hash = $5, registros = $6 WHERE fornecedor_id = $1',
      [f.id, r.proveniencia.fonte, r.proveniencia.modo, r.proveniencia.consultadoEm, r.proveniencia.hash, r.proveniencia.registros],
    );
    eventos.push({
      ocorridoEm: momento,
      usuarioId: null,
      acao: 'impedimentos.qsa.consultar',
      recurso: 'fornecedor',
      recursoId: f.id,
      resumo: 'Consultou o quadro societário do CNPJ (simulação offline)',
      dados: { ...carga, fonte: r.proveniencia.fonte, modo: r.proveniencia.modo, hash: r.proveniencia.hash, registros: r.proveniencia.registros },
    });
    consultados++;
  }

  // Declarações dos agentes (RN-28): todos os usuários, menos o financeiro de demonstração, que ainda não declarou.
  const declaracoes = [...dados.usuarios.values()]
    .filter((u) => u.id !== semDeclaracao.id)
    .map((u) => {
      const dataDeclaracao = adicionarDias(hoje, -prng.inteiro(20, 150));
      const conduzCertame = u.perfis.some((p) => p === 'agente_contratacao' || p === 'planejamento' || p === 'juridico' || p === 'gestor_contratos');
      return {
        id: prng.uuid(),
        usuario: u,
        dataDeclaracao,
        instante: instanteEm(dataDeclaracao, prng, agora),
        capacitacao: conduzCertame ? 'certificacao_escola_governo' : 'atribuicoes',
        descricao: conduzCertame
          ? `Curso de formação em licitações e contratos (Lei 14.133/2021) — escola de governo, ${prng.inteiro(2022, 2025)}`
          : 'Atribuições do cargo incluem a fiscalização e a gestão de contratos administrativos.',
      };
    });
  await inserirEmLote(
    tx,
    'declaracoes_agentes',
    ['id', 'usuario_id', 'declarada_em', 'data_declaracao', 'sem_parentesco_ou_vinculo', 'sem_conflito_interesses', 'vinculo', 'cargo_matricula', 'capacitacao', 'capacitacao_descricao'],
    declaracoes.map((d) => [d.id, d.usuario.id, d.instante.toISOString(), d.dataDeclaracao, true, true, 'servidor_efetivo', `Matrícula ${prng.digitos(7)}`, d.capacitacao, d.descricao]),
  );
  for (const d of declaracoes) {
    eventos.push({
      ocorridoEm: d.instante,
      usuarioId: d.usuario.id,
      acao: 'impedimentos.declaracao.assinar',
      recurso: 'declaracao_agente',
      recursoId: d.id,
      resumo: 'Assinou a declaração de inexistência de impedimento (arts. 7º e 9º)',
      dados: { ...carga, vinculo: 'servidor_efetivo', capacitacao: d.capacitacao, vinculosDeclarados: 0 },
    });
  }

  // Vínculos de fonte lícita com evidência.
  const [coletes] = await tx.consultar<{ id: string; numero_sei: string }>(`SELECT id, numero_sei FROM processos WHERE titulo LIKE 'Aquisição de coletes%' LIMIT 1`);
  const fiscalSintetico = [...dados.usuarios.values()].find((u) => u.perfis.includes('fiscal') && u.id !== fiscalDemo.id) ?? gestor;
  const vinculos = [
    {
      id: prng.uuid(),
      natureza: 'parentesco',
      grau: 2,
      fornecedorId: fornecedor('escudo').id,
      outroFornecedorId: fornecedor('boreal').id,
      agenteId: null,
      fonte: 'declaracao_licitante',
      descricao: 'Os sócios-administradores das duas licitantes são irmãos, conforme declarado por uma delas.',
      evidencia: `Declaração de parentesco entregue com a proposta, juntada ao processo SEI ${coletes?.numero_sei ?? 'da contratação'} (documento sintético).`,
      processoId: coletes?.id ?? null,
      autor: agente.id,
      dias: 26,
    },
    {
      id: prng.uuid(),
      natureza: 'comercial',
      grau: null,
      fornecedorId: fornecedor('pampa').id,
      outroFornecedorId: null,
      agenteId: fiscalSintetico.id,
      fonte: 'informado_agente',
      descricao: 'O servidor presta consultoria eventual à empresa, segundo comunicação da unidade de lotação.',
      evidencia: 'Memorando da unidade de lotação juntado ao processo de apuração interna (documento sintético).',
      processoId: null,
      autor: gestor.id,
      dias: 40,
    },
  ];
  await inserirEmLote(
    tx,
    'vinculos_licitantes',
    ['id', 'natureza', 'grau_parentesco', 'fornecedor_id', 'outro_fornecedor_id', 'agente_id', 'fonte', 'descricao', 'evidencia', 'processo_id', 'registrado_por', 'registrado_em'],
    vinculos.map((v) => {
      const instante = instanteEm(adicionarDias(hoje, -v.dias), prng, agora);
      eventos.push({
        ocorridoEm: instante,
        usuarioId: v.autor,
        acao: 'impedimentos.vinculo.registrar',
        recurso: 'vinculo_licitante',
        recursoId: v.id,
        resumo: `Registrou vínculo de fonte lícita (${v.natureza}) com evidência`,
        dados: { ...carga, fornecedorId: v.fornecedorId, outroFornecedorId: v.outroFornecedorId, agenteId: v.agenteId, natureza: v.natureza, fonte: v.fonte },
      });
      return [v.id, v.natureza, v.grau, v.fornecedorId, v.outroFornecedorId, v.agenteId, v.fonte, v.descricao, v.evidencia, v.processoId, v.autor, instante.toISOString()];
    }),
  );

  dados.contagens.qsaConsultados = consultados;
  dados.contagens.declaracoesAgentes = declaracoes.length;
  dados.contagens.vinculosInformados = vinculos.length;
}
