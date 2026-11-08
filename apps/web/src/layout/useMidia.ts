import { useCallback, useSyncExternalStore } from 'react';

/** Acompanha uma media query (ex.: menu vira gaveta abaixo de 1024 px). */
export function useMidia(consulta: string): boolean {
  const assinar = useCallback(
    (avisar: () => void) => {
      const lista = window.matchMedia(consulta);
      lista.addEventListener('change', avisar);
      return () => lista.removeEventListener('change', avisar);
    },
    [consulta],
  );
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

export const CONSULTA_COMPACTA = '(max-width: 63.99rem)';
