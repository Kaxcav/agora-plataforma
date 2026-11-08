import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { formatarPercentual } from '../utilitarios/formatacao';
import { Esqueleto } from './Esqueleto';

export type TomIndicador = 'neutro' | 'info' | 'sucesso' | 'aviso' | 'erro';

export interface PropsIndicador {
  rotulo: string;
  /** Valor já formatado. Enquanto `carregando`, mostra esqueleto — nunca zero provisório. */
  valor: ReactNode;
  icone?: LucideIcon;
  tom?: TomIndicador;
  detalhe?: ReactNode;
  carregando?: boolean;
  /** Torna o cartão um link para a lista correspondente. */
  para?: string;
  /** Valor completo para leitor de tela quando o visível é compacto ("R$ 1,2 mi"). */
  valorAcessivel?: string;
}

/** Cartão de KPI. */
export function Indicador({ rotulo, valor, icone: Icone, tom = 'neutro', detalhe, carregando, para, valorAcessivel }: PropsIndicador) {
  const conteudo = (
    <>
      <div className="indicador__topo">
        <span className="indicador__rotulo">{rotulo}</span>
        {Icone ? (
          <span className={`indicador__icone indicador__icone--${tom}`} aria-hidden="true">
            <Icone size={18} />
          </span>
        ) : null}
      </div>
      {carregando ? (
        <Esqueleto largura="60%" altura="2rem" />
      ) : (
        <p className="indicador__valor numero">
          {valorAcessivel ? (
            <>
              <span aria-hidden="true">{valor}</span>
              <span className="sr-only">{valorAcessivel}</span>
            </>
          ) : (
            valor
          )}
        </p>
      )}
      {detalhe ? <div className="indicador__detalhe">{carregando ? <Esqueleto largura="80%" /> : detalhe}</div> : null}
    </>
  );
  if (para && !carregando) {
    return (
      <Link to={para} className={`indicador indicador--${tom} indicador--link`}>
        {conteudo}
      </Link>
    );
  }
  return (
    <div className={`indicador indicador--${tom}`} aria-busy={carregando || undefined}>
      {conteudo}
    </div>
  );
}

export interface PropsBarraProgresso {
  /** 0–100 (valores acima de 100 são exibidos e a barra fica cheia). */
  valor: number;
  rotulo: string;
  /** Mostrar o percentual ao lado. */
  mostrarValor?: boolean;
  /** Força um tom; padrão: ≥ 100 erro, ≥ 90 aviso forte, ≥ 75 aviso, senão informação. */
  tom?: 'info' | 'sucesso' | 'aviso' | 'erro';
  textoValor?: string;
  compacta?: boolean;
}

export function tomConsumo(valor: number): 'info' | 'aviso' | 'erro' {
  if (valor >= 90) return 'erro';
  if (valor >= 75) return 'aviso';
  return 'info';
}

/** Barra de consumo/execução (`role="progressbar"`). */
export function BarraProgresso({ valor, rotulo, mostrarValor = true, tom, textoValor, compacta }: PropsBarraProgresso) {
  const seguro = Number.isFinite(valor) ? valor : 0;
  const largura = Math.max(0, Math.min(100, seguro));
  const texto = textoValor ?? formatarPercentual(seguro);
  const tomFinal = tom ?? tomConsumo(seguro);
  // Preenchimento a 100% escalado por transform (anima sem recalcular layout).
  const estilo: CSSProperties & Record<'--progresso', number> = { '--progresso': largura / 100 };
  return (
    <div className={['barra-progresso', compacta ? 'barra-progresso--compacta' : ''].filter(Boolean).join(' ')}>
      <div
        className="barra-progresso__trilho"
        role="progressbar"
        aria-label={rotulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(largura)}
        aria-valuetext={texto}
      >
        <div className={`barra-progresso__preenchimento barra-progresso__preenchimento--${tomFinal}`} style={estilo} />
      </div>
      {mostrarValor ? (
        <span className="barra-progresso__valor numero" aria-hidden="true">
          {texto}
        </span>
      ) : null}
    </div>
  );
}
