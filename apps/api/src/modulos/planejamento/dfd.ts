/**
 * Planejamento no DFD (etapa 1 da jornada): vínculo com o item do PCA publicado e conferência (`conferirDfdComPca`,
 * art. 18, § 1º, II — RF-31), código do catálogo dos itens (RN-02 e RIA-13) e demandas semelhantes em outras UASGs
 * para o registro de preços compartilhado (`sugerirRegistroPrecosCompartilhado`, RIA-01).
 *
 * `regrasPlanejamentoEtapa1` é chamada pela avaliação da etapa 1 (jornada/repositorio.ts) e devolve bloqueios e sinais;
 * as demais funções montam o painel do DFD. Só leitura: as escritas ficam nas rotas.
 */
import {
  conferirDfdComPca,
  identificadorItemPca,
  situacaoIrp,
  sugerirRegistroPrecosCompartilhado,
  type ConferenciaDfdPca,
  type DemandaUnidade,
  type VinculoDfdPca,
} from '@agora/dominio';
import type { Bloqueio, ItemPcaDisponivel, PlanejamentoDfd, PrioridadeDemandaPca, ProvenienciaConsulta, Sinal } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';

export const FONTE_PCA_PNCP = 'Plano de contratações anual publicado no PNCP — API de consulta';

interface LinhaItemPca {
  id: string;
  numero: number;
  descricao: string;
  codigo_catalogo: string | null;
  unidade_fornecimento: string;
  quantidade: number;
  valor_total: number;
  data_desejada: string;
  prioridade: PrioridadeDemandaPca;
  uasg: string;
  ano: number;
  id_pncp: string | null;
  situacao: string;
}

const SELECAO_ITEM = `
  SELECT i.id, i.numero, i.descricao, i.codigo_catalogo, i.unidade_fornecimento, i.quantidade, i.valor_total, i.data_desejada,
         i.prioridade, p.uasg, p.ano, p.id_pncp, p.situacao
    FROM pca_itens i
    JOIN pca_planos p ON p.id = i.plano_id`;

function paraItemDisponivel(l: LinhaItemPca): ItemPcaDisponivel {
  return {
    id: l.id,
    identificador: identificadorItemPca({ uasg: l.uasg, ano: l.ano, numero: l.numero }),
    uasg: l.uasg,
    ano: l.ano,
    numero: l.numero,
    descricao: l.descricao,
    codigoCatalogo: l.codigo_catalogo,
    unidadeFornecimento: l.unidade_fornecimento,
    quantidade: l.quantidade,
    valorTotal: l.valor_total,
    dataDesejada: l.data_desejada,
    prioridade: l.prioridade,
    idPcaPncp: l.id_pncp,
  };
}

/** Itens dos PCAs publicados da UASG nos exercícios indicados. */
export async function itensPcaPublicados(executor: Executor, uasg: string, anos: readonly number[]): Promise<ItemPcaDisponivel[]> {
  const linhas = await executor.consultar<LinhaItemPca>(
    `${SELECAO_ITEM}
      WHERE p.uasg = $1 AND p.ano = ANY($2::integer[]) AND p.situacao = 'publicado'
      ORDER BY p.ano, i.numero`,
    [uasg, [...anos]],
  );
  return linhas.map(paraItemDisponivel);
}

export async function itemPcaPorId(executor: Executor, id: string): Promise<{ item: ItemPcaDisponivel; publicado: boolean } | null> {
  const [linha] = await executor.consultar<LinhaItemPca>(`${SELECAO_ITEM} WHERE i.id = $1`, [id]);
  return linha ? { item: paraItemDisponivel(linha), publicado: linha.situacao === 'publicado' } : null;
}

/** A UASG tem PCA publicado para o exercício ("sempre que elaborado", art. 18, § 1º, II). */
export async function pcaPublicadoNoExercicio(executor: Executor, uasg: string, ano: number): Promise<boolean> {
  const [linha] = await executor.consultar<{ existe: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pca_planos WHERE uasg = $1 AND ano = $2 AND situacao = 'publicado') AS existe",
    [uasg, ano],
  );
  return linha?.existe ?? false;
}

interface LinhaVinculo {
  pca_item_id: string | null;
  justificativa_fora_pca: string | null;
  registrado_por: string | null;
  registrado_por_nome: string | null;
  registrado_em: string;
}

export async function carregarVinculo(executor: Executor, processoId: string): Promise<LinhaVinculo | null> {
  const [linha] = await executor.consultar<LinhaVinculo>(
    `SELECT v.pca_item_id, v.justificativa_fora_pca, v.registrado_por, u.nome AS registrado_por_nome, v.registrado_em
       FROM dfd_vinculos_pca v LEFT JOIN usuarios u ON u.id = v.registrado_por
      WHERE v.processo_id = $1`,
    [processoId],
  );
  return linha ?? null;
}

