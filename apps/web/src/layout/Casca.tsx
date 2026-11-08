import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Carregando, EsqueletoDetalhe } from '../componentes/Esqueleto';
import { useSessao } from '../sessao/ContextoSessao';
import { gravarPreferencia, lerPreferencia } from '../utilitarios/preferencias';
import { Cabecalho } from './Cabecalho';
import { solicitarFocoTitulo } from './foco';
import { GavetaMenu, MenuLateral } from './MenuLateral';
import { FaixaAmbiente, LinkSalto, Rodape } from './Rodape';
import { CONSULTA_COMPACTA, useMidia } from './useMidia';

export function CarregandoPagina() {
  return (
    <Carregando rotulo="Carregando a página">
      <EsqueletoDetalhe />
    </Carregando>
  );
}

/**
 * Estrutura comum: link de salto → faixa de ambiente → cabeçalho → menu lateral (se autenticado)
 * → `<main id="conteudo">` → rodapé. Na troca de rota o `<h1>` recebe o foco (ver `Pagina`).
 */
export function Casca() {
  const { usuario } = useSessao();
  const { pathname } = useLocation();
  const compacto = useMidia(CONSULTA_COMPACTA);
  const [recolhido, definirRecolhido] = useState(() => lerPreferencia('menu-recolhido') === 'sim');
  const [gavetaAberta, definirGavetaAberta] = useState(false);
  const botaoMenu = useRef<HTMLButtonElement>(null);
  const primeiraCarga = useRef(true);

  useLayoutEffect(() => {
    if (primeiraCarga.current) {
      primeiraCarga.current = false;
      return;
    }
    solicitarFocoTitulo();
  }, [pathname]);

  useEffect(() => {
    definirGavetaAberta(false);
  }, [pathname]);

  useEffect(() => {
    if (!compacto) definirGavetaAberta(false);
  }, [compacto]);

  const alternarRecolhido = useCallback(() => {
    definirRecolhido((v) => {
      gravarPreferencia('menu-recolhido', v ? null : 'sim');
      return !v;
    });
  }, []);

  const fecharGaveta = useCallback(() => {
    definirGavetaAberta(false);
    botaoMenu.current?.focus();
  }, []);

  // Durante a troca obrigatória de senha não há navegação: só o menu do usuário (Sair).
  const comMenu = usuario !== null && !usuario.deveTrocarSenha && pathname !== '/entrar';

  return (
    <div className="aplicacao">
      <LinkSalto />
      <FaixaAmbiente />
      <Cabecalho
        mostrarBotaoMenu={comMenu && compacto}
        gavetaAberta={gavetaAberta}
        aoAbrirGaveta={() => definirGavetaAberta(true)}
        referenciaBotaoMenu={botaoMenu}
      />
      <div className={['casca', comMenu && !compacto ? (recolhido ? 'casca--menu-recolhido' : 'casca--menu') : ''].filter(Boolean).join(' ')}>
        {comMenu && !compacto ? <MenuLateral recolhido={recolhido} aoAlternar={alternarRecolhido} /> : null}
        {comMenu && compacto ? <GavetaMenu aberta={gavetaAberta} aoFechar={fecharGaveta} /> : null}
        <main id="conteudo" tabIndex={-1} className="conteudo">
          <Suspense fallback={<CarregandoPagina />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <Rodape />
    </div>
  );
}
