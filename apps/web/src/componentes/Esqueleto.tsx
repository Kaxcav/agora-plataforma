/**
 * Esqueletos com a forma do conteúdo. Nunca exibem números: durante o carregamento não há "zero provisório".
 */
import type { ReactNode } from 'react';

export interface PropsEsqueleto {
  largura?: string;
  altura?: string;
  circular?: boolean;
  className?: string;
}

export function Esqueleto({ largura = '100%', altura = '1em', circular, className }: PropsEsqueleto) {
  return (
    <span
      className={['esqueleto', circular ? 'esqueleto--circular' : '', className ?? ''].filter(Boolean).join(' ')}
      style={{ width: largura, height: altura }}
      aria-hidden="true"
    />
  );
}

export function EsqueletoTexto({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="pilha pilha--compacta" aria-hidden="true">
      {Array.from({ length: linhas }, (_, i) => (
        <Esqueleto key={i} largura={i === linhas - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/** Bloco de carregamento anunciado ("Carregando …") para leitores de tela. */
export function Carregando({ rotulo = 'Carregando', children }: { rotulo?: string; children?: ReactNode }) {
  return (
    <div className="carregando" aria-busy="true">
      <span className="sr-only" role="status">
        {rotulo}…
      </span>
      {children ?? <EsqueletoTexto />}
    </div>
  );
}

export function EsqueletoCartoes({ quantidade = 4 }: { quantidade?: number }) {
  return (
    <div className="grade grade--kpi" aria-hidden="true">
      {Array.from({ length: quantidade }, (_, i) => (
        <div key={i} className="indicador">
          <Esqueleto largura="50%" />
          <Esqueleto largura="70%" altura="2rem" />
          <Esqueleto largura="85%" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoTabela({ linhas = 6, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="esqueleto-tabela" aria-hidden="true">
      <div className="esqueleto-tabela__cabecalho">
        {Array.from({ length: colunas }, (_, i) => (
          <Esqueleto key={i} largura={`${60 + ((i * 17) % 35)}%`} />
        ))}
      </div>
      {Array.from({ length: linhas }, (_, l) => (
        <div key={l} className="esqueleto-tabela__linha">
          {Array.from({ length: colunas }, (_, c) => (
            <Esqueleto key={c} largura={`${45 + (((l + 2) * (c + 3) * 13) % 50)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EsqueletoDetalhe() {
  return (
    <div className="pilha pilha--ampla" aria-hidden="true">
      <div className="cartao">
        <div className="grade grade--3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="pilha pilha--compacta">
              <Esqueleto largura="40%" />
              <Esqueleto largura="75%" />
            </div>
          ))}
        </div>
      </div>
      <EsqueletoCartoes quantidade={3} />
      <EsqueletoTabela linhas={4} />
    </div>
  );
}
