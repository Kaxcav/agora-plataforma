import { registrarEventos } from '../auditoria/trilha.ts';
import { gerarHashSenha } from '../autenticacao/senhas.ts';
import type { Executor } from '../banco/tipos.ts';
import type { ContextoApp } from '../http/contexto.ts';
import { FONTES_EXECUTAVEIS } from '../integracoes/conector.ts';
import { executarSincronizacao } from '../integracoes/servico.ts';
import { gerarCadastros } from './cadastros.ts';
import type { ContextoSeed, DadosSeed, EtapaSeed } from './contexto.ts';
import { gerarExecucao } from './execucao.ts';
import { gerarGestao } from './gestao.ts';
import { gerarInstrumentos } from './instrumentos.ts';
import { Prng } from './prng.ts';
import { gerarProcessos } from './processos.ts';
import { gerarReferenciasPrecos } from './precos.ts';
import { gerarControle } from './controle.ts';
import { gerarRegularidade } from './regularidade.ts';
import { gerarQualificacaoTecnica } from './qualificacao-tecnica.ts';
import { SENHA_DEMONSTRACAO } from './usuarios-demonstracao.ts';
import { gerarVinculoSalaDisputa } from './disputa.ts';

/** Semente fixa do gerador (Lei 14.133): a mesma data de referência produz sempre os mesmos dados. */
export const SEMENTE_DEMONSTRACAO = 14_133;

/**
 * Etapas da carga sintética, em ordem. Para acrescentar dados de um novo módulo (ex.: processos da Jornada),
 * crie `seed/<modulo>.ts` com uma `EtapaSeed` e inclua-a aqui: ela recebe a transação, o PRNG e os
 * `dados` das etapas anteriores (usuários, UASGs, fornecedores, contratos...).
 */
export const ETAPAS_SEED: EtapaSeed[] = [
  { nome: 'cadastros', executar: gerarCadastros },
  { nome: 'instrumentos', executar: gerarInstrumentos },
  { nome: 'execucao', executar: gerarExecucao },
  { nome: 'gestao', executar: gerarGestao },
  { nome: 'processos', executar: gerarProcessos },
  { nome: 'precos', executar: gerarReferenciasPrecos },
  { nome: 'sala-disputa', executar: gerarVinculoSalaDisputa },
  { nome: 'controle', executar: gerarControle },
  { nome: 'regularidade', executar: gerarRegularidade },
  { nome: 'qualificacao-tecnica', executar: gerarQualificacaoTecnica },
];

function dadosVazios(): DadosSeed {
  return {
    cnpjOrgao: '',
    uasgs: [],
    unidades: new Map(),
    usuarios: new Map(),
    gestores: [],
    fiscais: [],
    fornecedores: [],
    atas: [],
    contratos: [],
    pagamentos: [],
    contagens: {},
  };
}

export async function bancoVazio(executor: Executor): Promise<boolean> {
  const [linha] = await executor.consultar<{ existe: boolean }>('SELECT EXISTS (SELECT 1 FROM usuarios) AS existe');
  return !(linha?.existe ?? false);
}

/**
 * Popula o banco com dados 100% sintéticos (ARQUITETURA §5), relativos ao "hoje" do relógio da aplicação.
 * Tudo numa transação; a trilha de auditoria recebe o histórico sintético e o evento `seed.executar`.
 * Em seguida, executa as sincronizações offline para registrar a proveniência de cada fonte.
 */
export async function executarSeed(app: ContextoApp, etapas: readonly EtapaSeed[] = ETAPAS_SEED): Promise<Record<string, number>> {
  const agora = app.relogio();
  const hoje = app.hoje();
  const senhaHash = await gerarHashSenha(SENHA_DEMONSTRACAO);
  const contagens = await app.banco.transacao(async (tx) => {
    const ctx: ContextoSeed = {
      tx,
      prng: new Prng(SEMENTE_DEMONSTRACAO),
      hoje,
      agora,
      calendario: { feriadosExtras: [], considerarPontosFacultativos: true },
      senhaHashDemonstracao: senhaHash,
      dados: dadosVazios(),
      eventos: [],
    };
    for (const etapa of etapas) await etapa.executar(ctx);
    const eventos = [...ctx.eventos].sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime());
    eventos.push({
      ocorridoEm: agora,
      usuarioId: null,
      acao: 'seed.executar',
      recurso: 'sistema',
      recursoId: null,
      resumo: 'Carregou os dados sintéticos de demonstração',
      dados: { semente: SEMENTE_DEMONSTRACAO, dataReferencia: hoje, etapas: etapas.map((e) => e.nome), contagens: ctx.dados.contagens },
    });
    await registrarEventos(tx, eventos);
    return { ...ctx.dados.contagens, eventosHistoricos: eventos.length };
  });
  for (const fonte of FONTES_EXECUTAVEIS) {
    await executarSincronizacao(app, fonte, { usuarioId: null, ipHash: null }, { modo: 'offline' });
  }
  return contagens;
}
