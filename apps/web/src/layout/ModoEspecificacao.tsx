import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { gravarPreferencia, lerPreferencia } from '../utilitarios/preferencias';

interface ValorModoEspecificacao {
  ativo: boolean;
  definir: (ativo: boolean) => void;
}

const ContextoModo = createContext<ValorModoEspecificacao | null>(null);

/** "Modo especificação técnica": mostra, em cada tela, as regras do catálogo aplicadas a ela. */
export function ProvedorModoEspecificacao({ children }: { children: ReactNode }) {
  const [ativo, definirAtivo] = useState(() => lerPreferencia('modo-especificacao') === 'sim');
  const definir = useCallback((valor: boolean) => {
    definirAtivo(valor);
    gravarPreferencia('modo-especificacao', valor ? 'sim' : null);
  }, []);
  const valor = useMemo(() => ({ ativo, definir }), [ativo, definir]);
  return <ContextoModo value={valor}>{children}</ContextoModo>;
}

export function useModoEspecificacao(): ValorModoEspecificacao {
  const valor = use(ContextoModo);
  if (!valor) throw new Error('useModoEspecificacao precisa estar dentro de ProvedorModoEspecificacao.');
  return valor;
}
