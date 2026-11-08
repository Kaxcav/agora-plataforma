/**
 * Leitura assistida de atestados (RIA-08) e montagem da análise de qualificação técnica por licitante (RN-25).
 * PDF com camada de texto é lido aqui mesmo; PDF digitalizado e imagem vão ao serviço de OCR do órgão
 * (AGORA_OCR_URL). Tudo o que se devolve é sinal com evidências: a habilitação é decisão humana.
 */
import {
  AVISO_LEITURA_ASSISTIDA,
  avaliarBalancosApresentados,
  avaliarExigenciasQualificacaoTecnica,
  somarQuantitativosAtestados,
  type PaginaTexto,
} from '@agora/dominio';
import type { AnaliseHabilitacaoLicitante, ParcelaQualificacaoTecnica, QualificacaoTecnica } from '@agora/contratos';
import { sha256Hex } from '../../compartilhado/cripto.ts';
import { lerTextoPdf, temCamadaDeTexto } from '../../compartilhado/pdf-leitura.ts';
import type { ContextoApp } from '../../http/contexto.ts';
import { ErroIntegracao } from '../../integracoes/conector.ts';
import { reconhecerTexto } from '../../integracoes/ocr.ts';
import { analisarCesta, valorEstimadoProcesso } from '../jornada/regras.ts';
import type { LinhaProcesso } from '../jornada/tipos.ts';
import {
  extracaoDoArquivo,
  mencaoPublica,
  parcelasParaLeitura,
  type LinhaArquivo,
  type LinhaQualificacao,
  type ParcelaArmazenada,
} from './repositorio.ts';

export interface ResultadoLeitura {
  metodo: 'camada_texto' | 'ocr';
  situacao: 'concluida' | 'sem_texto' | 'ocr_indisponivel' | 'falhou';
  mensagem: string | null;
  paginas: PaginaTexto[];
  hashTexto: string | null;
  motor: string | null;
  confianca: number | null;
}

const MOTOR_CAMADA = 'camada de texto do PDF (servidor da Ágora)';

function hashDoTexto(paginas: readonly PaginaTexto[]): string | null {
  const linhas = paginas.flatMap((p) => p.linhas);
  return linhas.length === 0 ? null : sha256Hex(paginas.map((p) => `${p.numero}\n${p.linhas.join('\n')}`).join('\f'));
}

/** Lê o atestado: camada de texto do PDF ou, sem ela, o serviço de OCR. Falha do OCR vira situação, não exceção. */
export async function lerDocumento(ctx: ContextoApp, formato: LinhaArquivo['formato'], conteudo: Buffer): Promise<ResultadoLeitura> {
  if (formato === 'pdf') {
    const camada = lerTextoPdf(conteudo);
    if (temCamadaDeTexto(camada)) {
      return { metodo: 'camada_texto', situacao: 'concluida', mensagem: null, paginas: camada.paginas, hashTexto: hashDoTexto(camada.paginas), motor: MOTOR_CAMADA, confianca: null };
    }
  }
  const { url, timeoutMs } = ctx.config.ocr;
  if (url === null) {
    return {
      metodo: 'ocr',
      situacao: 'ocr_indisponivel',
      mensagem:
        'O documento não tem camada de texto (é digitalizado) e o serviço de OCR não está configurado neste ambiente (AGORA_OCR_URL). Confira os quantitativos diretamente no atestado.',
      paginas: [],
      hashTexto: null,
      motor: null,
      confianca: null,
    };
  }
  try {
    const ocr = await reconhecerTexto(ctx.fetch, { url, timeoutMs }, conteudo, formato);
    const linhas = ocr.paginas.reduce((s, p) => s + p.linhas.length, 0);
    return {
      metodo: 'ocr',
      situacao: linhas > 0 ? 'concluida' : 'sem_texto',
      mensagem: linhas > 0 ? null : 'O OCR não reconheceu texto no documento. Confira a qualidade da digitalização.',
      paginas: ocr.paginas,
      hashTexto: hashDoTexto(ocr.paginas),
      motor: ocr.motor,
      confianca: ocr.confianca,
    };
  } catch (erro) {
    if (!(erro instanceof ErroIntegracao)) throw erro;
    return { metodo: 'ocr', situacao: 'falhou', mensagem: erro.message, paginas: [], hashTexto: null, motor: null, confianca: null };
  }
}

/** Valor total estimado da contratação (base do art. 67, § 1º), o mesmo exibido na jornada; `null` sem estimativa. */
export function valorTotalEstimado(linha: LinhaProcesso, hoje: string): number | null {
  const valor = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, hoje));
  return valor === null || valor <= 0 ? null : Math.round(valor);
}

/** Parcelas com a avaliação da RN-25 (sem estimativa, os percentuais ficam zerados). */
export function avaliarParcelas(parcelas: readonly ParcelaArmazenada[], total: number | null): ParcelaQualificacaoTecnica[] {
  if (parcelas.length === 0) return [];
  if (total === null) {
    return parcelas.map((p) => ({ ...p, percentualDoTotal: 0, maiorRelevancia: false, percentualMinimo: 0, limiteQuantidadeMinima: p.quantidadeObjeto / 2 }));
  }
  const avaliacao = avaliarExigenciasQualificacaoTecnica({ valorTotalEstimado: total, parcelas });
  return parcelas.map((p, i) => {
    const a = avaliacao.parcelas[i];
    return {
      ...p,
      percentualDoTotal: a?.percentualDoTotal ?? 0,
      maiorRelevancia: a?.maiorRelevancia ?? false,
      percentualMinimo: a?.percentualMinimo ?? 0,
      limiteQuantidadeMinima: a?.limiteQuantidadeMinima ?? p.quantidadeObjeto / 2,
    };
  });
}

