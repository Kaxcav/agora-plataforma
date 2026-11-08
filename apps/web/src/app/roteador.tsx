import { Suspense } from 'react';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router';
import { ProvedorAvisos } from '../componentes/Avisos';
import { Casca, CarregandoPagina } from '../layout/Casca';
import { ProvedorModoEspecificacao } from '../layout/ModoEspecificacao';
import { ProvedorSessao } from '../sessao/ContextoSessao';
import { RotaProtegida } from '../sessao/RotaProtegida';
import { ErroAplicacao } from './ErroAplicacao';
import { PAGINA_NAO_ENCONTRADA, ROTAS, type DefinicaoRota } from './rotas';

/** Provedores que dependem do roteador (sessão navega para /entrar no 401). */
function Raiz() {
  return (
    <ProvedorSessao>
      <ProvedorModoEspecificacao>
        <ProvedorAvisos>
          <Outlet />
        </ProvedorAvisos>
      </ProvedorModoEspecificacao>
    </ProvedorSessao>
  );
}

function ElementoRota({ definicao }: { definicao: DefinicaoRota }) {
  const PaginaRota = definicao.pagina;
  const conteudo = (
    <Suspense fallback={<CarregandoPagina />}>
      <PaginaRota />
    </Suspense>
  );
  if (definicao.publica) return conteudo;
  return <RotaProtegida permissao={definicao.permissao}>{conteudo}</RotaProtegida>;
}

const NaoEncontrada = PAGINA_NAO_ENCONTRADA;

const rotas: RouteObject[] = [
  {
    element: <Raiz />,
    errorElement: <ErroAplicacao />,
    children: [
      {
        element: <Casca />,
        errorElement: <ErroAplicacao />,
        children: [
          ...ROTAS.map((r): RouteObject => ({ path: r.caminho, element: <ElementoRota definicao={r} /> })),
          { path: '*', element: <NaoEncontrada /> },
        ],
      },
    ],
  },
];

export const roteador = createBrowserRouter(rotas);
