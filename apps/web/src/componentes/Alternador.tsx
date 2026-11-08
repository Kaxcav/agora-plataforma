import { useId, type ReactNode } from 'react';

export interface PropsAlternador {
  rotulo: ReactNode;
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  ajuda?: ReactNode;
  desabilitado?: boolean;
  /** Variante para fundo escuro (cabeçalho). */
  escuro?: boolean;
  id?: string;
}

/** Interruptor acessível: `role="switch"` + `aria-checked`, acionável por Espaço/Enter. */
export function Alternador({ rotulo, ligado, aoMudar, ajuda, desabilitado, escuro, id }: PropsAlternador) {
  const automatico = useId();
  const idFinal = id ?? automatico;
  const idAjuda = ajuda ? `${idFinal}-ajuda` : undefined;
  return (
    <div className={['alternador', escuro ? 'alternador--escuro' : ''].filter(Boolean).join(' ')}>
      <button
        id={idFinal}
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-describedby={idAjuda}
        className="alternador__botao"
        disabled={desabilitado}
        onClick={() => aoMudar(!ligado)}
      >
        <span className="alternador__trilho" aria-hidden="true">
          <span className="alternador__pino" />
        </span>
        <span className="alternador__rotulo">{rotulo}</span>
      </button>
      {ajuda ? (
        <p id={idAjuda} className="campo__ajuda">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}
