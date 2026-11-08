import { calcularIdc, mascararDocumento, mascararNome, type IndicadoresDesempenho } from '@agora/dominio';
import type { FornecedorResumo, Sancao, TipoSancao } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { montarChecklist, obterFornecedorRegularidade } from '../regularidade/repositorio.ts';

interface LinhaFornecedor {
  id: string;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  porte: 'ME' | 'EPP' | 'DEMAIS' | null;
  uf: string | null;
  entregas_no_prazo: number | null;
  entregas_total: number | null;
  recebimentos_aprovados: number | null;
  recebimentos_total: number | null;
  ocorrencias_fiscalizacao: number | null;
  ocorrencias_resolvidas_no_prazo: number | null;
}

export interface LinhaSancaoResumo {
  fornecedor_id: string;
  tipo: TipoSancao;
  situacao: Sancao['situacao'];
  aplicada_em: string | null;
  fim_vigencia: string | null;
}

export interface FornecedorCalculado {
  resumo: FornecedorResumo;
  idc: ReturnType<typeof calcularIdc>;
  indicadores: IndicadoresDesempenho;
}

/** Nome exibível: razão social de PJ; nome de pessoa física sempre mascarado (LGPD). */
export function nomeExibivel(tipoPessoa: 'PJ' | 'PF', nome: string): string {
  return tipoPessoa === 'PF' ? mascararNome(nome) : nome;
}

/** Sanção conta como vigente quando aplicada e sem término ou com término futuro. */
export function sancaoVigente(s: Pick<LinhaSancaoResumo, 'situacao' | 'fim_vigencia'>, hoje: string): boolean {
  return s.situacao === 'aplicada' && (s.fim_vigencia === null || s.fim_vigencia >= hoje);
}

export function indicadoresDe(linha: LinhaFornecedor, sancoes: readonly LinhaSancaoResumo[]): IndicadoresDesempenho {
  return {
    entregasNoPrazo: linha.entregas_no_prazo ?? 0,
    entregasTotal: linha.entregas_total ?? 0,
    recebimentosAprovados: linha.recebimentos_aprovados ?? 0,
    recebimentosTotal: linha.recebimentos_total ?? 0,
    ocorrenciasFiscalizacao: linha.ocorrencias_fiscalizacao ?? 0,
    ocorrenciasResolvidasNoPrazo: linha.ocorrencias_resolvidas_no_prazo ?? 0,
    sancoes: sancoes
      .filter((s): s is LinhaSancaoResumo & { aplicada_em: string } => s.situacao === 'aplicada' && s.aplicada_em !== null)
      .map((s) => ({ tipo: s.tipo, dataAplicacao: s.aplicada_em })),
  };
}

/**
 * Carrega fornecedores com IDC (art. 88, §§ 3º e 4º, calculado por @agora/dominio) e sanções vigentes.
 * `ids` nulo carrega todos.
 */
export async function carregarFornecedores(
  executor: Executor,
  ids: readonly string[] | null,
  hoje: string,
): Promise<Map<string, FornecedorCalculado>> {
  const filtro = ids === null ? null : [...new Set(ids)];
  const linhas = await executor.consultar<LinhaFornecedor>(
    `SELECT f.id, f.documento, f.tipo_pessoa, f.razao_social, f.porte, f.uf,
            i.entregas_no_prazo, i.entregas_total, i.recebimentos_aprovados, i.recebimentos_total,
            i.ocorrencias_fiscalizacao, i.ocorrencias_resolvidas_no_prazo
       FROM fornecedores f
       LEFT JOIN fornecedores_indicadores i ON i.fornecedor_id = f.id
      WHERE ($1::uuid[] IS NULL OR f.id = ANY($1::uuid[]))`,
    [filtro],
  );
  const sancoes = await executor.consultar<LinhaSancaoResumo>(
    `SELECT fornecedor_id, tipo, situacao, aplicada_em, fim_vigencia
       FROM sancoes
      WHERE ($1::uuid[] IS NULL OR fornecedor_id = ANY($1::uuid[]))`,
    [filtro],
  );
  const mapa = new Map<string, FornecedorCalculado>();
  for (const linha of linhas) {
    const doFornecedor = sancoes.filter((s) => s.fornecedor_id === linha.id);
    const sancoesVigentes = doFornecedor.filter((s) => sancaoVigente(s, hoje));
    const impedido = sancoesVigentes.some((s) => s.tipo === 'impedimento_licitar' || s.tipo === 'declaracao_inidoneidade');
    const indicadores = indicadoresDe(linha, doFornecedor);
    const idc = calcularIdc(indicadores, hoje);
    mapa.set(linha.id, {
      indicadores,
      idc,
      resumo: {
        id: linha.id,
        documento: mascararDocumento(linha.documento),
        tipoPessoa: linha.tipo_pessoa,
        razaoSocial: nomeExibivel(linha.tipo_pessoa, linha.razao_social),
        porte: linha.porte,
        uf: linha.uf,
        sancoesVigentes: sancoesVigentes.length,
        impedido,
        idc: { nota: idc.nota, faixa: idc.faixa, semHistorico: idc.semHistorico },
      },
    });
  }
  return mapa;
}

export async function carregarFornecedor(executor: Executor, id: string, hoje: string): Promise<FornecedorCalculado | null> {
  const mapa = await carregarFornecedores(executor, [id], hoje);
  return mapa.get(id) ?? null;
}

const ROTULO_SANCAO: Record<TipoSancao, string> = {
  advertencia: 'Advertência',
  multa: 'Multa',
  impedimento_licitar: 'Impedimento de licitar e contratar',
  declaracao_inidoneidade: 'Declaração de inidoneidade',
};

export function rotuloSancao(tipo: TipoSancao): string {
  return ROTULO_SANCAO[tipo];
}

export interface Regularidade {
  regular: boolean;
  consultadoEm: string;
  fontes: string[];
  motivos: string[];
}

/**
 * Regularidade do fornecedor (RN-09, art. 91, § 4º) para exibição e para a trava dentro da transação: o checklist
 * de @agora/dominio com a última consulta ao CEIS/CNEP em cache, as sanções impeditivas aplicadas pelo órgão e as
 * certidões registradas (RF-20). Não chama a fonte externa: a consulta nova é feita pelas travas
 * (`verificarRegularidade`) antes de assinar, prorrogar, atestar e pagar.
 */
export async function avaliarRegularidade(executor: Executor, fornecedorId: string, hoje: string, agora: Date): Promise<Regularidade> {
  const fornecedor = await obterFornecedorRegularidade(executor, fornecedorId);
  if (!fornecedor) return { regular: false, consultadoEm: agora.toISOString(), fontes: [], motivos: ['Fornecedor não encontrado no cadastro.'] };
  const { checklist } = await montarChecklist(executor, fornecedor, 'assinatura', hoje, agora, { consultaObrigatoria: false });
  return {
    regular: checklist.regular,
    consultadoEm: checklist.consulta?.consultadoEm ?? agora.toISOString(),
    fontes: checklist.itens.filter((i, indice, todos) => todos.findIndex((o) => o.fonte === i.fonte) === indice).map((i) => i.fonte),
    motivos: checklist.motivos,
  };
}
