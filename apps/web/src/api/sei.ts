/**
 * Integração com o SEI (RF-35). O navegador só fala com a API da Ágora: quem chama o web service do SEI é o
 * trabalhador da fila, no servidor. A assinatura com certificado ICP-Brasil acontece no próprio SEI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntegracaoSeiProcesso, TarefaSei } from '@agora/contratos';
import { api } from './cliente';
import { chaveProcesso } from './jornada';

export const chaveSei = (processoId: string) => [...chaveProcesso(processoId), 'sei'] as const;

const emAndamento = (t: TarefaSei | null | undefined) => t?.situacao === 'na_fila' || t?.situacao === 'executando' || t?.situacao === 'nova_tentativa';

/** GET /processos/:id/sei — atualizado sozinho enquanto houver envio ou consulta na fila. */
export function useIntegracaoSei(processoId: string) {
  return useQuery({
    queryKey: chaveSei(processoId),
    queryFn: ({ signal }) => api.ler<IntegracaoSeiProcesso>(`/processos/${encodeURIComponent(processoId)}/sei`, undefined, signal),
    refetchInterval: (consulta) => (emAndamento(consulta.state.data?.envio) || emAndamento(consulta.state.data?.consulta) ? 4000 : false),
  });
}

function useAcaoSei(processoId: string, sufixo: 'enviar' | 'consultar-assinaturas') {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: () => api.criar<IntegracaoSeiProcesso>(`/processos/${encodeURIComponent(processoId)}/sei/${sufixo}`),
    onSuccess: (sei) => {
      cliente.setQueryData(chaveSei(processoId), sei);
      // A árvore do processo e as regras de avanço (RIA-02) dependem das assinaturas refletidas.
      void cliente.invalidateQueries({ queryKey: chaveProcesso(processoId), exact: true });
    },
  });
}

/** POST /processos/:id/sei/enviar — gera o processo no SEI, inclui os documentos aprovados e monta o bloco de assinatura. */
export function useEnviarSei(processoId: string) {
  return useAcaoSei(processoId, 'enviar');
}

/** POST /processos/:id/sei/consultar-assinaturas — reflete na árvore as assinaturas feitas no SEI. */
export function useConsultarAssinaturasSei(processoId: string) {
  return useAcaoSei(processoId, 'consultar-assinaturas');
}
