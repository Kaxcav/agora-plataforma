/**
 * Execução das tarefas de publicação no PNCP (RF-19) pelo trabalhador da fila (RNF-07):
 *   * `pncp.compra`: inclui a contratação com o edital; gravada a resposta, publica a etapa 5 da jornada (data mínima
 *     das propostas contada da publicação, art. 55) e enfileira os anexos aprovados;
 *   * `pncp.arquivo`: inclui um anexo (termo de referência, minuta do contrato) na compra já publicada;
 *   * `pncp.contrato`: divulga o contrato gerado pela jornada (art. 94) e resolve a pendência de divulgação.
 * Modo online (AGORA_INTEGRACOES=online): API de manutenção do PNCP com o login do sistema credenciado.
 * Modo offline (padrão): simulação determinística — mesmo número de controle e mesmo protocolo para o mesmo envio.
 */
import {
  chaveIdempotencia,
  codigosContratacaoPncp,
  dataMinimaAberturaPropostas,
  formatarData,
  hojeISO,
  numeroControlePncp,
  type ObjetoLicitacao,
} from '@agora/dominio';
import { z } from 'zod';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { opcoesCalendario } from '../../compartilhado/instrumentos.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { criarClientePncp, reais, type ClientePncp, type CompraPncp, type ContratoPncp } from '../../integracoes/pncp-publicacao.ts';
import { gerarAvisoLicitacaoAutomatico } from '../dou/servico.ts';
import { obterLinhaProcesso } from '../jornada/repositorio.ts';
import { analisarCesta } from '../jornada/regras.ts';
import { cnpjDoOrgao, gravarJson, publicarOffline } from '../jornada/servico.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import {
  ANEXOS_PNCP,
  arquivoDoDocumento,
  compraPublicada,
  documentoAprovado,
  gravarEvidencia,
  obterEnvio,
  registrarEnvio,
  type LinhaEnvio,
} from './servico.ts';

const cargaProcesso = z.object({ processoId: z.uuid() });
const cargaArquivo = z.object({ processoId: z.uuid(), documento: z.enum(['tr', 'minuta_contrato']) });
const cargaContrato = z.object({ processoId: z.uuid(), contratoId: z.uuid() });