function formatarInstanteCurto(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * Análise por licitante: soma dos atestados lidos contra os mínimos do edital (RIA-08) e balanços apresentados
 * contra o art. 69, I e § 6º. Licitantes = os da disputa e os que tenham documento de habilitação no processo.
 */
export function montarQualificacao(e: {
  linha: LinhaProcesso;
  qualificacao: LinhaQualificacao | null;
  arquivos: readonly LinhaArquivo[];
  hoje: string;
  agora: Date;
  editavel: boolean;
}): QualificacaoTecnica {
  const total = valorTotalEstimado(e.linha, e.hoje);
  const armazenadas = e.qualificacao?.parcelas ?? [];
  const parcelas = avaliarParcelas(armazenadas, total);
  const paraLeitura = parcelasParaLeitura(armazenadas);

  const licitantes = new Map<string, string>();
  for (const l of e.linha.disputa.licitantes) licitantes.set(l.fornecedorId, l.nome);
  for (const a of e.arquivos) if (a.categoria === 'habilitacao' && a.fornecedor_id !== null && !licitantes.has(a.fornecedor_id)) licitantes.set(a.fornecedor_id, a.fornecedor_nome ?? '');

  const fontes: string[] = [];
  if (e.qualificacao) {
    fontes.push(`Exigências de qualificação técnica do edital, definidas em ${formatarInstanteCurto(e.qualificacao.definida_em)} (UTC)${e.qualificacao.definida_por_nome ? ` por ${e.qualificacao.definida_por_nome}` : ''}.`);
  }
  const analise: AnaliseHabilitacaoLicitante[] = [...licitantes.entries()].map(([fornecedorId, nome]) => {
    const doLicitante = e.arquivos.filter((a) => a.fornecedor_id === fornecedorId);
    const atestados = doLicitante.filter((a) => a.tipo === 'atestado_capacidade_tecnica');
    const lidos = atestados.flatMap((a) => {
      const extracao = extracaoDoArquivo(a, paraLeitura);
      if (extracao === null) return [];
      fontes.push(
        `${a.titulo} — ${nome}: SHA-256 ${a.sha256.slice(0, 12)}…, lido por ${a.leitura_metodo === 'ocr' ? `OCR (${a.leitura_motor ?? 'serviço do órgão'})` : 'camada de texto do PDF'} em ${formatarInstanteCurto(a.lida_em ?? '')} (UTC).`,
      );
      return [{ id: a.id, titulo: a.titulo, extracao }];
    });
    const soma = somarQuantitativosAtestados({
      parcelas: armazenadas.map((p) => ({ id: p.id, descricao: p.descricao, unidade: p.unidade, quantidadeMinima: p.quantidadeMinima })),
      atestados: lidos,
    });
    const balancos = doLicitante.filter((a) => a.tipo === 'balanco_patrimonial' && a.exercicio !== null);
    const constituicao = balancos.map((a) => a.data_constituicao).find((d): d is string => d !== null) ?? null;
    const avaliacaoBalancos = avaliarBalancosApresentados({
      dataConstituicao: constituicao,
      dataReferencia: e.hoje,
      exerciciosApresentados: balancos.map((a) => a.exercicio ?? 0),
    });
    return {
      fornecedor: { id: fornecedorId, nome },
      atestados: atestados.length,
      atestadosLidos: lidos.length,
      sinal: soma.sinal,
      mensagem: soma.mensagem,
      parcelas: soma.parcelas.map((p) => ({
        parcelaId: p.parcelaId,
        descricao: p.descricao,
        unidade: p.unidade,
        exigido: p.exigido,
        somado: p.somado,
        atende: p.atende,
        contribuicoes: p.contribuicoes.map((c) => ({
          arquivoId: c.atestadoId,
          titulo: c.titulo,
          quantidade: c.quantidade,
          criterio: c.criterio,
          observacao: c.observacao,
          evidencias: c.evidencias.map(mencaoPublica),
        })),
      })),
      balancos: {
        exigidos: avaliacaoBalancos.exigidos,
        apresentados: avaliacaoBalancos.apresentados,
        suficiente: avaliacaoBalancos.suficiente,
        mensagem: avaliacaoBalancos.mensagem,
      },
    };
  });

  return {
    processoId: e.linha.id,
    etapaAtual: e.linha.etapa_atual,
    editavel: e.editavel,
    valorTotalEstimado: total,
    parcelas,
    definidaEm: e.qualificacao?.definida_em ?? null,
    definidaPor: e.qualificacao?.definida_por ? { id: e.qualificacao.definida_por, nome: e.qualificacao.definida_por_nome ?? '' } : null,
    licitantes: [...licitantes.entries()].map(([id, nome]) => ({ id, nome })),
    analise,
    premissas: [
      'O valor total estimado é o da pesquisa de preços do processo (o mesmo exibido na jornada).',
      'Parcela de maior relevância: valor igual ou superior a 4% do valor total estimado (art. 67, § 1º); quantitativo mínimo de até 50% da parcela (art. 67, § 2º).',
      ...somarQuantitativosAtestados({ parcelas: [], atestados: [] }).premissas,
      'Balanço: 2 últimos exercícios, ou só o último se a empresa tiver menos de 2 anos na data de hoje (art. 69, § 6º), pela data de constituição informada no envio.',
    ],
    fontes,
    geradaEm: e.agora.toISOString(),
    fundamento: 'Lei 14.133/2021, art. 18, IX; art. 67, II, e §§ 1º e 2º; art. 69, I e § 6º',
    aviso: AVISO_LEITURA_ASSISTIDA,
  };
}
