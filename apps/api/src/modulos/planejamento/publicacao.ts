/**
 * Publicação do PCA aprovado no PNCP (Lei 14.133/2021, art. 12, § 1º; Decreto 10.947/2022, art. 12, § 2º, e art. 14)
 * pela fila de integrações (RNF-07), tarefa `pncp.pca`:
 *   * online (AGORA_INTEGRACOES=online): `POST /v1/orgaos/{cnpj}/pca` (Manual de Integração PNCP, 6.7.1) com o login do
 *     sistema credenciado; o número de controle do PCA (`CNPJ-0-SEQUENCIAL/ANO`) é lido do `location` devolvido;
 *   * offline (padrão): simulação determinística — mesmo número de controle e mesmo protocolo para o mesmo plano.
 * Logo depois da resposta, a prova do envio (protocolo, número de controle, hash do conteúdo e modo) é gravada no
 * próprio plano: uma nova tentativa depois de queda reaproveita a resposta e não envia de novo.
 */
import { chaveIdempotencia, itemPlanoContratacoesPncp, numeroControlePncp, type ItemConsolidadoPca } from '@agora/dominio';
import { z } from 'zod';
import { jsonCanonico, registrarEvento } from '../../auditoria/trilha.ts';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import type { ServicoFila } from '../../fila/servico.ts';
import { reabrir } from '../../fila/registro.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { criarClientePncp, type PlanoPncp } from '../../integracoes/pncp-publicacao.ts';
import { cnpjDoOrgao } from '../jornada/servico.ts';
import { classesDoCatalogo } from './catalogo.ts';

const carga = z.object({ planoId: z.uuid() });

interface LinhaPlanoEnvio {
  id: string;
  uasg: string;
  ano: number;
  situacao: string;
  id_pncp: string | null;
  protocolo_pncp: string | null;
  hash_envio: string | null;
  modo_publicacao: 'offline' | 'online' | null;
}

interface LinhaItemEnvio {
  numero: number;
  descricao: string;
  codigo_catalogo: string | null;
  tipo_catalogo: 'material' | 'servico' | null;
  unidade_fornecimento: string;
  categoria: ItemConsolidadoPca['categoria'];
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  data_desejada: string;
  prioridade: ItemConsolidadoPca['prioridade'];
  unidades_requisitantes: string[];
}

/** Pede a publicação do plano aprovado na transação da rota, com a chave `pncp:pca:<plano>`; reabre a que estiver na fila de erro. */
export async function solicitarPublicacaoPca(
  tx: Transacao,
  fila: ServicoFila,
  plano: { id: string; uasg: string; ano: number },
  solicitante: string,
  agora: Date,
): Promise<{ tarefa: LinhaTarefa; nova: boolean; reaberta: boolean }> {
  const { tarefa, criada } = await fila.enfileirar(tx, {
    tipo: 'pncp.pca',
    chave: chaveIdempotencia(['pncp', 'pca', plano.id]),
    descricao: `Publicar no PNCP o plano de contratações anual ${plano.ano} da UASG ${plano.uasg}`,
    carga: { planoId: plano.id },
    uasg: plano.uasg,
    recurso: null,
    solicitadaPor: solicitante,
  });
  if (criada) return { tarefa, nova: true, reaberta: false };
  if (tarefa.situacao === 'erro') {
    const reaberta = await reabrir(tx, tarefa.id, agora);
    if (reaberta) return { tarefa: reaberta, nova: false, reaberta: true };
  }
  return { tarefa, nova: false, reaberta: false };
}

/** Plano no formato do PNCP: itens consolidados com a classe do catálogo de cada código. */
export async function montarPlanoPncp(executor: Executor, plano: { id: string; uasg: string; ano: number }): Promise<PlanoPncp> {
  const itens = await executor.consultar<LinhaItemEnvio>(
    `SELECT numero, descricao, codigo_catalogo, tipo_catalogo, unidade_fornecimento, categoria, quantidade, valor_unitario, valor_total,
            data_desejada, prioridade, unidades_requisitantes
       FROM pca_itens WHERE plano_id = $1 ORDER BY numero`,
    [plano.id],
  );
  if (itens.length === 0) throw new FalhaTarefa('O plano não tem itens consolidados: o PNCP exige ao menos um item.', false);
  const classes = await classesDoCatalogo(
    executor,
    itens.flatMap((i) => (i.codigo_catalogo !== null && i.tipo_catalogo !== null ? [{ tipo: i.tipo_catalogo, codigo: i.codigo_catalogo }] : [])),
  );
  return {
    codigoUnidade: plano.uasg,
    anoPca: plano.ano,
    itensPlano: itens.map((i) => {
      const item: ItemConsolidadoPca = {
        numero: i.numero,
        demandas: [],
        unidadesRequisitantes: i.unidades_requisitantes,
        descricao: i.descricao,
        codigoCatalogo: i.codigo_catalogo,
        tipoCatalogo: i.tipo_catalogo,
        unidadeFornecimento: i.unidade_fornecimento,
        categoria: i.categoria,
        quantidade: i.quantidade,
        valorUnitario: i.valor_unitario,
        valorTotal: i.valor_total,
        dataDesejada: i.data_desejada,
        prioridade: i.prioridade,
      };
      const classe = i.codigo_catalogo !== null && i.tipo_catalogo !== null ? (classes.get(`${i.tipo_catalogo}|${i.codigo_catalogo}`) ?? null) : null;
      return itemPlanoContratacoesPncp(item, classe);
    }),
  };
}