function valorTotalDfd(linha: LinhaProcesso): number {
  return linha.dfd.itens.reduce((s, i) => s + Math.round(i.quantidade * i.valorUnitarioEstimado), 0);
}

/** Conferência do DFD com o PCA publicado (domínio), com o vínculo e o item já carregados. */
async function conferir(executor: Executor, linha: LinhaProcesso, exercicio: number) {
  const vinculo = await carregarVinculo(executor, linha.id);
  const encontrado = vinculo?.pca_item_id ? await itemPcaPorId(executor, vinculo.pca_item_id) : null;
  const item = encontrado?.item ?? null;
  const exige = await pcaPublicadoNoExercicio(executor, linha.uasg, exercicio);
  let entrada: VinculoDfdPca | null = null;
  if (vinculo?.pca_item_id) {
    entrada = {
      tipo: 'item',
      item: item
        ? { identificador: item.identificador, descricao: item.descricao, uasg: item.uasg, ano: item.ano, valorTotal: item.valorTotal, publicado: encontrado?.publicado ?? false }
        : null,
    };
  } else if (vinculo) {
    entrada = { tipo: 'fora_do_pca', justificativa: vinculo.justificativa_fora_pca ?? '' };
  }
  const conferencia: ConferenciaDfdPca = conferirDfdComPca({
    uasgProcesso: linha.uasg,
    previstoNoPca: linha.dfd.previstoNoPca,
    valorTotalDfd: valorTotalDfd(linha),
    exigePca: exige,
    vinculo: entrada,
  });
  return { vinculo, item, exige, conferencia };
}

/**
 * Demandas por código do catálogo, para o sinal de registro de preços compartilhado: os DFDs dos processos ainda no
 * planejamento (etapas 1 a 3) e os itens dos PCAs aprovados ou publicados do exercício, em todas as UASGs.
 */
async function demandasPorCodigo(executor: Executor, exercicio: number): Promise<DemandaUnidade[]> {
  const demandas: DemandaUnidade[] = [];
  const processos = await executor.consultar<{ id: string; uasg: string; numero_sei: string; dfd: LinhaProcesso['dfd']; criado_em: string }>(
    'SELECT id, uasg, numero_sei, dfd, criado_em FROM processos WHERE etapa_atual <= 3',
  );
  for (const p of processos) {
    if (Number(p.criado_em.slice(0, 4)) !== exercicio) continue;
    for (const item of p.dfd.itens) {
      if (!item.catmat) continue;
      demandas.push({
        uasg: p.uasg,
        origem: 'dfd',
        referencia: `Processo ${p.numero_sei}`,
        codigoCatalogo: item.catmat,
        descricao: item.descricao,
        quantidade: item.quantidade,
        unidadeFornecimento: item.unidade,
      });
    }
  }
  const itens = await executor.consultar<LinhaItemPca>(
    `${SELECAO_ITEM}
      WHERE p.ano = $1 AND p.situacao IN ('aprovado', 'publicado') AND i.codigo_catalogo IS NOT NULL
      ORDER BY p.uasg, i.numero`,
    [exercicio],
  );
  for (const i of itens) {
    demandas.push({
      uasg: i.uasg,
      origem: 'pca',
      referencia: `PCA ${identificadorItemPca({ uasg: i.uasg, ano: i.ano, numero: i.numero })}`,
      codigoCatalogo: i.codigo_catalogo ?? '',
      descricao: i.descricao,
      quantidade: i.quantidade,
      unidadeFornecimento: i.unidade_fornecimento,
    });
  }
  return demandas;
}

async function sugestoesCompartilhadas(executor: Executor, linha: LinhaProcesso, exercicio: number) {
  const codigos = linha.dfd.itens.flatMap((i) => (i.catmat ? [i.catmat] : []));
  if (codigos.length === 0) return [];
  return sugerirRegistroPrecosCompartilhado({ uasg: linha.uasg, codigos }, await demandasPorCodigo(executor, exercicio));
}

async function codigosConhecidos(executor: Executor, codigos: readonly string[]): Promise<Set<string>> {
  if (codigos.length === 0) return new Set();
  const linhas = await executor.consultar<{ codigo: string }>('SELECT codigo FROM catalogo_itens WHERE codigo = ANY($1::text[])', [[...codigos]]);
  return new Set(linhas.map((l) => l.codigo));
}

/**
 * Bloqueios e sinais do planejamento na etapa 1: conferência do DFD com o PCA (RF-31, bloqueia), código do catálogo dos
 * itens (RN-02 e RIA-13, sinais) e registro de preços compartilhado (RIA-01, sinal).
 */
