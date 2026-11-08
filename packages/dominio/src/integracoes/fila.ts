/**
 * Política da fila de integrações (RNF-07): novas tentativas com espera exponencial e limite, fila de erro
 * (dead letter) e chave de idempotência. Atende ao requisito de resiliência do barramento PNCP (RNF-04 do
 * caderno do cliente): absorver as janelas de manutenção do PNCP sem perder transações, com reenvio automático.
 * Funções puras: o relógio e o transporte (RabbitMQ ou Postgres) ficam na API.
 */
import { ErroDominio } from '../erros.ts';

export interface PoliticaNovasTentativas {
  /** Total de execuções permitidas, contando a primeira (mínimo 1). */
  maximoTentativas: number;
  /** Espera antes da 2ª execução, em ms; dobra a cada nova falha. */
  esperaBaseMs: number;
  /** Teto da espera entre duas execuções, em ms. */
  esperaMaximaMs: number;
}

/**
 * Política padrão: 10 execuções, começando em 30 s e dobrando até o teto de 1 h. Somadas, as esperas cobrem
 * cerca de 3 horas — o suficiente para atravessar uma janela usual de manutenção do PNCP.
 */
export const POLITICA_PADRAO_FILA: Readonly<PoliticaNovasTentativas> = Object.freeze({
  maximoTentativas: 10,
  esperaBaseMs: 30_000,
  esperaMaximaMs: 3_600_000,
});

/** Valida a política (valores inteiros e coerentes); lança `ErroDominio('POLITICA_FILA_INVALIDA')`. */
export function validarPoliticaNovasTentativas(p: PoliticaNovasTentativas): PoliticaNovasTentativas {
  const inteiro = (v: number) => Number.isSafeInteger(v);
  if (!inteiro(p.maximoTentativas) || p.maximoTentativas < 1 || p.maximoTentativas > 100) {
    throw new ErroDominio('POLITICA_FILA_INVALIDA', 'O máximo de tentativas deve ser um inteiro de 1 a 100.');
  }
  if (!inteiro(p.esperaBaseMs) || p.esperaBaseMs < 0) {
    throw new ErroDominio('POLITICA_FILA_INVALIDA', 'A espera base deve ser um inteiro não negativo, em milissegundos.');
  }
  if (!inteiro(p.esperaMaximaMs) || p.esperaMaximaMs < p.esperaBaseMs) {
    throw new ErroDominio('POLITICA_FILA_INVALIDA', 'A espera máxima deve ser um inteiro maior ou igual à espera base.');
  }
  return p;
}

/**
 * Espera antes da próxima execução, depois de `tentativasRealizadas` execuções sem sucesso:
 * `esperaBaseMs × 2^(tentativasRealizadas − 1)`, limitada a `esperaMaximaMs` (espera exponencial com teto).
 * Determinística: sem sorteio, para que o agendamento possa ser reproduzido e auditado.
 */
export function esperaNovaTentativa(tentativasRealizadas: number, politica: PoliticaNovasTentativas): number {
  validarPoliticaNovasTentativas(politica);
  if (!Number.isSafeInteger(tentativasRealizadas) || tentativasRealizadas < 1) {
    throw new ErroDominio('TENTATIVA_INVALIDA', 'Informe quantas execuções já foram feitas (inteiro a partir de 1).');
  }
  // 2^31 já supera qualquer teto razoável; o expoente é limitado para não estourar a precisão.
  const fator = 2 ** Math.min(tentativasRealizadas - 1, 31);
  return Math.min(politica.esperaBaseMs * fator, politica.esperaMaximaMs);
}

export type DestinoFalha =
  | { destino: 'nova_tentativa'; esperaMs: number; proximaTentativa: number; explicacao: string }
  | { destino: 'fila_erro'; motivo: 'falha_definitiva' | 'limite_tentativas'; explicacao: string };

