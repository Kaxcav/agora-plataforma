import { useId } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { formatarNumero } from '../utilitarios/formatacao';
import { TAMANHOS_PAGINA } from '../utilitarios/parametrosUrl';

export interface PropsPaginacao {
  pagina: number;
  tamanhoPagina: number;
  total: number;
  aoMudarPagina: (pagina: number) => void;
  aoMudarTamanho?: (tamanho: number) => void;
  rotulo?: string;
}

function paginasVisiveis(atual: number, totalPaginas: number): (number | 'reticencias')[] {
  if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  const conjunto = new Set([1, totalPaginas, atual - 1, atual, atual + 1].filter((p) => p >= 1 && p <= totalPaginas));
  const ordenadas = [...conjunto].sort((a, b) => a - b);
  const resultado: (number | 'reticencias')[] = [];
  ordenadas.forEach((p, i) => {
    const anterior = ordenadas[i - 1];
    if (anterior !== undefined && p - anterior > 1) resultado.push('reticencias');
    resultado.push(p);
  });
  return resultado;
}

/** Paginação acessível: `nav` rotulada, página atual com `aria-current`, faixa exibida e tamanho da página. */
export function Paginacao({ pagina, tamanhoPagina, total, aoMudarPagina, aoMudarTamanho, rotulo = 'Paginação' }: PropsPaginacao) {
  const idTamanho = useId();
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina));
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = total === 0 ? 0 : (atual - 1) * tamanhoPagina + 1;
  const fim = Math.min(total, atual * tamanhoPagina);

  return (
    <div className="paginacao">
      <p className="paginacao__faixa">
        Exibindo <strong className="numero">{formatarNumero(inicio)}</strong>–<strong className="numero">{formatarNumero(fim)}</strong> de{' '}
        <strong className="numero">{formatarNumero(total)}</strong>
      </p>
      {aoMudarTamanho ? (
        <div className="paginacao__tamanho">
          <label htmlFor={idTamanho}>Itens por página</label>
          <select id={idTamanho} value={tamanhoPagina} onChange={(e) => aoMudarTamanho(Number(e.target.value))}>
            {TAMANHOS_PAGINA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {totalPaginas > 1 ? (
        <nav aria-label={rotulo} className="paginacao__navegacao">
          <ul className="paginacao__lista">
            <li>
              <button type="button" className="paginacao__botao" onClick={() => aoMudarPagina(1)} disabled={atual === 1} aria-label="Primeira página" title="Primeira página">
                <ChevronsLeft size={16} aria-hidden="true" />
              </button>
            </li>
            <li>
              <button type="button" className="paginacao__botao" onClick={() => aoMudarPagina(atual - 1)} disabled={atual === 1} aria-label="Página anterior" title="Página anterior">
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            </li>
            {paginasVisiveis(atual, totalPaginas).map((p, i) =>
              p === 'reticencias' ? (
                <li key={`r-${i}`} className="paginacao__reticencias" aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={p}>
                  <button
                    type="button"
                    className="paginacao__botao paginacao__numero"
                    aria-current={p === atual ? 'page' : undefined}
                    aria-label={`Página ${p}`}
                    onClick={() => aoMudarPagina(p)}
                  >
                    {p}
                  </button>
                </li>
              ),
            )}
            <li>
              <button type="button" className="paginacao__botao" onClick={() => aoMudarPagina(atual + 1)} disabled={atual === totalPaginas} aria-label="Próxima página" title="Próxima página">
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
            <li>
              <button type="button" className="paginacao__botao" onClick={() => aoMudarPagina(totalPaginas)} disabled={atual === totalPaginas} aria-label="Última página" title="Última página">
                <ChevronsRight size={16} aria-hidden="true" />
              </button>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
