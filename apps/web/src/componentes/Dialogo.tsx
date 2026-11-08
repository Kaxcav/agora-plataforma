import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { mensagemDeErro, ErroApi } from '../api/cliente';
import { Botao, type VarianteBotao } from './Botao';
import { Alerta } from './Estados';

const SELETOR_FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Títulos das seções que contêm o elemento (do mais próximo ao mais distante): destino do foco ao fechar o
 * diálogo quando quem o abriu deixou de existir (ex.: o botão "Assinar" some depois da assinatura).
 */
function titulosAncestrais(origem: HTMLElement): HTMLElement[] {
  const titulos: HTMLElement[] = [];
  for (let el = origem.parentElement; el; el = el.parentElement) {
    const rotulo = el.getAttribute('aria-labelledby');
    if (!rotulo || !el.matches('section, form, [role="region"]')) continue;
    const titulo = document.getElementById(rotulo.split(' ')[0] ?? '');
    if (titulo) titulos.push(titulo);
  }
  return titulos;
}

function focarRefugio(refugios: readonly HTMLElement[]): void {
  const destino = refugios.find((t) => t.isConnected) ?? document.getElementById('conteudo');
  if (!destino) return;
  if (!destino.hasAttribute('tabindex')) destino.setAttribute('tabindex', '-1');
  destino.focus();
}

/** Por quanto tempo, após fechar, o foco é vigiado: a atualização dos dados pode remover a origem logo depois. */
const VIGIA_FOCO_MS = 1000;

function devolverFoco(origem: HTMLElement | null, refugios: readonly HTMLElement[]): void {
  if (origem && origem.isConnected && !origem.matches(':disabled')) origem.focus();
  else focarRefugio(refugios);
  // Se a origem sumir com a atualização dos dados (ex.: o botão "Assinar" depois da assinatura), o foco iria
  // para o <body>: nesse caso ele passa ao título da seção. Não interfere se o usuário já moveu o foco.
  const limite = performance.now() + VIGIA_FOCO_MS;
  const vigiar = () => {
    const perdido = document.activeElement === null || document.activeElement === document.body;
    if (perdido && (origem === null || !origem.isConnected)) {
      focarRefugio(refugios);
      return;
    }
    if (performance.now() < limite) window.requestAnimationFrame(vigiar);
  };
  window.requestAnimationFrame(vigiar);
}

export interface PropsDialogo {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: ReactNode;
  children?: ReactNode;
  rodape?: ReactNode;
  largura?: 'estreita' | 'media' | 'ampla';
}

/**
 * Diálogo modal com `<dialog>` nativo: foco inicial no primeiro campo (ou `[data-foco-inicial]`),
 * ESC fecha, foco volta para quem abriu. O restante da página fica inerte enquanto aberto.
 */
export function Dialogo({ aberto, aoFechar, titulo, descricao, children, rodape, largura = 'media' }: PropsDialogo) {
  const referencia = useRef<HTMLDialogElement>(null);
  const origemFoco = useRef<HTMLElement | null>(null);
  const refugiosFoco = useRef<HTMLElement[]>([]);
  const idTitulo = useId();
  const idDescricao = useId();

  useEffect(() => {
    const dialogo = referencia.current;
    if (!dialogo) return;
    if (aberto && !dialogo.open) {
      origemFoco.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      refugiosFoco.current = origemFoco.current ? titulosAncestrais(origemFoco.current) : [];
      dialogo.showModal();
      const preferido = dialogo.querySelector<HTMLElement>('[data-foco-inicial]');
      const corpo = dialogo.querySelector<HTMLElement>('.dialogo__corpo');
      const primeiro = preferido ?? corpo?.querySelector<HTMLElement>(SELETOR_FOCAVEIS) ?? dialogo.querySelector<HTMLElement>(SELETOR_FOCAVEIS);
      primeiro?.focus();
    } else if (!aberto && dialogo.open) {
      dialogo.close();
    }
  }, [aberto]);

  useEffect(() => {
    if (aberto || (origemFoco.current === null && refugiosFoco.current.length === 0)) return;
    devolverFoco(origemFoco.current, refugiosFoco.current);
    origemFoco.current = null;
    refugiosFoco.current = [];
  }, [aberto]);

  return (
    <dialog
      ref={referencia}
      className={`dialogo dialogo--${largura}`}
      aria-labelledby={idTitulo}
      aria-describedby={descricao ? idDescricao : undefined}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
    >
      {aberto ? (
        <div className="dialogo__conteudo">
          <div className="dialogo__cabecalho">
            <h2 id={idTitulo} className="dialogo__titulo">
              {titulo}
            </h2>
            <Botao variante="terciario" somenteIcone icone={X} aria-label="Fechar" onClick={aoFechar} />
          </div>
          {descricao ? (
            <div id={idDescricao} className="dialogo__descricao">
              {descricao}
            </div>
          ) : null}
          {children ? <div className="dialogo__corpo">{children}</div> : null}
          {rodape ? <div className="dialogo__rodape">{rodape}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface PropsConfirmarAcao {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao: ReactNode;
  rotuloConfirmar: string;
  variante?: Extract<VarianteBotao, 'primario' | 'perigo' | 'avanco'>;
  aoConfirmar: () => void;
  processando?: boolean;
  erro?: unknown;
  /** Campos adicionais (ex.: observação obrigatória). */
  children?: ReactNode;
  confirmarDesabilitado?: boolean;
  largura?: PropsDialogo['largura'];
}

/**
 * Confirmação explícita antes de qualquer escrita. Enter confirma; Cancelar/ESC desiste.
 * Mostra o erro da API (com código para suporte) sem fechar, para o usuário corrigir.
 */
export function ConfirmarAcao({
  aberto,
  aoFechar,
  titulo,
  descricao,
  rotuloConfirmar,
  variante = 'primario',
  aoConfirmar,
  processando,
  erro,
  children,
  confirmarDesabilitado,
  largura = 'estreita',
}: PropsConfirmarAcao) {
  const idFormulario = useId();
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!processando && !confirmarDesabilitado) aoConfirmar();
  };
  const idRequisicao = erro instanceof ErroApi ? erro.idRequisicao : null;
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={processando ? () => undefined : aoFechar}
      titulo={titulo}
      descricao={descricao}
      largura={largura}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={processando}>
            Cancelar
          </Botao>
          <Botao variante={variante} type="submit" form={idFormulario} carregando={processando} disabled={confirmarDesabilitado}>
            {rotuloConfirmar}
          </Botao>
        </>
      }
    >
      <form id={idFormulario} onSubmit={enviar} className="pilha" noValidate>
        {children}
        {erro ? (
          <Alerta tipo="erro" anunciar titulo="A operação não foi concluída">
            <p>{mensagemDeErro(erro)}</p>
            {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
              <ul>
                {erro.detalhes.map((d, i) => (
                  <li key={i}>{d.mensagem}</li>
                ))}
              </ul>
            ) : null}
            {idRequisicao ? (
              <p className="texto-pequeno">
                Código para o suporte: <code>{idRequisicao}</code>
              </p>
            ) : null}
          </Alerta>
        ) : null}
      </form>
    </Dialogo>
  );
}
