/**
 * Modo offline da pesquisa de preços (padrão): simula as fontes online com amostras sintéticas determinísticas,
 * geradas pelo mesmo PRNG da carga de demonstração a partir do item pesquisado. A mesma pesquisa devolve sempre as
 * mesmas amostras. Nenhuma chamada externa é feita e os identificadores trazem o prefixo DEMO.
 */
import { createHash } from 'node:crypto';
import { adicionarDias, type AmostraPrecoExterna } from '@agora/dominio';
import type { FontePesquisaPrecos } from '@agora/contratos';
import { jsonCanonico } from '../../auditoria/trilha.ts';
import { normalizarBusca } from '../../compartilhado/texto.ts';
import { Prng } from '../../seed/prng.ts';
import type { ColetaFonte, PedidoPesquisaPrecos } from './tipos.ts';

type FonteSimulada = Extract<FontePesquisaPrecos, 'PAINEL_PRECOS' | 'CONTRATACOES_SIMILARES' | 'NOTAS_FISCAIS'>;

interface PlanoSimulacao {
  origem: AmostraPrecoExterna['origem'];
  /** Dias atrás de cada amostra; a última de contratações similares fica fora do prazo de 1 ano, para demonstrar o descarte. */
  diasAtras: readonly [number, number][];
  identificador: (prng: Prng, ano: string) => string;
  local: (prng: Prng) => string;
}

const PLANOS: Record<FonteSimulada, PlanoSimulacao> = {
  PAINEL_PRECOS: {
    origem: 'painel_precos',
    diasAtras: [
      [5, 60],
      [30, 120],
      [90, 200],
      [150, 330],
    ],
    identificador: (prng, ano) => `Compra DEMO-${prng.digitos(5)}/${ano} item ${prng.inteiro(1, 20)}`,
    local: (prng) => `UASG 9${prng.digitos(5)} (simulação)`,
  },
  CONTRATACOES_SIMILARES: {
    origem: 'contratacoes_similares',
    diasAtras: [
      [10, 90],
      [60, 200],
      [120, 330],
      [380, 420],
    ],
    identificador: (prng, ano) => `PNCP DEMO-${prng.digitos(8)}-1-${prng.digitos(6)}/${ano} item 1`,
    local: (prng) => `UASG 9${prng.digitos(5)} (simulação)`,
  },
  NOTAS_FISCAIS: {
    origem: 'notas_fiscais',
    diasAtras: [
      [7, 90],
      [45, 180],
      [100, 330],
    ],
    identificador: (prng) => `NF-e DEMO ${prng.digitos(6)}, série 1`,
    local: () => 'Órgão federal destinatário (simulação)',
  },
};

function semente(fonte: FonteSimulada, pedido: PedidoPesquisaPrecos): number {
  const chave = `${fonte}|${pedido.catmat ?? ''}|${normalizarBusca(pedido.termo)}`;
  return Number.parseInt(createHash('sha256').update(chave).digest('hex').slice(0, 8), 16);
}

export function simularFonte(fonte: FonteSimulada, pedido: PedidoPesquisaPrecos, hoje: string, agora: Date): ColetaFonte {
  const plano = PLANOS[fonte];
  const prng = new Prng(semente(fonte, pedido));
  const referencia = pedido.valorReferencia !== null && pedido.valorReferencia > 0 ? pedido.valorReferencia : 10_000 + prng.inteiro(0, 490_000);
  const amostras: AmostraPrecoExterna[] = plano.diasAtras.map(([minimo, maximo]) => {
    const data = adicionarDias(hoje, -prng.inteiro(minimo, maximo));
    return {
      origem: plano.origem,
      identificador: plano.identificador(prng, data.slice(0, 4)),
      descricao: pedido.descricaoItem,
      valorUnitario: Math.max(1, Math.round(referencia * (0.88 + prng.proximo() * 0.24))),
      data,
      unidade: pedido.unidade,
      local: plano.local(prng),
    };
  });
  return {
    fonte,
    situacao: 'ok',
    modo: 'offline',
    amostras,
    registros: amostras.length,
    mensagem: `Modo offline: ${amostras.length} amostras simuladas de forma determinística para demonstração. Nenhuma chamada externa foi feita.`,
    hashConteudo: createHash('sha256').update(jsonCanonico(amostras)).digest('hex'),
    endereco: null,
    consultadoEm: agora.toISOString(),
  };
}
