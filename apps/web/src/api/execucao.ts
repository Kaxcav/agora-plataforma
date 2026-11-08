import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AlteracaoOrdemCronologica,
  DesignacaoContrato,
  EntradaAlteracaoOrdem,
  EntradaApresentacaoGarantia,
  EntradaComunicacaoAlteracao,
  EntradaDescontoMulta,
  EntradaDesignacao,
  EntradaEncerrarDesignacao,
  EntradaExecucaoGarantia,
  EntradaExigenciaGarantia,
  EntradaLiberacaoGarantia,
  EntradaOcorrencia,
  EntradaOrdemServico,
  EntradaParametrosExecucao,
  EntradaRecebimento,
  EntradaRegularizarOcorrencia,
  EntradaRenovacaoGarantia,
  EntradaReservasCargos,
  EntradaTermoRecebimento,
  ExecucaoContrato,
  FiltroPrazosPagamento,
  OcorrenciaContrato,
  OrdemServicoContrato,
  PaginaPrazosPagamento,
  ParametrosExecucaoContrato,
  RecebimentoContrato,
  RespostaDescontoMulta,
  RespostaGarantia,
  RespostaTermoRecebimento,
  ServidorDesignavel,
  VerificacaoReservasCargos,
} from '@agora/contratos';
import { api, urlApi } from './cliente';

/**
 * Execução do contrato (frente L): abas Fiscalização, Recebimentos e Garantias e a tela Prazos de pagamento.
 * O navegador só fala com a API da Ágora; designação, termos, garantias e decisões são conferidos no servidor.
 */

const segmento = (id: string) => encodeURIComponent(id);
const CHAVE = 'execucao';

export function useExecucaoContrato(id: string) {
  return useQuery({
    queryKey: [CHAVE, 'contrato', id],
    queryFn: ({ signal }) => api.ler<ExecucaoContrato>(`/contratos/${segmento(id)}/execucao`, undefined, signal),
  });
}

export function useServidoresDesignaveis(id: string, habilitado: boolean) {
  return useQuery({
    queryKey: [CHAVE, 'designaveis', id],
    queryFn: ({ signal }) => api.ler<ServidorDesignavel[]>(`/contratos/${segmento(id)}/designaveis`, undefined, signal),
    enabled: habilitado,
  });
}

/** Mutação que, ao terminar, recarrega a execução, o contrato, notificações, pendências e pagamentos. */
function useMutacaoExecucao<E, R>(executar: (entrada: E) => Promise<R>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE] });
      void cliente.invalidateQueries({ queryKey: ['contratos'] });
      void cliente.invalidateQueries({ queryKey: ['pagamentos'] });
      void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
      void cliente.invalidateQueries({ queryKey: ['pendencias'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}

export function useSalvarParametrosExecucao(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaParametrosExecucao) =>
    api.substituir<ParametrosExecucaoContrato>(`/contratos/${segmento(contratoId)}/parametros-execucao`, entrada),
  );
}

export function useDesignar(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaDesignacao) => api.criar<DesignacaoContrato>(`/contratos/${segmento(contratoId)}/designacoes`, entrada));
}

export function useEncerrarDesignacao() {
  return useMutacaoExecucao(({ id, entrada }: { id: string; entrada: EntradaEncerrarDesignacao }) =>
    api.criar<DesignacaoContrato>(`/designacoes/${segmento(id)}/encerrar`, entrada),
  );
}

export function useRegistrarOcorrencia(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaOcorrencia) => api.criar<OcorrenciaContrato>(`/contratos/${segmento(contratoId)}/ocorrencias`, entrada));
}

export function useRegularizarOcorrencia() {
  return useMutacaoExecucao(({ id, entrada }: { id: string; entrada: EntradaRegularizarOcorrencia }) =>
    api.criar<OcorrenciaContrato>(`/ocorrencias/${segmento(id)}/regularizar`, entrada),
  );
}

export function useRegistrarEntrega(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaRecebimento) => api.criar<RecebimentoContrato>(`/contratos/${segmento(contratoId)}/recebimentos`, entrada));
}

export function useLavrarTermo() {
  return useMutacaoExecucao(({ id, entrada }: { id: string; entrada: EntradaTermoRecebimento }) =>
    api.criar<RespostaTermoRecebimento>(`/recebimentos/${segmento(id)}/termos`, entrada),
  );
}

/** PDF do termo de recebimento (gerado no servidor). */
export function urlTermoRecebimento(termoId: string): string {
  return urlApi(`/recebimentos/termos/${segmento(termoId)}/termo.pdf`);
}

export function useExigirGarantia(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaExigenciaGarantia) => api.criar<RespostaGarantia>(`/contratos/${segmento(contratoId)}/garantias`, entrada));
}

type AcaoGarantia =
  | { acao: 'apresentacao'; id: string; entrada: EntradaApresentacaoGarantia }
  | { acao: 'renovacao'; id: string; entrada: EntradaRenovacaoGarantia }
  | { acao: 'liberacao'; id: string; entrada: EntradaLiberacaoGarantia }
  | { acao: 'execucao'; id: string; entrada: EntradaExecucaoGarantia };

export function useAcaoGarantia() {
  return useMutacaoExecucao((a: AcaoGarantia) => api.criar<RespostaGarantia>(`/garantias/${segmento(a.id)}/${a.acao}`, a.entrada));
}

export function useDescontarMulta() {
  return useMutacaoExecucao(({ sancaoId, entrada }: { sancaoId: string; entrada: EntradaDescontoMulta }) =>
    api.criar<RespostaDescontoMulta>(`/sancoes/${segmento(sancaoId)}/descontos`, entrada),
  );
}

export function usePrazosPagamento(filtro: FiltroPrazosPagamento) {
  return useQuery({
    queryKey: [CHAVE, 'prazos', filtro],
    queryFn: ({ signal }) => api.ler<PaginaPrazosPagamento>('/pagamentos/prazos', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAlteracoesOrdem() {
  return useQuery({
    queryKey: [CHAVE, 'alteracoes-ordem'],
    queryFn: ({ signal }) => api.ler<AlteracaoOrdemCronologica[]>('/alteracoes-ordem', undefined, signal),
  });
}

export function useRegistrarAlteracaoOrdem() {
  return useMutacaoExecucao(({ pagamentoId, entrada }: { pagamentoId: string; entrada: EntradaAlteracaoOrdem }) =>
    api.criar<AlteracaoOrdemCronologica>(`/pagamentos/${segmento(pagamentoId)}/alteracoes-ordem`, entrada),
  );
}

export function useComunicarAlteracaoOrdem() {
  return useMutacaoExecucao(({ id, entrada }: { id: string; entrada: EntradaComunicacaoAlteracao }) =>
    api.criar<AlteracaoOrdemCronologica>(`/alteracoes-ordem/${segmento(id)}/comunicacoes`, entrada),
  );
}

export function useRegistrarOrdemServico(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaOrdemServico) => api.criar<OrdemServicoContrato>(`/contratos/${segmento(contratoId)}/ordens-servico`, entrada));
}

export function useRegistrarReservasCargos(contratoId: string) {
  return useMutacaoExecucao((entrada: EntradaReservasCargos) =>
    api.criar<VerificacaoReservasCargos>(`/contratos/${segmento(contratoId)}/reservas-cargos`, entrada),
  );
}
