import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type {
  ArquivoProcesso,
  ArquivosProcesso,
  EventoAuditoria,
  Pagina,
  ProcessoDetalhe,
  ProcessoResumo,
  QualificacaoTecnica,
  RespostaSenhaTemporaria,
  UsuarioAdmin,
} from '@agora/contratos';
import { criarArmazenamento, ErroArmazenamento } from '../src/armazenamento/arquivos.ts';
import { sha256Hex } from '../src/compartilhado/cripto.ts';
import { gerarPdfTexto } from '../src/compartilhado/pdf-texto.ts';
import { verificarAntivirus } from '../src/integracoes/antivirus.ts';
import { gerarCpf } from '../src/seed/documentos.ts';
import { Prng } from '../src/seed/prng.ts';
import { chamar, criarAppTeste, entrar, obterJson, type Credenciais } from './apoio.ts';

// ───────────────────────── arquivos sintéticos ─────────────────────────

function atestadoPdf(linhas: string[]): Buffer {
  return gerarPdfTexto({ titulo: 'Atestado de capacidade técnica', conteudo: ['# ATESTADO DE CAPACIDADE TÉCNICA', '', ...linhas].join('\n'), rodape: 'Documento sintético de teste' });
}

/** Monta um PDF a partir dos corpos dos objetos (1 = catálogo), com xref e trailer. */
function montarPdf(corpos: (string | Buffer)[]): Buffer {
  const partes: Buffer[] = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const deslocamentos: number[] = [];
  let posicao = partes[0]?.length ?? 0;
  corpos.forEach((corpo, i) => {
    const bloco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), typeof corpo === 'string' ? Buffer.from(corpo, 'latin1') : corpo, Buffer.from('\nendobj\n', 'latin1')]);
    deslocamentos.push(posicao);
    partes.push(bloco);
    posicao += bloco.length;
  });
  const xref = `xref\n0 ${corpos.length + 1}\n0000000000 65535 f \n${deslocamentos.map((d) => `${String(d).padStart(10, '0')} 00000 n \n`).join('')}`;
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${corpos.length + 1} /Root 1 0 R >>\nstartxref\n${posicao}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

/** "Digitalizado": a página só tem uma imagem (escala de cinza), sem nenhum texto. */
function pdfDigitalizado(semente: number): Buffer {
  const pixels = Buffer.alloc(64, semente % 256);
  return montarPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 34 >>\nstream\nq 495 0 0 742 50 50 cm /Im1 Do Q\n\nendstream',
    Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 64 >>\nstream\n', 'latin1'), pixels, Buffer.from('\nendstream', 'latin1')]),
  ]);
}

const PDF_COM_JAVASCRIPT = montarPdf([
  '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  '<< /S /JavaScript /JS (app.alert\\(1\\)) >>',
]);

// ───────────────────────── apoio ─────────────────────────

interface Envio {
  categoria: 'processo' | 'habilitacao';
  tipo: string;
  titulo: string;
  fornecedorId?: string;
  contemDadoPessoal?: boolean;
  exercicio?: number;
  dataConstituicao?: string;
}

function enviar(app: FastifyInstance, c: Credenciais, processoId: string, envio: Envio, conteudo: Buffer, nome = 'atestado.pdf'): Promise<LightMyRequestResponse> {
  const consulta = new URLSearchParams();
  for (const [chave, valor] of Object.entries(envio)) if (valor !== undefined) consulta.set(chave, String(valor));
  return app.inject({
    method: 'POST',
    url: `/api/v1/processos/${processoId}/arquivos?${consulta.toString()}`,
    headers: { cookie: c.cookie, 'x-agora-csrf': c.csrf, 'content-type': 'application/octet-stream', 'x-agora-nome-arquivo': encodeURIComponent(nome) },
    payload: conteudo,
  });
}

