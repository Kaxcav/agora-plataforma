import type { RespostaErro } from '@agora/contratos';

export type CodigoErro =
  | 'NAO_AUTENTICADO'
  | 'SEM_PERMISSAO'
  | 'TROCA_SENHA_OBRIGATORIA'
  | 'CSRF_INVALIDO'
  | 'NAO_ENCONTRADO'
  | 'VALIDACAO'
  | 'CONFLITO'
  | 'REGRA_NEGOCIO'
  | 'LIMITE_TENTATIVAS'
  | 'LIMITE_REQUISICOES'
  | 'INDISPONIVEL'
  | 'INTERNO';

export type Detalhe = NonNullable<RespostaErro['erro']['detalhes']>[number];

/** Erro de API com status HTTP e código estável; vira `RespostaErro` no tratador central. */
export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: CodigoErro;
  readonly detalhes: Detalhe[] | undefined;

  constructor(status: number, codigo: CodigoErro, mensagem: string, detalhes?: Detalhe[]) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const naoAutenticado = (mensagem = 'Sessão ausente ou expirada. Entre novamente.') =>
  new ErroApi(401, 'NAO_AUTENTICADO', mensagem);

export const semPermissao = (mensagem = 'Seu perfil não tem permissão para esta ação.') =>
  new ErroApi(403, 'SEM_PERMISSAO', mensagem);

/** 403 enquanto o usuário usa senha temporária: só a sessão e a troca de senha ficam disponíveis. */
export const trocaSenhaObrigatoria = () =>
  new ErroApi(403, 'TROCA_SENHA_OBRIGATORIA', 'Defina uma nova senha para continuar usando a Ágora.');

export const naoEncontrado = (mensagem = 'Registro não encontrado.') => new ErroApi(404, 'NAO_ENCONTRADO', mensagem);

export const conflito = (mensagem: string) => new ErroApi(409, 'CONFLITO', mensagem);

export const regraNegocio = (mensagem: string, detalhes?: Detalhe[]) =>
  new ErroApi(422, 'REGRA_NEGOCIO', mensagem, detalhes);

export const validacao = (mensagem: string, detalhes?: Detalhe[]) => new ErroApi(400, 'VALIDACAO', mensagem, detalhes);

export function corpoErro(codigo: string, mensagem: string, idRequisicao: string, detalhes?: Detalhe[]): RespostaErro {
  return {
    erro: {
      codigo,
      mensagem,
      ...(detalhes && detalhes.length > 0 ? { detalhes } : {}),
      idRequisicao,
    },
  };
}
