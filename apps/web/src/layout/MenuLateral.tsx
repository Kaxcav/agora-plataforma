import { useEffect, useRef, type KeyboardEvent } from 'react';
import { NavLink } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { MENU, type SecaoMenu } from '../app/navegacao';
import { useSessao } from '../sessao/ContextoSessao';

function useSecoesPermitidas(): SecaoMenu[] {
  const { temPermissao } = useSessao();
  return MENU.map((s) => ({ ...s, itens: s.itens.filter((i) => temPermissao(i.permissao)) })).filter((s) => s.itens.length > 0);
}

function ListaMenu({ recolhido, aoNavegar }: { recolhido: boolean; aoNavegar?: () => void }) {
  const secoes = useSecoesPermitidas();
  return (
    <ul className="menu-lateral__lista" id="menu-principal-lista">
      {secoes.map((secao) => (
        <li key={secao.id} className="menu-lateral__secao">
          {secao.titulo ? (
            recolhido ? (
              <span className="menu-lateral__divisor" aria-hidden="true" />
            ) : (
              <span className="menu-lateral__grupo" id={`menu-grupo-${secao.id}`}>
                {secao.titulo}
              </span>
            )
          ) : null}
          <ul className="menu-lateral__itens" aria-labelledby={secao.titulo && !recolhido ? `menu-grupo-${secao.id}` : undefined}>
            {secao.itens.map((item) => {
              const Icone = item.icone;
              return (
                <li key={item.caminho}>
                  <NavLink
                    to={item.caminho}
                    end={item.exato}
                    className="menu-lateral__link"
                    aria-label={recolhido ? (secao.titulo ? `${secao.titulo}: ${item.rotulo}` : item.rotulo) : undefined}
                    title={recolhido ? item.rotulo : undefined}
                    onClick={aoNavegar}
                  >
                    <Icone size={20} aria-hidden="true" />
                    <span className="menu-lateral__rotulo">{item.rotulo}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Menu lateral fixo (≥ 1024 px), retrátil: recolhido mostra só ícones com nome acessível. */
export function MenuLateral({ recolhido, aoAlternar }: { recolhido: boolean; aoAlternar: () => void }) {
  return (
    <nav id="menu-principal" aria-label="Menu principal" className={['menu-lateral', recolhido ? 'menu-lateral--recolhido' : ''].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="menu-lateral__recolher"
        aria-expanded={!recolhido}
        aria-controls="menu-principal-lista"
        onClick={aoAlternar}
        title={recolhido ? 'Expandir menu' : 'Recolher menu'}
      >
        {recolhido ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        <span className={recolhido ? 'sr-only' : ''}>{recolhido ? 'Expandir menu' : 'Recolher menu'}</span>
      </button>
      <ListaMenu recolhido={recolhido} />
    </nav>
  );
}

const FOCAVEIS = 'a[href], button:not([disabled])';

/** Gaveta sobreposta (< 1024 px): foco preso enquanto aberta, ESC fecha e devolve o foco ao botão "Menu". */
export function GavetaMenu({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberta) return;
    const primeiro = painel.current?.querySelector<HTMLElement>(FOCAVEIS);
    primeiro?.focus();
    const rolagemAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = rolagemAnterior;
    };
  }, [aberta]);

  if (!aberta) return null;

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      aoFechar();
      return;
    }
    if (e.key !== 'Tab' || !painel.current) return;
    const focaveis = Array.from(painel.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) return;
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div className="gaveta">
      <div className="gaveta__fundo" onClick={aoFechar} aria-hidden="true" />
      <div ref={painel} className="gaveta__painel" role="dialog" aria-modal="true" aria-label="Menu principal" onKeyDown={aoTeclar}>
        <div className="gaveta__topo">
          <span className="gaveta__titulo">Menu</span>
          <button type="button" className="gaveta__fechar" onClick={aoFechar} aria-label="Fechar menu" title="Fechar menu">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav id="menu-principal" aria-label="Menu principal" className="menu-lateral menu-lateral--gaveta">
          <ListaMenu recolhido={false} aoNavegar={aoFechar} />
        </nav>
      </div>
    </div>
  );
}