async function processoNaEtapa(app: FastifyInstance, c: Credenciais, etapa: number): Promise<ProcessoDetalhe> {
  const lista = await obterJson<Pagina<ProcessoResumo>>(app, c, `/api/v1/processos?etapa=${etapa}&tamanhoPagina=100`);
  const primeiro = lista.itens[0];
  assert.ok(primeiro, `há processo na etapa ${etapa} no seed`);
  return obterJson<ProcessoDetalhe>(app, c, `/api/v1/processos/${primeiro.id}`);
}

/** Dados gravados na trilha (a API pública da trilha não expõe o campo dados). */
async function eventosDaTrilha(app: FastifyInstance, acao: string): Promise<{ recursoId: string | null; dados: Record<string, unknown> }[]> {
  const linhas = await app.agora.banco.consultar<{ recurso_id: string | null; dados: Record<string, unknown> }>(
    'SELECT recurso_id, dados FROM auditoria_eventos WHERE acao = $1 ORDER BY sequencia',
    [acao],
  );
  return linhas.map((l) => ({ recursoId: l.recurso_id, dados: l.dados }));
}

const OCR_FALSO_URL = 'http://ocr.teste.interno';

function ocrFalso(chamadas: { url: string; tipo: string | null; bytes: number }[]) {
  return async (entrada: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(entrada);
    if (!url.startsWith(OCR_FALSO_URL)) throw new Error(`chamada inesperada: ${url}`);
    const corpo = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    chamadas.push({ url, tipo: new Headers(init?.headers).get('content-type'), bytes: corpo.byteLength });
    return new Response(
      JSON.stringify({
        motor: 'Tesseract 5 (por) — simulado no teste',
        paginas: [
          {
            numero: 1,
            linhas: [
              { texto: 'ATESTADO DE CAPACIDADE TÉCNICA', confianca: 93 },
              { texto: 'Atestamos o fornecimento de 350 (trezentos e cinquenta) coletes balísticos nível III-A.', confianca: 88 },
              { texto: 'Responsável: CPF 123.456.789-09, telefone (61) 99876-1234.', confianca: 80 },
            ],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

// ───────────────────────── testes ─────────────────────────

describe('documentos do processo e leitura assistida de atestados (RF-21, RIA-08, RN-25)', () => {
  let app: FastifyInstance;
  let agente: Credenciais;
  let processo: ProcessoDetalhe;
  let licitanteA: string;
  let licitanteB: string;
  const chamadasOcr: { url: string; tipo: string | null; bytes: number }[] = [];

  before(async () => {
    app = await criarAppTeste({
      env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000', AGORA_OCR_URL: OCR_FALSO_URL, AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB: '1' },
      fetch: ocrFalso(chamadasOcr),
    });
    agente = await entrar(app, 'agente@agora.demo');
    processo = await processoNaEtapa(app, agente, 6);
    const [a, b] = processo.disputa.licitantes;
    assert.ok(a && b, 'o processo da etapa 6 tem licitantes');
    licitanteA = a.id;
    licitanteB = b.id;
  });
  after(async () => {
    await app.close();
  });

  test('o seed traz as exigências do edital do processo na etapa 6 (parcela ≥ 4% e mínimo de 50%)', async () => {
    const q = await obterJson<QualificacaoTecnica>(app, agente, `/api/v1/processos/${processo.id}/qualificacao-tecnica`);
    assert.equal(q.editavel, false, 'exigências do edital publicado não se alteram');
    const parcela = q.parcelas[0];
    assert.ok(parcela);
    assert.equal(parcela.maiorRelevancia, true);
    assert.equal(parcela.quantidadeMinima * 2 <= parcela.quantidadeObjeto, true);
    assert.equal(parcela.percentualMinimo, 50);
    assert.match(q.aviso, /requer revisão humana/);
    assert.ok(q.licitantes.some((l) => l.id === licitanteA));
  });

  test('envio de atestado em PDF: tipo pelo conteúdo, SHA-256 gravado e trilha de auditoria', async () => {
    const pdf = atestadoPdf(['Atestamos que a empresa forneceu 400 (quatrocentos) coletes balísticos nível III-A, com execução satisfatória.']);
    const r = await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'atestado_capacidade_tecnica', titulo: 'Atestado — órgão A', fornecedorId: licitanteA }, pdf, 'atestado-a.PNG');
    assert.equal(r.statusCode, 201, r.body);
    const arquivo = r.json<ArquivoProcesso>();
    assert.equal(arquivo.formato, 'pdf', 'a extensão .PNG do nome não importa');
    assert.equal(arquivo.sha256, sha256Hex(pdf));
    assert.equal(arquivo.tamanhoBytes, pdf.length);
    assert.equal(arquivo.antivirus, 'nao_verificado');
    assert.equal(arquivo.fornecedor?.id, licitanteA);
    assert.equal(arquivo.leitura, null);

    const auditor = await entrar(app, 'auditor@agora.demo');
    const trilha = await obterJson<Pagina<EventoAuditoria>>(app, auditor, '/api/v1/auditoria?acao=processo.arquivo.enviar');
    assert.ok(trilha.itens.some((e) => e.recursoId === processo.id && /atestado de capacidade técnica/.test(e.resumo)));
    const evento = (await eventosDaTrilha(app, 'processo.arquivo.enviar')).find((e) => e.recursoId === processo.id);
    assert.ok(evento, 'envio auditado');
    assert.equal((evento.dados as { sha256?: string }).sha256, sha256Hex(pdf));

    const repetido = await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'atestado_capacidade_tecnica', titulo: 'Atestado repetido', fornecedorId: licitanteA }, pdf);
    assert.equal(repetido.statusCode, 409, 'o mesmo arquivo não entra duas vezes');
  });

  test('recusa conteúdo que não é PDF/PNG/JPEG, PDF com JavaScript, arquivo acima do limite e corpo vazio', async () => {
    const base = { categoria: 'processo' as const, tipo: 'documento_processo', titulo: 'Documento qualquer' };
    const executavel = Buffer.concat([Buffer.from('MZ\x90\x00', 'latin1'), Buffer.alloc(200, 1)]);
    const exe = await enviar(app, agente, processo.id, base, executavel, 'nota.pdf');
    assert.equal(exe.statusCode, 422);
    assert.match(exe.json<{ erro: { mensagem: string } }>().erro.mensagem, /conferido pelo conteúdo/);
    assert.equal((await enviar(app, agente, processo.id, base, Buffer.from('<html><script>alert(1)</script></html>'), 'pagina.pdf')).statusCode, 422);
    const js = await enviar(app, agente, processo.id, base, PDF_COM_JAVASCRIPT, 'ativo.pdf');
    assert.equal(js.statusCode, 422);
    assert.match(js.json<{ erro: { mensagem: string } }>().erro.mensagem, /JavaScript/);
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 * 1024 + 10, 0x20)]);
    const excesso = await enviar(app, agente, processo.id, base, grande, 'grande.pdf');
    assert.equal(excesso.statusCode, 413);
    assert.match(excesso.json<{ erro: { mensagem: string } }>().erro.mensagem, /limite de 1 MB/);
    assert.equal((await enviar(app, agente, processo.id, base, Buffer.alloc(0))).statusCode, 400);
  });

  test('coerência: habilitação exige licitante da disputa; balanço exige exercício', async () => {
    const pdf = atestadoPdf(['Certidão sintética para teste de coerência dos metadados do envio de documentos.']);
    assert.equal((await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'certidao', titulo: 'Certidão sem licitante' }, pdf)).statusCode, 400);
    assert.equal((await enviar(app, agente, processo.id, { categoria: 'processo', tipo: 'atestado_capacidade_tecnica', titulo: 'Atestado sem habilitação' }, pdf)).statusCode, 400);
    const forasteiro = '00000000-0000-4000-8000-000000000001';
    assert.equal((await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'certidao', titulo: 'Certidão de estranho', fornecedorId: forasteiro }, pdf)).statusCode, 422);
    assert.equal((await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'balanco_patrimonial', titulo: 'Balanço sem exercício', fornecedorId: licitanteA }, pdf)).statusCode, 400);
  });

  test('leitura pela camada de texto: quantitativo com unidade, página e linha (PoC-03)', async () => {
    const { itens } = await obterJson<ArquivosProcesso>(app, agente, `/api/v1/processos/${processo.id}/arquivos`);
    const atestado = itens.find((a) => a.titulo === 'Atestado — órgão A');
    assert.ok(atestado);
    const r = await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${atestado.id}/leitura`, {});
    assert.equal(r.statusCode, 200, r.body);
    const lido = r.json<ArquivoProcesso>();
    assert.equal(lido.leitura?.metodo, 'camada_texto');
    assert.equal(lido.leitura?.situacao, 'concluida');
    assert.match(lido.leitura?.hashTexto ?? '', /^[0-9a-f]{64}$/);
    const mencao = lido.leitura?.mencoes[0];
    assert.ok(mencao, 'quantitativo localizado');
    assert.equal(mencao.quantidade, 400);
    assert.equal(mencao.quantidadePorExtenso, 400);
    assert.equal(mencao.pagina, 1);
    assert.equal(mencao.linha, 2);
    assert.match(mencao.trecho, /400 \(quatrocentos\) coletes/);
    assert.ok(mencao.parcelaId, 'associado à parcela do edital');
    assert.match(lido.leitura?.aviso ?? '', /requer revisão humana/);
    assert.equal(chamadasOcr.length, 0, 'PDF com texto não vai ao OCR');
  });

  test('PDF digitalizado vai ao serviço de OCR (falso); trechos saem com dado pessoal tarjado; soma entre atestados', async () => {
    const digitalizado = pdfDigitalizado(1);
    const r = await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'atestado_capacidade_tecnica', titulo: 'Atestado — órgão B (digitalizado)', fornecedorId: licitanteA, contemDadoPessoal: true }, digitalizado, 'atestado-b.pdf');
    assert.equal(r.statusCode, 201, r.body);
    const arquivo = r.json<ArquivoProcesso>();
    const lido = (await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${arquivo.id}/leitura`, {})).json<ArquivoProcesso>();
    assert.equal(lido.leitura?.metodo, 'ocr');
    assert.equal(lido.leitura?.situacao, 'concluida');
    assert.equal(lido.leitura?.confiancaOcr, 87);
    assert.match(lido.leitura?.motor ?? '', /Tesseract/);
    assert.equal(chamadasOcr.length, 1);
    assert.equal(chamadasOcr[0]?.url, `${OCR_FALSO_URL}/v1/ocr`);
    assert.equal(chamadasOcr[0]?.tipo, 'application/pdf');
    assert.equal(chamadasOcr[0]?.bytes, digitalizado.length);
    const mencao = lido.leitura?.mencoes.find((m) => m.quantidade === 350);
    assert.ok(mencao);
    assert.equal(mencao.linha, 2);

    const q = await obterJson<QualificacaoTecnica>(app, agente, `/api/v1/processos/${processo.id}/qualificacao-tecnica`);
    const analise = q.analise.find((x) => x.fornecedor.id === licitanteA);
    assert.ok(analise);
    assert.equal(analise.atestadosLidos, 2);
    const parcela = analise.parcelas[0];
    assert.ok(parcela);
    assert.equal(parcela.somado, 750, '400 + 350 coletes');
    assert.equal(parcela.atende, 750 >= parcela.exigido);
    assert.equal(analise.sinal, 'indica_atendimento');
    assert.deepEqual(parcela.contribuicoes.map((c) => c.quantidade).sort((x, y) => x - y), [350, 400]);
    const evidencias = parcela.contribuicoes.flatMap((c) => c.evidencias);
    assert.ok(evidencias.every((e) => e.pagina >= 1 && e.linha >= 1 && e.trecho.length > 0));
    assert.ok(q.fontes.some((f) => f.includes('OCR')));
    assert.ok(q.premissas.length >= 4);
    const outro = q.analise.find((x) => x.fornecedor.id === licitanteB);
    assert.equal(outro?.sinal, 'inconclusivo', 'licitante sem atestado lido');

    // A linha com CPF e telefone não vira menção, mas o texto bruto do OCR tem dado pessoal: o documento foi marcado como tal.
    const lista = await obterJson<ArquivosProcesso>(app, agente, `/api/v1/processos/${processo.id}/arquivos`);
    assert.ok(lista.itens.find((a) => a.id === arquivo.id)?.contemDadoPessoal);
    assert.equal(lista.ocrDisponivel, true);
  });

  test('download só pela API: anexo íntegro; documento com dado pessoal exige finalidade e registra o acesso (LGPD)', async () => {
    const { itens } = await obterJson<ArquivosProcesso>(app, agente, `/api/v1/processos/${processo.id}/arquivos`);
    const comum = itens.find((a) => !a.contemDadoPessoal);
    const pessoal = itens.find((a) => a.contemDadoPessoal);
    assert.ok(comum && pessoal);

    const baixado = await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${comum.id}/baixar`, {});
    assert.equal(baixado.statusCode, 200);
    assert.equal(baixado.headers['content-type'], 'application/pdf');
    assert.match(String(baixado.headers['content-disposition']), /^attachment; filename="atestado-a\.PNG\.pdf"; filename\*=UTF-8''/);
    assert.equal(sha256Hex(baixado.rawPayload), comum.sha256);

    const semFinalidade = await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${pessoal.id}/baixar`, {});
    assert.equal(semFinalidade.statusCode, 422);
    const comFinalidade = await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${pessoal.id}/baixar`, {
      finalidade: 'Conferência do atestado na análise de habilitação técnica',
    });
    assert.equal(comFinalidade.statusCode, 200);
    assert.equal(sha256Hex(comFinalidade.rawPayload), pessoal.sha256);

    const evento = (await eventosDaTrilha(app, 'lgpd.documento.acessar')).find((e) => (e.dados as { arquivoId?: string }).arquivoId === pessoal.id);
    assert.ok(evento, 'acesso a dado pessoal na trilha');
    assert.equal((evento.dados as { finalidade?: string }).finalidade, 'Conferência do atestado na análise de habilitação técnica');
    assert.ok((evento.dados as { registroAcessoId?: string }).registroAcessoId);
  });

  test('permissões e escopo: sem permissão → 403; fora da UASG → 404', async () => {
    const fiscal = await entrar(app, 'fiscal@agora.demo');
    assert.equal((await chamar(app, fiscal, 'GET', `/api/v1/processos/${processo.id}/arquivos`)).statusCode, 403);
    const juridico = await entrar(app, 'juridico@agora.demo');
    assert.equal((await chamar(app, juridico, 'GET', `/api/v1/processos/${processo.id}/arquivos`)).statusCode, 200);
    assert.equal((await enviar(app, juridico, processo.id, { categoria: 'processo', tipo: 'outro', titulo: 'Sem permissão' }, atestadoPdf(['x'.repeat(30)]))).statusCode, 403);
    const { itens } = await obterJson<ArquivosProcesso>(app, agente, `/api/v1/processos/${processo.id}/arquivos`);
    const atestado = itens[0];
    assert.ok(atestado);
    assert.equal((await chamar(app, juridico, 'POST', `/api/v1/processos/${processo.id}/arquivos/${atestado.id}/leitura`, {})).statusCode, 403);

    const admin = await entrar(app, 'admin@agora.demo');
    const criado = await chamar(app, admin, 'POST', '/api/v1/usuarios', {
      nome: 'Vera Escopo Restrito',
      email: 'restrito.documentos@agora.demo',
      cpf: gerarCpf(new Prng(1404)),
      perfis: ['agente_contratacao'],
      uasgs: ['910001'],
      unidadeInternaId: null,
    });
    assert.equal(criado.statusCode, 201, criado.body);
    const usuarioId = criado.json<UsuarioAdmin>().id;
    const temporaria = (await chamar(app, admin, 'POST', `/api/v1/usuarios/${usuarioId}/senha-temporaria`)).json<RespostaSenhaTemporaria>();
    const provisorio = await entrar(app, 'restrito.documentos@agora.demo', temporaria.senhaTemporaria);
    assert.equal((await chamar(app, provisorio, 'POST', '/api/v1/sessao/senha', { senhaAtual: temporaria.senhaTemporaria, novaSenha: 'Documentos-Escopo-2026' })).statusCode, 204);
    const restrito = await entrar(app, 'restrito.documentos@agora.demo', 'Documentos-Escopo-2026');
    assert.equal((await chamar(app, restrito, 'GET', `/api/v1/processos/${processo.id}/arquivos`)).statusCode, 404);
    assert.equal((await chamar(app, restrito, 'GET', `/api/v1/processos/${processo.id}/qualificacao-tecnica`)).statusCode, 404);
    assert.equal((await chamar(app, restrito, 'POST', `/api/v1/processos/${processo.id}/arquivos/${atestado.id}/baixar`, {})).statusCode, 404);
    assert.equal((await enviar(app, restrito, processo.id, { categoria: 'processo', tipo: 'outro', titulo: 'Fora do escopo' }, atestadoPdf(['y'.repeat(30)]))).statusCode, 404);
  });

  test('RN-25: exigências só até a etapa 4, recusando parcela abaixo de 4% e mínimo acima de 50%', async () => {
    const etapa4 = await processoNaEtapa(app, agente, 4);
    const total = etapa4.valorEstimado;
    assert.ok(total !== null && total > 0);
    const item = etapa4.dfd.itens[0];
    assert.ok(item);
    const parcela = { descricao: item.descricao.slice(0, 120), unidade: item.unidade, quantidadeObjeto: item.quantidade, valorEstimado: Math.round(total / 2), termos: [] };
    const acima = await chamar(app, agente, 'PUT', `/api/v1/processos/${etapa4.id}/qualificacao-tecnica`, { parcelas: [{ ...parcela, quantidadeMinima: item.quantidade }] });
    assert.equal(acima.statusCode, 422);
    assert.match(acima.body, /art\. 67, § 2º/);
    const irrelevante = await chamar(app, agente, 'PUT', `/api/v1/processos/${etapa4.id}/qualificacao-tecnica`, {
      parcelas: [{ ...parcela, valorEstimado: Math.max(1, Math.floor(total * 0.03)), quantidadeMinima: 1 }],
    });
    assert.equal(irrelevante.statusCode, 422);
    assert.match(irrelevante.body, /art\. 67, § 1º/);
    const metade = Math.floor(item.quantidade / 2);
    const ok = await chamar(app, agente, 'PUT', `/api/v1/processos/${etapa4.id}/qualificacao-tecnica`, { parcelas: [{ ...parcela, quantidadeMinima: metade, termos: ['drone'] }] });
    assert.equal(ok.statusCode, 200, ok.body);
    const q = ok.json<QualificacaoTecnica>();
    assert.equal(q.editavel, true);
    assert.equal(q.parcelas[0]?.quantidadeMinima, metade);
    assert.equal(q.parcelas[0]?.maiorRelevancia, true);
    assert.ok(q.definidaPor);

    const naEtapa6 = await chamar(app, agente, 'PUT', `/api/v1/processos/${processo.id}/qualificacao-tecnica`, { parcelas: [] });
    assert.equal(naEtapa6.statusCode, 422, 'edital já publicado');
    const juridico = await entrar(app, 'juridico@agora.demo');
    assert.equal((await chamar(app, juridico, 'PUT', `/api/v1/processos/${etapa4.id}/qualificacao-tecnica`, { parcelas: [] })).statusCode, 403);
  });

  test('balanço: exercícios exigíveis pelo art. 69, § 6º, a partir da data de constituição informada', async () => {
    const pdf = atestadoPdf(['Balanço patrimonial sintético do exercício para teste do art. 69 da Lei 14.133/2021.']);
    const r = await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'balanco_patrimonial', titulo: 'Balanço 2025', fornecedorId: licitanteB, exercicio: 2025, dataConstituicao: '2025-03-10' }, pdf);
    assert.equal(r.statusCode, 201, r.body);
    const q = await obterJson<QualificacaoTecnica>(app, agente, `/api/v1/processos/${processo.id}/qualificacao-tecnica`);
    const analise = q.analise.find((x) => x.fornecedor.id === licitanteB);
    assert.equal(analise?.balancos.exigidos, 1, 'constituída há menos de 2 anos');
    assert.equal(analise?.balancos.suficiente, true);
    assert.deepEqual(analise?.balancos.apresentados, [2025]);
  });
});

describe('leitura de atestado digitalizado sem serviço de OCR configurado', () => {
  test('a leitura informa que o OCR não está disponível, sem quebrar a análise', async () => {
    const app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000' } });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const processo = await processoNaEtapa(app, agente, 6);
      const licitante = processo.disputa.licitantes[0]?.id;
      assert.ok(licitante);
      const r = await enviar(app, agente, processo.id, { categoria: 'habilitacao', tipo: 'atestado_capacidade_tecnica', titulo: 'Atestado digitalizado', fornecedorId: licitante }, pdfDigitalizado(7));
      assert.equal(r.statusCode, 201, r.body);
      const lido = (await chamar(app, agente, 'POST', `/api/v1/processos/${processo.id}/arquivos/${r.json<ArquivoProcesso>().id}/leitura`, {})).json<ArquivoProcesso>();
      assert.equal(lido.leitura?.situacao, 'ocr_indisponivel');
      assert.match(lido.leitura?.mensagem ?? '', /AGORA_OCR_URL/);
      const q = await obterJson<QualificacaoTecnica>(app, agente, `/api/v1/processos/${processo.id}/qualificacao-tecnica`);
      assert.equal(q.analise.find((x) => x.fornecedor.id === licitante)?.sinal, 'inconclusivo');
    } finally {
      await app.close();
    }
  });
});

describe('antivírus (clamd por TCP, protocolo INSTREAM)', () => {
  let servidor: Server;
  let porta = 0;
  before(async () => {
    servidor = createServer((socket) => {
      let acumulado = Buffer.alloc(0);
      socket.on('data', (dados: Buffer) => {
        acumulado = Buffer.concat([acumulado, dados]);
        const comando = Buffer.from('zINSTREAM\0');
        if (acumulado.length < comando.length) return;
        let pos = comando.length;
        const conteudo: Buffer[] = [];
        for (;;) {
          if (acumulado.length < pos + 4) return;
          const tamanho = acumulado.readUInt32BE(pos);
          if (tamanho === 0) break;
          if (acumulado.length < pos + 4 + tamanho) return;
          conteudo.push(acumulado.subarray(pos + 4, pos + 4 + tamanho));
          pos += 4 + tamanho;
        }
        const infectado = Buffer.concat(conteudo).includes('ASSINATURA-DE-TESTE-AGORA');
        socket.end(infectado ? 'stream: Agora-Teste-Signature FOUND\0' : 'stream: OK\0');
      });
    });
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const endereco = servidor.address();
    porta = typeof endereco === 'object' && endereco !== null ? endereco.port : 0;
  });
  after(async () => {
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
  });

  test('cliente: arquivo limpo e arquivo com ameaça', async () => {
    assert.deepEqual(await verificarAntivirus(`tcp://127.0.0.1:${porta}`, Buffer.alloc(150_000, 7)), { limpo: true, assinatura: null });
    assert.deepEqual(await verificarAntivirus(`tcp://127.0.0.1:${porta}`, Buffer.from('xx ASSINATURA-DE-TESTE-AGORA xx')), { limpo: false, assinatura: 'Agora-Teste-Signature' });
  });

  test('envio: limpo é aceito e marcado; ameaça é recusada e auditada; antivírus fora do ar recusa (falha fechada)', async () => {
    const app = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000', AGORA_ANTIVIRUS_URL: `tcp://127.0.0.1:${porta}` } });
    try {
      const agente = await entrar(app, 'agente@agora.demo');
      const processo = await processoNaEtapa(app, agente, 6);
      const base = { categoria: 'processo' as const, tipo: 'documento_processo', titulo: 'Documento verificado' };
      const limpo = await enviar(app, agente, processo.id, base, atestadoPdf(['Documento sintético sem ameaça, enviado para verificação antivírus.']));
      assert.equal(limpo.statusCode, 201, limpo.body);
      assert.equal(limpo.json<ArquivoProcesso>().antivirus, 'limpo');
      // O marcador fica em comentário após o %%EOF: bytes visíveis ao clamd falso, PDF ainda válido.
      const comMarcador = Buffer.concat([atestadoPdf(['Documento sintético que simula uma ameaça detectada.']), Buffer.from('%ASSINATURA-DE-TESTE-AGORA', 'latin1')]);
      const ameaca = await enviar(app, agente, processo.id, base, comMarcador);
      assert.equal(ameaca.statusCode, 422);
      const trilha = await eventosDaTrilha(app, 'processo.arquivo.recusar_antivirus');
      assert.equal(trilha.length, 1);
      assert.equal((trilha[0]?.dados as { assinatura?: string }).assinatura, 'Agora-Teste-Signature');
    } finally {
      await app.close();
    }
    const foraDoAr = await criarAppTeste({ env: { AGORA_LIMITE_REQUISICOES_MINUTO: '100000', AGORA_ANTIVIRUS_URL: 'tcp://127.0.0.1:1' } });
    try {
      const agente = await entrar(foraDoAr, 'agente@agora.demo');
      const processo = await processoNaEtapa(foraDoAr, agente, 6);
      const r = await enviar(foraDoAr, agente, processo.id, { categoria: 'processo', tipo: 'outro', titulo: 'Sem antivírus' }, atestadoPdf(['Documento enviado com o antivírus fora do ar.']));
      assert.equal(r.statusCode, 503);
    } finally {
      await foraDoAr.close();
    }
  });
});

