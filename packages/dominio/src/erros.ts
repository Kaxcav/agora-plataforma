/**
 * Erro de entrada inválida ou de violação de regra do domínio.
 * `codigo` é estável (ex.: 'MOEDA_INVALIDA') e pode ser usado pela API e pela interface;
 * `message` é a explicação em pt-BR.
 */
export class ErroDominio extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ErroDominio';
    this.codigo = codigo;
  }
}
