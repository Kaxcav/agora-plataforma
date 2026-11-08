import { z } from 'zod';

/** Configuração da Ágora, validada na inicialização a partir das variáveis de ambiente (ARQUITETURA §2). */
export interface Config {
  ambiente: 'demonstracao' | 'homologacao' | 'producao';
  porta: number;
  host: string;
  bancoUrl: string | null;
  dadosDir: string;
  segredoSessao: string | null;
  cookieSeguro: boolean;
  seedDemonstracao: boolean;
  integracoes: 'offline' | 'online';
  ia: { provedor: 'nenhum' | 'openai_compativel'; url: string | null; modelo: string | null; chave: string | null };
  govbr: { clientId: string; clientSecret: string; emissor: string; redirect: string } | null;
  orgao: { nome: string; sigla: string; unidade: string; cnpj: string | null };
  encarregado: { nome: string; email: string };
  logNivel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  webDir: string | null;
  confiarProxy: boolean;
  limiteRequisicoesPorMinuto: number;
  /** Fontes da pesquisa de preços (RF-25) e dos índices da projeção (RIA-11), consultadas só pelo servidor. */
  precos: {
    comprasDadosUrl: string;
    transparenciaUrl: string;
    transparenciaChave: string | null;
    ibgeSidraUrl: string;
    bcbSgsUrl: string;
    timeoutMs: number;
  };
  /** Central de notificações (RF-26): canais, agendador da varredura diária e SMTP do órgão. */
  notificacoes: ConfigNotificacoes;
  /** Dados abertos do Compras.gov.br (acompanhamento da sessão oficial na sala de disputa; só no modo online). */
  comprasGov: { url: string };
}

export interface ConfigSmtp {
  host: string;
  porta: number;
  seguranca: 'tls' | 'starttls' | 'nenhuma';
  usuario: string | null;
  senha: string | null;
  remetente: string;
  timeoutMs: number;
}

export interface ConfigNotificacoes {
  /** 'api' = varredura e fila no próprio processo da API; 'externo' = processo à parte (`npm run notificacoes -w @agora/api`). */
  agendador: 'api' | 'externo';
  email: 'simulado' | 'smtp';
  sei: 'simulado' | 'desligado';
  govbr: 'simulado' | 'desligado';
  smtp: ConfigSmtp | null;
}

