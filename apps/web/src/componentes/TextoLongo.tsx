import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useAvisos } from './Avisos';

export interface PropsTextoLongo {
  texto: string;
  /** Linhas visíveis quando recolhido. */
  linhas?: number;
  /** Identificador copiável (número do processo, id PNCP…). */
  identificador?: string;
  rotuloIdentificador?: string;
}

/**
 * Truncamento acessível: o texto inteiro está no DOM; "Mostrar mais" expande (`aria-expanded`).
 * Copiar identificador com confirmação anunciada.
 */
export function TextoLongo({ texto, linhas = 2, identificador, rotuloIdentificador = 'identificador' }: PropsTextoLongo) {
  const id = useId();
  const referencia = useRef<HTMLParagraphElement>(null);
  const [expandido, definirExpandido] = useState(false);
  const [transborda, definirTransborda] = useState(false);

  useLayoutEffect(() => {
    const el = referencia.current;
    if (!el) return;
    const medir = () => {
      if (!expandido) definirTransborda(el.scrollHeight > el.clientHeight + 1);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [texto, expandido, linhas]);

  return (
    <div className="texto-longo">
      <p
        id={id}
        ref={referencia}
        className={['texto-longo__texto', expandido ? '' : 'texto-longo__texto--recolhido'].filter(Boolean).join(' ')}
        style={expandido ? undefined : { WebkitLineClamp: linhas }}
      >
        {texto}
      </p>
      {transborda || expandido || identificador ? (
        <div className="texto-longo__acoes">
          {transborda || expandido ? (
            <button type="button" className="texto-longo__alternar" aria-expanded={expandido} aria-controls={id} onClick={() => definirExpandido((v) => !v)}>
              {expandido ? 'Mostrar menos' : 'Mostrar mais'}
            </button>
          ) : null}
          {identificador ? <BotaoCopiar valor={identificador} rotulo={rotuloIdentificador} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Copia um valor para a área de transferência com retorno visual e anunciado. */
export function BotaoCopiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const { avisar } = useAvisos();
  const [copiado, definirCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      definirCopiado(true);
      avisar({ tipo: 'info', mensagem: `${rotulo.charAt(0).toUpperCase()}${rotulo.slice(1)} copiado: ${valor}`, duracao: 3500 });
      window.setTimeout(() => definirCopiado(false), 2000);
    } catch {
      avisar({ tipo: 'erro', mensagem: `Não foi possível copiar. Selecione o texto "${valor}" e copie manualmente.` });
    }
  };
  return (
    <button type="button" className="botao-copiar" onClick={() => void copiar()} aria-label={`Copiar ${rotulo} ${valor}`} title={`Copiar ${rotulo}`}>
      {copiado ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span className="mono">{valor}</span>
    </button>
  );
}
