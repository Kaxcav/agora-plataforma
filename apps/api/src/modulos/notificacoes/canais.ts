/**
 * Canais de envio da central de notificações (RF-26), sempre no servidor:
 * - e-mail: servidor SMTP do órgão (`AGORA_NOTIFICACOES_EMAIL=smtp` + `AGORA_SMTP_*`) ou driver simulado;
 * - SEI: web service do SEI do órgão (`AGORA_NOTIFICACOES_SEI=webservice` + `AGORA_SEI_*`): o aviso entra como documento
 *   no processo SEI do instrumento; sem a configuração, driver simulado;
 * - gov.br: interface pronta para a Caixa Postal/notificações do gov.br (pessoa física, por CPF); driver simulado.
 * O driver simulado não envia nada para fora: devolve um protocolo determinístico para acompanhar a situação.
 */
import type { CanalNotificacao, ModoCanalNotificacao, PapelDestinatario } from '@agora/contratos';
import { dataHoraSei, nivelAcessoSei } from '@agora/dominio';
import type { Config } from '../../config.ts';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { FalhaTarefa } from '../../fila/tipos.ts';
import type { FuncaoFetch } from '../../http/contexto.ts';
import { criarClienteSei } from '../../integracoes/sei.ts';
import { tarjarDadosPessoais } from '../publico/editais.ts';
import { enviarEmailSmtp, ErroSmtp } from './smtp.ts';

export interface MensagemCanal {
  envioId: string;
  canal: CanalNotificacao;
  papel: PapelDestinatario;
  destinatario: string;
  /** E-mail (canal email) ou número do processo SEI (canal sei). */
  endereco: string | null;
  /** Só no gov.br: lido do cadastro no momento do envio, nunca gravado na fila nem na trilha. */
  cpf: string | null;
  assunto: string;
  corpo: string;
  agora: Date;
}

export interface ResultadoCanal {
  modo: ModoCanalNotificacao;
  protocolo: string;
}

/** Falha de envio. Permanente = não adianta tentar de novo (endereço recusado, canal desligado). */
export class ErroEnvio extends Error {
  readonly permanente: boolean;
  constructor(mensagem: string, permanente = false, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroEnvio';
    this.permanente = permanente;
  }
}

export interface DriverCanal {
  canal: CanalNotificacao;
  modo: ModoCanalNotificacao;
  descricao: string;
  enviar(m: MensagemCanal): Promise<ResultadoCanal>;
}

export type DriversCanais = Record<CanalNotificacao, DriverCanal>;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function protocoloSimulado(prefixo: string, m: MensagemCanal): string {
  return `${prefixo}-${sha256Hex(`${m.envioId}|${m.canal}`).slice(0, 12).toUpperCase()}`;
}

function driverDesligado(canal: CanalNotificacao, variavel: string): DriverCanal {
  return {
    canal,
    modo: 'desligado',
    descricao: `Canal desligado pela configuração (${variavel}=desligado).`,
    enviar: () => Promise.reject(new ErroEnvio(`Canal desligado pela configuração do órgão (${variavel}=desligado).`, true)),
  };
}

/**
 * E-mail simulado: confere o endereço e devolve um Message-ID fictício. Domínios reservados `.invalid`
 * (RFC 2606) simulam a recusa do servidor de destino, para demonstrar falha e reenvio.
 */
export function driverEmailSimulado(): DriverCanal {
  return {
    canal: 'email',
    modo: 'simulado',
    descricao: 'Simulado: as mensagens são registradas, mas nada sai do servidor. Configure o SMTP do órgão para enviar de fato.',
    enviar: (m) => {
      if (m.endereco === null || !EMAIL.test(m.endereco)) return Promise.reject(new ErroEnvio('Destinatário sem e-mail válido.', true));
      if (/\.invalid$/i.test(m.endereco)) return Promise.reject(new ErroEnvio('550 Caixa postal inexistente (resposta simulada).', true));
      return Promise.resolve({ modo: 'simulado', protocolo: `<${protocoloSimulado('SIMULADO', m).toLowerCase()}@agora.simulado>` });
    },
  };
}

export function driverEmailSmtp(config: Config): DriverCanal {
  const smtp = config.notificacoes.smtp;
  if (!smtp) throw new Error('SMTP não configurado');
  return {
    canal: 'email',
    modo: 'smtp',
    descricao: `Servidor SMTP do órgão (${smtp.host}:${smtp.porta}, ${smtp.seguranca === 'nenhuma' ? 'sem criptografia' : smtp.seguranca.toUpperCase()}).`,
    enviar: async (m) => {
      if (m.endereco === null || !EMAIL.test(m.endereco)) throw new ErroEnvio('Destinatário sem e-mail válido.', true);
      try {
        const r = await enviarEmailSmtp(smtp, {
          para: m.endereco,
          nomeRemetente: `Ágora — ${config.orgao.sigla}`,
          assunto: m.assunto,
          texto: m.corpo,
          agora: m.agora,
        });
        return { modo: 'smtp', protocolo: r.idMensagem };
      } catch (erro) {
        if (erro instanceof ErroSmtp) throw new ErroEnvio(erro.message, erro.permanente, { cause: erro });
        throw erro;
      }
    },
  };
}

/**
 * SEI simulado. A integração real usa o web service do SEI (SOAP `SeiWS`, operação de inclusão de documento no
 * processo), com sigla do sistema e identificação do serviço cadastradas pelo administrador do SEI do órgão.
 */
