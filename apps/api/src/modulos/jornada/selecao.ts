/**
 * Atos da seleção do processo (etapa 6): ponte entre a coluna `processos.selecao` e as regras de @agora/dominio
 * (`avaliarSelecao`), e a montagem do bloco `selecao` do `ProcessoDetalhe`. Também resolve o vencedor que vai à
 * contratação (o adjudicatário) e normaliza os parâmetros do edital gravados antes da prova de conceito.
 */
import { avaliarSelecao, hojeISO, type AvaliacaoSelecao, type EstadoSelecao, type OpcoesCalendario } from '@agora/dominio';
import type {
  FaseRecursalProcesso,
  InversaoFasesEdital,
  LicitanteReferencia,
  ModoDisputaSessao,
  ProvaConceitoEdital,
  SelecaoProcesso,
  UsuarioResumo,
} from '@agora/contratos';
import type { AutorAto, DisputaArmazenada, LinhaProcesso, ParametrosEdital, RecursoArmazenado, SelecaoArmazenada } from './tipos.ts';

export const PROVA_CONCEITO_PADRAO: ProvaConceitoEdital = { exigencia: 'nenhuma', roteiro: null, justificativa: null, prazoDiasUteis: null };
export const INVERSAO_FASES_PADRAO: InversaoFasesEdital = { adotada: false, motivacao: null };
export const MODO_DISPUTA_PADRAO: ModoDisputaSessao = 'aberto';

export type ParametrosEditalCompletos = ParametrosEdital & {
  provaConceito: ProvaConceitoEdital;
  inversaoFases: InversaoFasesEdital;
  modoDisputa: ModoDisputaSessao;
};

/** Parâmetros do edital com a prova de conceito e a inversão de fases sempre presentes (editais anteriores não as têm). */
export function editalCompleto(edital: ParametrosEdital): ParametrosEditalCompletos {
  return {
    ...edital,
    provaConceito: edital.provaConceito ?? PROVA_CONCEITO_PADRAO,
    inversaoFases: edital.inversaoFases ?? INVERSAO_FASES_PADRAO,
    modoDisputa: edital.modoDisputa ?? MODO_DISPUTA_PADRAO,
  };
}

/** Coluna `selecao` com as listas sempre presentes. */
export function selecaoCompleta(s: SelecaoArmazenada): Required<SelecaoArmazenada> {
  return {
    legado: s.legado ?? false,
    convocacoes: s.convocacoes ?? [],
    habilitacoes: s.habilitacoes ?? [],
    recursos: s.recursos ?? [],
    adjudicacao: s.adjudicacao ?? null,
    homologacao: s.homologacao ?? null,
    preparatoriosDivulgadosEm: s.preparatoriosDivulgadosEm ?? null,
    contratacaoDireta: s.contratacaoDireta ?? null,
  };
}

/** Ids da classificação da disputa, na ordem das posições. */
export function classificacaoDaDisputa(disputa: DisputaArmazenada): string[] {
  return [...(disputa.resultado?.classificacao ?? [])].sort((a, b) => a.posicao - b.posicao).map((c) => c.id);
}

/** Estado dos atos para `avaliarSelecao`, a partir das colunas do processo. */
export function estadoSelecao(linha: Pick<LinhaProcesso, 'disputa' | 'edital' | 'selecao'>): EstadoSelecao {
  const s = selecaoCompleta(linha.selecao);
  const edital = editalCompleto(linha.edital);
  const exigida = edital.provaConceito.exigencia !== 'nenhuma';
  return {
    classificacao: classificacaoDaDisputa(linha.disputa),
    dataJulgamento: linha.disputa.registradaEm ? hojeISO(new Date(linha.disputa.registradaEm)) : null,
    sorteioPendente: linha.disputa.resultado?.sorteioNecessario ?? false,
    provaConceito: { exigida, prazoDiasUteis: exigida ? edital.provaConceito.prazoDiasUteis : null },
    inversaoFases: edital.inversaoFases.adotada,
    convocacoes: s.convocacoes,
    habilitacoes: s.habilitacoes,
    recursos: s.recursos,
    adjudicacao: s.adjudicacao ? { data: s.adjudicacao.data, fornecedorId: s.adjudicacao.fornecedorId } : null,
    homologacao: s.homologacao ? { data: s.homologacao.data } : null,
  };
}

export function avaliarSelecaoProcesso(linha: Pick<LinhaProcesso, 'disputa' | 'edital' | 'selecao'>, hoje: string, calendario: OpcoesCalendario): AvaliacaoSelecao {
  return avaliarSelecao(estadoSelecao(linha), hoje, calendario);
}

/**
 * Fornecedor que vai à contratação: o adjudicatário (art. 71, IV). Processos marcados como legado pela migração 011
 * seguem a regra anterior (primeiro classificado). `null` sem adjudicação.
 */
export function vencedorDoProcesso(linha: Pick<LinhaProcesso, 'disputa' | 'selecao'>): string | null {
  const s = selecaoCompleta(linha.selecao);
  if (s.contratacaoDireta) return s.contratacaoDireta.fornecedorId;
  if (s.legado) return classificacaoDaDisputa(linha.disputa)[0] ?? null;
  return s.homologacao && s.adjudicacao ? s.adjudicacao.fornecedorId : null;
}

