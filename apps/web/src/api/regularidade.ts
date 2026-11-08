import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CertidaoRegistrada,
  ChecklistRegularidade,
  EntradaProrrogarContrato,
  EntradaRegistrarCertidao,
  EntradaRegistrarEnvioCeisCnep,
  MomentoVerificacaoRegularidade,
  RegistroSancaoCeisCnep,
  RespostaProrrogacao,
  VerificacaoRegularidade,
} from '@agora/contratos';
import { api, urlApi } from './cliente';

/**
 * Regularidade do contratado (RF-20, RN-09, RN-23, RN-24): o navegador só fala com a API da Ágora; a consulta ao
 * CEIS e ao CNEP é feita pelo servidor.
 */

const CHAVE = 'regularidade';

/** GET /fornecedores/:id/regularidade — checklist com a última consulta em cache (sem chamada externa). */
export function useRegularidadeFornecedor(id: string | null, momento: MomentoVerificacaoRegularidade = 'assinatura') {
  return useQuery({
    queryKey: [CHAVE, 'fornecedor', id, momento],
    queryFn: ({ signal }) => api.ler<ChecklistRegularidade>(`/fornecedores/${encodeURIComponent(id ?? '')}/regularidade`, { momento }, signal),
    enabled: id !== null && id !== '',
  });
}

/** POST /fornecedores/:id/regularidade/consultar — nova consulta ao CEIS e ao CNEP, registrada. */
export function useConsultarRegularidade(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<VerificacaoRegularidade>(`/fornecedores/${encodeURIComponent(id)}/regularidade/consultar`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE] });
      void cliente.invalidateQueries({ queryKey: ['fornecedores', 'detalhe', id] });
    },
  });
}

export function useCertidoes(id: string) {
  return useQuery({
    queryKey: [CHAVE, 'certidoes', id],
    queryFn: ({ signal }) => api.ler<CertidaoRegistrada[]>(`/fornecedores/${encodeURIComponent(id)}/certidoes`, undefined, signal),
  });
}

/** POST /fornecedores/:id/certidoes — certidão conferida pelo agente. */
export function useRegistrarCertidao(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaRegistrarCertidao) => api.criar<CertidaoRegistrada>(`/fornecedores/${encodeURIComponent(id)}/certidoes`, entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE] });
      void cliente.invalidateQueries({ queryKey: ['fornecedores', 'detalhe', id] });
      void cliente.invalidateQueries({ queryKey: ['processos'] });
    },
  });
}

/** GET /contratos/:id/regularidade — checklist antes da prorrogação. */
export function useRegularidadeContrato(id: string) {
  return useQuery({
    queryKey: [CHAVE, 'contrato', id],
    queryFn: ({ signal }) => api.ler<ChecklistRegularidade>(`/contratos/${encodeURIComponent(id)}/regularidade`, { momento: 'prorrogacao' }, signal),
  });
}

/** POST /contratos/:id/prorrogacoes — termo aditivo de prazo, depois do checklist (RN-09). */
export function useProrrogarContrato(id: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaProrrogarContrato) => api.criar<RespostaProrrogacao>(`/contratos/${encodeURIComponent(id)}/prorrogacoes`, entrada),
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE] });
      void cliente.invalidateQueries({ queryKey: ['contratos'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}

/** GET /pagamentos/:id/regularidade — prévia do recheque (RN-23). */
export function useRegularidadePagamento(id: string | null) {
  return useQuery({
    queryKey: [CHAVE, 'pagamento', id],
    queryFn: ({ signal }) => api.ler<ChecklistRegularidade>(`/pagamentos/${encodeURIComponent(id ?? '')}/regularidade`, undefined, signal),
    enabled: id !== null,
  });
}

/** POST /pagamentos/:id/regularidade — recheque antes do pagamento (RN-23). */
export function useVerificarPagamento() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.criar<VerificacaoRegularidade>(`/pagamentos/${encodeURIComponent(id)}/regularidade`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE] });
      void cliente.invalidateQueries({ queryKey: ['pendencias'] });
      void cliente.invalidateQueries({ queryKey: ['painel'] });
    },
  });
}

/** GET /sancoes/registro-ceis-cnep — sanções aplicadas e o registro no CEIS/CNEP (RN-24). */
export function useRegistrosCeisCnep() {
  return useQuery({
    queryKey: [CHAVE, 'ceis-cnep'],
    queryFn: ({ signal }) => api.ler<RegistroSancaoCeisCnep[]>('/sancoes/registro-ceis-cnep', undefined, signal),
  });
}

/** POST /sancoes/:id/registro-ceis-cnep — protocolo do envio feito no sistema da CGU. */
export function useRegistrarEnvioCeisCnep() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: ({ sancaoId, entrada }: { sancaoId: string; entrada: EntradaRegistrarEnvioCeisCnep }) =>
      api.criar<RegistroSancaoCeisCnep>(`/sancoes/${encodeURIComponent(sancaoId)}/registro-ceis-cnep`, entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: [CHAVE, 'ceis-cnep'] });
      void cliente.invalidateQueries({ queryKey: ['sancoes'] });
    },
  });
}

/** Comprovante em PDF da verificação, para juntar ao processo (art. 91, § 4º). */
export function urlComprovanteVerificacao(id: string): string {
  return urlApi(`/regularidade/verificacoes/${encodeURIComponent(id)}/comprovante.pdf`);
}
