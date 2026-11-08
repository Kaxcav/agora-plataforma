import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { consumirFocoTitulo, definirTituloDocumento } from '../layout/foco';
import { useModoEspecificacao } from '../layout/ModoEspecificacao';
import { EsqueletoTexto } from './Esqueleto';
import { Breadcrumb, type ItemTrilha } from './Navegacao';

/** O catálogo de regras só é baixado quando o Modo especificação é ligado. */
const PainelRegras = lazy(() => import('./PainelRegras').then((m) => ({ default: m.PainelRegras })));

export interface PropsPagina {
  /** Texto do `<h1>` (único na página). */
  titulo: ReactNode;
  /** Título da aba do navegador quando `titulo` não é texto simples. */
  tituloDocumento?: string;
  subtitulo?: ReactNode;
  /** Trilha antes da página atual (a página atual é acrescentada automaticamente). */
  trilha?: readonly ItemTrilha[];
  /** Ações da página (escrita destacada e confirmada), separadas da navegação. */
  acoes?: ReactNode;
  /** Id da tela no catálogo de regras (Modo especificação). */
  tela?: string;
  /** Conteúdo exibido ao lado do título (etiquetas de situação). */
  marcadores?: ReactNode;
  children: ReactNode;
  estreita?: boolean;
}

/** Moldura de página: breadcrumb, `<h1>`, ações, painel de regras e foco/título na troca de rota. */
export function Pagina({ titulo, tituloDocumento, subtitulo, trilha, acoes, tela, marcadores, children, estreita }: PropsPagina) {
  const { ativo: modoEspecificacao } = useModoEspecificacao();
  const { pathname } = useLocation();
  const referenciaTitulo = useRef<HTMLHeadingElement>(null);
  const textoTitulo = tituloDocumento ?? (typeof titulo === 'string' ? titulo : '');

  useEffect(() => {
    definirTituloDocumento(textoTitulo);
  }, [textoTitulo]);

  useEffect(() => {
    if (consumirFocoTitulo()) referenciaTitulo.current?.focus();
  }, [pathname]);

  const itensTrilha: ItemTrilha[] = trilha ? [...trilha, { rotulo: textoTitulo || 'Página atual' }] : [];

  return (
    <div className={['pagina', estreita ? 'pagina--estreita' : ''].filter(Boolean).join(' ')}>
      {itensTrilha.length > 0 ? <Breadcrumb itens={itensTrilha} /> : null}
      <header className="pagina__cabecalho">
        <div className="pagina__titulos">
          <div className="pagina__linha-titulo">
            <h1 ref={referenciaTitulo} tabIndex={-1} className="pagina__titulo">
              {titulo}
            </h1>
            {marcadores ? <div className="pagina__marcadores">{marcadores}</div> : null}
          </div>
          {subtitulo ? <div className="pagina__subtitulo">{subtitulo}</div> : null}
        </div>
        {acoes ? (
          <div className="pagina__acoes" role="group" aria-label="Ações da página">
            {acoes}
          </div>
        ) : null}
      </header>
      {modoEspecificacao && tela ? (
        <Suspense
          fallback={
            <div className="painel-regras" aria-busy="true">
              <EsqueletoTexto linhas={4} />
            </div>
          }
        >
          <PainelRegras tela={tela} />
        </Suspense>
      ) : null}
      <div className="pagina__corpo">{children}</div>
    </div>
  );
}

export interface PropsSecao {
  titulo: ReactNode;
  id?: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  /** Sem moldura de cartão. */
  simples?: boolean;
  nivel?: 2 | 3;
}

/** Seção com título (h2/h3) e ações próprias; cartão por padrão. */
export function Secao({ titulo, id, descricao, acoes, children, simples, nivel = 2 }: PropsSecao) {
  const Titulo = nivel === 2 ? 'h2' : 'h3';
  const idTitulo = id ? `${id}-titulo` : undefined;
  return (
    <section className={simples ? 'secao' : 'secao cartao'} id={id} aria-labelledby={idTitulo}>
      <div className="secao__cabecalho">
        <div>
          <Titulo id={idTitulo} className="secao__titulo">
            {titulo}
          </Titulo>
          {descricao ? <div className="secao__descricao">{descricao}</div> : null}
        </div>
        {acoes ? <div className="secao__acoes">{acoes}</div> : null}
      </div>
      {children}
    </section>
  );
}

export interface ItemDefinicao {
  termo: string;
  valor: ReactNode;
  largo?: boolean;
}

/** Lista de definições (dados do registro) em grade responsiva. */
export function ListaDefinicoes({ itens, colunas = 3 }: { itens: readonly ItemDefinicao[]; colunas?: 2 | 3 | 4 }) {
  return (
    <dl className={`lista-definicoes lista-definicoes--${colunas}`}>
      {itens.map((item) => (
        <div key={item.termo} className={['lista-definicoes__item', item.largo ? 'lista-definicoes__item--largo' : ''].filter(Boolean).join(' ')}>
          <dt>{item.termo}</dt>
          <dd>{item.valor}</dd>
        </div>
      ))}
    </dl>
  );
}
