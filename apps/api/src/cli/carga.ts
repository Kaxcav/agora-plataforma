/**
 * Teste de carga reproduzível da Ágora (RNF-10), com ferramenta própria (Node, sem serviço de terceiros):
 *
 *   npm run carga -w @agora/api                       # sobe a Ágora no próprio processo (PGlite em memória, carga sintética)
 *   npm run carga -w @agora/api -- --url https://agora-homologacao.orgao.gov.br   # contra um ambiente já no ar
 *
 * Cenários: listagens, jornada (autuação, DFD e consulta), publicação pela fila (PNCP simulado no modo offline) e
 * envio de documentos. Os volumes de referência vêm de `deploy/carga/carga.json` (ou `--config`, ou
 * AGORA_CARGA_CONFIG) e podem ser sobrepostos por AGORA_CARGA_PROCESSOS_ANO, AGORA_CARGA_DOCUMENTOS_ANO e
 * AGORA_CARGA_USUARIOS_SIMULTANEOS. O relatório é gravado em `docs/operacao/teste-carga.md` (ou `--saida`).
 * Contra um ambiente no ar, a conta vem de AGORA_CARGA_EMAIL e AGORA_CARGA_SENHA (perfil administrador, para
 * cobrir todos os cenários); use homologação, nunca produção.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CENARIOS_CARGA, dimensionarCarga, estatisticasLatencia, type CenarioCarga, type EstatisticasLatencia } from '@agora/dominio';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { construirApp } from '../app.ts';
import { gerarPdfTexto } from '../compartilhado/pdf-texto.ts';
import { carregarConfig } from '../config.ts';
import { SENHA_DEMONSTRACAO } from '../seed/usuarios-demonstracao.ts';

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_PADRAO = resolve(RAIZ, 'deploy/carga/carga.json');
const SAIDA_PADRAO = resolve(RAIZ, 'docs/operacao/teste-carga.md');

const porCenario = <T extends z.ZodType>(t: T) => z.object({ listagens: t, jornada: t, publicacao: t, documentos: t });
const esquemaConfig = z.object({
  descricao: z.string().optional(),
  volumes: z.object({
    processosAno: z.number().positive(),
    documentosAno: z.number().positive(),
    usuariosSimultaneos: z.number().positive(),
    consultasPorUsuarioMinuto: z.number().positive(),
    escritasPorProcesso: z.number().positive(),
    diasUteisAno: z.number().int().min(1).max(366),
    horasExpediente: z.number().positive().max(24),
    fatorPico: z.number().positive(),
  }),
  execucao: z.object({
    concorrencia: z.number().int().min(1).max(256),
    operacoes: porCenario(z.number().int().min(1).max(100_000)),
    limiteP95Ms: porCenario(z.number().positive()),
  }),
});
type ConfigCarga = z.infer<typeof esquemaConfig>;

function lerConfig(caminho: string): ConfigCarga {
  const config = esquemaConfig.parse(JSON.parse(readFileSync(caminho, 'utf8')));
  const sobrepor = (variavel: string): number | undefined => {
    const valor = process.env[variavel];
    if (valor === undefined || valor.trim() === '') return undefined;
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${variavel}: informe um número maior que zero.`);
    return n;
  };
  config.volumes.processosAno = sobrepor('AGORA_CARGA_PROCESSOS_ANO') ?? config.volumes.processosAno;
  config.volumes.documentosAno = sobrepor('AGORA_CARGA_DOCUMENTOS_ANO') ?? config.volumes.documentosAno;
  config.volumes.usuariosSimultaneos = sobrepor('AGORA_CARGA_USUARIOS_SIMULTANEOS') ?? config.volumes.usuariosSimultaneos;
  return config;
}

// ───────────────────────── cliente HTTP ─────────────────────────

interface Sessao {
  base: string;
  cookie: string;
  csrf: string;
}

async function entrar(base: string, email: string, senha: string): Promise<Sessao> {
  const r = await fetch(`${base}/api/v1/sessao`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  if (r.status !== 200) throw new Error(`Login de ${email} falhou: HTTP ${r.status}`);
  const corpo = (await r.json()) as { csrfToken: string };
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { base, cookie, csrf: corpo.csrfToken };
}

async function requisitar(s: Sessao, metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
  const binario = corpo instanceof Buffer;
  const r = await fetch(`${s.base}/api/v1${caminho}`, {
    method: metodo,
    headers: {
      cookie: s.cookie,
      ...(metodo === 'GET' ? {} : { 'x-agora-csrf': s.csrf }),
      ...(corpo === undefined ? {} : { 'content-type': binario ? 'application/pdf' : 'application/json' }),
      ...extra,
    },
    ...(corpo === undefined ? {} : { body: binario ? new Uint8Array(corpo) : JSON.stringify(corpo) }),
  });
  const texto = await r.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

// ───────────────────────── execução ─────────────────────────

interface Medicao {
  operacoes: number;
  erros: number;
  primeiroErro: string | null;
  duracaoMs: number;
  latencias: number[];
}

/** Executa `total` operações com `concorrencia` trabalhadores; cada operação devolve o status HTTP esperado ou não. */
async function medir(total: number, concorrencia: number, operacao: (indice: number) => Promise<{ ok: boolean; descricao: string }>): Promise<Medicao> {
  const latencias: number[] = [];
  let proximo = 0;
  let erros = 0;
  let primeiroErro: string | null = null;
  const inicio = performance.now();
  const trabalhador = async () => {
    while (proximo < total) {
      const indice = proximo++;
      const t0 = performance.now();
      try {
        const r = await operacao(indice);
        latencias.push(performance.now() - t0);
        if (!r.ok) {
          erros++;
          primeiroErro ??= r.descricao;
        }
      } catch (erro) {
        latencias.push(performance.now() - t0);
        erros++;
        primeiroErro ??= erro instanceof Error ? erro.message : String(erro);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, total) }, trabalhador));
  return { operacoes: total, erros, primeiroErro, duracaoMs: performance.now() - inicio, latencias };
}

