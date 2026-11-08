/**
 * Consulta combinada das fontes de preços (RF-25), no servidor. Cada fonte é consultada de forma independente:
 * a falha de uma não impede as demais e fica registrada com a mensagem. Em modo offline, as fontes online são
 * simuladas; Sinapi e Sicro vêm sempre da tabela oficial importada no servidor.
 */
import type { FontePesquisaPrecos } from '@agora/contratos';
import { ErroIntegracao } from '../conector.ts';
import { consultarContratacoesSimilares, consultarNotasFiscais, consultarPainelPrecos } from './fontes-online.ts';
import { simularFonte } from './offline.ts';
import { consultarReferenciaEngenharia } from './referencias-engenharia.ts';
import { ehEngenharia, NOME_FONTE, type ColetaFonte, type ContextoColeta, type PedidoPesquisaPrecos } from './tipos.ts';

export const FONTES_PESQUISA: readonly FontePesquisaPrecos[] = ['PAINEL_PRECOS', 'CONTRATACOES_SIMILARES', 'NOTAS_FISCAIS', 'SINAPI', 'SICRO'];

function naoAplicavel(fonte: FontePesquisaPrecos, motivo: string, consultadoEm: string): ColetaFonte {
  return { fonte, situacao: 'nao_aplicavel', modo: 'local', amostras: [], registros: 0, mensagem: motivo, hashConteudo: null, endereco: null, consultadoEm };
}

async function protegida(fonte: FontePesquisaPrecos, modo: ColetaFonte['modo'], consultadoEm: string, executar: () => Promise<ColetaFonte>): Promise<ColetaFonte> {
  try {
    return await executar();
  } catch (erro) {
    const mensagem = erro instanceof ErroIntegracao ? erro.message : `Falha inesperada ao consultar ${NOME_FONTE[fonte]}.`;
    return { fonte, situacao: 'falhou', modo, amostras: [], registros: 0, mensagem, hashConteudo: null, endereco: null, consultadoEm };
  }
}

export async function coletarPrecos(ctx: ContextoColeta, modo: 'offline' | 'online', pedido: PedidoPesquisaPrecos): Promise<ColetaFonte[]> {
  const consultadoEm = ctx.agora.toISOString();
  const engenharia = ehEngenharia(pedido.tipoObjeto);
  const online = modo === 'online';
  const tarefas = FONTES_PESQUISA.map((fonte): Promise<ColetaFonte> => {
    switch (fonte) {
      case 'PAINEL_PRECOS':
        if (engenharia) {
          return Promise.resolve(naoAplicavel(fonte, 'O art. 23, § 2º, não prevê o painel de preços para obras e serviços de engenharia.', consultadoEm));
        }
        return online
          ? protegida(fonte, 'online', consultadoEm, () => consultarPainelPrecos(ctx, pedido))
          : Promise.resolve(simularFonte(fonte, pedido, ctx.hoje, ctx.agora));
      case 'CONTRATACOES_SIMILARES':
        return online
          ? protegida(fonte, 'online', consultadoEm, () => consultarContratacoesSimilares(ctx, pedido))
          : Promise.resolve(simularFonte(fonte, pedido, ctx.hoje, ctx.agora));
      case 'NOTAS_FISCAIS':
        return online
          ? protegida(fonte, 'online', consultadoEm, () => consultarNotasFiscais(ctx, pedido))
          : Promise.resolve(simularFonte(fonte, pedido, ctx.hoje, ctx.agora));
      case 'SINAPI':
      case 'SICRO':
        if (!engenharia) {
          return Promise.resolve(naoAplicavel(fonte, 'Sinapi e Sicro são parâmetros de obras e serviços de engenharia (art. 23, § 2º).', consultadoEm));
        }
        return protegida(fonte, 'local', consultadoEm, () => consultarReferenciaEngenharia(ctx, pedido, fonte));
      default:
        return Promise.resolve(naoAplicavel(fonte, 'Fonte desconhecida.', consultadoEm));
    }
  });
  return Promise.all(tarefas);
}
