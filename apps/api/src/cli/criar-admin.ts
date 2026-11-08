import { parseArgs } from 'node:util';
import { mascararEmail, somenteDigitos, validarCpf } from '@agora/dominio';
import { registrarEvento } from '../auditoria/trilha.ts';
import { gerarHashSenha, gerarSenhaTemporaria } from '../autenticacao/senhas.ts';
import { abrirBanco } from '../banco/abrir.ts';
import { aplicarMigracoes } from '../banco/migracoes.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { carregarConfig, ErroConfiguracao } from '../config.ts';

/**
 * `npm run criar-admin -w @agora/api -- --email … --nome … --cpf …`
 * Cria o primeiro administrador (escopo de todas as UASGs) e imprime uma senha temporária.
 */
async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, nome: { type: 'string' }, cpf: { type: 'string' } },
  });
  const email = (values.email ?? '').trim().toLowerCase();
  const nome = (values.nome ?? '').trim();
  const cpf = somenteDigitos(values.cpf ?? '');
  const problemas = [
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : '--email inválido',
    nome.length >= 3 ? null : '--nome deve ter pelo menos 3 caracteres',
    validarCpf(cpf) ? null : '--cpf inválido',
  ].filter((p): p is string => p !== null);
  if (problemas.length > 0) {
    process.stderr.write(`Uso: criar-admin --email <e-mail> --nome <nome> --cpf <cpf>\n${problemas.join('\n')}\n`);
    return 1;
  }

  const config = carregarConfig();
  const banco = await abrirBanco(config, (erro) => process.stderr.write(`Erro de conexão: ${erro.message}\n`));
  try {
    await aplicarMigracoes(banco);
    const senha = gerarSenhaTemporaria();
    const hash = await gerarHashSenha(senha);
    const criado = await banco.transacao(async (tx) => {
      const [existente] = await tx.consultar<{ id: string }>('SELECT id FROM usuarios WHERE email = $1 OR cpf = $2', [email, cpf]);
      if (existente) return null;
      const [usuario] = await tx.consultar<{ id: string }>(
        `INSERT INTO usuarios (nome, email, cpf, senha_hash, ativo, todas_uasgs, deve_trocar_senha, busca_normalizada)
         VALUES ($1, $2, $3, $4, true, true, true, $5) RETURNING id`,
        [nome, email, cpf, hash, normalizarBusca(nome, email)],
      );
      if (!usuario) throw new Error('Falha ao criar o administrador');
      await tx.executar(`INSERT INTO usuarios_perfis (usuario_id, perfil) VALUES ($1, 'administrador')`, [usuario.id]);
      await registrarEvento(
        tx,
        {
          usuarioId: null,
          acao: 'usuario.criar',
          recurso: 'usuario',
          recursoId: usuario.id,
          resumo: `Criou o administrador ${nome} pela linha de comando`,
          dados: { email: mascararEmail(email), perfis: ['administrador'], origem: 'cli' },
        },
        new Date(),
      );
      return usuario.id;
    });
    if (!criado) {
      process.stderr.write('Já existe um usuário com este e-mail ou CPF.\n');
      return 1;
    }
    process.stdout.write(`Administrador criado: ${email}\nSenha temporária (guarde em local seguro): ${senha}\n`);
    return 0;
  } finally {
    await banco.fechar();
  }
}

principal()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((erro: unknown) => {
    process.stderr.write(`${erro instanceof ErroConfiguracao ? erro.message : erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}\n`);
    process.exitCode = 1;
  });