/** A disputa só pode ser alterada antes do primeiro ato da seleção (convocação, habilitação ou recurso). */
export function selecaoIniciada(s: SelecaoArmazenada): boolean {
  const c = selecaoCompleta(s);
  return c.convocacoes.length > 0 || c.habilitacoes.length > 0 || c.recursos.length > 0 || c.adjudicacao !== null;
}

function autor(a: AutorAto | null): UsuarioResumo | null {
  return a ? { id: a.id, nome: a.nome } : null;
}

/** Bloco `selecao` do ProcessoDetalhe: registros com os nomes dos licitantes e a avaliação do domínio. */
export function montarSelecao(linha: Pick<LinhaProcesso, 'disputa' | 'edital' | 'selecao'>, avaliacao: AvaliacaoSelecao): SelecaoProcesso {
  const s = selecaoCompleta(linha.selecao);
  const edital = editalCompleto(linha.edital);
  const nomes = new Map(linha.disputa.licitantes.map((l) => [l.fornecedorId, l.nome]));
  const licitante = (id: string): LicitanteReferencia => ({ id, nome: nomes.get(id) ?? 'Licitante não identificado' });
  const manifestacoes = (lista: RecursoArmazenado['intencoes']) => lista.map((m) => ({ licitante: licitante(m.fornecedorId), data: m.data, texto: m.texto }));
  const fase = (r: RecursoArmazenado, atual: AvaliacaoSelecao['faseRecursal'] | null): FaseRecursalProcesso => ({
    vencedor: licitante(r.vencedorId),
    atoRecorrivel: atual?.atoRecorrivel ?? (edital.inversaoFases.adotada ? 'julgamento' : 'habilitacao'),
    dataAto: atual?.dataAto ?? r.dataAto,
    situacao: atual?.situacao ?? (r.decisaoSuperior?.decisao === 'provido' || r.reconsideracao?.decisao === 'reconsiderada' ? 'decidida_em_recurso' : 'improvida'),
    intencaoAberta: atual?.intencaoAberta ?? false,
    prazos: atual
      ? { razoes: atual.prazos.razoes, contrarrazoes: atual.prazos.contrarrazoes, reconsideracao: atual.prazos.reconsideracao, decisaoSuperior: atual.prazos.decisaoSuperior }
      : { razoes: r.dataAto, contrarrazoes: r.dataAto, reconsideracao: r.dataAto, decisaoSuperior: null },
    intencoes: manifestacoes(r.intencoes),
    intencaoEncerradaEm: r.intencaoEncerradaEm,
    razoes: manifestacoes(r.razoes),
    contrarrazoes: manifestacoes(r.contrarrazoes),
    reconsideracao: r.reconsideracao ? { ...r.reconsideracao, por: autor(r.reconsideracao.por) } : null,
    decisaoSuperior: r.decisaoSuperior ? { ...r.decisaoSuperior, por: autor(r.decisaoSuperior.por) } : null,
  });

  const vencedor = avaliacao.vencedorProvisorio;
  const recursoAtual = vencedor === null ? null : (s.recursos.filter((r) => r.vencedorId === vencedor).at(-1) ?? null);
  let faseRecursal: FaseRecursalProcesso | null = null;
  if (avaliacao.faseRecursal && vencedor !== null) {
    const vazio: RecursoArmazenado = {
      vencedorId: vencedor,
      dataAto: avaliacao.faseRecursal.dataAto,
      intencoes: [],
      intencaoEncerradaEm: null,
      razoes: [],
      contrarrazoes: [],
      reconsideracao: null,
      decisaoSuperior: null,
    };
    faseRecursal = fase(recursoAtual ?? vazio, avaliacao.faseRecursal);
  }
  return {
    proximoAto: avaliacao.proximoAto,
    vencedorProvisorio: vencedor === null ? null : licitante(vencedor),
    excluidos: avaliacao.excluidos.map((x) => ({ licitante: licitante(x.fornecedorId), motivo: x.motivo })),
    reintegrados: avaliacao.reintegrados,
    provasConceito: s.convocacoes.map((c) => ({
      licitante: licitante(c.fornecedorId),
      convocadoEm: c.convocadoEm,
      limite: c.limite,
      convocacaoAutomatica: c.convocacaoAutomatica,
      resultado: c.resultado,
      realizadaEm: c.realizadaEm,
      motivacao: c.motivacao,
      linkGravacao: c.linkGravacao,
      registradoPor: autor(c.registradoPor),
    })),
    habilitacoes: s.habilitacoes.map((h) => ({ licitante: licitante(h.fornecedorId), resultado: h.resultado, data: h.data, motivacao: h.motivacao, registradoPor: autor(h.por) })),
    faseRecursal,
    fasesRecursaisAnteriores: s.recursos.filter((r) => r !== recursoAtual).map((r) => fase(r, null)),
    recursosExauridos: avaliacao.recursosExauridos,
    adjudicacao: s.adjudicacao
      ? { data: s.adjudicacao.data, licitante: licitante(s.adjudicacao.fornecedorId), motivacao: s.adjudicacao.motivacao, por: autor(s.adjudicacao.por) }
      : null,
    homologacao: s.homologacao ? { data: s.homologacao.data, motivacao: s.homologacao.motivacao, por: autor(s.homologacao.por) } : null,
    documentosPreparatoriosDivulgadosEm: s.preparatoriosDivulgadosEm,
    pendencia: avaliacao.pendencia,
  };
}
