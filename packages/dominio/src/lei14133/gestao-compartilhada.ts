/**
 * Gestão compartilhada com a sociedade (Lei 14.133/2021, art. 174, § 3º, VI): mensagens e imagens do interessado
 * previamente identificado, acompanhamento da execução com imagem e vídeo (art. 19, III), comunicação entre a
 * população, a Administração e o contratado, e relatório final da consecução dos objetivos da contratação.
 * Funções puras: "hoje" entra como parâmetro; nada aqui publica, recusa ou responde por conta própria — a moderação,
 * as respostas e o relatório são atos humanos registrados pela API.
 */
import { adicionarDias, diasEntre, validarDataISO, type DataISO } from '../datas.ts';
import { mascararNome } from '../documentos.ts';
import { ErroDominio } from '../erros.ts';
import { tarjarDadosPessoaisLivres } from '../privacidade.ts';

export const FUNDAMENTO_GESTAO_COMPARTILHADA = 'Lei 14.133/2021, art. 174, § 3º, VI';
/** Prazo de resposta às manifestações: 30 dias, prorrogável uma vez por igual período, com justificativa. */
export const PRAZO_RESPOSTA_MANIFESTACAO_DIAS = 30;
export const FUNDAMENTO_PRAZO_RESPOSTA = 'Lei 13.460/2017, art. 16';
/** A manifestação passa a contar como "vence em breve" nos últimos 5 dias do prazo. */
export const DIAS_ALERTA_PRAZO_RESPOSTA = 5;

export const LIMITES_GESTAO_COMPARTILHADA = Object.freeze({
  textoMinimo: 20,
  textoMaximo: 2000,
  motivoMinimo: 10,
  motivoMaximo: 500,
  respostaMinima: 20,
  respostaMaxima: 4000,
  relatorioMinimo: 100,
  relatorioMaximo: 8000,
});

export const ASSUNTOS_MANIFESTACAO = ['execucao', 'qualidade', 'prazo', 'atendimento', 'outro'] as const;
export type AssuntoManifestacao = (typeof ASSUNTOS_MANIFESTACAO)[number];

export type DecisaoModeracao = 'publicar' | 'recusar';
export type OrigemResposta = 'administracao' | 'contratado';
export const CONCLUSOES_RELATORIO_FINAL = ['atingidos', 'parcialmente_atingidos', 'nao_atingidos'] as const;
export type ConclusaoRelatorioFinal = (typeof CONCLUSOES_RELATORIO_FINAL)[number];