/**
 * Decide o que fazer com uma tarefa que falhou: agendar nova tentativa (falha transitória e limite não atingido)
 * ou mandar para a fila de erro, onde aguarda reprocessamento manual auditado. Falhas definitivas (ex.: dados
 * recusados pelo PNCP com HTTP 4xx) não são repetidas, porque repetir não mudaria o resultado.
 */
export function decidirDestinoFalha(p: { tentativasRealizadas: number; retentavel: boolean; politica: PoliticaNovasTentativas }): DestinoFalha {
  validarPoliticaNovasTentativas(p.politica);
  if (!Number.isSafeInteger(p.tentativasRealizadas) || p.tentativasRealizadas < 1) {
    throw new ErroDominio('TENTATIVA_INVALIDA', 'Informe quantas execuções já foram feitas (inteiro a partir de 1).');
  }
  if (!p.retentavel) {
    return {
      destino: 'fila_erro',
      motivo: 'falha_definitiva',
      explicacao: 'Falha definitiva: a resposta não muda com nova tentativa. A tarefa vai para a fila de erro e aguarda correção e reprocessamento.',
    };
  }
  if (p.tentativasRealizadas >= p.politica.maximoTentativas) {
    return {
      destino: 'fila_erro',
      motivo: 'limite_tentativas',
      explicacao: `Limite de ${p.politica.maximoTentativas} tentativas atingido. A tarefa vai para a fila de erro e aguarda reprocessamento.`,
    };
  }
  const esperaMs = esperaNovaTentativa(p.tentativasRealizadas, p.politica);
  return {
    destino: 'nova_tentativa',
    esperaMs,
    proximaTentativa: p.tentativasRealizadas + 1,
    explicacao: `Falha transitória: nova tentativa (${p.tentativasRealizadas + 1} de ${p.politica.maximoTentativas}) em ${Math.round(esperaMs / 1000)} s.`,
  };
}

export type NaturezaRespostaHttp = 'sucesso' | 'reautenticar' | 'nova_tentativa' | 'definitiva';

/**
 * Classifica a resposta HTTP de um serviço externo para a fila: 2xx é sucesso; 401 pede novo login (token
 * expirado); 408, 425, 429 e 5xx são transitórios (indisponibilidade, limite de requisições, manutenção) e
 * geram nova tentativa; os demais 3xx e 4xx são definitivos (dados recusados, sem permissão, recurso inexistente).
 */
export function classificarRespostaHttp(status: number): NaturezaRespostaHttp {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new ErroDominio('STATUS_HTTP_INVALIDO', `Código HTTP inválido: ${String(status)}.`);
  }
  if (status >= 200 && status < 300) return 'sucesso';
  if (status === 401) return 'reautenticar';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'nova_tentativa';
  return 'definitiva';
}

/**
 * Chave de idempotência de uma tarefa a partir das partes que a identificam (ex.: `['pncp', 'compra', id]`).
 * A mesma operação sobre o mesmo recurso sempre gera a mesma chave, e a fila recusa a duplicata: o edital não é
 * publicado duas vezes, ainda que o pedido seja repetido.
 */
export function chaveIdempotencia(partes: readonly (string | number)[]): string {
  if (!Array.isArray(partes) || partes.length < 2) {
    throw new ErroDominio('CHAVE_INVALIDA', 'A chave de idempotência precisa de pelo menos duas partes (operação e recurso).');
  }
  const normalizadas = partes.map((parte) => {
    const texto = String(parte).trim();
    if (texto === '' || texto.includes(':') || /\s/.test(texto)) {
      throw new ErroDominio('CHAVE_INVALIDA', `Parte inválida na chave de idempotência: "${texto}".`);
    }
    return texto.toLowerCase();
  });
  const chave = normalizadas.join(':');
  if (chave.length > 300) throw new ErroDominio('CHAVE_INVALIDA', 'A chave de idempotência excede 300 caracteres.');
  return chave;
}
