import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ChevronDown, KeyRound, LogIn, LogOut, Menu, UserRound } from 'lucide-react';
import { mensagemDeErro } from '../api/cliente';
import { useConfiguracaoPublica } from '../api/sessao';
import { Alternador } from '../componentes/Alternador';
import { useAvisos } from '../componentes/Avisos';
import { Botao, LinkBotao } from '../componentes/Botao';
import { Esqueleto } from '../componentes/Esqueleto';
import { enderecoTrocaSenha, useSessao } from '../sessao/ContextoSessao';
import { NOMES_PERFIS } from '../sessao/permissoes';
import { Marca } from './Marca';
import { useModoEspecificacao } from './ModoEspecificacao';

function MenuUsuario() {
  const { usuario, sair, saindo } = useSessao();
  const local = useLocation();
  const { avisar } = useAvisos();
  const navegar = useNavigate();
  const [aberto, definirAberto] = useState(false);
  const idPainel = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) definirAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        definirAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  if (!usuario) return null;
  const primeiroNome = usuario.nome.split(' ')[0] ?? usuario.nome;

  const encerrar = async () => {
    let mensagem = 'Você saiu da Ágora. Sua sessão foi encerrada.';
    try {
      await sair();
    } catch (erro) {
      mensagem = `A sessão foi encerrada neste navegador. ${mensagemDeErro(erro)}`;
    }
    definirAberto(false);
    void navegar('/entrar', { replace: true });
    avisar({ tipo: 'info', mensagem });
  };

  return (
    <div className="menu-usuario" ref={raiz}>
      <button
        ref={botao}
        type="button"
        className="menu-usuario__botao"
        aria-expanded={aberto}
        aria-controls={idPainel}
        onClick={() => definirAberto((v) => !v)}
      >
        <UserRound size={18} aria-hidden="true" />
        <span className="menu-usuario__nome">{primeiroNome}</span>
        <span className="sr-only">: dados da sessão, troca de senha e sair</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {aberto ? (
        <div id={idPainel} className="menu-usuario__painel">
          <p className="menu-usuario__nome-completo">{usuario.nome}</p>
          <p className="menu-usuario__email">{usuario.email}</p>
          <div className="menu-usuario__bloco">
            <p className="menu-usuario__rotulo">Perfis</p>
            <ul className="menu-usuario__perfis">
              {usuario.perfis.map((p) => (
                <li key={p}>{NOMES_PERFIS[p]}</li>
              ))}
            </ul>
          </div>
          <div className="menu-usuario__bloco">
            <p className="menu-usuario__rotulo">Escopo de UASGs</p>
            <p>{usuario.todasUasgs ? 'Todas as UASGs' : usuario.uasgs.length > 0 ? usuario.uasgs.join(', ') : 'Nenhuma UASG atribuída'}</p>
          </div>
          {usuario.deveTrocarSenha ? null : (
            <LinkBotao to={enderecoTrocaSenha(`${local.pathname}${local.search}`)} variante="terciario" icone={KeyRound} className="menu-usuario__sair" onClick={() => definirAberto(false)}>
              Trocar senha
            </LinkBotao>
          )}
          <Botao variante="secundario" icone={LogOut} onClick={() => void encerrar()} carregando={saindo} className="menu-usuario__sair">
            Sair
          </Botao>
        </div>
      ) : null}
    </div>
  );
}

export interface PropsCabecalho {
  mostrarBotaoMenu: boolean;
  gavetaAberta: boolean;
  aoAbrirGaveta: () => void;
  referenciaBotaoMenu: RefObject<HTMLButtonElement | null>;
}

export function Cabecalho({ mostrarBotaoMenu, gavetaAberta, aoAbrirGaveta, referenciaBotaoMenu }: PropsCabecalho) {
  const configuracao = useConfiguracaoPublica();
  const { usuario, carregando } = useSessao();
  const { ativo, definir } = useModoEspecificacao();
  const { pathname } = useLocation();
  const orgao = configuracao.data?.orgao;

  return (
    <header className="cabecalho">
      <div className="cabecalho__interno">
        {mostrarBotaoMenu ? (
          <button
            ref={referenciaBotaoMenu}
            type="button"
            className="cabecalho__menu"
            aria-expanded={gavetaAberta}
            aria-controls="menu-principal"
            onClick={aoAbrirGaveta}
          >
            <Menu size={20} aria-hidden="true" />
            <span>Menu</span>
          </button>
        ) : null}
        {/* Nome acessível = texto visível + complemento oculto (WCAG 2.5.3, rótulo no nome). */}
        <Link to={usuario ? '/' : '/transparencia'} className="cabecalho__marca">
          <Marca />
          <span className="sr-only">, ir para {usuario ? 'o início' : 'a transparência'}</span>
        </Link>
        <div className="cabecalho__orgao">
          {orgao ? (
            <>
              <span className="cabecalho__orgao-sigla">{orgao.sigla}</span>
              <span className="cabecalho__orgao-nome">{orgao.unidade || orgao.nome}</span>
            </>
          ) : configuracao.isPending ? (
            <Esqueleto largura="12rem" />
          ) : null}
        </div>
        <div className="cabecalho__ferramentas">
          <Alternador escuro rotulo="Modo especificação técnica" ligado={ativo} aoMudar={definir} />
          {usuario ? (
            <MenuUsuario />
          ) : !carregando && pathname !== '/entrar' ? (
            <Link to="/entrar" className="cabecalho__entrar">
              <LogIn size={18} aria-hidden="true" />
              <span>Entrar</span>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
