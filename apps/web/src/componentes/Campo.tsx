import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CircleAlert, Search, X } from 'lucide-react';
import { paraCentavos, type Centavos } from '@agora/dominio';

export interface AtributosCampo {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

export interface PropsCampoBase {
  rotulo: ReactNode;
  ajuda?: ReactNode;
  erro?: string | null;
  obrigatorio?: boolean;
  className?: string;
}

/**
 * Estrutura comum: rótulo sempre visível, ajuda e erro ligados por `aria-describedby`,
 * obrigatoriedade indicada sempre da mesma forma ("obrigatório" no rótulo + `required`).
 */
export function Campo({
  id,
  rotulo,
  ajuda,
  erro,
  obrigatorio,
  className,
  children,
}: PropsCampoBase & { id: string; children: (atributos: AtributosCampo) => ReactNode }) {
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;
  const descritores = [idErro, idAjuda].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['campo', erro ? 'campo--erro' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label className="campo__rotulo" htmlFor={id}>
        {rotulo}
        {obrigatorio ? <span className="campo__obrigatorio"> (obrigatório)</span> : null}
      </label>
      {children({ id, 'aria-describedby': descritores, 'aria-invalid': erro ? true : undefined, required: obrigatorio })}
      {ajuda ? (
        <p id={idAjuda} className="campo__ajuda">
          {ajuda}
        </p>
      ) : null}
      {erro ? (
        <p id={idErro} className="campo__erro">
          <CircleAlert size={14} aria-hidden="true" />
          <span>{erro}</span>
        </p>
      ) : null}
    </div>
  );
}

type PropsInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'required'> & PropsCampoBase & { id?: string; ref?: Ref<HTMLInputElement> };

export function CampoTexto({ rotulo, ajuda, erro, obrigatorio, className, id, ref, ...resto }: PropsInput) {
  const automatico = useId();
  return (
    <Campo id={id ?? automatico} rotulo={rotulo} ajuda={ajuda} erro={erro} obrigatorio={obrigatorio} className={className}>
      {(atributos) => <input ref={ref} className="campo__controle" type="text" {...atributos} {...resto} />}
    </Campo>
  );
}

type PropsArea = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'> &
  PropsCampoBase & { id?: string; ref?: Ref<HTMLTextAreaElement>; contador?: boolean };

export function AreaTexto({ rotulo, ajuda, erro, obrigatorio, className, id, ref, contador, maxLength, value, ...resto }: PropsArea) {
  const automatico = useId();
  const tamanho = typeof value === 'string' ? value.length : 0;
  const ajudaComContador =
    contador && maxLength ? (
      <>
        {ajuda ? <>{ajuda} </> : null}
        <span className="numero">
          {tamanho}/{maxLength} caracteres
        </span>
      </>
    ) : (
      ajuda
    );
  return (
    <Campo id={id ?? automatico} rotulo={rotulo} ajuda={ajudaComContador} erro={erro} obrigatorio={obrigatorio} className={className}>
      {(atributos) => (
        <textarea ref={ref} className="campo__controle campo__controle--area" maxLength={maxLength} value={value} {...atributos} {...resto} />
      )}
    </Campo>
  );
}

export interface OpcaoSelecao {
  valor: string;
  rotulo: string;
  desabilitada?: boolean;
}

type PropsSelecao = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'required'> &
  PropsCampoBase & {
    id?: string;
    opcoes: readonly OpcaoSelecao[];
    /** Rótulo da opção vazia ("Todas", "Selecione…"); omita para não haver opção vazia. */
    opcaoVazia?: string;
  };

/** `<select>` nativo (melhor suporte a teclado, leitor de tela e toque). */
export function Selecao({ rotulo, ajuda, erro, obrigatorio, className, id, opcoes, opcaoVazia, ...resto }: PropsSelecao) {
  const automatico = useId();
  return (
    <Campo id={id ?? automatico} rotulo={rotulo} ajuda={ajuda} erro={erro} obrigatorio={obrigatorio} className={className}>
      {(atributos) => (
        <select className="campo__controle campo__controle--selecao" {...atributos} {...resto}>
          {opcaoVazia !== undefined ? <option value="">{opcaoVazia}</option> : null}
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor} disabled={o.desabilitada}>
              {o.rotulo}
            </option>
          ))}
        </select>
      )}
    </Campo>
  );
}

type PropsCaixa = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  id?: string;
  rotulo: ReactNode;
  ajuda?: ReactNode;
};

