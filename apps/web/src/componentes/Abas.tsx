import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

export interface DefinicaoAba {
  id: string;
  rotulo: string;
  /** Contador opcional exibido ao lado do rótulo. */
  contador?: number | null;
  /** Renderizado só quando a aba está ativa (dados carregam sob demanda). */
  conteudo: () => ReactNode;
}

export interface PropsAbas {
  abas: readonly DefinicaoAba[];
  rotulo: string;
  /** Parâmetro de URL que guarda a aba ativa (padrão `aba`). */
  parametro?: string;
}

/**
 * Abas no padrão WAI-ARIA (tablist/tab/tabpanel), setas, Home e End, ativação automática,
 * sincronizadas com `?aba=` para que o link leve direto à aba.
 */
export function Abas({ abas, rotulo, parametro = 'aba' }: PropsAbas) {
  const [params, definirParams] = useSearchParams();
  const base = useId();
  const referencias = useRef<(HTMLButtonElement | null)[]>([]);
  const solicitada = params.get(parametro);
  const ativa = abas.find((a) => a.id === solicitada) ?? abas[0];

  if (!ativa) return null;

  const ativar = (id: string, focar: boolean) => {
    definirParams(
      (anterior) => {
        const novo = new URLSearchParams(anterior);
        if (id === abas[0]?.id) novo.delete(parametro);
        else novo.set(parametro, id);
        return novo;
      },
      { replace: true },
    );
    if (focar) {
      const indice = abas.findIndex((a) => a.id === id);
      referencias.current[indice]?.focus();
    }
  };

  const aoTeclar = (evento: KeyboardEvent<HTMLButtonElement>, indice: number) => {
    let destino: number | null = null;
    if (evento.key === 'ArrowRight') destino = (indice + 1) % abas.length;
    else if (evento.key === 'ArrowLeft') destino = (indice - 1 + abas.length) % abas.length;
    else if (evento.key === 'Home') destino = 0;
    else if (evento.key === 'End') destino = abas.length - 1;
    if (destino === null) return;
    evento.preventDefault();
    const aba = abas[destino];
    if (aba) ativar(aba.id, true);
  };

  return (
    <div className="abas">
      <div className="abas__lista" role="tablist" aria-label={rotulo}>
        {abas.map((aba, indice) => {
          const selecionada = aba.id === ativa.id;
          return (
            <button
              key={aba.id}
              ref={(el) => {
                referencias.current[indice] = el;
              }}
              id={`${base}-aba-${aba.id}`}
              type="button"
              role="tab"
              aria-selected={selecionada}
              aria-controls={`${base}-painel-${aba.id}`}
              tabIndex={selecionada ? 0 : -1}
              className="abas__aba"
              onClick={() => ativar(aba.id, false)}
              onKeyDown={(e) => aoTeclar(e, indice)}
            >
              <span>{aba.rotulo}</span>
              {aba.contador !== undefined && aba.contador !== null ? (
                <span className="abas__contador numero">{aba.contador}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        id={`${base}-painel-${ativa.id}`}
        role="tabpanel"
        aria-labelledby={`${base}-aba-${ativa.id}`}
        tabIndex={0}
        className="abas__painel"
      >
        {ativa.conteudo()}
      </div>
    </div>
  );
}
