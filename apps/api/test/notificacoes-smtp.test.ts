import assert from 'node:assert/strict';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { after, before, describe, test } from 'node:test';
import type { NotificacaoDetalhe } from '@agora/contratos';
import { carregarConfig, ErroConfiguracao, type ConfigSmtp } from '../src/config.ts';
import { codificarCabecalho, enviarEmailSmtp, ErroSmtp } from '../src/modulos/notificacoes/smtp.ts';
import { chamar, criarAppTeste, entrar } from './apoio.ts';

interface Sessao {
  comandos: string[];
  dados: string;
}

/** Responde a um comando e devolve true; false deixa a resposta padrão. */
type Roteiro = (comando: string, responder: (linha: string) => void) => boolean;

/** Servidor SMTP falso (porta local efêmera) que registra o diálogo; nada sai da máquina. */
function servidorFalso(roteiro: Roteiro = () => false, saudacao: string | null = '220 smtp.teste ESMTP') {
  const sessoes: Sessao[] = [];
  const servidor: Server = createServer((socket: Socket) => {
    const sessao: Sessao = { comandos: [], dados: '' };
    sessoes.push(sessao);
    let buffer = '';
    let emDados = false;
    const responder = (linha: string) => {
      if (!socket.destroyed) socket.write(`${linha}\r\n`);
    };
    socket.on('error', () => undefined);
    if (saudacao) responder(saudacao);
    socket.on('data', (pedaco) => {
      buffer += pedaco.toString('utf8');
      for (;;) {
        if (emDados) {
          const fim = buffer.indexOf('\r\n.\r\n');
          if (fim < 0) return;
          sessao.dados = buffer.slice(0, fim);
          buffer = buffer.slice(fim + 5);
          emDados = false;
          responder('250 2.0.0 Ok: enfileirada');
          continue;
        }
        const quebra = buffer.indexOf('\r\n');
        if (quebra < 0) return;
        const comando = buffer.slice(0, quebra);
        buffer = buffer.slice(quebra + 2);
        sessao.comandos.push(comando);
        if (roteiro(comando, responder)) continue;
        if (/^EHLO/i.test(comando)) responder('250-smtp.teste\r\n250-AUTH LOGIN\r\n250 8BITMIME');
        else if (/^AUTH LOGIN/i.test(comando)) responder('334 VXNlcm5hbWU6');
        else if (/^MAIL FROM/i.test(comando)) responder('250 2.1.0 Ok');
        else if (/^RCPT TO/i.test(comando)) responder('250 2.1.5 Ok');
        else if (/^DATA/i.test(comando)) {
          responder('354 Fim com <CRLF>.<CRLF>');
          emDados = true;
        } else if (/^QUIT/i.test(comando)) {
          responder('221 Até logo');
          socket.end();
        }
      }
    });
  });
  return {
    sessoes,
    abrir: () => new Promise<number>((resolver) => servidor.listen(0, '127.0.0.1', () => resolver((servidor.address() as AddressInfo).port))),
    fechar: () => new Promise<void>((resolver) => servidor.close(() => resolver())),
  };
}

function configSmtp(porta: number, extra: Partial<ConfigSmtp> = {}): ConfigSmtp {
  return { host: '127.0.0.1', porta, seguranca: 'nenhuma', usuario: null, senha: null, remetente: 'nao-responda@orgao.gov.br', timeoutMs: 2000, ...extra };
}

const MENSAGEM = {
  para: 'fiscal.teste@orgao.gov.br',
  nomeRemetente: 'Ágora — MJSP',
  assunto: 'Contrato 12/2026: vigência termina em 120 dias (faixa de 120 dias)',
  texto: 'Aviso de vencimento da vigência — Contrato 12/2026\n\nProvidência sugerida: avaliar a prorrogação.',
  agora: new Date('2026-11-09T13:00:00.000Z'),
};