/** Sequencial simulado do PCA: determinístico pelo plano e único entre os planos já publicados do mesmo ano. */
async function numeroControleSimulado(executor: Executor, cnpj: string, plano: LinhaPlanoEnvio): Promise<string> {
  let sequencial = 1 + (Number.parseInt(sha256Hex(plano.id).slice(0, 8), 16) % 9_000);
  for (;;) {
    const numero = numeroControlePncp({ registro: 'pca', cnpj, ano: plano.ano, sequencial });
    const [existe] = await executor.consultar<{ id: string }>('SELECT id FROM pca_planos WHERE id_pncp = $1 AND id <> $2', [numero, plano.id]);
    if (!existe) return numero;
    sequencial = sequencial >= 999_999 ? 1 : sequencial + 1;
  }
}

export async function executarPublicacaoPca(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const leitura = carga.safeParse(tarefa.carga);
  if (!leitura.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  const consultar = async () =>
    (
      await ctx.banco.consultar<LinhaPlanoEnvio>(
        'SELECT id, uasg, ano, situacao, id_pncp, protocolo_pncp, hash_envio, modo_publicacao FROM pca_planos WHERE id = $1',
        [leitura.data.planoId],
      )
    )[0] ?? null;
  let plano = await consultar();
  if (!plano) throw new FalhaTarefa('Plano de contratações não encontrado.', false);
  if (plano.situacao !== 'aprovado' && plano.situacao !== 'publicado') {
    throw new FalhaTarefa('Só o plano aprovado pela autoridade competente pode ser publicado no PNCP.', false);
  }

  if (plano.id_pncp === null) {
    const conteudo = await montarPlanoPncp(ctx.banco, plano);
    const hash = sha256Hex(jsonCanonico(conteudo));
    let prova: { idPncp: string; protocolo: string; modo: 'offline' | 'online' };
    if (ctx.config.integracoes === 'online') {
      const { usuario, senha, url } = ctx.config.pncpPublicacao;
      const cnpj = ctx.config.orgao.cnpj;
      if (!usuario || !senha) {
        throw new FalhaTarefa('Publicação no PNCP sem credenciais: defina AGORA_PNCP_USUARIO e AGORA_PNCP_SENHA (login do sistema credenciado).', false);
      }
      if (!cnpj) throw new FalhaTarefa('AGORA_ORGAO_CNPJ não configurado: informe o CNPJ do órgão para publicar no PNCP.', false);
      const resposta = await criarClientePncp({ urlBase: url, usuario, senha, fetch: ctx.fetch }).incluirPca(cnpj, conteudo);
      if (resposta.registro.registro !== 'pca') throw new FalhaTarefa(`O PNCP devolveu um endereço que não é de plano de contratações: ${resposta.localizacao}.`, false);
      prova = { idPncp: resposta.registro.numeroControle, protocolo: resposta.localizacao, modo: 'online' };
    } else {
      const cnpj = await cnpjDoOrgao(ctx.banco, ctx.config.orgao.cnpj);
      prova = {
        idPncp: await numeroControleSimulado(ctx.banco, cnpj, plano),
        protocolo: `SIMULADO-${sha256Hex(`${tarefa.chave_idempotencia}|${hash}`).slice(0, 20).toUpperCase()}`,
        modo: 'offline',
      };
    }
    await ctx.banco.executar(
      'UPDATE pca_planos SET id_pncp = $2, protocolo_pncp = $3, hash_envio = $4, modo_publicacao = $5 WHERE id = $1 AND id_pncp IS NULL',
      [plano.id, prova.idPncp, prova.protocolo, hash, prova.modo],
    );
    plano = await consultar();
    if (!plano) throw new FalhaTarefa('Plano de contratações não encontrado.', false);
  }

  const aceito = plano;
  return {
    resultado: { idPncp: aceito.id_pncp, protocolo: aceito.protocolo_pncp, hash: aceito.hash_envio, modo: aceito.modo_publicacao },
    async aplicar(tx) {
      const agora = ctx.relogio();
      await tx.executar(
        `UPDATE pca_planos SET situacao = 'publicado', publicado_em = COALESCE(publicado_em, $2), atualizado_em = $2 WHERE id = $1`,
        [aceito.id, agora.toISOString()],
      );
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.publicar_pca',
          recurso: 'pca',
          recursoId: aceito.id,
          resumo: `Publicou no PNCP${aceito.modo_publicacao === 'online' ? '' : ' (simulação)'} o plano de contratações anual ${aceito.ano} da UASG ${aceito.uasg} sob o nº ${aceito.id_pncp ?? ''}`,
          dados: {
            uasg: aceito.uasg,
            ano: aceito.ano,
            idPncp: aceito.id_pncp,
            protocolo: aceito.protocolo_pncp,
            hashEnvio: aceito.hash_envio,
            modo: aceito.modo_publicacao,
            tarefaId: tarefa.id,
            tentativa: tarefa.tentativas,
          },
          ipHash: null,
        },
        agora,
      );
    },
  };
}