const LISTAGENS = ['/processos?tamanhoPagina=25', '/contratos?tamanhoPagina=25', '/fornecedores?tamanhoPagina=25', '/atas?tamanhoPagina=25', '/painel'];

const DFD_CARGA = {
  descricaoNecessidade: 'Necessidade sintética criada pelo teste de carga para medir a escrita da jornada da contratação.',
  justificativa: 'Justificativa sintética do teste de carga, sem relação com nenhuma contratação real do órgão.',
  usaCatalogoPadronizado: true,
  justificativaNaoPadronizacao: null,
  justificativaArtigoLuxo: null,
  previstoNoPca: true,
  tipoObjeto: 'bens',
  itens: [{ catmat: null, descricao: 'Item sintético do teste de carga', unidade: 'unidade', quantidade: 10, valorUnitarioEstimado: 15_000 }],
};

/**
 * Massa da publicação (só no modo em processo): cópias sintéticas do processo da etapa 5 da carga de demonstração,
 * com o parecer favorável, para que cada operação publique um processo diferente pela fila.
 */
async function prepararPublicaveis(app: FastifyInstance, quantidade: number): Promise<string[]> {
  const banco = app.agora.banco;
  const [origem] = await banco.consultar<{ id: string; parecer: { itens: { id: string }[] } }>(
    `SELECT id, parecer FROM processos WHERE etapa_atual = 5 AND publicacao ->> 'pncp' = 'nao_publicado' ORDER BY numero_sei LIMIT 1`,
  );
  if (!origem) return [];
  const colunas = async (tabela: string) =>
    (await banco.consultar<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = current_schema() ORDER BY ordinal_position`, [tabela])).map(
      (c) => c.column_name,
    );
  const colunasProcesso = await colunas('processos');
  const colunasDocumento = await colunas('documentos_gerados');
  const parecer = JSON.stringify({ itens: origem.parecer.itens.map((i) => ({ id: i.id, atendido: true, observacao: null })), conclusao: 'favoravel', pareceristaId: null, emitidoEm: new Date().toISOString() });
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const id = randomUUID();
    const numero = `99999.${String(100_000 + i)}/2026-${String(i % 100).padStart(2, '0')}`;
    const expressao = (c: string) =>
      ({ id: '$2::uuid', numero_sei: '$3', titulo: "titulo || ' (massa do teste de carga)'", contrato_id: 'NULL', parecer: '$4::jsonb' })[c] ?? c;
    await banco.transacao(async (tx) => {
      await tx.executar(`INSERT INTO processos (${colunasProcesso.join(', ')}) SELECT ${colunasProcesso.map(expressao).join(', ')} FROM processos WHERE id = $1`, [origem.id, id, numero, parecer]);
      const doc = (c: string) => ({ id: 'gen_random_uuid()', processo_id: '$2::uuid' })[c] ?? c;
      await tx.executar(`INSERT INTO documentos_gerados (${colunasDocumento.join(', ')}) SELECT ${colunasDocumento.map(doc).join(', ')} FROM documentos_gerados WHERE processo_id = $1`, [origem.id, id]);
    });
    ids.push(id);
  }
  return ids;
}

/** Processos já publicáveis num ambiente no ar (etapa 5, parecer favorável, ainda não publicados). */
async function publicaveisRemotos(s: Sessao, limite: number): Promise<string[]> {
  const lista = (await requisitar(s, 'GET', '/processos?etapa=5&tamanhoPagina=100')).json as { itens?: { id: string }[] } | null;
  const ids: string[] = [];
  for (const p of lista?.itens ?? []) {
    if (ids.length >= limite) break;
    const d = (await requisitar(s, 'GET', `/processos/${p.id}`)).json as { parecer?: { conclusao: string | null }; publicacao?: { pncp: string } } | null;
    if ((d?.parecer?.conclusao === 'favoravel' || d?.parecer?.conclusao === 'favoravel_com_ressalvas') && d.publicacao?.pncp === 'nao_publicado') ids.push(p.id);
  }
  return ids;
}

interface ResultadoCenario {
  cenario: CenarioCarga;
  medicao: Medicao;
  estatisticas: EstatisticasLatencia | null;
  vazaoMedida: number;
  vazaoExigida: number;
  memoria: string;
  limiteP95Ms: number;
  atende: boolean;
  observacao: string;
}

const NOMES: Record<CenarioCarga, string> = {
  listagens: 'Listagens (processos, contratos, fornecedores, atas e painel)',
  jornada: 'Jornada (autuação, DFD e consulta do processo)',
  publicacao: 'Publicação no PNCP pela fila (até a primeira execução do trabalhador)',
  documentos: 'Envio de documentos do processo (PDF)',
};

function numero(n: number, casas = 1): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function relatorio(dados: { config: ConfigCarga; caminhoConfig: string; alvo: string; resultados: ResultadoCenario[]; inicio: Date }): string {
  const { config, resultados } = dados;
  const linhas = resultados.map((r) => {
    const e = r.estatisticas;
    return `| ${NOMES[r.cenario]} | ${r.medicao.operacoes} | ${r.medicao.erros} | ${numero(r.vazaoMedida, 2)} | ${numero(r.vazaoExigida, 4)} | ${e ? numero(e.p50Ms) : '—'} | ${e ? numero(e.p95Ms) : '—'} | ${e ? numero(e.p99Ms) : '—'} | ${numero(r.limiteP95Ms, 0)} | ${r.atende ? 'Atende' : 'Não atende'} |`;
  });
  const v = config.volumes;
  return [
    '# Teste de carga da Ágora (RNF-10)',
    '',
    `Relatório gerado por \`npm run carga -w @agora/api\` em ${dados.inicio.toISOString()}. Volumes de referência: \`${dados.caminhoConfig}\`.`,
    '',
    '> Os volumes deste arquivo são sintéticos. Para o laudo do órgão, informe os volumes do ETP na configuração e rode contra a homologação (`--url`), com PostgreSQL e o trabalhador separado. Medição para apoio à decisão; requer revisão humana.',
    '',
    '## Ambiente da execução',
    '',
    `- Alvo: ${dados.alvo}`,
    `- Node ${process.version}; ${platform()} ${release()}; ${cpus().length} CPU(s) (${cpus()[0]?.model.trim() ?? 'modelo não informado'}); ${numero(totalmem() / 1024 ** 3, 1)} GiB de memória`,
    `- Concorrência: ${config.execucao.concorrencia} trabalhadores simultâneos`,
    '',
    '## Volumes de referência e vazão exigida no pico',
    '',
    `- Processos por ano: ${v.processosAno}; documentos por ano: ${v.documentosAno}; usuários simultâneos no pico: ${v.usuariosSimultaneos}`,
    `- Expediente: ${v.diasUteisAno} dias úteis × ${v.horasExpediente} h; pico de ${v.fatorPico}× a média; ${v.escritasPorProcesso} escritas por processo; ${v.consultasPorUsuarioMinuto} consultas por usuário por minuto`,
    '',
    ...resultados.map((r) => `- ${NOMES[r.cenario]}: ${numero(r.vazaoExigida, 4)} operação(ões)/s — ${r.memoria}`),
    '',
    '## Resultados',
    '',
    '| Cenário | Operações | Erros | Vazão medida (op/s) | Vazão exigida (op/s) | p50 (ms) | p95 (ms) | p99 (ms) | Limite p95 (ms) | Situação |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...linhas,
    '',
    'Atende = sem erros, vazão medida maior ou igual à exigida e p95 dentro do limite configurado.',
    '',
    '## Observações',
    '',
    ...resultados.map((r) => `- ${NOMES[r.cenario]}: ${r.observacao}`),
    '- No modo em processo, banco e aplicação dividem a mesma máquina e o banco é o PGlite em memória (um processo só): o resultado serve para comparar versões, não como capacidade da produção.',
    '- A publicação pela fila mede a resposta da API até a primeira execução do trabalhador embutido, com o PNCP simulado (modo offline); nenhuma chamada sai para o PNCP real.',
    '',
  ].join('\n');
}

