import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export interface ItemTrilha {
  rotulo: string;
  para?: string;
}

/** Breadcrumb: `<nav aria-label="Você está aqui">`, último item com `aria-current="page"`. */
export function Breadcrumb({ itens }: { itens: readonly ItemTrilha[] }) {
  if (itens.length === 0) return null;
  return (
    <nav aria-label="Você está aqui" className="breadcrumb">
      <ol className="breadcrumb__lista">
        {itens.map((item, i) => {
          const ultimo = i === itens.length - 1;
          return (
            <li key={`${item.rotulo}-${i}`} className="breadcrumb__item">
              {i > 0 ? <ChevronRight className="breadcrumb__separador" size={14} aria-hidden="true" /> : null}
              {ultimo || !item.para ? (
                <span aria-current={ultimo ? 'page' : undefined}>{item.rotulo}</span>
              ) : (
                <Link to={item.para}>{item.rotulo}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
