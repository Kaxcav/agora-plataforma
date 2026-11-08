import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { Alerta } from '../../componentes/Estados';

/** Erro devolvido pela API ao salvar um formulário: mensagem, detalhes por campo e código para o suporte. */
export function ErroFormulario({ erro, titulo = 'Não foi possível salvar' }: { erro: unknown; titulo?: string }) {
  if (!erro) return null;
  const idRequisicao = erro instanceof ErroApi ? erro.idRequisicao : null;
  return (
    <Alerta tipo="erro" anunciar titulo={titulo}>
      <p>{mensagemDeErro(erro)}</p>
      {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
        <ul>
          {erro.detalhes.map((d, i) => (
            <li key={i}>{d.campo ? `${d.campo}: ${d.mensagem}` : d.mensagem}</li>
          ))}
        </ul>
      ) : null}
      {idRequisicao ? (
        <p className="texto-pequeno">
          Código para o suporte: <code className="selecionavel">{idRequisicao}</code>
        </p>
      ) : null}
    </Alerta>
  );
}

/** Aviso exibido a quem só pode consultar a tela. */
export function AvisoSomenteLeitura({ texto }: { texto?: string }) {
  return (
    <Alerta tipo="info" compacto titulo="Consulta somente leitura">
      <p>{texto ?? 'Somente administradores da Ágora podem alterar estes ajustes. Você pode consultar as informações abaixo.'}</p>
    </Alerta>
  );
}

/** Rótulo do resumo de erros de validação, anunciado ao enviar. */
export function ResumoErros({ quantidade }: { quantidade: number }) {
  if (quantidade === 0) return null;
  return (
    <Alerta tipo="erro" anunciar compacto>
      <p>
        {quantidade === 1 ? 'Há 1 campo a corrigir' : `Há ${quantidade} campos a corrigir`}. Revise os campos destacados antes de salvar.
      </p>
    </Alerta>
  );
}

/** Move o foco para o primeiro campo inválido do formulário. */
export function focarPrimeiroInvalido(formulario: HTMLFormElement | null): void {
  window.requestAnimationFrame(() => {
    formulario?.querySelector<HTMLElement>('[aria-invalid="true"], .campo--erro input, .campo--erro select, .campo--erro textarea')?.focus();
  });
}