async function principal(): Promise<number> {
  const { values } = parseArgs({ options: { config: { type: 'string' }, url: { type: 'string' }, saida: { type: 'string' } } });
  const caminhoConfig = resolve(values.config ?? process.env.AGORA_CARGA_CONFIG ?? CONFIG_PADRAO);
  const config = lerConfig(caminhoConfig);
  const demanda = new Map(dimensionarCarga(config.volumes).map((d) => [d.cenario, d]));
  const inicio = new Date();

  let app: FastifyInstance | null = null;
  let base: string;
  let sessao: Sessao;
  if (values.url) {
    base = values.url.replace(/\/+$/, '');
    const email = process.env.AGORA_CARGA_EMAIL;
    const senha = process.env.AGORA_CARGA_SENHA;
    if (!email || !senha) throw new Error('Com --url, defina AGORA_CARGA_EMAIL e AGORA_CARGA_SENHA (conta de homologação).');
    sessao = await entrar(base, email, senha);
  } else {
    const configApp = carregarConfig({
      AGORA_AMBIENTE: 'demonstracao',
      AGORA_DADOS_DIR: 'memory://',
      AGORA_LOG_NIVEL: 'silent',
      AGORA_WEB_DIR: 'memory://sem-front-end',
      AGORA_LIMITE_REQUISICOES_MINUTO: '100000',
      AGORA_OPERACAO_SONDA_SEGUNDOS: '0',
      AGORA_HOST: '127.0.0.1',
    });
    process.stdout.write('Subindo a Ágora em processo (PGlite em memória, carga sintética)...\n');
    app = await construirApp(configApp);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const endereco = app.server.address();
    if (endereco === null || typeof endereco === 'string') throw new Error('Endereço do servidor indisponível.');
    base = `http://127.0.0.1:${endereco.port}`;
    sessao = await entrar(base, 'admin@agora.demo', SENHA_DEMONSTRACAO);
  }

  const { concorrencia, operacoes, limiteP95Ms } = config.execucao;
  const resultados: ResultadoCenario[] = [];
  const registrar = (cenario: CenarioCarga, medicao: Medicao, observacao: string) => {
    const d = demanda.get(cenario);
    const estatisticas = medicao.latencias.length > 0 ? estatisticasLatencia(medicao.latencias) : null;
    const vazaoMedida = medicao.duracaoMs > 0 ? (medicao.operacoes * 1000) / medicao.duracaoMs : 0;
    const vazaoExigida = d?.vazaoExigidaPorSegundo ?? 0;
    const atende = medicao.erros === 0 && medicao.operacoes > 0 && vazaoMedida >= vazaoExigida && (estatisticas?.p95Ms ?? Infinity) <= limiteP95Ms[cenario];
    resultados.push({ cenario, medicao, estatisticas, vazaoMedida, vazaoExigida, memoria: d?.memoria ?? '', limiteP95Ms: limiteP95Ms[cenario], atende, observacao });
    process.stdout.write(
      `${NOMES[cenario]}: ${medicao.operacoes} op, ${medicao.erros} erro(s), ${numero(vazaoMedida, 2)} op/s, p95 ${estatisticas ? numero(estatisticas.p95Ms) : '—'} ms${medicao.primeiroErro ? ` (primeiro erro: ${medicao.primeiroErro})` : ''}\n`,
    );
  };

  try {
    for (const cenario of CENARIOS_CARGA) {
      if (cenario === 'listagens') {
        const m = await medir(operacoes.listagens, concorrencia, async (i) => {
          const caminho = LISTAGENS[i % LISTAGENS.length] ?? '/painel';
          const r = await requisitar(sessao, 'GET', caminho);
          return { ok: r.status === 200, descricao: `GET ${caminho} → ${r.status}` };
        });
        registrar(cenario, m, `${LISTAGENS.length} telas de consulta em rodízio, 25 itens por página.`);
      } else if (cenario === 'jornada') {
        const criados: string[] = [];
        const m = await medir(operacoes.jornada, concorrencia, async (i) => {
          const passo = i % 3;
          if (passo === 0 || criados.length === 0) {
            const r = await requisitar(sessao, 'POST', '/processos', { titulo: `Aquisição sintética do teste de carga nº ${i}`, orgao: 'MJSP' });
            const id = (r.json as { id?: string } | null)?.id;
            if (id) criados.push(id);
            return { ok: r.status === 201, descricao: `POST /processos → ${r.status}` };
          }
          const id = criados[(i * 7) % criados.length] ?? '';
          const r = passo === 1 ? await requisitar(sessao, 'PUT', `/processos/${id}/dfd`, DFD_CARGA) : await requisitar(sessao, 'GET', `/processos/${id}`);
          return { ok: r.status === 200, descricao: `${passo === 1 ? 'PUT' : 'GET'} /processos/:id${passo === 1 ? '/dfd' : ''} → ${r.status}` };
        });
        registrar(cenario, m, `Rodízio de autuação (POST), DFD (PUT) e consulta (GET) de processos sintéticos; ${criados.length} processos criados.`);
      } else if (cenario === 'publicacao') {
        const ids = app ? await prepararPublicaveis(app, operacoes.publicacao) : await publicaveisRemotos(sessao, operacoes.publicacao);
        if (ids.length === 0) {
          registrar(cenario, { operacoes: 0, erros: 0, primeiroErro: null, duracaoMs: 0, latencias: [] }, 'Nenhum processo publicável (etapa 5 com parecer favorável) no ambiente.');
          continue;
        }
        const m = await medir(ids.length, concorrencia, async (i) => {
          const r = await requisitar(sessao, 'POST', `/processos/${ids[i] ?? ''}/publicar`);
          const pncp = (r.json as { publicacao?: { pncp?: string } } | null)?.publicacao?.pncp;
          return { ok: r.status === 200 && (pncp === 'publicado' || pncp === 'na_fila'), descricao: `POST /processos/:id/publicar → ${r.status} (${pncp ?? '—'})` };
        });
        registrar(cenario, m, app ? `${ids.length} cópias sintéticas do processo da etapa 5, cada uma publicada uma vez pela fila.` : `${ids.length} processo(s) publicáveis encontrados no ambiente.`);
      } else {
        const lista = (await requisitar(sessao, 'GET', '/processos?tamanhoPagina=10')).json as { itens?: { id: string }[] } | null;
        const alvo = lista?.itens?.[0]?.id;
        if (!alvo) {
          registrar(cenario, { operacoes: 0, erros: 0, primeiroErro: null, duracaoMs: 0, latencias: [] }, 'Nenhum processo para receber documentos.');
          continue;
        }
        const m = await medir(operacoes.documentos, concorrencia, async (i) => {
          const pdf = gerarPdfTexto({ titulo: `Documento sintético ${i}`, conteudo: `# DOCUMENTO SINTÉTICO DO TESTE DE CARGA\n\nCópia ${i} gerada em ${new Date().toISOString()}.`, rodape: 'Teste de carga' });
          const consulta = `categoria=processo&tipo=documento_processo&titulo=${encodeURIComponent(`Documento sintético ${i}`)}`;
          const r = await requisitar(sessao, 'POST', `/processos/${alvo}/arquivos?${consulta}`, pdf, { 'x-agora-nome-arquivo': `sintetico-${i}.pdf` });
          return { ok: r.status === 200 || r.status === 201, descricao: `POST /processos/:id/arquivos → ${r.status}` };
        });
        registrar(cenario, m, 'PDF sintético de uma página por envio, conferido (assinatura, integridade e conteúdo ativo) e gravado pelo SHA-256.');
      }
    }
  } finally {
    await app?.close();
  }

  const saida = resolve(values.saida ?? SAIDA_PADRAO);
  mkdirSync(dirname(saida), { recursive: true });
  const alvo = app ? 'Ágora em processo (PGlite em memória, trabalhador embutido, integrações offline)' : base;
  writeFileSync(saida, relatorio({ config, caminhoConfig: caminhoConfig.replace(RAIZ, '').replaceAll('\\', '/'), alvo, resultados, inicio }), 'utf8');
  process.stdout.write(`Relatório gravado em ${saida}\n`);
  return resultados.every((r) => r.medicao.erros === 0) ? 0 : 1;
}

principal().then(
  (codigo) => process.exit(codigo),
  (erro: unknown) => {
    process.stderr.write(`[agora-carga] ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exit(1);
  },
);
