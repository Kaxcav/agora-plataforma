import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CircleCheck, CircleX, Info, Lock, RefreshCw, SearchX, ServerCrash, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '../api/cliente';
import { Botao, LinkBotao } from './Botao';
import { Carregando } from './Esqueleto';

export type TipoAlerta = 'info' | 'sucesso' | 'aviso' | 'erro';

const ICONES_ALERTA: Record<TipoAlerta, LucideIcon> = {
  info: Info,
  sucesso: CircleCheck,
  aviso: TriangleAlert,
  erro: CircleX,
};

const NOMES_ALERTA: Record<TipoAlerta, string> = {
  info: 'Informação',
  sucesso: 'Sucesso',
  aviso: 'Atenção',
  erro: 'Erro',
};

export interface PropsAlerta {
  tipo?: TipoAlerta;
  titulo?: ReactNode;
  children?: ReactNode;
  /** Anuncia imediatamente (para mensagens que surgem após uma ação). */
  anunciar?: boolean;
  acoes?: ReactNode;
  compacto?: boolean;
}

/** Mensagem contextual (info/sucesso/aviso/erro), sempre com ícone + texto. */
export function Alerta({ tipo = 'info', titulo, children, anunciar, acoes, compacto }: PropsAlerta) {
  const Icone = ICONES_ALERTA[tipo];
  const papel = anunciar ? (tipo === 'erro' ? 'alert' : 'status') : undefined;
  return (
    <div className={['alerta', `alerta--${tipo}`, compacto ? 'alerta--compacto' : ''].filter(Boolean).join(' ')} role={papel}>
      <Icone className="alerta__icone" size={20} aria-hidden="true" />
      <div className="alerta__corpo">
        <span className="sr-only">{NOMES_ALERTA[tipo]}: </span>
        {titulo ? <p className="alerta__titulo">{titulo}</p> : null}
        {children ? <div className="alerta__texto">{children}</div> : null}
        {acoes ? <div className="alerta__acoes">{acoes}</div> : null}
      </div>
    </div>
  );
}

export interface PropsEstadoVazio {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
  icone?: LucideIcon;
}

/** Nada a exibir: diz o porquê e oferece um caminho ("Limpar filtros"). */
export function EstadoVazio({ titulo, descricao, acao, icone: Icone = SearchX }: PropsEstadoVazio) {
  return (
    <div className="estado estado--vazio">
      <Icone className="estado__icone" size={32} aria-hidden="true" />
      <p className="estado__titulo">{titulo}</p>
      {descricao ? <div className="estado__descricao">{descricao}</div> : null}
      {acao ? <div className="estado__acao">{acao}</div> : null}
    </div>
  );
}

export interface PropsEstadoErro {
  erro: unknown;
  titulo?: string;
  aoTentarNovamente?: () => void;
  tentando?: boolean;
}

/** Falha de carregamento: o que falhou, "Tentar novamente" e o identificador da requisição para o suporte. */
export function EstadoErro({ erro, titulo = 'Não foi possível carregar os dados', aoTentarNovamente, tentando }: PropsEstadoErro) {
  const idRequisicao = erro instanceof ErroApi ? erro.idRequisicao : null;
  return (
    <div className="estado estado--erro" role="alert">
      <ServerCrash className="estado__icone" size={32} aria-hidden="true" />
      <p className="estado__titulo">{titulo}</p>
      <div className="estado__descricao">
        <p>{mensagemDeErro(erro)}</p>
        {idRequisicao ? (
          <p className="texto-pequeno texto-secundario">
            Código para o suporte: <code className="selecionavel">{idRequisicao}</code>
          </p>
        ) : null}
      </div>
      {aoTentarNovamente ? (
        <div className="estado__acao">
          <Botao variante="primario" icone={RefreshCw} onClick={aoTentarNovamente} carregando={tentando}>
            Tentar novamente
          </Botao>
        </div>
      ) : null}
    </div>
  );
}

export interface PropsSemPermissao {
  descricao?: ReactNode;
}

/** 403: explica e oferece caminho de volta. */
export function SemPermissao({ descricao }: PropsSemPermissao) {
  return (
    <div className="estado estado--permissao">
      <Lock className="estado__icone" size={32} aria-hidden="true" />
      <p className="estado__titulo">Você não tem permissão para acessar este conteúdo</p>
      <div className="estado__descricao">
        {descricao ?? (
          <p>
            Seu perfil não inclui acesso a esta área ou o registro está fora das UASGs do seu escopo. Se precisar do acesso, solicite ao
            administrador da Ágora no seu órgão.
          </p>
        )}
      </div>
      <div className="estado__acao">
        <LinkBotao to="/" variante="primario">
          Voltar ao início
        </LinkBotao>
      </div>
    </div>
  );
}

/**
 * Falha de uma consulta de lista (sem dados anteriores): 403 vira "sem permissão"; o resto, erro com nova tentativa.
 * Uso: `if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />`.
 */
export function FalhaConsulta({ consulta, titulo }: { consulta: UseQueryResult<unknown>; titulo?: string }) {
  const erro = consulta.error;
  if (erro instanceof ErroApi && erro.status === 403) return <SemPermissao />;
  return <EstadoErro erro={erro} titulo={titulo} aoTentarNovamente={() => void consulta.refetch()} tentando={consulta.isFetching} />;
}

export interface PropsConteudoConsulta<T> {
  consulta: UseQueryResult<T>;
  /** Esqueleto com a forma do conteúdo. */
  carregando?: ReactNode;
  rotuloCarregando?: string;
  tituloErro?: string;
  /** Mensagem para 404 (registro inexistente ou fora do escopo). */
  naoEncontrado?: { titulo: string; descricao?: ReactNode; acao?: ReactNode };
  children: (dados: T) => ReactNode;
}

/**
 * Estados obrigatórios de toda tela de dados: carregando (esqueleto), erro com nova tentativa e
 * `idRequisicao`, 403 (sem permissão) e 404. Dados anteriores permanecem visíveis durante a atualização.
 */
export function ConteudoConsulta<T>({ consulta, carregando, rotuloCarregando, tituloErro, naoEncontrado, children }: PropsConteudoConsulta<T>) {
  if (consulta.data !== undefined) return <>{children(consulta.data)}</>;
  if (consulta.isError) {
    const erro = consulta.error;
    if (erro instanceof ErroApi && erro.status === 403) return <SemPermissao />;
    if (erro instanceof ErroApi && erro.status === 404 && naoEncontrado) {
      return <EstadoVazio titulo={naoEncontrado.titulo} descricao={naoEncontrado.descricao} acao={naoEncontrado.acao} />;
    }
    return <EstadoErro erro={erro} titulo={tituloErro} aoTentarNovamente={() => void consulta.refetch()} tentando={consulta.isFetching} />;
  }
  return <Carregando rotulo={rotuloCarregando}>{carregando}</Carregando>;
}
