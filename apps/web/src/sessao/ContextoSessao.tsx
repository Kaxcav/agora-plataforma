import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { EntradaLogin, Sessao, UsuarioSessao } from '@agora/contratos';
import { definirTokenCsrf, registrarAoExigirTrocaSenha, registrarAoNaoAutenticado } from '../api/cliente';
import { CHAVE_CONFIGURACAO, CHAVE_SESSAO, useConsultaSessao, useEntrar, useSair } from '../api/sessao';
import { possuiPermissao, type RequisitoPermissao } from './permissoes';

interface ValorSessao {
  /** undefined enquanto a sessão é consultada; null quando não há sessão. */
  sessao: Sessao | null | undefined;
  usuario: UsuarioSessao | null;
  carregando: boolean;
  erro: unknown;
  temPermissao: (requisito: RequisitoPermissao | undefined) => boolean;
  entrar: (entrada: EntradaLogin) => Promise<Sessao>;
  entrando: boolean;
  erroEntrar: unknown;
  sair: () => Promise<void>;
  saindo: boolean;
  tentarNovamente: () => void;
}

const ContextoSessao = createContext<ValorSessao | null>(null);

export const CAMINHO_TROCAR_SENHA = '/trocar-senha';

/** Rota de retorno segura: só caminhos internos (evita redirecionamento aberto). */
export function caminhoRetornoSeguro(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) return '/';
  if (valor.startsWith('/entrar') || valor.startsWith(CAMINHO_TROCAR_SENHA)) return '/';
  return valor;
}

/** /trocar-senha guardando o destino original. */
export function enderecoTrocaSenha(retorno: string): string {
  const destino = caminhoRetornoSeguro(retorno);
  return destino === '/' ? CAMINHO_TROCAR_SENHA : `${CAMINHO_TROCAR_SENHA}?retorno=${encodeURIComponent(destino)}`;
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const consulta = useConsultaSessao();
  const mutacaoEntrar = useEntrar();
  const mutacaoSair = useSair();
  const cliente = useQueryClient();
  const navegar = useNavigate();
  const local = useLocation();

  const sessao = consulta.isPending ? undefined : (consulta.data ?? null);

  useEffect(() => {
    definirTokenCsrf(sessao?.csrfToken ?? null);
  }, [sessao]);

  const caminhoAtual = `${local.pathname}${local.search}`;

  useEffect(() => {
    registrarAoNaoAutenticado(() => {
      definirTokenCsrf(null);
      cliente.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_CONFIGURACAO[0] && q.queryKey[0] !== CHAVE_SESSAO[0] });
      cliente.setQueryData(CHAVE_SESSAO, null);
      if (!window.location.pathname.startsWith('/entrar')) {
        void navegar(`/entrar?retorno=${encodeURIComponent(caminhoRetornoSeguro(caminhoAtual))}&motivo=expirada`, { replace: true });
      }
    });
    return () => registrarAoNaoAutenticado(null);
  }, [cliente, navegar, caminhoAtual]);

  useEffect(() => {
    registrarAoExigirTrocaSenha(() => {
      cliente.setQueryData<Sessao | null>(CHAVE_SESSAO, (atual) => (atual ? { ...atual, usuario: { ...atual.usuario, deveTrocarSenha: true } } : atual));
      if (!window.location.pathname.startsWith(CAMINHO_TROCAR_SENHA)) void navegar(enderecoTrocaSenha(caminhoAtual), { replace: true });
    });
    return () => registrarAoExigirTrocaSenha(null);
  }, [cliente, navegar, caminhoAtual]);

  const usuario = sessao?.usuario ?? null;
  const temPermissao = useCallback((requisito: RequisitoPermissao | undefined) => possuiPermissao(usuario, requisito), [usuario]);

  const { mutateAsync: executarEntrar } = mutacaoEntrar;
  const { mutateAsync: executarSair } = mutacaoSair;
  const { refetch } = consulta;

  const valor = useMemo<ValorSessao>(
    () => ({
      sessao,
      usuario,
      carregando: consulta.isPending,
      erro: consulta.error,
      temPermissao,
      entrar: (entrada) => executarEntrar(entrada),
      entrando: mutacaoEntrar.isPending,
      erroEntrar: mutacaoEntrar.error,
      sair: async () => {
        await executarSair();
        definirTokenCsrf(null);
      },
      saindo: mutacaoSair.isPending,
      tentarNovamente: () => void refetch(),
    }),
    [
      sessao,
      usuario,
      consulta.isPending,
      consulta.error,
      temPermissao,
      executarEntrar,
      mutacaoEntrar.isPending,
      mutacaoEntrar.error,
      executarSair,
      mutacaoSair.isPending,
      refetch,
    ],
  );

  return <ContextoSessao value={valor}>{children}</ContextoSessao>;
}

export function useSessao(): ValorSessao {
  const valor = use(ContextoSessao);
  if (!valor) throw new Error('useSessao precisa estar dentro de ProvedorSessao.');
  return valor;
}
