/**
 * Teste de carga reproduzível (RNF-10): converte os volumes anuais de referência configurados pelo órgão em vazão
 * de pico por cenário e resume as latências medidas. Funções puras; o executor (`npm run carga -w @agora/api`) faz
 * as requisições e grava o relatório.
 */
import { ErroDominio } from '../erros.ts';
import { arredondar } from '../interno.ts';

export interface VolumesReferencia {
  /** Processos de contratação (licitações e contratações diretas) por ano. */
  processosAno: number;
  /** Documentos enviados por ano (habilitação, atestados, anexos). */
  documentosAno: number;
  /** Usuários usando a plataforma ao mesmo tempo no horário de pico. */
  usuariosSimultaneos: number;
  /** Consultas (listagens e telas) por usuário por minuto, no pico. */
  consultasPorUsuarioMinuto: number;
  /** Escritas da jornada por processo (DFD, ETP, riscos, cesta, documentos, avanços...). */
  escritasPorProcesso: number;
  diasUteisAno: number;
  horasExpediente: number;
  /** Quantas vezes o pico supera a média do expediente. */
  fatorPico: number;
}

export type CenarioCarga = 'listagens' | 'jornada' | 'publicacao' | 'documentos';

export const CENARIOS_CARGA: readonly CenarioCarga[] = Object.freeze(['listagens', 'jornada', 'publicacao', 'documentos']);

export interface DemandaCenario {
  cenario: CenarioCarga;
  /** Operações por segundo que a plataforma precisa sustentar no pico. */
  vazaoExigidaPorSegundo: number;
  memoria: string;
}

function positivo(valor: number, campo: string): void {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new ErroDominio('VOLUME_INVALIDO', `${campo} deve ser um número maior que zero (recebido: ${String(valor)}).`);
  }
}

/**
 * Vazão de pico por cenário a partir dos volumes anuais: volume ÷ (dias úteis × horas de expediente × 3.600 s)
 * × fator de pico. Listagens: usuários simultâneos × consultas por minuto ÷ 60. Publicação: uma por processo.
 */
export function dimensionarCarga(v: VolumesReferencia): DemandaCenario[] {
  positivo(v.processosAno, 'processosAno');
  positivo(v.documentosAno, 'documentosAno');
  positivo(v.usuariosSimultaneos, 'usuariosSimultaneos');
  positivo(v.consultasPorUsuarioMinuto, 'consultasPorUsuarioMinuto');
  positivo(v.escritasPorProcesso, 'escritasPorProcesso');
  positivo(v.fatorPico, 'fatorPico');
  if (!Number.isInteger(v.diasUteisAno) || v.diasUteisAno < 1 || v.diasUteisAno > 366) {
    throw new ErroDominio('VOLUME_INVALIDO', 'diasUteisAno deve ser um inteiro de 1 a 366.');
  }
  if (!Number.isFinite(v.horasExpediente) || v.horasExpediente <= 0 || v.horasExpediente > 24) {
    throw new ErroDominio('VOLUME_INVALIDO', 'horasExpediente deve ser maior que 0 e até 24.');
  }
  const segundosExpediente = v.diasUteisAno * v.horasExpediente * 3600;
  const pico = (porAno: number) => arredondar((porAno / segundosExpediente) * v.fatorPico, 4);
  const base = `${v.diasUteisAno} dias úteis × ${v.horasExpediente} h, pico ${v.fatorPico}× a média`;
  return [
    {
      cenario: 'listagens',
      vazaoExigidaPorSegundo: arredondar((v.usuariosSimultaneos * v.consultasPorUsuarioMinuto) / 60, 4),
      memoria: `${v.usuariosSimultaneos} usuários simultâneos × ${v.consultasPorUsuarioMinuto} consultas por minuto ÷ 60 s`,
    },
    {
      cenario: 'jornada',
      vazaoExigidaPorSegundo: pico(v.processosAno * v.escritasPorProcesso),
      memoria: `${v.processosAno} processos/ano × ${v.escritasPorProcesso} escritas por processo; ${base}`,
    },
    { cenario: 'publicacao', vazaoExigidaPorSegundo: pico(v.processosAno), memoria: `${v.processosAno} publicações/ano (uma por processo); ${base}` },
    { cenario: 'documentos', vazaoExigidaPorSegundo: pico(v.documentosAno), memoria: `${v.documentosAno} documentos/ano; ${base}` },
  ];
}

export interface EstatisticasLatencia {
  quantidade: number;
  mediaMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximoMs: number;
}

/** Média e percentis pelo método do posto mais próximo (nearest rank), em ms com uma casa. */
export function estatisticasLatencia(amostrasMs: readonly number[]): EstatisticasLatencia {
  if (amostrasMs.length === 0) throw new ErroDominio('AMOSTRAS_VAZIAS', 'Não há latências medidas para resumir.');
  for (const a of amostrasMs) {
    if (!Number.isFinite(a) || a < 0) throw new ErroDominio('AMOSTRA_INVALIDA', `Latência inválida: ${String(a)}.`);
  }
  const ordenadas = [...amostrasMs].sort((a, b) => a - b);
  const posto = (p: number) => ordenadas[Math.max(0, Math.ceil((p / 100) * ordenadas.length) - 1)] ?? 0;
  return {
    quantidade: ordenadas.length,
    mediaMs: arredondar(ordenadas.reduce((s, a) => s + a, 0) / ordenadas.length, 1),
    p50Ms: arredondar(posto(50), 1),
    p95Ms: arredondar(posto(95), 1),
    p99Ms: arredondar(posto(99), 1),
    maximoMs: arredondar(ordenadas.at(-1) ?? 0, 1),
  };
}
