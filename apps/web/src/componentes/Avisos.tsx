import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, Undo2, X, type LucideIcon } from 'lucide-react';
import { mensagemDeErro } from '../api/cliente';

export type TipoAviso = 'sucesso' | 'info' | 'aviso' | 'erro';

export interface AcaoAviso {
  rotulo: string;
  executar: () => void | Promise<void>;
}

export interface NovoAviso {
  tipo?: TipoAviso;
  titulo?: string;
  mensagem: string;
  /** Ação opcional, tipicamente "Desfazer". */
  acao?: AcaoAviso;
  /** Duração em ms; com ação o padrão é maior para dar tempo de desfazer. */
  duracao?: number;
}

interface Aviso extends NovoAviso {
  id: number;
  tipo: TipoAviso;
}

interface ValorAvisos {
  avisar: (aviso: NovoAviso) => void;
}

const ContextoAvisos = createContext<ValorAvisos | null>(null);

const ICONES: Record<TipoAviso, LucideIcon> = {
  sucesso: CircleCheck,
  info: Info,
  aviso: TriangleAlert,
  erro: CircleX,
};

function ItemAviso({ aviso, aoRemover, aoFalhar }: { aviso: Aviso; aoRemover: (id: number) => void; aoFalhar: (erro: unknown) => void }) {
  const [executando, definirExecutando] = useState(false);
  const [pausado, definirPausado] = useState(false);
  const restante = useRef(aviso.duracao ?? (aviso.acao ? 10000 : 6000));
  const inicio = useRef(Date.now());

  useEffect(() => {
    if (pausado || executando) return;
    inicio.current = Date.now();
    const temporizador = window.setTimeout(() => aoRemover(aviso.id), restante.current);
    return () => {
      window.clearTimeout(temporizador);
      restante.current = Math.max(1500, restante.current - (Date.now() - inicio.current));
    };
  }, [pausado, executando, aoRemover, aviso.id]);

  const Icone = ICONES[aviso.tipo];
  return (
    <li
      className={`aviso aviso--${aviso.tipo}`}
      onMouseEnter={() => definirPausado(true)}
      onMouseLeave={() => definirPausado(false)}
      onFocus={() => definirPausado(true)}
      onBlur={() => definirPausado(false)}
    >
      <Icone className="aviso__icone" size={20} aria-hidden="true" />
      <div className="aviso__corpo">
        {aviso.titulo ? <p className="aviso__titulo">{aviso.titulo}</p> : null}
        <p className="aviso__mensagem">{aviso.mensagem}</p>
      </div>
      {aviso.acao ? (
        <button
          type="button"
          className="aviso__acao"
          disabled={executando}
          onClick={async () => {
            if (!aviso.acao) return;
            definirExecutando(true);
            try {
              await aviso.acao.executar();
            } catch (erro) {
              aoFalhar(erro);
            } finally {
              aoRemover(aviso.id);
            }
          }}
        >
          <Undo2 size={16} aria-hidden="true" />
          {aviso.acao.rotulo}
        </button>
      ) : null}
      <button type="button" className="aviso__fechar" aria-label="Fechar aviso" title="Fechar aviso" onClick={() => aoRemover(aviso.id)}>
        <X size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Avisos (toasts) em região `aria-live`. Pausam com mouse/foco; ação "Desfazer" opcional.
 * A região existe desde o carregamento para que leitores de tela anunciem as inserções.
 */
export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, definirAvisos] = useState<Aviso[]>([]);
  const sequencia = useRef(0);

  const remover = useCallback((id: number) => definirAvisos((atuais) => atuais.filter((a) => a.id !== id)), []);

  const avisar = useCallback((novo: NovoAviso) => {
    sequencia.current += 1;
    const aviso: Aviso = { ...novo, tipo: novo.tipo ?? 'sucesso', id: sequencia.current };
    definirAvisos((atuais) => [...atuais.slice(-3), aviso]);
  }, []);

  const falhar = useCallback(
    (erro: unknown) => avisar({ tipo: 'erro', titulo: 'Não foi possível desfazer', mensagem: mensagemDeErro(erro) }),
    [avisar],
  );

  const valor = useMemo(() => ({ avisar }), [avisar]);

  return (
    <ContextoAvisos value={valor}>
      {children}
      <div className="avisos" aria-live="polite" aria-relevant="additions">
        <ul className="avisos__lista">
          {avisos.map((a) => (
            <ItemAviso key={a.id} aviso={a} aoRemover={remover} aoFalhar={falhar} />
          ))}
        </ul>
      </div>
    </ContextoAvisos>
  );
}

export function useAvisos(): ValorAvisos {
  const valor = use(ContextoAvisos);
  if (!valor) throw new Error('useAvisos precisa estar dentro de ProvedorAvisos.');
  return valor;
}
