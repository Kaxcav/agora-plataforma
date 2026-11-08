import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { ExternalLink, LoaderCircle, type LucideIcon } from 'lucide-react';

export type VarianteBotao = 'primario' | 'secundario' | 'terciario' | 'perigo';
export type TamanhoBotao = 'padrao' | 'compacto';

function classesBotao(variante: VarianteBotao, tamanho: TamanhoBotao, somenteIcone: boolean, extra?: string): string {
  return ['botao', `botao--${variante}`, tamanho === 'compacto' ? 'botao--compacto' : '', somenteIcone ? 'botao--icone' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export interface PropsBotao extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  icone?: LucideIcon;
  iconeFim?: LucideIcon;
  /** Mostra indicador de progresso e bloqueia novo acionamento. */
  carregando?: boolean;
  /** Botão só com ícone: exige `aria-label`. */
  somenteIcone?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Botão do design system. Indisponível (`disabled` ou `carregando`) vira `aria-disabled` em vez do atributo
 * nativo: o botão continua focável e não "derruba" o foco para o `<body>` quando uma mutação o desabilita
 * (ex.: "Salvar" após salvar). O acionamento é bloqueado aqui, inclusive o envio implícito do formulário.
 */
export function Botao({
  variante = 'secundario',
  tamanho = 'padrao',
  icone: Icone,
  iconeFim: IconeFim,
  carregando = false,
  somenteIcone = false,
  type = 'button',
  className,
  disabled,
  children,
  ref,
  onClick,
  ...resto
}: PropsBotao) {
  const indisponivel = Boolean(disabled) || carregando;
  return (
    <button
      ref={ref}
      type={type}
      className={classesBotao(variante, tamanho, somenteIcone, className)}
      aria-disabled={indisponivel || undefined}
      aria-busy={carregando || undefined}
      title={somenteIcone ? resto['aria-label'] : resto.title}
      onClick={(evento) => {
        if (indisponivel) {
          evento.preventDefault();
          return;
        }
        onClick?.(evento);
      }}
      {...resto}
    >
      {carregando ? (
        <LoaderCircle className="botao__giro" size={16} aria-hidden="true" />
      ) : Icone ? (
        <Icone size={16} aria-hidden="true" />
      ) : null}
      {somenteIcone ? null : <span>{children}</span>}
      {IconeFim && !somenteIcone ? <IconeFim size={16} aria-hidden="true" /> : null}
    </button>
  );
}

export interface PropsLinkBotao extends LinkProps {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  icone?: LucideIcon;
  children: ReactNode;
}

/** Navegação com aparência de botão (continua sendo link: abre em nova aba, é anunciado como link). */
export function LinkBotao({ variante = 'secundario', tamanho = 'padrao', icone: Icone, className, children, ...resto }: PropsLinkBotao) {
  return (
    <Link className={classesBotao(variante, tamanho, false, className)} {...resto}>
      {Icone ? <Icone size={16} aria-hidden="true" /> : null}
      <span>{children}</span>
    </Link>
  );
}

export interface PropsLinkExterno extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: ReactNode;
  comoBotao?: VarianteBotao;
  tamanho?: TamanhoBotao;
}

/** Link para sistema externo (PNCP etc.): nova aba, `rel="noopener noreferrer"`, aviso para leitor de tela. */
export function LinkExterno({ href, children, comoBotao, tamanho = 'padrao', className, ...resto }: PropsLinkExterno) {
  const classe = comoBotao ? classesBotao(comoBotao, tamanho, false, className) : ['link-externo', className ?? ''].join(' ').trim();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={classe} {...resto}>
      <span>{children}</span>
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  );
}
