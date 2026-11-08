import type { ReactNode } from 'react';
import { FunnelX } from 'lucide-react';
import { contar } from '../utilitarios/formatacao';
import { Botao } from './Botao';

export interface PropsBarraFiltros {
  children: ReactNode;
  /** Total de resultados; `undefined` enquanto carrega (nada de zero provisório). */
  total: number | undefined;
  /** Substantivos para a contagem: ['contrato', 'contratos']. */
  substantivo: readonly [string, string];
  /** Concordância: "Nenhuma ata encontrada", "12 atas encontradas". */
  feminino?: boolean;
  filtrosAtivos: boolean;
  aoLimpar: () => void;
  rotulo?: string;
}

/**
 * Filtros agrupados com a contagem de resultados anunciada (`aria-live="polite"`) e "Limpar filtros".
 */
export function BarraFiltros({ children, total, substantivo, feminino, filtrosAtivos, aoLimpar, rotulo = 'Filtros' }: PropsBarraFiltros) {
  const [singular, plural] = substantivo;
  const sufixo = feminino ? 'a' : 'o';
  const texto =
    total === undefined
      ? 'Carregando resultados…'
      : total === 0
        ? `Nenhum${feminino ? 'a' : ''} ${singular} encontrad${sufixo}`
        : `${contar(total, singular, plural)} encontrad${sufixo}${total === 1 ? '' : 's'}`;
  return (
    <section className="barra-filtros" aria-label={rotulo}>
      <div className="barra-filtros__campos">{children}</div>
      <div className="barra-filtros__rodape">
        <p className="barra-filtros__contagem" aria-live="polite" aria-atomic="true">
          {texto}
          {filtrosAtivos && total !== undefined ? <span className="texto-secundario"> com os filtros aplicados</span> : null}
        </p>
        {filtrosAtivos ? (
          <Botao variante="terciario" tamanho="compacto" icone={FunnelX} onClick={aoLimpar}>
            Limpar filtros
          </Botao>
        ) : null}
      </div>
    </section>
  );
}
