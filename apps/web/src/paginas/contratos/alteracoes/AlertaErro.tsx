import { ErroApi, mensagemDeErro } from '../../../api/cliente';
import { Alerta } from '../../../componentes';

/** Erro devolvido pela API dentro do formulário, com cada motivo da trava (RN-32, RN-33, RN-09, RF-27). */
export function AlertaErro({ erro, titulo }: { erro: unknown; titulo: string }) {
  if (!erro) return null;
  return (
    <Alerta tipo="erro" anunciar titulo={titulo}>
      <p>{mensagemDeErro(erro)}</p>
      {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
        <ul>
          {erro.detalhes.map((d, i) => (
            <li key={i}>
              {d.campo ? <strong>{d.campo}: </strong> : null}
              {d.mensagem}
            </li>
          ))}
        </ul>
      ) : null}
      {erro instanceof ErroApi && erro.idRequisicao ? (
        <p className="texto-pequeno">
          Código para o suporte: <code>{erro.idRequisicao}</code>
        </p>
      ) : null}
    </Alerta>
  );
}
