import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { EstadoErro, SemPermissao } from '../componentes/Estados';
import { Pagina } from '../componentes/Pagina';
import { CarregandoPagina } from '../layout/Casca';
import { CAMINHO_TROCAR_SENHA, enderecoTrocaSenha, useSessao } from './ContextoSessao';
import type { RequisitoPermissao } from './permissoes';

/**
 * Guarda de rota: sem sessão → /entrar?retorno=<rota>; senha temporária → /trocar-senha; sem permissão → explicação (403).
 * É só conveniência de interface: a API recusa de qualquer forma.
 */
export function RotaProtegida({ permissao, children }: { permissao?: RequisitoPermissao; children: ReactNode }) {
  const { sessao, carregando, erro, temPermissao, tentarNovamente } = useSessao();
  const local = useLocation();

  if (carregando) return <CarregandoPagina />;

  if (!sessao) {
    if (erro) {
      return (
        <Pagina titulo="Serviço indisponível">
          <EstadoErro erro={erro} titulo="Não foi possível verificar a sua sessão" aoTentarNovamente={tentarNovamente} />
        </Pagina>
      );
    }
    const retorno = `${local.pathname}${local.search}`;
    return <Navigate to={`/entrar?retorno=${encodeURIComponent(retorno)}`} replace />;
  }

  // Senha temporária: nenhuma outra tela até a troca (a API também recusa com TROCA_SENHA_OBRIGATORIA).
  if (sessao.usuario.deveTrocarSenha && local.pathname !== CAMINHO_TROCAR_SENHA) {
    return <Navigate to={enderecoTrocaSenha(`${local.pathname}${local.search}`)} replace />;
  }

  if (!temPermissao(permissao)) {
    return (
      <Pagina titulo="Acesso não permitido" trilha={[{ rotulo: 'Início', para: '/' }]}>
        <SemPermissao />
      </Pagina>
    );
  }

  return <>{children}</>;
}
