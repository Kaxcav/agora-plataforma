/**
 * Publicações no DOU (RF-36). O navegador só fala com a API da Ágora; a conferência na consulta pública do DOU é
 * feita pelo servidor, pela fila de integrações. O envio é feito pelo servidor credenciado no INCom.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CandidatoMateriaDou,
  EntradaEnvioDou,
  EntradaJornalDou,
  EntradaMateriaDou,
  EntradaPublicacaoDou,
  MateriaDou,
  Pagina,
  ResumoPublicacoesDou,
  SituacaoMateriaDou,
  TipoMateriaDou,
} from '@agora/contratos';
import { api } from './cliente';

const chaveDou = ['publicacoes-dou'] as const;

export interface FiltroMateriasDou {
  tipo: TipoMateriaDou | null;
  situacao: SituacaoMateriaDou | null;
  processoId?: string | null;
  pagina: number;
  tamanhoPagina?: number;
}

/** GET /publicacoes-dou/resumo */
export function useResumoDou() {
  return useQuery({
    queryKey: [...chaveDou, 'resumo'],
    queryFn: ({ signal }) => api.ler<ResumoPublicacoesDou>('/publicacoes-dou/resumo', undefined, signal),
  });
}

/** GET /publicacoes-dou?tipo&situacao&processoId&pagina */
export function useMateriasDou(f: FiltroMateriasDou) {
  return useQuery({
    queryKey: [...chaveDou, 'lista', f],
    queryFn: ({ signal }) =>
      api.ler<Pagina<MateriaDou>>(
        '/publicacoes-dou',
        { tipo: f.tipo, situacao: f.situacao, processoId: f.processoId ?? null, pagina: f.pagina, tamanhoPagina: f.tamanhoPagina ?? 10 },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

/** GET /publicacoes-dou/candidatos?tipo — atos que podem gerar matéria. */
export function useCandidatosDou(tipo: TipoMateriaDou | null) {
  return useQuery({
    queryKey: [...chaveDou, 'candidatos', tipo],
    queryFn: ({ signal }) => api.ler<CandidatoMateriaDou[]>('/publicacoes-dou/candidatos', { tipo }, signal),
    enabled: tipo !== null,
  });
}

function useAcaoDou<E>(executar: (entrada: E) => Promise<MateriaDou>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: executar,
    onSuccess: (materia) => {
      void cliente.invalidateQueries({ queryKey: chaveDou });
      // O aviso publicado muda a situação do DOU na etapa 5 da jornada.
      if (materia.processo.id) void cliente.invalidateQueries({ queryKey: ['processos', 'detalhe', materia.processo.id] });
    },
  });
}

const caminhoMateria = (id: string, sufixo: string) => `/publicacoes-dou/${encodeURIComponent(id)}/${sufixo}`;

/** POST /publicacoes-dou — gera (ou refaz o rascunho de) uma matéria. */
export function useGerarMateriaDou() {
  return useAcaoDou((entrada: EntradaMateriaDou) => api.criar<MateriaDou>('/publicacoes-dou', entrada));
}

/** POST /publicacoes-dou/:id/envio — protocolo do INCom. */
export function useRegistrarEnvioDou() {
  return useAcaoDou(({ id, ...entrada }: EntradaEnvioDou & { id: string }) => api.criar<MateriaDou>(caminhoMateria(id, 'envio'), entrada));
}

/** POST /publicacoes-dou/:id/conferir — consulta pública do DOU, pelo servidor. */
export function useConferirDou() {
  return useAcaoDou((id: string) => api.criar<MateriaDou>(caminhoMateria(id, 'conferir')));
}

/** POST /publicacoes-dou/:id/publicacao — registro manual da edição. */
export function useRegistrarPublicacaoDou() {
  return useAcaoDou(({ id, ...entrada }: EntradaPublicacaoDou & { id: string }) => api.criar<MateriaDou>(caminhoMateria(id, 'publicacao'), entrada));
}

/** POST /publicacoes-dou/:id/jornal — aviso em jornal diário de grande circulação (art. 54, § 1º). */
export function useRegistrarJornalDou() {
  return useAcaoDou(({ id, ...entrada }: EntradaJornalDou & { id: string }) => api.criar<MateriaDou>(caminhoMateria(id, 'jornal'), entrada));
}
