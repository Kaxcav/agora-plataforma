import type { ConfiguracaoPublica } from '@agora/contratos';
import type { FastifyInstance } from 'fastify';
import { USUARIOS_DEMONSTRACAO, USUARIOS_DEMONSTRACAO_ADICIONAIS } from '../../seed/usuarios-demonstracao.ts';

/** GET /configuracao-publica — sem autenticação; nada de segredo aqui. */
export async function rotasConfiguracao(app: FastifyInstance): Promise<void> {
  app.get('/configuracao-publica', async (): Promise<ConfiguracaoPublica> => {
    const { config, versao } = app.agora;
    return {
      produto: 'Ágora',
      versao,
      ambiente: config.ambiente,
      orgao: { nome: config.orgao.nome, sigla: config.orgao.sigla, unidade: config.orgao.unidade },
      govbrHabilitado: config.govbr !== null,
      iaHabilitada: config.ia.provedor !== 'nenhum',
      encarregadoLgpd: { nome: config.encarregado.nome, email: config.encarregado.email },
      ...(config.ambiente === 'demonstracao'
        ? { usuariosDemonstracao: [...USUARIOS_DEMONSTRACAO, ...USUARIOS_DEMONSTRACAO_ADICIONAIS].map((u) => ({ email: u.email, perfil: u.perfil, descricao: u.descricao })) }
        : {}),
    };
  });
}