function lerCarga<T>(esquema: z.ZodType<T>, tarefa: LinhaTarefa): T {
  const resultado = esquema.safeParse(tarefa.carga);
  if (!resultado.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  return resultado.data;
}

async function processoDaTarefa(ctx: ContextoApp, processoId: string): Promise<LinhaProcesso> {
  const linha = await obterLinhaProcesso(ctx.banco, processoId, null);
  if (!linha) throw new FalhaTarefa('Processo não encontrado.', false);
  return linha;
}

/** Cliente online, se o órgão configurou o login do sistema credenciado no PNCP. */
function clienteOnline(ctx: ContextoApp): { cliente: ClientePncp; cnpj: string } {
  const { usuario, senha, url } = ctx.config.pncpPublicacao;
  const cnpj = ctx.config.orgao.cnpj;
  if (!usuario || !senha) {
    throw new FalhaTarefa('Publicação no PNCP sem credenciais: defina AGORA_PNCP_USUARIO e AGORA_PNCP_SENHA (login do sistema credenciado).', false);
  }
  if (!cnpj) throw new FalhaTarefa('AGORA_ORGAO_CNPJ não configurado: informe o CNPJ do órgão para publicar no PNCP.', false);
  return { cliente: criarClientePncp({ urlBase: url, usuario, senha, fetch: ctx.fetch }), cnpj };
}

function protocoloSimulado(tarefa: LinhaTarefa, hash: string): string {
  return `SIMULADO-${sha256Hex(`${tarefa.chave_idempotencia}|${hash}`).slice(0, 20).toUpperCase()}`;
}

/** Data e hora de Brasília no formato do PNCP (AAAA-MM-DDTHH:MM:SS). */
function horarioBrasilia(instante: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(instante)
    .replace(' ', 'T');
}

const PADRAO_COMPRA = /^(\d{14})-1-(\d{6})\/(\d{4})$/;

function partesCompra(numeroControle: string): { cnpj: string; sequencial: number; ano: number } {
  const partes = PADRAO_COMPRA.exec(numeroControle);
  if (!partes) throw new FalhaTarefa(`Número de controle da compra fora do padrão do PNCP: ${numeroControle}.`, false);
  return { cnpj: partes[1] ?? '', sequencial: Number(partes[2]), ano: Number(partes[3]) };
}

/** Contratação no formato do PNCP (seção 6.3.1), a partir do processo da jornada. */
export function montarCompraPncp(linha: LinhaProcesso, hoje: string, abertura: Date, dataMinimaPropostas: string): CompraPncp {
  const codigos = codigosContratacaoPncp({
    modalidade: linha.modalidade_prevista ?? 'Pregão eletrônico',
    criterio: linha.edital.criterioJulgamento,
    objeto: linha.dfd.tipoObjeto as ObjetoLicitacao,
  });
  const analise = analisarCesta(linha.cesta, hoje);
  const itens = linha.dfd.itens.map((item, indice) => {
    const unitario = indice === 0 && analise ? analise.valorEstimado : item.valorUnitarioEstimado;
    return {
      numeroItem: indice + 1,
      materialOuServico: codigos.materialOuServico,
      // A exclusividade ME/EPP por item (LC 123/2006, arts. 48 e 49) ainda não é registrada na jornada.
      tipoBeneficioId: 4,
      incentivoProdutivoBasico: false,
      descricao: item.descricao.slice(0, 2048),
      quantidade: item.quantidade,
      unidadeMedida: item.unidade.slice(0, 30),
      orcamentoSigiloso: linha.cesta.orcamentoSigiloso,
      valorUnitarioEstimado: reais(unitario),
      valorTotal: reais(unitario * item.quantidade),
      criterioJulgamentoId: codigos.criterioJulgamentoId,
      itemCategoriaId: 3,
    };
  });
  if (itens.length === 0) throw new FalhaTarefa('O processo não tem itens no DFD: o PNCP exige ao menos um item.', false);
  return {
    codigoUnidadeCompradora: linha.uasg,
    tipoInstrumentoConvocatorioId: codigos.tipoInstrumentoConvocatorioId,
    modalidadeId: codigos.modalidadeId,
    modoDisputaId: codigos.modoDisputaId,
    numeroCompra: String(Number(linha.numero_sei.slice(6, 12))),
    anoCompra: Number(hoje.slice(0, 4)),
    numeroProcesso: linha.numero_sei,
    objetoCompra: linha.titulo.slice(0, 5120),
    srp: false,
    dataAberturaProposta: horarioBrasilia(abertura),
    dataEncerramentoProposta: `${dataMinimaPropostas}T09:00:00`,
    amparoLegalId: codigos.amparoLegalId,
    itensCompra: itens,
  };
}

// ───────────────────────── pncp.compra ─────────────────────────

export async function executarPublicacaoCompra(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const { processoId } = lerCarga(cargaProcesso, tarefa);
  const linha = await processoDaTarefa(ctx, processoId);
  const calendario = await opcoesCalendario(ctx.banco);
  let envio = await obterEnvio(ctx.banco, tarefa.id);
  if (!envio) throw new FalhaTarefa('Registro do envio ao PNCP não encontrado para a tarefa.', false);

  if (envio.numero_controle === null) {
    const agora = ctx.relogio();
    const hoje = hojeISO(agora);
    const prazo = dataMinimaAberturaPropostas(
      hoje,
      { objeto: linha.dfd.tipoObjeto, criterio: linha.edital.criterioJulgamento, regime: linha.edital.regimeExecucao },
      calendario,
    );
    const referencia = `${Number(linha.numero_sei.slice(6, 12))}/${hoje.slice(0, 4)}`;
    const edital = await arquivoDoDocumento(ctx.banco, linha, 'edital', referencia);
    if (ctx.config.integracoes === 'online') {
      const { cliente, cnpj } = clienteOnline(ctx);
      const resposta = await cliente.incluirCompra(cnpj, montarCompraPncp(linha, hoje, agora, prazo.data), edital);
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        { protocolo: resposta.localizacao, numeroControle: resposta.registro.numeroControle, hashArquivo: edital.hash, sequencialDocumento: 1, modo: 'online' },
        ctx.relogio(),
      );
    } else {
      const cnpj = await cnpjDoOrgao(ctx.banco, ctx.config.orgao.cnpj);
      const simulada = publicarOffline(linha, cnpj, { hoje, agora, calendario });
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        {
          protocolo: protocoloSimulado(tarefa, edital.hash),
          numeroControle: simulada.publicacao.idPncp ?? '',
          hashArquivo: edital.hash,
          sequencialDocumento: 1,
          modo: 'offline',
        },
        ctx.relogio(),
      );
    }
  }

  const aceito: LinhaEnvio = envio;
  const publicadoEm = hojeISO(new Date(aceito.enviado_em ?? ctx.relogio().toISOString()));
  const prazo = dataMinimaAberturaPropostas(
    publicadoEm,
    { objeto: linha.dfd.tipoObjeto, criterio: linha.edital.criterioJulgamento, regime: linha.edital.regimeExecucao },
    calendario,
  );
  const numeroControle = aceito.numero_controle ?? '';
  return {
    resultado: { protocolo: aceito.protocolo, numeroControle, hashArquivo: aceito.hash_arquivo, modo: aceito.modo },
    async aplicar(tx, enfileirar) {
      const agora = ctx.relogio();
      await gravarJson(
        tx,
        linha.id,
        'publicacao',
        // RF-36: o DOU fica "na fila" até a publicação do aviso de licitação ser conferida (art. 54, § 1º).
        { pncp: 'publicado', dou: 'na_fila', publicadoEm, dataMinimaPropostas: prazo.data, idPncp: numeroControle },
        agora,
      );
      const aviso = await gerarAvisoLicitacaoAutomatico(tx, linha.id, agora);
      const anexos: string[] = [];
      for (const documento of ANEXOS_PNCP) {
        if (!(await documentoAprovado(tx, linha.id, documento))) continue;
        const derivada = await enfileirar({
          tipo: 'pncp.arquivo',
          chave: chaveIdempotencia(['pncp', 'arquivo', linha.id, documento]),
          descricao: `Anexar no PNCP o ${documento === 'tr' ? 'termo de referência' : 'minuta do contrato'} do processo ${linha.numero_sei}`,
          carga: { processoId: linha.id, documento },
          uasg: linha.uasg,
          recurso: { tipo: 'processo', id: linha.id },
          solicitadaPor: tarefa.solicitada_por,
        });
        await registrarEnvio(
          tx,
          {
            tarefaId: derivada.id,
            objeto: 'arquivo',
            processoId: linha.id,
            documento,
            titulo: documento === 'tr' ? 'Termo de referência' : 'Minuta do contrato',
            modo: aceito.modo,
          },
          agora,
        );
        anexos.push(documento);
      }
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.publicar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Publicou o edital no PNCP${aceito.modo === 'online' ? '' : ' (simulação)'} sob o nº ${numeroControle}; ${'erro' in aviso ? `aviso de licitação para o DOU não gerado (${aviso.erro})` : 'aviso de licitação para o DOU gerado, a enviar pelo INCom'}; propostas a partir de ${formatarData(prazo.data)}`,
          dados: {
            numeroSei: linha.numero_sei,
            numeroControle,
            protocolo: aceito.protocolo,
            hashArquivo: aceito.hash_arquivo,
            modo: aceito.modo,
            tarefaId: tarefa.id,
            tentativa: tarefa.tentativas,
            publicadoEm,
            dataMinimaPropostas: prazo.data,
            diasUteis: prazo.diasUteis,
            fundamento: prazo.fundamento,
            anexosEnfileirados: anexos,
            avisoDou: 'erro' in aviso ? { erro: aviso.erro } : { materiaId: aviso.id },
          },
          ipHash: null,
        },
        agora,
      );
    },
  };
}

// ───────────────────────── pncp.arquivo ─────────────────────────

export async function executarPublicacaoArquivo(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const { processoId, documento } = lerCarga(cargaArquivo, tarefa);
  const linha = await processoDaTarefa(ctx, processoId);
  const compra = await compraPublicada(ctx.banco, processoId);
  if (!compra?.numero_controle) throw new FalhaTarefa('A contratação ainda não foi aceita pelo PNCP: o anexo aguarda a compra.', true);
  const { cnpj, ano, sequencial } = partesCompra(compra.numero_controle);
  let envio = await obterEnvio(ctx.banco, tarefa.id);
  if (!envio) throw new FalhaTarefa('Registro do envio ao PNCP não encontrado para a tarefa.', false);

  if (envio.numero_controle === null) {
    const arquivo = await arquivoDoDocumento(ctx.banco, linha, documento, `${sequencial}/${ano}`);
    if (compra.modo === 'online') {
      const { cliente } = clienteOnline(ctx);
      const resposta = await cliente.incluirArquivoCompra(cnpj, ano, sequencial, arquivo);
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        {
          protocolo: resposta.localizacao,
          numeroControle: compra.numero_controle,
          hashArquivo: arquivo.hash,
          sequencialDocumento: resposta.registro.sequencialDocumento,
          modo: 'online',
        },
        ctx.relogio(),
      );
    } else {
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        {
          protocolo: protocoloSimulado(tarefa, arquivo.hash),
          numeroControle: compra.numero_controle,
          hashArquivo: arquivo.hash,
          sequencialDocumento: 2 + ANEXOS_PNCP.indexOf(documento),
          modo: 'offline',
        },
        ctx.relogio(),
      );
    }
  }

  const aceito: LinhaEnvio = envio;
  return {
    resultado: { protocolo: aceito.protocolo, numeroControle: aceito.numero_controle, hashArquivo: aceito.hash_arquivo, modo: aceito.modo },
    async aplicar(tx) {
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.anexar',
          recurso: 'processo',
          recursoId: linha.id,
          resumo: `Anexou ${aceito.titulo.toLowerCase()} à contratação nº ${aceito.numero_controle ?? ''} no PNCP${aceito.modo === 'online' ? '' : ' (simulação)'}`,
          dados: {
            numeroSei: linha.numero_sei,
            documento,
            numeroControle: aceito.numero_controle,
            protocolo: aceito.protocolo,
            sequencialDocumento: aceito.sequencial_documento,
            hashArquivo: aceito.hash_arquivo,
            modo: aceito.modo,
            tarefaId: tarefa.id,
          },
          ipHash: null,
        },
        ctx.relogio(),
      );
    },
  };
}

// ───────────────────────── pncp.contrato ─────────────────────────

interface LinhaContratoPncp {
  id: string;
  numero: string;
  ano: number;
  uasg: string;
  objeto: string;
  processo_sei: string;
  assinatura_em: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  valor_inicial: number;
  id_pncp: string | null;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
}

/** Sequencial simulado do contrato: determinístico pelo id e fora da faixa usada pela carga de demonstração. */
async function sequencialContratoSimulado(ctx: ContextoApp, cnpj: string, ano: number, contratoId: string): Promise<string> {
  let sequencial = 900_000 + (Number.parseInt(sha256Hex(contratoId).slice(0, 8), 16) % 99_999);
  for (;;) {
    const numero = numeroControlePncp({ registro: 'contrato', cnpj, ano, sequencial });
    const [existe] = await ctx.banco.consultar<{ id: string }>('SELECT id FROM contratos WHERE id_pncp = $1 AND id <> $2', [numero, contratoId]);
    if (!existe) return numero;
    sequencial = sequencial >= 999_999 ? 900_000 : sequencial + 1;
  }
}

export async function executarPublicacaoContrato(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const { processoId, contratoId } = lerCarga(cargaContrato, tarefa);
  const linha = await processoDaTarefa(ctx, processoId);
  const [contrato] = await ctx.banco.consultar<LinhaContratoPncp>(
    `SELECT c.id, c.numero, c.ano, c.uasg, c.objeto, c.processo_sei, c.assinatura_em, c.vigencia_inicio, c.vigencia_fim, c.valor_inicial,
            c.id_pncp, f.documento, f.tipo_pessoa, f.razao_social
       FROM contratos c JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.id = $1`,
    [contratoId],
  );
  if (!contrato) throw new FalhaTarefa('Contrato não encontrado.', false);
  const compra = await compraPublicada(ctx.banco, processoId);
  const numeroCompra = compra?.numero_controle ?? linha.publicacao.idPncp;
  if (!numeroCompra) throw new FalhaTarefa('A contratação do processo não foi publicada no PNCP: divulgue o edital antes do contrato.', false);
  const modo = compra?.modo ?? ctx.config.integracoes;
  let envio = await obterEnvio(ctx.banco, tarefa.id);
  if (!envio) throw new FalhaTarefa('Registro do envio ao PNCP não encontrado para a tarefa.', false);

  if (envio.numero_controle === null) {
    const { cnpj, ano, sequencial } = partesCompra(numeroCompra);
    const codigos = codigosContratacaoPncp({
      modalidade: linha.modalidade_prevista ?? 'Pregão eletrônico',
      criterio: linha.edital.criterioJulgamento,
      objeto: linha.dfd.tipoObjeto as ObjetoLicitacao,
    });
    const dados: ContratoPncp = {
      cnpjCompra: cnpj,
      anoCompra: ano,
      sequencialCompra: sequencial,
      tipoContratoId: 1,
      numeroContratoEmpenho: contrato.numero,
      anoContrato: contrato.ano,
      processo: contrato.processo_sei,
      categoriaProcessoId: codigos.categoriaProcessoId,
      receita: false,
      codigoUnidade: contrato.uasg,
      niFornecedor: contrato.documento,
      tipoPessoaFornecedor: contrato.tipo_pessoa,
      nomeRazaoSocialFornecedor: contrato.razao_social.slice(0, 100),
      objetoContrato: contrato.objeto.slice(0, 5120),
      valorInicial: reais(contrato.valor_inicial),
      numeroParcelas: 1,
      valorGlobal: reais(contrato.valor_inicial),
      dataAssinatura: contrato.assinatura_em,
      dataVigenciaInicio: contrato.vigencia_inicio,
      dataVigenciaFim: contrato.vigencia_fim,
    };
    const hashDados = sha256Hex(JSON.stringify(dados));
    if (modo === 'online') {
      const { cliente, cnpj: cnpjOrgao } = clienteOnline(ctx);
      const resposta = await cliente.incluirContrato(cnpjOrgao, dados);
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        { protocolo: resposta.localizacao, numeroControle: resposta.registro.numeroControle, hashArquivo: hashDados, sequencialDocumento: null, modo: 'online' },
        ctx.relogio(),
      );
    } else {
      const numeroControle = await sequencialContratoSimulado(ctx, cnpj, contrato.ano, contrato.id);
      envio = await gravarEvidencia(
        ctx.banco,
        tarefa.id,
        { protocolo: protocoloSimulado(tarefa, hashDados), numeroControle, hashArquivo: hashDados, sequencialDocumento: null, modo: 'offline' },
        ctx.relogio(),
      );
    }
  }

  const aceito: LinhaEnvio = envio;
  const numeroControle = aceito.numero_controle ?? '';
  const divulgadoEm = hojeISO(new Date(aceito.enviado_em ?? ctx.relogio().toISOString()));
  return {
    resultado: { protocolo: aceito.protocolo, numeroControle, hashDados: aceito.hash_arquivo, modo: aceito.modo },
    async aplicar(tx) {
      const agora = ctx.relogio();
      await tx.executar(
        `UPDATE contratos SET id_pncp = COALESCE(id_pncp, $2), divulgacao_pncp_em = COALESCE(divulgacao_pncp_em, $3::date), atualizado_em = $4 WHERE id = $1`,
        [contrato.id, numeroControle, divulgadoEm, agora.toISOString()],
      );
      const resolvidas = await tx.executar(
        `UPDATE pendencias
            SET situacao = 'resolvida', resolvida_em = $2, resolvida_por = $3, observacao_resolucao = $4
          WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND tipo = 'divulgacao_pncp' AND situacao = 'aberta'`,
        [contrato.id, agora.toISOString(), tarefa.solicitada_por, `Contrato divulgado no PNCP sob o nº ${numeroControle} pela fila de integrações.`],
      );
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.divulgar_contrato',
          recurso: 'contrato',
          recursoId: contrato.id,
          resumo: `Divulgou o contrato ${contrato.numero} no PNCP${aceito.modo === 'online' ? '' : ' (simulação)'} sob o nº ${numeroControle} (art. 94)`,
          dados: {
            processoId: linha.id,
            numeroSei: linha.numero_sei,
            numeroControle,
            protocolo: aceito.protocolo,
            hashDados: aceito.hash_arquivo,
            modo: aceito.modo,
            divulgadoEm,
            pendenciasResolvidas: resolvidas,
            tarefaId: tarefa.id,
          },
          ipHash: null,
        },
        agora,
      );
    },
  };
}
