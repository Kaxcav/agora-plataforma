import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntradaDosimetria,
  EntradaInstaurarSancao,
  EntradaMultaMoratoria,
  FaixaIdc,
  FornecedorDetalhe,
  FornecedorResumo,
  Pagina,
  ParametrosLista,
  ResultadoDosimetria,
  ResultadoMultaMoratoria,
  Sancao,
  TipoSancao,
} from '@agora/contratos';
import { api } from './cliente';

/** GET /fornecedores?busca&faixa&comSancao */
export interface FiltroFornecedores extends ParametrosLista {
  faixa?: FaixaIdc;
  comSancao?: boolean;
}

export function useFornecedores(filtro: FiltroFornecedores, habilitado = true) {
  return useQuery({
    queryKey: ['fornecedores', 'lista', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<FornecedorResumo>>('/fornecedores', { ...filtro }, signal),
    placeholderData: keepPreviousData,
    enabled: habilitado,
  });
}

export function useFornecedor(id: string | null) {
  return useQuery({
    queryKey: ['fornecedores', 'detalhe', id],
    queryFn: ({ signal }) => api.ler<FornecedorDetalhe>(`/fornecedores/${encodeURIComponent(id ?? '')}`, undefined, signal),
    enabled: id !== null && id !== '',
  });
}

export type SituacaoSancao = Sancao['situacao'];

/** GET /sancoes?situacao&tipo */
export interface FiltroSancoes extends ParametrosLista {
  situacao?: SituacaoSancao;
  tipo?: TipoSancao;
}

export function useSancoes(filtro: FiltroSancoes) {
  return useQuery({
    queryKey: ['sancoes', filtro],
    queryFn: ({ signal }) => api.ler<Pagina<Sancao>>('/sancoes', { ...filtro }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useInstaurarSancao() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (entrada: EntradaInstaurarSancao) => api.criar<Sancao>('/sancoes', entrada),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['sancoes'] });
      void cliente.invalidateQueries({ queryKey: ['fornecedores'] });
    },
  });
}

/** POST /sancoes/dosimetria/simular — somente leitura (art. 156). */
export function useSimularDosimetria() {
  return useMutation({
    mutationFn: (entrada: EntradaDosimetria) => api.criar<ResultadoDosimetria>('/sancoes/dosimetria/simular', entrada),
  });
}

/** POST /sancoes/moratoria/simular — somente leitura (art. 162). */
export function useSimularMultaMoratoria() {
  return useMutation({
    mutationFn: (entrada: EntradaMultaMoratoria) => api.criar<ResultadoMultaMoratoria>('/sancoes/moratoria/simular', entrada),
  });
}