describe('cliente SMTP do órgão (sem dependências externas)', () => {
  test('diálogo completo: EHLO, MAIL FROM, RCPT TO e DATA com assunto RFC 2047 e corpo UTF-8 em base64', async () => {
    const falso = servidorFalso();
    const porta = await falso.abrir();
    try {
      const r = await enviarEmailSmtp(configSmtp(porta), MENSAGEM);
      assert.match(r.idMensagem, /^<[0-9a-f-]{36}@orgao\.gov\.br>$/);
      assert.match(r.resposta, /^250/);
      const sessao = falso.sessoes[0];
      assert.ok(sessao);
      assert.deepEqual(sessao.comandos.slice(0, 4), ['EHLO orgao.gov.br', 'MAIL FROM:<nao-responda@orgao.gov.br>', 'RCPT TO:<fiscal.teste@orgao.gov.br>', 'DATA']);
      assert.match(sessao.dados, /^From: =\?UTF-8\?B\?.+\?= <nao-responda@orgao\.gov\.br>\r\n/);
      assert.match(sessao.dados, /\r\nSubject: Contrato 12\/2026: vigência|\r\nSubject: =\?UTF-8\?B\?/);
      assert.match(sessao.dados, /\r\nDate: Mon, 09 Nov 2026 13:00:00 \+0000\r\n/);
      assert.match(sessao.dados, /\r\nContent-Transfer-Encoding: base64\r\n/);
      assert.match(sessao.dados, /\r\nAuto-Submitted: auto-generated\r\n/);
      const corpo = sessao.dados.split('\r\n\r\n')[1] ?? '';
      assert.equal(Buffer.from(corpo.replace(/\r\n/g, ''), 'base64').toString('utf8'), MENSAGEM.texto.replace(/\n/g, '\r\n'));
    } finally {
      await falso.fechar();
    }
  });

  test('assunto com acentos vira palavras codificadas de até 75 caracteres, sem quebra de linha injetada', () => {
    const cabecalho = codificarCabecalho('Notificação de ocorrência na execução do contrato — prazo\r\nBcc: intruso@x.com');
    assert.ok(cabecalho.split('\r\n ').every((p) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(p) && p.length <= 75));
    const decodificado = cabecalho
      .split('\r\n ')
      .map((p) => Buffer.from(p.slice(10, -2), 'base64').toString('utf8'))
      .join('');
    assert.equal(decodificado, 'Notificação de ocorrência na execução do contrato — prazo Bcc: intruso@x.com');
    assert.equal(codificarCabecalho('Assunto simples'), 'Assunto simples');
  });

  test('AUTH LOGIN quando é o único mecanismo oferecido', async () => {
    let etapa = 0;
    const falso = servidorFalso((comando, responder) => {
      if (comando === 'AUTH LOGIN') {
        etapa = 1;
        responder('334 VXNlcm5hbWU6');
      } else if (etapa === 1) {
        etapa = 2;
        responder('334 UGFzc3dvcmQ6');
      } else if (etapa === 2) {
        etapa = 3;
        responder('235 2.7.0 Autenticado');
      } else return false;
      return true;
    });
    const porta = await falso.abrir();
    try {
      await enviarEmailSmtp(configSmtp(porta, { usuario: 'agora', senha: 'segredo' }), MENSAGEM);
      const comandos = falso.sessoes[0]?.comandos ?? [];
      assert.equal(comandos[1], 'AUTH LOGIN');
      assert.equal(Buffer.from(comandos[2] ?? '', 'base64').toString(), 'agora');
      assert.equal(Buffer.from(comandos[3] ?? '', 'base64').toString(), 'segredo');
      assert.equal(comandos[4], 'MAIL FROM:<nao-responda@orgao.gov.br>');
    } finally {
      await falso.fechar();
    }
  });

  test('5xx é falha permanente; 4xx é temporária; STARTTLS exigido e ausente é permanente', async () => {
    const recusa = servidorFalso((comando, responder) => {
      if (!/^RCPT/.test(comando)) return false;
      responder('550 5.1.1 <fiscal.teste@orgao.gov.br> inexistente');
      return true;
    });
    const porta = await recusa.abrir();
    try {
      await assert.rejects(enviarEmailSmtp(configSmtp(porta), MENSAGEM), (e: unknown) => e instanceof ErroSmtp && e.permanente && e.codigo === 550);
      const temporario = servidorFalso((comando, responder) => {
        if (!/^RCPT/.test(comando)) return false;
        responder('451 4.3.0 Tente mais tarde');
        return true;
      });
      const portaTemporaria = await temporario.abrir();
      try {
        await assert.rejects(enviarEmailSmtp(configSmtp(portaTemporaria), MENSAGEM), (e: unknown) => e instanceof ErroSmtp && !e.permanente && e.codigo === 451);
      } finally {
        await temporario.fechar();
      }
      await assert.rejects(
        enviarEmailSmtp(configSmtp(porta, { seguranca: 'starttls' }), MENSAGEM),
        (e: unknown) => e instanceof ErroSmtp && e.permanente && /STARTTLS/.test(e.message),
      );
    } finally {
      await recusa.fechar();
    }
  });

  test('servidor mudo: falha por tempo esgotado', async () => {
    const mudo = servidorFalso(() => false, null);
    const porta = await mudo.abrir();
    try {
      await assert.rejects(enviarEmailSmtp(configSmtp(porta, { timeoutMs: 300 }), MENSAGEM), (e: unknown) => e instanceof ErroSmtp && /não respondeu/.test(e.message));
    } finally {
      await mudo.fechar();
    }
  });
});