export class ErroConfiguracao extends Error {
  readonly problemas: string[];
  constructor(problemas: string[]) {
    super(`Configuração inválida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ErroConfiguracao';
    this.problemas = problemas;
  }
}

const textoOpcional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim()));

const booleanoOpcional = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === '') return null;
    const normalizado = v.trim().toLowerCase();
    if (['true', '1', 'sim', 'yes'].includes(normalizado)) return true;
    if (['false', '0', 'nao', 'não', 'no'].includes(normalizado)) return false;
    ctx.addIssue({ code: 'custom', message: 'use true ou false' });
    return z.NEVER;
  });

const esquemaAmbiente = z.object({
  AGORA_AMBIENTE: z.enum(['demonstracao', 'homologacao', 'producao']).default('demonstracao'),
  AGORA_PORTA: z.coerce.number().int().min(1).max(65535).default(3000),
  AGORA_HOST: z.string().min(1).default('0.0.0.0'),
  AGORA_BANCO_URL: textoOpcional,
  AGORA_DADOS_DIR: z.string().min(1).default('./.data/pglite'),
  AGORA_SEGREDO_SESSAO: textoOpcional,
  AGORA_COOKIE_SEGURO: booleanoOpcional,
  AGORA_SEED_DEMONSTRACAO: booleanoOpcional,
  AGORA_INTEGRACOES: z.enum(['offline', 'online']).default('offline'),
  AGORA_IA_PROVEDOR: z.enum(['nenhum', 'openai_compativel']).default('nenhum'),
  AGORA_IA_URL: textoOpcional,
  AGORA_IA_MODELO: textoOpcional,
  AGORA_IA_CHAVE: textoOpcional,
  AGORA_GOVBR_CLIENT_ID: textoOpcional,
  AGORA_GOVBR_CLIENT_SECRET: textoOpcional,
  AGORA_GOVBR_EMISSOR: textoOpcional,
  AGORA_GOVBR_REDIRECT: textoOpcional,
  AGORA_ORGAO_NOME: z.string().min(1).default('Ministério da Justiça e Segurança Pública'),
  AGORA_ORGAO_SIGLA: z.string().min(1).default('MJSP'),
  AGORA_ORGAO_UNIDADE: z.string().min(1).default('Secretaria Nacional de Segurança Pública — SENASP'),
  AGORA_ORGAO_CNPJ: textoOpcional,
  AGORA_ENCARREGADO_NOME: z.string().default('Encarregado pelo tratamento de dados pessoais'),
  AGORA_ENCARREGADO_EMAIL: z.string().default('encarregado.lgpd@orgao.gov.br'),
  AGORA_LOG_NIVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AGORA_WEB_DIR: textoOpcional,
  AGORA_CONFIAR_PROXY: booleanoOpcional,
  AGORA_LIMITE_REQUISICOES_MINUTO: z.coerce.number().int().min(10).max(100_000).default(300),
  AGORA_COMPRAS_DADOS_URL: z.string().min(1).default('https://dadosabertos.compras.gov.br'),
  AGORA_TRANSPARENCIA_URL: z.string().min(1).default('https://api.portaldatransparencia.gov.br/api-de-dados'),
  AGORA_TRANSPARENCIA_CHAVE: textoOpcional,
  AGORA_IBGE_SIDRA_URL: z.string().min(1).default('https://apisidra.ibge.gov.br'),
  AGORA_BCB_SGS_URL: z.string().min(1).default('https://api.bcb.gov.br/dados/serie'),
  AGORA_PRECOS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  AGORA_NOTIFICACOES_AGENDADOR: z.enum(['api', 'externo']).default('api'),
  AGORA_NOTIFICACOES_EMAIL: z.enum(['simulado', 'smtp']).default('simulado'),
  AGORA_NOTIFICACOES_SEI: z.enum(['simulado', 'desligado']).default('simulado'),
  AGORA_NOTIFICACOES_GOVBR: z.enum(['simulado', 'desligado']).default('simulado'),
  AGORA_SMTP_HOST: textoOpcional,
  AGORA_SMTP_PORTA: z.preprocess(vazioComoAusente, z.coerce.number().int().min(1).max(65535).optional()),
  AGORA_SMTP_SEGURANCA: z.enum(['starttls', 'tls', 'nenhuma']).default('starttls'),
  AGORA_SMTP_USUARIO: textoOpcional,
  AGORA_SMTP_SENHA: textoOpcional,
  AGORA_SMTP_REMETENTE: textoOpcional,
  AGORA_SMTP_TIMEOUT_MS: z.preprocess(vazioComoAusente, z.coerce.number().int().min(1000).max(120_000).default(15_000)),
  AGORA_COMPRAS_GOV_URL: z.string().trim().min(1).default('https://dadosabertos.compras.gov.br'),
});

const PORTA_SMTP_PADRAO = { tls: 465, starttls: 587, nenhuma: 25 } as const;
/** Variável vazia (o docker-compose repassa "" quando a variável não está no .env) vale como não definida. */
function vazioComoAusente(v: unknown): unknown {
  return typeof v === 'string' && v.trim() === '' ? undefined : v;
}
const EMAIL_SIMPLES = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]+$/;

function urlValida(valor: string): boolean {
  if (!URL.canParse(valor)) return false;
  const protocolo = new URL(valor).protocol;
  return protocolo === 'https:' || protocolo === 'http:';
}

/** Lê e valida as variáveis de ambiente. Lança `ErroConfiguracao` com a lista de problemas. */
export function carregarConfig(env: Record<string, string | undefined> = process.env): Config {
  const resultado = esquemaAmbiente.safeParse(env);
  if (!resultado.success) {
    throw new ErroConfiguracao(resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = resultado.data;
  const problemas: string[] = [];
  const producao = e.AGORA_AMBIENTE === 'producao';

  if (e.AGORA_SEGREDO_SESSAO !== null && Buffer.byteLength(e.AGORA_SEGREDO_SESSAO, 'utf8') < 32) {
    problemas.push('AGORA_SEGREDO_SESSAO: deve ter pelo menos 32 bytes');
  }
  if (producao && e.AGORA_SEGREDO_SESSAO === null) {
    problemas.push('AGORA_SEGREDO_SESSAO: obrigatório em produção (mínimo 32 bytes)');
  }
  if (producao && e.AGORA_BANCO_URL === null) {
    problemas.push('AGORA_BANCO_URL: obrigatório em produção (PostgreSQL 16)');
  }
  if (e.AGORA_BANCO_URL !== null && !/^postgres(ql)?:\/\//.test(e.AGORA_BANCO_URL)) {
    problemas.push('AGORA_BANCO_URL: use uma URL postgres:// com usuário, senha, servidor, porta (5432) e nome do banco');
  }

  const camposGovbr = [e.AGORA_GOVBR_CLIENT_ID, e.AGORA_GOVBR_CLIENT_SECRET, e.AGORA_GOVBR_EMISSOR, e.AGORA_GOVBR_REDIRECT];
  const govbrDefinidos = camposGovbr.filter((c) => c !== null).length;
  let govbr: Config['govbr'] = null;
  if (
    e.AGORA_GOVBR_CLIENT_ID !== null &&
    e.AGORA_GOVBR_CLIENT_SECRET !== null &&
    e.AGORA_GOVBR_EMISSOR !== null &&
    e.AGORA_GOVBR_REDIRECT !== null
  ) {
    if (!urlValida(e.AGORA_GOVBR_EMISSOR)) problemas.push('AGORA_GOVBR_EMISSOR: URL inválida');
    if (!urlValida(e.AGORA_GOVBR_REDIRECT)) problemas.push('AGORA_GOVBR_REDIRECT: URL inválida');
    govbr = {
      clientId: e.AGORA_GOVBR_CLIENT_ID,
      clientSecret: e.AGORA_GOVBR_CLIENT_SECRET,
      emissor: e.AGORA_GOVBR_EMISSOR.replace(/\/+$/, ''),
      redirect: e.AGORA_GOVBR_REDIRECT,
    };
  } else if (govbrDefinidos > 0) {
    problemas.push('AGORA_GOVBR_*: defina CLIENT_ID, CLIENT_SECRET, EMISSOR e REDIRECT juntos (ou nenhum)');
  }

  if (e.AGORA_IA_PROVEDOR === 'openai_compativel' && (e.AGORA_IA_URL === null || !urlValida(e.AGORA_IA_URL))) {
    problemas.push('AGORA_IA_URL: obrigatória e válida quando AGORA_IA_PROVEDOR=openai_compativel');
  }
  if (e.AGORA_ORGAO_CNPJ !== null && !/^\d{14}$/.test(e.AGORA_ORGAO_CNPJ.replace(/\D/g, ''))) {
    problemas.push('AGORA_ORGAO_CNPJ: informe os 14 dígitos do CNPJ do órgão');
  }
  for (const [nome, valor] of [
    ['AGORA_COMPRAS_DADOS_URL', e.AGORA_COMPRAS_DADOS_URL],
    ['AGORA_TRANSPARENCIA_URL', e.AGORA_TRANSPARENCIA_URL],
    ['AGORA_IBGE_SIDRA_URL', e.AGORA_IBGE_SIDRA_URL],
    ['AGORA_BCB_SGS_URL', e.AGORA_BCB_SGS_URL],
  ] as const) {
    if (!urlValida(valor)) problemas.push(`${nome}: URL inválida`);
  }

  let smtp: ConfigSmtp | null = null;
  if (e.AGORA_NOTIFICACOES_EMAIL === 'smtp') {
    if (e.AGORA_SMTP_HOST === null) problemas.push('AGORA_SMTP_HOST: obrigatório quando AGORA_NOTIFICACOES_EMAIL=smtp');
    if (e.AGORA_SMTP_REMETENTE === null || !EMAIL_SIMPLES.test(e.AGORA_SMTP_REMETENTE)) {
      problemas.push('AGORA_SMTP_REMETENTE: informe o e-mail institucional remetente (ex.: nao-responda@orgao.gov.br)');
    }
    if ((e.AGORA_SMTP_USUARIO === null) !== (e.AGORA_SMTP_SENHA === null)) {
      problemas.push('AGORA_SMTP_USUARIO e AGORA_SMTP_SENHA: defina os dois juntos (ou nenhum, para relay sem autenticação)');
    }
    if (e.AGORA_SMTP_USUARIO !== null && e.AGORA_SMTP_SEGURANCA === 'nenhuma') {
      problemas.push('AGORA_SMTP_SEGURANCA: credenciais SMTP exigem tls ou starttls (a senha não trafega sem criptografia)');
    }
    if (e.AGORA_SMTP_HOST !== null && e.AGORA_SMTP_REMETENTE !== null) {
      smtp = {
        host: e.AGORA_SMTP_HOST,
        porta: e.AGORA_SMTP_PORTA ?? PORTA_SMTP_PADRAO[e.AGORA_SMTP_SEGURANCA],
        seguranca: e.AGORA_SMTP_SEGURANCA,
        usuario: e.AGORA_SMTP_USUARIO,
        senha: e.AGORA_SMTP_SENHA,
        remetente: e.AGORA_SMTP_REMETENTE,
        timeoutMs: e.AGORA_SMTP_TIMEOUT_MS,
      };
    }
  }
  if (!urlValida(e.AGORA_COMPRAS_GOV_URL)) problemas.push('AGORA_COMPRAS_GOV_URL: URL inválida (use https://)');
  if (problemas.length > 0) throw new ErroConfiguracao(problemas);

  return {
    ambiente: e.AGORA_AMBIENTE,
    porta: e.AGORA_PORTA,
    host: e.AGORA_HOST,
    bancoUrl: e.AGORA_BANCO_URL,
    dadosDir: e.AGORA_DADOS_DIR,
    segredoSessao: e.AGORA_SEGREDO_SESSAO,
    cookieSeguro: e.AGORA_COOKIE_SEGURO ?? producao,
    seedDemonstracao: e.AGORA_SEED_DEMONSTRACAO ?? e.AGORA_AMBIENTE === 'demonstracao',
    integracoes: e.AGORA_INTEGRACOES,
    ia: { provedor: e.AGORA_IA_PROVEDOR, url: e.AGORA_IA_URL, modelo: e.AGORA_IA_MODELO, chave: e.AGORA_IA_CHAVE },
    govbr,
    orgao: {
      nome: e.AGORA_ORGAO_NOME,
      sigla: e.AGORA_ORGAO_SIGLA,
      unidade: e.AGORA_ORGAO_UNIDADE,
      cnpj: e.AGORA_ORGAO_CNPJ === null ? null : e.AGORA_ORGAO_CNPJ.replace(/\D/g, ''),
    },
    encarregado: { nome: e.AGORA_ENCARREGADO_NOME, email: e.AGORA_ENCARREGADO_EMAIL },
    logNivel: e.AGORA_LOG_NIVEL,
    webDir: e.AGORA_WEB_DIR,
    confiarProxy: e.AGORA_CONFIAR_PROXY ?? false,
    limiteRequisicoesPorMinuto: e.AGORA_LIMITE_REQUISICOES_MINUTO,
    precos: {
      comprasDadosUrl: e.AGORA_COMPRAS_DADOS_URL.replace(/\/+$/, ''),
      transparenciaUrl: e.AGORA_TRANSPARENCIA_URL.replace(/\/+$/, ''),
      transparenciaChave: e.AGORA_TRANSPARENCIA_CHAVE,
      ibgeSidraUrl: e.AGORA_IBGE_SIDRA_URL.replace(/\/+$/, ''),
      bcbSgsUrl: e.AGORA_BCB_SGS_URL.replace(/\/+$/, ''),
      timeoutMs: e.AGORA_PRECOS_TIMEOUT_MS,
    },
    notificacoes: {
      agendador: e.AGORA_NOTIFICACOES_AGENDADOR,
      email: e.AGORA_NOTIFICACOES_EMAIL,
      sei: e.AGORA_NOTIFICACOES_SEI,
      govbr: e.AGORA_NOTIFICACOES_GOVBR,
      smtp,
    },
    comprasGov: { url: e.AGORA_COMPRAS_GOV_URL.replace(/\/+$/, '') },
  };
}
