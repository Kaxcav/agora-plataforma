import { ErroDominio } from '@agora/dominio';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ErroApi, corpoErro, type CodigoErro, type Detalhe } from './erros.ts';

function detalhesZod(erro: ZodError): Detalhe[] {
  return erro.issues.map((issue) => {
    const campo = issue.path.map(String).join('.');
    return campo ? { campo, mensagem: issue.message } : { mensagem: issue.message };
  });
}

const MENSAGENS_HTTP: Record<number, { codigo: CodigoErro; mensagem: string }> = {
  400: { codigo: 'VALIDACAO', mensagem: 'Requisição inválida.' },
  404: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' },
  405: { codigo: 'VALIDACAO', mensagem: 'Método não permitido.' },
  406: { codigo: 'VALIDACAO', mensagem: 'Formato de resposta não suportado.' },
  413: { codigo: 'VALIDACAO', mensagem: 'O corpo da requisição é grande demais.' },
  415: { codigo: 'VALIDACAO', mensagem: 'Tipo de conteúdo não suportado. Envie JSON.' },
  429: { codigo: 'LIMITE_REQUISICOES', mensagem: 'Muitas requisições. Aguarde e tente novamente.' },
};

/** Tratador único: toda falha vira `RespostaErro` com `idRequisicao`; detalhes internos só vão para o log. */
export function registrarTratadorErros(app: FastifyInstance): void {
  app.setErrorHandler((erro: FastifyError, request, reply) => {
    const id = request.id;
    if (erro instanceof ErroApi) {
      if (erro.status >= 500) request.log.error({ err: erro }, 'falha de API');
      return reply.status(erro.status).send(corpoErro(erro.codigo, erro.message, id, erro.detalhes));
    }
    if (erro instanceof ZodError) {
      return reply.status(400).send(corpoErro('VALIDACAO', 'Dados inválidos. Revise os campos indicados.', id, detalhesZod(erro)));
    }
    if (erro instanceof ErroDominio) {
      return reply.status(422).send(corpoErro('REGRA_NEGOCIO', erro.message, id, [{ campo: erro.codigo, mensagem: erro.message }]));
    }
    if (erro.code === '23505') {
      return reply.status(409).send(corpoErro('CONFLITO', 'Já existe um registro com estes dados.', id));
    }
    const status = typeof erro.statusCode === 'number' ? erro.statusCode : 500;
    if (status >= 400 && status < 500) {
      const conhecido = MENSAGENS_HTTP[status] ?? { codigo: 'VALIDACAO' as const, mensagem: 'Requisição inválida.' };
      return reply.status(status).send(corpoErro(conhecido.codigo, conhecido.mensagem, id));
    }
    request.log.error({ err: erro }, 'erro não tratado');
    return reply
      .status(500)
      .send(corpoErro('INTERNO', 'Ocorreu um erro interno. Informe o código da requisição ao suporte.', id));
  });
}
