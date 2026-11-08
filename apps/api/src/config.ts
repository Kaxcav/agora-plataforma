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
  /** Documentos do processo (RF-21): diretório no servidor (`memory://` em testes); `null` desliga o envio. */
  arquivos: { dir: string | null; tamanhoMaximoBytes: number };
  /** Antivírus do órgão (clamd por TCP, `tcp://host:3310`); `null` = desligado. */
  antivirusUrl: string | null;
  /** Serviço de OCR auto-hospedado (apps/ocr); `null` = PDF digitalizado não é lido. */
  ocr: { url: string | null; timeoutMs: number };
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
  AGORA_ARQUIVOS_DIR: textoOpcional,
  AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB: z.coerce.number().int().min(1).max(200).default(20),
  AGORA_ANTIVIRUS_URL: textoOpcional,
  AGORA_OCR_URL: textoOpcional,
  AGORA_OCR_TIMEOUT_SEGUNDOS: z.coerce.number().int().min(5).max(900).default(120),
});

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
    problemas.push('AGORA_BANCO_URL: use o formato postgres://usuario:senha@host:5432/banco');
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
  if (e.AGORA_ANTIVIRUS_URL !== null && !/^tcp:\/\/[^\s/:]+:\d{1,5}$/.test(e.AGORA_ANTIVIRUS_URL)) {
    problemas.push('AGORA_ANTIVIRUS_URL: use o formato tcp://host:3310 (clamd do órgão)');
  }
  if (e.AGORA_OCR_URL !== null && !urlValida(e.AGORA_OCR_URL)) {
    problemas.push('AGORA_OCR_URL: URL inválida (ex.: http://ocr:8080)');
  }
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
    arquivos: {
      // Sem AGORA_ARQUIVOS_DIR: junto dos dados locais em demonstração/homologação; desligado em produção.
      dir: e.AGORA_ARQUIVOS_DIR ?? (producao ? null : e.AGORA_DADOS_DIR.startsWith('memory://') ? 'memory://' : `${e.AGORA_DADOS_DIR.replace(/[\\/]+$/, '')}/arquivos`),
      tamanhoMaximoBytes: e.AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB * 1024 * 1024,
    },
    antivirusUrl: e.AGORA_ANTIVIRUS_URL,
    ocr: { url: e.AGORA_OCR_URL === null ? null : e.AGORA_OCR_URL.replace(/\/+$/, ''), timeoutMs: e.AGORA_OCR_TIMEOUT_SEGUNDOS * 1000 },
  };
}
