/**
 * Tarefa `pncp.termo` do trabalhador da fila (RNF-07): divulga no PNCP o termo assinado — aditivo (condição de
 * eficácia, art. 94), apostilamento ou rescisão — no contrato já divulgado. Online: API de manutenção do PNCP
 * (`POST /v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos`). Offline (padrão): simulação determinística.
 * O protocolo devolvido é gravado logo depois da resposta (prova do envio); a nova tentativa não reenvia.
 */
import { diasEntre, tipoTermoContratoPncp } from '@agora/dominio';
import { z } from 'zod';
import { registrarEvento } from '../../auditoria/trilha.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { FalhaTarefa, type ConclusaoTarefa, type LinhaTarefa } from '../../fila/tipos.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { criarClientePncp, reais, type TermoContratoPncp } from '../../integracoes/pncp-publicacao.ts';
import { obterContratoAlteracao, obterLinhaAlteracao, type LinhaAlteracao, type LinhaContratoAlteracao } from './repositorio.ts';

const carga = z.object({ alteracaoId: z.uuid() });
const PADRAO_CONTRATO = /^(\d{14})-2-(\d{6})\/(\d{4})$/;

const FUNDAMENTO: Record<LinhaAlteracao['tipo'], string> = {
  acrescimo: 'Lei 14.133/2021, art. 124, I, "b", e art. 125',
  supressao: 'Lei 14.133/2021, art. 124, I, "b", e art. 125',
  qualitativa: 'Lei 14.133/2021, art. 124, I, "a"',
  prazo: 'Lei 14.133/2021, arts. 105 a 107 e 111',
  reequilibrio: 'Lei 14.133/2021, art. 124, II, "d"',
  reajuste: 'Lei 14.133/2021, art. 25, § 7º, e art. 136, I',
  repactuacao: 'Lei 14.133/2021, art. 135 e art. 136, I',
  extincao: 'Lei 14.133/2021, arts. 137 a 139',
};

/** Dados do termo no formato do PNCP (IncluirTermoContratoDTO). */
export function montarTermoPncp(a: LinhaAlteracao, c: LinhaContratoAlteracao): TermoContratoPncp {
  const numero = a.numero ?? '';
  const valorTermo = Math.abs(a.valor);
  const vigenciaAnterior = typeof a.dados['vigenciaAnterior'] === 'string' ? a.dados['vigenciaAnterior'] : null;
  return {
    tipoTermoContratoId: tipoTermoContratoPncp(a.especie),
    numeroTermoContrato: numero,
    objetoTermoContrato: `${numero}: ${a.justificativa}`.slice(0, 5120),
    qualificacaoAcrescimoSupressao: ['acrescimo', 'supressao', 'reequilibrio'].includes(a.tipo) || (a.tipo === 'qualitativa' && a.valor !== 0),
    qualificacaoVigencia: a.tipo === 'prazo' || a.tipo === 'extincao',
    qualificacaoFornecedor: false,
    qualificacaoInformativo: a.tipo === 'qualitativa' && a.valor === 0,
    qualificacaoReajuste: a.tipo === 'reajuste' || a.tipo === 'repactuacao',
    dataAssinatura: a.assinado_em ?? '',
    niFornecedor: c.documento,
    tipoPessoaFornecedor: c.tipo_pessoa,
    nomeRazaoSocialFornecedor: c.razao_social.slice(0, 255),
    fundamentoLegal: FUNDAMENTO[a.tipo],
    valorAcrescido: reais(a.valor),
    numeroParcelas: 1,
    valorParcela: reais(valorTermo),
    valorGlobal: reais(c.valor_global),
    prazoAditadoDias: a.tipo === 'prazo' && vigenciaAnterior && a.nova_vigencia_fim ? diasEntre(vigenciaAnterior, a.nova_vigencia_fim) : 0,
    dataVigenciaInicio: c.vigencia_inicio,
    dataVigenciaFim: c.vigencia_fim,
  };
}