export function CaixaSelecao({ id, rotulo, ajuda, className, ...resto }: PropsCaixa) {
  const automatico = useId();
  const idFinal = id ?? automatico;
  const idAjuda = ajuda ? `${idFinal}-ajuda` : undefined;
  return (
    <div className={['caixa-selecao', className ?? ''].filter(Boolean).join(' ')}>
      <input id={idFinal} type="checkbox" className="caixa-selecao__controle" aria-describedby={idAjuda} {...resto} />
      <label htmlFor={idFinal} className="caixa-selecao__rotulo">
        {rotulo}
        {ajuda ? (
          <span id={idAjuda} className="caixa-selecao__ajuda">
            {ajuda}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export interface PropsGrupoOpcoes<T extends string> {
  legenda: ReactNode;
  nome: string;
  opcoes: readonly { valor: T; rotulo: ReactNode; ajuda?: ReactNode }[];
  valor: T | null;
  aoMudar: (valor: T) => void;
  erro?: string | null;
  obrigatorio?: boolean;
  horizontal?: boolean;
}

/** Botões de opção agrupados em `fieldset`/`legend`. */
export function GrupoOpcoes<T extends string>({ legenda, nome, opcoes, valor, aoMudar, erro, obrigatorio, horizontal }: PropsGrupoOpcoes<T>) {
  const base = useId();
  const idErro = erro ? `${base}-erro` : undefined;
  return (
    <fieldset className={['grupo-opcoes', horizontal ? 'grupo-opcoes--horizontal' : '', erro ? 'campo--erro' : ''].filter(Boolean).join(' ')} aria-describedby={idErro}>
      <legend className="campo__rotulo">
        {legenda}
        {obrigatorio ? <span className="campo__obrigatorio"> (obrigatório)</span> : null}
      </legend>
      <div className="grupo-opcoes__lista">
        {opcoes.map((o) => {
          const idOpcao = `${base}-${o.valor}`;
          return (
            <div key={o.valor} className="caixa-selecao">
              <input
                id={idOpcao}
                type="radio"
                name={nome}
                value={o.valor}
                checked={valor === o.valor}
                onChange={() => aoMudar(o.valor)}
                className="caixa-selecao__controle caixa-selecao__controle--radio"
                required={obrigatorio}
              />
              <label htmlFor={idOpcao} className="caixa-selecao__rotulo">
                {o.rotulo}
                {o.ajuda ? <span className="caixa-selecao__ajuda">{o.ajuda}</span> : null}
              </label>
            </div>
          );
        })}
      </div>
      {erro ? (
        <p id={idErro} className="campo__erro">
          <CircleAlert size={14} aria-hidden="true" />
          <span>{erro}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

const formatoDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function textoDeCentavos(valor: Centavos | null): string {
  return valor === null ? '' : formatoDecimal.format(valor / 100);
}

export interface PropsCampoMoeda extends PropsCampoBase {
  id?: string;
  valor: Centavos | null;
  aoMudar: (valor: Centavos | null) => void;
  desabilitado?: boolean;
  nome?: string;
}

/** Valor monetário em reais; internamente em centavos inteiros (`paraCentavos` do domínio). */
export function CampoMoeda({ id, rotulo, ajuda, erro, obrigatorio, className, valor, aoMudar, desabilitado, nome }: PropsCampoMoeda) {
  const automatico = useId();
  const [texto, definirTexto] = useState(() => textoDeCentavos(valor));
  const [erroLocal, definirErroLocal] = useState<string | null>(null);
  const ultimoValor = useRef(valor);

  useEffect(() => {
    if (valor !== ultimoValor.current) {
      ultimoValor.current = valor;
      definirTexto(textoDeCentavos(valor));
    }
  }, [valor]);

  const confirmar = () => {
    const limpo = texto.trim();
    if (limpo === '') {
      definirErroLocal(null);
      ultimoValor.current = null;
      aoMudar(null);
      return;
    }
    try {
      const centavos = paraCentavos(limpo);
      definirErroLocal(null);
      ultimoValor.current = centavos;
      definirTexto(textoDeCentavos(centavos));
      aoMudar(centavos);
    } catch {
      definirErroLocal('Informe um valor em reais, por exemplo 1.234,56.');
    }
  };

  return (
    <Campo
      id={id ?? automatico}
      rotulo={rotulo}
      ajuda={ajuda}
      erro={erroLocal ?? erro}
      obrigatorio={obrigatorio}
      className={className}
    >
      {(atributos) => (
        <div className="campo__grupo">
          <span className="campo__prefixo" aria-hidden="true">
            R$
          </span>
          <input
            {...atributos}
            name={nome}
            className="campo__controle campo__controle--moeda numero"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={texto}
            disabled={desabilitado}
            onChange={(e) => definirTexto(e.target.value)}
            onBlur={confirmar}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmar();
            }}
          />
        </div>
      )}
    </Campo>
  );
}

export interface PropsCampoBusca {
  rotulo?: string;
  valor: string;
  aoMudar: (valor: string) => void;
  placeholder?: string;
  /** Atraso antes de aplicar (ms) para não disparar consulta a cada tecla. */
  atraso?: number;
  className?: string;
}

/** Busca com aplicação adiada; o texto da URL é a fonte da verdade. */
export function CampoBusca({ rotulo = 'Buscar', valor, aoMudar, placeholder, atraso = 350, className }: PropsCampoBusca) {
  const id = useId();
  const [texto, definirTexto] = useState(valor);
  const aplicado = useRef(valor);

  useEffect(() => {
    if (valor !== aplicado.current) {
      aplicado.current = valor;
      definirTexto(valor);
    }
  }, [valor]);

  useEffect(() => {
    if (texto === aplicado.current) return;
    const temporizador = window.setTimeout(() => {
      aplicado.current = texto;
      aoMudar(texto);
    }, atraso);
    return () => window.clearTimeout(temporizador);
  }, [texto, atraso, aoMudar]);

  return (
    <div className={['campo', 'campo--busca', className ?? ''].filter(Boolean).join(' ')}>
      <label className="campo__rotulo" htmlFor={id}>
        {rotulo}
      </label>
      <div className="campo__grupo">
        <Search className="campo__icone" size={16} aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="campo__controle campo__controle--busca"
          value={texto}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => definirTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              aplicado.current = texto;
              aoMudar(texto);
            }
          }}
        />
        {texto ? (
          <button
            type="button"
            className="campo__limpar"
            aria-label="Limpar busca"
            title="Limpar busca"
            onClick={() => {
              definirTexto('');
              aplicado.current = '';
              aoMudar('');
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