describe('configuração AGORA_NOTIFICACOES_* e AGORA_SMTP_*', () => {
  test('padrão: e-mail, SEI e gov.br simulados; agendador no processo da API', () => {
    const c = carregarConfig({});
    assert.deepEqual(c.notificacoes, { agendador: 'api', email: 'simulado', sei: 'simulado', govbr: 'simulado', smtp: null });
    // docker-compose repassa "" para variáveis ausentes do .env
    assert.deepEqual(carregarConfig({ AGORA_SMTP_PORTA: '', AGORA_SMTP_TIMEOUT_MS: '', AGORA_SMTP_HOST: '' }).notificacoes.smtp, null);
  });

  test('SMTP: exige host e remetente; credenciais juntas e só com TLS; porta padrão pela segurança', () => {
    assert.throws(() => carregarConfig({ AGORA_NOTIFICACOES_EMAIL: 'smtp' }), (e: unknown) => e instanceof ErroConfiguracao && e.problemas.length === 2);
    assert.throws(
      () =>
        carregarConfig({
          AGORA_NOTIFICACOES_EMAIL: 'smtp',
          AGORA_SMTP_HOST: 'smtp.orgao.gov.br',
          AGORA_SMTP_REMETENTE: 'nao-responda@orgao.gov.br',
          AGORA_SMTP_SEGURANCA: 'nenhuma',
          AGORA_SMTP_USUARIO: 'agora',
          AGORA_SMTP_SENHA: 'x',
        }),
      (e: unknown) => e instanceof ErroConfiguracao && e.problemas.some((p) => p.includes('exigem tls ou starttls')),
    );
    const c = carregarConfig({ AGORA_NOTIFICACOES_EMAIL: 'smtp', AGORA_SMTP_HOST: 'smtp.orgao.gov.br', AGORA_SMTP_REMETENTE: 'nao-responda@orgao.gov.br' });
    assert.equal(c.notificacoes.smtp?.porta, 587);
    assert.equal(c.notificacoes.smtp?.seguranca, 'starttls');
    assert.equal(carregarConfig({ AGORA_NOTIFICACOES_EMAIL: 'smtp', AGORA_SMTP_HOST: 'h', AGORA_SMTP_REMETENTE: 'a@b.gov.br', AGORA_SMTP_SEGURANCA: 'tls' }).notificacoes.smtp?.porta, 465);
  });
});

describe('disparo pela API com o SMTP do órgão (servidor falso local)', () => {
  const falso = servidorFalso();
  let porta = 0;

  before(async () => {
    porta = await falso.abrir();
  });

  after(async () => {
    await falso.fechar();
  });

  test('o aviso manual sai pelo SMTP configurado e o envio registra o Message-ID', async () => {
    const app = await criarAppTeste({
      env: {
        AGORA_NOTIFICACOES_AGENDADOR: 'externo',
        AGORA_NOTIFICACOES_EMAIL: 'smtp',
        AGORA_SMTP_HOST: '127.0.0.1',
        AGORA_SMTP_PORTA: String(porta),
        AGORA_SMTP_SEGURANCA: 'nenhuma',
        AGORA_SMTP_REMETENTE: 'nao-responda@orgao.gov.br',
      },
    });
    try {
      const gestor = await entrar(app, 'gestor@agora.demo');
      const [c] = await app.agora.banco.consultar<{ id: string; fiscal_email: string }>(
        `SELECT c.id, u.email AS fiscal_email FROM contratos c JOIN usuarios u ON u.id = c.fiscal_id
          WHERE c.vigencia_fim >= $1 ORDER BY c.numero LIMIT 1`,
        [app.agora.hoje()],
      );
      assert.ok(c);
      const r = await chamar(app, gestor, 'POST', '/api/v1/notificacoes', {
        instrumentoTipo: 'contrato',
        instrumentoId: c.id,
        tipo: 'vencimento',
        destinatarios: ['fiscal'],
        canais: ['email'],
      });
      assert.equal(r.statusCode, 201, r.body);
      const envio = r.json<NotificacaoDetalhe>().envios[0];
      assert.equal(envio?.situacao, 'enviado');
      assert.equal(envio?.modo, 'smtp');
      assert.match(envio?.protocolo ?? '', /@orgao\.gov\.br>$/);
      const sessao = falso.sessoes.at(-1);
      assert.ok(sessao?.comandos.includes(`RCPT TO:<${c.fiscal_email}>`));
      assert.ok(sessao?.dados.includes(`Message-ID: ${envio?.protocolo ?? ''}`));
    } finally {
      await app.close();
    }
  });
});
