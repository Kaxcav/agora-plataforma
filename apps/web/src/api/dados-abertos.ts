import { useQuery } from '@tanstack/react-query';
import type { CatalogoDadosAbertos } from '@agora/contratos';
import { requisitar } from './cliente';

/** GET /publico/dados-abertos (sem login): catálogo com dicionário, licença, atualização e hash de cada arquivo. */
export function useCatalogoDadosAbertos() {
  return useQuery({
    queryKey: ['publico', 'dados-abertos'],
    queryFn: ({ signal }) => requisitar<CatalogoDadosAbertos>('/publico/dados-abertos', { sinal: signal, tratar401: false }),
    staleTime: 60_000,
  });
}