/** Remove caracteres de controle (exceto quebra de linha e tabulação), uniformiza quebras e apara as pontas. */
function normalizarTexto(texto: unknown): string {
  if (typeof texto !== 'string') return '';
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function exigirTamanho(texto: string, minimo: number, maximo: number, codigo: string, rotulo: string): void {
  if (texto.length < minimo) throw new ErroDominio(codigo, `${rotulo} deve ter pelo menos ${minimo} caracteres.`);
  if (texto.length > maximo) throw new ErroDominio(codigo, `${rotulo} deve ter no máximo ${maximo} caracteres.`);
}

function exigirData(d: DataISO, rotulo: string): void {
  if (typeof d !== 'string' || !validarDataISO(d)) throw new ErroDominio('DATA_INVALIDA', `${rotulo}: data inválida (use AAAA-MM-DD).`);
}

export interface ManifestacaoValidada {
  texto: string;
  /** Texto que vai a público: CPF, e-mail e telefone tarjados (LGPD). O original fica só para a moderação. */
  textoPublico: string;
  /** true quando a tarja alterou o texto (a moderação vê o aviso). */
  dadosPessoaisTarjados: boolean;
}

/**
 * Confere a mensagem do interessado identificado (art. 174, § 3º, VI, "a"): de 20 a 2.000 caracteres, sem
 * caracteres de controle, e prepara a versão pública com os dados pessoais tarjados.
 */
export function validarManifestacao(texto: string): ManifestacaoValidada {
  const normalizado = normalizarTexto(texto);
  exigirTamanho(normalizado, LIMITES_GESTAO_COMPARTILHADA.textoMinimo, LIMITES_GESTAO_COMPARTILHADA.textoMaximo, 'MANIFESTACAO_INVALIDA', 'A mensagem');
  const textoPublico = tarjarDadosPessoaisLivres(normalizado);
  return { texto: normalizado, textoPublico, dadosPessoaisTarjados: textoPublico !== normalizado };
}

/**
 * Decisão da moderação: publicar ou recusar, sempre com motivo (10 a 500 caracteres), que fica na trilha de
 * auditoria e é mostrado ao autor. A publicação depende desta decisão humana; nada é publicado automaticamente.
 */
export function validarDecisaoModeracao(entrada: { decisao: DecisaoModeracao; motivo: string; situacaoAtual: string }): { decisao: DecisaoModeracao; motivo: string } {
  if (entrada.decisao !== 'publicar' && entrada.decisao !== 'recusar') throw new ErroDominio('MODERACAO_INVALIDA', 'Escolha publicar ou recusar.');
  if (entrada.situacaoAtual !== 'em_moderacao') throw new ErroDominio('MODERACAO_ENCERRADA', 'Esta manifestação já foi moderada.');
  const motivo = normalizarTexto(entrada.motivo);
  exigirTamanho(motivo, LIMITES_GESTAO_COMPARTILHADA.motivoMinimo, LIMITES_GESTAO_COMPARTILHADA.motivoMaximo, 'MOTIVO_MODERACAO', 'O motivo da decisão');
  return { decisao: entrada.decisao, motivo };
}

/** Nome do autor para exibição pública: primeiro nome e iniciais ("Maria G. S."), nunca o nome completo. */
export function nomePublicoCidadao(nome: string): string {
  try {
    return mascararNome(nome);
  } catch {
    return 'Cidadão identificado';
  }
}

/**
 * Prazo para a Administração responder à manifestação publicada: 30 dias corridos contados do recebimento,
 * prorrogável uma única vez por igual período, de forma justificada (Lei 13.460/2017, art. 16, aplicada por
 * analogia ao canal de comunicação do art. 174, § 3º, VI, "c", que não fixa prazo próprio).
 */
export function prazoRespostaManifestacao(recebidaEm: DataISO, prorrogada = false): DataISO {
  exigirData(recebidaEm, 'Data de recebimento');
  return adicionarDias(recebidaEm, PRAZO_RESPOSTA_MANIFESTACAO_DIAS * (prorrogada ? 2 : 1));
}

export type SituacaoPrazoResposta = 'aguardando' | 'vence_em_breve' | 'vencido' | 'respondida_no_prazo' | 'respondida_fora_do_prazo';

/** Situação do prazo de resposta: respondida (no prazo ou não) pela data da primeira resposta da Administração. */
export function situacaoPrazoResposta(entrada: { prazo: DataISO; respondidaEm: DataISO | null; hoje: DataISO }): {
  situacao: SituacaoPrazoResposta;
  diasRestantes: number | null;
  fundamento: string;
} {
  exigirData(entrada.prazo, 'Prazo');
  exigirData(entrada.hoje, 'Hoje');
  if (entrada.respondidaEm !== null) {
    exigirData(entrada.respondidaEm, 'Data da resposta');
    const noPrazo = entrada.respondidaEm <= entrada.prazo;
    return { situacao: noPrazo ? 'respondida_no_prazo' : 'respondida_fora_do_prazo', diasRestantes: null, fundamento: FUNDAMENTO_PRAZO_RESPOSTA };
  }
  const restantes = diasEntre(entrada.hoje, entrada.prazo);
  if (restantes < 0) return { situacao: 'vencido', diasRestantes: restantes, fundamento: FUNDAMENTO_PRAZO_RESPOSTA };
  const situacao = restantes <= DIAS_ALERTA_PRAZO_RESPOSTA ? 'vence_em_breve' : 'aguardando';
  return { situacao, diasRestantes: restantes, fundamento: FUNDAMENTO_PRAZO_RESPOSTA };
}

/**
 * Resposta identificada (art. 174, § 3º, VI, "c"): da Administração, por servidor com a sua função, ou do
 * contratado, registrada pela Administração com o nome do preposto (art. 118) que a enviou. Texto de 20 a 4.000
 * caracteres; a versão pública sai com os dados pessoais tarjados.
 */
export function validarResposta(entrada: { origem: OrigemResposta; texto: string; representante: string | null; situacaoManifestacao: string }): {
  origem: OrigemResposta;
  texto: string;
  textoPublico: string;
  representante: string | null;
} {
  if (entrada.origem !== 'administracao' && entrada.origem !== 'contratado') throw new ErroDominio('RESPOSTA_INVALIDA', 'Indique quem responde: a Administração ou o contratado.');
  if (entrada.situacaoManifestacao !== 'publicada') throw new ErroDominio('MANIFESTACAO_NAO_PUBLICADA', 'Só se responde no canal público a manifestação já publicada pela moderação.');
  const texto = normalizarTexto(entrada.texto);
  exigirTamanho(texto, LIMITES_GESTAO_COMPARTILHADA.respostaMinima, LIMITES_GESTAO_COMPARTILHADA.respostaMaxima, 'RESPOSTA_INVALIDA', 'A resposta');
  const representante = normalizarTexto(entrada.representante ?? '');
  if (entrada.origem === 'contratado' && representante.length < 3) {
    throw new ErroDominio('REPRESENTANTE_OBRIGATORIO', 'Informe o nome do preposto do contratado que enviou a resposta (art. 118).');
  }
  if (representante.length > 120) throw new ErroDominio('REPRESENTANTE_OBRIGATORIO', 'O nome do representante deve ter no máximo 120 caracteres.');
  return {
    origem: entrada.origem,
    texto,
    textoPublico: tarjarDadosPessoaisLivres(texto),
    representante: entrada.origem === 'contratado' ? representante : null,
  };
}

/**
 * Ponto de checagem do sigilo antes de publicar um registro da execução (art. 13 e art. 19, III): registro marcado
 * como sigiloso (por quem o enviou ou pela classificação do documento, quando houver) fica guardado e não vai a
 * público. A classificação formal de sigilo, quando existir, entra em `classificacaoSigilosa`.
 */
export function avaliarPublicacaoRegistroExecucao(entrada: { declaradoSigiloso: boolean; classificacaoSigilosa: boolean }): {
  publicavel: boolean;
  motivo: string | null;
  fundamento: string;
} {
  const fundamento = 'Lei 14.133/2021, art. 13, e art. 19, III; Lei 12.527/2011, art. 23';
  if (entrada.classificacaoSigilosa) {
    return { publicavel: false, motivo: 'O documento está classificado como sigiloso e não pode ser divulgado.', fundamento };
  }
  if (entrada.declaradoSigiloso) {
    return { publicavel: false, motivo: 'O registro foi marcado como contendo elemento sigiloso imprescindível à segurança da sociedade e do Estado.', fundamento };
  }
  return { publicavel: true, motivo: null, fundamento };
}

/**
 * Relatório final com informações sobre a consecução dos objetivos que justificaram a contratação
 * (art. 174, § 3º, VI, "d"): só depois do fim da vigência do contrato, com os objetivos, os resultados alcançados
 * e a conclusão escritos pelo gestor (100 a 8.000 caracteres cada texto).
 */
export function validarRelatorioFinal(entrada: {
  vigenciaFim: DataISO;
  hoje: DataISO;
  objetivos: string;
  resultados: string;
  conclusao: ConclusaoRelatorioFinal;
}): { objetivos: string; resultados: string; conclusao: ConclusaoRelatorioFinal; fundamento: string } {
  exigirData(entrada.vigenciaFim, 'Fim da vigência');
  exigirData(entrada.hoje, 'Hoje');
  if (entrada.hoje < entrada.vigenciaFim) {
    throw new ErroDominio('CONTRATO_EM_EXECUCAO', 'O relatório final é publicado ao final do contrato: a vigência ainda não terminou.');
  }
  if (!CONCLUSOES_RELATORIO_FINAL.includes(entrada.conclusao)) throw new ErroDominio('CONCLUSAO_INVALIDA', 'Indique se os objetivos foram atingidos, parcialmente atingidos ou não atingidos.');
  const objetivos = normalizarTexto(entrada.objetivos);
  const resultados = normalizarTexto(entrada.resultados);
  const { relatorioMinimo, relatorioMaximo } = LIMITES_GESTAO_COMPARTILHADA;
  exigirTamanho(objetivos, relatorioMinimo, relatorioMaximo, 'RELATORIO_INVALIDO', 'Os objetivos que justificaram a contratação');
  exigirTamanho(resultados, relatorioMinimo, relatorioMaximo, 'RELATORIO_INVALIDO', 'Os resultados alcançados');
  return {
    objetivos: tarjarDadosPessoaisLivres(objetivos),
    resultados: tarjarDadosPessoaisLivres(resultados),
    conclusao: entrada.conclusao,
    fundamento: 'Lei 14.133/2021, art. 174, § 3º, VI, "d"',
  };
}