describe('armazenamento em disco endereçado pelo SHA-256', () => {
  test('grava uma vez, lê conferindo a integridade e detecta adulteração', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-arquivos-'));
    try {
      const armazenamento = criarArmazenamento(dir);
      assert.ok(armazenamento);
      const conteudo = Buffer.from('conteúdo sintético do documento');
      const hash = sha256Hex(conteudo);
      await armazenamento.gravar(hash, conteudo);
      await armazenamento.gravar(hash, conteudo);
      assert.deepEqual(await armazenamento.ler(hash), conteudo);
      const pasta = join(dir, 'sha256', hash.slice(0, 2), hash.slice(2, 4));
      assert.deepEqual(readdirSync(pasta), [hash], 'sem temporários e sem duplicata');
      assert.ok(statSync(join(pasta, hash)).isFile());
      writeFileSync(join(pasta, hash), 'adulterado');
      await assert.rejects(() => armazenamento.ler(hash), (e: unknown) => e instanceof ErroArmazenamento && e.motivo === 'corrompido');
      await assert.rejects(() => armazenamento.ler('0'.repeat(64)), (e: unknown) => e instanceof ErroArmazenamento && e.motivo === 'ausente');
      await assert.rejects(() => armazenamento.gravar(hash, Buffer.from('outro')), /não confere/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(criarArmazenamento(null), null);
  });
});