export async function regrasPlanejamentoEtapa1(executor: Executor, linha: LinhaProcesso, hoje: string): Promise<{ bloqueios: Bloqueio[]; sinais: Sinal[] }> {
  const exercicio = Number(hoje.slice(0, 4));
  const { conferencia } = await conferir(executor, linha, exercicio);
  const bloqueios: Bloqueio[] = conferencia.pendencias.map((mensagem) => ({ regra: 'RF-31', mensagem, fundamento: conferencia.fundamento, etapa: 1 }));
  const sinais: Sinal[] = conferencia.alertas.map((a) => ({ regra: 'RF-31', nivel: a.nivel, mensagem: a.mensagem, fundamento: conferencia.fundamento }));

  if (linha.dfd.usaCatalogoPadronizado) {
    const fundamentoCatalogo = 'Lei 14.133/2021, art. 19, II e § 2º';
    const conhecidos = await codigosConhecidos(executor, linha.dfd.itens.flatMap((i) => (i.catmat ? [i.catmat] : [])));
    linha.dfd.itens.forEach((item, indice) => {
      if (!item.catmat) {
        sinais.push({
          regra: 'RN-02',
          nivel: 'atencao',
          mensagem: `O item ${indice + 1} não tem código do catálogo (CATMAT/CATSER): use a sugestão do catálogo (RIA-13) ou, se o item não consta do catálogo, desmarque o uso do catálogo e justifique.`,
          fundamento: fundamentoCatalogo,
        });
      } else if (!conhecidos.has(item.catmat)) {
        sinais.push({
          regra: 'RIA-13',
          nivel: 'informativo',
          mensagem: `O código ${item.catmat} do item ${indice + 1} não está na cópia local do catálogo: confira-o na consulta ao catálogo oficial.`,
          fundamento: fundamentoCatalogo,
        });
      }
    });
  }

  for (const s of await sugestoesCompartilhadas(executor, linha, exercicio)) {
    sinais.push({ regra: 'RIA-01', nivel: 'informativo', mensagem: s.mensagem, fundamento: s.fundamento });
  }
  return { bloqueios, sinais };
}

interface LinhaConsultaPca {
  modo: 'offline' | 'online';
  endereco: string | null;
  registros: number;
  hash_conteudo: string;
  consultado_em: string;
}

export async function ultimaConsultaPca(executor: Executor, uasg: string): Promise<ProvenienciaConsulta | null> {
  const [l] = await executor.consultar<LinhaConsultaPca>(
    'SELECT modo, endereco, registros, hash_conteudo, consultado_em FROM pca_consultas_pncp WHERE uasg = $1 ORDER BY consultado_em DESC LIMIT 1',
    [uasg],
  );
  return l
    ? { fonte: FONTE_PCA_PNCP, modo: l.modo, endereco: l.endereco, consultadoEm: l.consultado_em, registros: l.registros, hash: l.hash_conteudo, deCache: false }
    : null;
}

/** Painel de planejamento do DFD (GET /processos/:id/pca). */
export async function montarPlanejamentoDfd(executor: Executor, linha: LinhaProcesso, hoje: string): Promise<PlanejamentoDfd> {
  const exercicio = Number(hoje.slice(0, 4));
  const { vinculo, item, exige, conferencia } = await conferir(executor, linha, exercicio);
  const irps = await executor.consultar<{ id: string; numero: string; codigo_catalogo: string | null; abertura: string; encerramento: string; consolidada_em: string | null }>(
    'SELECT id, numero, codigo_catalogo, abertura, encerramento, consolidada_em FROM irps WHERE processo_id = $1 ORDER BY criada_em',
    [linha.id],
  );
  return {
    processoId: linha.id,
    uasg: linha.uasg,
    exercicio,
    exigePca: exige,
    vinculo:
      vinculo?.pca_item_id && item
        ? { tipo: 'item', item }
        : vinculo && vinculo.justificativa_fora_pca !== null
          ? { tipo: 'fora_do_pca', justificativa: vinculo.justificativa_fora_pca }
          : null,
    vinculoRegistradoPor: vinculo ? usuarioResumo(vinculo.registrado_por, vinculo.registrado_por_nome) : null,
    vinculoRegistradoEm: vinculo?.registrado_em ?? null,
    conferencia,
    itensDisponiveis: await itensPcaPublicados(executor, linha.uasg, [exercicio, exercicio + 1]),
    consultaPncp: await ultimaConsultaPca(executor, linha.uasg),
    registroPrecosCompartilhado: await sugestoesCompartilhadas(executor, linha, exercicio),
    irps: irps.map((i) => ({
      id: i.id,
      numero: i.numero,
      codigoCatalogo: i.codigo_catalogo,
      situacao: situacaoIrp({ abertura: i.abertura, encerramento: i.encerramento, consolidada: i.consolidada_em !== null }, hoje),
    })),
  };
}
