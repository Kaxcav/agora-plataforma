/**
 * Carga sintética da pesquisa de preços (RF-25) e da projeção (RIA-11), para o modo offline:
 * - 24 meses de séries mensais sintéticas de IPCA e de câmbio, encerrando no mês anterior a "hoje";
 * - tabelas sintéticas do Sinapi e do Sicro para as UFs das UASGs da demonstração, com códigos DEMO.
 * Nada vem das fontes reais: valores e descrições são gerados por um PRNG próprio (semente fixa), de modo que esta
 * etapa não altera os dados das etapas anteriores.
 */
import { createHash } from 'node:crypto';
import { jsonCanonico } from '../auditoria/trilha.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import type { ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

const SEMENTE_PRECOS = 14_133_023;
const MESES_SERIE = 24;

/** Composições sintéticas de demonstração (descrições genéricas; preço-base em reais). */
const COMPOSICOES_SINAPI: readonly [string, string, string, number][] = [
  ['DEMO-1001', 'Alvenaria de vedação com bloco cerâmico, espessura de 9 cm (composição sintética de demonstração)', 'm2', 78],
  ['DEMO-1002', 'Chapisco em parede interna com argamassa de cimento e areia (composição sintética de demonstração)', 'm2', 6],
  ['DEMO-1003', 'Reboco de parede interna com argamassa mista (composição sintética de demonstração)', 'm2', 32],
  ['DEMO-1004', 'Piso cerâmico assentado com argamassa colante (composição sintética de demonstração)', 'm2', 95],
  ['DEMO-1005', 'Pintura látex acrílica em parede, duas demãos (composição sintética de demonstração)', 'm2', 18],
  ['DEMO-1006', 'Concreto estrutural usinado bombeado, fck 30 MPa (composição sintética de demonstração)', 'm3', 690],
  ['DEMO-1007', 'Forro de gesso acartonado em placas (composição sintética de demonstração)', 'm2', 84],
  ['DEMO-1008', 'Instalação de luminária de embutir com lâmpada LED (composição sintética de demonstração)', 'un', 145],
  ['DEMO-1009', 'Porta de madeira semioca com batente e ferragens (composição sintética de demonstração)', 'un', 1180],
  ['DEMO-1010', 'Impermeabilização de laje com manta asfáltica (composição sintética de demonstração)', 'm2', 112],
  ['DEMO-1011', 'Reforma de cobertura com telha metálica trapezoidal (composição sintética de demonstração)', 'm2', 168],
  ['DEMO-1012', 'Cabeamento estruturado, ponto de rede categoria 6 (composição sintética de demonstração)', 'un', 410],
];

const COMPOSICOES_SICRO: readonly [string, string, string, number][] = [
  ['DEMO-2001', 'Pavimentação com concreto asfáltico usinado a quente (composição sintética de demonstração)', 't', 620],
  ['DEMO-2002', 'Base de brita graduada simples para pavimentação (composição sintética de demonstração)', 'm3', 210],
  ['DEMO-2003', 'Sinalização horizontal com tinta à base de resina acrílica (composição sintética de demonstração)', 'm2', 42],
  ['DEMO-2004', 'Defensa metálica semimaleável simples (composição sintética de demonstração)', 'm', 390],
  ['DEMO-2005', 'Recomposição de acostamento com tratamento superficial (composição sintética de demonstração)', 'm2', 38],
  ['DEMO-2006', 'Sinalização vertical com placa de aço refletiva (composição sintética de demonstração)', 'm2', 860],
];

function competencia(hoje: string, mesesAtras: number): string {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const total = ano * 12 + (mes - 1) - mesesAtras;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function hash(valor: unknown): string {
  return createHash('sha256').update(jsonCanonico(valor)).digest('hex');
}

export async function gerarReferenciasPrecos(ctx: ContextoSeed): Promise<void> {
  const prng = new Prng(SEMENTE_PRECOS);
  const consultadoEm = ctx.agora.toISOString();

  // Séries mensais: do mês mais antigo ao mês anterior a "hoje".
  const ipca: { competencia: string; valor: number }[] = [];
  const cambio: { competencia: string; valor: number }[] = [];
  let cotacao = 5 + prng.inteiro(0, 40) / 100;
  for (let atras = MESES_SERIE; atras >= 1; atras--) {
    const c = competencia(ctx.hoje, atras);
    ipca.push({ competencia: c, valor: (prng.inteiro(10, 70) - 5) / 100 });
    cotacao = cotacao * (1 + (prng.inteiro(0, 300) - 140) / 10_000);
    cambio.push({ competencia: c, valor: Math.round(cotacao * 10_000) / 10_000 });
  }
  const series = [
    { serie: 'IPCA', pontos: ipca, fonte: 'Série sintética de demonstração (IPCA, variação mensal)' },
    { serie: 'CAMBIO_USD', pontos: cambio, fonte: 'Série sintética de demonstração (dólar, média mensal)' },
  ] as const;
  for (const s of series) {
    const hashSerie = hash(s.pontos);
    for (const p of s.pontos) {
      await ctx.tx.executar(
        `INSERT INTO indices_economicos (serie, competencia, valor, modo, fonte, consultado_em, hash_conteudo)
         VALUES ($1, $2, $3, 'offline', $4, $5, $6)`,
        [s.serie, p.competencia, p.valor, s.fonte, consultadoEm, hashSerie],
      );
    }
  }

  // Tabelas de obras: uma por sistema e UF, data-base no mês anterior a "hoje", não desonerada.
  const ufs = (await ctx.tx.consultar<{ uf: string }>('SELECT DISTINCT uf FROM uasgs ORDER BY uf')).map((l) => l.uf).filter((uf) => /^[A-Z]{2}$/.test(uf));
  const dataBase = competencia(ctx.hoje, 1);
  let composicoes = 0;
  for (const uf of ufs) {
    for (const [sistema, lista] of [
      ['SINAPI', COMPOSICOES_SINAPI],
      ['SICRO', COMPOSICOES_SICRO],
    ] as const) {
      const linhas = lista.map(([codigo, descricao, unidade, reais]) => ({
        codigo,
        descricao,
        unidade,
        preco: Math.round(reais * 100 * (0.92 + prng.inteiro(0, 16) / 100)),
      }));
      await ctx.tx.executar(
        `INSERT INTO referencias_engenharia_lotes (sistema, uf, data_base, desonerado, itens, hash_conteudo, importado_por, importado_em)
         VALUES ($1, $2, $3, false, $4, $5, NULL, $6)`,
        [sistema, uf, dataBase, linhas.length, hash(linhas), consultadoEm],
      );
      for (const l of linhas) {
        await ctx.tx.executar(
          `INSERT INTO referencias_engenharia (sistema, uf, data_base, desonerado, codigo, descricao, unidade, preco, busca_normalizada)
           VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8)`,
          [sistema, uf, dataBase, l.codigo, l.descricao, l.unidade, l.preco, normalizarBusca(l.codigo, l.descricao)],
        );
      }
      composicoes += linhas.length;
    }
  }
  ctx.dados.contagens.indicesEconomicos = ipca.length + cambio.length;
  ctx.dados.contagens.referenciasEngenharia = composicoes;
}
