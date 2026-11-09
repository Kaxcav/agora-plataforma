import type {
  ModalidadeGarantia,
  PapelFiscalizacao,
  ResultadoTermoRecebimento,
  SituacaoGarantiaContrato,
  SituacaoPrazoPagamento,
  SituacaoRecebimento,
  TipoOcorrenciaContrato,
} from '@agora/contratos';
import { hojeISO } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../../api/cliente';
import { Alerta, type TomEtiqueta } from '../../../componentes';

/** Rótulos e tons das abas de execução do contrato e da tela de prazos de pagamento (frente L). */

export const ROTULOS_PAPEL: Record<PapelFiscalizacao, string> = {
  gestor: 'Gestor do contrato',
  fiscal_tecnico: 'Fiscal técnico',
  fiscal_administrativo: 'Fiscal administrativo',
  fiscal_requisitante: 'Fiscal requisitante',
  comissao_recebimento: 'Comissão de recebimento definitivo',
};

export const TIPOS_OCORRENCIA: Record<TipoOcorrenciaContrato, string> = {
  falha_execucao: 'Falha na execução',
  atraso: 'Atraso',
  inconformidade: 'Desconformidade com o contrato',
  comunicacao: 'Comunicação da contratada',
  outra: 'Outra',
  ocorrencia: 'Ocorrência',
  glosa: 'Glosa',
  rescisao: 'Rescisão',
};

export const SITUACOES_RECEBIMENTO: Record<SituacaoRecebimento, { rotulo: string; tom: TomEtiqueta }> = {
  aguardando_provisorio: { rotulo: 'Aguardando recebimento provisório', tom: 'info' },
  aguardando_definitivo: { rotulo: 'Aguardando recebimento definitivo', tom: 'aviso' },
  em_correcao: { rotulo: 'Em correção pela contratada', tom: 'erro' },
  recebido: { rotulo: 'Recebido definitivamente', tom: 'sucesso' },
};

export const RESULTADOS_TERMO: Record<ResultadoTermoRecebimento, string> = {
  aceito: 'Objeto recebido',
  com_ressalva: 'Recebido com ressalva (correção exigida)',
  rejeitado: 'Objeto rejeitado (substituição exigida)',
};

export const MODALIDADES: Record<ModalidadeGarantia, string> = {
  caucao_dinheiro: 'Caução em dinheiro',
  caucao_titulos: 'Caução em títulos da dívida pública',
  seguro_garantia: 'Seguro-garantia',
  fianca_bancaria: 'Fiança bancária',
  titulo_capitalizacao: 'Título de capitalização',
};

export const TOM_GARANTIA: Record<SituacaoGarantiaContrato, TomEtiqueta> = {
  aguardando_apresentacao: 'info',
  apresentacao_vencida: 'erro',
  vigente: 'sucesso',
  vence_em_breve: 'aviso',
  vencida: 'erro',
  liberada: 'neutro',
  executada: 'neutro',
};

export const SITUACOES_PRAZO: Record<SituacaoPrazoPagamento, { rotulo: string; tom: TomEtiqueta }> = {
  aguardando_marco: { rotulo: 'Aguardando o marco', tom: 'neutro' },
  no_prazo: { rotulo: 'No prazo', tom: 'sucesso' },
  vence_hoje: { rotulo: 'Vence hoje', tom: 'aviso' },
  vencido: { rotulo: 'Vencido', tom: 'erro' },
  pago_no_prazo: { rotulo: 'Pago no prazo', tom: 'sucesso' },
  pago_com_atraso: { rotulo: 'Pago com atraso', tom: 'alerta' },
};

export const TOM_PRAZO: Record<'no_prazo' | 'vence_hoje' | 'vencido', TomEtiqueta> = { no_prazo: 'info', vence_hoje: 'aviso', vencido: 'erro' };

/** Data de hoje no fuso do navegador (o servidor confere de novo). */
export function hoje(): string {
  return hojeISO(new Date());
}

/** Erro devolvido pela API dentro de um formulário, com os detalhes de cada regra. */
export function ErroFormulario({ erro, titulo }: { erro: unknown; titulo: string }) {
  if (!erro) return null;
  return (
    <Alerta tipo="erro" anunciar titulo={titulo}>
      <p>{mensagemDeErro(erro)}</p>
      {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
        <ul>
          {erro.detalhes.map((d, i) => (
            <li key={i}>{d.mensagem}</li>
          ))}
        </ul>
      ) : null}
      {erro instanceof ErroApi && erro.idRequisicao ? (
        <p className="texto-pequeno">
          Código para o suporte: <code>{erro.idRequisicao}</code>
        </p>
      ) : null}
    </Alerta>
  );
}