export async function executarDivulgacaoTermo(ctx: ContextoApp, tarefa: LinhaTarefa): Promise<ConclusaoTarefa> {
  const leitura = carga.safeParse(tarefa.carga);
  if (!leitura.success) throw new FalhaTarefa('Tarefa com dados inválidos.', false);
  const [ref] = await ctx.banco.consultar<{ contrato_id: string }>('SELECT contrato_id FROM alteracoes_contratuais WHERE id = $1', [leitura.data.alteracaoId]);
  if (!ref) throw new FalhaTarefa('Alteração contratual não encontrada.', false);
  const contrato = await obterContratoAlteracao(ctx.banco, ref.contrato_id, null);
  let alteracao = await obterLinhaAlteracao(ctx.banco, ref.contrato_id, leitura.data.alteracaoId);
  if (!contrato || !alteracao) throw new FalhaTarefa('Contrato não encontrado.', false);
  if (alteracao.situacao !== 'assinado' || !alteracao.numero) throw new FalhaTarefa('Só o termo assinado é divulgado no PNCP.', false);
  const partes = contrato.id_pncp ? PADRAO_CONTRATO.exec(contrato.id_pncp) : null;
  if (!partes) {
    throw new FalhaTarefa(
      `O contrato ${contrato.numero} ainda não foi divulgado no PNCP: divulgue o contrato e reprocesse a divulgação do ${alteracao.numero} (art. 94).`,
      false,
    );
  }
  const [, cnpjCompra = '', sequencial = '0', ano = '0'] = partes;

  if (alteracao.divulgacao_protocolo === null) {
    const dados = montarTermoPncp(alteracao, contrato);
    const hash = sha256Hex(JSON.stringify(dados));
    let protocolo: string;
    let sequencialTermo: number;
    const modo = alteracao.divulgacao_modo ?? ctx.config.integracoes;
    if (modo === 'online') {
      const { usuario, senha, url } = ctx.config.pncpPublicacao;
      const cnpj = ctx.config.orgao.cnpj;
      if (!usuario || !senha) throw new FalhaTarefa('Publicação no PNCP sem credenciais: defina AGORA_PNCP_USUARIO e AGORA_PNCP_SENHA.', false);
      if (!cnpj) throw new FalhaTarefa('AGORA_ORGAO_CNPJ não configurado: informe o CNPJ do órgão para publicar no PNCP.', false);
      const cliente = criarClientePncp({ urlBase: url, usuario, senha, fetch: ctx.fetch });
      const resposta = await cliente.incluirTermoContrato(cnpj, Number(ano), Number(sequencial), dados);
      protocolo = resposta.localizacao;
      sequencialTermo = resposta.registro.sequencialDocumento ?? 0;
    } else {
      protocolo = `SIMULADO-${sha256Hex(`${tarefa.chave_idempotencia}|${hash}`).slice(0, 20).toUpperCase()}`;
      sequencialTermo = 1 + (Number.parseInt(sha256Hex(alteracao.id).slice(0, 6), 16) % 900);
    }
    const agora = ctx.relogio().toISOString();
    await ctx.banco.executar(
      `UPDATE alteracoes_contratuais
          SET divulgacao_protocolo = $2, divulgacao_numero_controle = $3, divulgacao_hash = $4, divulgacao_modo = $5, divulgado_em = $6, atualizado_em = $6
        WHERE id = $1 AND divulgacao_protocolo IS NULL`,
      [alteracao.id, protocolo, `${contrato.id_pncp ?? `${cnpjCompra}`} — termo ${sequencialTermo}`, hash, modo, agora],
    );
    alteracao = (await obterLinhaAlteracao(ctx.banco, ref.contrato_id, alteracao.id)) ?? alteracao;
  }

  const aceito = alteracao;
  return {
    resultado: { protocolo: aceito.divulgacao_protocolo, numeroControle: aceito.divulgacao_numero_controle, hashDados: aceito.divulgacao_hash, modo: aceito.divulgacao_modo },
    async aplicar(tx) {
      await registrarEvento(
        tx,
        {
          usuarioId: tarefa.solicitada_por,
          acao: 'pncp.divulgar_termo',
          recurso: 'contrato',
          recursoId: contrato.id,
          resumo: `Divulgou o ${aceito.numero ?? 'termo'} do contrato ${contrato.numero} no PNCP${aceito.divulgacao_modo === 'online' ? '' : ' (simulação)'}`,
          dados: {
            alteracaoId: aceito.id,
            especie: aceito.especie,
            tipo: aceito.tipo,
            protocolo: aceito.divulgacao_protocolo,
            numeroControle: aceito.divulgacao_numero_controle,
            hashDados: aceito.divulgacao_hash,
            modo: aceito.divulgacao_modo,
            tarefaId: tarefa.id,
            tentativa: tarefa.tentativas,
          },
          ipHash: null,
        },
        ctx.relogio(),
      );
    },
  };
}