export function driverSeiSimulado(): DriverCanal {
  return {
    canal: 'sei',
    modo: 'simulado',
    descricao: 'Simulado: registra o documento que seria incluído no processo SEI do instrumento. Para incluir de fato, configure o web service do SEI (AGORA_NOTIFICACOES_SEI=webservice).',
    enviar: (m) => {
      if (m.endereco === null || m.endereco.trim() === '') return Promise.reject(new ErroEnvio('O instrumento não tem processo SEI informado.', true));
      return Promise.resolve({ modo: 'simulado', protocolo: `${protocoloSimulado('SEI-SIM', m)} (processo ${m.endereco})` });
    },
  };
}

/**
 * SEI real (RF-35): o aviso vira um documento externo (PDF) incluído no processo SEI do instrumento pelo web service do
 * SEI (`incluirDocumento`). O protocolo do envio é o número do documento no SEI. Recusa do SEI (processo inexistente,
 * acesso negado) é falha permanente; indisponibilidade é temporária e segue as novas tentativas da central.
 */
export function driverSeiWebservice(config: Config, chamarFetch: FuncaoFetch): DriverCanal {
  const sei = config.sei;
  if (!sei.configurado || !sei.url || !sei.siglaSistema || !sei.identificacaoServico || !sei.idUnidade || !sei.idSerie) {
    throw new Error('Web service do SEI não configurado (AGORA_SEI_*)');
  }
  const cliente = criarClienteSei({
    url: sei.url,
    siglaSistema: sei.siglaSistema,
    identificacaoServico: sei.identificacaoServico,
    idUnidade: sei.idUnidade,
    fetch: chamarFetch,
    timeoutMs: sei.timeoutMs,
  });
  const idSerie = sei.idSerie;
  return {
    canal: 'sei',
    modo: 'webservice',
    descricao: `Web service do SEI do órgão: o aviso é incluído como documento no processo SEI do instrumento (unidade ${sei.idUnidade}).`,
    enviar: async (m) => {
      if (m.endereco === null || m.endereco.trim() === '') throw new ErroEnvio('O instrumento não tem processo SEI informado.', true);
      const texto = `${m.assunto} ${m.corpo}`;
      const pdf = gerarPdfTexto({ titulo: m.assunto, rodape: `Notificação da Ágora — ${config.orgao.sigla}`, conteudo: m.corpo });
      const nivel = nivelAcessoSei({ contemDadoPessoal: tarjarDadosPessoais(texto) !== texto, orcamentoSigiloso: false });
      try {
        const r = await cliente.incluirDocumento({
          protocoloProcedimento: m.endereco.trim(),
          idSerie,
          numero: `AVISO-${m.envioId.slice(0, 8).toUpperCase()}`,
          nomeArvore: 'Notificação da Ágora',
          data: dataHoraSei(m.agora).slice(0, 10),
          remetente: { sigla: config.orgao.sigla, nome: `${config.orgao.nome} — Ágora` },
          nomeArquivo: `notificacao-${m.envioId.slice(0, 8)}.pdf`,
          conteudo: pdf,
          nivelAcesso: nivel.nivel,
          idHipoteseLegal: sei.idHipoteseLegal,
          observacao: null,
        });
        return { modo: 'webservice', protocolo: `Documento SEI nº ${r.documentoFormatado} (processo ${m.endereco.trim()})` };
      } catch (erro) {
        if (erro instanceof FalhaTarefa) throw new ErroEnvio(erro.message, !erro.retentavel, { cause: erro });
        throw erro;
      }
    },
  };
}

/**
 * gov.br simulado. O gov.br oferece aos órgãos a Caixa Postal e as notificações do aplicativo gov.br para a
 * pessoa física identificada pelo CPF, mediante adesão; as credenciais entram por variáveis de ambiente quando houver.
 */
export function driverGovbrSimulado(): DriverCanal {
  return {
    canal: 'govbr',
    modo: 'simulado',
    descricao: 'Simulado: registra a mensagem que iria para a Caixa Postal do gov.br do servidor (por CPF). Depende de adesão do órgão ao serviço.',
    enviar: (m) => {
      if (m.cpf === null || !/^\d{11}$/.test(m.cpf)) return Promise.reject(new ErroEnvio('Destinatário sem CPF cadastrado para o gov.br.', true));
      return Promise.resolve({ modo: 'simulado', protocolo: protocoloSimulado('GOVBR-SIM', m) });
    },
  };
}

/** Drivers conforme a configuração (`sobrescrever` serve aos testes). */
export function criarDrivers(
  config: Config,
  sobrescrever: Partial<DriversCanais> = {},
  chamarFetch: FuncaoFetch = (entrada, init) => fetch(entrada, init),
): DriversCanais {
  const n = config.notificacoes;
  const sei = (): DriverCanal => {
    if (n.sei === 'desligado') return driverDesligado('sei', 'AGORA_NOTIFICACOES_SEI');
    return n.sei === 'webservice' ? driverSeiWebservice(config, chamarFetch) : driverSeiSimulado();
  };
  return {
    email: sobrescrever.email ?? (n.email === 'smtp' && n.smtp ? driverEmailSmtp(config) : driverEmailSimulado()),
    sei: sobrescrever.sei ?? sei(),
    govbr: sobrescrever.govbr ?? (n.govbr === 'desligado' ? driverDesligado('govbr', 'AGORA_NOTIFICACOES_GOVBR') : driverGovbrSimulado()),
  };
}
